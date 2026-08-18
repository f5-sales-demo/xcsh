---
title: "Porting From pi-mono: A Practical Merge Guide"
description: Practical guide for migrating code from the pi-mono monorepo into the xcsh codebase.
sidebar:
  order: 9
  label: Porting from pi-mono
---

# Porting from pi-mono: a practical merge guide

This guide provides a repeatable procedure for porting changes from upstream `pi-mono` into this repository. Use it when executing any merge: single files, feature branches, or full release synchronizations.

## Last sync point

- **Commit:** `b21b42d032919de2f2e6920a76fa9a37c3920c0a`
- **Date:** 2026-03-22

Update this section after completing each sync operation; do not reuse previous commit ranges.

When initiating a new sync, generate patches from this commit forward:

```bash
git format-patch b21b42d032919de2f2e6920a76fa9a37c3920c0a..HEAD --stdout > changes.patch
```

## Step 1: Define the scope

- Identify the upstream reference (commit hash, tag, or pull request).
- List the packages and directories you plan to modify.
- Determine which features are in-scope and which are intentionally excluded.

## Step 2: Import code safely

- Prefer a clean, focused diff rather than wholesale file replacement.
- Avoid copying build artifacts or generated files.
- When upstream adds new files, add them explicitly and inspect their contents.

## Step 3: Match import extension conventions

Most runtime TypeScript sources omit `.js` in internal imports, whereas select test and benchmark entry points retain `.js` for ESM runtime compatibility. Follow the existing style of the target package; avoid blanket stripping of extensions.

- In `packages/coding-agent` runtime sources, keep internal imports extensionless unless importing non-TypeScript assets.
- In `packages/tui/test` and `packages/natives/bench`, retain `.js` where surrounding files already use it.
- Keep real file extensions when required by tooling (such as `.json`, `.css`, or `.md` text embeds).
- Example: Change `import { x } from "./foo.js";` to `import { x } from "./foo";` only when the package convention is extensionless.

## Step 4: Replace import scopes

Upstream packages use different organizational scopes. Replace them systematically:

- Replace upstream scopes with the corresponding local package scope.
- Reference mapping:
  - `@mariozechner/pi-coding-agent` —> `@f5-sales-demo/xcsh`
  - `@mariozechner/pi-agent-core` —> `@f5-sales-demo/pi-agent-core`
  - `@mariozechner/pi-tui` —> `@f5-sales-demo/pi-tui`
  - `@mariozechner/pi-ai` —> `@f5-sales-demo/pi-ai`

## Step 5: Adopt Bun APIs

This project runs on Bun. Replace Node.js APIs when Bun provides a higher-performance or cleaner alternative.

### Recommended Bun replacements

- Process execution: Replace `child_process.spawn` with Bun Shell `$` for basic commands, or `Bun.spawn`/`Bun.spawnSync` for streaming or long-running tasks.
- File operations: Replace `fs.readFileSync` with `Bun.file().text()` and `Bun.write()`.
- HTTP requests: Replace `node-fetch` and `axios` with global `fetch`.
- Cryptographic hashing: Replace `node:crypto` with Web Crypto or `Bun.hash`.
- Database access: Replace `better-sqlite3` with `bun:sqlite`.
- Environment loading: Remove `dotenv` calls because Bun loads `.env` files automatically.

### Preserved Node.js APIs

Retain the following standard Node.js utilities (they execute natively in Bun):

- `os.homedir()` — Do not replace with `Bun.env.HOME` or literal `"~"`.
- `os.tmpdir()` — Do not replace with `Bun.env.TMPDIR || "/tmp"` or hardcoded paths.
- `fs.mkdtempSync()` — Do not replace with manual path construction.
- `path.join()`, `path.resolve()`, and related path helpers.

**Import style:** Use the `node:` protocol prefix with namespace imports exclusively (avoid named imports from `node:fs` or `node:path`).

### Additional Bun conventions

- Prefer Bun Shell `$` for short, non-streaming commands; use `Bun.spawn` when streaming I/O or process controls are needed.
- Use `Bun.file()` and `Bun.write()` for file operations, and `node:fs/promises` for directory manipulations.
- Avoid `Bun.file().exists()` checks; implement `isEnoent` error checking in `try/catch` blocks instead.
- Prefer `Bun.sleep(ms)` over `setTimeout` wrappers.

Incorrect:

```typescript
// Broken: environment variables can be undefined, and "~" is not expanded
const home = Bun.env.HOME || "~";
const tmp = Bun.env.TMPDIR || "/tmp";
```

Correct:

```typescript
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

const configDir = path.join(os.homedir(), ".config", "myapp");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myapp-"));
```

## Step 6: Use Bun embeds for assets

Do not copy runtime assets or vendor files during the build process.

- Replace dist copy steps with native Bun text embeds (`with { type: "text" }`).
- Store prompts as static `.md` files and render them with Handlebars.
- Use `import.meta.dir` with `Bun.file` to resolve adjacent non-text assets.
- Keep assets inside repository packages so the bundler includes them directly.
- Eliminate copy scripts from build configurations.
- Example:
  - Replace `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "instructions.md"); readFileSync(FALLBACK_PROMPT_PATH, "utf8");`
  - With `import FALLBACK_INSTRUCTIONS from "./instructions.md" with { type: "text" }; return FALLBACK_INSTRUCTIONS;`

## Step 7: Update `package.json` manifests

Treat `package.json` as a package contract. Merge changes deliberately:

- Preserve existing `name`, `version`, `type`, `exports`, and `bin` fields unless the port requires explicit changes.
- Replace npm and Node scripts with Bun equivalents (such as `bun check` and `bun test`).
- Ensure all workspace dependencies reference the `@f5-sales-demo/*` scope.
- Do not downgrade dependencies to resolve type errors; upgrade dependencies instead.
- Validate workspace links and `peerDependencies`.

## Step 8: Align coding style and conventions

- Maintain existing repository formatting conventions.
- Do not introduce `any` types unless required by external interfaces.
- Avoid dynamic imports and inline type imports; place imports at module root.
- Never concatenate prompt strings in code; maintain prompts as static `.md` templates rendered via Handlebars.
- In `packages/coding-agent`, use `logger` from `@f5-sales-demo/pi-utils` instead of `console.log`, `console.warn`, or `console.error`.
- Use `Promise.withResolvers()` instead of `new Promise((resolve, reject) => ...)`.
- **Do not use `private`, `protected`, or `public` keywords on class fields or methods.** Use ECMAScript private field `#` syntax for encapsulation, and leave accessible members bare without keywords. The only exception is constructor parameter properties (`constructor(private readonly name: string)`).
- Preserve Bun-first repository characteristics:
  - Runtime executes under Bun without Node entry points.
  - Package manager runs through Bun without npm lockfiles.
  - CLI shebangs target `bun` rather than `node` or `tsx`.
  - Packages consume source files directly without intermediate TypeScript build output.
  - CI workflows execute Bun for installation, typechecking, and testing.

## Step 9: Remove obsolete compatibility shims

Unless backward compatibility is explicitly requested, eliminate legacy upstream shims:

- Delete obsolete APIs that were superseded.
- Update callers directly to target the new API signatures.
- Avoid retaining `*_v2` or parallel duplicate functions.

## Step 10: Update documentation and references

- Update repository links and cross-references.
- Update code samples to reflect Bun runtime commands and updated package scopes.
- Confirm README setup instructions remain accurate.

## Step 11: Validate the port

Run standard verification commands following changes:

```bash
bun check
```

If the repository contains pre-existing test failures unrelated to your changes, note them explicitly. Test execution uses Bun's test runner (`bun test`).

## Step 12: Protect fork enhancements

Treat local enhancements as non-negotiable requirements. Verify that upstream merges do not regress custom functionality:

- **Record baseline behaviors**: Document expected inputs, outputs, and edge cases before merging to prevent silent rollbacks.
- **Map renamed APIs**: When upstream renames concepts (such as hooks to extensions or custom tools to tools), verify that all entry points and flags wire through correctly.
- **Verify package exports**: Check `package.json` `exports`, public types, and barrel files to ensure local exports remain available.
- **Verify non-happy paths**: Add or execute test cases covering error handling, timeout bounds, and fallback branches.
- **Audit configuration precedence**: Verify that default options and configuration merge hierarchies preserve custom settings.
- **Audit environment isolation**: Ensure command execution flows continue using sanitized environment variables without alias contamination.

## Step 13: Handle refactored upstream code

Before porting a file, inspect upstream git diffs to detect architectural refactoring:

```bash
git diff HEAD upstream/main -- path/to/file.ts
```

When upstream refactors a module (introducing new abstractions, merged files, or restructured control flows):

1. **Review original implementation**: Understand the previous contract, options, and exported surfaces.
2. **Review new implementation**: Understand the updated abstractions and how previous options map.
3. **Verify feature parity**: Confirm that each previous capability is preserved or deliberately handled.
4. **Search for legacy symbols**: Grep for deprecated names and identifiers across switch statements and UI handlers.
5. **Test interface boundaries**: Validate CLI arguments, SDK options, event handlers, and default configurations.

## Step 14: Verification checklist

Complete the following verification checklist before finalizing a port:

- [ ] Import extensions conform to the package convention without blanket stripping of `.js`.
- [ ] No Node-only APIs introduced in ported code.
- [ ] All package scopes updated to `@f5-sales-demo/*`.
- [ ] `package.json` scripts target Bun commands.
- [ ] Prompts load via static `.md` text imports.
- [ ] Logging uses `logger` instead of `console.*` in `coding-agent`.
- [ ] Runtime assets load via Bun embeds.
- [ ] Verification suite (`bun check`) passes cleanly.
- [ ] Enhanced fork capabilities remain intact.

## Step 15: Commit message format

When committing backported changes, format the commit header as `<type>(scope): <past-tense description>` and include the sync commit range:

```
fix(coding-agent): backported pi-mono changes (<from>..<to>)

packages/<package>:
- <type>: <description>
- <type>: <description> (#<issue> by @<contributor>)

packages/<other-package>:
- <type>: <description>
```

Example:

```
fix(coding-agent): backported pi-mono changes (9f3eef65f..52532c7c0)

packages/ai:
- fix: handle "sensitive" stop reason from Anthropic API
- fix: normalize tool call IDs with special characters for Responses API
- fix: add overflow detection for Bedrock, MiniMax, Kimi providers
- fix: 429 status is rate limiting, not context overflow

packages/tui:
- fix: refactored autocomplete state tracking
- fix: file autocomplete should not trigger on empty text
- fix: configurable autocomplete max visible items
- fix: improved table column width calculation with word-aware wrapping

packages/coding-agent:
- fix: preserve external config.yml edits on save (#1046 by @nicobailonMD)
- fix: resolve macOS NFD and curly quote variants in file paths
```

## Intentional architectural divergences

This repository contains intentional design divergences from upstream. **Do not port upstream patterns in these areas:**

### UI architecture

| Upstream | Local fork | Rationale |
| --- | --- | --- |
| `FooterDataProvider` class | `StatusLineComponent` | Integrated, simplified status line |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | Stub in non-TUI modes | Implemented in TUI, no-op in headless |
| `ctx.ui.setEditorComponent()` | Stub in non-TUI modes | Implemented in TUI, no-op in headless |
| `InteractiveModeOptions` object | Positional constructor arguments | Preserves stable constructor signatures |

### Component naming

| Upstream | Local fork |
| --- | --- |
| `extension-input.ts` | `hook-input.ts` |
| `extension-selector.ts` | `hook-selector.ts` |
| `ExtensionInputComponent` | `HookInputComponent` |
| `ExtensionSelectorComponent` | `HookSelectorComponent` |

### API naming

| Upstream | Local fork | Notes |
| --- | --- | --- |
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)` | Uses `sessionName` consistently |
| `sessionManager.getSessionName()` | `sessionManager.getSessionName()` | Unified naming |
| `agent.sessionName` / `setSessionName()` | `agent.sessionName` / `setSessionName()` | Unified naming |

### File consolidation

| Upstream | Local fork | Rationale |
| --- | --- | --- |
| `clipboard.ts` + `clipboard-image.ts` | `@f5-sales-demo/pi-natives` clipboard module | Native N-API clipboard implementation |

### Test framework

| Upstream | Local fork |
| --- | --- |
| `vitest` with `vi.mock()` | `bun:test` with `vi` from Bun |
| `node:test` assertions | `expect()` matchers |

### Tool architecture

| Upstream | Local fork | Notes |
| --- | --- | --- |
| `createTool(cwd: string, options?)` | `createTools(session: ToolSession)` via `BUILTIN_TOOLS` registry | Tool factories accept `ToolSession` and return `null` when disabled |
| Per-tool `*Operations` interfaces | Per-tool interfaces retained (`FindOperations`, `GrepOperations`) | Supports remote and SSH execution overrides |
| Node.js `fs/promises` everywhere | `Bun.file()`/`Bun.write()` for files, `node:fs/promises` for directories | Leverages high-performance Bun file I/O |

### Authentication storage

| Upstream | Local fork | Notes |
| --- | --- | --- |
| `proper-lockfile` + `auth.json` | `agent.db` (`bun:sqlite`) | Credentials persist in SQLite `agent.db` |
| Single credential per provider | Multi-credential with round-robin selection | Session affinity and backoff logic preserved |

### Extensions

| Upstream | Local fork |
| --- | --- |
| `jiti` for TypeScript loading | Native Bun `import()` |
| `pkg.pi` manifest field | `pkg.xcsh ?? pkg.pi` (prefers local namespace) |

### Excluded upstream features

When porting changes, **exclude** the following files and features:

- `footer-data-provider.ts` — Handled via `StatusLineComponent`.
- `clipboard-image.ts` — Handled via `@f5-sales-demo/pi-natives` N-API module.
- GitHub workflow files — Governed by local CI workflows.
- `models.generated.ts` — Managed locally via `models.json`.

### Local features to preserve

Preserve all local features during merges:

- `StatusLineComponent` in interactive TUI mode.
- Multi-credential authentication with session affinity.
- Capability-based discovery system (`defineCapability`, `registerProvider`, `loadCapability`, `skillCapability`).
- MCP, Exa, and SSH integrations.
- LSP write-through integration for format-on-save.
- Bash command interception (`checkBashInterception`).
- Fuzzy path suggestions in the `read` tool.

