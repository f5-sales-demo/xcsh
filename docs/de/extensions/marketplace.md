---
title: Marketplace-Plugin-System
description: >-
  Marketplace-Plugin-System zum Entdecken, Installieren und Verwalten
  kuratierter Plugin-Sammlungen.
sidebar:
  order: 4
  label: Marketplace
i18n:
  sourceHash: 8ff4a59bbcd5
  translator: machine
---

# Marketplace-Plugin-System

Das Marketplace-System ermöglicht es Ihnen, Plugins aus Git-gehosteten Katalogen zu entdecken, zu installieren und zu verwalten. Es ist kompatibel mit dem Claude Code Plugin-Registry-Format.

## Schnellstart

```
/marketplace add anthropics/f5xc-salesdemos-marketplace
/marketplace install wordpress.com@f5xc-salesdemos-marketplace
```

Oder geben Sie einfach `/marketplace` ohne Argumente ein, um den interaktiven Plugin-Browser zu öffnen.

## Konzepte

Ein **Marketplace** ist ein Git-Repository (oder lokales Verzeichnis), das eine Katalogdatei unter `.xcsh-plugin/marketplace.json` enthält. Der Katalog listet verfügbare Plugins mit ihren Quellen, Beschreibungen und Metadaten auf.

Ein **Plugin** ist ein Verzeichnis, das Skills, Befehle, Hooks, MCP-Server oder LSP-Server enthält. Plugins werden durch `name@marketplace` identifiziert (z. B. `code-review@f5xc-salesdemos-marketplace`).

**Gültigkeitsbereiche**: Plugins können in zwei Bereichen installiert werden:

- **user** (Standard) -- in allen Projekten verfügbar, gespeichert in `~/.xcsh/plugins/installed_plugins.json`
- **project** -- nur im aktuellen Projekt verfügbar, gespeichert in `.xcsh/installed_plugins.json`

Projektbezogene Installationen überdecken benutzerbezogene Installationen desselben Plugins.

## Befehle

### Interaktiver Modus

| Befehl | Wirkung |
|---|---|
| `/marketplace` | Interaktiven Plugin-Browser öffnen (installieren) |

### Marketplace-Verwaltung

| Befehl | Wirkung |
|---|---|
| `/marketplace add <source>` | Eine Marketplace-Quelle hinzufügen |
| `/marketplace remove <name>` | Einen Marketplace entfernen |
| `/marketplace update [name]` | Katalog(e) neu abrufen; Name weglassen, um alle zu aktualisieren |
| `/marketplace list` | Konfigurierte Marketplaces auflisten |

### Plugin-Operationen

| Befehl | Wirkung |
|---|---|
| `/marketplace discover [marketplace]` | Verfügbare Plugins durchsuchen |
| `/marketplace install [--force] [--scope user\|project] name@marketplace` | Ein Plugin installieren |
| `/marketplace uninstall [--scope user\|project] name@marketplace` | Ein Plugin deinstallieren |
| `/marketplace installed` | Installierte Marketplace-Plugins auflisten |
| `/marketplace upgrade [--scope user\|project] [name@marketplace]` | Ein oder alle Plugins aktualisieren |

### CLI-Äquivalente

Die gleichen Operationen sind über die Kommandozeile verfügbar:

```
xcsh plugin marketplace add <source>
xcsh plugin marketplace remove <name>
xcsh plugin marketplace update [name]
xcsh plugin marketplace list
xcsh plugin discover [marketplace]
xcsh plugin install --scope project name@marketplace
```

## Marketplace-Quellen

Wenn Sie `/marketplace add <source>` ausführen, klassifiziert das System die Quelle:

| Quellformat | Typ | Beispiel |
|---|---|---|
| `owner/repo` | GitHub-Kurzform | `anthropics/f5xc-salesdemos-marketplace` |
| `https://...*.json` | Direkte Katalog-URL | `https://example.com/marketplace.json` |
| `https://...*.git` oder `git@...` | Git-Repository | `https://github.com/org/repo.git` |
| `./path` oder `~/path` oder `/path` | Lokales Verzeichnis | `./my-marketplace` |

Das System klont das Repository (oder liest das lokale Verzeichnis), sucht `.xcsh-plugin/marketplace.json`, validiert es und speichert den Katalog lokal im Cache.

## Katalogformat (marketplace.json)

Ein Marketplace-Katalog befindet sich unter `.xcsh-plugin/marketplace.json` im Repository-Stammverzeichnis:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "my-marketplace",
  "owner": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "description": "A collection of plugins",
  "plugins": [
    {
      "name": "my-plugin",
      "description": "What this plugin does",
      "source": "./plugins/my-plugin",
      "category": "development",
      "homepage": "https://github.com/you/my-plugin"
    }
  ]
}
```

### Pflichtfelder

| Feld | Beschreibung |
|---|---|
| `name` | Marketplace-Name. Kleinbuchstaben, alphanumerisch, Bindestriche und Punkte. Muss mit alphanumerischem Zeichen beginnen und enden. Maximal 64 Zeichen. |
| `owner.name` | Name des Marketplace-Eigentümers |
| `plugins` | Array von Plugin-Einträgen |

### Plugin-Eintragsfelder

| Feld | Erforderlich | Beschreibung |
|---|---|---|
| `name` | ja | Plugin-Name (gleiche Regeln wie Marketplace-Name) |
| `source` | ja | Wo das Plugin zu finden ist (siehe unten) |
| `description` | nein | Kurzbeschreibung |
| `version` | nein | Versions-String |
| `author` | nein | `{ name, email? }` |
| `homepage` | nein | URL |
| `category` | nein | Kategorie-String (z. B. `development`, `productivity`, `security`) |
| `tags` | nein | Array von String-Tags |
| `strict` | nein | Boolean |
| `commands` | nein | Bereitgestellte Slash-Befehle |
| `agents` | nein | Bereitgestellte Agenten |
| `hooks` | nein | Hook-Definitionen |
| `mcpServers` | nein | MCP-Server-Definitionen |
| `lspServers` | nein | LSP-Server-Definitionen |

### Plugin-Quellformate

Das `source`-Feld unterstützt mehrere Formate:

**Relativer Pfad** (innerhalb des Marketplace-Repos):

```json
"source": "./plugins/my-plugin"
```

**Git-Repository-URL**:

```json
"source": {
  "source": "url",
  "url": "https://github.com/org/repo.git",
  "sha": "abc123..."
}
```

**GitHub-Kurzform**:

```json
"source": {
  "source": "github",
  "repo": "org/repo",
  "ref": "main",
  "sha": "abc123..."
}
```

**Git-Unterverzeichnis** (Monorepo):

```json
"source": {
  "source": "git-subdir",
  "url": "https://github.com/org/monorepo.git",
  "path": "plugins/my-plugin",
  "ref": "main",
  "sha": "abc123..."
}
```

**npm-Paket**:

```json
"source": {
  "source": "npm",
  "package": "@scope/my-plugin",
  "version": "1.0.0"
}
```

## Verzeichnisstruktur auf der Festplatte

```
~/.xcsh/
  config/
    marketplaces.json          # Registry der hinzugefügten Marketplaces
  plugins/
    installed_plugins.json     # Benutzerbezogen installierte Plugins
    cache/
      marketplaces/            # Gecachte Marketplace-Kataloge
      plugins/                 # Gecachte Plugin-Verzeichnisse

<project>/.xcsh/
  installed_plugins.json       # Projektbezogen installierte Plugins
```

## Namensregeln

Marketplace- und Plugin-Namen müssen:

- Mit einem Kleinbuchstaben oder einer Ziffer beginnen und enden
- Nur Kleinbuchstaben, Ziffern, Bindestriche und Punkte enthalten
- Höchstens 64 Zeichen lang sein

Plugin-IDs (`name@marketplace`) dürfen insgesamt höchstens 128 Zeichen lang sein.

Gültige Beispiele: `my-plugin`, `code-review`, `wordpress.com`, `ai-firstify`
Ungültige Beispiele: `-bad`, `bad-`, `.bad`, `Bad`, `under_score`
