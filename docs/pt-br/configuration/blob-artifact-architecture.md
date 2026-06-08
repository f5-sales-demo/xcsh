---
title: Arquitetura de Armazenamento de Blobs e Artefatos
description: >-
  Armazenamento de blobs endereçável por conteúdo e registro de artefatos para
  mídias de sessão, capturas de tela e saídas de ferramentas.
sidebar:
  order: 7
  label: Armazenamento de blobs e artefatos
i18n:
  sourceHash: 70d255f48d5b
  translator: machine
---

# Arquitetura de armazenamento de blobs e artefatos

Este documento descreve como o coding-agent armazena payloads grandes/binários fora do JSONL de sessão, como a saída truncada de ferramentas é persistida e como URLs internos (`artifact://`, `agent://`) são resolvidos de volta para dados armazenados.

## Por que dois sistemas de armazenamento existem

O runtime utiliza dois mecanismos de persistência diferentes para formatos de dados distintos:

- **Blobs endereçados por conteúdo** (`blob:sha256:<hash>`): armazenamento global, orientado a binários, usado para externalizar payloads grandes de imagens base64 das entradas de sessão persistidas.
- **Artefatos com escopo de sessão** (arquivos sob `<arquivoDeSessão-sem-.jsonl>/`): arquivos de texto por sessão usados para saídas completas de ferramentas e saídas de subagentes.

Eles são intencionalmente separados:

- o armazenamento de blobs otimiza a deduplicação e referências estáveis por hash de conteúdo,
- o armazenamento de artefatos otimiza o ferramental de sessão append-only e a recuperação por humanos/ferramentas por IDs locais.

## Limites de armazenamento e layout em disco

## Limite do armazenamento de blobs (global)

`SessionManager` constrói `BlobStore(getBlobsDir())`, então os arquivos de blobs ficam em um diretório global compartilhado de blobs (não em uma pasta de sessão).

Nomenclatura dos arquivos de blob:

- caminho do arquivo: `<blobsDir>/<sha256-hex>`
- sem extensão
- string de referência armazenada nas entradas: `blob:sha256:<sha256-hex>`

Implicações:

- o mesmo conteúdo binário entre sessões resolve para o mesmo hash/caminho,
- escritas são idempotentes no nível do conteúdo,
- blobs podem sobreviver a qualquer arquivo de sessão individual.

## Limite de artefatos (local à sessão)

`ArtifactManager` deriva o diretório de artefatos a partir do caminho do arquivo de sessão:

- arquivo de sessão: `.../<timestamp>_<sessionId>.jsonl`
- diretório de artefatos: `.../<timestamp>_<sessionId>/` (remove `.jsonl`)

Os tipos de artefatos compartilham este diretório:

- arquivos de saída truncada de ferramentas: `<numericId>.<toolType>.log` (para `artifact://`)
- arquivos de saída de subagentes: `<outputId>.md` (para `agent://`)

## Esquemas de alocação de IDs e nomes

## IDs de blob: hash de conteúdo

`BlobStore.put()` computa SHA-256 sobre os bytes binários brutos e retorna:

- `hash`: digest hexadecimal,
- `path`: `<blobsDir>/<hash>`,
- `ref`: `blob:sha256:<hash>`.

Nenhum contador local de sessão é utilizado.

## IDs de artefatos: inteiro monotônico local à sessão

`ArtifactManager` escaneia os arquivos de artefatos `*.log` existentes no primeiro uso para encontrar o ID numérico máximo existente e define `nextId = max + 1`.

Comportamento de alocação:

- formato do arquivo: `{id}.{toolType}.log`
- IDs são strings sequenciais (`"0"`, `"1"`, ...)
- a retomada não sobrescreve artefatos existentes porque o escaneamento ocorre antes da alocação.

Se o diretório de artefatos estiver ausente, o escaneamento retorna uma lista vazia e a alocação começa a partir de `0`.

## IDs de saída de agente (`agent://`)

`AgentOutputManager` aloca IDs para saídas de subagentes como `<index>-<requestedId>` (opcionalmente aninhado sob um prefixo pai, ex.: `0-Parent.1-Child`). Ele escaneia arquivos `.md` existentes na inicialização para continuar a partir do próximo índice na retomada.

## Fluxo de dados de persistência

## 1) Caminho de reescrita da persistência de entradas de sessão

Antes das entradas de sessão serem escritas (`#rewriteFile` / persistência incremental), `SessionManager` chama `prepareEntryForPersistence()` (via `truncateForPersistence`).

Comportamentos principais:

1. **Truncamento de strings grandes**: strings superdimensionadas são cortadas e sufixadas com `"[Session persistence truncated large content]"`.
2. **Remoção de campos transientes**: `partialJson` e `jsonlEvents` são removidos das entradas persistidas.
3. **Externalização de imagens para blobs**:
   - aplica-se apenas a blocos de imagem em arrays `content`,
   - apenas quando `data` ainda não é uma referência de blob,
   - apenas quando o comprimento base64 atinge pelo menos o limite (`BLOB_EXTERNALIZE_THRESHOLD = 1024`),
   - substitui base64 inline por `blob:sha256:<hash>`.

Isso mantém o JSONL de sessão compacto enquanto preserva a recuperabilidade.

## 2) Caminho de reidratação no carregamento da sessão

Ao abrir uma sessão (`setSessionFile`), após as migrações, `SessionManager` executa `resolveBlobRefsInEntries()`.

Para cada bloco de imagem de mensagem/mensagem-customizada com `blob:sha256:<hash>`:

- lê os bytes do blob a partir do armazenamento de blobs,
- converte os bytes de volta para base64,
- modifica a entrada em memória para inserir base64 inline para os consumidores em tempo de execução.

Se o blob estiver ausente:

- `resolveImageData()` registra um aviso,
- retorna a string de referência original sem alteração,
- o carregamento continua (sem crash).

## 3) Caminho de derramamento/truncamento de saída de ferramentas

`OutputSink` alimenta a saída em streaming em bash/python/ssh e executores relacionados.

Comportamento:

1. Cada chunk é sanitizado e adicionado ao buffer de cauda em memória.
2. Quando os bytes em memória excedem o limite de derramamento (`DEFAULT_MAX_BYTES`, 50KB), o sink marca a saída como truncada.
3. Se um caminho de artefato estiver disponível, o sink abre um escritor de arquivo e escreve:
   - o conteúdo já armazenado em buffer uma vez,
   - todos os chunks subsequentes.
4. O buffer em memória é sempre aparado para a janela de cauda para exibição.
5. `dump()` retorna um resumo incluindo `artifactId` apenas quando o escritor de arquivo foi criado com sucesso.

Efeito prático:

- UI/retorno da ferramenta mostra a cauda truncada,
- a saída completa é preservada no arquivo de artefato e referenciada como `artifact://<id>`.

Se a criação do escritor de arquivo falhar (erro de I/O, caminho ausente, etc.), o sink silenciosamente faz fallback para truncamento apenas em memória; a saída completa não é persistida.

## Modelo de acesso por URL

## Referências `blob:`

`blob:sha256:<hash>` é uma referência de persistência dentro dos payloads de entradas de sessão, não um esquema de URL interno tratado pelo roteador. A resolução é feita pelo `SessionManager` durante o carregamento da sessão.

## `artifact://<id>`

Tratado por `ArtifactProtocolHandler`:

- requer diretório de artefatos de sessão ativo,
- o ID deve ser numérico,
- resolve combinando o prefixo do nome do arquivo `<id>.`,
- retorna texto bruto (`text/plain`) do arquivo `.log` correspondente,
- quando ausente, o erro inclui a lista de IDs de artefatos disponíveis.

Comportamento com diretório ausente:

- se o diretório de artefatos não existir, lança `No artifacts directory found`.

## `agent://<id>`

Tratado por `AgentProtocolHandler` sobre `<artifactsDir>/<id>.md`:

- a forma simples retorna texto markdown,
- as formas `/path` ou `?q=` realizam extração JSON,
- extração por caminho e por query não podem ser combinadas,
- se a extração for solicitada, o conteúdo do arquivo deve ser parseável como JSON.

Comportamento com diretório ausente:

- lança `No artifacts directory found`.

Comportamento com saída ausente:

- lança `Not found: <id>` com IDs disponíveis a partir dos arquivos `.md` existentes.

Integração com a ferramenta read:

- `read` suporta paginação por offset/limit para leituras de URLs internos sem extração,
- rejeita `offset/limit` quando extração de `agent://` é utilizada.

## Semânticas de retomada, fork e movimentação

## Retomada

- `ArtifactManager` escaneia arquivos `{id}.*.log` existentes na primeira alocação e continua a numeração.
- `AgentOutputManager` escaneia IDs de saída `.md` existentes e continua a numeração.
- `SessionManager` reidrata referências de blob para base64 no carregamento.

## Fork

`SessionManager.fork()` cria um novo arquivo de sessão com novo ID de sessão e link `parentSession`, depois retorna os caminhos de arquivo antigo/novo. A cópia de artefatos é tratada por `AgentSession.fork()`:

- tenta cópia recursiva do diretório de artefatos antigo para o novo diretório de artefatos,
- diretório antigo ausente é tolerado,
- erros de cópia que não sejam ENOENT são registrados como avisos e o fork ainda é concluído.

Implicações de ID após o fork:

- se a cópia teve sucesso, os contadores de artefatos na nova sessão continuam após o ID máximo copiado,
- se a cópia falhou/foi pulada, os IDs de artefatos da nova sessão começam a partir de `0`.

Implicações de blob após o fork:

- blobs são globais e endereçados por conteúdo, então nenhuma cópia de diretório de blobs é necessária.

## Movimentação para novo cwd

`SessionManager.moveTo()` renomeia tanto o arquivo de sessão quanto o diretório de artefatos para o novo diretório de sessão padrão, com lógica de rollback se uma etapa posterior falhar. Isso preserva a identidade dos artefatos enquanto realoca o escopo da sessão.

## Tratamento de falhas e caminhos de fallback

| Caso | Comportamento |
| --- | --- |
| Arquivo de blob ausente durante reidratação | Avisa e mantém a string de referência `blob:sha256:` em memória |
| Blob read ENOENT via `BlobStore.get` | Retorna `null` |
| Diretório de artefatos ausente (`ArtifactManager.listFiles`) | Retorna lista vazia (alocação pode começar do zero) |
| Diretório de artefatos ausente (`artifact://` / `agent://`) | Lança explicitamente `No artifacts directory found` |
| ID de artefato não encontrado | Lança com listagem de IDs disponíveis |
| Falha na inicialização do escritor de artefato do OutputSink | Continua com truncamento apenas da cauda (sem artefato de saída completa) |
| Sem arquivo de sessão (alguns caminhos de tarefa) | Ferramenta Task faz fallback para diretório temporário de artefatos para saídas de subagentes |

## Externalização de blobs binários vs artefatos de saída de texto

- **Externalização de blobs** é para payloads de imagens binárias dentro do conteúdo de entradas de sessão persistidas; ela substitui base64 inline no JSONL com referências de conteúdo estáveis.
- **Artefatos** são arquivos de texto simples para saída de execução e saída de subagentes; eles são endereçáveis por IDs locais à sessão através de URLs internos.

Os dois sistemas se cruzam apenas indiretamente (ambos reduzem o inchaço do JSONL de sessão), mas possuem identidade, tempo de vida e caminhos de recuperação diferentes.

## Arquivos de implementação

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — formato de referência de blob, hashing, put/get, helpers de externalização/resolução.
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — modelo de diretório de artefatos de sessão e alocação de ID numérico de artefato.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — comportamento de truncamento/derramamento-para-arquivo do `OutputSink` e metadados de resumo.
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — transformações de persistência, reidratação de blob no carregamento, interações de fork/movimentação de sessão.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — cópia de diretório de artefatos durante fork interativo.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — bootstrap do gerenciador de artefatos de ferramentas e alocação de caminho de artefato por ferramenta.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — resolvedor de `artifact://`.
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — resolvedor de `agent://` + extração JSON.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — wiring do roteador de URLs internos e resolvedor de diretório de artefatos.
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — alocação de ID de saída de agente com escopo de sessão para `agent://`.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — escritas de artefatos de saída de subagentes (`<id>.md`) e fallback para diretório temporário de artefatos.
