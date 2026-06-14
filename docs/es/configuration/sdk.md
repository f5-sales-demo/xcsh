---
title: SDK
description: >-
  SDK para construir agentes personalizados e integraciones sobre el tiempo de
  ejecución del agente de codificación xcsh.
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

El SDK es la superficie de integración en proceso para `@f5xc-salesdemos/xcsh`.
Úselo cuando desee acceso directo al estado del agente, transmisión de eventos, conexión de herramientas y control de sesión desde su propio proceso Bun/Node.

Si necesita aislamiento entre lenguajes o procesos, utilice el modo RPC en su lugar.

## Instalación

```bash
bun add @f5xc-salesdemos/xcsh
```

## Puntos de entrada

`@f5xc-salesdemos/xcsh` exporta las API del SDK desde la raíz del paquete (y también a través de `@f5xc-salesdemos/xcsh/sdk`).

Exportaciones principales para integradores:

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- Auxiliares de descubrimiento (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- Superficie de fábrica de herramientas (`createTools`, `BUILTIN_TOOLS`, clases de herramientas)

## Inicio rápido (valores predeterminados de descubrimiento automático)

```ts
import { createAgentSession } from "@f5xc-salesdemos/xcsh";

const { session, modelFallbackMessage } = await createAgentSession();

if (modelFallbackMessage) {
 process.stderr.write(`${modelFallbackMessage}\n`);
}

const unsubscribe = session.subscribe(event => {
 if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
  process.stdout.write(event.assistantMessageEvent.delta);
 }
});

await session.prompt("Summarize this repository in 3 bullets.");
unsubscribe();
await session.dispose();
```

## Qué descubre `createAgentSession()` de forma predeterminada

`createAgentSession()` sigue el principio "proporcionar para anular, omitir para descubrir".

Si se omite, resuelve:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent` (a través de `getAgentDir()`)
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)` (respaldado por archivo)
- habilidades/archivos de contexto/plantillas de prompt/comandos de barra/extensiones/comandos TS personalizados
- herramientas integradas a través de `createTools(...)`
- herramientas MCP (habilitadas de forma predeterminada)
- integración LSP (habilitada de forma predeterminada)

### Entradas requeridas versus opcionales

Normalmente solo debe proporcionar lo que desea controlar:

- **Debe proporcionar**: nada para una sesión mínima
- **Generalmente se proporciona explícitamente** en integradores:
    - `sessionManager` (si necesita memoria en proceso o ubicación personalizada)
    - `authStorage` + `modelRegistry` (si gestiona el ciclo de vida de credenciales/modelos)
    - `model` o `modelPattern` (si la selección determinista del modelo es importante)
    - `settings` (si necesita configuración aislada o de prueba)

## Comportamiento del administrador de sesiones (persistente o en memoria)

`AgentSession` siempre usa un `SessionManager`; el comportamiento depende de qué fábrica utilice.

### Respaldado por archivo (predeterminado)

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absolute .jsonl path
```

- Persiste conversaciones/mensajes/deltas de estado en archivos de sesión.
- Admite flujos de trabajo de reanudación/apertura/listado/bifurcación.
- `session.sessionFile` está definido.

### En memoria

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- Sin persistencia en el sistema de archivos.
- Útil para pruebas, trabajadores efímeros, agentes con alcance de solicitud.
- Los métodos de sesión siguen funcionando, pero los comportamientos específicos de persistencia (rutas de reanudación/bifurcación de archivos) están naturalmente limitados.

### Auxiliares de reanudación/apertura/listado

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## Conexión de modelos y autenticación

`createAgentSession()` usa `ModelRegistry` + `AuthStorage` para la selección de modelos y la resolución de claves API.

### Conexión explícita

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
} from "@f5xc-salesdemos/xcsh";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const available = modelRegistry.getAvailable();
if (available.length === 0) throw new Error("No authenticated models available");

const { session } = await createAgentSession({
 authStorage,
 modelRegistry,
 model: available[0],
 thinkingLevel: "medium",
 sessionManager: SessionManager.inMemory(),
});
```

### Orden de selección cuando se omite `model`

Cuando no se proporciona un `model`/`modelPattern` explícito:

1. restaurar el modelo desde la sesión existente (si es restaurable y la clave está disponible)
2. rol de modelo predeterminado de la configuración (`default`)
3. primer modelo disponible con autenticación válida

Si la restauración falla, `modelFallbackMessage` explica el retroceso.

### Prioridad de autenticación

`AuthStorage.getApiKey(...)` resuelve en este orden:

1. anulación en tiempo de ejecución (`setRuntimeApiKey`)
2. credenciales almacenadas en `agent.db`
3. variables de entorno del proveedor
4. retroceso al resolvedor de proveedor personalizado (si está configurado)

## Modelo de suscripción a eventos

Suscríbase con `session.subscribe(listener)`; devuelve una función de cancelación de suscripción.

```ts
const unsubscribe = session.subscribe(event => {
 switch (event.type) {
  case "agent_start":
  case "turn_start":
  case "tool_execution_start":
   break;
  case "message_update":
   if (event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
   }
   break;
 }
});
```

`AgentSessionEvent` incluye el núcleo `AgentEvent` más eventos a nivel de sesión:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## Ciclo de vida de prompt

`session.prompt(text, options?)` es el punto de entrada principal.

Comportamiento:

1. expansión opcional de comandos/plantillas (comandos `/`, comandos personalizados, comandos de barra de archivo, plantillas de prompt)
2. si actualmente está transmitiendo:
    - requiere `streamingBehavior: "steer" | "followUp"`
    - encola en lugar de descartar el trabajo
3. si está inactivo:
    - valida el modelo y la clave API
    - agrega el mensaje del usuario
    - inicia el turno del agente

API relacionadas:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## Herramientas e integración de extensiones

### Integradas y filtrado

- Las integradas provienen de `createTools(...)` y `BUILTIN_TOOLS`.
- `toolNames` actúa como una lista de permitidos para las integradas.
- Las herramientas `customTools` y las registradas por extensiones aún se incluyen.
- Las herramientas ocultas (por ejemplo, `submit_result`) son de inclusión opcional a menos que sean requeridas por las opciones.

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### Extensiones

- `extensions`: `ExtensionFactory[]` en línea
- `additionalExtensionPaths`: cargar archivos de extensión adicionales
- `disableExtensionDiscovery`: deshabilitar el escaneo automático de extensiones
- `preloadedExtensions`: reutilizar un conjunto de extensiones ya cargadas

### Cambios en el conjunto de herramientas en tiempo de ejecución

`AgentSession` admite actualizaciones de activación en tiempo de ejecución:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

El prompt del sistema se reconstruye para reflejar los cambios en las herramientas activas.

## Auxiliares de descubrimiento

Úselos cuando desee control parcial sin recrear la lógica de descubrimiento interna:

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## Opciones orientadas a subagentes

Para consumidores del SDK que construyen orquestadores (similar al flujo del ejecutor de tareas):

- `outputSchema`: pasa la expectativa de salida estructurada al contexto de la herramienta
- `requireSubmitResultTool`: fuerza la inclusión de la herramienta `submit_result`
- `taskDepth`: contexto de profundidad de recursión para sesiones de tareas anidadas
- `parentTaskPrefix`: prefijo de nomenclatura de artefactos para salidas de tareas anidadas

Estos son opcionales para la integración estándar de un único agente.

## Valor de retorno de `createAgentSession()`

```ts
type CreateAgentSessionResult = {
 session: AgentSession;
 extensionsResult: LoadExtensionsResult;
 setToolUIContext: (uiContext: ExtensionUIContext, hasUI: boolean) => void;
 mcpManager?: MCPManager;
 modelFallbackMessage?: string;
 lspServers?: Array<{ name: string; status: "ready" | "error"; fileTypes: string[]; error?: string }>;
};
```

Use `setToolUIContext(...)` solo si su integrador proporciona capacidades de interfaz de usuario que las herramientas/extensiones deben invocar.

## Ejemplo mínimo de integración controlada

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
 Settings,
} from "@f5xc-salesdemos/xcsh";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const settings = Settings.isolated({
 "compaction.enabled": true,
 "retry.enabled": true,
});

const { session } = await createAgentSession({
 authStorage,
 modelRegistry,
 settings,
 sessionManager: SessionManager.inMemory(),
 toolNames: ["read", "grep", "find", "edit", "write"],
 enableMCP: false,
 enableLsp: true,
});

session.subscribe(event => {
 if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
  process.stdout.write(event.assistantMessageEvent.delta);
 }
});

await session.prompt("Find all TODO comments in this repo and propose fixes.");
await session.dispose();
```
