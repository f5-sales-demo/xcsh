---
title: Armazenamento de Sessão e Modelo de Entradas
description: >-
  Modelo de armazenamento de sessão append-only com tipos de entrada,
  persistência e migração entre formatos.
sidebar:
  order: 1
  label: Armazenamento e modelo de entradas
i18n:
  sourceHash: 42fe17549e00
  translator: machine
---

# Armazenamento de Sessão e Modelo de Entradas

Este documento é a fonte de verdade sobre como as sessões do coding-agent são representadas, persistidas, migradas e reconstruídas em tempo de execução.

## Escopo

Abrange:

- Formato JSONL de sessão e versionamento
- Taxonomia de entradas e semântica de árvore (`id`/`parentId` + ponteiro de folha)
- Comportamento de migração/compatibilidade ao carregar arquivos antigos ou malformados
- Reconstrução de contexto (`buildSessionContext`)
- Garantias de persistência, comportamento em falhas, truncamento/externalização de blobs
- Abstrações de armazenamento (`FileSessionStorage`, `MemorySessionStorage`) e utilitários relacionados

Não abrange o comportamento de renderização da UI `/tree` além das semânticas que afetam os dados da sessão.

## Arquivos de Implementação

- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`src/session/messages.ts`](../../packages/coding-agent/src/session/messages.ts)
- [`src/session/session-storage.ts`](../../packages/coding-agent/src/session/session-storage.ts)
- [`src/session/history-storage.ts`](../../packages/coding-agent/src/session/history-storage.ts)
- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts)

## Layout em Disco

Localização padrão do arquivo de sessão:

```text
~/.xcsh/agent/sessions/--<cwd-encoded>--/<timestamp>_<sessionId>.jsonl
```

`<cwd-encoded>` é derivado do diretório de trabalho removendo a barra inicial e substituindo `/`, `\\` e `:` por `-`.

Localização do armazenamento de blobs:

```text
~/.xcsh/agent/blobs/<sha256>
```

Arquivos de breadcrumb do terminal são escritos em:

```text
~/.xcsh/agent/terminal-sessions/<terminal-id>
```

O conteúdo do breadcrumb possui duas linhas: o cwd original, seguido do caminho do arquivo de sessão. `continueRecent()` prefere este ponteiro com escopo de terminal antes de buscar pelo mtime mais recente.

## Formato do Arquivo

Arquivos de sessão são JSONL: um objeto JSON por linha.

- A linha 1 é sempre o cabeçalho da sessão (`type: "session"`).
- As linhas restantes são valores `SessionEntry`.
- Entradas são append-only em tempo de execução; a navegação de branches move um ponteiro (`leafId`) em vez de mutar entradas existentes.

### Cabeçalho (`SessionHeader`)

```json
{
  "type": "session",
  "version": 3,
  "id": "1f9d2a6b9c0d1234",
  "timestamp": "2026-02-16T10:20:30.000Z",
  "cwd": "/work/pi",
  "title": "optional session title",
  "parentSession": "optional lineage marker"
}
```

Observações:

- `version` é opcional em arquivos v1; ausência significa v1.
- `parentSession` é uma string opaca de linhagem. O código atual escreve um id de sessão ou um caminho de sessão dependendo do fluxo (`fork`, `forkFrom`, `createBranchedSession`, ou `newSession({ parentSession })` explícito). Trate como metadado, não como uma chave estrangeira tipada.

### Base de Entrada (`SessionEntryBase`)

Todas as entradas não-cabeçalho incluem:

```json
{
  "type": "...",
  "id": "8-char-id",
  "parentId": "previous-or-branch-parent",
  "timestamp": "2026-02-16T10:20:30.000Z"
}
```

`parentId` pode ser `null` para uma entrada raiz (primeiro append, ou após `resetLeaf()`).

## Taxonomia de Entradas

`SessionEntry` é a união de:

- `message`
- `thinking_level_change`
- `model_change`
- `compaction`
- `branch_summary`
- `custom`
- `custom_message`
- `label`
- `ttsr_injection`
- `session_init`
- `mode_change`

### `message`

Armazena um `AgentMessage` diretamente.

```json
{
  "type": "message",
  "id": "a1b2c3d4",
  "parentId": null,
  "timestamp": "2026-02-16T10:21:00.000Z",
  "message": {
    "role": "assistant",
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "content": [{ "type": "text", "text": "Done." }],
    "usage": { "input": 100, "output": 20, "cacheRead": 0, "cacheWrite": 0, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } },
    "timestamp": 1760000000000
  }
}
```

### `model_change`

```json
{
  "type": "model_change",
  "id": "b1c2d3e4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:21:30.000Z",
  "model": "openai/gpt-4o",
  "role": "default"
}
```

`role` é opcional; ausência é tratada como `default` na reconstrução de contexto.

### `thinking_level_change`

```json
{
  "type": "thinking_level_change",
  "id": "c1d2e3f4",
  "parentId": "b1c2d3e4",
  "timestamp": "2026-02-16T10:22:00.000Z",
  "thinkingLevel": "high"
}
```

### `compaction`

```json
{
  "type": "compaction",
  "id": "d1e2f3a4",
  "parentId": "c1d2e3f4",
  "timestamp": "2026-02-16T10:23:00.000Z",
  "summary": "Conversation summary",
  "shortSummary": "Short recap",
  "firstKeptEntryId": "a1b2c3d4",
  "tokensBefore": 42000,
  "details": { "readFiles": ["src/a.ts"] },
  "preserveData": { "hookState": true },
  "fromExtension": false
}
```

### `branch_summary`

```json
{
  "type": "branch_summary",
  "id": "e1f2a3b4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:24:00.000Z",
  "fromId": "a1b2c3d4",
  "summary": "Summary of abandoned path",
  "details": { "note": "optional" },
  "fromExtension": true
}
```

Se ramificando a partir da raiz (`branchFromId === null`), `fromId` é a string literal `"root"`.

### `custom`

Persistência de estado de extensão; ignorada por `buildSessionContext`.

```json
{
  "type": "custom",
  "id": "f1a2b3c4",
  "parentId": "e1f2a3b4",
  "timestamp": "2026-02-16T10:25:00.000Z",
  "customType": "my-extension",
  "data": { "state": 1 }
}
```

### `custom_message`

Mensagem fornecida por extensão que participa do contexto do LLM.

```json
{
  "type": "custom_message",
  "id": "a2b3c4d5",
  "parentId": "f1a2b3c4",
  "timestamp": "2026-02-16T10:26:00.000Z",
  "customType": "my-extension",
  "content": "Injected context",
  "display": true,
  "details": { "debug": false }
}
```

### `label`

```json
{
  "type": "label",
  "id": "b2c3d4e5",
  "parentId": "a2b3c4d5",
  "timestamp": "2026-02-16T10:27:00.000Z",
  "targetId": "a1b2c3d4",
  "label": "checkpoint"
}
```

`label: undefined` limpa um rótulo para o `targetId`.

### `ttsr_injection`

```json
{
  "type": "ttsr_injection",
  "id": "c2d3e4f5",
  "parentId": "b2c3d4e5",
  "timestamp": "2026-02-16T10:28:00.000Z",
  "injectedRules": ["ruleA", "ruleB"]
}
```

### `session_init`

```json
{
  "type": "session_init",
  "id": "d2e3f4a5",
  "parentId": "c2d3e4f5",
  "timestamp": "2026-02-16T10:29:00.000Z",
  "systemPrompt": "...",
  "task": "...",
  "tools": ["read", "edit"],
  "outputSchema": { "type": "object" }
}
```

### `mode_change`

```json
{
  "type": "mode_change",
  "id": "e2f3a4b5",
  "parentId": "d2e3f4a5",
  "timestamp": "2026-02-16T10:30:00.000Z",
  "mode": "plan",
  "data": { "planFile": "/tmp/plan.md" }
}
```

## Versionamento e Migração

Versão atual da sessão: `3`.

### v1 -> v2

Aplicada quando o `version` do cabeçalho está ausente ou `< 2`:

- Adiciona `id` e `parentId` a cada entrada não-cabeçalho.
- Reconstrói uma cadeia linear de parentesco usando a ordem do arquivo.
- Migra o campo de compactação `firstKeptEntryIndex` -> `firstKeptEntryId` quando presente.
- Define o `version = 2` do cabeçalho.

### v2 -> v3

Aplicada quando o `version` do cabeçalho `< 3`:

- Para entradas `message`: reescreve o legado `message.role === "hookMessage"` para `"custom"`.
- Define o `version = 3` do cabeçalho.

### Gatilho de Migração e Persistência

- As migrações são executadas durante o carregamento da sessão (`setSessionFile`).
- Se alguma migração foi executada, o arquivo inteiro é reescrito em disco imediatamente.
- A migração muta as entradas em memória primeiro e depois persiste o JSONL reescrito.

## Comportamento de Carregamento e Compatibilidade

Comportamento de `loadEntriesFromFile(path)`:

- Arquivo ausente (`ENOENT`) -> retorna `[]`.
- Linhas não parseáveis são tratadas pelo parser JSONL leniente (`parseJsonlLenient`).
- Se a primeira entrada parseada não for um cabeçalho de sessão válido (`type !== "session"` ou `id` string ausente) -> retorna `[]`.

Comportamento de `SessionManager.setSessionFile()`:

- `[]` do carregador é tratado como sessão vazia/inexistente e substituído por um novo arquivo de sessão inicializado naquele caminho.
- Arquivos válidos são carregados, migrados se necessário, referências de blob resolvidas e então indexados.

## Semântica de Árvore e Folha

O modelo subjacente é árvore append-only + ponteiro de folha mutável:

- Todo método de append cria exatamente uma nova entrada cujo `parentId` é o `leafId` atual.
- A nova entrada se torna o novo `leafId`.
- `branch(entryId)` move apenas o `leafId`; entradas existentes permanecem inalteradas.
- `resetLeaf()` define `leafId = null`; o próximo append cria uma nova entrada raiz (`parentId: null`).
- `branchWithSummary()` define a folha para o alvo do branch e faz append de uma entrada `branch_summary`.

`getEntries()` retorna todas as entradas não-cabeçalho na ordem de inserção. Entradas existentes não são deletadas em operação normal; reescritas preservam o histórico lógico enquanto atualizam a representação (migrações, movimentação, helpers de reescrita direcionada).

## Reconstrução de Contexto (`buildSessionContext`)

`buildSessionContext(entries, leafId, byId?)` resolve o que é enviado ao modelo.

Algoritmo:

1. Determinar a folha:
   - `leafId === null` -> retorna contexto vazio.
   - `leafId` explícito -> usa aquela entrada se encontrada.
   - caso contrário, fallback para a última entrada.
2. Percorrer a cadeia `parentId` da folha até a raiz e inverter para o caminho raiz->folha.
3. Derivar o estado de runtime ao longo do caminho:
   - `thinkingLevel` do `thinking_level_change` mais recente (padrão `"off"`)
   - mapa de modelos a partir das entradas `model_change` (`role ?? "default"`)
   - fallback `models.default` do provider/model da mensagem do assistente se não houver mudança explícita de modelo
   - `injectedTtsrRules` deduplicadas de todas as entradas `ttsr_injection`
   - mode/modeData do `mode_change` mais recente (modo padrão `"none"`)
4. Construir lista de mensagens:
   - Entradas `message` passam diretamente
   - Entradas `custom_message` se tornam `AgentMessages` `custom` via `createCustomMessage`
   - Entradas `branch_summary` se tornam `AgentMessages` `branchSummary` via `createBranchSummaryMessage`
   - Se uma `compaction` existir no caminho:
     - emite o resumo da compactação primeiro (`createCompactionSummaryMessage`)
     - emite entradas do caminho começando em `firstKeptEntryId` até o limite da compactação
     - emite entradas após o limite da compactação

Entradas `custom` e `session_init` não injetam contexto de modelo diretamente.

## Garantias de Persistência e Modelo de Falhas

### Persistir vs em memória

- `SessionManager.create/open/continueRecent/forkFrom` -> modo persistente (`persist = true`).
- `SessionManager.inMemory` -> modo não persistente (`persist = false`) com `MemorySessionStorage`.

### Pipeline de escrita

As escritas são serializadas através de uma cadeia interna de promises (`#persistChain`) e `NdjsonFileWriter`.

- `append*` atualiza o estado em memória imediatamente.
- A persistência é adiada até que pelo menos uma mensagem do assistente exista.
  - Antes do primeiro assistente: entradas são retidas em memória; nenhum append em arquivo ocorre.
  - Quando o primeiro assistente existe: toda a sessão em memória é descarregada no arquivo.
  - Depois disso: novas entradas são acrescentadas incrementalmente.

Justificativa no código: evitar persistir sessões que nunca produziram uma resposta do assistente.

### Operações de durabilidade

- `flush()` descarrega o writer e chama `fsync()`.
- Reescritas completas atômicas (`#rewriteFile`) escrevem em arquivo temporário, flush+fsync, close e então renomeiam sobre o alvo.
- Usadas para migrações, `setSessionName`, `rewriteEntries`, operações de movimentação e reescritas de argumentos de tool-call.

### Comportamento em erros

- Erros de persistência são registrados (`#persistError`) e relançados em operações subsequentes.
- O primeiro erro é logado uma vez com o contexto do arquivo de sessão.
- O close do writer é best-effort, mas propaga o primeiro erro significativo.

## Controles de Tamanho de Dados e Externalização de Blobs

Antes de persistir entradas:

- Strings grandes são truncadas para `MAX_PERSIST_CHARS` (500.000 caracteres) com aviso:
  - `"[Session persistence truncated large content]"`
- Campos transientes `partialJson` e `jsonlEvents` são removidos.
- Se o objeto possui tanto `content` quanto `lineCount`, a contagem de linhas é recalculada após o truncamento.
- Blocos de imagem em arrays `content` com comprimento base64 >= 1024 são externalizados para referências de blob:
  - armazenados como `blob:sha256:<hash>`
  - bytes brutos escritos no armazenamento de blobs (`BlobStore.put`)

Ao carregar, referências de blob são resolvidas de volta para base64 para blocos de imagem de message/custom_message.

## Abstrações de Armazenamento

A interface `SessionStorage` fornece todas as operações de sistema de arquivos usadas por `SessionManager`:

- síncronas: `ensureDirSync`, `existsSync`, `writeTextSync`, `statSync`, `listFilesSync`
- assíncronas: `exists`, `readText`, `readTextPrefix`, `writeText`, `rename`, `unlink`, `openWriter`

Implementações:

- `FileSessionStorage`: sistema de arquivos real (Bun + node fs)
- `MemorySessionStorage`: implementação em memória baseada em map para testes/sessões não persistentes

`SessionStorageWriter` expõe `writeLine`, `flush`, `fsync`, `close`, `getError`.

## Utilitários de Descoberta de Sessões

Definidos em `session-manager.ts`:

- `getRecentSessions(sessionDir, limit)` -> metadados leves para UI/seletor de sessão
- `findMostRecentSession(sessionDir)` -> mais recente por mtime
- `list(cwd, sessionDir?)` -> sessões em um escopo de projeto
- `listAll()` -> sessões em todos os escopos de projeto sob `~/.xcsh/agent/sessions`

A extração de metadados lê apenas um prefixo (`readTextPrefix(..., 4096)`) quando possível.

## Relacionado mas Distinto: Armazenamento de Histórico de Prompts

`HistoryStorage` (`history-storage.ts`) é um subsistema SQLite separado para recall/busca de prompts, não para replay de sessão.

- Banco de dados: `~/.xcsh/agent/history.db`
- Tabela: `history(id, prompt, created_at, cwd)`
- Índice FTS5: `history_fts` com sincronização mantida por trigger
- Deduplica prompts idênticos consecutivos usando cache em memória do último prompt
- Inserção assíncrona (`setImmediate`) para que a captura de prompt não bloqueie a execução do turno

Use arquivos de sessão para replay de grafo/estado de conversa; use `HistoryStorage` para a UX de histórico de prompts.
