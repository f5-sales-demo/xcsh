---
title: Marktplatz-Plugin-System
description: >-
  Marktplatz-Plugin-System zum Entdecken, Installieren und Verwalten kuratierter
  Plugin-Sammlungen.
sidebar:
  order: 4
  label: Marktplatz
i18n:
  sourceHash: 8ff4a59bbcd5
  translator: machine
---

# Marktplatz-Plugin-System

Das Marktplatz-System ermöglicht es Ihnen, Plugins aus Git-gehosteten Katalogen zu entdecken, zu installieren und zu verwalten. Es ist mit dem Claude Code Plugin-Registry-Format kompatibel.

## Schnellstart

```
/marketplace add anthropics/f5xc-salesdemos-marketplace
/marketplace install wordpress.com@f5xc-salesdemos-marketplace
```

Oder geben Sie einfach `/marketplace` ohne Argumente ein, um den interaktiven Plugin-Browser zu öffnen.

## Konzepte

Ein **Marktplatz** ist ein Git-Repository (oder lokales Verzeichnis), das eine Katalogdatei unter `.xcsh-plugin/marketplace.json` enthält. Der Katalog listet verfügbare Plugins mit ihren Quellen, Beschreibungen und Metadaten auf.

Ein **Plugin** ist ein Verzeichnis, das Skills, Befehle, Hooks, MCP-Server oder LSP-Server enthält. Plugins werden durch `name@marktplatz` identifiziert (z. B. `code-review@f5xc-salesdemos-marketplace`).

**Geltungsbereiche**: Plugins können in zwei Geltungsbereichen installiert werden:

- **user** (Standard) – in allen Projekten verfügbar, gespeichert in `~/.xcsh/plugins/installed_plugins.json`
- **project** – nur im aktuellen Projekt verfügbar, gespeichert in `.xcsh/installed_plugins.json`

Projektbezogene Installationen überschatten benutzerbezogene Installationen desselben Plugins.

## Befehle

### Interaktiver Modus

| Befehl | Wirkung |
|---|---|
| `/marketplace` | Interaktiven Plugin-Browser öffnen (installieren) |

### Marktplatz-Verwaltung

| Befehl | Wirkung |
|---|---|
| `/marketplace add <source>` | Eine Marktplatz-Quelle hinzufügen |
| `/marketplace remove <name>` | Einen Marktplatz entfernen |
| `/marketplace update [name]` | Katalog(e) neu abrufen; Name weglassen, um alle zu aktualisieren |
| `/marketplace list` | Konfigurierte Marktplätze auflisten |

### Plugin-Operationen

| Befehl | Wirkung |
|---|---|
| `/marketplace discover [marketplace]` | Verfügbare Plugins durchsuchen |
| `/marketplace install [--force] [--scope user\|project] name@marketplace` | Ein Plugin installieren |
| `/marketplace uninstall [--scope user\|project] name@marketplace` | Ein Plugin deinstallieren |
| `/marketplace installed` | Installierte Marktplatz-Plugins auflisten |
| `/marketplace upgrade [--scope user\|project] [name@marketplace]` | Ein oder alle Plugins aktualisieren |

### CLI-Entsprechungen

Dieselben Operationen sind über die Befehlszeile verfügbar:

```
xcsh plugin marketplace add <source>
xcsh plugin marketplace remove <name>
xcsh plugin marketplace update [name]
xcsh plugin marketplace list
xcsh plugin discover [marketplace]
xcsh plugin install --scope project name@marketplace
```

## Marktplatz-Quellen

Wenn Sie `/marketplace add <source>` ausführen, klassifiziert das System die Quelle:

| Quellenformat | Typ | Beispiel |
|---|---|---|
| `owner/repo` | GitHub-Kurzform | `anthropics/f5xc-salesdemos-marketplace` |
| `https://...*.json` | Direkte Katalog-URL | `https://example.com/marketplace.json` |
| `https://...*.git` oder `git@...` | Git-Repository | `https://github.com/org/repo.git` |
| `./path` oder `~/path` oder `/path` | Lokales Verzeichnis | `./my-marketplace` |

Das System klont das Repository (oder liest das lokale Verzeichnis), findet `.xcsh-plugin/marketplace.json`, validiert es und speichert den Katalog lokal im Cache.

## Katalogformat (marketplace.json)

Ein Marktplatzkatalog befindet sich unter `.xcsh-plugin/marketplace.json` im Repository-Stammverzeichnis:

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
| `name` | Marktplatzname. Kleinbuchstaben, alphanumerisch, Bindestriche und Punkte. Muss mit alphanumerischem Zeichen beginnen und enden. Maximal 64 Zeichen. |
| `owner.name` | Name des Marktplatz-Inhabers |
| `plugins` | Array von Plugin-Einträgen |

### Plugin-Eintragsfelder

| Feld | Erforderlich | Beschreibung |
|---|---|---|
| `name` | ja | Plugin-Name (gleiche Regeln wie Marktplatzname) |
| `source` | ja | Wo das Plugin zu finden ist (siehe unten) |
| `description` | nein | Kurzbeschreibung |
| `version` | nein | Versionszeichenkette |
| `author` | nein | `{ name, email? }` |
| `homepage` | nein | URL |
| `category` | nein | Kategoriezeichenkette (z. B. `development`, `productivity`, `security`) |
| `tags` | nein | Array von Zeichenketten-Tags |
| `strict` | nein | Boolean |
| `commands` | nein | Bereitgestellte Slash-Befehle |
| `agents` | nein | Bereitgestellte Agenten |
| `hooks` | nein | Hook-Definitionen |
| `mcpServers` | nein | MCP-Server-Definitionen |
| `lspServers` | nein | LSP-Server-Definitionen |

### Plugin-Quellenformate

Das Feld `source` unterstützt mehrere Formate:

**Relativer Pfad** (innerhalb des Marktplatz-Repos):

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

## Verzeichnisstruktur auf dem Datenträger

```
~/.xcsh/
  config/
    marketplaces.json          # Registry der hinzugefügten Marktplätze
  plugins/
    installed_plugins.json     # Benutzerbezogen installierte Plugins
    cache/
      marketplaces/            # Zwischengespeicherte Marktplatzkataloge
      plugins/                 # Zwischengespeicherte Plugin-Verzeichnisse

<project>/.xcsh/
  installed_plugins.json       # Projektbezogen installierte Plugins
```

## Benennungsregeln

Marktplatz- und Plugin-Namen müssen:

- Mit einem Kleinbuchstaben oder einer Ziffer beginnen und enden
- Nur Kleinbuchstaben, Ziffern, Bindestriche und Punkte enthalten
- Maximal 64 Zeichen lang sein

Plugin-IDs (`name@marktplatz`) dürfen insgesamt maximal 128 Zeichen lang sein.

Gültige Beispiele: `my-plugin`, `code-review`, `wordpress.com`, `ai-firstify`
Ungültige Beispiele: `-bad`, `bad-`, `.bad`, `Bad`, `under_score`
