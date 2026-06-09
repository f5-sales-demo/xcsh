---
title: Configuración de MCP
description: >-
  Configuración, validación y gestión de servidores MCP para el entorno de
  ejecución del agente de codificación.
sidebar:
  order: 1
  label: Configuración
i18n:
  sourceHash: e4f56e8becc6
  translator: machine
---

# Configuración de MCP en OMP

Esta guía explica cómo agregar, editar y validar servidores MCP para el agente de codificación de OMP.

Fuente de verdad en el código:

- Tipos de configuración del entorno de ejecución: `packages/coding-agent/src/mcp/types.ts`
- Escritor de configuración: `packages/coding-agent/src/mcp/config-writer.ts`
- Cargador + validación: `packages/coding-agent/src/mcp/config.ts`
- Descubrimiento de `mcp.json` independiente: `packages/coding-agent/src/discovery/mcp-json.ts`
- Esquema: `packages/coding-agent/src/config/mcp-schema.json`

## Ubicaciones de configuración preferidas

OMP puede descubrir servidores MCP desde múltiples herramientas (`.claude/`, `.cursor/`, `.vscode/`, `opencode.json`, y más), pero para la configuración nativa de OMP generalmente debería usar uno de estos archivos:

- Proyecto: `.xcsh/mcp.json`
- Usuario: `~/.xcsh/mcp.json`

OMP también acepta archivos independientes de respaldo en la raíz del proyecto:

- `mcp.json`
- `.mcp.json`

Use `.xcsh/mcp.json` cuando desee que OMP sea el propietario de la configuración. Use `mcp.json` / `.mcp.json` en la raíz solo cuando desee un archivo de respaldo portátil que otros clientes MCP también puedan leer.

## Agregar una referencia al esquema

Agregue esta línea al inicio del archivo para obtener autocompletado y validación en el editor:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {}
}
```

OMP ahora escribe esto automáticamente cuando `/mcp add`, `/mcp enable`, `/mcp disable`, `/mcp reauth` u otros flujos de escritura de configuración crean o actualizan un archivo MCP gestionado por OMP.

## Estructura del archivo

OMP soporta esta estructura de nivel superior:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-mcp-server"]
    }
  },
  "disabledServers": ["server-name"]
}
```

Claves de nivel superior:

- `$schema` — URL opcional del esquema JSON para herramientas
- `mcpServers` — mapa de nombre de servidor a configuración del servidor
- `disabledServers` — lista de denegación a nivel de usuario utilizada para desactivar servidores descubiertos por nombre

Los nombres de servidor deben coincidir con `^[a-zA-Z0-9_.-]{1,100}$`.

## Campos de servidor soportados

Campos compartidos para todos los transportes:

- `enabled?: boolean` — omite este servidor cuando es `false`
- `timeout?: number` — tiempo de espera de conexión en milisegundos
- `auth?: { ... }` — metadatos de autenticación utilizados por OMP para flujos OAuth/API-key
- `oauth?: { ... }` — configuración explícita del cliente OAuth utilizada durante la autenticación/reautenticación

### Transporte `stdio`

`stdio` es el valor predeterminado cuando se omite `type`.

Requerido:

- `command: string`

Opcional:

- `type?: "stdio"`
- `args?: string[]`
- `env?: Record<string, string>`
- `cwd?: string`

Ejemplo:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/alice/projects",
        "/Users/alice/Documents"
      ]
    }
  }
}
```

Esto sigue el paquete oficial del servidor MCP de sistema de archivos (`@modelcontextprotocol/server-filesystem`).

### Transporte `http`

Requerido:

- `type: "http"`
- `url: string`

Opcional:

- `headers?: Record<string, string>`

Ejemplo:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

Esto coincide con el endpoint del servidor MCP alojado de GitHub.

### Transporte `sse`

Requerido:

- `type: "sse"`
- `url: string`

Opcional:

- `headers?: Record<string, string>`

Ejemplo:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "legacy-remote": {
      "type": "sse",
      "url": "https://example.com/mcp/sse"
    }
  }
}
```

`sse` todavía es soportado por compatibilidad, pero la especificación MCP ahora prefiere HTTP Streamable (`type: "http"`) para servidores nuevos.

## Campos de autenticación

OMP entiende dos objetos relacionados con la autenticación.

### `auth`

```json
{
  "type": "oauth" | "apikey",
  "credentialId": "optional-stored-credential-id",
  "tokenUrl": "optional-token-endpoint",
  "clientId": "optional-client-id",
  "clientSecret": "optional-client-secret"
}
```

Use esto cuando OMP deba recordar cómo rehidratar las credenciales de un servidor.

### `oauth`

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "redirectUri": "...",
  "callbackPort": 3334,
  "callbackPath": "/oauth/callback"
}
```

Use esto cuando el servidor MCP requiere configuración explícita del cliente OAuth.

Slack es el ejemplo actual más claro. El servidor MCP de Slack está alojado en `https://mcp.slack.com/mcp`, utiliza HTTP Streamable y requiere OAuth confidencial con las credenciales de cliente de su aplicación de Slack.

Ejemplo:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

Endpoints relevantes de Slack según la documentación de Slack:

- Endpoint MCP: `https://mcp.slack.com/mcp`
- Endpoint de autorización: `https://slack.com/oauth/v2_user/authorize`
- Endpoint de token: `https://slack.com/api/oauth.v2.user.access`

## Ejemplos comunes para copiar y pegar

### Servidor de sistema de archivos vía stdio

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/absolute/path/one",
        "/absolute/path/two"
      ]
    }
  }
}
```

### Servidor alojado de GitHub vía HTTP

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

### Servidor local de GitHub vía Docker

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
      }
    }
  }
}
```

Esto coincide con la imagen Docker oficial local de GitHub `ghcr.io/github/github-mcp-server`.

### Servidor alojado de Slack vía OAuth

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

## Secretos y resolución de variables

Esta es la parte que generalmente causa confusión.

### En `.xcsh/mcp.json` y `~/.xcsh/mcp.json`

Antes de que OMP lance un servidor o realice una solicitud HTTP, resuelve los valores de `env` y `headers` de la siguiente manera:

1. Si un valor comienza con `!`, OMP lo ejecuta como un comando de shell y utiliza la salida estándar recortada.
2. De lo contrario, OMP primero verifica si el valor coincide con el nombre de una variable de entorno.
3. Si esa variable de entorno no está establecida, OMP utiliza la cadena literalmente.

Ejemplos:

```json
{
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
  },
  "headers": {
    "X-MCP-Insiders": "true"
  }
}
```

Esto significa que lo siguiente es válido y conveniente para secretos locales:

- `"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"` → copiar desde el entorno de shell actual
- `"Authorization": "Bearer hardcoded-token"` → usar el valor literal
- `"Authorization": "!printf 'Bearer %s' \"$GITHUB_TOKEN\""` → construir el encabezado desde un comando

### En `mcp.json` y `.mcp.json` de la raíz

El cargador de respaldo independiente también expande `${VAR}` y `${VAR:-default}` dentro de las cadenas durante el descubrimiento.

Ejemplo:

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      }
    }
  }
}
```

Si desea el comportamiento menos sorprendente de OMP, prefiera `.xcsh/mcp.json` y use valores explícitos de env/headers.

## `disabledServers`

`disabledServers` es principalmente útil en el archivo de configuración del usuario (`~/.xcsh/mcp.json`) cuando un servidor se descubre desde otra fuente y desea que OMP lo ignore sin editar la configuración de esa otra herramienta.

Ejemplo:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "disabledServers": ["github", "slack"]
}
```

## `/mcp add` vs editar JSON directamente

Use `/mcp add` cuando desee una configuración guiada.

Use la edición directa de JSON cuando:

- necesite una opción de transporte o autenticación que el asistente aún no solicita
- desee pegar una definición de servidor desde otro cliente MCP
- desee validación respaldada por esquema en su editor

Después de editar, use:

- `/mcp reload` para redescubrir y reconectar servidores en la sesión actual
- `/mcp list` para ver de qué archivo de configuración proviene un servidor
- `/mcp test <name>` para probar un servidor individual

## Reglas de validación que OMP aplica

Desde `validateServerConfig()` en `packages/coding-agent/src/mcp/config.ts`:

- `stdio` requiere `command`
- `http` y `sse` requieren `url`
- un servidor no puede establecer tanto `command` como `url`
- los valores desconocidos de `type` son rechazados

Implicaciones prácticas:

- Omitir `type` significa `stdio`
- Si pega una configuración de servidor remoto y olvida `"type": "http"`, OMP lo tratará como `stdio` y se quejará de que falta `command`
- `sse` sigue siendo válido por compatibilidad, pero los nuevos servidores alojados generalmente deberían configurarse como `http`

## Descubrimiento y precedencia

OMP no fusiona definiciones de servidor duplicadas entre archivos. Los proveedores de descubrimiento están priorizados, y la definición de mayor prioridad prevalece.

En la práctica:

- prefiera `.xcsh/mcp.json` o `~/.xcsh/mcp.json` cuando desee una anulación específica de OMP
- mantenga los nombres de servidor únicos entre herramientas cuando sea posible
- use `disabledServers` en la configuración del usuario cuando una configuración de terceros siga reintroduciendo un servidor que no desea

## Solución de problemas

### `Server "name": stdio server requires "command" field`

Probablemente omitió `type: "http"` en un servidor remoto.

### `Server "name": both "command" and "url" are set`

Elija un transporte. OMP trata `command` como stdio y `url` como http/sse.

### `/mcp add` funcionó pero el servidor aún no se conecta

El JSON es válido, pero el servidor puede seguir siendo inaccesible. Use `/mcp test <name>` y verifique si:

- el binario o la imagen Docker existe
- las variables de entorno requeridas están establecidas
- la URL remota es accesible
- el token OAuth o API es válido

### El servidor existe en la configuración de otra herramienta pero no en OMP

Ejecute `/mcp list`. OMP descubre muchos archivos MCP de terceros, pero la carga a nivel de proyecto también puede desactivarse mediante la configuración `mcp.enableProjectConfig`.

## Referencias

- Especificación de transporte MCP: <https://modelcontextprotocol.io/specification/2025-03-26/basic/transports>
- Paquete del servidor de sistema de archivos: <https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem>
- Servidor MCP de GitHub: <https://github.com/github/github-mcp-server>
- Documentación del servidor MCP de Slack: <https://docs.slack.dev/ai/slack-mcp-server/>
