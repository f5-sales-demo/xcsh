---
title: Caricamento delle estensioni (Moduli TypeScript/JavaScript)
description: >-
  Pipeline di caricamento dei moduli TypeScript e JavaScript per le estensioni
  con risoluzione, validazione e caching.
sidebar:
  order: 2
  label: Caricamento delle estensioni
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# Caricamento delle estensioni (Moduli TypeScript/JavaScript)

Questo documento tratta come l'agente di codifica individua e carica i **moduli di estensione** (`.ts`/`.js`) all'avvio.

**Non** copre le estensioni con manifesto `gemini-extension.json` (documentate separatamente).

## Cosa fa questo sottosistema

Il caricamento delle estensioni costruisce un elenco di file entry dei moduli, importa ciascun modulo con Bun, esegue la sua factory e restituisce:

- le definizioni delle estensioni caricate
- gli errori di caricamento per ciascun percorso (senza interrompere l'intero caricamento)
- un oggetto runtime di estensione condiviso, utilizzato successivamente da `ExtensionRunner`

## File di implementazione principali

- `src/extensibility/extensions/loader.ts` — scoperta dei percorsi + importazione/esecuzione
- `src/extensibility/extensions/index.ts` — esportazioni pubbliche
- `src/extensibility/extensions/runner.ts` — esecuzione runtime/eventi dopo il caricamento
- `src/discovery/builtin.ts` — provider di auto-scoperta nativo per i moduli di estensione
- `src/config/settings.ts` — carica le impostazioni unite `extensions` / `disabledExtensions`

---

## Input per il caricamento delle estensioni

### 1) Moduli di estensione nativi scoperti automaticamente

`discoverAndLoadExtensions()` chiede prima ai provider di scoperta gli elementi con capability `extension-module`, poi mantiene solo gli elementi del provider `native`.

Posizioni native effettive:

- Progetto: `<cwd>/.xcsh/extensions`
- Utente: `~/.xcsh/agent/extensions`

Le radici dei percorsi provengono dal provider nativo (`SOURCE_PATHS.native`).

Note:

- L'auto-scoperta nativa è attualmente basata su `.xcsh`.
- Il legacy `.pi` è ancora accettato nelle chiavi del manifesto `package.json` (`pi.extensions`), ma non come radice nativa in questo contesto.

### 2) Percorsi configurati esplicitamente

Dopo l'auto-scoperta, i percorsi configurati vengono aggiunti e risolti.

Fonti dei percorsi configurati nel percorso di avvio della sessione principale (`sdk.ts`):

1. Percorsi forniti via CLI (`--extension/-e`, e `--hook` è anch'esso trattato come percorso di estensione)
2. Array `extensions` nelle impostazioni (impostazioni globali + progetto unite)

File delle impostazioni globali:

- `~/.xcsh/agent/config.yml` (o directory agente personalizzata tramite `PI_CODING_AGENT_DIR`)

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

### Disabilitare la scoperta

- CLI: `--no-extensions`
- Opzione SDK: `disableExtensionDiscovery`

Differenza di comportamento:

- SDK: quando `disableExtensionDiscovery=true`, carica comunque `additionalExtensionPaths` tramite `loadExtensions()`.
- La costruzione dei percorsi CLI (`main.ts`) attualmente svuota i percorsi di estensione CLI quando `--no-extensions` è impostato, quindi i percorsi espliciti `-e/--hook` non vengono inoltrati in quella modalità.

### Disabilitare moduli di estensione specifici

L'impostazione `disabledExtensions` filtra per formato id dell'estensione:

- `extension-module:<derivedName>`

`derivedName` è basato sul percorso entry (`getExtensionNameFromPath`), ad esempio:

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
3. Se relativo, risoluzione rispetto al `cwd` corrente

### Se il percorso configurato è un file

Viene utilizzato direttamente come candidato entry del modulo.

### Se il percorso configurato è una directory

Ordine di risoluzione:

1. `package.json` in quella directory con `xcsh.extensions` (o legacy `pi.extensions`) -> utilizza le entry dichiarate
2. `index.ts`
3. `index.js`
4. Altrimenti scansiona un livello per le entry di estensione:
   - file diretti `*.ts` / `*.js`
   - sottodirectory `index.ts` / `index.js`
   - sottodirectory `package.json` con `xcsh.extensions` / `pi.extensions`

Regole e vincoli:

- nessuna scoperta ricorsiva oltre un livello di sottodirectory
- le entry di manifesto dichiarate con `extensions` sono risolte relativamente alla directory del pacchetto
- le entry dichiarate sono incluse solo se il file esiste/l'accesso è consentito
- nelle coppie `*/index.{ts,js}`, TypeScript è preferito rispetto a JavaScript
- i link simbolici sono trattati come file/directory eleggibili

### Il comportamento di ignore differisce per fonte

- L'auto-scoperta nativa (`discoverExtensionModulePaths` negli helper di scoperta) utilizza glob nativo con `gitignore: true` e `hidden: false`.
- La scansione esplicita di directory configurate in `loader.ts` utilizza regole `readdir` e **non** applica il filtraggio gitignore.

---

## Ordine di caricamento e precedenza

`discoverAndLoadExtensions()` costruisce un'unica lista ordinata e poi chiama `loadExtensions()`.

Ordine:

1. Moduli scoperti automaticamente in modo nativo
2. Percorsi configurati esplicitamente (nell'ordine fornito)

In `sdk.ts`, l'ordine configurato è:

1. Percorsi aggiuntivi CLI
2. `extensions` dalle impostazioni

De-duplicazione:

- basata sul percorso assoluto
- il primo percorso trovato ha la precedenza
- i duplicati successivi vengono ignorati

Implicazione: se lo stesso percorso di modulo è sia scoperto automaticamente che configurato esplicitamente, viene caricato una sola volta nella prima posizione (fase di auto-scoperta).

---

## Importazione del modulo e contratto della factory

Ogni percorso candidato viene caricato con importazione dinamica:

- `await import(resolvedPath)`
- la factory è `module.default ?? module`
- la factory deve essere una funzione (`ExtensionFactory`)

Se l'export non è una funzione, quel percorso fallisce con un errore strutturato e il caricamento continua.

---

## Gestione dei fallimenti e isolamento

### Durante il caricamento

Per ciascun percorso di estensione, i fallimenti vengono catturati come `{ path, error }` e non impediscono il caricamento degli altri percorsi.

Casi comuni:

- fallimento dell'importazione / file mancante
- export factory non valido (non-funzione)
- eccezione lanciata durante l'esecuzione della factory

### Modello di isolamento a runtime

- Le estensioni **non sono sandboxate** (stesso processo/runtime).
- Condividono un unico `EventBus` e un'unica istanza `ExtensionRuntime`.
- Durante il caricamento, i metodi di azione del runtime lanciano intenzionalmente `ExtensionRuntimeNotInitializedError`; il collegamento delle azioni avviene successivamente in `ExtensionRunner.initialize()`.

### Dopo il caricamento

Quando gli eventi vengono eseguiti attraverso `ExtensionRunner`, le eccezioni degli handler vengono catturate ed emesse come errori dell'estensione invece di far crashare il ciclo del runner.

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

Chiave di manifesto legacy ancora accettata:

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
