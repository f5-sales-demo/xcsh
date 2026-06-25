---
title: Contesti F5 XC
description: >-
  Connettere xcsh ai tenant F5 Distributed Cloud -- creare, cambiare e gestire i
  contesti di autenticazione.
sidebar:
  order: 1
  label: Contesti F5 XC
i18n:
  sourceHash: a9cccbc338f0
  translator: machine
---

# Contesti F5 XC

xcsh si connette a F5 Distributed Cloud tramite i **contesti** -- set di credenziali con nome che associano un URL del tenant, un token API e un namespace. Se avete utilizzato `kubectl config use-context` o `kubectx`, il flusso di lavoro è identico: creare un contesto, passare dall'uno all'altro per nome e usare `-` per tornare al precedente.

## Per iniziare

### 1. Creare il primo contesto

Servono tre informazioni dalla console F5 XC: l'URL del tenant, un token API e opzionalmente un namespace.

```
/context create production https://acme.console.ves.volterra.io p12k3-your-api-token
```

```
Context 'production' created. Use /context activate production to switch to it.
```

Oppure utilizzare la procedura guidata se si preferiscono i prompt passo-passo:

```
/context wizard
```

### 2. Attivarlo

```
/context production
```

```
╭─ production ─────────────────────────────────────────────────╮
│ XCSH_TENANT     acme                                         │
│ XCSH_API_URL    https://acme.console.ves.volterra.io         │
│ XCSH_API_TOKEN  ...oken                                      │
│ Status          Connected (312ms)                            │
├─ Environment ────────────────────────────────────────────────┤
│ XCSH_NAMESPACE  default                                      │
╰──────────────────────────────────────────────────────────────╯
```

Una volta attivato, xcsh inietta le credenziali del tenant nella sessione. L'agente può ora effettuare chiamate API F5 XC e la barra di stato mostra il contesto attivo.

### 3. Aggiungere altri contesti e passare dall'uno all'altro

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

Passare per nome -- non è necessario alcun verbo di sottocomando:

```
/context staging
```

Tornare al contesto precedente (stile `cd -`):

```
/context -
```

Eseguire `/context -` due volte riporta al punto di partenza.

### 4. Visualizzare i contesti disponibili

```
/context
```

```
  production           https://acme.console.ves.volterra.io
* staging              https://staging.console.ves.volterra.io
```

Il simbolo `*` indica il contesto attivo.

## Comandi di uso quotidiano

| Comando | Funzione |
|---|---|
| `/context` | Elencare tutti i contesti |
| `/context <name>` | Passare a un contesto |
| `/context -` | Passare al contesto precedente |
| `/context show` | Mostrare i dettagli del contesto attivo (token mascherati) |
| `/context status` | Mostrare lo stato corrente dell'autenticazione |

## Ciclo di vita del contesto

| Comando | Funzione |
|---|---|
| `/context create <name> <url> <token> [namespace]` | Creare un contesto |
| `/context delete <name> --confirm` | Eliminare un contesto (richiede `--confirm`) |
| `/context rename <old> <new>` | Rinominare un contesto |
| `/context validate <name>` | Testare le credenziali senza cambiare contesto |
| `/context export [name] [--include-token]` | Esportare come JSON (token mascherati per impostazione predefinita) |
| `/context import <path-or-json> [--overwrite]` | Importare da file o JSON inline |
| `/context wizard` | Configurazione interattiva guidata |

## Cambio di namespace

Ogni contesto ha un namespace predefinito. È possibile cambiarlo senza modificare il contesto:

```
/context namespace system
```

Il completamento automatico con Tab suggerisce i nomi dei namespace dal tenant attivo.

## Variabili d'ambiente nei contesti

I contesti possono contenere variabili d'ambiente aggiuntive che vengono iniettate nella sessione al momento dell'attivazione. Utile per configurazioni specifiche del tenant che non fanno parte del set di credenziali.

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

Alias: `add` = `set`, `remove`/`clear` = `unset`.

## Completamento con Tab

Digitare `/context ` e premere Tab. Il menu a discesa mostra:

1. **Nomi dei contesti** -- con indicazioni sull'URL del tenant, per distinguere i diversi tenant
2. **`-`** -- appare quando si è già effettuato un cambio, mostra verso quale contesto si tornerebbe
3. **Sottocomandi** -- `list`, `create`, `delete`, ecc.

I nomi dei contesti appaiono per primi perché il cambio di contesto è l'azione più comune.

Il completamento funziona anche a livello di sottocomando: `/context activate <Tab>` completa i nomi dei contesti, `/context namespace <Tab>` completa i namespace, `/context unset <Tab>` completa le chiavi delle variabili d'ambiente conosciute.

## Regole di denominazione

I nomi dei contesti devono essere composti da 1-64 caratteri: lettere, cifre, trattini, underscore.

I nomi che collidono con i sottocomandi vengono rifiutati:

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

L'insieme completo dei nomi riservati: `list`, `show`, `status`, `create`, `delete`, `rename`, `namespace`, `env`, `set`, `unset`, `add`, `remove`, `clear`, `activate`, `validate`, `export`, `import`, `wizard`, `help`. Il confronto è case-insensitive.

## Override tramite variabili d'ambiente

Se `XCSH_API_URL` e `XCSH_API_TOKEN` sono impostate nell'ambiente della shell prima di avviare xcsh, hanno la precedenza su qualsiasi contesto. Questo è utile per pipeline CI/CD o sessioni occasionali in cui non si desidera creare un contesto persistente.

Quando si opera in questa modalità, `/context` mostra le credenziali provenienti dall'ambiente con l'etichetta `(via env vars)`.

## Comportamento del contesto precedente

- **Ambito di sessione**: il contesto precedente viene azzerato al riavvio di xcsh. Non viene persistito su disco.
- **Ping-pong**: `/context -` eseguito due volte riporta al punto di partenza.
- **Sicuro rispetto alle modifiche**: se si elimina il contesto precedente, il puntatore viene cancellato. Se lo si rinomina, il puntatore segue il nuovo nome.
- **La riattivazione è un no-op**: `/context production` quando si è già su `production` non azzera il puntatore al contesto precedente.

## Convenzioni di design

L'esperienza utente di `/context` segue:

- **kubectx**: `kubectx <name>` per il cambio, `kubectx -` per il precedente, `kubectx` senza argomenti per l'elenco
- **kubectl**: `kubectl config use-context` per la forma esplicita
- **Shell**: `cd -` / `OLDPWD` per il tracciamento della directory precedente
