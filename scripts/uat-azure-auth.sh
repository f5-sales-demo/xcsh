#!/bin/bash
set -e

echo "=== Azure CLI Credential UAT Test ==="

# Stage read-only host credentials into writeable session directory if mounted
if [ -d "$HOME/.azure-host" ] || [ -d "$HOME/.azure" ]; then
  mkdir -p /tmp/.azure
  if [ -d "$HOME/.azure-host" ]; then
    cp -r "$HOME/.azure-host/"* /tmp/.azure/ 2>/dev/null || true
  elif [ -d "$HOME/.azure" ]; then
    cp -r "$HOME/.azure/"* /tmp/.azure/ 2>/dev/null || true
  fi
  export AZURE_CONFIG_DIR="/tmp/.azure"
fi

# Execute az account show to verify active authentication
echo "Querying active Azure account context..."
AZ_OUTPUT=$(az account show 2>&1 || echo "AZ_FAIL")

if echo "$AZ_OUTPUT" | grep -q "AZ_FAIL" || echo "$AZ_OUTPUT" | grep -q "Please run 'az login'"; then
  echo "ERROR: Azure CLI is not authenticated inside the container."
  exit 1
fi

RAW_USER=$(echo "$AZ_OUTPUT" | jq -r '.user.name // "unknown"')
RAW_SUB=$(echo "$AZ_OUTPUT" | jq -r '.name // "unknown"')
RAW_TENANT=$(echo "$AZ_OUTPUT" | jq -r '.tenantDisplayName // "unknown"')

# Mask user email, domain, and subscription for complete PII & corporate privacy
MASKED_USER=$(echo "$RAW_USER" | sed -E 's/(.{2}).*@.*/\1***@***.***/')
MASKED_SUB=$(echo "$RAW_SUB" | sed -E 's/(.{3}).*/\1***/')

echo "=== Azure CLI Authentication Verified Successfully ==="
echo "Account User: $MASKED_USER"
echo "Subscription: $MASKED_SUB"
echo "Tenant: $RAW_TENANT"
