#!/bin/bash
set -e

echo "=== xcsh End-to-End User Installation & Execution Verification ==="
echo "Simulating a human user following published instructions in docs/en/container/alpine-deployment.md..."

echo ""
echo "[Step 1/5] Building & starting container stack with production security settings..."
docker compose -f docker-compose.dev.yml up -d --build

echo ""
echo "[Step 2/5] Verifying non-root user identity (UID 1000, GID 1000)..."
USER_ID=$(docker exec xcsh-dev id -u)
USER_NAME=$(docker exec xcsh-dev whoami)

if [ "$USER_ID" -ne 1000 ] || [ "$USER_NAME" != "xcsh" ]; then
  echo "ERROR: Security violation! Container is running as '$USER_NAME' ($USER_ID), expected 'xcsh' (1000)."
  docker compose -f docker-compose.dev.yml down
  exit 1
fi
echo "PASS: Container running as non-root user '$USER_NAME' (UID: $USER_ID)."

echo ""
echo "[Step 3/5] Verifying multi-cloud CLI tool availability inside container..."
docker exec xcsh-dev bash -c "
    echo 'Checking gcloud:' && gcloud --version | head -n 1 && \
    echo 'Checking az:' && az --version | head -n 1 && \
    echo 'Checking aws:' && aws --version | head -n 1 && \
    echo 'Checking gh:' && gh --version | head -n 1 && \
    echo 'Checking bun:' && bun --version
"
echo "PASS: All marketplace CLI tools verified inside container."

echo ""
echo "[Step 4/5] Executing automated Master Container UAT Test Suite..."
docker exec xcsh-dev bash ./scripts/uat-all.sh

echo ""
echo "[Step 5/5] Cleaning up container environment..."
docker compose -f docker-compose.dev.yml down

echo ""
echo "========================================================================="
echo "=== End-to-End User Perspective Installation & Verification PASSED! ==="
echo "========================================================================="
