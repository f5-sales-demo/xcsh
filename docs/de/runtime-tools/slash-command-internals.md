---
title: Slash Command Internals
description: >-
  Interne Funktionsweise des Slash-Command-Systems mit Registrierung,
  Argument-Parsing und Ausführungsverteilung.
sidebar:
  order: 5
  label: Slash commands
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# Interne Funktionsweise von Slash-Befehlen

Dieses Dokument beschreibt, wie Slash-Befehle im `coding-agent` entdeckt, dedupliziert, im interaktiven Modus angezeigt und zur Prompt-Zeit expandiert werden.

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

Slash-Befehle sind eine Capability (`id: "slash-commands"`), die nach Befehlsname indiziert wird (`key: cmd => cmd.name`).

Die Capability-Registry lädt alle registrierten Provider, sortiert nach Provider-Priorität absteigend, und dedupliziert nach Schlüssel mit **First-Wins**-Semantik.

### Provider-Rangfolge

Aktuelle Slash-Command-Provider und Prioritäten:

1. `native` (OMP) — Priorität `100`
2. `claude` — Priorität `80`
3. `claude-plugins` — Priorität `70`
4. `codex` — Priorität `70`

Gleichstandsverhalten: Provider mit gleicher Priorität behalten die Registrierungsreihenfolge bei. Die aktuelle Import-Reihenfolge registriert `claude-plugins` vor `codex`, sodass Plugin-Befehle bei Namenskollisionen Vorrang vor Codex-Befehlen haben.

### Verhalten bei Namenskollisionen

Für `slash-commands` werden Kollisionen strikt durch Capability-Deduplizierung aufgelöst:

- Das Element mit der höchsten Priorität wird in `result.items` beibehalten
- Duplikate mit niedrigerer Priorität verbleiben nur in `result.all` und werden mit `_shadowed = true` markiert

Dies gilt providerübergreifend und auch innerhalb eines Providers, wenn dieser doppelte Namen zurückgibt.

### Datei-Scanverhalten

Provider verwenden meist `loadFilesFromDir(...)`, das derzeit:

- standardmäßig nicht-rekursives Matching (`*.md`) verwendet
- nativen Glob mit `gitignore: true`, `hidden: false` nutzt
- jede gefundene Datei liest und in einen `SlashCommand` transformiert

Versteckte Dateien/Verzeichnisse werden daher nicht geladen, und ignorierte Pfade werden übersprungen.

## 2) Provider-spezifische Quellpfade und lokale Rangfolge

## `native`-Provider (`builtin.ts`)

Suchverzeichnisse stammen aus `.xcsh`-Verzeichnissen:

- Projekt: `<cwd>/.xcsh/commands/*.md`
- Benutzer: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` gibt zuerst das Projekt zurück, dann den Benutzer, sodass **Projekt-Native-Befehle Vorrang vor Benutzer-Native-Befehlen** bei Namenskollisionen haben.

## `claude`-Provider (`claude.ts`)

Lädt:

- Benutzer: `~/.claude/commands/*.md`
- Projekt: `<cwd>/.claude/commands/*.md`

Der Provider fügt Benutzer-Elemente vor Projekt-Elementen ein, sodass **Benutzer-Claude-Befehle Vorrang vor Projekt-Claude-Befehlen** bei gleichnamigen Kollisionen innerhalb dieses Providers haben.

## `codex`-Provider (`codex.ts`)

Lädt:

- Benutzer: `~/.codex/commands/*.md`
- Projekt: `<cwd>/.codex/commands/*.md`

Beide Seiten werden geladen und dann in Benutzer-zuerst-Reihenfolge zusammengeführt, sodass **Benutzer-Codex-Befehle Vorrang vor Projekt-Codex-Befehlen** bei Kollisionen haben.

Codex-Befehlsinhalte werden mit Frontmatter-Entfernung (`parseFrontmatter`) geparst, und der Befehlsname kann durch Frontmatter `name` überschrieben werden; andernfalls wird der Dateiname verwendet.

## `claude-plugins`-Provider (`claude-plugins.ts`)

Lädt Plugin-Befehlsverzeichnisse aus `~/.claude/plugins/installed_plugins.json` und scannt dann `<pluginRoot>/commands/*.md`.

Die Reihenfolge folgt der Registry-Iterationsreihenfolge und der Pro-Plugin-Eintragsreihenfolge aus diesen JSON-Daten. Es gibt keinen zusätzlichen Sortierschritt.

## 3) Materialisierung zu Laufzeit-`FileSlashCommand`

`loadSlashCommands()` in `src/extensibility/slash-commands.ts` konvertiert Capability-Elemente in `FileSlashCommand`-Objekte, die zur Prompt-Zeit verwendet werden.

Für jeden Befehl:

1. Frontmatter/Body parsen (`parseFrontmatter`)
2. Beschreibungsquelle:
   - `frontmatter.description` falls vorhanden
   - andernfalls erste nicht-leere Body-Zeile (getrimmt, max. 60 Zeichen mit `...`)
3. Geparsten Body als ausführbaren Template-Inhalt beibehalten
4. Einen Anzeige-Quellstring wie `via Claude Code Project` berechnen

Die Schwere des Frontmatter-Parsens ist quellenabhängig:

- `native`-Level -> Parse-Fehler sind `fatal`
- `user`/`project`-Level -> Parse-Fehler sind `warn` mit Fallback-Parsing

### Gebündelte Fallback-Befehle

Nach Dateisystem-/Provider-Befehlen werden eingebettete Befehlsvorlagen (`EMBEDDED_COMMAND_TEMPLATES`) angehängt, wenn deren Namen noch nicht vorhanden sind.

Das aktuelle eingebettete Set stammt aus `src/task/commands.ts` und wird als Fallback (`source: "bundled"`) verwendet.

## 4) Interaktiver Modus: Woher Befehlslisten stammen

Der interaktive Modus kombiniert mehrere Befehlsquellen für Autovervollständigung und Befehlsweiterleitung.

Zur Konstruktionszeit erstellt er eine ausstehende Befehlsliste aus:

- Built-ins (`BUILTIN_SLASH_COMMANDS`, enthält Argumentvervollständigung und Inline-Hinweise für ausgewählte Befehle)
- Extension-registrierten Slash-Befehlen (`extensionRunner.getRegisteredCommands(...)`)
- TypeScript-benutzerdefinierten Befehlen (`session.customCommands`), gemappt auf Slash-Command-Labels
- Optionalen Skill-Befehlen (`/skill:<name>`), wenn `skills.enableSkillCommands` aktiviert ist

Dann ruft `init()` `refreshSlashCommandState(...)` auf, um dateibasierte Befehle zu laden und einen `CombinedAutocompleteProvider` zu installieren, der enthält:

- Oben genannte ausstehende Befehle
- Entdeckte dateibasierte Befehle

`refreshSlashCommandState(...)` aktualisiert auch `session.setSlashCommands(...)`, damit die Prompt-Expansion denselben Satz entdeckter Dateibefehle verwendet.

### Aktualisierungslebenszyklus

Der Slash-Command-Status wird aktualisiert:

- Während der interaktiven Initialisierung
- Nachdem `/move` das Arbeitsverzeichnis ändert (`handleMoveCommand` ruft `resetCapabilities()` und dann `refreshSlashCommandState(newCwd)` auf)

Es gibt keinen kontinuierlichen Datei-Watcher für Befehlsverzeichnisse.

### Weitere Anzeigen

Das Extensions-Dashboard lädt ebenfalls die `slash-commands`-Capability und zeigt aktive/überschattete Befehlseinträge an, einschließlich `_shadowed`-Duplikate.

## 5) Platzierung in der Prompt-Pipeline

Slash-Behandlungsreihenfolge in `AgentSession.prompt(...)` (wenn `expandPromptTemplates !== false`):

1. **Extension-Befehle** (`#tryExecuteExtensionCommand`)  
   Wenn `/name` einem Extension-registrierten Befehl entspricht, wird der Handler sofort ausgeführt und der Prompt kehrt zurück.
2. **TypeScript-benutzerdefinierte Befehle** (`#tryExecuteCustomCommand`)  
   Nur Grenzfall: Bei Übereinstimmung wird ausgeführt und kann zurückgeben:
   - `string` -> Prompt-Text durch diesen String ersetzen
   - `void/undefined` -> als behandelt betrachtet; kein LLM-Prompt
3. **Dateibasierte Slash-Befehle** (`expandSlashCommand`)  
   Wenn der Text noch mit `/` beginnt, wird eine Markdown-Befehlsexpansion versucht.
4. **Prompt-Templates** (`expandPromptTemplate`)  
   Werden nach Slash-/Custom-Verarbeitung angewendet.
5. **Zustellung**
   - Idle: Prompt wird sofort an den Agenten gesendet
   - Streaming: Prompt wird je nach `streamingBehavior` als Steer/Follow-up in die Warteschlange eingereiht

Deshalb steht die Slash-Command-Expansion vor der Prompt-Template-Expansion, und deshalb können benutzerdefinierte Befehle den führenden Slash vor dem Dateibefehl-Matching entfernen.

## 6) Expansionssemantik für dateibasierte Slash-Befehle

Verhalten von `expandSlashCommand(text, fileCommands)`:

- Wird nur ausgeführt, wenn der Text mit `/` beginnt
- Parst den Befehlsnamen aus dem ersten Token nach `/`
- Parst Argumente aus dem restlichen Text via `parseCommandArgs`
- Findet exakte Namensübereinstimmung in geladenen `fileCommands`
- Bei Übereinstimmung werden angewendet:
  - Positionelle Ersetzung: `$1`, `$2`, ...
  - Aggregierte Ersetzung: `$ARGUMENTS` und `$@`
  - Dann Template-Rendering via `prompt.render` mit `{ args, ARGUMENTS, arguments }`
- Bei keiner Übereinstimmung wird der Originaltext unverändert zurückgegeben

### Besonderheiten von `parseCommandArgs`

Der Parser ist ein einfaches, Anführungszeichen-bewusstes Splitting:

- Unterstützt `'einfache'` und `"doppelte"` Anführungszeichen, um Leerzeichen beizubehalten
- Entfernt Anführungszeichen-Begrenzer
- Implementiert keine Backslash-Escape-Regeln
- Ein nicht geschlossenes Anführungszeichen ist kein Fehler; der Parser konsumiert bis zum Ende

## 7) Verhalten bei unbekanntem `/...`

Unbekannte Slash-Eingaben werden von der Kern-Slash-Logik **nicht abgelehnt**.

Wenn ein Befehl nicht von der Extension-/Custom-/Datei-Schicht behandelt wird, gibt `expandSlashCommand` den Originaltext zurück, und der wörtliche `/...`-Prompt durchläuft die normale Prompt-Template-Expansion und LLM-Zustellung.

Der interaktive Modus behandelt viele Built-ins separat hart im `InputController` (zum Beispiel `/settings`, `/model`, `/mcp`, `/move`, `/exit`). Diese werden vor `session.prompt(...)` konsumiert und erreichen daher nie die Dateibefehl-Expansion auf diesem Pfad.

## 8) Unterschiede zur Streaming-Zeit vs. Idle

## Idle-Pfad

- `session.prompt("/x ...")` durchläuft die Befehlspipeline und führt entweder den Befehl sofort aus oder sendet den expandierten Text direkt.

## Streaming-Pfad (`session.isStreaming === true`)

- `prompt(...)` durchläuft trotzdem zuerst die Extension-/Custom-/Datei-/Template-Transformationen
- Benötigt dann `streamingBehavior`:
  - `"steer"` -> Interrupt-Nachricht in Warteschlange (`agent.steer`)
  - `"followUp"` -> Post-Turn-Nachricht in Warteschlange (`agent.followUp`)
- Wenn `streamingBehavior` weggelassen wird, wirft der Prompt einen Fehler

### Wichtiges befehlsspezifisches Streaming-Verhalten

- Extension-Befehle werden auch während des Streamings sofort ausgeführt (nicht als Text in die Warteschlange eingereiht).
- Die Hilfsmethoden `steer(...)`/`followUp(...)` lehnen Extension-Befehle ab (`#throwIfExtensionCommand`), um zu vermeiden, dass Befehlstext für Handler in die Warteschlange gestellt wird, die synchron ausgeführt werden müssen.
- Die Compaction-Queue-Wiedergabe verwendet `isKnownSlashCommand(...)`, um zu entscheiden, ob Warteschlangeneinträge via `session.prompt(...)` (für bekannte Slash-Befehle) oder via rohe Steer-/Follow-up-Methoden wiedergegeben werden sollen.

## 9) Fehlerbehandlung und Fehleroberflächen

- Provider-Ladefehler werden isoliert; die Registry sammelt Warnungen und fährt mit anderen Providern fort.
- Ungültige Slash-Command-Elemente (fehlender Name/Pfad/Inhalt oder ungültiges Level) werden durch Capability-Validierung verworfen.
- Frontmatter-Parse-Fehler:
  - Native Befehle: Fataler Parse-Fehler wird weitergereicht
  - Nicht-native Befehle: Warnung + Fallback-Key/Value-Parse
- Exceptions in Extension-/Custom-Command-Handlern werden abgefangen und über den Extension-Fehlerkanal gemeldet (oder Logger-Fallback für benutzerdefinierte Befehle ohne Extension-Runner) und als behandelt betrachtet (keine unbeabsichtigte Fallback-Ausführung).
