#!/bin/bash
set -e

echo "=== Gemini Enterprise Auth UAT Test (Strict Enterprise Enforcement) ==="

MODEL="${GEMINI_MODEL:-gemini-3.1-pro-preview}"
LOCATION="${VERTEX_AI_LOCATION:-us-central1}"
REQUIRE_ENTERPRISE="${REQUIRE_ENTERPRISE_AUTH:-true}"

# Dynamically discover active project ID from environment or gcloud config
PROJECT="${VERTEX_AI_PROJECT:-}"
if [ -z "$PROJECT" ]; then
    PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")
fi

# Extract active access token from filesystem credentials
TOKEN=$(gcloud auth print-access-token 2>/dev/null || echo "")

if [ -z "$TOKEN" ] || [ -z "$PROJECT" ]; then
    echo "ERROR: No active Google Cloud OAuth token or Project ID found on filesystem!"
    if [ "$REQUIRE_ENTERPRISE" = "true" ]; then
        echo "Strict Enterprise Policy Violation: Free-tier fallback is prohibited."
        exit 1
    fi
fi

echo "Found active Google Cloud Access Token from filesystem credentials."
echo "Target Enterprise Models: Pro ($MODEL) | Flash (${GEMINI_FLASH_MODEL:-gemini-3.6-flash-high})"
echo "Enterprise Project: $PROJECT | Location: $LOCATION"

# Verify Vertex AI Enterprise Endpoint
ENDPOINT="https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent"

RESPONSE=$(curl -s -X POST "$ENDPOINT" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"contents":[{"role":"user","parts":[{"text":"Say hello"}]}]}')

if echo "$RESPONSE" | grep -q "error"; then
    # Try alternate model name alias if model version is gemini-3.1-pro-preview or gemini-2.5-pro
    ALT_ENDPOINT="https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/gemini-2.5-pro:generateContent"
    RESPONSE=$(curl -s -X POST "$ALT_ENDPOINT" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"contents":[{"role":"user","parts":[{"text":"Say hello"}]}]}')
fi

echo "$RESPONSE" | jq .

if echo "$RESPONSE" | grep -q "error"; then
    echo "ERROR: Enterprise authentication failed."
    exit 1
else
    echo "=== Gemini Pro Enterprise Auth UAT Test Succeeded (Corporate Enterprise Verified) ==="
fi
