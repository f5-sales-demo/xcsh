# Native remote protocol comparison

This development harness records ordinary ChatGPT-to-Codex conversations for
comparison with native xcsh. It is not a product dependency or a replacement
agent. The reference is Codex 0.153.4, commit
`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`.

## Reference preparation

Use a separate copy of the pinned source. `bun install.ts <source-directory>`
checks the SHA-256 of every patched source file before applying the observation
patch and installing two private Rust helper modules. Existing Codex binaries and
the user's running daemon are not modified. The patch contains Apache-2.0 Codex
source context; see `../../src/remote-control/NOTICE.md` and its accompanying license.

Build the reference with its pinned Rust toolchain. The release archive's workspace
versions can differ between Cargo.toml and Cargo.lock; normalize workspace package
versions with `cargo update --workspace --offline` if needed, and verify that every
external dependency entry remains unchanged. No dependency upgrade belongs in the
reference baseline. Run the upstream formatting and focused transport checks.

Build **both** the CLI and its companion tool host from that same source and
toolchain, leaving the executables together in the build output directory. First
follow the pinned source's `.github/actions/setup-rusty-v8/action.yml`: download
the matching Codex-built V8 archive, Rust bindings, and checksum manifest; verify
both checksums; then set `RUSTY_V8_ARCHIVE` and `RUSTY_V8_SRC_BINDING_PATH` to the
verified files. The ordinary upstream V8 download does not provide the required
`ptrcomp_sandbox_release` artifact for this pinned version. Do not disable V8's
sandbox or change dependency versions to make the build pass.

```sh
cargo build --locked -p codex-cli --bin codex -p codex-code-mode-host --bin codex-code-mode-host
test -x target/debug/codex
test -x target/debug/codex-code-mode-host
```

Building only `codex-cli` can produce a host that pairs, answers text, and speaks,
but cannot perform workspace operations. In the pinned source,
`ProcessOwnedCodeModeSessionProvider` requires the companion executable and
`CodeModeService` caches availability when the session is created. If it was
missing, end the test call and reload the reference sessions after installing it;
merely retrying in an already loaded session is insufficient. Preserve the failed
capture as a reference setup failure, not evidence of native xcsh behavior.

Before requesting phone delegation tests, run a typed task through the reference
App Server that creates and reads a disposable fixture file. Verify the file on
disk and a completed tool item in the thread timeline. Pairing, verbal answers,
and executable presence alone do not prove that the reference tools work. Keep
this setup check separate from the phone capture and retain the normal tool and
sandbox configuration.

Start the recorder before the reference process:

```text
bun record.ts <private-directory>/capture.sock <private-directory>/reference.jsonl <scenario>
```

The directory must be owned by the current user and have mode 0700. Pass
`XCSH_REFERENCE_CAPTURE_SOCKET=<private-directory>/capture.sock` only to the
instrumented reference process. Use a separate listener and `sqlite_home` so its
enrollment and state are independent. Reuse the normal Codex credential store;
do not copy rotating refresh credentials into a second store. Run the reference
with ordinary log levels, without enabling raw realtime wire logging.

The Rust hooks send decoded JSON over the private socket. The collector removes
credentials, audio, SDP, paths, and text values before writing JSONL files with
mode 0600. Identities become salted references. No HTTP authentication headers
are passed to the recorder. A bounded synchronous write can add up to 50 ms of
instrumentation overhead per message on failure; latency measurements must report
that instrumentation. Sequence gaps, truncated frames, size limits, write failure
sentinels, and missing completion footers invalidate completeness.

Stop the test host gracefully after the conversation is idle, then stop the
recorder. Start a fresh host process and recorder for a fresh capture window;
producer sequence counters begin at one. Do not reuse a failed capture path.

## Native capture

Launch the native xcsh test host and session processes with:

- `XCSH_REMOTE_TRACE_DIRECTORY`: an existing private directory.
- `XCSH_REMOTE_TRACE_COMMIT`: the exact 40-character implementation commit.
- `XCSH_REMOTE_TRACE_SCENARIO`: the controlled scenario name.
- `XCSH_REMOTE_TRACE_SALT`: a fresh random 32-byte hex salt, shared across the
  processes in this capture window. Do not publish it with the evidence.

Each host and realtime connection gets a separate trace. The shared salt preserves
cross-process identity correlation; manifest clock origins support timeline
assembly. Close each recorded connection and test host to finalize their footers.
Capture is off when the directory variable is absent. Never restart a user's
active voice call merely to enable recording; coordinate the test boundary.

`bun compare.ts <reference.jsonl> <xcsh.jsonl>` produces an inventory of signals,
correlated requests and replies, errors, unanswered requests, timings, and a
strict structural diff. It exits nonzero when evidence is incomplete, differs,
or requires semantic review. It compares individual traces; assembling multiple
native trace files into a verified conversation timeline remains a review step.
Unknown events and extra fields are evidence to investigate, not automatically
ignored noise. Request IDs are normalized; method names, field presence, nulls,
errors, and event order remain significant.

## Controlled phone conversations

Run the same scenarios on both hosts and record the phone app version and observed
results. Use only dedicated fixture directories. Store the scripted prompts and
expected fixture results alongside the sanitized evidence; redacted wire text
cannot independently prove semantic parity.

| Scenario | Conversation and objective result | Evidence to compare |
| --- | --- | --- |
| Typed discovery and recall | Select Alpha and Beta; ask each for its distinct remembered marker | Initialization, listing, attachment, history, turn status, final response, routing |
| Voice delegation | Ask for a fixture file containing the thread's marker, then ask to read it | Call startup, context, transcripts, delegation, tool execution count, returned result |
| Listening and interruption | Pause during a request; ask to count slowly; interrupt with “stop” | Turn boundaries, cancellation events, stopped audio, continued listening |
| Work control | Steer active work, cancel explicitly, then end voice during a separate running task | Single completion owner, preserved agent work, cancellation scope, no duplicate action |
| Recovery | Background/foreground; end/restart; airplane mode off/on; start fresh voice and read the fixture | Close reasons, retry timing, history and file preservation, duplicate suppression |

Robin has accepted restarting voice after complete network loss for the first
release. Record what normal Codex does under the same phone conditions before
classifying this as equal behavior or an accepted difference.

Host observation covers decoded relay/thread messages and realtime sideband JSON.
It does not observe the direct iPhone-to-service audio/media connection. The Rust
hooks currently capture text frames, not every WebSocket control frame or HTTP
handshake response. These coverage gaps, untested transports, permission flows,
and model variants remain explicit parity work. Successful captures or an empty
structural diff do not establish identical feature parity.
