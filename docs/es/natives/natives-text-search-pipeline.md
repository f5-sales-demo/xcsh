---
title: Natives Text and Search Pipeline
description: >-
  Native text search pipeline with grep, glob, and ripgrep-based file content
  indexing.
sidebar:
  order: 6
  label: Text & search pipeline
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# Pipeline nativa de texto/búsqueda

Este documento mapea la superficie de texto/búsqueda de `@f5xc-salesdemos/pi-natives` (`grep`, `glob`, `text`, `highlight`) desde los wrappers de TypeScript hasta las exportaciones Rust N-API y de vuelta a los objetos de resultado JS.

La terminología sigue `docs/natives-architecture.md`:

- **Wrapper**: API TS en `packages/natives/src/*`
- **Capa de módulo Rust**: exportaciones N-API en `crates/pi-natives/src/*`
- **Caché de escaneo compartida**: caché de entradas de directorio respaldada por `fs_cache` utilizada por los flujos de descubrimiento/búsqueda

## Archivos de implementación

- `packages/natives/src/grep/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/highlight/types.ts`
- `crates/pi-natives/src/grep.rs`
- `crates/pi-natives/src/glob.rs`
- `crates/pi-natives/src/glob_util.rs`
- `crates/pi-natives/src/fs_cache.rs`
- `crates/pi-natives/src/text.rs`
- `crates/pi-natives/src/highlight.rs`
- `crates/pi-natives/src/fd.rs`

## Mapeo de API JS ↔ exportación Rust

| API wrapper JS | Exportación Rust (`#[napi]`, snake_case -> camelCase) | Módulo Rust |
| --- | --- | --- |
| `grep(options, onMatch?)` | `grep` | `grep.rs` |
| `searchContent(content, options)` | `search` | `grep.rs` |
| `hasMatch(content, pattern, options?)` | `hasMatch` | `grep.rs` |
| `fuzzyFind(options)` | `fuzzyFind` | `fd.rs` |
| `glob(options, onMatch?)` | `glob` | `glob.rs` |
| `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `fs_cache.rs` |
| `wrapTextWithAnsi(text, width)` | `wrapTextWithAnsi` | `text.rs` |
| `truncateToWidth(text, maxWidth, ellipsis, pad)` | `truncateToWidth` | `text.rs` |
| `sliceWithWidth(line, startCol, length, strict?)` | `sliceWithWidth` | `text.rs` |
| `extractSegments(line, beforeEnd, afterStart, afterLen, strictAfter)` | `extractSegments` | `text.rs` |
| `sanitizeText(text)` | `sanitizeText` | `text.rs` |
| `visibleWidth(text)` | `visibleWidth` | `text.rs` |
| `highlightCode(code, lang, colors)` | `highlightCode` | `highlight.rs` |
| `supportsLanguage(lang)` | `supportsLanguage` | `highlight.rs` |
| `getSupportedLanguages()` | `getSupportedLanguages` | `highlight.rs` |

## Visión general del pipeline por subsistema

## 1) Búsqueda por regex (`grep`, `searchContent`, `hasMatch`)

### Flujo de entrada/opciones

1. El wrapper TS reenvía las opciones al módulo nativo:
   - `grep/index.ts` pasa `options` prácticamente sin cambios y envuelve el callback de `(match) => void` a la forma de callback threadsafe de napi `(err, match)`.
   - `searchContent` y `hasMatch` pasan string/`Uint8Array` directamente.
2. Las estructuras de opciones en Rust en `grep.rs` deserializan campos en camelCase (`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`).
3. `grep` crea un `CancelToken` a partir de `timeoutMs` + `AbortSignal` y se ejecuta dentro de `task::blocking("grep", ...)`.

### Ramas de ejecución

- **Rama en memoria (utilidad pura)**
  - `search` → `search_sync` → `run_search` sobre los bytes de contenido proporcionados.
  - Sin escaneo del sistema de archivos, sin `fs_cache`.
- **Rama de archivo único (dependiente del sistema de archivos)**
  - `grep_sync` resuelve la ruta, verifica que los metadatos correspondan a un archivo, transmite hasta `MAX_FILE_BYTES` por archivo (`4 MiB`) a través del matcher de ripgrep.
- **Rama de directorio (dependiente del sistema de archivos)**
  - Búsqueda opcional en caché vía `fs_cache::get_or_scan` cuando `cache: true`.
  - Escaneo fresco vía `fs_cache::force_rescan` cuando `cache: false`.
  - Reverificación opcional de resultado vacío cuando la antigüedad de la caché excede `empty_recheck_ms()`.
  - Filtrado de entradas: solo archivos + filtro glob opcional (`glob_util`) + mapeo de filtro de tipo opcional (`js`, `ts`, `rust`, etc.).

### Semántica de búsqueda/recopilación

- Motor de regex: `grep_regex::RegexMatcherBuilder` con `ignoreCase` y `multiline`.
- Resolución de contexto:
  - `contextBefore/contextAfter` sobrescriben el legado `context`.
  - Los modos sin contenido anulan la recopilación de contexto.
- Modos de salida:
  - `content` => un `GrepMatch` por coincidencia.
  - `count` y `filesWithMatches` ambos se mapean a entradas de estilo conteo (`lineNumber=0`, `line=""`, `matchCount` establecido).
- Límites:
  - `offset` y `maxCount` globales se aplican a través de los archivos.
  - La ruta paralela se usa solo cuando `maxCount` no está establecido y `offset == 0`; de lo contrario, la ruta secuencial preserva la semántica determinista de offset/límite global.

### Transformación del resultado de vuelta a JS

- Los campos de `SearchResult`/`GrepResult` en Rust se mapean a tipos TS vía conversión de campos de objeto N-API.
- Los contadores se limitan a `u32` antes de cruzar N-API.
- Los booleanos opcionales se omiten a menos que sean true en algunas rutas (`limitReached`).
- El callback de streaming recibe cada `GrepMatch` transformado (entrada de contenido o conteo).

### Comportamiento ante fallos

- `searchContent` retorna `SearchResult.error` para fallos de regex/búsqueda en lugar de lanzar una excepción.
- `grep` rechaza ante errores graves (ruta inválida, glob/regex inválido, timeout/aborto por cancelación).
- `hasMatch` retorna `Result<bool>` y lanza excepción ante patrones inválidos/errores de decodificación UTF-8.
- Los errores de apertura/búsqueda de archivos en escaneos de múltiples archivos se omiten por archivo; el escaneo continúa.

### Manejo de regex malformadas

`grep.rs` sanitiza las llaves antes de compilar la regex:

- Las llaves con apariencia de repetición inválida se escapan (`{`/`}` -> `\{`/`\}`) cuando no pueden formar `{N}`, `{N,}`, `{N,M}`.
- Esto evita que fragmentos comunes de template-literal (por ejemplo `${platform}`) fallen como repetición malformada.
- La sintaxis de regex inválida restante aún retorna un error de regex.

## 2) Descubrimiento de archivos (`glob`) y búsqueda difusa de rutas (`fuzzyFind`)

`glob` y `fuzzyFind` comparten escaneos de `fs_cache`; la lógica de coincidencia difiere.

### Flujo de `glob`

1. Wrapper TS (`glob/index.ts`):
   - `path.resolve(options.path)`.
   - Valores por defecto: `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`.
2. Rust `glob` construye `GlobConfig` y compila el patrón vía `glob_util::compile_glob`.
3. Fuente de entradas:
   - `cache=true` => `get_or_scan` + `force_rescan` opcional por resultado vacío obsoleto.
   - `cache=false` => `force_rescan(..., store=false)` (solo fresco).
4. Filtrado:
   - Omitir `.git` siempre.
   - Omitir `node_modules` a menos que se solicite (`includeNodeModules` o patrón que mencione node_modules).
   - Aplicar coincidencia glob.
   - Aplicar filtro de tipo de archivo; los filtros `file/dir` de symlinks resuelven los metadatos del destino.
5. Ordenamiento opcional por mtime descendente (`sortByMtime`) antes de truncar a `maxResults`.

### Flujo de `fuzzyFind` (implementado en `fd.rs`)

1. El wrapper TS se exporta desde el módulo `grep`, pero la implementación Rust reside en `fd.rs`.
2. Fuente de escaneo compartida desde `fs_cache` con la misma división caché/sin-caché y política de reverificación por resultado vacío obsoleto.
3. Puntuación:
   - puntuación difusa basada en coincidencia exacta / comienza-con / contiene / subsecuencia
   - ruta de puntuación normalizada por separadores/puntuación
   - bonificación por directorio y desempate determinista (`score desc`, luego `path asc`)
4. Las entradas de symlink se excluyen de los resultados difusos.

### Comportamiento ante fallos

- Patrón glob inválido => error desde `glob_util::compile_glob`.
- La raíz de búsqueda debe ser un directorio existente (`resolve_search_path`), de lo contrario error.
- Las cancelaciones/timeouts se propagan como errores de aborto vía verificaciones de `CancelToken::heartbeat()` en los bucles.

### Manejo de glob malformados

`glob_util::build_glob_pattern` es tolerante:

- Normaliza `\` a `/`.
- Prefija automáticamente patrones recursivos simples con `**/` cuando `recursive=true`.
- Cierra automáticamente grupos de alternancia `{...` desbalanceados antes de compilar.

## 3) Ciclo de vida de escaneo/caché compartido (`fs_cache`)

`fs_cache` almacena resultados de escaneo como entradas relativas normalizadas (`path`, `fileType`, `mtime` opcional) indexadas por:

- raíz de búsqueda canónica
- `include_hidden`
- `use_gitignore`

### Transiciones de estado de la caché

1. **Fallo / deshabilitada**
   - TTL es `0` o clave ausente/expirada -> `collect_entries` fresco.
2. **Acierto**
   - Antigüedad de entrada `< cache_ttl_ms()` -> retorna entradas en caché + `cache_age_ms`.
3. **Reverificación por resultado vacío obsoleto** (política del llamador en `glob`/`grep`/`fd`)
   - Si la consulta produce cero coincidencias y `cache_age_ms >= empty_recheck_ms()`, forzar un re-escaneo.
4. **Invalidación**
   - `invalidateFsScanCache(path?)`:
     - sin argumento: limpia todas las claves
     - con argumento de ruta: elimina claves cuya raíz sea prefijo de esa ruta objetivo

### Compensación por resultados obsoletos

- La caché favorece escaneos repetidos de baja latencia sobre consistencia inmediata.
- La ventana de TTL puede retornar positivos/negativos obsoletos.
- La reverificación de resultado vacío reduce los negativos obsoletos para escaneos en caché más antiguos al costo de un escaneo extra.
- La invalidación explícita es el mecanismo de corrección previsto después de mutaciones de archivos.

## 4) Utilidades de texto ANSI (`text`)

Estas son utilidades puras en memoria (sin escaneo del sistema de archivos).

### Límites y responsabilidades

- **`text.rs` gestiona la semántica de celdas de terminal**:
  - Análisis de secuencias ANSI
  - Ancho y segmentación consciente de grafemas
  - Comportamiento de ajuste/truncado/sanitización
- **El truncado de línea de `grep.rs` (`maxColumns`) es separado**:
  - Truncado simple por límite de caracteres de líneas coincidentes con `...`
  - No preserva estado ANSI y no es consciente del ancho de celda de terminal

### Comportamientos clave

- `wrapTextWithAnsi`: ajusta por ancho visible, transporta códigos SGR activos a través de líneas ajustadas.
- `truncateToWidth`: truncado por celda visible con política de puntos suspensivos (`Unicode`, `Ascii`, `Omit`), relleno derecho opcional, y ruta rápida que retorna el string JS original cuando no hay cambios.
- `sliceWithWidth`: segmentación por columna con aplicación estricta de ancho opcional.
- `extractSegments`: extrae segmentos antes/después alrededor de una superposición mientras restaura el estado ANSI para el segmento `after`.
- `sanitizeText`: elimina escapes ANSI + caracteres de control, descarta surrogates solitarios, normaliza CR/LF eliminando `\r`.
- `visibleWidth`: cuenta celdas visibles de terminal (los tabuladores usan `TAB_WIDTH` fijo de la implementación Rust).

### Comportamiento ante fallos

Las funciones de texto generalmente retornan salida transformada determinista; los errores se limitan a los límites de conversión de strings JS (fallos de conversión de argumentos N-API).

## 5) Resaltado de sintaxis (`highlight`)

`highlight.rs` es transformación pura (sin FS, sin caché).

### Flujo

1. El wrapper reenvía `code`, `lang` opcional y paleta de colores ANSI.
2. Rust resuelve la sintaxis mediante:
   - búsqueda por token/nombre
   - búsqueda por extensión
   - tabla de alias como respaldo (`ts/tsx/js -> JavaScript`, etc.)
   - respaldo a sintaxis de texto plano cuando no se resuelve
3. Analiza cada línea con `ParseState` de syntect y la pila de alcances.
4. Mapea alcances a 11 categorías semánticas de color e inyecta/restablece códigos de color ANSI.

### Comportamiento ante fallos

- Un fallo de análisis por línea no hace fallar la llamada: esa línea se agrega sin resaltar y el procesamiento continúa.
- Un lenguaje desconocido/no soportado recurre a la sintaxis de texto plano.

## Flujos de utilidad pura vs dependientes del sistema de archivos

| Flujo | Acceso al sistema de archivos | Caché compartida | Notas |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | No | No | regex solo sobre bytes/string proporcionados |
| Funciones del módulo `text` | No | No | solo ANSI/ancho/sanitización |
| Funciones del módulo `highlight` | No | No | solo sintaxis + coloreado ANSI |
| `glob` | Sí | Opcional | escaneos de directorio + filtrado glob |
| `fuzzyFind` | Sí | Opcional | escaneos de directorio + puntuación difusa |
| `grep` (ruta de archivo/directorio) | Sí | Opcional (modo directorio) | ripgrep sobre archivos, filtros/callback opcionales |

## Resumen del ciclo de vida de extremo a extremo

1. El llamador invoca el wrapper TS con opciones tipadas.
2. El wrapper normaliza valores por defecto (notablemente `glob`) y reenvía a la exportación `native.*`.
3. Rust valida/normaliza las opciones y construye el matcher/configuración de búsqueda.
4. Para flujos del sistema de archivos, las entradas se escanean (acierto/fallo/re-escaneo de caché) y luego se filtran/puntúan.
5. Los bucles de workers llaman periódicamente al heartbeat de cancelación; el timeout/aborto puede terminar la ejecución.
6. Rust transforma las salidas en objetos N-API (`lineNumber`, `matchCount`, `limitReached`, etc.).
7. El wrapper TS retorna objetos JS tipados (y callbacks opcionales por coincidencia para `grep`/`glob`).
