# Provider-Agnostic Dynamic Model Routing

## Executive status

The production router is implemented at the `AgentSession` boundary. It supports explicit provider-qualified pools, utility/balanced/frontier tiers, off/shadow/auto modes, deterministic and hybrid classification, context eligibility, hysteresis, manual pins, escalation and rollback, read-only delegation, persistence, telemetry, and route commands.

The authenticated routing-matrix harness has been redesigned under issue #3114. Its deterministic and mocked-network evidence is authoritative for code paths, but the project is not empirically complete until a clean exact-`origin/main` report proves all five required lanes through real authenticated inference.

CI, unit tests, dry runs, bundled catalog entries, missing-credential BLOCKED results, and completion-auditor statements are not live acceptance evidence.

## Scope and non-goals

The canonical profile requires direct OpenAI, direct Anthropic, LiteLLM OpenAI-family, LiteLLM Anthropic-family, and an explicitly configured Google Vertex pool. Four scenarios and three repetitions produce 60 measured rows; one warmup per lane produces five warmup rows.

Other providers may opt in only through explicit capability and tier-pool configuration. Untiered providers remain on their selected model. Model names never imply tiers.

This work does not add translations, infer gateway upstream providers, treat Azure credentials as direct OpenAI credentials, substitute unavailable tier models, or run paid inference before deterministic gates pass.

## Runtime architecture

```text
AgentSession
  -> RoutingCoordinator
  -> deterministic/hybrid profiler
  -> explicit pool and live model candidates
  -> capability/context resolver
  -> state machine and hysteresis
  -> model switch or shadow decision
  -> bounded read-only delegation
  -> outcome, escalation, rollback
  -> persistence and sanitized telemetry
```

Manual selection is a hard pin until `/route auto`. Context and capability floors can promote but not demote. Downshifts require consecutive lower-tier profiles. Retry fallback and context-overflow handling remain emergency mechanisms. Delegation is read-only, bounded, non-recursive, cancellable, and token-accounted.

The harness is a separate evidence pipeline:

```text
CLI profile
  -> lane capabilities
  -> credential resolvers
  -> provider inventory adapters
  -> per-lane tier reconciliation
  -> warmup rows
  -> measured routing and inference rows
  -> evidence classifier
  -> schema validation, recursive redaction, secret scan
  -> external report and hash receipt
```

## Provider capability model

| Lane | Client transport | Family | Pool | Inventory | Authentication | Attribution |
| --- | --- | --- | --- | --- | --- | --- |
| `openai` | OpenAI Responses | OpenAI | `openai/gpt-5.6` | Authenticated OpenAI `/v1/models` | Existing xcsh direct OpenAI resolver | Endpoint, request, client, raw response model |
| `anthropic` | Anthropic Messages | Anthropic | `anthropic/claude` | Authenticated Anthropic `/v1/models` | Existing xcsh API-key/OAuth resolver with LiteLLM fallback disabled | Endpoint, request, client, raw response model |
| `litellm-openai` | OpenAI-compatible | OpenAI | `litellm/openai` | Its own authenticated LiteLLM endpoint | Lane-specific key/base URL, then xcsh LiteLLM resolver | Endpoint, request, client, raw response model; upstream provider may be unproven |
| `litellm-anthropic` | Anthropic Messages-compatible | Anthropic | `litellm/anthropic` | Its own authenticated LiteLLM endpoint | Separate Anthropic-compatible base URL and LiteLLM credential | Endpoint, request, client, raw response model; upstream provider may be unproven |
| `google-vertex` | Vertex | Google | `google-vertex/gemini` | Authenticated Model Garden publisher list | Real ADC access token and project/location | Endpoint, request, and client; the current SDK stream does not expose a response-reported model |

Lane identity is independent of provider name. This keeps direct Anthropic and Anthropic-over-LiteLLM distinct.

`AssistantMessage.provider` and `model` remain client/request fields for compatibility. Optional `responseAttribution` records server evidence only. Missing server evidence remains absent and fails lanes that declare response-model proof mandatory.

## Inventory architecture

Four inventories remain distinct:

1. Bundled catalog metadata, which can inform display, context, and cost only.
2. Explicit configured utility/balanced/frontier models.
3. Models returned by the lane's authenticated live endpoint.
4. Eligible candidates: configured tiers intersected with that same lane's live inventory and runtime constraints.

All three tiers must exist for every canonical lane. Candidate inventories are never combined across endpoints.

Inventory states are `AVAILABLE`, `BLOCKED_AUTH`, `BLOCKED_NETWORK`, `BLOCKED_RATE_LIMIT`, `UNSUPPORTED_DISCOVERY`, `FAIL_SCHEMA`, `FAIL_EMPTY_INVENTORY`, and `FAIL_MISSING_TIERS`. Dry-run inventory is `SIMULATED`. No failed live state falls back to bundled success.

## Evidence and benchmark contract

Evidence is recorded separately for requested model, routing-selected tier/model, client provider, endpoint fingerprint, server-reported response model, server-reported upstream provider when available, stop reason, usage, exact content, and multimodal consumption.

LiteLLM authority is capability-relative: a report may establish endpoint, request, client, response model, tier, usage, and content while stating that the true gateway upstream provider is unproven. The report must never infer it.

Statuses:

- `PASS`: every required assertion for the row passed.
- `FAIL`: deterministic routing, schema, attribution, stop, usage, content, report, or security behavior failed.
- `BLOCKED`: authentication, network, rate limit, or provider availability prevented evaluation.
- `SKIPPED_UNTIERED`: optional provider has no configured pool; illegal for canonical required lanes.
- `SIMULATED`: dry-run row; never counted as PASS.

Default counts are five warmups and 60 measured rows. `matrixComplete` requires exact counts and every live inventory, warmup, and measured row PASS. `authoritative` additionally requires non-dry execution, clean exact final HEAD, positive usage, declared response attribution, schema validation, recursive redaction, and secret-scan success.

Exit codes are 0 for successful requested-mode execution, 1 for behavior/schema/security failure, 2 for an environmentally BLOCKED or incomplete required matrix, and 64 for invalid CLI configuration. A successful dry run may exit 0 but remains non-complete and non-authoritative.

The utility, balanced, and frontier prompts contain deterministic profiler signals and require marker-only output. The multimodal fixture contains a visible code absent from the prompt; the model must inspect the image to produce the expected answer.

## TDD and staged UAT

Every behavior is introduced with a failing focused test, minimal implementation, focused green run, coding-agent suite, type check, lint, and dry run.

Mocked HTTP coverage includes successful provider schemas, empty inventory, missing tiers, 401, 403, 404, 429, 500, malformed JSON, DNS/network failure, timeout/abort, ADC, OAuth/API-key headers, no bundled fallback, redaction, attribution gaps, warmup failures, and partial/all-BLOCKED contracts.

Paid UAT is staged:

1. Stage A: unit tests, mocked HTTP, type/lint checks, dry run, schema validation, and secret tests.
2. Stage B: LiteLLM OpenAI utility with one warmup and one repetition; then balanced/frontier only after success.
3. Stage C: both LiteLLM lanes, one warmup and one repetition per scenario.
4. Stage D: final clean `origin/main`, all five lanes, five warmups, 60 measured rows, recursive scan.

The complete paid matrix is never used as a debugging loop.

## Reporting, security, and rollout

Schema-v2 reports record Git state, parameters, capability declarations, sanitized endpoint fingerprints, inventory reconciliation, first-class warmups and measurements, timestamps, durations, usage, attribution sources, counts, authority, and security state. Reports are written outside the repository with mode 0600.

The writer recursively redacts resolved secrets, credential-shaped fields, authorization values, URL credentials, query tokens, and credential paths. It validates the final candidate against the checked-in schema, scans the exact bytes with Gitleaks, atomically publishes unchanged bytes, and writes a SHA-256 receipt. Scan failure publishes no report and exits 1.

Operational rollout remains off by default, then shadow, then per-lane automatic enablement beginning with the two LiteLLM lanes. Monitor decisions, reason codes, latency, token/cost distribution, failures, BLOCKED rate, escalation, and rollback. Provider outages never create inferred substitutes. `/route off` or per-lane disablement is the safe rollback.

## Tracked completion ledger

- [x] RM-01 provider-specific inventory adapters and credential resolvers
  - Implementation target: capability registry, OpenAI-compatible, Anthropic, LiteLLM, and Vertex Model Garden adapters; AuthStorage/API-key/OAuth/ADC resolution.
  - Failing test: provider schema, header, missing credential, and ADC cases in `bench-routing-matrix.test.ts`.
  - Verification command: `bun test test/bench-routing-matrix.test.ts --max-concurrency 2`.
  - Required artifact: mocked request/response assertions with no real inference.
  - Completion claim: all adapters use provider-specific URLs, schemas, and authentication; none substitutes a bundled inventory.
  - Reviewer evidence: 22 focused tests pass, including OpenAI, Anthropic, two independent LiteLLM endpoints, and Vertex.
- [x] RM-02 live, bundled, configured, and eligible inventory separation
  - Implementation target: explicit inventory states, configured-tier reconciliation, and lane-qualified candidate construction.
  - Failing test: empty inventory, missing tier, separate endpoint, and failed-discovery cases.
  - Verification command: `bun test test/bench-routing-matrix.test.ts --max-concurrency 2`.
  - Required artifact: report inventory rows with discovered IDs, missing tiers, eligible candidates, and endpoint fingerprints.
  - Completion claim: only the authenticated lane inventory can make a configured tier eligible.
  - Reviewer evidence: focused tests prove missing tiers fail and failed discovery never falls back.
- [x] RM-03 typed response extraction and exact-output scenarios
  - Implementation target: content-block parser and utility/balanced/frontier prompts that require silent reasoning and one exact marker.
  - Failing test: text, thinking, tool/error, invalid block, whitespace, and task-profile cases.
  - Verification command: `bun test test/bench-routing-matrix.test.ts --max-concurrency 2`.
  - Required artifact: measured rows with sanitized reason codes and exact marker results.
  - Completion claim: extraction deterministically joins text blocks and rejects unexpected behavioral blocks.
  - Reviewer evidence: content extraction and all four tier-profile tests pass.
- [x] RM-04 genuine response attribution
  - Implementation target: optional server-evidence fields on `AssistantMessage`, populated from OpenAI and Anthropic response bodies only.
  - Failing test: missing response model and a server model different from the request.
  - Verification command: `bun test test/response-attribution.test.ts test/anthropic-stream-envelope.test.ts --max-concurrency 2` in `packages/ai`.
  - Required artifact: report fields identify evidence source or explicitly omit unavailable evidence.
  - Completion claim: requested model is never reused as response-reported model; Vertex and gateway upstream limitations are declared.
  - Reviewer evidence: six focused transport tests pass and capability-relative classifier tests reject missing required evidence.
- [x] RM-05 first-class warmup and contract integration
  - Implementation target: one row per warmup with model/provider/stop/usage checks, expected counts, completeness, authority, and exit status.
  - Failing test: behavioral warmup failure plus partial/all-BLOCKED matrices.
  - Verification command: `bun test test/bench-routing-matrix.test.ts --max-concurrency 2`.
  - Required artifact: five default warmup rows and 60 default measured rows.
  - Completion claim: any required warmup FAIL/BLOCKED makes the matrix incomplete, non-authoritative, and nonzero for live execution.
  - Reviewer evidence: contract tests and the 5/60 dry-run count pass.
- [x] RM-06 image-derived multimodal validation
  - Implementation target: deterministic embedded PNG bearing `ROUTE-7C` and a prompt whose expected marker is absent from its text.
  - Failing test: assert typed image content, expected MIME type, and marker absence from the prompt.
  - Verification command: `bun test test/bench-routing-matrix.test.ts --max-concurrency 2`.
  - Required artifact: visual scenario row with the exact image-derived marker.
  - Completion claim: a passing visual response must obtain the answer from image content.
  - Reviewer evidence: fixture contract and multimodal tier profiling tests pass.
- [x] RM-07 mocked network and failure taxonomy
  - Implementation target: status mapping for 401/403/404/429/500, malformed/empty schemas, DNS/network, timeout/abort, and redacted diagnostics.
  - Failing test: one deterministic mocked-network case per state and authentication variant.
  - Verification command: `bun test test/bench-routing-matrix.test.ts --max-concurrency 2`.
  - Required artifact: focused test output containing 22 PASS and zero FAIL.
  - Completion claim: environmental blocks and behavioral/schema failures remain distinguishable without leaking request details.
  - Reviewer evidence: focused suite passes with 67 assertions.
- [x] RM-08 report schema and security publication gate
  - Implementation target: schema v2, recursive redaction, 0600 temporary file, Gitleaks scan, atomic rename, and SHA-256 receipt.
  - Failing test: malformed report shape and nested secret/header/URL/query/path values.
  - Verification command: `bun run bench:routing-matrix --dry-run` and `git diff --check`.
  - Required artifact: out-of-repository report plus `.sha256` receipt.
  - Completion claim: unvalidated or secret-scan-failing bytes are never published as the final report.
  - Reviewer evidence: dry run published `/tmp/routing-matrix-reports/2026-08-11T13-44-10-446Z/routing-matrix-report.json`; schema and scan passed.
- [x] RM-09 deterministic Stage A gate
  - Implementation target: focused tests, full AI and coding-agent suites, formatting, type checking, dry run, and secret scan.
  - Failing test: the pre-implementation harness tests failed until live-path exports and behavior existed.
  - Verification command: `bun run check`, AI focused tests, and `bun run test` in `packages/coding-agent`.
  - Required artifact: command logs and dry-run report.
  - Completion claim: Stage A is green before any paid call is attempted.
  - Reviewer evidence: coding-agent 6,529 pass/559 skip/0 fail; AI package and focused suites pass; check and dry run exit zero.
- [ ] RM-10 Stage B authenticated LiteLLM OpenAI smoke
  - Implementation target: `litellm-openai`, one warmup, utility at one repetition, then balanced/frontier only after utility passes.
  - Failing test: the first authenticated smoke must expose any endpoint, inventory, attribution, or inference defect.
  - Verification command: `bun run bench:routing-matrix --lanes litellm-openai --scenarios utility-greeting --warmups 1 --repetitions 1`.
  - Required artifact: clean, redacted smoke report outside the repository.
  - Completion claim: live inventory, warmup, and utility measurement all PASS with valid usage and required attribution.
  - Reviewer evidence: blocked on 2026-08-11 because neither LiteLLM endpoint nor credential is configured; no paid call was made.
- [ ] RM-11 Stage C two-family LiteLLM matrix
  - Implementation target: both LiteLLM lanes, all required scenarios, one warmup and one repetition.
  - Failing test: cross-family pool/model selection, independent inventory, marker, or attribution mismatch fails its row.
  - Verification command: `bun run bench:routing-matrix --lanes litellm-openai,litellm-anthropic --warmups 1 --repetitions 1`.
  - Required artifact: redacted two-lane report and hash receipt.
  - Completion claim: 2/2 warmups and 8/8 measured rows PASS with no FAIL/BLOCKED.
  - Reviewer evidence: pending RM-10 and authorized credentials.
- [ ] RM-12 Stage D authoritative five-lane matrix
  - Implementation target: all canonical required lanes, one warmup, four scenarios, and three measured repetitions.
  - Failing test: any missing inventory tier, warmup, row, usage, required attribution, or scan makes the run non-authoritative.
  - Verification command: `bun run bench:routing-matrix` on clean current `origin/main`.
  - Required artifact: redacted exact-head report with five warmups, 60 measurements, and hash receipt.
  - Completion claim: `passedWarmups === 5`, `passedMeasured === 60`, `matrixComplete === true`, `authoritative === true`, exit 0.
  - Reviewer evidence: pending RM-10/RM-11, all five authorized credentials, and merge to current main.
- [ ] RM-13 final exact-head empirical review
  - Implementation target: independently compare report SHA, Git SHA/cleanliness, schema, counts, evidence limitations, and recursive secret scan.
  - Failing test: any mismatch between report claims and current main rejects completion.
  - Verification command: schema validation, `sha256sum -c`, Gitleaks directory scan, and GitHub required-check review.
  - Required artifact: reviewer acceptance linked to the exact authoritative report.
  - Completion claim: project is empirically complete only after the reviewer accepts the clean exact-head authenticated evidence.
  - Reviewer evidence: pending RM-12.

The unchecked items require configured authorized credentials and real inference. Until they pass, the project remains implemented but empirically incomplete.

## Risks and unresolved product decisions

- Canonical availability risk: any configured tier absent from a live inventory blocks that entire required lane; changing the canonical tier is a reviewed product decision, not a harness fallback.
- Attribution limitation: LiteLLM may not expose its true upstream provider and the current Vertex SDK stream does not report a serving model. Authority is therefore capability-relative and must retain these explicit omissions.
- Credential topology: the two LiteLLM families require independently addressable inventory/inference configuration even if an installation chooses to share one key.
- Vertex inventory compatibility: Model Garden permissions and regional availability may differ from inference permissions; authenticated UAT must confirm the chosen project/location.
- Cost control: Stage D is prohibited as a debugging loop and remains gated on successful Stages B and C.
- Final product decision: reviewers must explicitly accept capability-relative attribution, or require gateway/SDK changes that expose stronger upstream evidence before declaring RM-13 complete.
