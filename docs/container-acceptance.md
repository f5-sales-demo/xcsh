# Container qualification evidence

For operating instructions, use the [published container guide](https://f5-sales-demo.github.io/xcsh/en/integrations-deployment/containers/).
The guide follows `latest` for this unreleased project. The results below qualify
only the recorded historical artifact, not later images carrying that tag.

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

## Docker local model and tool qualification

On 2026-10-18, Ubuntu Docker qualification selected `latest`, which reported
`xcsh/23.6.1`. Both `litellm/gpt-6.1-sol:medium` through Responses and
`anthropic/claude-sonnet-5` through Anthropic Messages authenticated and passed
three consecutive local tool cycles each. The six samples required actual file
search, JSON aggregation, edits, two separate persistent Python cells, and native
browser navigation. Non-root execution, the 23-plugin seed, repeated private-state
use, workspace ownership, and clean process exits also passed.

The selected local image ID was `sha256:cb04d9f536317080d104053477e0ebd394ae81e805a7177f4e68a17cc6e9ff79`. This identifies the tested artifact;
normal operating instructions continue to use `latest`.

The gateway was reachable through the Mac VPN. Ubuntu's direct route selected an
existing Docker bridge, so qualification used an explicit SSH loopback forward
through the Mac with the gateway's original TLS hostname and certificate
validation preserved. Provider and per-model endpoints were adapted only in
private disposable configuration. This qualifies that transport path; an
independent Ubuntu VPN route was not established.

This was local model/tool qualification, not a new full cloud-service matrix.
The report recorded six passing local samples and `fullSuitePassed: false`.
Credentials, gateway identity, endpoint details, and raw model events were excluded
from public evidence. See [issue #4964](https://github.com/f5-sales-demo/xcsh/issues/4964)
for delivery and cleanup evidence.

## Docker cloud-service qualification

On 2026-10-18, fresh Ubuntu Docker qualification selected `latest`, which reported
`xcsh/23.6.8`. Both `litellm/gpt-6.1-sol:medium` and
`anthropic/claude-sonnet-5` passed three complete cycles each: 42 fresh tool-backed
samples covering local tools, GitHub, AWS, Azure, Salesforce, Google Cloud, and F5
Distributed Cloud. Identity checks and authorized repository, VPC, subscription,
organization, project, and namespace reads passed separately. No resources were changed.

GitHub, AWS, and Salesforce explicit noninteractive authentication passed twice
with the same private state. Azure and Google Cloud reused imported portable
sessions. This verifies session reuse; interactive renewal after expiry was not
exercised. Salesforce's default export was redacted, so the private export used
the documented temporary secret-export option. No exported values entered the
workspace or public evidence.

The runtime check, both model requests, repeated launches, file ownership, search,
JSON aggregation, edits, persistent Python cells, native browser navigation, and
clean exits passed. The selected image ID was `sha256:72e845da7c2ed659e4658e806f67c3ed0a176b041827194fe6fbdeb6ae868634`.
This records the observed artifact; installation procedures continue to use `latest`.
Model transport used an explicit SSH loopback forward through the Mac VPN with the
original TLS hostname and certificate verification preserved. Cloud-service reads
used the container's available service routes.

GitLab and Firecrawl retain their previous user-directed deferrals. The selected
six-service matrix passed; `fullSuitePassed` remains false because those services
were omitted. Remote desktop, hypervisor, meeting, terminal, SSH integration,
and interactive expired-session renewal remain separate acceptance gates.
Credentials, account identifiers, resource metadata, raw events, temporary forwarding,
and disposable runtime state were removed after verification. See
[issue #5001](https://github.com/f5-sales-demo/xcsh/issues/5001) for delivery evidence.

## Refreshed latest container qualification

After the canonical Terraform corpus refresh and citation-provenance repairs
[#5003](https://github.com/f5-sales-demo/xcsh/pull/5003) and
[#5005](https://github.com/f5-sales-demo/xcsh/pull/5005), the release workflow published
`23.6.9`. On 2026-10-18, a fresh Ubuntu Docker pull of `latest` reported
`xcsh/23.6.9` and passed all 42 new tool-backed samples: three complete cycles
per model for `litellm/gpt-6.1-sol:medium` and `anthropic/claude-sonnet-5`, covering
local tools and the same six services qualified above. Every sample used fresh
tool calls; earlier qualification results were not reused.

The runtime, both model requests, separate service identity and resource reads,
repeated GitHub/AWS/Salesforce login, portable Azure/Google Cloud session reuse,
workspace ownership, repeated state, persistent Python, native browser, and clean
exits passed. GitLab and Firecrawl remain deferred, so `fullSuitePassed` remains
false. Interactive expired-session renewal and remote integrations retain their
separate acceptance gates.

The published two-platform index was
`sha256:44c13ba476ae5545c381e8467f8a628a3f3f34b3feceee88e8b3568bb242d92a`.
The tested AMD64 image ID was `sha256:f1e04359506f5eda3ba4ceed51f5b4e310928517e3a92322d93f0286512bc53f`.
These identify the observed qualification artifact; operating instructions
continue to use `latest`. The refreshed provider/documentation source was
`v15.12.0`; API `v12.1.3` remained current. Full-main CI, native AMD64/ARM64
container builds, and the container runtime gate passed before publication.

The model path retained verified TLS through the private Mac VPN forward described
above. Credentials, raw events, fixture state, temporary inputs, and the owned
forward were removed after acceptance. See
[issue #5008](https://github.com/f5-sales-demo/xcsh/issues/5008) and
[corpus follow-up #4975](https://github.com/f5-sales-demo/xcsh/issues/4975)
for delivery evidence and package-channel acceptance status.
