---
title: Descoberta e Seleção de Agentes de Tarefa
description: >-
  Lógica de descoberta e seleção de agentes de tarefa para encaminhar trabalho a
  tipos de subagentes especializados.
sidebar:
  order: 6
  label: Descoberta de agentes de tarefa
i18n:
  sourceHash: 8cf42457c672
  translator: machine
---

# Descoberta e Seleção de Agentes de Tarefa

Este documento descreve como o subsistema de tarefas descobre definições de agentes, mescla múltiplas fontes e resolve um agente solicitado em tempo de execução.

Ele cobre o comportamento em tempo de execução conforme implementado atualmente, incluindo precedência, tratamento de definições inválidas e restrições de criação/profundidade que podem tornar um agente efetivamente indisponível.

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

A análise vem do frontmatter via `parseAgentFields()` (`src/discovery/helpers.ts`):

- `name` ou `description` ausentes => inválido (`null`), o chamador trata como falha de análise
- `tools` aceita CSV ou array; se fornecido, `submit_result` é adicionado automaticamente
- `spawns` aceita `*`, CSV ou array
- comportamento de retrocompatibilidade: se `spawns` estiver ausente mas `tools` incluir `task`, `spawns` se torna `*`
- `output` é passado adiante como dados opacos de schema

## Agentes embarcados

Os agentes embarcados são incorporados em tempo de compilação (`src/task/agents.ts`) usando importações de texto.

`EMBEDDED_AGENT_DEFS` define:

- `explore`, `plan`, `designer`, `reviewer` a partir de arquivos de prompt
- `task` e `quick_task` a partir do corpo compartilhado de `task.md` mais frontmatter injetado

Caminho de carregamento:

1. `loadBundledAgents()` analisa o markdown incorporado com `parseAgent(..., "bundled", "fatal")`
2. os resultados são armazenados em cache na memória (`bundledAgentsCache`)
3. `clearBundledAgentsCache()` é uma limpeza de cache apenas para testes

Como a análise dos embarcados usa `level: "fatal"`, frontmatter malformado nos embarcados lança exceção e pode fazer toda a descoberta falhar.

## Descoberta via sistema de arquivos e plugins

`discoverAgents(cwd, home)` (`src/task/discovery.ts`) mescla agentes de múltiplos locais antes de adicionar as definições embarcadas.

### Entradas da descoberta

1. Diretórios de agentes da configuração do usuário via `getConfigDirs("agents", { project: false })`
2. Diretórios de agentes do projeto mais próximos via `findAllNearestProjectConfigDirs("agents", cwd)`
3. Raízes de plugins Claude (`listClaudePluginRoots(home)`) com subdiretórios `agents/`
4. Agentes embarcados (`loadBundledAgents()`)

### Ordem real das fontes

A ordem das famílias de fontes vem de `getConfigDirs("", { project: false })`, que é derivada de `priorityList` em `src/config.ts`:

1. `.xcsh`
2. `.claude`
3. `.codex`
4. `.gemini`

Para cada família de fonte, a ordem de descoberta é:

1. diretório do projeto mais próximo para aquela fonte (se encontrado)
2. diretório do usuário para aquela fonte

Após todos os diretórios das famílias de fontes, os diretórios `agents/` de plugins são adicionados (plugins de escopo de projeto primeiro, depois de escopo de usuário).

Os agentes embarcados são adicionados por último.

### Ressalva importante: comentários desatualizados vs código atual

Os comentários de cabeçalho em `discovery.ts` ainda mencionam `.pi` e não mencionam `.codex`/`.gemini`. A ordem real em tempo de execução é controlada por `src/config.ts` e atualmente usa `.xcsh`, `.claude`, `.codex`, `.gemini`.

## Regras de mesclagem e colisão

A descoberta usa deduplicação "primeiro vence" por nome exato (`agent.name`):

- Um `Set<string>` rastreia os nomes já vistos.
- Os agentes carregados são achatados na ordem dos diretórios e mantidos apenas se o nome não foi visto.
- Os agentes embarcados são filtrados contra o mesmo conjunto e adicionados apenas se ainda não vistos.

Implicações:

- Projeto sobrescreve usuário para a mesma família de fonte.
- Família de fonte de maior prioridade sobrescreve a de menor (`.xcsh` antes de `.claude`, etc.).
- Agentes não embarcados sobrescrevem agentes embarcados com o mesmo nome.
- A correspondência de nomes é sensível a maiúsculas e minúsculas (`Task` e `task` são distintos).
- Dentro de um diretório, arquivos markdown são lidos em ordem lexicográfica de nome de arquivo antes da deduplicação.

## Comportamento com arquivos de agente inválidos/ausentes

Por diretório (`loadAgentsFromDir`):

- diretório ilegível/ausente: tratado como vazio (`readdir(...).catch(() => [])`)
- falha na leitura ou análise de arquivo: aviso registrado, arquivo ignorado
- o caminho de análise usa `parseAgent(..., level: "warn")`

O comportamento de falha no frontmatter vem de `parseFrontmatter`:

- erro de análise no nível `warn` registra aviso
- o analisador recorre a um analisador simples de linhas `key: value`
- se os campos obrigatórios ainda estiverem ausentes, `parseAgentFields` falha, então `AgentParsingError` é lançado e capturado pelo chamador (arquivo ignorado)

Efeito final: um único arquivo de agente personalizado com erro não interrompe a descoberta dos demais arquivos.

## Busca e seleção de agente

A busca é uma pesquisa linear por nome exato:

- `getAgent(agents, name)` => `agents.find(a => a.name === name)`

Na execução da tarefa (`TaskTool.execute`):

1. os agentes são redescobertos no momento da chamada (`discoverAgents(this.session.cwd)`)
2. o `params.agent` solicitado é resolvido através de `getAgent`
3. agente ausente retorna resposta imediata da ferramenta:
   - `Unknown agent "...". Available: ...`
   - nenhum subprocesso é executado

### Descrição vs descoberta em tempo de execução

`TaskTool.create()` constrói a descrição da ferramenta a partir dos resultados da descoberta no momento da inicialização (`buildDescription`).

`execute()` redescobre os agentes novamente. Portanto, o conjunto em tempo de execução pode diferir do que foi listado na descrição anterior da ferramenta se os arquivos de agente mudaram durante a sessão.

## Proteções de saída estruturada e precedência de schema

Precedência do schema de saída em tempo de execução em `TaskTool.execute`:

1. `output` do frontmatter do agente
2. `params.schema` da chamada da tarefa
3. `outputSchema` da sessão pai

(`effectiveOutputSchema = effectiveAgent.output ?? outputSchema ?? this.session.outputSchema`)

O texto de proteção em tempo de prompt em `src/prompts/tools/task.md` adverte sobre comportamento de incompatibilidade para agentes de saída estruturada (`explore`, `reviewer`): instruções de formato de saída em texto podem conflitar com o schema integrado e produzir saídas `null`.

Isso é orientação, não lógica de validação rígida em tempo de execução em `discoverAgents`.

## Interação com descoberta de comandos

`src/task/commands.ts` é infraestrutura paralela para comandos de fluxo de trabalho (não definições de agentes), mas segue o mesmo padrão geral:

- descobrir primeiro a partir de provedores de capacidade
- deduplicar por nome com "primeiro vence"
- adicionar comandos embarcados se ainda não vistos
- busca por nome exato via `getCommand`

Em `src/task/index.ts`, os auxiliares de comando são re-exportados junto com os auxiliares de descoberta de agentes. A descoberta de agentes em si não depende da descoberta de comandos em tempo de execução.

## Restrições de disponibilidade além da descoberta

Um agente pode ser descoberto mas ainda estar indisponível para execução devido a proteções de execução.

### Política de criação do pai

`TaskTool.execute` verifica `session.getSessionSpawns()`:

- `"*"` => permitir qualquer
- `""` => negar todos
- lista CSV => permitir apenas os nomes listados

Se negado: resposta imediata `Cannot spawn '...'. Allowed: ...`.

### Proteção de ambiente contra auto-recursão bloqueada

`PI_BLOCKED_AGENT` é lido na construção da ferramenta. Se a solicitação corresponder, a execução é rejeitada com mensagem de prevenção de recursão.

### Controle de profundidade de recursão (disponibilidade da ferramenta task dentro de sessões filhas)

Em `runSubprocess` (`src/task/executor.ts`):

- a profundidade é calculada a partir de `taskDepth`
- `task.maxRecursionDepth` controla o limite
- quando na profundidade máxima:
  - a ferramenta `task` é removida da lista de ferramentas filhas
  - `spawns` do ambiente filho é definido como vazio

Portanto, níveis mais profundos não podem criar novas tarefas mesmo que a definição do agente inclua `spawns`.

## Ressalva sobre o modo de planejamento (implementação atual)

`TaskTool.execute` calcula um `effectiveAgent` para o modo de planejamento (adiciona prompt de modo de planejamento no início, força subconjunto de ferramentas somente leitura, limpa spawns), mas `runSubprocess` é chamado com `agent` em vez de `effectiveAgent`.

Efeito atual:

- sobrescrita de modelo / nível de raciocínio / schema de saída são derivados de `effectiveAgent`
- prompt de sistema e restrições de ferramentas/spawns de `effectiveAgent` não são passados neste caminho de chamada

Esta é uma ressalva de implementação importante ao analisar as expectativas de comportamento do modo de planejamento.
