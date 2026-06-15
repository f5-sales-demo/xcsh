---
title: Geheimnis-Verschleierung
description: >-
  Pipeline zur Verschleierung sensibler Werte aus Sitzungsprotokollen und
  Ausgaben.
sidebar:
  order: 3
  label: Geheimnisse
i18n:
  sourceHash: 1d9dc101c614
  translator: machine
---

# Geheimnis-Verschleierung

Verhindert, dass sensible Werte (API-Schlüssel, Token, Passwörter) an LLM-Anbieter gesendet werden. Wenn aktiviert, werden Geheimnisse durch deterministische Platzhalter ersetzt, bevor sie den Prozess verlassen, und in Werkzeugaufruf-Argumenten, die vom Modell zurückgegeben werden, wiederhergestellt.

## Aktivierung

Standardmäßig aktiviert. Umschalten über die `/settings`-Oberfläche oder direkt in `config.yml`:

```yaml
secrets:
  enabled: false
```

## Funktionsweise

1. Beim Sitzungsstart werden Geheimnisse aus zwei Quellen gesammelt:
   - **Umgebungsvariablen**, die gängigen Geheimnis-Mustern entsprechen (`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD` usw.) mit Werten >= 8 Zeichen
   - **`secrets.yml`-Dateien** (siehe unten)

2. Ausgehende Nachrichten an das LLM haben alle Geheimniswerte durch Platzhalter wie `<<$env:S0>>`, `<<$env:S1>>` usw. ersetzt.

3. Werkzeugaufruf-Argumente, die vom Modell zurückgegeben werden, werden rekursiv durchsucht und Platzhalter werden vor der Ausführung auf ihre ursprünglichen Werte zurückgesetzt.

Zwei Modi steuern, was mit jedem Geheimnis geschieht:

| Modus | Verhalten | Umkehrbar |
|---|---|---|
| `obfuscate` (Standard) | Ersetzt durch indizierten Platzhalter `<<$env:SN>>` | Ja (in Werkzeugargumenten entschleiert) |
| `replace` | Ersetzt durch eine deterministische gleichlange Zeichenkette | Nein (einwegig) |

## secrets.yml

Definieren Sie benutzerdefinierte Geheimnis-Einträge in YAML. Es werden zwei Speicherorte geprüft:

| Ebene | Pfad | Zweck |
|---|---|---|
| Global | `~/.xcsh/agent/secrets.yml` | Geheimnisse über alle Projekte hinweg |
| Projekt | `<cwd>/.xcsh/secrets.yml` | Projektspezifische Geheimnisse |

Projekteinträge überschreiben globale Einträge mit übereinstimmendem `content`.

### Schema

Jeder Eintrag im Array verfügt über folgende Felder:

| Feld | Typ | Erforderlich | Beschreibung |
|---|---|---|---|
| `type` | `"plain"` oder `"regex"` | Ja | Übereinstimmungsstrategie |
| `content` | Zeichenkette | Ja | Der Geheimniswert (plain) oder das Regex-Muster (regex) |
| `mode` | `"obfuscate"` oder `"replace"` | Nein | Standard: `"obfuscate"` |
| `replacement` | Zeichenkette | Nein | Benutzerdefinierter Ersatz (nur Modus replace) |
| `flags` | Zeichenkette | Nein | Regex-Flags (nur Typ regex) |

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
# Beliebigen AWS-artigen Schlüssel verschleiern
- type: regex
  content: "AKIA[0-9A-Z]{16}"

# Groß-/Kleinschreibungsunabhängige Übereinstimmung mit expliziten Flags
- type: regex
  content: "api[_-]?key\\s*=\\s*\\w+"
  flags: "i"

# Regex-Literal-Syntax (Muster und Flags in einer Zeichenkette)
- type: regex
  content: "/bearer\\s+[a-zA-Z0-9._~+\\/=-]+/i"
```

Regex-Einträge suchen immer global (das Flag `g` wird automatisch erzwungen). Die Regex-Literal-Syntax `/muster/flags` wird als Alternative zu separaten Feldern `content` + `flags` unterstützt. Maskierte Schrägstriche innerhalb des Musters (`\\/`) werden korrekt behandelt.

#### Modus replace mit Regex

```yaml
# Verbindungszeichenketten einwegig ersetzen (nicht umkehrbar)
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## Interaktion mit der Erkennung von Umgebungsvariablen

Umgebungsvariablen werden immer zuerst gesammelt. Dateidefinierte Einträge werden danach angehängt, sodass Dateieinträge Geheimnisse abdecken können, die nicht in Umgebungsvariablen gespeichert sind (Konfigurationsdateien, hartcodierte Werte usw.). Wenn derselbe Wert in beiden vorkommt, hat der Modus des Dateieintrags Vorrang.

## Wichtige Dateien

- `src/secrets/index.ts` -- Laden, Zusammenführen, Sammlung von Umgebungsvariablen
- `src/secrets/obfuscator.ts` -- Klasse `SecretObfuscator`, Platzhaltergenerierung, Nachrichtenverschleierung
- `src/secrets/regex.ts` -- Regex-Literal-Parsing und -Kompilierung
- `src/config/settings-schema.ts` -- Definition der Einstellung `secrets.enabled`
