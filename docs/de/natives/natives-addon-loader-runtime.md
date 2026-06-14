---
title: Natives Addon Loader Runtime
description: >-
  N-API Addon Loader Runtime mit Plattformerkennung, Fallback-Strategien und
  Modulauflösung.
sidebar:
  order: 3
  label: Addon-Loader
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# Natives Addon Loader Runtime

Dieses Dokument beschreibt die Addon-Lade-/Validierungsschicht in `@f5xc-salesdemos/pi-natives` im Detail: wie `native.ts` entscheidet, welche `.node`-Datei geladen wird, wann die Extraktion eingebetteter Payloads ausgeführt wird und wie Startfehler gemeldet werden.

## Implementierungsdateien

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## Umfang und Verantwortlichkeit

Die Loader-/Runtime-Verantwortlichkeiten sind bewusst eng gefasst:

- Aufbau einer plattform-/CPU-bewussten Kandidatenliste für Addon-Dateinamen und Verzeichnisse.
- Optionale Materialisierung eines eingebetteten Addons in ein versioniertes benutzerspezifisches Cache-Verzeichnis.
- Versuchen der Kandidaten in deterministischer Reihenfolge.
- Ablehnung veralteter oder inkompatibler Addons über `validateNative`, bevor Bindings freigegeben werden.

Nicht in diesem Dokument enthalten: modulspezifisches Grep-/Text-/Highlight-Verhalten.

## Laufzeiteingaben und abgeleiteter Zustand

Bei der Modulinitialisierung (`export const native = loadNative();`) berechnet `native.ts` einen statischen Kontext:

- **Plattform-Tag**: ``${process.platform}-${process.arch}`` (zum Beispiel `darwin-arm64`).
- **Paketversion**: aus `packages/natives/package.json` (Feld `version`).
- **Kernverzeichnisse**:
  - `nativeDir`: paketlokales Verzeichnis `packages/natives/native`.
  - `execDir`: Verzeichnis, das `process.execPath` enthält.
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`.
  - `userDataDir`-Fallback:
    - Windows: `%LOCALAPPDATA%/xcsh` (oder `%USERPROFILE%/AppData/Local/xcsh`).
    - Nicht-Windows: `~/.local/bin`.
- **Kompilierter-Binär-Modus** (`isCompiledBinary`): true, wenn eine der folgenden Bedingungen zutrifft:
  - Die Umgebungsvariable `PI_COMPILED` ist gesetzt, oder
  - `import.meta.url` enthält Bun-eingebettete Marker (`$bunfs`, `~BUN`, `%7EBUN`).
- **Varianten-Override**: `PI_NATIVE_VARIANT` (nur `modern`/`baseline`; ungültige Werte werden ignoriert).
- **Ausgewählte Variante**: expliziter Override, andernfalls AVX2-Erkennung zur Laufzeit auf x64 (`modern` bei AVX2, sonst `baseline`).

## Plattformunterstützung und Tag-Auflösung

`SUPPORTED_PLATFORMS` ist fest auf folgende Werte eingestellt:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

Verhaltensdetail:

- Nicht unterstützte Plattformen werden nicht vorab abgelehnt.
- Der Loader versucht zunächst alle berechneten Kandidaten.
- Falls nichts geladen werden kann, wird ein expliziter Fehler für nicht unterstützte Plattformen ausgegeben, der die unterstützten Tags auflistet.

Dies gewährleistet nützliche Diagnoseinformationen für Randfälle, während bei tatsächlich nicht unterstützten Zielen weiterhin ein harter Fehler ausgelöst wird.

## Variantenauswahl (`modern` / `baseline` / Standard)

### x64-Verhalten

1. Wenn `PI_NATIVE_VARIANT` den Wert `modern` oder `baseline` hat, hat dieser Wert Vorrang.
2. Andernfalls wird die AVX2-Unterstützung erkannt:
   - Linux: `/proc/cpuinfo` nach `avx2` durchsuchen.
   - macOS: `sysctl` abfragen (`machdep.cpu.leaf7_features`, Fallback `machdep.cpu.features`).
   - Windows: PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported` ausführen.
3. Ergebnis:
   - AVX2 verfügbar -> `modern`
   - AVX2 nicht verfügbar/nicht erkennbar -> `baseline`

### Nicht-x64-Verhalten

- Es wird keine Variante verwendet; der Loader bleibt beim Standard-Dateinamen (`pi_natives.<platform>-<arch>.node`).

### Dateinamenskonstruktion

Gegeben `tag = <platform>-<arch>`:

- Nicht-x64 oder keine Variante: `pi_natives.<tag>.node`
- x64 + `modern`: in dieser Reihenfolge versuchen
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (absichtlicher Fallback)
- x64 + `baseline`: nur `pi_natives.<tag>-baseline.node`

Das `addonLabel`, das in abschließenden Fehlermeldungen verwendet wird, lautet entweder `<tag>` oder `<tag> (<variant>)`.

## Kandidatenpfadkonstruktion und Fallback-Reihenfolge

`native.ts` erstellt Kandidaten-Pools vor jedem `require(...)`-Aufruf.

### Release-Kandidaten

Aufgebaut aus der variantenaufgelösten Dateinamenliste und in dieser Reihenfolge durchsucht:

- **Nicht-kompilierte Laufzeit**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **Kompilierte Laufzeit** (`PI_COMPILED` oder Bun-eingebettete Marker):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` entfernt Duplikate unter Beibehaltung der Reihenfolge des ersten Vorkommens.

### Abschließende Laufzeitsequenz

Beim Laden:

1. Ein optionaler eingebetteter Extraktionskandidat (falls vorhanden) wird an den Anfang eingefügt.
2. Die verbleibenden deduplizierten Kandidaten werden der Reihe nach versucht.
3. Der erste Kandidat, der sowohl `require(...)`t als auch `validateNative(...)` besteht, gewinnt.

## Lebenszyklus der eingebetteten Addon-Extraktion

`embedded-addon.ts` definiert eine generierte Manifest-Form:

- `platformTag`
- `version`
- `files[]`, wobei jeder Eintrag `variant`, `filename`, `filePath` enthält

Der aktuell eingecheckte Standard ist `embeddedAddon: null`; kompilierte Artefakte können diesen durch echte Metadaten ersetzen.

### Zustandsautomat der Extraktion

Die Extraktion (`maybeExtractEmbeddedAddon`) wird nur ausgeführt, wenn alle Bedingungen erfüllt sind:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. Eine variantengerechte eingebettete Datei wird gefunden

Die Variantendateiauswahl spiegelt die Laufzeitvariante wider:

- Nicht-x64: `default` bevorzugen, dann erste verfügbare Datei.
- x64 + `modern`: `modern` bevorzugen, Fallback auf `baseline`.
- x64 + `baseline`: `baseline` erforderlich.

Materialisierungsverhalten:

1. Sicherstellen, dass `<versionedDir>` existiert (`mkdirSync(..., { recursive: true })`).
2. Falls `<versionedDir>/<selected filename>` bereits existiert, wiederverwenden (kein Neuschreiben).
3. Andernfalls eingebettete Quelldatei `filePath` lesen und Zieldatei schreiben.
4. Zielpfad für den Ladeversuch mit höchster Priorität zurückgeben.

Bei einem Fehler bricht die Extraktion nicht sofort ab; stattdessen wird ein Fehlereintrag (Verzeichniserstellungs- oder Schreibfehler) hinzugefügt und der Loader fährt mit der normalen Kandidatenprüfung fort.

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

`validateNative(bindings, source)` erzwingt beim Start einen ausschließlich funktionsbasierten Vertrag über `NativeBindings`.

Funktionsweise:

- Für jeden erforderlichen Exportnamen wird `typeof bindings[name] === "function"` geprüft.
- Fehlende Namen werden aggregiert.
- Falls welche fehlen, wirft der Loader einen Fehler mit:
  - Quell-Addon-Pfad,
  - Liste der fehlenden Exporte,
  - Hinweis auf den Rebuild-Befehl.

Dies ist ein harter Kompatibilitäts-Gate gegen veraltete Binärdateien, unvollständige Builds und Symbol-/Namensabweichungen.

### JS-API ↔ nativer Export-Mapping (Validierungs-Gate)

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

Hinweis: `bindings.ts` deklariert nur das Basismitglied `cancelWork(id)`; Modul-`types.ts`-Dateien fügen per Declaration-Merge zusätzliche Symbole hinzu, die `validateNative` erzwingt.

## Fehlerverhalten und Diagnose

## Nicht unterstützte Plattform

Falls alle Kandidaten fehlschlagen und `platformTag` nicht in `SUPPORTED_PLATFORMS` enthalten ist, wirft der Loader:

- `Unsupported platform: <tag>`
- Vollständige Liste der unterstützten Plattformen
- Explizite Anleitung zur Fehlermeldung

## Symptome veralteter Binärdateien / Fehlanpassungen

Typisches Signal einer veralteten Fehlanpassung:

- `Native addon missing exports (<candidate>). Missing: ...`

Häufige Ursachen:

- Alte `.node`-Binärdatei aus einer früheren Paketversion/API-Form.
- Falsch ausgewähltes Varianten-Artefakt (für x64).
- Neuer Rust-Export nicht im geladenen Artefakt vorhanden.

Loader-Verhalten:

- Zeichnet kandidatenspezifische Fehler bei fehlenden Exporten auf.
- Fährt mit der Prüfung der verbleibenden Kandidaten fort.
- Falls kein Kandidat validiert wird, enthält der abschließende Fehler jeden versuchten Pfad mit der jeweiligen Fehlermeldung.

## Startfehler bei kompilierten Binärdateien

In der kompilierten Diagnose des abschließenden Fehlers sind enthalten:

- erwartete versionierte Cache-Zielpfade (`<versionedDir>/<filename>`),
- Abhilfemaßnahme zum Löschen des veralteten `<versionedDir>` und erneutem Ausführen,
- direkte Release-Download-`curl`-Befehle für jeden erwarteten Dateinamen.

## Startfehler ohne Kompilierung

Im normalen Paket-/Laufzeitmodus enthält die abschließende Diagnose:

- Hinweis zur Neuinstallation (`bun install @f5xc-salesdemos/pi-natives`),
- lokalen Rebuild-Befehl (`bun --cwd=packages/natives run build`),
- optionalen Hinweis zum x64-Varianten-Build (`TARGET_VARIANT=baseline|modern ...`).

## Laufzeitverhalten

- Der Loader verwendet stets die Release-Kandidatenkette.
- Das Setzen von `PI_DEV` aktiviert nur kandidatenspezifische Konsolendiagnosen (`Loaded native addon...` und Ladefehler).
