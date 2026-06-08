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
2. **Capa de carga/validación del addon** resuelve y valida el binario `.node` para el runtime actual.
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

`packages/natives/src/index.ts` es el barrel público. Agrupa las exportaciones por dominio de capacidad y re-exporta wrappers tipados en lugar de exponer directamente los bindings N-API sin procesar.

Grupos de nivel superior actuales:

- **Primitivas de búsqueda/texto**: `grep`, `glob`, `text`, `highlight`
- **Primitivas de ejecución/proceso/terminal**: `shell`, `pty`, `ps`, `keys`
- **Primitivas de sistema/media/conversión**: `image`, `html`, `clipboard`, `system-info`, `work`

`packages/natives/src/bindings.ts` define el contrato base de la interfaz:

- `NativeBindings` comienza con miembros compartidos (`cancelWork(id: number)`)
- Los bindings específicos de cada módulo se añaden mediante declaration merging desde el archivo `types.ts` de cada módulo
- `Cancellable` estandariza las opciones de timeout y abort-signal para los wrappers que exponen cancelación

**Contrato garantizado (orientado a la API):** los consumidores importan desde `@f5xc-salesdemos/pi-natives` y utilizan wrappers tipados.

**Detalle de implementación (puede cambiar):** declaration merging y disposición interna de los wrappers (`src/<module>/index.ts`, `src/<module>/types.ts`).

## Capa 2: Carga y validación del addon

`packages/natives/src/native.ts` gestiona la selección del addon en tiempo de ejecución, la extracción opcional y la validación de exportaciones.

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
  - `baseline` (respaldo)
- Las arquitecturas que no son x64 usan el nombre de archivo predeterminado (sin sufijo de variante).

Estrategia de nombres de archivo:

- Release: `pi_natives.<platform>-<arch>.node`
- Release con variante x64: `pi_natives.<platform>-<arch>-modern.node` y/o `...-baseline.node`
- `PI_DEV` habilita diagnósticos del cargador pero no cambia los nombres de archivo del addon

### Detección de variante específica por plataforma

Para x64, la selección de variante utiliza:

- **Linux**: `/proc/cpuinfo`
- **macOS**: `sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows**: verificación PowerShell para `System.Runtime.Intrinsics.X86.Avx2`

`PI_NATIVE_VARIANT` puede forzar explícitamente `modern` o `baseline`.

### Modelo de distribución y extracción de binarios

`packages/natives/package.json` incluye tanto `src` como `native` en los archivos publicados. El directorio `native/` almacena los artefactos precompilados de cada plataforma.

Para binarios compilados (marcadores de runtime `PI_COMPILED` o Bun embebido), el comportamiento del cargador es:

1. Verificar la ruta de caché de usuario versionada: `<getNativesDir()>/<packageVersion>/...`
2. Verificar la ubicación legacy de binarios compilados:
   - Windows: `%LOCALAPPDATA%/xcsh` (respaldo `%USERPROFILE%/AppData/Local/xcsh`)
   - no-Windows: `~/.local/bin`
3. Recurrir a los candidatos del directorio `native/` empaquetado y del directorio del ejecutable

Si existe un manifiesto de addon embebido (`embedded-addon.ts` generado por `scripts/embed-native.ts`), `native.ts` puede materializar el binario embebido correspondiente en el directorio de caché versionado antes de cargarlo.

### Validación y modos de fallo

Después de `require(candidate)`, `validateNative(...)` verifica las exportaciones requeridas (por ejemplo `grep`, `glob`, `highlightCode`, `PtySession`, `Shell`, `getSystemInfo`, `getWorkProfile`, `invalidateFsScanCache`).

Las rutas de fallo son explícitas:

- **Etiqueta de plataforma no soportada**: lanza error con la lista de plataformas soportadas
- **Ningún candidato cargable**: lanza error con todas las rutas intentadas y sugerencias de remediación
- **Exportaciones faltantes**: lanza error con los nombres exactos faltantes y el comando de reconstrucción
- **Errores de extracción embebida**: registra fallos de directorio/escritura y los incluye en el diagnóstico final de carga

**Contrato garantizado (orientado a la API):** la carga del addon tiene éxito con un conjunto de bindings validado o falla rápidamente con texto de error accionable.

**Detalle de implementación (puede cambiar):** orden exacto de búsqueda de candidatos y orden de rutas de respaldo para binarios compilados.

## Capa 3: Capa del módulo Rust N-API

`crates/pi-natives/src/lib.rs` es el módulo de entrada en Rust que declara la propiedad de los módulos exportados:

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

Estos módulos implementan los símbolos N-API consumidos y validados por `native.ts`. Los nombres a nivel de JS se exponen a través de los wrappers TS en `packages/natives/src`.

**Contrato garantizado (orientado a la API):** las exportaciones de los módulos Rust deben coincidir con los nombres de binding esperados por `validateNative` y los módulos wrapper.

**Detalle de implementación (puede cambiar):** descomposición interna de los módulos Rust y límites de los módulos auxiliares (`glob_util`, `task`, etc.).

## Límites de responsabilidad

A nivel de arquitectura, la responsabilidad se divide de la siguiente manera:

- **Responsabilidad del wrapper/API TS (`packages/natives/src`)**
  - agrupación de la API pública, tipado de opciones y ergonomía estable en JS
  - superficie de cancelación (`timeoutMs`, `AbortSignal`) expuesta a los llamadores
- **Responsabilidad del cargador (`packages/natives/src/native.ts`)**
  - selección del binario en tiempo de ejecución
  - selección de variante de CPU y manejo de sobreescrituras
  - extracción de binarios compilados y sondeo de candidatos
  - validación estricta de las exportaciones nativas requeridas
- **Responsabilidad de Rust (`crates/pi-natives/src`)**
  - implementación algorítmica y a nivel de sistema
  - comportamiento nativo de plataforma y lógica sensible al rendimiento
  - implementación de símbolos N-API que los wrappers TS consumen

## Flujo de ejecución (alto nivel)

1. El consumidor importa desde `@f5xc-salesdemos/pi-natives`.
2. El módulo wrapper llama al binding singleton `native`.
3. `native.ts` selecciona el binario candidato para la plataforma/arquitectura/variante.
4. Opcionalmente se realiza la extracción del binario embebido para distribuciones compiladas.
5. El addon se carga y el conjunto de exportaciones se valida.
6. El wrapper devuelve resultados tipados al llamador.

## Glosario

- **Addon nativo**: Un binario `.node` cargado mediante Node-API (N-API).
- **Etiqueta de plataforma**: Tupla de runtime `platform-arch` (por ejemplo `darwin-arm64`).
- **Variante**: Sabor de compilación específico para CPU x64 (`modern` AVX2, `baseline` respaldo).
- **Wrapper**: Función/clase TS que proporciona una API tipada sobre las exportaciones nativas sin procesar.
- **Declaration merging**: Técnica de TS utilizada por los archivos `types.ts` de los módulos para extender `NativeBindings`.
- **Modo de binario compilado**: Modo de ejecución donde el CLI está empaquetado y los addons nativos se resuelven desde rutas extraídas/caché en lugar de solo rutas locales al paquete.
- **Addon embebido**: Metadatos de artefactos de compilación y referencias de archivos generados en `embedded-addon.ts` para que los binarios compilados puedan extraer los payloads `.node` correspondientes.
- **Puerta de validación**: Verificación `validateNative(...)` que rechaza binarios obsoletos/incompatibles a los que les faltan exportaciones requeridas.
