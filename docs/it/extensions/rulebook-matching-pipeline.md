---
title: Rulebook Matching Pipeline
description: >-
  Pipeline di matching del rulebook per la selezione e l'applicazione di set di
  istruzioni specifici per contesto alle sessioni dell'agente.
sidebar:
  order: 6
  label: Rulebook matching
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# Pipeline di Matching del Rulebook

Questo documento descrive come coding-agent scopre le regole dai formati di configurazione supportati, le normalizza in un'unica struttura `Rule`, risolve i conflitti di precedenza e suddivide il risultato in:

- **Regole Rulebook** (disponibili al modello tramite system prompt + URL `rule://`)
- **Regole TTSR** (regole di interruzione dello stream time-travel)

Riflette l'implementazione corrente, incluse le semantiche parziali e i metadati che vengono analizzati ma non applicati.

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

Conseguenza: la precedenza e la deduplicazione sono **basate esclusivamente sul nome**. Due file diversi con lo stesso `name` sono considerati la stessa regola logica.

## 2. Sorgenti di discovery e normalizzazione

`src/discovery/index.ts` registra automaticamente i provider. Per `rules`, i provider attuali sono:

- `native` (priorità `100`)
- `cursor` (priorità `50`)
- `windsurf` (priorità `50`)
- `cline` (priorità `40`)

### Provider Native (`builtin.ts`)

Carica le regole `.xcsh` da:

- progetto: `<cwd>/.xcsh/rules/*.{md,mdc}`
- utente: `~/.xcsh/agent/rules/*.{md,mdc}`

Normalizzazione:

- `name` = nome del file senza `.md`/`.mdc`
- frontmatter analizzato tramite `parseFrontmatter`
- `content` = corpo (frontmatter rimosso)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` mappati direttamente

Avvertenza importante: `globs` viene convertito come `string[] | undefined` senza filtraggio degli elementi in questo provider.

### Provider Cursor (`cursor.ts`)

Carica da:

- utente: `~/.cursor/rules/*.{mdc,md}`
- progetto: `<cwd>/.cursor/rules/*.{mdc,md}`

Normalizzazione (`transformMDCRule`):

- `description`: mantenuto solo se stringa
- `alwaysApply`: solo `true` viene preservato (`false` diventa `undefined`)
- `globs`: accetta array (solo elementi stringa) o stringa singola
- `ttsr_trigger`: solo stringa
- `name` dal nome del file senza estensione

### Provider Windsurf (`windsurf.ts`)

Carica da:

- utente: `~/.codeium/windsurf/memories/global_rules.md` (nome regola fisso `global_rules`)
- progetto: `<cwd>/.windsurf/rules/*.md`

Normalizzazione:

- `globs`: array di stringhe o stringa singola
- `alwaysApply`, `description` convertiti dal frontmatter
- `ttsr_trigger`: solo stringa
- `name` dal nome del file per le regole di progetto

### Provider Cline (`cline.ts`)

Cerca verso l'alto dalla `cwd` il `.clinerules` più vicino:

- se directory: carica i `*.md` al suo interno
- se file: carica il singolo file come regola denominata `clinerules`

Normalizzazione:

- `globs`: array di stringhe o stringa singola
- `alwaysApply`: solo se booleano
- `description`: solo stringa
- `ttsr_trigger`: solo stringa

## 3. Comportamento del parsing del frontmatter e ambiguità

Tutti i provider utilizzano `parseFrontmatter` (`utils/frontmatter.ts`) con queste semantiche:

1. Il frontmatter viene analizzato solo quando il contenuto inizia con `---` e ha una chiusura `\n---`.
2. Il corpo viene trimmato dopo l'estrazione del frontmatter.
3. Se il parsing YAML fallisce:
   - viene registrato un warning,
   - il parser ricade su un'analisi semplice per riga `key: value` (`^(\w+):\s*(.*)$`).

Conseguenze dell'ambiguità:

- Il parser di fallback non supporta array, oggetti annidati, regole di quoting o chiavi con trattino.
- I valori di fallback diventano stringhe (ad esempio `alwaysApply: true` diventa la stringa `"true"`), quindi i provider che richiedono tipi booleani/stringa potrebbero perdere i metadati.
- `ttsr_trigger` funziona nel fallback (chiave con underscore); chiavi come `thinking-level` no.
- I file senza frontmatter valido vengono comunque caricati come regole con metadati vuoti e il corpo completo del contenuto.

## 4. Precedenza dei provider e deduplicazione

`loadCapability("rules")` (`capability/index.ts`) unisce gli output dei provider e poi deduplica per `rule.name`.

### Modello di precedenza

- I provider sono ordinati per priorità decrescente.
- A parità di priorità viene mantenuto l'ordine di registrazione (`cursor` prima di `windsurf` da `discovery/index.ts`).
- La deduplicazione è first-wins: il primo nome di regola incontrato viene mantenuto; gli elementi successivi con lo stesso nome vengono contrassegnati come `_shadowed` in `all` ed esclusi da `items`.

L'ordine effettivo dei provider di regole è attualmente:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### Avvertenza sull'ordinamento intra-provider

All'interno di un provider, l'ordine degli elementi proviene dall'ordinamento dei risultati glob di `loadFilesFromDir` più l'ordine esplicito di push. Questo è sufficientemente deterministico per l'uso normale ma non è esplicitamente ordinato nel codice.

Differenze notevoli nell'ordine delle sorgenti:

- `native` aggiunge prima le directory di configurazione del progetto poi quelle utente.
- `cursor` aggiunge prima i risultati utente poi quelli del progetto.
- `windsurf` aggiunge prima le `global_rules` utente, poi le regole del progetto.
- `cline` carica solo la sorgente `.clinerules` più vicina.

## 5. Suddivisione nei bucket Rulebook, Always-Apply e TTSR

Dopo il discovery delle regole in `createAgentSession` (`sdk.ts`):

1. Tutte le regole scoperte vengono analizzate.
2. Le regole con `condition` (chiave frontmatter; `ttsr_trigger` / `ttsrTrigger` accettati come fallback) vengono registrate nel `TtsrManager`.
3. Viene costruita una lista `rulebookRules` separata con questo predicato:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. Viene costruita una lista `alwaysApplyRules`:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### Comportamento dei bucket

- **Bucket TTSR**: qualsiasi regola con `condition` (descrizione non richiesta). Ha priorità sugli altri bucket.
- **Bucket always-apply**: `alwaysApply === true`, non TTSR. Il contenuto completo viene iniettato nel system prompt. Risolvibile tramite `rule://`.
- **Bucket rulebook**: deve avere una descrizione, non deve essere TTSR, non deve essere `alwaysApply`. Elencato nel system prompt per nome+descrizione; il contenuto viene letto on demand tramite `rule://`.
- Una regola con sia `condition` che `alwaysApply` va solo nel TTSR (il TTSR ha la priorità).
- Una regola con sia `alwaysApply` che `description` va solo nell'always-apply (non nel rulebook).

## 6. Come i metadati influenzano le superfici runtime

### `description`

- Richiesto per l'inclusione nel rulebook.
- Renderizzato nel blocco `<rules>` del system prompt.
- La descrizione mancante significa che la regola non è disponibile tramite `rule://` e non è elencata nelle regole del system prompt.

### `globs`

- Trasportato nella `Rule`.
- Renderizzato come voci `<glob>...</glob>` nel blocco delle regole del system prompt.
- Esposto nello stato dell'interfaccia delle regole (lista in modalità `extensions`).
- **Non applicato per il matching automatico in questa pipeline.** Non esiste un matcher glob runtime che seleziona le regole in base al file corrente/target dello strumento.

### `alwaysApply`

- Analizzato e preservato dai provider.
- Utilizzato nella visualizzazione dell'interfaccia (etichetta trigger `"always"` nel gestore dello stato delle estensioni).
- Utilizzato come condizione di esclusione da `rulebookRules`.
- **Il contenuto completo della regola viene auto-iniettato nel system prompt** (prima della sezione delle regole del rulebook).
- La regola è anche indirizzabile tramite `rule://<name>` per la rilettura.

### `ttsr_trigger`

- Mappato a `rule.ttsrTrigger`.
- Se presente, la regola viene instradata al manager TTSR, non al rulebook.

## 7. Percorso di inclusione nel system prompt

`buildSystemPromptInternal` riceve sia `rules` (rulebook) che `alwaysApplyRules`.

Le regole always-apply vengono renderizzate per prime, iniettando il loro contenuto grezzo direttamente nel prompt.

Le regole del rulebook vengono renderizzate in una sezione `# Rules` con:

- `Read rule://<name> when working in matching domain`
- Il `name`, la `description` e l'elenco opzionale di `<glob>` di ciascuna regola

Questo è consultivo/contestuale: il testo del prompt chiede al modello di leggere le regole applicabili, ma il codice non applica l'applicabilità dei glob.

## 8. Comportamento dell'URL interno `rule://`

`RuleProtocolHandler` è registrato con:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

Implicazioni:

- `rule://<name>` viene risolto rispetto sia a **rulebookRules** che ad **alwaysApplyRules**.
- Le regole solo-TTSR e le regole senza descrizione e senza `alwaysApply` non sono indirizzabili tramite `rule://`.
- La risoluzione è una corrispondenza esatta del nome.
- I nomi sconosciuti restituiscono un errore che elenca i nomi delle regole disponibili.
- Il contenuto restituito è il `rule.content` grezzo (frontmatter rimosso), content type `text/markdown`.

## 9. Semantiche note parziali / non applicate

1. Le descrizioni dei provider menzionano file legacy (`.cursorrules`, `.windsurfrules`), ma i percorsi di codice del loader attuale non leggono effettivamente quei file.
2. I metadati `globs` sono esposti al prompt/UI ma non applicati dalla logica di selezione delle regole.
3. La selezione delle regole per `rule://` include le regole rulebook e always-apply, ma non le regole solo-TTSR.
4. I warning di discovery (`loadCapability("rules").warnings`) vengono prodotti ma `createAgentSession` attualmente non li espone/registra in questo percorso.
