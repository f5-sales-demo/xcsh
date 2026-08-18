---
title: Rulebook Matching Pipeline
description: Rulebook matching pipeline for selecting and applying context-specific instruction sets to agent sessions.
sidebar:
  order: 6
  label: Rulebook matching
---

# Rulebook matching pipeline

This document describes how the xcsh coding agent discovers rule files across supported configuration formats, normalizes them into canonical `Rule` objects, resolves precedence conflicts, and routes them into:

- **Rulebook rules**: Contextual rules referenced in the system prompt and retrieved on demand via `rule://` URLs.
- **Always-apply rules**: Global rules injected directly into the system prompt.
- **TTSR rules**: Test-time self-reflection rules registered with `TtsrManager`.

## Primary implementation files

- `packages/coding-agent/src/capability/rule.ts`
- `packages/coding-agent/src/capability/index.ts`
- `packages/coding-agent/src/discovery/index.ts`
- `packages/coding-agent/src/discovery/helpers.ts`
- `packages/coding-agent/src/discovery/builtin.ts`
- `packages/coding-agent/src/discovery/cursor.ts`
- `packages/coding-agent/src/discovery/windsurf.ts`
- `packages/coding-agent/src/discovery/cline.ts`
- `packages/coding-agent/src/sdk.ts`
- `packages/coding-agent/src/system-prompt.ts`
- `packages/coding-agent/src/internal-urls/rule-protocol.ts`
- `packages/coding-agent/src/utils/frontmatter.ts`

## 1. Canonical rule data structure

All discovery providers normalize rule definitions into the `Rule` interface:

```ts
interface Rule {
  name: string;
  path: string;
  content: string;
  globs?: string[];
  alwaysApply?: boolean;
  description?: string;
  ttsrTrigger?: string;
  _source: SourceMeta;
}
```

The capability registry deduplicates rules using `rule.name` as the primary key (`ruleCapability.key = rule => rule.name`). Rules from different filesystem locations sharing the same base name are treated as conflicting versions of the same rule.

## 2. Discovery providers and normalization rules

The discovery subsystem registers four rule providers:

- `native` (Priority `100`)
- `cursor` (Priority `50`)
- `windsurf` (Priority `50`)
- `cline` (Priority `40`)

### Native provider (`builtin.ts`)

Discovers xcsh rule files from:

- **Project scope**: `<cwd>/.xcsh/rules/*.{md,mdc}`
- **User scope**: `~/.xcsh/agent/rules/*.{md,mdc}`

Normalization behavior:

- Derives `name` from the filename minus the `.md` or `.mdc` extension.
- Parses frontmatter metadata using `parseFrontmatter`.
- Sets `content` to the markdown body with frontmatter stripped.
- Maps `globs`, `alwaysApply`, `description`, and `ttsr_trigger` properties directly.

### Cursor provider (`cursor.ts`)

Discovers rules from:

- **User scope**: `~/.cursor/rules/*.{mdc,md}`
- **Project scope**: `<cwd>/.cursor/rules/*.{mdc,md}`

Normalization rules (`transformMDCRule`):

- `description`: Retained only when supplied as a string.
- `alwaysApply`: Preserved when explicitly `true` (`false` normalizes to `undefined`).
- `globs`: Accepts either a string array or a single string.
- `ttsr_trigger`: Preserved as a string.
- Derives `name` from the filename minus the extension.

### Windsurf provider (`windsurf.ts`)

Discovers rules from:

- **User scope**: `~/.codeium/windsurf/memories/global_rules.md` (assigned the fixed name `global_rules`).
- **Project scope**: `<cwd>/.windsurf/rules/*.md`.

Normalization behavior:

- `globs`: Normalizes array or single string values.
- `alwaysApply` and `description`: Parsed directly from frontmatter.
- `ttsr_trigger`: Preserved as a string.
- Project rule names derive from individual filenames.

### Cline provider (`cline.ts`)

Traverses upward from the current working directory to locate the nearest `.clinerules`:

- If `.clinerules` is a directory, loads all `*.md` files within it.
- If `.clinerules` is a single file, loads the rule under the fixed name `clinerules`.

## 3. Frontmatter parsing and fallback handling

Providers parse frontmatter blocks using `parseFrontmatter` (`utils/frontmatter.ts`):

1. The parser identifies frontmatter delimited by opening `---` and closing `\n---` markers.
2. The markdown body is trimmed after removing the frontmatter chunk.
3. If YAML parsing fails:
   - A warning is recorded.
   - The parser falls back to simple line-based `key: value` extraction (`^(\w+):\s*(.*)$`).

Fallback characteristics:

- The fallback parser does not process arrays, nested dictionaries, or quoted strings.
- Extracted values default to strings (for example, `alwaysApply: true` parses as string `"true"`).
- Files lacking frontmatter parse cleanly as rules with empty metadata and the entire document body as `content`.

## 4. Provider precedence and deduplication

`loadCapability("rules")` aggregates discovered rules across providers and resolves duplicate rule names:

- Providers are evaluated in descending priority order (`native` > `cursor` = `windsurf` > `cline`).
- When priorities are equal, registration order determines precedence (`cursor` before `windsurf`).
- Deduplication follows a first-seen policy: the highest-priority rule matching a given `name` is retained in `items`, while subsequent definitions are recorded in `all` with `_shadowed: true`.

## 5. Classification into Rulebook, Always-Apply, and TTSR categories

During session initialization in `createAgentSession` (`sdk.ts`), discovered rules are partitioned into three execution buckets:

1. **TTSR category**: Any rule declaring a `condition` (or `ttsr_trigger` / `ttsrTrigger`) registers with `TtsrManager`. TTSR classification takes precedence over all other categories.
2. **Always-apply category**: Non-TTSR rules with `alwaysApply: true`. The full markdown body is injected directly into the system prompt.
3. **Rulebook category**: Non-TTSR rules with a defined `description` and `alwaysApply` not set to `true`. Summarized in the system prompt rules index.

Classification conditions:

- A rule defining both `condition` and `alwaysApply` is assigned exclusively to the TTSR category.
- A rule defining both `alwaysApply` and `description` is assigned exclusively to the always-apply category.

## 6. Runtime metadata utilization

### `description`

- Required for inclusion in the advisory rulebook index.
- Displayed in the system prompt `<rules>` block.
- Rules lacking a description are excluded from the rulebook index and cannot be resolved via `rule://`.

### `globs`

- Formatted as `<glob>...</glob>` elements within the system prompt rules block.
- Surfaced in TUI extension management panels.
- Serves as advisory guidance to the model; globs are not evaluated programmatically for rule selection.

### `alwaysApply`

- Triggers direct injection of the rule content into the base system prompt.
- Available for on-demand re-reading via `rule://<NAME>`.

### `ttsr_trigger`

- Binds the rule to the runtime stream evaluation engine in `TtsrManager`.

## 7. System prompt integration

`buildSystemPromptInternal` constructs the final prompt context:

1. Always-apply rules are rendered first, inserting their full markdown content directly.
2. Rulebook rules are listed in a `# Rules` section displaying `rule://<NAME>`, functional descriptions, and associated glob patterns.

## 8. The `rule://` URI protocol handler

`RuleProtocolHandler` resolves `rule://` URIs against combined rulebook and always-apply collections:

- Resolves exact rule names (for example, `rule://unit-testing`).
- TTSR-only rules and rules missing descriptions are not addressable.
- Requests for unknown rule names return an error listing valid candidates.
- Returns the rule body (`rule.content`) as `text/markdown`.

