---
title: Componenti interni del runtime TUI
description: >-
  Componenti interni del runtime dell'interfaccia utente terminale, con
  copertura della pipeline di rendering, gestione degli input e gestione dello
  stato.
sidebar:
  order: 2
  label: Componenti interni del runtime
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# Componenti interni del runtime TUI

Questo documento mappa il percorso del runtime non-tema dall'input del terminale all'output renderizzato in modalità interattiva. Si concentra sul comportamento in `packages/tui` e sulla sua integrazione dai controller di `packages/coding-agent`.

## Livelli del runtime e responsabilità

- **Engine `packages/tui`**: ciclo di vita del terminale, normalizzazione stdin, instradamento del focus, pianificazione del rendering, pittura differenziale, composizione degli overlay, posizionamento hardware del cursore.
- **Modalità interattiva di `packages/coding-agent`**: costruisce l'albero dei componenti, associa callback dell'editor e keymaps, reagisce agli eventi agente/sessione e traduce lo stato del dominio (streaming, esecuzione degli strumenti, tentativi, modalità piano) in componenti UI.

Regola di confine: l'engine TUI è agnostico rispetto ai messaggi. Conosce solo `Component.render(width)`, `handleInput(data)`, il focus e gli overlay. La semantica dell'agente rimane nei controller interattivi.

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

`init()` collega l'albero in quest'ordine, mette a fuoco l'editor, registra i gestori di input tramite `InputController`, avvia TUI e richiede un rendering forzato.

Un rendering forzato (`requestRender(true)`) azzera le cache delle righe precedenti e la contabilità del cursore prima di ridipingere.

## Ciclo di vita del terminale e normalizzazione stdin

`ProcessTerminal.start()`:

1. Abilita la modalità raw e il paste tra parentesi.
2. Associa il gestore di ridimensionamento.
3. Crea uno `StdinBuffer` per suddividere i blocchi di escape parziali in sequenze complete.
4. Interroga il supporto del protocollo tastiera Kitty (`CSI ? u`), quindi abilita i flag di protocollo se supportati.
5. Su Windows, tenta l'abilitazione dell'input VT tramite i flag di modalità `kernel32`.

Comportamento di `StdinBuffer`:

- Bufferizza le sequenze di escape frammentate (CSI/OSC/DCS/APC/SS3).
- Emette `data` solo quando una sequenza è completa o viene svuotata per timeout.
- Rileva il paste tra parentesi ed emette un evento `paste` con il testo incollato grezzo.

Ciò impedisce che i blocchi di escape parziali vengano interpretati erroneamente come normali pressioni di tasti.

## Instradamento dell'input e modello di focus

Percorso dell'input:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Dettagli dell'instradamento:

1. TUI esegue prima i listener di input registrati (`addInputListener`), consentendo comportamenti di consumo/trasformazione.
2. TUI gestisce la scorciatoia di debug globale (`shift+ctrl+d`) prima del dispatch al componente.
3. Se il componente con focus appartiene a un overlay ora nascosto/invisibile, TUI riassegna il focus al prossimo overlay visibile o al focus pre-overlay salvato.
4. Gli eventi di rilascio tasto vengono filtrati a meno che il componente con focus non imposti `wantsKeyRelease = true`.
5. Dopo il dispatch, TUI pianifica il rendering.

`setFocus()` alterna anche `Focusable.focused`, che controlla se i componenti emettono `CURSOR_MARKER` per il posizionamento hardware del cursore.

## Suddivisione della gestione dei tasti: editor vs controller

`CustomEditor` intercetta prima le combinazioni ad alta priorità (escape, ctrl-c/d/z, ctrl-v, varianti ctrl-p, ctrl-t, alt-su, tasti personalizzati delle estensioni) e delega il resto al comportamento base di `Editor` (modifica del testo, cronologia, completamento automatico, movimento del cursore).

`InputController.setupKeyHandlers()` associa quindi i callback dell'editor alle azioni di modalità:

- annullamento / uscita dalla modalità con `Escape`
- arresto con doppio `Ctrl+C` o `Ctrl+D` con editor vuoto
- sospensione/ripresa con `Ctrl+Z`
- hotkey di comandi slash e selettori
- attivazione/disattivazione dei toggle follow-up/dequeue e toggle di espansione

Questo mantiene l'analisi dei tasti/meccaniche dell'editor in `packages/tui` e la semantica della modalità nei controller di coding-agent.

## Loop di rendering e strategia di diffing

`TUI.requestRender()` è de-rimbalzato a un rendering per tick usando `process.nextTick`. Più cambiamenti di stato nello stesso turno si fondono insieme.

Pipeline `#doRender()`:

1. Renderizza l'albero dei componenti radice in `newLines`.
2. Compone gli overlay visibili (se presenti).
3. Estrae e rimuove `CURSOR_MARKER` dalle righe del viewport visibile.
4. Aggiunge suffissi di reset del segmento per le righe non-immagine.
5. Sceglie tra ridipintura completa e patch differenziale:
   - primo frame
   - cambio di larghezza
   - riduzione con `clearOnShrink` abilitato e nessun overlay
   - modifiche sopra il viewport precedente
6. Per gli aggiornamenti differenziali, corregge solo l'intervallo di righe modificate e cancella le righe finali obsolete quando necessario.
7. Riposiziona il cursore hardware per il supporto IME.

Le scritture di rendering utilizzano la modalità di output sincronizzato (`CSI ? 2026 h/l`) per ridurre lo sfarfallio/tearing.

## Vincoli di sicurezza del rendering

Controlli di sicurezza critici in `TUI`:

- Le righe renderizzate non-immagine non devono superare la larghezza del terminale; l'overflow genera un'eccezione e scrive diagnostiche di crash.
- La composizione degli overlay include troncamento difensivo e verifica della larghezza post-composizione.
- I cambiamenti di larghezza forzano un ridisegno completo perché la semantica del wrapping cambia.
- La posizione del cursore viene limitata prima del movimento.

Questi vincoli sono applicazioni a runtime, non semplici convenzioni.

## Gestione del ridimensionamento

Gli eventi di ridimensionamento sono guidati dagli eventi da `ProcessTerminal` a `TUI.requestRender()`.

Effetti:

- Qualsiasi cambio di larghezza attiva un ridisegno completo.
- Il tracciamento del viewport/top (`#previousViewportTop`, `#maxLinesRendered`) evita calcoli relativi del cursore non validi quando il contenuto o le dimensioni del terminale cambiano.
- La visibilità degli overlay può dipendere dalle dimensioni del terminale (`OverlayOptions.visible`); il focus viene corretto quando gli overlay diventano non visibili dopo il ridimensionamento.

## Aggiornamenti UI in streaming e incrementali

`EventController` si iscrive a `AgentSessionEvent` e aggiorna l'UI in modo incrementale:

- `agent_start`: avvia il loader in `statusContainer`.
- `message_start` assistant: crea `streamingComponent` e lo monta.
- `message_update`: aggiorna il contenuto dell'assistant in streaming; crea/aggiorna i componenti di esecuzione degli strumenti man mano che appaiono le chiamate agli strumenti.
- `tool_execution_update/end`: aggiorna i componenti del risultato degli strumenti e lo stato di completamento.
- `message_end`: finalizza lo stream dell'assistant, gestisce le annotazioni di interruzione/errore, contrassegna gli argomenti degli strumenti in sospeso come completi all'arresto normale.
- `agent_end`: arresta i loader, cancella lo stato di stream transitorio, svuota il cambio di modello differito, emette la notifica di completamento se in background.

Il raggruppamento degli strumenti di lettura è intenzionalmente stateful (`#lastReadGroup`) per unire chiamate consecutive agli strumenti di lettura in un unico blocco visivo fino a quando non si verifica un'interruzione non-read.

## Orchestrazione di stato e loader

Proprietà della corsia di stato:

- `statusContainer` contiene i loader transitori (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` renderizza gli indicatori persistenti di stato/hook/piano e guida gli aggiornamenti del bordo superiore dell'editor.

Comportamento del loader:

- `Loader` si aggiorna ogni 80ms tramite intervallo e richiede il rendering a ogni frame.
- I gestori Escape vengono temporaneamente sovrascritti durante la compattazione automatica e il tentativo automatico per annullare tali operazioni.
- Nei percorsi di fine/annullamento, i controller ripristinano i gestori escape precedenti e arrestano/cancellano i componenti loader.

## Transizioni di modalità e background

### Modalità di input Bash/Python

I prefissi del testo di input attivano i flag di modalità del bordo dell'editor:

- `!` -> modalità bash
- `$` (prefisso non-template literal) -> modalità python

Escape esce dalla modalità inattiva cancellando il testo dell'editor e ripristinando il colore del bordo; quando l'esecuzione è attiva, escape interrompe invece l'attività in corso.

### Modalità piano

`InteractiveMode` tiene traccia dei flag della modalità piano, dello stato della riga di stato, degli strumenti attivi e del cambio di modello. L'entrata/uscita aggiorna le voci della modalità sessione e lo stato UI/stato, incluso il cambio di modello differito se lo streaming è attivo.

### Sospensione/ripresa (`Ctrl+Z`)

`InputController.handleCtrlZ()`:

1. Registra un gestore `SIGCONT` one-shot per riavviare TUI e forzare il rendering.
2. Arresta TUI prima della sospensione.
3. Invia `SIGTSTP` al gruppo di processi.

### Modalità background (`/background` o `/bg`)

`handleBackgroundCommand()`:

- Rifiuta quando inattivo.
- Cambia il contesto UI degli strumenti a non-interattivo (`hasUI=false`) in modo che gli strumenti UI interattivi falliscano rapidamente.
- Arresta i loader/la riga di stato e annulla l'iscrizione al gestore di eventi in primo piano.
- Si iscrive al gestore di eventi in background (principalmente in attesa di `agent_end`).
- Arresta TUI e invia `SIGTSTP` (percorso di controllo lavori POSIX).

All'evento `agent_end` in background senza lavoro in coda, il controller invia la notifica di completamento e si arresta.

## Percorsi di annullamento

Input primari di annullamento:

- `Escape` durante il loader di stream attivo: ripristina i messaggi in coda nell'editor e interrompe l'agente.
- `Escape` durante l'esecuzione bash/python: interrompe il comando in esecuzione.
- `Escape` durante la compattazione automatica/tentativo: richiama metodi di interruzione dedicati tramite gestori escape temporanei.
- `Ctrl+C` pressione singola: cancella l'editor; doppia pressione entro 500ms: arresto.

L'annullamento è condizionato dallo stato; la stessa chiave può significare interruzione, uscita dalla modalità, attivazione del selettore o nessuna operazione a seconda dello stato a runtime.

## Comportamento guidato dagli eventi vs a limitazione di frequenza

Aggiornamenti guidati dagli eventi:

- Eventi della sessione agente (`EventController`)
- Callback di input dei tasti (`InputController`)
- Callback di ridimensionamento del terminale
- Osservatori di tema/branch in `InteractiveMode`

Percorsi a limitazione di frequenza/de-rimbalzo:

- Il rendering TUI è de-rimbalzato per tick (fusione di `requestRender`).
- L'animazione del loader è a intervallo fisso (80ms), con ogni frame che richiede il rendering.
- Gli aggiornamenti di completamento automatico dell'editor (all'interno di `Editor`) utilizzano timer de-rimbalzo, riducendo il ricalcolo durante la digitazione.

Il runtime combina quindi transizioni di stato guidate dagli eventi con una cadenza di rendering limitata per mantenere la reattività dell'interazione senza tempeste di ridipintura.
