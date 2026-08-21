"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  return (
    <Card>
      <CardContent>
        <div className="text-sm text-muted-foreground">{label}</div>
        <div
          className={cn(
            "mt-1 text-2xl font-semibold tabular-nums",
            tone === "good" && "text-emerald-600 dark:text-emerald-400",
            tone === "warn" && "text-amber-600 dark:text-amber-400",
            tone === "bad" && "text-red-600 dark:text-red-400",
          )}
        >
          {value}
        </div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export function ErrorBanner({ error, title }: { error: unknown; title?: string }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <Alert variant="destructive" className="mb-4">
      <AlertCircle />
      <AlertTitle>{title ?? "Request failed"}</AlertTitle>
      <AlertDescription className="break-all">{message}</AlertDescription>
    </Alert>
  );
}

export function LoadingCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-28 rounded-xl" />
      ))}
    </div>
  );
}

/**
 * Live-fetch status line: spinner + label while a lookup is in flight,
 * otherwise when the data was last updated. Meant for slow per-node
 * statistics pulls that can take a minute or more on large clusters.
 */
export function PullIndicator({
  updating,
  lastUpdated,
  label = "node statistics",
}: {
  updating: boolean;
  lastUpdated: number | null;
  label?: string;
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {updating ? (
        <>
          <Loader2 className="size-3.5 animate-spin" />
          pulling {label}…
        </>
      ) : lastUpdated ? (
        <>
          updated{" "}
          {new Date(lastUpdated).toLocaleTimeString("en-US", { hour12: false })}
        </>
      ) : null}
    </span>
  );
}

export function MonoId({ id, className }: { id: string; className?: string }) {
  return (
    <span className={cn("font-mono text-xs", className)} title={id}>
      {id.length > 16 ? `${id.slice(0, 16)}…` : id}
    </span>
  );
}
