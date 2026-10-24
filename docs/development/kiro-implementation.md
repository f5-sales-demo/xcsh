# Native Kiro implementation — issue 5066

Development, native builds, tests and `bun dev` run on the MacBook. GitHub
writes use the verified Ubuntu SSH delivery route. The task uses the corporate
Homebrew installation of Bun 1.4.2 in a versioned keg; the existing globally
linked Bun stays separate. Native Kiro uses its own service; LiteLLM is a
separate development facility.

## Task list

- [x] Intake issue 5066 and fresh origin/main worktree at 33d1e443d.
- [x] Read-only native identity verification and alignment through native controls.
  Desktop 1.4.26 and CLI 2.33.1 use the same Builder ID account; native inference
  passed in both. Issuer/service region: us-east-1. Identifiers remain private.
- [x] Typed credentials, Desktop-first explicit imports, bounded OIDC,
  cancellation/expiry/backoff, and existing durable refresh coordination.
  Red/green tests cover Builder/company methods, denial, refresh and invalid
  registrations. Desktop 1.4.26 clientIdHash joins are verified independently.
- [x] Paginated corporate profiles and native model catalogs, profile selection,
  exact service IDs and limits, default recommendations and scoped caches.
  Empty/malformed/cycling responses and account/profile isolation are tested.
- [x] Native checked binary streaming, fragmented Unicode, text, tool calls,
  result continuation, cancellation and failures. Estimated token usage carries
  a distinct source marker; dollar pricing is not asserted.
- [x] Existing login/connected/model flow integration. Inference is bound to its
  catalog's account/profile, and a lost authorization cannot select another
  account. Re-selection is durable. Saved Kiro defaults await discovery at restart.
- [x] Task-owned Herdr runner with preserved focus and native session/turn
  completion evidence. Both mocked methods passed login, activation, inference,
  restart and logout through the actual TUI.
- [x] Live Builder credential reuse and fresh AWS device login passed streamed
  inference, restart and logout. Native read-only README tool execution and its
  continuation passed. AWS authentication/consent was performed by the user.
- [x] Focused tests, affected AI suite, repository TypeScript/docs checks and the
  full local workspace suite passed. Native exports were built/probed locally.
  The extension-discovery fixture isolates installed developer integrations;
  cross-platform checksum fixtures use the installed Homebrew GNU coreutils.
- [x] Validated source commits, privacy repair and source-bound native acceptance.
- [ ] Ubuntu PR delivery; hosted CI, merge and task cleanup.

The named rigor planner/auditor skills are absent from the installed catalog and
repository. This record tracks explicit acceptance criteria, red/green evidence
and completion gates without claiming those skills were executed.

## Acceptance boundaries

Live corporate SSO and Opus 5.5 access remain unverified. The verified Builder
catalog includes Haiku 4.5, Sonnet 4.5 and the available service default `auto`.
The original synthetic tool-check wording was refused by the service and is
preserved privately. The runner now uses an ordinary arithmetic question and a
read-only README task. Raw identities, credentials, authorization codes, screen
captures, transcripts and failures stay outside the worktree. Public receipts
contain sanitized results and hashes only.

Sanitized source-bound results are in `kiro-evidence/acceptance.json`. The
privacy scanner template case is reported in docs-control issue 2609; its
managed rules were not changed.
