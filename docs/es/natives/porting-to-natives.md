---
title: Migración a pi-natives (N-API) — Notas de campo
description: >-
  Notas de campo para migrar código de child_process y shell de Node.js a la
  capa nativa de Rust con N-API.
sidebar:
  order: 9
  label: Migración a pi-natives
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# Migración a pi-natives (N-API) — Notas de campo

Esta es una guía práctica para mover rutas críticas a `crates/pi-natives` y conectarlas a través de los bindings de JS. Existe para evitar que los mismos fallos ocurran dos veces.

## Cuándo migrar

Migre cuando cualquiera de las siguientes condiciones sea verdadera:

- La ruta crítica se ejecuta en bucles de renderizado, actualizaciones de UI frecuentes o lotes grandes.
- Las asignaciones de JS dominan (rotación de strings, backtracking de regex, arrays grandes).
- Ya tiene una línea base en JS y puede comparar ambas versiones lado a lado.
- El trabajo está limitado por CPU o es I/O bloqueante que puede ejecutarse en el pool de hilos de libuv.
- El trabajo es I/O asíncrono que puede ejecutarse en el runtime de Tokio (por ejemplo, ejecución de shell).

Evite migraciones que dependan de estado exclusivo de JS o imports dinámicos. Las exportaciones de N-API deben ser puras, datos de entrada/datos de salida. El trabajo de larga duración debe pasar por `task::blocking` (limitado por CPU/I/O bloqueante) o `task::future` (I/O asíncrono) con cancelación.

## Anatomía de una exportación nativa

**Lado Rust:**

- La implementación reside en `crates/pi-natives/src/<module>.rs`. Si añade un nuevo módulo, regístrelo en `crates/pi-natives/src/lib.rs`.
- Exporte con `#[napi]`; las exportaciones en snake_case se convierten a camelCase automáticamente. Use `js_name` explícito solo para alias verdaderos/nombres no predeterminados. Use `#[napi(object)]` para structs.
- Use `task::blocking(tag, cancel_token, work)` (ver `crates/pi-natives/src/task.rs`) para trabajo limitado por CPU o bloqueante. Use `task::future(env, tag, work)` para trabajo asíncrono que necesita Tokio (por ejemplo, sesiones de shell). Pase un `CancelToken` cuando exponga `timeoutMs` o `AbortSignal`.

**Lado JS:**

- `packages/natives/src/bindings.ts` contiene la interfaz base `NativeBindings`.
- `packages/natives/src/<module>/types.ts` define los tipos TS y amplía `NativeBindings` mediante fusión de declaraciones.
- `packages/natives/src/native.ts` importa cada archivo `<module>/types.ts` para activar las declaraciones.
- `packages/natives/src/<module>/index.ts` envuelve el binding `native` de `packages/natives/src/native.ts`.
- `packages/natives/src/native.ts` carga el addon y `validateNative` verifica las exportaciones requeridas.
- `packages/natives/src/index.ts` reexporta el wrapper para los consumidores en `packages/*`.

## Lista de verificación para la migración

1. **Añadir la implementación en Rust**

- Coloque la lógica principal en una función Rust simple.
- Si es un nuevo módulo, añádalo a `crates/pi-natives/src/lib.rs`.
- Expóngalo con `#[napi]` para que el mapeo predeterminado snake_case -> camelCase se mantenga consistente.
- Mantenga las firmas con tipos propios y simples: `String`, `Vec<String>`, `Uint8Array`, o `Either<JsString, Uint8Array>` para entradas grandes de strings/bytes.
- Para trabajo limitado por CPU o bloqueante, use `task::blocking`; para trabajo asíncrono, use `task::future`. Pase un `CancelToken` y llame a `heartbeat()` dentro de bucles largos.

2. **Conectar los bindings de JS**

- Añada los tipos y la ampliación de `NativeBindings` en `packages/natives/src/<module>/types.ts`.
- Importe `./<module>/types` en `packages/natives/src/native.ts` para activar la fusión de declaraciones.
- Añada un wrapper en `packages/natives/src/<module>/index.ts` que llame a `native`.
- Reexporte desde `packages/natives/src/index.ts`.

3. **Actualizar la validación nativa**

- Añada `checkFn("newExport")` en `validateNative` (`packages/natives/src/native.ts`).

4. **Añadir benchmarks**

- Coloque los benchmarks junto al paquete propietario (`packages/tui/bench`, `packages/natives/bench`, o `packages/coding-agent/bench`).
- Incluya una versión base en JS y una versión nativa en la misma ejecución.
- Use `Bun.nanoseconds()` y un conteo fijo de iteraciones.
- Mantenga las entradas del benchmark pequeñas y realistas (datos reales observados en la ruta crítica).

5. **Compilar el binario nativo**

- `bun --cwd=packages/natives run build`
- Use `bun --cwd=packages/natives run build` y establezca `PI_DEV=1` si desea diagnósticos del loader durante las pruebas.

6. **Ejecutar el benchmark**

- `bun run packages/<pkg>/bench/<bench>.ts` (o `bun --cwd=packages/natives run bench`)

7. **Decidir sobre el uso**

- Si la versión nativa es más lenta, **mantenga JS** y deje la exportación nativa sin usar.
- Si la versión nativa es más rápida, cambie los puntos de llamada al wrapper nativo.

## Puntos problemáticos y cómo evitarlos

### 1) Un `pi_natives.node` obsoleto impide nuevas exportaciones

El loader prefiere el binario con etiqueta de plataforma en `packages/natives/native` (`pi_natives.<platform>-<arch>.node`). `PI_DEV=1` ahora solo habilita diagnósticos del loader; ya no cambia a un nombre de archivo de addon de desarrollo separado. También existe un fallback `pi_natives.node`. Los binarios compilados se extraen a `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node`. Si alguno de estos está obsoleto, las exportaciones no se actualizarán.

**Solución:** elimine el archivo obsoleto antes de recompilar.

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

Si está ejecutando un binario compilado, elimine el directorio del addon en caché:

```bash
rm -rf ~/.xcsh/natives/<version>
```

Luego verifique que la exportación existe en el binario:

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) Errores de "exportaciones faltantes" de `validateNative`

Esto es **bueno** — previene discrepancias silenciosas. Cuando vea esto:

```
Native addon missing exports ... Missing: visibleWidth
```

significa que su binario está obsoleto, el nombre de la exportación en Rust (o el alias explícito cuando se usa) no coincide con el nombre en JS, o la exportación nunca se compiló. Corrija la compilación y la discrepancia de nombres, no debilite la validación.

### 3) Discrepancia en la firma de Rust

Manténgalo simple y con tipos propios. `String`, `Vec<String>` y `Uint8Array` funcionan. Evite referencias como `&str` en exportaciones públicas. Si necesita datos estructurados, envuélvalos en structs con `#[napi(object)]`.

### 4) Errores en los benchmarks

- No compare diferentes entradas o asignaciones.
- Mantenga JS y nativo usando arrays de entrada idénticos.
- Ejecute ambos en el mismo archivo de benchmark para evitar sesgos.

## Plantilla de benchmark

```ts
const ITERATIONS = 2000;

function bench(name: string, fn: () => void): number {
 const start = Bun.nanoseconds();
 for (let i = 0; i < ITERATIONS; i++) fn();
 const elapsed = (Bun.nanoseconds() - start) / 1e6;
 console.log(`${name}: ${elapsed.toFixed(2)}ms total (${(elapsed / ITERATIONS).toFixed(6)}ms/op)`);
 return elapsed;
}

bench("feature/js", () => {
 jsImpl(sample);
});

bench("feature/native", () => {
 nativeImpl(sample);
});
```

## Lista de verificación final

- `validateNative` pasa (sin exportaciones faltantes).
- `NativeBindings` está ampliado en `packages/natives/src/<module>/types.ts` y el wrapper está reexportado en `packages/natives/src/index.ts`.
- `Object.keys(require(...))` incluye su nueva exportación.
- Los números del benchmark están registrados en el PR/notas.
- El punto de llamada se actualizó **solo si** la versión nativa es más rápida o igual.

## Regla general

- Si la versión nativa es más lenta, **no cambie**. Mantenga la exportación para trabajo futuro, pero el TUI debe quedarse en la ruta más rápida.
- Si la versión nativa es más rápida, cambie el punto de llamada y mantenga el benchmark en su lugar para detectar regresiones.
