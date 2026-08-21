"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { garagePost, getFetcher, useGarage, useGaragePost } from "@/lib/api";
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
  PullIndicator,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ServerHistorySample {
  ts: number;
  q: Record<string, number | null>;
  e: Record<string, number | null>;
}

const RANGES = [
  { key: "live", label: "15m live" },
  { key: "1", label: "1h" },
  { key: "6", label: "6h" },
  { key: "24", label: "24h" },
  { key: "168", label: "7d" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

/**
 * Net drain rate (blocks/min) and ETA from persisted history: oldest vs
 * newest sample in the window. Null when there's no net progress.
 */
function convergenceEta(
  samples: ServerHistorySample[] | undefined,
  currentQueue: number,
): { rate: number; etaSecs: number; spanSecs: number } | null {
  if (!samples || samples.length < 2) return null;
  const total = (s: ServerHistorySample) =>
    Object.values(s.q).reduce((a: number, v) => a + (v ?? 0), 0);
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dtMin = (last.ts - first.ts) / 60_000;
  if (dtMin < 2) return null;
  const rate = (total(first) - total(last)) / dtMin;
  if (rate <= 0) return null;
  return { rate, etaSecs: (currentQueue / rate) * 60, spanSecs: dtMin * 60 };
}

// Health/status are cheap; statistics and worker listings do real work on
// every node (can take 30s+ on a loaded cluster), so poll those gently.
// SWR never stacks requests: a poll is skipped while the previous one is
// still in flight.
const REFRESH = 10_000;
const REFRESH_HEAVY = 60_000;

// Resync aggressiveness presets. Tranquility throttles the resync worker
// (sleep = tranquility × duration of last operation, 0 = flat out);
// worker count is the number of parallel resync workers per node (max 8).
const RESYNC_PRESETS = {
  default: { label: "Default", tranquility: "2", workers: "1", hint: "Garage defaults — gentle on live traffic" },
  aggressive: { label: "Aggressive", tranquility: "1", workers: "4", hint: "4 workers, light throttle" },
  maximum: { label: "Maximum", tranquility: "0", workers: "8", hint: "8 workers, no throttle — may impact live traffic" },
} as const;
type PresetKey = keyof typeof RESYNC_PRESETS;

function ResyncSpeedSelector() {
  const vars = useGaragePost<MultiResponse<Record<string, string>>>(
    "GetWorkerVariable",
    { params: { node: "*" }, body: {}, refreshInterval: 30_000 },
  );
  const [busy, setBusy] = useState(false);

  // Which preset matches the cluster's current settings; "custom" when nodes
  // disagree or values match no preset.
  const current: PresetKey | "custom" | null = useMemo(() => {
    const nodes = Object.values(vars.data?.success ?? {});
    if (nodes.length === 0) return null;
    const tranq = new Set(nodes.map((v) => v["resync-tranquility"]));
    const workers = new Set(nodes.map((v) => v["resync-worker-count"]));
    if (tranq.size !== 1 || workers.size !== 1) return "custom";
    const t = [...tranq][0];
    const w = [...workers][0];
    const match = (Object.entries(RESYNC_PRESETS) as [PresetKey, (typeof RESYNC_PRESETS)[PresetKey]][]).find(
      ([, p]) => p.tranquility === t && p.workers === w,
    );
    return match ? match[0] : "custom";
  }, [vars.data]);

  async function apply(preset: PresetKey) {
    const p = RESYNC_PRESETS[preset];
    setBusy(true);
    try {
      await garagePost("SetWorkerVariable", {
        params: { node: "*" },
        body: { variable: "resync-tranquility", value: p.tranquility },
      });
      await garagePost("SetWorkerVariable", {
        params: { node: "*" },
        body: { variable: "resync-worker-count", value: p.workers },
      });
      toast.success(
        `Resync speed set to ${p.label} on all nodes (tranquility ${p.tranquility}, ${p.workers} worker${p.workers === "1" ? "" : "s"})`,
      );
      vars.mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Label className="text-sm text-muted-foreground">Resync speed</Label>
      <Select
        value={current === "custom" || current === null ? "" : current}
        onValueChange={(v) => v && apply(v as PresetKey)}
      >
        <SelectTrigger className="w-36" disabled={busy || !vars.data}>
          <SelectValue
            placeholder={current === "custom" ? "Custom" : "…"}
          />
        </SelectTrigger>
        <SelectContent>
          {(Object.entries(RESYNC_PRESETS) as [PresetKey, (typeof RESYNC_PRESETS)[PresetKey]][]).map(
            ([key, p]) => (
              <SelectItem key={key} value={key}>
                <div>
                  <div>{p.label}</div>
                  <div className="text-xs text-muted-foreground">{p.hint}</div>
                </div>
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

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
  // Node statistics come from the server's sampler cache — a page load or
  // poll never triggers a pull against the cluster; a real pull happens only
  // when the cache outlives the sampling interval or via "Pull fresh".
  const nodeStats = useSWR<{ ts: number; data: MultiResponse<LocalNodeStatistics> }>(
    "/api/stats/nodes",
    getFetcher,
    { refreshInterval: REFRESH_HEAVY, keepPreviousData: true, revalidateOnFocus: false },
  );
  const nodeStatsData = nodeStats.data?.data;
  const [pullingFresh, setPullingFresh] = useState(false);
  async function pullFreshStats() {
    setPullingFresh(true);
    try {
      const fresh = await getFetcher<{ ts: number; data: MultiResponse<LocalNodeStatistics> }>(
        "/api/stats/nodes?refresh=true",
      );
      nodeStats.mutate(fresh, { revalidate: false });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPullingFresh(false);
    }
  }
  const workers = useGaragePost<MultiResponse<WorkerInfo[]>>("ListWorkers", {
    params: { node: "*" },
    body: { busyOnly: false, errorOnly },
    refreshInterval: REFRESH_HEAVY,
  });
  // Errored-block details are load-on-demand only: ListBlockErrors returns
  // EVERY errored block (potentially millions on a recovering cluster) and
  // must never be polled automatically.
  const [blockErrorsByNode, setBlockErrorsByNode] = useState<
    Record<string, BlockError[]>
  >({});
  const [loadingErrorsFor, setLoadingErrorsFor] = useState<string | null>(null);
  async function loadBlockErrors(nodeId: string) {
    setLoadingErrorsFor(nodeId);
    try {
      const res = await getFetcher<MultiResponse<BlockError[]>>(
        `/api/garage/ListBlockErrors?node=${nodeId}`,
      );
      setBlockErrorsByNode((m) => ({ ...m, [nodeId]: res.success?.[nodeId] ?? [] }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingErrorsFor(null);
    }
  }

  const statsUpdatedAt = nodeStats.data?.ts ?? null;

  // Rolling per-node queue history for the chart (null = unreachable).
  const latestReading = useMemo(() => {
    if (!nodeStatsData) return null;
    const values: Record<string, number | null> = {};
    for (const [id, s] of Object.entries(nodeStatsData.success)) {
      values[id] = s.blockManagerStats?.resyncQueueLen ?? 0;
    }
    for (const id of Object.keys(nodeStatsData.error)) {
      values[id] = null;
    }
    return values;
  }, [nodeStatsData]);
  const history = useResyncHistory(latestReading);
  const rate = drainRate(history);

  // Persisted server-side history: powers the longer chart ranges and the
  // convergence ETA (1h window is a stabler basis than the live 90s rate).
  const [range, setRange] = useState<RangeKey>("live");
  const serverHistory = useSWR<{ samples: ServerHistorySample[] }>(
    range === "live" ? null : `/api/history/resync?hours=${range}`,
    getFetcher,
    { refreshInterval: 60_000, keepPreviousData: true, revalidateOnFocus: false },
  );
  const etaHistory = useSWR<{ samples: ServerHistorySample[] }>(
    "/api/history/resync?hours=12",
    getFetcher,
    { refreshInterval: 60_000, keepPreviousData: true, revalidateOnFocus: false },
  );

  const chartHistory = useMemo(() => {
    if (range === "live") return history;
    return (serverHistory.data?.samples ?? []).map((s) => ({
      ts: s.ts,
      values: s.q,
    }));
  }, [range, history, serverHistory.data]);

  const perNode = useMemo(() => {
    const ids = new Set<string>([
      ...Object.keys(nodeStatsData?.success ?? {}),
      ...Object.keys(nodeStatsData?.error ?? {}),
      ...Object.keys(workers.data?.success ?? {}),
    ]);
    return [...ids].sort().map((id) => ({
      id,
      stats: nodeStatsData?.success?.[id],
      statsError: nodeStatsData?.error?.[id],
      workers: workers.data?.success?.[id] ?? [],
      blockErrors: blockErrorsByNode[id],
    }));
  }, [nodeStatsData, workers.data, blockErrorsByNode]);

  const totals = useMemo(() => {
    let queue = 0;
    let errors = 0;
    for (const n of perNode) {
      queue += n.stats?.blockManagerStats?.resyncQueueLen ?? 0;
      errors += n.stats?.blockManagerStats?.resyncErrors ?? 0;
    }
    return { queue, errors };
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
      if (node !== "*") loadBlockErrors(node);
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
        <PullIndicator
          updating={pullingFresh || nodeStats.isLoading || workers.isValidating}
          lastUpdated={statsUpdatedAt}
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={pullingFresh}
          title="Pull node statistics from the cluster right now (bypasses the sampler cache; can take a while)"
          onClick={pullFreshStats}
        >
          <RefreshCw className={pullingFresh ? "animate-spin" : undefined} />
          Pull fresh
        </Button>
        <ResyncSpeedSelector />
        <Button variant="outline" disabled={forcing} onClick={() => forceResync("*")}>
          <RefreshCw className={forcing ? "animate-spin" : undefined} />
          Force resync (all nodes)
        </Button>
      </PageHeader>
      <ErrorBanner error={health.error ?? nodeStats.error ?? workers.error} />

      {!nodeStats.data && !nodeStats.error ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Pulling statistics from every node — on a large cluster this can take a
            minute or more.
          </p>
          <LoadingCards />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Blocks awaiting resync"
            value={formatCount(totals.queue)}
            tone={totals.queue === 0 ? "good" : "warn"}
            hint={
              totals.queue > 0
                ? `≤ ${formatBytes(totals.queue * 1024 * 1024)} at 1 MiB max block size` +
                  (rate ? ` · draining ${Math.round(rate)}/min now` : "")
                : "sum of all node resync queues"
            }
          />
          {(() => {
            const eta = convergenceEta(etaHistory.data?.samples, totals.queue);
            return (
              <StatCard
                label="Convergence ETA"
                value={
                  totals.queue === 0
                    ? "converged"
                    : eta
                      ? `~${formatDuration(eta.etaSecs)}`
                      : "—"
                }
                tone={totals.queue === 0 ? "good" : eta ? "default" : "warn"}
                hint={
                  totals.queue === 0
                    ? "all resync queues empty"
                    : eta
                      ? `at ${formatCount(Math.round(eta.rate))} blocks/min (avg over ${formatDuration(eta.spanSecs)})`
                      : "no net drain measured yet"
                }
              />
            );
          })()}
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Resync queue over time</CardTitle>
            <Tabs value={range} onValueChange={(v) => setRange(v as RangeKey)}>
              <TabsList>
                {RANGES.map((r) => (
                  <TabsTrigger key={r.key} value={r.key}>
                    {r.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          {range !== "live" && serverHistory.data?.samples.length === 0 && (
            <p className="mb-2 text-xs text-muted-foreground">
              No persisted samples in this window yet — the server records one sample
              per minute while Garagedoor is running.
            </p>
          )}
          <ResyncChart
            history={chartHistory}
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

                {(bm?.resyncErrors ?? 0) > 0 && !n.blockErrors && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-red-500">
                      {formatCount(bm?.resyncErrors)} block(s) in error state
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={loadingErrorsFor === n.id}
                      onClick={() => loadBlockErrors(n.id)}
                    >
                      {loadingErrorsFor === n.id ? "Loading…" : "Load details"}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      fetches the full error list from this node — can be slow when
                      the count is large
                    </span>
                  </div>
                )}

                {n.blockErrors && n.blockErrors.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-medium text-red-500">
                        {formatCount(n.blockErrors.length)} block(s) in error state
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
