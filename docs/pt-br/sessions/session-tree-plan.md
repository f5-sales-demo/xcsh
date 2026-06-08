---
title: Arquitetura de Árvore de Sessão
description: >-
  Arquitetura de árvore de sessão com ramificação, navegação e relacionamentos
  de conversação pai-filho.
sidebar:
  order: 2
  label: Arquitetura de árvore
i18n:
  sourceHash: bd8b78d6c33a
  translator: machine
---

# Arquitetura de árvore de sessão (atual)

Referência: [session.md](./session.md)

Este documento descreve como a navegação na árvore de sessão funciona atualmente: modelo de árvore em memória, regras de movimentação de folha, comportamento de ramificação e integração de extensões/eventos.

## O que é este subsistema

A sessão é armazenada como um log de entradas somente-adição (append-only), mas o comportamento em tempo de execução é baseado em árvore:

- Toda entrada que não é cabeçalho possui `id` e `parentId`.
- A posição ativa é `leafId` no `SessionManager`.
- Adicionar uma entrada sempre cria um filho da folha atual.
- A ramificação **não** reescreve o histórico; ela apenas altera para onde a folha aponta antes do próximo append.

Arquivos-chave:

- `src/session/session-manager.ts` — modelo de dados da árvore, travessia, movimentação de folha, extração de branch/sessão
- `src/session/agent-session.ts` — fluxo de navegação `/tree`, sumarização, emissão de hooks/eventos
- `src/modes/components/tree-selector.ts` — comportamento interativo da UI de árvore e filtragem
- `src/modes/controllers/selector-controller.ts` — orquestração do seletor para `/tree` e `/branch`
- `src/modes/controllers/input-controller.ts` — roteamento de comandos (`/tree`, `/branch`, comportamento de duplo-escape)
- `src/session/messages.ts` — conversão de entradas `branch_summary`, `compaction` e `custom_message` em mensagens de contexto para LLM

## Modelo de dados da árvore no `SessionManager`

Índices em tempo de execução:

- `#byId: Map<string, SessionEntry>` — busca rápida para qualquer entrada
- `#leafId: string | null` — posição atual na árvore
- `#labelsById: Map<string, string>` — rótulos resolvidos pelo id da entrada alvo

APIs da árvore:

- `getBranch(fromId?)` percorre os links de pai até a raiz e retorna o caminho raiz→nó
- `getTree()` retorna `SessionTreeNode[]` (`entry`, `children`, `label`)
  - links de pai se tornam arrays de filhos
  - entradas com pais ausentes são tratadas como raízes
  - filhos são ordenados do mais antigo→mais recente por timestamp
- `getChildren(parentId)` retorna os filhos diretos
- `getLabel(id)` resolve o rótulo atual de `labelsById`

`getTree()` é uma projeção em tempo de execução; a persistência permanece como entradas JSONL somente-adição.

## Semântica de movimentação de folha

Existem três primitivas de movimentação de folha:

1. `branch(entryId)`
   - Valida que a entrada existe
   - Define `leafId = entryId`
   - Nenhuma nova entrada é escrita

2. `resetLeaf()`
   - Define `leafId = null`
   - O próximo append cria uma nova entrada raiz (`parentId = null`)

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - Aceita `branchFromId: string | null`
   - Define `leafId = branchFromId`
   - Adiciona uma entrada `branch_summary` como filho dessa folha
   - Quando `branchFromId` é `null`, `fromId` é persistido como `"root"`

## Comportamento de navegação `/tree` (mesmo arquivo de sessão)

`AgentSession.navigateTree()` é navegação, não bifurcação de arquivo.

Fluxo:

1. Validar o alvo e computar o caminho abandonado (`collectEntriesForBranchSummary`)
2. Emitir `session_before_tree` com `TreePreparation`
3. Opcionalmente sumarizar entradas abandonadas (resumo fornecido por hook ou sumarizador integrado)
4. Computar o novo alvo da folha:
   - selecionando uma mensagem de **usuário**: a folha move para o pai, e o texto da mensagem é retornado para preenchimento do editor
   - selecionando uma **custom_message**: mesma regra de mensagem de usuário (folha = pai, texto preenche o editor)
   - selecionando qualquer outra entrada: folha = id da entrada selecionada
5. Aplicar movimentação da folha:
   - com resumo: `branchWithSummary(newLeafId, ...)`
   - sem resumo e `newLeafId === null`: `resetLeaf()`
   - caso contrário: `branch(newLeafId)`
6. Reconstruir o contexto do agente a partir da nova folha e emitir `session_tree`

Importante: entradas de resumo são anexadas na **nova posição de navegação**, não na cauda do branch abandonado.

## Comportamento do `/branch` (novo arquivo de sessão)

`/branch` e `/tree` são intencionalmente diferentes:

- `/tree` navega dentro do arquivo de sessão atual.
- `/branch` cria um novo arquivo de branch de sessão (ou substituição em memória para modo não-persistente).

Fluxo do `/branch` voltado ao usuário (`SelectorController.showUserMessageSelector` → `AgentSession.branch`):

- A origem do branch deve ser uma **mensagem de usuário**.
- O texto do usuário selecionado é extraído para preenchimento do editor.
- Se a mensagem de usuário selecionada é raiz (`parentId === null`): inicia uma nova sessão via `newSession({ parentSession: previousSessionFile })`.
- Caso contrário: `createBranchedSession(selectedEntry.parentId)` para bifurcar o histórico até o limite do prompt selecionado.

Especificidades do `SessionManager.createBranchedSession(leafId)`:

- Constrói o caminho raiz→folha via `getBranch(leafId)`; lança exceção se ausente.
- Exclui entradas `label` existentes do caminho copiado.
- Reconstrói entradas de rótulo novas a partir de `labelsById` resolvidos para entradas que permanecem no caminho.
- Modo persistente: escreve novo arquivo JSONL e alterna o manager para ele; retorna o novo caminho do arquivo.
- Modo em memória: substitui as entradas em memória; retorna `undefined`.

## Reconstrução de contexto e integração de resumo/custom

`buildSessionContext()` (em `session-manager.ts`) resolve o caminho ativo raiz→folha e constrói o estado efetivo de contexto do LLM:

- Rastreia o estado mais recente de thinking/model/mode/ttsr no caminho.
- Trata a compactação mais recente no caminho:
  - emite o resumo de compactação primeiro
  - reproduz as mensagens mantidas de `firstKeptEntryId` até o ponto de compactação
  - depois reproduz as mensagens pós-compactação
- Inclui entradas `branch_summary` e `custom_message` como objetos `AgentMessage`.

`session/messages.ts` então mapeia esses tipos de mensagem para entrada do modelo:

- `branchSummary` e `compactionSummary` se tornam mensagens de contexto com template na role de usuário
- `custom`/`hookMessage` se tornam mensagens de conteúdo na role de usuário

Portanto, a movimentação na árvore altera o contexto mudando o caminho ativo da folha, não mutando entradas antigas.

## Rótulos e comportamento da UI de árvore

Persistência de rótulos:

- `appendLabelChange(targetId, label?)` escreve entradas `label` na cadeia da folha atual.
- `labelsById` é atualizado imediatamente (definir ou deletar).
- `getTree()` resolve o rótulo atual em cada nó retornado.

Comportamento do seletor de árvore (`tree-selector.ts`):

- Achata a árvore para navegação, mantém destaque do caminho ativo e prioriza a exibição do branch ativo primeiro.
- Suporta modos de filtro: `default`, `no-tools`, `user-only`, `labeled-only`, `all`.
- Suporta busca de texto livre sobre conteúdo semântico renderizado.
- `Shift+L` abre edição inline de rótulo e escreve via `appendLabelChange`.

Roteamento de comandos:

- `/tree` sempre abre o seletor de árvore.
- `/branch` abre o seletor de mensagens de usuário, a menos que `doubleEscapeAction=tree`, caso em que também usa a UX do seletor de árvore.

## Pontos de integração de extensões e hooks para operações de árvore

API de extensão em tempo de comando (`ExtensionCommandContext`):

- `branch(entryId)` — criar arquivo de sessão ramificado
- `navigateTree(targetId, { summarize? })` — mover dentro da árvore/arquivo atual

Eventos em torno da navegação na árvore:

- `session_before_tree`
  - recebe `TreePreparation`:
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - pode cancelar a navegação
  - pode fornecer payload de resumo usado em vez do sumarizador integrado
  - recebe `signal` de abort (caminho de cancelamento via Escape)
- `session_tree`
  - emite `newLeafId`, `oldLeafId`
  - inclui `summaryEntry` quando um resumo foi criado
  - `fromExtension` indica a origem do resumo

Hooks de ciclo de vida adjacentes, mas relacionados:

- `session_before_branch` / `session_branch` para o fluxo `/branch`
- `session_before_compact`, `session.compacting`, `session_compact` para entradas de compactação que posteriormente afetam a reconstrução de contexto da árvore

## Restrições reais e condições de borda

- `branch()` não pode ter como alvo `null`; use `resetLeaf()` para o estado raiz-antes-da-primeira-entrada.
- `branchWithSummary()` suporta alvo `null` e registra `fromId: "root"`.
- Selecionar a folha atual no seletor de árvore é uma operação sem efeito (no-op).
- A sumarização requer um modelo ativo; se ausente, a navegação com sumarização falha rapidamente.
- Se a sumarização for abortada, a navegação é cancelada e a folha permanece inalterada.
- Sessões em memória nunca retornam um caminho de arquivo de branch de `createBranchedSession`.

## Compatibilidade legada ainda presente

Migrações de sessão ainda são executadas no carregamento:

- v1→v2 adiciona `id`/`parentId` e converte âncora de índice de compactação para âncora de id
- v2→v3 migra role legado `hookMessage` para `custom`

O comportamento atual em tempo de execução usa semântica de árvore versão 3 após a migração.
