---
title: Cambio de sesión y listado de sesiones recientes
description: >-
  Mecánicas de cambio de sesión y listado de sesiones recientes con búsqueda y
  filtrado.
sidebar:
  order: 4
  label: Cambio y recientes
i18n:
  sourceHash: aae56130b508
  translator: machine
---

# Cambio de sesión y listado de sesiones recientes

Este documento describe cómo coding-agent descubre sesiones recientes, resuelve objetivos de `--resume`, presenta selectores de sesión y cambia la sesión activa en tiempo de ejecución.

Se centra en el comportamiento de la implementación actual, incluyendo rutas de respaldo y advertencias.

## Archivos de implementación

- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/cli/session-picker.ts`](../../packages/coding-agent/src/cli/session-picker.ts)
- [`../src/modes/components/session-selector.ts`](../../packages/coding-agent/src/modes/components/session-selector.ts)
- [`../src/modes/controllers/selector-controller.ts`](../../packages/coding-agent/src/modes/controllers/selector-controller.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)

## Descubrimiento de sesiones recientes

### Alcance del directorio

`SessionManager` almacena sesiones bajo un directorio con alcance al cwd por defecto:

- `~/.xcsh/agent/sessions/--<cwd-encoded>--/*.jsonl`

`SessionManager.list(cwd, sessionDir?)` lee solo ese directorio a menos que se proporcione un `sessionDir` explícito.

### Dos rutas de listado con diferentes cargas útiles

Existen dos pipelines de listado diferentes:

1. `getRecentSessions(sessionDir, limit)` (vista de bienvenida/resumen)
   - Lee solo un prefijo de 4KB (`readTextPrefix(..., 4096)`) de cada archivo.
   - Analiza el encabezado + vista previa del texto más antiguo del usuario.
   - Devuelve `RecentSessionInfo` ligero con getters lazy para `name` y `timeAgo`.
   - Ordena por `mtime` del archivo de forma descendente.

2. `SessionManager.list(...)` / `SessionManager.listAll()` (selectores de reanudación y coincidencia de ID)
   - Lee los archivos de sesión completos.
   - Construye objetos `SessionInfo` (`id`, `cwd`, `title`, `messageCount`, `firstMessage`, `allMessagesText`, marcas de tiempo).
   - Descarta sesiones con cero entradas de `message`.
   - Ordena por `modified` de forma descendente.

### Comportamiento de respaldo de metadatos

Para resúmenes recientes (`RecentSessionInfo`):

- preferencia de nombre para mostrar: `header.title` -> primer prompt del usuario -> `header.id` -> nombre del archivo
- el nombre se trunca a 40 caracteres para visualizaciones compactas
- los caracteres de control/saltos de línea se eliminan/sanitizan de los nombres derivados del título

Para entradas de lista `SessionInfo`:

- `title` es `header.title` o el último `shortSummary` de compactación
- `firstMessage` es el texto del primer mensaje del usuario o `"(no messages)"`

## Resolución de `--continue` y preferencia de breadcrumb del terminal

`SessionManager.continueRecent(cwd, sessionDir?)` resuelve el objetivo en este orden:

1. Leer el breadcrumb con alcance al terminal (`~/.xcsh/agent/terminal-sessions/<terminal-id>`)
2. Validar el breadcrumb:
   - el terminal actual puede ser identificado
   - el cwd del breadcrumb coincide con el cwd actual (comparación de rutas resueltas)
   - el archivo referenciado aún existe
3. Si el breadcrumb es inválido/no existe, recurrir al archivo más reciente por mtime en el directorio de sesiones (`findMostRecentSession`)
4. Si no se encuentra ninguno, crear una nueva sesión

La derivación del ID del terminal prefiere la ruta TTY y recurre a identificadores basados en variables de entorno (`KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION`).

Las escrituras de breadcrumb son de mejor esfuerzo y no fatales.

## Resolución del objetivo de reanudación en tiempo de inicio (`main.ts`)

### `--resume <value>`

`createSessionManager(...)` maneja `--resume` con valor de cadena en dos modos:

1. Valor tipo ruta (contiene `/`, `\\`, o termina con `.jsonl`)
   - `SessionManager.open(sessionArg, parsed.sessionDir)` directo

2. Valor de prefijo de ID
   - busca coincidencia en `SessionManager.list(cwd, sessionDir)` mediante `id.startsWith(sessionArg)`
   - si no hay coincidencia local y `sessionDir` no está forzado, intenta `SessionManager.listAll()`
   - se usa la primera coincidencia (sin prompt de ambigüedad)

Comportamiento de coincidencia entre proyectos:

- si el cwd de la sesión coincidente difiere del cwd actual, el CLI pregunta si bifurcar al proyecto actual
- sí -> `SessionManager.forkFrom(...)`
- no -> lanza error (`Session "..." is in another project (...)`)

Sin coincidencia -> lanza error (`Session "..." not found.`).

### `--resume` (sin valor)

Se maneja después de la construcción inicial del session-manager:

1. listar sesiones locales con `SessionManager.list(cwd, parsed.sessionDir)`
2. si está vacío: imprimir `No sessions found` y salir tempranamente
3. abrir selector TUI (`selectSession`)
4. si se cancela: imprimir `No session selected` y salir tempranamente
5. si se selecciona: `SessionManager.open(selectedPath)`

### `--continue`

Usa `SessionManager.continueRecent(...)` directamente (comportamiento de breadcrumb primero descrito anteriormente).

## Detalles internos de selección por selector

## Selector CLI (`src/cli/session-picker.ts`)

`selectSession(sessions)` crea una TUI independiente con `SessionSelectorComponent` y se resuelve exactamente una vez:

- selección -> resuelve con la ruta seleccionada
- cancelar (Esc) -> resuelve con `null`
- salida forzada (ruta Ctrl+C) -> detiene la TUI y `process.exit(0)`

## Selector interactivo dentro de sesión (`SelectorController.showSessionSelector`)

Flujo:

1. obtener sesiones del directorio de sesión actual vía `SessionManager.list(currentCwd, currentSessionDir)`
2. montar `SessionSelectorComponent` en el área del editor usando `showSelector(...)`
3. callbacks:
   - seleccionar -> cerrar selector y llamar a `handleResumeSession(sessionPath)`
   - cancelar -> restaurar editor y rerenderizar
   - salir -> `ctx.shutdown()`

## Comportamiento del componente selector de sesión

`SessionList` soporta:

- navegación con flechas/página
- Enter para seleccionar
- Esc para cancelar
- Ctrl+C para salir
- búsqueda difusa a través de id/título/cwd/primer mensaje/todos los mensajes/ruta de la sesión

Comportamiento de renderizado con lista vacía:

- renderiza un mensaje en lugar de fallar
- Enter en lista vacía no hace nada (sin callback)
- Esc/Ctrl+C siguen funcionando

Advertencia: El texto de la UI dice `Press Tab to view all`, pero este componente actualmente no tiene manejador de Tab y el cableado actual solo lista sesiones del alcance actual.

## Ejecución del cambio en tiempo de ejecución (`AgentSession.switchSession`)

`switchSession(sessionPath)` es la ruta principal de cambio dentro del proceso.

Ciclo de vida/transición de estado:

1. capturar `previousSessionFile`
2. emitir evento hook `session_before_switch` (`reason: "resume"`, cancelable)
3. si se cancela -> retorna `false` sin cambio
4. desconectar del flujo de eventos del agente actual
5. abortar generación/flujo de herramientas activo
6. limpiar buffers de mensajes de steering/seguimiento/siguiente turno en cola
7. vaciar el escritor de sesión (`sessionManager.flush()`) para persistir escrituras pendientes
8. `sessionManager.setSessionFile(sessionPath)`
   - actualiza el puntero del archivo de sesión
   - escribe el breadcrumb del terminal
   - carga entradas / migra / resuelve blobs / reindexa
   - si los datos del archivo están ausentes/son inválidos: inicializa una nueva sesión en esa ruta y reescribe el encabezado
9. actualizar `agent.sessionId`
10. reconstruir contexto vía `buildSessionContext()`
11. emitir evento hook `session_switch` (`reason: "resume"`, `previousSessionFile`)
12. reemplazar mensajes del agente con el contexto reconstruido
13. restaurar modelo por defecto desde `sessionContext.models.default` si está disponible y presente en el registro de modelos
14. restaurar nivel de pensamiento:
    - si la rama ya tiene `thinking_level_change`, aplicar el nivel de sesión guardado
    - de lo contrario, derivar el nivel de pensamiento por defecto de la configuración, ajustar a la capacidad del modelo, establecerlo y agregar una nueva entrada `thinking_level_change`
15. reconectar listeners del agente y retornar `true`

## Reconstrucción del estado de la UI después del cambio interactivo

`SelectorController.handleResumeSession` realiza el reinicio de la UI alrededor de `switchSession`:

- detener animación de carga
- limpiar contenedor de estado
- limpiar UI de mensaje pendiente y mapa de herramientas pendientes
- reiniciar componente de streaming/referencias de mensaje
- llamar a `session.switchSession(...)`
- limpiar contenedor del chat y rerenderizar desde el contexto de sesión (`renderInitialMessages`)
- recargar todos desde los artefactos de la nueva sesión
- mostrar `Resumed session`

Así que el estado visible de conversación/todos se reconstruye desde el nuevo archivo de sesión.

## Reanudación al inicio vs cambio dentro de sesión

### Reanudación al inicio (`--continue`, `--resume`, apertura directa)

- El archivo de sesión se elige antes de `createAgentSession(...)`.
- `sdk.ts` construye `existingSession = sessionManager.buildSessionContext()`.
- Los mensajes del agente se restauran una vez durante la creación de la sesión.
- El modelo/pensamiento se seleccionan durante la creación (incluyendo lógica de restauración/respaldo).
- El modo interactivo luego ejecuta `#restoreModeFromSession()` para re-entrar al estado de modo persistido (actualmente plan/plan_paused).

### Cambio dentro de sesión (ruta del selector estilo `/resume`)

- Usa `AgentSession.switchSession(...)` en un `AgentSession` ya en ejecución.
- Los mensajes/modelo/pensamiento se reconstruyen inmediatamente en su lugar.
- Se emiten eventos hook `session_before_switch`/`session_switch`.
- Se refrescan el chat/todos de la UI.
- No se realiza una llamada dedicada de restauración de modo post-cambio en el flujo del selector; el comportamiento de re-entrada al modo no es simétrico con `#restoreModeFromSession()` del inicio.

## Comportamiento ante fallos y casos límite

### Rutas de cancelación

- Cancelación del selector CLI -> retorna `null`, el llamador imprime `No session selected`, el proceso sale tempranamente.
- Cancelación del selector interactivo -> se restaura el editor, sin cambio de sesión.
- Cancelación por hook (`session_before_switch`) -> `switchSession()` retorna `false`.

### Rutas con lista vacía

- CLI `--resume` (sin valor): lista vacía imprime `No sessions found` y sale.
- Selector interactivo: lista vacía renderiza mensaje y permanece cancelable.

### Archivo de sesión objetivo ausente/inválido

Al abrir/cambiar a una ruta específica (`setSessionFile`):

- ENOENT -> tratado como vacío -> nueva sesión inicializada en esa ruta exacta y persistida.
- encabezado malformado/inválido (o entradas parseadas efectivamente ilegibles) -> tratado como vacío -> nueva sesión inicializada y persistida.

Esto es comportamiento de recuperación, no fallo duro.

### Fallos duros

El cambio/apertura aún puede lanzar excepciones en fallos de E/S reales (errores de permisos, fallos de reescritura, etc.), que se propagan a los llamadores.

### Advertencias sobre coincidencia de prefijo de ID

- La coincidencia de ID usa `startsWith` y toma la primera coincidencia en la lista ordenada.
- No hay UI de ambigüedad si múltiples sesiones comparten prefijo.
- `SessionManager.list(...)` excluye sesiones con cero mensajes, por lo que esas sesiones no son reanudables vía coincidencia de ID/selector de lista.
