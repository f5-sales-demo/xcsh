---
title: Componentes internos del tiempo de ejecución de la herramienta Notebook
description: >-
  Tiempo de ejecución de la herramienta de cuadernos Jupyter con ejecución de
  celdas, ciclo de vida del kernel y renderizado de resultados.
sidebar:
  order: 2
  label: Herramienta Notebook
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# Componentes internos del tiempo de ejecución de la herramienta Notebook

Este documento describe la implementación actual de la herramienta `notebook` y su relación con el tiempo de ejecución de Python respaldado por kernel.

La distinción fundamental: **`notebook` es un editor de cuadernos JSON, no un ejecutor de cuadernos**. Edita directamente las fuentes de celdas de archivos `.ipynb`; no inicia ni se comunica con un kernel de Python.

## Archivos de implementación

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) Límite de tiempo de ejecución: edición frente a ejecución

## Herramienta `notebook` (`src/tools/notebook.ts`)

- Admite `action: edit | insert | delete` sobre un archivo `.ipynb`.
- Resuelve la ruta relativa al CWD de la sesión (`resolveToCwd`).
- Carga el JSON del cuaderno, valida el array `cells` y los límites de `cell_index`.
- Aplica las ediciones de fuente en memoria y escribe el JSON completo del cuaderno con `JSON.stringify(notebook, null, 1)`.
- Devuelve un resumen textual más `details` estructurados (`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`).

No existe ciclo de vida del kernel en esta herramienta:

- sin adquisición de gateway
- sin ID de sesión de kernel
- sin `execute_request`
- sin fragmentos de stream desde los canales del kernel
- sin captura de visualización enriquecida (`image/png`, visualización JSON, MIME de estado)

## Ruta de ejecución similar a un cuaderno (`src/tools/python.ts` + `src/ipy/*`)

Cuando el agente necesita ejecutar código Python al estilo de celdas (celdas secuenciales, estado persistente, visualizaciones enriquecidas), eso se gestiona a través de la herramienta **`python`**, no de `notebook`.

En esa ruta es donde residen los modos de kernel, el comportamiento de reinicio/cancelación, el streaming de fragmentos y el truncamiento de artefactos de salida.

## 2) Semántica de manejo de celdas del cuaderno (herramienta `notebook`)

## Normalización de fuente

`content` se divide en `source: string[]` con preservación de saltos de línea:

- cada línea que no sea la final conserva el `\n` final
- la línea final no tiene salto de línea forzado al final

Esto refleja las convenciones del JSON de cuadernos y evita la concatenación accidental de líneas en ediciones posteriores.

## Comportamiento de las acciones

- `edit`
  - reemplaza `cells[cell_index].source`
  - preserva el `cell_type` existente
- `insert`
  - inserta en `[0..cellCount]`
  - `cell_type` tiene como valor predeterminado `code`
  - las celdas de código inicializan `execution_count: null` y `outputs: []`
  - las celdas markdown solo inicializan `metadata` + `source`
- `delete`
  - elimina `cells[cell_index]`
  - devuelve el `source` eliminado en los detalles para la vista previa del renderizador

## Superficies de error

Se lanzan errores críticos en los siguientes casos:

- archivo de cuaderno no encontrado
- JSON inválido
- `cells` ausente o que no es un array
- índice fuera de rango (inserción y no inserción tienen rangos válidos diferentes)
- `content` ausente para `edit`/`insert`

Estos se convierten en respuestas de herramienta con `Error:` en los niveles superiores; el renderizador utiliza la ruta del cuaderno más el texto de error formateado.

## 3) Semántica de sesión del kernel (donde realmente existen)

La semántica del kernel se implementa en `executePython` / `PythonKernel` y se aplica a la herramienta `python`.

## Modos

`PythonKernelMode`:

- `session` (predeterminado)
  - kernels almacenados en caché en el mapa `kernelSessions`
  - máximo 4 sesiones; la más antigua se elimina al desbordarse
  - limpieza de sesiones inactivas/muertas cada 30s, tiempo de espera tras 5 minutos
  - la cola por sesión serializa la ejecución (`session.queue`)
- `per-call`
  - crea un kernel para la solicitud
  - ejecuta
  - siempre cierra el kernel en `finally`

## Comportamiento de reinicio

La herramienta `python` pasa `reset` solo para la primera celda en una llamada de múltiples celdas; las celdas posteriores siempre se ejecutan con `reset: false`.

## Muerte del kernel / reinicio / reintento

En modo sesión (`withKernelSession`):

- el kernel muerto se detecta mediante latido (`kernel.isAlive()` comprobado cada 5s) o por fallo de ejecución.
- el estado muerto previo a la ejecución desencadena `restartKernelSession`.
- la ruta de fallo en tiempo de ejecución reintenta una vez: reinicia el kernel y vuelve a ejecutar el manejador.
- `restartCount > 1` en la misma sesión lanza `Python kernel restarted too many times in this session`.

Comportamiento de reintento en el inicio:

- la creación del kernel de gateway compartido reintenta una vez ante `SharedGatewayCreateError` con HTTP 5xx.

Recuperación por agotamiento de recursos:

- detecta fallos del tipo `EMFILE`/`ENFILE`/"Too many open files"
- limpia las sesiones rastreadas
- llama a `shutdownSharedGateway()`
- reintenta la creación de la sesión del kernel una vez

## 4) Inyección de variables de entorno/sesión

El inicio del kernel recibe un mapa de entorno opcional del ejecutor:

- `PI_SESSION_FILE` (ruta del archivo de estado de sesión)
- `ARTIFACTS` (directorio de artefactos)

`PythonKernel.#initializeKernelEnvironment(...)` luego ejecuta el script de inicialización dentro del kernel para:

- `os.chdir(cwd)`
- inyectar entradas de entorno en `os.environ`
- anteponer cwd a `sys.path` si no está presente

Implicación:

- los helpers de preludio que leen el contexto de sesión o artefactos dependen de estas variables de entorno en el estado del proceso Python.

## 5) Manejo de streaming/fragmentos y visualizaciones (ruta respaldada por kernel)

El cliente del kernel procesa mensajes del protocolo Jupyter por ejecución:

- `stream` -> fragmento de texto hacia `onChunk`
- `execute_result` / `display_data` ->
  - texto de visualización elegido por precedencia MIME: `text/markdown` > `text/plain` > `text/html` convertido
  - salidas estructuradas capturadas por separado:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (sin emisión de texto)
- `error` -> texto de traceback enviado al stream de fragmentos + metadatos de error estructurados
- `input_request` -> emite texto de advertencia de stdin, envía `input_reply` vacío, marca stdin como solicitado
- la finalización espera tanto `execute_reply` como el estado `status=idle` del kernel

Cancelación/tiempo de espera:

- la señal de cancelación activa `interrupt()` (REST `/interrupt` + `interrupt_request` por canal de control)
- el resultado marca `cancelled=true`
- la ruta de tiempo de espera anota la salida con `Command timed out after <n> seconds`

## 6) Comportamiento de truncamiento y artefactos

`OutputSink` en `src/session/streaming-output.ts` es utilizado por las rutas de ejecución del kernel (`executeWithKernel`):

- sanea cada fragmento (`sanitizeText`)
- rastrea el total de líneas, líneas de salida y bytes
- archivo de desbordamiento de artefacto opcional (`artifactPath`, `artifactId`)
- cuando el búfer en memoria supera el umbral (`DEFAULT_MAX_BYTES` salvo que se sobrescriba):
  - marca como truncado
  - conserva los bytes finales en memoria (límite seguro UTF-8)
  - puede desbordar el stream completo hacia el sumidero de artefactos

`dump()` devuelve:

- texto de salida visible (posiblemente truncado por el final)
- indicador de truncamiento + conteos
- ID de artefacto (para referencias `artifact://<id>`)

La herramienta `python` convierte estos metadatos en avisos de truncamiento de resultados y advertencias en la TUI.

La herramienta `notebook` **no** utiliza `OutputSink`; no tiene pipeline de stream/truncamiento de artefactos porque no ejecuta código.

## 7) Suposiciones del renderizador y formato

## Renderizador de cuadernos (`notebookToolRenderer`)

- vista de llamada: línea de estado con acción + ruta del cuaderno + metadatos de celda/tipo
- vista de resultado:
  - resumen de éxito derivado de `details`
  - `cellSource` renderizado mediante `renderCodeCell`
  - las celdas markdown establecen la pista de lenguaje `markdown`; otras celdas no tienen anulación de lenguaje explícita
  - el límite de vista previa de código colapsada es `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - admite modo expandido mediante opciones de renderizado compartidas
  - utiliza caché de renderizado con clave por ancho + estado expandido

Suposición de renderizado de errores:

- si el primer contenido de texto comienza con `Error:`, el renderizador lo formatea como bloque de error de cuaderno.

## Renderizador de Python (para la salida de ejecución real)

El renderizado de ejecución respaldada por kernel espera:

- transiciones de estado por celda (`pending/running/complete/error`)
- sección opcional de eventos de estado estructurado
- árboles opcionales de salida JSON
- advertencias de truncamiento + puntero opcional a `artifact://<id>`

El comportamiento de este renderizador no está relacionado con los resultados de edición JSON de `notebook`, salvo que ambos reutilizan primitivas TUI compartidas.

## 8) Divergencia respecto al comportamiento de la herramienta Python simple

Si por "herramienta Python simple" se entiende la ruta de ejecución de `python`:

- `python` ejecuta código en un kernel, persiste el estado según el modo, transmite fragmentos, captura visualizaciones enriquecidas, gestiona interrupciones/tiempos de espera y admite truncamiento de salida/artefactos.
- `notebook` realiza únicamente mutaciones deterministas del JSON del cuaderno; sin ejecución, sin estado del kernel, sin stream de fragmentos, sin salidas de visualización, sin pipeline de artefactos.

Si un flujo de trabajo necesita ambas capacidades:

1. editar la fuente del cuaderno con `notebook`
2. ejecutar celdas de código mediante `python` (pasando el código manualmente), no a través de `notebook`

La implementación actual no proporciona una sola herramienta que a la vez mute el archivo `.ipynb` y ejecute celdas del cuaderno a través del contexto del kernel.
