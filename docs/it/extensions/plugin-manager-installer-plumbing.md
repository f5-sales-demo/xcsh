---
title: Gestione dei plugin e meccanismi di installazione
description: >-
  Meccanismi interni del gestore di plugin che coprono installazione,
  validazione, risoluzione delle dipendenze e gestione del ciclo di vita.
sidebar:
  order: 5
  label: Gestore dei plugin
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# Gestore dei plugin e meccanismi di installazione

Questo documento descrive come le operazioni `xcsh plugin` modificano lo stato dei plugin su disco e come i plugin installati diventano funzionalità disponibili a runtime (oggi come strumenti, con risoluzione del percorso per hook/comandi disponibile).

## Ambito e architettura

Nel codice sono presenti due implementazioni di gestione dei plugin:

1. **Percorso attivo utilizzato dai comandi CLI**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **Modulo helper legacy**: funzioni di installazione (`src/extensibility/plugins/installer.ts`)

L'esecuzione del comando `xcsh plugin ...` passa attraverso `PluginManager`.

`installer.ts` documenta ancora importanti controlli di sicurezza e comportamenti del filesystem, ma non è il percorso utilizzato da `src/commands/plugin.ts` + `src/cli/plugin-cli.ts`.

## Ciclo di vita: dall'invocazione CLI alla disponibilità a runtime

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

- `src/commands/plugin.ts` definisce i comandi/flag e li inoltra a `runPluginCommand`.
- `src/cli/plugin-cli.ts` mappa i sottocomandi ai metodi di `PluginManager`:
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- Non esiste un'azione esplicita `update`; l'aggiornamento avviene rieseguendo `install` con una nuova specifica di pacchetto/versione.

## Modello su disco

Lo stato globale dei plugin risiede in `~/.xcsh/plugins`:

- `package.json` — manifesto delle dipendenze utilizzato da `bun install`/`bun uninstall`
- `node_modules/` — pacchetti plugin installati o symlink
- `xcsh-plugins.lock.json` — stato a runtime:
  - abilitato/disabilitato per ciascun plugin
  - set di funzionalità selezionato per ciascun plugin
  - impostazioni persistite del plugin

Le sovrascritture locali al progetto si trovano in:

- `<cwd>/.xcsh/plugin-overrides.json`

Le sovrascritture sono in sola lettura dal punto di vista del gestore/caricatore (nessun percorso di scrittura qui) e possono disabilitare plugin o sovrascrivere funzionalità/impostazioni per questo progetto.

## Analisi delle specifiche dei plugin e interpretazione dei metadati

## Grammatica delle specifiche di installazione

`parsePluginSpec` (`parser.ts`) supporta:

- `pkg` -> `features: null` (comportamento predefinito)
- `pkg[*]` -> abilita tutte le funzionalità del manifesto
- `pkg[]` -> non abilitare funzionalità opzionali
- `pkg[a,b]` -> abilita le funzionalità specificate per nome
- `@scope/pkg@1.2.3[feat]` -> pacchetto con scope e versione con selezione esplicita delle funzionalità

`extractPackageName` rimuove il suffisso di versione per la ricerca del percorso su disco dopo l'installazione.

## Sorgente del manifesto e campi obbligatori

Il manifesto viene risolto come segue:

1. `package.json.xcsh`
2. fallback `package.json.pi`
3. fallback `{ version: package.version }`

Implicazioni:

- Non esiste una validazione strict dello schema nel gestore/caricatore.
- Un pacchetto privo di manifesto `xcsh`/`pi` è comunque installabile ed elencabile.
- Il caricamento del plugin a runtime (`getEnabledPlugins`) salta i pacchetti privi di manifesto `xcsh`/`pi`.
- `manifest.version` viene sempre sovrascritto dalla `version` del pacchetto.

Un JSON `package.json` malformato è un errore bloccante al momento della lettura; una struttura del manifesto malformata potrebbe fallire in seguito solo quando vengono consumati campi specifici.

## Flusso di installazione/aggiornamento (`PluginManager.install`)

1. Analizzare la sintassi delle parentesi per le funzionalità dalla specifica di installazione.
2. Validare il nome del pacchetto tramite regex + lista di esclusione dei metacaratteri shell.
3. Verificare che esista il `package.json` del plugin (`xcsh-plugins`, mappa delle dipendenze private).
4. Eseguire `bun install <packageSpec>` in `~/.xcsh/plugins`.
5. Leggere il `package.json` del pacchetto installato in `node_modules/<name>/package.json`.
6. Risolvere il manifesto e calcolare `enabledFeatures`:
   - `[*]`: tutte le funzionalità dichiarate (o `null` se non è presente una mappa di funzionalità)
   - `[a,b]`: valida che ogni funzionalità esista nella mappa delle funzionalità del manifesto
   - `[]`: lista di funzionalità vuota
   - specifica senza parentesi: `null` (utilizzare in seguito la policy dei valori predefiniti nel caricatore)
7. Aggiornare o inserire lo stato a runtime nel lockfile: `{ version, enabledFeatures, enabled: true }`.

### Semantica degli aggiornamenti

Poiché l'aggiornamento è guidato dall'installazione:

- `xcsh plugin install pkg@newVersion` aggiorna la dipendenza e la versione nel lockfile.
- Le impostazioni esistenti vengono preservate; la voce dello stato viene sovrascritta per versione/funzionalità/abilitazione.
- Non esiste logica separata per "verificare aggiornamenti" o per la migrazione transazionale.

## Flusso di rimozione (`PluginManager.uninstall`)

1. Validare il nome del pacchetto.
2. Eseguire `bun uninstall <name>` nella directory dei plugin.
3. Rimuovere lo stato a runtime del plugin dal lockfile:
   - `config.plugins[name]`
   - `config.settings[name]`

Se il comando di disinstallazione fallisce, lo stato a runtime non viene modificato.

## Flusso di elenco (`PluginManager.list`)

1. Leggere la mappa delle dipendenze dei plugin da `~/.xcsh/plugins/package.json`.
2. Caricare la configurazione a runtime dal lockfile (file mancante -> valori predefiniti vuoti).
3. Caricare le sovrascritture del progetto (`<cwd>/.xcsh/plugin-overrides.json`, errori di analisi/lettura -> oggetto vuoto con avviso).
4. Per ogni dipendenza con un `package.json` risolvibile:
   - costruire il record `InstalledPlugin`
   - unire lo stato di funzionalità/abilitazione:
     - base dal lockfile (o valori predefiniti)
     - le sovrascritture del progetto possono sostituire la selezione delle funzionalità
     - la lista `disabled` del progetto maschera il plugin come disabilitato

Questo è lo stato effettivo utilizzato dall'output dello stato CLI e dalle operazioni su impostazioni/funzionalità.

## Flusso di collegamento (`PluginManager.link`)

`link` supporta lo sviluppo locale di plugin creando un symlink di un pacchetto locale in `~/.xcsh/plugins/node_modules/<pkg.name>`.

Comportamento:

1. Risolvere `localPath` rispetto alla directory di lavoro del gestore.
2. Richiedere la presenza di `package.json` e del campo `name` locali.
3. Verificare che le directory dei plugin esistano.
4. Per nomi con scope, creare la directory dello scope.
5. Rimuovere il percorso esistente nella posizione del link di destinazione.
6. Creare il symlink.
7. Aggiungere la voce nel lockfile a runtime abilitata con le funzionalità predefinite (`null`).

Avvertenza: l'attuale `PluginManager.link` non applica il controllo dei limiti del percorso `cwd` presente nel legacy `installer.ts` (`normalizedPath.startsWith(normalizedCwd)`), pertanto la fiducia è responsabilità del chiamante.

## Caricamento a runtime: dal plugin installato alle funzionalità disponibili

## Gate di scoperta

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) legge:

- il manifesto delle dipendenze del plugin (`package.json`)
- lo stato a runtime del lockfile
- le sovrascritture del progetto tramite `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

Filtraggio:

- salta se non è presente il package.json del plugin
- salta se il manifesto (`xcsh`/`pi`) è assente
- salta se globalmente disabilitato nel lockfile
- salta se disabilitato dal progetto

## Risoluzione del percorso delle funzionalità

Per ogni plugin abilitato:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

Ogni resolver include voci base più voci delle funzionalità:

- lista di funzionalità esplicita -> solo le funzionalità selezionate
- `enabledFeatures === null` -> abilita le funzionalità contrassegnate con `default: true`

I file mancanti vengono ignorati silenziosamente (guardia `existsSync`).

## Differenze attuali nel cablaggio a runtime

- **Gli strumenti sono cablati nel runtime oggi** tramite `discoverAndLoadCustomTools` (`custom-tools/loader.ts`), che chiama `getAllPluginToolPaths(cwd)`.
- I percorsi vengono deduplicati in base al percorso assoluto risolto nella scoperta degli strumenti personalizzati (insieme `seen`, vince il primo percorso).
- **I resolver per hook/comandi esistono** e sono esportati, ma questo percorso di codice non li cablature attualmente in un registro a runtime nello stesso modo in cui vengono cablati gli strumenti.

## Dettagli di gestione del lock/stato

`PluginManager` memorizza nella cache la configurazione a runtime in memoria per istanza (`#runtimeConfig`) e la carica in modo lazy una sola volta.

Comportamento di caricamento:

- lockfile mancante -> `{ plugins: {}, settings: {} }`
- errore di lettura/analisi del lockfile -> avviso + stessi valori predefiniti vuoti

Comportamento di salvataggio:

- scrive l'intero JSON del lockfile con formattazione pretty-print ad ogni mutazione

Non esiste alcun meccanismo di blocco tra processi o strategia di merge; scrittori concorrenti possono sovrascriversi a vicenda.

## Controlli di sicurezza e limiti di fiducia

## Validazione dell'input/pacchetto

Il percorso del gestore attivo applica la validazione del nome del pacchetto:

- regex per specifiche di pacchetto con e senza scope (opzionalmente con versione)
- lista esplicita di esclusione dei metacaratteri shell (`[;&|`$(){}[]<>\\]`)

Questo limita il rischio di command injection quando si invoca `bun install/uninstall`.

## Limite di fiducia del filesystem

- Il codice del plugin viene eseguito in-process quando i moduli degli strumenti personalizzati vengono importati; nessun sandboxing.
- I percorsi relativi del manifesto vengono congiunti alla directory del pacchetto plugin e viene verificata solo la loro esistenza.
- Il pacchetto plugin stesso è codice fidato una volta installato.

## Controlli esclusivi del legacy installer

`installer.ts` include controlli aggiuntivi al momento del collegamento non presenti in `PluginManager.link`:

- il percorso locale deve essere risolto all'interno della directory di lavoro del progetto
- guardie aggiuntive per il nome del pacchetto e la traversata del percorso per la denominazione del target del symlink

Poiché la CLI utilizza `PluginManager`, queste guardie di collegamento più restrittive non sono attualmente nel percorso principale.

## Comportamento in caso di errore, successo parziale e rollback

Il gestore dei plugin non è transazionale.

| Fase dell'operazione | Comportamento in caso di errore | Rollback |
| --- | --- | --- |
| `bun install` fallisce | l'installazione si interrompe con stderr | N/A (nessuna scrittura di stato ancora) |
| Installazione riuscita, poi la validazione del manifesto/funzionalità fallisce | il comando fallisce | Nessun rollback della disinstallazione; la dipendenza potrebbe rimanere in `node_modules`/`package.json` |
| Installazione riuscita, poi la scrittura del lockfile fallisce | il comando fallisce | Nessun rollback del pacchetto installato |
| `bun uninstall` riuscito, scrittura del lockfile fallisce | il comando fallisce | Pacchetto rimosso, lo stato a runtime obsoleto potrebbe rimanere |
| `link` rimuove il target precedente poi la creazione del symlink fallisce | il comando fallisce | Nessun ripristino del link/directory precedente |

Dal punto di vista operativo, `doctor --fix` può riparare alcune discrepanze (`bun install`, pulizia delle configurazioni orfane, pulizia delle funzionalità non valide), ma è un tentativo best-effort.

## Riepilogo del comportamento con manifesto malformato/mancante

- Campo `xcsh`/`pi` mancante:
  - installazione/elenco: tollerato (manifesto minimale)
  - scoperta dei plugin abilitati a runtime: ignorato come non-plugin
- Funzionalità mancante referenziata dalla specifica di installazione o da `features --set/--enable`: errore bloccante con lista delle funzionalità disponibili
- `plugin-overrides.json` non valido: ignorato con fallback a `{}` sia nel percorso del gestore che del caricatore
- Percorsi di file strumenti/hook/comandi mancanti referenziati dal manifesto: ignorati silenziosamente durante l'espansione del resolver; segnalati come errori solo da `doctor`

## Differenze di modalità e precedenza

- `--dry-run` (install): restituisce un risultato di installazione sintetico, nessuna scrittura su filesystem/rete/stato.
- `--json`: solo formattazione dell'output, nessun cambiamento di comportamento.
- Le sovrascritture del progetto hanno sempre la precedenza sul lockfile globale per la visualizzazione di funzionalità/impostazioni.
- L'abilitazione effettiva è `runtimeEnabled && !projectDisabled`.

## File di implementazione

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — dichiarazione del comando CLI e mappatura dei flag
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — dispatching delle azioni, gestori dei comandi rivolti all'utente
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — implementazione attiva di install/remove/list/link/state/doctor
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — helper legacy del installer e controlli di sicurezza aggiuntivi per il collegamento
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — scoperta dei plugin abilitati e risoluzione dei percorsi di strumenti/hook/comandi
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — helper per l'analisi delle specifiche di installazione e dei nomi dei pacchetti
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — contratti di tipo per manifesto/runtime/sovrascritture
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — cablaggio a runtime per i moduli degli strumenti forniti dai plugin
