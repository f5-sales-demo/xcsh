---
title: Erweiterungen
description: >-
  Übersicht über die Erweiterungs-Laufzeitumgebung mit Typen,
  Runner-Lebenszyklus, Registrierung und Erkennung.
sidebar:
  order: 1
  label: Übersicht
i18n:
  sourceHash: 2985ce406fa2
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

Informationen zu Erkennungspfaden und Regeln für das Laden aus dem Dateisystem finden Sie unter `docs/extension-loading.md`.

## Was eine Erweiterung ist

Eine Erweiterung ist ein TS/JS-Modul, das eine Standard-Factory exportiert:

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

Erweiterungen können alle folgenden Elemente in einem Modul kombinieren:

- Ereignis-Handler (`pi.on(...)`)
- LLM-aufrufbare Werkzeuge (`pi.registerTool(...)`)
- Slash-Befehle (`pi.registerCommand(...)`)
- Tastaturkürzel und Flags
- Benutzerdefiniertes Nachrichten-Rendering
- Sitzungs-/Nachrichten-Injektions-APIs (`sendMessage`, `sendUserMessage`, `appendEntry`)

## Laufzeitmodell

1. Erweiterungen werden importiert und ihre Factory-Funktionen ausgeführt.
2. Während dieser Ladephase sind Registrierungsmethoden gültig; Laufzeit-Aktionsmethoden sind noch nicht initialisiert.
3. `ExtensionRunner.initialize(...)` verbindet aktive Aktionen/Kontexte für den aktiven Modus.
4. Sitzungs-/Agenten-/Werkzeug-Lebenszyklusereignisse werden an Handler ausgegeben.
5. Jede Werkzeugausführung wird mit Erweiterungs-Interception verpackt (`tool_call` / `tool_result`).

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

Im interaktiven Modus werden `input`-Handler vor der integrierten Prüfung auf automatische Betitelung der ersten Nachricht ausgeführt. Erweiterungen, die `await pi.setSessionName(...)` aus `input` aufrufen, können den persistierten Sitzungsnamen festlegen und verhindern, dass der standardmäßig automatisch generierte Titel für diese Sitzung ausgeführt wird.

Ebenfalls verfügbar:

- `pi.logger`
- `pi.typebox`
- `pi.pi` (Paket-Exporte)

### Semantik der Nachrichtenübermittlung

`pi.sendMessage(message, options)` unterstützt:

- `deliverAs: "steer"` (Standard) — unterbricht den aktuellen Lauf
- `deliverAs: "followUp"` — wird nach dem aktuellen Lauf in die Warteschlange gestellt
- `deliverAs: "nextTurn"` — wird gespeichert und bei der nächsten Benutzereingabe eingefügt
- `triggerTurn: true` — startet einen Durchlauf im Leerlauf (`nextTurn` ignoriert dies)

`pi.sendUserMessage(content, { deliverAs })` durchläuft immer den Prompt-Ablauf; während des Streamings wird als Steer/Follow-up in die Warteschlange gestellt.

## 2) Handler-Kontext (`ExtensionContext`)

Handler und Werkzeug-`execute` erhalten `ctx` mit:

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

Verwenden Sie den Befehlskontext für sitzungsgesteuerte Abläufe; diese Methoden sind bewusst von allgemeinen Ereignis-Handlern getrennt.

## Ereignisoberfläche (aktuelle Namen und Verhalten)

Kanonische Ereignisvereinigungen und Nutzlasttypen befinden sich in `types.ts`.

### Sitzungslebenszyklus

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

Abbrechbare Vorereignisse:

- `session_before_switch` → `{ cancel?: boolean }`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`

### Prompt- und Durchlauflebenszyklus

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

`tool_result` ist Middleware-artig: Handler werden in Erweiterungsreihenfolge ausgeführt, und jeder sieht vorherige Änderungen.

### Zuverlässigkeits-/Laufzeitsignale

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### Benutzerbefehlsabfang

- `user_bash` (überschreiben mit `{ result }`)
- `user_python` (überschreiben mit `{ result }`)

### `resources_discover`

`resources_discover` ist in Erweiterungstypen und `ExtensionRunner` vorhanden.
Aktueller Laufzeithinweis: `ExtensionRunner.emitResourcesDiscover(...)` ist implementiert, aber es gibt keine `AgentSession`-Aufrufstellen, die es in der aktuellen Codebasis aufrufen.

## Details zur Werkzeugerstellung

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

`tool_call`/`tool_result` fangen alle Werkzeuge ab, sobald die Registry in `sdk.ts` verpackt ist, einschließlich eingebauter und erweiterungs-/benutzerdefinierter Werkzeuge.

## UI-Integrationspunkte

`ctx.ui` implementiert die `ExtensionUIContext`-Schnittstelle. Die Unterstützung unterscheidet sich je nach Modus.

### Interaktiver Modus (`extension-ui-controller.ts`)

Unterstützt:

- Dialoge: `select`, `confirm`, `input`, `editor`
- Benachrichtigungen/Status/Editor-Text/Terminaleingabe/benutzerdefinierte Overlays
- Themenauflistung/-laden nach Name (`setTheme` unterstützt Zeichenkettennamen)
- Umschalten der Werkzeugansicht (erweitert)

Aktuelle No-Op-Methoden in diesem Controller:

- `setFooter`
- `setHeader`
- `setEditorComponent`

Hinweis: `setWidget` leitet derzeit über `setHookWidget(...)` an den Status-Zeilentext weiter.

### RPC-Modus (`rpc-mode.ts`)

`ctx.ui` wird durch RPC-`extension_ui_request`-Ereignisse unterstützt:

- Dialog-Methoden (`select`, `confirm`, `input`, `editor`) führen Rundreisen zu Client-Antworten durch
- Fire-and-Forget-Methoden senden Anfragen (`notify`, `setStatus`, `setWidget` für Zeichenketten-Arrays, `setTitle`, `setEditorText`)

Nicht unterstützt/No-Op in der RPC-Implementierung:

- `onTerminalInput`
- `custom`
- `setFooter`, `setHeader`, `setEditorComponent`
- `setWorkingMessage`
- Themenumschaltung/-laden (`setTheme` gibt Fehler zurück)
- Werkzeugsteuerungen für die Erweiterung sind inaktiv

### Print/Headless/Subagent-Pfade

Wenn dem Runner-Init kein UI-Kontext bereitgestellt wird, ist `ctx.hasUI` `false` und Methoden sind No-Op/geben Standardwerte zurück.

### Hintergrundinteraktiver Modus

Der Hintergrundmodus installiert ein nicht-interaktives UI-Kontextobjekt. In der aktuellen Implementierung kann `ctx.hasUI` weiterhin `true` sein, während interaktive Dialoge Standardwerte/No-Op-Verhalten zurückgeben.

## Sitzungs- und Zustandsmuster

Für dauerhaften Erweiterungszustand:

1. Persistieren mit `pi.appendEntry(customType, data)`.
2. Zustand aus `ctx.sessionManager.getBranch()` bei `session_start`, `session_branch`, `session_tree` wiederherstellen.
3. Werkzeugergebnis-`details` strukturiert halten, wenn der Zustand aus dem Werkzeugergebnisverlauf sichtbar/rekonstruierbar sein soll.

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

Stellen Sie `renderCall` / `renderResult` in `registerTool`-Definitionen für die benutzerdefinierte Werkzeugvisualisierung in der TUI bereit.

## Einschränkungen und Fallstricke

- Laufzeitaktionen sind während des Ladens der Erweiterung nicht verfügbar.
- `tool_call`-Fehler blockieren die Ausführung (Fail-Closed).
- Befehlsnamenkonflikte mit eingebauten Befehlen werden mit Diagnosen übersprungen.
- Reservierte Tastaturkürzel werden ignoriert (`ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`).
- Behandeln Sie `ctx.reload()` als Terminal für den aktuellen Befehls-Handler-Frame.

## Erweiterungen vs. Hooks vs. benutzerdefinierte Werkzeuge

Verwenden Sie die richtige Oberfläche:

- **Erweiterungen** (`src/extensibility/extensions/*`): Einheitliches System (Ereignisse + Werkzeuge + Befehle + Renderer + Provider-Registrierung).
- **Hooks** (`src/extensibility/hooks/*`): Separate Legacy-Ereignis-API.
- **Benutzerdefinierte Werkzeuge** (`src/extensibility/custom-tools/*`): Werkzeugfokussierte Module; wenn sie zusammen mit Erweiterungen geladen werden, werden sie angepasst und durchlaufen weiterhin die Erweiterungs-Interception-Wrapper.

Wenn Sie ein Paket benötigen, das Richtlinien, Werkzeuge, Befehls-UX und Rendering zusammen verwaltet, verwenden Sie Erweiterungen.
