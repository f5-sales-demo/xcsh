#!/usr/bin/env bash
set -euo pipefail

# Only ciphertext and the Python harness's allowlisted receipts may be uploaded.
root=${1:?Evidence root is required}
recipient=${2:?Evidence recipient certificate is required}
for phase in fresh upgrade; do
  evidence="$root/$phase"
  if [[ ! -d "$evidence/private" ]]; then continue; fi
  staging=$(mktemp -d "$evidence/.encrypt.XXXXXX")
  chmod 700 "$staging"
  tar -czf "$staging/private.tar.gz" -C "$evidence" private receipts
  openssl cms -encrypt -binary -aes-256-cbc \
    -in "$staging/private.tar.gz" -out "$evidence/private-evidence.cms" \
    -outform DER "$recipient"
  rm -rf "$staging"
done
