---
title: Gestore dei plugin e meccanismi di installazione
description: >-
  Interni del gestore dei plugin che coprono installazione, validazione,
  risoluzione delle dipendenze e gestione del ciclo di vita.
sidebar:
  order: 5
  label: Gestore dei plugin
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# Gestore dei plugin e meccanismi di installazione

Questo documento descrive come le operazioni `xcsh plugin` modificano lo stato dei plugin su disco e come i plugin installati diventano capacità di runtime (strumenti oggi, risoluzione del percorso per hook/comandi disponibile).

## Ambito e architettura

Esistono due implementazioni di gestione dei plugin nel codebase:

1. **Percorso attivo utilizzato dai comandi CLI**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **Modulo helper legacy**: funzioni di installazione (`src/extensibility/plugins/installer.ts`)

L'esecuzione del comando `xcsh plugin ...` passa attraverso `PluginManager`.

`installer.ts` documenta ancora importanti controlli di sicurezza e comportamento del filesystem, ma non è il percorso utilizzato da `src/commands/plugin.ts` + `src/cli/plugin-cli.ts`.

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

- `src/commands/plugin.ts` definisce comandi/flag e delega a `runPluginCommand`.
- `src/cli/plugin-cli.ts` mappa i sottocomandi ai metodi di `PluginManager`:
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- Non esiste un'azione `update` esplicita; l'aggiornamento viene eseguito rieseguendo `install` con una nuova specifica di pacchetto/versione.

## Modello su disco

Lo stato globale dei plugin risiede in `~/.xcsh/plugins`:

- `package.json` — manifesto delle dipendenze utilizzato da `bun install`/`bun uninstall`
- `node_modules/` — pacchetti plugin installati o symlink
- `xcsh-plugins.lock.json` — stato di runtime:
  - abilitato/disabilitato per plugin
  - set di funzionalità selezionato per plugin
  - impostazioni persistite del plugin

Le sostituzioni locali al progetto risiedono in:

- `<cwd>/.xcsh/plugin-overrides.json`

Le sostituzioni sono di sola lettura dal punto di vista del gestore/loader (nessun percorso di scrittura qui) e possono disabilitare plugin o sovrascrivere funzionalità/impostazioni per questo progetto.

## Analisi della specifica del plugin e interpretazione dei metadati

## Grammatica della specifica di installazione

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

- Non esiste una validazione rigorosa dello schema nel gestore/loader.
- Un pacchetto privo di manifesto `xcsh`/`pi` è comunque installabile ed elencabile.
- Il caricamento del plugin a runtime (`getEnabledPlugins`) salta i pacchetti senza manifesto `xcsh`/`pi`.
- `manifest.version` viene sempre sovrascritto dalla `version` del pacchetto.

Un `package.json` JSON malformato è un errore critico al momento della lettura; una forma del manifesto malformata potrebbe fallire più tardi solo quando vengono consumati campi specifici.

## Flusso di installazione/aggiornamento (`PluginManager.install`)

1. Analizza la sintassi delle parentesi delle funzionalità dalla specifica di installazione.
2. Valida il nome del pacchetto contro regex + denylist di metacaratteri della shell.
3. Assicura che esista `package.json` del plugin (`xcsh-plugins`, mappa delle dipendenze private).
4. Esegue `bun install <packageSpec>` in `~/.xcsh/plugins`.
5. Legge il `node_modules/<name>/package.json` del pacchetto installato.
6. Risolve il manifesto e calcola `enabledFeatures`:
   - `[*]`: tutte le funzionalità dichiarate (o `null` se non esiste una mappa delle funzionalità)
   - `[a,b]`: valida che ogni funzionalità esista nella mappa delle funzionalità del manifesto
   - `[]`: lista di funzionalità vuota
   - specifica bare: `null` (usa la politica dei valori predefiniti in seguito nel loader)
7. Upsert dello stato di runtime nel lockfile: `{ version, enabledFeatures, enabled: true }`.

### Semantica dell'aggiornamento

Poiché l'aggiornamento è guidato dall'installazione:

- `xcsh plugin install pkg@newVersion` aggiorna la dipendenza e la versione nel lockfile.
- Le impostazioni esistenti vengono preservate; la voce di stato viene sovrascritta per versione/funzionalità/abilitazione.
- Non esiste una logica separata di "verifica aggiornamenti" o di migrazione transazionale.

## Flusso di rimozione (`PluginManager.uninstall`)

1. Valida il nome del pacchetto.
2. Esegue `bun uninstall <name>` nella directory del plugin.
3. Rimuove lo stato di runtime del plugin dal lockfile:
   - `config.plugins[name]`
   - `config.settings[name]`

Se il comando di disinstallazione fallisce, lo stato di runtime non viene modificato.

## Flusso di elenco (`PluginManager.list`)

1. Legge la mappa delle dipendenze del plugin da `~/.xcsh/plugins/package.json`.
2. Carica la configurazione di runtime dal lockfile (file mancante -> valori predefiniti vuoti).
3. Carica le sostituzioni del progetto (`<cwd>/.xcsh/plugin-overrides.json`, errori di analisi/lettura -> oggetto vuoto con avviso).
4. Per ogni dipendenza con un package.json risolvibile:
   - costruisce il record `InstalledPlugin`
   - unisce lo stato di funzionalità/abilitazione:
     - base dal lockfile (o valori predefiniti)
     - le sostituzioni del progetto possono sostituire la selezione delle funzionalità
     - la lista `disabled` del progetto maschera il plugin come disabilitato

Questo è lo stato effettivo utilizzato dall'output di stato della CLI e dalle operazioni di impostazioni/funzionalità.

## Flusso di collegamento (`PluginManager.link`)

`link` supporta lo sviluppo locale di plugin creando un symlink di un pacchetto locale in `~/.xcsh/plugins/node_modules/<pkg.name>`.

Comportamento:

1. Risolve `localPath` rispetto al cwd del gestore.
2. Richiede `package.json` locale e il campo `name`.
3. Assicura che le directory del plugin esistano.
4. Per i nomi con scope, crea la directory dello scope.
5. Rimuove il percorso esistente nella posizione del link di destinazione.
6. Crea il symlink.
7. Aggiunge una voce nel lockfile di runtime abilitata con funzionalità predefinite (`null`).

Avvertenza: l'attuale `PluginManager.link` non applica il controllo dei limiti del percorso `cwd` presente nel legacy `installer.ts` (`normalizedPath.startsWith(normalizedCwd)`), quindi la responsabilità della fiducia ricade sul chiamante.

## Caricamento a runtime: dal plugin installato alle capacità invocabili

## Gate di discovery

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) legge:

- manifesto delle dipendenze del plugin (`package.json`)
- stato di runtime del lockfile
- sostituzioni del progetto tramite `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

Filtraggio:

- salta se non esiste package.json del plugin
- salta se il manifesto (`xcsh`/`pi`) è assente
- salta se globalmente disabilitato nel lockfile
- salta se disabilitato dal progetto

## Risoluzione del percorso delle capacità

Per ogni plugin abilitato:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

Ogni resolver include voci base più voci delle funzionalità:

- lista di funzionalità esplicita -> solo le funzionalità selezionate
- `enabledFeatures === null` -> abilita le funzionalità contrassegnate come `default: true`

I file mancanti vengono ignorati silenziosamente (guardia `existsSync`).

## Differenze attuali nel cablaggio a runtime

- **Gli strumenti sono cablati nel runtime oggi** tramite `discoverAndLoadCustomTools` (`custom-tools/loader.ts`), che chiama `getAllPluginToolPaths(cwd)`.
- I percorsi vengono deduplicati per percorso assoluto risolto nella discovery degli strumenti personalizzati (insieme `seen`, vince il primo percorso).
- **I resolver di hook/comandi esistono** e vengono esportati, ma questo percorso del codice non li collega attualmente a un registro di runtime nello stesso modo in cui vengono collegati gli strumenti.

## Dettagli di gestione del lock/stato

`PluginManager` memorizza nella cache la configurazione di runtime in memoria per istanza (`#runtimeConfig`) e la carica in modo lazy una sola volta.

Comportamento di caricamento:

- lockfile mancante -> `{ plugins: {}, settings: {} }`
- errore di lettura/analisi del lockfile -> avviso + stessi valori predefiniti vuoti

Comportamento di salvataggio:

- scrive il JSON completo del lockfile con pretty-print ad ogni mutazione

Non esiste alcun blocco cross-process o strategia di merge; i writer concorrenti possono sovrascriversi a vicenda.

## Controlli di sicurezza e limiti di fiducia

## Validazione dell'input/del pacchetto

Il percorso del gestore attivo applica la validazione del nome del pacchetto:

- regex per specifiche di pacchetto con e senza scope (opzionalmente con versione)
- denylist esplicita di metacaratteri della shell (`[;&|`$(){}[]<>\\]`)

Ciò limita il rischio di command injection quando si invoca `bun install/uninstall`.

## Limite di fiducia del filesystem

- Il codice del plugin viene eseguito in-process quando i moduli dello strumento personalizzato vengono importati; nessun sandboxing.
- I percorsi relativi del manifesto vengono uniti alla directory del pacchetto del plugin e viene verificata solo la loro esistenza.
- Il pacchetto del plugin stesso è codice attendibile una volta installato.

## Controlli esclusivi dell'installer legacy

`installer.ts` include controlli aggiuntivi al momento del collegamento non replicati in `PluginManager.link`:

- il percorso locale deve risolvere all'interno del cwd del progetto
- guardie aggiuntive per nome del pacchetto/attraversamento del percorso per la denominazione del target del symlink

Poiché la CLI utilizza `PluginManager`, queste guardie di collegamento più rigide non si trovano attualmente sul percorso principale.

## Comportamento in caso di errore, successo parziale e rollback

Il gestore dei plugin non è transazionale.

| Fase dell'operazione | Comportamento in caso di errore | Rollback |
| --- | --- | --- |
| `bun install` fallisce | l'installazione si interrompe con stderr | N/A (nessuna scrittura di stato ancora) |
| L'installazione ha successo, poi la validazione del manifesto/delle funzionalità fallisce | il comando fallisce | Nessun rollback di disinstallazione; la dipendenza potrebbe rimanere in `node_modules`/`package.json` |
| L'installazione ha successo, poi la scrittura del lockfile fallisce | il comando fallisce | Nessun rollback del pacchetto installato |
| `bun uninstall` ha successo, la scrittura del lockfile fallisce | il comando fallisce | Il pacchetto viene rimosso, potrebbe rimanere uno stato di runtime non aggiornato |
| `link` rimuove il target precedente, poi la creazione del symlink fallisce | il comando fallisce | Nessun ripristino del link/directory precedente |

Operativamente, `doctor --fix` può riparare alcune derive (`bun install`, pulizia della configurazione orfana, pulizia delle funzionalità non valide), ma è best-effort.

## Riepilogo del comportamento in caso di manifesto malformato/mancante

- Campo `xcsh`/`pi` mancante:
  - install/list: tollerato (manifesto minimo)
  - discovery dei plugin abilitati a runtime: saltato come non-plugin
- Funzionalità mancante referenziata dalla specifica di installazione o da `features --set/--enable`: errore critico con lista delle funzionalità disponibili
- `plugin-overrides.json` non valido: ignorato con fallback a `{}` sia nel gestore che nei percorsi del loader
- Percorsi di file strumento/hook/comando mancanti referenziati dal manifesto: ignorati silenziosamente durante l'espansione del resolver; segnalati come errori solo da `doctor`

## Differenze di modalità e precedenza

- `--dry-run` (install): restituisce un risultato di installazione sintetico, nessuna scrittura su filesystem/rete/stato.
- `--json`: solo formattazione dell'output, nessun cambiamento di comportamento.
- Le sostituzioni del progetto hanno sempre la precedenza sul lockfile globale per la visualizzazione di funzionalità/impostazioni.
- L'abilitazione effettiva è `runtimeEnabled && !projectDisabled`.

## File di implementazione

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — dichiarazione del comando CLI e mappatura dei flag
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — dispatch delle azioni, handler dei comandi rivolti all'utente
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — implementazione attiva di install/remove/list/link/state/doctor
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — helper di installazione legacy e controlli di sicurezza aggiuntivi per il collegamento
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — discovery dei plugin abilitati e risoluzione dei percorsi di strumenti/hook/comandi
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — helper di analisi della specifica di installazione e del nome del pacchetto
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — contratti di tipo per manifesto/runtime/sostituzione
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — cablaggio a runtime per i moduli degli strumenti forniti dai plugin
