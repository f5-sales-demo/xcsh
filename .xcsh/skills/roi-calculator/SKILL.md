---
name: roi-calculator
description: Generate ROI and TCO business case documents for F5 XC deals. Quantifies cost savings, operational efficiency gains, risk reduction, and payback period. Use when the user mentions ROI, TCO, business case, cost justification, or total cost of ownership.
---

# ROI/TCO Business Case Generator

You are helping a sales engineer build a quantified business case for F5
Distributed Cloud. The output should be specific enough for the customer's
economic buyer to use in budget approval.

## Business Case Structure

### 1. Current State Cost Analysis (TCO Baseline)

Quantify the customer's existing costs across these categories:

**Infrastructure costs:**
- Hardware (appliances, load balancers, WAF boxes) — CapEx and maintenance
- Cloud service costs (per-cloud WAF, CDN, DDoS, networking)
- Data center rack space, power, cooling for on-prem appliances
- License renewal costs for existing solutions

**Operational costs:**
- FTE hours for security policy management across multiple consoles
- FTE hours for network configuration across clouds
- Incident response time and cost (MTTR x incident frequency x cost per hour)
- Change management overhead (how long to deploy a new policy?)

**Risk costs:**
- Average cost of a security breach in their industry
- Compliance penalty exposure
- Downtime cost per hour (revenue impact + productivity loss)
- Insurance premium impact from security posture

### 2. F5 XC Projected Costs

**Subscription costs:**
- F5 XC tier pricing (base platform + add-on modules)
- Estimated consumption-based costs (bandwidth, requests, API calls)
- Professional services for initial deployment

**Migration costs:**
- Implementation effort (F5 SE + customer team hours)
- Testing and validation period
- Training for customer operations team
- Parallel running period (old + new)

### 3. Savings Categories

**Direct cost savings:**
- Hardware elimination or reduction
- License consolidation (N vendor licenses → 1 F5 XC subscription)
- Cloud networking cost reduction (fewer VPN gateways, transit hubs)

**Operational efficiency:**
- Reduced console count (N consoles → 1 control plane)
- Faster policy deployment (hours → minutes)
- Reduced FTE hours for routine operations
- Lower MTTR through unified visibility

**Risk reduction:**
- Improved security posture (quantified by reduced attack surface)
- Faster incident response
- Better compliance posture
- Reduced exposure window

### 4. ROI Calculation

```
Annual Savings = (Current State TCO) - (F5 XC Annual Cost)
Implementation Cost = Migration + Training + Parallel Run
Net Benefit (Year 1) = Annual Savings - Implementation Cost
Net Benefit (Year 2+) = Annual Savings
ROI = (Net Benefit Year 1 + Net Benefit Year 2 + Net Benefit Year 3) / Implementation Cost
Payback Period = Implementation Cost / (Annual Savings / 12) months
```

### 5. Sensitivity Analysis

Show the business case under different assumptions:
- **Conservative**: Minimum expected savings, maximum costs
- **Expected**: Most likely scenario
- **Optimistic**: Maximum savings potential

This prevents the business case from appearing overly aggressive and builds credibility.

## Industry Benchmarks

Use these as starting points when customer-specific data is unavailable:

| Metric | Range | Source |
|---|---|---|
| Average cost of data breach | $4.45M (global average) | IBM Cost of Data Breach Report |
| Security operations FTE cost | $120K-$180K fully loaded | Industry benchmarks |
| Downtime cost (mid-market) | $5,600-$9,000/minute | Gartner |
| Policy deployment time (legacy) | 4-24 hours | Customer interviews |
| Policy deployment time (F5 XC) | 5-30 minutes | F5 XC documentation |
| Console consolidation | 3-7 consoles → 1 | Typical multi-vendor environments |

## Presentation Guidelines

- **Lead with the customer's numbers**, not industry averages
- **Be conservative** in savings estimates — credibility > impressive numbers
- **Show payback period** prominently — economic buyers care about time-to-value
- **Include risk reduction** as a separate line item — it resonates with security-conscious buyers
- **Acknowledge what you cannot quantify** — "soft" benefits like developer velocity
- **Format for the audience**: CFO wants a table, CISO wants risk reduction, CTO wants architecture simplification
