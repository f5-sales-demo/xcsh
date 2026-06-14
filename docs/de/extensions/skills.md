---
title: Skills
description: >-
  Skills-System zum Registrieren, Entdecken und Aufrufen spezialisierter
  Fähigkeiten im Coding-Agenten.
sidebar:
  order: 3
  label: Skills
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# Skills

Skills sind dateigestützte Fähigkeitspakete, die beim Start erkannt und dem Modell bereitgestellt werden als:

- einfache Metadaten im System-Prompt (Name + Beschreibung)
- bedarfsgesteuerte Inhalte über `read skill://...`
- optionale interaktive `/skill:<name>`-Befehle

Dieses Dokument beschreibt das aktuelle Laufzeitverhalten in `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` und `src/discovery/agents-md.ts`.

## Was ein Skill in dieser Codebasis ist

Ein erkannter Skill wird dargestellt durch:

- `name`
- `description`
- `filePath` (der `SKILL.md`-Pfad)
- `baseDir` (Skill-Verzeichnis)
- Quell-Metadaten (`provider`, `level`, Pfad)

Die Laufzeit erfordert für die Gültigkeit nur `name` und `path`. In der Praxis hängt die Matching-Qualität davon ab, dass `description` aussagekräftig ist.

## Erforderliche Struktur und SKILL.md-Erwartungen

### Verzeichnisstruktur

Bei providerbasierter Erkennung (native/Claude/Codex/Agents/Plugin-Provider) werden Skills **eine Ebene unterhalb von `skills/`** erkannt:

- `<skills-root>/<skill-name>/SKILL.md`

Verschachtelte Muster wie `<skills-root>/group/<skill>/SKILL.md` werden von Provider-Ladeprogrammen nicht erkannt.

Bei `skills.customDirectories` verwendet das Scannen dieselbe nicht-rekursive Struktur (`*/SKILL.md`).

```text
Provider-erkannte Struktur (nicht-rekursiv unter skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ erkannt
  ├─ pdf/
  │   └─ SKILL.md      ✅ erkannt
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ nicht durch Provider-Ladeprogramme erkannt

Custom-Directory-Scanning ist ebenfalls nicht-rekursiv, daher werden verschachtelte Pfade ignoriert, sofern Sie `customDirectories` nicht auf das übergeordnete verschachtelte Verzeichnis verweisen.
```

### `SKILL.md`-Frontmatter

Unterstützte Frontmatter-Felder am Skill-Typ:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- zusätzliche Schlüssel werden als unbekannte Metadaten gespeichert

Aktuelles Laufzeitverhalten:

- `name` ist standardmäßig der Name des Skill-Verzeichnisses
- `description` ist erforderlich für:
  - native `.xcsh`-Provider-Skill-Erkennung (`requireDescription: true`)
  - `skills.customDirectories`-Scans über `scanSkillsFromDir` in `src/discovery/helpers.ts` (nicht-rekursiv)
- Nicht-native Provider können Skills ohne Beschreibung laden

## Erkennungs-Pipeline

`discoverSkills()` in `src/extensibility/skills.ts` führt zwei Durchläufe durch:

1. **Fähigkeits-Provider** über `loadCapability("skills")`
2. **Benutzerdefinierte Verzeichnisse** über `scanSkillsFromDir(..., { requireDescription: true })` (einstufige Verzeichnisaufzählung)

Wenn `skills.enabled` auf `false` gesetzt ist, gibt die Erkennung keine Skills zurück.

### Integrierte Skill-Provider und Vorrang

Die Provider-Reihenfolge ist prioritätsbasiert (höhere Priorität gewinnt), bei Gleichstand gilt die Registrierungsreihenfolge.

Aktuell registrierte Skill-Provider:

1. `native` (Priorität 100) — `.xcsh`-Benutzer-/Projekt-Skills über `src/discovery/builtin.ts`
2. `claude` (Priorität 80)
3. Priorität-70-Gruppe (in Registrierungsreihenfolge):
   - `claude-plugins`
   - `agents`
   - `codex`

Der Deduplizierungsschlüssel ist der Skill-Name. Das erste Element mit einem bestimmten Namen gewinnt.

### Quelltoggle und Filterung

`discoverSkills()` wendet folgende Steuerungen an:

- Quelltoggle: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- Glob-Filter auf Skill-Namen:
  - `ignoredSkills` (ausschließen)
  - `includeSkills` (Einschluss-Allowlist; leer bedeutet alle einschließen)

Filterreihenfolge:

1. Quelle aktiviert
2. nicht ignoriert
3. eingeschlossen (falls Einschlussliste vorhanden)

Für andere Provider als codex/claude/native (z. B. `agents`, `claude-plugins`) fällt die Aktivierung derzeit zurück auf: aktiviert, wenn **irgendein** integrierter Quelltoggle aktiviert ist.

### Kollisions- und Duplikat-Behandlung

- Fähigkeits-Deduplizierung behält bereits den ersten Skill pro Name (Provider mit höchstem Vorrang)
- `extensibility/skills.ts` zusätzlich:
  - Dedupliziert identische Dateien per `realpath` (symlink-sicher)
  - gibt Kollisionswarnungen aus, wenn ein späterer Skill-Name in Konflikt gerät
  - behält die praktische API `discoverSkillsFromDir({ dir, source })` als schlanken Adapter über `scanSkillsFromDir`
- Skills aus benutzerdefinierten Verzeichnissen werden nach Provider-Skills zusammengeführt und folgen demselben Kollisionsverhalten

## Laufzeit-Nutzungsverhalten

### System-Prompt-Bereitstellung

Die System-Prompt-Konstruktion (`src/system-prompt.ts`) verwendet erkannte Skills wie folgt:

- wenn das `read`-Werkzeug verfügbar ist:
  - erkannte Skills-Liste in den Prompt aufnehmen
- andernfalls:
  - erkannte Liste weglassen

Task-Werkzeug-Subagenten erhalten die erkannte/bereitgestellte Skills-Liste der Sitzung über die normale Sitzungserstellung; es gibt kein aufgabenbezogenes Skill-Pinning-Override.

### Interaktive `/skill:<name>`-Befehle

Wenn `skills.enableSkillCommands` true ist, registriert der interaktive Modus pro erkanntem Skill einen Slash-Befehl.

`/skill:<name> [args]`-Verhalten:

- liest die Skill-Datei direkt aus `filePath`
- entfernt Frontmatter
- injiziert den Skill-Inhalt als nachfolgende benutzerdefinierte Nachricht
- fügt Metadaten an (`Skill: <path>`, optionales `User: <args>`)

## `skill://`-URL-Verhalten

`src/internal-urls/skill-protocol.ts` unterstützt:

- `skill://<name>` → wird zur `SKILL.md` dieses Skills aufgelöst
- `skill://<name>/<relative-path>` → wird innerhalb dieses Skill-Verzeichnisses aufgelöst

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

Für fehlende Assets wird keine Fallback-Suche durchgeführt.

## Skills vs. AGENTS.md, Befehle, Werkzeuge, Hooks

### Skills vs. AGENTS.md

- **Skills**: benannte, optionale Fähigkeitspakete, die nach Aufgabenkontext ausgewählt oder explizit angefordert werden
- **AGENTS.md/Kontextdateien**: persistente Anweisungsdateien, die als Kontextdatei-Fähigkeit geladen und nach Ebenen-/Tiefenregeln zusammengeführt werden

`src/discovery/agents-md.ts` durchsucht speziell übergeordnete Verzeichnisse ab `cwd`, um eigenständige `AGENTS.md`-Dateien zu finden (bis zu Tiefe 20), wobei Segmente mit versteckten Verzeichnissen ausgeschlossen werden.

### Skills vs. Slash-Befehle

- **Skills**: modell-lesbare Wissens-/Workflow-Inhalte
- **Slash-Befehle**: benutzergesteuerte Befehlseinstiegspunkte
- `/skill:<name>` ist ein praktischer Wrapper, der Skill-Text injiziert; er ändert nicht die Semantik der Skill-Erkennung

### Skills vs. benutzerdefinierte Werkzeuge

- **Skills**: Dokumentations-/Workflow-Inhalte, die über Prompt-Kontext und `read` geladen werden
- **Benutzerdefinierte Werkzeuge**: ausführbare Werkzeug-APIs, die vom Modell mit Schemata und Laufzeit-Nebeneffekten aufgerufen werden können

### Skills vs. Hooks

- **Skills**: passive Inhalte
- **Hooks**: ereignisgesteuerte Laufzeit-Interceptoren, die während der Ausführung Verhalten blockieren/ändern können

## Praktische Autorenhinweise bezogen auf die Erkennungslogik

- Platzieren Sie jeden Skill in seinem eigenen Verzeichnis: `<skills-root>/<skill-name>/SKILL.md`
- Geben Sie stets explizite Frontmatter-Felder `name` und `description` an
- Halten Sie referenzierte Assets im selben Skill-Verzeichnis und greifen Sie mit `skill://<name>/...` darauf zu
- Für verschachtelte Taxonomien (`team/domain/skill`) verweisen Sie `skills.customDirectories` auf das übergeordnete verschachtelte Verzeichnis; das Scannen selbst bleibt nicht-rekursiv
- Vermeiden Sie doppelte Skill-Namen aus verschiedenen Quellen; der erste Treffer gewinnt nach Provider-Vorrang
