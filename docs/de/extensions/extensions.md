---
title: Erweiterungen
description: >-
  Überblick über die Erweiterungs-Laufzeitumgebung mit Typen,
  Runner-Lebenszyklus, Registrierung und Erkennung.
sidebar:
  order: 1
  label: Überblick
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# Erweiterungen

Primärer Leitfaden für die Entwicklung von Laufzeit-Erweiterungen in `packages/coding-agent`.

Dieses Dokument behandelt die aktuelle Erweiterungs-Laufzeitumgebung in:

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

Für Erkennungspfade und Dateisystem-Laderegeln siehe `docs/extension-loading.md`.

## Was eine Erweiterung ist

Eine Erweiterung ist ein TS/JS-Modul, das eine Standard-Factory-Funktion exportiert:

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // Handler/Tools/Befehle/Renderer registrieren
}
```

Erweiterungen können alle folgenden Funktionalitäten in einem Modul kombinieren:

- Event-Handler (`pi.on(...)`)
- LLM-aufrufbare Tools (`pi.registerTool(...)`)
- Slash-Befehle (`pi.registerCommand(...)`)
- Tastenkombinationen und Flags
- Benutzerdefiniertes Nachrichten-Rendering
- Sitzungs-/Nachrichteninjektions-APIs (`sendMessage`, `sendUserMessage`, `appendEntry`)

## Laufzeitmodell

1. Erweiterungen werden importiert und ihre Factory-Funktionen ausgeführt.
2. Während dieser Ladephase sind Registrierungsmethoden gültig; Laufzeit-Aktionsmethoden sind noch nicht initialisiert.
3. `ExtensionRunner.initialize(...)` verbindet Live-Aktionen/Kontexte für den aktiven Modus.
4. Sitzungs-/Agenten-/Tool-Lebenszyklus-Events werden an Handler emittiert.
5. Jede Tool-Ausführung wird mit Erweiterungs-Interception umschlossen (`tool_call` / `tool_result`).

```text
Erweiterungs-Lebenszyklus (vereinfacht)

Ladepfade
   │
   ▼
Modul importieren + Factory ausführen (nur Registrierung)
   │
   ▼
ExtensionRunner.initialize(Modus/Sitzung/Tool-Registry)
   │
   ├─ Sitzungs-/Agenten-Events an Handler emittieren
   ├─ Tool-Ausführung umschließen (tool_call/tool_result)
   └─ Laufzeit-Aktionen bereitstellen (sendMessage, setActiveTools, ...)
```

Wichtige Einschränkung aus `loader.ts`:

- Der Aufruf von Aktionsmethoden wie `pi.sendMessage()` während des Ladens der Erweiterung wirft `ExtensionRuntimeNotInitializedError`
- Zuerst registrieren; Laufzeitverhalten aus Events/Befehlen/Tools ausführen

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

## Erweiterungs-API-Oberflächen

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

Im interaktiven Modus werden `input`-Handler vor der eingebauten Auto-Titel-Prüfung der ersten Nachricht ausgeführt. Erweiterungen, die `await pi.setSessionName(...)` aus `input` aufrufen, können den persistierten Sitzungsnamen setzen und verhindern, dass der standardmäßig automatisch generierte Titel für diese Sitzung ausgeführt wird.

Ebenfalls bereitgestellt:

- `pi.logger`
- `pi.typebox`
- `pi.pi` (Paket-Exporte)

### Nachrichtenzustellungs-Semantik

`pi.sendMessage(message, options)` unterstützt:

- `deliverAs: "steer"` (Standard) — unterbricht den aktuellen Lauf
- `deliverAs: "followUp"` — wird in die Warteschlange gestellt und nach dem aktuellen Lauf ausgeführt
- `deliverAs: "nextTurn"` — wird gespeichert und beim nächsten Benutzer-Prompt injiziert
- `triggerTurn: true` — startet einen Turn im Leerlauf (`nextTurn` ignoriert dies)

`pi.sendUserMessage(content, { deliverAs })` durchläuft immer den Prompt-Ablauf; während des Streamings wird es als Steer/Follow-Up in die Warteschlange gestellt.

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

Verwenden Sie den Befehlskontext für Sitzungssteuerungs-Abläufe; diese Methoden sind absichtlich von allgemeinen Event-Handlern getrennt.

## Event-Oberfläche (aktuelle Namen und Verhalten)

Kanonische Event-Unions und Payload-Typen befinden sich in `types.ts`.

### Sitzungs-Lebenszyklus

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

Abbrechbare Vor-Events:

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
- `tool_result` (nach Ausführung, kann Inhalt/Details/isError modifizieren)
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` (Beobachtbarkeit)

`tool_result` ist Middleware-artig: Handler werden in Erweiterungsreihenfolge ausgeführt und jeder sieht vorherige Modifikationen.

### Zuverlässigkeits-/Laufzeitsignale

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### Benutzerbefehl-Interception

- `user_bash` (mit `{ result }` überschreiben)
- `user_python` (mit `{ result }` überschreiben)

### `resources_discover`

`resources_discover` existiert in den Erweiterungstypen und `ExtensionRunner`.
Aktuelle Laufzeitnotiz: `ExtensionRunner.emitResourcesDiscover(...)` ist implementiert, aber es gibt keine `AgentSession`-Aufrufstellen, die es in der aktuellen Codebasis aufrufen.

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
  // optionales TUI-Rendering
 },
 renderResult(result, options, theme, args) {
  // optionales TUI-Rendering
 },
});
```

`tool_call`/`tool_result` fangen alle Tools ab, sobald die Registry in `sdk.ts` umschlossen ist, einschließlich eingebauter und Erweiterungs-/benutzerdefinierter Tools.

## UI-Integrationspunkte

`ctx.ui` implementiert das `ExtensionUIContext`-Interface. Die Unterstützung unterscheidet sich je nach Modus.

### Interaktiver Modus (`extension-ui-controller.ts`)

Unterstützt:

- Dialoge: `select`, `confirm`, `input`, `editor`
- Benachrichtigungen/Status/Editor-Text/Terminal-Eingabe/benutzerdefinierte Overlays
- Theme-Auflistung/Laden nach Name (`setTheme` unterstützt String-Namen)
- Tools-Erweitert-Umschalter

Aktuelle No-Op-Methoden in diesem Controller:

- `setFooter`
- `setHeader`
- `setEditorComponent`

Beachten Sie außerdem: `setWidget` leitet derzeit über `setHookWidget(...)` an den Statuszeilen-Text weiter.

### RPC-Modus (`rpc-mode.ts`)

`ctx.ui` wird durch RPC-`extension_ui_request`-Events unterstützt:

- Dialog-Methoden (`select`, `confirm`, `input`, `editor`) kommunizieren per Roundtrip mit Client-Antworten
- Fire-and-Forget-Methoden emittieren Anfragen (`notify`, `setStatus`, `setWidget` für String-Arrays, `setTitle`, `setEditorText`)

Nicht unterstützt/No-Op in der RPC-Implementierung:

- `onTerminalInput`
- `custom`
- `setFooter`, `setHeader`, `setEditorComponent`
- `setWorkingMessage`
- Theme-Wechsel/Laden (`setTheme` gibt Fehler zurück)
- Tool-Erweiterungssteuerungen sind inaktiv

### Print-/Headless-/Subagenten-Pfade

Wenn beim Runner-Init kein UI-Kontext bereitgestellt wird, ist `ctx.hasUI` `false` und Methoden sind No-Op/geben Standardwerte zurück.

### Interaktiver Hintergrundmodus

Der Hintergrundmodus installiert ein nicht-interaktives UI-Kontextobjekt. In der aktuellen Implementierung kann `ctx.hasUI` immer noch `true` sein, während interaktive Dialoge Standard-/No-Op-Verhalten zurückgeben.

## Sitzungs- und Zustandsmuster

Für dauerhaften Erweiterungszustand:

1. Mit `pi.appendEntry(customType, data)` persistieren.
2. Zustand aus `ctx.sessionManager.getBranch()` bei `session_start`, `session_branch`, `session_tree` rekonstruieren.
3. Tool-Ergebnis-`details` strukturiert halten, wenn der Zustand sichtbar/aus der Tool-Ergebnis-Historie rekonstruierbar sein soll.

Beispiel-Rekonstruktionsmuster:

```ts
pi.on("session_start", async (_event, ctx) => {
 let latest;
 for (const entry of ctx.sessionManager.getBranch()) {
  if (entry.type === "custom" && entry.customType === "my-state") {
   latest = entry.data;
  }
 }
 // aus latest wiederherstellen
});
```

## Rendering-Erweiterungspunkte

## Benutzerdefinierter Nachrichten-Renderer

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // pi-tui-Komponente zurückgeben
});
```

Wird vom interaktiven Rendering verwendet, wenn benutzerdefinierte Nachrichten angezeigt werden.

## Tool-Call/Result-Renderer

Stellen Sie `renderCall` / `renderResult` in `registerTool`-Definitionen für benutzerdefinierte Tool-Visualisierung im TUI bereit.

## Einschränkungen und Fallstricke

- Laufzeit-Aktionen sind während des Ladens der Erweiterung nicht verfügbar.
- `tool_call`-Fehler blockieren die Ausführung (Fail-Closed).
- Befehlsnamenkonflikte mit eingebauten Befehlen werden mit Diagnosen übersprungen.
- Reservierte Tastenkombinationen werden ignoriert (`ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`).
- Behandeln Sie `ctx.reload()` als terminierend für den aktuellen Befehls-Handler-Frame.

## Erweiterungen vs. Hooks vs. Custom-Tools

Verwenden Sie die richtige Oberfläche:

- **Erweiterungen** (`src/extensibility/extensions/*`): einheitliches System (Events + Tools + Befehle + Renderer + Provider-Registrierung).
- **Hooks** (`src/extensibility/hooks/*`): separate Legacy-Event-API.
- **Custom-Tools** (`src/extensibility/custom-tools/*`): Tool-fokussierte Module; wenn sie zusammen mit Erweiterungen geladen werden, werden sie adaptiert und durchlaufen weiterhin die Erweiterungs-Interception-Wrapper.

Wenn Sie ein Paket benötigen, das Policy, Tools, Befehls-UX und Rendering gemeinsam besitzt, verwenden Sie Erweiterungen.
