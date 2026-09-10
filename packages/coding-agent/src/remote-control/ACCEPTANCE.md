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
| Canonical complete history and pagination | Persisted branch, identities, steering, generic tools and disk reopen pass; mixed `thread/timeline/list` now combines voice facts and ordinary items with stable pages and opening call state | Specialized command/file items, remaining visible message types, active attachment/fork lifecycle, experimental handling and phone history acceptance |
| Typed prompts and streamed turns | Alpha/Beta manual routing; real AgentSession tool execution matches live completed items and persisted history; text phases, tool completion and late-promise race tests pass | Remaining tool stream semantics, concurrent terminal/phone control and final live schema-level history acceptance |
| Steering, interruption and explicit task cancellation | API implementations; spoken-output interruption manually passed; accepted steering/control effects settle on old storage before a terminal switch | Live steer and explicit task cancellation, remaining race/retry coverage across interfaces |
| Questions and approvals in both interfaces | Broker, grouped ask, routing, restart/bounds and plan decisions pass; editor tests preserve revisions/ownership; execution preparation owns its change, retires stale prompts and stops on disposal | iPhone grouped/plan presentation, custom UI, dedicated approvals, remaining concurrent control/retry coverage and manual decision acceptance |
| Native realtime transports | WebRTC v1/v3 and existing-call paths; v1 default/session/handoff source-contract tests; actual iPhone v3 voice | Live v1, standalone WebSocket, remaining supported options and explicit errors for deferred operations |
| Initial context, speech boundaries and transcripts | Recorded speech boundaries, replay identity and selected-branch timeline state; explicit mode instructions validate both transports, retain developer priority and drain before closure | Turn-scoped voice state, default instructions and retained-fragment recovery; response-item promotion and live canonical history acceptance |
| Delegation and speakable output | Reference and native both created/read fixture; v3 streaming and completed v1 commentary/final output pass four-model adapter tests; explicit speech matches pinned Rust budget fixtures | Fresh live streaming capture and remaining cancellation/response-item modes |
| Keep reasoning/tool internals out of speech | Text-only extraction and reasoning exclusion tests | Verify all model adapters and routing modes, including malformed headers and response-item mode |
| Deliberate pauses and spoken interruption | Robin confirmed waiting through pauses and stopping mid-count | Preserve behavior in final live acceptance |
| Voice closure preserves agent work | Unit lifecycle checks and normal manual closure | Live voice end during ongoing work, then verify completion/history |
| Phone background/foreground and complete network loss | Manual background/foreground and fresh voice recovery passed | Final regression with no duplicate work; automatic recovery after complete loss is explicitly waived |
| Host restart and surviving terminal reconnection | Local socket restart test keeps a real AgentSession/tool running; EOF repair restores registration; stable client-message retry executes once and completed history/events survive | Abrupt packaged process loss and relay reconnect/replay matrix; final phone acceptance |
| Selected ChatGPT subscription and refresh | Own subscription enrollment/voice worked; auth recovery tests | Expired/revoked subscription and enrollment recovery, unavailable credential handling |
| Relay acknowledgements, chunking, replay and bounds | Codec tests; 148 upstream reference transport tests passed | Full native duplicate/reorder/chunk/buffer/reconnect matrix and live recovery evidence |
| Credentials/raw audio absent from diagnostics | Private sanitized capture, PII and commit secret scans | Inspect final packaging/logging/error surfaces; raw phone media is not captured |
| Sol, Luna, Terra and Astra fidelity | Parameterized adapter tests; native Astra voice and Luna typed tasks; isolated model-registry SDK tests preserve all four identities on resume | One live delegated tool task with each work model; final CLI resume acceptance; no model replacement by voice component |
| No Codex installation or subprocess dependency | Compiled host and two real TUIs pass in isolated Ubuntu without Codex, standalone Bun or source dependencies; real file tools, host restart/replay and compiled resume verified | Preserve this check on the final release artifact; live subscription/voice evidence remains separate |
| Actual Codex reference recordings and comparison | Two recall calls and successful reference/native file calls; hashed sanitized fixtures | Repair remaining differences; further control/recovery/interaction scenarios and explicit unverified coverage |
| TDD and repository checks | Recorded red-to-green work; instruction lifecycle package suite 7694 pass, 561 skips, zero failures; workspace TypeScript and bundle check; earlier compiled isolation/build receipt | Final affected suites and required CI; 218 existing HEAD PII-shaped findings across 13 files remain unresolved |
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
