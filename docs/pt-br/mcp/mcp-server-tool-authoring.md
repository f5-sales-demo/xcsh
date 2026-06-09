---
title: Criação de Servidores e Ferramentas MCP
description: >-
  Guia para construção de servidores MCP personalizados e registro de
  ferramentas para o coding agent.
sidebar:
  order: 4
  label: Criação de servidores e ferramentas
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# Criação de servidores e ferramentas MCP

Este documento explica como as definições de servidores MCP se tornam ferramentas `mcp_*` chamáveis no coding-agent, e o que os operadores devem esperar quando as configurações são inválidas, duplicadas, desabilitadas ou protegidas por autenticação.

## Arquitetura em resumo

```text
Config sources (.xcsh/.claude/.cursor/.vscode/mcp.json, mcp.json, etc.)
  -> discovery providers normalize to canonical MCPServer
  -> capability loader dedupes by server name (higher provider priority wins)
  -> loadAllMCPConfigs converts to MCPServerConfig + skips enabled:false
  -> MCPManager connects/listTools (with auth/header/env resolution)
  -> MCPTool/DeferredMCPTool bridge exposes tools as mcp_<server>_<tool>
  -> AgentSession.refreshMCPTools replaces live MCP tools immediately
```

## 1) Modelo de configuração do servidor e validação

`src/mcp/types.ts` define a estrutura de autoria usada por escritores de configuração MCP e pelo runtime:

- `stdio` (padrão quando `type` está ausente): requer `command`, opcionais `args`, `env`, `cwd`
- `http`: requer `url`, opcionais `headers`
- `sse`: requer `url`, opcionais `headers` (mantido por compatibilidade)
- campos compartilhados: `enabled`, `timeout`, `auth`

`validateServerConfig()` (`src/mcp/config.ts`) impõe os requisitos básicos de transporte:

- rejeita configurações que definem tanto `command` quanto `url`
- requer `command` para stdio
- requer `url` para http/sse
- rejeita `type` desconhecido

`config-writer.ts` aplica esta validação para operações de adição/atualização e também valida nomes de servidores:

- não vazio
- máximo de 100 caracteres
- apenas `[a-zA-Z0-9_.-]`

### Armadilhas de transporte

- `type` omitido significa stdio. Se você pretendia HTTP/SSE mas omitiu `type`, `command` se torna obrigatório.
- `sse` ainda é aceito mas tratado internamente como transporte HTTP (`createHttpTransport`).
- A validação é estrutural, não de acessibilidade: uma URL sintaticamente válida ainda pode falhar no momento da conexão.

## 2) Descoberta, normalização e precedência

### Descoberta baseada em capacidades

`loadAllMCPConfigs()` (`src/mcp/config.ts`) carrega itens canônicos `MCPServer` via `loadCapability(mcpCapability.id)`.

A camada de capacidades (`src/capability/index.ts`) então:

1. carrega provedores em ordem de prioridade
2. deduplica por `server.name` (primeira ocorrência vence = maior prioridade)
3. valida os itens deduplicados

Resultado: nomes de servidores duplicados entre fontes não são mesclados. Uma definição vence; duplicatas de menor prioridade são sombreadas.

### `.mcp.json` e arquivos relacionados

O provedor de fallback dedicado em `src/discovery/mcp-json.ts` lê `mcp.json` e `.mcp.json` da raiz do projeto (baixa prioridade).

Na prática, servidores MCP também vêm de provedores de maior prioridade (por exemplo, `.xcsh/...` nativo e diretórios de configuração específicos de ferramentas). Orientação de autoria:

- Prefira `.xcsh/mcp.json` (projeto) ou `~/.xcsh/mcp.json` (usuário) para controle explícito.
- Use `mcp.json` / `.mcp.json` na raiz quando precisar de compatibilidade de fallback.
- Reutilizar o mesmo nome de servidor em múltiplas fontes causa sombreamento por precedência, não mesclagem.

### Comportamento de normalização

`convertToLegacyConfig()` (`src/mcp/config.ts`) mapeia `MCPServer` canônico para `MCPServerConfig` de runtime.

Comportamento principal:

- transporte inferido como `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- servidores desabilitados (`enabled === false`) são descartados antes da conexão
- campos opcionais são preservados quando presentes

### Expansão de variáveis de ambiente durante a descoberta

`mcp-json.ts` expande placeholders de variáveis de ambiente em campos string com `expandEnvVarsDeep()`:

- suporta `${VAR}` e `${VAR:-default}`
- valores não resolvidos permanecem como strings literais `${VAR}`

`mcp-json.ts` também realiza verificações de tipo em runtime para JSON do usuário e registra avisos para valores inválidos de `enabled`/`timeout` em vez de falhar completamente o arquivo inteiro.

## 3) Autenticação e resolução de valores em runtime

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) é a passagem final antes da conexão.

### Injeção de credenciais OAuth

Se a configuração possui:

```ts
auth: { type: "oauth", credentialId: "..." }
```

e a credencial existe no armazenamento de autenticação:

- `http`/`sse`: injeta header `Authorization: Bearer <access_token>`
- `stdio`: injeta variável de ambiente `OAUTH_ACCESS_TOKEN`

Se a busca da credencial falhar, o manager registra um aviso e continua com autenticação não resolvida.

### Resolução de valores de headers/env

Antes da conexão, o manager resolve cada valor de header/env via `resolveConfigValue()` (`src/config/resolve-config-value.ts`):

- valor começando com `!` => executa comando shell, usa stdout com trim (em cache)
- caso contrário, trata o valor como nome de variável de ambiente primeiro (`process.env[name]`), fallback para valor literal
- valores de comando/env não resolvidos são omitidos do mapa final de headers/env

Ressalva operacional: isso significa que um comando/chave de env de secret com erro de digitação pode silenciosamente remover aquela entrada de header/env, produzindo falhas 401/403 downstream ou falhas na inicialização do servidor.

## 4) Bridge de ferramentas: MCP -> ferramentas chamáveis pelo agente

`src/mcp/tool-bridge.ts` converte definições de ferramentas MCP em `CustomTool`s.

### Nomeação e domínio de colisão

Nomes de ferramentas são gerados como:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

Regras:

- converte para minúsculas
- caracteres não-`[a-z_]` se tornam `_`
- underscores repetidos são colapsados
- prefixo redundante `<server>_` no nome da ferramenta é removido uma vez

Isso evita muitas colisões, mas não todas. Nomes brutos diferentes ainda podem ser sanitizados para o mesmo identificador (por exemplo `my-server` e `my.server` ambos sanitizam de forma similar), e a inserção no registro é last-write-wins (última escrita vence).

### Mapeamento de schema

`convertSchema()` mantém o JSON Schema do MCP praticamente como está, mas corrige schemas de objeto sem `properties` com `{}` para compatibilidade com provedores.

### Mapeamento de execução

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- chama `tools/call` do MCP
- achata o conteúdo MCP em texto exibível
- retorna detalhes estruturados (`serverName`, `mcpToolName`, metadados do provedor)
- mapeia `isError` reportado pelo servidor para resultado de texto `Error: ...`
- mapeia falhas de transporte/runtime lançadas para `MCP error: ...`
- preserva semântica de abort traduzindo AbortError em `ToolAbortError`

## 5) Ciclo de vida do operador: adicionar/editar/remover e atualizações em tempo real

O modo interativo expõe `/mcp` em `src/modes/controllers/mcp-command-controller.ts`.

Operações suportadas:

- `add` (assistente ou adição rápida)
- `remove` / `rm`
- `enable` / `disable`
- `test`
- `reauth` / `unauth`
- `reload`

Escritas de configuração são atômicas (`writeMCPConfigFile`: arquivo temporário + renomeação).

Após as alterações, o controller chama `#reloadMCP()`:

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

`refreshMCPTools()` substitui todas as entradas `mcp_` do registro e imediatamente reativa o conjunto mais recente de ferramentas MCP, então as alterações entram em vigor sem reiniciar a sessão.

### Diferenças entre modos

- **Modo interativo/TUI**: `/mcp` fornece UX no aplicativo (assistente, fluxo OAuth, texto de status da conexão, rebinding imediato em runtime).
- **Integração SDK/headless**: `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) retorna ferramentas carregadas + erros por servidor; sem UX do comando `/mcp`.

## 6) Superfícies de erro visíveis ao usuário

Strings de erro comuns que usuários/operadores veem:

- falhas de validação ao adicionar/atualizar:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- problemas de argumentos na adição rápida:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- falhas de conexão/teste:
  - `Failed to connect to "<name>": <message>`
  - texto de ajuda sobre timeout sugere aumentar o timeout
  - texto de ajuda sobre auth para `401/403`
- fluxos de auth/OAuth:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- uso de servidor desabilitado:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

JSON de fonte inválido na descoberta é geralmente tratado como avisos/logs; caminhos do config-writer lançam erros explícitos.

## 7) Orientação prática de autoria

Para autoria robusta de MCP nesta codebase:

1. Mantenha nomes de servidores globalmente únicos em todas as fontes de configuração compatíveis com MCP.
2. Prefira nomes alfanuméricos/underscore para evitar colisões de nomes sanitizados nos nomes de ferramentas `mcp_*` gerados.
3. Use `type` explícito para evitar defaults acidentais de stdio.
4. Trate `enabled: false` como desligamento total: o servidor é omitido do conjunto de conexão em runtime.
5. Para configurações OAuth, armazene um `credentialId` válido; caso contrário, a injeção de auth é ignorada.
6. Se estiver usando resolução de secrets baseada em comando (`!cmd`), verifique se a saída do comando é estável e não vazia.

## Arquivos de implementação

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
