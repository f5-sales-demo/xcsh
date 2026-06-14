---
title: Runtime dello strumento Bash
description: >-
  Runtime dello strumento Bash con gestione dei processi shell, sandboxing,
  timeout e streaming dell'output.
sidebar:
  order: 1
  label: Strumento Bash
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# Runtime dello strumento Bash

Questo documento descrive il percorso di runtime dello **strumento `bash`** utilizzato dalle chiamate agli strumenti dell'agente, dalla normalizzazione del comando all'esecuzione, troncamento/artefatti e rendering.

Illustra inoltre dove il comportamento diverge nella TUI interattiva, nella modalità print, nella modalità RPC e nell'esecuzione shell bang (`!`) avviata dall'utente.

## Ambito e superfici di runtime

Esistono due diverse superfici di esecuzione bash nell'agente di codice:

1. **Superficie delle chiamate agli strumenti** (`toolName: "bash"`): utilizzata quando il modello chiama lo strumento bash.
   - Punto di ingresso: `BashTool.execute()`.
2. **Superficie dei comandi bang utente** (`!cmd` dall'input interattivo o comando RPC `bash`): percorso helper a livello di sessione.
   - Punto di ingresso: `AgentSession.executeBash()`.

Entrambi utilizzano infine `executeBash()` in `src/exec/bash-executor.ts` per l'esecuzione non-PTY, ma solo il percorso delle chiamate agli strumenti esegue la logica di normalizzazione/intercettazione e del renderer degli strumenti.

## Pipeline end-to-end delle chiamate agli strumenti

## 1) Normalizzazione dell'input e unione dei parametri

`BashTool.execute()` normalizza prima il comando raw tramite `normalizeBashCommand()`:

- estrae i `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N` finali in limiti strutturati,
- elimina gli spazi bianchi iniziali e finali,
- mantiene intatti gli spazi bianchi interni.

Quindi unisce i limiti estratti con gli argomenti espliciti dello strumento:

- gli argomenti espliciti `head`/`tail` sovrascrivono i valori estratti,
- i valori estratti sono solo di riserva.

### Avvertenza

I commenti in `bash-normalize.ts` menzionano la rimozione di `2>&1`, ma l'implementazione attuale non la elimina. Il comportamento a runtime è comunque corretto (stdout/stderr sono già uniti), ma il comportamento di normalizzazione è più limitato rispetto a quanto suggeriscono i commenti.

## 2) Intercettazione opzionale (percorso dei comandi bloccati)

Se `bashInterceptor.enabled` è true, `BashTool` carica le regole dalle impostazioni ed esegue `checkBashInterception()` sul comando normalizzato.

Comportamento di intercettazione:

- il comando viene bloccato **solo** quando:
  - la regola regex corrisponde, e
  - lo strumento suggerito è presente in `ctx.toolNames`.
- le regole regex non valide vengono ignorate silenziosamente.
- al blocco, `BashTool` genera un `ToolError` con messaggio:
  - `Blocked: ...`
  - comando originale incluso.

I pattern delle regole predefinite (definiti nel codice) sono mirati agli usi impropri comuni:

- lettori di file (`cat`, `head`, `tail`, ...)
- strumenti di ricerca (`grep`, `rg`, ...)
- ricercatori di file (`find`, `fd`, ...)
- editor in-place (`sed -i`, `perl -i`, `awk -i inplace`)
- scritture con reindirizzamento shell (`echo ... > file`, reindirizzamento heredoc)

### Avvertenza

`InterceptionResult` include `suggestedTool`, ma `BashTool` attualmente espone solo il testo del messaggio (nessun campo strutturato per lo strumento suggerito in `details`).

## 3) Validazione CWD e limitazione del timeout

`cwd` viene risolto relativamente alla cwd della sessione (`resolveToCwd`), quindi validato tramite `stat`:

- percorso mancante -> `ToolError("Working directory does not exist: ...")`
- non è una directory -> `ToolError("Working directory is not a directory: ...")`

Il timeout è limitato all'intervallo `[1, 3600]` secondi e convertito in millisecondi.

## 4) Allocazione degli artefatti

Prima dell'esecuzione, lo strumento alloca un percorso/id artefatto (best-effort) per la memorizzazione dell'output troncato.

- il fallimento dell'allocazione dell'artefatto non è fatale (l'esecuzione continua senza file di spill dell'artefatto),
- l'id/percorso dell'artefatto viene passato nel percorso di esecuzione per la persistenza dell'output completo in caso di troncamento.

## 5) Selezione dell'esecuzione PTY vs non-PTY

`BashTool` sceglie l'esecuzione PTY solo quando tutte le condizioni sono vere:

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- il contesto dello strumento ha una UI (`ctx.hasUI === true` e `ctx.ui` impostato)

Altrimenti utilizza `executeBash()` non interattivo.

Ciò significa che la modalità print e i contesti RPC/strumenti senza UI utilizzano sempre la modalità non-PTY.

## Motore di esecuzione non interattivo (`executeBash`)

## Modello di riutilizzo delle sessioni shell

`executeBash()` memorizza nella cache le istanze native di `Shell` in una mappa globale al processo con chiave basata su:

- percorso shell,
- prefisso del comando configurato,
- percorso snapshot,
- env shell serializzato,
- chiave di sessione agente opzionale.

Per le esecuzioni a livello di sessione, `AgentSession.executeBash()` passa `sessionKey: this.sessionId`, isolando il riutilizzo per sessione.

Il percorso delle chiamate agli strumenti **non** passa `sessionKey`, quindi l'ambito di riutilizzo è basato sulla configurazione shell/snapshot/env.

## Configurazione shell e comportamento degli snapshot

A ogni chiamata, l'executor carica la configurazione shell dalle impostazioni (`shell`, `env`, `prefix` opzionale).

Se la shell selezionata include `bash`, tenta `getOrCreateSnapshot()`:

- lo snapshot cattura alias/funzioni/opzioni dall'rc utente,
- la creazione dello snapshot è best-effort,
- in caso di fallimento, viene utilizzata la modalità senza snapshot.

Se è configurato `prefix`, il comando diventa:

```text
<prefix> <command>
```

## Streaming e cancellazione

`Shell.run()` trasmette i chunk in streaming alla callback. L'executor instrada ogni chunk in `OutputSink` e nella callback opzionale `onChunk`.

Cancellazione:

- il segnale interrotto attiva `shellSession.abort(...)`,
- il timeout dal risultato nativo viene mappato a `cancelled: true` + testo di annotazione,
- la cancellazione esplicita restituisce analogamente `cancelled: true` + annotazione.

All'interno dell'executor non viene generata alcuna eccezione per timeout/annullamento; restituisce un `BashResult` strutturato e lascia che il chiamante gestisca la semantica degli errori.

## Percorso PTY interattivo (`runInteractiveBashPty`)

Quando PTY è abilitato, lo strumento esegue `runInteractiveBashPty()` che apre un componente overlay della console e gestisce una `PtySession` nativa.

Punti salienti del comportamento:

- il terminale virtuale xterm-headless renderizza il viewport nell'overlay,
- l'input da tastiera è normalizzato (inclusa la gestione delle sequenze Kitty e della modalità cursore applicazione),
- `esc` durante l'esecuzione termina la sessione PTY,
- il ridimensionamento del terminale si propaga al PTY (`session.resize(cols, rows)`).

I valori predefiniti di rafforzamento dell'ambiente vengono iniettati per le esecuzioni non presidiate:

- pager disabilitati (`PAGER=cat`, `GIT_PAGER=cat`, ecc.),
- prompt dell'editor disabilitati (`GIT_EDITOR=true`, `EDITOR=true`, ...),
- prompt del terminale/autenticazione ridotti (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`),
- flag di automazione dei package manager/strumenti per il comportamento non interattivo.

L'output PTY è normalizzato (`CRLF`/`CR` in `LF`, `sanitizeText`) e scritto in `OutputSink`, incluso il supporto allo spill degli artefatti.

In caso di errore di avvio/runtime PTY, il sink riceve la riga `PTY error: ...` e il comando si finalizza con codice di uscita indefinito.

## Gestione dell'output: streaming, troncamento, spill degli artefatti

Sia i percorsi PTY che non-PTY utilizzano `OutputSink`.

## Semantica di OutputSink

- mantiene un buffer tail in memoria con codifica UTF-8 sicura (`DEFAULT_MAX_BYTES`, attualmente 50KB),
- tiene traccia dei byte/righe totali osservati,
- se esiste un percorso artefatto e l'output supera la soglia (o il file è già attivo), scrive il flusso completo nel file artefatto,
- quando la soglia di memoria viene superata, taglia il buffer in memoria fino alla coda (sicuro per i confini UTF-8),
- contrassegna `truncated` quando si verifica un overflow/spill su file.

`dump()` restituisce:

- `output` (con eventuale prefisso annotato),
- `truncated`,
- `totalLines/totalBytes`,
- `outputLines/outputBytes`,
- `artifactId` se il file artefatto era attivo.

### Avvertenza per output lunghi

Il troncamento a runtime è basato sulla soglia in byte in `OutputSink` (50KB predefiniti). Non applica un limite rigido di 2000 righe in questo percorso di codice.

## Aggiornamenti in tempo reale degli strumenti

Per l'esecuzione non-PTY, `BashTool` utilizza un `TailBuffer` separato per gli aggiornamenti parziali ed emette snapshot `onUpdate` mentre il comando è in esecuzione.

Per l'esecuzione PTY, il rendering in tempo reale è gestito dall'overlay UI personalizzato, non dai chunk di testo `onUpdate`.

## Modellazione del risultato, metadati e mapping degli errori

Dopo l'esecuzione:

1. Gestione di `cancelled`:
   - se il segnale di interruzione è interrotto -> genera `ToolAbortError` (semantica di interruzione),
   - altrimenti -> genera `ToolError` (trattato come fallimento dello strumento).
2. PTY `timedOut` -> genera `ToolError`.
3. applica i filtri head/tail al testo di output finale (`applyHeadTail`, prima head poi tail).
4. l'output vuoto diventa `(no output)`.
5. allega i metadati di troncamento tramite `toolResult(...).truncationFromSummary(result, { direction: "tail" })`.
6. mapping del codice di uscita:
   - codice di uscita mancante -> `ToolError("... missing exit status")`
   - uscita non-zero -> `ToolError("... Command exited with code N")`
   - uscita zero -> risultato di successo.

Struttura del payload di successo:

- `content`: output testuale,
- `details.meta.truncation` quando troncato, incluso:
  - `direction`, `truncatedBy`, conteggi totali/output di righe+byte,
  - `shownRange`,
  - `artifactId` quando disponibile.

Poiché gli strumenti integrati sono avvolti con `wrapToolWithMetaNotice()`, il testo di avviso di troncamento viene aggiunto automaticamente al contenuto testuale finale (ad esempio: `Full: artifact://<id>`).

## Percorsi di rendering

## Renderer delle chiamate agli strumenti (`bashToolRenderer`)

`bashToolRenderer` è utilizzato per i messaggi delle chiamate agli strumenti (`toolCall` / `toolResult`):

- la modalità compressa mostra un'anteprima troncata per riga visiva,
- la modalità espansa mostra tutto il testo di output attualmente disponibile,
- la riga di avviso include il motivo del troncamento e `artifact://<id>` quando troncato,
- il valore del timeout (dagli argomenti) è mostrato nella riga dei metadati del piè di pagina.

### Avvertenza: espansione completa dell'artefatto

`BashRenderContext` ha `isFullOutput`, ma il builder del contesto del renderer attuale non lo imposta per i risultati degli strumenti bash. La visualizzazione espansa utilizza ancora il testo già nel contenuto del risultato (output tail/troncato) a meno che un altro chiamante non fornisca il contenuto completo dell'artefatto.

## Componente del comando bang utente (`BashExecutionComponent`)

`BashExecutionComponent` è per i comandi `!` utente in modalità interattiva (non per le chiamate agli strumenti del modello):

- trasmette i chunk in streaming in tempo reale,
- l'anteprima compressa mantiene le ultime 20 righe logiche,
- limite di riga a 4000 caratteri per riga,
- mostra avvisi di troncamento + artefatto quando i metadati sono presenti,
- contrassegna lo stato di cancellato/errore/uscita separatamente.

Questo componente è collegato da `CommandController.handleBashCommand()` e alimentato da `AgentSession.executeBash()`.

## Differenze di comportamento specifiche per modalità

| Superficie                          | Percorso di ingresso                                  | PTY eleggibile                                                              | UX output in tempo reale                                                        | Esposizione degli errori                                         |
| ----------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Chiamata agli strumenti interattiva | `BashTool.execute`                                    | Sì, quando `bash.virtualTerminal=on` e UI esiste e `PI_NO_PTY!=1`           | Overlay PTY (interattivo) o aggiornamenti tail in streaming                     | Gli errori dello strumento diventano `toolResult.isError`        |
| Chiamata agli strumenti in modalità print | `BashTool.execute`                             | No (nessun contesto UI)                                                     | Nessun overlay TUI; l'output appare nel flusso di eventi/testo finale dell'assistente | Stesso mapping degli errori dello strumento                |
| Chiamata agli strumenti RPC (tooling agente) | `BashTool.execute`                          | Di solito nessuna UI -> non-PTY                                             | Eventi/risultati strutturati dello strumento                                    | Stesso mapping degli errori dello strumento                      |
| Comando bang interattivo (`!`)      | `AgentSession.executeBash` + `BashExecutionComponent` | No (utilizza direttamente l'executor)                                       | Componente di esecuzione bash dedicato                                          | Il controller cattura le eccezioni e mostra l'errore UI          |
| Comando RPC `bash`                  | `rpc-mode` -> `session.executeBash`                   | No                                                                          | Restituisce direttamente `BashResult`                                           | Il consumer gestisce i campi restituiti                          |

## Avvertenze operative

- L'interceptor blocca i comandi solo quando lo strumento suggerito è attualmente disponibile nel contesto.
- Se l'allocazione dell'artefatto fallisce, il troncamento avviene comunque ma non è disponibile alcun riferimento `artifact://`.
- La cache delle sessioni shell non ha un'eliminazione esplicita in questo modulo; il ciclo di vita è limitato al processo.
- Le superfici di timeout PTY e non-PTY differiscono:
  - PTY espone il campo risultato esplicito `timedOut`,
  - non-PTY mappa il timeout in un riepilogo `cancelled + annotation`.

## File di implementazione

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — punto di ingresso dello strumento, normalizzazione/intercettazione, selezione PTY/non-PTY, mapping risultati/errori, renderer dello strumento bash.
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — normalizzazione dei comandi e filtraggio head/tail post-esecuzione.
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — corrispondenza delle regole dell'interceptor e messaggi dei comandi bloccati.
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — executor non-PTY, riutilizzo delle sessioni shell, collegamento della cancellazione, integrazione del sink di output.
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — runtime PTY, overlay UI, normalizzazione dell'input, valori predefiniti env non interattivi.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — troncamento/spill degli artefatti `OutputSink` e metadati di riepilogo.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — helper per l'allocazione degli artefatti e buffer tail di streaming.
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — forma dei metadati di troncamento + wrapper di iniezione degli avvisi.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `executeBash` a livello di sessione, registrazione dei messaggi, ciclo di vita dell'interruzione.
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — componente di esecuzione del comando `!` interattivo.
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — collegamento per il completamento dello stream/aggiornamento UI del comando `!` interattivo.
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — superficie dei comandi RPC `bash` e `abort_bash`.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — risoluzione di `artifact://<id>`.
