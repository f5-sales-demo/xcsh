---
title: Ciclo de Vida da Injeção TTSR
description: >-
  Ciclo de vida da injeção TTSR (tool-use, tool-result, system-reminder) para
  gerenciamento de contexto.
sidebar:
  order: 9
  label: Injeção TTSR
i18n:
  sourceHash: d6179a286584
  translator: machine
---

# Ciclo de Vida da Injeção TTSR

Este documento abrange o caminho de execução atual do Time Traveling Stream Rules (TTSR), desde a descoberta de regras até a interrupção de stream, injeção de retry, notificações de extensão e gerenciamento de estado de sessão.

## Arquivos de implementação

- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/export/ttsr.ts`](../../packages/coding-agent/src/export/ttsr.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/prompts/system/ttsr-interrupt.md`](../../packages/coding-agent/src/prompts/system/ttsr-interrupt.md)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/types.ts`](../../packages/coding-agent/src/extensibility/extensions/types.ts)
- [`../src/extensibility/hooks/types.ts`](../../packages/coding-agent/src/extensibility/hooks/types.ts)
- [`../src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)

## 1. Feed de descoberta e registro de regras

Na criação da sessão, `createAgentSession()` carrega todas as regras descobertas e constrói um `TtsrManager`:

```ts
const ttsrSettings = settings.getGroup("ttsr");
const ttsrManager = new TtsrManager(ttsrSettings);
const rulesResult = await loadCapability<Rule>(ruleCapability.id, { cwd });
for (const rule of rulesResult.items) {
  if (rule.ttsrTrigger) ttsrManager.addRule(rule);
}
```

### Comportamento de deduplicação no pré-registro

`loadCapability("rules")` deduplica por `rule.name` com semântica de primeiro-vence (prioridade mais alta do provedor primeiro). Duplicatas sombreadas são removidas antes do registro TTSR.

### Comportamento de `TtsrManager.addRule()`

O registro é ignorado quando:

- `rule.ttsrTrigger` está ausente
- uma regra com o mesmo `rule.name` já foi registrada neste manager
- a regex falha ao compilar (`new RegExp(rule.ttsrTrigger)` lança uma exceção)

Triggers com regex inválida são registrados como avisos e ignorados; a inicialização da sessão continua.

### Ressalva sobre configuração

`TtsrSettings.enabled` é carregado no manager, mas não é verificado atualmente no controle de execução. Se existirem regras, a verificação de correspondência ainda é executada.

## 2. Ciclo de vida do monitor de streaming

A detecção TTSR é executada dentro de `AgentSession.#handleAgentEvent`.

### Início do turno

Em `turn_start`, o buffer de stream é resetado:

- `ttsrManager.resetBuffer()`

### Durante o stream (`message_update`)

Quando atualizações do assistente chegam e existem regras:

- monitora `text_delta` e `toolcall_delta`
- acrescenta o delta ao buffer do manager
- chama `check(buffer)`

`check()` itera as regras registradas e retorna todas as regras correspondentes que passam pela política de repetição (`#canTrigger`).

## 3. Decisão de trigger e caminho de aborto imediato

Quando uma ou mais regras correspondem:

1. `markInjected(matches)` registra os nomes das regras no estado de injeção do manager.
2. regras correspondentes são enfileiradas em `#pendingTtsrInjections`.
3. `#ttsrAbortPending = true`.
4. `agent.abort()` é chamado imediatamente.
5. o evento `ttsr_triggered` é emitido assincronamente (fire-and-forget).
6. o trabalho de retry é agendado via `setTimeout(..., 50)`.

O aborto não é bloqueado por callbacks de extensão.

## 4. Agendamento de retry, modo de contexto e injeção de lembrete

Após o timeout de 50ms:

1. `#ttsrAbortPending = false`
2. lê `ttsrManager.getSettings().contextMode`
3. se `contextMode === "discard"`, descarta a saída parcial do assistente com `agent.popMessage()`
4. constrói o conteúdo de injeção a partir das regras pendentes usando o template `ttsr-interrupt.md`
5. acrescenta uma mensagem sintética do usuário contendo um bloco `<system-interrupt ...>` por regra
6. chama `agent.continue()` para repetir a geração

O payload do template é:

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

As injeções pendentes são limpas após a geração do conteúdo.

### Comportamento do `contextMode` na saída parcial

- `discard`: a mensagem parcial/abortada do assistente é removida antes do retry.
- `keep`: a saída parcial do assistente permanece no estado da conversa; o lembrete é acrescentado depois dela.

## 5. Política de repetição e lógica de intervalo

`TtsrManager` rastreia `#messageCount` e `lastInjectedAt` por regra.

### `repeatMode: "once"`

Uma regra pode ser disparada apenas uma vez após ter um registro de injeção.

### `repeatMode: "after-gap"`

Uma regra pode ser redisparada somente quando:

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount` é incrementado em `turn_end`, portanto o intervalo é medido em turnos completos, não em chunks de stream.

## 6. Emissão de eventos e superfícies de extensão/hook

### Evento de sessão

`AgentSessionEvent` inclui:

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### Runner de extensão

`#emitSessionEvent()` roteia o evento para:

- listeners de extensão (`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`)
- assinantes locais da sessão

### Tipagem de hook e custom-tool

- a API de extensão expõe `on("ttsr_triggered", ...)`
- a API de hook expõe `on("ttsr_triggered", ...)`
- custom tools recebem `onSession({ reason: "ttsr_triggered", rules })`

### Diferença de renderização no modo interativo

O modo interativo usa `session.isTtsrAbortPending` para suprimir a exibição do motivo de parada do assistente abortado como uma falha visível durante a interrupção TTSR, e renderiza um `TtsrNotificationComponent` quando o evento chega.

## 7. Persistência e estado de retomada (implementação atual)

`SessionManager` possui suporte completo de schema para persistência de regras injetadas:

- tipo de entrada: `ttsr_injection`
- API de append: `appendTtsrInjection(ruleNames)`
- API de consulta: `getInjectedTtsrRules()`
- a reconstrução de contexto inclui `SessionContext.injectedTtsrRules`

`TtsrManager` também suporta restauração via `restoreInjected(ruleNames)`.

### Estado atual da integração

No caminho de execução atual:

- `AgentSession` não acrescenta entradas `ttsr_injection` quando o TTSR é disparado.
- `createAgentSession()` não restaura `existingSession.injectedTtsrRules` de volta para o `ttsrManager`.

Efeito prático: a supressão de regras injetadas é aplicada em memória para o processo ativo, mas não é atualmente persistida/restaurada entre recarregamentos/retomadas de sessão por este caminho.

## 8. Limites de race condition e garantias de ordenação

### Abort vs callback de retry

- o abort é síncrono da perspectiva do handler TTSR (`agent.abort()` chamado imediatamente)
- o retry é adiado por timer (`50ms`)
- a notificação de extensão é assíncrona e intencionalmente não é aguardada antes do agendamento de abort/retry

### Múltiplas correspondências na mesma janela de stream

`check()` retorna todas as regras elegíveis atualmente correspondentes. Elas são injetadas como um lote na próxima mensagem de retry.

### Entre abort e continue

Durante a janela do timer, o estado pode mudar (interrupção do usuário, ações de modo, eventos adicionais). A chamada de retry é de melhor esforço: `agent.continue().catch(() => {})` engole erros subsequentes.

## 9. Resumo de casos extremos

- Regex `ttsr_trigger` inválida: ignorada com aviso; outras regras continuam.
- Nomes de regras duplicados na camada de capability: duplicatas de menor prioridade são sombreadas antes do registro.
- Nomes duplicados na camada do manager: o segundo registro é ignorado.
- `contextMode: "keep"`: saída parcial em violação pode permanecer no contexto antes do retry com lembrete.
- Repeat-after-gap depende de incrementos de contagem de turnos em `turn_end`; chunks no meio do turno não avançam os contadores de intervalo.
