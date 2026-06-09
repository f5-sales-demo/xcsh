---
title: Contextos F5 XC
description: >-
  Conecte o xcsh a tenants do F5 Distributed Cloud -- crie, alterne e gerencie
  contextos de autenticação.
sidebar:
  order: 1
  label: Contextos F5 XC
i18n:
  sourceHash: bdaf0fb8837c
  translator: machine
---

# Contextos F5 XC

O xcsh se conecta ao F5 Distributed Cloud por meio de **contextos** -- conjuntos de credenciais nomeados que vinculam uma URL de tenant, um token de API e um namespace. Se você já usou `kubectl config use-context` ou `kubectx`, o fluxo de trabalho é idêntico: crie um contexto, alterne entre eles pelo nome e use `-` para voltar ao anterior.

## Primeiros passos

### 1. Crie seu primeiro contexto

Você precisa de três coisas do seu console F5 XC: a URL do tenant, um token de API e, opcionalmente, um namespace.

```
/context create production https://acme.console.ves.volterra.io p12k3-your-api-token
```

```
Context 'production' created. Use /context activate production to switch to it.
```

Ou use o assistente guiado se preferir prompts passo a passo:

```
/context wizard
```

### 2. Ative-o

```
/context production
```

```
╭─ production ─────────────────────────────────────────────────╮
│ F5XC_TENANT     acme                                         │
│ F5XC_API_URL    https://acme.console.ves.volterra.io         │
│ F5XC_API_TOKEN  ...oken                                      │
│ Status          Connected (312ms)                            │
├─ Environment ────────────────────────────────────────────────┤
│ F5XC_NAMESPACE  default                                      │
╰──────────────────────────────────────────────────────────────╯
```

Uma vez ativado, o xcsh injeta as credenciais do tenant na sua sessão. O agente agora pode realizar chamadas à API do F5 XC, e a linha de status exibe o contexto ativo.

### 3. Adicione mais contextos e alterne entre eles

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

Alterne pelo nome -- nenhum verbo de subcomando é necessário:

```
/context staging
```

Volte ao contexto anterior (estilo `cd -`):

```
/context -
```

Chamar `/context -` duas vezes retorna você ao ponto de partida.

### 4. Veja o que você tem

```
/context
```

```
  production           https://acme.console.ves.volterra.io
* staging              https://staging.console.ves.volterra.io
```

O `*` marca o contexto ativo.

## Comandos do dia a dia

| Comando | O que faz |
|---|---|
| `/context` | Lista todos os contextos |
| `/context <name>` | Alterna para um contexto |
| `/context -` | Alterna para o contexto anterior |
| `/context show` | Mostra detalhes do contexto ativo (tokens mascarados) |
| `/context status` | Mostra o status atual de autenticação |

## Ciclo de vida do contexto

| Comando | O que faz |
|---|---|
| `/context create <name> <url> <token> [namespace]` | Cria um contexto |
| `/context delete <name> --confirm` | Exclui um contexto (requer `--confirm`) |
| `/context rename <old> <new>` | Renomeia um contexto |
| `/context validate <name>` | Testa credenciais sem alternar |
| `/context export [name] [--include-token]` | Exporta como JSON (tokens mascarados por padrão) |
| `/context import <path-or-json> [--overwrite]` | Importa de arquivo ou JSON inline |
| `/context wizard` | Configuração interativa guiada |

## Alternando namespaces

Cada contexto possui um namespace padrão. Alterne-o sem mudar de contexto:

```
/context namespace system
```

O autocompletar com Tab oferece nomes de namespace do tenant ativo.

## Variáveis de ambiente em contextos

Contextos podem carregar variáveis de ambiente extras que são injetadas na sua sessão ao serem ativados. Útil para configurações por tenant que não fazem parte do conjunto de credenciais.

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

Aliases: `add` = `set`, `remove`/`clear` = `unset`.

## Autocompletar com Tab

Digite `/context ` e pressione Tab. O menu suspenso mostra:

1. **Nomes de contexto** -- com dicas da URL do tenant, para que você possa distinguir os tenants
2. **`-`** -- aparece quando você já alternou antes, mostrando para qual contexto você voltaria
3. **Subcomandos** -- `list`, `create`, `delete`, etc.

Os nomes de contexto aparecem primeiro porque alternar é a ação mais comum.

Autocompletar em nível de subcomando também funciona: `/context activate <Tab>` completa nomes de contexto, `/context namespace <Tab>` completa namespaces, `/context unset <Tab>` completa chaves de variáveis de ambiente conhecidas.

## Regras de nomenclatura

Nomes de contexto devem ter de 1 a 64 caracteres: letras, dígitos, hífens, underscores.

Nomes que colidem com subcomandos são rejeitados:

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

O conjunto completo de nomes reservados: `list`, `show`, `status`, `create`, `delete`, `rename`, `namespace`, `env`, `set`, `unset`, `add`, `remove`, `clear`, `activate`, `validate`, `export`, `import`, `wizard`, `help`. A comparação é case-insensitive.

## Substituição por variáveis de ambiente

Se `F5XC_API_URL` e `F5XC_API_TOKEN` estiverem definidos no ambiente do seu shell antes de iniciar o xcsh, eles têm precedência sobre qualquer contexto. Isso é útil para pipelines de CI/CD ou sessões pontuais onde você não deseja criar um contexto persistente.

Ao operar nesse modo, `/context` exibe as credenciais originadas do ambiente com o rótulo `(via env vars)`.

## Comportamento do contexto anterior

- **Escopo de sessão**: o contexto anterior é reiniciado quando você reinicia o xcsh. Ele não é persistido em disco.
- **Ping-pong**: `/context -` duas vezes retorna você ao ponto de partida.
- **Seguro em mutações**: se você excluir o contexto anterior, o ponteiro é limpo. Se você renomeá-lo, o ponteiro acompanha o novo nome.
- **Reativação é um no-op**: `/context production` quando já está em `production` não redefine o ponteiro do contexto anterior.

## Convenções de design

A UX do `/context` segue:

- **kubectx**: `kubectx <name>` para alternar, `kubectx -` para o anterior, `kubectx` sem argumentos para listar
- **kubectl**: `kubectl config use-context` para a forma explícita
- **Shell**: `cd -` / `OLDPWD` para rastreamento do diretório anterior
