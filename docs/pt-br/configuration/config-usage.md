---
title: Descoberta e Resolução de Configuração
description: >-
  Como o xcsh descobre, resolve e organiza a configuração a partir de raízes de
  projeto, usuário e empresa.
sidebar:
  order: 1
  label: Configuração
i18n:
  sourceHash: a8d23493ed0d
  translator: machine
---

# Descoberta e Resolução de Configuração

Este documento descreve como o coding-agent resolve a configuração atualmente: quais raízes são escaneadas, como a precedência funciona e como a configuração resolvida é consumida por settings, skills, hooks, tools e extensions.

## Escopo

Implementação principal:

- `src/config.ts`
- `src/config/settings.ts`
- `src/config/settings-schema.ts`
- `src/discovery/builtin.ts`
- `src/discovery/helpers.ts`

Pontos de integração principais:

- `src/capability/index.ts`
- `src/discovery/index.ts`
- `src/extensibility/skills.ts`
- `src/extensibility/hooks/loader.ts`
- `src/extensibility/custom-tools/loader.ts`
- `src/extensibility/extensions/loader.ts`

---

## Fluxo de resolução (visual)

```text
         Config roots (ordered)
┌───────────────────────────────────────┐
│ 1) ~/.xcsh/agent + <cwd>/.xcsh          │
│ 2) ~/.claude   + <cwd>/.claude        │
│ 3) ~/.codex    + <cwd>/.codex         │
│ 4) ~/.gemini   + <cwd>/.gemini        │
└───────────────────────────────────────┘
                    │
                    ▼
        config.ts helper resolution
  (getConfigDirs/findConfigFile/findNearest...)
                    │
                    ▼
       capability providers enumerate items
 (native, claude, codex, gemini, agents, etc.)
                    │
                    ▼
      priority sort + per-capability dedup
                    │
                    ▼
          subsystem-specific consumption
   (settings, skills, hooks, tools, extensions)
```

## 1) Raízes de configuração e ordem de fontes

## Raízes canônicas

`src/config.ts` define uma lista fixa de prioridade de fontes:

1. `.xcsh` (nativo)
2. `.claude`
3. `.codex`
4. `.gemini`

Bases em nível de usuário:

- `~/.xcsh/agent`
- `~/.claude`
- `~/.codex`
- `~/.gemini`

Bases em nível de projeto:

- `<cwd>/.xcsh`
- `<cwd>/.claude`
- `<cwd>/.codex`
- `<cwd>/.gemini`

`CONFIG_DIR_NAME` é `.xcsh` (`packages/utils/src/dirs.ts`).

## Restrição importante

Os helpers genéricos em `src/config.ts` **não** incluem `.pi` na ordem de descoberta de fontes.

---

## 2) Helpers principais de descoberta (`src/config.ts`)

## `getConfigDirs(subpath, options)`

Retorna entradas ordenadas:

- Entradas em nível de usuário primeiro (por prioridade de fonte)
- Depois entradas em nível de projeto (pela mesma prioridade de fonte)

Opções:

- `user` (padrão `true`)
- `project` (padrão `true`)
- `cwd` (padrão `getProjectDir()`)
- `existingOnly` (padrão `false`)

Esta API é usada para buscas de configuração baseadas em diretório (commands, hooks, tools, agents, etc.).

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

Busca o primeiro arquivo existente nas bases ordenadas, retorna a primeira correspondência (somente caminho ou caminho+metadados).

## `findAllNearestProjectConfigDirs(subpath, cwd)`

Percorre diretórios pais de baixo para cima e retorna o **diretório existente mais próximo por base de fonte** (`.xcsh`, `.claude`, `.codex`, `.gemini`), depois ordena os resultados por prioridade de fonte.

Use este método quando a configuração de projeto deve ser herdada de diretórios ancestrais (comportamento de monorepo/workspace aninhado).

---

## 3) Wrapper de arquivo de configuração (`ConfigFile<T>` em `src/config.ts`)

`ConfigFile<T>` é o carregador com validação de schema para arquivos de configuração individuais.

Formatos suportados:

- `.yml` / `.yaml`
- `.json` / `.jsonc`

Comportamento:

- Valida os dados parseados com AJV contra um schema TypeBox fornecido.
- Armazena em cache o resultado do carregamento até `invalidate()`.
- Retorna resultado tri-estado via `tryLoad()`:
  - `ok`
  - `not-found`
  - `error` (`ConfigError` com contexto de schema/parse)

Migração legada ainda suportada:

- Se o caminho alvo é `.yml`/`.yaml`, um `.json` adjacente é migrado automaticamente uma vez (`migrateJsonToYml`).

---

## 4) Modelo de resolução de settings (`src/config/settings.ts`)

O modelo de settings em tempo de execução é organizado em camadas:

1. Settings globais: `~/.xcsh/agent/config.yml`
2. Settings de projeto: descobertas via capability de settings (`settings.json` dos providers)
3. Overrides em tempo de execução: em memória, não persistentes
4. Padrões do schema: de `SETTINGS_SCHEMA`

Caminho de leitura efetivo:

`defaults <- global <- project <- overrides`

Comportamento de escrita:

- `settings.set(...)` escreve na camada **global** (`config.yml`) e enfileira salvamento em segundo plano.
- Settings de projeto são somente leitura a partir da descoberta de capabilities.

## Comportamento de migração ainda ativo

Na inicialização, se `config.yml` não existe:

1. Migra de `~/.xcsh/agent/settings.json` (renomeado para `.bak` em caso de sucesso)
2. Mescla com settings legadas do DB em `agent.db`
3. Escreve o resultado mesclado em `config.yml`

Migrações em nível de campo em `#migrateRawSettings`:

- `queueMode` -> `steeringMode`
- `ask.timeout` milissegundos -> segundos quando o valor antigo parece estar em ms (`> 1000`)
- Estrutura legada plana `theme: "..."` -> estrutura `theme.dark/theme.light`

---

## 5) Integração com capability/discovery

A maioria dos fluxos de carregamento de configuração não-core passa pelo registro de capabilities (`src/capability/index.ts` + `src/discovery/index.ts`).

## Ordenação de providers

Os providers são ordenados por prioridade numérica (maior primeiro). Exemplos de prioridades:

- Native OMP (`builtin.ts`): `100`
- Claude: `80`
- Codex / agents / Claude marketplace: `70`
- Gemini: `60`

```text
Provider precedence (higher wins)

native (.xcsh)          priority 100
claude                 priority  80
codex / agents / ...   priority  70
gemini                 priority  60
```

## Semântica de deduplicação

As capabilities definem uma `key(item)`:

- mesma chave => o primeiro item vence (item de maior prioridade/carregado primeiro)
- sem chave (`undefined`) => sem deduplicação, todos os itens são mantidos

Chaves relevantes:

- skills: `name`
- tools: `name`
- hooks: `${type}:${tool}:${name}`
- extension modules: `name`
- extensions: `name`
- settings: sem deduplicação (todos os itens preservados)

---

## 6) Comportamento do provider nativo `.xcsh` (`src/discovery/builtin.ts`)

O provider nativo (`id: native`) lê de:

- projeto: `<cwd>/.xcsh/...`
- usuário: `~/.xcsh/agent/...`

### Regra de admissão de diretório

`builtin.ts` só inclui uma raiz de configuração se o diretório existir **e não estiver vazio** (`ifNonEmptyDir`).

### Carregamento específico por escopo

- Skills: `skills/*/SKILL.md`
- Slash commands: `commands/*.md`
- Rules: `rules/*.{md,mdc}`
- Prompts: `prompts/*.md`
- Instructions: `instructions/*.md`
- Hooks: `hooks/pre/*`, `hooks/post/*`
- Tools: `tools/*.json|*.md` e `tools/<name>/index.ts`
- Extension modules: descobertos sob `extensions/` (+ array de strings legado `settings.json.extensions`)
- Extensions: `extensions/<name>/gemini-extension.json`
- Settings capability: `settings.json`

### Nuance de busca do projeto mais próximo

Para `SYSTEM.md` e `AGENTS.md`, o provider nativo usa busca de diretório `.xcsh` de projeto ancestral mais próximo (subindo a árvore), mas ainda exige que o diretório `.xcsh` não esteja vazio.

---

## 7) Como os principais subsistemas consomem a configuração

## Subsistema de settings

- `Settings.init()` carrega o `config.yml` global + itens descobertos da capability de settings do projeto.
- Apenas itens de capability com `level === "project"` são mesclados na camada de projeto.

## Subsistema de skills

- `extensibility/skills.ts` carrega via `loadCapability(skillCapability.id, { cwd })`.
- Aplica toggles de fonte e filtros (`ignoredSkills`, `includeSkills`, diretórios customizados).
- Toggles com nomes legados ainda existem (`skills.enablePiUser`, `skills.enablePiProject`), mas eles controlam o provider nativo (`provider === "native"`).

## Subsistema de hooks

- `discoverAndLoadHooks()` resolve caminhos de hooks a partir da capability de hooks + caminhos configurados explicitamente.
- Em seguida, carrega os módulos via importação do Bun.

## Subsistema de tools

- `discoverAndLoadCustomTools()` resolve caminhos de tools a partir da capability de tools + caminhos de tools de plugins + caminhos configurados explicitamente.
- Arquivos de tools declarativos `.md/.json` são apenas metadados; o carregamento executável espera módulos de código.

## Subsistema de extensions

- `discoverAndLoadExtensions()` resolve módulos de extensão a partir da capability de extension-module mais caminhos explícitos.
- A implementação atual intencionalmente mantém apenas itens de capability com `_source.provider === "native"` antes do carregamento.

---

## 8) Regras de precedência nas quais confiar

Use este modelo mental:

1. A ordenação de diretórios de fonte em `config.ts` determina a ordem dos caminhos candidatos.
2. A prioridade do provider de capability determina a precedência entre providers.
3. A deduplicação por chave de capability determina o comportamento em caso de colisão (o primeiro vence para capabilities com chave).
4. A lógica de mesclagem específica do subsistema pode alterar ainda mais a precedência efetiva (especialmente settings).

### Ressalva específica de settings

Os itens de capability de settings não são deduplicados; `Settings.#loadProjectSettings()` faz deep-merge dos itens de projeto na ordem retornada. Como o merge aplica valores de itens posteriores sobre valores de itens anteriores, o comportamento efetivo de override depende da ordem de emissão do provider, não apenas da semântica de chave de capability.

---

## 9) Comportamentos legados/de compatibilidade ainda presentes

- Migração JSON -> YAML do `ConfigFile` para arquivos com destino YAML.
- Migração de settings de `settings.json` e `agent.db` para `config.yml`.
- Migrações de chaves de settings (`queueMode`, `ask.timeout`, `theme` plano).
- Compatibilidade de manifesto de extensão: o loader aceita tanto seções de manifesto `package.json.xcsh` quanto `package.json.pi`.
- Nomes de settings legados `skills.enablePiUser` / `skills.enablePiProject` ainda são gates ativos para a fonte de skills nativa.

Se esses caminhos de compatibilidade forem removidos no código, atualize este documento imediatamente; vários comportamentos em tempo de execução ainda dependem deles atualmente.
