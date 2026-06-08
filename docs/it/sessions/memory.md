---
title: Memoria Autonoma
description: >-
  Sistema di memoria autonoma per la persistenza delle preferenze utente, del
  contesto di progetto e del feedback tra le sessioni.
sidebar:
  order: 7
  label: Memoria autonoma
i18n:
  sourceHash: 2aa9f516aa1e
  translator: machine
---

# Memoria Autonoma

Quando abilitato, l'agente estrae automaticamente conoscenza duratura dalle sessioni passate e inietta un riepilogo compatto in ogni nuova sessione. Nel tempo costruisce un archivio di memoria con ambito progetto — decisioni tecniche, flussi di lavoro ricorrenti, insidie — che si perpetua senza intervento manuale.

Disabilitato per impostazione predefinita. Si abilita tramite `/settings` o `config.yml`:

```yaml
memories:
  enabled: true
```

## Utilizzo

### Cosa viene iniettato

All'avvio della sessione, se esiste un riepilogo di memoria per il progetto corrente, viene iniettato nel prompt di sistema come blocco **Memory Guidance**. L'agente è istruito a:

- Trattare la memoria come contesto euristico — utile per i processi e le decisioni precedenti, non autorevole sullo stato corrente del repository.
- Citare il percorso dell'artefatto di memoria quando la memoria modifica il piano, e abbinarlo con evidenze dal repository corrente prima di agire.
- Preferire lo stato del repository e le istruzioni dell'utente quando sono in conflitto con la memoria; trattare la memoria in conflitto come obsoleta.

### Lettura degli artefatti di memoria

L'agente può leggere i file di memoria direttamente utilizzando URL `memory://` con lo strumento `read`:

| URL | Contenuto |
|---|---|
| `memory://root` | Riepilogo compatto iniettato all'avvio |
| `memory://root/MEMORY.md` | Documento completo di memoria a lungo termine |
| `memory://root/skills/<name>/SKILL.md` | Un playbook di competenze generato |

### Comando slash `/memory`

| Sottocomando | Effetto |
|---|---|
| `view` | Mostra il payload di iniezione della memoria corrente |
| `clear` / `reset` | Elimina tutti i dati di memoria e gli artefatti generati |
| `enqueue` / `rebuild` | Forza l'esecuzione del consolidamento al prossimo avvio |

## Come funziona

Le memorie vengono costruite da una pipeline in background che si attiva all'avvio o manualmente tramite comando slash.

**Fase 1 — estrazione per sessione:** Per ogni sessione passata che è cambiata dall'ultima elaborazione, un modello legge la cronologia della sessione ed estrae il segnale duraturo: decisioni tecniche, vincoli, errori risolti, flussi di lavoro ricorrenti. Le sessioni troppo recenti, troppo vecchie o attualmente attive vengono saltate. Ogni estrazione produce un blocco di memoria grezzo e una breve sinossi per quella sessione.

**Fase 2 — consolidamento:** Dopo l'estrazione, un secondo passaggio del modello legge tutte le estrazioni per sessione e produce tre output scritti su disco:

- `MEMORY.md` — un documento di memoria a lungo termine curato
- `memory_summary.md` — il testo compatto iniettato all'avvio della sessione
- `skills/` — playbook procedurali riutilizzabili, ciascuno nella propria sottodirectory

La Fase 2 utilizza un lease per prevenire la doppia esecuzione quando più processi si avviano simultaneamente. Le directory di competenze obsolete delle esecuzioni precedenti vengono eliminate automaticamente.

Tutti gli output vengono scansionati per la presenza di segreti prima della scrittura su disco.

### Comportamento dell'estrazione

Il comportamento di estrazione e consolidamento della memoria è interamente guidato da file di prompt statici in `src/prompts/memories/`.

| File | Scopo | Variabili |
|---|---|---|
| `stage_one_system.md` | Prompt di sistema per l'estrazione per sessione | — |
| `stage_one_input.md` | Template del turno utente che racchiude il contenuto della sessione | `{{thread_id}}`, `{{response_items_json}}` |
| `consolidation.md` | Prompt per il consolidamento cross-sessione | `{{raw_memories}}`, `{{rollout_summaries}}` |
| `read_path.md` | Guida di memoria iniettata nelle sessioni attive | `{{memory_summary}}` |

### Selezione del modello

La memoria si appoggia al sistema di ruoli del modello.

| Fase | Ruolo | Scopo |
|---|---|---|
| Fase 1 (estrazione) | `default` | Estrazione della conoscenza per sessione |
| Fase 2 (consolidamento) | `smol` | Sintesi cross-sessione |

Se `smol` non è configurato, la Fase 2 ricade sul ruolo `default`.

## Configurazione

| Impostazione | Predefinito | Descrizione |
|---|---|---|
| `memories.enabled` | `false` | Interruttore principale |
| `memories.maxRolloutAgeDays` | `30` | Le sessioni più vecchie di questo valore non vengono elaborate |
| `memories.minRolloutIdleHours` | `12` | Le sessioni attive più di recente di questo valore vengono saltate |
| `memories.maxRolloutsPerStartup` | `64` | Limite massimo di sessioni elaborate in un singolo avvio |
| `memories.summaryInjectionTokenLimit` | `5000` | Numero massimo di token del riepilogo iniettato nel prompt di sistema |

Ulteriori parametri di regolazione (concorrenza, durate dei lease, budget di token) sono disponibili nella configurazione per un utilizzo avanzato.

## File principali

- `src/memories/index.ts` — orchestrazione della pipeline, iniezione, gestione dei comandi slash
- `src/memories/storage.ts` — coda di lavoro e registro dei thread basati su SQLite
- `src/prompts/memories/` — template dei prompt di memoria
- `src/internal-urls/memory-protocol.ts` — handler degli URL `memory://`
