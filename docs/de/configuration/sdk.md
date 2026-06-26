---
title: SDK
description: >-
  SDK zur Entwicklung benutzerdefinierter Agenten und Integrationen auf Basis
  der xcsh-Coding-Agent-Laufzeitumgebung.
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 80f3a4374241
  translator: machine
---

# SDK

Das SDK ist die prozessinterne Integrationsoberfläche für `@f5-sales-demo/xcsh`.
Verwenden Sie es, wenn Sie direkten Zugriff auf den Agentenzustand, Event-Streaming, Tool-Verkabelung und Sitzungssteuerung aus Ihrem eigenen Bun/Node-Prozess benötigen.

Wenn Sie sprachübergreifende/prozessisolierte Kommunikation benötigen, verwenden Sie stattdessen den RPC-Modus.

## Installation

```bash
bun add @f5-sales-demo/xcsh
```

## Einstiegspunkte

`@f5-sales-demo/xcsh` exportiert die SDK-APIs aus dem Paketstamm (sowie über `@f5-sales-demo/xcsh/sdk`).

Kernexporte für Einbetter:

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- Discovery-Hilfsfunktionen (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- Werkzeug-Factory-Oberfläche (`createTools`, `BUILTIN_TOOLS`, Werkzeugklassen)

## Schnellstart (automatische Discovery-Standardeinstellungen)

```ts
import { createAgentSession } from "@f5-sales-demo/xcsh";

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

`createAgentSession()` folgt dem Prinzip „Bereitstellen zum Überschreiben, Weglassen zum Entdecken".

Wenn weggelassen, wird Folgendes aufgelöst:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent` (via `getAgentDir()`)
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)` (dateibasiert)
- Fähigkeiten/Kontextdateien/Prompt-Vorlagen/Slash-Befehle/Erweiterungen/benutzerdefinierte TS-Befehle
- Eingebaute Werkzeuge via `createTools(...)`
- MCP-Werkzeuge (standardmäßig aktiviert)
- LSP-Integration (standardmäßig aktiviert)

### Erforderliche vs. optionale Eingaben

Normalerweise müssen Sie nur angeben, was Sie steuern möchten:

- **Muss bereitgestellt werden**: nichts für eine minimale Sitzung
- **Wird in Einbettern üblicherweise explizit angegeben**:
    - `sessionManager` (wenn Sie In-Memory oder einen benutzerdefinierten Speicherort benötigen)
    - `authStorage` + `modelRegistry` (wenn Sie den Lebenszyklus von Anmeldeinformationen/Modellen selbst verwalten)
    - `model` oder `modelPattern` (wenn eine deterministische Modellauswahl wichtig ist)
    - `settings` (wenn Sie isolierte/Test-Konfiguration benötigen)

## Sitzungsmanager-Verhalten (persistent vs. In-Memory)

`AgentSession` verwendet immer einen `SessionManager`; das Verhalten hängt davon ab, welche Factory Sie verwenden.

### Dateibasiert (Standard)

```ts
import { createAgentSession, SessionManager } from "@f5-sales-demo/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absoluter .jsonl-Pfad
```

- Persistiert Konversations-/Nachrichten-/Zustandsdeltas in Sitzungsdateien.
- Unterstützt Fortsetzen/Öffnen/Auflisten/Fork-Workflows.
- `session.sessionFile` ist definiert.

### In-Memory

```ts
import { createAgentSession, SessionManager } from "@f5-sales-demo/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- Keine Dateisystempersistenz.
- Nützlich für Tests, kurzlebige Worker, anfragegültige Agenten.
- Sitzungsmethoden funktionieren weiterhin, persistenzspezifische Verhaltensweisen (Datei-Fortsetzung/Fork-Pfade) sind jedoch naturgemäß eingeschränkt.

### Hilfsfunktionen zum Fortsetzen/Öffnen/Auflisten

```ts
import { SessionManager } from "@f5-sales-demo/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## Modell- und Authentifizierungsverkabelung

`createAgentSession()` verwendet `ModelRegistry` + `AuthStorage` für die Modellauswahl und API-Schlüsselauflösung.

### Explizite Verkabelung

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
} from "@f5-sales-demo/xcsh";

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

### Auswahlreihenfolge bei weggelassenem `model`

Wenn kein explizites `model`/`modelPattern` angegeben ist:

1. Modell aus bestehender Sitzung wiederherstellen (falls wiederherstellbar + Schlüssel verfügbar)
2. Standard-Modellrolle aus den Einstellungen (`default`)
3. Erstes verfügbares Modell mit gültiger Authentifizierung

Falls die Wiederherstellung fehlschlägt, erklärt `modelFallbackMessage` den Fallback.

### Authentifizierungspriorität

`AuthStorage.getApiKey(...)` löst in dieser Reihenfolge auf:

1. Laufzeit-Override (`setRuntimeApiKey`)
2. Gespeicherte Anmeldeinformationen in `agent.db`
3. Provider-Umgebungsvariablen
4. Benutzerdefinierter Provider-Resolver-Fallback (falls konfiguriert)

## Event-Abonnementmodell

Abonnieren Sie mit `session.subscribe(listener)`; es wird eine Abmelde-Funktion zurückgegeben.

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

`AgentSessionEvent` umfasst kern-`AgentEvent`s sowie sitzungsebene-Events:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## Prompt-Lebenszyklus

`session.prompt(text, options?)` ist der primäre Einstiegspunkt.

Verhalten:

1. Optionale Befehls-/Vorlagenexpansion (`/`-Befehle, benutzerdefinierte Befehle, Datei-Slash-Befehle, Prompt-Vorlagen)
2. Wenn gerade gestreamt wird:
    - erfordert `streamingBehavior: "steer" | "followUp"`
    - wird in die Warteschlange gestellt, anstatt die Arbeit zu verwerfen
3. Wenn inaktiv:
    - validiert Modell + API-Schlüssel
    - fügt Benutzernachricht an
    - startet Agenten-Turn

Verwandte APIs:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## Werkzeuge und Erweiterungsintegration

### Eingebaute Werkzeuge und Filterung

- Eingebaute Werkzeuge stammen aus `createTools(...)` und `BUILTIN_TOOLS`.
- `toolNames` fungiert als Zulassungsliste für eingebaute Werkzeuge.
- `customTools` und erweiterungsregistrierte Werkzeuge sind weiterhin enthalten.
- Versteckte Werkzeuge (zum Beispiel `submit_result`) sind standardmäßig deaktiviert, sofern sie nicht durch Optionen erforderlich sind.

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### Erweiterungen

- `extensions`: Inline-`ExtensionFactory[]`
- `additionalExtensionPaths`: Zusätzliche Erweiterungsdateien laden
- `disableExtensionDiscovery`: Automatisches Erweiterungsscanning deaktivieren
- `preloadedExtensions`: Bereits geladenen Erweiterungssatz wiederverwenden

### Laufzeit-Werkzeugsatz-Änderungen

`AgentSession` unterstützt Laufzeit-Aktivierungsaktualisierungen:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

Der System-Prompt wird neu erstellt, um aktive Werkzeugänderungen widerzuspiegeln.

## Discovery-Hilfsfunktionen

Verwenden Sie diese, wenn Sie partielle Kontrolle ohne Neuerstellen der internen Discovery-Logik wünschen:

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

Für SDK-Nutzer, die Orchestratoren erstellen (ähnlich dem Aufgaben-Executor-Ablauf):

- `outputSchema`: übergibt strukturierte Ausgabeerwartung an den Werkzeugkontext
- `requireSubmitResultTool`: erzwingt die Einbeziehung des `submit_result`-Werkzeugs
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
} from "@f5-sales-demo/xcsh";

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
