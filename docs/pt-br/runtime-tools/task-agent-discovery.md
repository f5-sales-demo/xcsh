---
title: Descoberta e Seleção de Agentes de Tarefa
description: >-
  Lógica de descoberta e seleção de agentes de tarefa para roteamento de
  trabalho para tipos especializados de subagentes.
sidebar:
  order: 6
  label: Descoberta de agentes de tarefa
i18n:
  sourceHash: 8cf42457c672
  translator: machine
---

# Descoberta e Seleção de Agentes de Tarefa

Este documento descreve como o subsistema de tarefas descobre definições de agentes, mescla múltiplas fontes e resolve um agente solicitado no momento da execução.

Ele abrange o comportamento em tempo de execução conforme implementado atualmente, incluindo precedência, tratamento de definições inválidas e restrições de spawn/profundidade que podem tornar um agente efetivamente indisponível.

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

## Formato de definição de agente

Os agentes de tarefa são normalizados para `AgentDefinition` (`src/task/types.ts`):

- `name`, `description`, `systemPrompt` (obrigatórios para um agente carregado válido)
- `tools`, `spawns`, `model`, `thinkingLevel`, `output` (opcionais)
- `source`: `"bundled" | "user" | "project"`
- `filePath` (opcional)

A análise vem do frontmatter via `parseAgentFields()` (`src/discovery/helpers.ts`):

- `name` ou `description` ausentes => inválido (`null`), o chamador trata como falha de análise
- `tools` aceita CSV ou array; se fornecido, `submit_result` é adicionado automaticamente
- `spawns` aceita `*`, CSV ou array
- comportamento de compatibilidade retroativa: se `spawns` estiver ausente mas `tools` incluir `task`, `spawns` passa a ser `*`
- `output` é repassado como dados de esquema opacos

## Agentes embutidos

Os agentes embutidos são incorporados no momento da compilação (`src/task/agents.ts`) usando importações de texto.

`EMBEDDED_AGENT_DEFS` define:

- `explore`, `plan`, `designer`, `reviewer` a partir de arquivos de prompt
- `task` e `quick_task` a partir do corpo compartilhado `task.md` mais frontmatter injetado

Caminho de carregamento:

1. `loadBundledAgents()` analisa o markdown incorporado com `parseAgent(..., "bundled", "fatal")`
2. os resultados são armazenados em cache na memória (`bundledAgentsCache`)
3. `clearBundledAgentsCache()` é uma redefinição de cache exclusiva para testes

Como a análise dos agentes embutidos usa `level: "fatal"`, frontmatter malformado lança uma exceção e pode causar falha na descoberta inteiramente.

## Descoberta no sistema de arquivos e em plugins

`discoverAgents(cwd, home)` (`src/task/discovery.ts`) mescla agentes de múltiplos locais antes de acrescentar as definições embutidas.

### Entradas de descoberta

1. Diretórios de agentes da configuração do usuário obtidos via `getConfigDirs("agents", { project: false })`
2. Diretórios de agentes do projeto mais próximo obtidos via `findAllNearestProjectConfigDirs("agents", cwd)`
3. Raízes de plugins Claude (`listClaudePluginRoots(home)`) com subdiretórios `agents/`
4. Agentes embutidos (`loadBundledAgents()`)

### Ordem real das fontes

A ordem das famílias de fontes vem de `getConfigDirs("", { project: false })`, derivada de `priorityList` em `src/config.ts`:

1. `.xcsh`
2. `.claude`
3. `.codex`
4. `.gemini`

Para cada família de fontes, a ordem de descoberta é:

1. diretório do projeto mais próximo para aquela fonte (se encontrado)
2. diretório do usuário para aquela fonte

Após todos os diretórios de famílias de fontes, os diretórios `agents/` de plugins são acrescentados (plugins de escopo de projeto primeiro, depois de escopo de usuário).

Os agentes embutidos são acrescentados por último.

### Ressalva importante: comentários desatualizados vs. código atual

Os comentários de cabeçalho em `discovery.ts` ainda mencionam `.pi` e não mencionam `.codex`/`.gemini`. A ordem em tempo de execução real é determinada por `src/config.ts` e atualmente utiliza `.xcsh`, `.claude`, `.codex`, `.gemini`.

## Regras de mesclagem e colisão

A descoberta usa deduplicação por nome exato com política de primeiro a chegar:

- Um `Set<string>` rastreia os nomes já vistos.
- Os agentes carregados são achatados na ordem dos diretórios e mantidos apenas se o nome ainda não foi visto.
- Os agentes embutidos são filtrados em relação ao mesmo conjunto e adicionados apenas se ainda não foram vistos.

Implicações:

- O projeto substitui o usuário para a mesma família de fontes.
- Famílias de fontes de maior prioridade substituem as de menor prioridade (`.xcsh` antes de `.claude`, etc.).
- Agentes não embutidos substituem agentes embutidos com o mesmo nome.
- A correspondência de nomes é sensível a maiúsculas e minúsculas (`Task` e `task` são distintos).
- Dentro de um mesmo diretório, os arquivos markdown são lidos em ordem lexicográfica de nome de arquivo antes da deduplicação.

## Comportamento com arquivos de agente inválidos ou ausentes

Por diretório (`loadAgentsFromDir`):

- diretório ilegível ou ausente: tratado como vazio (`readdir(...).catch(() => [])`)
- falha de leitura ou análise de arquivo: aviso registrado, arquivo ignorado
- o caminho de análise usa `parseAgent(..., level: "warn")`

O comportamento de falha do frontmatter vem de `parseFrontmatter`:

- erro de análise no nível `warn` registra aviso
- o analisador retorna a um parser simples de linha `key: value`
- se os campos obrigatórios ainda estiverem ausentes, `parseAgentFields` falha, então `AgentParsingError` é lançado e capturado pelo chamador (arquivo ignorado)

Efeito líquido: um arquivo de agente personalizado inválido não aborta a descoberta dos demais arquivos.

## Pesquisa e seleção de agente

A pesquisa é uma busca linear por nome exato:

- `getAgent(agents, name)` => `agents.find(a => a.name === name)`

Na execução de tarefas (`TaskTool.execute`):

1. os agentes são redescobertos no momento da chamada (`discoverAgents(this.session.cwd)`)
2. o `params.agent` solicitado é resolvido via `getAgent`
3. agente ausente retorna resposta imediata da ferramenta:
   - `Unknown agent "...". Available: ...`
   - nenhum subprocesso é executado

### Descoberta na descrição vs. no momento da execução

`TaskTool.create()` constrói a descrição da ferramenta a partir dos resultados de descoberta no momento da inicialização (`buildDescription`).

`execute()` redescobre os agentes novamente. Portanto, o conjunto em tempo de execução pode diferir do que foi listado na descrição anterior da ferramenta se os arquivos de agente foram alterados durante a sessão.

## Proteções de saída estruturada e precedência de esquema

Precedência do esquema de saída em tempo de execução em `TaskTool.execute`:

1. `output` do frontmatter do agente
2. `params.schema` da chamada de tarefa
3. `outputSchema` da sessão pai

(`effectiveOutputSchema = effectiveAgent.output ?? outputSchema ?? this.session.outputSchema`)

O texto de proteção em tempo de prompt em `src/prompts/tools/task.md` averte sobre o comportamento de incompatibilidade para agentes de saída estruturada (`explore`, `reviewer`): instruções de formato de saída em prosa podem conflitar com o esquema embutido e produzir saídas `null`.

Isso é uma orientação, não lógica de validação em tempo de execução em `discoverAgents`.

## Interação com a descoberta de comandos

`src/task/commands.ts` é uma infraestrutura paralela para comandos de fluxo de trabalho (não definições de agente), mas segue o mesmo padrão geral:

- descobrir a partir dos provedores de capacidade primeiro
- deduplicar por nome com política de primeiro a chegar
- acrescentar comandos embutidos se ainda não vistos
- pesquisa por nome exato via `getCommand`

Em `src/task/index.ts`, os auxiliares de comando são reexportados junto com os auxiliares de descoberta de agentes. A descoberta de agentes em si não depende da descoberta de comandos em tempo de execução.

## Restrições de disponibilidade além da descoberta

Um agente pode ser detectável, mas ainda assim indisponível para execução devido a proteções de execução.

### Política de spawn do pai

`TaskTool.execute` verifica `session.getSessionSpawns()`:

- `"*"` => permitir qualquer um
- `""` => negar todos
- lista CSV => permitir apenas os nomes listados

Se negado: resposta imediata `Cannot spawn '...'. Allowed: ...`.

### Proteção de ambiente contra autorrecursão bloqueada

`PI_BLOCKED_AGENT` é lido na construção da ferramenta. Se a solicitação corresponder, a execução é rejeitada com uma mensagem de prevenção de recursão.

### Limitação de profundidade de recursão (disponibilidade da ferramenta de tarefa em sessões filhas)

Em `runSubprocess` (`src/task/executor.ts`):

- a profundidade é calculada a partir de `taskDepth`
- `task.maxRecursionDepth` controla o limite
- ao atingir a profundidade máxima:
  - a ferramenta `task` é removida da lista de ferramentas da sessão filha
  - `spawns` do ambiente filho é definido como vazio

Portanto, níveis mais profundos não podem gerar mais tarefas mesmo que a definição do agente inclua `spawns`.

## Ressalva sobre o modo de plano (implementação atual)

`TaskTool.execute` calcula um `effectiveAgent` para o modo de plano (adiciona o prompt do modo de plano ao início, força um subconjunto de ferramentas somente leitura, limpa spawns), mas `runSubprocess` é chamado com `agent` em vez de `effectiveAgent`.

Efeito atual:

- a substituição de modelo / nível de raciocínio / esquema de saída são derivados de `effectiveAgent`
- o prompt do sistema e as restrições de ferramenta/spawn de `effectiveAgent` não são repassados neste caminho de chamada

Esta é uma ressalva de implementação importante ao analisar as expectativas de comportamento do modo de plano.
