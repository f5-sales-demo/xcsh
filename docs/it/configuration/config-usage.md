---
title: Scoperta e risoluzione della configurazione
description: >-
  Come xcsh scopre, risolve e stratifica la configurazione dalle radici di
  progetto, utente e aziendali.
sidebar:
  order: 1
  label: Configurazione
i18n:
  sourceHash: e38bd9792499
  translator: machine
---

# Scoperta e risoluzione della configurazione

Questo documento descrive come il coding-agent risolve la configurazione oggi: quali radici vengono analizzate, come funziona la precedenza e come la configurazione risolta viene consumata da impostazioni, skill, hook, strumenti ed estensioni.

## Ambito

Implementazione principale:

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

## 1) Radici di configurazione e ordine delle sorgenti

## Radici canoniche

`src/config.ts` definisce una lista di priorità delle sorgenti fissa:

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

## 2) Helper di scoperta principali (`src/config.ts`)

## `getConfigDirs(subpath, options)`

Restituisce voci ordinate:

- Prima le voci a livello utente (per priorità della sorgente)
- Poi le voci a livello progetto (per la stessa priorità della sorgente)

Opzioni:

- `user` (predefinito `true`)
- `project` (predefinito `true`)
- `cwd` (predefinito `getProjectDir()`)
- `existingOnly` (predefinito `false`)

Questa API è utilizzata per le ricerche di configurazione basate su directory (comandi, hook, strumenti, agenti, ecc.).

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

Cerca il primo file esistente attraverso le basi ordinate, restituisce la prima corrispondenza (solo percorso o percorso+metadati).

## `findAllNearestProjectConfigDirs(subpath, cwd)`

Risale le directory padre verso l'alto e restituisce la **directory esistente più vicina per ogni base sorgente** (`.xcsh`, `.claude`, `.codex`, `.gemini`), poi ordina i risultati per priorità della sorgente.

Utilizzare questa funzione quando la configurazione del progetto deve essere ereditata dalle directory antenate (comportamento monorepo/workspace annidato).

---

## 3) Wrapper per file di configurazione (`ConfigFile<T>` in `src/config.ts`)

`ConfigFile<T>` è il loader con validazione dello schema per singoli file di configurazione.

Formati supportati:

- `.yml` / `.yaml`
- `.json` / `.jsonc`

Comportamento:

- Valida i dati analizzati con AJV rispetto a uno schema TypeBox fornito.
- Mette in cache il risultato del caricamento fino a `invalidate()`.
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

Comportamento di scrittura:

- `settings.set(...)` scrive nel livello **globale** (`config.yml`) e accoda il salvataggio in background.
- Le impostazioni di progetto sono in sola lettura dalla scoperta delle capability.

## Comportamento di migrazione ancora attivo

All'avvio, se `config.yml` è assente:

1. Migrazione da `~/.xcsh/agent/settings.json` (rinominato in `.bak` in caso di successo)
2. Merge con le impostazioni legacy del DB da `agent.db`
3. Scrittura del risultato unificato in `config.yml`

Migrazioni a livello di campo in `#migrateRawSettings`:

- `queueMode` -> `steeringMode`
- `ask.timeout` millisecondi -> secondi quando il vecchio valore sembra essere in ms (`> 1000`)
- Struttura legacy piatta `theme: "..."` -> struttura `theme.dark/theme.light`

---

## 5) Integrazione capability/discovery

La maggior parte dei flussi di caricamento della configurazione non-core passa attraverso il registro delle capability (`src/capability/index.ts` + `src/discovery/index.ts`).

## Ordinamento dei provider

I provider sono ordinati per priorità numerica (il più alto prima). Esempi di priorità:

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
- strumenti: `name`
- hook: `${type}:${tool}:${name}`
- moduli di estensione: `name`
- estensioni: `name`
- impostazioni: nessuna deduplicazione (tutti gli elementi preservati)

---

## 6) Comportamento del provider nativo `.xcsh` (`src/discovery/builtin.ts`)

Il provider nativo (`id: native`) legge da:

- progetto: `<cwd>/.xcsh/...`
- utente: `~/.xcsh/agent/...`

### Regola di ammissione delle directory

`builtin.ts` include una radice di configurazione solo se la directory esiste **ed è non vuota** (`ifNonEmptyDir`).

### Caricamento specifico per ambito

- Skill: `skills/*/SKILL.md`
- Comandi slash: `commands/*.md`
- Regole: `rules/*.{md,mdc}`
- Prompt: `prompts/*.md`
- Istruzioni: `instructions/*.md`
- Hook: `hooks/pre/*`, `hooks/post/*`
- Strumenti: `tools/*.json|*.md` e `tools/<name>/index.ts`
- Moduli di estensione: scoperti sotto `extensions/` (+ array di stringhe legacy `settings.json.extensions`)
- Estensioni: `extensions/<name>/gemini-extension.json`
- Capability impostazioni: `settings.json`

### Sfumatura della ricerca nearest-project

Per `SYSTEM.md` e `XCSH.md`, il provider nativo utilizza la ricerca della directory `.xcsh` di progetto nell'antenato più vicino (risalita) ma richiede comunque che la directory `.xcsh` sia non vuota.

---

## 7) Come i principali sottosistemi consumano la configurazione

## Sottosistema impostazioni

- `Settings.init()` carica il `config.yml` globale + gli elementi della capability `settings.json` del progetto scoperti.
- Solo gli elementi della capability con `level === "project"` vengono uniti nel livello progetto.

## Sottosistema skill

- `extensibility/skills.ts` carica tramite `loadCapability(skillCapability.id, { cwd })`.
- Applica toggle e filtri sulle sorgenti (`ignoredSkills`, `includeSkills`, directory personalizzate).
- I toggle con nomi legacy esistono ancora (`skills.enablePiUser`, `skills.enablePiProject`) ma controllano il provider nativo (`provider === "native"`).

## Sottosistema hook

- `discoverAndLoadHooks()` risolve i percorsi degli hook dalla capability hook + percorsi configurati esplicitamente.
- Poi carica i moduli tramite import Bun.

## Sottosistema strumenti

- `discoverAndLoadCustomTools()` risolve i percorsi degli strumenti dalla capability strumenti + percorsi degli strumenti dei plugin + percorsi configurati esplicitamente.
- I file strumento dichiarativi `.md/.json` contengono solo metadati; il caricamento eseguibile si aspetta moduli di codice.

## Sottosistema estensioni

- `discoverAndLoadExtensions()` risolve i moduli di estensione dalla capability extension-module più percorsi espliciti.
- L'implementazione attuale mantiene intenzionalmente solo gli elementi della capability con `_source.provider === "native"` prima del caricamento.

---

## 8) Regole di precedenza su cui fare affidamento

Utilizzare questo modello mentale:

1. L'ordinamento delle directory sorgente da `config.ts` determina l'ordine dei percorsi candidati.
2. La priorità del provider di capability determina la precedenza tra provider.
3. La deduplicazione tramite chiave della capability determina il comportamento in caso di collisione (il primo vince per le capability con chiave).
4. La logica di merge specifica del sottosistema può modificare ulteriormente la precedenza effettiva (specialmente per le impostazioni).

### Avvertenza specifica per le impostazioni

Gli elementi della capability impostazioni non sono deduplicati; `Settings.#loadProjectSettings()` esegue un deep-merge degli elementi di progetto nell'ordine restituito. Poiché il merge applica i valori degli elementi successivi sopra quelli precedenti, il comportamento effettivo di override dipende dall'ordine di emissione del provider, non solo dalla semantica delle chiavi della capability.

---

## 9) Comportamenti legacy/di compatibilità ancora presenti

- Migrazione `ConfigFile` da JSON a YAML per i file destinati a YAML.
- Migrazione delle impostazioni da `settings.json` e `agent.db` a `config.yml`.
- Migrazioni delle chiavi delle impostazioni (`queueMode`, `ask.timeout`, `theme` piatto).
- Compatibilità del manifesto delle estensioni: il loader accetta sia le sezioni del manifesto `package.json.xcsh` che `package.json.pi`.
- I nomi di impostazioni legacy `skills.enablePiUser` / `skills.enablePiProject` sono ancora gate attivi per la sorgente skill nativa.

Se questi percorsi di compatibilità vengono rimossi nel codice, aggiornare immediatamente questo documento; diversi comportamenti a runtime dipendono ancora da essi oggi.
