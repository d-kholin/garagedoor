"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { garagePost, useGarage, useGaragePost } from "@/lib/api";
import type {
  BlockError,
  ClusterHealth,
  GetClusterStatusResponse,
  LocalNodeStatistics,
  MultiResponse,
  WorkerInfo,
} from "@/lib/garage/types";
import { formatBytes, formatCount, formatDuration } from "@/lib/format";
import { RefreshCw } from "lucide-react";
import {
  ErrorBanner,
  LoadingCards,
  MonoId,
  PageHeader,
  StatCard,
} from "@/components/shared";
import {
  ResyncChart,
  drainRate,
  useResyncHistory,
} from "@/components/resync-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const REFRESH = 5_000;

function workerStateBadge(w: WorkerInfo) {
  if (typeof w.state === "object" && "throttled" in w.state) {
    return <Badge variant="outline">throttled {w.state.throttled.durationSecs.toFixed(1)}s</Badge>;
  }
  if (w.state === "busy") return <Badge className="bg-blue-600 text-white dark:bg-blue-500">busy</Badge>;
  if (w.state === "done") return <Badge variant="secondary">done</Badge>;
  return <Badge variant="outline">idle</Badge>;
}

/** Extract a percentage from Garage's freeform worker progress strings (e.g. "42.5%"). */
function progressPct(progress?: string | null): number | null {
  if (!progress) return null;
  const m = progress.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Math.min(100, parseFloat(m[1])) : null;
}

function nodeLabel(
  id: string,
  status?: GetClusterStatusResponse,
): { name: string; zone?: string } {
  const n = status?.nodes.find((n) => n.id === id || n.id.startsWith(id));
  return { name: n?.hostname ?? id.slice(0, 12), zone: n?.role?.zone };
}

export default function ReplicationPage() {
  const [errorOnly, setErrorOnly] = useState(false);

  const health = useGarage<ClusterHealth>("GetClusterHealth", {
    refreshInterval: REFRESH,
  });
  const status = useGarage<GetClusterStatusResponse>("GetClusterStatus", {
    refreshInterval: 30_000,
  });
  const nodeStats = useGarage<MultiResponse<LocalNodeStatistics>>(
    "GetNodeStatistics",
    { params: { node: "*" }, refreshInterval: REFRESH },
  );
  const workers = useGaragePost<MultiResponse<WorkerInfo[]>>("ListWorkers", {
    params: { node: "*" },
    body: { busyOnly: false, errorOnly },
    refreshInterval: REFRESH,
  });
  const blockErrors = useGarage<MultiResponse<BlockError[]>>("ListBlockErrors", {
    params: { node: "*" },
    refreshInterval: 15_000,
  });

  // Rolling per-node queue history for the chart (null = unreachable).
  const latestReading = useMemo(() => {
    if (!nodeStats.data) return null;
    const values: Record<string, number | null> = {};
    for (const [id, s] of Object.entries(nodeStats.data.success)) {
      values[id] = s.blockManagerStats?.resyncQueueLen ?? 0;
    }
    for (const id of Object.keys(nodeStats.data.error)) {
      values[id] = null;
    }
    return values;
  }, [nodeStats.data]);
  const history = useResyncHistory(latestReading);
  const rate = drainRate(history);

  const perNode = useMemo(() => {
    const ids = new Set<string>([
      ...Object.keys(nodeStats.data?.success ?? {}),
      ...Object.keys(nodeStats.data?.error ?? {}),
      ...Object.keys(workers.data?.success ?? {}),
    ]);
    return [...ids].sort().map((id) => ({
      id,
      stats: nodeStats.data?.success?.[id],
      statsError: nodeStats.data?.error?.[id],
      workers: workers.data?.success?.[id] ?? [],
      blockErrors: blockErrors.data?.success?.[id] ?? [],
    }));
  }, [nodeStats.data, workers.data, blockErrors.data]);

  const totals = useMemo(() => {
    let queue = 0;
    let errors = 0;
    let errorBlocks = 0;
    for (const n of perNode) {
      queue += n.stats?.blockManagerStats?.resyncQueueLen ?? 0;
      errors += n.stats?.blockManagerStats?.resyncErrors ?? 0;
      errorBlocks += n.blockErrors.length;
    }
    return { queue, errors, errorBlocks };
  }, [perNode]);

  // Estimate bytes not yet fully replicated: resync queue length × average
  // block size derived from cluster stats when available (fallback: Garage's
  // default max block size of 1 MiB as an upper bound).
  const h = health.data;
  const partitionsBehind = h ? h.partitions - h.partitionsAllOk : 0;

  const [forcing, setForcing] = useState(false);
  async function forceResync(node: string) {
    setForcing(true);
    try {
      await garagePost("LaunchRepairOperation", {
        params: { node },
        body: { repairType: "blocks" },
      });
      toast.success(
        node === "*"
          ? "Block repair launched on all nodes — queues will re-check and sync immediately"
          : "Block repair launched on node",
      );
      nodeStats.mutate();
      workers.mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setForcing(false);
    }
  }

  async function retryAll(node: string) {
    try {
      await garagePost("RetryBlockResync", {
        params: { node },
        body: { all: true },
      });
      toast.success("Resync retry triggered for all errored blocks");
      blockErrors.mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <PageHeader
        title="Replication"
        description="Per-node resync queues, background workers, and blocks that are not yet fully replicated."
      >
        <Button variant="outline" disabled={forcing} onClick={() => forceResync("*")}>
          <RefreshCw className={forcing ? "animate-spin" : undefined} />
          Force resync (all nodes)
        </Button>
      </PageHeader>
      <ErrorBanner error={health.error ?? nodeStats.error ?? workers.error} />

      {!nodeStats.data && !nodeStats.error ? (
        <LoadingCards />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Blocks awaiting resync"
            value={formatCount(totals.queue)}
            tone={totals.queue === 0 ? "good" : "warn"}
            hint={
              rate && totals.queue > 0
                ? `draining ${Math.round(rate)} blocks/min · ~${formatDuration(
                    (totals.queue / rate) * 60,
                  )} left`
                : "sum of all node resync queues"
            }
          />
          <StatCard
            label="Estimated data to resync"
            value={`≤ ${formatBytes(totals.queue * 1024 * 1024)}`}
            hint="upper bound at 1 MiB max block size"
            tone={totals.queue === 0 ? "good" : "default"}
          />
          <StatCard
            label="Partitions not fully replicated"
            value={h ? formatCount(partitionsBehind) : "—"}
            tone={partitionsBehind === 0 ? "good" : "warn"}
            hint={h ? `${formatCount(h.partitionsAllOk)}/${formatCount(h.partitions)} all-OK` : undefined}
          />
          <StatCard
            label="Blocks with resync errors"
            value={formatCount(totals.errors)}
            tone={totals.errors === 0 ? "good" : "bad"}
            hint="will be retried with backoff"
          />
        </div>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Resync queue over time</CardTitle>
        </CardHeader>
        <CardContent>
          <ResyncChart
            history={history}
            nodeLabels={Object.fromEntries(
              (status.data?.nodes ?? []).map((n) => [
                n.id,
                n.hostname
                  ? `${n.hostname}${n.role?.zone ? ` (${n.role.zone})` : ""}`
                  : n.id.slice(0, 8),
              ]),
            )}
          />
          {h && (
            <div className="mt-4 border-t pt-4">
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Partition replication (fully replicated / total)
                </span>
                <span className="tabular-nums font-medium">
                  {((h.partitionsAllOk / h.partitions) * 100).toFixed(1)}%
                </span>
              </div>
              <Progress value={(h.partitionsAllOk / h.partitions) * 100} />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-8 space-y-6">
        {perNode.map((n) => {
          const label = nodeLabel(n.id, status.data);
          const bm = n.stats?.blockManagerStats;
          const resyncWorkers = n.workers.filter((w) =>
            w.name.toLowerCase().includes("resync"),
          );
          const otherWorkers = n.workers.filter(
            (w) => !w.name.toLowerCase().includes("resync"),
          );
          return (
            <Card key={n.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2">
                    {label.name}
                    {label.zone && <Badge variant="outline">{label.zone}</Badge>}
                    <MonoId id={n.id} className="text-muted-foreground font-normal" />
                  </CardTitle>
                  <div className="flex items-center gap-4 text-sm">
                    {n.statsError ? (
                      <Badge variant="destructive">unreachable</Badge>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={forcing}
                          title="Launch a blocks repair on this node: re-scan the local block store and immediately resync anything missing"
                          onClick={() => forceResync(n.id)}
                        >
                          <RefreshCw />
                          Force resync
                        </Button>
                        <span className="text-muted-foreground">
                          Resync queue:{" "}
                          <span className="font-medium text-foreground tabular-nums">
                            {formatCount(bm?.resyncQueueLen)}
                          </span>
                        </span>
                        <span className="text-muted-foreground">
                          Errors:{" "}
                          <span
                            className={
                              (bm?.resyncErrors ?? 0) > 0
                                ? "font-medium text-red-500 tabular-nums"
                                : "font-medium text-foreground tabular-nums"
                            }
                          >
                            {formatCount(bm?.resyncErrors)}
                          </span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {n.statsError && (
                  <p className="text-sm text-red-500">{n.statsError}</p>
                )}

                {[...resyncWorkers, ...otherWorkers].filter(
                  (w) =>
                    resyncWorkers.includes(w) ||
                    (w.queueLength ?? 0) > 0 ||
                    w.errors > 0 ||
                    w.state === "busy",
                ).length > 0 && (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Worker</TableHead>
                          <TableHead>State</TableHead>
                          <TableHead className="text-right">Queue</TableHead>
                          <TableHead className="min-w-44">Progress</TableHead>
                          <TableHead className="text-right">Errors</TableHead>
                          <TableHead>Last error</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...resyncWorkers, ...otherWorkers]
                          .filter(
                            (w) =>
                              resyncWorkers.includes(w) ||
                              (w.queueLength ?? 0) > 0 ||
                              w.errors > 0 ||
                              w.state === "busy",
                          )
                          .map((w) => {
                            const pct = progressPct(w.progress);
                            return (
                              <TableRow key={w.id}>
                                <TableCell className="font-medium">
                                  {w.name}
                                  {w.tranquility != null && (
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      tranquility {w.tranquility}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell>{workerStateBadge(w)}</TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatCount(w.queueLength)}
                                </TableCell>
                                <TableCell>
                                  {pct !== null ? (
                                    <div className="flex items-center gap-2">
                                      <Progress value={pct} className="w-24" />
                                      <span className="text-xs tabular-nums text-muted-foreground">
                                        {w.progress}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      {w.progress ?? "—"}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {w.errors > 0 ? (
                                    <span className="text-red-500">
                                      {formatCount(w.errors)}
                                    </span>
                                  ) : (
                                    "0"
                                  )}
                                </TableCell>
                                <TableCell className="max-w-64">
                                  {w.lastError ? (
                                    <Tooltip>
                                      <TooltipTrigger
                                        render={
                                          <span className="block truncate text-xs text-red-500" />
                                        }
                                      >
                                        {w.lastError.message} (
                                        {formatDuration(w.lastError.secsAgo)} ago)
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-96 break-words">
                                        {w.lastError.message}
                                      </TooltipContent>
                                    </Tooltip>
                                  ) : (
                                    "—"
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {n.blockErrors.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-medium text-red-500">
                        {n.blockErrors.length} block(s) in error state
                      </h3>
                      <Button size="sm" variant="outline" onClick={() => retryAll(n.id)}>
                        Retry all now
                      </Button>
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Block hash</TableHead>
                            <TableHead className="text-right">Refcount</TableHead>
                            <TableHead className="text-right">Failures</TableHead>
                            <TableHead>Last attempt</TableHead>
                            <TableHead>Next retry</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {n.blockErrors.slice(0, 20).map((b) => (
                            <TableRow key={b.blockHash}>
                              <TableCell>
                                <MonoId id={b.blockHash} />
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {b.refcount}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {b.errorCount}
                              </TableCell>
                              <TableCell>{formatDuration(b.lastTrySecsAgo)} ago</TableCell>
                              <TableCell>in {formatDuration(b.nextTryInSecs)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {n.blockErrors.length > 20 && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Showing 20 of {n.blockErrors.length} errored blocks.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {n.stats?.tableStats && n.stats.tableStats.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Metadata table queues
                    </summary>
                    <div className="mt-2 overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Table</TableHead>
                            <TableHead className="text-right">Items</TableHead>
                            <TableHead className="text-right">Merkle queue</TableHead>
                            <TableHead className="text-right">Insert queue</TableHead>
                            <TableHead className="text-right">GC queue</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {n.stats.tableStats.map((t) => (
                            <TableRow key={t.tableName}>
                              <TableCell className="font-medium">{t.tableName}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCount(t.items)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCount(t.merkleQueueLen)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCount(t.insertQueueLen)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCount(t.gcQueueLen)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </details>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 flex items-center gap-2">
        <Switch id="error-only" checked={errorOnly} onCheckedChange={setErrorOnly} />
        <Label htmlFor="error-only" className="text-sm text-muted-foreground">
          Only show workers with errors
        </Label>
      </div>
    </div>
  );
}
