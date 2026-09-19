#!/usr/bin/env bash
set -euo pipefail

: "${UAT_USER:?UAT_USER is required}"
: "${UAT_HOME:?UAT_HOME is required}"
: "${UAT_FULL_NAME:?UAT_FULL_NAME is required}"

ready_timeout=${UAT_READY_TIMEOUT_SECONDS:-60}
ready_poll=${UAT_READY_POLL_SECONDS:-2}
if [[ ! "$ready_timeout" =~ ^[0-9]+$ || ! "$ready_poll" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::UAT readiness timeout must be nonnegative and polling interval must be positive"
  exit 1
fi

if id -u "$UAT_USER" >/dev/null 2>&1; then
  echo "::error::UAT account ${UAT_USER} already exists"
  exit 1
fi

set +e
sudo sysadminctl -addUser "$UAT_USER" -fullName "$UAT_FULL_NAME" \
  -home "$UAT_HOME" -password "$(uuidgen)"
sysadminctl_status=$?
set -e

readiness="account is not visible"

validate_account() {
  local actual_home actual_user groups home_record owner

  if ! id -u "$UAT_USER" >/dev/null 2>&1; then
    readiness="account is not visible"
    return 1
  fi

  actual_user=$(id -un "$UAT_USER" 2>/dev/null) || {
    readiness="account name lookup failed"
    return 1
  }
  if [[ "$actual_user" != "$UAT_USER" ]]; then
    readiness="account name is ${actual_user}, expected ${UAT_USER}"
    return 1
  fi

  home_record=$(dscl . -read "/Users/${UAT_USER}" NFSHomeDirectory 2>/dev/null) || {
    readiness="directory record is not visible"
    return 1
  }
  actual_home=${home_record#NFSHomeDirectory: }
  if [[ "$actual_home" != "$UAT_HOME" ]]; then
    readiness="directory home is ${actual_home}, expected ${UAT_HOME}"
    return 1
  fi

  if ! sudo mkdir -p "$UAT_HOME"; then
    readiness="home directory could not be materialized"
    return 1
  fi
  if ! sudo chown "$UAT_USER":staff "$UAT_HOME"; then
    readiness="home ownership could not be assigned"
    return 1
  fi
  if ! sudo chmod 700 "$UAT_HOME"; then
    readiness="home permissions could not be assigned"
    return 1
  fi
  if [[ ! -d "$UAT_HOME" ]]; then
    readiness="home directory is missing"
    return 1
  fi
  owner=$(stat -f '%Su' "$UAT_HOME" 2>/dev/null) || {
    readiness="home owner lookup failed"
    return 1
  }
  if [[ "$owner" != "$UAT_USER" ]]; then
    readiness="home owner is ${owner}, expected ${UAT_USER}"
    return 1
  fi

  groups=$(id -Gn "$UAT_USER" 2>/dev/null) || {
    readiness="group lookup failed"
    return 1
  }
  if ! tr ' ' '\n' <<<"$groups" | grep -qx staff; then
    readiness="staff membership is missing"
    return 1
  fi
  if tr ' ' '\n' <<<"$groups" | grep -qx admin; then
    readiness="account is an administrator"
    return 2
  fi

  readiness="ready"
  return 0
}

max_attempts=$((ready_timeout / ready_poll + 1))
for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  if validate_account; then
    if [[ "$sysadminctl_status" -ne 0 ]]; then
      echo "sysadminctl status ${sysadminctl_status} accepted after account readiness validation"
    fi
    echo "macOS UAT account ${UAT_USER} is ready"
    exit 0
  else
    readiness_status=$?
  fi
  if [[ "$readiness_status" -eq 2 || "$attempt" -eq "$max_attempts" ]]; then
    break
  fi
  sleep "$ready_poll"
done

echo "::error::macOS UAT account readiness failed"
echo "sysadminctl status: ${sysadminctl_status}"
echo "readiness: ${readiness}"
exit 1
