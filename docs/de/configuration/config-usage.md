---
title: Konfigurationserkennung und -auflösung
description: >-
  Wie xcsh Konfiguration aus Projekt-, Benutzer- und
  Unternehmens-Wurzelverzeichnissen erkennt, auflöst und schichtet.
sidebar:
  order: 1
  label: Konfiguration
i18n:
  sourceHash: a8d23493ed0d
  translator: machine
---

# Konfigurationserkennung und -auflösung

Dieses Dokument beschreibt, wie der Coding-Agent heute Konfiguration auflöst: welche Wurzelverzeichnisse durchsucht werden, wie die Rangfolge funktioniert und wie aufgelöste Konfiguration von Einstellungen, Skills, Hooks, Tools und Erweiterungen konsumiert wird.

## Geltungsbereich

Primäre Implementierung:

- `src/config.ts`
- `src/config/settings.ts`
- `src/config/settings-schema.ts`
- `src/discovery/builtin.ts`
- `src/discovery/helpers.ts`

Wichtige Integrationspunkte:

- `src/capability/index.ts`
- `src/discovery/index.ts`
- `src/extensibility/skills.ts`
- `src/extensibility/hooks/loader.ts`
- `src/extensibility/custom-tools/loader.ts`
- `src/extensibility/extensions/loader.ts`

---

## Auflösungsablauf (visuell)

```text
         Config roots (ordered)
┌───────────────────────────────────────┐
│ 1) ~/.xcsh/agent + <cwd>/.xcsh          │
│ 2) ~/.claude   + <cwd>/.claude        │
│ 3) ~/.codex    + <cwd>/.codex         │
│ 4) ~/.gemini   + <cwd>/.gemini        │
└───────────────────────────────────────┘
                    │
                    ▼
        config.ts helper resolution
  (getConfigDirs/findConfigFile/findNearest...)
                    │
                    ▼
       capability providers enumerate items
 (native, claude, codex, gemini, agents, etc.)
                    │
                    ▼
      priority sort + per-capability dedup
                    │
                    ▼
          subsystem-specific consumption
   (settings, skills, hooks, tools, extensions)
```

## 1) Konfigurations-Wurzelverzeichnisse und Quellreihenfolge

## Kanonische Wurzelverzeichnisse

`src/config.ts` definiert eine feste Quellprioritätsliste:

1. `.xcsh` (nativ)
2. `.claude`
3. `.codex`
4. `.gemini`

Benutzerebenen-Basisverzeichnisse:

- `~/.xcsh/agent`
- `~/.claude`
- `~/.codex`
- `~/.gemini`

Projektebenen-Basisverzeichnisse:

- `<cwd>/.xcsh`
- `<cwd>/.claude`
- `<cwd>/.codex`
- `<cwd>/.gemini`

`CONFIG_DIR_NAME` ist `.xcsh` (`packages/utils/src/dirs.ts`).

## Wichtige Einschränkung

Die generischen Hilfsfunktionen in `src/config.ts` beinhalten `.pi` **nicht** in der Quell-Erkennungsreihenfolge.

---

## 2) Kern-Erkennungshelfer (`src/config.ts`)

## `getConfigDirs(subpath, options)`

Gibt geordnete Einträge zurück:

- Benutzerebenen-Einträge zuerst (nach Quellpriorität)
- Dann Projektebenen-Einträge (nach gleicher Quellpriorität)

Optionen:

- `user` (Standard `true`)
- `project` (Standard `true`)
- `cwd` (Standard `getProjectDir()`)
- `existingOnly` (Standard `false`)

Diese API wird für verzeichnisbasierte Konfigurationssuchen verwendet (Befehle, Hooks, Tools, Agents usw.).

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

Durchsucht geordnete Basisverzeichnisse nach der ersten existierenden Datei und gibt den ersten Treffer zurück (nur Pfad oder Pfad+Metadaten).

## `findAllNearestProjectConfigDirs(subpath, cwd)`

Durchläuft übergeordnete Verzeichnisse aufwärts und gibt das **nächste existierende Verzeichnis pro Quellbasis** zurück (`.xcsh`, `.claude`, `.codex`, `.gemini`), sortiert dann die Ergebnisse nach Quellpriorität.

Verwenden Sie dies, wenn Projektkonfiguration von übergeordneten Verzeichnissen geerbt werden soll (Monorepo-/verschachteltes Workspace-Verhalten).

---

## 3) Datei-Konfigurations-Wrapper (`ConfigFile<T>` in `src/config.ts`)

`ConfigFile<T>` ist der schema-validierte Loader für einzelne Konfigurationsdateien.

Unterstützte Formate:

- `.yml` / `.yaml`
- `.json` / `.jsonc`

Verhalten:

- Validiert geparste Daten mit AJV gegen ein bereitgestelltes TypeBox-Schema.
- Speichert Ladeergebnis im Cache bis `invalidate()`.
- Gibt Tri-State-Ergebnis über `tryLoad()` zurück:
  - `ok`
  - `not-found`
  - `error` (`ConfigError` mit Schema-/Parse-Kontext)

Legacy-Migration wird noch unterstützt:

- Wenn der Zielpfad `.yml`/`.yaml` ist, wird eine gleichrangige `.json`-Datei einmalig automatisch migriert (`migrateJsonToYml`).

---

## 4) Einstellungs-Auflösungsmodell (`src/config/settings.ts`)

Das Laufzeit-Einstellungsmodell ist geschichtet:

1. Globale Einstellungen: `~/.xcsh/agent/config.yml`
2. Projekteinstellungen: erkannt über Settings-Capability (`settings.json` von Providern)
3. Laufzeit-Überschreibungen: im Speicher, nicht persistent
4. Schema-Standardwerte: aus `SETTINGS_SCHEMA`

Effektiver Lesepfad:

`defaults <- global <- project <- overrides`

Schreibverhalten:

- `settings.set(...)` schreibt in die **globale** Schicht (`config.yml`) und reiht eine Hintergrundspeicherung ein.
- Projekteinstellungen sind schreibgeschützt aus der Capability-Erkennung.

## Migrationsverhalten noch aktiv

Beim Start, wenn `config.yml` fehlt:

1. Migration von `~/.xcsh/agent/settings.json` (wird bei Erfolg in `.bak` umbenannt)
2. Zusammenführung mit Legacy-DB-Einstellungen aus `agent.db`
3. Zusammengeführtes Ergebnis in `config.yml` schreiben

Feldebenen-Migrationen in `#migrateRawSettings`:

- `queueMode` -> `steeringMode`
- `ask.timeout` Millisekunden -> Sekunden wenn alter Wert wie ms aussieht (`> 1000`)
- Legacy-flaches `theme: "..."` -> `theme.dark/theme.light`-Struktur

---

## 5) Capability-/Erkennungs-Integration

Die meisten Nicht-Kern-Konfigurationsladevorgänge laufen über die Capability-Registry (`src/capability/index.ts` + `src/discovery/index.ts`).

## Provider-Reihenfolge

Provider werden nach numerischer Priorität sortiert (höher zuerst). Beispielhafte Prioritäten:

- Nativer OMP (`builtin.ts`): `100`
- Claude: `80`
- Codex / Agents / Claude Marketplace: `70`
- Gemini: `60`

```text
Provider precedence (higher wins)

native (.xcsh)          priority 100
claude                 priority  80
codex / agents / ...   priority  70
gemini                 priority  60
```

## Deduplizierungs-Semantik

Capabilities definieren einen `key(item)`:

- gleicher Key => erstes Element gewinnt (höher-priorisiertes/früher-geladenes Element)
- kein Key (`undefined`) => keine Deduplizierung, alle Elemente werden beibehalten

Relevante Keys:

- Skills: `name`
- Tools: `name`
- Hooks: `${type}:${tool}:${name}`
- Erweiterungsmodule: `name`
- Erweiterungen: `name`
- Einstellungen: keine Deduplizierung (alle Elemente werden beibehalten)

---

## 6) Natives `.xcsh`-Provider-Verhalten (`src/discovery/builtin.ts`)

Nativer Provider (`id: native`) liest aus:

- Projekt: `<cwd>/.xcsh/...`
- Benutzer: `~/.xcsh/agent/...`

### Verzeichnis-Aufnahmeregel

`builtin.ts` nimmt ein Konfigurations-Wurzelverzeichnis nur auf, wenn das Verzeichnis existiert **und nicht leer ist** (`ifNonEmptyDir`).

### Bereichsspezifisches Laden

- Skills: `skills/*/SKILL.md`
- Slash-Befehle: `commands/*.md`
- Regeln: `rules/*.{md,mdc}`
- Prompts: `prompts/*.md`
- Anweisungen: `instructions/*.md`
- Hooks: `hooks/pre/*`, `hooks/post/*`
- Tools: `tools/*.json|*.md` und `tools/<name>/index.ts`
- Erweiterungsmodule: erkannt unter `extensions/` (+ Legacy `settings.json.extensions` String-Array)
- Erweiterungen: `extensions/<name>/gemini-extension.json`
- Settings-Capability: `settings.json`

### Nächste-Projekt-Suchlogik im Detail

Für `SYSTEM.md` und `AGENTS.md` verwendet der native Provider eine Suche im nächsten übergeordneten Projekt-`.xcsh`-Verzeichnis (Aufwärtssuche), erfordert aber dennoch, dass das `.xcsh`-Verzeichnis nicht leer ist.

---

## 7) Wie die wichtigsten Subsysteme Konfiguration konsumieren

## Einstellungs-Subsystem

- `Settings.init()` lädt globale `config.yml` + erkannte Projekt-`settings.json`-Capability-Elemente.
- Nur Capability-Elemente mit `level === "project"` werden in die Projektschicht zusammengeführt.

## Skills-Subsystem

- `extensibility/skills.ts` lädt über `loadCapability(skillCapability.id, { cwd })`.
- Wendet Quell-Umschalter und Filter an (`ignoredSkills`, `includeSkills`, benutzerdefinierte Verzeichnisse).
- Legacy-benannte Umschalter existieren noch (`skills.enablePiUser`, `skills.enablePiProject`), aber sie steuern den nativen Provider (`provider === "native"`).

## Hooks-Subsystem

- `discoverAndLoadHooks()` löst Hook-Pfade aus der Hook-Capability + explizit konfigurierten Pfaden auf.
- Lädt dann Module über Bun-Import.

## Tools-Subsystem

- `discoverAndLoadCustomTools()` löst Tool-Pfade aus der Tool-Capability + Plugin-Tool-Pfade + explizit konfigurierte Pfade auf.
- Deklarative `.md/.json`-Tool-Dateien sind nur Metadaten; das Laden ausführbarer Dateien erwartet Code-Module.

## Erweiterungs-Subsystem

- `discoverAndLoadExtensions()` löst Erweiterungsmodule aus der Extension-Module-Capability plus expliziten Pfaden auf.
- Die aktuelle Implementierung behält absichtlich nur Capability-Elemente mit `_source.provider === "native"` vor dem Laden bei.

---

## 8) Rangfolgeregeln, auf die man sich verlassen kann

Verwenden Sie dieses mentale Modell:

1. Die Quellverzeichnis-Reihenfolge aus `config.ts` bestimmt die Kandidatenpfad-Reihenfolge.
2. Die Capability-Provider-Priorität bestimmt die providerübergreifende Rangfolge.
3. Die Capability-Key-Deduplizierung bestimmt das Kollisionsverhalten (erstes Element gewinnt bei Capabilities mit Key).
4. Subsystem-spezifische Zusammenführungslogik kann die effektive Rangfolge weiter ändern (insbesondere bei Einstellungen).

### Einstellungsspezifischer Vorbehalt

Einstellungs-Capability-Elemente werden nicht dedupliziert; `Settings.#loadProjectSettings()` führt Projektelemente in der zurückgegebenen Reihenfolge per Deep-Merge zusammen. Da die Zusammenführung spätere Elementwerte über frühere Werte legt, hängt das effektive Überschreibungsverhalten von der Provider-Ausgabereihenfolge ab, nicht nur von der Capability-Key-Semantik.

---

## 9) Noch vorhandene Legacy-/Kompatibilitätsverhalten

- `ConfigFile` JSON -> YAML-Migration für YAML-Zieldateien.
- Einstellungsmigration von `settings.json` und `agent.db` zu `config.yml`.
- Einstellungs-Key-Migrationen (`queueMode`, `ask.timeout`, flaches `theme`).
- Erweiterungsmanifest-Kompatibilität: Der Loader akzeptiert sowohl `package.json.xcsh`- als auch `package.json.pi`-Manifestabschnitte.
- Legacy-Einstellungsnamen `skills.enablePiUser` / `skills.enablePiProject` sind noch aktive Gates für die native Skill-Quelle.

Wenn diese Kompatibilitätspfade im Code entfernt werden, aktualisieren Sie dieses Dokument umgehend; mehrere Laufzeitverhalten hängen heute noch von ihnen ab.
