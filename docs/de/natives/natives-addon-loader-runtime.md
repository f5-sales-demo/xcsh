---
title: Natives Addon Loader Runtime
description: >-
  N-API Addon-Loader-Runtime mit Plattformerkennung, Fallback-Strategien und
  Modulauflösung.
sidebar:
  order: 3
  label: Addon-Loader
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# Natives Addon Loader Runtime

Dieses Dokument gibt einen umfassenden Einblick in die Addon-Lade- und Validierungsschicht in `@f5-sales-demo/pi-natives`: wie `native.ts` entscheidet, welche `.node`-Datei geladen wird, wann die Extraktion eingebetteter Payloads ausgeführt wird und wie Startfehler gemeldet werden.

## Implementierungsdateien

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## Umfang und Verantwortung

Die Verantwortlichkeiten des Loaders/der Runtime sind bewusst eng gefasst:

- Erstellen einer plattform- und CPU-abhängigen Kandidatenliste für Addon-Dateinamen und -Verzeichnisse.
- Optionales Materialisieren eines eingebetteten Addons in ein versioniertes benutzerspezifisches Cache-Verzeichnis.
- Versuchen der Kandidaten in deterministischer Reihenfolge.
- Ablehnen veralteter oder inkompatibler Addons über `validateNative`, bevor Bindungen freigegeben werden.

Nicht im Umfang enthalten: modulspezifisches Grep/Text/Highlight-Verhalten.

## Laufzeiteingaben und abgeleiteter Zustand

Bei der Modulinitialisierung (`export const native = loadNative();`) berechnet `native.ts` statischen Kontext:

- **Plattform-Tag**: ``${process.platform}-${process.arch}`` (zum Beispiel `darwin-arm64`).
- **Paketversion**: aus `packages/natives/package.json` (Feld `version`).
- **Kernverzeichnisse**:
  - `nativeDir`: paketlokales Verzeichnis `packages/natives/native`.
  - `execDir`: Verzeichnis, das `process.execPath` enthält.
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`.
  - Fallback `userDataDir`:
    - Windows: `%LOCALAPPDATA%/xcsh` (oder `%USERPROFILE%/AppData/Local/xcsh`).
    - Nicht-Windows: `~/.local/bin`.
- **Compiled-Binary-Modus** (`isCompiledBinary`): true, wenn einer der folgenden Punkte zutrifft:
  - Umgebungsvariable `PI_COMPILED` ist gesetzt, oder
  - `import.meta.url` enthält Bun-eingebettete Markierungen (`$bunfs`, `~BUN`, `%7EBUN`).
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
- Wenn nichts geladen werden kann, wird ein expliziter Fehler für nicht unterstützte Plattformen ausgelöst, der die unterstützten Tags auflistet.

Dies bewahrt nützliche Diagnoseinformationen für Grenzfälle, schlägt aber dennoch hart fehl bei wirklich nicht unterstützten Zielen.

## Variantenauswahl (`modern` / `baseline` / Standard)

### x64-Verhalten

1. Wenn `PI_NATIVE_VARIANT` den Wert `modern` oder `baseline` hat, gewinnt dieser Wert.
2. Andernfalls wird die AVX2-Unterstützung erkannt:
   - Linux: `/proc/cpuinfo` nach `avx2` durchsuchen.
   - macOS: `sysctl` abfragen (`machdep.cpu.leaf7_features`, Fallback `machdep.cpu.features`).
   - Windows: PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported` ausführen.
3. Ergebnis:
   - AVX2 verfügbar -> `modern`
   - AVX2 nicht verfügbar/nicht erkennbar -> `baseline`

### Nicht-x64-Verhalten

- Es wird keine Variante verwendet; der Loader bleibt beim Standard-Dateinamen (`pi_natives.<platform>-<arch>.node`).

### Dateinamenkonstruktion

Gegeben `tag = <platform>-<arch>`:

- Nicht-x64 oder keine Variante: `pi_natives.<tag>.node`
- x64 + `modern`: in dieser Reihenfolge versuchen
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (beabsichtigter Fallback)
- x64 + `baseline`: nur `pi_natives.<tag>-baseline.node`

Das `addonLabel`, das in endgültigen Fehlermeldungen verwendet wird, ist entweder `<tag>` oder `<tag> (<variant>)`.

## Konstruktion von Kandidatenpfaden und Fallback-Reihenfolge

`native.ts` erstellt Kandidatenpools vor jedem `require(...)`-Aufruf.

### Release-Kandidaten

Aus der varianten-aufgelösten Dateinamenliste erstellt und in dieser Reihenfolge durchsucht:

- **Nicht-kompilierte Runtime**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **Kompilierte Runtime** (`PI_COMPILED` oder Bun-eingebettete Markierungen):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` entfernt Duplikate unter Beibehaltung der Reihenfolge des ersten Auftretens.

### Endgültige Laufzeitsequenz

Beim Laden:

1. Ein optionaler eingebetteter Extraktionskandidat (sofern vorhanden) wird an vorderster Stelle eingefügt.
2. Die verbleibenden deduplizierten Kandidaten werden in Reihenfolge versucht.
3. Der erste Kandidat, der sowohl `require(...)`d wird als auch `validateNative(...)` besteht, gewinnt.

## Lebenszyklus der Extraktion eingebetteter Addons

`embedded-addon.ts` definiert eine generierte Manifest-Form:

- `platformTag`
- `version`
- `files[]`, wobei jeder Eintrag `variant`, `filename`, `filePath` enthält

Das aktuell eingecheckte Standard-Manifest ist `embeddedAddon: null`; kompilierte Artefakte können dies durch echte Metadaten ersetzen.

### Zustandsmaschine für die Extraktion

Die Extraktion (`maybeExtractEmbeddedAddon`) wird nur ausgeführt, wenn alle Bedingungen erfüllt sind:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. Eine varianten-geeignete eingebettete Datei wurde gefunden

Die Variantendateiauswahl spiegelt die Laufzeit-Variantenabsicht wider:

- Nicht-x64: `default` bevorzugen, dann erste verfügbare Datei.
- x64 + `modern`: `modern` bevorzugen, Fallback auf `baseline`.
- x64 + `baseline`: `baseline` erforderlich.

Materialisierungsverhalten:

1. Sicherstellen, dass `<versionedDir>` existiert (`mkdirSync(..., { recursive: true })`).
2. Wenn `<versionedDir>/<selected filename>` bereits existiert, wird es wiederverwendet (kein Neuschreiben).
3. Andernfalls eingebettete Quelldatei `filePath` lesen und Zieldatei schreiben.
4. Zielpfad für den Ladeversuch mit höchster Priorität zurückgeben.

Bei einem Fehler stürzt die Extraktion nicht sofort ab; stattdessen wird ein Fehlereintrag (Verzeichniserstellung oder Schreibfehler) hinzugefügt und der Loader fährt mit der normalen Kandidatenprüfung fort.

## Lebenszyklus und Zustandsübergänge

```text
Init
  -> Plattform/Version/Variante/Kandidatenlisten berechnen
  -> (Kompiliert + eingebettetes Manifest stimmt überein?)
       ja  -> Eingebettetes in versionedDir zu extrahieren versuchen (Fehler aufzeichnen, fortfahren)
       nein -> Extraktion überspringen
  -> Für jeden Laufzeitkandidaten in Reihenfolge:
       require(candidate)
       -> Erfolg: validateNative
            -> bestanden: Bindungen zurückgeben (READY)
            -> fehlgeschlagen: Fehler aufzeichnen, fortfahren
       -> Fehlschlag: Fehler aufzeichnen, fortfahren
  -> Keiner geladen:
       wenn nicht unterstütztes Plattform-Tag -> Nicht unterstützte Plattform auslösen
       sonst -> Laden fehlgeschlagen auslösen (vollständige Diagnoseinformationen zu versuchten Pfaden + Hinweise)
```

## Vertragsprüfungen in `validateNative`

`validateNative(bindings, source)` erzwingt beim Start einen rein funktionsbasierten Vertrag über `NativeBindings`.

Mechanismus:

- Für jeden erforderlichen Exportnamen wird `typeof bindings[name] === "function"` geprüft.
- Fehlende Namen werden aggregiert.
- Wenn welche fehlen, löst der Loader aus:
  - Quell-Addon-Pfad,
  - Liste fehlender Exporte,
  - Hinweis zum Rebuild-Befehl.

Dies ist ein hartes Kompatibilitätstor gegen veraltete Binärdateien, unvollständige Builds und Symbol-/Namensabweichungen.

### Zuordnung JS-API ↔ nativer Export (Validierungstor)

| Im `validateNative` geprüfter JS-Bindungsname | Erwarteter nativer Exportname |
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

Hinweis: `bindings.ts` deklariert nur das Basismember `cancelWork(id)`; die Moduldatei `types.ts` führt per Deklarations-Merge zusätzliche Symbole ein, die `validateNative` erzwingt.

## Fehlerverhalten und Diagnose

## Nicht unterstützte Plattform

Wenn alle Kandidaten fehlschlagen und `platformTag` nicht in `SUPPORTED_PLATFORMS` enthalten ist, löst der Loader aus:

- `Unsupported platform: <tag>`
- Vollständige Liste der unterstützten Plattformen
- Explizite Anleitung zur Problemmeldung

## Symptome bei veralteter Binärdatei / Nichtübereinstimmung

Typisches Signal für eine veraltete Nichtübereinstimmung:

- `Native addon missing exports (<candidate>). Missing: ...`

Häufige Ursachen:

- Alte `.node`-Binärdatei aus einer früheren Paketversion/API-Form.
- Falsch ausgewähltes Variantenartefakt (bei x64).
- Neuer Rust-Export nicht im geladenen Artefakt vorhanden.

Loader-Verhalten:

- Aufzeichnung von Fehlern wegen fehlender Exporte pro Kandidat.
- Fortfahren mit der Prüfung der verbleibenden Kandidaten.
- Wenn kein Kandidat validiert wird, enthält der abschließende Fehler jeden versuchten Pfad mit der jeweiligen Fehlermeldung.

## Startfehler bei kompilierten Binärdateien

In der Diagnose im kompilierten Modus sind enthalten:

- Erwartete versionierte Cache-Zielpfade (`<versionedDir>/<filename>`),
- Behebungshinweis zum Löschen des veralteten `<versionedDir>` und erneutem Ausführen,
- Direkte `curl`-Befehle zum Release-Download für jeden erwarteten Dateinamen.

## Startfehler im nicht-kompilierten Modus

In der Diagnose im normalen Paket-/Runtime-Modus sind enthalten:

- Neuinstallationshinweis (`bun install @f5-sales-demo/pi-natives`),
- Lokaler Rebuild-Befehl (`bun --cwd=packages/natives run build`),
- Optionaler x64-Varianten-Build-Hinweis (`TARGET_VARIANT=baseline|modern ...`).

## Laufzeitverhalten

- Der Loader verwendet immer die Release-Kandidatenkette.
- Das Setzen von `PI_DEV` aktiviert nur kandidatenweise Konsolendiagnose (`Loaded native addon...` und Ladefehler).
