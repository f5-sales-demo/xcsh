---
title: F5 XC Contexts
description: >-
  Connetti xcsh ai tenant F5 Distributed Cloud -- crea, cambia e gestisci i
  contesti di autenticazione.
sidebar:
  order: 1
  label: F5 XC Contexts
i18n:
  sourceHash: bdaf0fb8837c
  translator: machine
---

# F5 XC Contexts

xcsh si connette a F5 Distributed Cloud attraverso i **contesti** -- set di credenziali con un nome che associano un URL del tenant, un token API e un namespace. Se hai già usato `kubectl config use-context` o `kubectx`, il flusso di lavoro è identico: crea un contesto, passa dall'uno all'altro per nome e usa `-` per tornare al precedente.

## Per iniziare

### 1. Crea il tuo primo contesto

Hai bisogno di tre informazioni dalla tua console F5 XC: l'URL del tenant, un token API e, opzionalmente, un namespace.

```
/context create production https://acme.console.ves.volterra.io p12k3-your-api-token
```

```
Context 'production' created. Use /context activate production to switch to it.
```

Oppure usa la procedura guidata interattiva se preferisci essere guidato passo dopo passo:

```
/context wizard
```

### 2. Attivalo

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

Una volta attivato, xcsh inietta le credenziali del tenant nella tua sessione. L'agente può ora effettuare chiamate API F5 XC e la barra di stato mostra il contesto attivo.

### 3. Aggiungi altri contesti e passa dall'uno all'altro

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

Passa da un contesto all'altro per nome -- non è necessario alcun sottocomando:

```
/context staging
```

Torna al contesto precedente (stile `cd -`):

```
/context -
```

Chiamare `/context -` due volte ti riporta al punto di partenza.

### 4. Visualizza i contesti disponibili

```
/context
```

```
  production           https://acme.console.ves.volterra.io
* staging              https://staging.console.ves.volterra.io
```

Il simbolo `*` indica il contesto attivo.

## Comandi di uso quotidiano

| Comando | Cosa fa |
|---|---|
| `/context` | Elenca tutti i contesti |
| `/context <name>` | Passa a un contesto |
| `/context -` | Passa al contesto precedente |
| `/context show` | Mostra i dettagli del contesto attivo (token mascherati) |
| `/context status` | Mostra lo stato corrente dell'autenticazione |

## Ciclo di vita del contesto

| Comando | Cosa fa |
|---|---|
| `/context create <name> <url> <token> [namespace]` | Crea un contesto |
| `/context delete <name> --confirm` | Elimina un contesto (richiede `--confirm`) |
| `/context rename <old> <new>` | Rinomina un contesto |
| `/context validate <name>` | Testa le credenziali senza cambiare contesto |
| `/context export [name] [--include-token]` | Esporta come JSON (token mascherati per impostazione predefinita) |
| `/context import <path-or-json> [--overwrite]` | Importa da file o JSON inline |
| `/context wizard` | Configurazione interattiva guidata |

## Cambio di namespace

Ogni contesto ha un namespace predefinito. Puoi cambiarlo senza modificare il contesto:

```
/context namespace system
```

Il completamento automatico con Tab propone i nomi dei namespace dal tenant attivo.

## Variabili d'ambiente nei contesti

I contesti possono contenere variabili d'ambiente aggiuntive che vengono iniettate nella sessione al momento dell'attivazione. Utile per configurazioni specifiche per tenant che non fanno parte del set di credenziali.

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

Alias: `add` = `set`, `remove`/`clear` = `unset`.

## Completamento con Tab

Digita `/context ` e premi Tab. Il menu a tendina mostra:

1. **Nomi dei contesti** -- con indicazioni sull'URL del tenant, per distinguere i diversi tenant
2. **`-`** -- appare quando hai già effettuato un cambio, mostrando a quale contesto torneresti
3. **Sottocomandi** -- `list`, `create`, `delete`, ecc.

I nomi dei contesti appaiono per primi perché il cambio di contesto è l'azione più comune.

Il completamento funziona anche a livello di sottocomandi: `/context activate <Tab>` completa i nomi dei contesti, `/context namespace <Tab>` completa i namespace, `/context unset <Tab>` completa le chiavi delle variabili d'ambiente conosciute.

## Regole di denominazione

I nomi dei contesti devono essere composti da 1-64 caratteri: lettere, cifre, trattini, underscore.

I nomi che entrano in conflitto con i sottocomandi vengono rifiutati:

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

L'insieme completo dei nomi riservati: `list`, `show`, `status`, `create`, `delete`, `rename`, `namespace`, `env`, `set`, `unset`, `add`, `remove`, `clear`, `activate`, `validate`, `export`, `import`, `wizard`, `help`. Il confronto è case-insensitive.

## Override tramite variabili d'ambiente

Se `F5XC_API_URL` e `F5XC_API_TOKEN` sono impostate nel tuo ambiente shell prima di avviare xcsh, queste hanno la precedenza su qualsiasi contesto. Questo è utile per pipeline CI/CD o sessioni occasionali in cui non si vuole creare un contesto persistente.

Quando si opera in questa modalità, `/context` mostra le credenziali provenienti dall'ambiente con l'etichetta `(via env vars)`.

## Comportamento del contesto precedente

- **Ambito della sessione**: il contesto precedente viene reimpostato quando riavvii xcsh. Non viene salvato su disco.
- **Ping-pong**: `/context -` eseguito due volte ti riporta al punto di partenza.
- **Sicuro durante le modifiche**: se elimini il contesto precedente, il puntatore viene azzerato. Se lo rinomini, il puntatore segue il nuovo nome.
- **La ri-attivazione è un no-op**: `/context production` quando sei già su `production` non reimposta il puntatore al contesto precedente.

## Convenzioni di design

La UX di `/context` segue:

- **kubectx**: `kubectx <name>` per il cambio, `kubectx -` per il precedente, `kubectx` senza argomenti per l'elenco
- **kubectl**: `kubectl config use-context` per la forma esplicita
- **Shell**: `cd -` / `OLDPWD` per il tracciamento della directory precedente
