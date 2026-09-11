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

The finalized phone capture also requests the experimental collaboration-mode
catalog. Its two rows preserve the pinned Plan-then-Default order, nullable model
and reasoning mask fields, and captured medium Plan effort. The recorder redacted
the mode names and literals; the fixture fills those four strings from the pinned
builtin-preset source, with matching byte lengths and order. Native routing
requires the requesting connection's experimental capability and returns this
catalog exactly. `thread/settings/update` and `turn/start` now carry Plan/Default
selection into the existing InteractiveMode entry and exit lifecycle. Repeated
selections are idempotent; Plan retains its tool, persisted-mode, status and plan
model semantics, while Default restores them. Validation rejects non-experimental,
malformed, custom-instruction and incompatible-model requests before changing
mode, effort or starting a prompt. Router, session, bridge and real InteractiveMode
tests cover this path. These are automated results, not phone acceptance.

The same phone initialization advertises 56 exact notification-method opt-outs.
Those method strings remain redacted in the sanitized recording, so they are not
reconstructed. Native initialization now validates the pinned capability shape,
stores opt-outs per relay stream, and suppresses an event only when its complete
method name matches. Unknown names are accepted and ignored, a second initialize
on the same stream is rejected, and disconnect removes the stream's filter.
Router tests first reproduced cross-client over-delivery, then verified that an
opted-out client stays quiet while another subscriber receives the same event.
This is source-contract and replay-metadata evidence; the complete experimental
method and field audit remains open.

The captured experimental `thread/list` and `thread/resume` responses establish
the full Thread field order. Native list, read and resume responses now pass
through one allowlisted projection: stable clients omit `extra` and
`canAcceptDirectInput`; experimental list summaries return both as `null`, while
attached read and resume responses report direct input as `true`. The projection
preserves requested turns and response wrapper fields without mutating the live
session descriptor. Exact-key tests cover stable and experimental clients, reject
future private fields, and prove that internal reasoning metadata remains
available to `model/list`. The router audit found no other supported full-Thread
response or notification; unsupported lifecycle methods remain protocol errors.
Actual read and resume results validate against byte-identical pinned schemas.
This is automated evidence only and adds no phone acceptance.

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
session. A forked terminal reports the persisted source session through canonical
`forkedFromId`; file-based branch ancestry remains distinct and does not populate
that field. Local socket tests verify that the old owner disappears and the new
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
| Discovery and history | Phone registers skill roots, receives `skills/changed`, lists the selected cwd's skills, and reads one skill as base64 | Native responses match pinned schemas and expose each live terminal's actual loaded catalog; owner-side reads are limited to advertised skill files and 1 MiB. Final phone catalog and broader history acceptance remain pending |
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

All nine packaged checks passed in 20.723 seconds. The clean compiled binary is
bound to source commit `62def29d6`. The current remote-control suite passed 880
tests with 3494 assertions. The recorded artifact uses synthetic
enrollment; a service-side revoked-token exercise and final phone acceptance are
still required.

## Clean live-runtime handoff

The live xcsh relay now runs the clean `62def29d6` executable used by the packaged
crash test. A controlled host replacement preserved both accepted Alpha/Beta
thread identities, names, directories, histories and selected Luna/Astra work
models. The replacement relay connected before the audit completed.

The same artifact also exposes new Sol and Terra top-level sessions. Both models
completed ordinary write/read tool calls, and independent byte checks matched
their requested marker plus newline. This verifies live model selection and tool
execution before phone testing; it does not count as phone voice acceptance or a
new reference/native wire comparison.

## Thread-name mutation parity

The native host now implements the pinned `thread/name/set` request and empty
response. It trims the requested name, rejects an empty result, persists the
user-selected terminal name, refreshes discovery metadata, and broadcasts
`thread/name/updated` to every initialized client as the reference WebSocket test
does. Reload and resume retain the name. The request, response and notification
all validate against unchanged pinned schemas. This is automated source-contract
coverage; no new phone rename observation is claimed.

The packaged red run against the previous clean artifact failed with `-32601`.
The clean `9fb146da9` artifact passed the new live-TUI rename check and the other
nine isolated checks, including host restart and compiled resume. Its receipt is
`../scripts/remote-package/evidence-rename-2026-09-10.json`; this remains offline
integration evidence rather than a phone observation.

## Current clean phone artifact

The guarded coding-agent package suite now passes 8271 tests with 561 skips,
29762 assertions and zero failures across 791 files. A clean `4a399d39` binary
then passed the full ten-check Codex-absent container harness in 20.399 seconds;
its SHA-256 is
`d1cc71b2f8671dc3894bf7666387a7fb1d187fc76d8cec866cf6e2c976dc4da8`.
The receipt is
`../scripts/remote-package/evidence-final-head-2026-09-10.json`.

That exact binary now owns the live relay and the four acceptance terminals. The
post-restart protocol audit found the same stable IDs, working directories,
histories and Luna/Astra/Sol/Terra selections, all idle, with the relay connected.
The two early routing-fixture names were normalized to `xcsh Remote Luna` and
`xcsh Remote Astra`, making all four live names correspond to their work models.
Fresh phone voice observations and wire comparison remain pending Robin's report.

The local typed gate also uses the model-aligned names now. A red run showed its
old full-response comparison was incompatible with normal streaming because the
same in-progress turn gained an item between retry reads. The corrected gate
compares stable turn identity and final history cardinality. Luna and Astra each
returned their distinct session marker, in 2.804 and 2.570 seconds, with both
retry forms selecting the original turn and no duplicate history entry.

## Terminal-restart request replay

Client-message identities for starts and steering are now recorded durably before
execution, together with the owning turn, method and canonical request hash.
After adapter or process restart, an identical retry returns the existing turn;
changed input is rejected, and a previously failed steering request remains
failed. Completed pre-ledger sessions recover the same behavior from persisted
user-message provenance.

The first unit and compiled runs both demonstrated the previous duplicate: the
same request after restart received a new turn ID. The corrected history suite
passes 29 tests, the complete remote suite passes 889 tests, and a clean
`fe1de706` package passed all ten isolated checks. Its real TUI exit/resume test
replayed a completed write/read request with the original turn ID, one history
entry and no second tool execution. Receipt:
`../scripts/remote-package/evidence-terminal-retry-2026-09-10.json`; binary
SHA-256:
`837e95eccac3b792fc5bd2b2d9051b6b3a2cbce95f496fdc979b36cf310340cf`.

## Persisted visible-item and active-stream parity

Native selected-branch history now has a bounded projection for every visible
AgentSession message role: ordinary user/assistant/tool items, developer and
displayed custom/legacy-hook prompts, user shell and Python executions, file
mentions, media, branch summaries and compaction boundaries. Private file
contents, compaction summaries, custom details, hidden messages and duplicate
`async-result` presentation records do not cross the wire.

The command, hook and structural shapes use the pinned 0.153.4 item contracts
already recorded in `NOTICE.md`. xcsh-specific identity metadata continues to be
stored beside, rather than inside, provider-visible messages. Custom and legacy
hook timestamps are preserved through the live-to-durable transition so a reload
selects the same item identity.

Attaching while the provider is still streaming now exposes the existing partial
assistant text and active command/file progress immediately. Completion reuses the
same IDs in notifications and durable history. The regression proves one live
item per projection and no duplicate executor; it does not reproduce a private
phone capture or establish a new manual observation.

Automated evidence: 32 durable-history tests / 146 assertions, 68 adjacent
history/session/bridge tests / 343 assertions, and 897 complete remote-control
tests / 3647 assertions, all with zero failures. The guarded coding-agent suite
passes 8285 tests with 561 skips, zero failures and 29912 assertions across 791
files. Workspace TypeScript/Biome, lint, documentation, provenance and staged
privacy/secret checks also pass. Phone history, fork, catalog and mid-stream
presentation remain separate manual acceptance work.

## Permission-profile discovery and interaction applicability

The pinned client method `permissionProfile/list` is now supported for stable and
experimental clients. Because xcsh has no Codex permission-profile selection or
policy stack, its truthful catalog is empty and paginates as `{ data: [],
nextCursor: null }`. It validates the pinned cursor, unsigned limit and cwd input
types before touching a session. The request and response fixtures are unchanged
copies of the 0.153.4 schemas.

Dedicated permission grants are not interchangeable with xcsh's existing
command/file approval choices: there is no native grant cache, scope, or
additional-filesystem/network policy to mutate. Likewise, xcsh's MCP 2025-03-26
client does not negotiate elicitation and rejects server requests other than
`ping` and `roots/list`. Pending `item/permissions/requestApproval` and
`mcpServer/elicitation/request` envelopes are therefore rejected explicitly
before registration. No synthetic approval is presented as product support.

Focused automated evidence is 23 passing tests and 168 assertions under Bun
1.4.2. The complete remote-control suite passes 899 tests with 3659 assertions
across 65 files, and the guarded coding-agent suite passes 8305 tests with 561
skips, zero failures and 29976 assertions across 795 files in 411.28 seconds. A
phone observation of the empty permission catalog remains separate; there is no
applicable MCP elicitation flow in the current terminal runtime.

## Current-head package and live bootstrap

The clean `b3953eecc` executable, built with Bun 1.4.2, passed the complete
ten-check package-independence harness in 18.560 seconds. Its network-disabled
Ubuntu 24.04 container had no Codex, standalone Bun, source checkout or project
dependencies. The binary SHA-256 is
`3c9852d83b9b29679860a6e80d86a9b16c083f18909ea983398e5428e1ec402e`;
the committed receipt records the harness/provider hashes and container image.

The exact binary now owns a connected trace-bound live host and four idle resumed
sessions named `xcsh Remote Luna`, `xcsh Remote Astra`, `xcsh Remote Sol` and
`xcsh Remote Terra`. A local protocol audit verified their four expected models,
stable and experimental list/read field order, Plan/Default order, model-catalog
presence, pinned voice defaults and the empty permission-profile catalog. State
directory and host file/socket modes remain `0700` and `0600`. No new phone or
voice acceptance is inferred from these checks.

A concurrent current-build text preflight then exercised all four live owners.
Each model created and read its own distinct marker file, completed once, and
returned the same durable turn on an identical client-message retry. Luna, Astra,
Sol and Terra all passed in 19.920 seconds. The iPhone voice variants remain a
separate manual gate.

Disposable current-artifact sessions also passed live control checks. Steering
kept the original turn identity and produced the replacement result; interruption
persisted the active turn as interrupted and prevented its file write. A real
`ask` invocation emitted one request, accepted one remote answer, emitted one
resolution and completed with the expected marker. Plan entry was idempotent,
an invalid custom mode was rejected without mutation, and Default was restored
while preserving the terminal's actual provider-qualified work model. The
disposable sessions exited, leaving the four phone sessions unchanged. These
local-protocol observations do not claim iPhone presentation or input.

The same current artifact also passed a controlled live host replacement. The
first trace closed complete with 301 events; the replacement relay connected and
all four idle terminal owners re-registered with unchanged names, models,
histories and wire projections. Phone-side recovery remains unclaimed.

## Current iPhone history-load failure and cursor parity

Robin reported that Astra displayed `Error loading messages.` with `Retry`, and
that Terra, Sol and Luna also failed on the first current-artifact iPhone check.
This remains a failed manual observation until a newly packaged host passes the
same phone flow.

Native trace sequences 1412--1441 show the phone successfully resuming the
thread, listing turns, and then reusing the resume item cursor while requesting
items for each individual turn. Native code rejected every reuse as an invalid
history cursor because it scoped item cursors to the optional turn filter.
Pinned reference sequences 263--302 succeed with the same request pattern, and
the pinned `segment_paging.rs` source locates the cursor in the global item
sequence before applying its independent turn predicate.

Item cursors now match that reference behavior: they remain isolated by thread
and collection, are reusable across turn filters, and retain the pinned global
ordering and reverse-anchor semantics. The phone-shaped test was observed red,
then passed with the repair. Focused history evidence is 14 tests and 59
assertions; the expanded history/durable/router set is 56 tests and 293
assertions; the complete remote-control suite is 901 tests and 3665 assertions
across 65 files, all passing under Bun 1.4.2. The guarded package suite passed
8307 tests with 561 skips and 29981 assertions across 795 files in 376.95
seconds. This automated parity evidence does not substitute for Robin retrying
the repaired package.

## Four-session hydration and remote Plan model failure

Robin confirmed that Astra, Terra, Sol and Luna each display the correct session
header and previous messages after the cursor repair. The sanitized native trace
records four turn-list requests, fourteen per-turn item-list requests and zero
protocol errors. This closes the phone history-load failure, but not the remaining
fork, interaction, recovery or voice gates.

On the next checkpoint, Luna displayed Plan after selection but the exact no-tool
turn failed with `The scheduled model could not complete this turn. Check the
terminal for details.` The request carried the expected Plan override; terminal
history then showed that InteractiveMode had replaced `gpt-5.6-luna` with the
configured `anthropic/claude-opus-5` plan-role model. The existing protocol probe
had observed only reported thread metadata and therefore did not exercise this
provider call.

The repaired remote-only Plan path retains the attached work model and still
uses the real idempotent InteractiveMode lifecycle. Ordinary terminal Plan entry
continues to honor its configured plan role. A regression with deliberately
different work and plan models was red on the unwanted temporary model switch;
the focused three-file set now passes 35 tests and 236 assertions under Bun
1.4.2. No successful phone Plan turn is claimed until a new artifact is retried.

## Live stale-relay observation and credential rotation

During the next iPhone checkpoint, the Remote host selector showed the native
xcsh entry red with `Offline • Last seen 6 hours ago`. A separate reference
Codex `workstation` entry remained green. On Ubuntu, xcsh incorrectly reported
`relay: connected` with all four owners, and the TCP socket remained established,
but its sanitized trace had received no frame for more than five hours. This is
manual evidence of a service-stale, locally open WebSocket and a false-positive
status, not a lost pairing or lost terminal session.

A controlled restart of only the native host closed its old trace with a complete
4125-event footer, established a fresh initialized stream and answered the next
relay ping as active. Robin then confirmed that the xcsh entry was green and
Luna, Astra, Sol and Terra all reappeared. The paired iPhone identity and all four
session identities survived; the retained reference recorder and host were not
stopped.

The transport now rotates an apparently open relay socket after every successful
host-credential refresh. The replacement connection uses the refreshed token and
the existing delivery cursor/replay machinery, preventing an indefinitely stale
socket from continuing to report connected. The focused regression failed with
one socket before the repair and now passes two tests with 19 assertions. The
complete remote-control suite passes 902 tests with 3670 assertions under Bun
1.4.2. A fresh compiled artifact still has to prove this behavior across a real
credential rotation; the host restart observation alone does not claim that gate.

## iPhone Plan approval and replacement-thread discovery

Robin identified the labeled mode path as `+` then `Plan mode`; the earlier iOS
PhotosPicker authorization sheets came from the adjacent photo action and did
not exercise the protocol. With the Plan pill visible, Luna returned
`PLAN-LUNA-READY`. Removing the pill and resending the corrected Default prompt
returned `DEFAULT-LUNA-READY` exactly once, with the `gpt-5.6-luna` work model
retained.

The complete Plan review exposed all three expected choices: `Approve and
execute`, `Refine plan`, and `Stay in plan mode`. After Robin tapped approval,
the existing owner executed the reviewed plan once and created the 18-byte
`LUNA-PLAN-ACCEPTED` target. The phone stayed on the closed source thread instead
of navigating to the replacement execution thread. Returning to discovery
showed `New chat` under `alpha`; host status found the new Luna thread
`157b779de9ee4d80` with model `gpt-5.6-luna` and `name:null`. Robin also reported
the visible `alpha` and `beta` labels as a regression from Luna/Astra naming.

The missing title came from execution-session creation resetting session name
metadata. The repaired handoff copies the sanitized source title and source into
the new session header. A genuinely new registration now emits exactly one
capability-projected `thread/started`, while heartbeat registrations emit none
and explicit notification opt-outs remain effective. The focused six-file set
passes 48 tests with 347 assertions; the complete remote-control suite passes
904 tests with 3679 assertions under Bun 1.4.2. The guarded coding-agent suite
passes 8310 tests with 561 skips and 30001 assertions across 795 files. This is
automated repair evidence only; the phone naming and navigation result awaits a
rebuilt runtime.

A later controlled Luna attempt used the exact Plan request for
`plan-discovery-luna.txt`. Robin saw all three actions and tapped `Approve and
execute` once, but the phone then showed `Exit plan mode`, retained the Plan pill
on a blank composer and did not visibly move to or stream from the implementation
thread. Disk inspection proves the terminal still performed one requested write:
the file contains exactly `LUNA-DISCOVERY-REPAIRED`, 23 bytes with no trailing
newline. The `alpha` and `beta` labels were working-directory groups rather than
regressed model-session names.

The owner-only sanitized trace orders the approval response, request resolution,
source `thread/closed` and replacement `thread/started` at sequences 1266, 1268,
1270 and 1272. The replacement advertised the expected Luna model and `xcsh
Remote Luna` name, but `forkedFromId` and `parentThreadId` were both null. The
automated repair adds a distinct persisted `forkedFromId` carrying the approved
source session ID, preserves `parentSession` as file ancestry, and projects the
validated explicit ID before the existing safe fallback; `parentThreadId`
remains null. The test first failed on the null wire lineage, then the Plan review
file passed 21 tests with 167 assertions and the seven-file affected matrix passed
62 tests with 417 assertions under Bun 1.4.2. This does not establish iPhone
navigation, Plan-pill clearing or visible implementation streaming. The current
complete remote-control suite also passes 904 tests with 3679 assertions, and the
guarded coding-agent suite passes 8310 tests with 561 skips and 30002 assertions
across 795 files.

The first lineage-enabled phone checkpoint used artifact `91353d9` and Luna
source `157b91c88d4750ea`. After Robin tapped `Approve and execute` exactly once,
the Plan pill cleared and `Exit plan mode` remained visible, but the phone
transcript showed no implementation activity. The terminal transitioned once to
`157ba16225238f97` and created
`plan-lineage-luna-91353d9-2f7c1.txt` with exactly the 26 bytes
`LUNA-LINEAGE-91353D9-2F7C1`, no trailing newline and SHA-256
`dc533173b26217f61e2a79dc211e5884ccb4686da448cf1eec16ca1240e64b71`.

Sanitized trace sequence 450 is the phone approval response, 453 is its
`serverRequest/resolved`, 455 closes the source on the same phone stream and 465
delivers the replacement there. The replacement now correctly projects the
source as `forkedFromId` and keeps `parentThreadId: null`; lineage therefore
passed while phone navigation did not. The trace and bridge lifecycle show that
the source was removed before the replacement announcement. A focused
regression reproduced that event order, then passed after the bridge retained a
temporarily non-callable source until the host atomically announced the forked
replacement and closed the source. The bridge, host, lifecycle and teardown set
passes 36 tests with 191 assertions. This is automated evidence only; a rebuilt
artifact and Robin-observed navigation remain required. The expanded nine-file
matrix passes 91 tests with 553 assertions, the complete 65-file remote-control
suite passes 904 tests with 3680 assertions, and the guarded coding-agent suite
passes 8310 tests with 561 skips and 30003 assertions across 795 files under Bun
1.4.2.

The next phone checkpoint used committed ordering artifact `e02bb0f` and source
`157ba16225238f97`. Robin approved once and observed the Plan pill clear, but no
implementation appeared in the transcript. The terminal created replacement
`157ba8d39989966c` once and wrote `plan-order-luna-e02bb0f-7a4d2.txt` as exactly
`LUNA-ORDER-E02BB0F-7A4D2` (24 bytes, no newline, SHA-256
`9625f96acf06063a2298863a35b50b9fd7f6a7e49e0d657e743283c0c25bb594`).
Its persisted header points `forkedFromId` to the source, retains file-backed
`parentSession`, and the remote Thread continues to expose
`parentThreadId: null`.

Sanitized trace sequence 300 carries the approval response, 302/303 resolve it,
305-312 announce the replacement before 313/314 close the source, and 318 is
the approving phone stream's acknowledgement. Ordering and lineage therefore
passed, but the router did not move that stream's subscription from source to
replacement, and the phone sent no second `thread/resume`; subsequent execution
events had no eligible phone subscriber. A bridge/host regression reproduced the
missing first replacement `turn/started` (24 pass, one fail, 135 assertions).
The repair migrates subscriptions only across a same-owner identity replacement,
before `thread/started`, while unrelated new registrations and historical forks
remain unsubscribed. The repaired lifecycle file passes 25 tests with 135
assertions and the four-file focused matrix passes 50 tests with 297 assertions
under Bun 1.4.2. The seven-file Plan matrix passes 82 tests with 500 assertions,
the complete remote-control suite passes 904 tests with 3680 assertions, and the
guarded package suite passes 8310 tests with 561 skips and 30003 assertions
across 795 files. This is automated evidence only; visible phone streaming still
requires a rebuilt artifact and controlled retry.
