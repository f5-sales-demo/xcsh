# xcsh Self-Awareness Manifest

This document is xcsh's self-knowledge base. It defines what xcsh is, what it should become, and how to measure progress. It serves as the primary input for autoresearch self-evaluation sessions.

## Mission

xcsh is the technical coworker for F5 Distributed Cloud account teams. Primary operator: Sales Engineers and Solutions Architects. Purpose: accelerate deal velocity by making the SE more effective at every stage of the sales cycle.

The tool is NOT a general-purpose coding assistant that happens to know about F5. It IS a specialized SE workstation that uses coding capability as one of many instruments in service of selling F5 Distributed Cloud.

## Origin and Context

Forked from pi-mono (a general-purpose coding assistant). The codebase retains significant generic coding infrastructure which is valuable as foundational capability. The specialization work is layered on top:

- System prompt rewritten for SE persona (F5 XC expertise, MEDDPICC, demos, customer meetings)
- F5 XC API integration (services/f5xc-*)
- F5 XC API schema introspection (`xcsh://api-spec/`, `xcsh://api-catalog/`)
- Salesforce pipeline integration (sf_query, sf_setup, xcsh://salesforce)
- Product knowledge routing (llms.txt hierarchy)
- Specialized agents — prompt-defined subagent personas available via Task tool (deal-analyst, status-operator, cli-operator, github-ops)
- Skills system — pluggable knowledge packs (demo-components, gitlab, semantic-compression, system-prompts)
- Internal documentation protocols (xcsh://about, xcsh://user, xcsh://computer, xcsh://salesforce)
- Autoresearch framework — experiment loop with SE self-evaluation overlay

## Current Capability Inventory

### Mature (functional, tested, integrated)
| Capability | Implementation | Location |
|---|---|---|
| F5 XC API calls | REST client with auth, URL construction, connection pooling | `services/f5xc-api-client.ts`, `xcsh_api` tool |
| F5 XC context awareness | Tenant/namespace detection, connection status, context indicators | `services/f5xc-context.ts`, `f5xc-env.ts`, `f5xc-context-command.ts`, `f5xc-context-indicators.ts` |
| F5 XC API schema introspection | Catalog lookup for CRUD operations, OpenAPI spec browsing | `internal-urls/api-catalog-resolve.ts`, `api-spec-resolve.ts`, `xcsh://api-catalog/`, `xcsh://api-spec/` |
| Product knowledge routing | Tiered llms.txt cascade with routing discipline | System prompt `# Product knowledge` section |
| Salesforce queries | SOQL execution, 30+ query templates, pipeline reporting | `sf_query` tool prompt, `internal-urls/salesforce-context.ts` |
| Git operations | Branch management, commit workflow, PR lifecycle | `commit/` module, `github-ops` agent |
| System prompt SE persona | Identity, epistemic integrity, stakes, SE-specific behavior | `prompts/system/system-prompt.md` |
| Code editing | AST-aware, LSP-integrated, multi-file | Full tool suite inherited from pi-mono |
| Internal URL protocols | Self-docs, skills, rules, artifacts, agent outputs | `internal-urls/` module (20+ protocol handlers) |
| Skills system | Pluggable knowledge packs with auto-loading | Skills infrastructure + 4 active skills |

### Developing (functional but shallow or incomplete)
| Capability | Current State | Gap |
|---|---|---|
| Pipeline intelligence | 30+ SOQL templates in system prompt, audience-aware formatting, forecast breakdowns | No persistent territory view, no trend tracking, no automated refresh. Issues #697-#704 track expansion. |
| MEDDPICC qualification | `<qualification>` section in system prompt with full 8-element framework, deal-analyst agent persona, MEDDPICC workflow in sf-query | No automated scoring from SFDC data, no persistent deal health tracking. Issue #678. |
| Demo infrastructure | demo-components skill provides catalog of deployable Azure VMs (origin servers, traffic generators, CDN simulators) | Catalog exists but no demo scripting, no environment lifecycle management, no demo narrative templates. Issue #679. |
| GitLab integration | gitlab skill with glab CLI tools (issue list, view, search, setup) | Functional for issue tracking but no deep workflow integration. |
| Status page monitoring | status-operator agent persona for Statuspage.io API queries | Functional for ad-hoc queries but no persistent monitoring or alerting. |
| Customer meeting prep | meeting-prep skill with pre-call briefs, stakeholder mapping, discovery questions, agenda templates | No Salesforce data auto-pull, no calendar integration. Issue #680. |
| Competitive positioning | competitive skill with battlecards, competitor profiles (Cloudflare, Akamai, AWS, Palo Alto/Zscaler), objection handling, `<competitive-positioning>` in system prompt | No automated competitor tracking, no win/loss correlation. Issue #681. |
| Technical validation | validation-plan skill with POC/POV planning, success criteria, test scenarios, timeline templates | No automated environment provisioning from plans. Issue #683. |
| Business case generation | roi-calculator skill with TCO analysis, ROI calculation, sensitivity analysis, industry benchmarks | No automated data pull from customer environment. Issue #682. |
| Account planning | account-planning skill with white-space analysis, stakeholder mapping, territory strategy | No persistent account data, no automated pipeline analysis integration. Issue #688. |
| Presentation generation | Not implemented | No slide generation, no deck templates, no presentation workflows. |

### Foundational (inherited from pi-mono, not SE-specific)
| Capability | Value to SE | Notes |
|---|---|---|
| Code editing (AST, LSP) | Infrastructure-as-code work, script creation, config management | Inherited; mature and well-tested |
| Browser automation | Demo validation, web scraping, page testing | Chrome DevTools MCP + Puppeteer tools |
| Azure integration | 50+ Azure MCP tools for cloud resource management | Useful for customer environments on Azure |
| Debug (DAP) | Debugging scripts and automation | Inherited |
| Image generation/inspection | Visual content for demos and presentations | Gemini-based; inherited |

### Missing (not yet started)
| Capability | Value to SE | Complexity | Issue |
|---|---|---|---|
| Deal health dashboard | Real-time pipeline visibility with MEDDPICC scores | Medium | #685 |
| Demo environment lifecycle | Provision, configure, tear down demo environments | High | #679 (partial) |
| Call preparation briefs | Auto-generated pre-call intelligence packages | Medium | #680 |
| Win/loss analysis | Pattern recognition across deal outcomes | Medium | #687 |
| Technical validation plans | Structured POC/POV planning and tracking | Medium | #683 |
| ROI/TCO calculators | Quantified business case generation | Low | #682 |
| Competitive intelligence refresh | Automated tracking of competitor announcements | Medium | #689 |
| Account planning | Territory strategy, white-space analysis | High | #688 |
| Post-sale handoff | Structured knowledge transfer to PS/CSM | Low | #684 |

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
**Baseline**: Not yet measured. Product knowledge benchmark harness tracked in issue #674.

### 2. API Integration Reliability
**What to test**: Do F5 XC API calls work correctly for common SE workflows?
**Metrics**:
- API call success rate
- Correct endpoint selection (catalog lookup accuracy)
- Payload construction accuracy
- Error handling quality
**Benchmark approach**: Scripted API call sequences against live tenant, scored by success/failure.
**Baseline**: Not yet measured. Issue #692.

### 3. Pipeline Intelligence Quality
**What to test**: Can xcsh pull accurate pipeline data and derive useful, actionable insights?
**Metrics**:
- Query accuracy (correct SOQL for the ask)
- Data interpretation quality (are summaries useful, not just data dumps?)
- Audience-appropriate formatting (AE vs manager vs VP output)
- Forecast accuracy alignment
- Coverage of pipeline question types
**Benchmark approach**: Known pipeline state, compare xcsh analysis against ground truth.
**Baseline**: Not yet measured. Partially addressed by system prompt SOQL templates.

### 4. MEDDPICC Qualification
**What to test**: Can xcsh effectively qualify a deal using MEDDPICC methodology?
**Metrics**:
- Element coverage (does it address all 8 elements?)
- Gap identification accuracy
- Coaching recommendation quality
- Action item specificity
**Benchmark approach**: Synthetic deal scenarios with known MEDDPICC gaps, scored by identification rate.
**Baseline**: Not yet measured. Issue #694.

### 5. Demo Reliability
**What to test**: Can xcsh configure and validate demo environments?
**Metrics**:
- Configuration accuracy (do created objects work?)
- Environment validation completeness
- Troubleshooting effectiveness
- Demo narrative quality
**Benchmark approach**: End-to-end demo setup scenarios, scored by working-state verification.
**Baseline**: Not yet measured. Issue #690.

### 6. Customer Communication Quality
**What to test**: Does xcsh produce appropriate customer-facing content?
**Metrics**:
- Technical accuracy
- Audience-appropriate tone
- Actionable recommendations
- Professional formatting
**Benchmark approach**: Scenario-based content generation, scored against rubric.
**Baseline**: Not yet measured.

### 7. Competitive Positioning
**What to test**: Can xcsh accurately position F5 XC vs competitors?
**Metrics**:
- Claim accuracy (verified against current product state)
- Differentiation clarity
- Objection handling effectiveness
- Win theme identification
**Benchmark approach**: Competitive scenario prompts, scored against known differentiators.
**Baseline**: Not yet measured.

### 8. Self-Evaluation Effectiveness
**What to test**: Can xcsh accurately assess its own capabilities and propose concrete improvements?
**Metrics**:
- Capability inventory accuracy (claims match codebase reality)
- Gap identification specificity (are gaps actionable, not vague?)
- Improvement proposal quality (do proposals result in measurable progress?)
- Update protocol compliance (does the manifest stay current?)
**Benchmark approach**: Compare manifest claims against codebase audit results.
**Baseline**: Iteration 1 revealed multiple inaccuracies — see Change Log below.

## Known Gaps and Priorities

### Critical (blocks SE effectiveness)
1. **No structured MEDDPICC workflow** — deal-analyst exists as a prompt-defined agent persona but has no scoring rubric, no structured qualification process, no gap-to-action mapping. Issue #678.
2. **No demo catalog with lifecycle** — demo-components skill provides infrastructure catalog, but SEs cannot script demos, manage environment lifecycle, or generate demo narratives. Issue #679.
3. **Product knowledge depends on external docs availability** — If llms.txt hierarchy is unreachable, xcsh loses product knowledge entirely. No cache-then-network fallback. Issue #676.

### Important (reduces SE efficiency)
4. **No meeting preparation workflow** — Pre-call planning is manual. No account intelligence aggregation, no agenda templates, no technical discovery question banks. Issue #680.
5. **No competitive battlecards** — Competitive positioning relies on live web search. No cached, verified competitive intelligence. Issue #681.
6. **No presentation generation** — SEs create decks manually. No template system, no automated content population.

### Desirable (enhances SE experience)
7. **Self-evaluation loop is foundational only** — Autoresearch SE overlay exists, SELF_AWARENESS.md exists, but no actual benchmark harnesses run yet. No automated scoring. Issues #690, #693.
8. **No learning from interactions** — xcsh does not improve from past SE interactions. No feedback loop from deal outcomes.
9. **No territory-level intelligence** — Pipeline analysis is per-query. No persistent territory view, trend analysis, or forecasting. Issues #686, #697-#704.

## How This Document Is Used

1. **Autoresearch self-evaluation**: When running `/autoresearch` with an SE evaluation goal, read this document first to understand what to evaluate and how. The autoresearch engine's prompt template references this file when `SELF_AWARENESS.md` exists in the working directory.
2. **Capability gap identification**: New feature development should be prioritized against the gaps listed here.
3. **Progress tracking**: As capabilities mature, update the inventory tables above and record the change below.
4. **Self-improvement loop**: xcsh reads this document to understand its own state, identify improvement opportunities, and generate specific enhancement proposals.

## Autoresearch SE Evaluation Strategy

When running an autoresearch session focused on SE self-evaluation (not runtime code performance), structure the session around one of these evaluation categories per session:

1. **Prompt Effectiveness** — system prompt, agent definitions, tool descriptions. Look at `prompts/system/system-prompt.md`, `prompts/tools/*.md`, `prompts/agents/*.md`.
2. **Product Knowledge Pipeline** — llms.txt routing, documentation access, fallback behavior. Look at system prompt `# Product knowledge` section, `services/f5xc-knowledge.ts`.
3. **F5 XC API Integration** — API client, catalog, spec system. Look at `services/f5xc-*.ts`, `internal-urls/api-catalog-resolve.ts`, `api-spec-resolve.ts`.
4. **Salesforce Integration** — Pipeline intelligence, deal analysis. Look at `prompts/tools/sf-query.md`, `internal-urls/salesforce-context.ts`.
5. **SE Workflow Completeness** — End-to-end SE task coverage. Look at `.xcsh/skills/`, system prompt workflow references, agent definitions.
6. **Self-Awareness and Introspection** — Manifest accuracy, improvement proposals. Look at this file, `internal-urls/xcsh-protocol.ts`.

Use quality/accuracy scores as the primary metric (direction: `higher`) rather than timing metrics. Design benchmark scripts to test the specific SE capability dimension being evaluated.

## Heuristics Learned

Durable lessons from autoresearch self-evaluation sessions.

### Codebase discovery
- **Explore subagents time out in the xcsh repo.** Use direct discovery (grep, find, read) instead. Reproducible across multiple sessions.
- **Branch protection is enforced.** Direct push to main is rejected. All changes require feature branch + PR.

### Capability inventory management
- **Claims drift from reality quickly.** The manifest needs regular audits. Just one day after initial creation, multiple entries were inaccurate.
- **Prompt-defined vs code-defined matters.** Agent personas in the system prompt are functionally useful but less durable than code modules. Distinguish implementation depth levels.
- **Categorize capabilities by origin.** Separating foundational (inherited from pi-mono) from SE-specific prevents conflating coding tool maturity with SE workflow maturity.
- **Cross-reference issues early.** Without GitHub issue links, the gap list becomes a disconnected wish list.

### Self-evaluation anti-patterns
- Do not optimize coding features at the expense of SE features.
- Do not add features without updating this manifest.
- Do not make prompt changes without understanding the full system prompt assembly (system-prompt.md + tool prompts + agent definitions + skills + rules + MCP server instructions).
- Do not evaluate against hypothetical requirements — evaluate against what SEs actually need.
- Do not conflate "works technically" with "helps the SE."
- Do not assume this manifest is accurate — audit claims against the codebase before building on them.

## Update Protocol

This document should be updated when:
- A new SE capability is implemented
- An existing capability matures from "developing" to "mature"
- A new gap is identified from customer interactions
- Evaluation criteria are refined based on real usage
- The mission or priorities shift based on business needs
- An autoresearch session completes and findings change the capability state

Each update should add an entry to the Change Log below with: date, what changed, and why.

Maintainer: The autoresearch self-evaluation loop itself should propose updates to this document as part of its findings.
## Change Log

### 2026-05-09: Iteration 3 — SE capability skills and artifact cleanup
**New skills built (5):**
- competitive — battlecards, competitor profiles (Cloudflare/Akamai/AWS/Palo Alto/Zscaler), objection handling, verification protocol
- meeting-prep — pre-call briefs, stakeholder mapping, discovery questions, agenda templates (discovery call, technical deep dive, exec briefing)
- validation-plan — POC/POV planning, success criteria, test scenarios, timeline, risk mitigation
- roi-calculator — TCO analysis, ROI calculation, sensitivity analysis, industry benchmarks
- account-planning — white-space analysis, territory strategy, stakeholder mapping, pipeline health

**System prompt improvements:**
- Added `<qualification>` section with full MEDDPICC 8-element framework
- Added `<competitive-positioning>` section with differentiation principles
- Expanded mission to include technical discovery, POC planning, account planning
- Added deal velocity purpose statement, demo validation guidance, audience-appropriate communication

**Pipeline tool improvements:**
- Added MEDDPICC deal qualification workflow to sf-query.md
- Added 6 new SOQL templates: next-quarter, stalled deals, large deals, by-product, renewal pipeline

**Artifact cleanup:**
- Removed autoresearch session artifacts from main (autoresearch.sh, autoresearch.md, autoresearch.program.md, autoresearch.checks.sh, autoresearch-loop.sh)
- Removed stale planning docs (handoff.md, MISSED_ITEMS.md, STAGES.md)
- Added .gitignore patterns to prevent autoresearch artifacts from leaking to main
- Migrated durable heuristics and evaluation strategy from autoresearch.program.md into this file

**Inventory updated:**
- MEDDPICC, meeting prep, competitive, validation-plan, roi-calculator, account-planning moved from missing/stub to developing


### 2026-05-09: Iteration 2 — Accuracy audit and inventory expansion
**Assessment findings:**
- SE-specific agents (deal-analyst, status-operator, cli-operator, github-ops) are prompt-defined subagent personas, not separate code modules. Prior iteration overstated implementation depth by listing them as if they were standalone implementations.
- demo-components skill exists and provides deployable infrastructure catalog — was completely missing from the capability inventory.
- GitLab integration (gitlab skill), 30+ SOQL pipeline query templates, API spec/catalog protocols, and autoresearch framework itself were all missing from inventory.
- Foundational capabilities inherited from pi-mono (browser automation, Azure MCP, debug, image gen) were not distinguished from SE-specific capabilities.
- Explore subagent tasks consistently time out in the xcsh repo — direct discovery required (noted in both iteration 1 and 2).

**Changes made:**
- Added "Developing" entries: Pipeline intelligence, demo infrastructure, GitLab integration, status page monitoring
- Added "Foundational" category to distinguish inherited pi-mono capabilities from SE-specific ones
- Corrected agent descriptions to reflect prompt-defined nature
- Added F5 XC API schema introspection and Skills system to Mature table
- Added GitHub issue cross-references to all gaps and missing capabilities
- Added Evaluation Dimension 8: Self-Evaluation Effectiveness
- Added Evaluation Dimension 3 (renamed): Pipeline Intelligence Quality (previously no dedicated dimension)
- Added baseline status to all evaluation dimensions
- Added this Change Log section

### 2026-05-08: Iteration 1 — Initial creation (PR #705)
- Created SELF_AWARENESS.md with mission, capability inventory, evaluation dimensions, gaps, and update protocol
- Created autoresearch.program.md as strategy overlay
- Wired template variables in autoresearch index.ts and prompt.md
- Added SELF_AWARENESS.md to AUTORESEARCH_COMMITTABLE_FILES
