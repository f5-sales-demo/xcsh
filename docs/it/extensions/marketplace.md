---
title: Sistema di Plugin del Marketplace
description: >-
  Sistema di plugin del marketplace per la scoperta, l'installazione e la
  gestione di raccolte curate di plugin.
sidebar:
  order: 4
  label: Marketplace
i18n:
  sourceHash: 8ff4a59bbcd5
  translator: machine
---

# Sistema di plugin del marketplace

Il sistema marketplace consente di scoprire, installare e gestire plugin da cataloghi ospitati su Git. È compatibile con il formato del registro plugin di Claude Code.

## Avvio rapido

```
/marketplace add anthropics/f5xc-salesdemos-marketplace
/marketplace install wordpress.com@f5xc-salesdemos-marketplace
```

Oppure digitare semplicemente `/marketplace` senza argomenti per aprire il browser interattivo dei plugin.

## Concetti

Un **marketplace** è un repository Git (o una directory locale) che contiene un file di catalogo in `.xcsh-plugin/marketplace.json`. Il catalogo elenca i plugin disponibili con le relative sorgenti, descrizioni e metadati.

Un **plugin** è una directory contenente skill, comandi, hook, server MCP o server LSP. I plugin sono identificati da `nome@marketplace` (es. `code-review@f5xc-salesdemos-marketplace`).

**Ambiti**: i plugin possono essere installati a due livelli di ambito:

- **user** (predefinito) -- disponibile in tutti i progetti, memorizzato in `~/.xcsh/plugins/installed_plugins.json`
- **project** -- disponibile solo nel progetto corrente, memorizzato in `.xcsh/installed_plugins.json`

Le installazioni con ambito progetto hanno precedenza sulle installazioni con ambito utente dello stesso plugin.

## Comandi

### Modalità interattiva

| Comando | Effetto |
|---|---|
| `/marketplace` | Apre il browser interattivo dei plugin (installazione) |

### Gestione del marketplace

| Comando | Effetto |
|---|---|
| `/marketplace add <source>` | Aggiunge una sorgente marketplace |
| `/marketplace remove <name>` | Rimuove un marketplace |
| `/marketplace update [name]` | Ri-scarica i catalogo/i; omettere il nome per aggiornare tutti |
| `/marketplace list` | Elenca i marketplace configurati |

### Operazioni sui plugin

| Comando | Effetto |
|---|---|
| `/marketplace discover [marketplace]` | Sfoglia i plugin disponibili |
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

## Sorgenti del marketplace

Quando si esegue `/marketplace add <source>`, il sistema classifica la sorgente:

| Formato sorgente | Tipo | Esempio |
|---|---|---|
| `owner/repo` | Abbreviazione GitHub | `anthropics/f5xc-salesdemos-marketplace` |
| `https://...*.json` | URL diretto al catalogo | `https://example.com/marketplace.json` |
| `https://...*.git` o `git@...` | Repository Git | `https://github.com/org/repo.git` |
| `./path` o `~/path` o `/path` | Directory locale | `./my-marketplace` |

Il sistema clona il repository (o legge la directory locale), individua `.xcsh-plugin/marketplace.json`, lo valida e memorizza il catalogo nella cache locale.

## Formato del catalogo (marketplace.json)

Un catalogo marketplace risiede in `.xcsh-plugin/marketplace.json` nella radice del repository:

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
| `name` | Nome del marketplace. Alfanumerico minuscolo, trattini e punti. Deve iniziare e terminare con carattere alfanumerico. Massimo 64 caratteri. |
| `owner.name` | Nome del proprietario del marketplace |
| `plugins` | Array delle voci di plugin |

### Campi delle voci di plugin

| Campo | Obbligatorio | Descrizione |
|---|---|---|
| `name` | sì | Nome del plugin (stesse regole del nome marketplace) |
| `source` | sì | Dove trovare il plugin (vedi sotto) |
| `description` | no | Breve descrizione |
| `version` | no | Stringa di versione |
| `author` | no | `{ name, email? }` |
| `homepage` | no | URL |
| `category` | no | Stringa di categoria (es. `development`, `productivity`, `security`) |
| `tags` | no | Array di tag stringa |
| `strict` | no | Booleano |
| `commands` | no | Comandi slash forniti |
| `agents` | no | Agenti forniti |
| `hooks` | no | Definizioni degli hook |
| `mcpServers` | no | Definizioni dei server MCP |
| `lspServers` | no | Definizioni dei server LSP |

### Formati della sorgente dei plugin

Il campo `source` supporta diversi formati:

**Percorso relativo** (all'interno del repository marketplace):

```json
"source": "./plugins/my-plugin"
```

**URL di repository Git**:

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

## Layout su disco

```
~/.xcsh/
  config/
    marketplaces.json          # Registro dei marketplace aggiunti
  plugins/
    installed_plugins.json     # Plugin installati con ambito utente
    cache/
      marketplaces/            # Cataloghi marketplace nella cache
      plugins/                 # Directory dei plugin nella cache

<project>/.xcsh/
  installed_plugins.json       # Plugin installati con ambito progetto
```

## Regole di denominazione

I nomi di marketplace e plugin devono:

- Iniziare e terminare con una lettera minuscola o una cifra
- Contenere solo lettere minuscole, cifre, trattini e punti
- Avere al massimo 64 caratteri

Gli ID plugin (`nome@marketplace`) devono avere al massimo 128 caratteri in totale.

Esempi validi: `my-plugin`, `code-review`, `wordpress.com`, `ai-firstify`
Esempi non validi: `-bad`, `bad-`, `.bad`, `Bad`, `under_score`
