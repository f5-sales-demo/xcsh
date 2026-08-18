---
title: Gemini Manifest Extensions
description: Gemini manifest extension format for cross-platform skill and agent compatibility.
sidebar:
  order: 7
  label: Gemini manifest
---

# Gemini manifest extensions (`gemini-extension.json`)

This document describes how the xcsh coding agent discovers, parses, and surfaces Gemini-format manifest extensions (`gemini-extension.json`) within the capability discovery pipeline.

For executable TypeScript and JavaScript extension modules, see [Extension loading](file:///data/robin-GIT/language-improvement/xcsh/docs/en/extensions/extension-loading.md).

## Implementation files

- `packages/coding-agent/src/discovery/gemini.ts`
- `packages/coding-agent/src/discovery/builtin.ts`
- `packages/coding-agent/src/discovery/helpers.ts`
- `packages/coding-agent/src/capability/extension.ts`
- `packages/coding-agent/src/capability/index.ts`
- `packages/coding-agent/src/extensibility/extensions/loader.ts`

## Discovered paths

The Gemini capability provider (`id: gemini`, priority `60`) registers an `extensions` loader that scans two fixed root directories:

- **User scope**: `~/.gemini/extensions`
- **Project scope**: `<cwd>/.gemini/extensions`

The loader resolves paths directly from `ctx.home` and `ctx.cwd` using `getUserPath()` and `getProjectPath()`. Project lookup is evaluated against the current working directory (`<cwd>`) only and does not traverse parent directories.

## Directory scanning rules

For each root directory, discovery executes the following sequence:

1. Read child directory entries via `readDirEntries(root)`.
2. Filter entries to retain direct child directories (`entry.isDirectory()`).
3. For each subdirectory `<NAME>`, attempt to read `<ROOT>/<NAME>/gemini-extension.json`.

Directory scanning does not recurse beyond the immediate child directory level.

### Hidden directory support

Gemini manifest discovery does not filter out dot-prefixed directory names. If a hidden directory contains a valid `gemini-extension.json` file, the loader evaluates it.

### Missing and unreadable files

If `gemini-extension.json` does not exist or lacks read permissions, the loader skips the directory silently.

## Manifest schema and normalization

The capability model defines the manifest structure as follows:

```ts
interface ExtensionManifest {
  name?: string;
  description?: string;
  mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
  tools?: unknown[];
  context?: unknown;
}
```

Discovery applies flexible validation rules:

- Valid JSON syntax is required.
- The loader preserves the parsed JSON object on the capability record as `manifest`.
- Internal fields (`mcpServers`, `tools`, `context`) are parsed without schema enforcement during discovery.

### Extension name resolution

The loader determines `Extension.name` using the following fallback order:

1. `manifest.name` if present and defined.
2. The containing directory name.

## Materialization into capability items

A valid manifest file creates an `Extension` capability item:

```ts
{
  name: manifest.name ?? "<DIRECTORY_NAME>",
  path: "<EXTENSION_DIRECTORY_PATH>",
  manifest: parsedJson,
  level: "user" | "project",
  _source: {
    provider: "gemini",
    providerName: "Gemini CLI",
    path: "<ABSOLUTE_MANIFEST_PATH>",
    level: "user" | "project"
  }
}
```

Operational details:

- `_source.path` normalizes to an absolute filesystem path via `createSourceMeta()`.
- Registry-level validation requires both `name` and `path` to be present.

## Error handling and diagnostic warnings

### Diagnostic warnings

- Syntax errors in manifest JSON emit a warning: `Invalid JSON in <MANIFEST_PATH>`.

### Silent fallback (no warnings)

- Missing `extensions` directory.
- Subdirectory without `gemini-extension.json`.
- Unreadable file permissions.

## Precedence and deduplication

The capability registry aggregates `extensions` across registered providers:

- `native` provider (`packages/coding-agent/src/discovery/builtin.ts`): Priority `100`.
- `gemini` provider (`packages/coding-agent/src/discovery/gemini.ts`): Priority `60`.

Deduplication uses `ext.name` as the primary key (`extensionCapability.key = ext => ext.name`).

### Cross-provider precedence

Higher-priority providers override duplicate extension names:

- If both `native` and `gemini` define an extension named `custom-tools`, the `native` definition takes precedence.
- The shadowed lower-priority item is preserved in `result.all` with `_shadowed: true`.

### Intra-provider ordering

Within the Gemini provider, deduplication operates on a first-seen basis:

- The Gemini loader appends user-level extensions first, followed by project-level extensions.
- If identical extension names exist in both `~/.gemini/extensions` and `<cwd>/.gemini/extensions`, the user-level entry takes precedence, shadowing the project entry.

## Architectural boundary between metadata and module loading

Discovery of `gemini-extension.json` produces declarative `Extension` capability records. It does not load executable TypeScript or JavaScript extension modules into runtime memory.

Runtime extension module execution (`discoverAndLoadExtensions()` and `loadExtensions()`) targets executable `extension-modules` and filters auto-discovered candidates strictly to the `native` provider.

This separation allows declarative tooling and compatibility metadata to be discovered without executing untrusted external code.
