---
title: TUI-Integration für Erweiterungen und benutzerdefinierte Tools
description: >-
  TUI-Integrationsvertrag für Erweiterungen, benutzerdefinierte Tools und
  benutzerdefinierte Renderer.
sidebar:
  order: 1
  label: Erweiterungsintegration
i18n:
  sourceHash: 966be66eee07
  translator: machine
---

# TUI-Integration für Erweiterungen und benutzerdefinierte Tools

Dieses Dokument behandelt den **aktuellen** TUI-Vertrag, der von `packages/coding-agent` und `packages/tui` für Erweiterungs-UI, benutzerdefinierte Tool-UI und benutzerdefinierte Renderer verwendet wird.

## Was dieses Subsystem ist

Die Laufzeitumgebung hat zwei Schichten:

- **Rendering-Engine (`packages/tui`)**: differenzieller Terminal-Renderer, Eingabeverteilung, Fokus, Overlays, Cursorplatzierung.
- **Integrationsschicht (`packages/coding-agent`)**: bindet Erweiterungs-/benutzerdefinierte-Tool-Komponenten ein, verbindet Tastenkürzel/Theme und stellt den Editor-Zustand wieder her.

## Laufzeitverhalten nach Modus

| Modus | Verfügbarkeit von `ctx.ui.custom(...)` | Hinweise |
| --- | --- | --- |
| Interaktive TUI | Unterstützt | Die Komponente wird im Editor-Bereich eingebunden, fokussiert und muss `done(result)` aufrufen, um aufzulösen. |
| Hintergrund/Headless | Nicht interaktiv | UI-Kontext ist ein No-Op (`hasUI === false`). |
| RPC-Modus | Nicht unterstützt | `custom()` gibt `Promise<never>` zurück und bindet keine TUI-Komponenten ein. |

Wenn Ihre Erweiterung/Ihr Tool im nicht-interaktiven Modus laufen kann, prüfen Sie mit `ctx.hasUI` / `pi.hasUI`.

## Kern-Komponentenvertrag (`@f5-sales-demo/pi-tui`)

`packages/tui/src/tui.ts` definiert:

```ts
export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

`Focusable` ist separat:

```ts
export interface Focusable {
  focused: boolean;
}
```

Das Cursorverhalten verwendet `CURSOR_MARKER` (nicht `getCursorPosition`). Fokussierte Komponenten geben den Marker im gerenderten Text aus; `TUI` extrahiert ihn und positioniert den Hardware-Cursor.

## Rendering-Einschränkungen (Terminal-Sicherheit)

Ihre `render(width)`-Ausgabe muss terminal-sicher sein:

1. **Überschreiten Sie niemals `width` in einer Zeile**. Der Renderer wirft einen Fehler, wenn eine Nicht-Bild-Zeile überläuft.
2. **Messen Sie die visuelle Breite**, nicht die String-Länge: verwenden Sie `visibleWidth()`.
3. **Kürzen/umbrechen Sie ANSI-bewussten Text** mit `truncateToWidth()` / `wrapTextWithAnsi()`.
4. **Bereinigen Sie Tabs/Inhalte** aus externen Quellen mit `replaceTabs()` (und übergeordneten Bereinigungsfunktionen in den Render-Pfaden von coding-agent).

Minimales Muster:

```ts
import { replaceTabs, truncateToWidth } from "@f5-sales-demo/pi-tui";

render(width: number): string[] {
  return this.lines.map(line => truncateToWidth(replaceTabs(line), width));
}
```

## Eingabeverarbeitung und Tastenkürzel

### Rohe Tastenerkennung

Verwenden Sie `matchesKey(data, "...")` für Navigationstasten und Kombinationen.

### Benutzer-konfigurierte App-Tastenkürzel beachten

Erweiterungs-UI-Factories erhalten einen `KeybindingsManager` (interaktiver Modus), damit Sie zugeordnete Aktionen statt hartcodierter Tasten verwenden können:

```ts
if (keybindings.matches(data, "interrupt")) {
  done(undefined);
  return;
}
```

### Tastenfreigabe-/Wiederholungsereignisse

Tastenfreigabe-Ereignisse werden gefiltert, es sei denn, Ihre Komponente setzt:

```ts
wantsKeyRelease = true;
```

Verwenden Sie dann bei Bedarf `isKeyRelease()` / `isKeyRepeat()`.

## Fokus, Overlays und Cursor

- `TUI.setFocus(component)` leitet Eingaben an diese Komponente weiter.
- Overlay-APIs existieren in `TUI` (`showOverlay`, `OverlayHandle`), aber die Einbindung über `ctx.ui.custom` einer Erweiterung im interaktiven Modus ersetzt derzeit direkt den Editor-Komponentenbereich.
- Die Option `custom(..., options?: { overlay?: boolean })` existiert in Erweiterungstypen; die interaktive Erweiterungseinbindung ignoriert diese Option derzeit.

## Einbindungspunkte und Rückgabeverträge

## 1) Erweiterungs-UI (`ExtensionUIContext`)

Aktuelle Signatur (`extensibility/extensions/types.ts`):

```ts
custom<T>(
  factory: (
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result: T) => void,
  ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
  options?: { overlay?: boolean },
): Promise<T>
```

Verhalten im interaktiven Modus (`extension-ui-controller.ts`):

- Speichert den Editor-Text.
- Ersetzt die Editor-Komponente durch Ihre Komponente.
- Fokussiert Ihre Komponente.
- Bei `done(result)`: ruft `component.dispose?.()` auf, stellt Editor + Text wieder her, fokussiert den Editor, löst das Promise auf.

Daher ist `done(...)` für die Fertigstellung zwingend erforderlich.

## 2) Hook/Custom-Tool-UI-Kontext (Legacy-Typisierung)

`HookUIContext.custom` ist in Hook/Custom-Tool-Typen als `(tui, theme, done)` typisiert.
Die zugrunde liegende interaktive Implementierung ruft Factories mit `(tui, theme, keybindings, done)` auf. JS-Konsumenten können das zusätzliche Argument verwenden; die Typebene-Kompatibilität spiegelt weiterhin die 3-Argument-Legacy-Signatur wider.

Benutzerdefinierte Tools verwenden typischerweise denselben UI-Einstiegspunkt über das factory-bezogene `pi.ui`-Objekt und geben dann den ausgewählten Wert im normalen Tool-Inhalt zurück:

```ts
async execute(toolCallId, params, onUpdate, ctx, signal) {
  if (!pi.hasUI) {
    return { content: [{ type: "text", text: "UI unavailable" }] };
  }

  const picked = await pi.ui.custom<string | undefined>((tui, theme, done) => {
    const component = new MyPickerComponent(done, signal);
    return component;
  });

  return { content: [{ type: "text", text: picked ? `Picked: ${picked}` : "Cancelled" }] };
}
```

## 3) Benutzerdefinierte Tool-Aufruf-/Ergebnis-Renderer

Benutzerdefinierte Tools und Erweiterungstools können Komponenten zurückgeben von:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

`options` enthält derzeit:

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

Diese Renderer werden von `ToolExecutionComponent` eingebunden.

## Lebenszyklus und Abbruch

- `dispose()` ist auf Typebene optional, sollte aber implementiert werden, wenn Sie Timer, Unterprozesse, Watcher, Sockets oder Overlays besitzen.
- `done(...)` sollte genau einmal aus Ihrem Komponentenfluss aufgerufen werden.
- Für abbrechbare, langlebige UI kombinieren Sie `CancellableLoader` mit `AbortSignal` und rufen `done(...)` von `onAbort` auf.

Beispiel für ein Abbruchmuster:

```ts
const loader = new CancellableLoader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
loader.onAbort = () => done(undefined);
void doWork(loader.signal).then(result => done(result));
return loader;
```

## Realistisches Beispiel einer benutzerdefinierten Komponente (Erweiterungsbefehl)

```ts
import type { Component } from "@f5-sales-demo/pi-tui";
import { SelectList, matchesKey, replaceTabs, truncateToWidth } from "@f5-sales-demo/pi-tui";
import { getSelectListTheme, type ExtensionAPI } from "@f5-sales-demo/xcsh";

class Picker implements Component {
  list: SelectList;
  keybindings: any;
  done: (value: string | undefined) => void;

  constructor(
    items: Array<{ value: string; label: string }>,
    keybindings: any,
    done: (value: string | undefined) => void,
  ) {
    this.list = new SelectList(items, 8, getSelectListTheme());
    this.keybindings = keybindings;
    this.done = done;
    this.list.onSelect = item => this.done(item.value);
    this.list.onCancel = () => this.done(undefined);
  }

  handleInput(data: string): void {
    if (this.keybindings.matches(data, "interrupt")) {
      this.done(undefined);
      return;
    }
    this.list.handleInput(data);
  }

  render(width: number): string[] {
    return this.list.render(width).map(line => truncateToWidth(replaceTabs(line), width));
  }

  invalidate(): void {
    this.list.invalidate();
  }
}

export default function extension(pi: ExtensionAPI): void {
  pi.registerCommand("pick-model", {
    description: "Pick a model profile",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;

      const selected = await ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
        const items = [
          { value: "fast", label: theme.fg("accent", "Fast") },
          { value: "balanced", label: "Balanced" },
          { value: "quality", label: "Quality" },
        ];
        return new Picker(items, keybindings, done);
      });

      if (selected) ctx.ui.notify(`Selected profile: ${selected}`, "info");
    },
  });
}
```

## Wichtige Implementierungsdateien

- `packages/tui/src/tui.ts` — `Component`, `Focusable`, Cursor-Marker, Fokus, Overlay, Eingabeverteilung.
- `packages/tui/src/utils.ts` — Breiten-/Kürzungs-/Bereinigungsprimitive.
- `packages/tui/src/keys.ts` / `keybindings.ts` — Tastenanalyse und konfigurierbare Aktionszuordnung.
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — interaktive Ein-/Ausbindung für Erweiterungs-/Hook-/Custom-Tool-UI.
- `packages/coding-agent/src/extensibility/extensions/types.ts` — Erweiterungs-UI- und Renderer-Verträge.
- `packages/coding-agent/src/extensibility/hooks/types.ts` — Hook-UI-Vertrag (Legacy-Custom-Signatur).
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — Verträge für Ausführung/Rendering benutzerdefinierter Tools.
- `packages/coding-agent/src/modes/components/tool-execution.ts` — Einbindung von `renderCall`/`renderResult`-Komponenten und Partial-State-Optionen.
- `packages/coding-agent/src/tools/context.ts` — Tool-UI-Kontextpropagierung (`hasUI`, `ui`).
