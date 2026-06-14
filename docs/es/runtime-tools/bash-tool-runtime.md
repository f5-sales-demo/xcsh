---
title: Tiempo de ejecución de la herramienta Bash
description: >-
  Tiempo de ejecución de la herramienta Bash con gestión de procesos de shell,
  sandboxing, tiempo de espera y transmisión de salida.
sidebar:
  order: 1
  label: Herramienta Bash
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# Tiempo de ejecución de la herramienta Bash

Este documento describe la ruta de ejecución de la **herramienta `bash`** utilizada por las llamadas de herramientas del agente, desde la normalización de comandos hasta la ejecución, truncamiento/artefactos y renderizado.

También señala los lugares donde el comportamiento difiere en la TUI interactiva, el modo de impresión, el modo RPC y la ejecución de shell iniciada por el usuario con el signo de exclamación (`!`).

## Alcance y superficies de tiempo de ejecución

Existen dos superficies de ejecución de bash diferentes en el agente de codificación:

1. **Superficie de llamada de herramienta** (`toolName: "bash"`): se utiliza cuando el modelo llama a la herramienta bash.
   - Punto de entrada: `BashTool.execute()`.
2. **Superficie de comando bang de usuario** (`!cmd` desde entrada interactiva o comando RPC `bash`): ruta de ayuda a nivel de sesión.
   - Punto de entrada: `AgentSession.executeBash()`.

Ambas utilizan finalmente `executeBash()` en `src/exec/bash-executor.ts` para la ejecución sin PTY, pero solo la ruta de llamada de herramienta ejecuta la lógica de normalización/intercepción y el renderizador de herramientas.

## Pipeline de extremo a extremo para llamadas de herramienta

## 1) Normalización de entrada y fusión de parámetros

`BashTool.execute()` primero normaliza el comando sin procesar mediante `normalizeBashCommand()`:

- extrae los sufijos `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N` en límites estructurados,
- elimina los espacios en blanco al inicio y al final,
- mantiene intactos los espacios en blanco internos.

Luego fusiona los límites extraídos con los argumentos explícitos de la herramienta:

- los argumentos explícitos de `head`/`tail` anulan los valores extraídos,
- los valores extraídos son solo de reserva.

### Advertencia

Los comentarios de `bash-normalize.ts` mencionan la eliminación de `2>&1`, pero la implementación actual no lo elimina. El comportamiento en tiempo de ejecución sigue siendo correcto (stdout/stderr ya están combinados), pero el comportamiento de normalización es más limitado de lo que sugieren los comentarios.

## 2) Intercepción opcional (ruta de comando bloqueado)

Si `bashInterceptor.enabled` es verdadero, `BashTool` carga las reglas desde la configuración y ejecuta `checkBashInterception()` contra el comando normalizado.

Comportamiento de intercepción:

- el comando se bloquea **solo** cuando:
  - una regla de expresión regular coincide, y
  - la herramienta sugerida está presente en `ctx.toolNames`.
- las reglas de expresión regular inválidas se omiten silenciosamente.
- al bloquear, `BashTool` lanza `ToolError` con el mensaje:
  - `Blocked: ...`
  - comando original incluido.

Los patrones de reglas predeterminados (definidos en el código) apuntan a usos incorrectos comunes:

- lectores de archivos (`cat`, `head`, `tail`, ...),
- herramientas de búsqueda (`grep`, `rg`, ...),
- buscadores de archivos (`find`, `fd`, ...),
- editores en línea (`sed -i`, `perl -i`, `awk -i inplace`),
- escrituras de redirección de shell (`echo ... > file`, redirección heredoc).

### Advertencia

`InterceptionResult` incluye `suggestedTool`, pero `BashTool` actualmente solo expone el texto del mensaje (sin campo de herramienta sugerida estructurado en `details`).

## 3) Validación de CWD y limitación del tiempo de espera

`cwd` se resuelve de forma relativa al cwd de sesión (`resolveToCwd`), luego se valida mediante `stat`:

- ruta inexistente -> `ToolError("Working directory does not exist: ...")`
- no es un directorio -> `ToolError("Working directory is not a directory: ...")`

El tiempo de espera se limita al rango `[1, 3600]` segundos y se convierte a milisegundos.

## 4) Asignación de artefactos

Antes de la ejecución, la herramienta asigna una ruta/id de artefacto (con el mejor esfuerzo) para el almacenamiento de la salida truncada.

- el fallo en la asignación de artefactos no es fatal (la ejecución continúa sin el archivo de desbordamiento del artefacto),
- el id/ruta del artefacto se pasan a la ruta de ejecución para la persistencia de la salida completa en caso de truncamiento.

## 5) Selección de ejecución PTY frente a no PTY

`BashTool` elige la ejecución PTY solo cuando se cumplen todas las condiciones:

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- el contexto de la herramienta tiene UI (`ctx.hasUI === true` y `ctx.ui` configurado)

De lo contrario, utiliza `executeBash()` no interactivo.

Esto significa que el modo de impresión y los contextos RPC/herramienta sin UI siempre utilizan la ejecución sin PTY.

## Motor de ejecución no interactiva (`executeBash`)

## Modelo de reutilización de sesión de shell

`executeBash()` almacena en caché las instancias nativas de `Shell` en un mapa global al proceso, indexado por:

- ruta del shell,
- prefijo de comando configurado,
- ruta de instantánea,
- entorno de shell serializado,
- clave de sesión del agente opcional.

Para las ejecuciones a nivel de sesión, `AgentSession.executeBash()` pasa `sessionKey: this.sessionId`, aislando la reutilización por sesión.

La ruta de llamada de herramienta **no** pasa `sessionKey`, por lo que el alcance de reutilización se basa en la configuración del shell/instantánea/entorno.

## Configuración del shell y comportamiento de instantáneas

En cada llamada, el ejecutor carga la configuración del shell desde la configuración (`shell`, `env`, `prefix` opcional).

Si el shell seleccionado incluye `bash`, intenta `getOrCreateSnapshot()`:

- la instantánea captura alias/funciones/opciones del rc del usuario,
- la creación de instantáneas es con el mejor esfuerzo,
- el fallo recurre a no utilizar instantánea.

Si `prefix` está configurado, el comando se convierte en:

```text
<prefix> <command>
```

## Transmisión y cancelación

`Shell.run()` transmite fragmentos al callback. El ejecutor canaliza cada fragmento hacia `OutputSink` y el callback opcional `onChunk`.

Cancelación:

- la señal abortada activa `shellSession.abort(...)`,
- el tiempo de espera del resultado nativo se mapea a `cancelled: true` + texto de anotación,
- la cancelación explícita devuelve igualmente `cancelled: true` + anotación.

No se lanza ninguna excepción dentro del ejecutor por tiempo de espera/cancelación; devuelve un `BashResult` estructurado y deja que el llamador mapee la semántica de errores.

## Ruta PTY interactiva (`runInteractiveBashPty`)

Cuando PTY está habilitado, la herramienta ejecuta `runInteractiveBashPty()`, que abre un componente de consola en superposición y controla una `PtySession` nativa.

Aspectos destacados del comportamiento:

- el terminal virtual xterm-headless renderiza el viewport en superposición,
- la entrada del teclado se normaliza (incluyendo las secuencias Kitty y el manejo del modo de cursor de aplicación),
- `esc` mientras se ejecuta termina la sesión PTY,
- el cambio de tamaño del terminal se propaga al PTY (`session.resize(cols, rows)`).

Los valores predeterminados de refuerzo del entorno se inyectan para ejecuciones desatendidas:

- paginadores desactivados (`PAGER=cat`, `GIT_PAGER=cat`, etc.),
- prompts del editor desactivados (`GIT_EDITOR=true`, `EDITOR=true`, ...),
- prompts de terminal/autenticación reducidos (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`),
- indicadores de Automatización de gestor de paquetes/herramienta para comportamiento no interactivo.

La salida PTY se normaliza (`CRLF`/`CR` a `LF`, `sanitizeText`) y se escribe en `OutputSink`, incluido el soporte de desbordamiento a artefacto.

En caso de error de inicio/tiempo de ejecución de PTY, el sink recibe la línea `PTY error: ...` y el comando finaliza con código de salida indefinido.

## Gestión de salida: transmisión, truncamiento y desbordamiento a artefacto

Tanto las rutas PTY como las no PTY utilizan `OutputSink`.

## Semántica de OutputSink

- mantiene un búfer de cola en memoria con seguridad UTF-8 (`DEFAULT_MAX_BYTES`, actualmente 50KB),
- rastrea el total de bytes/líneas vistos,
- si existe una ruta de artefacto y la salida desborda (o el archivo ya está activo), escribe el flujo completo en el archivo de artefacto,
- cuando el umbral de memoria desborda, recorta el búfer en memoria a la cola (con seguridad en los límites UTF-8),
- marca `truncated` cuando ocurre desbordamiento/escritura a archivo.

`dump()` devuelve:

- `output` (posiblemente con prefijo anotado),
- `truncated`,
- `totalLines/totalBytes`,
- `outputLines/outputBytes`,
- `artifactId` si el archivo de artefacto estaba activo.

### Advertencia sobre salida larga

El truncamiento en tiempo de ejecución está basado en umbral de bytes en `OutputSink` (50KB por defecto). No impone un límite estricto de 2000 líneas en esta ruta de código.

## Actualizaciones en vivo de la herramienta

Para la ejecución sin PTY, `BashTool` utiliza un `TailBuffer` separado para actualizaciones parciales y emite instantáneas `onUpdate` mientras el comando se está ejecutando.

Para la ejecución PTY, el renderizado en vivo es gestionado por la superposición de UI personalizada, no por fragmentos de texto `onUpdate`.

## Conformación de resultados, metadatos y mapeo de errores

Después de la ejecución:

1. Manejo de `cancelled`:
   - si la señal de aborto está activada -> lanzar `ToolAbortError` (semántica de aborto),
   - de lo contrario -> lanzar `ToolError` (tratado como fallo de herramienta).
2. PTY `timedOut` -> lanzar `ToolError`.
3. aplicar filtros head/tail al texto de salida final (`applyHeadTail`, primero head, luego tail).
4. la salida vacía se convierte en `(no output)`.
5. adjuntar metadatos de truncamiento mediante `toolResult(...).truncationFromSummary(result, { direction: "tail" })`.
6. mapeo del código de salida:
   - código de salida ausente -> `ToolError("... missing exit status")`
   - salida no cero -> `ToolError("... Command exited with code N")`
   - salida cero -> resultado de éxito.

Estructura del payload de éxito:

- `content`: salida de texto,
- `details.meta.truncation` cuando se trunca, incluyendo:
  - `direction`, `truncatedBy`, conteos totales/de salida de líneas+bytes,
  - `shownRange`,
  - `artifactId` cuando está disponible.

Dado que las herramientas integradas están envueltas con `wrapToolWithMetaNotice()`, el texto de aviso de truncamiento se añade automáticamente al contenido de texto final (por ejemplo: `Full: artifact://<id>`).

## Rutas de renderizado

## Renderizador de llamadas de herramienta (`bashToolRenderer`)

`bashToolRenderer` se utiliza para los mensajes de llamadas de herramienta (`toolCall` / `toolResult`):

- el modo colapsado muestra una vista previa truncada por líneas visuales,
- el modo expandido muestra todo el texto de salida disponible actualmente,
- la línea de advertencia incluye el motivo del truncamiento y `artifact://<id>` cuando se trunca,
- el valor de tiempo de espera (de los argumentos) se muestra en la línea de metadatos del pie de página.

### Advertencia: expansión completa del artefacto

`BashRenderContext` tiene `isFullOutput`, pero el constructor de contexto del renderizador actual no lo establece para los resultados de la herramienta bash. La vista expandida sigue utilizando el texto ya presente en el contenido del resultado (salida de cola/truncada) a menos que otro llamador proporcione el contenido completo del artefacto.

## Componente de comando bang de usuario (`BashExecutionComponent`)

`BashExecutionComponent` es para los comandos `!` de usuario en modo interactivo (no llamadas de herramienta del modelo):

- transmite fragmentos en vivo,
- la vista previa colapsada mantiene las últimas 20 líneas lógicas,
- límite de línea en 4000 caracteres por línea,
- muestra advertencias de truncamiento + artefacto cuando los metadatos están presentes,
- marca el estado de cancelación/error/salida por separado.

Este componente está conectado por `CommandController.handleBashCommand()` y alimentado desde `AgentSession.executeBash()`.

## Diferencias de comportamiento según el modo

| Superficie                           | Ruta de entrada                                       | Elegible para PTY                                                          | UX de salida en vivo                                                              | Exposición de errores                                       |
| ------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Llamada de herramienta interactiva   | `BashTool.execute`                                    | Sí, cuando `bash.virtualTerminal=on` y existe UI y `PI_NO_PTY!=1`          | Superposición PTY (interactiva) o actualizaciones de cola transmitidas            | Los errores de herramienta se convierten en `toolResult.isError` |
| Llamada de herramienta en modo impresión | `BashTool.execute`                                 | No (sin contexto de UI)                                                    | Sin superposición TUI; la salida aparece en el flujo de eventos/texto del asistente | El mismo mapeo de errores de herramienta                   |
| Llamada de herramienta RPC (agente)  | `BashTool.execute`                                    | Por lo general sin UI -> sin PTY                                            | Eventos/resultados de herramienta estructurados                                   | El mismo mapeo de errores de herramienta                   |
| Comando bang interactivo (`!`)       | `AgentSession.executeBash` + `BashExecutionComponent` | No (usa el ejecutor directamente)                                          | Componente de ejecución bash dedicado                                             | El controlador captura excepciones y muestra error de UI   |
| Comando RPC `bash`                   | `rpc-mode` -> `session.executeBash`                   | No                                                                         | Devuelve `BashResult` directamente                                                | El consumidor gestiona los campos devueltos                |

## Advertencias operativas

- El interceptor solo bloquea comandos cuando la herramienta sugerida está actualmente disponible en el contexto.
- Si la asignación de artefactos falla, el truncamiento sigue ocurriendo pero no hay ninguna referencia inversa `artifact://` disponible.
- La caché de sesiones de shell no tiene una expulsión explícita en este módulo; la vida útil está limitada al proceso.
- Las superficies de tiempo de espera PTY y no PTY difieren:
  - PTY expone el campo de resultado explícito `timedOut`,
  - no PTY mapea el tiempo de espera en un resumen `cancelled + annotation`.

## Archivos de implementación

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — punto de entrada de la herramienta, normalización/intercepción, selección PTY/no PTY, mapeo de resultados/errores, renderizador de herramienta bash.
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — normalización de comandos y filtrado head/tail posterior a la ejecución.
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — coincidencia de reglas del interceptor y mensajes de comando bloqueado.
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — ejecutor sin PTY, reutilización de sesión de shell, conexión de cancelación, integración del sink de salida.
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — tiempo de ejecución PTY, UI de superposición, normalización de entrada, valores predeterminados de entorno no interactivo.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — truncamiento/desbordamiento a artefacto de `OutputSink` y metadatos de resumen.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — ayudantes de asignación de artefactos y búfer de cola de transmisión.
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — forma de metadatos de truncamiento + envoltorio de inyección de aviso.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `executeBash` a nivel de sesión, registro de mensajes, ciclo de vida de aborto.
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — componente de ejecución de comando `!` interactivo.
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — conexión para la finalización del flujo/actualización de UI del comando `!` interactivo.
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — superficie de comandos RPC `bash` y `abort_bash`.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — resolución de `artifact://<id>`.
