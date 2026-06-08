---
title: Extension Loading (TypeScript/JavaScript Modules)
description: >-
  TypeScript- und JavaScript-Modul-Ladepipeline für Extensions mit Auflösung,
  Validierung und Caching.
sidebar:
  order: 2
  label: Extension Loading
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# Extension Loading (TypeScript/JavaScript-Module)

Dieses Dokument behandelt, wie der Coding Agent **Extension-Module** (`.ts`/`.js`) beim Start erkennt und lädt.

Es behandelt **nicht** `gemini-extension.json`-Manifest-Extensions (separat dokumentiert).

## Was dieses Subsystem leistet

Das Extension Loading erstellt eine Liste von Modul-Einstiegsdateien, importiert jedes Modul mit Bun, führt dessen Factory aus und gibt zurück:

- geladene Extension-Definitionen
- Ladefehler pro Pfad (ohne den gesamten Ladevorgang abzubrechen)
- ein gemeinsames Extension-Runtime-Objekt, das später von `ExtensionRunner` verwendet wird

## Primäre Implementierungsdateien

- `src/extensibility/extensions/loader.ts` — Pfaderkennung + Import/Ausführung
- `src/extensibility/extensions/index.ts` — öffentliche Exports
- `src/extensibility/extensions/runner.ts` — Runtime/Event-Ausführung nach dem Laden
- `src/discovery/builtin.ts` — nativer Auto-Discovery-Provider für Extension-Module
- `src/config/settings.ts` — lädt zusammengeführte `extensions`-/`disabledExtensions`-Einstellungen

---

## Eingaben für das Extension Loading

### 1) Automatisch erkannte native Extension-Module

`discoverAndLoadExtensions()` fragt zunächst Discovery-Provider nach `extension-module`-Capability-Items ab und behält nur Items des Providers `native`.

Effektive native Speicherorte:

- Projekt: `<cwd>/.xcsh/extensions`
- Benutzer: `~/.xcsh/agent/extensions`

Pfadwurzeln stammen vom nativen Provider (`SOURCE_PATHS.native`).

Hinweise:

- Native Auto-Discovery basiert derzeit auf `.xcsh`.
- Legacy `.pi` wird weiterhin in `package.json`-Manifest-Schlüsseln (`pi.extensions`) akzeptiert, jedoch nicht als nativer Wurzelpfad hier.

### 2) Explizit konfigurierte Pfade

Nach der Auto-Discovery werden konfigurierte Pfade angehängt und aufgelöst.

Konfigurierte Pfadquellen im Hauptsitzungs-Startpfad (`sdk.ts`):

1. CLI-übergebene Pfade (`--extension/-e`, und `--hook` wird ebenfalls als Extension-Pfad behandelt)
2. Settings-Array `extensions` (zusammengeführte globale + Projekt-Einstellungen)

Globale Einstellungsdatei:

- `~/.xcsh/agent/config.yml` (oder benutzerdefiniertes Agent-Verzeichnis via `PI_CODING_AGENT_DIR`)

Projekt-Einstellungsdatei:

- `<cwd>/.xcsh/settings.json`

Beispiele:

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

## Aktivierungs-/Deaktivierungssteuerung

### Discovery deaktivieren

- CLI: `--no-extensions`
- SDK-Option: `disableExtensionDiscovery`

Verhaltensunterscheidung:

- SDK: Bei `disableExtensionDiscovery=true` werden `additionalExtensionPaths` weiterhin über `loadExtensions()` geladen.
- CLI-Pfadaufbau (`main.ts`) löscht derzeit CLI-Extension-Pfade, wenn `--no-extensions` gesetzt ist, sodass explizite `-e/--hook` in diesem Modus nicht weitergeleitet werden.

### Bestimmte Extension-Module deaktivieren

Die Einstellung `disabledExtensions` filtert nach Extension-ID-Format:

- `extension-module:<derivedName>`

`derivedName` basiert auf dem Einstiegspfad (`getExtensionNameFromPath`), zum Beispiel:

- `/x/foo.ts` -> `foo`
- `/x/bar/index.ts` -> `bar`

Beispiel:

```yaml
disabledExtensions:
  - extension-module:foo
```

---

## Pfad- und Einstiegsauflösung

### Pfadnormalisierung

Für konfigurierte Pfade:

1. Unicode-Leerzeichen normalisieren
2. `~` expandieren
3. Bei relativen Pfaden gegen das aktuelle `cwd` auflösen

### Wenn der konfigurierte Pfad eine Datei ist

Er wird direkt als Modul-Einstiegskandidat verwendet.

### Wenn der konfigurierte Pfad ein Verzeichnis ist

Auflösungsreihenfolge:

1. `package.json` in diesem Verzeichnis mit `xcsh.extensions` (oder Legacy `pi.extensions`) -> deklarierte Einträge verwenden
2. `index.ts`
3. `index.js`
4. Andernfalls eine Ebene nach Extension-Einträgen durchsuchen:
   - direkte `*.ts` / `*.js`
   - Unterverzeichnis `index.ts` / `index.js`
   - Unterverzeichnis `package.json` mit `xcsh.extensions` / `pi.extensions`

Regeln und Einschränkungen:

- Keine rekursive Erkennung über eine Unterverzeichnisebene hinaus
- Deklarierte `extensions`-Manifest-Einträge werden relativ zu diesem Paketverzeichnis aufgelöst
- Deklarierte Einträge werden nur einbezogen, wenn die Datei existiert/Zugriff erlaubt ist
- Bei `*/index.{ts,js}`-Paaren wird TypeScript gegenüber JavaScript bevorzugt
- Symlinks werden als zulässige Dateien/Verzeichnisse behandelt

### Ignorierungsverhalten unterscheidet sich nach Quelle

- Native Auto-Discovery (`discoverExtensionModulePaths` in Discovery-Helfern) verwendet natives Glob mit `gitignore: true` und `hidden: false`.
- Explizites konfiguriertes Verzeichnis-Scanning in `loader.ts` verwendet `readdir`-Regeln und wendet **keine** Gitignore-Filterung an.

---

## Ladereihenfolge und Priorität

`discoverAndLoadExtensions()` erstellt eine geordnete Liste und ruft dann `loadExtensions()` auf.

Reihenfolge:

1. Nativ automatisch erkannte Module
2. Explizit konfigurierte Pfade (in angegebener Reihenfolge)

In `sdk.ts` ist die konfigurierte Reihenfolge:

1. Zusätzliche CLI-Pfade
2. Settings `extensions`

Deduplizierung:

- Basierend auf absoluten Pfaden
- Der zuerst gefundene Pfad gewinnt
- Spätere Duplikate werden ignoriert

Implikation: Wenn derselbe Modulpfad sowohl automatisch erkannt als auch explizit konfiguriert ist, wird er einmal an der ersten Position geladen (Auto-Discovery-Phase).

---

## Modul-Import und Factory-Vertrag

Jeder Kandidatenpfad wird per dynamischem Import geladen:

- `await import(resolvedPath)`
- Factory ist `module.default ?? module`
- Factory muss eine Funktion sein (`ExtensionFactory`)

Wenn der Export keine Funktion ist, schlägt dieser Pfad mit einem strukturierten Fehler fehl und das Laden wird fortgesetzt.

---

## Fehlerbehandlung und Isolation

### Während des Ladens

Pro Extension-Pfad werden Fehler als `{ path, error }` erfasst und verhindern nicht das Laden anderer Pfade.

Häufige Fälle:

- Importfehler / fehlende Datei
- Ungültiger Factory-Export (keine Funktion)
- Ausnahme beim Ausführen der Factory

### Runtime-Isolationsmodell

- Extensions sind **nicht sandboxed** (gleicher Prozess/Runtime).
- Sie teilen sich einen `EventBus` und eine `ExtensionRuntime`-Instanz.
- Während des Ladens werfen Runtime-Action-Methoden absichtlich `ExtensionRuntimeNotInitializedError`; die Action-Verdrahtung erfolgt später in `ExtensionRunner.initialize()`.

### Nach dem Laden

Wenn Events über `ExtensionRunner` ausgeführt werden, werden Handler-Ausnahmen abgefangen und als Extension-Fehler emittiert, anstatt die Runner-Schleife zum Absturz zu bringen.

---

## Minimale Benutzer-/Projekt-Layoutbeispiele

### Benutzerebene

```text
~/.xcsh/agent/
  config.yml
  extensions/
    guardrails.ts
    audit/
      index.ts
```

### Projektebene

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

Legacy-Manifest-Schlüssel wird weiterhin akzeptiert:

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
