# Progressive discovery and native Blindfold awareness

Issue: [#4831](https://github.com/f5-sales-demo/xcsh/issues/4831)

## Contract

Optional native, custom, plugin and RPC host tools remain registered but deferred by default. Explicit eager
mode, tool scopes and exclusions remain authoritative. Activated schemas stay available for the session and
resume. Registration refresh updates discovery and drops vanished selections without activating dormant tools.

Native certificate and private-input intent is determined from user-authored text. Embedded clients supply the
original task separately from document context. A transient, bounded Markdown hint points to discovery and
native task routes; it never executes encryption or loads a schema. Repeated turns contain one hint and stored
history contains none. Agent-authored messages, managed certificates, inspection, unrelated TLS/encryption and
other platforms do not create intent. Session changes clear follow-up intent.

The maintained native guide supplies complete sections for `xcsh://blindfold/`, `/encrypt`, `/certificate` and `/verify`. The index is under 2 KiB; hints are under 1 KiB. The native tool name, schema and containment controls are unchanged.

## Verification

- Bootstrap: `bash scripts/ci-bun-install.sh` and `bun scripts/ensure-dev-native.ts` succeeded on the fresh Ubuntu worktree.
- Red: initial valid runtime run had 11 passes and 13 expected failures; additional embedded-context and synthetic-turn tests failed before their repairs.
- Focused: 51 discovery/Blindfold regression tests and 54 runtime, route, Plan Mode and configuration tests passed. Native Blindfold: 17 passed. Agent core: 57 passed. Office package: 436 passed, 4 skipped.
- `bun run check:ts` and `bun run check:docs-quality` passed (29 documentation tests).
- The original 26,000-character neutral prompt budget is retained. Repairs render real environment fields,
defer plugin descriptions to the catalog, and remove duplicated Terraform instructions while retaining the
documented constraints. Missing progressive schema, API, portability, knowledge and redaction policies were
restored.
- Full-suite isolation repair: the isolated plugin-home probe now runs in its own process, avoiding registrations left by earlier discovery tests. Browser host-tool acceptance waits through actual prompt setup and asserts the complete request/result loop.
- Changed-file PII enforcement and authored prose terminology checks passed.

## Model comparison

The sanitized receipt is `packages/coding-agent/test/evidence/blindfold-awareness-v1/comparison.json`. A
frozen six-task corpus ran with `openai-codex/gpt-6.1-sol`, medium effort, identical settings and synthetic
private offline inputs under v23.0.3 eager, v23.0.3 progressive and the candidate. All 18 tasks passed without
live mutations or observed secret/payload leakage. First-request tokens include cached input exactly once.
Discovery calls and total task input tokens remain in the receipt.

| Profile | Neutral first input tokens | Neutral system prompt bytes |
| --- | ---: | ---: |
| Eager | 43,290 | 78,332 |
| Existing progressive | 16,431 | 26,745 |
| Candidate | 16,327 | 25,501 |

One run per task is evidence for this corpus, not a statistical model guarantee. Plugin and RPC tools are
synthetic integrations. Offline encryption writes a fresh mode-0600 location artifact; no certificate or
showcase mutation is performed. Private task inputs and runtime directories were removed by the harness.

## Delivery gates

- [ ] Full final coding-agent package run and required CI.
- [ ] Linked PR merged and normal release published.
- [ ] Immutable artifact digest verification and installed Mac/Ubuntu identity.
- [ ] Installed task routes and discovery/containment acceptance.

Source SDK and representative browser/Office integration checks do not establish physical Chrome or Office application acceptance. No physical GUI session has been exercised for this change.
