---
title: Sistema de Marketplace de Plugins
description: >-
  Sistema de marketplace de plugins para descubrir, instalar y gestionar
  colecciones curadas de plugins.
sidebar:
  order: 4
  label: Marketplace
i18n:
  sourceHash: 8ff4a59bbcd5
  translator: machine
---

# Sistema de marketplace de plugins

El sistema de marketplace le permite descubrir, instalar y gestionar plugins desde catálogos alojados en Git. Es compatible con el formato de registro de plugins de Claude Code.

## Inicio rápido

```
/marketplace add anthropics/f5xc-salesdemos-marketplace
/marketplace install wordpress.com@f5xc-salesdemos-marketplace
```

O simplemente escriba `/marketplace` sin argumentos para abrir el navegador interactivo de plugins.

## Conceptos

Un **marketplace** es un repositorio Git (o directorio local) que contiene un archivo de catálogo en `.xcsh-plugin/marketplace.json`. El catálogo lista los plugins disponibles con sus fuentes, descripciones y metadatos.

Un **plugin** es un directorio que contiene skills, comandos, hooks, servidores MCP o servidores LSP. Los plugins se identifican por `name@marketplace` (p. ej., `code-review@f5xc-salesdemos-marketplace`).

**Ámbitos**: los plugins pueden instalarse en dos ámbitos:

- **user** (predeterminado) -- disponible en todos los proyectos, almacenado en `~/.xcsh/plugins/installed_plugins.json`
- **project** -- disponible solo en el proyecto actual, almacenado en `.xcsh/installed_plugins.json`

Las instalaciones con ámbito de proyecto tienen prioridad sobre las instalaciones con ámbito de usuario del mismo plugin.

## Comandos

### Modo interactivo

| Comando | Efecto |
|---|---|
| `/marketplace` | Abrir el navegador interactivo de plugins (instalar) |

### Gestión de marketplaces

| Comando | Efecto |
|---|---|
| `/marketplace add <source>` | Añadir una fuente de marketplace |
| `/marketplace remove <name>` | Eliminar un marketplace |
| `/marketplace update [name]` | Volver a obtener catálogo(s); omita el nombre para actualizar todos |
| `/marketplace list` | Listar los marketplaces configurados |

### Operaciones con plugins

| Comando | Efecto |
|---|---|
| `/marketplace discover [marketplace]` | Explorar plugins disponibles |
| `/marketplace install [--force] [--scope user\|project] name@marketplace` | Instalar un plugin |
| `/marketplace uninstall [--scope user\|project] name@marketplace` | Desinstalar un plugin |
| `/marketplace installed` | Listar plugins de marketplace instalados |
| `/marketplace upgrade [--scope user\|project] [name@marketplace]` | Actualizar uno o todos los plugins |

### Equivalentes en CLI

Las mismas operaciones están disponibles desde la línea de comandos:

```
xcsh plugin marketplace add <source>
xcsh plugin marketplace remove <name>
xcsh plugin marketplace update [name]
xcsh plugin marketplace list
xcsh plugin discover [marketplace]
xcsh plugin install --scope project name@marketplace
```

## Fuentes de marketplace

Cuando ejecuta `/marketplace add <source>`, el sistema clasifica la fuente:

| Formato de fuente | Tipo | Ejemplo |
|---|---|---|
| `owner/repo` | Abreviatura de GitHub | `anthropics/f5xc-salesdemos-marketplace` |
| `https://...*.json` | URL directa de catálogo | `https://example.com/marketplace.json` |
| `https://...*.git` o `git@...` | Repositorio Git | `https://github.com/org/repo.git` |
| `./path` o `~/path` o `/path` | Directorio local | `./my-marketplace` |

El sistema clona el repositorio (o lee el directorio local), localiza `.xcsh-plugin/marketplace.json`, lo valida y almacena en caché el catálogo localmente.

## Formato del catálogo (marketplace.json)

Un catálogo de marketplace se encuentra en `.xcsh-plugin/marketplace.json` en la raíz del repositorio:

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

### Campos obligatorios

| Campo | Descripción |
|---|---|
| `name` | Nombre del marketplace. Alfanumérico en minúsculas, guiones y puntos. Debe comenzar y terminar con un carácter alfanumérico. Máximo 64 caracteres. |
| `owner.name` | Nombre del propietario del marketplace |
| `plugins` | Array de entradas de plugins |

### Campos de entrada de plugin

| Campo | Obligatorio | Descripción |
|---|---|---|
| `name` | sí | Nombre del plugin (mismas reglas que el nombre del marketplace) |
| `source` | sí | Dónde encontrar el plugin (ver más abajo) |
| `description` | no | Descripción breve |
| `version` | no | Cadena de versión |
| `author` | no | `{ name, email? }` |
| `homepage` | no | URL |
| `category` | no | Cadena de categoría (p. ej., `development`, `productivity`, `security`) |
| `tags` | no | Array de etiquetas de texto |
| `strict` | no | Booleano |
| `commands` | no | Comandos de barra proporcionados |
| `agents` | no | Agentes proporcionados |
| `hooks` | no | Definiciones de hooks |
| `mcpServers` | no | Definiciones de servidores MCP |
| `lspServers` | no | Definiciones de servidores LSP |

### Formatos de fuente de plugin

El campo `source` admite varios formatos:

**Ruta relativa** (dentro del repositorio del marketplace):

```json
"source": "./plugins/my-plugin"
```

**URL de repositorio Git**:

```json
"source": {
  "source": "url",
  "url": "https://github.com/org/repo.git",
  "sha": "abc123..."
}
```

**Abreviatura de GitHub**:

```json
"source": {
  "source": "github",
  "repo": "org/repo",
  "ref": "main",
  "sha": "abc123..."
}
```

**Subdirectorio Git** (monorepo):

```json
"source": {
  "source": "git-subdir",
  "url": "https://github.com/org/monorepo.git",
  "path": "plugins/my-plugin",
  "ref": "main",
  "sha": "abc123..."
}
```

**Paquete npm**:

```json
"source": {
  "source": "npm",
  "package": "@scope/my-plugin",
  "version": "1.0.0"
}
```

## Estructura en disco

```
~/.xcsh/
  config/
    marketplaces.json          # Registro de marketplaces añadidos
  plugins/
    installed_plugins.json     # Plugins instalados con ámbito de usuario
    cache/
      marketplaces/            # Catálogos de marketplace en caché
      plugins/                 # Directorios de plugins en caché

<project>/.xcsh/
  installed_plugins.json       # Plugins instalados con ámbito de proyecto
```

## Reglas de nomenclatura

Los nombres de marketplace y plugin deben:

- Comenzar y terminar con una letra minúscula o un dígito
- Contener solo letras minúsculas, dígitos, guiones y puntos
- Tener como máximo 64 caracteres

Los IDs de plugin (`name@marketplace`) deben tener como máximo 128 caracteres en total.

Ejemplos válidos: `my-plugin`, `code-review`, `wordpress.com`, `ai-firstify`
Ejemplos inválidos: `-bad`, `bad-`, `.bad`, `Bad`, `under_score`
