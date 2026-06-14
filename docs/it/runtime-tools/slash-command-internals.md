---
title: Componenti interni dei comandi Slash
description: >-
  Componenti interni del sistema di comandi slash con registrazione, analisi
  degli argomenti e invio dell'esecuzione.
sidebar:
  order: 5
  label: Comandi slash
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# Componenti interni dei comandi slash

Questo documento descrive come i comandi slash vengono individuati, deduplicati, esposti in modalità interattiva ed espansi al momento del prompt in `coding-agent`.

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

I comandi slash sono una funzionalità (`id: "slash-commands"`) indicizzata per nome del comando (`key: cmd => cmd.name`).

Il registro delle funzionalità carica tutti i provider registrati, ordinati per priorità del provider in ordine decrescente, e deduplicati per chiave con semantica **il primo vince**.

### Precedenza dei provider

Provider di comandi slash attuali e relative priorità:

1. `native` (OMP) — priorità `100`
2. `claude` — priorità `80`
3. `claude-plugins` — priorità `70`
4. `codex` — priorità `70`

Comportamento in caso di parità: i provider con priorità uguale mantengono l'ordine di registrazione. L'ordine di importazione corrente registra `claude-plugins` prima di `codex`, quindi i comandi dei plugin hanno la precedenza sui comandi codex in caso di collisioni di nomi.

### Comportamento in caso di collisione di nomi

Per `slash-commands`, le collisioni vengono risolte esclusivamente tramite deduplicazione delle funzionalità:

- l'elemento con precedenza più alta viene mantenuto in `result.items`
- i duplicati con precedenza inferiore rimangono solo in `result.all` e sono contrassegnati con `_shadowed = true`

Ciò si applica tra i provider e anche all'interno di un provider se restituisce nomi duplicati.

### Comportamento di scansione dei file

I provider utilizzano principalmente `loadFilesFromDir(...)`, che attualmente:

- utilizza per impostazione predefinita la corrispondenza non ricorsiva (`*.md`)
- usa il glob nativo con `gitignore: true`, `hidden: false`
- legge ogni file trovato e lo trasforma in un `SlashCommand`

Pertanto i file/directory nascosti non vengono caricati e i percorsi ignorati vengono saltati.

## 2) Percorsi sorgente specifici del provider e precedenza locale

## Provider `native` (`builtin.ts`)

Le radici di ricerca provengono dalle directory `.xcsh`:

- progetto: `<cwd>/.xcsh/commands/*.md`
- utente: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` restituisce prima il progetto e poi l'utente, quindi **i comandi nativi del progetto hanno la precedenza sui comandi nativi dell'utente** in caso di collisioni di nomi.

## Provider `claude` (`claude.ts`)

Carica:

- utente: `~/.claude/commands/*.md`
- progetto: `<cwd>/.claude/commands/*.md`

Il provider inserisce gli elementi utente prima degli elementi progetto, quindi **i comandi Claude dell'utente hanno la precedenza sui comandi Claude del progetto** in caso di collisioni di nomi all'interno di questo provider.

## Provider `codex` (`codex.ts`)

Carica:

- utente: `~/.codex/commands/*.md`
- progetto: `<cwd>/.codex/commands/*.md`

Entrambi i lati vengono caricati e poi appiattiti nell'ordine utente-prima, quindi **i comandi Codex dell'utente hanno la precedenza sui comandi Codex del progetto** in caso di collisioni.

Il contenuto dei comandi Codex viene analizzato con la rimozione del frontmatter (`parseFrontmatter`), e il nome del comando può essere sovrascritto dal `name` del frontmatter; altrimenti viene utilizzato il nome del file.

## Provider `claude-plugins` (`claude-plugins.ts`)

Carica le radici dei comandi dei plugin da `~/.claude/plugins/installed_plugins.json`, poi scansiona `<pluginRoot>/commands/*.md`.

L'ordinamento segue l'ordine di iterazione del registro e l'ordine delle voci per plugin da quei dati JSON. Non è presente alcun passaggio di ordinamento aggiuntivo.

## 3) Materializzazione nel `FileSlashCommand` di runtime

`loadSlashCommands()` in `src/extensibility/slash-commands.ts` converte gli elementi delle funzionalità in oggetti `FileSlashCommand` utilizzati al momento del prompt.

Per ogni comando:

1. analisi del frontmatter/corpo (`parseFrontmatter`)
2. sorgente della descrizione:
   - `frontmatter.description` se presente
   - altrimenti la prima riga non vuota del corpo (ridotta, massimo 60 caratteri con `...`)
3. conservazione del corpo analizzato come contenuto del template eseguibile
4. calcolo di una stringa sorgente visualizzata come `via Claude Code Project`

La severità dell'analisi del frontmatter dipende dalla sorgente:

- livello `native` -> gli errori di analisi sono `fatal`
- livelli `user`/`project` -> gli errori di analisi sono `warn` con analisi di fallback

### Comandi di fallback incorporati

Dopo i comandi da filesystem/provider, i template di comandi incorporati vengono aggiunti (`EMBEDDED_COMMAND_TEMPLATES`) se i loro nomi non sono già presenti.

L'insieme incorporato corrente proviene da `src/task/commands.ts` ed è usato come fallback (`source: "bundled"`).

## 4) Modalità interattiva: origine degli elenchi di comandi

La modalità interattiva combina più sorgenti di comandi per il completamento automatico e il routing dei comandi.

Al momento della costruzione, crea un elenco di comandi in sospeso da:

- comandi integrati (`BUILTIN_SLASH_COMMANDS`, include il completamento degli argomenti e i suggerimenti inline per i comandi selezionati)
- comandi slash registrati dalle estensioni (`extensionRunner.getRegisteredCommands(...)`)
- comandi personalizzati TypeScript (`session.customCommands`), mappati su etichette di comandi slash
- comandi skill opzionali (`/skill:<name>`) quando `skills.enableSkillCommands` è abilitato

Poi `init()` chiama `refreshSlashCommandState(...)` per caricare i comandi basati su file e installare un `CombinedAutocompleteProvider` contenente:

- i comandi in sospeso sopra indicati
- i comandi basati su file individuati

`refreshSlashCommandState(...)` aggiorna anche `session.setSlashCommands(...)` in modo che l'espansione del prompt utilizzi lo stesso insieme di comandi file individuati.

### Ciclo di vita dell'aggiornamento

Lo stato dei comandi slash viene aggiornato:

- durante l'inizializzazione interattiva
- dopo che `/move` modifica la directory di lavoro (`handleMoveCommand` chiama `resetCapabilities()` poi `refreshSlashCommandState(newCwd)`)

Non è presente alcun file watcher continuo per le directory dei comandi.

### Altra esposizione

Il pannello delle estensioni carica anche la funzionalità `slash-commands` e visualizza le voci dei comandi attivi/in ombra, inclusi i duplicati `_shadowed`.

## 5) Posizionamento nella pipeline del prompt

Ordine di gestione degli slash in `AgentSession.prompt(...)` (quando `expandPromptTemplates !== false`):

1. **Comandi delle estensioni** (`#tryExecuteExtensionCommand`)  
   Se `/name` corrisponde a un comando registrato dall'estensione, il gestore viene eseguito immediatamente e il prompt ritorna.
2. **Comandi personalizzati TypeScript** (`#tryExecuteCustomCommand`)  
   Solo limite: se trovato, viene eseguito e può restituire:
   - `string` -> sostituisce il testo del prompt con quella stringa
   - `void/undefined` -> trattato come gestito; nessun prompt LLM
3. **Comandi slash basati su file** (`expandSlashCommand`)  
   Se il testo inizia ancora con `/`, si tenta l'espansione del comando markdown.
4. **Template di prompt** (`expandPromptTemplate`)  
   Applicati dopo l'elaborazione slash/personalizzata.
5. **Consegna**
   - inattivo: il prompt viene inviato immediatamente all'agente
   - streaming: il prompt viene messo in coda come steer/follow-up in base a `streamingBehavior`

Ecco perché l'espansione dei comandi slash si trova prima dell'espansione dei template di prompt, e perché i comandi personalizzati possono trasformare la barra iniziale prima della corrispondenza con i comandi file.

## 6) Semantica di espansione per i comandi slash basati su file

Comportamento di `expandSlashCommand(text, fileCommands)`:

- viene eseguito solo quando il testo inizia con `/`
- analizza il nome del comando dal primo token dopo `/`
- analizza gli argomenti dal testo restante tramite `parseCommandArgs`
- trova la corrispondenza esatta del nome nei `fileCommands` caricati
- se trovato, applica:
  - sostituzione posizionale: `$1`, `$2`, ...
  - sostituzione aggregata: `$ARGUMENTS` e `$@`
  - poi rendering del template tramite `prompt.render` con `{ args, ARGUMENTS, arguments }`
- se nessuna corrispondenza, restituisce il testo originale invariato

### Avvertenze su `parseCommandArgs`

Il parser è una semplice suddivisione con riconoscimento delle virgolette:

- supporta la virgolettatura `'singola'` e `"doppia"` per mantenere gli spazi
- rimuove i delimitatori delle virgolette
- non implementa regole di escape con backslash
- una virgoletta non chiusa non è un errore; il parser consuma fino alla fine

## 7) Comportamento con input `/...` sconosciuto

L'input slash sconosciuto **non viene rifiutato** dalla logica slash principale.

Se il comando non viene gestito dai livelli estensione/personalizzato/file, `expandSlashCommand` restituisce il testo originale e il prompt letterale `/...` prosegue attraverso la normale espansione del template di prompt e la consegna all'LLM.

La modalità interattiva gestisce separatamente molti comandi integrati in `InputController` (ad esempio `/settings`, `/model`, `/mcp`, `/move`, `/exit`). Questi vengono consumati prima di `session.prompt(...)` e pertanto non raggiungono mai l'espansione dei comandi file in quel percorso.

## 8) Differenze durante lo streaming rispetto alla modalità inattiva

## Percorso inattivo

- `session.prompt("/x ...")` esegue la pipeline dei comandi ed esegue immediatamente il comando o invia direttamente il testo espanso.

## Percorso di streaming (`session.isStreaming === true`)

- `prompt(...)` esegue comunque prima le trasformazioni estensione/personalizzato/file/template
- poi richiede `streamingBehavior`:
  - `"steer"` -> accoda un messaggio di interruzione (`agent.steer`)
  - `"followUp"` -> accoda un messaggio post-turno (`agent.followUp`)
- se `streamingBehavior` viene omesso, il prompt genera un errore

### Comportamento di streaming specifico per i comandi

- I comandi delle estensioni vengono eseguiti immediatamente anche durante lo streaming (non messi in coda come testo).
- I metodi helper `steer(...)`/`followUp(...)` rifiutano i comandi delle estensioni (`#throwIfExtensionCommand`) per evitare di mettere in coda testo del comando per i gestori che devono essere eseguiti in modo sincrono.
- La riproduzione della coda di compattazione utilizza `isKnownSlashCommand(...)` per decidere se le voci in coda devono essere riprodotte tramite `session.prompt(...)` (per i comandi slash noti) rispetto ai metodi steer/follow-up grezzi.

## 9) Gestione degli errori e superfici di errore

- I fallimenti di caricamento dei provider sono isolati; il registro raccoglie gli avvisi e continua con gli altri provider.
- Gli elementi di comandi slash non validi (nome/percorso/contenuto mancante o livello non valido) vengono scartati dalla validazione delle funzionalità.
- Errori di analisi del frontmatter:
  - comandi nativi: l'errore di analisi fatale si propaga
  - comandi non nativi: avviso + analisi di fallback chiave/valore
- Le eccezioni dei gestori di comandi estensione/personalizzati vengono intercettate e segnalate tramite il canale di errori delle estensioni (o il fallback del logger per i comandi personalizzati senza runner di estensioni) e trattate come gestite (nessuna esecuzione di fallback indesiderata).
