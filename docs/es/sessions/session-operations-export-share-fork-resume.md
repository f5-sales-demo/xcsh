---
title: 'Operaciones de sesión: Exportar, Volcar, Compartir, Bifurcar, Reanudar'
description: >-
  Operaciones de sesión para exportar, compartir, bifurcar y reanudar
  conversaciones.
sidebar:
  order: 3
  label: Operaciones
i18n:
  sourceHash: e3c210b29c3e
  translator: machine
---

# Operaciones de sesión: export, dump, share, fork, resume/continue

Este documento describe el comportamiento visible para el operador de las operaciones de sesión export/share/fork/resume tal como están implementadas actualmente.

## Archivos de implementación

- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/export/html/index.ts`](../../packages/coding-agent/src/export/html/index.ts)
- [`../src/export/custom-share.ts`](../../packages/coding-agent/src/export/custom-share.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)

## Matriz de operaciones

| Operación | Ruta de entrada | Mutación de sesión | Creación/cambio de archivo de sesión | Artefacto de salida |
|---|---|---|---|---|
| `/dump` | Comando interactivo con barra | No | No | Texto en portapapeles |
| `/export [path]` | Comando interactivo con barra | No | No | Archivo HTML |
| `--export <session.jsonl> [outputPath]` | Ruta rápida de inicio CLI | Sin mutación de sesión en tiempo de ejecución | Sin sesión activa; lee el archivo objetivo | Archivo HTML |
| `/share` | Comando interactivo con barra | No | No | HTML temporal + URL de compartición/gist |
| `/fork` | Comando interactivo con barra | Sí (la identidad de la sesión activa cambia) | Crea un nuevo archivo de sesión y cambia la sesión actual a él (solo en modo persistente) | Copia el directorio de artefactos al nuevo espacio de nombres de sesión cuando está presente |
| `/resume` | Comando interactivo con barra | Sí (el estado activo en memoria se reemplaza) | Cambia al archivo de sesión existente seleccionado | Ninguno |
| `--resume` | Inicio CLI (selector) | Sí después de la creación de sesión | Abre el archivo de sesión existente seleccionado | Ninguno |
| `--resume <id\|path>` | Inicio CLI | Sí después de la creación de sesión | Abre sesión existente; el caso entre proyectos puede bifurcar en el proyecto actual | Ninguno |
| `--continue` | Inicio CLI | Sí después de la creación de sesión | Abre la migaja de pan del terminal o la sesión más reciente; crea una nueva si no existe ninguna | Ninguno |

## Exportar y volcar

### `/export [outputPath]` (interactivo)

Flujo:

1. `InputController` enruta `/export...` a `CommandController.handleExportCommand`.
2. El comando divide por espacios en blanco y usa solo el primer argumento después de `/export` como `outputPath`.
3. `AgentSession.exportToHtml()` llama a `exportSessionToHtml(sessionManager, state, { outputPath, themeName })`.
4. En caso de éxito, la interfaz muestra la ruta y abre el archivo en el navegador.

Detalles de comportamiento:

- Los argumentos `--copy`, `clipboard` y `copy` son rechazados explícitamente con una advertencia para usar `/dump`.
- La exportación incorpora la cabecera/entradas/hoja de la sesión más el `systemPrompt` actual y las descripciones de herramientas del estado del agente.
- No se añaden entradas de sesión durante la exportación.

Advertencia:

- El análisis de argumentos se basa en espacios en blanco (`text.split(/\s+/)`), por lo que las rutas entrecomilladas con espacios no se preservan como una sola ruta en esta ruta de comando.

### `--export <inputSessionFile> [outputPath]` (CLI)

Flujo en `main.ts`:

1. Se maneja de forma temprana (antes del inicio interactivo/de sesión).
2. Llama a `exportFromFile(inputPath, outputPath?)`.
3. `SessionManager.open(inputPath)` carga las entradas, luego se genera y escribe el HTML.
4. El proceso imprime `Exported to: ...` y sale.

Detalles de comportamiento:

- Un archivo de entrada faltante se muestra como `File not found: <path>`.
- Esta ruta no crea un `AgentSession` y no muta ninguna sesión en ejecución.

### `/dump` (exportación interactiva al portapapeles)

Flujo:

1. `CommandController.handleDumpCommand()` llama a `session.formatSessionAsText()`.
2. Si es una cadena vacía, reporta `No messages to dump yet.`
3. De lo contrario, copia al portapapeles mediante `copyToClipboard` nativo.

El contenido del volcado incluye:

- Prompt del sistema
- Modelo activo/nivel de pensamiento
- Definiciones de herramientas + parámetros
- Mensajes de usuario/asistente
- Bloques de pensamiento y llamadas a herramientas
- Resultados de herramientas y bloques de ejecución (excepto las entradas bash/python con `excludeFromContext`)
- Entradas personalizadas/hook/mención de archivo/resumen de rama/resumen de compactación

El volcado no realiza cambios en la persistencia de la sesión.

## Compartir

`/share` es solo interactivo y siempre comienza exportando la sesión actual a un archivo HTML temporal.

### Fase 1: exportación temporal

- Ruta del archivo temporal: `${os.tmpdir()}/${Snowflake.next()}.html`
- Usa `session.exportToHtml(tmpFile)`
- Si la exportación falla (especialmente en sesiones en memoria), la compartición termina con error.

### Fase 2: manejador de compartición personalizado (si existe)

`loadCustomShare()` busca en `~/.xcsh/agent` el primer candidato existente:

- `share.ts`
- `share.js`
- `share.mjs`

Requisitos:

- El módulo debe exportar por defecto una función `(htmlPath) => Promise<CustomShareResult | string | undefined>`.

Si está presente y es válido:

- La interfaz entra en estado de carga `Sharing...`.
- Interpretación del resultado del manejador:
  - string => se trata como URL, se muestra y se abre
  - object => se muestran `url` y/o `message`; se abre `url`
  - `undefined`/falsy => `Session shared` genérico
- El archivo temporal se elimina después de completarse.

Comportamiento crítico de respaldo:

- Si el manejador personalizado existe pero la carga falla, el comando genera error y retorna.
- Si el manejador personalizado se ejecuta y lanza una excepción, el comando genera error y retorna.
- En ambos casos de fallo, **no** recurre al gist de GitHub.
- El respaldo a gist ocurre solo cuando no existe ningún script de compartición personalizado.

### Fase 3: respaldo por defecto a gist

Solo cuando no se encuentra ningún manejador de compartición personalizado:

1. Valida `gh auth status`.
2. Muestra el indicador de carga `Creating gist...`.
3. Ejecuta `gh gist create --public=false <tmpFile>`.
4. Analiza la URL del gist, deriva el id del gist, construye la URL de vista previa `https://gistpreview.github.io/?<id>`.
5. Muestra tanto la URL de vista previa como la del gist; abre la vista previa.

Semántica de cancelación/aborto en compartir:

- El indicador de carga tiene un hook `onAbort` que restaura la interfaz del editor y reporta `Share cancelled`.
- El comando subyacente `gh gist create` no recibe una señal de aborto en esta ruta de código; la cancelación es a nivel de interfaz y se verifica después de que el comando retorna.

## Bifurcar

`/fork` crea una nueva sesión a partir de la actual y cambia la identidad de la sesión activa.

### Precondiciones y guardas inmediatas

- Si el agente está transmitiendo, `/fork` se rechaza con advertencia.
- Los indicadores de estado/carga de la interfaz se limpian antes de la operación.

### Flujo a nivel de sesión

`AgentSession.fork()`:

1. Emite `session_before_switch` con `reason: "fork"` (cancelable).
2. Vacía las escrituras pendientes.
3. Llama a `SessionManager.fork()`.
4. Copia el directorio de artefactos del espacio de nombres de la sesión anterior al nuevo (mejor esfuerzo; los fallos de copia que no son ENOENT se registran, no son fatales).
5. Actualiza `agent.sessionId`.
6. Emite `session_switch` con `reason: "fork"`.

Comportamiento de `SessionManager.fork()`:

- Requiere modo persistente y archivo de sesión existente.
- Crea un nuevo id de sesión y una nueva ruta de archivo JSONL.
- Reescribe la cabecera con:
  - nuevo `id`
  - nueva marca de tiempo
  - `cwd` sin cambios
  - `parentSession` establecido al id de sesión anterior
- Mantiene todas las entradas que no son cabecera sin cambios en el nuevo archivo.

### Comportamiento no persistente

- El administrador de sesiones en memoria retorna `undefined` desde `fork()`.
- `AgentSession.fork()` retorna `false`.
- La interfaz reporta `Fork failed (session not persisted or cancelled)`.

## Reanudar y continuar

## `/resume` interactivo

Flujo:

1. Abre el selector de sesiones poblado mediante `SessionManager.list(currentCwd, currentSessionDir)`.
2. Al seleccionar, `SelectorController.handleResumeSession(sessionPath)` llama a `session.switchSession(sessionPath)`.
3. La interfaz limpia/reconstruye el chat y las tareas pendientes, luego reporta `Resumed session`.

Notas:

- Este selector solo lista sesiones en el ámbito del directorio de sesión actual.
- No utiliza búsqueda global entre proyectos.

## CLI `--resume`

### `--resume` (sin valor)

- `main.ts` lista las sesiones para el cwd/sessionDir actual y abre el selector.
- La ruta seleccionada se abre con `SessionManager.open(selectedPath)` antes de la creación de sesión.

### `--resume <value>`

Orden de resolución de `createSessionManager()`:

1. Si el valor parece una ruta (`/`, `\`, o `.jsonl`), se abre directamente.
2. De lo contrario se trata como prefijo de id:
   - busca en el ámbito actual (`SessionManager.list(cwd, sessionDir)`)
   - si no se encuentra y no hay `sessionDir` explícito, busca globalmente (`SessionManager.listAll()`)

Comportamiento de coincidencia de id entre proyectos:

- Si el cwd de la sesión coincidente difiere del cwd actual, el CLI pregunta:
  - `Session found in different project ... Fork into current directory? [y/N]`
- En caso afirmativo: `SessionManager.forkFrom(match.path, cwd, sessionDir)` crea un nuevo archivo local bifurcado.
- En caso negativo/por defecto sin TTY: el comando genera error.

## CLI `--continue`

`SessionManager.continueRecent(cwd, sessionDir)`:

1. Resuelve el directorio de sesión para el cwd actual.
2. Lee primero la migaja de pan con ámbito de terminal.
3. Recurre al archivo de sesión modificado más recientemente.
4. Abre la sesión encontrada; si no existe ninguna, crea una nueva sesión.

Este es un comportamiento solo de inicio; no existe un comando interactivo `/continue` con barra.

## Cómo el cambio de sesión muta realmente el estado en tiempo de ejecución

`AgentSession.switchSession(sessionPath)` realiza la transición en tiempo de ejecución usada por las operaciones tipo resume:

1. Emite `session_before_switch` con `reason: "resume"` y `targetSessionFile` (cancelable).
2. Desconecta la suscripción de eventos del agente y aborta el trabajo en curso.
3. Limpia los mensajes encolados de steering/seguimiento/siguiente turno.
4. Vacía las escrituras del administrador de sesión actual.
5. `sessionManager.setSessionFile(sessionPath)` y actualiza `agent.sessionId`.
6. Construye el contexto de sesión a partir de las entradas cargadas.
7. Emite `session_switch` con `reason: "resume"`.
8. Reemplaza los mensajes del agente desde el contexto.
9. Restaura el modelo (si está disponible en el registro actual).
10. Restaura o inicializa el nivel de pensamiento.
11. Reconecta la suscripción de eventos del agente.

`switchSession()` por sí mismo no crea ningún archivo de sesión nuevo.

## Emisiones de eventos y puntos de cancelación

### Hooks del ciclo de vida de cambio/bifurcación

Para `newSession`, `fork` y `switchSession`:

- Evento anterior: `session_before_switch`
  - razones: `new`, `fork`, `resume`
  - cancelable retornando `{ cancel: true }`
- Evento posterior: `session_switch`
  - mismo conjunto de razones
  - incluye `previousSessionFile`

`ExtensionRunner.emit()` retorna tempranamente en el primer resultado de evento anterior que cancele.

### Comportamiento `onSession` de herramientas personalizadas

Los puentes del SDK conectan los eventos de sesión de extensiones con los callbacks `onSession` de herramientas personalizadas:

- `session_switch` -> `onSession({ reason: "switch", previousSessionFile })`
- `session_branch` -> `reason: "branch"`
- `session_start` -> `reason: "start"`
- `session_tree` -> `reason: "tree"`
- `session_shutdown` -> `reason: "shutdown"`

Estos callbacks son observacionales; no cancelan el cambio/bifurcación.

### Otras superficies de cancelación relevantes para este documento

- `/fork` se bloquea mientras se está transmitiendo (el usuario debe esperar/abortar la respuesta actual primero).
- El selector de `/resume` puede cancelarse si el usuario cierra el selector.
- `--resume <id>` entre proyectos puede cancelarse declinando el prompt de bifurcación.
- `/share` tiene una ruta de aborto en la interfaz (`Share cancelled`) para el flujo de gist; no conecta semántica de terminación de proceso para `gh gist create` en esta ruta de código.

## Comportamiento de sesión no persistente (en memoria)

Cuando el administrador de sesiones se crea con `SessionManager.inMemory()` (`--no-session`):

- La ruta del archivo de sesión está ausente.
- `/export` y `/share` fallan con `Cannot export in-memory session to HTML` (propagado a la interfaz de error del comando).
- `/fork` falla porque `SessionManager.fork()` requiere persistencia.
- `/dump` sigue funcionando porque serializa el estado del agente en memoria.
- Las semánticas de resume/continue del CLI se omiten si `--no-session` está establecido, porque la creación del administrador retorna en memoria inmediatamente.

## Advertencias conocidas de implementación (según el código actual)

- `SelectorController.handleResumeSession()` no verifica el resultado booleano de `session.switchSession(...)`; un cambio cancelado por hook puede aún proceder a través de la ruta de repintado/estado de la interfaz "Resumed session".
- Los fallos de compartición personalizada de `/share` no degradan al respaldo por defecto de gist; terminan el comando con error.
- La tokenización de argumentos de `/export` es simplista y no preserva rutas entrecomilladas con espacios.
