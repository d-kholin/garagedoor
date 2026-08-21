"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { garagePost, useGarage } from "@/lib/api";
import type { GetBucketInfoResponse, ListBucketsResponse } from "@/lib/garage/types";
import { formatBytes, formatCount, formatDate } from "@/lib/format";
import { ErrorBanner, MonoId, PageHeader } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function BucketStatsCells({ id }: { id: string }) {
  const { data, error } = useGarage<GetBucketInfoResponse>("GetBucketInfo", {
    params: { id },
    refreshInterval: 30_000,
  });
  if (error)
    return (
      <>
        <TableCell colSpan={3} className="text-xs text-red-500">
          failed to load stats
        </TableCell>
      </>
    );
  if (!data)
    return (
      <>
        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
      </>
    );
  return (
    <>
      <TableCell className="text-right tabular-nums">{formatCount(data.objects)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {formatBytes(data.bytes)}
        {data.quotas.maxSize != null && (
          <span className="text-xs text-muted-foreground">
            {" "}/ {formatBytes(data.quotas.maxSize)}
          </span>
        )}
      </TableCell>
      <TableCell>
        {data.websiteAccess && <Badge variant="outline">website</Badge>}
        {data.unfinishedUploads > 0 && (
          <Badge variant="secondary" className="ml-1">
            {data.unfinishedUploads} unfinished
          </Badge>
        )}
      </TableCell>
    </>
  );
}

export default function BucketsPage() {
  const buckets = useGarage<ListBucketsResponse>("ListBuckets", {
    refreshInterval: 15_000,
  });
  const [open, setOpen] = useState(false);
  const [alias, setAlias] = useState("");
  const [creating, setCreating] = useState(false);

  async function createBucket() {
    if (!alias.trim()) return;
    setCreating(true);
    try {
      await garagePost("CreateBucket", { body: { globalAlias: alias.trim() } });
      toast.success(`Bucket "${alias.trim()}" created`);
      setAlias("");
      setOpen(false);
      buckets.mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <PageHeader title="Buckets" description="Manage buckets, quotas, and aliases.">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button />}>
            <Plus /> New bucket
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create bucket</DialogTitle>
              <DialogDescription>
                The global alias is the bucket name used by S3 clients.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="bucket-alias">Global alias</Label>
              <Input
                id="bucket-alias"
                placeholder="my-bucket"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createBucket()}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createBucket} disabled={creating || !alias.trim()}>
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageHeader>

      <ErrorBanner error={buckets.error} />

      <Card>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bucket</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Objects</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead>Flags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(buckets.data ?? []).map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Link
                        href={`/buckets/${b.id}`}
                        className="font-medium hover:underline"
                      >
                        {b.globalAliases[0] ?? "(no alias)"}
                      </Link>
                      {b.globalAliases.length > 1 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          +{b.globalAliases.length - 1} alias(es)
                        </span>
                      )}
                      <div>
                        <MonoId id={b.id} className="text-muted-foreground" />
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(b.created)}</TableCell>
                    <BucketStatsCells id={b.id} />
                  </TableRow>
                ))}
                {buckets.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No buckets yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
