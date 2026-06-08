---
title: Natives-Architektur
description: >-
  Rust N-API native Addon-Architektur als Brücke zwischen TypeScript und
  plattformspezifischen Operationen.
sidebar:
  order: 1
  label: Architektur
i18n:
  sourceHash: ff6d5d83a9a7
  translator: machine
---

# Natives-Architektur

`@f5xc-salesdemos/pi-natives` ist ein dreischichtiger Stack:

1. **TypeScript-Wrapper/API-Schicht** stellt stabile JS/TS-Einstiegspunkte bereit.
2. **Addon-Lade-/Validierungsschicht** löst die `.node`-Binärdatei für die aktuelle Laufzeitumgebung auf und validiert sie.
3. **Rust-N-API-Modulschicht** implementiert performancekritische Primitive, die nach JS exportiert werden.

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

`packages/natives/src/index.ts` ist das öffentliche Barrel-Modul. Es gruppiert Exporte nach Funktionsdomäne und re-exportiert typisierte Wrapper, anstatt rohe N-API-Bindings direkt freizugeben.

Aktuelle Top-Level-Gruppen:

- **Such-/Text-Primitive**: `grep`, `glob`, `text`, `highlight`
- **Ausführungs-/Prozess-/Terminal-Primitive**: `shell`, `pty`, `ps`, `keys`
- **System-/Medien-/Konvertierungs-Primitive**: `image`, `html`, `clipboard`, `system-info`, `work`

`packages/natives/src/bindings.ts` definiert den Basis-Schnittstellenvertrag:

- `NativeBindings` beginnt mit gemeinsamen Mitgliedern (`cancelWork(id: number)`)
- Modulspezifische Bindings werden durch Declaration Merging aus der jeweiligen `types.ts`-Datei jedes Moduls hinzugefügt
- `Cancellable` standardisiert Timeout- und Abort-Signal-Optionen für Wrapper, die Abbruchfunktionalität bereitstellen

**Garantierter Vertrag (API-seitig):** Konsumenten importieren von `@f5xc-salesdemos/pi-natives` und verwenden typisierte Wrapper.

**Implementierungsdetail (kann sich ändern):** Declaration Merging und internes Wrapper-Layout (`src/<module>/index.ts`, `src/<module>/types.ts`).

## Schicht 2: Addon-Laden und Validierung

`packages/natives/src/native.ts` ist verantwortlich für die Addon-Auswahl zur Laufzeit, die optionale Extraktion und die Export-Validierung.

### Kandidaten-Auflösungsmodell

- Der Plattform-Tag ist `"${process.platform}-${process.arch}"`.
- Derzeit unterstützte Tags sind:
  - `linux-x64`
  - `linux-arm64`
  - `darwin-x64`
  - `darwin-arm64`
  - `win32-x64`
- x64 kann CPU-Varianten verwenden:
  - `modern` (AVX2-fähig)
  - `baseline` (Fallback)
- Nicht-x64 verwendet den Standard-Dateinamen (ohne Varianten-Suffix).

Dateinamenstrategie:

- Release: `pi_natives.<platform>-<arch>.node`
- x64-Varianten-Release: `pi_natives.<platform>-<arch>-modern.node` und/oder `...-baseline.node`
- `PI_DEV` aktiviert Loader-Diagnosen, ändert aber nicht die Addon-Dateinamen

### Plattformspezifische Variantenerkennung

Für x64 verwendet die Variantenauswahl:

- **Linux**: `/proc/cpuinfo`
- **macOS**: `sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows**: PowerShell-Prüfung auf `System.Runtime.Intrinsics.X86.Avx2`

`PI_NATIVE_VARIANT` kann explizit `modern` oder `baseline` erzwingen.

### Binärdistributions- und Extraktionsmodell

`packages/natives/package.json` enthält sowohl `src` als auch `native` in den veröffentlichten Dateien. Das `native/`-Verzeichnis speichert vorgefertigte Plattform-Artefakte.

Für kompilierte Binärdateien (`PI_COMPILED` oder Bun-Embedded-Runtime-Marker) ist das Loader-Verhalten:

1. Versionierten Benutzer-Cache-Pfad prüfen: `<getNativesDir()>/<packageVersion>/...`
2. Legacy-Speicherort für kompilierte Binärdateien prüfen:
   - Windows: `%LOCALAPPDATA%/xcsh` (Fallback `%USERPROFILE%/AppData/Local/xcsh`)
   - Nicht-Windows: `~/.local/bin`
3. Fallback auf paketiertes `native/`- und Executable-Verzeichnis-Kandidaten

Wenn ein eingebettetes Addon-Manifest vorhanden ist (`embedded-addon.ts`, generiert durch `scripts/embed-native.ts`), kann `native.ts` die passende eingebettete Binärdatei in das versionierte Cache-Verzeichnis materialisieren, bevor sie geladen wird.

### Validierung und Fehlermodi

Nach `require(candidate)` überprüft `validateNative(...)` die erforderlichen Exporte (zum Beispiel `grep`, `glob`, `highlightCode`, `PtySession`, `Shell`, `getSystemInfo`, `getWorkProfile`, `invalidateFsScanCache`).

Fehlerpfade sind explizit:

- **Nicht unterstützter Plattform-Tag**: wirft einen Fehler mit der Liste unterstützter Plattformen
- **Kein ladbarer Kandidat**: wirft einen Fehler mit allen versuchten Pfaden und Behebungshinweisen
- **Fehlende Exporte**: wirft einen Fehler mit den genauen fehlenden Namen und dem Rebuild-Befehl
- **Fehler bei der Embedded-Extraktion**: zeichnet Verzeichnis-/Schreibfehler auf und fügt sie in die abschließende Ladediagnose ein

**Garantierter Vertrag (API-seitig):** Das Laden des Addons ist entweder mit einem validierten Binding-Set erfolgreich oder schlägt schnell mit aussagekräftigem Fehlertext fehl.

**Implementierungsdetail (kann sich ändern):** Genaue Reihenfolge der Kandidatensuche und Reihenfolge der Fallback-Pfade für kompilierte Binärdateien.

## Schicht 3: Rust-N-API-Modulschicht

`crates/pi-natives/src/lib.rs` ist das Rust-Einstiegsmodul, das die exportierte Modulzugehörigkeit deklariert:

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

Diese Module implementieren die N-API-Symbole, die von `native.ts` konsumiert und validiert werden. JS-seitige Namen werden über die TS-Wrapper in `packages/natives/src` bereitgestellt.

**Garantierter Vertrag (API-seitig):** Rust-Modul-Exporte müssen mit den Binding-Namen übereinstimmen, die von `validateNative` und den Wrapper-Modulen erwartet werden.

**Implementierungsdetail (kann sich ändern):** Interne Rust-Modulzerlegung und Hilfsmodulgrenzen (`glob_util`, `task`, etc.).

## Verantwortungsgrenzen

Auf Architekturebene ist die Verantwortung wie folgt aufgeteilt:

- **TS-Wrapper/API-Verantwortung (`packages/natives/src`)**
  - Öffentliche API-Gruppierung, Options-Typisierung und stabile JS-Ergonomie
  - Abbruchoberfläche (`timeoutMs`, `AbortSignal`), die Aufrufern bereitgestellt wird
- **Loader-Verantwortung (`packages/natives/src/native.ts`)**
  - Binärdatei-Auswahl zur Laufzeit
  - CPU-Variantenauswahl und Override-Behandlung
  - Extraktion kompilierter Binärdateien und Kandidatenprüfung
  - Strikte Validierung erforderlicher nativer Exporte
- **Rust-Verantwortung (`crates/pi-natives/src`)**
  - Algorithmische und systemnahe Implementierung
  - Plattformnatives Verhalten und performancesensitive Logik
  - N-API-Symbol-Implementierung, die von TS-Wrappern konsumiert wird

## Laufzeitablauf (High-Level)

1. Konsument importiert von `@f5xc-salesdemos/pi-natives`.
2. Wrapper-Modul ruft das Singleton-`native`-Binding auf.
3. `native.ts` wählt die Kandidaten-Binärdatei für Plattform/Architektur/Variante aus.
4. Optionale Extraktion der eingebetteten Binärdatei erfolgt für kompilierte Distributionen.
5. Das Addon wird geladen und der Export-Satz wird validiert.
6. Der Wrapper gibt typisierte Ergebnisse an den Aufrufer zurück.

## Glossar

- **Natives Addon**: Eine `.node`-Binärdatei, die über Node-API (N-API) geladen wird.
- **Plattform-Tag**: Laufzeit-Tupel `platform-arch` (zum Beispiel `darwin-arm64`).
- **Variante**: x64-CPU-spezifische Build-Variante (`modern` AVX2, `baseline` Fallback).
- **Wrapper**: TS-Funktion/-Klasse, die eine typisierte API über rohe native Exporte bereitstellt.
- **Declaration Merging**: TS-Technik, die von `types.ts`-Dateien der Module verwendet wird, um `NativeBindings` zu erweitern.
- **Modus für kompilierte Binärdateien**: Laufzeitmodus, in dem die CLI gebündelt ist und native Addons aus extrahierten/Cache-Pfaden aufgelöst werden, anstatt nur aus paketlokalen Pfaden.
- **Eingebettetes Addon**: Build-Artefakt-Metadaten und Dateireferenzen, die in `embedded-addon.ts` generiert werden, damit kompilierte Binärdateien passende `.node`-Payloads extrahieren können.
- **Validierungsgate**: `validateNative(...)`-Prüfung, die veraltete/nicht übereinstimmende Binärdateien mit fehlenden erforderlichen Exporten ablehnt.
