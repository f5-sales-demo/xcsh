---
title: Integração TUI para Extensões e Ferramentas Personalizadas
description: >-
  Contrato de integração TUI para extensões, ferramentas personalizadas e
  renderizadores personalizados.
sidebar:
  order: 1
  label: Integração de extensões
i18n:
  sourceHash: 966be66eee07
  translator: machine
---

# Integração TUI para extensões e ferramentas personalizadas

Este documento cobre o contrato TUI **atual** utilizado por `packages/coding-agent` e `packages/tui` para UI de extensões, UI de ferramentas personalizadas e renderizadores personalizados.

## O que é este subsistema

O runtime possui duas camadas:

- **Motor de renderização (`packages/tui`)**: renderizador diferencial de terminal, despacho de entrada, foco, overlays, posicionamento de cursor.
- **Camada de integração (`packages/coding-agent`)**: monta componentes de extensão/ferramenta personalizada, conecta keybindings/tema e restaura o estado do editor.

## Comportamento do runtime por modo

| Modo | Disponibilidade de `ctx.ui.custom(...)` | Notas |
| --- | --- | --- |
| TUI Interativo | Suportado | O componente é montado na área do editor, recebe foco e deve chamar `done(result)` para resolver. |
| Background/headless | Não interativo | O contexto de UI é no-op (`hasUI === false`). |
| Modo RPC | Não suportado | `custom()` retorna `Promise<never>` e não monta componentes TUI. |

Se sua extensão/ferramenta pode executar em modo não interativo, proteja com `ctx.hasUI` / `pi.hasUI`.

## Contrato principal de componente (`@f5xc-salesdemos/pi-tui`)

`packages/tui/src/tui.ts` define:

```ts
export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

`Focusable` é separado:

```ts
export interface Focusable {
  focused: boolean;
}
```

O comportamento do cursor utiliza `CURSOR_MARKER` (não `getCursorPosition`). Componentes com foco emitem o marcador no texto renderizado; o `TUI` o extrai e posiciona o cursor de hardware.

## Restrições de renderização (segurança de terminal)

A saída do seu `render(width)` deve ser segura para terminal:

1. **Nunca exceda `width` em nenhuma linha**. O renderizador lança uma exceção se uma linha que não é imagem ultrapassar o limite.
2. **Meça a largura visual**, não o comprimento da string: use `visibleWidth()`.
3. **Trunque/quebre texto com reconhecimento ANSI** com `truncateToWidth()` / `wrapTextWithAnsi()`.
4. **Sanitize tabs/conteúdo** de fontes externas usando `replaceTabs()` (e sanitizadores de nível superior nos caminhos de renderização do coding-agent).

Padrão mínimo:

```ts
import { replaceTabs, truncateToWidth } from "@f5xc-salesdemos/pi-tui";

render(width: number): string[] {
  return this.lines.map(line => truncateToWidth(replaceTabs(line), width));
}
```

## Tratamento de entrada e keybindings

### Correspondência de tecla bruta

Use `matchesKey(data, "...")` para teclas de navegação e combinações.

### Respeite os keybindings de aplicação configurados pelo usuário

Fábricas de UI de extensão recebem um `KeybindingsManager` (modo interativo) para que você possa honrar ações mapeadas em vez de codificar teclas fixas:

```ts
if (keybindings.matches(data, "interrupt")) {
  done(undefined);
  return;
}
```

### Eventos de liberação/repetição de tecla

Eventos de liberação de tecla são filtrados a menos que seu componente defina:

```ts
wantsKeyRelease = true;
```

Então use `isKeyRelease()` / `isKeyRepeat()` se necessário.

## Foco, overlays e cursor

- `TUI.setFocus(component)` direciona a entrada para aquele componente.
- APIs de overlay existem no `TUI` (`showOverlay`, `OverlayHandle`), mas a montagem de `ctx.ui.custom` de extensão no modo interativo atualmente substitui diretamente a área do componente do editor.
- A opção `custom(..., options?: { overlay?: boolean })` existe nos tipos de extensão; a montagem interativa de extensão atualmente ignora esta opção.

## Pontos de montagem e contratos de retorno

## 1) UI de extensão (`ExtensionUIContext`)

Assinatura atual (`extensibility/extensions/types.ts`):

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

Comportamento no modo interativo (`extension-ui-controller.ts`):

- Salva o texto do editor.
- Substitui o componente do editor pelo seu componente.
- Foca no seu componente.
- Ao chamar `done(result)`: chama `component.dispose?.()`, restaura editor + texto, foca no editor, resolve a promise.

Portanto, `done(...)` é obrigatório para conclusão.

## 2) Contexto de UI de hook/ferramenta personalizada (tipagem legada)

`HookUIContext.custom` é tipado como `(tui, theme, done)` nos tipos de hook/ferramenta personalizada.
A implementação interativa subjacente chama fábricas com `(tui, theme, keybindings, done)`. Consumidores JS podem usar o argumento extra; a compatibilidade em nível de tipo ainda reflete a assinatura legada de 3 argumentos.

Ferramentas personalizadas tipicamente usam o mesmo ponto de entrada de UI via o objeto `pi.ui` com escopo de fábrica, então retornam o valor selecionado no conteúdo normal da ferramenta:

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

## 3) Renderizadores personalizados de chamada/resultado de ferramenta

Ferramentas personalizadas e ferramentas de extensão podem retornar componentes de:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

`options` atualmente inclui:

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

Esses renderizadores são montados por `ToolExecutionComponent`.

## Ciclo de vida e cancelamento

- `dispose()` é opcional em nível de tipo, mas deve ser implementado quando você possui timers, subprocessos, watchers, sockets ou overlays.
- `done(...)` deve ser chamado exatamente uma vez no fluxo do seu componente.
- Para UI de longa duração cancelável, combine `CancellableLoader` com `AbortSignal` e chame `done(...)` a partir de `onAbort`.

Exemplo de padrão de cancelamento:

```ts
const loader = new CancellableLoader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
loader.onAbort = () => done(undefined);
void doWork(loader.signal).then(result => done(result));
return loader;
```

## Exemplo realista de componente personalizado (comando de extensão)

```ts
import type { Component } from "@f5xc-salesdemos/pi-tui";
import { SelectList, matchesKey, replaceTabs, truncateToWidth } from "@f5xc-salesdemos/pi-tui";
import { getSelectListTheme, type ExtensionAPI } from "@f5xc-salesdemos/xcsh";

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

## Arquivos-chave de implementação

- `packages/tui/src/tui.ts` — `Component`, `Focusable`, marcador de cursor, foco, overlay, despacho de entrada.
- `packages/tui/src/utils.ts` — primitivas de largura/truncamento/sanitização.
- `packages/tui/src/keys.ts` / `keybindings.ts` — análise de teclas e mapeamento configurável de ações.
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — montagem/desmontagem interativa para UI de extensão/hook/ferramenta personalizada.
- `packages/coding-agent/src/extensibility/extensions/types.ts` — contratos de UI e renderizadores de extensão.
- `packages/coding-agent/src/extensibility/hooks/types.ts` — contrato de UI de hook (assinatura custom legada).
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — contratos de execução/renderização de ferramentas personalizadas.
- `packages/coding-agent/src/modes/components/tool-execution.ts` — montagem de componentes `renderCall`/`renderResult` e opções de estado parcial.
- `packages/coding-agent/src/tools/context.ts` — propagação do contexto de UI da ferramenta (`hasUI`, `ui`).
