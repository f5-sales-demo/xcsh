---
title: Nativer Binding-Vertrag (TypeScript-Seite)
description: >-
  TypeScript-seitiger Binding-Vertrag für den Aufruf nativer Rust-Funktionen
  über N-API.
sidebar:
  order: 2
  label: Binding-Vertrag
i18n:
  sourceHash: 36dc5fed1f0a
  translator: machine
---

# Nativer Binding-Vertrag (TypeScript-Seite)

Dieses Dokument definiert den TypeScript-seitigen Vertrag, der zwischen den Aufrufern von `@f5-sales-demo/pi-natives` und dem geladenen N-API-Addon steht.

Es konzentriert sich auf drei Aspekte:

1. Vertragsform (`NativeBindings` + Modul-Augmentierung),
2. Wrapper-Verhalten (`src/<module>/index.ts`),
3. Öffentliche Exportoberfläche (`src/index.ts`).

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

- `NativeBindings` (Basisinterface, enthält derzeit `cancelWork(id: number): void`)
- `Cancellable` (`timeoutMs?: number`, `signal?: AbortSignal`)
- `TsFunc<T>` Callback-Signatur, die von N-API-threadsicheren Callbacks verwendet wird

Jedes Modul fügt seine eigenen Felder durch Deklarationszusammenführung hinzu:

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

Dies ergibt ein aggregiertes Binding-Interface ohne eine monolithische zentrale Typdatei.

## Lebenszyklus der Deklarationszusammenführung und Zustandsübergänge

### 1) Typzusammenstellung zur Kompilierzeit

- `bindings.ts` stellt das Basis-Symbol `NativeBindings` bereit.
- Jede `src/<module>/types.ts` augmentiert `NativeBindings`.
- `src/native.ts` importiert alle `./<module>/types`-Dateien für Seiteneffekte, damit der zusammengeführte Vertrag im Geltungsbereich ist, wo `NativeBindings` verwendet wird.

Zustandsübergang: **Basisvertrag** → **Zusammengeführter Vertrag**.

### 2) Laufzeit-Addon-Laden und Validierungsschranke

- `src/native.ts` lädt Kandidaten-`.node`-Binärdateien.
- Das geladene Objekt wird als `NativeBindings` behandelt und sofort durch `validateNative(...)` geleitet.
- `validateNative` überprüft erforderliche Exportschlüssel mittels `typeof bindings[name] === "function"`.

Zustandsübergang: **Nicht vertrauenswürdiges Addon-Objekt** → **Validiertes natives Binding-Objekt** (oder harter Fehler).

### 3) Wrapper-Aufruf

- Modul-Wrapper in `src/<module>/index.ts` rufen `native.<export>` auf.
- Wrapper passen Standardwerte und Callback-Signaturen an (`(err, value)` zu Nur-Wert-Callback-Mustern in JS-APIs).
- `src/index.ts` re-exportiert Modul-Wrapper/Typen als öffentliche Paket-API.

Zustandsübergang: **Validierte Roh-Bindings** → **Ergonomische öffentliche API**.

## Verantwortlichkeiten der Wrapper

Wrapper sind bewusst dünn gehalten; sie reimplementieren keine native Logik.

Hauptverantwortlichkeiten:

- **Argument-Normalisierung/Standardwerte**
  - `glob()` löst `options.path` zu einem absoluten Pfad auf und setzt Standardwerte für `hidden`, `gitignore`, `recursive`.
  - `hasMatch()` füllt Standard-Flags (`ignoreCase`, `multiline`) vor dem nativen Aufruf.
- **Callback-Anpassung**
  - `grep()`, `glob()`, `executeShell()` konvertieren `TsFunc<T>` (`error, value`) in einen Benutzer-Callback, der nur erfolgreiche Werte empfängt.
- **Umgebungs- oder Richtlinienverhalten um native Aufrufe**
  - Der Clipboard-Wrapper fügt OSC52/Termux/Headless-Behandlung hinzu und behandelt das Kopieren als Best-Effort.
- **Öffentliche Benennung und Re-Export-Kuratierung**
  - `searchContent()` wird auf den nativen Export `search` abgebildet.

## Organisation der öffentlichen Exportoberfläche

`packages/natives/src/index.ts` ist das kanonische öffentliche Barrel. Es gruppiert Exporte nach Fähigkeitsdomäne:

- Suche/Text: `grep`, `glob`, `text`, `highlight`
- Ausführung/Prozess/Terminal: `shell`, `pty`, `ps`, `keys`
- System/Medien/Konvertierung: `image`, `html`, `clipboard`, `system-info`, `work`

Regel für Maintainer: Wenn ein Wrapper nicht aus `src/index.ts` re-exportiert wird, gehört er nicht zur beabsichtigten öffentlichen Paketoberfläche.

## JS-API ↔ Native-Export-Zuordnung (repräsentativ)

Die Rust-Seite verwendet N-API-Exportnamen (typischerweise durch `#[napi]` snake_case → camelCase-Konvertierung, gelegentlich mit expliziten Aliasen), die mit diesen Binding-Schlüsseln übereinstimmen müssen.

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

- **Promise-basierte asynchrone Exporte** für I/O oder langlebige Arbeit (`grep`, `glob`, `htmlToMarkdown`, `executeShell`, Clipboard, Bildoperationen).
- **Synchrone Exporte** für deterministische In-Memory-Transformationen/Parser (`search`, `hasMatch`, Highlighting, Textbreite/-Slicing, Schlüssel-Parsing, Prozessabfragen).
- **Konstruktor-Exporte** für zustandsbehaftete Laufzeitobjekte (`Shell`, `PtySession`, `PhotonImage`).

Implikation für Maintainer: Das Ändern von synchron ↔ asynchron für einen bestehenden Export ist eine breaking API- und Vertragsänderung über Wrapper und Aufrufer hinweg.

## Objekt- und Enum-Typisierungsmuster

### Objektmuster (JS-Objekte im `#[napi(object)]`-Stil)

TS modelliert objektförmige native Werte als Interfaces, zum Beispiel:

- `GrepResult`, `SearchResult`, `GlobResult`
- `SystemInfo`, `WorkProfile`
- `ClipboardImage`, `ParsedKittyResult`

Dies sind strukturelle Verträge zur Kompilierzeit; die Korrektheit der Laufzeitform liegt in der Verantwortung der nativen Implementierung.

### Enum-Muster

Numerische native Enums werden als `const enum`-Werte in TS dargestellt:

- `FileType` (`1=file`, `2=dir`, `3=symlink`)
- `ImageFormat` (`0=PNG`, `1=JPEG`, `2=WEBP`, `3=GIF`)
- `SamplingFilter`, `Ellipsis`, `KeyEventType`

Aufrufer sehen benannte Enum-Mitglieder; an der Binding-Grenze werden Zahlen übergeben.

## Wie Abweichungen erkannt werden

Die Erkennung von Abweichungen erfolgt auf zwei Ebenen:

1. **Vertragsprüfungen durch TypeScript zur Kompilierzeit**
   - Wrapper rufen `native.<name>` gegen das zusammengeführte `NativeBindings` auf.
   - Fehlende/umbenannte Binding-Schlüssel brechen die TS-Typprüfung in Wrappern.

2. **Laufzeitvalidierung in `validateNative`**
   - Nach dem Laden prüft `native.ts` die erforderlichen Exporte und wirft einen Fehler, wenn welche fehlen.
   - Die Fehlermeldung enthält die fehlenden Schlüssel und eine Rebuild-Anweisung.

Dies fängt den häufigen Fall veralteter Binärdateien ab: Wrapper/Typ existiert, aber das geladene `.node` besitzt den Export nicht.

## Fehlerverhalten und Einschränkungen

### Lade-/Validierungsfehler (harte Fehler)

- Addon-Ladefehler oder nicht unterstützte Plattform lösen während der Modulinitialisierung in `native.ts` eine Exception aus.
- Fehlende erforderliche Exporte lösen eine Exception aus, bevor Wrapper nutzbar sind.

Effekt: Das Paket schlägt sofort fehl, anstatt den Fehler bis zum ersten Aufruf aufzuschieben.

### Verhaltensunterschiede auf Wrapper-Ebene

- Einige Wrapper mildern Fehler bewusst ab (`copyToClipboard` arbeitet nach dem Best-Effort-Prinzip und schluckt native Fehler).
- Streaming-Callbacks ignorieren Callback-Fehler-Payloads und leiten nur erfolgreiche Wert-Events weiter.

### Einschränkungen auf Typebene (Laufzeit strenger als TS)

- Optionale TS-Felder garantieren keine semantische Gültigkeit; die native Schicht kann trotzdem fehlerhafte Werte ablehnen.
- `const enum`-Typisierung verhindert nicht, dass zur Laufzeit numerische Werte außerhalb des gültigen Bereichs von untypisierten Aufrufern übergeben werden.
- `validateNative` prüft nur die Anwesenheit und den Funktionscharakter der erforderlichen Exporte, nicht die tiefe Argument-/Rückgabe-Form-Kompatibilität.
- `bindings.ts` enthält `cancelWork(id)` im Basisinterface, aber die aktuelle Laufzeit-Validierungsliste erzwingt diesen Schlüssel nicht.

## Maintainer-Checkliste für Binding-Änderungen

Beim Hinzufügen/Ändern eines Exports sind alle folgenden Stellen zu aktualisieren:

1. `src/<module>/types.ts` (Augmentierung + Vertragstypen)
2. `src/<module>/index.ts` (Wrapper-Verhalten)
3. `src/native.ts`-Importe für die Modultypen (bei neuem Modul)
4. `validateNative` Prüfungen der erforderlichen Exporte
5. `src/index.ts` öffentliche Re-Exporte

Das Auslassen eines Schrittes erzeugt entweder Kompilierzeit-Abweichungen oder Laufzeit-Ladefehler.
