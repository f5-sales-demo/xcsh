---
title: Skills
description: >-
  Sistema de Skills para registrar, descobrir e invocar capacidades
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

Este documento cobre o comportamento atual em tempo de execução em `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` e `src/discovery/agents-md.ts`.

## O que é uma skill neste codebase

Uma skill descoberta é representada como:

- `name`
- `description`
- `filePath` (o caminho do `SKILL.md`)
- `baseDir` (diretório da skill)
- metadados de origem (`provider`, `level`, path)

O runtime exige apenas `name` e `path` para validade. Na prática, a qualidade da correspondência depende de `description` ser significativa.

## Layout obrigatório e expectativas do SKILL.md

### Layout de diretório

Para descoberta baseada em provider (providers nativos/Claude/Codex/Agents/plugin), as skills são descobertas **um nível abaixo de `skills/`**:

- `<skills-root>/<skill-name>/SKILL.md`

Padrões aninhados como `<skills-root>/group/<skill>/SKILL.md` não são descobertos pelos carregadores de provider.

Para `skills.customDirectories`, a varredura utiliza o mesmo layout não-recursivo (`*/SKILL.md`).

```text
Layout descoberto por provider (não-recursivo abaixo de skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ descoberto
  ├─ pdf/
  │   └─ SKILL.md      ✅ descoberto
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ não descoberto pelos carregadores de provider

A varredura de diretórios personalizados também é não-recursiva, portanto caminhos aninhados são ignorados, a menos que você aponte `customDirectories` para esse diretório pai aninhado.
```

### Frontmatter do `SKILL.md`

Campos de frontmatter suportados no tipo de skill:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- chaves adicionais são preservadas como metadados desconhecidos

Comportamento atual em tempo de execução:

- `name` utiliza como padrão o nome do diretório da skill
- `description` é obrigatório para:
  - descoberta de skills pelo provider `.xcsh` nativo (`requireDescription: true`)
  - varreduras de `skills.customDirectories` via `scanSkillsFromDir` em `src/discovery/helpers.ts` (não-recursivo)
- providers não-nativos podem carregar skills sem descrição

## Pipeline de descoberta

`discoverSkills()` em `src/extensibility/skills.ts` realiza duas passagens:

1. **Providers de capacidade** via `loadCapability("skills")`
2. **Diretórios personalizados** via `scanSkillsFromDir(..., { requireDescription: true })` (enumeração de diretório em um nível)

Se `skills.enabled` for `false`, a descoberta não retorna skills.

### Providers de skills integrados e precedência

A ordenação dos providers é por prioridade (maior vence), depois por ordem de registro em caso de empate.

Providers de skills registrados atualmente:

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
  - `includeSkills` (lista de permissão de inclusão; vazia significa incluir todas)

A ordem dos filtros é:

1. origem habilitada
2. não ignorada
3. incluída (se a lista de inclusão estiver presente)

Para providers diferentes de codex/claude/native (por exemplo, `agents`, `claude-plugins`), a habilitação atualmente recai para: habilitado se **qualquer** alternância de origem integrada estiver habilitada.

### Tratamento de colisões e duplicatas

- A deduplicação de capacidade já mantém a primeira skill por nome (provider de maior precedência)
- `extensibility/skills.ts` adicionalmente:
  - deduplica arquivos idênticos por `realpath` (seguro para symlinks)
  - emite avisos de colisão quando um nome de skill posterior entra em conflito
  - mantém a API conveniente `discoverSkillsFromDir({ dir, source })` como um adaptador simplificado sobre `scanSkillsFromDir`
- Skills de diretórios personalizados são mescladas após as skills do provider e seguem o mesmo comportamento de colisão

## Comportamento de uso em tempo de execução

### Exposição no prompt do sistema

A construção do prompt do sistema (`src/system-prompt.ts`) utiliza as skills descobertas da seguinte forma:

- se a ferramenta `read` estiver disponível:
  - incluir a lista de skills descobertas no prompt
- caso contrário:
  - omitir a lista descoberta

Subagentes de ferramentas de tarefa recebem a lista de skills descobertas/fornecidas da sessão via criação normal de sessão; não há substituição de fixação de skill por tarefa.

### Comandos interativos `/skill:<name>`

Se `skills.enableSkillCommands` for verdadeiro, o modo interativo registra um comando slash por skill descoberta.

Comportamento de `/skill:<name> [args]`:

- lê o arquivo de skill diretamente de `filePath`
- remove o frontmatter
- injeta o corpo da skill como uma mensagem personalizada de acompanhamento
- acrescenta metadados (`Skill: <path>`, `User: <args>` opcional)

## Comportamento de URLs `skill://`

`src/internal-urls/skill-protocol.ts` suporta:

- `skill://<name>` → resolve para o `SKILL.md` dessa skill
- `skill://<name>/<relative-path>` → resolve dentro desse diretório de skill

```text
Resolução de URL skill://

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

Proteções:
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

## Skills vs AGENTS.md, comandos, ferramentas, hooks

### Skills vs AGENTS.md

- **Skills**: pacotes de capacidade nomeados e opcionais, selecionados pelo contexto da tarefa ou explicitamente solicitados
- **AGENTS.md/arquivos de contexto**: arquivos de instrução persistentes carregados como capacidade de arquivo de contexto e mesclados por regras de nível/profundidade

`src/discovery/agents-md.ts` percorre especificamente os diretórios ancestrais a partir de `cwd` para descobrir arquivos `AGENTS.md` independentes (até profundidade 20), excluindo segmentos de diretório oculto.

### Skills vs comandos slash

- **Skills**: conteúdo de conhecimento/fluxo de trabalho legível pelo modelo
- **Comandos slash**: pontos de entrada de comando invocados pelo usuário
- `/skill:<name>` é um invólucro de conveniência que injeta texto de skill; ele não altera a semântica de descoberta de skills

### Skills vs ferramentas personalizadas

- **Skills**: conteúdo de documentação/fluxo de trabalho carregado através do contexto do prompt e `read`
- **Ferramentas personalizadas**: APIs de ferramentas executáveis chamáveis pelo modelo com schemas e efeitos colaterais em tempo de execução

### Skills vs hooks

- **Skills**: conteúdo passivo
- **Hooks**: interceptadores de tempo de execução orientados a eventos que podem bloquear/modificar o comportamento durante a execução

## Orientações práticas de criação vinculadas à lógica de descoberta

- Coloque cada skill em seu próprio diretório: `<skills-root>/<skill-name>/SKILL.md`
- Sempre inclua frontmatter explícito com `name` e `description`
- Mantenha os recursos referenciados sob o mesmo diretório de skill e acesse-os com `skill://<name>/...`
- Para taxonomia aninhada (`team/domain/skill`), aponte `skills.customDirectories` para o diretório pai aninhado; a varredura em si permanece não-recursiva
- Evite nomes de skills duplicados entre fontes; a primeira correspondência vence por precedência do provider
