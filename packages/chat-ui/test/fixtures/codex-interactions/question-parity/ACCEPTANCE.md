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
Final PR 4767 is merged; release publication and installed acceptance are tracked separately below.

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
sidebar displayed Answer recorded: End users followed by the completed end user outline.
Session `159c7fe9c41e38b7`, turn `3`, receipt `1d524c9a-e90a-4b9d-a652-1c296c8b55b5`
identify this installed acceptance. Downstream Chrome suites pass 444 tests plus types and build.

## Core release and remaining acceptance

Core PRs 4751, 4756, 4759 and 4760 are merged. Immutable v22.13.1 and v22.13.2 completed
normal publication workflows. v22.13.2 Linux executable SHA-256 is
`9f0e4e8a04cc16889efc6867d85516235961c74942269fa7aa6ec690e22f8e33`; macOS arm64 ZIP SHA-256 is
`ebe11c57ec31f5d1a5b32007ab749589217afc0753b3198124ddac8dacc0eaed`.
macOS v22.13.1 signature validation passes and Gatekeeper accepts its notarized installer package.
Those releases precede the final policy, waiting-registration and idle-browser repairs in PR 4767.
Core PR 4767 merged at `63ac37d4de1bdf6cf0952ff1ca88a92f7bc2013a`; release PR 4776 merged
at `7fac9a24967cd3cfad4dc6ba87f6b516f5f33221` and tags v22.14.3. Publication run 37582022148 passed build, test, signing, notarization and immutable GitHub publication.
Final channel verification is tracked below. Immutable v22.14.3 Linux executable SHA-256 is
`6b5dd4953183d8522681d51edec294e56f699551f353c6992f182beece1e71ac`; macOS arm64 ZIP SHA-256 is
`7ad2bc69a7d68d0b601d56f2cf785e52a31ab718117a8be16d2c374f1daf2e9c`.
Both downloaded hashes match GitHub metadata. macOS signature verification passes. The normal
Homebrew upgrade installs the same executable SHA-256
`9f4f5a23c0a0b258f5dc8e480ae081ae289de497bc900185cbf58133f897c4cd` as the verified ZIP.

Voice uses the subscription-created WebRTC call and existing-call sideband, resolving the
standalone socket initialization failure. Natural Pro session `159c8bc4c7a87862` selected an async
audience question while independent work continued. Synthetic speech requested that question;
the output transcript was: Who should the release-note outline target: Engineers or end users?
Either choice is acceptable. Peer and ICE were connected, 49,479 audio bytes were received with
nonzero energy, and the adapter emitted correlated transcript events without a waiting request.
This proves live voice contract and audio behavior, without physical-phone UI equivalence.

Real Excel, Word and PowerPoint verification is explicitly deferred by the user. Office source
build is 199.8 KB gzip; 436 tests pass with four existing layout skips. Installed Office input,
rendering and answer delivery remain unverified. Non-open-source clients claim shared-contract
conformance only; no closed-source UI or physical-phone equivalence is claimed.

## Final source and adapter repeats

Fresh `bun dev` in task-owned Herdr pane `w7A:p6` asked Which tax jurisdiction applies?, calculated
the synthetic USD 150 subtotal and left the final total pending. Sequential Plan forms selected
HTTPS, supplied certificates and inline certificate/key placeholders; the plan reflected each choice.
No deployment or account inspection occurred.

The async source repeat delivered the Unicode and literal shell-like answer exactly in
the canonical envelope and displayed a readable answer summary. Independent work completed at
90.000 seconds, used the audience label, created no `never` file and retained a separate composer draft.
A second 45.000-second run showed the countdown, snoozed when opened and recovered an unsubmitted
Unicode draft into the composer on turn completion without answering automatically.

Final source suites pass 12 merged policy/registration/idle tests, 53 owner/adapter tests,
23 exposure/history tests, 63 terminal/Herdr tests and 80 voice tests. Shared UI's normal package
runner passes 186 component tests and 86 Markdown tests. Frozen source/hash tests pass 12 tests.
A direct component command without the DOM preload failed environmentally; the required package
runner passed with its configured preload.

Immutable installed Herdr v0.19.3 Linux SHA-256 is
`417630640dc1fcc39be985a654990608cd366d6f3d69ecdb50e59bf5ed130d53`.
Its isolated session advertised the required interaction/journal capabilities. Tracked execution
`questions-installed-optional-001`, session `159c916203406227`, published the unchanged async item;
reply receipt `questions-herdr-expanded-001` moved from queued to accepted, the question became
answered and the pane rendered Expanded output. Public records contained no answer payload.
This repeat found Herdr's empty waiting-answer validator gap. Issue 136 and PR 137 repair it;
the regression failed first, and full `just check` passed 3,748 Rust tests plus maintenance,
integration, documentation and Windows compilation. Release-intent CI passed all OS checks.
Replacement v0.19.4 completed publication run 37584336684 and is immutable; Linux SHA-256 is
`19620e7fc6f37347e1478cc0533b629984f1bee966ac896cb5f434447ed0067c`.
Installed tracked execution `questions-installed-waiting-194`, session `159c9a95edc4b11e`,
published `isBlocking=false`; empty reply receipt `questions-empty-194-001` became accepted.
The form closed, xcsh displayed the unchanged empty answers object and completed a compact
synthetic report. The issue was closed by release automation. Shared servers remained untouched.

## Final immutable CLI acceptance

Ubuntu Pro and macOS LiteLLM final v22.14.3 terminals asked one concise plain-text jurisdiction
question, prepared the synthetic USD 150 formula and left the final total unresolved.
Both installed Plan routes asked type before certificate configuration. macOS selected HTTPS
with custom certificate references; Ubuntu selected HTTPS, custom certificates and inline
certificate/key placeholders. Completed plans reflected those selections without deployment.
The fully specified macOS Terraform example finished without questions, account inspection or deployment.

Final Ubuntu async RPC session `159c9d2169b392ca` accepted Engineers and completed an Engineers
outline after an independent 10.000-second wait. Identical receipt retry was accepted and a
competing response was rejected. Final optional waiting session `159c9d5b6d253e88` emitted
`isBlocking=false`, preserved empty answers, accepted an identical receipt retry, rejected a
competing response and completed compact synthetic output. Prompts named no question tools.
An earlier optional run naturally selected async preferences; the waiting repeat used the
authorized restricted waiting tool list with the existing Default opt-in.

macOS LiteLLM used a plain-text optional audience question in its installed independent-work run.
That route completed normally; async exposure and natural invocation acceptance use supported
Ubuntu Pro catalog metadata. Final Ubuntu terminal session `159c9e9abb652b58` naturally selected async audience input.
Opening `/questions` snoozed local expiry; unsubmitted Unicode and literal shell-like text stayed
in the editor while work continued. At 90.001 seconds the form closed and that exact draft was
recovered into the composer. The model used its mixed-audience assumption, without delivering
the unsubmitted draft or executing the literal text.
