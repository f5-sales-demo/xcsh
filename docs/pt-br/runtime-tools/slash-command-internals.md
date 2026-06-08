---
title: Slash Command Internals
description: >-
  Slash command system internals with registration, argument parsing, and
  execution dispatch.
sidebar:
  order: 5
  label: Slash commands
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# Internos dos comandos slash

Este documento descreve como os comandos slash são descobertos, deduplicados, exibidos no modo interativo e expandidos no momento do prompt no `coding-agent`.

## Arquivos de implementação

- [`src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)
- [`src/capability/slash-command.ts`](../../packages/coding-agent/src/capability/slash-command.ts)
- [`src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`src/discovery/claude.ts`](../../packages/coding-agent/src/discovery/claude.ts)
- [`src/discovery/codex.ts`](../../packages/coding-agent/src/discovery/codex.ts)
- [`src/discovery/claude-plugins.ts`](../../packages/coding-agent/src/discovery/claude-plugins.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)

## 1) Modelo de descoberta

Comandos slash são uma capacidade (`id: "slash-commands"`) indexada pelo nome do comando (`key: cmd => cmd.name`).

O registro de capacidades carrega todos os provedores registrados, ordenados por prioridade do provedor em ordem decrescente, e deduplica por chave com semântica de **o primeiro vence**.

### Precedência de provedores

Provedores de comandos slash atuais e prioridades:

1. `native` (OMP) — prioridade `100`
2. `claude` — prioridade `80`
3. `claude-plugins` — prioridade `70`
4. `codex` — prioridade `70`

Comportamento em empate: provedores com prioridades iguais mantêm a ordem de registro. A ordem de importação atual registra `claude-plugins` antes de `codex`, então comandos de plugins vencem sobre comandos codex em colisões de nome.

### Comportamento em colisão de nomes

Para `slash-commands`, colisões são resolvidas estritamente pela deduplicação de capacidades:

- o item de maior precedência é mantido em `result.items`
- duplicatas de menor precedência permanecem apenas em `result.all` e são marcadas com `_shadowed = true`

Isto se aplica entre provedores e também dentro de um provedor se ele retornar nomes duplicados.

### Comportamento de varredura de arquivos

Os provedores geralmente utilizam `loadFilesFromDir(...)`, que atualmente:

- usa correspondência não recursiva por padrão (`*.md`)
- utiliza glob nativo com `gitignore: true`, `hidden: false`
- lê cada arquivo correspondente e o transforma em um `SlashCommand`

Portanto, arquivos/diretórios ocultos não são carregados, e caminhos ignorados são pulados.

## 2) Caminhos de origem específicos por provedor e precedência local

## Provedor `native` (`builtin.ts`)

As raízes de busca vêm dos diretórios `.xcsh`:

- projeto: `<cwd>/.xcsh/commands/*.md`
- usuário: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` retorna projeto primeiro, depois usuário, então **comandos nativos do projeto vencem sobre comandos nativos do usuário** quando os nomes colidem.

## Provedor `claude` (`claude.ts`)

Carrega:

- usuário: `~/.claude/commands/*.md`
- projeto: `<cwd>/.claude/commands/*.md`

O provedor adiciona itens do usuário antes dos itens do projeto, então **comandos Claude do usuário vencem sobre comandos Claude do projeto** em colisões de mesmo nome dentro deste provedor.

## Provedor `codex` (`codex.ts`)

Carrega:

- usuário: `~/.codex/commands/*.md`
- projeto: `<cwd>/.codex/commands/*.md`

Ambos os lados são carregados e então achatados na ordem usuário primeiro, então **comandos Codex do usuário vencem sobre comandos Codex do projeto** em colisões.

O conteúdo dos comandos Codex é analisado com remoção de frontmatter (`parseFrontmatter`), e o nome do comando pode ser sobrescrito pelo frontmatter `name`; caso contrário, o nome do arquivo é utilizado.

## Provedor `claude-plugins` (`claude-plugins.ts`)

Carrega raízes de comandos de plugins a partir de `~/.claude/plugins/installed_plugins.json`, e então varre `<pluginRoot>/commands/*.md`.

A ordenação segue a ordem de iteração do registro e a ordem de entrada por plugin a partir desses dados JSON. Não há etapa adicional de ordenação.

## 3) Materialização para `FileSlashCommand` em tempo de execução

`loadSlashCommands()` em `src/extensibility/slash-commands.ts` converte itens de capacidade em objetos `FileSlashCommand` usados no momento do prompt.

Para cada comando:

1. analisa frontmatter/corpo (`parseFrontmatter`)
2. origem da descrição:
   - `frontmatter.description` se presente
   - caso contrário, primeira linha não vazia do corpo (aparada, máximo 60 caracteres com `...`)
3. mantém o corpo analisado como conteúdo de template executável
4. computa uma string de exibição de origem como `via Claude Code Project`

A severidade da análise do frontmatter depende da origem:

- nível `native` -> erros de análise são `fatal`
- níveis `user`/`project` -> erros de análise são `warn` com análise de fallback

### Comandos de fallback embutidos

Após os comandos de filesystem/provedor, templates de comandos incorporados são adicionados (`EMBEDDED_COMMAND_TEMPLATES`) se seus nomes ainda não estiverem presentes.

O conjunto incorporado atual vem de `src/task/commands.ts` e é usado como fallback (`source: "bundled"`).

## 4) Modo interativo: de onde vêm as listas de comandos

O modo interativo combina múltiplas fontes de comandos para autocompletar e roteamento de comandos.

No momento da construção, ele monta uma lista pendente de comandos a partir de:

- comandos embutidos (`BUILTIN_SLASH_COMMANDS`, inclui completação de argumentos e dicas inline para comandos selecionados)
- comandos slash registrados por extensões (`extensionRunner.getRegisteredCommands(...)`)
- comandos personalizados TypeScript (`session.customCommands`), mapeados para rótulos de comandos slash
- comandos de habilidade opcionais (`/skill:<name>`) quando `skills.enableSkillCommands` está habilitado

Então `init()` chama `refreshSlashCommandState(...)` para carregar comandos baseados em arquivo e instalar um `CombinedAutocompleteProvider` contendo:

- comandos pendentes acima
- comandos baseados em arquivo descobertos

`refreshSlashCommandState(...)` também atualiza `session.setSlashCommands(...)` para que a expansão de prompt use o mesmo conjunto de comandos de arquivo descobertos.

### Ciclo de vida de atualização

O estado dos comandos slash é atualizado:

- durante a inicialização do modo interativo
- após `/move` alterar o diretório de trabalho (`handleMoveCommand` chama `resetCapabilities()` e então `refreshSlashCommandState(newCwd)`)

Não há um observador contínuo de arquivos para os diretórios de comandos.

### Outras superfícies de exibição

O painel de Extensões também carrega a capacidade `slash-commands` e exibe entradas de comandos ativos/sombreados, incluindo duplicatas `_shadowed`.

## 5) Posicionamento no pipeline de prompt

Ordem de tratamento de slash em `AgentSession.prompt(...)` (quando `expandPromptTemplates !== false`):

1. **Comandos de extensão** (`#tryExecuteExtensionCommand`)  
   Se `/name` corresponder a um comando registrado por extensão, o handler executa imediatamente e o prompt retorna.
2. **Comandos personalizados TypeScript** (`#tryExecuteCustomCommand`)  
   Apenas na fronteira: se corresponder, executa e pode retornar:
   - `string` -> substitui o texto do prompt por essa string
   - `void/undefined` -> tratado como executado; sem prompt para o LLM
3. **Comandos slash baseados em arquivo** (`expandSlashCommand`)  
   Se o texto ainda começar com `/`, tenta a expansão de comando markdown.
4. **Templates de prompt** (`expandPromptTemplate`)  
   Aplicados após o processamento de slash/custom.
5. **Entrega**
   - ocioso: o prompt é enviado imediatamente ao agente
   - em streaming: o prompt é enfileirado como steer/follow-up dependendo de `streamingBehavior`

É por isso que a expansão de comandos slash fica antes da expansão de templates de prompt, e por que comandos personalizados podem transformar e remover a barra inicial antes da correspondência de comandos de arquivo.

## 6) Semântica de expansão para comandos slash baseados em arquivo

Comportamento de `expandSlashCommand(text, fileCommands)`:

- só executa quando o texto começa com `/`
- analisa o nome do comando a partir do primeiro token após `/`
- analisa argumentos do texto restante via `parseCommandArgs`
- encontra correspondência exata de nome nos `fileCommands` carregados
- se corresponder, aplica:
  - substituição posicional: `$1`, `$2`, ...
  - substituição agregada: `$ARGUMENTS` e `$@`
  - então renderização do template via `prompt.render` com `{ args, ARGUMENTS, arguments }`
- se não corresponder, retorna o texto original sem alteração

### Ressalvas do `parseCommandArgs`

O parser é uma divisão simples com reconhecimento de aspas:

- suporta aspas `'simples'` e `"duplas"` para preservar espaços
- remove os delimitadores de aspas
- não implementa regras de escape com barra invertida
- aspas não fechadas não geram erro; o parser consome até o final

## 7) Comportamento de `/...` desconhecido

Entrada slash desconhecida **não é rejeitada** pela lógica central de slash.

Se o comando não for tratado pelas camadas de extensão/custom/arquivo, `expandSlashCommand` retorna o texto original, e o prompt literal `/...` prossegue pela expansão normal de templates de prompt e entrega ao LLM.

O modo interativo trata separadamente muitos comandos embutidos diretamente no `InputController` (por exemplo `/settings`, `/model`, `/mcp`, `/move`, `/exit`). Esses são consumidos antes de `session.prompt(...)` e, portanto, nunca alcançam a expansão de comandos de arquivo nesse caminho.

## 8) Diferenças em tempo de streaming vs ocioso

## Caminho ocioso

- `session.prompt("/x ...")` executa o pipeline de comandos e ou executa o comando imediatamente ou envia o texto expandido diretamente.

## Caminho de streaming (`session.isStreaming === true`)

- `prompt(...)` ainda executa as transformações de extensão/custom/arquivo/template primeiro
- então requer `streamingBehavior`:
  - `"steer"` -> enfileira mensagem de interrupção (`agent.steer`)
  - `"followUp"` -> enfileira mensagem pós-turno (`agent.followUp`)
- se `streamingBehavior` for omitido, o prompt lança um erro

### Comportamento importante de streaming específico por comando

- Comandos de extensão são executados imediatamente mesmo durante streaming (não são enfileirados como texto).
- Os métodos auxiliares `steer(...)`/`followUp(...)` rejeitam comandos de extensão (`#throwIfExtensionCommand`) para evitar enfileirar texto de comando para handlers que devem executar sincronamente.
- A reprodução da fila de compactação usa `isKnownSlashCommand(...)` para decidir se entradas enfileiradas devem ser reproduzidas via `session.prompt(...)` (para comandos slash conhecidos) vs métodos raw de steer/follow-up.

## 9) Tratamento de erros e superfícies de falha

- Falhas de carregamento de provedores são isoladas; o registro coleta avisos e continua com outros provedores.
- Itens de comandos slash inválidos (nome/caminho/conteúdo ausente ou nível inválido) são descartados pela validação de capacidades.
- Falhas na análise de frontmatter:
  - comandos nativos: erro fatal de análise é propagado
  - comandos não nativos: aviso + análise de fallback chave/valor
- Exceções de handlers de comandos de extensão/personalizados são capturadas e reportadas via canal de erro da extensão (ou fallback de logger para comandos personalizados sem extension runner), e tratadas como executadas (sem execução de fallback não intencional).
