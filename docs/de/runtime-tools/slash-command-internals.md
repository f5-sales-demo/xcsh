---
title: Interna von Slash-Befehlen
description: >-
  Interna des Slash-Befehlssystems mit Registrierung, Argument-Parsing und
  Ausführungs-Dispatch.
sidebar:
  order: 5
  label: Slash-Befehle
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# Interna von Slash-Befehlen

Dieses Dokument beschreibt, wie Slash-Befehle in `coding-agent` erkannt, dedupliziert, im interaktiven Modus angezeigt und zum Zeitpunkt der Eingabe expandiert werden.

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

Slash-Befehle sind eine Fähigkeit (`id: "slash-commands"`), die nach Befehlsname gekennzeichnet ist (`key: cmd => cmd.name`).

Die Fähigkeitsregistrierung lädt alle registrierten Provider, sortiert nach Provider-Priorität absteigend, und dedupliziert nach Schlüssel nach dem Prinzip **Erster gewinnt**.

### Provider-Rangfolge

Aktuelle Slash-Befehls-Provider und Prioritäten:

1. `native` (OMP) — Priorität `100`
2. `claude` — Priorität `80`
3. `claude-plugins` — Priorität `70`
4. `codex` — Priorität `70`

Gleichstandsverhalten: Provider mit gleicher Priorität behalten die Registrierungsreihenfolge. Die aktuelle Importreihenfolge registriert `claude-plugins` vor `codex`, sodass Plugin-Befehle bei Namenskollisionen gegenüber Codex-Befehlen Vorrang haben.

### Namenskollisionsverhalten

Bei `slash-commands` werden Kollisionen strikt durch Fähigkeits-Deduplizierung aufgelöst:

- Das Element mit der höchsten Priorität wird in `result.items` beibehalten
- Duplikate mit niedrigerer Priorität verbleiben nur in `result.all` und werden mit `_shadowed = true` markiert

Dies gilt sowohl über Provider hinweg als auch innerhalb eines Providers, wenn dieser doppelte Namen zurückgibt.

### Datei-Scan-Verhalten

Provider verwenden größtenteils `loadFilesFromDir(...)`, welches derzeit:

- standardmäßig nicht-rekursives Matching (`*.md`) verwendet
- natives Glob mit `gitignore: true`, `hidden: false` nutzt
- jede gefundene Datei liest und in einen `SlashCommand` umwandelt

Daher werden versteckte Dateien/Verzeichnisse nicht geladen und ignorierte Pfade übersprungen.

## 2) Provider-spezifische Quellpfade und lokale Rangfolge

## `native`-Provider (`builtin.ts`)

Suchroots stammen aus `.xcsh`-Verzeichnissen:

- Projekt: `<cwd>/.xcsh/commands/*.md`
- Benutzer: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` gibt zuerst das Projekt zurück, dann den Benutzer, sodass **native Projektbefehle native Benutzerbefehle** bei Namenskollisionen übertreffen.

## `claude`-Provider (`claude.ts`)

Lädt:

- Benutzer: `~/.claude/commands/*.md`
- Projekt: `<cwd>/.claude/commands/*.md`

Der Provider fügt Benutzerelemente vor Projektelementen ein, sodass **Claude-Benutzerbefehle Claude-Projektbefehle** bei gleichnamigen Kollisionen innerhalb dieses Providers übertreffen.

## `codex`-Provider (`codex.ts`)

Lädt:

- Benutzer: `~/.codex/commands/*.md`
- Projekt: `<cwd>/.codex/commands/*.md`

Beide Seiten werden geladen und dann in Benutzer-zuerst-Reihenfolge zusammengeführt, sodass **Codex-Benutzerbefehle Codex-Projektbefehle** bei Kollisionen übertreffen.

Codex-Befehlsinhalt wird mit Frontmatter-Entfernung geparst (`parseFrontmatter`), und der Befehlsname kann durch Frontmatter-`name` überschrieben werden; andernfalls wird der Dateiname verwendet.

## `claude-plugins`-Provider (`claude-plugins.ts`)

Lädt Plugin-Befehls-Roots aus `~/.claude/plugins/installed_plugins.json` und scannt dann `<pluginRoot>/commands/*.md`.

Die Reihenfolge folgt der Registrierungs-Iterationsreihenfolge und der Eintragsreihenfolge pro Plugin aus diesen JSON-Daten. Es gibt keinen zusätzlichen Sortierschritt.

## 3) Materialisierung zum Laufzeit-`FileSlashCommand`

`loadSlashCommands()` in `src/extensibility/slash-commands.ts` konvertiert Fähigkeitselemente in `FileSlashCommand`-Objekte, die zum Zeitpunkt der Eingabe verwendet werden.

Für jeden Befehl:

1. Frontmatter/Body parsen (`parseFrontmatter`)
2. Beschreibungsquelle:
   - `frontmatter.description`, falls vorhanden
   - sonst erste nicht leere Body-Zeile (getrimmt, max. 60 Zeichen mit `...`)
3. geparsten Body als ausführbaren Vorlageninhalt beibehalten
4. einen Anzeige-Quell-String wie `via Claude Code Project` berechnen

Der Schweregrad des Frontmatter-Parsens ist quellenabhängig:

- `native`-Ebene → Parse-Fehler sind `fatal`
- `user`/`project`-Ebenen → Parse-Fehler sind `warn` mit Fallback-Parsing

### Eingebettete Fallback-Befehle

Nach Dateisystem-/Provider-Befehlen werden eingebettete Befehlsvorlagen angehängt (`EMBEDDED_COMMAND_TEMPLATES`), sofern ihre Namen noch nicht vorhanden sind.

Der aktuelle eingebettete Satz stammt aus `src/task/commands.ts` und wird als Fallback verwendet (`source: "bundled"`).

## 4) Interaktiver Modus: Woher Befehlslisten stammen

Der interaktive Modus kombiniert mehrere Befehlsquellen für die Autovervollständigung und das Befehls-Routing.

Zur Konstruktionszeit erstellt er eine ausstehende Befehlsliste aus:

- eingebauten Befehlen (`BUILTIN_SLASH_COMMANDS`, enthält Argument-Vervollständigung und Inline-Hinweise für ausgewählte Befehle)
- erweiterungs-registrierten Slash-Befehlen (`extensionRunner.getRegisteredCommands(...)`)
- TypeScript-benutzerdefinierten Befehlen (`session.customCommands`), auf Slash-Befehls-Labels gemappt
- optionalen Skill-Befehlen (`/skill:<name>`), wenn `skills.enableSkillCommands` aktiviert ist

Dann ruft `init()` `refreshSlashCommandState(...)` auf, um dateibasierte Befehle zu laden und einen `CombinedAutocompleteProvider` zu installieren, der enthält:

- die oben genannten ausstehenden Befehle
- entdeckte dateibasierte Befehle

`refreshSlashCommandState(...)` aktualisiert auch `session.setSlashCommands(...)`, sodass die Prompt-Expansion denselben entdeckten Dateibefehlssatz verwendet.

### Aktualisierungslebenszyklus

Der Slash-Befehls-Zustand wird aktualisiert:

- während der interaktiven Initialisierung
- nachdem `/move` das Arbeitsverzeichnis geändert hat (`handleMoveCommand` ruft `resetCapabilities()` dann `refreshSlashCommandState(newCwd)` auf)

Es gibt keinen kontinuierlichen Datei-Watcher für Befehlsverzeichnisse.

### Weitere Anzeige

Das Extensions-Dashboard lädt ebenfalls die `slash-commands`-Fähigkeit und zeigt aktive/überschattete Befehlseinträge an, einschließlich `_shadowed`-Duplikate.

## 5) Platzierung in der Prompt-Pipeline

Reihenfolge der Slash-Verarbeitung in `AgentSession.prompt(...)` (wenn `expandPromptTemplates !== false`):

1. **Erweiterungsbefehle** (`#tryExecuteExtensionCommand`)  
   Wenn `/name` einem erweiterungs-registrierten Befehl entspricht, wird der Handler sofort ausgeführt und der Prompt zurückgegeben.
2. **TypeScript-benutzerdefinierte Befehle** (`#tryExecuteCustomCommand`)  
   Nur Grenze: Bei Übereinstimmung wird er ausgeführt und kann zurückgeben:
   - `string` → Prompt-Text durch diesen String ersetzen
   - `void/undefined` → wird als behandelt angesehen; kein LLM-Prompt
3. **Dateibasierte Slash-Befehle** (`expandSlashCommand`)  
   Wenn der Text noch mit `/` beginnt, wird eine Markdown-Befehls-Expansion versucht.
4. **Prompt-Vorlagen** (`expandPromptTemplate`)  
   Nach der Slash-/benutzerdefinierten Verarbeitung angewendet.
5. **Zustellung**
   - im Leerlauf: Prompt wird sofort an den Agenten gesendet
   - beim Streaming: Prompt wird je nach `streamingBehavior` als Steer/Folge-up eingereiht

Deshalb liegt die Slash-Befehls-Expansion vor der Prompt-Vorlagen-Expansion, und warum benutzerdefinierte Befehle den führenden Slash vor dem Dateibefehl-Matching entfernen können.

## 6) Expansionssemantik für dateibasierte Slash-Befehle

Verhalten von `expandSlashCommand(text, fileCommands)`:

- läuft nur, wenn der Text mit `/` beginnt
- parst den Befehlsnamen aus dem ersten Token nach `/`
- parst Argumente aus dem verbleibenden Text via `parseCommandArgs`
- findet exakte Namensübereinstimmung in geladenen `fileCommands`
- bei Übereinstimmung wird angewendet:
  - positionaler Ersatz: `$1`, `$2`, ...
  - aggregierter Ersatz: `$ARGUMENTS` und `$@`
  - dann Vorlagen-Rendering via `prompt.render` mit `{ args, ARGUMENTS, arguments }`
- bei keiner Übereinstimmung wird der ursprüngliche Text unverändert zurückgegeben

### Einschränkungen von `parseCommandArgs`

Der Parser ist ein einfaches, anführungszeichen-bewusstes Splitting:

- unterstützt `'einfache'` und `"doppelte"` Anführungszeichen zum Beibehalten von Leerzeichen
- entfernt Anführungszeichen-Begrenzer
- implementiert keine Backslash-Escape-Regeln
- ein nicht geschlossenes Anführungszeichen ist kein Fehler; der Parser konsumiert bis zum Ende

## 7) Verhalten bei unbekanntem `/...`-Befehl

Unbekannte Slash-Eingabe wird durch die Kern-Slash-Logik **nicht abgelehnt**.

Wenn ein Befehl nicht von Erweiterungs-/benutzerdefinierten/Datei-Schichten verarbeitet wird, gibt `expandSlashCommand` den ursprünglichen Text zurück, und der literale `/...`-Prompt durchläuft die normale Prompt-Vorlagen-Expansion und LLM-Zustellung.

Der interaktive Modus behandelt viele eingebaute Befehle separat im `InputController` (z. B. `/settings`, `/model`, `/mcp`, `/move`, `/exit`). Diese werden vor `session.prompt(...)` verarbeitet und erreichen daher in diesem Pfad niemals die Dateibefehl-Expansion.

## 8) Unterschiede zwischen Streaming und Leerlauf

## Leerlauf-Pfad

- `session.prompt("/x ...")` führt die Befehlspipeline aus und führt entweder den Befehl sofort aus oder sendet den expandierten Text direkt.

## Streaming-Pfad (`session.isStreaming === true`)

- `prompt(...)` führt dennoch zuerst Erweiterungs-/benutzerdefinierte/Datei-/Vorlagen-Transformationen durch
- dann ist `streamingBehavior` erforderlich:
  - `"steer"` → Interrupt-Nachricht einreihen (`agent.steer`)
  - `"followUp"` → Nachdruck-Nachricht einreihen (`agent.followUp`)
- wenn `streamingBehavior` fehlt, wirft der Prompt einen Fehler

### Wichtiges befehlsspezifisches Streaming-Verhalten

- Erweiterungsbefehle werden auch während des Streamings sofort ausgeführt (nicht als Text eingereiht).
- Die Hilfsmethoden `steer(...)`/`followUp(...)` lehnen Erweiterungsbefehle ab (`#throwIfExtensionCommand`), um das Einreihen von Befehlstext für Handler zu vermeiden, die synchron ausgeführt werden müssen.
- Die Compaction-Queue-Wiedergabe verwendet `isKnownSlashCommand(...)`, um zu entscheiden, ob eingereihte Einträge via `session.prompt(...)` (für bekannte Slash-Befehle) oder rohe Steer-/Follow-up-Methoden wiedergegeben werden sollen.

## 9) Fehlerbehandlung und Fehlerflächen

- Provider-Ladefehler sind isoliert; die Registrierung sammelt Warnungen und fährt mit anderen Providern fort.
- Ungültige Slash-Befehls-Elemente (fehlender Name/Pfad/Inhalt oder ungültige Ebene) werden durch Fähigkeitsvalidierung verworfen.
- Frontmatter-Parse-Fehler:
  - native Befehle: fataler Parse-Fehler wird weitergegeben
  - nicht-native Befehle: Warnung + Fallback-Schlüssel/Wert-Parsing
- Ausnahmen in Erweiterungs-/benutzerdefiniertem Befehls-Handler werden abgefangen und über den Erweiterungsfehlerkanal (oder Logger-Fallback für benutzerdefinierte Befehle ohne Erweiterungs-Runner) gemeldet und als behandelt angesehen (keine unbeabsichtigte Fallback-Ausführung).
