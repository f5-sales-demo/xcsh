# Structured-question contract acceptance

Acceptance target: OpenAI Codex `ac9b5b8380517ded445b09dd3196d8d9e2ba3c59`.
xcsh source baseline: `9bebb2ecc9763c343cf21162b5f1198ade67d003`.

The `questionParity` manifest freezes licensed upstream source bytes and SHA-256 hashes.
Required Default choices use concise plain text; optional waiting input uses the existing opt-in;
async exposure requires catalog support and a root thread. Restricted tool lists remain authoritative.

Implemented contracts include empty-answer preservation, resolution ordering, blocking metadata,
waiting timer presentation, identical complete async started/completed items without waiting requests,
correlated reply envelopes and JSON-array identities, context exclusion across restoration,
explicit terminal async access, draft recovery, and authenticated ownership and receipts.
The final follow-up also repairs waiting registration before tool-item admission and subscribes
idle browser answer continuations before accepting their reply.

## Deterministic evidence

Frozen-contract, hook, broker, form, configuration, catalog, discovery and adapter suites cover
tool availability, mode transitions, restricted lists, concurrent ownership, replay and stale replies.
The follow-up contract suites pass 57 tests, form/configuration suites pass 87, and session/registration
suites pass 37. Idle browser continuation and ordinary tool-turn regressions pass three tests after
a failing-first reproduction. Documentation contract tests pass 28 tests when run without concurrent
generators. Required workspace types, dependency consistency, source audits and privacy gates pass.
Final PR CI and release acceptance are tracked separately below.

Terminal tests cover Other typing with Up/Down choice navigation, Alt+Up/Down pending-question
navigation, Ctrl+5/Ctrl+] local skip, Ctrl+C text clearing, and Esc live interruption.
They also cover the 30-second collapsed expiry, final 20-second countdown, opening snooze,
external acceptance draft cleanup, hidden-option digit rejection, and turn-completion editor closure.
Local closure preserves external ownership and never submits a recommended answer.

## Live model and terminal evidence

Prompts use synthetic workspaces and do not name question tools. Pro-subscription runs use Ubuntu;
macOS uses LiteLLM. No tenant deployment or tenant-specific input is part of acceptance.

- Source `bun dev` in a task-owned Herdr pane naturally selected blocking Plan questions and
  non-focusing async audience input. Submitted choices changed the resulting plan or outline.
- Live Pro app-server session `159c6471b7e53fb5`, semantic turn
  `159c6471b7e53fb5-turn-1b53de54-f235-4395-acc1-bf6d91aa5032`, emitted identical complete
  async items with `delivery=async` and `phase=final_answer`, without a waiting request.
  An authenticated Engineers reply was accepted while independent 10-second work continued;
  the completed outline addressed engineers.
- Optional waiting session `159c74c8071a8862`, semantic turn
  `159c74c8071a8862-turn-6c9ffda0-b32b-4331-b811-541c1fb73c5d`, emitted one request with
  `isBlocking=false`. Empty answers remained empty; resolution preceded turn completion and
  the model continued with compact formatting.
- The required Default policy repeat asked one concise plain-text jurisdiction question and
  prepared the invoice formula without inventing jurisdiction.
- Installed Plan acceptance selected supplied HTTPS certificates, then inline certificate/key
  placeholders in a second blocking question. The plan reflected both answers without deployment.
- Installed waiting input showed the hidden grace, countdown and unanswered continuation.
  Source runs also verified local async expiry and an answered two-minute independent-work turn.

## Published clients

Herdr PR 135 is merged; `just check` passes and v0.19.3 is immutable. The bridge accepts
nonblocking boolean waiting requests. The existing shared server is preserved.

VS Code PRs 1648 and 1652 are merged. Replacement v10.0.1-261007025924 is immutable;
VSIX SHA-256 is `022424fc5509c90bf58bb1ee4d0c5de580094b283df3b7a396e3637e891216cf`.
The installed task-owned Ubuntu pane naturally requested audience input, accepted End users,
and rendered the resulting report in vertical document flow. The layout regression passed
15 browser UAT tests after its failing-first reproduction.

Chrome PRs 661, 663, 665 and 667 are merged. Final v1.33.3 is immutable; ZIP SHA-256 is
`6c1e5703682346730dd78ad1dcee2b632f8045b959ecc18ef8f47678bc86baa8`.
The real Ubuntu sidebar loaded that ZIP with normal development public-key injection; only the
manifest key differs. Its synthetic page is fulfilled locally without tenant network/content.
After an idle turn, End users was accepted with a correlated receipt, the form closed, and the
sidebar displayed Answer recorded: End users followed by the completed end-user outline.
Session `159c7fe9c41e38b7`, turn `3`, receipt `1d524c9a-e90a-4b9d-a652-1c296c8b55b5`
identify this installed acceptance. Downstream Chrome suites pass 444 tests plus types and build.

## Core release and remaining acceptance

Core PRs 4751, 4756, 4759 and 4760 are merged. Immutable v22.13.1 and v22.13.2 completed
normal publication workflows. v22.13.2 Linux executable SHA-256 is
`9f0e4e8a04cc16889efc6867d85516235961c74942269fa7aa6ec690e22f8e33`; macOS arm64 ZIP SHA-256 is
`ebe11c57ec31f5d1a5b32007ab749589217afc0753b3198124ddac8dacc0eaed`.
macOS v22.13.1 signature validation passes and Gatekeeper accepts its notarized installer package.
Those releases precede the final policy, waiting-registration and idle-browser repairs in PR 4767.
Final core PR CI, a release containing it, and installed terminal repeats against that immutable
identity remain acceptance gates. Earlier source/candidate results do not substitute for them.

Voice now uses the subscription-created WebRTC call and existing-call sideband, resolving the
standalone socket initialization failure. Synthetic audio input connected the peer and ICE,
produced adapter transcript signals, and received nonzero output audio bytes and energy.
This establishes live transport/audio receipt; audible UI question observation remains unverified.

Real Excel, Word and PowerPoint verification is explicitly deferred by the user. Office source
build is 199.8 KB gzip; 436 tests pass with four existing layout skips. Installed Office input,
rendering and answer delivery remain unverified. Non-open-source clients claim shared-contract
conformance only; no closed-source UI or physical-phone equivalence is claimed.
