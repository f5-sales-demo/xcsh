---
title: Ejecución y cancelación de tareas nativas en Rust
description: >-
  Modelo de ejecución de tareas asíncronas en Rust con cancelación cooperativa y
  semánticas de limpieza.
sidebar:
  order: 5
  label: Cancelación de tareas
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# Ejecución y cancelación de tareas nativas en Rust (`pi-natives`)

Este documento describe cómo `crates/pi-natives` programa el trabajo nativo y cómo la cancelación fluye desde las opciones de JS (`timeoutMs`, `AbortSignal`) hasta la ejecución en Rust.

## Archivos de implementación

- `crates/pi-natives/src/task.rs`
- `crates/pi-natives/src/grep.rs`
- `crates/pi-natives/src/glob.rs`
- `crates/pi-natives/src/fd.rs`
- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/text.rs`
- `crates/pi-natives/src/ps.rs`

## Primitivas principales (`task.rs`)

`task.rs` define tres piezas fundamentales:

1. `task::blocking(tag, cancel_token, work)`
   - Envuelve `napi::AsyncTask` / `Task`.
   - `compute()` se ejecuta en hilos de trabajo de libuv (para llamadas al sistema bloqueantes/síncronas o intensivas en CPU).
   - Devuelve una `Promise<T>` de JS.

2. `task::future(env, tag, work)`
   - Envuelve `env.spawn_future(...)`.
   - Ejecuta trabajo asíncrono en el runtime de Tokio.
   - Devuelve `PromiseRaw<'env, T>`.

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` combina un plazo límite + un `AbortSignal` opcional.
   - `CancelToken::heartbeat()` es cancelación cooperativa para bucles bloqueantes.
   - `CancelToken::wait()` es espera de cancelación asíncrona (`Signal` / `Timeout` / `User` Ctrl-C).
   - `AbortToken` permite que código externo solicite la cancelación (`abort(reason)`).

## `blocking` vs `future`: modelo de ejecución y selección

### Usar `task::blocking`

Se usa cuando el trabajo es intensivo en CPU o fundamentalmente síncrono/bloqueante:

- escaneo de archivos/regex (`grep`, `glob`, `fuzzy_find`)
- internos del bucle PTY síncrono (`run_pty_sync` mediante `spawn_blocking`)
- conversiones de portapapeles/imagen/html

Comportamiento:

- La closure de trabajo recibe un `CancelToken` clonado.
- La cancelación solo se observa donde el código verifica `ct.heartbeat()?`.
- Un `Err(...)` en la closure rechaza la promesa de JS.

### Usar `task::future`

Se usa cuando el trabajo debe hacer `await` de operaciones asíncronas:

- orquestación de sesiones de shell (`shell.run`, `executeShell`)
- competencia de tareas (`tokio::select!`) entre finalización y cancelación

Comportamiento:

- El future puede competir entre la finalización normal y `ct.wait()`.
- En la ruta de cancelación, las implementaciones asíncronas típicamente propagan la cancelación a subsistemas internos (por ejemplo, `tokio_util::CancellationToken`) y opcionalmente fuerzan la cancelación tras un tiempo de gracia.

## Mapeo de API JS ↔ exportación Rust (relevante para tareas/cancelación)

| API orientada a JS | Exportación Rust (`#[napi]`) | Programador | Conexión de cancelación |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` en bucle de filtrado |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` en bucle de puntuación |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` compite contra la tarea de ejecución; conecta con `CancellationToken` de Tokio |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | igual que arriba |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + `spawn_blocking` interno | `CancelToken` verificado en bucle PTY síncrono mediante `heartbeat()` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | ninguna (token `()`) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | ninguna (token `()`) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | ninguna (token `()`) |

`text.rs` y `ps.rs` actualmente no usan `task::blocking`/`task::future` y por lo tanto no participan en esta ruta de cancelación.

## Ciclo de vida de la cancelación y transiciones de estado

### Ciclo de vida de `CancelToken`

`CancelToken` es cooperativo y con estado:

```text
Created
  ├─ no signal + no timeout  -> passive token (never aborts unless externally emplaced)
  ├─ signal registered        -> waits for AbortSignal callback
  └─ deadline set             -> timeout check becomes active

Running
  ├─ heartbeat()/wait() sees signal   -> AbortReason::Signal
  ├─ heartbeat()/wait() sees deadline -> AbortReason::Timeout
  ├─ wait() sees Ctrl-C               -> AbortReason::User
  └─ no abort                         -> continue

Aborted (terminal)
  └─ first abort reason wins (atomic flag + notifier)
```

### Cancelación antes del inicio vs durante la ejecución

- **Antes del inicio / antes de la primera verificación de cancelación**:
  - Los usuarios de `task::future` que compiten con `ct.wait()` pueden resolver la cancelación inmediatamente una vez que entran en `select!`.
  - Los usuarios de `task::blocking` solo observan la cancelación cuando el código de la closure alcanza `heartbeat()`. Si la closure no ejecuta heartbeat tempranamente, la cancelación se retrasa.

- **Durante la ejecución**:
  - `blocking`: el siguiente `heartbeat()` devuelve `Err("Aborted: ...")`.
  - `future`: la rama `ct.wait()` gana el `select!`, luego el código cancela la maquinaria asíncrona subordinada (para shell: cancela el token de Tokio, espera hasta 2s, luego aborta la tarea).

## Expectativas de heartbeat para bucles de larga duración

`heartbeat()` debe ejecutarse a una cadencia predecible en bucles con conjuntos de trabajo ilimitados o grandes.

Patrones observados:

- `glob::filter_entries`: verificar cada entrada antes de filtrar/hacer coincidencias.
- `fd::score_entries`: verificar cada candidato escaneado.
- `grep_sync`: verificación explícita de cancelación antes de la fase de búsqueda pesada, además de llamadas a fs-cache que también reciben el token.
- `run_pty_sync`: verificar en cada tick del bucle (cadencia de sleep de ~16ms) y terminar el proceso hijo en caso de cancelación.

Regla práctica: ningún bucle sobre entrada de tamaño externo debe exceder un intervalo corto acotado sin un heartbeat.

## Comportamiento de fallos y propagación de errores a JS

### Tareas bloqueantes

Ruta de error:

1. La closure devuelve `Err(napi::Error)` (incluyendo cancelación por `heartbeat()`).
2. `Task::compute()` devuelve `Err`.
3. `AsyncTask` rechaza la promesa de JS.

Cadenas de error típicas:

- `Aborted: Timeout`
- `Aborted: Signal`
- errores de dominio (`Failed to decode image: ...`, `Conversion error: ...`, etc.)

### Tareas future

Ruta de error:

1. El cuerpo asíncrono devuelve `Err(napi::Error)` o el fallo de join se mapea (`... task failed: {err}`).
2. La promesa creada por `task::future` se rechaza.
3. Algunas APIs devuelven intencionalmente resultados estructurados de cancelación en lugar de rechazo (`ShellRunResult`/`ShellExecuteResult` con flags `cancelled`/`timed_out` y `exit_code: None`).

### División en el reporte de cancelación

- **Cancelación como error**: la mayoría de las exportaciones bloqueantes que usan `heartbeat()?`.
- **Cancelación como resultado tipado**: APIs estilo shell/pty de comandos que modelan la cancelación en structs de resultado.

Elija un modelo por API y documéntelo explícitamente.

## Errores comunes

1. **Heartbeat faltante en bucles bloqueantes**
   - Síntoma: el timeout/señal parece ignorarse hasta que el bucle termina.
   - Solución: agregar `ct.heartbeat()?` al inicio del bucle y antes de pasos costosos por elemento.

2. **Secciones largas no cancelables**
   - Síntoma: picos de latencia en la cancelación durante una sola llamada grande (decodificación, ordenamiento, compresión, etc.).
   - Solución: dividir el trabajo en fragmentos con límites de heartbeat; si es imposible, documentar la latencia.

3. **Bloqueo del ejecutor asíncrono**
   - Síntoma: la API asíncrona se detiene cuando código pesado en sincronía se ejecuta directamente en el future.
   - Solución: mover bloques de CPU/síncronos a `task::blocking` o `tokio::task::spawn_blocking`.

4. **Semánticas de cancelación inconsistentes**
   - Síntoma: una API rechaza en cancelación, otra resuelve con flags, confundiendo a los consumidores.
   - Solución: estandarizar por dominio y mantener alineada la documentación del wrapper.

5. **Olvidar el puente de cancelación en tareas asíncronas anidadas**
   - Síntoma: el token externo se cancela pero los lectores internos/tareas de subproceso siguen ejecutándose.
   - Solución: conectar la cancelación al token/señal interno y aplicar un tiempo de gracia + respaldo de cancelación forzada.

## Lista de verificación para nuevas exportaciones cancelables

1. Clasificar el trabajo correctamente:
   - Intensivo en CPU o bloqueo síncrono -> `task::blocking`
   - I/O asíncrono / orquestación con `await` -> `task::future`

2. Exponer las entradas de cancelación cuando sea necesario:
   - incluir `timeoutMs` y `signal` en las opciones `#[napi(object)]`
   - crear `let ct = task::CancelToken::new(timeout_ms, signal);`

3. Conectar la cancelación a través de todas las capas:
   - bucles bloqueantes: `ct.heartbeat()?` a intervalos estables
   - orquestación asíncrona: competir con `ct.wait()` y cancelar sub-tareas/tokens

4. Decidir el contrato de cancelación:
   - rechazar la promesa con error de cancelación, o
   - resolver con tipo `{ cancelled, timedOut, ... }`
   - mantener este contrato consistente para la familia de APIs

5. Propagar fallos con contexto:
   - mapear errores mediante `Error::from_reason(format!("...: {err}"))`
   - incluir prefijos específicos de la etapa (`spawn`, `decode`, `wait`, etc.)

6. Manejar la cancelación antes del inicio y durante la ejecución:
   - la verificación/espera de cancelación debe ocurrir antes del cuerpo costoso y durante la ejecución prolongada

7. Validar que no hay mal uso del ejecutor:
   - no ejecutar trabajo síncrono largo directamente dentro de futures asíncronos sin `spawn_blocking`/wrapper de tarea bloqueante
