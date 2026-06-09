---
title: Política de reintentos automáticos fuera de compactación
description: >-
  Política de reintentos automáticos para fallos transitorios de API fuera de la
  ruta de compactación.
sidebar:
  order: 6
  label: Política de reintentos
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# Política de reintentos automáticos fuera de compactación

Este documento describe la ruta estándar de reintentos ante errores de API en `AgentSession`.

Excluye explícitamente la recuperación por desbordamiento de contexto mediante auto-compactación. El desbordamiento se gestiona mediante la lógica de compactación y está documentado por separado en [`compaction.md`](./compaction.md).

## Archivos de implementación

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## Límite de alcance frente a compactación

Los reintentos y la compactación se verifican desde la misma ruta `agent_end`, pero están intencionalmente separados:

1. `agent_end` inspecciona el último mensaje del asistente.
2. `#isRetryableError(...)` se ejecuta primero.
3. Si se inicia un reintento, las verificaciones de compactación se omiten para ese turno.
4. Los errores de desbordamiento de contexto se excluyen de forma estricta de la clasificación de reintentos (`isContextOverflow(...)` cortocircuita el reintento).
5. Por lo tanto, el desbordamiento cae hacia `#checkCompaction(...)` en lugar del reintento estándar.

En resumen: los fallos de tipo sobrecarga/límite de tasa/servidor/red utilizan esta política de reintentos; el desbordamiento de la ventana de contexto utiliza la recuperación por compactación.

## Clasificación de reintentos

`#isRetryableError(...)` requiere todas las siguientes condiciones:

- `stopReason === "error"` del asistente
- `errorMessage` existe
- el mensaje **no** es desbordamiento de contexto
- `errorMessage` coincide con `#isRetryableErrorMessage(...)`

Conjunto actual de patrones reintentables (basados en regex):

- overloaded
- rate limit / usage limit / too many requests
- clases de servidor tipo HTTP: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- texto con `retry delay`

Esta es una clasificación basada en patrones de texto, no en códigos de error tipados del proveedor.

## Ciclo de vida del reintento y transiciones de estado

Estado de la sesión utilizado por el reintento:

- `#retryAttempt: number` (`0` significa inactivo)
- `#retryPromise: Promise<void> | undefined` (rastrea el ciclo de vida del reintento en curso)
- `#retryResolve: (() => void) | undefined` (resuelve `#retryPromise`)
- `#retryAbortController: AbortController | undefined` (cancela la espera de retroceso)

Flujo (`#handleRetryableError`):

1. Lee el grupo de configuración `retry`.
2. Si `retry.enabled === false`, se detiene inmediatamente (`false`, no se inicia el reintento).
3. Incrementa `#retryAttempt`.
4. Crea `#retryPromise` una vez (primer intento en una cadena).
5. Si el intento supera `retry.maxRetries`, emite el evento de fallo final y se detiene.
6. Calcula el retraso: `retry.baseDelayMs * 2^(attempt-1)`.
7. Para errores de límite de uso, analiza las indicaciones de reintento y llama al almacenamiento de autenticación (`markUsageLimitReached(...)`); si el cambio de proveedor/modelo tiene éxito, fuerza el retraso a `0`.
8. Emite `auto_retry_start`.
9. Elimina el mensaje de error del asistente final del estado de ejecución del agente (se mantiene en el historial persistido de la sesión).
10. Espera con soporte de cancelación.
11. Al despertar, programa `agent.continue()` mediante `setTimeout(..., 0)`.

### Qué reinicia los contadores de reintento

`#retryAttempt` se reinicia a `0` en estos casos:

- primer mensaje exitoso del asistente que no sea error ni cancelación después de que se iniciaron los reintentos (emite `auto_retry_end { success: true }`)
- cancelación del reintento durante la espera de retroceso
- ruta de reintentos máximos excedidos

`#retryPromise` se resuelve/limpia cuando la cadena de reintentos termina (éxito, cancelación o máximo excedido), mediante `#resolveRetry()`.

## Semántica de retroceso y máximo de intentos

Configuración:

- `retry.enabled` (por defecto `true`)
- `retry.maxRetries` (por defecto `3`)
- `retry.baseDelayMs` (por defecto `2000`)

Numeración de intentos:

- el contador de intentos se incrementa antes de la verificación del máximo
- los eventos de inicio usan el intento actual (base 1)
- el evento de fin por máximo excedido reporta `attempt: this.#retryAttempt - 1` (conteo del último reintento intentado)

Secuencia de retroceso con la configuración por defecto:

- intento 1: 2000 ms
- intento 2: 4000 ms
- intento 3: 8000 ms

Las entradas de anulación de retraso solo se usan en la ruta de manejo de límite de uso, y solo para influir en la decisión de cambio de modelo/cuenta del almacenamiento de autenticación. En la ruta principal de reintentos fuera de compactación, el retroceso permanece como retraso exponencial local a menos que el cambio tenga éxito (`delayMs = 0`).

## Mecánica de cancelación

### Cancelación explícita del reintento

`abortRetry()`:

- cancela `#retryAbortController` (si existe)
- resuelve la promesa de reintento (`#resolveRetry()`) para desbloquear a los que esperan

Si la cancelación ocurre durante la espera, la ruta catch emite:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- reinicia intento/controlador

### Interacción con la cancelación de operación global

`abort()` llama a `abortRetry()` antes de cancelar el flujo activo del agente. Esto garantiza que el retroceso del reintento se cancele cuando el usuario emite una cancelación general.

### Interacción con la TUI

En `auto_retry_start`, EventController:

- intercambia el manejador de `Esc` a `session.abortRetry()`
- renderiza texto del cargador: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

En `auto_retry_end`, restaura el manejador anterior de `Esc` y limpia el estado del cargador.

## Comportamiento de streaming y finalización del prompt

`prompt()` finalmente espera a `#waitForRetry()` después de que `agent.prompt(...)` retorna.

Efecto:

- una llamada de prompt no se resuelve completamente hasta que cualquier cadena de reintentos iniciada finalice (éxito/fallo/cancelación)
- el ciclo de vida del reintento es parte de un límite lógico de ejecución de prompt

Esto evita que los llamadores traten un turno en reintento como completado prematuramente.

## Controles: configuración y RPC

### Parámetros de configuración

Definidos en el esquema de configuración bajo el grupo retry:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

Controles programáticos en la sesión:

- `setAutoRetryEnabled(enabled)` escribe `retry.enabled`
- `autoRetryEnabled` lee `retry.enabled`
- `isRetrying` reporta si la promesa del ciclo de vida del reintento está activa

### Controles RPC

Superficie de comandos RPC:

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

Ayudantes del cliente:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

Ambos comandos devuelven respuestas de éxito; los detalles de progreso/fallo del reintento provienen de eventos de sesión transmitidos por streaming, no de las cargas útiles de respuesta del comando.

## Emisión de eventos y exposición de fallos

Eventos de reintento a nivel de sesión:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

Propagación:

- emitidos a través de `AgentSession.subscribe(...)`
- reenviados al ejecutor de extensiones como eventos de extensión
- en modo RPC, reenviados directamente como objetos de evento JSON (`session.subscribe(event => output(event))`)
- en la TUI, consumidos por `EventController` para la interfaz de cargador/error

Exposición del fallo final:

- En máximo excedido o cancelación, `auto_retry_end.success === false`
- La TUI muestra: `Retry failed after N attempts: <finalError>`
- Las extensiones/hooks reciben `auto_retry_end` con los mismos campos
- Los consumidores RPC reciben el mismo objeto de evento en el flujo stdout

## Condiciones de parada permanente

El reintento se detiene y no continuará automáticamente cuando ocurra cualquiera de las siguientes situaciones:

- `retry.enabled` es false
- el error no está clasificado como reintentable
- el error es desbordamiento de contexto (delegado a la ruta de compactación)
- reintentos máximos excedidos
- el usuario cancela el reintento (`abort_retry` o `Esc` durante el cargador de reintento)
- cancelación global (`abort`) cancela el reintento primero

Una nueva cadena de reintentos puede iniciarse posteriormente ante un futuro error reintentable después de que los contadores se reinicien.

## Advertencias operativas

- La clasificación se basa en coincidencia de texto con regex; los errores estructurados específicos del proveedor no se utilizan aquí.
- El reintento elimina el error del asistente fallido del **contexto de ejecución** antes de re-continuar, pero el historial de la sesión aún conserva esa entrada de error.
- `RpcSessionState` actualmente expone `autoCompactionEnabled` pero no un campo `autoRetryEnabled`; los llamadores RPC deben rastrear su propio estado de activación o consultar la configuración a través de otras APIs.
