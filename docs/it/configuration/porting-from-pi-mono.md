---
title: 'Migrazione da pi-mono: Guida Pratica al Merge'
description: Guida pratica per migrare il codice dal monorepo pi-mono nel codebase xcsh.
sidebar:
  order: 9
  label: Migrazione da pi-mono
i18n:
  sourceHash: fd4e8c09303d
  translator: machine
---

# Migrazione da pi-mono: Guida Pratica al Merge

Questa guida è una checklist ripetibile per il porting delle modifiche da pi-mono in questo repository.
Usala per qualsiasi merge: singolo file, feature branch o sincronizzazione completa di una release.

## Ultimo Punto di Sincronizzazione

**Commit:** `b21b42d032919de2f2e6920a76fa9a37c3920c0a`
**Data:** 2026-03-22

Aggiorna questa sezione dopo ogni sincronizzazione; non riutilizzare l'intervallo precedente.

Quando avvii una nuova sincronizzazione, genera le patch da questo commit in avanti:

```bash
git format-patch b21b42d032919de2f2e6920a76fa9a37c3920c0a..HEAD --stdout > changes.patch
```

## 0) Definire l'ambito

- Identifica il riferimento upstream (commit, tag o PR).
- Elenca i pacchetti o le cartelle che intendi modificare.
- Decidi quali funzionalità sono nell'ambito e quali sono intenzionalmente escluse.

## 1) Portare il codice in sicurezza

- Preferisci un diff pulito e mirato piuttosto che una copia all'ingrosso.
- Evita di copiare artefatti compilati o file generati.
- Se upstream ha aggiunto nuovi file, aggiungili esplicitamente e revisiona il contenuto.

## 2) Rispettare le convenzioni delle estensioni negli import

La maggior parte dei sorgenti TypeScript di runtime omette `.js` negli import interni, ma alcuni entrypoint di test/bench mantengono `.js` per la compatibilità runtime ESM. Segui lo stile esistente del pacchetto locale; non rimuovere le estensioni indiscriminatamente.

- In `packages/coding-agent` nei sorgenti runtime, mantieni gli import interni senza estensione a meno che non si importino asset non-TS.
- In `packages/tui/test` e `packages/natives/bench`, mantieni `.js` dove i file circostanti lo utilizzano già.
- Mantieni le estensioni reali dei file quando richiesto dagli strumenti (es. `.json`, `.css`, embed di testo `.md`).
- Esempio: `import { x } from "./foo.js";` → `import { x } from "./foo";` (solo quando la convenzione del pacchetto è senza estensione).

## 3) Sostituire gli scope degli import

Upstream utilizza scope di pacchetto diversi. Sostituiscili in modo coerente.

- Sostituisci i vecchi scope con lo scope locale utilizzato qui.
- Esempi (adatta in base ai pacchetti effettivi che stai portando):
  - `@mariozechner/pi-coding-agent` → `@f5-sales-demo/xcsh`
  - `@mariozechner/pi-agent-core` → `@f5-sales-demo/pi-agent-core`
  - `@mariozechner/pi-tui` → `@f5-sales-demo/pi-tui`
  - `@mariozechner/pi-ai` → `@f5-sales-demo/pi-ai`

## 4) Usare le API Bun dove migliorano rispetto a Node

Eseguiamo su Bun. Sostituisci le API Node solo quando Bun fornisce un'alternativa migliore.

**SOSTITUISCI:**

- Spawning di processi: `child_process.spawn` → Bun Shell `$` per comandi semplici, `Bun.spawn`/`Bun.spawnSync` per streaming o lavoro di lunga durata
- I/O su file: `fs.readFileSync` → `Bun.file().text()` / `Bun.write()`
- Client HTTP: `node-fetch`, `axios` → `fetch` nativo
- Hashing crittografico: `node:crypto` → Web Crypto o `Bun.hash`
- SQLite: `better-sqlite3` → `bun:sqlite`
- Caricamento env: `dotenv` → Bun carica `.env` automaticamente

**NON SOSTITUIRE (funzionano correttamente in Bun):**

- `os.homedir()` — NON sostituire con `Bun.env.HOME`, `Bun.env.HOME`, o il letterale `"~"`
- `os.tmpdir()` — NON sostituire con `Bun.env.TMPDIR || "/tmp"` o percorsi hardcoded
- `fs.mkdtempSync()` — NON sostituire con costruzione manuale del percorso
- `path.join()`, `path.resolve()`, ecc. — vanno bene così

**Stile degli import:** Usa il prefisso `node:` solo con import di namespace (nessun import nominato da `node:fs` o `node:path`).

**Convenzioni Bun aggiuntive:**

- Preferisci Bun Shell `$` per comandi brevi e non-streaming; usa `Bun.spawn` solo quando hai bisogno di I/O streaming o controllo del processo.
- Usa `Bun.file()`/`Bun.write()` per i file e `node:fs/promises` per le directory.
- Evita i controlli `Bun.file().exists()`; usa la gestione `isEnoent` in try/catch.
- Preferisci `Bun.sleep(ms)` rispetto ai wrapper `setTimeout`.

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

Non copiare asset runtime o file vendor al momento del build.

- Se upstream copia asset in una cartella dist, sostituisci con embed compatibili con Bun.
- I prompt sono file `.md` statici; usa gli import di testo Bun (`with { type: "text" }`) e Handlebars invece di stringhe di prompt inline.
- Usa `import.meta.dir` + `Bun.file` per caricare risorse non-testuali adiacenti.
- Mantieni gli asset nel repository e lascia che il bundler li includa.
- Elimina gli script di copia a meno che l'utente non li richieda esplicitamente.
- Se upstream legge un file di fallback incluso nel bundle a runtime, sostituisci le letture del filesystem con un import embed di testo Bun.
  - Esempio (fallback istruzioni Codex):
    - `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "codex-instructions.md");` -> rimosso
    - `import FALLBACK_INSTRUCTIONS from "./codex-instructions.md" with { type: "text" };`
    - Usa `return FALLBACK_INSTRUCTIONS;` invece di `readFileSync(FALLBACK_PROMPT_PATH, "utf8")`

## 6) Portare `package.json` con attenzione

Tratta `package.json` come un contratto. Effettua il merge intenzionalmente.

- Mantieni `name`, `version`, `type`, `exports` e `bin` esistenti a meno che il porting non richieda modifiche.
- Sostituisci gli script npm/node con equivalenti Bun (es. `bun check`, `bun test`).
- Assicurati che le dipendenze usino lo scope corretto.
- Non fare downgrade delle dipendenze per correggere errori di tipo; fai upgrade invece.
- Verifica i link dei pacchetti workspace e le `peerDependencies`.

## 7) Allineare lo stile del codice e gli strumenti

- Mantieni le convenzioni di formattazione esistenti.
- Non introdurre `any` a meno che non sia necessario.
- Evita import dinamici e import di tipo inline; usa solo import di primo livello.
- Non costruire mai prompt nel codice; i prompt sono file `.md` statici renderizzati con Handlebars.
- In coding-agent, non usare mai `console.log`/`console.warn`/`console.error`; usa `logger` da `@f5-sales-demo/pi-utils`.
- Usa `Promise.withResolvers()` invece di `new Promise((resolve, reject) => ...)`.
- **Nessuna keyword `private`/`protected`/`public` sui campi o metodi delle classi.** Usa i campi privati ES `#` per l'incapsulamento; lascia i membri accessibili senza keyword. L'unica eccezione sono le proprietà dei parametri del costruttore (`constructor(private readonly x: T)`), dove la keyword è richiesta da TypeScript. Quando porti codice upstream che usa `private foo` o `protected bar`, converti in `#foo` (privato) o `bar` senza keyword (accessibile).
- Preferisci helper e utilità esistenti rispetto a nuovo codice ad-hoc.
- Preserva le modifiche infrastrutturali Bun-first già presenti in questo repository:
  - Il runtime è Bun (nessun entry point Node).
  - Il package manager è Bun (nessun lockfile npm).
  - Le API Node pesanti (`child_process`, `readline`) sono sostituite con equivalenti Bun.
  - Le API Node leggere (`os.homedir`, `os.tmpdir`, `fs.mkdtempSync`, `path.*`) sono mantenute.
  - Gli shebang CLI usano `bun` (non `node`, non `tsx`).
  - I pacchetti usano direttamente i file sorgente (nessun step di build TypeScript).
  - I workflow CI eseguono Bun per install/check/test.

## 8) Rimuovere i vecchi layer di compatibilità

A meno che non sia richiesto, rimuovi gli shim di compatibilità upstream.

- Elimina le vecchie API che sono state sostituite.
- Aggiorna tutti i punti di chiamata alla nuova API direttamente.
- Non mantenere versioni `*_v2` o parallele.

## 9) Aggiornare documentazione e riferimenti

- Sostituisci i link al repository pi-mono dove appropriato.
- Aggiorna gli esempi per usare Bun e gli scope di pacchetto corretti.
- Assicurati che le istruzioni del README corrispondano ancora al comportamento attuale del repository.

## 10) Validare il porting

Esegui i controlli standard dopo le modifiche:

- `bun check`

Se il repository ha già controlli che falliscono non correlati alle tue modifiche, segnalalo.
I test usano il runner di Bun (non Vitest), ma esegui `bun test` solo quando esplicitamente richiesto.

## 11) Proteggere le funzionalità migliorate (lista trappole di regressione)

Se hai già migliorato il comportamento localmente, tratta quei miglioramenti come **non negoziabili**. Prima del porting, annota i miglioramenti e aggiungi controlli espliciti affinché non vadano persi nel merge.

- **Blocca il comportamento atteso**: aggiungi una breve nota "prima/dopo" per ogni miglioramento (input, output, valori predefiniti, casi limite). Questo previene rollback silenziosi.
- **Mappa vecchie → nuove API**: se upstream ha rinominato concetti (hooks → extensions, custom tools → tools, ecc.), assicurati che ogni vecchio punto di ingresso sia ancora collegato. Un flag o un'esportazione mancante equivale a funzionalità persa.
- **Verifica le esportazioni**: controlla gli `exports` del `package.json`, i tipi pubblici e i file barrel. I porting da upstream spesso dimenticano di ri-esportare le aggiunte locali.
- **Copri i percorsi non-happy**: se hai corretto la gestione degli errori, i timeout o la logica di fallback, aggiungi un test o almeno una checklist manuale che eserciti quei percorsi.
- **Controlla i valori predefiniti e l'ordine di merge della configurazione**: i miglioramenti spesso risiedono nei valori predefiniti. Conferma che i nuovi valori predefiniti non siano tornati indietro (es. nuova precedenza di configurazione, funzionalità disabilitate, liste di tool).
- **Audita il comportamento env/shell**: se hai corretto l'esecuzione o il sandboxing, verifica che il nuovo percorso utilizzi ancora il tuo env sanitizzato e non reintroduca override di alias/funzioni.
- **Riesegui esempi mirati**: mantieni un set minimale di esempi "noti come funzionanti" e eseguili dopo il porting (flag CLI, registrazione estensioni, esecuzione tool).

## 12) Rilevare e gestire il codice rielaborato

Prima di portare un file, controlla se upstream lo ha significativamente ristrutturato:

```bash
# Compare the file you're about to port against what you have locally
git diff HEAD upstream/main -- path/to/file.ts
```

Se il diff mostra che il file è stato **rielaborato** (non solo patchato):

- Nuove astrazioni, concetti rinominati, moduli fusi, flusso di dati modificato

Allora devi **leggere approfonditamente la nuova implementazione** prima del porting. Il merge alla cieca di codice rielaborato perde funzionalità perché:

Nota: la modalità interattiva è stata recentemente suddivisa in controller/utils/types. Quando fai backport di modifiche correlate, porta gli aggiornamenti nei singoli file che abbiamo creato e assicurati che il cablaggio di `interactive-mode.ts` rimanga sincronizzato.

1. **I valori predefiniti cambiano silenziosamente** - Una nuova variabile `defaultFoo = [a, b]` potrebbe sostituire un vecchio `getAllFoo()` che restituiva `[a, b, c, d, e]`.

2. **Le opzioni API vengono eliminate** - Quando i sistemi si fondono (es. `hooks` + `customTools` → `extensions`), le vecchie opzioni potrebbero non essere collegate alla nuova implementazione.

3. **I percorsi di codice diventano obsoleti** - Un concetto rinominato (es. `hookMessage` → `custom`) necessita di aggiornamenti in ogni statement switch, type guard e handler — non solo nella definizione.

4. **Contesto/capacità si riducono** - Le vecchie API potrebbero aver esposto `{ logger, typebox, pi }` che le nuove API hanno dimenticato di includere.

### Processo di porting semantico

Quando upstream ha rielaborato un modulo:

1. **Leggi la vecchia implementazione** - Comprendi cosa faceva, quali opzioni accettava, cosa esponeva.

2. **Leggi la nuova implementazione** - Comprendi le nuove astrazioni e come si mappano al vecchio comportamento.

3. **Verifica la parità di funzionalità** - Per ogni capacità nel vecchio codice, conferma che il nuovo codice la preservi o la rimuova esplicitamente.

4. **Cerca i residui** - Cerca vecchi nomi/concetti che potrebbero essere stati dimenticati negli statement switch, handler, componenti UI.

5. **Testa i confini** - Flag CLI, opzioni SDK, gestori di eventi, valori predefiniti — è qui che si nascondono le regressioni.

### Controlli rapidi

```bash
# Find all uses of an old concept that may need updating
rg "oldConceptName" --type ts

# Compare default values between versions
git show upstream/main:path/to/file.ts | rg "default|DEFAULT"

# Check if all enum/union values have handlers
rg "case \"" path/to/file.ts
```

## 13) Checklist rapida di audit

Usa questa come passaggio finale prima di concludere:

- [ ] Le estensioni degli import seguono la convenzione del pacchetto locale (nessuna rimozione indiscriminata di `.js`)
- [ ] Nessuna API solo-Node nel codice nuovo/portato
- [ ] Tutti gli scope dei pacchetti aggiornati
- [ ] Gli script di `package.json` usano Bun
- [ ] I prompt sono import di testo `.md` (nessuna stringa di prompt inline)
- [ ] Nessun `console.*` in coding-agent (usa `logger`)
- [ ] Gli asset vengono caricati tramite pattern di embed Bun (nessun script di copia)
- [ ] Test o controlli eseguiti (o esplicitamente segnalati come bloccati)
- [ ] Nessuna regressione di funzionalità (vedi sezioni 11-12)

## 14) Formato del messaggio di commit

Quando fai commit di un backport, segui il formato del repository `<type>(scope): <descrizione al passato>` e mantieni l'intervallo di commit nel titolo.

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

- Raggruppa le modifiche per pacchetto
- Usa i tipi di commit convenzionali (`fix`, `feat`, `refactor`, `perf`, `docs`)
- Includi i numeri di issue/PR upstream e l'attribuzione del contributore per i contributi esterni
- L'intervallo di commit nel titolo aiuta a tracciare i punti di sincronizzazione

## 15) Divergenze Intenzionali

Il nostro fork ha decisioni architetturali che differiscono da upstream. **Non portare questi pattern upstream:**

### Architettura UI

| Upstream                                    | Il Nostro Fork                                            | Motivo                                                                |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| Classe `FooterDataProvider`                 | `StatusLineComponent`                                     | Status line più semplice e integrata                                  |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | Stub nelle modalità non-TUI                               | Implementato in TUI, no-op altrove                                    |
| `ctx.ui.setEditorComponent()`               | Stub nelle modalità non-TUI                               | Implementato in TUI, no-op altrove                                    |
| Oggetto opzioni `InteractiveModeOptions`    | Argomenti posizionali del costruttore (il tipo opzioni è ancora esportato) | Mantieni la firma del costruttore; aggiorna il tipo quando upstream aggiunge campi |

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
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)`    | Usiamo `sessionName` ovunque              |
| `sessionManager.getSessionName()`        | `sessionManager.getSessionName()`        | Uguale (abbiamo unificato per corrispondere all'RPC di upstream) |
| `agent.sessionName` / `setSessionName()` | `agent.sessionName` / `setSessionName()` | Uguale                                    |

### Consolidamento dei File

| Upstream                                           | Il Nostro Fork                          | Motivo                                  |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `clipboard.ts` + `clipboard-image.ts` (file tool)  | Modulo clipboard `@f5-sales-demo/pi-natives` | Fuso nell'implementazione nativa N-API  |

### Framework di Test

| Upstream                  | Il Nostro Fork                |
| ------------------------- | ----------------------------- |
| `vitest` con `vi.mock()`  | `bun:test` con `vi` da bun   |
| Asserzioni `node:test`    | Matcher `expect()`            |

### Architettura dei Tool

| Upstream                            | Il Nostro Fork                                                            | Note                                                      |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `createTool(cwd: string, options?)` | `createTools(session: ToolSession)` tramite registro `BUILTIN_TOOLS`  | Le factory dei tool accettano `ToolSession` e possono restituire `null` |
| Interfacce `*Operations` per tool   | Le interfacce per tool rimangono (`FindOperations`, `GrepOperations`)   | Usate per override SSH/remoti                             |
| `fs/promises` di Node.js ovunque    | `Bun.file()`/`Bun.write()` per i file; `node:fs/promises` per le directory | Preferisci le API Bun quando semplificano                 |

### Storage dell'Autenticazione

| Upstream                        | Il Nostro Fork                              | Note                                         |
| ------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `proper-lockfile` + `auth.json` | `agent.db` (bun:sqlite)                     | Le credenziali sono memorizzate esclusivamente in `agent.db` |
| Singola credenziale per provider | Multi-credenziale con selezione round-robin | Logica di affinità di sessione e backoff preservata |

### Estensioni

| Upstream                      | Il Nostro Fork                             |
| ----------------------------- | ------------------------------------------ |
| `jiti` per il caricamento TypeScript | `import()` nativo di Bun                   |
| Campo manifest `pkg.pi`       | `pkg.xcsh ?? pkg.pi` (preferisci il nostro namespace) |

### Salta Queste Funzionalità Upstream

Quando porti, **salta** interamente questi file/funzionalità:

- `footer-data-provider.ts` — usiamo StatusLineComponent
- `clipboard-image.ts` — il clipboard è nel modulo N-API `@f5-sales-demo/pi-natives`
- File di workflow GitHub — abbiamo la nostra CI
- `models.generated.ts` — auto-generato, rigeneralo localmente (come models.json invece)

### Funzionalità Aggiunte da Noi (Preservale)

Queste esistono nel nostro fork ma non in upstream. **Non sovrascrivere mai:**

- `StatusLineComponent` nella modalità interattiva
- Autenticazione multi-credenziale con affinità di sessione
- Sistema di discovery basato su capability (`defineCapability`, `registerProvider`, `loadCapability`, `skillCapability`, ecc.)
- Integrazioni MCP/Exa/SSH
- Writethrough LSP per format-on-save
- Intercettazione Bash (`checkBashInterception`)
- Suggerimenti fuzzy dei percorsi nel tool di lettura
