---
title: TUI Runtime Internals
description: >-
  Dettagli interni del runtime dell'interfaccia utente terminale, che coprono la
  pipeline di rendering, la gestione dell'input e la gestione dello stato.
sidebar:
  order: 2
  label: Runtime internals
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# Dettagli interni del runtime TUI

Questo documento descrive il percorso runtime non legato al tema, dall'input del terminale all'output renderizzato in modalità interattiva. Si concentra sul comportamento in `packages/tui` e sulla sua integrazione dai controller di `packages/coding-agent`.

## Livelli del runtime e responsabilità

- **Engine `packages/tui`**: ciclo di vita del terminale, normalizzazione di stdin, routing del focus, pianificazione del rendering, painting differenziale, composizione degli overlay, posizionamento del cursore hardware.
- **Modalità interattiva di `packages/coding-agent`**: costruisce l'albero dei componenti, collega callback e keymap dell'editor, reagisce agli eventi agent/sessione e traduce lo stato del dominio (streaming, esecuzione di tool, retry, modalità piano) in componenti UI.

Regola di confine: l'engine TUI è agnostico rispetto ai messaggi. Conosce solo `Component.render(width)`, `handleInput(data)`, focus e overlay. La semantica dell'agent resta nei controller interattivi.

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

`InteractiveMode` costruisce `TUI(new ProcessTerminal(), showHardwareCursor)` e crea contenitori persistenti:

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (contiene `CustomEditor`)

`init()` collega l'albero in quest'ordine, assegna il focus all'editor, registra i gestori di input tramite `InputController`, avvia la TUI e richiede un rendering forzato.

Un rendering forzato (`requestRender(true)`) resetta le cache delle righe precedenti e la contabilità del cursore prima di ridisegnare.

## Ciclo di vita del terminale e normalizzazione di stdin

`ProcessTerminal.start()`:

1. Abilita la modalità raw e il bracketed paste.
2. Collega il gestore di resize.
3. Crea un `StdinBuffer` per suddividere i chunk parziali di sequenze escape in sequenze complete.
4. Interroga il supporto del protocollo tastiera Kitty (`CSI ? u`), poi abilita i flag del protocollo se supportato.
5. Su Windows, tenta l'abilitazione dell'input VT tramite flag di modalità `kernel32`.

Comportamento di `StdinBuffer`:

- Bufferizza le sequenze escape frammentate (CSI/OSC/DCS/APC/SS3).
- Emette `data` solo quando una sequenza è completa o viene svuotata per timeout.
- Rileva il bracketed paste ed emette un evento `paste` con il testo incollato grezzo.

Questo impedisce che chunk parziali di sequenze escape vengano interpretati erroneamente come normali pressioni di tasti.

## Routing dell'input e modello di focus

Percorso dell'input:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Dettagli del routing:

1. La TUI esegue prima i listener di input registrati (`addInputListener`), consentendo comportamenti di consumo/trasformazione.
2. La TUI gestisce la scorciatoia globale di debug (`shift+ctrl+d`) prima del dispatch al componente.
3. Se il componente con focus appartiene a un overlay ora nascosto/invisibile, la TUI riassegna il focus al successivo overlay visibile o al focus pre-overlay salvato.
4. Gli eventi di rilascio dei tasti vengono filtrati a meno che il componente con focus non imposti `wantsKeyRelease = true`.
5. Dopo il dispatch, la TUI pianifica il rendering.

`setFocus()` inoltre attiva/disattiva `Focusable.focused`, che controlla se i componenti emettono `CURSOR_MARKER` per il posizionamento del cursore hardware.

## Suddivisione della gestione dei tasti: editor vs controller

`CustomEditor` intercetta prima le combinazioni ad alta priorità (escape, ctrl-c/d/z, ctrl-v, varianti ctrl-p, ctrl-t, alt-up, tasti personalizzati delle estensioni) e delega il resto al comportamento base di `Editor` (editing del testo, cronologia, autocompletamento, movimento del cursore).

`InputController.setupKeyHandlers()` poi collega i callback dell'editor alle azioni della modalità:

- cancellazione / uscita dalla modalità su `Escape`
- spegnimento con doppio `Ctrl+C` o `Ctrl+D` con editor vuoto
- sospensione/ripresa su `Ctrl+Z`
- slash-command e tasti rapidi per selettori
- toggle di follow-up/dequeue e toggle di espansione

Questo mantiene il parsing dei tasti e la meccanica dell'editor in `packages/tui` e la semantica della modalità nei controller di coding-agent.

## Ciclo di rendering e strategia di diffing

`TUI.requestRender()` è soggetto a debounce di un rendering per tick usando `process.nextTick`. Più cambiamenti di stato nello stesso turno vengono raggruppati.

Pipeline di `#doRender()`:

1. Renderizza l'albero dei componenti root in `newLines`.
2. Compone gli overlay visibili (se presenti).
3. Estrae e rimuove `CURSOR_MARKER` dalle righe visibili della viewport.
4. Aggiunge suffissi di reset dei segmenti per le righe non-immagine.
5. Sceglie tra ridisegno completo e patch differenziale:
   - primo frame
   - cambio di larghezza
   - riduzione con `clearOnShrink` abilitato e nessun overlay
   - modifiche sopra la viewport precedente
6. Per aggiornamenti differenziali, applica patch solo all'intervallo di righe modificate e cancella le righe finali residue quando necessario.
7. Riposiziona il cursore hardware per il supporto IME.

Le scritture di rendering usano la modalità di output sincronizzato (`CSI ? 2026 h/l`) per ridurre sfarfallio/tearing.

## Vincoli di sicurezza del rendering

Controlli di sicurezza critici nella TUI:

- Le righe renderizzate non-immagine non devono superare la larghezza del terminale; l'overflow lancia un'eccezione e scrive diagnostiche di crash.
- La composizione degli overlay include troncamento difensivo e verifica della larghezza post-composizione.
- I cambiamenti di larghezza forzano un ridisegno completo perché la semantica di wrapping cambia.
- La posizione del cursore viene limitata prima del movimento.

Questi vincoli sono enforcement a runtime, non semplici convenzioni.

## Gestione del resize

Gli eventi di resize sono guidati da eventi da `ProcessTerminal` a `TUI.requestRender()`.

Effetti:

- Qualsiasi cambio di larghezza attiva un ridisegno completo.
- Il tracciamento di viewport/top (`#previousViewportTop`, `#maxLinesRendered`) evita calcoli relativi del cursore non validi quando il contenuto o la dimensione del terminale cambiano.
- La visibilità degli overlay può dipendere dalle dimensioni del terminale (`OverlayOptions.visible`); il focus viene corretto quando gli overlay diventano non visibili dopo un resize.

## Streaming e aggiornamenti incrementali dell'UI

`EventController` si sottoscrive a `AgentSessionEvent` e aggiorna l'UI in modo incrementale:

- `agent_start`: avvia il loader in `statusContainer`.
- `message_start` assistant: crea `streamingComponent` e lo monta.
- `message_update`: aggiorna il contenuto in streaming dell'assistente; crea/aggiorna componenti di esecuzione tool quando appaiono chiamate a tool.
- `tool_execution_update/end`: aggiorna i componenti dei risultati dei tool e lo stato di completamento.
- `message_end`: finalizza lo stream dell'assistente, gestisce annotazioni di interruzione/errore, segna gli argomenti dei tool in sospeso come completi in caso di stop normale.
- `agent_end`: ferma i loader, cancella lo stato transitorio dello stream, esegue il flush dello switch di modello differito, invia notifica di completamento se in background.

Il raggruppamento dei tool di lettura è intenzionalmente stateful (`#lastReadGroup`) per raggruppare chiamate consecutive a tool di lettura in un unico blocco visivo fino a quando non si verifica un'interruzione non-read.

## Orchestrazione di stato e loader

Responsabilità della corsia di stato:

- `statusContainer` contiene i loader transitori (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` renderizza indicatori persistenti di stato/hook/piano e guida gli aggiornamenti del bordo superiore dell'editor.

Comportamento dei loader:

- `Loader` si aggiorna ogni 80ms tramite intervallo e richiede il rendering ad ogni frame.
- I gestori di escape vengono temporaneamente sovrascritti durante l'auto-compaction e l'auto-retry per annullare quelle operazioni.
- Nei percorsi di fine/annullamento, i controller ripristinano i gestori di escape precedenti e fermano/cancellano i componenti loader.

## Transizioni di modalità e backgrounding

### Modalità di input Bash/Python

I prefissi del testo di input attivano i flag di modalità del bordo dell'editor:

- `!` -> modalità bash
- `$` (prefisso non-template literal) -> modalità python

Escape esce dalla modalità inattiva cancellando il testo dell'editor e ripristinando il colore del bordo; quando l'esecuzione è attiva, escape interrompe il task in esecuzione.

### Modalità piano

`InteractiveMode` traccia i flag della modalità piano, lo stato della status-line, i tool attivi e lo switch di modello. Entrare/uscire aggiorna le voci di modalità della sessione e lo stato UI/status, incluso lo switch di modello differito se lo streaming è attivo.

### Sospensione/ripresa (`Ctrl+Z`)

`InputController.handleCtrlZ()`:

1. Registra un gestore `SIGCONT` one-shot per riavviare la TUI e forzare il rendering.
2. Ferma la TUI prima della sospensione.
3. Invia `SIGTSTP` al gruppo di processi.

### Modalità background (`/background` o `/bg`)

`handleBackgroundCommand()`:

- Rifiuta quando è in stato idle.
- Commuta il contesto UI dei tool a non-interattivo (`hasUI=false`) così i tool UI interattivi falliscono rapidamente.
- Ferma loader/status line e annulla la sottoscrizione del gestore eventi in foreground.
- Sottoscrive il gestore eventi in background (principalmente attende `agent_end`).
- Ferma la TUI e invia `SIGTSTP` (percorso di job control POSIX).

Su `agent_end` in background senza lavoro in coda, il controller invia una notifica di completamento e si chiude.

## Percorsi di cancellazione

Input principali di cancellazione:

- `Escape` durante il loader di stream attivo: ripristina i messaggi in coda nell'editor e interrompe l'agent.
- `Escape` durante l'esecuzione bash/python: interrompe il comando in esecuzione.
- `Escape` durante auto-compaction/retry: invoca metodi di interruzione dedicati tramite gestori di escape temporanei.
- `Ctrl+C` singola pressione: cancella l'editor; doppia pressione entro 500ms: spegnimento.

La cancellazione è condizionata allo stato; lo stesso tasto può significare interruzione, uscita dalla modalità, attivazione del selettore o nessuna operazione a seconda dello stato runtime.

## Comportamento event-driven vs throttled

Aggiornamenti event-driven:

- Eventi della sessione agent (`EventController`)
- Callback di input dei tasti (`InputController`)
- Callback di resize del terminale
- Watcher di tema/branch in `InteractiveMode`

Percorsi throttled/debounced:

- Il rendering della TUI è soggetto a debounce per tick (raggruppamento di `requestRender`).
- L'animazione del loader è a intervallo fisso (80ms), con ogni frame che richiede il rendering.
- Gli aggiornamenti dell'autocompletamento dell'editor (dentro `Editor`) usano timer di debounce, riducendo il churn di ricalcolo durante la digitazione.

Il runtime quindi mescola transizioni di stato event-driven con una cadenza di rendering limitata per mantenere l'interattività reattiva senza tempeste di repaint.
