---
title: Internals dello streaming dei provider
description: >-
  Implementazione dello streaming dei provider con parsing SSE, conteggio dei
  token e gestione della backpressure.
sidebar:
  order: 2
  label: Internals dello streaming
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# Internals dello streaming dei provider

Questo documento spiega come lo streaming di token/tool viene normalizzato in `@f5xc-salesdemos/pi-ai`, poi propagato attraverso `@f5xc-salesdemos/pi-agent-core` e gli eventi di sessione di `coding-agent`.

## Flusso end-to-end

1. `streamSimple()` (`packages/ai/src/stream.ts`) mappa le opzioni generiche e invia la richiesta a una funzione di stream del provider.
2. Le funzioni di stream del provider (`anthropic.ts`, `openai-responses.ts`, `google.ts`) traducono gli eventi nativi del provider nella sequenza unificata `AssistantMessageEvent`.
3. Ogni provider invia gli eventi in `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`), che limita la frequenza degli eventi delta ed espone:
   - iterazione asincrona per aggiornamenti incrementali
   - `result()` per il messaggio finale `AssistantMessage`
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) consuma quegli eventi, modifica lo stato dell'assistente in corso e emette eventi `message_update` contenenti il `assistantMessageEvent` grezzo.
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) si sottoscrive agli eventi dell'agente, persiste i messaggi, gestisce gli hook delle estensioni e applica i comportamenti di sessione (retry, compattazione, TTSR, controlli di abort per editing in streaming).

## Contratto di stream unificato in `@f5xc-salesdemos/pi-ai`

Tutti i provider emettono la stessa struttura (`AssistantMessageEvent` in `packages/ai/src/types.ts`):

- `start`
- triplette del ciclo di vita dei blocchi di contenuto:
  - testo: `text_start` → `text_delta`* → `text_end`
  - ragionamento: `thinking_start` → `thinking_delta`* → `thinking_end`
  - chiamata tool: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- evento terminale:
  - `done` con `reason: "stop" | "length" | "toolUse"`
  - oppure `error` con `reason: "aborted" | "error"`

`AssistantMessageEventStream` garantisce:

- il risultato finale viene risolto dall'evento terminale (`done` o `error`)
- i delta vengono raggruppati/limitati (~50ms)
- i delta nel buffer vengono scaricati prima degli eventi non-delta e prima del completamento

## Comportamento di throttling e armonizzazione dei delta

`AssistantMessageEventStream` tratta `text_delta`, `thinking_delta` e `toolcall_delta` come eventi unificabili:

- i delta nel buffer vengono uniti solo quando **type + contentIndex** corrispondono
- l'unione mantiene l'ultimo snapshot `partial`
- gli eventi non-delta forzano uno scaricamento immediato

Questo uniforma gli stream ad alta frequenza dei provider per i consumatori TUI/eventi, ma non rappresenta backpressure verso il provider: i provider continuano a produrre a piena velocità, mentre lo stream locale accumula nel buffer.

## Dettagli della normalizzazione dei provider

## Anthropic (`anthropic-messages`)

Sorgente: `packages/ai/src/providers/anthropic.ts`

Punti di normalizzazione:

- `message_start` inizializza l'utilizzo (token di input/output/cache)
- `content_block_start` viene mappato agli start di text/thinking/toolcall
- `content_block_delta` mappa:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` aggiorna solo `thinkingSignature` (nessun evento)
- `content_block_stop` emette il corrispondente `*_end`
- `message_delta.stop_reason` viene mappato tramite `mapStopReason()`

Streaming degli argomenti delle chiamate tool:

- ogni blocco tool porta un `partialJson` interno
- ogni delta JSON viene accodato a `partialJson`
- `arguments` vengono riparsificati ad ogni delta tramite `parseStreamingJson()`
- `toolcall_end` riparsifica un'ultima volta, poi rimuove `partialJson`

## OpenAI Responses (`openai-responses`)

Sorgente: `packages/ai/src/providers/openai-responses.ts`

Punti di normalizzazione:

- `response.output_item.added` avvia i blocchi reasoning/text/function-call
- gli eventi di riepilogo del ragionamento (`response.reasoning_summary_text.delta`) diventano `thinking_delta`
- i delta di output/rifiuto diventano `text_delta`
- `response.function_call_arguments.delta` diventa `toolcall_delta`
- `response.output_item.done` emette `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` mappa lo stato al motivo di stop e all'utilizzo

Streaming degli argomenti delle chiamate tool:

- stesso pattern di accumulo `partialJson` di Anthropic
- i provider che inviano solo `response.function_call_arguments.done` popolano comunque gli argomenti finali
- gli ID delle chiamate tool vengono normalizzati come `"<call_id>|<item_id>"`

## Google Generative AI (`google-generative-ai`)

Sorgente: `packages/ai/src/providers/google.ts`

Punti di normalizzazione:

- itera `candidate.content.parts`
- le parti di testo vengono suddivise in thinking vs text tramite `isThinkingPart(part)`
- le transizioni di blocco chiudono il blocco precedente prima di avviarne uno nuovo
- `part.functionCall` viene trattato come una chiamata tool completa (start/delta/end emessi immediatamente)
- il motivo di fine viene mappato da `mapStopReason()` in `google-shared.ts`

Streaming degli argomenti delle chiamate tool:

- gli argomenti delle chiamate a funzione arrivano come oggetto strutturato, non come testo JSON incrementale
- l'implementazione emette un `toolcall_delta` sintetico contenente `JSON.stringify(arguments)`
- nessun parser JSON parziale necessario per Google in questo percorso

## Accumulo e recupero del JSON parziale delle chiamate tool

Il comportamento condiviso per Anthropic/OpenAI Responses utilizza `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. tenta `JSON.parse`
2. fallback al parser `partial-json` per frammenti incompleti
3. se entrambi falliscono, restituisce `{}`

Implicazioni:

- i delta di argomenti malformati o troncati non causano un crash immediato dell'elaborazione dello stream
- `arguments` in corso di elaborazione può essere temporaneamente `{}`
- delta validi successivi possono recuperare gli argomenti strutturati perché il parsing viene ritentato ad ogni accodamento
- `toolcall_end` finale esegue un ultimo tentativo di parsing prima dell'emissione

## Motivi di stop vs errori di trasporto/runtime

I motivi di stop del provider vengono mappati allo `stopReason` normalizzato:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, casi di sicurezza/rifiuto→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, classi sicurezza/proibito/chiamata-funzione-malformata→`error`

La semantica degli errori è divisa in due stadi:

1. **Semantica di completamento del modello** (motivo di fine/stato riportato dal provider)
2. **Errori di trasporto/runtime** (eccezioni di rete/client/parser/abort)

Se lo stream del provider lancia un'eccezione o segnala un errore, ogni wrapper del provider cattura ed emette un evento terminale `error` con:

- `stopReason = "aborted"` quando il segnale di abort è impostato
- altrimenti `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## Comportamento in caso di chunk malformati / errori di parsing SSE

Per questi percorsi dei provider, il framing chunk/SSE è gestito dagli stream degli SDK dei vendor (Anthropic SDK, OpenAI SDK, Google SDK). Questo codice non implementa un decoder SSE personalizzato qui.

Comportamento osservato nell'implementazione attuale:

- il parsing di chunk/SSE malformati a livello SDK si manifesta come un'eccezione o un evento `error` dello stream
- il wrapper del provider lo converte in un evento terminale unificato `error`
- nessun resume/retry specifico del provider all'interno della funzione di stream stessa
- i retry di livello superiore sono gestiti nella logica di auto-retry di `AgentSession` (retry a livello di messaggio, non replay di chunk dello stream)

## Confini di cancellazione

La cancellazione è stratificata:

- Richiesta al provider AI: `options.signal` viene passato nella chiamata stream del client del provider.
- Wrapper del provider: dopo il ciclo dello stream, un segnale di abort forzato attiva il percorso di errore (`"Request was aborted"`).
- Loop dell'agente: controlla `signal.aborted` prima di gestire ogni evento del provider e può sintetizzare un messaggio dell'assistente interrotto dall'ultimo parziale.
- Controlli sessione/agente: `AgentSession.abort()` -> `agent.abort()` -> cancellazione del controller di abort condiviso.

La cancellazione dell'esecuzione dei tool è separata dalla cancellazione dello stream del modello:

- i runner dei tool usano `AbortSignal.any([agentSignal, steeringAbortSignal])`
- le interruzioni di steering possono interrompere l'esecuzione rimanente dei tool preservando i risultati dei tool già prodotti

## Confini di backpressure

Non esiste un meccanismo di backpressure rigido tra lo stream dell'SDK del provider e i consumatori a valle:

- `EventStream` utilizza code in memoria senza dimensione massima
- il throttling riduce la frequenza di aggiornamento dell'UI ma non rallenta l'acquisizione dal provider
- se i consumatori accumulano un ritardo significativo, gli eventi in coda possono crescere fino al completamento

Il design attuale privilegia la reattività e l'ordinamento semplice rispetto al controllo di flusso con buffer limitato.

## Come gli eventi dello stream emergono come eventi agente/sessione

`agentLoop.streamAssistantResponse()` collega `AssistantMessageEvent` a `AgentEvent`:

- su `start`: inserisce un messaggio placeholder dell'assistente ed emette `message_start`
- sugli eventi di blocco (`text_*`, `thinking_*`, `toolcall_*`): aggiorna l'ultimo messaggio dell'assistente, emette `message_update` con il `assistantMessageEvent` grezzo
- su terminale (`done`/`error`): risolve il messaggio finale da `response.result()`, emette `message_end`

`AgentSession` poi consuma quegli eventi per i comportamenti a livello di sessione:

- TTSR osserva `message_update.assistantMessageEvent` per `text_delta` e `toolcall_delta`
- il guard per l'editing in streaming ispeziona `toolcall_delta`/`toolcall_end` sulle chiamate `edit` e può interrompere anticipatamente
- la persistenza scrive i messaggi finalizzati a `message_end`
- l'auto-retry esamina `stopReason === "error"` dell'assistente più le euristiche di `errorMessage`

## Responsabilità unificate vs specifiche del provider

Unificate (contratto comune):

- struttura degli eventi (`AssistantMessageEvent`)
- estrazione del risultato finale (`done`/`error`)
- regole di throttling + unione dei delta
- modello di propagazione degli eventi agente/sessione

Specifiche del provider (non completamente astratte):

- tassonomie degli eventi upstream e logica di mappatura
- tabelle di traduzione dei motivi di stop
- convenzioni per gli ID delle chiamate tool
- semantica e firme dei blocchi reasoning/thinking
- semantica dei token di utilizzo e tempistica di disponibilità
- vincoli di conversione dei messaggi per API

## File di implementazione

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — dispatch del provider, mappatura delle opzioni, gestione API key/sessione.
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — coda generica dello stream + throttling dei delta dell'assistente.
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — parsing JSON parziale per gli argomenti dei tool in streaming.
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — traduzione degli eventi Anthropic e accumulo dei delta JSON dei tool.
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — traduzione degli eventi OpenAI Responses e mappatura degli stati.
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — traduzione da chunk di stream Gemini a blocchi.
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — mappatura dei motivi di fine Gemini e regole di conversione condivise.
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — consumo dello stream del provider e collegamento a `message_update`.
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — gestione a livello di sessione degli aggiornamenti in streaming, abort, retry e persistenza.
