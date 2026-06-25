---
title: "F5 XC Contexts"
description: Connect xcsh to F5 Distributed Cloud tenants -- create, switch, and manage authentication contexts.
sidebar:
  order: 1
  label: F5 XC Contexts
---

# F5 XC Contexts

xcsh connects to F5 Distributed Cloud through **contexts** -- named credential sets that bind a tenant URL, API token, and namespace. If you've used `kubectl config use-context` or `kubectx`, the workflow is identical: create a context, switch between them by name, and use `-` to flip back.

## Getting started

### 1. Create your first context

You need three things from your F5 XC console: the tenant URL, an API token, and optionally a namespace.

```
/context create production https://acme.console.ves.volterra.io p12k3-your-api-token
```

```
Context 'production' created. Use /context activate production to switch to it.
```

Or use the guided wizard if you prefer step-by-step prompts:

```
/context wizard
```

### 2. Activate it

```
/context production
```

```
╭─ production ─────────────────────────────────────────────────╮
│ XCSH_TENANT     acme                                         │
│ XCSH_API_URL    https://acme.console.ves.volterra.io         │
│ XCSH_API_TOKEN  ...oken                                      │
│ Status          Connected (312ms)                            │
├─ Environment ────────────────────────────────────────────────┤
│ XCSH_NAMESPACE  default                                      │
╰──────────────────────────────────────────────────────────────╯
```

Once activated, xcsh injects the tenant credentials into your session. The agent can now make F5 XC API calls, and the status line shows the active context.

### 3. Add more contexts and switch between them

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

Switch by name -- no subcommand verb needed:

```
/context staging
```

Switch back to the previous context (`cd -` style):

```
/context -
```

Calling `/context -` twice returns you to where you started.

### 4. See what you have

```
/context
```

```
  production           https://acme.console.ves.volterra.io
* staging              https://staging.console.ves.volterra.io
```

The `*` marks the active context.

## Everyday commands

| Command | What it does |
|---|---|
| `/context` | List all contexts |
| `/context <name>` | Switch to a context |
| `/context -` | Switch to the previous context |
| `/context show` | Show active context details (tokens masked) |
| `/context status` | Show current auth status |

## Context lifecycle

| Command | What it does |
|---|---|
| `/context create <name> <url> <token> [namespace]` | Create a context |
| `/context delete <name> --confirm` | Delete a context (requires `--confirm`) |
| `/context rename <old> <new>` | Rename a context |
| `/context validate <name>` | Test credentials without switching |
| `/context export [name] [--include-token]` | Export as JSON (tokens masked by default) |
| `/context import <path-or-json> [--overwrite]` | Import from file or inline JSON |
| `/context wizard` | Guided interactive setup |

## Switching namespaces

Each context has a default namespace. Switch it without changing the context:

```
/context namespace system
```

Tab completion offers namespace names from the active tenant.

## Environment variables on contexts

Contexts can carry extra environment variables that are injected into your session on activation. Useful for per-tenant configuration that isn't part of the credential set.

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

Aliases: `add` = `set`, `remove`/`clear` = `unset`.

## Tab completion

Type `/context ` and press Tab. The dropdown shows:

1. **Context names** -- with tenant URL hints, so you can tell tenants apart
2. **`-`** -- appears when you've switched before, shows which context you'd flip to
3. **Subcommands** -- `list`, `create`, `delete`, etc.

Context names appear first because switching is the most common action.

Subcommand-level completions also work: `/context activate <Tab>` completes context names, `/context namespace <Tab>` completes namespaces, `/context unset <Tab>` completes known env var keys.

## Naming rules

Context names must be 1-64 characters: letters, digits, hyphens, underscores.

Names that collide with subcommands are rejected:

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

The full reserved set: `list`, `show`, `status`, `create`, `delete`, `rename`, `namespace`, `env`, `set`, `unset`, `add`, `remove`, `clear`, `activate`, `validate`, `export`, `import`, `wizard`, `help`. Comparison is case-insensitive.

## Environment variable override

If `XCSH_API_URL` and `XCSH_API_TOKEN` are set in your shell environment before launching xcsh, they take precedence over any context. This is useful for CI/CD pipelines or one-off sessions where you don't want to create a persistent context.

When running in this mode, `/context` shows the environment-sourced credentials with a `(via env vars)` label.

## Previous context behavior

- **Session-scoped**: the previous context resets when you restart xcsh. It is not persisted to disk.
- **Ping-pong**: `/context -` twice returns you to where you started.
- **Safe across mutations**: if you delete the previous context, the pointer is cleared. If you rename it, the pointer follows the new name.
- **Re-activation is a no-op**: `/context production` when already on `production` does not reset the previous pointer.

## Design conventions

The `/context` UX follows:

- **kubectx**: `kubectx <name>` for switching, `kubectx -` for previous, bare `kubectx` for listing
- **kubectl**: `kubectl config use-context` for the explicit form
- **Shell**: `cd -` / `OLDPWD` for previous-directory tracking
