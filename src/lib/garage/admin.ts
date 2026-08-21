// Server-side client for the Garage admin API v2.
// The admin token never leaves the server: the browser talks to our
// /api/garage/[endpoint] proxy, which forwards allowlisted calls here.

const ADMIN_ENDPOINT = process.env.GARAGE_ADMIN_ENDPOINT ?? "http://localhost:3903";
const ADMIN_TOKEN = process.env.GARAGE_ADMIN_TOKEN ?? "";

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

  const url = new URL(`/v2/${endpoint}`, ADMIN_ENDPOINT);
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GarageApiError(res.status, text || `${res.status} ${res.statusText}`);
  }

  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return null as T;
  }
  const text = await res.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}
