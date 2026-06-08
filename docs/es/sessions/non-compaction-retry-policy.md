---
title: Non-Compaction Auto-Retry Policy
description: >-
  Política de reintento automático para fallos transitorios de API fuera de la
  ruta de compactación.
sidebar:
  order: 6
  label: Retry policy
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# Política de reintento automático fuera de compactación

Este documento describe la ruta estándar de reintento ante errores de API en `AgentSession`.

Excluye explícitamente la recuperación por desbordamiento de contexto mediante auto-compactación. El desbordamiento se gestiona mediante la lógica de compactación y está documentado por separado en [`compaction.md`](./compaction.md).

## Archivos de implementación

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## Límite de alcance frente a compactación

El reintento y la compactación se verifican desde la misma ruta `agent_end`, pero están separados intencionalmente:

1. `agent_end` inspecciona el último mensaje del asistente.
2. `#isRetryableError(...)` se ejecuta primero.
3. Si se inicia un reintento, las verificaciones de compactación se omiten para ese turno.
4. Los errores de desbordamiento de contexto se excluyen permanentemente de la clasificación de reintento (`isContextOverflow(...)` cortocircuita el reintento).
5. Por lo tanto, el desbordamiento pasa a `#checkCompaction(...)` en lugar del reintento estándar.

Así que: los fallos de tipo sobrecarga/límite de tasa/servidor/red utilizan esta política de reintento; el desbordamiento de ventana de contexto utiliza la recuperación por compactación.

## Clasificación de reintentos

`#isRetryableError(...)` requiere todo lo siguiente:

- `stopReason === "error"` del asistente
- `errorMessage` existe
- el mensaje **no** es un desbordamiento de contexto
- `errorMessage` coincide con `#isRetryableErrorMessage(...)`

Conjunto actual de patrones reintentables (basado en regex):

- overloaded
- rate limit / usage limit / too many requests
- Clases de servidor tipo HTTP: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- Expresión `retry delay`

Esta es una clasificación por patrones de texto, no por códigos de error tipados del proveedor.

## Ciclo de vida del reintento y transiciones de estado

Estado de sesión utilizado por el reintento:

- `#retryAttempt: number` (`0` significa inactivo)
- `#retryPromise: Promise<void> | undefined` (rastrea el ciclo de vida del reintento en curso)
- `#retryResolve: (() => void) | undefined` (resuelve `#retryPromise`)
- `#retryAbortController: AbortController | undefined` (cancela la espera de backoff)

Flujo (`#handleRetryableError`):

1. Leer el grupo de configuración `retry`.
2. Si `retry.enabled === false`, detenerse inmediatamente (`false`, no se inicia reintento).
3. Incrementar `#retryAttempt`.
4. Crear `#retryPromise` una vez (primer intento en una cadena).
5. Si el intento excede `retry.maxRetries`, emitir evento de fallo final y detenerse.
6. Calcular retardo: `retry.baseDelayMs * 2^(attempt-1)`.
7. Para errores de límite de uso, analizar las indicaciones de reintento y llamar al almacenamiento de autenticación (`markUsageLimitReached(...)`); si el cambio de proveedor/modelo tiene éxito, forzar el retardo a `0`.
8. Emitir `auto_retry_start`.
9. Eliminar el mensaje de error del asistente final del estado del runtime del agente (se mantiene en el historial de sesión persistido).
10. Dormir con soporte de cancelación.
11. Al despertar, programar `agent.continue()` mediante `setTimeout(..., 0)`.

### Qué restablece los contadores de reintento

`#retryAttempt` se restablece a `0` en estos casos:

- primer mensaje exitoso del asistente sin error y no abortado después de que los reintentos comenzaron (emite `auto_retry_end { success: true }`)
- cancelación del reintento durante la espera de backoff
- ruta de máximo de reintentos excedido

`#retryPromise` se resuelve/limpia cuando la cadena de reintentos termina (éxito, cancelación o máximo excedido), mediante `#resolveRetry()`.

## Semántica de backoff y número máximo de intentos

Configuración:

- `retry.enabled` (por defecto `true`)
- `retry.maxRetries` (por defecto `3`)
- `retry.baseDelayMs` (por defecto `2000`)

Numeración de intentos:

- el contador de intentos se incrementa antes de la verificación del máximo
- los eventos de inicio usan el intento actual (base 1)
- el evento de fin por máximo excedido reporta `attempt: this.#retryAttempt - 1` (conteo del último reintento intentado)

Secuencia de backoff con configuración por defecto:

- intento 1: 2000 ms
- intento 2: 4000 ms
- intento 3: 8000 ms

Las entradas de anulación de retardo solo se utilizan en la ruta de manejo de límite de uso, y solo para influir en la decisión de cambio de modelo/cuenta del almacenamiento de autenticación. En la ruta principal de reintento fuera de compactación, el backoff permanece como retardo exponencial local a menos que el cambio tenga éxito (`delayMs = 0`).

## Mecánicas de cancelación

### Cancelación explícita de reintento

`abortRetry()`:

- cancela `#retryAbortController` (si existe)
- resuelve la promesa de reintento (`#resolveRetry()`) para que los que esperan se desbloqueen

Si la cancelación ocurre durante la espera, la ruta de captura emite:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- restablece intento/controlador

### Interacción con la cancelación global de operación

`abort()` llama a `abortRetry()` antes de cancelar el flujo activo del agente. Esto garantiza que el backoff de reintento se cancele cuando el usuario emite una cancelación general.

### Interacción con la TUI

En `auto_retry_start`, EventController:

- intercambia el manejador de `Esc` por `session.abortRetry()`
- renderiza texto de carga: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

En `auto_retry_end`, restaura el manejador previo de `Esc` y limpia el estado del loader.

## Comportamiento de streaming y finalización de prompt

`prompt()` en última instancia espera a `#waitForRetry()` después de que `agent.prompt(...)` retorne.

Efecto:

- una llamada a prompt no se resuelve completamente hasta que cualquier cadena de reintentos iniciada finalice (éxito/fallo/cancelación)
- el ciclo de vida del reintento es parte de un límite lógico de ejecución de prompt

Esto evita que los llamadores traten un turno en reintento como completado prematuramente.

## Controles: configuración y RPC

### Parámetros de configuración

Definidos en el esquema de configuración bajo el grupo retry:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

Interruptores programáticos en la sesión:

- `setAutoRetryEnabled(enabled)` escribe `retry.enabled`
- `autoRetryEnabled` lee `retry.enabled`
- `isRetrying` reporta si la promesa del ciclo de vida del reintento está activa

### Controles RPC

Superficie de comandos RPC:

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

Métodos auxiliares del cliente:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

Ambos comandos devuelven respuestas de éxito; los detalles de progreso/fallo del reintento provienen de los eventos de sesión transmitidos, no de las cargas útiles de respuesta de los comandos.

## Emisión de eventos y presentación de fallos

Eventos de reintento a nivel de sesión:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

Propagación:

- emitidos a través de `AgentSession.subscribe(...)`
- reenviados al runner de extensión como eventos de extensión
- en modo RPC, reenviados directamente como objetos de evento JSON (`session.subscribe(event => output(event))`)
- en la TUI, consumidos por `EventController` para la UI de loader/error

Presentación de fallo final:

- Al exceder el máximo o cancelación, `auto_retry_end.success === false`
- La TUI muestra: `Retry failed after N attempts: <finalError>`
- Las extensiones/hooks reciben `auto_retry_end` con los mismos campos
- Los consumidores RPC reciben el mismo objeto de evento en el flujo de stdout

## Condiciones de detención permanente

El reintento se detiene y no continuará automáticamente cuando ocurra cualquiera de las siguientes situaciones:

- `retry.enabled` es false
- el error no está clasificado como reintentable
- el error es un desbordamiento de contexto (delegado a la ruta de compactación)
- se excedió el máximo de reintentos
- el usuario cancela el reintento (`abort_retry` o `Esc` durante el loader de reintento)
- la cancelación global (`abort`) cancela el reintento primero

Una nueva cadena de reintentos puede iniciarse posteriormente ante un futuro error reintentable después de que los contadores se restablezcan.

## Consideraciones operativas

- La clasificación es por coincidencia de texto con regex; los errores estructurados específicos del proveedor no se utilizan aquí.
- El reintento elimina el error del asistente fallido del **contexto del runtime** antes de re-continuar, pero el historial de sesión aún conserva esa entrada de error.
- `RpcSessionState` actualmente expone `autoCompactionEnabled` pero no un campo `autoRetryEnabled`; los llamadores RPC deben rastrear su propio estado del interruptor o consultar la configuración a través de otras APIs.
