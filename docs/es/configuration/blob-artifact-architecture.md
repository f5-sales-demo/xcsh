---
title: Arquitectura de almacenamiento de blobs y artefactos
description: >-
  Almacén de blobs con direccionamiento por contenido y registro de artefactos
  para medios de sesión, capturas de pantalla y salidas de herramientas.
sidebar:
  order: 7
  label: Almacenamiento de blobs y artefactos
i18n:
  sourceHash: 70d255f48d5b
  translator: machine
---

# Arquitectura de almacenamiento de blobs y artefactos

Este documento describe cómo coding-agent almacena cargas útiles grandes/binarias fuera del JSONL de sesión, cómo se persiste la salida truncada de herramientas, y cómo las URLs internas (`artifact://`, `agent://`) se resuelven de vuelta a los datos almacenados.

## Por qué existen dos sistemas de almacenamiento

El runtime utiliza dos mecanismos de persistencia diferentes para diferentes formas de datos:

- **Blobs con direccionamiento por contenido** (`blob:sha256:<hash>`): almacenamiento global, orientado a binarios, utilizado para externalizar cargas útiles grandes de imágenes en base64 de las entradas de sesión persistidas.
- **Artefactos con alcance de sesión** (archivos bajo `<sessionFile-without-.jsonl>/`): archivos de texto por sesión utilizados para salidas completas de herramientas y salidas de subagentes.

Son intencionalmente separados:

- el almacenamiento de blobs optimiza la deduplicación y las referencias estables por hash de contenido,
- el almacenamiento de artefactos optimiza las herramientas de sesión de solo anexado y la recuperación por humanos/herramientas mediante IDs locales.

## Límites de almacenamiento y disposición en disco

## Límite del almacén de blobs (global)

`SessionManager` construye `BlobStore(getBlobsDir())`, por lo que los archivos de blobs residen en un directorio global compartido de blobs (no en una carpeta de sesión).

Nomenclatura de archivos de blobs:

- ruta del archivo: `<blobsDir>/<sha256-hex>`
- sin extensión
- cadena de referencia almacenada en las entradas: `blob:sha256:<sha256-hex>`

Implicaciones:

- el mismo contenido binario a través de sesiones se resuelve al mismo hash/ruta,
- las escrituras son idempotentes a nivel de contenido,
- los blobs pueden sobrevivir a cualquier archivo de sesión individual.

## Límite de artefactos (local de sesión)

`ArtifactManager` deriva el directorio de artefactos a partir de la ruta del archivo de sesión:

- archivo de sesión: `.../<timestamp>_<sessionId>.jsonl`
- directorio de artefactos: `.../<timestamp>_<sessionId>/` (elimina `.jsonl`)

Los tipos de artefactos comparten este directorio:

- archivos de salida de herramientas truncados: `<numericId>.<toolType>.log` (para `artifact://`)
- archivos de salida de subagentes: `<outputId>.md` (para `agent://`)

## Esquemas de asignación de IDs y nombres

## IDs de blobs: hash de contenido

`BlobStore.put()` calcula SHA-256 sobre los bytes binarios en crudo y devuelve:

- `hash`: resumen hexadecimal,
- `path`: `<blobsDir>/<hash>`,
- `ref`: `blob:sha256:<hash>`.

No se utiliza ningún contador local de sesión.

## IDs de artefactos: entero monotónico local de sesión

`ArtifactManager` escanea los archivos de artefactos `*.log` existentes en el primer uso para encontrar el ID numérico máximo existente y establece `nextId = max + 1`.

Comportamiento de asignación:

- formato de archivo: `{id}.{toolType}.log`
- los IDs son cadenas secuenciales (`"0"`, `"1"`, ...)
- la reanudación no sobrescribe artefactos existentes porque el escaneo ocurre antes de la asignación.

Si el directorio de artefactos no existe, el escaneo produce una lista vacía y la asignación comienza desde `0`.

## IDs de salida de agente (`agent://`)

`AgentOutputManager` asigna IDs para las salidas de subagentes como `<index>-<requestedId>` (opcionalmente anidados bajo un prefijo padre, p. ej. `0-Parent.1-Child`). Escanea los archivos `.md` existentes durante la inicialización para continuar desde el siguiente índice al reanudar.

## Flujo de datos de persistencia

## 1) Ruta de reescritura de persistencia de entradas de sesión

Antes de que se escriban las entradas de sesión (`#rewriteFile` / persistencia incremental), `SessionManager` llama a `prepareEntryForPersistence()` (a través de `truncateForPersistence`).

Comportamientos clave:

1. **Truncamiento de cadenas grandes**: las cadenas sobredimensionadas se cortan y se les agrega el sufijo `"[Session persistence truncated large content]"`.
2. **Eliminación de campos transitorios**: `partialJson` y `jsonlEvents` se eliminan de las entradas persistidas.
3. **Externalización de imágenes a blobs**:
   - solo se aplica a bloques de imagen en arrays `content`,
   - solo cuando `data` no es ya una referencia de blob,
   - solo cuando la longitud del base64 alcanza al menos el umbral (`BLOB_EXTERNALIZE_THRESHOLD = 1024`),
   - reemplaza el base64 en línea con `blob:sha256:<hash>`.

Esto mantiene el JSONL de sesión compacto mientras preserva la recuperabilidad.

## 2) Ruta de rehidratación al cargar la sesión

Al abrir una sesión (`setSessionFile`), después de las migraciones, `SessionManager` ejecuta `resolveBlobRefsInEntries()`.

Para cada bloque de imagen de mensaje/mensaje-personalizado con `blob:sha256:<hash>`:

- lee los bytes del blob desde el almacén de blobs,
- convierte los bytes de vuelta a base64,
- muta la entrada en memoria para incluir base64 en línea para los consumidores del runtime.

Si el blob no existe:

- `resolveImageData()` registra una advertencia,
- devuelve la cadena de referencia original sin cambios,
- la carga continúa (sin fallo crítico).

## 3) Ruta de desbordamiento/truncamiento de salida de herramientas

`OutputSink` impulsa la salida en streaming en bash/python/ssh y ejecutores relacionados.

Comportamiento:

1. Cada fragmento se sanitiza y se añade al buffer de cola en memoria.
2. Cuando los bytes en memoria exceden el umbral de desbordamiento (`DEFAULT_MAX_BYTES`, 50KB), el sink marca la salida como truncada.
3. Si hay una ruta de artefacto disponible, el sink abre un escritor de archivos y escribe:
   - el contenido almacenado en buffer existente una vez,
   - todos los fragmentos subsiguientes.
4. El buffer en memoria siempre se recorta a la ventana de cola para visualización.
5. `dump()` devuelve un resumen incluyendo `artifactId` solo cuando el sink de archivo se creó exitosamente.

Efecto práctico:

- La UI/retorno de herramienta muestra la cola truncada,
- la salida completa se preserva en el archivo de artefacto y se referencia como `artifact://<id>`.

Si la creación del sink de archivo falla (error de E/S, ruta faltante, etc.), el sink recurre silenciosamente al truncamiento solo en memoria; la salida completa no se persiste.

## Modelo de acceso por URL

## Referencias `blob:`

`blob:sha256:<hash>` es una referencia de persistencia dentro de las cargas útiles de entradas de sesión, no un esquema de URL interno manejado por el enrutador. La resolución la realiza `SessionManager` durante la carga de la sesión.

## `artifact://<id>`

Manejado por `ArtifactProtocolHandler`:

- requiere un directorio de artefactos de sesión activo,
- el ID debe ser numérico,
- se resuelve buscando coincidencia del prefijo de nombre de archivo `<id>.`,
- devuelve texto en crudo (`text/plain`) del archivo `.log` coincidente,
- cuando no existe, el error incluye una lista de IDs de artefactos disponibles.

Comportamiento cuando falta el directorio:

- si el directorio de artefactos no existe, lanza `No artifacts directory found`.

## `agent://<id>`

Manejado por `AgentProtocolHandler` sobre `<artifactsDir>/<id>.md`:

- la forma simple devuelve texto markdown,
- las formas `/path` o `?q=` realizan extracción JSON,
- la extracción por ruta y por consulta no pueden combinarse,
- si se solicita extracción, el contenido del archivo debe parsearse como JSON.

Comportamiento cuando falta el directorio:

- lanza `No artifacts directory found`.

Comportamiento cuando falta la salida:

- lanza `Not found: <id>` con los IDs disponibles de los archivos `.md` existentes.

Integración con la herramienta read:

- `read` soporta paginación con offset/limit para lecturas de URLs internas sin extracción,
- rechaza `offset/limit` cuando se usa extracción con `agent://`.

## Semánticas de reanudación, bifurcación y movimiento

## Reanudación

- `ArtifactManager` escanea los archivos `{id}.*.log` existentes en la primera asignación y continúa la numeración.
- `AgentOutputManager` escanea los IDs de salida `.md` existentes y continúa la numeración.
- `SessionManager` rehidrata las referencias de blobs a base64 durante la carga.

## Bifurcación

`SessionManager.fork()` crea un nuevo archivo de sesión con un nuevo ID de sesión y un enlace `parentSession`, luego devuelve las rutas de archivo antigua/nueva. La copia de artefactos es manejada por `AgentSession.fork()`:

- intenta una copia recursiva del directorio de artefactos antiguo al nuevo directorio de artefactos,
- se tolera la ausencia del directorio antiguo,
- los errores de copia que no sean ENOENT se registran como advertencias y la bifurcación aún se completa.

Implicaciones de IDs después de la bifurcación:

- si la copia tuvo éxito, los contadores de artefactos en la nueva sesión continúan después del ID máximo copiado,
- si la copia falló/se omitió, los IDs de artefactos de la nueva sesión comienzan desde `0`.

Implicaciones de blobs después de la bifurcación:

- los blobs son globales y con direccionamiento por contenido, por lo que no se requiere copia del directorio de blobs.

## Mover a un nuevo cwd

`SessionManager.moveTo()` renombra tanto el archivo de sesión como el directorio de artefactos al nuevo directorio de sesión predeterminado, con lógica de reversión si un paso posterior falla. Esto preserva la identidad de los artefactos mientras se reubica el alcance de la sesión.

## Manejo de fallos y rutas de respaldo

| Caso | Comportamiento |
| --- | --- |
| Archivo de blob faltante durante la rehidratación | Advierte y mantiene la cadena de referencia `blob:sha256:` en memoria |
| ENOENT en lectura de blob vía `BlobStore.get` | Devuelve `null` |
| Directorio de artefactos faltante (`ArtifactManager.listFiles`) | Devuelve lista vacía (la asignación puede comenzar desde cero) |
| Directorio de artefactos faltante (`artifact://` / `agent://`) | Lanza explícitamente `No artifacts directory found` |
| ID de artefacto no encontrado | Lanza con listado de IDs disponibles |
| Fallo en la inicialización del escritor de artefactos de OutputSink | Continúa con truncamiento solo de cola (sin artefacto de salida completa) |
| Sin archivo de sesión (algunas rutas de tareas) | La herramienta de tareas recurre a un directorio temporal de artefactos para salidas de subagentes |

## Externalización de blobs binarios vs artefactos de salida de texto

- La **externalización de blobs** es para cargas útiles de imágenes binarias dentro del contenido de entradas de sesión persistidas; reemplaza el base64 en línea en JSONL con referencias estables de contenido.
- Los **artefactos** son archivos de texto plano para salida de ejecución y salida de subagentes; son direccionables por IDs locales de sesión a través de URLs internas.

Los dos sistemas se intersectan solo indirectamente (ambos reducen el exceso de tamaño del JSONL de sesión) pero tienen diferentes identidades, tiempos de vida y rutas de recuperación.

## Archivos de implementación

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — formato de referencia de blobs, hashing, put/get, helpers de externalización/resolución.
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — modelo de directorio de artefactos de sesión y asignación numérica de IDs de artefactos.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — comportamiento de truncamiento/desbordamiento a archivo de `OutputSink` y metadatos de resumen.
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — transformaciones de persistencia, rehidratación de blobs en la carga, interacciones de bifurcación/movimiento de sesión.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — copia del directorio de artefactos durante la bifurcación interactiva.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — arranque del gestor de artefactos de herramientas y asignación de rutas de artefactos por herramienta.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — resolutor de `artifact://`.
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — resolutor de `agent://` + extracción JSON.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — cableado del enrutador de URLs internas y resolutor del directorio de artefactos.
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — asignación de IDs de salida de agente con alcance de sesión para `agent://`.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — escrituras de artefactos de salida de subagentes (`<id>.md`) y respaldo al directorio temporal de artefactos.
