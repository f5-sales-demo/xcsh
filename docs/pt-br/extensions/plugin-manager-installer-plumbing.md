---
title: Plugin Manager and Installer Plumbing
description: >-
  Detalhes internos do gerenciador de plugins cobrindo instalação, validação,
  resolução de dependências e gerenciamento de ciclo de vida.
sidebar:
  order: 5
  label: Gerenciador de plugins
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# Gerenciador de plugins e mecanismos do instalador

Este documento descreve como as operações de `xcsh plugin` modificam o estado dos plugins em disco e como os plugins instalados se tornam capacidades em tempo de execução (ferramentas atualmente, resolução de caminhos para hooks/comandos disponível).

## Escopo e arquitetura

Existem duas implementações de gerenciamento de plugins no código-fonte:

1. **Caminho ativo usado pelos comandos CLI**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **Módulo auxiliar legado**: funções do instalador (`src/extensibility/plugins/installer.ts`)

A execução do comando `xcsh plugin ...` passa pelo `PluginManager`.

`installer.ts` ainda documenta verificações de segurança e comportamentos de sistema de arquivos importantes, mas não é o caminho usado por `src/commands/plugin.ts` + `src/cli/plugin-cli.ts`.

## Ciclo de vida: da invocação CLI à disponibilidade em tempo de execução

```text
xcsh plugin <action> ...
  -> src/commands/plugin.ts
  -> runPluginCommand(...) in src/cli/plugin-cli.ts
  -> PluginManager method (install/list/uninstall/link/...) 
  -> mutate ~/.xcsh/plugins/{package.json,node_modules,xcsh-plugins.lock.json}
  -> runtime discovery: discoverAndLoadCustomTools(...)
  -> getAllPluginToolPaths(cwd)
  -> custom tool loader imports tool modules
```

### Pontos de entrada dos comandos

- `src/commands/plugin.ts` define comandos/flags e encaminha para `runPluginCommand`.
- `src/cli/plugin-cli.ts` mapeia subcomandos para métodos do `PluginManager`:
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- Não existe uma ação explícita de `update`; a atualização é feita re-executando `install` com uma nova especificação de pacote/versão.

## Modelo em disco

O estado global dos plugins fica em `~/.xcsh/plugins`:

- `package.json` — manifesto de dependências usado por `bun install`/`bun uninstall`
- `node_modules/` — pacotes de plugins instalados ou symlinks
- `xcsh-plugins.lock.json` — estado em tempo de execução:
  - habilitado/desabilitado por plugin
  - conjunto de features selecionadas por plugin
  - configurações persistidas do plugin

Substituições locais do projeto ficam em:

- `<cwd>/.xcsh/plugin-overrides.json`

As substituições são somente leitura da perspectiva do gerenciador/carregador (sem caminho de escrita aqui) e podem desabilitar plugins ou substituir features/configurações para este projeto.

## Análise de especificação e interpretação de metadados do plugin

## Gramática da especificação de instalação

`parsePluginSpec` (`parser.ts`) suporta:

- `pkg` -> `features: null` (comportamento padrão)
- `pkg[*]` -> habilitar todas as features do manifesto
- `pkg[]` -> não habilitar features opcionais
- `pkg[a,b]` -> habilitar features nomeadas
- `@scope/pkg@1.2.3[feat]` -> pacote com escopo + versão com seleção explícita de features

`extractPackageName` remove o sufixo de versão para busca de caminho em disco após a instalação.

## Origem do manifesto e campos obrigatórios

O manifesto é resolvido como:

1. `package.json.xcsh`
2. fallback `package.json.pi`
3. fallback `{ version: package.version }`

Implicações:

- Não há validação estrita de schema no gerenciador/carregador.
- Um pacote sem `xcsh`/`pi` ainda é instalável e listável.
- O carregamento de plugins em tempo de execução (`getEnabledPlugins`) ignora pacotes sem manifesto `xcsh`/`pi`.
- `manifest.version` é sempre sobrescrito a partir da `version` do pacote.

JSON malformado em `package.json` é uma falha crítica no momento da leitura; formato malformado do manifesto pode falhar posteriormente apenas quando campos específicos são consumidos.

## Fluxo de instalação/atualização (`PluginManager.install`)

1. Analisar a sintaxe de colchetes de features da especificação de instalação.
2. Validar o nome do pacote contra regex + lista de negação de metacaracteres shell.
3. Garantir que o `package.json` do plugin existe (`xcsh-plugins`, mapa de dependências privadas).
4. Executar `bun install <packageSpec>` em `~/.xcsh/plugins`.
5. Ler o `node_modules/<name>/package.json` do pacote instalado.
6. Resolver o manifesto e computar `enabledFeatures`:
   - `[*]`: todas as features declaradas (ou `null` se não houver mapa de features)
   - `[a,b]`: valida que cada feature existe no mapa de features do manifesto
   - `[]`: lista vazia de features
   - especificação simples: `null` (usar política de padrões posteriormente no carregador)
7. Inserir/atualizar estado em tempo de execução no lockfile: `{ version, enabledFeatures, enabled: true }`.

### Semântica de atualização

Como a atualização é orientada por instalação:

- `xcsh plugin install pkg@newVersion` atualiza a dependência e a versão no lockfile.
- Configurações existentes são preservadas; a entrada de estado é sobrescrita para versão/features/habilitado.
- Não existe lógica separada de "verificar atualizações" ou migração transacional.

## Fluxo de remoção (`PluginManager.uninstall`)

1. Validar o nome do pacote.
2. Executar `bun uninstall <name>` no diretório de plugins.
3. Remover o estado em tempo de execução do plugin do lockfile:
   - `config.plugins[name]`
   - `config.settings[name]`

Se o comando de desinstalação falhar, o estado em tempo de execução não é alterado.

## Fluxo de listagem (`PluginManager.list`)

1. Ler o mapa de dependências de plugins de `~/.xcsh/plugins/package.json`.
2. Carregar configuração em tempo de execução do lockfile (arquivo ausente -> padrões vazios).
3. Carregar substituições do projeto (`<cwd>/.xcsh/plugin-overrides.json`, erros de análise/leitura -> objeto vazio com aviso).
4. Para cada dependência com um package.json resolvível:
   - construir registro `InstalledPlugin`
   - mesclar estado de feature/habilitação:
     - base do lockfile (ou padrões)
     - substituições do projeto podem substituir a seleção de features
     - lista de `disabled` do projeto mascara o plugin como desabilitado

Este é o estado efetivo usado pela saída de status do CLI e operações de configurações/features.

## Fluxo de link (`PluginManager.link`)

`link` suporta desenvolvimento local de plugins criando um symlink de um pacote local em `~/.xcsh/plugins/node_modules/<pkg.name>`.

Comportamento:

1. Resolver `localPath` em relação ao cwd do gerenciador.
2. Exigir `package.json` local e campo `name`.
3. Garantir que os diretórios de plugins existam.
4. Para nomes com escopo, criar o diretório de escopo.
5. Remover caminho existente no local de destino do link.
6. Criar symlink.
7. Adicionar entrada no lockfile em tempo de execução habilitada com features padrão (`null`).

Ressalva: o `PluginManager.link` atual não aplica a verificação de limite de caminho `cwd` presente no legado `installer.ts` (`normalizedPath.startsWith(normalizedCwd)`), então a confiança é responsabilidade do chamador.

## Carregamento em tempo de execução: do plugin instalado a capacidades invocáveis

## Portão de descoberta

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) lê:

- manifesto de dependências de plugins (`package.json`)
- estado em tempo de execução do lockfile
- substituições do projeto via `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

Filtragem:

- ignora se não há package.json do plugin
- ignora se manifesto (`xcsh`/`pi`) ausente
- ignora se globalmente desabilitado no lockfile
- ignora se desabilitado pelo projeto

## Resolução de caminhos de capacidades

Para cada plugin habilitado:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

Cada resolvedor inclui entradas base mais entradas de features:

- lista explícita de features -> apenas features selecionadas
- `enabledFeatures === null` -> habilitar features marcadas com `default: true`

Arquivos ausentes são silenciosamente ignorados (guarda `existsSync`).

## Diferenças atuais na integração em tempo de execução

- **Ferramentas são integradas ao runtime atualmente** via `discoverAndLoadCustomTools` (`custom-tools/loader.ts`), que chama `getAllPluginToolPaths(cwd)`.
- Caminhos são deduplicados por caminho absoluto resolvido na descoberta de ferramentas personalizadas (conjunto `seen`, primeiro caminho vence).
- **Resolvedores de hooks/comandos existem** e são exportados, mas este caminho de código atualmente não os integra a um registro em tempo de execução da mesma forma que as ferramentas são integradas.

## Detalhes de gerenciamento de lock/estado

`PluginManager` armazena em cache a configuração em tempo de execução na memória por instância (`#runtimeConfig`) e carrega preguiçosamente uma vez.

Comportamento de carregamento:

- lockfile ausente -> `{ plugins: {}, settings: {} }`
- falha de leitura/análise do lockfile -> aviso + mesmos padrões vazios

Comportamento de salvamento:

- escreve o JSON completo do lockfile formatado a cada mutação

Não existe bloqueio entre processos ou estratégia de mesclagem; escritores concorrentes podem sobrescrever uns aos outros.

## Verificações de segurança e limites de confiança

## Validação de entrada/pacote

O caminho ativo do gerenciador aplica validação de nome de pacote:

- regex para especificações de pacotes com e sem escopo (opcionalmente com versão)
- lista de negação explícita de metacaracteres shell (`[;&|`$(){}[]<>\\]`)

Isso limita o risco de injeção de comandos ao invocar `bun install/uninstall`.

## Limite de confiança do sistema de arquivos

- O código do plugin é executado no mesmo processo quando módulos de ferramentas personalizadas são importados; sem sandboxing.
- Caminhos relativos do manifesto são unidos ao diretório do pacote do plugin e apenas verificados quanto à existência.
- O pacote do plugin em si é código confiável uma vez instalado.

## Verificações exclusivas do instalador legado

`installer.ts` inclui verificações adicionais em tempo de link não espelhadas em `PluginManager.link`:

- o caminho local deve resolver dentro do cwd do projeto
- guardas extras de nome de pacote/travessia de caminho para nomeação de destino de symlink

Como o CLI usa `PluginManager`, essas guardas de link mais rigorosas não estão atualmente no caminho principal.

## Comportamento de falha, sucesso parcial e rollback

O gerenciador de plugins não é transacional.

| Estágio da operação | Comportamento de falha | Rollback |
| --- | --- | --- |
| `bun install` falha | instalação aborta com stderr | N/A (nenhuma escrita de estado ainda) |
| Instalação bem-sucedida, depois validação de manifesto/feature falha | comando falha | Sem rollback de desinstalação; dependência pode permanecer em `node_modules`/`package.json` |
| Instalação bem-sucedida, depois escrita do lockfile falha | comando falha | Sem rollback do pacote instalado |
| `bun uninstall` bem-sucedido, escrita do lockfile falha | comando falha | Pacote removido, estado em tempo de execução obsoleto pode permanecer |
| `link` remove alvo antigo, depois criação do symlink falha | comando falha | Sem restauração do link/diretório anterior |

Operacionalmente, `doctor --fix` pode reparar alguma divergência (`bun install`, limpeza de configuração órfã, limpeza de features inválidas), mas é baseado em melhor esforço.

## Resumo de comportamento com manifesto malformado/ausente

- Campo `xcsh`/`pi` ausente:
  - install/list: tolerado (manifesto mínimo)
  - descoberta de plugins habilitados em tempo de execução: ignorado como não-plugin
- Feature ausente referenciada por especificação de instalação ou `features --set/--enable`: erro crítico com lista de features disponíveis
- `plugin-overrides.json` inválido: ignorado com fallback para `{}` tanto nos caminhos do gerenciador quanto do carregador
- Caminhos de arquivos de ferramenta/hook/comando ausentes referenciados pelo manifesto: silenciosamente ignorados durante a expansão do resolvedor; sinalizados como erros apenas pelo `doctor`

## Diferenças de modo e precedência

- `--dry-run` (install): retorna resultado de instalação sintético, sem escritas no sistema de arquivos/rede/estado.
- `--json`: apenas formatação de saída, sem mudança de comportamento.
- Substituições do projeto sempre têm precedência sobre o lockfile global para visualização de features/configurações.
- Habilitação efetiva é `runtimeEnabled && !projectDisabled`.

## Arquivos de implementação

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — declaração de comandos CLI e mapeamento de flags
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — despacho de ações, manipuladores de comandos voltados ao usuário
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — implementação ativa de install/remove/list/link/state/doctor
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — auxiliares do instalador legado e verificações adicionais de segurança de link
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — descoberta de plugins habilitados e resolução de caminhos de ferramentas/hooks/comandos
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — auxiliares de análise de especificação de instalação e nome de pacote
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — contratos de tipo de manifesto/runtime/substituição
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — integração em tempo de execução para módulos de ferramentas fornecidos por plugins
