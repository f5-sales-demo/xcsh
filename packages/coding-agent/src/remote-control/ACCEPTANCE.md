# Native remote completion audit

Issue #3818; objective: native, independently paired xcsh terminal sessions in
ChatGPT text and Remote Voice, with the existing agent remaining the sole writer.
This audit preserves the full user objective. Passing one row does not imply
completion of another. Codex baseline: 0.153.4,
`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`.

| Requirement | Current evidence | Remaining completion evidence |
| --- | --- | --- |
| Own enrollment and pairing | Robin paired xcsh; live relay and two terminal sessions verified | Retain passing enrollment/pairing regression coverage through release |
| Enable, disable, status, pair, clients, revoke; JSON and `/remote` | Command implementation and focused tests exist | Audit packaged command behavior, revocation/expiry, and terminal status |
| Private per-user host and state; default off | Host/control/IPC modules and private capture checks | Audit ownership, permissions, singleton/restart, fresh-install default |
| Discover every live top-level terminal, exclude subagents | Two dedicated terminals discovered and routed correctly | Verify creation, internal-agent exclusion, scale and stale heartbeats |
| Preserve session identity, name, cwd, history and work model | Alpha/Beta resumed with original identities and Luna/Astra models | Verify rename/fork/resume/exit across host restart; repair implicit model-resume mismatch |
| One executor and persistence owner | RemoteSession uses existing AgentSession; duplicate delegation tests; live file tasks | Durable retry/crash-gap reconciliation, concurrent terminal/phone controls and no duplicate tools |
| Canonical complete history and pagination | Pinned pagination tests; selected persisted branch survives compaction and reattachment; stable message/turn identities, steering boundaries, phases and generic tool results pass; failed first turns survive disk reopen | Mixed `thread/timeline/list`, specialized command/file items, remaining visible message types, active attachment/fork lifecycle and phone history acceptance |
| Typed prompts and streamed turns | Alpha/Beta manual routing; real AgentSession tool execution matches live completed items and persisted history; text phases, tool completion and late-promise race tests pass | Remaining tool stream semantics, concurrent terminal/phone control and final live schema-level history acceptance |
| Steering, interruption and explicit task cancellation | API implementations; spoken-output interruption manually passed | Live steer and explicit task cancellation, race/retry coverage across interfaces |
| Questions and approvals in both interfaces | General terminal machinery exists | Remote request mapping, one answer owner, cancellation/disconnect and permission-decision preservation |
| Native realtime transports | WebRTC v3 and existing-call paths; actual iPhone voice | Pinned remaining supported transports/options and explicit errors for deferred operations |
| Initial context, speech boundaries and transcripts | Reference recall and native file-task recordings; replay tests | Full context update/recovery and durable canonical history audit |
| Delegation and speakable output | Reference and native both created/read fixture; one delegation each; streaming now passes recorded-channel and four-model adapter tests | Fresh live streaming capture and remaining cancellation/response-item modes |
| Keep reasoning/tool internals out of speech | Text-only extraction and reasoning exclusion tests | Verify all model adapters and routing modes, including malformed headers and response-item mode |
| Deliberate pauses and spoken interruption | Robin confirmed waiting through pauses and stopping mid-count | Preserve behavior in final live acceptance |
| Voice closure preserves agent work | Unit lifecycle checks and normal manual closure | Live voice end during ongoing work, then verify completion/history |
| Phone background/foreground and complete network loss | Manual background/foreground and fresh voice recovery passed | Final regression with no duplicate work; automatic recovery after complete loss is explicitly waived |
| Host restart and surviving terminal reconnection | Dedicated sessions reattached after host restart | Automated interrupted-host test with ongoing work, history and request identity |
| Selected ChatGPT subscription and refresh | Own subscription enrollment/voice worked; auth recovery tests | Expired/revoked subscription and enrollment recovery, unavailable credential handling |
| Relay acknowledgements, chunking, replay and bounds | Codec tests; 148 upstream reference transport tests passed | Full native duplicate/reorder/chunk/buffer/reconnect matrix and live recovery evidence |
| Credentials/raw audio absent from diagnostics | Private sanitized capture, PII and commit secret scans | Inspect final packaging/logging/error surfaces; raw phone media is not captured |
| Sol, Luna, Terra and Astra fidelity | Parameterized adapter tests; native Astra voice and Luna typed tasks | One live delegated tool task with each work model; no model replacement by voice component |
| No Codex installation or subprocess dependency | Runtime is native TypeScript/Bun; reference is isolated test tooling | Packaged native execution in a Codex-absent environment |
| Actual Codex reference recordings and comparison | Two recall calls and successful reference/native file calls; hashed sanitized fixtures | Repair remaining differences; further control/recovery/interaction scenarios and explicit unverified coverage |
| TDD and repository checks | Recorded red-to-green work; durable-history suite 7447 pass, 561 skip, zero failures; TypeScript and scoped privacy checks pass | Final affected suites and required CI; existing full-history PII findings remain unresolved |
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
