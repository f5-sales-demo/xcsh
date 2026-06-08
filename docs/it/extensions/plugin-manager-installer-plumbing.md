---
title: Plugin Manager and Installer Plumbing
description: >-
  Meccanismi interni del gestore dei plugin che coprono installazione,
  validazione, risoluzione delle dipendenze e gestione del ciclo di vita.
sidebar:
  order: 5
  label: Gestore dei plugin
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# Meccanismi del gestore dei plugin e dell'installer

Questo documento descrive come le operazioni `xcsh plugin` modificano lo stato dei plugin su disco e come i plugin installati diventano funzionalità runtime (attualmente tool, risoluzione dei percorsi per hook/comandi disponibile).

## Ambito e architettura

Nel codebase esistono due implementazioni di gestione dei plugin:

1. **Percorso attivo utilizzato dai comandi CLI**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **Modulo helper legacy**: funzioni dell'installer (`src/extensibility/plugins/installer.ts`)

L'esecuzione del comando `xcsh plugin ...` passa attraverso `PluginManager`.

`installer.ts` documenta ancora importanti controlli di sicurezza e comportamento del filesystem, ma non è il percorso utilizzato da `src/commands/plugin.ts` + `src/cli/plugin-cli.ts`.

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
- Non esiste un'azione `update` esplicita; l'aggiornamento si effettua rieseguendo `install` con un nuovo pacchetto/specifica di versione.

## Modello su disco

Lo stato globale dei plugin risiede in `~/.xcsh/plugins`:

- `package.json` — manifesto delle dipendenze utilizzato da `bun install`/`bun uninstall`
- `node_modules/` — pacchetti plugin installati o symlink
- `xcsh-plugins.lock.json` — stato runtime:
  - abilitato/disabilitato per plugin
  - set di funzionalità selezionato per plugin
  - impostazioni persistenti del plugin

Le sovrascritture locali al progetto risiedono in:

- `<cwd>/.xcsh/plugin-overrides.json`

Le sovrascritture sono in sola lettura dal punto di vista del gestore/loader (nessun percorso di scrittura qui) e possono disabilitare plugin o sovrascrivere funzionalità/impostazioni per il progetto corrente.

## Parsing delle specifiche del plugin e interpretazione dei metadati

## Grammatica delle specifiche di installazione

`parsePluginSpec` (`parser.ts`) supporta:

- `pkg` -> `features: null` (comportamento predefinito)
- `pkg[*]` -> abilita tutte le funzionalità del manifesto
- `pkg[]` -> non abilita funzionalità opzionali
- `pkg[a,b]` -> abilita funzionalità nominate
- `@scope/pkg@1.2.3[feat]` -> pacchetto con scope + versione con selezione esplicita delle funzionalità

`extractPackageName` rimuove il suffisso di versione per la ricerca del percorso su disco dopo l'installazione.

## Sorgente del manifesto e campi obbligatori

Il manifesto viene risolto come:

1. `package.json.xcsh`
2. fallback `package.json.pi`
3. fallback `{ version: package.version }`

Implicazioni:

- Non esiste una validazione rigorosa dello schema nel gestore/loader.
- Un pacchetto privo di `xcsh`/`pi` è comunque installabile e listabile.
- Il caricamento runtime dei plugin (`getEnabledPlugins`) salta i pacchetti senza manifesto `xcsh`/`pi`.
- `manifest.version` viene sempre sovrascritto dalla `version` del pacchetto.

Un `package.json` con JSON malformato è un errore fatale in fase di lettura; una forma malformata del manifesto può fallire successivamente solo quando vengono consumati campi specifici.

## Flusso di installazione/aggiornamento (`PluginManager.install`)

1. Parsing della sintassi a parentesi per le funzionalità dalla specifica di installazione.
2. Validazione del nome del pacchetto tramite regex + denylist di metacaratteri shell.
3. Verifica dell'esistenza del `package.json` del plugin (`xcsh-plugins`, mappa delle dipendenze private).
4. Esecuzione di `bun install <packageSpec>` in `~/.xcsh/plugins`.
5. Lettura del `node_modules/<name>/package.json` del pacchetto installato.
6. Risoluzione del manifesto e calcolo di `enabledFeatures`:
   - `[*]`: tutte le funzionalità dichiarate (o `null` se non esiste mappa delle funzionalità)
   - `[a,b]`: validazione dell'esistenza di ciascuna funzionalità nella mappa delle funzionalità del manifesto
   - `[]`: lista vuota di funzionalità
   - specifica semplice: `null` (viene utilizzata la politica predefinita successivamente nel loader)
7. Upsert dello stato runtime nel lockfile: `{ version, enabledFeatures, enabled: true }`.

### Semantica dell'aggiornamento

Poiché l'aggiornamento è guidato dall'installazione:

- `xcsh plugin install pkg@newVersion` aggiorna la dipendenza e la versione nel lockfile.
- Le impostazioni esistenti vengono preservate; la voce di stato viene sovrascritta per versione/funzionalità/abilitazione.
- Non esiste una logica separata di "verifica aggiornamenti" o di migrazione transazionale.

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
3. Caricamento delle sovrascritture di progetto (`<cwd>/.xcsh/plugin-overrides.json`, errori di parsing/lettura -> oggetto vuoto con avviso).
4. Per ogni dipendenza con un package.json risolvibile:
   - costruzione del record `InstalledPlugin`
   - unione dello stato funzionalità/abilitazione:
     - base dal lockfile (o valori predefiniti)
     - le sovrascritture di progetto possono sostituire la selezione delle funzionalità
     - la lista `disabled` del progetto maschera il plugin come disabilitato

Questo è lo stato effettivo utilizzato dall'output di stato della CLI e dalle operazioni di impostazioni/funzionalità.

## Flusso di link (`PluginManager.link`)

`link` supporta lo sviluppo locale dei plugin creando un symlink di un pacchetto locale in `~/.xcsh/plugins/node_modules/<pkg.name>`.

Comportamento:

1. Risoluzione di `localPath` rispetto al cwd del gestore.
2. Richiesta del `package.json` locale e del campo `name`.
3. Verifica dell'esistenza delle directory dei plugin.
4. Per nomi con scope, creazione della directory di scope.
5. Rimozione del percorso esistente nella posizione di destinazione del link.
6. Creazione del symlink.
7. Aggiunta della voce nel lockfile runtime abilitata con funzionalità predefinite (`null`).

Avvertenza: l'attuale `PluginManager.link` non applica il controllo di confine del percorso `cwd` presente nel legacy `installer.ts` (`normalizedPath.startsWith(normalizedCwd)`), quindi la fiducia è responsabilità del chiamante.

## Caricamento runtime: dal plugin installato alle funzionalità invocabili

## Gate di discovery

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) legge:

- manifesto delle dipendenze dei plugin (`package.json`)
- stato runtime del lockfile
- sovrascritture di progetto tramite `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

Filtraggio:

- salta se non esiste il package.json del plugin
- salta se il manifesto (`xcsh`/`pi`) è assente
- salta se globalmente disabilitato nel lockfile
- salta se disabilitato dal progetto

## Risoluzione dei percorsi delle funzionalità

Per ogni plugin abilitato:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

Ogni resolver include voci base più voci delle funzionalità:

- lista esplicita di funzionalità -> solo le funzionalità selezionate
- `enabledFeatures === null` -> abilita le funzionalità contrassegnate come `default: true`

I file mancanti vengono silenziosamente saltati (guardia `existsSync`).

## Differenze nell'attuale collegamento runtime

- **I tool sono attualmente collegati al runtime** tramite `discoverAndLoadCustomTools` (`custom-tools/loader.ts`), che chiama `getAllPluginToolPaths(cwd)`.
- I percorsi vengono deduplicati per percorso assoluto risolto nella discovery dei tool personalizzati (set `seen`, il primo percorso ha la precedenza).
- **I resolver per hook/comandi esistono** e sono esportati, ma questo percorso di codice attualmente non li collega a un registro runtime nello stesso modo in cui i tool sono collegati.

## Dettagli sulla gestione del lock/stato

`PluginManager` memorizza in cache la configurazione runtime in memoria per istanza (`#runtimeConfig`) e la carica in modo lazy una sola volta.

Comportamento di caricamento:

- lockfile mancante -> `{ plugins: {}, settings: {} }`
- errore di lettura/parsing del lockfile -> avviso + stessi valori predefiniti vuoti

Comportamento di salvataggio:

- scrive l'intero lockfile JSON formattato con indentazione ad ogni mutazione

Non esiste alcun meccanismo di locking tra processi o strategia di merge; scrittori concorrenti possono sovrascriversi a vicenda.

## Controlli di sicurezza e confini di fiducia

## Validazione dell'input/pacchetto

Il percorso attivo del gestore applica la validazione del nome del pacchetto:

- regex per specifiche di pacchetto con e senza scope (opzionalmente con versione)
- denylist esplicita di metacaratteri shell (`[;&|`$(){}[]<>\\]`)

Questo limita il rischio di command-injection durante l'invocazione di `bun install/uninstall`.

## Confine di fiducia del filesystem

- Il codice del plugin viene eseguito in-process quando i moduli dei tool personalizzati vengono importati; nessun sandboxing.
- I percorsi relativi del manifesto vengono uniti alla directory del pacchetto del plugin e viene verificata solo l'esistenza.
- Il pacchetto del plugin stesso è considerato codice fidato una volta installato.

## Controlli esclusivi dell'installer legacy

`installer.ts` include controlli aggiuntivi in fase di link non replicati in `PluginManager.link`:

- il percorso locale deve risolversi all'interno del cwd del progetto
- guardie aggiuntive contro il traversamento di percorsi/nomi per la denominazione del target del symlink

Poiché la CLI utilizza `PluginManager`, queste guardie di link più rigide non sono attualmente sul percorso principale.

## Comportamento in caso di errore, successo parziale e rollback

Il gestore dei plugin non è transazionale.

| Fase dell'operazione | Comportamento in caso di errore | Rollback |
| --- | --- | --- |
| `bun install` fallisce | l'installazione si interrompe con stderr | N/A (nessuna scrittura di stato ancora) |
| L'installazione ha successo, poi la validazione del manifesto/funzionalità fallisce | il comando fallisce | Nessun rollback della disinstallazione; la dipendenza potrebbe rimanere in `node_modules`/`package.json` |
| L'installazione ha successo, poi la scrittura del lockfile fallisce | il comando fallisce | Nessun rollback del pacchetto installato |
| `bun uninstall` ha successo, la scrittura del lockfile fallisce | il comando fallisce | Pacchetto rimosso, lo stato runtime obsoleto potrebbe persistere |
| `link` rimuove il target precedente poi la creazione del symlink fallisce | il comando fallisce | Nessun ripristino del link/directory precedente |

Operativamente, `doctor --fix` può riparare alcune derive (`bun install`, pulizia di configurazioni orfane, pulizia di funzionalità non valide), ma è un approccio best-effort.

## Riepilogo del comportamento con manifesto malformato/mancante

- Campo `xcsh`/`pi` mancante:
  - install/list: tollerato (manifesto minimale)
  - discovery dei plugin abilitati runtime: saltato come non-plugin
- Funzionalità mancante referenziata dalla specifica di installazione o `features --set/--enable`: errore fatale con lista delle funzionalità disponibili
- `plugin-overrides.json` non valido: ignorato con fallback a `{}` sia nel percorso del gestore che del loader
- Percorsi di file tool/hook/comando mancanti referenziati dal manifesto: ignorati silenziosamente durante l'espansione del resolver; segnalati come errori solo da `doctor`

## Differenze di modalità e precedenza

- `--dry-run` (install): restituisce un risultato di installazione sintetico, nessuna scrittura su filesystem/rete/stato.
- `--json`: solo formattazione dell'output, nessun cambiamento di comportamento.
- Le sovrascritture di progetto hanno sempre la precedenza sul lockfile globale per la vista funzionalità/impostazioni.
- L'abilitazione effettiva è `runtimeEnabled && !projectDisabled`.

## File di implementazione

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — Dichiarazione dei comandi CLI e mappatura dei flag
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — Dispatch delle azioni, handler dei comandi rivolti all'utente
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — Implementazione attiva di install/remove/list/link/state/doctor
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — Helper dell'installer legacy e controlli aggiuntivi di sicurezza per il link
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — Discovery dei plugin abilitati e risoluzione dei percorsi tool/hook/comandi
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — Helper per il parsing delle specifiche di installazione e dei nomi dei pacchetti
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — Contratti di tipo per manifesto/runtime/sovrascritture
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — Collegamento runtime per i moduli tool forniti dai plugin
