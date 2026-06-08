---
title: Slash Command Internals
description: >-
  Interna des Slash-Command-Systems mit Registrierung, Argument-Parsing und
  Ausführungsdispatch.
sidebar:
  order: 5
  label: Slash commands
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# Interna der Slash-Commands

Dieses Dokument beschreibt, wie Slash-Commands entdeckt, dedupliziert, im interaktiven Modus bereitgestellt und zur Prompt-Zeit in `coding-agent` expandiert werden.

## Implementierungsdateien

- [`src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)
- [`src/capability/slash-command.ts`](../../packages/coding-agent/src/capability/slash-command.ts)
- [`src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`src/discovery/claude.ts`](../../packages/coding-agent/src/discovery/claude.ts)
- [`src/discovery/codex.ts`](../../packages/coding-agent/src/discovery/codex.ts)
- [`src/discovery/claude-plugins.ts`](../../packages/coding-agent/src/discovery/claude-plugins.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)

## 1) Discovery-Modell

Slash-Commands sind eine Capability (`id: "slash-commands"`), die nach Command-Name indiziert wird (`key: cmd => cmd.name`).

Die Capability-Registry lädt alle registrierten Provider, sortiert nach absteigender Provider-Priorität, und dedupliziert nach Schlüssel mit **First-Wins**-Semantik.

### Provider-Rangfolge

Aktuelle Slash-Command-Provider und Prioritäten:

1. `native` (OMP) — Priorität `100`
2. `claude` — Priorität `80`
3. `claude-plugins` — Priorität `70`
4. `codex` — Priorität `70`

Gleichstand-Verhalten: Provider mit gleicher Priorität behalten die Registrierungsreihenfolge bei. Die aktuelle Import-Reihenfolge registriert `claude-plugins` vor `codex`, sodass Plugin-Commands bei Namenskollisionen Vorrang vor Codex-Commands haben.

### Verhalten bei Namenskollisionen

Bei `slash-commands` werden Kollisionen strikt durch Capability-Deduplizierung aufgelöst:

- das Element mit der höchsten Priorität wird in `result.items` beibehalten
- Duplikate mit niedrigerer Priorität verbleiben nur in `result.all` und werden mit `_shadowed = true` markiert

Dies gilt providerübergreifend und auch innerhalb eines Providers, wenn dieser doppelte Namen zurückgibt.

### Verhalten beim Dateiscan

Provider verwenden überwiegend `loadFilesFromDir(...)`, das derzeit:

- standardmäßig nicht-rekursives Matching (`*.md`) verwendet
- nativen Glob mit `gitignore: true`, `hidden: false` nutzt
- jede gefundene Datei einliest und in einen `SlashCommand` transformiert

Versteckte Dateien/Verzeichnisse werden daher nicht geladen, und ignorierte Pfade werden übersprungen.

## 2) Provider-spezifische Quellpfade und lokale Rangfolge

## `native`-Provider (`builtin.ts`)

Suchverzeichnisse stammen aus `.xcsh`-Verzeichnissen:

- Projekt: `<cwd>/.xcsh/commands/*.md`
- Benutzer: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` gibt Projekt zuerst zurück, dann Benutzer, sodass **native Projekt-Commands native Benutzer-Commands schlagen**, wenn Namen kollidieren.

## `claude`-Provider (`claude.ts`)

Lädt:

- Benutzer: `~/.claude/commands/*.md`
- Projekt: `<cwd>/.claude/commands/*.md`

Der Provider fügt Benutzer-Elemente vor Projekt-Elementen ein, sodass **Claude-Benutzer-Commands Claude-Projekt-Commands schlagen** bei gleichnamigen Kollisionen innerhalb dieses Providers.

## `codex`-Provider (`codex.ts`)

Lädt:

- Benutzer: `~/.codex/commands/*.md`
- Projekt: `<cwd>/.codex/commands/*.md`

Beide Seiten werden geladen und in Benutzer-zuerst-Reihenfolge zusammengeführt, sodass **Codex-Benutzer-Commands Codex-Projekt-Commands schlagen** bei Kollisionen.

Codex-Command-Inhalte werden mit Frontmatter-Entfernung (`parseFrontmatter`) geparst, und der Command-Name kann durch das Frontmatter-Feld `name` überschrieben werden; andernfalls wird der Dateiname verwendet.

## `claude-plugins`-Provider (`claude-plugins.ts`)

Lädt Plugin-Command-Verzeichnisse aus `~/.claude/plugins/installed_plugins.json` und scannt dann `<pluginRoot>/commands/*.md`.

Die Reihenfolge folgt der Registry-Iterationsreihenfolge und der Eintragsreihenfolge pro Plugin aus diesen JSON-Daten. Es gibt keinen zusätzlichen Sortierschritt.

## 3) Materialisierung zu Runtime-`FileSlashCommand`

`loadSlashCommands()` in `src/extensibility/slash-commands.ts` konvertiert Capability-Elemente in `FileSlashCommand`-Objekte, die zur Prompt-Zeit verwendet werden.

Für jeden Command:

1. Frontmatter/Body parsen (`parseFrontmatter`)
2. Beschreibungsquelle:
   - `frontmatter.description` falls vorhanden
   - sonst erste nicht-leere Body-Zeile (getrimmt, max. 60 Zeichen mit `...`)
3. geparsten Body als ausführbaren Template-Inhalt beibehalten
4. einen Anzeige-Quellstring berechnen wie `via Claude Code Project`

Die Schwere beim Frontmatter-Parsen ist quellabhängig:

- `native`-Level -> Parse-Fehler sind `fatal`
- `user`/`project`-Level -> Parse-Fehler sind `warn` mit Fallback-Parsing

### Mitgelieferte Fallback-Commands

Nach Dateisystem-/Provider-Commands werden eingebettete Command-Templates angehängt (`EMBEDDED_COMMAND_TEMPLATES`), wenn deren Namen noch nicht vorhanden sind.

Das aktuelle eingebettete Set stammt aus `src/task/commands.ts` und wird als Fallback verwendet (`source: "bundled"`).

## 4) Interaktiver Modus: Woher Command-Listen stammen

Der interaktive Modus kombiniert mehrere Command-Quellen für Autovervollständigung und Command-Routing.

Zur Konstruktionszeit wird eine ausstehende Command-Liste erstellt aus:

- Built-ins (`BUILTIN_SLASH_COMMANDS`, einschließlich Argument-Vervollständigung und Inline-Hinweisen für ausgewählte Commands)
- von Extensions registrierte Slash-Commands (`extensionRunner.getRegisteredCommands(...)`)
- TypeScript-Custom-Commands (`session.customCommands`), auf Slash-Command-Labels gemappt
- optionale Skill-Commands (`/skill:<name>`), wenn `skills.enableSkillCommands` aktiviert ist

Dann ruft `init()` `refreshSlashCommandState(...)` auf, um dateibasierte Commands zu laden und einen `CombinedAutocompleteProvider` zu installieren, der enthält:

- oben genannte ausstehende Commands
- entdeckte dateibasierte Commands

`refreshSlashCommandState(...)` aktualisiert auch `session.setSlashCommands(...)`, sodass die Prompt-Expansion denselben entdeckten Datei-Command-Satz verwendet.

### Aktualisierungs-Lebenszyklus

Der Slash-Command-Zustand wird aktualisiert:

- während der interaktiven Initialisierung
- nachdem `/move` das Arbeitsverzeichnis ändert (`handleMoveCommand` ruft `resetCapabilities()` auf, dann `refreshSlashCommandState(newCwd)`)

Es gibt keinen kontinuierlichen Datei-Watcher für Command-Verzeichnisse.

### Weitere Bereitstellung

Das Extensions-Dashboard lädt ebenfalls die `slash-commands`-Capability und zeigt aktive/shadowed Command-Einträge an, einschließlich `_shadowed`-Duplikate.

## 5) Platzierung in der Prompt-Pipeline

Slash-Behandlungsreihenfolge in `AgentSession.prompt(...)` (wenn `expandPromptTemplates !== false`):

1. **Extension-Commands** (`#tryExecuteExtensionCommand`)  
   Wenn `/name` mit einem von einer Extension registrierten Command übereinstimmt, wird der Handler sofort ausgeführt und der Prompt kehrt zurück.
2. **TypeScript-Custom-Commands** (`#tryExecuteCustomCommand`)  
   Nur Grenzfall: Bei Übereinstimmung wird er ausgeführt und kann zurückgeben:
   - `string` -> Prompt-Text wird durch diesen String ersetzt
   - `void/undefined` -> wird als behandelt gewertet; kein LLM-Prompt
3. **Dateibasierte Slash-Commands** (`expandSlashCommand`)  
   Wenn der Text immer noch mit `/` beginnt, wird eine Markdown-Command-Expansion versucht.
4. **Prompt-Templates** (`expandPromptTemplate`)  
   Werden nach der Slash-/Custom-Verarbeitung angewandt.
5. **Zustellung**
   - Leerlauf: Prompt wird sofort an den Agenten gesendet
   - Streaming: Prompt wird als Steer/Follow-up in die Warteschlange gestellt, abhängig von `streamingBehavior`

Deshalb steht die Slash-Command-Expansion vor der Prompt-Template-Expansion, und deshalb können Custom-Commands den führenden Slash entfernen, bevor das Datei-Command-Matching stattfindet.

## 6) Expansions-Semantik für dateibasierte Slash-Commands

Verhalten von `expandSlashCommand(text, fileCommands)`:

- wird nur ausgeführt, wenn der Text mit `/` beginnt
- parst den Command-Namen aus dem ersten Token nach `/`
- parst Argumente aus dem restlichen Text via `parseCommandArgs`
- findet eine exakte Namensübereinstimmung in den geladenen `fileCommands`
- bei Übereinstimmung wird angewandt:
  - Positionsersetzung: `$1`, `$2`, ...
  - Aggregat-Ersetzung: `$ARGUMENTS` und `$@`
  - dann Template-Rendering via `prompt.render` mit `{ args, ARGUMENTS, arguments }`
- bei keiner Übereinstimmung wird der Originaltext unverändert zurückgegeben

### `parseCommandArgs`-Besonderheiten

Der Parser ist ein einfaches, anführungszeichen-bewusstes Splitting:

- unterstützt `'einfache'` und `"doppelte"` Anführungszeichen, um Leerzeichen zu erhalten
- entfernt Anführungszeichen-Begrenzer
- implementiert keine Backslash-Escaping-Regeln
- ein nicht geschlossenes Anführungszeichen ist kein Fehler; der Parser konsumiert bis zum Ende

## 7) Verhalten bei unbekanntem `/...`

Unbekannte Slash-Eingaben werden von der Kern-Slash-Logik **nicht abgelehnt**.

Wenn ein Command nicht durch die Extension-/Custom-/Datei-Schichten behandelt wird, gibt `expandSlashCommand` den Originaltext zurück, und der wörtliche `/...`-Prompt durchläuft die normale Prompt-Template-Expansion und LLM-Zustellung.

Der interaktive Modus behandelt separat viele Built-ins hart im `InputController` (zum Beispiel `/settings`, `/model`, `/mcp`, `/move`, `/exit`). Diese werden vor `session.prompt(...)` konsumiert und erreichen daher in diesem Pfad nie die Datei-Command-Expansion.

## 8) Unterschiede bei Streaming vs. Leerlauf

## Leerlauf-Pfad

- `session.prompt("/x ...")` durchläuft die Command-Pipeline und führt entweder den Command sofort aus oder sendet den expandierten Text direkt.

## Streaming-Pfad (`session.isStreaming === true`)

- `prompt(...)` durchläuft weiterhin zuerst Extension-/Custom-/Datei-/Template-Transformationen
- erfordert dann `streamingBehavior`:
  - `"steer"` -> Interrupt-Nachricht in die Warteschlange stellen (`agent.steer`)
  - `"followUp"` -> Post-Turn-Nachricht in die Warteschlange stellen (`agent.followUp`)
- wenn `streamingBehavior` weggelassen wird, wirft der Prompt einen Fehler

### Wichtiges Command-spezifisches Streaming-Verhalten

- Extension-Commands werden auch während des Streamings sofort ausgeführt (nicht als Text in die Warteschlange gestellt).
- Die `steer(...)`/`followUp(...)`-Hilfsmethoden lehnen Extension-Commands ab (`#throwIfExtensionCommand`), um zu vermeiden, dass Command-Text für Handler in die Warteschlange gestellt wird, die synchron ausgeführt werden müssen.
- Die Compaction-Queue-Wiedergabe verwendet `isKnownSlashCommand(...)`, um zu entscheiden, ob Warteschlangeneinträge über `session.prompt(...)` wiedergegeben werden sollen (für bekannte Slash-Commands) oder über rohe Steer-/Follow-up-Methoden.

## 9) Fehlerbehandlung und Fehleroberflächen

- Provider-Ladefehler sind isoliert; die Registry sammelt Warnungen und fährt mit anderen Providern fort.
- Ungültige Slash-Command-Elemente (fehlender Name/Pfad/Inhalt oder ungültiges Level) werden durch die Capability-Validierung verworfen.
- Frontmatter-Parse-Fehler:
  - native Commands: fataler Parse-Fehler wird weitergereicht
  - nicht-native Commands: Warnung + Fallback-Key/Value-Parsing
- Exceptions in Extension-/Custom-Command-Handlern werden abgefangen und über den Extension-Fehlerkanal gemeldet (oder Logger-Fallback für Custom-Commands ohne Extension-Runner) und als behandelt gewertet (keine unbeabsichtigte Fallback-Ausführung).
