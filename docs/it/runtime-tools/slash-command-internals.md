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

Questo documento descrive come i comandi slash vengono scoperti, deduplicati, esposti nella modalità interattiva e espansi al momento del prompt in `coding-agent`.

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

## 1) Modello di discovery

I comandi slash sono una capability (`id: "slash-commands"`) indicizzata per nome del comando (`key: cmd => cmd.name`).

Il registro delle capability carica tutti i provider registrati, ordinati per priorità del provider in ordine decrescente, e deduplica per chiave con semantica **il primo vince**.

### Precedenza dei provider

Provider attuali dei comandi slash e relative priorità:

1. `native` (OMP) — priorità `100`
2. `claude` — priorità `80`
3. `claude-plugins` — priorità `70`
4. `codex` — priorità `70`

Comportamento in caso di parità: i provider con la stessa priorità mantengono l'ordine di registrazione. L'ordine di importazione attuale registra `claude-plugins` prima di `codex`, quindi i comandi dei plugin prevalgono sui comandi codex in caso di collisione dei nomi.

### Comportamento in caso di collisione dei nomi

Per `slash-commands`, le collisioni vengono risolte rigorosamente tramite la deduplicazione delle capability:

- l'elemento con la precedenza più alta viene mantenuto in `result.items`
- i duplicati con precedenza inferiore rimangono solo in `result.all` e vengono contrassegnati con `_shadowed = true`

Questo si applica sia tra provider diversi sia all'interno di un singolo provider se restituisce nomi duplicati.

### Comportamento della scansione dei file

I provider utilizzano principalmente `loadFilesFromDir(...)`, che attualmente:

- utilizza per impostazione predefinita il matching non ricorsivo (`*.md`)
- usa il glob nativo con `gitignore: true`, `hidden: false`
- legge ogni file corrispondente e lo trasforma in un `SlashCommand`

Pertanto i file/directory nascosti non vengono caricati e i percorsi ignorati vengono saltati.

## 2) Percorsi sorgente specifici per provider e precedenza locale

## Provider `native` (`builtin.ts`)

Le directory radice di ricerca provengono dalle directory `.xcsh`:

- progetto: `<cwd>/.xcsh/commands/*.md`
- utente: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` restituisce prima il progetto, poi l'utente, quindi **i comandi nativi del progetto prevalgono sui comandi nativi dell'utente** in caso di collisione dei nomi.

## Provider `claude` (`claude.ts`)

Carica:

- utente: `~/.claude/commands/*.md`
- progetto: `<cwd>/.claude/commands/*.md`

Il provider inserisce gli elementi dell'utente prima di quelli del progetto, quindi **i comandi Claude dell'utente prevalgono sui comandi Claude del progetto** in caso di collisione dei nomi all'interno di questo provider.

## Provider `codex` (`codex.ts`)

Carica:

- utente: `~/.codex/commands/*.md`
- progetto: `<cwd>/.codex/commands/*.md`

Entrambi i lati vengono caricati e poi appiattiti con l'ordine utente-prima, quindi **i comandi Codex dell'utente prevalgono sui comandi Codex del progetto** in caso di collisione.

Il contenuto dei comandi Codex viene analizzato con rimozione del frontmatter (`parseFrontmatter`), e il nome del comando può essere sovrascritto dal frontmatter `name`; altrimenti viene utilizzato il nome del file.

## Provider `claude-plugins` (`claude-plugins.ts`)

Carica le directory radice dei comandi dei plugin da `~/.claude/plugins/installed_plugins.json`, poi scansiona `<pluginRoot>/commands/*.md`.

L'ordinamento segue l'ordine di iterazione del registro e l'ordine delle voci per plugin dal file JSON. Non c'è un passaggio di ordinamento aggiuntivo.

## 3) Materializzazione in `FileSlashCommand` a runtime

`loadSlashCommands()` in `src/extensibility/slash-commands.ts` converte gli elementi delle capability in oggetti `FileSlashCommand` utilizzati al momento del prompt.

Per ogni comando:

1. analizza frontmatter/body (`parseFrontmatter`)
2. origine della descrizione:
   - `frontmatter.description` se presente
   - altrimenti la prima riga non vuota del body (trimmata, max 60 caratteri con `...`)
3. mantiene il body analizzato come contenuto del template eseguibile
4. calcola una stringa sorgente di visualizzazione come `via Claude Code Project`

La severità dell'analisi del frontmatter dipende dalla sorgente:

- livello `native` -> gli errori di analisi sono `fatal`
- livelli `user`/`project` -> gli errori di analisi sono `warn` con analisi di fallback

### Comandi di fallback incorporati

Dopo i comandi da filesystem/provider, i template di comandi incorporati vengono aggiunti (`EMBEDDED_COMMAND_TEMPLATES`) se i loro nomi non sono già presenti.

Il set incorporato attuale proviene da `src/task/commands.ts` e viene utilizzato come fallback (`source: "bundled"`).

## 4) Modalità interattiva: da dove provengono le liste dei comandi

La modalità interattiva combina più sorgenti di comandi per l'autocompletamento e il routing dei comandi.

Al momento della costruzione, crea una lista di comandi in sospeso da:

- comandi built-in (`BUILTIN_SLASH_COMMANDS`, include il completamento degli argomenti e suggerimenti inline per i comandi selezionati)
- comandi slash registrati dalle estensioni (`extensionRunner.getRegisteredCommands(...)`)
- comandi personalizzati TypeScript (`session.customCommands`), mappati su etichette di comandi slash
- comandi skill opzionali (`/skill:<name>`) quando `skills.enableSkillCommands` è abilitato

Poi `init()` chiama `refreshSlashCommandState(...)` per caricare i comandi basati su file e installare un `CombinedAutocompleteProvider` contenente:

- i comandi in sospeso sopra indicati
- i comandi basati su file scoperti

`refreshSlashCommandState(...)` aggiorna anche `session.setSlashCommands(...)` in modo che l'espansione del prompt utilizzi lo stesso set di comandi file scoperti.

### Ciclo di vita del refresh

Lo stato dei comandi slash viene aggiornato:

- durante l'inizializzazione interattiva
- dopo che `/move` cambia la directory di lavoro (`handleMoveCommand` chiama `resetCapabilities()` poi `refreshSlashCommandState(newCwd)`)

Non esiste un file watcher continuo per le directory dei comandi.

### Altre superfici di esposizione

Anche la dashboard delle Estensioni carica la capability `slash-commands` e visualizza le voci dei comandi attivi/oscurati, inclusi i duplicati `_shadowed`.

## 5) Posizionamento nella pipeline del prompt

Ordine di gestione degli slash in `AgentSession.prompt(...)` (quando `expandPromptTemplates !== false`):

1. **Comandi delle estensioni** (`#tryExecuteExtensionCommand`)  
   Se `/name` corrisponde a un comando registrato dalle estensioni, l'handler viene eseguito immediatamente e il prompt ritorna.
2. **Comandi personalizzati TypeScript** (`#tryExecuteCustomCommand`)  
   Solo al confine: se c'è corrispondenza, viene eseguito e può restituire:
   - `string` -> sostituisce il testo del prompt con quella stringa
   - `void/undefined` -> trattato come gestito; nessun prompt LLM
3. **Comandi slash basati su file** (`expandSlashCommand`)  
   Se il testo inizia ancora con `/`, tenta l'espansione del comando markdown.
4. **Template del prompt** (`expandPromptTemplate`)  
   Applicati dopo l'elaborazione slash/personalizzata.
5. **Consegna**
   - idle: il prompt viene inviato immediatamente all'agente
   - streaming: il prompt viene messo in coda come steer/follow-up a seconda di `streamingBehavior`

Questo è il motivo per cui l'espansione dei comandi slash avviene prima dell'espansione dei template del prompt, e perché i comandi personalizzati possono eliminare lo slash iniziale prima del matching dei comandi file.

## 6) Semantica di espansione per i comandi slash basati su file

Comportamento di `expandSlashCommand(text, fileCommands)`:

- viene eseguito solo quando il testo inizia con `/`
- analizza il nome del comando dal primo token dopo `/`
- analizza gli argomenti dal testo rimanente tramite `parseCommandArgs`
- cerca una corrispondenza esatta del nome nei `fileCommands` caricati
- se c'è corrispondenza, applica:
  - sostituzione posizionale: `$1`, `$2`, ...
  - sostituzione aggregata: `$ARGUMENTS` e `$@`
  - poi il rendering del template tramite `prompt.render` con `{ args, ARGUMENTS, arguments }`
- se non c'è corrispondenza, restituisce il testo originale invariato

### Avvertenze su `parseCommandArgs`

Il parser è una semplice suddivisione consapevole delle virgolette:

- supporta le virgolette `'singole'` e `"doppie"` per mantenere gli spazi
- rimuove i delimitatori delle virgolette
- non implementa regole di escape con backslash
- una virgoletta non chiusa non è un errore; il parser consuma fino alla fine

## 7) Comportamento per `/...` sconosciuti

L'input slash sconosciuto **non viene rifiutato** dalla logica principale degli slash.

Se il comando non viene gestito dai livelli estensione/personalizzato/file, `expandSlashCommand` restituisce il testo originale, e il prompt letterale `/...` procede attraverso la normale espansione dei template del prompt e la consegna al LLM.

La modalità interattiva gestisce separatamente in modo diretto molti comandi built-in in `InputController` (ad esempio `/settings`, `/model`, `/mcp`, `/move`, `/exit`). Questi vengono consumati prima di `session.prompt(...)` e quindi non raggiungono mai l'espansione dei comandi file in quel percorso.

## 8) Differenze durante lo streaming rispetto all'idle

## Percorso idle

- `session.prompt("/x ...")` esegue la pipeline dei comandi e o esegue il comando immediatamente o invia il testo espanso direttamente.

## Percorso streaming (`session.isStreaming === true`)

- `prompt(...)` esegue comunque prima le trasformazioni estensione/personalizzato/file/template
- poi richiede `streamingBehavior`:
  - `"steer"` -> mette in coda un messaggio di interruzione (`agent.steer`)
  - `"followUp"` -> mette in coda un messaggio post-turno (`agent.followUp`)
- se `streamingBehavior` viene omesso, il prompt genera un errore

### Importante: comportamento specifico dei comandi durante lo streaming

- I comandi delle estensioni vengono eseguiti immediatamente anche durante lo streaming (non vengono messi in coda come testo).
- I metodi helper `steer(...)`/`followUp(...)` rifiutano i comandi delle estensioni (`#throwIfExtensionCommand`) per evitare di mettere in coda testo di comandi per handler che devono essere eseguiti in modo sincrono.
- Il replay della coda di compattazione usa `isKnownSlashCommand(...)` per decidere se le voci in coda debbano essere riprodotte tramite `session.prompt(...)` (per i comandi slash conosciuti) o tramite metodi steer/follow-up diretti.

## 9) Gestione degli errori e superfici di fallimento

- I fallimenti di caricamento dei provider sono isolati; il registro raccoglie avvisi e continua con gli altri provider.
- Gli elementi di comandi slash non validi (nome/percorso/contenuto mancante o livello non valido) vengono scartati dalla validazione delle capability.
- Fallimenti nell'analisi del frontmatter:
  - comandi nativi: l'errore fatale di analisi viene propagato
  - comandi non nativi: warning + analisi di fallback chiave/valore
- Le eccezioni degli handler dei comandi estensione/personalizzati vengono catturate e riportate tramite il canale errori delle estensioni (o il logger di fallback per i comandi personalizzati senza extension runner), e trattate come gestite (nessuna esecuzione di fallback non intenzionale).
