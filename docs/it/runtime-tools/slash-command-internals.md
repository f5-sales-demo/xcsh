---
title: Slash Command Internals
description: >-
  Slash command system internals with registration, argument parsing, and
  execution dispatch.
sidebar:
  order: 5
  label: Slash commands
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# Funzionamento interno dei comandi slash

Questo documento descrive come i comandi slash vengono scoperti, deduplicati, presentati in modalità interattiva ed espansi al momento del prompt in `coding-agent`.

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

## 1) Modello di scoperta

I comandi slash sono una capability (`id: "slash-commands"`) indicizzata per nome del comando (`key: cmd => cmd.name`).

Il registro delle capability carica tutti i provider registrati, ordinati per priorità del provider in ordine decrescente, e deduplica per chiave con semantica **il primo vince**.

### Precedenza dei provider

Provider di comandi slash attuali e relative priorità:

1. `native` (OMP) — priorità `100`
2. `claude` — priorità `80`
3. `claude-plugins` — priorità `70`
4. `codex` — priorità `70`

Comportamento in caso di parità: i provider con priorità uguale mantengono l'ordine di registrazione. L'ordine di importazione attuale registra `claude-plugins` prima di `codex`, quindi i comandi dei plugin prevalgono sui comandi codex in caso di collisioni di nomi.

### Comportamento in caso di collisione dei nomi

Per `slash-commands`, le collisioni vengono risolte rigorosamente tramite la deduplicazione delle capability:

- l'elemento con la precedenza più alta viene mantenuto in `result.items`
- i duplicati con precedenza inferiore rimangono solo in `result.all` e vengono contrassegnati con `_shadowed = true`

Questo si applica sia tra provider diversi che all'interno di un singolo provider se questo restituisce nomi duplicati.

### Comportamento della scansione dei file

I provider utilizzano principalmente `loadFilesFromDir(...)`, che attualmente:

- esegue per default un matching non ricorsivo (`*.md`)
- usa il glob nativo con `gitignore: true`, `hidden: false`
- legge ogni file corrispondente e lo trasforma in un `SlashCommand`

Pertanto i file/directory nascosti non vengono caricati e i percorsi ignorati vengono saltati.

## 2) Percorsi sorgente specifici per provider e precedenza locale

## Provider `native` (`builtin.ts`)

Le radici di ricerca provengono dalle directory `.xcsh`:

- progetto: `<cwd>/.xcsh/commands/*.md`
- utente: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` restituisce prima il progetto, poi l'utente, quindi **i comandi nativi del progetto prevalgono sui comandi nativi dell'utente** in caso di collisione dei nomi.

## Provider `claude` (`claude.ts`)

Carica:

- utente: `~/.claude/commands/*.md`
- progetto: `<cwd>/.claude/commands/*.md`

Il provider inserisce gli elementi dell'utente prima di quelli del progetto, quindi **i comandi Claude dell'utente prevalgono sui comandi Claude del progetto** in caso di collisioni con lo stesso nome all'interno di questo provider.

## Provider `codex` (`codex.ts`)

Carica:

- utente: `~/.codex/commands/*.md`
- progetto: `<cwd>/.codex/commands/*.md`

Entrambe le parti vengono caricate e poi appiattite in ordine utente-prima, quindi **i comandi Codex dell'utente prevalgono sui comandi Codex del progetto** in caso di collisioni.

Il contenuto dei comandi Codex viene analizzato con rimozione del frontmatter (`parseFrontmatter`), e il nome del comando può essere sovrascritto dal frontmatter `name`; altrimenti viene utilizzato il nome del file.

## Provider `claude-plugins` (`claude-plugins.ts`)

Carica le radici dei comandi dei plugin da `~/.claude/plugins/installed_plugins.json`, poi scansiona `<pluginRoot>/commands/*.md`.

L'ordinamento segue l'ordine di iterazione del registro e l'ordine delle voci per plugin da quel dato JSON. Non c'è un passaggio di ordinamento aggiuntivo.

## 3) Materializzazione in `FileSlashCommand` a runtime

`loadSlashCommands()` in `src/extensibility/slash-commands.ts` converte gli elementi delle capability in oggetti `FileSlashCommand` utilizzati al momento del prompt.

Per ogni comando:

1. analizza frontmatter/corpo (`parseFrontmatter`)
2. origine della descrizione:
   - `frontmatter.description` se presente
   - altrimenti la prima riga non vuota del corpo (trimmata, massimo 60 caratteri con `...`)
3. mantiene il corpo analizzato come contenuto del template eseguibile
4. calcola una stringa sorgente di visualizzazione come `via Claude Code Project`

La severità dell'analisi del frontmatter dipende dalla sorgente:

- livello `native` -> gli errori di parsing sono `fatal`
- livelli `user`/`project` -> gli errori di parsing sono `warn` con parsing di fallback

### Comandi fallback integrati

Dopo i comandi da filesystem/provider, vengono aggiunti i template di comando incorporati (`EMBEDDED_COMMAND_TEMPLATES`) se i loro nomi non sono già presenti.

L'insieme incorporato attuale proviene da `src/task/commands.ts` e viene utilizzato come fallback (`source: "bundled"`).

## 4) Modalità interattiva: da dove provengono le liste dei comandi

La modalità interattiva combina più sorgenti di comandi per l'autocompletamento e il routing dei comandi.

Al momento della costruzione, crea una lista di comandi in sospeso da:

- comandi integrati (`BUILTIN_SLASH_COMMANDS`, include il completamento degli argomenti e suggerimenti inline per comandi selezionati)
- comandi slash registrati dalle estensioni (`extensionRunner.getRegisteredCommands(...)`)
- comandi personalizzati TypeScript (`session.customCommands`), mappati su etichette di comandi slash
- comandi skill opzionali (`/skill:<name>`) quando `skills.enableSkillCommands` è abilitato

Poi `init()` chiama `refreshSlashCommandState(...)` per caricare i comandi basati su file e installare un singolo `CombinedAutocompleteProvider` contenente:

- i comandi in sospeso sopra elencati
- i comandi basati su file scoperti

`refreshSlashCommandState(...)` aggiorna anche `session.setSlashCommands(...)` affinché l'espansione del prompt utilizzi lo stesso insieme di comandi file scoperti.

### Ciclo di vita dell'aggiornamento

Lo stato dei comandi slash viene aggiornato:

- durante l'inizializzazione interattiva
- dopo che `/move` cambia la directory di lavoro (`handleMoveCommand` chiama `resetCapabilities()` poi `refreshSlashCommandState(newCwd)`)

Non esiste un file watcher continuo per le directory dei comandi.

### Altra esposizione

La dashboard delle Estensioni carica anch'essa la capability `slash-commands` e visualizza le voci dei comandi attivi/nascosti, inclusi i duplicati `_shadowed`.

## 5) Posizionamento nella pipeline del prompt

Ordine di gestione degli slash in `AgentSession.prompt(...)` (quando `expandPromptTemplates !== false`):

1. **Comandi delle estensioni** (`#tryExecuteExtensionCommand`)  
   Se `/name` corrisponde a un comando registrato dall'estensione, il gestore viene eseguito immediatamente e il prompt ritorna.
2. **Comandi personalizzati TypeScript** (`#tryExecuteCustomCommand`)  
   Solo boundary: se c'è corrispondenza, viene eseguito e può restituire:
   - `string` -> sostituisce il testo del prompt con quella stringa
   - `void/undefined` -> trattato come gestito; nessun prompt LLM
3. **Comandi slash basati su file** (`expandSlashCommand`)  
   Se il testo inizia ancora con `/`, tenta l'espansione del comando markdown.
4. **Template di prompt** (`expandPromptTemplate`)  
   Applicati dopo l'elaborazione slash/personalizzata.
5. **Consegna**
   - idle: il prompt viene inviato immediatamente all'agente
   - streaming: il prompt viene accodato come steer/follow-up a seconda di `streamingBehavior`

Ecco perché l'espansione dei comandi slash si trova prima dell'espansione dei template di prompt, e perché i comandi personalizzati possono rimuovere lo slash iniziale prima del matching dei comandi file.

## 6) Semantica di espansione per i comandi slash basati su file

Comportamento di `expandSlashCommand(text, fileCommands)`:

- viene eseguito solo quando il testo inizia con `/`
- analizza il nome del comando dal primo token dopo `/`
- analizza gli argomenti dal testo rimanente tramite `parseCommandArgs`
- cerca una corrispondenza esatta del nome nei `fileCommands` caricati
- se trovata, applica:
  - sostituzione posizionale: `$1`, `$2`, ...
  - sostituzione aggregata: `$ARGUMENTS` e `$@`
  - poi rendering del template tramite `prompt.render` con `{ args, ARGUMENTS, arguments }`
- se nessuna corrispondenza, restituisce il testo originale invariato

### Avvertenze su `parseCommandArgs`

Il parser è un semplice splitting consapevole delle virgolette:

- supporta virgolette `'singole'` e `"doppie"` per mantenere gli spazi
- rimuove i delimitatori delle virgolette
- non implementa regole di escape con backslash
- una virgoletta non chiusa non è un errore; il parser consuma fino alla fine

## 7) Comportamento per `/...` sconosciuto

L'input slash sconosciuto **non viene rifiutato** dalla logica core dei comandi slash.

Se il comando non viene gestito dai livelli estensione/personalizzato/file, `expandSlashCommand` restituisce il testo originale, e il prompt letterale `/...` prosegue attraverso la normale espansione dei template di prompt e la consegna all'LLM.

La modalità interattiva gestisce separatamente in modo diretto molti comandi integrati in `InputController` (ad esempio `/settings`, `/model`, `/mcp`, `/move`, `/exit`). Questi vengono consumati prima di `session.prompt(...)` e quindi non raggiungono mai l'espansione dei comandi file in quel percorso.

## 8) Differenze durante lo streaming rispetto allo stato idle

## Percorso idle

- `session.prompt("/x ...")` esegue la pipeline dei comandi e o esegue il comando immediatamente o invia il testo espanso direttamente.

## Percorso streaming (`session.isStreaming === true`)

- `prompt(...)` esegue comunque prima le trasformazioni estensione/personalizzato/file/template
- poi richiede `streamingBehavior`:
  - `"steer"` -> accoda messaggio di interruzione (`agent.steer`)
  - `"followUp"` -> accoda messaggio post-turno (`agent.followUp`)
- se `streamingBehavior` viene omesso, il prompt lancia un errore

### Comportamento importante dello streaming specifico per comando

- I comandi delle estensioni vengono eseguiti immediatamente anche durante lo streaming (non accodati come testo).
- I metodi helper `steer(...)`/`followUp(...)` rifiutano i comandi delle estensioni (`#throwIfExtensionCommand`) per evitare di accodare testo di comandi per gestori che devono essere eseguiti in modo sincrono.
- Il replay della coda di compattazione usa `isKnownSlashCommand(...)` per decidere se le voci accodate devono essere replicate tramite `session.prompt(...)` (per comandi slash noti) rispetto ai metodi raw steer/follow-up.

## 9) Gestione degli errori e superfici di fallimento

- I fallimenti di caricamento dei provider sono isolati; il registro raccoglie avvisi e prosegue con gli altri provider.
- Gli elementi di comandi slash non validi (nome/percorso/contenuto mancante o livello non valido) vengono scartati dalla validazione delle capability.
- Fallimenti nell'analisi del frontmatter:
  - comandi nativi: l'errore fatale di parsing viene propagato
  - comandi non nativi: avviso + parsing di fallback chiave/valore
- Le eccezioni dei gestori di comandi estensione/personalizzati vengono catturate e riportate tramite il canale di errore dell'estensione (o il logger di fallback per comandi personalizzati senza extension runner), e trattate come gestite (nessuna esecuzione di fallback non intenzionale).
