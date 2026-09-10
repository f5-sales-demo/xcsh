# Native remote interoperability gate — issue 3818

This is an unfinished implementation of the first gate in issue 3818, not a
completed remote voice feature. Do not merge or publish before the acceptance
criteria in that issue are satisfied.

## Source contract

Codex rust-v0.153.4 commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a` is the
compatibility baseline. The port uses the production enrollment, refresh,
pairing, and v3 relay contracts. See NOTICE.md and LICENSE. Test fixtures contain
unmodified upstream initialization and thread-list JSON schemas.

XCSH sends its own name, version, originator, installation identity, and selected
subscription credential. It does not invoke Codex, use Codex enrollment state,
or run another agent against the terminal's session file.

## Implemented for the first gate

- Native subscription selection, enrollment, host credential refresh, and pairing.
- Private Unix socket, background host, opt-in enable/disable/status/pair commands.
- `/remote` status and registration from InteractiveMode only.
- Existing AgentSession attachment, text turns, steering, interruption, visible
  text history, and assistant text events.
- Initialization, thread list/read/resume, loaded list, and unsubscribe.
- Relay framing, chunking, acknowledgements, replay buffers, and duplicate sequence
  suppression. Request results remain cached in the owning TUI across host reconnect.
- Registration heartbeats, owner collision rejection, and reconnecting TUI bridges.
- Explicit errors for unsupported methods and model/input overrides.

The `codexHome` wire field points to XCSH's remote directory. Its spelling is an
upstream protocol requirement, not a dependency on a Codex installation.

## Validation evidence

Observed failing tests preceded implementation for enrollment, selected auth,
pairing, relay, sessions, IPC, routing, host registration, bridge, CLI, slash
status, credential refresh, and local protocol dispatch.

The live service accepted native XCSH enrollment (1617 ms), pairing, refresh, and
relay connection on 2026-09-09. Two real terminal sessions, using Luna and Astra,
registered with distinct names and session-specific context. This establishes
host-side behavior only. It does not establish iPhone discovery or interaction.

Verification completed: 47 focused tests / 121 assertions; workspace lint and
TypeScript checks; affected coding-agent suite (7279 passed, 561 skipped, zero
failures across 725 files); changed-scope PII enforcement and diff whitespace.
A live host restart preserved both TUIs. Native local-protocol prompts returned
each session's distinct marker (2796 ms Luna, 3544 ms Astra), and repeated request
identities did not append another prompt. State/socket permissions verified as
0700 for the directory and 0600 for credentials and the socket.

Manual gate: the user reported successful iPhone pairing and a green connection
indicator. Opening a session initially showed “Error loading messages”. Sanitized
relay diagnostics identified experimental `initialTurnsPage` and live-resume
configuration defaults; these are now supported using the pinned Rust source's
loaded-thread rejoin semantics. The exact phone-shaped resume request passed
against both resumed real TUIs, retaining their history and models. The user's
retry and typed marker replies remain pending. No iPhone test is marked passed
by automated checks.

## Work still required

1. Pairing is confirmed; pass message loading and the first iPhone typed round trip; use sanitized method/error evidence to
   resolve any additional phone protocol requirements.
2. Complete history pagination and all live turn/tool event mappings, terminal
   versus remote interaction ownership, and durable retry identities.
3. Implement native realtime transports, existing-call attachment, transcript
   provenance, exactly-once delegation, context updates, interruption, and shutdown.
4. Complete lifecycle coverage (rename/fork/resume/exit/restart), permission-state
   fidelity, and cancellation/error status reporting.
5. Add client listing/revocation, full auth recovery/retry-after handling, and
   exhaustive relay reconnect/buffering tests.
6. Verify packaged independence, live tasks on all four work models, and every
   iPhone acceptance checkpoint. Finish required CI/review/merge and cleanup.

Do not advertise voice support or successful phone acceptance until those gates
pass. Unsupported operations currently return protocol errors. Remote access is
off unless explicitly enabled; a running host exposes upgraded top-level TUIs.

## Development commands

From the feature worktree:

```sh
bun packages/coding-agent/src/cli.ts remote-control enable --json
bun packages/coding-agent/src/cli.ts remote-control status --json
bun packages/coding-agent/src/cli.ts remote-control pair
bun packages/coding-agent/src/cli.ts remote-control disable
bun packages/coding-agent/scripts/native-remote-session-gate.ts --run
bun test packages/coding-agent/test/remote-control
bun run check:ts
bun run --cwd packages/coding-agent test
```

Pairing output is an intentional credential delivery surface. Never copy it into
issues, PRs, fixtures, logs, or this file. The daemon's diagnostics contain method
names, parameter names, numeric error codes, and timestamps; response bodies, session text, tokens, and raw audio
are excluded. Enrollment/host state and credentials live in the user's XCSH
remote directory with private directory/file permissions.
