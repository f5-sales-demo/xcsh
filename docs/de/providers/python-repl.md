---
title: Python-Werkzeug und IPython-Laufzeit
description: >-
  Python-REPL-Werkzeug-Laufzeit mit IPython-Kernel-Verwaltung, Ausführung und
  Ausgabeerfassung.
sidebar:
  order: 3
  label: Python & IPython
i18n:
  sourceHash: 70f0a034ecef
  translator: machine
---

# Python-Werkzeug und IPython-Laufzeit

Dieses Dokument beschreibt den aktuellen Python-Ausführungs-Stack in `packages/coding-agent`.
Es behandelt Werkzeugverhalten, Kernel-/Gateway-Lebenszyklus, Umgebungsbehandlung, Ausführungssemantik, Ausgabedarstellung und betriebliche Fehlermodi.

## Geltungsbereich und wichtige Dateien

- Werkzeugoberfläche: `src/tools/python.ts`
- Sitzungs-/aufrufbezogene Kernel-Orchestrierung: `src/ipy/executor.ts`
- Kernel-Protokoll + Gateway-Integration: `src/ipy/kernel.ts`
- Gemeinsamer lokaler Gateway-Koordinator: `src/ipy/gateway-coordinator.ts`
- Interaktiver Renderer für benutzerausgelöste Python-Ausführungen: `src/modes/components/python-execution.ts`
- Laufzeit-/Umgebungsfilterung und Python-Auflösung: `src/ipy/runtime.ts`

## Was das Python-Werkzeug ist

Das `python`-Werkzeug führt eine oder mehrere Python-Zellen über einen durch Jupyter Kernel Gateway unterstützten Kernel aus (nicht durch direktes Starten von `python -c` pro Zelle).

Werkzeugparameter:

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // Sekunden, begrenzt auf 1..600, Standard 30
  cwd?: string;
  reset?: boolean; // Kernel nur vor der ersten Zelle zurücksetzen
}
```

Das Werkzeug ist `concurrency = "exclusive"` für eine Sitzung, sodass Aufrufe sich nicht überschneiden.

## Gateway-Lebenszyklus

### Modi

Es gibt zwei Gateway-Pfade:

1. **Externer Gateway** (`PI_PYTHON_GATEWAY_URL` gesetzt)
   - Verwendet die konfigurierte URL direkt.
   - Optionale Authentifizierung mit `PI_PYTHON_GATEWAY_TOKEN`.
   - Es wird kein lokaler Gateway-Prozess gestartet oder verwaltet.

2. **Lokaler gemeinsamer Gateway** (Standardpfad)
   - Verwendet einen einzigen gemeinsamen Prozess, koordiniert unter `~/.xcsh/agent/python-gateway`.
   - Metadatendatei: `gateway.json`
   - Sperrdatei: `gateway.lock`
   - Startbefehl:
     - `python -m kernel_gateway`
     - gebunden an `127.0.0.1:<allocated-port>`
     - Systemdiagnose beim Start: `GET /api/kernelspecs`

### Koordination des lokalen gemeinsamen Gateways

`acquireSharedGateway()`:

- Setzt eine Dateisperre (`gateway.lock`) mit Heartbeat.
- Verwendet `gateway.json` erneut, wenn PID aktiv ist und die Systemdiagnose bestanden wird.
- Bereinigt veraltete Informationen/PIDs bei Bedarf.
- Startet einen neuen Gateway, wenn kein funktionsfähiger vorhanden ist.

`releaseSharedGateway()` ist derzeit eine No-Op-Funktion (Kernel-Herunterfahren beendet den gemeinsamen Gateway nicht).

`shutdownSharedGateway()` beendet den gemeinsamen Prozess explizit und löscht die Gateway-Metadaten.

### Wichtige Einschränkung

`python.sharedGateway=false` wird beim Kernel-Start abgelehnt:

- Fehler: `Shared Python gateway required; local gateways are disabled`
- Es gibt keinen prozessbezogenen nicht gemeinsamen lokalen Gateway-Modus.

## Kernel-Lebenszyklus

Jede Ausführung verwendet einen Kernel, der über `POST /api/kernels` am ausgewählten Gateway erstellt wird.

Kernel-Startsequenz:

1. Verfügbarkeitsprüfung (`checkPythonKernelAvailability`)
2. Kernel erstellen (`/api/kernels`)
3. WebSocket öffnen (`/api/kernels/:id/channels`)
4. Kernel-Umgebung initialisieren (`cwd`, Umgebungsvariablen, `sys.path`)
5. `PYTHON_PRELUDE` ausführen
6. Erweiterungsmodule laden aus:
   - Benutzer: `~/.xcsh/agent/modules/*.py`
   - Projekt: `<cwd>/.xcsh/modules/*.py` (überschreibt gleichnamige Benutzermodule)

Kernel-Herunterfahren:

- Löscht den Remote-Kernel über `DELETE /api/kernels/:id`
- Schließt den WebSocket
- Ruft den gemeinsamen Gateway-Freigabe-Hook auf (derzeit No-Op)

## Semantik der Sitzungsbeibehaltung

`python.kernelMode` steuert die Kernel-Wiederverwendung:

- `session` (Standard)
  - Verwendet Kernel-Sitzungen wieder, die nach Sitzungsidentität + cwd verschlüsselt sind.
  - Die Ausführung wird pro Sitzung über eine Warteschlange serialisiert.
  - Inaktive Sitzungen werden nach 5 Minuten entfernt.
  - Maximal 4 Sitzungen; die älteste wird bei Überschreitung entfernt.
  - Heartbeat-Prüfungen erkennen ausgefallene Kernel.
  - Automatischer Neustart einmal erlaubt; wiederholter Absturz => schwerwiegender Fehler.

- `per-call`
  - Erstellt einen neuen Kernel für jede Ausführungsanfrage.
  - Fährt den Kernel nach der Anfrage herunter.
  - Keine aufrufübergreifende Zustandsbeibehaltung.

### Mehrzellenverhalten in einem einzelnen Werkzeugaufruf

Zellen werden sequenziell in derselben Kernel-Instanz für diesen Werkzeugaufruf ausgeführt.

Wenn eine Zwischenzelle fehlschlägt:

- Der Status früherer Zellen verbleibt im Speicher.
- Das Werkzeug gibt einen gezielten Fehler zurück, der angibt, welche Zelle fehlgeschlagen ist.
- Spätere Zellen werden nicht ausgeführt.

`reset=true` gilt nur für die erste Zellenausführung in diesem Aufruf.

## Umgebungsfilterung und Laufzeitauflösung

Die Umgebung wird vor dem Starten der Gateway-/Kernel-Laufzeit gefiltert:

- Die Zulassungsliste enthält Kernvariablen wie `PATH`, `HOME`, Locale-Variablen, `VIRTUAL_ENV`, `PYTHONPATH` usw.
- Zulassungspräfixe: `LC_`, `XDG_`, `PI_`
- Die Sperrliste entfernt gängige API-Schlüssel (OpenAI/Anthropic/Gemini/usw.)

Reihenfolge der Laufzeitauswahl:

1. Aktives/gefundenes venv (`VIRTUAL_ENV`, dann `<cwd>/.venv`, `<cwd>/venv`)
2. Verwaltetes venv unter `~/.xcsh/python-env`
3. `python` oder `python3` im PATH

Wenn ein venv ausgewählt wird, wird sein bin/Scripts-Pfad dem `PATH` vorangestellt.

Die Kernel-Umgebungsinitialisierung in Python:

- `os.chdir(cwd)`
- Fügt die bereitgestellte Umgebungszuordnung in `os.environ` ein
- Stellt sicher, dass cwd in `sys.path` enthalten ist

## Werkzeugverfügbarkeit und Modusauswahl

`python.toolMode` (Standard `both`) + optionale `PI_PY`-Überschreibung steuert die Bereitstellung:

- `ipy-only`
- `bash-only`
- `both`

Akzeptierte `PI_PY`-Werte:

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

Wenn die Python-Vorabprüfung fehlschlägt, wird die Werkzeugerstellung für diese Sitzung auf bash-only herabgestuft.

## Ausführungsablauf und Abbruch/Timeout

### Timeout auf Werkzeugebene

Der `python`-Werkzeug-Timeout ist in Sekunden angegeben, Standard 30, begrenzt auf `1..600`.

Das Werkzeug kombiniert:

- Abbruchsignal des Aufrufers
- Timeout-Abbruchsignal

mit `AbortSignal.any(...)`.

### Abbruch der Kernel-Ausführung

Bei Abbruch/Timeout:

- Die Ausführung wird als abgebrochen markiert.
- Ein Kernel-Interrupt wird über REST (`POST /interrupt`) und den Steuerkanal `interrupt_request` versucht.
- Das Ergebnis enthält `cancelled=true`.
- Der Timeout-Pfad versieht die Ausgabe mit dem Hinweis `Command timed out after <n> seconds`.

### stdin-Verhalten

Interaktives stdin wird nicht unterstützt.

Wenn der Kernel `input_request` ausgibt:

- Das Werkzeug setzt `stdinRequested=true`
- Gibt einen erklärenden Text aus
- Sendet eine leere `input_reply`
- Die Ausführung wird auf Executor-Ebene als Fehler behandelt

## Ausgabeerfassung und -darstellung

### Erfasste Ausgabeklassen

Aus Kernel-Nachrichten:

- `stream` -> einfache Textblöcke
- `display_data`/`execute_result` -> Verarbeitung umfangreicher Anzeigen
- `error` -> Traceback-Text
- benutzerdefinierter MIME-Typ `application/x-xcsh-status` -> strukturierte Statusereignisse

MIME-Vorrangordnung bei der Anzeige:

1. `text/markdown`
2. `text/plain`
3. `text/html` (in einfaches Markdown konvertiert)

Zusätzlich als strukturierte Ausgaben erfasst:

- `application/json` -> JSON-Baumdaten
- `image/png` -> Bild-Nutzdaten
- `application/x-xcsh-status` -> Statusereignisse

### Speicherung und Kürzung

Die Ausgabe wird durch `OutputSink` gestreamt und kann im Artefaktspeicher gespeichert werden.

Werkzeugergebnisse können Kürzungsmetadaten und `artifact://<id>` für die vollständige Ausgabewiederherstellung enthalten.

### Renderer-Verhalten

- Werkzeug-Renderer (`python.ts`):
  - zeigt Code-Zellenblöcke mit zellenspezifischem Status an
  - Vorschau im eingeklappten Zustand zeigt standardmäßig 10 Zeilen
  - unterstützt den erweiterten Modus für vollständige Ausgabe und umfangreichere Statusdetails
- Interaktiver Renderer (`python-execution.ts`):
  - wird für benutzerausgelöste Python-Ausführung in der TUI verwendet
  - Vorschau im eingeklappten Zustand zeigt standardmäßig 20 Zeilen
  - begrenzt sehr lange einzelne Zeilen auf 4000 Zeichen für sichere Anzeige
  - zeigt Abbruch-/Fehler-/Kürzungshinweise an

## Unterstützung externer Gateways

Setzen Sie:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# Optional:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

Verhaltensunterschiede gegenüber dem lokalen gemeinsamen Gateway:

- Keine lokalen Gateway-Sperr-/Informationsdateien
- Kein lokales Prozessstarten/-beenden
- Systemdiagnosen und Kernel-CRUD werden gegen den externen Endpunkt ausgeführt
- Authentifizierungsfehler werden mit explizitem Token-Hinweis angezeigt

## Betriebliche Fehlerbehebung (aktuelle Fehlermodi)

- **Python-Werkzeug nicht verfügbar**
  - Prüfen Sie `python.toolMode` / `PI_PY`.
  - Wenn die Vorabprüfung fehlschlägt, fällt die Laufzeit auf bash-only zurück.

- **Kernel-Verfügbarkeitsfehler**
  - Der lokale Modus erfordert, dass sowohl `kernel_gateway` als auch `ipykernel` in der aufgelösten Python-Laufzeit importierbar sind.
  - Installieren mit:

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` verursacht Startfehler**
  - Dies ist mit der aktuellen Implementierung zu erwarten.

- **Authentifizierungs-/Erreichbarkeitsfehler beim externen Gateway**
  - 401/403 -> `PI_PYTHON_GATEWAY_TOKEN` setzen.
  - Timeout/nicht erreichbar -> URL/Netzwerk und Gateway-Zustand überprüfen.

- **Ausführung hängt und läuft in Timeout**
  - Erhöhen Sie den Werkzeug-`timeout` (max. 600 s), wenn die Arbeitslast legitim ist.
  - Bei hängendem Code löst der Abbruch einen Kernel-Interrupt aus, aber der Benutzercode muss möglicherweise noch refaktoriert werden.

- **stdin/Eingabeaufforderungen in Python-Code**
  - `input()` wird in diesem Laufzeitpfad nicht interaktiv unterstützt; übergeben Sie Daten programmatisch.

- **Ressourcenerschöpfung (`EMFILE` / zu viele offene Dateien)**
  - Der Sitzungsmanager löst eine Wiederherstellung des gemeinsamen Gateways aus (Sitzungsabbau + Neustart des gemeinsamen Gateways).

- **Fehler beim Arbeitsverzeichnis**
  - Das Werkzeug prüft vor der Ausführung, ob `cwd` vorhanden und ein Verzeichnis ist.

## Relevante Umgebungsvariablen

- `PI_PY` — Überschreibung der Werkzeugbereitstellung (Zuordnung `bash-only`/`ipy-only`/`both` wie oben)
- `PI_PYTHON_GATEWAY_URL` — externen Gateway verwenden
- `PI_PYTHON_GATEWAY_TOKEN` — optionales Authentifizierungstoken für externen Gateway
- `PI_PYTHON_SKIP_CHECK=1` — Python-Vorab-/Warmprüfungen umgehen
- `PI_PYTHON_IPC_TRACE=1` — Kernel-IPC-Sende-/Empfangsspuren protokollieren
- `PI_DEBUG_STARTUP=1` — Debug-Markierungen für Startphasen ausgeben
