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
Es behandelt das Tool-Verhalten, den Kernel-/Gateway-Lebenszyklus, die Umgebungsbehandlung, die Ausführungssemantik, das Ausgabe-Rendering und operative Fehlermodi.

## Umfang und wichtige Dateien

- Tool-Oberfläche: `src/tools/python.ts`
- Sitzungs-/Aufruforchestration des Kernels: `src/ipy/executor.ts`
- Kernel-Protokoll + Gateway-Integration: `src/ipy/kernel.ts`
- Koordinator für das gemeinsam genutzte lokale Gateway: `src/ipy/gateway-coordinator.ts`
- Renderer im interaktiven Modus für benutzerausgelöste Python-Ausführungen: `src/modes/components/python-execution.ts`
- Laufzeit-/Umgebungsfilterung und Python-Auflösung: `src/ipy/runtime.ts`

## Was das Python-Tool ist

Das `python`-Tool führt eine oder mehrere Python-Zellen über einen Jupyter-Kernel-Gateway-gestützten Kernel aus (nicht durch direktes Spawnen von `python -c` pro Zelle).

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

2. **Lokales gemeinsam genutztes Gateway** (Standardpfad)
   - Verwendet einen einzelnen gemeinsam genutzten Prozess, koordiniert unter `~/.xcsh/agent/python-gateway`.
   - Metadaten-Datei: `gateway.json`
   - Sperrdatei: `gateway.lock`
   - Startbefehl:
     - `python -m kernel_gateway`
     - gebunden an `127.0.0.1:<zugewiesener-port>`
     - Startup-Gesundheitsprüfung: `GET /api/kernelspecs`

### Koordination des lokalen gemeinsam genutzten Gateways

`acquireSharedGateway()`:

- Erwirbt eine Dateisperre (`gateway.lock`) mit Heartbeat.
- Verwendet `gateway.json` wieder, wenn die PID aktiv ist und die Gesundheitsprüfung besteht.
- Bereinigt veraltete Informationen/PIDs bei Bedarf.
- Startet ein neues Gateway, wenn kein funktionsfähiges vorhanden ist.

`releaseSharedGateway()` ist derzeit ein No-Op (Kernel-Shutdown baut das gemeinsam genutzte Gateway nicht ab).

`shutdownSharedGateway()` beendet explizit den gemeinsam genutzten Prozess und löscht die Gateway-Metadaten.

### Wichtige Einschränkung

`python.sharedGateway=false` wird beim Kernel-Start abgelehnt:

- Fehler: `Shared Python gateway required; local gateways are disabled`
- Es gibt keinen prozesseigenen, nicht-gemeinsam genutzten lokalen Gateway-Modus.

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
   - Projekt: `<cwd>/.xcsh/modules/*.py` (überschreibt gleichnamige Benutzermodule)

Kernel-Shutdown:

- Löscht den Remote-Kernel über `DELETE /api/kernels/:id`
- Schließt den WebSocket
- Ruft den Release-Hook des gemeinsam genutzten Gateways auf (heute ein No-Op)

## Sitzungspersistenz-Semantik

`python.kernelMode` steuert die Kernel-Wiederverwendung:

- `session` (Standard)
  - Verwendet Kernel-Sitzungen wieder, die nach Sitzungsidentität + cwd geschlüsselt sind.
  - Die Ausführung wird pro Sitzung über eine Warteschlange serialisiert.
  - Inaktive Sitzungen werden nach 5 Minuten entfernt.
  - Maximal 4 Sitzungen; die älteste wird bei Überlauf entfernt.
  - Heartbeat-Prüfungen erkennen abgestürzte Kernel.
  - Automatischer Neustart ist einmal erlaubt; wiederholter Absturz => harter Fehler.

- `per-call`
  - Erstellt einen frischen Kernel für jede Ausführungsanfrage.
  - Fährt den Kernel nach der Anfrage herunter.
  - Keine aufrufübergreifende Zustandspersistenz.

### Multi-Zellen-Verhalten in einem einzelnen Tool-Aufruf

Zellen werden sequenziell in derselben Kernel-Instanz für diesen Tool-Aufruf ausgeführt.

Wenn eine Zwischenzelle fehlschlägt:

- Der Zustand früherer Zellen bleibt im Speicher.
- Das Tool gibt einen gezielten Fehler zurück, der angibt, welche Zelle fehlgeschlagen ist.
- Spätere Zellen werden nicht ausgeführt.

`reset=true` gilt nur für die erste Zellenausführung in diesem Aufruf.

## Umgebungsfilterung und Laufzeitauflösung

Die Umgebung wird gefiltert, bevor Gateway/Kernel-Laufzeit gestartet wird:

- Die Zulassungsliste umfasst Kernvariablen wie `PATH`, `HOME`, Locale-Variablen, `VIRTUAL_ENV`, `PYTHONPATH` usw.
- Zugelassene Präfixe: `LC_`, `XDG_`, `PI_`
- Die Sperrliste entfernt gängige API-Schlüssel (OpenAI/Anthropic/Gemini/usw.)

Reihenfolge der Laufzeitauswahl:

1. Aktive/gefundene venv (`VIRTUAL_ENV`, dann `<cwd>/.venv`, `<cwd>/venv`)
2. Verwaltete venv unter `~/.xcsh/python-env`
3. `python` oder `python3` im PATH

Wenn eine venv ausgewählt wird, wird deren bin/Scripts-Pfad dem `PATH` vorangestellt.

Die Kernel-Umgebungsinitialisierung innerhalb von Python führt außerdem aus:

- `os.chdir(cwd)`
- Injiziert die bereitgestellte Umgebungsvariablen-Map in `os.environ`
- Stellt sicher, dass cwd in `sys.path` enthalten ist

## Tool-Verfügbarkeit und Modusauswahl

`python.toolMode` (Standard `both`) + optionale `PI_PY`-Überschreibung steuern die Bereitstellung:

- `ipy-only`
- `bash-only`
- `both`

Akzeptierte `PI_PY`-Werte:

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

Wenn die Python-Vorprüfung fehlschlägt, fällt die Tool-Erstellung für diese Sitzung auf bash-only zurück.

## Ausführungsablauf und Abbruch/Timeout

### Timeout auf Tool-Ebene

Das Timeout des `python`-Tools wird in Sekunden angegeben, Standard 30, begrenzt auf `1..600`.

Das Tool kombiniert:

- Abbruchsignal des Aufrufers
- Timeout-Abbruchsignal

mit `AbortSignal.any(...)`.

### Kernel-Ausführungsabbruch

Bei Abbruch/Timeout:

- Die Ausführung wird als abgebrochen markiert.
- Ein Kernel-Interrupt wird über REST (`POST /interrupt`) und `interrupt_request` auf dem Kontrollkanal versucht.
- Das Ergebnis enthält `cancelled=true`.
- Der Timeout-Pfad annotiert die Ausgabe als `Command timed out after <n> seconds`.

### stdin-Verhalten

Interaktive stdin-Eingabe wird nicht unterstützt.

Wenn der Kernel ein `input_request` sendet:

- Das Tool vermerkt `stdinRequested=true`
- Gibt erklärenden Text aus
- Sendet eine leere `input_reply`
- Die Ausführung wird auf Executor-Ebene als Fehler behandelt

## Ausgabeerfassung und Rendering

### Erfasste Ausgabeklassen

Aus Kernel-Nachrichten:

- `stream` -> Klartext-Chunks
- `display_data`/`execute_result` -> Rich-Display-Behandlung
- `error` -> Traceback-Text
- Benutzerdefinierter MIME-Typ `application/x-xcsh-status` -> strukturierte Statusereignisse

Display-MIME-Rangfolge:

1. `text/markdown`
2. `text/plain`
3. `text/html` (in einfaches Markdown konvertiert)

Zusätzlich als strukturierte Ausgaben erfasst:

- `application/json` -> JSON-Baumdaten
- `image/png` -> Bild-Payloads
- `application/x-xcsh-status` -> Statusereignisse

### Speicherung und Kürzung

Die Ausgabe wird durch `OutputSink` gestreamt und kann im Artefaktspeicher persistiert werden.

Tool-Ergebnisse können Kürzungsmetadaten und `artifact://<id>` zur vollständigen Ausgabewiederherstellung enthalten.

### Renderer-Verhalten

- Tool-Renderer (`python.ts`):
  - zeigt Code-Zellen-Blöcke mit zellenweisem Status
  - eingeklappte Vorschau standardmäßig 10 Zeilen
  - unterstützt erweiterten Modus für vollständige Ausgabe und detailliertere Statusinformationen
- Interaktiver Renderer (`python-execution.ts`):
  - wird für benutzerausgelöste Python-Ausführung im TUI verwendet
  - eingeklappte Vorschau standardmäßig 20 Zeilen
  - begrenzt sehr lange einzelne Zeilen auf 4000 Zeichen zur Anzeigesicherheit
  - zeigt Abbruch-/Fehler-/Kürzungshinweise an

## Unterstützung für externes Gateway

Setzen Sie:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# Optional:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

Verhaltensunterschiede zum lokalen gemeinsam genutzten Gateway:

- Keine lokalen Gateway-Sperr-/Informationsdateien
- Kein lokales Prozess-Spawning/-Beendigung
- Gesundheitsprüfungen und Kernel-CRUD laufen gegen den externen Endpunkt
- Authentifizierungsfehler werden mit expliziter Token-Anleitung angezeigt

## Operative Fehlerbehebung (aktuelle Fehlermodi)

- **Python-Tool nicht verfügbar**
  - Prüfen Sie `python.toolMode` / `PI_PY`.
  - Wenn die Vorprüfung fehlschlägt, fällt die Laufzeit auf bash-only zurück.

- **Kernel-Verfügbarkeitsfehler**
  - Der lokale Modus erfordert, dass sowohl `kernel_gateway` als auch `ipykernel` in der aufgelösten Python-Laufzeit importierbar sind.
  - Installation mit:

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` verursacht Startfehler**
  - Dies ist bei der aktuellen Implementierung erwartetes Verhalten.

- **Authentifizierungs-/Erreichbarkeitsfehler beim externen Gateway**
  - 401/403 -> setzen Sie `PI_PYTHON_GATEWAY_TOKEN`.
  - Timeout/nicht erreichbar -> überprüfen Sie URL/Netzwerk und Gateway-Gesundheit.

- **Ausführung hängt und läuft dann in ein Timeout**
  - Erhöhen Sie das Tool-`timeout` (maximal 600s), wenn die Arbeitslast legitim ist.
  - Bei hängendem Code löst der Abbruch einen Kernel-Interrupt aus, aber der Benutzercode muss möglicherweise dennoch überarbeitet werden.

- **stdin/input-Eingabeaufforderungen im Python-Code**
  - `input()` wird in diesem Laufzeitpfad nicht interaktiv unterstützt; übergeben Sie Daten programmatisch.

- **Ressourcenerschöpfung (`EMFILE` / zu viele offene Dateien)**
  - Der Sitzungsmanager löst eine Wiederherstellung des gemeinsam genutzten Gateways aus (Sitzungsabbau + Neustart des gemeinsam genutzten Gateways).

- **Arbeitsverzeichnisfehler**
  - Das Tool validiert vor der Ausführung, dass `cwd` existiert und ein Verzeichnis ist.

## Relevante Umgebungsvariablen

- `PI_PY` — Tool-Bereitstellungsüberschreibung (Zuordnung `bash-only`/`ipy-only`/`both` wie oben beschrieben)
- `PI_PYTHON_GATEWAY_URL` — externes Gateway verwenden
- `PI_PYTHON_GATEWAY_TOKEN` — optionales Authentifizierungstoken für externes Gateway
- `PI_PYTHON_SKIP_CHECK=1` — Python-Vorprüfung/Warm-Checks umgehen
- `PI_PYTHON_IPC_TRACE=1` — Kernel-IPC-Sende-/Empfangs-Traces protokollieren
- `PI_DEBUG_STARTUP=1` — Debug-Marker für Startvorgänge ausgeben
