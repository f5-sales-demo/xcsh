---
title: Interna der Slash-Befehle
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

# Interna der Slash-Befehle

Dieses Dokument beschreibt, wie Slash-Befehle in `coding-agent` entdeckt, dedupliziert, im interaktiven Modus angezeigt und zur Prompt-Zeit expandiert werden.

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

Slash-Befehle sind eine Capability (`id: "slash-commands"`), die nach Befehlsname indiziert wird (`key: cmd => cmd.name`).

Die Capability-Registry lädt alle registrierten Provider, sortiert nach Provider-Priorität absteigend, und dedupliziert nach Schlüssel mit **First-Wins**-Semantik.

### Provider-Rangfolge

Aktuelle Slash-Command-Provider und Prioritäten:

1. `native` (OMP) — Priorität `100`
2. `claude` — Priorität `80`
3. `claude-plugins` — Priorität `70`
4. `codex` — Priorität `70`

Gleichstand-Verhalten: Provider mit gleicher Priorität behalten die Registrierungsreihenfolge. Die aktuelle Import-Reihenfolge registriert `claude-plugins` vor `codex`, sodass Plugin-Befehle bei Namenskollisionen Vorrang vor Codex-Befehlen haben.

### Namenskollisions-Verhalten

Bei `slash-commands` werden Kollisionen strikt durch Capability-Deduplizierung aufgelöst:

- Das Element mit der höchsten Priorität wird in `result.items` beibehalten
- Duplikate mit niedrigerer Priorität verbleiben nur in `result.all` und werden mit `_shadowed = true` markiert

Dies gilt provider-übergreifend und auch innerhalb eines Providers, wenn dieser doppelte Namen zurückgibt.

### Datei-Scan-Verhalten

Provider verwenden überwiegend `loadFilesFromDir(...)`, das derzeit:

- standardmäßig nicht-rekursives Matching (`*.md`) verwendet
- nativen Glob mit `gitignore: true`, `hidden: false` nutzt
- jede gefundene Datei liest und in einen `SlashCommand` transformiert

Versteckte Dateien/Verzeichnisse werden daher nicht geladen, und ignorierte Pfade werden übersprungen.

## 2) Provider-spezifische Quellpfade und lokale Rangfolge

## `native`-Provider (`builtin.ts`)

Suchursprünge stammen aus `.xcsh`-Verzeichnissen:

- Projekt: `<cwd>/.xcsh/commands/*.md`
- Benutzer: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` gibt zuerst das Projekt zurück, dann den Benutzer, sodass **native Projektbefehle native Benutzerbefehle schlagen**, wenn Namen kollidieren.

## `claude`-Provider (`claude.ts`)

Lädt:

- Benutzer: `~/.claude/commands/*.md`
- Projekt: `<cwd>/.claude/commands/*.md`

Der Provider fügt Benutzer-Elemente vor Projekt-Elementen ein, sodass **Claude-Benutzerbefehle Claude-Projektbefehle schlagen** bei gleichnamigen Kollisionen innerhalb dieses Providers.

## `codex`-Provider (`codex.ts`)

Lädt:

- Benutzer: `~/.codex/commands/*.md`
- Projekt: `<cwd>/.codex/commands/*.md`

Beide Seiten werden geladen und dann in Benutzer-zuerst-Reihenfolge zusammengeführt, sodass **Codex-Benutzerbefehle Codex-Projektbefehle schlagen** bei Kollisionen.

Codex-Befehlsinhalte werden mit Frontmatter-Entfernung (`parseFrontmatter`) geparst, und der Befehlsname kann durch Frontmatter `name` überschrieben werden; andernfalls wird der Dateiname verwendet.

## `claude-plugins`-Provider (`claude-plugins.ts`)

Lädt Plugin-Befehlsursprünge aus `~/.claude/plugins/installed_plugins.json` und scannt dann `<pluginRoot>/commands/*.md`.

Die Reihenfolge folgt der Registry-Iterationsreihenfolge und der Pro-Plugin-Eintragsreihenfolge aus diesen JSON-Daten. Es gibt keinen zusätzlichen Sortierschritt.

## 3) Materialisierung zu Runtime-`FileSlashCommand`

`loadSlashCommands()` in `src/extensibility/slash-commands.ts` konvertiert Capability-Elemente in `FileSlashCommand`-Objekte, die zur Prompt-Zeit verwendet werden.

Für jeden Befehl:

1. Frontmatter/Body parsen (`parseFrontmatter`)
2. Beschreibungsquelle:
   - `frontmatter.description` falls vorhanden
   - andernfalls erste nicht-leere Body-Zeile (getrimmt, max. 60 Zeichen mit `...`)
3. Geparsten Body als ausführbaren Template-Inhalt beibehalten
4. Einen Anzeige-Quellstring berechnen wie `via Claude Code Project`

Die Schwere des Frontmatter-Parsens ist quellenabhängig:

- `native`-Level -> Parse-Fehler sind `fatal`
- `user`/`project`-Level -> Parse-Fehler sind `warn` mit Fallback-Parsing

### Mitgelieferte Fallback-Befehle

Nach Dateisystem-/Provider-Befehlen werden eingebettete Befehlsvorlagen (`EMBEDDED_COMMAND_TEMPLATES`) angehängt, wenn ihre Namen noch nicht vorhanden sind.

Das aktuelle eingebettete Set stammt aus `src/task/commands.ts` und wird als Fallback verwendet (`source: "bundled"`).

## 4) Interaktiver Modus: Woher Befehlslisten stammen

Der interaktive Modus kombiniert mehrere Befehlsquellen für Autovervollständigung und Befehlsrouting.

Zur Konstruktionszeit wird eine ausstehende Befehlsliste erstellt aus:

- Built-ins (`BUILTIN_SLASH_COMMANDS`, beinhaltet Argument-Vervollständigung und Inline-Hinweise für ausgewählte Befehle)
- Von Extensions registrierte Slash-Befehle (`extensionRunner.getRegisteredCommands(...)`)
- TypeScript-Custom-Commands (`session.customCommands`), auf Slash-Command-Labels abgebildet
- Optionale Skill-Befehle (`/skill:<name>`) wenn `skills.enableSkillCommands` aktiviert ist

Dann ruft `init()` `refreshSlashCommandState(...)` auf, um dateibasierte Befehle zu laden und einen `CombinedAutocompleteProvider` zu installieren, der enthält:

- Ausstehende Befehle von oben
- Entdeckte dateibasierte Befehle

`refreshSlashCommandState(...)` aktualisiert auch `session.setSlashCommands(...)`, sodass die Prompt-Expansion dasselbe entdeckte Datei-Befehlsset verwendet.

### Aktualisierungs-Lebenszyklus

Der Slash-Command-Zustand wird aktualisiert:

- Während der interaktiven Initialisierung
- Nachdem `/move` das Arbeitsverzeichnis ändert (`handleMoveCommand` ruft `resetCapabilities()` und dann `refreshSlashCommandState(newCwd)` auf)

Es gibt keinen kontinuierlichen Datei-Watcher für Befehlsverzeichnisse.

### Weitere Darstellung

Das Extensions-Dashboard lädt ebenfalls die `slash-commands`-Capability und zeigt aktive/verdeckte Befehlseinträge an, einschließlich `_shadowed`-Duplikaten.

## 5) Platzierung in der Prompt-Pipeline

`AgentSession.prompt(...)` Slash-Verarbeitungsreihenfolge (wenn `expandPromptTemplates !== false`):

1. **Extension-Befehle** (`#tryExecuteExtensionCommand`)  
   Wenn `/name` einem von einer Extension registrierten Befehl entspricht, wird der Handler sofort ausgeführt und der Prompt kehrt zurück.
2. **TypeScript-Custom-Commands** (`#tryExecuteCustomCommand`)  
   Nur Grenzfall: Wenn übereinstimmend, wird er ausgeführt und kann zurückgeben:
   - `string` -> Prompt-Text durch diesen String ersetzen
   - `void/undefined` -> wird als behandelt betrachtet; kein LLM-Prompt
3. **Dateibasierte Slash-Befehle** (`expandSlashCommand`)  
   Wenn der Text noch mit `/` beginnt, wird eine Markdown-Befehlsexpansion versucht.
4. **Prompt-Templates** (`expandPromptTemplate`)  
   Werden nach der Slash-/Custom-Verarbeitung angewendet.
5. **Zustellung**
   - Leerlauf: Prompt wird sofort an den Agenten gesendet
   - Streaming: Prompt wird als Steer/Follow-up eingereiht, abhängig von `streamingBehavior`

Deshalb steht die Slash-Command-Expansion vor der Prompt-Template-Expansion, und deshalb können Custom-Commands den führenden Slash entfernen, bevor der Datei-Befehlsabgleich stattfindet.

## 6) Expansions-Semantik für dateibasierte Slash-Befehle

`expandSlashCommand(text, fileCommands)` Verhalten:

- Wird nur ausgeführt, wenn der Text mit `/` beginnt
- Parst den Befehlsnamen aus dem ersten Token nach `/`
- Parst Argumente aus dem verbleibenden Text via `parseCommandArgs`
- Findet eine exakte Namensübereinstimmung in den geladenen `fileCommands`
- Bei Übereinstimmung wird angewendet:
  - Positionelle Ersetzung: `$1`, `$2`, ...
  - Aggregierte Ersetzung: `$ARGUMENTS` und `$@`
  - Dann Template-Rendering via `prompt.render` mit `{ args, ARGUMENTS, arguments }`
- Bei keiner Übereinstimmung wird der ursprüngliche Text unverändert zurückgegeben

### `parseCommandArgs`-Hinweise

Der Parser ist ein einfaches Quote-bewusstes Splitting:

- Unterstützt `'einfache'` und `"doppelte"` Quotierung zum Beibehalten von Leerzeichen
- Entfernt Quote-Begrenzer
- Implementiert keine Backslash-Escaping-Regeln
- Ein ungeschlossenes Quote ist kein Fehler; der Parser konsumiert bis zum Ende

## 7) Verhalten bei unbekanntem `/...`

Unbekannte Slash-Eingaben werden **nicht abgelehnt** durch die zentrale Slash-Logik.

Wenn ein Befehl nicht durch Extension-/Custom-/Datei-Ebenen behandelt wird, gibt `expandSlashCommand` den ursprünglichen Text zurück, und der wörtliche `/...`-Prompt durchläuft die normale Prompt-Template-Expansion und LLM-Zustellung.

Der interaktive Modus behandelt separat viele Built-ins direkt im `InputController` (zum Beispiel `/settings`, `/model`, `/mcp`, `/move`, `/exit`). Diese werden konsumiert, bevor `session.prompt(...)` erreicht wird, und gelangen daher in diesem Pfad nie zur Datei-Befehlsexpansion.

## 8) Unterschiede zur Streaming-Zeit vs. Leerlauf

## Leerlauf-Pfad

- `session.prompt("/x ...")` durchläuft die Befehls-Pipeline und führt den Befehl entweder sofort aus oder sendet den expandierten Text direkt.

## Streaming-Pfad (`session.isStreaming === true`)

- `prompt(...)` führt weiterhin zuerst Extension-/Custom-/Datei-/Template-Transformationen durch
- Erfordert dann `streamingBehavior`:
  - `"steer"` -> Interrupt-Nachricht einreihen (`agent.steer`)
  - `"followUp"` -> Post-Turn-Nachricht einreihen (`agent.followUp`)
- Wenn `streamingBehavior` weggelassen wird, wirft der Prompt einen Fehler

### Wichtiges befehls-spezifisches Streaming-Verhalten

- Extension-Befehle werden auch während des Streamings sofort ausgeführt (nicht als Text eingereiht).
- Die Hilfsmethoden `steer(...)`/`followUp(...)` lehnen Extension-Befehle ab (`#throwIfExtensionCommand`), um zu vermeiden, dass Befehlstext für Handler eingereiht wird, die synchron ausgeführt werden müssen.
- Die Compaction-Queue-Wiedergabe verwendet `isKnownSlashCommand(...)`, um zu entscheiden, ob eingestellte Einträge via `session.prompt(...)` wiedergegeben werden sollen (für bekannte Slash-Befehle) vs. rohe Steer-/Follow-up-Methoden.

## 9) Fehlerbehandlung und Fehleroberflächen

- Provider-Ladefehler sind isoliert; die Registry sammelt Warnungen und fährt mit anderen Providern fort.
- Ungültige Slash-Command-Elemente (fehlender Name/Pfad/Inhalt oder ungültiges Level) werden durch Capability-Validierung verworfen.
- Frontmatter-Parse-Fehler:
  - Native-Befehle: Fataler Parse-Fehler wird weitergereicht
  - Nicht-native Befehle: Warnung + Fallback-Key/Value-Parse
- Extension-/Custom-Command-Handler-Exceptions werden abgefangen und über den Extension-Fehlerkanal gemeldet (oder Logger-Fallback für Custom-Commands ohne Extension-Runner) und als behandelt betrachtet (keine unbeabsichtigte Fallback-Ausführung).
