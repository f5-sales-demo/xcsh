# Session Handoff — Intelligence Gathering Autoresearch Loop

Binary: built from commit `2e8f61acc` on main (PR #652 merged). Verify with `xcsh://about`.

## What shipped this session

PR #652 merged to main. 21 files changed, 3,268 insertions. Issues #647, #648, #649, #651 closed.

### Three xcsh:// intelligence protocols

| Protocol | Source file | Hint chars | Startup cost |
|---|---|---|---|
| `xcsh://user` | `user-profile.ts` (pre-existing) | 180 | 2ms cache read |
| `xcsh://computer` | `computer-profile.ts` (NEW) | 82 | 0ms cache read |
| `xcsh://salesforce` | `salesforce-context.ts` (NEW) | 107 | 1ms cache read |
| **Total** | | **369** | **3ms** |

### Pipeline report generator

Files: `packages/coding-agent/src/pipeline-report/{types,generator,renderer,index}.ts`

- Line-item model: `FYB_Total_Price__c` for net new, `True_ACV__c` for renewals
- SKU prefix classification: Platform (Distributed Cloud) = `F5-V-O-*`, `F5-XC-*`, `F5-FAS-WAF-*`, `F5-FAS-API-*`, `F5-UTIL-*`, `F5-CST-*`. Point (Shape+DI) = `F5-SHP-*`, `F5-FAS-BOT-*`, `F5-FAS-DOS-*`
- Team-member scoped: `OpportunityTeamMember WHERE UserId IN (Robin, Emerson)`
- Stale cutoff for in-play, quarter dates for booked
- Platform and Point visually separated in output
- Data quality anomaly detection: unclassified SKUs, missing territories, forecast hygiene
- Renderer produces markdown with territory grouping headers

### Benchmark tooling

| Script | Purpose | Command |
|---|---|---|
| `autoresearch-measure.ts` | Template char/token overhead | `bun packages/coding-agent/autoresearch-measure.ts` |
| `autoresearch-bench-runtime.ts` | Wall-clock seed + cache timing | `bun packages/coding-agent/autoresearch-bench-runtime.ts` |
| `autoresearch-bench-collectors.ts` | Per-probe isolation | `bun packages/coding-agent/autoresearch-bench-collectors.ts` |
| `autoresearch.sh` | Full benchmark (render + tests) | `bash autoresearch.sh` |
| `autoresearch.checks.sh` | Invariant gate + type check | `bash autoresearch.checks.sh` |

### Test suite

195 pass / 0 fail / 10 files / 436 expect() calls.

## Current metrics (baseline for next iteration)

```
rendered_hint_chars=180 (user profile)
rendered_computer_hint_chars=82
rendered_salesforce_hint_chars=107
total_intelligence_overhead=369
total_prompt_with_all=24501
total_prompt_without_profile=24132
```

### Runtime (from autoresearch-bench-runtime.ts)

```
collectInstant():         0ms    (sync os module)
seedComputerProfile():    590ms  (background fire-and-forget)
seedSalesforceContext():  12452ms (background, 8 SOQL queries + territory counts)
loadProfile():            2ms    (critical path)
loadComputerProfile():    0ms    (critical path)
loadSalesforceContext():  1ms    (critical path)
Startup critical path:    3ms total
```

### Pipeline report (last run)

```
Net New:   $2.4M quota (11 accounts, Platform $2.1M + Point $250K)
Renewals:  $3.2M quota (6 accounts, all Platform)
Booked:    $0 this quarter
Forecast:  Best Case $472K + Pipeline $1.9M = $2.4M net new
```

## Cached state on disk

### ~/.xcsh/salesforce-context.json

- userId: `00550000002mYZkAAM` | username: `r.mordasiewicz@f5.com` | org: `SFDC`
- **BUG: confirmedPartner and confirmedTerritories were wiped** by `seedSalesforceContext()` overwriting the cache. The seed function doesn't preserve user-confirmed fields. Fix needed.
- Correct values to restore:
  - `confirmedPartner: { id: "0051T000008ejfLQAQ", name: "Emerson Sampsell", title: "Territory Account Mgr II", role: "AE" }`
  - `confirmedTerritories: ["NA Financial Services Red", "AMER: Enterprise Canada"]`
- 7 territories discovered, 30 active accounts, 7 territory details with coverage stats

### ~/.xcsh/computer-profile.json

- Mac17,2, Apple M5, 10 cores, 32GB RAM, darwin 26.3
- Managed: Jamf MDM, DEP enrolled, supervised
- Security: SIP enabled, FileVault on, Gatekeeper enabled, Firewall enabled, NOT admin
- 4 endpoint agents (CrowdStrike, Defender, BeyondTrust, + 1)
- 12 installed tools

## What works

1. `xcsh://computer` — renders full hardware/MDM/security/endpoint profile
2. `xcsh://salesforce` — renders pipeline context with territory coverage table
3. Pipeline report generator — produces correct FYB line-item report with Platform/Point separation
4. System prompt hints — all 3 render correctly (369 chars total, 3ms startup)
5. Background seed — fire-and-forget, doesn't block startup
6. Anomaly detection — flags forecast hygiene issues, unclassified SKUs
7. 195 tests pass, type check clean, PII audit clean

## What doesn't work / known bugs

1. **seedSalesforceContext() overwrites confirmedPartner and confirmedTerritories** — the seed function runs discovery and writes the full result to cache, wiping user-confirmed fields that were set separately. Fix: merge confirmed fields back after seed, or exclude them from overwrite.

2. **seedSalesforceContext() takes 12.5 seconds** — the 7 per-territory COUNT queries are sequential after the parallel SOQL batch. The territory coverage feature adds 7 network round-trips. Consider: cache territory counts separately, or make them lazy.

3. **No `/pipeline-report` slash command or skill wired yet** — the generator and renderer exist as importable TypeScript functions but there's no user-facing command. Need to create a slash command definition or skill that calls `generatePipelineReport()` + `renderPipelineReport()` and outputs the markdown.

4. **ELA billing SKUs (F5-ELA-BILLING-USAGE, F5-SW-ELA-BILLING-USAGE) are not captured** — these are generic billing line items on ELA deals. FYB is calculated but the SKU name doesn't match XC/Shape prefixes. The opportunity-level `Product_Segmentation__c` would tell us if it's XC-related. LPL Financial has $70K FYB in these SKUs that isn't appearing in the net new report.

5. **Emerson-OWNED opportunities missing from OpportunityTeamMember** — Salesforce doesn't add the opportunity Owner to OpportunityTeamMember automatically. Emerson owns 13 opps that only appear if we query `OwnerId = Emerson`. The current team-member query misses owner-only deals. Fix: add `OR Opportunity.OwnerId IN (userIds)` to the SOQL.

6. **No Booked section rendering when $0** — the report correctly shows no booked data this quarter, but should still show the section header with "$0 booked" for completeness.

## What to test next (with bun dev running)

### MUST test (not yet done)

1. **`bun dev` startup with new code** — verify the system prompt actually contains the 3 hint blocks in a live session. Check `xcsh://about` for version, then ask "what do you know about my computer" and "what's my pipeline" to verify hints are working.

2. **`xcsh://computer` read in live session** — the agent should be able to read `xcsh://computer` and get the full profile. Verify it renders without errors.

3. **`xcsh://salesforce` read in live session** — verify the agent reads the cache, sees the territory coverage table, and understands the pipeline context.

4. **`xcsh://salesforce?refresh=true` in live session** — triggers seedSalesforceContext(). Verify it completes and the cache updates. Check if confirmedPartner/confirmedTerritories survive (they won't — known bug #1).

5. **Pipeline report generation in live session** — ask the agent to run a pipeline report. It should use `sf_query` or import the generator. Verify the output matches the last benchmark run ($2.4M net new, $3.2M renewals).

6. **TTFT measurement** — time from user pressing Enter to first token of the agent's response. The 3ms cache-read overhead should be invisible. But the background seeds (590ms + 12.5s) might cause resource contention on the first prompt.

7. **Token budget** — verify the 24,501-char system prompt fits within the model's context window. With a typical conversation, check that compaction doesn't strip the hint blocks.

### SHOULD test

8. **Second session startup** — after the first session populates the caches, verify the second session loads instantly from cache (no seed delay).

9. **Stale cache behavior** — delete `~/.xcsh/computer-profile.json`, restart, verify it gets recreated in background.

10. **Missing sf CLI** — unset the sf CLI path or alias, restart, verify salesforce hint is omitted gracefully (no errors, just missing section).

## Key source files

| File | Purpose |
|---|---|
| `src/internal-urls/computer-profile.ts` | 687 lines. Types, collect, seed, render, hint, MDM, security, endpoint agents |
| `src/internal-urls/salesforce-context.ts` | 591 lines. Types, SOQL probes, territory details, partner, seed, render, hint |
| `src/pipeline-report/generator.ts` | 351 lines. FYB line-item queries, True_ACV renewals, SKU classification, anomaly detection |
| `src/pipeline-report/renderer.ts` | 183 lines. Markdown tables, Platform/Point split, territory grouping |
| `src/pipeline-report/types.ts` | 102 lines. All interfaces: PipelineReportOptions, PipelineReportData, AccountRow, etc. |
| `src/internal-urls/xcsh-protocol.ts` | Routes xcsh://computer and xcsh://salesforce |
| `src/system-prompt.ts` | BuildSystemPromptOptions: computerProfile, salesforceHint |
| `src/prompts/system/system-prompt.md` | 3 hint blocks: userProfile, computerProfile, salesforceHint |
| `src/sdk.ts` | Loads all 3 hints at startup from cache |
| `src/modes/interactive-mode.ts` | Background seedComputerProfile + seedSalesforceContext |
| `autoresearch-measure.ts` | Template render measurement |
| `autoresearch-bench-runtime.ts` | Wall-clock seed/cache timing |
| `autoresearch-bench-collectors.ts` | Per-probe isolation |
| `test/internal-urls/computer-profile.test.ts` | 48 tests |
| `test/internal-urls/salesforce-context.test.ts` | 20 tests |
| `test/internal-urls/xcsh-protocol.test.ts` | 10 new tests (computer + salesforce) |

## Human context (Robin Mordasiewicz)

- Sr Solutions Engineer at F5, started September 2025 (rehire — previously left in 2022)
- Salesforce manager field is STALE: shows Paul Slosberg (manager from 2022 stint). Actual team structure: Robin + Emerson Sampsell (AE) are an overlay pair
- Robin and Emerson are an overlay team selling F5 Distributed Cloud (Platform), Shape Advanced Bot, and Data Intelligence (Point) across two territories: **NA Financial Services Red** and **AMER: Enterprise Canada**
- They are NOT core team AEs — they're specialists. Core teams own the accounts, Robin/Emerson overlay for XC/Shape/DI products specifically
- Robin is NOT admin on this Mac (corporate Jamf-managed). NEVER attempt sudo — BeyondTrust intercepts it, causes 28.7s hang, and it's a policy violation
- Salesforce org alias is `SFDC` (not `f5` — must use `--target-org SFDC` in sf CLI commands)
- Salesforce ManagerId is unreliable for team discovery. Use `confirmedPartner` instead. Opp co-membership and account overlap both return zero for Robin+Emerson — the partnership leaves no Salesforce footprint

## Autoresearch loop protocol for next session

The autoresearch loop is NOT just editing code files and measuring template chars. It requires:

1. **Actually run `bun dev`** — start xcsh in development mode
2. **Interact with the running instance** — send prompts, verify hints render, test protocol endpoints
3. **Measure TTFT** — time from Enter to first token. Use `performance.now()` or wall-clock timing
4. **Iterate on hint wording** — edit system-prompt.md, re-run, re-measure. Each experiment is: edit → run → measure → decide keep/revert
5. **Run the benchmark scripts** — `bun packages/coding-agent/autoresearch-bench-runtime.ts` for runtime, `bun packages/coding-agent/autoresearch-measure.ts` for template overhead
6. **Run the test suite** — `bash autoresearch.sh` after each change. 195 tests must pass
7. **Run the correctness gate** — `bash autoresearch.checks.sh` for invariant checks + type check

The goal is improving: startup speed, response quality (does the LLM use the hints correctly?), token efficiency, and Salesforce discovery completeness.

## Priority fixes for next session

1. Fix `seedSalesforceContext()` to preserve `confirmedPartner` and `confirmedTerritories` across re-seeds
2. Add `OR Opportunity.OwnerId IN (userIds)` to pipeline generator queries to capture Emerson-owned deals
3. Wire `/pipeline-report` as a slash command or skill
4. Fix the 12.5s salesforce seed time (territory count queries are sequential)
5. Restore confirmed partner/territories in the cache:
   ```
   confirmedPartner: { id: "0051T000008ejfLQAQ", name: "Emerson Sampsell", title: "Territory Account Mgr II", role: "AE" }
   confirmedTerritories: ["NA Financial Services Red", "AMER: Enterprise Canada"]
   ```
