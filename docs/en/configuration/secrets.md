---
title: Secret Obfuscation
description: Secret obfuscation pipeline that redacts sensitive values from session logs and outputs.
sidebar:
  order: 3
  label: Secrets
---

# Secret obfuscation

The secret obfuscation pipeline prevents sensitive values (such as API keys, tokens, and passwords) from being sent to LLM providers. When enabled, xcsh replaces secret strings with deterministic placeholders before outbound transmission to the model and restores original values in tool execution arguments returned by the model.

## Enabling secret obfuscation

Secret obfuscation is enabled by default. You can toggle this setting in the `/settings` interface or configure it directly in `config.yml`:

```yaml
secrets:
  enabled: false
```

## How obfuscation works

1. During session initialization, xcsh collects secrets from two primary sources:
   - **Environment variables**: Matches common secret name patterns (`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`) containing values with eight or more characters.
   - **Configuration files**: Loads rules defined in `secrets.yml`.
2. Before sending outbound messages to the LLM, the obfuscator replaces all identified secret values with indexed placeholders such as `<<$env:S0>>` and `<<$env:S1>>`.
3. When the model returns tool call arguments, xcsh recursively traverses the arguments to restore placeholders to their original values prior to execution.

Two modes control secret processing:

| Mode | Behavior | Reversible |
|---|---|---|
| `obfuscate` (default) | Replaces secret with an indexed placeholder (`<<$env:SN>>`) | Yes (restored automatically in tool arguments) |
| `replace` | Replaces secret with a static replacement string | No (one-way redaction) |

## Defining secrets in `secrets.yml`

You can declare custom secret redaction rules in YAML. xcsh inspects two file locations in order:

| Level | File path | Scope |
|---|---|---|
| Global | `~/.xcsh/agent/secrets.yml` | Applies across all projects and sessions |
| Project | `<cwd>/.xcsh/secrets.yml` | Applies strictly to the local project |

Project-level entries override global entries that share the same `content`.

### Configuration schema

Each item in the configuration array accepts the following fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"plain"` or `"regex"` | Yes | Pattern matching strategy. |
| `content` | string | Yes | Literal secret value or regular expression pattern. |
| `mode` | `"obfuscate"` or `"replace"` | No | Processing mode. Defaults to `"obfuscate"`. |
| `replacement` | string | No | Custom replacement text (applicable only in `replace` mode). |
| `flags` | string | No | Regular expression flags (applicable only for `regex` type). |

### Configuration examples

#### Plaintext matching

```yaml
# Obfuscate a specific API key (default reversible mode)
- type: plain
  content: <XC_API_TOKEN>

# Replace a database password with a static mask
- type: plain
  content: database-admin-password
  mode: replace
  replacement: "********"
```

#### Regular expression matching

```yaml
# Obfuscate AWS credential patterns
- type: regex
  content: "AKIA[0-9A-Z]{16}"

# Case-insensitive API token pattern with explicit flags
- type: regex
  content: "api[_-]?key\\s*=\\s*\\w+"
  flags: "i"

# Regular expression literal syntax (pattern and flags combined)
- type: regex
  content: "/bearer\\s+[a-zA-Z0-9._~+\\/=-]+/i"
```

Regular expression rules always execute with global matching enabled (the `g` flag is applied automatically). Regular expression literal syntax (`/pattern/flags`) is supported as an alternative to separate `content` and `flags` fields. Escaped forward slashes (`\\/`) inside patterns are parsed correctly.

#### Irreversible replacement with regex

```yaml
# Redact database connection strings irreversibly
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## Environment variable precedence

Environment variables are always scanned and indexed first. Rules from `secrets.yml` are appended afterward, extending coverage to hardcoded tokens or configuration values that do not reside in the environment. If the same secret value is detected in both environment variables and `secrets.yml`, the mode specified in `secrets.yml` takes precedence.

## Key implementation files

- `src/secrets/index.ts`: Loading, merging, and environment variable discovery.
- `src/secrets/obfuscator.ts`: `SecretObfuscator` class, placeholder substitution, and argument restoration.
- `src/secrets/regex.ts`: Regular expression literal parsing and compilation.
- `src/config/settings-schema.ts`: Setting definition for `secrets.enabled`.

