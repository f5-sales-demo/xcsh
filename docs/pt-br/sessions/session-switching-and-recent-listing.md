---
title: Alternância de Sessão e Listagem de Sessões Recentes
description: >-
  Mecânicas de alternância de sessão e listagem de sessões recentes com busca e
  filtragem.
sidebar:
  order: 4
  label: Alternância e recentes
i18n:
  sourceHash: aae56130b508
  translator: machine
---

# Alternância de sessão e listagem de sessões recentes

Este documento descreve como o coding-agent descobre sessões recentes, resolve alvos de `--resume`, apresenta seletores de sessão e alterna a sessão ativa em tempo de execução.

O foco está no comportamento da implementação atual, incluindo caminhos de fallback e ressalvas.

## Arquivos de implementação

- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/cli/session-picker.ts`](../../packages/coding-agent/src/cli/session-picker.ts)
- [`../src/modes/components/session-selector.ts`](../../packages/coding-agent/src/modes/components/session-selector.ts)
- [`../src/modes/controllers/selector-controller.ts`](../../packages/coding-agent/src/modes/controllers/selector-controller.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)

## Descoberta de sessões recentes

### Escopo de diretório

`SessionManager` armazena sessões sob um diretório com escopo de cwd por padrão:

- `~/.xcsh/agent/sessions/--<cwd-encoded>--/*.jsonl`

`SessionManager.list(cwd, sessionDir?)` lê apenas esse diretório, a menos que um `sessionDir` explícito seja fornecido.

### Dois caminhos de listagem com payloads diferentes

Existem dois pipelines de listagem diferentes:

1. `getRecentSessions(sessionDir, limit)` (visualização de boas-vindas/resumo)
   - Lê apenas um prefixo de 4KB (`readTextPrefix(..., 4096)`) de cada arquivo.
   - Analisa o cabeçalho + prévia do texto mais antigo do usuário.
   - Retorna `RecentSessionInfo` leve com getters lazy de `name` e `timeAgo`.
   - Ordena por `mtime` do arquivo em ordem decrescente.

2. `SessionManager.list(...)` / `SessionManager.listAll()` (seletores de retomada e correspondência de ID)
   - Lê os arquivos de sessão completos.
   - Constrói objetos `SessionInfo` (`id`, `cwd`, `title`, `messageCount`, `firstMessage`, `allMessagesText`, timestamps).
   - Descarta sessões com zero entradas de `message`.
   - Ordena por `modified` em ordem decrescente.

### Comportamento de fallback de metadados

Para resumos recentes (`RecentSessionInfo`):

- preferência de nome de exibição: `header.title` -> primeiro prompt do usuário -> `header.id` -> nome do arquivo
- o nome é truncado para 40 caracteres em exibições compactas
- caracteres de controle/quebras de linha são removidos/sanitizados de nomes derivados do título

Para entradas de lista `SessionInfo`:

- `title` é `header.title` ou o `shortSummary` da compactação mais recente
- `firstMessage` é o texto da primeira mensagem do usuário ou `"(no messages)"`

## Resolução de `--continue` e preferência de breadcrumb do terminal

`SessionManager.continueRecent(cwd, sessionDir?)` resolve o alvo nesta ordem:

1. Lê o breadcrumb com escopo de terminal (`~/.xcsh/agent/terminal-sessions/<terminal-id>`)
2. Valida o breadcrumb:
   - o terminal atual pode ser identificado
   - o cwd do breadcrumb corresponde ao cwd atual (comparação de caminho resolvido)
   - o arquivo referenciado ainda existe
3. Se o breadcrumb for inválido/ausente, recorre ao arquivo mais recente por mtime no diretório de sessão (`findMostRecentSession`)
4. Se nenhum for encontrado, cria uma nova sessão

A derivação do ID do terminal prefere o caminho TTY e recorre a identificadores baseados em variáveis de ambiente (`KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION`).

As escritas de breadcrumb são best-effort e não fatais.

## Resolução do alvo de retomada no momento da inicialização (`main.ts`)

### `--resume <valor>`

`createSessionManager(...)` lida com `--resume` com valor string em dois modos:

1. Valor semelhante a caminho (contém `/`, `\\` ou termina com `.jsonl`)
   - `SessionManager.open(sessionArg, parsed.sessionDir)` direto

2. Valor de prefixo de ID
   - encontra correspondência em `SessionManager.list(cwd, sessionDir)` por `id.startsWith(sessionArg)`
   - se não houver correspondência local e `sessionDir` não for forçado, tenta `SessionManager.listAll()`
   - a primeira correspondência é usada (sem prompt de ambiguidade)

Comportamento de correspondência entre projetos:

- se o cwd da sessão correspondente difere do cwd atual, o CLI pergunta se deve fazer fork para o projeto atual
- sim -> `SessionManager.forkFrom(...)`
- não -> lança erro (`Session "..." is in another project (...)`)

Sem correspondência -> lança erro (`Session "..." not found.`).

### `--resume` (sem valor)

Tratado após a construção inicial do session-manager:

1. lista sessões locais com `SessionManager.list(cwd, parsed.sessionDir)`
2. se vazio: imprime `No sessions found` e encerra antecipadamente
3. abre o seletor TUI (`selectSession`)
4. se cancelado: imprime `No session selected` e encerra antecipadamente
5. se selecionado: `SessionManager.open(selectedPath)`

### `--continue`

Usa `SessionManager.continueRecent(...)` diretamente (comportamento de breadcrumb-primeiro descrito acima).

## Detalhes internos da seleção por seletor

## Seletor CLI (`src/cli/session-picker.ts`)

`selectSession(sessions)` cria uma TUI independente com `SessionSelectorComponent` e resolve exatamente uma vez:

- seleção -> resolve o caminho selecionado
- cancelar (Esc) -> resolve `null`
- saída forçada (caminho Ctrl+C) -> para a TUI e `process.exit(0)`

## Seletor interativo em sessão (`SelectorController.showSessionSelector`)

Fluxo:

1. busca sessões do diretório de sessão atual via `SessionManager.list(currentCwd, currentSessionDir)`
2. monta `SessionSelectorComponent` na área do editor usando `showSelector(...)`
3. callbacks:
   - selecionar -> fecha o seletor e chama `handleResumeSession(sessionPath)`
   - cancelar -> restaura o editor e rerenderiza
   - sair -> `ctx.shutdown()`

## Comportamento do componente seletor de sessão

`SessionList` suporta:

- navegação por setas/página
- Enter para selecionar
- Esc para cancelar
- Ctrl+C para sair
- busca fuzzy em id/título/cwd/primeira mensagem/todas as mensagens/caminho da sessão

Comportamento de renderização com lista vazia:

- renderiza uma mensagem em vez de falhar
- Enter em lista vazia não faz nada (sem callback)
- Esc/Ctrl+C continuam funcionando

Ressalva: O texto da UI diz `Press Tab to view all`, mas este componente atualmente não possui handler para Tab e a conexão atual lista apenas sessões do escopo atual.

## Execução da alternância em tempo de execução (`AgentSession.switchSession`)

`switchSession(sessionPath)` é o caminho principal de alternância em processo.

Ciclo de vida/transição de estado:

1. captura `previousSessionFile`
2. emite evento de hook `session_before_switch` (`reason: "resume"`, cancelável)
3. se cancelado -> retorna `false` sem alternância
4. desconecta do stream de eventos do agente atual
5. aborta geração/fluxo de ferramentas ativo
6. limpa buffers de mensagens enfileiradas de steering/follow-up/próximo turno
7. faz flush do escritor de sessão (`sessionManager.flush()`) para persistir escritas pendentes
8. `sessionManager.setSessionFile(sessionPath)`
   - atualiza o ponteiro do arquivo de sessão
   - escreve o breadcrumb do terminal
   - carrega entradas / migra / resolve blobs / reindexa
   - se os dados do arquivo estiverem ausentes/inválidos: inicializa uma nova sessão naquele caminho e reescreve o cabeçalho
9. atualiza `agent.sessionId`
10. reconstrói o contexto via `buildSessionContext()`
11. emite evento de hook `session_switch` (`reason: "resume"`, `previousSessionFile`)
12. substitui as mensagens do agente pelo contexto reconstruído
13. restaura o modelo padrão de `sessionContext.models.default` se disponível e presente no registro de modelos
14. restaura o nível de thinking:
    - se o branch já possui `thinking_level_change`, aplica o nível de sessão salvo
    - caso contrário, deriva o nível de thinking padrão das configurações, limita à capacidade do modelo, define-o e adiciona uma nova entrada `thinking_level_change`
15. reconecta os listeners do agente e retorna `true`

## Reconstrução do estado da UI após alternância interativa

`SelectorController.handleResumeSession` realiza o reset da UI em torno de `switchSession`:

- para a animação de carregamento
- limpa o container de status
- limpa a UI de mensagens pendentes e o mapa de ferramentas pendentes
- reseta referências de componente/mensagem de streaming
- chama `session.switchSession(...)`
- limpa o container de chat e rerenderiza a partir do contexto da sessão (`renderInitialMessages`)
- recarrega os todos dos artefatos da nova sessão
- exibe `Resumed session`

Portanto, o estado visível de conversa/todos é reconstruído a partir do novo arquivo de sessão.

## Retomada na inicialização vs alternância em sessão

### Retomada na inicialização (`--continue`, `--resume`, abertura direta)

- O arquivo de sessão é escolhido antes de `createAgentSession(...)`.
- `sdk.ts` constrói `existingSession = sessionManager.buildSessionContext()`.
- As mensagens do agente são restauradas uma vez durante a criação da sessão.
- Modelo/thinking são selecionados durante a criação (incluindo lógica de restauração/fallback).
- O modo interativo então executa `#restoreModeFromSession()` para reentrar no estado de modo persistido (atualmente plan/plan_paused).

### Alternância em sessão (caminho do seletor estilo `/resume`)

- Usa `AgentSession.switchSession(...)` em uma `AgentSession` já em execução.
- Mensagens/modelo/thinking são reconstruídos imediatamente no local.
- Eventos de hook `session_before_switch`/`session_switch` são emitidos.
- Chat/todos da UI são atualizados.
- Nenhuma chamada dedicada de restauração de modo pós-alternância é feita no fluxo do seletor; o comportamento de reentrada de modo não é simétrico com o `#restoreModeFromSession()` da inicialização.

## Comportamento de falha e casos extremos

### Caminhos de cancelamento

- Cancelamento no seletor CLI -> retorna `null`, o chamador imprime `No session selected`, o processo encerra antecipadamente.
- Cancelamento no seletor interativo -> editor restaurado, sem mudança de sessão.
- Cancelamento via hook (`session_before_switch`) -> `switchSession()` retorna `false`.

### Caminhos de lista vazia

- CLI `--resume` (sem valor): lista vazia imprime `No sessions found` e encerra.
- Seletor interativo: lista vazia renderiza mensagem e permanece cancelável.

### Arquivo de sessão alvo ausente/inválido

Ao abrir/alternar para um caminho específico (`setSessionFile`):

- ENOENT -> tratado como vazio -> nova sessão inicializada naquele caminho exato e persistida.
- cabeçalho malformado/inválido (ou entradas analisadas efetivamente ilegíveis) -> tratado como vazio -> nova sessão inicializada e persistida.

Este é um comportamento de recuperação, não uma falha definitiva.

### Falhas definitivas

Alternância/abertura ainda pode lançar exceção em falhas de I/O reais (erros de permissão, falhas de reescrita, etc.), que se propagam para os chamadores.

### Ressalvas da correspondência por prefixo de ID

- A correspondência de ID usa `startsWith` e pega a primeira correspondência na lista ordenada.
- Sem UI de ambiguidade se múltiplas sessões compartilham o mesmo prefixo.
- `SessionManager.list(...)` exclui sessões com zero mensagens, então essas sessões não são retomáveis via correspondência de ID/seletor de lista.
