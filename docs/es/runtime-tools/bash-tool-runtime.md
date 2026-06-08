---
title: Bash Tool Runtime
description: >-
  Bash tool runtime with shell process management, sandboxing, timeout, and
  output streaming.
sidebar:
  order: 1
  label: Bash tool
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# Entorno de ejecución de la herramienta bash

Este documento describe la ruta del entorno de ejecución de la **herramienta `bash`** utilizada por las llamadas a herramientas del agente, desde la normalización de comandos hasta la ejecución, truncamiento/artefactos y renderizado.

También señala dónde el comportamiento diverge en la TUI interactiva, el modo de impresión, el modo RPC y la ejecución de shell iniciada por el usuario con bang (`!`).

## Alcance y superficies de ejecución

Existen dos superficies diferentes de ejecución bash en coding-agent:

1. **Superficie de llamada a herramienta** (`toolName: "bash"`): utilizada cuando el modelo invoca la herramienta bash.
   - Punto de entrada: `BashTool.execute()`.
2. **Superficie de comando bang del usuario** (`!cmd` desde entrada interactiva o comando RPC `bash`): ruta auxiliar a nivel de sesión.
   - Punto de entrada: `AgentSession.executeBash()`.

Ambas eventualmente utilizan `executeBash()` en `src/exec/bash-executor.ts` para ejecución sin PTY, pero solo la ruta de llamada a herramienta ejecuta la lógica de normalización/intercepción y renderizado de herramientas.

## Pipeline completo de llamada a herramienta

## 1) Normalización de entrada y combinación de parámetros

`BashTool.execute()` primero normaliza el comando sin procesar mediante `normalizeBashCommand()`:

- extrae los `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N` finales en límites estructurados,
- recorta espacios en blanco al inicio y al final,
- mantiene intactos los espacios en blanco internos.

Luego combina los límites extraídos con los argumentos explícitos de la herramienta:

- los argumentos explícitos `head`/`tail` sobrescriben los valores extraídos,
- los valores extraídos son solo un respaldo.

### Advertencia

Los comentarios en `bash-normalize.ts` mencionan la eliminación de `2>&1`, pero la implementación actual no lo elimina. El comportamiento en tiempo de ejecución sigue siendo correcto (stdout/stderr ya están combinados), pero el comportamiento de normalización es más limitado de lo que sugieren los comentarios.

## 2) Intercepción opcional (ruta de comando bloqueado)

Si `bashInterceptor.enabled` es verdadero, `BashTool` carga las reglas desde la configuración y ejecuta `checkBashInterception()` contra el comando normalizado.

Comportamiento de la intercepción:

- el comando se bloquea **solo** cuando:
  - una regla regex coincide, y
  - la herramienta sugerida está presente en `ctx.toolNames`.
- las reglas regex inválidas se omiten silenciosamente.
- al bloquear, `BashTool` lanza `ToolError` con el mensaje:
  - `Blocked: ...`
  - comando original incluido.

Los patrones de reglas predeterminados (definidos en el código) apuntan a usos incorrectos comunes:

- lectores de archivos (`cat`, `head`, `tail`, ...)
- herramientas de búsqueda (`grep`, `rg`, ...)
- buscadores de archivos (`find`, `fd`, ...)
- editores in situ (`sed -i`, `perl -i`, `awk -i inplace`)
- escrituras por redirección de shell (`echo ... > file`, redirección heredoc)

### Advertencia

`InterceptionResult` incluye `suggestedTool`, pero `BashTool` actualmente solo expone el texto del mensaje (no hay un campo estructurado de herramienta sugerida en `details`).

## 3) Validación de CWD y limitación de timeout

`cwd` se resuelve relativo al cwd de la sesión (`resolveToCwd`), luego se valida mediante `stat`:

- ruta inexistente -> `ToolError("Working directory does not exist: ...")`
- no es un directorio -> `ToolError("Working directory is not a directory: ...")`

El timeout se limita a `[1, 3600]` segundos y se convierte a milisegundos.

## 4) Asignación de artefactos

Antes de la ejecución, la herramienta asigna una ruta/id de artefacto (mejor esfuerzo) para almacenar la salida truncada.

- el fallo en la asignación de artefactos no es fatal (la ejecución continúa sin archivo de volcado de artefacto),
- el id/ruta del artefacto se pasan a la ruta de ejecución para la persistencia de salida completa en caso de truncamiento.

## 5) Selección de ejecución PTY vs no-PTY

`BashTool` elige la ejecución PTY solo cuando se cumplen todas las condiciones:

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- el contexto de la herramienta tiene UI (`ctx.hasUI === true` y `ctx.ui` configurado)

De lo contrario, utiliza `executeBash()` no interactivo.

Esto significa que el modo de impresión y los contextos RPC/herramienta sin UI siempre usan no-PTY.

## Motor de ejecución no interactivo (`executeBash`)

## Modelo de reutilización de sesión de shell

`executeBash()` almacena en caché instancias nativas de `Shell` en un mapa global del proceso indexado por:

- ruta del shell,
- prefijo de comando configurado,
- ruta del snapshot,
- entorno del shell serializado,
- clave de sesión del agente opcional.

Para ejecuciones a nivel de sesión, `AgentSession.executeBash()` pasa `sessionKey: this.sessionId`, aislando la reutilización por sesión.

La ruta de llamada a herramienta **no** pasa `sessionKey`, por lo que el alcance de reutilización se basa en la configuración del shell/snapshot/entorno.

## Configuración del shell y comportamiento del snapshot

En cada llamada, el ejecutor carga la configuración del shell desde los ajustes (`shell`, `env`, `prefix` opcional).

Si el shell seleccionado incluye `bash`, intenta `getOrCreateSnapshot()`:

- el snapshot captura aliases/funciones/opciones del rc del usuario,
- la creación del snapshot es de mejor esfuerzo,
- el fallo recurre a no usar snapshot.

Si `prefix` está configurado, el comando se convierte en:

```text
<prefix> <command>
```

## Streaming y cancelación

`Shell.run()` transmite fragmentos al callback. El ejecutor envía cada fragmento a `OutputSink` y al callback opcional `onChunk`.

Cancelación:

- la señal de aborto activada dispara `shellSession.abort(...)`,
- el timeout del resultado nativo se mapea a `cancelled: true` + texto de anotación,
- la cancelación explícita igualmente retorna `cancelled: true` + anotación.

No se lanza ninguna excepción dentro del ejecutor por timeout/cancelación; retorna un `BashResult` estructurado y permite que el llamador mapee la semántica de error.

## Ruta PTY interactiva (`runInteractiveBashPty`)

Cuando PTY está habilitado, la herramienta ejecuta `runInteractiveBashPty()` que abre un componente de consola superpuesta y controla un `PtySession` nativo.

Aspectos destacados del comportamiento:

- el terminal virtual xterm-headless renderiza la vista en la superposición,
- la entrada de teclado se normaliza (incluyendo el manejo de secuencias Kitty y modo de cursor de aplicación),
- `esc` mientras se ejecuta mata la sesión PTY,
- el redimensionamiento del terminal se propaga al PTY (`session.resize(cols, rows)`).

Se inyectan valores predeterminados de endurecimiento del entorno para ejecuciones desatendidas:

- paginadores deshabilitados (`PAGER=cat`, `GIT_PAGER=cat`, etc.),
- solicitudes de editor deshabilitadas (`GIT_EDITOR=true`, `EDITOR=true`, ...),
- solicitudes de terminal/autenticación reducidas (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`),
- flags de automatización de gestores de paquetes/herramientas para comportamiento no interactivo.

La salida PTY se normaliza (`CRLF`/`CR` a `LF`, `sanitizeText`) y se escribe en `OutputSink`, incluyendo soporte de volcado de artefactos.

En caso de error de inicio/ejecución del PTY, el sink recibe una línea `PTY error: ...` y el comando finaliza con código de salida indefinido.

## Manejo de salida: streaming, truncamiento, volcado de artefactos

Tanto las rutas PTY como no-PTY utilizan `OutputSink`.

## Semántica de OutputSink

- mantiene un búfer de cola en memoria seguro para UTF-8 (`DEFAULT_MAX_BYTES`, actualmente 50KB),
- rastrea el total de bytes/líneas vistos,
- si existe una ruta de artefacto y la salida se desborda (o el archivo ya está activo), escribe el flujo completo al archivo de artefacto,
- cuando el umbral de memoria se desborda, recorta el búfer en memoria a la cola (seguro en límites UTF-8),
- marca `truncated` cuando ocurre desbordamiento/volcado a archivo.

`dump()` retorna:

- `output` (posiblemente con prefijo anotado),
- `truncated`,
- `totalLines/totalBytes`,
- `outputLines/outputBytes`,
- `artifactId` si el archivo de artefacto estaba activo.

### Advertencia sobre salida larga

El truncamiento en tiempo de ejecución se basa en umbral de bytes en `OutputSink` (50KB por defecto). No aplica un límite estricto de 2000 líneas en esta ruta de código.

## Actualizaciones en vivo de la herramienta

Para ejecución no-PTY, `BashTool` utiliza un `TailBuffer` separado para actualizaciones parciales y emite snapshots `onUpdate` mientras el comando se ejecuta.

Para ejecución PTY, el renderizado en vivo es manejado por la superposición de UI personalizada, no por fragmentos de texto `onUpdate`.

## Conformación del resultado, metadatos y mapeo de errores

Después de la ejecución:

1. Manejo de `cancelled`:
   - si la señal de aborto está abortada -> lanza `ToolAbortError` (semántica de aborto),
   - de lo contrario -> lanza `ToolError` (tratado como fallo de herramienta).
2. PTY `timedOut` -> lanza `ToolError`.
3. aplica filtros head/tail al texto de salida final (`applyHeadTail`, head luego tail).
4. salida vacía se convierte en `(no output)`.
5. adjunta metadatos de truncamiento mediante `toolResult(...).truncationFromSummary(result, { direction: "tail" })`.
6. mapeo de código de salida:
   - código de salida ausente -> `ToolError("... missing exit status")`
   - salida no cero -> `ToolError("... Command exited with code N")`
   - salida cero -> resultado exitoso.

Estructura del payload exitoso:

- `content`: texto de salida,
- `details.meta.truncation` cuando está truncado, incluyendo:
  - `direction`, `truncatedBy`, conteos totales/de salida de líneas+bytes,
  - `shownRange`,
  - `artifactId` cuando está disponible.

Debido a que las herramientas integradas están envueltas con `wrapToolWithMetaNotice()`, el texto de aviso de truncamiento se agrega automáticamente al contenido de texto final (por ejemplo: `Full: artifact://<id>`).

## Rutas de renderizado

## Renderizador de llamada a herramienta (`bashToolRenderer`)

`bashToolRenderer` se usa para mensajes de llamada a herramienta (`toolCall` / `toolResult`):

- el modo colapsado muestra una vista previa truncada por líneas visuales,
- el modo expandido muestra todo el texto de salida disponible actualmente,
- la línea de advertencia incluye la razón del truncamiento y `artifact://<id>` cuando está truncado,
- el valor de timeout (de los argumentos) se muestra en la línea de metadatos del pie de página.

### Advertencia: expansión completa de artefactos

`BashRenderContext` tiene `isFullOutput`, pero el constructor del contexto del renderizador actual no lo establece para resultados de la herramienta bash. La vista expandida aún utiliza el texto que ya está en el contenido del resultado (salida truncada/cola) a menos que otro llamador proporcione el contenido completo del artefacto.

## Componente de comando bang del usuario (`BashExecutionComponent`)

`BashExecutionComponent` es para comandos `!` del usuario en modo interactivo (no llamadas a herramientas del modelo):

- transmite fragmentos en vivo,
- la vista previa colapsada mantiene las últimas 20 líneas lógicas,
- límite de línea a 4000 caracteres por línea,
- muestra advertencias de truncamiento + artefacto cuando los metadatos están presentes,
- marca estados de cancelado/error/salida por separado.

Este componente está conectado por `CommandController.handleBashCommand()` y alimentado desde `AgentSession.executeBash()`.

## Diferencias de comportamiento específicas por modo

| Superficie                     | Ruta de entrada                                       | Elegible para PTY                                                    | UX de salida en vivo                                                     | Exposición de errores                            |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| Llamada a herramienta interactiva | `BashTool.execute`                                 | Sí, cuando `bash.virtualTerminal=on` y existe UI y `PI_NO_PTY!=1`   | Superposición PTY (interactiva) o actualizaciones de cola en streaming   | Los errores de herramienta se convierten en `toolResult.isError` |
| Llamada a herramienta en modo impresión | `BashTool.execute`                           | No (sin contexto de UI)                                              | Sin superposición TUI; la salida aparece en el flujo de eventos/texto final del asistente | Mismo mapeo de errores de herramienta            |
| Llamada a herramienta RPC (herramientas del agente) | `BashTool.execute`                    | Usualmente sin UI -> no-PTY                                          | Eventos/resultados estructurados de herramienta                          | Mismo mapeo de errores de herramienta            |
| Comando bang interactivo (`!`) | `AgentSession.executeBash` + `BashExecutionComponent` | No (usa el ejecutor directamente)                                    | Componente dedicado de ejecución bash                                    | El controlador captura excepciones y muestra error en UI |
| Comando RPC `bash`             | `rpc-mode` -> `session.executeBash`                   | No                                                                   | Retorna `BashResult` directamente                                        | El consumidor maneja los campos retornados       |

## Advertencias operacionales

- El interceptor solo bloquea comandos cuando la herramienta sugerida está actualmente disponible en el contexto.
- Si la asignación de artefactos falla, el truncamiento aún ocurre pero no hay referencia `artifact://` disponible.
- La caché de sesiones de shell no tiene desalojo explícito en este módulo; el tiempo de vida tiene alcance de proceso.
- Las superficies de timeout de PTY y no-PTY difieren:
  - PTY expone un campo de resultado explícito `timedOut`,
  - no-PTY mapea el timeout a un resumen `cancelled + annotation`.

## Archivos de implementación

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — punto de entrada de la herramienta, normalización/intercepción, selección PTY/no-PTY, mapeo de resultado/error, renderizador de herramienta bash.
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — normalización de comandos y filtrado head/tail posterior a la ejecución.
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — coincidencia de reglas del interceptor y mensajes de comandos bloqueados.
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — ejecutor no-PTY, reutilización de sesión de shell, cableado de cancelación, integración con output sink.
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — entorno de ejecución PTY, UI de superposición, normalización de entrada, valores predeterminados de entorno no interactivo.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — truncamiento/volcado de artefactos de `OutputSink` y metadatos de resumen.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — helpers de asignación de artefactos y búfer de cola para streaming.
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — forma de metadatos de truncamiento + wrapper de inyección de avisos.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `executeBash` a nivel de sesión, grabación de mensajes, ciclo de vida de aborto.
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — componente de ejecución de comando `!` interactivo.
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — cableado para el streaming/finalización de actualización de la UI del comando `!` interactivo.
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — superficie de comandos RPC `bash` y `abort_bash`.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — resolución de `artifact://<id>`.
