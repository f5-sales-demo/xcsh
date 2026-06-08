---
title: 'Operazioni sulle sessioni: Export, Dump, Share, Fork, Resume'
description: >-
  Operazioni sulle sessioni per esportare, condividere, biforcare e riprendere
  conversazioni.
sidebar:
  order: 3
  label: Operations
i18n:
  sourceHash: e3c210b29c3e
  translator: machine
---

# Operazioni sulle sessioni: export, dump, share, fork, resume/continue

Questo documento descrive il comportamento visibile all'operatore per le operazioni di export/share/fork/resume delle sessioni come attualmente implementate.

## File di implementazione

- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/export/html/index.ts`](../../packages/coding-agent/src/export/html/index.ts)
- [`../src/export/custom-share.ts`](../../packages/coding-agent/src/export/custom-share.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)

## Matrice delle operazioni

| Operazione | Percorso di ingresso | Mutazione della sessione | Creazione/cambio file di sessione | Artefatto di output |
|---|---|---|---|---|
| `/dump` | Comando slash interattivo | No | No | Testo negli appunti |
| `/export [path]` | Comando slash interattivo | No | No | File HTML |
| `--export <session.jsonl> [outputPath]` | Percorso rapido all'avvio CLI | Nessuna mutazione della sessione a runtime | Nessuna sessione attiva; legge il file di destinazione | File HTML |
| `/share` | Comando slash interattivo | No | No | HTML temporaneo + URL di condivisione/gist |
| `/fork` | Comando slash interattivo | Sì (l'identità della sessione attiva cambia) | Crea un nuovo file di sessione e commuta la sessione corrente ad esso (solo in modalità persistente) | Copia la directory degli artefatti nel nuovo namespace della sessione quando presente |
| `/resume` | Comando slash interattivo | Sì (lo stato attivo in memoria viene sostituito) | Commuta al file di sessione esistente selezionato | Nessuno |
| `--resume` | Avvio CLI (selettore) | Sì dopo la creazione della sessione | Apre il file di sessione esistente selezionato | Nessuno |
| `--resume <id\|path>` | Avvio CLI | Sì dopo la creazione della sessione | Apre la sessione esistente; il caso cross-progetto può biforcare nel progetto corrente | Nessuno |
| `--continue` | Avvio CLI | Sì dopo la creazione della sessione | Apre il breadcrumb del terminale o la sessione più recente; ne crea una nuova se non ne esiste alcuna | Nessuno |

## Export e dump

### `/export [outputPath]` (interattivo)

Flusso:

1. `InputController` instrada `/export...` a `CommandController.handleExportCommand`.
2. Il comando divide sugli spazi bianchi e usa solo il primo argomento dopo `/export` come `outputPath`.
3. `AgentSession.exportToHtml()` chiama `exportSessionToHtml(sessionManager, state, { outputPath, themeName })`.
4. In caso di successo, l'interfaccia mostra il percorso e apre il file nel browser.

Dettagli di comportamento:

- Gli argomenti `--copy`, `clipboard` e `copy` vengono esplicitamente rifiutati con un avviso di usare `/dump`.
- L'export incorpora header/voci/foglia della sessione più il `systemPrompt` corrente e le descrizioni degli strumenti dallo stato dell'agente.
- Nessuna voce di sessione viene aggiunta durante l'export.

Avvertenza:

- L'analisi degli argomenti è basata sugli spazi bianchi (`text.split(/\s+/)`), quindi i percorsi tra virgolette con spazi non vengono preservati come un singolo percorso da questo percorso di comando.

### `--export <inputSessionFile> [outputPath]` (CLI)

Flusso in `main.ts`:

1. Gestito anticipatamente (prima dell'avvio interattivo/sessione).
2. Chiama `exportFromFile(inputPath, outputPath?)`.
3. `SessionManager.open(inputPath)` carica le voci, quindi l'HTML viene generato e scritto.
4. Il processo stampa `Exported to: ...` e termina.

Dettagli di comportamento:

- Un file di input mancante viene segnalato come `File not found: <path>`.
- Questo percorso non crea un `AgentSession` e non muta alcuna sessione in esecuzione.

### `/dump` (export interattivo negli appunti)

Flusso:

1. `CommandController.handleDumpCommand()` chiama `session.formatSessionAsText()`.
2. Se la stringa è vuota, riporta `No messages to dump yet.`
3. Altrimenti copia negli appunti tramite `copyToClipboard` nativo.

Il contenuto del dump include:

- Prompt di sistema
- Modello attivo/livello di ragionamento
- Definizioni degli strumenti + parametri
- Messaggi utente/assistente
- Blocchi di ragionamento e chiamate agli strumenti
- Risultati degli strumenti e blocchi di esecuzione (eccetto le voci bash/python `excludeFromContext`)
- Voci personalizzate/hook/menzione file/riepilogo branch/riepilogo compattazione

Nessuna modifica alla persistenza della sessione viene effettuata dal dump.

## Share

`/share` è solo interattivo e inizia sempre esportando la sessione corrente in un file HTML temporaneo.

### Fase 1: export temporaneo

- Percorso del file temporaneo: `${os.tmpdir()}/${Snowflake.next()}.html`
- Usa `session.exportToHtml(tmpFile)`
- Se l'export fallisce (in particolare per le sessioni in memoria), la condivisione termina con errore.

### Fase 2: gestore di condivisione personalizzato (se presente)

`loadCustomShare()` controlla `~/.xcsh/agent` per il primo candidato esistente:

- `share.ts`
- `share.js`
- `share.mjs`

Requisiti:

- Il modulo deve esportare come default una funzione `(htmlPath) => Promise<CustomShareResult | string | undefined>`.

Se presente e valido:

- L'interfaccia entra nello stato di caricamento `Sharing...`.
- Interpretazione del risultato del gestore:
  - stringa => trattata come URL, mostrata e aperta
  - oggetto => `url` e/o `message` mostrati; `url` aperto
  - `undefined`/falsy => generico `Session shared`
- Il file temporaneo viene rimosso dopo il completamento.

Comportamento critico di fallback:

- Se il gestore personalizzato esiste ma il caricamento fallisce, il comando va in errore e ritorna.
- Se il gestore personalizzato viene eseguito e lancia un'eccezione, il comando va in errore e ritorna.
- In entrambi i casi di fallimento, **non** ricade sul gist di GitHub.
- Il fallback al gist avviene solo quando non esiste alcuno script di condivisione personalizzato.

### Fase 3: fallback predefinito al gist

Solo quando non viene trovato alcun gestore di condivisione personalizzato:

1. Valida `gh auth status`.
2. Mostra il caricamento `Creating gist...`.
3. Esegue `gh gist create --public=false <tmpFile>`.
4. Analizza l'URL del gist, deriva l'id del gist, costruisce l'URL di anteprima `https://gistpreview.github.io/?<id>`.
5. Mostra sia l'URL di anteprima che quello del gist; apre l'anteprima.

Semantica di cancellazione/interruzione nella condivisione:

- Il caricatore ha un hook `onAbort` che ripristina l'interfaccia dell'editor e riporta `Share cancelled`.
- Il comando sottostante `gh gist create` non riceve un segnale di interruzione in questo percorso di codice; la cancellazione è a livello di interfaccia e viene verificata dopo il ritorno del comando.

## Fork

`/fork` crea una nuova sessione a partire da quella corrente e commuta l'identità della sessione attiva.

### Precondizioni e guardie immediate

- Se l'agente è in streaming, `/fork` viene rifiutato con un avviso.
- Gli indicatori di stato/caricamento dell'interfaccia vengono cancellati prima dell'operazione.

### Flusso a livello di sessione

`AgentSession.fork()`:

1. Emette `session_before_switch` con `reason: "fork"` (cancellabile).
2. Scarica le scritture in sospeso.
3. Chiama `SessionManager.fork()`.
4. Copia la directory degli artefatti dal vecchio namespace della sessione al nuovo (best-effort; i fallimenti di copia diversi da ENOENT vengono registrati nel log, non sono fatali).
5. Aggiorna `agent.sessionId`.
6. Emette `session_switch` con `reason: "fork"`.

Comportamento di `SessionManager.fork()`:

- Richiede la modalità persistente e un file di sessione esistente.
- Crea un nuovo id di sessione e un nuovo percorso file JSONL.
- Riscrive l'header con:
  - nuovo `id`
  - nuovo timestamp
  - `cwd` invariato
  - `parentSession` impostato all'id della sessione precedente
- Mantiene tutte le voci non-header invariate nel nuovo file.

### Comportamento non persistente

- Il session manager in memoria restituisce `undefined` da `fork()`.
- `AgentSession.fork()` restituisce `false`.
- L'interfaccia riporta `Fork failed (session not persisted or cancelled)`.

## Resume e continue

## `/resume` interattivo

Flusso:

1. Apre il selettore di sessione popolato tramite `SessionManager.list(currentCwd, currentSessionDir)`.
2. Alla selezione, `SelectorController.handleResumeSession(sessionPath)` chiama `session.switchSession(sessionPath)`.
3. L'interfaccia cancella/ricostruisce la chat e i todo, poi riporta `Resumed session`.

Note:

- Questo selettore elenca solo le sessioni nell'ambito della directory di sessione corrente.
- Non utilizza la ricerca globale cross-progetto.

## CLI `--resume`

### `--resume` (senza valore)

- `main.ts` elenca le sessioni per il cwd/sessionDir corrente e apre il selettore.
- Il percorso selezionato viene aperto con `SessionManager.open(selectedPath)` prima della creazione della sessione.

### `--resume <value>`

Ordine di risoluzione di `createSessionManager()`:

1. Se il valore sembra un percorso (`/`, `\`, o `.jsonl`), apre direttamente.
2. Altrimenti tratta come prefisso id:
   - cerca nell'ambito corrente (`SessionManager.list(cwd, sessionDir)`)
   - se non trovato e nessun `sessionDir` esplicito, cerca globalmente (`SessionManager.listAll()`)

Comportamento di corrispondenza id cross-progetto:

- Se il cwd della sessione corrispondente differisce dal cwd corrente, la CLI chiede:
  - `Session found in different project ... Fork into current directory? [y/N]`
- In caso affermativo: `SessionManager.forkFrom(match.path, cwd, sessionDir)` crea un nuovo file locale biforcato.
- In caso negativo/default non-TTY: il comando va in errore.

## CLI `--continue`

`SessionManager.continueRecent(cwd, sessionDir)`:

1. Risolve la directory di sessione per il cwd corrente.
2. Legge prima il breadcrumb con ambito terminale.
3. Ricade sul file di sessione modificato più di recente.
4. Apre la sessione trovata; se non ne esiste alcuna, crea una nuova sessione.

Questo è un comportamento solo all'avvio; non esiste un comando slash interattivo `/continue`.

## Come il cambio di sessione muta effettivamente lo stato a runtime

`AgentSession.switchSession(sessionPath)` effettua la transizione a runtime utilizzata dalle operazioni di tipo resume:

1. Emette `session_before_switch` con `reason: "resume"` e `targetSessionFile` (cancellabile).
2. Disconnette la sottoscrizione agli eventi dell'agente e interrompe il lavoro in corso.
3. Cancella i messaggi di steering/follow-up/next-turn in coda.
4. Scarica le scritture del session manager corrente.
5. `sessionManager.setSessionFile(sessionPath)` e aggiorna `agent.sessionId`.
6. Costruisce il contesto della sessione dalle voci caricate.
7. Emette `session_switch` con `reason: "resume"`.
8. Sostituisce i messaggi dell'agente dal contesto.
9. Ripristina il modello (se disponibile nel registro corrente).
10. Ripristina o inizializza il livello di ragionamento.
11. Riconnette la sottoscrizione agli eventi dell'agente.

Nessun nuovo file di sessione viene creato da `switchSession()` stesso.

## Emissioni di eventi e punti di cancellazione

### Hook del ciclo di vita switch/fork

Per `newSession`, `fork` e `switchSession`:

- Evento precedente: `session_before_switch`
  - motivi: `new`, `fork`, `resume`
  - cancellabile restituendo `{ cancel: true }`
- Evento successivo: `session_switch`
  - stesso insieme di motivi
  - include `previousSessionFile`

`ExtensionRunner.emit()` ritorna anticipatamente al primo risultato di evento precedente che cancella.

### Comportamento `onSession` degli strumenti personalizzati

Il bridge SDK collega gli eventi di sessione dell'estensione ai callback `onSession` degli strumenti personalizzati:

- `session_switch` -> `onSession({ reason: "switch", previousSessionFile })`
- `session_branch` -> `reason: "branch"`
- `session_start` -> `reason: "start"`
- `session_tree` -> `reason: "tree"`
- `session_shutdown` -> `reason: "shutdown"`

Questi callback sono osservazionali; non cancellano switch/fork.

### Altre superfici di cancellazione rilevanti per questo documento

- `/fork` è bloccato durante lo streaming (l'utente deve attendere/interrompere prima la risposta corrente).
- Il selettore di `/resume` può essere cancellato dall'utente chiudendo il selettore.
- `--resume <id>` cross-progetto può essere cancellato rifiutando il prompt di fork.
- `/share` ha un percorso di interruzione nell'interfaccia (`Share cancelled`) per il flusso gist; non collega semantiche di terminazione del processo per `gh gist create` in questo percorso di codice.

## Comportamento della sessione non persistente (in memoria)

Quando il session manager viene creato con `SessionManager.inMemory()` (`--no-session`):

- Il percorso del file di sessione è assente.
- `/export` e `/share` falliscono con `Cannot export in-memory session to HTML` (propagato all'interfaccia di errore del comando).
- `/fork` fallisce perché `SessionManager.fork()` richiede la persistenza.
- `/dump` funziona ancora perché serializza lo stato dell'agente in memoria.
- Le semantiche di resume/continue della CLI vengono ignorate se `--no-session` è impostato, perché la creazione del manager restituisce immediatamente la versione in memoria.

## Avvertenze note dell'implementazione (al codice corrente)

- `SelectorController.handleResumeSession()` non verifica il risultato booleano di `session.switchSession(...)`; un cambio cancellato da un hook può comunque procedere attraverso il percorso di ridisegno/stato dell'interfaccia "Resumed session".
- I fallimenti di `/share` con condivisione personalizzata non degradano al fallback gist predefinito; terminano il comando con errore.
- La tokenizzazione degli argomenti di `/export` è semplicistica e non preserva i percorsi tra virgolette con spazi.
