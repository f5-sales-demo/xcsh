---
title: Integración TUI para extensiones y herramientas personalizadas
description: >-
  Contrato de integración TUI para extensiones, herramientas personalizadas y
  renderizadores personalizados.
sidebar:
  order: 1
  label: Integración de extensiones
i18n:
  sourceHash: 966be66eee07
  translator: machine
---

# Integración TUI para extensiones y herramientas personalizadas

Este documento cubre el contrato TUI **actual** utilizado por `packages/coding-agent` y `packages/tui` para la interfaz de extensiones, la interfaz de herramientas personalizadas y los renderizadores personalizados.

## Qué es este subsistema

El entorno de ejecución tiene dos capas:

- **Motor de renderizado (`packages/tui`)**: renderizador diferencial de terminal, despacho de entrada, foco, superposiciones, posicionamiento del cursor.
- **Capa de integración (`packages/coding-agent`)**: monta los componentes de extensiones/herramientas personalizadas, conecta las asociaciones de teclas/tema y restaura el estado del editor.

## Comportamiento del entorno de ejecución por modo

| Modo | Disponibilidad de `ctx.ui.custom(...)` | Notas |
| --- | --- | --- |
| TUI interactivo | Soportado | El componente se monta en el área del editor, recibe el foco y debe llamar a `done(result)` para resolver. |
| En segundo plano/sin interfaz | No interactivo | El contexto de UI es no-op (`hasUI === false`). |
| Modo RPC | No soportado | `custom()` devuelve `Promise<never>` y no monta componentes TUI. |

Si su extensión/herramienta puede ejecutarse en modo no interactivo, proteja con `ctx.hasUI` / `pi.hasUI`.

## Contrato principal del componente (`@f5-sales-demo/pi-tui`)

`packages/tui/src/tui.ts` define:

```ts
export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

`Focusable` es independiente:

```ts
export interface Focusable {
  focused: boolean;
}
```

El comportamiento del cursor usa `CURSOR_MARKER` (no `getCursorPosition`). Los componentes con foco emiten el marcador en el texto renderizado; `TUI` lo extrae y posiciona el cursor de hardware.

## Restricciones de renderizado (seguridad de terminal)

La salida de su `render(width)` debe ser segura para la terminal:

1. **Nunca exceda `width` en ninguna línea**. El renderizador lanza un error si una línea que no es imagen desborda.
2. **Mida el ancho visual**, no la longitud de la cadena: use `visibleWidth()`.
3. **Trunque/ajuste texto compatible con ANSI** con `truncateToWidth()` / `wrapTextWithAnsi()`.
4. **Sanitice tabulaciones/contenido** de fuentes externas usando `replaceTabs()` (y sanitizadores de nivel superior en las rutas de renderizado de coding-agent).

Patrón mínimo:

```ts
import { replaceTabs, truncateToWidth } from "@f5-sales-demo/pi-tui";

render(width: number): string[] {
  return this.lines.map(line => truncateToWidth(replaceTabs(line), width));
}
```

## Manejo de entrada y asociaciones de teclas

### Coincidencia de teclas sin procesar

Use `matchesKey(data, "...")` para teclas de navegación y combinaciones.

### Respete las asociaciones de teclas configuradas por el usuario

Las fábricas de UI de extensiones reciben un `KeybindingsManager` (modo interactivo) para que pueda respetar las acciones mapeadas en lugar de codificar teclas de forma fija:

```ts
if (keybindings.matches(data, "interrupt")) {
  done(undefined);
  return;
}
```

### Eventos de liberación/repetición de teclas

Los eventos de liberación de teclas se filtran a menos que su componente establezca:

```ts
wantsKeyRelease = true;
```

Luego use `isKeyRelease()` / `isKeyRepeat()` si es necesario.

## Foco, superposiciones y cursor

- `TUI.setFocus(component)` dirige la entrada a ese componente.
- Las APIs de superposición existen en `TUI` (`showOverlay`, `OverlayHandle`), pero el montaje de `ctx.ui.custom` de extensiones en modo interactivo actualmente reemplaza directamente el área del componente del editor.
- La opción `custom(..., options?: { overlay?: boolean })` existe en los tipos de extensión; el montaje interactivo de extensiones actualmente ignora esta opción.

## Puntos de montaje y contratos de retorno

## 1) UI de extensión (`ExtensionUIContext`)

Firma actual (`extensibility/extensions/types.ts`):

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

Comportamiento en modo interactivo (`extension-ui-controller.ts`):

- Guarda el texto del editor.
- Reemplaza el componente del editor con su componente.
- Enfoca su componente.
- Al llamar `done(result)`: ejecuta `component.dispose?.()`, restaura el editor + texto, enfoca el editor, resuelve la promesa.

Por lo tanto, `done(...)` es obligatorio para la finalización.

## 2) Contexto de UI de hooks/herramientas personalizadas (tipado legacy)

`HookUIContext.custom` está tipado como `(tui, theme, done)` en los tipos de hooks/herramientas personalizadas.
La implementación interactiva subyacente llama a las fábricas con `(tui, theme, keybindings, done)`. Los consumidores JS pueden usar el argumento adicional; la compatibilidad a nivel de tipos aún refleja la firma legacy de 3 argumentos.

Las herramientas personalizadas típicamente usan el mismo punto de entrada de UI a través del objeto `pi.ui` del ámbito de la fábrica, y luego devuelven el valor seleccionado en el contenido normal de la herramienta:

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

## 3) Renderizadores personalizados de llamadas/resultados de herramientas

Las herramientas personalizadas y las herramientas de extensión pueden devolver componentes desde:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

`options` actualmente incluye:

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

Estos renderizadores son montados por `ToolExecutionComponent`.

## Ciclo de vida y cancelación

- `dispose()` es opcional a nivel de tipos pero debe implementarse cuando posea temporizadores, subprocesos, observadores, sockets o superposiciones.
- `done(...)` debe llamarse exactamente una vez desde el flujo de su componente.
- Para UI de larga duración cancelable, combine `CancellableLoader` con `AbortSignal` y llame a `done(...)` desde `onAbort`.

Ejemplo de patrón de cancelación:

```ts
const loader = new CancellableLoader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
loader.onAbort = () => done(undefined);
void doWork(loader.signal).then(result => done(result));
return loader;
```

## Ejemplo realista de componente personalizado (comando de extensión)

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

## Archivos de implementación clave

- `packages/tui/src/tui.ts` — `Component`, `Focusable`, marcador de cursor, foco, superposición, despacho de entrada.
- `packages/tui/src/utils.ts` — primitivas de ancho/truncamiento/sanitización.
- `packages/tui/src/keys.ts` / `keybindings.ts` — análisis de teclas y mapeo de acciones configurables.
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — montaje/desmontaje interactivo para UI de extensiones/hooks/herramientas personalizadas.
- `packages/coding-agent/src/extensibility/extensions/types.ts` — contratos de UI y renderizadores de extensiones.
- `packages/coding-agent/src/extensibility/hooks/types.ts` — contrato de UI de hooks (firma custom legacy).
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — contratos de ejecución/renderizado de herramientas personalizadas.
- `packages/coding-agent/src/modes/components/tool-execution.ts` — montaje de componentes `renderCall`/`renderResult` y opciones de estado parcial.
- `packages/coding-agent/src/tools/context.ts` — propagación del contexto de UI de herramientas (`hasUI`, `ui`).
