// Server-side resync history: samples per-node resync queue/error counts on a
// fixed cadence and persists them as JSONL under GARAGEDOOR_DATA_DIR (a Docker
// volume in production), so progress over time survives restarts and can be
// used to estimate time-to-convergence.

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { garageAdmin } from "./admin";
import type { LocalNodeStatistics, MultiResponse } from "./types";

export interface HistorySample {
  ts: number;
  /** node id -> resync queue length (null = node unreachable at sample time) */
  q: Record<string, number | null>;
  /** node id -> resync error count */
  e: Record<string, number | null>;
}

const DATA_DIR = process.env.GARAGEDOOR_DATA_DIR ?? "./data";
const FILE = path.join(DATA_DIR, "resync-history.jsonl");
// Default 30 minutes: GetNodeStatistics does real work on every node, so the
// background sampler must stay light on production clusters. Lower it (e.g.
// 60000) for dev clusters where stats are instant.
const SAMPLE_MS = Math.max(
  15_000,
  parseInt(process.env.GARAGEDOOR_SAMPLE_INTERVAL_MS ?? "1800000", 10),
);
const RETENTION_MS =
  Math.max(1, parseInt(process.env.GARAGEDOOR_HISTORY_RETENTION_DAYS ?? "30", 10)) *
  24 * 3600 * 1000;
const COMPACT_EVERY_MS = 24 * 3600 * 1000;

interface SamplerState {
  samples: HistorySample[];
  started: boolean;
  sampling: boolean;
  loaded: Promise<void> | null;
  lastCompact: number;
}

// Survives HMR / route-module reloads within one server process.
const g = globalThis as unknown as { __garagedoorHistory?: SamplerState };
const state: SamplerState = (g.__garagedoorHistory ??= {
  samples: [],
  started: false,
  sampling: false,
  loaded: null,
  lastCompact: 0,
});

async function loadFromDisk(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  let lines: string[] = [];
  try {
    lines = (await readFile(FILE, "utf8")).split("\n");
  } catch {
    // no history file yet
  }
  const cutoff = Date.now() - RETENTION_MS;
  const samples: HistorySample[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const s = JSON.parse(line) as HistorySample;
      if (typeof s.ts === "number" && s.ts >= cutoff) samples.push(s);
    } catch {
      // skip corrupt line (e.g. torn write on crash)
    }
  }
  samples.sort((a, b) => a.ts - b.ts);
  state.samples = samples;
  await compact();
}

/** Rewrite the file with only retained samples (drops expired + corrupt lines). */
async function compact(): Promise<void> {
  const body = state.samples.map((s) => JSON.stringify(s)).join("\n");
  await writeFile(FILE, body ? body + "\n" : "");
  state.lastCompact = Date.now();
}

async function takeSample(): Promise<void> {
  if (state.sampling) return; // never overlap slow pulls
  state.sampling = true;
  try {
    const res = await garageAdmin<MultiResponse<LocalNodeStatistics>>(
      "GetNodeStatistics",
      { params: { node: "*" } },
    );
    const q: Record<string, number | null> = {};
    const e: Record<string, number | null> = {};
    for (const [id, s] of Object.entries(res.success)) {
      q[id] = s.blockManagerStats?.resyncQueueLen ?? 0;
      e[id] = s.blockManagerStats?.resyncErrors ?? 0;
    }
    for (const id of Object.keys(res.error)) {
      q[id] = null;
      e[id] = null;
    }
    const sample: HistorySample = { ts: Date.now(), q, e };

    const cutoff = Date.now() - RETENTION_MS;
    state.samples.push(sample);
    while (state.samples.length && state.samples[0].ts < cutoff) state.samples.shift();

    await appendFile(FILE, JSON.stringify(sample) + "\n");
    if (Date.now() - state.lastCompact > COMPACT_EVERY_MS) await compact();
  } catch (err) {
    // A failed sample is a gap in the series, not a crash.
    console.error("[history] sample failed:", err instanceof Error ? err.message : err);
  } finally {
    state.sampling = false;
  }
}

export function startSampler(): void {
  if (state.started) return;
  state.started = true;
  state.loaded = loadFromDisk().catch((err) => {
    console.error("[history] failed to load history file:", err);
  });
  void state.loaded.then(() => takeSample());
  const timer = setInterval(takeSample, SAMPLE_MS);
  // Don't keep the process alive just for sampling.
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  console.log(
    `[history] resync sampler started: every ${SAMPLE_MS / 1000}s -> ${FILE}`,
  );
}

/** Samples within the last `hours`, downsampled to at most `maxPoints`. */
export async function getHistory(hours: number, maxPoints = 600): Promise<HistorySample[]> {
  startSampler();
  if (state.loaded) await state.loaded;
  const cutoff = Date.now() - hours * 3600 * 1000;
  const win = state.samples.filter((s) => s.ts >= cutoff);
  if (win.length <= maxPoints) return win;
  const stride = Math.ceil(win.length / maxPoints);
  const out: HistorySample[] = [];
  for (let i = 0; i < win.length; i += stride) out.push(win[i]);
  if (out[out.length - 1] !== win[win.length - 1]) out.push(win[win.length - 1]);
  return out;
}
