---
title: Laufzeitumgebung des nativen Addon-Loaders
description: >-
  N-API-Addon-Loader-Laufzeitumgebung mit Plattformerkennung,
  Fallback-Strategien und Modulauflösung.
sidebar:
  order: 3
  label: Addon-Loader
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# Laufzeitumgebung des nativen Addon-Loaders

Dieses Dokument vertieft die Addon-Lade-/Validierungsschicht in `@f5xc-salesdemos/pi-natives`: wie `native.ts` entscheidet, welche `.node`-Datei geladen wird, wann die eingebettete Payload-Extraktion ausgeführt wird und wie Startfehler gemeldet werden.

## Implementierungsdateien

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## Umfang und Verantwortlichkeit

Die Verantwortlichkeiten des Loaders/der Laufzeitumgebung sind bewusst eng gefasst:

- Erstellen einer plattform-/CPU-bewussten Kandidatenliste für Addon-Dateinamen und -Verzeichnisse.
- Optionales Materialisieren eines eingebetteten Addons in ein versioniertes, benutzerspezifisches Cache-Verzeichnis.
- Ausprobieren der Kandidaten in deterministischer Reihenfolge.
- Ablehnung veralteter oder inkompatibler Addons über `validateNative` vor der Bereitstellung der Bindings.

Außerhalb des Geltungsbereichs: modulspezifisches Grep-/Text-/Highlight-Verhalten.

## Laufzeiteingaben und abgeleiteter Zustand

Bei der Modulinitialisierung (`export const native = loadNative();`) berechnet `native.ts` einen statischen Kontext:

- **Plattform-Tag**: ``${process.platform}-${process.arch}`` (zum Beispiel `darwin-arm64`).
- **Paketversion**: aus `packages/natives/package.json` (Feld `version`).
- **Kernverzeichnisse**:
  - `nativeDir`: paketlokales `packages/natives/native`.
  - `execDir`: Verzeichnis, das `process.execPath` enthält.
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`.
  - `userDataDir`-Fallback:
    - Windows: `%LOCALAPPDATA%/xcsh` (oder `%USERPROFILE%/AppData/Local/xcsh`).
    - Nicht-Windows: `~/.local/bin`.
- **Kompilierter-Binärmodus** (`isCompiledBinary`): wahr, wenn einer der folgenden Punkte zutrifft:
  - Die Umgebungsvariable `PI_COMPILED` gesetzt ist, oder
  - `import.meta.url` Bun-eingebettete Marker enthält (`$bunfs`, `~BUN`, `%7EBUN`).
- **Varianten-Override**: `PI_NATIVE_VARIANT` (nur `modern`/`baseline`; ungültige Werte werden ignoriert).
- **Ausgewählte Variante**: expliziter Override, ansonsten AVX2-Erkennung zur Laufzeit auf x64 (`modern` bei AVX2, sonst `baseline`).

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
- Wenn nichts geladen werden kann, wird ein expliziter Fehler für nicht unterstützte Plattformen mit Auflistung der unterstützten Tags geworfen.

Dies bewahrt nützliche Diagnoseinformationen für knappe Fehlschläge, während für wirklich nicht unterstützte Ziele ein harter Fehler ausgelöst wird.

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

### Dateinamenskonstruktion

Gegeben `tag = <platform>-<arch>`:

- Nicht-x64 oder keine Variante: `pi_natives.<tag>.node`
- x64 + `modern`: Versuch in dieser Reihenfolge
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (beabsichtigter Fallback)
- x64 + `baseline`: nur `pi_natives.<tag>-baseline.node`

Das in den abschließenden Fehlermeldungen verwendete `addonLabel` ist entweder `<tag>` oder `<tag> (<variant>)`.

## Kandidatenpfad-Konstruktion und Fallback-Reihenfolge

`native.ts` erstellt Kandidaten-Pools vor jedem `require(...)`-Aufruf.

### Release-Kandidaten

Aus der variantenaufgelösten Dateinamenliste erstellt und in dieser Reihenfolge durchsucht:

- **Nicht-kompilierte Laufzeitumgebung**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **Kompilierte Laufzeitumgebung** (`PI_COMPILED` oder Bun-eingebettete Marker):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` entfernt Duplikate unter Beibehaltung der Reihenfolge des ersten Vorkommens.

### Endgültige Laufzeitsequenz

Beim Laden:

1. Ein optionaler eingebetteter Extraktionskandidat (falls erzeugt) wird an den Anfang eingefügt.
2. Die verbleibenden deduplizierten Kandidaten werden der Reihe nach ausprobiert.
3. Der erste Kandidat, der sowohl `require(...)` als auch `validateNative(...)` besteht, gewinnt.

## Lebenszyklus der eingebetteten Addon-Extraktion

`embedded-addon.ts` definiert eine generierte Manifest-Struktur:

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
5. Eine variantengeeignete eingebettete Datei wurde gefunden

Die Variantendatei-Auswahl spiegelt die Laufzeit-Variantenabsicht wider:

- Nicht-x64: bevorzugt `default`, dann erste verfügbare Datei.
- x64 + `modern`: bevorzugt `modern`, Fallback auf `baseline`.
- x64 + `baseline`: erfordert `baseline`.

Materialisierungsverhalten:

1. Sicherstellen, dass `<versionedDir>` existiert (`mkdirSync(..., { recursive: true })`).
2. Wenn `<versionedDir>/<ausgewählter Dateiname>` bereits existiert, wird er wiederverwendet (kein Neuschreiben).
3. Andernfalls eingebettete Quelldatei `filePath` lesen und Zieldatei schreiben.
4. Zielpfad für den Ladeversuch mit höchster Priorität zurückgeben.

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

`validateNative(bindings, source)` erzwingt beim Start einen rein funktionsbasierten Vertrag über `NativeBindings`.

Mechanik:

- Für jeden erforderlichen Exportnamen wird `typeof bindings[name] === "function"` geprüft.
- Fehlende Namen werden aggregiert.
- Wenn welche fehlen, wirft der Loader:
  - Quell-Addon-Pfad,
  - Liste fehlender Exporte,
  - Hinweis zum Rebuild-Befehl.

Dies ist eine harte Kompatibilitätsschranke gegen veraltete Binärdateien, unvollständige Builds und Symbol-/Namensabweichungen.

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

Hinweis: `bindings.ts` deklariert nur das Basismitglied `cancelWork(id)`; die `types.ts`-Dateien der Module führen eine Deklarationszusammenführung zusätzlicher Symbole durch, die `validateNative` erzwingt.

## Fehlerverhalten und Diagnose

## Nicht unterstützte Plattform

Wenn alle Kandidaten fehlschlagen und `platformTag` nicht in `SUPPORTED_PLATFORMS` enthalten ist, wirft der Loader:

- `Unsupported platform: <tag>`
- Vollständige Liste der unterstützten Plattformen
- Explizite Anleitung zur Fehlermeldung

## Veraltete Binärdatei / Mismatch-Symptome

Typisches Signal für einen Mismatch mit veralteter Binärdatei:

- `Native addon missing exports (<candidate>). Missing: ...`

Häufige Ursachen:

- Alte `.node`-Binärdatei aus früherer Paketversion/API-Form.
- Falsches Varianten-Artefakt ausgewählt (bei x64).
- Neuer Rust-Export im geladenen Artefakt nicht vorhanden.

Loader-Verhalten:

- Zeichnet Fehler bei fehlenden Exporten pro Kandidat auf.
- Fährt mit der Prüfung der verbleibenden Kandidaten fort.
- Wenn kein Kandidat die Validierung besteht, enthält der abschließende Fehler jeden versuchten Pfad mit der jeweiligen Fehlermeldung.

## Startfehler im kompilierten Binärmodus

Im kompilierten Modus enthalten die abschließenden Diagnoseinformationen:

- Erwartete versionierte Cache-Zielpfade (`<versionedDir>/<filename>`),
- Behebungsmaßnahme zum Löschen des veralteten `<versionedDir>` und erneuten Ausführen,
- Direkte `curl`-Befehle zum Herunterladen des Releases für jeden erwarteten Dateinamen.

## Startfehler im nicht-kompilierten Modus

Im normalen Paket-/Laufzeitmodus enthalten die abschließenden Diagnoseinformationen:

- Hinweis zur Neuinstallation (`bun install @f5xc-salesdemos/pi-natives`),
- Lokaler Rebuild-Befehl (`bun --cwd=packages/natives run build`),
- Optionaler x64-Varianten-Build-Hinweis (`TARGET_VARIANT=baseline|modern ...`).

## Laufzeitverhalten

- Der Loader verwendet immer die Release-Kandidatenkette.
- Das Setzen von `PI_DEV` aktiviert nur konsolenbasierte Diagnosen pro Kandidat (`Loaded native addon...` und Ladefehler).
