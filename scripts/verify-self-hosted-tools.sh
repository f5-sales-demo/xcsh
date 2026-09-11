#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <bun|full>" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
scope=$1
case "$scope" in bun | full) ;; *) usage ;; esac

test "$(id -u)" -eq 1001
tool_root=${XCSH_EXPECTED_TOOL_ROOT:-/usr/local}
test "$(command -v bun)" = "$tool_root/bin/bun"
test "$(bun --version)" = 1.4.2

[[ "$scope" == full ]] || exit 0

test "$(command -v zig)" = "$tool_root/bin/zig"
test "$(zig version)" = 0.16.0
rustc --version | grep -F 'nightly-2026-09-03'
test "$(rustup show active-toolchain | awk '{print $1}')" = nightly-2026-09-03-x86_64-unknown-linux-gnu

installed_components=$(rustup component list --installed --toolchain nightly-2026-09-03-x86_64-unknown-linux-gnu)
for component in rustfmt clippy rust-analyzer; do
  grep -Eq "^${component}(-x86_64-unknown-linux-gnu)? " <<<"$installed_components"
done

installed_targets=$(rustup target list --installed --toolchain nightly-2026-09-03-x86_64-unknown-linux-gnu)
for target in x86_64-unknown-linux-gnu x86_64-pc-windows-msvc aarch64-unknown-linux-gnu; do
  grep -Fxq "$target" <<<"$installed_targets"
done

test "$(cargo nextest --version | awk '{print $2}')" = 0.9.143
command -v llvm-nm
command -v fd
command -v rg
command -v magick
command -v aarch64-linux-gnu-gcc
dpkg-query -W libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev >/dev/null
