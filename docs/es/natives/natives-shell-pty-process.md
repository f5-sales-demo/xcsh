---
title: 'Internos de Shell, PTY, Proceso y Teclas en Nativos'
description: >-
  Ejecución de shell, gestión de PTY, ciclo de vida de procesos y manejo de
  eventos de teclas en la capa nativa.
sidebar:
  order: 4
  label: 'Shell, PTY y proceso'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# Internos de Shell, PTY, Proceso y Teclas en Nativos

Este documento cubre los **primitivos de ejecución/proceso/terminal** en `@f5xc-salesdemos/pi-natives`: `shell`, `pty`, `ps` y `keys`, utilizando los términos de arquitectura de `docs/natives-architecture.md`.

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

## Titularidad por capa

- **Capa de API/envoltura TS** (`packages/natives/src/*`): puntos de entrada tipados, superficie de cancelación (`timeoutMs`, `AbortSignal`) y ergonomía de JS.
- **Capa del módulo N-API de Rust** (`crates/pi-natives/src/*`): ejecución de procesos shell/PTY, recorrido/terminación del árbol de procesos y análisis de secuencias de teclas.
- **Puerta de validación** (`native.ts`, nivel de arquitectura): garantiza que las exportaciones requeridas (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, ayudantes de teclas) existan antes de que se utilicen las envolturas.

## Subsistema Shell (`shell`)

### Modelo de API

Se exponen dos modos de ejecución:

1. **Ejecución única** mediante `executeShell(options, onChunk?)`.
2. **Sesión persistente** mediante `new Shell(options?)` y luego `shell.run(...)` repetidamente.

Ambos transmiten la salida a través de un callback seguro para hilos y devuelven `{ exitCode?, cancelled, timedOut }`.

### Creación de sesión y modelo de entorno

Rust crea `brush_core::Shell` con:

- modo no interactivo,
- `do_not_inherit_env: true`,
- reconstrucción explícita del entorno a partir del entorno del host,
- lista de exclusión para variables sensibles del shell (`PS1`, `PWD`, `SHLVL`, exportaciones de funciones bash, etc.).

Comportamiento del entorno de sesión:

- `ShellOptions.sessionEnv` se aplica una sola vez al crear la sesión.
- `ShellRunOptions.env` tiene ámbito de comando (`EnvironmentScope::Command`) y se elimina tras cada ejecución.
- `PATH` se combina de forma especial en Windows con deduplicación sin distinción entre mayúsculas y minúsculas.

Enriquecimiento de rutas exclusivo de Windows (`shell/windows.rs`): las rutas de Git-for-Windows descubiertas (`cmd`, `bin`, `usr/bin`) se añaden al final si están presentes y no estaban ya incluidas.

### Ciclo de vida en tiempo de ejecución y transiciones de estado

El shell persistente (`Shell.run`) utiliza esta máquina de estados:

- **Inactivo/No inicializado**: `session: None`.
- **En ejecución**: el primer `run()` crea la sesión de forma diferida, almacena el token `current_abort` y ejecuta el comando.
- **Completado + keepalive**: si el flujo de control de ejecución es `Normal`, `current_abort` se borra y la sesión se reutiliza.
- **Completado + desmontaje**: si el flujo de control está relacionado con bucle/script/salida del shell (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), la sesión se descarta (`session: None`).
- **Cancelado/Tiempo de espera agotado**: la tarea de ejecución se cancela, espera de gracia (2s), luego aborto forzado; la sesión se descarta.
- **Error**: la sesión se descarta.

El shell de ejecución única (`executeShell`) siempre crea y descarta una sesión nueva por llamada.

### Comportamiento de transmisión/salida

- Stdout/stderr se enrutan a una tubería compartida y se leen de forma concurrente.
- El lector decodifica UTF-8 de forma incremental; las secuencias de bytes inválidas emiten fragmentos de reemplazo `U+FFFD`.
- Tras la finalización del proceso, el drenaje de salida dispone de guardas de inactividad/máximo (`250ms` de inactividad, `2s` máximo) para evitar bloqueos por trabajos en segundo plano que mantienen descriptores abiertos.

### Cancelación, tiempo de espera y trabajos en segundo plano

- `CancelToken` se construye a partir de `timeoutMs` y un `AbortSignal` opcional.
- Al cancelar/agotar el tiempo de espera, se activa el token de cancelación del shell y luego la tarea recibe una ventana de gracia de 2s antes del aborto forzado.
- Si se produce la cancelación, los trabajos en segundo plano se terminan (`TERM`, luego `KILL` con retraso) usando los metadatos de trabajos de brush.

Comportamiento de `Shell.abort()`:

- aborta únicamente el comando en ejecución actual para esa instancia de `Shell`,
- no hace nada (éxito sin operación) cuando no hay nada en ejecución.

### Comportamiento ante fallos

Los errores habituales que se exponen incluyen:

- fallos de inicialización de sesión (`Failed to initialize shell`),
- errores de directorio de trabajo (`Failed to set cwd`),
- fallos al establecer/eliminar variables de entorno,
- fallos de la fuente de instantáneas,
- fallos de creación/clonación de tuberías,
- fallo de ejecución (`Shell execution failed: ...`),
- fallos de la envoltura de tarea (`Shell execution task failed: ...`).

Indicadores de cancelación a nivel de resultado:

- tiempo de espera agotado -> `exitCode: undefined`, `timedOut: true`.
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
- **Reservado**: `start()` instala el canal de control de forma síncrona (`core: Some`) antes de que comience el trabajo asíncrono, por lo que `write/resize/kill` son inmediatamente válidos.
- **En ejecución**: el bucle PTY bloqueante gestiona el estado del hijo, eventos del lector, latido de cancelación y mensajes de control.
- **Terminal cerrado**: salida del hijo + finalización del lector.
- **Finalizado**: `core` siempre se restablece a `None` tras la finalización de la tarea de inicio (éxito o error).

Guardia de concurrencia:

- iniciar mientras ya está en ejecución devuelve `PTY session already running`.

### Patrones de spawn/attach/write/read/terminate

- PTY abierto mediante `portable_pty::native_pty_system().openpty(...)`.
- El comando se ejecuta actualmente como `sh -lc <command>` con anulaciones opcionales de `cwd` y entorno.
- `write()` envía bytes sin procesar a la entrada estándar del PTY.
- `resize()` limita las dimensiones (`cols 20..400`, `rows 5..200`) y llama al redimensionado del maestro.
- `kill()` marca la ejecución como cancelada y termina el proceso hijo.

Ruta de salida:

- un hilo lector dedicado lee el flujo maestro,
- decodificación UTF-8 incremental con reemplazo `U+FFFD` en bytes inválidos,
- los fragmentos se reenvían a través del callback seguro para hilos de N-API.

### Semántica de cancelación y tiempo de espera

- `timeoutMs` y `AbortSignal` alimentan un `CancelToken`.
- el bucle llama a `ct.heartbeat()` periódicamente; el aborto activa la terminación del hijo.
- la clasificación del tiempo de espera se basa en cadenas de texto (subcadena `"Timeout"` en el error de latido).

### Comportamiento ante fallos

Las superficies de error incluyen:

- fallo de asignación/apertura del PTY,
- fallo de spawn del PTY,
- fallo de adquisición del escritor/lector,
- fallos de estado/espera del hijo,
- envenenamiento de bloqueo,
- desconexión del canal de control (`PTY session is no longer available`).

Fallos de llamadas de control cuando no está en ejecución:

- `write/resize/kill` devuelven `PTY session is not running`.

## Subsistema de árbol de procesos (`ps`)

### Modelo de API

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

La envoltura TS también registra la integración nativa de kill-tree en las utilidades compartidas mediante `setNativeKillTree(native.killTree)`.

### Implementación específica por plataforma

- **Linux**: lee recursivamente `/proc/<pid>/task/<pid>/children`.
- **macOS**: usa `libproc` `proc_listchildpids`.
- **Windows**: toma una instantánea de la tabla de procesos con `CreateToolhelp32Snapshot`, construye un mapa de padre a hijos, termina los procesos con `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### Comportamiento de kill-tree

- Los descendientes se recopilan de forma recursiva.
- El orden de terminación es de abajo hacia arriba (los descendientes más profundos primero) para reducir la reasignación de huérfanos.
- El pid raíz se termina al final.
- El valor de retorno es el recuento de terminaciones exitosas.

Comportamiento de señales:

- POSIX: la `signal` proporcionada se pasa a `kill`.
- Windows: `signal` se ignora; la terminación es un proceso terminate incondicional.

### Comportamiento ante fallos

Este módulo es intencionalmente no lanzador de excepciones en la superficie de API:

- las ramas del árbol de procesos faltantes/inaccesibles se omiten,
- los fallos de terminación por pid se contabilizan como no exitosos (no como errores),
- una búsqueda fallida típicamente produce `[]` de `listDescendants` y `0` de `killTree`.

## Subsistema de análisis de teclas (`keys`)

### Modelo de API

Ayudantes expuestos:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### Modelo de análisis

El analizador combina:

- mapeos directos de un solo byte (`enter`, `tab`, `ctrl+<letter>`, ASCII imprimible),
- búsqueda O(1) de secuencias de escape heredadas (mapa PHF),
- análisis de `modifyOtherKeys` de xterm,
- análisis del protocolo Kitty (`CSI u`, `CSI ~`, `CSI 1;...<letter>`),
- normalización a identificadores de tecla (`ctrl+c`, `shift+tab`, `pageUp`, `f5`, etc.).

Manejo de modificadores:

- solo se comparan los bits de shift/alt/ctrl para la coincidencia de teclas,
- los bits de bloqueo se enmascaran antes de las comparaciones.

Comportamiento de disposición:

- el respaldo al diseño base está intencionalmente restringido para que los diseños remapeados no creen coincidencias falsas para letras/símbolos ASCII.

### Comportamiento ante fallos

- Las secuencias no reconocidas o inválidas producen `null` de las funciones de análisis.
- Las funciones de coincidencia devuelven `false` en caso de fallo de análisis o no coincidencia.
- No se expone superficie de errores lanzados para entradas de teclas malformadas.

## Correspondencia entre la API de la envoltura JS y las exportaciones de Rust

### Shell + PTY + Proceso

| API de envoltura TS | Exportación N-API de Rust | Notas |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | Ejecución de shell de un solo disparo |
| `new Shell(options?)` | clase `Shell` | Sesión de shell persistente |
| `shell.run(options, onChunk?)` | `Shell::run` | Reutiliza la sesión en flujo de control keepalive |
| `shell.abort()` | `Shell::abort` | Aborta la ejecución activa de esa instancia de shell |
| `new PtySession()` | clase `PtySession` | Sesión PTY con estado |
| `pty.start(options, onChunk?)` | `PtySession::start` | Ejecución PTY interactiva |
| `pty.write(data)` | `PtySession::write` | Paso directo de stdin sin procesar |
| `pty.resize(cols, rows)` | `PtySession::resize` | Dimensiones de terminal limitadas |
| `pty.kill()` | `PtySession::kill` | Termina forzosamente el hijo PTY activo |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | Terminación del árbol de procesos con los hijos primero |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | Listado recursivo de descendientes |

### Teclas

| API de envoltura TS | Exportación N-API de Rust | Notas |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Coincidencia de codepoint+modificador Kitty |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Analizador de identificador de tecla normalizado |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | Verificación exacta en el mapa de secuencias heredadas |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | Resultado de análisis estructurado de Kitty |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | Comparador de teclas de alto nivel |

## Notas sobre limpieza de sesiones abandonadas y finalización

- **Sesión shell persistente**: si una ejecución se cancela/agota el tiempo de espera/produce errores/flujo de control no keepalive, Rust descarta explícitamente el estado de sesión interno. Las ejecuciones normales exitosas mantienen la sesión para su reutilización.
- **Sesión PTY**: `core` siempre se borra después de que `start()` finaliza, incluyendo las rutas de fallo.
- **No se expone ningún contrato explícito de terminación por finalizador de JS** en las envolturas; la limpieza está vinculada principalmente a las rutas de finalización/cancelación de ejecución. Los llamadores deben utilizar `timeoutMs`, `AbortSignal`, `shell.abort()` o `pty.kill()` para el desmontaje determinista.
