---
title: Estensioni Manifest Gemini
description: >-
  Formato delle estensioni manifest Gemini per la compatibilità cross-platform
  di skill e agenti.
sidebar:
  order: 7
  label: Manifest Gemini
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Estensioni Manifest Gemini (`gemini-extension.json`)

Questo documento illustra come il coding-agent scopre e analizza le estensioni manifest in stile Gemini (`gemini-extension.json`) nella capability `extensions`.

**Non** copre il caricamento dei moduli di estensione TypeScript/JavaScript (`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`), documentato in `extension-loading.md`.

## File di implementazione

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## Cosa viene scoperto

Il provider Gemini (`id: gemini`, priorità `60`) registra un loader `extensions` che scansiona due radici fisse:

- Utente: `~/.gemini/extensions`
- Progetto: `<cwd>/.gemini/extensions`

La risoluzione dei percorsi avviene direttamente da `ctx.home` e `ctx.cwd` tramite `getUserPath()` / `getProjectPath()`.

Regola di scope importante: la ricerca nel progetto è **solo cwd**. Non risale le directory padre.

---

## Regole di scansione delle directory

Per ogni radice (`~/.gemini/extensions` e `<cwd>/.gemini/extensions`), la discovery esegue:

1. `readDirEntries(root)`
2. mantiene solo le directory figlie dirette (`entry.isDirectory()`)
3. per ogni figlio `<name>`, tenta di leggere esattamente:
   - `<root>/<name>/gemini-extension.json`

Non viene eseguita alcuna scansione ricorsiva oltre un livello di directory.

### Directory nascoste

La discovery dei manifest Gemini **non** filtra i nomi di directory con prefisso punto. Se esiste una directory figlio nascosta contenente `gemini-extension.json`, viene considerata.

### File mancanti/illeggibili

Se `gemini-extension.json` è mancante o illeggibile, quella directory viene saltata silenziosamente (nessun avviso).

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

Il comportamento al momento della discovery è intenzionalmente permissivo:

- È richiesto il parsing JSON con successo.
- Non esiste validazione dello schema a runtime per i tipi/contenuti dei campi oltre la sintassi JSON.
- L'oggetto analizzato viene memorizzato come `manifest` nell'elemento della capability.

### Normalizzazione del nome

`Extension.name` viene impostato a:

1. `manifest.name` se non è `null`/`undefined`
2. altrimenti il nome della directory dell'estensione

Non viene applicato alcun controllo sul tipo stringa in questo punto.

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
  providerName: "Gemini CLI" // aggiunto dal registro delle capability
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

Note:

- `_source.path` viene normalizzato in un percorso assoluto da `createSourceMeta()`.
- La validazione delle capability a livello di registro per `extensions` verifica solo la presenza di `name` e `path`.
- I contenuti interni del manifest (`mcpServers`, `tools`, `context`) non vengono validati durante la discovery.

---

## Gestione degli errori e semantica degli avvisi

### Con avviso

- JSON non valido in un file manifest:
  - formato dell'avviso: `Invalid JSON in <manifestPath>`

### Senza avviso (skip silenzioso)

- directory `extensions` mancante
- la directory figlio non contiene `gemini-extension.json`
- file manifest illeggibile
- il JSON del manifest è sintatticamente valido ma semanticamente anomalo/incompleto

Questo significa che la validità parziale viene accettata: solo il fallimento sintattico del JSON emette un avviso.

---

## Precedenza e deduplicazione con altre sorgenti

La capability `extensions` viene aggregata tra i provider dal registro delle capability.

Provider attuali per questa capability:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) priorità `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) priorità `60`

La chiave di deduplicazione è `ext.name` (`extensionCapability.key = ext => ext.name`).

### Precedenza cross-provider

Il provider con priorità più alta prevale in caso di nomi di estensione duplicati.

- Se `native` e `gemini` emettono entrambi un'estensione con nome `foo`, viene mantenuto l'elemento native.
- Il duplicato con priorità inferiore viene mantenuto solo in `result.all` con `_shadowed = true`.

### Effetti dell'ordine intra-provider

Poiché la deduplicazione funziona con "il primo visto vince", l'ordine degli elementi locale al provider è rilevante.

- Il loader Gemini aggiunge **prima l'utente**, poi il **progetto**.
- Pertanto, i nomi duplicati tra `~/.gemini/extensions` e `<cwd>/.gemini/extensions` mantengono la voce utente e oscurano quella del progetto.

Al contrario, il provider native costruisce l'ordine delle directory di configurazione in modo diverso (`project` poi `user` in `getConfigDirs()`), quindi l'oscuramento intra-provider native avviene nella direzione opposta.

---

## Riepilogo del comportamento utente vs progetto

Per i manifest Gemini specificamente:

- Entrambe le radici utente e progetto vengono scansionate ad ogni caricamento.
- La radice del progetto è fissata a `<cwd>/.gemini/extensions` (nessuna risalita agli antenati).
- I nomi duplicati all'interno della sorgente Gemini si risolvono con priorità all'utente.
- I nomi duplicati rispetto a provider con priorità più alta (in particolare native) perdono per priorità.

---

## Confine: metadati di discovery vs caricamento runtime delle estensioni

La discovery di `gemini-extension.json` attualmente alimenta i metadati delle capability (elementi `Extension`). **Non** carica direttamente moduli di estensione TS/JS eseguibili.

Il caricamento dei moduli a runtime (`discoverAndLoadExtensions()` / `loadExtensions()`) utilizza `extension-modules` e percorsi espliciti, e attualmente filtra i moduli auto-scoperti solo per il provider `native`.

Implicazione pratica:

- Le estensioni manifest Gemini sono rilevabili come record di capability.
- Non vengono, di per sé, eseguite come moduli di estensione runtime dalla pipeline del loader delle estensioni.

Questo confine è intenzionale nell'implementazione attuale e spiega perché la discovery dei manifest e il caricamento dei moduli eseguibili possono divergere.
