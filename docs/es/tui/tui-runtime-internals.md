---
title: TUI Runtime Internals
description: >-
  Internos del runtime de la interfaz de terminal que cubren el pipeline de
  renderizado, el manejo de entrada y la gestión de estado.
sidebar:
  order: 2
  label: Internos del runtime
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# Internos del runtime de la TUI

Este documento mapea la ruta del runtime no temática desde la entrada del terminal hasta la salida renderizada en modo interactivo. Se enfoca en el comportamiento en `packages/tui` y su integración desde los controladores de `packages/coding-agent`.

## Capas del runtime y propiedad

- **Motor `packages/tui`**: ciclo de vida del terminal, normalización de stdin, enrutamiento de foco, programación de renderizado, pintado diferencial, composición de overlays, colocación del cursor de hardware.
- **Modo interactivo de `packages/coding-agent`**: construye el árbol de componentes, vincula callbacks del editor y mapas de teclas, reacciona a eventos de agente/sesión, y traduce el estado del dominio (streaming, ejecución de herramientas, reintentos, modo plan) en componentes de UI.

Regla de frontera: el motor TUI es agnóstico a los mensajes. Solo conoce `Component.render(width)`, `handleInput(data)`, foco y overlays. La semántica del agente permanece en los controladores interactivos.

## Archivos de implementación

- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/components/custom-editor.ts`](../../packages/coding-agent/src/modes/components/custom-editor.ts)
- [`../../tui/src/tui.ts`](../../packages/tui/src/tui.ts)
- [`../../tui/src/terminal.ts`](../../packages/tui/src/terminal.ts)
- [`../../tui/src/editor-component.ts`](../../packages/tui/src/editor-component.ts)
- [`../../tui/src/stdin-buffer.ts`](../../packages/tui/src/stdin-buffer.ts)
- [`../../tui/src/components/loader.ts`](../../packages/tui/src/components/loader.ts)

## Arranque y ensamblaje del árbol de componentes

`InteractiveMode` construye `TUI(new ProcessTerminal(), showHardwareCursor)` y crea contenedores persistentes:

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (contiene `CustomEditor`)

`init()` conecta el árbol en ese orden, enfoca el editor, registra manejadores de entrada a través de `InputController`, inicia la TUI y solicita un renderizado forzado.

Un renderizado forzado (`requestRender(true)`) reinicia las cachés de líneas previas y la contabilidad del cursor antes de repintar.

## Ciclo de vida del terminal y normalización de stdin

`ProcessTerminal.start()`:

1. Habilita el modo raw y el pegado con corchetes (bracketed paste).
2. Adjunta el manejador de redimensionamiento.
3. Crea un `StdinBuffer` para dividir fragmentos parciales de escape en secuencias completas.
4. Consulta el soporte del protocolo de teclado Kitty (`CSI ? u`), luego habilita las flags del protocolo si es compatible.
5. En Windows, intenta habilitar la entrada VT a través de flags de modo de `kernel32`.

Comportamiento de `StdinBuffer`:

- Almacena en búfer secuencias de escape fragmentadas (CSI/OSC/DCS/APC/SS3).
- Emite `data` solo cuando una secuencia está completa o se vacía por timeout.
- Detecta el pegado con corchetes y emite un evento `paste` con el texto pegado en crudo.

Esto evita que fragmentos parciales de escape sean malinterpretados como pulsaciones de tecla normales.

## Enrutamiento de entrada y modelo de foco

Ruta de entrada:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Detalles del enrutamiento:

1. La TUI ejecuta primero los listeners de entrada registrados (`addInputListener`), permitiendo comportamiento de consumo/transformación.
2. La TUI maneja el atajo global de depuración (`shift+ctrl+d`) antes del despacho al componente.
3. Si el componente enfocado pertenece a un overlay que ahora está oculto/invisible, la TUI reasigna el foco al siguiente overlay visible o al foco pre-overlay guardado.
4. Los eventos de liberación de tecla se filtran a menos que el componente enfocado establezca `wantsKeyRelease = true`.
5. Después del despacho, la TUI programa un renderizado.

`setFocus()` también alterna `Focusable.focused`, lo que controla si los componentes emiten `CURSOR_MARKER` para la colocación del cursor de hardware.

## División del manejo de teclas: editor vs controlador

`CustomEditor` intercepta primero las combinaciones de alta prioridad (escape, ctrl-c/d/z, ctrl-v, variantes de ctrl-p, ctrl-t, alt-up, teclas personalizadas de extensiones) y delega el resto al comportamiento base de `Editor` (edición de texto, historial, autocompletado, movimiento del cursor).

`InputController.setupKeyHandlers()` luego vincula los callbacks del editor a las acciones del modo:

- cancelación / salidas de modo con `Escape`
- apagado con doble `Ctrl+C` o `Ctrl+D` con editor vacío
- suspender/reanudar con `Ctrl+Z`
- comandos slash y atajos de selectores
- alternadores de seguimiento/desencolar y alternadores de expansión

Esto mantiene el análisis de teclas/mecánicas del editor en `packages/tui` y la semántica del modo en los controladores de coding-agent.

## Bucle de renderizado y estrategia de diferenciación

`TUI.requestRender()` está debounceado a un renderizado por tick usando `process.nextTick`. Múltiples cambios de estado en el mismo turno se fusionan.

Pipeline de `#doRender()`:

1. Renderiza el árbol de componentes raíz a `newLines`.
2. Compone los overlays visibles (si los hay).
3. Extrae y elimina `CURSOR_MARKER` de las líneas visibles del viewport.
4. Agrega sufijos de reinicio de segmento para líneas que no son imágenes.
5. Elige repintado completo vs parche diferencial:
   - primer frame
   - cambio de ancho
   - reducción con `clearOnShrink` habilitado y sin overlays
   - ediciones por encima del viewport previo
6. Para actualizaciones diferenciales, parchea solo el rango de líneas modificadas y limpia líneas finales obsoletas cuando es necesario.
7. Reposiciona el cursor de hardware para soporte de IME.

Las escrituras de renderizado usan el modo de salida sincronizada (`CSI ? 2026 h/l`) para reducir el parpadeo/tearing.

## Restricciones de seguridad del renderizado

Verificaciones críticas de seguridad en `TUI`:

- Las líneas renderizadas que no son imágenes no deben exceder el ancho del terminal; el desbordamiento lanza una excepción y escribe diagnósticos de fallo.
- La composición de overlays incluye truncamiento defensivo y verificación de ancho post-composición.
- Los cambios de ancho fuerzan un redibujado completo porque la semántica de ajuste de línea cambia.
- La posición del cursor se limita antes del movimiento.

Estas restricciones son enforcement en tiempo de ejecución, no solo convenciones.

## Manejo de redimensionamiento

Los eventos de redimensionamiento son dirigidos por eventos desde `ProcessTerminal` hacia `TUI.requestRender()`.

Efectos:

- Cualquier cambio de ancho desencadena un redibujado completo.
- El seguimiento del viewport/top (`#previousViewportTop`, `#maxLinesRendered`) evita cálculos relativos inválidos del cursor cuando el contenido o el tamaño del terminal cambian.
- La visibilidad de los overlays puede depender de las dimensiones del terminal (`OverlayOptions.visible`); el foco se corrige cuando los overlays dejan de ser visibles tras el redimensionamiento.

## Streaming y actualizaciones incrementales de UI

`EventController` se suscribe a `AgentSessionEvent` y actualiza la UI incrementalmente:

- `agent_start`: inicia el loader en `statusContainer`.
- `message_start` asistente: crea `streamingComponent` y lo monta.
- `message_update`: actualiza el contenido del asistente en streaming; crea/actualiza componentes de ejecución de herramientas conforme aparecen las llamadas a herramientas.
- `tool_execution_update/end`: actualiza los componentes de resultados de herramientas y el estado de completación.
- `message_end`: finaliza el stream del asistente, maneja anotaciones de abortado/error, marca los argumentos de herramientas pendientes como completos en parada normal.
- `agent_end`: detiene los loaders, limpia el estado transitorio del stream, vacía el cambio de modelo diferido, emite notificación de completación si está en segundo plano.

La agrupación de herramientas de lectura es intencionalmente con estado (`#lastReadGroup`) para fusionar llamadas consecutivas de herramientas de lectura en un bloque visual hasta que ocurra una interrupción de no-lectura.

## Orquestación de estado y loaders

Propiedad del carril de estado:

- `statusContainer` contiene loaders transitorios (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` renderiza indicadores persistentes de estado/hooks/plan y dirige las actualizaciones del borde superior del editor.

Comportamiento del loader:

- `Loader` se actualiza cada 80ms a través de un intervalo y solicita renderizado en cada frame.
- Los manejadores de escape se sobrescriben temporalmente durante la auto-compactación y el auto-reintento para cancelar esas operaciones.
- En las rutas de fin/cancelación, los controladores restauran los manejadores de escape previos y detienen/limpian los componentes de loader.

## Transiciones de modo y segundo plano

### Modos de entrada Bash/Python

Los prefijos del texto de entrada alternan las flags del modo de borde del editor:

- `!` -> modo bash
- `$` (prefijo que no es template literal) -> modo python

Escape sale del modo inactivo limpiando el texto del editor y restaurando el color del borde; cuando la ejecución está activa, escape aborta la tarea en ejecución en su lugar.

### Modo plan

`InteractiveMode` rastrea las flags del modo plan, el estado de la línea de estado, las herramientas activas y el cambio de modelo. Entrar/salir actualiza las entradas del modo de sesión y el estado de UI/estado, incluyendo el cambio de modelo diferido si el streaming está activo.

### Suspender/reanudar (`Ctrl+Z`)

`InputController.handleCtrlZ()`:

1. Registra un manejador de un solo uso de `SIGCONT` para reiniciar la TUI y forzar el renderizado.
2. Detiene la TUI antes de suspender.
3. Envía `SIGTSTP` al grupo de procesos.

### Modo segundo plano (`/background` o `/bg`)

`handleBackgroundCommand()`:

- Rechaza cuando está inactivo.
- Cambia el contexto de UI de herramientas a no-interactivo (`hasUI=false`) para que las herramientas de UI interactiva fallen rápidamente.
- Detiene loaders/línea de estado y cancela la suscripción del manejador de eventos de primer plano.
- Suscribe el manejador de eventos de segundo plano (principalmente espera `agent_end`).
- Detiene la TUI y envía `SIGTSTP` (ruta de control de trabajos POSIX).

En `agent_end` en segundo plano sin trabajo en cola, el controlador envía una notificación de completación y se apaga.

## Rutas de cancelación

Entradas principales de cancelación:

- `Escape` durante el loader de stream activo: restaura los mensajes en cola al editor y aborta al agente.
- `Escape` durante la ejecución de bash/python: aborta el comando en ejecución.
- `Escape` durante auto-compactación/reintento: invoca métodos de aborto dedicados a través de manejadores de escape temporales.
- `Ctrl+C` pulsación simple: limpia el editor; doble pulsación dentro de 500ms: apagado.

La cancelación es condicional al estado; la misma tecla puede significar abortar, salir del modo, activar selector o no-op dependiendo del estado del runtime.

## Comportamiento dirigido por eventos vs throttled

Actualizaciones dirigidas por eventos:

- Eventos de sesión del agente (`EventController`)
- Callbacks de entrada de teclas (`InputController`)
- Callback de redimensionamiento del terminal
- Watchers de tema/rama en `InteractiveMode`

Rutas throttled/debounced:

- El renderizado de la TUI está debounceado por tick (fusión de `requestRender`).
- La animación del loader es de intervalo fijo (80ms), cada frame solicita renderizado.
- Las actualizaciones de autocompletado del editor (dentro de `Editor`) usan temporizadores de debounce, reduciendo el exceso de recómputo durante la escritura.

Por lo tanto, el runtime mezcla transiciones de estado dirigidas por eventos con una cadencia de renderizado acotada para mantener la interactividad responsiva sin tormentas de repintado.
