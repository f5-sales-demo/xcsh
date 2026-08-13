#!/bin/bash
set -euo pipefail

test_platform="${XCSH_TEST_PLATFORM:-}"
expected_machine="${XCSH_EXPECTED_MACHINE:-}"

case "$test_platform" in
"") test_arch="native" ;;
linux/amd64)
  test_arch="amd64"
  test "${expected_machine:-x86_64}" = "x86_64" || {
    echo "ERROR: linux/amd64 must use XCSH_EXPECTED_MACHINE=x86_64." >&2
    exit 1
  }
  expected_machine="x86_64"
  ;;
linux/arm64)
  test_arch="arm64"
  test "${expected_machine:-aarch64}" = "aarch64" || {
    echo "ERROR: linux/arm64 must use XCSH_EXPECTED_MACHINE=aarch64." >&2
    exit 1
  }
  expected_machine="aarch64"
  ;;
*)
  echo "ERROR: Unsupported XCSH_TEST_PLATFORM: $test_platform" >&2
  exit 1
  ;;
esac

if [[ -z "$test_platform" && -n "$expected_machine" ]]; then
  echo "ERROR: XCSH_EXPECTED_MACHINE requires XCSH_TEST_PLATFORM." >&2
  exit 1
fi

image="xcsh-runtime-tdd-test:${GITHUB_RUN_ID:-local}-${test_arch}"
runtime_options=(
  --rm
  --read-only
  --tmpfs "/tmp:rw,nosuid,nodev,size=1g,mode=1777"
  --tmpfs "/home/xcsh/.xcsh:rw,exec,nosuid,nodev,size=256m,mode=0700,uid=1000,gid=1000"
  --tmpfs "/home/xcsh/.sf:rw,nosuid,nodev,size=64m,mode=0700,uid=1000,gid=1000"
  --tmpfs "/home/xcsh/.sfdx:rw,nosuid,nodev,size=64m,mode=0700,uid=1000,gid=1000"
  --env AZURE_CONFIG_DIR=/tmp/xcsh-azure
  --env CLOUDSDK_CONFIG=/tmp/xcsh-gcloud
)
if [[ -n "$test_platform" ]]; then
  runtime_options+=(--platform "$test_platform")
fi
cleanup() {
  docker image rm --force "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker info >/dev/null 2>&1 || {
  echo "ERROR: Docker is unavailable." >&2
  exit 1
}

echo "[1/5] Build the Alpine runtime without suppressing failures."
build_options=(
  --load
  --target runtime
  --file Dockerfile.alpine
  --tag "$image"
)
if [[ -n "$test_platform" ]]; then
  build_options+=(--platform "$test_platform")
fi
docker buildx build "${build_options[@]}" .

echo "[2/5] Verify xcsh, non-root identity, and bundled commands."
if [[ -n "$expected_machine" ]]; then
  test "$(docker run "${runtime_options[@]}" --entrypoint uname "$image" -m)" = "$expected_machine"
fi
docker run "${runtime_options[@]}" "$image" --version >/dev/null
docker run "${runtime_options[@]}" "$image" --help >/dev/null
test "$(docker run "${runtime_options[@]}" --entrypoint id "$image" -u)" = "1000"
test "$(docker run "${runtime_options[@]}" --entrypoint id "$image" -g)" = "1000"
test "$(docker run "${runtime_options[@]}" --entrypoint whoami "$image")" = "xcsh"
docker run "${runtime_options[@]}" --entrypoint bash "$image" -c \
  'set -e
   gcloud --version >/dev/null
   az version >/dev/null
   aws --version >/dev/null
   gh --version >/dev/null
   sf --version >/dev/null
   bun --version >/dev/null
   zig version >/dev/null
   jq --version >/dev/null'

echo "[3/5] Verify the runtime excludes build and credential material."
docker run "${runtime_options[@]}" --entrypoint bash "$image" -c \
  'test ! -e /src && test ! -e /.git && test ! -e /workspace/package.json && test ! -e /root/.bun'

echo "[4/5] Verify Compose and publishing workflow contracts."
compose_config=$(docker compose -f docker-compose.dev.yml config)
grep -Fq 'no-new-privileges:true' <<<"$compose_config"
grep -Fq 'cap_drop:' <<<"$compose_config"
grep -Fq 'read_only: true' <<<"$compose_config"
grep -A1 -F 'target: /workspace' <<<"$compose_config" | grep -Fq 'read_only: true'
if grep -Fq '/var/run/docker.sock' <<<"$compose_config"; then
  echo "ERROR: Compose exposes the Docker socket." >&2
  exit 1
fi
grep -Fq 'container-test:' .github/workflows/container.yml
grep -Fq 'runs-on: ubuntu-24.04-arm' .github/workflows/container.yml
grep -Fq 'docker/build-push-action@' .github/workflows/container.yml
grep -Fq 'docker/setup-qemu-action@' .github/workflows/container.yml
grep -Fq 'platforms: linux/amd64,linux/arm64' .github/workflows/container.yml
grep -Fq 'ARG TARGETARCH' Dockerfile.alpine
grep -Fq 'bun_arch=x64-baseline' Dockerfile.alpine
grep -Fq 'export TARGET_VARIANT=baseline' Dockerfile.alpine
grep -Fq 'target-cpu=generic' Dockerfile.alpine
grep -Fq 'packages/natives/native/*.node' .dockerignore

echo "[5/5] Run credential-free UAT inside the built image."
docker run "${runtime_options[@]}" --entrypoint bash \
  --volume "$PWD:/workspace:ro" --workdir /workspace \
  "$image" ./scripts/uat-all.sh

echo "PASS: Alpine container test suite completed."
