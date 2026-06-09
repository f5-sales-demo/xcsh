---
title: Ciclo de Vida de Execução do MCP
description: >-
  Ciclo de vida do processo do servidor MCP desde a inicialização até o registro
  de ferramentas, monitoramento de saúde e encerramento.
sidebar:
  order: 3
  label: Ciclo de vida de execução
i18n:
  sourceHash: d04cefaf38f8
  translator: machine
---

# Ciclo de vida de execução do MCP

Este documento descreve como os servidores MCP são descobertos, conectados, expostos como ferramentas, atualizados e encerrados no runtime do coding-agent.

## Visão geral do ciclo de vida

1. **Inicialização do SDK** chama `discoverAndLoadMCPTools()` (a menos que o MCP esteja desabilitado).
2. **Descoberta** (`loadAllMCPConfigs`) resolve as configurações de servidores MCP a partir de fontes de capacidade, filtra entradas desabilitadas/de projeto/Exa e preserva metadados de origem.
3. **Fase de conexão do Manager** (`MCPManager.connectServers`) inicia conexão + `tools/list` por servidor em paralelo.
4. **Gate de inicialização rápida** aguarda até 250ms, depois pode retornar:
   - `MCPTool`s totalmente carregadas,
   - falhas por servidor,
   - ou `DeferredMCPTool`s em cache para servidores ainda pendentes.
5. **Vinculação do SDK** mescla as ferramentas MCP no registro de ferramentas do runtime para a sessão.
6. **Sessão ativa** pode atualizar ferramentas MCP via fluxos `/mcp` (`disconnectAll` + redescoberta + `session.refreshMCPTools`).
7. **Encerramento** acontece quando os chamadores invocam `disconnectServer`/`disconnectAll`; o manager também limpa os registros de ferramentas MCP para servidores desconectados.

## Fase de descoberta e carregamento

### Caminho de entrada a partir do SDK

`createAgentSession()` em `src/sdk.ts` realiza a inicialização do MCP quando `enableMCP` é true (padrão):

- chama `discoverAndLoadMCPTools(cwd, { ... })`,
- passa `authStorage`, armazenamento de cache e configuração `mcp.enableProjectConfig`,
- sempre define `filterExa: true`,
- registra erros de carregamento/conexão por servidor em log,
- armazena o manager retornado em `toolSession.mcpManager` e no resultado da sessão.

Se `enableMCP` for false, a descoberta do MCP é totalmente ignorada.

### Descoberta e filtragem de configuração

`loadAllMCPConfigs()` (`src/mcp/config.ts`) carrega itens canônicos de servidores MCP através da descoberta de capacidades, depois converte para o formato legado `MCPServerConfig`.

Comportamento de filtragem:

- `enableProjectConfig: false` remove entradas de nível de projeto (`_source.level === "project"`).
- Servidores com `enabled: false` são ignorados antes das tentativas de conexão.
- Servidores Exa são filtrados por padrão e as chaves de API são extraídas para integração nativa da ferramenta Exa.

O resultado inclui tanto `configs` quanto `sources` (metadados usados posteriormente para rotulagem de provedor).

### Comportamento de falha no nível de descoberta

`discoverAndLoadMCPTools()` distingue duas classes de falha:

- **Falha grave de descoberta** (exceção de `manager.discoverAndConnect`, tipicamente da descoberta de configuração): retorna um conjunto vazio de ferramentas e um erro sintético `{ path: ".mcp.json", error }`.
- **Falha de runtime/conexão por servidor**: o manager retorna sucesso parcial com mapa de `errors`; outros servidores continuam.

Portanto, a inicialização não falha toda a sessão do agente quando servidores MCP individuais falham.

## Modelo de estado do Manager

`MCPManager` rastreia o ciclo de vida de execução com registros separados:

- `#connections: Map<string, MCPServerConnection>` — servidores totalmente conectados.
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — handshake em andamento.
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — conectado, mas ferramentas ainda carregando.
- `#tools: CustomTool[]` — visão atual das ferramentas MCP exposta aos chamadores.
- `#sources: Map<string, SourceMeta>` — metadados de provedor/origem mesmo antes da conexão ser concluída.

`getConnectionStatus(name)` deriva o status a partir desses mapas:

- `connected` se estiver em `#connections`,
- `connecting` se estiver em conexão pendente ou carregamento de ferramenta pendente,
- `disconnected` caso contrário.

## Estabelecimento de conexão e temporização de inicialização

## Pipeline de conexão por servidor

Para cada servidor descoberto em `connectServers()`:

1. armazena/atualiza metadados de origem,
2. ignora se já conectado/pendente,
3. valida campos de transporte (`validateServerConfig`),
4. resolve substituições de autenticação/shell (`#resolveAuthConfig`),
5. chama `connectToServer(name, resolvedConfig)`,
6. chama `listTools(connection)`,
7. armazena definições de ferramentas em cache (`MCPToolCache.set`) com melhor esforço.

Comportamento de `connectToServer()` (`src/mcp/client.ts`):

- cria transporte stdio ou HTTP/SSE,
- executa `initialize` + `notifications/initialized` do MCP,
- usa timeout (`config.timeout` ou padrão de 30s),
- fecha o transporte em caso de falha na inicialização.

### Gate de inicialização rápida + fallback diferido

`connectServers()` aguarda em uma corrida entre:

- todas as tarefas de conexão/carregamento de ferramentas resolvidas, e
- `STARTUP_TIMEOUT_MS = 250`.

Após 250ms:

- tarefas concluídas tornam-se `MCPTool`s ativas,
- tarefas rejeitadas produzem erros por servidor,
- tarefas ainda pendentes:
  - usam definições de ferramentas em cache, se disponíveis (`MCPToolCache.get`), para criar `DeferredMCPTool`s,
  - caso contrário, bloqueiam até que essas tarefas pendentes sejam resolvidas.

Este é um modelo de inicialização híbrido: retorno rápido quando o cache está disponível, espera por correção quando não está.

### Comportamento de conclusão em segundo plano

Cada `toolsPromise` pendente também tem uma continuação em segundo plano que eventualmente:

- substitui a fatia de ferramentas daquele servidor no estado do manager via `#replaceServerTools`,
- escreve no cache,
- registra falhas tardias em log apenas após a inicialização (`allowBackgroundLogging`).

## Exposição de ferramentas e disponibilidade na sessão ativa

### Registro na inicialização

`discoverAndLoadMCPTools()` converte as ferramentas do manager em `LoadedCustomTool[]` e decora os caminhos (`mcp:<server> via <providerName>` quando conhecido).

`createAgentSession()` então insere essas ferramentas em `customTools`, que são encapsuladas e adicionadas ao registro de ferramentas do runtime com nomes como `mcp_<server>_<tool>`.

### Chamadas de ferramentas

- `MCPTool` chama ferramentas através de uma `MCPServerConnection` já conectada.
- `DeferredMCPTool` aguarda `waitForConnection(server)` antes de chamar; isso permite que ferramentas em cache existam antes da conexão estar pronta.

Ambas retornam saída estruturada da ferramenta e convertem erros de transporte/ferramenta em conteúdo `MCP error: ...` da ferramenta (abort permanece abort).

## Caminhos de atualização/recarregamento (inicialização vs recarregamento ao vivo)

### Caminho de inicialização inicial

- descoberta/carregamento único em `sdk.ts`,
- ferramentas são registradas no registro de ferramentas da sessão inicial.

### Caminho de recarregamento interativo

O caminho `/mcp reload` (`src/modes/controllers/mcp-command-controller.ts`) faz:

1. `mcpManager.disconnectAll()`,
2. `mcpManager.discoverAndConnect()`,
3. `session.refreshMCPTools(mcpManager.getTools())`.

`session.refreshMCPTools()` (`src/session/agent-session.ts`) remove todas as ferramentas `mcp_`, re-encapsula as ferramentas MCP mais recentes e reativa o conjunto de ferramentas para que as alterações do MCP se apliquem sem reiniciar a sessão.

Há também um caminho de acompanhamento para conexões tardias: após aguardar um servidor específico, se o status se tornar `connected`, ele re-executa `session.refreshMCPTools(...)` para que as ferramentas recém-disponíveis sejam revinculadas na sessão.

## Saúde, reconexão e comportamento de falha parcial

O comportamento atual do runtime é intencionalmente mínimo:

- **Sem monitor autônomo de saúde** no manager/cliente.
- **Sem loop de reconexão automática** quando um transporte cai.
- O manager não se inscreve em `onClose`/`onError` do transporte; o status é dirigido pelo registro.
- A reconexão é explícita: fluxo de recarregamento ou invocação direta de `connectServers()`.

Operacionalmente:

- a falha de um servidor não remove ferramentas de servidores saudáveis,
- falhas de conexão/listagem são isoladas por servidor,
- cache de ferramentas e atualizações em segundo plano são de melhor esforço (avisos/erros registrados em log, sem parada forçada).

## Semântica de encerramento

### Encerramento no nível do servidor

`disconnectServer(name)`:

- remove entradas pendentes/metadados de origem,
- fecha o transporte se conectado,
- remove as ferramentas `mcp_` daquele servidor do estado do manager.

### Encerramento global

`disconnectAll()`:

- fecha todos os transportes ativos com `Promise.allSettled`,
- limpa mapas pendentes, origens, conexões e lista de ferramentas do manager.

Na integração atual, o encerramento explícito é usado nos fluxos de comando MCP (para recarregar/remover/desabilitar). Não há um hook de descarte automático separado do manager no próprio caminho de inicialização; os chamadores são responsáveis por invocar os métodos de desconexão do manager quando precisam de um encerramento determinístico do MCP.

## Modos de falha e garantias

| Cenário | Comportamento | Falha grave vs melhor esforço |
| --- | --- | --- |
| Descoberta lança exceção (caminho de carregamento de capacidade/configuração) | Loader retorna ferramentas vazias + erro sintético `.mcp.json` | Inicialização da sessão com melhor esforço |
| Configuração de servidor inválida | Servidor ignorado com entrada de erro de validação | Melhor esforço por servidor |
| Timeout de conexão/falha na inicialização | Erro do servidor registrado; outros continuam | Melhor esforço por servidor |
| `tools/list` ainda pendente na inicialização com acerto no cache | Ferramentas diferidas retornadas imediatamente | Inicialização rápida com melhor esforço |
| `tools/list` ainda pendente na inicialização sem cache | Inicialização aguarda pendentes serem resolvidos | Espera forçada por correção |
| Falha tardia de carregamento de ferramentas em segundo plano | Registrado em log após o gate de inicialização | Registro em log com melhor esforço |
| Transporte caído em runtime | Sem reconexão automática; chamadas futuras falham até reconexão/recarregamento | Recuperação com melhor esforço via ação manual |

## Superfície da API pública

`src/mcp/index.ts` re-exporta APIs do loader/manager/cliente para chamadores externos. `src/sdk.ts` expõe `discoverMCPServers()` como um wrapper de conveniência retornando o mesmo formato de resultado do loader.

## Arquivos de implementação

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — fachada do loader, normalização de erros de descoberta, conversão de `LoadedCustomTool`.
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — registros de estado do ciclo de vida, fluxo paralelo de conexão/listagem, atualização/desconexão.
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — configuração de transporte, handshake de inicialização, listagem/chamada/desconexão.
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — exportações da API do módulo MCP.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — integração de inicialização na sessão/registro de ferramentas.
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — descoberta/filtragem/validação de configuração usada pelo manager.
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — comportamento em runtime de `MCPTool` e `DeferredMCPTool`.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — revinculação ao vivo de `refreshMCPTools`.
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — fluxos interativos de recarregamento/reconexão.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — proxy MCP de subagente via conexões do manager pai.
