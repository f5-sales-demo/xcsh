---
title: Cambio di sessione e lista delle sessioni recenti
description: >-
  Meccaniche di cambio sessione e lista delle sessioni recenti con ricerca e
  filtraggio.
sidebar:
  order: 4
  label: Cambio e recenti
i18n:
  sourceHash: aae56130b508
  translator: machine
---

# Cambio di sessione e lista delle sessioni recenti

Questo documento descrive come coding-agent individua le sessioni recenti, risolve i target `--resume`, presenta i selettori di sessione e cambia la sessione runtime attiva.

Si concentra sul comportamento dell'implementazione corrente, inclusi i percorsi di fallback e le avvertenze.

## File di implementazione

- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/cli/session-picker.ts`](../../packages/coding-agent/src/cli/session-picker.ts)
- [`../src/modes/components/session-selector.ts`](../../packages/coding-agent/src/modes/components/session-selector.ts)
- [`../src/modes/controllers/selector-controller.ts`](../../packages/coding-agent/src/modes/controllers/selector-controller.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)

## Individuazione delle sessioni recenti

### Ambito della directory

`SessionManager` memorizza le sessioni in una directory con ambito cwd per impostazione predefinita:

- `~/.xcsh/agent/sessions/--<cwd-encoded>--/*.jsonl`

`SessionManager.list(cwd, sessionDir?)` legge solo quella directory a meno che non venga fornita una `sessionDir` esplicita.

### Due percorsi di listing con payload differenti

Esistono due pipeline di listing differenti:

1. `getRecentSessions(sessionDir, limit)` (vista di benvenuto/riepilogo)
   - Legge solo un prefisso di 4KB (`readTextPrefix(..., 4096)`) da ciascun file.
   - Analizza l'header + anteprima del primo testo utente.
   - Restituisce `RecentSessionInfo` leggeri con getter lazy `name` e `timeAgo`.
   - Ordina per `mtime` del file in ordine decrescente.

2. `SessionManager.list(...)` / `SessionManager.listAll()` (selettori di ripresa e corrispondenza ID)
   - Legge i file di sessione completi.
   - Costruisce oggetti `SessionInfo` (`id`, `cwd`, `title`, `messageCount`, `firstMessage`, `allMessagesText`, timestamp).
   - Scarta le sessioni con zero voci `message`.
   - Ordina per `modified` in ordine decrescente.

### Comportamento di fallback dei metadati

Per i riepiloghi recenti (`RecentSessionInfo`):

- preferenza nome visualizzato: `header.title` -> primo prompt utente -> `header.id` -> nome file
- il nome viene troncato a 40 caratteri per le visualizzazioni compatte
- i caratteri di controllo/newline vengono rimossi/sanificati dai nomi derivati dal titolo

Per le voci della lista `SessionInfo`:

- `title` è `header.title` o l'ultimo `shortSummary` di compattazione
- `firstMessage` è il testo del primo messaggio utente o `"(no messages)"`

## Risoluzione di `--continue` e preferenza del breadcrumb del terminale

`SessionManager.continueRecent(cwd, sessionDir?)` risolve il target in questo ordine:

1. Legge il breadcrumb con ambito terminale (`~/.xcsh/agent/terminal-sessions/<terminal-id>`)
2. Valida il breadcrumb:
   - il terminale corrente può essere identificato
   - il cwd del breadcrumb corrisponde al cwd corrente (confronto del percorso risolto)
   - il file referenziato esiste ancora
3. Se il breadcrumb è non valido/mancante, ricade sul file più recente per mtime nella directory di sessione (`findMostRecentSession`)
4. Se non ne trova nessuno, crea una nuova sessione

La derivazione dell'ID del terminale preferisce il percorso TTY e ricade su identificatori basati sulle variabili d'ambiente (`KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION`).

Le scritture dei breadcrumb sono best-effort e non fatali.

## Risoluzione del target di ripresa all'avvio (`main.ts`)

### `--resume <valore>`

`createSessionManager(...)` gestisce `--resume` con valore stringa in due modalità:

1. Valore simile a un percorso (contiene `/`, `\\`, o termina con `.jsonl`)
   - `SessionManager.open(sessionArg, parsed.sessionDir)` diretto

2. Valore prefisso ID
   - cerca corrispondenza in `SessionManager.list(cwd, sessionDir)` tramite `id.startsWith(sessionArg)`
   - se nessuna corrispondenza locale e `sessionDir` non è forzata, prova `SessionManager.listAll()`
   - viene usata la prima corrispondenza (nessun prompt di ambiguità)

Comportamento di corrispondenza cross-progetto:

- se il cwd della sessione trovata differisce dal cwd corrente, la CLI chiede se fare fork nel progetto corrente
- sì -> `SessionManager.forkFrom(...)`
- no -> lancia errore (`Session "..." is in another project (...)`)

Nessuna corrispondenza -> lancia errore (`Session "..." not found.`).

### `--resume` (senza valore)

Gestito dopo la costruzione iniziale del session-manager:

1. elenca le sessioni locali con `SessionManager.list(cwd, parsed.sessionDir)`
2. se vuoto: stampa `No sessions found` ed esce anticipatamente
3. apre il selettore TUI (`selectSession`)
4. se annullato: stampa `No session selected` ed esce anticipatamente
5. se selezionato: `SessionManager.open(selectedPath)`

### `--continue`

Usa `SessionManager.continueRecent(...)` direttamente (comportamento breadcrumb-first descritto sopra).

## Dettagli interni della selezione tramite picker

## Picker CLI (`src/cli/session-picker.ts`)

`selectSession(sessions)` crea una TUI standalone con `SessionSelectorComponent` e si risolve esattamente una volta:

- selezione -> risolve il percorso selezionato
- annullamento (Esc) -> risolve `null`
- uscita forzata (percorso Ctrl+C) -> ferma la TUI e `process.exit(0)`

## Picker interattivo in-sessione (`SelectorController.showSessionSelector`)

Flusso:

1. recupera le sessioni dalla directory di sessione corrente tramite `SessionManager.list(currentCwd, currentSessionDir)`
2. monta `SessionSelectorComponent` nell'area editor usando `showSelector(...)`
3. callback:
   - selezione -> chiude il selettore e chiama `handleResumeSession(sessionPath)`
   - annullamento -> ripristina l'editor e ridisegna
   - uscita -> `ctx.shutdown()`

## Comportamento del componente selettore di sessione

`SessionList` supporta:

- navigazione con frecce/pagina
- Invio per selezionare
- Esc per annullare
- Ctrl+C per uscire
- ricerca fuzzy su id/titolo/cwd/primo messaggio/tutti i messaggi/percorso della sessione

Comportamento di rendering con lista vuota:

- visualizza un messaggio invece di andare in crash
- Invio su lista vuota non fa nulla (nessun callback)
- Esc/Ctrl+C funzionano comunque

Avvertenza: il testo dell'interfaccia dice `Press Tab to view all`, ma questo componente attualmente non ha un handler per Tab e il cablaggio corrente elenca solo le sessioni dell'ambito corrente.

## Esecuzione del cambio a runtime (`AgentSession.switchSession`)

`switchSession(sessionPath)` è il percorso di cambio principale in-process.

Ciclo di vita/transizione di stato:

1. cattura `previousSessionFile`
2. emette l'evento hook `session_before_switch` (`reason: "resume"`, annullabile)
3. se annullato -> restituisce `false` senza cambio
4. si disconnette dallo stream di eventi dell'agente corrente
5. interrompe la generazione/flusso di tool attivi
6. svuota i buffer dei messaggi di steering/follow-up/next-turn in coda
7. esegue il flush del writer di sessione (`sessionManager.flush()`) per persistere le scritture in sospeso
8. `sessionManager.setSessionFile(sessionPath)`
   - aggiorna il puntatore al file di sessione
   - scrive il breadcrumb del terminale
   - carica le voci / esegue migrazione / risolve blob / reindicizza
   - se i dati del file sono mancanti/non validi: inizializza una nuova sessione a quel percorso e riscrive l'header
9. aggiorna `agent.sessionId`
10. ricostruisce il contesto tramite `buildSessionContext()`
11. emette l'evento hook `session_switch` (`reason: "resume"`, `previousSessionFile`)
12. sostituisce i messaggi dell'agente con il contesto ricostruito
13. ripristina il modello predefinito da `sessionContext.models.default` se disponibile e presente nel registro dei modelli
14. ripristina il livello di thinking:
    - se il branch ha già `thinking_level_change`, applica il livello di sessione salvato
    - altrimenti deriva il livello di thinking predefinito dalle impostazioni, lo limita alla capacità del modello, lo imposta e aggiunge una nuova voce `thinking_level_change`
15. riconnette i listener dell'agente e restituisce `true`

## Ricostruzione dello stato UI dopo il cambio interattivo

`SelectorController.handleResumeSession` esegue il reset dell'interfaccia attorno a `switchSession`:

- ferma l'animazione di caricamento
- pulisce il contenitore di stato
- pulisce l'interfaccia dei messaggi in sospeso e la mappa dei tool in sospeso
- resetta i riferimenti del componente di streaming/messaggi
- chiama `session.switchSession(...)`
- pulisce il contenitore della chat e ridisegna dal contesto di sessione (`renderInitialMessages`)
- ricarica i todo dagli artefatti della nuova sessione
- mostra `Resumed session`

Quindi lo stato visibile della conversazione/todo viene ricostruito dal nuovo file di sessione.

## Ripresa all'avvio vs cambio in-sessione

### Ripresa all'avvio (`--continue`, `--resume`, apertura diretta)

- Il file di sessione viene scelto prima di `createAgentSession(...)`.
- `sdk.ts` costruisce `existingSession = sessionManager.buildSessionContext()`.
- I messaggi dell'agente vengono ripristinati una sola volta durante la creazione della sessione.
- Il modello/thinking vengono selezionati durante la creazione (inclusa la logica di ripristino/fallback).
- La modalità interattiva poi esegue `#restoreModeFromSession()` per rientrare nello stato di modalità persistito (attualmente plan/plan_paused).

### Cambio in-sessione (percorso selettore tipo `/resume`)

- Usa `AgentSession.switchSession(...)` su un `AgentSession` già in esecuzione.
- I messaggi/modello/thinking vengono ricostruiti immediatamente sul posto.
- Vengono emessi gli eventi hook `session_before_switch`/`session_switch`.
- La chat/todo dell'interfaccia vengono aggiornati.
- Non viene effettuata alcuna chiamata dedicata di ripristino della modalità post-cambio nel flusso del selettore; il comportamento di rientro nella modalità non è simmetrico rispetto al `#restoreModeFromSession()` dell'avvio.

## Comportamento in caso di errore e casi limite

### Percorsi di annullamento

- Annullamento picker CLI -> restituisce `null`, il chiamante stampa `No session selected`, il processo esce anticipatamente.
- Annullamento picker interattivo -> editor ripristinato, nessun cambio di sessione.
- Annullamento hook (`session_before_switch`) -> `switchSession()` restituisce `false`.

### Percorsi con lista vuota

- CLI `--resume` (senza valore): lista vuota stampa `No sessions found` ed esce.
- Selettore interattivo: lista vuota visualizza un messaggio e rimane annullabile.

### File di sessione target mancante/non valido

Quando si apre/cambia verso un percorso specifico (`setSessionFile`):

- ENOENT -> trattato come vuoto -> nuova sessione inizializzata a quel percorso esatto e persistita.
- header malformato/non valido (o voci analizzate effettivamente illeggibili) -> trattato come vuoto -> nuova sessione inizializzata e persistita.

Questo è un comportamento di recupero, non un errore fatale.

### Errori fatali

Il cambio/apertura può comunque lanciare eccezioni per veri errori di I/O (errori di permessi, errori di riscrittura, ecc.), che vengono propagati ai chiamanti.

### Avvertenze sulla corrispondenza per prefisso ID

- La corrispondenza ID usa `startsWith` e prende la prima corrispondenza nella lista ordinata.
- Nessuna interfaccia di disambiguazione se più sessioni condividono lo stesso prefisso.
- `SessionManager.list(...)` esclude le sessioni con zero messaggi, quindi quelle sessioni non sono ripristinabili tramite corrispondenza ID/selettore lista.
