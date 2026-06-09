---
title: Protocolo MCP e internos de transporte
description: >-
  Implementación del protocolo MCP con capas de transporte stdio, SSE y HTTP
  streamable.
sidebar:
  order: 2
  label: Protocolo y transportes
i18n:
  sourceHash: 48632064dd00
  translator: machine
---

# Protocolo MCP e internos de transporte

Este documento describe cómo coding-agent implementa la mensajería JSON-RPC de MCP y cómo las responsabilidades del protocolo se separan de las responsabilidades de transporte.

## Alcance

Cubre:

- Flujo de solicitud/respuesta y notificaciones JSON-RPC
- Correlación de solicitudes y ciclo de vida para transportes stdio y HTTP/SSE
- Comportamiento de timeout y cancelación
- Propagación de errores y manejo de payloads malformados
- Límites de selección de transporte (`stdio` vs `http`/`sse`)
- Qué responsabilidades de reconexión/reintentos son a nivel de transporte vs a nivel de manager

No cubre la experiencia de autoría de extensiones ni la interfaz de comandos.

## Archivos de implementación

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/transports/stdio.ts`](../../packages/coding-agent/src/mcp/transports/stdio.ts)
- [`src/mcp/transports/http.ts`](../../packages/coding-agent/src/mcp/transports/http.ts)
- [`src/mcp/transports/index.ts`](../../packages/coding-agent/src/mcp/transports/index.ts)
- [`src/mcp/json-rpc.ts`](../../packages/coding-agent/src/mcp/json-rpc.ts)
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)

## Límites entre capas

### Capa de protocolo (JSON-RPC + métodos MCP)

- Las formas de los mensajes se definen en `types.ts` (`JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcResponse`, `JsonRpcMessage`).
- La lógica del cliente MCP (`client.ts`) decide el orden de los métodos y el handshake de sesión:
  1. Solicitud `initialize`
  2. Notificación `notifications/initialized`
  3. Llamadas a métodos como `tools/list`, `tools/call`

### Capa de transporte (`MCPTransport`)

`MCPTransport` abstrae la entrega y el ciclo de vida:

- `request(method, params, options?) -> Promise<T>`
- `notify(method, params?) -> Promise<void>`
- `close()`
- `connected`
- callbacks opcionales: `onClose`, `onError`, `onNotification`

Las implementaciones de transporte gestionan el enmarcado y los detalles de E/S:

- `StdioTransport`: JSON delimitado por saltos de línea sobre stdio de subprocesos
- `HttpTransport`: JSON-RPC sobre HTTP POST, con respuestas/escucha SSE opcionales

### Advertencia importante actual

Los callbacks de transporte (`onClose`, `onError`, `onNotification`) están implementados, pero los flujos actuales de `MCPClient`/`MCPManager` no conectan la lógica de reconexión a estos callbacks. Las notificaciones solo se consumen si el llamante registra handlers.

## Selección de transporte

`client.ts:createTransport()` elige el transporte a partir de la configuración:

- `type` omitido o `"stdio"` -> `createStdioTransport`
- `"http"` o `"sse"` -> `createHttpTransport`

`"sse"` se trata como una variante de transporte HTTP (misma clase), no como una implementación de transporte separada.

## Flujo de mensajes JSON-RPC y correlación

## IDs de solicitud

Cada transporte genera IDs por solicitud (cadena de `Math.random` + timestamp). Los IDs son tokens de correlación locales al transporte.

## Ruta de correlación en stdio

- La solicitud saliente se serializa como un objeto JSON + `\n`.
- `#pendingRequests: Map<id, {resolve,reject}>` almacena las solicitudes en vuelo.
- El bucle de lectura parsea JSONL desde stdout y llama a `#handleMessage`.
- Si el mensaje entrante tiene un `id` coincidente, la solicitud se resuelve/rechaza.
- Si el mensaje entrante tiene `method` y no tiene `id`, se trata como notificación y se envía a `onNotification`.

Los IDs desconocidos se ignoran (sin rechazo, sin callback de error).

## Ruta de correlación en HTTP

- La solicitud saliente es un HTTP `POST` con cuerpo JSON e `id` generado.
- Ruta de respuesta no SSE: parsea una respuesta JSON-RPC y retorna `result`/lanza error en caso de `error`.
- Ruta de respuesta SSE (`Content-Type: text/event-stream`): transmite eventos, retorna el primer mensaje cuyo `id` coincida con el ID de solicitud esperado y tenga `result` o `error`.
- Los mensajes SSE con `method` y sin `id` se tratan como notificaciones.

Si el stream SSE termina antes de la respuesta coincidente, la solicitud falla con `No response received for request ID ...`.

## Notificaciones

El cliente emite notificaciones JSON-RPC mediante `transport.notify(...)`.

- Stdio: escribe el frame de notificación en stdin (`jsonrpc`, `method`, `params` opcional) más salto de línea.
- HTTP: envía cuerpo POST sin `id`; el éxito acepta `2xx` o `202 Accepted`.

Las notificaciones iniciadas por el servidor solo se exponen a través de `onNotification` del transporte; no hay un suscriptor global predeterminado en manager/client.

## Internos del transporte stdio

## Ciclo de vida y transiciones de estado

- Inicial: `connected=false`, `process=null`, mapa de pendientes vacío
- `connect()`:
  - genera subproceso con command/args/env/cwd configurados
  - marca como conectado
  - inicia bucle de lectura de stdout (`readJsonl`)
  - inicia bucle de stderr (lectura/descarte; actualmente silencioso)
- `close()`:
  - marca como desconectado
  - rechaza todas las solicitudes pendientes (`Transport closed`)
  - mata el subproceso
  - espera el cierre del bucle de lectura
  - emite `onClose`

Si el bucle de lectura termina inesperadamente, `finally` dispara `#handleClose()` que realiza el mismo rechazo de solicitudes pendientes y callback de cierre.

## Timeout y cancelación

Por solicitud:

- el timeout por defecto es `config.timeout ?? 30000`
- `AbortSignal` opcional del llamante
- tanto abort como timeout rechazan la promesa pendiente y limpian la entrada del mapa

La cancelación es solo local: el transporte no envía una notificación de cancelación a nivel de protocolo al servidor.

## Manejo de payloads malformados

En el bucle de lectura:

- cada línea JSONL parseada se pasa a `#handleMessage` dentro de `try/catch`
- las excepciones de manejo de mensajes malformados/inválidos se descartan (comentario `Skip malformed lines`)
- el bucle continúa, así que un mensaje erróneo no mata la conexión

Si el parser del stream subyacente lanza una excepción, se invoca `onError` (cuando aún está conectado), luego la conexión se cierra.

## Comportamiento de desconexión/fallo

Cuando el proceso termina o el stream se cierra:

- todas las solicitudes en vuelo se rechazan con `Transport closed`
- no hay reinicio o reconexión automática
- las capas superiores deben reconectar creando un nuevo transporte

## Notas sobre backpressure/streaming

- Las escrituras salientes usan `stdin.write()` + `flush()` sin esperar semánticas de drain.
- No hay cola explícita ni gestión de high-watermark en el transporte.
- El procesamiento entrante está impulsado por stream (`for await` sobre `readJsonl`), un mensaje parseado a la vez.

## Internos del transporte HTTP/SSE

## Ciclo de vida y semánticas de conexión

El transporte HTTP tiene estado de conexión lógico, pero la ruta de solicitudes es sin estado por llamada HTTP:

- `connect()` establece `connected=true` (sin handshake de socket/sesión)
- seguimiento opcional de sesión del servidor mediante el header `Mcp-Session-Id`
- `close()` opcionalmente envía `DELETE` con `Mcp-Session-Id`, aborta el listener SSE, emite `onClose`

Así que `connected` significa "transporte utilizable", no "stream persistente establecido".

## Comportamiento del header de sesión

- En la respuesta POST, si el header `Mcp-Session-Id` está presente, el transporte lo almacena.
- Las solicitudes/notificaciones subsiguientes incluyen `Mcp-Session-Id`.
- `close()` intenta terminar la sesión del servidor con HTTP DELETE; los fallos de terminación se ignoran.

## Timeout y cancelación

Tanto para `request()` como para `notify()`:

- el timeout usa `AbortController` (`config.timeout ?? 30000`)
- la señal externa, si se proporciona, se fusiona mediante `AbortSignal.any([...])`
- el manejo de AbortError distingue entre abort del llamante vs timeout

Errores lanzados:

- timeout: `Request timeout after ...ms` (o `SSE response timeout ...`, `Notify timeout ...`)
- abort del llamante: el AbortError original se relanza cuando la señal externa ya está abortada

## Propagación de errores HTTP

En respuesta no OK:

- el texto de la respuesta se incluye en el error lanzado (`HTTP <status>: <text>`)
- si están presentes, las indicaciones de autenticación de `WWW-Authenticate` y `Mcp-Auth-Server` se adjuntan

En objeto de error JSON-RPC:

- lanza `MCP error <code>: <message>`

El cuerpo JSON malformado (fallo en `response.json()`) se propaga como excepción de parseo.

## Comportamiento y modos SSE

Existen dos rutas SSE:

1. **Respuesta SSE por solicitud** (`#parseSSEResponse`)
   - se usa cuando el content type de la respuesta POST es `text/event-stream`
   - consume el stream hasta encontrar el id de respuesta coincidente
   - puede procesar notificaciones intercaladas durante el mismo stream

2. **Listener SSE en segundo plano** (`startSSEListener()`)
   - listener GET opcional para notificaciones iniciadas por el servidor
   - actualmente no se inicia automáticamente por MCP manager/client
   - si GET retorna `405`, el listener se deshabilita silenciosamente (el servidor no soporta este modo)

## Manejo de payloads malformados y desconexión

Los errores de parseo JSON en SSE emergen de `readSseJson` y rechazan la solicitud/listener.

- Los errores de parseo SSE de solicitud rechazan la solicitud activa.
- Los errores del listener en segundo plano disparan `onError` (excepto AbortError).
- No hay auto-reconexión para el listener en segundo plano.

## Utilidad `json-rpc.ts` vs abstracción de transporte

`src/mcp/json-rpc.ts` proporciona helpers `callMCP()` y `parseSSE()` para llamadas HTTP MCP directas (usado por la integración con Exa), no la abstracción `MCPTransport` utilizada por `MCPClient`/`MCPManager`.

Diferencias notables respecto a `HttpTransport`:

- parsea primero el texto completo de la respuesta, luego extrae la primera línea `data:` (`parseSSE`), con fallback a JSON
- sin gestión de timeout de solicitud, sin API de abort, sin manejo de session-id, sin ciclo de vida de transporte
- retorna el objeto envelope JSON-RPC en bruto

Esta ruta es ligera pero menos robusta que la implementación completa de transporte.

## Responsabilidades de reintento/reconexión

## Nivel de transporte

Las implementaciones actuales de transporte **no**:

- reintentan solicitudes fallidas
- reconectan tras la salida del proceso stdio
- reconectan listeners SSE
- reenvían solicitudes en vuelo tras desconexión

Fallan rápidamente y propagan los errores.

## Nivel de manager/client

`MCPManager` maneja la orquestación de descubrimiento/conexión inicial y solo puede reconectar ejecutando nuevamente los flujos de conexión (rutas `connectToServer`/`discoverAndConnect`). No repara automáticamente un transporte ya conectado ante callbacks de fallo en tiempo de ejecución.

`MCPManager` tiene comportamiento de fallback en el inicio para servidores lentos (herramientas diferidas desde caché), pero eso es fallback de disponibilidad de herramientas, no reintento de transporte.

## Resumen de escenarios de fallo

- **Línea de mensaje stdio malformada**: descartada; el stream continúa.
- **Stream/proceso stdio termina**: el transporte se cierra; solicitudes pendientes rechazadas como `Transport closed`.
- **HTTP no 2xx**: solicitud/notificación lanza error HTTP.
- **Respuesta JSON inválida**: excepción de parseo propagada.
- **SSE termina sin id coincidente**: la solicitud falla con `No response received for request ID ...`.
- **Timeout**: error de timeout específico del transporte.
- **Abort del llamante**: AbortError/razón propagado desde la señal del llamante.

## Regla práctica de límites

Si la responsabilidad es la forma del mensaje, la correlación de IDs o el orden de métodos MCP, pertenece a la lógica de protocolo/cliente.

Si la responsabilidad es el enmarcado (JSONL vs HTTP/SSE), el parseo de streams, el ciclo de vida de fetch/spawn, los temporizadores de timeout o el cierre de conexión, pertenece a la implementación de transporte.
