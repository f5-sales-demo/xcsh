---
title: Arquitectura de Natives
description: >-
  Arquitectura de addon nativo Rust N-API que conecta TypeScript con operaciones
  específicas de plataforma.
sidebar:
  order: 1
  label: Arquitectura
i18n:
  sourceHash: ff6d5d83a9a7
  translator: machine
---

# Arquitectura de Natives

`@f5xc-salesdemos/pi-natives` es una pila de tres capas:

1. **Capa de wrapper/API en TypeScript** expone puntos de entrada estables en JS/TS.
2. **Capa de carga/validación del addon** resuelve y valida el binario `.node` para el entorno de ejecución actual.
3. **Capa del módulo Rust N-API** implementa primitivas de rendimiento crítico exportadas a JS.

Este documento es la base para documentación más detallada a nivel de módulo.

## Archivos de implementación

- `packages/natives/src/index.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `crates/pi-natives/src/lib.rs`

## Capa 1: Capa de wrapper/API en TypeScript

`packages/natives/src/index.ts` es el barrel público. Agrupa las exportaciones por dominio de capacidad y re-exporta wrappers tipados en lugar de exponer directamente los bindings N-API crudos.

Grupos de nivel superior actuales:

- **Primitivas de búsqueda/texto**: `grep`, `glob`, `text`, `highlight`
- **Primitivas de ejecución/proceso/terminal**: `shell`, `pty`, `ps`, `keys`
- **Primitivas de sistema/medios/conversión**: `image`, `html`, `clipboard`, `system-info`, `work`

`packages/natives/src/bindings.ts` define el contrato de interfaz base:

- `NativeBindings` comienza con miembros compartidos (`cancelWork(id: number)`)
- los bindings específicos de módulo se añaden mediante declaration merging desde el `types.ts` de cada módulo
- `Cancellable` estandariza las opciones de timeout y abort-signal para los wrappers que exponen cancelación

**Contrato garantizado (orientado a la API):** los consumidores importan desde `@f5xc-salesdemos/pi-natives` y utilizan wrappers tipados.

**Detalle de implementación (puede cambiar):** declaration merging y la disposición interna de los wrappers (`src/<module>/index.ts`, `src/<module>/types.ts`).

## Capa 2: Carga y validación del addon

`packages/natives/src/native.ts` es responsable de la selección del addon en tiempo de ejecución, la extracción opcional y la validación de exportaciones.

### Modelo de resolución de candidatos

- La etiqueta de plataforma es `"${process.platform}-${process.arch}"`.
- Las etiquetas soportadas actualmente son:
  - `linux-x64`
  - `linux-arm64`
  - `darwin-x64`
  - `darwin-arm64`
  - `win32-x64`
- x64 puede usar variantes de CPU:
  - `modern` (compatible con AVX2)
  - `baseline` (alternativa)
- Las arquitecturas no-x64 usan el nombre de archivo predeterminado (sin sufijo de variante).

Estrategia de nombres de archivo:

- Release: `pi_natives.<platform>-<arch>.node`
- Release con variante x64: `pi_natives.<platform>-<arch>-modern.node` y/o `...-baseline.node`
- `PI_DEV` habilita diagnósticos del cargador pero no cambia los nombres de archivo del addon

### Detección de variante específica por plataforma

Para x64, la selección de variante utiliza:

- **Linux**: `/proc/cpuinfo`
- **macOS**: `sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows**: verificación mediante PowerShell de `System.Runtime.Intrinsics.X86.Avx2`

`PI_NATIVE_VARIANT` puede forzar explícitamente `modern` o `baseline`.

### Modelo de distribución y extracción de binarios

`packages/natives/package.json` incluye tanto `src` como `native` en los archivos publicados. El directorio `native/` almacena artefactos precompilados de plataforma.

Para binarios compilados (marcadores de runtime `PI_COMPILED` o Bun embebido), el comportamiento del cargador es:

1. Verificar la ruta de caché de usuario versionada: `<getNativesDir()>/<packageVersion>/...`
2. Verificar la ubicación heredada de binarios compilados:
   - Windows: `%LOCALAPPDATA%/xcsh` (alternativa `%USERPROFILE%/AppData/Local/xcsh`)
   - no-Windows: `~/.local/bin`
3. Recurrir al directorio `native/` empaquetado y a los candidatos del directorio del ejecutable

Si un manifiesto de addon embebido está presente (`embedded-addon.ts` generado por `scripts/embed-native.ts`), `native.ts` puede materializar el binario embebido correspondiente en el directorio de caché versionado antes de cargarlo.

### Validación y modos de fallo

Después de `require(candidate)`, `validateNative(...)` verifica las exportaciones requeridas (por ejemplo `grep`, `glob`, `highlightCode`, `PtySession`, `Shell`, `getSystemInfo`, `getWorkProfile`, `invalidateFsScanCache`).

Las rutas de fallo son explícitas:

- **Etiqueta de plataforma no soportada**: lanza un error con la lista de plataformas soportadas
- **Sin candidato cargable**: lanza un error con todas las rutas intentadas y sugerencias de remediación
- **Exportaciones faltantes**: lanza un error con los nombres exactos faltantes y el comando de reconstrucción
- **Errores de extracción embebida**: registra fallos de directorio/escritura y los incluye en el diagnóstico final de carga

**Contrato garantizado (orientado a la API):** la carga del addon tiene éxito con un conjunto de bindings validado o falla rápidamente con un texto de error accionable.

**Detalle de implementación (puede cambiar):** el orden exacto de búsqueda de candidatos y el orden de rutas alternativas para binarios compilados.

## Capa 3: Capa del módulo Rust N-API

`crates/pi-natives/src/lib.rs` es el módulo de entrada de Rust que declara la propiedad de los módulos exportados:

- `clipboard`
- `fd`
- `fs_cache`
- `glob`
- `glob_util`
- `grep`
- `highlight`
- `html`
- `image`
- `keys`
- `prof`
- `ps`
- `pty`
- `shell`
- `system_info`
- `task`
- `text`

Estos módulos implementan los símbolos N-API consumidos y validados por `native.ts`. Los nombres a nivel de JS se exponen a través de los wrappers de TS en `packages/natives/src`.

**Contrato garantizado (orientado a la API):** las exportaciones del módulo Rust deben coincidir con los nombres de binding esperados por `validateNative` y los módulos wrapper.

**Detalle de implementación (puede cambiar):** la descomposición interna de módulos Rust y los límites de módulos auxiliares (`glob_util`, `task`, etc.).

## Límites de propiedad

A nivel de arquitectura, la propiedad se divide de la siguiente manera:

- **Propiedad del wrapper/API en TS (`packages/natives/src`)**
  - agrupación de la API pública, tipado de opciones y ergonomía estable en JS
  - superficie de cancelación (`timeoutMs`, `AbortSignal`) expuesta a los llamadores
- **Propiedad del cargador (`packages/natives/src/native.ts`)**
  - selección del binario en tiempo de ejecución
  - selección de variante de CPU y manejo de sobreescrituras
  - extracción de binarios compilados y sondeo de candidatos
  - validación estricta de las exportaciones nativas requeridas
- **Propiedad de Rust (`crates/pi-natives/src`)**
  - implementación algorítmica y a nivel de sistema
  - comportamiento nativo de plataforma y lógica sensible al rendimiento
  - implementación de símbolos N-API que los wrappers de TS consumen

## Flujo en tiempo de ejecución (alto nivel)

1. El consumidor importa desde `@f5xc-salesdemos/pi-natives`.
2. El módulo wrapper llama al binding singleton `native`.
3. `native.ts` selecciona el binario candidato para la plataforma/arquitectura/variante.
4. La extracción opcional del binario embebido ocurre para distribuciones compiladas.
5. El addon se carga y el conjunto de exportaciones se valida.
6. El wrapper devuelve resultados tipados al llamador.

## Glosario

- **Addon nativo**: Un binario `.node` cargado a través de Node-API (N-API).
- **Etiqueta de plataforma**: Tupla de tiempo de ejecución `platform-arch` (por ejemplo `darwin-arm64`).
- **Variante**: Sabor de compilación específico para CPU x64 (`modern` AVX2, `baseline` alternativa).
- **Wrapper**: Función/clase de TS que proporciona una API tipada sobre las exportaciones nativas crudas.
- **Declaration merging**: Técnica de TS utilizada por los archivos `types.ts` de los módulos para extender `NativeBindings`.
- **Modo de binario compilado**: Modo de ejecución donde el CLI está empaquetado y los addons nativos se resuelven desde rutas extraídas/de caché en lugar de solo rutas locales del paquete.
- **Addon embebido**: Metadatos de artefactos de compilación y referencias de archivos generados en `embedded-addon.ts` para que los binarios compilados puedan extraer los payloads `.node` correspondientes.
- **Puerta de validación**: Verificación `validateNative(...)` que rechaza binarios obsoletos/incompatibles que carecen de las exportaciones requeridas.
