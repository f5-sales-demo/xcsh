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

| Behavior | Reference observation | Native evidence or remaining difference |
| --- | --- | --- |
| Voice recall and routing | Two correct saved voice answers in distinct threads | Earlier native phone recall worked; a matching new native capture is pending |
| Session and transcript items | Started/completed item pairs and per-item transcript deltas surround legacy voice notifications | Missing behavior implemented; replay of both recorded notification sequences passes with synthetic speech and pinned item schemas |
| Durable speech boundaries | Start, user segment, assistant segment, close in canonical timeline | Stored as voice provenance records; exposing the complete mixed canonical timeline through `thread/timeline/list` remains pending |
| Separate subscribers | Identical notifications can be sent to multiple relay clients | Comparison selects the phone client from relay envelopes; it does not deduplicate legitimate deliveries within that client |
| Shutdown | Both calls closed with reason `requested` | Closure waits for accepted history writes; tests cover partial speech, repeated closure, late events, and cancellation during startup flush |
| Work delegation | No delegation during the two recall calls | Dedicated reference file creation/read-back conversation requested; comparison is pending |
| Discovery and history | Phone requests included skills roots/listing and file reads | These include unsupported native operations; repair and corresponding reference fixtures remain pending |
| Protocol metadata | Initial recorder redacted some valid method and item-type names | Future recordings retain pinned method literals and canonical item types; the original redactions are not reconstructed |
| Network recovery | Reference airplane-mode conversation not yet recorded | Native fresh-call recovery is accepted after complete network loss; identical behavior is not established |
| Complete protocol coverage | Captured relay text, decoded RPC and realtime JSON | HTTP handshakes, every WebSocket control frame, direct phone media, all model variants and remaining transports are not fully covered |

The recorded fixture is
`../../test/remote-control/fixtures/codex-0.153.4-phone-recall.json`.
Private speech is replaced only in replay input. The observed notification order
and schema validation are independent assertions; they do not prove identical
spoken semantics, latency, or the remaining untested workflows.
