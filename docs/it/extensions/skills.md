---
title: Competenze
description: >-
  Sistema di competenze per la registrazione, il rilevamento e l'invocazione di
  capacità specializzate nell'agente di codifica.
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
- comandi interattivi facoltativi `/skill:<name>`

Questo documento descrive il comportamento attuale del runtime in `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` e `src/discovery/agents-md.ts`.

## Cosa rappresenta una competenza in questo codebase

Una competenza rilevata è rappresentata come:

- `name`
- `description`
- `filePath` (il percorso `SKILL.md`)
- `baseDir` (directory della competenza)
- metadati di origine (`provider`, `level`, percorso)

Il runtime richiede solo `name` e `path` per la validità. In pratica, la qualità della corrispondenza dipende dal fatto che `description` sia significativa.

## Layout richiesto e aspettative su SKILL.md

### Layout della directory

Per il rilevamento basato su provider (provider nativi/Claude/Codex/Agents/plugin), le competenze vengono rilevate a **un livello sotto `skills/`**:

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

Campi frontmatter supportati nel tipo della competenza:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- le chiavi aggiuntive vengono mantenute come metadati sconosciuti

Comportamento attuale del runtime:

- `name` utilizza per impostazione predefinita il nome della directory della competenza
- `description` è obbligatoria per:
  - il rilevamento delle competenze del provider nativo `.xcsh` (`requireDescription: true`)
  - le scansioni di `skills.customDirectories` tramite `scanSkillsFromDir` in `src/discovery/helpers.ts` (non ricorsivo)
- i provider non nativi possono caricare competenze senza descrizione

## Pipeline di rilevamento

`discoverSkills()` in `src/extensibility/skills.ts` esegue due passaggi:

1. **Provider di capacità** tramite `loadCapability("skills")`
2. **Directory personalizzate** tramite `scanSkillsFromDir(..., { requireDescription: true })` (enumerazione di directory a un livello)

Se `skills.enabled` è `false`, il rilevamento non restituisce alcuna competenza.

### Provider di competenze predefiniti e precedenza

L'ordinamento dei provider è basato sulla priorità (la più alta prevale), poi sull'ordine di registrazione in caso di parità.

Provider di competenze attualmente registrati:

1. `native` (priorità 100) — competenze utente/progetto `.xcsh` tramite `src/discovery/builtin.ts`
2. `claude` (priorità 80)
3. gruppo priorità 70 (in ordine di registrazione):
   - `claude-plugins`
   - `agents`
   - `codex`

La chiave di deduplicazione è il nome della competenza. Vince il primo elemento con un determinato nome.

### Controlli di origine e filtraggio

`discoverSkills()` applica questi controlli:

- controlli di origine: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- filtri glob sul nome della competenza:
  - `ignoredSkills` (escludi)
  - `includeSkills` (lista di inclusione consentita; vuota significa includi tutto)

L'ordine dei filtri è:

1. origine abilitata
2. non ignorata
3. inclusa (se è presente una lista di inclusione)

Per i provider diversi da codex/claude/native (ad esempio `agents`, `claude-plugins`), l'abilitazione ricade attualmente su: abilitato se **almeno** un controllo di origine predefinito è abilitato.

### Gestione di collisioni e duplicati

- La deduplicazione delle capacità mantiene già la prima competenza per nome (provider con precedenza più alta)
- `extensibility/skills.ts` inoltre:
  - deduplica i file identici tramite `realpath` (sicuro per i symlink)
  - emette avvisi di collisione quando il nome di una competenza successiva è in conflitto
  - mantiene l'API `discoverSkillsFromDir({ dir, source })` come adattatore sottile su `scanSkillsFromDir`
- Le competenze delle directory personalizzate vengono unite dopo le competenze dei provider e seguono lo stesso comportamento di collisione

## Comportamento di utilizzo del runtime

### Esposizione nel prompt di sistema

La costruzione del prompt di sistema (`src/system-prompt.ts`) utilizza le competenze rilevate come segue:

- se lo strumento `read` è disponibile:
  - include la lista delle competenze rilevate nel prompt
- altrimenti:
  - omette la lista rilevata

I sottoagenti dello strumento Task ricevono la lista delle competenze rilevate/fornite della sessione tramite la normale creazione della sessione; non esiste un override di blocco delle competenze per attività.

### Comandi interattivi `/skill:<name>`

Se `skills.enableSkillCommands` è true, la modalità interattiva registra un comando slash per ogni competenza rilevata.

Comportamento di `/skill:<name> [args]`:

- legge il file della competenza direttamente da `filePath`
- rimuove il frontmatter
- inietta il corpo della competenza come messaggio personalizzato di follow-up
- aggiunge metadati (`Skill: <path>`, `User: <args>` opzionale)

## Comportamento degli URL `skill://`

`src/internal-urls/skill-protocol.ts` supporta:

- `skill://<name>` → risolve nel `SKILL.md` di quella competenza
- `skill://<name>/<relative-path>` → risolve all'interno della directory di quella competenza

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
- i percorsi relativi vengono decodificati dall'URL
- i percorsi assoluti vengono rifiutati
- l'attraversamento del percorso (`..`) viene rifiutato
- il percorso risolto deve rimanere all'interno di `baseDir`
- i file mancanti restituiscono un errore esplicito `File not found`

Tipo di contenuto:

- `.md` => `text/markdown`
- tutto il resto => `text/plain`

Non viene eseguita alcuna ricerca alternativa per gli asset mancanti.

## Competenze vs XCSH.md, comandi, strumenti, hook

### Competenze vs XCSH.md

- **Competenze**: pacchetti di capacità denominati e facoltativi, selezionati in base al contesto dell'attività o richiesti esplicitamente
- **XCSH.md/file di contesto**: file di istruzioni persistenti caricati come capacità di file di contesto e uniti in base alle regole di livello/profondità

`src/discovery/agents-md.ts` naviga specificamente nelle directory antenate da `cwd` per rilevare file `XCSH.md` standalone (fino a una profondità di 20), escludendo i segmenti di directory nascosti.

### Competenze vs comandi slash

- **Competenze**: contenuto di conoscenza/flusso di lavoro leggibile dal modello
- **Comandi slash**: punti di ingresso dei comandi invocati dall'utente
- `/skill:<name>` è un wrapper di convenienza che inietta il testo della competenza; non modifica la semantica del rilevamento delle competenze

### Competenze vs strumenti personalizzati

- **Competenze**: contenuto di documentazione/flusso di lavoro caricato tramite il contesto del prompt e `read`
- **Strumenti personalizzati**: API di strumenti eseguibili richiamabili dal modello con schemi ed effetti collaterali del runtime

### Competenze vs hook

- **Competenze**: contenuto passivo
- **Hook**: intercettori del runtime guidati dagli eventi che possono bloccare/modificare il comportamento durante l'esecuzione

## Guida pratica alla creazione legata alla logica di rilevamento

- Inserire ogni competenza nella propria directory: `<skills-root>/<skill-name>/SKILL.md`
- Includere sempre il frontmatter esplicito `name` e `description`
- Mantenere gli asset di riferimento sotto la stessa directory della competenza e accedervi con `skill://<name>/...`
- Per la tassonomia annidata (`team/domain/skill`), puntare `skills.customDirectories` alla directory padre annidata; la scansione stessa rimane non ricorsiva
- Evitare nomi di competenze duplicati tra le origini; vince la prima corrispondenza per precedenza del provider
