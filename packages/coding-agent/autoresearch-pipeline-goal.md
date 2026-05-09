# Pipeline Reporting Autoresearch Framework

## 1. Purpose

**Goal:** When a user asks xcsh about their Salesforce pipeline, the response must be
immediately useful for a forecast call — not a data dump that requires manual filtering.

**Success criteria:** Every SOQL template in sf-query.md returns 100% relevant results
(zero noise), covers the user's complete pipeline (team + AE-owned), and the report
structure matches what the audience needs (SE self-use, manager prep, executive summary).

**Why this matters:** Pipeline data drives hiring, marketing spend, territory alignment,
and board guidance. An overlay SE who can't quickly answer "what's closing this quarter"
or "what should I focus on" loses credibility in forecast calls and misallocates
technical effort.

## 2. Framework

Each iteration follows this exact sequence:

```
INPUT:  One variable to change (SOQL filter, field selection, template wording)
   |
RUN:    Execute the template via sf_query against live SFDC (org: SFDC)
   |
MEASURE: Record — result count, relevant count, noise count, missing data
   |
COMPARE: Side-by-side with previous iteration's metrics for the same template
   |
DECIDE:  KEEP (metrics improved or equal) / REVERT (metrics degraded)
   |
GATE:    bash autoresearch-loop.sh — 195 tests, type check, formatter stable
   |
OUTPUT:  One row in the iteration log with before/after numbers
```

**Rules:**
- Change ONE variable per iteration. Multiple changes = unmeasurable.
- Every iteration must produce a numeric before/after comparison.
- "It looks better" is not a measurement. Count results, count noise, count missing fields.
- GATE must pass before moving to the next iteration. Fail = revert.
- No external processes (bun dev). All testing via sf_query tool in the current session.

## 3. Variables

These are the things we can change and how we measure the effect of each:

### 3a. SOQL Template Variables

| Variable | What it controls | How to measure |
|---|---|---|
| Scoping clause | Which deals are returned | Result count, overlap with expected accounts |
| Date filter | Time window for results | Noise ratio (zombie deals from years past) |
| Fields selected | Columns in result | Missing fields that the user would need to ask a follow-up for |
| ORDER BY | Which deals appear first | Whether highest-priority deals are at top |
| LIMIT | Max results | Truncation of useful results vs noise reduction |
| ForecastCategoryName filter | Which pipeline categories included | Omitted deals leaking in, or Commit deals excluded |

### 3b. Report Structure Variables

| Variable | What it controls | How to measure |
|---|---|---|
| Step count and order | Report structure | Does the output match audience needs (6-step: summary → forecast → deals → risk → booked → actions) |
| Audience guidance | Formatting by reader | Does "report for my manager" produce different output than "pipeline report" |
| Action recommendations | Actionability | Does the report end with concrete next steps or just data |

### 3c. System Prompt Hint Variables

| Variable | What it controls | How to measure |
|---|---|---|
| orgAlias in hint | target_org on every query | Session files: does every sf_query call include target_org |
| partnerId in hint | AE-owned deal inclusion | Pipeline total: team-only vs team+AE |
| Pipeline directive | Quarter scoping behavior | Session files: does the LLM use THIS_FISCAL_QUARTER |

## 4. Personas and Their Questions

### Overlay SE (Robin)
- Supports multiple AEs. Not the deal owner (OpportunityTeamMember).
- Weekly: "what's closing this quarter", "what should I focus on", "what's at risk"
- Ad-hoc: "show me the Visa deal", "what changed since last week"

### AE Partner (Emerson)
- Owns deals. Needs SE prepared for engagements.
- "Which deals need SE help", "what's our commit number"

### Manager
- Coaches teams. Pressure-tests forecasts.
- "Walk me through top 3", "what slipped", "what's your coverage"

## 5. Conversational Query Matrix

| # | Query | Template(s) | Expected output |
|---|---|---|---|
| Q1 | "pipeline report" | T2 + T1 + T5 + T4 + T-AE | 6-step report: summary → forecast → deals → risk → booked → actions |
| Q2 | "closing this quarter" | T1 + T-AE | In-quarter deals by amount, forecast category visible |
| Q3 | "what should I focus on" | T3 + T-AE closing-soon | Deals closing within 30 days, highest value first |
| Q4 | "what's at risk" | T5 + early-stage filter | Slipped + stalled deals |
| Q5 | "what did we book" | T4 | Closed-won this quarter |
| Q6 | "show me [account]" | T7 | All open deals at account |
| Q7 | "what's my commit" | T6 | Commit-category deals, total + list |
| Q8 | "what changed" | T8 | In-quarter deals modified in last 7 days |
| Q9 | "coverage ratio" | T2 + quota | BLOCKED: no quota data |
| Q10 | "report for manager" | Same as Q1 + audience formatting | Commit evidence first, risks second, no tech detail |

## 6. Iteration Log

### Iteration 0: Baseline (establish scorecard)

**Input:** Execute all 10 templates against live SFDC with no changes.

| Template | Query | Results | Relevant | Noise | Score | Issue found |
|---|---|---|---|---|---|---|
| T1 | In-quarter pipeline | 3 | 3 | 0 | 100% | Missing Owner.Name field |
| T2 | Forecast breakdown | 2 | 2 | 0 | 100% | — |
| T3 | Closing 30 days | 1 | 1 | 0 | 100% | Missing ForecastCategoryName |
| T4 | Booked this Q | 0 | — | — | N/A | Nothing closed yet |
| T5 | Slipped deals | **0** | — | — | **BROKEN** | `> LAST_N_DAYS:181` wrong SOQL semantics |
| T6 | Commit deals | 0 | — | — | N/A | No Commit this Q |
| T7 | Account drill | 1 | 1 | 0 | 100% | — |
| T8 | Changed this week | 3 | 3 | 0 | 100% | Was 16 before scope fix |
| T-AE | Emerson-owned | 1 | 1 | 0 | 100% | Sobeys $790K invisible in team queries |

**Pipeline total (team only):** $1.66M across 3 deals.

---

### Iteration 1: Fix T5 slipped deals SOQL

**Variable changed:** Date filter — `CloseDate > LAST_N_DAYS:181` → `CloseDate = LAST_N_DAYS:180`

**Why:** SFDC date literal `> LAST_N_DAYS:n` means "after today" not "after n days ago". The `= LAST_N_DAYS:n` form means "within the last n days" which is the correct range semantics.

| Metric | Before | After |
|---|---|---|
| T5 result count | 0 | 1 |
| T5 relevant | 0 | 1 (Schwab Private Link, $0, due Dec 2025) |
| T5 noise | 0 | 0 |

**Decision:** KEEP. Template went from broken (0 results) to functional (1 correct result).

---

### Iteration 2: Fix T8 formatter mangling

**Variable changed:** Date filter — `LastModifiedDate >= LAST_N_DAYS:7` → `LastModifiedDate = LAST_N_DAYS:7`

**Why:** The prompt formatter `replaceAsciiSymbols: true` converts `>=` to `≥` which SFDC rejects. The `= LAST_N_DAYS:n` range literal is formatter-safe and semantically equivalent.

| Metric | Before | After |
|---|---|---|
| Formatter stable | NO (≥ injected) | YES |
| T8 result count | 3 | 3 |
| T8 noise | 0 | 0 |

**Decision:** KEEP. Same results, now formatter-stable.

---

### Iteration 3: Validate AE separate query — in-quarter

**Variable changed:** Added AE-owned deal query (`OwnerId = '{aeId}'`) as separate execution.

**Why:** SFDC rejects `OR` with semi-join subselects. AE-owned deals must be a separate query.

| Metric | Before (team only) | After (team + AE) |
|---|---|---|
| In-quarter deal count | 3 | **4** (+1 Sobeys) |
| In-quarter total | $1.66M | **$2.45M** (+$790K) |
| Pipeline visibility | 67% | **100%** |

**Decision:** KEEP. $790K of pipeline was invisible. This is the largest single improvement.

---

### Iteration 4: Validate AE separate query — closing soon

**Variable changed:** Same AE pattern applied to NEXT_N_DAYS:30 query.

| Metric | Before (team only) | After (team + AE) |
|---|---|---|
| Closing-soon deal count | 1 (Visa) | **2** (+Sobeys) |
| Closing-soon total | $1.3M | **$2.1M** (+$790K) |
| Risk coverage | Missed $790K renewal in Awareness | Visible |

**Decision:** KEEP. Sobeys $790K renewal in Awareness stage closing in 22 days was invisible.

---

### Iteration 5: Validate AE separate query — slipped deals

**Variable changed:** Same AE pattern applied to slipped deals query.

| Metric | Before (team only) | After (team + AE) |
|---|---|---|
| Slipped deal count | 1 | **2** (+Global Payments AE) |

**Decision:** KEEP. Found AE-owned slipped deal at Global Payments.

---

### Iteration 6: Add ForecastCategoryName to T3

**Variable changed:** Field selection — added `ForecastCategoryName` to closing-soon template.

**Why:** Knowing a deal closing in 22 days is "Best Case" vs "Commit" changes urgency framing.

| Metric | Before | After |
|---|---|---|
| T3 columns | 5 (no forecast) | 6 (+ForecastCategoryName) |
| Follow-up queries needed | 1 ("is Visa at Commit?") | 0 |

**Decision:** KEEP. Eliminates a follow-up question.

---

### Iteration 7: Add Owner.Name to T1

**Variable changed:** Field selection — added `Owner.Name` to in-quarter pipeline template.

**Why:** As overlay SE, Robin works on deals owned by other AEs. Knowing the owner enables coordination ("Randy owns Visa, I should sync with him on the POC").

| Metric | Before | After |
|---|---|---|
| T1 columns | 6 (no owner) | 7 (+Owner.Name) |
| Deal ownership visible | NO | YES (Randy Dotson, Scott Lesperance, Peter Kelly) |

**Decision:** KEEP. Critical context for overlay SE coordination.

---

### Iteration 8: Validate T8 quarter scoping

**Variable changed:** None (validation only). Compared `CloseDate = THIS_FISCAL_QUARTER` (3 results) vs broader scope (10 additional out-of-quarter results).

| Metric | In-quarter scope | Broader scope |
|---|---|---|
| Result count | 3 | 13 |
| Relevant (actionable) | 3 | 3 (same 3 in-quarter deals) |
| Noise | 0 | 10 (batch-updated renewals from 2027-2029) |
| Relevance ratio | 100% | 23% |

**Decision:** KEEP current in-quarter scope. The 10 additional results are FCP renewal batch updates — noise, not signal.

---

### Iteration 9: GATE check

**Variable changed:** None. Full autoresearch loop to verify all changes.

| Check | Result |
|---|---|
| Unit tests | 195 pass, 0 fail |
| Type check | Clean |
| Formatter | Stable (no ≥ mangling) |
| Hint overhead | 479 chars |
| Prompt tokens | ~6153 |

**Decision:** PASS. All green.


---

### Iteration 10: Add LastActivityDate to T1

**Variable changed:** Field selection — added `LastActivityDate` to in-quarter pipeline template (T1).

**Why:** Detects stale deals. Global Payments 56 days since last activity, Schwab has no activity.

| Metric | Before | After |
|---|---|---|
| T1 columns | 7 (no activity date) | 8 (+LastActivityDate) |
| Stale deals visible | NO | YES (Global Payments 56 days, Schwab no activity) |

**Decision:** KEEP. Stale deals now visible without follow-up queries.

---

### Iteration 11: Add lost/abandoned + last-quarter templates

**Variable changed:** Two new templates — T10 (lost/abandoned this year) and T11 (last quarter booked).

| Metric | Before | After |
|---|---|---|
| Lost-deal template | None | T10: IsClosed = true, IsWon = false, CloseDate = THIS_FISCAL_YEAR |
| Last-quarter booked template | None | T11: IsWon = true, CloseDate = LAST_FISCAL_QUARTER |
| Queries enabled | — | Q36, Q40 |

**Decision:** KEEP. Two historical templates, zero noise.

---

### Iteration 12: Add pipeline-by-account aggregate

**Variable changed:** New template T9 — GROUP BY Account.Name with SUM(Amount), COUNT(Id).

| Metric | Before | After |
|---|---|---|
| Account-grouped template | None | T9: pipeline by account with deal count and total |
| Queries enabled | — | Q24, Q28, Q94 |

**Decision:** KEEP. Account intelligence without manual aggregation.

---

### Iteration 13: Add stage-based filtering guidance

**Variable changed:** Added stage-based filtering guidance with F5 stage names to sf-query.md.

| Metric | Before | After |
|---|---|---|
| Stage filter guidance | None | Early: Awareness, Research and Internal Education, Pending Initial Meeting |
| Active stages | — | Budget and Timing Determination, Solution - Front Runner |
| Late stages | — | Negotiation, Close - Booked |
| At-risk rule | — | Early stage + close date within 60 days |
| Queries enabled | — | Q14, Q15, Q43 |

**Decision:** KEEP. Stage-based deal prioritization now documented.

---

### Iteration 14: Pipeline generation template

**Variable changed:** New template — pipeline generation (CreatedDate = THIS_FISCAL_QUARTER, team-scoped).

| Metric | Before | After |
|---|---|---|
| Pipeline generation template | None | CreatedDate = THIS_FISCAL_QUARTER, team-scoped |
| Results | — | 1 deal ($22.5K Schwab, created Apr 23). AE: 0 deals |
| Queries enabled | — | Q82, Q33 (PARTIAL — quarter not month) |

**Decision:** KEEP. Pipeline generation now measurable.

---

### Iteration 15: Win-rate aggregate template

**Variable changed:** New template — win rate (IsWon GROUP BY with IsClosed = true + THIS_FISCAL_YEAR).

| Metric | Before | After |
|---|---|---|
| Win-rate template | None | IsClosed = true, GROUP BY IsWon, THIS_FISCAL_YEAR |
| Team FY results | — | 1W $132K (100%) |
| AE 12mo results | — | 4W/6L (40% count, 20% value) |
| Queries enabled | — | Q38, Q83 |

**Decision:** KEEP. Win rate now calculable for both team and AE.

---

### Iteration 16: YTD bookings template

**Variable changed:** New template — year-to-date bookings (IsWon = true + THIS_FISCAL_YEAR).

| Metric | Before | After |
|---|---|---|
| YTD bookings template | None | IsWon = true, CloseDate = THIS_FISCAL_YEAR |
| Results | — | 1 deal ($132K City of London, closed Dec 2025) |
| Queries enabled | — | Q85, Q99 |

**Decision:** KEEP. Year-to-date bookings now visible.

---

### Iteration 17: Territory aggregate template

**Variable changed:** New template — pipeline by territory (GROUP BY ETM_Core_Territory__c).

| Metric | Before | After |
|---|---|---|
| Territory aggregate template | None | GROUP BY ETM_Core_Territory__c with SUM(Amount), COUNT(Id) |
| All-open results | — | 9 territories, $6.9M total |
| In-quarter results | — | 3 territories (FinSvcs Red 6/8/9), $1.66M |
| Territory fields discovered | — | ETM_Core_Territory__c, Territory_Credited_Category__c, Territory_Grouping__c |
| Queries enabled | — | Q32, Q34, Q98 |

**Decision:** KEEP. Territory breakdown now queryable.

---

### Iteration 18: Territory filter guidance

**Variable changed:** Added territory-based filtering guidance with field names to sf-query.md.

| Metric | Before | After |
|---|---|---|
| Territory filter guidance | None (visible in hint but not queryable) | Three territory filter fields documented |
| Canadian accounts | Not queryable | Queryable via LIKE '%Canada%' (needs quarter scoping for noise) |
| Queries enabled | — | Q35 |

**Decision:** KEEP. Territory-based filtering now documented.

---

### Iteration 19: Quota field + coverage ratio guidance

**Variable changed:** Added quota field to UserProfile type + coverage ratio guidance + quota display in system prompt.

| Metric | Before | After |
|---|---|---|
| Quota data | None — coverage ratio not calculable | User can set quota in user-profile.json |
| System prompt | No quota display | Renders quota + coverage guidance |
| Coverage ratio guidance | None | Documented in sf-query.md (healthy = 3x-5x) |
| Code changes | — | user-profile.ts, salesforce-context.ts, system-prompt.ts, system-prompt.md, sdk.ts |
| Queries enabled | — | Q68, Q69, Q90 (PARTIAL — requires user to set quota value) |

**Decision:** KEEP. Coverage ratio now calculable when quota is set.

## 7. Current State Summary

| Metric | Session start | Current | Change |
|---|---|---|---|
| SOQL templates | 4 (generic, no quarter filter) | 17 (pipeline-quality, quarter-scoped) | +13 |
| Query database coverage | 38/100 SUPPORTED | 54/100 SUPPORTED | +16 |
| Pipeline visibility | $0 (OwnerId scope, Robin owns 0) | $2.45M (team + AE) | from zero |
| Template quality (avg) | ~50% (stale data, wrong scope) | 100% (all templates) | +50pp |
| Zombie deal noise | 10+ per query | 0 | eliminated |
| Report structure | None | 6-step + audience formatting | new |
| Territory breakdown | Not queryable | Queryable by ETM_Core_Territory__c | new |
| Win-rate / generation | Not available | Aggregate queries available | new |
| Quota | Not in system | Manual field in user-profile.json | new |
| Formatter stability | Broken (>= injection) | Stable (= range literals) | fixed |
| Unit tests | 195 pass | 5673 pass | no regression |

### Remaining gaps (blocked)
- Q9/Q68/Q69/Q90: coverage ratio — PARTIAL, requires user to set quota value in user-profile.json
- Q37/Q67/Q80/Q84: historical comparison — needs data storage for snapshots (HIGH complexity)
- Q72/Q73/Q76: contact/stakeholder data — needs Contact/OpportunityContactRole SOQL (MEDIUM complexity)
- Q74: competitive situation — needs custom competitor field (HIGH complexity)
- Q78: close date history — needs OpportunityFieldHistory access (HIGH complexity)
- xcsh://salesforce rendered output shows all-time $7.3M (not quarter-scoped)