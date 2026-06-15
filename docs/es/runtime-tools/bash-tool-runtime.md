---
title: Tiempo de ejecución de la herramienta Bash
description: >-
  Tiempo de ejecución de la herramienta Bash con gestión de procesos de shell,
  aislamiento, tiempo de espera y transmisión de salida.
sidebar:
  order: 1
  label: Herramienta Bash
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# Tiempo de ejecución de la herramienta Bash

Este documento describe la ruta de tiempo de ejecución de la **herramienta `bash`** utilizada por las llamadas a herramientas del agente, desde la normalización de comandos hasta la ejecución, truncado/artefactos y renderizado.

También señala dónde difiere el comportamiento en la TUI interactiva, el modo de impresión, el modo RPC y la ejecución de shell bang (`!`) iniciada por el usuario.

## Alcance y superficies de tiempo de ejecución

Existen dos superficies de ejecución bash diferentes en el agente de codificación:

1. **Superficie de llamada a herramienta** (`toolName: "bash"`): utilizada cuando el modelo llama a la herramienta bash.
   - Punto de entrada: `BashTool.execute()`.
2. **Superficie de comando bang de usuario** (`!cmd` desde entrada interactiva o comando RPC `bash`): ruta auxiliar a nivel de sesión.
   - Punto de entrada: `AgentSession.executeBash()`.

Ambas utilizan finalmente `executeBash()` en `src/exec/bash-executor.ts` para la ejecución sin PTY, pero solo la ruta de llamada a herramienta ejecuta la lógica de normalización/interceptación y de renderizado de herramienta.

## Canalización de llamada a herramienta de extremo a extremo

## 1) Normalización de entrada y fusión de parámetros

`BashTool.execute()` primero normaliza el comando en bruto mediante `normalizeBashCommand()`:

- extrae los sufijos `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N` en límites estructurados,
- elimina los espacios en blanco al inicio y al final,
- mantiene intactos los espacios en blanco internos.

Luego fusiona los límites extraídos con los argumentos explícitos de la herramienta:

- los argumentos explícitos `head`/`tail` tienen precedencia sobre los valores extraídos,
- los valores extraídos son solo de reserva.

### Advertencia

Los comentarios de `bash-normalize.ts` mencionan la eliminación de `2>&1`, pero la implementación actual no lo elimina. El comportamiento en tiempo de ejecución sigue siendo correcto (stdout/stderr ya se combinan), pero el comportamiento de normalización es más limitado de lo que sugieren los comentarios.

## 2) Interceptación opcional (ruta de comando bloqueado)

Si `bashInterceptor.enabled` es verdadero, `BashTool` carga las reglas de configuración y ejecuta `checkBashInterception()` contra el comando normalizado.

Comportamiento de interceptación:

- el comando se bloquea **solo** cuando:
  - la regla de expresión regular coincide, y
  - la herramienta sugerida está presente en `ctx.toolNames`.
- las reglas de expresión regular no válidas se omiten silenciosamente.
- al bloquearse, `BashTool` lanza `ToolError` con el mensaje:
  - `Blocked: ...`
  - comando original incluido.

Los patrones de reglas predeterminados (definidos en el código) apuntan a usos incorrectos comunes:

- lectores de archivos (`cat`, `head`, `tail`, ...),
- herramientas de búsqueda (`grep`, `rg`, ...),
- buscadores de archivos (`find`, `fd`, ...),
- editores en sitio (`sed -i`, `perl -i`, `awk -i inplace`),
- escrituras de redirección de shell (`echo ... > file`, redirección heredoc).

### Advertencia

`InterceptionResult` incluye `suggestedTool`, pero `BashTool` actualmente solo muestra el texto del mensaje (sin campo de herramienta sugerida estructurado en `details`).

## 3) Validación de CWD y limitación de tiempo de espera

`cwd` se resuelve de manera relativa al cwd de sesión (`resolveToCwd`), luego se valida mediante `stat`:

- ruta inexistente -> `ToolError("Working directory does not exist: ...")`
- no es un directorio -> `ToolError("Working directory is not a directory: ...")`

El tiempo de espera se limita a `[1, 3600]` segundos y se convierte a milisegundos.

## 4) Asignación de artefactos

Antes de la ejecución, la herramienta asigna una ruta/id de artefacto (con mejor esfuerzo) para el almacenamiento de salida truncada.

- el fallo en la asignación de artefactos no es fatal (la ejecución continúa sin archivo de desbordamiento de artefacto),
- el id/ruta del artefacto se pasan a la ruta de ejecución para la persistencia de salida completa en caso de truncado.

## 5) Selección de ejecución PTY vs sin PTY

`BashTool` elige la ejecución PTY solo cuando se cumplen todas las condiciones:

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- el contexto de la herramienta tiene interfaz de usuario (`ctx.hasUI === true` y `ctx.ui` definido)

De lo contrario, utiliza `executeBash()` no interactivo.

Esto significa que el modo de impresión y los contextos RPC/herramienta sin interfaz de usuario siempre usan sin PTY.

## Motor de ejecución no interactiva (`executeBash`)

## Modelo de reutilización de sesión de shell

`executeBash()` almacena en caché instancias nativas de `Shell` en un mapa global de proceso con clave por:

- ruta de shell,
- prefijo de comando configurado,
- ruta de instantánea,
- entorno de shell serializado,
- clave de sesión de agente opcional.

Para ejecuciones a nivel de sesión, `AgentSession.executeBash()` pasa `sessionKey: this.sessionId`, aislando la reutilización por sesión.

La ruta de llamada a herramienta **no** pasa `sessionKey`, por lo que el alcance de reutilización se basa en la configuración de shell/instantánea/entorno.

## Configuración de shell y comportamiento de instantáneas

En cada llamada, el ejecutor carga la configuración de shell de los ajustes (`shell`, `env`, `prefix` opcional).

Si el shell seleccionado incluye `bash`, intenta `getOrCreateSnapshot()`:

- la instantánea captura alias/funciones/opciones del rc del usuario,
- la creación de instantáneas es con mejor esfuerzo,
- el fallo recurre a ninguna instantánea.

Si se configura `prefix`, el comando se convierte en:

```text
<prefix> <command>
```

## Transmisión y cancelación

`Shell.run()` transmite fragmentos al callback. El ejecutor canaliza cada fragmento a `OutputSink` y al callback `onChunk` opcional.

Cancelación:

- la señal abortada activa `shellSession.abort(...)`,
- el tiempo de espera del resultado nativo se asigna a `cancelled: true` + texto de anotación,
- la cancelación explícita también devuelve `cancelled: true` + anotación.

No se lanza ninguna excepción dentro del ejecutor por tiempo de espera/cancelación; devuelve un `BashResult` estructurado y deja que el llamador mapee la semántica de error.

## Ruta PTY interactiva (`runInteractiveBashPty`)

Cuando PTY está habilitado, la herramienta ejecuta `runInteractiveBashPty()` que abre un componente de consola superpuesta y dirige una `PtySession` nativa.

Aspectos destacados del comportamiento:

- la terminal virtual xterm-headless renderiza la vista en superposición,
- la entrada de teclado se normaliza (incluida la gestión de secuencias Kitty y el modo de cursor de aplicación),
- `esc` durante la ejecución termina la sesión PTY,
- el cambio de tamaño de terminal se propaga al PTY (`session.resize(cols, rows)`).

Se inyectan valores predeterminados de refuerzo del entorno para ejecuciones desatendidas:

- paginadores deshabilitados (`PAGER=cat`, `GIT_PAGER=cat`, etc.),
- indicaciones del editor deshabilitadas (`GIT_EDITOR=true`, `EDITOR=true`, ...),
- indicaciones de terminal/autenticación reducidas (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`),
- indicadores de automatización de gestor de paquetes/herramienta para comportamiento no interactivo.

La salida PTY se normaliza (`CRLF`/`CR` a `LF`, `sanitizeText`) y se escribe en `OutputSink`, incluido el soporte de desbordamiento a artefacto.

En caso de error de inicio/tiempo de ejecución de PTY, el sink recibe una línea `PTY error: ...` y el comando finaliza con código de salida indefinido.

## Gestión de salida: transmisión, truncado y desbordamiento a artefacto

Tanto las rutas PTY como las sin PTY utilizan `OutputSink`.

## Semántica de OutputSink

- mantiene un búfer de cola en memoria seguro para UTF-8 (`DEFAULT_MAX_BYTES`, actualmente 50 KB),
- rastrea el total de bytes/líneas observados,
- si existe una ruta de artefacto y la salida se desborda (o el archivo ya está activo), escribe el flujo completo en el archivo de artefacto,
- cuando el umbral de memoria se desborda, recorta el búfer en memoria a la cola (seguro para límites UTF-8),
- marca `truncated` cuando ocurre desbordamiento/escritura en archivo.

`dump()` devuelve:

- `output` (posiblemente con prefijo anotado),
- `truncated`,
- `totalLines/totalBytes`,
- `outputLines/outputBytes`,
- `artifactId` si el archivo de artefacto estaba activo.

### Advertencia sobre salidas largas

El truncado en tiempo de ejecución se basa en el umbral de bytes en `OutputSink` (50 KB por defecto). No impone un límite estricto de 2000 líneas en esta ruta de código.

## Actualizaciones en vivo de la herramienta

Para la ejecución sin PTY, `BashTool` usa un `TailBuffer` separado para actualizaciones parciales y emite instantáneas `onUpdate` mientras el comando está en ejecución.

Para la ejecución PTY, el renderizado en vivo es gestionado por la superposición de interfaz de usuario personalizada, no por fragmentos de texto `onUpdate`.

## Conformación de resultados, metadatos y mapeo de errores

Después de la ejecución:

1. Gestión de `cancelled`:
   - si la señal de aborto está activada -> lanzar `ToolAbortError` (semántica de aborto),
   - de lo contrario -> lanzar `ToolError` (tratado como fallo de herramienta).
2. `timedOut` de PTY -> lanzar `ToolError`.
3. aplicar filtros head/tail al texto de salida final (`applyHeadTail`, head primero, luego tail).
4. la salida vacía se convierte en `(no output)`.
5. adjuntar metadatos de truncado mediante `toolResult(...).truncationFromSummary(result, { direction: "tail" })`.
6. mapeo de código de salida:
   - código de salida faltante -> `ToolError("... missing exit status")`
   - salida no cero -> `ToolError("... Command exited with code N")`
   - salida cero -> resultado exitoso.

Estructura de carga útil exitosa:

- `content`: salida de texto,
- `details.meta.truncation` cuando se trunca, incluyendo:
  - `direction`, `truncatedBy`, conteos totales/de salida de líneas + bytes,
  - `shownRange`,
  - `artifactId` cuando está disponible.

Debido a que las herramientas integradas están envueltas con `wrapToolWithMetaNotice()`, el texto de aviso de truncado se agrega automáticamente al contenido de texto final (por ejemplo: `Full: artifact://<id>`).

## Rutas de renderizado

## Renderizador de llamada a herramienta (`bashToolRenderer`)

`bashToolRenderer` se utiliza para mensajes de llamada a herramienta (`toolCall` / `toolResult`):

- el modo contraído muestra una vista previa truncada por líneas visuales,
- el modo expandido muestra todo el texto de salida disponible actualmente,
- la línea de advertencia incluye la razón del truncado y `artifact://<id>` cuando se trunca,
- el valor de tiempo de espera (de los argumentos) se muestra en la línea de metadatos del pie de página.

### Advertencia: expansión completa de artefacto

`BashRenderContext` tiene `isFullOutput`, pero el constructor de contexto de renderizador actual no lo establece para los resultados de la herramienta bash. La vista expandida sigue utilizando el texto ya presente en el contenido del resultado (salida de cola/truncada) a menos que otro llamador proporcione el contenido completo del artefacto.

## Componente de comando bang de usuario (`BashExecutionComponent`)

`BashExecutionComponent` es para comandos `!` de usuario en modo interactivo (no llamadas a herramienta del modelo):

- transmite fragmentos en vivo,
- la vista previa contraída mantiene las últimas 20 líneas lógicas,
- límite de línea a 4000 caracteres por línea,
- muestra advertencias de truncado + artefacto cuando hay metadatos presentes,
- marca el estado de cancelado/error/salida por separado.

Este componente es conectado por `CommandController.handleBashCommand()` y alimentado desde `AgentSession.executeBash()`.

## Diferencias de comportamiento específicas por modo

| Superficie                          | Ruta de entrada                                        | Elegible para PTY                                                          | UX de salida en vivo                                                        | Exposición de errores                                            |
| ----------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Llamada a herramienta interactiva   | `BashTool.execute`                                     | Sí, cuando `bash.virtualTerminal=on` y existe interfaz de usuario y `PI_NO_PTY!=1` | Superposición PTY (interactiva) o actualizaciones de cola transmitidas      | Los errores de herramienta se convierten en `toolResult.isError` |
| Llamada a herramienta en modo impresión | `BashTool.execute`                                 | No (sin contexto de interfaz de usuario)                                   | Sin superposición TUI; la salida aparece en el flujo de eventos/texto final del asistente | Mismo mapeo de error de herramienta                             |
| Llamada a herramienta RPC (herramientas del agente) | `BashTool.execute`                    | Generalmente sin interfaz de usuario -> sin PTY                            | Eventos/resultados de herramienta estructurados                             | Mismo mapeo de error de herramienta                             |
| Comando bang interactivo (`!`)      | `AgentSession.executeBash` + `BashExecutionComponent` | No (usa el ejecutor directamente)                                          | Componente de ejecución bash dedicado                                       | El controlador captura excepciones y muestra error de interfaz de usuario |
| Comando RPC `bash`                  | `rpc-mode` -> `session.executeBash`                    | No                                                                         | Devuelve `BashResult` directamente                                          | El consumidor gestiona los campos devueltos                      |

## Advertencias operativas

- El interceptor solo bloquea comandos cuando la herramienta sugerida está disponible actualmente en el contexto.
- Si la asignación de artefactos falla, el truncado sigue ocurriendo pero no hay referencia inversa `artifact://` disponible.
- La caché de sesiones de shell no tiene evacuación explícita en este módulo; su duración es de alcance de proceso.
- Las superficies de tiempo de espera de PTY y sin PTY difieren:
  - PTY expone el campo de resultado explícito `timedOut`,
  - sin PTY mapea el tiempo de espera en el resumen `cancelled + annotation`.

## Archivos de implementación

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — punto de entrada de la herramienta, normalización/interceptación, selección PTY/sin PTY, mapeo de resultado/error, renderizador de herramienta bash.
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — normalización de comandos y filtrado head/tail posterior a la ejecución.
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — coincidencia de reglas del interceptor y mensajes de comando bloqueado.
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — ejecutor sin PTY, reutilización de sesión de shell, conexión de cancelación, integración de sink de salida.
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — tiempo de ejecución PTY, interfaz de usuario superpuesta, normalización de entrada, valores predeterminados de entorno no interactivo.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — truncado/desbordamiento a artefacto de `OutputSink` y metadatos de resumen.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — ayudantes de asignación de artefactos y búfer de cola de transmisión.
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — forma de metadatos de truncado + envoltorio de inyección de avisos.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `executeBash` a nivel de sesión, registro de mensajes, ciclo de vida de aborto.
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — componente de ejecución de comando `!` interactivo.
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — conexión para la finalización de flujo/actualización de interfaz de usuario del comando `!` interactivo.
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — superficie de comandos RPC `bash` y `abort_bash`.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — resolución de `artifact://<id>`.
