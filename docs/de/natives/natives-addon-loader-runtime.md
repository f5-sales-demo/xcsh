---
title: Natives Addon Loader Runtime
description: >-
  N-API Addon Loader Runtime mit Plattformerkennung, Fallback-Strategien und
  Modulauflösung.
sidebar:
  order: 3
  label: Addon Loader
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# Natives Addon Loader Runtime

Dieses Dokument bietet einen detaillierten Einblick in die Addon-Lade-/Validierungsschicht in `@f5xc-salesdemos/pi-natives`: wie `native.ts` entscheidet, welche `.node`-Datei geladen wird, wann die Extraktion eingebetteter Payloads ausgeführt wird und wie Startfehler gemeldet werden.

## Implementierungsdateien

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## Umfang und Verantwortlichkeit

Die Verantwortlichkeiten des Loaders/der Runtime sind bewusst eng gefasst:

- Erstellen einer plattform-/CPU-spezifischen Kandidatenliste für Addon-Dateinamen und -Verzeichnisse.
- Optionales Materialisieren eines eingebetteten Addons in ein versioniertes benutzerspezifisches Cache-Verzeichnis.
- Kandidaten in deterministischer Reihenfolge durchprobieren.
- Veraltete oder inkompatible Addons über `validateNative` ablehnen, bevor Bindings exponiert werden.

Außerhalb des Geltungsbereichs: modulspezifisches grep/text/highlight-Verhalten.

## Runtime-Eingaben und abgeleiteter Zustand

Bei der Modulinitialisierung (`export const native = loadNative();`) berechnet `native.ts` statischen Kontext:

- **Plattform-Tag**: ``${process.platform}-${process.arch}`` (zum Beispiel `darwin-arm64`).
- **Paketversion**: aus `packages/natives/package.json` (Feld `version`).
- **Kernverzeichnisse**:
  - `nativeDir`: paketlokales `packages/natives/native`.
  - `execDir`: Verzeichnis, das `process.execPath` enthält.
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`.
  - `userDataDir` Fallback:
    - Windows: `%LOCALAPPDATA%/xcsh` (oder `%USERPROFILE%/AppData/Local/xcsh`).
    - Nicht-Windows: `~/.local/bin`.
- **Compiled-Binary-Modus** (`isCompiledBinary`): true, wenn eines der Folgenden zutrifft:
  - Die Umgebungsvariable `PI_COMPILED` gesetzt ist, oder
  - `import.meta.url` Bun-Embedded-Marker enthält (`$bunfs`, `~BUN`, `%7EBUN`).
- **Varianten-Override**: `PI_NATIVE_VARIANT` (nur `modern`/`baseline`; ungültige Werte werden ignoriert).
- **Ausgewählte Variante**: expliziter Override, andernfalls AVX2-Erkennung zur Laufzeit auf x64 (`modern` bei AVX2, sonst `baseline`).

## Plattformunterstützung und Tag-Auflösung

`SUPPORTED_PLATFORMS` ist festgelegt auf:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

Verhaltensdetails:

- Nicht unterstützte Plattformen werden nicht vorab abgelehnt.
- Der Loader versucht zunächst alle berechneten Kandidaten.
- Wenn nichts geladen werden kann, wird ein expliziter Fehler für nicht unterstützte Plattformen mit Auflistung der unterstützten Tags ausgelöst.

Dies bewahrt nützliche Diagnoseinformationen für Beinahe-Treffer, während für tatsächlich nicht unterstützte Zielplattformen dennoch ein harter Fehler auftritt.

## Variantenauswahl (`modern` / `baseline` / Standard)

### x64-Verhalten

1. Wenn `PI_NATIVE_VARIANT` auf `modern` oder `baseline` gesetzt ist, hat dieser Wert Vorrang.
2. Andernfalls AVX2-Unterstützung erkennen:
   - Linux: `/proc/cpuinfo` nach `avx2` durchsuchen.
   - macOS: `sysctl` abfragen (`machdep.cpu.leaf7_features`, Fallback `machdep.cpu.features`).
   - Windows: PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported` ausführen.
3. Ergebnis:
   - AVX2 verfügbar -> `modern`
   - AVX2 nicht verfügbar/nicht erkennbar -> `baseline`

### Nicht-x64-Verhalten

- Es wird keine Variante verwendet; der Loader bleibt beim Standard-Dateinamen (`pi_natives.<platform>-<arch>.node`).

### Dateinamen-Konstruktion

Gegeben `tag = <platform>-<arch>`:

- Nicht-x64 oder keine Variante: `pi_natives.<tag>.node`
- x64 + `modern`: in folgender Reihenfolge versuchen
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (beabsichtigter Fallback)
- x64 + `baseline`: nur `pi_natives.<tag>-baseline.node`

Das `addonLabel`, das in abschließenden Fehlermeldungen verwendet wird, ist entweder `<tag>` oder `<tag> (<variant>)`.

## Kandidatenpfad-Konstruktion und Fallback-Reihenfolge

`native.ts` erstellt Kandidaten-Pools vor jedem `require(...)`-Aufruf.

### Release-Kandidaten

Erstellt aus der variantenaufgelösten Dateinamenliste und in dieser Reihenfolge durchsucht:

- **Nicht-kompilierte Runtime**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **Kompilierte Runtime** (`PI_COMPILED` oder Bun-Embedded-Marker):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` entfernt Duplikate unter Beibehaltung der Reihenfolge des ersten Vorkommens.

### Abschließende Runtime-Sequenz

Zur Ladezeit:

1. Ein optionaler Kandidat aus der eingebetteten Extraktion (falls erzeugt) wird an den Anfang eingefügt.
2. Die verbleibenden deduplizierten Kandidaten werden der Reihe nach versucht.
3. Der erste Kandidat, der sowohl `require(...)` erfolgreich ausführt als auch `validateNative(...)` besteht, gewinnt.

## Lebenszyklus der eingebetteten Addon-Extraktion

`embedded-addon.ts` definiert eine generierte Manifeststruktur:

- `platformTag`
- `version`
- `files[]`, wobei jeder Eintrag `variant`, `filename`, `filePath` enthält

Der aktuell eingecheckte Standard ist `embeddedAddon: null`; kompilierte Artefakte können dies durch echte Metadaten ersetzen.

### Extraktions-Zustandsmaschine

Die Extraktion (`maybeExtractEmbeddedAddon`) wird nur ausgeführt, wenn alle Bedingungen erfüllt sind:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. Eine variantengerechte eingebettete Datei gefunden wird

Die Auswahl der Variantendatei spiegelt die beabsichtigte Runtime-Variante wider:

- Nicht-x64: `default` bevorzugen, dann erste verfügbare Datei.
- x64 + `modern`: `modern` bevorzugen, Fallback auf `baseline`.
- x64 + `baseline`: `baseline` erforderlich.

Materialisierungsverhalten:

1. Sicherstellen, dass `<versionedDir>` existiert (`mkdirSync(..., { recursive: true })`).
2. Wenn `<versionedDir>/<selected filename>` bereits existiert, wird es wiederverwendet (kein erneutes Schreiben).
3. Andernfalls eingebettete Quelldatei `filePath` lesen und Zieldatei schreiben.
4. Zielpfad für den Ladeversuch mit höchster Priorität zurückgeben.

Bei einem Fehler stürzt die Extraktion nicht sofort ab; sie fügt einen Fehlereintrag hinzu (Verzeichniserstellung oder Schreibfehler) und der Loader fährt mit dem normalen Kandidaten-Probing fort.

## Lebenszyklus und Zustandsübergänge

```text
Init
  -> Compute platform/version/variant/candidate lists
  -> (Compiled + embedded manifest matches?)
       yes -> Try extract embedded to versionedDir (record errors, continue)
       no  -> Skip extraction
  -> For each runtime candidate in order:
       require(candidate)
       -> success: validateNative
            -> pass: return bindings (READY)
            -> fail: record error, continue
       -> failure: record error, continue
  -> none loaded:
       if unsupported platform tag -> throw Unsupported platform
       else -> throw Failed to load (full tried-path diagnostics + hints)
```

## Vertragsprüfungen durch `validateNative`

`validateNative(bindings, source)` erzwingt einen reinen Funktionsvertrag über `NativeBindings` beim Start.

Mechanik:

- Für jeden erforderlichen Exportnamen wird geprüft, ob `typeof bindings[name] === "function"` gilt.
- Fehlende Namen werden aggregiert.
- Wenn welche fehlen, wirft der Loader:
  - den Quell-Addon-Pfad,
  - die Liste fehlender Exports,
  - einen Hinweis zum Rebuild-Befehl.

Dies ist eine harte Kompatibilitätssperre gegen veraltete Binärdateien, unvollständige Builds und Symbol-/Namensdrift.

### JS-API ↔ native Export-Zuordnung (Validierungssperre)

| In `validateNative` geprüfter JS-Binding-Name | Erwarteter nativer Exportname |
| --- | --- |
| `grep` | `grep` |
| `glob` | `glob` |
| `highlightCode` | `highlightCode` |
| `executeShell` | `executeShell` |
| `PtySession` | `PtySession` |
| `Shell` | `Shell` |
| `visibleWidth` | `visibleWidth` |
| `getSystemInfo` | `getSystemInfo` |
| `getWorkProfile` | `getWorkProfile` |
| `invalidateFsScanCache` | `invalidateFsScanCache` |

Hinweis: `bindings.ts` deklariert nur das Basis-Member `cancelWork(id)`; Modul-`types.ts`-Dateien erweitern per Declaration-Merging zusätzliche Symbole, die `validateNative` erzwingt.

## Fehlerverhalten und Diagnose

## Nicht unterstützte Plattform

Wenn alle Kandidaten fehlschlagen und `platformTag` nicht in `SUPPORTED_PLATFORMS` enthalten ist, wirft der Loader:

- `Unsupported platform: <tag>`
- Vollständige Liste unterstützter Plattformen
- Explizite Hinweise zur Fehlermeldung

## Veraltete Binärdatei / Symptome bei Nichtübereinstimmung

Typisches Signal für veraltete Nichtübereinstimmung:

- `Native addon missing exports (<candidate>). Missing: ...`

Häufige Ursachen:

- Alte `.node`-Binärdatei aus vorheriger Paketversion/API-Form.
- Falsches Varianten-Artefakt ausgewählt (für x64).
- Neuer Rust-Export nicht im geladenen Artefakt vorhanden.

Loader-Verhalten:

- Zeichnet pro Kandidat Fehler bei fehlenden Exports auf.
- Fährt mit dem Probing der verbleibenden Kandidaten fort.
- Wenn kein Kandidat validiert, enthält der finale Fehler jeden versuchten Pfad mit der jeweiligen Fehlermeldung.

## Startfehler im Compiled-Binary-Modus

Im kompilierten Modus enthalten die finalen Diagnoseinformationen:

- erwartete versionierte Cache-Zielpfade (`<versionedDir>/<filename>`),
- Behebungsmaßnahme zum Löschen des veralteten `<versionedDir>` und erneuter Ausführung,
- direkte Release-Download-`curl`-Befehle für jeden erwarteten Dateinamen.

## Startfehler im nicht-kompilierten Modus

Im normalen Paket-/Runtime-Modus enthalten die finalen Diagnoseinformationen:

- Neuinstallationshinweis (`bun install @f5xc-salesdemos/pi-natives`),
- lokalen Rebuild-Befehl (`bun --cwd=packages/natives run build`),
- optionalen x64-Varianten-Build-Hinweis (`TARGET_VARIANT=baseline|modern ...`).

## Runtime-Verhalten

- Der Loader verwendet immer die Release-Kandidatenkette.
- Das Setzen von `PI_DEV` aktiviert lediglich pro-Kandidat-Konsolendiagnosen (`Loaded native addon...` und Ladefehler).
