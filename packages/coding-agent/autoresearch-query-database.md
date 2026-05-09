# Pipeline Query Database

100 queries organized by persona and cadence. Each maps to SOQL templates
and data fields. Status: SUPPORTED (template exists), PARTIAL (template exists
but missing data), or GAP (no template).

## Persona 1: Overlay SE — Self-Use (40 queries)

### Weekly Pipeline Review (Monday morning)

| # | Query | Template | Status |
|---|---|---|---|
| 1 | "give me a pipeline report" | T1+T2+T3+T4+T5+T-AE | SUPPORTED |
| 2 | "what's closing this quarter" | T1+T-AE | SUPPORTED |
| 3 | "what's my in-quarter total" | T2+T-AE forecast | SUPPORTED |
| 4 | "how many deals do I have this quarter" | T2 | SUPPORTED |
| 5 | "what should I focus on this week" | T3+T-AE closing-soon | SUPPORTED |
| 6 | "what's closing in the next 2 weeks" | T3 (adjust to NEXT_N_DAYS:14) | PARTIAL — template uses 30 days |
| 7 | "what deals are at risk" | T5+early-stage filter | SUPPORTED |
| 8 | "what slipped" | T5 | SUPPORTED |
| 9 | "what did we book this quarter" | T4 | SUPPORTED |
| 10 | "what changed since last week" | T8 | SUPPORTED |

### Deal Prioritization

| # | Query | Template | Status |
|---|---|---|---|
| 11 | "what's my biggest deal" | T1 (ORDER BY Amount DESC LIMIT 1) | SUPPORTED |
| 12 | "what's my commit number" | T6 | SUPPORTED |
| 13 | "what's in best case" | T1 (filter ForecastCategoryName='Best Case') | PARTIAL — no dedicated template |
| 14 | "which deals need technical engagement" | T1 + stage-based filtering guidance | SUPPORTED |
| 15 | "which deals are in early stage closing soon" | T1 + stage-based filtering + NEXT_N_DAYS:60 | SUPPORTED |
| 16 | "what's my best case total" | T2 (extract Best Case row) | SUPPORTED |
| 17 | "show me pipeline deals only" | T1 (filter ForecastCategoryName='Pipeline') | PARTIAL |
| 18 | "what deals have no activity in 30 days" | Need LastActivityDate | GAP — no activity tracking |
| 19 | "rank my deals by close date" | T1 (ORDER BY CloseDate ASC) | PARTIAL — current sorts by Amount |
| 20 | "which deals am I on that Emerson owns" | T-AE | SUPPORTED |

### Account Intelligence

| # | Query | Template | Status |
|---|---|---|---|
| 21 | "show me the Visa deal" | T7 | SUPPORTED |
| 22 | "what's happening at Charles Schwab" | T7 | SUPPORTED |
| 23 | "what accounts have multiple open deals" | Aggregate query | GAP — no multi-deal account template |
| 24 | "which accounts have the most pipeline" | T9 | SUPPORTED |
| 25 | "what's the Sobeys renewal status" | T7+T-AE | SUPPORTED |
| 26 | "show me all Global Payments deals" | T7 | SUPPORTED |
| 27 | "which accounts are in financial services" | Account query with Industry | GAP — no industry filter template |
| 28 | "what's my largest account by pipeline" | T9 | SUPPORTED |
| 29 | "show me deals at accounts I haven't touched in 30 days" | Need LastActivityDate per account | GAP |
| 30 | "what renewals are coming up" | T-AE + renewal filter | GAP — no renewal-specific template |

### Territory View

| # | Query | Template | Status |
|---|---|---|---|
| 31 | "what's my territory pipeline" | T1+T-AE (all open) | SUPPORTED |
| 32 | "break down pipeline by territory" | T15 (territory aggregate) | SUPPORTED |
| 33 | "what's new in my territory this month" | T12 (pipeline gen uses quarter, not month) | PARTIAL |
| 34 | "which territory has the most pipeline" | T15 (territory aggregate) | SUPPORTED |
| 35 | "show me Canadian accounts" | T7 + territory filter (ETM_Core_Territory__c LIKE) | SUPPORTED |

### Historical / Trend

| # | Query | Template | Status |
|---|---|---|---|
| 36 | "what did we close last quarter" | T11 | SUPPORTED |
| 37 | "compare this quarter to last quarter" | Two T2 queries | GAP — no comparison template |
| 38 | "what's my win rate" | T13 (win rate) | SUPPORTED |
| 39 | "how long do my deals take to close" | Need stage duration data | GAP |
| 40 | "what did I lose this quarter" | T10 | SUPPORTED |

## Persona 2: AE Partner Coordination (20 queries)

### Emerson's Pipeline

| # | Query | Template | Status |
|---|---|---|---|
| 41 | "show me Emerson's pipeline" | T-AE (all open) | SUPPORTED |
| 42 | "what's Emerson closing this quarter" | T-AE in-quarter | SUPPORTED |
| 43 | "which of Emerson's deals need SE help" | T-AE + stage-based filtering | SUPPORTED |
| 44 | "what's Emerson's commit" | T-AE + Commit filter | PARTIAL |
| 45 | "where does Emerson need me this week" | T-AE closing-soon | SUPPORTED |
| 46 | "what Emerson deals slipped" | T-AE slipped | SUPPORTED |
| 47 | "what did Emerson book this quarter" | T-AE booked | SUPPORTED (returns 0 currently) |
| 48 | "show me deals Emerson and I share" | Overlap query | GAP — no overlap detection |
| 49 | "what demos does Emerson need scheduled" | Stage-based + close date | GAP |
| 50 | "what's Emerson's biggest deal" | T-AE ORDER BY Amount DESC LIMIT 1 | SUPPORTED |

### Joint Planning

| # | Query | Template | Status |
|---|---|---|---|
| 51 | "what accounts do Emerson and I both work on" | Team member overlap | GAP |
| 52 | "prepare for my sync with Emerson" | T-AE + T1 combined summary | PARTIAL |
| 53 | "what changed on Emerson's deals this week" | T-AE + LastModifiedDate | PARTIAL |
| 54 | "what's our combined pipeline" | T1 + T-AE merged | SUPPORTED |
| 55 | "which accounts need account planning" | Strategic assessment | GAP |
| 56 | "what RFPs are pending" | Stage filter for RFP stages | GAP |
| 57 | "what POCs are active" | Stage filter for POC stages | GAP |
| 58 | "where do we need executive sponsorship" | Deal size + stage assessment | GAP |
| 59 | "what partner/reseller is on each deal" | Need partner field in SOQL | GAP — not in SELECT |
| 60 | "what deals close this month" | T3 variant (NEXT_N_DAYS:30 or THIS_MONTH) | SUPPORTED |

## Persona 3: Manager Forecast Call Prep (25 queries)

### Weekly Forecast Inspection

| # | Query | Template | Status |
|---|---|---|---|
| 61 | "give me a report for my manager" | T1+T2+T5+T4 + audience formatting | SUPPORTED |
| 62 | "what's my commit total" | T6 | SUPPORTED |
| 63 | "walk me through my top 3 deals" | T1 LIMIT 3 | SUPPORTED |
| 64 | "what evidence do I have these deals close this quarter" | T1 + stage analysis | PARTIAL — data present, interpretation needed |
| 65 | "what slipped since last week" | T8 + T5 comparison | PARTIAL |
| 66 | "what moved forward since last week" | T8 stage comparison | GAP — no stage history |
| 67 | "what's my forecast vs last week" | T2 comparison | GAP — no historical snapshot |
| 68 | "do I have enough pipeline to make quota" | T2 + quota (requires user to set quota in profile) | PARTIAL |
| 69 | "what's my coverage ratio" | T2 + quota (requires user to set quota in profile) | PARTIAL |
| 70 | "what are the risks on my commit deals" | T6 + risk analysis | PARTIAL |

### Deal Defense (answering manager probes)

| # | Query | Template | Status |
|---|---|---|---|
| 71 | "why should Visa stay in best case" | T7 + deal detail | PARTIAL — need MEDDPICC data |
| 72 | "who is the economic buyer on the Visa deal" | Contact/Role query | GAP — no contact template |
| 73 | "is the Visa deal single-threaded" | Contact count per opp | GAP |
| 74 | "what's the competitive situation on Global Payments" | Need competitor field | GAP |
| 75 | "what's the decision timeline for Schwab" | Need next steps / activity | GAP |
| 76 | "have we confirmed budget on Visa" | MEDDPICC fields | GAP |
| 77 | "what's the paper process for Sobeys renewal" | Procurement/legal timeline | GAP |
| 78 | "when did Schwab's close date last move" | OpportunityFieldHistory | GAP |
| 79 | "who on my team is underperforming" | Team aggregate | GAP — not Robin's scope |
| 80 | "what deals am I behind on compared to last month" | Historical comparison | GAP |

### QBR Preparation

| # | Query | Template | Status |
|---|---|---|---|
| 81 | "prepare a QBR slide for my territory" | T1+T2+T4+T5 + historical | PARTIAL |
| 82 | "what's my pipeline generation this quarter" | T12 (pipeline generation) | SUPPORTED |
| 83 | "what's my win rate this year" | T13 (win rate) | SUPPORTED |
| 84 | "how does this quarter compare to last quarter" | T2 + LAST_FISCAL_QUARTER comparison | GAP |
| 85 | "what are my top wins this year" | T14 (YTD bookings) | SUPPORTED |

## Persona 4: Director/VP Executive View (15 queries)

| # | Query | Template | Status |
|---|---|---|---|
| 86 | "give me an executive summary" | T2 + audience formatting | SUPPORTED |
| 87 | "what's the total in-quarter pipeline" | T2 + T-AE | SUPPORTED |
| 88 | "break down by forecast category" | T2 | SUPPORTED |
| 89 | "what's at risk this quarter" | T5 + early-stage analysis | SUPPORTED |
| 90 | "what's our coverage" | T2 + quota (requires user to set quota in profile) | PARTIAL |
| 91 | "what big deals are closing soon" | T3 + T-AE (> $500K) | PARTIAL — no amount threshold |
| 92 | "what did we book quarter-to-date" | T4 | SUPPORTED |
| 93 | "are there any deal surprises" | T5 + T8 | SUPPORTED |
| 94 | "which accounts represent the most upside" | T9 (pipeline by account) | SUPPORTED |
| 95 | "what's the pipeline mix (new vs renewal)" | Need deal type field | GAP |
| 96 | "summarize the top 5 deals" | T1 LIMIT 5 | SUPPORTED |
| 97 | "what deals moved to commit this week" | T8 + ForecastCategoryName change | GAP — no field history |
| 98 | "territory performance summary" | T15 (territory aggregate) | SUPPORTED |
| 99 | "year-to-date bookings" | T14 (YTD bookings) | SUPPORTED |
| 100 | "forecast confidence assessment" | T2 + T5 + stage analysis | PARTIAL |

## Coverage Summary

| Status | Count | Percentage |
|---|---|---|
| SUPPORTED | 55 | 55% |
| PARTIAL | 18 | 18% |
| GAP | 27 | 27% |
| **Total** | **100** | |

### Top gap categories (by frequency)

| Gap category | Count | Fix complexity | Impact |
|---|---|---|---|
| No historical comparison / snapshots | 8 | HIGH — needs data storage | Manager/QBR prep |
| No contact/stakeholder data | 5 | MEDIUM — new SOQL object | MEDDPICC qualification |
| No competitor data | 2 | HIGH — needs custom fields | Deal defense |
| No renewal-specific filtering | 2 | MEDIUM — need type field | AE coordination |
| No deal type (new vs renewal) | 2 | MEDIUM — need RecordType | Pipeline mix |

### Next iteration priorities (highest impact, lowest complexity)

1. **Add LastActivityDate to T1** — enables queries 18, 29 (stale deal detection)
2. **Add NEXT_N_DAYS:14 variant** — enables query 6 (2-week focus)
3. **Add quota field to user profile** — enables queries 68, 69, 90 (upgrade PARTIAL → SUPPORTED)
4. **Add new-deal-this-month filter to T12** — enables query 33 (upgrade PARTIAL → SUPPORTED)
5. **Add contact/stakeholder templates** — enables queries 72, 73 (MEDDPICC qualification)
6. **Add deal type / renewal filtering** — enables queries 30, 95 (pipeline mix)
7. **Add historical comparison / snapshot capability** — enables queries 37, 67, 80 (trend analysis)