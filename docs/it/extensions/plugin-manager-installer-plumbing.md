---
title: Plugin Manager and Installer Plumbing
description: >-
  Funzionamento interno del plugin manager che copre installazione, validazione,
  risoluzione delle dipendenze e gestione del ciclo di vita.
sidebar:
  order: 5
  label: Plugin manager
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# Funzionamento interno del plugin manager e dell'installer

Questo documento descrive come le operazioni `xcsh plugin` modificano lo stato dei plugin su disco e come i plugin installati diventano capacità runtime (strumenti oggi, risoluzione dei percorsi per hook/comandi disponibile).

## Ambito e architettura

Esistono due implementazioni di gestione dei plugin nel codebase:

1. **Percorso attivo utilizzato dai comandi CLI**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **Modulo helper legacy**: funzioni installer (`src/extensibility/plugins/installer.ts`)

L'esecuzione del comando `xcsh plugin ...` passa attraverso `PluginManager`.

`installer.ts` documenta ancora importanti controlli di sicurezza e comportamenti del filesystem, ma non è il percorso utilizzato da `src/commands/plugin.ts` + `src/cli/plugin-cli.ts`.

## Ciclo di vita: dall'invocazione CLI alla disponibilità runtime

```text
xcsh plugin <action> ...
  -> src/commands/plugin.ts
  -> runPluginCommand(...) in src/cli/plugin-cli.ts
  -> PluginManager method (install/list/uninstall/link/...) 
  -> mutate ~/.xcsh/plugins/{package.json,node_modules,xcsh-plugins.lock.json}
  -> runtime discovery: discoverAndLoadCustomTools(...)
  -> getAllPluginToolPaths(cwd)
  -> custom tool loader imports tool modules
```

### Punti di ingresso dei comandi

- `src/commands/plugin.ts` definisce comandi/flag e inoltra a `runPluginCommand`.
- `src/cli/plugin-cli.ts` mappa i sottocomandi ai metodi di `PluginManager`:
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- Non esiste un'azione `update` esplicita; l'aggiornamento si effettua rieseguendo `install` con un nuovo pacchetto/specifica di versione.

## Modello su disco

Lo stato globale dei plugin risiede in `~/.xcsh/plugins`:

- `package.json` — manifesto delle dipendenze utilizzato da `bun install`/`bun uninstall`
- `node_modules/` — pacchetti plugin installati o symlink
- `xcsh-plugins.lock.json` — stato runtime:
  - abilitato/disabilitato per plugin
  - set di funzionalità selezionato per plugin
  - impostazioni plugin persistenti

Le sovrascritture locali al progetto risiedono in:

- `<cwd>/.xcsh/plugin-overrides.json`

Le sovrascritture sono in sola lettura dal punto di vista del manager/loader (nessun percorso di scrittura qui) e possono disabilitare plugin o sovrascrivere funzionalità/impostazioni per questo progetto.

## Parsing delle specifiche del plugin e interpretazione dei metadati

## Grammatica delle specifiche di installazione

`parsePluginSpec` (`parser.ts`) supporta:

- `pkg` -> `features: null` (comportamento predefinito)
- `pkg[*]` -> abilita tutte le funzionalità del manifesto
- `pkg[]` -> non abilita funzionalità opzionali
- `pkg[a,b]` -> abilita funzionalità specifiche per nome
- `@scope/pkg@1.2.3[feat]` -> pacchetto con scope + versione con selezione esplicita delle funzionalità

`extractPackageName` rimuove il suffisso di versione per la ricerca del percorso su disco dopo l'installazione.

## Sorgente del manifesto e campi obbligatori

Il manifesto viene risolto come:

1. `package.json.xcsh`
2. fallback `package.json.pi`
3. fallback `{ version: package.version }`

Implicazioni:

- Non esiste una validazione rigorosa dello schema nel manager/loader.
- Un pacchetto privo di `xcsh`/`pi` è comunque installabile e listabile.
- Il caricamento runtime dei plugin (`getEnabledPlugins`) ignora i pacchetti senza manifesto `xcsh`/`pi`.
- `manifest.version` viene sempre sovrascritto dalla `version` del pacchetto.

Un JSON `package.json` malformato causa un errore critico al momento della lettura; una forma di manifesto malformata può fallire successivamente solo quando campi specifici vengono consumati.

## Flusso di installazione/aggiornamento (`PluginManager.install`)

1. Analizza la sintassi delle parentesi quadre per le funzionalità dalla specifica di installazione.
2. Valida il nome del pacchetto rispetto a regex + lista di negazione dei metacaratteri shell.
3. Assicura che il `package.json` del plugin esista (`xcsh-plugins`, mappa delle dipendenze private).
4. Esegue `bun install <packageSpec>` in `~/.xcsh/plugins`.
5. Legge il `node_modules/<name>/package.json` del pacchetto installato.
6. Risolve il manifesto e calcola `enabledFeatures`:
   - `[*]`: tutte le funzionalità dichiarate (o `null` se non esiste mappa delle funzionalità)
   - `[a,b]`: valida che ciascuna funzionalità esista nella mappa delle funzionalità del manifesto
   - `[]`: lista di funzionalità vuota
   - specifica semplice: `null` (utilizza la politica predefinita successivamente nel loader)
7. Inserisce/aggiorna lo stato runtime nel lockfile: `{ version, enabledFeatures, enabled: true }`.

### Semantica dell'aggiornamento

Poiché l'aggiornamento è guidato dall'installazione:

- `xcsh plugin install pkg@newVersion` aggiorna la dipendenza e la versione nel lockfile.
- Le impostazioni esistenti vengono preservate; la voce di stato viene sovrascritta per versione/funzionalità/abilitazione.
- Non esiste una logica separata di "verifica aggiornamenti" o di migrazione transazionale.

## Flusso di rimozione (`PluginManager.uninstall`)

1. Valida il nome del pacchetto.
2. Esegue `bun uninstall <name>` nella directory dei plugin.
3. Rimuove lo stato runtime del plugin dal lockfile:
   - `config.plugins[name]`
   - `config.settings[name]`

Se il comando di disinstallazione fallisce, lo stato runtime non viene modificato.

## Flusso di elenco (`PluginManager.list`)

1. Legge la mappa delle dipendenze del plugin da `~/.xcsh/plugins/package.json`.
2. Carica la configurazione runtime dal lockfile (file mancante -> valori predefiniti vuoti).
3. Carica le sovrascritture del progetto (`<cwd>/.xcsh/plugin-overrides.json`, errori di parsing/lettura -> oggetto vuoto con avviso).
4. Per ogni dipendenza con un package.json risolvibile:
   - costruisce un record `InstalledPlugin`
   - unisce lo stato funzionalità/abilitazione:
     - base dal lockfile (o valori predefiniti)
     - le sovrascritture del progetto possono sostituire la selezione delle funzionalità
     - la lista `disabled` del progetto maschera il plugin come disabilitato

Questo è lo stato effettivo utilizzato dall'output di stato CLI e dalle operazioni di impostazioni/funzionalità.

## Flusso di collegamento (`PluginManager.link`)

`link` supporta lo sviluppo locale dei plugin creando un symlink di un pacchetto locale in `~/.xcsh/plugins/node_modules/<pkg.name>`.

Comportamento:

1. Risolve `localPath` rispetto al cwd del manager.
2. Richiede `package.json` locale e campo `name`.
3. Assicura che le directory dei plugin esistano.
4. Per nomi con scope, crea la directory dello scope.
5. Rimuove il percorso esistente nella posizione di destinazione del link.
6. Crea il symlink.
7. Aggiunge una voce nel lockfile runtime abilitata con funzionalità predefinite (`null`).

Avvertenza: l'attuale `PluginManager.link` non applica il controllo del confine del percorso `cwd` presente nel legacy `installer.ts` (`normalizedPath.startsWith(normalizedCwd)`), quindi la fiducia è responsabilità del chiamante.

## Caricamento runtime: dal plugin installato alle capacità richiamabili

## Gate di scoperta

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) legge:

- manifesto delle dipendenze del plugin (`package.json`)
- stato runtime del lockfile
- sovrascritture del progetto tramite `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

Filtraggio:

- salta se non esiste package.json del plugin
- salta se il manifesto (`xcsh`/`pi`) è assente
- salta se globalmente disabilitato nel lockfile
- salta se disabilitato dal progetto

## Risoluzione dei percorsi delle capacità

Per ogni plugin abilitato:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

Ogni resolver include voci base più voci delle funzionalità:

- lista esplicita di funzionalità -> solo le funzionalità selezionate
- `enabledFeatures === null` -> abilita le funzionalità contrassegnate come `default: true`

I file mancanti vengono silenziosamente ignorati (guardia `existsSync`).

## Differenze nell'attuale collegamento runtime

- **Gli strumenti sono collegati al runtime oggi** tramite `discoverAndLoadCustomTools` (`custom-tools/loader.ts`), che chiama `getAllPluginToolPaths(cwd)`.
- I percorsi vengono deduplicati per percorso assoluto risolto nella scoperta degli strumenti personalizzati (set `seen`, il primo percorso vince).
- **I resolver per hook/comandi esistono** e sono esportati, ma questo percorso di codice attualmente non li collega a un registro runtime nello stesso modo in cui vengono collegati gli strumenti.

## Dettagli della gestione lock/stato

`PluginManager` memorizza in cache la configurazione runtime in memoria per istanza (`#runtimeConfig`) e la carica pigramente una volta sola.

Comportamento di caricamento:

- lockfile mancante -> `{ plugins: {}, settings: {} }`
- errore di lettura/parsing del lockfile -> avviso + stessi valori predefiniti vuoti

Comportamento di salvataggio:

- scrive l'intero JSON del lockfile con formattazione leggibile ad ogni mutazione

Non esiste alcun meccanismo di locking tra processi o strategia di merge; scritture concorrenti possono sovrascriversi a vicenda.

## Controlli di sicurezza e confini di fiducia

## Validazione input/pacchetto

Il percorso attivo del manager applica la validazione del nome del pacchetto:

- regex per specifiche di pacchetti con e senza scope (opzionalmente con versione)
- lista di negazione esplicita dei metacaratteri shell (`[;&|`$(){}[]<>\\]`)

Questo limita il rischio di command-injection quando si invoca `bun install/uninstall`.

## Confine di fiducia del filesystem

- Il codice del plugin viene eseguito in-process quando i moduli degli strumenti personalizzati vengono importati; nessun sandboxing.
- I percorsi relativi del manifesto vengono uniti alla directory del pacchetto del plugin e viene verificata solo l'esistenza.
- Il pacchetto del plugin stesso è considerato codice affidabile una volta installato.

## Controlli esclusivi dell'installer legacy

`installer.ts` include controlli aggiuntivi al momento del link non replicati in `PluginManager.link`:

- il percorso locale deve risolversi all'interno del cwd del progetto
- guardie aggiuntive contro il traversamento di nome/percorso del pacchetto per la denominazione del target del symlink

Poiché la CLI utilizza `PluginManager`, queste guardie di link più restrittive non sono attualmente sul percorso principale.

## Comportamento in caso di fallimento, successo parziale e rollback

Il plugin manager non è transazionale.

| Fase dell'operazione | Comportamento in caso di fallimento | Rollback |
| --- | --- | --- |
| `bun install` fallisce | l'installazione si interrompe con stderr | N/D (nessuna scrittura di stato ancora) |
| L'installazione riesce, poi la validazione manifesto/funzionalità fallisce | il comando fallisce | Nessun rollback di disinstallazione; la dipendenza può rimanere in `node_modules`/`package.json` |
| L'installazione riesce, poi la scrittura del lockfile fallisce | il comando fallisce | Nessun rollback del pacchetto installato |
| `bun uninstall` riesce, la scrittura del lockfile fallisce | il comando fallisce | Pacchetto rimosso, lo stato runtime obsoleto può rimanere |
| `link` rimuove il target precedente poi la creazione del symlink fallisce | il comando fallisce | Nessun ripristino del link/directory precedente |

Operativamente, `doctor --fix` può riparare alcune discrepanze (`bun install`, pulizia configurazione orfana, pulizia funzionalità non valide), ma opera al meglio delle possibilità.

## Riepilogo del comportamento con manifesto malformato/mancante

- Campo `xcsh`/`pi` mancante:
  - install/list: tollerato (manifesto minimale)
  - scoperta plugin abilitati runtime: ignorato come non-plugin
- Funzionalità mancante referenziata dalla specifica di installazione o `features --set/--enable`: errore critico con lista delle funzionalità disponibili
- `plugin-overrides.json` non valido: ignorato con fallback a `{}` sia nel percorso del manager che del loader
- Percorsi file tool/hook/command mancanti referenziati dal manifesto: ignorati silenziosamente durante l'espansione del resolver; segnalati come errori solo da `doctor`

## Differenze di modalità e precedenza

- `--dry-run` (install): restituisce un risultato di installazione sintetico, nessuna scrittura su filesystem/rete/stato.
- `--json`: solo formattazione dell'output, nessun cambiamento di comportamento.
- Le sovrascritture del progetto hanno sempre la precedenza sul lockfile globale per la visualizzazione di funzionalità/impostazioni.
- L'abilitazione effettiva è `runtimeEnabled && !projectDisabled`.

## File di implementazione

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — dichiarazione del comando CLI e mappatura dei flag
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — dispatch delle azioni, gestori dei comandi rivolti all'utente
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — implementazione attiva di install/remove/list/link/state/doctor
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — helper legacy dell'installer e controlli di sicurezza aggiuntivi per il link
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — scoperta dei plugin abilitati e risoluzione dei percorsi tool/hook/command
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — helper per il parsing delle specifiche di installazione e dei nomi dei pacchetti
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — contratti di tipo per manifesto/runtime/sovrascritture
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — collegamento runtime per i moduli degli strumenti forniti dai plugin
