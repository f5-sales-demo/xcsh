---
title: Caricamento delle estensioni (Moduli TypeScript/JavaScript)
description: >-
  Pipeline di caricamento di moduli TypeScript e JavaScript per le estensioni
  con risoluzione, validazione e caching.
sidebar:
  order: 2
  label: Caricamento delle estensioni
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# Caricamento delle estensioni (Moduli TypeScript/JavaScript)

Questo documento descrive come il coding agent individua e carica i **moduli estensione** (`.ts`/`.js`) all'avvio.

**Non** copre le estensioni con manifesto `gemini-extension.json` (documentate separatamente).

## Cosa fa questo sottosistema

Il caricamento delle estensioni costruisce un elenco di file entry dei moduli, importa ciascun modulo con Bun, esegue la relativa factory e restituisce:

- le definizioni delle estensioni caricate
- gli errori di caricamento per ogni percorso (senza interrompere l'intero caricamento)
- un oggetto runtime condiviso per le estensioni, utilizzato successivamente da `ExtensionRunner`

## File di implementazione principali

- `src/extensibility/extensions/loader.ts` — individuazione dei percorsi + import/esecuzione
- `src/extensibility/extensions/index.ts` — export pubblici
- `src/extensibility/extensions/runner.ts` — runtime/esecuzione degli eventi dopo il caricamento
- `src/discovery/builtin.ts` — provider di auto-discovery nativo per i moduli estensione
- `src/config/settings.ts` — carica le impostazioni unite `extensions` / `disabledExtensions`

---

## Input per il caricamento delle estensioni

### 1) Moduli estensione nativi individuati automaticamente

`discoverAndLoadExtensions()` richiede prima ai provider di discovery gli elementi con capability `extension-module`, poi mantiene solo gli elementi del provider `native`.

Posizioni native effettive:

- Progetto: `<cwd>/.xcsh/extensions`
- Utente: `~/.xcsh/agent/extensions`

Le directory radice dei percorsi provengono dal provider nativo (`SOURCE_PATHS.native`).

Note:

- L'auto-discovery nativa è attualmente basata su `.xcsh`.
- Il legacy `.pi` è ancora accettato nelle chiavi del manifesto `package.json` (`pi.extensions`), ma non come radice nativa in questo contesto.

### 2) Percorsi configurati esplicitamente

Dopo l'auto-discovery, i percorsi configurati vengono aggiunti e risolti.

Fonti dei percorsi configurati nel percorso di avvio della sessione principale (`sdk.ts`):

1. Percorsi forniti da CLI (`--extension/-e`, e `--hook` è anch'esso trattato come percorso di estensione)
2. Array `extensions` nelle impostazioni (impostazioni globali + di progetto unite)

File delle impostazioni globali:

- `~/.xcsh/agent/config.yml` (o directory dell'agent personalizzata tramite `PI_CODING_AGENT_DIR`)

File delle impostazioni di progetto:

- `<cwd>/.xcsh/settings.json`

Esempi:

```yaml
# ~/.xcsh/agent/config.yml
extensions:
  - ~/my-exts/safety.ts
  - ./local/ext-pack
```

```json
{
  "extensions": ["./.xcsh/extensions/my-extra"]
}
```

---

## Controlli di abilitazione/disabilitazione

### Disabilitare la discovery

- CLI: `--no-extensions`
- Opzione SDK: `disableExtensionDiscovery`

Distinzione di comportamento:

- SDK: quando `disableExtensionDiscovery=true`, carica comunque `additionalExtensionPaths` tramite `loadExtensions()`.
- La costruzione dei percorsi CLI (`main.ts`) attualmente svuota i percorsi delle estensioni CLI quando `--no-extensions` è impostato, quindi i percorsi espliciti `-e/--hook` non vengono inoltrati in quella modalità.

### Disabilitare moduli estensione specifici

L'impostazione `disabledExtensions` filtra per formato dell'id dell'estensione:

- `extension-module:<derivedName>`

`derivedName` è basato sul percorso di entry (`getExtensionNameFromPath`), ad esempio:

- `/x/foo.ts` -> `foo`
- `/x/bar/index.ts` -> `bar`

Esempio:

```yaml
disabledExtensions:
  - extension-module:foo
```

---

## Risoluzione di percorsi ed entry

### Normalizzazione dei percorsi

Per i percorsi configurati:

1. Normalizzazione degli spazi unicode
2. Espansione di `~`
3. Se relativo, risoluzione rispetto alla `cwd` corrente

### Se il percorso configurato è un file

Viene utilizzato direttamente come candidato entry del modulo.

### Se il percorso configurato è una directory

Ordine di risoluzione:

1. `package.json` in quella directory con `xcsh.extensions` (o legacy `pi.extensions`) -> usa le entry dichiarate
2. `index.ts`
3. `index.js`
4. Altrimenti scansione di un livello per le entry delle estensioni:
   - `*.ts` / `*.js` diretti
   - sottodirectory `index.ts` / `index.js`
   - sottodirectory `package.json` con `xcsh.extensions` / `pi.extensions`

Regole e vincoli:

- nessuna discovery ricorsiva oltre un livello di sottodirectory
- le entry dichiarate nel manifesto `extensions` sono risolte relativamente alla directory del package
- le entry dichiarate sono incluse solo se il file esiste/l'accesso è consentito
- nelle coppie `*/index.{ts,js}`, TypeScript è preferito rispetto a JavaScript
- i symlink sono trattati come file/directory validi

### Il comportamento di esclusione differisce in base alla fonte

- L'auto-discovery nativa (`discoverExtensionModulePaths` negli helper di discovery) utilizza glob nativo con `gitignore: true` e `hidden: false`.
- La scansione esplicita delle directory configurate in `loader.ts` utilizza le regole di `readdir` e **non** applica il filtraggio gitignore.

---

## Ordine di caricamento e precedenza

`discoverAndLoadExtensions()` costruisce un elenco ordinato unico e poi chiama `loadExtensions()`.

Ordine:

1. Moduli individuati automaticamente (nativi)
2. Percorsi configurati esplicitamente (nell'ordine fornito)

In `sdk.ts`, l'ordine dei configurati è:

1. Percorsi aggiuntivi da CLI
2. `extensions` dalle impostazioni

De-duplicazione:

- basata sul percorso assoluto
- il primo percorso incontrato prevale
- i duplicati successivi vengono ignorati

Implicazione: se lo stesso percorso del modulo è sia individuato automaticamente sia configurato esplicitamente, viene caricato una sola volta alla prima posizione (fase di auto-discovery).

---

## Import del modulo e contratto della factory

Ogni percorso candidato viene caricato con import dinamico:

- `await import(resolvedPath)`
- la factory è `module.default ?? module`
- la factory deve essere una funzione (`ExtensionFactory`)

Se l'export non è una funzione, quel percorso fallisce con un errore strutturato e il caricamento prosegue.

---

## Gestione dei fallimenti e isolamento

### Durante il caricamento

Per ogni percorso di estensione, i fallimenti vengono catturati come `{ path, error }` e non impediscono il caricamento degli altri percorsi.

Casi comuni:

- fallimento dell'import / file mancante
- export della factory non valido (non è una funzione)
- eccezione sollevata durante l'esecuzione della factory

### Modello di isolamento a runtime

- Le estensioni **non** sono sandboxate (stesso processo/runtime).
- Condividono un unico `EventBus` e un'unica istanza di `ExtensionRuntime`.
- Durante il caricamento, i metodi di azione del runtime sollevano intenzionalmente `ExtensionRuntimeNotInitializedError`; il collegamento delle azioni avviene successivamente in `ExtensionRunner.initialize()`.

### Dopo il caricamento

Quando gli eventi vengono eseguiti tramite `ExtensionRunner`, le eccezioni degli handler vengono catturate e emesse come errori dell'estensione invece di causare il crash del loop del runner.

---

## Esempi minimi di layout utente/progetto

### Livello utente

```text
~/.xcsh/agent/
  config.yml
  extensions/
    guardrails.ts
    audit/
      index.ts
```

### Livello progetto

```text
<repo>/
  .xcsh/
    settings.json
    extensions/
      checks/
        package.json
      lint-gates.ts
```

`checks/package.json`:

```json
{
  "xcsh": {
    "extensions": ["./src/check-a.ts", "./src/check-b.js"]
  }
}
```

Chiave legacy del manifesto ancora accettata:

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
