---
title: Pipeline di corrispondenza del Rulebook
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

# Pipeline di corrispondenza del Rulebook

Questo documento descrive come il coding-agent rileva le regole dai formati di configurazione supportati, le normalizza in un'unica struttura `Rule`, risolve i conflitti di precedenza e suddivide il risultato in:

- **Regole del rulebook** (disponibili per il modello tramite prompt di sistema + URL `rule://`)
- **Regole TTSR** (regole di interruzione del flusso time-travel)

Riflette l'implementazione corrente, incluse semantiche parziali e metadati analizzati ma non applicati.

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

## 1. Struttura canonica della regola

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

L'identità della capability è `rule.name` (`ruleCapability.key = rule => rule.name`).

Conseguenza: la precedenza e la deduplicazione si basano **esclusivamente sul nome**. Due file diversi con lo stesso `name` sono considerati la stessa regola logica.

## 2. Sorgenti di rilevamento e normalizzazione

`src/discovery/index.ts` registra automaticamente i provider. Per `rules`, i provider correnti sono:

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

Nota importante: `globs` viene convertito come `string[] | undefined` senza filtraggio degli elementi in questo provider.

### Provider Cursor (`cursor.ts`)

Carica da:

- utente: `~/.cursor/rules/*.{mdc,md}`
- progetto: `<cwd>/.cursor/rules/*.{mdc,md}`

Normalizzazione (`transformMDCRule`):

- `description`: mantenuto solo se stringa
- `alwaysApply`: viene preservato solo `true` (`false` diventa `undefined`)
- `globs`: accetta array (solo elementi stringa) o singola stringa
- `ttsr_trigger`: solo stringa
- `name` dal nome del file senza estensione

### Provider Windsurf (`windsurf.ts`)

Carica da:

- utente: `~/.codeium/windsurf/memories/global_rules.md` (nome regola fisso `global_rules`)
- progetto: `<cwd>/.windsurf/rules/*.md`

Normalizzazione:

- `globs`: array di stringhe o singola stringa
- `alwaysApply`, `description` convertiti dal frontmatter
- `ttsr_trigger`: solo stringa
- `name` dal nome del file per le regole di progetto

### Provider Cline (`cline.ts`)

Ricerca verso l'alto a partire da `cwd` per il `.clinerules` più vicino:

- se directory: carica i file `*.md` al suo interno
- se file: carica il singolo file come regola denominata `clinerules`

Normalizzazione:

- `globs`: array di stringhe o singola stringa
- `alwaysApply`: solo se booleano
- `description`: solo stringa
- `ttsr_trigger`: solo stringa

## 3. Comportamento di analisi del frontmatter e ambiguità

Tutti i provider utilizzano `parseFrontmatter` (`utils/frontmatter.ts`) con le seguenti semantiche:

1. Il frontmatter viene analizzato solo quando il contenuto inizia con `---` e ha una chiusura `\n---`.
2. Il corpo viene rimosso degli spazi dopo l'estrazione del frontmatter.
3. Se l'analisi YAML fallisce:
   - viene registrato un avviso,
   - il parser ricorre all'analisi semplice per riga `key: value` (`^(\w+):\s*(.*)$`).

Conseguenze dell'ambiguità:

- Il parser di fallback non supporta array, oggetti annidati, regole di quotatura o chiavi con trattino.
- I valori di fallback diventano stringhe (ad esempio `alwaysApply: true` diventa la stringa `"true"`), pertanto i provider che richiedono tipi booleani/stringa potrebbero eliminare i metadati.
- `ttsr_trigger` funziona nel fallback (chiave con underscore); chiavi come `thinking-level` non funzionerebbero.
- I file senza frontmatter valido vengono comunque caricati come regole con metadati vuoti e corpo del contenuto completo.

## 4. Precedenza dei provider e deduplicazione

`loadCapability("rules")` (`capability/index.ts`) unisce gli output dei provider e poi deduplicata per `rule.name`.

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

All'interno di un provider, l'ordine degli elementi deriva dall'ordinamento dei risultati glob di `loadFilesFromDir` più l'ordine esplicito di inserimento. Questo è sufficientemente deterministico per l'uso normale, ma non è ordinato esplicitamente nel codice.

Differenze notevoli nell'ordine delle sorgenti:

- `native` aggiunge prima la directory di configurazione del progetto, poi quella dell'utente.
- `cursor` aggiunge prima i risultati dell'utente, poi quelli del progetto.
- `windsurf` aggiunge prima `global_rules` dell'utente, poi le regole del progetto.
- `cline` carica solo la sorgente `.clinerules` più vicina.

## 5. Suddivisione nei bucket Rulebook, Always-Apply e TTSR

Dopo il rilevamento delle regole in `createAgentSession` (`sdk.ts`):

1. Tutte le regole rilevate vengono analizzate.
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
- **Bucket always-apply**: `alwaysApply === true`, non TTSR. Il contenuto completo viene iniettato nel prompt di sistema. Accessibile tramite `rule://`.
- **Bucket rulebook**: deve avere description, non deve essere TTSR, non deve essere `alwaysApply`. Elencato nel prompt di sistema per nome + description; il contenuto viene letto su richiesta tramite `rule://`.
- Una regola con sia `condition` che `alwaysApply` va solo al TTSR (il TTSR ha la priorità).
- Una regola con sia `alwaysApply` che `description` va solo al bucket always-apply (non al rulebook).

## 6. Come i metadati influenzano le superfici di runtime

### `description`

- Obbligatoria per l'inclusione nel rulebook.
- Visualizzata nel blocco `<rules>` del prompt di sistema.
- L'assenza di description significa che la regola non è disponibile tramite `rule://` e non è elencata nelle regole del prompt di sistema.

### `globs`

- Propagata attraverso `Rule`.
- Visualizzata come voci `<glob>...</glob>` nel blocco delle regole del prompt di sistema.
- Esposta nello stato UI delle regole (lista modalità `extensions`).
- **Non applicata per la corrispondenza automatica in questa pipeline.** Non esiste un matcher glob in fase di runtime che selezioni le regole in base al file corrente o al target dello strumento.

### `alwaysApply`

- Analizzato e preservato dai provider.
- Utilizzato nella visualizzazione UI (etichetta trigger `"always"` nel gestore dello stato extensions).
- Utilizzato come condizione di esclusione da `rulebookRules`.
- **Il contenuto completo della regola viene iniettato automaticamente nel prompt di sistema** (prima della sezione delle regole del rulebook).
- La regola è anche indirizzabile tramite `rule://<name>` per la rilettura.

### `ttsr_trigger`

- Mappato a `rule.ttsrTrigger`.
- Se presente, la regola viene instradata al gestore TTSR, non al rulebook.

## 7. Percorso di inclusione nel prompt di sistema

`buildSystemPromptInternal` riceve sia `rules` (rulebook) che `alwaysApplyRules`.

Le regole always-apply vengono visualizzate per prime, iniettando il loro contenuto grezzo direttamente nel prompt.

Le regole del rulebook vengono visualizzate in una sezione `# Rules` con:

- `Read rule://<name> when working in matching domain`
- Per ogni regola: `name`, `description` e lista `<glob>` opzionale

Questo è di natura consultiva/contestuale: il testo del prompt chiede al modello di leggere le regole applicabili, ma il codice non applica l'applicabilità dei glob.

## 8. Comportamento dell'URL interno `rule://`

`RuleProtocolHandler` è registrato con:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

Implicazioni:

- `rule://<name>` viene risolto rispetto a **rulebookRules** e **alwaysApplyRules**.
- Le regole solo TTSR e le regole senza description e senza `alwaysApply` non sono indirizzabili tramite `rule://`.
- La risoluzione avviene per corrispondenza esatta del nome.
- I nomi sconosciuti restituiscono un errore con l'elenco dei nomi di regole disponibili.
- Il contenuto restituito è il `rule.content` grezzo (frontmatter rimosso), tipo di contenuto `text/markdown`.

## 9. Semantiche parziali / non applicate note

1. Le descrizioni dei provider menzionano file legacy (`.cursorrules`, `.windsurfrules`), ma i percorsi di caricamento del codice corrente non leggono effettivamente quei file.
2. I metadati `globs` vengono esposti al prompt/UI ma non sono applicati dalla logica di selezione delle regole.
3. La selezione delle regole per `rule://` include le regole del rulebook e quelle always-apply, ma non le regole solo TTSR.
4. Gli avvisi di rilevamento (`loadCapability("rules").warnings`) vengono prodotti, ma `createAgentSession` non li espone/registra attualmente in questo percorso.
