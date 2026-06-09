---
title: 'Porting da pi-mono: Una Guida Pratica al Merge'
description: Guida pratica per migrare il codice dal monorepo pi-mono nella codebase xcsh.
sidebar:
  order: 9
  label: Porting da pi-mono
i18n:
  sourceHash: dbba6f6c0987
  translator: machine
---

# Porting da pi-mono: Una Guida Pratica al Merge

Questa guida è una checklist ripetibile per il porting delle modifiche da pi-mono in questo repository.
Utilizzatela per qualsiasi merge: singolo file, feature branch o sincronizzazione completa di rilascio.

## Ultimo Punto di Sincronizzazione

**Commit:** `b21b42d032919de2f2e6920a76fa9a37c3920c0a`
**Data:** 2026-03-22

Aggiornate questa sezione dopo ogni sincronizzazione; non riutilizzate il range precedente.

Quando iniziate una nuova sincronizzazione, generate le patch da questo commit in avanti:

```bash
git format-patch b21b42d032919de2f2e6920a76fa9a37c3920c0a..HEAD --stdout > changes.patch
```

## 0) Definire l'ambito

- Identificate il riferimento upstream (commit, tag o PR).
- Elencate i pacchetti o le cartelle che intendete modificare.
- Decidete quali funzionalità sono nell'ambito e quali sono intenzionalmente escluse.

## 1) Portare il codice in sicurezza

- Preferite un diff pulito e focalizzato piuttosto che una copia all'ingrosso.
- Evitate di copiare artefatti di build o file generati.
- Se l'upstream ha aggiunto nuovi file, aggiungeteli esplicitamente e revisionate i contenuti.

## 2) Rispettare le convenzioni sulle estensioni degli import

La maggior parte dei sorgenti TypeScript runtime omette `.js` negli import interni, ma alcuni entrypoint di test/bench mantengono `.js` per la compatibilità runtime ESM. Seguite lo stile esistente del pacchetto locale; non rimuovete le estensioni in modo indiscriminato.

- Nei sorgenti runtime di `packages/coding-agent`, mantenete gli import interni senza estensione, a meno che non si importino asset non-TS.
- In `packages/tui/test` e `packages/natives/bench`, mantenete `.js` dove i file circostanti lo utilizzano già.
- Mantenete le estensioni reali dei file quando richiesto dagli strumenti (es. `.json`, `.css`, embed di testo `.md`).
- Esempio: `import { x } from "./foo.js";` → `import { x } from "./foo";` (solo quando la convenzione del pacchetto è senza estensione).

## 3) Sostituire gli scope degli import

L'upstream utilizza scope di pacchetto differenti. Sostituiteli in modo coerente.

- Sostituite i vecchi scope con lo scope locale utilizzato qui.
- Esempi (adattate in base ai pacchetti effettivi che state portando):
  - `@mariozechner/pi-coding-agent` → `@f5xc-salesdemos/xcsh`
  - `@mariozechner/pi-agent-core` → `@f5xc-salesdemos/pi-agent-core`
  - `@mariozechner/pi-tui` → `@f5xc-salesdemos/pi-tui`
  - `@mariozechner/pi-ai` → `@f5xc-salesdemos/pi-ai`

## 4) Utilizzare le API Bun dove migliorano rispetto a Node

Eseguiamo su Bun. Sostituite le API Node solo quando Bun fornisce un'alternativa migliore.

**SOSTITUITE:**

- Spawning di processi: `child_process.spawn` → Bun Shell `$` per comandi semplici, `Bun.spawn`/`Bun.spawnSync` per streaming o lavori di lunga durata
- I/O su file: `fs.readFileSync` → `Bun.file().text()` / `Bun.write()`
- Client HTTP: `node-fetch`, `axios` → `fetch` nativo
- Hashing crittografico: `node:crypto` → Web Crypto o `Bun.hash`
- SQLite: `better-sqlite3` → `bun:sqlite`
- Caricamento env: `dotenv` → Bun carica `.env` automaticamente

**NON SOSTITUITE (funzionano bene in Bun):**

- `os.homedir()` — NON sostituite con `Bun.env.HOME`, `Bun.env.HOME` o il letterale `"~"`
- `os.tmpdir()` — NON sostituite con `Bun.env.TMPDIR || "/tmp"` o percorsi hardcoded
- `fs.mkdtempSync()` — NON sostituite con costruzione manuale del percorso
- `path.join()`, `path.resolve()`, ecc. — vanno bene così

**Stile degli import:** Utilizzate il prefisso `node:` solo con import di namespace (nessun import nominato da `node:fs` o `node:path`).

**Convenzioni aggiuntive per Bun:**

- Preferite Bun Shell `$` per comandi brevi e non-streaming; utilizzate `Bun.spawn` solo quando necessitate di I/O in streaming o controllo del processo.
- Utilizzate `Bun.file()`/`Bun.write()` per i file e `node:fs/promises` per le directory.
- Evitate i controlli `Bun.file().exists()`; utilizzate la gestione `isEnoent` nel try/catch.
- Preferite `Bun.sleep(ms)` rispetto ai wrapper `setTimeout`.

**Sbagliato:**

```typescript
// BROKEN: env vars may be undefined, "~" is not expanded
const home = Bun.env.HOME || "~";
const tmp = Bun.env.TMPDIR || "/tmp";
```

**Corretto:**

```typescript
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

const configDir = path.join(os.homedir(), ".config", "myapp");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myapp-"));
```

## 5) Preferire gli embed Bun (niente copie)

Non copiate asset runtime o file vendor al momento del build.

- Se l'upstream copia asset in una cartella dist, sostituite con embed compatibili con Bun.
- I prompt sono file `.md` statici; utilizzate gli import di testo Bun (`with { type: "text" }`) e Handlebars invece di stringhe di prompt inline.
- Utilizzate `import.meta.dir` + `Bun.file` per caricare risorse non-testo adiacenti.
- Mantenete gli asset nel repository e lasciate che il bundler li includa.
- Eliminate gli script di copia a meno che l'utente non li richieda esplicitamente.
- Se l'upstream legge un file di fallback bundled a runtime, sostituite le letture del filesystem con un import embed di testo Bun.
  - Esempio (fallback istruzioni Codex):
    - `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "codex-instructions.md");` -> rimosso
    - `import FALLBACK_INSTRUCTIONS from "./codex-instructions.md" with { type: "text" };`
    - Utilizzate `return FALLBACK_INSTRUCTIONS;` invece di `readFileSync(FALLBACK_PROMPT_PATH, "utf8")`

## 6) Portare `package.json` con attenzione

Trattate `package.json` come un contratto. Effettuate il merge intenzionalmente.

- Mantenete `name`, `version`, `type`, `exports` e `bin` esistenti a meno che il porting non richieda modifiche.
- Sostituite gli script npm/node con equivalenti Bun (es. `bun check`, `bun test`).
- Assicuratevi che le dipendenze utilizzino lo scope corretto.
- Non effettuate downgrade delle dipendenze per risolvere errori di tipo; effettuate invece l'upgrade.
- Validate i link dei pacchetti workspace e le `peerDependencies`.

## 7) Allineare lo stile del codice e gli strumenti

- Mantenete le convenzioni di formattazione esistenti.
- Non introducete `any` a meno che non sia necessario.
- Evitate import dinamici e import di tipo inline; utilizzate solo import al livello superiore.
- Non costruite mai i prompt nel codice; i prompt sono file `.md` statici renderizzati con Handlebars.
- Nel coding-agent, non utilizzate mai `console.log`/`console.warn`/`console.error`; utilizzate `logger` da `@f5xc-salesdemos/pi-utils`.
- Utilizzate `Promise.withResolvers()` invece di `new Promise((resolve, reject) => ...)`.
- **Niente keyword `private`/`protected`/`public` sui campi o metodi delle classi.** Utilizzate i campi privati ES `#` per l'incapsulamento; lasciate i membri accessibili senza keyword. L'unica eccezione sono le proprietà dei parametri del costruttore (`constructor(private readonly x: T)`), dove la keyword è richiesta da TypeScript. Quando portate codice upstream che utilizza `private foo` o `protected bar`, convertite in `#foo` (privato) o `bar` senza keyword (accessibile).
- Preferite helper e utility esistenti rispetto a nuovo codice ad-hoc.
- Preservate le modifiche infrastrutturali Bun-first già effettuate in questo repository:
  - Il runtime è Bun (nessun entry point Node).
  - Il package manager è Bun (nessun lockfile npm).
  - Le API Node pesanti (`child_process`, `readline`) sono sostituite con equivalenti Bun.
  - Le API Node leggere (`os.homedir`, `os.tmpdir`, `fs.mkdtempSync`, `path.*`) sono mantenute.
  - Gli shebang CLI utilizzano `bun` (non `node`, non `tsx`).
  - I pacchetti utilizzano direttamente i file sorgente (nessun step di build TypeScript).
  - I workflow CI eseguono Bun per install/check/test.

## 8) Rimuovere i vecchi layer di compatibilità

A meno che non venga richiesto, rimuovete gli shim di compatibilità upstream.

- Eliminate le vecchie API che sono state sostituite.
- Aggiornate tutti i punti di chiamata direttamente alla nuova API.
- Non mantenete versioni `*_v2` o parallele.

## 9) Aggiornare documentazione e riferimenti

- Sostituite i link al repository pi-mono dove appropriato.
- Aggiornate gli esempi per utilizzare Bun e gli scope di pacchetto corretti.
- Assicuratevi che le istruzioni del README corrispondano ancora al comportamento attuale del repository.

## 10) Validare il porting

Eseguite i controlli standard dopo le modifiche:

- `bun check`

Se il repository ha già controlli falliti non correlati alle vostre modifiche, segnalatelo.
I test utilizzano il runner di Bun (non Vitest), ma eseguite `bun test` solo quando esplicitamente richiesto.

## 11) Proteggere le funzionalità migliorate (lista trappola per regressioni)

Se avete già migliorato un comportamento localmente, trattatelo come **non negoziabile**. Prima del porting, annotate
i miglioramenti e aggiungete controlli espliciti in modo che non vadano persi nel merge.

- **Congelate il comportamento atteso**: aggiungete una breve nota "prima/dopo" per ogni miglioramento (input, output,
  valori predefiniti, casi limite). Questo previene rollback silenziosi.
- **Mappate vecchie → nuove API**: se l'upstream ha rinominato concetti (hooks → extensions, custom tools → tools, ecc.),
  assicuratevi che ogni vecchio punto di ingresso sia ancora collegato. Un flag o un export mancato equivale a funzionalità persa.
- **Verificate gli export**: controllate gli `exports` del `package.json`, i tipi pubblici e i file barrel. I porting upstream spesso
  dimenticano di ri-esportare le aggiunte locali.
- **Coprite i percorsi non-happy**: se avete corretto la gestione degli errori, i timeout o la logica di fallback, aggiungete un test o
  almeno una checklist manuale che eserciti quei percorsi.
- **Controllate i valori predefiniti e l'ordine di merge della configurazione**: i miglioramenti spesso risiedono nei valori predefiniti. Confermate che i nuovi
  valori predefiniti non siano stati ripristinati (es. nuova precedenza di configurazione, funzionalità disabilitate, liste di tool).
- **Verificate il comportamento env/shell**: se avete corretto l'esecuzione o il sandboxing, verificate che il nuovo percorso utilizzi ancora il vostro
  env sanificato e non reintroduca override di alias/funzioni.
- **Ri-eseguite campioni mirati**: mantenete un set minimale di esempi "noti come funzionanti" e eseguiteli dopo il porting
  (flag CLI, registrazione estensioni, esecuzione tool).

## 12) Rilevare e gestire il codice rielaborato

Prima di portare un file, verificate se l'upstream lo ha significativamente refactorizzato:

```bash
# Compare the file you're about to port against what you have locally
git diff HEAD upstream/main -- path/to/file.ts
```

Se il diff mostra che il file è stato **rielaborato** (non solo patchato):

- Nuove astrazioni, concetti rinominati, moduli unificati, flusso dati modificato

Allora dovete **leggere la nuova implementazione a fondo** prima del porting. Il merge cieco di codice rielaborato causa perdita di funzionalità perché:

Nota: la modalità interattiva è stata recentemente suddivisa in controllers/utils/types. Quando effettuate il backport di modifiche correlate, portate gli aggiornamenti nei singoli file che abbiamo creato e assicuratevi che il cablaggio di `interactive-mode.ts` rimanga sincronizzato.

1. **I valori predefiniti cambiano silenziosamente** - Una nuova variabile `defaultFoo = [a, b]` potrebbe sostituire un vecchio `getAllFoo()` che restituiva `[a, b, c, d, e]`.

2. **Le opzioni API vengono eliminate** - Quando i sistemi si fondono (es. `hooks` + `customTools` → `extensions`), le vecchie opzioni potrebbero non essere collegate alla nuova implementazione.

3. **I percorsi di codice diventano obsoleti** - Un concetto rinominato (es. `hookMessage` → `custom`) necessita di aggiornamenti in ogni istruzione switch, type guard e handler — non solo nella definizione.

4. **Il contesto/capacità si riduce** - Le vecchie API potrebbero aver esposto `{ logger, typebox, pi }` che le nuove API hanno dimenticato di includere.

### Processo di porting semantico

Quando l'upstream ha rielaborato un modulo:

1. **Leggete la vecchia implementazione** - Comprendete cosa faceva, quali opzioni accettava, cosa esponeva.

2. **Leggete la nuova implementazione** - Comprendete le nuove astrazioni e come si mappano al vecchio comportamento.

3. **Verificate la parità di funzionalità** - Per ogni capacità nel vecchio codice, confermate che il nuovo codice la preserva o la rimuove esplicitamente.

4. **Cercate i residui** - Cercate vecchi nomi/concetti che potrebbero essere stati dimenticati nelle istruzioni switch, handler, componenti UI.

5. **Testate i confini** - Flag CLI, opzioni SDK, gestori di eventi, valori predefiniti — è qui che si nascondono le regressioni.

### Controlli rapidi

```bash
# Find all uses of an old concept that may need updating
rg "oldConceptName" --type ts

# Compare default values between versions
git show upstream/main:path/to/file.ts | rg "default|DEFAULT"

# Check if all enum/union values have handlers
rg "case \"" path/to/file.ts
```

## 13) Checklist di audit rapido

Utilizzate questa come verifica finale prima di concludere:

- [ ] Le estensioni degli import seguono la convenzione del pacchetto locale (niente rimozione indiscriminata di `.js`)
- [ ] Nessuna API solo-Node nel codice nuovo/portato
- [ ] Tutti gli scope dei pacchetti aggiornati
- [ ] Gli script del `package.json` utilizzano Bun
- [ ] I prompt sono import di testo `.md` (niente stringhe di prompt inline)
- [ ] Nessun `console.*` nel coding-agent (utilizzate `logger`)
- [ ] Gli asset si caricano tramite pattern di embed Bun (niente script di copia)
- [ ] I test o i controlli vengono eseguiti (o esplicitamente segnalati come bloccati)
- [ ] Nessuna regressione di funzionalità (vedete sezioni 11-12)

## 14) Formato del messaggio di commit

Quando committate un backport, seguite il formato del repository `<type>(scope): <descrizione al passato>` e mantenete il range
di commit nel titolo.

```
fix(coding-agent): backported pi-mono changes (<from>..<to>)

packages/<package>:
- <type>: <description>
- <type>: <description> (#<issue> by @<contributor>)

packages/<other-package>:
- <type>: <description>
```

**Esempio:**

```
fix(coding-agent): backported pi-mono changes (9f3eef65f..52532c7c0)

packages/ai:
- fix: handle "sensitive" stop reason from Anthropic API
- fix: normalize tool call IDs with special characters for Responses API
- fix: add overflow detection for Bedrock, MiniMax, Kimi providers
- fix: 429 status is rate limiting, not context overflow

packages/tui:
- fix: refactored autocomplete state tracking
- fix: file autocomplete should not trigger on empty text
- fix: configurable autocomplete max visible items
- fix: improved table column width calculation with word-aware wrapping

packages/coding-agent:
- fix: preserve external config.yml edits on save (#1046 by @nicobailonMD)
- fix: resolve macOS NFD and curly quote variants in file paths
```

**Regole:**

- Raggruppate le modifiche per pacchetto
- Utilizzate tipi di commit convenzionali (`fix`, `feat`, `refactor`, `perf`, `docs`)
- Includete i numeri di issue/PR upstream e l'attribuzione al contributore per i contributi esterni
- Il range di commit nel titolo aiuta a tracciare i punti di sincronizzazione

## 15) Divergenze Intenzionali

Il nostro fork ha decisioni architetturali che differiscono dall'upstream. **Non portate questi pattern upstream:**

### Architettura UI

| Upstream                                    | Il Nostro Fork                                            | Motivo                                                                |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| Classe `FooterDataProvider`                 | `StatusLineComponent`                                     | Barra di stato più semplice e integrata                               |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | Stub nelle modalità non-TUI                               | Implementato nella TUI, no-op altrove                                 |
| `ctx.ui.setEditorComponent()`               | Stub nelle modalità non-TUI                               | Implementato nella TUI, no-op altrove                                 |
| Oggetto opzioni `InteractiveModeOptions`    | Argomenti posizionali del costruttore (tipo opzioni ancora esportato) | Mantenete la firma del costruttore; aggiornate il tipo quando l'upstream aggiunge campi |

### Denominazione dei Componenti

| Upstream                     | Il Nostro Fork            |
| ---------------------------- | ----------------------- |
| `extension-input.ts`         | `hook-input.ts`         |
| `extension-selector.ts`      | `hook-selector.ts`      |
| `ExtensionInputComponent`    | `HookInputComponent`    |
| `ExtensionSelectorComponent` | `HookSelectorComponent` |

### Denominazione delle API

| Upstream                                 | Il Nostro Fork                           | Note                                      |
| ---------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)`    | Utilizziamo `sessionName` ovunque         |
| `sessionManager.getSessionName()`        | `sessionManager.getSessionName()`        | Uguale (abbiamo unificato per corrispondere all'RPC upstream) |
| `agent.sessionName` / `setSessionName()` | `agent.sessionName` / `setSessionName()` | Uguale                                    |

### Consolidamento dei File

| Upstream                                           | Il Nostro Fork                          | Motivo                                  |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `clipboard.ts` + `clipboard-image.ts` (file tool)  | Modulo clipboard `@f5xc-salesdemos/pi-natives` | Unificato nell'implementazione nativa N-API |

### Framework di Test

| Upstream                  | Il Nostro Fork                |
| ------------------------- | ----------------------------- |
| `vitest` con `vi.mock()`  | `bun:test` con `vi` da bun   |
| Asserzioni `node:test`    | Matcher `expect()`           |

### Architettura dei Tool

| Upstream                            | Il Nostro Fork                                                    | Note                                                      |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `createTool(cwd: string, options?)` | `createTools(session: ToolSession)` tramite registro `BUILTIN_TOOLS` | Le factory dei tool accettano `ToolSession` e possono restituire `null` |
| Interfacce `*Operations` per tool   | Le interfacce per tool rimangono (`FindOperations`, `GrepOperations`) | Utilizzate per override SSH/remoti                        |
| `fs/promises` di Node.js ovunque    | `Bun.file()`/`Bun.write()` per i file; `node:fs/promises` per le directory | Preferite le API Bun quando semplificano                  |

### Storage dell'Autenticazione

| Upstream                        | Il Nostro Fork                              | Note                                         |
| ------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `proper-lockfile` + `auth.json` | `agent.db` (bun:sqlite)                     | Le credenziali sono memorizzate esclusivamente in `agent.db` |
| Singola credenziale per provider | Multi-credenziale con selezione round-robin | Logica di affinità di sessione e backoff preservata |

### Estensioni

| Upstream                      | Il Nostro Fork                             |
| ----------------------------- | ------------------------------------------ |
| `jiti` per il caricamento TypeScript | `import()` nativo di Bun                   |
| Campo manifest `pkg.pi`       | `pkg.xcsh ?? pkg.pi` (preferire il nostro namespace) |

### Saltare Queste Funzionalità Upstream

Durante il porting, **saltate** completamente questi file/funzionalità:

- `footer-data-provider.ts` — utilizziamo StatusLineComponent
- `clipboard-image.ts` — la clipboard è nel modulo N-API `@f5xc-salesdemos/pi-natives`
- File workflow GitHub — abbiamo la nostra CI
- `models.generated.ts` — auto-generato, rigenerate localmente (come models.json invece)

### Funzionalità che Abbiamo Aggiunto (Preservatele)

Queste esistono nel nostro fork ma non nell'upstream. **Non sovrascrivetele mai:**

- `StatusLineComponent` nella modalità interattiva
- Autenticazione multi-credenziale con affinità di sessione
- Sistema di discovery basato su capacità (`defineCapability`, `registerProvider`, `loadCapability`, `skillCapability`, ecc.)
- Integrazioni MCP/Exa/SSH
- Writethrough LSP per format-on-save
- Intercettazione Bash (`checkBashInterception`)
- Suggerimenti di percorso fuzzy nel tool di lettura
