---
title: Extensions
description: >-
  Extension runtime overview covering types, runner lifecycle, registration, and
  discovery.
sidebar:
  order: 1
  label: Übersicht
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# Extensions

Primärer Leitfaden zur Entwicklung von Laufzeit-Extensions in `packages/coding-agent`.

Dieses Dokument behandelt die aktuelle Extension-Laufzeitumgebung in:

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

Für Discovery-Pfade und Dateisystem-Laderegeln siehe `docs/extension-loading.md`.

## Was eine Extension ist

Eine Extension ist ein TS/JS-Modul, das eine Standard-Factory-Funktion exportiert:

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

Extensions können all folgende Funktionalitäten in einem Modul kombinieren:

- Event-Handler (`pi.on(...)`)
- LLM-aufrufbare Tools (`pi.registerTool(...)`)
- Slash-Befehle (`pi.registerCommand(...)`)
- Tastenkombinationen und Flags
- Benutzerdefiniertes Nachrichten-Rendering
- Session/Nachrichten-Injektions-APIs (`sendMessage`, `sendUserMessage`, `appendEntry`)

## Laufzeitmodell

1. Extensions werden importiert und ihre Factory-Funktionen ausgeführt.
2. Während dieser Ladephase sind Registrierungsmethoden gültig; Laufzeit-Aktionsmethoden sind noch nicht initialisiert.
3. `ExtensionRunner.initialize(...)` verbindet Live-Aktionen/Kontexte für den aktiven Modus.
4. Session/Agent/Tool-Lebenszyklus-Events werden an Handler emittiert.
5. Jede Tool-Ausführung wird mit Extension-Interception umschlossen (`tool_call` / `tool_result`).

```text
Extension lifecycle (simplified)

load paths
   │
   ▼
import module + run factory (registration only)
   │
   ▼
ExtensionRunner.initialize(mode/session/tool registry)
   │
   ├─ emit session/agent events to handlers
   ├─ wrap tool execution (tool_call/tool_result)
   └─ expose runtime actions (sendMessage, setActiveTools, ...)
```

Wichtige Einschränkung aus `loader.ts`:

- Der Aufruf von Aktionsmethoden wie `pi.sendMessage()` während des Extension-Ladens löst `ExtensionRuntimeNotInitializedError` aus
- Zuerst registrieren; Laufzeitverhalten über Events/Befehle/Tools ausführen

## Schnellstart

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
 pi.setLabel("Safety + Utilities");

 pi.on("session_start", async (_event, ctx) => {
  ctx.ui.notify(`Extension loaded in ${ctx.cwd}`, "info");
 });

 pi.on("tool_call", async (event) => {
  if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
   return { block: true, reason: "Blocked by extension policy" };
  }
 });

 pi.registerTool({
  name: "hello_extension",
  label: "Hello Extension",
  description: "Return a greeting",
  parameters: Type.Object({ name: Type.String() }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
   return {
    content: [{ type: "text", text: `Hello, ${params.name}` }],
    details: { greeted: params.name },
   };
  },
 });

 pi.registerCommand("hello-ext", {
  description: "Show queue state",
  handler: async (_args, ctx) => {
   ctx.ui.notify(`pending=${ctx.hasPendingMessages()}`, "info");
  },
 });
}
```

## Extension-API-Oberflächen

## 1) Registrierung und Aktionen (`ExtensionAPI`)

Kernmethoden:

- `on(event, handler)`
- `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`
- `registerMessageRenderer`
- `sendMessage`, `sendUserMessage`, `appendEntry`
- `getActiveTools`, `getAllTools`, `setActiveTools`
- `getSessionName`, `setSessionName`
- `setModel`, `getThinkingLevel`, `setThinkingLevel`
- `registerProvider`
- `events` (gemeinsamer Event-Bus)

Im interaktiven Modus werden `input`-Handler vor der integrierten Auto-Titel-Prüfung der ersten Nachricht ausgeführt. Extensions, die `await pi.setSessionName(...)` aus `input` aufrufen, können den persistierten Session-Namen setzen und verhindern, dass der standardmäßig automatisch generierte Titel für diese Session ausgeführt wird.

Ebenfalls verfügbar:

- `pi.logger`
- `pi.typebox`
- `pi.pi` (Paket-Exporte)

### Semantik der Nachrichtenzustellung

`pi.sendMessage(message, options)` unterstützt:

- `deliverAs: "steer"` (Standard) — unterbricht den aktuellen Durchlauf
- `deliverAs: "followUp"` — wird in die Warteschlange eingereiht und nach dem aktuellen Durchlauf ausgeführt
- `deliverAs: "nextTurn"` — wird gespeichert und beim nächsten Benutzer-Prompt injiziert
- `triggerTurn: true` — startet einen Turn im Leerlauf (`nextTurn` ignoriert dies)

`pi.sendUserMessage(content, { deliverAs })` durchläuft immer den Prompt-Fluss; während des Streamings wird es als Steer/Follow-Up in die Warteschlange eingereiht.

## 2) Handler-Kontext (`ExtensionContext`)

Handler und Tool-`execute` erhalten `ctx` mit:

- `ui`
- `hasUI`
- `cwd`
- `sessionManager` (nur lesend)
- `modelRegistry`, `model`
- `getContextUsage()`
- `compact(...)`
- `isIdle()`, `hasPendingMessages()`, `abort()`
- `shutdown()`
- `getSystemPrompt()`

## 3) Befehlskontext (`ExtensionCommandContext`)

Befehls-Handler erhalten zusätzlich:

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

Verwenden Sie den Befehlskontext für Session-Steuerungsabläufe; diese Methoden sind bewusst von allgemeinen Event-Handlern getrennt.

## Event-Oberfläche (aktuelle Namen und Verhalten)

Kanonische Event-Unions und Payload-Typen befinden sich in `types.ts`.

### Session-Lebenszyklus

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

Abbrechbare Pre-Events:

- `session_before_switch` → `{ cancel?: boolean }`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`

### Prompt- und Turn-Lebenszyklus

- `input`
- `before_agent_start`
- `context`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`

### Tool-Lebenszyklus

- `tool_call` (vor Ausführung, kann blockieren)
- `tool_result` (nach Ausführung, kann Content/Details/isError patchen)
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` (Observability)

`tool_result` funktioniert im Middleware-Stil: Handler werden in Extension-Reihenfolge ausgeführt und jeder sieht vorherige Änderungen.

### Zuverlässigkeits-/Laufzeitsignale

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### Benutzerbefehl-Interception

- `user_bash` (Überschreibung mit `{ result }`)
- `user_python` (Überschreibung mit `{ result }`)

### `resources_discover`

`resources_discover` existiert in den Extension-Typen und im `ExtensionRunner`.
Aktuelle Laufzeit-Anmerkung: `ExtensionRunner.emitResourcesDiscover(...)` ist implementiert, aber es gibt keine `AgentSession`-Aufrufstellen, die es in der aktuellen Codebasis aufrufen.

## Details zur Tool-Entwicklung

`registerTool` verwendet `ToolDefinition` aus `types.ts`.

Aktuelle `execute`-Signatur:

```ts
execute(
 toolCallId,
 params,
 signal,
 onUpdate,
 ctx,
): Promise<AgentToolResult>
```

Vorlage:

```ts
pi.registerTool({
 name: "my_tool",
 label: "My Tool",
 description: "...",
 parameters: Type.Object({}),
 async execute(_id, _params, signal, onUpdate, ctx) {
  if (signal?.aborted) {
   return { content: [{ type: "text", text: "Cancelled" }] };
  }
  onUpdate?.({ content: [{ type: "text", text: "Working..." }] });
  return { content: [{ type: "text", text: "Done" }], details: {} };
 },
 onSession(event, ctx) {
  // reason: start|switch|branch|tree|shutdown
 },
 renderCall(args, theme) {
  // optional TUI render
 },
 renderResult(result, options, theme, args) {
  // optional TUI render
 },
});
```

`tool_call`/`tool_result` fangen alle Tools ab, sobald die Registry in `sdk.ts` gewrapped ist, einschließlich eingebauter und Extension-/benutzerdefinierter Tools.

## UI-Integrationspunkte

`ctx.ui` implementiert das `ExtensionUIContext`-Interface. Die Unterstützung unterscheidet sich je nach Modus.

### Interaktiver Modus (`extension-ui-controller.ts`)

Unterstützt:

- Dialoge: `select`, `confirm`, `input`, `editor`
- Benachrichtigungen/Status/Editor-Text/Terminal-Eingabe/benutzerdefinierte Overlays
- Theme-Auflistung/-Laden per Name (`setTheme` unterstützt String-Namen)
- Tools-Expanded-Umschalter

Aktuelle No-Op-Methoden in diesem Controller:

- `setFooter`
- `setHeader`
- `setEditorComponent`

Hinweis: `setWidget` leitet derzeit über `setHookWidget(...)` an den Statuszeilen-Text weiter.

### RPC-Modus (`rpc-mode.ts`)

`ctx.ui` wird durch RPC-`extension_ui_request`-Events unterstützt:

- Dialog-Methoden (`select`, `confirm`, `input`, `editor`) machen einen Roundtrip zu Client-Antworten
- Fire-and-Forget-Methoden emittieren Requests (`notify`, `setStatus`, `setWidget` für String-Arrays, `setTitle`, `setEditorText`)

Nicht unterstützt/No-Op in der RPC-Implementierung:

- `onTerminalInput`
- `custom`
- `setFooter`, `setHeader`, `setEditorComponent`
- `setWorkingMessage`
- Theme-Wechsel/-Laden (`setTheme` gibt Fehler zurück)
- Tool-Expansion-Steuerelemente sind inaktiv

### Print/Headless/Subagent-Pfade

Wenn kein UI-Kontext beim Runner-Init bereitgestellt wird, ist `ctx.hasUI` `false` und Methoden sind No-Op/geben Standardwerte zurück.

### Interaktiver Hintergrundmodus

Der Hintergrundmodus installiert ein nicht-interaktives UI-Kontext-Objekt. In der aktuellen Implementierung kann `ctx.hasUI` weiterhin `true` sein, während interaktive Dialoge Standard-/No-Op-Verhalten zurückgeben.

## Session- und Zustandsmuster

Für dauerhaften Extension-Zustand:

1. Persistieren Sie mit `pi.appendEntry(customType, data)`.
2. Rekonstruieren Sie den Zustand aus `ctx.sessionManager.getBranch()` bei `session_start`, `session_branch`, `session_tree`.
3. Halten Sie Tool-Result-`details` strukturiert, wenn der Zustand aus der Tool-Result-Historie sichtbar/rekonstruierbar sein soll.

Beispiel-Rekonstruktionsmuster:

```ts
pi.on("session_start", async (_event, ctx) => {
 let latest;
 for (const entry of ctx.sessionManager.getBranch()) {
  if (entry.type === "custom" && entry.customType === "my-state") {
   latest = entry.data;
  }
 }
 // restore from latest
});
```

## Rendering-Erweiterungspunkte

## Benutzerdefinierter Nachrichten-Renderer

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // return pi-tui Component
});
```

Wird vom interaktiven Rendering verwendet, wenn benutzerdefinierte Nachrichten angezeigt werden.

## Tool-Call/Result-Renderer

Stellen Sie `renderCall` / `renderResult` in `registerTool`-Definitionen bereit, um benutzerdefinierte Tool-Visualisierung im TUI zu ermöglichen.

## Einschränkungen und Fallstricke

- Laufzeit-Aktionen sind während des Extension-Ladens nicht verfügbar.
- `tool_call`-Fehler blockieren die Ausführung (Fail-Closed).
- Befehlsnamenskonflikte mit eingebauten Befehlen werden mit Diagnosen übersprungen.
- Reservierte Tastenkombinationen werden ignoriert (`ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`).
- Behandeln Sie `ctx.reload()` als terminierend für den aktuellen Befehls-Handler-Frame.

## Extensions vs. Hooks vs. Custom-Tools

Verwenden Sie die richtige Oberfläche:

- **Extensions** (`src/extensibility/extensions/*`): Einheitliches System (Events + Tools + Befehle + Renderer + Provider-Registrierung).
- **Hooks** (`src/extensibility/hooks/*`): Separate Legacy-Event-API.
- **Custom-Tools** (`src/extensibility/custom-tools/*`): Tool-fokussierte Module; wenn sie neben Extensions geladen werden, werden sie adaptiert und durchlaufen weiterhin Extension-Interception-Wrapper.

Wenn Sie ein Paket benötigen, das Policy, Tools, Befehls-UX und Rendering zusammen verwaltet, verwenden Sie Extensions.
