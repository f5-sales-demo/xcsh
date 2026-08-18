---
title: Slash Command Internals
description: Slash command system internals with registration, argument parsing, and execution dispatch.
sidebar:
  order: 5
  label: Slash commands
---

This document describes how slash commands are discovered, deduplicated, evaluated in interactive sessions, and expanded during prompt processing in `packages/coding-agent`.

## Capability discovery and precedence

Slash commands are managed as an extensible capability (`id: "slash-commands"`) identified by command name.

When scanning for available commands, the capability registry queries providers in descending priority order:

1. `native` (xcsh commands): Priority `100` (`<CWD>/.xcsh/commands/*.md`, `~/.xcsh/agent/commands/*.md`)
2. `claude` (Claude Code compatibility): Priority `80` (`~/.claude/commands/*.md`, `<CWD>/.claude/commands/*.md`)
3. `claude-plugins` (Claude marketplace plugins): Priority `70`
4. `codex` (Codex CLI compatibility): Priority `70` (`~/.codex/commands/*.md`, `<CWD>/.codex/commands/*.md`)

### Collision resolution

When multiple providers define a command with the same name, the registry retains the highest-priority command and marks duplicates as shadowed (`_shadowed: true`).

Within the `native` provider, project commands (`<CWD>/.xcsh/commands/`) take precedence over user commands (`~/.xcsh/agent/commands/`).

## Command template format and argument expansion

File-based slash commands are Markdown files with optional YAML frontmatter:

```markdown
---
description: Run test suites with code coverage reporting
---
Execute tests for $1 with coverage enabled:

npm test -- --coverage $ARGUMENTS
```

### Argument substitution variables

When a user executes `/command arg1 arg2`, the prompt engine substitutes positional and aggregate tokens:

- `$1`, `$2`, ...: Positional arguments (supports single `'...'` and double `"..."` quotes).
- `$ARGUMENTS` or `$@`: Complete argument string trailing the command name.
- Template rendering: Renders expressions using the template engine context (`{ args, ARGUMENTS, arguments }`).

## Prompt execution pipeline

When user input is submitted, `AgentSession.prompt()` evaluates input through the following stages:

1. **Extension commands**: Synchronously executes commands registered by active extensions.
2. **TypeScript custom commands**: Executes programmatic commands registered via `session.customCommands`.
3. **File-based slash commands**: Expands matching Markdown command templates.
4. **Prompt templates**: Resolves prompt template macros and variables.
5. **Model delivery**: Dispatches the fully expanded prompt to the active LLM context or queues the message during active streaming turns.

## Related implementation files

- `src/extensibility/slash-commands.ts`: Command loader, frontmatter parsing, and argument replacement.
- `src/capability/slash-command.ts`: Capability definition and validation schemas.
- `src/discovery/builtin.ts`: Native xcsh command discovery provider.
- `src/discovery/claude.ts`: Claude Code command discovery provider.
- `src/discovery/codex.ts`: Codex CLI command discovery provider.
- `src/session/agent-session.ts`: Prompt dispatch pipeline and execution interception.
