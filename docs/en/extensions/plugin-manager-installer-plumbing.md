---
title: Plugin Manager and Installer Plumbing
description: Plugin manager internals covering installation, validation, dependency resolution, and lifecycle management.
sidebar:
  order: 5
  label: Plugin manager
---

# Plugin manager and installer plumbing

This document describes how `xcsh plugin` operations manage plugin state on disk and how installed plugins become active runtime capabilities.

## Architecture and scope

The codebase provides two plugin management modules:

1. **Active CLI execution path**: `PluginManager` (`src/extensibility/plugins/manager.ts`).
2. **Legacy installer module**: Functions in `src/extensibility/plugins/installer.ts`.

All `xcsh plugin ...` CLI commands execute through `PluginManager`.

## Lifecycle: CLI invocation to runtime capabilities

The following sequence illustrates how plugin commands execute and activate capabilities:

1. Command entry point: `src/commands/plugin.ts` parses CLI flags and invokes `runPluginCommand(...)` in `src/cli/plugin-cli.ts`.
2. Action dispatch: `PluginManager` executes the requested lifecycle method (`install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`).
3. State mutation: The manager updates package descriptors and lockfiles in `~/.xcsh/plugins/` (`package.json`, `node_modules/`, `xcsh-plugins.lock.json`).
4. Capability discovery: During session initialization, `discoverAndLoadCustomTools(...)` queries `getAllPluginToolPaths(cwd)`.
5. Module loading: The custom tool loader imports tool definitions into the active runtime registry.

> [!NOTE]
> Package updates execute by running `install` with an updated package or version specification.

## On-disk state model

Global plugin state resides under `~/.xcsh/plugins/`:

- `package.json`: Dependency manifest managed by `bun install` and `bun uninstall`.
- `node_modules/`: Directory containing installed packages and symlinks.
- `xcsh-plugins.lock.json`: Persistent runtime state file recording:
  - Global enablement status per plugin.
  - Active feature configurations per plugin.
  - Plugin-specific setting key-value pairs.

Project-specific overrides reside at `<cwd>/.xcsh/plugin-overrides.json`. Project overrides take precedence over global lockfile settings to enable, disable, or reconfigure plugins for a specific workspace.

## Package specification parsing and metadata resolution

### Specification grammar

The `parsePluginSpec` utility (`parser.ts`) supports the following package specification patterns:

- `pkg`: Default feature selection policy (`features: null`).
- `pkg[*]`: Enables all features declared in the package manifest.
- `pkg[]`: Disables all optional features.
- `pkg[feat1,feat2]`: Enables explicitly specified features.
- `@scope/pkg@1.2.3[feat]`: Scoped, version-pinned package with explicit feature selection.

`extractPackageName` strips version suffixes to determine on-disk module paths.

### Manifest resolution order

The runtime resolves plugin manifests in the following order:

1. `package.json` `xcsh` block.
2. `package.json` `pi` block (legacy fallback).
3. Synthetic fallback manifest: `{ version: package.version }`.

Operational considerations:

- Packages missing `xcsh` or `pi` manifests remain installable and listable, but runtime discovery (`getEnabledPlugins`) skips them.
- `manifest.version` syncs with the parent `package.json` `version` property.
- Syntax errors in `package.json` result in immediate read failures.

## Plugin lifecycle workflows

### Installing and updating plugins (`PluginManager.install`)

1. Parse feature brackets and package constraints from the specification string.
2. Validate package identifiers against regex constraints and shell metacharacter denylists.
3. Ensure the target `package.json` structure exists under `~/.xcsh/plugins/`.
4. Execute `bun install <PACKAGE_SPEC>` within `~/.xcsh/plugins/`.
5. Inspect `node_modules/<PACKAGE_NAME>/package.json`.
6. Compute the `enabledFeatures` set:
   - `[*]`: All declared manifest features.
   - `[a,b]`: Explicitly requested feature array.
   - `[]`: Empty feature list.
   - Bare specifier: `null` (applies default features at load time).
7. Upsert the lockfile entry: `{ version, enabledFeatures, enabled: true }`.

### Uninstalling plugins (`PluginManager.uninstall`)

1. Validate the target package name.
2. Execute `bun uninstall <PACKAGE_NAME>` within `~/.xcsh/plugins/`.
3. Remove plugin state and configuration entries from `xcsh-plugins.lock.json`:
   - `config.plugins[name]`
   - `config.settings[name]`

### Listing installed plugins (`PluginManager.list`)

1. Read the dependency manifest from `~/.xcsh/plugins/package.json`.
2. Load runtime state from `xcsh-plugins.lock.json`.
3. Read project overrides from `<cwd>/.xcsh/plugin-overrides.json`.
4. Construct `InstalledPlugin` records by merging base lockfile state with project overrides.

### Linking local development plugins (`PluginManager.link`)

The `link` command symlinks a local development repository into `~/.xcsh/plugins/node_modules/<PACKAGE_NAME>`:

1. Resolve the target path relative to the current working directory.
2. Verify that the target directory contains a valid `package.json` with a `name` property.
3. Remove existing files or links at the destination path.
4. Create the filesystem symlink.
5. Record an enabled runtime entry with default features in `xcsh-plugins.lock.json`.

## Runtime capability discovery

### Discovery filtering

`getEnabledPlugins(cwd)` inspects installed dependencies and applies the following filters:

- Skips packages missing `package.json` or manifest metadata (`xcsh`/`pi`).
- Skips packages marked as disabled in `xcsh-plugins.lock.json`.
- Skips packages disabled via project-level `plugin-overrides.json`.

### Capability path resolution

For each enabled plugin, the runtime resolves exported capability paths:

- `resolvePluginToolPaths(plugin)`: Resolves tool entry points.
- `resolvePluginHookPaths(plugin)`: Resolves lifecycle hook entry points.
- `resolvePluginCommandPaths(plugin)`: Resolves custom slash command entry points.

Paths expand based on base entries and active feature selections. Missing file paths are ignored during initial resolution.

### Runtime integration status

- **Custom tools**: Loaded and registered in runtime memory via `discoverAndLoadCustomTools` (`custom-tools/loader.ts`).
- **Hooks and commands**: Resolvers are available for capability inspection, while primary extension execution routes through unified extension modules.

## Security boundaries and validation

### Package input validation

Package specifications undergo validation against regex rules and a shell metacharacter denylist (`[;&|`$(){}[]<>\\]`) before invoking Bun subprocesses.

### Execution trust model

Plugin modules execute in-process when imported. Installed plugins are treated as trusted code within the user environment.

## Error handling and failure modes

Plugin state operations do not use distributed transactions:

| Step | Failure condition | Recovery action |
|---|---|---|
| Package installation | `bun install` returns non-zero exit code. | Command halts; on-disk state remains unmodified. |
| Manifest parsing | Package installed, but manifest structure is invalid. | Command reports error; dependency remains in `node_modules`. |
| State persistence | Package installed, but lockfile write fails. | Command reports error; package remains installed without lockfile entry. |
| Uninstallation | `bun uninstall` fails. | Command halts; lockfile state is preserved. |

Run `xcsh plugin doctor --fix` to diagnose and reconcile inconsistencies between installed packages and lockfile metadata.

## Primary implementation files

- `packages/coding-agent/src/commands/plugin.ts`: CLI command definitions and flag mappings.
- `packages/coding-agent/src/cli/plugin-cli.ts`: User-facing command action handlers.
- `packages/coding-agent/src/extensibility/plugins/manager.ts`: Core lifecycle and state management methods.
- `packages/coding-agent/src/extensibility/plugins/installer.ts`: Helper functions and link validation guards.
- `packages/coding-agent/src/extensibility/plugins/loader.ts`: Plugin capability discovery and path resolution.
- `packages/coding-agent/src/extensibility/plugins/parser.ts`: Specification parsing helpers.
- `packages/coding-agent/src/extensibility/plugins/types.ts`: Type definitions for manifests and lockfiles.
- `packages/coding-agent/src/extensibility/custom-tools/loader.ts`: Runtime wiring for plugin-provided tools.

