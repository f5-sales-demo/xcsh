---
title: Configuração MCP
description: >-
  Configuração, validação e gerenciamento de servidores MCP para o runtime do
  agente de codificação.
sidebar:
  order: 1
  label: Configuração
i18n:
  sourceHash: e4f56e8becc6
  translator: machine
---

# Configuração MCP no OMP

Este guia explica como adicionar, editar e validar servidores MCP para o agente de codificação OMP.

Fonte de verdade no código:

- Tipos de configuração de runtime: `packages/coding-agent/src/mcp/types.ts`
- Escritor de configuração: `packages/coding-agent/src/mcp/config-writer.ts`
- Carregador + validação: `packages/coding-agent/src/mcp/config.ts`
- Descoberta autônoma de `mcp.json`: `packages/coding-agent/src/discovery/mcp-json.ts`
- Schema: `packages/coding-agent/src/config/mcp-schema.json`

## Locais de configuração preferidos

O OMP pode descobrir servidores MCP de múltiplas ferramentas (`.claude/`, `.cursor/`, `.vscode/`, `opencode.json` e mais), mas para configuração nativa do OMP você geralmente deve usar um destes arquivos:

- Projeto: `.xcsh/mcp.json`
- Usuário: `~/.xcsh/mcp.json`

O OMP também aceita arquivos autônomos de fallback na raiz do projeto:

- `mcp.json`
- `.mcp.json`

Use `.xcsh/mcp.json` quando quiser que o OMP seja o proprietário da configuração. Use `mcp.json` / `.mcp.json` na raiz apenas quando quiser um arquivo de fallback portátil que outros clientes MCP também possam ler.

## Adicionar uma referência de schema

Adicione esta linha no topo do arquivo para autocompletar e validação no editor:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {}
}
```

O OMP agora escreve isso automaticamente quando `/mcp add`, `/mcp enable`, `/mcp disable`, `/mcp reauth` ou outros fluxos de escrita de configuração criam ou atualizam um arquivo MCP gerenciado pelo OMP.

## Estrutura do arquivo

O OMP suporta esta estrutura de nível superior:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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

Chaves de nível superior:

- `$schema` — URL opcional do JSON Schema para ferramentas
- `mcpServers` — mapa de nome do servidor para configuração do servidor
- `disabledServers` — lista de bloqueio em nível de usuário usada para desativar servidores descobertos pelo nome

Os nomes dos servidores devem corresponder a `^[a-zA-Z0-9_.-]{1,100}$`.

## Campos de servidor suportados

Campos compartilhados para todos os transportes:

- `enabled?: boolean` — ignora este servidor quando `false`
- `timeout?: number` — timeout de conexão em milissegundos
- `auth?: { ... }` — metadados de autenticação usados pelo OMP para fluxos OAuth/API-key
- `oauth?: { ... }` — configurações explícitas de cliente OAuth usadas durante auth/reauth

### Transporte `stdio`

`stdio` é o padrão quando `type` é omitido.

Obrigatório:

- `command: string`

Opcional:

- `type?: "stdio"`
- `args?: string[]`
- `env?: Record<string, string>`
- `cwd?: string`

Exemplo:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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

Isso segue o pacote oficial do servidor MCP Filesystem (`@modelcontextprotocol/server-filesystem`).

### Transporte `http`

Obrigatório:

- `type: "http"`
- `url: string`

Opcional:

- `headers?: Record<string, string>`

Exemplo:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

Isso corresponde ao endpoint hospedado do servidor MCP do GitHub.

### Transporte `sse`

Obrigatório:

- `type: "sse"`
- `url: string`

Opcional:

- `headers?: Record<string, string>`

Exemplo:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "legacy-remote": {
      "type": "sse",
      "url": "https://example.com/mcp/sse"
    }
  }
}
```

`sse` ainda é suportado por compatibilidade, mas a especificação MCP agora prefere Streamable HTTP (`type: "http"`) para novos servidores.

## Campos de autenticação

O OMP compreende dois objetos relacionados à autenticação.

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

Use isso quando o OMP deve lembrar como reidratar credenciais para um servidor.

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

Use isso quando o servidor MCP requer configurações explícitas de cliente OAuth.

O Slack é o exemplo atual mais claro. O servidor MCP do Slack é hospedado em `https://mcp.slack.com/mcp`, usa Streamable HTTP e requer OAuth confidencial com as credenciais de cliente do seu aplicativo Slack.

Exemplo:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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

Endpoints relevantes do Slack na documentação do Slack:

- Endpoint MCP: `https://mcp.slack.com/mcp`
- Endpoint de autorização: `https://slack.com/oauth/v2_user/authorize`
- Endpoint de token: `https://slack.com/api/oauth.v2.user.access`

## Exemplos comuns para copiar e colar

### Servidor Filesystem via stdio

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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

### Servidor hospedado do GitHub via HTTP

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

### Servidor local do GitHub via Docker

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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

Isso corresponde à imagem Docker oficial local do GitHub `ghcr.io/github/github-mcp-server`.

### Servidor hospedado do Slack via OAuth

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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

## Segredos e resolução de variáveis

Esta é a parte que geralmente confunde as pessoas.

### Em `.xcsh/mcp.json` e `~/.xcsh/mcp.json`

Antes de o OMP iniciar um servidor ou fazer uma requisição HTTP, ele resolve os valores de `env` e `headers` desta forma:

1. Se um valor começa com `!`, o OMP o executa como um comando shell e usa o stdout sem espaços extras.
2. Caso contrário, o OMP primeiro verifica se o valor corresponde a um nome de variável de ambiente.
3. Se essa variável de ambiente não estiver definida, o OMP usa a string literalmente.

Exemplos:

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

Isso significa que o seguinte é válido e conveniente para segredos locais:

- `"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"` → copiar do ambiente shell atual
- `"Authorization": "Bearer hardcoded-token"` → usar o valor literal
- `"Authorization": "!printf 'Bearer %s' \"$GITHUB_TOKEN\""` → construir o header a partir de um comando

### Em `mcp.json` e `.mcp.json` na raiz

O carregador de fallback autônomo também expande `${VAR}` e `${VAR:-default}` dentro de strings durante a descoberta.

Exemplo:

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

Se você deseja o comportamento menos surpreendente do OMP, prefira `.xcsh/mcp.json` e use valores explícitos de env/header.

## `disabledServers`

`disabledServers` é principalmente útil no arquivo de configuração do usuário (`~/.xcsh/mcp.json`) quando um servidor é descoberto de outra fonte e você deseja que o OMP o ignore sem editar a configuração dessa outra ferramenta.

Exemplo:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "disabledServers": ["github", "slack"]
}
```

## `/mcp add` vs editar o JSON diretamente

Use `/mcp add` quando quiser uma configuração guiada.

Use a edição direta do JSON quando:

- você precisa de uma opção de transporte ou autenticação que o assistente ainda não oferece
- você deseja colar uma definição de servidor de outro cliente MCP
- você deseja validação baseada em schema no seu editor

Após editar, use:

- `/mcp reload` para redescobrir e reconectar servidores na sessão atual
- `/mcp list` para ver de qual arquivo de configuração um servidor veio
- `/mcp test <name>` para testar um único servidor

## Regras de validação que o OMP aplica

De `validateServerConfig()` em `packages/coding-agent/src/mcp/config.ts`:

- `stdio` requer `command`
- `http` e `sse` requerem `url`
- um servidor não pode definir tanto `command` quanto `url`
- valores de `type` desconhecidos são rejeitados

Implicações práticas:

- Omitir `type` significa `stdio`
- Se você colar uma configuração de servidor remoto e esquecer `"type": "http"`, o OMP tratará como `stdio` e reclamará que `command` está faltando
- `sse` permanece válido por compatibilidade, mas novos servidores hospedados geralmente devem ser configurados como `http`

## Descoberta e precedência

O OMP não mescla definições duplicadas de servidor entre arquivos. Os provedores de descoberta são priorizados, e a definição de maior prioridade prevalece.

Na prática:

- prefira `.xcsh/mcp.json` ou `~/.xcsh/mcp.json` quando quiser uma substituição específica do OMP
- mantenha os nomes dos servidores únicos entre ferramentas quando possível
- use `disabledServers` na configuração do usuário quando uma configuração de terceiros continua reintroduzindo um servidor que você não deseja

## Solução de problemas

### `Server "name": stdio server requires "command" field`

Você provavelmente omitiu `type: "http"` em um servidor remoto.

### `Server "name": both "command" and "url" are set`

Escolha um transporte. O OMP trata `command` como stdio e `url` como http/sse.

### `/mcp add` funcionou mas o servidor ainda não conecta

O JSON é válido, mas o servidor ainda pode estar inacessível. Use `/mcp test <name>` e verifique se:

- o binário ou imagem Docker existe
- as variáveis de ambiente necessárias estão definidas
- a URL remota está acessível
- o token OAuth ou API é válido

### O servidor existe na configuração de outra ferramenta mas não no OMP

Execute `/mcp list`. O OMP descobre muitos arquivos MCP de terceiros, mas o carregamento em nível de projeto também pode ser desabilitado através da configuração `mcp.enableProjectConfig`.

## Referências

- Especificação de transporte MCP: <https://modelcontextprotocol.io/specification/2025-03-26/basic/transports>
- Pacote do servidor Filesystem: <https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem>
- Servidor MCP do GitHub: <https://github.com/github/github-mcp-server>
- Documentação do servidor MCP do Slack: <https://docs.slack.dev/ai/slack-mcp-server/>
