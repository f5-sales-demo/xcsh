---
title: SDK
description: >-
  SDK zum Erstellen benutzerdefinierter Agenten und Integrationen auf Basis der
  xcsh Coding-Agent-Laufzeitumgebung.
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

Das SDK ist die prozessinterne Integrationsschnittstelle für `@f5xc-salesdemos/xcsh`.
Verwenden Sie es, wenn Sie direkten Zugriff auf den Agentenstatus, Event-Streaming, Tool-Anbindung und Sitzungssteuerung aus Ihrem eigenen Bun/Node-Prozess benötigen.

Wenn Sie sprachübergreifende/prozessisolierte Kommunikation benötigen, verwenden Sie stattdessen den RPC-Modus.

## Installation

```bash
bun add @f5xc-salesdemos/xcsh
```

## Einstiegspunkte

`@f5xc-salesdemos/xcsh` exportiert die SDK-APIs vom Paket-Root (und auch über `@f5xc-salesdemos/xcsh/sdk`).

Kern-Exports für Einbettende:

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

## Was `createAgentSession()` standardmäßig entdeckt

`createAgentSession()` folgt dem Prinzip "angeben zum Überschreiben, weglassen zum Entdecken".

Wenn weggelassen, werden aufgelöst:

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

Typischerweise müssen Sie nur das bereitstellen, was Sie kontrollieren möchten:

- **Muss bereitgestellt werden**: nichts für eine minimale Sitzung
- **Wird üblicherweise explizit bereitgestellt** bei Einbettungen:
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

console.log(session.sessionFile); // absolute .jsonl path
```

- Persistiert Konversation/Nachrichten/Statusdeltas in Sitzungsdateien.
- Unterstützt Fortsetzen/Öffnen/Auflisten/Verzweigen-Workflows.
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
- Nützlich für Tests, kurzlebige Worker, anfragebezogene Agenten.
- Sitzungsmethoden funktionieren weiterhin, aber persistenzspezifische Verhaltensweisen (Datei-Fortsetzen/Verzweigen-Pfade) sind naturgemäß eingeschränkt.

### Fortsetzen/Öffnen/Auflisten-Hilfsfunktionen

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

### Auswahlreihenfolge wenn `model` weggelassen wird

Wenn kein explizites `model`/`modelPattern` angegeben wird:

1. Modell aus bestehender Sitzung wiederherstellen (wenn wiederherstellbar + Schlüssel verfügbar)
2. Standard-Modellrolle aus den Einstellungen (`default`)
3. Erstes verfügbares Modell mit gültiger Authentifizierung

Wenn die Wiederherstellung fehlschlägt, erklärt `modelFallbackMessage` den Fallback.

### Authentifizierungspriorität

`AuthStorage.getApiKey(...)` löst in dieser Reihenfolge auf:

1. Laufzeit-Override (`setRuntimeApiKey`)
2. Gespeicherte Anmeldedaten in `agent.db`
3. Provider-Umgebungsvariablen
4. Custom-Provider-Resolver-Fallback (wenn konfiguriert)

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

`AgentSessionEvent` umfasst das Kern-`AgentEvent` plus Sitzungs-Level-Events:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## Prompt-Lebenszyklus

`session.prompt(text, options?)` ist der primäre Einstiegspunkt.

Verhalten:

1. Optionale Befehls-/Vorlagen-Expansion (`/`-Befehle, benutzerdefinierte Befehle, Datei-Slash-Befehle, Prompt-Vorlagen)
2. Wenn gerade gestreamt wird:
    - erfordert `streamingBehavior: "steer" | "followUp"`
    - reiht ein, anstatt Arbeit zu verwerfen
3. Wenn im Leerlauf:
    - validiert Modell + API-Schlüssel
    - hängt Benutzernachricht an
    - startet Agenten-Runde

Verwandte APIs:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## Tools und Erweiterungs-Integration

### Integrierte Tools und Filterung

- Integrierte Tools stammen aus `createTools(...)` und `BUILTIN_TOOLS`.
- `toolNames` fungiert als Erlaubnisliste für integrierte Tools.
- `customTools` und erweiterungsregistrierte Tools sind weiterhin enthalten.
- Versteckte Tools (zum Beispiel `submit_result`) sind Opt-in, sofern nicht durch Optionen erforderlich.

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### Erweiterungen

- `extensions`: Inline `ExtensionFactory[]`
- `additionalExtensionPaths`: zusätzliche Erweiterungsdateien laden
- `disableExtensionDiscovery`: automatisches Erweiterungs-Scanning deaktivieren
- `preloadedExtensions`: bereits geladene Erweiterungsmenge wiederverwenden

### Laufzeit-Toolset-Änderungen

`AgentSession` unterstützt Laufzeit-Aktivierungsaktualisierungen:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

Der System-Prompt wird neu erstellt, um aktive Tool-Änderungen widerzuspiegeln.

## Discovery-Hilfsfunktionen

Verwenden Sie diese, wenn Sie partielle Kontrolle wünschen, ohne die interne Discovery-Logik neu zu erstellen:

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

Für SDK-Konsumenten, die Orchestratoren erstellen (ähnlich dem Task-Executor-Ablauf):

- `outputSchema`: übergibt die strukturierte Ausgabeerwartung in den Tool-Kontext
- `requireSubmitResultTool`: erzwingt die Einbeziehung des `submit_result`-Tools
- `taskDepth`: Rekursionstiefe-Kontext für verschachtelte Task-Sitzungen
- `parentTaskPrefix`: Artefakt-Benennungspräfix für verschachtelte Task-Ausgaben

Diese sind optional für normale Einzelagenten-Einbettung.

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

Verwenden Sie `setToolUIContext(...)` nur, wenn Ihre Einbettung UI-Fähigkeiten bereitstellt, die Tools/Erweiterungen aufrufen sollen.

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
