---
title: 'Operazioni di sessione: Esportazione, Dump, Condivisione, Fork, Ripresa'
description: >-
  Operazioni di sessione per l'esportazione, la condivisione, il fork e la
  ripresa delle conversazioni.
sidebar:
  order: 3
  label: Operazioni
i18n:
  sourceHash: e3c210b29c3e
  translator: machine
---

# Operazioni di sessione: export, dump, share, fork, resume/continue

Questo documento descrive il comportamento visibile agli operatori per le operazioni di esportazione/condivisione/fork/ripresa della sessione, così come attualmente implementate.

## File di implementazione

- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/export/html/index.ts`](../../packages/coding-agent/src/export/html/index.ts)
- [`../src/export/custom-share.ts`](../../packages/coding-agent/src/export/custom-share.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)

## Matrice delle operazioni

| Operazione | Percorso di accesso | Mutazione sessione | Creazione/cambio file sessione | Artefatto di output |
|---|---|---|---|---|
| `/dump` | Comando slash interattivo | No | No | Testo negli appunti |
| `/export [path]` | Comando slash interattivo | No | No | File HTML |
| `--export <session.jsonl> [outputPath]` | Percorso rapido di avvio CLI | Nessuna mutazione della sessione runtime | Nessuna sessione attiva; legge il file di destinazione | File HTML |
| `/share` | Comando slash interattivo | No | No | HTML temporaneo + URL di condivisione/gist |
| `/fork` | Comando slash interattivo | Sì (l'identità della sessione attiva cambia) | Crea un nuovo file di sessione e passa la sessione corrente a esso (solo modalità persistente) | Copia la directory degli artefatti nel nuovo namespace di sessione, se presente |
| `/resume` | Comando slash interattivo | Sì (lo stato in-memory attivo viene sostituito) | Passa al file di sessione esistente selezionato | Nessuno |
| `--resume` | Avvio CLI (selettore) | Sì dopo la creazione della sessione | Apre il file di sessione esistente selezionato | Nessuno |
| `--resume <id\|path>` | Avvio CLI | Sì dopo la creazione della sessione | Apre una sessione esistente; il caso cross-project può eseguire il fork nel progetto corrente | Nessuno |
| `--continue` | Avvio CLI | Sì dopo la creazione della sessione | Apre il breadcrumb del terminale o la sessione più recente; ne crea una nuova se non ne esiste alcuna | Nessuno |

## Esportazione e dump

### `/export [outputPath]` (interattivo)

Flusso:

1. `InputController` instrada `/export...` verso `CommandController.handleExportCommand`.
2. Il comando divide il testo in base agli spazi bianchi e utilizza solo il primo argomento dopo `/export` come `outputPath`.
3. `AgentSession.exportToHtml()` chiama `exportSessionToHtml(sessionManager, state, { outputPath, themeName })`.
4. In caso di successo, l'interfaccia utente mostra il percorso e apre il file nel browser.

Dettagli di comportamento:

- Gli argomenti `--copy`, `clipboard` e `copy` vengono esplicitamente rifiutati con un avviso che invita a usare `/dump`.
- L'esportazione incorpora l'intestazione della sessione/le voci/il nodo foglia, oltre al `systemPrompt` corrente e le descrizioni degli strumenti dallo stato dell'agente.
- Nessuna voce di sessione viene aggiunta durante l'esportazione.

Avvertenza:

- L'analisi degli argomenti è basata sugli spazi bianchi (`text.split(/\s+/)`), pertanto i percorsi tra virgolette contenenti spazi non vengono preservati come un singolo percorso in questo percorso di comando.

### `--export <inputSessionFile> [outputPath]` (CLI)

Flusso in `main.ts`:

1. Gestito in anticipo (prima dell'avvio interattivo/della sessione).
2. Chiama `exportFromFile(inputPath, outputPath?)`.
3. `SessionManager.open(inputPath)` carica le voci, quindi l'HTML viene generato e scritto.
4. Il processo stampa `Exported to: ...` e termina.

Dettagli di comportamento:

- Un file di input mancante viene segnalato come `File not found: <path>`.
- Questo percorso non crea un `AgentSession` e non muta alcuna sessione in esecuzione.

### `/dump` (esportazione interattiva negli appunti)

Flusso:

1. `CommandController.handleDumpCommand()` chiama `session.formatSessionAsText()`.
2. Se la stringa è vuota, riporta `No messages to dump yet.`
3. Altrimenti copia negli appunti tramite il `copyToClipboard` nativo.

Il contenuto del dump include:

- Prompt di sistema
- Modello attivo/livello di pensiero
- Definizioni degli strumenti e parametri
- Messaggi utente/assistente
- Blocchi di pensiero e chiamate agli strumenti
- Risultati degli strumenti e blocchi di esecuzione (ad eccezione delle voci bash/python con `excludeFromContext`)
- Voci personalizzate/hook/menzioni di file/riepilogo branch/riepilogo compattazione

Nessuna modifica alla persistenza della sessione viene apportata dal dump.

## Condivisione

`/share` è solo interattivo e inizia sempre esportando la sessione corrente in un file HTML temporaneo.

### Fase 1: esportazione temporanea

- Percorso del file temporaneo: `${os.tmpdir()}/${Snowflake.next()}.html`
- Utilizza `session.exportToHtml(tmpFile)`
- Se l'esportazione fallisce (in particolare per le sessioni in-memory), la condivisione termina con un errore.

### Fase 2: gestore di condivisione personalizzato (se presente)

`loadCustomShare()` cerca in `~/.xcsh/agent` il primo file candidato esistente:

- `share.ts`
- `share.js`
- `share.mjs`

Requisiti:

- Il modulo deve esportare come default una funzione `(htmlPath) => Promise<CustomShareResult | string | undefined>`.

Se presente e valido:

- L'interfaccia utente entra nello stato di caricamento `Sharing...`.
- Interpretazione del risultato del gestore:
  - stringa => trattata come URL, mostrata e aperta
  - oggetto => `url` e/o `message` mostrati; `url` aperto
  - `undefined`/falsy => generico `Session shared`
- Il file temporaneo viene rimosso al termine.

Comportamento di fallback critico:

- Se il gestore personalizzato esiste ma il caricamento fallisce, il comando restituisce un errore e termina.
- Se il gestore personalizzato viene eseguito e genera un'eccezione, il comando restituisce un errore e termina.
- In entrambi i casi di errore, **non** viene eseguito il fallback al gist di GitHub.
- Il fallback al gist avviene solo quando non esiste alcuno script di condivisione personalizzato.

### Fase 3: fallback predefinito al gist

Solo quando non viene trovato alcun gestore di condivisione personalizzato:

1. Valida `gh auth status`.
2. Mostra il caricamento `Creating gist...`.
3. Esegue `gh gist create --public=false <tmpFile>`.
4. Analizza l'URL del gist, ricava l'id del gist, costruisce l'URL di anteprima `https://gistpreview.github.io/?<id>`.
5. Mostra sia l'URL di anteprima sia quello del gist; apre l'anteprima.

Semantica di annullamento/interruzione nella condivisione:

- Il caricamento dispone di un hook `onAbort` che ripristina l'interfaccia dell'editor e segnala `Share cancelled`.
- Il comando sottostante `gh gist create` non riceve un segnale di interruzione in questo percorso di codice; l'annullamento è a livello di interfaccia utente e viene verificato dopo la restituzione del comando.

## Fork

`/fork` crea una nuova sessione a partire da quella corrente e cambia l'identità della sessione attiva.

### Precondizioni e controlli immediati

- Se l'agente è in streaming, `/fork` viene rifiutato con un avviso.
- Gli indicatori di stato/caricamento dell'interfaccia utente vengono azzerati prima dell'operazione.

### Flusso a livello di sessione

`AgentSession.fork()`:

1. Emette `session_before_switch` con `reason: "fork"` (annullabile).
2. Scarica le scritture in sospeso.
3. Chiama `SessionManager.fork()`.
4. Copia la directory degli artefatti dal vecchio namespace di sessione al nuovo (best-effort; i fallimenti di copia non ENOENT vengono registrati, non sono fatali).
5. Aggiorna `agent.sessionId`.
6. Emette `session_switch` con `reason: "fork"`.

Comportamento di `SessionManager.fork()`:

- Richiede la modalità persistente e un file di sessione esistente.
- Crea un nuovo id di sessione e un nuovo percorso per il file JSONL.
- Riscrive l'intestazione con:
  - nuovo `id`
  - nuovo timestamp
  - `cwd` invariato
  - `parentSession` impostato all'id della sessione precedente
- Mantiene inalterate tutte le voci non di intestazione nel nuovo file.

### Comportamento non persistente

- Il gestore di sessione in-memory restituisce `undefined` da `fork()`.
- `AgentSession.fork()` restituisce `false`.
- L'interfaccia utente segnala `Fork failed (session not persisted or cancelled)`.

## Ripresa e continuazione

## `/resume` interattivo

Flusso:

1. Apre il selettore di sessione popolato tramite `SessionManager.list(currentCwd, currentSessionDir)`.
2. Alla selezione, `SelectorController.handleResumeSession(sessionPath)` chiama `session.switchSession(sessionPath)`.
3. L'interfaccia utente azzera/ricostruisce la chat e i todos, quindi segnala `Resumed session`.

Note:

- Questo selettore elenca solo le sessioni nell'ambito della directory di sessione corrente.
- Non utilizza la ricerca globale cross-project.

## CLI `--resume`

### `--resume` (senza valore)

- `main.ts` elenca le sessioni per il cwd/sessionDir corrente e apre il selettore.
- Il percorso selezionato viene aperto con `SessionManager.open(selectedPath)` prima della creazione della sessione.

### `--resume <value>`

Ordine di risoluzione in `createSessionManager()`:

1. Se il valore assomiglia a un percorso (`/`, `\`, o `.jsonl`), aprirlo direttamente.
2. Altrimenti trattarlo come prefisso id:
   - ricerca nell'ambito corrente (`SessionManager.list(cwd, sessionDir)`)
   - se non trovato e nessun `sessionDir` esplicito, ricerca globale (`SessionManager.listAll()`)

Comportamento in caso di corrispondenza id cross-project:

- Se il cwd della sessione trovata differisce dal cwd corrente, la CLI chiede:
  - `Session found in different project ... Fork into current directory? [y/N]`
- In caso affermativo: `SessionManager.forkFrom(match.path, cwd, sessionDir)` crea un nuovo file locale con fork.
- In caso negativo/default non-TTY: il comando restituisce un errore.

## CLI `--continue`

`SessionManager.continueRecent(cwd, sessionDir)`:

1. Risolve la directory di sessione per il cwd corrente.
2. Legge prima il breadcrumb con scope di terminale.
3. Come fallback, utilizza il file di sessione modificato più di recente.
4. Apre la sessione trovata; se non ne esiste nessuna, ne crea una nuova.

Questo è un comportamento solo di avvio; non esiste un comando slash interattivo `/continue`.

## Come il cambio di sessione muta effettivamente lo stato runtime

`AgentSession.switchSession(sessionPath)` esegue la transizione runtime utilizzata dalle operazioni simili alla ripresa:

1. Emette `session_before_switch` con `reason: "resume"` e `targetSessionFile` (annullabile).
2. Disconnette la sottoscrizione agli eventi dell'agente e interrompe il lavoro in corso.
3. Azzera i messaggi di steering/follow-up/next-turn in coda.
4. Scarica le scritture della sessione corrente.
5. `sessionManager.setSessionFile(sessionPath)` e aggiorna `agent.sessionId`.
6. Costruisce il contesto di sessione dalle voci caricate.
7. Emette `session_switch` con `reason: "resume"`.
8. Sostituisce i messaggi dell'agente dal contesto.
9. Ripristina il modello (se disponibile nel registro corrente).
10. Ripristina o inizializza il livello di pensiero.
11. Riconnette la sottoscrizione agli eventi dell'agente.

Nessun nuovo file di sessione viene creato da `switchSession()` stesso.

## Emissione di eventi e punti di annullamento

### Hook del ciclo di vita switch/fork

Per `newSession`, `fork` e `switchSession`:

- Evento prima: `session_before_switch`
  - ragioni: `new`, `fork`, `resume`
  - annullabile restituendo `{ cancel: true }`
- Evento dopo: `session_switch`
  - stesso insieme di ragioni
  - include `previousSessionFile`

`ExtensionRunner.emit()` restituisce anticipatamente al primo risultato dell'evento before che annulla.

### Comportamento `onSession` degli strumenti personalizzati

L'SDK collega gli eventi di sessione dell'estensione ai callback `onSession` degli strumenti personalizzati:

- `session_switch` -> `onSession({ reason: "switch", previousSessionFile })`
- `session_branch` -> `reason: "branch"`
- `session_start` -> `reason: "start"`
- `session_tree` -> `reason: "tree"`
- `session_shutdown` -> `reason: "shutdown"`

Questi callback sono osservativi; non annullano lo switch/fork.

### Altre superfici di annullamento rilevanti per questo documento

- `/fork` è bloccato durante lo streaming (l'utente deve attendere/interrompere la risposta corrente prima).
- Il selettore `/resume` può essere annullato dall'utente chiudendo il selettore.
- `--resume <id>` cross-project può essere annullato rifiutando il prompt di fork.
- `/share` dispone di un percorso di interruzione dell'interfaccia utente (`Share cancelled`) per il flusso gist; non implementa la semantica di terminazione del processo per `gh gist create` in questo percorso di codice.

## Comportamento della sessione non persistente (in-memory)

Quando il gestore di sessione viene creato con `SessionManager.inMemory()` (`--no-session`):

- Il percorso del file di sessione è assente.
- `/export` e `/share` falliscono con `Cannot export in-memory session to HTML` (propagato all'interfaccia utente degli errori del comando).
- `/fork` fallisce perché `SessionManager.fork()` richiede la persistenza.
- `/dump` funziona ancora perché serializza lo stato in-memory dell'agente.
- Le semantiche di ripresa/continuazione CLI vengono bypassate se è impostato `--no-session`, perché la creazione del gestore restituisce immediatamente in-memory.

## Avvertenze di implementazione note (al codice corrente)

- `SelectorController.handleResumeSession()` non controlla il risultato booleano di `session.switchSession(...)`; un cambio annullato da un hook può comunque procedere attraverso il percorso di ridisegno/stato dell'interfaccia utente "Resumed session".
- I fallimenti di condivisione personalizzata di `/share` non degradano al fallback gist predefinito; terminano il comando con errore.
- La tokenizzazione degli argomenti di `/export` è semplicistica e non preserva i percorsi tra virgolette contenenti spazi.
