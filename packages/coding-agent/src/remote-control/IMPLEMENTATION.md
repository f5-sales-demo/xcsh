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

Product labels and hostnames use lowercase `xcsh`. Existing `XCSH_` environment
variable names retain their uppercase prefix.

## Native voice preparation

The phone exposes voice inside Beta. The user reported “Voice couldn't connect”,
then observed several connection retries after successive bootstrap fixes. Relay
traces first showed unsupported `thread/realtime/listVoices`, then unsupported
`thread/settings/update`. Both now implement the pinned contracts. A further retry
sent `thread/unsubscribe` three times before stop cleanup. Its empty response was
incorrect: the pinned response requires `unsubscribed`, `notSubscribed`, or
`notLoaded`. This is corrected without stopping the terminal owner.

Native v1/v3 WebRTC negotiation and existing-call sideband attachment are implemented with xcsh's selected
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

Current limitations: standalone WebSocket remains unsupported; v1 WebRTC has source-contract tests but no live acceptance. Delegation identities persist
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

Reference phone delegation now passes: Robin confirmed creation and spoken
read-back, and the fixture contains exactly the requested marker and newline.
The finalized recording contains 2108 events, including one delegation and ten
acknowledged context updates, followed by the manually requested closure. A
sanitized fixture retains the phone's 92 voice notifications/requests and the 21
delegation sideband events. It exposed a missing handoff item notification;
native replay now matches the observed notification sequence. Handoff payload
tests cover distinct legacy identities, active transcript consumption, and
duplicate delivery. A further regression exposed repeated tail submission when
delegation precedes transcript delivery; marking the handoff input as consumed
prevents a late matching final from resubmitting it. Future recorder output also
retains pinned tool-item names and delegation routing targets.

Each repair was observed failing before implementation. Final focused validation
passes 162 tests / 610 assertions. The completed-result-only native output still
differs from the reference's commentary/speakable streaming.

The matching native Beta phone task now passes: Robin confirmed spoken read-back
and the file contains exactly `REFERENCE-HARBOR`. One delegation and one
acknowledged speakable result appear in the completed native captures. The host
and voice files have verified contiguous event sequences and completion footers;
sanitized fixtures and a comparison inventory preserve source hashes. Live
notifications include the newly implemented handoff item and normal closure.
The normal host was restored with both sessions connected and their models and
histories preserved. Full package validation through the guarded runner passed
7400 tests, 561 skips, zero failures / 22882 assertions across 736 files in 321.88
seconds. Workspace formatting/TypeScript, staged PII and the repair commit's
secret scan passed. The comparison's exact differences and remaining coverage
limits are recorded in `PARITY.md`.

The active completion audit is `ACCEPTANCE.md`; it preserves the full goal and
lists the current evidence and remaining gates for each requirement.

Native delegated-output streaming now follows the pinned handoff reducer and BEM
channel parser. It forwards only assistant text content from the existing owner,
routes configured prefixes to commentary/speakable context, honors the default
thinking mode and client-managed handoffs, paces live flushes at 200 ms, and
preserves a bounded Unicode-safe head/tail for long output. Finishing an already
streamed result does not replay it. New handoffs suppress older queued speech;
voice closure discards pending speech while backing work retains its normal
lifecycle. The completed-only provider fallback remains supported.

Observed failing integration tests for Sol, Luna, Terra and Astra now pass for
streamed and completed-only output, with reasoning excluded. Recorded reference
channel order, partial/custom headers, unknown-header fallback, timer pacing,
aggregate buffer limits, long Unicode output, client-managed routing and handoff
replacement are covered. Latest focused check: 183 passes / 716 assertions.
Workspace formatting and TypeScript checks pass. The guarded package suite
passed 7421 tests, 561 skips, zero failures / 22988 assertions across 737 files
in 330.19 seconds. Staged PII and the streaming commit's secret scan passed.
Both dedicated sessions were reloaded at streaming commit `c0a0071e0`, preserving
identity, history and Luna/Astra selections; live bootstrap checks passed and
the relay is connected. A fresh private recording is ready for Robin's streaming
phone task. Live streaming acceptance remains pending.

History pagination now uses the pinned default order, 25-row page size and
unsigned-integer/clamping behavior. Turn filters, summary/full/unloaded views,
scoped exclusive continuation cursors, inclusive reverse anchors and resume
anchors are covered. Reads and rejoining the existing owner return current state
when RPC identities are reused, without filling the mutation deduplication cache.
Eight original regression cases failed before the repair; a separate stale-resume
case also failed before its fix. All 12 new tests pass, including validation against
two unmodified pinned response schemas. Focused verification: 195 passes / 769
assertions. The guarded package suite passed 7433 tests, 561 skips, zero failures /
23041 assertions across 738 files in 331.00 seconds. Workspace TypeScript,
formatting, staged privacy/secret scans and whitespace checks passed.

This checkpoint does not yet replace the model-context history projection.
`SessionManager.getBranch()` retains selected-branch messages before compaction;
the adapter must use it and establish durable turn/item identities. AgentSession
currently emits display events before appending the corresponding message to
storage, so stream identity and history hydration must be repaired together.
The mixed canonical timeline, tool items and steering boundaries remain open.

The durable ordinary-history checkpoint now replaces that model-context projection
for live AgentSession attachments. It reads the selected persisted branch, keeps
pre-compaction messages and excludes sibling branches. Native identity/boundary
records align user/assistant item IDs and turn IDs with streamed notifications,
keep steering in the same turn, and preserve client message IDs for matched input.
Commentary and final content use separate items. Generic dynamic-tool history
includes actual arguments and completed/failed results; provider call-ID reuse
cannot alias items across messages. Voice provenance also reads the selected branch.

Observed red-to-green regressions cover history loss, branch isolation, stable
stream identities/phases, tool results, empty failed starts, live tool completion,
late prompt settlement, duplicate initial text, repeated tool IDs, disk persistence,
interrupted turns and successful provider retry. Before dispatching a remote turn,
the existing SessionManager persists its boundary, including a first turn that
fails before producing assistant output. A real AgentSession test verifies one tool
execution, four owner-written messages, matching live/history completed items and
stable reattachment. All four model voice adapter cases now exercise this history
path for streamed and completed-only output.

Verification: 209 focused tests, zero failures, 821 assertions. The guarded package
suite passed 7447 tests, 561 skips, zero failures / 23093 assertions across 740 files
in 334.64 seconds. Workspace TypeScript/formatting, staged PII, secret scanning and
whitespace checks passed. No new phone acceptance or capture is claimed; the
dedicated sessions remain on the earlier streaming capture build.

Remaining work includes the mixed canonical timeline, specialized command/file
items and remaining visible message types, attachment during an active turn,
session/fork lifecycle, and concurrent control/recovery. Persisting turn boundaries
does not yet provide durable request replay deduplication or close the tool/crash
gap. Historical turns without native boundary records use inferred boundaries.

The mixed timeline checkpoint now exposes `thread/timeline/list` from the selected
persisted branch and advertises paginated history for durable live attachments.
Pages combine ordinary items, explicit/inferred turn boundaries and voice facts;
they select newest entries, return chronological page order and retain opening
voice state. Stable source anchors survive appends and compaction. Replayed voice
facts update their original position; malformed facts return sanitized errors.
The method checks the requesting connection's experimental capability.

Observed red-to-green cases cover mixed paging, shared-position boundaries,
branch isolation, replay identity, invalid stored facts and advertised history
mode. A separate steering race now returns the accepted turn's captured identity
if the owner finishes before the reply; a retry does not execute steering twice.
The pinned experimental schema is preserved byte for byte. A read-only query of
the pinned reference binary's existing Alpha/Beta histories confirmed camelCase
boundary fields despite mismatches in its generated schema. The saved wire-shape
fixture includes field names only; live promoted-item behavior remains unverified.

Final verification: 219 focused tests, zero failures / 890 assertions. Workspace
TypeScript and formatting passed. The guarded package suite passed 7457 tests,
561 skips, zero failures / 23162 assertions across 741 files in 332.59 seconds.
Markdown, terminology, staged PII, secret and whitespace checks passed. An earlier
broad run overlapped the last two fixes; the final run began after both changes.
No new phone acceptance is claimed, and the dedicated sessions remain on the
previous streaming capture build.

Further discovery audit found that `thread/list` silently truncates collections
above 100 even though the host permits 128 live owners, ignores several pinned
filters/sort options, and omits usable pagination. The pinned reference defaults
to 25 entries, clamps unsigned limits to 1–100 and supports reverse anchors;
`thread/loaded/list` sorts IDs and uses exclusive cursors that tolerate departed
anchors. These are remaining implementation requirements, alongside the complete
control, interaction, lifecycle, recovery and model coverage in `ACCEPTANCE.md`.

Discovery now pages all permitted live owners with pinned 25-row defaults,
unsigned/clamped limits, timestamp sorting, reverse anchors, provider/source/cwd
filters and literal name/preview search. Native keyset anchors tolerate departed
sessions and newer registrations. Loaded discovery sorts IDs and resumes after
removed anchors. Projects, sections, archives and spawned descendants remain
outside this live top-level registry; corresponding filters are honored with
empty results or explicit errors. Experimental project/ancestry filters require
the requesting connection's capability. Omitted provider filters include all live
xcsh providers, preserving the user-required all-session view.

All ten initial discovery regressions failed before implementation and now pass.
An actual local Unix-socket integration registers 128 owners, pages all of them
without agent calls, then routes a last-page selection to exactly one owner.
Actual router responses validate against pinned list and loaded-list schemas;
the newly imported loaded-list schema remains unchanged from source.

Verification: 230 focused tests / 994 assertions, zero failures. Workspace
TypeScript and formatting passed. The guarded package suite passed 7468 tests,
561 skips, zero failures / 23266 assertions across 742 files in 333.50 seconds.
Fixture identifiers were standardized to documented synthetic values and their
ten tests rechecked. Markdown/terminology, staged PII, secret and whitespace checks
passed. The pending streaming capture still has no voice file or expected fixture;
no new manual phone acceptance is claimed.

Terminal storage transitions now have awaited before/after subscriptions. New,
fork, resume, reload, branch, tree navigation and handoff use the shared boundary.
The adapter stops accepting calls, closes voice, and drains accepted voice writes
and control effects before storage changes. It then resets transient item state,
restores the current identity and history, and rejects stale asynchronous work.
The bridge unregisters the old identity and registers the current one before the
terminal transition returns. Concurrent transitions fail explicitly; all after
listeners run even if an earlier listener fails.

Seventeen lifecycle tests exercise real AgentSession transitions, a local host
socket, persisted fork/resume/branch history and native voice with synthetic
transport/authentication. Observed failures preceded repairs for request-cache
isolation, awaited transitions, stale prompt dispatch, bridge registration,
listener recovery, final voice records and accepted steering. Interrupt settling
already passed because the terminal transition waits for abort; tracking it uses
the same mechanism as steering. A failed new-session storage operation also
exposed disconnected persistence listeners and lost model context. The repair
always reconnects agent events and resets the conversation only after storage
accepts the new session. Both flush and new-session failures now retain context.

Final review reproduced duplicate prompt execution after a failed switch, reload,
or return to an earlier session: unconditional cache clearing discarded accepted
request identities. The bounded retry cache now keys results by session identity
and survives these transitions. All three regressions failed with two executions
and now pass with one. This preserves retries within the surviving adapter;
durable crash/restart reconciliation remains a separate requirement.

The focused suite passes 259 tests, with three existing live-API skips, zero
failures and 1099 assertions. Workspace TypeScript and formatting pass. These are
automated lifecycle results; the dedicated phone sessions still run the earlier
streaming capture build. Full host restart, exit/shutdown, implicit model resume,
shared questions/approvals and manual lifecycle acceptance remain open in
`ACCEPTANCE.md`.

Final guarded package verification after the retry repair: 7485 passes, 561
skips, zero failures, 23328 assertions across 743 files in 328.33 seconds. The
runtime and tests were unchanged throughout that run. An intermediate broad run
overlapped the new retry tests and is not final acceptance evidence. Markdown,
terminology, staged PII, secret and whitespace checks pass. Full repository CI and
the previously recorded full-scope PII findings remain separate delivery gates.

Shutdown and host-recovery tests exposed three further defects. Terminal disposal
closed storage before stopping voice; final history and end instructions were
therefore too late. Session-bound before-dispose hooks now drain the remote
adapter while storage remains open. Voice closure notifications remain available
until this drain finishes. The bridge then waits for pending event submissions,
unregisters its owner and closes the socket. Direct and bridged synthetic voice
tests verify one close notification, no writes after storage closure, and both
final history and end instructions after reopening the session file.

A real AgentSession's pending tool survived a local host restart, but its bridge
did not re-register: the Bun socket had reached EOF without rejecting its pending
registration. Explicit socket destruction on EOF completes disconnect handling
and restores registration. The same test then exposed missing events for local
protocol subscribers. Owner events now reach subscribed local clients as well as
the existing relay path. Unsubscribed clients receive none.

The restarted local host now recovers the renamed owner, preserves its active
tool and history, and accepts the same clientUserMessageId without a second tool
execution. Completed events and canonical history agree afterward. A separate
heartbeat test advances the lease clock and uses the actual sweep timer to remove
a stale owner while retaining a refreshed owner. This is local integration
evidence with synthetic model/voice services, not a new phone recording, abrupt
packaged process-loss test, or proof of durable retry recovery after agent loss.

The focused remote suite passes 252 tests with zero failures and 1098 assertions.
Workspace TypeScript and formatting pass. Final guarded package verification:
7490 passes, 561 skips, zero failures, 23370 assertions across 745 files in
347.44 seconds. Runtime and tests stayed unchanged during the full run. Markdown,
terminology, staged PII, secret and whitespace checks pass. The complete remaining
objective remains tracked in `ACCEPTANCE.md`; no new phone acceptance is claimed.

Model persistence tests reproduced lost work-model selection before an assistant
response existed to infer it. New sessions, handoff storage and branches now
record their actual selected model. SDK resume also records an explicit launch
override, so a later implicit resume does not silently recover the prior model.
Eight new/explicit-resume cases and eight branch/handoff cases failed before
their repairs and now pass for Sol, Luna, Terra and Astra identities. Four tree
navigation model checks already passed and remain regression coverage.

A separate SDK test reproduced a saved extension model being replaced by a
settings fallback because the first lookup ran before provider registration.
Resume now retries unresolved saved selection after extensions and background
discovery, preserves the originally requested reasoning level when restoration
succeeds, and derives tool-loading mode from the final model. Existing explicit
reasoning behavior remains intact after repairing a regression caught by its
test. These cases use isolated registry definitions and synthetic credentials;
they do not exercise the live model services or establish the exact cause of the
earlier Alpha fixture's fallback.

Focused remote/SDK/branching/handoff verification: 290 passes, three existing
live-API skips, zero failures, 1207 assertions. Workspace TypeScript and formatting
pass. Final guarded package run: 7511 passes, 561 skips, zero failures, 23421
assertions across 746 files in 346.02 seconds. Runtime and tests were unchanged
throughout that run. Markdown/terminology, staged PII, secret and whitespace checks
pass. Packaged CLI restoration and all four live delegated model tasks remain
acceptance gates in `ACCEPTANCE.md`.

## Shared tool questions

The owning AgentSession now provides a bounded question broker for selectors,
text inputs, editors and confirmations. It settles once, aborts the losing local
widget, rejects invalid choices, and cancels pending input on session changes or
shutdown. Terminal completion claims ownership synchronously. Multiple pending
questions queue their terminal presentation while remaining individually
answerable through the broker.

ToolContextStore binds tool UI calls to their execution identity. The remote
adapter publishes only questions belonging to an active tool item, using pinned
`item/tool/requestUserInput` fields and the canonical thread, turn and item IDs.
Administrative prompts have no tool binding. Subscribed clients must negotiate
`experimentalApi` to receive these requests. JSON-RPC answers route only from
clients that received the request; `serverRequest/resolved` dismisses it for
all recipients. Invalid responses and transport errors leave input pending.

Bridge registration carries pending requests separately from the Thread payload.
A real AgentSession test restarts the local host while a tool awaits input,
rejoins the same question ID, delivers a denial once and verifies the item's
history identity. Phone disconnection and adapter closure leave terminal input
available. This is automated local protocol evidence; iPhone question rendering
and answers have not been manually accepted.

The initial mapping followed individual terminal dialog steps. The grouped-question
checkpoint below supersedes that mapping for the ask tool. Custom UI, dedicated
command/file permission requests and live approval decision coverage remain open. Generic confirmations
retain their existing Yes/No behavior; this does not establish specialized Codex
approval parity. Additional teardown, queue notification and host-bound/replay tests
remain part of the interaction completion audit.

Interaction checkpoint validation: the guarded coding-agent package suite passed
7535 tests with 561 skips, zero failures and 23543 assertions across 751 files
(363.71 seconds). Two additional queue-bound/cancellation regressions and permanent
pinned-schema assertions were then added; the final focused run passed 313 tests
and 1332 assertions across 39 files (33.42 seconds). Runtime code was unchanged
between these runs. Workspace TypeScript/formatting, changed documentation lint,
staged PII and staged secret checks passed. These checks do not replace repository
CI, the unresolved full-HEAD PII gate or manual phone acceptance.

## Question retirement and recovery

Host removal now resolves every delivered question before emitting the pinned
`thread/closed` notification and releasing subscriptions and answer eligibility.
This applies to explicit unregister, a departed owner socket, replacement by a
different session in the same terminal, and heartbeat expiry. Normal heartbeats
retain the owner object so an in-flight call remains valid. Snapshot reconciliation
retires questions no longer pending and sends newly pending requests without
repeating questions already delivered to each client. A delayed attachment result
from a removed owner is rejected before it can replay old questions.

The host validates pending request envelopes, question fields and option types.
Both registration and live events enforce 32 pending requests and a 1 MiB JSON
budget per session. Duplicate IDs within a snapshot, changed content under an
outstanding ID and ID collisions across live owners are explicit protocol errors.
Validation precedes snapshot replacement, preserving the current state on invalid
input. These are native resource limits, separate from the relay frame limit.

Automated socket tests cover unregister, disconnect, replacement, heartbeat
snapshot recovery and expiry. The `thread/closed` payload validates against the
pinned schema. The terminal agent remains independent of client disconnection.
Actual iPhone handling of a terminal transition and subsequent attachment remains
a manual acceptance item.

The grouped-question checkpoint below preserves whole-tool semantics across the
ask tool's local selectors. Remaining approval work requires separate integration.
Plan review is a separate TUI workflow: the completed `exit_plan_mode` tool causes
the agent to stop before an approval selector is presented. It does not have an
active tool identity at that point. The plan-review checkpoint below adds explicit provenance and reviewable plan
content to that workflow; it does not infer permission from a generic dialog
title. Approval also starts a new execution session, so that path
must retain model, history and voice/session lifecycle behavior.

Retirement checkpoint validation: observed failures covered missing owner-removal
and snapshot reconciliation behavior, stale attachment replay, malformed/oversized
requests, cross-owner ID collision and loss of an existing owner on a rejected
replacement. Final focused run: 324 passed, zero failures, 1397 assertions across
40 files (34.29 seconds). Final guarded package run: 7548 passed, 561 skipped,
zero failures, 23622 assertions across 752 files (366.24 seconds). Workspace
TypeScript/formatting, changed documentation lint and staged privacy/secret scans
passed. An earlier package run was deliberately interrupted for the replacement
repair and is not completion evidence. Manual phone transitions and the overall
interaction/approval gate remain open.

## Whole ask question groups

The ask tool now submits its complete question set through one broker request.
Local navigation, multiple selections and the free-text editor retain their
existing flow; intermediate widgets do not publish separate remote questions.
The pinned request carries original question IDs and labels, while the outer
request ID remains stable through host restart and response retries. Answers
validate against the full set before completion. Partial maps, duplicate choices,
ambiguous question identities and disallowed custom input cannot resolve it.

An answer from the phone aborts only the losing local form. A real AgentSession,
AskTool, ToolContextStore and terminal-controller socket test restarts the host,
replays the same group, answers multiple choices and free text, and verifies one
execution, a restored terminal editor, no agent abort and a completed assistant
response. Concurrent tool groups retain their distinct call identities;
administrative forms remain unbound. Terminal completion and stale-widget tests
cover local choice/editor navigation and dismissal of the losing form.

The extracted local renderer preserves literal option labels, including labels
that look like recommendation decorations or the free-text action. Closed-choice
forms omit the free-text action. Explicit cancellation after an elapsed timeout
remains cancellation unless the UI actually reported a timeout.

These are automated protocol and terminal checks. The pinned schema has no
multiple-selection presentation flag; its answer arrays accept multiple strings,
but the iPhone's presentation still needs manual acceptance. Specialized secret
entry, arbitrary custom UI and plan/dedicated permission approvals remain open.

Grouped-question checkpoint validation: observed failures covered missing broker,
terminal and wire group support, elapsed-time cancellation, literal label loss,
closed-choice free text and ambiguous question identities. The focused run passed
369 tests with zero failures and 1575 assertions across 42 files (33.07 seconds).
Two parameterized test fixtures then needed TypeScript-only corrections; the
35-test ask suite passed afterward. The final guarded package run passed 7565
tests, with 561 skips, zero failures and 23697 assertions across 753 files
(368.81 seconds). Workspace TypeScript/formatting, changed documentation lint,
staged PII and staged secret scans passed. Full repository CI and the remaining
manual and approval checks are still required.

## Plan review and execution lineage

The terminal event controller now carries the completed `exit_plan_mode` call ID
into plan review. Explicit review metadata binds the session, call, file and
reviewed content. Only that completed successful plan tool can publish a review;
ordinary completed tools, failed plans and mismatched session/call identities
remain ineligible. The pinned user-input request includes the complete plan and
closed choices for approval, refinement or staying in plan mode. Refinement uses
the same source and reaches the normal terminal input path.

Approval rechecks the file against the reviewed snapshot. Changed content opens
a new review with a new request ID and cannot execute under the old decision.
Concurrent completion callbacks share one review. New agent work or a session
transition cancels a pending review. Starting execution releases the review guard
so later work can enter another review before its prompt completes.

Decisions persist as `plan-review` session entries containing the reviewed content
and tool identity. The new execution session retains its parent session path and
an entry linking the source session and decision. The selected model and exact
reviewed plan survive the normal new-session path. If a hook cancels that switch,
the plan remains in plan mode at its final path and no execution prompt is sent.
The clear-command controller also stops before resetting the visible conversation
when its session switch is refused.

Tests exercise the real terminal event controller, review widgets, AgentSession,
remote adapter, persistence reopen and execution-session creation. Pinned-schema
checks cover the review request. A simulated phone approves an obsolete version,
receives the replacement review, approves it once and cannot execute it again
with a duplicate reply. These tests use local protocol calls, not an actual iPhone
or an additional recorded Codex approval conversation. Remaining approval work
includes concurrent controls during the execution handoff, dedicated permission
requests, visible plan-history projection and live
phone acceptance. The overall interaction gate remains open.

Plan-review checkpoint validation: observed failing tests covered stale-content
execution, duplicate reviews, missing remote review, a pending review surviving
new work, missing execution lineage, a cancelled switch still executing, and a
review guard preventing later reviews. The final focused run passed 359 tests
with zero failures and 1546 assertions across 47 files (36.18 seconds). The
final guarded package run passed 7577 tests, with 561 skips, zero failures and
23748 assertions across 754 files (347.02 seconds). Workspace TypeScript and
formatting, changed documentation lint and staged privacy/secret scans passed.
Two early fixture setup runs did not exercise the intended scenario and are not
passing evidence. Repository CI, full-HEAD privacy findings and the remaining
manual and approval checks are still open.

## Plan editing across terminal and phone

Opening the external editor retires the current review request before launching
the editor. The shared broker pauses local presentation while the editor owns the
terminal; remote answers can still settle queued requests. When editing finishes,
the terminal reads the saved plan and opens a fresh review with a new identity.
A retained callback from a dismissed review cannot launch another editor. Nested
presentation pauses release independently and only once.

The editor records the source session and original file contents. If that session
switches, closes or changes the plan while the editor is open, the returned edit
is saved beside the original as `PLAN.md.editor-<uuid>.md` with mode 0600. It does
not overwrite the newer plan or populate a different session's preview. A disposed
or stopped terminal is not restarted by a late editor exit. Cancelled review tasks
release their guard so a later session can complete its own review while the
original editor is still open.

Tests launch a real Bun editor subprocess with controlled save timing. They cover
normal save, a nonzero editor exit, a conflicting write, session replacement,
session disposal and terminal stop. A deferred terminal-handle acquisition also
checks that disposal cannot launch an editor afterward. They verify stale approval rejection, fresh content and request
identity, remote completion of queued input, a later session's review, draft
contents/permissions and terminal restart behavior. These are automated local
checks; actual iPhone presentation and editor/control acceptance remain required.

Editor checkpoint validation: observed failures covered acceptance of the old
approval during editing, queued local UI taking the terminal, late saves
replacing conflicted/switched/disposed plans, and disposal during terminal-handle
acquisition. The broader focused run passed 365 tests with zero failures and
1630 assertions across 46 files (38.94 seconds). The final acquisition repair
then passed the 52-test editor/review/broker integration run with 278 assertions
and zero failures (6.26 seconds). The final guarded package run passed 7585 tests,
with 561 skips, zero failures and 23842 assertions across 754 files
(363.16 seconds). Workspace TypeScript/formatting, changed documentation lint,
staged privacy and secret checks passed. Full repository CI and remaining live
acceptance remain open.

## Plan execution handoff ownership

Plan approval now holds one session transition through plan finalization, model
restoration, owned execution-session creation, plan persistence and tool setup.
The owner receives a scoped creation callback; unrelated operations cannot use
it, and a retained callback expires when preparation finishes. Nested creation
emits one before/after lifecycle pair for the whole preparation. Failure restores
the listeners and releases the transition. The approved execution prompt starts
after preparation releases the transition.

Terminal prompts, steering and follow-ups reject while the transition is active.
The remote adapter also checks the owner's transition state, including the time
before its own suspension listener runs. Preflight prompts retain their original
generation across asynchronous command and routing work. A stale routing decision
cannot apply its model/effort or dispatch text/custom work into the replacement
session. Routing credential lookup also rechecks that generation before applying
the selected model. Eager todo directives are installed only after prompt
preflight remains current.

Observed failing tests accepted competing terminal steering, a phone prompt and
an unrelated session creation while clear-command preparation was paused. Tests
also failed when four prompt variants resumed after deferred routing, and when
a routing model switch completed credential lookup after session replacement.
They now exercise rejection or stale-work retirement as appropriate, one approved
execution prompt, retained work model and history, nested transition ownership,
expired scopes, and failure recovery. These are local automated checks, not new
iPhone or Codex reference recordings. Disposal during preparation, lifecycle
operations already waiting on extension hooks, dedicated approvals and final
phone acceptance remain part of the open interaction/lifecycle audit.

Handoff checkpoint validation: the broader focused run passed 511 tests with
18 skips, zero failures and 2322 assertions across 67 files (73.37 seconds).
After adding the credential-race repair, the focused run passed 52 tests with
zero failures and 246 assertions across six files (10.92 seconds). The guarded
package suite passed 7596 tests with 561 skips, zero failures and 23890 assertions
across 755 files (354.76 seconds). A subsequent fixture typing correction uses
the exported effort enum with the same runtime value; the affected tests and
workspace TypeScript checks were rerun. Full repository CI, existing history
privacy findings and remaining live acceptance are still open.

## Session closure and delayed lifecycle callbacks

Owner disposal now marks the session as closing before asynchronous teardown.
New prompts and lifecycle operations reject immediately, and pending prompt
setup is invalidated. Disposal drains remote consumers, aborts and settles the
agent, and waits for an active owned transition before closing storage. The
transition stays closed afterward. Its before/after listeners drain even when
closure occurs during a listener, and closure prevents a successful transition
result from starting subsequent execution.

Approved plan preparation rechecks ownership after file finalization, model
restoration, session creation, plan persistence and tool setup. Closing before
or after execution-session creation prevents the approved prompt from starting
and avoids reopening an error panel in the closing terminal. These scenarios
verify one storage close and no further session creation after closure begins.
This is owner disposal; phone disconnection still detaches its remote adapter
without disposing the owner.

New, fork, resume, branch and tree operations capture a lifecycle revision before
awaiting extension hooks. They recheck it before applying the hook result or
changing storage. A completed or failed intervening transition invalidates the
old preparation even if the session identity is unchanged. Tree summarization
also rechecks after credentials/results, and handoff checks before replacing
storage after its generated document completes.

Observed failing tests covered five delayed extension-hook operations, storage
closing ahead of owned preparation, a credential-delayed prompt starting after
disposal, storage closing with a streaming agent, and closure during an after
listener returning success. Additional controller tests close before and after
execution-session creation and verify that no approved prompt or error panel
opens. These are local automated checks; live terminal exit/phone presentation,
remaining concurrent controls and protocol acceptance remain open.

Closure checkpoint validation: 481 focused tests passed with 18 skips, zero
failures and 2228 assertions across 65 files (78.28 seconds). The guarded package
suite passed 7609 tests with 561 skips, zero failures and 23956 assertions across
755 files (362.75 seconds). The final lifecycle fixtures then used real saved
sessions for every delayed-hook case, reopening original and replacement history
and verifying that no extra session file appeared. That final focused run passed
67 tests with zero failures and 362 assertions across four files (16.43 seconds).
Workspace TypeScript/formatting and changed documentation checks passed. Other
asynchronous model/tool restoration callbacks and final packaged shutdown remain
in the lifecycle audit; required CI and live phone acceptance are not complete.

## Model and tool configuration ownership

Asynchronous model selection now retains both the session lifecycle revision and
the identity of its model-change request. Manual, temporary, routing and cycled
model choices recheck ownership after credential lookup and provider tool-policy
setup. Initial retry fallback and later cooldown restoration use the same check.
Those superseded callbacks cannot append their model choice or settings to the
current session. A retry with no fallback candidate leaves a pending manual choice intact.
Configuration performed inside an owned session transition remains supported.

Tool selection builds its new system prompt before committing the active tools,
MCP selection, prompt and selection history. A failed build leaves the previous
selection intact. Older builds cannot overwrite a later selection or another
session. Direct prompt refreshes also recheck lifecycle, model, tool and refresh
identity. A refresh does not cancel an explicit tool selection already building;
when that selection commits, it invalidates refreshes of the earlier active set.

Tests hold actual credential/rebuild promises across new sessions, disposal and
newer selections. They cover both model-cycle paths, initial fallback, cooldown
restoration, failed tool builds, competing refreshes and retained manual choices.
The initial fallback fixture captures and awaits the owner's actual agent-end
callback because abort can resolve the public prompt sooner. Its first version
returned too early and is not failure evidence. With that correction, the earlier
implementation reproduced a model replacement after new-session creation and a
model-history append after closure; restoring the guards prevents both.

Changing only the selected model keeps a pending prompt in the same conversation:
it can continue once under the newer model. A session transition or disposal
retires that prompt. These are local automated checks, not live delegation tests
with all four work models. Remaining asynchronous maintenance, interaction and
final packaged/live acceptance stay in the completion audit.

Automatic routing, initial retry fallback and cooldown restoration also retain the
prompt generation. Cancellation retires their pending credential lookups while a
manual model selection remains independent of task cancellation. The new abort
matrix first failed in all three automatic paths; all three pass with generation
checks, and the manual-selection control remains passing.

The first package run exposed an unrelated unawaited browser host-tool test call:
its 60-second idle timer rejected while a later model-resolution test was running.
The frame test now supplies the matching host result and awaits settlement. The
focused configuration, browser host-tool and model-resolution run passed 51 tests
with zero failures and 163 assertions across four files (8.03 seconds).

Configuration checkpoint validation: the guarded package suite passed 7644 tests
with 561 skips, zero failures and 24096 assertions across 756 files (368.79
seconds). The model-resolution tests that received the earlier leaked timeout all
passed; no unhandled error was reported. Workspace TypeScript/formatting, CLI
bundle analysis and changed documentation checks passed. This does not replace
required CI, packaged execution or the remaining manual acceptance.

## Packaged independence and CLI extension-model startup

The normal production build now runs in an isolated Ubuntu 24.04 container with
no Codex, standalone Bun, repository checkout or package dependencies. Networking
is disabled. A Bun harness outside the container drives the compiled host and two
real TUIs through pseudo-terminals and native local IPC. The small provider
fixture supplies deterministic model responses; the packaged agent runs its real
write/read tools and verifies the read result before completing.

The check passes default-off status, two named owners with separate identities
and working directories, correctly routed file operations and persisted history,
host restart, stable request replay without another turn, compiled resume with
retained identity/history/extension model, and unregistering on terminal exit.
The final run completed its assertions and verified container cleanup in 15.956 seconds. The repeatable harness,
instructions and sanitized receipt are under `scripts/remote-package/`.

The first launch needed a writable home for logs. A temporary noexec home then
prevented the correctly extracted native addon from loading; the harness now
provides an empty writable home on an ordinary executable filesystem. These were
fixture setup failures, not missing embedded code. The first prototype's model
selection then exposed a product defect: CLI provider-qualified selectors were
resolved before the bootstrap extension's provider declarations reached the model
registry. The CLI now registers those declarations before resolving selectors or
scopes, retaining them for SDK source reconciliation. Two subprocess regression
cases first failed for qualified and separate provider/model flags and now pass.
The initial parameterized test draft expanded strings as flags and is not the
failure evidence; the corrected cases reproduced the actual model/provider errors.

The compiled binary SHA-256 is
`ff8a503c086a5364adaa018429dd9ac60652b24674b12cf9178c77459ac68bde`.
It was built from base commit `a9694ba9b` plus the CLI startup repair; the receipt
records the full base commit, changed production file hash, harness/provider
hashes and container image identity. The build identifies its source as dirty.
This proves the tested artifact, not every future release or all voice/model
variants. Enrollment is synthetic, host restart follows completed work, and no
phone or live subscription/model acceptance is inferred. Abrupt loss during active
work, all four live work models, final release packaging and voice remain separate
gates. The latest focused run passed 158 tests with zero failures and 499 assertions
across six files (12.25 seconds); workspace TypeScript and production build passed.

Package checkpoint validation: the guarded package suite passed 7646 tests with
561 skips, zero failures and 24100 assertions across 757 files (372.40 seconds).
The final harness checks cleanup failure and writes its success receipt only after
its container and processes are removed. Its separate final run passed with the
same compiled binary. Runtime source and regression tests were unchanged after
the package suite. Remaining full-HEAD privacy findings, required CI, live
model/voice acceptance and final release-artifact verification remain open.

## Legacy WebRTC negotiation checkpoint

The current upstream main was merged through `868cf386c`, including v21.23.0 and
authentication discovery repairs. The merge had no conflicts; 26 focused
authentication/model tests passed with 113 assertions across four files.

Pinned `realtime_conversation.rs` defaults WebRTC to v1 when version is omitted
or null. Native call creation now implements that default, accepts explicit v1,
requires audio output, and retains explicit v3. The v1 request includes the
quicksilver type, its own realtime model default, instructions, PCM input format
and selected voice. The call creation header and sideband use quicksilver v1.
HTTP serialization excludes internal version metadata. New v1 calls initialize
their sideband once without the HTTP model field; existing calls do not overwrite
the client's configuration. Completed legacy handoffs use the pinned final-agent
message prefix. Work still executes in the existing AgentSession.

Observed initial tests failed four cases because WebRTC required explicit v3.
After implementing negotiation, one test exposed the missing completed-message
prefix. The prefix repair passed all 51 initial voice tests. Additional lifecycle
coverage verifies initialization write failures and synchronous closure cannot
leave an active attachment, late delegation cannot execute, and early transcripts
follow history startup. A final App Server schema review corrected an overly
permissive output-modality default: the pinned request requires explicit output.
Both version tests failed before restoring that validation. The final focused
voice suite passed 84 tests, zero failures, 490 assertions across six files
(5.89 seconds). These are source-contract fixtures and recorded v3 regression tests, not
new live v1 service or iPhone acceptance. Legacy completed commentary, standalone WebSocket,
remaining options, and the full completion audit remain open.

The production build and final workspace TypeScript check passed. The compiled
v21.23.0 artifact also passed the isolated two-TUI harness, including real file
tools, completed-work host restart, request replay, resume and cleanup in
19.015 seconds. Its SHA-256 is
`8dabd0f50c200c19b4e76733a6627b60d6328c5e6903c07313ea5491b6c1a318`.
The receipt `scripts/remote-package/evidence-webrtc-v1-2026-09-10.json` records
base commit `214e461cd`, the two changed production file hashes, harness/provider
hashes and the container image. Networking and enrollment are synthetic; this
artifact check proves packaging/session independence and does not exercise voice.

Final guarded package validation passed 7657 tests with 561 skips, zero failures
and 24173 assertions across 758 files (365.15 seconds). The earlier package run
passed 7655 tests before the explicit-modality regression was added; it does not
replace the final run. Runtime source and tests remained unchanged throughout
the final suite. Markdown, terminology, staged privacy, secret and whitespace
checks passed. Required repository CI, full-HEAD privacy findings and the
remaining live/protocol acceptance are still open.

## Completed legacy output and speech appends

The native v1 output handler now forwards completed commentary unchanged and
completed final messages with the pinned final-agent marker. Partial text remains
buffered by the working agent. Duplicate text/message completion events do not
repeat a spoken item, and turn completion does not resend the last completed
message. A different cancellation result still reaches voice. Superseding a
handoff closes its output handler without cancelling backing work; ending voice
suppresses late output while its result remains persisted. Client-managed mode
suppresses automatic output and still permits explicit speech.

Explicit speech uses the v1 standalone handoff ID or the v3 speakable context
channel. Empty speech is a no-op on an active call. Completed v1 text bodies and
explicit speech use the pinned 1000-token estimate, preserving UTF-8 head/tail
boundaries and accounting for the truncation marker. The final-agent marker is
added afterward, as in the pinned writer. Five fixtures compare exact output
byte counts and hashes with the original Rust string truncator and the original
realtime-context budget loop. A Bun generator validates both source hashes,
compiles only those reference operations, and removes its temporary executable.
Rust and the pinned source are required only for fixture regeneration.

The valid initial regression run had one pass and seven failures: missing
completed items, repeated/stale output, rejected speech and excessive output
size. Two additional empty-speech tests failed before the no-op repair. After
implementation, 106 focused tests passed with zero failures and 609 assertions
across seven files (7.69 seconds). Sixteen adapter variants exercise all four
work models with v1/v3 and partial/completed-only inputs; they verify selected
credentials/model, one delegation and reasoning exclusion. These remain synthetic
adapter tests and do not claim new live model or phone acceptance. Workspace
TypeScript, formatting and the CLI bundle check passed. The existing compiled
package receipt predates this output checkpoint; final release-artifact
verification remains required.

Final guarded package validation passed 7679 tests with 561 skips, zero failures
and 24293 assertions across 759 files (372.69 seconds). Runtime source and tests
remained unchanged during that run. Markdown, terminology, staged privacy,
secret and whitespace checks passed. Remaining start/end instruction lifecycle,
client-created-call options, standalone WebSocket, response-item mode, live
acceptance and the full completion audit remain open.

## Explicit voice instruction lifecycle

Existing-call startup now accepts valid backing start/end instructions, matching
the pinned core. Both transports share pre-authentication validation, including
empty overrides and the 32768-byte UTF-8 limit. A failed sideband connection does
not apply instructions. Successful attachment serializes start and end updates;
stop waits for the end update before reporting closure. A failed update produces
a sanitized error and cannot reopen the attachment. The backing custom messages
now convert to developer-role instructions, with agent attribution.

The initial lifecycle regression run had two passes and six failures. The final
additional diagnostic-race test failed because a stopped attachment could return
successful startup after an awaited diagnostic write. Restoring the active-state
guard passed the regression. Focused voice and message-conversion validation
passed 184 tests, zero failures and 1480 assertions across 11 files (7.13 seconds).

This checkpoint does not finish mode-context parity. A deeper source audit
corrected the earlier assumption that active voice state changes between tools:
the pinned turn constructor snapshots activity once, and subsequent model steps
share that turn context. The native hidden next-turn queue still records both
start and end even when no intervening turn observed voice. Turn-scoped activity,
default start/end templates, boolean transition snapshots, developer fragment
markers and retained-fragment reconciliation remain implementation work. Final
live and compiled-artifact acceptance also remain outstanding.

A fresh `head` enforcement scan still reports 218 PII-shaped findings across
13 files: authentication/configuration test fixtures and generated API catalog
examples. The saved earlier report also used `head`, not `history`; references
above were corrected to identify the actual scan scope. The staged change is
clean, but that does not satisfy the repository-wide gate. Repairing synthetic
identifiers and generated example provenance remains delivery work.

The first package run had 7693 passes and one failure because Puppeteer's pinned
Chrome binary was absent. Installing Chrome 150.0.7871.24 through the installed
Puppeteer CLI restored the dependency; both HTML export tests then passed with
22 assertions. The final guarded package run passed 7694 tests, 561 skips, zero
failures and 24357 assertions across 760 files (362.38 seconds). Runtime and test
hashes remained unchanged throughout both package runs. Workspace TypeScript,
CLI bundling, Markdown, terminology, staged privacy and secret checks passed.
The existing compiled-package receipt predates this checkpoint; final artifact
verification and required repository CI remain outstanding.

## Turn-scoped voice mode context

Native voice now reports complete mode options on attachment and closure,
including when no custom instructions were supplied. The session stores that
state without calling `sendCustomMessage` or queuing a turn. Each admitted
prompt snapshots activity; a busy executor retry leaves the running turn's
snapshot intact. Instructions retain their owning session identity, and option
objects are copied at the voice and session boundaries.

The agent loop now accepts session-owned context messages after extension
pruning and before model conversion. It emits and retains them through the
ordinary message pipeline, preserving the existing persistence owner. The
realtime context helper renders pinned default or custom developer fragments
only for a changed observed state, or when active instructions were pruned.
The persisted native custom-message type carries the observed boolean state.
Cold resume defaults to an inactive call and emits default end instructions if
retained voice context requires them. Unobserved start/end transitions add no
messages; ending voice during tools preserves both work and the turn snapshot.

Initial observed regressions: the context helper had three passes and six
failures; the agent-loop integration had two failures; real AgentSession tests
had two passes and five failures; mode notification tests had 15 passes and
three failures. A proposed busy-admission test stopped at public prompt rejection
before reaching its intended race, so it was removed and is not failure evidence.
The existing lifecycle tests were updated to hold actual final history writes
instead of the removed hidden-message callback. They verify old-session mode
changes and persistence before switching or closing storage.

The remote-control suite passed 372 tests with zero failures and 1706 assertions
across 43 files (36.43 seconds). The agent package passed 34 tests, zero failures
and 133 assertions across four files. An additional source-contract test then
matched all ten cases from the unchanged pinned Rust realtime snapshot; its
complete file SHA-256 is verified in the test. The default prompt files were
copied from the same pinned source, with provenance recorded in NOTICE.md.
No new manual phone or live work-model acceptance is claimed by these checks.

Final guarded coding-agent validation passed 7714 tests with 561 skips, zero
failures and 24445 assertions across 762 files (373.01 seconds). The 18 changed
runtime, prompt and test artifacts retained their recorded hashes throughout
that suite. Workspace TypeScript and CLI bundling passed after the snapshot test
was added. The existing whole-tree privacy findings, required CI and remaining
protocol/manual acceptance stay open.

The production executable also passed all eight isolated two-terminal checks in
16.738 seconds. The receipt
`scripts/remote-package/evidence-context-2026-09-10.json` records base commit
`44f5e6a47`, hashes of the nine changed production files, harness/provider hashes
and the container image. Binary SHA-256:
`b9e421b9ca268d1d9ccf35fdee79ec50deb80df9184ad866e860c606767601f4`.
The environment had no Codex, standalone Bun, repository or package dependencies.
Real tools, completed-work host restart/replay, compiled resume and cleanup
passed. Enrollment and model output were synthetic and networking was disabled;
this receipt does not exercise live voice or replace phone acceptance.

## Realtime call identity

Created WebRTC calls now use the owning thread ID when the client omits or sends
null for `realtimeSessionId`. Existing-call attachment keeps the client's optional
identity. Explicit empty IDs remain present in HTTP/sideband headers, matching
the pinned Rust header builder. The same resolved identity reaches the started
notification, persisted timeline and v3 reconnect headers. Reconnection does
not create a second call-start event or timeline entry.

Sixteen source-contract cases produced eight passes and eight failures before
the repair, then 16 passes and 148 assertions afterward. The complete remote
suite passed 389 tests, zero failures and 1856 assertions across 44 files
(38.07 seconds). Workspace TypeScript, CLI bundling and the changed parity
document's Markdown/terminology checks passed. This evidence is synthetic and
does not establish additional iPhone or live model acceptance.

The guarded coding-agent package suite passed 7730 tests, 561 skips, zero
failures and 24593 assertions across 763 files (369.07 seconds). Runtime/test
hashes remained unchanged. The existing compiled-artifact receipt predates this
identity repair, so final compiled-package verification remains required.

The dedicated live host and both terminal sessions were then restarted on
`075f9bebc` (21.23.0). Each old terminal exited successfully before its replacement
resumed, preserving a single execution owner. The relay reconnected and listed
both original session identities. Alpha retained Luna and 18 saved messages;
Beta retained Astra and 52. Names and working directories also matched the
pre-restart audit. Both sessions passed initialization, configuration discovery,
fixture-process execution and history attachment, returning six and 18 turns
respectively. They were idle after verification.

The preceding host trace closed with a complete footer and 10522 events. A fresh
private capture window records source commit `075f9bebc` and remains open for the
pending streaming voice test. No new voice capture or manual result was available
at this checkpoint. The restart checks establish live host/session recovery,
not live model execution or voice parity.
