---
title: Task Agent Discovery and Selection
description: Task agent discovery and selection logic for routing work to specialized subagent types.
sidebar:
  order: 6
  label: Task agent discovery
---

# Task agent discovery and selection

This document describes how the task subsystem discovers agent definitions, merges configuration sources across priority levels, and resolves agents during execution in `packages/coding-agent`.

## Agent definition schema

Task agents are represented as `AgentDefinition` records (`src/task/types.ts`):

- **`name`**: Unique identifier for the agent.
- **`description`**: Human-readable overview of the agent's capabilities.
- **`systemPrompt`**: Base prompt instructing agent behavior.
- **`tools`**: Permitted tool names (CSV or array; `submit_result` is automatically added).
- **`spawns`**: Allowed subagent names (`*` allows spawning any registered agent).
- **`model`**: Optional model override.
- **`thinkingLevel`**: Optional reasoning effort budget.
- **`source`**: Origin tier (`"bundled"`, `"user"`, or `"project"`).

## Discovery sources and precedence

The task subsystem discovers agents across four configuration tiers, evaluated in priority order:

1. **Native configuration (`.xcsh`)**: Project (`<CWD>/.xcsh/agents/*.md`), then user (`~/.xcsh/agent/agents/*.md`).
2. **Claude Code compatibility (`.claude`)**: Project (`<CWD>/.claude/agents/*.md`), then user (`~/.claude/agents/*.md`).
3. **Codex CLI compatibility (`.codex`)**: Project (`<CWD>/.codex/agents/*.md`), then user (`~/.codex/agents/*.md`).
4. **Claude plugins**: Scans plugin roots defined in `~/.claude/plugins/installed_plugins.json`.
5. **Bundled system agents**: Embedded defaults (`explore`, `plan`, `designer`, `reviewer`, `task`, `quick_task`).

### Collision resolution

When agent names conflict across files or providers, xcsh uses first-wins deduplication:

- Project configurations override user configurations within the same provider.
- Higher-priority providers (`.xcsh`) override lower-priority providers (`.claude`, `.codex`).
- Custom user or project definitions override bundled system agents.

## Execution guardrails and constraints

Even when discovered, agents may be constrained at runtime by security policies:

- **Spawn permissions**: The parent session enforces `session.getSessionSpawns()`. If the target agent is not permitted, execution is rejected.
- **Recursion depth limits**: Subprocess depth is bounded by `task.maxRecursionDepth`. Upon reaching maximum depth, child sessions lose access to the `task` tool.
- **Direct self-recursion guards**: Agents matching `PI_BLOCKED_AGENT` are prevented from spawning recursively.

## Related implementation files

- `src/task/discovery.ts`: Multi-source agent discovery and collision deduplication.
- `src/task/agents.ts`: Bundled system agent definitions and cache management.
- `src/task/types.ts`: `AgentDefinition` TypeScript interfaces and schema types.
- `src/task/executor.ts`: Task execution engine, subprocess management, and depth limits.

