---
title: Archiviazione delle sessioni e modello delle entry
description: >-
  Append-only session storage model with entry types, persistence, and migration
  between formats.
sidebar:
  order: 1
  label: Archiviazione e modello entry
i18n:
  sourceHash: 42fe17549e00
  translator: machine
---

# Archiviazione delle sessioni e modello delle entry

Questo documento è la fonte di verità per il modo in cui le sessioni del coding-agent vengono rappresentate, persistite, migrate e ricostruite a runtime.

## Ambito

Copre:

- Formato JSONL delle sessioni e versionamento
- Tassonomia delle entry e semantica ad albero (`id`/`parentId` + puntatore foglia)
- Comportamento di migrazione/compatibilità durante il caricamento di file vecchi o malformati
- Ricostruzione del contesto (`buildSessionContext`)
- Garanzie di persistenza, comportamento in caso di errore, troncamento/esternalizzazione blob
- Astrazioni di archiviazione (`FileSessionStorage`, `MemorySessionStorage`) e utility correlate

Non copre il comportamento di rendering dell'interfaccia `/tree` oltre alle semantiche che influenzano i dati di sessione.

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

Il contenuto del breadcrumb è composto da due righe: la cwd originale, seguita dal percorso del file di sessione. `continueRecent()` preferisce questo puntatore con scope sul terminale prima di cercare il file con l'mtime più recente.

## Formato del file

I file di sessione sono JSONL: un oggetto JSON per riga.

- La riga 1 è sempre l'header di sessione (`type: "session"`).
- Le righe rimanenti sono valori `SessionEntry`.
- Le entry sono append-only a runtime; la navigazione tra branch sposta un puntatore (`leafId`) anziché modificare le entry esistenti.

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
- `parentSession` è una stringa opaca di lineage. Il codice attuale scrive un id di sessione o un percorso di sessione a seconda del flusso (`fork`, `forkFrom`, `createBranchedSession`, o `newSession({ parentSession })` esplicito). Va trattato come metadato, non come una foreign key tipizzata.

### Base delle entry (`SessionEntryBase`)

Tutte le entry non-header includono:

```json
{
  "type": "...",
  "id": "8-char-id",
  "parentId": "previous-or-branch-parent",
  "timestamp": "2026-02-16T10:20:30.000Z"
}
```

`parentId` può essere `null` per una entry radice (primo append, o dopo `resetLeaf()`).

## Tassonomia delle entry

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

Memorizza un `AgentMessage` direttamente.

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

`role` è opzionale; se mancante viene trattato come `default` nella ricostruzione del contesto.

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

Se si effettua il branch dalla radice (`branchFromId === null`), `fromId` è la stringa letterale `"root"`.

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

Applicata quando la `version` dell'header è assente o `< 2`:

- Aggiunge `id` e `parentId` a ogni entry non-header.
- Ricostruisce una catena di parent lineare usando l'ordine del file.
- Migra il campo di compaction `firstKeptEntryIndex` -> `firstKeptEntryId` quando presente.
- Imposta `version = 2` nell'header.

### v2 -> v3

Applicata quando `version` dell'header `< 3`:

- Per le entry `message`: riscrive il legacy `message.role === "hookMessage"` in `"custom"`.
- Imposta `version = 3` nell'header.

### Trigger di migrazione e persistenza

- Le migrazioni vengono eseguite durante il caricamento della sessione (`setSessionFile`).
- Se una qualsiasi migrazione è stata eseguita, l'intero file viene riscritto su disco immediatamente.
- La migrazione modifica le entry in memoria prima, poi persiste il JSONL riscritto.

## Comportamento di caricamento e compatibilità

Comportamento di `loadEntriesFromFile(path)`:

- File mancante (`ENOENT`) -> restituisce `[]`.
- Le righe non analizzabili sono gestite dal parser JSONL lenient (`parseJsonlLenient`).
- Se la prima entry analizzata non è un header di sessione valido (`type !== "session"` o `id` stringa mancante) -> restituisce `[]`.

Comportamento di `SessionManager.setSessionFile()`:

- `[]` dal loader è trattato come sessione vuota/inesistente e viene sostituito con un nuovo file di sessione inizializzato in quel percorso.
- I file validi vengono caricati, migrati se necessario, i riferimenti blob risolti, quindi indicizzati.

## Semantica dell'albero e della foglia

Il modello sottostante è un albero append-only + puntatore foglia mutabile:

- Ogni metodo di append crea esattamente una nuova entry il cui `parentId` è il `leafId` corrente.
- La nuova entry diventa il nuovo `leafId`.
- `branch(entryId)` sposta solo il `leafId`; le entry esistenti rimangono invariate.
- `resetLeaf()` imposta `leafId = null`; il prossimo append crea una nuova entry radice (`parentId: null`).
- `branchWithSummary()` imposta la foglia sul target del branch e aggiunge una entry `branch_summary`.

`getEntries()` restituisce tutte le entry non-header in ordine di inserimento. Le entry esistenti non vengono eliminate durante il funzionamento normale; le riscritture preservano la cronologia logica aggiornando la rappresentazione (migrazioni, spostamenti, helper di riscrittura mirata).

## Ricostruzione del contesto (`buildSessionContext`)

`buildSessionContext(entries, leafId, byId?)` risolve ciò che viene inviato al modello.

Algoritmo:

1. Determinare la foglia:
   - `leafId === null` -> restituisce contesto vuoto.
   - `leafId` esplicito -> usa quella entry se trovata.
   - altrimenti fallback all'ultima entry.
2. Percorrere la catena `parentId` dalla foglia alla radice e invertire in percorso radice->foglia.
3. Derivare lo stato runtime lungo il percorso:
   - `thinkingLevel` dall'ultimo `thinking_level_change` (predefinito `"off"`)
   - mappa dei modelli dalle entry `model_change` (`role ?? "default"`)
   - fallback `models.default` dal provider/modello del messaggio assistente se nessun cambio modello esplicito
   - `injectedTtsrRules` deduplicati da tutte le entry `ttsr_injection`
   - mode/modeData dall'ultimo `mode_change` (modalità predefinita `"none"`)
4. Costruire la lista dei messaggi:
   - le entry `message` passano direttamente
   - le entry `custom_message` diventano `AgentMessages` `custom` tramite `createCustomMessage`
   - le entry `branch_summary` diventano `AgentMessages` `branchSummary` tramite `createBranchSummaryMessage`
   - se esiste un `compaction` nel percorso:
     - emettere prima il sommario di compaction (`createCompactionSummaryMessage`)
     - emettere le entry del percorso a partire da `firstKeptEntryId` fino al confine di compaction
     - emettere le entry dopo il confine di compaction

Le entry `custom` e `session_init` non iniettano contesto nel modello direttamente.

## Garanzie di persistenza e modello di errore

### Persistenza vs in-memory

- `SessionManager.create/open/continueRecent/forkFrom` -> modalità persistente (`persist = true`).
- `SessionManager.inMemory` -> modalità non persistente (`persist = false`) con `MemorySessionStorage`.

### Pipeline di scrittura

Le scritture sono serializzate attraverso una catena di promise interna (`#persistChain`) e `NdjsonFileWriter`.

- `append*` aggiorna lo stato in memoria immediatamente.
- La persistenza è differita fino a quando non esiste almeno un messaggio assistente.
  - Prima del primo assistente: le entry sono mantenute in memoria; nessun append su file avviene.
  - Quando esiste il primo assistente: l'intera sessione in memoria viene scaricata su file.
  - Successivamente: le nuove entry vengono aggiunte in modo incrementale.

Motivazione nel codice: evitare di persistere sessioni che non hanno mai prodotto una risposta dell'assistente.

### Operazioni di durabilità

- `flush()` scarica il writer e chiama `fsync()`.
- Le riscritture atomiche complete (`#rewriteFile`) scrivono su un file temporaneo, flush+fsync, chiudono, poi rinominano sopra il target.
- Usate per migrazioni, `setSessionName`, `rewriteEntries`, operazioni di spostamento e riscritture degli argomenti delle tool-call.

### Comportamento in caso di errore

- Gli errori di persistenza vengono memorizzati (`#persistError`) e rilanciati nelle operazioni successive.
- Il primo errore viene registrato una sola volta con il contesto del file di sessione.
- La chiusura del writer è best-effort ma propaga il primo errore significativo.

## Controlli sulla dimensione dei dati e esternalizzazione blob

Prima di persistere le entry:

- Le stringhe di grandi dimensioni vengono troncate a `MAX_PERSIST_CHARS` (500.000 caratteri) con avviso:
  - `"[Session persistence truncated large content]"`
- I campi transitori `partialJson` e `jsonlEvents` vengono rimossi.
- Se l'oggetto ha sia `content` che `lineCount`, il conteggio delle righe viene ricalcolato dopo il troncamento.
- I blocchi immagine negli array `content` con lunghezza base64 >= 1024 vengono esternalizzati in riferimenti blob:
  - memorizzati come `blob:sha256:<hash>`
  - i byte grezzi vengono scritti nel blob store (`BlobStore.put`)

Al caricamento, i riferimenti blob vengono risolti nuovamente in base64 per i blocchi immagine di message/custom_message.

## Astrazioni di archiviazione

L'interfaccia `SessionStorage` fornisce tutte le operazioni del filesystem utilizzate da `SessionManager`:

- sync: `ensureDirSync`, `existsSync`, `writeTextSync`, `statSync`, `listFilesSync`
- async: `exists`, `readText`, `readTextPrefix`, `writeText`, `rename`, `unlink`, `openWriter`

Implementazioni:

- `FileSessionStorage`: filesystem reale (Bun + node fs)
- `MemorySessionStorage`: implementazione in-memory basata su map per test/sessioni non persistenti

`SessionStorageWriter` espone `writeLine`, `flush`, `fsync`, `close`, `getError`.

## Utility di scoperta delle sessioni

Definite in `session-manager.ts`:

- `getRecentSessions(sessionDir, limit)` -> metadati leggeri per UI/selettore sessione
- `findMostRecentSession(sessionDir)` -> la più recente per mtime
- `list(cwd, sessionDir?)` -> sessioni in uno scope di progetto
- `listAll()` -> sessioni in tutti gli scope di progetto sotto `~/.xcsh/agent/sessions`

L'estrazione dei metadati legge solo un prefisso (`readTextPrefix(..., 4096)`) quando possibile.

## Correlato ma distinto: archiviazione della cronologia dei prompt

`HistoryStorage` (`history-storage.ts`) è un sottosistema SQLite separato per il richiamo/ricerca dei prompt, non per il replay delle sessioni.

- DB: `~/.xcsh/agent/history.db`
- Tabella: `history(id, prompt, created_at, cwd)`
- Indice FTS5: `history_fts` con sincronizzazione mantenuta da trigger
- Deduplica i prompt identici consecutivi usando una cache in-memory dell'ultimo prompt
- Inserimento asincrono (`setImmediate`) in modo che la cattura del prompt non blocchi l'esecuzione del turno

Usare i file di sessione per il replay del grafo/stato della conversazione; usare `HistoryStorage` per la UX della cronologia dei prompt.
