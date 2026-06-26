---
title: Hooks
description: >-
  Hook-System für Pre/Post-Event-Automatisierung im Lebenszyklus des
  Coding-Agenten.
sidebar:
  order: 4
  label: Hooks
i18n:
  sourceHash: cdbec10bc405
  translator: machine
---

# Hooks

Dieses Dokument beschreibt den **aktuellen Hook-Subsystem-Code** in `src/extensibility/hooks/*`.

## Aktueller Status im Laufzeitbetrieb

Das Hook-Paket (`src/extensibility/hooks/`) wird weiterhin exportiert und ist als API-Oberfläche nutzbar, jedoch initialisiert die Standard-CLI-Laufzeit nun den Pfad des **Extension-Runners**. Im aktuellen Startablauf:

- `--hook` wird als Alias für `--extension` behandelt (CLI-Pfade werden in `additionalExtensionPaths` zusammengeführt)
- Werkzeuge werden durch `ExtensionToolWrapper`, nicht durch `HookToolWrapper`, umschlossen
- Kontexttransformationen und Lebenszyklusemissionen werden über `ExtensionRunner` abgewickelt

Dieses Dokument beschreibt daher die Implementierung des Hook-Subsystems selbst (Typen/Loader/Runner/Wrapper), einschließlich des Legacy-Verhaltens und der Einschränkungen.

## Wichtige Dateien

- `src/extensibility/hooks/types.ts` — Hook-Kontext, Ereignistypen und Ergebnisverträge
- `src/extensibility/hooks/loader.ts` — Modulladung und Hook-Erkennungsbrücke
- `src/extensibility/hooks/runner.ts` — Ereignisweiterleitung, Befehlssuche und Fehlersignalisierung
- `src/extensibility/hooks/tool-wrapper.ts` — Pre/Post-Werkzeug-Abfangwrapper
- `src/extensibility/hooks/index.ts` — Exporte/Re-Exporte

## Was ein Hook-Modul ist

Ein Hook-Modul muss eine Factory als Standard-Export bereitstellen:

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

export default function hook(pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && String(event.input.command ?? "").includes("rm -rf")) {
   return { block: true, reason: "blocked by policy" };
  }
 });
}
```

Die Factory kann:

- Ereignis-Handler mit `pi.on(...)` registrieren
- Persistente benutzerdefinierte Nachrichten mit `pi.sendMessage(...)` senden
- Nicht-LLM-Status mit `pi.appendEntry(...)` persistieren
- Slash-Befehle über `pi.registerCommand(...)` registrieren
- Benutzerdefinierte Nachrichten-Renderer über `pi.registerMessageRenderer(...)` registrieren
- Shell-Befehle über `pi.exec(...)` ausführen

## Erkennung und Laden

`discoverAndLoadHooks(configuredPaths, cwd)` führt folgende Schritte aus:

1. Erkannte Hooks aus der Capability-Registry laden (`loadCapability("hooks")`)
2. Explizit konfigurierte Pfade anhängen (dedupliziert nach absolutem Pfad)
3. `loadHooks(allPaths, cwd)` aufrufen

`loadHooks` importiert anschließend jeden Pfad und erwartet eine `default`-Funktion.

### Pfadauflösung

`loader.ts` löst Hook-Pfade wie folgt auf:

- Absoluter Pfad: wird unverändert verwendet
- `~`-Pfad: wird expandiert
- Relativer Pfad: wird gegen `cwd` aufgelöst

### Wichtige Legacy-Diskrepanz

Erkennungsanbieter für `hookCapability` modellieren weiterhin Shell-artige Pre/Post-Hook-Dateien (z. B. `.claude/hooks/pre/*`, `.xcsh/.../hooks/pre/*`).

Der hier verwendete Hook-Loader nutzt dynamischen Modulimport und erfordert eine Standard-JS/TS-Hook-Factory. Wenn ein erkannter Hook-Pfad nicht als Modul importierbar ist, schlägt das Laden fehl und wird in `LoadHooksResult.errors` gemeldet.

## Ereignisoberflächen

Hook-Ereignisse sind in `types.ts` stark typisiert.

### Sitzungsereignisse

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

### Agenten-/Kontextereignisse

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

### Werkzeugereignisse (Pre/Post-Modell)

- `tool_call` (vor der Ausführung) → kann `{ block?: boolean; reason?: string }` zurückgeben
- `tool_result` (nach der Ausführung) → kann `{ content?; details?; isError? }` zurückgeben

Dies ist das Pre/Post-Abfangmodell des Hook-Subsystems.

```text
Hook-Werkzeug-Abfangablauf

tool_call-Handler
   │
   ├─ ein { block: true }? ── ja ──> throw (Werkzeug blockiert)
   │
   └─ nein
      │
      ▼
   Zugrunde liegendes Werkzeug ausführen
      │
      ├─ Erfolg ──> tool_result-Handler können { content, details } überschreiben
      │
      └─ Fehler  ──> tool_result(isError=true) emittieren, dann ursprünglichen Fehler erneut auslösen
```

## Ausführungsmodell und Mutationssemantik

### 1) Vor der Ausführung: `tool_call`

`HookToolWrapper.execute()` emittiert `tool_call` vor der Werkzeugausführung.

- Wenn ein Handler `{ block: true }` zurückgibt, wird die Ausführung gestoppt
- Wenn ein Handler eine Ausnahme auslöst, schlägt der Wrapper fehl und blockiert die Ausführung
- Der zurückgegebene `reason` wird zum Text der ausgelösten Ausnahme

### 2) Werkzeugausführung

Das zugrunde liegende Werkzeug wird normal ausgeführt, sofern es nicht blockiert ist.

### 3) Nach der Ausführung: `tool_result`

Nach dem Erfolg emittiert der Wrapper `tool_result` mit:

- `toolName`, `toolCallId`, `input`
- `content`
- `details`
- `isError: false`

Wenn ein Handler Überschreibungen zurückgibt:

- `content` kann den Ergebnisinhalt ersetzen
- `details` kann die Ergebnisdetails ersetzen

Bei einem Werkzeugfehler emittiert der Wrapper `tool_result` mit `isError: true` und Fehlertext-Inhalt und löst dann den ursprünglichen Fehler erneut aus.

### Was Hooks mutieren können

- LLM-Kontext für einen einzelnen Aufruf über `context` (Ersetzungskette für `messages`)
- Werkzeugausgabe-Inhalt/-Details bei erfolgreichen Werkzeugaufrufen (`tool_result`-Pfad)
- Vor-Agenten injizierte Nachricht über `before_agent_start`
- Abbruch/benutzerdefinierte Komprimierung/Baumverhalten über `session_before_*` und `session.compacting`

### Was Hooks in dieser Implementierung nicht mutieren können

- Rohe Werkzeug-Eingabeparameter an Ort und Stelle (nur Blockieren/Zulassen bei `tool_call`)
- Ausführungsfortsetzung nach ausgelösten Werkzeugfehlern (Fehlerpfad löst erneut aus)
- Finalen Erfolgs-/Fehlerstatus im Wrapper-Verhalten (zurückgegebenes `isError` ist typisiert, wird aber nicht von `HookToolWrapper` angewendet)

## Reihenfolge und Konfliktverhalten

### Reihenfolge auf Erkennungsebene

Capability-Anbieter werden nach Priorität sortiert (höchste zuerst). Deduplizierung erfolgt nach Capability-Schlüssel, der erste gewinnt.

Für `hooks` lautet der Capability-Schlüssel `${type}:${tool}:${name}`. Überlagerte Duplikate von Anbietern mit niedrigerer Priorität werden markiert und aus der effektiven Erkennungsliste ausgeschlossen.

### Ladereihenfolge

`discoverAndLoadHooks` erstellt eine flache `allPaths`-Liste, dedupliziert nach aufgelöstem absolutem Pfad, dann iteriert `loadHooks` in dieser Reihenfolge.
Die Dateireihenfolge innerhalb jedes erkannten Verzeichnisses hängt von der `readdir`-Ausgabe ab; der Hook-Loader führt keine zusätzliche Sortierung durch.

### Handler-Reihenfolge zur Laufzeit

Innerhalb von `HookRunner` ist die Reihenfolge durch die Registrierungssequenz deterministisch:

1. Reihenfolge des Hooks-Arrays
2. Handler-Registrierungsreihenfolge pro Hook/Ereignis

Konfliktverhalten nach Ereignistyp:

- `tool_call`: Das zuletzt zurückgegebene Ergebnis gewinnt, sofern kein Handler blockiert; der erste Block schließt kurz
- `tool_result`: Das zuletzt zurückgegebene Überschreiben gewinnt (kein Kurzschluss)
- `context`: Verkettet; jeder Handler empfängt die Nachrichtenausgabe des vorherigen Handlers
- `before_agent_start`: Die erste zurückgegebene Nachricht wird beibehalten; spätere Nachrichten werden ignoriert
- `session_before_*`: Das zuletzt zurückgegebene Ergebnis wird verfolgt; `cancel: true` schließt sofort kurz
- `session.compacting`: Das zuletzt zurückgegebene Ergebnis gewinnt

Konflikte bei Befehlen/Renderern:

- `getCommand(name)` gibt den ersten Treffer über alle Hooks hinweg zurück (zuerst geladen gewinnt)
- `getMessageRenderer(customType)` gibt den ersten Treffer zurück
- `getRegisteredCommands()` gibt alle Befehle zurück (keine Deduplizierung)

## UI-Interaktionen (`HookContext.ui`)

`HookUIContext` umfasst:

- `select`, `confirm`, `input`, `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`, `getEditorText`
- `theme`-Getter

`ctx.hasUI` gibt an, ob eine interaktive Benutzeroberfläche verfügbar ist.

Beim Betrieb ohne Benutzeroberfläche ist das Standardverhalten des No-Op-Kontexts:

- `select/input/editor` geben `undefined` zurück
- `confirm` gibt `false` zurück
- `notify`, `setStatus`, `setEditorText` sind No-Ops
- `getEditorText` gibt `""` zurück

### Statuszeilen-Verhalten

Hook-Statustext, der über `ctx.ui.setStatus(key, text)` gesetzt wird:

- wird pro Schlüssel gespeichert
- wird nach Schlüsselname sortiert
- wird bereinigt (`\r`, `\n`, `\t` → Leerzeichen; wiederholte Leerzeichen werden zusammengefasst)
- wird für die Anzeige verbunden und auf die Breite gekürzt

## Fehlerweiterleitung und Fallback

### Zur Ladezeit

- Ungültiges Modul oder fehlender Standard-Export → wird in `LoadHooksResult.errors` erfasst
- Das Laden wird für andere Hooks fortgesetzt

### Zur Ereigniszeit

`HookRunner.emit(...)` fängt Handler-Fehler für die meisten Ereignisse ab und emittiert `HookError` an Listener (`hookPath`, `event`, `error`), dann wird fortgefahren.

`emitToolCall(...)` ist strenger: Handler-Fehler werden dort nicht unterdrückt; sie propagieren zum Aufrufer. In `HookToolWrapper` blockiert dies den Werkzeugaufruf (Fail-Safe).

## Realistische API-Beispiele

### Unsichere Bash-Befehle blockieren

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

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

### Werkzeugausgabe nach der Ausführung schwärzen

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

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
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### Slash-Befehl mit befehlssicheren Kontextmethoden registrieren

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

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
