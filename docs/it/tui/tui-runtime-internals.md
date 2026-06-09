---
title: Internals del Runtime TUI
description: >-
  Internals del runtime dell'interfaccia utente terminale che coprono la
  pipeline di rendering, la gestione dell'input e la gestione dello stato.
sidebar:
  order: 2
  label: Internals del runtime
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# Internals del runtime TUI

Questo documento mappa il percorso runtime non-theme dall'input del terminale all'output renderizzato in modalità interattiva. Si concentra sul comportamento in `packages/tui` e sulla sua integrazione dai controller di `packages/coding-agent`.

## Livelli del runtime e responsabilità

- **Motore `packages/tui`**: ciclo di vita del terminale, normalizzazione stdin, routing del focus, pianificazione del render, painting differenziale, composizione degli overlay, posizionamento del cursore hardware.
- **Modalità interattiva `packages/coding-agent`**: costruisce l'albero dei componenti, associa callback e keymap dell'editor, reagisce agli eventi agent/sessione e traduce lo stato del dominio (streaming, esecuzione tool, retry, plan mode) in componenti UI.

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

`InteractiveMode` costruisce `TUI(new ProcessTerminal(), showHardwareCursor)` e crea contenitori persistenti:

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (contiene `CustomEditor`)

`init()` collega l'albero in quell'ordine, assegna il focus all'editor, registra i gestori di input tramite `InputController`, avvia la TUI e richiede un render forzato.

Un render forzato (`requestRender(true)`) resetta le cache delle righe precedenti e la contabilità del cursore prima di ridipingere.

## Ciclo di vita del terminale e normalizzazione stdin

`ProcessTerminal.start()`:

1. Abilita la modalità raw e il bracketed paste.
2. Registra il gestore di resize.
3. Crea un `StdinBuffer` per suddividere i chunk parziali di escape in sequenze complete.
4. Interroga il supporto al protocollo tastiera Kitty (`CSI ? u`), quindi abilita i flag del protocollo se supportato.
5. Su Windows, tenta l'abilitazione dell'input VT tramite i flag di modalità di `kernel32`.

Comportamento di `StdinBuffer`:

- Memorizza sequenze di escape frammentate (CSI/OSC/DCS/APC/SS3).
- Emette `data` solo quando una sequenza è completa o svuotata per timeout.
- Rileva il bracketed paste ed emette un evento `paste` con il testo incollato grezzo.

Questo impedisce che chunk parziali di escape vengano interpretati erroneamente come pressioni normali di tasti.

## Routing dell'input e modello di focus

Percorso dell'input:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Dettagli del routing:

1. La TUI esegue prima i listener di input registrati (`addInputListener`), consentendo comportamenti di consumo/trasformazione.
2. La TUI gestisce la scorciatoia globale di debug (`shift+ctrl+d`) prima del dispatch al componente.
3. Se il componente con focus appartiene a un overlay che ora è nascosto/invisibile, la TUI riassegna il focus al prossimo overlay visibile o al focus pre-overlay salvato.
4. Gli eventi di rilascio tasto vengono filtrati a meno che il componente con focus non imposti `wantsKeyRelease = true`.
5. Dopo il dispatch, la TUI pianifica il render.

`setFocus()` inoltre commuta `Focusable.focused`, che controlla se i componenti emettono `CURSOR_MARKER` per il posizionamento del cursore hardware.

## Suddivisione della gestione tasti: editor vs controller

`CustomEditor` intercetta prima le combinazioni ad alta priorità (escape, ctrl-c/d/z, ctrl-v, varianti ctrl-p, ctrl-t, alt-up, tasti personalizzati delle estensioni) e delega il resto al comportamento base di `Editor` (editing del testo, cronologia, autocompletamento, movimento del cursore).

`InputController.setupKeyHandlers()` quindi associa le callback dell'editor alle azioni della modalità:

- cancellazione / uscite dalla modalità su `Escape`
- shutdown su doppio `Ctrl+C` o `Ctrl+D` con editor vuoto
- sospensione/ripresa su `Ctrl+Z`
- comandi slash e hotkey dei selettori
- toggle di follow-up/dequeue e toggle di espansione

Questo mantiene il parsing dei tasti e le meccaniche dell'editor in `packages/tui` e la semantica delle modalità nei controller di coding-agent.

## Ciclo di render e strategia di diffing

`TUI.requestRender()` è sottoposto a debounce di un render per tick usando `process.nextTick`. Più cambiamenti di stato nello stesso turno vengono coalizzati.

Pipeline di `#doRender()`:

1. Renderizza l'albero dei componenti root in `newLines`.
2. Compone gli overlay visibili (se presenti).
3. Estrae e rimuove il `CURSOR_MARKER` dalle righe visibili del viewport.
4. Aggiunge suffissi di reset del segmento per le righe non-immagine.
5. Sceglie tra ridisegno completo e patch differenziale:
   - primo frame
   - cambio di larghezza
   - restringimento con `clearOnShrink` abilitato e nessun overlay
   - modifiche sopra il viewport precedente
6. Per aggiornamenti differenziali, applica patch solo all'intervallo di righe modificate e pulisce le righe finali obsolete quando necessario.
7. Riposiziona il cursore hardware per il supporto IME.

Le scritture di render utilizzano la modalità di output sincronizzato (`CSI ? 2026 h/l`) per ridurre sfarfallio/tearing.

## Vincoli di sicurezza del render

Controlli di sicurezza critici nella TUI:

- Le righe renderizzate non-immagine non devono superare la larghezza del terminale; l'overflow lancia un'eccezione e scrive diagnostiche di crash.
- La composizione degli overlay include troncamento difensivo e verifica della larghezza post-composizione.
- I cambiamenti di larghezza forzano un ridisegno completo perché la semantica del wrapping cambia.
- La posizione del cursore viene limitata prima del movimento.

Questi vincoli sono enforcement a runtime, non semplici convenzioni.

## Gestione del resize

Gli eventi di resize sono guidati da eventi da `ProcessTerminal` a `TUI.requestRender()`.

Effetti:

- Qualsiasi cambio di larghezza attiva un ridisegno completo.
- Il tracciamento del viewport/top (`#previousViewportTop`, `#maxLinesRendered`) evita calcoli relativi del cursore non validi quando il contenuto o la dimensione del terminale cambiano.
- La visibilità degli overlay può dipendere dalle dimensioni del terminale (`OverlayOptions.visible`); il focus viene corretto quando gli overlay diventano non visibili dopo un resize.

## Streaming e aggiornamenti UI incrementali

`EventController` si sottoscrive agli `AgentSessionEvent` e aggiorna la UI incrementalmente:

- `agent_start`: avvia il loader in `statusContainer`.
- `message_start` assistente: crea `streamingComponent` e lo monta.
- `message_update`: aggiorna il contenuto dell'assistente in streaming; crea/aggiorna i componenti di esecuzione tool man mano che appaiono le chiamate tool.
- `tool_execution_update/end`: aggiorna i componenti dei risultati tool e lo stato di completamento.
- `message_end`: finalizza lo stream dell'assistente, gestisce le annotazioni di abort/errore, segna gli argomenti tool in sospeso come completi in caso di stop normale.
- `agent_end`: ferma i loader, pulisce lo stato transitorio dello stream, esegue il flush del cambio modello differito, emette notifica di completamento se in background.

Il raggruppamento dei tool di lettura è intenzionalmente stateful (`#lastReadGroup`) per coalizzare chiamate consecutive di tool di lettura in un unico blocco visivo finché non si verifica un'interruzione non-read.

## Orchestrazione di stato e loader

Responsabilità della corsia di stato:

- `statusContainer` contiene i loader transitori (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` renderizza indicatori persistenti di stato/hook/plan e guida gli aggiornamenti del bordo superiore dell'editor.

Comportamento dei loader:

- `Loader` si aggiorna ogni 80ms tramite intervallo e richiede il render ad ogni frame.
- I gestori di escape vengono temporaneamente sovrascritti durante l'auto-compaction e l'auto-retry per annullare quelle operazioni.
- Nei percorsi di fine/cancellazione, i controller ripristinano i gestori di escape precedenti e fermano/puliscono i componenti loader.

## Transizioni di modalità e backgrounding

### Modalità di input Bash/Python

I prefissi del testo di input commutano i flag di modalità del bordo dell'editor:

- `!` -> modalità bash
- `$` (prefisso non template literal) -> modalità python

Escape esce dalla modalità inattiva pulendo il testo dell'editor e ripristinando il colore del bordo; quando un'esecuzione è attiva, escape interrompe invece il task in esecuzione.

### Modalità plan

`InteractiveMode` traccia i flag della modalità plan, lo stato della status-line, i tool attivi e il cambio modello. Entrata/uscita aggiorna le voci di modalità della sessione e lo stato UI/stato, incluso il cambio modello differito se lo streaming è attivo.

### Sospensione/ripresa (`Ctrl+Z`)

`InputController.handleCtrlZ()`:

1. Registra un gestore one-shot `SIGCONT` per riavviare la TUI e forzare il render.
2. Ferma la TUI prima della sospensione.
3. Invia `SIGTSTP` al gruppo di processi.

### Modalità background (`/background` o `/bg`)

`handleBackgroundCommand()`:

- Rifiuta quando inattivo.
- Cambia il contesto UI dei tool a non-interattivo (`hasUI=false`) così i tool UI interattivi falliscono rapidamente.
- Ferma loader/status line e annulla la sottoscrizione al gestore eventi in foreground.
- Sottoscrive il gestore eventi in background (principalmente attende `agent_end`).
- Ferma la TUI e invia `SIGTSTP` (percorso di job control POSIX).

Su `agent_end` in background senza lavoro in coda, il controller invia una notifica di completamento e si spegne.

## Percorsi di cancellazione

Input primari di cancellazione:

- `Escape` durante il loader di stream attivo: ripristina i messaggi in coda nell'editor e interrompe l'agente.
- `Escape` durante l'esecuzione bash/python: interrompe il comando in esecuzione.
- `Escape` durante auto-compaction/retry: invoca metodi di abort dedicati attraverso gestori di escape temporanei.
- `Ctrl+C` singola pressione: pulisce l'editor; doppia pressione entro 500ms: shutdown.

La cancellazione è condizionale allo stato; lo stesso tasto può significare abort, uscita dalla modalità, trigger del selettore o no-op a seconda dello stato del runtime.

## Comportamento event-driven vs throttled

Aggiornamenti event-driven:

- Eventi della sessione agente (`EventController`)
- Callback di input dei tasti (`InputController`)
- Callback di resize del terminale
- Watcher di tema/branch in `InteractiveMode`

Percorsi throttled/debounced:

- Il rendering della TUI è sottoposto a debounce per tick (coalescenza di `requestRender`).
- L'animazione del loader è a intervallo fisso (80ms), ogni frame richiede il render.
- Gli aggiornamenti dell'autocompletamento dell'editor (dentro `Editor`) usano timer di debounce, riducendo il ricalcolo eccessivo durante la digitazione.

Il runtime quindi mescola transizioni di stato event-driven con una cadenza di render limitata per mantenere l'interattività reattiva senza tempeste di ridisegno.
