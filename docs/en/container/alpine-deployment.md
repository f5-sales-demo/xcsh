---
title: Alpine container deployment and multi-cloud authentication
description: Complete guide for configuring environment variables, running xcsh securely inside Alpine containers, and integrating multi-cloud Command Line Interface (CLI) credentials.
---

`xcsh` is distributed as a security-hardened, multi-stage Alpine Linux container image published automatically to GitHub Container Registry (GHCR) at `ghcr.io`.

It ships pre-packaged with all required marketplace Command Line Interface (CLI) tools—including Google Cloud SDK (`gcloud`), Azure CLI (`az`), AWS CLI (`aws`), GitHub CLI (`gh`), Salesforce CLI (`sf`), and Bun—allowing seamless cloud shell execution from any container host.

## Prerequisites

Before starting this deployment, ensure you have:

- Docker Engine installed and running on your host machine.
- Local cloud CLI credentials initialized on your host (for example, `~/.config/gcloud`, `~/.aws`, `~/.azure`).
- Access to pull images from `ghcr.io/example-corp/xcsh`.
- Estimated time to complete: **10 minutes**.

## Quickstart

### Pull the container image from GHCR

The latest container image is built and published automatically on every release:

```bash
docker pull ghcr.io/example-corp/xcsh:latest
```

### Run with Docker Compose

Use `docker-compose.dev.yml` to launch `xcsh` with mounted cloud CLI credentials:

```bash
docker compose -f docker-compose.dev.yml up -d
```

To execute interactive shell sessions inside the container:

```bash
docker compose -f docker-compose.dev.yml exec xcsh-dev bash
```

## Environment variables reference

`xcsh` supports granular environment variable configuration for Enterprise AI routing, cloud project resolution, and container paths:

| Environment Variable | Default Value | Description / Purpose |
| :--- | :--- | :--- |
| `GEMINI_MODEL` | `gemini-3.1-pro-preview` | Primary Enterprise Pro model for complex reasoning and planning. |
| `GEMINI_FLASH_MODEL` | `gemini-3.6-flash-high` | Primary Enterprise Flash model for fast tool execution and terminal tasks. |
| `VERTEX_AI_PROJECT` | *(Dynamically Resolved)* | Google Cloud Project ID hosting Vertex AI endpoints. Automatically fetched via `gcloud config` if omitted. |
| `VERTEX_AI_LOCATION` | `us-central1` | Google Cloud region for Vertex AI Enterprise API requests. |
| `REQUIRE_ENTERPRISE_AUTH` | `true` | Enforces corporate Enterprise quota. Fails fast if free-tier fallback is attempted. |
| `AZURE_CONFIG_DIR` | `/home/xcsh/.azure` | Directory path inside the container for mounted Azure CLI credentials. |
| `GOOGLE_APPLICATION_CREDENTIALS` | `/app/xcsh/.secrets/gcp-sa.json` | Path to Google Service Account JSON key if using explicit Application Default Credentials (ADC). |
| `HOME` | `/home/xcsh` | Home directory path for non-root execution user `xcsh`. |
| `NODE_ENV` | `development` | Runtime execution environment mode. |

## How to run the container securely

Running AI coding containers securely requires restricting container process privileges, preventing setuid escalation, and safeguarding host cloud credentials.

### Enforce non-root execution

By default, `xcsh` runs as non-root user `xcsh` (User ID (UID) `1000`, Group ID (GID) `1000`). When running with `docker run` or `docker compose`, pass your host UID and GID so generated files match host user permissions:

```bash
docker run -it --user 1000:1000 ghcr.io/example-corp/xcsh:latest bash
```

### Prevent privilege escalation

Block container processes from gaining elevated privileges via `setuid` binaries by setting `security_opt`:

```bash
docker run -it \
  --user 1000:1000 \
  --security-opt no-new-privileges:true \
  ghcr.io/example-corp/xcsh:latest bash
```

### Mount credentials read-only

Mount local host CLI credentials read-only to prevent the container from corrupting or modifying host auth state:

```bash
docker run -it \
  --user 1000:1000 \
  --security-opt no-new-privileges:true \
  -v ~/.config/gcloud:/home/xcsh/.config/gcloud:ro \
  -v ~/.azure:/home/xcsh/.azure:ro \
  -v ~/.aws:/home/xcsh/.aws:ro \
  -v ~/.config/gh:/home/xcsh/.config/gh:ro \
  -v ~/.sfdx:/home/xcsh/.sfdx:ro \
  ghcr.io/example-corp/xcsh:latest bash
```

### Production security-hardened compose pattern

```yaml
services:
  xcsh-dev:
    image: ghcr.io/example-corp/xcsh:latest
    container_name: xcsh-dev
    user: "${UID:-1000}:${GID:-1000}"
    security_opt:
      - no-new-privileges:true
    volumes:
      - .:/app/xcsh
      # Read-only multi-cloud credential mounts
      - ~/.config/gcloud:/home/xcsh/.config/gcloud:ro
      - ~/.azure:/home/xcsh/.azure:ro
      - ~/.aws:/home/xcsh/.aws:ro
      - ~/.config/gh:/home/xcsh/.config/gh:ro
      - ~/.sfdx:/home/xcsh/.sfdx:ro
    environment:
      - HOME=/home/xcsh
      - GEMINI_MODEL=gemini-3.1-pro-preview
      - GEMINI_FLASH_MODEL=gemini-3.6-flash-high
      - REQUIRE_ENTERPRISE_AUTH=true
      - AZURE_CONFIG_DIR=/home/xcsh/.azure
    command: tail -f /dev/null
```

## Multi-cloud CLI credential integration

`xcsh` automatically inherits authenticated contexts from your local host machine without storing static credentials in image layers or environment variables:

| Cloud Platform | Local Host Path | Container Mount Path | Verification Command |
| :--- | :--- | :--- | :--- |
| Google Cloud / Gemini | `~/.config/gcloud` | `/home/xcsh/.config/gcloud` | `gcloud auth print-access-token` |
| Microsoft Azure | `~/.azure` | `/home/xcsh/.azure` | `az account show` |
| Amazon Web Services | `~/.aws` | `/home/xcsh/.aws` | `aws sts get-caller-identity` |
| GitHub CLI | `~/.config/gh` | `/home/xcsh/.config/gh` | `gh auth status` |
| Salesforce CLI | `~/.sfdx` | `/home/xcsh/.sfdx` | `sf org list` |

## Enterprise AI routing and privacy guarantees

`xcsh` connects directly to Enterprise Vertex AI endpoints (`gemini-3.1-pro-preview` and `gemini-3.6-flash-high`):

- **Zero Data Retention (ZDR)**: Enterprise data and prompts are never stored or used for model training.
- **Strict Policy Enforcement**: Free-tier model fallbacks are explicitly disabled (`REQUIRE_ENTERPRISE_AUTH=true`).
- **Personally Identifiable Information (PII) Redaction**: Email usernames and domain names are automatically masked (`us***@***.***`) in all terminal logging outputs.

## Verify

To confirm that your container environment is running securely with active cloud authentication:

Run the master container UAT test suite inside the container:

```bash
bash ./scripts/uat-all.sh
```

Expected output confirms clean authentication and prompt translation:

```text
=== All Container UAT Verification Tests Passed! ===
```

## Clean up

To remove the container and tear down the environment:

```bash
docker compose -f docker-compose.dev.yml down
```

## Automated CI translation pipeline

All user-facing documentation is authored in English under `docs/en/`.

When changes are committed to `docs/en/**/*.md`, GitHub Actions (`.github/workflows/antigravity-translate.yml`) automatically orchestrates Continuous Integration (CI) translation into 12 target locales:

- French (`fr`), Spanish (`es`), German (`de`), Portuguese (`pt-br`)
- Japanese (`ja`), Korean (`ko`), Chinese Simplified (`zh-cn`), Chinese Traditional (`zh-tw`)
- Arabic (`ar`), Italian (`it`), Hindi (`hi`), Thai (`th`)

Each translated document maintains a cryptographic source hash (`i18n.sourceHash`) to guarantee translations remain perfectly synchronized with English source updates.
