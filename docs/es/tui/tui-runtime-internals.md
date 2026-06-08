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

# Internos del runtime TUI

Este documento traza la ruta del runtime no relacionada con temas, desde la entrada del terminal hasta la salida renderizada en modo interactivo. Se enfoca en el comportamiento en `packages/tui` y su integración desde los controladores de `packages/coding-agent`.

## Capas del runtime y responsabilidades

- **Motor `packages/tui`**: ciclo de vida del terminal, normalización de stdin, enrutamiento de foco, programación de renderizado, pintado diferencial, composición de overlays, posicionamiento del cursor de hardware.
- **Modo interactivo de `packages/coding-agent`**: construye el árbol de componentes, enlaza callbacks del editor y mapas de teclas, reacciona a eventos de agente/sesión, y traduce el estado del dominio (streaming, ejecución de herramientas, reintentos, modo plan) en componentes de UI.

Regla de frontera: el motor TUI es agnóstico respecto a mensajes. Solo conoce `Component.render(width)`, `handleInput(data)`, foco y overlays. La semántica del agente permanece en los controladores interactivos.

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

`init()` conecta el árbol en ese orden, establece el foco en el editor, registra los manejadores de entrada vía `InputController`, inicia TUI y solicita un renderizado forzado.

Un renderizado forzado (`requestRender(true)`) reinicia las cachés de líneas previas y la contabilidad del cursor antes de repintar.

## Ciclo de vida del terminal y normalización de stdin

`ProcessTerminal.start()`:

1. Habilita el modo raw y el pegado con corchetes (bracketed paste).
2. Adjunta el manejador de redimensionamiento.
3. Crea un `StdinBuffer` para dividir fragmentos parciales de escape en secuencias completas.
4. Consulta el soporte del protocolo de teclado Kitty (`CSI ? u`), luego habilita las banderas del protocolo si es compatible.
5. En Windows, intenta la habilitación de entrada VT mediante banderas de modo de `kernel32`.

Comportamiento de `StdinBuffer`:

- Almacena en buffer secuencias de escape fragmentadas (CSI/OSC/DCS/APC/SS3).
- Emite `data` solo cuando una secuencia está completa o se vacía por timeout.
- Detecta el pegado con corchetes y emite un evento `paste` con el texto pegado en bruto.

Esto previene que fragmentos parciales de escape sean malinterpretados como pulsaciones de teclas normales.

## Enrutamiento de entrada y modelo de foco

Ruta de entrada:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Detalles del enrutamiento:

1. TUI ejecuta primero los listeners de entrada registrados (`addInputListener`), permitiendo comportamiento de consumo/transformación.
2. TUI maneja el atajo global de depuración (`shift+ctrl+d`) antes del despacho al componente.
3. Si el componente con foco pertenece a un overlay que ahora está oculto/invisible, TUI reasigna el foco al siguiente overlay visible o al foco guardado previo al overlay.
4. Los eventos de liberación de tecla se filtran a menos que el componente con foco establezca `wantsKeyRelease = true`.
5. Después del despacho, TUI programa un renderizado.

`setFocus()` también alterna `Focusable.focused`, que controla si los componentes emiten `CURSOR_MARKER` para el posicionamiento del cursor de hardware.

## División del manejo de teclas: editor vs controlador

`CustomEditor` intercepta primero los combos de alta prioridad (escape, ctrl-c/d/z, ctrl-v, variantes de ctrl-p, ctrl-t, alt-arriba, teclas personalizadas de extensiones) y delega el resto al comportamiento base de `Editor` (edición de texto, historial, autocompletado, movimiento del cursor).

`InputController.setupKeyHandlers()` luego enlaza los callbacks del editor a las acciones del modo:

- cancelación / salidas de modo con `Escape`
- apagado con doble `Ctrl+C` o `Ctrl+D` con editor vacío
- suspensión/reanudación con `Ctrl+Z`
- comandos de barra (slash) y atajos de selector
- alternancias de seguimiento/desencolado y alternancias de expansión

Esto mantiene el análisis de teclas/mecánicas del editor en `packages/tui` y la semántica del modo en los controladores de coding-agent.

## Bucle de renderizado y estrategia de diferenciación

`TUI.requestRender()` tiene debounce a un renderizado por tick usando `process.nextTick`. Múltiples cambios de estado en el mismo turno se fusionan.

Pipeline de `#doRender()`:

1. Renderiza el árbol de componentes raíz a `newLines`.
2. Compone los overlays visibles (si los hay).
3. Extrae y elimina `CURSOR_MARKER` de las líneas visibles del viewport.
4. Añade sufijos de reinicio de segmento para líneas que no son imágenes.
5. Elige repintado completo vs parche diferencial:
   - primer frame
   - cambio de ancho
   - reducción con `clearOnShrink` habilitado y sin overlays
   - ediciones por encima del viewport previo
6. Para actualizaciones diferenciales, parchea solo el rango de líneas cambiadas y limpia líneas finales obsoletas cuando es necesario.
7. Reposiciona el cursor de hardware para soporte de IME.

Las escrituras de renderizado usan el modo de salida sincronizada (`CSI ? 2026 h/l`) para reducir el parpadeo/desgarro.

## Restricciones de seguridad del renderizado

Verificaciones de seguridad críticas en `TUI`:

- Las líneas renderizadas que no son imágenes no deben exceder el ancho del terminal; el desbordamiento lanza una excepción y escribe diagnósticos de fallo.
- La composición de overlays incluye truncamiento defensivo y verificación de ancho post-composición.
- Los cambios de ancho fuerzan un redibujado completo porque la semántica de ajuste de línea cambia.
- La posición del cursor se limita antes del movimiento.

Estas restricciones son de aplicación en tiempo de ejecución, no solo convenciones.

## Manejo de redimensionamiento

Los eventos de redimensionamiento son dirigidos por eventos desde `ProcessTerminal` a `TUI.requestRender()`.

Efectos:

- Cualquier cambio de ancho dispara un redibujado completo.
- El seguimiento de viewport/top (`#previousViewportTop`, `#maxLinesRendered`) evita cálculos inválidos de cursor relativo cuando el contenido o el tamaño del terminal cambian.
- La visibilidad del overlay puede depender de las dimensiones del terminal (`OverlayOptions.visible`); el foco se corrige cuando los overlays dejan de ser visibles tras el redimensionamiento.

## Streaming y actualizaciones incrementales de UI

`EventController` se suscribe a `AgentSessionEvent` y actualiza la UI incrementalmente:

- `agent_start`: inicia el loader en `statusContainer`.
- `message_start` asistente: crea `streamingComponent` y lo monta.
- `message_update`: actualiza el contenido del asistente en streaming; crea/actualiza componentes de ejecución de herramientas conforme aparecen las llamadas a herramientas.
- `tool_execution_update/end`: actualiza los componentes de resultado de herramientas y el estado de completitud.
- `message_end`: finaliza el stream del asistente, maneja anotaciones de aborto/error, marca los argumentos pendientes de herramientas como completos en parada normal.
- `agent_end`: detiene los loaders, limpia el estado transitorio de stream, ejecuta el cambio de modelo diferido, emite notificación de completitud si está en segundo plano.

La agrupación de herramientas de lectura es intencionalmente con estado (`#lastReadGroup`) para fusionar llamadas consecutivas de herramientas de lectura en un bloque visual hasta que ocurra una interrupción de no-lectura.

## Orquestación de estado y loaders

Responsabilidades del carril de estado:

- `statusContainer` contiene loaders transitorios (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` renderiza indicadores persistentes de estado/hooks/plan y controla las actualizaciones del borde superior del editor.

Comportamiento del loader:

- `Loader` se actualiza cada 80ms vía intervalo y solicita renderizado en cada frame.
- Los manejadores de escape se sobrescriben temporalmente durante la auto-compactación y el auto-reintento para cancelar esas operaciones.
- En las rutas de fin/cancelación, los controladores restauran los manejadores de escape previos y detienen/limpian los componentes de loader.

## Transiciones de modo y segundo plano

### Modos de entrada Bash/Python

Los prefijos del texto de entrada alternan las banderas de modo del borde del editor:

- `!` -> modo bash
- `$` (prefijo que no es template literal) -> modo python

Escape sale del modo inactivo limpiando el texto del editor y restaurando el color del borde; cuando la ejecución está activa, escape aborta la tarea en ejecución en su lugar.

### Modo plan

`InteractiveMode` rastrea las banderas del modo plan, el estado de la línea de estado, las herramientas activas y el cambio de modelo. Entrar/salir actualiza las entradas de modo de sesión y el estado de UI/estado, incluyendo el cambio de modelo diferido si el streaming está activo.

### Suspensión/reanudación (`Ctrl+Z`)

`InputController.handleCtrlZ()`:

1. Registra un manejador `SIGCONT` de un solo uso para reiniciar TUI y forzar el renderizado.
2. Detiene TUI antes de suspender.
3. Envía `SIGTSTP` al grupo de procesos.

### Modo segundo plano (`/background` o `/bg`)

`handleBackgroundCommand()`:

- Rechaza cuando está inactivo.
- Cambia el contexto de UI de herramientas a no interactivo (`hasUI=false`) para que las herramientas de UI interactiva fallen rápidamente.
- Detiene loaders/línea de estado y cancela la suscripción del manejador de eventos en primer plano.
- Suscribe el manejador de eventos en segundo plano (principalmente espera `agent_end`).
- Detiene TUI y envía `SIGTSTP` (ruta de control de trabajos POSIX).

Al recibir `agent_end` en segundo plano sin trabajo en cola, el controlador envía una notificación de completitud y se apaga.

## Rutas de cancelación

Entradas principales de cancelación:

- `Escape` durante el loader de stream activo: restaura los mensajes en cola al editor y aborta al agente.
- `Escape` durante la ejecución de bash/python: aborta el comando en ejecución.
- `Escape` durante auto-compactación/reintento: invoca métodos de aborto dedicados a través de manejadores de escape temporales.
- `Ctrl+C` presión simple: limpia el editor; doble presión dentro de 500ms: apagado.

La cancelación es condicional al estado; la misma tecla puede significar abortar, salir del modo, disparar un selector o no hacer nada dependiendo del estado del runtime.

## Comportamiento dirigido por eventos vs con throttle

Actualizaciones dirigidas por eventos:

- Eventos de sesión del agente (`EventController`)
- Callbacks de entrada de teclas (`InputController`)
- Callback de redimensionamiento del terminal
- Observadores de tema/rama en `InteractiveMode`

Rutas con throttle/debounce:

- El renderizado de TUI tiene debounce por tick (fusión de `requestRender`).
- La animación del loader es de intervalo fijo (80ms), cada frame solicita renderizado.
- Las actualizaciones de autocompletado del editor (dentro de `Editor`) usan temporizadores de debounce, reduciendo la recomputación excesiva durante la escritura.

Por lo tanto, el runtime mezcla transiciones de estado dirigidas por eventos con una cadencia de renderizado acotada para mantener la interactividad responsiva sin tormentas de repintado.
