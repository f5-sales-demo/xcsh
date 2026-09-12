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
| Private per-user host and state; default off | Fresh isolated CLI and package checks report disabled by default; host startup rejects a live owner and safely reclaims only a dead current-user socket. On final artifact `12d945ac4-r2`, the live state directory is `0700`; host state, log and socket are `0600`; final credential/raw-audio pattern scans returned no matches | Retain these checks in CI |
| Discover every live top-level terminal, exclude subagents | Automated lifecycle coverage includes 128 owners, last-page routing, heartbeat expiry and subagent exclusion. Final artifact `12d945ac4-r2` reports exactly Luna, Astra, Sol and Terra with stable IDs and work models; Robin confirmed all four were discoverable on the iPhone after cutover | Retain exactly four canonical sessions through release; phone-created headless sessions remain excluded |
| Preserve session identity, name, cwd, history and work model | Four-model lifecycle and compiled-resume checks preserve identity/history/model. The accepted `acfa258` Plan checkpoint retained Luna's durable phone thread while local execution moved. Final artifact `12d945ac4-r2` preserves all four IDs/names/models; Robin confirmed their prior transcripts were visible | Complete remaining iPhone fork/catalog presentation without repeating the accepted Plan checkpoint |
| One executor and persistence owner | RemoteSession uses the existing AgentSession and durable request ledger. On `12d945ac4-r2`, a second client attached mid-turn and an identical retry returned the original turn without another history entry; cross-interface steering kept the terminal turn ID and produced one replacement fixture | Manual iPhone confirmation of concurrent control without duplicate tools |
| Canonical complete history and pagination | Persisted branch/timeline, visible item projections, fork ancestry, Plan/Default modes and skill bootstrap match pinned schemas. On `12d945ac4-r2`, stable and experimental discovery each paged twice; every turn and item across all four sessions paged without gaps or duplicates; a second client attached while Terra was `inProgress` and observed completion | Phone catalog/fork and mid-stream presentation acceptance |
| Typed prompts and streamed turns | Manual routing and real AgentSession tool execution passed. Current `12d945ac4-r2` history pagination matched live reads, a second client attached during active work, and the completed marker persisted with stable identity | Concurrent iPhone/terminal presentation acceptance |
| Steering, interruption and explicit task cancellation | API and race coverage pass; spoken-output interruption passed manually. On `12d945ac4-r2`, remote steering retained a live Terra terminal turn ID, suppressed its original file and created one exact replacement. On `5ffc51c2b-r2`, Robin used the transcript task Stop control after leaving voice; Terra reported `Operation aborted`, returned idle, and no case-variant of the delayed target existed after recheck | Retain through release |
| Questions and approvals in both interfaces | Native command/file/general-tool prompts share the broker and pinned schemas; accept, decline, cancellation and late-answer tests pass. The `d7aa4d48f-r2` runtime accepts the phone's exact Ask tuple, reports it on update/resume, uses session-local workspace grants, and restores Full without cross-session policy leakage. `permissionProfile/list` remains the schema-valid empty catalog | Complete Robin-observed iPhone Ask, command/file decision, concurrent-resolution, Full-switch and empty-catalog presentation |
| Native realtime transports | WebRTC v1/v3 and existing-call paths; v1 default/session/handoff source-contract tests; actual iPhone v3 voice; 38 original Rust audio-parser cases and end-to-end forwarding tests match. Final-artifact v3 negotiation passed with one started, SDP and closed event, a connected peer and open data channel. V1 remained service-rejected after omitting the explicit HTTP model; pinned Codex 0.153.4 was also service-rejected | Preserve the sanitized v1 service boundary and complete remaining supported options; do not map v1 silently to v3 |
| Initial context, speech boundaries and transcripts | Recorded timeline/replay state; turn-scoped mode, default/empty instructions and retained-context recovery match the pinned snapshot; real tool/pruning/resume/identity tests pass; shared voice owner and stored speech boundaries verified | Final live mode/context/history acceptance; live promotion and remaining recovery matrix |
| Delegation and speakable output | Reference and native both created/read fixture; v3 streaming, completed v1 and response-item output pass 32 four-model adapter variants; shared timeline and bounded delegation match pinned Rust fixtures | Fresh live streaming/item-mode capture, remaining cancellation and live canonical timeline acceptance |
| Keep reasoning/tool internals out of speech | Text-only extraction and reasoning exclusion tests cover all four adapters in delegation/item modes; BEM header and prefix routing tests pass | Final live routing-mode acceptance and remaining malformed input coverage |
| Deliberate pauses and spoken interruption | Robin confirmed waiting through pauses and stopping mid-count | Preserve behavior in final live acceptance |
| Voice closure preserves agent work | Unit lifecycle checks and normal manual closure pass. On `12d945ac4-r2`, a real WebRTC v3 call closed while delayed Astra work remained active; the work subsequently completed with an exact 31-byte no-newline fixture. Robin also confirmed on `5ffc51c2b-r2` that the voice Stop button ended voice without cancelling Terra's backing task | Retain through release |
| Phone background/foreground and complete network loss | Manual background/foreground and fresh voice recovery passed | Final regression with no duplicate work; automatic recovery after complete loss is explicitly waived |
| Host restart and surviving terminal reconnection | Socket, EOF and SIGKILL recovery tests preserve owners, active work, history and retry identity. A graceful host-only restart of `12d945ac4-r2` through Herdr restored the connected relay and the same four IDs, names and models within seconds | Confirm post-restart availability on the iPhone and retain through release |
| Selected ChatGPT subscription and refresh | Own subscription enrollment/voice worked; selected-row auth recovery tests; relay errors force enrollment-token refresh before reconnect. The selected credential is OpenAI Pro subscription OAuth and `OPENAI_API_KEY` is absent. Standalone v2 correctly returns `-32602 Realtime conversation requires API key auth`; it is an expected inapplicable-path result, not missing acceptance credentials | Expired/revoked subscription and enrollment recovery; no API-key acquisition or workaround |
| Relay acknowledgements, chunking, replay and bounds | Codec and transport tests cover acknowledgement, chunking, replay, cursor retention, bounded buffers, stale sockets and refresh-triggered connection rotation. On `12d945ac4-r2`, the live OAuth credential expiry advanced while the same host PID remained alive; the relay stayed connected with all four original sessions | Retain the refresh/replay gates through CI |
| Credentials/raw audio absent from diagnostics | Private sanitized capture, PII and commit secret scans pass; audio forwarding tests confirm frames are absent from stored records. Final live-state/evidence scans found zero credential-like or raw-audio payload files, with private `0700`/`0600` modes | Retain repository and CI privacy gates through merge |
| Sol, Luna, Terra and Astra fidelity | Parameterized adapter tests and isolated model-registry resume tests pass. Robin completed a voice tool task in each preserved session; host verification found exact no-newline files `LUNA-ORCHARD`, `ASTRA-COMET`, `SOL-HARBOR`, and `TERRA-MAPLE`, and each session history records its write, read, and spoken completion | Retain model identity through release |
| No Codex installation or subprocess dependency | Current artifact `d7aa4d48f-r2` passed all ten isolated Ubuntu checks in 26.398 seconds without Codex, standalone Bun, network or source dependencies; real tools, naming, recovery, active work, compiled resume and durable replay passed | Live subscription/voice evidence remains separate |
| Actual Codex reference recordings and comparison | Two recall calls and successful reference/native file calls; hashed sanitized fixtures | Repair remaining differences; further control/recovery/interaction scenarios and explicit unverified coverage |
| TDD and repository checks | The v1 repair passes 11 focused tests/61 assertions, the 34-test transport matrix/150 assertions, all 905 remote tests/3688 assertions and 8311 guarded package tests/30019 assertions with 561 skips across 795 files under Bun 1.4.2. TypeScript, Biome, package, docs, textlint, whitespace, staged PII, staged/postcommit gitleaks, all 24 pinned hashes and the final ten-check harness pass | Retain these gates through PR CI; the unchanged repository baseline has 218 HEAD enforcement findings across 13 files |
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

## Final artifact discovery and transport checkpoint

Immutable artifact `2d03fce93-r2` has SHA-256
`efd657133cfa91f6093e6e46c104ce5c8efe521a3fed37ff9d505073ece4322e`.
Robin confirmed on the iPhone that `xcsh Remote Luna`, `xcsh Remote Astra`,
`xcsh Remote Sol` and `xcsh Remote Terra` were all discoverable and that their
prior transcripts were visible. This closes only discovery and ordinary history
hydration; pagination boundaries, fork/catalog presentation and mid-stream
attachment are not inferred.

The sanitized transport audit records OpenAI Pro subscription OAuth with no API
key and no captured media. WebRTC v3 passed with one started, SDP and closed event,
a connected peer and an open data channel. Both native v1 and pinned Codex 0.153.4
were rejected at the subscription service boundary. Removing the explicit model
from the native v1 HTTP body did not clear that service response, so the repair is
retained as a source-contract correction without claiming live v1 success.
Standalone WebSocket v2 returned the expected `-32602 Realtime conversation
requires API key auth`; no API key is part of this acceptance run.

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

## Prior immutable runtime checkpoint

The final committed runtime now executes artifact `compiled-final-12d945ac4-r2`
from commit `12d945ac428763383590da9ae7d642d6bef6a045`, with SHA-256
`9accce86b0a4d05127f51ad35956cdf048a1cd2e041acb6ae34ddb0288d0ca7e`.
Its network-disabled package harness passed all ten checks in 18.700 seconds.
After cutover, Robin reported that Luna, Astra, Sol and Terra were all
discoverable and their prior transcripts were viewable. The live protocol also
reports exactly those four IDs, names and selected work models.

Current-artifact automation paged both stable and experimental discovery in two
pages, then paged every stored turn and item for all four sessions without gaps
or duplicates. It verified each session's model and skill catalog, the expected
`thread/fork` `-32601` boundary, Plan/Default collaboration modes, all four work
models, and the schema-valid empty permission-profile catalog. A second client
attached to Terra while its turn was `inProgress`, observed the completed marker,
and an identical retry returned the original turn ID without another history
entry.

A true cross-interface Terra run began from its Herdr terminal. A concurrent
remote start returned `-32000` with `Session already running; use turn/steer`;
remote steering retained the same turn ID, suppressed the original file and
created one exact 23-byte no-newline replacement. A separate delayed task was
interrupted, persisted as `interrupted`, and did not create its target file. A
current Astra grouped-question turn delivered two questions together, accepted
both answers, emitted one resolution and completed once.

A current WebRTC v3 call connected with one start, SDP and close event, an open
data channel and no captured media. Closing that call while Astra performed a
delayed terminal task did not cancel the work: the exact 31-byte no-newline
fixture was written afterward. A graceful Herdr restart of only the host then
restored `relay: connected` and the same four session IDs, names and models. The
host and four agent processes contain no `OPENAI_API_KEY`; the selected credential
is OpenAI Pro subscription OAuth. Credential-like and raw-audio pattern scans of
the private host/evidence surfaces returned no matches.

The live enrollment expiry then advanced from `2026-09-12T02:51:14Z` to
`2026-09-12T03:00:44Z` without restarting the host. The relay remained connected
and the same four session identities stayed registered, closing the compiled-host
visibility-across-credential-rotation gate.

Sanitized receipts are retained outside Git at
`native-3818/evidence-final-12d945ac4-r2`. Remaining completion evidence is
limited to the other explicit iPhone presentation/control/lifecycle observations,
expired/revoked subscription recovery and re-pairing, then PR/CI, squash merge
and cleanup. The accepted Plan transcript-continuity checkpoint is not repeated.

Robin subsequently completed one voice tool task in each model session. Exact
host verification found `LUNA-ORCHARD` (12 bytes), `ASTRA-COMET` (11),
`SOL-HARBOR` (10), and `TERRA-MAPLE` (11), with no trailing newline; each write,
read, and spoken completion is present in its owning session history. A failed
cancellation attempt correctly demonstrated that ending voice preserves backing
work. After the tail-resubmission repair and cutover to `5ffc51c2b-r2`, Robin
used the separate transcript task Stop control: Terra reported `Operation
aborted`, returned idle, and no case-variant of the delayed target existed after
recheck. The replacement's ten-check network-disabled harness passed in 17.933
seconds and the four original session identities and models remain connected.

## Current Ask and Full runtime checkpoint

The current immutable Ubuntu artifact is `compiled-final-2134792f-r4`, built
from full source commit `2134792f75a6e8b4c7408a78e71245f60feb1b8f` under
Bun 1.4.2. Its binary SHA-256 is
`4e892c8512d12ff9fccf79acabb54110a6d675a5bf87b24b0d79fbd38bb09dea`;
the configuration SHA-256 is
`71b6e475b1c88cd005d642f8f434474a8d05db4e6d8ef21ba326e5d2437a8220`.
Both the binary and launcher are mode `0700` and configuration is `0600`.
The ten-check network-disabled package harness passed in 31.193 seconds,
including provenance, real tool use, host recovery, durable replay and container
cleanup. Its sanitized receipt is outside Git at
`native-3818/evidence-final-2134792f-r4`.

The superseded `d7aa4d48f-r2` launcher passed `--no-extensions`, which also
removed the trusted `sandbox-guard` and therefore bypassed Ask's command prompt.
The replacement still disables all discovery but explicitly loads only
`--bundled-extension sandbox-guard`. The foreground host and all four model
sessions run `r4`; their command lines retain no other extension source.

Robin then selected Ask, started a Luna voice call, and requested an exact Bash
`pwd`. The phone rendered the approval prompt; selecting Allow once executed the
command and returned the directory correctly. This is manual evidence for the
Ask command-prompt and allow path only; decline, cancel, replay and concurrent
resolution remain separate manual rows.

Ask is exactly `approvalPolicy: on-request`, `approvalsReviewer: user`, and a
`workspaceWrite` sandbox with network disabled. Full is exactly
`approvalPolicy: never`, `approvalsReviewer: user`, and `dangerFullAccess`.
Settings updates and resumes report the active tuple truthfully. Ask command
execution uses one-turn approval; out-of-workspace paths may be granted only for
the owning session. Selecting Ask again or returning to Full clears those grants.
The state is keyed by the session's isolated settings object, so another terminal
in the same directory does not inherit Ask, Full or a grant. Native command and
file requests still expose only the decisions the existing single-owner broker
can honor: accept, decline and cancel. There is no persistent Codex approval
cache, network grant or policy amendment.

Automated evidence covers settings validation and publication, Ask/Full
transitions, sandbox enforcement, session-local grant reset and same-directory
isolation, native interaction identity, cancellation, reconnect replay and
deduplication. The focused Ask/interaction/session matrix passed 56 tests, and
the complete remote-control suite passed 908 tests with 3,703 assertions. The
final guarded coding-agent package run passed 8,693 tests with 588 skips, zero
failures and 33,992 assertions across 851 files under Bun 1.4.2. Workspace
TypeScript, Biome, prompt, documentation, terminology and whitespace checks,
all 24 pinned source hashes, and all six clean source-derived generators passed.
The post-cutover audit found exactly Luna, Astra, Sol and Terra with their
established IDs, names, directories, models and histories; Luna retains local session
`157bbf7b53f2c244` and phone identity `157ba8d39989966c`. At the time of that
audit all four sessions truthfully reported Full.

These results are automation and protocol evidence, not iPhone acceptance.
Robin still must confirm that Ask appears active, voice connects, command and
file requests render, accept runs once, decline makes no mutation while the turn
continues, cancel retires the request and work, duplicate/reconnected responses
do not repeat work, simultaneous terminal/phone resolution has one winner, Full
restores unrestricted execution without leakage, and the empty catalog renders
coherently. The presentation rows for paginated history, unsupported fork,
mid-stream attachment, concurrent prompting, steering, grouped questions and
transcript promotion also remain Robin-observed gates.

The accepted Plan continuity, four-session discovery and prior transcripts,
four voice fixtures, deliberate pause/interruption, background/foreground
recovery, voice closure, transcript-task cancellation, Full mode and Pro OAuth
evidence remain valid and are not repeated. WebRTC v3 is the supported OAuth
voice path. Native and pinned Codex WebRTC v1 remain service-rejected;
standalone WebSocket v2 requires API-key authentication and is inapplicable to
this Pro OAuth run. `permissionProfile/list` intentionally remains empty, MCP
elicitation remains unsupported, phone-created headless sessions remain out of
scope, and manual voice restart after total network loss remains accepted.
Expiry, revocation and re-pairing are intentionally last because they disrupt
enrollment and remain pending until the presentation evidence is preserved.

## Automated interaction sweep

On 2026-09-12, a Herdr-managed terminal simulation ran the current interaction
matrix under Bun 1.4.2. The remote-control, sandbox-guard, session-fence and
sandbox-isolation matrix passed 948 tests with zero failures and 3,828
expect() calls across 68 files in 62.44 seconds.

The simulated cases cover native command/file prompt ownership,
accept/decline/cancel (including phone cancellation), no mutation after
decline/cancel, reattach and duplicate-response replay, one-winner
terminal/remote resolution, Ask grant isolation and reset on Full, the empty
permission-profile catalog, pagination, unsupported thread/fork, mid-stream
attachment, steering/interruption, grouped questions, transcript history,
relay replay and WebRTC recovery contracts.

This closes those behaviors as automated protocol assertions. It does not
substitute for what only an iPhone can establish visually: decline/cancel,
duplicate/reconnect and simultaneous-resolution presentation; Ask-to-Full
shield and empty-catalog presentation; or the final physical
expiry/revocation/re-pairing flow. The existing package-wide exploratory run
was intentionally stopped without a pass receipt after it exceeded its normal
range and opened an unexpected outbound test connection. Do not count that
interrupted broad run as verification.
