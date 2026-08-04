# Live model matrix benchmark

This benchmark sends the same static ping prompt through a fresh xcsh process for each model. It uses one warm-up and three measured samples by default, rotates model order between rounds, and runs every target with high reasoning and the same disabled optional subsystems.

Run it from the repository root:

```bash
bun bench:models
```

The default matrix is Gemini 3.6 Flash through Google Vertex AI with Application Default Credentials, GPT-5.6 Sol through LiteLLM, and Claude Opus 5 through Anthropic. Use repeated `--model 'Label=provider/model'` arguments to override the matrix.

Vertex authentication uses the current Google SDK path. Run `gcloud auth application-default login` once, select a project with `gcloud config set project PROJECT_ID` (or set `GOOGLE_CLOUD_PROJECT`), and optionally override the default `global` location with `GOOGLE_CLOUD_LOCATION`.

Reports include process startup to prompt emission, prompt-to-first-text TTFT, startup-inclusive TTFT, completion and process duration, provider-reported timing, token usage, output-token throughput, exact-response correctness, stop reason, failures, and stderr. Latency summaries use successful measured samples; success and exact-response rates include every measured sample.

Raw reports default to `~/.xcsh/benchmarks` because exact model responses can contain live tenant, namespace, identity, and workstation context. Use `--out` only for another access-controlled location, and never commit an unsanitized raw report.

This is a live, billable baseline rather than a CI gate. Three samples expose gross differences but are not enough for statistically strong provider comparisons.

## Progressive xcsh scenario library

The scenario runner uses the same rotating three-model matrix while progressively exercising xcsh-specific behavior:

| Tier | Suite | Contract |
| --- | --- | --- |
| 0 | `ping` | Exact `PONG` response without tools |
| 1 | `identity` | xcsh/F5 identity with policy-permitted reads and context-aware user assistance |
| 2 | `tools` | Exactly one built-in `read` call and an exact sentinel response |
| 3 | `plugins` | Plugin skill discovery and a deterministic extension tool call |
| 4 | `authenticated` | Exactly one read-only authenticated `xcsh_api` request with no credential disclosure |
| 5 | `integrations` | Read-only GitHub, Azure, GitLab, Salesforce, and MEDDPICC authentication/skill probes |

Run a suite from the repository root:

```bash
bun bench:model-scenarios --suite identity --context example-corp
bun bench:model-scenarios --suite tools
bun bench:model-scenarios --suite plugins
bun bench:model-scenarios --suite authenticated --context example-corp
bun bench:model-scenarios --suite integrations
```

`--suite all --context example-corp` runs the complete progression. `--tier 2` limits selection to tiers 0 through 2, and repeated `--scenario ID` arguments select individual scenarios. Use `--runs`, `--warmups`, `--timeout-ms`, repeated `--model`, and `--out` to control sampling and output.

Use `--thinking low|medium|high|xhigh|max` to isolate reasoning-effort effects. `med` is accepted as an alias for `medium`, and `--thinking all` runs all five requested efforts in one report. Samples and rankings remain separated by requested effort.

The report records the effective effort after model capability clamping, so `max` must not be interpreted as native support when the model actually ran at `xhigh` or `high`.

`--fail-fast-provider-error` stops a sample after the first provider retry event. Use it for quota or entitlement failures so an unavailable provider does not spend the full retry window on every matrix cell. Analysis leaves providers with zero successful responses explicitly unranked; their transport and contract failures remain visible, but they are not assigned fabricated speed or quality positions.

Context-dependent scenarios require `--context`. The runner passes this as an xcsh launch option; `/context example-corp` is not model prompt text and must not be embedded in benchmark prompts.

Each report separates transport success from contract success and records TTFT, time to first tool call, tool execution duration, end-to-end response/process duration, tool calls and errors, turn counts, aggregated multi-turn usage, and the response contract result. Prompt text, runtime capability scope, and contract descriptions are included in the report so later runs remain auditable.

Scenario reports also grade every produced response against a deterministic rubric embedded in the report. Open-ended identity scenarios score requested grounding, useful capability coverage, evidence discipline, and directness. Exact-response and tool scenarios score only when the complete response/tool contract passes. This avoids asking any benchmarked model to judge itself.

Generate the deep comparison after a live run:

```bash
bun bench:model-scenarios:analyze ~/.xcsh/benchmarks/<report>.json
```

The analysis writes JSON and Markdown artifacts next to the source report. It publishes separate per-effort quality, reliability, and speed ranks; per-scenario TTFT, first-tool, tool-execution, end-to-end, variability, throughput, word-count, and cost matrices; representative open-ended outputs; and a transparent balanced score (60% quality, 20% reliability, 20% relative speed).

Provider-reported output tokens and throughput are diagnostic only because providers account for hidden reasoning differently. Cost zero means unreported unless provider usage supplied a nonzero amount; it must not be interpreted as free execution.

The retained 2026-08-03 analysis is a sanitized publication of the 180-cell full-capability matrix. It replaces the six invalid low/medium GitHub CLI cells with post-repair reruns that passed 6/6. Model responses use synthetic publication identifiers; timing, quality, and ranking data are unchanged except for those explicit replacement samples.

Gemini 3.6 Flash verification through Vertex ADC returned exact `PONG` with a 6123.7 ms TTFT and no quota or retry error. Standalone `agy` 1.1.10 also returned exact `PONG`. The provider accepted `maxOutputTokens` 65,536 and rejected 65,537, establishing the current output boundary.

Only the separate xcsh Cloud Code Assist OAuth route returned an individual-quota HTTP 429, so the limit is specific to that route rather than Gemini, Vertex ADC, or the standalone `agy` CLI.
