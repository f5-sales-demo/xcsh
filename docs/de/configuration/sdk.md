---
title: SDK
description: >-
  SDK zum Erstellen benutzerdefinierter Agenten und Integrationen auf der Basis
  der xcsh Coding-Agent-Laufzeitumgebung.
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

Das SDK ist die In-Process-Integrationsoberfläche für `@f5xc-salesdemos/xcsh`.
Verwenden Sie es, wenn Sie direkten Zugriff auf den Agentenstatus, Event-Streaming, Tool-Verdrahtung und Sitzungssteuerung aus Ihrem eigenen Bun/Node-Prozess benötigen.

Wenn Sie sprachübergreifende/prozessisolierte Kommunikation benötigen, verwenden Sie stattdessen den RPC-Modus.

## Installation

```bash
bun add @f5xc-salesdemos/xcsh
```

## Einstiegspunkte

`@f5xc-salesdemos/xcsh` exportiert die SDK-APIs aus dem Paket-Root (sowie über `@f5xc-salesdemos/xcsh/sdk`).

Kernexporte für Einbetter:

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- Discovery-Hilfsfunktionen (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- Werkzeug-Factory-Oberfläche (`createTools`, `BUILTIN_TOOLS`, Werkzeugklassen)

## Schnellstart (Standardwerte per automatischer Erkennung)

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

`createAgentSession()` folgt dem Prinzip „Bereitstellen zum Überschreiben, Weglassen zum Erkennen".

Wenn weggelassen, wird Folgendes aufgelöst:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent` (über `getAgentDir()`)
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)` (dateibasiert)
- Skills/Kontextdateien/Prompt-Vorlagen/Slash-Befehle/Erweiterungen/benutzerdefinierte TS-Befehle
- Integrierte Werkzeuge über `createTools(...)`
- MCP-Werkzeuge (standardmäßig aktiviert)
- LSP-Integration (standardmäßig aktiviert)

### Erforderliche vs. optionale Eingaben

In der Regel müssen Sie nur das angeben, was Sie steuern möchten:

- **Muss angegeben werden**: nichts für eine minimale Sitzung
- **Wird in Einbettern üblicherweise explizit angegeben**:
    - `sessionManager` (wenn Sie In-Memory oder einen benutzerdefinierten Speicherort benötigen)
    - `authStorage` + `modelRegistry` (wenn Sie den Credential-/Modell-Lebenszyklus selbst verwalten)
    - `model` oder `modelPattern` (wenn eine deterministische Modellauswahl erforderlich ist)
    - `settings` (wenn Sie eine isolierte/Test-Konfiguration benötigen)

## SessionManager-Verhalten (persistent vs. In-Memory)

`AgentSession` verwendet immer einen `SessionManager`; das Verhalten hängt davon ab, welche Factory Sie verwenden.

### Dateibasiert (Standard)

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absoluter .jsonl-Pfad
```

- Speichert Konversations-/Nachrichten-/Statusdeltas in Sitzungsdateien.
- Unterstützt Fortsetzen/Öffnen/Auflisten/Fork-Workflows.
- `session.sessionFile` ist definiert.

### In-Memory

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- Keine Dateisystempersistenz.
- Nützlich für Tests, kurzlebige Worker und anfragenbezogene Agenten.
- Sitzungsmethoden funktionieren weiterhin, aber persistenzspezifische Verhaltensweisen (Datei-Fortsetzen/Fork-Pfade) sind naturgemäß eingeschränkt.

### Fortsetzen/Öffnen/Auflisten-Hilfsfunktionen

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## Modell- und Auth-Verdrahtung

`createAgentSession()` verwendet `ModelRegistry` + `AuthStorage` für die Modellauswahl und API-Schlüsselauflösung.

### Explizite Verdrahtung

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

### Auswahlreihenfolge, wenn `model` weggelassen wird

Wenn kein explizites `model`/`modelPattern` angegeben wird:

1. Modell aus bestehender Sitzung wiederherstellen (wenn wiederherstellbar + Schlüssel verfügbar)
2. Standardmodellrolle aus den Einstellungen (`default`)
3. Erstes verfügbares Modell mit gültiger Authentifizierung

Wenn die Wiederherstellung fehlschlägt, erklärt `modelFallbackMessage` den Fallback.

### Auth-Priorität

`AuthStorage.getApiKey(...)` löst in dieser Reihenfolge auf:

1. Laufzeit-Override (`setRuntimeApiKey`)
2. Gespeicherte Anmeldeinformationen in `agent.db`
3. Provider-Umgebungsvariablen
4. Benutzerdefinierter Provider-Resolver-Fallback (sofern konfiguriert)

## Event-Abonnementmodell

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

`AgentSessionEvent` enthält den Kern-`AgentEvent` sowie sitzungsbezogene Ereignisse:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## Prompt-Lebenszyklus

`session.prompt(text, options?)` ist der primäre Einstiegspunkt.

Verhalten:

1. Optionale Befehls-/Vorlagenerweiterung (`/`-Befehle, benutzerdefinierte Befehle, Datei-Slash-Befehle, Prompt-Vorlagen)
2. Wenn aktuell gestreamt wird:
    - erfordert `streamingBehavior: "steer" | "followUp"`
    - reiht sich in die Warteschlange ein, anstatt Arbeit zu verwerfen
3. Wenn inaktiv:
    - validiert Modell + API-Schlüssel
    - fügt Benutzernachricht hinzu
    - startet Agenten-Turn

Verwandte APIs:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## Werkzeuge und Erweiterungsintegration

### Integrierte Werkzeuge und Filterung

- Integrierte Werkzeuge stammen aus `createTools(...)` und `BUILTIN_TOOLS`.
- `toolNames` fungiert als Zulassungsliste für integrierte Werkzeuge.
- `customTools` und von Erweiterungen registrierte Werkzeuge sind weiterhin enthalten.
- Versteckte Werkzeuge (zum Beispiel `submit_result`) sind opt-in, sofern sie nicht durch Optionen erforderlich sind.

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### Erweiterungen

- `extensions`: Inline-`ExtensionFactory[]`
- `additionalExtensionPaths`: Zusätzliche Erweiterungsdateien laden
- `disableExtensionDiscovery`: Automatische Erweiterungserkennung deaktivieren
- `preloadedExtensions`: Bereits geladenes Erweiterungsset wiederverwenden

### Laufzeit-Werkzeugmengenwechsel

`AgentSession` unterstützt Laufzeit-Aktivierungsaktualisierungen:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

Der System-Prompt wird neu erstellt, um aktive Werkzeugänderungen widerzuspiegeln.

## Discovery-Hilfsfunktionen

Verwenden Sie diese, wenn Sie teilweise Kontrolle ohne Neuerstellung der internen Discovery-Logik wünschen:

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## Subagenten-orientierte Optionen

Für SDK-Nutzer, die Orchestratoren erstellen (ähnlich dem Task-Executor-Ablauf):

- `outputSchema`: Gibt strukturierte Ausgabeerwartungen an den Werkzeugkontext weiter
- `requireSubmitResultTool`: Erzwingt die Einbindung des `submit_result`-Werkzeugs
- `taskDepth`: Rekursionstiefenkontext für verschachtelte Aufgabensitzungen
- `parentTaskPrefix`: Artefakt-Benennungspräfix für verschachtelte Aufgabenausgaben

Diese sind für normale Einzelagenten-Einbettung optional.

## Rückgabewert von `createAgentSession()`

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

Verwenden Sie `setToolUIContext(...)` nur, wenn Ihr Einbetter UI-Fähigkeiten bereitstellt, in die Werkzeuge/Erweiterungen aufrufen sollen.

## Minimales gesteuertes Einbettungsbeispiel

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
