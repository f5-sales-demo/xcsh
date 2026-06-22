---
title: Skills
description: >-
  Skills-System zur Registrierung, Erkennung und dem Aufruf spezialisierter
  Fähigkeiten im Coding-Agenten.
sidebar:
  order: 3
  label: Skills
i18n:
  sourceHash: 3e062cc13851
  translator: machine
---

# Skills

Skills sind dateibasierte Fähigkeitspakete, die beim Start erkannt und dem Modell bereitgestellt werden als:

- kompakte Metadaten im System-Prompt (Name + Beschreibung)
- On-Demand-Inhalte über `read skill://...`
- optionale interaktive `/skill:<name>`-Befehle

Dieses Dokument beschreibt das aktuelle Laufzeitverhalten in `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` und `src/discovery/agents-md.ts`.

## Was ein Skill in dieser Codebasis ist

Ein erkannter Skill wird wie folgt dargestellt:

- `name`
- `description`
- `filePath` (der `SKILL.md`-Pfad)
- `baseDir` (Skill-Verzeichnis)
- Quell-Metadaten (`provider`, `level`, Pfad)

Die Laufzeitumgebung erfordert für die Gültigkeit nur `name` und `path`. In der Praxis hängt die Übereinstimmungsqualität davon ab, dass `description` aussagekräftig ist.

## Erforderliche Struktur und Erwartungen an SKILL.md

### Verzeichnisstruktur

Für die providerbasierte Erkennung (native/Claude/Codex/Agents/Plugin-Provider) werden Skills als **eine Ebene unterhalb von `skills/`** erkannt:

- `<skills-root>/<skill-name>/SKILL.md`

Verschachtelte Muster wie `<skills-root>/group/<skill>/SKILL.md` werden von Provider-Loadern nicht erkannt.

Bei `skills.customDirectories` verwendet die Suche dieselbe nicht-rekursive Struktur (`*/SKILL.md`).

```text
Provider-erkannte Struktur (nicht-rekursiv unter skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ erkannt
  ├─ pdf/
  │   └─ SKILL.md      ✅ erkannt
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ von Provider-Loadern nicht erkannt

Die Suche in benutzerdefinierten Verzeichnissen ist ebenfalls nicht-rekursiv, daher werden verschachtelte Pfade ignoriert, sofern Sie `customDirectories` nicht auf das übergeordnete verschachtelte Verzeichnis verweisen.
```

### `SKILL.md`-Frontmatter

Unterstützte Frontmatter-Felder des Skill-Typs:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- zusätzliche Schlüssel werden als unbekannte Metadaten gespeichert

Aktuelles Laufzeitverhalten:

- `name` verwendet standardmäßig den Namen des Skill-Verzeichnisses
- `description` ist erforderlich für:
  - native `.xcsh`-Provider-Skill-Erkennung (`requireDescription: true`)
  - `skills.customDirectories`-Scans über `scanSkillsFromDir` in `src/discovery/helpers.ts` (nicht-rekursiv)
- Nicht-native Provider können Skills ohne Beschreibung laden

## Erkennungs-Pipeline

`discoverSkills()` in `src/extensibility/skills.ts` führt zwei Durchläufe durch:

1. **Fähigkeits-Provider** über `loadCapability("skills")`
2. **Benutzerdefinierte Verzeichnisse** über `scanSkillsFromDir(..., { requireDescription: true })` (einstufige Verzeichnisaufzählung)

Wenn `skills.enabled` den Wert `false` hat, gibt die Erkennung keine Skills zurück.

### Integrierte Skill-Provider und Prioritäten

Die Provider-Reihenfolge ist prioritätsbasiert (höher gewinnt), bei Gleichstand gilt die Registrierungsreihenfolge.

Aktuell registrierte Skill-Provider:

1. `native` (Priorität 100) — `.xcsh`-Benutzer-/Projekt-Skills über `src/discovery/builtin.ts`
2. `claude` (Priorität 80)
3. Priorität-70-Gruppe (in Registrierungsreihenfolge):
   - `claude-plugins`
   - `agents`
   - `codex`

Der Deduplizierungsschlüssel ist der Skill-Name. Das erste Element mit einem bestimmten Namen gewinnt.

### Quell-Schalter und Filterung

`discoverSkills()` wendet folgende Steuerungen an:

- Quell-Schalter: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- Glob-Filter auf Skill-Name:
  - `ignoredSkills` (ausschließen)
  - `includeSkills` (Zulassungsliste; leer bedeutet alle einschließen)

Filterreihenfolge:

1. Quelle aktiviert
2. nicht ignoriert
3. eingeschlossen (wenn Einschlussliste vorhanden)

Für andere Provider als codex/claude/native (zum Beispiel `agents`, `claude-plugins`) fällt die Aktivierung derzeit auf folgenden Standardwert zurück: aktiviert, wenn **irgendein** integrierter Quell-Schalter aktiviert ist.

### Kollisions- und Duplikatbehandlung

- Fähigkeits-Deduplizierung behält bereits den ersten Skill pro Name (Provider mit höchster Priorität)
- `extensibility/skills.ts` führt zusätzlich folgendes durch:
  - Deduplizierung identischer Dateien über `realpath` (symlink-sicher)
  - Ausgabe von Kollisionswarnungen, wenn ein späterer Skill-Name in Konflikt gerät
  - Bereitstellung der komfortablen `discoverSkillsFromDir({ dir, source })`-API als schlanker Adapter über `scanSkillsFromDir`
- Skills aus benutzerdefinierten Verzeichnissen werden nach Provider-Skills zusammengeführt und folgen demselben Kollisionsverhalten

## Laufzeitnutzungsverhalten

### System-Prompt-Bereitstellung

Die System-Prompt-Konstruktion (`src/system-prompt.ts`) verwendet erkannte Skills wie folgt:

- wenn das `read`-Werkzeug verfügbar ist:
  - erkannte Skills-Liste in Prompt einschließen
- andernfalls:
  - erkannte Liste weglassen

Task-Tool-Subagenten erhalten die erkannte/bereitgestellte Skills-Liste der Sitzung über die normale Sitzungserstellung; es gibt keine aufgabenspezifische Skill-Pinning-Überschreibung.

### Interaktive `/skill:<name>`-Befehle

Wenn `skills.enableSkillCommands` den Wert `true` hat, registriert der interaktive Modus einen Slash-Befehl pro erkanntem Skill.

Verhalten von `/skill:<name> [args]`:

- liest die Skill-Datei direkt aus `filePath`
- entfernt Frontmatter
- fügt den Skill-Inhalt als benutzerdefinierte Folgemeldung ein
- hängt Metadaten an (`Skill: <path>`, optional `User: <args>`)

## Verhalten der `skill://`-URL

`src/internal-urls/skill-protocol.ts` unterstützt:

- `skill://<name>` → wird zur `SKILL.md` des jeweiligen Skills aufgelöst
- `skill://<name>/<relative-path>` → wird innerhalb des Skill-Verzeichnisses aufgelöst

```text
skill://-URL-Auflösung

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

Schutzmaßnahmen:
- absolute Pfade ablehnen
- `..`-Traversierung ablehnen
- jeden aufgelösten Pfad ablehnen, der <pdf-base> verlässt
```

Auflösungsdetails:

- Skill-Name muss exakt übereinstimmen
- relative Pfade werden URL-dekodiert
- absolute Pfade werden abgelehnt
- Pfad-Traversierung (`..`) wird abgelehnt
- aufgelöster Pfad muss innerhalb von `baseDir` verbleiben
- fehlende Dateien geben einen expliziten `File not found`-Fehler zurück

Inhaltstyp:

- `.md` => `text/markdown`
- alles andere => `text/plain`

Für fehlende Ressourcen wird keine Fallback-Suche durchgeführt.

## Skills vs. XCSH.md, Befehle, Werkzeuge, Hooks

### Skills vs. XCSH.md

- **Skills**: benannte, optionale Fähigkeitspakete, die nach Aufgabenkontext ausgewählt oder explizit angefordert werden
- **XCSH.md/Kontextdateien**: persistente Anweisungsdateien, die als Kontext-Datei-Fähigkeit geladen und nach Ebenen-/Tiefenregeln zusammengeführt werden

`src/discovery/agents-md.ts` durchläuft explizit übergeordnete Verzeichnisse ausgehend von `cwd`, um eigenständige `XCSH.md`-Dateien zu erkennen (bis zu Tiefe 20), wobei Segmente versteckter Verzeichnisse ausgeschlossen werden.

### Skills vs. Slash-Befehle

- **Skills**: modelllesbare Wissens-/Workflow-Inhalte
- **Slash-Befehle**: benutzerseitig aufgerufene Befehls-Einstiegspunkte
- `/skill:<name>` ist ein komfortabler Wrapper, der Skill-Text einfügt; er ändert nicht die Skill-Erkennungssemantik

### Skills vs. benutzerdefinierte Werkzeuge

- **Skills**: Dokumentations-/Workflow-Inhalte, die über Prompt-Kontext und `read` geladen werden
- **Benutzerdefinierte Werkzeuge**: ausführbare Werkzeug-APIs, die vom Modell mit Schemata und Laufzeit-Seiteneffekten aufgerufen werden können

### Skills vs. Hooks

- **Skills**: passive Inhalte
- **Hooks**: ereignisgesteuerte Laufzeit-Interceptoren, die Verhalten während der Ausführung blockieren/ändern können

## Praktische Anleitungen zur Erstellung im Zusammenhang mit der Erkennungslogik

- Legen Sie jeden Skill in seinem eigenen Verzeichnis ab: `<skills-root>/<skill-name>/SKILL.md`
- Fügen Sie immer explizite Frontmatter-Felder `name` und `description` hinzu
- Halten Sie referenzierte Ressourcen im selben Skill-Verzeichnis und greifen Sie darauf mit `skill://<name>/...` zu
- Für verschachtelte Taxonomien (`team/domain/skill`) verweisen Sie `skills.customDirectories` auf das übergeordnete verschachtelte Verzeichnis; die Suche selbst bleibt nicht-rekursiv
- Vermeiden Sie doppelte Skill-Namen über Quellen hinweg; der erste Treffer gewinnt nach Provider-Priorität
