# Observed native remote parity

Reference: instrumented Codex 0.153.4, source commit
`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`. Native implementation and reference
recordings are separate processes and enrollments. This is an evidence matrix,
not a declaration of complete feature parity.

## Legacy WebRTC source contract

WebRTC now accepts v1 and v3; an omitted or null version defaults to v1. The
pinned App Server requires explicit audio output. The v1 HTTP body follows the
pinned quicksilver session shape, with `gpt-realtime-1.5`, PCM input at 24000 Hz,
and the selected voice. Its request uses `quicksilver=v1`. Internal version
metadata is excluded from the HTTP body. Nonempty initial items remain v3-only.

A newly created v1 call sends one sideband `session.update`, excluding the HTTP
model field. Attaching a client-created call leaves its configuration intact.
Completed v1 agent results include the pinned final-message marker. Tests cover
duplicate delegation, initialization write failure, synchronous socket closure,
early transcript ordering, and late work after closure. They use synthetic
transport fixtures derived from the pinned Rust source, not phone recordings.
Live v1 and standalone WebSocket acceptance and remaining startup/control options
are still incomplete. Recorded v3 replay remains
part of regression validation; no additional live parity is inferred here.
The pinned `streams_handoff_append` gate enables incremental output only for v3.
Legacy v1 forwards completed commentary without the final-message marker and
completed final output with it. The completed-output checkpoint below verifies
that distinction through the native adapter.

## Call identity source contract

For WebRTC call creation, omitted or null realtime session IDs now default to
the owning thread ID, matching the pinned `build_realtime_session_config`.
Client-created calls preserve the client's optional identity, including null.
Explicit strings, including the empty string, remain unchanged. The resolved
identity is shared by call creation headers, sideband headers, the started
notification and persisted timeline items. A v3 sideband reconnect retains it
without creating a second started notification or history entry.

Sixteen source-contract cases cover both transports, v1/v3, omitted/null/explicit/
empty IDs and v3 reconnection. They reproduce eight failures before the repair.
This establishes automated protocol behavior; no new phone acceptance is claimed.

## Completed voice output

Legacy v1 now forwards completed commentary and final text items through the
owning session's output callback. It ignores partial text and v3 channel-routing
options. Repeated completion events for the same item do not resend output, and
the final turn result does not repeat its last completed message. A distinct
cancellation result remains visible. New handoffs retire old output handlers;
backing work may still settle and persist its result. Ending voice suppresses
late output without cancelling the working agent. Explicit client-managed mode
suppresses automatic output while permitting requested speech.

Explicit v1 speech uses the pinned standalone handoff ID; v3 uses the speakable
session-context channel. Empty speech is a no-op on an active call. Completed v1
text bodies and explicit v1/v3 speech follow the pinned 1000-token estimate, including
the truncation marker. Five boundary/Unicode fixtures were produced by compiling
the original pinned Rust truncator and budget loop. Native output matches their
byte counts and SHA-256 values. The reproducible generator validates source-file
hashes and requires Rust only for fixture regeneration.
The legacy final-message prefix is added after budgeting its text body, matching
the pinned writer.

Sixteen work-model adapter variants cover Sol, Luna, Terra and Astra with v1/v3
and partial/completed-only inputs. They preserve the selected model, use the
session's ordinary delegation path and exclude reasoning content. These are
automated source-contract tests, not live model or iPhone acceptance. Standalone
live acceptance and remaining startup/control options stay open. The following
checkpoint extends automatic output to response-item mode.

## Completed response-item delivery

Native WebRTC and existing-call v1/v3 now accept `codexResponsesAsItems` and
`codexResponseItemPrefix`. Malformed values fail before authentication. Automatic
delivery waits for complete agent text items. V1 creates developer conversation
items; v3 appends session context using the configured thinking, commentary or
BEM channel. BEM classification examines the original text before adding a
prefix or applying the output budget. V1 ignores BEM routing, as in the baseline.

The writer budgets the backing response, adds a nonempty custom prefix and two
newlines, then budgets the resulting item again. Five fixtures produced by the
original pinned Rust `realtime_backend_item` and truncation functions match the
native byte counts and hashes for both versions. Empty prefixes add no separator;
completed empty or whitespace-only items retain their protocol meaning. V3
splits context text at the pinned 500-byte Unicode boundaries.

Completed delivery shares item identity, duplicate suppression and input bounds
with the existing v1 path. Partial output stays out of response items; completing
the turn does not repeat the last item. A distinct cancellation result is kept.
Superseding a handoff or ending voice suppresses late output while allowing the
backing result to persist. Client-managed mode suppresses automatic items and
continues to permit explicit speech.

Thirty-two adapter variants cover all four work models, both protocol versions,
partial/completed-only model events and item/delegation output paths. These are
automated native/source-contract checks. Live canonical timeline promotions, standalone
WebSocket, remaining control/recovery coverage and live item-mode phone acceptance
are still outstanding.

## Canonical timeline reducer coverage

Speech persistence now uses a port of the pinned history reducer with ordered
effects, UUID v7 identities, empty continuations and bounded final-only input.
Reducer tests also cover inline/whole-item promotion, transcript splitting, turn
association, late output and FIFO handoffs across calls. Twenty-five presentation
expectations run the original Rust selector and constants independently of xcsh.

Ordinary backing events are not yet connected to this reducer, and the native
session does not yet retain its history owner across calls. Correct command/file
item mapping and before/after source-event persistence are prerequisites for that
integration. The direct reducer/wrapper tests do not establish phone timeline or
complete source-event ordering parity.

## Explicit voice mode instructions

The pinned core accepts optional start/end instructions for WebRTC and
client-created calls. Native validation now accepts both transports, preserves
explicit empty overrides and enforces the 8192-token estimate as 32768 UTF-8
bytes before authentication. Instructions apply only after sideband attachment.
Failed attachment leaves them unapplied; stopping during a pending start update
serializes the end update afterward. Closure waits for that end update and
reports an instruction-write failure without exposing its exception contents.
Stopping during connection diagnostics cannot later return a successful start.
Converted backing instructions retain the pinned developer role.

This verifies explicit instruction validation, priority and lifecycle only.
The pinned `core/src/session/turn_context.rs` snapshots voice activity when a turn
is constructed. `session/turn.rs` preserves that turn context across tool/model
steps, while `context/world_state/realtime.rs` renders boolean state transitions,
supplies default start/end text and recognizes retained developer fragments.
Ending voice therefore does not switch an already-running turn to typed mode.
The following turn-context checkpoint replaces that hidden-message path.
No new phone acceptance is claimed for the instruction lifecycle change.

## Turn-scoped voice context

Voice attachment and closure now update the owning session's call state without
queuing model input. Each admitted prompt snapshots voice activity. Ending voice
during a tool call leaves that turn in voice mode and does not cancel its work;
starting voice during typed work applies to the next prompt. An attachment that
starts and ends without an intervening agent turn leaves no mode messages.

The model boundary examines retained context after extension pruning. It adds
the pinned developer fragment for a changed observed state, or restores the start
fragment when active context was removed. Unchanged active state does not repeat
instructions when their text changes. Empty overrides retain the wrapper, and
cold resume of retained voice context uses the default end text. A different
session identity cannot inherit the old call. Native custom-message types persist
the observed state; earlier unwrapped native instructions are recognized too.

Context updates emit ordinary agent message events and persist through the
existing AgentSession owner. They are not new user prompts or remote turns.
Ten rendered state cases match the unchanged pinned Rust snapshot exactly.
Real AgentSession tests exercise tool continuation, pruning, disk resume and
new-session isolation. Transition/disposal tests hold the final history flush and
verify mode state changes on the old owner before storage moves or closes.
These are automated source-contract and runtime tests; the final phone/model
acceptance and the remaining protocol matrix are still open.

## First two phone conversations

Robin ran voice recall in Codex Reference Alpha and Beta and confirmed both
responded verbally. A read-only `thread/timeline/list` query of those exact test
threads verified `REFERENCE-ORCHARD` in Alpha's saved assistant voice transcript
and `REFERENCE-HARBOR` in Beta's. No recollection of the exact wording was needed.

The two requests used WebRTC v3 audio, client-supplied initial history and prompts,
`includeStartupContext: false`, `codexResponsesAsItems: false`, and transcript-tail
flushing. Both calls started and closed normally. Neither recall conversation
produced a realtime delegation, so these calls do not verify tool execution.

| Evidence | Alpha | Beta |
| --- | --- | --- |
| Start notification after request | 879.9 ms | 662.3 ms |
| Answer SDP after request | 880.3 ms | 662.8 ms |
| Normal closure after request | 13682.6 ms | 10154.0 ms |
| Selected phone voice protocol events | 41 | 35 |
| Canonical durable voice items | 4 | 4 |
| Correct marker in saved assistant voice transcript | Verified | Verified |

These are host-observed relay timings, with instrumentation overhead; they are
not measurements of first audible audio. The ongoing recorder showed no sequence
gap, overflow, or producer failure at the recall snapshot boundary. The bounded
snapshot and derived fixture identify their scope and SHA-256. They do not claim
that the continuing recorder has a final completion footer.

## Comparison and remaining work

History pagination now follows the pinned source contracts: turns default to
descending summaries, items to ascending order, and pages to 25 rows with the
upstream 1–100 clamp after unsigned-integer validation. Item queries honor their
turn filter. Continuation excludes the last returned row; reverse cursors include
their anchor to refresh it. Native opaque cursors bind the thread, collection and
turn filter. Resume returns compatible reverse anchors, and read requests no
longer consume the mutation deduplication cache or return stale history when an
RPC identity is reused. Tests validate actual adapter responses against the two
unmodified upstream page schemas.

The following history repair replaces the live adapter's model-context projection
with the persisted selected branch. Ordinary messages before compaction remain
visible. Identity/boundary metadata keeps steering in the same turn and aligns
live text/tool items with later reads. Commentary and final content remain separate;
reasoning content is excluded. Generic dynamic-tool items preserve arguments and
completed/failed results, with distinct identities even when a provider reuses its
tool-call id. Voice provenance reads also follow the selected branch.

Tests cover attachment restart, branch isolation, a real AgentSession's sole tool
execution and message persistence, late prompt settlement, retry recovery and
interrupted turns. A first remote turn is persisted before dispatch, so a failure
without assistant output survives disk reopen. Sol, Luna, Terra and Astra adapter
tests now use the persisted-history path for streaming and completed-only voice.
These are automated results, not new manual phone acceptance. Specialized
command/file displays, remaining visible message types,
concurrent controls, active attachment and fork lifecycle still require work.

Live attachments now advertise paginated history. The mixed `thread/timeline/list`
implementation combines ordinary items,
explicit/inferred turn boundaries and persisted realtime facts. Like the pinned
store, it selects the newest page and returns that page in chronological order;
its cursor moves to older entries. Equal-position entries use boundary/item kind
and ID ordering. Opening voice state considers only facts before the page and on
the selected branch. Source-entry anchors survive appends and compaction. Replayed
voice facts update their original position. Invalid stored facts return sanitized
errors, and unknown extra fields are excluded. The new method requires the
requesting connection's experimental capability; this is not yet a complete audit
of experimental methods and fields throughout the adapter.

The pinned precomputed experimental JSON schema retains snake_case names on some
variants where the Rust serializer uses camelCase. A separate read-only local
app-server query against the pinned 0.153.4 binary confirmed the actual camelCase
turn-boundary fields in the existing reference Alpha/Beta histories. The saved
fixture contains field names only. Tests preserve the original schema export,
correct a copy's known naming mismatches explicitly, and independently compare
boundary field names with those observed responses. Promoted-item shapes still
rely on Rust source; no live promotion or new phone acceptance is claimed.

Discovery now follows pinned 25-row defaults, unsigned limits clamped to 1–100,
created/updated/recency ordering, exact provider/source filters, normalized cwd
filters and literal case-sensitive name/preview search. Keyset continuation
anchors tolerate exited sessions and newer registrations; reversing uses an
inclusive timestamp anchor. Loaded-thread lists sort IDs, default to no limit,
and resume after a departed anchor. Native cursors carry session IDs and timestamps,
with an ID tie-breaker for second-resolution timestamps; cursors are opaque to clients.

Unlike Codex's single configured-provider default, omitted `modelProviders`
includes every live xcsh provider, as required by the all-session objective.
Explicit provider filters still apply. The live top-level scope has no archived
threads, sections, projects or spawned descendants: filters return empty sets or
explicit errors rather than ignoring the requested constraint. Experimental
project/ancestry filters require the connection capability. Section-position
sorting requires a section filter and returns the empty section collection.
`useStateDbOnly` is validated but does not change the in-memory live registry read.

Ten discovery cases failed before implementation and now pass. A separate local
Unix-socket test registers 128 owners, pages all of them without invoking their
agents, then routes a last-page selection to exactly one owner. Actual router
list responses also validate against the pinned schemas. These are automated
checks, not new manual phone observations. Full experimental notification/field
handling, lifecycle and live acceptance remain separate open requirements.

Native terminal transitions now await voice closure and accepted control writes
before changing storage. The adapter refreshes its identity, timestamps, history
and transient item state; stale asynchronous prompts cannot execute in the next
session. Local socket tests verify that the old owner disappears and the new
owner is registered before the transition returns. Real AgentSession tests cover
new/fork/resume/reload/branch, listener failure recovery, and retained conversation
and persistence after a storage error. A synthetic native voice test verifies
that closing records and end instructions stay with the old session and that
late transcripts do not enter the new one. These tests do not establish reference
wire parity or new iPhone acceptance for lifecycle behavior. Full host restart,
exit/shutdown and the remaining interaction/control scenarios are still open.
Accepted request results remain scoped to each session in the bounded adapter
cache. Tests first reproduced repeated execution after failed switches, reloads,
and returning to a previous session; retries now return the accepted result with
one prompt execution. This does not prove durable retry recovery after a crash.

Local host-recovery tests now keep a real agent and pending tool alive while the
host socket closes and a replacement host starts. The bridge reconnects after an
EOF handling repair; it recovers the renamed owner and completed history. Retrying
the stable client-message identity executes the tool once. Local subscribers now
receive completion events; an initialized but unsubscribed client receives none.
A lease-clock test verifies stale-owner removal and refreshed-owner retention.

Terminal disposal now drains remote voice before closing session storage and
unregisters the bridge before disposal completes. Direct and bridged synthetic
voice tests reopen the persisted history to verify final voice records and end
instructions, with one close notification. These are automated native results,
not reference wire recordings or new manual iPhone acceptance. Abrupt packaged
host loss, the remaining relay replay matrix and final phone lifecycle checks
remain open.

Native SDK model-restoration tests now preserve Sol, Luna, Terra and Astra
identities across new sessions, explicit/implicit resume, branch and handoff.
The repair persists the selected model without requiring an assistant response.
A saved extension model is retried after provider registration instead of
retaining an early settings fallback; its saved reasoning level is preserved.
The test registries and credentials are synthetic. This verifies native
persistence behavior, not live model capability parity or the original cause of
Alpha's earlier fallback. Final CLI resume and delegated tasks with each actual
model remain open.

| Behavior | Reference observation | Native evidence or remaining difference |
| --- | --- | --- |
| Voice recall and routing | Two correct saved voice answers in distinct threads | Earlier native phone recall worked; a new native Beta file-task capture also passed |
| Session and transcript items | Started/completed item pairs and per-item transcript deltas surround legacy voice notifications | Missing behavior implemented; replay of both recorded notification sequences passes with synthetic speech and pinned item schemas |
| Durable speech boundaries | Start, user segment, assistant segment, close in canonical timeline | Mixed timeline now pages ordinary/voice facts with opening call state, branch isolation and stable anchors; final phone acceptance remains pending |
| Separate subscribers | Identical notifications can be sent to multiple relay clients | Comparison selects the phone client from relay envelopes; it does not deduplicate legitimate deliveries within that client |
| Shutdown | Both calls closed with reason `requested` | Closure waits for accepted history writes; tests cover partial speech, repeated closure, late events, and cancellation during startup flush |
| Work delegation | After repairing the reference setup, one phone delegation created the file and read back the correct contents; Robin confirmed the verbal result | Matching native phone task passed with one delegation, correct file and spoken read-back, handoff notification, and normal closure |
| Delegated output streaming | Five commentary context chunks, then five speakable chunks; all ten acknowledged | Streaming implementation now passes recorded-channel replay and all four adapter tests; the earlier native capture predates it, so live streaming parity remains unverified |
| Discovery and history | Phone requests included skills roots/listing and file reads | These include unsupported native operations; repair and corresponding reference fixtures remain pending |
| Protocol metadata | Initial recorder redacted some valid method and item-type names | Future recordings retain pinned method literals and canonical item types; the original redactions are not reconstructed |
| Network recovery | Reference airplane-mode conversation not yet recorded | Native fresh-call recovery is accepted after complete network loss; identical behavior is not established |
| Complete protocol coverage | Captured relay text, decoded RPC and realtime JSON | HTTP handshakes, every WebSocket control frame, direct phone media, all model variants and remaining transports are not fully covered |

The recorded fixture is
`../../test/remote-control/fixtures/codex-0.153.4-phone-recall.json`.
Private speech is replaced only in replay input. The observed notification order
and schema validation are independent assertions; they do not prove identical
spoken semantics, latency, or the remaining untested workflows.

## Reference tool-host repair

The first reference file-creation attempt reached the backing agent: the sideband
recorded one `delegation.created` and 14 context appends with 14 acknowledgements.
Robin heard that workspace tools were unavailable. The saved voice transcript
and agent response identify a missing host, and the requested fixture did not
exist. The isolated build had included only `codex-cli`, omitting its required
`codex-code-mode-host` companion. This is a reference setup failure, not a native
xcsh interoperability result.

The companion was built from the same pinned source using the Codex-published
V8 archive and bindings, with both checksums verified as required by upstream's
`setup-rusty-v8` action. No tool mode or sandbox setting was relaxed. After the
call closed and both threads were idle, the reference host was restarted to
clear cached tool availability. A typed task in Reference Beta then created
`reference-tool-preflight.txt` containing `REFERENCE-TOOLS-READY` and a newline,
and read it back through a command tool. The file-change item completed, the
command completed with exit code zero, the turn completed, and disk contents
matched exactly. This is tool preflight evidence; successful phone delegation
still requires a new recording and Robin's observation.

The original phone recording was finalized with 3846 events and a complete
footer, with no producer-failure sentinel. It retains the failed attempt. The
typed preflight ran outside that capture.

## Successful reference voice delegation

Robin repeated the requested file task in Reference Beta and confirmed that voice
created the file and read its contents aloud. Independent disk verification found
exactly `REFERENCE-HARBOR` followed by a newline in `reference-voice-check.txt`.
The capture records one delegation, five commentary context appends, five
speakable context appends, and ten matching acknowledgements. Some tool-item
type literals were redacted; their original values are not reconstructed.

Robin tapped End; the normal close event arrived before the isolated reference
host and recorder were stopped. The finalized capture has 2108 events, a complete
footer, and no producer-failure sentinel. Its derived fixture selects the phone
relay client and preserves 92 voice protocol events plus the 21 delegation
sideband events, with the full capture SHA-256. The host observed `started` at
1063.6 ms and delegation at 17958.9 ms after the start request. The full call was
149474 ms, including the time waiting for manual closure; these are not audio
latency measurements.

The fixture is `../../test/remote-control/fixtures/codex-0.153.4-phone-delegation.json`.
Replay exposed the missing native `thread/realtime/itemAdded` handoff notification.
The implementation now includes the delegation and item identities, spoken input,
and consumed active transcript. It appends missing handoff input without repeating
an existing transcript entry and emits only once for a repeated delegation.
Legacy v1 handoffs retain distinct handoff and item IDs. The recorded method
sequence now passes with synthetic speech; the original private strings remain
redacted. Additional regression tests cover the handoff payload and duplicates.
Future recordings retain the pinned tool-item types and routing target while
continuing to redact private contents. The matching native phone capture below
verifies the file task; output streaming still differs.

## Matching native phone capture

Robin performed the identical file task in xcsh Remote Beta and confirmed the
spoken answer `REFERENCE-HARBOR`. The native file contains exactly that marker
(16 bytes); Codex added a newline (17 bytes). The spoken instruction did not
require a newline. The work models were preserved: reference Sol and native
Astra. This is a task/protocol comparison, not a controlled same-model benchmark.

The native call emitted one delegation, one speakable result, one acknowledgement,
and a normal close event. Its finalized host trace has 937 events; its voice
trace has 79. Both completion boundaries and contiguous event sequences were
verified. Selecting the phone client yields 87 voice protocol events, including
one handoff item notification. There are three completed speech transcripts
(user, assistant, assistant), compared with two in the reference. The live
recordings therefore have different transcript and chunk counts. Host-observed
start notification arrived at 681.9 ms; the call lasted 42361 ms. The duration
includes manual interaction, and neither value measures first audible audio.

The derived native fixture is
`../../test/remote-control/fixtures/xcsh-1883d1b67-phone-delegation.json`; the
inventory and semantic review are in `phone-delegation-comparison.json` beside
it. Both retain source-capture SHA-256 values. Strict event comparison is not
equal and requires semantic review: speech chunking, timestamp values, old
reference redactions, and the observed extra assistant segment differ. The
commentary/speakable streaming difference remains implementation work. No
complete feature-parity claim is made.

After capture finalization, the normal native host was restored. Both dedicated
terminal sessions remain connected with their existing models and histories.
Validation: 162 focused tests / 610 assertions; guarded full package suite 7400
passes, 561 skips, zero failures / 22882 assertions across 736 files in 321.88
seconds. Workspace formatting and TypeScript checks, staged PII, and the repair
commit's secret scan passed.

Completed terminal-initiated replies now use the pinned standalone handoff path,
while delegated streaming keeps one output owner. App input requests also mirror
the core request_user_input event with the pinned instruction to answer in the
app. Local adapter/transport tests cover these paths and preserve client-managed
suppression, routing and output budgets. Dedicated execution/patch/permission
request protocols and live input/approval acceptance remain open.

Native commandExecution/fileChange items now participate in ordinary pending-input
discovery alongside dynamicToolCall items. Real-session tests preserve one
execution and answer owner across reattachment, decline and question cancellation;
completed-plan provenance remains separately checked. All three item kinds feed
the voice mirror. No additional phone decision acceptance is claimed.

The v1 audio boundary now retains sample counts and follows the pinned unsigned
metadata bounds and fallback rules. Thirty-eight cases executed through the
original Rust parser bodies matched xcsh; local NativeVoice tests also verify
forwarding without storing audio or executing work, and ignore late frames.
V3 continues to use its fixed audio metadata. Standalone live acceptance and the
remaining capture/acceptance matrix remain open.

## Standalone WebSocket source contract

Standalone voice uses API-key authentication and defaults to realtime v2. Explicit
v1 and v3 select their pinned URLs, models, voices, alpha headers and session
shapes. V3 waits for the first recognized `session.updated` event; a different
recognized event or transport closure fails startup. App Server audio is forwarded
with the version-specific input event and never persisted.

The v2 parser covers transcripts, background-agent and silence function calls,
response lifecycle, speech-start interruption and audio item metadata. Native
output matches the pinned `[USER]`/`[BACKEND]` framing, completion and steering
acknowledgements, response-create queue and item truncation duration. A steering
call enters the same active AgentSession without replacing its output owner.

Sixteen focused standalone cases pass with 72 assertions, and all 370 voice tests
pass with 1592 assertions. The 64-file remote-control suite passes 864 tests with
3344 assertions. The guarded package run passes 8251 tests with 561 skips, zero
failures and 29599 assertions across 790 files. These are local source-contract checks. A live service
connection, iPhone behavior, standalone reconnection, full v1/v3 standalone event
matrices and release-artifact verification remain unproven.

## Command and file approval parity

Live command and file items now emit `item/commandExecution/requestApproval` and
`item/fileChange/requestApproval` with 0.153.4-compatible fields. Responses map
to the single terminal interaction owner, and `cancel` also interrupts the active
turn. Reattachment replays the same pending request without executing the tool a
second time. The emitted requests and accepted responses validate against four
pinned schema documents.

xcsh advertises only `accept`, `decline` and `cancel` for command approvals.
`acceptForSession`, exec-policy amendments and network-policy amendments remain
unsupported because the native runtime has no equivalent persistent approval
state. Dedicated permission-profile requests and MCP elicitations also remain
open. No phone approval acceptance is inferred from the automated coverage.

## Relay recovery source parity

The v3 relay codec now matches the pinned acknowledgement ordering for plain and
chunked server envelopes, including partial chunk replay. Repeated initialization
is forwarded to the connection tracker, closed streams may restart sequence
numbers, and delivery cursors survive acknowledgement and closure events.

Pinned segment-reassembly behavior is also covered for duplicates, stale chunks,
newer assemblies, bad base64, metadata mismatch, ordering faults and clean replay.
Recoverable chunk faults are dropped without closing the host relay connection.
The xcsh byte and assembly limits remain intentionally smaller and are documented
as a resource boundary. These are source-contract and local host tests; an abrupt
packaged reconnect and a new live phone recovery trace are not yet claimed.

The final local evidence is 16 focused relay/host tests with 89 assertions and
877 remote-control tests with 3459 assertions. The guarded package run completed
before the final two parser guards with 8264 passes, 561 skips and 29711
assertions. Their focused and complete remote-control matrices were rerun
afterward. All runs completed with zero failures.

## Host reconnect parity

The host transport now closes an errored WebSocket and reconnects with the last
delivered cursor. Unacknowledged responses replay on the replacement connection;
acknowledged responses do not. Socket-generation guards prevent late callbacks
from an old connection from closing or mutating the active connection. A routed
turn remains owned by one terminal executor through consecutive relay losses.

This local host matrix passed 17 tests with 101 assertions, and the complete
remote-control suite passed 878 tests with 3471 assertions. It is transport-level
coverage with a real local owner and mocked remote WebSockets. Abrupt loss of a
packaged host process and a fresh service trace remain separate acceptance work.

## Abrupt host and rejected-token recovery

The host now refreshes its enrollment token after a WebSocket transport error
before reconnecting. This supplies the recovery path for a service-rejected token
when the Bun client does not expose the upgrade's HTTP status. The existing
selected-subscription refresh fence, account match, cursor and replay state remain
in force.

Compiled-process recovery now covers the Unix-socket residue left by SIGKILL. The
replacement host probes for a live owner and removes only a current-user socket
that does not answer. In a network-disabled, Codex-absent Ubuntu container, a real
terminal turn remained active across host SIGKILL, finished its write/read tools,
and returned the same turn on stable retry without a second history entry.

All nine packaged checks passed in 20.566 seconds. The current remote-control
suite passed 880 tests with 3494 assertions. The recorded artifact uses synthetic
enrollment; a service-side revoked-token exercise and final phone acceptance are
still required.
