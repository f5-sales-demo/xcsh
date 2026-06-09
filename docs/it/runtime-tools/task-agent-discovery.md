---
title: Scoperta e selezione dei Task Agent
description: >-
  Logica di scoperta e selezione dei task agent per l'instradamento del lavoro
  verso tipologie specializzate di subagent.
sidebar:
  order: 6
  label: Scoperta dei task agent
i18n:
  sourceHash: 8cf42457c672
  translator: machine
---

# Scoperta e selezione dei Task Agent

Questo documento descrive come il sottosistema dei task scopre le definizioni degli agent, unisce molteplici fonti e risolve un agent richiesto al momento dell'esecuzione.

Copre il comportamento runtime come implementato attualmente, inclusa la precedenza, la gestione delle definizioni non valide e i vincoli di spawn/profondità che possono rendere un agent effettivamente non disponibile.

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

## Struttura della definizione dell'agent

I task agent vengono normalizzati in `AgentDefinition` (`src/task/types.ts`):

- `name`, `description`, `systemPrompt` (obbligatori per un agent caricato valido)
- opzionali: `tools`, `spawns`, `model`, `thinkingLevel`, `output`
- `source`: `"bundled" | "user" | "project"`
- opzionale: `filePath`

Il parsing proviene dal frontmatter tramite `parseAgentFields()` (`src/discovery/helpers.ts`):

- `name` o `description` mancanti => non valido (`null`), il chiamante lo tratta come errore di parsing
- `tools` accetta CSV o array; se fornito, `submit_result` viene aggiunto automaticamente
- `spawns` accetta `*`, CSV o array
- comportamento di retrocompatibilità: se `spawns` è mancante ma `tools` include `task`, `spawns` diventa `*`
- `output` viene passato così com'è come dato di schema opaco

## Agent integrati (bundled)

Gli agent integrati sono incorporati al momento della build (`src/task/agents.ts`) tramite importazioni di testo.

`EMBEDDED_AGENT_DEFS` definisce:

- `explore`, `plan`, `designer`, `reviewer` dai file dei prompt
- `task` e `quick_task` dal corpo condiviso `task.md` più frontmatter iniettato

Percorso di caricamento:

1. `loadBundledAgents()` analizza il markdown incorporato con `parseAgent(..., "bundled", "fatal")`
2. i risultati vengono memorizzati nella cache in memoria (`bundledAgentsCache`)
3. `clearBundledAgentsCache()` è un reset della cache solo per i test

Poiché il parsing degli agent integrati utilizza `level: "fatal"`, un frontmatter malformato negli agent integrati lancia un'eccezione e può far fallire completamente la scoperta.

## Scoperta da filesystem e plugin

`discoverAgents(cwd, home)` (`src/task/discovery.ts`) unisce gli agent da molteplici posizioni prima di aggiungere le definizioni integrate.

### Input della scoperta

1. Directory degli agent dalla configurazione utente tramite `getConfigDirs("agents", { project: false })`
2. Directory degli agent del progetto più vicine tramite `findAllNearestProjectConfigDirs("agents", cwd)`
3. Root dei plugin Claude (`listClaudePluginRoots(home)`) con sottodirectory `agents/`
4. Agent integrati (`loadBundledAgents()`)

### Ordine effettivo delle fonti

L'ordine della famiglia di fonti proviene da `getConfigDirs("", { project: false })`, derivato da `priorityList` in `src/config.ts`:

1. `.xcsh`
2. `.claude`
3. `.codex`
4. `.gemini`

Per ogni famiglia di fonti, l'ordine di scoperta è:

1. directory del progetto più vicina per quella fonte (se trovata)
2. directory utente per quella fonte

Dopo tutte le directory delle famiglie di fonti, vengono aggiunte le directory `agents/` dei plugin (prima i plugin con ambito progetto, poi quelli con ambito utente).

Gli agent integrati vengono aggiunti per ultimi.

### Avvertenza importante: commenti obsoleti vs codice attuale

I commenti nell'intestazione di `discovery.ts` menzionano ancora `.pi` e non menzionano `.codex`/`.gemini`. L'ordine runtime effettivo è guidato da `src/config.ts` e attualmente utilizza `.xcsh`, `.claude`, `.codex`, `.gemini`.

## Regole di unione e collisione

La scoperta utilizza la deduplicazione con priorità al primo per nome esatto di `agent.name`:

- Un `Set<string>` tiene traccia dei nomi già visti.
- Gli agent caricati vengono appiattiti nell'ordine delle directory e mantenuti solo se il nome non è stato ancora visto.
- Gli agent integrati vengono filtrati rispetto allo stesso set e aggiunti solo se ancora non visti.

Implicazioni:

- Il progetto sovrascrive l'utente per la stessa famiglia di fonti.
- La famiglia di fonti con priorità più alta sovrascrive quella più bassa (`.xcsh` prima di `.claude`, ecc.).
- Gli agent non integrati sovrascrivono gli agent integrati con lo stesso nome.
- Il confronto dei nomi è case-sensitive (`Task` e `task` sono distinti).
- All'interno di una directory, i file markdown vengono letti in ordine lessicografico dei nomi dei file prima della deduplicazione.

## Comportamento con file agent non validi/mancanti

Per directory (`loadAgentsFromDir`):

- directory illeggibile/mancante: trattata come vuota (`readdir(...).catch(() => [])`)
- errore di lettura o parsing del file: viene registrato un warning, il file viene saltato
- il percorso di parsing utilizza `parseAgent(..., level: "warn")`

Il comportamento in caso di errore del frontmatter proviene da `parseFrontmatter`:

- errore di parsing al livello `warn` registra un warning
- il parser ricorre a un semplice parser riga per riga `key: value`
- se i campi obbligatori sono ancora mancanti, `parseAgentFields` fallisce, quindi viene lanciato `AgentParsingError` e catturato dal chiamante (il file viene saltato)

Effetto netto: un singolo file di agent personalizzato malformato non interrompe la scoperta degli altri file.

## Ricerca e selezione dell'agent

La ricerca è una scansione lineare per nome esatto:

- `getAgent(agents, name)` => `agents.find(a => a.name === name)`

Nell'esecuzione del task (`TaskTool.execute`):

1. gli agent vengono riscoperti al momento della chiamata (`discoverAgents(this.session.cwd)`)
2. il `params.agent` richiesto viene risolto tramite `getAgent`
3. un agent mancante restituisce una risposta immediata del tool:
   - `Unknown agent "...". Available: ...`
   - nessun sottoprocesso viene eseguito

### Descrizione vs scoperta al momento dell'esecuzione

`TaskTool.create()` costruisce la descrizione del tool dai risultati della scoperta al momento dell'inizializzazione (`buildDescription`).

`execute()` riscopre nuovamente gli agent. Quindi l'insieme runtime può differire da quello elencato nella descrizione del tool precedente se i file degli agent sono cambiati durante la sessione.

## Guardrail per output strutturato e precedenza degli schema

Precedenza dello schema di output runtime in `TaskTool.execute`:

1. `output` del frontmatter dell'agent
2. `params.schema` della chiamata al task
3. `outputSchema` della sessione padre

(`effectiveOutputSchema = effectiveAgent.output ?? outputSchema ?? this.session.outputSchema`)

Il testo di guardrail nel prompt in `src/prompts/tools/task.md` avverte del comportamento di mismatch per gli agent con output strutturato (`explore`, `reviewer`): le istruzioni sul formato di output nel testo possono entrare in conflitto con lo schema integrato e produrre output `null`.

Questa è una guida, non una logica di validazione runtime rigida in `discoverAgents`.

## Interazione con la scoperta dei comandi

`src/task/commands.ts` è un'infrastruttura parallela per i comandi workflow (non definizioni di agent), ma segue lo stesso schema generale:

- scoperta prima dai capability provider
- deduplicazione per nome con priorità al primo
- aggiunta dei comandi integrati se ancora non visti
- ricerca per nome esatto tramite `getCommand`

In `src/task/index.ts`, gli helper dei comandi vengono ri-esportati insieme agli helper di scoperta degli agent. La scoperta degli agent stessa non dipende dalla scoperta dei comandi a runtime.

## Vincoli di disponibilità oltre la scoperta

Un agent può essere scopribile ma comunque non disponibile per l'esecuzione a causa dei guardrail di esecuzione.

### Policy di spawn del genitore

`TaskTool.execute` controlla `session.getSessionSpawns()`:

- `"*"` => consenti qualsiasi
- `""` => nega tutti
- lista CSV => consenti solo i nomi elencati

Se negato: risposta immediata `Cannot spawn '...'. Allowed: ...`.

### Guardia ambientale contro l'auto-ricorsione bloccata

`PI_BLOCKED_AGENT` viene letto alla costruzione del tool. Se la richiesta corrisponde, l'esecuzione viene rifiutata con un messaggio di prevenzione della ricorsione.

### Limitazione della profondità di ricorsione (disponibilità del tool task nelle sessioni figlio)

In `runSubprocess` (`src/task/executor.ts`):

- la profondità viene calcolata da `taskDepth`
- `task.maxRecursionDepth` controlla il limite
- quando si raggiunge la profondità massima:
  - il tool `task` viene rimosso dalla lista dei tool del figlio
  - l'env `spawns` del figlio viene impostato a vuoto

Quindi i livelli più profondi non possono generare ulteriori task anche se la definizione dell'agent include `spawns`.

## Avvertenza sulla modalità piano (implementazione attuale)

`TaskTool.execute` calcola un `effectiveAgent` per la modalità piano (antepone il prompt della modalità piano, forza un sottoinsieme di tool in sola lettura, svuota gli spawns), ma `runSubprocess` viene chiamato con `agent` anziché `effectiveAgent`.

Effetto attuale:

- l'override del modello / livello di thinking / schema di output sono derivati da `effectiveAgent`
- il prompt di sistema e le restrizioni su tool/spawn da `effectiveAgent` non vengono passati attraverso questo percorso di chiamata

Questa è un'avvertenza implementativa importante da conoscere quando si leggono le aspettative sul comportamento della modalità piano.
