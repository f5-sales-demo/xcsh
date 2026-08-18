# Developing xcsh

Repository-specific engineering guide for all contributors — human developers and AI coding agents: prerequisites, project structure, setup, the TDD workflow, linting, testing, release automation, and architecture.

For the fleet-wide contribution process — issues, branches, pull requests, review, and engineering standards — see [CONTRIBUTING.md](CONTRIBUTING.md).

Fork: `@f5-sales-demo/xcsh` | Upstream: `can1357/oh-my-pi`

---

## Table of contents

1. [Prerequisites](#prerequisites)
2. [Project structure](#project-structure)
3. [Setup](#setup)
4. [Development workflow](#development-workflow)
5. [Linting and formatting](#linting-and-formatting)
6. [Testing](#testing)
7. [Office add-in](#office-add-in)
8. [Commit conventions](#commit-conventions)
9. [Pull requests](#pull-requests)
10. [Architecture overview](#architecture-overview)
11. [Extension playbooks](#extension-playbooks)

---

## Prerequisites

| Tool | Minimum version | Verify |
| --- | --- | --- |
| `bun` | 1.3.12 | `bun --version` |
| `git` | 2.x | `git --version` |
| `gh` | 2.x | `gh auth status` |
| `cargo` | nightly | `cargo --version` |

> **Package manager: bun only.** This monorepo uses Bun workspaces. Never use `npm`, `yarn`, or `pnpm` — they cannot resolve `workspace:` protocol references and produce broken `node_modules` in worktrees.

---

## Managed Codex instructions and agent policy

When developing features or refactoring codebase components using AI coding assistants (Codex, Claude Code, Antigravity):

- **Governance alignment**: Follow rules defined in `AGENTS.md` and repository `.claude/governance.json`.
- **Managed prompt isolation**: Do not build system prompts in code. Prompts live in static `.md` files under `packages/coding-agent/src/prompts/` and render using Handlebars (`prompt.render`).
- **Codex rigor compliance**: All non-trivial PRs require systematic planning (`rigor-planner`), strict TDD verification, and completion auditing (`rigor-completion-auditor`).

---

## Project structure

### Monorepo layout

```text
xcsh/
├── packages/
│   ├── coding-agent/    # Main CLI agent (TypeScript)
│   ├── office-pane/     # Office task pane, Office.js host tools, and acceptance harnesses
│   ├── ai/              # AI provider abstractions
│   ├── tui/             # Terminal UI primitives
│   ├── agent/           # Core agent runtime
│   ├── utils/           # Shared utilities
│   ├── natives/         # Native Bun bindings (Rust via napi)
│   └── stats/           # Usage statistics
├── crates/              # Rust crates (brush-*, pi-natives, tree-sitter-glimmer)
├── biome.json           # Biome v2 linter/formatter config
├── tsconfig.json        # Root TypeScript config
└── Cargo.toml           # Rust workspace root
```

### Source tree (`packages/coding-agent/src/`)

```text
src/
├── cli.ts, main.ts, index.ts, sdk.ts
├── cli/                 # CLI argument and command adapters
├── commands/            # Command handlers (launch, shell, ssh, ...)
├── modes/               # Interactive, print, RPC runtimes + UI controllers
├── session/             # AgentSession, persistence, storage, compaction
├── tools/               # Built-in tool implementations
├── task/                # Subagent orchestration and parallel execution
├── capability/          # Capability definitions and schemas
├── discovery/           # Provider discovery (native/editor/MCP/etc.)
├── extensibility/       # Extensions, hooks, custom tools, plugins, skills
├── mcp/                 # MCP transport/manager/tool bridge
├── lsp/                 # Language server client integration
├── internal-urls/       # Protocol router (agent://, docs://, rule://, ...)
├── exec/ ipy/ ssh/      # Execution backends (shell, python, ssh)
├── web/                 # Search providers + domain scrapers
├── patch/               # Edit/patch parser + diff utilities
└── config/ utils/ tui/  # Settings, helpers, low-level TUI primitives
```

---

## Setup

### 1. Create a GitHub issue

Every change starts with a GitHub issue. Map work type to commit prefix:

| Work type | Prefix | Label |
| --- | --- | --- |
| New feature | `feat` | `enhancement` |
| Bug fix | `fix` | `bug` |
| Maintenance | `chore` | `chore` |
| Refactor | `refactor` | `refactor` |
| Documentation | `docs` | `documentation` |

```bash
gh issue create --title "<TYPE>: <IMPERATIVE_DESCRIPTION>" --label "<LABEL>"
```

### 2. Create a development worktree

Never commit directly to `main`. All development takes place in isolated worktrees under `.worktrees/`.

**Branch naming**: `<TYPE>/issue-<N>-<SHORT_DESCRIPTION>` (lowercase, hyphen-separated, 3–5 words).

```bash
# Set your branch (from the issue created in step 1)
BRANCH="<TYPE>/issue-<N>-<SHORT_DESCRIPTION>"

# Create worktree from latest origin/main
git fetch origin
git worktree add --no-track ".worktrees/${BRANCH}" -b "${BRANCH}" origin/main
cd ".worktrees/${BRANCH}"

# Install dependencies with Bun
bun install

# Capture test baseline
bun run test 2>&1 | tee .worktree-test-baseline.txt
```

---

## Development workflow

### TDD: red-green-refactor

All feature development and bug fixes follow strict test-driven development:

1. **Red**: Write a failing test in `packages/<PACKAGE>/test/<FEATURE>.test.ts`.
2. **Confirm failure**: Run `bun test --cwd packages/<PACKAGE> --filter <TEST_NAME> --max-concurrency 2`.
3. **Green**: Write the minimal implementation to pass the test.
4. **Confirm success**: Re-run the targeted test.
5. **Full package check**: Run package-level tests and type checks (`bun run check:ts`).
6. **Refactor**: Clean up code and verify tests remain green.

---

## Linting and formatting

### Biome configuration (`biome.json`)

The codebase uses Biome v2 for formatting and linting:

- Indentation: Tabs (width: 3).
- Line width: 120 columns.
- Quotes: Double quotes.
- Semicolons: Always.
- Trailing commas: All.

### Commands

| Command | Action |
| --- | --- |
| `bun run check` | Biome check + `tsgo` type-check (read-only) |
| `bun run lint` | Biome lint only (read-only) |
| `bun run fmt` | Biome format (modifies files) |
| `bun run fix` | Biome auto-fix (modifies files) |
| `bun run check:ts` | TypeScript lint and type-check |
| `bun run check:rs` | Rust cargo check and clippy verification |

---

## Testing

### Running tests

Bun provides the test runner for the TypeScript workspace suite:

```bash
# Full test suite (bounded concurrency)
bun run test

# Scoped package tests
bun test --cwd packages/coding-agent --filter "<PATTERN>" --max-concurrency 2

# Targeted single file test
bun test test/xcsh-profile-service.test.ts --max-concurrency 2
```

---

## Office add-in

Refer to the [Office add-in development guide](packages/office-pane/DEVELOPING.md) for Office-specific architecture, Office.js mock bindings, test matrices, and sideloading instructions. Acceptance inventories are documented in the [Office pane UAT checklist](packages/office-pane/UAT.md).

---

## Commit conventions

This repository strictly enforces [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<scope>): <imperative summary>

<body explaining why this change was made>

Closes #<N>
```

---

## Pull requests

Once all tests pass and linting is clean:

```bash
git push -u origin "$(git branch --show-current)"
gh pr create --title "<TYPE>(<SCOPE>): <DESCRIPTION>" --body "Closes #<N>"
```

Enable auto-merge where authorized:

```bash
gh pr merge --auto --squash
```

---

## Architecture overview

### Boot sequence

```text
process argv ──► cli.ts (runCli) ──► commands/* ──► main.ts (runRootCommand) ──► createAgentSession(...)
                                                                                          │
                                                                   ┌──────────────────────┼──────────────────────┐
                                                                   ▼                      ▼                      ▼
                                                           InteractiveMode            PrintMode               RpcMode
```

---

## Evidence standards

All claims about bug fixes, test results, and lint status must be verified with terminal command outputs before opening or merging pull requests.
