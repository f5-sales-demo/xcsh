---
title: Protocolo MCP e Internos de Transporte
description: >-
  Implementação do protocolo MCP com camadas de transporte stdio, SSE e HTTP
  streamable.
sidebar:
  order: 2
  label: Protocolo e transportes
i18n:
  sourceHash: 48632064dd00
  translator: machine
---

# Protocolo MCP e Internos de Transporte

Este documento descreve como o coding-agent implementa o sistema de mensagens JSON-RPC do MCP e como as responsabilidades de protocolo são separadas das responsabilidades de transporte.

## Escopo

Aborda:

- Fluxo de requisição/resposta e notificação JSON-RPC
- Correlação de requisições e ciclo de vida para transportes stdio e HTTP/SSE
- Comportamento de timeout e cancelamento
- Propagação de erros e tratamento de payloads malformados
- Limites de seleção de transporte (`stdio` vs `http`/`sse`)
- Quais responsabilidades de reconexão/retry são do nível de transporte vs nível de gerenciador

Não aborda UX de criação de extensões ou UI de comandos.

## Arquivos de implementação

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/transports/stdio.ts`](../../packages/coding-agent/src/mcp/transports/stdio.ts)
- [`src/mcp/transports/http.ts`](../../packages/coding-agent/src/mcp/transports/http.ts)
- [`src/mcp/transports/index.ts`](../../packages/coding-agent/src/mcp/transports/index.ts)
- [`src/mcp/json-rpc.ts`](../../packages/coding-agent/src/mcp/json-rpc.ts)
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)

## Limites entre camadas

### Camada de protocolo (JSON-RPC + métodos MCP)

- Os formatos de mensagem são definidos em `types.ts` (`JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcResponse`, `JsonRpcMessage`).
- A lógica do cliente MCP (`client.ts`) decide a ordem dos métodos e o handshake de sessão:
  1. Requisição `initialize`
  2. Notificação `notifications/initialized`
  3. Chamadas de métodos como `tools/list`, `tools/call`

### Camada de transporte (`MCPTransport`)

`MCPTransport` abstrai a entrega e o ciclo de vida:

- `request(method, params, options?) -> Promise<T>`
- `notify(method, params?) -> Promise<void>`
- `close()`
- `connected`
- callbacks opcionais: `onClose`, `onError`, `onNotification`

As implementações de transporte são responsáveis pelo enquadramento e detalhes de I/O:

- `StdioTransport`: JSON delimitado por nova linha sobre stdio de subprocesso
- `HttpTransport`: JSON-RPC sobre HTTP POST, com respostas/escuta SSE opcionais

### Ressalva importante atual

Os callbacks de transporte (`onClose`, `onError`, `onNotification`) estão implementados, mas os fluxos atuais de `MCPClient`/`MCPManager` não conectam lógica de reconexão a esses callbacks. Notificações só são consumidas se o chamador registrar handlers.

## Seleção de transporte

`client.ts:createTransport()` escolhe o transporte a partir da configuração:

- `type` omitido ou `"stdio"` -> `createStdioTransport`
- `"http"` ou `"sse"` -> `createHttpTransport`

`"sse"` é tratado como uma variante de transporte HTTP (mesma classe), não como uma implementação de transporte separada.

## Fluxo de mensagens JSON-RPC e correlação

## IDs de requisição

Cada transporte gera IDs por requisição (string `Math.random` + timestamp). Os IDs são tokens de correlação locais ao transporte.

## Caminho de correlação stdio

- A requisição de saída é serializada como um objeto JSON + `\n`.
- `#pendingRequests: Map<id, {resolve,reject}>` armazena as requisições em andamento.
- O loop de leitura faz parsing de JSONL do stdout e chama `#handleMessage`.
- Se a mensagem de entrada tem um `id` correspondente, a requisição é resolvida/rejeitada.
- Se a mensagem de entrada tem `method` e não tem `id`, é tratada como notificação e enviada para `onNotification`.

IDs desconhecidos são ignorados (sem rejeição, sem callback de erro).

## Caminho de correlação HTTP

- A requisição de saída é um HTTP `POST` com corpo JSON e `id` gerado.
- Caminho de resposta não-SSE: faz parsing de uma resposta JSON-RPC e retorna `result`/lança erro em `error`.
- Caminho de resposta SSE (`Content-Type: text/event-stream`): transmite eventos em stream, retorna a primeira mensagem cujo `id` corresponde ao ID da requisição esperada e tem `result` ou `error`.
- Mensagens SSE com `method` e sem `id` são tratadas como notificações.

Se o stream SSE termina antes da resposta correspondente, a requisição falha com `No response received for request ID ...`.

## Notificações

O cliente emite notificações JSON-RPC via `transport.notify(...)`.

- Stdio: escreve o frame de notificação no stdin (`jsonrpc`, `method`, `params` opcional) mais nova linha.
- HTTP: envia corpo POST sem `id`; sucesso aceita `2xx` ou `202 Accepted`.

Notificações iniciadas pelo servidor são surfaceadas apenas através do `onNotification` do transporte; não há assinante global padrão no gerenciador/cliente.

## Internos do transporte stdio

## Ciclo de vida e transições de estado

- Inicial: `connected=false`, `process=null`, mapa de pendentes vazio
- `connect()`:
  - cria subprocesso com comando/args/env/cwd configurados
  - marca como conectado
  - inicia loop de leitura do stdout (`readJsonl`)
  - inicia loop do stderr (leitura/descarte; atualmente silencioso)
- `close()`:
  - marca como desconectado
  - rejeita todas as requisições pendentes (`Transport closed`)
  - encerra o subprocesso
  - aguarda o encerramento do loop de leitura
  - emite `onClose`

Se o loop de leitura termina inesperadamente, o `finally` aciona `#handleClose()` que realiza a mesma rejeição de requisições pendentes e callback de fechamento.

## Timeout e cancelamento

Por requisição:

- timeout padrão é `config.timeout ?? 30000`
- `AbortSignal` opcional do chamador
- abort e timeout rejeitam a promise pendente e limpam a entrada do mapa

O cancelamento é apenas local: o transporte não envia notificação de cancelamento em nível de protocolo para o servidor.

## Tratamento de payload malformado

No loop de leitura:

- cada linha JSONL parseada é passada para `#handleMessage` em `try/catch`
- exceções de tratamento de mensagens malformadas/inválidas são descartadas (comentário `Skip malformed lines`)
- o loop continua, então uma mensagem ruim não encerra a conexão

Se o parser do stream subjacente lança exceção, `onError` é invocado (quando ainda conectado), então a conexão é fechada.

## Comportamento de desconexão/falha

Quando o processo encerra ou o stream fecha:

- todas as requisições em andamento são rejeitadas com `Transport closed`
- sem reinício ou reconexão automática
- camadas superiores devem reconectar criando um novo transporte

## Notas sobre backpressure/streaming

- Escritas de saída usam `stdin.write()` + `flush()` sem aguardar semântica de drain.
- Não há gerenciamento explícito de fila ou high-watermark no transporte.
- O processamento de entrada é orientado por stream (`for await` sobre `readJsonl`), uma mensagem parseada por vez.

## Internos do transporte HTTP/SSE

## Ciclo de vida e semântica de conexão

O transporte HTTP tem estado lógico de conexão, mas o caminho de requisição é stateless por chamada HTTP:

- `connect()` define `connected=true` (sem handshake de socket/sessão)
- rastreamento opcional de sessão do servidor via header `Mcp-Session-Id`
- `close()` opcionalmente envia `DELETE` com `Mcp-Session-Id`, aborta o listener SSE, emite `onClose`

Portanto, `connected` significa "transporte utilizável", não "stream persistente estabelecido".

## Comportamento do header de sessão

- Na resposta do POST, se o header `Mcp-Session-Id` estiver presente, o transporte o armazena.
- Requisições/notificações subsequentes incluem `Mcp-Session-Id`.
- `close()` tenta encerrar a sessão do servidor com HTTP DELETE; falhas de encerramento são ignoradas.

## Timeout e cancelamento

Para `request()` e `notify()`:

- timeout usa `AbortController` (`config.timeout ?? 30000`)
- signal externo, se fornecido, é mesclado via `AbortSignal.any([...])`
- tratamento de AbortError distingue abort do chamador vs timeout

Erros lançados:

- timeout: `Request timeout after ...ms` (ou `SSE response timeout ...`, `Notify timeout ...`)
- abort do chamador: AbortError original é relançado quando o signal externo já está abortado

## Propagação de erro HTTP

Em resposta não-OK:

- texto da resposta é incluído no erro lançado (`HTTP <status>: <text>`)
- se presente, dicas de autenticação de `WWW-Authenticate` e `Mcp-Auth-Server` são anexadas

Em objeto de erro JSON-RPC:

- lança `MCP error <code>: <message>`

Corpo JSON malformado (falha em `response.json()`) propaga como exceção de parsing.

## Comportamento e modos SSE

Dois caminhos SSE existem:

1. **Resposta SSE por requisição** (`#parseSSEResponse`)
   - usado quando o content type da resposta POST é `text/event-stream`
   - consome o stream até encontrar o id de resposta correspondente
   - pode processar notificações intercaladas durante o mesmo stream

2. **Listener SSE em background** (`startSSEListener()`)
   - listener GET opcional para notificações iniciadas pelo servidor
   - atualmente não é iniciado automaticamente pelo gerenciador/cliente MCP
   - se GET retorna `405`, o listener se desabilita silenciosamente (servidor não suporta este modo)

## Tratamento de payload malformado e desconexão

Erros de parsing JSON no SSE propagam de `readSseJson` e rejeitam a requisição/listener.

- Erros de parsing SSE na requisição rejeitam a requisição ativa.
- Erros no listener em background acionam `onError` (exceto AbortError).
- Sem reconexão automática para o listener em background.

## Utilitário `json-rpc.ts` vs abstração de transporte

`src/mcp/json-rpc.ts` fornece os helpers `callMCP()` e `parseSSE()` para chamadas MCP HTTP diretas (usado pela integração Exa), não a abstração `MCPTransport` usada por `MCPClient`/`MCPManager`.

Diferenças notáveis em relação ao `HttpTransport`:

- faz parsing do texto completo da resposta primeiro, depois extrai a primeira linha `data:` (`parseSSE`), com fallback para JSON
- sem gerenciamento de timeout de requisição, sem API de abort, sem tratamento de session-id, sem ciclo de vida de transporte
- retorna o envelope JSON-RPC bruto

Este caminho é leve, mas menos robusto que a implementação completa de transporte.

## Responsabilidades de retry/reconexão

## Nível de transporte

As implementações atuais de transporte **não**:

- retentam requisições com falha
- reconectam após saída do processo stdio
- reconectam listeners SSE
- reenviam requisições em andamento após desconexão

Elas falham rapidamente e propagam erros.

## Nível de gerenciador/cliente

`MCPManager` gerencia a descoberta/orquestração de conexão inicial e pode reconectar apenas executando os fluxos de conexão novamente (caminhos `connectToServer`/`discoverAndConnect`). Ele não recupera automaticamente um transporte já conectado em callbacks de falha em tempo de execução.

`MCPManager` possui comportamento de fallback na inicialização para servidores lentos (ferramentas adiadas do cache), mas isso é fallback de disponibilidade de ferramentas, não retry de transporte.

## Resumo de cenários de falha

- **Linha de mensagem stdio malformada**: descartada; stream continua.
- **Stream/processo stdio encerra**: transporte fecha; requisições pendentes rejeitadas como `Transport closed`.
- **HTTP não-2xx**: requisição/notificação lança erro HTTP.
- **Resposta JSON inválida**: exceção de parsing propagada.
- **SSE encerra sem id correspondente**: requisição falha com `No response received for request ID ...`.
- **Timeout**: erro de timeout específico do transporte.
- **Abort do chamador**: AbortError/razão propagado do signal do chamador.

## Regra prática de limites

Se a preocupação é formato de mensagem, correlação de id ou ordenação de métodos MCP, pertence à lógica de protocolo/cliente.

Se a preocupação é enquadramento (JSONL vs HTTP/SSE), parsing de stream, ciclo de vida de fetch/spawn, relógios de timeout ou encerramento de conexão, pertence à implementação de transporte.
