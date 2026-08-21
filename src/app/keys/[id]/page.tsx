"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, Eye, EyeOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { garagePost, useGarage } from "@/lib/api";
import type { GetKeyInfoResponse } from "@/lib/garage/types";
import { formatDate } from "@/lib/format";
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
import { Checkbox } from "@/components/ui/checkbox";
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

export default function KeyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [showSecret, setShowSecret] = useState(false);
  const key = useGarage<GetKeyInfoResponse>("GetKeyInfo", {
    params: { id, showSecretKey: showSecret ? "true" : "false" },
  });
  const [busy, setBusy] = useState(false);
  const [rename, setRename] = useState<string | null>(null);

  const k = key.data;

  async function act(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      key.mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function setPerm(bucketId: string, perm: "read" | "write" | "owner", value: boolean) {
    act(
      () =>
        garagePost(value ? "AllowBucketKey" : "DenyBucketKey", {
          body: { bucketId, accessKeyId: id, permissions: { [perm]: true } },
        }),
      `Permission ${value ? "granted" : "revoked"}`,
    );
  }

  return (
    <div>
      <div className="mb-4">
        <Button variant="ghost" size="sm" render={<Link href="/keys" />}>
          <ArrowLeft /> Access keys
        </Button>
      </div>
      <PageHeader
        title={k?.name || "(unnamed key)"}
        description={k?.created ? `Created ${formatDate(k.created)}` : undefined}
      >
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive" disabled={busy} />}>
            <Trash2 /> Delete key
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this access key?</AlertDialogTitle>
              <AlertDialogDescription>
                Applications using this key will immediately lose access. This cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  act(
                    () =>
                      garagePost("DeleteKey", { params: { id } }).then(() =>
                        router.push("/keys"),
                      ),
                    "Key deleted",
                  )
                }
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageHeader>

      <ErrorBanner error={key.error} />

      {k && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Credentials</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 font-mono text-sm">
                <span className="text-muted-foreground">Access key:</span>
                <span>{k.accessKeyId}</span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(k.accessKeyId);
                    toast.success("Access key id copied");
                  }}
                >
                  <Copy />
                </Button>
              </div>
              <div className="flex items-center gap-2 font-mono text-sm">
                <span className="text-muted-foreground">Secret key:</span>
                {showSecret && k.secretAccessKey ? (
                  <>
                    <span className="break-all">{k.secretAccessKey}</span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => {
                        navigator.clipboard.writeText(k.secretAccessKey!);
                        toast.success("Secret key copied");
                      }}
                    >
                      <Copy />
                    </Button>
                  </>
                ) : (
                  <span>••••••••••••••••</span>
                )}
                <Button
                  size="icon-xs"
                  variant="ghost"
                  title={showSecret ? "Hide secret" : "Reveal secret"}
                  onClick={() => setShowSecret((s) => !s)}
                >
                  {showSecret ? <EyeOff /> : <Eye />}
                </Button>
              </div>
              <div className="flex items-center gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id="create-bucket"
                    checked={!!k.permissions.createBucket}
                    onCheckedChange={(v) =>
                      act(
                        () =>
                          garagePost("UpdateKey", {
                            params: { id },
                            body: v
                              ? { allow: { createBucket: true } }
                              : { deny: { createBucket: true } },
                          }),
                        "Key permissions updated",
                      )
                    }
                  />
                  <Label htmlFor="create-bucket">May create buckets</Label>
                </div>
                {k.expired && <Badge variant="destructive">expired</Badge>}
              </div>
              <div className="flex items-center gap-2 pt-2">
                <Input
                  className="max-w-60"
                  placeholder="Rename key…"
                  value={rename ?? k.name}
                  onChange={(e) => setRename(e.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={busy || rename === null || rename === k.name}
                  onClick={() =>
                    act(
                      () =>
                        garagePost("UpdateKey", {
                          params: { id },
                          body: { name: rename },
                        }).then(() => setRename(null)),
                      "Key renamed",
                    )
                  }
                >
                  Rename
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bucket permissions</CardTitle>
              <CardDescription>
                Buckets this key can access. Manage grants from the bucket pages too.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bucket</TableHead>
                      <TableHead className="text-center">Read</TableHead>
                      <TableHead className="text-center">Write</TableHead>
                      <TableHead className="text-center">Owner</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {k.buckets.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell>
                          <Link
                            href={`/buckets/${b.id}`}
                            className="font-medium hover:underline"
                          >
                            {b.globalAliases[0] ?? b.localAliases[0] ?? "(no alias)"}
                          </Link>
                          <div>
                            <MonoId id={b.id} className="text-muted-foreground" />
                          </div>
                        </TableCell>
                        {(["read", "write", "owner"] as const).map((perm) => (
                          <TableCell key={perm} className="text-center">
                            <Checkbox
                              checked={!!b.permissions[perm]}
                              disabled={busy}
                              onCheckedChange={(v) => setPerm(b.id, perm, v === true)}
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                    {k.buckets.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="text-center text-muted-foreground"
                        >
                          This key has no bucket permissions.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
