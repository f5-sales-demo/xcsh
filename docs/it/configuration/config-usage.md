---
title: Configuration Discovery and Resolution
description: >-
  How xcsh discovers, resolves, and layers configuration from project, user, and
  enterprise roots.
sidebar:
  order: 1
  label: Configuration
i18n:
  sourceHash: a8d23493ed0d
  translator: machine
---

# Scoperta e risoluzione della configurazione

Questo documento descrive come il coding-agent risolve la configurazione attualmente: quali root vengono analizzate, come funziona la precedenza e come la configurazione risolta viene utilizzata da settings, skill, hook, tool ed estensioni.

## Ambito

Implementazione primaria:

- `src/config.ts`
- `src/config/settings.ts`
- `src/config/settings-schema.ts`
- `src/discovery/builtin.ts`
- `src/discovery/helpers.ts`

Punti di integrazione chiave:

- `src/capability/index.ts`
- `src/discovery/index.ts`
- `src/extensibility/skills.ts`
- `src/extensibility/hooks/loader.ts`
- `src/extensibility/custom-tools/loader.ts`
- `src/extensibility/extensions/loader.ts`

---

## Flusso di risoluzione (visuale)

```text
         Config roots (ordered)
┌───────────────────────────────────────┐
│ 1) ~/.xcsh/agent + <cwd>/.xcsh          │
│ 2) ~/.claude   + <cwd>/.claude        │
│ 3) ~/.codex    + <cwd>/.codex         │
│ 4) ~/.gemini   + <cwd>/.gemini        │
└───────────────────────────────────────┘
                    │
                    ▼
        config.ts helper resolution
  (getConfigDirs/findConfigFile/findNearest...)
                    │
                    ▼
       capability providers enumerate items
 (native, claude, codex, gemini, agents, etc.)
                    │
                    ▼
      priority sort + per-capability dedup
                    │
                    ▼
          subsystem-specific consumption
   (settings, skills, hooks, tools, extensions)
```

## 1) Root di configurazione e ordine delle sorgenti

## Root canoniche

`src/config.ts` definisce un elenco fisso di priorità delle sorgenti:

1. `.xcsh` (nativo)
2. `.claude`
3. `.codex`
4. `.gemini`

Basi a livello utente:

- `~/.xcsh/agent`
- `~/.claude`
- `~/.codex`
- `~/.gemini`

Basi a livello progetto:

- `<cwd>/.xcsh`
- `<cwd>/.claude`
- `<cwd>/.codex`
- `<cwd>/.gemini`

`CONFIG_DIR_NAME` è `.xcsh` (`packages/utils/src/dirs.ts`).

## Vincolo importante

Gli helper generici in `src/config.ts` **non** includono `.pi` nell'ordine di scoperta delle sorgenti.

---

## 2) Helper principali di scoperta (`src/config.ts`)

## `getConfigDirs(subpath, options)`

Restituisce voci ordinate:

- Prima le voci a livello utente (per priorità della sorgente)
- Poi le voci a livello progetto (per la stessa priorità della sorgente)

Opzioni:

- `user` (default `true`)
- `project` (default `true`)
- `cwd` (default `getProjectDir()`)
- `existingOnly` (default `false`)

Questa API viene utilizzata per le ricerche di configurazione basate su directory (comandi, hook, tool, agenti, ecc.).

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

Cerca il primo file esistente attraverso le basi ordinate, restituisce la prima corrispondenza (solo percorso o percorso+metadati).

## `findAllNearestProjectConfigDirs(subpath, cwd)`

Risale le directory padre verso l'alto e restituisce la **directory esistente più vicina per ogni base sorgente** (`.xcsh`, `.claude`, `.codex`, `.gemini`), quindi ordina i risultati per priorità della sorgente.

Utilizzare questa funzione quando la configurazione di progetto deve essere ereditata dalle directory antenate (comportamento monorepo/workspace annidato).

---

## 3) Wrapper per file di configurazione (`ConfigFile<T>` in `src/config.ts`)

`ConfigFile<T>` è il loader con validazione dello schema per singoli file di configurazione.

Formati supportati:

- `.yml` / `.yaml`
- `.json` / `.jsonc`

Comportamento:

- Valida i dati analizzati con AJV rispetto a uno schema TypeBox fornito.
- Memorizza nella cache il risultato del caricamento fino a `invalidate()`.
- Restituisce un risultato a tre stati tramite `tryLoad()`:
  - `ok`
  - `not-found`
  - `error` (`ConfigError` con contesto schema/parsing)

Migrazione legacy ancora supportata:

- Se il percorso di destinazione è `.yml`/`.yaml`, un file `.json` adiacente viene auto-migrato una sola volta (`migrateJsonToYml`).

---

## 4) Modello di risoluzione delle impostazioni (`src/config/settings.ts`)

Il modello delle impostazioni a runtime è stratificato:

1. Impostazioni globali: `~/.xcsh/agent/config.yml`
2. Impostazioni di progetto: scoperte tramite la capability settings (`settings.json` dai provider)
3. Override a runtime: in memoria, non persistenti
4. Valori predefiniti dello schema: da `SETTINGS_SCHEMA`

Percorso di lettura effettivo:

`defaults <- global <- project <- overrides`

Comportamento in scrittura:

- `settings.set(...)` scrive nel livello **globale** (`config.yml`) e accoda un salvataggio in background.
- Le impostazioni di progetto sono in sola lettura dalla scoperta delle capability.

## Comportamento di migrazione ancora attivo

All'avvio, se `config.yml` è assente:

1. Migrazione da `~/.xcsh/agent/settings.json` (rinominato in `.bak` in caso di successo)
2. Unione con le impostazioni legacy del DB da `agent.db`
3. Scrittura del risultato unito in `config.yml`

Migrazioni a livello di campo in `#migrateRawSettings`:

- `queueMode` -> `steeringMode`
- `ask.timeout` da millisecondi a secondi quando il vecchio valore sembra in ms (`> 1000`)
- Struttura legacy piatta `theme: "..."` -> struttura `theme.dark/theme.light`

---

## 5) Integrazione capability/discovery

La maggior parte dei flussi di caricamento della configurazione non core passa attraverso il registro delle capability (`src/capability/index.ts` + `src/discovery/index.ts`).

## Ordinamento dei provider

I provider sono ordinati per priorità numerica (la più alta prima). Esempio di priorità:

- OMP nativo (`builtin.ts`): `100`
- Claude: `80`
- Codex / agents / Claude marketplace: `70`
- Gemini: `60`

```text
Provider precedence (higher wins)

native (.xcsh)          priority 100
claude                 priority  80
codex / agents / ...   priority  70
gemini                 priority  60
```

## Semantica di deduplicazione

Le capability definiscono una `key(item)`:

- stessa chiave => il primo elemento vince (elemento con priorità più alta/caricato prima)
- nessuna chiave (`undefined`) => nessuna deduplicazione, tutti gli elementi vengono mantenuti

Chiavi rilevanti:

- skill: `name`
- tool: `name`
- hook: `${type}:${tool}:${name}`
- moduli di estensione: `name`
- estensioni: `name`
- settings: nessuna deduplicazione (tutti gli elementi vengono preservati)

---

## 6) Comportamento del provider nativo `.xcsh` (`src/discovery/builtin.ts`)

Il provider nativo (`id: native`) legge da:

- progetto: `<cwd>/.xcsh/...`
- utente: `~/.xcsh/agent/...`

### Regola di ammissione delle directory

`builtin.ts` include una root di configurazione solo se la directory esiste **ed è non vuota** (`ifNonEmptyDir`).

### Caricamento specifico per ambito

- Skill: `skills/*/SKILL.md`
- Comandi slash: `commands/*.md`
- Regole: `rules/*.{md,mdc}`
- Prompt: `prompts/*.md`
- Istruzioni: `instructions/*.md`
- Hook: `hooks/pre/*`, `hooks/post/*`
- Tool: `tools/*.json|*.md` e `tools/<name>/index.ts`
- Moduli di estensione: scoperti sotto `extensions/` (+ array di stringhe legacy `settings.json.extensions`)
- Estensioni: `extensions/<name>/gemini-extension.json`
- Capability settings: `settings.json`

### Sfumatura nella ricerca del progetto più vicino

Per `SYSTEM.md` e `AGENTS.md`, il provider nativo utilizza la ricerca della directory `.xcsh` di progetto nell'antenato più vicino (risalita) ma richiede comunque che la directory `.xcsh` sia non vuota.

---

## 7) Come i principali sottosistemi consumano la configurazione

## Sottosistema settings

- `Settings.init()` carica il `config.yml` globale + gli elementi della capability `settings.json` di progetto scoperti.
- Solo gli elementi della capability con `level === "project"` vengono uniti nel livello di progetto.

## Sottosistema skill

- `extensibility/skills.ts` carica tramite `loadCapability(skillCapability.id, { cwd })`.
- Applica toggle e filtri sulle sorgenti (`ignoredSkills`, `includeSkills`, directory personalizzate).
- Esistono ancora toggle con nomi legacy (`skills.enablePiUser`, `skills.enablePiProject`) ma controllano il provider nativo (`provider === "native"`).

## Sottosistema hook

- `discoverAndLoadHooks()` risolve i percorsi degli hook dalla capability hook + percorsi configurati esplicitamente.
- Poi carica i moduli tramite import di Bun.

## Sottosistema tool

- `discoverAndLoadCustomTools()` risolve i percorsi dei tool dalla capability tool + percorsi dei tool dei plugin + percorsi configurati esplicitamente.
- I file tool dichiarativi `.md/.json` contengono solo metadati; il caricamento degli eseguibili richiede moduli di codice.

## Sottosistema estensioni

- `discoverAndLoadExtensions()` risolve i moduli di estensione dalla capability extension-module più i percorsi espliciti.
- L'implementazione attuale mantiene intenzionalmente solo gli elementi della capability con `_source.provider === "native"` prima del caricamento.

---

## 8) Regole di precedenza su cui fare affidamento

Utilizzare questo modello mentale:

1. L'ordinamento delle directory sorgente da `config.ts` determina l'ordine dei percorsi candidati.
2. La priorità del provider delle capability determina la precedenza tra provider diversi.
3. La deduplicazione per chiave della capability determina il comportamento in caso di collisione (il primo vince per le capability con chiave).
4. La logica di unione specifica del sottosistema può modificare ulteriormente la precedenza effettiva (specialmente per le settings).

### Avvertenza specifica per le settings

Gli elementi della capability settings non vengono deduplicati; `Settings.#loadProjectSettings()` esegue un deep-merge degli elementi di progetto nell'ordine restituito. Poiché il merge applica i valori degli elementi successivi sopra quelli precedenti, il comportamento effettivo di override dipende dall'ordine di emissione del provider, non solo dalla semantica delle chiavi della capability.

---

## 9) Comportamenti legacy/di compatibilità ancora presenti

- Migrazione `ConfigFile` da JSON a YAML per i file destinati a YAML.
- Migrazione delle settings da `settings.json` e `agent.db` a `config.yml`.
- Migrazioni delle chiavi delle settings (`queueMode`, `ask.timeout`, `theme` piatto).
- Compatibilità del manifesto delle estensioni: il loader accetta sia le sezioni `package.json.xcsh` che `package.json.pi` del manifesto.
- I nomi legacy delle impostazioni `skills.enablePiUser` / `skills.enablePiProject` sono ancora gate attivi per la sorgente skill nativa.

Se questi percorsi di compatibilità vengono rimossi nel codice, aggiornare immediatamente questo documento; diversi comportamenti a runtime dipendono ancora da essi oggi.
