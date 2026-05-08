# xcsh Self-Awareness Manifest

This document is xcsh's self-knowledge base. It defines what xcsh is, what it should become, and how to measure progress. It serves as the primary input for autoresearch self-evaluation sessions.

## Mission

xcsh is the technical coworker for F5 Distributed Cloud account teams. Primary operator: Sales Engineers and Solutions Architects. Purpose: accelerate deal velocity by making the SE more effective at every stage of the sales cycle.

The tool is NOT a general-purpose coding assistant that happens to know about F5. It IS a specialized SE workstation that uses coding capability as one of many instruments in service of selling F5 Distributed Cloud.

## Origin and Context

Forked from pi-mono (a general-purpose coding assistant). The codebase retains significant generic coding infrastructure which is valuable as foundational capability. The specialization work is layered on top:

- System prompt rewritten for SE persona (F5 XC expertise, MEDDPICC, demos, customer meetings)
- F5 XC API integration (services/f5xc-*)
- Salesforce pipeline integration (sf_query, sf_setup, xcsh://salesforce)
- Product knowledge routing (llms.txt hierarchy)
- Specialized agents (deal-analyst, status-operator, cli-operator, github-ops)
- Internal documentation protocols (xcsh://about, xcsh://user, xcsh://computer, xcsh://salesforce)

## Current Capability Inventory

### Mature (functional, tested, integrated)
| Capability | Implementation | Location |
|---|---|---|
| F5 XC API calls | REST client with auth, URL construction | `services/f5xc-api-client.ts`, `xcsh_api` tool |
| F5 XC context awareness | Tenant/namespace detection, connection status | `services/f5xc-context.ts`, `services/f5xc-env.ts` |
| Product knowledge routing | Tiered llms.txt cascade | System prompt `# Product knowledge` section |
| Salesforce queries | SOQL execution, pipeline reporting | `sf_query` tool, `xcsh://salesforce` protocol |
| Git operations | Branch management, commit workflow | `commit/` module, `github-ops` agent |
| System prompt SE persona | Identity, epistemic integrity, stakes | `prompts/system/system-prompt.md` |
| Code editing | AST-aware, LSP-integrated, multi-file | Full tool suite inherited from pi-mono |
| Internal URL protocols | Self-docs, skills, rules, artifacts | `internal-urls/` module |

### Developing (functional but shallow)
| Capability | Current State | Gap |
|---|---|---|
| MEDDPICC qualification | Referenced in system prompt, deal-analyst agent exists | No structured qualification workflow, no eval criteria, no scoring rubric |
| Demo management | System prompt references demos | No demo catalog, no environment provisioning, no demo script templates |
| Customer meeting prep | Mentioned in mission statement | No structured pre-call planning workflow, no meeting template system |
| Competitive positioning | Generic instruction to check product docs | No competitor database, no battlecard system, no objection handling library |
| Presentation generation | Not implemented | No slide generation, no deck templates, no presentation workflows |

### Missing (not yet started)
| Capability | Value to SE | Complexity |
|---|---|---|
| Deal health dashboard | Real-time pipeline visibility with MEDDPICC scores | Medium |
| Demo environment lifecycle | Provision, configure, tear down demo environments | High |
| Call preparation briefs | Auto-generated pre-call intelligence packages | Medium |
| Win/loss analysis | Pattern recognition across deal outcomes | Medium |
| Technical validation plans | Structured POC/POV planning and tracking | Medium |
| ROI/TCO calculators | Quantified business case generation | Low |
| Competitive intelligence refresh | Automated tracking of competitor announcements | Medium |
| Account planning | Territory strategy, white-space analysis | High |
| Post-sale handoff | Structured knowledge transfer to PS/CSM | Low |

## Evaluation Dimensions

These are the axes along which xcsh should be measured. Each dimension has observable, testable criteria.

### 1. Product Knowledge Accuracy
**What to test**: Can xcsh correctly answer F5 XC product questions using the llms.txt hierarchy?
**Metrics**:
- Factual accuracy (verified against current docs)
- Source citation quality (does it reference specific doc pages?)
- Hallucination rate (claims not grounded in sources)
- Coverage (can it handle questions across all F5 XC product areas?)
**Benchmark approach**: Curated question set with known-correct answers, scored by accuracy.

### 2. API Integration Reliability
**What to test**: Do F5 XC API calls work correctly for common SE workflows?
**Metrics**:
- API call success rate
- Correct endpoint selection (catalog lookup accuracy)
- Payload construction accuracy
- Error handling quality
**Benchmark approach**: Scripted API call sequences against live tenant, scored by success/failure.

### 3. Salesforce Data Quality
**What to test**: Can xcsh pull accurate pipeline data and derive useful insights?
**Metrics**:
- Query accuracy (correct SOQL for the ask)
- Data interpretation quality
- Pipeline summary completeness
- Forecast accuracy alignment
**Benchmark approach**: Known pipeline state, compare xcsh analysis against ground truth.

### 4. MEDDPICC Qualification
**What to test**: Can xcsh effectively qualify a deal using MEDDPICC methodology?
**Metrics**:
- Element coverage (does it address all 8 elements?)
- Gap identification accuracy
- Coaching recommendation quality
- Action item specificity
**Benchmark approach**: Synthetic deal scenarios with known MEDDPICC gaps, scored by identification rate.

### 5. Demo Reliability
**What to test**: Can xcsh configure and validate demo environments?
**Metrics**:
- Configuration accuracy (do created objects work?)
- Environment validation completeness
- Troubleshooting effectiveness
- Demo narrative quality
**Benchmark approach**: End-to-end demo setup scenarios, scored by working-state verification.

### 6. Customer Communication Quality
**What to test**: Does xcsh produce appropriate customer-facing content?
**Metrics**:
- Technical accuracy
- Audience-appropriate tone
- Actionable recommendations
- Professional formatting
**Benchmark approach**: Scenario-based content generation, scored against rubric.

### 7. Competitive Positioning
**What to test**: Can xcsh accurately position F5 XC vs competitors?
**Metrics**:
- Claim accuracy (verified against current product state)
- Differentiation clarity
- Objection handling effectiveness
- Win theme identification
**Benchmark approach**: Competitive scenario prompts, scored against known differentiators.

## Known Gaps and Priorities

### Critical (blocks SE effectiveness)
1. **No structured MEDDPICC workflow** — The deal-analyst agent exists but has no scoring rubric, no structured qualification process, no gap-to-action mapping.
2. **No demo catalog** — SEs cannot list, select, or configure demos through xcsh. Demo management is entirely manual.
3. **Product knowledge depends on external docs availability** — If llms.txt hierarchy is unreachable, xcsh loses product knowledge entirely.

### Important (reduces SE efficiency)
4. **No meeting preparation workflow** — Pre-call planning is manual. No account intelligence aggregation, no agenda templates, no technical discovery question banks.
5. **No competitive battlecards** — Competitive positioning relies on live web search. No cached, verified competitive intelligence.
6. **No presentation generation** — SEs create decks manually. No template system, no automated content population.

### Desirable (enhances SE experience)
7. **No self-evaluation loop** — xcsh cannot test its own capabilities automatically. This document is the first step toward enabling that.
8. **No learning from interactions** — xcsh does not improve from past SE interactions. No feedback loop from deal outcomes.
9. **No territory-level intelligence** — Pipeline analysis is per-query. No persistent territory view, trend analysis, or forecasting.

## How This Document Is Used

1. **Autoresearch self-evaluation**: When running `/autoresearch` with an SE evaluation goal, the program template (`autoresearch.program.md`) references this document to understand what to evaluate and how.
2. **Capability gap identification**: New feature development should be prioritized against the gaps listed here.
3. **Progress tracking**: As capabilities mature, update the inventory tables above.
4. **Self-improvement loop**: xcsh reads this document to understand its own state, identify improvement opportunities, and generate specific enhancement proposals.

## Update Protocol

This document should be updated when:
- A new SE capability is implemented
- An existing capability matures from "developing" to "mature"
- A new gap is identified from customer interactions
- Evaluation criteria are refined based on real usage
- The mission or priorities shift based on business needs

Maintainer: The autoresearch self-evaluation loop itself should propose updates to this document as part of its findings.
