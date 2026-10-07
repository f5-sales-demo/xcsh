# Context picker acceptance — issue #4754

Baseline: `d9ce5745af1ddea41de228bb133105bdb4656009`; fresh Ubuntu worktree bootstrapped with Bun 1.4.2. The prior intake baseline and fresh repeat each passed 179 tests across five files. Synthetic handler observations before edits are in `context-picker-baseline-map.json`.

| Requirement | Evidence | Status |
| --- | --- | --- |
| Picker opens on bare command; source-aware Enter | `test/context-picker.test.ts`; Ubuntu `bun run dev` in task-owned Herdr pane, entry and actions directly read | Verified core path |
| Search and invalid/empty entries | `test/context-picker.test.ts`; real unmatched search showed creation and clear actions | Verified core path |
| Same-name local/global and pointer overrides | `test/context-target.test.ts`, `test/context-operations.test.ts` | Automated |
| A retained for delayed tools and descendants, B used by new admission | `test/context-execution-snapshot.test.ts`, `test/context-operations.test.ts`, `test/agent-session-concurrent.test.ts` | Automated |
| Retries and handoff retain expected lifecycle | `test/agent-session-retry-fallback.test.ts`, `test/agent-session-handoff.test.ts` | Automated |
| One review; cancel writes nothing; saved edit retains token/metadata/skills | `test/modes/controllers/context-command-controller-review.test.ts` | Automated |
| Partial save retries only activation | `test/modes/controllers/context-command-controller-review.test.ts` | Automated |
| CLI no inference/menus; stdin import, output masking, usage/execution exit | `test/context-cli.test.ts` | Automated |
| Namespace/env remain project-local for pointers | `test/context-operations.test.ts`; local TUI adapter routes the active source | Automated |
| Details do not validate; explicit list single frame | `test/xcsh-context-command.test.ts`; Ubuntu real `/context list` observed | Core path observed |
| Masked wizard input and network recovery | Real `/context create` URL → masked synthetic token → name → validation error with Retry/Edit URL/Edit token | Observed |
| 60x20, 80x24, 120x40 bounds, dark/light | `test/context-picker.test.ts`; 6 real PTY variants, 24 directly inspected PNGs (picker/actions/no-match/create entry) | Observed core paths |
| Full dark/light, custom bindings, resize, long-endpoint interactive audit | Six size/theme PTY variants and configured binding tests pass; live resize/long-endpoint interaction remains | Partially observed |
| Full terminal replay for persistent families and successful wizard authentication | Six real PTY draft variants exercise URL, masked token, name, successful auth, namespace, Save only, edit review, cancellation and Save and activate with retained token | Observed draft path; other persistent families partial |
| Authorized live tenant A/B authentication and targeting | User-authorized private fixture: both tenants HTTP 200; delayed A resource read after B selection and B resource read used expected endpoint/token/namespace | Observed live |

The real runtime observations above contain no saved-file mutation and no model inference. Production tenant URLs, namespaces, token material and raw terminal logs are excluded from this artifact. Historical connection-matrix captures describe the previous implementation and do not qualify this redesign. Complete user-interaction acceptance remains open where stated.

The isolated Herdr terminal replay also observed Enter selection retaining B after a failed check; bare rename collected a target and new name, reviewed once, and refreshed the picker; deletion reviewed once and removed only the synthetic target.

Current checks: context/selection/service/agent-tool isolation 212/212; picker and draft/custom-theme 23/23; CLI 9/9; shared resolver 40/40; SDK and foundation 20/20; handoff/concurrency repair 32/32; audit and plugin repair 8/8. Full source-matched rerun remains in progress.
