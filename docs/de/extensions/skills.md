---
title: Skills
description: >-
  Skills-System zur Registrierung, Erkennung und Aufruf spezialisierter
  Fähigkeiten im Coding-Agenten.
sidebar:
  order: 3
  label: Skills
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# Skills

Skills sind dateibasierte Fähigkeitspakete, die beim Start erkannt und dem Modell bereitgestellt werden als:

- leichtgewichtige Metadaten im System-Prompt (Name + Beschreibung)
- bedarfsgesteuerter Inhalt via `read skill://...`
- optionale interaktive `/skill:<name>`-Befehle

Dieses Dokument beschreibt das aktuelle Laufzeitverhalten in `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` und `src/discovery/agents-md.ts`.

## Was ein Skill in dieser Codebasis ist

Ein erkannter Skill wird wie folgt dargestellt:

- `name`
- `description`
- `filePath` (der `SKILL.md`-Pfad)
- `baseDir` (Skill-Verzeichnis)
- Quell-Metadaten (`provider`, `level`, Pfad)

Die Laufzeit erfordert für die Gültigkeit nur `name` und `path`. In der Praxis hängt die Übereinstimmungsqualität davon ab, dass `description` aussagekräftig ist.

## Erforderliche Struktur und SKILL.md-Anforderungen

### Verzeichnisstruktur

Bei der providerbasierten Erkennung (native/Claude/Codex/Agents/Plugin-Provider) werden Skills **eine Ebene unterhalb von `skills/`** erkannt:

- `<skills-root>/<skill-name>/SKILL.md`

Verschachtelte Muster wie `<skills-root>/group/<skill>/SKILL.md` werden von Provider-Loadern nicht erkannt.

Bei `skills.customDirectories` verwendet das Scanning dieselbe nicht-rekursive Struktur (`*/SKILL.md`).

```text
Provider-erkannte Struktur (nicht-rekursiv unter skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ erkannt
  ├─ pdf/
  │   └─ SKILL.md      ✅ erkannt
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ nicht erkannt von Provider-Loadern

Das Scanning benutzerdefinierter Verzeichnisse ist ebenfalls nicht-rekursiv, sodass verschachtelte Pfade ignoriert werden, sofern `customDirectories` nicht auf das übergeordnete verschachtelte Verzeichnis verweist.
```

### `SKILL.md`-Frontmatter

Unterstützte Frontmatter-Felder im Skill-Typ:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- zusätzliche Schlüssel werden als unbekannte Metadaten beibehalten

Aktuelles Laufzeitverhalten:

- `name` verwendet standardmäßig den Namen des Skill-Verzeichnisses
- `description` ist erforderlich für:
  - Skill-Erkennung durch den nativen `.xcsh`-Provider (`requireDescription: true`)
  - `skills.customDirectories`-Scans via `scanSkillsFromDir` in `src/discovery/helpers.ts` (nicht-rekursiv)
- Nicht-native Provider können Skills ohne Beschreibung laden

## Erkennungs-Pipeline

`discoverSkills()` in `src/extensibility/skills.ts` führt zwei Durchläufe durch:

1. **Fähigkeits-Provider** via `loadCapability("skills")`
2. **Benutzerdefinierte Verzeichnisse** via `scanSkillsFromDir(..., { requireDescription: true })` (einstufige Verzeichnisaufzählung)

Wenn `skills.enabled` auf `false` gesetzt ist, gibt die Erkennung keine Skills zurück.

### Integrierte Skill-Provider und Rangfolge

Die Provider-Reihenfolge erfolgt nach Priorität (höher gewinnt), bei Gleichstand nach Registrierungsreihenfolge.

Aktuell registrierte Skill-Provider:

1. `native` (Priorität 100) — `.xcsh`-Benutzer-/Projekt-Skills via `src/discovery/builtin.ts`
2. `claude` (Priorität 80)
3. Gruppe mit Priorität 70 (in Registrierungsreihenfolge):
   - `claude-plugins`
   - `agents`
   - `codex`

Der Deduplizierungsschlüssel ist der Skill-Name. Das erste Element mit einem bestimmten Namen gewinnt.

### Quell-Umschalter und Filterung

`discoverSkills()` wendet folgende Steuerungen an:

- Quell-Umschalter: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- Glob-Filter auf Skill-Namen:
  - `ignoredSkills` (ausschließen)
  - `includeSkills` (Einschluss-Zulassungsliste; leer bedeutet alle einschließen)

Filterreihenfolge:

1. Quelle aktiviert
2. nicht ignoriert
3. eingeschlossen (wenn Einschlussliste vorhanden)

Für andere Provider als codex/claude/native (z. B. `agents`, `claude-plugins`) fällt die Aktivierung aktuell zurück auf: aktiviert, wenn **irgendein** integrierter Quell-Umschalter aktiviert ist.

### Kollisions- und Duplikatbehandlung

- Die Fähigkeits-Deduplizierung behält bereits den ersten Skill pro Name (Provider mit höchster Priorität)
- `extensibility/skills.ts` führt zusätzlich Folgendes durch:
  - Deduplizierung identischer Dateien nach `realpath` (Symlink-sicher)
  - Ausgabe von Kollisionswarnungen, wenn ein späterer Skill-Name kollidiert
  - Beibehaltung der praktischen `discoverSkillsFromDir({ dir, source })`-API als schlanker Adapter über `scanSkillsFromDir`
- Skills aus benutzerdefinierten Verzeichnissen werden nach Provider-Skills zusammengeführt und folgen demselben Kollisionsverhalten

## Laufzeit-Nutzungsverhalten

### System-Prompt-Bereitstellung

Die System-Prompt-Konstruktion (`src/system-prompt.ts`) verwendet erkannte Skills wie folgt:

- wenn das `read`-Werkzeug verfügbar ist:
  - erkannte Skills-Liste in den Prompt einbinden
- andernfalls:
  - erkannte Liste weglassen

Task-Werkzeug-Subagenten erhalten die erkannte/bereitgestellte Skills-Liste der Sitzung über die normale Sitzungserstellung; es gibt keine aufgabenbezogene Skill-Pinning-Überschreibung.

### Interaktive `/skill:<name>`-Befehle

Wenn `skills.enableSkillCommands` auf true gesetzt ist, registriert der interaktive Modus für jeden erkannten Skill einen Slash-Befehl.

`/skill:<name> [args]`-Verhalten:

- liest die Skill-Datei direkt aus `filePath`
- entfernt das Frontmatter
- fügt den Skill-Inhalt als nachfolgende benutzerdefinierte Nachricht ein
- hängt Metadaten an (`Skill: <path>`, optional `User: <args>`)

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
- `..`-Traversal ablehnen
- jeden aufgelösten Pfad ablehnen, der <pdf-base> verlässt
```

Auflösungsdetails:

- Skill-Name muss exakt übereinstimmen
- relative Pfade werden URL-dekodiert
- absolute Pfade werden abgelehnt
- Pfad-Traversal (`..`) wird abgelehnt
- der aufgelöste Pfad muss innerhalb von `baseDir` verbleiben
- fehlende Dateien geben einen expliziten `File not found`-Fehler zurück

Inhaltstyp:

- `.md` => `text/markdown`
- alles andere => `text/plain`

Es wird keine Fallback-Suche nach fehlenden Assets durchgeführt.

## Skills vs. AGENTS.md, Befehle, Werkzeuge, Hooks

### Skills vs. AGENTS.md

- **Skills**: benannte, optionale Fähigkeitspakete, die nach Aufgabenkontext ausgewählt oder explizit angefordert werden
- **AGENTS.md/Kontextdateien**: persistente Anweisungsdateien, die als Kontextdatei-Fähigkeit geladen und nach Ebenen-/Tiefenregeln zusammengeführt werden

`src/discovery/agents-md.ts` durchsucht speziell übergeordnete Verzeichnisse ab `cwd`, um eigenständige `AGENTS.md`-Dateien zu entdecken (bis zu Tiefe 20), wobei versteckte Verzeichnissegmente ausgeschlossen werden.

### Skills vs. Slash-Befehle

- **Skills**: modellesbare Wissens-/Workflow-Inhalte
- **Slash-Befehle**: benutzerseitig aufgerufene Befehlseinstiegspunkte
- `/skill:<name>` ist ein praktischer Wrapper, der Skill-Text einfügt; er verändert nicht die Skill-Erkennungssemantik

### Skills vs. benutzerdefinierte Werkzeuge

- **Skills**: Dokumentations-/Workflow-Inhalte, die über Prompt-Kontext und `read` geladen werden
- **Benutzerdefinierte Werkzeuge**: ausführbare Werkzeug-APIs, die vom Modell mit Schemas und Laufzeit-Nebeneffekten aufgerufen werden können

### Skills vs. Hooks

- **Skills**: passive Inhalte
- **Hooks**: ereignisgesteuerte Laufzeit-Interceptoren, die Verhalten während der Ausführung blockieren/verändern können

## Praktische Erstellungshinweise bezogen auf die Erkennungslogik

- Platzieren Sie jeden Skill in seinem eigenen Verzeichnis: `<skills-root>/<skill-name>/SKILL.md`
- Fügen Sie immer explizites `name`- und `description`-Frontmatter ein
- Bewahren Sie referenzierte Assets im selben Skill-Verzeichnis auf und greifen Sie mit `skill://<name>/...` darauf zu
- Für verschachtelte Taxonomien (`team/domain/skill`) verweisen Sie `skills.customDirectories` auf das übergeordnete verschachtelte Verzeichnis; das Scanning selbst bleibt nicht-rekursiv
- Vermeiden Sie doppelte Skill-Namen über Quellen hinweg; der erste Treffer gewinnt nach Provider-Priorität
