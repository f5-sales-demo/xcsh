---
title: 'Migrazione da pi-mono: Una Guida Pratica al Merge'
description: Guida pratica per migrare il codice dal monorepo pi-mono nella codebase xcsh.
sidebar:
  order: 9
  label: Migrazione da pi-mono
i18n:
  sourceHash: dbba6f6c0987
  translator: machine
---

# Migrazione da pi-mono: Una Guida Pratica al Merge

Questa guida è una checklist ripetibile per la migrazione delle modifiche da pi-mono in questo repository.
Utilizzatela per qualsiasi merge: singolo file, feature branch o sincronizzazione completa di rilascio.

## Ultimo Punto di Sincronizzazione

**Commit:** `b21b42d032919de2f2e6920a76fa9a37c3920c0a`
**Data:** 2026-03-22

Aggiornate questa sezione dopo ogni sincronizzazione; non riutilizzate l'intervallo precedente.

Quando iniziate una nuova sincronizzazione, generate le patch da questo commit in avanti:

```bash
git format-patch b21b42d032919de2f2e6920a76fa9a37c3920c0a..HEAD --stdout > changes.patch
```

## 0) Definire l'ambito

- Identificate il riferimento upstream (commit, tag o PR).
- Elencate i pacchetti o le cartelle che intendete modificare.
- Decidete quali funzionalità sono nell'ambito e quali vengono intenzionalmente escluse.

## 1) Portare il codice in sicurezza

- Preferite un diff pulito e mirato piuttosto che una copia integrale.
- Evitate di copiare artefatti di build o file generati.
- Se l'upstream ha aggiunto nuovi file, aggiungeteli esplicitamente e revisionatene il contenuto.

## 2) Allineare le convenzioni delle estensioni degli import

La maggior parte dei sorgenti TypeScript runtime omette `.js` negli import interni, ma alcuni entrypoint di test/bench mantengono `.js` per la compatibilità runtime ESM. Seguite lo stile esistente del pacchetto locale; non rimuovete le estensioni indiscriminatamente.

- In `packages/coding-agent` nei sorgenti runtime, mantenete gli import interni senza estensione a meno che non importiate asset non-TS.
- In `packages/tui/test` e `packages/natives/bench`, mantenete `.js` dove i file circostanti lo utilizzano già.
- Mantenete le estensioni reali dei file quando richiesto dal tooling (ad es., `.json`, `.css`, embed di testo `.md`).
- Esempio: `import { x } from "./foo.js";` → `import { x } from "./foo";` (solo quando la convenzione del pacchetto è senza estensione).

## 3) Sostituire gli scope degli import

L'upstream utilizza scope di pacchetto differenti. Sostituiteli in modo coerente.

- Sostituite i vecchi scope con lo scope locale utilizzato qui.
- Esempi (adattate in base ai pacchetti effettivi che state migrando):
  - `@mariozechner/pi-coding-agent` → `@f5xc-salesdemos/xcsh`
  - `@mariozechner/pi-agent-core` → `@f5xc-salesdemos/pi-agent-core`
  - `@mariozechner/pi-tui` → `@f5xc-salesdemos/pi-tui`
  - `@mariozechner/pi-ai` → `@f5xc-salesdemos/pi-ai`

## 4) Utilizzare le API Bun dove migliorano rispetto a Node

Lavoriamo su Bun. Sostituite le API Node solo quando Bun fornisce un'alternativa migliore.

**DA sostituire:**

- Avvio processi: `child_process.spawn` → Bun Shell `$` per comandi semplici, `Bun.spawn`/`Bun.spawnSync` per lavoro in streaming o di lunga durata
- I/O su file: `fs.readFileSync` → `Bun.file().text()` / `Bun.write()`
- Client HTTP: `node-fetch`, `axios` → `fetch` nativo
- Hashing crittografico: `node:crypto` → Web Crypto o `Bun.hash`
- SQLite: `better-sqlite3` → `bun:sqlite`
- Caricamento env: `dotenv` → Bun carica `.env` automaticamente

**DA NON sostituire (funzionano correttamente in Bun):**

- `os.homedir()` — NON sostituite con `Bun.env.HOME`, `Bun.env.HOME` o il letterale `"~"`
- `os.tmpdir()` — NON sostituite con `Bun.env.TMPDIR || "/tmp"` o percorsi hardcoded
- `fs.mkdtempSync()` — NON sostituite con costruzione manuale del percorso
- `path.join()`, `path.resolve()`, ecc. — vanno bene così

**Stile degli import:** Utilizzate il prefisso `node:` con import namespace solamente (nessun import nominato da `node:fs` o `node:path`).

**Convenzioni Bun aggiuntive:**

- Preferite Bun Shell `$` per comandi brevi e non in streaming; usate `Bun.spawn` solo quando serve I/O in streaming o controllo del processo.
- Usate `Bun.file()`/`Bun.write()` per i file e `node:fs/promises` per le directory.
- Evitate i controlli `Bun.file().exists()`; utilizzate la gestione `isEnoent` in try/catch.
- Preferite `Bun.sleep(ms)` rispetto ai wrapper `setTimeout`.

**Errato:**

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

Non copiate asset runtime o file vendor al momento della build.

- Se l'upstream copia asset in una cartella dist, sostituite con embed compatibili con Bun.
- I prompt sono file `.md` statici; utilizzate gli import di testo Bun (`with { type: "text" }`) e Handlebars invece di stringhe prompt inline.
- Usate `import.meta.dir` + `Bun.file` per caricare risorse non testuali adiacenti.
- Mantenete gli asset nel repository e lasciate che il bundler li includa.
- Eliminate gli script di copia a meno che l'utente non li richieda esplicitamente.
- Se l'upstream legge un file di fallback bundled a runtime, sostituite le letture da filesystem con un import di testo embed Bun.
  - Esempio (fallback istruzioni Codex):
    - `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "codex-instructions.md");` -> rimosso
    - `import FALLBACK_INSTRUCTIONS from "./codex-instructions.md" with { type: "text" };`
    - Usate `return FALLBACK_INSTRUCTIONS;` invece di `readFileSync(FALLBACK_PROMPT_PATH, "utf8")`

## 6) Migrare `package.json` con attenzione

Trattate `package.json` come un contratto. Effettuate il merge intenzionalmente.

- Mantenete `name`, `version`, `type`, `exports` e `bin` esistenti a meno che la migrazione non richieda modifiche.
- Sostituite gli script npm/node con equivalenti Bun (ad es., `bun check`, `bun test`).
- Assicuratevi che le dipendenze utilizzino lo scope corretto.
- Non fate downgrade delle dipendenze per risolvere errori di tipo; fate upgrade invece.
- Verificate i link dei pacchetti workspace e le `peerDependencies`.

## 7) Allineare lo stile del codice e il tooling

- Mantenete le convenzioni di formattazione esistenti.
- Non introducete `any` a meno che non sia necessario.
- Evitate import dinamici e import di tipo inline; utilizzate solo import top-level.
- Non costruite mai prompt nel codice; i prompt sono file `.md` statici renderizzati con Handlebars.
- Nel coding-agent, non usate mai `console.log`/`console.warn`/`console.error`; utilizzate `logger` da `@f5xc-salesdemos/pi-utils`.
- Usate `Promise.withResolvers()` invece di `new Promise((resolve, reject) => ...)`.
- **Nessuna keyword `private`/`protected`/`public` su campi o metodi di classe.** Usate i campi privati ES `#` per l'incapsulamento; lasciate i membri accessibili senza keyword. L'unica eccezione sono le proprietà parametro del costruttore (`constructor(private readonly x: T)`), dove la keyword è richiesta da TypeScript. Quando migrate codice upstream che usa `private foo` o `protected bar`, convertite in `#foo` (privato) o `bar` senza keyword (accessibile).
- Preferite helper e utility esistenti rispetto a nuovo codice ad-hoc.
- Preservate le modifiche infrastrutturali Bun-first già presenti in questo repository:
  - Il runtime è Bun (nessun entry point Node).
  - Il package manager è Bun (nessun lockfile npm).
  - Le API Node pesanti (`child_process`, `readline`) sono sostituite con equivalenti Bun.
  - Le API Node leggere (`os.homedir`, `os.tmpdir`, `fs.mkdtempSync`, `path.*`) sono mantenute.
  - Gli shebang CLI usano `bun` (non `node`, non `tsx`).
  - I pacchetti usano i file sorgente direttamente (nessun step di build TypeScript).
  - I workflow CI eseguono Bun per install/check/test.

## 8) Rimuovere i vecchi layer di compatibilità

A meno che non sia richiesto, rimuovete gli shim di compatibilità upstream.

- Eliminate le vecchie API che sono state sostituite.
- Aggiornate tutti i punti di chiamata direttamente alla nuova API.
- Non mantenete versioni `*_v2` o parallele.

## 9) Aggiornare documentazione e riferimenti

- Sostituite i link al repository pi-mono dove appropriato.
- Aggiornate gli esempi per utilizzare Bun e gli scope di pacchetto corretti.
- Assicuratevi che le istruzioni del README corrispondano ancora al comportamento attuale del repository.

## 10) Validare la migrazione

Eseguite i controlli standard dopo le modifiche:

- `bun check`

Se il repository ha già controlli falliti non correlati alle vostre modifiche, segnalatelo.
I test usano il runner di Bun (non Vitest), ma eseguite `bun test` solo quando esplicitamente richiesto.

## 11) Proteggere le funzionalità migliorate (lista trappole per regressioni)

Se avete già migliorato il comportamento localmente, trattateli come **non negoziabili**. Prima della migrazione, annotate
i miglioramenti e aggiungete controlli espliciti affinché non vadano persi nel merge.

- **Congelate il comportamento atteso**: aggiungete una breve nota "prima/dopo" per ogni miglioramento (input, output,
  default, casi limite). Questo previene rollback silenziosi.
- **Mappate le vecchie API → nuove API**: se l'upstream ha rinominato concetti (hooks → extensions, custom tools → tools, ecc.),
  assicuratevi che ogni vecchio punto di accesso sia ancora collegato. Un flag o export mancato equivale a funzionalità persa.
- **Verificate gli export**: controllate gli `exports` in `package.json`, i tipi pubblici e i file barrel. Le migrazioni upstream spesso
  dimenticano di ri-esportare le aggiunte locali.
- **Coprite i percorsi non-happy**: se avete corretto la gestione degli errori, i timeout o la logica di fallback, aggiungete un test o
  almeno una checklist manuale che eserciti quei percorsi.
- **Controllate i default e l'ordine di merge della configurazione**: i miglioramenti spesso risiedono nei default. Confermate che i nuovi default
  non siano stati ripristinati (ad es., nuova precedenza di configurazione, funzionalità disabilitate, liste di tool).
- **Verificate il comportamento env/shell**: se avete corretto l'esecuzione o il sandboxing, verificate che il nuovo percorso utilizzi ancora il vostro
  env sanitizzato e non reintroduca override di alias/funzioni.
- **Rieseguite campioni mirati**: mantenete un set minimale di esempi "noti come funzionanti" e eseguiteli dopo la migrazione
  (flag CLI, registrazione estensioni, esecuzione tool).

## 12) Rilevare e gestire codice rielaborato

Prima di migrare un file, verificate se l'upstream lo ha significativamente refactorizzato:

```bash
# Compare the file you're about to port against what you have locally
git diff HEAD upstream/main -- path/to/file.ts
```

Se il diff mostra che il file è stato **rielaborato** (non solo patchato):

- Nuove astrazioni, concetti rinominati, moduli unificati, flusso dati modificato

Allora dovete **leggere approfonditamente la nuova implementazione** prima della migrazione. Il merge cieco di codice rielaborato causa perdita di funzionalità perché:

Nota: la modalità interattiva è stata recentemente suddivisa in controllers/utils/types. Quando fate backport di modifiche correlate, migrate gli aggiornamenti nei singoli file che abbiamo creato e assicuratevi che il wiring di `interactive-mode.ts` resti sincronizzato.

1. **I default cambiano silenziosamente** - Una nuova variabile `defaultFoo = [a, b]` potrebbe sostituire un vecchio `getAllFoo()` che restituiva `[a, b, c, d, e]`.

2. **Le opzioni API vengono perse** - Quando i sistemi si unificano (ad es., `hooks` + `customTools` → `extensions`), le vecchie opzioni potrebbero non essere collegate alla nuova implementazione.

3. **I percorsi di codice diventano obsoleti** - Un concetto rinominato (ad es., `hookMessage` → `custom`) richiede aggiornamenti in ogni switch statement, type guard e handler — non solo nella definizione.

4. **Il contesto/le capacità si riducono** - Le vecchie API potrebbero aver esposto `{ logger, typebox, pi }` che le nuove API hanno dimenticato di includere.

### Processo di migrazione semantica

Quando l'upstream ha rielaborato un modulo:

1. **Leggete la vecchia implementazione** - Comprendete cosa faceva, quali opzioni accettava, cosa esponeva.

2. **Leggete la nuova implementazione** - Comprendete le nuove astrazioni e come si mappano al vecchio comportamento.

3. **Verificate la parità funzionale** - Per ogni capacità nel vecchio codice, confermate che il nuovo codice la preserva o la rimuove esplicitamente.

4. **Cercate i residui** - Cercate vecchi nomi/concetti che potrebbero essere stati dimenticati in switch statement, handler, componenti UI.

5. **Testate i confini** - Flag CLI, opzioni SDK, gestori di eventi, valori di default — è qui che si nascondono le regressioni.

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

Utilizzatela come passaggio finale prima di concludere:

- [ ] Le estensioni degli import seguono la convenzione del pacchetto locale (nessuna rimozione indiscriminata di `.js`)
- [ ] Nessuna API esclusiva Node nel codice nuovo/migrato
- [ ] Tutti gli scope dei pacchetti aggiornati
- [ ] Gli script di `package.json` usano Bun
- [ ] I prompt sono import di testo `.md` (nessuna stringa prompt inline)
- [ ] Nessun `console.*` nel coding-agent (usate `logger`)
- [ ] Gli asset vengono caricati tramite pattern embed Bun (nessuno script di copia)
- [ ] I test o i controlli vengono eseguiti (o esplicitamente segnalati come bloccati)
- [ ] Nessuna regressione funzionale (vedere sezioni 11-12)

## 14) Formato del messaggio di commit

Quando committate un backport, seguite il formato del repository `<type>(scope): <descrizione al passato>` e mantenete l'intervallo
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
- Utilizzate i tipi conventional commit (`fix`, `feat`, `refactor`, `perf`, `docs`)
- Includete numeri di issue/PR upstream e attribuzione al contributore per i contributi esterni
- L'intervallo di commit nel titolo aiuta a tracciare i punti di sincronizzazione

## 15) Divergenze Intenzionali

Il nostro fork ha decisioni architetturali che differiscono dall'upstream. **Non migrate questi pattern upstream:**

### Architettura UI

| Upstream                                    | Il Nostro Fork                                            | Motivo                                                                |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| Classe `FooterDataProvider`                 | `StatusLineComponent`                                     | Status line più semplice e integrata                                  |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | Stub nelle modalità non-TUI                               | Implementato nella TUI, no-op altrove                                 |
| `ctx.ui.setEditorComponent()`               | Stub nelle modalità non-TUI                               | Implementato nella TUI, no-op altrove                                 |
| Oggetto opzioni `InteractiveModeOptions`    | Argomenti posizionali nel costruttore (il tipo opzioni è ancora esportato) | Mantenete la firma del costruttore; aggiornate il tipo quando l'upstream aggiunge campi |

### Nomenclatura Componenti

| Upstream                     | Il Nostro Fork            |
| ---------------------------- | ----------------------- |
| `extension-input.ts`         | `hook-input.ts`         |
| `extension-selector.ts`      | `hook-selector.ts`      |
| `ExtensionInputComponent`    | `HookInputComponent`    |
| `ExtensionSelectorComponent` | `HookSelectorComponent` |

### Nomenclatura API

| Upstream                                 | Il Nostro Fork                           | Note                                      |
| ---------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)`    | Utilizziamo `sessionName` ovunque         |
| `sessionManager.getSessionName()`        | `sessionManager.getSessionName()`        | Uguale (abbiamo unificato per corrispondere all'RPC upstream) |
| `agent.sessionName` / `setSessionName()` | `agent.sessionName` / `setSessionName()` | Uguale                                    |

### Consolidamento File

| Upstream                                           | Il Nostro Fork                          | Motivo                                  |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `clipboard.ts` + `clipboard-image.ts` (file tool)  | Modulo clipboard `@f5xc-salesdemos/pi-natives` | Unificato nell'implementazione nativa N-API |

### Framework di Test

| Upstream                  | Il Nostro Fork                |
| ------------------------- | ----------------------------- |
| `vitest` con `vi.mock()`  | `bun:test` con `vi` da bun   |
| Asserzioni `node:test`    | Matcher `expect()`           |

### Architettura Tool

| Upstream                            | Il Nostro Fork                                                    | Note                                                      |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `createTool(cwd: string, options?)` | `createTools(session: ToolSession)` tramite registro `BUILTIN_TOOLS` | Le factory dei tool accettano `ToolSession` e possono restituire `null` |
| Interfacce `*Operations` per tool   | Le interfacce per tool rimangono (`FindOperations`, `GrepOperations`) | Usate per override SSH/remoti                             |
| `fs/promises` Node.js ovunque       | `Bun.file()`/`Bun.write()` per i file; `node:fs/promises` per le dir | Preferite le API Bun quando semplificano                  |

### Storage Autenticazione

| Upstream                        | Il Nostro Fork                              | Note                                         |
| ------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `proper-lockfile` + `auth.json` | `agent.db` (bun:sqlite)                     | Credenziali memorizzate esclusivamente in `agent.db` |
| Singola credenziale per provider | Multi-credenziale con selezione round-robin | Logica di affinità sessione e backoff preservata |

### Estensioni

| Upstream                      | Il Nostro Fork                             |
| ----------------------------- | ------------------------------------------ |
| `jiti` per caricamento TypeScript | `import()` nativo Bun                      |
| Campo manifest `pkg.pi`       | `pkg.xcsh ?? pkg.pi` (preferenza al nostro namespace) |

### Saltare Queste Funzionalità Upstream

Durante la migrazione, **saltate** interamente questi file/funzionalità:

- `footer-data-provider.ts` — utilizziamo StatusLineComponent
- `clipboard-image.ts` — il clipboard è nel modulo N-API `@f5xc-salesdemos/pi-natives`
- File workflow GitHub — abbiamo la nostra CI
- `models.generated.ts` — auto-generato, rigenerate localmente (come models.json invece)

### Funzionalità che Abbiamo Aggiunto (Da Preservare)

Queste esistono nel nostro fork ma non nell'upstream. **Non sovrascrivete mai:**

- `StatusLineComponent` nella modalità interattiva
- Autenticazione multi-credenziale con affinità di sessione
- Sistema di discovery basato su capacità (`defineCapability`, `registerProvider`, `loadCapability`, `skillCapability`, ecc.)
- Integrazioni MCP/Exa/SSH
- Writethrough LSP per format-on-save
- Intercettazione Bash (`checkBashInterception`)
- Suggerimenti di percorso fuzzy nel tool di lettura
