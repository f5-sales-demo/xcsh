#!/bin/bash
set -e

echo "==================================================="
echo "=== xcsh Complete Container UAT Automation Suite ==="
echo "==================================================="

echo ""
echo "[UAT Step 1/3] Gemini Pro Enterprise Authentication Verification"
./scripts/uat-gemini-auth.sh

echo ""
echo "[UAT Step 2/3] Azure CLI Authentication Verification"
./scripts/uat-azure-auth.sh

echo ""
echo "[UAT Step 3/3] Gemini Pro Synthesized Test Prompts Suite"
./scripts/uat-gemini-prompts.sh

echo ""
echo "==================================================="
echo "=== All Container UAT Verification Tests Passed! ==="
echo "==================================================="
