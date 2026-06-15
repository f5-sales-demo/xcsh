---
title: Estensioni del manifest Gemini
description: >-
  Formato delle estensioni del manifest Gemini per la compatibilità di skill e
  agenti multipiattaforma.
sidebar:
  order: 7
  label: Manifest Gemini
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Estensioni del manifest Gemini (`gemini-extension.json`)

Questo documento illustra come il coding-agent scopre e analizza le estensioni del manifest in stile Gemini (`gemini-extension.json`) nella capability `extensions`.

**Non** tratta il caricamento dei moduli di estensione TypeScript/JavaScript (`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`), documentato in `extension-loading.md`.

## File di implementazione

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## Cosa viene scoperto

Il provider Gemini (`id: gemini`, priorità `60`) registra un loader `extensions` che esegue la scansione di due radici fisse:

- Utente: `~/.gemini/extensions`
- Progetto: `<cwd>/.gemini/extensions`

La risoluzione dei percorsi avviene direttamente da `ctx.home` e `ctx.cwd` tramite `getUserPath()` / `getProjectPath()`.

Regola importante sull'ambito: la ricerca nel progetto è **limitata alla cwd**. Non risale le directory padre.

---

## Regole di scansione delle directory

Per ciascuna radice (`~/.gemini/extensions` e `<cwd>/.gemini/extensions`), il processo di discovery esegue:

1. `readDirEntries(root)`
2. mantiene solo le directory figlie dirette (`entry.isDirectory()`)
3. per ogni figlio `<name>`, tenta di leggere esattamente:
   - `<root>/<name>/gemini-extension.json`

Non è prevista alcuna scansione ricorsiva oltre un livello di directory.

### Directory nascoste

Il processo di discovery del manifest Gemini **non** filtra i nomi di directory con prefisso punto. Se esiste una directory figlia nascosta contenente `gemini-extension.json`, viene presa in considerazione.

### File mancanti o non leggibili

Se `gemini-extension.json` è assente o non leggibile, quella directory viene ignorata silenziosamente (nessun avviso).

---

## Struttura del manifest (come implementata)

Il tipo di capability definisce questa struttura del manifest:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

Il comportamento durante il discovery è volutamente permissivo:

- È richiesto il successo dell'analisi JSON.
- Non è prevista la validazione dello schema a runtime per i tipi/contenuti dei campi, al di là della sintassi JSON.
- L'oggetto analizzato viene memorizzato come `manifest` nell'elemento di capability.

### Normalizzazione del nome

`Extension.name` viene impostato su:

1. `manifest.name` se non è `null`/`undefined`
2. altrimenti il nome della directory dell'estensione

Qui non viene applicata alcuna verifica del tipo stringa.

---

## Materializzazione in elementi di capability

Un manifest analizzato correttamente crea un elemento di capability `Extension`:

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // allegato dal registro delle capability
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

Note:

- `_source.path` viene normalizzato come percorso assoluto da `createSourceMeta()`.
- La validazione delle capability a livello di registro per `extensions` verifica solo la presenza di `name` e `path`.
- I contenuti interni del manifest (`mcpServers`, `tools`, `context`) non vengono validati durante il discovery.

---

## Gestione degli errori e semantica degli avvisi

### Con avviso

- JSON non valido in un file manifest:
  - formato dell'avviso: `Invalid JSON in <manifestPath>`

### Senza avviso (ignorato silenziosamente)

- directory `extensions` assente
- la directory figlia non ha `gemini-extension.json`
- file manifest non leggibile
- il JSON del manifest è sintatticamente valido ma semanticamente anomalo/incompleto

Ciò significa che la validità parziale è accettata: solo il fallimento sintattico del JSON genera un avviso.

---

## Precedenza e deduplicazione con altre sorgenti

La capability `extensions` viene aggregata tra i provider dal registro delle capability.

Provider attuali per questa capability:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) priorità `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) priorità `60`

La chiave di deduplicazione è `ext.name` (`extensionCapability.key = ext => ext.name`).

### Precedenza tra provider

Il provider con priorità più alta vince in caso di nomi di estensione duplicati.

- Se sia `native` che `gemini` emettono il nome di estensione `foo`, viene mantenuto l'elemento nativo.
- Il duplicato a priorità inferiore viene conservato solo in `result.all` con `_shadowed = true`.

### Effetti dell'ordine all'interno del provider

Poiché la deduplicazione segue il criterio "vince il primo trovato", l'ordine degli elementi locali al provider è rilevante.

- Il loader Gemini aggiunge prima gli elementi **utente**, poi quelli di **progetto**.
- Pertanto, i nomi duplicati tra `~/.gemini/extensions` e `<cwd>/.gemini/extensions` mantengono l'elemento utente e oscurano quello di progetto.

Al contrario, il provider nativo costruisce l'ordine delle directory di configurazione in modo diverso (`project` prima di `user` in `getConfigDirs()`), quindi la direzione di oscuramento intra-provider nativo è opposta.

---

## Riepilogo del comportamento utente vs progetto

Per i manifest Gemini in particolare:

- Entrambe le radici utente e progetto vengono scansionate a ogni caricamento.
- La radice del progetto è fissa su `<cwd>/.gemini/extensions` (nessuna risalita agli antenati).
- I nomi duplicati all'interno della sorgente Gemini vengono risolti dando precedenza all'utente.
- I nomi duplicati rispetto a provider con priorità più alta (in particolare nativo) perdono per priorità.

---

## Confine: metadati di discovery vs caricamento delle estensioni a runtime

Il discovery di `gemini-extension.json` attualmente alimenta i metadati di capability (elementi `Extension`). **Non** carica direttamente moduli di estensione TS/JS eseguibili.

Il caricamento dei moduli a runtime (`discoverAndLoadExtensions()` / `loadExtensions()`) utilizza `extension-modules` e percorsi espliciti, e attualmente filtra i moduli auto-scoperti limitandosi al provider `native`.

Implicazione pratica:

- Le estensioni del manifest Gemini sono individuabili come record di capability.
- Non vengono, di per sé, eseguite come moduli di estensione a runtime dalla pipeline del loader delle estensioni.

Questo confine è intenzionale nell'implementazione attuale e spiega perché il discovery del manifest e il caricamento dei moduli eseguibili possono divergere.
