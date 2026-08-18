---
title: Skills
description: Skills system for registering, discovering, and invoking specialized capabilities in the coding agent.
sidebar:
  order: 3
  label: Skills
---

Skills are modular, file-backed capability packages discovered at session startup and exposed to the model through:

- Summary metadata in the system prompt (`name` and `description`).
- On-demand document retrieval via `skill://` URIs.
- Interactive slash commands (`/skill:<NAME>`).

## Core skill data model

A discovered skill represents the following metadata:

- `name`: Unique skill identifier.
- `description`: Functional summary used for model intent matching.
- `filePath`: Absolute filesystem path to the `SKILL.md` entry point.
- `baseDir`: Containing directory path for supporting reference files.
- `_source`: Source metadata tracking provider identity, configuration level, and origin path.

## Directory layout and file conventions

### Directory structure

Provider loaders scan for skills located exactly one subdirectory level below the configured root (`<ROOT>/skills/<SKILL_NAME>/SKILL.md`):

```text
skills/
├── postgres/
│   └── SKILL.md          # Discovered
├── pdf/
│   └── SKILL.md          # Discovered
└── team/
    └── internal/
        └── SKILL.md      # Not discovered (nested directory)
```

> [!NOTE]
> Custom directory scanning (`skills.customDirectories`) also operates non-recursively. Point `customDirectories` directly to the parent folder containing individual skill directories.

### `SKILL.md` frontmatter schema

`SKILL.md` files define metadata using YAML frontmatter:

```yaml
---
name: postgres-operations
description: PostgreSQL database query, migration, and troubleshooting procedures.
globs:
  - "**/*.sql"
alwaysApply: false
---
```

Frontmatter parsing rules:

- `name`: Defaults to the containing directory name when omitted.
- `description`: Required for the native `.xcsh` provider and custom directory scanners.
- `globs`: Optional array of file glob patterns associated with the skill domain.
- `alwaysApply`: Boolean flag indicating whether the skill content applies globally.

## Discovery pipeline and precedence

`discoverSkills()` (`src/extensibility/skills.ts`) executes a two-phase discovery workflow:

1. Capability provider scanning via `loadCapability("skills")`.
2. Custom directory scanning via `scanSkillsFromDir(...)`.

### Provider precedence

The discovery engine evaluates providers in descending priority order:

1. `native` (Priority `100`): Native `.xcsh` skills in user and project directories.
2. `claude` (Priority `80`): Claude Code skill locations.
3. Priority `70` providers:
   - `claude-plugins`
   - `agents`
   - `codex`

When skill names collide, the highest-precedence provider wins, shadowing lower-priority duplicates.

### Configuration filters

Skills discovery applies the following configuration filters:

- Provider toggles: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`.
- Name filters:
  - `ignoredSkills`: Array of glob patterns to exclude.
  - `includeSkills`: Optional allowlist of glob patterns to include.

## Runtime interaction models

### System prompt integration

When the `read` tool is enabled, `src/system-prompt.ts` appends a list of available skill names and descriptions to the system prompt. The model inspects this list and loads detailed instructions on demand using the `read` tool.

### Interactive slash commands (`/skill:<NAME>`)

When `skills.enableSkillCommands` is enabled, the CLI registers dynamic slash commands for each discovered skill:

- `/skill:<NAME> [<ARGS>]`: Reads `SKILL.md`, strips YAML frontmatter, and injects the document body into the session conversation context.

## The `skill://` URI protocol

The `skill://` protocol handler (`src/internal-urls/skill-protocol.ts`) provides sandboxed access to skill files:

- `skill://<NAME>`: Resolves to `<BASE_DIR>/SKILL.md`.
- `skill://<NAME>/<RELATIVE_PATH>`: Resolves to `<BASE_DIR>/<RELATIVE_PATH>`.

### Security boundaries

- Paths are URL-decoded and checked against directory traversal (`..`).
- Absolute paths and paths resolving outside `<BASE_DIR>` are rejected.
- Missing files return standard `File not found` error responses.

## Skills compared with other extensibility mechanisms

- **Skills vs AGENTS.md / XCSH.md**: Skills provide modular, on-demand reference workflows for specific domains. `AGENTS.md` and `XCSH.md` files provide persistent workspace instructions loaded directly into context.
- **Skills vs custom slash commands**: Skills provide markdown documentation and domain knowledge. Slash commands define user-facing interactive actions.
- **Skills vs custom tools**: Skills provide human-readable procedures and context. Custom tools provide executable JavaScript or TypeScript functions with typed parameter schemas.
- **Skills vs lifecycle hooks**: Skills provide passive guidance. Hooks provide event-driven intercepts that can validate or mutate tool execution.

## Authoring best practices

- Place each skill in a dedicated directory containing a `SKILL.md` entry point.
- Provide a clear, concise `description` in the YAML frontmatter to guide model tool selection.
- Store reference scripts, templates, and schemas within the skill directory and link to them using `skill://<NAME>/...` URIs.
- Ensure skill names are unique across registered providers.
