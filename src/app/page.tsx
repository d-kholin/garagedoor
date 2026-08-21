"use client";

import { useGarage } from "@/lib/api";
import type {
  ClusterHealth,
  GetClusterStatisticsResponse,
  GetClusterStatusResponse,
  LocalNodeStatistics,
  MultiResponse,
} from "@/lib/garage/types";
import { formatBytes, formatCount, formatDuration } from "@/lib/format";
import {
  ErrorBanner,
  LoadingCards,
  MonoId,
  PageHeader,
  StatCard,
} from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const REFRESH = 5_000;

function healthTone(status?: string): "good" | "warn" | "bad" | "default" {
  if (status === "healthy") return "good";
  if (status === "degraded") return "warn";
  if (status === "unavailable") return "bad";
  return "default";
}

export default function DashboardPage() {
  const health = useGarage<ClusterHealth>("GetClusterHealth", {
    refreshInterval: REFRESH,
  });
  const status = useGarage<GetClusterStatusResponse>("GetClusterStatus", {
    refreshInterval: REFRESH,
  });
  const stats = useGarage<GetClusterStatisticsResponse>("GetClusterStatistics", {
    refreshInterval: 30_000,
  });
  const nodeStats = useGarage<MultiResponse<LocalNodeStatistics>>(
    "GetNodeStatistics",
    { params: { node: "*" }, refreshInterval: REFRESH },
  );

  const h = health.data;
  const totalResyncQueue = Object.values(nodeStats.data?.success ?? {}).reduce(
    (sum, s) => sum + (s.blockManagerStats?.resyncQueueLen ?? 0),
    0,
  );
  const totalResyncErrors = Object.values(nodeStats.data?.success ?? {}).reduce(
    (sum, s) => sum + (s.blockManagerStats?.resyncErrors ?? 0),
    0,
  );

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Cluster health and node overview, refreshed every 5 seconds."
      />
      <ErrorBanner error={health.error} title="Cannot reach Garage admin API" />

      {!h && !health.error ? (
        <LoadingCards />
      ) : h ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Cluster status"
            value={h.status}
            tone={healthTone(h.status)}
            hint={`${h.connectedNodes}/${h.knownNodes} nodes connected`}
          />
          <StatCard
            label="Storage nodes up"
            value={`${h.storageNodesUp} / ${h.storageNodes}`}
            tone={h.storageNodesUp === h.storageNodes ? "good" : "bad"}
          />
          <StatCard
            label="Partitions fully replicated"
            value={`${h.partitionsAllOk} / ${h.partitions}`}
            tone={h.partitionsAllOk === h.partitions ? "good" : "warn"}
            hint={`${h.partitionsQuorum}/${h.partitions} have write quorum`}
          />
          <StatCard
            label="Blocks awaiting resync"
            value={formatCount(totalResyncQueue)}
            tone={totalResyncQueue === 0 ? "good" : "warn"}
            hint={
              totalResyncErrors > 0
                ? `${formatCount(totalResyncErrors)} blocks with resync errors`
                : "across all nodes"
            }
          />
        </div>
      ) : null}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Nodes</CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorBanner error={status.error} />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Node</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead className="min-w-40">Data disk</TableHead>
                  <TableHead className="text-right">Resync queue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(status.data?.nodes ?? []).map((n) => {
                  const dp = n.dataPartition;
                  const usedPct = dp
                    ? Math.round(((dp.total - dp.available) / dp.total) * 100)
                    : null;
                  const ns = nodeStats.data?.success?.[n.id];
                  const nsErr = nodeStats.data?.error?.[n.id];
                  return (
                    <TableRow key={n.id}>
                      <TableCell>
                        <div className="font-medium">{n.hostname ?? "unknown"}</div>
                        <MonoId id={n.id} className="text-muted-foreground" />
                      </TableCell>
                      <TableCell>
                        {n.isUp ? (
                          <Badge className="bg-emerald-600 text-white dark:bg-emerald-500">
                            up
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            down{" "}
                            {n.lastSeenSecsAgo != null &&
                              `(${formatDuration(n.lastSeenSecsAgo)} ago)`}
                          </Badge>
                        )}
                        {n.draining && (
                          <Badge variant="outline" className="ml-1">
                            draining
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{n.role?.zone ?? "—"}</TableCell>
                      <TableCell>
                        {n.role
                          ? n.role.capacity != null
                            ? formatBytes(n.role.capacity)
                            : "gateway"
                          : "no role"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {n.addr ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {n.garageVersion ?? "—"}
                      </TableCell>
                      <TableCell>
                        {dp && usedPct !== null ? (
                          <div className="flex items-center gap-2">
                            <Progress value={usedPct} className="w-24" />
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {usedPct}% of {formatBytes(dp.total)}
                            </span>
                          </div>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {nsErr ? (
                          <span className="text-xs text-red-500">unreachable</span>
                        ) : (
                          formatCount(ns?.blockManagerStats?.resyncQueueLen)
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {stats.data?.freeform && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Cluster statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">
              {stats.data.freeform}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
