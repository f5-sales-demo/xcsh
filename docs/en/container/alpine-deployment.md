---
title: Run xcsh containers with Docker and Podman
description: Build and run the non-root xcsh Alpine Linux container image with Docker, Docker Compose, or native ARM64 Podman UAT.
---

Release tags matching `v*` trigger automated publication to GitHub Container Registry (GHCR) at `ghcr.io/f5-sales-demo/xcsh`. The container image executes as the unprivileged `xcsh` user and includes command-line interfaces (CLIs) for xcsh, Google Cloud, Azure, Amazon Web Services (AWS), GitHub, Salesforce, Bun, and Zig.

The image supports `linux/amd64` and `linux/arm64` container hosts. Each published release tag is a multi-platform OCI index, allowing Docker and Podman to select the matching architecture automatically.

## Prerequisites

Install Docker Engine with the Docker Compose plugin to use the local development service. The optional native ARM64 Podman user acceptance testing (UAT) workflow has separate prerequisites detailed below. To execute live cloud CLI tests, authenticate the Google Cloud and Azure CLIs on your host machine. Work only with authorized labs and customer demo environments covered by an active engagement.

Local builds require approximately ten minutes on first run due to the bundled cloud management CLIs.

## Pulling release images

Pull the latest stable release image from GHCR:

```bash
docker pull ghcr.io/f5-sales-demo/xcsh:latest
```

Tagged releases publish a versioned tag (`v<VERSION>`), a minor release tag (`<MAJOR>.<MINOR>`), and `latest`. Because registry tags can be reassigned, use the immutable OCI index digest (`ghcr.io/f5-sales-demo/xcsh@sha256:<DIGEST>`) for production deployments.

Run non-interactive commands through the container entrypoint:

```bash
docker run --rm ghcr.io/f5-sales-demo/xcsh:latest --version
docker run --rm ghcr.io/f5-sales-demo/xcsh:latest --help
```

Override the entrypoint to launch an interactive bash shell:

```bash
docker run --rm -it \
  --entrypoint /bin/bash \
  ghcr.io/f5-sales-demo/xcsh:latest
```

## Building the development service

From a local repository clone, build and launch the hardened development service:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

The service idles without running xcsh directly, mounts the repository checkout read-only at `/workspace`, and allows you to run commands on demand:

```bash
docker compose -f docker-compose.dev.yml exec xcsh-dev xcsh --help
docker compose -f docker-compose.dev.yml exec xcsh-dev bash
```

The Compose development service applies the following security controls:

- User and group identifiers default to `1000:1000`.
- All Linux kernel capabilities are dropped (`cap_drop: [ALL]`).
- The `no-new-privileges` flag blocks privilege escalation.
- The root filesystem and repository mount are read-only. Ephemeral directories (`/tmp`, xcsh state, Salesforce state) use writable tmpfs mounts. The xcsh state tmpfs mount allows executable mappings so xcsh can unpack native binaries.
- The host Docker socket and service account keys are never mounted.
- Host CLI credential directories are mounted read-only under `*-host` paths.

> [!CAUTION]
> Processes within the container can read mounted credentials. Mount credential directories only into trusted images and environments.

## Configuring the Docker Compose environment

The Docker Compose configuration and UAT scripts recognize the following environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `UID` | `1000` | Runtime user ID inside the container. |
| `GID` | `1000` | Runtime group ID inside the container. |
| `GEMINI_MODEL` | `gemini-3.1-pro-preview` | Vertex AI model targeted by live acceptance tests. |
| `VERTEX_AI_PROJECT` | Active gcloud project | Vertex AI project ID for live acceptance tests. |
| `VERTEX_AI_LOCATION` | `us-central1` | Vertex AI region for live acceptance tests. |
| `AZURE_CONFIG_DIR` | `/tmp/xcsh-azure` | Writable Azure CLI working directory inside Compose. |
| `CLOUDSDK_CONFIG` | `/tmp/xcsh-gcloud` | Writable Google Cloud CLI working directory inside Compose. |

Compose mounts host credentials into these read-only container paths:

| CLI | Host source path | Container destination path |
| --- | --- | --- |
| Google Cloud | `~/.config/gcloud` | `/home/xcsh/.config/gcloud-host` |
| Azure | `~/.azure` | `/home/xcsh/.azure-host` |
| AWS | `~/.aws` | `/home/xcsh/.aws-host` |
| GitHub | `~/.config/gh` | `/home/xcsh/.config/gh-host` |
| Salesforce | `~/.sfdx` | `/home/xcsh/.sfdx-host` |

Live tests copy required credentials into temporary directories on startup, clear them on exit, and never write state back to host mounts.

## Running verification tests

Run the deterministic end-to-end test suite without cloud credentials:

```bash
./scripts/e2e-user-install-test.sh
```

This script builds the container image, verifies unprivileged execution and security hardening settings, checks bundled CLIs, and tears down the container service without contacting external cloud APIs.

To execute tests against authorized lab credentials, supply the `--live` flag:

```bash
./scripts/e2e-user-install-test.sh --live
```

The live test suite validates Azure CLI and Vertex AI connectivity. Output is restricted to pass or fail status and does not emit tokens, account identities, subscription names, project identifiers, prompts, or model responses.

## Running native ARM64 Podman UAT

This release acceptance workflow runs on Apple Silicon macOS hosts with Podman. It verifies that the published OCI index resolves to a native ARM64 runtime and that xcsh communicates successfully with an authorized LiteLLM proxy gateway.

Prerequisites include a macOS ARM64 host, Podman, `jq`, an active Podman virtual machine, and authorized endpoint credentials.

1. Start the Podman machine and prompt for endpoint credentials:

```bash
podman machine start
read -r -p "LiteLLM base URL: " LITELLM_BASE_URL
read -r -s -p "LiteLLM API key: " LITELLM_API_KEY
printf '\n'
export LITELLM_BASE_URL LITELLM_API_KEY
```

1. Execute the acceptance harness with your target model configuration:

```bash
report="${TMPDIR:-/tmp}/xcsh-podman-arm64-uat.json"
./scripts/uat-podman-arm64.sh \
  --report "$report" \
  --model "Primary=provider/model" \
  --model "Secondary=provider/model"
```

The test harness executes one warmup request and three benchmarked requests per model by default. Tune execution using `--runs`, `--warmups`, or `--timeout-seconds`.

If your environment requires custom root certificates, pass an approved PEM certificate using `--ca-cert /path/to/ca.pem`. The certificate installs into the Podman virtual machine trust store. Remove the certificate after testing:

```bash
podman machine ssh --username root podman-machine-default \
  'rm -f /etc/pki/ca-trust/source/anchors/xcsh-uat.pem && update-ca-trust'
```

1. Stop the Podman virtual machine when testing concludes:

```bash
podman machine stop
```

## Verifying published container images

Inspect the multi-architecture manifest of a published image:

```bash
docker buildx imagetools inspect ghcr.io/f5-sales-demo/xcsh:v<VERSION>
```

Verify that both `linux/amd64` and `linux/arm64` appear in the manifest list.

To verify a running container service directly:

```bash
docker compose -f docker-compose.dev.yml exec xcsh-dev id
docker compose -f docker-compose.dev.yml exec xcsh-dev xcsh --version
docker compose -f docker-compose.dev.yml exec xcsh-dev gcloud --version
docker compose -f docker-compose.dev.yml exec xcsh-dev az version
```

## Cleaning up resources

Stop and remove the development container service and associated networks:

```bash
docker compose -f docker-compose.dev.yml down --remove-orphans
```

Test scripts run this cleanup command automatically upon completion or interruption.

## Localization policy

Author container documentation in English within `docs/en/`. Localized files are generated and maintained by automated translation workflows during major release cycles. Expected translation hash drift during standard English documentation updates is non-blocking.
