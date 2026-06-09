---
title: Hooks
description: >-
  Hook-System für Pre/Post-Event-Automatisierung im Lebenszyklus des
  Coding-Agenten.
sidebar:
  order: 4
  label: Hooks
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# Hooks

Dieses Dokument beschreibt den **aktuellen Hook-Subsystem-Code** in `src/extensibility/hooks/*`.

## Aktueller Status in der Laufzeitumgebung

Das Hook-Paket (`src/extensibility/hooks/`) wird weiterhin exportiert und ist als API-Oberfläche nutzbar, aber die Standard-CLI-Laufzeitumgebung initialisiert jetzt den **Extension-Runner**-Pfad. Im aktuellen Startablauf:

- `--hook` wird als Alias für `--extension` behandelt (CLI-Pfade werden in `additionalExtensionPaths` zusammengeführt)
- Tools werden von `ExtensionToolWrapper` umschlossen, nicht von `HookToolWrapper`
- Kontext-Transformationen und Lifecycle-Emissionen laufen über `ExtensionRunner`

Dieses Dokument beschreibt daher die Hook-Subsystem-Implementierung selbst (Typen/Loader/Runner/Wrapper), einschließlich Legacy-Verhalten und Einschränkungen.

## Wichtige Dateien

- `src/extensibility/hooks/types.ts` — Hook-Kontext, Event-Typen und Ergebnis-Contracts
- `src/extensibility/hooks/loader.ts` — Modulladen und Hook-Discovery-Bridge
- `src/extensibility/hooks/runner.ts` — Event-Dispatch, Befehlssuche, Fehlersignalisierung
- `src/extensibility/hooks/tool-wrapper.ts` — Pre/Post-Tool-Interception-Wrapper
- `src/extensibility/hooks/index.ts` — Exports/Re-Exports

## Was ein Hook-Modul ist

Ein Hook-Modul muss eine Factory als Default-Export bereitstellen:

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function hook(pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && String(event.input.command ?? "").includes("rm -rf")) {
   return { block: true, reason: "blocked by policy" };
  }
 });
}
```

Die Factory kann:

- Event-Handler mit `pi.on(...)` registrieren
- persistente benutzerdefinierte Nachrichten mit `pi.sendMessage(...)` senden
- Nicht-LLM-Zustand mit `pi.appendEntry(...)` persistieren
- Slash-Befehle über `pi.registerCommand(...)` registrieren
- benutzerdefinierte Nachrichten-Renderer über `pi.registerMessageRenderer(...)` registrieren
- Shell-Befehle über `pi.exec(...)` ausführen

## Discovery und Laden

`discoverAndLoadHooks(configuredPaths, cwd)` führt Folgendes aus:

1. Erkannte Hooks aus der Capability-Registry laden (`loadCapability("hooks")`)
2. Explizit konfigurierte Pfade anhängen (dedupliziert nach absolutem Pfad)
3. `loadHooks(allPaths, cwd)` aufrufen

`loadHooks` importiert dann jeden Pfad und erwartet eine `default`-Funktion.

### Pfadauflösung

`loader.ts` löst Hook-Pfade wie folgt auf:

- Absoluter Pfad: wird direkt verwendet
- `~`-Pfad: wird expandiert
- Relativer Pfad: wird relativ zu `cwd` aufgelöst

### Wichtige Legacy-Inkompatibilität

Discovery-Provider für `hookCapability` modellieren weiterhin Pre/Post-Shell-Style-Hook-Dateien (zum Beispiel `.claude/hooks/pre/*`, `.xcsh/.../hooks/pre/*`).

Der Hook-Loader hier verwendet dynamischen Modulimport und erfordert eine Default-JS/TS-Hook-Factory. Wenn ein erkannter Hook-Pfad nicht als Modul importierbar ist, schlägt das Laden fehl und wird in `LoadHooksResult.errors` gemeldet.

## Event-Oberflächen

Hook-Events sind in `types.ts` streng typisiert.

### Session-Events

- `session_start`
- `session_before_switch` → kann `{ cancel?: boolean }` zurückgeben
- `session_switch`
- `session_before_branch` → kann `{ cancel?: boolean; skipConversationRestore?: boolean }` zurückgeben
- `session_branch`
- `session_before_compact` → kann `{ cancel?: boolean; compaction?: CompactionResult }` zurückgeben
- `session.compacting` → kann `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }` zurückgeben
- `session_compact`
- `session_before_tree` → kann `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }` zurückgeben
- `session_tree`
- `session_shutdown`

### Agent-/Kontext-Events

- `context` → kann `{ messages?: Message[] }` zurückgeben
- `before_agent_start` → kann `{ message?: { customType; content; display; details } }` zurückgeben
- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `auto_compaction_start`
- `auto_compaction_end`
- `auto_retry_start`
- `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### Tool-Events (Pre/Post-Modell)

- `tool_call` (Vor-Ausführung) → kann `{ block?: boolean; reason?: string }` zurückgeben
- `tool_result` (Nach-Ausführung) → kann `{ content?; details?; isError? }` zurückgeben

Dies ist das zentrale Pre/Post-Interception-Modell des Hook-Subsystems.

```text
Hook-Tool-Interception-Ablauf

tool_call-Handler
   │
   ├─ irgendein { block: true }? ── ja ──> throw (Tool blockiert)
   │
   └─ nein
      │
      ▼
   Zugrunde liegendes Tool ausführen
      │
      ├─ Erfolg ──> tool_result-Handler können { content, details } überschreiben
      │
      └─ Fehler ──> tool_result(isError=true) emittieren, dann ursprünglichen Fehler erneut werfen
```

## Ausführungsmodell und Mutations-Semantik

### 1) Vor-Ausführung: `tool_call`

`HookToolWrapper.execute()` emittiert `tool_call` vor der Tool-Ausführung.

- Wenn ein Handler `{ block: true }` zurückgibt, wird die Ausführung gestoppt
- Wenn ein Handler eine Exception wirft, blockiert der Wrapper im Fail-Closed-Modus die Ausführung
- Der zurückgegebene `reason` wird zum geworfenen Fehlertext

### 2) Tool-Ausführung

Das zugrunde liegende Tool wird normal ausgeführt, wenn es nicht blockiert wurde.

### 3) Nach-Ausführung: `tool_result`

Nach Erfolg emittiert der Wrapper `tool_result` mit:

- `toolName`, `toolCallId`, `input`
- `content`
- `details`
- `isError: false`

Wenn ein Handler Überschreibungen zurückgibt:

- `content` kann den Ergebnisinhalt ersetzen
- `details` kann die Ergebnisdetails ersetzen

Bei Tool-Fehlern emittiert der Wrapper `tool_result` mit `isError: true` und Fehlertext-Inhalt, wirft dann den ursprünglichen Fehler erneut.

### Was Hooks mutieren können

- LLM-Kontext für einen einzelnen Aufruf über `context` (`messages`-Ersetzungskette)
- Tool-Ausgabeinhalt/-details bei erfolgreichen Tool-Aufrufen (`tool_result`-Pfad)
- Vor-Agent injizierte Nachricht über `before_agent_start`
- Abbruch-/benutzerdefiniertes Kompaktierungs-/Tree-Verhalten über `session_before_*` und `session.compacting`

### Was Hooks in dieser Implementierung nicht mutieren können

- Rohe Tool-Eingabeparameter direkt (nur Blockieren/Erlauben bei `tool_call`)
- Ausführungsfortsetzung nach geworfenen Tool-Fehlern (Fehlerpfad wirft erneut)
- Endgültigen Erfolgs-/Fehlerstatus im Wrapper-Verhalten (zurückgegebenes `isError` ist typisiert, wird aber von `HookToolWrapper` nicht angewendet)

## Reihenfolge und Konfliktverhalten

### Reihenfolge auf Discovery-Ebene

Capability-Provider werden nach Priorität sortiert (höchste zuerst). Deduplizierung erfolgt nach Capability-Key, der erste gewinnt.

Für `hooks` ist der Capability-Key `${type}:${tool}:${name}`. Verdeckte Duplikate von Providern mit niedrigerer Priorität werden markiert und von der effektiven Discovery-Liste ausgeschlossen.

### Ladereihenfolge

`discoverAndLoadHooks` erstellt eine flache `allPaths`-Liste, dedupliziert nach aufgelöstem absolutem Pfad, dann iteriert `loadHooks` in dieser Reihenfolge.
Die Dateireihenfolge innerhalb jedes erkannten Verzeichnisses hängt von der `readdir`-Ausgabe ab; der Hook-Loader führt keine zusätzliche Sortierung durch.

### Laufzeit-Handler-Reihenfolge

Innerhalb von `HookRunner` ist die Reihenfolge deterministisch nach Registrierungssequenz:

1. Reihenfolge des Hook-Arrays
2. Handler-Registrierungsreihenfolge pro Hook/Event

Konfliktverhalten nach Event-Typ:

- `tool_call`: Das zuletzt zurückgegebene Ergebnis gewinnt, es sei denn, ein Handler blockiert; die erste Blockierung führt zum Kurzschluss
- `tool_result`: Die zuletzt zurückgegebene Überschreibung gewinnt (kein Kurzschluss)
- `context`: Verkettet; jeder Handler erhält die Nachrichtenausgabe des vorherigen Handlers
- `before_agent_start`: Die zuerst zurückgegebene Nachricht wird beibehalten; spätere Nachrichten werden ignoriert
- `session_before_*`: Das zuletzt zurückgegebene Ergebnis wird verfolgt; `cancel: true` führt sofort zum Kurzschluss
- `session.compacting`: Das zuletzt zurückgegebene Ergebnis gewinnt

Befehls-/Renderer-Konflikte:

- `getCommand(name)` gibt den ersten Treffer über alle Hooks zurück (der zuerst geladene gewinnt)
- `getMessageRenderer(customType)` gibt den ersten Treffer zurück
- `getRegisteredCommands()` gibt alle Befehle zurück (keine Deduplizierung)

## UI-Interaktionen (`HookContext.ui`)

`HookUIContext` beinhaltet:

- `select`, `confirm`, `input`, `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`, `getEditorText`
- `theme`-Getter

`ctx.hasUI` gibt an, ob eine interaktive UI verfügbar ist.

Beim Ausführen ohne UI ist das Standard-No-Op-Kontextverhalten:

- `select/input/editor` geben `undefined` zurück
- `confirm` gibt `false` zurück
- `notify`, `setStatus`, `setEditorText` sind No-Ops
- `getEditorText` gibt `""` zurück

### Statuszeilen-Verhalten

Hook-Statustext, der über `ctx.ui.setStatus(key, text)` gesetzt wird, ist:

- pro Key gespeichert
- nach Key-Name sortiert
- bereinigt (`\r`, `\n`, `\t` → Leerzeichen; wiederholte Leerzeichen zusammengefasst)
- zusammengefügt und für die Anzeige breitenbeschränkt

## Fehlerweiterleitung und Fallback

### Ladezeit

- Ungültiges Modul oder fehlender Default-Export → wird in `LoadHooksResult.errors` erfasst
- Das Laden wird für andere Hooks fortgesetzt

### Event-Zeit

`HookRunner.emit(...)` fängt Handler-Fehler für die meisten Events ab und emittiert `HookError` an Listener (`hookPath`, `event`, `error`), setzt dann fort.

`emitToolCall(...)` ist strenger: Handler-Fehler werden dort nicht geschluckt; sie werden an den Aufrufer weitergeleitet. In `HookToolWrapper` blockiert dies den Tool-Aufruf (Fail-Safe).

## Realistische API-Beispiele

### Unsichere Bash-Befehle blockieren

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "bash") return;
  const cmd = String(event.input.command ?? "");
  if (!cmd.includes("rm -rf")) return;

  if (!ctx.hasUI) return { block: true, reason: "rm -rf blocked (no UI)" };
  const ok = await ctx.ui.confirm("Dangerous command", `Allow: ${cmd}`);
  if (!ok) return { block: true, reason: "user denied command" };
 });
}
```

### Tool-Ausgabe nach Ausführung redigieren

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_result", async event => {
  if (event.toolName !== "read" || event.isError) return;

  const redacted = event.content.map(chunk => {
   if (chunk.type !== "text") return chunk;
   return { ...chunk, text: chunk.text.replaceAll(/API_KEY=\S+/g, "API_KEY=[REDACTED]") };
  });

  return { content: redacted };
 });
}
```

### Modellkontext pro LLM-Aufruf modifizieren

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### Slash-Befehl mit befehlssicheren Kontextmethoden registrieren

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.registerCommand("handoff", {
  description: "Create a new session with setup message",
  handler: async (_args, ctx) => {
   await ctx.waitForIdle();
   await ctx.newSession({
    parentSession: ctx.sessionManager.getSessionFile(),
    setup: async sm => {
     sm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Continue from prior session summary." }],
      timestamp: Date.now(),
     });
    },
   });
  },
 });
}
```

## Export-Oberfläche

`src/extensibility/hooks/index.ts` exportiert:

- Lade-APIs (`discoverAndLoadHooks`, `loadHooks`)
- Runner und Wrapper (`HookRunner`, `HookToolWrapper`)
- Alle Hook-Typen
- `execCommand`-Re-Export

Und das Paket-Root (`src/index.ts`) re-exportiert Hook-**Typen** als Legacy-Kompatibilitätsoberfläche.
