#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
verifier="$repo_root/scripts/ci-verify-signing-p12.sh"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
umask 077
export SYNTHETIC_P12_PASSWORD='synthetic-archive-password'

openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj '/CN=Synthetic Signing Archive Test' \
  -keyout "$scratch/key.pem" -out "$scratch/cert.pem" >/dev/null 2>&1
openssl pkcs12 -export -inkey "$scratch/key.pem" -in "$scratch/cert.pem" \
  -out "$scratch/modern.p12" -passout env:SYNTHETIC_P12_PASSWORD
bash "$verifier" "$scratch/modern.p12" SYNTHETIC_P12_PASSWORD >/dev/null 2>&1

help_output=$(openssl pkcs12 -help 2>&1 || true)
if [[ "$help_output" =~ (^|[[:space:]])-legacy([[:space:]]|$) ]]; then
  openssl pkcs12 -export -legacy -inkey "$scratch/key.pem" -in "$scratch/cert.pem" \
    -out "$scratch/legacy.p12" -passout env:SYNTHETIC_P12_PASSWORD
  bash "$verifier" "$scratch/legacy.p12" SYNTHETIC_P12_PASSWORD >/dev/null 2>&1
fi

# Older CLIs do not advertise -legacy. Verify that branch with a test executable
# and ensure only the environment reference, never its password, reaches argv.
mkdir "$scratch/bin"
cat >"$scratch/bin/openssl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == 'pkcs12 -help' ]]; then
  echo 'Usage: pkcs12 [options]'
  exit 0
fi
printf '%s\n' "$@" >"$P12_ARGUMENT_RECEIPT"
SH
chmod +x "$scratch/bin/openssl"
export P12_ARGUMENT_RECEIPT="$scratch/arguments.txt"
PATH="$scratch/bin:$PATH" bash "$verifier" "$scratch/modern.p12" SYNTHETIC_P12_PASSWORD
if grep -q -- '-legacy\|synthetic-archive-password' "$P12_ARGUMENT_RECEIPT"; then
  echo 'FAIL: unsupported option or plaintext password reached older CLI' >&2
  exit 1
fi
grep -q '^env:SYNTHETIC_P12_PASSWORD$' "$P12_ARGUMENT_RECEIPT"

export SYNTHETIC_P12_WRONG_PASSWORD='different-synthetic-password'
if bash "$verifier" "$scratch/modern.p12" SYNTHETIC_P12_WRONG_PASSWORD >/dev/null 2>&1; then
  echo 'FAIL: incorrect archive password accepted' >&2
  exit 1
fi
printf 'invalid archive\n' >"$scratch/invalid.p12"
if bash "$verifier" "$scratch/invalid.p12" SYNTHETIC_P12_PASSWORD >/dev/null 2>&1; then
  echo 'FAIL: corrupt archive accepted' >&2
  exit 1
fi
if bash "$verifier" "$scratch/modern.p12" 'BAD;NAME' >/dev/null 2>&1; then
  echo 'FAIL: invalid password environment reference accepted' >&2
  exit 1
fi

echo 'PKCS12 signing preflight contracts passed'
