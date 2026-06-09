---
title: Memoria autonoma
description: >-
  Sistema di memoria autonoma per mantenere preferenze utente, contesto di
  progetto e feedback tra le sessioni.
sidebar:
  order: 7
  label: Memoria autonoma
i18n:
  sourceHash: 2aa9f516aa1e
  translator: machine
---

# Memoria autonoma

Quando abilitato, l'agente estrae automaticamente conoscenza duratura dalle sessioni passate e inserisce un riepilogo compatto in ogni nuova sessione. Nel tempo costruisce un archivio di memoria a livello di progetto — decisioni tecniche, flussi di lavoro ricorrenti, insidie — che si propaga senza sforzo manuale.

Disabilitato per impostazione predefinita. Abilitazione tramite `/settings` o `config.yml`:

```yaml
memories:
  enabled: true
```

## Utilizzo

### Cosa viene inserito

All'avvio della sessione, se esiste un riepilogo di memoria per il progetto corrente, viene inserito nel prompt di sistema come blocco **Memory Guidance**. L'agente è istruito a:

- Trattare la memoria come contesto euristico — utile per processi e decisioni pregresse, non autorevole sullo stato corrente del repository.
- Citare il percorso dell'artefatto di memoria quando la memoria modifica il piano, e abbinarlo a evidenze dal repository corrente prima di agire.
- Preferire lo stato del repository e le istruzioni dell'utente quando in conflitto con la memoria; trattare la memoria in conflitto come obsoleta.

### Lettura degli artefatti di memoria

L'agente può leggere direttamente i file di memoria utilizzando URL `memory://` con il tool `read`:

| URL | Contenuto |
|---|---|
| `memory://root` | Riepilogo compatto inserito all'avvio |
| `memory://root/MEMORY.md` | Documento completo di memoria a lungo termine |
| `memory://root/skills/<name>/SKILL.md` | Un playbook di competenze generato |

### Comando slash `/memory`

| Sottocomando | Effetto |
|---|---|
| `view` | Mostra il payload di inserimento memoria corrente |
| `clear` / `reset` | Elimina tutti i dati di memoria e gli artefatti generati |
| `enqueue` / `rebuild` | Forza l'esecuzione della consolidazione al prossimo avvio |

## Come funziona

Le memorie vengono costruite da una pipeline in background che si esegue all'avvio o viene attivata manualmente tramite comando slash.

**Fase 1 — estrazione per sessione:** Per ogni sessione passata che è cambiata dall'ultima elaborazione, un modello legge la cronologia della sessione ed estrae segnali duraturi: decisioni tecniche, vincoli, errori risolti, flussi di lavoro ricorrenti. Le sessioni troppo recenti, troppo vecchie o attualmente attive vengono saltate. Ogni estrazione produce un blocco di memoria grezzo e una breve sinossi per quella sessione.

**Fase 2 — consolidamento:** Dopo l'estrazione, un secondo passaggio del modello legge tutte le estrazioni per sessione e produce tre output scritti su disco:

- `MEMORY.md` — un documento di memoria a lungo termine curato
- `memory_summary.md` — il testo compatto inserito all'avvio della sessione
- `skills/` — playbook procedurali riutilizzabili, ciascuno nella propria sottocartella

La Fase 2 utilizza un lease per prevenire la doppia esecuzione quando più processi partono simultaneamente. Le directory di competenze obsolete delle esecuzioni precedenti vengono eliminate automaticamente.

Tutti gli output vengono scansionati alla ricerca di segreti prima di essere scritti su disco.

### Comportamento dell'estrazione

Il comportamento di estrazione e consolidamento della memoria è interamente guidato da file di prompt statici in `src/prompts/memories/`.

| File | Scopo | Variabili |
|---|---|---|
| `stage_one_system.md` | Prompt di sistema per l'estrazione per sessione | — |
| `stage_one_input.md` | Template del turno utente che avvolge il contenuto della sessione | `{{thread_id}}`, `{{response_items_json}}` |
| `consolidation.md` | Prompt per il consolidamento tra sessioni | `{{raw_memories}}`, `{{rollout_summaries}}` |
| `read_path.md` | Guida di memoria inserita nelle sessioni attive | `{{memory_summary}}` |

### Selezione del modello

La memoria si appoggia al sistema di ruoli del modello.

| Fase | Ruolo | Scopo |
|---|---|---|
| Fase 1 (estrazione) | `default` | Estrazione di conoscenza per sessione |
| Fase 2 (consolidamento) | `smol` | Sintesi tra sessioni |

Se `smol` non è configurato, la Fase 2 ricade sul ruolo `default`.

## Configurazione

| Impostazione | Predefinito | Descrizione |
|---|---|---|
| `memories.enabled` | `false` | Interruttore principale |
| `memories.maxRolloutAgeDays` | `30` | Le sessioni più vecchie di questo valore non vengono elaborate |
| `memories.minRolloutIdleHours` | `12` | Le sessioni attive più di recente rispetto a questo valore vengono saltate |
| `memories.maxRolloutsPerStartup` | `64` | Limite massimo di sessioni elaborate in un singolo avvio |
| `memories.summaryInjectionTokenLimit` | `5000` | Token massimi del riepilogo inserito nel prompt di sistema |

Parametri di regolazione aggiuntivi (concorrenza, durate dei lease, budget di token) sono disponibili nella configurazione per uso avanzato.

## File principali

- `src/memories/index.ts` — orchestrazione della pipeline, inserimento, gestione dei comandi slash
- `src/memories/storage.ts` — coda di lavoro e registro dei thread supportati da SQLite
- `src/prompts/memories/` — template dei prompt di memoria
- `src/internal-urls/memory-protocol.ts` — gestore URL `memory://`
