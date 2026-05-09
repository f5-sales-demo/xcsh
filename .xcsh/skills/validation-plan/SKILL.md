---
name: validation-plan
description: Generate structured POC/POV technical validation plans for F5 XC deals. Covers success criteria, test scenarios, timelines, resource requirements, and exit criteria. Use when the user mentions POC, POV, proof of concept, proof of value, technical validation, or pilot.
---

# Technical Validation Plan Generator

You are helping a sales engineer create a structured Proof of Concept (POC) or
Proof of Value (POV) plan for an F5 Distributed Cloud deal. The plan must be
specific enough to execute and measurable enough to evaluate.

## POC vs POV

**POC (Proof of Concept)**: Demonstrates that the technology works in the customer's
environment. Focus: "Can it do what we need?" Typically technical audience.

**POV (Proof of Value)**: Demonstrates business impact and ROI. Focus: "Is the
investment justified?" Typically includes business stakeholders.

Use POV when possible — it ties technical validation to business outcomes, which
strengthens the deal.

## Validation Plan Structure

### 1. Executive Summary
- Customer name, deal context, validation type (POC/POV)
- Business problem being validated
- Expected duration and resource commitment
- Definition of success (one sentence)

### 2. Success Criteria

Define measurable exit criteria before the validation begins. Both parties
must agree on these before starting.

**Technical success criteria examples:**
- Application latency through F5 XC < Xms at the 95th percentile
- WAF blocks Y% of OWASP Top 10 attack patterns with zero false positives on production traffic
- Multi-cloud connectivity between AWS VPC and Azure VNET established with < Xms added latency
- API discovery identifies all endpoints in the customer's API inventory
- Bot defense identifies and mitigates automated traffic without impacting legitimate users

**Business success criteria examples:**
- Operational complexity reduced from N consoles to single pane of glass
- Mean time to deploy new application security policy < X hours (vs current Y hours)
- Compliance requirements (PCI-DSS, SOC2, HIPAA) met by F5 XC configuration

### 3. Test Scenarios

For each use case being validated:

| Scenario | Test Steps | Expected Result | Success Metric | Priority |
|---|---|---|---|---|
| WAF basic protection | Deploy app, configure WAF policy, run OWASP test suite | All critical attacks blocked, no false positives | Block rate > 99%, FP rate < 0.1% | Must-have |
| Multi-cloud networking | Connect 2 cloud sites via F5 XC mesh, test connectivity | Encrypted tunnel established, traffic flows | Latency < 5ms added, zero packet loss | Must-have |
| API discovery | Point API discovery at production API gateway | All known endpoints discovered | Discovery completeness > 95% | Should-have |

### 4. Timeline and Milestones

Typical validation timeline:

| Week | Activity | Deliverable |
|---|---|---|
| 0 | Kickoff, environment prep, access provisioning | Environment ready, CE sites deployed |
| 1 | Core use case implementation | Primary test scenarios passing |
| 2 | Extended testing, edge cases, integration | All test scenarios complete |
| 3 | Results analysis, documentation, stakeholder review | Validation report delivered |

Adjust based on complexity. Simple WAF POC: 1-2 weeks. Multi-cloud networking POV: 3-4 weeks.

### 5. Resource Requirements

**Customer side:**
- Technical point of contact (dedicated 4-8 hrs/week)
- Environment access (cloud accounts, network access, test applications)
- Security team involvement for policy review
- Business stakeholder for success criteria sign-off

**F5 side:**
- SE (primary technical lead)
- AE (relationship and commercial alignment)
- F5 support (escalation path for technical blockers)
- Product specialist (if specialized features involved)

### 6. Environment Specification

Document the validation environment:
- Cloud providers and regions
- Network topology (VPCs, subnets, peering)
- Applications under test (URLs, protocols, traffic patterns)
- Existing security stack (what F5 XC replaces or complements)
- Customer Edge (CE) deployment targets (VM, bare metal, cloud)
- Access requirements (VPN, bastion, IAM roles)

Use the `demo-components` skill to identify pre-built components that can
accelerate environment setup.

### 7. Risk Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Customer resource unavailable | Timeline slip | Identify backup contact, front-load customer-dependent tasks |
| Environment access delayed | Cannot start testing | Request access in week -1, have fallback test environment |
| Technical blocker | Validation incomplete | Daily stand-up during active testing, escalation path to F5 engineering |
| Scope creep | Validation never ends | Lock success criteria at kickoff, defer new requirements to follow-up |
| No business sponsor | Results ignored | Secure exec sponsor before kickoff, schedule mid-point check-in |

### 8. Exit Criteria and Next Steps

After validation completes:
- **Success path**: Document results, present to business stakeholders, proceed to commercial negotiation
- **Partial success**: Identify gaps, propose remediation, schedule follow-up validation
- **Not successful**: Honest assessment of what did not work, lessons learned, determine if resolvable

## Data Sources for Plan Generation

| Source | What to Pull | Tool |
|---|---|---|
| Salesforce | Deal stage, amount, close date, contacts | `sf_query` |
| F5 XC APIs | Current tenant config, existing deployments | `xcsh_api`, `xcsh://api-catalog/` |
| Product docs | Feature availability, configuration guides | llms.txt hierarchy |
| Demo catalog | Pre-built test infrastructure | `skill://demo-components` |
