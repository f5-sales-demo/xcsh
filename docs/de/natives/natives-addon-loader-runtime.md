---
title: Natives Addon Loader Runtime
description: >-
  N-API addon loader runtime mit Plattformerkennung, Fallback-Strategien und
  Modulauflösung.
sidebar:
  order: 3
  label: Addon-Loader
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# Natives Addon Loader Runtime

Dieses Dokument erläutert die Addon-Lade-/Validierungsschicht in `@f5xc-salesdemos/pi-natives` im Detail: wie `native.ts` entscheidet, welche `.node`-Datei geladen wird, wann die Extraktion eingebetteter Payloads ausgeführt wird und wie Startfehler gemeldet werden.

## Implementierungsdateien

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## Umfang und Verantwortlichkeiten

Die Loader-/Runtime-Verantwortlichkeiten sind bewusst eng gefasst:

- Eine plattform-/CPU-bewusste Kandidatenliste für Addon-Dateinamen und -Verzeichnisse erstellen.
- Optional ein eingebettetes Addon in ein versioniertes benutzerspezifisches Cache-Verzeichnis materialisieren.
- Kandidaten in deterministischer Reihenfolge versuchen.
- Veraltete oder inkompatible Addons über `validateNative` ablehnen, bevor Bindungen bereitgestellt werden.

Nicht im Umfang enthalten: modulspezifisches Grep-/Text-/Hervorhebungsverhalten.

## Laufzeiteingaben und abgeleiteter Zustand

Bei der Modulinitialisierung (`export const native = loadNative();`) berechnet `native.ts` einen statischen Kontext:

- **Plattform-Tag**: ``${process.platform}-${process.arch}`` (zum Beispiel `darwin-arm64`).
- **Paketversion**: aus `packages/natives/package.json` (Feld `version`).
- **Kernverzeichnisse**:
  - `nativeDir`: paketlokales Verzeichnis `packages/natives/native`.
  - `execDir`: Verzeichnis mit `process.execPath`.
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`.
  - Fallback `userDataDir`:
    - Windows: `%LOCALAPPDATA%/xcsh` (oder `%USERPROFILE%/AppData/Local/xcsh`).
    - Nicht-Windows: `~/.local/bin`.
- **Kompilierter-Binär-Modus** (`isCompiledBinary`): true, wenn eines der folgenden zutrifft:
  - Umgebungsvariable `PI_COMPILED` gesetzt, oder
  - `import.meta.url` enthält Bun-eingebettete Marker (`$bunfs`, `~BUN`, `%7EBUN`).
- **Varianten-Override**: `PI_NATIVE_VARIANT` (nur `modern`/`baseline`; ungültige Werte werden ignoriert).
- **Ausgewählte Variante**: expliziter Override, andernfalls AVX2-Laufzeiterkennung auf x64 (`modern` bei AVX2, sonst `baseline`).

## Plattformunterstützung und Tag-Auflösung

`SUPPORTED_PLATFORMS` ist fest definiert auf:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

Verhaltensdetail:

- Nicht unterstützte Plattformen werden nicht vorab abgelehnt.
- Der Loader versucht trotzdem alle berechneten Kandidaten zuerst.
- Wenn nichts geladen werden kann, wird ein expliziter Fehler für nicht unterstützte Plattformen ausgegeben, der die unterstützten Tags auflistet.

Dies bewahrt nützliche Diagnoseinformationen für nahezu passende Fälle und schlägt dennoch hart fehl für wirklich nicht unterstützte Ziele.

## Variantenauswahl (`modern` / `baseline` / Standard)

### x64-Verhalten

1. Wenn `PI_NATIVE_VARIANT` den Wert `modern` oder `baseline` hat, gewinnt dieser Wert.
2. Andernfalls AVX2-Unterstützung erkennen:
   - Linux: `/proc/cpuinfo` nach `avx2` durchsuchen.
   - macOS: `sysctl` abfragen (`machdep.cpu.leaf7_features`, Fallback `machdep.cpu.features`).
   - Windows: PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported` ausführen.
3. Ergebnis:
   - AVX2 verfügbar -> `modern`
   - AVX2 nicht verfügbar/nicht erkennbar -> `baseline`

### Nicht-x64-Verhalten

- Es wird keine Variante verwendet; der Loader bleibt beim Standard-Dateinamen (`pi_natives.<platform>-<arch>.node`).

### Dateinamenerstellung

Gegeben `tag = <platform>-<arch>`:

- Nicht-x64 oder keine Variante: `pi_natives.<tag>.node`
- x64 + `modern`: in dieser Reihenfolge versuchen
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (absichtlicher Fallback)
- x64 + `baseline`: nur `pi_natives.<tag>-baseline.node`

Das `addonLabel`, das in finalen Fehlermeldungen verwendet wird, ist entweder `<tag>` oder `<tag> (<variant>)`.

## Kandidatenpfad-Erstellung und Fallback-Reihenfolge

`native.ts` erstellt Kandidaten-Pools vor jedem `require(...)`-Aufruf.

### Release-Kandidaten

Aus der variantenaufgelösten Dateinamenliste erstellt und in dieser Reihenfolge durchsucht:

- **Nicht-kompilierte Runtime**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **Kompilierte Runtime** (`PI_COMPILED` oder Bun-eingebettete Marker):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` entfernt Duplikate und bewahrt dabei die Reihenfolge des ersten Auftretens.

### Finale Runtime-Sequenz

Beim Laden:

1. Ein optionaler eingebetteter Extraktionskandidat (sofern erstellt) wird an den Anfang eingefügt.
2. Die verbleibenden deduplizierten Kandidaten werden der Reihe nach versucht.
3. Der erste Kandidat, der sowohl `require(...)`-kompatibel ist als auch `validateNative(...)` besteht, gewinnt.

## Lebenszyklus der eingebetteten Addon-Extraktion

`embedded-addon.ts` definiert eine generierte Manifest-Form:

- `platformTag`
- `version`
- `files[]`, wobei jeder Eintrag `variant`, `filename`, `filePath` enthält

Der aktuell eingecheckte Standard ist `embeddedAddon: null`; kompilierte Artefakte können dies durch echte Metadaten ersetzen.

### Zustandsautomat für die Extraktion

Die Extraktion (`maybeExtractEmbeddedAddon`) wird nur ausgeführt, wenn alle Bedingungen erfüllt sind:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. Eine variantengeeignete eingebettete Datei wird gefunden

Die Variantendateiauswahl spiegelt die Runtime-Variantenabsicht wider:

- Nicht-x64: `default` bevorzugen, dann erste verfügbare Datei.
- x64 + `modern`: `modern` bevorzugen, Fallback auf `baseline`.
- x64 + `baseline`: `baseline` erforderlich.

Materialisierungsverhalten:

1. Sicherstellen, dass `<versionedDir>` existiert (`mkdirSync(..., { recursive: true })`).
2. Wenn `<versionedDir>/<selected filename>` bereits existiert, wiederverwenden (kein Neuschreiben).
3. Andernfalls eingebettete Quelldatei `filePath` lesen und Zieldatei schreiben.
4. Zielpfad für den Ladeversuch mit höchster Priorität zurückgeben.

Bei einem Fehler stürzt die Extraktion nicht sofort ab; stattdessen wird ein Fehlereintrag (Verzeichniserstellungs- oder Schreibfehler) angehängt und der Loader fährt mit der normalen Kandidatensondierung fort.

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

## `validateNative`-Vertragsüberprüfungen

`validateNative(bindings, source)` erzwingt beim Start einen reinen Funktionsvertrag über `NativeBindings`.

Mechanik:

- Für jeden erforderlichen Export-Namen prüft es `typeof bindings[name] === "function"`.
- Fehlende Namen werden aggregiert.
- Wenn welche fehlen, wirft der Loader einen Fehler mit:
  - Quell-Addon-Pfad,
  - Liste fehlender Exporte,
  - Hinweis zum Rebuild-Befehl.

Dies ist ein hartes Kompatibilitätsgatter gegen veraltete Binärdateien, unvollständige Builds und Symbol-/Namensabweichungen.

### JS-API ↔ nativer Export-Mapping (Validierungsgatter)

| In `validateNative` geprüfter JS-Bindungsname | Erwarteter nativer Exportname |
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

Hinweis: `bindings.ts` deklariert nur das Basismember `cancelWork(id)`; Modul-`types.ts`-Dateien deklarieren per Declaration-Merging zusätzliche Symbole, die `validateNative` erzwingt.

## Fehlerverhalten und Diagnose

## Nicht unterstützte Plattform

Wenn alle Kandidaten fehlschlagen und `platformTag` nicht in `SUPPORTED_PLATFORMS` enthalten ist, wirft der Loader:

- `Unsupported platform: <tag>`
- Vollständige Liste unterstützter Plattformen
- Explizite Anleitung zur Fehlermeldung

## Symptome veralteter Binärdatei / Nichtübereinstimmung

Typisches Signal einer veralteten Nichtübereinstimmung:

- `Native addon missing exports (<candidate>). Missing: ...`

Häufige Ursachen:

- Alte `.node`-Binärdatei aus früherer Paketversion/API-Form.
- Falsch ausgewähltes Varianten-Artefakt (bei x64).
- Neuer Rust-Export nicht im geladenen Artefakt vorhanden.

Loader-Verhalten:

- Zeichnet pro Kandidat fehlende Export-Fehler auf.
- Setzt die Sondierung verbleibender Kandidaten fort.
- Wenn kein Kandidat validiert wird, enthält der finale Fehler jeden versuchten Pfad mit der jeweiligen Fehlermeldung.

## Kompilierte Binär-Startfehler

Im kompilierten Modus enthalten die finalen Diagnoseinformationen:

- erwartete versionierte Cache-Zielpfade (`<versionedDir>/<filename>`),
- Abhilfemaßnahme zum Löschen des veralteten `<versionedDir>` und erneutem Ausführen,
- direkte Release-Download-`curl`-Befehle für jeden erwarteten Dateinamen.

## Nicht-kompilierte Startfehler

Im normalen Paket-/Runtime-Modus enthalten die finalen Diagnoseinformationen:

- Neuinstallations-Hinweis (`bun install @f5xc-salesdemos/pi-natives`),
- lokalen Rebuild-Befehl (`bun --cwd=packages/natives run build`),
- optionalen x64-Varianten-Build-Hinweis (`TARGET_VARIANT=baseline|modern ...`).

## Laufzeitverhalten

- Der Loader verwendet immer die Release-Kandidatenkette.
- Das Setzen von `PI_DEV` aktiviert nur Pro-Kandidat-Konsolendiagnose (`Loaded native addon...` und Ladefehler).
