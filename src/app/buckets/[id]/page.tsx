"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { garagePost, useGarage } from "@/lib/api";
import type {
  GetBucketInfoResponse,
  ListKeysResponse,
} from "@/lib/garage/types";
import { formatBytes, formatCount, formatDate } from "@/lib/format";
import { ObjectBrowser } from "@/components/object-browser";
import { ErrorBanner, MonoId, PageHeader, StatCard } from "@/components/shared";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function useAction() {
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, successMsg: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(successMsg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

const GIB = 1024 ** 3;

function QuotasCard({
  bucket,
  onSaved,
}: {
  bucket: GetBucketInfoResponse;
  onSaved: () => void;
}) {
  const [maxSizeGib, setMaxSizeGib] = useState(
    bucket.quotas.maxSize != null ? String(bucket.quotas.maxSize / GIB) : "",
  );
  const [maxObjects, setMaxObjects] = useState(
    bucket.quotas.maxObjects != null ? String(bucket.quotas.maxObjects) : "",
  );
  const { busy, run } = useAction();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quotas</CardTitle>
        <CardDescription>Leave a field empty for no limit.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="max-size">Max size (GiB)</Label>
            <Input
              id="max-size"
              type="number"
              min="0"
              step="any"
              placeholder="unlimited"
              value={maxSizeGib}
              onChange={(e) => setMaxSizeGib(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max-objects">Max objects</Label>
            <Input
              id="max-objects"
              type="number"
              min="0"
              placeholder="unlimited"
              value={maxObjects}
              onChange={(e) => setMaxObjects(e.target.value)}
            />
          </div>
        </div>
        <Button
          disabled={busy}
          onClick={() =>
            run(
              () =>
                garagePost("UpdateBucket", {
                  params: { id: bucket.id },
                  body: {
                    quotas: {
                      maxSize: maxSizeGib ? Math.round(parseFloat(maxSizeGib) * GIB) : null,
                      maxObjects: maxObjects ? parseInt(maxObjects, 10) : null,
                    },
                  },
                }).then(onSaved),
              "Quotas updated",
            )
          }
        >
          Save quotas
        </Button>
      </CardContent>
    </Card>
  );
}

function WebsiteCard({
  bucket,
  onSaved,
}: {
  bucket: GetBucketInfoResponse;
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = useState(bucket.websiteAccess);
  const [index, setIndex] = useState(bucket.websiteConfig?.indexDocument ?? "index.html");
  const [errorDoc, setErrorDoc] = useState(bucket.websiteConfig?.errorDocument ?? "");
  const { busy, run } = useAction();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Static website hosting</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Switch id="website" checked={enabled} onCheckedChange={setEnabled} />
          <Label htmlFor="website">Enable website access</Label>
        </div>
        {enabled && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="index-doc">Index document</Label>
              <Input
                id="index-doc"
                value={index}
                onChange={(e) => setIndex(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="error-doc">Error document (optional)</Label>
              <Input
                id="error-doc"
                placeholder="error.html"
                value={errorDoc}
                onChange={(e) => setErrorDoc(e.target.value)}
              />
            </div>
          </div>
        )}
        <Button
          disabled={busy}
          onClick={() =>
            run(
              () =>
                garagePost("UpdateBucket", {
                  params: { id: bucket.id },
                  body: {
                    websiteAccess: {
                      enabled,
                      indexDocument: enabled ? index || "index.html" : null,
                      errorDocument: enabled && errorDoc ? errorDoc : null,
                    },
                  },
                }).then(onSaved),
              "Website configuration updated",
            )
          }
        >
          Save website config
        </Button>
      </CardContent>
    </Card>
  );
}

function AliasesCard({
  bucket,
  onSaved,
}: {
  bucket: GetBucketInfoResponse;
  onSaved: () => void;
}) {
  const [newAlias, setNewAlias] = useState("");
  const { busy, run } = useAction();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Global aliases</CardTitle>
        <CardDescription>Names under which S3 clients can reach this bucket.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {bucket.globalAliases.map((a) => (
            <Badge key={a} variant="secondary" className="gap-1 text-sm">
              {a}
              <button
                className="ml-1 text-muted-foreground hover:text-destructive"
                title={`Remove alias ${a}`}
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      garagePost("RemoveBucketAlias", {
                        body: { bucketId: bucket.id, globalAlias: a },
                      }).then(onSaved),
                    `Alias "${a}" removed`,
                  )
                }
              >
                ×
              </button>
            </Badge>
          ))}
          {bucket.globalAliases.length === 0 && (
            <span className="text-sm text-muted-foreground">No aliases.</span>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="new-alias"
            value={newAlias}
            onChange={(e) => setNewAlias(e.target.value)}
            className="max-w-60"
          />
          <Button
            variant="outline"
            disabled={busy || !newAlias.trim()}
            onClick={() =>
              run(
                () =>
                  garagePost("AddBucketAlias", {
                    body: { bucketId: bucket.id, globalAlias: newAlias.trim() },
                  }).then(() => {
                    setNewAlias("");
                    onSaved();
                  }),
                "Alias added",
              )
            }
          >
            <Plus /> Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PermissionsTab({
  bucket,
  onChanged,
}: {
  bucket: GetBucketInfoResponse;
  onChanged: () => void;
}) {
  const keys = useGarage<ListKeysResponse>("ListKeys");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const { busy, run } = useAction();

  const unattachedKeys = (keys.data ?? []).filter(
    (k) => !bucket.keys.some((bk) => bk.accessKeyId === k.id && (bk.permissions.read || bk.permissions.write || bk.permissions.owner)),
  );

  function setPerm(accessKeyId: string, perm: "read" | "write" | "owner", value: boolean) {
    run(
      () =>
        garagePost(value ? "AllowBucketKey" : "DenyBucketKey", {
          body: {
            bucketId: bucket.id,
            accessKeyId,
            permissions: { [perm]: true },
          },
        }).then(onChanged),
      `Permission ${value ? "granted" : "revoked"}`,
    );
  }

  const activeKeys = bucket.keys.filter(
    (k) => k.permissions.read || k.permissions.write || k.permissions.owner,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Key permissions</CardTitle>
        <CardDescription>
          Which access keys may read from, write to, or administer this bucket.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead className="text-center">Read</TableHead>
                <TableHead className="text-center">Write</TableHead>
                <TableHead className="text-center">Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeKeys.map((k) => (
                <TableRow key={k.accessKeyId}>
                  <TableCell>
                    <Link href={`/keys/${k.accessKeyId}`} className="font-medium hover:underline">
                      {k.name || "(unnamed)"}
                    </Link>
                    <div>
                      <MonoId id={k.accessKeyId} className="text-muted-foreground" />
                    </div>
                  </TableCell>
                  {(["read", "write", "owner"] as const).map((perm) => (
                    <TableCell key={perm} className="text-center">
                      <Checkbox
                        checked={!!k.permissions[perm]}
                        disabled={busy}
                        onCheckedChange={(v) => setPerm(k.accessKeyId, perm, v === true)}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {activeKeys.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No keys have access to this bucket.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center gap-2">
          <Select value={selectedKey ?? ""} onValueChange={(v) => setSelectedKey(v as string)}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Grant access to a key…" />
            </SelectTrigger>
            <SelectContent>
              {unattachedKeys.map((k) => (
                <SelectItem key={k.id} value={k.id}>
                  {k.name || k.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={!selectedKey || busy}
            onClick={() => {
              if (!selectedKey) return;
              setPerm(selectedKey, "read", true);
              setSelectedKey(null);
            }}
          >
            <Plus /> Grant read
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DangerZone({ bucket }: { bucket: GetBucketInfoResponse }) {
  const router = useRouter();
  const { busy, run } = useAction();
  const [cleanupDays, setCleanupDays] = useState("1");
  const isEmpty = bucket.objects === 0;

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-2">
            <Label htmlFor="cleanup-days">Clean up incomplete uploads older than (days)</Label>
            <Input
              id="cleanup-days"
              type="number"
              min="0"
              step="any"
              value={cleanupDays}
              onChange={(e) => setCleanupDays(e.target.value)}
              className="max-w-40"
            />
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  garagePost("CleanupIncompleteUploads", {
                    body: {
                      bucketId: bucket.id,
                      olderThanSecs: Math.round(parseFloat(cleanupDays || "1") * 86400),
                    },
                  }),
                "Incomplete uploads cleaned up",
              )
            }
          >
            Clean up
          </Button>
          <p className="w-full text-xs text-muted-foreground">
            {formatCount(bucket.unfinishedUploads)} unfinished upload(s),{" "}
            {formatBytes(bucket.unfinishedMultipartUploadBytes)} in incomplete multipart parts.
          </p>
        </div>

        <div>
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="destructive" disabled={!isEmpty || busy} />}
            >
              <Trash2 /> Delete bucket
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this bucket?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the bucket, all its aliases, and all key permissions on it.
                  Garage only allows deleting empty buckets.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    run(
                      () =>
                        garagePost("DeleteBucket", { params: { id: bucket.id } }).then(() =>
                          router.push("/buckets"),
                        ),
                      "Bucket deleted",
                    )
                  }
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {!isEmpty && (
            <p className="mt-2 text-xs text-muted-foreground">
              Bucket is not empty ({formatCount(bucket.objects)} objects) — deletion disabled.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function BucketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const bucket = useGarage<GetBucketInfoResponse>("GetBucketInfo", {
    params: { id },
    refreshInterval: 15_000,
  });

  const b = bucket.data;
  const name = b?.globalAliases[0];

  return (
    <div>
      <div className="mb-4">
        <Button variant="ghost" size="sm" render={<Link href="/buckets" />}>
          <ArrowLeft /> Buckets
        </Button>
      </div>
      <PageHeader
        title={name ?? "(bucket)"}
        description={b ? `Created ${formatDate(b.created)}` : undefined}
      />
      {b && <MonoId id={b.id} className="relative -top-4 text-muted-foreground" />}

      <ErrorBanner error={bucket.error} />

      {b && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Objects" value={formatCount(b.objects)} />
            <StatCard
              label="Size"
              value={formatBytes(b.bytes)}
              hint={
                b.quotas.maxSize != null
                  ? `quota: ${formatBytes(b.quotas.maxSize)}`
                  : undefined
              }
            />
            <StatCard label="Unfinished uploads" value={formatCount(b.unfinishedUploads)} />
            <StatCard
              label="Website"
              value={b.websiteAccess ? "enabled" : "off"}
              tone={b.websiteAccess ? "good" : "default"}
            />
          </div>

          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="permissions">Permissions</TabsTrigger>
              <TabsTrigger value="browse">Browse</TabsTrigger>
              <TabsTrigger value="danger">Danger</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="mt-4 space-y-4">
              <AliasesCard bucket={b} onSaved={() => bucket.mutate()} />
              <div className="grid gap-4 lg:grid-cols-2">
                <QuotasCard key={`q-${b.id}`} bucket={b} onSaved={() => bucket.mutate()} />
                <WebsiteCard key={`w-${b.id}`} bucket={b} onSaved={() => bucket.mutate()} />
              </div>
            </TabsContent>
            <TabsContent value="permissions" className="mt-4">
              <PermissionsTab bucket={b} onChanged={() => bucket.mutate()} />
            </TabsContent>
            <TabsContent value="browse" className="mt-4">
              {name ? (
                <ObjectBrowser bucketId={b.id} bucketName={name} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  This bucket has no global alias, so it cannot be browsed via the S3 API.
                  Add a global alias first.
                </p>
              )}
            </TabsContent>
            <TabsContent value="danger" className="mt-4">
              <DangerZone bucket={b} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
