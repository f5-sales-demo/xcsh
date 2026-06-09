---
title: Ciclo de vida del runtime MCP
description: >-
  Ciclo de vida del proceso del servidor MCP desde la inicialización hasta el
  registro de herramientas, monitoreo de salud y apagado.
sidebar:
  order: 3
  label: Ciclo de vida del runtime
i18n:
  sourceHash: d04cefaf38f8
  translator: machine
---

# Ciclo de vida del runtime MCP

Este documento describe cómo los servidores MCP son descubiertos, conectados, expuestos como herramientas, actualizados y finalizados en el runtime del coding-agent.

## Ciclo de vida de un vistazo

1. **Inicio del SDK** llama a `discoverAndLoadMCPTools()` (a menos que MCP esté deshabilitado).
2. **Descubrimiento** (`loadAllMCPConfigs`) resuelve las configuraciones de servidores MCP desde fuentes de capacidades, filtra entradas deshabilitadas/de proyecto/Exa, y preserva los metadatos de origen.
3. **Fase de conexión del Manager** (`MCPManager.connectServers`) inicia la conexión por servidor + `tools/list` en paralelo.
4. **Compuerta de inicio rápido** espera hasta 250ms, luego puede retornar:
   - `MCPTool`s completamente cargados,
   - fallos por servidor,
   - o `DeferredMCPTool`s en caché para servidores aún pendientes.
5. **Cableado del SDK** fusiona las herramientas MCP en el registro de herramientas del runtime para la sesión.
6. **Sesión activa** puede actualizar herramientas MCP a través de flujos `/mcp` (`disconnectAll` + redescubrimiento + `session.refreshMCPTools`).
7. **Finalización** ocurre cuando los llamadores invocan `disconnectServer`/`disconnectAll`; el manager también limpia los registros de herramientas MCP para los servidores desconectados.

## Fase de descubrimiento y carga

### Ruta de entrada desde el SDK

`createAgentSession()` en `src/sdk.ts` realiza el inicio de MCP cuando `enableMCP` es true (por defecto):

- llama a `discoverAndLoadMCPTools(cwd, { ... })`,
- pasa `authStorage`, almacenamiento de caché y la configuración `mcp.enableProjectConfig`,
- siempre establece `filterExa: true`,
- registra errores de carga/conexión por servidor,
- almacena el manager retornado en `toolSession.mcpManager` y el resultado de la sesión.

Si `enableMCP` es false, el descubrimiento MCP se omite completamente.

### Descubrimiento y filtrado de configuración

`loadAllMCPConfigs()` (`src/mcp/config.ts`) carga los elementos canónicos del servidor MCP a través del descubrimiento de capacidades, luego los convierte a `MCPServerConfig` heredado.

Comportamiento de filtrado:

- `enableProjectConfig: false` elimina las entradas a nivel de proyecto (`_source.level === "project"`).
- Los servidores con `enabled: false` se omiten antes de los intentos de conexión.
- Los servidores Exa se filtran por defecto y las claves API se extraen para la integración nativa de la herramienta Exa.

El resultado incluye tanto `configs` como `sources` (metadatos utilizados posteriormente para el etiquetado de proveedores).

### Comportamiento ante fallos a nivel de descubrimiento

`discoverAndLoadMCPTools()` distingue dos clases de fallos:

- **Fallo grave de descubrimiento** (excepción de `manager.discoverAndConnect`, típicamente del descubrimiento de configuración): retorna un conjunto de herramientas vacío y un error sintético `{ path: ".mcp.json", error }`.
- **Fallo de runtime/conexión por servidor**: el manager retorna éxito parcial con un mapa de `errors`; los demás servidores continúan.

Por lo tanto, el inicio no falla toda la sesión del agente cuando servidores MCP individuales fallan.

## Modelo de estado del Manager

`MCPManager` rastrea el ciclo de vida del runtime con registros separados:

- `#connections: Map<string, MCPServerConnection>` — servidores completamente conectados.
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — negociación en progreso.
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — conectados pero herramientas aún cargándose.
- `#tools: CustomTool[]` — vista actual de herramientas MCP expuesta a los llamadores.
- `#sources: Map<string, SourceMeta>` — metadatos de proveedor/origen incluso antes de que la conexión se complete.

`getConnectionStatus(name)` deriva el estado de estos mapas:

- `connected` si está en `#connections`,
- `connecting` si hay conexión pendiente o carga de herramientas pendiente,
- `disconnected` en caso contrario.

## Establecimiento de conexión y temporización de inicio

## Pipeline de conexión por servidor

Para cada servidor descubierto en `connectServers()`:

1. almacenar/actualizar metadatos de origen,
2. omitir si ya está conectado/pendiente,
3. validar campos de transporte (`validateServerConfig`),
4. resolver sustituciones de autenticación/shell (`#resolveAuthConfig`),
5. llamar a `connectToServer(name, resolvedConfig)`,
6. llamar a `listTools(connection)`,
7. almacenar en caché las definiciones de herramientas (`MCPToolCache.set`) con máximo esfuerzo.

Comportamiento de `connectToServer()` (`src/mcp/client.ts`):

- crea transporte stdio o HTTP/SSE,
- realiza `initialize` + `notifications/initialized` de MCP,
- usa timeout (`config.timeout` o 30s por defecto),
- cierra el transporte en caso de fallo de inicialización.

### Compuerta de inicio rápido + respaldo diferido

`connectServers()` espera en una carrera entre:

- todas las tareas de conexión/carga de herramientas resueltas, y
- `STARTUP_TIMEOUT_MS = 250`.

Después de 250ms:

- las tareas completadas se convierten en `MCPTool`s activos,
- las tareas rechazadas producen errores por servidor,
- las tareas aún pendientes:
  - usan definiciones de herramientas en caché si están disponibles (`MCPToolCache.get`) para crear `DeferredMCPTool`s,
  - de lo contrario, bloquean hasta que esas tareas pendientes se resuelvan.

Este es un modelo de inicio híbrido: retorno rápido cuando la caché está disponible, espera de corrección cuando no lo está.

### Comportamiento de completado en segundo plano

Cada `toolsPromise` pendiente también tiene una continuación en segundo plano que eventualmente:

- reemplaza la porción de herramientas de ese servidor en el estado del manager mediante `#replaceServerTools`,
- escribe en caché,
- registra fallos tardíos solo después del inicio (`allowBackgroundLogging`).

## Exposición de herramientas y disponibilidad en sesión activa

### Registro en el inicio

`discoverAndLoadMCPTools()` convierte las herramientas del manager en `LoadedCustomTool[]` y decora las rutas (`mcp:<server> via <providerName>` cuando se conoce).

`createAgentSession()` luego inserta estas herramientas en `customTools`, que se envuelven y agregan al registro de herramientas del runtime con nombres como `mcp_<server>_<tool>`.

### Llamadas a herramientas

- `MCPTool` llama herramientas a través de una `MCPServerConnection` ya conectada.
- `DeferredMCPTool` espera a `waitForConnection(server)` antes de llamar; esto permite que las herramientas en caché existan antes de que la conexión esté lista.

Ambos retornan salida de herramienta estructurada y convierten errores de transporte/herramienta en contenido de herramienta `MCP error: ...` (la cancelación permanece como cancelación).

## Rutas de actualización/recarga (inicio vs recarga en vivo)

### Ruta de inicio inicial

- descubrimiento/carga única en `sdk.ts`,
- las herramientas se registran en el registro de herramientas de sesión inicial.

### Ruta de recarga interactiva

La ruta `/mcp reload` (`src/modes/controllers/mcp-command-controller.ts`) realiza:

1. `mcpManager.disconnectAll()`,
2. `mcpManager.discoverAndConnect()`,
3. `session.refreshMCPTools(mcpManager.getTools())`.

`session.refreshMCPTools()` (`src/session/agent-session.ts`) elimina todas las herramientas `mcp_`, re-envuelve las herramientas MCP más recientes y reactiva el conjunto de herramientas para que los cambios MCP se apliquen sin reiniciar la sesión.

También existe una ruta de seguimiento para conexiones tardías: después de esperar un servidor específico, si el estado se convierte en `connected`, se vuelve a ejecutar `session.refreshMCPTools(...)` para que las herramientas recién disponibles se vinculen nuevamente en la sesión.

## Salud, reconexión y comportamiento ante fallos parciales

El comportamiento actual del runtime es intencionalmente mínimo:

- **Sin monitor de salud autónomo** en el manager/cliente.
- **Sin bucle de reconexión automática** cuando un transporte se interrumpe.
- El manager no se suscribe a `onClose`/`onError` del transporte; el estado se basa en el registro.
- La reconexión es explícita: flujo de recarga o invocación directa de `connectServers()`.

Operativamente:

- el fallo de un servidor no elimina herramientas de servidores saludables,
- los fallos de conexión/listado están aislados por servidor,
- la caché de herramientas y las actualizaciones en segundo plano son de máximo esfuerzo (advertencias/errores registrados, sin parada forzada).

## Semánticas de finalización

### Finalización a nivel de servidor

`disconnectServer(name)`:

- elimina entradas pendientes/metadatos de origen,
- cierra el transporte si está conectado,
- elimina las herramientas `mcp_` de ese servidor del estado del manager.

### Finalización global

`disconnectAll()`:

- cierra todos los transportes activos con `Promise.allSettled`,
- limpia los mapas pendientes, orígenes, conexiones y la lista de herramientas del manager.

En el cableado actual, la finalización explícita se utiliza en los flujos de comandos MCP (para recargar/eliminar/deshabilitar). No hay un hook de disposición automática del manager separado en la propia ruta de inicio; los llamadores son responsables de invocar los métodos de desconexión del manager cuando necesitan un apagado MCP determinístico.

## Modos de fallo y garantías

| Escenario | Comportamiento | Fallo grave vs máximo esfuerzo |
| --- | --- | --- |
| El descubrimiento lanza una excepción (ruta de carga de capacidad/configuración) | El cargador retorna herramientas vacías + error sintético `.mcp.json` | Inicio de sesión con máximo esfuerzo |
| Configuración de servidor inválida | Servidor omitido con entrada de error de validación | Máximo esfuerzo por servidor |
| Timeout de conexión/fallo de inicialización | Error del servidor registrado; los demás continúan | Máximo esfuerzo por servidor |
| `tools/list` aún pendiente en el inicio con acierto de caché | Herramientas diferidas retornadas inmediatamente | Inicio rápido con máximo esfuerzo |
| `tools/list` aún pendiente en el inicio sin caché | El inicio espera a que los pendientes se resuelvan | Espera forzada por corrección |
| Fallo tardío de carga de herramientas en segundo plano | Registrado después de la compuerta de inicio | Registro con máximo esfuerzo |
| Transporte interrumpido en runtime | Sin reconexión automática; las llamadas futuras fallan hasta reconexión/recarga | Recuperación con máximo esfuerzo mediante acción manual |

## Superficie de API pública

`src/mcp/index.ts` re-exporta las APIs del cargador/manager/cliente para llamadores externos. `src/sdk.ts` expone `discoverMCPServers()` como un wrapper de conveniencia que retorna la misma forma de resultado del cargador.

## Archivos de implementación

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — fachada del cargador, normalización de errores de descubrimiento, conversión a `LoadedCustomTool`.
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — registros de estado del ciclo de vida, flujo paralelo de conexión/listado, actualización/desconexión.
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — configuración de transporte, negociación de inicialización, listado/llamada/desconexión.
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — exportaciones de la API del módulo MCP.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — cableado de inicio en el registro de sesión/herramientas.
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — descubrimiento/filtrado/validación de configuración utilizado por el manager.
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — comportamiento en runtime de `MCPTool` y `DeferredMCPTool`.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — re-vinculación en vivo de `refreshMCPTools`.
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — flujos de recarga/reconexión interactivos.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — proxy MCP de subagente mediante conexiones del manager padre.
