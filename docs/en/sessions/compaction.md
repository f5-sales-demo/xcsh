---
title: Compaction and Branch Summaries
description: Context window compaction and branch summary generation for long-lived sessions.
sidebar:
  order: 5
  label: Compaction
---

# Compaction and branch summaries

Compaction and branch summaries preserve critical context across long-running or branching sessions while fitting within LLM context windows.

- **Compaction**: Replaces older turn history on the active branch with a generated summary.
- **Branch summary**: Captures abandoned branch context during `/tree` navigation when switching leaves.

Both mechanisms store structured session entries that `buildSessionContext()` transforms into LLM-visible context.

## Session entry models

Compaction and branch summaries are first-class session entries in `packages/coding-agent`:

- **`CompactionEntry`**:
  - `type: "compaction"`
  - `summary`, optional `shortSummary`
  - `firstKeptEntryId`: ID of the oldest message retained after the compaction boundary
  - `tokensBefore`: Token count prior to compression
  - Optional `details`, `preserveData`, `fromExtension`
- **`BranchSummaryEntry`**:
  - `type: "branch_summary"`
  - `fromId`: Origin branch leaf ID
  - `summary`: Markdown summary of abandoned branch work
  - Optional `details`, `fromExtension`

## Compaction pipeline

### Execution triggers

Compaction triggers in three scenarios:

1. **Manual compaction**: The user runs `/compact [instructions]`, calling `AgentSession.compact()`.
2. **Context overflow recovery**: Triggered automatically when an assistant error matches context limit boundaries.
3. **Threshold compaction**: Triggered after a turn when total tokens exceed `contextWindow - compaction.reserveTokens`.

### Pre-compaction tool pruning

Before generating summary text, xcsh prunes large tool execution outputs (`pruneToolOutputs`):

- Retains the most recent 40,000 tool-output tokens unpruned.
- Requires a minimum threshold of 20,000 estimated savings to trigger pruning.
- Excludes output from `skill` and `read` tools from pruning.
- Replaces pruned outputs with `[Output truncated - N tokens]`.

### Context boundary calculation

`prepareCompaction()` calculates boundaries relative to previous compaction entries:

1. Identifies the previous compaction index.
2. Sets `boundaryStart = prevCompactionIndex + 1`.
3. Adapts `keepRecentTokens` using empirical token usage ratios.
4. Locates a valid cut point avoiding tool result boundaries (`toolResult` entries are never cut points).

## Branch summarization pipeline

When navigating session trees via `/tree` or `navigateTree()`:

1. Collects abandoned entries from the prior leaf up to the nearest common ancestor.
2. If `options.summarize` is enabled, generates a structured branch summary using `generateBranchSummary()`.
3. Attaches the summary to the navigation target using `branchWithSummary()`.

## Configuration settings

Configure compaction and summarization behavior in settings:

- `compaction.enabled`: Defaults to `true`.
- `compaction.reserveTokens`: Buffer allocated for completions (default: `16384`).
- `compaction.keepRecentTokens`: Minimum recent tokens preserved uncompacted (default: `20000`).
- `compaction.autoContinue`: Automatically injects a continuation prompt after threshold compaction (default: `true`).
- `branchSummary.enabled`: Automatically summarizes abandoned branches during tree navigation (default: `false`).

## Related implementation files

- `src/session/compaction/compaction.ts`: Core compaction algorithms and boundary selection.
- `src/session/compaction/branch-summarization.ts`: Tree navigation branch summarization.
- `src/session/compaction/pruning.ts`: Tool output pruning heuristics.
- `src/session/session-manager.ts`: Session entry persistence and history trees.
- `src/session/agent-session.ts`: Compaction coordinator and runtime hooks.

