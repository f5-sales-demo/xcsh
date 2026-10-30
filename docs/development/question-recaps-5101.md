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

Chrome passed 446 tests. VS Code passed 1,397 tests. Shared regular and Markdown
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

## Remaining acceptance boundaries

Installed Chrome acceptance awaits reconnection of the supported browser
provider. Source/vendor tests do not establish installed Chrome behavior.
Real Excel, Word and PowerPoint acceptance is explicitly deferred; shared Office
rendering, adapter tests and builds are source evidence only. Published artifact
installation and release convergence remain separate from these candidate checks.
