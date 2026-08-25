#!/usr/bin/env bash
set -euo pipefail

: "${EXPECTED_VERSION:?EXPECTED_VERSION is required}"

expected="${EXPECTED_VERSION#v}"

docker buildx build \
  --platform linux/amd64 \
  --pull \
  --no-cache \
  --progress plain \
  --output type=cacheonly \
  --build-arg "EXPECTED_VERSION=$expected" \
  - <<'DOCKERFILE'
FROM node:24-bookworm-slim

ARG EXPECTED_VERSION

USER node
RUN set -eux; \
    install_prefix="$(mktemp -d)"; \
    npm install --global --prefix "$install_prefix" bun@1.3.14; \
    PATH="$install_prefix/bin:$PATH" npm install --global --prefix "$install_prefix" "@f5-sales-demo/xcsh@${EXPECTED_VERSION}"; \
    test "$(PATH="$install_prefix/bin:$PATH" "$install_prefix/bin/xcsh" --version)" = "xcsh/${EXPECTED_VERSION}"; \
    PI_NATIVE_VARIANT=baseline PATH="$install_prefix/bin:$PATH" "$install_prefix/bin/xcsh" --help >/dev/null; \
    echo "Debian 12 npm install and native addon verification passed"
DOCKERFILE
