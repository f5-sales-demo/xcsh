---
title: Bash Tool Runtime
description: Bash tool runtime with shell process management, sandboxing, timeout, and output streaming.
sidebar:
  order: 1
  label: Bash tool
i18n:
  sourceHash: "2fa41f972e58"
  translator: "machine"
---

# Bash tool runtime

This document describes the **`bash` tool** runtime path used by agent tool calls, from command normalization to execution, truncation/artifacts, and rendering.

It also calls out where behavior diverges in interactive TUI, print mode, RPC mode, and user-initiated bang (`!`) shell execution.

## Scope and runtime surfaces

There are two different bash execution surfaces in coding-agent:

1. **Tool-call surface** (`toolName: "bash"`): used when the model calls the bash tool.
   - Entry point: `BashTool.execute()`.
2. **User bang-command surface** (`!cmd` from interactive input or RPC `bash` command): session-level helper path.
   - Entry point: `AgentSession.executeBash()`.

Both eventually use `executeBash()` in `src/exec/bash-executor.ts` for non-PTY execution, but only the tool-call path runs normalization/interception and tool renderer logic.

## End-to-end tool-call pipeline

## 1) Input normalization and parameter merge

`BashTool.execute()` first normalizes the raw command via `normalizeBashCommand()`:

- extracts trailing `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N` into structured limits,
- trims trailing/leading whitespace,
- keeps internal whitespace intact.

Then it merges extracted limits with explicit tool args:

- explicit `head`/`tail` args override extracted values,
- extracted values are fallback only.

### Caveat

`bash-normalize.ts` comments mention stripping `2>&1`, but current implementation does not remove it. Runtime behavior is still correct (stdout/stderr are already merged), but the normalization behavior is narrower than comments suggest.

## 2) Optional interception (blocked-command path)

If `bashInterceptor.enabled` is true, `BashTool` loads rules from settings and runs `checkBashInterception()` against the normalized command.

Interception behavior:

- command is blocked **only** when:
  - regex rule matches, and
  - the suggested tool is present in `ctx.toolNames`.
- invalid regex rules are silently skipped.
- on block, `BashTool` throws `ToolError` with message:
  - `Blocked: ...`
  - original command included.

Default rule patterns (defined in code) target common misuses:

- file readers (`cat`, `head`, `tail`, ...)
- search tools (`grep`, `rg`, ...)
- file finders (`find`, `fd`, ...)
- in-place editors (`sed -i`, `perl -i`, `awk -i inplace`)
- shell redirection writes (`echo ... > file`, heredoc redirection)

### Caveat

`InterceptionResult` includes `suggestedTool`, but `BashTool` currently surfaces only the message text (no structured suggested-tool field in `details`).

## 3) CWD validation and timeout clamping

`cwd` is resolved relative to session cwd (`resolveToCwd`), then validated via `stat`:

- missing path -> `ToolError("Working directory does not exist: ...")`
- non-directory -> `ToolError("Working directory is not a directory: ...")`

Timeout is clamped to `[1, 3600]` seconds and converted to milliseconds.

## 4) Artifact allocation

Before execution, the tool allocates an artifact path/id (best-effort) for truncated output storage.

- artifact allocation failure is non-fatal (execution continues without artifact spill file),
- artifact id/path are passed into execution path for full-output persistence on truncation.

## 5) PTY vs non-PTY execution selection

`BashTool` chooses PTY execution only when all are true:

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- tool context has UI (`ctx.hasUI === true` and `ctx.ui` set)

Otherwise it uses non-interactive `executeBash()`.

That means print mode and non-UI RPC/tool contexts always use non-PTY.

## Non-interactive execution engine (`executeBash`)

## Shell session reuse model

`executeBash()` caches native `Shell` instances in a process-global map keyed by:

- shell path,
- configured command prefix,
- snapshot path,
- serialized shell env,
- optional agent session key.

For session-level executions, `AgentSession.executeBash()` passes `sessionKey: this.sessionId`, isolating reuse per session.

Tool-call path does **not** pass `sessionKey`, so reuse scope is based on shell config/snapshot/env.

## Shell config and snapshot behavior

At each call, executor loads settings shell config (`shell`, `env`, optional `prefix`).

If selected shell includes `bash`, it attempts `getOrCreateSnapshot()`:

- snapshot captures aliases/functions/options from user rc,
- snapshot creation is best-effort,
- failure falls back to no snapshot.

If `prefix` is configured, command becomes:

```text
<prefix> <command>
```

## Streaming and cancellation

`Shell.run()` streams chunks to callback. Executor pipes each chunk into `OutputSink` and optional `onChunk` callback.

Cancellation:

- aborted signal triggers `shellSession.abort(...)`,
- timeout from native result is mapped to `cancelled: true` + annotation text,
- explicit cancellation similarly returns `cancelled: true` + annotation.

No exception is thrown inside executor for timeout/cancel; it returns structured `BashResult` and lets caller map error semantics.

## Interactive PTY path (`runInteractiveBashPty`)

When PTY is enabled, tool runs `runInteractiveBashPty()` which opens an overlay console component and drives a native `PtySession`.

Behavior highlights:

- xterm-headless virtual terminal renders viewport in overlay,
- keyboard input is normalized (including Kitty sequences and application cursor mode handling),
- `esc` while running kills the PTY session,
- terminal resize propagates to PTY (`session.resize(cols, rows)`).

Environment hardening defaults are injected for unattended runs:

- pagers disabled (`PAGER=cat`, `GIT_PAGER=cat`, etc.),
- editor prompts disabled (`GIT_EDITOR=true`, `EDITOR=true`, ...),
- terminal/auth prompts reduced (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`),
- package-manager/tool automation flags for non-interactive behavior.

PTY output is normalized (`CRLF`/`CR` to `LF`, `sanitizeText`) and written into `OutputSink`, including artifact spill support.

On PTY startup/runtime error, sink receives `PTY error: ...` line and command finalizes with undefined exit code.

## Output handling: streaming, truncation, artifact spill

Both PTY and non-PTY paths use `OutputSink`.

## OutputSink semantics

- keeps an in-memory UTF-8-safe tail buffer (`DEFAULT_MAX_BYTES`, currently 50KB),
- tracks total bytes/lines seen,
- if artifact path exists and output overflows (or file already active), writes full stream to artifact file,
- when memory threshold overflows, trims in-memory buffer to tail (UTF-8 boundary safe),
- marks `truncated` when overflow/file spill occurs.

`dump()` returns:

- `output` (possibly annotated prefix),
- `truncated`,
- `totalLines/totalBytes`,
- `outputLines/outputBytes`,
- `artifactId` if artifact file was active.

### Long-output caveat

Runtime truncation is byte-threshold based in `OutputSink` (50KB default). It does not enforce a hard 2000-line cap in this code path.

## Live tool updates

For non-PTY execution, `BashTool` uses a separate `TailBuffer` for partial updates and emits `onUpdate` snapshots while command is running.

For PTY execution, live rendering is handled by custom UI overlay, not by `onUpdate` text chunks.

## Result shaping, metadata, and error mapping

After execution:

1. `cancelled` handling:
   - if abort signal is aborted -> throw `ToolAbortError` (abort semantics),
   - else -> throw `ToolError` (treated as tool failure).
2. PTY `timedOut` -> throw `ToolError`.
3. apply head/tail filters to final output text (`applyHeadTail`, head then tail).
4. empty output becomes `(no output)`.
5. attach truncation metadata via `toolResult(...).truncationFromSummary(result, { direction: "tail" })`.
6. exit-code mapping:
   - missing exit code -> `ToolError("... missing exit status")`
   - non-zero exit -> `ToolError("... Command exited with code N")`
   - zero exit -> success result.

Success payload structure:

- `content`: text output,
- `details.meta.truncation` when truncated, including:
  - `direction`, `truncatedBy`, total/output line+byte counts,
  - `shownRange`,
  - `artifactId` when available.

Because built-in tools are wrapped with `wrapToolWithMetaNotice()`, truncation notice text is appended to final text content automatically (for example: `Full: artifact://<id>`).

## Rendering paths

## Tool-call renderer (`bashToolRenderer`)

`bashToolRenderer` is used for tool-call messages (`toolCall` / `toolResult`):

- collapsed mode shows visual-line-truncated preview,
- expanded mode shows all currently available output text,
- warning line includes truncation reason and `artifact://<id>` when truncated,
- timeout value (from args) is shown in footer metadata line.

### Caveat: full artifact expansion

`BashRenderContext` has `isFullOutput`, but current renderer context builder does not set it for bash tool results. Expanded view still uses the text already in result content (tail/truncated output) unless another caller provides full artifact content.

## User bang-command component (`BashExecutionComponent`)

`BashExecutionComponent` is for user `!` commands in interactive mode (not model tool calls):

- streams chunks live,
- collapsed preview keeps last 20 logical lines,
- line clamp at 4000 chars per line,
- shows truncation + artifact warnings when metadata is present,
- marks cancelled/error/exit state separately.

This component is wired by `CommandController.handleBashCommand()` and fed from `AgentSession.executeBash()`.

## Mode-specific behavior differences

| Surface                        | Entry path                                            | PTY eligible                                                         | Live output UX                                                           | Error surfacing                                  |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| Interactive tool call          | `BashTool.execute`                                    | Yes, when `bash.virtualTerminal=on` and UI exists and `PI_NO_PTY!=1` | PTY overlay (interactive) or streamed tail updates                       | Tool errors become `toolResult.isError`          |
| Print mode tool call           | `BashTool.execute`                                    | No (no UI context)                                                   | No TUI overlay; output appears in event stream/final assistant text flow | Same tool error mapping                          |
| RPC tool call (agent tooling)  | `BashTool.execute`                                    | Usually no UI -> non-PTY                                             | Structured tool events/results                                           | Same tool error mapping                          |
| Interactive bang command (`!`) | `AgentSession.executeBash` + `BashExecutionComponent` | No (uses executor directly)                                          | Dedicated bash execution component                                       | Controller catches exceptions and shows UI error |
| RPC `bash` command             | `rpc-mode` -> `session.executeBash`                   | No                                                                   | Returns `BashResult` directly                                            | Consumer handles returned fields                 |

## Filesystem containment: what enforces it, and where

The bash tool's filesystem boundary is enforced below the command text — the shell's own `cd` and
redirections are checked where they act, and spawned children are confined by the operating system. Which
OS mechanism does that depends on the host, and on one host family there is **no OS mechanism at all**.

`xcsh://about` reports the active backend for the machine you are on. This table is for planning a fleet
before you get there.

| Host | Kernel | Landlock ABI | Backend | Boundary |
| ---- | ------ | ------------ | ------- | -------- |
| macOS | — | — | `seatbelt` | OS-enforced |
| RHEL 9 and derivatives | 5.14 | 1 | `scanner-only` | **command-text scan only** |
| Ubuntu 22.04, stock GA kernel | 5.15 | 1 | `scanner-only` | **command-text scan only** |
| Debian 12 | 6.1 | 2 | `landlock` | OS-enforced; `truncate(2)` ungoverned |
| Ubuntu 22.04 HWE, Ubuntu 24.04 | 6.8 | 4 | `landlock` | OS-enforced |
| Fedora current | 6.1x–7.x | 6–9 | `landlock` | OS-enforced |

ABI numbers are anchored on two measured hosts: kernel 6.8.0-azure reports ABI 4, kernel 7.1.3 reports
ABI 9. The rest follow the kernel-to-ABI mapping.

### Why ABI 1 gets no OS boundary

`LANDLOCK_ACCESS_FS_REFER` does not exist before ABI 2, and the kernel denies cross-directory `rename` and
`link` whenever a ruleset handles *any* filesystem right. On ABI 1 there is therefore no way to permit
`mv a/x b/x`, and no way for `git` to do its write-tmp-then-rename. Confining on ABI 1 would break ordinary
work, which this boundary's design forbids, so it is refused rather than degraded.

That is a deliberate trade and not a bug to work around: the alternative is a boundary that breaks `git`.

### What scanner-only means in practice

The command-text scan is still there and still refuses out-of-tree paths, but it reads what was *written*
rather than what the shell will *do*. A path assembled at runtime — `P=/other/customer/secrets; cat "$P"`
— is not caught. Treat it as a statement of intent, not a guarantee.

**If sessions on an ABI 1 host handle more than one customer's data, that is a materially weaker posture
than the macOS default**, and the remedy is operational rather than a code change: run a newer kernel
(Ubuntu 22.04 HWE is the smallest step), or run those sessions in a container on a newer host.

### Debian 12 / ABI 2

Landlock confines every read and every write, but `LANDLOCK_ACCESS_FS_TRUNCATE` only exists from ABI 3, so
`truncate(2)` on a path outside the boundary is not governed. It destroys rather than discloses, and is
unreachable through `>`. `containmentStatus` reports this as `truncationUngoverned` and `xcsh://about`
states it, so the session knows.

## Operational caveats

- Interceptor only blocks commands when suggested tool is currently available in context.
- If artifact allocation fails, truncation still occurs but no `artifact://` back-reference is available.
- Shell session cache has no explicit eviction in this module; lifetime is process-scoped.
- PTY and non-PTY timeout surfaces differ:
  - PTY exposes explicit `timedOut` result field,
  - non-PTY maps timeout into `cancelled + annotation` summary.

## Implementation files

- [`src/tools/bash.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/tools/bash.ts) — tool entrypoint, normalization/interception, PTY/non-PTY selection, result/error mapping, bash tool renderer.
- [`src/tools/bash-normalize.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/tools/bash-normalize.ts) — command normalization and post-run head/tail filtering.
- [`src/tools/bash-interceptor.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/tools/bash-interceptor.ts) — interceptor rule matching and blocked-command messages.
- [`src/exec/bash-executor.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/exec/bash-executor.ts) — non-PTY executor, shell session reuse, cancellation wiring, output sink integration.
- [`src/tools/bash-interactive.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/tools/bash-interactive.ts) — PTY runtime, overlay UI, input normalization, non-interactive env defaults.
- [`src/session/streaming-output.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/session/streaming-output.ts) — `OutputSink` truncation/artifact spill and summary metadata.
- [`src/tools/output-utils.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/tools/output-utils.ts) — artifact allocation helpers and streaming tail buffer.
- [`src/tools/output-meta.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/tools/output-meta.ts) — truncation metadata shape + notice injection wrapper.
- [`src/session/agent-session.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/session/agent-session.ts) — session-level `executeBash`, message recording, abort lifecycle.
- [`src/modes/components/bash-execution.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/modes/components/bash-execution.ts) — interactive `!` command execution component.
- [`src/modes/controllers/command-controller.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/modes/controllers/command-controller.ts) — wiring for interactive `!` command UI stream/update completion.
- [`src/modes/rpc/rpc-mode.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/modes/rpc/rpc-mode.ts) — RPC `bash` and `abort_bash` command surface.
- [`src/internal-urls/artifact-protocol.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://<id>` resolution.
