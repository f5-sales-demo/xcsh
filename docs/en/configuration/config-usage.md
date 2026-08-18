---
title: Configuration Discovery and Resolution
description: How xcsh discovers, resolves, and layers configuration from project, user, and enterprise roots.
sidebar:
  order: 1
  label: Configuration
---

# Configuration discovery and resolution

This document describes how the coding agent resolves configuration: which roots are scanned, how precedence works, and how resolved settings are consumed by capabilities, skills, hooks, tools, and extensions.

## Scope

Primary implementation:

- `src/config.ts`
- `src/config/settings.ts`
- `src/config/settings-schema.ts`
- `src/discovery/builtin.ts`
- `src/discovery/helpers.ts`

Key integration points:

- `src/capability/index.ts`
- `src/discovery/index.ts`
- `src/extensibility/skills.ts`
- `src/extensibility/hooks/loader.ts`
- `src/extensibility/custom-tools/loader.ts`
- `src/extensibility/extensions/loader.ts`

---

## Resolution flow

```text
         Config roots (ordered)
┌───────────────────────────────────────┐
│ 1) ~/.xcsh/agent + <cwd>/.xcsh        │
│ 2) ~/.claude   + <cwd>/.claude        │
│ 3) ~/.codex    + <cwd>/.codex         │
│ 4) ~/.gemini   + <cwd>/.gemini        │
└───────────────────────────────────────┘
                    │
                    ▼
        config.ts helper resolution
  (getConfigDirs/findConfigFile/findNearest...)
                    │
                    ▼
       capability providers enumerate items
 (native, claude, codex, gemini, agents, etc.)
                    │
                    ▼
   priority sort + per-capability deduplication
                    │
                    ▼
          subsystem-specific consumption
   (settings, skills, hooks, tools, extensions)
```

## Config roots and source order

### Canonical roots

`src/config.ts` defines a fixed source priority order:

1. `.xcsh` (native)
2. `.claude`
3. `.codex`
4. `.gemini`

User-level configuration bases:

- `~/.xcsh/agent`
- `~/.claude`
- `~/.codex`
- `~/.gemini`

Project-level configuration bases:

- `<cwd>/.xcsh`
- `<cwd>/.claude`
- `<cwd>/.codex`
- `<cwd>/.gemini`

The default `CONFIG_DIR_NAME` constant is `.xcsh` (`packages/utils/src/dirs.ts`).

### Source discovery constraints

The generic helpers in `src/config.ts` do not include `.pi` in automatic source discovery order.

---

## Core discovery helpers

### `getConfigDirs(subpath, options)`

Returns ordered directory entries:

- User-level entries first (sorted by source priority).
- Project-level entries second (sorted by source priority).

Supported options:

- `user` (default: `true`)
- `project` (default: `true`)
- `cwd` (default: `getProjectDir()`)
- `existingOnly` (default: `false`)

This API handles directory-based configuration lookups (commands, hooks, tools, agents, and related assets).

### `findConfigFile(subpath, options)` and `findConfigFileWithMeta(...)`

Searches for the first existing configuration file across ordered base paths, returning the first match (as path-only or path with metadata).

### `findAllNearestProjectConfigDirs(subpath, cwd)`

Traverses parent directories upward and returns the nearest existing directory per source base (`.xcsh`, `.claude`, `.codex`, `.gemini`), then sorts the results by source priority.

Use this helper when project configuration should be inherited from ancestor directories in monorepos or nested workspaces.

---

## File configuration wrapper

`ConfigFile<T>` (`src/config.ts`) provides schema-validated loading for individual configuration files.

Supported file formats:

- `.yml` and `.yaml`
- `.json` and `.jsonc`

Runtime behavior:

- Validates parsed data with AJV against a provided TypeBox schema.
- Caches the load result in memory until `invalidate()` is called.
- Returns a tri-state result from `tryLoad()`:
  - `ok`: Valid parsed configuration data.
  - `not-found`: Configuration file does not exist.
  - `error`: Returns `ConfigError` containing schema validation or parse error details.

Automatic migration support:

- If the target path is `.yml` or `.yaml`, a sibling `.json` file is automatically migrated once (`migrateJsonToYml`).

---

## Settings resolution model

The runtime settings model applies layered resolution:

1. Global settings: `~/.xcsh/agent/config.yml`
2. Project settings: Discovered via settings capability (`settings.json` from capability providers)
3. Runtime overrides: In-memory, non-persistent overrides
4. Schema defaults: Defined in `SETTINGS_SCHEMA`

Effective resolution order:

`defaults <— global <— project <— overrides`

Persistence behavior:

- `settings.set(...)` writes to the global layer (`config.yml`) and queues an asynchronous background save.
- Project settings discovered from capabilities are read-only at runtime.

### Active migration behaviors

On startup, if `config.yml` is missing:

1. Migrates settings from `~/.xcsh/agent/settings.json` (renaming the original to `.bak` upon success).
2. Merges settings with legacy database values from `agent.db`.
3. Writes the combined result to `config.yml`.

Field-level migrations executed in `#migrateRawSettings`:

- `queueMode` to `steeringMode`
- `ask.timeout` milliseconds converted to seconds when the existing value exceeds `1000`
- Legacy flat `theme: "..."` converted to `{ theme: { dark, light } }` structure

---

## Capability and discovery integration

Non-core configuration loading flows through the capability registry (`src/capability/index.ts` and `src/discovery/index.ts`).

### Provider ordering

Providers are sorted by numeric priority in descending order (higher numeric values take precedence). Standard priority values include:

- Native provider (`builtin.ts`): `100`
- Claude: `80`
- Codex, agents, and Claude marketplace: `70`
- Gemini: `60`

```text
Provider precedence (higher priority wins)

native (.xcsh)          priority 100
claude                 priority  80
codex / agents / ...   priority  70
gemini                 priority  60
```

### Deduplication semantics

Capabilities define a `key(item)` function:

- Matching key: The first item encountered wins (retaining the higher-priority or earlier-loaded item).
- Undefined key: No deduplication occurs; all items are preserved.

Deduplication keys by capability:

- Skills: `name`
- Tools: `name`
- Hooks: `${type}:${tool}:${name}`
- Extension modules: `name`
- Extensions: `name`
- Settings: No deduplication (all items are preserved)

---

## Native `.xcsh` provider behavior

The native provider (`id: native`, defined in `src/discovery/builtin.ts`) reads from:

- Project roots: `<cwd>/.xcsh/...`
- User roots: `~/.xcsh/agent/...`

### Directory admission rule

`builtin.ts` includes a configuration root only if the directory exists and is non-empty (`ifNonEmptyDir`).

### Scope-specific loading paths

- Skills: `skills/*/SKILL.md`
- Slash commands: `commands/*.md`
- Rules: `rules/*.{md,mdc}`
- Prompts: `prompts/*.md`
- Instructions: `instructions/*.md`
- Hooks: `hooks/pre/*` and `hooks/post/*`
- Tools: `tools/*.json`, `tools/*.md`, and `tools/<name>/index.ts`
- Extension modules: Discovered under `extensions/` (plus legacy `settings.json.extensions` string array)
- Extensions: `extensions/<name>/gemini-extension.json`
- Settings capability: `settings.json`

### Nearest-project lookup behavior

For `SYSTEM.md` and `XCSH.md`, the native provider searches parent project `.xcsh` directories upward, requiring the matched `.xcsh` directory to be non-empty.

---

## How major subsystems consume configuration

### Settings subsystem

- `Settings.init()` loads global `config.yml` alongside discovered project `settings.json` capability items.
- Only capability items with `level === "project"` merge into the project layer.

### Skills subsystem

- `extensibility/skills.ts` loads skills using `loadCapability(skillCapability.id, { cwd })`.
- Applies source toggles and filters (`ignoredSkills`, `includeSkills`, custom directories).
- Legacy toggle names (`skills.enablePiUser`, `skills.enablePiProject`) gate the native provider (`provider === "native"`).

### Hooks subsystem

- `discoverAndLoadHooks()` resolves hook paths from the hook capability and explicitly configured paths.
- Loads modules using dynamic Bun imports.

### Tools subsystem

- `discoverAndLoadCustomTools()` resolves tool paths from tool capabilities, plugin tool paths, and explicit paths.
- Declarative `.md` and `.json` tool files provide metadata only; executable loading requires TypeScript/JavaScript modules.

### Extensions subsystem

- `discoverAndLoadExtensions()` resolves extension modules from extension-module capabilities and explicit paths.
- The loader filters capability items to those with `_source.provider === "native"` before loading.

---

## Precedence rules and priority resolution

When reasoning about configuration precedence, apply this sequence:

1. Source directory ordering from `config.ts` determines candidate path order.
2. Capability provider priority determines cross-provider precedence.
3. Capability key deduplication determines collision behavior (the first item encountered wins for keyed capabilities).
4. Subsystem-specific merge logic determines the effective settings layer.

### Settings merge caveat

Settings capability items are not deduplicated; `Settings.#loadProjectSettings()` deep-merges project items in their returned order. Because deep merge overwrites earlier values with later values, effective overrides depend on provider emission order rather than capability key semantics alone.

---

## Legacy and compatibility behaviors

The runtime preserves the following backward-compatibility behaviors:

- `ConfigFile` JSON-to-YAML migration for YAML configuration files.
- Settings migration from `settings.json` and `agent.db` to `config.yml`.
- Settings key migrations (`queueMode`, `ask.timeout`, and flat `theme`).
- Extension manifest compatibility: The loader accepts both `package.json.xcsh` and `package.json.pi` manifest sections.
- Legacy setting names `skills.enablePiUser` and `skills.enablePiProject` remain active gates for the native skill provider.

When deprecating any compatibility path in code, update this document to maintain alignment with active runtime behavior.
