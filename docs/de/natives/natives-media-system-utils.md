---
title: Native Media- und System-Hilfsprogramme
description: >-
  Native Medienverarbeitungs-Hilfsprogramme für Screenshots, Bildverarbeitung
  und Systeminformationen.
sidebar:
  order: 7
  label: Medien- & System-Hilfsprogramme
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# Native Medien- und System-Hilfsprogramme

Dieses Dokument ist ein Subsystem-Deep-Dive für die Schicht der **System-/Medien-/Konvertierungsprimitive**, die in [`docs/natives-architecture.md`](./natives-architecture.md) beschrieben wird: `image`, `html`, `clipboard` und `work`-Profiling.

## Implementierungsdateien

- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/prof.rs`
- `crates/pi-natives/src/task.rs`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/work/index.ts`
- `packages/natives/src/work/types.ts`

> Hinweis: Es gibt keine Datei `crates/pi-natives/src/work.rs`; Work-Profiling ist in `prof.rs` implementiert und wird durch Instrumentierung in `task.rs` gespeist.

## TS-API ↔ Rust-Export/Modul-Zuordnung

| TS-Export (packages/natives)                | Rust N-API-Export                                                       | Rust-Modul                            |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `PhotonImage.parse(bytes)`                  | `PhotonImage::parse`                                                     | `image.rs`                            |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize`                                                    | `image.rs`                            |
| `PhotonImage#encode(format, quality)`       | `PhotonImage::encode`                                                    | `image.rs`                            |
| `htmlToMarkdown(html, options)`             | `html_to_markdown`                                                       | `html.rs`                             |
| `copyToClipboard(text)`                     | `copy_to_clipboard` + TS-Fallback-Logik                                  | `clipboard.rs` + `clipboard/index.ts` |
| `readImageFromClipboard()`                  | `read_image_from_clipboard`                                              | `clipboard.rs`                        |
| `getWorkProfile(lastSeconds)`               | `get_work_profile`                                                      | `prof.rs`                             |

## Datenformat-Grenzen und Konvertierungen

### Bild (`image`)

- **JS-Eingabegrenze**: `Uint8Array` kodierte Bildbytes.
- **Rust-Dekodierungsgrenze**: Bytes werden in `Vec<u8>` kopiert, das Format wird mit `ImageReader::with_guessed_format()` erraten und dann zu `DynamicImage` dekodiert.
- **Zustand im Speicher**: `PhotonImage` speichert `Arc<DynamicImage>`.
- **Ausgabegrenze**: `encode(format, quality)` gibt `Promise<Uint8Array>` zurück (Rust `Vec<u8>`).

Format-IDs sind numerisch:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (verlustfreier Encoder)
- `3`: GIF

Einschränkungen:

- `quality` wird nur für JPEG verwendet.
- PNG/WebP/GIF ignorieren `quality`.
- Nicht unterstützte Format-IDs schlagen fehl (`Invalid image format: <id>`).

### HTML-Konvertierung (`html`)

- **JS-Eingabegrenze**: HTML-`string` + optionales Objekt `{ cleanContent?: boolean; skipImages?: boolean }`.
- **Rust-Konvertierungsgrenze**: `String`-Eingabe wird durch `html_to_markdown_rs::convert` konvertiert.
- **Ausgabegrenze**: Markdown-`string`.

Konvertierungsverhalten:

- `cleanContent` ist standardmäßig `false`.
- Wenn `cleanContent=true`, wird Vorverarbeitung mit `PreprocessingPreset::Aggressive` und Flags zur strikten Entfernung von Navigation/Formularen aktiviert.
- `skipImages` ist standardmäßig `false`.

### Zwischenablage (`clipboard`)

- **Text-Pfad**:
  - TS sendet zuerst OSC 52 (`\x1b]52;c;<base64>\x07`), wenn stdout ein TTY ist.
  - Derselbe Text wird dann als Best-Effort über die native Zwischenablage-API (`native.copyToClipboard`) versucht.
  - Auf Termux versucht TS zuerst `termux-clipboard-set`.
- **Bild-Lesepfad**:
  - Rust liest das Rohbild aus `arboard`.
  - Rust kodiert es in PNG-Bytes um (`image`-Crate), gibt `{ data: Uint8Array, mimeType: "image/png" }` zurück.
  - TS gibt frühzeitig `null` zurück auf Termux oder Linux-Sitzungen ohne Display-Server (fehlende `DISPLAY`/`WAYLAND_DISPLAY`).

### Work-Profiling (`work`)

- **Erfassungsgrenze**: Profiling-Samples werden durch `profile_region(tag)`-Guards in `task::blocking` und `task::future` erzeugt.
- **Speicherformat**: Ringpuffer fester Größe (`MAX_SAMPLES = 10_000`), der Stack-Pfad + Dauer (`μs`) + Zeitstempel (`μs seit Prozessstart`) speichert.
- **Ausgabegrenze**: `getWorkProfile(lastSeconds)` gibt ein Objekt zurück:
  - `folded`: Gefalteter Stack-Text (Flamegraph-Eingabe)
  - `summary`: Markdown-Tabellenzusammenfassung
  - `svg`: Optionaler Flamegraph-SVG
  - `totalMs`, `sampleCount`

## Lebenszyklus und Zustandsübergänge

### Bild-Lebenszyklus

1. `PhotonImage.parse(bytes)` plant eine blockierende Dekodierungsaufgabe (`image.decode`).
2. Bei Erfolg existiert ein nativer `PhotonImage`-Handle in JS.
3. `resize(...)` erstellt einen neuen nativen Handle (`image.resize`), alter und neuer Handle können koexistieren.
4. `encode(...)` materialisiert Bytes (`image.encode`), ohne die Bilddimensionen zu verändern.

Fehlerübergänge:

- Format-Erkennungs-/Dekodierungsfehler lehnen das Parse-Promise ab.
- Kodierungsfehler lehnen das Encode-Promise ab.
- Ungültige Format-IDs lehnen das Encode-Promise ab.

### HTML-Lebenszyklus

1. `htmlToMarkdown(html, options)` plant eine blockierende Konvertierungsaufgabe.
2. Die Konvertierung läuft mit Standardoptionen (`cleanContent=false`, `skipImages=false`), sofern nicht anders angegeben.
3. Gibt einen Markdown-String zurück oder lehnt ab.

Fehlerübergänge:

- Konvertierungsfehler geben ein abgelehntes Promise zurück (`Conversion error: ...`).

### Zwischenablage-Lebenszyklus

`copyToClipboard(text)` ist absichtlich Best-Effort und verwendet mehrere Pfade:

1. Falls TTY: Versuch eines OSC-52-Schreibvorgangs (Base64-Payload).
2. Versuch des Termux-Befehls, wenn `TERMUX_VERSION` gesetzt ist.
3. Versuch der nativen `arboard`-Textkopie.
4. Fehler werden auf TS-Ebene unterdrückt.

`readImageFromClipboard()` unterscheidet sich in der Strenge je nach Phase:

1. TS blockiert nicht unterstützte Laufzeitkontexte (Termux/headless Linux) hart mit `null`.
2. Rust `arboard`-Lesen wird nur ausgeführt, wenn TS es erlaubt.
3. `ContentNotAvailable` wird auf `null` abgebildet.
4. Andere Rust-Fehler lehnen ab.

### Work-Profiling-Lebenszyklus

1. Kein expliziter Start: Profiling ist immer aktiv, wenn Task-Helfer ausgeführt werden.
2. Jeder instrumentierte Task-Scope zeichnet ein Sample beim Guard-Drop auf.
3. Samples überschreiben die ältesten Einträge, nachdem die Pufferkapazität erreicht ist.
4. `getWorkProfile(lastSeconds)` liest ein Zeitfenster und leitet gefaltete/zusammenfassende/SVG-Artefakte ab.

Fehlerübergänge:

- SVG-Generierungsfehler sind ein Soft-Fail (`svg: null`), während gefaltete Daten und Zusammenfassung weiterhin zurückgegeben werden.
- Ein leeres Sample-Fenster gibt leere gefaltete Daten und `svg: null` zurück, keinen Fehler.

## Nicht unterstützte Operationen und Fehlerweitergabe

### Bild

- Nicht unterstützte Dekodierungseingabe oder beschädigte Bytes: strikter Fehler (Promise-Ablehnung).
- Nicht unterstützte Encode-Format-ID: strikter Fehler.
- Kein Best-Effort-Fallback-Pfad im TS-Wrapper.

### HTML

- Konvertierungsfehler sind strikte Fehler (Ablehnung).
- Auslassung von Optionen ist Best-Effort-Standardisierung, kein Fehler.

### Zwischenablage

- Textkopie ist Best-Effort auf TS-Ebene: Betriebsfehler werden unterdrückt.
- Bildlesen unterscheidet zwischen "kein Bild" (`null`) und Betriebsfehler (Ablehnung).
- Termux/headless Linux werden als nicht unterstützte Kontexte für das Bildlesen behandelt (`null`).

### Work-Profiling

- Der Abruf ist strikt für den Funktionsaufruf selbst, aber die Artefakt-Generierung ist teilweise Best-Effort (`svg` nullable).
- Pufferabschneidung ist erwartetes Verhalten (Ringpuffer), kein Datenverlust-Bug.

## Plattform-Besonderheiten

- **Zwischenablage-Text**: OSC 52 hängt von der Terminal-Unterstützung ab; nativer Zwischenablagezugriff hängt von der Desktop-Umgebung/Sitzung ab.
- **Zwischenablage-Bildlesen**: In TS blockiert für Termux und Linux ohne Display-Server.
