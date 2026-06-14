---
title: Scoperta e selezione degli agenti di task
description: >-
  Logica di scoperta e selezione degli agenti di task per l'instradamento del
  lavoro verso tipi di subagenti specializzati.
sidebar:
  order: 6
  label: Scoperta degli agenti di task
i18n:
  sourceHash: 8cf42457c672
  translator: machine
---

# Scoperta e selezione degli agenti di task

Questo documento descrive come il sottosistema di task individua le definizioni degli agenti, unisce più sorgenti e risolve un agente richiesto al momento dell'esecuzione.

Copre il comportamento in esecuzione così come implementato attualmente, incluse precedenza, gestione delle definizioni non valide e vincoli di spawn/profondità che possono rendere un agente effettivamente non disponibile.

## File di implementazione

- [`src/task/discovery.ts`](../../packages/coding-agent/src/task/discovery.ts)
- [`src/task/agents.ts`](../../packages/coding-agent/src/task/agents.ts)
- [`src/task/types.ts`](../../packages/coding-agent/src/task/types.ts)
- [`src/task/index.ts`](../../packages/coding-agent/src/task/index.ts)
- [`src/task/commands.ts`](../../packages/coding-agent/src/task/commands.ts)
- [`src/prompts/agents/task.md`](../../packages/coding-agent/src/prompts/agents/task.md)
- [`src/prompts/tools/task.md`](../../packages/coding-agent/src/prompts/tools/task.md)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/config.ts`](../../packages/coding-agent/src/config.ts)
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts)

---

## Struttura della definizione di un agente

Gli agenti di task vengono normalizzati in `AgentDefinition` (`src/task/types.ts`):

- `name`, `description`, `systemPrompt` (obbligatori per un agente caricato valido)
- `tools`, `spawns`, `model`, `thinkingLevel`, `output` opzionali
- `source`: `"bundled" | "user" | "project"`
- `filePath` opzionale

Il parsing proviene dal frontmatter tramite `parseAgentFields()` (`src/discovery/helpers.ts`):

- `name` o `description` mancanti => non valido (`null`), il chiamante lo tratta come errore di parsing
- `tools` accetta CSV o array; se fornito, `submit_result` viene aggiunto automaticamente
- `spawns` accetta `*`, CSV o array
- comportamento di compatibilità con versioni precedenti: se `spawns` è assente ma `tools` include `task`, `spawns` diventa `*`
- `output` viene passato come dato di schema opaco

## Agenti integrati (bundled)

Gli agenti integrati sono incorporati al momento della build (`src/task/agents.ts`) tramite importazioni di testo.

`EMBEDDED_AGENT_DEFS` definisce:

- `explore`, `plan`, `designer`, `reviewer` dai file di prompt
- `task` e `quick_task` dal corpo condiviso `task.md` più frontmatter iniettato

Percorso di caricamento:

1. `loadBundledAgents()` analizza il markdown incorporato con `parseAgent(..., "bundled", "fatal")`
2. i risultati vengono memorizzati nella cache in-memory (`bundledAgentsCache`)
3. `clearBundledAgentsCache()` è un reset della cache solo per i test

Poiché il parsing degli agenti integrati utilizza `level: "fatal"`, un frontmatter integrato malformato genera un'eccezione e può causare il fallimento dell'intera scoperta.

## Scoperta da filesystem e plugin

`discoverAgents(cwd, home)` (`src/task/discovery.ts`) unisce gli agenti provenienti da più fonti prima di aggiungere le definizioni integrate.

### Input di scoperta

1. Directory degli agenti dalla configurazione utente tramite `getConfigDirs("agents", { project: false })`
2. Directory degli agenti del progetto più vicino tramite `findAllNearestProjectConfigDirs("agents", cwd)`
3. Root dei plugin Claude (`listClaudePluginRoots(home)`) con sottodirectory `agents/`
4. Agenti integrati (`loadBundledAgents()`)

### Ordine effettivo delle sorgenti

L'ordine delle famiglie di sorgenti proviene da `getConfigDirs("", { project: false })`, derivato da `priorityList` in `src/config.ts`:

1. `.xcsh`
2. `.claude`
3. `.codex`
4. `.gemini`

Per ciascuna famiglia di sorgenti, l'ordine di scoperta è:

1. directory del progetto più vicina per quella sorgente (se trovata)
2. directory utente per quella sorgente

Dopo tutte le directory delle famiglie di sorgenti, vengono aggiunte le directory `agents/` dei plugin (prima i plugin con scope di progetto, poi quelli con scope utente).

Gli agenti integrati vengono aggiunti per ultimi.

### Avvertenza importante: commenti obsoleti rispetto al codice attuale

I commenti dell'intestazione di `discovery.ts` menzionano ancora `.pi` e non citano `.codex`/`.gemini`. L'ordine di esecuzione effettivo è determinato da `src/config.ts` e attualmente utilizza `.xcsh`, `.claude`, `.codex`, `.gemini`.

## Regole di unione e collisione

La scoperta utilizza la deduplicazione con priorità al primo trovato in base al `agent.name` esatto:

- Un `Set<string>` tiene traccia dei nomi già visti.
- Gli agenti caricati vengono appiattiti in ordine di directory e mantenuti solo se il nome non è stato ancora visto.
- Gli agenti integrati vengono filtrati rispetto allo stesso insieme e aggiunti solo se ancora non visti.

Implicazioni:

- Il progetto sovrascrive l'utente per la stessa famiglia di sorgenti.
- La famiglia di sorgenti con priorità più alta sovrascrive quella con priorità più bassa (`.xcsh` prima di `.claude`, ecc.).
- Gli agenti non integrati sovrascrivono gli agenti integrati con lo stesso nome.
- La corrispondenza dei nomi è case-sensitive (`Task` e `task` sono distinti).
- All'interno di una singola directory, i file markdown vengono letti in ordine lessicografico dei nomi file prima della deduplicazione.

## Comportamento con file di agente non validi o mancanti

Per directory (`loadAgentsFromDir`):

- directory non leggibile o mancante: trattata come vuota (`readdir(...).catch(() => [])`)
- errore di lettura o parsing del file: viene registrato un avviso, il file viene saltato
- il percorso di parsing utilizza `parseAgent(..., level: "warn")`

Il comportamento in caso di errore del frontmatter proviene da `parseFrontmatter`:

- un errore di parsing al livello `warn` registra un avviso
- il parser ricade su un parser semplice riga per riga `key: value`
- se i campi obbligatori sono ancora mancanti, `parseAgentFields` fallisce, quindi viene generato e catturato dal chiamante un `AgentParsingError` (il file viene saltato)

Effetto netto: un file di agente personalizzato non valido non interrompe la scoperta degli altri file.

## Ricerca e selezione degli agenti

La ricerca è una ricerca lineare per nome esatto:

- `getAgent(agents, name)` => `agents.find(a => a.name === name)`

Nell'esecuzione dei task (`TaskTool.execute`):

1. gli agenti vengono riscoperti al momento della chiamata (`discoverAgents(this.session.cwd)`)
2. il `params.agent` richiesto viene risolto tramite `getAgent`
3. un agente mancante restituisce una risposta immediata dello strumento:
   - `Unknown agent "...". Available: ...`
   - nessun sottoprocesso viene avviato

### Scoperta al momento della descrizione vs. al momento dell'esecuzione

`TaskTool.create()` costruisce la descrizione dello strumento dai risultati della scoperta al momento dell'inizializzazione (`buildDescription`).

`execute()` riscopre gli agenti nuovamente. Pertanto, l'insieme in esecuzione può differire da quello elencato nella descrizione dello strumento precedente se i file degli agenti sono stati modificati durante la sessione.

## Guardrail dell'output strutturato e precedenza degli schema

Precedenza dello schema di output in esecuzione in `TaskTool.execute`:

1. `output` del frontmatter dell'agente
2. `params.schema` della chiamata al task
3. `outputSchema` della sessione padre

(`effectiveOutputSchema = effectiveAgent.output ?? outputSchema ?? this.session.outputSchema`)

Il testo del guardrail al momento del prompt in `src/prompts/tools/task.md` avverte del comportamento in caso di mancata corrispondenza per gli agenti con output strutturato (`explore`, `reviewer`): le istruzioni sul formato di output in prosa possono entrare in conflitto con lo schema integrato e produrre output `null`.

Questo è un orientamento, non una logica di validazione rigida in esecuzione in `discoverAgents`.

## Interazione con la scoperta dei comandi

`src/task/commands.ts` è un'infrastruttura parallela per i comandi di workflow (non per le definizioni degli agenti), ma segue lo stesso schema generale:

- scoperta dai provider di capability per primi
- deduplicazione per nome con priorità al primo trovato
- aggiunta dei comandi integrati se ancora non visti
- ricerca per nome esatto tramite `getCommand`

In `src/task/index.ts`, gli helper dei comandi vengono ri-esportati insieme agli helper di scoperta degli agenti. La scoperta degli agenti stessa non dipende dalla scoperta dei comandi in esecuzione.

## Vincoli di disponibilità oltre la scoperta

Un agente può essere scopribile ma comunque non disponibile all'esecuzione a causa dei guardrail di esecuzione.

### Policy di spawn del padre

`TaskTool.execute` controlla `session.getSessionSpawns()`:

- `"*"` => consenti qualsiasi
- `""` => nega tutto
- lista CSV => consenti solo i nomi elencati

Se negato: risposta immediata `Cannot spawn '...'. Allowed: ...`.

### Guardrail di blocco della ricorsione su se stessi tramite variabile d'ambiente

`PI_BLOCKED_AGENT` viene letto alla costruzione dello strumento. Se la richiesta corrisponde, l'esecuzione viene rifiutata con un messaggio di prevenzione della ricorsione.

### Limitazione della profondità di ricorsione (disponibilità dello strumento task nelle sessioni figlio)

In `runSubprocess` (`src/task/executor.ts`):

- la profondità è calcolata da `taskDepth`
- `task.maxRecursionDepth` controlla il limite
- quando si è alla profondità massima:
  - lo strumento `task` viene rimosso dall'elenco degli strumenti del figlio
  - l'ambiente `spawns` del figlio viene impostato su vuoto

Quindi i livelli più profondi non possono avviare ulteriori task anche se la definizione dell'agente include `spawns`.

## Avvertenza sulla modalità piano (implementazione attuale)

`TaskTool.execute` calcola un `effectiveAgent` per la modalità piano (aggiunge il prompt della modalità piano all'inizio, forza un sottoinsieme di strumenti in sola lettura, cancella gli spawn), ma `runSubprocess` viene chiamato con `agent` anziché `effectiveAgent`.

Effetto attuale:

- l'override del modello / il livello di pensiero / lo schema di output sono derivati da `effectiveAgent`
- il prompt di sistema e le restrizioni su strumenti/spawn di `effectiveAgent` non vengono passati in questo percorso di chiamata

Questa è un'avvertenza implementativa da tenere presente quando si analizzano le aspettative sul comportamento della modalità piano.
