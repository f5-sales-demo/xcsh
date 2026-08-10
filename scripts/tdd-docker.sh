#!/bin/bash
set -e

echo "=== xcsh Comprehensive Docker TDD Unit Test Suite ==="

# Check docker status
if ! docker info >/dev/null 2>&1; then
    echo "Error: Docker daemon is not running or current user lacks docker permissions."
    exit 1
fi

echo "[Test 1/5] Validating Dockerfile multi-stage build & non-root security user..."
docker build --target runtime -f Dockerfile.alpine -t xcsh-runtime-tdd-test .

# Empirical Unit Test: User Identity
USER_ID=$(docker run --rm xcsh-runtime-tdd-test id -u)
USER_NAME=$(docker run --rm xcsh-runtime-tdd-test whoami)

if [ "$USER_ID" -ne 1000 ] || [ "$USER_NAME" != "xcsh" ]; then
    echo "FAIL: Expected non-root user 'xcsh' (1000), got '$USER_NAME' ($USER_ID)"
    exit 1
else
    echo "PASS: Container runs as non-root user '$USER_NAME' (UID: $USER_ID)"
fi

echo "[Test 2/5] Validating installed CLI marketplace tools availability..."
docker run --rm xcsh-runtime-tdd-test bash -c "
    gcloud --version >/dev/null && \
    az --version >/dev/null && \
    aws --version >/dev/null && \
    gh --version >/dev/null && \
    bun --version >/dev/null && \
    curl --version >/dev/null
"
echo "PASS: All marketplace CLI tools (gcloud, az, aws, gh, bun, curl) are installed and executable."

echo "[Test 3/5] Asserting docker-compose.dev.yml CIS security hardening options..."
if grep -q "no-new-privileges:true" docker-compose.dev.yml && grep -q "/home/xcsh/.azure" docker-compose.dev.yml; then
    echo "PASS: docker-compose.dev.yml enforces 'no-new-privileges:true' and non-root credential mounts (/home/xcsh/)."
else
    echo "FAIL: docker-compose.dev.yml missing required CIS security options or non-root credential mounts."
    exit 1
fi

echo "[Test 4/5] Asserting GitHub Actions workflow CI/CD publishing job..."
if grep -q "publish-ghcr:" .github/workflows/ci.yml && grep -q "docker/build-push-action" .github/workflows/ci.yml; then
    echo "PASS: .github/workflows/ci.yml contains verified publish-ghcr container automation job."
else
    echo "FAIL: .github/workflows/ci.yml missing publish-ghcr job."
    exit 1
fi

echo "[Test 5/5] Executing complete master UAT verification suite..."
bash ./scripts/uat-all.sh

echo "==================================================="
echo "=== All Docker TDD Unit Tests Passed Successfully! ==="
echo "==================================================="
