---
title: Skills
description: >-
  Sistema di skill per la registrazione, la scoperta e l'invocazione di capacità
  specializzate nell'agente di codifica.
sidebar:
  order: 3
  label: Skills
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# Skills

Le skill sono pacchetti di capacità supportati da file, scoperti all'avvio ed esposti al modello come:

- metadati leggeri nel prompt di sistema (nome + descrizione)
- contenuto on-demand tramite `read skill://...`
- comandi interattivi opzionali `/skill:<name>`

Questo documento tratta il comportamento runtime corrente in `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` e `src/discovery/agents-md.ts`.

## Cosa rappresenta una skill in questo codebase

Una skill scoperta è rappresentata come:

- `name`
- `description`
- `filePath` (il percorso del `SKILL.md`)
- `baseDir` (directory della skill)
- metadati di origine (`provider`, `level`, path)

Il runtime richiede solo `name` e `path` per la validità. In pratica, la qualità del matching dipende dal fatto che `description` sia significativa.

## Layout richiesto e aspettative di SKILL.md

### Layout delle directory

Per la scoperta basata su provider (provider native/Claude/Codex/Agents/plugin), le skill vengono scoperte come **un livello sotto `skills/`**:

- `<skills-root>/<skill-name>/SKILL.md`

Pattern annidati come `<skills-root>/group/<skill>/SKILL.md` non vengono scoperti dai loader dei provider.

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

Campi di frontmatter supportati nel tipo skill:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- le chiavi aggiuntive vengono preservate come metadati sconosciuti

Comportamento runtime corrente:

- `name` assume come valore predefinito il nome della directory della skill
- `description` è richiesta per:
  - scoperta delle skill del provider nativo `.xcsh` (`requireDescription: true`)
  - scansioni di `skills.customDirectories` tramite `scanSkillsFromDir` in `src/discovery/helpers.ts` (non ricorsiva)
- i provider non nativi possono caricare skill senza descrizione

## Pipeline di scoperta

`discoverSkills()` in `src/extensibility/skills.ts` effettua due passaggi:

1. **Provider di capacità** tramite `loadCapability("skills")`
2. **Directory personalizzate** tramite `scanSkillsFromDir(..., { requireDescription: true })` (enumerazione di directory a un livello)

Se `skills.enabled` è `false`, la scoperta non restituisce alcuna skill.

### Provider di skill integrati e precedenza

L'ordinamento dei provider è per priorità (la più alta vince), poi per ordine di registrazione in caso di parità.

Provider di skill attualmente registrati:

1. `native` (priorità 100) — skill utente/progetto `.xcsh` tramite `src/discovery/builtin.ts`
2. `claude` (priorità 80)
3. gruppo priorità 70 (in ordine di registrazione):
   - `claude-plugins`
   - `agents`
   - `codex`

La chiave di deduplicazione è il nome della skill. Il primo elemento con un dato nome vince.

### Toggle di origine e filtraggio

`discoverSkills()` applica questi controlli:

- toggle di origine: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- filtri glob sul nome della skill:
  - `ignoredSkills` (esclusione)
  - `includeSkills` (lista di inclusione consentita; se vuota significa includi tutto)

L'ordine dei filtri è:

1. origine abilitata
2. non ignorata
3. inclusa (se la lista di inclusione è presente)

Per i provider diversi da codex/claude/native (ad esempio `agents`, `claude-plugins`), l'abilitazione attualmente ricade su: abilitato se **qualsiasi** toggle di origine integrato è abilitato.

### Gestione di collisioni e duplicati

- La deduplicazione delle capacità mantiene già la prima skill per nome (provider con precedenza più alta)
- `extensibility/skills.ts` inoltre:
  - deduplica file identici tramite `realpath` (sicuro per i symlink)
  - emette avvisi di collisione quando il nome di una skill successiva è in conflitto
  - mantiene l'API di convenienza `discoverSkillsFromDir({ dir, source })` come adapter leggero su `scanSkillsFromDir`
- Le skill delle directory personalizzate vengono unite dopo le skill dei provider e seguono lo stesso comportamento di collisione

## Comportamento di utilizzo a runtime

### Esposizione nel prompt di sistema

La costruzione del prompt di sistema (`src/system-prompt.ts`) utilizza le skill scoperte come segue:

- se lo strumento `read` è disponibile:
  - include la lista delle skill scoperte nel prompt
- altrimenti:
  - omette la lista scoperta

I subagent dello strumento task ricevono la lista delle skill scoperte/fornite della sessione tramite la normale creazione della sessione; non esiste un override di pinning delle skill per singolo task.

### Comandi interattivi `/skill:<name>`

Se `skills.enableSkillCommands` è true, la modalità interattiva registra un comando slash per ogni skill scoperta.

Comportamento di `/skill:<name> [args]`:

- legge il file della skill direttamente da `filePath`
- rimuove il frontmatter
- inietta il corpo della skill come messaggio personalizzato di follow-up
- aggiunge metadati (`Skill: <path>`, opzionalmente `User: <args>`)

## Comportamento degli URL `skill://`

`src/internal-urls/skill-protocol.ts` supporta:

- `skill://<name>` → si risolve nel `SKILL.md` di quella skill
- `skill://<name>/<relative-path>` → si risolve all'interno della directory di quella skill

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

Dettagli della risoluzione:

- il nome della skill deve corrispondere esattamente
- i percorsi relativi vengono decodificati dall'URL
- i percorsi assoluti vengono rifiutati
- la traversata di percorso (`..`) viene rifiutata
- il percorso risolto deve rimanere all'interno di `baseDir`
- i file mancanti restituiscono un errore esplicito `File not found`

Tipo di contenuto:

- `.md` => `text/markdown`
- tutto il resto => `text/plain`

Non viene eseguita alcuna ricerca di fallback per asset mancanti.

## Skills vs AGENTS.md, comandi, strumenti, hook

### Skills vs AGENTS.md

- **Skills**: pacchetti di capacità nominati e opzionali, selezionati dal contesto del task o richiesti esplicitamente
- **AGENTS.md/file di contesto**: file di istruzioni persistenti caricati come capacità context-file e uniti per regole di livello/profondità

`src/discovery/agents-md.ts` in particolare percorre le directory antenate da `cwd` per scoprire file `AGENTS.md` autonomi (fino a profondità 20), escludendo i segmenti di directory nascosti.

### Skills vs comandi slash

- **Skills**: contenuto di conoscenza/workflow leggibile dal modello
- **Comandi slash**: punti di ingresso di comandi invocati dall'utente
- `/skill:<name>` è un wrapper di convenienza che inietta il testo della skill; non modifica la semantica di scoperta delle skill

### Skills vs strumenti personalizzati

- **Skills**: contenuto di documentazione/workflow caricato attraverso il contesto del prompt e `read`
- **Strumenti personalizzati**: API di strumenti eseguibili invocabili dal modello con schemi ed effetti collaterali a runtime

### Skills vs hook

- **Skills**: contenuto passivo
- **Hook**: intercettori runtime guidati da eventi che possono bloccare/modificare il comportamento durante l'esecuzione

## Guida pratica alla creazione legata alla logica di scoperta

- Posizionare ogni skill nella propria directory: `<skills-root>/<skill-name>/SKILL.md`
- Includere sempre frontmatter esplicito con `name` e `description`
- Mantenere gli asset di riferimento sotto la stessa directory della skill e accedervi con `skill://<name>/...`
- Per tassonomie annidate (`team/domain/skill`), puntare `skills.customDirectories` alla directory padre annidata; la scansione stessa rimane non ricorsiva
- Evitare nomi di skill duplicati tra le origini; la prima corrispondenza vince per precedenza del provider
