# Autoresearch Ideas (Unified Final Wave)

## Status: Exhausted
24 runs, 11 directions, 2 sessions. Single structural fix committed: APP_KW healthcheck inclusion + HC semantic labels.
quality_pct stable at 84.66 (n=5 baseline, SD=2.17). No code change moves it above the 95% CI [82.0, 87.4].

## Committed Change
- `xcsh-api.ts`: Added `healthcheck` to APP_KW regex (batch expansion filter)
- `xcsh-api.ts`: Added healthcheck semantic labels (http/tcp, path) to batch summary
- Effect: Structurally correct. Healthchecks now included in batch response. Mean 84.33 (n=4) = baseline-neutral.

## Exhausted Directions
- R: Richer batch summaries (HC labels, WAF labels, inline cross-refs) — labels neutral, cross-refs regress
- S: Mutation stop signal changes (type labels, config summaries) — neutral or negative
- T: Cross-resource intelligence for MIXED — not applicable (MIXED queries already score well)
- U: Configuration diff in UPDATE — regressed (-6%)
- V: Namespace-aware context / section renaming — neutral
- W: System prompt instructions — caused call inflation
- W2: WAF descriptive labels — 0/3 for Q4 regardless of wording

## Blocked (requires architectural changes)

### Quality above 87%
- Model text output is the bottleneck, not tool response content
- Q4 WAF detail (detection/signature/attack) = 0/3 in ALL runs — model never describes WAF internals
- Q19-22 DELETE detail (success/type) = ~1/2 — model doesn't say 'successfully' reliably
- Q3 HC detail (path/http) = 1/3 — model answers counts briefly without config details
- Would require: model-level changes (prompting strategy, temperature, model version) OR benchmark redesign

# Autoresearch Ideas (Deferred)

Quality is at 100/100 ceiling with current rubric.
All feasible SE utility improvements have been implemented.
Only items requiring unavailable infrastructure remain.

## Blocked

### Coverage Ratio
- Display pipeline coverage = in-quarter pipeline / quarterly quota target
- **BLOCKED**: No quota data in user profile (`~/.xcsh/user-profile.json` has `quota: null`)
- **BLOCKED**: No SFDC ForecastingQuota access ("Current user doesn't have access to forecasting objects")
- Unblock: populate `quotaTarget` in user profile manually or add quota to SFDC user profile refresh

## Deferred (infrastructure required)

### Subordinate Reporting
- When user is a manager, show per-rep pipeline breakdown
- Requires: manager hierarchy detection, separate queries per direct report
- Complexity: high (needs SFDC user role hierarchy query, may exceed 5-query limit)

## Completed (pruned)
- ~~Top Deals Section~~ -> run 13-15 (with Owner.Name)
- ~~At Risk Section~~ -> run 12 (slipped-close-date anomaly)
- ~~Stalled Deals~~ -> run 14 (LastActivityDate-based anomaly)
- ~~Pipeline Timing~~ -> run 20-21 (with forecast category breakdown)
- ~~FY-to-date Booked~~ -> run 24 (parallel aggregate query)
- ~~Pipeline Movement~~ -> run 27 (OpportunityFieldHistory with targeted opp IDs)
- ~~Coverage Ratio~~ -> BLOCKED
- ~~Week-over-Week Movement~~ -> implemented as Pipeline Movement via SFDC history
