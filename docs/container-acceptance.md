# Rootless xcsh with Podman

The marketplace image contains 23 cached plugins, AWS CLI v2, Azure CLI with
Resource Graph, Google Cloud CLI, Salesforce CLI, GitHub and GitLab CLIs,
Terraform, SSH, Bash, cURL, Git, jq, ripgrep, Bun, Node, managed Python, and
native headless Chromium. The build manifest at `/opt/xcsh/build-manifest.json`
records versions, source provenance, dependency inventories, and checksums.

Use `scripts/xcsh-podman` with Python 3 and Podman installed on the Mac. Launcher
options precede the command; arguments after `run` pass unchanged to xcsh.

```sh
scripts/xcsh-podman setup
scripts/xcsh-podman --cpus 4 --memory 8192 --disk-size 40 setup
scripts/xcsh-podman --image "$XCSH_IMAGE" --workspace "$PWD" run --help
```

Setup reuses an existing machine or creates a rootless AppleHV machine with four
CPUs, 8 GiB of RAM, and a 40 GiB sparse disk. It requires no host sudo or
privileged Podman helper. `--machine` selects a machine; `--connection` or
`XCSH_PODMAN_CONNECTION` selects its connection for subsequent commands. Setup
verifies rootless operation and actual connectivity before reporting success.

## Model routing and private state

Select an image explicitly with `--image` or `XCSH_IMAGE`. Use an immutable
`repository@sha256:…` reference for published acceptance. Retain the previously
published digest to restore the prior image; keep a separate state volume when
testing rollback or upgrades.

```sh
scripts/xcsh-podman --image "$XCSH_IMAGE" \
  --import-native "$HOME/.xcsh/agent" --workspace "$PWD" \
  --state xcsh-private-state run --model litellm/gpt-6.1-sol:medium
```

The import copies provider definitions, model roles, discovery settings, and
routing settings into private container state once. It preserves the native
files and the imported Responses and Anthropic routes. Literal credentials and
shell-backed credential commands become runtime environment references.
Provide `LITELLM_API_KEY` for the gateway providers; other provider credentials
use `XCSH_PROVIDER_NAME_API_KEY`, with NAME uppercase and punctuation replaced
by underscores. Use `--env NAME` to forward additional named inputs.

`XCSH_MODEL` selects the model unless the forwarded arguments explicitly include
`--model`. The reference models are `litellm/gpt-6.1-sol:medium` and
`anthropic/claude-sonnet-5`.

The image runs as UID/GID 1000 with a read-only filesystem, dropped capabilities,
and no new privileges. Podman maps the current user's identity to that container
identity. Only the selected workspace, private home/state, and temporary storage
are writable. A named volume is the default state; an explicit state directory
must belong to the invoking user with mode 0700. First launch publishes the
complete plugin seed atomically. Subsequent launches preserve settings, disabled
plugins, uninstalls, and plugin upgrades. Use xcsh's normal plugin lifecycle for
upgrades; a newer image does not silently replace existing plugin state.

## Authentication

Ordinary startup never invokes account login. Explicit portable mounts are copied
once into container-owned state so vendor CLIs can refresh their sessions:

```sh
scripts/xcsh-podman --image "$XCSH_IMAGE" --credential aws="$HOME/.aws" \
  --credential azure="$HOME/.azure" run
scripts/xcsh-podman --image "$XCSH_IMAGE" --env-file "$PRIVATE_ENV_FILE" \
  auth login azure --noninteractive
scripts/xcsh-podman --image "$XCSH_IMAGE" auth login gcloud
```

Supported portable directory names for `--credential SERVICE=PATH` are `github`,
`gitlab`, `aws`, `azure`, `salesforce`, `gcloud`, and `ssh`. Portable Salesforce state is a
private directory containing the current CLI's `.sf` settings and `.sfdx`
authentication files and encryption key:

```sh
scripts/xcsh-podman --image "$XCSH_IMAGE" \
  --credential salesforce="$PRIVATE_ORG_STATE_BUNDLE" run
```

Mac keychain-backed Salesforce sessions need explicit login or a private auth URL
export. Mount files such as a service
account or JWT key explicitly with `--mount SOURCE:CONTAINER_PATH:ro`, and set the
corresponding environment path to the container path. No credential directory
is mounted automatically.

| Service | Inputs |
| --- | --- |
| LiteLLM | `LITELLM_BASE_URL`, `LITELLM_API_KEY`, imported provider routes |
| GitHub | `GH_TOKEN` or `GITHUB_TOKEN`, portable configuration, explicit login |
| GitLab | `GITLAB_TOKEN`, `GITLAB_HOST`, portable configuration, explicit login |
| AWS | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`, region/profile variables, portable profiles and SSO cache |
| Azure | `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, optional `AZURE_SUBSCRIPTION_ID`, portable configuration, device-code login |
| Salesforce | `SF_AUTH_URL`; `SF_ACCESS_TOKEN` plus `SF_INSTANCE_URL`; or `SF_CLIENT_ID`, `SF_USERNAME`, `SF_JWT_KEY_FILE`, optional instance URL; portable org state |
| Google Cloud | Portable configuration, `GOOGLE_APPLICATION_CREDENTIALS`, explicit login |
| F5 Distributed Cloud | `XCSH_API_URL`, `XCSH_API_TOKEN`, `XCSH_TENANT` |
| Firecrawl | `FIRECRAWL_API_URL`, applicable `FIRECRAWL_API_KEY`; use `host.containers.internal` for a Mac-hosted service |

A CLI identity check does not prove repository, subscription, project, or tenant
authorization. Mac keychain-bound credentials cannot be made portable merely by
copying their configuration files. Use explicit container login or an authorized
portable token import. Authentication failures retain vendor output privately
and report categories without rendering secrets.

Recent Salesforce CLIs redact `org display` credentials by default. Where the
installed version supports `SF_TEMP_SHOW_SECRETS`, set it only for an explicit
export into an owner-only private file, then supply the resulting auth URL to
container login. Never include that export in acceptance reports or source files.

## Proxies and certificate trust

The launcher forwards configured HTTP/HTTPS/ALL proxy and NO_PROXY variables.
Chromium uses the configured HTTPS/HTTP proxy by default;
`PUPPETEER_PROXY` overrides its browser proxy. Pass `--ca-cert PATH` to setup
for Podman registry trust in the guest and to run for xcsh and vendor CLI trust.
Runtime trust uses a private combined CA bundle and Chromium's private NSS store.
Never disable TLS verification to get an acceptance pass.

For a local build, supply corporate trust as a secret:

```sh
podman build --platform linux/arm64 --build-arg TARGETARCH=arm64 \
  --secret id=github_token,env=GH_TOKEN \
  --secret id=corporate_ca,src="$PRIVATE_CA_BUNDLE" \
  -f Dockerfile.debian --target runtime -t xcsh-candidate .
```

Build-time CA bundles are temporary and removed in the same build step.
Credentials and corporate certificates must stay outside the build context,
image layers, version control, and public reports.

## Acceptance and remote integrations

Use an empty dedicated workspace; the test command creates fixture files there.
The report contains only outcomes, counts, timing, resolved provider/model/API,
and artifact hashes. Raw model events remain in an owner-only temporary directory.

```sh
scripts/xcsh-podman --image "$XCSH_IMAGE" --workspace "$EMPTY_TEST_WORKSPACE" \
  --state xcsh-acceptance-state --import-native "$HOME/.xcsh/agent" \
  test --expected-version "$XCSH_VERSION" --report "$PRIVATE_REPORT" --live
```

For an unpublished local image, add `--candidate` after `test`. The runner freezes
the inspected image ID before invoking tools. Published acceptance requires the
selected digest to match the pulled image.

The matrix defaults to three consecutive runs per reference model. It requires
actual successful tool calls for file search, JSON aggregation, editing,
persistent Python cells, and browser navigation. Live tests exercise GitHub,
GitLab, AWS, Azure Resource Graph, Salesforce Organization metadata, Google Cloud
project access, F5 tenant inventory, and Firecrawl. A text assertion without tool
results cannot pass. Omitting `--live` cannot produce a full acceptance pass.
The runner uses `--require-tool-call` to request fresh execution. Providers that
support required tool choice receive one required call before ordinary routing
resumes. Providers configured for automatic tool choice receive at most two
corrective follow-ups if they return text without executing a tool. Missing or
failed execution still fails acceptance.
Use `--live --defer-service firecrawl` when Firecrawl acceptance is explicitly
deferred. The report lists `deferredServices`; `passed` covers the selected
gates, while `fullSuitePassed` remains false when any service is deferred.
GitLab and Firecrawl live qualification are deferred for this delivery; use
`--live --defer-service gitlab --defer-service firecrawl` for the agreed matrix.
Missing credentials, project selection, or scoped authorization remain unfinished
gates. `uat-podman-arm64.sh` is a model-route smoke test; it requires
an explicit immutable image and expected version and does not replace this matrix.

KVM, Xorg, Zoom, Herdr, Ghostty, and devcontainer integrations are cached. Host
operations need their supported remote context and that host's own prerequisites.
The container does not install a desktop, hypervisor, or meeting application.
Local status may explain unavailable dependencies; use the integration's normal
remote-context workflow for supported host operations.

If Podman starts but its connection fails, inspect `podman machine list`, the
selected system connection, and the guest startup log. Preserve an existing
machine's state. In a tool-managed shell, keep the VM launch session alive while
acceptance runs; terminating that session can terminate its guest processes.
A successful start message alone does not pass setup acceptance.

## Qualification status

Published version `23.6.0` passed the agreed 42-case matrix in fresh private state
on the ARM64 Mac: three complete cycles per configured model, with successful
local tools and live GitHub, AWS, Azure, Salesforce, Google Cloud, and F5 reads.
GitLab and Firecrawl are deferred by user instruction; their plugins remain bundled.

Immutable image:
`ghcr.io/f5-sales-demo/xcsh@sha256:a2430b2cab35ac61259a54915f750ecda644efe014dc290f4ac022402f161159`.
The native ARM64 and AMD64 release builds, runtime qualification, provenance,
SBOM, and two-platform index verification passed in container workflow run
`39079735542`. The published ARM64 image uses 3,536,707,590 unpacked bytes.
The fresh runtime verification completed in 2.771 seconds.

Published-image Mac checks also passed real HTTPS Chromium navigation with the
selected CA, workspace writes owned by the Mac user, interactive terminal rendering,
draft cancellation, and clean explicit exit. No host sudo or privileged helper was used.
Private authentication persisted across repeated launches. Python gateway locks use
private temporary storage because process identifiers change across containers.

The final ARM64 candidate used 1,018,595,366 compressed layer bytes and
3,548,024,442 unpacked bytes. Native AMD64 comparison selected Debian at
1,063,470,609 compressed bytes versus Alpine at 1,082,309,553 bytes.
The plugin seed occupied 11,500 KiB. The launcher defaults remain 4 CPUs,
8 GiB memory, and a 40 GiB sparse disk. Repeated builds in the acceptance VM
required expanding its disk to 60 GiB; installed-image acceptance used private
state in that existing rootless machine.

Rollback image retained:
`ghcr.io/f5-sales-demo/xcsh@sha256:7eb3dc53c014248ade2642a84f54bb4edef8ea42cfb7bf24e625e79699e83d17`.

The local commit hook checks ShellCheck, CI-pinned shfmt 3.13.1, and documentation
authority before TypeScript validation. Missing linters and findings fail locally;
source-only changes cannot bypass documentation checks.
