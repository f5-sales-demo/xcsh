---
title: Skills
description: >-
  Skills-System zur Registrierung, Erkennung und Ausführung spezialisierter
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
- Inhalte auf Abruf über `read skill://...`
- optionale interaktive `/skill:<name>`-Befehle

Dieses Dokument behandelt das aktuelle Laufzeitverhalten in `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` und `src/discovery/agents-md.ts`.

## Was ein Skill in dieser Codebasis ist

Ein erkannter Skill wird dargestellt als:

- `name`
- `description`
- `filePath` (der `SKILL.md`-Pfad)
- `baseDir` (Skill-Verzeichnis)
- Quell-Metadaten (`provider`, `level`, Pfad)

Die Laufzeitumgebung erfordert nur `name` und `path` für die Gültigkeit. In der Praxis hängt die Zuordnungsqualität davon ab, ob `description` aussagekräftig ist.

## Erforderliches Layout und SKILL.md-Erwartungen

### Verzeichnislayout

Für anbieterbasierte Erkennung (native/Claude/Codex/Agents/Plugin-Anbieter) werden Skills **eine Ebene unterhalb von `skills/`** erkannt:

- `<skills-root>/<skill-name>/SKILL.md`

Verschachtelte Muster wie `<skills-root>/group/<skill>/SKILL.md` werden von Anbieter-Ladern nicht erkannt.

Für `skills.customDirectories` verwendet das Scannen das gleiche nicht-rekursive Layout (`*/SKILL.md`).

```text
Anbieter-erkanntes Layout (nicht-rekursiv unter skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ erkannt
  ├─ pdf/
  │   └─ SKILL.md      ✅ erkannt
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ nicht von Anbieter-Ladern erkannt

Das Scannen benutzerdefinierter Verzeichnisse ist ebenfalls nicht-rekursiv, sodass verschachtelte Pfade ignoriert werden, es sei denn, Sie verweisen mit `customDirectories` auf das verschachtelte übergeordnete Verzeichnis.
```

### `SKILL.md`-Frontmatter

Unterstützte Frontmatter-Felder für den Skill-Typ:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- zusätzliche Schlüssel werden als unbekannte Metadaten beibehalten

Aktuelles Laufzeitverhalten:

- `name` verwendet standardmäßig den Skill-Verzeichnisnamen
- `description` ist erforderlich für:
  - native `.xcsh`-Anbieter-Skill-Erkennung (`requireDescription: true`)
  - `skills.customDirectories`-Scans über `scanSkillsFromDir` in `src/discovery/helpers.ts` (nicht-rekursiv)
- nicht-native Anbieter können Skills ohne Beschreibung laden

## Erkennungs-Pipeline

`discoverSkills()` in `src/extensibility/skills.ts` führt zwei Durchläufe durch:

1. **Fähigkeitsanbieter** über `loadCapability("skills")`
2. **Benutzerdefinierte Verzeichnisse** über `scanSkillsFromDir(..., { requireDescription: true })` (einstufige Verzeichnisauflistung)

Wenn `skills.enabled` auf `false` steht, gibt die Erkennung keine Skills zurück.

### Integrierte Skill-Anbieter und Priorität

Die Anbieter-Reihenfolge ist prioritätsbasiert (höher gewinnt), dann Registrierungsreihenfolge bei Gleichstand.

Aktuell registrierte Skill-Anbieter:

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
  - `ignoredSkills` (ausschließen)
  - `includeSkills` (Einschluss-Erlaubnisliste; leer bedeutet alle einschließen)

Filterreihenfolge:

1. Quelle aktiviert
2. nicht ignoriert
3. eingeschlossen (falls Einschlussliste vorhanden)

Für andere Anbieter als codex/claude/native (zum Beispiel `agents`, `claude-plugins`) fällt die Aktivierung derzeit zurück auf: aktiviert, wenn **irgendein** integrierter Quell-Umschalter aktiviert ist.

### Kollisions- und Duplikatbehandlung

- Fähigkeits-Deduplizierung behält bereits den ersten Skill pro Name (Anbieter mit höchster Priorität)
- `extensibility/skills.ts` führt zusätzlich durch:
  - Deduplizierung identischer Dateien nach `realpath` (symlink-sicher)
  - gibt Kollisionswarnungen aus, wenn ein späterer Skill-Name in Konflikt steht
  - behält die praktische `discoverSkillsFromDir({ dir, source })`-API als dünnen Adapter über `scanSkillsFromDir` bei
- Skills aus benutzerdefinierten Verzeichnissen werden nach Anbieter-Skills zusammengeführt und folgen dem gleichen Kollisionsverhalten

## Laufzeit-Nutzungsverhalten

### System-Prompt-Bereitstellung

Die System-Prompt-Konstruktion (`src/system-prompt.ts`) verwendet erkannte Skills wie folgt:

- wenn das `read`-Tool verfügbar ist:
  - erkannte Skills-Liste im Prompt einschließen
- andernfalls:
  - erkannte Liste weglassen

Task-Tool-Subagenten erhalten die erkannte/bereitgestellte Skills-Liste der Sitzung über die normale Sitzungserstellung; es gibt keine aufgabenspezifische Skill-Pinning-Überschreibung.

### Interaktive `/skill:<name>`-Befehle

Wenn `skills.enableSkillCommands` auf true steht, registriert der interaktive Modus einen Slash-Befehl pro erkanntem Skill.

`/skill:<name> [args]`-Verhalten:

- liest die Skill-Datei direkt von `filePath`
- entfernt Frontmatter
- fügt den Skill-Inhalt als Folgenachricht ein
- hängt Metadaten an (`Skill: <path>`, optional `User: <args>`)

## `skill://`-URL-Verhalten

`src/internal-urls/skill-protocol.ts` unterstützt:

- `skill://<name>` → löst sich zur `SKILL.md` dieses Skills auf
- `skill://<name>/<relativer-pfad>` → löst sich innerhalb des Skill-Verzeichnisses auf

```text
skill:// URL-Auflösung

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
- aufgelöster Pfad muss innerhalb von `baseDir` bleiben
- fehlende Dateien geben einen expliziten `File not found`-Fehler zurück

Inhaltstyp:

- `.md` => `text/markdown`
- alles andere => `text/plain`

Es wird keine Fallback-Suche für fehlende Assets durchgeführt.

## Skills vs. AGENTS.md, Befehle, Tools, Hooks

### Skills vs. AGENTS.md

- **Skills**: benannte, optionale Fähigkeitspakete, die nach Aufgabenkontext ausgewählt oder explizit angefordert werden
- **AGENTS.md/Kontextdateien**: persistente Instruktionsdateien, die als Kontextdatei-Fähigkeit geladen und nach Ebene/Tiefe-Regeln zusammengeführt werden

`src/discovery/agents-md.ts` durchläuft speziell übergeordnete Verzeichnisse von `cwd` aus, um eigenständige `AGENTS.md`-Dateien zu erkennen (bis zu Tiefe 20), wobei versteckte Verzeichnissegmente ausgeschlossen werden.

### Skills vs. Slash-Befehle

- **Skills**: modelllesbare Wissens-/Workflow-Inhalte
- **Slash-Befehle**: benutzerausgelöste Befehlseinstiegspunkte
- `/skill:<name>` ist ein praktischer Wrapper, der Skill-Text einfügt; er ändert nicht die Skill-Erkennungssemantik

### Skills vs. benutzerdefinierte Tools

- **Skills**: Dokumentations-/Workflow-Inhalte, die über Prompt-Kontext und `read` geladen werden
- **Benutzerdefinierte Tools**: ausführbare Tool-APIs, die vom Modell mit Schemas und Laufzeit-Seiteneffekten aufgerufen werden können

### Skills vs. Hooks

- **Skills**: passive Inhalte
- **Hooks**: ereignisgesteuerte Laufzeit-Interceptoren, die Verhalten während der Ausführung blockieren/modifizieren können

## Praktische Erstellungshinweise bezogen auf die Erkennungslogik

- Platzieren Sie jeden Skill in einem eigenen Verzeichnis: `<skills-root>/<skill-name>/SKILL.md`
- Fügen Sie immer explizites `name`- und `description`-Frontmatter hinzu
- Halten Sie referenzierte Assets im gleichen Skill-Verzeichnis und greifen Sie mit `skill://<name>/...` darauf zu
- Für verschachtelte Taxonomie (`team/domain/skill`) verweisen Sie mit `skills.customDirectories` auf das verschachtelte übergeordnete Verzeichnis; das Scannen selbst bleibt nicht-rekursiv
- Vermeiden Sie doppelte Skill-Namen über Quellen hinweg; der erste Treffer gewinnt nach Anbieter-Priorität
