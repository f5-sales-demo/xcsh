---
title: TUI Runtime Internals
description: >-
  Dettagli interni del runtime della Terminal UI, inclusi pipeline di rendering,
  gestione dell'input e gestione dello stato.
sidebar:
  order: 2
  label: Dettagli interni del runtime
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# Dettagli interni del runtime TUI

Questo documento descrive il percorso runtime non relativo al tema, dall'input del terminale all'output renderizzato in modalità interattiva. Si concentra sul comportamento in `packages/tui` e sulla sua integrazione con i controller di `packages/coding-agent`.

## Layer del runtime e responsabilità

- **Motore `packages/tui`**: ciclo di vita del terminale, normalizzazione stdin, routing del focus, pianificazione del rendering, painting differenziale, composizione degli overlay, posizionamento del cursore hardware.
- **Modalità interattiva di `packages/coding-agent`**: costruisce l'albero dei componenti, associa callback e keymap dell'editor, reagisce agli eventi agent/sessione e traduce lo stato del dominio (streaming, esecuzione tool, retry, modalità piano) in componenti UI.

Regola di confine: il motore TUI è agnostico rispetto ai messaggi. Conosce solo `Component.render(width)`, `handleInput(data)`, focus e overlay. La semantica dell'agente rimane nei controller interattivi.

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

`init()` collega l'albero in quell'ordine, assegna il focus all'editor, registra i gestori di input tramite `InputController`, avvia il TUI e richiede un rendering forzato.

Un rendering forzato (`requestRender(true)`) resetta le cache delle linee precedenti e la gestione del cursore prima di ridisegnare.

## Ciclo di vita del terminale e normalizzazione stdin

`ProcessTerminal.start()`:

1. Abilita la modalità raw e il bracketed paste.
2. Collega il gestore di resize.
3. Crea uno `StdinBuffer` per suddividere chunk di escape parziali in sequenze complete.
4. Verifica il supporto al protocollo tastiera Kitty (`CSI ? u`), quindi abilita i flag del protocollo se supportato.
5. Su Windows, tenta l'abilitazione dell'input VT tramite flag di modalità `kernel32`.

Comportamento di `StdinBuffer`:

- Bufferizza sequenze di escape frammentate (CSI/OSC/DCS/APC/SS3).
- Emette `data` solo quando una sequenza è completa o viene svuotata per timeout.
- Rileva il bracketed paste ed emette un evento `paste` con il testo incollato grezzo.

Questo impedisce che chunk di escape parziali vengano interpretati erroneamente come normali pressioni di tasti.

## Routing dell'input e modello di focus

Percorso dell'input:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Dettagli del routing:

1. Il TUI esegue prima i listener di input registrati (`addInputListener`), permettendo comportamenti di consumo/trasformazione.
2. Il TUI gestisce la scorciatoia globale di debug (`shift+ctrl+d`) prima del dispatch al componente.
3. Se il componente con focus appartiene a un overlay ora nascosto/invisibile, il TUI riassegna il focus al prossimo overlay visibile o al focus pre-overlay salvato.
4. Gli eventi di rilascio tasto vengono filtrati a meno che il componente con focus non imposti `wantsKeyRelease = true`.
5. Dopo il dispatch, il TUI pianifica il rendering.

`setFocus()` inoltre attiva/disattiva `Focusable.focused`, che controlla se i componenti emettono `CURSOR_MARKER` per il posizionamento del cursore hardware.

## Suddivisione della gestione tasti: editor vs controller

`CustomEditor` intercetta prima le combinazioni ad alta priorità (escape, ctrl-c/d/z, ctrl-v, varianti ctrl-p, ctrl-t, alt-up, tasti personalizzati delle estensioni) e delega il resto al comportamento base di `Editor` (editing del testo, cronologia, autocompletamento, movimento del cursore).

`InputController.setupKeyHandlers()` poi associa i callback dell'editor alle azioni della modalità:

- cancellazione / uscita dalla modalità su `Escape`
- arresto su doppio `Ctrl+C` o `Ctrl+D` con editor vuoto
- sospensione/ripresa su `Ctrl+Z`
- comandi slash e hotkey del selettore
- toggle di follow-up/dequeue e toggle di espansione

Questo mantiene il parsing dei tasti e la meccanica dell'editor in `packages/tui` e la semantica della modalità nei controller di coding-agent.

## Loop di rendering e strategia di diffing

`TUI.requestRender()` è sottoposto a debounce con un rendering per tick usando `process.nextTick`. Più cambiamenti di stato nello stesso turno vengono coalizzati.

Pipeline di `#doRender()`:

1. Renderizza l'albero dei componenti root in `newLines`.
2. Compone gli overlay visibili (se presenti).
3. Estrae e rimuove `CURSOR_MARKER` dalle linee del viewport visibile.
4. Aggiunge suffissi di reset del segmento per le linee non-immagine.
5. Sceglie tra ridisegno completo e patch differenziale:
   - primo frame
   - cambio di larghezza
   - riduzione con `clearOnShrink` abilitato e nessun overlay
   - modifiche sopra il viewport precedente
6. Per gli aggiornamenti differenziali, applica la patch solo all'intervallo di linee modificate e cancella le linee residue in coda quando necessario.
7. Riposiziona il cursore hardware per il supporto IME.

Le scritture di rendering utilizzano la modalità di output sincronizzato (`CSI ? 2026 h/l`) per ridurre sfarfallio/tearing.

## Vincoli di sicurezza del rendering

Controlli di sicurezza critici nel TUI:

- Le linee renderizzate non-immagine non devono superare la larghezza del terminale; l'overflow genera un'eccezione e scrive diagnostica di crash.
- La composizione degli overlay include troncamento difensivo e verifica della larghezza post-composizione.
- I cambiamenti di larghezza forzano un ridisegno completo perché la semantica del wrapping cambia.
- La posizione del cursore viene clampata prima del movimento.

Questi vincoli sono enforcement a runtime, non semplici convenzioni.

## Gestione del resize

Gli eventi di resize sono guidati da eventi, da `ProcessTerminal` a `TUI.requestRender()`.

Effetti:

- Qualsiasi cambio di larghezza attiva un ridisegno completo.
- Il tracking viewport/top (`#previousViewportTop`, `#maxLinesRendered`) evita calcoli matematici relativi al cursore non validi quando il contenuto o la dimensione del terminale cambiano.
- La visibilità degli overlay può dipendere dalle dimensioni del terminale (`OverlayOptions.visible`); il focus viene corretto quando gli overlay diventano non visibili dopo un resize.

## Streaming e aggiornamenti UI incrementali

`EventController` si iscrive a `AgentSessionEvent` e aggiorna la UI in modo incrementale:

- `agent_start`: avvia il loader in `statusContainer`.
- `message_start` assistant: crea `streamingComponent` e lo monta.
- `message_update`: aggiorna il contenuto assistant in streaming; crea/aggiorna i componenti di esecuzione tool man mano che appaiono le chiamate ai tool.
- `tool_execution_update/end`: aggiorna i componenti dei risultati dei tool e lo stato di completamento.
- `message_end`: finalizza lo stream dell'assistant, gestisce le annotazioni di abort/errore, segna gli argomenti dei tool in attesa come completi in caso di arresto normale.
- `agent_end`: ferma i loader, cancella lo stato di stream transitorio, applica lo switch di modello differito, emette notifica di completamento se in background.

Il raggruppamento dei tool di lettura è intenzionalmente stateful (`#lastReadGroup`) per coalizzare chiamate consecutive ai tool di lettura in un unico blocco visivo fino a quando non si verifica un'interruzione non-read.

## Orchestrazione di stato e loader

Responsabilità della corsia di stato:

- `statusContainer` contiene loader transienti (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` renderizza indicatori persistenti di stato/hook/piano e aggiorna il bordo superiore dell'editor.

Comportamento dei loader:

- `Loader` si aggiorna ogni 80ms tramite intervallo e richiede il rendering ad ogni frame.
- I gestori di escape vengono temporaneamente sovrascritti durante l'auto-compattazione e l'auto-retry per cancellare tali operazioni.
- Nei percorsi di fine/cancellazione, i controller ripristinano i gestori di escape precedenti e fermano/cancellano i componenti loader.

## Transizioni di modalità e backgrounding

### Modalità di input Bash/Python

I prefissi del testo di input attivano i flag di modalità del bordo dell'editor:

- `!` -> modalità bash
- `$` (prefisso non template literal) -> modalità python

Escape esce dalla modalità inattiva cancellando il testo dell'editor e ripristinando il colore del bordo; quando un'esecuzione è attiva, escape interrompe il task in esecuzione.

### Modalità piano

`InteractiveMode` traccia i flag della modalità piano, lo stato della status-line, i tool attivi e lo switch di modello. Entrata/uscita aggiorna le voci di modalità della sessione e lo stato UI/status, incluso lo switch di modello differito se lo streaming è attivo.

### Sospensione/ripresa (`Ctrl+Z`)

`InputController.handleCtrlZ()`:

1. Registra un gestore `SIGCONT` one-shot per riavviare il TUI e forzare il rendering.
2. Ferma il TUI prima della sospensione.
3. Invia `SIGTSTP` al gruppo di processi.

### Modalità background (`/background` o `/bg`)

`handleBackgroundCommand()`:

- Rifiuta quando è inattivo.
- Cambia il contesto UI dei tool a non-interattivo (`hasUI=false`) in modo che i tool UI interattivi falliscano rapidamente.
- Ferma loader/status line e annulla l'iscrizione al gestore eventi in primo piano.
- Iscrive il gestore eventi in background (attende principalmente `agent_end`).
- Ferma il TUI e invia `SIGTSTP` (percorso di job control POSIX).

Al ricevimento di `agent_end` in background senza lavoro in coda, il controller invia una notifica di completamento e si arresta.

## Percorsi di cancellazione

Input di cancellazione principali:

- `Escape` durante il loader di stream attivo: ripristina i messaggi in coda nell'editor e interrompe l'agente.
- `Escape` durante l'esecuzione bash/python: interrompe il comando in esecuzione.
- `Escape` durante auto-compattazione/retry: invoca metodi di abort dedicati tramite gestori di escape temporanei.
- `Ctrl+C` singola pressione: cancella l'editor; doppia pressione entro 500ms: arresto.

La cancellazione è condizionata allo stato; lo stesso tasto può significare abort, uscita dalla modalità, attivazione del selettore o no-op a seconda dello stato del runtime.

## Comportamento guidato da eventi vs throttled

Aggiornamenti guidati da eventi:

- Eventi della sessione agente (`EventController`)
- Callback di input da tastiera (`InputController`)
- Callback di resize del terminale
- Watcher di tema/branch in `InteractiveMode`

Percorsi throttled/debounced:

- Il rendering del TUI è sottoposto a debounce per tick (coalizzazione di `requestRender`).
- L'animazione del loader è a intervallo fisso (80ms), con ogni frame che richiede il rendering.
- Gli aggiornamenti dell'autocompletamento dell'editor (dentro `Editor`) utilizzano timer di debounce, riducendo il ricalcolo durante la digitazione.

Il runtime quindi combina transizioni di stato guidate da eventi con una cadenza di rendering limitata per mantenere l'interattività reattiva senza tempeste di ridisegno.
