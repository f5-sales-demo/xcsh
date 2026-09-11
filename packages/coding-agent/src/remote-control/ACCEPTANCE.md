# Native remote completion audit

Issue #3818; objective: native, independently paired xcsh terminal sessions in
ChatGPT text and Remote Voice, with the existing agent remaining the sole writer.
This audit preserves the full user objective. Passing one row does not imply
completion of another. Codex baseline: 0.153.4,
`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`.

| Requirement | Current evidence | Remaining completion evidence |
| --- | --- | --- |
| Own enrollment and pairing | Robin paired xcsh; live relay and two terminal sessions verified | Retain passing enrollment/pairing regression coverage through release |
| Enable, disable, status, pair, clients, revoke; JSON and `/remote` | Command implementation and focused tests exist; isolated CLI executes every action and validates default-off/error behavior; packaged default-off status, live enable/pair and terminal status passed; the clean `fe1de706` artifact listed one paired iOS phone with no pagination cursor while preserving the client identifier outside repository evidence | Final live revocation/expiry recovery acceptance |
| Private per-user host and state; default off | Fresh isolated CLI and package checks report disabled by default; host startup rejects a live owner and safely reclaims only a dead current-user socket; on the current `b3953eecc` artifact the live state directory is owner `0700`, and the state file plus Unix socket are owner `0600`; private capture checks pass | Inspect final error/log surfaces |
| Discover every live top-level terminal, exclude subagents | Two dedicated terminals routed correctly; 128 owner sockets discovered; a last-page selection routes once; heartbeat test removes stale owners and retains refreshed owners; source-path audit confirms only `InteractiveMode` starts the bridge while task subagents create headless `AgentSession` instances through the executor; with one real `quick_task` subagent active, discovery contained only the four model sessions and its temporary top-level owner, then returned to exactly four after that terminal exited | Confirm the final four-session list on the phone |
| Preserve session identity, name, cwd, history and work model | The original Alpha/Beta fixtures retained their exact IDs, names, cwd, message counts and Luna/Astra models through a controlled handoff; the current artifact then renamed them consistently to `xcsh Remote Luna` and `xcsh Remote Astra` through the pinned protocol without changing their identities or histories; four-model lifecycle SDK tests preserve identity/history/model; stale lifecycle/configuration callbacks reject or retire; disposal settles work before storage closes; compiled extension-model resume passes. Robin's approved Luna Plan created replacement thread `157b779de9ee4d80`, but the old artifact registered it with `name:null`; a red-to-green repair now copies the sanitized source title and announces the replacement thread once | Rebuild and confirm on the phone that Plan approval retains the visible `xcsh Remote Luna` chat; the reported `alpha`/`beta` labels remain failed manual evidence until that retry |
| One executor and persistence owner | RemoteSession uses existing AgentSession; duplicate delegation tests; live file tasks; accepted start/steer identities and signature hashes persist before execution; retries recover the same turn across failed switches, host loss, adapter recreation and complete compiled TUI restart; pre-ledger history also deduplicates completed client messages; the current `b3953eecc` artifact concurrently routed one real write/read task to each of the four work-model owners and returned each original turn on retry without a duplicate history entry | Concurrent terminal/phone controls and manual confirmation of no duplicate tools |
| Canonical complete history and pagination | Persisted branch/timeline; command/cancellation facts; native write/edit diffs and formatter settlement; core provenance restores completed work; all visible persisted message roles have bounded projections while private compaction/file/custom details remain excluded; joining during active model or tool streaming restores partial text/progress with the durable identities; terminal forks expose their persisted source session as canonical `forkedFromId` while file-based branch ancestry remains distinct; the recorded experimental collaboration-mode catalog now matches the pinned Plan/Default order and nullable fields and rejects non-capable clients; both settings updates and turn starts now apply Plan/Default through idempotent InteractiveMode entry/exit semantics after validating the complete override; a current-artifact live probe entered Plan twice, rejected a custom mode without mutation and restored Default while preserving the actual provider-qualified work model; initialize now applies exact per-client notification opt-outs from the pinned request schema, matching the captured phone capability count; stable and experimental list/read/resume Thread projections now preserve the recorded order, gate the two experimental fields, exclude future private fields and validate actual results against pinned schemas while keeping internal model metadata; the reference skill-root/list/read bootstrap is implemented with pinned response schemas, actual live-session catalogs and owner-confined file reads; the clean compiled `157855114` host accepted the observed nine-root shape and listed/read one real TUI skill with zero errors | Phone history/catalog/fork and mid-stream presentation acceptance |
| Typed prompts and streamed turns | Alpha/Beta manual routing; the normalized Luna/Astra live gate returned each distinct marker in 2.804/2.570 seconds and proved retry IDs select one advancing turn with one history entry; real AgentSession tool execution matches live completed items and persisted history; text phases, active model/tool attachment, tool completion and late-promise race tests pass with stable live-to-durable identities | Concurrent terminal/phone control and final live schema-level history acceptance |
| Steering, interruption and explicit task cancellation | API implementations; spoken-output interruption manually passed; accepted steering/control effects settle on old storage before a terminal switch; current-artifact live protocol checks steered a real Sol turn without changing its turn ID and observed the replacement marker, then interrupted a separate turn, which persisted as `interrupted` without creating its delayed fixture file | Repeat steer and explicit task cancellation from the iPhone; retain remaining cross-interface race/retry coverage |
| Questions and approvals in both interfaces | Native command/file/general-tool prompts share the broker before/after reattachment; command/file requests use pinned approval methods and schemas; phone/terminal accept, decline, turn-cancelling responses, question cancellation and late-answer tests pass; voice mirrors all three item kinds; Robin's Luna iPhone run displayed `Approve and execute`, `Refine plan`, and `Stay in plan mode`; tapping approval executed the reviewed plan once and created the exact 18-byte `LUNA-PLAN-ACCEPTED` fixture, but the phone remained on the closed source thread; `permissionProfile/list` returns the schema-valid empty catalog because xcsh has no selectable profile layer; unowned permission-grant and MCP-elicitation envelopes are rejected before registration, and MCP elicitation is not applicable to the terminal's negotiated 2025-03-26 runtime | Confirm the repaired replacement-thread navigation/name on iPhone, then complete grouped questions, command/file approvals, empty permission-catalog presentation and remaining concurrent control/retry acceptance |
| Native realtime transports | WebRTC v1/v3 and existing-call paths; v1 default/session/handoff source-contract tests; actual iPhone v3 voice; 38 original Rust audio-parser cases and end-to-end forwarding tests match | Live v1, standalone WebSocket/v2, remaining supported options and explicit errors for deferred operations |
| Initial context, speech boundaries and transcripts | Recorded timeline/replay state; turn-scoped mode, default/empty instructions and retained-context recovery match the pinned snapshot; real tool/pruning/resume/identity tests pass; shared voice owner and stored speech boundaries verified | Final live mode/context/history acceptance; live promotion and remaining recovery matrix |
| Delegation and speakable output | Reference and native both created/read fixture; v3 streaming, completed v1 and response-item output pass 32 four-model adapter variants; shared timeline and bounded delegation match pinned Rust fixtures | Fresh live streaming/item-mode capture, remaining cancellation and live canonical timeline acceptance |
| Keep reasoning/tool internals out of speech | Text-only extraction and reasoning exclusion tests cover all four adapters in delegation/item modes; BEM header and prefix routing tests pass | Final live routing-mode acceptance and remaining malformed input coverage |
| Deliberate pauses and spoken interruption | Robin confirmed waiting through pauses and stopping mid-count | Preserve behavior in final live acceptance |
| Voice closure preserves agent work | Unit lifecycle checks and normal manual closure | Live voice end during ongoing work, then verify completion/history |
| Phone background/foreground and complete network loss | Manual background/foreground and fresh voice recovery passed | Final regression with no duplicate work; automatic recovery after complete loss is explicitly waived |
| Host restart and surviving terminal reconnection | Local socket restart keeps a real AgentSession/tool running; EOF repair restores registration; compiled SIGKILL recovery reclaims the owned stale socket, reattaches both terminals, completes active work and deduplicates retry; the clean `b3953eecc` binary passed normal and SIGKILL package recovery, then started a connected trace-bound live host with all four model sessions intact; during current phone acceptance a native relay socket remained locally `OPEN` while the iPhone showed xcsh offline for six hours, and restarting only that host immediately restored a green xcsh entry plus all four named sessions; the new regression requires successful credential refresh to rotate such a socket | Rebuild and retain the restored phone result through final acceptance |
| Selected ChatGPT subscription and refresh | Own subscription enrollment/voice worked; selected-row auth recovery tests; relay errors force enrollment-token refresh before reconnect; standalone voice resolves only non-OAuth `openai` API-key sources and its transport test confirms subscription auth is unused | Live standalone voice plus expired/revoked subscription and enrollment recovery |
| Relay acknowledgements, chunking, replay and bounds | Codec covers duplicate/reordered chunks, stale/newer assemblies, invalid chunk recovery, oldest-assembly eviction, exact partial/plain acknowledgements, reconnect initialization, closed-stream sequence reset, cursor retention and bounded buffers; host transport reconnect covers error recovery, credential refresh, cursor headers, replay, acknowledgement and stale socket isolation; a red-to-green regression now rotates the relay connection after each successful credential refresh so a locally open but service-stale socket cannot continue reporting a false connected state; pinned transport sources and 148 upstream reference tests provide the baseline | Prove the repaired compiled host remains visible across live credential rotation |
| Credentials/raw audio absent from diagnostics | Private sanitized capture, PII and commit secret scans; audio forwarding tests confirm frames are absent from stored records | Inspect final packaging/logging/error surfaces; raw phone media is not captured |
| Sol, Luna, Terra and Astra fidelity | Parameterized adapter tests; the current clean `b3953eecc` live runtime exposes four distinct Luna/Astra/Sol/Terra sessions with preserved IDs, names, directories and histories; all four concurrently completed distinct real write/read tool tasks in 19.920 seconds with exact file bytes and exactly-once request replay; isolated model-registry SDK tests preserve all four identities on resume | Final phone voice task in each clean-build session; no model replacement by voice component |
| No Codex installation or subprocess dependency | The current `b3953eecc` artifact and two real TUIs pass ten isolated Ubuntu checks without Codex, standalone Bun or source dependencies; real file tools, remote rename, clean and SIGKILL host recovery, active-work continuation, host replay, compiled resume and durable terminal-restart replay verified | Preserve this check after final upstream reconciliation; live subscription/voice evidence remains separate |
| Actual Codex reference recordings and comparison | Two recall calls and successful reference/native file calls; hashed sanitized fixtures | Repair remaining differences; further control/recovery/interaction scenarios and explicit unverified coverage |
| TDD and repository checks | Recorded red-to-green work; the replacement-thread repair passes the guarded package suite with 8310 tests, 561 skips, 30001 assertions and zero failures across 795 files, plus 904 remote tests with 3679 expectations under Bun 1.4.2; workspace TypeScript/Biome, docs quality, changed-scope PII, diff gitleaks and whitespace checks pass, while the prior bundle and enhanced ten-check compiled artifact pass remain recorded; the branch-added audit finding was removed, and all 24 pinned source hashes verified | Rebuild and rerun the package-independence artifact gate. The unchanged repository baseline has 218 HEAD enforcement findings across 13 files |
| Manual acceptance only on Robin's report | Specific observations recorded in PARITY.md and issue comments | Obtain remaining manual checkpoints without treating simulated tests as phone acceptance |
| Issue, PR, review, merge and cleanup | Detailed issue, feature worktree, pushed commits | Completed linked PR, review/CI repair loop, authorized squash merge, confirmed-merged cleanup |

## Current manual checkpoint

Robin's first current-artifact iPhone attempt failed before message hydration in
all four canonical sessions. Astra displayed `Error loading messages.` with a
`Retry` action; Terra, Sol and Luna also failed. After the item-cursor repair and
host replacement, Robin confirmed the correct header and prior messages in all
four sessions; the trace recorded four turn lists and fourteen per-turn item
lists with zero protocol errors.

The next Luna checkpoint displayed Plan but its no-tool turn failed with `The
scheduled model could not complete this turn. Check the terminal for details.`
Terminal history showed an unintended switch from Luna to the configured
Anthropic plan-role model. A red-to-green regression now makes remote Plan entry
preserve the attached work model while retaining the real InteractiveMode
lifecycle. Rebuild and repeat Plan/Default on the iPhone before claiming that
row; the failed turn remains part of the manual evidence.

The apparent PhotosPicker miswire was resolved when Robin identified the actual
mode control as `+` then `Plan mode`; the passcode sheets came from the adjacent
photo action and no collaboration-mode request reached the host for those taps.
Using the labeled Plan action displayed the pill and preserved Luna. The no-tool
prompt returned `PLAN-LUNA-READY`; removing the pill and correcting an initial
mistyped Default prompt returned `DEFAULT-LUNA-READY` exactly once.

A complete Plan then displayed `Approve and execute`, `Refine plan`, and `Stay in
plan mode`. Robin tapped `Approve and execute`; the host created
`/tmp/xcsh-3818-acceptance/alpha/plan-acceptance-luna.txt` with exactly
`LUNA-PLAN-ACCEPTED` (18 bytes), proving one execution. The phone nevertheless
remained on the now-closed Plan thread instead of navigating to the replacement
execution thread. Discovery showed `New chat` under `alpha`; the host reported
new Luna thread `157b779de9ee4d80`, model `gpt-5.6-luna`, with `name:null`.
Robin also reported the visible `alpha` and `beta` labels as a regression from
the expected Luna/Astra naming. The live processes still use the historical
`alpha` and `beta` working directories, while the independently persisted chat
names are `xcsh Remote Luna` and `xcsh Remote Astra`. Do not claim the visible
naming regression fixed until Robin verifies a repaired artifact.

The repair carries the source thread's sanitized title and title source into the
approved execution session and emits one capability-projected `thread/started`
notification for a genuinely new registration. Heartbeat re-registration does
not repeat it and notification opt-outs remain honored. Focused coverage passes
48 tests with 347 assertions; the complete remote-control suite passes 904 tests
with 3679 assertions under Bun 1.4.2. A fresh binary and controlled iPhone retry
remain required.

## Accepted first-release boundaries

Ubuntu workstation and live terminal sessions; phone-created headless sessions
are deferred. Pairing is separate from the existing Codex host. Audio capture and
playback remain on the iPhone. Restarting voice after complete network loss is
accepted. Native enrollment and voice must work with xcsh's own identity and
credentials; a companion architecture is not a substitute.

## Evidence discipline

`PARITY.md` distinguishes manual observations, disk checks, actual wire captures,
synthetic replay and unresolved differences. Capture footers, contiguous sequence
numbers, source commits and hashes establish provenance, not semantic equality.
Different speech chunk counts, model choices, timestamps and recorder redactions
must remain visible in comparison reports. Do not mark the goal complete until
every requirement above has current evidence at its required scope.
