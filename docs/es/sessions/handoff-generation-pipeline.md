---
title: Pipeline de generación de Handoff
description: >-
  Pipeline de generación de handoff para crear resúmenes de sesión portables
  para la colaboración en equipo.
sidebar:
  order: 8
  label: Pipeline de handoff
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# Pipeline de generación de `/handoff`

Este documento describe cómo el agente de codificación implementa `/handoff` actualmente: ruta de activación, prompt de generación, captura de finalización, cambio de sesión y reinyección de contexto.

## Alcance

Cubre:

- Despacho interactivo del comando `/handoff`
- Ciclo de vida y transiciones de estado de `AgentSession.handoff()`
- Cómo se captura la salida del handoff desde la salida del asistente
- Cómo las sesiones antiguas/nuevas persisten los datos de handoff de forma diferente
- Comportamiento de la interfaz de usuario para éxito, cancelación y fallo

No cubre:

- Navegación genérica de árbol/elementos internos de ramas
- Comandos de sesión que no son handoff (`/new`, `/fork`, `/resume`)

## Archivos de implementación

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## Ruta de activación

1. `/handoff` se declara en los metadatos de comandos slash integrados (`slash-commands.ts`) con una sugerencia en línea opcional: `[focus instructions]`.
2. En el manejo de entrada interactiva (`InputController`), el texto enviado que coincide con `/handoff` o `/handoff ...` es interceptado antes del envío normal del prompt.
3. El editor se borra y se llama a `handleHandoffCommand(customInstructions?)`.
4. `CommandController.handleHandoffCommand` realiza una verificación previa usando las entradas actuales:
   - Cuenta las entradas con `type === "message"`.
   - Si `< 2`, advierte: `Nothing to hand off (no messages yet)` y retorna.

La misma guardia de contenido mínimo existe también dentro de `AgentSession.handoff()` y lanza una excepción si se viola. Esto duplica la seguridad tanto en la capa de interfaz de usuario como en la capa de sesión.

## Ciclo de vida de extremo a extremo

### 1) Iniciar la generación del handoff

`AgentSession.handoff(customInstructions?)`:

- Lee las entradas de la rama actual (`sessionManager.getBranch()`)
- Valida el recuento mínimo de mensajes (`>= 2`)
- Crea `#handoffAbortController`
- Construye un prompt fijo en línea que solicita un documento de handoff estructurado (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- Agrega `Additional focus: ...` si se proporcionan instrucciones personalizadas

El prompt se envía mediante:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` impide la expansión de plantillas slash/prompt de esta carga útil de instrucción interna.

### 2) Captura de la finalización

Antes de enviar el prompt, `handoff()` se suscribe a los eventos de sesión y espera `agent_end`.

En `agent_end`, extrae el texto del handoff del estado del agente buscando hacia atrás el mensaje `assistant` más reciente, luego concatenando todos los bloques `content` donde `type === "text"` con `\n`.

Supuestos importantes de extracción:

- Solo se utilizan bloques de texto; el contenido que no es texto se ignora.
- Se asume que el último mensaje del asistente corresponde a la generación del handoff.
- No analiza las secciones de markdown ni valida el cumplimiento del formato.
- Si la salida del asistente no tiene bloques de texto, el handoff se trata como ausente.

### 3) Verificaciones de cancelación

`handoff()` retorna `undefined` cuando se cumple alguna de las siguientes condiciones:

- no se capturó texto de handoff, o
- `#handoffAbortController.signal.aborted` es verdadero

Siempre limpia `#handoffAbortController` en `finally`.

### 4) Creación de nueva sesión

Si se capturó texto y no fue abortado:

1. Vaciar el escritor de la sesión actual (`sessionManager.flush()`)
2. Iniciar una sesión completamente nueva (`sessionManager.newSession()`)
3. Restablecer el estado del agente en memoria (`agent.reset()`)
4. Reasignar `agent.sessionId` al nuevo id de sesión
5. Limpiar los arreglos de contexto en cola (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. Restablecer el contador de recordatorio de tareas pendientes

`newSession()` crea un nuevo encabezado y una lista de entradas vacía (hoja restablecida a `null`). En la ruta de handoff, no se pasa ningún `parentSession`.

### 5) Inyección del contexto de handoff

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

### 6) Reconstruir el contexto activo del agente

Después de la inyección:

1. `sessionManager.buildSessionContext()` resuelve la lista de mensajes para la hoja actual
2. `agent.replaceMessages(sessionContext.messages)` hace que el mensaje de handoff inyectado sea el contexto activo
3. El método retorna `{ document: handoffText }`

En este punto, el contexto activo del LLM en la nueva sesión contiene el mensaje de handoff inyectado, no la transcripción anterior.

## Modelo de persistencia: sesión antigua vs sesión nueva

### Sesión antigua

Durante la generación, la persistencia normal de mensajes permanece activa. La respuesta de handoff del asistente se persiste como una entrada `message` regular en `message_end`.

Resultado: la sesión original contiene el handoff generado visible como parte de la transcripción histórica.

### Sesión nueva

Después del restablecimiento de sesión, el handoff se persiste como `custom_message` con `customType: "handoff"`.

`buildSessionContext()` convierte esta entrada en un mensaje de contexto personalizado/usuario en tiempo de ejecución mediante `createCustomMessage(...)`, de modo que se incluye en los futuros prompts de la nueva sesión.

## Comportamiento del controlador/interfaz de usuario

Comportamiento de `CommandController.handleHandoffCommand`:

- Llama a `await session.handoff(customInstructions)`
- Si el resultado es `undefined`: `showError("Handoff cancelled")`
- En caso de éxito:
  - `rebuildChatFromMessages()` (carga el nuevo contexto de sesión, incluido el handoff inyectado)
  - invalida la línea de estado y el borde superior del editor
  - recarga las tareas pendientes
  - agrega una línea de chat de éxito: `New session started with handoff context`
- En caso de excepción:
  - si el mensaje es `"Handoff cancelled"` o el nombre del error es `AbortError`: `showError("Handoff cancelled")`
  - de lo contrario: `showError("Handoff failed: <message>")`
- Solicita renderizado al final

## Semántica de cancelación (comportamiento actual)

### Primitiva de cancelación a nivel de sesión

`AgentSession` expone:

- `abortHandoff()` → aborta `#handoffAbortController`
- `isGeneratingHandoff` → verdadero mientras el controlador existe

Cuando se usa esta ruta de aborto, el suscriptor del handoff rechaza con `Error("Handoff cancelled")`, y el controlador de comandos lo mapea a la interfaz de usuario de cancelación.

### Limitación de la ruta interactiva de `/handoff`

En el cableado del controlador interactivo actual, `/handoff` no instala un manejador dedicado de Escape que llame a `abortHandoff()` (a diferencia de las rutas de compactación/resumen de rama que temporalmente anulan `editor.onEscape`).

Impacto práctico:

- Existe soporte de cancelación a nivel de sesión, pero no hay un enlace de tecla específico de handoff en la ruta del comando `/handoff`.
- La interrupción del usuario puede seguir ocurriendo a través de rutas de aborto del agente más amplias, pero eso no es el mismo canal de cancelación explícito utilizado por `abortHandoff()`.

## Handoff abortado vs fallido

Clasificación actual de la interfaz de usuario:

- **Abortado/cancelado**
  - La ruta de `abortHandoff()` activa `"Handoff cancelled"`, o
  - se lanza `AbortError`
  - La interfaz de usuario muestra `Handoff cancelled`

- **Fallido**
  - cualquier otro error lanzado desde `handoff()` / la canalización del prompt (errores de validación de modelo/API, excepciones en tiempo de ejecución, etc.)
  - La interfaz de usuario muestra `Handoff failed: ...`

Matiz adicional: si la generación se completa pero no se extrae ningún texto, `handoff()` retorna `undefined` y el controlador actualmente informa **cancelado**, no **fallido**.

## Salvaguardas de sesión corta y contenido mínimo

Dos guardias previenen handoffs de baja señal:

- Capa de interfaz de usuario (`handleHandoffCommand`): advierte y retorna tempranamente para `< 2` entradas de mensajes
- Capa de sesión (`handoff()`): lanza la misma condición como un error

Esto evita crear una nueva sesión con un contexto de handoff vacío o casi vacío.

## Resumen de transición de estados

Flujo de estados de alto nivel:

1. Comando slash interactivo interceptado
2. Guardia de recuento de mensajes previa al vuelo
3. `#handoffAbortController` creado (`isGeneratingHandoff = true`)
4. Prompt de handoff interno enviado (visible en el chat como generación normal del asistente)
5. En `agent_end`, se extrae el último texto del asistente
6. Si está ausente/abortado → retorna `undefined` o la ruta de error de cancelación
7. Si está presente:
   - vaciar la sesión antigua
   - crear una nueva sesión vacía
   - restablecer las colas/contadores en tiempo de ejecución
   - agregar `custom_message(handoff)`
   - reconstruir y reemplazar los mensajes activos del agente
8. El controlador reconstruye la interfaz de usuario del chat y anuncia el éxito
9. `#handoffAbortController` limpiado (`isGeneratingHandoff = false`)

## Supuestos y limitaciones conocidos

- La extracción del handoff es heurística: "últimos bloques de texto del asistente"; sin validación estructural.
- No hay una verificación estricta de que el markdown generado siga el formato de sección solicitado.
- El texto extraído faltante se informa como cancelación en la experiencia del usuario del controlador.
- El flujo interactivo de `/handoff` actualmente carece de un enlace dedicado Escape→`abortHandoff()`.
- Los metadatos de linaje de la nueva sesión (`parentSession`) no son establecidos por esta ruta.
