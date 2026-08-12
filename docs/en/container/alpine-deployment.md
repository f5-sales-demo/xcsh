---
title: Run xcsh in an Alpine container
description: Build or run the non-root xcsh Alpine image and optionally verify mounted cloud CLI sessions.
---

Tagged xcsh releases publish an image to GitHub Container Registry (GHCR) as
`ghcr.io/f5-sales-demo/xcsh`. The first package becomes available when a `v*`
release tag runs the container workflow from the default branch. The image runs
as the unprivileged `xcsh` user and includes the xcsh, Google Cloud, Azure,
Amazon Web Services (AWS), GitHub, Salesforce, Bun, and Zig command-line
interfaces (CLIs).

The image supports `linux/amd64` and `linux/arm64` hosts. Each release tag is a
multi-platform image, so Docker selects the matching architecture automatically.

## Prerequisites

Before you begin, install Docker Engine with the Compose plugin. To run the
optional live tests, authenticate the Google Cloud and Azure CLIs on your host.
Use only F5-owned labs or customer demo environments covered by an engagement.

Allow about 10 minutes for the first local build. The cloud CLIs make the image
substantially larger than a minimal xcsh-only runtime.

## Pull a release image

After a tagged release finishes, pull the most recent stable image:

```bash
docker pull ghcr.io/f5-sales-demo/xcsh:latest
```

Releases also publish immutable `vX.Y.Z` tags and moving `X.Y` tags. Prefer a
published immutable tag when reproducibility matters, for example
`ghcr.io/f5-sales-demo/xcsh:vX.Y.Z` after replacing `X.Y.Z` with a release
version.

Run a non-interactive command through the image entrypoint:

```bash
docker run --rm ghcr.io/f5-sales-demo/xcsh:latest --version
docker run --rm ghcr.io/f5-sales-demo/xcsh:latest --help
```

Override the entrypoint when you need a shell:

```bash
docker run --rm -it \
  --entrypoint /bin/bash \
  ghcr.io/f5-sales-demo/xcsh:latest
```

## Build the development service

From an xcsh repository checkout, build and start the hardened development
service:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

The service idles without invoking xcsh, mounts the checkout read-only at
`/workspace`, and lets you run commands explicitly:

```bash
docker compose -f docker-compose.dev.yml exec xcsh-dev xcsh --help
docker compose -f docker-compose.dev.yml exec xcsh-dev bash
```

The Compose service applies these controls:

- User and group IDs default to `1000`.
- All Linux capabilities are dropped.
- `no-new-privileges` blocks privilege escalation.
- The image filesystem and source checkout are read-only. The `/tmp`, xcsh,
  and Salesforce state paths use writable, ephemeral temporary filesystems.
  The xcsh state mount permits executable mappings because xcsh extracts its
  embedded native module there.
- The Docker socket and static service-account keys are not mounted.
- Host CLI configuration directories are mounted read-only under `*-host` paths.

Read-only credentials can still be read by processes in the container. Mount
them only into images and source trees you trust.

## Configure the environment

The development and live user acceptance testing (UAT) scripts use these
variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `UID` | `1000` | Runtime user ID used by Compose. |
| `GID` | `1000` | Runtime group ID used by Compose. |
| `GEMINI_MODEL` | `gemini-3.1-pro-preview` | Vertex AI model tested by live UAT. |
| `VERTEX_AI_PROJECT` | Active gcloud project | Vertex AI project tested by live UAT. |
| `VERTEX_AI_LOCATION` | `us-central1` | Vertex AI location tested by live UAT. |
| `AZURE_CONFIG_DIR` | `/tmp/xcsh-azure` | Writable Azure CLI session directory inside Compose. |
| `CLOUDSDK_CONFIG` | `/tmp/xcsh-gcloud` | Writable Google Cloud CLI session directory inside Compose. |

Compose mounts host configuration into these read-only source paths:

| CLI | Host path | Container source path |
| --- | --- | --- |
| Google Cloud | `~/.config/gcloud` | `/home/xcsh/.config/gcloud-host` |
| Azure | `~/.azure` | `/home/xcsh/.azure-host` |
| AWS | `~/.aws` | `/home/xcsh/.aws-host` |
| GitHub | `~/.config/gh` | `/home/xcsh/.config/gh-host` |
| Salesforce | `~/.sfdx` | `/home/xcsh/.sfdx-host` |

The live tests copy only the required Google Cloud and Azure configuration into
private temporary directories. They delete those copies on exit and never write
session state into the host mounts.

## Run verification

Run the deterministic end-to-end test without cloud credentials:

```bash
./scripts/e2e-user-install-test.sh
```

This path builds the image, verifies the non-root identity and hardening
settings, checks every bundled CLI, and tears down the service. It does not call
Azure or Vertex AI.

To test already-authorized F5 lab credentials, opt in explicitly:

```bash
./scripts/e2e-user-install-test.sh --live
```

The live path verifies Azure CLI and Vertex AI access. It reports only pass or
fail status; it does not print tokens, account identities, tenant or subscription
names, project IDs, prompts, or model responses.

## Verify

Inspect a published tag to confirm that both Linux architectures are available:

```bash
docker buildx imagetools inspect ghcr.io/f5-sales-demo/xcsh:vX.Y.Z
```

The manifest must list `linux/amd64` and `linux/arm64`. Replace `X.Y.Z` with the
published release version.

Inspect the running service directly when troubleshooting:

```bash
docker compose -f docker-compose.dev.yml exec xcsh-dev id
docker compose -f docker-compose.dev.yml exec xcsh-dev xcsh --version
docker compose -f docker-compose.dev.yml exec xcsh-dev gcloud --version
docker compose -f docker-compose.dev.yml exec xcsh-dev az version
```

The identity output must show user and group ID `1000`. The xcsh and cloud CLI
commands must exit successfully.

## Clean up

Remove the development service and network:

```bash
docker compose -f docker-compose.dev.yml down --remove-orphans
```

The test scripts perform the same teardown automatically on success, failure,
or interruption.

## Localized documentation

Author container documentation in English under `docs/en/`. Localized files are
managed automation output and are refreshed only for an eligible major release
unless an exceptional translation run is explicitly requested. Expected locale
drift during ordinary English development is not a blocking failure.
