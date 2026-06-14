---
title: Benutzerdefinierte Werkzeuge
description: >-
  Registrierung benutzerdefinierter Werkzeuge, Schemadefinition und
  Ausführungspipeline zur Erweiterung des Agenten.
sidebar:
  order: 4
  label: Benutzerdefinierte Werkzeuge
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# Benutzerdefinierte Werkzeuge

Benutzerdefinierte Werkzeuge sind modellaufrufbare Funktionen, die in dieselbe Werkzeugausführungspipeline wie integrierte Werkzeuge eingebunden werden.

Ein benutzerdefiniertes Werkzeug ist ein TypeScript/JavaScript-Modul, das eine Factory exportiert. Die Factory erhält eine Host-API (`CustomToolAPI`) und gibt ein Werkzeug oder ein Array von Werkzeugen zurück.

## Was dies ist (und was nicht)

- **Benutzerdefiniertes Werkzeug**: vom Modell während eines Durchlaufs aufrufbar (`execute` + TypeBox-Schema).
- **Erweiterung**: Lebenszyklus-/Ereignisframework, das Werkzeuge registrieren und Ereignisse abfangen/modifizieren kann.
- **Hook**: externe Pre/Post-Befehlsskripte.
- **Skill**: statisches Anleitungs-/Kontextpaket, kein ausführbarer Werkzeugcode.

Wenn das Modell Code direkt aufrufen soll, verwenden Sie ein benutzerdefiniertes Werkzeug.

## Integrationspfade im aktuellen Code

Es gibt zwei aktive Integrationsstile:

1. **SDK-bereitgestellte benutzerdefinierte Werkzeuge** (`options.customTools`)
   - Werden über `CustomToolAdapter` oder Erweiterungs-Wrapper in Agentenwerkzeuge eingebettet.
   - Immer im initialen aktiven Werkzeugsatz beim SDK-Bootstrap enthalten.

2. **Dateisystem-erkannte Module über Loader-API** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - Als Bibliotheks-APIs in `src/extensibility/custom-tools/loader.ts` verfügbar.
   - Host-Code kann diese aufrufen, um Werkzeugmodule aus Konfigurations-/Provider-/Plugin-Pfaden zu entdecken und zu laden.

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

## Erkennungsorte (Loader-API)

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` führt zusammen:

1. Fähigkeits-Provider (`toolCapability`), einschließlich:
   - Native OMP-Konfiguration (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Claude-Konfiguration (`~/.claude/tools`, `.claude/tools`)
   - Codex-Konfiguration (`~/.codex/tools`, `.codex/tools`)
   - Claude-Marktplatz-Plugin-Cache-Provider
2. Installierte Plugin-Manifeste (`~/.xcsh/plugins/node_modules/*` über Plugin-Loader)
3. Explizit konfigurierte Pfade, die an den Loader übergeben werden

### Wichtiges Verhalten

- Doppelt aufgelöste Pfade werden dedupliziert.
- Werkzeugnamenkonflikte werden gegen integrierte Werkzeuge und bereits geladene benutzerdefinierte Werkzeuge abgewiesen.
- `.md`- und `.json`-Dateien werden von einigen Providern als Werkzeugmetadaten erkannt, aber der ausführbare Modul-Loader lehnt sie als ausführbare Werkzeuge ab.
- Relative konfigurierte Pfade werden von `cwd` aufgelöst; `~` wird expandiert.

## Modulvertrag

Ein benutzerdefiniertes Werkzeugmodul muss eine Funktion exportieren (Standard-Export bevorzugt):

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

## An Factories übergebene API-Oberfläche (`CustomToolAPI`)

Aus `types.ts` und `loader.ts`:

- `cwd`: Arbeitsverzeichnis des Hosts
- `exec(command, args, options?)`: Prozessausführungs-Helfer
- `ui`: UI-Kontext (kann im Headless-Modus ein No-Op sein)
- `hasUI`: `false` in nicht-interaktiven Abläufen
- `logger`: gemeinsamer Datei-Logger
- `typebox`: injiziertes `@sinclair/typebox`
- `pi`: injizierte `@f5xc-salesdemos/xcsh`-Exporte
- `pushPendingAction(action)`: registriert eine Vorschauaktion für das versteckte `resolve`-Werkzeug (`docs/resolve-tool-runtime.md`)

Der Loader startet mit einem No-Op-UI-Kontext und erfordert, dass Host-Code `setUIContext(...)` aufruft, wenn die echte UI bereit ist.

## Ausführungsvertrag und Typisierung

`CustomTool.execute`-Signatur:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` ist statisch aus Ihrem TypeBox-Schema über `Static<TParams>` typisiert.
- Die Laufzeit-Argumentvalidierung erfolgt vor der Ausführung in der Agentenschleife.
- `onUpdate` gibt Teilergebnisse für UI-Streaming aus.
- `ctx` enthält den Sitzungs-/Modellstatus und einen `abort()`-Helfer.
- `signal` trägt die Abbruchinformation.

`CustomToolAdapter` verbindet dies mit der Agentenwerkzeug-Schnittstelle und leitet Aufrufe in der korrekten Argumentreihenfolge weiter.

## Wie Werkzeuge dem Modell bereitgestellt werden

- Werkzeuge werden in `AgentTool`-Instanzen eingebettet (`CustomToolAdapter` oder Erweiterungs-Wrapper).
- Sie werden namentlich in die Sitzungswerkzeugregistrierung eingefügt.
- Beim SDK-Bootstrap werden benutzerdefinierte und erweiterungsregistrierte Werkzeuge zwangsweise in den initialen aktiven Satz aufgenommen.
- CLI `--tools` validiert derzeit nur integrierte Werkzeugnamen; die Aufnahme benutzerdefinierter Werkzeuge erfolgt über Erkennungs-/Registrierungspfade und SDK-Optionen.

## Rendering-Hooks

Optionale Rendering-Hooks:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

Laufzeitverhalten in TUI:

- Wenn Hooks vorhanden sind, wird die Werkzeugausgabe in einem `Box`-Container gerendert.
- `renderResult` erhält `{ expanded, isPartial, spinnerFrame? }`.
- Renderer-Fehler werden abgefangen und protokolliert; die UI fällt auf Standard-Textrendering zurück.

## Sitzungs-/Zustandsbehandlung

Das optionale `onSession(event, ctx)` empfängt Sitzungslebenszyklus-Ereignisse, einschließlich:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

Verwenden Sie `ctx.sessionManager`, um den Zustand aus dem Verlauf zu rekonstruieren, wenn sich der Branch-/Sitzungskontext ändert.

## Fehler und Abbruchsemantik

### Synchrone/asynchrone Fehler

- Das Werfen (oder abgelehnte Promises) in `execute` wird als Werkzeugfehler behandelt.
- Die Agentenlaufzeit wandelt Fehler in Werkzeugergebnis-Nachrichten mit `isError: true` und Fehlertext-Inhalt um.
- Mit Erweiterungs-Wrappern können `tool_result`-Handler Inhalt/Details weiter umschreiben und sogar den Fehlerstatus überschreiben.

### Abbruch

- Der Agentenabbruch wird über `AbortSignal` an `execute` weitergegeben.
- Leiten Sie `signal` an Subprozessarbeiten weiter (`pi.exec(..., { signal })`), um kooperativen Abbruch zu ermöglichen.
- `ctx.abort()` ermöglicht es einem Werkzeug, den Abbruch der aktuellen Agentenoperation anzufordern.

### onSession-Fehler

- `onSession`-Fehler werden abgefangen und als Warnungen protokolliert; sie bringen die Sitzung nicht zum Absturz.

## Reale Einschränkungen beim Design

- Werkzeugnamen müssen in der aktiven Registrierung global eindeutig sein.
- Bevorzugen Sie deterministische, schemaförmige Ausgaben in `details` für Renderer-/Zustandsrekonstruktion.
- Schützen Sie UI-Nutzung mit `pi.hasUI`.
- Behandeln Sie `.md`-/`.json`-Dateien in Werkzeugverzeichnissen als Metadaten, nicht als ausführbare Module.
