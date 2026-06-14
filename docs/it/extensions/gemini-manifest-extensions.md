---
title: Estensioni Manifest Gemini
description: >-
  Formato delle estensioni manifest Gemini per la compatibilità di skill e
  agenti cross-platform.
sidebar:
  order: 7
  label: Manifest Gemini
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Estensioni Manifest Gemini (`gemini-extension.json`)

Questo documento illustra come il coding-agent individua e analizza le estensioni manifest in stile Gemini (`gemini-extension.json`) nella capability `extensions`.

**Non** copre il caricamento dei moduli di estensione TypeScript/JavaScript (`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`), documentato in `extension-loading.md`.

## File di implementazione

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## Cosa viene individuato

Il provider Gemini (`id: gemini`, priorità `60`) registra un loader `extensions` che esegue la scansione di due radici fisse:

- Utente: `~/.gemini/extensions`
- Progetto: `<cwd>/.gemini/extensions`

La risoluzione dei percorsi avviene direttamente da `ctx.home` e `ctx.cwd` tramite `getUserPath()` / `getProjectPath()`.

Regola di scope importante: la ricerca nel progetto è **limitata alla cwd**. Non risale le directory padre.

---

## Regole di scansione delle directory

Per ciascuna radice (`~/.gemini/extensions` e `<cwd>/.gemini/extensions`), il processo di individuazione esegue:

1. `readDirEntries(root)`
2. mantiene solo le directory figlie dirette (`entry.isDirectory()`)
3. per ciascuna figlia `<name>`, tenta di leggere esattamente:
   - `<root>/<name>/gemini-extension.json`

Non viene eseguita alcuna scansione ricorsiva oltre un livello di directory.

### Directory nascoste

L'individuazione dei manifest Gemini **non** filtra i nomi di directory con prefisso punto. Se una directory figlia nascosta esiste e contiene `gemini-extension.json`, viene considerata.

### File mancanti o illeggibili

Se `gemini-extension.json` è assente o illeggibile, quella directory viene ignorata silenziosamente (nessun avviso).

---

## Struttura del manifest (come implementata)

Il tipo di capability definisce la seguente struttura del manifest:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

Il comportamento in fase di individuazione è volutamente permissivo:

- È richiesto il successo del parsing JSON.
- Non viene eseguita alcuna validazione dello schema a runtime per tipi/contenuti dei campi al di là della sintassi JSON.
- L'oggetto analizzato viene memorizzato come `manifest` sull'elemento di capability.

### Normalizzazione del nome

`Extension.name` viene impostato su:

1. `manifest.name` se non è `null`/`undefined`
2. altrimenti il nome della directory dell'estensione

Qui non viene applicata alcuna coercizione al tipo stringa.

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

- `_source.path` viene normalizzato in un percorso assoluto da `createSourceMeta()`.
- La validazione della capability a livello di registro per `extensions` controlla solo la presenza di `name` e `path`.
- Gli elementi interni del manifest (`mcpServers`, `tools`, `context`) non vengono validati durante l'individuazione.

---

## Gestione degli errori e semantica degli avvisi

### Con avviso

- JSON non valido in un file manifest:
  - formato dell'avviso: `Invalid JSON in <manifestPath>`

### Senza avviso (ignorato silenziosamente)

- directory `extensions` assente
- la directory figlia non ha `gemini-extension.json`
- file manifest illeggibile
- il JSON del manifest è sintatticamente valido ma semanticamente anomalo/incompleto

Ciò significa che la validità parziale è accettata: solo un errore JSON sintattico genera un avviso.

---

## Precedenza e deduplicazione con altre sorgenti

La capability `extensions` viene aggregata tra i provider dal registro delle capability.

Provider attuali per questa capability:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) priorità `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) priorità `60`

La chiave di deduplicazione è `ext.name` (`extensionCapability.key = ext => ext.name`).

### Precedenza tra provider

Il provider con priorità più alta prevale sui nomi di estensione duplicati.

- Se `native` e `gemini` emettono entrambi il nome di estensione `foo`, viene mantenuto l'elemento nativo.
- Il duplicato con priorità inferiore viene conservato solo in `result.all` con `_shadowed = true`.

### Effetti dell'ordine intra-provider

Poiché la deduplicazione segue la logica "vince il primo trovato", l'ordine degli elementi locali al provider è rilevante.

- Il loader Gemini aggiunge prima gli elementi **utente**, poi quelli di **progetto**.
- Pertanto, i nomi duplicati tra `~/.gemini/extensions` e `<cwd>/.gemini/extensions` mantengono la voce utente e ombreggiano quella di progetto.

Al contrario, il provider nativo costruisce l'ordine delle directory di configurazione in modo diverso (`project` prima di `user` in `getConfigDirs()`), quindi lo shadowing intra-provider nativo avviene nella direzione opposta.

---

## Riepilogo del comportamento utente vs progetto

Per i manifest Gemini in particolare:

- Entrambe le radici utente e progetto vengono scansionate ad ogni caricamento.
- La radice del progetto è fissa a `<cwd>/.gemini/extensions` (nessuna risalita agli antenati).
- I nomi duplicati all'interno della sorgente Gemini vengono risolti dando priorità all'utente.
- I nomi duplicati rispetto a provider con priorità più alta (in particolare nativo) vengono scartati per priorità.

---

## Confine: metadati di individuazione vs caricamento delle estensioni a runtime

L'individuazione di `gemini-extension.json` attualmente alimenta i metadati delle capability (elementi `Extension`). **Non** carica direttamente moduli di estensione TS/JS eseguibili.

Il caricamento dei moduli a runtime (`discoverAndLoadExtensions()` / `loadExtensions()`) utilizza `extension-modules` e percorsi espliciti, e attualmente filtra i moduli individuati automaticamente limitandosi al provider `native`.

Implicazione pratica:

- Le estensioni manifest Gemini sono individuabili come record di capability.
- Non vengono, di per sé, eseguite come moduli di estensione a runtime dalla pipeline del loader delle estensioni.

Questo confine è intenzionale nell'implementazione attuale e spiega perché l'individuazione dei manifest e il caricamento dei moduli eseguibili possono divergere.
