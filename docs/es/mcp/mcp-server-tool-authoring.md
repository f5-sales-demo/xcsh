---
title: Creación de servidores y herramientas MCP
description: >-
  Guía para construir servidores MCP personalizados y registrar herramientas
  para el agente de codificación.
sidebar:
  order: 4
  label: Creación de servidores y herramientas
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# Creación de servidores y herramientas MCP

Este documento explica cómo las definiciones de servidores MCP se convierten en herramientas `mcp_*` invocables en coding-agent, y qué deben esperar los operadores cuando las configuraciones son inválidas, duplicadas, deshabilitadas o protegidas por autenticación.

## Arquitectura general

```text
Config sources (.xcsh/.claude/.cursor/.vscode/mcp.json, mcp.json, etc.)
  -> discovery providers normalize to canonical MCPServer
  -> capability loader dedupes by server name (higher provider priority wins)
  -> loadAllMCPConfigs converts to MCPServerConfig + skips enabled:false
  -> MCPManager connects/listTools (with auth/header/env resolution)
  -> MCPTool/DeferredMCPTool bridge exposes tools as mcp_<server>_<tool>
  -> AgentSession.refreshMCPTools replaces live MCP tools immediately
```

## 1) Modelo de configuración de servidor y validación

`src/mcp/types.ts` define la estructura de autoría utilizada por los escritores de configuración MCP y en tiempo de ejecución:

- `stdio` (por defecto cuando `type` no está presente): requiere `command`, opcionales `args`, `env`, `cwd`
- `http`: requiere `url`, opcionales `headers`
- `sse`: requiere `url`, opcionales `headers` (mantenido por compatibilidad)
- campos compartidos: `enabled`, `timeout`, `auth`

`validateServerConfig()` (`src/mcp/config.ts`) aplica validaciones básicas de transporte:

- rechaza configuraciones que establecen tanto `command` como `url`
- requiere `command` para stdio
- requiere `url` para http/sse
- rechaza `type` desconocido

`config-writer.ts` aplica esta validación para operaciones de agregar/actualizar y también valida los nombres de servidores:

- no vacío
- máximo 100 caracteres
- solo `[a-zA-Z0-9_.-]`

### Problemas comunes con el transporte

- Omitir `type` significa stdio. Si su intención era HTTP/SSE pero omitió `type`, `command` se vuelve obligatorio.
- `sse` todavía se acepta pero se trata internamente como transporte HTTP (`createHttpTransport`).
- La validación es estructural, no de alcanzabilidad: una URL sintácticamente válida puede fallar al momento de conectarse.

## 2) Descubrimiento, normalización y precedencia

### Descubrimiento basado en capacidades

`loadAllMCPConfigs()` (`src/mcp/config.ts`) carga elementos canónicos `MCPServer` a través de `loadCapability(mcpCapability.id)`.

La capa de capacidades (`src/capability/index.ts`) entonces:

1. carga proveedores en orden de prioridad
2. elimina duplicados por `server.name` (el primero gana = mayor prioridad)
3. valida los elementos deduplicados

Resultado: los nombres de servidor duplicados entre fuentes no se fusionan. Una definición gana; los duplicados de menor prioridad quedan ocultos.

### `.mcp.json` y archivos relacionados

El proveedor de respaldo dedicado en `src/discovery/mcp-json.ts` lee `mcp.json` y `.mcp.json` de la raíz del proyecto (prioridad baja).

En la práctica, los servidores MCP también provienen de proveedores de mayor prioridad (por ejemplo, `.xcsh/...` nativo y directorios de configuración específicos de herramientas). Guía de autoría:

- Prefiera `.xcsh/mcp.json` (proyecto) o `~/.xcsh/mcp.json` (usuario) para un control explícito.
- Use `mcp.json` / `.mcp.json` en la raíz cuando necesite compatibilidad de respaldo.
- Reutilizar el mismo nombre de servidor en múltiples fuentes causa ocultamiento por precedencia, no fusión.

### Comportamiento de normalización

`convertToLegacyConfig()` (`src/mcp/config.ts`) mapea el `MCPServer` canónico a `MCPServerConfig` de tiempo de ejecución.

Comportamiento clave:

- transporte inferido como `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- los servidores deshabilitados (`enabled === false`) se eliminan antes de la conexión
- los campos opcionales se preservan cuando están presentes

### Expansión de variables de entorno durante el descubrimiento

`mcp-json.ts` expande marcadores de posición de variables de entorno en campos de texto con `expandEnvVarsDeep()`:

- soporta `${VAR}` y `${VAR:-default}`
- los valores no resueltos permanecen como cadenas literales `${VAR}`

`mcp-json.ts` también realiza verificaciones de tipo en tiempo de ejecución para JSON del usuario y registra advertencias para valores inválidos de `enabled`/`timeout` en lugar de fallar completamente el archivo.

## 3) Autenticación y resolución de valores en tiempo de ejecución

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) es el paso final previo a la conexión.

### Inyección de credenciales OAuth

Si la configuración tiene:

```ts
auth: { type: "oauth", credentialId: "..." }
```

y la credencial existe en el almacenamiento de autenticación:

- `http`/`sse`: inyecta el encabezado `Authorization: Bearer <access_token>`
- `stdio`: inyecta la variable de entorno `OAUTH_ACCESS_TOKEN`

Si la búsqueda de credenciales falla, el manager registra una advertencia y continúa con la autenticación sin resolver.

### Resolución de valores de encabezados/variables de entorno

Antes de conectar, el manager resuelve cada valor de encabezado/variable de entorno mediante `resolveConfigValue()` (`src/config/resolve-config-value.ts`):

- un valor que comienza con `!` => ejecuta un comando de shell, usa la salida estándar recortada (en caché)
- de lo contrario, trata el valor como nombre de variable de entorno primero (`process.env[name]`), con respaldo al valor literal
- los valores de comando/variable de entorno no resueltos se omiten del mapa final de encabezados/variables de entorno

Advertencia operacional: esto significa que una clave de secreto/comando mal escrita puede eliminar silenciosamente esa entrada de encabezado/variable de entorno, produciendo errores 401/403 posteriores o fallos en el inicio del servidor.

## 4) Puente de herramientas: MCP -> herramientas invocables por el agente

`src/mcp/tool-bridge.ts` convierte las definiciones de herramientas MCP en `CustomTool`s.

### Nomenclatura y dominio de colisiones

Los nombres de herramientas se generan como:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

Reglas:

- convierte a minúsculas
- los caracteres que no son `[a-z_]` se convierten en `_`
- los guiones bajos repetidos se colapsan
- el prefijo redundante `<server>_` en el nombre de la herramienta se elimina una vez

Esto evita muchas colisiones, pero no todas. Diferentes nombres sin procesar pueden sanitizarse al mismo identificador (por ejemplo `my-server` y `my.server` se sanitizan de forma similar), y la inserción en el registro es último-en-escribir-gana.

### Mapeo de esquemas

`convertSchema()` mantiene el JSON Schema de MCP prácticamente sin cambios, pero parchea los esquemas de objeto a los que les faltan `properties` con `{}` para compatibilidad con proveedores.

### Mapeo de ejecución

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- llama a `tools/call` de MCP
- aplana el contenido MCP en texto visualizable
- devuelve detalles estructurados (`serverName`, `mcpToolName`, metadatos del proveedor)
- mapea `isError` reportado por el servidor a un resultado de texto `Error: ...`
- mapea fallos de transporte/tiempo de ejecución lanzados como excepciones a `MCP error: ...`
- preserva la semántica de cancelación traduciendo AbortError en `ToolAbortError`

## 5) Ciclo de vida del operador: agregar/editar/eliminar y actualizaciones en vivo

El modo interactivo expone `/mcp` en `src/modes/controllers/mcp-command-controller.ts`.

Operaciones soportadas:

- `add` (asistente o adición rápida)
- `remove` / `rm`
- `enable` / `disable`
- `test`
- `reauth` / `unauth`
- `reload`

Las escrituras de configuración son atómicas (`writeMCPConfigFile`: archivo temporal + renombrado).

Después de los cambios, el controlador llama a `#reloadMCP()`:

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

`refreshMCPTools()` reemplaza todas las entradas `mcp_` del registro y reactiva inmediatamente el conjunto más reciente de herramientas MCP, por lo que los cambios surten efecto sin reiniciar la sesión.

### Diferencias según el modo

- **Modo interactivo/TUI**: `/mcp` proporciona UX dentro de la aplicación (asistente, flujo OAuth, texto de estado de conexión, reconexión inmediata en tiempo de ejecución).
- **Integración SDK/headless**: `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) devuelve las herramientas cargadas + errores por servidor; sin UX del comando `/mcp`.

## 6) Superficies de error visibles para el usuario

Cadenas de error comunes que ven los usuarios/operadores:

- fallos de validación al agregar/actualizar:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- problemas con argumentos de adición rápida:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- fallos de conexión/prueba:
  - `Failed to connect to "<name>": <message>`
  - texto de ayuda sobre timeout que sugiere aumentar el tiempo de espera
  - texto de ayuda sobre autenticación para `401/403`
- flujos de autenticación/OAuth:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- uso de servidor deshabilitado:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

El JSON de fuente inválido en el descubrimiento generalmente se maneja como advertencias/registros; las rutas de config-writer lanzan errores explícitos.

## 7) Guía práctica de autoría

Para una autoría MCP robusta en esta base de código:

1. Mantenga los nombres de servidor globalmente únicos en todas las fuentes de configuración compatibles con MCP.
2. Prefiera nombres alfanuméricos/con guiones bajos para evitar colisiones de nombres sanitizados en los nombres de herramientas `mcp_*` generados.
3. Use `type` explícito para evitar valores predeterminados accidentales de stdio.
4. Trate `enabled: false` como apagado total: el servidor se omite del conjunto de conexión en tiempo de ejecución.
5. Para configuraciones OAuth, almacene un `credentialId` válido; de lo contrario, la inyección de autenticación se omite.
6. Si usa resolución de secretos basada en comandos (`!cmd`), verifique que la salida del comando sea estable y no vacía.

## Archivos de implementación

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts)
- [`src/mcp/config-writer.ts`](../../packages/coding-agent/src/mcp/config-writer.ts)
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts)
- [`src/discovery/mcp-json.ts`](../../packages/coding-agent/src/discovery/mcp-json.ts)
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/config/resolve-config-value.ts`](../../packages/coding-agent/src/config/resolve-config-value.ts)
- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts)
