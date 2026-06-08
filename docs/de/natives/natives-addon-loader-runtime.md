---
title: Natives Addon Loader Runtime
description: >-
  N-API addon loader runtime with platform detection, fallback strategies, and
  module resolution.
sidebar:
  order: 3
  label: Addon loader
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# Natives Addon Loader Runtime

Dieses Dokument vertieft die Addon-Lade-/Validierungsschicht in `@f5xc-salesdemos/pi-natives`: wie `native.ts` entscheidet, welche `.node`-Datei geladen wird, wann die Extraktion eingebetteter Payloads ausgeführt wird und wie Startfehler gemeldet werden.

## Implementierungsdateien

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## Geltungsbereich und Zuständigkeit

Die Zuständigkeiten des Loaders/der Runtime sind bewusst eng gefasst:

- Erstellen einer plattform-/CPU-bewussten Kandidatenliste für Addon-Dateinamen und -Verzeichnisse.
- Optionales Materialisieren eines eingebetteten Addons in ein versioniertes benutzerspezifisches Cache-Verzeichnis.
- Ausprobieren der Kandidaten in deterministischer Reihenfolge.
- Ablehnung veralteter oder inkompatibler Addons über `validateNative` vor der Bereitstellung von Bindings.

Nicht im Geltungsbereich: modulspezifisches grep/text/highlight-Verhalten.

## Runtime-Eingaben und abgeleiteter Zustand

Bei der Modulinitialisierung (`export const native = loadNative();`) berechnet `native.ts` den statischen Kontext:

- **Plattform-Tag**: ``${process.platform}-${process.arch}`` (zum Beispiel `darwin-arm64`).
- **Paketversion**: aus `packages/natives/package.json` (Feld `version`).
- **Kernverzeichnisse**:
  - `nativeDir`: paketlokales `packages/natives/native`.
  - `execDir`: Verzeichnis, das `process.execPath` enthält.
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`.
  - `userDataDir`-Fallback:
    - Windows: `%LOCALAPPDATA%/xcsh` (oder `%USERPROFILE%/AppData/Local/xcsh`).
    - Nicht-Windows: `~/.local/bin`.
- **Kompilierter-Binary-Modus** (`isCompiledBinary`): wahr wenn einer der folgenden Punkte zutrifft:
  - Umgebungsvariable `PI_COMPILED` ist gesetzt, oder
  - `import.meta.url` enthält Bun-Embedded-Marker (`$bunfs`, `~BUN`, `%7EBUN`).
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
- Der Loader probiert dennoch zuerst alle berechneten Kandidaten.
- Wenn nichts geladen werden kann, wirft er einen expliziten Fehler für nicht unterstützte Plattformen mit Auflistung der unterstützten Tags.

Dies bewahrt nützliche Diagnosen für Beinahe-Treffer-Fälle und schlägt dennoch hart bei wirklich nicht unterstützten Zielen fehl.

## Variantenauswahl (`modern` / `baseline` / Standard)

### x64-Verhalten

1. Wenn `PI_NATIVE_VARIANT` `modern` oder `baseline` ist, hat dieser Wert Vorrang.
2. Andernfalls AVX2-Unterstützung erkennen:
   - Linux: `/proc/cpuinfo` nach `avx2` durchsuchen.
   - macOS: `sysctl` abfragen (`machdep.cpu.leaf7_features`, Fallback `machdep.cpu.features`).
   - Windows: PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported` ausführen.
3. Ergebnis:
   - AVX2 verfügbar -> `modern`
   - AVX2 nicht verfügbar/nicht erkennbar -> `baseline`

### Nicht-x64-Verhalten

- Keine Variante wird verwendet; der Loader bleibt beim Standard-Dateinamen (`pi_natives.<platform>-<arch>.node`).

### Dateinamenkonstruktion

Gegeben `tag = <platform>-<arch>`:

- Nicht-x64 oder keine Variante: `pi_natives.<tag>.node`
- x64 + `modern`: in dieser Reihenfolge versuchen
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (beabsichtigter Fallback)
- x64 + `baseline`: nur `pi_natives.<tag>-baseline.node`

Das in abschließenden Fehlermeldungen verwendete `addonLabel` ist entweder `<tag>` oder `<tag> (<variant>)`.

## Kandidatenpfad-Konstruktion und Fallback-Reihenfolge

`native.ts` erstellt Kandidatenpools bevor ein `require(...)`-Aufruf erfolgt.

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

### Endgültige Runtime-Sequenz

Zum Ladezeitpunkt:

1. Ein optionaler eingebetteter Extraktionskandidat (falls erzeugt) wird am Anfang eingefügt.
2. Die verbleibenden deduplizierten Kandidaten werden der Reihe nach ausprobiert.
3. Der erste Kandidat, der sowohl `require(...)` als auch `validateNative(...)` besteht, gewinnt.

## Lebenszyklus der eingebetteten Addon-Extraktion

`embedded-addon.ts` definiert eine generierte Manifest-Struktur:

- `platformTag`
- `version`
- `files[]` wobei jeder Eintrag `variant`, `filename`, `filePath` enthält

Der aktuell eingecheckte Standard ist `embeddedAddon: null`; kompilierte Artefakte können dies durch echte Metadaten ersetzen.

### Extraktions-Zustandsmaschine

Die Extraktion (`maybeExtractEmbeddedAddon`) wird nur ausgeführt, wenn alle Bedingungen erfüllt sind:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. Eine variantengerechte eingebettete Datei wird gefunden

Die Variantendatei-Auswahl spiegelt die Runtime-Variantenabsicht wider:

- Nicht-x64: bevorzuge `default`, dann erste verfügbare Datei.
- x64 + `modern`: bevorzuge `modern`, Fallback auf `baseline`.
- x64 + `baseline`: erfordert `baseline`.

Materialisierungsverhalten:

1. Sicherstellen, dass `<versionedDir>` existiert (`mkdirSync(..., { recursive: true })`).
2. Wenn `<versionedDir>/<ausgewählter Dateiname>` bereits existiert, wiederverwenden (kein Neuschreiben).
3. Andernfalls eingebettete Quelldatei `filePath` lesen und Zieldatei schreiben.
4. Zielpfad für den höchstpriorisierten Ladeversuch zurückgeben.

Bei einem Fehler stürzt die Extraktion nicht sofort ab; sie fügt einen Fehlereintrag hinzu (Verzeichniserstellung oder Schreibfehler) und der Loader fährt mit der normalen Kandidatenprüfung fort.

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

## `validateNative`-Vertragsprüfungen

`validateNative(bindings, source)` erzwingt beim Start einen funktionsbasierten Vertrag über `NativeBindings`.

Mechanik:

- Für jeden erforderlichen Exportnamen wird `typeof bindings[name] === "function"` geprüft.
- Fehlende Namen werden aggregiert.
- Wenn welche fehlen, wirft der Loader:
  - Quell-Addon-Pfad,
  - Liste fehlender Exports,
  - Hinweis auf den Rebuild-Befehl.

Dies ist eine harte Kompatibilitätsschranke gegen veraltete Binaries, unvollständige Builds und Symbol-/Namensabweichungen.

### JS-API ↔ Native-Export-Zuordnung (Validierungsschranke)

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

Hinweis: `bindings.ts` deklariert nur das Basismitglied `cancelWork(id)`; `types.ts`-Dateien der Module führen Declaration-Merging zusätzlicher Symbole durch, die `validateNative` erzwingt.

## Fehlerverhalten und Diagnosen

## Nicht unterstützte Plattform

Wenn alle Kandidaten fehlschlagen und `platformTag` nicht in `SUPPORTED_PLATFORMS` enthalten ist, wirft der Loader:

- `Unsupported platform: <tag>`
- Vollständige Liste unterstützter Plattformen
- Explizite Anleitung zur Fehlermeldung

## Veraltetes Binary / Symptome bei Nichtübereinstimmung

Typisches Signal für veraltete Nichtübereinstimmung:

- `Native addon missing exports (<candidate>). Missing: ...`

Häufige Ursachen:

- Altes `.node`-Binary aus vorheriger Paketversion/API-Form.
- Falsches Varianten-Artefakt ausgewählt (bei x64).
- Neuer Rust-Export nicht im geladenen Artefakt vorhanden.

Loader-Verhalten:

- Zeichnet pro Kandidat fehlende Export-Fehler auf.
- Fährt mit der Prüfung verbleibender Kandidaten fort.
- Wenn kein Kandidat validiert, enthält der abschließende Fehler jeden versuchten Pfad mit der jeweiligen Fehlermeldung.

## Startfehler im kompilierten Binary-Modus

Im kompilierten Modus umfasst die abschließende Diagnose:

- erwartete versionierte Cache-Zielpfade (`<versionedDir>/<filename>`),
- Behebungshinweis zum Löschen des veralteten `<versionedDir>` und erneuten Ausführen,
- direkte Release-Download-`curl`-Befehle für jeden erwarteten Dateinamen.

## Startfehler im nicht-kompilierten Modus

Im normalen Paket-/Runtime-Modus umfasst die abschließende Diagnose:

- Neuinstallationshinweis (`bun install @f5xc-salesdemos/pi-natives`),
- lokalen Rebuild-Befehl (`bun --cwd=packages/natives run build`),
- optionalen x64-Varianten-Build-Hinweis (`TARGET_VARIANT=baseline|modern ...`).

## Runtime-Verhalten

- Der Loader verwendet immer die Release-Kandidatenkette.
- Das Setzen von `PI_DEV` aktiviert nur die Pro-Kandidat-Konsolendiagnose (`Loaded native addon...` und Ladefehler).
