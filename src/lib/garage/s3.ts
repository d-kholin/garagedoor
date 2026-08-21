// Read-only S3 access for the object browser.
//
// Rather than requiring manually-configured S3 credentials, we provision a
// dedicated key ("garagedoor-browse") through the admin API and grant it
// READ-ONLY access to buckets on demand. The only S3 operations implemented
// are ListObjectsV2 and GetObject — there is intentionally no code path that
// can write or delete objects.

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { garageAdmin } from "./admin";
import type { GetKeyInfoResponse, ListKeysResponse } from "./types";

const S3_ENDPOINT = process.env.GARAGE_S3_ENDPOINT ?? "http://localhost:3900";
const S3_REGION = process.env.GARAGE_S3_REGION ?? "garage";
export const BROWSE_KEY_NAME = "garagedoor-browse";

let cachedCreds: { accessKeyId: string; secretAccessKey: string } | null = null;
const grantedBuckets = new Set<string>();

async function getBrowseCredentials() {
  if (cachedCreds) return cachedCreds;

  const keys = await garageAdmin<ListKeysResponse>("ListKeys");
  let keyId = keys.find((k) => k.name === BROWSE_KEY_NAME)?.id;

  if (!keyId) {
    const created = await garageAdmin<GetKeyInfoResponse>("CreateKey", {
      body: { name: BROWSE_KEY_NAME, allow: null, deny: { createBucket: true } },
    });
    keyId = created.accessKeyId;
  }

  const info = await garageAdmin<GetKeyInfoResponse>("GetKeyInfo", {
    params: { id: keyId, showSecretKey: "true" },
  });
  if (!info.secretAccessKey) {
    throw new Error("Could not retrieve secret key for browse key");
  }
  cachedCreds = {
    accessKeyId: info.accessKeyId,
    secretAccessKey: info.secretAccessKey,
  };
  return cachedCreds;
}

/** Grant the browse key read-only access to a bucket (idempotent). */
async function ensureReadAccess(bucketId: string) {
  if (grantedBuckets.has(bucketId)) return;
  const creds = await getBrowseCredentials();
  await garageAdmin("AllowBucketKey", {
    body: {
      bucketId,
      accessKeyId: creds.accessKeyId,
      permissions: { read: true, write: false, owner: false },
    },
  });
  grantedBuckets.add(bucketId);
}

async function getS3Client() {
  const creds = await getBrowseCredentials();
  return new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    forcePathStyle: true,
    credentials: creds,
  });
}

export async function listObjects(opts: {
  bucketId: string;
  bucketName: string;
  prefix?: string;
  continuationToken?: string;
}) {
  await ensureReadAccess(opts.bucketId);
  const client = await getS3Client();
  const res = await client.send(
    new ListObjectsV2Command({
      Bucket: opts.bucketName,
      Prefix: opts.prefix || undefined,
      Delimiter: "/",
      MaxKeys: 200,
      ContinuationToken: opts.continuationToken || undefined,
    }),
  );
  return {
    prefix: opts.prefix ?? "",
    delimiter: "/",
    commonPrefixes: (res.CommonPrefixes ?? []).map((p) => p.Prefix!).filter(Boolean),
    objects: (res.Contents ?? [])
      .filter((o) => o.Key !== opts.prefix)
      .map((o) => ({
        key: o.Key!,
        size: o.Size ?? 0,
        lastModified: o.LastModified?.toISOString() ?? "",
        etag: o.ETag,
      })),
    isTruncated: res.IsTruncated ?? false,
    nextContinuationToken: res.NextContinuationToken,
  };
}

export async function getObjectStream(opts: {
  bucketId: string;
  bucketName: string;
  key: string;
}) {
  await ensureReadAccess(opts.bucketId);
  const client = await getS3Client();
  const res = await client.send(
    new GetObjectCommand({ Bucket: opts.bucketName, Key: opts.key }),
  );
  return {
    body: res.Body,
    contentType: res.ContentType,
    contentLength: res.ContentLength,
  };
}
