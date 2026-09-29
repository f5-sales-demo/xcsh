#!/usr/bin/env bash
# Preserve partial transfers between bounded attempts; publish only verified bytes.
set -euo pipefail

zig_url=${1:?Zig archive URL is required}
zig_sha256=${2:?Zig archive checksum is required}
zig_archive=${3:?Zig archive destination is required}
zig_partial=${4:?Zig archive staging path is required}

verify_zig_archive() {
  if [[ "${RUNNER_OS:-Linux}" == "macOS" ]]; then
    printf '%s  %s\n' "$zig_sha256" "$1" | shasum -a 256 -c
  else
    printf '%s  %s\n' "$zig_sha256" "$1" | sha256sum -c
  fi
}

if [[ -f "$zig_archive" ]] && verify_zig_archive "$zig_archive"; then
  exit 0
fi

mkdir -p "$(dirname "$zig_archive")" "$(dirname "$zig_partial")"
# A bad cached archive must never be mistaken for a successful fresh transfer.
rm -f "$zig_archive" "$zig_partial"
zig_delay=5
for zig_attempt in 1 2 3 4; do
  echo "Download Zig archive: attempt $zig_attempt/4"
  zig_status=0
  curl --silent --show-error --fail --location \
    --connect-timeout 15 --max-time 600 --continue-at - \
    --output "$zig_partial" "$zig_url" || zig_status=$?
  if [[ "$zig_status" == 0 ]]; then
    verify_zig_archive "$zig_partial"
    mv "$zig_partial" "$zig_archive"
    exit 0
  fi
  # curl 33 means the server ignored/refused the requested byte range.
  if [[ "$zig_status" == 33 ]]; then
    rm -f "$zig_partial"
  fi
  if [[ "$zig_attempt" == 4 ]]; then
    echo "::error::Zig archive download failed after four attempts (curl $zig_status)" >&2
    exit "$zig_status"
  fi
  sleep "$zig_delay"
  zig_delay=$((zig_delay * 2))
done
