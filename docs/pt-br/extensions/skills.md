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

Skills são pacotes de capacidades baseados em arquivos, descobertos na inicialização e expostos ao modelo como:

- metadados leves no prompt do sistema (nome + descrição)
- conteúdo sob demanda via `read skill://...`
- comandos interativos opcionais `/skill:<name>`

Este documento abrange o comportamento atual do runtime em `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` e `src/discovery/agents-md.ts`.

## O que é uma skill nesta base de código

Uma skill descoberta é representada como:

- `name`
- `description`
- `filePath` (o caminho `SKILL.md`)
- `baseDir` (diretório da skill)
- metadados de origem (`provider`, `level`, caminho)

O runtime requer apenas `name` e `path` para validade. Na prática, a qualidade da correspondência depende de `description` ser significativa.

## Layout obrigatório e expectativas do SKILL.md

### Layout de diretório

Para descoberta baseada em provider (providers nativos/Claude/Codex/Agents/plugin), as skills são descobertas **um nível abaixo de `skills/`**:

- `<skills-root>/<skill-name>/SKILL.md`

Padrões aninhados como `<skills-root>/group/<skill>/SKILL.md` não são descobertos pelos carregadores de provider.

Para `skills.customDirectories`, a varredura usa o mesmo layout não recursivo (`*/SKILL.md`).

```text
Layout descoberto por provider (não recursivo abaixo de skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ descoberto
  ├─ pdf/
  │   └─ SKILL.md      ✅ descoberto
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ não descoberto pelos carregadores de provider

A varredura de diretórios personalizados também é não recursiva, portanto caminhos aninhados são ignorados a menos que você aponte `customDirectories` para esse diretório pai aninhado.
```

### Frontmatter do `SKILL.md`

Campos de frontmatter suportados no tipo de skill:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- chaves adicionais são preservadas como metadados desconhecidos

Comportamento atual do runtime:

- `name` tem como padrão o nome do diretório da skill
- `description` é obrigatório para:
  - descoberta de skills do provider `.xcsh` nativo (`requireDescription: true`)
  - varreduras de `skills.customDirectories` via `scanSkillsFromDir` em `src/discovery/helpers.ts` (não recursivo)
- providers não nativos podem carregar skills sem descrição

## Pipeline de descoberta

`discoverSkills()` em `src/extensibility/skills.ts` realiza duas passagens:

1. **Providers de capacidade** via `loadCapability("skills")`
2. **Diretórios personalizados** via `scanSkillsFromDir(..., { requireDescription: true })` (enumeração de diretório em um nível)

Se `skills.enabled` for `false`, a descoberta não retorna skills.

### Providers de skill integrados e precedência

A ordenação de providers é por prioridade primeiro (maior vence), depois pela ordem de registro para empates.

Providers de skill registrados atualmente:

1. `native` (prioridade 100) — skills de usuário/projeto `.xcsh` via `src/discovery/builtin.ts`
2. `claude` (prioridade 80)
3. grupo de prioridade 70 (na ordem de registro):
   - `claude-plugins`
   - `agents`
   - `codex`

A chave de deduplicação é o nome da skill. O primeiro item com um determinado nome vence.

### Alternâncias de origem e filtragem

`discoverSkills()` aplica estes controles:

- alternâncias de origem: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- filtros glob no nome da skill:
  - `ignoredSkills` (excluir)
  - `includeSkills` (lista de permissões de inclusão; vazia significa incluir todas)

A ordem de filtragem é:

1. origem habilitada
2. não ignorada
3. incluída (se a lista de inclusão estiver presente)

Para providers além de codex/claude/native (por exemplo, `agents`, `claude-plugins`), a habilitação atualmente recorre a: habilitado se **qualquer** alternância de origem integrada estiver habilitada.

### Tratamento de colisões e duplicatas

- A deduplicação de capacidade já mantém a primeira skill por nome (provider de maior precedência)
- `extensibility/skills.ts` adicionalmente:
  - deduplica arquivos idênticos por `realpath` (seguro para symlinks)
  - emite avisos de colisão quando um nome de skill posterior entra em conflito
  - mantém a API de conveniência `discoverSkillsFromDir({ dir, source })` como um adaptador fino sobre `scanSkillsFromDir`
- Skills de diretórios personalizados são mescladas após as skills do provider e seguem o mesmo comportamento de colisão

## Comportamento de uso no runtime

### Exposição no prompt do sistema

A construção do prompt do sistema (`src/system-prompt.ts`) usa as skills descobertas da seguinte forma:

- se a ferramenta `read` estiver disponível:
  - inclui a lista de skills descobertas no prompt
- caso contrário:
  - omite a lista descoberta

Subagentes de ferramentas de tarefa recebem a lista de skills descobertas/fornecidas da sessão via criação normal de sessão; não há substituição de fixação de skill por tarefa.

### Comandos interativos `/skill:<name>`

Se `skills.enableSkillCommands` for verdadeiro, o modo interativo registra um comando slash por skill descoberta.

Comportamento de `/skill:<name> [args]`:

- lê o arquivo da skill diretamente de `filePath`
- remove o frontmatter
- injeta o corpo da skill como uma mensagem personalizada de acompanhamento
- acrescenta metadados (`Skill: <path>`, `User: <args>` opcional)

## Comportamento de URL `skill://`

`src/internal-urls/skill-protocol.ts` suporta:

- `skill://<name>` → resolve para o `SKILL.md` dessa skill
- `skill://<name>/<relative-path>` → resolve dentro desse diretório de skill

```text
Resolução de URL skill://

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

Guardas:
- rejeitar caminhos absolutos
- rejeitar travessia `..`
- rejeitar qualquer caminho resolvido que escape de <pdf-base>
```

Detalhes de resolução:

- o nome da skill deve corresponder exatamente
- caminhos relativos são decodificados por URL
- caminhos absolutos são rejeitados
- travessia de caminho (`..`) é rejeitada
- o caminho resolvido deve permanecer dentro de `baseDir`
- arquivos ausentes retornam um erro explícito `File not found`

Tipo de conteúdo:

- `.md` => `text/markdown`
- todo o resto => `text/plain`

Nenhuma busca de fallback é realizada para recursos ausentes.

## Skills vs XCSH.md, comandos, ferramentas, hooks

### Skills vs XCSH.md

- **Skills**: pacotes de capacidade nomeados e opcionais, selecionados pelo contexto da tarefa ou explicitamente solicitados
- **XCSH.md/arquivos de contexto**: arquivos de instrução persistentes carregados como capacidade de arquivo de contexto e mesclados por regras de nível/profundidade

`src/discovery/agents-md.ts` especificamente percorre diretórios ancestrais a partir de `cwd` para descobrir arquivos `XCSH.md` independentes (até profundidade 20), excluindo segmentos de diretórios ocultos.

### Skills vs comandos slash

- **Skills**: conteúdo de conhecimento/fluxo de trabalho legível pelo modelo
- **Comandos slash**: pontos de entrada de comandos invocados pelo usuário
- `/skill:<name>` é um wrapper de conveniência que injeta o texto da skill; não altera a semântica de descoberta de skills

### Skills vs ferramentas personalizadas

- **Skills**: conteúdo de documentação/fluxo de trabalho carregado por contexto de prompt e `read`
- **Ferramentas personalizadas**: APIs de ferramentas executáveis que podem ser chamadas pelo modelo com schemas e efeitos colaterais no runtime

### Skills vs hooks

- **Skills**: conteúdo passivo
- **Hooks**: interceptores de runtime orientados a eventos que podem bloquear/modificar o comportamento durante a execução

## Orientação prática de autoria vinculada à lógica de descoberta

- Coloque cada skill em seu próprio diretório: `<skills-root>/<skill-name>/SKILL.md`
- Sempre inclua frontmatter explícito com `name` e `description`
- Mantenha os recursos referenciados sob o mesmo diretório da skill e acesse-os com `skill://<name>/...`
- Para taxonomia aninhada (`team/domain/skill`), aponte `skills.customDirectories` para o diretório pai aninhado; a própria varredura permanece não recursiva
- Evite nomes de skill duplicados entre origens; a primeira correspondência vence pela precedência do provider
