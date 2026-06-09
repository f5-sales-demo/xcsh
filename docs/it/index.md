---
title: Documentazione xcsh
description: >-
  CLI di sviluppo basata su AI con agente di codifica TypeScript e livello
  nativo Rust per sessioni di lunga durata, supporto MCP e pacchettizzazione per
  piattaforme.
sidebar:
  order: 0
  label: Panoramica
i18n:
  sourceHash: b9288f42bf46
  translator: machine
---

xcsh è una CLI di sviluppo basata su AI con un agente di codifica TypeScript e un
livello nativo Rust (`pi-natives`). Estende la linea open-source
[`badlogic/pi-mono`](https://github.com/badlogic/pi-mono) con un runtime
rafforzato, sessioni di lunga durata con navigazione ad albero e compattazione,
uno strumento Python IPython, pieno supporto MCP, un sistema di skill e
pacchettizzazione per piattaforme destinate a Linux, macOS e Windows.

## Da dove iniziare

- **[Contesti F5 XC](/runtime-tools/context-command)** — connessione ai tenant di F5 Distributed Cloud.
  Creazione di contesti, passaggio tra di essi, gestione di namespace e credenziali.
- **Configurazione** — come xcsh individua, risolve e stratifica la configurazione.
- **Runtime e Strumenti** — i runtime degli strumenti bash / notebook / resolve e la
  superficie dei comandi slash.
- **Sessioni** — log di voci append-only, navigazione ad albero, compattazione e il
  sistema di memoria autonomo.
- **Nativi (Rust)** — architettura dell'addon N-API `pi-natives` che
  alimenta shell / PTY / media / ricerca.
- **MCP** — configurazione, dettagli del protocollo, ciclo di vita del runtime e come
  creare server e strumenti.
- **Estensioni, Skill e Plugin** — creazione, caricamento, regole di corrispondenza,
  marketplace e installer dei plugin.
- **Provider e Modelli** — configurazione dei modelli, dettagli dello streaming e il
  runtime Python / IPython.
- **TUI** — temi, il comando `/tree` e hook di integrazione per
  estensioni e strumenti personalizzati.

## Come è organizzata questa documentazione

Ogni gruppo di primo livello nella barra laterale corrisponde a un sottosistema dell'agente. All'interno
di un gruppo, le pagine procedono da "panoramica" a "dettagli interni", così potete interrompere la lettura
quando avete abbastanza contesto per il compito che dovete svolgere.
