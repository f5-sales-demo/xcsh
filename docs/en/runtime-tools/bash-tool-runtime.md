---
title: Bash Tool Runtime
description: Bash tool runtime with shell process management, sandboxing, timeout, and output streaming.
sidebar:
  order: 1
  label: Bash tool
---

This document describes the execution pipeline of the `bash` tool in `packages/coding-agent`, covering command normalization, interception rules, process sandboxing, output truncation, and UI rendering across execution modes.

## Execution entry points

xcsh provides two distinct shell execution interfaces:

1. **Agent tool interface (`bash`)**: Invoked by LLMs during conversation turns. Supports command normalization, security interception, PTY emulation, and structured output formatting.
   - Entry point: `BashTool.execute()`
2. **User shell execution (`!cmd`)**: Direct shell execution triggered by user input in the TUI or RPC mode.
   - Entry point: `AgentSession.executeBash()`

Both execution paths utilize the underlying `executeBash()` engine in `src/exec/bash-executor.ts` for non-interactive execution.

## Execution pipeline

### 1. Command normalization and argument parsing

When a tool call occurs, `BashTool.execute()` normalizes command strings via `normalizeBashCommand()`:

- Extracts trailing pipe limits (`| head -n N`, `| tail -n N`) into structured pagination parameters.
- Trims outer whitespace while preserving internal arguments and heredocs.
- Merges extracted limits with explicit `head` or `tail` parameters (explicit arguments take precedence).

### 2. Command interception and rule enforcement

If `bashInterceptor.enabled` is active, the tool checks the command against configured regex rules before spawning processes:

- **Rule evaluation**: Blocks commands when patterns match (e.g., using `cat` or `grep` when specialized tools exist) and the suggested alternative tool is present in active context (`ctx.toolNames`).
- **Rejection behavior**: Raises a `ToolError` containing the blocking reason and guidance toward preferred tools (`view_file`, `grep_search`, `list_dir`, `replace_file_content`).

### 3. Working directory validation and timeouts

- Resolves working directories relative to session root (`resolveToCwd`).
- Validates that directory paths exist and are accessible directories prior to execution.
- Clamps timeout durations to the range of 1 to 3600 seconds (default: 30 seconds).

### 4. Interactive PTY vs. non-interactive execution

xcsh chooses PTY execution (`runInteractiveBashPty`) when all of the following conditions are met:

- `bash.virtualTerminal` is configured to `on`.
- `PI_NO_PTY` is not set to `1`.
- The session has an active graphical/TUI terminal context (`ctx.hasUI === true`).

In headless, print, or RPC modes, xcsh always uses non-interactive execution.

## Output streaming, truncation, and artifact spill

Output is processed through `OutputSink` in `src/session/streaming-output.ts`:

- **Memory buffer**: Maintains a UTF-8-safe tail buffer (default: 50 KB).
- **Artifact spillover**: When output exceeds the buffer threshold, xcsh writes the full stream to disk in artifact storage (`artifact://<ID>`).
- **Truncation notice**: Injects truncation summaries into tool results, including total byte/line counts and artifact links for full-output retrieval.

## Filesystem sandboxing and containment

xcsh enforces filesystem containment boundaries using platform-native security primitives:

| Platform | Kernel version | Security backend | Boundary enforcement |
| -------- | -------------- | ---------------- | -------------------- |
| macOS | Any | `seatbelt` | OS-enforced kernel sandbox |
| Linux (modern) | Kernel ≥ 6.1 (Debian 12, Ubuntu 24.04, Fedora) | `landlock` (ABI ≥ 2) | OS-enforced kernel sandbox |
| Linux (legacy) | Kernel < 6.1 (RHEL 9, Ubuntu 22.04 GA) | `scanner-only` | Command-text static analysis |

> [!IMPORTANT]
> On legacy Linux kernels with Landlock ABI 1 (kernel < 6.1), xcsh operates in `scanner-only` mode because ABI 1 lacks `LANDLOCK_ACCESS_FS_REFER` (which prevents `git` and `mv` operations). For full OS-enforced isolation, deploy on Linux kernels 6.1 or newer.

## Related implementation files

- `src/tools/bash.ts`: Tool definition, normalization, and rendering logic.
- `src/tools/bash-normalize.ts`: Command string normalization and line limit extraction.
- `src/tools/bash-interceptor.ts`: Pattern matching rules for command redirection.
- `src/exec/bash-executor.ts`: Process execution engine and shell session reuse.
- `src/tools/bash-interactive.ts`: Virtual PTY runtime and terminal input handling.
- `src/session/streaming-output.ts`: `OutputSink` buffer management and artifact spillover.
