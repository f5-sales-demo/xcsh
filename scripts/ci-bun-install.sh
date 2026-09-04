#!/usr/bin/env bash
set -euo pipefail

workspace=${1:-.}
expected_bun=1.3.14
[[ "$(bun --version)" == "$expected_bun" ]] || {
  echo "Bun $expected_bun is required; found $(bun --version)" >&2
  exit 1
}
workspace=$(cd "$workspace" && pwd)
for lock in package.json bun.lock; do
  test -f "$workspace/$lock"
done
before_package=$(git -C "$workspace" hash-object package.json)
before_lock=$(git -C "$workspace" hash-object bun.lock)
BUN_INSTALL_CACHE_DIR=${BUN_INSTALL_CACHE_DIR:-$HOME/.bun/install/cache} \
  bun install --cwd "$workspace" --frozen-lockfile --concurrent-scripts 8
[[ "$(git -C "$workspace" hash-object package.json)" == "$before_package" &&
"$(git -C "$workspace" hash-object bun.lock)" == "$before_lock" ]] || {
  echo "bun install modified package.json or bun.lock" >&2
  exit 1
}
git -C "$workspace" diff --exit-code -- package.json bun.lock
