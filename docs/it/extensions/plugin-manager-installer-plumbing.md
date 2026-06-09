---
title: Plugin Manager e funzionamento interno dell'Installer
description: >-
  Dettagli interni del plugin manager che coprono installazione, validazione,
  risoluzione delle dipendenze e gestione del ciclo di vita.
sidebar:
  order: 5
  label: Plugin manager
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# Plugin manager e funzionamento interno dell'installer

Questo documento descrive come le operazioni `xcsh plugin` modificano lo stato dei plugin su disco e come i plugin installati diventano capacità runtime (strumenti oggi, risoluzione dei percorsi di hook/comandi disponibile).

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

- `src/commands/plugin.ts` definisce comandi/flag e li inoltra a `runPluginCommand`.
- `src/cli/plugin-cli.ts` mappa i sottocomandi ai metodi di `PluginManager`:
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- Non esiste un'azione `update` esplicita; l'aggiornamento viene effettuato rieseguendo `install` con un nuovo pacchetto/specifica di versione.

## Modello su disco

Lo stato globale dei plugin risiede in `~/.xcsh/plugins`:

- `package.json` — manifesto delle dipendenze utilizzato da `bun install`/`bun uninstall`
- `node_modules/` — pacchetti plugin installati o symlink
- `xcsh-plugins.lock.json` — stato runtime:
  - abilitato/disabilitato per plugin
  - set di feature selezionato per plugin
  - impostazioni plugin persistenti

Le sovrascritture locali al progetto risiedono in:

- `<cwd>/.xcsh/plugin-overrides.json`

Le sovrascritture sono in sola lettura dal punto di vista del manager/loader (nessun percorso di scrittura qui) e possono disabilitare plugin o sovrascrivere feature/impostazioni per questo progetto.

## Parsing delle specifiche plugin e interpretazione dei metadati

## Grammatica delle specifiche di installazione

`parsePluginSpec` (`parser.ts`) supporta:

- `pkg` -> `features: null` (comportamento predefinito)
- `pkg[*]` -> abilita tutte le feature del manifesto
- `pkg[]` -> non abilita feature opzionali
- `pkg[a,b]` -> abilita feature con nome specifico
- `@scope/pkg@1.2.3[feat]` -> pacchetto con scope + versione con selezione esplicita delle feature

`extractPackageName` rimuove il suffisso di versione per la ricerca del percorso su disco dopo l'installazione.

## Origine del manifesto e campi richiesti

Il manifesto viene risolto come:

1. `package.json.xcsh`
2. fallback `package.json.pi`
3. fallback `{ version: package.version }`

Implicazioni:

- Non esiste una validazione rigorosa dello schema nel manager/loader.
- Un pacchetto senza `xcsh`/`pi` è comunque installabile e listabile.
- Il caricamento runtime dei plugin (`getEnabledPlugins`) ignora i pacchetti senza manifesto `xcsh`/`pi`.
- `manifest.version` viene sempre sovrascritto dalla `version` del pacchetto.

Un JSON `package.json` malformato causa un errore fatale al momento della lettura; una forma del manifesto malformata potrebbe fallire solo successivamente quando vengono consumati campi specifici.

## Flusso di installazione/aggiornamento (`PluginManager.install`)

1. Analisi della sintassi a parentesi quadre delle feature dalla specifica di installazione.
2. Validazione del nome del pacchetto tramite regex + denylist di metacaratteri shell.
3. Verifica dell'esistenza del `package.json` del plugin (`xcsh-plugins`, mappa delle dipendenze private).
4. Esecuzione di `bun install <packageSpec>` in `~/.xcsh/plugins`.
5. Lettura del `node_modules/<name>/package.json` del pacchetto installato.
6. Risoluzione del manifesto e calcolo di `enabledFeatures`:
   - `[*]`: tutte le feature dichiarate (o `null` se non esiste una mappa delle feature)
   - `[a,b]`: valida che ogni feature esista nella mappa delle feature del manifesto
   - `[]`: lista di feature vuota
   - specifica senza parentesi: `null` (usa la politica predefinita successivamente nel loader)
7. Upsert dello stato runtime nel lockfile: `{ version, enabledFeatures, enabled: true }`.

### Semantica dell'aggiornamento

Poiché l'aggiornamento è guidato dall'installazione:

- `xcsh plugin install pkg@newVersion` aggiorna la dipendenza e la versione nel lockfile.
- Le impostazioni esistenti vengono preservate; la voce di stato viene sovrascritta per versione/feature/abilitazione.
- Non esiste una logica separata di "verifica aggiornamenti" o migrazione transazionale.

## Flusso di rimozione (`PluginManager.uninstall`)

1. Validazione del nome del pacchetto.
2. Esecuzione di `bun uninstall <name>` nella directory dei plugin.
3. Rimozione dello stato runtime del plugin dal lockfile:
   - `config.plugins[name]`
   - `config.settings[name]`

Se il comando di disinstallazione fallisce, lo stato runtime non viene modificato.

## Flusso di elenco (`PluginManager.list`)

1. Lettura della mappa delle dipendenze dei plugin da `~/.xcsh/plugins/package.json`.
2. Caricamento della configurazione runtime dal lockfile (file mancante -> valori predefiniti vuoti).
3. Caricamento delle sovrascritture del progetto (`<cwd>/.xcsh/plugin-overrides.json`, errori di parsing/lettura -> oggetto vuoto con avviso).
4. Per ogni dipendenza con un package.json risolvibile:
   - costruzione del record `InstalledPlugin`
   - unione dello stato feature/abilitazione:
     - base dal lockfile (o valori predefiniti)
     - le sovrascritture del progetto possono sostituire la selezione delle feature
     - la lista `disabled` del progetto maschera il plugin come disabilitato

Questo è lo stato effettivo utilizzato dall'output di stato della CLI e dalle operazioni su impostazioni/feature.

## Flusso di collegamento (`PluginManager.link`)

`link` supporta lo sviluppo locale dei plugin creando un symlink di un pacchetto locale in `~/.xcsh/plugins/node_modules/<pkg.name>`.

Comportamento:

1. Risoluzione di `localPath` rispetto alla cwd del manager.
2. Richiesta di `package.json` locale e del campo `name`.
3. Creazione delle directory dei plugin se necessario.
4. Per nomi con scope, creazione della directory dello scope.
5. Rimozione del percorso esistente nella posizione target del link.
6. Creazione del symlink.
7. Aggiunta della voce nel lockfile runtime abilitata con feature predefinite (`null`).

Avvertenza: l'attuale `PluginManager.link` non applica il controllo di confine del percorso `cwd` presente nel legacy `installer.ts` (`normalizedPath.startsWith(normalizedCwd)`), quindi la fiducia è responsabilità del chiamante.

## Caricamento runtime: dal plugin installato alle capacità invocabili

## Gate di scoperta

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) legge:

- manifesto delle dipendenze dei plugin (`package.json`)
- stato runtime dal lockfile
- sovrascritture del progetto tramite `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

Filtraggio:

- ignora se non esiste il package.json del plugin
- ignora se il manifesto (`xcsh`/`pi`) è assente
- ignora se disabilitato globalmente nel lockfile
- ignora se disabilitato dal progetto

## Risoluzione dei percorsi delle capacità

Per ogni plugin abilitato:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

Ogni resolver include voci base più voci delle feature:

- lista esplicita di feature -> solo le feature selezionate
- `enabledFeatures === null` -> abilita le feature contrassegnate con `default: true`

I file mancanti vengono silenziosamente ignorati (guard `existsSync`).

## Differenze nell'attuale cablaggio runtime

- **Gli strumenti sono cablati nel runtime oggi** tramite `discoverAndLoadCustomTools` (`custom-tools/loader.ts`), che chiama `getAllPluginToolPaths(cwd)`.
- I percorsi vengono deduplicati per percorso assoluto risolto nella scoperta degli strumenti personalizzati (set `seen`, il primo percorso vince).
- **I resolver per hook/comandi esistono** e sono esportati, ma questo percorso di codice attualmente non li collega a un registro runtime nello stesso modo in cui gli strumenti sono collegati.

## Dettagli della gestione lock/stato

`PluginManager` memorizza in cache la configurazione runtime in memoria per istanza (`#runtimeConfig`) e la carica pigramente una sola volta.

Comportamento di caricamento:

- lockfile mancante -> `{ plugins: {}, settings: {} }`
- fallimento di lettura/parsing del lockfile -> avviso + stessi valori predefiniti vuoti

Comportamento di salvataggio:

- scrive l'intero JSON del lockfile con formattazione pretty-printed ad ogni mutazione

Non esiste alcun locking inter-processo o strategia di merge; scritture concorrenti possono sovrascriversi a vicenda.

## Controlli di sicurezza e confini di fiducia

## Validazione input/pacchetto

Il percorso attivo del manager applica la validazione del nome del pacchetto:

- regex per specifiche di pacchetto con scope/senza scope (opzionalmente con versione)
- denylist esplicita di metacaratteri shell (`[;&|`$(){}[]<>\\]`)

Questo limita il rischio di command-injection quando si invoca `bun install/uninstall`.

## Confine di fiducia del filesystem

- Il codice del plugin viene eseguito in-process quando i moduli degli strumenti personalizzati vengono importati; nessun sandboxing.
- I percorsi relativi del manifesto vengono uniti alla directory del pacchetto plugin e viene verificata solo l'esistenza.
- Il pacchetto plugin stesso è considerato codice fidato una volta installato.

## Controlli esclusivi dell'installer legacy

`installer.ts` include controlli aggiuntivi al momento del link non replicati in `PluginManager.link`:

- il percorso locale deve risolversi all'interno della cwd del progetto
- protezioni extra contro la traversata del nome del pacchetto/percorso per la denominazione del target del symlink

Poiché la CLI utilizza `PluginManager`, queste protezioni più rigorose per il link non sono attualmente nel percorso principale.

## Comportamento in caso di fallimento, successo parziale e rollback

Il plugin manager non è transazionale.

| Fase dell'operazione | Comportamento in caso di fallimento | Rollback |
| --- | --- | --- |
| `bun install` fallisce | l'installazione si interrompe con stderr | N/D (nessuna scrittura di stato ancora) |
| L'installazione riesce, poi la validazione manifesto/feature fallisce | il comando fallisce | Nessun rollback della disinstallazione; la dipendenza potrebbe rimanere in `node_modules`/`package.json` |
| L'installazione riesce, poi la scrittura del lockfile fallisce | il comando fallisce | Nessun rollback del pacchetto installato |
| `bun uninstall` riesce, la scrittura del lockfile fallisce | il comando fallisce | Pacchetto rimosso, lo stato runtime obsoleto potrebbe rimanere |
| `link` rimuove il vecchio target poi la creazione del symlink fallisce | il comando fallisce | Nessun ripristino del link/directory precedente |

Operativamente, `doctor --fix` può riparare alcune discrepanze (`bun install`, pulizia della configurazione orfana, pulizia delle feature non valide), ma funziona su base best-effort.

## Riepilogo del comportamento con manifesto malformato/mancante

- Campo `xcsh`/`pi` mancante:
  - installazione/elenco: tollerato (manifesto minimale)
  - scoperta runtime dei plugin abilitati: ignorato come non-plugin
- Feature mancante referenziata dalla specifica di installazione o `features --set/--enable`: errore fatale con lista delle feature disponibili
- `plugin-overrides.json` non valido: ignorato con fallback a `{}` sia nei percorsi del manager che del loader
- Percorsi file di tool/hook/comando mancanti referenziati dal manifesto: ignorati silenziosamente durante l'espansione del resolver; segnalati come errori solo da `doctor`

## Differenze di modalità e precedenza

- `--dry-run` (installazione): restituisce un risultato di installazione sintetico, nessuna scrittura su filesystem/rete/stato.
- `--json`: solo formattazione dell'output, nessun cambiamento di comportamento.
- Le sovrascritture del progetto hanno sempre la precedenza sul lockfile globale per la visualizzazione di feature/impostazioni.
- L'abilitazione effettiva è `runtimeEnabled && !projectDisabled`.

## File di implementazione

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — Dichiarazione del comando CLI e mappatura dei flag
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — Dispatch delle azioni, gestori dei comandi rivolti all'utente
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — Implementazione attiva di install/remove/list/link/state/doctor
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — Helper dell'installer legacy e controlli di sicurezza aggiuntivi per il link
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — Scoperta dei plugin abilitati e risoluzione dei percorsi tool/hook/comando
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — Helper per il parsing delle specifiche di installazione e dei nomi dei pacchetti
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — Contratti di tipo per manifesto/runtime/sovrascritture
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — Cablaggio runtime per i moduli degli strumenti forniti dai plugin
