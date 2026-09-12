#!/usr/bin/env bash
set -euo pipefail

readonly FROZEN_SOURCE_SHA=0bca45d64934440703556091dc746de41dd5460b
readonly BUN_VERSION=1.4.2
readonly BUN_SHA256=36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913
readonly ZIG_VERSION=0.16.0
readonly ZIG_SHA256=70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00
readonly RUST_TOOLCHAIN=nightly-2026-09-03
readonly RUST_DIST_MANIFEST_SHA256=df7a2f1a117645520b1019cf2f23d75411be359d431a09e28c31ab97ff710094
readonly CARGO_NEXTEST_VERSION=0.9.143
readonly CARGO_NEXTEST_SHA256=66786b9abe23920d022a182d1416b1bbc8130dd4872a9553d76985a1708dcd1e
readonly LLVM_DEB_VERSION=18.1.3-1ubuntu1
readonly LLVM_DEB_SHA256=139cb82e16e75fcdd4a56562804ff9bfb482b65d0929580d621d28088075a27e
readonly UBUNTU_SNAPSHOT=20260810T000000Z

usage() {
  echo "usage: $0 <experiment> <cold|warm> <pair-id> <output-dir> <verifier> <all|native|rust|typescript>" >&2
  exit 2
}

download() {
  local url=$1 destination=$2
  curl --fail --location --proto '=https' --tlsv1.2 \
    --retry 3 --retry-all-errors --connect-timeout 15 --max-time 300 \
    --output "$destination" "$url"
}

write_manifest() {
  local destination=$1
  cat >"$destination" <<EOF
bun=$BUN_VERSION
zig=$ZIG_VERSION
rust=$RUST_TOOLCHAIN
rust-component=clippy
rust-component=rust-analyzer
rust-component=rustfmt
rust-target=aarch64-unknown-linux-gnu
rust-target=x86_64-pc-windows-msvc
rust-target=x86_64-unknown-linux-gnu
cargo-nextest=$CARGO_NEXTEST_VERSION
llvm-nm=present
native-libraries=present
EOF
}

verify_source_pins() {
  local source_toolchain
  source_toolchain=$(sed -nE 's/^channel[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' rust-toolchain.toml)
  test "$source_toolchain" = "$RUST_TOOLCHAIN"
  grep -Fq 'expected_bun=${XCSH_EXPECTED_BUN_VERSION:-1.4.2}' scripts/ci-bun-install.sh
}

install_legacy_toolchain() {
  local verifier=$1 manifest=$2 tool_root=$3
  local download_dir="$tool_root/downloads"
  local bin_dir="$tool_root/bin"
  rm -rf "$tool_root"
  mkdir -p "$download_dir" "$bin_dir" "$tool_root/zig"

  download \
    "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip" \
    "$download_dir/bun.zip"
  printf '%s  %s\n' "$BUN_SHA256" "$download_dir/bun.zip" | sha256sum --check --strict
  unzip -q "$download_dir/bun.zip" -d "$tool_root"
  ln -s "$tool_root/bun-linux-x64/bun" "$bin_dir/bun"

  download \
    "https://ziglang.org/download/${ZIG_VERSION}/zig-x86_64-linux-${ZIG_VERSION}.tar.xz" \
    "$download_dir/zig.tar.xz"
  printf '%s  %s\n' "$ZIG_SHA256" "$download_dir/zig.tar.xz" | sha256sum --check --strict
  tar --extract --xz --file "$download_dir/zig.tar.xz" --directory "$tool_root/zig" --strip-components=1
  ln -s "$tool_root/zig/zig" "$bin_dir/zig"

  download \
    "https://static.rust-lang.org/dist/2026-09-03/channel-rust-nightly.toml" \
    "$download_dir/channel-rust-nightly.toml"
  printf '%s  %s\n' "$RUST_DIST_MANIFEST_SHA256" "$download_dir/channel-rust-nightly.toml" |
    sha256sum --check --strict
  rustup toolchain install "$RUST_TOOLCHAIN" --profile minimal --no-self-update \
    --component rustfmt --component clippy --component rust-analyzer \
    --target x86_64-unknown-linux-gnu \
    --target x86_64-pc-windows-msvc \
    --target aarch64-unknown-linux-gnu

  download \
    "https://github.com/nextest-rs/nextest/releases/download/cargo-nextest-${CARGO_NEXTEST_VERSION}/cargo-nextest-${CARGO_NEXTEST_VERSION}-x86_64-unknown-linux-gnu.tar.gz" \
    "$download_dir/cargo-nextest.tar.gz"
  printf '%s  %s\n' "$CARGO_NEXTEST_SHA256" "$download_dir/cargo-nextest.tar.gz" |
    sha256sum --check --strict
  tar --extract --gzip --file "$download_dir/cargo-nextest.tar.gz" \
    --directory "$bin_dir" cargo-nextest
  chmod 0555 "$bin_dir/cargo-nextest"

  download \
    "https://snapshot.ubuntu.com/ubuntu/${UBUNTU_SNAPSHOT}/pool/universe/l/llvm-toolchain-18/llvm-18_${LLVM_DEB_VERSION}_amd64.deb" \
    "$download_dir/llvm-18.deb"
  printf '%s  %s\n' "$LLVM_DEB_SHA256" "$download_dir/llvm-18.deb" |
    sha256sum --check --strict
  dpkg-deb --extract "$download_dir/llvm-18.deb" "$tool_root/llvm"
  ln -s "$tool_root/llvm/usr/lib/llvm-18/bin/llvm-nm" "$bin_dir/llvm-nm"
  if ! command -v fd >/dev/null 2>&1 && command -v fdfind >/dev/null 2>&1; then
    ln -s "$(command -v fdfind)" "$bin_dir/fd"
  fi
  if ! command -v magick >/dev/null 2>&1 && command -v convert >/dev/null 2>&1; then
    ln -s "$(command -v convert)" "$bin_dir/magick"
  fi

  export PATH="$bin_dir:$PATH"
  export XCSH_EXPECTED_TOOL_ROOT=$tool_root
  bash "$verifier" full
  write_manifest "$manifest"

  printf '%s\n' "$bin_dir" >>"${GITHUB_PATH:?GITHUB_PATH is required}"
  printf 'XCSH_EXPECTED_TOOL_ROOT=%s\n' "$tool_root" >>"${GITHUB_ENV:?GITHUB_ENV is required}"
}

verify_baked_toolchain() {
  local verifier=$1 manifest=$2
  bash "$verifier" full
  write_manifest "$manifest"
}

if [[ ${1:-} == __run ]]; then
  [[ $# -eq 5 ]] || usage
  mode=$2
  verifier=$3
  manifest=$4
  tool_root=$5
  verify_source_pins
  case "$mode" in
  legacy) install_legacy_toolchain "$verifier" "$manifest" "$tool_root" ;;
  baked) verify_baked_toolchain "$verifier" "$manifest" ;;
  *) usage ;;
  esac
  exit 0
fi

[[ $# -eq 6 ]] || usage
experiment=$1
cache_state=$2
pair_id=$3
output_dir=$4
verifier=$5
phase_set=$6
case "$experiment" in
image-control | image-candidate | d16-serial | d16-parallel-2 | d16-hardware | f32-hardware | d16-burst | f32-burst | dag-control | dag-candidate) ;;
*) usage ;;
esac
case "$cache_state" in cold | warm) ;; *) usage ;; esac
case "$phase_set" in all | native | rust | typescript) ;; *) usage ;; esac
[[ "$pair_id" =~ ^[1-5](-slot-[1-4])?$ ]] || usage
test -f "$verifier"

source_commit=$(git rev-parse HEAD)
test "$source_commit" = "$FROZEN_SOURCE_SHA"
mkdir -p "$output_dir/manifests" "$output_dir/profiles"
output_dir=$(cd "$output_dir" && pwd)
verifier=$(cd "$(dirname "$verifier")" && pwd)/$(basename "$verifier")
script_path=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")
manifest="$output_dir/manifests/setup.sha256"
profile_phase=setup
if [[ "$experiment" == dag-candidate && "$phase_set" != native ]]; then
  profile_phase="setup-$phase_set"
fi
profile="$output_dir/profiles/${profile_phase}.json"
tool_root="${RUNNER_TEMP:?RUNNER_TEMP is required}/xcsh-legacy-toolchain"

mode=baked
if [[ "$experiment" == image-control ]]; then
  mode=legacy
fi

GITHUB_SHA="$source_commit" runner-profile \
  --name "$profile_phase" \
  --output "$profile" \
  --cache-state "$cache_state" \
  --variant "$experiment" \
  --pair-id "$pair_id" \
  -- bash "$script_path" __run "$mode" "$verifier" "$manifest" "$tool_root"

temporary="${profile}.tmp"
jq --arg digest "sha256:$(sha256sum "$manifest" | cut -d ' ' -f1)" \
  '.output_digest = $digest' "$profile" >"$temporary"
mv "$temporary" "$profile"
