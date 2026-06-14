---
title: Elementi interni dello streaming del provider
description: >-
  Implementazione dello streaming del provider con analisi SSE, conteggio dei
  token e gestione della contropressione.
sidebar:
  order: 2
  label: Elementi interni dello streaming
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# Elementi interni dello streaming del provider

Questo documento spiega come lo streaming di token/strumenti viene normalizzato in `@f5xc-salesdemos/pi-ai`, quindi propagato attraverso gli eventi di sessione di `@f5xc-salesdemos/pi-agent-core` e `coding-agent`.

## Flusso end-to-end

1. `streamSimple()` (`packages/ai/src/stream.ts`) mappa le opzioni generiche e le invia a una funzione di stream del provider.
2. Le funzioni di stream del provider (`anthropic.ts`, `openai-responses.ts`, `google.ts`) traducono gli eventi di stream nativi del provider nella sequenza unificata `AssistantMessageEvent`.
3. Ogni provider inserisce eventi in `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`), che limita gli eventi delta ed espone:
   - iterazione asincrona per aggiornamenti incrementali
   - `result()` per il `AssistantMessage` finale
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) consuma tali eventi, aggiorna lo stato dell'assistente in volo ed emette eventi `message_update` che trasportano il `assistantMessageEvent` grezzo.
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) si iscrive agli eventi dell'agente, persiste i messaggi, gestisce gli hook di estensione e applica i comportamenti di sessione (retry, compaction, TTSR, controlli di interruzione dello streaming-edit).

## Contratto di stream unificato in `@f5xc-salesdemos/pi-ai`

Tutti i provider emettono la stessa forma (`AssistantMessageEvent` in `packages/ai/src/types.ts`):

- `start`
- triplette del ciclo di vita del blocco di contenuto:
  - testo: `text_start` → `text_delta`* → `text_end`
  - thinking: `thinking_start` → `thinking_delta`* → `thinking_end`
  - chiamata strumento: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- evento terminale:
  - `done` con `reason: "stop" | "length" | "toolUse"`
  - oppure `error` con `reason: "aborted" | "error"`

`AssistantMessageEventStream` garantisce:

- il risultato finale viene risolto dall'evento terminale (`done` o `error`)
- i delta vengono raggruppati/limitati (~50ms)
- i delta nel buffer vengono scaricati prima degli eventi non-delta e prima del completamento

## Comportamento di limitazione e armonizzazione dei delta

`AssistantMessageEventStream` tratta `text_delta`, `thinking_delta` e `toolcall_delta` come eventi unificabili:

- i delta nel buffer vengono uniti solo quando **type + contentIndex** corrispondono
- l'unione mantiene lo snapshot `partial` più recente
- gli eventi non-delta forzano lo scaricamento immediato

Questo uniforma i flussi ad alta frequenza del provider per i consumer TUI/eventi, ma non costituisce contropressione del provider: i provider continuano a produrre alla massima velocità, mentre il flusso locale bufferizza.

## Dettagli di normalizzazione del provider

## Anthropic (`anthropic-messages`)

Sorgente: `packages/ai/src/providers/anthropic.ts`

Punti di normalizzazione:

- `message_start` inizializza l'utilizzo (token di input/output/cache)
- `content_block_start` mappa gli avvii di testo/thinking/toolcall
- `content_block_delta` mappa:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` aggiorna solo `thinkingSignature` (nessun evento)
- `content_block_stop` emette il corrispondente `*_end`
- `message_delta.stop_reason` mappa tramite `mapStopReason()`

Streaming degli argomenti della chiamata strumento:

- ogni blocco strumento porta un `partialJson` interno
- ogni delta JSON si aggiunge a `partialJson`
- gli `arguments` vengono rianalizzati a ogni delta tramite `parseStreamingJson()`
- `toolcall_end` rianalizza un'ultima volta, quindi rimuove `partialJson`

## OpenAI Responses (`openai-responses`)

Sorgente: `packages/ai/src/providers/openai-responses.ts`

Punti di normalizzazione:

- `response.output_item.added` avvia i blocchi di reasoning/testo/function-call
- gli eventi di riepilogo del reasoning (`response.reasoning_summary_text.delta`) diventano `thinking_delta`
- i delta di output/refusal diventano `text_delta`
- `response.function_call_arguments.delta` diventa `toolcall_delta`
- `response.output_item.done` emette `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` mappa lo stato al motivo di stop e all'utilizzo

Streaming degli argomenti della chiamata strumento:

- stesso schema di accumulo `partialJson` di Anthropic
- i provider che inviano solo `response.function_call_arguments.done` popolano comunque gli argomenti finali
- gli ID delle chiamate strumento sono normalizzati come `"<call_id>|<item_id>"`

## Google Generative AI (`google-generative-ai`)

Sorgente: `packages/ai/src/providers/google.ts`

Punti di normalizzazione:

- itera `candidate.content.parts`
- le parti di testo vengono suddivise in thinking e testo tramite `isThinkingPart(part)`
- le transizioni di blocco chiudono il blocco precedente prima di avviarne uno nuovo
- `part.functionCall` viene trattata come una chiamata strumento completa (start/delta/end emessi immediatamente)
- il motivo di fine viene mappato da `mapStopReason()` in `google-shared.ts`

Streaming degli argomenti della chiamata strumento:

- gli argomenti della chiamata di funzione arrivano come oggetto strutturato, non come testo JSON incrementale
- l'implementazione emette un singolo `toolcall_delta` sintetico contenente `JSON.stringify(arguments)`
- nessun parser JSON parziale necessario per Google in questo percorso

## Accumulo e recupero del JSON parziale della chiamata strumento

Il comportamento condiviso per Anthropic/OpenAI Responses utilizza `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. tentativo con `JSON.parse`
2. fallback al parser `partial-json` per frammenti incompleti
3. se entrambi falliscono, restituisce `{}`

Implicazioni:

- i delta di argomenti malformati o troncati non interrompono immediatamente l'elaborazione dello stream
- gli `arguments` in corso potrebbero temporaneamente essere `{}`
- delta validi successivi possono recuperare argomenti strutturati poiché il parsing viene ritentato a ogni aggiunta
- il `toolcall_end` finale esegue un ulteriore tentativo di parsing prima dell'emissione

## Motivi di stop vs errori di trasporto/runtime

I motivi di stop del provider vengono mappati al `stopReason` normalizzato:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, casi safety/refusal→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, classi safety/prohibited/malformed-function-call→`error`

La semantica degli errori è suddivisa in due fasi:

1. **Semantica di completamento del modello** (motivo/stato di fine riportato dal provider)
2. **Errore di trasporto/runtime** (eccezioni di rete/client/parser/abort)

Se il flusso del provider genera un'eccezione o segnala un errore, ogni wrapper del provider intercetta ed emette un evento `error` terminale con:

- `stopReason = "aborted"` quando il segnale di abort è impostato
- altrimenti `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## Comportamento in caso di chunk malformato / errore di parsing SSE

Per questi percorsi del provider, il framing chunk/SSE è gestito dagli stream dell'SDK del fornitore (Anthropic SDK, OpenAI SDK, Google SDK). Questo codice non implementa un decoder SSE personalizzato.

Comportamento osservato nell'implementazione attuale:

- il parsing malformato di chunk/SSE a livello SDK si manifesta come un'eccezione o un evento `error` dello stream
- il wrapper del provider converte tale errore in un evento `error` terminale unificato
- nessun resume/retry specifico del provider all'interno della funzione di stream
- i retry di livello superiore sono gestiti dalla logica di auto-retry di `AgentSession` (retry a livello di messaggio, non replay di chunk dello stream)

## Confini di cancellazione

La cancellazione è strutturata a livelli:

- Richiesta al provider IA: `options.signal` viene passato nella chiamata di stream del client del provider.
- Wrapper del provider: dopo il ciclo dello stream, il segnale interrotto forza il percorso di errore (`"Request was aborted"`).
- Agent loop: controlla `signal.aborted` prima di gestire ogni evento del provider e può sintetizzare un messaggio dell'assistente interrotto dall'ultimo dato parziale disponibile.
- Controlli di sessione/agente: `AgentSession.abort()` -> `agent.abort()` -> cancellazione dell'abort controller condiviso.

La cancellazione dell'esecuzione degli strumenti è separata dalla cancellazione del flusso del modello:

- i runner degli strumenti utilizzano `AbortSignal.any([agentSignal, steeringAbortSignal])`
- le interruzioni di steering possono interrompere l'esecuzione degli strumenti rimanenti preservando i risultati degli strumenti già prodotti

## Confini di contropressione

Non esiste un meccanismo di contropressione rigida tra lo stream dell'SDK del provider e i consumer a valle:

- `EventStream` utilizza code in memoria senza dimensione massima
- la limitazione riduce la frequenza di aggiornamento dell'interfaccia utente ma non rallenta l'acquisizione dal provider
- se i consumer accumulano ritardi significativi, gli eventi in coda possono crescere fino al completamento

Il design attuale privilegia la reattività e la semplicità dell'ordinamento rispetto al controllo del flusso con buffer limitato.

## Come gli eventi di stream emergono come eventi agente/sessione

`agentLoop.streamAssistantResponse()` collega `AssistantMessageEvent` a `AgentEvent`:

- su `start`: inserisce un messaggio placeholder dell'assistente ed emette `message_start`
- sugli eventi di blocco (`text_*`, `thinking_*`, `toolcall_*`): aggiorna l'ultimo messaggio dell'assistente, emette `message_update` con il `assistantMessageEvent` grezzo
- sul terminale (`done`/`error`): risolve il messaggio finale da `response.result()`, emette `message_end`

`AgentSession` consuma quindi tali eventi per i comportamenti a livello di sessione:

- TTSR monitora `message_update.assistantMessageEvent` per `text_delta` e `toolcall_delta`
- la guardia di editing in streaming ispeziona `toolcall_delta`/`toolcall_end` sulle chiamate `edit` e può interrompere anticipatamente
- la persistenza scrive i messaggi finalizzati su `message_end`
- l'auto-retry esamina `stopReason === "error"` dell'assistente più le euristiche di `errorMessage`

## Responsabilità unificate vs specifiche del provider

Unificate (contratto comune):

- forma degli eventi (`AssistantMessageEvent`)
- estrazione del risultato finale (`done`/`error`)
- regole di limitazione e unione dei delta
- modello di propagazione degli eventi agente/sessione

Specifiche del provider (non completamente astratte):

- tassonomie degli eventi upstream e logica di mappatura
- tabelle di traduzione dei motivi di stop
- convenzioni degli ID delle chiamate strumento
- semantica e firme dei blocchi reasoning/thinking
- semantica dei token di utilizzo e tempistiche di disponibilità
- vincoli di conversione dei messaggi per API

## File di implementazione

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — dispatch del provider, mappatura delle opzioni, gestione di chiavi API/sessione.
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — coda dello stream generica + limitazione dei delta dell'assistente.
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — parsing JSON parziale per gli argomenti degli strumenti in streaming.
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — traduzione degli eventi Anthropic e accumulo dei delta JSON degli strumenti.
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — traduzione degli eventi OpenAI Responses e mappatura degli stati.
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — traduzione da chunk dello stream Gemini a blocchi.
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — mappatura dei motivi di fine Gemini e regole di conversione condivise.
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — consumo dello stream del provider e bridging di `message_update`.
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — gestione a livello di sessione degli aggiornamenti dello streaming, abort, retry e persistenza.
