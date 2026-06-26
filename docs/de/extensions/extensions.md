---
title: Erweiterungen
description: >-
  Übersicht über die Erweiterungs-Laufzeitumgebung mit Typen,
  Runner-Lebenszyklus, Registrierung und Erkennung.
sidebar:
  order: 1
  label: Übersicht
i18n:
  sourceHash: 14cc16dbd98b
  translator: machine
---

# Erweiterungen

Primärer Leitfaden zur Erstellung von Laufzeiterweiterungen in `packages/coding-agent`.

Dieses Dokument behandelt die aktuelle Erweiterungs-Laufzeitumgebung in:

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

Informationen zu Erkennungspfaden und Regeln zum Laden aus dem Dateisystem finden Sie unter `docs/extension-loading.md`.

## Was eine Erweiterung ist

Eine Erweiterung ist ein TS/JS-Modul, das eine Standard-Factory exportiert:

```ts
import type { ExtensionAPI } from "@f5-sales-demo/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

Erweiterungen können alle der folgenden Elemente in einem Modul kombinieren:

- Ereignis-Handler (`pi.on(...)`)
- LLM-aufrufbare Werkzeuge (`pi.registerTool(...)`)
- Slash-Befehle (`pi.registerCommand(...)`)
- Tastatürkürzel und Flags
- Benutzerdefiniertes Nachrichten-Rendering
- Sitzungs-/Nachrichten-Injektions-APIs (`sendMessage`, `sendUserMessage`, `appendEntry`)

## Laufzeitmodell

1. Erweiterungen werden importiert und ihre Factory-Funktionen ausgeführt.
2. Während dieser Ladephase sind Registrierungsmethoden gültig; Laufzeit-Aktionsmethoden sind noch nicht initialisiert.
3. `ExtensionRunner.initialize(...)` verdrahtet Live-Aktionen/Kontexte für den aktiven Modus.
4. Sitzungs-/Agenten-/Werkzeug-Lebenszyklus-Ereignisse werden an Handler ausgegeben.
5. Jede Werkzeugausführung wird mit Erweiterungsabfang umhüllt (`tool_call` / `tool_result`).

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

- Der Aufruf von Aktionsmethoden wie `pi.sendMessage()` während des Ladens der Erweiterung löst `ExtensionRuntimeNotInitializedError` aus
- Zuerst registrieren; Laufzeitverhalten aus Ereignissen/Befehlen/Werkzeugen ausführen

## Schnellstart

```ts
import type { ExtensionAPI } from "@f5-sales-demo/xcsh";
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

## API-Oberflächen der Erweiterung

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
- `events` (gemeinsamer Ereignisbus)

Im interaktiven Modus werden `input`-Handler vor der integrierten Prüfung auf automatischen Titel der ersten Nachricht ausgeführt. Erweiterungen, die `await pi.setSessionName(...)` aus `input` aufrufen, können den dauerhaft gespeicherten Sitzungsnamen festlegen und verhindern, dass der automatisch generierte Standardtitel für diese Sitzung ausgeführt wird.

Ebenfalls verfügbar:

- `pi.logger`
- `pi.typebox`
- `pi.pi` (Paketexporte)

### Semantik der Nachrichtenübermittlung

`pi.sendMessage(message, options)` unterstützt:

- `deliverAs: "steer"` (Standard) — unterbricht den aktuellen Durchlauf
- `deliverAs: "followUp"` — in die Warteschlange eingereiht, um nach dem aktuellen Durchlauf ausgeführt zu werden
- `deliverAs: "nextTurn"` — gespeichert und beim nächsten Benutzer-Prompt injiziert
- `triggerTurn: true` — startet einen Durchlauf im Leerlauf (`nextTurn` ignoriert dies)

`pi.sendUserMessage(content, { deliverAs })` durchläuft immer den Prompt-Ablauf; während des Streamings wird es als Steer/Follow-up in die Warteschlange eingereiht.

## 2) Handler-Kontext (`ExtensionContext`)

Handler und Werkzeug-`execute` erhalten `ctx` mit:

- `ui`
- `hasUI`
- `cwd`
- `sessionManager` (schreibgeschützt)
- `modelRegistry`, `model`
- `getContextUsage()`
- `compact(...)`
- `isIdle()`, `hasPendingMessages()`, `abort()`
- `shutdown()`
- `getSystemPrompt()`

## 3) Befehlskontext (`ExtensionCommandContext`)

Befehlshandler erhalten zusätzlich:

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

Verwenden Sie den Befehlskontext für sitzungsgesteuerte Abläufe; diese Methoden sind absichtlich von allgemeinen Ereignis-Handlern getrennt.

## Ereignis-Oberfläche (aktuelle Namen und Verhalten)

Kanonische Ereignis-Unions und Payload-Typen befinden sich in `types.ts`.

### Sitzungslebenszyklus

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

Abbrechbare Vor-Ereignisse:

- `session_before_switch` → `{ cancel?: boolean }`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`

### Prompt- und Durchlauf-Lebenszyklus

- `input`
- `before_agent_start`
- `context`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`

### Werkzeug-Lebenszyklus

- `tool_call` (vor der Ausführung, kann blockieren)
- `tool_result` (nach der Ausführung, kann Inhalt/Details/isError patchen)
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` (Beobachtbarkeit)

`tool_result` ist middleware-artig: Handler werden in Erweiterungsreihenfolge ausgeführt und jeder sieht vorherige Änderungen.

### Zuverlässigkeits-/Laufzeitsignale

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### Abfangen von Benutzerbefehlen

- `user_bash` (überschreiben mit `{ result }`)
- `user_python` (überschreiben mit `{ result }`)

### `resources_discover`

`resources_discover` existiert in Erweiterungstypen und `ExtensionRunner`.
Aktueller Laufzeithinweis: `ExtensionRunner.emitResourcesDiscover(...)` ist implementiert, aber es gibt keine `AgentSession`-Aufrufstellen, die es in der aktuellen Codebasis aufrufen.

## Details zur Werkzeugentwicklung

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

`tool_call`/`tool_result` fangen alle Werkzeuge ab, sobald die Registry in `sdk.ts` umhüllt ist, einschließlich integrierter und erweiterungs-/benutzerdefinierter Werkzeuge.

## UI-Integrationspunkte

`ctx.ui` implementiert das `ExtensionUIContext`-Interface. Die Unterstützung unterscheidet sich je nach Modus.

### Interaktiver Modus (`extension-ui-controller.ts`)

Unterstützt:

- Dialoge: `select`, `confirm`, `input`, `editor`
- Benachrichtigungen/Status/Editor-Text/Terminal-Eingabe/benutzerdefinierte Overlays
- Auflistung/Laden von Designs nach Name (`setTheme` unterstützt String-Namen)
- Umschalten der erweiterten Werkzeugansicht

Aktuell keine Aktion ausführende Methoden in diesem Controller:

- `setFooter`
- `setHeader`
- `setEditorComponent`

Hinweis: `setWidget` leitet derzeit über `setHookWidget(...)` zum Statuszeilen-Text weiter.

### RPC-Modus (`rpc-mode.ts`)

`ctx.ui` wird durch RPC-`extension_ui_request`-Ereignisse unterstützt:

- Dialog-Methoden (`select`, `confirm`, `input`, `editor`) mit Hin- und Rückkommunikation zu Client-Antworten
- Fire-and-Forget-Methoden senden Anfragen aus (`notify`, `setStatus`, `setWidget` für String-Arrays, `setTitle`, `setEditorText`)

Nicht unterstützt/keine Aktion ausführend in der RPC-Implementierung:

- `onTerminalInput`
- `custom`
- `setFooter`, `setHeader`, `setEditorComponent`
- `setWorkingMessage`
- Design-Umschalten/-Laden (`setTheme` gibt Fehler zurück)
- Werkzeug-Erweiterungssteuerungen sind inaktiv

### Print-/Headless-/Subagent-Pfade

Wenn kein UI-Kontext der Runner-Initialisierung übergeben wird, ist `ctx.hasUI` `false` und Methoden sind keine Aktion ausführend/geben Standardwerte zurück.

### Hintergrund-Interaktiver Modus

Der Hintergrundmodus installiert ein nicht-interaktives UI-Kontextobjekt. In der aktuellen Implementierung kann `ctx.hasUI` weiterhin `true` sein, während interaktive Dialoge Standardwerte/keine Aktionen zurückgeben.

## Sitzungs- und Zustandsmuster

Für dauerhaften Erweiterungsstatus:

1. Persistieren mit `pi.appendEntry(customType, data)`.
2. Zustand aus `ctx.sessionManager.getBranch()` bei `session_start`, `session_branch`, `session_tree` neu aufbauen.
3. Werkzeugresultat-`details` strukturiert halten, wenn der Zustand aus der Werkzeugresultat-Historie sichtbar/rekonstruierbar sein soll.

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

## Werkzeugaufruf-/Ergebnis-Renderer

Stellen Sie `renderCall` / `renderResult` bei `registerTool`-Definitionen für benutzerdefinierte Werkzeugvisualisierung in TUI bereit.

## Einschränkungen und Fallstricke

- Laufzeitaktionen sind während des Ladens der Erweiterung nicht verfügbar.
- `tool_call`-Fehler blockieren die Ausführung (fail-closed).
- Namenskonflikte von Befehlen mit integrierten Befehlen werden mit Diagnosemeldungen übersprungen.
- Reservierte Tastenkürzel werden ignoriert (`ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`).
- Behandeln Sie `ctx.reload()` als terminal für den aktuellen Befehlshandler-Frame.

## Erweiterungen vs. Hooks vs. Custom-Tools

Verwenden Sie die richtige Oberfläche:

- **Erweiterungen** (`src/extensibility/extensions/*`): einheitliches System (Ereignisse + Werkzeuge + Befehle + Renderer + Provider-Registrierung).
- **Hooks** (`src/extensibility/hooks/*`): separate Legacy-Ereignis-API.
- **Custom-Tools** (`src/extensibility/custom-tools/*`): werkzeugfokussierte Module; wenn sie zusammen mit Erweiterungen geladen werden, werden sie angepasst und durchlaufen weiterhin Erweiterungs-Abfang-Wrapper.

Wenn Sie ein Paket benötigen, das Richtlinien, Werkzeuge, Befehls-UX und Rendering gemeinsam verwaltet, verwenden Sie Erweiterungen.
