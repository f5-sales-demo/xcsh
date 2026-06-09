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

O foco está no comportamento atual da implementação, incluindo caminhos de fallback e ressalvas.

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

`SessionManager` armazena sessões em um diretório com escopo de cwd por padrão:

- `~/.xcsh/agent/sessions/--<cwd-encoded>--/*.jsonl`

`SessionManager.list(cwd, sessionDir?)` lê apenas esse diretório, a menos que um `sessionDir` explícito seja fornecido.

### Dois caminhos de listagem com payloads diferentes

Existem dois pipelines de listagem diferentes:

1. `getRecentSessions(sessionDir, limit)` (visualização de boas-vindas/resumo)
   - Lê apenas um prefixo de 4KB (`readTextPrefix(..., 4096)`) de cada arquivo.
   - Analisa o cabeçalho + prévia do texto mais antigo do usuário.
   - Retorna `RecentSessionInfo` leve com getters lazy para `name` e `timeAgo`.
   - Ordena por `mtime` do arquivo em ordem decrescente.

2. `SessionManager.list(...)` / `SessionManager.listAll()` (seletores de retomada e correspondência de ID)
   - Lê os arquivos completos de sessão.
   - Constrói objetos `SessionInfo` (`id`, `cwd`, `title`, `messageCount`, `firstMessage`, `allMessagesText`, timestamps).
   - Descarta sessões com zero entradas de `message`.
   - Ordena por `modified` em ordem decrescente.

### Comportamento de fallback de metadados

Para resumos recentes (`RecentSessionInfo`):

- preferência de nome de exibição: `header.title` -> primeiro prompt do usuário -> `header.id` -> nome do arquivo
- nome é truncado para 40 caracteres em exibições compactas
- caracteres de controle/quebras de linha são removidos/sanitizados dos nomes derivados de título

Para entradas de lista `SessionInfo`:

- `title` é `header.title` ou `shortSummary` da compactação mais recente
- `firstMessage` é o texto da primeira mensagem do usuário ou `"(no messages)"`

## Resolução de `--continue` e preferência de breadcrumb do terminal

`SessionManager.continueRecent(cwd, sessionDir?)` resolve o alvo nesta ordem:

1. Ler breadcrumb com escopo de terminal (`~/.xcsh/agent/terminal-sessions/<terminal-id>`)
2. Validar breadcrumb:
   - o terminal atual pode ser identificado
   - o cwd do breadcrumb corresponde ao cwd atual (comparação de caminho resolvido)
   - o arquivo referenciado ainda existe
3. Se o breadcrumb for inválido/ausente, fazer fallback para o arquivo mais recente por mtime no diretório de sessão (`findMostRecentSession`)
4. Se nenhum for encontrado, criar uma nova sessão

A derivação do ID do terminal prefere o caminho TTY e faz fallback para identificadores baseados em variáveis de ambiente (`KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION`).

As escritas de breadcrumb são best-effort e não fatais.

## Resolução do alvo de retomada no tempo de inicialização (`main.ts`)

### `--resume <value>`

`createSessionManager(...)` trata `--resume` com valor string em dois modos:

1. Valor semelhante a caminho (contém `/`, `\\`, ou termina com `.jsonl`)
   - `SessionManager.open(sessionArg, parsed.sessionDir)` direto

2. Valor de prefixo de ID
   - encontrar correspondência em `SessionManager.list(cwd, sessionDir)` por `id.startsWith(sessionArg)`
   - se não houver correspondência local e `sessionDir` não for forçado, tentar `SessionManager.listAll()`
   - a primeira correspondência é utilizada (sem prompt de ambiguidade)

Comportamento de correspondência entre projetos:

- se o cwd da sessão correspondida difere do cwd atual, o CLI pergunta se deseja fazer fork para o projeto atual
- sim -> `SessionManager.forkFrom(...)`
- não -> lança erro (`Session "..." is in another project (...)`)

Sem correspondência -> lança erro (`Session "..." not found.`).

### `--resume` (sem valor)

Tratado após a construção inicial do session-manager:

1. listar sessões locais com `SessionManager.list(cwd, parsed.sessionDir)`
2. se vazio: imprimir `No sessions found` e sair antecipadamente
3. abrir seletor TUI (`selectSession`)
4. se cancelado: imprimir `No session selected` e sair antecipadamente
5. se selecionado: `SessionManager.open(selectedPath)`

### `--continue`

Usa `SessionManager.continueRecent(...)` diretamente (comportamento breadcrumb-first descrito acima).

## Detalhes internos da seleção por seletor

## Seletor CLI (`src/cli/session-picker.ts`)

`selectSession(sessions)` cria uma TUI independente com `SessionSelectorComponent` e resolve exatamente uma vez:

- seleção -> resolve o caminho selecionado
- cancelamento (Esc) -> resolve `null`
- saída forçada (caminho Ctrl+C) -> para a TUI e `process.exit(0)`

## Seletor interativo dentro da sessão (`SelectorController.showSessionSelector`)

Fluxo:

1. buscar sessões do diretório de sessão atual via `SessionManager.list(currentCwd, currentSessionDir)`
2. montar `SessionSelectorComponent` na área do editor usando `showSelector(...)`
3. callbacks:
   - selecionar -> fechar seletor e chamar `handleResumeSession(sessionPath)`
   - cancelar -> restaurar editor e rerenderizar
   - sair -> `ctx.shutdown()`

## Comportamento do componente seletor de sessão

`SessionList` suporta:

- navegação por setas/página
- Enter para selecionar
- Esc para cancelar
- Ctrl+C para sair
- busca fuzzy nos campos id/título/cwd/primeira mensagem/todas as mensagens/caminho da sessão

Comportamento de renderização com lista vazia:

- renderiza uma mensagem em vez de quebrar
- Enter na lista vazia não faz nada (sem callback)
- Esc/Ctrl+C ainda funcionam

Ressalva: o texto da UI diz `Press Tab to view all`, mas este componente atualmente não tem handler para Tab e a integração atual lista apenas sessões do escopo atual.

## Execução da alternância em tempo de execução (`AgentSession.switchSession`)

`switchSession(sessionPath)` é o caminho principal de alternância dentro do processo.

Ciclo de vida/transição de estado:

1. capturar `previousSessionFile`
2. emitir evento de hook `session_before_switch` (`reason: "resume"`, cancelável)
3. se cancelado -> retornar `false` sem alternância
4. desconectar do stream de eventos do agente atual
5. abortar geração/fluxo de ferramenta ativo
6. limpar buffers enfileirados de steering/follow-up/next-turn message
7. fazer flush do escritor de sessão (`sessionManager.flush()`) para persistir escritas pendentes
8. `sessionManager.setSessionFile(sessionPath)`
   - atualiza o ponteiro do arquivo de sessão
   - escreve breadcrumb do terminal
   - carrega entradas / migra / resolve blobs / reindexa
   - se dados do arquivo estiverem ausentes/inválidos: inicializa uma nova sessão naquele caminho e reescreve o cabeçalho
9. atualizar `agent.sessionId`
10. reconstruir contexto via `buildSessionContext()`
11. emitir evento de hook `session_switch` (`reason: "resume"`, `previousSessionFile`)
12. substituir mensagens do agente com o contexto reconstruído
13. restaurar modelo padrão de `sessionContext.models.default` se disponível e presente no registro de modelos
14. restaurar nível de thinking:
    - se o branch já tem `thinking_level_change`, aplicar o nível salvo da sessão
    - caso contrário, derivar o nível padrão de thinking das configurações, limitar à capacidade do modelo, definir e adicionar uma nova entrada `thinking_level_change`
15. reconectar listeners do agente e retornar `true`

## Reconstrução do estado da UI após alternância interativa

`SelectorController.handleResumeSession` realiza reset da UI ao redor do `switchSession`:

- parar animação de carregamento
- limpar container de status
- limpar UI de mensagem pendente e mapa de ferramentas pendentes
- resetar referências de componente de streaming/mensagem
- chamar `session.switchSession(...)`
- limpar container de chat e rerenderizar a partir do contexto da sessão (`renderInitialMessages`)
- recarregar todos do artefatos da nova sessão
- exibir `Resumed session`

Portanto, o estado visível de conversa/todos é reconstruído a partir do novo arquivo de sessão.

## Retomada na inicialização vs alternância dentro da sessão

### Retomada na inicialização (`--continue`, `--resume`, abertura direta)

- O arquivo de sessão é escolhido antes de `createAgentSession(...)`.
- `sdk.ts` constrói `existingSession = sessionManager.buildSessionContext()`.
- As mensagens do agente são restauradas uma vez durante a criação da sessão.
- Modelo/thinking são selecionados durante a criação (incluindo lógica de restauração/fallback).
- O modo interativo então executa `#restoreModeFromSession()` para reentrar no estado de modo persistido (atualmente plan/plan_paused).

### Alternância dentro da sessão (caminho de seletor estilo `/resume`)

- Usa `AgentSession.switchSession(...)` em um `AgentSession` já em execução.
- Mensagens/modelo/thinking são reconstruídos imediatamente em tempo real.
- Eventos de hook `session_before_switch`/`session_switch` são emitidos.
- Chat/todos da UI são atualizados.
- Nenhuma chamada dedicada de restauração de modo pós-alternância é feita no fluxo do seletor; o comportamento de reentrada de modo não é simétrico com o `#restoreModeFromSession()` da inicialização.

## Comportamento de falha e casos extremos

### Caminhos de cancelamento

- Cancelamento do seletor CLI -> retorna `null`, o chamador imprime `No session selected`, processo sai antecipadamente.
- Cancelamento do seletor interativo -> editor restaurado, sem mudança de sessão.
- Cancelamento por hook (`session_before_switch`) -> `switchSession()` retorna `false`.

### Caminhos com lista vazia

- CLI `--resume` (sem valor): lista vazia imprime `No sessions found` e sai.
- Seletor interativo: lista vazia renderiza mensagem e permanece cancelável.

### Arquivo de sessão alvo ausente/inválido

Ao abrir/alternar para um caminho específico (`setSessionFile`):

- ENOENT -> tratado como vazio -> nova sessão inicializada naquele caminho exato e persistida.
- cabeçalho malformado/inválido (ou entradas analisadas efetivamente ilegíveis) -> tratado como vazio -> nova sessão inicializada e persistida.

Este é um comportamento de recuperação, não uma falha grave.

### Falhas graves

Alternância/abertura ainda pode lançar exceção em falhas verdadeiras de I/O (erros de permissão, falhas de reescrita, etc.), que são propagadas aos chamadores.

### Ressalvas na correspondência de prefixo de ID

- A correspondência de ID usa `startsWith` e pega a primeira correspondência na lista ordenada.
- Sem UI de ambiguidade se múltiplas sessões compartilham o prefixo.
- `SessionManager.list(...)` exclui sessões com zero mensagens, então essas sessões não são retomáveis via correspondência de ID/seletor de lista.
