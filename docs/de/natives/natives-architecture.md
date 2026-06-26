---
title: Natives-Architektur
description: >-
  Rust N-API Native-Addon-Architektur als Brücke zwischen TypeScript und
  plattformspezifischen Operationen.
sidebar:
  order: 1
  label: Architektur
i18n:
  sourceHash: d38ed2437bb7
  translator: machine
---

# Natives-Architektur

`@f5-sales-demo/pi-natives` ist ein dreischichtiger Stack:

1. **TypeScript-Wrapper/API-Schicht** stellt stabile JS/TS-Einstiegspunkte bereit.
2. **Addon-Lade-/Validierungsschicht** löst die `.node`-Binärdatei für die aktuelle Laufzeitumgebung auf und validiert sie.
3. **Rust N-API-Modulschicht** implementiert performancekritische Primitive, die nach JS exportiert werden.

Dieses Dokument bildet die Grundlage für tiefergehende Dokumentationen auf Modulebene.

## Implementierungsdateien

- `packages/natives/src/index.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `crates/pi-natives/src/lib.rs`

## Schicht 1: TypeScript-Wrapper/API-Schicht

`packages/natives/src/index.ts` ist das öffentliche Barrel-Modul. Es gruppiert Exporte nach Fähigkeitsdomäne und re-exportiert typisierte Wrapper, anstatt rohe N-API-Bindings direkt freizugeben.

Aktuelle Top-Level-Gruppen:

- **Such-/Textprimitive**: `grep`, `glob`, `text`, `highlight`
- **Ausführungs-/Prozess-/Terminalprimitive**: `shell`, `pty`, `ps`, `keys`
- **System-/Medien-/Konvertierungsprimitive**: `image`, `html`, `clipboard`, `system-info`, `work`

`packages/natives/src/bindings.ts` definiert den Basis-Interface-Vertrag:

- `NativeBindings` beginnt mit gemeinsamen Mitgliedern (`cancelWork(id: number)`)
- Modulspezifische Bindings werden durch Declaration Merging aus der jeweiligen `types.ts` jedes Moduls hinzugefügt
- `Cancellable` standardisiert Timeout- und Abort-Signal-Optionen für Wrapper, die Abbruchfunktionalität bereitstellen

**Garantierter Vertrag (API-seitig):** Konsumenten importieren aus `@f5-sales-demo/pi-natives` und verwenden typisierte Wrapper.

**Implementierungsdetail (kann sich ändern):** Declaration Merging und internes Wrapper-Layout (`src/<module>/index.ts`, `src/<module>/types.ts`).

## Schicht 2: Addon-Laden und -Validierung

`packages/natives/src/native.ts` ist verantwortlich für die Laufzeit-Addon-Auswahl, optionale Extraktion und Export-Validierung.

### Kandidaten-Auflösungsmodell

- Der Plattform-Tag ist `"${process.platform}-${process.arch}"`.
- Aktuell unterstützte Tags sind:
  - `linux-x64`
  - `linux-arm64`
  - `darwin-x64`
  - `darwin-arm64`
  - `win32-x64`
- x64 kann CPU-Varianten verwenden:
  - `modern` (AVX2-fähig)
  - `baseline` (Fallback)
- Nicht-x64 verwendet den Standard-Dateinamen (ohne Varianten-Suffix).

Dateinamen-Strategie:

- Release: `pi_natives.<platform>-<arch>.node`
- x64-Varianten-Release: `pi_natives.<platform>-<arch>-modern.node` und/oder `...-baseline.node`
- `PI_DEV` aktiviert Loader-Diagnosen, ändert aber keine Addon-Dateinamen

### Plattformspezifische Variantenerkennung

Für x64 verwendet die Variantenauswahl:

- **Linux**: `/proc/cpuinfo`
- **macOS**: `sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows**: PowerShell-Prüfung auf `System.Runtime.Intrinsics.X86.Avx2`

`PI_NATIVE_VARIANT` kann `modern` oder `baseline` explizit erzwingen.

### Binärdistributions- und Extraktionsmodell

`packages/natives/package.json` enthält sowohl `src` als auch `native` in den veröffentlichten Dateien. Das `native/`-Verzeichnis speichert vorgefertigte Plattform-Artefakte.

Für kompilierte Binärdateien (`PI_COMPILED` oder eingebettete Bun-Laufzeit-Marker) verhält sich der Loader wie folgt:

1. Prüfung des versionierten Benutzer-Cache-Pfads: `<getNativesDir()>/<packageVersion>/...`
2. Prüfung des Legacy-Speicherorts für kompilierte Binärdateien:
   - Windows: `%LOCALAPPDATA%/xcsh` (Fallback `%USERPROFILE%/AppData/Local/xcsh`)
   - Nicht-Windows: `~/.local/bin`
3. Fallback auf das gepackte `native/`-Verzeichnis und Kandidaten im ausführbaren Verzeichnis

Falls ein eingebettetes Addon-Manifest vorhanden ist (`embedded-addon.ts`, generiert durch `scripts/embed-native.ts`), kann `native.ts` die passende eingebettete Binärdatei vor dem Laden in das versionierte Cache-Verzeichnis materialisieren.

### Validierung und Fehlermodi

Nach `require(candidate)` überprüft `validateNative(...)` die erforderlichen Exporte (zum Beispiel `grep`, `glob`, `highlightCode`, `PtySession`, `Shell`, `getSystemInfo`, `getWorkProfile`, `invalidateFsScanCache`).

Fehlerpfade sind explizit:

- **Nicht unterstützter Plattform-Tag**: wirft einen Fehler mit der Liste unterstützter Plattformen
- **Kein ladbarer Kandidat**: wirft einen Fehler mit allen versuchten Pfaden und Behebungshinweisen
- **Fehlende Exporte**: wirft einen Fehler mit den genauen fehlenden Namen und dem Rebuild-Befehl
- **Extraktionsfehler bei eingebetteten Addons**: protokolliert Verzeichnis-/Schreibfehler und fügt sie in die abschließende Ladediagnose ein

**Garantierter Vertrag (API-seitig):** Das Laden des Addons gelingt entweder mit einem validierten Binding-Set oder schlägt schnell mit umsetzbarem Fehlertext fehl.

**Implementierungsdetail (kann sich ändern):** Genaue Kandidaten-Suchreihenfolge und Reihenfolge der Fallback-Pfade für kompilierte Binärdateien.

## Schicht 3: Rust N-API-Modulschicht

`crates/pi-natives/src/lib.rs` ist das Rust-Eingangsmodul, das die exportierte Modul-Zugehörigkeit deklariert:

- `clipboard`
- `fd`
- `fs_cache`
- `glob`
- `glob_util`
- `grep`
- `highlight`
- `html`
- `image`
- `keys`
- `prof`
- `ps`
- `pty`
- `shell`
- `system_info`
- `task`
- `text`

Diese Module implementieren die N-API-Symbole, die von `native.ts` konsumiert und validiert werden. JS-seitige Namen werden durch die TS-Wrapper in `packages/natives/src` bereitgestellt.

**Garantierter Vertrag (API-seitig):** Rust-Modulexporte müssen mit den von `validateNative` und den Wrapper-Modulen erwarteten Binding-Namen übereinstimmen.

**Implementierungsdetail (kann sich ändern):** Interne Rust-Modul-Zerlegung und Hilfsmodul-Grenzen (`glob_util`, `task` usw.).

## Zuständigkeitsgrenzen

Auf Architekturebene ist die Zuständigkeit wie folgt aufgeteilt:

- **TS-Wrapper/API-Zuständigkeit (`packages/natives/src`)**
  - Öffentliche API-Gruppierung, Options-Typisierung und stabile JS-Ergonomie
  - Abbruch-Oberfläche (`timeoutMs`, `AbortSignal`), die Aufrufern bereitgestellt wird
- **Loader-Zuständigkeit (`packages/natives/src/native.ts`)**
  - Laufzeit-Binärauswahl
  - CPU-Variantenauswahl und Override-Behandlung
  - Extraktion kompilierter Binärdateien und Kandidatenprüfung
  - Harte Validierung der erforderlichen nativen Exporte
- **Rust-Zuständigkeit (`crates/pi-natives/src`)**
  - Algorithmische und systembezogene Implementierung
  - Plattformnatives Verhalten und performancesensitive Logik
  - N-API-Symbol-Implementierung, die von TS-Wrappern konsumiert wird

## Laufzeitablauf (Übersicht)

1. Der Konsument importiert aus `@f5-sales-demo/pi-natives`.
2. Das Wrapper-Modul ruft das Singleton-`native`-Binding auf.
3. `native.ts` wählt die Kandidaten-Binärdatei für Plattform/Architektur/Variante aus.
4. Optionale Extraktion eingebetteter Binärdateien erfolgt bei kompilierten Distributionen.
5. Das Addon wird geladen und das Export-Set wird validiert.
6. Der Wrapper gibt typisierte Ergebnisse an den Aufrufer zurück.

## Glossar

- **Native Addon**: Eine `.node`-Binärdatei, die über Node-API (N-API) geladen wird.
- **Plattform-Tag**: Laufzeit-Tupel `platform-arch` (zum Beispiel `darwin-arm64`).
- **Variante**: x64-CPU-spezifischer Build-Flavor (`modern` AVX2, `baseline` Fallback).
- **Wrapper**: TS-Funktion/-Klasse, die eine typisierte API über rohe native Exporte bereitstellt.
- **Declaration Merging**: TS-Technik, die von `types.ts`-Dateien der Module verwendet wird, um `NativeBindings` zu erweitern.
- **Kompilierter Binärmodus**: Laufzeitmodus, in dem die CLI gebündelt ist und native Addons aus extrahierten/Cache-Pfaden anstatt nur aus paketlokalen Pfaden aufgelöst werden.
- **Eingebettetes Addon**: Build-Artefakt-Metadaten und Dateireferenzen, die in `embedded-addon.ts` generiert werden, damit kompilierte Binärdateien passende `.node`-Payloads extrahieren können.
- **Validierungs-Gate**: `validateNative(...)`-Prüfung, die veraltete/nicht übereinstimmende Binärdateien mit fehlenden erforderlichen Exporten ablehnt.
