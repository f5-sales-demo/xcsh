---
title: Custom Tools
description: Custom tool registration, schema definition, and execution pipeline for extending the agent.
sidebar:
  order: 4
  label: Custom tools
---

Custom tools are user-defined functions callable by LLMs that integrate with the native tool execution pipeline alongside built-in operations.

A custom tool is implemented as a TypeScript or JavaScript module exporting a factory function. The factory receives host capabilities (`CustomToolAPI`) and returns one or more tool definitions.

## Terminology boundaries

- **Custom tool**: Model-callable function defining a TypeBox schema and execution handler.
- **Extension**: Lifecycle and event framework capable of registering tools and intercepting agent events.
- **Hook**: External scripts executed before or after CLI commands.
- **Skill**: Documentation and prompt guidance package providing task-specific context.

## Discovery and registration workflows

xcsh loads custom tools through two mechanisms:

1. **SDK programmatic configuration**: Provided via `options.customTools` in the coding agent bootstrap configuration.
2. **Filesystem discovery**: Discovered automatically across configuration directories:
   - Native xcsh tools: `~/.xcsh/agent/tools/`, `.xcsh/tools/`
   - Claude-compatible tools: `~/.claude/tools/`, `.claude/tools/`
   - Codex-compatible tools: `~/.codex/tools/`, `.codex/tools/`
   - Installed plugins: `~/.xcsh/plugins/node_modules/*`

## Module structure and factory pattern

A custom tool module exports a factory conforming to `CustomToolFactory`:

```typescript
import type { CustomToolFactory } from "@f5-sales-demo/xcsh";

const factory: CustomToolFactory = (pi) => ({
  name: "repo_stats",
  label: "Repository statistics",
  description: "Computes file metrics across the repository",
  parameters: pi.typebox.Type.Object({
    glob: pi.typebox.Type.Optional(pi.typebox.Type.String({ default: "**/*.ts" })),
  }),

  async execute(toolCallId, params, onUpdate, ctx, signal) {
    onUpdate?.({
      content: [{ type: "text", text: "Scanning repository files..." }],
      details: { phase: "scan" },
    });

    const result = await pi.exec("git", ["ls-files", params.glob ?? "**/*.ts"], {
      signal,
      cwd: pi.cwd,
    });

    if (result.killed) {
      throw new Error("Scan was aborted");
    }
    if (result.code !== 0) {
      throw new Error(result.stderr || "Failed to list tracked files");
    }

    const files = result.stdout.split("\n").filter(Boolean);
    return {
      content: [{ type: "text", text: `Found ${files.length} matching files` }],
      details: { count: files.length, sample: files.slice(0, 10) },
    };
  },

  onSession(event) {
    if (event.reason === "shutdown") {
      // Clean up background resources
    }
  },
});

export default factory;
```

## Host API surface (`CustomToolAPI`)

Factory functions receive a `CustomToolAPI` instance containing:

- `cwd`: Active workspace directory path.
- `exec(command, args, options?)`: Subprocess execution utility with signal forwarding.
- `ui`: TUI interaction context (no-op in headless environments).
- `hasUI`: Boolean indicating interactive graphical availability.
- `logger`: Structured logging facility.
- `typebox`: Injected TypeBox instance for schema definitions.

## Lifecycle and cancellation handling

- **Execution validation**: Parameters are validated against the TypeBox schema prior to executing `execute()`.
- **Cancellation propagation**: Pass `signal` to asynchronous operations to handle user interruptions cleanly.
- **Session events**: Optional `onSession(event, ctx)` callbacks receive lifecycle notifications (`start`, `branch`, `shutdown`, `auto_compaction_start`).
