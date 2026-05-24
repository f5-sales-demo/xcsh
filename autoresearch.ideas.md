# Autoresearch Ideas (Unified Final Wave)

## Conclusion: quality_pct ceiling reached
After 12 experiment runs across 8 directions (R-W), quality_pct is stable at ~85-88% for system xcsh v18.77.5.
This is an irreducible floor: the benchmark measures model TEXT output, which cannot be reliably influenced by tool response content or prompt instructions.

## Blocked

### Quality above 88%
- Requires changing model inference (temperature, sampling, model version) — outside scope of tool code changes
- OR changing the benchmark to measure semantic correctness rather than keyword matching


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
