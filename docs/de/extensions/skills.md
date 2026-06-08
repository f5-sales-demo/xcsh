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

Skills sind dateibasierte Fähigkeitspakete, die beim Start entdeckt und dem Modell bereitgestellt werden als:

- leichtgewichtige Metadaten im System-Prompt (Name + Beschreibung)
- On-Demand-Inhalte über `read skill://...`
- optionale interaktive `/skill:<name>`-Befehle

Dieses Dokument behandelt das aktuelle Laufzeitverhalten in `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` und `src/discovery/agents-md.ts`.

## Was ein Skill in dieser Codebase ist

Ein entdeckter Skill wird dargestellt als:

- `name`
- `description`
- `filePath` (der `SKILL.md`-Pfad)
- `baseDir` (Skill-Verzeichnis)
- Quell-Metadaten (`provider`, `level`, Pfad)

Die Laufzeitumgebung benötigt nur `name` und `path` für die Gültigkeit. In der Praxis hängt die Zuordnungsqualität davon ab, dass `description` aussagekräftig ist.

## Erforderliches Layout und SKILL.md-Erwartungen

### Verzeichnislayout

Bei der Provider-basierten Erkennung (native/Claude/Codex/Agents/Plugin-Provider) werden Skills **eine Ebene unter `skills/`** entdeckt:

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
- zusätzliche Schlüssel werden als unbekannte Metadaten beibehalten

Aktuelles Laufzeitverhalten:

- `name` fällt standardmäßig auf den Skill-Verzeichnisnamen zurück
- `description` ist erforderlich für:
  - native `.xcsh`-Provider-Skill-Erkennung (`requireDescription: true`)
  - `skills.customDirectories`-Scans über `scanSkillsFromDir` in `src/discovery/helpers.ts` (nicht-rekursiv)
- nicht-native Provider können Skills ohne Beschreibung laden

## Erkennungs-Pipeline

`discoverSkills()` in `src/extensibility/skills.ts` führt zwei Durchläufe durch:

1. **Capability-Provider** über `loadCapability("skills")`
2. **Benutzerdefinierte Verzeichnisse** über `scanSkillsFromDir(..., { requireDescription: true })` (einstufige Verzeichnisauflistung)

Wenn `skills.enabled` auf `false` gesetzt ist, gibt die Erkennung keine Skills zurück.

### Integrierte Skill-Provider und Prioritätsreihenfolge

Die Provider-Reihenfolge ist prioritätsbasiert (höher gewinnt), dann Registrierungsreihenfolge bei Gleichstand.

Aktuell registrierte Skill-Provider:

1. `native` (Priorität 100) — `.xcsh` Benutzer-/Projekt-Skills über `src/discovery/builtin.ts`
2. `claude` (Priorität 80)
3. Priorität-70-Gruppe (in Registrierungsreihenfolge):
   - `claude-plugins`
   - `agents`
   - `codex`

Deduplizierungsschlüssel ist der Skill-Name. Das erste Element mit einem gegebenen Namen gewinnt.

### Quell-Schalter und Filterung

`discoverSkills()` wendet diese Steuerungen an:

- Quell-Schalter: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- Glob-Filter auf Skill-Namen:
  - `ignoredSkills` (Ausschluss)
  - `includeSkills` (Einschluss-Allowlist; leer bedeutet alle einschließen)

Filterreihenfolge ist:

1. Quelle aktiviert
2. nicht ignoriert
3. eingeschlossen (falls Einschlussliste vorhanden)

Für andere Provider als codex/claude/native (zum Beispiel `agents`, `claude-plugins`) fällt die Aktivierung derzeit zurück auf: aktiviert, wenn **irgendein** integrierter Quell-Schalter aktiviert ist.

### Kollisions- und Duplikatbehandlung

- Capability-Deduplizierung behält bereits den ersten Skill pro Name (Provider mit höchster Priorität)
- `extensibility/skills.ts` führt zusätzlich:
  - Deduplizierung identischer Dateien nach `realpath` durch (Symlink-sicher)
  - gibt Kollisionswarnungen aus, wenn ein späterer Skill-Name in Konflikt steht
  - behält die Komfort-API `discoverSkillsFromDir({ dir, source })` als dünnen Adapter über `scanSkillsFromDir` bei
- Skills aus benutzerdefinierten Verzeichnissen werden nach Provider-Skills zusammengeführt und folgen demselben Kollisionsverhalten

## Laufzeit-Nutzungsverhalten

### System-Prompt-Einbindung

Die System-Prompt-Konstruktion (`src/system-prompt.ts`) verwendet entdeckte Skills wie folgt:

- wenn das `read`-Tool verfügbar ist:
  - entdeckte Skills-Liste in den Prompt einschließen
- andernfalls:
  - entdeckte Liste weglassen

Task-Tool-Subagenten erhalten die entdeckte/bereitgestellte Skills-Liste der Sitzung über die normale Sitzungserstellung; es gibt keine aufgabenspezifische Skill-Pinning-Überschreibung.

### Interaktive `/skill:<name>`-Befehle

Wenn `skills.enableSkillCommands` auf true gesetzt ist, registriert der interaktive Modus einen Slash-Befehl pro entdecktem Skill.

`/skill:<name> [args]` Verhalten:

- liest die Skill-Datei direkt aus `filePath`
- entfernt Frontmatter
- fügt den Skill-Inhalt als Folge-Nachricht ein
- hängt Metadaten an (`Skill: <path>`, optional `User: <args>`)

## `skill://`-URL-Verhalten

`src/internal-urls/skill-protocol.ts` unterstützt:

- `skill://<name>` → wird zu der `SKILL.md` dieses Skills aufgelöst
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

- Skill-Name muss exakt übereinstimmen
- relative Pfade werden URL-dekodiert
- absolute Pfade werden abgelehnt
- Pfad-Traversierung (`..`) wird abgelehnt
- der aufgelöste Pfad muss innerhalb von `baseDir` bleiben
- fehlende Dateien geben einen expliziten `File not found`-Fehler zurück

Inhaltstyp:

- `.md` => `text/markdown`
- alles andere => `text/plain`

Für fehlende Assets wird keine Fallback-Suche durchgeführt.

## Skills vs. AGENTS.md, Befehle, Tools, Hooks

### Skills vs. AGENTS.md

- **Skills**: benannte, optionale Fähigkeitspakete, die nach Aufgabenkontext ausgewählt oder explizit angefordert werden
- **AGENTS.md/Kontextdateien**: persistente Anweisungsdateien, die als Context-File-Capability geladen und nach Ebene/Tiefe-Regeln zusammengeführt werden

`src/discovery/agents-md.ts` durchläuft spezifisch übergeordnete Verzeichnisse ab `cwd`, um eigenständige `AGENTS.md`-Dateien zu entdecken (bis Tiefe 20), wobei versteckte Verzeichnissegmente ausgeschlossen werden.

### Skills vs. Slash-Befehle

- **Skills**: modell-lesbarer Wissens-/Workflow-Inhalt
- **Slash-Befehle**: vom Benutzer aufgerufene Befehlseinstiegspunkte
- `/skill:<name>` ist ein Komfort-Wrapper, der Skill-Text einfügt; er ändert nicht die Skill-Erkennungssemantik

### Skills vs. benutzerdefinierte Tools

- **Skills**: Dokumentations-/Workflow-Inhalte, die über Prompt-Kontext und `read` geladen werden
- **Benutzerdefinierte Tools**: ausführbare Tool-APIs, die vom Modell mit Schemas und Laufzeit-Seiteneffekten aufgerufen werden können

### Skills vs. Hooks

- **Skills**: passiver Inhalt
- **Hooks**: ereignisgesteuerte Laufzeit-Interceptoren, die Verhalten während der Ausführung blockieren/modifizieren können

## Praktische Authoring-Hinweise bezogen auf die Erkennungslogik

- Platzieren Sie jeden Skill in einem eigenen Verzeichnis: `<skills-root>/<skill-name>/SKILL.md`
- Fügen Sie immer explizite `name`- und `description`-Frontmatter ein
- Bewahren Sie referenzierte Assets unter demselben Skill-Verzeichnis auf und greifen Sie mit `skill://<name>/...` darauf zu
- Für verschachtelte Taxonomien (`team/domain/skill`) verweisen Sie mit `skills.customDirectories` auf das verschachtelte übergeordnete Verzeichnis; das Scanning selbst bleibt nicht-rekursiv
- Vermeiden Sie doppelte Skill-Namen über Quellen hinweg; der erste Treffer gewinnt nach Provider-Priorität
