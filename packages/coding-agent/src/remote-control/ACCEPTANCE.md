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
| Preserve session identity, name, cwd, history and work model | Four-model lifecycle and compiled-resume checks preserve identity/history/model. In the `acfa258` phone checkpoint, local Plan execution moved from `157bb2886973a597` to `157bbf7b53f2c244` while the subscribed wire thread remained `157ba8d39989966c`; the new header retains direct `forkedFromId`, file-backed `parentSession`, durable `remoteThreadId`, and title `xcsh Remote Luna`. Robin confirmed the existing phone transcript retained the `xcsh Remote Luna` header | Complete the remaining history/catalog/fork and four-model phone scenarios |
| One executor and persistence owner | RemoteSession uses existing AgentSession; duplicate delegation tests; live file tasks; accepted start/steer identities and signature hashes persist before execution; retries recover the same turn across failed switches, host loss, adapter recreation and complete compiled TUI restart; pre-ledger history also deduplicates completed client messages; the current `b3953eecc` artifact concurrently routed one real write/read task to each of the four work-model owners and returned each original turn on retry without a duplicate history entry | Concurrent terminal/phone controls and manual confirmation of no duplicate tools |
| Canonical complete history and pagination | Persisted branch/timeline; command/cancellation facts; native write/edit diffs and formatter settlement; core provenance restores completed work; all visible persisted message roles have bounded projections while private compaction/file/custom details remain excluded; joining during active model or tool streaming restores partial text/progress with the durable identities; terminal forks expose their persisted source session as canonical `forkedFromId` while file-based branch ancestry remains distinct; the recorded experimental collaboration-mode catalog now matches the pinned Plan/Default order and nullable fields and rejects non-capable clients; both settings updates and turn starts now apply Plan/Default through idempotent InteractiveMode entry/exit semantics after validating the complete override; a current-artifact live probe entered Plan twice, rejected a custom mode without mutation and restored Default while preserving the actual provider-qualified work model; initialize now applies exact per-client notification opt-outs from the pinned request schema, matching the captured phone capability count; stable and experimental list/read/resume Thread projections now preserve the recorded order, gate the two experimental fields, exclude future private fields and validate actual results against pinned schemas while keeping internal model metadata; the reference skill-root/list/read bootstrap is implemented with pinned response schemas, actual live-session catalogs and owner-confined file reads; the clean compiled `157855114` host accepted the observed nine-root shape and listed/read one real TUI skill with zero errors | Phone history/catalog/fork and mid-stream presentation acceptance |
| Typed prompts and streamed turns | Alpha/Beta manual routing; the normalized Luna/Astra live gate returned each distinct marker in 2.804/2.570 seconds and proved retry IDs select one advancing turn with one history entry; real AgentSession tool execution matches live completed items and persisted history; text phases, active model/tool attachment, tool completion and late-promise race tests pass with stable live-to-durable identities | Concurrent terminal/phone control and final live schema-level history acceptance |
| Steering, interruption and explicit task cancellation | API implementations; spoken-output interruption manually passed; accepted steering/control effects settle on old storage before a terminal switch; current-artifact live protocol checks steered a real Sol turn without changing its turn ID and observed the replacement marker, then interrupted a separate turn, which persisted as `interrupted` without creating its delayed fixture file | Repeat steer and explicit task cancellation from the iPhone; retain remaining cross-interface race/retry coverage |
| Questions and approvals in both interfaces | Native command/file/general-tool prompts share the broker before/after reattachment; command/file requests use pinned approval methods and schemas; phone/terminal accept, decline, turn-cancelling responses, question cancellation and late-answer tests pass; voice mirrors all three item kinds. On artifact `acfa258`, Robin tapped `Approve and execute` once, saw implementation stream and complete in the existing transcript, confirmed the Plan pill cleared, and retained the `xcsh Remote Luna` header; one Bash, Write and Read produced the exact 29-byte fixture. `permissionProfile/list` returns the schema-valid empty catalog; MCP elicitation is not applicable to the negotiated 2025-03-26 runtime | Complete grouped questions, command/file approvals, empty permission-catalog presentation and remaining concurrent control/retry acceptance |
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
| TDD and repository checks | The continuity repair passes 83 affected tests/509 assertions, all 905 remote tests/3688 assertions, and 8311 guarded package tests/30013 assertions with 561 skips across 795 files under Bun 1.4.2. Workspace TypeScript/Biome, docs quality, changed/staged PII, redacted staged/postcommit gitleaks and whitespace gates pass; all 24 pinned source hashes match. Immutable artifact `acfa258` passed the ten-check network-disabled Ubuntu package harness | Repeat all gates and rebuild after upstream reconciliation; the unchanged repository baseline has 218 HEAD enforcement findings across 13 files |
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

The latest controlled Luna attempt is still a partial failure. Remote Plan state
made the Plan pill appear, Robin sent the exact Plan request, saw all three review
choices and tapped `Approve and execute` once. The phone then showed `Exit plan
mode`, retained the Plan pill on a blank composer and did not visibly follow or
stream the implementation. The terminal nevertheless created
`/tmp/xcsh-3818-acceptance/alpha/plan-discovery-luna.txt` with exactly the 23 bytes
`LUNA-DISCOVERY-REPAIRED` and no trailing newline. Sanitized trace sequences 1266,
1268, 1270 and 1272 respectively record the approval response, resolved request,
source `thread/closed` and replacement `thread/started`; that replacement had the
correct Luna model and `xcsh Remote Luna` name, but both `forkedFromId` and
`parentThreadId` were null. The `alpha` and `beta` labels were subsequently
identified as working-directory groups, not model-session names.

The lineage repair persists the approved source session ID separately from the
file-backed `parentSession` ancestry and projects the validated explicit value as
`forkedFromId` while keeping `parentThreadId: null`. Its red test first received
`forkedFromId: null`; afterward the Plan review test passed 21 tests with 167
assertions and the seven-file Plan/lifecycle/router/schema/session matrix passed
62 tests with 417 assertions under Bun 1.4.2. This is automated repair evidence,
not phone acceptance. The complete 65-file remote-control suite passed 904 tests
with 3679 assertions, and the guarded coding-agent suite passed 8310 tests with
561 skips and 30002 assertions across 795 files. A committed artifact and one
controlled iPhone retry remain required before closing the navigation row.

That retry used committed artifact `91353d9` and source thread
`157b91c88d4750ea`. Robin tapped `Approve and execute` once; the Plan pill
cleared and the phone continued to show `Exit plan mode`, but no implementation
activity appeared in its transcript. The terminal moved once to replacement
`157ba16225238f97`, created
`plan-lineage-luna-91353d9-2f7c1.txt` with exactly the 26 bytes
`LUNA-LINEAGE-91353D9-2F7C1` and no trailing newline, and returned idle. The
fixture SHA-256 is
`dc533173b26217f61e2a79dc211e5884ccb4686da448cf1eec16ca1240e64b71`.
Sanitized trace sequences 450, 453, 455 and 465 show the phone approval,
resolution, source closure and replacement delivery on the same phone stream.
The replacement correctly carried `forkedFromId` for the approved source and
`parentThreadId: null`, proving the lineage repair while leaving phone
navigation failed.

Trace review identified the remaining ordering fault: the bridge unregistered
the active source before registering its replacement, so the phone received
`thread/closed` before the related `thread/started`. The new regression first
failed with that order. The repair keeps the old registration discoverable but
rejects calls while storage changes, atomically announces the forked replacement
afterward, then retires the source. The four-file focused bridge/host/lifecycle
set passes 36 tests with 191 assertions. This remains automated repair evidence,
not phone acceptance. The expanded nine-file matrix passes 91 tests with 553
assertions, the complete remote-control suite passes 904 tests with 3680
assertions, and the guarded coding-agent suite passes 8310 tests with 561 skips
and 30003 assertions across 795 files. A newly built artifact and one controlled
retry are still required.

The ordering-enabled checkpoint used committed artifact `e02bb0f`, source
`157ba16225238f97` and one approval. Robin reported that the Plan pill cleared,
but no implementation activity appeared in the phone transcript. The terminal
transitioned once to replacement `157ba8d39989966c` and created
`plan-order-luna-e02bb0f-7a4d2.txt` with exactly the 24 bytes
`LUNA-ORDER-E02BB0F-7A4D2`, no trailing newline and SHA-256
`9625f96acf06063a2298863a35b50b9fd7f6a7e49e0d657e743283c0c25bb594`.
The replacement header persists `forkedFromId: 157ba16225238f97` and retains
the source file as `parentSession`; its remote Thread keeps
`parentThreadId: null`.

Sanitized trace sequence 300 is the phone approval response, 302/303 resolve
the request, 305-312 announce the replacement to all four initialized clients
(312 is the approving phone stream), 313/314 close the source, and 318
acknowledges those deliveries. The phone remained subscribed only to the source,
however, and issued no replacement `thread/resume`, so later replacement events
were filtered by the router. The focused regression first passed the ordered
start/close pair but timed out waiting for the replacement's first
`turn/started` (24 tests passed, one failed, 135 assertions). The repair transfers
only subscriptions owned by the local session being replaced before announcing
the new Thread. It then passes 25 tests with 135 assertions; the four-file
lifecycle/router/host/interaction set passes 50 tests with 297 assertions. This
is automated repair evidence, not phone acceptance. The seven-file Plan matrix
passes 82 tests with 500 assertions, the complete remote-control suite passes
904 tests with 3680 assertions, and the guarded coding-agent suite passes 8310
tests with 561 skips and 30003 assertions across 795 files. A newly committed
artifact and one controlled retry remain required.

The subscription-enabled checkpoint used committed artifact `35472ad`, source
`157ba8d39989966c` and one approval. Robin saw no implementation in the active
transcript, but did receive an in-app notification that `xcsh Remote Luna`
completed a task which was not associated with that transcript. The terminal
created replacement `157bb2886973a597` once and wrote
`plan-stream-luna-35472ad-b6c8e.txt` as exactly the 25 bytes
`LUNA-STREAM-35472AD-B6C8E`, with no trailing newline and SHA-256
`ce157d5c71ad68250272a9e9044be55deaa339f2868cf1971607b5b3dd5d9b92`.
Its header retains source-file `parentSession`, direct
`forkedFromId: 157ba8d39989966c`, title and model.

The sanitized trace proves transport delivery was no longer the failure:
sequence 306 is the phone approval, 308/309 resolve it, 310-315 announce the
replacement with correct lineage, 316/317 close the source, 318-321 deliver
`turn/started`, and 474-477 deliver `turn/completed`. Sequences 315, 317, 321 and
477 all target the same active phone client and stream as the approval; the
intervening item and text events are also delivered there. `thread/started` is
a discovery notification, however, not a client-navigation command. The phone
therefore treated the execution session as a detached thread even after it had
received the complete replacement stream.

The new repair preserves the fresh local Plan execution session and its direct
persisted lineage while assigning it the source's durable phone-facing thread
identity. The host refreshes the existing registration instead of announcing a
new remote fork or closing the subscribed thread; reads, turns, interactions and
notifications translate to the current local owner while retaining the existing
wire thread ID. The continuity ID is persisted for terminal resume and propagated
through later Plan executions. The red lifecycle regression passed 24 tests and
failed this case at the removed source registration (133 assertions). It now
passes 26 tests with 143 assertions, including same-thread read, execution events
and persisted resume, and the seven-file Plan matrix passes 83 tests with 509
assertions under Bun 1.4.2. This is automated repair evidence only; a rebuilt
artifact and one Robin-observed phone attempt remain required.

The complete 65-file remote-control suite passes 905 tests with 3,688
assertions. The CI-shaped guarded coding-agent package run passes 8,311 tests
with 561 skips and 30,013 assertions across 795 files. The package run was
hosted in a persistent Herdr pane with its streams piped to reproduce the
non-TTY CI environment; this avoids treating the pane's real OSC-52 clipboard
and viewport as headless test conditions.

Committed artifact `acfa258` completed the controlled continuity checkpoint.
Robin tapped `Approve and execute` once and then saw “I'm executing the approved
plan in order” continue in the existing transcript. Robin subsequently confirmed
that the same screen retained the `xcsh Remote Luna` header, showed the completed
task and had no Plan pill. The terminal created
`plan-continuity-luna-acfa258-9c4e2.txt` exactly once with the 29 bytes
`LUNA-CONTINUITY-ACFA258-9C4E2`, no trailing newline and SHA-256
`66b13c326f1a286a62247520cb03c6efd58b51ab88c77fd6e64025c13cbb335c`.
Its execution log contains one Bash, one Write and one Read.

The new local execution session is `157bbf7b53f2c244`. Its header records direct
`forkedFromId: 157bb2886973a597`, the source file as `parentSession`, durable
`remoteThreadId: 157ba8d39989966c`, and title `xcsh Remote Luna`. The wire Thread
remained `157ba8d39989966c` with `forkedFromId: null` and
`parentThreadId: null`. Sanitized sequences 223-226 carry the single phone
approval response and resolution, 230 delivers the phone's only `turn/started`,
and 404 delivers its only `turn/completed`; there is no replacement
`thread/started` or source `thread/closed`. The second start/completion pair in
the trace belongs to the separately hashed terminal subscriber, not duplicate
execution. Host status remained connected with four stable named sessions.

Because the live Luna execution session had been created by artifact `35472ad`
before `remoteThreadId` existed, cutover required one reversible header-only
migration that added the already-established remote ID. A mode-`0600` backup was
retained outside the repository; all post-header records remained byte-identical.
Fresh sessions persist this field automatically. This checkpoint closes only the
Plan transcript-continuity scenario; the remaining acceptance rows stay open.

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
