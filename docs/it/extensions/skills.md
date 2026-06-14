---
title: Competenze
description: >-
  Sistema di competenze per registrare, scoprire e invocare capacità
  specializzate nell'agente di codifica.
sidebar:
  order: 3
  label: Competenze
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# Competenze

Le competenze sono pacchetti di capacità basati su file, rilevati all'avvio ed esposti al modello come:

- metadati leggeri nel prompt di sistema (nome + descrizione)
- contenuto su richiesta tramite `read skill://...`
- comandi interattivi opzionali `/skill:<name>`

Questo documento descrive il comportamento runtime corrente in `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` e `src/discovery/agents-md.ts`.

## Cos'è una competenza in questo codebase

Una competenza rilevata è rappresentata da:

- `name`
- `description`
- `filePath` (il percorso `SKILL.md`)
- `baseDir` (directory della competenza)
- metadati della sorgente (`provider`, `level`, percorso)

Il runtime richiede solo `name` e `path` per la validità. In pratica, la qualità della corrispondenza dipende dal fatto che `description` sia significativa.

## Layout richiesto e aspettative di SKILL.md

### Layout della directory

Per il rilevamento basato su provider (provider nativi/Claude/Codex/Agents/plugin), le competenze vengono rilevate **un livello sotto `skills/`**:

- `<skills-root>/<skill-name>/SKILL.md`

I pattern annidati come `<skills-root>/group/<skill>/SKILL.md` non vengono rilevati dai loader dei provider.

Per `skills.customDirectories`, la scansione utilizza lo stesso layout non ricorsivo (`*/SKILL.md`).

```text
Provider-discovered layout (non-recursive under skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ discovered
  ├─ pdf/
  │   └─ SKILL.md      ✅ discovered
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ not discovered by provider loaders

Custom-directory scanning is also non-recursive, so nested paths are ignored unless you point `customDirectories` at that nested parent.
```

### Frontmatter di `SKILL.md`

Campi frontmatter supportati sul tipo di competenza:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- le chiavi aggiuntive vengono conservate come metadati sconosciuti

Comportamento runtime corrente:

- `name` ha come valore predefinito il nome della directory della competenza
- `description` è richiesta per:
  - il rilevamento di competenze del provider `.xcsh` nativo (`requireDescription: true`)
  - le scansioni `skills.customDirectories` tramite `scanSkillsFromDir` in `src/discovery/helpers.ts` (non ricorsivo)
- i provider non nativi possono caricare competenze senza descrizione

## Pipeline di rilevamento

`discoverSkills()` in `src/extensibility/skills.ts` esegue due passaggi:

1. **Provider di capacità** tramite `loadCapability("skills")`
2. **Directory personalizzate** tramite `scanSkillsFromDir(..., { requireDescription: true })` (enumerazione di directory a un livello)

Se `skills.enabled` è `false`, il rilevamento non restituisce competenze.

### Provider di competenze integrati e precedenza

L'ordinamento dei provider è basato prima sulla priorità (la più alta vince), poi sull'ordine di registrazione in caso di parità.

Provider di competenze attualmente registrati:

1. `native` (priorità 100) — competenze utente/progetto `.xcsh` tramite `src/discovery/builtin.ts`
2. `claude` (priorità 80)
3. gruppo con priorità 70 (in ordine di registrazione):
   - `claude-plugins`
   - `agents`
   - `codex`

La chiave di deduplicazione è il nome della competenza. Il primo elemento con un determinato nome vince.

### Attivatori di sorgente e filtraggio

`discoverSkills()` applica questi controlli:

- attivatori di sorgente: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- filtri glob sul nome della competenza:
  - `ignoredSkills` (escludi)
  - `includeSkills` (elenco consentiti da includere; vuoto significa includi tutto)

L'ordine dei filtri è:

1. sorgente abilitata
2. non ignorata
3. inclusa (se l'elenco di inclusione è presente)

Per i provider diversi da codex/claude/native (ad esempio `agents`, `claude-plugins`), l'abilitazione attualmente ricade su: abilitato se **qualsiasi** attivatore di sorgente integrato è abilitato.

### Gestione delle collisioni e dei duplicati

- La deduplicazione delle capacità mantiene già la prima competenza per nome (provider con precedenza più alta)
- `extensibility/skills.ts` in aggiunta:
  - deduplica i file identici per `realpath` (sicuro per i symlink)
  - emette avvisi di collisione quando il nome di una competenza successiva è in conflitto
  - mantiene l'API di utilità `discoverSkillsFromDir({ dir, source })` come adattatore sottile su `scanSkillsFromDir`
- Le competenze delle directory personalizzate vengono unite dopo le competenze del provider e seguono lo stesso comportamento in caso di collisione

## Comportamento di utilizzo runtime

### Esposizione del prompt di sistema

La costruzione del prompt di sistema (`src/system-prompt.ts`) utilizza le competenze rilevate come segue:

- se lo strumento `read` è disponibile:
  - include l'elenco delle competenze rilevate nel prompt
- altrimenti:
  - omette l'elenco rilevato

I sottoagenti dello strumento Task ricevono l'elenco di competenze rilevate/fornite della sessione tramite la normale creazione di sessione; non è previsto alcun override di blocco delle competenze per singolo task.

### Comandi interattivi `/skill:<name>`

Se `skills.enableSkillCommands` è true, la modalità interattiva registra un comando slash per ogni competenza rilevata.

Comportamento di `/skill:<name> [args]`:

- legge il file della competenza direttamente da `filePath`
- rimuove il frontmatter
- inietta il corpo della competenza come messaggio personalizzato di follow-up
- aggiunge metadati (`Skill: <path>`, `User: <args>` opzionale)

## Comportamento degli URL `skill://`

`src/internal-urls/skill-protocol.ts` supporta:

- `skill://<name>` → si risolve nel `SKILL.md` di quella competenza
- `skill://<name>/<relative-path>` → si risolve all'interno di quella directory della competenza

```text
skill:// URL resolution

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

Guards:
- reject absolute paths
- reject `..` traversal
- reject any resolved path escaping <pdf-base>
```

Dettagli di risoluzione:

- il nome della competenza deve corrispondere esattamente
- i percorsi relativi vengono decodificati tramite URL
- i percorsi assoluti vengono rifiutati
- l'attraversamento del percorso (`..`) viene rifiutato
- il percorso risolto deve rimanere all'interno di `baseDir`
- i file mancanti restituiscono un errore esplicito `File not found`

Tipo di contenuto:

- `.md` => `text/markdown`
- tutto il resto => `text/plain`

Non viene eseguita alcuna ricerca di fallback per gli asset mancanti.

## Competenze vs AGENTS.md, comandi, strumenti, hook

### Competenze vs AGENTS.md

- **Competenze**: pacchetti di capacità denominati e opzionali, selezionati dal contesto del task o richiesti esplicitamente
- **AGENTS.md/file di contesto**: file di istruzioni persistenti caricati come capacità di file di contesto e uniti secondo regole di livello/profondità

`src/discovery/agents-md.ts` esplora specificamente le directory antenate da `cwd` per rilevare file `AGENTS.md` autonomi (fino a una profondità di 20), escludendo i segmenti di directory nascoste.

### Competenze vs comandi slash

- **Competenze**: contenuto di conoscenze/workflow leggibile dal modello
- **Comandi slash**: punti di ingresso dei comandi invocati dall'utente
- `/skill:<name>` è un wrapper di utilità che inietta il testo della competenza; non modifica la semantica del rilevamento delle competenze

### Competenze vs strumenti personalizzati

- **Competenze**: contenuto di documentazione/workflow caricato tramite contesto del prompt e `read`
- **Strumenti personalizzati**: API di strumenti eseguibili invocabili dal modello con schemi ed effetti collaterali runtime

### Competenze vs hook

- **Competenze**: contenuto passivo
- **Hook**: intercettori runtime guidati da eventi che possono bloccare/modificare il comportamento durante l'esecuzione

## Guida pratica alla creazione legata alla logica di rilevamento

- Inserire ogni competenza nella propria directory: `<skills-root>/<skill-name>/SKILL.md`
- Includere sempre frontmatter espliciti con `name` e `description`
- Mantenere gli asset di riferimento nella stessa directory della competenza e accedervi con `skill://<name>/...`
- Per la tassonomia annidata (`team/domain/skill`), puntare `skills.customDirectories` alla directory padre annidata; la scansione stessa rimane non ricorsiva
- Evitare nomi di competenze duplicati tra le sorgenti; la prima corrispondenza vince per precedenza del provider
