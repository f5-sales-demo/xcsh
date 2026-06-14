---
title: Mecanismos Internos do Gerenciador e Instalador de Plugins
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

# Mecanismos internos do gerenciador e instalador de plugins

Este documento descreve como as operações `xcsh plugin` modificam o estado dos plugins em disco e como os plugins instalados se tornam capacidades de tempo de execução (ferramentas atualmente, resolução de caminho para hooks/comandos disponível).

## Escopo e arquitetura

Existem duas implementações de gerenciamento de plugins na base de código:

1. **Caminho ativo usado pelos comandos CLI**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **Módulo auxiliar legado**: funções de instalação (`src/extensibility/plugins/installer.ts`)

A execução do comando `xcsh plugin ...` passa pelo `PluginManager`.

O `installer.ts` ainda documenta verificações de segurança importantes e comportamento do sistema de arquivos, mas não é o caminho utilizado por `src/commands/plugin.ts` + `src/cli/plugin-cli.ts`.

## Ciclo de vida: da invocação da CLI à disponibilidade em tempo de execução

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

### Pontos de entrada de comando

- `src/commands/plugin.ts` define o comando/flags e encaminha para `runPluginCommand`.
- `src/cli/plugin-cli.ts` mapeia subcomandos para métodos do `PluginManager`:
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- Não existe uma ação `update` explícita; a atualização é feita executando novamente `install` com uma especificação de pacote/versão nova.

## Modelo em disco

O estado global dos plugins reside em `~/.xcsh/plugins`:

- `package.json` — manifesto de dependências usado por `bun install`/`bun uninstall`
- `node_modules/` — pacotes de plugins instalados ou links simbólicos
- `xcsh-plugins.lock.json` — estado de tempo de execução:
  - habilitado/desabilitado por plugin
  - conjunto de funcionalidades selecionadas por plugin
  - configurações persistidas do plugin

Substituições locais do projeto residem em:

- `<cwd>/.xcsh/plugin-overrides.json`

As substituições são somente leitura da perspectiva do gerenciador/carregador (sem caminho de escrita aqui) e podem desabilitar plugins ou substituir funcionalidades/configurações para este projeto.

## Análise de especificações de plugins e interpretação de metadados

## Gramática da especificação de instalação

`parsePluginSpec` (`parser.ts`) suporta:

- `pkg` -> `features: null` (comportamento padrão)
- `pkg[*]` -> habilitar todas as funcionalidades do manifesto
- `pkg[]` -> não habilitar funcionalidades opcionais
- `pkg[a,b]` -> habilitar funcionalidades nomeadas
- `@scope/pkg@1.2.3[feat]` -> pacote com escopo + versão com seleção explícita de funcionalidade

`extractPackageName` remove o sufixo de versão para busca de caminho em disco após a instalação.

## Fonte do manifesto e campos obrigatórios

O manifesto é resolvido como:

1. `package.json.xcsh`
2. fallback `package.json.pi`
3. fallback `{ version: package.version }`

Implicações:

- Não há validação de esquema estrita no gerenciador/carregador.
- Um pacote sem manifesto `xcsh`/`pi` ainda pode ser instalado e listado.
- O carregamento de plugins em tempo de execução (`getEnabledPlugins`) ignora pacotes sem manifesto `xcsh`/`pi`.
- `manifest.version` é sempre sobrescrito a partir da `version` do pacote.

JSON malformado em `package.json` é uma falha crítica no momento da leitura; uma estrutura de manifesto malformada pode falhar posteriormente apenas quando campos específicos são consumidos.

## Fluxo de instalação/atualização (`PluginManager.install`)

1. Analisar a sintaxe de colchetes de funcionalidades da especificação de instalação.
2. Validar o nome do pacote contra regex + lista de negação de metacaracteres de shell.
3. Garantir que o `package.json` do plugin exista (`xcsh-plugins`, mapa de dependências privadas).
4. Executar `bun install <packageSpec>` em `~/.xcsh/plugins`.
5. Ler o `package.json` do pacote instalado em `node_modules/<name>/package.json`.
6. Resolver o manifesto e calcular `enabledFeatures`:
   - `[*]`: todas as funcionalidades declaradas (ou `null` se não houver mapa de funcionalidades)
   - `[a,b]`: valida que cada funcionalidade existe no mapa de funcionalidades do manifesto
   - `[]`: lista de funcionalidades vazia
   - especificação básica: `null` (usar política de padrões posteriormente no carregador)
7. Inserir ou atualizar o estado de tempo de execução no arquivo de lock: `{ version, enabledFeatures, enabled: true }`.

### Semântica de atualização

Como a atualização é orientada pela instalação:

- `xcsh plugin install pkg@newVersion` atualiza a dependência e a versão no arquivo de lock.
- As configurações existentes são preservadas; a entrada de estado é sobrescrita para versão/funcionalidades/habilitado.
- Não existe lógica separada de "verificar atualizações" ou migração transacional.

## Fluxo de remoção (`PluginManager.uninstall`)

1. Validar o nome do pacote.
2. Executar `bun uninstall <name>` no diretório de plugins.
3. Remover o estado de tempo de execução do plugin do arquivo de lock:
   - `config.plugins[name]`
   - `config.settings[name]`

Se o comando de desinstalação falhar, o estado de tempo de execução não é alterado.

## Fluxo de listagem (`PluginManager.list`)

1. Ler o mapa de dependências de plugins de `~/.xcsh/plugins/package.json`.
2. Carregar a configuração de tempo de execução do arquivo de lock (arquivo ausente -> padrões vazios).
3. Carregar substituições do projeto (`<cwd>/.xcsh/plugin-overrides.json`, erros de análise/leitura -> objeto vazio com aviso).
4. Para cada dependência com um `package.json` resolvível:
   - construir registro `InstalledPlugin`
   - mesclar estado de funcionalidade/habilitação:
     - base do arquivo de lock (ou padrões)
     - substituições do projeto podem substituir a seleção de funcionalidades
     - lista `disabled` do projeto mascara o plugin como desabilitado

Este é o estado efetivo usado pela saída de status da CLI e pelas operações de configurações/funcionalidades.

## Fluxo de link (`PluginManager.link`)

`link` suporta o desenvolvimento local de plugins criando um link simbólico de um pacote local em `~/.xcsh/plugins/node_modules/<pkg.name>`.

Comportamento:

1. Resolver `localPath` em relação ao cwd do gerenciador.
2. Exigir `package.json` local e campo `name`.
3. Garantir que os diretórios de plugins existam.
4. Para nomes com escopo, criar o diretório de escopo.
5. Remover o caminho existente no local do link de destino.
6. Criar link simbólico.
7. Adicionar entrada no arquivo de lock de tempo de execução habilitada com funcionalidades padrão (`null`).

Ressalva: o `PluginManager.link` atual não impõe a verificação de limite de caminho `cwd` presente no `installer.ts` legado (`normalizedPath.startsWith(normalizedCwd)`), portanto a confiança é responsabilidade do chamador.

## Carregamento em tempo de execução: do plugin instalado às capacidades invocáveis

## Porta de descoberta

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) lê:

- manifesto de dependências de plugins (`package.json`)
- estado de tempo de execução do arquivo de lock
- substituições do projeto via `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

Filtragem:

- ignorar se não houver `package.json` do plugin
- ignorar se o manifesto (`xcsh`/`pi`) estiver ausente
- ignorar se globalmente desabilitado no arquivo de lock
- ignorar se desabilitado pelo projeto

## Resolução de caminho de capacidades

Para cada plugin habilitado:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

Cada resolvedor inclui entradas base mais entradas de funcionalidades:

- lista explícita de funcionalidades -> apenas funcionalidades selecionadas
- `enabledFeatures === null` -> habilitar funcionalidades marcadas com `default: true`

Arquivos ausentes são ignorados silenciosamente (guarda `existsSync`).

## Diferenças atuais no roteamento em tempo de execução

- **As ferramentas estão roteadas no tempo de execução hoje** via `discoverAndLoadCustomTools` (`custom-tools/loader.ts`), que chama `getAllPluginToolPaths(cwd)`.
- Os caminhos são desduplicados por caminho absoluto resolvido na descoberta de ferramentas personalizadas (conjunto `seen`, o primeiro caminho vence).
- **Os resolvedores de hooks/comandos existem** e são exportados, mas este caminho de código não os conecta atualmente a um registro de tempo de execução da mesma forma que as ferramentas são conectadas.

## Detalhes de gerenciamento de lock/estado

`PluginManager` armazena em cache a configuração de tempo de execução em memória por instância (`#runtimeConfig`) e carrega preguiçosamente uma vez.

Comportamento de carregamento:

- arquivo de lock ausente -> `{ plugins: {}, settings: {} }`
- falha na leitura/análise do arquivo de lock -> aviso + mesmos padrões vazios

Comportamento de salvamento:

- escreve o JSON completo do arquivo de lock com formatação a cada mutação

Não existe bloqueio entre processos nem estratégia de mesclagem; escritores concorrentes podem sobrescrever uns aos outros.

## Verificações de segurança e limites de confiança

## Validação de entrada/pacote

O caminho ativo do gerenciador impõe validação de nome de pacote:

- regex para especificações de pacote com e sem escopo (opcionalmente com versão)
- lista de negação explícita de metacaracteres de shell (`[;&|`$(){}[]<>\\]`)

Isso limita o risco de injeção de comandos ao invocar `bun install/uninstall`.

## Limite de confiança do sistema de arquivos

- O código do plugin é executado em processo quando os módulos de ferramentas personalizadas são importados; sem sandboxing.
- Os caminhos relativos do manifesto são unidos ao diretório do pacote do plugin e apenas verificados quanto à existência.
- O próprio pacote do plugin é código confiável após a instalação.

## Verificações exclusivas do instalador legado

`installer.ts` inclui verificações adicionais em tempo de link não espelhadas em `PluginManager.link`:

- o caminho local deve ser resolvido dentro do cwd do projeto
- guardas adicionais de travessia de nome de pacote/caminho para nomeação do destino do link simbólico

Como a CLI usa `PluginManager`, essas guardas de link mais estritas não estão atualmente no caminho principal.

## Comportamento de falha, sucesso parcial e reversão

O gerenciador de plugins não é transacional.

| Estágio da operação | Comportamento em caso de falha | Reversão |
| --- | --- | --- |
| `bun install` falha | instalação é abortada com stderr | N/A (sem gravações de estado ainda) |
| Instalação bem-sucedida, então validação de manifesto/funcionalidade falha | comando falha | Sem reversão de desinstalação; a dependência pode permanecer em `node_modules`/`package.json` |
| Instalação bem-sucedida, então gravação do arquivo de lock falha | comando falha | Sem reversão do pacote instalado |
| `bun uninstall` bem-sucedido, gravação do arquivo de lock falha | comando falha | Pacote removido, estado de tempo de execução obsoleto pode permanecer |
| `link` remove o destino antigo e então a criação do link simbólico falha | comando falha | Sem restauração do link/diretório anterior |

Operacionalmente, `doctor --fix` pode corrigir alguma divergência (execução de `bun install`, limpeza de configuração órfã, limpeza de funcionalidades inválidas), mas é uma operação de melhor esforço.

## Resumo do comportamento com manifesto malformado/ausente

- Campo `xcsh`/`pi` ausente:
  - instalação/listagem: tolerado (manifesto mínimo)
  - descoberta de plugins habilitados em tempo de execução: ignorado como não-plugin
- Funcionalidade ausente referenciada pela especificação de instalação ou `features --set/--enable`: erro crítico com lista de funcionalidades disponíveis
- `plugin-overrides.json` inválido: ignorado com fallback para `{}` nos caminhos do gerenciador e do carregador
- Caminhos de arquivos de ferramentas/hooks/comandos referenciados pelo manifesto ausentes: ignorados silenciosamente durante a expansão do resolvedor; sinalizados como erros apenas pelo `doctor`

## Diferenças de modo e precedência

- `--dry-run` (install): retorna resultado de instalação sintético, sem gravações em sistema de arquivos/rede/estado.
- `--json`: apenas formatação de saída, sem alteração de comportamento.
- As substituições do projeto sempre têm precedência sobre o arquivo de lock global para visualização de funcionalidades/configurações.
- A habilitação efetiva é `runtimeEnabled && !projectDisabled`.

## Arquivos de implementação

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — declaração do comando CLI e mapeamento de flags
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — despacho de ações, manipuladores de comandos voltados ao usuário
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — implementação ativa de install/remove/list/link/state/doctor
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — auxiliares do instalador legado e verificações adicionais de segurança de link
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — descoberta de plugins habilitados e resolução de caminhos de ferramentas/hooks/comandos
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — auxiliares de análise de especificação de instalação e nome de pacote
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — contratos de tipos de manifesto/tempo de execução/substituição
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — roteamento em tempo de execução para módulos de ferramentas fornecidos por plugins
