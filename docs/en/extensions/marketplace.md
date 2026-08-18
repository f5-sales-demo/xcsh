---
title: Marketplace Plugin System
description: Marketplace plugin system for discovering, installing, and managing curated plugin collections.
sidebar:
  order: 4
  label: Marketplace
---

The marketplace system enables discovery, installation, and lifecycle management of plugin packages from Git-hosted catalogs. It adheres to the Claude Code plugin registry format.

## Quick start

Install a marketplace catalog and a targeted plugin:

```bash
/marketplace add anthropics/f5-sales-demo-marketplace
/marketplace install wordpress.com@f5-sales-demo-marketplace
```

Run `/marketplace` without arguments to launch the interactive plugin browser.

## Core concepts

- **Marketplace**: A Git repository or local directory containing a catalog manifest at `.xcsh-plugin/marketplace.json`. The catalog lists available plugins with source locations, descriptions, and metadata.
- **Plugin**: A directory containing skills, slash commands, event hooks, Model Context Protocol (MCP) servers, or Language Server Protocol (LSP) servers. Plugins use the identifier format `<PLUGIN_NAME>@<MARKETPLACE_NAME>` (for example, `code-review@f5-sales-demo-marketplace`).
- **Installation scopes**:
  - **User scope** (default): Available across all workspace projects. Stored in `~/.xcsh/plugins/installed_plugins.json`.
  - **Project scope**: Available exclusively within the current project repository. Stored in `.xcsh/installed_plugins.json`.

Project-scoped plugin installations shadow user-scoped installations of the same plugin identifier.

## Command reference

### Interactive commands

| Command | Description |
| --- | --- |
| `/marketplace` | Launches the interactive plugin browser and installation interface. |

### Marketplace management commands

| Command | Description |
| --- | --- |
| `/marketplace add <SOURCE>` | Registers a new marketplace source. |
| `/marketplace remove <NAME>` | Removes a registered marketplace catalog. |
| `/marketplace update [<NAME>]` | Re-fetches catalog metadata. Updates all catalogs when omitted. |
| `/marketplace list` | Lists all configured marketplaces. |

### Plugin lifecycle commands

| Command | Description |
| --- | --- |
| `/marketplace discover [<MARKETPLACE>]` | Lists available plugins in configured marketplaces. |
| `/marketplace install [--force] [--scope user\|project] <NAME>@<MARKETPLACE>` | Installs a designated plugin. |
| `/marketplace uninstall [--scope user\|project] <NAME>@<MARKETPLACE>` | Removes an installed plugin. |
| `/marketplace installed` | Lists currently installed plugins. |
| `/marketplace upgrade [--scope user\|project] [<NAME>@<MARKETPLACE>]` | Upgrades installed plugins to the latest catalog release. |

### Command-line interface equivalents

The preceding operations are also available through direct CLI invocations:

```bash
xcsh plugin marketplace add <SOURCE>
xcsh plugin marketplace remove <NAME>
xcsh plugin marketplace update [<NAME>]
xcsh plugin marketplace list
xcsh plugin discover [<MARKETPLACE>]
xcsh plugin install --scope project <NAME>@<MARKETPLACE>
```

## Supported marketplace sources

When registering a catalog using `/marketplace add <SOURCE>`, the runtime classifies the source format automatically:

| Source format | Classification | Example |
| --- | --- | --- |
| `owner/repo` | GitHub repository shorthand | `anthropics/f5-sales-demo-marketplace` |
| `https://...*.json` | Direct catalog URL | `https://example.com/marketplace.json` |
| `https://...*.git` or `git@...` | Git repository URI | `https://github.com/org/repo.git` |
| `./path`, `~/path`, `/path` | Local filesystem directory | `./my-marketplace` |

The runtime clones or reads the source, validates `.xcsh-plugin/marketplace.json`, and caches catalog metadata locally.

## Catalog manifest format (`marketplace.json`)

The marketplace catalog resides at `.xcsh-plugin/marketplace.json` at the root of the source repository:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "custom-marketplace",
  "owner": {
    "name": "Operator Name",
    "email": "operator@example.com"
  },
  "description": "Curated demonstration and utility plugins",
  "plugins": [
    {
      "name": "custom-plugin",
      "description": "Provides automation tools and skills.",
      "source": "./plugins/custom-plugin",
      "category": "development",
      "homepage": "https://github.com/example/custom-plugin"
    }
  ]
}
```

### Required manifest properties

| Property | Description |
| --- | --- |
| `name` | Canonical marketplace identifier (lowercase alphanumeric characters, hyphens, and dots; maximum 64 characters). |
| `owner.name` | Name of the marketplace maintainer or organization. |
| `plugins` | Array of plugin definition entries. |

### Plugin definition properties

| Property | Required | Description |
| --- | --- | --- |
| `name` | Yes | Plugin identifier adhering to naming constraints. |
| `source` | Yes | Source resolution descriptor (relative path, Git URL, GitHub shorthand, npm). |
| `description` | No | Human-readable functional description. |
| `version` | No | Semantic version string. |
| `author` | No | Author metadata (`{ "name": "...", "email": "..." }`). |
| `homepage` | No | Documentation or source repository URL. |
| `category` | No | Functional category (for example, `development`, `productivity`, `security`). |
| `tags` | No | Array of search categorization tags. |
| `strict` | No | Boolean enforcement flag. |
| `commands` | No | Slash commands registered by the plugin. |
| `agents` | No | Subagents provided by the plugin. |
| `hooks` | No | Event hook definitions. |
| `mcpServers` | No | Model Context Protocol server configurations. |
| `lspServers` | No | Language Server Protocol configurations. |

### Plugin source specifications

The `source` descriptor supports the following formats:

#### Relative directory path within marketplace repository

```json
"source": "./plugins/custom-plugin"
```

#### Remote Git repository

```json
"source": {
  "source": "url",
  "url": "https://github.com/org/repo.git",
  "sha": "a1b2c3d4..."
}
```

#### GitHub repository shorthand

```json
"source": {
  "source": "github",
  "repo": "org/repo",
  "ref": "main",
  "sha": "a1b2c3d4..."
}
```

#### Monorepo subdirectory

```json
"source": {
  "source": "git-subdir",
  "url": "https://github.com/org/monorepo.git",
  "path": "plugins/custom-plugin",
  "ref": "main",
  "sha": "a1b2c3d4..."
}
```

#### npm package

```json
"source": {
  "source": "npm",
  "package": "@scope/custom-plugin",
  "version": "1.0.0"
}
```

## Filesystem layout

```text
~/.xcsh/
  config/
    marketplaces.json          # Registry of configured marketplaces
  plugins/
    installed_plugins.json     # User-scoped plugin installations
    cache/
      marketplaces/            # Cached marketplace catalog manifests
      plugins/                 # Cached plugin file trees

<project>/.xcsh/
  installed_plugins.json       # Project-scoped plugin installations
```

## Identifier naming constraints

Marketplace and plugin identifiers must comply with the following validation rules:

- Must begin and end with a lowercase ASCII letter or digit.
- May contain only lowercase ASCII letters, digits, hyphens (`-`), and dots (`.`).
- Must not exceed 64 characters in length.

Combined plugin identifiers (`<NAME>@<MARKETPLACE>`) must not exceed 128 characters in total length.

- **Valid examples**: `custom-plugin`, `code-review`, `wordpress.com`, `f5-sales-demo`
- **Invalid examples**: `-invalid`, `invalid-`, `.invalid`, `InvalidCase`, `under_score`
