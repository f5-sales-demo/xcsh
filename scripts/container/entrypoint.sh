#!/usr/bin/env bash
set -euo pipefail
umask 077
export PUPPETEER_PROXY="${PUPPETEER_PROXY:-${HTTPS_PROXY:-${https_proxy:-${HTTP_PROXY:-${http_proxy:-}}}}}"
python3 /opt/xcsh/state.py
# Explicit portable mounts are copied once so vendor CLIs can refresh private state.
for service in github gitlab aws azure salesforce gcloud ssh; do
  source="/imports/$service"
  [[ -d "$source" && -n "$(ls -A "$source")" ]] || continue
  case "$service" in
    github) destination="$HOME/.config/gh" ;;
    gitlab) destination="$HOME/.config/glab-cli" ;;
    aws) destination="$HOME/.aws" ;;
    azure) destination="$HOME/.azure" ;;
    salesforce) destination="$HOME/.sf" ;;
    gcloud) destination="$HOME/.config/gcloud" ;;
    ssh) destination="$HOME/.ssh" ;;
  esac
  python3 /opt/xcsh/state.py "$source" "$destination"
done
if [[ -r /imports/ca.pem ]]; then
  cat /etc/ssl/certs/ca-certificates.crt /imports/ca.pem > "$HOME/.xcsh/ca-bundle.pem"
  export SSL_CERT_FILE="$HOME/.xcsh/ca-bundle.pem" REQUESTS_CA_BUNDLE="$HOME/.xcsh/ca-bundle.pem"
  export CURL_CA_BUNDLE="$SSL_CERT_FILE" AWS_CA_BUNDLE="$SSL_CERT_FILE" NODE_EXTRA_CA_CERTS=/imports/ca.pem
  export CLOUDSDK_CORE_CUSTOM_CA_CERTS_FILE="$SSL_CERT_FILE"
  mkdir -p "$HOME/.pki/nssdb"
  if [[ ! -f "$HOME/.pki/nssdb/cert9.db" ]]; then certutil -N -d "sql:$HOME/.pki/nssdb" --empty-password; fi
  python3 /opt/xcsh/import-ca.py
fi
if [[ -f /imports/native/models.yml ]]; then bun /opt/xcsh/import-native.ts; fi
if [[ "${1:-}" == container-auth ]]; then shift; exec python3 /opt/xcsh/auth.py "$@"; fi
if [[ "${1:-}" == container-test ]]; then shift; exec bash /opt/xcsh/runtime-check.sh "$@"; fi
exec xcsh "$@"
