---
title: Referência do Comando Tree
description: >-
  Referência do comando /tree para visualizar o histórico da sessão e
  ramificações de conversa.
sidebar:
  order: 4
  label: Comando /tree
i18n:
  sourceHash: ee0e412fe993
  translator: machine
---

# Referência do Comando `/tree`

`/tree` abre o navegador interativo **Session Tree**. Ele permite que você navegue até qualquer entrada no arquivo de sessão atual e continue a partir daquele ponto.

Trata-se de uma movimentação de folha dentro do arquivo, não uma exportação de nova sessão.

## O que o `/tree` faz

- Constrói uma árvore a partir das entradas da sessão atual (`SessionManager.getTree()`)
- Abre o `TreeSelectorComponent` com navegação por teclado, filtros e busca
- Ao selecionar, chama `AgentSession.navigateTree(targetId, { summarize, customInstructions })`
- Reconstrói o chat visível a partir do novo caminho de folha
- Opcionalmente preenche o editor com texto ao selecionar uma mensagem de usuário/personalizada

Implementação principal:

- `src/modes/controllers/input-controller.ts` (`/tree`, vinculação de teclas, comportamento de duplo escape)
- `src/modes/controllers/selector-controller.ts` (lançamento da UI da árvore + fluxo de prompt de resumo)
- `src/modes/components/tree-selector.ts` (navegação, filtros, busca, rótulos, renderização)
- `src/session/agent-session.ts` (`navigateTree` troca de folha + resumo opcional)
- `src/session/session-manager.ts` (`getTree`, `branch`, `branchWithSummary`, `resetLeaf`, persistência de rótulos)

## Como abrir

Qualquer uma das opções a seguir abre o mesmo seletor:

- `/tree`
- ação de atalho de teclado configurada `tree`
- duplo escape no editor vazio quando `doubleEscapeAction = "tree"` (padrão)
- `/branch` quando `doubleEscapeAction = "tree"` (redireciona para o seletor de árvore em vez do seletor de ramificação apenas de usuário)

## Modelo de UI da árvore

A árvore é renderizada a partir dos ponteiros de pai das entradas da sessão (`id` / `parentId`).

- Os filhos são ordenados por timestamp ascendente (mais antigos primeiro, mais recentes abaixo)
- O ramo ativo (caminho da raiz até a folha atual) é marcado com um marcador
- Rótulos (se presentes) são renderizados como `[label]` antes do texto do nó
- Se múltiplas raízes existirem (cadeias de pai órfãs/quebradas), elas são exibidas sob uma raiz de ramificação virtual

```text
Example tree view (active path marked with •):

├─ user: "Start task"
│  └─ assistant: "Plan"
│     ├─ • user: "Try approach A"
│     │  └─ • assistant: "A result"
│     │     └─ • [milestone] user: "Continue A"
│     └─ user: "Try approach B"
│        └─ assistant: "B result"
```

O seletor se centraliza ao redor da seleção atual e exibe até:

- `max(5, floor(terminalHeight / 2))` linhas

## Atalhos de teclado dentro do seletor de árvore

- `Up` / `Down`: mover seleção (circular)
- `Left` / `Right`: página acima / página abaixo
- `Enter`: selecionar nó
- `Esc`: limpar busca se ativa; caso contrário, fechar seletor
- `Ctrl+C`: fechar seletor
- `Type`: adicionar à consulta de busca
- `Backspace`: apagar caractere da busca
- `Shift+L`: editar/limpar rótulo na entrada selecionada
- `Ctrl+O`: alternar filtro para frente
- `Shift+Ctrl+O`: alternar filtro para trás
- `Alt+D/T/U/L/A`: ir diretamente para um modo de filtro específico

## Filtros e semântica de busca

Modos de filtro (`TreeList`):

1. `default`
2. `no-tools`
3. `user-only`
4. `labeled-only`
5. `all`

### `default`

Exibe a maioria dos nós conversacionais, mas oculta tipos de entrada administrativos:

- `label`
- `custom`
- `model_change`
- `thinking_level_change`

### `no-tools`

Igual ao `default`, mas também oculta mensagens `toolResult`.

### `user-only`

Apenas entradas `message` onde o papel é `user`.

### `labeled-only`

Apenas entradas que atualmente resolvem para um rótulo.

### `all`

Tudo na árvore da sessão, incluindo entradas administrativas/personalizadas.

### Comportamento de nós assistente somente com ferramentas

Mensagens de assistente que contêm **apenas chamadas de ferramentas** (sem texto) são ocultadas por padrão em todas as visualizações filtradas, exceto se:

- a mensagem for de erro/abortada (`stopReason` diferente de `stop`/`toolUse`), ou
- for a folha atual (sempre mantida visível)

### Comportamento da busca

- A consulta é tokenizada por espaços
- A correspondência não diferencia maiúsculas de minúsculas
- Todos os tokens devem corresponder (semântica AND)
- O texto pesquisável inclui rótulo, papel e conteúdo específico do tipo (texto da mensagem, texto de resumo de ramificação, tipo personalizado, trechos de comandos de ferramentas, etc.)

## Resultados da seleção (importante)

`navigateTree` calcula o comportamento da nova folha a partir do tipo de entrada selecionado:

### Selecionando mensagem `user`

- A nova folha se torna o `parentId` da entrada selecionada
- Se o pai for `null` (mensagem de usuário raiz), a folha é redefinida para a raiz (`resetLeaf()`)
- O texto da mensagem selecionada é copiado para o editor para edição/reenvio

### Selecionando `custom_message`

- Mesma regra de folha das mensagens de usuário (`parentId`)
- O conteúdo de texto é extraído e copiado para o editor

### Selecionando nó não-usuário (assistente/ferramenta/resumo/compactação/administrativo personalizado/etc.)

- A nova folha se torna o id do nó selecionado
- O editor não é preenchido

### Selecionando a folha atual

- Sem efeito; o seletor fecha com "Already at this point"

```text
Selection decision (simplified):

selected node
   │
   ├─ is current leaf? ── yes ──> close selector (no-op)
   │
   ├─ is user/custom_message? ── yes ──> leaf := parentId (or resetLeaf for root)
   │                                     + prefill editor text
   │
   └─ otherwise ──> leaf := selected node id
                    + no editor prefill
```

## Fluxo de resumo na troca

O prompt de resumo é controlado por `branchSummary.enabled` (padrão: `false`).

Quando habilitado, após selecionar um nó, a UI pergunta:

- `No summary`
- `Summarize`
- `Summarize with custom prompt`

Detalhes do fluxo:

- Escape no prompt de resumo reabre o seletor de árvore
- Cancelamento do prompt personalizado retorna ao loop de escolha de resumo
- Durante a sumarização, a UI exibe um indicador de carregamento e vincula `Esc` a `abortBranchSummary()`
- Se a sumarização for abortada, o seletor de árvore reabre e nenhuma movimentação é aplicada

Internos do `navigateTree`:

- Coleta entradas de ramo abandonado da folha antiga até o ancestral comum
- Emite `session_before_tree` (extensões podem cancelar ou injetar resumo)
- Usa o sumarizador padrão apenas se solicitado e necessário
- Aplica a movimentação com:
  - `branchWithSummary(...)` quando existe resumo
  - `branch(newLeafId)` para movimentação não-raiz sem resumo
  - `resetLeaf()` para movimentação para a raiz sem resumo
- Substitui a conversa do agente com o contexto de sessão reconstruído
- Emite `session_tree`

Nota: se o usuário solicitar resumo mas não houver nada para resumir, a navegação prossegue sem criar uma entrada de resumo.

## Rótulos

Edições de rótulos na UI da árvore chamam `appendLabelChange(targetId, label)`.

- rótulo não vazio define/atualiza o rótulo resolvido
- rótulo vazio limpa o rótulo
- rótulos são armazenados como entradas `label` de somente adição
- nós da árvore exibem o estado do rótulo resolvido, não o histórico bruto de entradas de rótulo

## `/tree` vs operações adjacentes

| Operação | Escopo | Resultado |
|---|---|---|
| `/tree` | Arquivo de sessão atual | Move a folha para o ponto selecionado (mesmo arquivo) |
| `/branch` | Geralmente arquivo de sessão atual -> novo arquivo de sessão | Por padrão, ramifica a partir da mensagem de **usuário** selecionada em um novo arquivo de sessão; se `doubleEscapeAction = "tree"`, `/branch` abre a UI de navegação da árvore em vez disso |
| `/fork` | Toda a sessão atual | Duplica a sessão em um novo arquivo de sessão persistido |
| `/resume` | Lista de sessões | Alterna para outro arquivo de sessão |

Distinção principal: `/tree` é uma ferramenta de navegação/reposicionamento dentro de um arquivo de sessão. `/branch`, `/fork` e `/resume` alteram o contexto do arquivo de sessão.

## Fluxos de trabalho do operador

### Reexecutar a partir de um prompt de usuário anterior sem perder o ramo atual

1. `/tree`
2. buscar/selecionar mensagem de usuário anterior
3. escolher `No summary` (ou resumir se necessário)
4. editar o texto preenchido no editor
5. enviar

Efeito: um novo ramo cresce a partir do ponto selecionado dentro do mesmo arquivo de sessão.

### Sair do ramo atual com uma trilha de contexto

1. habilitar `branchSummary.enabled`
2. `/tree` e selecionar o nó alvo
3. escolher `Summarize` (ou prompt personalizado)

Efeito: uma entrada `branch_summary` é adicionada na posição alvo antes de continuar.

### Investigar entradas administrativas ocultas

1. `/tree`
2. pressionar `Alt+A` (all)
3. buscar por `model`, `thinking`, `custom`, ou rótulos

Efeito: inspecionar a linha do tempo interna completa, não apenas nós conversacionais.

### Marcar pontos de pivô para navegação futura

1. `/tree`
2. mover para a entrada
3. `Shift+L` e definir rótulo
4. depois usar `Alt+L` (`labeled-only`) para navegar rapidamente

Efeito: navegação rápida entre marcos de ramo duráveis.
