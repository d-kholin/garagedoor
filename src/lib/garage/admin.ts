// Server-side client for the Garage admin API v2.
// The admin token never leaves the server: the browser talks to our
// /api/garage/[endpoint] proxy, which forwards allowlisted calls here.

const ADMIN_ENDPOINT = process.env.GARAGE_ADMIN_ENDPOINT ?? "http://localhost:3903";
const ADMIN_TOKEN = process.env.GARAGE_ADMIN_TOKEN ?? "";
// Cap on any single admin API call. Multi-node fan-outs can hang for a long
// time while Garage's RPCs to a freshly-dead node time out; failing fast keeps
// the UI updating (it shows an error + last-known data instead of stalling).
const ADMIN_TIMEOUT_MS = parseInt(process.env.GARAGE_ADMIN_TIMEOUT_MS ?? "8000", 10);
// Statistics/worker endpoints do real work per node (`garage stats` can take
// 30s+ on a loaded cluster) — give them a much longer leash.
const ADMIN_SLOW_TIMEOUT_MS = parseInt(
  process.env.GARAGE_ADMIN_SLOW_TIMEOUT_MS ?? "60000",
  10,
);
const SLOW_ENDPOINTS = new Set([
  "GetNodeStatistics",
  "GetClusterStatistics",
  "ListWorkers",
  "GetWorkerInfo",
  "ListBlockErrors",
  "LaunchRepairOperation",
]);

// When true, the proxy refuses every mutating endpoint — the whole app
// becomes a pure dashboard, enforced server-side.
export const READ_ONLY =
  (process.env.GARAGEDOOR_READ_ONLY ?? "").toLowerCase() === "true" ||
  process.env.GARAGEDOOR_READ_ONLY === "1";

/** POST endpoints that only read state — allowed even in read-only mode. */
const READONLY_POSTS = new Set([
  "ListWorkers",
  "GetWorkerInfo",
  "GetWorkerVariable",
  "GetBlockInfo",
  "PreviewClusterLayoutChanges",
]);

export function isMutating(endpoint: string): boolean {
  return ALLOWED_ENDPOINTS[endpoint] === "POST" && !READONLY_POSTS.has(endpoint);
}

type Method = "GET" | "POST";

/**
 * Endpoints the UI is allowed to reach, mapped to their HTTP method.
 * Deliberately excluded: PurgeBlocks (permanently deletes object data),
 * CreateMetadataSnapshot, and all admin-token management endpoints.
 */
export const ALLOWED_ENDPOINTS: Record<string, Method> = {
  // Cluster
  GetClusterHealth: "GET",
  GetClusterStatus: "GET",
  GetClusterStatistics: "GET",
  GetNodeInfo: "GET",
  GetNodeStatistics: "GET",
  ConnectClusterNodes: "POST",

  // Layout
  GetClusterLayout: "GET",
  GetClusterLayoutHistory: "GET",
  PreviewClusterLayoutChanges: "POST",
  UpdateClusterLayout: "POST",
  ApplyClusterLayout: "POST",
  RevertClusterLayout: "POST",
  ClusterLayoutSkipDeadNodes: "POST",

  // Workers / resync
  ListWorkers: "POST",
  GetWorkerInfo: "POST",
  GetWorkerVariable: "POST",
  SetWorkerVariable: "POST",
  ListBlockErrors: "GET",
  RetryBlockResync: "POST",
  LaunchRepairOperation: "POST",

  // Buckets
  ListBuckets: "GET",
  GetBucketInfo: "GET",
  CreateBucket: "POST",
  UpdateBucket: "POST",
  DeleteBucket: "POST",
  AddBucketAlias: "POST",
  RemoveBucketAlias: "POST",
  CleanupIncompleteUploads: "POST",
  InspectObject: "GET",

  // Keys
  ListKeys: "GET",
  GetKeyInfo: "GET",
  CreateKey: "POST",
  ImportKey: "POST",
  UpdateKey: "POST",
  DeleteKey: "POST",
  AllowBucketKey: "POST",
  DenyBucketKey: "POST",
};

export class GarageApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "GarageApiError";
  }
}

export async function garageAdmin<T = unknown>(
  endpoint: string,
  opts: {
    params?: Record<string, string | undefined>;
    body?: unknown;
  } = {},
): Promise<T> {
  const method = ALLOWED_ENDPOINTS[endpoint];
  if (!method) {
    throw new GarageApiError(403, `Endpoint not allowed: ${endpoint}`);
  }
  if (READ_ONLY && isMutating(endpoint)) {
    throw new GarageApiError(
      403,
      `Read-only mode: ${endpoint} is disabled (GARAGEDOOR_READ_ONLY is set)`,
    );
  }
  const timeoutMs = SLOW_ENDPOINTS.has(endpoint)
    ? ADMIN_SLOW_TIMEOUT_MS
    : ADMIN_TIMEOUT_MS;

  // Append to the endpoint rather than using new URL(path, base), which would
  // drop any path prefix (e.g. a reverse proxy serving Garage under /garage).
  const url = new URL(`${ADMIN_ENDPOINT.replace(/\/+$/, "")}/v2/${endpoint}`);
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new GarageApiError(
        504,
        `Garage admin API did not answer ${endpoint} within ${timeoutMs}ms ` +
          "(a node may have just gone down; showing last-known data)",
      );
    }
    throw e;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GarageApiError(res.status, text || `${res.status} ${res.statusText}`);
  }

  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return null as T;
  }
  const text = await res.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    const looksLikeHtml = /^\s*</.test(text);
    throw new GarageApiError(
      502,
      looksLikeHtml
        ? "The configured GARAGE_ADMIN_ENDPOINT returned an HTML page instead of JSON. " +
          "This usually means the URL points at a website, reverse-proxy fallback, or " +
          "login page rather than the Garage admin API (default port 3903)."
        : `Garage admin API returned a non-JSON response for ${endpoint}`,
    );
  }
}
