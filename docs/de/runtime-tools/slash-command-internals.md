---
title: Interna des Slash-Befehl-Systems
description: >-
  Interna des Slash-Befehl-Systems mit Registrierung, Argument-Parsing und
  Ausführungs-Dispatch.
sidebar:
  order: 5
  label: Slash-Befehle
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# Interna des Slash-Befehl-Systems

Dieses Dokument beschreibt, wie Slash-Befehle in `coding-agent` erkannt, dedupliziert, im interaktiven Modus angezeigt und zur Prompt-Zeit expandiert werden.

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

## 1) Erkennungsmodell

Slash-Befehle sind eine Fähigkeit (`id: "slash-commands"`), die nach Befehlsname verschlüsselt ist (`key: cmd => cmd.name`).

Die Fähigkeitsregistrierung lädt alle registrierten Anbieter, sortiert nach Anbieterpriorität absteigend, und dedupliziert nach Schlüssel mit **First-wins**-Semantik.

### Anbieterrangfolge

Aktuelle Slash-Befehl-Anbieter und Prioritäten:

1. `native` (OMP) — Priorität `100`
2. `claude` — Priorität `80`
3. `claude-plugins` — Priorität `70`
4. `codex` — Priorität `70`

Gleichstandsverhalten: Anbieter mit gleicher Priorität behalten die Registrierungsreihenfolge. Die aktuelle Importreihenfolge registriert `claude-plugins` vor `codex`, daher gewinnen Plugin-Befehle bei Namenskollisionen gegenüber Codex-Befehlen.

### Namenskollisionsverhalten

Bei `slash-commands` werden Kollisionen strikt durch Fähigkeits-Dedup aufgelöst:

- Das Element mit der höchsten Priorität wird in `result.items` behalten
- Duplikate mit niedrigerer Priorität verbleiben nur in `result.all` und werden mit `_shadowed = true` markiert

Dies gilt sowohl über Anbieter hinweg als auch innerhalb eines Anbieters, wenn er doppelte Namen zurückgibt.

### Verhalten beim Datei-Scanning

Anbieter verwenden größtenteils `loadFilesFromDir(...)`, das aktuell:

- standardmäßig nicht-rekursives Matching (`*.md`) verwendet
- nativen Glob mit `gitignore: true`, `hidden: false` nutzt
- jede gefundene Datei liest und in einen `SlashCommand` umwandelt

Versteckte Dateien/Verzeichnisse werden daher nicht geladen und ignorierte Pfade werden übersprungen.

## 2) Anbieterspezifische Quellpfade und lokale Rangfolge

## `native`-Anbieter (`builtin.ts`)

Suchstammverzeichnisse stammen aus `.xcsh`-Verzeichnissen:

- Projekt: `<cwd>/.xcsh/commands/*.md`
- Benutzer: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` gibt zuerst das Projekt zurück, dann den Benutzer, sodass **native Projektbefehle bei Namenskollisionen native Benutzerbefehle überschreiben**.

## `claude`-Anbieter (`claude.ts`)

Lädt:

- Benutzer: `~/.claude/commands/*.md`
- Projekt: `<cwd>/.claude/commands/*.md`

Der Anbieter fügt Benutzerelemente vor Projektelementen ein, sodass **Claude-Benutzerbefehle bei gleichen Namenskollisionen innerhalb dieses Anbieters Claude-Projektbefehle überschreiben**.

## `codex`-Anbieter (`codex.ts`)

Lädt:

- Benutzer: `~/.codex/commands/*.md`
- Projekt: `<cwd>/.codex/commands/*.md`

Beide Seiten werden geladen und dann in Benutzer-zuerst-Reihenfolge zusammengeführt, sodass **Codex-Benutzerbefehle bei Kollisionen Codex-Projektbefehle überschreiben**.

Codex-Befehlsinhalt wird mit Frontmatter-Entfernung geparst (`parseFrontmatter`), und der Befehlsname kann durch Frontmatter `name` überschrieben werden; andernfalls wird der Dateiname verwendet.

## `claude-plugins`-Anbieter (`claude-plugins.ts`)

Lädt Plugin-Befehlsstammverzeichnisse aus `~/.claude/plugins/installed_plugins.json` und scannt dann `<pluginRoot>/commands/*.md`.

Die Reihenfolge folgt der Registrierungsiterationsreihenfolge und der Eintragsreihenfolge pro Plugin aus diesen JSON-Daten. Es gibt keinen zusätzlichen Sortierschritt.

## 3) Materialisierung zur Laufzeit als `FileSlashCommand`

`loadSlashCommands()` in `src/extensibility/slash-commands.ts` konvertiert Fähigkeitselemente in `FileSlashCommand`-Objekte, die zur Prompt-Zeit verwendet werden.

Für jeden Befehl:

1. Frontmatter/Body parsen (`parseFrontmatter`)
2. Beschreibungsquelle:
   - `frontmatter.description`, sofern vorhanden
   - andernfalls die erste nicht leere Body-Zeile (getrimmt, max. 60 Zeichen mit `...`)
3. Geparstem Body als ausführbaren Template-Inhalt behalten
4. Eine Anzeigequellzeichenkette wie `via Claude Code Project` berechnen

Der Schweregrad des Frontmatter-Parsens ist quellenabhängig:

- Ebene `native` -> Parse-Fehler sind `fatal`
- Ebenen `user`/`project` -> Parse-Fehler sind `warn` mit Fallback-Parsing

### Eingebettete Fallback-Befehle

Nach Dateisystem-/Anbieterbefehlen werden eingebettete Befehlsvorlagen angehängt (`EMBEDDED_COMMAND_TEMPLATES`), sofern ihre Namen noch nicht vorhanden sind.

Der aktuelle eingebettete Satz stammt aus `src/task/commands.ts` und wird als Fallback verwendet (`source: "bundled"`).

## 4) Interaktiver Modus: Woher die Befehlslisten stammen

Der interaktive Modus kombiniert mehrere Befehlsquellen für Autovervollständigung und Befehlsrouting.

Zur Konstruktionszeit erstellt er eine ausstehende Befehlsliste aus:

- Eingebauten Befehlen (`BUILTIN_SLASH_COMMANDS`, einschließlich Argument-Vervollständigung und Inline-Hinweisen für ausgewählte Befehle)
- Erweiterungsregistrierten Slash-Befehlen (`extensionRunner.getRegisteredCommands(...)`)
- TypeScript-Benutzerbefehlen (`session.customCommands`), auf Slash-Befehlsbezeichnungen abgebildet
- Optionalen Skill-Befehlen (`/skill:<name>`), wenn `skills.enableSkillCommands` aktiviert ist

Dann ruft `init()` `refreshSlashCommandState(...)` auf, um dateibasierte Befehle zu laden und einen `CombinedAutocompleteProvider` zu installieren, der enthält:

- die oben genannten ausstehenden Befehle
- gefundene dateibasierte Befehle

`refreshSlashCommandState(...)` aktualisiert auch `session.setSlashCommands(...)`, damit die Prompt-Expansion denselben gefundenen Dateibefehlssatz verwendet.

### Aktualisierungslebenszyklus

Der Slash-Befehlsstatus wird aktualisiert:

- während der interaktiven Initialisierung
- nachdem `/move` das Arbeitsverzeichnis ändert (`handleMoveCommand` ruft `resetCapabilities()` dann `refreshSlashCommandState(newCwd)` auf)

Es gibt keinen kontinuierlichen Datei-Watcher für Befehlsverzeichnisse.

### Weitere Anzeige

Das Erweiterungs-Dashboard lädt ebenfalls die `slash-commands`-Fähigkeit und zeigt aktive/überschattete Befehlseinträge an, einschließlich `_shadowed`-Duplikaten.

## 5) Platzierung in der Prompt-Pipeline

`AgentSession.prompt(...)`-Slash-Verarbeitungsreihenfolge (wenn `expandPromptTemplates !== false`):

1. **Erweiterungsbefehle** (`#tryExecuteExtensionCommand`)  
   Wenn `/name` mit einem erweiterungsregistrierten Befehl übereinstimmt, wird der Handler sofort ausgeführt und der Prompt kehrt zurück.
2. **TypeScript-Benutzerbefehle** (`#tryExecuteCustomCommand`)  
   Nur Grenze: Bei Übereinstimmung wird er ausgeführt und kann zurückgeben:
   - `string` -> Prompt-Text durch diesen String ersetzen
   - `void/undefined` -> wird als behandelt betrachtet; kein LLM-Prompt
3. **Dateibasierte Slash-Befehle** (`expandSlashCommand`)  
   Wenn der Text noch mit `/` beginnt, wird die Markdown-Befehlsexpansion versucht.
4. **Prompt-Vorlagen** (`expandPromptTemplate`)  
   Nach der Slash-/Benutzerbefehls-Verarbeitung angewendet.
5. **Zustellung**
   - Leerlauf: Prompt wird sofort an den Agenten gesendet
   - Streaming: Prompt wird je nach `streamingBehavior` als Steer/Follow-up in die Warteschlange gestellt

Deshalb liegt die Slash-Befehlsexpansion vor der Prompt-Vorlagenexpansion, und deshalb können Benutzerbefehle den führenden Schrägstrich entfernen, bevor der Dateibefehl-Abgleich erfolgt.

## 6) Expansionssemantik für dateibasierte Slash-Befehle

Verhalten von `expandSlashCommand(text, fileCommands)`:

- wird nur ausgeführt, wenn der Text mit `/` beginnt
- parst den Befehlsnamen aus dem ersten Token nach `/`
- parst Argumente aus dem verbleibenden Text via `parseCommandArgs`
- sucht eine exakte Namensübereinstimmung in den geladenen `fileCommands`
- bei Übereinstimmung wird angewendet:
  - Positionsersetzung: `$1`, `$2`, ...
  - Aggregatersetzung: `$ARGUMENTS` und `$@`
  - dann Template-Rendering via `prompt.render` mit `{ args, ARGUMENTS, arguments }`
- bei keiner Übereinstimmung wird der Originaltext unverändert zurückgegeben

### Einschränkungen von `parseCommandArgs`

Der Parser ist ein einfaches, anführungszeichenfähiges Splitting:

- unterstützt `'einfache'` und `"doppelte"` Anführungszeichen, um Leerzeichen zu erhalten
- entfernt Anführungszeichen-Begrenzer
- implementiert keine Backslash-Escape-Regeln
- nicht abgeschlossene Anführungszeichen sind kein Fehler; der Parser konsumiert bis zum Ende

## 7) Verhalten bei unbekanntem `/...`

Unbekannte Slash-Eingaben werden durch die zentrale Slash-Logik **nicht abgelehnt**.

Wenn ein Befehl nicht von der Erweiterungs-, Benutzer- oder Dateiebene behandelt wird, gibt `expandSlashCommand` den Originaltext zurück, und der wörtliche `/...`-Prompt durchläuft die normale Prompt-Vorlagenexpansion und LLM-Zustellung.

Der interaktive Modus behandelt viele eingebaute Befehle separat direkt in `InputController` (zum Beispiel `/settings`, `/model`, `/mcp`, `/move`, `/exit`). Diese werden vor `session.prompt(...)` verarbeitet und erreichen daher in diesem Pfad niemals die Dateibefehlsexpansion.

## 8) Unterschiede zwischen Streaming und Leerlauf

## Leerlauf-Pfad

- `session.prompt("/x ...")` führt die Befehlspipeline aus und entweder wird der Befehl sofort ausgeführt oder der expandierte Text wird direkt gesendet.

## Streaming-Pfad (`session.isStreaming === true`)

- `prompt(...)` führt weiterhin zuerst Erweiterungs-/Benutzer-/Datei-/Vorlagetransformationen durch
- erfordert dann `streamingBehavior`:
  - `"steer"` -> Interrupt-Nachricht in die Warteschlange stellen (`agent.steer`)
  - `"followUp"` -> Nachricht nach der Runde in die Warteschlange stellen (`agent.followUp`)
- wenn `streamingBehavior` fehlt, wirft der Prompt einen Fehler

### Wichtiges befehlsspezifisches Streaming-Verhalten

- Erweiterungsbefehle werden auch während des Streamings sofort ausgeführt (nicht als Text in die Warteschlange gestellt).
- Die Hilfsmethoden `steer(...)`/`followUp(...)` lehnen Erweiterungsbefehle ab (`#throwIfExtensionCommand`), um zu vermeiden, dass Befehlstext für Handler in die Warteschlange gestellt wird, die synchron ausgeführt werden müssen.
- Die Kompaktierungswarteschlangen-Wiedergabe verwendet `isKnownSlashCommand(...)`, um zu entscheiden, ob in der Warteschlange befindliche Einträge via `session.prompt(...)` (bei bekannten Slash-Befehlen) oder via Raw-Steer-/Follow-up-Methoden wiedergegeben werden sollen.

## 9) Fehlerbehandlung und Fehlerflächen

- Anbieterladefehler sind isoliert; die Registrierung sammelt Warnungen und fährt mit anderen Anbietern fort.
- Ungültige Slash-Befehlselemente (fehlender Name/Pfad/Inhalt oder ungültige Ebene) werden durch die Fähigkeitsvalidierung verworfen.
- Frontmatter-Parse-Fehler:
  - native Befehle: fataler Parse-Fehler wird weitergegeben
  - nicht-native Befehle: Warnung + Fallback-Schlüssel/Wert-Parsing
- Ausnahmen von Erweiterungs-/Benutzerbefehlshandlern werden abgefangen und über den Erweiterungsfehlerkanal gemeldet (oder Logger-Fallback für Benutzerbefehle ohne Erweiterungs-Runner) und als behandelt betrachtet (keine unbeabsichtigte Fallback-Ausführung).
