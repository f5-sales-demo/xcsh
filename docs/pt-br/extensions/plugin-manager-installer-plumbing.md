---
title: Gerenciador de Plugins e Mecanismo de Instalação
description: >-
  Internos do gerenciador de plugins cobrindo instalação, validação, resolução
  de dependências e gerenciamento de ciclo de vida.
sidebar:
  order: 5
  label: Gerenciador de plugins
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# Gerenciador de plugins e mecanismo de instalação

Este documento descreve como as operações de `xcsh plugin` modificam o estado dos plugins em disco e como os plugins instalados se tornam capacidades em tempo de execução (ferramentas atualmente, resolução de caminho para hooks/comandos disponível).

## Escopo e arquitetura

Há duas implementações de gerenciamento de plugins na base de código:

1. **Caminho ativo utilizado pelos comandos CLI**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **Módulo auxiliar legado**: funções do instalador (`src/extensibility/plugins/installer.ts`)

A execução do comando `xcsh plugin ...` passa pelo `PluginManager`.

O `installer.ts` ainda documenta verificações de segurança importantes e comportamento do sistema de arquivos, mas não é o caminho utilizado por `src/commands/plugin.ts` + `src/cli/plugin-cli.ts`.

## Ciclo de vida: da invocação do CLI à disponibilidade em tempo de execução

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

### Pontos de entrada de comandos

- `src/commands/plugin.ts` define o comando/flags e encaminha para `runPluginCommand`.
- `src/cli/plugin-cli.ts` mapeia subcomandos para métodos do `PluginManager`:
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- Não existe uma ação explícita de `update`; a atualização é feita executando novamente `install` com uma nova especificação de pacote/versão.

## Modelo em disco

O estado global dos plugins reside em `~/.xcsh/plugins`:

- `package.json` — manifesto de dependências utilizado pelo `bun install`/`bun uninstall`
- `node_modules/` — pacotes de plugins instalados ou symlinks
- `xcsh-plugins.lock.json` — estado em tempo de execução:
  - habilitado/desabilitado por plugin
  - conjunto de funcionalidades selecionadas por plugin
  - configurações persistidas do plugin

Substituições específicas do projeto residem em:

- `<cwd>/.xcsh/plugin-overrides.json`

As substituições são somente leitura da perspectiva do gerenciador/carregador (sem caminho de escrita aqui) e podem desabilitar plugins ou substituir funcionalidades/configurações para este projeto.

## Análise de especificação de plugin e interpretação de metadados

## Gramática da especificação de instalação

`parsePluginSpec` (`parser.ts`) suporta:

- `pkg` -> `features: null` (comportamento padrão)
- `pkg[*]` -> habilitar todas as funcionalidades do manifesto
- `pkg[]` -> não habilitar funcionalidades opcionais
- `pkg[a,b]` -> habilitar funcionalidades nomeadas
- `@scope/pkg@1.2.3[feat]` -> pacote com escopo + versão com seleção explícita de funcionalidade

`extractPackageName` remove o sufixo de versão para pesquisa de caminho em disco após a instalação.

## Fonte do manifesto e campos obrigatórios

O manifesto é resolvido como:

1. `package.json.xcsh`
2. fallback `package.json.pi`
3. fallback `{ version: package.version }`

Implicações:

- Não há validação estrita de esquema no gerenciador/carregador.
- Um pacote sem manifesto `xcsh`/`pi` ainda pode ser instalado e listado.
- O carregamento de plugins em tempo de execução (`getEnabledPlugins`) ignora pacotes sem manifesto `xcsh`/`pi`.
- `manifest.version` é sempre sobrescrito a partir da `version` do pacote.

JSON inválido em `package.json` é uma falha grave no momento da leitura; formato de manifesto malformado pode falhar posteriormente apenas quando campos específicos forem consumidos.

## Fluxo de instalação/atualização (`PluginManager.install`)

1. Analisar a sintaxe de colchetes de funcionalidades da especificação de instalação.
2. Validar o nome do pacote contra regex + lista de negação de metacaracteres do shell.
3. Garantir que o `package.json` do plugin exista (mapa de dependências privadas `xcsh-plugins`).
4. Executar `bun install <packageSpec>` em `~/.xcsh/plugins`.
5. Ler o `package.json` do pacote instalado em `node_modules/<name>/package.json`.
6. Resolver o manifesto e calcular `enabledFeatures`:
   - `[*]`: todas as funcionalidades declaradas (ou `null` se não houver mapa de funcionalidades)
   - `[a,b]`: valida que cada funcionalidade existe no mapa de funcionalidades do manifesto
   - `[]`: lista de funcionalidades vazia
   - especificação sem colchetes: `null` (usar política de padrões posteriormente no carregador)
7. Realizar upsert do estado em tempo de execução no lockfile: `{ version, enabledFeatures, enabled: true }`.

### Semântica de atualização

Como a atualização é conduzida pela instalação:

- `xcsh plugin install pkg@newVersion` atualiza a dependência e a versão no lockfile.
- As configurações existentes são preservadas; a entrada de estado é sobrescrita para versão/funcionalidades/habilitado.
- Não existe lógica separada de "verificar atualizações" ou migração transacional.

## Fluxo de remoção (`PluginManager.uninstall`)

1. Validar o nome do pacote.
2. Executar `bun uninstall <name>` no diretório de plugins.
3. Remover o estado em tempo de execução do plugin do lockfile:
   - `config.plugins[name]`
   - `config.settings[name]`

Se o comando de desinstalação falhar, o estado em tempo de execução não será alterado.

## Fluxo de listagem (`PluginManager.list`)

1. Ler o mapa de dependências do plugin em `~/.xcsh/plugins/package.json`.
2. Carregar a configuração em tempo de execução do lockfile (arquivo ausente -> padrões vazios).
3. Carregar as substituições do projeto (`<cwd>/.xcsh/plugin-overrides.json`, erros de análise/leitura -> objeto vazio com aviso).
4. Para cada dependência com um `package.json` resolvível:
   - construir registro `InstalledPlugin`
   - mesclar estado de funcionalidade/habilitação:
     - base do lockfile (ou padrões)
     - substituições do projeto podem substituir a seleção de funcionalidades
     - lista `disabled` do projeto mascara o plugin como desabilitado

Este é o estado efetivo utilizado pela saída de status do CLI e pelas operações de configurações/funcionalidades.

## Fluxo de vinculação (`PluginManager.link`)

`link` suporta o desenvolvimento local de plugins criando um symlink de um pacote local em `~/.xcsh/plugins/node_modules/<pkg.name>`.

Comportamento:

1. Resolver `localPath` em relação ao cwd do gerenciador.
2. Exigir `package.json` local e campo `name`.
3. Garantir que os diretórios de plugins existam.
4. Para nomes com escopo, criar o diretório de escopo.
5. Remover o caminho existente no local de destino do link.
6. Criar symlink.
7. Adicionar entrada no lockfile em tempo de execução habilitada com funcionalidades padrão (`null`).

Ressalva: o `PluginManager.link` atual não aplica a verificação de limite de caminho `cwd` presente no `installer.ts` legado (`normalizedPath.startsWith(normalizedCwd)`), portanto a confiança é responsabilidade do chamador.

## Carregamento em tempo de execução: do plugin instalado às capacidades chamáveis

## Portão de descoberta

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) lê:

- manifesto de dependências do plugin (`package.json`)
- estado em tempo de execução do lockfile
- substituições do projeto via `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

Filtragem:

- ignorar se não houver `package.json` do plugin
- ignorar se o manifesto (`xcsh`/`pi`) estiver ausente
- ignorar se estiver globalmente desabilitado no lockfile
- ignorar se estiver desabilitado no projeto

## Resolução de caminho de capacidades

Para cada plugin habilitado:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

Cada resolvedor inclui entradas base mais entradas de funcionalidades:

- lista de funcionalidades explícita -> apenas funcionalidades selecionadas
- `enabledFeatures === null` -> habilitar funcionalidades marcadas com `default: true`

Arquivos ausentes são silenciosamente ignorados (guarda com `existsSync`).

## Diferenças atuais no cabeamento em tempo de execução

- **As ferramentas estão conectadas ao tempo de execução hoje** via `discoverAndLoadCustomTools` (`custom-tools/loader.ts`), que chama `getAllPluginToolPaths(cwd)`.
- Os caminhos são desduplicados por caminho absoluto resolvido na descoberta de ferramentas personalizadas (conjunto `seen`, o primeiro caminho vence).
- **Os resolvedores de hooks/comandos existem** e são exportados, mas este caminho de código atualmente não os conecta a um registro em tempo de execução da mesma forma que as ferramentas são conectadas.

## Detalhes de gerenciamento de lock/estado

O `PluginManager` armazena em cache a configuração em tempo de execução na memória por instância (`#runtimeConfig`) e carrega de forma lazy uma única vez.

Comportamento de carregamento:

- lockfile ausente -> `{ plugins: {}, settings: {} }`
- falha na leitura/análise do lockfile -> aviso + mesmos padrões vazios

Comportamento de salvamento:

- escreve o JSON completo do lockfile formatado em cada mutação

Não existe bloqueio entre processos nem estratégia de mesclagem; escritores concorrentes podem sobrescrever uns aos outros.

## Verificações de segurança e limites de confiança

## Validação de entrada/pacote

O caminho ativo do gerenciador aplica validação de nome de pacote:

- regex para especificações de pacote com escopo/sem escopo (opcionalmente com versão)
- lista de negação explícita de metacaracteres do shell (`[;&|`$(){}[]<>\\]`)

Isso limita o risco de injeção de comandos ao invocar `bun install/uninstall`.

## Limite de confiança do sistema de arquivos

- O código do plugin é executado dentro do processo quando os módulos de ferramentas personalizadas são importados; sem isolamento em sandbox.
- Os caminhos relativos do manifesto são combinados com o diretório do pacote do plugin e apenas verificados quanto à existência.
- O próprio pacote do plugin é código confiável uma vez instalado.

## Verificações exclusivas do instalador legado

O `installer.ts` inclui verificações adicionais em tempo de vinculação não espelhadas no `PluginManager.link`:

- o caminho local deve ser resolvido dentro do cwd do projeto
- proteções adicionais de travessia de nome/caminho de pacote para nomenclatura do alvo do symlink

Como o CLI usa `PluginManager`, essas proteções de link mais rigorosas não estão atualmente no caminho principal.

## Comportamento de falha, sucesso parcial e rollback

O gerenciador de plugins não é transacional.

| Estágio da operação | Comportamento de falha | Rollback |
| --- | --- | --- |
| `bun install` falha | instalação é abortada com stderr | N/A (nenhuma escrita de estado ainda) |
| Instalação bem-sucedida, então falha na validação de manifesto/funcionalidade | comando falha | Sem rollback de desinstalação; dependência pode permanecer em `node_modules`/`package.json` |
| Instalação bem-sucedida, então falha na escrita do lockfile | comando falha | Sem rollback do pacote instalado |
| `bun uninstall` bem-sucedido, falha na escrita do lockfile | comando falha | Pacote removido, estado em tempo de execução obsoleto pode permanecer |
| `link` remove o alvo antigo e então a criação do symlink falha | comando falha | Sem restauração do link/diretório anterior |

Operacionalmente, `doctor --fix` pode reparar alguma divergência (`bun install`, limpeza de configuração órfã, limpeza de funcionalidades inválidas), mas é uma operação de melhor esforço.

## Resumo do comportamento com manifesto malformado/ausente

- Campo `xcsh`/`pi` ausente:
  - instalação/listagem: tolerado (manifesto mínimo)
  - descoberta de plugins habilitados em tempo de execução: ignorado como não-plugin
- Funcionalidade ausente referenciada pela especificação de instalação ou `features --set/--enable`: erro grave com lista de funcionalidades disponíveis
- `plugin-overrides.json` inválido: ignorado com fallback para `{}` nos caminhos do gerenciador e do carregador
- Caminhos de arquivos de ferramentas/hooks/comandos ausentes referenciados pelo manifesto: silenciosamente ignorados durante a expansão do resolvedor; sinalizados como erros apenas pelo `doctor`

## Diferenças de modo e precedência

- `--dry-run` (instalação): retorna resultado sintético de instalação, sem escritas no sistema de arquivos/rede/estado.
- `--json`: apenas formatação de saída, sem alteração de comportamento.
- As substituições do projeto sempre têm precedência sobre o lockfile global para visualização de funcionalidades/configurações.
- A habilitação efetiva é `runtimeEnabled && !projectDisabled`.

## Arquivos de implementação

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — declaração de comando CLI e mapeamento de flags
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — despacho de ações, manipuladores de comandos voltados ao usuário
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — implementação ativa de instalação/remoção/listagem/vinculação/estado/doctor
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — auxiliares de instalador legado e verificações adicionais de segurança de link
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — descoberta de plugins habilitados e resolução de caminhos de ferramentas/hooks/comandos
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — auxiliares de análise de especificação de instalação e nome de pacote
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — contratos de tipos de manifesto/tempo de execução/substituição
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — cabeamento em tempo de execução para módulos de ferramentas fornecidos por plugins
