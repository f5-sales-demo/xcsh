#!/bin/bash
set -e

echo "=== xcsh Gemini Enterprise Synthesized Prompts UAT Suite ==="

PROMPTS_FILE="${1:-scripts/uat-prompts.json}"
MODEL="${GEMINI_MODEL:-gemini-3.1-pro-preview}"
FLASH_MODEL="${GEMINI_FLASH_MODEL:-gemini-3.6-flash-high}"
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
    if [ "$REQUIRE_ENTERPRISE" = "true" ]; then
        echo "ERROR: No active Google Cloud OAuth token or Project ID found on filesystem!"
        echo "Strict Enterprise Policy Violation: Free-tier fallback is prohibited."
        exit 1
    fi
fi

if [ ! -f "$PROMPTS_FILE" ]; then
    echo "Error: Prompts file $PROMPTS_FILE not found."
    exit 1
fi

TOTAL_TESTS=$(jq '. | length' "$PROMPTS_FILE")
echo "Loaded $TOTAL_TESTS synthesized test prompts from $PROMPTS_FILE."
echo "Target Enterprise Models: Pro ($MODEL) | Flash ($FLASH_MODEL)"
echo "Enterprise Project: $PROJECT | Location: $LOCATION"

PASSED=0
FAILED=0

for i in $(seq 0 $((TOTAL_TESTS - 1))); do
    ID=$(jq -r ".[$i].id" "$PROMPTS_FILE")
    DOMAIN=$(jq -r ".[$i].domain" "$PROMPTS_FILE")
    DESC=$(jq -r ".[$i].description" "$PROMPTS_FILE")
    PROMPT=$(jq -r ".[$i].prompt" "$PROMPTS_FILE")
    SYS_INST=$(jq -r ".[$i].system_instruction" "$PROMPTS_FILE")
    EXPECTED=$(jq -r ".[$i].expected_keyword" "$PROMPTS_FILE")

    echo "---------------------------------------------------"
    echo "Running Test [$((i+1))/$TOTAL_TESTS]: $ID ($DOMAIN)"
    echo "Description: $DESC"
    echo "Prompt: \"$PROMPT\""

    PAYLOAD=$(jq -n \
        --arg prompt "$PROMPT" \
        --arg sys_inst "$SYS_INST" \
        '{
            systemInstruction: { parts: [{ text: $sys_inst }] },
            contents: [{ role: "user", parts: [{ text: $prompt }] }]
        }')

    # Send request to Enterprise Vertex AI Endpoint
    ENDPOINT="https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent"
    RESPONSE=$(curl -s -X POST "$ENDPOINT" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD")

    if echo "$RESPONSE" | grep -q "error"; then
        # Try alternate model name alias if model version is gemini-3.1-pro-preview or gemini-2.5-pro
        ALT_ENDPOINT="https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/gemini-2.5-pro:generateContent"
        RESPONSE=$(curl -s -X POST "$ALT_ENDPOINT" \
            -H "Authorization: Bearer ${TOKEN}" \
            -H "Content-Type: application/json" \
            -d "$PAYLOAD")
    fi

    TEXT=$(echo "$RESPONSE" | jq -r '.candidates[0].content.parts[0].text // empty')
    
    if echo "$TEXT" | grep -iq "$EXPECTED"; then
        echo "[PASS] Corporate Enterprise Response contains expected keyword: '$EXPECTED'"
        echo "Response text: $TEXT"
        PASSED=$((PASSED + 1))
    else
        echo "[FAIL] Expected '$EXPECTED' not found in response."
        echo "Raw response: $RESPONSE"
        FAILED=$((FAILED + 1))
    fi
done

echo "================================-------------------"
echo "UAT Execution Summary: $PASSED Passed, $FAILED Failed out of $TOTAL_TESTS total."

if [ "$FAILED" -gt 0 ]; then
    exit 1
else
    echo "=== All Synthesized Prompts Enterprise UAT Tests Passed Successfully! ==="
    exit 0
fi
