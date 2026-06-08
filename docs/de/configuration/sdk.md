---
title: SDK
description: >-
  SDK for building custom agents and integrations on top of the xcsh coding
  agent runtime.
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

Das SDK ist die In-Process-Integrationsschnittstelle für `@f5xc-salesdemos/xcsh`.
Verwenden Sie es, wenn Sie direkten Zugriff auf den Agentenstatus, Event-Streaming, Tool-Anbindung und Sitzungssteuerung aus Ihrem eigenen Bun/Node-Prozess benötigen.

Wenn Sie sprachübergreifende/Prozess-Isolation benötigen, verwenden Sie stattdessen den RPC-Modus.

## Installation

```bash
bun add @f5xc-salesdemos/xcsh
```

## Einstiegspunkte

`@f5xc-salesdemos/xcsh` exportiert die SDK-APIs vom Paket-Root (und auch über `@f5xc-salesdemos/xcsh/sdk`).

Kern-Exports für Embedder:

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- Discovery-Hilfsfunktionen (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- Tool-Factory-Oberfläche (`createTools`, `BUILTIN_TOOLS`, Tool-Klassen)

## Schnellstart (Auto-Discovery-Standardwerte)

```ts
import { createAgentSession } from "@f5xc-salesdemos/xcsh";

const { session, modelFallbackMessage } = await createAgentSession();

if (modelFallbackMessage) {
 process.stderr.write(`${modelFallbackMessage}\n`);
}

const unsubscribe = session.subscribe(event => {
 if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
  process.stdout.write(event.assistantMessageEvent.delta);
 }
});

await session.prompt("Summarize this repository in 3 bullets.");
unsubscribe();
await session.dispose();
```

## Was `createAgentSession()` standardmäßig erkennt

`createAgentSession()` folgt dem Prinzip "Angeben zum Überschreiben, Weglassen zum Erkennen".

Wenn nicht angegeben, werden folgende Werte aufgelöst:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent` (über `getAgentDir()`)
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)` (dateibasiert)
- Skills/Kontextdateien/Prompt-Vorlagen/Slash-Befehle/Erweiterungen/benutzerdefinierte TS-Befehle
- Integrierte Tools über `createTools(...)`
- MCP-Tools (standardmäßig aktiviert)
- LSP-Integration (standardmäßig aktiviert)

### Erforderliche vs. optionale Eingaben

Typischerweise müssen Sie nur angeben, was Sie kontrollieren möchten:

- **Muss angegeben werden**: nichts für eine minimale Sitzung
- **Wird üblicherweise explizit angegeben** in Embeddern:
    - `sessionManager` (wenn Sie In-Memory oder einen benutzerdefinierten Speicherort benötigen)
    - `authStorage` + `modelRegistry` (wenn Sie den Anmeldedaten-/Modell-Lebenszyklus selbst verwalten)
    - `model` oder `modelPattern` (wenn deterministische Modellauswahl wichtig ist)
    - `settings` (wenn Sie eine isolierte/Test-Konfiguration benötigen)

## Sitzungsmanager-Verhalten (persistent vs. In-Memory)

`AgentSession` verwendet immer einen `SessionManager`; das Verhalten hängt davon ab, welche Factory Sie verwenden.

### Dateibasiert (Standard)

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absoluter .jsonl-Pfad
```

- Persistiert Konversation/Nachrichten/Zustandsdeltas in Sitzungsdateien.
- Unterstützt Workflows zum Fortsetzen/Öffnen/Auflisten/Forken.
- `session.sessionFile` ist definiert.

### In-Memory

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- Keine Dateisystem-Persistenz.
- Nützlich für Tests, ephemere Worker, anfragespezifische Agenten.
- Sitzungsmethoden funktionieren weiterhin, aber persistenzspezifische Verhaltensweisen (Datei-Fortsetzung/Fork-Pfade) sind naturgemäß eingeschränkt.

### Hilfsfunktionen zum Fortsetzen/Öffnen/Auflisten

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## Modell- und Authentifizierungs-Anbindung

`createAgentSession()` verwendet `ModelRegistry` + `AuthStorage` für die Modellauswahl und API-Schlüssel-Auflösung.

### Explizite Anbindung

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
} from "@f5xc-salesdemos/xcsh";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const available = modelRegistry.getAvailable();
if (available.length === 0) throw new Error("No authenticated models available");

const { session } = await createAgentSession({
 authStorage,
 modelRegistry,
 model: available[0],
 thinkingLevel: "medium",
 sessionManager: SessionManager.inMemory(),
});
```

### Auswahlreihenfolge wenn `model` nicht angegeben wird

Wenn kein explizites `model`/`modelPattern` angegeben wird:

1. Modell aus bestehender Sitzung wiederherstellen (wenn wiederherstellbar + Schlüssel verfügbar)
2. Standard-Modellrolle aus den Einstellungen (`default`)
3. Erstes verfügbares Modell mit gültiger Authentifizierung

Wenn die Wiederherstellung fehlschlägt, erklärt `modelFallbackMessage` den Fallback.

### Authentifizierungs-Priorität

`AuthStorage.getApiKey(...)` löst in folgender Reihenfolge auf:

1. Laufzeit-Override (`setRuntimeApiKey`)
2. Gespeicherte Anmeldedaten in `agent.db`
3. Umgebungsvariablen des Anbieters
4. Fallback des benutzerdefinierten Anbieter-Resolvers (wenn konfiguriert)

## Event-Abonnement-Modell

Abonnieren Sie mit `session.subscribe(listener)`; es gibt eine Abmeldefunktion zurück.

```ts
const unsubscribe = session.subscribe(event => {
 switch (event.type) {
  case "agent_start":
  case "turn_start":
  case "tool_execution_start":
   break;
  case "message_update":
   if (event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
   }
   break;
 }
});
```

`AgentSessionEvent` umfasst das Kern-`AgentEvent` plus Sitzungsebenen-Events:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## Prompt-Lebenszyklus

`session.prompt(text, options?)` ist der primäre Einstiegspunkt.

Verhalten:

1. Optionale Befehls-/Vorlagen-Expansion (`/`-Befehle, benutzerdefinierte Befehle, Datei-Slash-Befehle, Prompt-Vorlagen)
2. Wenn aktuell gestreamt wird:
    - Erfordert `streamingBehavior: "steer" | "followUp"`
    - Reiht ein, anstatt Arbeit zu verwerfen
3. Wenn im Leerlauf:
    - Validiert Modell + API-Schlüssel
    - Hängt Benutzernachricht an
    - Startet Agenten-Runde

Verwandte APIs:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## Tools und Erweiterungs-Integration

### Integrierte Tools und Filterung

- Integrierte Tools stammen von `createTools(...)` und `BUILTIN_TOOLS`.
- `toolNames` fungiert als Positivliste für integrierte Tools.
- `customTools` und von Erweiterungen registrierte Tools sind weiterhin enthalten.
- Versteckte Tools (zum Beispiel `submit_result`) sind Opt-in, sofern nicht durch Optionen erforderlich.

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### Erweiterungen

- `extensions`: Inline `ExtensionFactory[]`
- `additionalExtensionPaths`: Zusätzliche Erweiterungsdateien laden
- `disableExtensionDiscovery`: Automatisches Erweiterungs-Scanning deaktivieren
- `preloadedExtensions`: Bereits geladene Erweiterungssammlung wiederverwenden

### Laufzeit-Tool-Änderungen

`AgentSession` unterstützt Aktualisierungen der Laufzeit-Aktivierung:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

Der System-Prompt wird neu erstellt, um aktive Tool-Änderungen widerzuspiegeln.

## Discovery-Hilfsfunktionen

Verwenden Sie diese, wenn Sie teilweise Kontrolle möchten, ohne die interne Discovery-Logik nachzubauen:

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## Subagent-orientierte Optionen

Für SDK-Konsumenten, die Orchestratoren bauen (ähnlich dem Task-Executor-Flow):

- `outputSchema`: Übergibt eine strukturierte Ausgabe-Erwartung in den Tool-Kontext
- `requireSubmitResultTool`: Erzwingt die Einbindung des `submit_result`-Tools
- `taskDepth`: Rekursionstiefe-Kontext für verschachtelte Task-Sitzungen
- `parentTaskPrefix`: Artefakt-Benennungspräfix für verschachtelte Task-Ausgaben

Diese sind optional für normale Einzel-Agenten-Einbettung.

## `createAgentSession()` Rückgabewert

```ts
type CreateAgentSessionResult = {
 session: AgentSession;
 extensionsResult: LoadExtensionsResult;
 setToolUIContext: (uiContext: ExtensionUIContext, hasUI: boolean) => void;
 mcpManager?: MCPManager;
 modelFallbackMessage?: string;
 lspServers?: Array<{ name: string; status: "ready" | "error"; fileTypes: string[]; error?: string }>;
};
```

Verwenden Sie `setToolUIContext(...)` nur, wenn Ihr Embedder UI-Fähigkeiten bereitstellt, die von Tools/Erweiterungen aufgerufen werden sollen.

## Minimales kontrolliertes Einbettungsbeispiel

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
 Settings,
} from "@f5xc-salesdemos/xcsh";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const settings = Settings.isolated({
 "compaction.enabled": true,
 "retry.enabled": true,
});

const { session } = await createAgentSession({
 authStorage,
 modelRegistry,
 settings,
 sessionManager: SessionManager.inMemory(),
 toolNames: ["read", "grep", "find", "edit", "write"],
 enableMCP: false,
 enableLsp: true,
});

session.subscribe(event => {
 if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
  process.stdout.write(event.assistantMessageEvent.delta);
 }
});

await session.prompt("Find all TODO comments in this repo and propose fixes.");
await session.dispose();
```
