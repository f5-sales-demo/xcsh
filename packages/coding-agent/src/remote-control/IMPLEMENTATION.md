# Native remote interoperability gate — issue 3818

This is an unfinished implementation of the first gate in issue 3818, not a
completed remote voice feature. Do not merge or publish before the acceptance
criteria in that issue are satisfied.

## Source contract

Codex rust-v0.153.4 commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a` is the
compatibility baseline. The port uses the production enrollment, refresh,
pairing, and v3 relay contracts. See NOTICE.md and LICENSE. Test fixtures contain
unmodified upstream initialization, thread-list, configuration, and model-list schemas.

xcsh sends its own name, version, originator, installation identity, and selected
subscription credential. It does not invoke Codex, use Codex enrollment state,
or run another agent against the terminal's session file.

## Implemented for the first gate

- Native subscription selection, enrollment, host credential refresh, and pairing.
- Private Unix socket, background host, opt-in enable/disable/status/pair/clients/revoke commands.
- `/remote` status and registration from InteractiveMode only.
- Existing AgentSession attachment, text turns, steering, interruption, visible
  text history, and assistant text events.
- Initialization, thread list/read/resume, loaded list, and unsubscribe.
- Phone bootstrap metadata and existing-terminal queue reads.
- Non-PTY standalone process capture/streaming, stdin, cancellation, and exit events.
- Relay framing, chunking, acknowledgements, replay buffers, and duplicate sequence
  suppression. Request results remain cached in the owning TUI across host reconnect.
- Registration heartbeats, owner collision rejection, and reconnecting TUI bridges.
- Explicit errors for unsupported methods and model/input overrides.

The `codexHome` wire field points to xcsh's remote directory. Its spelling is an
upstream protocol requirement, not a dependency on a Codex installation.

## Validation evidence

Observed failing tests preceded implementation for enrollment, selected auth,
pairing, relay, sessions, IPC, routing, host registration, bridge, CLI, slash
status, credential refresh, and local protocol dispatch.

The live service accepted native xcsh enrollment (1617 ms), pairing, refresh, and
relay connection on 2026-09-09. Two real terminal sessions, using Luna and Astra,
registered with distinct names and session-specific context. These service checks preceded the manual iPhone confirmations below.

Verification completed: 57 focused tests / 161 assertions; workspace lint and
TypeScript checks; affected coding-agent suite (7291 passed, 561 skipped, zero
failures across 727 files); changed-scope PII enforcement and diff whitespace.
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
retry then showed “Codex server returned an error”. Relay evidence showed successful
resume plus unsupported configuration/model/queue/goal/bootstrap reads. The adapter
now provides read-only views of the live models and queued messages, unset
Codex-specific configuration, and the absence of Codex goals, collaboration presets,
and marketplace installations. Configuration and model responses pass pinned
upstream schema validation. The full metadata/resume sequence passes against both
real TUIs, including actual process output/exit delivery (19 ms Luna, 14 ms Astra).
Robin subsequently confirmed both Alpha and Beta typed round trips on the iPhone. The next relay
retry confirmed successful metadata reads, isolating the remaining
errors to the phone's non-PTY Git-status process requests. `process/spawn`, stdin,
kill, output, and exit notifications now use native xcsh host processes with a
live-terminal working directory, client-scoped handles, replay suppression, timeouts,
16 active-process limit, and bounded capture. PTY operations remain explicit errors.
Disconnected clients lose their standalone processes, while TUI agents continue.
One fixture restart selected a local model through the existing CLI resume path;
Alpha was relaunched with its original explicit Luna model and the same session ID.
Automatic model fidelity across CLI resume remains a lifecycle acceptance item.
Sanitized process-shape diagnostics identify known operation families without
logging commands. A further phone retry passed process startup and reached `turn/start`, which
rejected the phone's client message ID and turn settings. Turn submission now
accepts matching model/cwd, applies supported effort through AgentSession, handles
reasoning presentation preferences, and deduplicates client message IDs across
request IDs. Empty extra skill-root setup is accepted; nonempty roots remain
explicit errors. The phone-shaped typed turn passed against Luna (3551 ms) and
Astra (3352 ms), with duplicate client-message submissions suppressed. The user
reported that Alpha accepted the prompt, transitioned to thinking, and replied
`ALPHA-ORCHARD`. This establishes the first manual typed interoperability gate.
Robin then reported Beta accepted a prompt without thinking or replying. Its
selected Astra model rejected reasoning effort `none`. Provider discovery already
advertised the valid effort enum, but generated model policies overwrote it with
inferred capabilities. Discovered subscription thinking metadata is now preserved
through registry refresh and cache load, and remote model listing exposes it.
Provider errors now produce failed turns with a sanitized message instead of a
silent completed turn. Regression tests cover Astra, Sol, Terra, and Luna.
Observed red: five failures; green: 88 tests / 288 assertions, plus 102 registry
tests / 854 assertions and the coding-agent TypeScript check. Live retries returned
Alpha's marker in 3829 ms and Beta's in 3323 ms without duplicate prompts.
Robin subsequently confirmed “beta worked”. Both manual typed routing checks now
pass. Automated checks do not substitute for the iPhone voice observations below. Actual phone bootstrap sends four extra skill roots;
nonempty root registration remains an explicit unsupported operation.

Product labels and host names use lowercase `xcsh`. Existing `XCSH_` environment
variable names retain their uppercase prefix.

## Native voice preparation

The phone exposes voice inside Beta. The user reported “Voice couldn't connect”,
then observed several connection retries after successive bootstrap fixes. Relay
traces first showed unsupported `thread/realtime/listVoices`, then unsupported
`thread/settings/update`. Both now implement the pinned contracts. A further retry
sent `thread/unsubscribe` three times before stop cleanup. Its empty response was
incorrect: the pinned response requires `unsubscribed`, `notSubscribed`, or
`notLoaded`. This is corrected without stopping the terminal owner.

Native v3 WebRTC negotiation and v1/v3 existing-call sideband attachment are implemented with xcsh's selected
subscription, own originator, and fixed production endpoint. Existing calls retain
client-owned configuration. Ordinary transcripts are persisted as custom provenance entries without executing
work. When the client explicitly requests transcript-tail flushing, closure promotes
the remaining speech through the normal agent pipeline; previously delegated speech
and matching late final transcripts are excluded. Delegations use the owning AgentSession's normal
prompt/steering path; only visible final text is returned through the voice call.
Voice closure leaves delegated work running and suppresses late events/results.

Tests cover pinned URLs/events, Unicode 500-byte chunks, malformed/bounded input,
selected account and model preservation, duplicate delegation, repeated transcript
words, error sanitization, stopping and new-call isolation, plus settings and
unsubscribe contracts. These are local/mocked transport checks, not service or
phone voice acceptance. After the unsubscribe response repair, the phone sent
`thread/realtime/start` with WebRTC v3 and startup context disabled. Native v3
WebRTC now uses the pinned ChatGPT subscription call-creation endpoint and returns
answer SDP before connecting the matching sideband. Initial role-bearing items,
voice-model settings, prompt/context, and start/end work-agent instructions are
kept separate from the terminal work model. The next phone attempt additionally requested transcript-tail flushing, 11 initial
items, and start/end instructions. Tail flushing now preserves accepted work across
closure and avoids replaying already delegated speech. At 2026-09-10 01:37:22 UTC,
the native service accepted call creation and xcsh attached its sideband in 1525 ms
using its own identity and selected subscription. Robin then reported that voice
appeared to work and confirmed hearing completion of the spoken fixture task.
The existing Beta session created `voice-check.txt` containing `BETA-HARBOR`; a
read-only filesystem check confirmed the exact marker. Native voice discovery,
connection, delegation into the existing agent, and spoken completion therefore
pass the first manual voice gate. Robin subsequently ended and restarted voice,
asked Beta to read the file, and confirmed the correct result. Robin also interrupted
Beta midway through counting and confirmed it stopped speaking and listened.
Robin also paused deliberately midway through speaking and confirmed voice waited
for the sentence to finish. Work steering/cancellation and network recovery remain pending. Earlier generic phone errors were
adapter contract/validation failures, not evidence of native service rejection.

Current limitations: standalone WebSocket and legacy WebRTC negotiation remain unsupported. Delegation identities persist
before submission for at-most-once recovery, with an unresolved crash gap; this is
not a complete exactly-once transaction. V3 sideband reconnect now follows the pinned 200 ms–5 s backoff, refreshes selected
authentication, buffers up to 1 MiB of unsent output, rejects stale socket events,
and retains delegation deduplication across reconnects. Successful writes have no
service acknowledgement and are not speculatively replayed. Expired calls end
cleanly. Automated recovery tests pass; live transport-drop recovery remains pending.
Timeline events, streamed result context, and audio appends remain pending.
Nonempty skill roots remain explicit errors. Full voice acceptance must precede
merge or release.

## Work still required

1. Pairing and both Alpha/Beta typed round trips are confirmed by Robin.
   The first native spoken task also passes; complete the remaining voice checks.
2. Complete history pagination and all live turn/tool event mappings, terminal
   versus remote interaction ownership, and durable retry identities.
3. Verify native existing-call attachment, complete the remaining realtime transports,
   durable delegation recovery, streamed context updates, interruption, and shutdown.
4. Complete lifecycle coverage (rename/fork/resume/exit/restart), permission-state
   fidelity, and cancellation/error status reporting.
5. Client listing/revocation and selected-row unauthorized recovery are implemented.
   Complete broader auth/retry-after recovery and exhaustive relay reconnect tests.
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
are excluded. Enrollment/host state and credentials live in the user's xcsh
remote directory with private directory/file permissions.

Current verification checkpoint: 88 focused tests / 302 assertions pass. The
workspace lint/TypeScript check passes for the final transcript-tail checkpoint. Two affected-package runs exposed only 5-second integration
suite timeouts. The latest reported 7322 passes, 561 skips, and two timeouts
(registry picker and progressive context loading) across 729 files. Registry
and context-loading assertions passed in targeted reruns; the last isolated
context case finished in 1359 ms with a 15-second diagnostic limit. The earlier
marketplace/remote CLI timeout cases passed in a separate 7-test rerun. These
results do not describe the default-timeout full suite as clean. Staged-scope PII,
secret scanning, and diff whitespace checks pass.

Recovery checkpoint: six focused reconnect tests pass (32 assertions), following
four observed failures before implementation. The earlier full remote run passed
93 tests / 330 assertions before the final pending-handshake cancellation test
was added. Workspace lint and TypeScript checks pass. Beta was idle after Robin
ended voice and was resumed with the same session identity and explicit Astra
model to load this change. Robin confirmed phone background/foreground recovery and correct file contents.
Airplane Mode did not recover automatically: the phone returned to text. At
01:53:06 UTC, the first sideband reconnect failed after 5430 ms without an exposed
HTTP status. Bounded retries were added after two further failing tests. The next
manual Airplane Mode attempt also failed, with three failed sideband attempts at
01:58:07, 01:58:12, and 01:58:19 UTC (5385, 5420, and 5465 ms). The terminal session
remained available. Do not mark automatic hard-offline voice recovery as passing.

The native Bun WebSocket client reports rejected upgrades without the HTTP status;
controlled local 401/403/404/410/429/503 fixtures reproduce this limitation. A
separate socket adapter now retains an explicit `upgradeRejected` classification
without guessing the status or logging the call URL, response, or credentials.
The production implementation remains Bun-native with no added dependency.
Robin confirmed fresh-call recovery after the hard network interruption: pressing
voice again succeeded and returned the correct file contents. This confirms recovery
with a new call, not automatic restoration of the interrupted call. Robin explicitly accepted needing to restart voice after a complete network loss
for the first release. This is an accepted limitation, not a claim of automatic
restoration. Keep terminal work and history intact across the outage.

The affected-package recovery run completed with 7327 passes, 561 skips, three
5-second startup test timeouts, and two resulting cleanup errors across 730 files.
The timeouts reproduced in a seven-test isolated run. The marketplace cases each
ran two independent startup scenarios inside one timeout; the remote CLI combined
status and help. These are now separate parameterized cases with identical behavior
assertions and the same timeout. All ten cases pass (22 assertions, 12.65 seconds).
Full-package verification of that repair remains pending.

Current focused verification: 106 remote tests / 373 assertions and workspace lint/TypeScript checks pass. Staged-scope PII, secret scanning, and whitespace checks pass.


Client-management checkpoint: native `clients` and `revoke <clientId>` use the
pinned environment-scoped GET/DELETE contracts and work from an existing enrollment
even while the host is disabled. Unauthorized responses recover the exact selected
subscription row through xcsh's fenced OAuth refresh broker and retry once;
account changes are refused. CLI revocation requires an explicit client identity.
A live read-only service request returned one paired client and no next page.
Revocation is covered by HTTP fixtures; the user's active phone has not been revoked.
119 focused tests / 418 assertions pass. The preceding voice/startup-test checkpoint
passed the complete package suite: 7344 passes, 561 skips, zero failures, 22645
assertions across 731 files in 356.24 seconds. Client-management package validation
also passed: 7357 passes, 561 skips, zero failures, 22690 assertions across 732
files in 317.64 seconds.

## Additional reference-capture gate requested by Robin

Record several ordinary ChatGPT-to-Codex conversations and compare the same
workflows against xcsh using bidirectional request/response/event evidence. Build
a parity matrix and regression fixtures for every observed mismatch. Do not claim
identical feature parity from schemas or successful happy-path interactions alone.
Capture manifests must include server versions: the running reference daemon is
still 0.153.4, although the installed/managed CLI has advanced to 0.154.0. Keep
these distinct and retain the original pinned compatibility commit. Capture relay
framing, complete decoded thread messages, and realtime sideband events; preserve
correlation and timing while excluding credentials and raw audio from diagnostics.
The direct iPhone media plane requires separate acceptance evidence. Reference
capture implementation is now available in `scripts/remote-reference/` and the
opt-in native trace hooks. Actual recorded phone conversations and full parity
comparison remain pending.

The separate instrumented 0.153.4 build compiled successfully. Its isolated
enrollment connected using the normal Codex credential store and a separate
SQLite directory. Two dedicated reference threads completed marker setup turns.
Preparatory relay capture received real messages without a producer failure or
capture overflow; this is setup evidence, not phone conversation acceptance.
The harness preserves request correlation and flags gaps, truncated frames,
incomplete footers, unknown/redacted semantics, and strict structural differences.
It has not yet covered every HTTP handshake or WebSocket control frame, nor the
phone's direct media plane. No identical-parity claim is made.

Capture checkpoint validation: 137 focused tests / 459 assertions; complete
package suite 7375 passes, 561 skips, zero failures, 22731 assertions across 735
files in 330.51 seconds. Workspace formatting and TypeScript checks pass. The
observation patch applies cleanly to the pristine pinned source. The existing
Codex daemon and the reference host both report connected, with distinct
enrollment identities. The instrumented reference passes all 148 upstream
app-server transport tests, including relay replay, refresh, and retry behavior.

Robin has now completed the two reference voice recall conversations. Both spoke
aloud; exact marker correctness was independently verified in the saved canonical
assistant voice transcripts. The phone-client event sequences are preserved as
a redacted fixture. Missing native session/transcript item notifications were
implemented from the pinned history reducer and now reproduce both recorded
notification sequences under synthetic replay, with payload validation against
the pinned item schemas. The detailed observations, limits, and remaining gaps
are in `PARITY.md`. A reference delegated file task and matching native captures
are still pending. The new timeline behavior has not yet been retested on iPhone.

Reference-recall repair validation: 151 focused tests / 540 assertions; complete
package suite 7389 passes, 561 skips, zero failures / 22812 assertions across 736
files in 324.80 seconds. Both recorded notification sequences pass with pinned
item-schema validation. Coverage includes cancellation during startup persistence,
interleaved partial speech at closure, late events, and speech arriving during
attachment. Workspace formatting and TypeScript checks pass.

The first reference voice file task exposed a reference-build omission: the
backing agent required `codex-code-mode-host`, while only the CLI had been built.
The failed delegation remains in the finalized recording. The pinned companion
now builds with checksum-verified Codex V8 artifacts, and a reloaded Reference
Beta passed a typed file create/read preflight with a completed file change,
command exit code zero, and exact on-disk contents. The reproduction instructions
now require both binaries and this live tool check. A fresh reference voice
delegation recording is running; its phone result and native comparison remain
pending. See `PARITY.md` for the evidence boundaries.
