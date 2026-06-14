---
title: Componentes internos del runtime TUI
description: >-
  Componentes internos del runtime de la interfaz de usuario de terminal que
  cubren la canalización de renderizado, el manejo de entradas y la gestión de
  estados.
sidebar:
  order: 2
  label: Componentes internos del runtime
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# Componentes internos del runtime TUI

Este documento mapea la ruta del runtime sin tema desde la entrada de terminal hasta la salida renderizada en modo interactivo. Se centra en el comportamiento de `packages/tui` y su integración desde los controladores de `packages/coding-agent`.

## Capas del runtime y propiedad

- **Motor de `packages/tui`**: ciclo de vida del terminal, normalización de stdin, enrutamiento de foco, programación de renderizado, pintura diferencial, composición de superposiciones, posicionamiento de cursor de hardware.
- **Modo interactivo de `packages/coding-agent`**: construye el árbol de componentes, vincula callbacks del editor y mapas de teclas, reacciona a eventos del agente/sesión, y traduce el estado del dominio (streaming, ejecución de herramientas, reintentos, modo plan) en componentes de UI.

Regla de límite: el motor TUI es agnóstico a los mensajes. Solo conoce `Component.render(width)`, `handleInput(data)`, foco y superposiciones. La semántica del agente permanece en los controladores interactivos.

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

## Arranque y ensamblado del árbol de componentes

`InteractiveMode` construye `TUI(new ProcessTerminal(), showHardwareCursor)` y crea contenedores persistentes:

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (contiene `CustomEditor`)

`init()` conecta el árbol en ese orden, enfoca el editor, registra manejadores de entrada mediante `InputController`, inicia el TUI y solicita un renderizado forzado.

Un renderizado forzado (`requestRender(true)`) restablece las cachés de líneas anteriores y los marcadores del cursor antes de volver a pintar.

## Ciclo de vida del terminal y normalización de stdin

`ProcessTerminal.start()`:

1. Habilita el modo raw y el pegado entre corchetes.
2. Adjunta el manejador de cambio de tamaño.
3. Crea un `StdinBuffer` para dividir fragmentos de escape parciales en secuencias completas.
4. Consulta la compatibilidad con el protocolo de teclado Kitty (`CSI ? u`), luego habilita los indicadores de protocolo si es compatible.
5. En Windows, intenta la habilitación de entrada VT mediante indicadores de modo `kernel32`.

Comportamiento de `StdinBuffer`:

- Almacena en búfer secuencias de escape fragmentadas (CSI/OSC/DCS/APC/SS3).
- Emite `data` solo cuando una secuencia está completa o se ha vaciado por tiempo de espera.
- Detecta el pegado entre corchetes y emite un evento `paste` con el texto pegado sin procesar.

Esto evita que los fragmentos de escape parciales sean malinterpretados como pulsaciones de teclas normales.

## Enrutamiento de entrada y modelo de foco

Ruta de entrada:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Detalles del enrutamiento:

1. El TUI ejecuta primero los oyentes de entrada registrados (`addInputListener`), lo que permite el comportamiento de consumo/transformación.
2. El TUI maneja el atajo de depuración global (`shift+ctrl+d`) antes del despacho a componentes.
3. Si el componente enfocado pertenece a una superposición que ahora está oculta o invisible, el TUI reasigna el foco a la siguiente superposición visible o al foco previo guardado antes de la superposición.
4. Los eventos de liberación de teclas se filtran a menos que el componente enfocado establezca `wantsKeyRelease = true`.
5. Después del despacho, el TUI programa el renderizado.

`setFocus()` también alterna `Focusable.focused`, que controla si los componentes emiten `CURSOR_MARKER` para el posicionamiento del cursor de hardware.

## División del manejo de teclas: editor vs controlador

`CustomEditor` intercepta primero las combinaciones de alta prioridad (escape, ctrl-c/d/z, ctrl-v, variantes de ctrl-p, ctrl-t, alt-arriba, teclas personalizadas de extensión) y delega el resto al comportamiento base de `Editor` (edición de texto, historial, autocompletado, movimiento del cursor).

`InputController.setupKeyHandlers()` luego vincula los callbacks del editor a las acciones del modo:

- cancelación / salidas de modo en `Escape`
- apagado en doble `Ctrl+C` o `Ctrl+D` con editor vacío
- suspender/reanudar en `Ctrl+Z`
- atajos de comando slash y selector
- alternancias de seguimiento/desencolar y alternancias de expansión

Esto mantiene el análisis de teclas/mecánicas del editor en `packages/tui` y la semántica del modo en los controladores de coding-agent.

## Bucle de renderizado y estrategia de diferenciación

`TUI.requestRender()` se elimina del rebote a un renderizado por tick usando `process.nextTick`. Múltiples cambios de estado en el mismo turno se fusionan.

Canalización de `#doRender()`:

1. Renderiza el árbol de componentes raíz en `newLines`.
2. Compone las superposiciones visibles (si las hay).
3. Extrae y elimina `CURSOR_MARKER` de las líneas del viewport visible.
4. Añade sufijos de restablecimiento de segmento para las líneas que no son imágenes.
5. Elige entre repintado completo o parche diferencial:
   - primer fotograma
   - cambio de ancho
   - reducción con `clearOnShrink` habilitado y sin superposiciones
   - ediciones por encima del viewport anterior
6. Para actualizaciones diferenciales, parchea solo el rango de líneas modificadas y borra las líneas finales obsoletas cuando sea necesario.
7. Reposiciona el cursor de hardware para compatibilidad con IME.

Las escrituras de renderizado usan el modo de salida sincronizada (`CSI ? 2026 h/l`) para reducir el parpadeo y el desgarro.

## Restricciones de seguridad del renderizado

Comprobaciones de seguridad críticas en `TUI`:

- Las líneas renderizadas que no son imágenes no deben exceder el ancho del terminal; el desbordamiento genera una excepción y escribe diagnósticos de fallo.
- La composición de superposiciones incluye truncamiento defensivo y verificación de ancho posterior a la composición.
- Los cambios de ancho fuerzan un redibujado completo porque la semántica de ajuste de línea cambia.
- La posición del cursor se limita antes del movimiento.

Estas restricciones son aplicación en tiempo de ejecución, no solo convenciones.

## Manejo del cambio de tamaño

Los eventos de cambio de tamaño son controlados por eventos desde `ProcessTerminal` hasta `TUI.requestRender()`.

Efectos:

- Cualquier cambio de ancho desencadena un redibujado completo.
- El seguimiento del viewport/tope (`#previousViewportTop`, `#maxLinesRendered`) evita operaciones de cursor relativas no válidas cuando el contenido o el tamaño del terminal cambian.
- La visibilidad de la superposición puede depender de las dimensiones del terminal (`OverlayOptions.visible`); el foco se corrige cuando las superposiciones dejan de ser visibles después de un cambio de tamaño.

## Streaming y actualizaciones incrementales de la UI

`EventController` se suscribe a `AgentSessionEvent` y actualiza la UI de forma incremental:

- `agent_start`: inicia el cargador en `statusContainer`.
- `message_start` asistente: crea `streamingComponent` y lo monta.
- `message_update`: actualiza el contenido del asistente en streaming; crea/actualiza componentes de ejecución de herramientas a medida que aparecen las llamadas a herramientas.
- `tool_execution_update/end`: actualiza los componentes de resultado de herramientas y el estado de finalización.
- `message_end`: finaliza el stream del asistente, maneja anotaciones de cancelación/error, marca los argumentos de herramientas pendientes como completos en parada normal.
- `agent_end`: detiene los cargadores, borra el estado transitorio del stream, vacía el cambio de modelo diferido, emite una notificación de finalización si está en segundo plano.

La agrupación de herramientas de lectura es intencionalmente con estado (`#lastReadGroup`) para fusionar llamadas consecutivas a herramientas de lectura en un bloque visual único hasta que ocurra una interrupción de no lectura.

## Estado y orquestación del cargador

Propiedad del carril de estado:

- `statusContainer` contiene cargadores transitorios (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` renderiza indicadores de estado/hooks/plan persistentes y controla las actualizaciones del borde superior del editor.

Comportamiento del cargador:

- `Loader` se actualiza cada 80ms mediante un intervalo y solicita un renderizado en cada fotograma.
- Los manejadores de escape se anulan temporalmente durante la compactación automática y el reintento automático para cancelar esas operaciones.
- En las rutas de finalización/cancelación, los controladores restauran los manejadores de escape anteriores y detienen/borran los componentes del cargador.

## Transiciones de modo y paso a segundo plano

### Modos de entrada Bash/Python

Los prefijos de texto de entrada alternan los indicadores de modo de borde del editor:

- `!` -> modo bash
- `$` (prefijo de literal que no es de plantilla) -> modo python

Escape sale del modo inactivo borrando el texto del editor y restaurando el color del borde; cuando la ejecución está activa, escape aborta la tarea en ejecución.

### Modo plan

`InteractiveMode` rastrea los indicadores del modo plan, el estado de la línea de estado, las herramientas activas y el cambio de modelo. La entrada/salida actualiza las entradas del modo de sesión y el estado de estado/UI, incluyendo el cambio de modelo diferido si el streaming está activo.

### Suspender/reanudar (`Ctrl+Z`)

`InputController.handleCtrlZ()`:

1. Registra un manejador `SIGCONT` de un solo uso para reiniciar el TUI y forzar el renderizado.
2. Detiene el TUI antes de la suspensión.
3. Envía `SIGTSTP` al grupo de procesos.

### Modo segundo plano (`/background` o `/bg`)

`handleBackgroundCommand()`:

- Rechaza cuando está inactivo.
- Cambia el contexto de UI de herramientas a no interactivo (`hasUI=false`) para que las herramientas de UI interactiva fallen rápidamente.
- Detiene los cargadores/línea de estado y cancela la suscripción al manejador de eventos en primer plano.
- Se suscribe al manejador de eventos en segundo plano (principalmente espera `agent_end`).
- Detiene el TUI y envía `SIGTSTP` (ruta de control de trabajos POSIX).

En `agent_end` en segundo plano sin trabajo en cola, el controlador envía una notificación de finalización y se cierra.

## Rutas de cancelación

Entradas de cancelación principales:

- `Escape` durante el cargador de stream activo: restaura los mensajes en cola al editor y aborta el agente.
- `Escape` durante la ejecución de bash/python: aborta el comando en ejecución.
- `Escape` durante la compactación automática/reintento: invoca métodos de cancelación dedicados a través de manejadores de escape temporales.
- `Ctrl+C` presión única: borrar el editor; doble presión en 500ms: apagar.

La cancelación es condicional al estado; la misma tecla puede significar abortar, salir del modo, activar el selector o no hacer nada dependiendo del estado en tiempo de ejecución.

## Comportamiento controlado por eventos vs. con limitación de frecuencia

Actualizaciones controladas por eventos:

- Eventos de sesión del agente (`EventController`)
- Callbacks de entrada de teclas (`InputController`)
- Callback de cambio de tamaño del terminal
- Observadores de tema/rama en `InteractiveMode`

Rutas con limitación de frecuencia/eliminación de rebote:

- El renderizado del TUI se elimina del rebote por tick (fusión de `requestRender`).
- La animación del cargador es de intervalo fijo (80ms), con cada fotograma solicitando un renderizado.
- Las actualizaciones de autocompletado del editor (dentro de `Editor`) usan temporizadores de eliminación de rebote, reduciendo el trabajo de recálculo durante la escritura.

El runtime, por tanto, mezcla transiciones de estado controladas por eventos con una cadencia de renderizado acotada para mantener la interactividad responsiva sin tormentas de repintado.
