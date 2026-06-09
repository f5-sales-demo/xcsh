---
title: Architettura di archiviazione Blob e Artifact
description: >-
  Archivio blob con indirizzamento basato sul contenuto e registro degli
  artifact per media di sessione, screenshot e output degli strumenti.
sidebar:
  order: 7
  label: Archiviazione blob e artifact
i18n:
  sourceHash: 70d255f48d5b
  translator: machine
---

# Architettura di archiviazione blob e artifact

Questo documento descrive come coding-agent archivia payload binari/di grandi dimensioni al di fuori del JSONL di sessione, come vengono persistiti gli output troncati degli strumenti e come gli URL interni (`artifact://`, `agent://`) vengono risolti nei dati archiviati.

## Perché esistono due sistemi di archiviazione

Il runtime utilizza due meccanismi di persistenza differenti per forme di dati diverse:

- **Blob con indirizzamento basato sul contenuto** (`blob:sha256:<hash>`): archiviazione globale, orientata al binario, usata per esternalizzare grandi payload base64 di immagini dalle entry di sessione persistite.
- **Artifact con ambito di sessione** (file sotto `<sessionFile-without-.jsonl>/`): file di testo per sessione usati per gli output completi degli strumenti e gli output dei sotto-agenti.

Sono intenzionalmente separati:

- l'archiviazione blob ottimizza la deduplicazione e i riferimenti stabili tramite hash del contenuto,
- l'archiviazione artifact ottimizza gli strumenti di sessione in modalità append-only e il recupero da parte di umani/strumenti tramite ID locali.

## Confini di archiviazione e layout su disco

## Confine del blob store (globale)

`SessionManager` costruisce `BlobStore(getBlobsDir())`, quindi i file blob risiedono in una directory blob condivisa globale (non in una cartella di sessione).

Denominazione dei file blob:

- percorso del file: `<blobsDir>/<sha256-hex>`
- nessuna estensione
- stringa di riferimento memorizzata nelle entry: `blob:sha256:<sha256-hex>`

Implicazioni:

- lo stesso contenuto binario tra sessioni diverse si risolve nello stesso hash/percorso,
- le scritture sono idempotenti a livello di contenuto,
- i blob possono sopravvivere a qualsiasi singolo file di sessione.

## Confine degli artifact (locale alla sessione)

`ArtifactManager` deriva la directory degli artifact dal percorso del file di sessione:

- file di sessione: `.../<timestamp>_<sessionId>.jsonl`
- directory degli artifact: `.../<timestamp>_<sessionId>/` (rimuovendo `.jsonl`)

I tipi di artifact condividono questa directory:

- file di output troncati degli strumenti: `<numericId>.<toolType>.log` (per `artifact://`)
- file di output dei sotto-agenti: `<outputId>.md` (per `agent://`)

## Schemi di allocazione degli ID e dei nomi

## ID blob: hash del contenuto

`BlobStore.put()` calcola SHA-256 sui byte binari grezzi e restituisce:

- `hash`: digest esadecimale,
- `path`: `<blobsDir>/<hash>`,
- `ref`: `blob:sha256:<hash>`.

Non viene utilizzato alcun contatore locale alla sessione.

## ID artifact: intero monotono locale alla sessione

`ArtifactManager` scansiona i file artifact `*.log` esistenti al primo utilizzo per trovare l'ID numerico massimo esistente e imposta `nextId = max + 1`.

Comportamento di allocazione:

- formato del file: `{id}.{toolType}.log`
- gli ID sono stringhe sequenziali (`"0"`, `"1"`, ...)
- il ripristino non sovrascrive gli artifact esistenti perché la scansione avviene prima dell'allocazione.

Se la directory degli artifact è mancante, la scansione restituisce una lista vuota e l'allocazione inizia da `0`.

## ID output agente (`agent://`)

`AgentOutputManager` alloca gli ID per gli output dei sotto-agenti come `<index>-<requestedId>` (opzionalmente annidati sotto un prefisso genitore, ad es. `0-Parent.1-Child`). Scansiona i file `.md` esistenti durante l'inizializzazione per continuare dall'indice successivo al ripristino.

## Flusso dei dati di persistenza

## 1) Percorso di riscrittura della persistenza delle entry di sessione

Prima che le entry di sessione vengano scritte (`#rewriteFile` / persist incrementale), `SessionManager` chiama `prepareEntryForPersistence()` (tramite `truncateForPersistence`).

Comportamenti chiave:

1. **Troncamento di stringhe grandi**: le stringhe sovradimensionate vengono tagliate e suffissate con `"[Session persistence truncated large content]"`.
2. **Rimozione dei campi transienti**: `partialJson` e `jsonlEvents` vengono rimossi dalle entry persistite.
3. **Esternalizzazione delle immagini nei blob**:
   - si applica solo ai blocchi immagine negli array `content`,
   - solo quando `data` non è già un riferimento blob,
   - solo quando la lunghezza base64 è almeno la soglia (`BLOB_EXTERNALIZE_THRESHOLD = 1024`),
   - sostituisce il base64 inline con `blob:sha256:<hash>`.

Questo mantiene il JSONL di sessione compatto preservando la recuperabilità.

## 2) Percorso di reidratazione al caricamento della sessione

All'apertura di una sessione (`setSessionFile`), dopo le migrazioni, `SessionManager` esegue `resolveBlobRefsInEntries()`.

Per ogni blocco immagine di message/custom-message con `blob:sha256:<hash>`:

- legge i byte del blob dal blob store,
- converte i byte nuovamente in base64,
- modifica l'entry in memoria per inserire il base64 inline per i consumatori runtime.

Se il blob è mancante:

- `resolveImageData()` registra un avviso,
- restituisce la stringa di riferimento originale invariata,
- il caricamento continua (nessun crash critico).

## 3) Percorso di spill/troncamento dell'output degli strumenti

`OutputSink` gestisce l'output in streaming in bash/python/ssh e negli executor correlati.

Comportamento:

1. Ogni chunk viene sanitizzato e aggiunto al buffer tail in memoria.
2. Quando i byte in memoria superano la soglia di spill (`DEFAULT_MAX_BYTES`, 50KB), il sink contrassegna l'output come troncato.
3. Se è disponibile un percorso artifact, il sink apre un writer su file e scrive:
   - il contenuto bufferizzato esistente una volta,
   - tutti i chunk successivi.
4. Il buffer in memoria viene sempre ridotto alla finestra tail per la visualizzazione.
5. `dump()` restituisce un riepilogo che include `artifactId` solo quando il file sink è stato creato con successo.

Effetto pratico:

- l'UI/il ritorno dello strumento mostra la coda troncata,
- l'output completo è preservato nel file artifact e referenziato come `artifact://<id>`.

Se la creazione del file sink fallisce (errore I/O, percorso mancante, ecc.), il sink passa silenziosamente al solo troncamento in memoria; l'output completo non viene persistito.

## Modello di accesso agli URL

## Riferimenti `blob:`

`blob:sha256:<hash>` è un riferimento di persistenza all'interno dei payload delle entry di sessione, non uno schema URL interno gestito dal router. La risoluzione viene effettuata da `SessionManager` durante il caricamento della sessione.

## `artifact://<id>`

Gestito da `ArtifactProtocolHandler`:

- richiede una directory artifact di sessione attiva,
- l'ID deve essere numerico,
- risolve cercando un filename con prefisso `<id>.`,
- restituisce testo grezzo (`text/plain`) dal file `.log` corrispondente,
- quando mancante, l'errore include l'elenco degli ID artifact disponibili.

Comportamento con directory mancante:

- se la directory degli artifact non esiste, lancia `No artifacts directory found`.

## `agent://<id>`

Gestito da `AgentProtocolHandler` su `<artifactsDir>/<id>.md`:

- la forma semplice restituisce testo markdown,
- le forme `/path` o `?q=` eseguono l'estrazione JSON,
- l'estrazione per percorso e per query non possono essere combinate,
- se viene richiesta l'estrazione, il contenuto del file deve essere parsabile come JSON.

Comportamento con directory mancante:

- lancia `No artifacts directory found`.

Comportamento con output mancante:

- lancia `Not found: <id>` con gli ID disponibili dai file `.md` esistenti.

Integrazione con lo strumento read:

- `read` supporta la paginazione offset/limit per le letture di URL interni senza estrazione,
- rifiuta `offset/limit` quando viene utilizzata l'estrazione `agent://`.

## Semantica di ripristino, fork e spostamento

## Ripristino

- `ArtifactManager` scansiona i file `{id}.*.log` esistenti alla prima allocazione e continua la numerazione.
- `AgentOutputManager` scansiona gli ID di output `.md` esistenti e continua la numerazione.
- `SessionManager` reidrata i riferimenti blob in base64 al caricamento.

## Fork

`SessionManager.fork()` crea un nuovo file di sessione con nuovo ID di sessione e collegamento `parentSession`, quindi restituisce i percorsi dei file vecchio/nuovo. La copia degli artifact è gestita da `AgentSession.fork()`:

- tenta la copia ricorsiva della vecchia directory artifact nella nuova directory artifact,
- la mancanza della vecchia directory è tollerata,
- gli errori di copia diversi da ENOENT vengono registrati come avvisi e il fork viene comunque completato.

Implicazioni sugli ID dopo il fork:

- se la copia è riuscita, i contatori degli artifact nella nuova sessione continuano dopo l'ID massimo copiato,
- se la copia è fallita/saltata, gli ID artifact della nuova sessione partono da `0`.

Implicazioni sui blob dopo il fork:

- i blob sono globali e con indirizzamento basato sul contenuto, quindi non è necessaria alcuna copia della directory blob.

## Spostamento verso un nuovo cwd

`SessionManager.moveTo()` rinomina sia il file di sessione che la directory artifact nella nuova directory di sessione predefinita, con logica di rollback se un passaggio successivo fallisce. Questo preserva l'identità degli artifact mentre si riposiziona l'ambito della sessione.

## Gestione degli errori e percorsi di fallback

| Caso | Comportamento |
| --- | --- |
| File blob mancante durante la reidratazione | Avviso e mantenimento della stringa di riferimento `blob:sha256:` in memoria |
| Blob read ENOENT tramite `BlobStore.get` | Restituisce `null` |
| Directory artifact mancante (`ArtifactManager.listFiles`) | Restituisce lista vuota (l'allocazione può iniziare da zero) |
| Directory artifact mancante (`artifact://` / `agent://`) | Lancia esplicitamente `No artifacts directory found` |
| ID artifact non trovato | Lancia con elenco degli ID disponibili |
| Inizializzazione del writer artifact di OutputSink fallita | Continua con il solo troncamento tail (nessun artifact con output completo) |
| Nessun file di sessione (alcuni percorsi task) | Lo strumento task ricorre a una directory artifact temporanea per gli output dei sotto-agenti |

## Esternalizzazione blob binari vs artifact di output testuale

- L'**esternalizzazione blob** è per i payload di immagini binarie all'interno del contenuto delle entry di sessione persistite; sostituisce il base64 inline nel JSONL con riferimenti stabili al contenuto.
- Gli **artifact** sono file di testo semplice per l'output dell'esecuzione e l'output dei sotto-agenti; sono indirizzabili tramite ID locali alla sessione attraverso URL interni.

I due sistemi si intersecano solo indirettamente (entrambi riducono il gonfiamento del JSONL di sessione) ma hanno percorsi di identità, durata e recupero differenti.

## File di implementazione

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — formato dei riferimenti blob, hashing, put/get, helper di esternalizzazione/risoluzione.
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — modello della directory artifact di sessione e allocazione degli ID artifact numerici.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — comportamento di troncamento/spill-to-file di `OutputSink` e metadati di riepilogo.
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — trasformazioni di persistenza, reidratazione blob al caricamento, interazioni fork/spostamento della sessione.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — copia della directory artifact durante il fork interattivo.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — bootstrap dell'artifact manager degli strumenti e allocazione del percorso artifact per strumento.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — resolver `artifact://`.
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — resolver `agent://` + estrazione JSON.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — cablaggio del router URL interni e resolver della directory artifact.
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — allocazione degli ID di output agente con ambito di sessione per `agent://`.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — scritture artifact di output dei sotto-agenti (`<id>.md`) e fallback alla directory artifact temporanea.
