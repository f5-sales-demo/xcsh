---
title: Notebook Tool Runtime Internals
description: >-
  Jupyter notebook tool runtime with cell execution, kernel lifecycle, and
  output rendering.
sidebar:
  order: 2
  label: Notebook tool
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# Componentes internos del runtime de la herramienta notebook

Este documento describe la implementación actual de la herramienta `notebook` y su relación con el runtime de Python respaldado por kernel.

La distinción crítica: **`notebook` es un editor JSON de notebooks, no un ejecutor de notebooks**. Edita las fuentes de celdas `.ipynb` directamente; no inicia ni se comunica con un kernel de Python.

## Archivos de implementación

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) Límite del runtime: edición vs ejecución

## Herramienta `notebook` (`src/tools/notebook.ts`)

- Soporta `action: edit | insert | delete` en un archivo `.ipynb`.
- Resuelve la ruta relativa al CWD de la sesión (`resolveToCwd`).
- Carga el JSON del notebook, valida el array `cells`, valida los límites de `cell_index`.
- Aplica las ediciones de fuente en memoria y escribe el JSON completo del notebook de vuelta con `JSON.stringify(notebook, null, 1)`.
- Retorna un resumen textual + `details` estructurados (`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`).

No existe ciclo de vida del kernel en esta herramienta:

- sin adquisición de gateway
- sin ID de sesión de kernel
- sin `execute_request`
- sin fragmentos de stream desde los canales del kernel
- sin captura de display enriquecido (`image/png`, display JSON, MIME de estado)

## Ruta de ejecución tipo notebook (`src/tools/python.ts` + `src/ipy/*`)

Cuando el agente necesita ejecutar código Python estilo celda (celdas secuenciales, estado persistente, displays enriquecidos), eso pasa por la herramienta **`python`**, no por `notebook`.

Esa ruta es donde residen los modos de kernel, el comportamiento de reinicio/cancelación, el streaming de fragmentos y el truncamiento de artefactos de salida.

## 2) Semántica del manejo de celdas del notebook (herramienta `notebook`)

## Normalización de fuente

`content` se divide en `source: string[]` con preservación de saltos de línea:

- cada línea no final conserva el `\n` final
- la línea final no tiene salto de línea forzado al final

Esto refleja las convenciones JSON de notebooks y evita la concatenación accidental de líneas en ediciones posteriores.

## Comportamiento de acciones

- `edit`
  - reemplaza `cells[cell_index].source`
  - preserva el `cell_type` existente
- `insert`
  - inserta en `[0..cellCount]`
  - `cell_type` por defecto es `code`
  - las celdas de código inicializan `execution_count: null` y `outputs: []`
  - las celdas de markdown inicializan solo `metadata` + `source`
- `delete`
  - elimina `cells[cell_index]`
  - retorna el `source` eliminado en los detalles para la vista previa del renderer

## Superficies de error

Se lanzan errores duros para:

- archivo de notebook faltante
- JSON inválido
- `cells` faltante o que no es un array
- índice fuera de rango (insertar y no insertar tienen diferentes rangos válidos)
- `content` faltante para `edit`/`insert`

Estos se convierten en respuestas de herramienta `Error:` aguas arriba; el renderer usa la ruta del notebook + texto de error formateado.

## 3) Semántica de sesión del kernel (donde realmente existen)

La semántica del kernel está implementada en `executePython` / `PythonKernel` y se aplica a la herramienta `python`.

## Modos

`PythonKernelMode`:

- `session` (por defecto)
  - kernels cacheados en el mapa `kernelSessions`
  - máximo 4 sesiones; la más antigua es desalojada al desbordarse
  - limpieza de inactivos/muertos cada 30s, timeout después de 5 minutos
  - cola por sesión serializa la ejecución (`session.queue`)
- `per-call`
  - crea kernel para la solicitud
  - ejecuta
  - siempre apaga el kernel en `finally`

## Comportamiento de reinicio

La herramienta `python` pasa `reset` solo para la primera celda en una llamada multi-celda; las celdas posteriores siempre se ejecutan con `reset: false`.

## Muerte / reinicio / reintento del kernel

En modo sesión (`withKernelSession`):

- kernel muerto detectado por heartbeat (verificación `kernel.isAlive()` cada 5s) o fallo de ejecución.
- estado muerto pre-ejecución desencadena `restartKernelSession`.
- ruta de crash en tiempo de ejecución reintenta una vez: reinicia kernel, re-ejecuta handler.
- `restartCount > 1` en la misma sesión lanza `Python kernel restarted too many times in this session`.

Comportamiento de reintento en el inicio:

- la creación de kernel del gateway compartido reintenta una vez en `SharedGatewayCreateError` con HTTP 5xx.

Recuperación de agotamiento de recursos:

- detecta fallos estilo `EMFILE`/`ENFILE`/"Too many open files"
- limpia las sesiones rastreadas
- llama a `shutdownSharedGateway()`
- reintenta la creación de sesión del kernel una vez

## 4) Inyección de variables de entorno/sesión

El inicio del kernel recibe un mapa de env opcional del ejecutor:

- `PI_SESSION_FILE` (ruta del archivo de estado de sesión)
- `ARTIFACTS` (directorio de artefactos)

`PythonKernel.#initializeKernelEnvironment(...)` luego ejecuta un script de inicialización dentro del kernel para:

- `os.chdir(cwd)`
- inyectar entradas de env en `os.environ`
- anteponer cwd a `sys.path` si falta

Implicación:

- los helpers de preludio que leen el contexto de sesión o artefactos dependen de estas variables de entorno en el estado del proceso Python.

## 5) Manejo de streaming/fragmentos y display (ruta respaldada por kernel)

El cliente del kernel procesa mensajes del protocolo Jupyter por ejecución:

- `stream` -> fragmento de texto a `onChunk`
- `execute_result` / `display_data` ->
  - texto de display elegido por precedencia MIME: `text/markdown` > `text/plain` > `text/html` convertido
  - salidas estructuradas capturadas por separado:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (sin emisión de texto)
- `error` -> texto de traceback enviado al stream de fragmentos + metadatos de error estructurados
- `input_request` -> emite texto de advertencia de stdin, envía `input_reply` vacío, marca stdin como solicitado
- la completación espera tanto `execute_reply` como `status=idle` del kernel

Cancelación/timeout:

- la señal de abort desencadena `interrupt()` (REST `/interrupt` + `interrupt_request` en canal de control)
- el resultado marca `cancelled=true`
- la ruta de timeout anota la salida con `Command timed out after <n> seconds`

## 6) Comportamiento de truncamiento y artefactos

`OutputSink` en `src/session/streaming-output.ts` es usado por las rutas de ejecución del kernel (`executeWithKernel`):

- sanitiza cada fragmento (`sanitizeText`)
- rastrea líneas totales/de salida y bytes
- archivo opcional de desborde de artefactos (`artifactPath`, `artifactId`)
- cuando el buffer en memoria excede el umbral (`DEFAULT_MAX_BYTES` a menos que se sobrescriba):
  - marca como truncado
  - mantiene bytes finales en memoria (límite seguro para UTF-8)
  - puede desbordar el stream completo al sink de artefactos

`dump()` retorna:

- texto de salida visible (posiblemente truncado por la cola)
- flag de truncamiento + conteos
- ID de artefacto (para referencias `artifact://<id>`)

La herramienta `python` convierte estos metadatos en avisos de truncamiento del resultado y advertencias del TUI.

La herramienta `notebook` **no** usa `OutputSink`; no tiene pipeline de truncamiento de stream/artefactos porque no ejecuta código.

## 7) Suposiciones del renderer y formato

## Renderer de notebook (`notebookToolRenderer`)

- vista de llamada: línea de estado con acción + ruta del notebook + metadatos de celda/tipo
- vista de resultado:
  - resumen de éxito derivado de `details`
  - `cellSource` renderizado vía `renderCodeCell`
  - celdas markdown establecen hint de lenguaje `markdown`; otras celdas no tienen override explícito de lenguaje
  - límite de vista previa colapsada es `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - soporta modo expandido vía opciones de renderizado compartidas
  - usa caché de renderizado indexada por ancho + estado expandido

Suposición de renderizado de errores:

- si el primer contenido de texto comienza con `Error:`, el renderer formatea como bloque de error de notebook.

## Renderer de Python (para salida de ejecución real)

El renderizado de ejecución respaldado por kernel espera:

- transiciones de estado por celda (`pending/running/complete/error`)
- sección opcional de evento de estado estructurado
- árboles de salida JSON opcionales
- advertencias de truncamiento + puntero opcional `artifact://<id>`

Este comportamiento del renderer no está relacionado con los resultados de edición JSON de `notebook` excepto que ambos reutilizan primitivas compartidas del TUI.

## 8) Divergencia del comportamiento de la herramienta Python simple

Si "herramienta Python simple" significa la ruta de ejecución `python`:

- `python` ejecuta código en un kernel, persiste estado por modo, transmite fragmentos en streaming, captura displays enriquecidos, maneja interrupciones/timeouts, y soporta truncamiento de salida/artefactos.
- `notebook` realiza únicamente mutaciones deterministas del JSON del notebook; sin ejecución, sin estado de kernel, sin stream de fragmentos, sin salidas de display, sin pipeline de artefactos.

Si un flujo de trabajo necesita ambos:

1. editar la fuente del notebook con `notebook`
2. ejecutar celdas de código vía `python` (pasando código manualmente), no a través de `notebook`

La implementación actual no proporciona una herramienta única que tanto mute `.ipynb` como ejecute celdas del notebook a través del contexto del kernel.
