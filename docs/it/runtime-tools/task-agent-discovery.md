---
title: Task Agent Discovery and Selection
description: >-
  Task agent discovery and selection logic for routing work to specialized
  subagent types.
sidebar:
  order: 6
  label: Task agent discovery
i18n:
  sourceHash: 8cf42457c672
  translator: machine
---

# Scoperta e selezione dei Task Agent

Questo documento descrive come il sottosistema task scopre le definizioni degli agent, unisce fonti multiple e risolve un agent richiesto al momento dell'esecuzione.

Copre il comportamento a runtime così come implementato attualmente, inclusa la precedenza, la gestione delle definizioni non valide e i vincoli di spawn/profondità che possono rendere un agent effettivamente non disponibile.

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

## Struttura della definizione degli agent

I task agent vengono normalizzati in `AgentDefinition` (`src/task/types.ts`):

- `name`, `description`, `systemPrompt` (obbligatori per un agent caricato valido)
- opzionali `tools`, `spawns`, `model`, `thinkingLevel`, `output`
- `source`: `"bundled" | "user" | "project"`
- opzionale `filePath`

Il parsing proviene dal frontmatter tramite `parseAgentFields()` (`src/discovery/helpers.ts`):

- `name` o `description` mancanti => non valido (`null`), il chiamante lo tratta come errore di parsing
- `tools` accetta CSV o array; se fornito, `submit_result` viene aggiunto automaticamente
- `spawns` accetta `*`, CSV o array
- comportamento di retrocompatibilità: se `spawns` è mancante ma `tools` include `task`, `spawns` diventa `*`
- `output` viene passato così com'è come dati di schema opachi

## Agent integrati (bundled)

Gli agent integrati sono incorporati al momento della build (`src/task/agents.ts`) usando importazioni di testo.

`EMBEDDED_AGENT_DEFS` definisce:

- `explore`, `plan`, `designer`, `reviewer` da file di prompt
- `task` e `quick_task` dal corpo condiviso `task.md` più frontmatter iniettato

Percorso di caricamento:

1. `loadBundledAgents()` esegue il parsing del markdown incorporato con `parseAgent(..., "bundled", "fatal")`
2. i risultati vengono memorizzati in cache in-memory (`bundledAgentsCache`)
3. `clearBundledAgentsCache()` è un reset della cache solo per i test

Poiché il parsing degli agent integrati usa `level: "fatal"`, un frontmatter malformato negli agent integrati genera un'eccezione e può far fallire completamente la scoperta.

## Scoperta da filesystem e plugin

`discoverAgents(cwd, home)` (`src/task/discovery.ts`) unisce gli agent da più fonti prima di aggiungere le definizioni degli agent integrati.

### Input della scoperta

1. Directory degli agent dalla configurazione utente tramite `getConfigDirs("agents", { project: false })`
2. Directory degli agent del progetto più vicino tramite `findAllNearestProjectConfigDirs("agents", cwd)`
3. Root dei plugin Claude (`listClaudePluginRoots(home)`) con sottodirectory `agents/`
4. Agent integrati (`loadBundledAgents()`)

### Ordine effettivo delle fonti

L'ordine delle famiglie di fonti proviene da `getConfigDirs("", { project: false })`, che è derivato da `priorityList` in `src/config.ts`:

1. `.xcsh`
2. `.claude`
3. `.codex`
4. `.gemini`

Per ogni famiglia di fonti, l'ordine di scoperta è:

1. directory del progetto più vicina per quella fonte (se trovata)
2. directory utente per quella fonte

Dopo tutte le directory delle famiglie di fonti, vengono aggiunte le directory `agents/` dei plugin (prima i plugin con scope progetto, poi quelli con scope utente).

Gli agent integrati vengono aggiunti per ultimi.

### Avvertenza importante: commenti obsoleti vs codice attuale

I commenti nell'intestazione di `discovery.ts` menzionano ancora `.pi` e non menzionano `.codex`/`.gemini`. L'ordine effettivo a runtime è guidato da `src/config.ts` e attualmente usa `.xcsh`, `.claude`, `.codex`, `.gemini`.

## Regole di unione e collisione

La scoperta usa la deduplicazione first-wins per nome esatto di `agent.name`:

- Un `Set<string>` tiene traccia dei nomi già visti.
- Gli agent caricati vengono appiattiti nell'ordine delle directory e mantenuti solo se il nome non è stato ancora visto.
- Gli agent integrati vengono filtrati rispetto allo stesso set e aggiunti solo se ancora non visti.

Implicazioni:

- Il progetto ha la precedenza sull'utente per la stessa famiglia di fonti.
- La famiglia di fonti con priorità più alta prevale su quella più bassa (`.xcsh` prima di `.claude`, ecc.).
- Gli agent non integrati hanno la precedenza sugli agent integrati con lo stesso nome.
- Il confronto dei nomi è case-sensitive (`Task` e `task` sono distinti).
- All'interno di una singola directory, i file markdown vengono letti in ordine lessicografico del nome file prima della deduplicazione.

## Comportamento con file agent non validi/mancanti

Per directory (`loadAgentsFromDir`):

- directory illeggibile/mancante: trattata come vuota (`readdir(...).catch(() => [])`)
- errore di lettura o parsing del file: viene registrato un warning, il file viene saltato
- il percorso di parsing usa `parseAgent(..., level: "warn")`

Il comportamento in caso di errore del frontmatter proviene da `parseFrontmatter`:

- errore di parsing a livello `warn`: viene registrato un warning
- il parser ricorre a un semplice parser linea per linea `key: value`
- se i campi obbligatori sono ancora mancanti, `parseAgentFields` fallisce, quindi viene lanciato `AgentParsingError` e catturato dal chiamante (il file viene saltato)

Effetto netto: un singolo file di agent personalizzato malformato non interrompe la scoperta degli altri file.

## Ricerca e selezione degli agent

La ricerca è una scansione lineare per nome esatto:

- `getAgent(agents, name)` => `agents.find(a => a.name === name)`

Nell'esecuzione dei task (`TaskTool.execute`):

1. gli agent vengono riscoperti al momento della chiamata (`discoverAgents(this.session.cwd)`)
2. il `params.agent` richiesto viene risolto tramite `getAgent`
3. un agent mancante restituisce una risposta immediata del tool:
   - `Unknown agent "...". Available: ...`
   - nessun sottoprocesso viene eseguito

### Descrizione vs scoperta al momento dell'esecuzione

`TaskTool.create()` costruisce la descrizione del tool dai risultati della scoperta al momento dell'inizializzazione (`buildDescription`).

`execute()` riscopre nuovamente gli agent. Quindi l'insieme a runtime può differire da quello elencato nella descrizione precedente del tool se i file degli agent sono cambiati durante la sessione.

## Guardrail per output strutturato e precedenza dello schema

Precedenza dello schema di output a runtime in `TaskTool.execute`:

1. `output` dal frontmatter dell'agent
2. `params.schema` della chiamata task
3. `outputSchema` della sessione padre

(`effectiveOutputSchema = effectiveAgent.output ?? outputSchema ?? this.session.outputSchema`)

Il testo di guardrail nel prompt in `src/prompts/tools/task.md` avverte del comportamento in caso di mismatch per gli agent con output strutturato (`explore`, `reviewer`): le istruzioni sul formato di output nel testo descrittivo possono entrare in conflitto con lo schema integrato e produrre output `null`.

Questa è una guida, non logica di validazione rigida a runtime in `discoverAgents`.

## Interazione con la scoperta dei comandi

`src/task/commands.ts` è un'infrastruttura parallela per i comandi di workflow (non definizioni di agent), ma segue lo stesso schema generale:

- scopre prima dai capability provider
- deduplica per nome con first-wins
- aggiunge i comandi integrati se ancora non visti
- ricerca per nome esatto tramite `getCommand`

In `src/task/index.ts`, gli helper per i comandi vengono riesportati insieme agli helper per la scoperta degli agent. La scoperta degli agent stessa non dipende dalla scoperta dei comandi a runtime.

## Vincoli di disponibilità oltre la scoperta

Un agent può essere scopribile ma comunque non disponibile per l'esecuzione a causa di guardrail di esecuzione.

### Policy di spawn del genitore

`TaskTool.execute` controlla `session.getSessionSpawns()`:

- `"*"` => consenti qualsiasi
- `""` => nega tutto
- lista CSV => consenti solo i nomi elencati

Se negato: risposta immediata `Cannot spawn '...'. Allowed: ...`.

### Guardia ambientale di blocco dell'auto-ricorsione

`PI_BLOCKED_AGENT` viene letto alla costruzione del tool. Se la richiesta corrisponde, l'esecuzione viene rifiutata con un messaggio di prevenzione della ricorsione.

### Gating della profondità di ricorsione (disponibilità del tool task nelle sessioni figlio)

In `runSubprocess` (`src/task/executor.ts`):

- la profondità è calcolata da `taskDepth`
- `task.maxRecursionDepth` controlla il limite
- quando si raggiunge la profondità massima:
  - il tool `task` viene rimosso dalla lista dei tool del figlio
  - `spawns` env del figlio viene impostato a vuoto

Quindi i livelli più profondi non possono generare ulteriori task anche se la definizione dell'agent include `spawns`.

## Avvertenza sulla modalità plan (implementazione attuale)

`TaskTool.execute` calcola un `effectiveAgent` per la modalità plan (antepone il prompt della modalità plan, forza un sottoinsieme di tool in sola lettura, azzera gli spawns), ma `runSubprocess` viene chiamato con `agent` anziché `effectiveAgent`.

Effetto attuale:

- override del modello / livello di thinking / schema di output sono derivati da `effectiveAgent`
- prompt di sistema e restrizioni su tool/spawn di `effectiveAgent` non vengono passati attraverso questo percorso di chiamata

Questa è un'avvertenza implementativa utile da conoscere quando si leggono le aspettative di comportamento della modalità plan.
