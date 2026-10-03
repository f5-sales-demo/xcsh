# Terraform documentation corpus delivery

The provider publishes exact Markdown from `documentation/` at a published stable provider
tag. Registry `docs/` projections are excluded. Snapshot releases use
`documentation-vN.N.N`, immutable assets, and `latest=false`.

The reviewed consumer contract is `tools/terraform-documentation-release.json`.
Refresh it only after verifying the published snapshot receipt, every asset,
complete archive membership, document and body hashes, metadata, relationships,
internal links, and anchors. Build twice and compare SQLite and compressed hashes
before committing the pin.

## Interface

- Inventory: `xcsh://terraform-documentation/`
- Search: `xcsh://terraform-documentation/?search=<query>&provider_type=<type>&provider_name=<name>&role=<role>&limit=<1-10>`
- Facets: `xcsh://terraform-documentation/?facet=<provider_type|provider_name|role|category|capability|task>&cursor=<value>`
- Navigation: `xcsh://terraform-documentation/?node=<document-id>&search=<optional-query>`
- Exact read: `xcsh://terraform-documentation/documentation/<path>/index.md`
- Section read: append a heading anchor or explicit schema anchor.

Inventory links to bounded, paginated facet lists of accepted provider metadata values.
The category, capability, task, provider type, provider name, and role filters combine with AND.
Ask everyday Terraform questions without namespace names, filters, or schema
paths. Search results supply ancestry and child links; exact reads list real
property anchors. Ambiguous resource choices require clarification.

Search defaults to five results and rejects duplicate or unknown parameters,
invalid limits, and queries outside 1–512 UTF-8 bytes. Results identify exact
property or section destinations. Evidence may select a leaf
or return narrowing choices; ranking values are not probabilities. Canonical pages
retain their identity, hierarchy, and exact path.

Document views use `view=hint` for navigation within 4 KiB, `view=context` for
complete sections within 16 KiB, and `view=full` for complete reads. Context reads
include continuation destinations. An indivisible oversized section returns a
notice and its full-read URI. Existing exact reads remain complete.

The Terraform corpus has its own QMD SQLite index. Its compressed artifact is
bundled with packages and binaries, verified before use, and materialized only
when the Terraform namespace is requested. Ordinary documentation and API
discovery use their existing indices.

## Verification commands

Run the normal dependency bootstrap before source assessment in a fresh worktree.
Then use the generator with a verified snapshot directory:

```sh
bun packages/coding-agent/scripts/generate-terraform-documentation-index.ts --input-dir <snapshot-directory> --update-pin
bun packages/coding-agent/scripts/generate-terraform-documentation-index.ts --input-dir <snapshot-directory>
bun packages/coding-agent/scripts/terraform-documentation-acceptance.ts
```

The installed binary accepts `XCSH_SMOKE_TEST_TERRAFORM_DOCUMENTATION=1` and must
emit `XCSH_TERRAFORM_DOCUMENTATION_SMOKE_OK`. Run it in a clean home with network
access disabled. It verifies provenance, filtered discovery, complete explicit
property reads, deep leaf navigation, and negative search behavior.

Installed model guidance must search this namespace and read relevant
fundamentals, property references, lifecycle guidance, and examples. Verify exact
citations, the bundled provider version, supported HCL fields, and the distinction
between documented validation and live apply evidence.

## Delivery sequence

Provider correction PR and release precede the first immutable snapshot. Consumer
pin and integration PR follow that snapshot. Complete consumer CI, merge, release,
Mac Homebrew acceptance, Ubuntu installed acceptance, and model-assisted scenarios
before reporting delivery complete.

Run minimal-prompt model UAT with `bun packages/coding-agent/scripts/terraform-natural-language-uat.ts --binary <installed-xcsh> --model <model> --output-dir <trace-directory>`. It tests vague login-success and existing-certificate questions, checks exact leaf reads and citations, and verifies a non-Terraform control. No namespace, filters, or schema paths are supplied in the prompts.

## Qualification gate

The consumer stays draft until a valid independently reviewed untouched 200-case
benchmark qualifies it at the retained 95% gate, followed by the frozen 40-case
installed-model subset and human acceptance. Preserve first-run failures and
labels. A suite examined during failure analysis is development or regression
evidence; later improvements do not restore held-out status. Source tests, index
determinism, cross-platform parity and low latency do not establish retrieval
accuracy. The current development and regression results remain below the gate.
