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

## Aktueller Status im Laufzeitsystem

Das Hook-Paket (`src/extensibility/hooks/`) wird weiterhin exportiert und ist als API-Oberfläche nutzbar, jedoch initialisiert die Standard-CLI-Laufzeit nun den **Extension-Runner**-Pfad. Im aktuellen Startablauf gilt:

- `--hook` wird als Alias für `--extension` behandelt (CLI-Pfade werden in `additionalExtensionPaths` zusammengeführt)
- Werkzeuge werden durch `ExtensionToolWrapper` umschlossen, nicht durch `HookToolWrapper`
- Kontext-Transformationen und Lebenszyklus-Emissionen laufen durch `ExtensionRunner`

Dieses Dokument beschreibt daher die Hook-Subsystem-Implementierung selbst (Typen/Loader/Runner/Wrapper), einschließlich Legacy-Verhalten und Einschränkungen.

## Schlüsseldateien

- `src/extensibility/hooks/types.ts` — Hook-Kontext, Ereignistypen und Ergebnisverträge
- `src/extensibility/hooks/loader.ts` — Modulladen und Hook-Discovery-Bridge
- `src/extensibility/hooks/runner.ts` — Ereignis-Dispatch, Befehlssuche und Fehlersignalisierung
- `src/extensibility/hooks/tool-wrapper.ts` — Pre/Post-Werkzeug-Abfangwrapper
- `src/extensibility/hooks/index.ts` — Exporte/Re-Exporte

## Was ein Hook-Modul ist

Ein Hook-Modul muss standardmäßig eine Factory exportieren:

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

- Ereignishandler mit `pi.on(...)` registrieren
- Persistente benutzerdefinierte Nachrichten mit `pi.sendMessage(...)` senden
- Nicht-LLM-Zustand mit `pi.appendEntry(...)` persistieren
- Slash-Befehle über `pi.registerCommand(...)` registrieren
- Benutzerdefinierte Nachrichten-Renderer über `pi.registerMessageRenderer(...)` registrieren
- Shell-Befehle über `pi.exec(...)` ausführen

## Erkennung und Laden

`discoverAndLoadHooks(configuredPaths, cwd)` führt folgendes durch:

1. Erkannte Hooks aus der Capability-Registry laden (`loadCapability("hooks")`)
2. Explizit konfigurierte Pfade anhängen (dedupliziert nach absolutem Pfad)
3. `loadHooks(allPaths, cwd)` aufrufen

`loadHooks` importiert dann jeden Pfad und erwartet eine `default`-Funktion.

### Pfadauflösung

`loader.ts` löst Hook-Pfade wie folgt auf:

- absoluter Pfad: wird unverändert verwendet
- `~`-Pfad: wird expandiert
- relativer Pfad: wird relativ zu `cwd` aufgelöst

### Wichtige Legacy-Diskrepanz

Discovery-Provider für `hookCapability` modellieren weiterhin Pre/Post-Shell-artige Hook-Dateien (zum Beispiel `.claude/hooks/pre/*`, `.xcsh/.../hooks/pre/*`).

Der Hook-Loader hier verwendet dynamischen Modulimport und erfordert eine Standard-JS/TS-Hook-Factory. Wenn ein erkannter Hook-Pfad nicht als Modul importierbar ist, schlägt das Laden fehl und wird in `LoadHooksResult.errors` gemeldet.

## Ereignisoberflächen

Hook-Ereignisse sind in `types.ts` streng typisiert.

### Session-Ereignisse

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

### Agenten-/Kontext-Ereignisse

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

### Werkzeug-Ereignisse (Pre/Post-Modell)

- `tool_call` (vor der Ausführung) → kann `{ block?: boolean; reason?: string }` zurückgeben
- `tool_result` (nach der Ausführung) → kann `{ content?; details?; isError? }` zurückgeben

Dies ist das zentrale Pre/Post-Abfangmodell des Hook-Subsystems.

```text
Hook-Werkzeug-Abfangablauf

tool_call-Handler
   │
   ├─ irgendein { block: true }? ── ja ──> throw (Werkzeug blockiert)
   │
   └─ nein
      │
      ▼
   Zugrundeliegendes Werkzeug ausführen
      │
      ├─ Erfolg ──> tool_result-Handler können { content, details } überschreiben
      │
      └─ Fehler  ──> tool_result(isError=true) emittieren, dann ursprünglichen Fehler erneut werfen
```

## Ausführungsmodell und Mutationssemantik

### 1) Vor der Ausführung: `tool_call`

`HookToolWrapper.execute()` emittiert `tool_call` vor der Werkzeugausführung.

- wenn ein Handler `{ block: true }` zurückgibt, wird die Ausführung gestoppt
- wenn ein Handler einen Fehler wirft, schlägt der Wrapper sicher fehl und blockiert die Ausführung
- zurückgegebener `reason`-Wert wird zum Text des geworfenen Fehlers

### 2) Werkzeugausführung

Das zugrundeliegende Werkzeug wird normal ausgeführt, wenn es nicht blockiert ist.

### 3) Nach der Ausführung: `tool_result`

Nach Erfolg emittiert der Wrapper `tool_result` mit:

- `toolName`, `toolCallId`, `input`
- `content`
- `details`
- `isError: false`

Wenn ein Handler Überschreibungen zurückgibt:

- `content` kann den Ergebnisinhalt ersetzen
- `details` kann die Ergebnisdetails ersetzen

Bei Werkzeugfehler emittiert der Wrapper `tool_result` mit `isError: true` und Fehlertextinhalt, dann wird der ursprüngliche Fehler erneut geworfen.

### Was Hooks mutieren können

- LLM-Kontext für einen einzelnen Aufruf über `context` (Nachrichten-Ersetzungskette)
- Werkzeugausgabeinhalt/-details bei erfolgreichen Werkzeugaufrufen (`tool_result`-Pfad)
- Vor-Agenten-injizierte Nachricht über `before_agent_start`
- Abbruch/benutzerdefinierte Komprimierung/Baumverhalten über `session_before_*` und `session.compacting`

### Was Hooks in dieser Implementierung nicht mutieren können

- Rohe Werkzeug-Eingabeparameter direkt (nur Blockieren/Zulassen bei `tool_call`)
- Ausführungsfortsetzung nach geworfenen Werkzeugfehlern (Fehlerpfad wirft erneut)
- Endgültigen Erfolgs-/Fehlerstatus im Wrapper-Verhalten (zurückgegebenes `isError` ist typisiert, wird aber von `HookToolWrapper` nicht angewendet)

## Reihenfolge und Konfliktverhalten

### Reihenfolge auf Discovery-Ebene

Capability-Provider werden nach Priorität sortiert (höhere zuerst). Deduplizierung erfolgt nach Capability-Schlüssel, der erste gewinnt.

Für `hooks` lautet der Capability-Schlüssel `${type}:${tool}:${name}`. Überschattete Duplikate von Providern mit niedrigerer Priorität werden markiert und aus der effektiven erkannten Liste ausgeschlossen.

### Ladereihenfolge

`discoverAndLoadHooks` erstellt eine flache `allPaths`-Liste, dedupliziert nach aufgelöstem absolutem Pfad, dann iteriert `loadHooks` in dieser Reihenfolge.
Die Dateireihenfolge innerhalb jedes erkannten Verzeichnisses hängt von der `readdir`-Ausgabe ab; der Hook-Loader führt keine zusätzliche Sortierung durch.

### Laufzeit-Handler-Reihenfolge

Innerhalb von `HookRunner` ist die Reihenfolge durch die Registrierungssequenz deterministisch:

1. Reihenfolge des Hooks-Arrays
2. Handler-Registrierungsreihenfolge pro Hook/Ereignis

Konfliktverhalten nach Ereignistyp:

- `tool_call`: letztes zurückgegebenes Ergebnis gewinnt, außer ein Handler blockiert; erster Block schließt kurz
- `tool_result`: letzte zurückgegebene Überschreibung gewinnt (kein Kurzschluss)
- `context`: verkettet; jeder Handler erhält die Nachrichtenausgabe des vorherigen Handlers
- `before_agent_start`: erste zurückgegebene Nachricht wird behalten; spätere Nachrichten werden ignoriert
- `session_before_*`: letztes zurückgegebenes Ergebnis wird verfolgt; `cancel: true` schließt sofort kurz
- `session.compacting`: letztes zurückgegebenes Ergebnis gewinnt

Befehl-/Renderer-Konflikte:

- `getCommand(name)` gibt die erste Übereinstimmung über alle Hooks zurück (zuerst geladen gewinnt)
- `getMessageRenderer(customType)` gibt die erste Übereinstimmung zurück
- `getRegisteredCommands()` gibt alle Befehle zurück (keine Deduplizierung)

## UI-Interaktionen (`HookContext.ui`)

`HookUIContext` enthält:

- `select`, `confirm`, `input`, `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`, `getEditorText`
- `theme`-Getter

`ctx.hasUI` gibt an, ob eine interaktive Benutzeroberfläche verfügbar ist.

Bei der Ausführung ohne Benutzeroberfläche ist das standardmäßige No-Op-Kontextverhalten:

- `select/input/editor` geben `undefined` zurück
- `confirm` gibt `false` zurück
- `notify`, `setStatus`, `setEditorText` sind No-Ops
- `getEditorText` gibt `""` zurück

### Statuszeilen-Verhalten

Über `ctx.ui.setStatus(key, text)` gesetzter Hook-Statustext wird:

- pro Schlüssel gespeichert
- nach Schlüsselname sortiert
- bereinigt (`\r`, `\n`, `\t` → Leerzeichen; wiederholte Leerzeichen werden zusammengefasst)
- verbunden und zur Anzeige auf die Breite gekürzt

## Fehlerweitergabe und Fallback

### Zur Ladezeit

- ungültiges Modul oder fehlender Standard-Export → wird in `LoadHooksResult.errors` erfasst
- das Laden wird für andere Hooks fortgesetzt

### Zur Ereigniszeit

`HookRunner.emit(...)` fängt Handler-Fehler für die meisten Ereignisse ab und emittiert `HookError` an Listener (`hookPath`, `event`, `error`), dann wird fortgesetzt.

`emitToolCall(...)` ist strenger: Handler-Fehler werden dort nicht verschluckt; sie werden an den Aufrufer weitergegeben. In `HookToolWrapper` blockiert dies den Werkzeugaufruf (Fail-Safe).

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

### Werkzeugausgabe nach der Ausführung redigieren

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

### Modellkontext pro LLM-Aufruf ändern

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
- alle Hook-Typen
- `execCommand`-Re-Export

Und das Paket-Root (`src/index.ts`) re-exportiert Hook-**Typen** als Legacy-Kompatibilitätsoberfläche.
