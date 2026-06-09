---
title: Python-Tool und IPython-Laufzeitumgebung
description: >-
  Python-REPL-Tool-Laufzeitumgebung mit IPython-Kernel-Verwaltung, -Ausführung
  und -Ausgabeerfassung.
sidebar:
  order: 3
  label: Python & IPython
i18n:
  sourceHash: 70f0a034ecef
  translator: machine
---

# Python-Tool und IPython-Laufzeitumgebung

Dieses Dokument beschreibt den aktuellen Python-Ausführungsstack in `packages/coding-agent`.
Es behandelt das Tool-Verhalten, den Kernel-/Gateway-Lebenszyklus, die Umgebungsbehandlung, Ausführungssemantik, Ausgabe-Rendering und betriebliche Fehlermodi.

## Geltungsbereich und Schlüsseldateien

- Tool-Oberfläche: `src/tools/python.ts`
- Sitzungs-/Pro-Aufruf-Kernel-Orchestrierung: `src/ipy/executor.ts`
- Kernel-Protokoll + Gateway-Integration: `src/ipy/kernel.ts`
- Gemeinsamer lokaler Gateway-Koordinator: `src/ipy/gateway-coordinator.ts`
- Interaktiver Renderer für benutzerseitig ausgelöste Python-Ausführungen: `src/modes/components/python-execution.ts`
- Laufzeit-/Umgebungsfilterung und Python-Auflösung: `src/ipy/runtime.ts`

## Was das Python-Tool ist

Das `python`-Tool führt eine oder mehrere Python-Zellen über einen Jupyter-Kernel-Gateway-gestützten Kernel aus (nicht durch direktes Aufrufen von `python -c` pro Zelle).

Tool-Parameter:

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // Sekunden, begrenzt auf 1..600, Standard 30
  cwd?: string;
  reset?: boolean; // Kernel nur vor der ersten Zelle zurücksetzen
}
```

Das Tool hat `concurrency = "exclusive"` pro Sitzung, sodass sich Aufrufe nicht überlappen.

## Gateway-Lebenszyklus

### Modi

Es gibt zwei Gateway-Pfade:

1. **Externes Gateway** (`PI_PYTHON_GATEWAY_URL` gesetzt)
   - Verwendet die konfigurierte URL direkt.
   - Optionale Authentifizierung mit `PI_PYTHON_GATEWAY_TOKEN`.
   - Es wird kein lokaler Gateway-Prozess gestartet oder verwaltet.

2. **Lokales gemeinsames Gateway** (Standardpfad)
   - Verwendet einen einzelnen gemeinsamen Prozess, koordiniert unter `~/.xcsh/agent/python-gateway`.
   - Metadaten-Datei: `gateway.json`
   - Lock-Datei: `gateway.lock`
   - Startbefehl:
     - `python -m kernel_gateway`
     - gebunden an `127.0.0.1:<zugewiesener-Port>`
     - Start-Gesundheitsprüfung: `GET /api/kernelspecs`

### Koordination des lokalen gemeinsamen Gateways

`acquireSharedGateway()`:

- Erwirbt eine Dateisperre (`gateway.lock`) mit Heartbeat.
- Verwendet `gateway.json` wieder, wenn die PID aktiv ist und die Gesundheitsprüfung besteht.
- Bereinigt veraltete Informationen/PIDs bei Bedarf.
- Startet ein neues Gateway, wenn kein funktionsfähiges vorhanden ist.

`releaseSharedGateway()` ist derzeit ein No-Op (das Herunterfahren des Kernels beendet nicht das gemeinsame Gateway).

`shutdownSharedGateway()` beendet explizit den gemeinsamen Prozess und löscht die Gateway-Metadaten.

### Wichtige Einschränkung

`python.sharedGateway=false` wird beim Kernel-Start abgelehnt:

- Fehler: `Shared Python gateway required; local gateways are disabled`
- Es gibt keinen prozesseigenen, nicht gemeinsam genutzten lokalen Gateway-Modus.

## Kernel-Lebenszyklus

Jede Ausführung verwendet einen Kernel, der über `POST /api/kernels` auf dem ausgewählten Gateway erstellt wird.

Kernel-Startsequenz:

1. Verfügbarkeitsprüfung (`checkPythonKernelAvailability`)
2. Kernel erstellen (`/api/kernels`)
3. WebSocket öffnen (`/api/kernels/:id/channels`)
4. Kernel-Umgebung initialisieren (`cwd`, Umgebungsvariablen, `sys.path`)
5. `PYTHON_PRELUDE` ausführen
6. Erweiterungsmodule laden von:
   - Benutzer: `~/.xcsh/agent/modules/*.py`
   - Projekt: `<cwd>/.xcsh/modules/*.py` (überschreibt gleichnamiges Benutzermodul)

Kernel-Herunterfahren:

- Löscht den Remote-Kernel über `DELETE /api/kernels/:id`
- Schließt WebSocket
- Ruft den Release-Hook des gemeinsamen Gateways auf (heute ein No-Op)

## Sitzungspersistenz-Semantik

`python.kernelMode` steuert die Kernel-Wiederverwendung:

- `session` (Standard)
  - Verwendet Kernel-Sitzungen wieder, identifiziert durch Sitzungsidentität + cwd.
  - Die Ausführung wird pro Sitzung über eine Warteschlange serialisiert.
  - Inaktive Sitzungen werden nach 5 Minuten entfernt.
  - Maximal 4 Sitzungen; die älteste wird bei Überlauf entfernt.
  - Heartbeat-Prüfungen erkennen tote Kernel.
  - Automatischer Neustart ist einmal erlaubt; wiederholter Absturz => harter Fehler.

- `per-call`
  - Erstellt einen neuen Kernel für jede Ausführungsanfrage.
  - Fährt den Kernel nach der Anfrage herunter.
  - Keine aufrufübergreifende Zustandspersistenz.

### Mehrzellen-Verhalten in einem einzelnen Tool-Aufruf

Zellen werden sequenziell in derselben Kernel-Instanz für diesen Tool-Aufruf ausgeführt.

Wenn eine Zwischenzelle fehlschlägt:

- Der Zustand früherer Zellen bleibt im Speicher.
- Das Tool gibt einen gezielten Fehler zurück, der angibt, welche Zelle fehlgeschlagen ist.
- Spätere Zellen werden nicht ausgeführt.

`reset=true` gilt nur für die erste Zellenausführung in diesem Aufruf.

## Umgebungsfilterung und Laufzeitauflösung

Die Umgebung wird vor dem Starten der Gateway-/Kernel-Laufzeit gefiltert:

- Die Allowlist enthält Kernvariablen wie `PATH`, `HOME`, Locale-Variablen, `VIRTUAL_ENV`, `PYTHONPATH` usw.
- Erlaubte Präfixe: `LC_`, `XDG_`, `PI_`
- Die Denylist entfernt gängige API-Schlüssel (OpenAI/Anthropic/Gemini/usw.)

Reihenfolge der Laufzeitauswahl:

1. Aktives/gefundenes venv (`VIRTUAL_ENV`, dann `<cwd>/.venv`, `<cwd>/venv`)
2. Verwaltetes venv unter `~/.xcsh/python-env`
3. `python` oder `python3` im PATH

Wenn ein venv ausgewählt wird, wird dessen bin/Scripts-Pfad dem `PATH` vorangestellt.

Die Kernel-Umgebungsinitialisierung innerhalb von Python führt außerdem:

- `os.chdir(cwd)` aus
- Injiziert die bereitgestellte Umgebungskarte in `os.environ`
- Stellt sicher, dass cwd in `sys.path` enthalten ist

## Tool-Verfügbarkeit und Modusauswahl

`python.toolMode` (Standard `both`) + optionale `PI_PY`-Überschreibung steuert die Sichtbarkeit:

- `ipy-only`
- `bash-only`
- `both`

Akzeptierte `PI_PY`-Werte:

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

Wenn die Python-Vorabprüfung fehlschlägt, wird die Tool-Erstellung für diese Sitzung auf bash-only herabgestuft.

## Ausführungsablauf und Abbruch/Timeout

### Tool-Level-Timeout

Das `python`-Tool-Timeout ist in Sekunden, Standard 30, begrenzt auf `1..600`.

Das Tool kombiniert:

- Aufrufer-Abbruchsignal
- Timeout-Abbruchsignal

mit `AbortSignal.any(...)`.

### Kernel-Ausführungsabbruch

Bei Abbruch/Timeout:

- Die Ausführung wird als abgebrochen markiert.
- Ein Kernel-Interrupt wird über REST (`POST /interrupt`) und den Control-Channel `interrupt_request` versucht.
- Das Ergebnis enthält `cancelled=true`.
- Der Timeout-Pfad versieht die Ausgabe mit dem Hinweis `Command timed out after <n> seconds`.

### stdin-Verhalten

Interaktives stdin wird nicht unterstützt.

Wenn der Kernel einen `input_request` sendet:

- Das Tool zeichnet `stdinRequested=true` auf
- Gibt erklärenden Text aus
- Sendet eine leere `input_reply`
- Die Ausführung wird auf Executor-Ebene als Fehler behandelt

## Ausgabeerfassung und Rendering

### Erfasste Ausgabeklassen

Aus Kernel-Nachrichten:

- `stream` -> reine Textblöcke
- `display_data`/`execute_result` -> Rich-Display-Behandlung
- `error` -> Traceback-Text
- Benutzerdefinierter MIME-Typ `application/x-xcsh-status` -> strukturierte Statusereignisse

Display-MIME-Prioritätsreihenfolge:

1. `text/markdown`
2. `text/plain`
3. `text/html` (wird in einfaches Markdown konvertiert)

Zusätzlich als strukturierte Ausgaben erfasst:

- `application/json` -> JSON-Baumdaten
- `image/png` -> Bild-Payloads
- `application/x-xcsh-status` -> Statusereignisse

### Speicherung und Kürzung

Die Ausgabe wird über `OutputSink` gestreamt und kann im Artefaktspeicher persistiert werden.

Tool-Ergebnisse können Kürzungsmetadaten und `artifact://<id>` zur vollständigen Ausgabewiederherstellung enthalten.

### Renderer-Verhalten

- Tool-Renderer (`python.ts`):
  - zeigt Code-Zellenblöcke mit Pro-Zellen-Status
  - eingeklappte Vorschau zeigt standardmäßig 10 Zeilen
  - unterstützt erweiterten Modus für vollständige Ausgabe und detailliertere Statusanzeige
- Interaktiver Renderer (`python-execution.ts`):
  - wird für benutzerseitig ausgelöste Python-Ausführung im TUI verwendet
  - eingeklappte Vorschau zeigt standardmäßig 20 Zeilen
  - begrenzt sehr lange einzelne Zeilen auf 4000 Zeichen zur Anzeigesicherheit
  - zeigt Abbruch-/Fehler-/Kürzungshinweise an

## Unterstützung für externes Gateway

Setzen Sie:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# Optional:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

Verhaltensunterschiede zum lokalen gemeinsamen Gateway:

- Keine lokalen Gateway-Lock-/Info-Dateien
- Kein lokaler Prozessstart/-beendigung
- Gesundheitsprüfungen und Kernel-CRUD laufen gegen den externen Endpunkt
- Authentifizierungsfehler werden mit explizitem Token-Hinweis angezeigt

## Betriebliche Fehlerbehebung (aktuelle Fehlermodi)

- **Python-Tool nicht verfügbar**
  - Prüfen Sie `python.toolMode` / `PI_PY`.
  - Wenn die Vorabprüfung fehlschlägt, fällt die Laufzeit auf bash-only zurück.

- **Kernel-Verfügbarkeitsfehler**
  - Der lokale Modus erfordert, dass sowohl `kernel_gateway` als auch `ipykernel` in der aufgelösten Python-Laufzeit importierbar sind.
  - Installieren Sie mit:

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` verursacht Startfehler**
  - Dies ist bei der aktuellen Implementierung erwartetes Verhalten.

- **Authentifizierungs-/Erreichbarkeitsfehler beim externen Gateway**
  - 401/403 -> setzen Sie `PI_PYTHON_GATEWAY_TOKEN`.
  - Timeout/nicht erreichbar -> überprüfen Sie URL/Netzwerk und Gateway-Gesundheit.

- **Ausführung hängt und läuft dann in Timeout**
  - Erhöhen Sie das Tool-`timeout` (max. 600s), wenn die Arbeitslast legitim ist.
  - Bei hängendem Code löst der Abbruch einen Kernel-Interrupt aus, aber der Benutzercode muss möglicherweise trotzdem überarbeitet werden.

- **stdin/Eingabeaufforderungen in Python-Code**
  - `input()` wird in diesem Laufzeitpfad nicht interaktiv unterstützt; übergeben Sie Daten programmatisch.

- **Ressourcenerschöpfung (`EMFILE` / zu viele offene Dateien)**
  - Der Sitzungsmanager löst eine Wiederherstellung des gemeinsamen Gateways aus (Sitzungsabbau + Neustart des gemeinsamen Gateways).

- **Arbeitsverzeichnisfehler**
  - Das Tool validiert vor der Ausführung, dass `cwd` existiert und ein Verzeichnis ist.

## Relevante Umgebungsvariablen

- `PI_PY` — Tool-Sichtbarkeits-Überschreibung (Zuordnung `bash-only`/`ipy-only`/`both` wie oben)
- `PI_PYTHON_GATEWAY_URL` — externes Gateway verwenden
- `PI_PYTHON_GATEWAY_TOKEN` — optionaler Authentifizierungstoken für externes Gateway
- `PI_PYTHON_SKIP_CHECK=1` — Python-Vorabprüfung/Warm-Checks überspringen
- `PI_PYTHON_IPC_TRACE=1` — Kernel-IPC-Sende-/Empfangstraces protokollieren
- `PI_DEBUG_STARTUP=1` — Startphasen-Debug-Marker ausgeben
