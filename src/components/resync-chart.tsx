"use client";

// Multi-series line chart of per-node resync queue lengths, fed from the
// server's persisted history samples.
// Colors come from the validated .viz-root palette in globals.css; series
// identity is never color-alone (legend + direct end-labels).

import { useMemo, useRef, useState } from "react";
import { formatCount } from "@/lib/format";

export interface ResyncSample {
  ts: number;
  /** node id -> queue length, or null when the node was unreachable */
  values: Record<string, number | null>;
}

const MAX_SERIES = 8;

// Axis ticks are always 1/2/5 multiples (see niceTicks), so one decimal is
// exact: 2,500,000 -> "2.5M". Full numbers stay in the tooltip/legend.
function compactCount(n: number): string {
  const trim = (v: number) => String(parseFloat(v.toFixed(1)));
  if (n >= 1e9) return `${trim(n / 1e9)}B`;
  if (n >= 1e6) return `${trim(n / 1e6)}M`;
  if (n >= 1e4) return `${trim(n / 1e3)}k`;
  return n.toLocaleString("en-US");
}

function timeLabel(ts: number) {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const top = Math.ceil(max / step - 0.001) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step * 0.001; v += step) ticks.push(v);
  return ticks;
}

export function ResyncChart({
  history,
  nodeLabels,
}: {
  history: ResyncSample[];
  nodeLabels: Record<string, string>;
}) {
  const [hover, setHover] = useState<number | null>(null); // sample index
  const svgRef = useRef<SVGSVGElement>(null);

  const W = 800;
  const H = 220;

  const { seriesIds, tMin, tMax, yMax, ticks } = useMemo(() => {
    const ids = [...new Set(history.flatMap((s) => Object.keys(s.values)))]
      .sort()
      .slice(0, MAX_SERIES);
    const tMin = history[0]?.ts ?? 0;
    const tMax = history[history.length - 1]?.ts ?? 1;
    const peak = Math.max(
      4,
      ...history.flatMap((s) => ids.map((id) => s.values[id] ?? 0)),
    );
    const ticks = niceTicks(peak);
    return { seriesIds: ids, tMin, tMax, yMax: ticks[ticks.length - 1] || peak, ticks };
  }, [history]);

  // Right gutter sized to the longest end-label so names never fall off the
  // edge, capped so a long hostname can't eat the plot (past the cap labels
  // are ellipsized; the legend below always carries the full name). Widths
  // are estimated per glyph (10px sans in an 800-unit viewBox) with slack —
  // no DOM measurement needed, and pad + clip share the same estimate so
  // they can't disagree. 18 covers the dot marker + gaps.
  const seriesLabel = (id: string) => nodeLabels[id] ?? id.slice(0, 8);
  const textWidth = (s: string) => {
    let w = 0;
    for (const c of s) {
      if (/[ilIjft.,:()' ]/.test(c)) w += 3.2;
      else if (/[mwMW]/.test(c)) w += 9;
      else if (/[A-Z0-9]/.test(c)) w += 6.5;
      else w += 5.8;
    }
    return w * 1.08;
  };
  const MAX_LABEL_PX = 150;
  const clipLabel = (s: string) => {
    if (textWidth(s) <= MAX_LABEL_PX) return s;
    let out = "";
    for (const c of s) {
      if (textWidth(`${out}${c}…`) > MAX_LABEL_PX) break;
      out += c;
    }
    return `${out}…`;
  };
  const gutter = Math.max(
    24,
    ...seriesIds.map((id) => textWidth(clipLabel(seriesLabel(id)))),
  );
  const PAD = { top: 12, right: 18 + gutter, bottom: 24, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  if (history.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Not enough samples in this range yet.
      </div>
    );
  }

  const x = (ts: number) =>
    PAD.left + (tMax === tMin ? 0 : ((ts - tMin) / (tMax - tMin)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  const paths = seriesIds.map((id, i) => {
    let d = "";
    let pen = false;
    for (const s of history) {
      const v = s.values[id];
      if (v === null || v === undefined) {
        pen = false; // gap when the node was unreachable
        continue;
      }
      d += `${pen ? "L" : "M"}${x(s.ts).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return { id, d, slot: (i % MAX_SERIES) + 1 };
  });

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const ts = tMin + ((px - PAD.left) / plotW) * (tMax - tMin);
    let best = 0;
    let bestDist = Infinity;
    history.forEach((s, i) => {
      const dist = Math.abs(s.ts - ts);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    setHover(best);
  }

  const hoverSample = hover !== null ? history[hover] : null;
  // Direct end-labels: last non-null value per series, nudged apart vertically.
  const endLabels = paths
    .map((p) => {
      const lastVal = [...history].reverse().find((s) => s.values[p.id] != null);
      const v = lastVal?.values[p.id];
      return v === null || v === undefined
        ? null
        : { ...p, value: v, ly: y(v) };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < endLabels.length; i++) {
    if (endLabels[i].ly - endLabels[i - 1].ly < 14) {
      endLabels[i].ly = endLabels[i - 1].ly + 14;
    }
  }

  return (
    <div className="viz-root">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Resync queue length per node over time"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* gridlines + y ticks */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--viz-grid)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y(t) + 3.5}
              textAnchor="end"
              fontSize={10}
              fill="var(--viz-muted)"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {compactCount(t)}
            </text>
          </g>
        ))}
        {/* x labels: start, middle, end */}
        {[tMin, (tMin + tMax) / 2, tMax].map((t, i) => (
          <text
            key={i}
            x={x(t)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
            fontSize={10}
            fill="var(--viz-muted)"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {timeLabel(t)}
          </text>
        ))}
        {/* baseline */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--viz-axis)"
          strokeWidth={1}
        />
        {/* series */}
        {paths.map((p) => (
          <path
            key={p.id}
            d={p.d}
            fill="none"
            stroke={`var(--viz-series-${p.slot})`}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {/* direct end-labels */}
        {endLabels.map((p) => (
          <text key={p.id} x={W - PAD.right + 6} y={p.ly + 3.5} fontSize={10}>
            <tspan fill={`var(--viz-series-${p.slot})`}>●</tspan>
            <tspan dx={3} fill="var(--viz-muted)">
              {clipLabel(seriesLabel(p.id))}
            </tspan>
          </text>
        ))}
        {/* crosshair + hover dots */}
        {hoverSample && (
          <g pointerEvents="none">
            <line
              x1={x(hoverSample.ts)}
              x2={x(hoverSample.ts)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--viz-muted)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            {paths.map((p) => {
              const v = hoverSample.values[p.id];
              if (v === null || v === undefined) return null;
              return (
                <circle
                  key={p.id}
                  cx={x(hoverSample.ts)}
                  cy={y(v)}
                  r={4}
                  fill={`var(--viz-series-${p.slot})`}
                  stroke="var(--background)"
                  strokeWidth={2}
                />
              );
            })}
          </g>
        )}
      </svg>

      {/* tooltip (HTML, below chart to avoid SVG text layout pain) */}
      <div className="mt-2 flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {hoverSample ? (
          <>
            <span
              className="text-muted-foreground"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {timeLabel(hoverSample.ts)}
            </span>
            {paths.map((p) => (
              <span key={p.id} className="flex items-center gap-1.5">
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ background: `var(--viz-series-${p.slot})` }}
                />
                <span className="text-muted-foreground">
                  {seriesLabel(p.id)}
                </span>
                <span className="font-medium tabular-nums">
                  {hoverSample.values[p.id] === null ||
                  hoverSample.values[p.id] === undefined
                    ? "unreachable"
                    : formatCount(hoverSample.values[p.id])}
                </span>
              </span>
            ))}
          </>
        ) : (
          /* legend (always present for ≥2 series) */
          paths.map((p) => (
            <span key={p.id} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: `var(--viz-series-${p.slot})` }}
              />
              <span className="text-muted-foreground">
                {seriesLabel(p.id)}
              </span>
            </span>
          ))
        )}
      </div>
    </div>
  );
}
