---
title: Runtime del Cargador de Addons Nativos
description: >-
  N-API addon loader runtime with platform detection, fallback strategies, and
  module resolution.
sidebar:
  order: 3
  label: Cargador de addons
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# Runtime del Cargador de Addons Nativos

Este documento profundiza en la capa de carga/validación de addons en `@f5xc-salesdemos/pi-natives`: cómo `native.ts` decide qué archivo `.node` cargar, cuándo se ejecuta la extracción del payload embebido y cómo se reportan los fallos de inicio.

## Archivos de implementación

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## Alcance y responsabilidad

Las responsabilidades del cargador/runtime son intencionalmente limitadas:

- Construir una lista de candidatos para nombres de archivo y directorios de addons según la plataforma y CPU.
- Opcionalmente materializar un addon embebido en un directorio de caché versionado por usuario.
- Intentar los candidatos en orden determinístico.
- Rechazar addons obsoletos o incompatibles mediante `validateNative` antes de exponer los bindings.

Fuera de alcance aquí: comportamiento específico de módulos como grep/text/highlight.

## Entradas del runtime y estado derivado

Durante la inicialización del módulo (`export const native = loadNative();`), `native.ts` computa el contexto estático:

- **Etiqueta de plataforma**: ``${process.platform}-${process.arch}`` (por ejemplo `darwin-arm64`).
- **Versión del paquete**: desde `packages/natives/package.json` (campo `version`).
- **Directorios principales**:
  - `nativeDir`: `packages/natives/native` local al paquete.
  - `execDir`: directorio que contiene `process.execPath`.
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`.
  - Fallback de `userDataDir`:
    - Windows: `%LOCALAPPDATA%/xcsh` (o `%USERPROFILE%/AppData/Local/xcsh`).
    - No-Windows: `~/.local/bin`.
- **Modo binario compilado** (`isCompiledBinary`): verdadero si se cumple alguna de las siguientes:
  - La variable de entorno `PI_COMPILED` está definida, o
  - `import.meta.url` contiene marcadores embebidos de Bun (`$bunfs`, `~BUN`, `%7EBUN`).
- **Sobreescritura de variante**: `PI_NATIVE_VARIANT` (solo `modern`/`baseline`; los valores inválidos se ignoran).
- **Variante seleccionada**: sobreescritura explícita; de lo contrario, detección de AVX2 en tiempo de ejecución en x64 (`modern` si AVX2, sino `baseline`).

## Soporte de plataformas y resolución de etiquetas

`SUPPORTED_PLATFORMS` está fijado a:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

Detalle del comportamiento:

- Las plataformas no soportadas no se rechazan de forma anticipada.
- El cargador aún intenta todos los candidatos computados primero.
- Si nada se carga, lanza un error explícito de plataforma no soportada listando las etiquetas soportadas.

Esto preserva diagnósticos útiles para casos cercanos mientras falla de forma contundente para objetivos verdaderamente no soportados.

## Selección de variante (`modern` / `baseline` / por defecto)

### Comportamiento en x64

1. Si `PI_NATIVE_VARIANT` es `modern` o `baseline`, ese valor prevalece.
2. De lo contrario, detectar soporte AVX2:
   - Linux: escanear `/proc/cpuinfo` buscando `avx2`.
   - macOS: consultar `sysctl` (`machdep.cpu.leaf7_features`, fallback `machdep.cpu.features`).
   - Windows: ejecutar PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported`.
3. Resultado:
   - AVX2 disponible -> `modern`
   - AVX2 no disponible/no detectable -> `baseline`

### Comportamiento en no-x64

- No se utiliza ninguna variante; el cargador permanece con el nombre de archivo por defecto (`pi_natives.<platform>-<arch>.node`).

### Construcción del nombre de archivo

Dado `tag = <platform>-<arch>`:

- No-x64 o sin variante: `pi_natives.<tag>.node`
- x64 + `modern`: intentar en orden
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (fallback intencional)
- x64 + `baseline`: solo `pi_natives.<tag>-baseline.node`

La etiqueta `addonLabel` usada en los mensajes de error finales es `<tag>` o `<tag> (<variant>)`.

## Construcción de rutas candidatas y orden de fallback

`native.ts` construye pools de candidatos antes de cualquier llamada `require(...)`.

### Candidatos de release

Construidos a partir de la lista de nombres de archivo resueltos por variante y buscados en este orden:

- **Runtime no compilado**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **Runtime compilado** (`PI_COMPILED` o marcadores embebidos de Bun):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` elimina duplicados preservando el orden de la primera ocurrencia.

### Secuencia final en runtime

En tiempo de carga:

1. El candidato de extracción embebida opcional (si se produce) se inserta al frente.
2. Los candidatos deduplicados restantes se intentan en orden.
3. El primer candidato que tanto se cargue con `require(...)` como pase `validateNative(...)` gana.

## Ciclo de vida de la extracción de addon embebido

`embedded-addon.ts` define una forma de manifiesto generado:

- `platformTag`
- `version`
- `files[]` donde cada entrada tiene `variant`, `filename`, `filePath`

El valor por defecto registrado actualmente es `embeddedAddon: null`; los artefactos compilados pueden reemplazar esto con metadatos reales.

### Máquina de estados de extracción

La extracción (`maybeExtractEmbeddedAddon`) se ejecuta solo cuando todas las condiciones se cumplen:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. Se encuentra un archivo embebido apropiado para la variante

La selección de archivo por variante refleja la intención de variante del runtime:

- No-x64: preferir `default`, luego el primer archivo disponible.
- x64 + `modern`: preferir `modern`, fallback a `baseline`.
- x64 + `baseline`: requerir `baseline`.

Comportamiento de materialización:

1. Asegurar que `<versionedDir>` existe (`mkdirSync(..., { recursive: true })`).
2. Si `<versionedDir>/<selected filename>` ya existe, reutilizarlo (sin reescritura).
3. De lo contrario, leer el `filePath` de la fuente embebida y escribir el archivo destino.
4. Devolver la ruta destino para el intento de carga de máxima prioridad.

En caso de fallo, la extracción no falla inmediatamente; agrega una entrada de error (fallo en la creación del directorio o escritura) y el cargador procede con el sondeo normal de candidatos.

## Ciclo de vida y transiciones de estado

```text
Init
  -> Compute platform/version/variant/candidate lists
  -> (Compiled + embedded manifest matches?)
       yes -> Try extract embedded to versionedDir (record errors, continue)
       no  -> Skip extraction
  -> For each runtime candidate in order:
       require(candidate)
       -> success: validateNative
            -> pass: return bindings (READY)
            -> fail: record error, continue
       -> failure: record error, continue
  -> none loaded:
       if unsupported platform tag -> throw Unsupported platform
       else -> throw Failed to load (full tried-path diagnostics + hints)
```

## Verificaciones del contrato de `validateNative`

`validateNative(bindings, source)` aplica un contrato exclusivamente de funciones sobre `NativeBindings` en el inicio.

Mecánica:

- Para cada nombre de exportación requerido, verifica `typeof bindings[name] === "function"`.
- Los nombres faltantes se agregan.
- Si alguno falta, el cargador lanza:
  - ruta del addon fuente,
  - lista de exportaciones faltantes,
  - sugerencia de comando de reconstrucción.

Esta es una puerta de compatibilidad estricta contra binarios obsoletos, compilaciones parciales y desviaciones de símbolos/nombres.

### Mapeo de API JS ↔ exportaciones nativas (puerta de validación)

| Nombre del binding JS verificado en `validateNative` | Nombre de exportación nativa esperado |
| --- | --- |
| `grep` | `grep` |
| `glob` | `glob` |
| `highlightCode` | `highlightCode` |
| `executeShell` | `executeShell` |
| `PtySession` | `PtySession` |
| `Shell` | `Shell` |
| `visibleWidth` | `visibleWidth` |
| `getSystemInfo` | `getSystemInfo` |
| `getWorkProfile` | `getWorkProfile` |
| `invalidateFsScanCache` | `invalidateFsScanCache` |

Nota: `bindings.ts` declara solo el miembro base `cancelWork(id)`; los archivos `types.ts` de los módulos hacen declaration-merge de símbolos adicionales que `validateNative` aplica.

## Comportamiento de fallos y diagnósticos

## Plataforma no soportada

Si todos los candidatos fallan y `platformTag` no está en `SUPPORTED_PLATFORMS`, el cargador lanza:

- `Unsupported platform: <tag>`
- Lista completa de plataformas soportadas
- Guía explícita para reportar problemas

## Síntomas de binario obsoleto / desajuste

Señal típica de desajuste obsoleto:

- `Native addon missing exports (<candidate>). Missing: ...`

Causas comunes:

- Binario `.node` antiguo de una versión/forma de API anterior del paquete.
- Artefacto de variante incorrecto seleccionado (para x64).
- Nueva exportación de Rust no presente en el artefacto cargado.

Comportamiento del cargador:

- Registra fallos de exportaciones faltantes por candidato.
- Continúa sondeando los candidatos restantes.
- Si ningún candidato se valida, el error final incluye cada ruta intentada con cada mensaje de fallo.

## Fallos de inicio en binario compilado

En modo compilado, los diagnósticos finales incluyen:

- rutas objetivo esperadas de caché versionado (`<versionedDir>/<filename>`),
- remediación para eliminar el `<versionedDir>` obsoleto y volver a ejecutar,
- comandos directos de descarga de release con `curl` para cada nombre de archivo esperado.

## Fallos de inicio no compilado

En modo normal de paquete/runtime, los diagnósticos finales incluyen:

- sugerencia de reinstalación (`bun install @f5xc-salesdemos/pi-natives`),
- comando de reconstrucción local (`bun --cwd=packages/natives run build`),
- sugerencia opcional de compilación de variante x64 (`TARGET_VARIANT=baseline|modern ...`).

## Comportamiento del runtime

- El cargador siempre utiliza la cadena de candidatos de release.
- Establecer `PI_DEV` solo habilita diagnósticos por candidato en consola (`Loaded native addon...` y errores de carga).
