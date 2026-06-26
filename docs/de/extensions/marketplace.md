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

Das Marktplatz-System ermöglicht das Entdecken, Installieren und Verwalten von Plugins aus Git-gehosteten Katalogen. Es ist kompatibel mit dem Claude Code Plugin-Registrierungsformat.

## Schnellstart

```
/marketplace add anthropics/f5-sales-demo-marketplace
/marketplace install wordpress.com@f5-sales-demo-marketplace
```

Oder geben Sie einfach `/marketplace` ohne Argumente ein, um den interaktiven Plugin-Browser zu öffnen.

## Konzepte

Ein **Marktplatz** ist ein Git-Repository (oder lokales Verzeichnis), das eine Katalogdatei unter `.xcsh-plugin/marketplace.json` enthält. Der Katalog listet verfügbare Plugins mit ihren Quellen, Beschreibungen und Metadaten auf.

Ein **Plugin** ist ein Verzeichnis, das Skills, Befehle, Hooks, MCP-Server oder LSP-Server enthält. Plugins werden durch `name@marktplatz` identifiziert (z. B. `code-review@f5-sales-demo-marketplace`).

**Geltungsbereiche**: Plugins können in zwei Geltungsbereichen installiert werden:

- **user** (Standard) – in allen Projekten verfügbar, gespeichert unter `~/.xcsh/plugins/installed_plugins.json`
- **project** – nur im aktuellen Projekt verfügbar, gespeichert unter `.xcsh/installed_plugins.json`

Projektbezogene Installationen überschatten benutzerbezogene Installationen desselben Plugins.

## Befehle

### Interaktiver Modus

| Befehl | Wirkung |
|---|---|
| `/marketplace` | Interaktiven Plugin-Browser öffnen (installieren) |

### Marktplatzverwaltung

| Befehl | Wirkung |
|---|---|
| `/marketplace add <source>` | Eine Marktplatzquelle hinzufügen |
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

## Marktplatzquellen

Wenn Sie `/marketplace add <source>` ausführen, klassifiziert das System die Quelle:

| Quellenformat | Typ | Beispiel |
|---|---|---|
| `owner/repo` | GitHub-Kurzform | `anthropics/f5-sales-demo-marketplace` |
| `https://...*.json` | Direkte Katalog-URL | `https://example.com/marketplace.json` |
| `https://...*.git` oder `git@...` | Git-Repository | `https://github.com/org/repo.git` |
| `./path` oder `~/path` oder `/path` | Lokales Verzeichnis | `./my-marketplace` |

Das System klont das Repository (oder liest das lokale Verzeichnis), sucht `.xcsh-plugin/marketplace.json`, validiert es und speichert den Katalog lokal im Cache.

## Katalogformat (marketplace.json)

Ein Marktplatzkatalog liegt unter `.xcsh-plugin/marketplace.json` im Repository-Stammverzeichnis:

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
| `owner.name` | Name des Marktplatzbetreibers |
| `plugins` | Array von Plugin-Einträgen |

### Plugin-Eintragsfelder

| Feld | Erforderlich | Beschreibung |
|---|---|---|
| `name` | ja | Plugin-Name (dieselben Regeln wie beim Marktplatznamen) |
| `source` | ja | Wo das Plugin zu finden ist (siehe unten) |
| `description` | nein | Kurzbeschreibung |
| `version` | nein | Versionsstring |
| `author` | nein | `{ name, email? }` |
| `homepage` | nein | URL |
| `category` | nein | Kategoriestring (z. B. `development`, `productivity`, `security`) |
| `tags` | nein | Array von String-Tags |
| `strict` | nein | Boolescher Wert |
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
    marketplaces.json          # Registrierung hinzugefügter Marktplätze
  plugins/
    installed_plugins.json     # Benutzerbezogen installierte Plugins
    cache/
      marketplaces/            # Gecachte Marktplatzkataloge
      plugins/                 # Gecachte Plugin-Verzeichnisse

<project>/.xcsh/
  installed_plugins.json       # Projektbezogen installierte Plugins
```

## Benennungsregeln

Marktplatz- und Plugin-Namen müssen:

- Mit einem Kleinbuchstaben oder einer Ziffer beginnen und enden
- Nur Kleinbuchstaben, Ziffern, Bindestriche und Punkte enthalten
- Höchstens 64 Zeichen lang sein

Plugin-IDs (`name@marktplatz`) dürfen insgesamt höchstens 128 Zeichen lang sein.

Gültige Beispiele: `my-plugin`, `code-review`, `wordpress.com`, `ai-firstify`
Ungültige Beispiele: `-bad`, `bad-`, `.bad`, `Bad`, `under_score`
