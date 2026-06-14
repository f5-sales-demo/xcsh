---
title: Geheimnis-Verschleierung
description: >-
  Pipeline zur Verschleierung von Geheimnissen, die sensible Werte aus
  Sitzungsprotokollen und Ausgaben entfernt.
sidebar:
  order: 3
  label: Geheimnisse
i18n:
  sourceHash: 1d9dc101c614
  translator: machine
---

# Geheimnis-Verschleierung

Verhindert, dass sensible Werte (API-Schlüssel, Token, Passwörter) an LLM-Anbieter übermittelt werden. Wenn aktiviert, werden Geheimnisse durch deterministische Platzhalter ersetzt, bevor sie den Prozess verlassen, und in Tool-Call-Argumenten, die vom Modell zurückgegeben werden, wiederhergestellt.

## Aktivierung

Standardmäßig aktiviert. Umschalten über die `/settings`-Oberfläche oder direkt in `config.yml`:

```yaml
secrets:
  enabled: false
```

## Funktionsweise

1. Beim Start der Sitzung werden Geheimnisse aus zwei Quellen gesammelt:
   - **Umgebungsvariablen**, die gängigen Geheimnis-Mustern entsprechen (`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, usw.) mit Werten >= 8 Zeichen
   - **`secrets.yml`-Dateien** (siehe unten)

2. Ausgehende Nachrichten an das LLM haben alle geheimen Werte durch Platzhalter wie `<<$env:S0>>`, `<<$env:S1>>` usw. ersetzt.

3. Tool-Call-Argumente, die vom Modell zurückgegeben werden, werden vollständig durchsucht und Platzhalter werden vor der Ausführung auf die ursprünglichen Werte zurückgesetzt.

Zwei Modi steuern, was mit jedem Geheimnis geschieht:

| Modus | Verhalten | Umkehrbar |
|---|---|---|
| `obfuscate` (Standard) | Ersetzt durch indizierten Platzhalter `<<$env:SN>>` | Ja (in Tool-Argumenten entschleiert) |
| `replace` | Ersetzt durch eine deterministische Zeichenkette gleicher Länge | Nein (einseitig) |

## secrets.yml

Benutzerdefinierte Geheimnis-Einträge in YAML definieren. Es werden zwei Speicherorte geprüft:

| Ebene | Pfad | Zweck |
|---|---|---|
| Global | `~/.xcsh/agent/secrets.yml` | Geheimnisse für alle Projekte |
| Projekt | `<cwd>/.xcsh/secrets.yml` | Projektspezifische Geheimnisse |

Projekteinträge überschreiben globale Einträge mit übereinstimmendem `content`.

### Schema

Jeder Eintrag im Array hat diese Felder:

| Feld | Typ | Erforderlich | Beschreibung |
|---|---|---|---|
| `type` | `"plain"` oder `"regex"` | Ja | Übereinstimmungsstrategie |
| `content` | string | Ja | Der geheime Wert (plain) oder das Regex-Muster (regex) |
| `mode` | `"obfuscate"` oder `"replace"` | Nein | Standard: `"obfuscate"` |
| `replacement` | string | Nein | Benutzerdefinierter Ersatz (nur im replace-Modus) |
| `flags` | string | Nein | Regex-Flags (nur für den Typ regex) |

### Beispiele

#### Einfache Geheimnisse

```yaml
# Einen bestimmten API-Schlüssel verschleiern (Standardmodus)
- type: plain
  content: sk-proj-abc123def456

# Ein Datenbankpasswort durch eine feste Zeichenkette ersetzen
- type: plain
  content: hunter2
  mode: replace
  replacement: "********"
```

#### Regex-Geheimnisse

```yaml
# Beliebigen AWS-Stil-Schlüssel verschleiern
- type: regex
  content: "AKIA[0-9A-Z]{16}"

# Groß-/Kleinschreibung-unabhängige Übereinstimmung mit expliziten Flags
- type: regex
  content: "api[_-]?key\\s*=\\s*\\w+"
  flags: "i"

# Regex-Literal-Syntax (Muster und Flags in einer Zeichenkette)
- type: regex
  content: "/bearer\\s+[a-zA-Z0-9._~+\\/=-]+/i"
```

Regex-Einträge scannen immer global (das `g`-Flag wird automatisch erzwungen). Die Regex-Literal-Syntax `/muster/flags` wird als Alternative zu separaten Feldern `content` + `flags` unterstützt. Escaped Slashes innerhalb des Musters (`\\/`) werden korrekt behandelt.

#### replace-Modus mit Regex

```yaml
# Verbindungszeichenketten einseitig ersetzen (nicht umkehrbar)
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## Interaktion mit der Umgebungsvariablen-Erkennung

Umgebungsvariablen werden immer zuerst gesammelt. Datei-definierte Einträge werden danach angehängt, sodass Dateieinträge Geheimnisse abdecken können, die nicht in Umgebungsvariablen gespeichert sind (Konfigurationsdateien, fest kodierte Werte usw.). Wenn derselbe Wert in beiden vorkommt, hat der Modus des Dateieintrags Vorrang.

## Wichtige Dateien

- `src/secrets/index.ts` -- Laden, Zusammenführen, Sammeln von Umgebungsvariablen
- `src/secrets/obfuscator.ts` -- `SecretObfuscator`-Klasse, Platzhalter-Generierung, Nachrichten-Verschleierung
- `src/secrets/regex.ts` -- Regex-Literal-Parsing und -Kompilierung
- `src/config/settings-schema.ts` -- Definition der Einstellung `secrets.enabled`
