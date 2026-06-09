---
title: Almacenamiento de sesiones y modelo de entradas
description: >-
  Modelo de almacenamiento de sesiones de solo adición con tipos de entrada,
  persistencia y migración entre formatos.
sidebar:
  order: 1
  label: Almacenamiento y modelo de entradas
i18n:
  sourceHash: 42fe17549e00
  translator: machine
---

# Almacenamiento de sesiones y modelo de entradas

Este documento es la fuente de verdad sobre cómo las sesiones del agente de codificación se representan, persisten, migran y reconstruyen en tiempo de ejecución.

## Alcance

Cubre:

- Formato JSONL de sesiones y versionado
- Taxonomía de entradas y semántica de árbol (`id`/`parentId` + puntero de hoja)
- Comportamiento de migración/compatibilidad al cargar archivos antiguos o malformados
- Reconstrucción de contexto (`buildSessionContext`)
- Garantías de persistencia, comportamiento ante fallos, truncamiento/externalización de blobs
- Abstracciones de almacenamiento (`FileSessionStorage`, `MemorySessionStorage`) y utilidades relacionadas

No cubre el comportamiento de renderizado de la interfaz `/tree` más allá de la semántica que afecta los datos de sesión.

## Archivos de implementación

- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`src/session/messages.ts`](../../packages/coding-agent/src/session/messages.ts)
- [`src/session/session-storage.ts`](../../packages/coding-agent/src/session/session-storage.ts)
- [`src/session/history-storage.ts`](../../packages/coding-agent/src/session/history-storage.ts)
- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts)

## Disposición en disco

Ubicación predeterminada del archivo de sesión:

```text
~/.xcsh/agent/sessions/--<cwd-encoded>--/<timestamp>_<sessionId>.jsonl
```

`<cwd-encoded>` se deriva del directorio de trabajo eliminando la barra inicial y reemplazando `/`, `\\` y `:` por `-`.

Ubicación del almacén de blobs:

```text
~/.xcsh/agent/blobs/<sha256>
```

Los archivos de referencia del terminal se escriben en:

```text
~/.xcsh/agent/terminal-sessions/<terminal-id>
```

El contenido de la referencia son dos líneas: el cwd original, seguido de la ruta del archivo de sesión. `continueRecent()` prefiere este puntero con alcance de terminal antes de buscar el mtime más reciente.

## Formato de archivo

Los archivos de sesión son JSONL: un objeto JSON por línea.

- La línea 1 es siempre el encabezado de sesión (`type: "session"`).
- Las líneas restantes son valores `SessionEntry`.
- Las entradas son de solo adición en tiempo de ejecución; la navegación de ramas mueve un puntero (`leafId`) en lugar de mutar entradas existentes.

### Encabezado (`SessionHeader`)

```json
{
  "type": "session",
  "version": 3,
  "id": "1f9d2a6b9c0d1234",
  "timestamp": "2026-02-16T10:20:30.000Z",
  "cwd": "/work/pi",
  "title": "optional session title",
  "parentSession": "optional lineage marker"
}
```

Notas:

- `version` es opcional en archivos v1; su ausencia significa v1.
- `parentSession` es una cadena de linaje opaca. El código actual escribe ya sea un id de sesión o una ruta de sesión dependiendo del flujo (`fork`, `forkFrom`, `createBranchedSession`, o `newSession({ parentSession })` explícito). Trátese como metadatos, no como una clave foránea tipada.

### Base de entrada (`SessionEntryBase`)

Todas las entradas que no son encabezado incluyen:

```json
{
  "type": "...",
  "id": "8-char-id",
  "parentId": "previous-or-branch-parent",
  "timestamp": "2026-02-16T10:20:30.000Z"
}
```

`parentId` puede ser `null` para una entrada raíz (primera adición, o después de `resetLeaf()`).

## Taxonomía de entradas

`SessionEntry` es la unión de:

- `message`
- `thinking_level_change`
- `model_change`
- `compaction`
- `branch_summary`
- `custom`
- `custom_message`
- `label`
- `ttsr_injection`
- `session_init`
- `mode_change`

### `message`

Almacena un `AgentMessage` directamente.

```json
{
  "type": "message",
  "id": "a1b2c3d4",
  "parentId": null,
  "timestamp": "2026-02-16T10:21:00.000Z",
  "message": {
    "role": "assistant",
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "content": [{ "type": "text", "text": "Done." }],
    "usage": { "input": 100, "output": 20, "cacheRead": 0, "cacheWrite": 0, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } },
    "timestamp": 1760000000000
  }
}
```

### `model_change`

```json
{
  "type": "model_change",
  "id": "b1c2d3e4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:21:30.000Z",
  "model": "openai/gpt-4o",
  "role": "default"
}
```

`role` es opcional; su ausencia se trata como `default` en la reconstrucción de contexto.

### `thinking_level_change`

```json
{
  "type": "thinking_level_change",
  "id": "c1d2e3f4",
  "parentId": "b1c2d3e4",
  "timestamp": "2026-02-16T10:22:00.000Z",
  "thinkingLevel": "high"
}
```

### `compaction`

```json
{
  "type": "compaction",
  "id": "d1e2f3a4",
  "parentId": "c1d2e3f4",
  "timestamp": "2026-02-16T10:23:00.000Z",
  "summary": "Conversation summary",
  "shortSummary": "Short recap",
  "firstKeptEntryId": "a1b2c3d4",
  "tokensBefore": 42000,
  "details": { "readFiles": ["src/a.ts"] },
  "preserveData": { "hookState": true },
  "fromExtension": false
}
```

### `branch_summary`

```json
{
  "type": "branch_summary",
  "id": "e1f2a3b4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:24:00.000Z",
  "fromId": "a1b2c3d4",
  "summary": "Summary of abandoned path",
  "details": { "note": "optional" },
  "fromExtension": true
}
```

Si se ramifica desde la raíz (`branchFromId === null`), `fromId` es la cadena literal `"root"`.

### `custom`

Persistencia de estado de extensiones; ignorado por `buildSessionContext`.

```json
{
  "type": "custom",
  "id": "f1a2b3c4",
  "parentId": "e1f2a3b4",
  "timestamp": "2026-02-16T10:25:00.000Z",
  "customType": "my-extension",
  "data": { "state": 1 }
}
```

### `custom_message`

Mensaje proporcionado por extensión que sí participa en el contexto del LLM.

```json
{
  "type": "custom_message",
  "id": "a2b3c4d5",
  "parentId": "f1a2b3c4",
  "timestamp": "2026-02-16T10:26:00.000Z",
  "customType": "my-extension",
  "content": "Injected context",
  "display": true,
  "details": { "debug": false }
}
```

### `label`

```json
{
  "type": "label",
  "id": "b2c3d4e5",
  "parentId": "a2b3c4d5",
  "timestamp": "2026-02-16T10:27:00.000Z",
  "targetId": "a1b2c3d4",
  "label": "checkpoint"
}
```

`label: undefined` elimina una etiqueta para `targetId`.

### `ttsr_injection`

```json
{
  "type": "ttsr_injection",
  "id": "c2d3e4f5",
  "parentId": "b2c3d4e5",
  "timestamp": "2026-02-16T10:28:00.000Z",
  "injectedRules": ["ruleA", "ruleB"]
}
```

### `session_init`

```json
{
  "type": "session_init",
  "id": "d2e3f4a5",
  "parentId": "c2d3e4f5",
  "timestamp": "2026-02-16T10:29:00.000Z",
  "systemPrompt": "...",
  "task": "...",
  "tools": ["read", "edit"],
  "outputSchema": { "type": "object" }
}
```

### `mode_change`

```json
{
  "type": "mode_change",
  "id": "e2f3a4b5",
  "parentId": "d2e3f4a5",
  "timestamp": "2026-02-16T10:30:00.000Z",
  "mode": "plan",
  "data": { "planFile": "/tmp/plan.md" }
}
```

## Versionado y migración

Versión actual de sesión: `3`.

### v1 -> v2

Se aplica cuando el `version` del encabezado está ausente o es `< 2`:

- Agrega `id` y `parentId` a cada entrada que no sea encabezado.
- Reconstruye una cadena de padres lineal usando el orden del archivo.
- Migra el campo de compactación `firstKeptEntryIndex` -> `firstKeptEntryId` cuando está presente.
- Establece `version = 2` en el encabezado.

### v2 -> v3

Se aplica cuando `version` del encabezado es `< 3`:

- Para entradas `message`: reescribe el legado `message.role === "hookMessage"` a `"custom"`.
- Establece `version = 3` en el encabezado.

### Disparador de migración y persistencia

- Las migraciones se ejecutan durante la carga de sesión (`setSessionFile`).
- Si alguna migración se ejecutó, el archivo completo se reescribe en disco inmediatamente.
- La migración muta las entradas en memoria primero, luego persiste el JSONL reescrito.

## Comportamiento de carga y compatibilidad

Comportamiento de `loadEntriesFromFile(path)`:

- Archivo faltante (`ENOENT`) -> devuelve `[]`.
- Las líneas no analizables son manejadas por el parser JSONL tolerante (`parseJsonlLenient`).
- Si la primera entrada analizada no es un encabezado de sesión válido (`type !== "session"` o falta `id` como cadena) -> devuelve `[]`.

Comportamiento de `SessionManager.setSessionFile()`:

- `[]` del cargador se trata como sesión vacía/inexistente y se reemplaza con un nuevo archivo de sesión inicializado en esa ruta.
- Los archivos válidos se cargan, migran si es necesario, se resuelven las referencias de blobs y luego se indexan.

## Semántica de árbol y hoja

El modelo subyacente es un árbol de solo adición + puntero de hoja mutable:

- Cada método de adición crea exactamente una nueva entrada cuyo `parentId` es el `leafId` actual.
- La nueva entrada se convierte en el nuevo `leafId`.
- `branch(entryId)` solo mueve `leafId`; las entradas existentes permanecen sin cambios.
- `resetLeaf()` establece `leafId = null`; la siguiente adición crea una nueva entrada raíz (`parentId: null`).
- `branchWithSummary()` establece la hoja en el objetivo de la rama y agrega una entrada `branch_summary`.

`getEntries()` devuelve todas las entradas que no son encabezado en orden de inserción. Las entradas existentes no se eliminan en operación normal; las reescrituras preservan el historial lógico mientras actualizan la representación (migraciones, movimientos, helpers de reescritura dirigida).

## Reconstrucción de contexto (`buildSessionContext`)

`buildSessionContext(entries, leafId, byId?)` resuelve lo que se envía al modelo.

Algoritmo:

1. Determinar la hoja:
   - `leafId === null` -> devolver contexto vacío.
   - `leafId` explícito -> usar esa entrada si se encuentra.
   - de lo contrario, recurrir a la última entrada.
2. Recorrer la cadena `parentId` desde la hoja hasta la raíz e invertir para obtener la ruta raíz->hoja.
3. Derivar el estado en tiempo de ejecución a lo largo de la ruta:
   - `thinkingLevel` del último `thinking_level_change` (predeterminado `"off"`)
   - mapa de modelos desde entradas `model_change` (`role ?? "default"`)
   - `models.default` de respaldo desde el proveedor/modelo del mensaje del asistente si no hay cambio de modelo explícito
   - `injectedTtsrRules` deduplicadas de todas las entradas `ttsr_injection`
   - mode/modeData del último `mode_change` (modo predeterminado `"none"`)
4. Construir la lista de mensajes:
   - Las entradas `message` pasan directamente
   - Las entradas `custom_message` se convierten en `AgentMessages` `custom` mediante `createCustomMessage`
   - Las entradas `branch_summary` se convierten en `AgentMessages` `branchSummary` mediante `createBranchSummaryMessage`
   - si existe una `compaction` en la ruta:
     - emitir primero el resumen de compactación (`createCompactionSummaryMessage`)
     - emitir las entradas de la ruta comenzando en `firstKeptEntryId` hasta el límite de compactación
     - emitir las entradas después del límite de compactación

Las entradas `custom` y `session_init` no inyectan contexto de modelo directamente.

## Garantías de persistencia y modelo de fallos

### Persistente vs en memoria

- `SessionManager.create/open/continueRecent/forkFrom` -> modo persistente (`persist = true`).
- `SessionManager.inMemory` -> modo no persistente (`persist = false`) con `MemorySessionStorage`.

### Pipeline de escritura

Las escrituras se serializan a través de una cadena de promesas interna (`#persistChain`) y `NdjsonFileWriter`.

- `append*` actualiza el estado en memoria inmediatamente.
- La persistencia se difiere hasta que exista al menos un mensaje del asistente.
  - Antes del primer asistente: las entradas se retienen en memoria; no ocurre ninguna escritura al archivo.
  - Cuando existe el primer asistente: la sesión completa en memoria se vuelca al archivo.
  - Después: las nuevas entradas se agregan incrementalmente.

Justificación en el código: evitar persistir sesiones que nunca produjeron una respuesta del asistente.

### Operaciones de durabilidad

- `flush()` vacía el escritor y llama a `fsync()`.
- Las reescrituras atómicas completas (`#rewriteFile`) escriben en un archivo temporal, vacían+fsync, cierran, y luego renombran sobre el destino.
- Se usa para migraciones, `setSessionName`, `rewriteEntries`, operaciones de movimiento y reescrituras de argumentos de llamadas a herramientas.

### Comportamiento ante errores

- Los errores de persistencia se registran (`#persistError`) y se vuelven a lanzar en operaciones subsecuentes.
- El primer error se registra una vez con el contexto del archivo de sesión.
- El cierre del escritor es de mejor esfuerzo pero propaga el primer error significativo.

## Controles de tamaño de datos y externalización de blobs

Antes de persistir entradas:

- Las cadenas grandes se truncan a `MAX_PERSIST_CHARS` (500,000 caracteres) con aviso:
  - `"[Session persistence truncated large content]"`
- Los campos transitorios `partialJson` y `jsonlEvents` se eliminan.
- Si el objeto tiene tanto `content` como `lineCount`, el conteo de líneas se recalcula después del truncamiento.
- Los bloques de imagen en arrays `content` con longitud base64 >= 1024 se externalizan a referencias de blob:
  - almacenados como `blob:sha256:<hash>`
  - los bytes sin procesar se escriben en el almacén de blobs (`BlobStore.put`)

Al cargar, las referencias de blob se resuelven de vuelta a base64 para bloques de imagen de message/custom_message.

## Abstracciones de almacenamiento

La interfaz `SessionStorage` proporciona todas las operaciones de sistema de archivos usadas por `SessionManager`:

- síncronas: `ensureDirSync`, `existsSync`, `writeTextSync`, `statSync`, `listFilesSync`
- asíncronas: `exists`, `readText`, `readTextPrefix`, `writeText`, `rename`, `unlink`, `openWriter`

Implementaciones:

- `FileSessionStorage`: sistema de archivos real (Bun + node fs)
- `MemorySessionStorage`: implementación en memoria respaldada por map para pruebas/sesiones no persistentes

`SessionStorageWriter` expone `writeLine`, `flush`, `fsync`, `close`, `getError`.

## Utilidades de descubrimiento de sesiones

Definidas en `session-manager.ts`:

- `getRecentSessions(sessionDir, limit)` -> metadatos ligeros para UI/selector de sesiones
- `findMostRecentSession(sessionDir)` -> la más reciente por mtime
- `list(cwd, sessionDir?)` -> sesiones en un ámbito de proyecto
- `listAll()` -> sesiones en todos los ámbitos de proyecto bajo `~/.xcsh/agent/sessions`

La extracción de metadatos lee solo un prefijo (`readTextPrefix(..., 4096)`) cuando es posible.

## Relacionado pero distinto: Almacenamiento de historial de prompts

`HistoryStorage` (`history-storage.ts`) es un subsistema SQLite separado para recordar/buscar prompts, no para reproducción de sesiones.

- Base de datos: `~/.xcsh/agent/history.db`
- Tabla: `history(id, prompt, created_at, cwd)`
- Índice FTS5: `history_fts` con sincronización mantenida por triggers
- Deduplica prompts consecutivos idénticos usando una caché en memoria del último prompt
- Inserción asíncrona (`setImmediate`) para que la captura de prompts no bloquee la ejecución del turno

Use los archivos de sesión para la reproducción del grafo/estado de conversación; use `HistoryStorage` para la UX del historial de prompts.
