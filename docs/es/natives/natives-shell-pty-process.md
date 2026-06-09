---
title: 'Internos nativos de Shell, PTY, Procesos y Teclas'
description: >-
  Ejecución de shell, gestión de PTY, ciclo de vida de procesos y manejo de
  eventos de teclas en la capa nativa.
sidebar:
  order: 4
  label: 'Shell, PTY y procesos'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# Internos nativos de Shell, PTY, Procesos y Teclas

Este documento cubre las **primitivas de ejecución/procesos/terminal** en `@f5xc-salesdemos/pi-natives`: `shell`, `pty`, `ps` y `keys`, utilizando los términos de arquitectura de `docs/natives-architecture.md`.

## Archivos de implementación

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs` (solo Windows)
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/ps.rs`
- `crates/pi-natives/src/keys.rs`
- `crates/pi-natives/src/task.rs` (comportamiento de cancelación compartido usado por shell/pty)
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/bindings.ts`

## Responsabilidad por capas

- **Capa de wrapper/API TS** (`packages/natives/src/*`): puntos de entrada tipados, superficie de cancelación (`timeoutMs`, `AbortSignal`) y ergonomía JS.
- **Capa del módulo Rust N-API** (`crates/pi-natives/src/*`): ejecución de procesos shell/PTY, recorrido/terminación del árbol de procesos y análisis de secuencias de teclas.
- **Puerta de validación** (`native.ts`, nivel de arquitectura): asegura que las exportaciones requeridas (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, helpers de teclas) existan antes de que se usen los wrappers.

## Subsistema Shell (`shell`)

### Modelo de API

Se exponen dos modos de ejecución:

1. **Ejecución única** mediante `executeShell(options, onChunk?)`.
2. **Sesión persistente** mediante `new Shell(options?)` y luego `shell.run(...)` repetidamente.

Ambos transmiten la salida a través de un callback threadsafe y devuelven `{ exitCode?, cancelled, timedOut }`.

### Creación de sesión y modelo de entorno

Rust crea `brush_core::Shell` con:

- modo no interactivo,
- `do_not_inherit_env: true`,
- reconstrucción explícita del entorno desde el env del host,
- lista de exclusión para variables sensibles del shell (`PS1`, `PWD`, `SHLVL`, exportaciones de funciones bash, etc.).

Comportamiento del entorno de sesión:

- `ShellOptions.sessionEnv` se aplica una vez en la creación de la sesión.
- `ShellRunOptions.env` tiene alcance de comando (`EnvironmentScope::Command`) y se elimina después de cada ejecución.
- `PATH` se fusiona de forma especial en Windows con deduplicación insensible a mayúsculas.

Enriquecimiento de rutas solo en Windows (`shell/windows.rs`): las rutas descubiertas de Git-for-Windows (`cmd`, `bin`, `usr/bin`) se añaden si están presentes y no están ya incluidas.

### Ciclo de vida en tiempo de ejecución y transiciones de estado

El shell persistente (`Shell.run`) utiliza esta máquina de estados:

- **Inactivo/No inicializado**: `session: None`.
- **En ejecución**: la primera llamada a `run()` crea la sesión de forma diferida, almacena el token `current_abort`, ejecuta el comando.
- **Completado + keepalive**: si el flujo de control de ejecución es `Normal`, `current_abort` se limpia y la sesión se reutiliza.
- **Completado + teardown**: si el flujo de control está relacionado con bucle/script/salida de shell (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), la sesión se descarta (`session: None`).
- **Cancelado/Tiempo agotado**: la tarea de ejecución se cancela, espera de gracia (2s), luego aborto forzado; la sesión se descarta.
- **Error**: la sesión se descarta.

El shell de ejecución única (`executeShell`) siempre crea y descarta una sesión nueva por cada llamada.

### Comportamiento de streaming/salida

- Stdout/stderr se enrutan a un pipe compartido y se leen concurrentemente.
- El lector decodifica UTF-8 de forma incremental; las secuencias de bytes inválidas emiten fragmentos de reemplazo `U+FFFD`.
- Después de la finalización del proceso, el drenaje de salida tiene guardas de inactividad/máximo (`250ms` de inactividad, `2s` máximo) para evitar bloqueos por trabajos en segundo plano que mantienen descriptores abiertos.

### Cancelación, timeout y trabajos en segundo plano

- `CancelToken` se construye a partir de `timeoutMs` y un `AbortSignal` opcional.
- En cancelación/timeout, se activa el token de cancelación del shell, luego la tarea obtiene una ventana de gracia de 2s antes del aborto forzado.
- Si ocurre la cancelación, los trabajos en segundo plano se terminan (`TERM`, luego `KILL` diferido) usando los metadatos de trabajo de brush.

Comportamiento de `Shell.abort()`:

- aborta solo el comando actualmente en ejecución para esa instancia de `Shell`,
- no-op exitoso cuando no hay nada ejecutándose.

### Comportamiento ante fallos

Los errores comúnmente expuestos incluyen:

- fallos de inicialización de sesión (`Failed to initialize shell`),
- errores de cwd (`Failed to set cwd`),
- fallos de configuración/eliminación de env,
- fallos de origen de snapshot,
- fallos de creación/clonación de pipe,
- fallo de ejecución (`Shell execution failed: ...`),
- fallos del wrapper de tarea (`Shell execution task failed: ...`).

Indicadores de cancelación a nivel de resultado:

- timeout -> `exitCode: undefined`, `timedOut: true`.
- señal de aborto -> `exitCode: undefined`, `cancelled: true`.

## Subsistema PTY (`pty`)

### Modelo de API

`new PtySession()` expone:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### Ciclo de vida en tiempo de ejecución y transiciones de estado

Máquina de estados de `PtySession`:

- **Inactivo**: `core: None`.
- **Reservado**: `start()` instala el canal de control de forma síncrona (`core: Some`) antes de que comience el trabajo asíncrono, por lo que `write/resize/kill` se vuelven inmediatamente válidos.
- **En ejecución**: el bucle PTY bloqueante maneja el estado del hijo, eventos del lector, heartbeat de cancelación y mensajes de control.
- **Terminal cerrado**: salida del hijo + finalización del lector.
- **Finalizado**: `core` siempre se restablece a `None` después de que la tarea de start se completa (éxito o error).

Guarda de concurrencia:

- iniciar mientras ya está en ejecución devuelve `PTY session already running`.

### Patrones de spawn/attach/write/read/terminate

- PTY abierto mediante `portable_pty::native_pty_system().openpty(...)`.
- El comando actualmente se ejecuta como `sh -lc <command>` con `cwd` opcional y sobreescrituras de env.
- `write()` envía bytes sin procesar al stdin del PTY.
- `resize()` limita las dimensiones (`cols 20..400`, `rows 5..200`) y llama a resize del master.
- `kill()` marca la ejecución como cancelada y mata el proceso hijo.

Ruta de salida:

- un hilo lector dedicado lee el stream del master,
- decodificación UTF-8 incremental con reemplazo `U+FFFD` en bytes inválidos,
- los fragmentos se reenvían a través del callback threadsafe de N-API.

### Semánticas de cancelación y timeout

- `timeoutMs` y `AbortSignal` alimentan un `CancelToken`.
- el bucle llama a `ct.heartbeat()` periódicamente; el aborto activa la terminación del hijo.
- la clasificación de timeout se basa en cadenas (subcadena `"Timeout"` en el error de heartbeat).

### Comportamiento ante fallos

Las superficies de error incluyen:

- fallo de asignación/apertura de PTY,
- fallo de spawn de PTY,
- fallo de adquisición de writer/reader,
- fallos de estado/espera del hijo,
- envenenamiento de lock,
- desconexión del canal de control (`PTY session is no longer available`).

Fallos de llamadas de control cuando no está en ejecución:

- `write/resize/kill` devuelven `PTY session is not running`.

## Subsistema de árbol de procesos (`ps`)

### Modelo de API

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

El wrapper TS también registra la integración nativa de kill-tree en las utilidades compartidas mediante `setNativeKillTree(native.killTree)`.

### Implementación específica por plataforma

- **Linux**: lee recursivamente `/proc/<pid>/task/<pid>/children`.
- **macOS**: usa `libproc` `proc_listchildpids`.
- **Windows**: toma una instantánea de la tabla de procesos con `CreateToolhelp32Snapshot`, construye un mapa padre->hijos, termina con `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### Comportamiento de kill-tree

- Los descendientes se recopilan recursivamente.
- El orden de terminación es de abajo hacia arriba (los descendientes más profundos primero) para reducir la re-asignación de huérfanos.
- El pid raíz se mata último.
- El valor de retorno es el conteo de terminaciones exitosas.

Comportamiento de señal:

- POSIX: el `signal` proporcionado se pasa a `kill`.
- Windows: `signal` se ignora; la terminación es una terminación incondicional del proceso.

### Comportamiento ante fallos

Este módulo es intencionalmente no lanzador de excepciones en la superficie de API:

- las ramas del árbol de procesos faltantes/inaccesibles se omiten,
- los fallos de kill por pid se cuentan como no exitosos (no errores),
- una búsqueda sin coincidencia típicamente produce `[]` de `listDescendants` y `0` de `killTree`.

## Subsistema de análisis de teclas (`keys`)

### Modelo de API

Helpers expuestos:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### Modelo de análisis

El parser combina:

- mapeos directos de byte único (`enter`, `tab`, `ctrl+<letter>`, ASCII imprimible),
- búsqueda O(1) de secuencias de escape legacy (mapa PHF),
- análisis de xterm `modifyOtherKeys`,
- análisis del protocolo Kitty (`CSI u`, `CSI ~`, `CSI 1;...<letter>`),
- normalización a IDs de tecla (`ctrl+c`, `shift+tab`, `pageUp`, `f5`, etc.).

Manejo de modificadores:

- solo se comparan los bits shift/alt/ctrl para la coincidencia de teclas,
- los bits de bloqueo se enmascaran antes de las comparaciones.

Comportamiento de distribución de teclado:

- el fallback de distribución base está intencionalmente restringido para que las distribuciones remapeadas no creen coincidencias falsas para letras/símbolos ASCII.

### Comportamiento ante fallos

- Las secuencias no reconocidas o inválidas producen `null` desde las funciones de análisis.
- Las funciones de coincidencia devuelven `false` en caso de fallo de análisis o no coincidencia.
- No hay superficie de errores lanzados para entrada de teclas malformada.

## Mapeo de API del wrapper JS ↔ exportaciones Rust

### Shell + PTY + Procesos

| API del wrapper TS | Exportación Rust N-API | Notas |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | Ejecución de shell única |
| `new Shell(options?)` | clase `Shell` | Sesión de shell persistente |
| `shell.run(options, onChunk?)` | `Shell::run` | Reutiliza la sesión en flujo de control keepalive |
| `shell.abort()` | `Shell::abort` | Aborta la ejecución activa para esa instancia de shell |
| `new PtySession()` | clase `PtySession` | Sesión PTY con estado |
| `pty.start(options, onChunk?)` | `PtySession::start` | Ejecución PTY interactiva |
| `pty.write(data)` | `PtySession::write` | Paso directo de stdin sin procesar |
| `pty.resize(cols, rows)` | `PtySession::resize` | Dimensiones de terminal limitadas |
| `pty.kill()` | `PtySession::kill` | Mata forzadamente el hijo PTY activo |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | Terminación del árbol de procesos hijos primero |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | Listado recursivo de descendientes |

### Teclas

| API del wrapper TS | Exportación Rust N-API | Notas |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Coincidencia de codepoint+modificador Kitty |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Parser de key-id normalizado |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | Verificación exacta del mapa de secuencias legacy |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | Resultado estructurado de análisis Kitty |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | Comparador de teclas de alto nivel |

## Notas sobre limpieza de sesiones abandonadas y finalización

- **Sesión persistente de Shell**: si una ejecución es cancelada/agota el tiempo/tiene error/flujo de control no keepalive, Rust descarta explícitamente el estado interno de la sesión. Las ejecuciones normales exitosas mantienen la sesión para su reutilización.
- **Sesión PTY**: `core` siempre se limpia después de que `start()` finaliza, incluyendo rutas de fallo.
- **No se expone un contrato explícito de kill dirigido por finalizadores JS** por parte de los wrappers; la limpieza está principalmente vinculada a las rutas de completación/cancelación de ejecución. Los llamadores deben usar `timeoutMs`, `AbortSignal`, `shell.abort()` o `pty.kill()` para un teardown determinista.
