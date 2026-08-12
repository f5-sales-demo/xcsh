# Provider-Agnostic Dynamic Model Routing

## Executive status

The production router is implemented at the `AgentSession` boundary. It supports explicit provider-qualified pools, utility/balanced/frontier tiers, off/shadow/auto modes, deterministic and hybrid classification, context eligibility, hysteresis, manual pins, escalation and rollback, read-only delegation, persistence, telemetry, and route commands.

The authenticated routing-matrix harness was redesigned under issue #3114 and extended for subscription routing under issue #3129. The implementation now has provider-sticky Google Antigravity and OpenAI Codex profiles, entitlement-scoped inventory discovery through xcsh's existing OAuth storage, tier-specific reasoning effort, and response-body attribution for both transports. Its deterministic and mocked-network evidence is authoritative for code paths, but this iteration is not empirically complete until a clean exact-`origin/main` report proves the two subscription lanes through real authenticated inference.

CI, unit tests, dry runs, bundled catalog entries, missing-credential BLOCKED results, and completion-auditor statements are not live acceptance evidence.

## Scope and non-goals

The legacy `canonical` benchmark profile retains direct OpenAI, direct Anthropic, LiteLLM OpenAI-family, LiteLLM Anthropic-family, and explicitly configured Google Vertex lanes. The `subscription` profile is the scope of issue #3129 and contains only Google Antigravity and OpenAI Codex. LiteLLM inference is explicitly out of scope for this iteration and must not be run as part of its UAT.

The Google profile maps `smol` and `default` to `google-antigravity/gemini-3.6-flash-high:high`, and `slow` and `plan` to `google-antigravity/gemini-3.1-pro-high-vertex:high`. The Codex profile maps utility to Luna/low, balanced to Terra/medium, and frontier to Sol/high, with Sol/xhigh for a prior rejection or a complexity score of at least 90. Both profiles are provider-sticky and apply atomically only when every required model appears in fresh authenticated entitlement inventory.

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
| `google-antigravity` | Gemini CLI/Antigravity | Google | Flash for normal work, Pro for planning | Fresh authenticated Antigravity entitlement discovery | Existing xcsh OAuth credential resolver | Endpoint, requested alias, client, and response-reported Vertex model version; upstream infrastructure is not inferred |
| `openai-codex` | ChatGPT Codex Responses | OpenAI | `openai-codex/gpt-5.6` | Fresh authenticated Codex entitlement discovery | Existing xcsh OAuth credential and account resolver | Endpoint, requested model, client, and response-body model; upstream infrastructure is not inferred |

Lane identity is independent of provider name. This keeps direct Anthropic and Anthropic-over-LiteLLM distinct.

`AssistantMessage.provider` and `model` remain client/request fields for compatibility. Optional `responseAttribution` records server evidence only. Missing server evidence remains absent and fails lanes that declare response-model proof mandatory.

## Inventory architecture

Four inventories remain distinct:

1. Bundled catalog metadata, which can inform display, context, and cost only.
2. Explicit configured utility/balanced/frontier models.
3. Models returned by the lane's authenticated live endpoint.
4. Eligible candidates: configured tiers intersected with that same lane's live inventory and runtime constraints.

All configured models must exist for every active lane. Google intentionally maps both utility and balanced tiers to the same Flash entitlement; this is one explicit relationship, not a fabricated third model. Candidate inventories are never combined across endpoints.

Subscription discovery uses the existing `ModelRegistry` provider adapters. Only `status: ok`, `stale: false` entitlement responses satisfy live acceptance. Cached data, bundled models, partial model metadata, unsupported adapters, and failed refreshes remain BLOCKED or FAIL and cannot make a configured model eligible.

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

The canonical defaults remain five warmups and 60 measured rows. The subscription profile defaults to two warmups and 24 measured rows (two lanes × four scenarios × three repetitions). `matrixComplete` requires exact counts and every live inventory, warmup, and measured row PASS. `authoritative` additionally requires non-dry execution, clean exact final HEAD, positive usage, declared response attribution, schema validation, recursive redaction, and secret-scan success.

Exit codes are 0 for successful requested-mode execution, 1 for behavior/schema/security failure, 2 for an environmentally BLOCKED or incomplete required matrix, and 64 for invalid CLI configuration. A successful dry run may exit 0 but remains non-complete and non-authoritative.

The utility, balanced, and frontier prompts contain deterministic profiler signals and require marker-only output. The multimodal fixture contains a visible code absent from the prompt; the model must inspect the image to produce the expected answer.

## TDD and staged UAT

Every behavior is introduced with a failing focused test, minimal implementation, focused green run, coding-agent suite, type check, lint, and dry run.

Mocked HTTP coverage includes successful provider schemas, empty inventory, missing tiers, 401, 403, 404, 429, 500, malformed JSON, DNS/network failure, timeout/abort, ADC, OAuth/API-key headers, no bundled fallback, redaction, attribution gaps, warmup failures, and partial/all-BLOCKED contracts.

Authenticated UAT is staged to isolate failures even when usage is not budget-constrained:

1. Stage A: unit tests, mocked HTTP, type/lint checks, dry run, schema validation, and secret tests.
2. Stage B: Google Antigravity utility with one warmup and one repetition, followed by its frontier planning scenario.
3. Stage C: OpenAI Codex utility, balanced, and frontier scenarios with one warmup and one repetition; confirm low/medium/high and a separate xhigh escalation test.
4. Stage D: both subscription lanes on clean exact `origin/main`, two warmups, 24 measured rows, schema validation, and recursive scan.

The complete authenticated matrix is not used as a debugging loop. No LiteLLM lane is invoked in this iteration.

## Reporting, security, and rollout

Schema-v3 reports record the selected benchmark profile, Git state, parameters, capability declarations, sanitized endpoint fingerprints, inventory reconciliation, first-class warmups and measurements, selected effort and reason, timestamps, durations, usage, attribution sources, counts, authority, and security state. Reports are written outside the repository with mode 0600.

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
- [x] SR-01 DRY subscription profile registry and role reuse
  - Implementation target: one shared profile registry used by OAuth login, routing commands, and session application; reuse the common role-model resolver for slow/smol/commit selection.
  - Failing test: atomic profile application, missing entitlement, canonical alias, and role-resolution cases.
  - Verification command: `bun test test/subscription-routing-profiles.test.ts test/login-model.test.ts test/model-resolver.test.ts --max-concurrency 1`.
  - Required artifact: focused test log and source diff showing no duplicated model-selection loop.
  - Completion claim: Google and Codex role mappings have one source of truth and cannot partially apply.
  - Reviewer evidence: focused subscription and login cases pass; final PR diff review remains required.
- [x] SR-02 provider-sticky Codex tier and effort routing
  - Implementation target: Luna/low, Terra/medium, Sol/high, and Sol/xhigh on rejection or complexity score ≥90.
  - Failing test: normal balanced selection and independent frontier effort escalation.
  - Verification command: `bun test test/routing-effort.test.ts test/routing-coordinator.test.ts test/agent-session-routing-rejection.test.ts --max-concurrency 1`.
  - Required artifact: routing decision assertions for selected model, selected effort, and reason.
  - Completion claim: model tier and reasoning effort are resolved independently without crossing providers.
  - Reviewer evidence: focused coordinator and rejection tests pass.
- [x] SR-03 Google planner/normal high-reasoning routing
  - Implementation target: Flash High for `default`/`smol`, Pro High for `plan`/`slow`, including enterprise alias canonicalization.
  - Failing test: login applies all four roles and preserves unrelated roles; stale inventory refuses application.
  - Verification command: `bun test test/login-model.test.ts test/subscription-routing-profiles.test.ts --max-concurrency 1`.
  - Required artifact: atomic role and active-model assertions.
  - Completion claim: normal and planner paths both request high reasoning from fresh entitled models.
  - Reviewer evidence: focused login/profile tests pass.
- [x] SR-04 OAuth entitlement inventory and credential reuse
  - Implementation target: reuse `AuthStorage` and `ModelRegistry` provider managers for Google Antigravity and OpenAI Codex; never inspect database rows or expose raw tokens.
  - Failing test: fresh, stale, empty, missing-metadata, unavailable, and missing-credential entitlement states.
  - Verification command: `bun test test/bench-routing-matrix.test.ts --max-concurrency 1`.
  - Required artifact: sanitized inventory rows and mocked resolver evidence.
  - Completion claim: only fresh provider-reported entitlement inventory constructs live candidates and runtime models.
  - Reviewer evidence: focused entitlement and no-fallback tests pass.
- [x] SR-05 subscription transport attribution and schema-v3 reporting
  - Implementation target: capture Google model version and Codex response-body model/response ID; record requested effort and reason in schema-v3 reports.
  - Failing test: actual content-block extraction, missing attribution, Google SSE attribution, and Codex SSE attribution.
  - Verification command: `bun test test/google-gemini-cli-3x-thinking.test.ts test/openai-codex-stream.test.ts --max-concurrency 1` in `packages/ai`, plus the benchmark test.
  - Required artifact: transport assertions and a schema-valid redacted dry-run report.
  - Completion claim: request metadata is never manufactured as response evidence; known provider aliases are compared to their response-reported serving model.
  - Reviewer evidence: focused transport tests pass; schema-v3 subscription dry-run and xhigh escalation dry-run reports passed validation and Gitleaks under `/tmp/routing-matrix-reports/`.
- [ ] SR-06 deterministic Stage A and merged PR
  - Implementation target: format, typecheck, focused suites, full workspace suite, both benchmark-profile dry runs, secret scan, review diff, and complete issue #3129 through CI and squash merge.
  - Failing test: any source, test, schema, formatting, or CI failure keeps the task open.
  - Verification command: repository-required checks, `bun run test`, and `bun run bench:routing-matrix --profile subscription --dry-run`.
  - Required artifact: green command logs, dry-run receipt, merged linked PR, and clean Git state.
  - Completion claim: all deterministic gates are green on the merged implementation.
  - Reviewer evidence: `bun run check` and the full workspace test run pass (coding-agent: 6,541 pass, 559 skip, 0 fail); PR lifecycle remains pending.
- [ ] SR-07 staged authenticated subscription smoke
  - Implementation target: Google utility then frontier; Codex utility then balanced/frontier; one warmup and one repetition per requested scenario.
  - Failing test: any entitlement, model, effort, marker, usage, stop, or attribution mismatch stops progression to the next stage.
  - Verification command: `bun run bench:routing-matrix --profile subscription --lanes <lane> --scenarios <scenario> --warmups 1 --repetitions 1`.
  - Required artifact: one redacted out-of-repository report and receipt per stage.
  - Completion claim: both subscription transports prove their reviewed models through authenticated inference without invoking LiteLLM.
  - Reviewer evidence: pending SR-06 and exact merged HEAD.
- [ ] SR-08 authoritative two-lane matrix and exact-head review
  - Implementation target: both subscription lanes, one warmup, four scenarios, three repetitions, clean exact `origin/main`, schema validation, recursive secret scan, and receipt verification.
  - Failing test: any missing entitlement, warmup, row, usage, required response attribution, scan, Git, or count makes the result non-authoritative.
  - Verification command: `bun run bench:routing-matrix --profile subscription` on clean current `origin/main`.
  - Required artifact: redacted report with 2/2 warmups, 24/24 measurements, `matrixComplete: true`, `authoritative: true`, exit 0, and a matching SHA-256 receipt.
  - Completion claim: the reviewer accepts the exact-head authenticated subscription matrix and its documented attribution limits.
  - Reviewer evidence: pending SR-07.

The legacy LiteLLM and five-lane canonical live matrices remain deferred, not silently accepted. They are outside issue #3129 and must not be run in this subscription-focused session. Until SR-06 through SR-08 pass, this iteration remains implemented but empirically incomplete.

## Risks and unresolved product decisions

- Entitlement risk: the reviewed GPT-5.6 and Gemini aliases are accepted only if the current authenticated account advertises them. Bundled catalog presence is insufficient.
- Google alias risk: Antigravity request aliases can map to Vertex serving versions. The transport records both rather than demanding literal alias equality.
- Attribution limitation: neither subscription gateway proves its internal upstream infrastructure. Authority is capability-relative to authenticated endpoint, request, client transport, and response-reported model.
- Effort availability risk: the current Codex entitlement metadata caps supported effort at xhigh. A future max effort is not inferred or requested until entitlement and transport metadata advertise it.
- Rollout decision: automatic Codex routing should move from shadow to per-profile auto after SR-08. Google normal/planner role routing may roll out independently; cross-provider fallback remains prohibited.
- Legacy validation: LiteLLM and direct-provider canonical UAT still require a separate authorized iteration and must not be conflated with subscription acceptance.
