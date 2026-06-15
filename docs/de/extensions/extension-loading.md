---
title: Erweiterungsladen (TypeScript/JavaScript-Module)
description: >-
  TypeScript- und JavaScript-Modullading-Pipeline für Erweiterungen mit
  Auflösung, Validierung und Caching.
sidebar:
  order: 2
  label: Erweiterungsladen
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# Erweiterungsladen (TypeScript/JavaScript-Module)

Dieses Dokument beschreibt, wie der Coding-Agent **Erweiterungsmodule** (`.ts`/`.js`) beim Start erkennt und lädt.

Es behandelt **nicht** `gemini-extension.json`-Manifest-Erweiterungen (separat dokumentiert).

## Was dieses Subsystem leistet

Das Erweiterungsladen erstellt eine Liste von Modul-Einstiegsdateien, importiert jedes Modul mit Bun, führt seine Factory aus und gibt zurück:

- geladene Erweiterungsdefinitionen
- pfadbezogene Ladefehler (ohne den gesamten Ladevorgang abzubrechen)
- ein gemeinsames Erweiterungs-Laufzeitobjekt, das später von `ExtensionRunner` verwendet wird

## Primäre Implementierungsdateien

- `src/extensibility/extensions/loader.ts` — Pfaderkennung + Import/Ausführung
- `src/extensibility/extensions/index.ts` — öffentliche Exporte
- `src/extensibility/extensions/runner.ts` — Laufzeit-/Ereignisausführung nach dem Laden
- `src/discovery/builtin.ts` — nativer Auto-Discovery-Provider für Erweiterungsmodule
- `src/config/settings.ts` — lädt zusammengeführte `extensions`/`disabledExtensions`-Einstellungen

---

## Eingaben für das Erweiterungsladen

### 1) Automatisch erkannte native Erweiterungsmodule

`discoverAndLoadExtensions()` fragt zunächst Discovery-Provider nach `extension-module`-Capability-Einträgen und behält dann nur Provider-`native`-Einträge.

Effektive native Speicherorte:

- Projekt: `<cwd>/.xcsh/extensions`
- Benutzer: `~/.xcsh/agent/extensions`

Pfad-Wurzeln stammen vom nativen Provider (`SOURCE_PATHS.native`).

Hinweise:

- Die native Auto-Discovery basiert derzeit auf `.xcsh`.
- Legacy `.pi` wird in `package.json`-Manifest-Schlüsseln (`pi.extensions`) weiterhin akzeptiert, jedoch nicht als native Wurzel hier.

### 2) Explizit konfigurierte Pfade

Nach der Auto-Discovery werden konfigurierte Pfade angehängt und aufgelöst.

Konfigurierte Pfadquellen im Haupt-Session-Startpfad (`sdk.ts`):

1. CLI-bereitgestellte Pfade (`--extension/-e`, und `--hook` wird ebenfalls als Erweiterungspfad behandelt)
2. Einstellungs-Array `extensions` (zusammengeführte globale und Projekteinstellungen)

Globale Einstellungsdatei:

- `~/.xcsh/agent/config.yml` (oder benutzerdefiniertes Agent-Verzeichnis via `PI_CODING_AGENT_DIR`)

Projekteinstellungsdatei:

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

Verhaltensaufteilung:

- SDK: wenn `disableExtensionDiscovery=true`, werden `additionalExtensionPaths` weiterhin über `loadExtensions()` geladen.
- CLI-Pfadaufbau (`main.ts`) löscht CLI-Erweiterungspfade derzeit, wenn `--no-extensions` gesetzt ist, sodass explizite `-e/--hook` in diesem Modus nicht weitergeleitet werden.

### Bestimmte Erweiterungsmodule deaktivieren

Die Einstellung `disabledExtensions` filtert nach Erweiterungs-ID-Format:

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

## Pfad- und Eintragsauflösung

### Pfadnormalisierung

Für konfigurierte Pfade:

1. Unicode-Leerzeichen normalisieren
2. `~` erweitern
3. Bei relativen Pfaden gegen aktuelles `cwd` auflösen

### Wenn der konfigurierte Pfad eine Datei ist

Sie wird direkt als Moduleintragskandidat verwendet.

### Wenn der konfigurierte Pfad ein Verzeichnis ist

Auflösungsreihenfolge:

1. `package.json` in diesem Verzeichnis mit `xcsh.extensions` (oder Legacy `pi.extensions`) -> deklarierte Einträge verwenden
2. `index.ts`
3. `index.js`
4. Andernfalls eine Ebene nach Erweiterungseinträgen scannen:
   - direkte `*.ts` / `*.js`
   - Unterverzeichnis `index.ts` / `index.js`
   - Unterverzeichnis `package.json` mit `xcsh.extensions` / `pi.extensions`

Regeln und Einschränkungen:

- keine rekursive Erkennung über eine Unterverzeichnisebene hinaus
- deklarierte `extensions`-Manifest-Einträge werden relativ zu diesem Paketverzeichnis aufgelöst
- deklarierte Einträge werden nur einbezogen, wenn die Datei vorhanden ist/der Zugriff erlaubt ist
- bei `*/index.{ts,js}`-Paaren wird TypeScript gegenüber JavaScript bevorzugt
- Symlinks werden als zulässige Dateien/Verzeichnisse behandelt

### Ignorierverhalten unterscheidet sich je nach Quelle

- Native Auto-Discovery (`discoverExtensionModulePaths` in Discovery-Hilfsfunktionen) verwendet nativen Glob mit `gitignore: true` und `hidden: false`.
- Explizites konfiguriertes Verzeichnis-Scanning in `loader.ts` verwendet `readdir`-Regeln und wendet **keine** Gitignore-Filterung an.

---

## Ladereihenfolge und Vorrang

`discoverAndLoadExtensions()` erstellt eine geordnete Liste und ruft dann `loadExtensions()` auf.

Reihenfolge:

1. Nativ automatisch erkannte Module
2. Explizit konfigurierte Pfade (in angegebener Reihenfolge)

In `sdk.ts` lautet die konfigurierte Reihenfolge:

1. Zusätzliche CLI-Pfade
2. Einstellungen `extensions`

Deduplizierung:

- absolut pfadbasiert
- erster gefundener Pfad hat Vorrang
- spätere Duplikate werden ignoriert

Implikation: Wenn derselbe Modulpfad sowohl automatisch erkannt als auch explizit konfiguriert ist, wird er einmal an der ersten Position geladen (Phase der automatischen Erkennung).

---

## Modulimport und Factory-Vertrag

Jeder Kandidatenpfad wird mit dynamischem Import geladen:

- `await import(resolvedPath)`
- Factory ist `module.default ?? module`
- Factory muss eine Funktion sein (`ExtensionFactory`)

Wenn der Export keine Funktion ist, schlägt dieser Pfad mit einem strukturierten Fehler fehl und das Laden wird fortgesetzt.

---

## Fehlerbehandlung und Isolation

### Während des Ladens

Pro Erweiterungspfad werden Fehler als `{ path, error }` erfasst und verhindern nicht das Laden anderer Pfade.

Häufige Fälle:

- Importfehler / fehlende Datei
- ungültiger Factory-Export (keine Funktion)
- Ausnahme beim Ausführen der Factory

### Laufzeit-Isolationsmodell

- Erweiterungen sind **nicht sandboxed** (gleicher Prozess/Laufzeit).
- Sie teilen einen `EventBus` und eine `ExtensionRuntime`-Instanz.
- Während des Ladens werfen Laufzeit-Aktionsmethoden absichtlich `ExtensionRuntimeNotInitializedError`; die Aktionsverdrahtung erfolgt später in `ExtensionRunner.initialize()`.

### Nach dem Laden

Wenn Ereignisse durch `ExtensionRunner` laufen, werden Handler-Ausnahmen abgefangen und als Erweiterungsfehler ausgegeben, anstatt die Runner-Schleife zum Absturz zu bringen.

---

## Minimale Benutzer-/Projekt-Layout-Beispiele

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
