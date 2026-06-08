---
title: Arquitectura de la caché de escaneo del sistema de archivos
description: >-
  Contrato de la caché de escaneo del sistema de archivos para descubrimiento
  rápido de archivos con semánticas de stale-while-revalidate.
sidebar:
  order: 8
  label: Caché de escaneo del sistema de archivos
i18n:
  sourceHash: 2a2bde1726ac
  translator: machine
---

# Contrato de arquitectura de la caché de escaneo del sistema de archivos

Este documento define el contrato actual para la caché compartida de escaneo del sistema de archivos implementada en Rust (`crates/pi-natives/src/fs_cache.rs`) y consumida por las APIs nativas de descubrimiento/búsqueda expuestas a `packages/coding-agent`.

## Qué es esta caché

La caché almacena listas completas de entradas de escaneo de directorios (`GlobMatch[]`) indexadas por alcance de escaneo y política de recorrido, y luego permite que las operaciones de nivel superior (filtrado por glob, puntuación difusa, selección de archivos por grep) se ejecuten contra esas entradas almacenadas en caché.

Objetivos principales:

- evitar recorridos repetidos del sistema de archivos para llamadas repetidas de descubrimiento/búsqueda
- mantener consistencia entre `glob`, `fuzzyFind` y `grep` cuando comparten la misma política de escaneo
- permitir la recuperación explícita de obsolescencia para resultados vacíos e invalidación explícita después de mutaciones de archivos

## Propiedad y superficie pública

- Implementación y política de la caché: `crates/pi-natives/src/fs_cache.rs`
- Consumidores nativos:
  - `crates/pi-natives/src/glob.rs`
  - `crates/pi-natives/src/fd.rs` (`fuzzyFind`)
  - `crates/pi-natives/src/grep.rs`
- Binding/exportación JS:
  - `packages/natives/src/glob/index.ts` (`invalidateFsScanCache`)
  - `packages/natives/src/glob/types.ts`
  - `packages/natives/src/grep/types.ts`
- Helpers de invalidación por mutación del coding-agent:
  - `packages/coding-agent/src/tools/fs-cache-invalidation.ts`

## Particionamiento de claves de caché (contrato firme)

Cada entrada está indexada por:

- ruta de directorio `root` canonicalizada
- booleano `include_hidden`
- booleano `use_gitignore`

Implicaciones:

- Los escaneos con y sin archivos ocultos **no** comparten entradas.
- Los escaneos que respetan gitignore y los que lo desactivan **no** comparten entradas.
- Los consumidores deben pasar semánticas estables para el comportamiento de hidden/gitignore; cambiar cualquiera de los flags crea una partición de caché diferente.

La inclusión de `node_modules` **no** forma parte de la clave de caché. La caché almacena entradas con `node_modules` incluido; el filtrado por consumidor se aplica después de la recuperación.

## Comportamiento de recolección del escaneo

La población de la caché utiliza un walker determinístico (`ignore::WalkBuilder`) configurado por `include_hidden` y `use_gitignore`:

- `follow_links(false)`
- ordenado por ruta de archivo
- `.git` siempre se omite
- `node_modules` siempre se recolecta en el momento del escaneo de caché (y opcionalmente se filtra después)
- el tipo de archivo de la entrada + `mtime` se capturan mediante `symlink_metadata`

Las raíces de búsqueda se resuelven mediante `resolve_search_path`:

- las rutas relativas se resuelven contra el cwd actual
- el destino debe ser un directorio existente
- la raíz se canonicaliza cuando es posible

## Política de frescura y desalojo

Política global (configurable por variables de entorno):

- `FS_SCAN_CACHE_TTL_MS` (por defecto `1000`)
- `FS_SCAN_EMPTY_RECHECK_MS` (por defecto `200`)
- `FS_SCAN_CACHE_MAX_ENTRIES` (por defecto `16`)

Comportamiento:

- `get_or_scan(...)`
  - si el TTL es `0`: omitir la caché por completo, siempre escaneo fresco (`cache_age_ms = 0`)
  - en acierto de caché dentro del TTL: devolver entradas en caché + `cache_age_ms` distinto de cero
  - en acierto expirado: desalojar la clave, re-escanear, almacenar entrada fresca
- la aplicación del máximo de entradas desaloja primero las más antiguas por `created_at`

## Reverificación rápida de resultados vacíos (separada de los aciertos normales)

Acierto normal de caché:

- un acierto de caché dentro del TTL devuelve las entradas en caché y no hace nada más.

Reverificación rápida de resultados vacíos:

- esta es una política **del lado del llamador** que utiliza `ScanResult.cache_age_ms`
- si el resultado filtrado/consultado está vacío y la antigüedad del escaneo en caché es al menos `empty_recheck_ms()`, el llamador realiza un `force_rescan(...)` y reintenta
- está destinada a reducir resultados negativos obsoletos cuando se añadieron archivos recientemente pero la caché aún está dentro del TTL

Consumidores actuales:

- `glob`: reverifica cuando las coincidencias filtradas están vacías y la antigüedad del escaneo supera el umbral
- `fuzzyFind` (`fd.rs`): reverifica solo cuando la consulta no está vacía y las coincidencias puntuadas están vacías
- `grep`: reverifica cuando la lista de archivos candidatos seleccionados está vacía

## Valores por defecto de los consumidores y uso de la caché

La caché es opt-in en todas las APIs expuestas (`cache?: boolean`, por defecto `false`).

Valores por defecto actuales en las APIs nativas:

- `glob`: `hidden=false`, `gitignore=true`, `cache=false`
- `fuzzyFind`: `hidden=false`, `gitignore=true`, `cache=false`
- `grep`: `hidden=true`, `cache=false`, y el escaneo de caché siempre usa `use_gitignore=true`

Llamadores del coding-agent actualmente:

- El descubrimiento de candidatos de menciones de alto volumen habilita la caché:
  - `packages/coding-agent/src/utils/file-mentions.ts`
  - perfil: `hidden=true`, `gitignore=true`, `includeNodeModules=true`, `cache=true`
- La integración de `grep` a nivel de herramienta actualmente deshabilita la caché de escaneo (`cache: false`):
  - `packages/coding-agent/src/tools/grep.ts`

## Contrato de invalidación

Punto de entrada nativo de invalidación:

- `invalidateFsScanCache(path?: string)`
  - con `path`: eliminar entradas de caché cuya raíz sea un prefijo de la ruta objetivo
  - sin path: limpiar todas las entradas de la caché de escaneo

Detalles del manejo de rutas:

- las rutas de invalidación relativas se resuelven contra el cwd
- la invalidación intenta la canonicalización
- si el destino no existe (por ejemplo, eliminación), la alternativa canonicaliza el padre y reasigna el nombre de archivo cuando es posible
- esto preserva el comportamiento de invalidación para crear/eliminar/renombrar donde uno de los lados puede no existir

## Responsabilidades del flujo de mutación del coding-agent

El código del coding-agent debe invalidar después de mutaciones exitosas del sistema de archivos.

Helpers centrales:

- `invalidateFsScanAfterWrite(path)`
- `invalidateFsScanAfterDelete(path)`
- `invalidateFsScanAfterRename(oldPath, newPath)` (invalida ambos lados cuando las rutas difieren)

Puntos de llamada actuales de herramientas de mutación:

- `packages/coding-agent/src/tools/write.ts`
- `packages/coding-agent/src/patch/index.ts` (flujos hashline/patch/replace)

Regla: si un flujo muta el contenido o la ubicación del sistema de archivos y omite estos helpers, se esperan errores de obsolescencia de la caché.

## Añadir un nuevo consumidor de caché de forma segura

Al introducir el uso de la caché en un nuevo escáner/ruta de búsqueda:

1. **Usar entradas de política de escaneo estables**
   - decidir primero las semánticas de hidden/gitignore
   - pasarlas de forma consistente a `get_or_scan`/`force_rescan` para que las particiones de caché sean intencionales

2. **Tratar los datos de la caché como pre-filtrados solo por política de recorrido**
   - aplicar el filtrado específico de la herramienta (patrones glob, filtros de tipo, reglas de node_modules) después de la recuperación
   - nunca asumir que las entradas en caché ya reflejan sus filtros de nivel superior

3. **Implementar la reverificación rápida de resultados vacíos solo para riesgo de negativos obsoletos**
   - usar `scan.cache_age_ms >= empty_recheck_ms()`
   - reintentar una vez con `force_rescan(..., store=true, ...)`
   - mantener esta ruta separada de la lógica normal de acierto de caché

4. **Respetar el modo sin caché explícitamente**
   - cuando el llamador deshabilita la caché, llamar a `force_rescan(..., store=false, ...)`
   - no poblar la caché compartida en una ruta de solicitud sin caché

5. **Conectar la invalidación por mutación para cualquier nueva ruta de escritura**
   - después de una escritura/edición/eliminación/renombramiento exitoso, llamar al helper de invalidación del coding-agent
   - para renombrar/mover, invalidar tanto la ruta antigua como la nueva

6. **No añadir controles de TTL por llamada**
   - el contrato actual es solo de política global (configurada por variables de entorno), sin sobreescritura de TTL por solicitud

## Límites conocidos

- El alcance de la caché es local al proceso en memoria (`DashMap`), no se persiste entre reinicios del proceso.
- La caché almacena entradas de escaneo, no resultados finales de herramientas.
- `glob`/`fuzzyFind`/`grep` comparten entradas de escaneo solo cuando las dimensiones clave (`root`, `hidden`, `gitignore`) coinciden.
- `.git` siempre se excluye en el momento de la recolección del escaneo independientemente de las opciones del llamador.
