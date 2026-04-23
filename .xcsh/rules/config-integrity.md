---
description: Infrastructure configuration integrity — dependency-first thinking for IaC and automation
condition: "."
scope: "tool:edit(**/*.tf,**/*.yaml,**/*.yml,**/*.json,**/*.sh,**/Makefile,**/Dockerfile,**/*.toml), tool:write(**/*.tf,**/*.yaml,**/*.yml,**/*.json,**/*.sh,**/Makefile,**/Dockerfile,**/*.toml)"
---

**Think dependency-first.** Before writing any configuration or automation:

- **Dependencies:** What does this configuration reference? A missing upstream object,
  an unresolved hostname, an unadvertised policy — these fail silently or at apply-time.
- **Environment scope:** Every infrastructure object lives in a context. Configs that assume
  shared state will fail in an isolated or clean environment.
- **Schema and version:** Protocols and APIs evolve. Validate against current schema, not
  what worked last quarter.
- **Idempotency:** Every infrastructure operation must be safe to re-run. Check existence
  before creating. Design for convergence, not one-shot execution.
- **DRY at 2.** When you write the same pattern twice, extract a shared template or variable.
  Two copies is a drift risk.
- Write readable infrastructure. Comment non-obvious dependencies, operational context, or
  security intent.
- **Earn every field.** Only include required and intentional configuration — no
  cargo-culted defaults.
