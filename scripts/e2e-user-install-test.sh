#!/bin/bash
set -euo pipefail

live_arg=()
if [ "${1:-}" = "--live" ]; then
  live_arg=(--live)
  shift
fi
if [ "$#" -ne 0 ]; then
  echo "Usage: $0 [--live]" >&2
  exit 2
fi

compose_project="xcsh-e2e-${PPID}-$$"
compose=(docker compose --project-name "$compose_project" -f docker-compose.dev.yml)

cleanup() {
  "${compose[@]}" down --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "[1/5] Build and start the documented Compose service."
XCSH_BUILD_COMMIT=$(git rev-parse HEAD) \
XCSH_BUILD_BRANCH=$(git branch --show-current) \
  "${compose[@]}" up -d --build

echo "[2/5] Verify the non-root runtime identity."
user_id=$("${compose[@]}" exec -T xcsh-dev id -u)
group_id=$("${compose[@]}" exec -T xcsh-dev id -g)
user_name=$("${compose[@]}" exec -T xcsh-dev whoami)
if [ "$user_id" != "1000" ] || [ "$group_id" != "1000" ] || [ "$user_name" != "xcsh" ]; then
  echo "ERROR: Expected xcsh UID/GID 1000, received ${user_name} ${user_id}:${group_id}." >&2
  exit 1
fi

echo "[3/5] Verify runtime hardening."
container_id=$("${compose[@]}" ps -q xcsh-dev)
[ -n "$container_id" ] || {
  echo "ERROR: Compose did not return the xcsh container ID." >&2
  exit 1
}
docker inspect "$container_id" --format '{{json .HostConfig.CapDrop}}' | grep -Fq 'ALL'
docker inspect "$container_id" --format '{{json .HostConfig.SecurityOpt}}' \
  | grep -Fq 'no-new-privileges:true'
if docker inspect "$container_id" --format '{{range .Mounts}}{{println .Destination}}{{end}}' \
  | grep -Fxq /var/run/docker.sock; then
  echo "ERROR: The Docker socket must not be mounted." >&2
  exit 1
fi

echo "[4/5] Run deterministic container verification."
"${compose[@]}" exec -T xcsh-dev ./scripts/uat-all.sh "${live_arg[@]}"

echo "[5/5] Tear down the Compose service."
cleanup
trap - EXIT INT TERM

if [ -e core ]; then
  echo "ERROR: Container execution created a core dump in the checkout." >&2
  exit 1
fi
echo "PASS: End-to-end container installation and verification completed."
