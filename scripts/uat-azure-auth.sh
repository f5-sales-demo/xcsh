#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/uat-common.sh
source "${SCRIPT_DIR}/uat-common.sh"

session_dir=$(uat_make_session azure)
trap 'uat_cleanup_session "$session_dir"' EXIT

uat_stage_credentials "${HOME}/.azure-host" "${session_dir}/config"
export AZURE_CONFIG_DIR="${session_dir}/config"

echo "Verifying the mounted Azure CLI session..."
if ! az account show --query id --output tsv >/dev/null 2>&1; then
  uat_die "Azure CLI authentication could not be verified."
fi

echo "PASS: Azure CLI authentication is active; account identifiers were not logged."
