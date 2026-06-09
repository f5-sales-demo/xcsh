---
title: Competenze
description: >-
  Sistema di competenze per la registrazione, la scoperta e l'invocazione di
  capacità specializzate nell'agente di codifica.
sidebar:
  order: 3
  label: Competenze
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# Competenze

Le competenze sono pacchetti di capacità supportati da file, scoperti all'avvio ed esposti al modello come:

- metadati leggeri nel prompt di sistema (nome + descrizione)
- contenuto on-demand tramite `read skill://...`
- comandi interattivi opzionali `/skill:<name>`

Questo documento copre il comportamento runtime attuale in `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` e `src/discovery/agents-md.ts`.

## Cos'è una competenza in questo codebase

Una competenza scoperta è rappresentata come:

- `name`
- `description`
- `filePath` (il percorso `SKILL.md`)
- `baseDir` (directory della competenza)
- metadati di origine (`provider`, `level`, path)

Il runtime richiede solo `name` e `path` per la validità. In pratica, la qualità del matching dipende dal fatto che `description` sia significativa.

## Layout richiesto e aspettative di SKILL.md

### Layout delle directory

Per la scoperta basata su provider (provider native/Claude/Codex/Agents/plugin), le competenze vengono scoperte come **un livello sotto `skills/`**:

- `<skills-root>/<skill-name>/SKILL.md`

Pattern annidati come `<skills-root>/group/<skill>/SKILL.md` non vengono scoperti dai loader dei provider.

Per `skills.customDirectories`, la scansione utilizza lo stesso layout non ricorsivo (`*/SKILL.md`).

```text
Layout scoperto dai provider (non ricorsivo sotto skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ scoperto
  ├─ pdf/
  │   └─ SKILL.md      ✅ scoperto
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ non scoperto dai loader dei provider

La scansione delle directory personalizzate è anch'essa non ricorsiva, quindi i percorsi annidati vengono ignorati a meno che non si punti `customDirectories` alla directory padre annidata.
```

### Frontmatter di `SKILL.md`

Campi frontmatter supportati nel tipo skill:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- le chiavi aggiuntive vengono preservate come metadati sconosciuti

Comportamento runtime attuale:

- `name` assume come default il nome della directory della competenza
- `description` è richiesta per:
  - scoperta delle competenze del provider nativo `.xcsh` (`requireDescription: true`)
  - scansioni `skills.customDirectories` tramite `scanSkillsFromDir` in `src/discovery/helpers.ts` (non ricorsivo)
- i provider non nativi possono caricare competenze senza descrizione

## Pipeline di scoperta

`discoverSkills()` in `src/extensibility/skills.ts` esegue due passaggi:

1. **Provider di capacità** tramite `loadCapability("skills")`
2. **Directory personalizzate** tramite `scanSkillsFromDir(..., { requireDescription: true })` (enumerazione directory a un livello)

Se `skills.enabled` è `false`, la scoperta non restituisce competenze.

### Provider di competenze integrati e precedenza

L'ordinamento dei provider è prima per priorità (la più alta vince), poi per ordine di registrazione in caso di parità.

Provider di competenze attualmente registrati:

1. `native` (priorità 100) — competenze utente/progetto `.xcsh` tramite `src/discovery/builtin.ts`
2. `claude` (priorità 80)
3. gruppo priorità 70 (in ordine di registrazione):
   - `claude-plugins`
   - `agents`
   - `codex`

La chiave di deduplicazione è il nome della competenza. Il primo elemento con un dato nome vince.

### Toggle delle sorgenti e filtraggio

`discoverSkills()` applica questi controlli:

- toggle delle sorgenti: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- filtri glob sul nome della competenza:
  - `ignoredSkills` (esclusione)
  - `includeSkills` (allowlist di inclusione; vuoto significa includi tutto)

L'ordine dei filtri è:

1. sorgente abilitata
2. non ignorata
3. inclusa (se la lista di inclusione è presente)

Per i provider diversi da codex/claude/native (ad esempio `agents`, `claude-plugins`), l'abilitazione attualmente ricade su: abilitato se **qualsiasi** toggle di sorgente integrato è abilitato.

### Gestione delle collisioni e dei duplicati

- La deduplicazione delle capacità mantiene già la prima competenza per nome (provider con precedenza più alta)
- `extensibility/skills.ts` inoltre:
  - deduplica file identici tramite `realpath` (sicuro per i symlink)
  - emette avvisi di collisione quando un nome di competenza successivo è in conflitto
  - mantiene l'API di convenienza `discoverSkillsFromDir({ dir, source })` come adattatore sottile su `scanSkillsFromDir`
- Le competenze delle directory personalizzate vengono unite dopo le competenze dei provider e seguono lo stesso comportamento di collisione

## Comportamento di utilizzo runtime

### Esposizione nel prompt di sistema

La costruzione del prompt di sistema (`src/system-prompt.ts`) utilizza le competenze scoperte come segue:

- se lo strumento `read` è disponibile:
  - include la lista delle competenze scoperte nel prompt
- altrimenti:
  - omette la lista scoperta

I subagent dello strumento task ricevono la lista di competenze scoperte/fornite della sessione tramite la normale creazione della sessione; non esiste un override di pinning delle competenze per singolo task.

### Comandi interattivi `/skill:<name>`

Se `skills.enableSkillCommands` è true, la modalità interattiva registra un comando slash per ogni competenza scoperta.

Comportamento di `/skill:<name> [args]`:

- legge il file della competenza direttamente da `filePath`
- rimuove il frontmatter
- inietta il corpo della competenza come messaggio personalizzato di follow-up
- aggiunge metadati (`Skill: <path>`, opzionalmente `User: <args>`)

## Comportamento degli URL `skill://`

`src/internal-urls/skill-protocol.ts` supporta:

- `skill://<name>` → si risolve al `SKILL.md` di quella competenza
- `skill://<name>/<relative-path>` → si risolve all'interno della directory di quella competenza

```text
Risoluzione degli URL skill://

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

Protezioni:
- rifiuta i percorsi assoluti
- rifiuta il traversal con `..`
- rifiuta qualsiasi percorso risolto che esce da <pdf-base>
```

Dettagli della risoluzione:

- il nome della competenza deve corrispondere esattamente
- i percorsi relativi vengono decodificati dall'URL
- i percorsi assoluti vengono rifiutati
- il traversal dei percorsi (`..`) viene rifiutato
- il percorso risolto deve rimanere all'interno di `baseDir`
- i file mancanti restituiscono un errore esplicito `File not found`

Tipo di contenuto:

- `.md` => `text/markdown`
- tutto il resto => `text/plain`

Non viene effettuata alcuna ricerca di fallback per gli asset mancanti.

## Competenze vs AGENTS.md, comandi, strumenti, hook

### Competenze vs AGENTS.md

- **Competenze**: pacchetti di capacità nominati e opzionali, selezionati dal contesto del task o richiesti esplicitamente
- **AGENTS.md/file di contesto**: file di istruzioni persistenti caricati come capacità di file di contesto e uniti per regole di livello/profondità

`src/discovery/agents-md.ts` specificamente percorre le directory antenate da `cwd` per scoprire file `AGENTS.md` autonomi (fino a profondità 20), escludendo i segmenti di directory nascosti.

### Competenze vs comandi slash

- **Competenze**: contenuto di conoscenza/workflow leggibile dal modello
- **Comandi slash**: punti di ingresso di comandi invocati dall'utente
- `/skill:<name>` è un wrapper di convenienza che inietta il testo della competenza; non modifica la semantica della scoperta delle competenze

### Competenze vs strumenti personalizzati

- **Competenze**: contenuto di documentazione/workflow caricato tramite contesto del prompt e `read`
- **Strumenti personalizzati**: API di strumenti eseguibili richiamabili dal modello con schemi ed effetti collaterali runtime

### Competenze vs hook

- **Competenze**: contenuto passivo
- **Hook**: intercettori runtime guidati da eventi che possono bloccare/modificare il comportamento durante l'esecuzione

## Guida pratica alla creazione legata alla logica di scoperta

- Metti ogni competenza nella propria directory: `<skills-root>/<skill-name>/SKILL.md`
- Includi sempre frontmatter esplicito con `name` e `description`
- Mantieni gli asset referenziati nella stessa directory della competenza e accedivi con `skill://<name>/...`
- Per tassonomie annidate (`team/domain/skill`), punta `skills.customDirectories` alla directory padre annidata; la scansione stessa rimane non ricorsiva
- Evita nomi di competenze duplicati tra le sorgenti; la prima corrispondenza vince per precedenza del provider
