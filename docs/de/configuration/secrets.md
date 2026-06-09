---
title: Geheimnis-Verschleierung
description: >-
  Pipeline zur Geheimnis-Verschleierung, die sensible Werte aus
  Sitzungsprotokollen und Ausgaben schwärzt.
sidebar:
  order: 3
  label: Geheimnisse
i18n:
  sourceHash: 1d9dc101c614
  translator: machine
---

# Geheimnis-Verschleierung

Verhindert, dass sensible Werte (API-Schlüssel, Tokens, Passwörter) an LLM-Anbieter gesendet werden. Wenn aktiviert, werden Geheimnisse durch deterministische Platzhalter ersetzt, bevor sie den Prozess verlassen, und in Tool-Call-Argumenten, die vom Modell zurückgegeben werden, wiederhergestellt.

## Aktivierung

Standardmäßig aktiviert. Umschaltbar über die `/settings`-Oberfläche oder direkt in `config.yml`:

```yaml
secrets:
  enabled: false
```

## Funktionsweise

1. Beim Sitzungsstart werden Geheimnisse aus zwei Quellen gesammelt:
   - **Umgebungsvariablen**, die gängigen Geheimnis-Mustern entsprechen (`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, etc.) mit Werten >= 8 Zeichen
   - **`secrets.yml`-Dateien** (siehe unten)

2. Ausgehende Nachrichten an das LLM erhalten alle Geheimniswerte durch Platzhalter wie `<<$env:S0>>`, `<<$env:S1>>`, etc. ersetzt.

3. Tool-Call-Argumente, die vom Modell zurückgegeben werden, werden rekursiv durchlaufen und Platzhalter vor der Ausführung durch die Originalwerte wiederhergestellt.

Zwei Modi steuern, was mit jedem Geheimnis geschieht:

| Modus | Verhalten | Umkehrbar |
|---|---|---|
| `obfuscate` (Standard) | Ersetzt durch indizierten Platzhalter `<<$env:SN>>` | Ja (in Tool-Argumenten deobfuskiert) |
| `replace` | Ersetzt durch deterministischen String gleicher Länge | Nein (einmalig) |

## secrets.yml

Definieren Sie benutzerdefinierte Geheimnis-Einträge in YAML. Zwei Speicherorte werden geprüft:

| Ebene | Pfad | Zweck |
|---|---|---|
| Global | `~/.xcsh/agent/secrets.yml` | Geheimnisse über alle Projekte hinweg |
| Projekt | `<cwd>/.xcsh/secrets.yml` | Projektspezifische Geheimnisse |

Projekteinträge überschreiben globale Einträge mit übereinstimmendem `content`.

### Schema

Jeder Eintrag im Array hat folgende Felder:

| Feld | Typ | Erforderlich | Beschreibung |
|---|---|---|---|
| `type` | `"plain"` oder `"regex"` | Ja | Abgleichstrategie |
| `content` | string | Ja | Der Geheimniswert (plain) oder Regex-Muster (regex) |
| `mode` | `"obfuscate"` oder `"replace"` | Nein | Standard: `"obfuscate"` |
| `replacement` | string | Nein | Benutzerdefinierter Ersetzungstext (nur Replace-Modus) |
| `flags` | string | Nein | Regex-Flags (nur Regex-Typ) |

### Beispiele

#### Einfache Geheimnisse

```yaml
# Obfuscate a specific API key (default mode)
- type: plain
  content: sk-proj-abc123def456

# Replace a database password with a fixed string
- type: plain
  content: hunter2
  mode: replace
  replacement: "********"
```

#### Regex-Geheimnisse

```yaml
# Obfuscate any AWS-style key
- type: regex
  content: "AKIA[0-9A-Z]{16}"

# Case-insensitive match with explicit flags
- type: regex
  content: "api[_-]?key\\s*=\\s*\\w+"
  flags: "i"

# Regex literal syntax (pattern and flags in one string)
- type: regex
  content: "/bearer\\s+[a-zA-Z0-9._~+\\/=-]+/i"
```

Regex-Einträge scannen immer global (das `g`-Flag wird automatisch erzwungen). Die Regex-Literal-Syntax `/pattern/flags` wird als Alternative zu separaten `content`- + `flags`-Feldern unterstützt. Escapte Schrägstriche innerhalb des Musters (`\\/`) werden korrekt behandelt.

#### Replace-Modus mit Regex

```yaml
# One-way replace connection strings (not reversible)
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## Zusammenspiel mit der Umgebungsvariablen-Erkennung

Umgebungsvariablen werden immer zuerst gesammelt. Dateidefinierte Einträge werden danach angehängt, sodass Dateieinträge Geheimnisse abdecken können, die nicht in Umgebungsvariablen existieren (Konfigurationsdateien, hartcodierte Werte, etc.). Wenn derselbe Wert in beiden vorkommt, hat der Modus des Dateieintrags Vorrang.

## Wichtige Dateien

- `src/secrets/index.ts` -- Laden, Zusammenführen, Umgebungsvariablen-Sammlung
- `src/secrets/obfuscator.ts` -- `SecretObfuscator`-Klasse, Platzhalter-Generierung, Nachrichten-Verschleierung
- `src/secrets/regex.ts` -- Regex-Literal-Parsing und -Kompilierung
- `src/config/settings-schema.ts` -- Definition der `secrets.enabled`-Einstellung
