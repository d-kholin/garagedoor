# Garagedoor

A web UI for [Garage](https://garagehq.deuxfleurs.fr/) S3 clusters, focused on the
operational views other Garage UIs lack: per-node resync queues, replication
progress, and blocks that are not yet fully replicated — plus full bucket, access
key, and cluster layout management.

Built with Next.js (App Router) and [shadcn/ui](https://ui.shadcn.com/), talking to
the Garage **admin API v2** (Garage 2.x). The admin token stays server-side; the
browser only ever talks to this app.

## Features

- **Dashboard** — cluster health, partition replication status, per-node disk usage
  and resync queue at a glance, cluster statistics.
- **Replication** — per-node view of every node's resync queue length, resync
  errors, background worker states with progress bars, errored blocks with retry
  ("retry all now"), and metadata table queues (merkle/GC/insert).
- **Buckets** — create buckets, global aliases, quotas, static website hosting
  config, per-bucket stats, incomplete-upload cleanup, delete (empty buckets only).
- **Object browser** — strictly **read-only**: list and download. The backing API
  routes implement no write or delete operations at all. Credentials are
  auto-provisioned as a read-only key (`garagedoor-browse`) via the admin API.
- **Access keys** — create, import, rename, delete keys; grant/revoke per-bucket
  read/write/owner permissions from both the key page and the bucket page.
- **Cluster layout** — assign/edit/remove node roles (zone, capacity, tags,
  gateway), preview staged changes, apply/revert layout versions with confirmation,
  connect new nodes.

## Configuration

Copy `.env.example` to `.env.local` (dev) or set environment variables (prod):

| Variable | Default | Purpose |
| --- | --- | --- |
| `GARAGE_ADMIN_ENDPOINT` | `http://localhost:3903` | Garage admin API v2 base URL |
| `GARAGE_ADMIN_TOKEN` | — | Admin bearer token (server-side only) |
| `GARAGE_S3_ENDPOINT` | `http://localhost:3900` | S3 API URL, used by the object browser |
| `GARAGE_S3_REGION` | `garage` | S3 region name |

> **Security note:** the UI itself has no authentication — deploy it on a trusted
> network or behind an authenticating reverse proxy.

## Development

Requires Node 20+ and Docker.

```sh
npm install
docker compose -f dev/docker-compose.yml up -d   # 3-node Garage 2.x cluster
./dev/setup.sh                                   # connect nodes + apply layout
node dev/seed.mjs                                # demo bucket, key, and objects
npm run dev                                      # http://localhost:3000
```

The dev cluster publishes node 1's S3 API on `:3900` and admin API on `:3903`
(token `garagedoor-dev-admin-token`), which matches the defaults in `.env.example`.

## Production

```sh
docker build -t garagedoor .
docker run -p 3000:3000 \
  -e GARAGE_ADMIN_ENDPOINT=http://your-garage:3903 \
  -e GARAGE_ADMIN_TOKEN=your-admin-token \
  -e GARAGE_S3_ENDPOINT=http://your-garage:3900 \
  garagedoor
```

## Notes on safety

- The server-side proxy only forwards an explicit allowlist of admin endpoints.
  `PurgeBlocks` (permanent data deletion) and admin-token management are excluded.
- Layout changes are staged first and require an explicit, confirmed apply.
- Bucket deletion is only possible for empty buckets (enforced by Garage).
