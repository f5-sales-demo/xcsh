---
title: 'Portierung von pi-mono: Ein praktischer Merge-Leitfaden'
description: >-
  Praktischer Leitfaden für die Migration von Code aus dem pi-mono-Monorepo in
  die xcsh-Codebasis.
sidebar:
  order: 9
  label: Portierung von pi-mono
i18n:
  sourceHash: dbba6f6c0987
  translator: machine
---

# Portierung von pi-mono: Ein praktischer Merge-Leitfaden

Dieser Leitfaden ist eine wiederholbare Checkliste für die Portierung von Änderungen aus pi-mono in dieses Repository.
Verwenden Sie ihn für jeden Merge: einzelne Datei, Feature-Branch oder vollständige Release-Synchronisation.

## Letzter Synchronisationspunkt

**Commit:** `b21b42d032919de2f2e6920a76fa9a37c3920c0a`
**Datum:** 22.03.2026

Aktualisieren Sie diesen Abschnitt nach jeder Synchronisation; verwenden Sie nicht den vorherigen Bereich erneut.

Wenn Sie eine neue Synchronisation starten, generieren Sie Patches ab diesem Commit:

```bash
git format-patch b21b42d032919de2f2e6920a76fa9a37c3920c0a..HEAD --stdout > changes.patch
```

## 0) Umfang definieren

- Identifizieren Sie die Upstream-Referenz (Commit, Tag oder PR).
- Listen Sie die Pakete oder Ordner auf, die Sie bearbeiten möchten.
- Entscheiden Sie, welche Features im Umfang liegen und welche bewusst übersprungen werden.

## 1) Code sicher übernehmen

- Bevorzugen Sie einen sauberen, fokussierten Diff anstelle einer vollständigen Kopie.
- Vermeiden Sie das Kopieren von Build-Artefakten oder generierten Dateien.
- Wenn Upstream neue Dateien hinzugefügt hat, fügen Sie diese explizit hinzu und überprüfen Sie den Inhalt.

## 2) Import-Erweiterungs-Konventionen einhalten

Die meisten Runtime-TypeScript-Quellen lassen `.js` bei internen Imports weg, aber einige Test-/Bench-Einstiegspunkte behalten `.js` für ESM-Runtime-Kompatibilität bei. Folgen Sie dem bestehenden Stil des lokalen Pakets; entfernen Sie Erweiterungen nicht pauschal.

- In `packages/coding-agent` Runtime-Quellen halten Sie interne Imports ohne Erweiterung, es sei denn, Nicht-TS-Assets werden importiert.
- In `packages/tui/test` und `packages/natives/bench` behalten Sie `.js` bei, wo umliegende Dateien es bereits verwenden.
- Behalten Sie echte Dateierweiterungen bei, wenn das Tooling sie erfordert (z.B. `.json`, `.css`, `.md` Text-Embeds).
- Beispiel: `import { x } from "./foo.js";` → `import { x } from "./foo";` (nur wenn die Paket-Konvention erweiterungslos ist).

## 3) Import-Scopes ersetzen

Upstream verwendet andere Paket-Scopes. Ersetzen Sie diese konsistent.

- Ersetzen Sie alte Scopes durch den hier verwendeten lokalen Scope.
- Beispiele (passen Sie an die tatsächlichen Pakete an, die Sie portieren):
  - `@mariozechner/pi-coding-agent` → `@f5xc-salesdemos/xcsh`
  - `@mariozechner/pi-agent-core` → `@f5xc-salesdemos/pi-agent-core`
  - `@mariozechner/pi-tui` → `@f5xc-salesdemos/pi-tui`
  - `@mariozechner/pi-ai` → `@f5xc-salesdemos/pi-ai`

## 4) Bun-APIs verwenden, wo sie Node verbessern

Wir laufen auf Bun. Ersetzen Sie Node-APIs nur, wenn Bun eine bessere Alternative bietet.

**Ersetzen:**

- Prozess-Spawning: `child_process.spawn` → Bun Shell `$` für einfache Befehle, `Bun.spawn`/`Bun.spawnSync` für Streaming oder langläufige Arbeit
- Datei-I/O: `fs.readFileSync` → `Bun.file().text()` / `Bun.write()`
- HTTP-Clients: `node-fetch`, `axios` → natives `fetch`
- Krypto-Hashing: `node:crypto` → Web Crypto oder `Bun.hash`
- SQLite: `better-sqlite3` → `bun:sqlite`
- Env-Laden: `dotenv` → Bun lädt `.env` automatisch

**NICHT ersetzen (diese funktionieren in Bun einwandfrei):**

- `os.homedir()` — NICHT durch `Bun.env.HOME`, `Bun.env.HOME` oder literales `"~"` ersetzen
- `os.tmpdir()` — NICHT durch `Bun.env.TMPDIR || "/tmp"` oder hartcodierte Pfade ersetzen
- `fs.mkdtempSync()` — NICHT durch manuelle Pfadkonstruktion ersetzen
- `path.join()`, `path.resolve()`, etc. — diese sind in Ordnung

**Import-Stil:** Verwenden Sie das `node:`-Präfix nur mit Namespace-Imports (keine benannten Imports aus `node:fs` oder `node:path`).

**Zusätzliche Bun-Konventionen:**

- Bevorzugen Sie Bun Shell `$` für kurze, nicht-streamende Befehle; verwenden Sie `Bun.spawn` nur, wenn Sie Streaming-I/O oder Prozesskontrolle benötigen.
- Verwenden Sie `Bun.file()`/`Bun.write()` für Dateien und `node:fs/promises` für Verzeichnisse.
- Vermeiden Sie `Bun.file().exists()`-Prüfungen; verwenden Sie `isEnoent`-Behandlung in try/catch.
- Bevorzugen Sie `Bun.sleep(ms)` gegenüber `setTimeout`-Wrappern.

**Falsch:**

```typescript
// FEHLERHAFT: Umgebungsvariablen können undefined sein, "~" wird nicht expandiert
const home = Bun.env.HOME || "~";
const tmp = Bun.env.TMPDIR || "/tmp";
```

**Korrekt:**

```typescript
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

const configDir = path.join(os.homedir(), ".config", "myapp");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myapp-"));
```

## 5) Bun-Embeds bevorzugen (kein Kopieren)

Kopieren Sie keine Runtime-Assets oder Vendor-Dateien zur Build-Zeit.

- Wenn Upstream Assets in einen dist-Ordner kopiert, ersetzen Sie dies durch Bun-freundliche Embeds.
- Prompts sind statische `.md`-Dateien; verwenden Sie Bun-Text-Imports (`with { type: "text" }`) und Handlebars anstelle von Inline-Prompt-Strings.
- Verwenden Sie `import.meta.dir` + `Bun.file`, um benachbarte Nicht-Text-Ressourcen zu laden.
- Behalten Sie Assets im Repository und lassen Sie den Bundler sie einschließen.
- Eliminieren Sie Kopier-Skripte, es sei denn, der Benutzer fordert sie explizit an.
- Wenn Upstream eine gebündelte Fallback-Datei zur Laufzeit liest, ersetzen Sie Dateisystem-Reads durch einen Bun-Text-Embed-Import.
  - Beispiel (Codex-Anweisungen-Fallback):
    - `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "codex-instructions.md");` -> entfernt
    - `import FALLBACK_INSTRUCTIONS from "./codex-instructions.md" with { type: "text" };`
    - Verwenden Sie `return FALLBACK_INSTRUCTIONS;` anstelle von `readFileSync(FALLBACK_PROMPT_PATH, "utf8")`

## 6) `package.json` sorgfältig portieren

Behandeln Sie `package.json` als Vertrag. Mergen Sie bewusst.

- Behalten Sie bestehende `name`, `version`, `type`, `exports` und `bin` bei, es sei denn, die Portierung erfordert Änderungen.
- Ersetzen Sie npm/node-Skripte durch Bun-Äquivalente (z.B. `bun check`, `bun test`).
- Stellen Sie sicher, dass Abhängigkeiten den korrekten Scope verwenden.
- Downgraden Sie keine Abhängigkeiten, um Typ-Fehler zu beheben; upgraden Sie stattdessen.
- Validieren Sie Workspace-Paket-Links und `peerDependencies`.

## 7) Code-Stil und Tooling angleichen

- Behalten Sie bestehende Formatierungs-Konventionen bei.
- Führen Sie kein `any` ein, es sei denn, es ist erforderlich.
- Vermeiden Sie dynamische Imports und Inline-Typ-Imports; verwenden Sie nur Top-Level-Imports.
- Bauen Sie niemals Prompts im Code; Prompts sind statische `.md`-Dateien, die mit Handlebars gerendert werden.
- Verwenden Sie im coding-agent niemals `console.log`/`console.warn`/`console.error`; verwenden Sie `logger` aus `@f5xc-salesdemos/pi-utils`.
- Verwenden Sie `Promise.withResolvers()` anstelle von `new Promise((resolve, reject) => ...)`.
- **Keine `private`/`protected`/`public`-Schlüsselwörter bei Klassen-Feldern oder -Methoden.** Verwenden Sie ES `#` private Felder für Kapselung; lassen Sie zugängliche Member ohne Schlüsselwort. Die einzige Ausnahme sind Konstruktor-Parameter-Properties (`constructor(private readonly x: T)`), bei denen das Schlüsselwort von TypeScript verlangt wird. Wenn Sie Upstream-Code portieren, der `private foo` oder `protected bar` verwendet, konvertieren Sie zu `#foo` (privat) oder bloßem `bar` (zugänglich).
- Bevorzugen Sie bestehende Helfer und Utilities gegenüber neuem Ad-hoc-Code.
- Bewahren Sie die Bun-first-Infrastrukturänderungen, die bereits in diesem Repository vorgenommen wurden:
  - Runtime ist Bun (keine Node-Einstiegspunkte).
  - Paketmanager ist Bun (keine npm-Lockfiles).
  - Schwere Node-APIs (`child_process`, `readline`) sind durch Bun-Äquivalente ersetzt.
  - Leichtgewichtige Node-APIs (`os.homedir`, `os.tmpdir`, `fs.mkdtempSync`, `path.*`) werden beibehalten.
  - CLI-Shebangs verwenden `bun` (nicht `node`, nicht `tsx`).
  - Pakete verwenden Quelldateien direkt (kein TypeScript-Build-Schritt).
  - CI-Workflows führen Bun für install/check/test aus.

## 8) Alte Kompatibilitätsschichten entfernen

Entfernen Sie Upstream-Kompatibilitäts-Shims, sofern nicht anders angefordert.

- Löschen Sie alte APIs, die ersetzt wurden.
- Aktualisieren Sie alle Aufrufstellen direkt auf die neue API.
- Behalten Sie keine `*_v2`- oder Parallelversionen bei.

## 9) Dokumentation und Referenzen aktualisieren

- Ersetzen Sie pi-mono-Repository-Links, wo angemessen.
- Aktualisieren Sie Beispiele auf Bun und korrekte Paket-Scopes.
- Stellen Sie sicher, dass README-Anweisungen noch zum aktuellen Repository-Verhalten passen.

## 10) Die Portierung validieren

Führen Sie die Standardprüfungen nach Änderungen aus:

- `bun check`

Wenn das Repository bereits fehlschlagende Prüfungen hat, die nicht mit Ihren Änderungen zusammenhängen, weisen Sie darauf hin.
Tests verwenden Buns Runner (nicht Vitest), aber führen Sie `bun test` nur aus, wenn es explizit angefordert wird.

## 11) Verbesserte Features schützen (Regressions-Fallenliste)

Wenn Sie bereits lokal Verhalten verbessert haben, behandeln Sie diese als **nicht verhandelbar**. Notieren Sie vor der Portierung
die Verbesserungen und fügen Sie explizite Prüfungen hinzu, damit sie beim Merge nicht verloren gehen.

- **Erwartetes Verhalten einfrieren**: Fügen Sie für jede Verbesserung eine kurze "Vorher/Nachher"-Notiz hinzu (Eingaben, Ausgaben,
  Standardwerte, Grenzfälle). Dies verhindert stillschweigende Rücknahmen.
- **Alt → Neu APIs zuordnen**: Wenn Upstream Konzepte umbenannt hat (hooks → extensions, custom tools → tools, etc.),
  stellen Sie sicher, dass jeder alte Einstiegspunkt weiterhin durchgereicht wird. Ein vergessenes Flag oder Export bedeutet verlorene Funktionalität.
- **Exports überprüfen**: Prüfen Sie `package.json` `exports`, öffentliche Typen und Barrel-Dateien. Upstream-Portierungen
  vergessen oft, lokale Ergänzungen erneut zu exportieren.
- **Nicht-Happy-Paths abdecken**: Wenn Sie Fehlerbehandlung, Timeouts oder Fallback-Logik korrigiert haben, fügen Sie einen Test oder
  zumindest eine manuelle Checkliste hinzu, die diese Pfade durchläuft.
- **Standardwerte und Config-Merge-Reihenfolge prüfen**: Verbesserungen leben oft in Standardwerten. Bestätigen Sie, dass neue Standardwerte
  nicht zurückgesetzt wurden (z.B. neue Config-Priorität, deaktivierte Features, Tool-Listen).
- **Env/Shell-Verhalten auditieren**: Wenn Sie Ausführung oder Sandboxing korrigiert haben, überprüfen Sie, dass der neue Pfad weiterhin Ihre
  bereinigte Umgebung verwendet und keine Alias-/Funktions-Overrides wiedereinführt.
- **Gezielte Beispiele erneut ausführen**: Halten Sie eine minimale Menge von "bekannt guten" Beispielen bereit und führen Sie sie nach der Portierung aus
  (CLI-Flags, Extension-Registrierung, Tool-Ausführung).

## 12) Überarbeiteten Code erkennen und behandeln

Bevor Sie eine Datei portieren, prüfen Sie, ob Upstream sie erheblich refaktorisiert hat:

```bash
# Vergleichen Sie die Datei, die Sie portieren möchten, mit dem, was Sie lokal haben
git diff HEAD upstream/main -- path/to/file.ts
```

Wenn der Diff zeigt, dass die Datei **überarbeitet** wurde (nicht nur gepatcht):

- Neue Abstraktionen, umbenannte Konzepte, zusammengeführte Module, geänderter Datenfluss

Dann müssen Sie **die neue Implementierung gründlich lesen**, bevor Sie portieren. Blindes Mergen von überarbeitetem Code verliert Funktionalität, weil:

Hinweis: Der interaktive Modus wurde kürzlich in Controllers/Utils/Types aufgeteilt. Wenn Sie verwandte Änderungen zurückportieren, portieren Sie Updates in die einzelnen Dateien, die wir erstellt haben, und stellen Sie sicher, dass die `interactive-mode.ts`-Verdrahtung synchron bleibt.

1. **Standardwerte ändern sich stillschweigend** - Eine neue Variable `defaultFoo = [a, b]` kann ein altes `getAllFoo()` ersetzen, das `[a, b, c, d, e]` zurückgab.

2. **API-Optionen gehen verloren** - Wenn Systeme zusammengeführt werden (z.B. `hooks` + `customTools` → `extensions`), werden alte Optionen möglicherweise nicht zur neuen Implementierung durchgereicht.

3. **Code-Pfade veralten** - Ein umbenanntes Konzept (z.B. `hookMessage` → `custom`) erfordert Updates in jedem Switch-Statement, Type-Guard und Handler – nicht nur in der Definition.

4. **Kontext/Fähigkeiten schrumpfen** - Alte APIs haben möglicherweise `{ logger, typebox, pi }` exponiert, die neue APIs vergessen haben einzuschließen.

### Semantischer Portierungsprozess

Wenn Upstream ein Modul überarbeitet hat:

1. **Alte Implementierung lesen** - Verstehen Sie, was sie tat, welche Optionen sie akzeptierte, was sie exponierte.

2. **Neue Implementierung lesen** - Verstehen Sie die neuen Abstraktionen und wie sie auf das alte Verhalten abbilden.

3. **Feature-Parität verifizieren** - Bestätigen Sie für jede Fähigkeit im alten Code, dass der neue Code sie beibehält oder explizit entfernt.

4. **Nach Überbleibseln suchen** - Suchen Sie nach alten Namen/Konzepten, die möglicherweise in Switch-Statements, Handlern, UI-Komponenten übersehen wurden.

5. **Grenzen testen** - CLI-Flags, SDK-Optionen, Event-Handler, Standardwerte – hier verstecken sich Regressionen.

### Schnellprüfungen

```bash
# Alle Verwendungen eines alten Konzepts finden, die möglicherweise aktualisiert werden müssen
rg "oldConceptName" --type ts

# Standardwerte zwischen Versionen vergleichen
git show upstream/main:path/to/file.ts | rg "default|DEFAULT"

# Prüfen, ob alle Enum-/Union-Werte Handler haben
rg "case \"" path/to/file.ts
```

## 13) Schnelle Audit-Checkliste

Verwenden Sie dies als letzten Durchgang, bevor Sie fertig sind:

- [ ] Import-Erweiterungen folgen der lokalen Paket-Konvention (kein pauschales `.js`-Entfernen)
- [ ] Keine Node-only-APIs in neuem/portiertem Code
- [ ] Alle Paket-Scopes aktualisiert
- [ ] `package.json`-Skripte verwenden Bun
- [ ] Prompts sind `.md`-Text-Imports (keine Inline-Prompt-Strings)
- [ ] Kein `console.*` im coding-agent (verwenden Sie `logger`)
- [ ] Assets werden über Bun-Embed-Muster geladen (keine Kopier-Skripte)
- [ ] Tests oder Prüfungen laufen (oder explizit als blockiert vermerkt)
- [ ] Keine Funktionalitäts-Regressionen (siehe Abschnitte 11-12)

## 14) Commit-Nachricht-Format

Wenn Sie einen Backport committen, folgen Sie dem Repository-Format `<type>(scope): <Beschreibung in Vergangenheitsform>` und behalten Sie den Commit-Bereich im Titel.

```
fix(coding-agent): backported pi-mono changes (<from>..<to>)

packages/<package>:
- <type>: <description>
- <type>: <description> (#<issue> by @<contributor>)

packages/<other-package>:
- <type>: <description>
```

**Beispiel:**

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

**Regeln:**

- Änderungen nach Paket gruppieren
- Conventional-Commit-Typen verwenden (`fix`, `feat`, `refactor`, `perf`, `docs`)
- Upstream-Issue-/PR-Nummern und Mitwirkenden-Attribution für externe Beiträge einschließen
- Der Commit-Bereich im Titel hilft bei der Nachverfolgung von Synchronisationspunkten

## 15) Beabsichtigte Abweichungen

Unser Fork hat architektonische Entscheidungen, die sich von Upstream unterscheiden. **Portieren Sie diese Upstream-Muster nicht:**

### UI-Architektur

| Upstream                                    | Unser Fork                                                | Grund                                                                 |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `FooterDataProvider`-Klasse                 | `StatusLineComponent`                                     | Einfachere, integrierte Statuszeile                                   |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | Stub in Nicht-TUI-Modi                                    | Implementiert in TUI, No-Op anderswo                                  |
| `ctx.ui.setEditorComponent()`               | Stub in Nicht-TUI-Modi                                    | Implementiert in TUI, No-Op anderswo                                  |
| `InteractiveModeOptions`-Optionsobjekt      | Positionale Konstruktor-Argumente (Optionstyp weiterhin exportiert) | Konstruktor-Signatur beibehalten; Typ aktualisieren, wenn Upstream Felder hinzufügt |

### Komponenten-Benennung

| Upstream                     | Unser Fork              |
| ---------------------------- | ----------------------- |
| `extension-input.ts`         | `hook-input.ts`         |
| `extension-selector.ts`      | `hook-selector.ts`      |
| `ExtensionInputComponent`    | `HookInputComponent`    |
| `ExtensionSelectorComponent` | `HookSelectorComponent` |

### API-Benennung

| Upstream                                 | Unser Fork                               | Anmerkungen                               |
| ---------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)`    | Wir verwenden durchgehend `sessionName`   |
| `sessionManager.getSessionName()`        | `sessionManager.getSessionName()`        | Gleich (wir haben uns an Upstreams RPC angeglichen) |
| `agent.sessionName` / `setSessionName()` | `agent.sessionName` / `setSessionName()` | Gleich                                    |

### Datei-Konsolidierung

| Upstream                                           | Unser Fork                              | Grund                                   |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `clipboard.ts` + `clipboard-image.ts` (Tool-Dateien) | `@f5xc-salesdemos/pi-natives` Clipboard-Modul | In N-API-Native-Implementierung zusammengeführt |

### Test-Framework

| Upstream                  | Unser Fork                    |
| ------------------------- | ----------------------------- |
| `vitest` mit `vi.mock()`  | `bun:test` mit `vi` von Bun  |
| `node:test`-Assertions    | `expect()`-Matcher            |

### Tool-Architektur

| Upstream                            | Unser Fork                                                        | Anmerkungen                                               |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `createTool(cwd: string, options?)` | `createTools(session: ToolSession)` via `BUILTIN_TOOLS`-Registry  | Tool-Factories akzeptieren `ToolSession` und können `null` zurückgeben |
| Per-Tool `*Operations`-Interfaces   | Per-Tool-Interfaces bleiben (`FindOperations`, `GrepOperations`)  | Verwendet für SSH/Remote-Overrides                        |
| Node.js `fs/promises` überall       | `Bun.file()`/`Bun.write()` für Dateien; `node:fs/promises` für Verzeichnisse | Bun-APIs bevorzugen, wenn sie vereinfachen               |

### Auth-Speicherung

| Upstream                        | Unser Fork                                  | Anmerkungen                                  |
| ------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `proper-lockfile` + `auth.json` | `agent.db` (bun:sqlite)                     | Anmeldedaten ausschließlich in `agent.db` gespeichert |
| Einzelne Anmeldedaten pro Anbieter | Multi-Anmeldedaten mit Round-Robin-Auswahl | Session-Affinität und Backoff-Logik beibehalten |

### Extensions

| Upstream                      | Unser Fork                                 |
| ----------------------------- | ------------------------------------------ |
| `jiti` für TypeScript-Laden   | Nativer Bun `import()`                     |
| `pkg.pi`-Manifestfeld        | `pkg.xcsh ?? pkg.pi` (unser Namespace bevorzugt) |

### Diese Upstream-Features überspringen

Beim Portieren **überspringen** Sie diese Dateien/Features vollständig:

- `footer-data-provider.ts` — wir verwenden StatusLineComponent
- `clipboard-image.ts` — Clipboard ist im `@f5xc-salesdemos/pi-natives` N-API-Modul
- GitHub-Workflow-Dateien — wir haben unsere eigene CI
- `models.generated.ts` — automatisch generiert, lokal neu generieren (als models.json stattdessen)

### Features, die wir hinzugefügt haben (Diese bewahren)

Diese existieren in unserem Fork, aber nicht Upstream. **Niemals überschreiben:**

- `StatusLineComponent` im interaktiven Modus
- Multi-Anmeldedaten-Auth mit Session-Affinität
- Fähigkeitsbasiertes Discovery-System (`defineCapability`, `registerProvider`, `loadCapability`, `skillCapability`, etc.)
- MCP/Exa/SSH-Integrationen
- LSP-Writethrough für Format-on-Save
- Bash-Interception (`checkBashInterception`)
- Fuzzy-Pfadvorschläge im Read-Tool
