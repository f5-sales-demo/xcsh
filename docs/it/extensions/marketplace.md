---
title: Sistema Plugin Marketplace
description: >-
  Sistema plugin marketplace per scoprire, installare e gestire collezioni
  curate di plugin.
sidebar:
  order: 4
  label: Marketplace
i18n:
  sourceHash: 8ff4a59bbcd5
  translator: machine
---

# Sistema plugin marketplace

Il sistema marketplace consente di scoprire, installare e gestire plugin da cataloghi ospitati su Git. È compatibile con il formato del registro plugin di Claude Code.

## Avvio rapido

```
/marketplace add anthropics/f5xc-salesdemos-marketplace
/marketplace install wordpress.com@f5xc-salesdemos-marketplace
```

Oppure digitate semplicemente `/marketplace` senza argomenti per aprire il browser interattivo dei plugin.

## Concetti

Un **marketplace** è un repository Git (o una directory locale) contenente un file catalogo in `.xcsh-plugin/marketplace.json`. Il catalogo elenca i plugin disponibili con le relative sorgenti, descrizioni e metadati.

Un **plugin** è una directory contenente skill, comandi, hook, server MCP o server LSP. I plugin sono identificati da `nome@marketplace` (ad es. `code-review@f5xc-salesdemos-marketplace`).

**Ambiti**: i plugin possono essere installati in due ambiti:

- **user** (predefinito) -- disponibile in tutti i progetti, memorizzato in `~/.xcsh/plugins/installed_plugins.json`
- **project** -- disponibile solo nel progetto corrente, memorizzato in `.xcsh/installed_plugins.json`

Le installazioni con ambito project hanno priorità sulle installazioni con ambito user dello stesso plugin.

## Comandi

### Modalità interattiva

| Comando | Effetto |
|---|---|
| `/marketplace` | Apre il browser interattivo dei plugin (installazione) |

### Gestione marketplace

| Comando | Effetto |
|---|---|
| `/marketplace add <source>` | Aggiunge una sorgente marketplace |
| `/marketplace remove <name>` | Rimuove un marketplace |
| `/marketplace update [name]` | Aggiorna il/i catalogo/i; omettere il nome per aggiornarli tutti |
| `/marketplace list` | Elenca i marketplace configurati |

### Operazioni sui plugin

| Comando | Effetto |
|---|---|
| `/marketplace discover [marketplace]` | Esplora i plugin disponibili |
| `/marketplace install [--force] [--scope user\|project] name@marketplace` | Installa un plugin |
| `/marketplace uninstall [--scope user\|project] name@marketplace` | Disinstalla un plugin |
| `/marketplace installed` | Elenca i plugin marketplace installati |
| `/marketplace upgrade [--scope user\|project] [name@marketplace]` | Aggiorna uno o tutti i plugin |

### Equivalenti da riga di comando

Le stesse operazioni sono disponibili dalla riga di comando:

```
xcsh plugin marketplace add <source>
xcsh plugin marketplace remove <name>
xcsh plugin marketplace update [name]
xcsh plugin marketplace list
xcsh plugin discover [marketplace]
xcsh plugin install --scope project name@marketplace
```

## Sorgenti marketplace

Quando eseguite `/marketplace add <source>`, il sistema classifica la sorgente:

| Formato sorgente | Tipo | Esempio |
|---|---|---|
| `owner/repo` | Abbreviazione GitHub | `anthropics/f5xc-salesdemos-marketplace` |
| `https://...*.json` | URL diretto del catalogo | `https://example.com/marketplace.json` |
| `https://...*.git` o `git@...` | Repository Git | `https://github.com/org/repo.git` |
| `./path` o `~/path` o `/path` | Directory locale | `./my-marketplace` |

Il sistema clona il repository (o legge la directory locale), individua `.xcsh-plugin/marketplace.json`, lo valida e memorizza il catalogo localmente nella cache.

## Formato del catalogo (marketplace.json)

Un catalogo marketplace si trova in `.xcsh-plugin/marketplace.json` nella radice del repository:

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

### Campi obbligatori

| Campo | Descrizione |
|---|---|
| `name` | Nome del marketplace. Alfanumerico minuscolo, trattini e punti. Deve iniziare e terminare con un carattere alfanumerico. Massimo 64 caratteri. |
| `owner.name` | Nome del proprietario del marketplace |
| `plugins` | Array di voci plugin |

### Campi delle voci plugin

| Campo | Obbligatorio | Descrizione |
|---|---|---|
| `name` | sì | Nome del plugin (stesse regole del nome marketplace) |
| `source` | sì | Dove trovare il plugin (vedere sotto) |
| `description` | no | Breve descrizione |
| `version` | no | Stringa di versione |
| `author` | no | `{ name, email? }` |
| `homepage` | no | URL |
| `category` | no | Stringa di categoria (ad es. `development`, `productivity`, `security`) |
| `tags` | no | Array di tag stringa |
| `strict` | no | Booleano |
| `commands` | no | Comandi slash forniti |
| `agents` | no | Agenti forniti |
| `hooks` | no | Definizioni di hook |
| `mcpServers` | no | Definizioni di server MCP |
| `lspServers` | no | Definizioni di server LSP |

### Formati sorgente dei plugin

Il campo `source` supporta diversi formati:

**Percorso relativo** (all'interno del repository marketplace):

```json
"source": "./plugins/my-plugin"
```

**URL repository Git**:

```json
"source": {
  "source": "url",
  "url": "https://github.com/org/repo.git",
  "sha": "abc123..."
}
```

**Abbreviazione GitHub**:

```json
"source": {
  "source": "github",
  "repo": "org/repo",
  "ref": "main",
  "sha": "abc123..."
}
```

**Sottodirectory Git** (monorepo):

```json
"source": {
  "source": "git-subdir",
  "url": "https://github.com/org/monorepo.git",
  "path": "plugins/my-plugin",
  "ref": "main",
  "sha": "abc123..."
}
```

**Pacchetto npm**:

```json
"source": {
  "source": "npm",
  "package": "@scope/my-plugin",
  "version": "1.0.0"
}
```

## Struttura su disco

```
~/.xcsh/
  config/
    marketplaces.json          # Registro dei marketplace aggiunti
  plugins/
    installed_plugins.json     # Plugin installati con ambito user
    cache/
      marketplaces/            # Cataloghi marketplace memorizzati nella cache
      plugins/                 # Directory plugin memorizzate nella cache

<project>/.xcsh/
  installed_plugins.json       # Plugin installati con ambito project
```

## Regole di denominazione

I nomi di marketplace e plugin devono:

- Iniziare e terminare con una lettera minuscola o una cifra
- Contenere solo lettere minuscole, cifre, trattini e punti
- Avere al massimo 64 caratteri

Gli ID dei plugin (`nome@marketplace`) devono avere al massimo 128 caratteri in totale.

Esempi validi: `my-plugin`, `code-review`, `wordpress.com`, `ai-firstify`
Esempi non validi: `-bad`, `bad-`, `.bad`, `Bad`, `under_score`
