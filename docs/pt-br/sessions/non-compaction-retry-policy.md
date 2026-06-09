---
title: Política de Retentativa Automática Fora da Compactação
description: >-
  Política de retentativa automática para falhas transitórias de API fora do
  caminho de compactação.
sidebar:
  order: 6
  label: Política de retentativa
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# Política de retentativa automática fora da compactação

Este documento descreve o caminho padrão de retentativa em caso de erro de API no `AgentSession`.

Ele exclui explicitamente a recuperação de estouro de contexto via autocompactação. O estouro é tratado pela lógica de compactação e está documentado separadamente em [`compaction.md`](./compaction.md).

## Arquivos de implementação

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## Limite de escopo vs compactação

Retentativa e compactação são verificadas a partir do mesmo caminho `agent_end`, mas são intencionalmente separadas:

1. `agent_end` inspeciona a última mensagem do assistente.
2. `#isRetryableError(...)` é executado primeiro.
3. Se a retentativa é iniciada, as verificações de compactação são ignoradas para aquele turno.
4. Erros de estouro de contexto são estritamente excluídos da classificação de retentativa (`isContextOverflow(...)` interrompe a retentativa antecipadamente).
5. O estouro, portanto, segue para `#checkCompaction(...)` em vez da retentativa padrão.

Portanto: falhas de sobrecarga/limite de taxa/servidor/rede usam esta política de retentativa; estouro da janela de contexto usa recuperação por compactação.

## Classificação de retentativa

`#isRetryableError(...)` requer todas as seguintes condições:

- `stopReason === "error"` do assistente
- `errorMessage` existe
- a mensagem **não** é estouro de contexto
- `errorMessage` corresponde a `#isRetryableErrorMessage(...)`

Conjunto atual de padrões retentáveis (baseado em regex):

- overloaded
- rate limit / usage limit / too many requests
- Classes HTTP de servidor: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- expressão `retry delay`

Esta é uma classificação por padrão de texto, não por códigos de erro tipados do provedor.

## Ciclo de vida da retentativa e transições de estado

Estado da sessão utilizado pela retentativa:

- `#retryAttempt: number` (`0` significa ocioso)
- `#retryPromise: Promise<void> | undefined` (rastreia o ciclo de vida da retentativa em andamento)
- `#retryResolve: (() => void) | undefined` (resolve `#retryPromise`)
- `#retryAbortController: AbortController | undefined` (cancela a espera do backoff)

Fluxo (`#handleRetryableError`):

1. Lê o grupo de configurações `retry`.
2. Se `retry.enabled === false`, para imediatamente (`false`, nenhuma retentativa iniciada).
3. Incrementa `#retryAttempt`.
4. Cria `#retryPromise` uma vez (primeira tentativa em uma cadeia).
5. Se a tentativa excedeu `retry.maxRetries`, emite evento de falha final e para.
6. Calcula o atraso: `retry.baseDelayMs * 2^(attempt-1)`.
7. Para erros de limite de uso, analisa dicas de retentativa e chama o armazenamento de autenticação (`markUsageLimitReached(...)`); se a troca de provedor/modelo for bem-sucedida, força o atraso para `0`.
8. Emite `auto_retry_start`.
9. Remove a mensagem de erro do assistente final do estado de execução do agente (mantida no histórico da sessão persistida).
10. Aguarda com suporte a abortar.
11. Ao despertar, agenda `agent.continue()` via `setTimeout(..., 0)`.

### O que reinicia os contadores de retentativa

`#retryAttempt` é reiniciado para `0` nestes casos:

- primeira mensagem do assistente bem-sucedida, sem erro e sem abortar, após retentativas iniciadas (emite `auto_retry_end { success: true }`)
- cancelamento da retentativa durante a espera do backoff
- caminho de retentativas máximas excedidas

`#retryPromise` é resolvida/limpa quando a cadeia de retentativas termina (sucesso, cancelamento ou máximo excedido), via `#resolveRetry()`.

## Semânticas de backoff e tentativas máximas

Configurações:

- `retry.enabled` (padrão `true`)
- `retry.maxRetries` (padrão `3`)
- `retry.baseDelayMs` (padrão `2000`)

Numeração de tentativas:

- o contador de tentativas é incrementado antes da verificação de máximo
- eventos de início usam a tentativa atual (base 1)
- o evento de fim por máximo excedido reporta `attempt: this.#retryAttempt - 1` (contagem da última retentativa tentada)

Sequência de backoff com configurações padrão:

- tentativa 1: 2000 ms
- tentativa 2: 4000 ms
- tentativa 3: 8000 ms

Entradas de substituição de atraso são usadas apenas no caminho de tratamento de limite de uso, e apenas para influenciar a decisão de troca de modelo/conta no armazenamento de autenticação. No caminho principal de retentativa fora da compactação, o backoff permanece como atraso exponencial local, a menos que a troca seja bem-sucedida (`delayMs = 0`).

## Mecânicas de abortar

### Abortar retentativa explicitamente

`abortRetry()`:

- aborta `#retryAbortController` (se presente)
- resolve a promise de retentativa (`#resolveRetry()`) para que os aguardadores sejam desbloqueados

Se o abortar ocorre durante a espera, o caminho catch emite:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- reinicia tentativa/controlador

### Interação com abortar operação global

`abort()` chama `abortRetry()` antes de abortar o stream ativo do agente. Isso garante que o backoff de retentativa seja cancelado quando o usuário emite um abortar geral.

### Interação com a TUI

No `auto_retry_start`, o EventController:

- troca o handler do `Esc` para `session.abortRetry()`
- renderiza texto de carregamento: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

No `auto_retry_end`, restaura o handler anterior do `Esc` e limpa o estado de carregamento.

## Comportamento de streaming e conclusão de prompt

`prompt()` em última instância aguarda `#waitForRetry()` após `agent.prompt(...)` retornar.

Efeito:

- uma chamada de prompt não é totalmente resolvida até que qualquer cadeia de retentativa iniciada termine (sucesso/falha/cancelamento)
- o ciclo de vida da retentativa faz parte de um limite lógico de execução de prompt

Isso impede que os chamadores tratem um turno em retentativa como concluído prematuramente.

## Controles: configurações e RPC

### Opções de configuração

Definidas no esquema de configurações sob o grupo retry:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

Alternadores programáticos na sessão:

- `setAutoRetryEnabled(enabled)` escreve `retry.enabled`
- `autoRetryEnabled` lê `retry.enabled`
- `isRetrying` reporta se a promise do ciclo de vida de retentativa está ativa

### Controles RPC

Superfície de comandos RPC:

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

Helpers do cliente:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

Ambos os comandos retornam respostas de sucesso; detalhes de progresso/falha de retentativa vêm de eventos de sessão transmitidos por stream, não de payloads de resposta de comando.

## Emissão de eventos e exibição de falhas

Eventos de retentativa no nível da sessão:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

Propagação:

- emitidos através de `AgentSession.subscribe(...)`
- encaminhados ao executor de extensão como eventos de extensão
- no modo RPC, encaminhados diretamente como objetos de evento JSON (`session.subscribe(event => output(event))`)
- na TUI, consumidos pelo `EventController` para UI de carregamento/erro

Exibição de falha final:

- Em máximo excedido ou cancelamento, `auto_retry_end.success === false`
- A TUI exibe: `Retry failed after N attempts: <finalError>`
- Extensões/hooks recebem `auto_retry_end` com os mesmos campos
- Consumidores RPC recebem o mesmo objeto de evento no stream stdout

## Condições de parada permanente

A retentativa para e não continuará automaticamente quando qualquer uma destas condições ocorrer:

- `retry.enabled` é false
- o erro não é classificado como retentável
- o erro é estouro de contexto (delegado ao caminho de compactação)
- retentativas máximas excedidas
- usuário cancela a retentativa (`abort_retry` ou `Esc` durante o carregamento de retentativa)
- abortar global (`abort`) cancela a retentativa primeiro

Uma nova cadeia de retentativa ainda pode iniciar posteriormente em um futuro erro retentável após os contadores serem reiniciados.

## Ressalvas operacionais

- A classificação é por correspondência de texto via regex; erros estruturados específicos do provedor não são usados aqui.
- A retentativa remove o erro do assistente que falhou do **contexto de execução** antes de re-continuar, mas o histórico da sessão ainda mantém essa entrada de erro.
- `RpcSessionState` atualmente expõe `autoCompactionEnabled` mas não um campo `autoRetryEnabled`; chamadores RPC devem rastrear seu próprio estado de alternância ou consultar configurações através de outras APIs.
