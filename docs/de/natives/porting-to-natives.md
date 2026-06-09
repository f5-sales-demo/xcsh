---
title: Portierung auf pi-natives (N-API) — Feldnotizen
description: >-
  Feldnotizen zur Migration von Node.js child_process und Shell-Code auf die
  Rust N-API Native-Schicht.
sidebar:
  order: 9
  label: Portierung auf pi-natives
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# Portierung auf pi-natives (N-API) — Feldnotizen

Dies ist ein praktischer Leitfaden zum Verschieben von Hot Paths in `crates/pi-natives` und deren Verdrahtung durch die JS-Bindings. Er existiert, um zu vermeiden, dass dieselben Fehler zweimal passieren.

## Wann portieren

Portieren Sie, wenn eine der folgenden Bedingungen zutrifft:

- Der Hot Path läuft in Render-Schleifen, engen UI-Updates oder großen Batches.
- JS-Allokationen dominieren (String-Churn, Regex-Backtracking, große Arrays).
- Sie haben bereits eine JS-Baseline und können beide Versionen nebeneinander benchmarken.
- Die Arbeit ist CPU-gebunden oder blockierendes I/O, das auf dem libuv-Thread-Pool laufen kann.
- Die Arbeit ist asynchrones I/O, das auf Tokios Runtime laufen kann (z.B. Shell-Ausführung).

Vermeiden Sie Portierungen, die von JS-only State oder dynamischen Imports abhängen. N-API-Exports sollten pur sein, Daten-rein/Daten-raus. Langandauernde Arbeit sollte über `task::blocking` (CPU-gebunden/blockierendes I/O) oder `task::future` (asynchrones I/O) mit Cancellation gehen.

## Anatomie eines nativen Exports

**Rust-Seite:**

- Die Implementierung befindet sich in `crates/pi-natives/src/<module>.rs`. Wenn Sie ein neues Modul hinzufügen, registrieren Sie es in `crates/pi-natives/src/lib.rs`.
- Export mit `#[napi]`; snake_case-Exports werden automatisch in camelCase konvertiert. Verwenden Sie explizites `js_name` nur für echte Aliase/nicht-standardmäßige Namen. Verwenden Sie `#[napi(object)]` für Structs.
- Verwenden Sie `task::blocking(tag, cancel_token, work)` (siehe `crates/pi-natives/src/task.rs`) für CPU-gebundene oder blockierende Arbeit. Verwenden Sie `task::future(env, tag, work)` für asynchrone Arbeit, die Tokio benötigt (z.B. Shell-Sessions). Übergeben Sie ein `CancelToken`, wenn Sie `timeoutMs` oder `AbortSignal` exponieren.

**JS-Seite:**

- `packages/natives/src/bindings.ts` enthält das Basis-`NativeBindings`-Interface.
- `packages/natives/src/<module>/types.ts` definiert TS-Typen und erweitert `NativeBindings` via Declaration Merging.
- `packages/natives/src/native.ts` importiert jede `<module>/types.ts`-Datei, um die Deklarationen zu aktivieren.
- `packages/natives/src/<module>/index.ts` wrappet das `native`-Binding aus `packages/natives/src/native.ts`.
- `packages/natives/src/native.ts` lädt das Addon und `validateNative` erzwingt erforderliche Exports.
- `packages/natives/src/index.ts` re-exportiert den Wrapper für Aufrufer in `packages/*`.

## Portierungs-Checkliste

1. **Rust-Implementierung hinzufügen**

- Legen Sie die Kernlogik in eine einfache Rust-Funktion.
- Wenn es ein neues Modul ist, fügen Sie es zu `crates/pi-natives/src/lib.rs` hinzu.
- Exponieren Sie es mit `#[napi]`, damit das Standard-snake_case -> camelCase-Mapping konsistent bleibt.
- Halten Sie Signaturen owned und einfach: `String`, `Vec<String>`, `Uint8Array` oder `Either<JsString, Uint8Array>` für große String-/Byte-Eingaben.
- Für CPU-gebundene oder blockierende Arbeit verwenden Sie `task::blocking`; für asynchrone Arbeit verwenden Sie `task::future`. Übergeben Sie ein `CancelToken` und rufen Sie `heartbeat()` in langen Schleifen auf.

2. **JS-Bindings verdrahten**

- Fügen Sie die Typen und die `NativeBindings`-Erweiterung in `packages/natives/src/<module>/types.ts` hinzu.
- Importieren Sie `./<module>/types` in `packages/natives/src/native.ts`, um Declaration Merging auszulösen.
- Fügen Sie einen Wrapper in `packages/natives/src/<module>/index.ts` hinzu, der `native` aufruft.
- Re-exportieren Sie aus `packages/natives/src/index.ts`.

3. **Native Validierung aktualisieren**

- Fügen Sie `checkFn("newExport")` in `validateNative` (`packages/natives/src/native.ts`) hinzu.

4. **Benchmarks hinzufügen**

- Platzieren Sie Benchmarks neben dem besitzenden Paket (`packages/tui/bench`, `packages/natives/bench` oder `packages/coding-agent/bench`).
- Schließen Sie eine JS-Baseline und die native Version im selben Lauf ein.
- Verwenden Sie `Bun.nanoseconds()` und eine feste Iterationsanzahl.
- Halten Sie die Benchmark-Eingaben klein und realistisch (tatsächliche Daten, die im Hot Path gesehen werden).

5. **Native Binary bauen**

- `bun --cwd=packages/natives run build`
- Verwenden Sie `bun --cwd=packages/natives run build` und setzen Sie `PI_DEV=1`, wenn Sie Loader-Diagnosen beim Testen möchten.

6. **Benchmark ausführen**

- `bun run packages/<pkg>/bench/<bench>.ts` (oder `bun --cwd=packages/natives run bench`)

7. **Über die Verwendung entscheiden**

- Wenn native langsamer ist, **JS beibehalten** und den nativen Export ungenutzt lassen.
- Wenn native schneller ist, Aufrufstellen auf den nativen Wrapper umstellen.

## Schmerzpunkte und wie man sie vermeidet

### 1) Veraltete `pi_natives.node` verhindert neue Exports

Der Loader bevorzugt die plattform-getaggte Binary in `packages/natives/native` (`pi_natives.<platform>-<arch>.node`). `PI_DEV=1` aktiviert jetzt nur Loader-Diagnosen; es wechselt nicht mehr zu einem separaten Dev-Addon-Dateinamen. Es gibt auch ein Fallback `pi_natives.node`. Kompilierte Binaries werden nach `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node` extrahiert. Wenn eine davon veraltet ist, werden Exports nicht aktualisiert.

**Lösung:** Entfernen Sie die veraltete Datei vor dem Neubauen.

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

Wenn Sie eine kompilierte Binary ausführen, löschen Sie das gecachte Addon-Verzeichnis:

```bash
rm -rf ~/.xcsh/natives/<version>
```

Dann verifizieren Sie, dass der Export in der Binary existiert:

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) "Missing exports"-Fehler von `validateNative`

Das ist **gut** — es verhindert stille Mismatches. Wenn Sie dies sehen:

```
Native addon missing exports ... Missing: visibleWidth
```

bedeutet es, dass Ihre Binary veraltet ist, der Rust-Export-Name (oder expliziter Alias wenn verwendet) nicht mit dem JS-Namen übereinstimmt, oder der Export nie kompiliert wurde. Beheben Sie den Build und den Naming-Mismatch, schwächen Sie nicht die Validierung.

### 3) Rust-Signatur-Mismatch

Halten Sie es einfach und owned. `String`, `Vec<String>` und `Uint8Array` funktionieren. Vermeiden Sie Referenzen wie `&str` in öffentlichen Exports. Wenn Sie strukturierte Daten benötigen, wickeln Sie sie in `#[napi(object)]`-Structs.

### 4) Benchmarking-Fehler

- Vergleichen Sie nicht unterschiedliche Eingaben oder Allokationen.
- Halten Sie JS und native bei identischen Eingabe-Arrays.
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
- Benchmark-Zahlen im PR/in den Notizen festgehalten.
- Aufrufstelle **nur dann** aktualisiert, wenn native schneller oder gleich ist.

## Faustregel

- Wenn native langsamer ist, **nicht umstellen**. Behalten Sie den Export für zukünftige Arbeit, aber das TUI sollte auf dem schnelleren Pfad bleiben.
- Wenn native schneller ist, stellen Sie die Aufrufstelle um und behalten Sie den Benchmark, um Regressionen zu erkennen.
