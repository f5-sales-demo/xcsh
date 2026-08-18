---
title: "F5 XC Contexts"
description: Connect xcsh to F5 Distributed Cloud tenants -- create, switch, and manage authentication contexts.
sidebar:
  order: 1
  label: F5 XC Contexts
---

# F5 Distributed Cloud contexts

xcsh connects to F5 Distributed Cloud (F5 XC) tenants through **contexts** — named credential profiles binding a tenant endpoint URL, API token, and active namespace. Context management mimics `kubectl` and `kubectx` workflows: create contexts, switch between them by name, and use `-` to alternate between recent contexts.

## Getting started

### 1. Create a context

Obtain your tenant endpoint URL, an API certificate/token, and your target namespace from the F5 XC Console, then run:

```bash
/context create production https://<XC_TENANT>.console.ves.volterra.io <XC_API_TOKEN>
```

Alternatively, launch the guided setup wizard:

```bash
/context wizard
```

### 2. Activate a context

Activate a context by specifying its name:

```bash
/context production
```

```text
╭─ production ─────────────────────────────────────────────────╮
│ XCSH_TENANT     <XC_TENANT>                                  │
│ XCSH_API_URL    https://<XC_TENANT>.console.ves.volterra.io  │
│ XCSH_API_TOKEN  ...oken                                      │
│ Status          Connected (312ms)                            │
├─ Environment ────────────────────────────────────────────────┤
│ XCSH_NAMESPACE  default                                      │
╰──────────────────────────────────────────────────────────────╯
```

Once activated, xcsh injects tenant credentials into the active session environment. The agent uses these credentials for F5 XC REST and Terraform operations.

### 3. Switch between contexts

Switch to another context directly by name:

```bash
/context staging
```

Alternate back to the previous context:

```bash
/context -
```

### 4. List available contexts

```bash
/context
```

The output indicates the active context with an asterisk (`*`):

```text
  production           https://<XC_TENANT>.console.ves.volterra.io
* staging              https://<XC_TENANT_STAGING>.console.ves.volterra.io
```

## Command reference

### General management

| Command | Description |
| --- | --- |
| `/context` | Lists all configured contexts. |
| `/context <NAME>` | Activates the specified context. |
| `/context -` | Switches to the previously active context. |
| `/context show` | Displays active context configuration with masked tokens. |
| `/context status` | Validates and reports API connectivity status. |

### Context lifecycle operations

| Command | Description |
| --- | --- |
| `/context create <NAME> <URL> <TOKEN> [NAMESPACE]` | Creates a new tenant context. |
| `/context delete <NAME> --confirm` | Removes a context profile. |
| `/context rename <OLD_NAME> <NEW_NAME>` | Renames an existing context. |
| `/context validate <NAME>` | Tests credential validity without activating. |
| `/context export [NAME] [--include-token]` | Exports context definitions to JSON. |
| `/context import <PATH_OR_JSON> [--overwrite]` | Imports context configurations from JSON files or strings. |
| `/context wizard` | Starts interactive step-by-step context configuration. |

## Namespace management

Update the active namespace within the current context:

```bash
/context namespace system
```

Auto-completion queries active namespaces from the connected tenant.

## Custom context environment variables

Contexts can define custom environment variables that xcsh injects upon activation:

```bash
/context set CUSTOM_HEADER=x-demo-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

## Environment variable precedence

If `XCSH_API_URL` and `XCSH_API_TOKEN` are set in the host shell prior to launching xcsh, environment variables override context configurations. When running under environment overrides, `/context` displays credentials marked with `(via env vars)`.

