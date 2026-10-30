# Question recap presentation and delivery receipt

Implementation: [xcsh #5101](https://github.com/f5-sales-demo/xcsh/issues/5101),
[PR #5102](https://github.com/f5-sales-demo/xcsh/pull/5102).
Companion adapters: [Chrome #711](https://github.com/f5-sales-demo/xcsh-chrome-extension/pull/711)
and [VS Code #1721](https://github.com/f5-sales-demo/vscode-xcsh/pull/1721).

## Presentation design

This is an xcsh presentation improvement. The frozen question contract,
model-facing schemas, original answer values, correlated reply envelopes and
transport completion owner remain unchanged.

Terminal and React views derive deterministic recaps from the original questions
and accepted answers. They retain question order, match original option labels
before hiding recommendation markers, and show existing descriptions and
separate notes. Free text remains literal, including multiline input and Unicode.
Empty answers, interruption and delivery failures are explicit. Secret answers
are masked in compact recaps and expanded evidence.

Safe presentation records survive reconnect and history restoration, and stay
out of model context and compaction. Submission receipts mean locally recorded;
queued replies and completed delivery have separate states. Replay uses existing
question and submission identities. Revision checks run before applying client
presentation updates so old events cannot overwrite newer delivery states.

Canonical and legacy correlated replies bypass live steering and enter the
same conversation once at a model boundary. Independent streaming and tool
results retain their ownership. Unsupported native steering preserves rejected
input for boundary delivery and disables further steering on that connection.

## Source verification

The serial workspace suite, workspace types, documentation contract, staged
privacy checks, shell audit and source builds passed. Focused coverage includes
canonical replies, concurrent tools and submissions, late replies, uncertain
receipts, secret masking, literal paste, partial answers, safe expansion and
restored presentation records.

Chrome passed 449 tests. VS Code passed 1,397 tests. Shared regular and Markdown
suites passed through their normal entrypoint. Vendor manifests now emit explicit
path/hash records; legacy manifests remain readable, and malformed records,
tampering and missing files fail integrity checks. Regenerated vendors passed
Gitleaks without suppression. The Office bundle remains within its 256 KB budget.

## Installed candidate evidence

Ubuntu source `4f85432d56e9d15f30cefb04c00f50ccfa6abc1b` was exercised with normal
model-selected `bun dev` in a task-owned Herdr pane. The Codex Pro OAuth provider
accepted one correlated answer and produced output tailored to the selected
audience. Earlier normal and narrow Mac terminal captures cover selected choices,
descriptions, true bracketed paste, multiline notes and literal shell-like text.

VS Code candidate `87f4383` was packaged and installed in an isolated profile of
VS Code 1.144.0. A model-selected async question accepted one multiline answer;
the recorded, queued and delivered states were observed. The resulting output
used that audience. The saved conversation contained one canonical reply, and
reloading that same conversation restored the safe delivered recap. Narrow
rendering retained the literal answer without horizontal overflow.

Raw captures, session identities, provider traces and execution logs remain
private under evidence identifier `private:question-recap-5101-20261030`.

Chrome candidate `70f0082` was loaded into the installed Chrome 156.0.8078.74
binary in an isolated headless profile. The real extension connected over its
normal WebSocket bridge to Ubuntu Codex Pro OAuth. A local fictional page fixture
kept tenant resources outside the scenario. One model-selected async question
accepted one literal multiline answer, reached delivered state, and produced
output for the chosen audience. The backend conversation contained exactly one
canonical reply. At 240 pixels, the recap retained all text without horizontal
overflow; reloading the extension restored one safe delivered recap from the
owner snapshot. General Chrome transcript storage remains process-local under
its existing privacy policy.

Headless reload reproduced two activation races and a missed recap-history save.
Regression tests failed before their fixes. Connection snapshots now reach late
subscribers without replaying chat frames, sequential gate events use current
state, and final recap updates enter process-local history immediately.

## Remaining acceptance boundaries
Real Excel, Word and PowerPoint acceptance is explicitly deferred; shared Office
rendering, adapter tests and builds are source evidence only. Published artifact
installation and release convergence remain separate from these candidate checks.

## Published client evidence

Core v23.10.4 (`a57133f80637dda551d1114b9b0fc6f030b2060d`) was installed
from the immutable Linux release artifact in an isolated prefix. The published
CLI accepted one correlated answer using Ubuntu Codex Pro OAuth. Persisted
records contain one canonical reply, a delivered state and audience-specific
output. Installation preserved unrelated services.

Chrome Store v1.33.4 program files match the GitHub release ZIP byte for byte;
the Store manifest adds Google's standard update URL. The published package was
loaded in an isolated headless profile with the public identity key added for
unpacked registration. Shipped program bytes were unchanged. Reload restored one
delivered recap at 240 pixels without overflow.

VS Code 10.2610.30131016 was installed from the published VSIX in an isolated
profile. The active extension restored the delivered recap and exact literal
multiline answer with no pending question. Real Office acceptance remains deferred.

## Immutable publication repair

Issue #5106 tracks the v23.10.4 npm staging failure. Canonical packaging must
include both `answer-recap` and its `question-reply` dependency. The regression
packs actual shared interaction sources, removes the private UI workspace,
imports the extracted artifact and verifies literal multiline recap rendering
and checkout restoration.

Recovery qualifies a complete successful prerequisite set from one attempt of
the exact immutable source run. It retains duplicate Intel and Windows matrix
jobs, handles pagination, and rejects missing, extra, failed or mixed-attempt
prerequisites. A signing-only retry can retain a previously complete successful
attempt. Run 41074781265 attempt 2 satisfies the unchanged prerequisite policy.
Npm backfill reconciles existing exact versions before publishing missing ones.
