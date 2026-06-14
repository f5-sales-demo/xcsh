---
title: Componentes internos del runtime TUI
description: >-
  Componentes internos del runtime de la interfaz de usuario de terminal, que
  cubren la canalización de renderizado, el manejo de entrada y la gestión de
  estado.
sidebar:
  order: 2
  label: Componentes internos del runtime
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# Componentes internos del runtime TUI

Este documento describe la ruta de runtime sin tema desde la entrada de terminal hasta la salida renderizada en modo interactivo. Se centra en el comportamiento de `packages/tui` y su integración desde los controladores de `packages/coding-agent`.

## Capas del runtime y responsabilidades

- **Motor `packages/tui`**: ciclo de vida del terminal, normalización de stdin, enrutamiento de foco, programación de renderizado, pintura diferencial, composición de superposiciones, posicionamiento del cursor de hardware.
- **Modo interactivo de `packages/coding-agent`**: construye el árbol de Componentes, vincula callbacks del editor y keymaps, reacciona a eventos del agente/sesión y traduce el estado del dominio (streaming, ejecución de herramientas, reintentos, modo plan) en Componentes de UI.

Regla de límite: el motor TUI es agnóstico respecto a los mensajes. Solo conoce `Component.render(width)`, `handleInput(data)`, foco y superposiciones. La semántica del agente permanece en los controladores interactivos.

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

## Inicio y ensamblaje del árbol de Componentes

`InteractiveMode` construye `TUI(new ProcessTerminal(), showHardwareCursor)` y crea contenedores persistentes:

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (contiene `CustomEditor`)

`init()` conecta el árbol en ese orden, enfoca el editor, registra manejadores de entrada mediante `InputController`, inicia el TUI y solicita un renderizado forzado.

Un renderizado forzado (`requestRender(true)`) restablece las cachés de líneas previas y el seguimiento del cursor antes de repintar.

## Ciclo de vida del terminal y normalización de stdin

`ProcessTerminal.start()`:

1. Habilita el modo raw y el pegado entre corchetes.
2. Adjunta el manejador de redimensionamiento.
3. Crea un `StdinBuffer` para dividir fragmentos de escape parciales en secuencias completas.
4. Consulta la compatibilidad con el protocolo de teclado Kitty (`CSI ? u`) y habilita los indicadores de protocolo si es compatible.
5. En Windows, intenta la habilitación de entrada VT mediante indicadores de modo de `kernel32`.

Comportamiento de `StdinBuffer`:

- Almacena en búfer secuencias de escape fragmentadas (CSI/OSC/DCS/APC/SS3).
- Emite `data` solo cuando una secuencia está completa o se vacía por tiempo de espera.
- Detecta el pegado entre corchetes y emite un evento `paste` con el texto pegado sin procesar.

Esto evita que los fragmentos de escape parciales sean malinterpretados como pulsaciones de teclas normales.

## Enrutamiento de entrada y modelo de foco

Ruta de entrada:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Detalles de enrutamiento:

1. El TUI ejecuta primero los listeners de entrada registrados (`addInputListener`), permitiendo el comportamiento de consumo/transformación.
2. El TUI maneja el atajo de depuración global (`shift+ctrl+d`) antes del despacho al componente.
3. Si el componente enfocado pertenece a una superposición que ahora está oculta/invisible, el TUI reasigna el foco a la siguiente superposición visible o al foco guardado anterior a la superposición.
4. Los eventos de liberación de teclas se filtran a menos que el componente enfocado establezca `wantsKeyRelease = true`.
5. Después del despacho, el TUI programa el renderizado.

`setFocus()` también activa/desactiva `Focusable.focused`, que controla si los Componentes emiten `CURSOR_MARKER` para el posicionamiento del cursor de hardware.

## División del manejo de teclas: editor vs controlador

`CustomEditor` intercepta primero las combinaciones de alta prioridad (escape, ctrl-c/d/z, ctrl-v, variantes de ctrl-p, ctrl-t, alt-arriba, teclas personalizadas de extensión) y delega el resto al comportamiento base de `Editor` (edición de texto, historial, autocompletado, movimiento del cursor).

`InputController.setupKeyHandlers()` luego vincula los callbacks del editor a las acciones del modo:

- cancelación / salidas de modo en `Escape`
- apagado con doble `Ctrl+C` o `Ctrl+D` con editor vacío
- suspensión/reanudación en `Ctrl+Z`
- comandos slash y atajos de selector
- alternadores de seguimiento/desencolar y alternadores de expansión

Esto mantiene el análisis de teclas/mecánicas del editor en `packages/tui` y la semántica del modo en los controladores del coding-agent.

## Bucle de renderizado y estrategia de diferenciación

`TUI.requestRender()` tiene antirrebote para un renderizado por tick usando `process.nextTick`. Múltiples cambios de estado en el mismo turno se fusionan.

Canalización de `#doRender()`:

1. Renderizar el árbol de Componentes raíz en `newLines`.
2. Componer superposiciones visibles (si las hay).
3. Extraer y eliminar `CURSOR_MARKER` de las líneas del viewport visible.
4. Añadir sufijos de restablecimiento de segmento para las líneas sin imágenes.
5. Elegir entre repintado completo o parche diferencial:
   - primer fotograma
   - cambio de ancho
   - reducción con `clearOnShrink` habilitado y sin superposiciones
   - ediciones por encima del viewport anterior
6. Para actualizaciones diferenciales, parchear solo el rango de líneas cambiado y limpiar las líneas finales obsoletas cuando sea necesario.
7. Reposicionar el cursor de hardware para compatibilidad con IME.

Las escrituras de renderizado utilizan el modo de salida sincronizada (`CSI ? 2026 h/l`) para reducir el parpadeo/desgarramiento.

## Restricciones de seguridad del renderizado

Comprobaciones de seguridad críticas en `TUI`:

- Las líneas renderizadas sin imágenes no deben exceder el ancho del terminal; el desbordamiento lanza una excepción y escribe diagnósticos de fallo.
- La composición de superposiciones incluye truncamiento defensivo y verificación de ancho posterior a la composición.
- Los cambios de ancho fuerzan un redibujado completo porque cambia la semántica de ajuste de línea.
- La posición del cursor se limita antes del movimiento.

Estas restricciones son aplicación en tiempo de ejecución, no solo convenciones.

## Manejo del redimensionamiento

Los eventos de redimensionamiento se manejan mediante eventos desde `ProcessTerminal` hasta `TUI.requestRender()`.

Efectos:

- Cualquier cambio de ancho activa un redibujado completo.
- El seguimiento del viewport/parte superior (`#previousViewportTop`, `#maxLinesRendered`) evita cálculos de cursor relativos inválidos cuando cambia el contenido o el tamaño del terminal.
- La visibilidad de las superposiciones puede depender de las dimensiones del terminal (`OverlayOptions.visible`); el foco se corrige cuando las superposiciones dejan de ser visibles después del redimensionamiento.

## Streaming y actualizaciones de UI incrementales

`EventController` se suscribe a `AgentSessionEvent` y actualiza la UI de forma incremental:

- `agent_start`: inicia el cargador en `statusContainer`.
- `message_start` asistente: crea `streamingComponent` y lo monta.
- `message_update`: actualiza el contenido del asistente en streaming; crea/actualiza Componentes de ejecución de herramientas a medida que aparecen las llamadas a herramientas.
- `tool_execution_update/end`: actualiza los Componentes de resultado de herramientas y el estado de finalización.
- `message_end`: finaliza el stream del asistente, maneja anotaciones de anulación/error, marca los argumentos de herramienta pendientes como completos en parada normal.
- `agent_end`: detiene los cargadores, limpia el estado de stream transitorio, vacía el cambio de modelo diferido, emite una notificación de finalización si está en segundo plano.

La agrupación de herramientas de lectura es deliberadamente con estado (`#lastReadGroup`) para fusionar llamadas consecutivas a herramientas de lectura en un bloque visual hasta que ocurra una interrupción que no sea de lectura.

## Orquestación de estado y cargador

Responsabilidades del carril de estado:

- `statusContainer` contiene cargadores transitorios (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` renderiza indicadores de estado/hooks/plan persistentes e impulsa las actualizaciones del borde superior del editor.

Comportamiento del cargador:

- `Loader` se actualiza cada 80ms mediante un intervalo y solicita renderizado en cada fotograma.
- Los manejadores de escape se anulan temporalmente durante la compactación automática y el reintento automático para cancelar esas operaciones.
- En las rutas de finalización/cancelación, los controladores restauran los manejadores de escape anteriores y detienen/limpian los Componentes del cargador.

## Transiciones de modo y segundo plano

### Modos de entrada Bash/Python

Los prefijos de texto de entrada alternan los indicadores del modo de borde del editor:

- `!` -> modo bash
- `$` (prefijo que no es de cadena de plantilla) -> modo python

Escape sale del modo inactivo borrando el texto del editor y restaurando el color del borde; cuando la ejecución está activa, escape aborta la tarea en ejecución en su lugar.

### Modo plan

`InteractiveMode` rastrea los indicadores de modo plan, el estado de la línea de estado, las herramientas activas y el cambio de modelo. La entrada/salida actualiza las entradas de modo de sesión y el estado del estado/UI, incluido el cambio de modelo diferido si el streaming está activo.

### Suspensión/reanudación (`Ctrl+Z`)

`InputController.handleCtrlZ()`:

1. Registra un manejador `SIGCONT` de un solo uso para reiniciar el TUI y forzar el renderizado.
2. Detiene el TUI antes de suspender.
3. Envía `SIGTSTP` al grupo de procesos.

### Modo en segundo plano (`/background` o `/bg`)

`handleBackgroundCommand()`:

- Rechaza cuando está inactivo.
- Cambia el contexto de UI de herramientas a no interactivo (`hasUI=false`) para que las herramientas de UI interactivas fallen rápidamente.
- Detiene los cargadores/línea de estado y cancela la suscripción del manejador de eventos en primer plano.
- Se suscribe al manejador de eventos en segundo plano (principalmente espera `agent_end`).
- Detiene el TUI y envía `SIGTSTP` (ruta de control de trabajos POSIX).

En `agent_end` en segundo plano sin trabajo en cola, el controlador envía una notificación de finalización y se apaga.

## Rutas de cancelación

Entradas de cancelación principales:

- `Escape` durante el cargador de stream activo: restaura los mensajes en cola al editor y aborta el agente.
- `Escape` durante la ejecución de bash/python: aborta el comando en ejecución.
- `Escape` durante la compactación automática/reintento: invoca métodos de aborto dedicados a través de manejadores de escape temporales.
- `Ctrl+C` pulsación simple: limpiar el editor; doble pulsación en 500ms: apagado.

La cancelación es condicional al estado; la misma tecla puede significar abortar, salir del modo, activar el selector o ser un no-op dependiendo del estado en tiempo de ejecución.

## Comportamiento basado en eventos vs. con limitación de velocidad

Actualizaciones basadas en eventos:

- Eventos de sesión del agente (`EventController`)
- Callbacks de entrada de teclas (`InputController`)
- Callback de redimensionamiento del terminal
- Observadores de tema/rama en `InteractiveMode`

Rutas con limitación/antirrebote:

- El renderizado del TUI tiene antirrebote por tick (fusión de `requestRender`).
- La animación del cargador tiene intervalo fijo (80ms), con cada fotograma solicitando renderizado.
- Las actualizaciones de autocompletado del editor (dentro de `Editor`) utilizan temporizadores de antirrebote, reduciendo el cálculo redundante durante la escritura.

El runtime, por tanto, mezcla transiciones de estado basadas en eventos con una cadencia de renderizado acotada para mantener la interactividad responsiva sin tormentas de repintado.
