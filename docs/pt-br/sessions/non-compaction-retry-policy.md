---
title: Política de Auto-Retry Fora da Compactação
description: >-
  Política de auto-retry para falhas transitórias de API fora do caminho de
  compactação.
sidebar:
  order: 6
  label: Política de retry
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# Política de auto-retry fora da compactação

Este documento descreve o caminho padrão de retry para erros de API no `AgentSession`.

Ele exclui explicitamente a recuperação de estouro de contexto via auto-compactação. O estouro é tratado pela lógica de compactação e está documentado separadamente em [`compaction.md`](./compaction.md).

## Arquivos de implementação

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## Limite de escopo vs compactação

Retry e compactação são verificados a partir do mesmo caminho `agent_end`, mas são intencionalmente separados:

1. `agent_end` inspeciona a última mensagem do assistente.
2. `#isRetryableError(...)` executa primeiro.
3. Se o retry é iniciado, as verificações de compactação são ignoradas para aquele turno.
4. Erros de estouro de contexto são rigorosamente excluídos da classificação de retry (`isContextOverflow(...)` interrompe o retry antecipadamente).
5. O estouro, portanto, cai para `#checkCompaction(...)` em vez do retry padrão.

Portanto: falhas de estilo sobrecarga/rate/servidor/rede usam esta política de retry; estouro de janela de contexto usa recuperação por compactação.

## Classificação de retry

`#isRetryableError(...)` requer todas as seguintes condições:

- `stopReason === "error"` do assistente
- `errorMessage` existe
- a mensagem **não** é estouro de contexto
- `errorMessage` corresponde a `#isRetryableErrorMessage(...)`

Conjunto atual de padrões retryáveis (baseado em regex):

- overloaded
- rate limit / usage limit / too many requests
- classes de servidor tipo HTTP: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- expressão `retry delay`

Esta é uma classificação por padrão de texto, não códigos de erro tipados do provedor.

## Ciclo de vida do retry e transições de estado

Estado da sessão usado pelo retry:

- `#retryAttempt: number` (`0` significa ocioso)
- `#retryPromise: Promise<void> | undefined` (rastreia o ciclo de vida do retry em andamento)
- `#retryResolve: (() => void) | undefined` (resolve `#retryPromise`)
- `#retryAbortController: AbortController | undefined` (cancela o sleep de backoff)

Fluxo (`#handleRetryableError`):

1. Lê o grupo de configurações `retry`.
2. Se `retry.enabled === false`, para imediatamente (`false`, nenhum retry iniciado).
3. Incrementa `#retryAttempt`.
4. Cria `#retryPromise` uma vez (primeira tentativa em uma cadeia).
5. Se a tentativa excedeu `retry.maxRetries`, emite evento de falha final e para.
6. Calcula o atraso: `retry.baseDelayMs * 2^(attempt-1)`.
7. Para erros de limite de uso, analisa dicas de retry e chama o armazenamento de autenticação (`markUsageLimitReached(...)`); se a troca de provedor/modelo for bem-sucedida, força o atraso para `0`.
8. Emite `auto_retry_start`.
9. Remove a mensagem de erro do assistente final do estado de runtime do agente (mantida no histórico de sessão persistido).
10. Dorme com suporte a abort.
11. Ao acordar, agenda `agent.continue()` via `setTimeout(..., 0)`.

### O que reseta os contadores de retry

`#retryAttempt` reseta para `0` nestes casos:

- primeira mensagem bem-sucedida do assistente (sem erro, sem abort) após o início dos retries (emite `auto_retry_end { success: true }`)
- cancelamento do retry durante o sleep de backoff
- caminho de máximo de retries excedido

`#retryPromise` resolve/limpa quando a cadeia de retry termina (sucesso, cancelamento ou máximo excedido), via `#resolveRetry()`.

## Semântica de backoff e máximo de tentativas

Configurações:

- `retry.enabled` (padrão `true`)
- `retry.maxRetries` (padrão `3`)
- `retry.baseDelayMs` (padrão `2000`)

Numeração de tentativas:

- o contador de tentativas é incrementado antes da verificação de máximo
- eventos de início usam a tentativa atual (base 1)
- evento de fim por máximo excedido reporta `attempt: this.#retryAttempt - 1` (contagem da última tentativa de retry)

Sequência de backoff com configurações padrão:

- tentativa 1: 2000 ms
- tentativa 2: 4000 ms
- tentativa 3: 8000 ms

Entradas de substituição de atraso são usadas apenas no caminho de tratamento de limite de uso, e apenas para influenciar a decisão de troca de modelo/conta no armazenamento de autenticação. No caminho principal de retry fora da compactação, o backoff permanece como atraso exponencial local, a menos que a troca seja bem-sucedida (`delayMs = 0`).

## Mecânica de abort

### Abort explícito de retry

`abortRetry()`:

- aborta `#retryAbortController` (se presente)
- resolve a promise de retry (`#resolveRetry()`) para que os awaitters sejam desbloqueados

Se o abort ocorre durante o sleep, o caminho de catch emite:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- reseta tentativa/controlador

### Interação com abort de operação global

`abort()` chama `abortRetry()` antes de abortar o stream ativo do agente. Isso garante que o backoff de retry seja cancelado quando o usuário emite um abort geral.

### Interação com TUI

No `auto_retry_start`, EventController:

- troca o handler de `Esc` para `session.abortRetry()`
- renderiza texto de loader: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

No `auto_retry_end`, restaura o handler anterior de `Esc` e limpa o estado do loader.

## Comportamento de streaming e conclusão de prompt

`prompt()` em última instância aguarda `#waitForRetry()` após `agent.prompt(...)` retornar.

Efeito:

- uma chamada de prompt não resolve completamente até que qualquer cadeia de retry iniciada termine (sucesso/falha/cancelamento)
- o ciclo de vida do retry faz parte de um limite lógico de execução de prompt

Isso impede que os chamadores tratem um turno em retry como concluído prematuramente.

## Controles: configurações e RPC

### Opções de configuração

Definidas no esquema de configurações sob o grupo retry:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

Alternadores programáticos na sessão:

- `setAutoRetryEnabled(enabled)` escreve `retry.enabled`
- `autoRetryEnabled` lê `retry.enabled`
- `isRetrying` reporta se a promise do ciclo de vida de retry está ativa

### Controles RPC

Superfície de comandos RPC:

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

Helpers do cliente:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

Ambos os comandos retornam respostas de sucesso; detalhes de progresso/falha de retry vêm de eventos de sessão transmitidos via streaming, não de payloads de resposta de comando.

## Emissão de eventos e exposição de falhas

Eventos de retry em nível de sessão:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

Propagação:

- emitidos através de `AgentSession.subscribe(...)`
- encaminhados ao executor de extensão como eventos de extensão
- no modo RPC, encaminhados diretamente como objetos de evento JSON (`session.subscribe(event => output(event))`)
- no TUI, consumidos pelo `EventController` para UI de loader/erro

Exposição de falha final:

- No máximo excedido ou cancelamento, `auto_retry_end.success === false`
- TUI exibe: `Retry failed after N attempts: <finalError>`
- Extensões/hooks recebem `auto_retry_end` com os mesmos campos
- Consumidores RPC recebem o mesmo objeto de evento no stream stdout

## Condições de parada permanente

O retry para e não continua automaticamente quando qualquer uma dessas condições ocorre:

- `retry.enabled` é false
- o erro não é classificado como retryável
- o erro é estouro de contexto (delegado ao caminho de compactação)
- máximo de retries excedido
- usuário cancela o retry (`abort_retry` ou `Esc` durante o loader de retry)
- abort global (`abort`) cancela o retry primeiro

Uma nova cadeia de retry ainda pode iniciar posteriormente em um erro retryável futuro após os contadores serem resetados.

## Ressalvas operacionais

- A classificação é por correspondência de texto via regex; erros estruturados específicos do provedor não são usados aqui.
- O retry remove o erro do assistente que falhou do **contexto de runtime** antes de re-continuar, mas o histórico da sessão ainda mantém essa entrada de erro.
- `RpcSessionState` atualmente expõe `autoCompactionEnabled` mas não um campo `autoRetryEnabled`; chamadores RPC devem rastrear seu próprio estado de alternância ou consultar configurações através de outras APIs.
