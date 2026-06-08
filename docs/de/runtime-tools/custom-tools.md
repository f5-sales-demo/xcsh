---
title: Custom Tools
description: >-
  Registrierung benutzerdefinierter Tools, Schema-Definition und
  Ausführungs-Pipeline zur Erweiterung des Agenten.
sidebar:
  order: 4
  label: Custom tools
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# Custom Tools

Custom Tools sind modell-aufrufbare Funktionen, die in dieselbe Tool-Ausführungs-Pipeline wie die eingebauten Tools eingebunden werden.

Ein Custom Tool ist ein TypeScript/JavaScript-Modul, das eine Factory exportiert. Die Factory erhält eine Host-API (`CustomToolAPI`) und gibt ein Tool oder ein Array von Tools zurück.

## Was dies ist (und was nicht)

- **Custom Tool**: Aufrufbar durch das Modell während eines Turns (`execute` + TypeBox-Schema).
- **Extension**: Lifecycle-/Event-Framework, das Tools registrieren und Events abfangen/modifizieren kann.
- **Hook**: Externe Pre-/Post-Befehlsskripte.
- **Skill**: Statisches Guidance-/Kontext-Paket, kein ausführbarer Tool-Code.

Wenn Sie möchten, dass das Modell Code direkt aufruft, verwenden Sie ein Custom Tool.

## Integrationswege im aktuellen Code

Es gibt zwei aktive Integrationsstile:

1. **Vom SDK bereitgestellte Custom Tools** (`options.customTools`)
   - Werden über `CustomToolAdapter` oder Extension-Wrapper in Agent-Tools eingebettet.
   - Sind immer im initialen aktiven Tool-Set beim SDK-Bootstrap enthalten.

2. **Über das Dateisystem entdeckte Module via Loader-API** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - Als Bibliotheks-APIs in `src/extensibility/custom-tools/loader.ts` bereitgestellt.
   - Host-Code kann diese aufrufen, um Tool-Module aus Konfigurations-/Provider-/Plugin-Pfaden zu entdecken und zu laden.

```text
Model tool call flow

LLM tool call
   │
   ▼
Tool registry (built-ins + custom tool adapters)
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> streamed partial result
   └─ return result  -> final tool content/details
```

## Discovery-Pfade (Loader-API)

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` führt zusammen:

1. Capability-Provider (`toolCapability`), einschließlich:
   - Native OMP-Konfiguration (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Claude-Konfiguration (`~/.claude/tools`, `.claude/tools`)
   - Codex-Konfiguration (`~/.codex/tools`, `.codex/tools`)
   - Claude Marketplace Plugin-Cache-Provider
2. Installierte Plugin-Manifeste (`~/.xcsh/plugins/node_modules/*` über den Plugin-Loader)
3. Explizit konfigurierte Pfade, die an den Loader übergeben werden

### Wichtiges Verhalten

- Doppelte aufgelöste Pfade werden dedupliziert.
- Tool-Namenskonflikte werden gegen eingebaute und bereits geladene Custom Tools abgelehnt.
- `.md`- und `.json`-Dateien werden von einigen Providern als Tool-Metadaten entdeckt, aber der ausführbare Modul-Loader lehnt sie als lauffähige Tools ab.
- Relative konfigurierte Pfade werden von `cwd` aus aufgelöst; `~` wird expandiert.

## Modul-Vertrag

Ein Custom-Tool-Modul muss eine Funktion exportieren (Default-Export bevorzugt):

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

- `params` ist statisch typisiert aus Ihrem TypeBox-Schema via `Static<TParams>`.
- Die Laufzeit-Argumentvalidierung findet vor der Ausführung in der Agent-Schleife statt.
- `onUpdate` sendet Teilergebnisse für UI-Streaming.
- `ctx` enthält Session-/Modell-Status und einen `abort()`-Helfer.
- `signal` überträgt die Abbruchsignalisierung.

`CustomToolAdapter` verbindet dies mit der Agent-Tool-Schnittstelle und leitet Aufrufe in der korrekten Argumentreihenfolge weiter.

## Wie Tools dem Modell bereitgestellt werden

- Tools werden in `AgentTool`-Instanzen eingebettet (`CustomToolAdapter` oder Extension-Wrapper).
- Sie werden nach Name in die Session-Tool-Registry eingefügt.
- Beim SDK-Bootstrap werden Custom Tools und durch Extensions registrierte Tools zwangsweise in das initiale aktive Set aufgenommen.
- CLI `--tools` validiert derzeit nur eingebaute Tool-Namen; die Einbindung von Custom Tools wird über Discovery-/Registrierungspfade und SDK-Optionen gehandhabt.

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

## Fehler- und Abbruch-Semantik

### Synchrone/asynchrone Fehler

- Werfen (oder abgelehnte Promises) in `execute` wird als Tool-Fehler behandelt.
- Die Agent-Laufzeit wandelt Fehler in Tool-Ergebnisnachrichten mit `isError: true` und Fehlertext-Inhalt um.
- Bei Extension-Wrappern können `tool_result`-Handler den Inhalt/die Details weiter umschreiben und sogar den Fehlerstatus überschreiben.

### Abbruch

- Der Agent-Abbruch wird über `AbortSignal` an `execute` weitergeleitet.
- Leiten Sie `signal` an Subprozess-Arbeit weiter (`pi.exec(..., { signal })`) für kooperativen Abbruch.
- `ctx.abort()` ermöglicht es einem Tool, den Abbruch der aktuellen Agent-Operation anzufordern.

### onSession-Fehler

- `onSession`-Fehler werden abgefangen und als Warnungen protokolliert; sie bringen die Session nicht zum Absturz.

## Reale Einschränkungen für das Design

- Tool-Namen müssen in der aktiven Registry global eindeutig sein.
- Bevorzugen Sie deterministische, schema-förmige Ausgaben in `details` für Renderer-/Zustandsrekonstruktion.
- Schützen Sie die UI-Nutzung mit `pi.hasUI`.
- Behandeln Sie `.md`/`.json` in Tool-Verzeichnissen als Metadaten, nicht als ausführbare Module.
