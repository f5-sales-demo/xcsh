---
title: Integrazione TUI per estensioni e strumenti personalizzati
description: >-
  Contratto di integrazione TUI per estensioni, strumenti personalizzati e
  renderer personalizzati.
sidebar:
  order: 1
  label: Integrazione estensioni
i18n:
  sourceHash: 966be66eee07
  translator: machine
---

# Integrazione TUI per estensioni e strumenti personalizzati

Questo documento tratta il contratto TUI **attuale** utilizzato da `packages/coding-agent` e `packages/tui` per l'interfaccia utente delle estensioni, l'interfaccia utente degli strumenti personalizzati e i renderer personalizzati.

## Cos'è questo sottosistema

Il runtime ha due livelli:

- **Motore di rendering (`packages/tui`)**: renderer terminale differenziale, dispatch degli input, focus, overlay, posizionamento del cursore.
- **Livello di integrazione (`packages/coding-agent`)**: monta i componenti di estensioni/strumenti personalizzati, collega le associazioni di tasti/tema e ripristina lo stato dell'editor.

## Comportamento del runtime per modalità

| Modalità | Disponibilità di `ctx.ui.custom(...)` | Note |
| --- | --- | --- |
| TUI interattiva | Supportata | Il componente viene montato nell'area dell'editor, riceve il focus e deve chiamare `done(result)` per risolvere. |
| Background/headless | Non interattiva | Il contesto UI è no-op (`hasUI === false`). |
| Modalità RPC | Non supportata | `custom()` restituisce `Promise<never>` e non monta componenti TUI. |

Se la vostra estensione/strumento può funzionare in modalità non interattiva, verificate con `ctx.hasUI` / `pi.hasUI`.

## Contratto del componente principale (`@f5-sales-demo/pi-tui`)

`packages/tui/src/tui.ts` definisce:

```ts
export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

`Focusable` è separato:

```ts
export interface Focusable {
  focused: boolean;
}
```

Il comportamento del cursore utilizza `CURSOR_MARKER` (non `getCursorPosition`). I componenti con focus emettono il marker nel testo renderizzato; `TUI` lo estrae e posiziona il cursore hardware.

## Vincoli di rendering (sicurezza terminale)

L'output di `render(width)` deve essere sicuro per il terminale:

1. **Non superare mai `width` su nessuna riga**. Il renderer lancia un errore se una riga non-immagine eccede la larghezza.
2. **Misurare la larghezza visiva**, non la lunghezza della stringa: utilizzare `visibleWidth()`.
3. **Troncare/mandare a capo testo con consapevolezza ANSI** con `truncateToWidth()` / `wrapTextWithAnsi()`.
4. **Sanitizzare tabulazioni/contenuto** da fonti esterne utilizzando `replaceTabs()` (e sanitizzatori di livello superiore nei percorsi di rendering di coding-agent).

Pattern minimale:

```ts
import { replaceTabs, truncateToWidth } from "@f5-sales-demo/pi-tui";

render(width: number): string[] {
  return this.lines.map(line => truncateToWidth(replaceTabs(line), width));
}
```

## Gestione degli input e associazioni di tasti

### Corrispondenza diretta dei tasti

Utilizzare `matchesKey(data, "...")` per i tasti di navigazione e le combinazioni.

### Rispettare le associazioni di tasti dell'applicazione configurate dall'utente

Le factory dell'interfaccia utente delle estensioni ricevono un `KeybindingsManager` (in modalità interattiva) così potete rispettare le azioni mappate invece di codificare i tasti direttamente:

```ts
if (keybindings.matches(data, "interrupt")) {
  done(undefined);
  return;
}
```

### Eventi di rilascio/ripetizione dei tasti

Gli eventi di rilascio dei tasti vengono filtrati a meno che il vostro componente non imposti:

```ts
wantsKeyRelease = true;
```

Quindi utilizzate `isKeyRelease()` / `isKeyRepeat()` se necessario.

## Focus, overlay e cursore

- `TUI.setFocus(component)` indirizza l'input verso quel componente.
- Le API per gli overlay esistono in `TUI` (`showOverlay`, `OverlayHandle`), ma il montaggio di `ctx.ui.custom` delle estensioni in modalità interattiva attualmente sostituisce direttamente l'area del componente editor.
- L'opzione `custom(..., options?: { overlay?: boolean })` esiste nei tipi delle estensioni; il montaggio interattivo delle estensioni attualmente ignora questa opzione.

## Punti di montaggio e contratti di ritorno

## 1) Interfaccia utente delle estensioni (`ExtensionUIContext`)

Firma attuale (`extensibility/extensions/types.ts`):

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

Comportamento in modalità interattiva (`extension-ui-controller.ts`):

- Salva il testo dell'editor.
- Sostituisce il componente editor con il vostro componente.
- Assegna il focus al vostro componente.
- Al `done(result)`: chiama `component.dispose?.()`, ripristina l'editor + il testo, assegna il focus all'editor, risolve la promise.

Quindi `done(...)` è obbligatorio per il completamento.

## 2) Contesto UI per hook/strumenti personalizzati (tipizzazione legacy)

`HookUIContext.custom` è tipizzato come `(tui, theme, done)` nei tipi di hook/strumenti personalizzati.
L'implementazione interattiva sottostante chiama le factory con `(tui, theme, keybindings, done)`. I consumatori JS possono utilizzare l'argomento aggiuntivo; la compatibilità a livello di tipo riflette ancora la firma legacy a 3 argomenti.

Gli strumenti personalizzati tipicamente utilizzano lo stesso punto di accesso UI tramite l'oggetto `pi.ui` nell'ambito della factory, quindi restituiscono il valore selezionato nel contenuto normale dello strumento:

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

## 3) Renderer personalizzati per chiamate/risultati degli strumenti

Gli strumenti personalizzati e gli strumenti delle estensioni possono restituire componenti da:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

`options` attualmente include:

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

Questi renderer vengono montati da `ToolExecutionComponent`.

## Ciclo di vita e cancellazione

- `dispose()` è opzionale a livello di tipo ma dovrebbe essere implementato quando si possiedono timer, sottoprocessi, watcher, socket o overlay.
- `done(...)` dovrebbe essere chiamato esattamente una volta dal flusso del vostro componente.
- Per interfacce utente a lunga esecuzione cancellabili, abbinate `CancellableLoader` con `AbortSignal` e chiamate `done(...)` da `onAbort`.

Esempio di pattern di cancellazione:

```ts
const loader = new CancellableLoader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
loader.onAbort = () => done(undefined);
void doWork(loader.signal).then(result => done(result));
return loader;
```

## Esempio realistico di componente personalizzato (comando di estensione)

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

## File di implementazione principali

- `packages/tui/src/tui.ts` — `Component`, `Focusable`, marker del cursore, focus, overlay, dispatch degli input.
- `packages/tui/src/utils.ts` — primitive per larghezza/troncamento/sanitizzazione.
- `packages/tui/src/keys.ts` / `keybindings.ts` — parsing dei tasti e mappatura configurabile delle azioni.
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — montaggio/smontaggio interattivo per l'interfaccia utente di estensioni/hook/strumenti personalizzati.
- `packages/coding-agent/src/extensibility/extensions/types.ts` — contratti per l'interfaccia utente e i renderer delle estensioni.
- `packages/coding-agent/src/extensibility/hooks/types.ts` — contratto UI per gli hook (firma custom legacy).
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — contratti di esecuzione/rendering per strumenti personalizzati.
- `packages/coding-agent/src/modes/components/tool-execution.ts` — montaggio dei componenti `renderCall`/`renderResult` e opzioni per stato parziale.
- `packages/coding-agent/src/tools/context.ts` — propagazione del contesto UI degli strumenti (`hasUI`, `ui`).
