---
title: Secret Obfuscation
description: >-
  Secret-Obfuscation-Pipeline, die sensible Werte aus Sitzungsprotokollen und
  Ausgaben entfernt.
sidebar:
  order: 3
  label: Secrets
i18n:
  sourceHash: 1d9dc101c614
  translator: machine
---

# Secret Obfuscation

Verhindert, dass sensible Werte (API-Schlüssel, Tokens, Passwörter) an LLM-Anbieter gesendet werden. Wenn aktiviert, werden Secrets durch deterministische Platzhalter ersetzt, bevor sie den Prozess verlassen, und in Tool-Call-Argumenten, die vom Modell zurückgegeben werden, wiederhergestellt.

## Aktivierung

Standardmäßig aktiviert. Umschaltbar über die `/settings`-Oberfläche oder direkt in `config.yml`:

```yaml
secrets:
  enabled: false
```

## Funktionsweise

1. Beim Sitzungsstart werden Secrets aus zwei Quellen gesammelt:
   - **Umgebungsvariablen**, die gängigen Secret-Mustern entsprechen (`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, etc.) mit Werten >= 8 Zeichen
   - **`secrets.yml`-Dateien** (siehe unten)

2. Ausgehende Nachrichten an das LLM erhalten alle Secret-Werte durch Platzhalter wie `<<$env:S0>>`, `<<$env:S1>>`, etc. ersetzt.

3. Tool-Call-Argumente, die vom Modell zurückgegeben werden, werden rekursiv durchlaufen und Platzhalter vor der Ausführung durch die Originalwerte wiederhergestellt.

Zwei Modi steuern, was mit jedem Secret geschieht:

| Modus | Verhalten | Umkehrbar |
|---|---|---|
| `obfuscate` (Standard) | Ersetzt durch indizierten Platzhalter `<<$env:SN>>` | Ja (deobfuskiert in Tool-Argumenten) |
| `replace` | Ersetzt durch deterministischen String gleicher Länge | Nein (einmalig) |

## secrets.yml

Definieren Sie benutzerdefinierte Secret-Einträge in YAML. Zwei Speicherorte werden geprüft:

| Ebene | Pfad | Zweck |
|---|---|---|
| Global | `~/.xcsh/agent/secrets.yml` | Secrets über alle Projekte hinweg |
| Projekt | `<cwd>/.xcsh/secrets.yml` | Projektspezifische Secrets |

Projekteinträge überschreiben globale Einträge mit übereinstimmendem `content`.

### Schema

Jeder Eintrag im Array hat folgende Felder:

| Feld | Typ | Erforderlich | Beschreibung |
|---|---|---|---|
| `type` | `"plain"` oder `"regex"` | Ja | Abgleichstrategie |
| `content` | string | Ja | Der Secret-Wert (plain) oder Regex-Muster (regex) |
| `mode` | `"obfuscate"` oder `"replace"` | Nein | Standard: `"obfuscate"` |
| `replacement` | string | Nein | Benutzerdefinierter Ersatz (nur Replace-Modus) |
| `flags` | string | Nein | Regex-Flags (nur Regex-Typ) |

### Beispiele

#### Plain Secrets

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

#### Regex Secrets

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

Regex-Einträge durchsuchen immer global (das `g`-Flag wird automatisch erzwungen). Die Regex-Literal-Syntax `/pattern/flags` wird als Alternative zu separaten `content`- + `flags`-Feldern unterstützt. Escapte Schrägstriche innerhalb des Musters (`\\/`) werden korrekt behandelt.

#### Replace-Modus mit Regex

```yaml
# One-way replace connection strings (not reversible)
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## Interaktion mit der Umgebungsvariablen-Erkennung

Umgebungsvariablen werden immer zuerst gesammelt. Dateidefinierte Einträge werden danach angehängt, sodass Dateieinträge Secrets abdecken können, die nicht in Umgebungsvariablen vorhanden sind (Konfigurationsdateien, hartcodierte Werte, etc.). Wenn derselbe Wert in beiden vorkommt, hat der Modus des Dateieintrags Vorrang.

## Wichtige Dateien

- `src/secrets/index.ts` -- Laden, Zusammenführen, Umgebungsvariablen-Sammlung
- `src/secrets/obfuscator.ts` -- `SecretObfuscator`-Klasse, Platzhalter-Generierung, Nachrichten-Obfuskierung
- `src/secrets/regex.ts` -- Regex-Literal-Parsing und -Kompilierung
- `src/config/settings-schema.ts` -- Definition der `secrets.enabled`-Einstellung
