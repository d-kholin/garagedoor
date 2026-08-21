// Types for the subset of the Garage admin API v2 used by this UI.
// Reference: https://garagehq.deuxfleurs.fr/api/garage-admin-v2.json

/** Multi-node endpoints return per-node maps keyed by node id. */
export interface MultiResponse<T> {
  success: Record<string, T>;
  error: Record<string, string>;
}

// ---------- Cluster ----------

export interface ClusterHealth {
  status: "healthy" | "degraded" | "unavailable";
  knownNodes: number;
  connectedNodes: number;
  storageNodes: number;
  storageNodesUp: number;
  partitions: number;
  partitionsQuorum: number;
  partitionsAllOk: number;
}

export interface DataPartition {
  available: number;
  total: number;
}

export interface NodeResp {
  id: string;
  isUp: boolean;
  draining: boolean;
  addr?: string | null;
  hostname?: string | null;
  garageVersion?: string | null;
  lastSeenSecsAgo?: number | null;
  dataPartition?: DataPartition | null;
  metadataPartition?: DataPartition | null;
  role?: NodeAssignedRole | null;
}

export interface NodeAssignedRole {
  id?: string;
  zone: string;
  capacity: number | null;
  tags: string[];
}

export interface GetClusterStatusResponse {
  layoutVersion: number;
  nodes: NodeResp[];
}

export interface GetClusterStatisticsResponse {
  freeform: string;
}

// ---------- Node statistics / workers ----------

export interface NodeBlockManagerStats {
  rcEntries: number;
  resyncQueueLen: number;
  resyncErrors: number;
}

export interface NodeTableStats {
  tableName: string;
  items: number;
  merkleItems: number;
  merkleQueueLen: number;
  insertQueueLen: number;
  gcQueueLen: number;
}

export interface LocalNodeStatistics {
  freeform: string;
  blockManagerStats?: NodeBlockManagerStats | null;
  tableStats?: NodeTableStats[] | null;
}

export type WorkerState = "busy" | "idle" | "done" | { throttled: { durationSecs: number } };

export interface WorkerInfo {
  id: number;
  name: string;
  state: WorkerState;
  errors: number;
  consecutiveErrors: number;
  lastError?: { message: string; secsAgo: number } | null;
  persistentErrors?: number | null;
  progress?: string | null;
  queueLength?: number | null;
  tranquility?: number | null;
  freeform: string[];
}

export interface BlockError {
  blockHash: string;
  refcount: number;
  errorCount: number;
  lastTrySecsAgo: number;
  nextTryInSecs: number;
}

export interface LocalGetNodeInfoResponse {
  nodeId: string;
  garageVersion: string;
  rustVersion: string;
  dbEngine: string;
  garageFeatures?: string[] | null;
}

// ---------- Buckets ----------

export interface ApiBucketQuotas {
  maxSize?: number | null;
  maxObjects?: number | null;
}

export interface GetBucketInfoWebsiteResponse {
  indexDocument: string;
  errorDocument?: string | null;
}

export interface ApiBucketKeyPerm {
  read?: boolean;
  write?: boolean;
  owner?: boolean;
}

export interface GetBucketInfoKey {
  accessKeyId: string;
  name: string;
  permissions: ApiBucketKeyPerm;
  bucketLocalAliases: string[];
}

export interface GetBucketInfoResponse {
  id: string;
  created: string;
  globalAliases: string[];
  websiteAccess: boolean;
  websiteConfig?: GetBucketInfoWebsiteResponse | null;
  keys: GetBucketInfoKey[];
  objects: number;
  bytes: number;
  unfinishedUploads: number;
  unfinishedMultipartUploads: number;
  unfinishedMultipartUploadParts: number;
  unfinishedMultipartUploadBytes: number;
  quotas: ApiBucketQuotas;
}

export type ListBucketsResponse = {
  id: string;
  created: string;
  globalAliases: string[];
  localAliases: { accessKeyId: string; alias: string }[];
}[];

// ---------- Keys ----------

export interface KeyPerm {
  createBucket?: boolean;
}

export interface KeyInfoBucketResponse {
  id: string;
  globalAliases: string[];
  localAliases: string[];
  permissions: ApiBucketKeyPerm;
}

export interface GetKeyInfoResponse {
  accessKeyId: string;
  name: string;
  created?: string | null;
  expiration?: string | null;
  expired: boolean;
  secretAccessKey?: string | null;
  permissions: KeyPerm;
  buckets: KeyInfoBucketResponse[];
}

export type ListKeysResponse = {
  id: string;
  name: string;
  created?: string | null;
  expiration?: string | null;
  expired: boolean;
}[];

// ---------- Layout ----------

export type NodeRoleChange =
  | { id: string; remove: true }
  | ({ id: string } & NodeAssignedRole);

export interface LayoutParameters {
  zoneRedundancy: "maximum" | { atLeast: number };
}

export interface GetClusterLayoutResponse {
  version: number;
  roles: (NodeAssignedRole & { id: string; storedPartitions?: number | null; usableCapacity?: number | null })[];
  partitionSize: number;
  parameters: LayoutParameters;
  stagedRoleChanges: NodeRoleChange[];
  stagedParameters?: LayoutParameters | null;
}

export interface PreviewClusterLayoutChangesResponse {
  message?: string[];
  newLayout?: GetClusterLayoutResponse;
  error?: string;
}

// ---------- Object browser (server-side S3 proxy) ----------

export interface BrowseObject {
  key: string;
  size: number;
  lastModified: string;
  etag?: string;
}

export interface BrowseListResponse {
  prefix: string;
  delimiter: string;
  commonPrefixes: string[];
  objects: BrowseObject[];
  isTruncated: boolean;
  nextContinuationToken?: string;
}

// ---------- Object inspection ----------

export interface InspectObjectVersion {
  uuid: string;
  timestamp: string;
  encrypted: boolean;
  uploading: boolean;
  aborted: boolean;
  deleteMarker: boolean;
  inline: boolean;
  size?: number | null;
  etag?: string | null;
  headers: [string, string][];
  blocks: {
    partNumber: number;
    offset: number;
    hash: string;
    size: number;
  }[];
}

export interface InspectObjectResponse {
  bucketId: string;
  key: string;
  versions: InspectObjectVersion[];
}
