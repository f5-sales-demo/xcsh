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

Skills sind dateibasierte Fähigkeitspakete, die beim Start entdeckt und dem Modell wie folgt bereitgestellt werden:

- Leichtgewichtige Metadaten im System-Prompt (Name + Beschreibung)
- Inhalte auf Abruf über `read skill://...`
- Optionale interaktive `/skill:<name>`-Befehle

Dieses Dokument behandelt das aktuelle Laufzeitverhalten in `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` und `src/discovery/agents-md.ts`.

## Was ein Skill in dieser Codebasis ist

Ein entdeckter Skill wird dargestellt als:

- `name`
- `description`
- `filePath` (der `SKILL.md`-Pfad)
- `baseDir` (Skill-Verzeichnis)
- Quell-Metadaten (`provider`, `level`, Pfad)

Die Laufzeitumgebung benötigt nur `name` und `path` für die Gültigkeit. In der Praxis hängt die Zuordnungsqualität davon ab, dass `description` aussagekräftig ist.

## Erforderliches Layout und SKILL.md-Erwartungen

### Verzeichnislayout

Für provider-basierte Erkennung (native/Claude/Codex/Agents/Plugin-Provider) werden Skills **eine Ebene unter `skills/`** entdeckt:

- `<skills-root>/<skill-name>/SKILL.md`

Verschachtelte Muster wie `<skills-root>/group/<skill>/SKILL.md` werden von Provider-Loadern nicht entdeckt.

Für `skills.customDirectories` verwendet das Scanning dasselbe nicht-rekursive Layout (`*/SKILL.md`).

```text
Provider-discovered layout (non-recursive under skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ discovered
  ├─ pdf/
  │   └─ SKILL.md      ✅ discovered
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ not discovered by provider loaders

Custom-directory scanning is also non-recursive, so nested paths are ignored unless you point `customDirectories` at that nested parent.
```

### `SKILL.md`-Frontmatter

Unterstützte Frontmatter-Felder für den Skill-Typ:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- Zusätzliche Schlüssel werden als unbekannte Metadaten beibehalten

Aktuelles Laufzeitverhalten:

- `name` wird standardmäßig auf den Skill-Verzeichnisnamen gesetzt
- `description` ist erforderlich für:
  - Native `.xcsh`-Provider-Skill-Erkennung (`requireDescription: true`)
  - `skills.customDirectories`-Scans über `scanSkillsFromDir` in `src/discovery/helpers.ts` (nicht-rekursiv)
- Nicht-native Provider können Skills ohne Beschreibung laden

## Erkennungs-Pipeline

`discoverSkills()` in `src/extensibility/skills.ts` führt zwei Durchläufe durch:

1. **Capability-Provider** über `loadCapability("skills")`
2. **Benutzerdefinierte Verzeichnisse** über `scanSkillsFromDir(..., { requireDescription: true })` (einstufige Verzeichnisauflistung)

Wenn `skills.enabled` auf `false` gesetzt ist, gibt die Erkennung keine Skills zurück.

### Eingebaute Skill-Provider und Vorrang

Die Provider-Reihenfolge ist prioritätsbasiert (höher gewinnt), bei Gleichstand gilt die Registrierungsreihenfolge.

Aktuell registrierte Skill-Provider:

1. `native` (Priorität 100) — `.xcsh` Benutzer-/Projekt-Skills über `src/discovery/builtin.ts`
2. `claude` (Priorität 80)
3. Priorität-70-Gruppe (in Registrierungsreihenfolge):
   - `claude-plugins`
   - `agents`
   - `codex`

Deduplizierungsschlüssel ist der Skill-Name. Der erste Eintrag mit einem gegebenen Namen gewinnt.

### Quell-Umschalter und Filterung

`discoverSkills()` wendet diese Steuerungen an:

- Quell-Umschalter: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- Glob-Filter auf den Skill-Namen:
  - `ignoredSkills` (Ausschluss)
  - `includeSkills` (Einschluss-Whitelist; leer bedeutet alle einschließen)

Filterreihenfolge:

1. Quelle aktiviert
2. Nicht ignoriert
3. Eingeschlossen (wenn Einschlussliste vorhanden)

Für andere Provider als codex/claude/native (zum Beispiel `agents`, `claude-plugins`) fällt die Aktivierung derzeit zurück auf: aktiviert, wenn **irgendein** eingebauter Quell-Umschalter aktiviert ist.

### Kollisions- und Duplikatbehandlung

- Die Capability-Deduplizierung behält bereits den ersten Skill pro Name (Provider mit höchster Priorität)
- `extensibility/skills.ts` führt zusätzlich:
  - Deduplizierung identischer Dateien per `realpath` (Symlink-sicher)
  - Ausgabe von Kollisionswarnungen, wenn ein späterer Skill-Name in Konflikt steht
  - Beibehaltung der komfortablen `discoverSkillsFromDir({ dir, source })`-API als dünner Adapter über `scanSkillsFromDir`
- Skills aus benutzerdefinierten Verzeichnissen werden nach Provider-Skills zusammengeführt und folgen demselben Kollisionsverhalten

## Laufzeit-Nutzungsverhalten

### System-Prompt-Bereitstellung

Die System-Prompt-Konstruktion (`src/system-prompt.ts`) verwendet entdeckte Skills wie folgt:

- Wenn das `read`-Tool verfügbar ist:
  - Liste der entdeckten Skills im Prompt einschließen
- Andernfalls:
  - Entdeckte Liste weglassen

Task-Tool-Subagenten erhalten die Liste der entdeckten/bereitgestellten Skills der Sitzung über die normale Sitzungserstellung; es gibt keine aufgabenbezogene Skill-Pinning-Überschreibung.

### Interaktive `/skill:<name>`-Befehle

Wenn `skills.enableSkillCommands` auf true gesetzt ist, registriert der interaktive Modus einen Slash-Befehl pro entdecktem Skill.

`/skill:<name> [args]`-Verhalten:

- Liest die Skill-Datei direkt aus `filePath`
- Entfernt das Frontmatter
- Injiziert den Skill-Inhalt als Folge-Custom-Nachricht
- Hängt Metadaten an (`Skill: <path>`, optional `User: <args>`)

## `skill://`-URL-Verhalten

`src/internal-urls/skill-protocol.ts` unterstützt:

- `skill://<name>` → wird zur `SKILL.md` dieses Skills aufgelöst
- `skill://<name>/<relativer-pfad>` → wird innerhalb des Skill-Verzeichnisses aufgelöst

```text
skill:// URL resolution

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

Guards:
- reject absolute paths
- reject `..` traversal
- reject any resolved path escaping <pdf-base>
```

Auflösungsdetails:

- Der Skill-Name muss exakt übereinstimmen
- Relative Pfade werden URL-dekodiert
- Absolute Pfade werden abgelehnt
- Pfad-Traversierung (`..`) wird abgelehnt
- Der aufgelöste Pfad muss innerhalb von `baseDir` bleiben
- Fehlende Dateien geben einen expliziten `File not found`-Fehler zurück

Inhaltstyp:

- `.md` => `text/markdown`
- Alles andere => `text/plain`

Für fehlende Assets wird keine Fallback-Suche durchgeführt.

## Skills vs. AGENTS.md, Befehle, Tools, Hooks

### Skills vs. AGENTS.md

- **Skills**: Benannte, optionale Fähigkeitspakete, die nach Aufgabenkontext oder expliziter Anfrage ausgewählt werden
- **AGENTS.md/Kontextdateien**: Persistente Anweisungsdateien, die als Context-File-Capability geladen und nach Level-/Tiefe-Regeln zusammengeführt werden

`src/discovery/agents-md.ts` durchläuft spezifisch übergeordnete Verzeichnisse ab `cwd`, um eigenständige `AGENTS.md`-Dateien zu entdecken (bis zu Tiefe 20), wobei Segmente in versteckten Verzeichnissen ausgeschlossen werden.

### Skills vs. Slash-Befehle

- **Skills**: Modell-lesbarer Wissens-/Workflow-Inhalt
- **Slash-Befehle**: Vom Benutzer aufgerufene Befehlseinstiegspunkte
- `/skill:<name>` ist ein Komfort-Wrapper, der Skill-Text injiziert; er ändert nicht die Skill-Erkennungssemantik

### Skills vs. benutzerdefinierte Tools

- **Skills**: Dokumentations-/Workflow-Inhalte, die über Prompt-Kontext und `read` geladen werden
- **Benutzerdefinierte Tools**: Ausführbare Tool-APIs, die vom Modell mit Schemas und Laufzeit-Seiteneffekten aufgerufen werden können

### Skills vs. Hooks

- **Skills**: Passiver Inhalt
- **Hooks**: Ereignisgesteuerte Laufzeit-Interceptoren, die Verhalten während der Ausführung blockieren/modifizieren können

## Praktische Erstellungshinweise bezogen auf die Erkennungslogik

- Platzieren Sie jeden Skill in einem eigenen Verzeichnis: `<skills-root>/<skill-name>/SKILL.md`
- Fügen Sie immer explizites `name`- und `description`-Frontmatter hinzu
- Halten Sie referenzierte Assets im selben Skill-Verzeichnis und greifen Sie mit `skill://<name>/...` darauf zu
- Für verschachtelte Taxonomien (`team/domain/skill`) verweisen Sie `skills.customDirectories` auf das verschachtelte Elternverzeichnis; das Scanning selbst bleibt nicht-rekursiv
- Vermeiden Sie doppelte Skill-Namen über Quellen hinweg; der erste Treffer gewinnt nach Provider-Vorrang
