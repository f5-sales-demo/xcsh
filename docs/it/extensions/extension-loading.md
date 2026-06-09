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

Questo documento illustra come l'agente di codifica scopre e carica i **moduli delle estensioni** (`.ts`/`.js`) all'avvio.

**Non** copre le estensioni manifest `gemini-extension.json` (documentate separatamente).

## Cosa fa questo sottosistema

Il caricamento delle estensioni costruisce un elenco di file entry dei moduli, importa ciascun modulo con Bun, esegue la relativa factory e restituisce:

- le definizioni delle estensioni caricate
- gli errori di caricamento per ciascun percorso (senza interrompere l'intero caricamento)
- un oggetto runtime condiviso delle estensioni utilizzato successivamente da `ExtensionRunner`

## File di implementazione principali

- `src/extensibility/extensions/loader.ts` — scoperta dei percorsi + importazione/esecuzione
- `src/extensibility/extensions/index.ts` — esportazioni pubbliche
- `src/extensibility/extensions/runner.ts` — esecuzione runtime/eventi dopo il caricamento
- `src/discovery/builtin.ts` — provider nativo di auto-scoperta per i moduli delle estensioni
- `src/config/settings.ts` — carica le impostazioni unite `extensions` / `disabledExtensions`

---

## Input per il caricamento delle estensioni

### 1) Moduli delle estensioni native scoperti automaticamente

`discoverAndLoadExtensions()` prima interroga i provider di scoperta per gli elementi con capability `extension-module`, poi mantiene solo gli elementi del provider `native`.

Posizioni native effettive:

- Progetto: `<cwd>/.xcsh/extensions`
- Utente: `~/.xcsh/agent/extensions`

Le radici dei percorsi provengono dal provider nativo (`SOURCE_PATHS.native`).

Note:

- L'auto-scoperta nativa è attualmente basata su `.xcsh`.
- Il legacy `.pi` è ancora accettato nelle chiavi manifest di `package.json` (`pi.extensions`), ma non come radice nativa in questo contesto.

### 2) Percorsi configurati esplicitamente

Dopo l'auto-scoperta, i percorsi configurati vengono aggiunti e risolti.

Fonti dei percorsi configurati nel percorso di avvio della sessione principale (`sdk.ts`):

1. Percorsi forniti via CLI (`--extension/-e`, e `--hook` viene trattato anch'esso come un percorso di estensione)
2. Array `extensions` nelle impostazioni (impostazioni globali + di progetto unite)

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

Comportamento differenziato:

- SDK: quando `disableExtensionDiscovery=true`, carica comunque `additionalExtensionPaths` tramite `loadExtensions()`.
- La costruzione del percorso CLI (`main.ts`) attualmente cancella i percorsi delle estensioni CLI quando `--no-extensions` è impostato, quindi gli espliciti `-e/--hook` non vengono inoltrati in quella modalità.

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

## Risoluzione di percorsi e entry

### Normalizzazione dei percorsi

Per i percorsi configurati:

1. Normalizzazione degli spazi unicode
2. Espansione di `~`
3. Se relativo, risoluzione rispetto alla `cwd` corrente

### Se il percorso configurato è un file

Viene utilizzato direttamente come candidato entry del modulo.

### Se il percorso configurato è una directory

Ordine di risoluzione:

1. `package.json` in quella directory con `xcsh.extensions` (o legacy `pi.extensions`) -> utilizza le entry dichiarate
2. `index.ts`
3. `index.js`
4. Altrimenti scansione di un livello per le entry delle estensioni:
   - `*.ts` / `*.js` diretti
   - `index.ts` / `index.js` nelle sottodirectory
   - `package.json` nelle sottodirectory con `xcsh.extensions` / `pi.extensions`

Regole e vincoli:

- nessuna scoperta ricorsiva oltre un livello di sottodirectory
- le entry manifest dichiarate vengono risolte relativamente alla directory del pacchetto
- le entry dichiarate vengono incluse solo se il file esiste/l'accesso è consentito
- nelle coppie `*/index.{ts,js}`, TypeScript ha la precedenza su JavaScript
- i link simbolici sono trattati come file/directory idonei

### Il comportamento di esclusione differisce in base alla fonte

- L'auto-scoperta nativa (`discoverExtensionModulePaths` negli helper di scoperta) utilizza glob nativo con `gitignore: true` e `hidden: false`.
- La scansione esplicita delle directory configurate in `loader.ts` utilizza regole `readdir` e **non** applica il filtraggio gitignore.

---

## Ordine di caricamento e precedenza

`discoverAndLoadExtensions()` costruisce un unico elenco ordinato e poi chiama `loadExtensions()`.

Ordine:

1. Moduli scoperti automaticamente nativi
2. Percorsi configurati esplicitamente (nell'ordine fornito)

In `sdk.ts`, l'ordine configurato è:

1. Percorsi aggiuntivi CLI
2. `extensions` dalle impostazioni

De-duplicazione:

- basata sul percorso assoluto
- il primo percorso trovato prevale
- i duplicati successivi vengono ignorati

Implicazione: se lo stesso percorso del modulo è sia scoperto automaticamente che configurato esplicitamente, viene caricato una sola volta nella prima posizione (fase di auto-scoperta).

---

## Importazione del modulo e contratto della factory

Ogni percorso candidato viene caricato con importazione dinamica:

- `await import(resolvedPath)`
- la factory è `module.default ?? module`
- la factory deve essere una funzione (`ExtensionFactory`)

Se l'esportazione non è una funzione, quel percorso fallisce con un errore strutturato e il caricamento continua.

---

## Gestione degli errori e isolamento

### Durante il caricamento

Per ogni percorso di estensione, i fallimenti vengono catturati come `{ path, error }` e non impediscono il caricamento degli altri percorsi.

Casi comuni:

- fallimento dell'importazione / file mancante
- esportazione factory non valida (non-funzione)
- eccezione generata durante l'esecuzione della factory

### Modello di isolamento runtime

- Le estensioni **non sono sandboxate** (stesso processo/runtime).
- Condividono un unico `EventBus` e un'unica istanza di `ExtensionRuntime`.
- Durante il caricamento, i metodi di azione runtime generano intenzionalmente `ExtensionRuntimeNotInitializedError`; il collegamento delle azioni avviene successivamente in `ExtensionRunner.initialize()`.

### Dopo il caricamento

Quando gli eventi vengono eseguiti tramite `ExtensionRunner`, le eccezioni degli handler vengono catturate e emesse come errori dell'estensione invece di bloccare il ciclo del runner.

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

Chiave manifest legacy ancora accettata:

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
