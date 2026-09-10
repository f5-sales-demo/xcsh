# Observed native remote parity

Reference: instrumented Codex 0.153.4, source commit
`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`. Native implementation and reference
recordings are separate processes and enrollments. This is an evidence matrix,
not a declaration of complete feature parity.

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
