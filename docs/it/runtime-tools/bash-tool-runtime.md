---
title: Bash Tool Runtime
description: >-
  Bash tool runtime with shell process management, sandboxing, timeout, and
  output streaming.
sidebar:
  order: 1
  label: Bash tool
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# Runtime dello strumento bash

Questo documento descrive il percorso runtime dello **strumento `bash`** utilizzato dalle chiamate a strumenti dell'agente, dalla normalizzazione dei comandi all'esecuzione, troncamento/artefatti e rendering.

Evidenzia inoltre dove il comportamento diverge nella TUI interattiva, nella modalità print, nella modalità RPC e nell'esecuzione shell avviata dall'utente con il bang (`!`).

## Ambito e superfici di runtime

Esistono due diverse superfici di esecuzione bash in coding-agent:

1. **Superficie tool-call** (`toolName: "bash"`): utilizzata quando il modello invoca lo strumento bash.
   - Punto di ingresso: `BashTool.execute()`.
2. **Superficie comando bang dell'utente** (`!cmd` dall'input interattivo o comando RPC `bash`): percorso helper a livello di sessione.
   - Punto di ingresso: `AgentSession.executeBash()`.

Entrambe utilizzano infine `executeBash()` in `src/exec/bash-executor.ts` per l'esecuzione non-PTY, ma solo il percorso tool-call esegue la logica di normalizzazione/intercettazione e il renderer dello strumento.

## Pipeline end-to-end della tool-call

## 1) Normalizzazione dell'input e merge dei parametri

`BashTool.execute()` prima normalizza il comando grezzo tramite `normalizeBashCommand()`:

- estrae i trailing `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N` in limiti strutturati,
- rimuove spazi bianchi iniziali/finali,
- mantiene intatti gli spazi bianchi interni.

Poi effettua il merge dei limiti estratti con gli argomenti espliciti dello strumento:

- gli argomenti espliciti `head`/`tail` sovrascrivono i valori estratti,
- i valori estratti sono solo fallback.

### Nota

I commenti in `bash-normalize.ts` menzionano la rimozione di `2>&1`, ma l'implementazione corrente non lo rimuove. Il comportamento a runtime è comunque corretto (stdout/stderr sono già unificati), ma il comportamento di normalizzazione è più limitato di quanto suggeriscano i commenti.

## 2) Intercettazione opzionale (percorso comandi bloccati)

Se `bashInterceptor.enabled` è true, `BashTool` carica le regole dalle impostazioni ed esegue `checkBashInterception()` sul comando normalizzato.

Comportamento dell'intercettazione:

- il comando viene bloccato **solo** quando:
  - la regola regex corrisponde, e
  - lo strumento suggerito è presente in `ctx.toolNames`.
- le regole regex non valide vengono silenziosamente ignorate.
- in caso di blocco, `BashTool` lancia `ToolError` con messaggio:
  - `Blocked: ...`
  - comando originale incluso.

I pattern delle regole predefinite (definiti nel codice) prendono di mira usi impropri comuni:

- lettori di file (`cat`, `head`, `tail`, ...)
- strumenti di ricerca (`grep`, `rg`, ...)
- cercatori di file (`find`, `fd`, ...)
- editor in-place (`sed -i`, `perl -i`, `awk -i inplace`)
- scritture tramite redirezione shell (`echo ... > file`, redirezione heredoc)

### Nota

`InterceptionResult` include `suggestedTool`, ma `BashTool` attualmente espone solo il testo del messaggio (nessun campo strutturato suggested-tool in `details`).

## 3) Validazione CWD e clamping del timeout

`cwd` viene risolto relativamente alla cwd della sessione (`resolveToCwd`), poi validato tramite `stat`:

- percorso mancante -> `ToolError("Working directory does not exist: ...")`
- non è una directory -> `ToolError("Working directory is not a directory: ...")`

Il timeout viene limitato all'intervallo `[1, 3600]` secondi e convertito in millisecondi.

## 4) Allocazione dell'artefatto

Prima dell'esecuzione, lo strumento alloca un percorso/id artefatto (best-effort) per l'archiviazione dell'output troncato.

- il fallimento dell'allocazione dell'artefatto non è fatale (l'esecuzione continua senza file di spill dell'artefatto),
- id/percorso dell'artefatto vengono passati nel percorso di esecuzione per la persistenza dell'output completo in caso di troncamento.

## 5) Selezione dell'esecuzione PTY vs non-PTY

`BashTool` sceglie l'esecuzione PTY solo quando tutte le condizioni sono vere:

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- il contesto dello strumento ha una UI (`ctx.hasUI === true` e `ctx.ui` impostato)

Altrimenti utilizza `executeBash()` non interattivo.

Ciò significa che la modalità print e i contesti RPC/strumento senza UI utilizzano sempre il non-PTY.

## Motore di esecuzione non interattivo (`executeBash`)

## Modello di riutilizzo della sessione shell

`executeBash()` memorizza in cache istanze native `Shell` in una mappa globale al processo indicizzata per:

- percorso della shell,
- prefisso del comando configurato,
- percorso dello snapshot,
- env della shell serializzato,
- chiave opzionale della sessione dell'agente.

Per le esecuzioni a livello di sessione, `AgentSession.executeBash()` passa `sessionKey: this.sessionId`, isolando il riutilizzo per sessione.

Il percorso tool-call **non** passa `sessionKey`, quindi l'ambito di riutilizzo è basato sulla configurazione shell/snapshot/env.

## Configurazione shell e comportamento degli snapshot

Ad ogni chiamata, l'executor carica la configurazione shell dalle impostazioni (`shell`, `env`, `prefix` opzionale).

Se la shell selezionata include `bash`, tenta `getOrCreateSnapshot()`:

- lo snapshot cattura alias/funzioni/opzioni dall'rc dell'utente,
- la creazione dello snapshot è best-effort,
- il fallimento ricade su nessuno snapshot.

Se `prefix` è configurato, il comando diventa:

```text
<prefix> <command>
```

## Streaming e cancellazione

`Shell.run()` invia chunk in streaming al callback. L'executor inoltra ogni chunk in `OutputSink` e nel callback opzionale `onChunk`.

Cancellazione:

- il segnale abortito attiva `shellSession.abort(...)`,
- il timeout dal risultato nativo viene mappato a `cancelled: true` + testo di annotazione,
- la cancellazione esplicita restituisce similmente `cancelled: true` + annotazione.

Nessuna eccezione viene lanciata all'interno dell'executor per timeout/cancellazione; restituisce un `BashResult` strutturato e lascia al chiamante la mappatura della semantica degli errori.

## Percorso PTY interattivo (`runInteractiveBashPty`)

Quando il PTY è abilitato, lo strumento esegue `runInteractiveBashPty()` che apre un componente console overlay e guida una `PtySession` nativa.

Aspetti principali del comportamento:

- il terminale virtuale xterm-headless renderizza il viewport nell'overlay,
- l'input da tastiera viene normalizzato (inclusa la gestione delle sequenze Kitty e della modalità cursore applicazione),
- `esc` durante l'esecuzione termina la sessione PTY,
- il ridimensionamento del terminale viene propagato al PTY (`session.resize(cols, rows)`).

I valori predefiniti di hardening dell'ambiente vengono iniettati per le esecuzioni non presidiate:

- pager disabilitati (`PAGER=cat`, `GIT_PAGER=cat`, ecc.),
- prompt dell'editor disabilitati (`GIT_EDITOR=true`, `EDITOR=true`, ...),
- prompt del terminale/autenticazione ridotti (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`),
- flag di automazione per package manager/strumenti per comportamento non interattivo.

L'output PTY viene normalizzato (`CRLF`/`CR` in `LF`, `sanitizeText`) e scritto in `OutputSink`, incluso il supporto per lo spill dell'artefatto.

In caso di errore di avvio/runtime del PTY, il sink riceve la riga `PTY error: ...` e il comando si finalizza con codice di uscita indefinito.

## Gestione dell'output: streaming, troncamento, spill dell'artefatto

Sia i percorsi PTY che non-PTY utilizzano `OutputSink`.

## Semantica di OutputSink

- mantiene un buffer tail in memoria sicuro per UTF-8 (`DEFAULT_MAX_BYTES`, attualmente 50KB),
- traccia il totale di byte/righe osservati,
- se il percorso dell'artefatto esiste e l'output supera il limite (o il file è già attivo), scrive lo stream completo nel file dell'artefatto,
- quando la soglia di memoria viene superata, tronca il buffer in memoria alla coda (rispettando i confini UTF-8),
- segna `truncated` quando si verifica overflow/spill su file.

`dump()` restituisce:

- `output` (possibilmente con prefisso annotato),
- `truncated`,
- `totalLines/totalBytes`,
- `outputLines/outputBytes`,
- `artifactId` se il file dell'artefatto era attivo.

### Nota sull'output lungo

Il troncamento a runtime è basato sulla soglia in byte in `OutputSink` (50KB predefiniti). Non impone un limite rigido di 2000 righe in questo percorso di codice.

## Aggiornamenti live dello strumento

Per l'esecuzione non-PTY, `BashTool` utilizza un `TailBuffer` separato per aggiornamenti parziali ed emette snapshot `onUpdate` mentre il comando è in esecuzione.

Per l'esecuzione PTY, il rendering live è gestito dall'overlay UI personalizzato, non dai chunk di testo `onUpdate`.

## Formattazione del risultato, metadati e mappatura degli errori

Dopo l'esecuzione:

1. Gestione di `cancelled`:
   - se il segnale di abort è abortito -> lancia `ToolAbortError` (semantica di abort),
   - altrimenti -> lancia `ToolError` (trattato come fallimento dello strumento).
2. PTY `timedOut` -> lancia `ToolError`.
3. applica i filtri head/tail al testo di output finale (`applyHeadTail`, head poi tail).
4. l'output vuoto diventa `(no output)`.
5. allega metadati di troncamento tramite `toolResult(...).truncationFromSummary(result, { direction: "tail" })`.
6. mappatura del codice di uscita:
   - codice di uscita mancante -> `ToolError("... missing exit status")`
   - uscita diversa da zero -> `ToolError("... Command exited with code N")`
   - uscita zero -> risultato di successo.

Struttura del payload di successo:

- `content`: output testuale,
- `details.meta.truncation` quando troncato, includendo:
  - `direction`, `truncatedBy`, conteggi totali/output di righe+byte,
  - `shownRange`,
  - `artifactId` quando disponibile.

Poiché gli strumenti built-in sono avvolti con `wrapToolWithMetaNotice()`, il testo di avviso del troncamento viene aggiunto automaticamente al contenuto testuale finale (ad esempio: `Full: artifact://<id>`).

## Percorsi di rendering

## Renderer della tool-call (`bashToolRenderer`)

`bashToolRenderer` è utilizzato per i messaggi tool-call (`toolCall` / `toolResult`):

- la modalità compressa mostra un'anteprima troncata per righe visive,
- la modalità espansa mostra tutto il testo di output attualmente disponibile,
- la riga di avviso include il motivo del troncamento e `artifact://<id>` quando troncato,
- il valore del timeout (dagli argomenti) è mostrato nella riga dei metadati a piè di pagina.

### Nota: espansione completa dell'artefatto

`BashRenderContext` ha `isFullOutput`, ma il costruttore del contesto del renderer corrente non lo imposta per i risultati dello strumento bash. La vista espansa utilizza comunque il testo già presente nel contenuto del risultato (output tail/troncato) a meno che un altro chiamante non fornisca il contenuto completo dell'artefatto.

## Componente comando bang dell'utente (`BashExecutionComponent`)

`BashExecutionComponent` è per i comandi `!` dell'utente in modalità interattiva (non le tool-call del modello):

- invia i chunk in streaming in tempo reale,
- l'anteprima compressa mantiene le ultime 20 righe logiche,
- limite di 4000 caratteri per riga,
- mostra avvisi di troncamento + artefatto quando i metadati sono presenti,
- segna separatamente lo stato cancellato/errore/uscita.

Questo componente è collegato da `CommandController.handleBashCommand()` e alimentato da `AgentSession.executeBash()`.

## Differenze di comportamento specifiche per modalità

| Superficie                     | Percorso di ingresso                                  | Idoneo per PTY                                                       | UX dell'output live                                                      | Esposizione degli errori                                   |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Tool call interattiva          | `BashTool.execute`                                    | Sì, quando `bash.virtualTerminal=on` e UI esistente e `PI_NO_PTY!=1` | Overlay PTY (interattivo) o aggiornamenti tail in streaming              | Gli errori dello strumento diventano `toolResult.isError`  |
| Tool call in modalità print    | `BashTool.execute`                                    | No (nessun contesto UI)                                              | Nessun overlay TUI; l'output appare nel flusso eventi/testo assistente   | Stessa mappatura degli errori                              |
| Tool call RPC (tooling agente) | `BashTool.execute`                                    | Di solito nessuna UI -> non-PTY                                      | Eventi/risultati strutturati dello strumento                             | Stessa mappatura degli errori                              |
| Comando bang interattivo (`!`) | `AgentSession.executeBash` + `BashExecutionComponent` | No (usa l'executor direttamente)                                     | Componente dedicato all'esecuzione bash                                  | Il controller cattura le eccezioni e mostra errore nella UI |
| Comando RPC `bash`             | `rpc-mode` -> `session.executeBash`                   | No                                                                   | Restituisce `BashResult` direttamente                                    | Il consumatore gestisce i campi restituiti                 |

## Note operative

- L'interceptor blocca i comandi solo quando lo strumento suggerito è attualmente disponibile nel contesto.
- Se l'allocazione dell'artefatto fallisce, il troncamento avviene comunque ma nessun riferimento `artifact://` è disponibile.
- La cache delle sessioni shell non ha un'eviction esplicita in questo modulo; la durata è nell'ambito del processo.
- Le superfici di timeout PTY e non-PTY differiscono:
  - PTY espone un campo esplicito `timedOut` nel risultato,
  - non-PTY mappa il timeout in un riepilogo `cancelled + annotazione`.

## File di implementazione

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — punto di ingresso dello strumento, normalizzazione/intercettazione, selezione PTY/non-PTY, mappatura risultato/errore, renderer dello strumento bash.
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — normalizzazione dei comandi e filtraggio head/tail post-esecuzione.
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — corrispondenza delle regole dell'interceptor e messaggi dei comandi bloccati.
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — executor non-PTY, riutilizzo sessione shell, cablaggio della cancellazione, integrazione output sink.
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — runtime PTY, overlay UI, normalizzazione input, valori predefiniti env non interattivi.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — troncamento/spill artefatto di `OutputSink` e metadati di riepilogo.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — helper per l'allocazione degli artefatti e tail buffer in streaming.
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — forma dei metadati di troncamento + wrapper per l'iniezione degli avvisi.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `executeBash` a livello di sessione, registrazione messaggi, ciclo di vita dell'abort.
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — componente di esecuzione del comando interattivo `!`.
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — cablaggio per lo stream/completamento dell'aggiornamento UI del comando interattivo `!`.
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — superficie dei comandi RPC `bash` e `abort_bash`.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — risoluzione di `artifact://<id>`.
