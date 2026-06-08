---
title: Internos del Streaming de Proveedores
description: >-
  Implementación del streaming de proveedores con análisis SSE, conteo de tokens
  y manejo de contrapresión.
sidebar:
  order: 2
  label: Internos del streaming
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# Internos del streaming de proveedores

Este documento explica cómo el streaming de tokens/herramientas se normaliza en `@f5xc-salesdemos/pi-ai`, y luego se propaga a través de `@f5xc-salesdemos/pi-agent-core` y los eventos de sesión de `coding-agent`.

## Flujo de extremo a extremo

1. `streamSimple()` (`packages/ai/src/stream.ts`) mapea opciones genéricas y despacha a una función de stream del proveedor.
2. Las funciones de stream del proveedor (`anthropic.ts`, `openai-responses.ts`, `google.ts`) traducen los eventos nativos del stream del proveedor a la secuencia unificada `AssistantMessageEvent`.
3. Cada proveedor envía eventos a `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`), que limita los eventos delta y expone:
   - iteración asíncrona para actualizaciones incrementales
   - `result()` para el `AssistantMessage` final
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) consume esos eventos, muta el estado del asistente en curso y emite eventos `message_update` que transportan el `assistantMessageEvent` sin procesar.
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) se suscribe a los eventos del agente, persiste mensajes, ejecuta hooks de extensión y aplica comportamientos de sesión (reintento, compactación, TTSR, verificaciones de aborto de edición en streaming).

## Contrato unificado de stream en `@f5xc-salesdemos/pi-ai`

Todos los proveedores emiten la misma forma (`AssistantMessageEvent` en `packages/ai/src/types.ts`):

- `start`
- tripletas de ciclo de vida de bloques de contenido:
  - texto: `text_start` → `text_delta`* → `text_end`
  - pensamiento: `thinking_start` → `thinking_delta`* → `thinking_end`
  - llamada a herramienta: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- evento terminal:
  - `done` con `reason: "stop" | "length" | "toolUse"`
  - o `error` con `reason: "aborted" | "error"`

`AssistantMessageEventStream` garantiza:

- el resultado final se resuelve mediante el evento terminal (`done` o `error`)
- los deltas se agrupan/limitan (~50ms)
- los deltas almacenados en buffer se vacían antes de los eventos no-delta y antes de la finalización

## Comportamiento de limitación y armonización de deltas

`AssistantMessageEventStream` trata `text_delta`, `thinking_delta` y `toolcall_delta` como eventos fusionables:

- los deltas almacenados en buffer solo se fusionan cuando **tipo + contentIndex** coinciden
- la fusión mantiene la última instantánea `partial`
- los eventos no-delta fuerzan un vaciado inmediato

Esto suaviza los streams de alta frecuencia del proveedor para consumidores TUI/eventos, pero no es contrapresión del proveedor: los proveedores siguen produciendo a máxima velocidad, mientras el stream local almacena en buffer.

## Detalles de normalización por proveedor

## Anthropic (`anthropic-messages`)

Fuente: `packages/ai/src/providers/anthropic.ts`

Puntos de normalización:

- `message_start` inicializa el uso (tokens de entrada/salida/caché)
- `content_block_start` se mapea a inicios de texto/pensamiento/llamada a herramienta
- `content_block_delta` mapea:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` actualiza `thinkingSignature` solamente (sin evento)
- `content_block_stop` emite el `*_end` correspondiente
- `message_delta.stop_reason` se mapea mediante `mapStopReason()`

Streaming de argumentos de llamada a herramienta:

- cada bloque de herramienta lleva un `partialJson` interno
- cada delta JSON se añade a `partialJson`
- los `arguments` se re-analizan en cada delta mediante `parseStreamingJson()`
- `toolcall_end` re-analiza una vez más, luego elimina `partialJson`

## OpenAI Responses (`openai-responses`)

Fuente: `packages/ai/src/providers/openai-responses.ts`

Puntos de normalización:

- `response.output_item.added` inicia bloques de razonamiento/texto/llamada a función
- los eventos de resumen de razonamiento (`response.reasoning_summary_text.delta`) se convierten en `thinking_delta`
- los deltas de salida/rechazo se convierten en `text_delta`
- `response.function_call_arguments.delta` se convierte en `toolcall_delta`
- `response.output_item.done` emite `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` mapea el estado a razón de parada y uso

Streaming de argumentos de llamada a herramienta:

- mismo patrón de acumulación `partialJson` que Anthropic
- los proveedores que solo envían `response.function_call_arguments.done` aún populan los argumentos finales
- los IDs de llamada a herramienta se normalizan como `"<call_id>|<item_id>"`

## Google Generative AI (`google-generative-ai`)

Fuente: `packages/ai/src/providers/google.ts`

Puntos de normalización:

- itera `candidate.content.parts`
- las partes de texto se dividen en pensamiento vs texto mediante `isThinkingPart(part)`
- las transiciones de bloque cierran el bloque anterior antes de iniciar uno nuevo
- `part.functionCall` se trata como una llamada a herramienta completa (start/delta/end se emiten inmediatamente)
- la razón de finalización se mapea mediante `mapStopReason()` desde `google-shared.ts`

Streaming de argumentos de llamada a herramienta:

- los argumentos de llamada a función llegan como objeto estructurado, no como texto JSON incremental
- la implementación emite un `toolcall_delta` sintético que contiene `JSON.stringify(arguments)`
- no se necesita analizador de JSON parcial para Google en esta ruta

## Acumulación y recuperación de JSON parcial en llamadas a herramienta

El comportamiento compartido para Anthropic/OpenAI Responses usa `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. intenta `JSON.parse`
2. recurre al analizador `partial-json` para fragmentos incompletos
3. si ambos fallan, retorna `{}`

Implicaciones:

- los deltas de argumentos malformados o truncados no causan un fallo inmediato en el procesamiento del stream
- los `arguments` en curso pueden ser temporalmente `{}`
- deltas válidos posteriores pueden recuperar los argumentos estructurados porque el análisis se reintenta en cada adición
- el `toolcall_end` final realiza un último intento de análisis antes de la emisión

## Razones de parada vs errores de transporte/tiempo de ejecución

Las razones de parada del proveedor se mapean a `stopReason` normalizado:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, casos de seguridad/rechazo→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, clases de seguridad/prohibido/llamada-a-función-malformada→`error`

La semántica de errores se divide en dos etapas:

1. **Semántica de completación del modelo** (razón de finalización/estado reportado por el proveedor)
2. **Fallo de transporte/tiempo de ejecución** (excepciones de red/cliente/analizador/aborto)

Si el stream del proveedor lanza una excepción o señala un fallo, cada wrapper de proveedor captura y emite un evento terminal `error` con:

- `stopReason = "aborted"` cuando la señal de aborto está activada
- de lo contrario `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## Comportamiento ante chunks malformados / fallos de análisis SSE

Para estas rutas de proveedor, el enmarcado de chunks/SSE es manejado por los streams del SDK del vendor (Anthropic SDK, OpenAI SDK, Google SDK). Este código no implementa un decodificador SSE personalizado aquí.

Comportamiento observado en la implementación actual:

- el análisis de chunks/SSE malformados a nivel de SDK se manifiesta como una excepción o evento `error` del stream
- el wrapper del proveedor lo convierte en un evento terminal unificado `error`
- no hay reanudación/reintento específico del proveedor dentro de la función de stream misma
- los reintentos de nivel superior se manejan en la lógica de reintento automático de `AgentSession` (reintento a nivel de mensaje, no reproducción de chunks del stream)

## Límites de cancelación

La cancelación se organiza en capas:

- Solicitud al proveedor de IA: `options.signal` se pasa a la llamada del stream del cliente del proveedor.
- Wrapper del proveedor: después del bucle del stream, una señal abortada fuerza la ruta de error (`"Request was aborted"`).
- Bucle del agente: verifica `signal.aborted` antes de manejar cada evento del proveedor y puede sintetizar un mensaje de asistente abortado a partir del parcial más reciente.
- Controles de sesión/agente: `AgentSession.abort()` -> `agent.abort()` -> cancelación del controlador de aborto compartido.

La cancelación de ejecución de herramientas es separada de la cancelación del stream del modelo:

- los ejecutores de herramientas usan `AbortSignal.any([agentSignal, steeringAbortSignal])`
- las interrupciones de dirección pueden abortar la ejecución de herramientas restantes mientras preservan los resultados de herramientas ya producidos

## Límites de contrapresión

No existe un mecanismo de contrapresión estricto entre el stream del SDK del proveedor y los consumidores posteriores:

- `EventStream` usa colas en memoria sin tamaño máximo
- la limitación reduce la tasa de actualización de la UI pero no ralentiza la ingesta del proveedor
- si los consumidores se retrasan significativamente, los eventos en cola pueden crecer hasta la finalización

El diseño actual favorece la capacidad de respuesta y el ordenamiento simple sobre el control de flujo con buffer limitado.

## Cómo los eventos de stream se manifiestan como eventos de agente/sesión

`agentLoop.streamAssistantResponse()` conecta `AssistantMessageEvent` con `AgentEvent`:

- en `start`: inserta un mensaje de asistente provisional y emite `message_start`
- en eventos de bloque (`text_*`, `thinking_*`, `toolcall_*`): actualiza el último mensaje del asistente, emite `message_update` con el `assistantMessageEvent` sin procesar
- en terminal (`done`/`error`): resuelve el mensaje final desde `response.result()`, emite `message_end`

`AgentSession` luego consume esos eventos para comportamientos a nivel de sesión:

- TTSR observa `message_update.assistantMessageEvent` en busca de `text_delta` y `toolcall_delta`
- la protección de edición en streaming inspecciona `toolcall_delta`/`toolcall_end` en llamadas `edit` y puede abortar anticipadamente
- la persistencia escribe mensajes finalizados en `message_end`
- el reintento automático examina `stopReason === "error"` del asistente más heurísticas de `errorMessage`

## Responsabilidades unificadas vs específicas del proveedor

Unificadas (contrato común):

- forma del evento (`AssistantMessageEvent`)
- extracción del resultado final (`done`/`error`)
- reglas de limitación + fusión de deltas
- modelo de propagación de eventos agente/sesión

Específicas del proveedor (no completamente abstraídas):

- taxonomías de eventos upstream y lógica de mapeo
- tablas de traducción de razones de parada
- convenciones de ID de llamada a herramienta
- semántica de bloques de razonamiento/pensamiento y firmas
- semántica de tokens de uso y disponibilidad temporal
- restricciones de conversión de mensajes por API

## Archivos de implementación

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — despacho al proveedor, mapeo de opciones, canalización de clave API/sesión.
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — cola de stream genérica + limitación de deltas del asistente.
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — análisis de JSON parcial para argumentos de herramientas en streaming.
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — traducción de eventos de Anthropic y acumulación de deltas JSON de herramientas.
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — traducción de eventos de OpenAI Responses y mapeo de estados.
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — traducción de chunks de stream a bloques de Gemini.
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — mapeo de razones de finalización de Gemini y reglas de conversión compartidas.
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — consumo del stream del proveedor y puente de `message_update`.
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — manejo a nivel de sesión de actualizaciones de streaming, aborto, reintento y persistencia.
