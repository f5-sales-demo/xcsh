---
title: Componentes Internos do Runtime da Ferramenta Resolve
description: >-
  Runtime da ferramenta resolve para resolução de caminhos de arquivo, busca de
  conteúdo e acesso a recursos baseados em URL.
sidebar:
  order: 3
  label: Ferramenta Resolve
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# Componentes internos do runtime da ferramenta Resolve

Este documento explica como os fluxos de trabalho de pré-visualização/aplicação são modelados no coding-agent e como ferramentas personalizadas podem participar por meio de `pushPendingAction`.

## Escopo e arquivos principais

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## O que o `resolve` faz

`resolve` é uma ferramenta oculta que finaliza uma ação de pré-visualização pendente.

- `action: "apply"` executa `apply(reason)` na ação pendente e persiste as alterações.
- `action: "discard"` invoca `reject(reason)` se fornecido; caso contrário, descarta a ação com uma mensagem padrão "Discarded".

Se não houver nenhuma ação pendente, `resolve` falha com:

- `No pending action to resolve. Nothing to apply or discard.`

## Ações pendentes são uma pilha (LIFO)

As ações pendentes são armazenadas em `PendingActionStore` como uma pilha push/pop:

- `push(action)` adiciona uma nova ação pendente no topo.
- `peek()` inspeciona a ação atual no topo.
- `pop()` remove e retorna a ação do topo.
- `hasPending` indica se a pilha está não vazia.

`resolve` sempre consome a ação pendente **mais recente** primeiro (`pop()`), portanto múltiplas ferramentas que produzem pré-visualizações são resolvidas na ordem inversa de registro.

## Exemplo de produtor integrado (`ast_edit`)

`ast_edit` pré-visualiza substituições estruturais primeiro. Quando a pré-visualização possui substituições e ainda não foi aplicada, ela insere uma ação pendente que contém:

- label (resumo legível por humanos)
- `sourceToolName` (`ast_edit`)
- callback `apply(reason: string)` que reexecuta a edição AST com `dryRun: false`

`resolve(action="apply", reason="...")` passa `reason` para este callback.

## Ferramentas personalizadas: `pushPendingAction`

Ferramentas personalizadas podem registrar ações pendentes compatíveis com resolve por meio de `CustomToolAPI.pushPendingAction(...)`.

`CustomToolPendingAction`:

- `label: string` (obrigatório)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (obrigatório) — invocado na aplicação; `reason` é a string passada para `resolve`
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (opcional) — invocado no descarte; o valor de retorno substitui a mensagem padrão "Discarded" se fornecido
- `details?: unknown` (opcional)
- `sourceToolName?: string` (opcional, padrão: `"custom_tool"`)

### Exemplo de uso mínimo

```ts
import type { CustomToolFactory } from "@f5xc-salesdemos/xcsh";

const factory: CustomToolFactory = pi => ({
 name: "batch_rename_preview",
 label: "Batch Rename Preview",
 description: "Previews renames and defers commit to resolve",
 parameters: pi.typebox.Type.Object({
  files: pi.typebox.Type.Array(pi.typebox.Type.String()),
 }),

 async execute(_toolCallId, params) {
  const previewSummary = `Prepared rename plan for ${params.files.length} files`;

  pi.pushPendingAction({
   label: `Batch rename: ${params.files.length} files`,
   sourceToolName: "batch_rename_preview",
   apply: async (reason) => {
    // apply writes here
    return {
     content: [{ type: "text", text: `Applied batch rename. Reason: ${reason}` }],
    };
   },
   reject: async (reason) => {
    // optional: cleanup or notify on discard
    return {
     content: [{ type: "text", text: `Discarded batch rename. Reason: ${reason}` }],
    };
   },
  });

  return {
   content: [{ type: "text", text: `${previewSummary}. Call resolve to apply or discard.` }],
  };
 },
});

export default factory;
```

## Disponibilidade do runtime e falhas

`pushPendingAction` é conectado pelo carregador de ferramentas personalizadas usando o `PendingActionStore` da sessão ativa.

Se o runtime não tiver um armazenamento de ações pendentes, `pushPendingAction` lança:

- `Pending action store unavailable for custom tools in this runtime.`

## Comportamento de seleção de ferramenta

Quando `PendingActionStore.hasPending` é verdadeiro, o runtime do agente direciona a seleção de ferramenta para `resolve`, de modo que as pré-visualizações pendentes sejam explicitamente finalizadas antes que o fluxo normal de ferramentas continue.

## Orientações para desenvolvedores

- Utilize ações pendentes apenas para operações destrutivas ou de alto impacto que devem suportar aplicação/descarte explícitos.
- Mantenha `label` conciso e específico; ele é exibido na saída do renderizador de resolve.
- Certifique-se de que `apply(reason)` seja determinístico e suficientemente idempotente para execução única; `reason` é informativo e não deve alterar o comportamento.
- Implemente `reject(reason)` quando o descarte necessitar de limpeza (estado temporário, bloqueios, notificações); omita-o para pré-visualizações sem estado em que a mensagem padrão seja suficiente.
- Se sua ferramenta puder enfileirar múltiplas pré-visualizações, lembre-se da semântica LIFO: a ação inserida mais recentemente é resolvida primeiro.
