# System prompt engineering standards

<!-- Super-Linter pilot canary: validates changed-file lint routing. -->

This document defines the authoritative engineering standard for authoring, refactoring, and maintaining system prompts, agent instructions, and skills across all f5-sales-demo repositories and xcsh AI assistant plugins.

All system prompts and agent instructions must strictly adhere to this eight-point checklist.

---

## The eight-point system prompt checklist

### 1. XML tag hierarchy and semantic framing

- **Standard**: Wrap logical prompt sections in clean, explicit XML tags (`<role>`, `<defensive_scope>`, `<governance>`, `<operational_standards>`, `<execution_protocol>`, `<examples>`, `<structured_reporting>`).
- **Rationale**: Claude and modern frontier models recognize XML tags as deterministic structural boundaries. Using XML tags prevents context confusion, isolates directives, and ensures consistent rule adherence.

### 2. Affirmative guidance over negative prohibitions

- **Standard**: Frame all operational boundaries, rules, and workflows using positive, action-oriented directives (*what to do*). Avoid negative panic keywords (`HALT immediately`, `STOP`, `DON'T`, `NEVER`, `PROHIBITED`).
- **Rationale**: Negative prohibition language induces cognitive friction and model refusal, causing the assistant to become overly hesitant or reject valid execution paths. Affirmative guidance provides clear forward direction.

### 3. Actionable rationale ("why" explanations)

- **Standard**: Pair every guideline, constraint, or workflow step with an explicit explanation of *why* the rule exists and what outcome it guarantees.
- **Rationale**: Providing rationale equips the model with underlying engineering intent. This allows the model to reason safely and adapt flexibly in novel edge cases rather than failing when encountering unexpected inputs.

### 4. Progressive context loading and modular hierarchy

- **Standard**: Keep top-level system prompts concise and focused on core persona, scope, and high-level routing. Place granular tool schemas, raw API cURL specifications, and detailed multi-step SOPs into dynamically loaded skills or specialized subagents.
- **Rationale**: Progressive context loading prevents prompt bloat, reduces token overhead, avoids recency bias degradation, and maximizes model attention on the immediate task.

### 5. Expert persona and professional confidence

- **Standard**: Anchor the assistant or agent with an authoritative, expert persona (*"You are the GitHub Operations Expert agent..."*) that approaches tasks with professional confidence, precision, and mastery.
- **Rationale**: An expert persona establishes domain authority, enhances task execution precision, and encourages autonomous problem-solving within safety boundaries.

### 6. Constructive fallback paths (forward progress)

- **Standard**: Provide constructive forward-progress actions for handling missing parameters, ambiguous inputs, or transient API errors instead of halting or throwing panic errors.
- **Rationale**: Forward progress logic guarantees continuous execution, prompting the caller or retrieving missing context proactively.

### 7. Canonical few-shot examples

- **Standard**: For complex output structures, status reports, or reasoning patterns, provide clean, canonical few-shot examples wrapped in `<examples>` tags, using `<thinking>` blocks when demonstrating multi-step reasoning.
- **Rationale**: Few-shot examples ground model output formatting far more effectively than abstract rules alone.

### 8. Security guardrails as high-rigor engineering standards

- **Standard**: Frame security guardrails (credential protection, input sanitization, worktree isolation, commit history integrity) as standard software craftsmanship and high-rigor engineering practices.
- **Rationale**: Framing safeguards as standard professional practices integrates security seamlessly without triggering timid refusal behavior.

---

## Verification and audit standard

Prior to merging any new or updated prompt file (`*.md` agents, system prompts, or skills), verify compliance against the eight-point checklist above.
