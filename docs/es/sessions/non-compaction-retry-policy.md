---
title: Política de reintento automático sin compactación
description: >-
  Política de reintento automático para fallos de API transitorios fuera de la
  ruta de compactación.
sidebar:
  order: 6
  label: Política de reintento
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# Política de reintento automático sin compactación

Este documento describe la ruta estándar de reintento por error de API en `AgentSession`.

Excluye explícitamente la recuperación por desbordamiento de contexto mediante auto-compactación. El desbordamiento es gestionado por la lógica de compactación y está documentado por separado en [`compaction.md`](./compaction.md).

## Archivos de implementación

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## Límite de alcance frente a compactación

El reintento y la compactación se verifican desde la misma ruta `agent_end`, pero están intencionalmente separados:

1. `agent_end` inspecciona el último mensaje del asistente.
2. `#isRetryableError(...)` se ejecuta primero.
3. Si se inicia un reintento, las comprobaciones de compactación se omiten para ese turno.
4. Los errores de desbordamiento de contexto están excluidos de forma estricta de la clasificación de reintento (`isContextOverflow(...)` cortocircuita el reintento).
5. El desbordamiento cae, por tanto, hacia `#checkCompaction(...)` en lugar del reintento estándar.

En resumen: los fallos de tipo sobrecarga/límite de tasa/servidor/red utilizan esta política de reintento; el desbordamiento de la ventana de contexto utiliza la recuperación por compactación.

## Clasificación de reintentos

`#isRetryableError(...)` requiere que se cumplan todas las siguientes condiciones:

- `stopReason === "error"` del asistente
- `errorMessage` existe
- el mensaje **no** es un desbordamiento de contexto
- `errorMessage` coincide con `#isRetryableErrorMessage(...)`

Conjunto de patrones reintentables actuales (basados en expresiones regulares):

- overloaded
- rate limit / usage limit / too many requests
- clases de servidor similares a HTTP: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- expresión `retry delay`

Esta es una clasificación por patrones de cadena de texto, no mediante códigos de error tipificados del proveedor.

## Ciclo de vida del reintento y transiciones de estado

Estado de sesión utilizado por el reintento:

- `#retryAttempt: number` (`0` significa inactivo)
- `#retryPromise: Promise<void> | undefined` (rastrea el ciclo de vida del reintento en curso)
- `#retryResolve: (() => void) | undefined` (resuelve `#retryPromise`)
- `#retryAbortController: AbortController | undefined` (cancela el reposo de retroceso exponencial)

Flujo (`#handleRetryableError`):

1. Leer el grupo de configuración `retry`.
2. Si `retry.enabled === false`, detener inmediatamente (`false`, no se inicia ningún reintento).
3. Incrementar `#retryAttempt`.
4. Crear `#retryPromise` una sola vez (primer intento en una cadena).
5. Si el intento supera `retry.maxRetries`, emitir el evento de fallo final y detenerse.
6. Calcular el retardo: `retry.baseDelayMs * 2^(attempt-1)`.
7. Para errores de límite de uso, analizar las sugerencias de reintento y llamar al almacenamiento de autenticación (`markUsageLimitReached(...)`); si el cambio de proveedor/modelo tiene éxito, forzar el retardo a `0`.
8. Emitir `auto_retry_start`.
9. Eliminar el mensaje de error del asistente al final del estado de ejecución del agente (se conserva en el historial de sesión persistido).
10. Esperar con soporte de cancelación.
11. Al despertar, programar `agent.continue()` mediante `setTimeout(..., 0)`.

### Qué restablece los contadores de reintento

`#retryAttempt` se restablece a `0` en estos casos:

- primer mensaje del asistente exitoso, sin error y sin cancelación, después de que comenzaron los reintentos (emite `auto_retry_end { success: true }`)
- cancelación del reintento durante el reposo de retroceso exponencial
- ruta de máximo de reintentos superado

`#retryPromise` se resuelve y borra cuando la cadena de reintentos termina (éxito, cancelación o máximo superado), mediante `#resolveRetry()`.

## Semántica del retroceso exponencial y del número máximo de intentos

Configuración:

- `retry.enabled` (predeterminado `true`)
- `retry.maxRetries` (predeterminado `3`)
- `retry.baseDelayMs` (predeterminado `2000`)

Numeración de intentos:

- el contador de intentos se incrementa antes de la comprobación del máximo
- los eventos de inicio utilizan el intento actual (base 1)
- el evento de fin por máximo superado reporta `attempt: this.#retryAttempt - 1` (último recuento de reintentos intentados)

Secuencia de retroceso exponencial con la configuración predeterminada:

- intento 1: 2000 ms
- intento 2: 4000 ms
- intento 3: 8000 ms

Las entradas de anulación de retardo solo se utilizan en la ruta de gestión del límite de uso, y únicamente para influir en la decisión de cambio de modelo/cuenta en el almacenamiento de autenticación. En la ruta principal de reintento sin compactación, el retroceso permanece como retardo exponencial local a menos que el cambio tenga éxito (`delayMs = 0`).

## Mecánica de cancelación

### Cancelación explícita de reintento

`abortRetry()`:

- cancela `#retryAbortController` (si está presente)
- resuelve la promesa de reintento (`#resolveRetry()`) para desbloquear a los que estén esperando

Si la cancelación ocurre durante el reposo, la ruta de captura emite:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- restablece el intento/controlador

### Interacción con la cancelación global de operación

`abort()` llama a `abortRetry()` antes de cancelar el flujo del agente activo. Esto garantiza que el retroceso del reintento se cancela cuando el usuario emite una cancelación general.

### Interacción con la interfaz TUI

Al recibir `auto_retry_start`, EventController:

- intercambia el manejador de `Esc` por `session.abortRetry()`
- renderiza el texto del indicador de carga: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

Al recibir `auto_retry_end`, restaura el manejador de `Esc` anterior y limpia el estado del indicador de carga.

## Comportamiento del flujo de datos y de la finalización del prompt

`prompt()` finalmente espera en `#waitForRetry()` después de que `agent.prompt(...)` retorna.

Efecto:

- una llamada a prompt no se resuelve completamente hasta que cualquier cadena de reintentos iniciada finalice (éxito/fallo/cancelación)
- el ciclo de vida del reintento forma parte de un límite lógico de ejecución de prompt

Esto evita que los llamadores traten un turno en proceso de reintento como completado prematuramente.

## Controles: configuración y RPC

### Parámetros de configuración

Definidos en el esquema de configuración bajo el grupo retry:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

Controles programáticos en la sesión:

- `setAutoRetryEnabled(enabled)` escribe `retry.enabled`
- `autoRetryEnabled` lee `retry.enabled`
- `isRetrying` informa si la promesa del ciclo de vida de reintento está activa

### Controles RPC

Superficie de comandos RPC:

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

Asistentes del cliente:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

Ambos comandos devuelven respuestas de éxito; los detalles del progreso/fallo del reintento provienen de los eventos de sesión en flujo, no de las cargas de respuesta del comando.

## Emisión de eventos y presentación de fallos

Eventos de reintento a nivel de sesión:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

Propagación:

- emitidos a través de `AgentSession.subscribe(...)`
- reenviados al ejecutor de extensiones como eventos de extensión
- en modo RPC, reenviados directamente como objetos de evento JSON (`session.subscribe(event => output(event))`)
- en la interfaz TUI, consumidos por `EventController` para la interfaz de carga/error

Presentación del fallo final:

- cuando se supera el máximo o se cancela, `auto_retry_end.success === false`
- la interfaz TUI muestra: `Retry failed after N attempts: <finalError>`
- las extensiones/hooks reciben `auto_retry_end` con los mismos campos
- los consumidores RPC reciben el mismo objeto de evento en el flujo de salida estándar

## Condiciones de detención permanente

El reintento se detiene y no continuará automáticamente cuando ocurra alguna de estas situaciones:

- `retry.enabled` es false
- el error no está clasificado como reintentable
- el error es un desbordamiento de contexto (delegado a la ruta de compactación)
- se supera el número máximo de reintentos
- el usuario cancela el reintento (`abort_retry` o `Esc` durante el indicador de carga de reintento)
- la cancelación global (`abort`) cancela el reintento primero

Una nueva cadena de reintentos puede iniciarse más adelante ante un error reintentable futuro, una vez que los contadores se restablezcan.

## Advertencias operativas

- La clasificación es por coincidencia de texto mediante expresiones regulares; los errores estructurados específicos del proveedor no se utilizan aquí.
- El reintento elimina el error del asistente fallido del **contexto de ejecución** antes de continuar, pero el historial de sesión conserva esa entrada de error.
- `RpcSessionState` actualmente expone `autoCompactionEnabled` pero no un campo `autoRetryEnabled`; los llamadores RPC deben rastrear su propio estado de activación o consultar la configuración a través de otras APIs.
