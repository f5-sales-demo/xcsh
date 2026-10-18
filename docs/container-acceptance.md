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
