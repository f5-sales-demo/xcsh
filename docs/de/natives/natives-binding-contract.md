---
title: Nativer Binding-Vertrag (TypeScript-Seite)
description: >-
  TypeScript-seitiger Binding-Vertrag zum Aufrufen nativer Rust-Funktionen über
  N-API.
sidebar:
  order: 2
  label: Binding-Vertrag
i18n:
  sourceHash: f5b74267cdd5
  translator: machine
---

# Nativer Binding-Vertrag (TypeScript-Seite)

Dieses Dokument definiert den TypeScript-seitigen Vertrag, der zwischen Aufrufern von `@f5xc-salesdemos/pi-natives` und dem geladenen N-API-Addon steht.

Es konzentriert sich auf drei Aspekte:

1. Vertragsform (`NativeBindings` + Modul-Augmentation),
2. Wrapper-Verhalten (`src/<module>/index.ts`),
3. Öffentliche Export-Oberfläche (`src/index.ts`).

## Implementierungsdateien

- `packages/natives/src/bindings.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/grep/index.ts`
- `packages/natives/src/highlight/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/system-info/types.ts`
- `packages/natives/src/system-info/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/work/types.ts`
- `packages/natives/src/work/index.ts`

## Vertragsmodell

`packages/natives/src/bindings.ts` definiert den Basisvertrag:

- `NativeBindings` (Basis-Interface, enthält derzeit `cancelWork(id: number): void`)
- `Cancellable` (`timeoutMs?: number`, `signal?: AbortSignal`)
- `TsFunc<T>` Callback-Form, die von N-API-Threadsafe-Callbacks verwendet wird

Jedes Modul fügt seine eigenen Felder durch Declaration Merging hinzu:

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

Dies erhält ein aggregiertes Binding-Interface ohne eine monolithische zentrale Typdatei.

## Declaration-Merging-Lebenszyklus und Zustandsübergänge

### 1) Typzusammensetzung zur Kompilierzeit

- `bindings.ts` stellt das Basis-Symbol `NativeBindings` bereit.
- Jede `src/<module>/types.ts` erweitert `NativeBindings`.
- `src/native.ts` importiert alle `./<module>/types`-Dateien wegen ihrer Seiteneffekte, damit der zusammengeführte Vertrag im Gültigkeitsbereich liegt, wo `NativeBindings` verwendet wird.

Zustandsübergang: **Basisvertrag** → **Zusammengeführter Vertrag**.

### 2) Addon-Laden zur Laufzeit und Validierungsschleuse

- `src/native.ts` lädt `.node`-Binärkandidaten.
- Das geladene Objekt wird als `NativeBindings` behandelt und sofort durch `validateNative(...)` geleitet.
- `validateNative` überprüft die erforderlichen Export-Schlüssel mittels `typeof bindings[name] === "function"`.

Zustandsübergang: **Nicht vertrauenswürdiges Addon-Objekt** → **Validiertes natives Binding-Objekt** (oder harter Fehler).

### 3) Wrapper-Aufruf

- Modul-Wrapper in `src/<module>/index.ts` rufen `native.<export>` auf.
- Wrapper passen Standardwerte und Callback-Form an (`(err, value)` zu Nur-Wert-Callback-Mustern in JS-APIs).
- `src/index.ts` re-exportiert Modul-Wrapper/Typen als öffentliche Paket-API.

Zustandsübergang: **Validierte Roh-Bindings** → **Ergonomische öffentliche API**.

## Wrapper-Verantwortlichkeiten

Wrapper sind absichtlich dünn gehalten; sie implementieren keine native Logik erneut.

Hauptverantwortlichkeiten:

- **Argument-Normalisierung/-Standardwerte**
  - `glob()` löst `options.path` in einen absoluten Pfad auf und setzt Standardwerte für `hidden`, `gitignore`, `recursive`.
  - `hasMatch()` füllt Standard-Flags (`ignoreCase`, `multiline`) vor dem nativen Aufruf.
- **Callback-Anpassung**
  - `grep()`, `glob()`, `executeShell()` konvertieren `TsFunc<T>` (`error, value`) in Benutzer-Callbacks, die nur erfolgreiche Werte empfangen.
- **Umgebungs- oder Richtlinienverhalten rund um native Aufrufe**
  - Der Clipboard-Wrapper fügt OSC52/Termux/Headless-Behandlung hinzu und behandelt das Kopieren als Best-Effort.
- **Öffentliche Benennung und Re-Export-Kuratierung**
  - `searchContent()` bildet auf den nativen Export `search` ab.

## Organisation der öffentlichen Export-Oberfläche

`packages/natives/src/index.ts` ist das kanonische öffentliche Barrel. Es gruppiert Exporte nach Fähigkeitsdomäne:

- Suche/Text: `grep`, `glob`, `text`, `highlight`
- Ausführung/Prozess/Terminal: `shell`, `pty`, `ps`, `keys`
- System/Medien/Konvertierung: `image`, `html`, `clipboard`, `system-info`, `work`

Regel für Maintainer: Wenn ein Wrapper nicht aus `src/index.ts` re-exportiert wird, gehört er nicht zur beabsichtigten öffentlichen Paket-Oberfläche.

## JS-API ↔ Native-Export-Zuordnung (repräsentativ)

Die Rust-Seite verwendet N-API-Exportnamen (typischerweise aus der `#[napi]` snake_case -> camelCase-Konvertierung, mit gelegentlichen expliziten Aliasen), die mit diesen Binding-Schlüsseln übereinstimmen müssen.

| Kategorie | Öffentliche JS-API (Wrapper) | Nativer Binding-Schlüssel | Rückgabetyp | Async? |
|---|---|---|---|---|
| Grep | `grep(options, onMatch?)` | `grep` | `Promise<GrepResult>` | Ja |
| Grep | `searchContent(content, options)` | `search` | `SearchResult` | Nein |
| Grep | `hasMatch(content, pattern, opts?)` | `hasMatch` | `boolean` | Nein |
| Grep | `fuzzyFind(options)` | `fuzzyFind` | `Promise<FuzzyFindResult>` | Ja |
| Glob | `glob(options, onMatch?)` | `glob` | `Promise<GlobResult>` | Ja |
| Glob | `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `void` | Nein |
| Shell | `executeShell(options, onChunk?)` | `executeShell` | `Promise<ShellExecuteResult>` | Ja |
| Shell | `Shell` | `Shell` | Klassenkonstruktor | N/A |
| PTY | `PtySession` | `PtySession` | Klassenkonstruktor | N/A |
| Text | `truncateToWidth(...)` | `truncateToWidth` | `string` | Nein |
| Text | `sliceWithWidth(...)` | `sliceWithWidth` | `SliceWithWidthResult` | Nein |
| Text | `visibleWidth(text)` | `visibleWidth` | `number` | Nein |
| Highlight | `highlightCode(code, lang, colors)` | `highlightCode` | `string` | Nein |
| HTML | `htmlToMarkdown(html, options?)` | `htmlToMarkdown` | `Promise<string>` | Ja |
| System | `getSystemInfo()` | `getSystemInfo` | `SystemInfo` | Nein |
| Work | `getWorkProfile(lastSeconds)` | `getWorkProfile` | `WorkProfile` | Nein |
| Prozess | `killTree(pid, signal)` | `killTree` | `number` | Nein |
| Prozess | `listDescendants(pid)` | `listDescendants` | `number[]` | Nein |
| Clipboard | `copyToClipboard(text)` | `copyToClipboard` | `Promise<void>` (Best-Effort-Wrapper-Verhalten) | Ja |
| Clipboard | `readImageFromClipboard()` | `readImageFromClipboard` | `Promise<ClipboardImage \| null>` | Ja |
| Keys | `parseKey(data, kittyProtocolActive)` | `parseKey` | `string \| null` | Nein |

## Unterschiede zwischen synchronem und asynchronem Vertrag

Der Vertrag mischt synchrone und asynchrone APIs; Wrapper bewahren den nativen Aufrufstil, anstatt ein einzelnes Modell zu erzwingen:

- **Promise-basierte asynchrone Exporte** für I/O oder lang laufende Arbeit (`grep`, `glob`, `htmlToMarkdown`, `executeShell`, Clipboard, Bildoperationen).
- **Synchrone Exporte** für deterministische In-Memory-Transformationen/Parser (`search`, `hasMatch`, Highlighting, Textbreite/-Slicing, Key-Parsing, Prozessabfragen).
- **Konstruktor-Exporte** für zustandsbehaftete Laufzeitobjekte (`Shell`, `PtySession`, `PhotonImage`).

Implikation für Maintainer: Die Änderung von synchron ↔ asynchron bei einem bestehenden Export ist eine Breaking-API- und Vertragsänderung über Wrapper und Aufrufer hinweg.

## Objekt- und Enum-Typisierungsmuster

### Objektmuster (JS-Objekte im `#[napi(object)]`-Stil)

TS modelliert objektförmige native Werte als Interfaces, zum Beispiel:

- `GrepResult`, `SearchResult`, `GlobResult`
- `SystemInfo`, `WorkProfile`
- `ClipboardImage`, `ParsedKittyResult`

Dies sind strukturelle Verträge zur Kompilierzeit; die Korrektheit der Laufzeitform wird von der nativen Implementierung verantwortet.

### Enum-Muster

Numerische native Enums werden als `const enum`-Werte in TS dargestellt:

- `FileType` (`1=file`, `2=dir`, `3=symlink`)
- `ImageFormat` (`0=PNG`, `1=JPEG`, `2=WEBP`, `3=GIF`)
- `SamplingFilter`, `Ellipsis`, `KeyEventType`

Aufrufer sehen benannte Enum-Mitglieder; über die Binding-Grenze werden Zahlen übergeben.

## Wie Diskrepanzen erkannt werden

Die Erkennung von Diskrepanzen erfolgt auf zwei Ebenen:

1. **TypeScript-Vertragsprüfungen zur Kompilierzeit**
   - Wrapper rufen `native.<name>` gegen das zusammengeführte `NativeBindings` auf.
   - Fehlende/umbenannte Binding-Schlüssel brechen die TS-Typprüfung in Wrappern.

2. **Laufzeitvalidierung in `validateNative`**
   - Nach dem Laden prüft `native.ts` die erforderlichen Exporte und wirft einen Fehler, wenn welche fehlen.
   - Die Fehlermeldung enthält die fehlenden Schlüssel und eine Rebuild-Anweisung.

Dies fängt den häufigen Drift veralteter Binärdateien ab: Wrapper/Typ existiert, aber die geladene `.node`-Datei hat den Export nicht.

## Fehlerverhalten und Einschränkungen

### Lade-/Validierungsfehler (harte Fehler)

- Addon-Ladefehler oder nicht unterstützte Plattform wirft während der Modulinitialisierung in `native.ts`.
- Fehlende erforderliche Exporte werfen, bevor Wrapper nutzbar sind.

Auswirkung: Das Paket scheitert frühzeitig, anstatt den Fehler auf den ersten Aufruf zu verschieben.

### Verhaltensunterschiede auf Wrapper-Ebene

- Einige Wrapper mildern Fehler absichtlich ab (`copyToClipboard` ist Best-Effort und schluckt native Fehler).
- Streaming-Callbacks ignorieren Callback-Fehler-Payloads und leiten nur erfolgreiche Wert-Events weiter.

### Einschränkungen auf Typebene (Laufzeit strenger als TS)

- Optionale TS-Felder garantieren keine semantische Gültigkeit; die native Schicht kann dennoch fehlerhafte Werte ablehnen.
- `const enum`-Typisierung verhindert nicht, dass zur Laufzeit Zahlenwerte außerhalb des gültigen Bereichs von untypisierte Aufrufern übergeben werden.
- `validateNative` prüft nur das Vorhandensein und die Funktion-Eigenschaft der erforderlichen Exporte, nicht die tiefe Argument-/Rückgabeform-Kompatibilität.
- `bindings.ts` enthält `cancelWork(id)` im Basis-Interface, aber die aktuelle Laufzeitvalidierungsliste erzwingt diesen Schlüssel nicht.

## Maintainer-Checkliste für Binding-Änderungen

Beim Hinzufügen/Ändern eines Exports müssen alle folgenden Punkte aktualisiert werden:

1. `src/<module>/types.ts` (Augmentation + Vertragstypen)
2. `src/<module>/index.ts` (Wrapper-Verhalten)
3. `src/native.ts`-Importe für die Modultypen (bei neuem Modul)
4. `validateNative`-Prüfungen der erforderlichen Exporte
5. `src/index.ts` öffentliche Re-Exporte

Das Überspringen eines Schritts erzeugt entweder Kompilierzeit-Drift oder Laufzeit-Ladefehler.
