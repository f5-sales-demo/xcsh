# Native remote completion audit

Issue #3818; objective: native, independently paired xcsh terminal sessions in
ChatGPT text and Remote Voice, with the existing agent remaining the sole writer.
This audit preserves the full user objective. Passing one row does not imply
completion of another. Codex baseline: 0.153.4,
`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`.

| Requirement | Current evidence | Remaining completion evidence |
| --- | --- | --- |
| Own enrollment and pairing | Robin paired xcsh; live relay and two terminal sessions verified | Retain passing enrollment/pairing regression coverage through release |
| Enable, disable, status, pair, clients, revoke; JSON and `/remote` | Command implementation and focused tests exist; packaged default-off status passes | Finish remaining packaged commands, revocation/expiry and terminal status |
| Private per-user host and state; default off | Host/control/IPC modules and private capture checks | Audit ownership, permissions, singleton/restart, fresh-install default |
| Discover every live top-level terminal, exclude subagents | Two dedicated terminals routed correctly; 128 owner sockets discovered; a last-page selection routes once; heartbeat test removes stale owners and retains refreshed owners | Verify creation, internal-agent exclusion and final live discovery |
| Preserve session identity, name, cwd, history and work model | Alpha/Beta retain Luna/Astra; four-model lifecycle SDK tests preserve identity/history/model; stale lifecycle/configuration callbacks reject or retire; disposal settles work before storage closes; compiled extension-model resume passes | Finish all-model CLI restoration, lifecycle and phone acceptance |
| One executor and persistence owner | RemoteSession uses existing AgentSession; duplicate delegation tests; live file tasks; retries execute once across failed switches, reloads and resumed identities in the surviving adapter | Durable retry/crash-gap reconciliation, concurrent terminal/phone controls and no duplicate tools |
| Canonical complete history and pagination | Persisted branch/timeline; command/cancellation facts; native write/edit diffs and formatter settlement; core provenance restores completed work; joining active tools retains progress | Legacy entries without provenance, remaining visible message types, active model-stream attachment/fork lifecycle, experimental handling and phone history acceptance |
| Typed prompts and streamed turns | Alpha/Beta manual routing; real AgentSession tool execution matches live completed items and persisted history; text phases, tool completion and late-promise race tests pass | Remaining tool stream semantics, concurrent terminal/phone control and final live schema-level history acceptance |
| Steering, interruption and explicit task cancellation | API implementations; spoken-output interruption manually passed; accepted steering/control effects settle on old storage before a terminal switch | Live steer and explicit task cancellation, remaining race/retry coverage across interfaces |
| Questions and approvals in both interfaces | Native command/file/general-tool prompts share the broker before/after reattachment; command/file requests use pinned approval methods and schemas; phone/terminal accept, decline, turn-cancelling responses, question cancellation and late-answer tests pass; voice mirrors all three item kinds | iPhone grouped/plan presentation, permission profiles and MCP elicitations, remaining concurrent control/retry coverage and manual decision acceptance |
| Native realtime transports | WebRTC v1/v3 and existing-call paths; v1 default/session/handoff source-contract tests; actual iPhone v3 voice; 38 original Rust audio-parser cases and end-to-end forwarding tests match | Live v1, standalone WebSocket/v2, remaining supported options and explicit errors for deferred operations |
| Initial context, speech boundaries and transcripts | Recorded timeline/replay state; turn-scoped mode, default/empty instructions and retained-context recovery match the pinned snapshot; real tool/pruning/resume/identity tests pass; shared voice owner and stored speech boundaries verified | Final live mode/context/history acceptance; live promotion and remaining recovery matrix |
| Delegation and speakable output | Reference and native both created/read fixture; v3 streaming, completed v1 and response-item output pass 32 four-model adapter variants; shared timeline and bounded delegation match pinned Rust fixtures | Fresh live streaming/item-mode capture, remaining cancellation and live canonical timeline acceptance |
| Keep reasoning/tool internals out of speech | Text-only extraction and reasoning exclusion tests cover all four adapters in delegation/item modes; BEM header and prefix routing tests pass | Final live routing-mode acceptance and remaining malformed input coverage |
| Deliberate pauses and spoken interruption | Robin confirmed waiting through pauses and stopping mid-count | Preserve behavior in final live acceptance |
| Voice closure preserves agent work | Unit lifecycle checks and normal manual closure | Live voice end during ongoing work, then verify completion/history |
| Phone background/foreground and complete network loss | Manual background/foreground and fresh voice recovery passed | Final regression with no duplicate work; automatic recovery after complete loss is explicitly waived |
| Host restart and surviving terminal reconnection | Local socket restart keeps a real AgentSession/tool running; EOF repair restores registration; host relay transport errors reconnect with the retained cursor, replay only unacknowledged responses, ignore stale socket events and execute a routed turn once | Abrupt packaged process loss; final phone acceptance |
| Selected ChatGPT subscription and refresh | Own subscription enrollment/voice worked; auth recovery tests; standalone prerequisite resolves API-key sources without returning or refreshing OAuth | Wire API-key-only lookup into standalone transport; expired/revoked subscription and enrollment recovery, unavailable credential handling |
| Relay acknowledgements, chunking, replay and bounds | Codec covers duplicate/reordered chunks, stale/newer assemblies, invalid chunk recovery, oldest-assembly eviction, exact partial/plain acknowledgements, reconnect initialization, closed-stream sequence reset, cursor retention and bounded buffers; host transport reconnect covers error recovery, cursor headers, replay, acknowledgement and stale socket isolation; pinned transport sources and 148 upstream reference tests provide the baseline | Abrupt packaged process reconnect and live recovery evidence |
| Credentials/raw audio absent from diagnostics | Private sanitized capture, PII and commit secret scans; audio forwarding tests confirm frames are absent from stored records | Inspect final packaging/logging/error surfaces; raw phone media is not captured |
| Sol, Luna, Terra and Astra fidelity | Parameterized adapter tests; native Astra voice and Luna typed tasks; isolated model-registry SDK tests preserve all four identities on resume | One live delegated tool task with each work model; final CLI resume acceptance; no model replacement by voice component |
| No Codex installation or subprocess dependency | Compiled host and two real TUIs pass in isolated Ubuntu without Codex, standalone Bun or source dependencies; real file tools, host restart/replay and compiled resume verified | Preserve this check on the final release artifact; live subscription/voice evidence remains separate |
| Actual Codex reference recordings and comparison | Two recall calls and successful reference/native file calls; hashed sanitized fixtures | Repair remaining differences; further control/recovery/interaction scenarios and explicit unverified coverage |
| TDD and repository checks | Recorded red-to-green work; latest package suite 8235 pass, 561 skips, zero failures; 810 remote tests, workspace types/lint and bundle pass; pinned Rust fixtures and source hashes recorded | Final affected suites and required CI; 218 existing HEAD PII-shaped findings across 13 files remain unresolved |
| Manual acceptance only on Robin's report | Specific observations recorded in PARITY.md and issue comments | Obtain remaining manual checkpoints without treating simulated tests as phone acceptance |
| Issue, PR, review, merge and cleanup | Detailed issue, feature worktree, pushed commits | Completed linked PR, review/CI repair loop, authorized squash merge, confirmed-merged cleanup |

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
