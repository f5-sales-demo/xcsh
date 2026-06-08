---
title: Python-Tool und IPython-Laufzeitumgebung
description: >-
  Python-REPL-Tool-Laufzeitumgebung mit IPython-Kernelverwaltung, -Ausführung
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
Es behandelt das Tool-Verhalten, den Kernel/Gateway-Lebenszyklus, die Umgebungsbehandlung, die Ausführungssemantik, das Ausgabe-Rendering und operationale Fehlermodi.

## Geltungsbereich und wichtige Dateien

- Tool-Oberfläche: `src/tools/python.ts`
- Sitzungs-/Einzelaufruf-Kernel-Orchestrierung: `src/ipy/executor.ts`
- Kernel-Protokoll + Gateway-Integration: `src/ipy/kernel.ts`
- Gemeinsamer lokaler Gateway-Koordinator: `src/ipy/gateway-coordinator.ts`
- Interaktiver Renderer für benutzerseitig ausgelöste Python-Ausführungen: `src/modes/components/python-execution.ts`
- Laufzeit-/Umgebungsfilterung und Python-Auflösung: `src/ipy/runtime.ts`

## Was das Python-Tool ist

Das `python`-Tool führt eine oder mehrere Python-Zellen über einen durch Jupyter Kernel Gateway unterstützten Kernel aus (nicht durch direktes Aufrufen von `python -c` pro Zelle).

Tool-Parameter:

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // Sekunden, begrenzt auf 1..600, Standard 30
  cwd?: string;
  reset?: boolean; // Kernel nur vor der ersten Zelle zurücksetzen
}
```

Das Tool ist `concurrency = "exclusive"` für eine Sitzung, sodass sich Aufrufe nicht überlappen.

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

`releaseSharedGateway()` ist derzeit ein No-Op (Kernel-Shutdown beendet das gemeinsame Gateway nicht).

`shutdownSharedGateway()` terminiert den gemeinsamen Prozess explizit und löscht die Gateway-Metadaten.

### Wichtige Einschränkung

`python.sharedGateway=false` wird beim Kernel-Start abgelehnt:

- Fehler: `Shared Python gateway required; local gateways are disabled`
- Es gibt keinen prozesseigenen, nicht gemeinsamen lokalen Gateway-Modus.

## Kernel-Lebenszyklus

Jede Ausführung verwendet einen Kernel, der über `POST /api/kernels` auf dem ausgewählten Gateway erstellt wird.

Kernel-Startsequenz:

1. Verfügbarkeitsprüfung (`checkPythonKernelAvailability`)
2. Kernel erstellen (`/api/kernels`)
3. Websocket öffnen (`/api/kernels/:id/channels`)
4. Kernel-Umgebung initialisieren (`cwd`, Umgebungsvariablen, `sys.path`)
5. `PYTHON_PRELUDE` ausführen
6. Erweiterungsmodule laden aus:
   - Benutzer: `~/.xcsh/agent/modules/*.py`
   - Projekt: `<cwd>/.xcsh/modules/*.py` (überschreibt gleichnamiges Benutzermodul)

Kernel-Shutdown:

- Löscht den Remote-Kernel über `DELETE /api/kernels/:id`
- Schließt den Websocket
- Ruft den Release-Hook des gemeinsamen Gateways auf (derzeit No-Op)

## Sitzungspersistenz-Semantik

`python.kernelMode` steuert die Kernel-Wiederverwendung:

- `session` (Standard)
  - Verwendet Kernel-Sitzungen wieder, die durch Sitzungsidentität + cwd geschlüsselt sind.
  - Die Ausführung wird pro Sitzung über eine Warteschlange serialisiert.
  - Inaktive Sitzungen werden nach 5 Minuten bereinigt.
  - Maximal 4 Sitzungen; die älteste wird bei Überlauf bereinigt.
  - Heartbeat-Prüfungen erkennen tote Kernel.
  - Automatischer Neustart ist einmal erlaubt; wiederholter Absturz => harter Fehler.

- `per-call`
  - Erstellt für jede Ausführungsanfrage einen neuen Kernel.
  - Fährt den Kernel nach der Anfrage herunter.
  - Keine aufrufübergreifende Zustandspersistenz.

### Mehrzellenverhalten in einem einzelnen Tool-Aufruf

Zellen werden sequenziell in derselben Kernel-Instanz für diesen Tool-Aufruf ausgeführt.

Wenn eine Zwischenzelle fehlschlägt:

- Der Zustand früherer Zellen bleibt im Speicher erhalten.
- Das Tool gibt einen gezielten Fehler zurück, der angibt, welche Zelle fehlgeschlagen ist.
- Spätere Zellen werden nicht ausgeführt.

`reset=true` gilt nur für die erste Zellenausführung in diesem Aufruf.

## Umgebungsfilterung und Laufzeitauflösung

Die Umgebung wird vor dem Starten der Gateway-/Kernel-Laufzeitumgebung gefiltert:

- Die Allowlist enthält Kernvariablen wie `PATH`, `HOME`, Locale-Variablen, `VIRTUAL_ENV`, `PYTHONPATH` usw.
- Erlaubte Präfixe: `LC_`, `XDG_`, `PI_`
- Die Denylist entfernt gängige API-Schlüssel (OpenAI/Anthropic/Gemini/usw.)

Reihenfolge der Laufzeitauswahl:

1. Aktive/gefundene venv (`VIRTUAL_ENV`, dann `<cwd>/.venv`, `<cwd>/venv`)
2. Verwaltete venv unter `~/.xcsh/python-env`
3. `python` oder `python3` im PATH

Wenn eine venv ausgewählt wird, wird deren bin/Scripts-Pfad dem `PATH` vorangestellt.

Die Kernel-Umgebungsinitialisierung innerhalb von Python führt außerdem aus:

- `os.chdir(cwd)`
- Injiziert die bereitgestellte Umgebungs-Map in `os.environ`
- Stellt sicher, dass cwd in `sys.path` enthalten ist

## Tool-Verfügbarkeit und Modusauswahl

`python.toolMode` (Standard `both`) + optionale `PI_PY`-Überschreibung steuert die Bereitstellung:

- `ipy-only`
- `bash-only`
- `both`

Akzeptierte `PI_PY`-Werte:

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

Wenn die Python-Vorprüfung fehlschlägt, fällt die Tool-Erstellung für diese Sitzung auf bash-only zurück.

## Ausführungsablauf und Abbruch/Timeout

### Tool-Level-Timeout

Das Timeout des `python`-Tools ist in Sekunden angegeben, Standard 30, begrenzt auf `1..600`.

Das Tool kombiniert:

- Aufrufer-Abort-Signal
- Timeout-Abort-Signal

mit `AbortSignal.any(...)`.

### Kernel-Ausführungsabbruch

Bei Abbruch/Timeout:

- Die Ausführung wird als abgebrochen markiert.
- Ein Kernel-Interrupt wird über REST (`POST /interrupt`) und den Kontrollkanal `interrupt_request` versucht.
- Das Ergebnis enthält `cancelled=true`.
- Der Timeout-Pfad annotiert die Ausgabe als `Command timed out after <n> seconds`.

### stdin-Verhalten

Interaktives stdin wird nicht unterstützt.

Wenn der Kernel `input_request` sendet:

- Das Tool protokolliert `stdinRequested=true`
- Gibt erklärenden Text aus
- Sendet eine leere `input_reply`
- Die Ausführung wird auf Executor-Ebene als Fehler behandelt

## Ausgabeerfassung und Rendering

### Erfasste Ausgabeklassen

Aus Kernel-Nachrichten:

- `stream` -> Klartext-Chunks
- `display_data`/`execute_result` -> Rich-Display-Behandlung
- `error` -> Traceback-Text
- Benutzerdefiniertes MIME `application/x-xcsh-status` -> strukturierte Statusereignisse

Display-MIME-Priorität:

1. `text/markdown`
2. `text/plain`
3. `text/html` (in einfaches Markdown konvertiert)

Zusätzlich als strukturierte Ausgaben erfasst:

- `application/json` -> JSON-Baumdaten
- `image/png` -> Bild-Payloads
- `application/x-xcsh-status` -> Statusereignisse

### Speicherung und Kürzung

Die Ausgabe wird über `OutputSink` gestreamt und kann im Artefaktspeicher persistiert werden.

Tool-Ergebnisse können Kürzungsmetadaten und `artifact://<id>` zur vollständigen Ausgabewiederherstellung enthalten.

### Renderer-Verhalten

- Tool-Renderer (`python.ts`):
  - Zeigt Code-Zellenblöcke mit zellenweisem Status
  - Eingeklappte Vorschau standardmäßig 10 Zeilen
  - Unterstützt erweiterten Modus für vollständige Ausgabe und detailliertere Statusanzeige
- Interaktiver Renderer (`python-execution.ts`):
  - Wird für benutzerseitig ausgelöste Python-Ausführung im TUI verwendet
  - Eingeklappte Vorschau standardmäßig 20 Zeilen
  - Begrenzt sehr lange Einzelzeilen auf 4000 Zeichen für Anzeigesicherheit
  - Zeigt Abbruch-/Fehler-/Kürzungshinweise an

## Unterstützung für externes Gateway

Setzen Sie:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# Optional:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

Verhaltensunterschiede zum lokalen gemeinsamen Gateway:

- Keine lokalen Gateway-Lock-/Info-Dateien
- Kein lokales Prozess-Spawning/-Terminierung
- Gesundheitsprüfungen und Kernel-CRUD laufen gegen den externen Endpunkt
- Authentifizierungsfehler werden mit expliziten Token-Hinweisen angezeigt

## Operative Fehlerbehebung (aktuelle Fehlermodi)

- **Python-Tool nicht verfügbar**
  - Prüfen Sie `python.toolMode` / `PI_PY`.
  - Wenn die Vorprüfung fehlschlägt, fällt die Laufzeitumgebung auf bash-only zurück.

- **Kernel-Verfügbarkeitsfehler**
  - Der lokale Modus erfordert, dass sowohl `kernel_gateway` als auch `ipykernel` in der aufgelösten Python-Laufzeitumgebung importierbar sind.
  - Installation mit:

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` verursacht Startfehler**
  - Dies ist mit der aktuellen Implementierung erwartet.

- **Authentifizierungs-/Erreichbarkeitsfehler beim externen Gateway**
  - 401/403 -> setzen Sie `PI_PYTHON_GATEWAY_TOKEN`.
  - Timeout/nicht erreichbar -> überprüfen Sie URL/Netzwerk und Gateway-Zustand.

- **Ausführung hängt und läuft dann in Timeout**
  - Erhöhen Sie das Tool-`timeout` (max. 600s), wenn die Arbeitslast legitim ist.
  - Bei blockiertem Code löst der Abbruch einen Kernel-Interrupt aus, aber der Benutzercode muss möglicherweise dennoch überarbeitet werden.

- **stdin/Eingabeaufforderungen im Python-Code**
  - `input()` wird in diesem Laufzeitpfad nicht interaktiv unterstützt; übergeben Sie Daten programmatisch.

- **Ressourcenerschöpfung (`EMFILE` / zu viele offene Dateien)**
  - Der Sitzungsmanager löst eine Wiederherstellung des gemeinsamen Gateways aus (Sitzungsabbau + Neustart des gemeinsamen Gateways).

- **Arbeitsverzeichnisfehler**
  - Das Tool überprüft vor der Ausführung, ob `cwd` existiert und ein Verzeichnis ist.

## Relevante Umgebungsvariablen

- `PI_PY` — Überschreibung der Tool-Bereitstellung (Zuordnung `bash-only`/`ipy-only`/`both` wie oben)
- `PI_PYTHON_GATEWAY_URL` — Externes Gateway verwenden
- `PI_PYTHON_GATEWAY_TOKEN` — Optionales Authentifizierungstoken für externes Gateway
- `PI_PYTHON_SKIP_CHECK=1` — Python-Vorprüfung/Warm-Checks überspringen
- `PI_PYTHON_IPC_TRACE=1` — Kernel-IPC-Sende-/Empfangs-Traces protokollieren
- `PI_DEBUG_STARTUP=1` — Debug-Marker für Startstufen ausgeben
