---
title: 'Guía de compilación, publicación y depuración de Natives'
description: >-
  Guía de compilación, publicación y depuración del addon nativo de Rust en
  múltiples plataformas.
sidebar:
  order: 8
  label: 'Compilación, publicación y depuración'
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# Guía de compilación, publicación y depuración de Natives

Esta guía describe cómo el pipeline de compilación de `@f5xc-salesdemos/pi-natives` produce addons `.node`, cómo las distribuciones compiladas los cargan y cómo depurar fallos del cargador/compilación.

Sigue los términos de arquitectura de `docs/natives-architecture.md`:

- **producción de artefactos en tiempo de compilación** (`scripts/build-native.ts`)
- **generación del manifiesto de addon embebido** (`scripts/embed-native.ts`)
- **carga del addon en tiempo de ejecución + puerta de validación** (`src/native.ts`)

## Archivos de implementación

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## Visión general del pipeline de compilación

### 1) Puntos de entrada de compilación

Scripts de `packages/natives/package.json`:

- `bun scripts/build-native.ts` (`build`) → compilación de release
- `bun scripts/build-native.ts --dev` (`dev:native`) → compilación con perfil debug/dev (mismo esquema de nombres de salida)
- `bun scripts/embed-native.ts` (`embed:native`) → genera `src/embedded-addon.ts` a partir de los archivos compilados

### 2) Compilación del artefacto Rust

`build-native.ts` ejecuta Cargo en `crates/pi-natives`:

- comando base: `cargo build`
- el modo release añade `--release` a menos que se pase `--dev`
- la compilación cruzada añade `--target <CROSS_TARGET>`

`crates/pi-natives/Cargo.toml` declara `crate-type = ["cdylib"]`, por lo que Cargo emite una biblioteca compartida (`.so`/`.dylib`/`.dll`) que luego se copia/renombra a un nombre de archivo de addon `.node`.

### 3) Descubrimiento e instalación del artefacto

Después de que Cargo finaliza, `build-native.ts` escanea directorios de salida candidatos en orden:

1. `${CARGO_TARGET_DIR}` (si está definido)
2. `<repo>/target`
3. `crates/pi-natives/target`

Para cada raíz verifica directorios de perfil:

- compilación cruzada: `<root>/<crossTarget>/<profile>` luego `<root>/<profile>`
- compilación nativa: `<root>/<profile>`

Luego busca uno de:

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

Cuando lo encuentra, lo instala atómicamente en `packages/natives/native/` con semántica de archivo temporal + renombrado (el fallback de Windows maneja explícitamente los fallos de reemplazo de DLL bloqueadas).

## Modelo de destino/variante y convenciones de nombres

## Etiqueta de plataforma

Tanto la compilación como el tiempo de ejecución usan la etiqueta de plataforma:

`<platform>-<arch>` (ejemplo: `darwin-arm64`, `linux-x64`)

## Modelo de variantes (solo x64)

x64 soporta variantes de CPU:

- `modern` (ruta con capacidad AVX2)
- `baseline` (fallback)

Las arquitecturas que no son x64 usan un único artefacto por defecto (sin sufijo de variante).

### Nombres de archivos de salida

Compilaciones de release:

- x64: `pi_natives.<platform>-<arch>-modern.node` o `...-baseline.node`
- no-x64: `pi_natives.<platform>-<arch>.node`

Compilación dev (`--dev`):

- Usa flags de perfil debug pero mantiene el esquema estándar de nombres con etiqueta de plataforma

Orden de candidatos del cargador en tiempo de ejecución en `native.ts`:

- candidatos de release
- el modo compilado antepone candidatos extraídos/en caché antes de los archivos locales del paquete

## Flags de entorno y opciones de compilación

## Flags de tiempo de ejecución

- `PI_DEV` (comportamiento del cargador): habilitar diagnósticos del cargador
- `PI_NATIVE_VARIANT` (comportamiento del cargador, solo x64): forzar la selección de `modern` o `baseline` en tiempo de ejecución
- `PI_COMPILED` (comportamiento del cargador): habilitar el comportamiento de candidatos/extracción de binarios compilados

## Flags/opciones de tiempo de compilación

- `--dev` (argumento del script): compilar con perfil debug
- `CROSS_TARGET`: se pasa a Cargo como `--target`
- `TARGET_PLATFORM`: sobreescribir el nombre de la etiqueta de plataforma en la salida
- `TARGET_ARCH`: sobreescribir el nombre de la arquitectura en la salida
- `TARGET_VARIANT` (solo x64): forzar `modern` o `baseline` para el nombre de archivo de salida y la política de RUSTFLAGS
- `CARGO_TARGET_DIR`: raíz adicional al buscar salidas de Cargo
- `RUSTFLAGS`:
  - si no está definido y no se está compilando de forma cruzada, el script establece:
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - no-x64 / sin variante: `-C target-cpu=native`
  - si ya está definido, el script no lo sobreescribe

## Transiciones de estado/ciclo de vida de la compilación

### Ciclo de vida de compilación (`build-native.ts`)

1. **Inicialización**: parsear argumentos/entorno (`--dev`, sobreescrituras de destino, flags de compilación cruzada)
2. **Resolución de variante**:
   - no-x64 → sin variante
   - x64 + `TARGET_VARIANT` → variante explícita
   - compilación cruzada x64 sin `TARGET_VARIANT` → error grave
   - compilación local x64 sin sobreescritura → detectar AVX2 del host
3. **Compilar**: ejecutar Cargo con perfil/destino resuelto
4. **Localizar artefacto**: escanear raíces de destino/directorios de perfil/nombres de biblioteca
5. **Instalar**: copiar + renombrado atómico en `packages/natives/native`
6. **Completado**: addon listo para los candidatos del cargador

Las salidas por fallo ocurren en cualquier etapa con texto de error explícito (variante inválida, fallo en cargo build, biblioteca de salida faltante, fallo de instalación/renombrado).

### Ciclo de vida de embed (`embed-native.ts`)

1. **Inicialización**: calcular la etiqueta de plataforma desde `TARGET_PLATFORM`/`TARGET_ARCH` o valores del host
2. **Conjunto de candidatos**:
   - x64 espera ambos `modern` y `baseline`
   - no-x64 espera un archivo por defecto
3. **Validar disponibilidad** en `packages/natives/native`
4. **Generar manifiesto** (`src/embedded-addon.ts`) con imports `file` de Bun y versión del paquete
5. **Extracción en tiempo de ejecución lista** para modo compilado

`--reset` omite la validación y escribe un stub de manifiesto nulo (`embeddedAddon = null`).

## Flujo de trabajo de desarrollo vs comportamiento en producción/compilado

## Flujo de trabajo de desarrollo local

Bucle local típico:

1. Compilar addon:
   - release: `bun --cwd=packages/natives run build`
   - perfil debug: `bun --cwd=packages/natives run dev:native`
2. Establecer `PI_DEV=1` al probar diagnósticos del cargador
3. El cargador en `native.ts` resuelve candidatos locales del paquete en `native/` (y fallback del directorio del ejecutable)
4. `validateNative` impone compatibilidad de exports antes de que los wrappers usen el binding

## Flujo de trabajo de binario distribuido/compilado

En modo compilado (`PI_COMPILED` o marcadores embebidos de Bun):

1. El cargador calcula el directorio de caché versionado: `<getNativesDir()>/<packageVersion>` (operacionalmente `~/.xcsh/natives/<version>`)
2. Si el manifiesto embebido coincide con la plataforma+versión actual, el cargador puede extraer el archivo embebido seleccionado en ese directorio versionado
3. El orden de candidatos en tiempo de ejecución incluye:
   - directorio de caché versionado
   - directorio de binarios compilados legacy (`%LOCALAPPDATA%/xcsh` en Windows, `~/.local/bin` en otros)
   - directorios del paquete/ejecutable
4. El primer addon cargado exitosamente aún debe pasar `validateNative`

Por esto las expectativas de empaquetado + cargador en tiempo de ejecución deben estar alineadas: los nombres de archivo, etiquetas de plataforma y símbolos exportados deben coincidir con lo que `native.ts` sondea y valida.

## Mapeo de API JS ↔ exports de Rust (subconjunto de la puerta de validación)

`native.ts` requiere que estos exports visibles desde JS existan en el addon cargado. Se mapean a exports N-API de Rust en `crates/pi-natives/src`:

| Nombre JS requerido por `validateNative` | Declaración de export en Rust | Archivo fuente Rust |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (export en camelCase) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

Si falta algún símbolo requerido, el cargador falla inmediatamente con una sugerencia de recompilación.

## Comportamiento en fallos y diagnósticos

## Fallos en tiempo de compilación

- Configuración de variante inválida:
  - `TARGET_VARIANT` definido en no-x64 → error inmediato
  - compilación cruzada x64 sin `TARGET_VARIANT` explícito → error inmediato
- Fallo en la compilación de Cargo:
  - el script muestra el código de salida distinto de cero y stderr
- Artefacto no encontrado:
  - el script imprime cada directorio de perfil verificado
- Fallo en la instalación:
  - mensaje explícito; Windows incluye sugerencia sobre archivo bloqueado

## Fallos del cargador en tiempo de ejecución (`native.ts`)

- Etiqueta de plataforma no soportada:
  - lanza excepción con lista de plataformas soportadas
- Ningún candidato pudo cargarse:
  - lanza excepción con lista completa de errores de candidatos y sugerencias de remediación específicas del modo
- Exports faltantes:
  - lanza excepción con nombres exactos de símbolos faltantes y comando de recompilación
- Problemas de extracción embebida:
  - errores de mkdir/escritura de extracción se registran e incluyen en los diagnósticos finales

## Matriz de resolución de problemas

| Síntoma | Causa probable | Verificar | Solución |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | Binario `.node` obsoleto, desajuste en nombre de export de Rust, o se cargó el binario incorrecto | Ejecutar con `PI_DEV=1` para ver la ruta cargada; inspeccionar la lista de exports de ese archivo | Recompilar con `build`; asegurar que el nombre de export `#[napi]` de Rust (o alias explícito cuando sea necesario) coincida con la clave JS; eliminar archivos obsoletos en caché/versionados |
| La máquina x64 carga baseline cuando se esperaba modern | `PI_NATIVE_VARIANT=baseline`, no se detectó AVX2, o solo el archivo baseline está presente | Verificar `PI_NATIVE_VARIANT`; inspeccionar `native/` buscando archivo `-modern` | Compilar variante modern (`TARGET_VARIANT=modern ... build`) y asegurar que el archivo se incluya en la distribución |
| La compilación cruzada produce un binario inutilizable/mal etiquetado | Desajuste entre `CROSS_TARGET` y `TARGET_PLATFORM`/`TARGET_ARCH`, o falta `TARGET_VARIANT` para x64 | Confirmar la tupla de entorno y el nombre del archivo de salida | Re-ejecutar con valores de entorno consistentes y `TARGET_VARIANT` explícito para x64 |
| El binario compilado falla después de una actualización | Caché extraída obsoleta (`~/.xcsh/natives/<versión-antigua-o-no-coincidente>`) o desajuste del manifiesto embebido | Inspeccionar el directorio de natives versionado y la lista de errores del cargador | Eliminar la caché de natives versionada para la versión del paquete y re-ejecutar; regenerar el manifiesto embebido durante el empaquetado |
| El cargador sondea muchas rutas y ninguna funciona | Desajuste de plataforma o artefacto de release faltante en `native/` del paquete | Verificar `platformTag` vs nombre(s) de archivo reales | Asegurar que el nombre del archivo compilado coincida exactamente con la convención `pi_natives.<platform>-<arch>(-variant).node` y que el paquete incluya `native/` |
| `embed:native` falla con "Incomplete native addons" | Los archivos de variante requeridos no se compilaron antes de embeber | Verificar la lista de esperados vs encontrados en el texto del error | Compilar los archivos requeridos primero (x64: ambos modern+baseline; no-x64: por defecto), luego re-ejecutar `embed:native` |

## Comandos operativos

```bash
# Release artifact for current host
bun --cwd=packages/natives run build

# Debug profile artifact build
bun --cwd=packages/natives run dev:native

# Build explicit x64 variants
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# Generate embedded addon manifest from built native files
bun --cwd=packages/natives run embed:native

# Reset embedded manifest to null stub
bun --cwd=packages/natives run embed:native -- --reset
```
