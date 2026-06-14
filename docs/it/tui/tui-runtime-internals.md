---
title: Componenti interni del runtime TUI
description: >-
  Componenti interni del runtime dell'interfaccia utente terminale, che coprono
  la pipeline di rendering, la gestione degli input e la gestione dello stato.
sidebar:
  order: 2
  label: Componenti interni del runtime
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# Componenti interni del runtime TUI

Questo documento mappa il percorso del runtime non-tema dall'input del terminale all'output renderizzato in modalità interattiva. Si concentra sul comportamento in `packages/tui` e sulla sua integrazione dai controller di `packages/coding-agent`.

## Livelli del runtime e proprietà

- **Engine `packages/tui`**: ciclo di vita del terminale, normalizzazione di stdin, routing del focus, pianificazione del rendering, pittura differenziale, composizione degli overlay, posizionamento hardware del cursore.
- **Modalità interattiva di `packages/coding-agent`**: costruisce l'albero dei componenti, associa i callback dell'editor e le mappe dei tasti, reagisce agli eventi dell'agente/sessione e traduce lo stato del dominio (streaming, esecuzione degli strumenti, tentativi, modalità piano) in componenti dell'interfaccia utente.

Regola di confine: l'engine TUI è indifferente ai messaggi. Conosce solo `Component.render(width)`, `handleInput(data)`, focus e overlay. La semantica dell'agente rimane nei controller interattivi.

## File di implementazione

- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/components/custom-editor.ts`](../../packages/coding-agent/src/modes/components/custom-editor.ts)
- [`../../tui/src/tui.ts`](../../packages/tui/src/tui.ts)
- [`../../tui/src/terminal.ts`](../../packages/tui/src/terminal.ts)
- [`../../tui/src/editor-component.ts`](../../packages/tui/src/editor-component.ts)
- [`../../tui/src/stdin-buffer.ts`](../../packages/tui/src/stdin-buffer.ts)
- [`../../tui/src/components/loader.ts`](../../packages/tui/src/components/loader.ts)

## Avvio e assemblaggio dell'albero dei componenti

`InteractiveMode` costruisce `TUI(new ProcessTerminal(), showHardwareCursor)` e crea container persistenti:

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (contiene `CustomEditor`)

`init()` collega l'albero in quell'ordine, porta il focus sull'editor, registra i gestori di input tramite `InputController`, avvia il TUI e richiede un rendering forzato.

Un rendering forzato (`requestRender(true)`) reimposta le cache delle righe precedenti e la gestione del cursore prima di ridipingere.

## Ciclo di vita del terminale e normalizzazione di stdin

`ProcessTerminal.start()`:

1. Abilita la modalità raw e il paste con parentesi.
2. Collega il gestore di ridimensionamento.
3. Crea uno `StdinBuffer` per suddividere i chunk di escape parziali in sequenze complete.
4. Interroga il supporto al protocollo tastiera Kitty (`CSI ? u`), quindi abilita i flag del protocollo se supportato.
5. Su Windows, tenta l'abilitazione dell'input VT tramite i flag di modalità `kernel32`.

Comportamento di `StdinBuffer`:

- Bufferizza le sequenze di escape frammentate (CSI/OSC/DCS/APC/SS3).
- Emette `data` solo quando una sequenza è completa o svuotata per timeout.
- Rileva il paste con parentesi ed emette un evento `paste` con il testo incollato grezzo.

Questo impedisce che i chunk di escape parziali vengano interpretati erroneamente come normali pressioni di tasti.

## Routing degli input e modello di focus

Percorso dell'input:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Dettagli del routing:

1. Il TUI esegue prima i listener di input registrati (`addInputListener`), consentendo il comportamento di consumo/trasformazione.
2. Il TUI gestisce la scorciatoia di debug globale (`shift+ctrl+d`) prima del dispatch al componente.
3. Se il componente con focus appartiene a un overlay che ora è nascosto/invisibile, il TUI riassegna il focus al successivo overlay visibile o al focus salvato pre-overlay.
4. Gli eventi di rilascio tasto vengono filtrati a meno che il componente con focus non imposti `wantsKeyRelease = true`.
5. Dopo il dispatch, il TUI pianifica il rendering.

`setFocus()` attiva/disattiva anche `Focusable.focused`, che controlla se i componenti emettono `CURSOR_MARKER` per il posizionamento hardware del cursore.

## Suddivisione della gestione dei tasti: editor vs controller

`CustomEditor` intercetta prima le combinazioni ad alta priorità (escape, ctrl-c/d/z, ctrl-v, varianti ctrl-p, ctrl-t, alt-up, tasti personalizzati dell'estensione) e delega il resto al comportamento base di `Editor` (modifica del testo, cronologia, completamento automatico, movimento del cursore).

`InputController.setupKeyHandlers()` associa quindi i callback dell'editor alle azioni della modalità:

- annullamento / uscita dalla modalità su `Escape`
- arresto su doppio `Ctrl+C` o `Ctrl+D` con editor vuoto
- sospensione/ripresa su `Ctrl+Z`
- scorciatoie per comandi slash e selettori
- toggle di follow-up/dequeue e toggle di espansione

Questo mantiene l'analisi dei tasti/la meccanica dell'editor in `packages/tui` e la semantica della modalità nei controller del coding-agent.

## Loop di rendering e strategia di diffing

`TUI.requestRender()` è soggetto a debounce per un rendering per tick utilizzando `process.nextTick`. Più modifiche di stato nello stesso turno vengono unite.

Pipeline di `#doRender()`:

1. Rendering dell'albero dei componenti radice in `newLines`.
2. Composizione degli overlay visibili (se presenti).
3. Estrazione e rimozione di `CURSOR_MARKER` dalle righe del viewport visibile.
4. Aggiunta di suffissi di reset del segmento per le righe non-immagine.
5. Scelta tra ridipintura completa e patch differenziale:
   - primo frame
   - cambio di larghezza
   - riduzione con `clearOnShrink` abilitato e nessun overlay
   - modifiche sopra il viewport precedente
6. Per gli aggiornamenti differenziali, applicare patch solo all'intervallo di righe modificato e cancellare le righe finali obsolete quando necessario.
7. Riposizionamento del cursore hardware per il supporto IME.

Le scritture di rendering utilizzano la modalità di output sincronizzato (`CSI ? 2026 h/l`) per ridurre lo sfarfallio/tearing.

## Vincoli di sicurezza del rendering

Controlli di sicurezza critici in `TUI`:

- Le righe renderizzate non-immagine non devono superare la larghezza del terminale; l'overflow genera un'eccezione e scrive diagnostiche di crash.
- La composizione degli overlay include troncamento difensivo e verifica della larghezza post-composizione.
- I cambiamenti di larghezza forzano un ridisegno completo perché la semantica del wrapping cambia.
- La posizione del cursore viene delimitata prima del movimento.

Questi vincoli sono applicati a runtime, non semplici convenzioni.

## Gestione del ridimensionamento

Gli eventi di ridimensionamento sono guidati dagli eventi da `ProcessTerminal` a `TUI.requestRender()`.

Effetti:

- Qualsiasi cambio di larghezza attiva un ridisegno completo.
- Il tracciamento del viewport/top (`#previousViewportTop`, `#maxLinesRendered`) evita calcoli matematici relativi al cursore non validi quando cambiano il contenuto o le dimensioni del terminale.
- La visibilità dell'overlay può dipendere dalle dimensioni del terminale (`OverlayOptions.visible`); il focus viene corretto quando gli overlay diventano non visibili dopo il ridimensionamento.

## Streaming e aggiornamenti incrementali dell'interfaccia utente

`EventController` si iscrive a `AgentSessionEvent` e aggiorna l'interfaccia utente in modo incrementale:

- `agent_start`: avvia il loader in `statusContainer`.
- `message_start` assistant: crea `streamingComponent` e lo monta.
- `message_update`: aggiorna il contenuto dell'assistente in streaming; crea/aggiorna i componenti di esecuzione degli strumenti man mano che appaiono le chiamate agli strumenti.
- `tool_execution_update/end`: aggiorna i componenti dei risultati degli strumenti e lo stato di completamento.
- `message_end`: finalizza lo stream dell'assistente, gestisce le annotazioni di interruzione/errore, segna gli argomenti degli strumenti in sospeso come completi all'arresto normale.
- `agent_end`: arresta i loader, cancella lo stato temporaneo dello stream, svuota il cambio di modello differito, emette la notifica di completamento se in background.

Il raggruppamento degli strumenti di lettura è intenzionalmente stateful (`#lastReadGroup`) per unire le chiamate consecutive agli strumenti di lettura in un unico blocco visivo fino a quando non si verifica un'interruzione non-lettura.

## Orchestrazione di stato e loader

Proprietà della corsia di stato:

- `statusContainer` contiene i loader transitori (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` renderizza gli indicatori di stato/hook/piano persistenti e gestisce gli aggiornamenti del bordo superiore dell'editor.

Comportamento del loader:

- `Loader` si aggiorna ogni 80ms tramite intervallo e richiede il rendering per ogni frame.
- I gestori di escape vengono temporaneamente sovrascritti durante la compattazione automatica e il tentativo automatico per annullare tali operazioni.
- Nei percorsi di fine/annullamento, i controller ripristinano i gestori di escape precedenti e arrestano/cancellano i componenti loader.

## Transizioni di modalità e passaggio in background

### Modalità di input Bash/Python

I prefissi del testo di input attivano/disattivano i flag della modalità bordo dell'editor:

- `!` -> modalità bash
- `$` (prefisso non-template literal) -> modalità python

Escape esce dalla modalità inattiva cancellando il testo dell'editor e ripristinando il colore del bordo; quando l'esecuzione è attiva, escape interrompe l'attività in corso.

### Modalità piano

`InteractiveMode` tiene traccia dei flag della modalità piano, dello stato della riga di stato, degli strumenti attivi e del cambio di modello. L'entrata/uscita aggiorna le voci della modalità di sessione e lo stato dell'interfaccia utente/stato, incluso il cambio di modello differito se lo streaming è attivo.

### Sospensione/ripresa (`Ctrl+Z`)

`InputController.handleCtrlZ()`:

1. Registra un gestore `SIGCONT` monouso per riavviare il TUI e forzare il rendering.
2. Arresta il TUI prima della sospensione.
3. Invia `SIGTSTP` al gruppo di processi.

### Modalità background (`/background` o `/bg`)

`handleBackgroundCommand()`:

- Rifiuta quando inattivo.
- Passa il contesto dell'interfaccia utente degli strumenti a non-interattivo (`hasUI=false`) in modo che gli strumenti dell'interfaccia utente interattiva falliscano rapidamente.
- Arresta i loader/la riga di stato e annulla l'iscrizione al gestore degli eventi in primo piano.
- Iscrive il gestore degli eventi in background (attende principalmente `agent_end`).
- Arresta il TUI e invia `SIGTSTP` (percorso di controllo del job POSIX).

Su `agent_end` in background senza lavoro in coda, il controller invia la notifica di completamento e si arresta.

## Percorsi di annullamento

Input di annullamento principali:

- `Escape` durante il loader dello stream attivo: ripristina i messaggi in coda nell'editor e interrompe l'agente.
- `Escape` durante l'esecuzione bash/python: interrompe il comando in esecuzione.
- `Escape` durante la compattazione automatica/tentativo: richiama i metodi di interruzione dedicati tramite gestori di escape temporanei.
- `Ctrl+C` pressione singola: cancella l'editor; doppia pressione entro 500ms: arresto.

L'annullamento è condizionato dallo stato; lo stesso tasto può significare interruzione, uscita dalla modalità, trigger del selettore o nessuna operazione a seconda dello stato del runtime.

## Comportamento guidato dagli eventi vs throttled

Aggiornamenti guidati dagli eventi:

- Eventi della sessione dell'agente (`EventController`)
- Callback di input da tastiera (`InputController`)
- Callback di ridimensionamento del terminale
- Watcher di tema/branch in `InteractiveMode`

Percorsi throttled/debounced:

- Il rendering del TUI è soggetto a debounce per tick (unione di `requestRender`).
- L'animazione del loader è a intervallo fisso (80ms), ogni frame richiede il rendering.
- Gli aggiornamenti del completamento automatico dell'editor (all'interno di `Editor`) utilizzano timer di debounce, riducendo il ricalcolo durante la digitazione.

Il runtime quindi mescola le transizioni di stato guidate dagli eventi con la cadenza di rendering delimitata per mantenere l'interattività reattiva senza tempeste di ridipintura.
