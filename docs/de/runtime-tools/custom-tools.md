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

# Benutzerdefinierte Tools

Benutzerdefinierte Tools sind modellaufrufbare Funktionen, die in dieselbe Tool-Ausführungs-Pipeline wie die integrierten Tools eingebunden werden.

Ein benutzerdefiniertes Tool ist ein TypeScript/JavaScript-Modul, das eine Factory exportiert. Die Factory erhält eine Host-API (`CustomToolAPI`) und gibt ein einzelnes Tool oder ein Array von Tools zurück.

## Was dies ist (und was nicht)

- **Benutzerdefiniertes Tool**: vom Modell während eines Turns aufrufbar (`execute` + TypeBox-Schema).
- **Extension**: Lebenszyklus-/Event-Framework, das Tools registrieren und Events abfangen/modifizieren kann.
- **Hook**: externe Pre-/Post-Befehlsskripte.
- **Skill**: statisches Leitfaden-/Kontextpaket, kein ausführbarer Tool-Code.

Wenn das Modell Code direkt aufrufen soll, verwenden Sie ein benutzerdefiniertes Tool.

## Integrationspfade im aktuellen Code

Es gibt zwei aktive Integrationsstile:

1. **SDK-bereitgestellte benutzerdefinierte Tools** (`options.customTools`)
   - Werden über `CustomToolAdapter` oder Extension-Wrapper in Agent-Tools eingebunden.
   - Sind immer im initialen aktiven Tool-Set beim SDK-Bootstrap enthalten.

2. **Dateisystem-entdeckte Module über die Loader-API** (`discoverAndLoadCustomTools` / `loadCustomTools`)
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

## Entdeckungsorte (Loader-API)

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` vereinigt:

1. Capability-Provider (`toolCapability`), einschließlich:
   - Native OMP-Konfiguration (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Claude-Konfiguration (`~/.claude/tools`, `.claude/tools`)
   - Codex-Konfiguration (`~/.codex/tools`, `.codex/tools`)
   - Claude-Marketplace-Plugin-Cache-Provider
2. Installierte Plugin-Manifeste (`~/.xcsh/plugins/node_modules/*` über Plugin-Loader)
3. Explizit konfigurierte Pfade, die dem Loader übergeben werden

### Wichtiges Verhalten

- Doppelte aufgelöste Pfade werden dedupliziert.
- Tool-Namenskonflikte werden gegenüber integrierten Tools und bereits geladenen benutzerdefinierten Tools abgelehnt.
- `.md`- und `.json`-Dateien werden von einigen Providern als Tool-Metadaten entdeckt, aber der ausführbare Modul-Loader lehnt sie als lauffähige Tools ab.
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
- `ui`: UI-Kontext (kann in headless-Modi ein No-Op sein)
- `hasUI`: `false` in nicht-interaktiven Abläufen
- `logger`: gemeinsamer Datei-Logger
- `typebox`: injiziertes `@sinclair/typebox`
- `pi`: injizierte `@f5xc-salesdemos/xcsh`-Exporte
- `pushPendingAction(action)`: registriert eine Vorschau-Aktion für das versteckte `resolve`-Tool (`docs/resolve-tool-runtime.md`)

Der Loader startet mit einem No-Op-UI-Kontext und erfordert, dass der Host-Code `setUIContext(...)` aufruft, wenn die echte UI bereit ist.

## Ausführungsvertrag und Typisierung

`CustomTool.execute`-Signatur:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` ist statisch typisiert aus Ihrem TypeBox-Schema via `Static<TParams>`.
- Die Laufzeit-Argumentvalidierung erfolgt vor der Ausführung in der Agent-Schleife.
- `onUpdate` sendet Teilergebnisse für UI-Streaming.
- `ctx` enthält Session-/Modellzustand und einen `abort()`-Helfer.
- `signal` überträgt die Abbruchsignalisierung.

`CustomToolAdapter` überbrückt dies zur Agent-Tool-Schnittstelle und leitet Aufrufe in der korrekten Argumentreihenfolge weiter.

## Wie Tools dem Modell bereitgestellt werden

- Tools werden in `AgentTool`-Instanzen eingebettet (`CustomToolAdapter` oder Extension-Wrapper).
- Sie werden nach Name in die Session-Tool-Registry eingefügt.
- Beim SDK-Bootstrap werden benutzerdefinierte und über Extensions registrierte Tools zwangsweise in das initiale aktive Set aufgenommen.
- CLI `--tools` validiert derzeit nur integrierte Tool-Namen; die Einbindung benutzerdefinierter Tools wird über Entdeckungs-/Registrierungspfade und SDK-Optionen gehandhabt.

## Rendering-Hooks

Optionale Rendering-Hooks:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

Laufzeitverhalten im TUI:

- Wenn Hooks existieren, wird die Tool-Ausgabe innerhalb eines `Box`-Containers gerendert.
- `renderResult` erhält `{ expanded, isPartial, spinnerFrame? }`.
- Renderer-Fehler werden abgefangen und protokolliert; die UI fällt auf Standard-Textrendering zurück.

## Session-/Zustandsbehandlung

Optionales `onSession(event, ctx)` empfängt Session-Lebenszyklus-Events, einschließlich:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

Verwenden Sie `ctx.sessionManager`, um den Zustand aus der Historie zu rekonstruieren, wenn sich der Branch-/Session-Kontext ändert.

## Fehler- und Abbruchsemantik

### Synchrone/asynchrone Fehler

- Das Werfen von Exceptions (oder abgelehnte Promises) in `execute` wird als Tool-Fehler behandelt.
- Die Agent-Laufzeit konvertiert Fehler in Tool-Ergebnisnachrichten mit `isError: true` und Fehlertext-Inhalt.
- Mit Extension-Wrappern können `tool_result`-Handler Inhalt/Details weiter umschreiben und sogar den Fehlerstatus überschreiben.

### Abbruch

- Der Agent-Abbruch wird über `AbortSignal` an `execute` weitergeleitet.
- Leiten Sie `signal` an Unterprozess-Arbeit weiter (`pi.exec(..., { signal })`) für kooperativen Abbruch.
- `ctx.abort()` ermöglicht es einem Tool, den Abbruch der aktuellen Agent-Operation anzufordern.

### onSession-Fehler

- `onSession`-Fehler werden abgefangen und als Warnungen protokolliert; sie führen nicht zum Absturz der Session.

## Reale Einschränkungen für das Design

- Tool-Namen müssen in der aktiven Registry global eindeutig sein.
- Bevorzugen Sie deterministische, schema-konforme Ausgaben in `details` für Renderer-/Zustandsrekonstruktion.
- Schützen Sie UI-Nutzung mit `pi.hasUI`.
- Behandeln Sie `.md`/`.json` in Tool-Verzeichnissen als Metadaten, nicht als ausführbare Module.
