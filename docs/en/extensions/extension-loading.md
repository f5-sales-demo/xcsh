---
title: Extension Loading (TypeScript/JavaScript Modules)
description: TypeScript and JavaScript module loading pipeline for extensions with resolution, validation, and caching.
sidebar:
  order: 2
  label: Extension loading
---

This document describes how the xcsh coding agent discovers, resolves, and loads TypeScript and JavaScript extension modules (`.ts` and `.js`) during session startup.

For `gemini-extension.json` declarative manifest extensions, refer to the manifest extension documentation.

## Pipeline overview

The extension loading subsystem constructs a prioritized list of entry points, dynamically imports each module with Bun, executes its factory function, and returns:

- Successfully loaded extension definitions.
- Structured per-path load errors that do not interrupt overall initialization.
- A shared runtime context consumed by `ExtensionRunner`.

## Primary implementation files

- `src/extensibility/extensions/loader.ts`: Path discovery, dynamic module importing, and factory execution.
- `src/extensibility/extensions/index.ts`: Public exports and API surface.
- `src/extensibility/extensions/runner.ts`: Post-load runtime lifecycle and event execution.
- `src/discovery/builtin.ts`: Native capability auto-discovery provider.
- `src/config/settings.ts`: Configuration merging for `extensions` and `disabledExtensions`.

## Inputs to extension discovery

### 1. Auto-discovered native extension modules

`discoverAndLoadExtensions()` queries discovery providers for `extension-module` capabilities and extracts native items from the following locations:

- **Project scope**: `<cwd>/.xcsh/extensions`
- **User scope**: `~/.xcsh/agent/extensions`

Roots are determined by the native provider (`SOURCE_PATHS.native`).

- Native auto-discovery targets `.xcsh` directories.
- Legacy `.pi` manifest keys (`pi.extensions`) remain supported inside `package.json`, but `.pi` directory paths are no longer scanned as native roots.

### 2. Explicitly configured paths

Following auto-discovery, the loader resolves and appends explicitly configured paths from two sources in `sdk.ts`:

1. **CLI arguments**: Paths supplied via `--extension` (`-e`) or `--hook`.
2. **Settings**: The `extensions` array defined in merged configuration files:
   - Global: `~/.xcsh/agent/config.yml` (or custom paths via `PI_CODING_AGENT_DIR`).
   - Project: `<cwd>/.xcsh/settings.json`.

Examples:

```yaml
# ~/.xcsh/agent/config.yml
extensions:
  - ~/my-extensions/safety.ts
  - ./local/extension-pack
```

```json
{
  "extensions": ["./.xcsh/extensions/custom-checks"]
}
```

## Enabling and disabling extensions

### Disabling discovery globally

- **CLI flag**: `--no-extensions`
- **SDK option**: `disableExtensionDiscovery: true`

Operational differences:

- **SDK**: Setting `disableExtensionDiscovery: true` disables automated scanning while continuing to load paths passed through `additionalExtensionPaths`.
- **CLI**: Specifying `--no-extensions` suppresses both auto-discovery and explicit `-e`/`--hook` arguments.

### Disabling specific extension modules

Use the `disabledExtensions` setting with the canonical extension identifier:

```yaml
disabledExtensions:
  - extension-module:guardrails
```

Identifier names derive from entry paths via `getExtensionNameFromPath`:

- `/path/to/guardrails.ts` maps to `extension-module:guardrails`.
- `/path/to/audit/index.ts` maps to `extension-module:audit`.

## Path and entry resolution

### Path normalization

Configured paths undergo normalization before resolution:

1. Normalize Unicode whitespace characters.
2. Expand home directory tildes (`~`).
3. Resolve relative paths against the current working directory (`cwd`).

### Resolving file paths

When a configured path points directly to a file, the loader evaluates it as a module entry candidate.

### Resolving directory paths

When a configured path targets a directory, the loader resolves entry points in the following order:

1. `package.json` with an `xcsh.extensions` array (or legacy `pi.extensions`).
2. `index.ts`.
3. `index.js`.
4. Single-level subdirectory scanning:
   - Direct `*.ts` and `*.js` files.
   - Subdirectory `index.ts` and `index.js` files.
   - Subdirectory `package.json` manifests declaring `xcsh.extensions`.

Resolution rules:

- Directory scans do not recurse beyond one subdirectory level.
- Manifest entries resolve relative to their containing `package.json` directory.
- Candidate files must exist and possess readable permissions.
- When both `index.ts` and `index.js` exist in the same directory, TypeScript takes precedence.
- Symbolic links are followed and treated as standard files or directories.

### Ignore filter behavior

- Native auto-discovery (`discoverExtensionModulePaths`) enforces `.gitignore` rules (`gitignore: true`) and ignores hidden directories (`hidden: false`).
- Direct directory scanning in `loader.ts` reads filesystem entries without `.gitignore` filtering.

## Loading order and precedence

`discoverAndLoadExtensions()` constructs an ordered module list:

1. Auto-discovered native modules.
2. Explicitly configured CLI paths.
3. Explicitly configured settings paths.

Deduplication rules:

- Deduplication operates on normalized absolute paths.
- The first occurrence of a path takes precedence; subsequent duplicates are discarded.
- When a module path is both auto-discovered and explicitly configured, it loads during the auto-discovery phase.

## Module imports and factory contracts

The loader imports candidate modules dynamically:

```ts
const imported = await import(resolvedPath);
const factory = imported.default ?? imported;
```

The exported factory must adhere to the `ExtensionFactory` function signature. If an export is not a function, the loader records a structured error and proceeds with subsequent modules.

## Error handling and execution isolation

### Load-time failure handling

Failures are isolated per module path as `{ path, error }` records. A failure in one extension does not prevent other extensions from loading.

Common failure conditions:

- Missing entry files or module resolution failures.
- Non-function exports.
- Exceptions thrown during factory execution.

### Runtime isolation model

- Extensions execute within the host process and share runtime memory.
- Extensions interact through a shared `EventBus` and `ExtensionRuntime` instance.
- Direct runtime action invocations throw `ExtensionRuntimeNotInitializedError` during load; action dispatch initializes later in `ExtensionRunner.initialize()`.

### Post-load error propagation

When `ExtensionRunner` dispatches events, handler exceptions are caught and emitted as extension error events rather than crashing the agent loop.

## Project and user directory structures

### User-level layout

```text
~/.xcsh/agent/
  config.yml
  extensions/
    guardrails.ts
    audit/
      index.ts
```

### Project-level layout

```text
<repo>/
  .xcsh/
    settings.json
    extensions/
      lint-gates.ts
      checks/
        package.json
        src/
          check-a.ts
          check-b.js
```

`checks/package.json` declaration:

```json
{
  "xcsh": {
    "extensions": ["./src/check-a.ts", "./src/check-b.js"]
  }
}
```
