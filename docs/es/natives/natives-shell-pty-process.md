---
title: 'Internos de Shell, PTY, Proceso y Teclas en Nativos'
description: >-
  Ejecución de shell, gestión de PTY, ciclo de vida de procesos y manejo de
  eventos de teclado en la capa nativa.
sidebar:
  order: 4
  label: 'Shell, PTY y proceso'
i18n:
  sourceHash: 00ea95614c6a
  translator: machine
---

# Internos de Shell, PTY, Proceso y Teclas en Nativos

Este documento cubre las **primitivas de ejecución/proceso/terminal** en `@f5-sales-demo/pi-natives`: `shell`, `pty`, `ps` y `keys`, utilizando los términos de arquitectura de `docs/natives-architecture.md`.

## Archivos de implementación

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs` (solo Windows)
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/ps.rs`
- `crates/pi-natives/src/keys.rs`
- `crates/pi-natives/src/task.rs` (comportamiento de cancelación compartido utilizado por shell/pty)
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/bindings.ts`

## Propiedad por capa

- **Capa de envoltura/API de TS** (`packages/natives/src/*`): puntos de entrada tipados, superficie de cancelación (`timeoutMs`, `AbortSignal`) y ergonomía de JS.
- **Capa del módulo N-API de Rust** (`crates/pi-natives/src/*`): ejecución de procesos shell/PTY, recorrido/terminación del árbol de procesos y análisis de secuencias de teclas.
- **Puerta de validación** (`native.ts`, nivel de arquitectura): garantiza que las exportaciones requeridas (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, helpers de teclas) existan antes de que se utilicen los envoltorios.

## Subsistema Shell (`shell`)

### Modelo de API

Se exponen dos modos de ejecución:

1. **Ejecución única** mediante `executeShell(options, onChunk?)`.
2. **Sesión persistente** mediante `new Shell(options?)` seguido de llamadas repetidas a `shell.run(...)`.

Ambos transmiten la salida a través de un callback seguro para hilos y devuelven `{ exitCode?, cancelled, timedOut }`.

### Creación de sesión y modelo de entorno

Rust crea `brush_core::Shell` con:

- modo no interactivo,
- `do_not_inherit_env: true`,
- reconstrucción explícita del entorno a partir del entorno del host,
- lista de exclusión para variables sensibles al shell (`PS1`, `PWD`, `SHLVL`, exportaciones de funciones bash, etc.).

Comportamiento del entorno de sesión:

- `ShellOptions.sessionEnv` se aplica una sola vez en la creación de la sesión.
- `ShellRunOptions.env` tiene ámbito de comando (`EnvironmentScope::Command`) y se elimina tras cada ejecución.
- `PATH` se fusiona de forma especial en Windows con deduplicación sin distinción entre mayúsculas y minúsculas.

Enriquecimiento de rutas exclusivo de Windows (`shell/windows.rs`): las rutas de Git-for-Windows descubiertas (`cmd`, `bin`, `usr/bin`) se añaden al final si están presentes y no se han incluido ya.

### Ciclo de vida en tiempo de ejecución y transiciones de estado

El shell persistente (`Shell.run`) utiliza esta máquina de estados:

- **Inactivo/No inicializado**: `session: None`.
- **En ejecución**: el primer `run()` crea la sesión de forma diferida, almacena el token `current_abort` y ejecuta el comando.
- **Completado + keepalive**: si el flujo de control de ejecución es `Normal`, `current_abort` se borra y la sesión se reutiliza.
- **Completado + desmontaje**: si el flujo de control está relacionado con bucle/script/salida del shell (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), la sesión se descarta (`session: None`).
- **Cancelado/Tiempo de espera agotado**: la tarea de ejecución se cancela, espera de gracia (2 s) y luego se fuerza el aborto; la sesión se descarta.
- **Error**: la sesión se descarta.

El shell de ejecución única (`executeShell`) siempre crea y descarta una sesión nueva por llamada.

### Comportamiento de transmisión/salida

- La salida estándar y de error se enrutan a una tubería compartida y se leen de forma concurrente.
- El lector decodifica UTF-8 de forma incremental; las secuencias de bytes inválidas emiten fragmentos de reemplazo `U+FFFD`.
- Tras la finalización del proceso, el drenaje de salida tiene guardas de inactividad/máximo (`250 ms` de inactividad, `2 s` máximo) para evitar bloqueos cuando trabajos en segundo plano mantienen descriptores abiertos.

### Cancelación, tiempo de espera y trabajos en segundo plano

- `CancelToken` se construye a partir de `timeoutMs` y un `AbortSignal` opcional.
- Al cancelar/agotar el tiempo, se activa el token de cancelación del shell; luego la tarea tiene una ventana de gracia de 2 s antes del aborto forzado.
- Si se produce la cancelación, los trabajos en segundo plano se terminan (`TERM`, luego `KILL` diferido) mediante los metadatos de trabajos de brush.

Comportamiento de `Shell.abort()`:

- aborta únicamente el comando en ejecución actual de esa instancia de `Shell`,
- no tiene efecto (éxito sin operación) cuando no hay nada en ejecución.

### Comportamiento ante fallos

Los errores más comunes que se exponen incluyen:

- fallos de inicialización de sesión (`Failed to initialize shell`),
- errores de directorio de trabajo (`Failed to set cwd`),
- fallos de establecimiento/extracción de entorno,
- fallos de la fuente de instantánea,
- fallos de creación/clonación de tubería,
- fallo de ejecución (`Shell execution failed: ...`),
- fallos del envoltorio de tarea (`Shell execution task failed: ...`).

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
- **Reservado**: `start()` instala el canal de control de forma síncrona (`core: Some`) antes de que comience el trabajo asíncrono, por lo que `write/resize/kill` pasan a ser válidos de inmediato.
- **En ejecución**: el bucle de PTY bloqueante gestiona el estado del proceso hijo, los eventos del lector, el latido de cancelación y los mensajes de control.
- **Terminal cerrado**: salida del proceso hijo + finalización del lector.
- **Finalizado**: `core` siempre se restablece a `None` después de que la tarea de inicio se complete (con éxito o con error).

Guardia de concurrencia:

- iniciar mientras ya está en ejecución devuelve `PTY session already running`.

### Patrones de creación/adjunto/escritura/lectura/terminación

- PTY abierto mediante `portable_pty::native_pty_system().openpty(...)`.
- El comando actualmente se ejecuta como `sh -lc <command>` con anulaciones opcionales de `cwd` y entorno.
- `write()` envía bytes sin procesar a la entrada estándar del PTY.
- `resize()` limita las dimensiones (`cols 20..400`, `rows 5..200`) y llama al redimensionamiento del maestro.
- `kill()` marca la ejecución como cancelada y termina el proceso hijo.

Ruta de salida:

- un hilo lector dedicado lee el flujo maestro,
- decodificación incremental de UTF-8 con reemplazo `U+FFFD` en bytes inválidos,
- fragmentos reenviados a través del callback seguro para hilos de N-API.

### Semántica de cancelación y tiempo de espera

- `timeoutMs` y `AbortSignal` alimentan un `CancelToken`.
- el bucle llama a `ct.heartbeat()` periódicamente; el aborto activa la terminación del proceso hijo.
- la clasificación del tiempo de espera se basa en cadenas (subcadena `"Timeout"` en el error de latido).

### Comportamiento ante fallos

Las superficies de error incluyen:

- fallo de asignación/apertura de PTY,
- fallo de inicio del PTY,
- fallo de adquisición del escritor/lector,
- fallos de estado/espera del proceso hijo,
- envenenamiento de bloqueo,
- desconexión del canal de control (`PTY session is no longer available`).

Fallos de llamadas de control cuando no está en ejecución:

- `write/resize/kill` devuelven `PTY session is not running`.

## Subsistema de árbol de procesos (`ps`)

### Modelo de API

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

El envoltorio de TS también registra la integración nativa de kill-tree en las utilidades compartidas mediante `setNativeKillTree(native.killTree)`.

### Implementación específica por plataforma

- **Linux**: lee recursivamente `/proc/<pid>/task/<pid>/children`.
- **macOS**: utiliza `libproc` `proc_listchildpids`.
- **Windows**: realiza una instantánea de la tabla de procesos con `CreateToolhelp32Snapshot`, construye un mapa padre->hijos y termina con `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### Comportamiento de kill-tree

- Los descendientes se recopilan de forma recursiva.
- El orden de terminación es de abajo hacia arriba (los descendientes más profundos primero) para reducir la reasignación de procesos huérfanos.
- El pid raíz se termina en último lugar.
- El valor de retorno es el recuento de terminaciones exitosas.

Comportamiento de señales:

- POSIX: la `signal` proporcionada se pasa a `kill`.
- Windows: `signal` se ignora; la terminación es un proceso de terminación incondicional.

### Comportamiento ante fallos

Este módulo es intencionalmente no lanzador de excepciones en la superficie de la API:

- las ramas del árbol de procesos faltantes o inaccesibles se omiten,
- los fallos de terminación por pid se contabilizan como no exitosos (no como errores),
- una búsqueda fallida típicamente produce `[]` de `listDescendants` y `0` de `killTree`.

## Subsistema de análisis de teclas (`keys`)

### Modelo de API

Helpers expuestos:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### Modelo de análisis

El analizador combina:

- asignaciones directas de un solo byte (`enter`, `tab`, `ctrl+<letter>`, ASCII imprimible),
- búsqueda O(1) de secuencias de escape heredadas (mapa PHF),
- análisis de `modifyOtherKeys` de xterm,
- análisis del protocolo Kitty (`CSI u`, `CSI ~`, `CSI 1;...<letter>`),
- normalización a IDs de tecla (`ctrl+c`, `shift+tab`, `pageUp`, `f5`, etc.).

Manejo de modificadores:

- solo se comparan los bits de shift/alt/ctrl para la coincidencia de teclas,
- los bits de bloqueo se enmascaran antes de las comparaciones.

Comportamiento de distribución:

- la reserva de distribución base está intencionalmente limitada para que las distribuciones reasignadas no creen coincidencias falsas para letras/símbolos ASCII.

### Comportamiento ante fallos

- Las secuencias no reconocidas o inválidas producen `null` desde las funciones de análisis.
- Las funciones de coincidencia devuelven `false` ante un fallo de análisis o una discrepancia.
- No se expone ninguna superficie de error lanzado para entradas de teclas malformadas.

## Mapeo de API del envoltorio JS ↔ exportaciones de Rust

### Shell + PTY + Proceso

| API del envoltorio TS | Exportación N-API de Rust | Notas |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | Ejecución de shell de un solo uso |
| `new Shell(options?)` | clase `Shell` | Sesión de shell persistente |
| `shell.run(options, onChunk?)` | `Shell::run` | Reutiliza la sesión en flujo de control keepalive |
| `shell.abort()` | `Shell::abort` | Aborta la ejecución activa de esa instancia de shell |
| `new PtySession()` | clase `PtySession` | Sesión PTY con estado |
| `pty.start(options, onChunk?)` | `PtySession::start` | Ejecución PTY interactiva |
| `pty.write(data)` | `PtySession::write` | Paso directo de entrada estándar sin procesar |
| `pty.resize(cols, rows)` | `PtySession::resize` | Dimensiones del terminal con límites aplicados |
| `pty.kill()` | `PtySession::kill` | Termina forzosamente el proceso hijo PTY activo |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | Terminación del árbol de procesos con los hijos primero |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | Listado recursivo de descendientes |

### Teclas

| API del envoltorio TS | Exportación N-API de Rust | Notas |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Coincidencia de codepoint+modificador Kitty |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Analizador de ID de tecla normalizado |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | Comprobación exacta del mapa de secuencias heredadas |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | Resultado de análisis estructurado de Kitty |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | Comparador de teclas de alto nivel |

## Notas sobre limpieza de sesiones abandonadas y finalización

- **Sesión de shell persistente**: si una ejecución se cancela/agota el tiempo de espera/falla/tiene un flujo de control que no es keepalive, Rust descarta explícitamente el estado de sesión interno. Las ejecuciones normales exitosas mantienen la sesión para su reutilización.
- **Sesión PTY**: `core` siempre se borra después de que `start()` finalice, incluidas las rutas de error.
- **No se expone ningún contrato de terminación explícito impulsado por finalizador de JS** por parte de los envoltorios; la limpieza está vinculada principalmente a las rutas de finalización/cancelación de ejecución. Los llamadores deben utilizar `timeoutMs`, `AbortSignal`, `shell.abort()` o `pty.kill()` para un desmontaje determinista.
