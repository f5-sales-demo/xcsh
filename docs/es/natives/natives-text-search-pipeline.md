---
title: Canalización de texto nativo y búsqueda
description: >-
  Canalización de búsqueda de texto nativo con indexación de contenido de
  archivos basada en grep, glob y ripgrep.
sidebar:
  order: 6
  label: Canalización de texto y búsqueda
i18n:
  sourceHash: 0e93462fdd12
  translator: machine
---

# Canalización de texto/búsqueda nativa

Este documento mapea la superficie de texto/búsqueda (`grep`, `glob`, `text`, `highlight`) de `@f5-sales-demo/pi-natives` desde los envoltorios de TypeScript hasta las exportaciones N-API de Rust y de vuelta a los objetos de resultado de JS.

La terminología sigue `docs/natives-architecture.md`:

- **Wrapper**: API de TS en `packages/natives/src/*`
- **Capa de módulo Rust**: exportaciones N-API en `crates/pi-natives/src/*`
- **Caché de escaneo compartido**: caché de entradas de directorio respaldada por `fs_cache` utilizada por los flujos de descubrimiento/búsqueda

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

| API del wrapper JS | Exportación Rust (`#[napi]`, snake_case -> camelCase) | Módulo Rust |
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

## Descripción general de la canalización por subsistema

## 1) Búsqueda por expresión regular (`grep`, `searchContent`, `hasMatch`)

### Flujo de entrada/opciones

1. El wrapper de TS reenvía las opciones al módulo nativo:
   - `grep/index.ts` pasa las `options` casi sin cambios y envuelve el callback de `(match) => void` a la forma de callback thread-safe de napi `(err, match)`.
   - `searchContent` y `hasMatch` pasan directamente una cadena de texto o `Uint8Array`.
2. Las estructuras de opciones de Rust en `grep.rs` deserializan campos en camelCase (`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`).
3. `grep` crea un `CancelToken` a partir de `timeoutMs` + `AbortSignal` y se ejecuta dentro de `task::blocking("grep", ...)`.

### Ramas de ejecución

- **Rama en memoria (utilidad pura)**
  - `search` → `search_sync` → `run_search` sobre los bytes de contenido proporcionados.
  - Sin escaneo del sistema de archivos, sin `fs_cache`.
- **Rama de archivo único (dependiente del sistema de archivos)**
  - `grep_sync` resuelve la ruta, verifica que los metadatos correspondan a un archivo y transmite hasta `MAX_FILE_BYTES` por archivo (`4 MiB`) a través del comparador de ripgrep.
- **Rama de directorio (dependiente del sistema de archivos)**
  - Búsqueda opcional en caché mediante `fs_cache::get_or_scan` cuando `cache: true`.
  - Escaneo nuevo mediante `fs_cache::force_rescan` cuando `cache: false`.
  - Reverificación opcional de resultados vacíos cuando la antigüedad de la caché supera `empty_recheck_ms()`.
  - Filtrado de entradas: solo archivos + filtro glob opcional (`glob_util`) + mapeo de filtro de tipo opcional (`js`, `ts`, `rust`, etc.).

### Semántica de búsqueda/recolección

- Motor de expresiones regulares: `grep_regex::RegexMatcherBuilder` con `ignoreCase` y `multiline`.
- Resolución de contexto:
  - `contextBefore/contextAfter` anulan el `context` heredado.
  - Los modos que no son de contenido anulan la recolección de contexto.
- Modos de salida:
  - `content` => un `GrepMatch` por coincidencia.
  - `count` y `filesWithMatches` se mapean a entradas de estilo contador (`lineNumber=0`, `line=""`, `matchCount` establecido).
- Límites:
  - `offset` global y `maxCount` aplicados entre archivos.
  - La ruta paralela se usa solo cuando `maxCount` no está definido y `offset == 0`; de lo contrario, la ruta secuencial preserva la semántica determinista de offset/límite global.

### Conformación del resultado de vuelta a JS

- Los campos de `SearchResult`/`GrepResult` de Rust se mapean a tipos de TS mediante la conversión de campos de objetos N-API.
- Los contadores se limitan a `u32` antes de cruzar N-API.
- Los booleanos opcionales se omiten a menos que sean verdaderos en algunas rutas (`limitReached`).
- El callback de transmisión recibe cada `GrepMatch` conformado (entrada de contenido o de contador).

### Comportamiento ante fallos

- `searchContent` devuelve `SearchResult.error` en caso de fallos de expresión regular/búsqueda en lugar de lanzar una excepción.
- `grep` rechaza ante errores graves (ruta inválida, glob/expresión regular inválida, tiempo de espera de cancelación/cancelación).
- `hasMatch` devuelve `Result<bool>` y lanza una excepción ante errores de patrón inválido/decodificación UTF-8.
- Los errores de apertura/búsqueda de archivos en escaneos de múltiples archivos se omiten por archivo; el escaneo continúa.

### Manejo de expresiones regulares malformadas

`grep.rs` sanea las llaves antes de compilar la expresión regular:

- Las llaves con apariencia de repetición inválida se escapan (`{`/`}` -> `\{`/`\}`) cuando no pueden formar `{N}`, `{N,}`, `{N,M}`.
- Esto evita que fragmentos literales de plantillas comunes (por ejemplo, `${platform}`) fallen como repeticiones malformadas.
- La sintaxis de expresión regular inválida restante aún devuelve un error de expresión regular.

## 2) Descubrimiento de archivos (`glob`) y búsqueda difusa de rutas (`fuzzyFind`)

`glob` y `fuzzyFind` comparten los escaneos de `fs_cache`; la lógica de coincidencia difiere.

### Flujo de `glob`

1. Wrapper de TS (`glob/index.ts`):
   - `path.resolve(options.path)`.
   - Valores predeterminados: `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`.
2. Rust `glob` construye `GlobConfig` y compila el patrón mediante `glob_util::compile_glob`.
3. Fuente de entradas:
   - `cache=true` => `get_or_scan` + `force_rescan` opcional para caché vacía expirada.
   - `cache=false` => `force_rescan(..., store=false)` (solo nuevo).
4. Filtrado:
   - Omitir `.git` siempre.
   - Omitir `node_modules` a menos que se solicite (`includeNodeModules` o patrón que mencione node_modules).
   - Aplicar coincidencia glob.
   - Aplicar filtro de tipo de archivo; los filtros de `file/dir` de enlaces simbólicos resuelven los metadatos del destino.
5. Ordenamiento opcional por mtime descendente (`sortByMtime`) antes de truncar a `maxResults`.

### Flujo de `fuzzyFind` (implementado en `fd.rs`)

1. El wrapper de TS se exporta desde el módulo `grep`, pero la implementación de Rust reside en `fd.rs`.
2. Fuente de escaneo compartida desde `fs_cache` con la misma división de caché/sin caché y política de reverificación de vacío expirado.
3. Puntuación:
   - puntuación difusa basada en exacta / comienza con / contiene / subsecuencia
   - ruta de puntuación normalizada por separadores/puntuación
   - bonificación por directorio y desempate determinista (`score desc`, luego `path asc`)
4. Las entradas de enlaces simbólicos se excluyen de los resultados difusos.

### Comportamiento ante fallos

- Patrón glob inválido => error de `glob_util::compile_glob`.
- La raíz de búsqueda debe ser un directorio existente (`resolve_search_path`), de lo contrario error.
- La cancelación/los tiempos de espera se propagan como errores de cancelación mediante verificaciones de `CancelToken::heartbeat()` en los bucles.

### Manejo de globs malformados

`glob_util::build_glob_pattern` es tolerante:

- Normaliza `\` a `/`.
- Agrega automáticamente el prefijo `**/` a patrones recursivos simples cuando `recursive=true`.
- Cierra automáticamente grupos de alternancia `{...` no balanceados antes de compilar.

## 3) Ciclo de vida del escaneo/caché compartido (`fs_cache`)

`fs_cache` almacena los resultados del escaneo como entradas relativas normalizadas (`path`, `fileType`, `mtime` opcional) indexadas por:

- raíz de búsqueda canónica
- `include_hidden`
- `use_gitignore`

### Transiciones de estado de la caché

1. **Fallo / deshabilitada**
   - TTL es `0` o clave ausente/expirada -> nuevo `collect_entries`.
2. **Acierto**
   - Antigüedad de entrada `< cache_ttl_ms()` -> devolver entradas en caché + `cache_age_ms`.
3. **Reverificación de vacío expirado** (política del llamador en `glob`/`grep`/`fd`)
   - Si la consulta produce cero coincidencias y `cache_age_ms >= empty_recheck_ms()`, forzar un nuevo escaneo.
4. **Invalidación**
   - `invalidateFsScanCache(path?)`:
     - sin argumento: borrar todas las claves
     - argumento de ruta: eliminar claves cuya raíz tiene como prefijo esa ruta destino

### Compensación de resultados expirados

- La caché favorece los escaneos repetidos de baja latencia sobre la consistencia inmediata.
- La ventana de TTL puede devolver positivos/negativos expirados.
- La reverificación de resultados vacíos reduce los negativos expirados en escaneos en caché más antiguos a costa de un escaneo adicional.
- La invalidación explícita es el mecanismo de corrección previsto tras mutaciones de archivos.

## 4) Utilidades de texto ANSI (`text`)

Estas son utilidades puramente en memoria (sin escaneo del sistema de archivos).

### Límites y responsabilidades

- **`text.rs` gestiona la semántica de celdas de terminal**:
  - análisis de secuencias ANSI
  - ancho y segmentación con reconocimiento de grafemas
  - comportamiento de ajuste/truncado/saneamiento
- **El truncado de líneas en `grep.rs` (`maxColumns`) es independiente**:
  - truncado simple por límite de caracteres de líneas coincidentes con `...`
  - no preserva el estado ANSI y no tiene reconocimiento del ancho de celda de terminal

### Comportamientos clave

- `wrapTextWithAnsi`: ajusta por ancho visible, transporta los códigos SGR activos a través de las líneas ajustadas.
- `truncateToWidth`: truncado de celdas visibles con política de puntos suspensivos (`Unicode`, `Ascii`, `Omit`), relleno derecho opcional y ruta rápida que devuelve la cadena JS original cuando no cambia.
- `sliceWithWidth`: segmentación de columnas con aplicación de ancho estricto opcional.
- `extractSegments`: extrae segmentos antes/después alrededor de una superposición mientras restaura el estado ANSI para el segmento `after`.
- `sanitizeText`: elimina secuencias ANSI + caracteres de control, descarta sustitutos sueltos, normaliza CR/LF eliminando `\r`.
- `visibleWidth`: cuenta las celdas de terminal visibles (las tabulaciones usan `TAB_WIDTH` fijo de la implementación de Rust).

### Comportamiento ante fallos

Las funciones de texto generalmente devuelven una salida transformada determinista; los errores se limitan a los límites de conversión de cadenas JS (fallos de conversión de argumentos N-API).

## 5) Resaltado de sintaxis (`highlight`)

`highlight.rs` es transformación pura (sin FS, sin caché).

### Flujo

1. El wrapper reenvía `code`, `lang` opcional y la paleta de colores ANSI.
2. Rust resuelve la sintaxis mediante:
   - búsqueda por token/nombre
   - búsqueda por extensión
   - tabla de alias de respaldo (`ts/tsx/js -> JavaScript`, etc.)
   - recurso de sintaxis de texto sin formato cuando no se resuelve
3. Analiza cada línea con `ParseState` de syntect y la pila de alcances.
4. Mapea los alcances a 11 categorías de color semánticas e inyecta/restablece los códigos de color ANSI.

### Comportamiento ante fallos

- El fallo al analizar una línea no falla la llamada: esa línea se agrega sin resaltar y el procesamiento continúa.
- El lenguaje desconocido/no compatible recurre a la sintaxis de texto sin formato.

## Utilidades puras vs. flujos dependientes del sistema de archivos

| Flujo | Acceso al sistema de archivos | Caché compartida | Notas |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | No | No | expresión regular solo sobre bytes/cadena proporcionados |
| Funciones del módulo `text` | No | No | solo ANSI/ancho/saneamiento |
| Funciones del módulo `highlight` | No | No | solo sintaxis + coloreado ANSI |
| `glob` | Sí | Opcional | escaneos de directorio + filtrado glob |
| `fuzzyFind` | Sí | Opcional | escaneos de directorio + puntuación difusa |
| `grep` (ruta de archivo/directorio) | Sí | Opcional (modo directorio) | ripgrep sobre archivos, filtros/callback opcionales |

## Resumen del ciclo de vida de extremo a extremo

1. El llamador invoca el wrapper de TS con opciones tipadas.
2. El wrapper normaliza los valores predeterminados (especialmente `glob`) y los reenvía a la exportación `native.*`.
3. Rust valida/normaliza las opciones y construye la configuración del comparador/búsqueda.
4. Para los flujos del sistema de archivos, las entradas se escanean (acierto/fallo/reescaneo de caché) y luego se filtran/puntúan.
5. Los bucles de trabajo llaman periódicamente al heartbeat de cancelación; el tiempo de espera/cancelación puede terminar la ejecución.
6. Rust conforma las salidas en objetos N-API (`lineNumber`, `matchCount`, `limitReached`, etc.).
7. El wrapper de TS devuelve objetos JS tipados (y callbacks opcionales por coincidencia para `grep`/`glob`).
