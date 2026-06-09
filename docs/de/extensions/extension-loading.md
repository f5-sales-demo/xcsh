---
title: Laden von Erweiterungen (TypeScript/JavaScript-Module)
description: >-
  TypeScript- und JavaScript-Modul-Ladepipeline für Erweiterungen mit Auflösung,
  Validierung und Caching.
sidebar:
  order: 2
  label: Laden von Erweiterungen
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# Laden von Erweiterungen (TypeScript/JavaScript-Module)

Dieses Dokument behandelt, wie der Coding-Agent **Erweiterungsmodule** (`.ts`/`.js`) beim Start erkennt und lädt.

Es behandelt **nicht** `gemini-extension.json`-Manifest-Erweiterungen (separat dokumentiert).

## Was dieses Subsystem tut

Das Laden von Erweiterungen erstellt eine Liste von Modul-Einstiegsdateien, importiert jedes Modul mit Bun, führt dessen Factory aus und gibt zurück:

- geladene Erweiterungsdefinitionen
- pfadbezogene Ladefehler (ohne den gesamten Ladevorgang abzubrechen)
- ein gemeinsames Erweiterungs-Laufzeitobjekt, das später von `ExtensionRunner` verwendet wird

## Primäre Implementierungsdateien

- `src/extensibility/extensions/loader.ts` — Pfaderkennung + Import/Ausführung
- `src/extensibility/extensions/index.ts` — öffentliche Exporte
- `src/extensibility/extensions/runner.ts` — Laufzeit-/Ereignisausführung nach dem Laden
- `src/discovery/builtin.ts` — nativer Auto-Discovery-Provider für Erweiterungsmodule
- `src/config/settings.ts` — lädt zusammengeführte `extensions`- / `disabledExtensions`-Einstellungen

---

## Eingaben für das Laden von Erweiterungen

### 1) Automatisch erkannte native Erweiterungsmodule

`discoverAndLoadExtensions()` fragt zunächst Discovery-Provider nach `extension-module`-Fähigkeitseinträgen ab und behält dann nur Provider-`native`-Einträge.

Effektive native Speicherorte:

- Projekt: `<cwd>/.xcsh/extensions`
- Benutzer: `~/.xcsh/agent/extensions`

Pfad-Stammverzeichnisse stammen vom nativen Provider (`SOURCE_PATHS.native`).

Hinweise:

- Native Auto-Discovery basiert derzeit auf `.xcsh`.
- Legacy `.pi` wird in `package.json`-Manifest-Schlüsseln (`pi.extensions`) noch akzeptiert, aber hier nicht als nativer Stammordner.

### 2) Explizit konfigurierte Pfade

Nach der Auto-Discovery werden konfigurierte Pfade angehängt und aufgelöst.

Konfigurierte Pfadquellen im Hauptsitzungs-Startpfad (`sdk.ts`):

1. Über die Kommandozeile bereitgestellte Pfade (`--extension/-e`, und `--hook` wird ebenfalls als Erweiterungspfad behandelt)
2. Einstellungsarray `extensions` (zusammengeführte globale + Projekteinstellungen)

Globale Einstellungsdatei:

- `~/.xcsh/agent/config.yml` (oder benutzerdefiniertes Agent-Verzeichnis über `PI_CODING_AGENT_DIR`)

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

## Aktivierungs-/Deaktivierungssteuerungen

### Discovery deaktivieren

- Kommandozeile: `--no-extensions`
- SDK-Option: `disableExtensionDiscovery`

Verhaltensaufteilung:

- SDK: Wenn `disableExtensionDiscovery=true`, werden `additionalExtensionPaths` dennoch über `loadExtensions()` geladen.
- Der CLI-Pfadaufbau (`main.ts`) leert derzeit CLI-Erweiterungspfade, wenn `--no-extensions` gesetzt ist, sodass explizite `-e/--hook` in diesem Modus nicht weitergeleitet werden.

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
4. Andernfalls eine Ebene nach Erweiterungseinträgen durchsuchen:
   - direkte `*.ts` / `*.js`
   - Unterverzeichnis `index.ts` / `index.js`
   - Unterverzeichnis `package.json` mit `xcsh.extensions` / `pi.extensions`

Regeln und Einschränkungen:

- keine rekursive Erkennung über eine Unterverzeichnisebene hinaus
- deklarierte `extensions`-Manifesteinträge werden relativ zu diesem Paketverzeichnis aufgelöst
- deklarierte Einträge werden nur einbezogen, wenn die Datei existiert/der Zugriff erlaubt ist
- bei `*/index.{ts,js}`-Paaren wird TypeScript gegenüber JavaScript bevorzugt
- symbolische Links werden als gültige Dateien/Verzeichnisse behandelt

### Ignorierverhalten unterscheidet sich nach Quelle

- Native Auto-Discovery (`discoverExtensionModulePaths` in Discovery-Helfern) verwendet nativen Glob mit `gitignore: true` und `hidden: false`.
- Explizites konfiguriertes Verzeichnis-Scanning in `loader.ts` verwendet `readdir`-Regeln und wendet **keine** Gitignore-Filterung an.

---

## Ladereihenfolge und Priorität

`discoverAndLoadExtensions()` erstellt eine geordnete Liste und ruft dann `loadExtensions()` auf.

Reihenfolge:

1. Nativ automatisch erkannte Module
2. Explizit konfigurierte Pfade (in bereitgestellter Reihenfolge)

In `sdk.ts` ist die konfigurierte Reihenfolge:

1. Zusätzliche CLI-Pfade
2. `extensions`-Einstellungen

Deduplizierung:

- basiert auf absoluten Pfaden
- der zuerst gesehene Pfad gewinnt
- spätere Duplikate werden ignoriert

Auswirkung: Wenn derselbe Modulpfad sowohl automatisch erkannt als auch explizit konfiguriert ist, wird er einmal an der ersten Position (Auto-Discovery-Phase) geladen.

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

Pro Erweiterungspfad werden Fehler als `{ path, error }` erfasst und stoppen das Laden anderer Pfade nicht.

Häufige Fälle:

- Importfehler / fehlende Datei
- ungültiger Factory-Export (keine Funktion)
- Ausnahme beim Ausführen der Factory

### Laufzeit-Isolationsmodell

- Erweiterungen sind **nicht sandboxed** (gleicher Prozess/gleiche Laufzeit).
- Sie teilen sich einen `EventBus` und eine `ExtensionRuntime`-Instanz.
- Während des Ladens werfen Laufzeit-Aktionsmethoden absichtlich `ExtensionRuntimeNotInitializedError`; die Aktionsverdrahtung erfolgt später in `ExtensionRunner.initialize()`.

### Nach dem Laden

Wenn Ereignisse durch `ExtensionRunner` laufen, werden Handler-Ausnahmen abgefangen und als Erweiterungsfehler emittiert, anstatt die Runner-Schleife zum Absturz zu bringen.

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

Legacy-Manifest-Schlüssel wird noch akzeptiert:

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
