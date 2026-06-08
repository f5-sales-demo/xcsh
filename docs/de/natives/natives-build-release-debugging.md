---
title: 'Natives Build-, Release- und Debugging-Runbook'
description: >-
  Build-, Release- und Debugging-Runbook für das Rust Native Addon über alle
  Plattformen hinweg.
sidebar:
  order: 8
  label: 'Build, Release & Debugging'
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# Natives Build-, Release- und Debugging-Runbook

Dieses Runbook beschreibt, wie die `@f5xc-salesdemos/pi-natives` Build-Pipeline `.node`-Addons erzeugt, wie kompilierte Distributionen diese laden und wie Loader-/Build-Fehler debuggt werden können.

Es folgt den Architekturbegriffen aus `docs/natives-architecture.md`:

- **Build-Zeit-Artefakt-Erzeugung** (`scripts/build-native.ts`)
- **Eingebettete Addon-Manifest-Generierung** (`scripts/embed-native.ts`)
- **Laufzeit-Addon-Laden + Validierungs-Gate** (`src/native.ts`)

## Implementierungsdateien

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## Überblick über die Build-Pipeline

### 1) Build-Einstiegspunkte

`packages/natives/package.json` Skripte:

- `bun scripts/build-native.ts` (`build`) → Release-Build
- `bun scripts/build-native.ts --dev` (`dev:native`) → Debug-/Dev-Profil-Build (gleiche Ausgabebenennnung)
- `bun scripts/embed-native.ts` (`embed:native`) → Generierung von `src/embedded-addon.ts` aus den gebauten Dateien

### 2) Rust-Artefakt-Build

`build-native.ts` führt Cargo in `crates/pi-natives` aus:

- Basisbefehl: `cargo build`
- Release-Modus fügt `--release` hinzu, sofern nicht `--dev` übergeben wird
- Cross-Target fügt `--target <CROSS_TARGET>` hinzu

`crates/pi-natives/Cargo.toml` deklariert `crate-type = ["cdylib"]`, sodass Cargo eine Shared Library (`.so`/`.dylib`/`.dll`) erzeugt, die dann in eine `.node`-Addon-Datei kopiert/umbenannt wird.

### 3) Artefakt-Erkennung und Installation

Nach Abschluss von Cargo durchsucht `build-native.ts` Kandidaten-Ausgabeverzeichnisse in folgender Reihenfolge:

1. `${CARGO_TARGET_DIR}` (falls gesetzt)
2. `<repo>/target`
3. `crates/pi-natives/target`

Für jedes Stammverzeichnis werden Profilverzeichnisse überprüft:

- Cross-Build: `<root>/<crossTarget>/<profile>` dann `<root>/<profile>`
- Nativer Build: `<root>/<profile>`

Anschließend wird nach einer der folgenden Dateien gesucht:

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

Bei Fund wird die Datei atomar in `packages/natives/native/` installiert, mit Temp-Datei + Umbenennung-Semantik (Windows-Fallback behandelt fehlgeschlagene gesperrte DLL-Ersetzungen explizit).

## Target-/Varianten-Modell und Namenskonventionen

## Plattform-Tag

Sowohl Build als auch Laufzeit verwenden einen Plattform-Tag:

`<platform>-<arch>` (Beispiel: `darwin-arm64`, `linux-x64`)

## Varianten-Modell (nur x64)

x64 unterstützt CPU-Varianten:

- `modern` (AVX2-fähiger Pfad)
- `baseline` (Fallback)

Nicht-x64 verwendet ein einzelnes Standard-Artefakt (kein Varianten-Suffix).

### Ausgabedateinamen

Release-Builds:

- x64: `pi_natives.<platform>-<arch>-modern.node` oder `...-baseline.node`
- Nicht-x64: `pi_natives.<platform>-<arch>.node`

Dev-Build (`--dev`):

- Verwendet Debug-Profil-Flags, behält aber die standardmäßige plattformgetaggte Ausgabebenennung bei

Laufzeit-Loader-Kandidatenreihenfolge in `native.ts`:

- Release-Kandidaten
- Kompilierter Modus stellt extrahierte/Cache-Kandidaten vor paketlokale Dateien

## Umgebungsflags und Build-Optionen

## Laufzeit-Flags

- `PI_DEV` (Loader-Verhalten): Loader-Diagnosen aktivieren
- `PI_NATIVE_VARIANT` (Loader-Verhalten, nur x64): Erzwingt `modern`- oder `baseline`-Auswahl zur Laufzeit
- `PI_COMPILED` (Loader-Verhalten): Aktiviert Kandidaten-/Extraktionsverhalten für kompilierte Binärdateien

## Build-Zeit-Flags/Optionen

- `--dev` (Skript-Argument): Debug-Profil bauen
- `CROSS_TARGET`: wird an Cargo `--target` übergeben
- `TARGET_PLATFORM`: Überschreibt die Plattform-Tag-Benennung der Ausgabe
- `TARGET_ARCH`: Überschreibt die Arch-Benennung der Ausgabe
- `TARGET_VARIANT` (nur x64): Erzwingt `modern` oder `baseline` für Ausgabedateinamen und RUSTFLAGS-Richtlinie
- `CARGO_TARGET_DIR`: Zusätzliches Stammverzeichnis bei der Suche nach Cargo-Ausgaben
- `RUSTFLAGS`:
  - Falls nicht gesetzt und kein Cross-Compiling, setzt das Skript:
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - Nicht-x64 / keine Variante: `-C target-cpu=native`
  - Falls bereits gesetzt, überschreibt das Skript nicht

## Build-Zustands-/Lebenszyklus-Übergänge

### Build-Lebenszyklus (`build-native.ts`)

1. **Init**: Argumente/Umgebung parsen (`--dev`, Target-Überschreibungen, Cross-Flags)
2. **Varianten-Auflösung**:
   - Nicht-x64 → keine Variante
   - x64 + `TARGET_VARIANT` → explizite Variante
   - x64 Cross-Build ohne `TARGET_VARIANT` → harter Fehler
   - x64 lokaler Build ohne Überschreibung → Host-AVX2 erkennen
3. **Kompilieren**: Cargo mit aufgelöstem Profil/Target ausführen
4. **Artefakt lokalisieren**: Target-Stammverzeichnisse/Profilverzeichnisse/Bibliotheksnamen durchsuchen
5. **Installieren**: Kopieren + atomares Umbenennen nach `packages/natives/native`
6. **Abgeschlossen**: Addon-Ausgabe bereit für Loader-Kandidaten

Fehlerausgänge erfolgen in jeder Phase mit explizitem Fehlertext (ungültige Variante, fehlgeschlagener Cargo-Build, fehlende Ausgabebibliothek, Installations-/Umbenennungsfehler).

### Embed-Lebenszyklus (`embed-native.ts`)

1. **Init**: Plattform-Tag aus `TARGET_PLATFORM`/`TARGET_ARCH` oder Host-Werten berechnen
2. **Kandidatenset**:
   - x64 erwartet sowohl `modern` als auch `baseline`
   - Nicht-x64 erwartet eine Standard-Datei
3. **Verfügbarkeit validieren** in `packages/natives/native`
4. **Manifest generieren** (`src/embedded-addon.ts`) mit Bun `file`-Imports und Paketversion
5. **Laufzeit-Extraktion bereit** für kompilierten Modus

`--reset` umgeht die Validierung und schreibt einen Null-Manifest-Stub (`embeddedAddon = null`).

## Entwicklungs-Workflow vs. ausgeliefertes/kompiliertes Verhalten

## Lokaler Entwicklungs-Workflow

Typischer lokaler Ablauf:

1. Addon bauen:
   - Release: `bun --cwd=packages/natives run build`
   - Debug-Profil: `bun --cwd=packages/natives run dev:native`
2. `PI_DEV=1` setzen beim Testen der Loader-Diagnosen
3. Loader in `native.ts` löst paketlokale `native/`-Kandidaten (und Executable-Verzeichnis-Fallback) auf
4. `validateNative` erzwingt Export-Kompatibilität bevor Wrapper das Binding verwenden

## Ausgelieferter/kompilierter Binär-Workflow

Im kompilierten Modus (`PI_COMPILED` oder Bun-Embedded-Marker):

1. Loader berechnet versioniertes Cache-Verzeichnis: `<getNativesDir()>/<packageVersion>` (operativ `~/.xcsh/natives/<version>`)
2. Falls das eingebettete Manifest mit der aktuellen Plattform+Version übereinstimmt, kann der Loader die ausgewählte eingebettete Datei in dieses versionierte Verzeichnis extrahieren
3. Laufzeit-Kandidatenreihenfolge umfasst:
   - Versioniertes Cache-Verzeichnis
   - Legacy-kompiliertes-Binär-Verzeichnis (`%LOCALAPPDATA%/xcsh` unter Windows, `~/.local/bin` andernorts)
   - Paket-/Executable-Verzeichnisse
4. Das erste erfolgreich geladene Addon muss weiterhin `validateNative` bestehen

Deshalb müssen Paketierung + Laufzeit-Loader-Erwartungen übereinstimmen: Dateinamen, Plattform-Tags und exportierte Symbole müssen dem entsprechen, was `native.ts` prüft und validiert.

## JS API ↔ Rust-Export-Zuordnung (Validierungs-Gate-Teilmenge)

`native.ts` erfordert, dass diese JS-sichtbaren Exporte auf dem geladenen Addon existieren. Sie entsprechen Rust N-API-Exporten in `crates/pi-natives/src`:

| JS-Name erforderlich durch `validateNative` | Rust-Export-Deklaration | Rust-Quelldatei |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (camel-cased Export) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

Falls ein erforderliches Symbol fehlt, scheitert der Loader sofort mit einem Rebuild-Hinweis.

## Fehlerverhalten und Diagnose

## Build-Zeit-Fehler

- Ungültige Variantenkonfiguration:
  - `TARGET_VARIANT` auf Nicht-x64 gesetzt → sofortiger Fehler
  - x64 Cross-Build ohne explizites `TARGET_VARIANT` → sofortiger Fehler
- Cargo-Build-Fehler:
  - Skript zeigt Nicht-Null-Exit und stderr an
- Artefakt nicht gefunden:
  - Skript gibt jedes überprüfte Profilverzeichnis aus
- Installationsfehler:
  - Explizite Meldung; Windows enthält Hinweis auf gesperrte Dateien

## Laufzeit-Loader-Fehler (`native.ts`)

- Nicht unterstützter Plattform-Tag:
  - Wirft Fehler mit Liste unterstützter Plattformen
- Kein Kandidat konnte geladen werden:
  - Wirft Fehler mit vollständiger Kandidaten-Fehlerliste und modusspezifischen Behebungshinweisen
- Fehlende Exporte:
  - Wirft Fehler mit exakten fehlenden Symbolnamen und Rebuild-Befehl
- Probleme bei der eingebetteten Extraktion:
  - Extraktions-mkdir/write-Fehler werden aufgezeichnet und in die endgültige Diagnose einbezogen

## Fehlerbehebungsmatrix

| Symptom | Wahrscheinliche Ursache | Überprüfung | Behebung |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | Veraltete `.node`-Binärdatei, Rust-Exportname-Abweichung oder falsche Binärdatei geladen | Mit `PI_DEV=1` ausführen, um den geladenen Pfad zu sehen; Exportliste für diese Datei überprüfen | `build` neu ausführen; sicherstellen, dass der Rust `#[napi]`-Exportname (oder expliziter Alias wenn nötig) dem JS-Schlüssel entspricht; veraltete gecachte/versionierte Dateien entfernen |
| x64-Maschine lädt baseline obwohl modern erwartet | `PI_NATIVE_VARIANT=baseline`, kein AVX2 erkannt, oder nur baseline-Datei vorhanden | `PI_NATIVE_VARIANT` prüfen; `native/` auf `-modern`-Datei überprüfen | Modern-Variante bauen (`TARGET_VARIANT=modern ... build`) und sicherstellen, dass die Datei ausgeliefert wird |
| Cross-Build erzeugt unbrauchbare/falsch benannte Binärdatei | Abweichung zwischen `CROSS_TARGET` und `TARGET_PLATFORM`/`TARGET_ARCH`, oder fehlendes `TARGET_VARIANT` für x64 | Env-Tupel und Ausgabedateinamen bestätigen | Mit konsistenten Env-Werten und explizitem x64 `TARGET_VARIANT` erneut ausführen |
| Kompilierte Binärdatei schlägt nach Upgrade fehl | Veralteter extrahierter Cache (`~/.xcsh/natives/<alte-oder-nicht-übereinstimmende-version>`) oder eingebettete Manifest-Abweichung | Versioniertes Natives-Verzeichnis und Loader-Fehlerliste überprüfen | Versionierten Natives-Cache für die Paketversion löschen und erneut ausführen; eingebettetes Manifest während der Paketierung neu generieren |
| Loader prüft viele Pfade und keiner funktioniert | Plattform-Abweichung oder fehlendes Release-Artefakt im Paket `native/` | `platformTag` mit tatsächlichen Dateinamen vergleichen | Sicherstellen, dass der gebaute Dateiname exakt der `pi_natives.<platform>-<arch>(-variant).node`-Konvention entspricht und das Paket `native/` enthält |
| `embed:native` schlägt mit "Incomplete native addons" fehl | Erforderliche Varianten-Dateien wurden vor dem Einbetten nicht gebaut | Erwartete vs. gefundene Liste im Fehlertext prüfen | Erforderliche Dateien zuerst bauen (x64: sowohl modern+baseline; Nicht-x64: Standard), dann `embed:native` erneut ausführen |

## Operative Befehle

```bash
# Release-Artefakt für den aktuellen Host
bun --cwd=packages/natives run build

# Debug-Profil-Artefakt-Build
bun --cwd=packages/natives run dev:native

# Explizite x64-Varianten bauen
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# Eingebettetes Addon-Manifest aus gebauten nativen Dateien generieren
bun --cwd=packages/natives run embed:native

# Eingebettetes Manifest auf Null-Stub zurücksetzen
bun --cwd=packages/natives run embed:native -- --reset
```
