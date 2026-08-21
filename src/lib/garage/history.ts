// Server-side resync history: samples per-node resync queue/error counts on a
// fixed cadence and persists them in a SQLite database under
// GARAGEDOOR_DATA_DIR (a Docker volume in production), so progress over time
// survives restarts and can be used to estimate time-to-convergence.
// Storage is node:sqlite (built into Node >= 22.13) — no native npm
// dependency, so the Docker build needs no compiler toolchain. On first boot
// with a database missing its data, any legacy resync-history.jsonl is
// imported and then renamed to .migrated.

import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
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
const DB_FILE = path.join(DATA_DIR, "history.db");
const LEGACY_JSONL = path.join(DATA_DIR, "resync-history.jsonl");
const LATEST_FILE = path.join(DATA_DIR, "latest-stats.json");
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

interface SamplerState {
  db: DatabaseSync | null;
  started: boolean;
  samplingPromise: Promise<void> | null;
  /** Full response of the most recent successful pull, served to the UI. */
  latestFull: { ts: number; res: MultiResponse<LocalNodeStatistics> } | null;
}

// Survives HMR / route-module reloads within one server process.
const g = globalThis as unknown as { __garagedoorHistory?: SamplerState };
const state: SamplerState = (g.__garagedoorHistory ??= {
  db: null,
  started: false,
  samplingPromise: null,
  latestFull: null,
});

function openDb(): DatabaseSync {
  if (state.db) return state.db;
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_FILE);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS resync_samples (
      ts     INTEGER NOT NULL,
      node   TEXT    NOT NULL,
      queue  INTEGER,
      errors INTEGER,
      PRIMARY KEY (ts, node)
    ) WITHOUT ROWID;
  `);
  migrateLegacyJsonl(db);
  db.prepare("DELETE FROM resync_samples WHERE ts < ?").run(Date.now() - RETENTION_MS);
  // Restore the last full stats response so a restart serves the UI instantly
  // instead of forcing a live pull on first page load.
  try {
    const latest = JSON.parse(readFileSync(LATEST_FILE, "utf8"));
    if (latest && typeof latest.ts === "number" && latest.res) {
      state.latestFull = latest;
    }
  } catch {
    // no persisted latest yet
  }
  state.db = db;
  return db;
}

/**
 * One-time import of the pre-SQLite JSONL history. Idempotent (INSERT OR
 * IGNORE keyed on ts+node), so a crash between import and rename just
 * re-imports on the next boot; the rename marks completion.
 */
function migrateLegacyJsonl(db: DatabaseSync): void {
  if (!existsSync(LEGACY_JSONL)) return;
  const lines = readFileSync(LEGACY_JSONL, "utf8").split("\n");
  const insert = db.prepare(
    "INSERT OR IGNORE INTO resync_samples (ts, node, queue, errors) VALUES (?, ?, ?, ?)",
  );
  let imported = 0;
  db.exec("BEGIN");
  try {
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const s = JSON.parse(line) as HistorySample;
        if (typeof s.ts !== "number" || !s.q) continue;
        for (const [node, queue] of Object.entries(s.q)) {
          insert.run(s.ts, node, queue, s.e?.[node] ?? null);
        }
        imported++;
      } catch {
        // skip corrupt line (e.g. torn write on crash)
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  renameSync(LEGACY_JSONL, `${LEGACY_JSONL}.migrated`);
  console.log(
    `[history] imported ${imported} JSONL samples into ${DB_FILE}; ` +
      `renamed ${LEGACY_JSONL} -> ${LEGACY_JSONL}.migrated`,
  );
}

async function doSample(): Promise<void> {
  try {
    const res = await garageAdmin<MultiResponse<LocalNodeStatistics>>(
      "GetNodeStatistics",
      { params: { node: "*" } },
    );
    const ts = Date.now();
    state.latestFull = { ts, res };

    const db = openDb();
    const insert = db.prepare(
      "INSERT OR REPLACE INTO resync_samples (ts, node, queue, errors) VALUES (?, ?, ?, ?)",
    );
    db.exec("BEGIN");
    try {
      for (const [id, s] of Object.entries(res.success)) {
        insert.run(
          ts,
          id,
          s.blockManagerStats?.resyncQueueLen ?? 0,
          s.blockManagerStats?.resyncErrors ?? 0,
        );
      }
      for (const id of Object.keys(res.error)) {
        insert.run(ts, id, null, null);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    db.prepare("DELETE FROM resync_samples WHERE ts < ?").run(ts - RETENTION_MS);

    await writeFile(LATEST_FILE, JSON.stringify(state.latestFull));
  } catch (err) {
    // A failed sample is a gap in the series, not a crash.
    console.error("[history] sample failed:", err instanceof Error ? err.message : err);
  }
}

/** Take a sample; concurrent callers share the same in-flight pull. */
function takeSample(): Promise<void> {
  if (!state.samplingPromise) {
    state.samplingPromise = doSample().finally(() => {
      state.samplingPromise = null;
    });
  }
  return state.samplingPromise;
}

/**
 * Latest full node statistics for the UI. Served from the sampler's cache
 * whenever it is younger than the sampling interval; a real pull happens only
 * when the cache is stale, missing, or `forceRefresh` is set (which also
 * contributes an extra history point).
 */
export async function getLatestStats(opts: { forceRefresh?: boolean } = {}): Promise<{
  ts: number;
  res: MultiResponse<LocalNodeStatistics>;
}> {
  startSampler();
  const fresh =
    state.latestFull && Date.now() - state.latestFull.ts < SAMPLE_MS + 60_000;
  if (!opts.forceRefresh && fresh && state.latestFull) return state.latestFull;
  await takeSample();
  if (!state.latestFull) {
    throw new Error("Could not fetch node statistics from the cluster");
  }
  return state.latestFull;
}

export function startSampler(): void {
  if (state.started) return;
  state.started = true;
  try {
    openDb();
  } catch (err) {
    console.error("[history] failed to open history database:", err);
  }
  void takeSample();
  const timer = setInterval(takeSample, SAMPLE_MS);
  // Don't keep the process alive just for sampling.
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  console.log(
    `[history] resync sampler started: every ${SAMPLE_MS / 1000}s -> ${DB_FILE}`,
  );
}

/** Samples within the last `hours`, downsampled to at most `maxPoints`. */
export async function getHistory(hours: number, maxPoints = 600): Promise<HistorySample[]> {
  startSampler();
  const db = openDb();
  const cutoff = Date.now() - hours * 3600 * 1000;
  const rows = db
    .prepare(
      "SELECT ts, node, queue, errors FROM resync_samples WHERE ts >= ? ORDER BY ts",
    )
    .all(cutoff) as unknown as {
    ts: number;
    node: string;
    queue: number | null;
    errors: number | null;
  }[];

  const win: HistorySample[] = [];
  let cur: HistorySample | null = null;
  for (const r of rows) {
    if (!cur || cur.ts !== r.ts) {
      cur = { ts: r.ts, q: {}, e: {} };
      win.push(cur);
    }
    cur.q[r.node] = r.queue;
    cur.e[r.node] = r.errors;
  }

  if (win.length <= maxPoints) return win;
  const stride = Math.ceil(win.length / maxPoints);
  const out: HistorySample[] = [];
  for (let i = 0; i < win.length; i += stride) out.push(win[i]);
  if (out[out.length - 1] !== win[win.length - 1]) out.push(win[win.length - 1]);
  return out;
}
