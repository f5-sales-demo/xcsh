---
title: Benutzerdefinierte Tools
description: >-
  Registrierung benutzerdefinierter Tools, Schema-Definition und
  Ausführungspipeline zur Erweiterung des Agenten.
sidebar:
  order: 4
  label: Benutzerdefinierte Tools
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# Benutzerdefinierte Tools

Benutzerdefinierte Tools sind vom Modell aufrufbare Funktionen, die sich in dieselbe Tool-Ausführungspipeline wie die integrierten Tools einfügen.

Ein benutzerdefiniertes Tool ist ein TypeScript/JavaScript-Modul, das eine Factory exportiert. Die Factory erhält eine Host-API (`CustomToolAPI`) und gibt ein einzelnes Tool oder ein Array von Tools zurück.

## Was dies ist (und was nicht)

- **Benutzerdefiniertes Tool**: Vom Modell während eines Durchlaufs aufrufbar (`execute` + TypeBox-Schema).
- **Extension**: Lifecycle-/Event-Framework, das Tools registrieren und Events abfangen/modifizieren kann.
- **Hook**: Externe Pre-/Post-Befehlsskripte.
- **Skill**: Statisches Anleitungs-/Kontextpaket, kein ausführbarer Tool-Code.

Wenn Sie möchten, dass das Modell Code direkt aufruft, verwenden Sie ein benutzerdefiniertes Tool.

## Integrationspfade im aktuellen Code

Es gibt zwei aktive Integrationsstile:

1. **SDK-bereitgestellte benutzerdefinierte Tools** (`options.customTools`)
   - Werden über `CustomToolAdapter` oder Extension-Wrapper in Agent-Tools umgewandelt.
   - Sind immer im initialen aktiven Tool-Set beim SDK-Bootstrap enthalten.

2. **Im Dateisystem entdeckte Module über die Loader-API** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - Als Bibliotheks-APIs in `src/extensibility/custom-tools/loader.ts` bereitgestellt.
   - Host-Code kann diese aufrufen, um Tool-Module aus Konfigurations-/Provider-/Plugin-Pfaden zu entdecken und zu laden.

```text
Ablauf eines Modell-Tool-Aufrufs

LLM-Tool-Aufruf
   │
   ▼
Tool-Registry (integrierte + benutzerdefinierte Tool-Adapter)
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> gestreamtes Teilergebnis
   └─ return result  -> endgültiger Tool-Inhalt/Details
```

## Entdeckungsorte (Loader-API)

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` führt zusammen:

1. Capability-Provider (`toolCapability`), einschließlich:
   - Native OMP-Konfiguration (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Claude-Konfiguration (`~/.claude/tools`, `.claude/tools`)
   - Codex-Konfiguration (`~/.codex/tools`, `.codex/tools`)
   - Claude-Marketplace-Plugin-Cache-Provider
2. Installierte Plugin-Manifeste (`~/.xcsh/plugins/node_modules/*` über Plugin-Loader)
3. Explizit konfigurierte Pfade, die an den Loader übergeben werden

### Wichtiges Verhalten

- Doppelte aufgelöste Pfade werden dedupliziert.
- Tool-Namenskonflikte werden gegen integrierte und bereits geladene benutzerdefinierte Tools abgelehnt.
- `.md`- und `.json`-Dateien werden von einigen Providern als Tool-Metadaten entdeckt, aber der ausführbare Modul-Loader lehnt sie als ausführbare Tools ab.
- Relative konfigurierte Pfade werden von `cwd` aus aufgelöst; `~` wird expandiert.

## Modulvertrag

Ein benutzerdefiniertes Tool-Modul muss eine Funktion exportieren (Default-Export bevorzugt):

```ts
import type { CustomToolFactory } from "@f5xc-salesdemos/xcsh";

const factory: CustomToolFactory = (pi) => ({
 name: "repo_stats",
 label: "Repo Stats",
 description: "Counts tracked TypeScript files",
 parameters: pi.typebox.Type.Object({
  glob: pi.typebox.Type.Optional(pi.typebox.Type.String({ default: "**/*.ts" })),
 }),

 async execute(toolCallId, params, onUpdate, ctx, signal) {
  onUpdate?.({
   content: [{ type: "text", text: "Scanning files..." }],
   details: { phase: "scan" },
  });

  const result = await pi.exec("git", ["ls-files", params.glob ?? "**/*.ts"], { signal, cwd: pi.cwd });
  if (result.killed) {
   throw new Error("Scan was cancelled");
  }
  if (result.code !== 0) {
   throw new Error(result.stderr || "git ls-files failed");
  }

  const files = result.stdout.split("\n").filter(Boolean);
  return {
   content: [{ type: "text", text: `Found ${files.length} files` }],
   details: { count: files.length, sample: files.slice(0, 10) },
  };
 },

 onSession(event) {
  if (event.reason === "shutdown") {
   // cleanup resources if needed
  }
 },
});

export default factory;
```

Factory-Rückgabetyp:

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## API-Oberfläche für Factories (`CustomToolAPI`)

Aus `types.ts` und `loader.ts`:

- `cwd`: Arbeitsverzeichnis des Hosts
- `exec(command, args, options?)`: Hilfsfunktion zur Prozessausführung
- `ui`: UI-Kontext (kann in Headless-Modi ein No-Op sein)
- `hasUI`: `false` in nicht-interaktiven Abläufen
- `logger`: Gemeinsamer Datei-Logger
- `typebox`: Injiziertes `@sinclair/typebox`
- `pi`: Injizierte `@f5xc-salesdemos/xcsh`-Exporte
- `pushPendingAction(action)`: Registriert eine Vorschau-Aktion für das versteckte `resolve`-Tool (`docs/resolve-tool-runtime.md`)

Der Loader startet mit einem No-Op-UI-Kontext und erfordert, dass der Host-Code `setUIContext(...)` aufruft, wenn die echte UI bereit ist.

## Ausführungsvertrag und Typisierung

`CustomTool.execute`-Signatur:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` ist statisch typisiert anhand Ihres TypeBox-Schemas über `Static<TParams>`.
- Die Laufzeit-Argumentvalidierung erfolgt vor der Ausführung in der Agent-Schleife.
- `onUpdate` gibt Teilergebnisse für UI-Streaming aus.
- `ctx` enthält Session-/Modellzustand und eine `abort()`-Hilfsfunktion.
- `signal` überträgt die Abbruchsignalisierung.

`CustomToolAdapter` verbindet dies mit der Agent-Tool-Schnittstelle und leitet Aufrufe in der korrekten Argumentreihenfolge weiter.

## Wie Tools dem Modell bereitgestellt werden

- Tools werden in `AgentTool`-Instanzen umgewandelt (`CustomToolAdapter` oder Extension-Wrapper).
- Sie werden nach Name in die Session-Tool-Registry eingefügt.
- Beim SDK-Bootstrap werden benutzerdefinierte und über Extensions registrierte Tools zwangsweise in das initiale aktive Set aufgenommen.
- CLI `--tools` validiert derzeit nur integrierte Tool-Namen; die Einbindung benutzerdefinierter Tools wird über Entdeckungs-/Registrierungspfade und SDK-Optionen gehandhabt.

## Rendering-Hooks

Optionale Rendering-Hooks:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

Laufzeitverhalten im TUI:

- Wenn Hooks vorhanden sind, wird die Tool-Ausgabe innerhalb eines `Box`-Containers gerendert.
- `renderResult` erhält `{ expanded, isPartial, spinnerFrame? }`.
- Renderer-Fehler werden abgefangen und protokolliert; die UI fällt auf Standard-Textrendering zurück.

## Session-/Zustandsbehandlung

Optionales `onSession(event, ctx)` empfängt Session-Lifecycle-Events, darunter:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

Verwenden Sie `ctx.sessionManager`, um den Zustand aus der Historie zu rekonstruieren, wenn sich der Branch-/Session-Kontext ändert.

## Fehler- und Abbruchsemantik

### Synchrone/asynchrone Fehler

- Werfen (oder abgelehnte Promises) in `execute` wird als Tool-Fehler behandelt.
- Die Agent-Laufzeit wandelt Fehler in Tool-Ergebnisnachrichten mit `isError: true` und Fehlertext-Inhalt um.
- Bei Extension-Wrappern können `tool_result`-Handler den Inhalt/die Details weiter umschreiben und sogar den Fehlerstatus überschreiben.

### Abbruch

- Der Agent-Abbruch wird über `AbortSignal` an `execute` weitergeleitet.
- Leiten Sie `signal` an Subprozess-Arbeit weiter (`pi.exec(..., { signal })`) für kooperativen Abbruch.
- `ctx.abort()` ermöglicht es einem Tool, den Abbruch der aktuellen Agent-Operation anzufordern.

### onSession-Fehler

- `onSession`-Fehler werden abgefangen und als Warnungen protokolliert; sie führen nicht zum Absturz der Session.

## Echte Einschränkungen für das Design

- Tool-Namen müssen in der aktiven Registry global eindeutig sein.
- Bevorzugen Sie deterministische, schema-geformte Ausgaben in `details` für Renderer-/Zustandsrekonstruktion.
- Schützen Sie UI-Nutzung mit `pi.hasUI`.
- Behandeln Sie `.md`/`.json` in Tool-Verzeichnissen als Metadaten, nicht als ausführbare Module.
