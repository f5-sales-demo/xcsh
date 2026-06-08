---
title: Architettura dello storage di blob e artefatti
description: >-
  Content-addressable blob store e registro degli artefatti per media di
  sessione, screenshot e output degli strumenti.
sidebar:
  order: 7
  label: Storage blob e artefatti
i18n:
  sourceHash: 70d255f48d5b
  translator: machine
---

# Architettura dello storage di blob e artefatti

Questo documento descrive come coding-agent archivia payload grandi/binari al di fuori del JSONL di sessione, come viene persistito l'output troncato degli strumenti e come gli URL interni (`artifact://`, `agent://`) vengono risolti ai dati archiviati.

## Perché esistono due sistemi di storage

Il runtime utilizza due meccanismi di persistenza diversi per forme di dati differenti:

- **Blob content-addressed** (`blob:sha256:<hash>`): storage globale, orientato al binario, utilizzato per esternalizzare payload base64 di immagini di grandi dimensioni dalle entry di sessione persistite.
- **Artefatti con ambito di sessione** (file sotto `<sessionFile-without-.jsonl>/`): file di testo per sessione utilizzati per gli output completi degli strumenti e gli output dei subagent.

Sono intenzionalmente separati:

- lo storage blob ottimizza la deduplicazione e i riferimenti stabili tramite hash del contenuto,
- lo storage degli artefatti ottimizza gli strumenti append-only di sessione e il recupero da parte di umani/strumenti tramite ID locali.

## Confini dello storage e layout su disco

## Confine del blob store (globale)

`SessionManager` costruisce `BlobStore(getBlobsDir())`, quindi i file blob risiedono in una directory blob globale condivisa (non in una cartella di sessione).

Nomenclatura dei file blob:

- percorso file: `<blobsDir>/<sha256-hex>`
- nessuna estensione
- stringa di riferimento archiviata nelle entry: `blob:sha256:<sha256-hex>`

Implicazioni:

- lo stesso contenuto binario tra sessioni diverse si risolve nello stesso hash/percorso,
- le scritture sono idempotenti a livello di contenuto,
- i blob possono sopravvivere a qualsiasi singolo file di sessione.

## Confine degli artefatti (locale alla sessione)

`ArtifactManager` deriva la directory degli artefatti dal percorso del file di sessione:

- file di sessione: `.../<timestamp>_<sessionId>.jsonl`
- directory degli artefatti: `.../<timestamp>_<sessionId>/` (rimozione di `.jsonl`)

I tipi di artefatto condividono questa directory:

- file di output troncato degli strumenti: `<numericId>.<toolType>.log` (per `artifact://`)
- file di output dei subagent: `<outputId>.md` (per `agent://`)

## Schemi di allocazione di ID e nomi

## ID dei blob: hash del contenuto

`BlobStore.put()` calcola SHA-256 sui byte binari grezzi e restituisce:

- `hash`: digest esadecimale,
- `path`: `<blobsDir>/<hash>`,
- `ref`: `blob:sha256:<hash>`.

Non viene utilizzato alcun contatore locale alla sessione.

## ID degli artefatti: intero monotonico locale alla sessione

`ArtifactManager` scansiona i file artefatto `*.log` esistenti al primo utilizzo per trovare l'ID numerico massimo esistente e imposta `nextId = max + 1`.

Comportamento di allocazione:

- formato file: `{id}.{toolType}.log`
- gli ID sono stringhe sequenziali (`"0"`, `"1"`, ...)
- il ripristino non sovrascrive gli artefatti esistenti perché la scansione avviene prima dell'allocazione.

Se la directory degli artefatti è mancante, la scansione restituisce una lista vuota e l'allocazione parte da `0`.

## ID degli output dell'agente (`agent://`)

`AgentOutputManager` alloca gli ID per gli output dei subagent come `<index>-<requestedId>` (opzionalmente annidati sotto un prefisso genitore, ad es. `0-Parent.1-Child`). Scansiona i file `.md` esistenti all'inizializzazione per continuare dall'indice successivo al ripristino.

## Flusso dati di persistenza

## 1) Percorso di riscrittura della persistenza delle entry di sessione

Prima che le entry di sessione vengano scritte (`#rewriteFile` / persistenza incrementale), `SessionManager` chiama `prepareEntryForPersistence()` (tramite `truncateForPersistence`).

Comportamenti chiave:

1. **Troncamento di stringhe grandi**: le stringhe sovradimensionate vengono tagliate e suffisse con `"[Session persistence truncated large content]"`.
2. **Rimozione dei campi transienti**: `partialJson` e `jsonlEvents` vengono rimossi dalle entry persistite.
3. **Esternalizzazione delle immagini in blob**:
   - si applica solo ai blocchi immagine negli array `content`,
   - solo quando `data` non è già un riferimento blob,
   - solo quando la lunghezza del base64 è almeno pari alla soglia (`BLOB_EXTERNALIZE_THRESHOLD = 1024`),
   - sostituisce il base64 inline con `blob:sha256:<hash>`.

Questo mantiene il JSONL di sessione compatto preservando la recuperabilità.

## 2) Percorso di reidratazione al caricamento della sessione

Quando si apre una sessione (`setSessionFile`), dopo le migrazioni, `SessionManager` esegue `resolveBlobRefsInEntries()`.

Per ogni blocco immagine di messaggio/messaggio-personalizzato con `blob:sha256:<hash>`:

- legge i byte del blob dal blob store,
- converte i byte in base64,
- modifica l'entry in memoria per inserire il base64 inline per i consumatori runtime.

Se il blob è mancante:

- `resolveImageData()` registra un warning,
- restituisce la stringa di riferimento originale invariata,
- il caricamento continua (nessun crash critico).

## 3) Percorso di riversamento/troncamento dell'output degli strumenti

`OutputSink` gestisce l'output in streaming nei tool bash/python/ssh e negli executor correlati.

Comportamento:

1. Ogni chunk viene sanitizzato e aggiunto al buffer tail in memoria.
2. Quando i byte in memoria superano la soglia di riversamento (`DEFAULT_MAX_BYTES`, 50KB), il sink segna l'output come troncato.
3. Se è disponibile un percorso artefatto, il sink apre un file writer e scrive:
   - il contenuto bufferizzato esistente una sola volta,
   - tutti i chunk successivi.
4. Il buffer in memoria viene sempre ridotto alla finestra tail per la visualizzazione.
5. `dump()` restituisce un riepilogo che include `artifactId` solo quando il file sink è stato creato con successo.

Effetto pratico:

- l'UI/il ritorno dello strumento mostra il tail troncato,
- l'output completo è preservato nel file artefatto e referenziato come `artifact://<id>`.

Se la creazione del file sink fallisce (errore I/O, percorso mancante, ecc.), il sink ricade silenziosamente al solo troncamento in memoria; l'output completo non viene persistito.

## Modello di accesso agli URL

## Riferimenti `blob:`

`blob:sha256:<hash>` è un riferimento di persistenza all'interno dei payload delle entry di sessione, non uno schema URL interno gestito dal router. La risoluzione viene effettuata da `SessionManager` durante il caricamento della sessione.

## `artifact://<id>`

Gestito da `ArtifactProtocolHandler`:

- richiede una directory artefatti di sessione attiva,
- l'ID deve essere numerico,
- risolve cercando una corrispondenza con il prefisso del nome file `<id>.`,
- restituisce testo grezzo (`text/plain`) dal file `.log` corrispondente,
- quando mancante, l'errore include la lista degli ID artefatto disponibili.

Comportamento con directory mancante:

- se la directory degli artefatti non esiste, lancia `No artifacts directory found`.

## `agent://<id>`

Gestito da `AgentProtocolHandler` su `<artifactsDir>/<id>.md`:

- nella forma semplice restituisce testo markdown,
- le forme `/path` o `?q=` eseguono estrazione JSON,
- l'estrazione per percorso e per query non possono essere combinate,
- se viene richiesta l'estrazione, il contenuto del file deve essere parsabile come JSON.

Comportamento con directory mancante:

- lancia `No artifacts directory found`.

Comportamento con output mancante:

- lancia `Not found: <id>` con gli ID disponibili dai file `.md` esistenti.

Integrazione con lo strumento read:

- `read` supporta la paginazione offset/limit per le letture di URL interni senza estrazione,
- rifiuta `offset/limit` quando viene utilizzata l'estrazione con `agent://`.

## Semantica di ripristino, fork e spostamento

## Ripristino

- `ArtifactManager` scansiona i file `{id}.*.log` esistenti alla prima allocazione e continua la numerazione.
- `AgentOutputManager` scansiona gli ID di output `.md` esistenti e continua la numerazione.
- `SessionManager` reidrata i riferimenti blob in base64 al caricamento.

## Fork

`SessionManager.fork()` crea un nuovo file di sessione con un nuovo ID di sessione e un collegamento `parentSession`, quindi restituisce i percorsi file vecchio/nuovo. La copia degli artefatti è gestita da `AgentSession.fork()`:

- tenta la copia ricorsiva della vecchia directory artefatti nella nuova directory artefatti,
- la mancanza della vecchia directory è tollerata,
- gli errori di copia diversi da ENOENT vengono registrati come warning e il fork si completa comunque.

Implicazioni sugli ID dopo il fork:

- se la copia ha avuto successo, i contatori degli artefatti nella nuova sessione continuano dopo l'ID massimo copiato,
- se la copia è fallita/saltata, gli ID degli artefatti della nuova sessione partono da `0`.

Implicazioni sui blob dopo il fork:

- i blob sono globali e content-addressed, quindi non è necessaria alcuna copia della directory blob.

## Spostamento in una nuova cwd

`SessionManager.moveTo()` rinomina sia il file di sessione che la directory degli artefatti nella nuova directory di sessione predefinita, con logica di rollback se un passaggio successivo fallisce. Questo preserva l'identità degli artefatti mentre si riloca l'ambito della sessione.

## Gestione degli errori e percorsi di fallback

| Caso | Comportamento |
| --- | --- |
| File blob mancante durante la reidratazione | Warning e mantenimento della stringa di riferimento `blob:sha256:` in memoria |
| Blob read ENOENT tramite `BlobStore.get` | Restituisce `null` |
| Directory artefatti mancante (`ArtifactManager.listFiles`) | Restituisce lista vuota (l'allocazione può partire da zero) |
| Directory artefatti mancante (`artifact://` / `agent://`) | Lancia esplicitamente `No artifacts directory found` |
| ID artefatto non trovato | Lancia con elenco degli ID disponibili |
| Inizializzazione del writer artefatto di OutputSink fallita | Continua con il solo troncamento tail (nessun artefatto con output completo) |
| Nessun file di sessione (alcuni percorsi task) | Lo strumento task ricade su una directory artefatti temporanea per gli output dei subagent |

## Esternalizzazione blob binari vs artefatti di output testuale

- L'**esternalizzazione blob** è per payload di immagini binarie all'interno del contenuto delle entry di sessione persistite; sostituisce il base64 inline nel JSONL con riferimenti al contenuto stabili.
- Gli **artefatti** sono file di testo semplice per l'output di esecuzione e l'output dei subagent; sono indirizzabili tramite ID locali alla sessione attraverso URL interni.

I due sistemi si intersecano solo indirettamente (entrambi riducono il bloat del JSONL di sessione) ma hanno percorsi di identità, durata e recupero differenti.

## File di implementazione

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — formato dei riferimenti blob, hashing, put/get, helper per esternalizzazione/risoluzione.
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — modello della directory artefatti di sessione e allocazione degli ID artefatto numerici.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — comportamento di troncamento/riversamento su file di `OutputSink` e metadati di riepilogo.
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — trasformazioni di persistenza, reidratazione blob al caricamento, interazioni fork/spostamento di sessione.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — copia della directory artefatti durante il fork interattivo.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — bootstrap dell'artifact manager degli strumenti e allocazione del percorso artefatto per strumento.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — resolver `artifact://`.
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — resolver `agent://` + estrazione JSON.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — cablaggio del router URL interni e resolver della directory artefatti.
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — allocazione degli ID di output dell'agente con ambito di sessione per `agent://`.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — scritture degli artefatti di output dei subagent (`<id>.md`) e fallback su directory artefatti temporanea.
