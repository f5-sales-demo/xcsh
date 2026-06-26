---
title: Dettagli interni dello streaming del provider
description: >-
  Implementazione dello streaming del provider con parsing SSE, conteggio dei
  token e gestione del backpressure.
sidebar:
  order: 2
  label: Dettagli interni dello streaming
i18n:
  sourceHash: a32ffa769c4d
  translator: machine
---

# Dettagli interni dello streaming del provider

Questo documento spiega come lo streaming di token/strumenti viene normalizzato in `@f5-sales-demo/pi-ai`, quindi propagato attraverso gli eventi di sessione di `@f5-sales-demo/pi-agent-core` e `coding-agent`.

## Flusso end-to-end

1. `streamSimple()` (`packages/ai/src/stream.ts`) mappa le opzioni generiche e invia a una funzione di stream del provider.
2. Le funzioni di stream del provider (`anthropic.ts`, `openai-responses.ts`, `google.ts`) traducono gli eventi di stream nativi del provider nella sequenza unificata `AssistantMessageEvent`.
3. Ogni provider inserisce gli eventi in `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`), che limita gli eventi delta ed espone:
   - iterazione asincrona per aggiornamenti incrementali
   - `result()` per il messaggio `AssistantMessage` finale
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) consuma tali eventi, modifica lo stato dell'assistente in elaborazione ed emette eventi `message_update` che trasportano il `assistantMessageEvent` grezzo.
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) si iscrive agli eventi dell'agente, persiste i messaggi, gestisce i hook delle estensioni e applica i comportamenti di sessione (retry, compaction, TTSR, controlli di interruzione della modifica in streaming).

## Contratto di stream unificato in `@f5-sales-demo/pi-ai`

Tutti i provider emettono la stessa struttura (`AssistantMessageEvent` in `packages/ai/src/types.ts`):

- `start`
- triplette del ciclo di vita del blocco di contenuto:
  - testo: `text_start` → `text_delta`* → `text_end`
  - pensiero: `thinking_start` → `thinking_delta`* → `thinking_end`
  - chiamata strumento: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- evento terminale:
  - `done` con `reason: "stop" | "length" | "toolUse"`
  - oppure `error` con `reason: "aborted" | "error"`

`AssistantMessageEventStream` garantisce:

- il risultato finale viene risolto dall'evento terminale (`done` o `error`)
- i delta vengono raggruppati/limitati (~50ms)
- i delta bufferizzati vengono scaricati prima degli eventi non-delta e prima del completamento

## Comportamento di limitazione e armonizzazione dei delta

`AssistantMessageEventStream` tratta `text_delta`, `thinking_delta` e `toolcall_delta` come eventi unibili:

- i delta bufferizzati vengono uniti solo quando **type + contentIndex** corrispondono
- l'unione mantiene lo snapshot `partial` più recente
- gli eventi non-delta forzano lo scaricamento immediato

Questo uniforma gli stream ad alta frequenza dei provider per i consumatori TUI/eventi, ma non costituisce backpressure del provider: i provider continuano a produrre alla massima velocità, mentre lo stream locale bufferizza.

## Dettagli di normalizzazione del provider

## Anthropic (`anthropic-messages`)

Sorgente: `packages/ai/src/providers/anthropic.ts`

Punti di normalizzazione:

- `message_start` inizializza l'utilizzo (token di input/output/cache)
- `content_block_start` mappa a inizi di testo/pensiero/chiamata strumento
- `content_block_delta` mappa:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` aggiorna solo `thinkingSignature` (nessun evento)
- `content_block_stop` emette il corrispondente `*_end`
- `message_delta.stop_reason` mappa tramite `mapStopReason()`

Streaming degli argomenti delle chiamate strumento:

- ogni blocco strumento contiene un `partialJson` interno
- ogni delta JSON viene aggiunto a `partialJson`
- gli `arguments` vengono rianalizzati ad ogni delta tramite `parseStreamingJson()`
- `toolcall_end` esegue un'ulteriore rianalisi, quindi rimuove `partialJson`

## OpenAI Responses (`openai-responses`)

Sorgente: `packages/ai/src/providers/openai-responses.ts`

Punti di normalizzazione:

- `response.output_item.added` avvia blocchi di ragionamento/testo/chiamata a funzione
- gli eventi di riepilogo del ragionamento (`response.reasoning_summary_text.delta`) diventano `thinking_delta`
- i delta di output/rifiuto diventano `text_delta`
- `response.function_call_arguments.delta` diventa `toolcall_delta`
- `response.output_item.done` emette `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` mappa lo stato al motivo di arresto e all'utilizzo

Streaming degli argomenti delle chiamate strumento:

- stesso schema di accumulazione `partialJson` di Anthropic
- i provider che inviano solo `response.function_call_arguments.done` popolano comunque gli argomenti finali
- gli ID delle chiamate strumento vengono normalizzati come `"<call_id>|<item_id>"`

## Google Generative AI (`google-generative-ai`)

Sorgente: `packages/ai/src/providers/google.ts`

Punti di normalizzazione:

- itera su `candidate.content.parts`
- le parti di testo vengono suddivise in pensiero vs testo tramite `isThinkingPart(part)`
- le transizioni di blocco chiudono il blocco precedente prima di avviarne uno nuovo
- `part.functionCall` viene trattato come una chiamata strumento completa (start/delta/end emessi immediatamente)
- il motivo di fine viene mappato da `mapStopReason()` in `google-shared.ts`

Streaming degli argomenti delle chiamate strumento:

- gli argomenti delle chiamate a funzione arrivano come oggetto strutturato, non come testo JSON incrementale
- l'implementazione emette un `toolcall_delta` sintetico contenente `JSON.stringify(arguments)`
- non è necessario alcun parser JSON parziale per Google in questo percorso

## Accumulazione e recupero del JSON parziale delle chiamate strumento

Il comportamento condiviso per Anthropic/OpenAI Responses utilizza `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. si tenta `JSON.parse`
2. fallback al parser `partial-json` per frammenti incompleti
3. se entrambi falliscono, viene restituito `{}`

Implicazioni:

- i delta di argomenti malformati o troncati non interrompono immediatamente l'elaborazione dello stream
- gli `arguments` in corso possono essere temporaneamente `{}`
- delta validi successivi possono recuperare argomenti strutturati perché il parsing viene ritentato ad ogni aggiunta
- il `toolcall_end` finale esegue un ulteriore tentativo di parsing prima dell'emissione

## Motivi di arresto vs errori di trasporto/runtime

I motivi di arresto del provider vengono mappati al `stopReason` normalizzato:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, casi di sicurezza/rifiuto→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, classi di sicurezza/vietato/chiamata a funzione malformata→`error`

La semantica degli errori è divisa in due fasi:

1. **Semantica del completamento del modello** (motivo/stato di fine riportato dal provider)
2. **Errore di trasporto/runtime** (eccezioni di rete/client/parser/abort)

Se lo stream del provider genera un'eccezione o segnala un errore, ogni wrapper del provider cattura ed emette un evento `error` terminale con:

- `stopReason = "aborted"` quando il segnale di abort è impostato
- altrimenti `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## Comportamento in caso di chunk malformato / errore di parsing SSE

Per questi percorsi del provider, il framing chunk/SSE è gestito dagli stream degli SDK vendor (Anthropic SDK, OpenAI SDK, Google SDK). Questo codice non implementa un decoder SSE personalizzato.

Comportamento osservato nell'implementazione attuale:

- il parsing chunk/SSE malformato a livello SDK emerge come eccezione o evento `error` dello stream
- il wrapper del provider converte ciò in un evento `error` terminale unificato
- nessun resume/retry specifico del provider all'interno della funzione di stream stessa
- i retry di livello superiore sono gestiti dalla logica di auto-retry di `AgentSession` (retry a livello di messaggio, non replay di chunk dello stream)

## Confini di cancellazione

La cancellazione è stratificata:

- Richiesta al provider IA: `options.signal` viene passato nella chiamata allo stream del client provider.
- Wrapper del provider: dopo il ciclo dello stream, il segnale abortito forza il percorso di errore (`"Request was aborted"`).
- Agent loop: controlla `signal.aborted` prima di gestire ogni evento del provider e può sintetizzare un messaggio dell'assistente abortito dal parziale più recente.
- Controlli di sessione/agente: `AgentSession.abort()` -> `agent.abort()` -> cancellazione del controller di abort condiviso.

La cancellazione dell'esecuzione degli strumenti è separata dalla cancellazione dello stream del modello:

- i runner degli strumenti usano `AbortSignal.any([agentSignal, steeringAbortSignal])`
- le interruzioni di steering possono interrompere l'esecuzione degli strumenti rimanente preservando i risultati degli strumenti già prodotti

## Confini di backpressure

Non esiste un meccanismo di backpressure rigido tra lo stream dell'SDK del provider e i consumatori a valle:

- `EventStream` utilizza code in memoria senza dimensione massima
- la limitazione riduce la frequenza degli aggiornamenti dell'interfaccia utente ma non rallenta l'acquisizione dal provider
- se i consumatori restano significativamente indietro, gli eventi in coda possono crescere fino al completamento

Il design attuale privilegia la reattività e la semplicità dell'ordinamento rispetto al controllo del flusso con buffer limitato.

## Come gli eventi di stream emergono come eventi agente/sessione

`agentLoop.streamAssistantResponse()` collega `AssistantMessageEvent` ad `AgentEvent`:

- su `start`: inserisce un messaggio placeholder dell'assistente ed emette `message_start`
- sugli eventi di blocco (`text_*`, `thinking_*`, `toolcall_*`): aggiorna l'ultimo messaggio dell'assistente, emette `message_update` con il `assistantMessageEvent` grezzo
- sul terminale (`done`/`error`): risolve il messaggio finale da `response.result()`, emette `message_end`

`AgentSession` consuma quindi tali eventi per i comportamenti a livello di sessione:

- TTSR osserva `message_update.assistantMessageEvent` per `text_delta` e `toolcall_delta`
- il guard delle modifiche in streaming ispeziona `toolcall_delta`/`toolcall_end` sulle chiamate `edit` e può interrompersi anticipatamente
- la persistenza scrive i messaggi finalizzati su `message_end`
- l'auto-retry esamina il `stopReason === "error"` dell'assistente più le euristiche di `errorMessage`

## Responsabilità unificate vs specifiche del provider

Unificate (contratto comune):

- forma dell'evento (`AssistantMessageEvent`)
- estrazione del risultato finale (`done`/`error`)
- regole di limitazione e unione dei delta
- modello di propagazione degli eventi agente/sessione

Specifiche del provider (non completamente astratte):

- tassonomie degli eventi upstream e logica di mappatura
- tabelle di traduzione dei motivi di arresto
- convenzioni sugli ID delle chiamate strumento
- semantica e firme dei blocchi di ragionamento/pensiero
- semantica dei token di utilizzo e tempistica di disponibilità
- vincoli di conversione dei messaggi per API

## File di implementazione

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — dispatch del provider, mappatura delle opzioni, collegamento di chiavi API/sessione.
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — coda di stream generica + limitazione dei delta dell'assistente.
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — parsing JSON parziale per gli argomenti degli strumenti in streaming.
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — traduzione degli eventi Anthropic e accumulazione dei delta JSON degli strumenti.
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — traduzione degli eventi OpenAI Responses e mappatura degli stati.
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — traduzione chunk-to-block dello stream Gemini.
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — mappatura del motivo di fine Gemini e regole di conversione condivise.
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — consumo dello stream del provider e bridging di `message_update`.
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — gestione a livello di sessione degli aggiornamenti in streaming, abort, retry e persistenza.
