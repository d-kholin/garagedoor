"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, KeyRound, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { garagePost, useGarage } from "@/lib/api";
import type { GetKeyInfoResponse, ListKeysResponse } from "@/lib/garage/types";
import { formatDate } from "@/lib/format";
import { ErrorBanner, MonoId, PageHeader } from "@/components/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text);
  toast.success(`${what} copied to clipboard`);
}

function NewKeySecret({ created }: { created: GetKeyInfoResponse }) {
  return (
    <Alert className="mb-4">
      <KeyRound />
      <AlertTitle>Key created — copy the secret now</AlertTitle>
      <AlertDescription>
        <p className="mb-2">
          The secret key is only shown once. Store it somewhere safe.
        </p>
        <div className="grid gap-1 font-mono text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Access key:</span>
            <span>{created.accessKeyId}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => copy(created.accessKeyId, "Access key id")}
            >
              <Copy />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Secret key:</span>
            <span className="break-all">{created.secretAccessKey}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => copy(created.secretAccessKey ?? "", "Secret key")}
            >
              <Copy />
            </Button>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}

export default function KeysPage() {
  const keys = useGarage<ListKeysResponse>("ListKeys", { refreshInterval: 15_000 });
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [name, setName] = useState("");
  const [importForm, setImportForm] = useState({ name: "", accessKeyId: "", secretAccessKey: "" });
  const [busy, setBusy] = useState(false);
  const [lastCreated, setLastCreated] = useState<GetKeyInfoResponse | null>(null);

  async function createKey() {
    setBusy(true);
    try {
      const created = await garagePost<GetKeyInfoResponse>("CreateKey", {
        body: { name: name.trim() || null },
      });
      setLastCreated(created);
      setName("");
      setCreateOpen(false);
      keys.mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function importKey() {
    setBusy(true);
    try {
      await garagePost("ImportKey", {
        body: {
          name: importForm.name.trim() || null,
          accessKeyId: importForm.accessKeyId.trim(),
          secretAccessKey: importForm.secretAccessKey.trim(),
        },
      });
      toast.success("Key imported");
      setImportForm({ name: "", accessKeyId: "", secretAccessKey: "" });
      setImportOpen(false);
      keys.mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Access Keys" description="S3 API credentials and their bucket permissions.">
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogTrigger render={<Button variant="outline" />}>
            <Upload /> Import
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Import an existing key</DialogTitle>
              <DialogDescription>
                Bring an existing access key / secret key pair into Garage (e.g. migrated
                from another cluster).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={importForm.name}
                  onChange={(e) => setImportForm({ ...importForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Access key id</Label>
                <Input
                  className="font-mono"
                  value={importForm.accessKeyId}
                  onChange={(e) =>
                    setImportForm({ ...importForm, accessKeyId: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Secret access key</Label>
                <Input
                  className="font-mono"
                  value={importForm.secretAccessKey}
                  onChange={(e) =>
                    setImportForm({ ...importForm, secretAccessKey: e.target.value })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setImportOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={importKey}
                disabled={busy || !importForm.accessKeyId || !importForm.secretAccessKey}
              >
                Import
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button />}>
            <Plus /> New key
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create access key</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                placeholder="my-app"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createKey()}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createKey} disabled={busy}>
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {lastCreated && <NewKeySecret created={lastCreated} />}
      <ErrorBanner error={keys.error} />

      <Card>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Access key id</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(keys.data ?? []).map((k) => (
                  <TableRow key={k.id}>
                    <TableCell>
                      <Link href={`/keys/${k.id}`} className="font-medium hover:underline">
                        {k.name || "(unnamed)"}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1">
                        <MonoId id={k.id} />
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => copy(k.id, "Access key id")}
                        >
                          <Copy />
                        </Button>
                      </span>
                    </TableCell>
                    <TableCell>{formatDate(k.created)}</TableCell>
                    <TableCell>
                      {k.expired ? (
                        <Badge variant="destructive">expired</Badge>
                      ) : k.expiration ? (
                        <Badge variant="outline">expires {formatDate(k.expiration)}</Badge>
                      ) : (
                        <Badge variant="secondary">active</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {keys.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No access keys yet.
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
