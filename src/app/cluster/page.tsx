"use client";

import { useState } from "react";
import { Link2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { garagePost, useGarage } from "@/lib/api";
import type {
  GetClusterLayoutResponse,
  GetClusterStatusResponse,
  PreviewClusterLayoutChangesResponse,
} from "@/lib/garage/types";
import { formatBytesSI } from "@/lib/format";
import { ErrorBanner, MonoId, PageHeader } from "@/components/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Layout capacities use decimal SI bytes, matching Garage's CLI (1 GB = 10^9).
const GB = 1000 ** 3;

interface RoleForm {
  id: string;
  hostname?: string | null;
  zone: string;
  capacityGb: string;
  gateway: boolean;
  tags: string;
}

function RoleEditorDialog({
  form,
  onClose,
  onSaved,
}: {
  form: RoleForm;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, setState] = useState(form);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await garagePost("UpdateClusterLayout", {
        body: {
          roles: [
            {
              id: state.id,
              zone: state.zone.trim() || "default",
              capacity: state.gateway
                ? null
                : Math.round(parseFloat(state.capacityGb || "0") * GB),
              tags: state.tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            },
          ],
        },
      });
      toast.success("Role change staged — review and apply below");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Node role: {form.hostname ?? form.id.slice(0, 12)}
          </DialogTitle>
          <DialogDescription>
            Changes are staged first; nothing moves until you apply the new layout
            version.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="zone">Zone</Label>
            <Input
              id="zone"
              placeholder="dc1"
              value={state.zone}
              onChange={(e) => setState({ ...state, zone: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="gateway"
              checked={state.gateway}
              onCheckedChange={(v) => setState({ ...state, gateway: v })}
            />
            <Label htmlFor="gateway">Gateway node (no storage capacity)</Label>
          </div>
          {!state.gateway && (
            <div className="space-y-2">
              <Label htmlFor="capacity">Capacity (GB)</Label>
              <Input
                id="capacity"
                type="number"
                min="0"
                step="any"
                value={state.capacityGb}
                onChange={(e) => setState({ ...state, capacityGb: e.target.value })}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="tags">Tags (comma-separated)</Label>
            <Input
              id="tags"
              placeholder="ssd, rack2"
              value={state.tags}
              onChange={(e) => setState({ ...state, tags: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={busy || (!state.gateway && !parseFloat(state.capacityGb || "0"))}
          >
            Stage change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ClusterLayoutPage() {
  const layout = useGarage<GetClusterLayoutResponse>("GetClusterLayout", {
    refreshInterval: 10_000,
  });
  const status = useGarage<GetClusterStatusResponse>("GetClusterStatus", {
    refreshInterval: 10_000,
  });
  const [editing, setEditing] = useState<RoleForm | null>(null);
  const [preview, setPreview] = useState<PreviewClusterLayoutChangesResponse | null>(null);
  const [connectAddr, setConnectAddr] = useState("");
  const [busy, setBusy] = useState(false);

  const l = layout.data;
  const nodes = status.data?.nodes ?? [];
  const staged = l?.stagedRoleChanges ?? [];
  const unassigned = nodes.filter(
    (n) => !n.role && !staged.some((s) => s.id === n.id && !("remove" in s)),
  );

  function refresh() {
    layout.mutate();
    status.mutate();
    setPreview(null);
  }

  async function act(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doPreview() {
    setBusy(true);
    try {
      const p = await garagePost<PreviewClusterLayoutChangesResponse>(
        "PreviewClusterLayoutChanges",
      );
      setPreview(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const hostnameOf = (id: string) =>
    nodes.find((n) => n.id === id)?.hostname ?? null;

  return (
    <div>
      <PageHeader
        title="Cluster Layout"
        description={
          l ? `Current layout version ${l.version}. Partition size ${formatBytesSI(l.partitionSize)}.` : undefined
        }
      />
      <ErrorBanner error={layout.error ?? status.error} />

      {l && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Storage roles</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Node</TableHead>
                      <TableHead>Zone</TableHead>
                      <TableHead>Capacity</TableHead>
                      <TableHead>Usable</TableHead>
                      <TableHead className="text-right">Partitions</TableHead>
                      <TableHead>Tags</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {l.roles.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-medium">{hostnameOf(r.id) ?? "unknown"}</div>
                          <MonoId id={r.id} className="text-muted-foreground" />
                        </TableCell>
                        <TableCell>{r.zone}</TableCell>
                        <TableCell>
                          {r.capacity != null ? formatBytesSI(r.capacity) : <Badge variant="outline">gateway</Badge>}
                        </TableCell>
                        <TableCell>
                          {r.usableCapacity != null ? formatBytesSI(r.usableCapacity) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.storedPartitions ?? "—"}
                        </TableCell>
                        <TableCell>
                          {r.tags.map((t) => (
                            <Badge key={t} variant="secondary" className="mr-1">
                              {t}
                            </Badge>
                          ))}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title="Edit role"
                              onClick={() =>
                                setEditing({
                                  id: r.id,
                                  hostname: hostnameOf(r.id),
                                  zone: r.zone,
                                  capacityGb:
                                    r.capacity != null ? String(r.capacity / GB) : "100",
                                  gateway: r.capacity == null,
                                  tags: r.tags.join(", "),
                                })
                              }
                            >
                              <Pencil />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title="Stage removal from layout"
                              onClick={() =>
                                act(
                                  () =>
                                    garagePost("UpdateClusterLayout", {
                                      body: { roles: [{ id: r.id, remove: true }] },
                                    }),
                                  "Node removal staged",
                                )
                              }
                            >
                              <Trash2 className="text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {unassigned.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Unassigned nodes</CardTitle>
                <CardDescription>
                  Connected nodes that have no role in the current layout.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {unassigned.map((n) => (
                    <div
                      key={n.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                    >
                      <div>
                        <div className="font-medium">{n.hostname ?? "unknown"}</div>
                        <MonoId id={n.id} className="text-muted-foreground" />
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {n.addr}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        onClick={() =>
                          setEditing({
                            id: n.id,
                            hostname: n.hostname,
                            zone: "",
                            capacityGb: "100",
                            gateway: false,
                            tags: "",
                          })
                        }
                      >
                        Assign role
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {(staged.length > 0 || l.stagedParameters) && (
            <Card className="border-amber-500/50">
              <CardHeader>
                <CardTitle>Staged changes</CardTitle>
                <CardDescription>
                  These take effect when you apply layout version {l.version + 1}.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-1 text-sm">
                  {staged.map((s) => (
                    <li key={s.id} className="flex items-center gap-2">
                      {"remove" in s ? (
                        <Badge variant="destructive">remove</Badge>
                      ) : (
                        <Badge>assign</Badge>
                      )}
                      <span className="font-medium">
                        {hostnameOf(s.id) ?? s.id.slice(0, 12)}
                      </span>
                      {!("remove" in s) && (
                        <span className="text-muted-foreground">
                          zone {s.zone},{" "}
                          {s.capacity != null ? formatBytesSI(s.capacity) : "gateway"}
                          {s.tags.length > 0 && `, tags: ${s.tags.join(", ")}`}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>

                {preview && (
                  <div className="rounded-lg bg-muted p-4">
                    {preview.error ? (
                      <p className="text-sm text-red-500">{preview.error}</p>
                    ) : (
                      <pre className="overflow-x-auto text-xs leading-relaxed">
                        {(preview.message ?? []).join("\n")}
                      </pre>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={doPreview} disabled={busy}>
                    Preview changes
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger render={<Button disabled={busy} />}>
                      Apply layout v{l.version + 1}
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Apply cluster layout version {l.version + 1}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Garage will start rebalancing data according to the new layout.
                          Depending on data volume this can cause significant network and
                          disk activity. You can watch progress on the Replication page.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() =>
                            act(
                              () =>
                                garagePost("ApplyClusterLayout", {
                                  body: { version: l.version + 1 },
                                }),
                              `Layout version ${l.version + 1} applied`,
                            )
                          }
                        >
                          Apply
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () => garagePost("RevertClusterLayout"),
                        "Staged changes reverted",
                      )
                    }
                  >
                    Discard staged changes
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Connect a node</CardTitle>
              <CardDescription>
                Add a new node by its identifier and RPC address:{" "}
                <code className="font-mono text-xs">&lt;node_id&gt;@&lt;ip&gt;:&lt;port&gt;</code>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input
                  placeholder="1c233…f57@10.0.0.2:3901"
                  className="max-w-lg font-mono text-xs"
                  value={connectAddr}
                  onChange={(e) => setConnectAddr(e.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={busy || !connectAddr.includes("@")}
                  onClick={() =>
                    act(
                      () =>
                        garagePost("ConnectClusterNodes", {
                          body: [connectAddr.trim()],
                        }).then(() => setConnectAddr("")),
                      "Node connection attempted",
                    )
                  }
                >
                  <Link2 /> Connect
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {editing && (
        <RoleEditorDialog
          form={editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
