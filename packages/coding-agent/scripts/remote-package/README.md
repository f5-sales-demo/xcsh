# Packaged remote-session check

This Linux integration check runs the production xcsh binary, its background host
and two actual terminal sessions inside a disposable Ubuntu container. The
container has no Codex, standalone Bun, repository checkout or package dependencies.
Networking is disabled. The host-side Bun harness drives real pseudo-terminals
and the native host's local socket; it never creates an AgentSession itself.

Build the executable through the normal package build, then run from the repository
root with a new evidence directory outside the checkout:

```sh
bun --cwd packages/coding-agent run build
bun packages/coding-agent/scripts/remote-package/check.ts \
  packages/coding-agent/dist/xcsh /path/to/new-evidence-directory
```

Docker and a local `ubuntu:24.04` image are required. An optional third argument
selects another existing Ubuntu image. The harness never pulls an image. It mounts
only the executable, the small offline provider fixture and the new evidence
directory. The container runs as the invoking user, with all capabilities dropped,
a read-only root filesystem and an empty writable home for logs and native-addon
extraction. Cleanup removes only its uniquely named container and its processes.

The provider supplies deterministic model responses; the packaged terminal agent
executes the ordinary `write` and `read` tools. The fixture rejects tool errors and
checks that the actual read result contains the written marker before replying.
Enrollment is synthetic and cannot reach the service. This checks packaged
independence and session integration, not subscription enrollment, live model
capabilities, phone behavior, voice or complete protocol parity.

The assertions cover default-off status, discovery of two named terminal owners,
correct working-directory routing, native file-change facts and successful read
results in history, clean and abrupt host restart, active terminal work surviving
host process loss, stable-request replay without repeated turns, compiled
`--resume` with preserved identity/history/extension model, durable replay after
the terminal process itself restarts, and removal on terminal exit.

The evidence directory retains terminal/host logs, saved sessions, history
responses and `result.json`. The result records binary, harness and provider
SHA-256 values, image identity, checks and timings. Associate the binary hash with
its source/build evidence when recording a checkpoint; the executable's version
alone does not prove its source revision. Fixture output contains no user
credentials, voice recordings or live account state.

`evidence-rename-2026-09-10.json` is the clean `9fb146da9` ten-check receipt that
also exercises remote naming, notification, host restart and name persistence.

`evidence-final-head-2026-09-10.json` records the same ten checks on the
current implementation checkpoint `4a399d39`, after the final guarded package
suite and changed-scope privacy cleanup.

`evidence-terminal-retry-2026-09-10.json` records the clean `fe1de706` artifact
after the harness added a full terminal-process exit/resume and replay of the
original completed tool request. The stable turn ID and single history entry
prove the persisted client-message ledger prevents a second execution.
