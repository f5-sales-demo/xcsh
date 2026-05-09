---
name: account-planning
description: Account planning and territory strategy for F5 XC SEs. Generates white-space analysis, expansion mapping, and account health assessments. Use when the user mentions account planning, territory strategy, white-space analysis, or account review.
---

# Account Planning for F5 Distributed Cloud

You are helping a sales engineer develop or update an account plan.
The goal is actionable territory intelligence that drives pipeline generation.

## Account Plan Structure

### 1. Account Overview

Pull from Salesforce (`sf_query`):
- Account name, industry, annual revenue, employee count
- Current F5 footprint (existing products, contract value, renewal dates)
- Account team roster (AE, SE, CSM, exec sponsor)
- Relationship health: recent meetings, NPS, support ticket trends

### 2. White-Space Analysis

Map the customer's infrastructure against F5 XC capabilities:

| Customer Environment | Current Solution | F5 XC Opportunity | Priority |
|---|---|---|---|
| Multi-cloud networking | Per-cloud VPN gateways | MCN: unified mesh | High |
| Web app security | Legacy WAF appliance | WAAP: cloud-delivered | High |
| API security | No dedicated solution | API Security discovery + protection | Medium |
| Bot management | Basic rate limiting | Bot Defense: ML-based | Medium |
| DDoS protection | Cloud provider basic | DDoS: volumetric + app-layer | Low |
| CDN / app delivery | Third-party CDN | App Connect: integrated delivery | Low |

### 3. Expansion Opportunities

For existing customers, identify:
- **Upsell**: Additional F5 XC modules on existing deployment
- **Cross-sell**: New use cases in different business units or regions
- **Platform expansion**: Move from point solution to platform adoption
- **Renewal protection**: Risks to existing contract renewal

### 4. Competitive Landscape

For each account:
- Incumbent vendors and contract timelines
- Competitive displacement opportunities (contract renewal windows)
- Customer satisfaction with current vendors
- Use the `competitive` skill for positioning guidance

### 5. Stakeholder Map

| Name | Title | Influence | Relationship | MEDDPICC Role | Next Action |
|---|---|---|---|---|---|
| (from contacts) | | High/Med/Low | Strong/Neutral/New | EB/Champion/etc. | Scheduled meeting/Intro needed |

### 6. Action Plan

- **30-day actions**: Immediate pipeline generation activities
- **90-day milestones**: Deals to advance, stakeholders to engage
- **Annual targets**: Revenue goals, product adoption goals, relationship goals

## Territory-Level Analysis

When analyzing a territory (not a single account):

### Pipeline Health
Pull from Salesforce:
- Total pipeline by forecast category
- Pipeline coverage ratio (pipeline / quota)
- Average deal size and win rate trends
- Aging deals (no activity > 30 days)

### Account Prioritization
Rank accounts by:
1. Revenue potential (ARR opportunity)
2. Strategic value (logo, reference potential, industry influence)
3. Win probability (relationship strength, competitive position, timing)
4. Resource efficiency (SE effort required vs deal size)

### Territory Gaps
- Industries with no active pipeline
- Product areas with no current customers
- Geographic regions underserved
- Accounts with expiring competitor contracts (displacement timing)
