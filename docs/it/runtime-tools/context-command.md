---
title: Contesti F5 XC
description: >-
  Connettere xcsh ai tenant F5 Distributed Cloud -- creare, cambiare e gestire i
  contesti di autenticazione.
sidebar:
  order: 1
  label: Contesti F5 XC
i18n:
  sourceHash: bdaf0fb8837c
  translator: machine
---

# Contesti F5 XC

xcsh si connette a F5 Distributed Cloud tramite i **contesti** -- set di credenziali con nome che associano un URL del tenant, un token API e un namespace. Se avete già usato `kubectl config use-context` o `kubectx`, il flusso di lavoro è identico: create un contesto, passate dall'uno all'altro tramite nome e usate `-` per tornare indietro.

## Per iniziare

### 1. Create il vostro primo contesto

Vi servono tre informazioni dalla vostra console F5 XC: l'URL del tenant, un token API e opzionalmente un namespace.

```
/context create production https://acme.console.ves.volterra.io p12k3-your-api-token
```

```
Context 'production' created. Use /context activate production to switch to it.
```

Oppure usate la procedura guidata se preferite istruzioni passo-passo:

```
/context wizard
```

### 2. Attivatelo

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

Una volta attivato, xcsh inietta le credenziali del tenant nella vostra sessione. L'agente può ora effettuare chiamate API F5 XC e la barra di stato mostra il contesto attivo.

### 3. Aggiungete altri contesti e passate dall'uno all'altro

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

Passate da un contesto all'altro tramite nome -- non serve alcun sotto-comando:

```
/context staging
```

Tornate al contesto precedente (stile `cd -`):

```
/context -
```

Chiamare `/context -` due volte vi riporta al punto di partenza.

### 4. Visualizzate cosa avete

```
/context
```

```
  production           https://acme.console.ves.volterra.io
* staging              https://staging.console.ves.volterra.io
```

L'`*` indica il contesto attivo.

## Comandi di uso quotidiano

| Comando | Cosa fa |
|---|---|
| `/context` | Elenca tutti i contesti |
| `/context <name>` | Passa a un contesto |
| `/context -` | Passa al contesto precedente |
| `/context show` | Mostra i dettagli del contesto attivo (token mascherati) |
| `/context status` | Mostra lo stato di autenticazione corrente |

## Ciclo di vita del contesto

| Comando | Cosa fa |
|---|---|
| `/context create <name> <url> <token> [namespace]` | Crea un contesto |
| `/context delete <name> --confirm` | Elimina un contesto (richiede `--confirm`) |
| `/context rename <old> <new>` | Rinomina un contesto |
| `/context validate <name>` | Testa le credenziali senza cambiare contesto |
| `/context export [name] [--include-token]` | Esporta come JSON (token mascherati per impostazione predefinita) |
| `/context import <path-or-json> [--overwrite]` | Importa da file o JSON inline |
| `/context wizard` | Configurazione guidata interattiva |

## Cambio di namespace

Ogni contesto ha un namespace predefinito. Cambiatelo senza modificare il contesto:

```
/context namespace system
```

Il completamento con Tab suggerisce i nomi dei namespace dal tenant attivo.

## Variabili d'ambiente sui contesti

I contesti possono contenere variabili d'ambiente aggiuntive che vengono iniettate nella sessione all'attivazione. Utile per configurazioni specifiche per tenant che non fanno parte del set di credenziali.

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

Alias: `add` = `set`, `remove`/`clear` = `unset`.

## Completamento con Tab

Digitate `/context ` e premete Tab. Il menu a discesa mostra:

1. **Nomi dei contesti** -- con suggerimenti sull'URL del tenant, così potete distinguere i tenant
2. **`-`** -- appare quando avete già effettuato un cambio, mostra a quale contesto tornereste
3. **Sotto-comandi** -- `list`, `create`, `delete`, ecc.

I nomi dei contesti appaiono per primi perché il cambio è l'azione più comune.

Il completamento funziona anche a livello di sotto-comando: `/context activate <Tab>` completa i nomi dei contesti, `/context namespace <Tab>` completa i namespace, `/context unset <Tab>` completa le chiavi delle variabili d'ambiente conosciute.

## Regole di denominazione

I nomi dei contesti devono essere di 1-64 caratteri: lettere, cifre, trattini, underscore.

I nomi che collidono con i sotto-comandi vengono rifiutati:

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

L'insieme completo dei nomi riservati: `list`, `show`, `status`, `create`, `delete`, `rename`, `namespace`, `env`, `set`, `unset`, `add`, `remove`, `clear`, `activate`, `validate`, `export`, `import`, `wizard`, `help`. Il confronto è case-insensitive.

## Override tramite variabili d'ambiente

Se `F5XC_API_URL` e `F5XC_API_TOKEN` sono impostate nel vostro ambiente shell prima di avviare xcsh, hanno la precedenza su qualsiasi contesto. Questo è utile per pipeline CI/CD o sessioni occasionali in cui non volete creare un contesto persistente.

Quando si opera in questa modalità, `/context` mostra le credenziali provenienti dall'ambiente con l'etichetta `(via env vars)`.

## Comportamento del contesto precedente

- **Ambito di sessione**: il contesto precedente viene azzerato al riavvio di xcsh. Non viene persistito su disco.
- **Ping-pong**: `/context -` due volte vi riporta al punto di partenza.
- **Sicuro attraverso le mutazioni**: se eliminate il contesto precedente, il puntatore viene cancellato. Se lo rinominate, il puntatore segue il nuovo nome.
- **La ri-attivazione è un no-op**: `/context production` quando siete già su `production` non resetta il puntatore al contesto precedente.

## Convenzioni di design

L'esperienza utente di `/context` segue:

- **kubectx**: `kubectx <name>` per il cambio, `kubectx -` per il precedente, `kubectx` senza argomenti per l'elenco
- **kubectl**: `kubectl config use-context` per la forma esplicita
- **Shell**: `cd -` / `OLDPWD` per il tracciamento della directory precedente
