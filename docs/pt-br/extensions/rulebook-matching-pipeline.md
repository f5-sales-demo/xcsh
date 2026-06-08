---
title: Pipeline de Correspondência de Rulebook
description: >-
  Pipeline de correspondência de rulebook para seleção e aplicação de conjuntos
  de instruções específicos de contexto em sessões de agente.
sidebar:
  order: 6
  label: Correspondência de rulebook
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# Pipeline de Correspondência de Rulebook

Este documento descreve como o coding-agent descobre regras a partir de formatos de configuração suportados, normaliza-as em uma única forma `Rule`, resolve conflitos de precedência e divide o resultado em:

- **Regras de Rulebook** (disponíveis para o modelo via system prompt + URLs `rule://`)
- **Regras TTSR** (regras de interrupção de stream por viagem no tempo)

Ele reflete a implementação atual, incluindo semânticas parciais e metadados que são analisados mas não aplicados.

## Arquivos de implementação

- [`../src/capability/rule.ts`](../../packages/coding-agent/src/capability/rule.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/discovery/index.ts`](../../packages/coding-agent/src/discovery/index.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/cursor.ts`](../../packages/coding-agent/src/discovery/cursor.ts)
- [`../src/discovery/windsurf.ts`](../../packages/coding-agent/src/discovery/windsurf.ts)
- [`../src/discovery/cline.ts`](../../packages/coding-agent/src/discovery/cline.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/system-prompt.ts`](../../packages/coding-agent/src/system-prompt.ts)
- [`../src/internal-urls/rule-protocol.ts`](../../packages/coding-agent/src/internal-urls/rule-protocol.ts)
- [`../src/utils/frontmatter.ts`](../../packages/coding-agent/src/utils/frontmatter.ts)

## 1. Forma canônica da regra

Todos os provedores normalizam os arquivos fonte em `Rule`:

```ts
interface Rule {
  name: string;
  path: string;
  content: string;
  globs?: string[];
  alwaysApply?: boolean;
  description?: string;
  ttsrTrigger?: string;
  _source: SourceMeta;
}
```

A identidade da capacidade é `rule.name` (`ruleCapability.key = rule => rule.name`).

Consequência: precedência e deduplicação são **baseadas apenas no nome**. Dois arquivos diferentes com o mesmo `name` são considerados a mesma regra lógica.

## 2. Fontes de descoberta e normalização

`src/discovery/index.ts` registra automaticamente os provedores. Para `rules`, os provedores atuais são:

- `native` (prioridade `100`)
- `cursor` (prioridade `50`)
- `windsurf` (prioridade `50`)
- `cline` (prioridade `40`)

### Provedor nativo (`builtin.ts`)

Carrega regras `.xcsh` de:

- projeto: `<cwd>/.xcsh/rules/*.{md,mdc}`
- usuário: `~/.xcsh/agent/rules/*.{md,mdc}`

Normalização:

- `name` = nome do arquivo sem `.md`/`.mdc`
- frontmatter analisado via `parseFrontmatter`
- `content` = corpo (frontmatter removido)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` mapeados diretamente

Ressalva importante: `globs` é convertido como `string[] | undefined` sem filtragem de elementos neste provedor.

### Provedor Cursor (`cursor.ts`)

Carrega de:

- usuário: `~/.cursor/rules/*.{mdc,md}`
- projeto: `<cwd>/.cursor/rules/*.{mdc,md}`

Normalização (`transformMDCRule`):

- `description`: mantido apenas se for string
- `alwaysApply`: apenas `true` é preservado (`false` torna-se `undefined`)
- `globs`: aceita array (apenas elementos string) ou string única
- `ttsr_trigger`: apenas string
- `name` a partir do nome do arquivo sem extensão

### Provedor Windsurf (`windsurf.ts`)

Carrega de:

- usuário: `~/.codeium/windsurf/memories/global_rules.md` (nome de regra fixo `global_rules`)
- projeto: `<cwd>/.windsurf/rules/*.md`

Normalização:

- `globs`: array de strings ou string única
- `alwaysApply`, `description` convertidos a partir do frontmatter
- `ttsr_trigger`: apenas string
- `name` a partir do nome do arquivo para regras de projeto

### Provedor Cline (`cline.ts`)

Busca para cima a partir do `cwd` pelo `.clinerules` mais próximo:

- se diretório: carrega `*.md` dentro dele
- se arquivo: carrega arquivo único como regra nomeada `clinerules`

Normalização:

- `globs`: array de strings ou string única
- `alwaysApply`: apenas se booleano
- `description`: apenas string
- `ttsr_trigger`: apenas string

## 3. Comportamento de análise de frontmatter e ambiguidade

Todos os provedores usam `parseFrontmatter` (`utils/frontmatter.ts`) com estas semânticas:

1. O frontmatter é analisado apenas quando o conteúdo começa com `---` e possui um fechamento `\n---`.
2. O corpo é aparado após a extração do frontmatter.
3. Se a análise YAML falhar:
   - um aviso é registrado,
   - o analisador recorre à análise simples de linhas `key: value` (`^(\w+):\s*(.*)$`).

Consequências da ambiguidade:

- O analisador de fallback não suporta arrays, objetos aninhados, regras de aspas ou chaves com hífen.
- Valores de fallback tornam-se strings (por exemplo, `alwaysApply: true` torna-se a string `"true"`), então provedores que requerem tipos booleano/string podem descartar metadados.
- `ttsr_trigger` funciona no fallback (chave com sublinhado); chaves como `thinking-level` não funcionariam.
- Arquivos sem frontmatter válido ainda são carregados como regras com metadados vazios e corpo completo do conteúdo.

## 4. Precedência de provedores e deduplicação

`loadCapability("rules")` (`capability/index.ts`) mescla as saídas dos provedores e então deduplica por `rule.name`.

### Modelo de precedência

- Os provedores são ordenados por prioridade decrescente.
- Prioridade igual mantém a ordem de registro (`cursor` antes de `windsurf` em `discovery/index.ts`).
- A deduplicação é primeiro-vence: o primeiro nome de regra encontrado é mantido; itens posteriores com o mesmo nome são marcados como `_shadowed` em `all` e excluídos de `items`.

A ordem efetiva dos provedores de regras atualmente é:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### Ressalva sobre ordenação intra-provedor

Dentro de um provedor, a ordem dos itens vem da ordenação de resultados do glob em `loadFilesFromDir` mais a ordem explícita de push. Isso é determinístico o suficiente para uso normal, mas não é explicitamente ordenado no código.

Diferenças notáveis na ordem das fontes:

- `native` adiciona primeiro diretórios de configuração do projeto, depois do usuário.
- `cursor` adiciona primeiro resultados do usuário, depois do projeto.
- `windsurf` adiciona primeiro o `global_rules` do usuário, depois as regras do projeto.
- `cline` carrega apenas a fonte `.clinerules` mais próxima.

## 5. Divisão em buckets de Rulebook, Always-Apply e TTSR

Após a descoberta de regras em `createAgentSession` (`sdk.ts`):

1. Todas as regras descobertas são verificadas.
2. Regras com `condition` (chave de frontmatter; `ttsr_trigger` / `ttsrTrigger` aceitos como fallback) são registradas no `TtsrManager`.
3. Uma lista separada `rulebookRules` é construída com este predicado:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. Uma lista `alwaysApplyRules` é construída:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### Comportamento dos buckets

- **Bucket TTSR**: qualquer regra com `condition` (descrição não é necessária). Tem prioridade sobre os outros buckets.
- **Bucket always-apply**: `alwaysApply === true`, não TTSR. Conteúdo completo injetado no system prompt. Resolvível via `rule://`.
- **Bucket rulebook**: deve ter descrição, não deve ser TTSR, não deve ser `alwaysApply`. Listado no system prompt por nome+descrição; conteúdo lido sob demanda via `rule://`.
- Uma regra com tanto `condition` quanto `alwaysApply` vai apenas para TTSR (TTSR tem prioridade).
- Uma regra com tanto `alwaysApply` quanto `description` vai apenas para always-apply (não para rulebook).

## 6. Como os metadados afetam as superfícies de runtime

### `description`

- Necessário para inclusão no rulebook.
- Renderizado no bloco `<rules>` do system prompt.
- Descrição ausente significa que a regra não está disponível via `rule://` e não é listada nas regras do system prompt.

### `globs`

- Transportado na `Rule`.
- Renderizado como entradas `<glob>...</glob>` no bloco de regras do system prompt.
- Exposto no estado de UI de regras (lista de modo `extensions`).
- **Não é aplicado para correspondência automática neste pipeline.** Não há um matcher de glob em runtime selecionando regras pelo arquivo atual/alvo da ferramenta.

### `alwaysApply`

- Analisado e preservado pelos provedores.
- Usado na exibição de UI (rótulo de trigger `"always"` no gerenciador de estado de extensões).
- Usado como condição de exclusão de `rulebookRules`.
- **O conteúdo completo da regra é auto-injetado no system prompt** (antes da seção de regras do rulebook).
- A regra também é endereçável via `rule://<name>` para releitura.

### `ttsr_trigger`

- Mapeado para `rule.ttsrTrigger`.
- Se presente, a regra é encaminhada para o gerenciador TTSR, não para o rulebook.

## 7. Caminho de inclusão no system prompt

`buildSystemPromptInternal` recebe tanto `rules` (rulebook) quanto `alwaysApplyRules`.

Regras always-apply são renderizadas primeiro, injetando seu conteúdo bruto diretamente no prompt.

Regras de rulebook são renderizadas em uma seção `# Rules` com:

- `Read rule://<name> when working in matching domain`
- `name`, `description` de cada regra e lista opcional de `<glob>`

Isso é consultivo/contextual: o texto do prompt pede ao modelo para ler regras aplicáveis, mas o código não aplica a correspondência de glob.

## 8. Comportamento da URL interna `rule://`

`RuleProtocolHandler` é registrado com:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

Implicações:

- `rule://<name>` resolve contra tanto **rulebookRules** quanto **alwaysApplyRules**.
- Regras exclusivas de TTSR e regras sem descrição e sem `alwaysApply` não são endereçáveis via `rule://`.
- A resolução é por correspondência exata de nome.
- Nomes desconhecidos retornam erro listando os nomes de regras disponíveis.
- O conteúdo retornado é `rule.content` bruto (frontmatter removido), tipo de conteúdo `text/markdown`.

## 9. Semânticas parciais / não aplicadas conhecidas

1. Descrições de provedores mencionam arquivos legados (`.cursorrules`, `.windsurfrules`), mas os caminhos de código do carregador atual não leem de fato esses arquivos.
2. Metadados de `globs` são expostos no prompt/UI mas não são aplicados pela lógica de seleção de regras.
3. A seleção de regras para `rule://` inclui regras de rulebook e always-apply, mas não regras exclusivas de TTSR.
4. Avisos de descoberta (`loadCapability("rules").warnings`) são produzidos, mas `createAgentSession` atualmente não os exibe/registra neste caminho.
