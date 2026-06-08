---
title: Internos do Streaming de Providers
description: >-
  Implementação de streaming de providers com parsing SSE, contagem de tokens e
  tratamento de backpressure.
sidebar:
  order: 2
  label: Internos do streaming
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# Internos do streaming de providers

Este documento explica como o streaming de tokens/ferramentas é normalizado em `@f5xc-salesdemos/pi-ai`, e depois propagado através de `@f5xc-salesdemos/pi-agent-core` e dos eventos de sessão do `coding-agent`.

## Fluxo ponta a ponta

1. `streamSimple()` (`packages/ai/src/stream.ts`) mapeia opções genéricas e despacha para uma função de stream do provider.
2. As funções de stream do provider (`anthropic.ts`, `openai-responses.ts`, `google.ts`) traduzem eventos nativos do provider para a sequência unificada `AssistantMessageEvent`.
3. Cada provider envia eventos para `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`), que limita a frequência dos eventos delta e expõe:
   - iteração assíncrona para atualizações incrementais
   - `result()` para a `AssistantMessage` final
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) consome esses eventos, muta o estado do assistente em andamento e emite eventos `message_update` carregando o `assistantMessageEvent` bruto.
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) se inscreve nos eventos do agente, persiste mensagens, aciona hooks de extensão e aplica comportamentos de sessão (retry, compactação, TTSR, verificações de abort de edição em streaming).

## Contrato unificado de stream em `@f5xc-salesdemos/pi-ai`

Todos os providers emitem o mesmo formato (`AssistantMessageEvent` em `packages/ai/src/types.ts`):

- `start`
- tripletos de ciclo de vida de blocos de conteúdo:
  - texto: `text_start` → `text_delta`* → `text_end`
  - pensamento: `thinking_start` → `thinking_delta`* → `thinking_end`
  - chamada de ferramenta: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- evento terminal:
  - `done` com `reason: "stop" | "length" | "toolUse"`
  - ou `error` com `reason: "aborted" | "error"`

`AssistantMessageEventStream` garante:

- o resultado final é resolvido pelo evento terminal (`done` ou `error`)
- deltas são agrupados/limitados em frequência (~50ms)
- deltas em buffer são enviados antes de eventos não-delta e antes da conclusão

## Comportamento de limitação de frequência e harmonização de deltas

`AssistantMessageEventStream` trata `text_delta`, `thinking_delta` e `toolcall_delta` como eventos combináveis:

- deltas em buffer são combinados apenas quando **type + contentIndex** coincidem
- a combinação mantém o snapshot `partial` mais recente
- eventos não-delta forçam envio imediato do buffer

Isso suaviza streams de alta frequência dos providers para consumidores TUI/eventos, mas não é backpressure do provider: os providers ainda produzem em velocidade máxima, enquanto o stream local armazena em buffer.

## Detalhes da normalização por provider

## Anthropic (`anthropic-messages`)

Fonte: `packages/ai/src/providers/anthropic.ts`

Pontos de normalização:

- `message_start` inicializa o uso (tokens de entrada/saída/cache)
- `content_block_start` mapeia para inícios de texto/pensamento/chamada de ferramenta
- `content_block_delta` mapeia:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` atualiza apenas `thinkingSignature` (sem evento)
- `content_block_stop` emite o `*_end` correspondente
- `message_delta.stop_reason` é mapeado via `mapStopReason()`

Streaming de argumentos de chamada de ferramenta:

- cada bloco de ferramenta carrega um `partialJson` interno
- cada delta JSON é concatenado ao `partialJson`
- `arguments` são re-parseados em cada delta via `parseStreamingJson()`
- `toolcall_end` re-parseia mais uma vez, e então remove `partialJson`

## OpenAI Responses (`openai-responses`)

Fonte: `packages/ai/src/providers/openai-responses.ts`

Pontos de normalização:

- `response.output_item.added` inicia blocos de raciocínio/texto/chamada de função
- eventos de resumo de raciocínio (`response.reasoning_summary_text.delta`) tornam-se `thinking_delta`
- deltas de saída/recusa tornam-se `text_delta`
- `response.function_call_arguments.delta` torna-se `toolcall_delta`
- `response.output_item.done` emite `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` mapeia status para razão de parada e uso

Streaming de argumentos de chamada de ferramenta:

- mesmo padrão de acumulação `partialJson` que o Anthropic
- providers que enviam apenas `response.function_call_arguments.done` ainda preenchem os args finais
- IDs de chamada de ferramenta são normalizados como `"<call_id>|<item_id>"`

## Google Generative AI (`google-generative-ai`)

Fonte: `packages/ai/src/providers/google.ts`

Pontos de normalização:

- itera `candidate.content.parts`
- partes de texto são divididas em pensamento vs texto por `isThinkingPart(part)`
- transições de bloco fecham o bloco anterior antes de iniciar um novo
- `part.functionCall` é tratado como uma chamada de ferramenta completa (start/delta/end emitidos imediatamente)
- razão de término mapeada por `mapStopReason()` de `google-shared.ts`

Streaming de argumentos de chamada de ferramenta:

- args de chamada de função chegam como objeto estruturado, não como texto JSON incremental
- a implementação emite um `toolcall_delta` sintético contendo `JSON.stringify(arguments)`
- nenhum parser de JSON parcial é necessário para o Google neste caminho

## Acumulação e recuperação de JSON parcial de chamada de ferramenta

O comportamento compartilhado para Anthropic/OpenAI Responses usa `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. tenta `JSON.parse`
2. fallback para o parser `partial-json` para fragmentos incompletos
3. se ambos falharem, retorna `{}`

Implicações:

- deltas de argumentos malformados ou truncados não causam crash imediato no processamento do stream
- `arguments` em andamento podem temporariamente ser `{}`
- deltas válidos posteriores podem recuperar argumentos estruturados porque o parsing é retentado a cada concatenação
- o `toolcall_end` final realiza mais uma tentativa de parsing antes da emissão

## Razões de parada vs erros de transporte/runtime

As razões de parada do provider são mapeadas para `stopReason` normalizado:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, casos de segurança/recusa→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, classes de segurança/proibido/chamada-de-função-malformada→`error`

A semântica de erros é dividida em dois estágios:

1. **Semântica de conclusão do modelo** (razão de término/status reportado pelo provider)
2. **Falha de transporte/runtime** (exceções de rede/cliente/parser/abort)

Se o stream do provider lança exceção ou sinaliza falha, cada wrapper de provider captura e emite evento terminal `error` com:

- `stopReason = "aborted"` quando o sinal de abort está definido
- caso contrário `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## Comportamento de chunk malformado / falha de parsing SSE

Para estes caminhos de provider, o enquadramento de chunk/SSE é tratado pelos streams dos SDKs do fornecedor (Anthropic SDK, OpenAI SDK, Google SDK). Este código não implementa um decodificador SSE customizado aqui.

Comportamento observado na implementação atual:

- parsing malformado de chunk/SSE no nível do SDK se manifesta como uma exceção ou evento `error` do stream
- o wrapper do provider converte isso em evento terminal unificado `error`
- não há resume/retry específico do provider dentro da própria função de stream
- retries de nível superior são tratados na lógica de auto-retry do `AgentSession` (retry no nível de mensagem, não replay de chunk do stream)

## Limites de cancelamento

O cancelamento é em camadas:

- Requisição ao provider de IA: `options.signal` é passado para a chamada de stream do cliente do provider.
- Wrapper do provider: após o loop do stream, sinal de abort força o caminho de erro (`"Request was aborted"`).
- Loop do agente: verifica `signal.aborted` antes de tratar cada evento do provider e pode sintetizar uma mensagem do assistente abortada a partir do parcial mais recente.
- Controles de sessão/agente: `AgentSession.abort()` -> `agent.abort()` -> cancelamento do abort controller compartilhado.

O cancelamento de execução de ferramenta é separado do cancelamento do stream do modelo:

- executores de ferramentas usam `AbortSignal.any([agentSignal, steeringAbortSignal])`
- interrupções de direcionamento podem abortar a execução de ferramentas restantes enquanto preservam resultados de ferramentas já produzidos

## Limites de backpressure

Não há mecanismo rígido de backpressure entre o stream do SDK do provider e os consumidores downstream:

- `EventStream` usa filas em memória sem tamanho máximo
- a limitação de frequência reduz a taxa de atualização da UI mas não desacelera a ingestão do provider
- se os consumidores ficarem significativamente atrasados, eventos enfileirados podem crescer até a conclusão

O design atual favorece responsividade e ordenação simples em vez de controle de fluxo com buffer limitado.

## Como eventos de stream aparecem como eventos de agente/sessão

`agentLoop.streamAssistantResponse()` faz a ponte entre `AssistantMessageEvent` e `AgentEvent`:

- em `start`: insere mensagem placeholder do assistente e emite `message_start`
- em eventos de bloco (`text_*`, `thinking_*`, `toolcall_*`): atualiza a última mensagem do assistente, emite `message_update` com o `assistantMessageEvent` bruto
- em terminal (`done`/`error`): resolve a mensagem final de `response.result()`, emite `message_end`

`AgentSession` então consome esses eventos para comportamentos no nível de sessão:

- TTSR observa `message_update.assistantMessageEvent` para `text_delta` e `toolcall_delta`
- a guarda de edição em streaming inspeciona `toolcall_delta`/`toolcall_end` em chamadas `edit` e pode abortar antecipadamente
- a persistência grava mensagens finalizadas em `message_end`
- auto-retry examina `stopReason === "error"` do assistente mais heurísticas de `errorMessage`

## Responsabilidades unificadas vs específicas do provider

Unificadas (contrato comum):

- formato do evento (`AssistantMessageEvent`)
- extração do resultado final (`done`/`error`)
- regras de limitação de frequência + combinação de deltas
- modelo de propagação de eventos agente/sessão

Específicas do provider (não totalmente abstraídas):

- taxonomias de eventos upstream e lógica de mapeamento
- tabelas de tradução de razão de parada
- convenções de ID de chamada de ferramenta
- semântica e assinaturas de blocos de raciocínio/pensamento
- semântica de tokens de uso e timing de disponibilidade
- restrições de conversão de mensagem por API

## Arquivos de implementação

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — despacho para provider, mapeamento de opções, encanamento de chave de API/sessão.
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — fila genérica de stream + limitação de frequência de deltas do assistente.
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — parsing de JSON parcial para argumentos de ferramenta em streaming.
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — tradução de eventos Anthropic e acumulação de deltas JSON de ferramentas.
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — tradução de eventos OpenAI Responses e mapeamento de status.
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — tradução de chunk-para-bloco do stream Gemini.
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — mapeamento de razão de término Gemini e regras de conversão compartilhadas.
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — consumo do stream do provider e ponte com `message_update`.
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — tratamento no nível de sessão de atualizações de streaming, abort, retry e persistência.
