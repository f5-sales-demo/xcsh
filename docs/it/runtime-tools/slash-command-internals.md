---
title: Meccanismi interni dei comandi Slash
description: >-
  Meccanismi interni del sistema di comandi slash con registrazione, analisi
  degli argomenti e dispatch dell'esecuzione.
sidebar:
  order: 5
  label: Comandi slash
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# Meccanismi interni dei comandi slash

Questo documento descrive come i comandi slash vengono individuati, deduplicati, esposti nella modalità interattiva ed espansi al momento della richiesta in `coding-agent`.

## File di implementazione

- [`src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)
- [`src/capability/slash-command.ts`](../../packages/coding-agent/src/capability/slash-command.ts)
- [`src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`src/discovery/claude.ts`](../../packages/coding-agent/src/discovery/claude.ts)
- [`src/discovery/codex.ts`](../../packages/coding-agent/src/discovery/codex.ts)
- [`src/discovery/claude-plugins.ts`](../../packages/coding-agent/src/discovery/claude-plugins.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)

## 1) Modello di individuazione

I comandi slash sono una capacità (`id: "slash-commands"`) indicizzata per nome di comando (`key: cmd => cmd.name`).

Il registro delle capacità carica tutti i provider registrati, ordinati per priorità del provider in ordine decrescente, e deduplica per chiave con semantica **il primo vince**.

### Precedenza dei provider

Provider di comandi slash attuali e relative priorità:

1. `native` (OMP) — priorità `100`
2. `claude` — priorità `80`
3. `claude-plugins` — priorità `70`
4. `codex` — priorità `70`

Comportamento in caso di parità: i provider con uguale priorità mantengono l'ordine di registrazione. L'ordine di importazione corrente registra `claude-plugins` prima di `codex`, pertanto i comandi dei plugin hanno la precedenza sui comandi codex in caso di collisioni di nomi.

### Comportamento in caso di collisioni di nomi

Per `slash-commands`, le collisioni vengono risolte esclusivamente tramite deduplicazione delle capacità:

- l'elemento con la precedenza più alta viene mantenuto in `result.items`
- i duplicati con precedenza inferiore rimangono solo in `result.all` e vengono contrassegnati con `_shadowed = true`

Questo si applica tra i provider e anche all'interno di un singolo provider qualora restituisca nomi duplicati.

### Comportamento della scansione dei file

I provider utilizzano principalmente `loadFilesFromDir(...)`, che attualmente:

- utilizza per impostazione predefinita la corrispondenza non ricorsiva (`*.md`)
- usa glob nativo con `gitignore: true`, `hidden: false`
- legge ogni file corrispondente e lo trasforma in uno `SlashCommand`

Pertanto i file/directory nascosti non vengono caricati e i percorsi ignorati vengono saltati.

## 2) Percorsi sorgente specifici per provider e precedenza locale

## Provider `native` (`builtin.ts`)

Le radici di ricerca provengono dalle directory `.xcsh`:

- progetto: `<cwd>/.xcsh/commands/*.md`
- utente: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` restituisce prima il progetto, poi l'utente, quindi **i comandi nativi del progetto hanno la precedenza sui comandi nativi dell'utente** in caso di collisioni di nomi.

## Provider `claude` (`claude.ts`)

Carica:

- utente: `~/.claude/commands/*.md`
- progetto: `<cwd>/.claude/commands/*.md`

Il provider inserisce gli elementi dell'utente prima di quelli del progetto, quindi **i comandi Claude dell'utente hanno la precedenza sui comandi Claude del progetto** in caso di collisioni con lo stesso nome all'interno di questo provider.

## Provider `codex` (`codex.ts`)

Carica:

- utente: `~/.codex/commands/*.md`
- progetto: `<cwd>/.codex/commands/*.md`

Entrambi i lati vengono caricati e quindi appiattiti in ordine utente-prima, pertanto **i comandi Codex dell'utente hanno la precedenza sui comandi Codex del progetto** in caso di collisioni.

Il contenuto dei comandi Codex viene analizzato con rimozione del frontmatter (`parseFrontmatter`), e il nome del comando può essere sovrascritto dal `name` nel frontmatter; in caso contrario viene utilizzato il nome del file.

## Provider `claude-plugins` (`claude-plugins.ts`)

Carica le radici dei comandi dei plugin da `~/.claude/plugins/installed_plugins.json`, quindi esegue la scansione di `<pluginRoot>/commands/*.md`.

L'ordinamento segue l'ordine di iterazione del registro e l'ordine degli elementi per plugin presenti in quel file JSON. Non è previsto alcun passaggio di ordinamento aggiuntivo.

## 3) Materializzazione in `FileSlashCommand` a runtime

`loadSlashCommands()` in `src/extensibility/slash-commands.ts` converte gli elementi delle capacità in oggetti `FileSlashCommand` utilizzati al momento della richiesta.

Per ciascun comando:

1. analisi del frontmatter/corpo (`parseFrontmatter`)
2. sorgente della descrizione:
   - `frontmatter.description` se presente
   - altrimenti la prima riga non vuota del corpo (trimmed, max 60 caratteri con `...`)
3. mantenimento del corpo analizzato come contenuto del template eseguibile
4. calcolo di una stringa sorgente visualizzata come `via Claude Code Project`

La severità dell'analisi del frontmatter dipende dalla sorgente:

- livello `native` -> gli errori di analisi sono `fatal`
- livelli `user`/`project` -> gli errori di analisi sono `warn` con analisi di fallback

### Comandi di fallback incorporati

Dopo i comandi da filesystem/provider, vengono aggiunti i template di comando incorporati (`EMBEDDED_COMMAND_TEMPLATES`) se i relativi nomi non sono già presenti.

L'insieme incorporato attuale proviene da `src/task/commands.ts` e viene utilizzato come fallback (`source: "bundled"`).

## 4) Modalità interattiva: provenienza degli elenchi di comandi

La modalità interattiva combina più sorgenti di comandi per il completamento automatico e il routing dei comandi.

Al momento della costruzione, viene creato un elenco di comandi in attesa composto da:

- built-in (`BUILTIN_SLASH_COMMANDS`, include il completamento degli argomenti e i suggerimenti inline per i comandi selezionati)
- comandi slash registrati tramite estensione (`extensionRunner.getRegisteredCommands(...)`)
- comandi personalizzati TypeScript (`session.customCommands`), mappati come etichette di comandi slash
- comandi skill opzionali (`/skill:<name>`) quando `skills.enableSkillCommands` è abilitato

Poi `init()` chiama `refreshSlashCommandState(...)` per caricare i comandi basati su file e installare un `CombinedAutocompleteProvider` contenente:

- i comandi in attesa sopra indicati
- i comandi basati su file individuati

`refreshSlashCommandState(...)` aggiorna anche `session.setSlashCommands(...)` affinché l'espansione della richiesta utilizzi lo stesso insieme di comandi basati su file individuato.

### Ciclo di vita dell'aggiornamento

Lo stato dei comandi slash viene aggiornato:

- durante l'inizializzazione interattiva
- dopo che `/move` cambia la directory di lavoro (`handleMoveCommand` chiama `resetCapabilities()` e poi `refreshSlashCommandState(newCwd)`)

Non è presente alcun file watcher continuo per le directory dei comandi.

### Altre modalità di esposizione

Il pannello delle Estensioni carica anch'esso la capacità `slash-commands` e visualizza le voci dei comandi attivi/oscurati, inclusi i duplicati `_shadowed`.

## 5) Posizionamento nella pipeline delle richieste

Ordine di gestione slash di `AgentSession.prompt(...)` (quando `expandPromptTemplates !== false`):

1. **Comandi delle estensioni** (`#tryExecuteExtensionCommand`)  
   Se `/name` corrisponde a un comando registrato dall'estensione, il gestore viene eseguito immediatamente e la richiesta viene restituita.
2. **Comandi personalizzati TypeScript** (`#tryExecuteCustomCommand`)  
   Solo come limite: se corrisponde, viene eseguito e può restituire:
   - `string` -> sostituisce il testo della richiesta con quella stringa
   - `void/undefined` -> trattato come gestito; nessuna richiesta al modello linguistico
3. **Comandi slash basati su file** (`expandSlashCommand`)  
   Se il testo inizia ancora con `/`, viene tentata l'espansione del comando markdown.
4. **Template di richiesta** (`expandPromptTemplate`)  
   Applicati dopo l'elaborazione slash/personalizzata.
5. **Consegna**
   - idle: la richiesta viene inviata immediatamente all'agente
   - in streaming: la richiesta viene accodata come steer/follow-up in base a `streamingBehavior`

Questo spiega perché l'espansione dei comandi slash precede l'espansione dei template di richiesta, e perché i comandi personalizzati possono trasformare la barra iniziale prima della corrispondenza con i comandi basati su file.

## 6) Semantica dell'espansione per i comandi slash basati su file

Comportamento di `expandSlashCommand(text, fileCommands)`:

- viene eseguito solo quando il testo inizia con `/`
- analizza il nome del comando dal primo token dopo `/`
- analizza gli argomenti dal testo rimanente tramite `parseCommandArgs`
- cerca una corrispondenza esatta per nome nei `fileCommands` caricati
- se corrisponde, applica:
  - sostituzione posizionale: `$1`, `$2`, ...
  - sostituzione aggregata: `$ARGUMENTS` e `$@`
  - quindi rendering del template tramite `prompt.render` con `{ args, ARGUMENTS, arguments }`
- se non c'è corrispondenza, restituisce il testo originale invariato

### Avvertenze su `parseCommandArgs`

Il parser è una suddivisione semplice con supporto alle virgolette:

- supporta le virgolette `'singole'` e `"doppie"` per mantenere gli spazi
- rimuove i delimitatori delle virgolette
- non implementa regole di escape con backslash
- una virgoletta non corrispondente non è un errore; il parser consuma fino alla fine

## 7) Comportamento per input `/...` sconosciuti

L'input slash sconosciuto **non viene rifiutato** dalla logica slash principale.

Se il comando non viene gestito dai livelli estensione/personalizzato/file, `expandSlashCommand` restituisce il testo originale e la richiesta letterale `/...` prosegue attraverso la normale espansione dei template e la consegna al modello linguistico.

La modalità interattiva gestisce separatamente e in modo diretto molti built-in in `InputController` (ad esempio `/settings`, `/model`, `/mcp`, `/move`, `/exit`). Questi vengono consumati prima di `session.prompt(...)` e pertanto non raggiungono mai l'espansione dei comandi basati su file in quel percorso.

## 8) Differenze tra streaming e idle

## Percorso idle

- `session.prompt("/x ...")` esegue la pipeline dei comandi ed esegue immediatamente il comando oppure invia direttamente il testo espanso.

## Percorso streaming (`session.isStreaming === true`)

- `prompt(...)` esegue comunque prima le trasformazioni estensione/personalizzato/file/template
- quindi richiede `streamingBehavior`:
  - `"steer"` -> accoda un messaggio di interruzione (`agent.steer`)
  - `"followUp"` -> accoda un messaggio post-turno (`agent.followUp`)
- se `streamingBehavior` viene omesso, la richiesta genera un errore

### Comportamento di streaming specifico per comando

- I comandi delle estensioni vengono eseguiti immediatamente anche durante lo streaming (non vengono accodati come testo).
- I metodi helper `steer(...)`/`followUp(...)` rifiutano i comandi delle estensioni (`#throwIfExtensionCommand`) per evitare di accodare testo di comandi per gestori che devono essere eseguiti in modo sincrono.
- La riproduzione della coda di compattazione utilizza `isKnownSlashCommand(...)` per decidere se le voci accodate debbano essere riprodotte tramite `session.prompt(...)` (per i comandi slash noti) o tramite i metodi raw steer/follow-up.

## 9) Gestione degli errori e superfici di fallimento

- I fallimenti nel caricamento del provider sono isolati; il registro raccoglie i warning e continua con gli altri provider.
- Gli elementi di comandi slash non validi (nome/percorso/contenuto mancante o livello non valido) vengono scartati dalla validazione delle capacità.
- Fallimenti nell'analisi del frontmatter:
  - comandi nativi: l'errore di analisi fatale viene propagato
  - comandi non nativi: warning + analisi chiave/valore di fallback
- Le eccezioni nei gestori dei comandi estensione/personalizzati vengono catturate e segnalate tramite il canale di errori dell'estensione (o il logger di fallback per i comandi personalizzati senza extension runner), e vengono trattate come gestite (nessuna esecuzione di fallback indesiderata).
