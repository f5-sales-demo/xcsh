---
title: 'Operações de Sessão: Exportar, Dump, Compartilhar, Bifurcar, Retomar'
description: >-
  Operações de sessão para exportação, compartilhamento, bifurcação e retomada
  de conversas.
sidebar:
  order: 3
  label: Operações
i18n:
  sourceHash: e3c210b29c3e
  translator: machine
---

# Operações de Sessão: export, dump, share, fork, resume/continue

Este documento descreve o comportamento visível ao operador para operações de exportação/compartilhamento/bifurcação/retomada de sessão conforme implementadas atualmente.

## Arquivos de implementação

- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/export/html/index.ts`](../../packages/coding-agent/src/export/html/index.ts)
- [`../src/export/custom-share.ts`](../../packages/coding-agent/src/export/custom-share.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)

## Matriz de operações

| Operação | Caminho de entrada | Mutação de sessão | Criação/troca de arquivo de sessão | Artefato de saída |
|---|---|---|---|---|
| `/dump` | Comando slash interativo | Não | Não | Texto na área de transferência |
| `/export [path]` | Comando slash interativo | Não | Não | Arquivo HTML |
| `--export <session.jsonl> [outputPath]` | Caminho rápido de inicialização CLI | Sem mutação de sessão em tempo de execução | Sem sessão ativa; lê o arquivo alvo | Arquivo HTML |
| `/share` | Comando slash interativo | Não | Não | HTML temporário + URL de compartilhamento/gist |
| `/fork` | Comando slash interativo | Sim (identidade da sessão ativa muda) | Cria novo arquivo de sessão e alterna a sessão atual para ele (somente modo persistente) | Copia diretório de artefatos para o namespace da nova sessão quando presente |
| `/resume` | Comando slash interativo | Sim (estado ativo em memória substituído) | Alterna para arquivo de sessão existente selecionado | Nenhum |
| `--resume` | Inicialização CLI (seletor) | Sim após criação de sessão | Abre arquivo de sessão existente selecionado | Nenhum |
| `--resume <id\|path>` | Inicialização CLI | Sim após criação de sessão | Abre sessão existente; caso entre projetos pode bifurcar para o projeto atual | Nenhum |
| `--continue` | Inicialização CLI | Sim após criação de sessão | Abre breadcrumb do terminal ou sessão mais recente; cria uma nova se nenhuma existir | Nenhum |

## Exportação e dump

### `/export [outputPath]` (interativo)

Fluxo:

1. `InputController` encaminha `/export...` para `CommandController.handleExportCommand`.
2. O comando divide por espaço em branco e usa apenas o primeiro argumento após `/export` como `outputPath`.
3. `AgentSession.exportToHtml()` chama `exportSessionToHtml(sessionManager, state, { outputPath, themeName })`.
4. Em caso de sucesso, a UI mostra o caminho e abre o arquivo no navegador.

Detalhes de comportamento:

- Argumentos `--copy`, `clipboard` e `copy` são explicitamente rejeitados com um aviso para usar `/dump`.
- A exportação incorpora cabeçalho/entradas/folha da sessão mais o `systemPrompt` atual e descrições de ferramentas do estado do agente.
- Nenhuma entrada de sessão é adicionada durante a exportação.

Ressalva:

- A análise de argumentos é baseada em espaço em branco (`text.split(/\s+/)`), então caminhos com aspas contendo espaços não são preservados como um único caminho por este caminho de comando.

### `--export <inputSessionFile> [outputPath]` (CLI)

Fluxo em `main.ts`:

1. Tratado antecipadamente (antes da inicialização interativa/de sessão).
2. Chama `exportFromFile(inputPath, outputPath?)`.
3. `SessionManager.open(inputPath)` carrega as entradas, então o HTML é gerado e gravado.
4. O processo imprime `Exported to: ...` e encerra.

Detalhes de comportamento:

- Arquivo de entrada ausente aparece como `File not found: <path>`.
- Este caminho não cria uma `AgentSession` e não muta nenhuma sessão em execução.

### `/dump` (exportação interativa para área de transferência)

Fluxo:

1. `CommandController.handleDumpCommand()` chama `session.formatSessionAsText()`.
2. Se string vazia, reporta `No messages to dump yet.`
3. Caso contrário, copia para a área de transferência via `copyToClipboard` nativo.

O conteúdo do dump inclui:

- Prompt do sistema
- Modelo ativo/nível de raciocínio
- Definições de ferramentas + parâmetros
- Mensagens de usuário/assistente
- Blocos de raciocínio e chamadas de ferramentas
- Resultados de ferramentas e blocos de execução (exceto entradas bash/python com `excludeFromContext`)
- Entradas de ferramentas personalizadas/hook/menção de arquivo/resumo de branch/resumo de compactação

Nenhuma alteração de persistência de sessão é feita pelo dump.

## Compartilhamento

`/share` é exclusivamente interativo e sempre começa exportando a sessão atual para um arquivo HTML temporário.

### Fase 1: exportação temporária

- Caminho do arquivo temporário: `${os.tmpdir()}/${Snowflake.next()}.html`
- Usa `session.exportToHtml(tmpFile)`
- Se a exportação falhar (notavelmente sessões em memória), o compartilhamento termina com erro.

### Fase 2: manipulador de compartilhamento personalizado (se presente)

`loadCustomShare()` verifica `~/.xcsh/agent` para o primeiro candidato existente:

- `share.ts`
- `share.js`
- `share.mjs`

Requisitos:

- O módulo deve exportar por padrão uma função `(htmlPath) => Promise<CustomShareResult | string | undefined>`.

Se presente e válido:

- A UI entra no estado de carregamento `Sharing...`.
- Interpretação do resultado do manipulador:
  - string => tratado como URL, exibido e aberto
  - objeto => `url` e/ou `message` exibidos; `url` aberto
  - `undefined`/falsy => `Session shared` genérico
- O arquivo temporário é removido após a conclusão.

Comportamento crítico de fallback:

- Se o manipulador personalizado existe mas o carregamento falha, o comando retorna erro.
- Se o manipulador personalizado executa e lança exceção, o comando retorna erro.
- Em ambos os casos de falha, **não** há fallback para GitHub gist.
- O fallback para gist acontece apenas quando nenhum script de compartilhamento personalizado existe.

### Fase 3: fallback padrão para gist

Apenas quando nenhum manipulador de compartilhamento personalizado é encontrado:

1. Valida `gh auth status`.
2. Mostra carregamento `Creating gist...`.
3. Executa `gh gist create --public=false <tmpFile>`.
4. Analisa a URL do gist, deriva o id do gist, constrói URL de preview `https://gistpreview.github.io/?<id>`.
5. Mostra URLs de preview e do gist; abre o preview.

Semântica de cancelamento/aborto no compartilhamento:

- O carregamento tem um hook `onAbort` que restaura a UI do editor e reporta `Share cancelled`.
- O comando subjacente `gh gist create` não recebe um sinal de aborto neste caminho de código; o cancelamento é no nível da UI e verificado após o retorno do comando.

## Bifurcação (Fork)

`/fork` cria uma nova sessão a partir da atual e alterna a identidade da sessão ativa.

### Pré-condições e verificações imediatas

- Se o agente está em streaming, `/fork` é rejeitado com aviso.
- Indicadores de status/carregamento da UI são limpos antes da operação.

### Fluxo no nível da sessão

`AgentSession.fork()`:

1. Emite `session_before_switch` com `reason: "fork"` (cancelável).
2. Descarrega escritas pendentes.
3. Chama `SessionManager.fork()`.
4. Copia o diretório de artefatos do namespace da sessão antiga para o novo namespace (melhor esforço; falhas de cópia que não sejam ENOENT são registradas em log, não são fatais).
5. Atualiza `agent.sessionId`.
6. Emite `session_switch` com `reason: "fork"`.

Comportamento de `SessionManager.fork()`:

- Requer modo persistente e arquivo de sessão existente.
- Cria novo id de sessão e novo caminho de arquivo JSONL.
- Reescreve o cabeçalho com:
  - novo `id`
  - novo timestamp
  - `cwd` inalterado
  - `parentSession` definido como o id da sessão anterior
- Mantém todas as entradas não-cabeçalho inalteradas no novo arquivo.

### Comportamento não persistente

- O gerenciador de sessão em memória retorna `undefined` de `fork()`.
- `AgentSession.fork()` retorna `false`.
- A UI reporta `Fork failed (session not persisted or cancelled)`.

## Retomar e continuar

## `/resume` interativo

Fluxo:

1. Abre o seletor de sessão populado via `SessionManager.list(currentCwd, currentSessionDir)`.
2. Na seleção, `SelectorController.handleResumeSession(sessionPath)` chama `session.switchSession(sessionPath)`.
3. A UI limpa/reconstrói o chat e os todos, então reporta `Resumed session`.

Notas:

- Este seletor lista apenas sessões no escopo do diretório de sessão atual.
- Não usa busca global entre projetos.

## CLI `--resume`

### `--resume` (sem valor)

- `main.ts` lista sessões para o cwd/sessionDir atual e abre o seletor.
- O caminho selecionado é aberto com `SessionManager.open(selectedPath)` antes da criação da sessão.

### `--resume <value>`

Ordem de resolução de `createSessionManager()`:

1. Se o valor parece um caminho (`/`, `\` ou `.jsonl`), abre diretamente.
2. Caso contrário, trata como prefixo de id:
   - busca no escopo atual (`SessionManager.list(cwd, sessionDir)`)
   - se não encontrado e sem `sessionDir` explícito, busca global (`SessionManager.listAll()`)

Comportamento de correspondência de id entre projetos:

- Se o cwd da sessão correspondida difere do cwd atual, o CLI pergunta:
  - `Session found in different project ... Fork into current directory? [y/N]`
- Em caso de sim: `SessionManager.forkFrom(match.path, cwd, sessionDir)` cria um novo arquivo bifurcado local.
- Em caso de não/padrão não-TTY: o comando retorna erro.

## CLI `--continue`

`SessionManager.continueRecent(cwd, sessionDir)`:

1. Resolve o diretório de sessão para o cwd atual.
2. Lê o breadcrumb com escopo de terminal primeiro.
3. Faz fallback para o arquivo de sessão modificado mais recentemente.
4. Abre a sessão encontrada; se nenhuma existir, cria uma nova sessão.

Este é um comportamento exclusivo de inicialização; não existe um comando slash interativo `/continue`.

## Como a troca de sessão realmente muta o estado em tempo de execução

`AgentSession.switchSession(sessionPath)` realiza a transição em tempo de execução usada por operações do tipo resume:

1. Emite `session_before_switch` com `reason: "resume"` e `targetSessionFile` (cancelável).
2. Desconecta a assinatura de eventos do agente e aborta trabalho em andamento.
3. Limpa mensagens enfileiradas de steering/follow-up/próximo-turno.
4. Descarrega escritas do gerenciador de sessão atual.
5. `sessionManager.setSessionFile(sessionPath)` e atualiza `agent.sessionId`.
6. Constrói o contexto da sessão a partir das entradas carregadas.
7. Emite `session_switch` com `reason: "resume"`.
8. Substitui as mensagens do agente a partir do contexto.
9. Restaura o modelo (se disponível no registro atual).
10. Restaura ou inicializa o nível de raciocínio.
11. Reconecta a assinatura de eventos do agente.

Nenhum novo arquivo de sessão é criado pelo próprio `switchSession()`.

## Emissões de eventos e pontos de cancelamento

### Hooks de ciclo de vida de troca/bifurcação

Para `newSession`, `fork` e `switchSession`:

- Evento anterior: `session_before_switch`
  - razões: `new`, `fork`, `resume`
  - cancelável retornando `{ cancel: true }`
- Evento posterior: `session_switch`
  - mesmo conjunto de razões
  - inclui `previousSessionFile`

`ExtensionRunner.emit()` retorna antecipadamente no primeiro resultado de evento anterior que cancela.

### Comportamento `onSession` de ferramentas personalizadas

O SDK faz bridge dos eventos de sessão da extensão para callbacks `onSession` de ferramentas personalizadas:

- `session_switch` -> `onSession({ reason: "switch", previousSessionFile })`
- `session_branch` -> `reason: "branch"`
- `session_start` -> `reason: "start"`
- `session_tree` -> `reason: "tree"`
- `session_shutdown` -> `reason: "shutdown"`

Esses callbacks são observacionais; eles não cancelam troca/bifurcação.

### Outras superfícies de cancelamento relevantes para este documento

- `/fork` é bloqueado durante streaming (o usuário deve aguardar/abortar a resposta atual primeiro).
- O seletor de `/resume` pode ser cancelado pelo usuário fechando o seletor.
- `--resume <id>` entre projetos pode ser cancelado recusando o prompt de bifurcação.
- `/share` tem caminho de aborto na UI (`Share cancelled`) para o fluxo de gist; não conecta semântica de process-kill para `gh gist create` neste caminho de código.

## Comportamento de sessão não persistente (em memória)

Quando o gerenciador de sessão é criado com `SessionManager.inMemory()` (`--no-session`):

- O caminho do arquivo de sessão está ausente.
- `/export` e `/share` falham com `Cannot export in-memory session to HTML` (propagado para a UI de erro do comando).
- `/fork` falha porque `SessionManager.fork()` requer persistência.
- `/dump` ainda funciona porque serializa o estado do agente em memória.
- Semânticas de resume/continue do CLI são ignoradas se `--no-session` estiver definido, porque a criação do gerenciador retorna em memória imediatamente.

## Ressalvas de implementação conhecidas (conforme código atual)

- `SelectorController.handleResumeSession()` não verifica o resultado booleano de `session.switchSession(...)`; uma troca cancelada por hook pode ainda prosseguir pelo caminho de repintura/status da UI "Resumed session".
- Falhas de compartilhamento personalizado em `/share` não degradam para o fallback padrão de gist; elas encerram o comando com erro.
- A tokenização de argumentos de `/export` é simplista e não preserva caminhos entre aspas com espaços.
