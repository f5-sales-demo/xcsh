---
title: Contrato de enlace nativo (lado TypeScript)
description: >-
  Contrato de enlace del lado TypeScript para llamar a funciones nativas de Rust
  a través de N-API.
sidebar:
  order: 2
  label: Contrato de enlace
i18n:
  sourceHash: f5b74267cdd5
  translator: machine
---

# Contrato de enlace nativo (lado TypeScript)

Este documento define el contrato del lado TypeScript que se sitúa entre los llamadores de `@f5xc-salesdemos/pi-natives` y el addon N-API cargado.

Se centra en tres piezas:

1. forma del contrato (`NativeBindings` + aumento de módulo),
2. comportamiento del wrapper (`src/<module>/index.ts`),
3. superficie de exportación pública (`src/index.ts`).

## Archivos de implementación

- `packages/natives/src/bindings.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/grep/index.ts`
- `packages/natives/src/highlight/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/system-info/types.ts`
- `packages/natives/src/system-info/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/work/types.ts`
- `packages/natives/src/work/index.ts`

## Modelo del contrato

`packages/natives/src/bindings.ts` define el contrato base:

- `NativeBindings` (interfaz base, actualmente incluye `cancelWork(id: number): void`)
- `Cancellable` (`timeoutMs?: number`, `signal?: AbortSignal`)
- `TsFunc<T>` forma de callback utilizada por callbacks threadsafe de N-API

Cada módulo añade sus propios campos mediante fusión de declaraciones:

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

Esto mantiene una única interfaz de enlace agregada sin un archivo de tipos monolítico central.

## Ciclo de vida de la fusión de declaraciones y transiciones de estado

### 1) Ensamblaje de tipos en tiempo de compilación

- `bindings.ts` proporciona el símbolo base `NativeBindings`.
- Cada `src/<module>/types.ts` aumenta `NativeBindings`.
- `src/native.ts` importa todos los archivos `./<module>/types` por sus efectos secundarios para que el contrato fusionado esté en alcance donde se usa `NativeBindings`.

Transición de estado: **Contrato base** → **Contrato fusionado**.

### 2) Carga del addon en tiempo de ejecución y puerta de validación

- `src/native.ts` carga binarios `.node` candidatos.
- El objeto cargado se trata como `NativeBindings` y se pasa inmediatamente a través de `validateNative(...)`.
- `validateNative` verifica las claves de exportación requeridas mediante `typeof bindings[name] === "function"`.

Transición de estado: **Objeto addon no confiable** → **Objeto de enlace nativo validado** (o fallo irrecuperable).

### 3) Invocación del wrapper

- Los wrappers de módulo en `src/<module>/index.ts` llaman a `native.<export>`.
- Los wrappers adaptan valores por defecto y la forma de callback (`(err, value)` a patrones de callback solo-valor en las APIs de JS).
- `src/index.ts` reexporta los wrappers/tipos de módulo como la API pública del paquete.

Transición de estado: **Enlaces sin procesar validados** → **API pública ergonómica**.

## Responsabilidades del wrapper

Los wrappers son intencionalmente delgados; no reimplementan lógica nativa.

Responsabilidades principales:

- **Normalización/valores por defecto de argumentos**
  - `glob()` resuelve `options.path` a ruta absoluta y establece valores por defecto para `hidden`, `gitignore`, `recursive`.
  - `hasMatch()` rellena flags por defecto (`ignoreCase`, `multiline`) antes de la llamada nativa.
- **Adaptación de callbacks**
  - `grep()`, `glob()`, `executeShell()` convierten `TsFunc<T>` (`error, value`) en callback de usuario que recibe solo valores exitosos.
- **Comportamiento de entorno o política alrededor de llamadas nativas**
  - El wrapper del portapapeles añade manejo de OSC52/Termux/headless y trata la copia como mejor esfuerzo.
- **Nomenclatura pública y curación de reexportaciones**
  - `searchContent()` se mapea a la exportación nativa `search`.

## Organización de la superficie de exportación pública

`packages/natives/src/index.ts` es el barrel público canónico. Agrupa las exportaciones por dominio de capacidad:

- Búsqueda/texto: `grep`, `glob`, `text`, `highlight`
- Ejecución/proceso/terminal: `shell`, `pty`, `ps`, `keys`
- Sistema/medios/conversión: `image`, `html`, `clipboard`, `system-info`, `work`

Regla para mantenedores: si un wrapper no se reexporta desde `src/index.ts`, no forma parte de la superficie pública intencionada del paquete.

## Mapeo de API JS ↔ exportación nativa (representativo)

El lado Rust usa nombres de exportación N-API (típicamente de la conversión `#[napi]` snake_case -> camelCase, con alias explícitos ocasionales) que deben coincidir con estas claves de enlace.

| Categoría | API JS pública (wrapper) | Clave de enlace nativo | Tipo de retorno | ¿Async? |
|---|---|---|---|---|
| Grep | `grep(options, onMatch?)` | `grep` | `Promise<GrepResult>` | Sí |
| Grep | `searchContent(content, options)` | `search` | `SearchResult` | No |
| Grep | `hasMatch(content, pattern, opts?)` | `hasMatch` | `boolean` | No |
| Grep | `fuzzyFind(options)` | `fuzzyFind` | `Promise<FuzzyFindResult>` | Sí |
| Glob | `glob(options, onMatch?)` | `glob` | `Promise<GlobResult>` | Sí |
| Glob | `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `void` | No |
| Shell | `executeShell(options, onChunk?)` | `executeShell` | `Promise<ShellExecuteResult>` | Sí |
| Shell | `Shell` | `Shell` | constructor de clase | N/A |
| PTY | `PtySession` | `PtySession` | constructor de clase | N/A |
| Text | `truncateToWidth(...)` | `truncateToWidth` | `string` | No |
| Text | `sliceWithWidth(...)` | `sliceWithWidth` | `SliceWithWidthResult` | No |
| Text | `visibleWidth(text)` | `visibleWidth` | `number` | No |
| Highlight | `highlightCode(code, lang, colors)` | `highlightCode` | `string` | No |
| HTML | `htmlToMarkdown(html, options?)` | `htmlToMarkdown` | `Promise<string>` | Sí |
| System | `getSystemInfo()` | `getSystemInfo` | `SystemInfo` | No |
| Work | `getWorkProfile(lastSeconds)` | `getWorkProfile` | `WorkProfile` | No |
| Process | `killTree(pid, signal)` | `killTree` | `number` | No |
| Process | `listDescendants(pid)` | `listDescendants` | `number[]` | No |
| Clipboard | `copyToClipboard(text)` | `copyToClipboard` | `Promise<void>` (comportamiento de wrapper de mejor esfuerzo) | Sí |
| Clipboard | `readImageFromClipboard()` | `readImageFromClipboard` | `Promise<ClipboardImage \| null>` | Sí |
| Keys | `parseKey(data, kittyProtocolActive)` | `parseKey` | `string \| null` | No |

## Diferencias entre contratos síncronos y asíncronos

El contrato mezcla APIs síncronas y asíncronas; los wrappers preservan el estilo de llamada nativo en lugar de forzar un modelo:

- **Exportaciones asíncronas basadas en Promise** para I/O o trabajo de larga duración (`grep`, `glob`, `htmlToMarkdown`, `executeShell`, portapapeles, operaciones de imagen).
- **Exportaciones síncronas** para transformaciones/parsers determinísticos en memoria (`search`, `hasMatch`, resaltado de sintaxis, ancho/segmentación de texto, análisis de teclas, consultas de procesos).
- **Exportaciones de constructores** para objetos de runtime con estado (`Shell`, `PtySession`, `PhotonImage`).

Implicación para mantenedores: cambiar síncrono ↔ asíncrono para una exportación existente es un cambio de API y contrato que rompe la compatibilidad a través de wrappers y llamadores.

## Patrones de tipado de objetos y enums

### Patrones de objetos (objetos JS estilo `#[napi(object)]`)

TS modela valores nativos con forma de objeto como interfaces, por ejemplo:

- `GrepResult`, `SearchResult`, `GlobResult`
- `SystemInfo`, `WorkProfile`
- `ClipboardImage`, `ParsedKittyResult`

Estos son contratos estructurales en tiempo de compilación; la corrección de la forma en tiempo de ejecución es responsabilidad de la implementación nativa.

### Patrones de enums

Los enums nativos numéricos se representan como valores `const enum` en TS:

- `FileType` (`1=file`, `2=dir`, `3=symlink`)
- `ImageFormat` (`0=PNG`, `1=JPEG`, `2=WEBP`, `3=GIF`)
- `SamplingFilter`, `Ellipsis`, `KeyEventType`

Los llamadores ven miembros de enum con nombre; la frontera de enlace pasa números.

## Cómo se detectan las discrepancias

La detección de discrepancias ocurre en dos capas:

1. **Verificaciones de contrato TypeScript en tiempo de compilación**
   - Los wrappers llaman a `native.<name>` contra `NativeBindings` fusionado.
   - Claves de enlace faltantes/renombradas rompen la verificación de tipos de TS en los wrappers.

2. **Validación en tiempo de ejecución en `validateNative`**
   - Después de la carga, `native.ts` verifica las exportaciones requeridas y lanza una excepción si falta alguna.
   - El mensaje de error incluye las claves faltantes e instrucciones de reconstrucción.

Esto detecta la deriva común de binario obsoleto: el wrapper/tipo existe pero el `.node` cargado carece de la exportación.

## Comportamiento ante fallos y advertencias

### Fallos de carga/validación (fallos irrecuperables)

- El fallo de carga del addon o plataforma no soportada lanza una excepción durante la inicialización del módulo en `native.ts`.
- Las exportaciones requeridas faltantes lanzan una excepción antes de que los wrappers sean utilizables.

Efecto: el paquete falla rápidamente en lugar de diferir el fallo a la primera llamada.

### Diferencias de comportamiento a nivel de wrapper

- Algunos wrappers suavizan intencionalmente los fallos (`copyToClipboard` es de mejor esfuerzo y absorbe el fallo nativo).
- Los callbacks de streaming ignoran las cargas útiles de error del callback y solo reenvían eventos de valor exitosos.

### Advertencias a nivel de tipos (el runtime es más estricto que TS)

- Los campos opcionales de TS no garantizan validez semántica; la capa nativa aún puede rechazar valores malformados.
- El tipado `const enum` no previene valores numéricos fuera de rango de llamadores no tipados en tiempo de ejecución.
- `validateNative` verifica solo la presencia/naturaleza de función de las exportaciones requeridas, no la compatibilidad profunda de forma de argumentos/retorno.
- `bindings.ts` incluye `cancelWork(id)` en la interfaz base, pero la lista de validación actual en tiempo de ejecución no impone esa clave.

## Lista de verificación para mantenedores en cambios de enlace

Al añadir/cambiar una exportación, actualice todos los siguientes:

1. `src/<module>/types.ts` (aumento + tipos de contrato)
2. `src/<module>/index.ts` (comportamiento del wrapper)
3. Importaciones de `src/native.ts` para los tipos del módulo (si es un módulo nuevo)
4. Verificaciones de exportaciones requeridas en `validateNative`
5. Reexportaciones públicas en `src/index.ts`

Omitir cualquier paso crea deriva en tiempo de compilación o fallo en tiempo de carga en ejecución.
