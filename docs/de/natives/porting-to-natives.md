---
title: Portierung zu pi-natives (N-API) — Feldnotizen
description: >-
  Feldnotizen für die Migration von Node.js child_process und Shell-Code zur
  Rust N-API nativen Schicht.
sidebar:
  order: 9
  label: Portierung zu pi-natives
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# Portierung zu pi-natives (N-API) — Feldnotizen

Dies ist ein praxisorientierter Leitfaden zum Verschieben von Hot Paths in `crates/pi-natives` und deren Anbindung über die JS-Bindings. Er existiert, um zu vermeiden, dass dieselben Fehler zweimal auftreten.

## Wann portieren

Portieren Sie, wenn einer der folgenden Punkte zutrifft:

- Der Hot Path läuft in Render-Schleifen, engen UI-Updates oder großen Batches.
- JS-Allokationen dominieren (String-Churn, Regex-Backtracking, große Arrays).
- Sie haben bereits eine JS-Baseline und können beide Versionen nebeneinander benchmarken.
- Die Arbeit ist CPU-gebunden oder blockierendes I/O, das im libuv-Thread-Pool laufen kann.
- Die Arbeit ist asynchrones I/O, das auf Tokios Runtime laufen kann (z. B. Shell-Ausführung).

Vermeiden Sie Portierungen, die von JS-exklusivem State oder dynamischen Imports abhängen. N-API-Exports sollten pur sein, Data-in/Data-out. Lang laufende Arbeit sollte über `task::blocking` (CPU-gebunden/blockierendes I/O) oder `task::future` (asynchrones I/O) mit Abbruchmöglichkeit geleitet werden.

## Anatomie eines nativen Exports

**Rust-Seite:**

- Die Implementierung befindet sich in `crates/pi-natives/src/<module>.rs`. Wenn Sie ein neues Modul hinzufügen, registrieren Sie es in `crates/pi-natives/src/lib.rs`.
- Exportieren Sie mit `#[napi]`; snake_case-Exports werden automatisch in camelCase konvertiert. Verwenden Sie explizites `js_name` nur für echte Aliase/nicht-standardmäßige Namen. Verwenden Sie `#[napi(object)]` für Structs.
- Verwenden Sie `task::blocking(tag, cancel_token, work)` (siehe `crates/pi-natives/src/task.rs`) für CPU-gebundene oder blockierende Arbeit. Verwenden Sie `task::future(env, tag, work)` für asynchrone Arbeit, die Tokio benötigt (z. B. Shell-Sessions). Übergeben Sie ein `CancelToken`, wenn Sie `timeoutMs` oder `AbortSignal` exponieren.

**JS-Seite:**

- `packages/natives/src/bindings.ts` enthält das Basis-`NativeBindings`-Interface.
- `packages/natives/src/<module>/types.ts` definiert TS-Typen und erweitert `NativeBindings` via Declaration Merging.
- `packages/natives/src/native.ts` importiert jede `<module>/types.ts`-Datei, um die Deklarationen zu aktivieren.
- `packages/natives/src/<module>/index.ts` umhüllt das `native`-Binding aus `packages/natives/src/native.ts`.
- `packages/natives/src/native.ts` lädt das Addon und `validateNative` erzwingt die erforderlichen Exports.
- `packages/natives/src/index.ts` re-exportiert den Wrapper für Aufrufer in `packages/*`.

## Portierungs-Checkliste

1. **Rust-Implementierung hinzufügen**

- Platzieren Sie die Kernlogik in einer einfachen Rust-Funktion.
- Wenn es ein neues Modul ist, fügen Sie es zu `crates/pi-natives/src/lib.rs` hinzu.
- Exponieren Sie es mit `#[napi]`, damit das Standard-Mapping snake_case -> camelCase konsistent bleibt.
- Halten Sie Signaturen owned und einfach: `String`, `Vec<String>`, `Uint8Array` oder `Either<JsString, Uint8Array>` für große String-/Byte-Eingaben.
- Für CPU-gebundene oder blockierende Arbeit verwenden Sie `task::blocking`; für asynchrone Arbeit verwenden Sie `task::future`. Übergeben Sie ein `CancelToken` und rufen Sie `heartbeat()` in langen Schleifen auf.

2. **JS-Bindings verdrahten**

- Fügen Sie die Typen und die `NativeBindings`-Erweiterung in `packages/natives/src/<module>/types.ts` hinzu.
- Importieren Sie `./<module>/types` in `packages/natives/src/native.ts`, um Declaration Merging auszulösen.
- Fügen Sie einen Wrapper in `packages/natives/src/<module>/index.ts` hinzu, der `native` aufruft.
- Re-exportieren Sie aus `packages/natives/src/index.ts`.

3. **Native-Validierung aktualisieren**

- Fügen Sie `checkFn("newExport")` in `validateNative` (`packages/natives/src/native.ts`) hinzu.

4. **Benchmarks hinzufügen**

- Platzieren Sie Benchmarks neben dem zugehörigen Paket (`packages/tui/bench`, `packages/natives/bench` oder `packages/coding-agent/bench`).
- Fügen Sie eine JS-Baseline und die native Version im selben Durchlauf ein.
- Verwenden Sie `Bun.nanoseconds()` und eine feste Iterationsanzahl.
- Halten Sie die Benchmark-Eingaben klein und realistisch (tatsächliche Daten aus dem Hot Path).

5. **Native Binary bauen**

- `bun --cwd=packages/natives run build`
- Verwenden Sie `bun --cwd=packages/natives run build` und setzen Sie `PI_DEV=1`, wenn Sie beim Testen Loader-Diagnosen sehen möchten.

6. **Benchmark ausführen**

- `bun run packages/<pkg>/bench/<bench>.ts` (oder `bun --cwd=packages/natives run bench`)

7. **Über Verwendung entscheiden**

- Wenn native langsamer ist, **behalten Sie JS** bei und lassen Sie den nativen Export ungenutzt.
- Wenn native schneller ist, wechseln Sie die Aufrufstellen zum nativen Wrapper.

## Schmerzpunkte und wie man sie vermeidet

### 1) Veraltete `pi_natives.node` verhindert neue Exports

Der Loader bevorzugt die plattform-getaggte Binary in `packages/natives/native` (`pi_natives.<platform>-<arch>.node`). `PI_DEV=1` aktiviert jetzt nur Loader-Diagnosen; es wechselt nicht mehr zu einem separaten Dev-Addon-Dateinamen. Es gibt auch ein Fallback `pi_natives.node`. Kompilierte Binaries werden nach `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node` extrahiert. Wenn eine dieser Dateien veraltet ist, werden Exports nicht aktualisiert.

**Lösung:** Entfernen Sie die veraltete Datei vor dem Neubauen.

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

Wenn Sie eine kompilierte Binary verwenden, löschen Sie das zwischengespeicherte Addon-Verzeichnis:

```bash
rm -rf ~/.xcsh/natives/<version>
```

Überprüfen Sie dann, ob der Export in der Binary vorhanden ist:

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) "Missing exports"-Fehler von `validateNative`

Das ist **gut** — es verhindert stille Abweichungen. Wenn Sie dies sehen:

```
Native addon missing exports ... Missing: visibleWidth
```

bedeutet das, dass Ihre Binary veraltet ist, der Rust-Exportname (oder expliziter Alias, wenn verwendet) nicht mit dem JS-Namen übereinstimmt, oder der Export nie kompiliert wurde. Beheben Sie den Build und die Namensabweichung, schwächen Sie nicht die Validierung.

### 3) Rust-Signatur-Mismatch

Halten Sie es einfach und owned. `String`, `Vec<String>` und `Uint8Array` funktionieren. Vermeiden Sie Referenzen wie `&str` in öffentlichen Exports. Wenn Sie strukturierte Daten benötigen, umhüllen Sie sie in `#[napi(object)]`-Structs.

### 4) Benchmarking-Fehler

- Vergleichen Sie keine unterschiedlichen Eingaben oder Allokationen.
- Verwenden Sie für JS und native identische Eingabe-Arrays.
- Führen Sie beide in derselben Benchmark-Datei aus, um Verzerrungen zu vermeiden.

## Benchmark-Vorlage

```ts
const ITERATIONS = 2000;

function bench(name: string, fn: () => void): number {
 const start = Bun.nanoseconds();
 for (let i = 0; i < ITERATIONS; i++) fn();
 const elapsed = (Bun.nanoseconds() - start) / 1e6;
 console.log(`${name}: ${elapsed.toFixed(2)}ms total (${(elapsed / ITERATIONS).toFixed(6)}ms/op)`);
 return elapsed;
}

bench("feature/js", () => {
 jsImpl(sample);
});

bench("feature/native", () => {
 nativeImpl(sample);
});
```

## Verifizierungs-Checkliste

- `validateNative` besteht (keine fehlenden Exports).
- `NativeBindings` ist in `packages/natives/src/<module>/types.ts` erweitert und der Wrapper ist in `packages/natives/src/index.ts` re-exportiert.
- `Object.keys(require(...))` enthält Ihren neuen Export.
- Benchmark-Ergebnisse sind im PR/in den Notizen dokumentiert.
- Aufrufstelle **nur dann** aktualisiert, wenn native schneller oder gleichwertig ist.

## Faustregel

- Wenn native langsamer ist, **wechseln Sie nicht**. Behalten Sie den Export für zukünftige Arbeit, aber das TUI sollte auf dem schnelleren Pfad bleiben.
- Wenn native schneller ist, wechseln Sie die Aufrufstelle und behalten Sie den Benchmark bei, um Regressionen zu erkennen.
