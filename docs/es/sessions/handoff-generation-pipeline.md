---
title: Handoff Generation Pipeline
description: >-
  Handoff generation pipeline for creating portable session summaries for team
  collaboration.
sidebar:
  order: 8
  label: Pipeline de handoff
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# Pipeline de generación de `/handoff`

Este documento describe cómo el coding-agent implementa `/handoff` actualmente: ruta de activación, prompt de generación, captura de la respuesta, cambio de sesión y reinyección de contexto.

## Alcance

Cubre:

- Despacho del comando interactivo `/handoff`
- Ciclo de vida y transiciones de estado de `AgentSession.handoff()`
- Cómo se captura la salida del handoff desde la respuesta del asistente
- Cómo las sesiones antiguas/nuevas persisten los datos de handoff de manera diferente
- Comportamiento de la interfaz para éxito, cancelación y fallo

No cubre:

- Internos genéricos de navegación de árbol/ramas
- Comandos de sesión no relacionados con handoff (`/new`, `/fork`, `/resume`)

## Archivos de implementación

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## Ruta de activación

1. `/handoff` se declara en los metadatos de comandos slash integrados (`slash-commands.ts`) con una indicación inline opcional: `[focus instructions]`.
2. En el manejo de entrada interactiva (`InputController`), el texto enviado que coincide con `/handoff` o `/handoff ...` es interceptado antes del envío normal del prompt.
3. El editor se limpia y se llama a `handleHandoffCommand(customInstructions?)`.
4. `CommandController.handleHandoffCommand` realiza una verificación previa utilizando las entradas actuales:
   - Cuenta las entradas con `type === "message"`.
   - Si son `< 2`, muestra una advertencia: `Nothing to hand off (no messages yet)` y retorna.

La misma verificación de contenido mínimo existe nuevamente dentro de `AgentSession.handoff()` y lanza un error si se viola. Esto duplica la seguridad tanto en la capa de UI como en la de sesión.

## Ciclo de vida de extremo a extremo

### 1) Iniciar la generación del handoff

`AgentSession.handoff(customInstructions?)`:

- Lee las entradas de la rama actual (`sessionManager.getBranch()`)
- Valida el conteo mínimo de mensajes (`>= 2`)
- Crea `#handoffAbortController`
- Construye un prompt fijo e inline solicitando un documento de handoff estructurado (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- Agrega `Additional focus: ...` si se proporcionan instrucciones personalizadas

El prompt se envía mediante:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` evita la expansión de slash/prompt-template de esta carga de instrucciones interna.

### 2) Captura de la respuesta

Antes de enviar el prompt, `handoff()` se suscribe a los eventos de sesión y espera `agent_end`.

Al recibir `agent_end`, extrae el texto del handoff del estado del agente escaneando hacia atrás buscando el mensaje más reciente del `assistant`, luego concatenando todos los bloques `content` donde `type === "text"` con `\n`.

Suposiciones importantes de la extracción:

- Solo se utilizan bloques de texto; el contenido no textual se ignora.
- Se asume que el último mensaje del asistente corresponde a la generación del handoff.
- No analiza las secciones markdown ni valida el cumplimiento del formato.
- Si la salida del asistente no tiene bloques de texto, el handoff se trata como ausente.

### 3) Verificaciones de cancelación

`handoff()` retorna `undefined` cuando se cumple alguna de estas condiciones:

- no hay texto de handoff capturado, o
- `#handoffAbortController.signal.aborted` es true

Siempre limpia `#handoffAbortController` en `finally`.

### 4) Creación de nueva sesión

Si se capturó texto y no fue abortado:

1. Vacía el escritor de la sesión actual (`sessionManager.flush()`)
2. Inicia una sesión completamente nueva (`sessionManager.newSession()`)
3. Reinicia el estado del agente en memoria (`agent.reset()`)
4. Reasigna `agent.sessionId` al id de la nueva sesión
5. Limpia los arrays de contexto en cola (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. Reinicia el contador de recordatorios de tareas pendientes

`newSession()` crea un encabezado nuevo y una lista de entradas vacía (leaf reiniciado a `null`). En la ruta de handoff, no se pasa `parentSession`.

### 5) Inyección de contexto del handoff

El documento de handoff generado se envuelve y se agrega a la nueva sesión como una entrada `custom_message`:

```text
<handoff-context>
...handoff text...
</handoff-context>

The above is a handoff document from a previous session. Use this context to continue the work seamlessly.
```

Llamada de inserción:

```ts
this.sessionManager.appendCustomMessageEntry("handoff", handoffContent, true);
```

Semántica:

- `customType`: `"handoff"`
- `display`: `true` (visible en la reconstrucción de la TUI)
- Tipo de entrada: `custom_message` (participa en el contexto del LLM)

### 6) Reconstrucción del contexto activo del agente

Después de la inyección:

1. `sessionManager.buildSessionContext()` resuelve la lista de mensajes para la hoja actual
2. `agent.replaceMessages(sessionContext.messages)` hace que el mensaje de handoff inyectado sea el contexto activo
3. El método retorna `{ document: handoffText }`

En este punto, el contexto activo del LLM en la nueva sesión contiene el mensaje de handoff inyectado, no la transcripción anterior.

## Modelo de persistencia: sesión antigua vs nueva sesión

### Sesión antigua

Durante la generación, la persistencia normal de mensajes permanece activa. La respuesta del asistente con el handoff se persiste como una entrada `message` regular en `message_end`.

Resultado: la sesión original contiene el handoff generado visible como parte de la transcripción histórica.

### Nueva sesión

Después del reinicio de sesión, el handoff se persiste como `custom_message` con `customType: "handoff"`.

`buildSessionContext()` convierte esta entrada en un mensaje de contexto personalizado/usuario en tiempo de ejecución mediante `createCustomMessage(...)`, por lo que se incluye en futuros prompts de la nueva sesión.

## Comportamiento del controlador/UI

Comportamiento de `CommandController.handleHandoffCommand`:

- Llama a `await session.handoff(customInstructions)`
- Si el resultado es `undefined`: `showError("Handoff cancelled")`
- En caso de éxito:
  - `rebuildChatFromMessages()` (carga el contexto de la nueva sesión, incluyendo el handoff inyectado)
  - invalida la línea de estado y el borde superior del editor
  - recarga las tareas pendientes
  - agrega línea de éxito en el chat: `New session started with handoff context`
- En caso de excepción:
  - si el mensaje es `"Handoff cancelled"` o el nombre del error es `AbortError`: `showError("Handoff cancelled")`
  - de lo contrario: `showError("Handoff failed: <message>")`
- Solicita renderizado al final

## Semántica de cancelación (comportamiento actual)

### Primitiva de cancelación a nivel de sesión

`AgentSession` expone:

- `abortHandoff()` → aborta `#handoffAbortController`
- `isGeneratingHandoff` → true mientras el controlador existe

Cuando se utiliza esta ruta de aborto, el suscriptor del handoff rechaza con `Error("Handoff cancelled")`, y el controlador de comandos lo mapea a la UI de cancelación.

### Limitación de la ruta interactiva de `/handoff`

En el cableado actual del controlador interactivo, `/handoff` no instala un manejador dedicado de Escape que llame a `abortHandoff()` (a diferencia de las rutas de compactación/resumen de rama que temporalmente sobreescriben `editor.onEscape`).

Impacto práctico:

- Existe soporte de cancelación a nivel de sesión, pero no hay un enlace de atajo de teclado específico para handoff en la ruta del comando `/handoff`.
- La interrupción del usuario aún puede ocurrir a través de rutas más amplias de aborto del agente, pero ese no es el mismo canal explícito de cancelación utilizado por `abortHandoff()`.

## Handoff abortado vs fallido

Clasificación actual de la UI:

- **Abortado/cancelado**
  - La ruta `abortHandoff()` genera `"Handoff cancelled"`, o
  - Se lanza `AbortError`
  - La UI muestra `Handoff cancelled`

- **Fallido**
  - Cualquier otro error lanzado desde `handoff()` / pipeline de prompts (errores de validación del modelo/API, excepciones en tiempo de ejecución, etc.)
  - La UI muestra `Handoff failed: ...`

Matiz adicional: si la generación se completa pero no se extrae texto, `handoff()` retorna `undefined` y el controlador actualmente reporta **cancelado**, no **fallido**.

## Protecciones de sesión corta y contenido mínimo

Dos protecciones previenen handoffs con poca señal:

- Capa de UI (`handleHandoffCommand`): advierte y retorna tempranamente para `< 2` entradas de mensaje
- Capa de sesión (`handoff()`): lanza la misma condición como un error

Esto evita crear una nueva sesión con contexto de handoff vacío o casi vacío.

## Resumen de transición de estados

Flujo de estados de alto nivel:

1. Comando slash interactivo interceptado
2. Verificación previa de conteo de mensajes
3. `#handoffAbortController` creado (`isGeneratingHandoff = true`)
4. Prompt interno de handoff enviado (visible en el chat como generación normal del asistente)
5. Al recibir `agent_end`, se extrae el texto del último asistente
6. Si está ausente/abortado → retorna `undefined` o ruta de error de cancelación
7. Si está presente:
   - vaciar sesión antigua
   - crear nueva sesión vacía
   - reiniciar colas/contadores en tiempo de ejecución
   - agregar `custom_message(handoff)`
   - reconstruir y reemplazar los mensajes activos del agente
8. El controlador reconstruye la UI del chat y anuncia éxito
9. `#handoffAbortController` limpiado (`isGeneratingHandoff = false`)

## Suposiciones y limitaciones conocidas

- La extracción del handoff es heurística: "últimos bloques de texto del asistente"; sin validación estructural.
- No hay verificación estricta de que el markdown generado siga el formato de secciones solicitado.
- El texto extraído faltante se reporta como cancelación en la UX del controlador.
- El flujo interactivo de `/handoff` actualmente carece de un enlace dedicado Escape→`abortHandoff()`.
- Los metadatos de linaje de la nueva sesión (`parentSession`) no se establecen en esta ruta.
