---
title: Task Agent Discovery and Selection
description: >-
  Lógica de descoberta e seleção de agentes de tarefa para roteamento de
  trabalho a tipos de subagentes especializados.
sidebar:
  order: 6
  label: Descoberta de agentes de tarefa
i18n:
  sourceHash: 8cf42457c672
  translator: machine
---

# Descoberta e Seleção de Agentes de Tarefa

Este documento descreve como o subsistema de tarefas descobre definições de agentes, mescla múltiplas fontes e resolve um agente solicitado no momento da execução.

Ele cobre o comportamento em tempo de execução conforme implementado atualmente, incluindo precedência, tratamento de definições inválidas e restrições de spawn/profundidade que podem tornar um agente efetivamente indisponível.

## Arquivos de implementação

- [`src/task/discovery.ts`](../../packages/coding-agent/src/task/discovery.ts)
- [`src/task/agents.ts`](../../packages/coding-agent/src/task/agents.ts)
- [`src/task/types.ts`](../../packages/coding-agent/src/task/types.ts)
- [`src/task/index.ts`](../../packages/coding-agent/src/task/index.ts)
- [`src/task/commands.ts`](../../packages/coding-agent/src/task/commands.ts)
- [`src/prompts/agents/task.md`](../../packages/coding-agent/src/prompts/agents/task.md)
- [`src/prompts/tools/task.md`](../../packages/coding-agent/src/prompts/tools/task.md)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/config.ts`](../../packages/coding-agent/src/config.ts)
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts)

---

## Formato da definição de agente

Os agentes de tarefa são normalizados em `AgentDefinition` (`src/task/types.ts`):

- `name`, `description`, `systemPrompt` (obrigatórios para um agente carregado válido)
- opcionais: `tools`, `spawns`, `model`, `thinkingLevel`, `output`
- `source`: `"bundled" | "user" | "project"`
- opcional: `filePath`

O parsing vem do frontmatter via `parseAgentFields()` (`src/discovery/helpers.ts`):

- `name` ou `description` ausentes => inválido (`null`), o chamador trata como falha de parsing
- `tools` aceita CSV ou array; se fornecido, `submit_result` é adicionado automaticamente
- `spawns` aceita `*`, CSV ou array
- comportamento de compatibilidade retroativa: se `spawns` estiver ausente mas `tools` incluir `task`, `spawns` torna-se `*`
- `output` é repassado como dados de schema opacos

## Agentes empacotados

Os agentes empacotados são incorporados no momento do build (`src/task/agents.ts`) usando importações de texto.

`EMBEDDED_AGENT_DEFS` define:

- `explore`, `plan`, `designer`, `reviewer` a partir de arquivos de prompt
- `task` e `quick_task` a partir do corpo compartilhado `task.md` mais frontmatter injetado

Caminho de carregamento:

1. `loadBundledAgents()` faz o parsing do markdown incorporado com `parseAgent(..., "bundled", "fatal")`
2. os resultados são cacheados em memória (`bundledAgentsCache`)
3. `clearBundledAgentsCache()` é uma redefinição de cache apenas para testes

Como o parsing dos empacotados usa `level: "fatal"`, frontmatter malformado nos empacotados lança exceção e pode falhar a descoberta inteiramente.

## Descoberta no sistema de arquivos e plugins

`discoverAgents(cwd, home)` (`src/task/discovery.ts`) mescla agentes de múltiplos locais antes de adicionar as definições empacotadas.

### Entradas de descoberta

1. Diretórios de agentes da configuração do usuário a partir de `getConfigDirs("agents", { project: false })`
2. Diretórios de agentes do projeto mais próximo a partir de `findAllNearestProjectConfigDirs("agents", cwd)`
3. Raízes de plugins Claude (`listClaudePluginRoots(home)`) com subdiretórios `agents/`
4. Agentes empacotados (`loadBundledAgents()`)

### Ordem real das fontes

A ordem das famílias de fontes vem de `getConfigDirs("", { project: false })`, que é derivado de `priorityList` em `src/config.ts`:

1. `.xcsh`
2. `.claude`
3. `.codex`
4. `.gemini`

Para cada família de fontes, a ordem de descoberta é:

1. diretório do projeto mais próximo para essa fonte (se encontrado)
2. diretório do usuário para essa fonte

Após todos os diretórios das famílias de fontes, os diretórios `agents/` dos plugins são adicionados (plugins com escopo de projeto primeiro, depois escopo de usuário).

Os agentes empacotados são adicionados por último.

### Ressalva importante: comentários desatualizados vs código atual

Os comentários de cabeçalho em `discovery.ts` ainda mencionam `.pi` e não mencionam `.codex`/`.gemini`. A ordem real em tempo de execução é controlada por `src/config.ts` e atualmente usa `.xcsh`, `.claude`, `.codex`, `.gemini`.

## Regras de mesclagem e colisão

A descoberta usa deduplicação por primeiro-vence baseada no `agent.name` exato:

- Um `Set<string>` rastreia os nomes já vistos.
- Os agentes carregados são achatados na ordem dos diretórios e mantidos apenas se o nome não foi visto.
- Os agentes empacotados são filtrados contra o mesmo conjunto e adicionados apenas se ainda não vistos.

Implicações:

- Projeto sobrescreve usuário para a mesma família de fontes.
- Família de fontes de maior prioridade sobrescreve a de menor (`.xcsh` antes de `.claude`, etc.).
- Agentes não empacotados sobrescrevem agentes empacotados com o mesmo nome.
- A correspondência de nomes é sensível a maiúsculas e minúsculas (`Task` e `task` são distintos).
- Dentro de um diretório, os arquivos markdown são lidos em ordem lexicográfica de nome de arquivo antes da deduplicação.

## Comportamento com arquivo de agente inválido/ausente

Por diretório (`loadAgentsFromDir`):

- diretório ilegível/ausente: tratado como vazio (`readdir(...).catch(() => [])`)
- falha de leitura ou parsing de arquivo: aviso registrado, arquivo ignorado
- o caminho de parsing usa `parseAgent(..., level: "warn")`

O comportamento de falha do frontmatter vem de `parseFrontmatter`:

- erro de parsing no nível `warn` registra aviso
- o parser faz fallback para um parser simples de linhas `key: value`
- se os campos obrigatórios ainda estiverem ausentes, `parseAgentFields` falha, então `AgentParsingError` é lançado e capturado pelo chamador (arquivo ignorado)

Efeito líquido: um arquivo de agente personalizado defeituoso não interrompe a descoberta de outros arquivos.

## Busca e seleção de agente

A busca é uma pesquisa linear por nome exato:

- `getAgent(agents, name)` => `agents.find(a => a.name === name)`

Na execução de tarefas (`TaskTool.execute`):

1. os agentes são redescobertos no momento da chamada (`discoverAgents(this.session.cwd)`)
2. o `params.agent` solicitado é resolvido através de `getAgent`
3. agente ausente retorna resposta imediata da ferramenta:
   - `Unknown agent "...". Available: ...`
   - nenhum subprocesso é executado

### Descrição vs descoberta no momento da execução

`TaskTool.create()` constrói a descrição da ferramenta a partir dos resultados de descoberta no momento da inicialização (`buildDescription`).

`execute()` redescobre os agentes novamente. Portanto, o conjunto em tempo de execução pode diferir do que foi listado na descrição anterior da ferramenta se os arquivos de agentes mudaram durante a sessão.

## Proteções de saída estruturada e precedência de schema

Precedência do schema de saída em tempo de execução em `TaskTool.execute`:

1. `output` do frontmatter do agente
2. `params.schema` da chamada da tarefa
3. `outputSchema` da sessão pai

(`effectiveOutputSchema = effectiveAgent.output ?? outputSchema ?? this.session.outputSchema`)

O texto de proteção no momento do prompt em `src/prompts/tools/task.md` avisa sobre o comportamento de incompatibilidade para agentes com saída estruturada (`explore`, `reviewer`): instruções de formato de saída no texto em prosa podem conflitar com o schema embutido e produzir saídas `null`.

Isso é orientação, não lógica de validação rígida em tempo de execução em `discoverAgents`.

## Interação com descoberta de comandos

`src/task/commands.ts` é infraestrutura paralela para comandos de workflow (não definições de agentes), mas segue o mesmo padrão geral:

- descobrir a partir de provedores de capacidade primeiro
- deduplicar por nome com primeiro-vence
- adicionar comandos empacotados se ainda não vistos
- busca por nome exato via `getCommand`

Em `src/task/index.ts`, os helpers de comandos são re-exportados junto com os helpers de descoberta de agentes. A descoberta de agentes em si não depende da descoberta de comandos em tempo de execução.

## Restrições de disponibilidade além da descoberta

Um agente pode ser descobrível mas ainda assim indisponível para execução devido a proteções de execução.

### Política de spawn do pai

`TaskTool.execute` verifica `session.getSessionSpawns()`:

- `"*"` => permitir qualquer um
- `""` => negar todos
- lista CSV => permitir apenas os nomes listados

Se negado: resposta imediata `Cannot spawn '...'. Allowed: ...`.

### Guarda de ambiente contra auto-recursão bloqueada

`PI_BLOCKED_AGENT` é lido na construção da ferramenta. Se a solicitação corresponder, a execução é rejeitada com mensagem de prevenção de recursão.

### Controle de profundidade de recursão (disponibilidade da ferramenta task dentro de sessões filhas)

Em `runSubprocess` (`src/task/executor.ts`):

- a profundidade é calculada a partir de `taskDepth`
- `task.maxRecursionDepth` controla o limite
- quando na profundidade máxima:
  - a ferramenta `task` é removida da lista de ferramentas filhas
  - o `spawns` do ambiente filho é definido como vazio

Portanto, níveis mais profundos não podem criar novas tarefas mesmo que a definição do agente inclua `spawns`.

## Ressalva do modo plan (implementação atual)

`TaskTool.execute` calcula um `effectiveAgent` para o modo plan (adiciona prompt de modo plan no início, força subconjunto de ferramentas somente leitura, limpa spawns), mas `runSubprocess` é chamado com `agent` em vez de `effectiveAgent`.

Efeito atual:

- sobrescrita de modelo / nível de thinking / schema de saída são derivados de `effectiveAgent`
- prompt do sistema e restrições de ferramentas/spawns de `effectiveAgent` não são repassadas neste caminho de chamada

Esta é uma ressalva de implementação importante de conhecer ao ler as expectativas de comportamento do modo plan.
