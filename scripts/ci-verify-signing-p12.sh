#!/usr/bin/env bash
# Validate an existing signing archive without changing its encryption or keys.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo 'Usage: ci-verify-signing-p12.sh ARCHIVE PASSWORD_ENVIRONMENT_NAME' >&2
  exit 64
fi
archive=$1
password_environment=$2
if [[ ! "$password_environment" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || [[ ! -r "$archive" ]]; then
  echo 'Invalid signing archive or password environment reference' >&2
  exit 64
fi

# OpenSSL 3+ moved RC2 (used by older PKCS12 archives) into its legacy provider.
# Enable it only when the installed CLI advertises the option. Older OpenSSL and
# LibreSSL retain their normal import path. MAC/password verification stays on.
options=(-info -noout -in "$archive" -passin "env:$password_environment")
help_output=$(openssl pkcs12 -help 2>&1 || true)
if [[ "$help_output" =~ (^|[[:space:]])-legacy([[:space:]]|$) ]]; then
  options=(-legacy "${options[@]}")
fi
exec openssl pkcs12 "${options[@]}"
