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

Questo documento descrive il percorso di runtime dello **strumento `bash`** utilizzato dalle chiamate agli strumenti dell'agente, dalla normalizzazione dei comandi all'esecuzione, alla troncatura/artefatti e al rendering.

Viene inoltre indicato dove il comportamento diverge in modalità TUI interattiva, modalità di stampa, modalità RPC ed esecuzione shell bang (`!`) avviata dall'utente.

## Ambito e superfici di runtime

Esistono due diverse superfici di esecuzione bash nel coding-agent:

1. **Superficie di chiamata agli strumenti** (`toolName: "bash"`): utilizzata quando il modello chiama lo strumento bash.
   - Punto di ingresso: `BashTool.execute()`.
2. **Superficie di comando bang utente** (`!cmd` dall'input interattivo o comando RPC `bash`): percorso helper a livello di sessione.
   - Punto di ingresso: `AgentSession.executeBash()`.

Entrambe alla fine utilizzano `executeBash()` in `src/exec/bash-executor.ts` per l'esecuzione non-PTY, ma solo il percorso di chiamata agli strumenti esegue la logica di normalizzazione/intercettazione e del renderer degli strumenti.

## Pipeline di chiamata agli strumenti end-to-end

## 1) Normalizzazione dell'input e merge dei parametri

`BashTool.execute()` normalizza prima il comando grezzo tramite `normalizeBashCommand()`:

- estrae i `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N` finali in limiti strutturati,
- rimuove gli spazi bianchi finali/iniziali,
- mantiene intatti gli spazi bianchi interni.

Quindi unisce i limiti estratti con gli argomenti espliciti dello strumento:

- gli argomenti espliciti `head`/`tail` sovrascrivono i valori estratti,
- i valori estratti sono solo un fallback.

### Avvertenza

I commenti in `bash-normalize.ts` menzionano la rimozione di `2>&1`, ma l'implementazione attuale non lo rimuove. Il comportamento di runtime è comunque corretto (stdout/stderr sono già unificati), ma il comportamento di normalizzazione è più limitato di quanto suggeriscano i commenti.

## 2) Intercettazione opzionale (percorso di comando bloccato)

Se `bashInterceptor.enabled` è true, `BashTool` carica le regole dalle impostazioni ed esegue `checkBashInterception()` sul comando normalizzato.

Comportamento di intercettazione:

- il comando è bloccato **solo** quando:
  - la regola regex corrisponde, e
  - lo strumento suggerito è presente in `ctx.toolNames`.
- le regole regex non valide vengono ignorate silenziosamente.
- in caso di blocco, `BashTool` genera un `ToolError` con il messaggio:
  - `Blocked: ...`
  - comando originale incluso.

I pattern delle regole predefinite (definiti nel codice) si rivolgono agli utilizzi impropri più comuni:

- lettori di file (`cat`, `head`, `tail`, ...)
- strumenti di ricerca (`grep`, `rg`, ...)
- cercatori di file (`find`, `fd`, ...)
- editor in-place (`sed -i`, `perl -i`, `awk -i inplace`)
- scritture con reindirizzamento shell (`echo ... > file`, reindirizzamento heredoc)

### Avvertenza

`InterceptionResult` include `suggestedTool`, ma `BashTool` attualmente espone solo il testo del messaggio (nessun campo structured suggested-tool in `details`).

## 3) Validazione CWD e limitazione del timeout

`cwd` viene risolto relativamente al cwd della sessione (`resolveToCwd`), quindi validato tramite `stat`:

- percorso mancante -> `ToolError("Working directory does not exist: ...")`
- non-directory -> `ToolError("Working directory is not a directory: ...")`

Il timeout è limitato all'intervallo `[1, 3600]` secondi e convertito in millisecondi.

## 4) Allocazione degli artefatti

Prima dell'esecuzione, lo strumento alloca un percorso/id di artefatto (best-effort) per l'archiviazione dell'output troncato.

- il fallimento dell'allocazione dell'artefatto non è fatale (l'esecuzione continua senza file di spill dell'artefatto),
- id/percorso dell'artefatto vengono passati nel percorso di esecuzione per la persistenza dell'output completo in caso di troncatura.

## 5) Selezione dell'esecuzione PTY vs non-PTY

`BashTool` sceglie l'esecuzione PTY solo quando tutte le condizioni sono vere:

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- il contesto dello strumento ha UI (`ctx.hasUI === true` e `ctx.ui` impostato)

Altrimenti utilizza `executeBash()` non interattivo.

Ciò significa che la modalità di stampa e i contesti RPC/strumenti non-UI utilizzano sempre non-PTY.

## Motore di esecuzione non interattivo (`executeBash`)

## Modello di riutilizzo delle sessioni shell

`executeBash()` memorizza nella cache le istanze `Shell` native in una mappa globale del processo con chiave basata su:

- percorso della shell,
- prefisso di comando configurato,
- percorso dello snapshot,
- env della shell serializzata,
- chiave di sessione agente opzionale.

Per le esecuzioni a livello di sessione, `AgentSession.executeBash()` passa `sessionKey: this.sessionId`, isolando il riutilizzo per sessione.

Il percorso di chiamata agli strumenti **non** passa `sessionKey`, quindi l'ambito di riutilizzo è basato sulla configurazione shell/snapshot/env.

## Configurazione della shell e comportamento degli snapshot

Ad ogni chiamata, l'executor carica la configurazione della shell dalle impostazioni (`shell`, `env`, `prefix` opzionale).

Se la shell selezionata include `bash`, tenta `getOrCreateSnapshot()`:

- lo snapshot cattura alias/funzioni/opzioni dal rc dell'utente,
- la creazione dello snapshot è best-effort,
- in caso di fallimento, si ricade all'assenza di snapshot.

Se `prefix` è configurato, il comando diventa:

```text
<prefix> <command>
```

## Streaming e cancellazione

`Shell.run()` trasmette chunk al callback. L'executor instrada ogni chunk in `OutputSink` e nel callback opzionale `onChunk`.

Cancellazione:

- il segnale interrotto attiva `shellSession.abort(...)`,
- il timeout del risultato nativo viene mappato su `cancelled: true` + testo di annotazione,
- la cancellazione esplicita restituisce analogamente `cancelled: true` + annotazione.

Nessuna eccezione viene generata all'interno dell'executor per timeout/cancellazione; restituisce un `BashResult` strutturato e lascia che il chiamante mappi la semantica degli errori.

## Percorso PTY interattivo (`runInteractiveBashPty`)

Quando PTY è abilitato, lo strumento esegue `runInteractiveBashPty()` che apre un componente console in overlay e gestisce una `PtySession` nativa.

Caratteristiche principali del comportamento:

- il terminale virtuale xterm-headless renderizza il viewport nell'overlay,
- l'input da tastiera è normalizzato (inclusa la gestione delle sequenze Kitty e della modalità cursore applicazione),
- `esc` durante l'esecuzione termina la sessione PTY,
- il ridimensionamento del terminale si propaga al PTY (`session.resize(cols, rows)`).

Le impostazioni predefinite di hardening dell'ambiente vengono iniettate per le esecuzioni non presidiate:

- pager disabilitati (`PAGER=cat`, `GIT_PAGER=cat`, ecc.),
- prompt dell'editor disabilitati (`GIT_EDITOR=true`, `EDITOR=true`, ...),
- prompt terminale/autenticazione ridotti (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`),
- flag di automazione package-manager/strumento per il comportamento non interattivo.

L'output PTY è normalizzato (`CRLF`/`CR` in `LF`, `sanitizeText`) e scritto in `OutputSink`, incluso il supporto allo spill degli artefatti.

In caso di errore di avvio/runtime PTY, il sink riceve la riga `PTY error: ...` e il comando si finalizza con codice di uscita indefinito.

## Gestione dell'output: streaming, troncatura, spill degli artefatti

Sia il percorso PTY che quello non-PTY utilizzano `OutputSink`.

## Semantica di OutputSink

- mantiene un buffer tail in memoria con codifica UTF-8 sicura (`DEFAULT_MAX_BYTES`, attualmente 50KB),
- tiene traccia del totale di byte/righe visti,
- se esiste un percorso di artefatto e l'output supera il limite (o il file è già attivo), scrive lo stream completo nel file dell'artefatto,
- quando la soglia di memoria viene superata, riduce il buffer in memoria al tail (sicuro ai limiti UTF-8),
- segna `truncated` quando si verifica overflow/spill su file.

`dump()` restituisce:

- `output` (possibilmente con prefisso annotato),
- `truncated`,
- `totalLines/totalBytes`,
- `outputLines/outputBytes`,
- `artifactId` se il file dell'artefatto era attivo.

### Avvertenza sull'output lungo

La troncatura di runtime si basa sulla soglia in byte in `OutputSink` (default 50KB). Non impone un limite rigido di 2000 righe in questo percorso di codice.

## Aggiornamenti live degli strumenti

Per l'esecuzione non-PTY, `BashTool` utilizza un `TailBuffer` separato per gli aggiornamenti parziali e invia snapshot `onUpdate` mentre il comando è in esecuzione.

Per l'esecuzione PTY, il rendering live è gestito dall'overlay UI personalizzato, non dai chunk di testo `onUpdate`.

## Formazione del risultato, metadati e mappatura degli errori

Dopo l'esecuzione:

1. Gestione di `cancelled`:
   - se il segnale di interruzione è interrotto -> genera `ToolAbortError` (semantica di interruzione),
   - altrimenti -> genera `ToolError` (trattato come fallimento dello strumento).
2. PTY `timedOut` -> genera `ToolError`.
3. applica i filtri head/tail al testo di output finale (`applyHeadTail`, head poi tail).
4. l'output vuoto diventa `(no output)`.
5. allega i metadati di troncatura tramite `toolResult(...).truncationFromSummary(result, { direction: "tail" })`.
6. mappatura del codice di uscita:
   - codice di uscita mancante -> `ToolError("... missing exit status")`
   - uscita non zero -> `ToolError("... Command exited with code N")`
   - uscita zero -> risultato di successo.

Struttura del payload di successo:

- `content`: testo di output,
- `details.meta.truncation` quando troncato, inclusi:
  - `direction`, `truncatedBy`, conteggi totali/output di righe+byte,
  - `shownRange`,
  - `artifactId` quando disponibile.

Poiché gli strumenti integrati sono avvolti con `wrapToolWithMetaNotice()`, il testo di avviso di troncatura viene aggiunto automaticamente al contenuto testuale finale (ad esempio: `Full: artifact://<id>`).

## Percorsi di rendering

## Renderer di chiamata agli strumenti (`bashToolRenderer`)

`bashToolRenderer` è utilizzato per i messaggi di chiamata agli strumenti (`toolCall` / `toolResult`):

- la modalità compressa mostra un'anteprima troncata a livello di righe visive,
- la modalità espansa mostra tutto il testo di output attualmente disponibile,
- la riga di avviso include il motivo della troncatura e `artifact://<id>` quando troncato,
- il valore di timeout (dagli argomenti) è mostrato nella riga dei metadati del piè di pagina.

### Avvertenza: espansione completa dell'artefatto

`BashRenderContext` ha `isFullOutput`, ma il builder del contesto del renderer attuale non lo imposta per i risultati dello strumento bash. La vista espansa utilizza ancora il testo già presente nel contenuto del risultato (output tail/troncato) a meno che un altro chiamante non fornisca il contenuto completo dell'artefatto.

## Componente di comando bang utente (`BashExecutionComponent`)

`BashExecutionComponent` è per i comandi `!` dell'utente in modalità interattiva (non per le chiamate agli strumenti del modello):

- trasmette chunk in tempo reale,
- l'anteprima compressa mantiene le ultime 20 righe logiche,
- limite di 4000 caratteri per riga,
- mostra avvisi di troncatura + artefatto quando i metadati sono presenti,
- segna separatamente lo stato cancellato/errore/uscita.

Questo componente è collegato da `CommandController.handleBashCommand()` e alimentato da `AgentSession.executeBash()`.

## Differenze di comportamento specifiche per modalità

| Superficie                            | Percorso di ingresso                                  | Idoneità PTY                                                          | UX di output live                                                                  | Gestione degli errori                                    |
| ------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Chiamata agli strumenti interattiva   | `BashTool.execute`                                    | Sì, quando `bash.virtualTerminal=on` e UI esistente e `PI_NO_PTY!=1` | Overlay PTY (interattivo) o aggiornamenti tail in streaming                        | Gli errori dello strumento diventano `toolResult.isError` |
| Chiamata agli strumenti in stampa     | `BashTool.execute`                                    | No (nessun contesto UI)                                               | Nessun overlay TUI; l'output appare nel flusso di eventi/testo finale dell'assistente | Stessa mappatura degli errori dello strumento            |
| Chiamata agli strumenti RPC (tooling agente) | `BashTool.execute`                             | Di solito nessuna UI -> non-PTY                                       | Eventi/risultati strutturati degli strumenti                                        | Stessa mappatura degli errori dello strumento            |
| Comando bang interattivo (`!`)        | `AgentSession.executeBash` + `BashExecutionComponent` | No (usa l'executor direttamente)                                      | Componente di esecuzione bash dedicato                                              | Il controller cattura le eccezioni e mostra l'errore UI  |
| Comando `bash` RPC                    | `rpc-mode` -> `session.executeBash`                   | No                                                                    | Restituisce `BashResult` direttamente                                               | Il consumatore gestisce i campi restituiti               |

## Avvertenze operative

- L'interceptor blocca i comandi solo quando lo strumento suggerito è attualmente disponibile nel contesto.
- Se l'allocazione dell'artefatto fallisce, la troncatura si verifica comunque ma non è disponibile alcun back-reference `artifact://`.
- La cache delle sessioni shell non ha un'evizione esplicita in questo modulo; la durata è limitata al processo.
- Le superfici di timeout PTY e non-PTY differiscono:
  - PTY espone il campo di risultato esplicito `timedOut`,
  - non-PTY mappa il timeout in `cancelled + annotation` summary.

## File di implementazione

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — punto di ingresso dello strumento, normalizzazione/intercettazione, selezione PTY/non-PTY, mappatura risultati/errori, renderer dello strumento bash.
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — normalizzazione dei comandi e filtraggio head/tail post-esecuzione.
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — corrispondenza delle regole dell'interceptor e messaggi di comando bloccato.
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — executor non-PTY, riutilizzo delle sessioni shell, collegamento della cancellazione, integrazione del sink di output.
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — runtime PTY, overlay UI, normalizzazione dell'input, impostazioni predefinite env non interattive.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — troncatura/spill degli artefatti `OutputSink` e metadati di riepilogo.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — helper per l'allocazione degli artefatti e buffer tail in streaming.
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — forma dei metadati di troncatura + wrapper di iniezione degli avvisi.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `executeBash` a livello di sessione, registrazione dei messaggi, ciclo di vita dell'interruzione.
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — componente di esecuzione del comando `!` interattivo.
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — collegamento per il completamento del flusso/aggiornamento UI del comando `!` interattivo.
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — superficie dei comandi `bash` e `abort_bash` RPC.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — risoluzione di `artifact://<id>`.
