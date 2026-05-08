# Autoresearch Program: xcsh SE Self-Evaluation

This is the strategy overlay for autoresearch sessions in the xcsh repository. It redirects the experiment loop from generic code optimization toward evaluating and improving xcsh's sales engineering capabilities.

## Context

Read `SELF_AWARENESS.md` at the repo root before starting any evaluation session. It contains:
- Mission definition (what xcsh is for)
- Current capability inventory (what works, what's developing, what's missing)
- Evaluation dimensions with specific metrics
- Known gaps and priorities

## Operating Mode: Self-Evaluation

Unlike typical autoresearch sessions that optimize runtime performance of a code target, SE self-evaluation sessions analyze xcsh's own codebase, prompts, and configurations to identify and implement improvements toward its stated mission.

The "benchmark" in this context is not a shell script measuring execution time. It is a structured evaluation of capability quality, measured through test scenarios that exercise specific SE workflows.

## Evaluation Categories

Each category maps to a dimension in `SELF_AWARENESS.md`. Pick one per autoresearch session.

### Category 1: Prompt Effectiveness
**Focus**: System prompt, agent definitions, tool descriptions
**What to evaluate**:
- Does the system prompt correctly frame xcsh as an SE tool (not a generic coding assistant)?
- Are tool descriptions optimized for SE workflows?
- Do agent definitions (deal-analyst, status-operator, etc.) have sufficient context?
- Are there prompt patterns inherited from pi-mono that contradict the SE mission?
**Where to look**: `packages/coding-agent/src/prompts/system/system-prompt.md`, agent frontmatter in discovery modules, tool description strings
**Improvement types**: Rewrite prompt sections, add SE-specific examples, remove generic coding emphasis where inappropriate

### Category 2: Product Knowledge Pipeline
**Focus**: llms.txt routing, product documentation access
**What to evaluate**:
- Is the llms.txt cascade correctly specified in the system prompt?
- Are all F5 XC product areas reachable through the cascade?
- Is the routing discipline clear enough to prevent unnecessary web searches?
- Are there product areas where the cascade has gaps?
**Where to look**: System prompt `# Product knowledge` section, any hardcoded product references
**Improvement types**: Update routing rules, add missing product area links, improve fallback behavior

### Category 3: F5 XC API Integration
**Focus**: API client, catalog, spec system
**What to evaluate**:
- Does the API catalog cover common SE operations (create LB, configure WAF, set up origin pools)?
- Are the xcsh://api-catalog and xcsh://api-spec protocols correct?
- Is error handling adequate for demo contexts (where errors need clear explanation)?
- Are there common API workflows that should be templated?
**Where to look**: `services/f5xc-api-client.ts`, `services/f5xc-context.ts`, `xcsh_api` tool implementation
**Improvement types**: Add API workflow templates, improve error messages, extend catalog coverage

### Category 4: Salesforce Integration
**Focus**: Pipeline intelligence, deal analysis
**What to evaluate**:
- Are SOQL query templates correct and comprehensive?
- Does the pipeline context (xcsh://salesforce) provide useful intelligence?
- Can xcsh derive actionable insights from pipeline data?
- Is the deal-analyst agent well-defined enough to produce quality output?
**Where to look**: `sf_query` tool, `xcsh://salesforce` protocol, deal-analyst agent definition
**Improvement types**: Add query templates, improve pipeline analysis prompts, enhance deal-analyst instructions

### Category 5: SE Workflow Completeness
**Focus**: End-to-end SE task coverage
**What to evaluate**:
- Can xcsh handle a complete pre-call preparation workflow?
- Can xcsh create a technical validation plan?
- Can xcsh generate a competitive positioning document?
- Can xcsh run a MEDDPICC qualification session?
**Where to look**: System prompt workflow references, agent definitions, skill files
**Improvement types**: Add new skills, create workflow templates, define new agent types

### Category 6: Self-Awareness and Introspection
**Focus**: xcsh's ability to understand and improve itself
**What to evaluate**:
- Can xcsh accurately describe its own capabilities?
- Can xcsh identify its own gaps?
- Can xcsh propose specific improvements to its own codebase?
- Is the xcsh://about protocol informative enough for self-evaluation?
**Where to look**: `internal-urls/xcsh-protocol.ts`, `internal-urls/build-info-runtime.ts`, `SELF_AWARENESS.md`
**Improvement types**: Extend self-documentation, add capability introspection, improve xcsh:// protocol

## Session Strategy

### Phase 1: Reconnaissance
1. Read `SELF_AWARENESS.md` to understand current state
2. Read the system prompt (`packages/coding-agent/src/prompts/system/system-prompt.md`) to understand the SE framing
3. Identify the specific evaluation category for this session
4. Read relevant source files for that category

### Phase 2: Assessment
1. Evaluate current state against the criteria in `SELF_AWARENESS.md`
2. Identify specific, actionable gaps
3. Prioritize by impact on SE effectiveness
4. Document findings in `autoresearch.md`

### Phase 3: Implementation
1. Make targeted improvements to the highest-impact gaps
2. Keep changes scoped to the evaluation category
3. Test changes against the evaluation criteria
4. Document what changed and why in the experiment log

### Phase 4: Validation
1. Verify improvements don't break existing functionality
2. Run `bun check:ts` for type safety
3. Verify prompt changes maintain coherence with the overall system prompt structure
4. Update `SELF_AWARENESS.md` if capability status changed

## Benchmark Approach for SE Evaluation

Since SE capabilities are primarily prompt-driven and integration-driven rather than performance-driven, benchmarks should be structured as:

### For prompt quality
- Create test scenarios (synthetic SE tasks) in `autoresearch.sh`
- Score responses against a rubric
- Metric: accuracy/quality score (higher is better)

### For integration quality
- Test API call sequences against the live tenant
- Score by success rate and correctness
- Metric: success_rate (higher is better)

### For workflow completeness
- Trace through a complete SE workflow
- Score by coverage of required steps
- Metric: coverage_score (higher is better)

## Heuristics Learned

Update this section as autoresearch sessions produce durable lessons.

- (No heuristics yet — this is the first iteration)

## Anti-Patterns to Avoid

1. **Do not optimize coding features at the expense of SE features** — The coding capability exists to serve the SE mission. Performance improvements to grep/LSP/etc. are not the goal of SE self-evaluation.
2. **Do not add features without updating SELF_AWARENESS.md** — Every capability change should be reflected in the inventory.
3. **Do not make prompt changes without understanding the full system prompt assembly** — The system prompt is composed from multiple sources. A local change can conflict with upstream sections.
4. **Do not evaluate against hypothetical requirements** — Evaluate against what SEs actually need, as documented in the mission and capability inventory.
5. **Do not conflate "works technically" with "helps the SE"** — An API call that succeeds but returns data the SE cannot use is not a capability improvement.
