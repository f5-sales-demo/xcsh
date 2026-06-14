---
title: Funcionamento Interno dos Slash Commands
description: >-
  Funcionamento interno do sistema de slash commands com registro, análise de
  argumentos e despacho de execução.
sidebar:
  order: 5
  label: Slash commands
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# Funcionamento interno dos slash commands

Este documento descreve como os slash commands são descobertos, deduplicados, exibidos no modo interativo e expandidos no momento do prompt em `coding-agent`.

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

Os slash commands são uma capability (`id: "slash-commands"`) identificada pelo nome do comando (`key: cmd => cmd.name`).

O registro de capabilities carrega todos os provedores registrados, ordenados por prioridade do provedor em ordem decrescente, e realiza deduplicação por chave com semântica de **primeiro vence**.

### Precedência dos provedores

Provedores atuais de slash commands e suas prioridades:

1. `native` (OMP) — prioridade `100`
2. `claude` — prioridade `80`
3. `claude-plugins` — prioridade `70`
4. `codex` — prioridade `70`

Comportamento em empate: provedores com prioridade igual mantêm a ordem de registro. A ordem de importação atual registra `claude-plugins` antes de `codex`, portanto comandos de plugins vencem sobre comandos codex em colisões de nome.

### Comportamento em colisões de nome

Para `slash-commands`, colisões são resolvidas estritamente pela deduplicação de capability:

- o item de maior precedência é mantido em `result.items`
- duplicatas de menor precedência permanecem apenas em `result.all` e são marcadas com `_shadowed = true`

Isso se aplica entre provedores e também dentro de um provedor caso ele retorne nomes duplicados.

### Comportamento de varredura de arquivos

Os provedores utilizam majoritariamente `loadFilesFromDir(...)`, que atualmente:

- usa correspondência não recursiva por padrão (`*.md`)
- utiliza glob nativo com `gitignore: true`, `hidden: false`
- lê cada arquivo correspondente e o transforma em um `SlashCommand`

Portanto, arquivos/diretórios ocultos não são carregados e caminhos ignorados são pulados.

## 2) Caminhos de origem específicos por provedor e precedência local

## Provedor `native` (`builtin.ts`)

As raízes de busca vêm de diretórios `.xcsh`:

- projeto: `<cwd>/.xcsh/commands/*.md`
- usuário: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` retorna o projeto primeiro, depois o usuário, portanto **comandos nativos do projeto prevalecem sobre os nativos do usuário** em colisões de nome.

## Provedor `claude` (`claude.ts`)

Carrega:

- usuário: `~/.claude/commands/*.md`
- projeto: `<cwd>/.claude/commands/*.md`

O provedor insere os itens do usuário antes dos itens do projeto, portanto **comandos Claude do usuário prevalecem sobre os comandos Claude do projeto** em colisões de mesmo nome dentro deste provedor.

## Provedor `codex` (`codex.ts`)

Carrega:

- usuário: `~/.codex/commands/*.md`
- projeto: `<cwd>/.codex/commands/*.md`

Ambos os lados são carregados e então achatados na ordem usuário-primeiro, portanto **comandos Codex do usuário prevalecem sobre os comandos Codex do projeto** em colisões.

O conteúdo dos comandos Codex é analisado com remoção de frontmatter (`parseFrontmatter`), e o nome do comando pode ser substituído pelo frontmatter `name`; caso contrário, o nome do arquivo é utilizado.

## Provedor `claude-plugins` (`claude-plugins.ts`)

Carrega raízes de comandos de plugins a partir de `~/.claude/plugins/installed_plugins.json`, depois varre `<pluginRoot>/commands/*.md`.

A ordenação segue a ordem de iteração do registro e a ordem de entrada por plugin a partir dos dados do JSON. Não há etapa de ordenação adicional.

## 3) Materialização para `FileSlashCommand` em tempo de execução

`loadSlashCommands()` em `src/extensibility/slash-commands.ts` converte itens de capability em objetos `FileSlashCommand` utilizados no momento do prompt.

Para cada comando:

1. analisa frontmatter/corpo (`parseFrontmatter`)
2. fonte da descrição:
   - `frontmatter.description` se presente
   - caso contrário, a primeira linha não vazia do corpo (com trim, máx. 60 caracteres com `...`)
3. mantém o corpo analisado como conteúdo de template executável
4. computa uma string de origem de exibição como `via Claude Code Project`

A severidade de análise do frontmatter depende da origem:

- nível `native` -> erros de análise são `fatal`
- níveis `user`/`project` -> erros de análise são `warn` com análise de fallback

### Comandos de fallback embutidos

Após os comandos de sistemas de arquivos/provedores, templates de comandos embutidos são anexados (`EMBEDDED_COMMAND_TEMPLATES`) caso seus nomes ainda não estejam presentes.

O conjunto embutido atual vem de `src/task/commands.ts` e é utilizado como fallback (`source: "bundled"`).

## 4) Modo interativo: de onde vêm as listas de comandos

O modo interativo combina múltiplas fontes de comandos para autocompletar e roteamento de comandos.

No momento da construção, ele monta uma lista de comandos pendentes a partir de:

- built-ins (`BUILTIN_SLASH_COMMANDS`, inclui completação de argumentos e dicas inline para comandos selecionados)
- slash commands registrados por extensão (`extensionRunner.getRegisteredCommands(...)`)
- comandos customizados TypeScript (`session.customCommands`), mapeados para labels de slash commands
- comandos de skill opcionais (`/skill:<name>`) quando `skills.enableSkillCommands` está habilitado

Em seguida, `init()` chama `refreshSlashCommandState(...)` para carregar comandos baseados em arquivos e instalar um `CombinedAutocompleteProvider` contendo:

- comandos pendentes acima
- comandos baseados em arquivos descobertos

`refreshSlashCommandState(...)` também atualiza `session.setSlashCommands(...)` para que a expansão do prompt utilize o mesmo conjunto de comandos de arquivo descobertos.

### Ciclo de vida da atualização

O estado dos slash commands é atualizado:

- durante a inicialização interativa
- após `/move` alterar o diretório de trabalho (`handleMoveCommand` chama `resetCapabilities()` e depois `refreshSlashCommandState(newCwd)`)

Não há observador de arquivos contínuo para os diretórios de comandos.

### Outras superfícies de exibição

O painel de Extensões também carrega a capability `slash-commands` e exibe entradas de comandos ativos/sombreados, incluindo duplicatas `_shadowed`.

## 5) Posicionamento no pipeline de prompt

Ordem de processamento de slash commands em `AgentSession.prompt(...)` (quando `expandPromptTemplates !== false`):

1. **Comandos de extensão** (`#tryExecuteExtensionCommand`)  
   Se `/name` corresponder a um comando registrado por extensão, o handler executa imediatamente e o prompt retorna.
2. **Comandos customizados TypeScript** (`#tryExecuteCustomCommand`)  
   Apenas como fronteira: se correspondido, executa e pode retornar:
   - `string` -> substitui o texto do prompt por essa string
   - `void/undefined` -> tratado como processado; sem prompt ao LLM
3. **Slash commands baseados em arquivo** (`expandSlashCommand`)  
   Se o texto ainda começar com `/`, tenta a expansão de comando markdown.
4. **Templates de prompt** (`expandPromptTemplate`)  
   Aplicado após o processamento de slash/custom.
5. **Entrega**
   - inativo: o prompt é enviado imediatamente ao agente
   - em streaming: o prompt é enfileirado como steer/follow-up dependendo de `streamingBehavior`

É por isso que a expansão de slash commands ocorre antes da expansão de templates de prompt, e por que comandos customizados podem transformar a barra inicial antes da correspondência com comandos de arquivo.

## 6) Semântica de expansão para slash commands baseados em arquivo

Comportamento de `expandSlashCommand(text, fileCommands)`:

- executa apenas quando o texto começa com `/`
- analisa o nome do comando a partir do primeiro token após `/`
- analisa os argumentos do texto restante via `parseCommandArgs`
- busca correspondência exata de nome nos `fileCommands` carregados
- se correspondido, aplica:
  - substituição posicional: `$1`, `$2`, ...
  - substituição agregada: `$ARGUMENTS` e `$@`
  - depois renderização de template via `prompt.render` com `{ args, ARGUMENTS, arguments }`
- se não houver correspondência, retorna o texto original inalterado

### Ressalvas do `parseCommandArgs`

O parser é uma divisão simples com suporte a aspas:

- suporta aspas `'simples'` e `"duplas"` para preservar espaços
- remove os delimitadores de aspas
- não implementa regras de escape com barra invertida
- aspas sem fechamento não são um erro; o parser consome até o fim

## 7) Comportamento para entradas `/...` desconhecidas

Entradas de slash desconhecidas **não são rejeitadas** pela lógica central de slash.

Se o comando não for tratado pelas camadas de extensão/customizado/arquivo, `expandSlashCommand` retorna o texto original, e o prompt literal `/...` prossegue pela expansão normal de templates de prompt e entrega ao LLM.

O modo interativo trata separadamente muitos built-ins de forma direta em `InputController` (por exemplo `/settings`, `/model`, `/mcp`, `/move`, `/exit`). Esses são consumidos antes de `session.prompt(...)` e, portanto, nunca chegam à expansão de comandos de arquivo nesse caminho.

## 8) Diferenças em tempo de streaming vs. inativo

## Caminho inativo

- `session.prompt("/x ...")` executa o pipeline de comandos e ou executa o comando imediatamente ou envia o texto expandido diretamente.

## Caminho de streaming (`session.isStreaming === true`)

- `prompt(...)` ainda executa as transformações de extensão/customizado/arquivo/template primeiro
- depois requer `streamingBehavior`:
  - `"steer"` -> enfileira mensagem de interrupção (`agent.steer`)
  - `"followUp"` -> enfileira mensagem pós-turno (`agent.followUp`)
- se `streamingBehavior` for omitido, o prompt lança um erro

### Comportamento de streaming específico por comando

- Comandos de extensão são executados imediatamente mesmo durante o streaming (não enfileirados como texto).
- Os métodos auxiliares `steer(...)`/`followUp(...)` rejeitam comandos de extensão (`#throwIfExtensionCommand`) para evitar enfileirar texto de comandos para handlers que devem ser executados de forma síncrona.
- A reprodução da fila de compactação usa `isKnownSlashCommand(...)` para decidir se entradas enfileiradas devem ser reproduzidas via `session.prompt(...)` (para slash commands conhecidos) ou via métodos brutos de steer/follow-up.

## 9) Tratamento de erros e superfícies de falha

- Falhas de carregamento de provedores são isoladas; o registro coleta avisos e continua com os outros provedores.
- Itens de slash command inválidos (nome/caminho/conteúdo ausente ou nível inválido) são descartados pela validação de capability.
- Falhas de análise de frontmatter:
  - comandos nativos: erro fatal de análise é propagado
  - comandos não nativos: aviso + análise de fallback por chave/valor
- Exceções de handlers de comandos de extensão/customizados são capturadas e reportadas via canal de erros de extensão (ou fallback de logger para comandos customizados sem extension runner), e tratadas como processadas (sem execução de fallback indesejada).
