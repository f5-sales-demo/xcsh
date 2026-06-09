---
title: Archiviazione delle sessioni e modello degli entry
description: >-
  Modello di archiviazione delle sessioni in modalità append-only con tipi di
  entry, persistenza e migrazione tra formati.
sidebar:
  order: 1
  label: Archiviazione e modello degli entry
i18n:
  sourceHash: 42fe17549e00
  translator: machine
---

# Archiviazione delle sessioni e modello degli entry

Questo documento è la fonte di verità su come le sessioni del coding-agent vengono rappresentate, persistite, migrate e ricostruite a runtime.

## Ambito

Copre:

- Formato JSONL delle sessioni e versionamento
- Tassonomia degli entry e semantica ad albero (`id`/`parentId` + puntatore foglia)
- Comportamento di migrazione/compatibilità durante il caricamento di file vecchi o malformati
- Ricostruzione del contesto (`buildSessionContext`)
- Garanzie di persistenza, comportamento in caso di errore, troncamento/esternalizzazione blob
- Astrazioni di archiviazione (`FileSessionStorage`, `MemorySessionStorage`) e utilità correlate

Non copre il comportamento di rendering dell'interfaccia `/tree` oltre le semantiche che influenzano i dati della sessione.

## File di implementazione

- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`src/session/messages.ts`](../../packages/coding-agent/src/session/messages.ts)
- [`src/session/session-storage.ts`](../../packages/coding-agent/src/session/session-storage.ts)
- [`src/session/history-storage.ts`](../../packages/coding-agent/src/session/history-storage.ts)
- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts)

## Layout su disco

Posizione predefinita del file di sessione:

```text
~/.xcsh/agent/sessions/--<cwd-encoded>--/<timestamp>_<sessionId>.jsonl
```

`<cwd-encoded>` è derivato dalla directory di lavoro rimuovendo lo slash iniziale e sostituendo `/`, `\\` e `:` con `-`.

Posizione del blob store:

```text
~/.xcsh/agent/blobs/<sha256>
```

I file breadcrumb del terminale vengono scritti in:

```text
~/.xcsh/agent/terminal-sessions/<terminal-id>
```

Il contenuto del breadcrumb è composto da due righe: la cwd originale, poi il percorso del file di sessione. `continueRecent()` preferisce questo puntatore con scope terminale prima di cercare il mtime più recente.

## Formato del file

I file di sessione sono JSONL: un oggetto JSON per riga.

- La riga 1 è sempre l'header della sessione (`type: "session"`).
- Le righe rimanenti sono valori `SessionEntry`.
- Gli entry sono in modalità append-only a runtime; la navigazione dei branch sposta un puntatore (`leafId`) anziché modificare gli entry esistenti.

### Header (`SessionHeader`)

```json
{
  "type": "session",
  "version": 3,
  "id": "1f9d2a6b9c0d1234",
  "timestamp": "2026-02-16T10:20:30.000Z",
  "cwd": "/work/pi",
  "title": "optional session title",
  "parentSession": "optional lineage marker"
}
```

Note:

- `version` è opzionale nei file v1; l'assenza indica v1.
- `parentSession` è una stringa opaca di lineaggio. Il codice attuale scrive un id di sessione o un percorso di sessione a seconda del flusso (`fork`, `forkFrom`, `createBranchedSession`, o esplicitamente `newSession({ parentSession })`). Va trattato come metadato, non come una foreign key tipizzata.

### Base degli entry (`SessionEntryBase`)

Tutti gli entry non-header includono:

```json
{
  "type": "...",
  "id": "8-char-id",
  "parentId": "previous-or-branch-parent",
  "timestamp": "2026-02-16T10:20:30.000Z"
}
```

`parentId` può essere `null` per un entry radice (primo append, o dopo `resetLeaf()`).

## Tassonomia degli entry

`SessionEntry` è l'unione di:

- `message`
- `thinking_level_change`
- `model_change`
- `compaction`
- `branch_summary`
- `custom`
- `custom_message`
- `label`
- `ttsr_injection`
- `session_init`
- `mode_change`

### `message`

Memorizza direttamente un `AgentMessage`.

```json
{
  "type": "message",
  "id": "a1b2c3d4",
  "parentId": null,
  "timestamp": "2026-02-16T10:21:00.000Z",
  "message": {
    "role": "assistant",
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "content": [{ "type": "text", "text": "Done." }],
    "usage": { "input": 100, "output": 20, "cacheRead": 0, "cacheWrite": 0, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } },
    "timestamp": 1760000000000
  }
}
```

### `model_change`

```json
{
  "type": "model_change",
  "id": "b1c2d3e4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:21:30.000Z",
  "model": "openai/gpt-4o",
  "role": "default"
}
```

`role` è opzionale; l'assenza viene trattata come `default` nella ricostruzione del contesto.

### `thinking_level_change`

```json
{
  "type": "thinking_level_change",
  "id": "c1d2e3f4",
  "parentId": "b1c2d3e4",
  "timestamp": "2026-02-16T10:22:00.000Z",
  "thinkingLevel": "high"
}
```

### `compaction`

```json
{
  "type": "compaction",
  "id": "d1e2f3a4",
  "parentId": "c1d2e3f4",
  "timestamp": "2026-02-16T10:23:00.000Z",
  "summary": "Conversation summary",
  "shortSummary": "Short recap",
  "firstKeptEntryId": "a1b2c3d4",
  "tokensBefore": 42000,
  "details": { "readFiles": ["src/a.ts"] },
  "preserveData": { "hookState": true },
  "fromExtension": false
}
```

### `branch_summary`

```json
{
  "type": "branch_summary",
  "id": "e1f2a3b4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:24:00.000Z",
  "fromId": "a1b2c3d4",
  "summary": "Summary of abandoned path",
  "details": { "note": "optional" },
  "fromExtension": true
}
```

Se si effettua il branching dalla radice (`branchFromId === null`), `fromId` è la stringa letterale `"root"`.

### `custom`

Persistenza dello stato delle estensioni; ignorato da `buildSessionContext`.

```json
{
  "type": "custom",
  "id": "f1a2b3c4",
  "parentId": "e1f2a3b4",
  "timestamp": "2026-02-16T10:25:00.000Z",
  "customType": "my-extension",
  "data": { "state": 1 }
}
```

### `custom_message`

Messaggio fornito da un'estensione che partecipa al contesto LLM.

```json
{
  "type": "custom_message",
  "id": "a2b3c4d5",
  "parentId": "f1a2b3c4",
  "timestamp": "2026-02-16T10:26:00.000Z",
  "customType": "my-extension",
  "content": "Injected context",
  "display": true,
  "details": { "debug": false }
}
```

### `label`

```json
{
  "type": "label",
  "id": "b2c3d4e5",
  "parentId": "a2b3c4d5",
  "timestamp": "2026-02-16T10:27:00.000Z",
  "targetId": "a1b2c3d4",
  "label": "checkpoint"
}
```

`label: undefined` cancella un'etichetta per `targetId`.

### `ttsr_injection`

```json
{
  "type": "ttsr_injection",
  "id": "c2d3e4f5",
  "parentId": "b2c3d4e5",
  "timestamp": "2026-02-16T10:28:00.000Z",
  "injectedRules": ["ruleA", "ruleB"]
}
```

### `session_init`

```json
{
  "type": "session_init",
  "id": "d2e3f4a5",
  "parentId": "c2d3e4f5",
  "timestamp": "2026-02-16T10:29:00.000Z",
  "systemPrompt": "...",
  "task": "...",
  "tools": ["read", "edit"],
  "outputSchema": { "type": "object" }
}
```

### `mode_change`

```json
{
  "type": "mode_change",
  "id": "e2f3a4b5",
  "parentId": "d2e3f4a5",
  "timestamp": "2026-02-16T10:30:00.000Z",
  "mode": "plan",
  "data": { "planFile": "/tmp/plan.md" }
}
```

## Versionamento e migrazione

Versione corrente della sessione: `3`.

### v1 -> v2

Applicata quando l'header `version` è assente o `< 2`:

- Aggiunge `id` e `parentId` a ogni entry non-header.
- Ricostruisce una catena lineare di parent usando l'ordine del file.
- Migra il campo di compaction `firstKeptEntryIndex` -> `firstKeptEntryId` quando presente.
- Imposta l'header `version = 2`.

### v2 -> v3

Applicata quando l'header `version < 3`:

- Per gli entry `message`: riscrive il legacy `message.role === "hookMessage"` in `"custom"`.
- Imposta l'header `version = 3`.

### Trigger di migrazione e persistenza

- Le migrazioni vengono eseguite durante il caricamento della sessione (`setSessionFile`).
- Se è stata eseguita una migrazione, l'intero file viene riscritto su disco immediatamente.
- La migrazione modifica prima gli entry in memoria, poi persiste il JSONL riscritto.

## Comportamento di caricamento e compatibilità

Comportamento di `loadEntriesFromFile(path)`:

- File mancante (`ENOENT`) -> restituisce `[]`.
- Le righe non parsificabili sono gestite dal parser JSONL tollerante (`parseJsonlLenient`).
- Se il primo entry parsificato non è un header di sessione valido (`type !== "session"` o `id` stringa mancante) -> restituisce `[]`.

Comportamento di `SessionManager.setSessionFile()`:

- `[]` dal loader viene trattato come sessione vuota/inesistente e sostituito con un nuovo file di sessione inizializzato a quel percorso.
- I file validi vengono caricati, migrati se necessario, i riferimenti blob vengono risolti, poi indicizzati.

## Semantica dell'albero e della foglia

Il modello sottostante è un albero append-only + puntatore foglia mutabile:

- Ogni metodo di append crea esattamente un nuovo entry il cui `parentId` è il `leafId` corrente.
- Il nuovo entry diventa il nuovo `leafId`.
- `branch(entryId)` sposta solo `leafId`; gli entry esistenti rimangono invariati.
- `resetLeaf()` imposta `leafId = null`; il prossimo append crea un nuovo entry radice (`parentId: null`).
- `branchWithSummary()` imposta la foglia sul target del branch e aggiunge un entry `branch_summary`.

`getEntries()` restituisce tutti gli entry non-header nell'ordine di inserimento. Gli entry esistenti non vengono cancellati durante le operazioni normali; le riscritture preservano la cronologia logica aggiornando la rappresentazione (migrazioni, spostamento, helper di riscrittura mirata).

## Ricostruzione del contesto (`buildSessionContext`)

`buildSessionContext(entries, leafId, byId?)` risolve ciò che viene inviato al modello.

Algoritmo:

1. Determinare la foglia:
   - `leafId === null` -> restituisce contesto vuoto.
   - `leafId` esplicito -> usa quell'entry se trovato.
   - altrimenti fallback all'ultimo entry.
2. Percorrere la catena `parentId` dalla foglia alla radice e invertire nel percorso radice->foglia.
3. Derivare lo stato runtime lungo il percorso:
   - `thinkingLevel` dall'ultimo `thinking_level_change` (default `"off"`)
   - mappa dei modelli dagli entry `model_change` (`role ?? "default"`)
   - fallback `models.default` dal provider/modello del messaggio assistente se non c'è un cambio modello esplicito
   - `injectedTtsrRules` deduplicati da tutti gli entry `ttsr_injection`
   - mode/modeData dall'ultimo `mode_change` (mode predefinito `"none"`)
4. Costruire la lista dei messaggi:
   - gli entry `message` passano direttamente
   - gli entry `custom_message` diventano `AgentMessage` di tipo `custom` tramite `createCustomMessage`
   - gli entry `branch_summary` diventano `AgentMessage` di tipo `branchSummary` tramite `createBranchSummaryMessage`
   - se esiste una `compaction` nel percorso:
     - emettere prima il riepilogo di compaction (`createCompactionSummaryMessage`)
     - emettere gli entry del percorso a partire da `firstKeptEntryId` fino al confine di compaction
     - emettere gli entry dopo il confine di compaction

Gli entry `custom` e `session_init` non iniettano direttamente contesto nel modello.

## Garanzie di persistenza e modello di errore

### Persistenza vs in-memory

- `SessionManager.create/open/continueRecent/forkFrom` -> modalità persistente (`persist = true`).
- `SessionManager.inMemory` -> modalità non persistente (`persist = false`) con `MemorySessionStorage`.

### Pipeline di scrittura

Le scritture sono serializzate attraverso una catena interna di promise (`#persistChain`) e `NdjsonFileWriter`.

- `append*` aggiorna lo stato in memoria immediatamente.
- La persistenza è differita finché non esiste almeno un messaggio assistente.
  - Prima del primo assistente: gli entry vengono mantenuti in memoria; nessun append su file avviene.
  - Quando esiste il primo assistente: l'intera sessione in memoria viene scaricata su file.
  - Successivamente: i nuovi entry vengono aggiunti incrementalmente.

Motivazione nel codice: evitare di persistere sessioni che non hanno mai prodotto una risposta dell'assistente.

### Operazioni di durabilità

- `flush()` scarica il writer e chiama `fsync()`.
- Le riscritture atomiche complete (`#rewriteFile`) scrivono su un file temporaneo, flush+fsync, close, poi rinominano sopra il target.
- Usate per migrazioni, `setSessionName`, `rewriteEntries`, operazioni di spostamento e riscritture degli argomenti delle tool-call.

### Comportamento in caso di errore

- Gli errori di persistenza vengono registrati (`#persistError`) e rilanciati nelle operazioni successive.
- Il primo errore viene loggato una sola volta con il contesto del file di sessione.
- La chiusura del writer è best-effort ma propaga il primo errore significativo.

## Controlli sulla dimensione dei dati e esternalizzazione blob

Prima di persistere gli entry:

- Le stringhe di grandi dimensioni vengono troncate a `MAX_PERSIST_CHARS` (500.000 caratteri) con avviso:
  - `"[Session persistence truncated large content]"`
- I campi transienti `partialJson` e `jsonlEvents` vengono rimossi.
- Se l'oggetto ha sia `content` che `lineCount`, il conteggio delle righe viene ricalcolato dopo il troncamento.
- I blocchi immagine negli array `content` con lunghezza base64 >= 1024 vengono esternalizzati in riferimenti blob:
  - memorizzati come `blob:sha256:<hash>`
  - i byte grezzi vengono scritti nel blob store (`BlobStore.put`)

Al caricamento, i riferimenti blob vengono risolti nuovamente in base64 per i blocchi immagine di message/custom_message.

## Astrazioni di archiviazione

L'interfaccia `SessionStorage` fornisce tutte le operazioni filesystem usate da `SessionManager`:

- sincrone: `ensureDirSync`, `existsSync`, `writeTextSync`, `statSync`, `listFilesSync`
- asincrone: `exists`, `readText`, `readTextPrefix`, `writeText`, `rename`, `unlink`, `openWriter`

Implementazioni:

- `FileSessionStorage`: filesystem reale (Bun + node fs)
- `MemorySessionStorage`: implementazione in-memory basata su map per test/sessioni non persistenti

`SessionStorageWriter` espone `writeLine`, `flush`, `fsync`, `close`, `getError`.

## Utilità di scoperta delle sessioni

Definite in `session-manager.ts`:

- `getRecentSessions(sessionDir, limit)` -> metadati leggeri per UI/selettore di sessioni
- `findMostRecentSession(sessionDir)` -> la più recente per mtime
- `list(cwd, sessionDir?)` -> sessioni in un singolo ambito di progetto
- `listAll()` -> sessioni attraverso tutti gli ambiti di progetto sotto `~/.xcsh/agent/sessions`

L'estrazione dei metadati legge solo un prefisso (`readTextPrefix(..., 4096)`) quando possibile.

## Correlato ma distinto: archiviazione della cronologia dei prompt

`HistoryStorage` (`history-storage.ts`) è un sottosistema SQLite separato per il richiamo/ricerca dei prompt, non per il replay delle sessioni.

- DB: `~/.xcsh/agent/history.db`
- Tabella: `history(id, prompt, created_at, cwd)`
- Indice FTS5: `history_fts` con sincronizzazione mantenuta tramite trigger
- Deduplica i prompt identici consecutivi usando una cache in memoria dell'ultimo prompt
- Inserimento asincrono (`setImmediate`) affinché la cattura del prompt non blocchi l'esecuzione del turno

Usare i file di sessione per il replay del grafo/stato della conversazione; usare `HistoryStorage` per la UX della cronologia dei prompt.
