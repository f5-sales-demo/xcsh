---
title: Skills
description: >-
  Sistema de skills para registrar, descobrir e invocar capacidades
  especializadas no agente de codificação.
sidebar:
  order: 3
  label: Skills
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# Skills

Skills são pacotes de capacidades apoiados em arquivos, descobertos na inicialização e expostos ao modelo como:

- metadados leves no prompt do sistema (nome + descrição)
- conteúdo sob demanda via `read skill://...`
- comandos interativos opcionais `/skill:<name>`

Este documento cobre o comportamento atual em tempo de execução em `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` e `src/discovery/agents-md.ts`.

## O que é uma skill neste codebase

Uma skill descoberta é representada como:

- `name`
- `description`
- `filePath` (o caminho do `SKILL.md`)
- `baseDir` (diretório da skill)
- metadados de origem (`provider`, `level`, path)

O runtime requer apenas `name` e `path` para validade. Na prática, a qualidade da correspondência depende de `description` ser significativa.

## Layout necessário e expectativas do SKILL.md

### Layout de diretórios

Para descoberta baseada em provedores (provedores native/Claude/Codex/Agents/plugin), as skills são descobertas como **um nível abaixo de `skills/`**:

- `<skills-root>/<skill-name>/SKILL.md`

Padrões aninhados como `<skills-root>/group/<skill>/SKILL.md` não são descobertos pelos carregadores de provedores.

Para `skills.customDirectories`, a varredura usa o mesmo layout não recursivo (`*/SKILL.md`).

```text
Provider-discovered layout (non-recursive under skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ discovered
  ├─ pdf/
  │   └─ SKILL.md      ✅ discovered
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ not discovered by provider loaders

Custom-directory scanning is also non-recursive, so nested paths are ignored unless you point `customDirectories` at that nested parent.
```

### Frontmatter do `SKILL.md`

Campos de frontmatter suportados no tipo de skill:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- chaves adicionais são preservadas como metadados desconhecidos

Comportamento atual em tempo de execução:

- `name` assume como padrão o nome do diretório da skill
- `description` é obrigatório para:
  - descoberta de skills do provedor nativo `.xcsh` (`requireDescription: true`)
  - varreduras de `skills.customDirectories` via `scanSkillsFromDir` em `src/discovery/helpers.ts` (não recursivo)
- provedores não nativos podem carregar skills sem descrição

## Pipeline de descoberta

`discoverSkills()` em `src/extensibility/skills.ts` faz duas passagens:

1. **Provedores de capacidade** via `loadCapability("skills")`
2. **Diretórios customizados** via `scanSkillsFromDir(..., { requireDescription: true })` (enumeração de diretórios de um nível)

Se `skills.enabled` for `false`, a descoberta não retorna nenhuma skill.

### Provedores de skills integrados e precedência

A ordenação de provedores é por prioridade primeiro (maior vence), depois por ordem de registro em caso de empate.

Provedores de skills registrados atualmente:

1. `native` (prioridade 100) — skills de usuário/projeto `.xcsh` via `src/discovery/builtin.ts`
2. `claude` (prioridade 80)
3. grupo de prioridade 70 (na ordem de registro):
   - `claude-plugins`
   - `agents`
   - `codex`

A chave de deduplicação é o nome da skill. O primeiro item com um determinado nome vence.

### Toggles de origem e filtragem

`discoverSkills()` aplica estes controles:

- toggles de origem: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- filtros glob no nome da skill:
  - `ignoredSkills` (excluir)
  - `includeSkills` (lista de inclusão; vazio significa incluir todos)

A ordem de filtragem é:

1. origem habilitada
2. não ignorada
3. incluída (se a lista de inclusão estiver presente)

Para provedores diferentes de codex/claude/native (por exemplo `agents`, `claude-plugins`), a habilitação atualmente recorre a: habilitado se **qualquer** toggle de origem integrado estiver habilitado.

### Colisões e tratamento de duplicatas

- A deduplicação de capacidades já mantém a primeira skill por nome (provedor de maior precedência)
- `extensibility/skills.ts` adicionalmente:
  - deduplica arquivos idênticos por `realpath` (seguro para symlinks)
  - emite avisos de colisão quando um nome de skill posterior conflita
  - mantém a API de conveniência `discoverSkillsFromDir({ dir, source })` como um adaptador fino sobre `scanSkillsFromDir`
- Skills de diretórios customizados são mescladas após as skills de provedores e seguem o mesmo comportamento de colisão

## Comportamento de uso em tempo de execução

### Exposição no prompt do sistema

A construção do prompt do sistema (`src/system-prompt.ts`) usa as skills descobertas da seguinte forma:

- se a ferramenta `read` estiver disponível:
  - incluir a lista de skills descobertas no prompt
- caso contrário:
  - omitir a lista descoberta

Subagentes da ferramenta task recebem a lista de skills descobertas/fornecidas da sessão via criação normal de sessão; não há override de fixação de skill por tarefa.

### Comandos interativos `/skill:<name>`

Se `skills.enableSkillCommands` for true, o modo interativo registra um comando slash por skill descoberta.

Comportamento de `/skill:<name> [args]`:

- lê o arquivo da skill diretamente de `filePath`
- remove o frontmatter
- injeta o corpo da skill como uma mensagem customizada de acompanhamento
- adiciona metadados (`Skill: <path>`, opcional `User: <args>`)

## Comportamento da URL `skill://`

`src/internal-urls/skill-protocol.ts` suporta:

- `skill://<name>` → resolve para o `SKILL.md` daquela skill
- `skill://<name>/<relative-path>` → resolve dentro do diretório daquela skill

```text
skill:// URL resolution

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

Guards:
- reject absolute paths
- reject `..` traversal
- reject any resolved path escaping <pdf-base>
```

Detalhes da resolução:

- o nome da skill deve corresponder exatamente
- caminhos relativos são decodificados de URL
- caminhos absolutos são rejeitados
- travessia de caminho (`..`) é rejeitada
- o caminho resolvido deve permanecer dentro de `baseDir`
- arquivos ausentes retornam um erro explícito `File not found`

Tipo de conteúdo:

- `.md` => `text/markdown`
- todo o resto => `text/plain`

Nenhuma busca de fallback é realizada para assets ausentes.

## Skills vs AGENTS.md, comandos, ferramentas, hooks

### Skills vs AGENTS.md

- **Skills**: pacotes de capacidade nomeados e opcionais, selecionados pelo contexto da tarefa ou explicitamente solicitados
- **AGENTS.md/arquivos de contexto**: arquivos de instrução persistentes carregados como capacidade de arquivo de contexto e mesclados por regras de nível/profundidade

`src/discovery/agents-md.ts` especificamente percorre diretórios ancestrais a partir de `cwd` para descobrir arquivos `AGENTS.md` independentes (até profundidade 20), excluindo segmentos de diretórios ocultos.

### Skills vs comandos slash

- **Skills**: conteúdo de conhecimento/fluxo de trabalho legível pelo modelo
- **Comandos slash**: pontos de entrada de comandos invocados pelo usuário
- `/skill:<name>` é um wrapper de conveniência que injeta o texto da skill; não altera a semântica de descoberta de skills

### Skills vs ferramentas customizadas

- **Skills**: conteúdo de documentação/fluxo de trabalho carregado através do contexto do prompt e `read`
- **Ferramentas customizadas**: APIs de ferramentas executáveis chamáveis pelo modelo com schemas e efeitos colaterais em tempo de execução

### Skills vs hooks

- **Skills**: conteúdo passivo
- **Hooks**: interceptadores em tempo de execução orientados a eventos que podem bloquear/modificar o comportamento durante a execução

## Orientações práticas de autoria vinculadas à lógica de descoberta

- Coloque cada skill em seu próprio diretório: `<skills-root>/<skill-name>/SKILL.md`
- Sempre inclua frontmatter explícito de `name` e `description`
- Mantenha assets referenciados sob o mesmo diretório da skill e acesse com `skill://<name>/...`
- Para taxonomia aninhada (`team/domain/skill`), aponte `skills.customDirectories` para o diretório pai aninhado; a varredura em si permanece não recursiva
- Evite nomes de skills duplicados entre origens; a primeira correspondência vence pela precedência do provedor
