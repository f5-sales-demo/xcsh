---
title: Bash-Tool-Laufzeitumgebung
description: >-
  Bash-Tool-Laufzeitumgebung mit Shell-Prozessverwaltung, Sandboxing, Timeout
  und Ausgabe-Streaming.
sidebar:
  order: 1
  label: Bash-Tool
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# Bash-Tool-Laufzeitumgebung

Dieses Dokument beschreibt den Laufzeitpfad des **`bash`-Tools**, der von Agent-Tool-Aufrufen verwendet wird – von der Befehlsnormalisierung über die Ausführung, Kürzung/Artefakte bis hin zum Rendering.

Es weist auch darauf hin, wo sich das Verhalten im interaktiven TUI, im Print-Modus, im RPC-Modus und bei der benutzerinitierten Bang-(`!`)-Shell-Ausführung unterscheidet.

## Geltungsbereich und Laufzeitoberflächen

Es gibt zwei verschiedene Bash-Ausführungsoberflächen in coding-agent:

1. **Tool-Aufruf-Oberfläche** (`toolName: "bash"`): wird verwendet, wenn das Modell das Bash-Tool aufruft.
   - Einstiegspunkt: `BashTool.execute()`.
2. **Benutzer-Bang-Befehl-Oberfläche** (`!cmd` aus interaktiver Eingabe oder RPC-`bash`-Befehl): Hilfspfad auf Sitzungsebene.
   - Einstiegspunkt: `AgentSession.executeBash()`.

Beide verwenden letztendlich `executeBash()` in `src/exec/bash-executor.ts` für die Nicht-PTY-Ausführung, aber nur der Tool-Aufruf-Pfad führt Normalisierung/Abfangung und Tool-Renderer-Logik aus.

## End-to-End-Tool-Aufruf-Pipeline

## 1) Eingabenormalisierung und Parameter-Zusammenführung

`BashTool.execute()` normalisiert zunächst den Rohbefehl über `normalizeBashCommand()`:

- extrahiert nachgestelltes `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N` in strukturierte Limits,
- entfernt nachgestellte/vorangestellte Leerzeichen,
- behält interne Leerzeichen bei.

Dann werden extrahierte Limits mit expliziten Tool-Argumenten zusammengeführt:

- explizite `head`/`tail`-Argumente überschreiben extrahierte Werte,
- extrahierte Werte dienen nur als Fallback.

### Einschränkung

Kommentare in `bash-normalize.ts` erwähnen das Entfernen von `2>&1`, aber die aktuelle Implementierung entfernt es nicht. Das Laufzeitverhalten ist dennoch korrekt (stdout/stderr werden bereits zusammengeführt), aber das Normalisierungsverhalten ist enger als die Kommentare vermuten lassen.

## 2) Optionale Abfangung (blockierter-Befehl-Pfad)

Wenn `bashInterceptor.enabled` wahr ist, lädt `BashTool` Regeln aus den Einstellungen und führt `checkBashInterception()` gegen den normalisierten Befehl aus.

Abfangverhalten:

- ein Befehl wird **nur** blockiert, wenn:
  - eine Regex-Regel übereinstimmt, und
  - das vorgeschlagene Tool in `ctx.toolNames` vorhanden ist.
- ungültige Regex-Regeln werden stillschweigend übersprungen.
- bei Blockierung wirft `BashTool` einen `ToolError` mit der Nachricht:
  - `Blocked: ...`
  - ursprünglicher Befehl enthalten.

Standard-Regelmuster (im Code definiert) zielen auf häufige Fehlverwendungen ab:

- Dateileser (`cat`, `head`, `tail`, ...)
- Suchwerkzeuge (`grep`, `rg`, ...)
- Dateifinder (`find`, `fd`, ...)
- In-Place-Editoren (`sed -i`, `perl -i`, `awk -i inplace`)
- Shell-Umleitungsschreibvorgänge (`echo ... > file`, Heredoc-Umleitung)

### Einschränkung

`InterceptionResult` enthält `suggestedTool`, aber `BashTool` gibt derzeit nur den Nachrichtentext aus (kein strukturiertes suggested-tool-Feld in `details`).

## 3) CWD-Validierung und Timeout-Begrenzung

`cwd` wird relativ zum Sitzungs-cwd aufgelöst (`resolveToCwd`) und dann über `stat` validiert:

- fehlender Pfad -> `ToolError("Working directory does not exist: ...")`
- kein Verzeichnis -> `ToolError("Working directory is not a directory: ...")`

Das Timeout wird auf `[1, 3600]` Sekunden begrenzt und in Millisekunden umgerechnet.

## 4) Artefakt-Zuweisung

Vor der Ausführung weist das Tool einen Artefaktpfad/-ID (Best-Effort) für die Speicherung gekürzter Ausgaben zu.

- ein Fehler bei der Artefakt-Zuweisung ist nicht fatal (die Ausführung wird ohne Artefakt-Überlaufdatei fortgesetzt),
- Artefakt-ID/-Pfad werden in den Ausführungspfad übergeben, um die vollständige Ausgabe bei Kürzung zu persistieren.

## 5) PTY- vs. Nicht-PTY-Ausführungsauswahl

`BashTool` wählt die PTY-Ausführung nur, wenn alle Bedingungen erfüllt sind:

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- der Tool-Kontext hat eine Benutzeroberfläche (`ctx.hasUI === true` und `ctx.ui` gesetzt)

Andernfalls wird das nicht-interaktive `executeBash()` verwendet.

Das bedeutet, dass der Print-Modus und Nicht-UI-RPC/Tool-Kontexte immer Nicht-PTY verwenden.

## Nicht-interaktive Ausführungs-Engine (`executeBash`)

## Shell-Sitzungs-Wiederverwendungsmodell

`executeBash()` speichert native `Shell`-Instanzen in einer prozessglobalen Map, die nach folgenden Kriterien geschlüsselt ist:

- Shell-Pfad,
- konfiguriertes Befehlspräfix,
- Snapshot-Pfad,
- serialisierte Shell-Umgebung,
- optionaler Agent-Sitzungsschlüssel.

Für Ausführungen auf Sitzungsebene übergibt `AgentSession.executeBash()` `sessionKey: this.sessionId`, wodurch die Wiederverwendung pro Sitzung isoliert wird.

Der Tool-Aufruf-Pfad übergibt **keinen** `sessionKey`, daher basiert der Wiederverwendungsbereich auf Shell-Konfiguration/Snapshot/Umgebung.

## Shell-Konfiguration und Snapshot-Verhalten

Bei jedem Aufruf lädt der Executor die Shell-Konfiguration aus den Einstellungen (`shell`, `env`, optionales `prefix`).

Wenn die ausgewählte Shell `bash` enthält, versucht sie `getOrCreateSnapshot()`:

- Snapshot erfasst Aliases/Funktionen/Optionen aus der Benutzer-RC,
- Snapshot-Erstellung erfolgt nach Best-Effort,
- bei Fehler wird ohne Snapshot fortgefahren.

Wenn `prefix` konfiguriert ist, wird der Befehl zu:

```text
<prefix> <command>
```

## Streaming und Abbruch

`Shell.run()` streamt Chunks an einen Callback. Der Executor leitet jeden Chunk in `OutputSink` und einen optionalen `onChunk`-Callback weiter.

Abbruch:

- ein abgebrochenes Signal löst `shellSession.abort(...)` aus,
- ein Timeout aus dem nativen Ergebnis wird auf `cancelled: true` + Annotationstext abgebildet,
- expliziter Abbruch gibt ebenfalls `cancelled: true` + Annotation zurück.

Es wird keine Ausnahme innerhalb des Executors für Timeout/Abbruch geworfen; er gibt ein strukturiertes `BashResult` zurück und überlässt dem Aufrufer die Fehler-Semantik.

## Interaktiver PTY-Pfad (`runInteractiveBashPty`)

Wenn PTY aktiviert ist, führt das Tool `runInteractiveBashPty()` aus, das eine Overlay-Konsolenkomponente öffnet und eine native `PtySession` steuert.

Verhaltens-Highlights:

- xterm-headless-Virtual-Terminal rendert den Viewport im Overlay,
- Tastatureingaben werden normalisiert (einschließlich Kitty-Sequenzen und Application-Cursor-Mode-Handling),
- `esc` während der Ausführung beendet die PTY-Sitzung,
- Terminal-Größenänderung wird an PTY weitergegeben (`session.resize(cols, rows)`).

Umgebungshärtungs-Standardwerte werden für unbeaufsichtigte Ausführungen injiziert:

- Pager deaktiviert (`PAGER=cat`, `GIT_PAGER=cat`, etc.),
- Editor-Eingabeaufforderungen deaktiviert (`GIT_EDITOR=true`, `EDITOR=true`, ...),
- Terminal-/Authentifizierungs-Eingabeaufforderungen reduziert (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`),
- Paketmanager-/Tool-Automatisierungsflags für nicht-interaktives Verhalten.

PTY-Ausgabe wird normalisiert (`CRLF`/`CR` zu `LF`, `sanitizeText`) und in `OutputSink` geschrieben, einschließlich Artefakt-Überlauf-Unterstützung.

Bei PTY-Start-/Laufzeitfehlern empfängt der Sink eine `PTY error: ...`-Zeile und der Befehl wird mit undefiniertem Exit-Code abgeschlossen.

## Ausgabebehandlung: Streaming, Kürzung, Artefakt-Überlauf

Sowohl PTY- als auch Nicht-PTY-Pfade verwenden `OutputSink`.

## OutputSink-Semantik

- hält einen In-Memory-UTF-8-sicheren Tail-Puffer (`DEFAULT_MAX_BYTES`, derzeit 50KB),
- verfolgt die insgesamt gesehenen Bytes/Zeilen,
- wenn ein Artefaktpfad existiert und die Ausgabe überläuft (oder die Datei bereits aktiv ist), wird der vollständige Stream in die Artefaktdatei geschrieben,
- wenn der Speicherschwellenwert überläuft, wird der In-Memory-Puffer auf den Tail gekürzt (UTF-8-Grenz-sicher),
- markiert `truncated`, wenn Überlauf/Datei-Überlauf auftritt.

`dump()` gibt zurück:

- `output` (möglicherweise annotiertes Präfix),
- `truncated`,
- `totalLines/totalBytes`,
- `outputLines/outputBytes`,
- `artifactId`, wenn eine Artefaktdatei aktiv war.

### Einschränkung bei langen Ausgaben

Die Laufzeitkürzung basiert auf einem Byte-Schwellenwert in `OutputSink` (standardmäßig 50KB). In diesem Codepfad wird kein hartes 2000-Zeilen-Limit erzwungen.

## Live-Tool-Aktualisierungen

Für die Nicht-PTY-Ausführung verwendet `BashTool` einen separaten `TailBuffer` für Teilaktualisierungen und sendet `onUpdate`-Snapshots, während der Befehl ausgeführt wird.

Für die PTY-Ausführung wird das Live-Rendering durch ein benutzerdefiniertes UI-Overlay gehandhabt, nicht durch `onUpdate`-Text-Chunks.

## Ergebnisformung, Metadaten und Fehlerabbildung

Nach der Ausführung:

1. `cancelled`-Behandlung:
   - wenn das Abbruchsignal abgebrochen ist -> `ToolAbortError` werfen (Abbruch-Semantik),
   - sonst -> `ToolError` werfen (wird als Tool-Fehler behandelt).
2. PTY `timedOut` -> `ToolError` werfen.
3. Head/Tail-Filter auf den endgültigen Ausgabetext anwenden (`applyHeadTail`, Head dann Tail).
4. leere Ausgabe wird zu `(no output)`.
5. Kürzungs-Metadaten über `toolResult(...).truncationFromSummary(result, { direction: "tail" })` anhängen.
6. Exit-Code-Abbildung:
   - fehlender Exit-Code -> `ToolError("... missing exit status")`
   - Nicht-Null-Exit -> `ToolError("... Command exited with code N")`
   - Null-Exit -> Erfolgsergebnis.

Struktur der Erfolgs-Nutzlast:

- `content`: Textausgabe,
- `details.meta.truncation` bei Kürzung, einschließlich:
  - `direction`, `truncatedBy`, Gesamt-/Ausgabe-Zeilen+Byte-Zähler,
  - `shownRange`,
  - `artifactId` wenn verfügbar.

Da eingebaute Tools mit `wrapToolWithMetaNotice()` umschlossen sind, wird Kürzungshinweistext automatisch an den endgültigen Textinhalt angehängt (zum Beispiel: `Full: artifact://<id>`).

## Rendering-Pfade

## Tool-Aufruf-Renderer (`bashToolRenderer`)

`bashToolRenderer` wird für Tool-Aufruf-Nachrichten (`toolCall` / `toolResult`) verwendet:

- im eingeklappten Modus wird eine visuell zeilenverkürzte Vorschau angezeigt,
- im ausgeklappten Modus wird der gesamte derzeit verfügbare Ausgabetext angezeigt,
- die Warnzeile enthält den Kürzungsgrund und `artifact://<id>` bei Kürzung,
- der Timeout-Wert (aus den Argumenten) wird in der Fußzeilen-Metadatenzeile angezeigt.

### Einschränkung: Vollständige Artefakt-Erweiterung

`BashRenderContext` hat `isFullOutput`, aber der aktuelle Renderer-Kontext-Builder setzt es nicht für Bash-Tool-Ergebnisse. Die erweiterte Ansicht verwendet weiterhin den bereits im Ergebnisinhalt vorhandenen Text (Tail/gekürzte Ausgabe), es sei denn, ein anderer Aufrufer stellt den vollständigen Artefaktinhalt bereit.

## Benutzer-Bang-Befehl-Komponente (`BashExecutionComponent`)

`BashExecutionComponent` ist für Benutzer-`!`-Befehle im interaktiven Modus (nicht für Modell-Tool-Aufrufe):

- streamt Chunks live,
- die eingeklappte Vorschau behält die letzten 20 logischen Zeilen,
- Zeilenbegrenzung bei 4000 Zeichen pro Zeile,
- zeigt Kürzungs- und Artefaktwarnungen an, wenn Metadaten vorhanden sind,
- markiert Abbruch-/Fehler-/Exit-Status separat.

Diese Komponente wird von `CommandController.handleBashCommand()` verdrahtet und von `AgentSession.executeBash()` gespeist.

## Modusspezifische Verhaltensunterschiede

| Oberfläche                     | Einstiegspfad                                         | PTY-fähig                                                            | Live-Ausgabe-UX                                                             | Fehlerdarstellung                                          |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Interaktiver Tool-Aufruf       | `BashTool.execute`                                    | Ja, wenn `bash.virtualTerminal=on` und UI existiert und `PI_NO_PTY!=1` | PTY-Overlay (interaktiv) oder gestreamte Tail-Aktualisierungen            | Tool-Fehler werden zu `toolResult.isError`                 |
| Print-Modus-Tool-Aufruf        | `BashTool.execute`                                    | Nein (kein UI-Kontext)                                               | Kein TUI-Overlay; Ausgabe erscheint im Event-Stream/finalen Assistenten-Textfluss | Gleiche Tool-Fehlerabbildung                               |
| RPC-Tool-Aufruf (Agent-Tooling)| `BashTool.execute`                                    | Normalerweise kein UI -> Nicht-PTY                                   | Strukturierte Tool-Events/Ergebnisse                                        | Gleiche Tool-Fehlerabbildung                               |
| Interaktiver Bang-Befehl (`!`) | `AgentSession.executeBash` + `BashExecutionComponent` | Nein (verwendet Executor direkt)                                     | Dedizierte Bash-Ausführungskomponente                                       | Controller fängt Ausnahmen ab und zeigt UI-Fehler an       |
| RPC-`bash`-Befehl              | `rpc-mode` -> `session.executeBash`                   | Nein                                                                 | Gibt `BashResult` direkt zurück                                             | Konsument behandelt zurückgegebene Felder                  |

## Betriebliche Einschränkungen

- Der Interceptor blockiert Befehle nur, wenn das vorgeschlagene Tool derzeit im Kontext verfügbar ist.
- Wenn die Artefakt-Zuweisung fehlschlägt, erfolgt die Kürzung trotzdem, aber es ist keine `artifact://`-Rückreferenz verfügbar.
- Der Shell-Sitzungs-Cache hat in diesem Modul keine explizite Bereinigung; die Lebensdauer ist prozessbezogen.
- PTY- und Nicht-PTY-Timeout-Oberflächen unterscheiden sich:
  - PTY stellt ein explizites `timedOut`-Ergebnisfeld bereit,
  - Nicht-PTY bildet Timeout auf `cancelled + Annotation`-Zusammenfassung ab.

## Implementierungsdateien

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — Tool-Einstiegspunkt, Normalisierung/Abfangung, PTY/Nicht-PTY-Auswahl, Ergebnis-/Fehlerabbildung, Bash-Tool-Renderer.
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — Befehlsnormalisierung und Nachausführungs-Head/Tail-Filterung.
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — Interceptor-Regelabgleich und Blockierungsbefehl-Nachrichten.
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — Nicht-PTY-Executor, Shell-Sitzungs-Wiederverwendung, Abbruch-Verdrahtung, Ausgabe-Sink-Integration.
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — PTY-Laufzeit, Overlay-UI, Eingabenormalisierung, nicht-interaktive Umgebungs-Standardwerte.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — `OutputSink`-Kürzung/Artefakt-Überlauf und Zusammenfassungs-Metadaten.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — Artefakt-Zuweisungshelfer und Streaming-Tail-Puffer.
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — Kürzungs-Metadatenstruktur + Hinweis-Injektions-Wrapper.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `executeBash` auf Sitzungsebene, Nachrichtenaufzeichnung, Abbruch-Lebenszyklus.
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — Interaktive `!`-Befehlsausführungskomponente.
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — Verdrahtung für interaktiven `!`-Befehl-UI-Stream/Aktualisierungsabschluss.
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — RPC-`bash`- und `abort_bash`-Befehlsoberfläche.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://<id>`-Auflösung.
