---
title: Run xcsh containers with Docker and Podman
description: Build or run the non-root xcsh Alpine image with Docker, Compose, or native ARM64 Podman UAT.
---

A `v*` xcsh tag triggers publication to GitHub Container Registry (GHCR) as
`ghcr.io/f5-sales-demo/xcsh`. The image runs as the unprivileged `xcsh` user
and includes the xcsh, Google Cloud, Azure,
Amazon Web Services (AWS), GitHub, Salesforce, Bun, and Zig command-line
interfaces (CLIs).

The image supports `linux/amd64` and `linux/arm64` hosts. Each release tag is a
multi-platform image, so Docker selects the matching architecture automatically.

## Prerequisites

Install Docker Engine with the Compose plugin to use the development service.
The optional native ARM64 Podman UAT has separate prerequisites below. To run
the optional Compose live tests, authenticate the Google Cloud and Azure CLIs
on your host. Use only authorized labs or customer demo environments covered by an
engagement.

Allow about 10 minutes for the first local build. The cloud CLIs make the image
substantially larger than a minimal xcsh-only runtime.

## Pull a release image

After a tagged release finishes, pull the most recent stable image:

```bash
docker pull ghcr.io/f5-sales-demo/xcsh:latest
```

For stable release tags, publication creates a versioned `vX.Y.Z` tag, a moving
`X.Y` tag, and `latest`. Registry tags can be repointed. For an immutable
deployment reference, resolve and use the published OCI index digest in the
form `ghcr.io/f5-sales-demo/xcsh@sha256:<digest>`.

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

## Configure the Docker Compose environment

The Docker Compose development and live user acceptance testing (UAT) scripts
use these variables:

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

To test already-authorized lab credentials, opt in explicitly:

```bash
./scripts/e2e-user-install-test.sh --live
```

The live path verifies Azure CLI and Vertex AI access. It reports only pass or
fail status; it does not print tokens, account identities, tenant or subscription
names, project IDs, prompts, or model responses.

## Run native ARM64 Podman UAT

This optional release-acceptance workflow runs on an Apple Silicon Mac with
Podman. It validates that the published OCI index resolves to a native ARM64
runtime and that xcsh can make an authorized, deterministic request through an
operator-supplied LiteLLM-compatible gateway. It is separate from the Docker
Compose development service.

Run it from a checkout that contains `scripts/uat-podman-arm64.sh`. You need a
macOS ARM64 host, Podman, `jq`, a running Podman machine, and credentials for
an endpoint that you are authorized to test. Do not put endpoint details or API
keys in shell history, source control, issue reports, or the generated report.

Start the machine, then collect the connection values without echoing the API
key:

```bash
podman machine start
read -r -p "LiteLLM base URL: " LITELLM_BASE_URL
read -r -s -p "LiteLLM API key: " LITELLM_API_KEY
printf '\n'
export LITELLM_BASE_URL LITELLM_API_KEY
```

Supply a model matrix appropriate for your own implementation. Each repeatable
`--model` value uses `LABEL=PROVIDER/MODEL`; supplying one or more values
replaces the harness defaults:

```bash
report="${TMPDIR:-/tmp}/xcsh-podman-arm64-uat.json"
./scripts/uat-podman-arm64.sh \
  --report "$report" \
  --model "Primary=provider/model" \
  --model "Secondary=provider/model"
```

The harness uses one warmup and three measured requests per model by default.
Use `--runs`, `--warmups`, or `--timeout-seconds` to tune that workload. Use
`--image REF` only for an image that satisfies the repository's current release
contract; the harness is not a general compatibility test for arbitrary image
versions.

Some environments require an additional registry CA. Pass only an approved PEM
certificate with `--ca-cert /path/to/ca.pem`; TLS verification remains enabled.
The certificate is installed in the default Podman VM trust store and persists
after the run. Remove it when it is no longer needed:

```bash
podman machine ssh --username root podman-machine-default \
  'rm -f /etc/pki/ca-trust/source/anchors/xcsh-uat.pem && update-ca-trust'
```

A passing run verifies the ARM64 manifest, native `aarch64` runtime, release
version contract, exact acceptance response, and resolved provider/model
attribution. The JSON report records only metadata, configuration, and pass/fail
results; it excludes API keys, raw prompts, and raw model responses.

The pull-request workflow runs native Docker container checks for both Linux
architectures and a credential-free contract test for this harness. It does not
run the credentialed macOS Podman request in CI.

Stop the Podman machine when it is no longer needed. This preserves the image
cache and the report file while releasing the VM resources:

```bash
podman machine stop
```

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
