#!/usr/bin/env bash
# One-time setup for the local dev cluster: connect the three nodes to each
# other and apply an initial layout (1 GiB per node, three zones so the
# replication view has something interesting to show).
set -euo pipefail
cd "$(dirname "$0")"

compose() { docker compose -f docker-compose.yml "$@"; }
g1() { compose exec -T garage1 /garage "$@"; }

echo "Waiting for garage1 to answer..."
for _ in $(seq 1 30); do
  if g1 status >/dev/null 2>&1; then break; fi
  sleep 1
done

ID1=$(compose exec -T garage1 /garage node id -q | cut -d@ -f1)
ID2=$(compose exec -T garage2 /garage node id -q | cut -d@ -f1)
ID3=$(compose exec -T garage3 /garage node id -q | cut -d@ -f1)
echo "Node ids: $ID1 $ID2 $ID3"

g1 node connect "$ID2@garage2:3901" || true
g1 node connect "$ID3@garage3:3901" || true
sleep 2

if g1 layout show | grep -q "$ID1"; then
  echo "Layout already contains node 1; skipping assignment."
else
  g1 layout assign -z zone1 -c 1G "$ID1"
  g1 layout assign -z zone2 -c 1G "$ID2"
  g1 layout assign -z zone3 -c 1G "$ID3"
  g1 layout apply --version 1
fi

g1 status
echo
echo "Done. Admin API: http://localhost:3903 (token: garagedoor-dev-admin-token)"
echo "Seed test data with: node dev/seed.mjs"
