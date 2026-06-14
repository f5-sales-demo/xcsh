---
title: Pipeline di corrispondenza del rulebook
description: >-
  Pipeline di corrispondenza del rulebook per la selezione e l'applicazione di
  set di istruzioni specifici per contesto alle sessioni dell'agente.
sidebar:
  order: 6
  label: Corrispondenza del rulebook
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# Pipeline di corrispondenza del rulebook

Questo documento descrive come il coding-agent scopre le regole dai formati di configurazione supportati, le normalizza in un'unica struttura `Rule`, risolve i conflitti di precedenza e divide il risultato in:

- **Regole del rulebook** (disponibili per il modello tramite prompt di sistema + URL `rule://`)
- **Regole TTSR** (regole di interruzione dello stream time-travel)

Riflette l'implementazione corrente, incluse le semantiche parziali e i metadati analizzati ma non applicati.

## File di implementazione

- [`../src/capability/rule.ts`](../../packages/coding-agent/src/capability/rule.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/discovery/index.ts`](../../packages/coding-agent/src/discovery/index.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/cursor.ts`](../../packages/coding-agent/src/discovery/cursor.ts)
- [`../src/discovery/windsurf.ts`](../../packages/coding-agent/src/discovery/windsurf.ts)
- [`../src/discovery/cline.ts`](../../packages/coding-agent/src/discovery/cline.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/system-prompt.ts`](../../packages/coding-agent/src/system-prompt.ts)
- [`../src/internal-urls/rule-protocol.ts`](../../packages/coding-agent/src/internal-urls/rule-protocol.ts)
- [`../src/utils/frontmatter.ts`](../../packages/coding-agent/src/utils/frontmatter.ts)

## 1. Struttura canonica delle regole

Tutti i provider normalizzano i file sorgente in `Rule`:

```ts
interface Rule {
  name: string;
  path: string;
  content: string;
  globs?: string[];
  alwaysApply?: boolean;
  description?: string;
  ttsrTrigger?: string;
  _source: SourceMeta;
}
```

L'identità della capacità è `rule.name` (`ruleCapability.key = rule => rule.name`).

Conseguenza: la precedenza e la deduplicazione si basano **esclusivamente sul nome**. Due file diversi con lo stesso `name` sono considerati la stessa regola logica.

## 2. Sorgenti di scoperta e normalizzazione

`src/discovery/index.ts` registra automaticamente i provider. Per `rules`, i provider attuali sono:

- `native` (priorità `100`)
- `cursor` (priorità `50`)
- `windsurf` (priorità `50`)
- `cline` (priorità `40`)

### Provider nativo (`builtin.ts`)

Carica le regole `.xcsh` da:

- progetto: `<cwd>/.xcsh/rules/*.{md,mdc}`
- utente: `~/.xcsh/agent/rules/*.{md,mdc}`

Normalizzazione:

- `name` = nome del file senza `.md`/`.mdc`
- frontmatter analizzato tramite `parseFrontmatter`
- `content` = corpo (frontmatter rimosso)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` mappati direttamente

Avvertenza importante: `globs` viene castato come `string[] | undefined` senza filtraggio degli elementi in questo provider.

### Provider Cursor (`cursor.ts`)

Carica da:

- utente: `~/.cursor/rules/*.{mdc,md}`
- progetto: `<cwd>/.cursor/rules/*.{mdc,md}`

Normalizzazione (`transformMDCRule`):

- `description`: mantenuta solo se stringa
- `alwaysApply`: viene conservato solo `true` (`false` diventa `undefined`)
- `globs`: accetta array (solo elementi stringa) o singola stringa
- `ttsr_trigger`: solo stringa
- `name` dal nome del file senza estensione

### Provider Windsurf (`windsurf.ts`)

Carica da:

- utente: `~/.codeium/windsurf/memories/global_rules.md` (nome regola fisso `global_rules`)
- progetto: `<cwd>/.windsurf/rules/*.md`

Normalizzazione:

- `globs`: array di stringhe o singola stringa
- `alwaysApply`, `description` castati dal frontmatter
- `ttsr_trigger`: solo stringa
- `name` dal nome del file per le regole di progetto

### Provider Cline (`cline.ts`)

Cerca verso l'alto a partire da `cwd` il `.clinerules` più vicino:

- se è una directory: carica i file `*.md` al suo interno
- se è un file: carica il singolo file come regola denominata `clinerules`

Normalizzazione:

- `globs`: array di stringhe o singola stringa
- `alwaysApply`: solo se booleano
- `description`: solo stringa
- `ttsr_trigger`: solo stringa

## 3. Comportamento del parsing del frontmatter e ambiguità

Tutti i provider utilizzano `parseFrontmatter` (`utils/frontmatter.ts`) con le seguenti semantiche:

1. Il frontmatter viene analizzato solo quando il contenuto inizia con `---` e presenta un `\n---` di chiusura.
2. Il corpo viene rimosso degli spazi bianchi dopo l'estrazione del frontmatter.
3. Se il parsing YAML fallisce:
   - viene registrato un avviso,
   - il parser torna al parsing semplice `key: value` riga per riga (`^(\w+):\s*(.*)$`).

Conseguenze dell'ambiguità:

- Il parser di fallback non supporta array, oggetti annidati, regole di quotatura o chiavi con trattini.
- I valori di fallback diventano stringhe (ad esempio `alwaysApply: true` diventa la stringa `"true"`), quindi i provider che richiedono tipi booleano/stringa potrebbero eliminare i metadati.
- `ttsr_trigger` funziona nel fallback (chiave con underscore); chiavi come `thinking-level` non funzionerebbero.
- I file senza frontmatter valido vengono comunque caricati come regole con metadati vuoti e corpo del contenuto completo.

## 4. Precedenza dei provider e deduplicazione

`loadCapability("rules")` (`capability/index.ts`) unisce gli output dei provider e li deduplica per `rule.name`.

### Modello di precedenza

- I provider sono ordinati per priorità decrescente.
- A parità di priorità, viene mantenuto l'ordine di registrazione (`cursor` prima di `windsurf` da `discovery/index.ts`).
- La deduplicazione segue il criterio "primo vince": il primo nome di regola incontrato viene mantenuto; gli elementi successivi con lo stesso nome vengono contrassegnati come `_shadowed` in `all` ed esclusi da `items`.

L'ordine effettivo dei provider di regole è attualmente:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### Avvertenza sull'ordinamento intra-provider

All'interno di un provider, l'ordine degli elementi proviene dall'ordinamento dei risultati glob di `loadFilesFromDir` più l'ordine esplicito di inserimento. Questo è sufficientemente deterministico per l'uso normale, ma non è ordinato esplicitamente nel codice.

Differenze notevoli nell'ordine delle sorgenti:

- `native` aggiunge prima le directory di configurazione del progetto, poi quelle dell'utente.
- `cursor` aggiunge prima i risultati dell'utente, poi quelli del progetto.
- `windsurf` aggiunge prima `global_rules` dell'utente, poi le regole del progetto.
- `cline` carica solo la sorgente `.clinerules` più vicina.

## 5. Suddivisione nei bucket Rulebook, Always-Apply e TTSR

Dopo la scoperta delle regole in `createAgentSession` (`sdk.ts`):

1. Tutte le regole scoperte vengono analizzate.
2. Le regole con `condition` (chiave frontmatter; `ttsr_trigger` / `ttsrTrigger` accettati come fallback) vengono registrate nel `TtsrManager`.
3. Una lista separata `rulebookRules` viene costruita con questo predicato:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. Una lista `alwaysApplyRules` viene costruita:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### Comportamento dei bucket

- **Bucket TTSR**: qualsiasi regola con `condition` (description non richiesta). Ha priorità sugli altri bucket.
- **Bucket always-apply**: `alwaysApply === true`, non TTSR. Il contenuto completo viene iniettato nel prompt di sistema. Risolvibile tramite `rule://`.
- **Bucket rulebook**: deve avere una description, non deve essere TTSR, non deve essere `alwaysApply`. Elencato nel prompt di sistema per nome+descrizione; il contenuto viene letto su richiesta tramite `rule://`.
- Una regola con sia `condition` che `alwaysApply` va solo nel TTSR (il TTSR ha la priorità).
- Una regola con sia `alwaysApply` che `description` va solo nell'always-apply (non nel rulebook).

## 6. Come i metadati influenzano le superfici di runtime

### `description`

- Obbligatoria per l'inclusione nel rulebook.
- Visualizzata nel blocco `<rules>` del prompt di sistema.
- L'assenza della description significa che la regola non è disponibile tramite `rule://` e non è elencata nelle regole del prompt di sistema.

### `globs`

- Trasportata attraverso `Rule`.
- Visualizzata come voci `<glob>...</glob>` nel blocco delle regole del prompt di sistema.
- Esposta nello stato dell'interfaccia delle regole (lista modalità `extensions`).
- **Non applicata per la corrispondenza automatica in questa pipeline.** Non esiste un matcher glob a runtime che selezioni le regole in base al file corrente o al target dello strumento.

### `alwaysApply`

- Analizzata e conservata dai provider.
- Utilizzata nella visualizzazione dell'interfaccia (etichetta trigger `"always"` nel gestore dello stato delle estensioni).
- Utilizzata come condizione di esclusione da `rulebookRules`.
- **Il contenuto completo della regola viene auto-iniettato nel prompt di sistema** (prima della sezione delle regole del rulebook).
- La regola è anche indirizzabile tramite `rule://<name>` per la rilettura.

### `ttsr_trigger`

- Mappato a `rule.ttsrTrigger`.
- Se presente, la regola viene instradata al gestore TTSR, non al rulebook.

## 7. Percorso di inclusione nel prompt di sistema

`buildSystemPromptInternal` riceve sia `rules` (rulebook) che `alwaysApplyRules`.

Le regole always-apply vengono visualizzate per prime, iniettando il loro contenuto grezzo direttamente nel prompt.

Le regole del rulebook vengono visualizzate in una sezione `# Rules` con:

- `Read rule://<name> when working in matching domain`
- Il `name`, la `description` e l'elenco opzionale `<glob>` di ciascuna regola

Questo è di natura consultiva/contestuale: il testo del prompt chiede al modello di leggere le regole applicabili, ma il codice non applica l'applicabilità del glob.

## 8. Comportamento dell'URL interno `rule://`

`RuleProtocolHandler` è registrato con:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

Implicazioni:

- `rule://<name>` si risolve sia contro **rulebookRules** che contro **alwaysApplyRules**.
- Le regole solo-TTSR e le regole senza description e senza `alwaysApply` non sono indirizzabili tramite `rule://`.
- La risoluzione avviene tramite corrispondenza esatta del nome.
- I nomi sconosciuti restituiscono un errore che elenca i nomi delle regole disponibili.
- Il contenuto restituito è il `rule.content` grezzo (frontmatter rimosso), tipo di contenuto `text/markdown`.

## 9. Semantiche parziali / non applicate note

1. Le descrizioni dei provider menzionano file legacy (`.cursorrules`, `.windsurfrules`), ma i percorsi del codice del loader attuale non leggono effettivamente quei file.
2. I metadati `globs` vengono esposti al prompt/interfaccia ma non sono applicati dalla logica di selezione delle regole.
3. La selezione delle regole per `rule://` include le regole del rulebook e quelle always-apply, ma non le regole solo-TTSR.
4. Gli avvisi di scoperta (`loadCapability("rules").warnings`) vengono prodotti, ma `createAgentSession` non li espone né li registra attualmente in questo percorso.
