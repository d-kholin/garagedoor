// Seed the dev cluster with a test bucket, an access key, and some objects
// so every page of the UI has data. Run from the repo root: node dev/seed.mjs
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const ADMIN = "http://localhost:3903";
const TOKEN = "garagedoor-dev-admin-token";
const S3_ENDPOINT = "http://localhost:3900";
const BUCKET = "demo-bucket";

async function admin(endpoint, { params, body } = {}) {
  const qs = params ? "?" + new URLSearchParams(params) : "";
  const res = await fetch(`${ADMIN}/v2/${endpoint}${qs}`, {
    method: body !== undefined ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${endpoint}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Bucket
const buckets = await admin("ListBuckets");
let bucket = buckets.find((b) => b.globalAliases.includes(BUCKET));
if (!bucket) {
  bucket = await admin("CreateBucket", { body: { globalAlias: BUCKET } });
  console.log(`Created bucket ${BUCKET} (${bucket.id})`);
} else {
  console.log(`Bucket ${BUCKET} already exists (${bucket.id})`);
}

// Key
const keys = await admin("ListKeys");
let keyId = keys.find((k) => k.name === "demo-key")?.id;
if (!keyId) {
  const created = await admin("CreateKey", { body: { name: "demo-key" } });
  keyId = created.accessKeyId;
  console.log(`Created key demo-key (${keyId})`);
}
const key = await admin("GetKeyInfo", { params: { id: keyId, showSecretKey: "true" } });
await admin("AllowBucketKey", {
  body: {
    bucketId: bucket.id,
    accessKeyId: key.accessKeyId,
    permissions: { read: true, write: true, owner: true },
  },
});

// Objects
const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: "garage",
  forcePathStyle: true,
  credentials: {
    accessKeyId: key.accessKeyId,
    secretAccessKey: key.secretAccessKey,
  },
});

const files = [
  ["readme.txt", "Hello from Garagedoor seed data.\n"],
  ["docs/getting-started.md", "# Getting started\n\nSample nested object.\n"],
  ["docs/api/reference.md", "# API reference\n"],
  ["images/pixel.bin", Buffer.alloc(64 * 1024, 7)],
  ["logs/2026/08/app.log", "log line 1\nlog line 2\n"],
  ["big/blob.bin", Buffer.alloc(3 * 1024 * 1024, 42)],
];
for (const [k, body] of files) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: k, Body: body }));
  console.log(`put s3://${BUCKET}/${k}`);
}
console.log("Seed complete.");
