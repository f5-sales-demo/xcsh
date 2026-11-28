#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <bun|full>" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
scope=$1
case "$scope" in bun | full) ;; *) usage ;; esac

fail() {
  printf 'xcsh runner prerequisite failed: %s\n' "$1" >&2
  exit 1
}

require_equal() {
  local label=$1 expected=$2 observed=$3
  [[ "$observed" == "$expected" ]] || fail "$label expected '$expected', observed '$observed'"
}

require_equal "worker UID" 1001 "$(id -u)"
tool_root=${XCSH_EXPECTED_TOOL_ROOT:-/usr/local}
require_equal "Bun executable" "$tool_root/bin/bun" "$(command -v bun)"
require_equal "Bun version" 1.4.5 "$(bun --version)"

[[ "$scope" == full ]] || exit 0

require_equal "Zig executable" "$tool_root/bin/zig" "$(command -v zig)"
require_equal "Zig version" 0.16.0 "$(zig version)"
rustc --version >/dev/null
require_equal "Rust toolchain" nightly-2026-09-03-x86_64-unknown-linux-gnu "$(rustup show active-toolchain | awk '{print $1}')"

installed_components=$(rustup component list --installed --toolchain nightly-2026-09-03-x86_64-unknown-linux-gnu)
for component in rustfmt clippy rust-analyzer; do
  grep -Eq "^${component}(-x86_64-unknown-linux-gnu)?( |$)" <<<"$installed_components" || fail "Rust component missing: $component"
done

installed_targets=$(rustup target list --installed --toolchain nightly-2026-09-03-x86_64-unknown-linux-gnu)
for target in x86_64-unknown-linux-gnu x86_64-pc-windows-msvc aarch64-unknown-linux-gnu; do
  grep -Fxq "$target" <<<"$installed_targets" || fail "Rust target missing: $target"
done

require_equal "cargo-nextest version" 0.9.143 "$(cargo nextest --version | awk 'NR == 1 {print $2}')"
command -v llvm-nm
llvm-nm --version >/dev/null
command -v fd
command -v rg
command -v magick
command -v aarch64-linux-gnu-gcc
dpkg-query -W libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev >/dev/null
