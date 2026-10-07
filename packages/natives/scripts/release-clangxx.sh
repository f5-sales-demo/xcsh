#!/usr/bin/env bash
set -euo pipefail
sysroot=${TARGET_SYSROOT:?napi release sysroot is required}
toolchain=${sysroot%/*/*}
exec "${PI_NATIVE_RELEASE_CXX:?release compiler is required}" --target=x86_64-unknown-linux-gnu \
  --sysroot="$sysroot" --gcc-toolchain="$toolchain" "$@"
