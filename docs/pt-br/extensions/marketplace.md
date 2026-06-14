---
title: Sistema de Marketplace de Plugins
description: >-
  Sistema de marketplace de plugins para descoberta, instalação e gerenciamento
  de coleções curadas de plugins.
sidebar:
  order: 4
  label: Marketplace
i18n:
  sourceHash: 8ff4a59bbcd5
  translator: machine
---

# Sistema de marketplace de plugins

O sistema de marketplace permite descobrir, instalar e gerenciar plugins a partir de catálogos hospedados em Git. É compatível com o formato de registro de plugins do Claude Code.

## Início rápido

```
/marketplace add anthropics/f5xc-salesdemos-marketplace
/marketplace install wordpress.com@f5xc-salesdemos-marketplace
```

Ou simplesmente digite `/marketplace` sem argumentos para abrir o navegador interativo de plugins.

## Conceitos

Um **marketplace** é um repositório Git (ou diretório local) que contém um arquivo de catálogo em `.xcsh-plugin/marketplace.json`. O catálogo lista os plugins disponíveis com suas fontes, descrições e metadados.

Um **plugin** é um diretório contendo skills, comandos, hooks, servidores MCP ou servidores LSP. Os plugins são identificados por `name@marketplace` (ex.: `code-review@f5xc-salesdemos-marketplace`).

**Escopos**: os plugins podem ser instalados em dois escopos:

- **user** (padrão) -- disponível em todos os projetos, armazenado em `~/.xcsh/plugins/installed_plugins.json`
- **project** -- disponível apenas no projeto atual, armazenado em `.xcsh/installed_plugins.json`

Instalações com escopo de projeto sobrepõem instalações com escopo de usuário do mesmo plugin.

## Comandos

### Modo interativo

| Comando | Efeito |
|---|---|
| `/marketplace` | Abre o navegador interativo de plugins (instalar) |

### Gerenciamento de marketplace

| Comando | Efeito |
|---|---|
| `/marketplace add <source>` | Adiciona uma fonte de marketplace |
| `/marketplace remove <name>` | Remove um marketplace |
| `/marketplace update [name]` | Rebusca o(s) catálogo(s); omita o nome para atualizar todos |
| `/marketplace list` | Lista os marketplaces configurados |

### Operações com plugins

| Comando | Efeito |
|---|---|
| `/marketplace discover [marketplace]` | Navega pelos plugins disponíveis |
| `/marketplace install [--force] [--scope user\|project] name@marketplace` | Instala um plugin |
| `/marketplace uninstall [--scope user\|project] name@marketplace` | Desinstala um plugin |
| `/marketplace installed` | Lista os plugins de marketplace instalados |
| `/marketplace upgrade [--scope user\|project] [name@marketplace]` | Atualiza um ou todos os plugins |

### Equivalentes via CLI

As mesmas operações estão disponíveis pela linha de comando:

```
xcsh plugin marketplace add <source>
xcsh plugin marketplace remove <name>
xcsh plugin marketplace update [name]
xcsh plugin marketplace list
xcsh plugin discover [marketplace]
xcsh plugin install --scope project name@marketplace
```

## Fontes de marketplace

Ao executar `/marketplace add <source>`, o sistema classifica a fonte:

| Formato da fonte | Tipo | Exemplo |
|---|---|---|
| `owner/repo` | Atalho do GitHub | `anthropics/f5xc-salesdemos-marketplace` |
| `https://...*.json` | URL direta do catálogo | `https://example.com/marketplace.json` |
| `https://...*.git` ou `git@...` | Repositório Git | `https://github.com/org/repo.git` |
| `./path` ou `~/path` ou `/path` | Diretório local | `./my-marketplace` |

O sistema clona o repositório (ou lê o diretório local), localiza `.xcsh-plugin/marketplace.json`, valida e armazena o catálogo em cache localmente.

## Formato do catálogo (marketplace.json)

Um catálogo de marketplace fica em `.xcsh-plugin/marketplace.json` na raiz do repositório:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "my-marketplace",
  "owner": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "description": "A collection of plugins",
  "plugins": [
    {
      "name": "my-plugin",
      "description": "What this plugin does",
      "source": "./plugins/my-plugin",
      "category": "development",
      "homepage": "https://github.com/you/my-plugin"
    }
  ]
}
```

### Campos obrigatórios

| Campo | Descrição |
|---|---|
| `name` | Nome do marketplace. Alfanumérico em minúsculas, hifens e pontos. Deve começar e terminar com alfanumérico. Máximo de 64 caracteres. |
| `owner.name` | Nome do proprietário do marketplace |
| `plugins` | Array de entradas de plugins |

### Campos da entrada de plugin

| Campo | Obrigatório | Descrição |
|---|---|---|
| `name` | sim | Nome do plugin (mesmas regras do nome do marketplace) |
| `source` | sim | Onde encontrar o plugin (veja abaixo) |
| `description` | não | Descrição curta |
| `version` | não | String de versão |
| `author` | não | `{ name, email? }` |
| `homepage` | não | URL |
| `category` | não | String de categoria (ex.: `development`, `productivity`, `security`) |
| `tags` | não | Array de tags em string |
| `strict` | não | Booleano |
| `commands` | não | Comandos slash fornecidos |
| `agents` | não | Agentes fornecidos |
| `hooks` | não | Definições de hooks |
| `mcpServers` | não | Definições de servidores MCP |
| `lspServers` | não | Definições de servidores LSP |

### Formatos de fonte de plugin

O campo `source` suporta diversos formatos:

**Caminho relativo** (dentro do repositório do marketplace):

```json
"source": "./plugins/my-plugin"
```

**URL de repositório Git**:

```json
"source": {
  "source": "url",
  "url": "https://github.com/org/repo.git",
  "sha": "abc123..."
}
```

**Atalho do GitHub**:

```json
"source": {
  "source": "github",
  "repo": "org/repo",
  "ref": "main",
  "sha": "abc123..."
}
```

**Subdiretório Git** (monorepo):

```json
"source": {
  "source": "git-subdir",
  "url": "https://github.com/org/monorepo.git",
  "path": "plugins/my-plugin",
  "ref": "main",
  "sha": "abc123..."
}
```

**Pacote npm**:

```json
"source": {
  "source": "npm",
  "package": "@scope/my-plugin",
  "version": "1.0.0"
}
```

## Layout em disco

```
~/.xcsh/
  config/
    marketplaces.json          # Registro de marketplaces adicionados
  plugins/
    installed_plugins.json     # Plugins instalados com escopo de usuário
    cache/
      marketplaces/            # Catálogos de marketplace em cache
      plugins/                 # Diretórios de plugins em cache

<project>/.xcsh/
  installed_plugins.json       # Plugins instalados com escopo de projeto
```

## Regras de nomenclatura

Os nomes de marketplace e de plugin devem:

- Começar e terminar com uma letra minúscula ou dígito
- Conter apenas letras minúsculas, dígitos, hifens e pontos
- Ter no máximo 64 caracteres

Os IDs de plugin (`name@marketplace`) devem ter no máximo 128 caracteres no total.

Exemplos válidos: `my-plugin`, `code-review`, `wordpress.com`, `ai-firstify`
Exemplos inválidos: `-bad`, `bad-`, `.bad`, `Bad`, `under_score`
