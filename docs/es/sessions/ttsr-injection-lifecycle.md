---
title: Ciclo de vida de inyección TTSR
description: >-
  Ciclo de vida de inyección TTSR (tool-use, tool-result, system-reminder) para
  la gestión de contexto.
sidebar:
  order: 9
  label: Inyección TTSR
i18n:
  sourceHash: d6179a286584
  translator: machine
---

# Ciclo de vida de inyección TTSR

Este documento cubre la ruta de ejecución actual de Time Traveling Stream Rules (TTSR) desde el descubrimiento de reglas hasta la interrupción del stream, la inyección de reintentos, las notificaciones de extensiones y el manejo del estado de sesión.

## Archivos de implementación

- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/export/ttsr.ts`](../../packages/coding-agent/src/export/ttsr.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/prompts/system/ttsr-interrupt.md`](../../packages/coding-agent/src/prompts/system/ttsr-interrupt.md)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/types.ts`](../../packages/coding-agent/src/extensibility/extensions/types.ts)
- [`../src/extensibility/hooks/types.ts`](../../packages/coding-agent/src/extensibility/hooks/types.ts)
- [`../src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)

## 1. Fuente de descubrimiento y registro de reglas

Durante la creación de la sesión, `createAgentSession()` carga todas las reglas descubiertas y construye un `TtsrManager`:

```ts
const ttsrSettings = settings.getGroup("ttsr");
const ttsrManager = new TtsrManager(ttsrSettings);
const rulesResult = await loadCapability<Rule>(ruleCapability.id, { cwd });
for (const rule of rulesResult.items) {
  if (rule.ttsrTrigger) ttsrManager.addRule(rule);
}
```

### Comportamiento de deduplicación previo al registro

`loadCapability("rules")` deduplica por `rule.name` con semántica de primera coincidencia gana (mayor prioridad de proveedor primero). Los duplicados eclipsados se eliminan antes del registro TTSR.

### Comportamiento de `TtsrManager.addRule()`

El registro se omite cuando:

- `rule.ttsrTrigger` está ausente
- una regla con el mismo `rule.name` ya fue registrada en este manager
- la expresión regular no compila (`new RegExp(rule.ttsrTrigger)` lanza una excepción)

Los triggers con expresiones regulares inválidas se registran como advertencias y se ignoran; el inicio de la sesión continúa.

### Advertencia sobre configuración

`TtsrSettings.enabled` se carga en el manager pero actualmente no se verifica en el control de ejecución. Si existen reglas, la coincidencia se ejecuta de todos modos.

## 2. Ciclo de vida del monitor de streaming

La detección TTSR se ejecuta dentro de `AgentSession.#handleAgentEvent`.

### Inicio del turno

En `turn_start`, el buffer del stream se reinicia:

- `ttsrManager.resetBuffer()`

### Durante el stream (`message_update`)

Cuando llegan actualizaciones del asistente y existen reglas:

- se monitorean `text_delta` y `toolcall_delta`
- se añade el delta al buffer del manager
- se llama a `check(buffer)`

`check()` itera sobre las reglas registradas y devuelve todas las reglas coincidentes que pasan la política de repetición (`#canTrigger`).

## 3. Decisión de activación y ruta de cancelación inmediata

Cuando una o más reglas coinciden:

1. `markInjected(matches)` registra los nombres de las reglas en el estado de inyección del manager.
2. las reglas coincidentes se encolan en `#pendingTtsrInjections`.
3. `#ttsrAbortPending = true`.
4. `agent.abort()` se llama inmediatamente.
5. el evento `ttsr_triggered` se emite de forma asíncrona (disparar y olvidar).
6. el trabajo de reintento se programa mediante `setTimeout(..., 50)`.

La cancelación no se bloquea esperando los callbacks de extensiones.

## 4. Programación de reintentos, modo de contexto e inyección de recordatorio

Después del timeout de 50ms:

1. `#ttsrAbortPending = false`
2. se lee `ttsrManager.getSettings().contextMode`
3. si `contextMode === "discard"`, se descarta la salida parcial del asistente con `agent.popMessage()`
4. se construye el contenido de inyección a partir de las reglas pendientes usando la plantilla `ttsr-interrupt.md`
5. se añade un mensaje sintético del usuario que contiene un bloque `<system-interrupt ...>` por cada regla
6. se llama a `agent.continue()` para reintentar la generación

El contenido de la plantilla es:

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

Las inyecciones pendientes se limpian después de la generación del contenido.

### Comportamiento de `contextMode` sobre la salida parcial

- `discard`: el mensaje parcial/cancelado del asistente se elimina antes del reintento.
- `keep`: la salida parcial del asistente permanece en el estado de la conversación; el recordatorio se añade después de ella.

## 5. Política de repetición y lógica de intervalo

`TtsrManager` rastrea `#messageCount` y `lastInjectedAt` por regla.

### `repeatMode: "once"`

Una regla solo puede activarse una vez después de tener un registro de inyección.

### `repeatMode: "after-gap"`

Una regla puede reactivarse solo cuando:

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount` se incrementa en `turn_end`, por lo que el intervalo se mide en turnos completados, no en fragmentos del stream.

## 6. Emisión de eventos y superficies de extensiones/hooks

### Evento de sesión

`AgentSessionEvent` incluye:

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### Ejecutor de extensiones

`#emitSessionEvent()` enruta el evento a:

- listeners de extensiones (`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`)
- suscriptores locales de la sesión

### Tipado de hooks y herramientas personalizadas

- la API de extensiones expone `on("ttsr_triggered", ...)`
- la API de hooks expone `on("ttsr_triggered", ...)`
- las herramientas personalizadas reciben `onSession({ reason: "ttsr_triggered", rules })`

### Diferencia de renderizado en modo interactivo

El modo interactivo usa `session.isTtsrAbortPending` para suprimir la visualización de la razón de detención del asistente cancelado como un fallo visible durante la interrupción TTSR, y renderiza un `TtsrNotificationComponent` cuando llega el evento.

## 7. Persistencia y estado de reanudación (implementación actual)

`SessionManager` tiene soporte completo de esquema para la persistencia de reglas inyectadas:

- tipo de entrada: `ttsr_injection`
- API de adición: `appendTtsrInjection(ruleNames)`
- API de consulta: `getInjectedTtsrRules()`
- la reconstrucción de contexto incluye `SessionContext.injectedTtsrRules`

`TtsrManager` también soporta restauración mediante `restoreInjected(ruleNames)`.

### Estado actual de la integración

En la ruta de ejecución actual:

- `AgentSession` no añade entradas `ttsr_injection` cuando se activa TTSR.
- `createAgentSession()` no restaura `existingSession.injectedTtsrRules` de vuelta al `ttsrManager`.

Efecto neto: la supresión de reglas inyectadas se aplica en memoria para el proceso activo, pero actualmente no se persiste/restaura entre la recarga/reanudación de sesión por esta ruta.

## 8. Límites de concurrencia y garantías de ordenamiento

### Cancelación vs callback de reintento

- la cancelación es síncrona desde la perspectiva del manejador TTSR (`agent.abort()` se llama inmediatamente)
- el reintento se difiere mediante un temporizador (`50ms`)
- la notificación de extensiones es asíncrona e intencionalmente no se espera antes de programar la cancelación/reintento

### Múltiples coincidencias en la misma ventana de stream

`check()` devuelve todas las reglas elegibles que coinciden actualmente. Se inyectan como un lote en el siguiente mensaje de reintento.

### Entre cancelación y continuación

Durante la ventana del temporizador, el estado puede cambiar (interrupción del usuario, acciones de modo, eventos adicionales). La llamada de reintento es de mejor esfuerzo: `agent.continue().catch(() => {})` absorbe los errores subsiguientes.

## 9. Resumen de casos límite

- Expresión regular `ttsr_trigger` inválida: se omite con advertencia; las demás reglas continúan.
- Nombres de reglas duplicados en la capa de capacidades: los duplicados de menor prioridad se eclipsan antes del registro.
- Nombres duplicados en la capa del manager: el segundo registro se ignora.
- `contextMode: "keep"`: la salida parcial que viola la regla puede permanecer en el contexto antes del reintento con recordatorio.
- El intervalo de repetición después del gap depende de los incrementos del contador de turnos en `turn_end`; los fragmentos a mitad de turno no avanzan los contadores de intervalo.
