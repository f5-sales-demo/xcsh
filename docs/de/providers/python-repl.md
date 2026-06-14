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
Es behandelt das Werkzeugverhalten, den Kernel-/Gateway-Lebenszyklus, die Umgebungsbehandlung, die Ausführungssemantik, die Ausgabedarstellung und operative Fehlermodi.

## Umfang und wichtige Dateien

- Werkzeugoberfläche: `src/tools/python.ts`
- Sitzungs-/pro-Aufruf-Kernel-Orchestrierung: `src/ipy/executor.ts`
- Kernel-Protokoll + Gateway-Integration: `src/ipy/kernel.ts`
- Gemeinsamer lokaler Gateway-Koordinator: `src/ipy/gateway-coordinator.ts`
- Interaktiver-Modus-Renderer für benutzerausgelöste Python-Ausführungen: `src/modes/components/python-execution.ts`
- Laufzeit-/Umgebungsfilterung und Python-Auflösung: `src/ipy/runtime.ts`

## Was das Python-Werkzeug ist

Das `python`-Werkzeug führt eine oder mehrere Python-Zellen über einen durch Jupyter Kernel Gateway gesicherten Kernel aus (nicht durch direktes Erzeugen von `python -c` pro Zelle).

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
   - Es wird kein lokaler Gateway-Prozess erzeugt oder verwaltet.

2. **Lokal gemeinsamer Gateway** (Standardpfad)
   - Verwendet einen einzigen gemeinsamen Prozess, der unter `~/.xcsh/agent/python-gateway` koordiniert wird.
   - Metadatendatei: `gateway.json`
   - Sperrdatei: `gateway.lock`
   - Start-Befehl:
     - `python -m kernel_gateway`
     - gebunden an `127.0.0.1:<allocated-port>`
     - Startintegritätsprüfung: `GET /api/kernelspecs`

### Koordination des lokal gemeinsamen Gateways

`acquireSharedGateway()`:

- Nimmt eine Dateisperre (`gateway.lock`) mit Heartbeat entgegen.
- Verwendet `gateway.json` wieder, wenn die PID aktiv ist und die Integritätsprüfung bestanden wird.
- Bereinigt veraltete Informationen/PIDs bei Bedarf.
- Startet einen neuen Gateway, wenn kein funktionsfähiger vorhanden ist.

`releaseSharedGateway()` ist derzeit ein No-op (das Herunterfahren des Kernels beendet den gemeinsamen Gateway nicht).

`shutdownSharedGateway()` beendet den gemeinsamen Prozess explizit und löscht die Gateway-Metadaten.

### Wichtige Einschränkung

`python.sharedGateway=false` wird beim Kernel-Start abgelehnt:

- Fehler: `Shared Python gateway required; local gateways are disabled`
- Es gibt keinen prozessgebundenen nicht-gemeinsamen lokalen Gateway-Modus.

## Kernel-Lebenszyklus

Jede Ausführung verwendet einen Kernel, der über `POST /api/kernels` auf dem ausgewählten Gateway erstellt wird.

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
- Ruft den gemeinsamen Gateway-Release-Hook auf (derzeit No-op)

## Sitzungspersistenzsemantik

`python.kernelMode` steuert die Kernel-Wiederverwendung:

- `session` (Standard)
  - Verwendet Kernel-Sitzungen wieder, die nach Sitzungsidentität + cwd verschlüsselt sind.
  - Die Ausführung wird pro Sitzung über eine Warteschlange serialisiert.
  - Inaktive Sitzungen werden nach 5 Minuten entfernt.
  - Maximal 4 Sitzungen; die älteste wird bei Überlauf entfernt.
  - Heartbeat-Prüfungen erkennen tote Kernel.
  - Automatischer Neustart einmal erlaubt; wiederholter Absturz => schwerer Fehler.

- `per-call`
  - Erstellt einen neuen Kernel für jede Ausführungsanforderung.
  - Fährt den Kernel nach der Anforderung herunter.
  - Keine sitzungsübergreifende Zustandspersistenz.

### Mehrzelliges Verhalten in einem einzigen Werkzeugaufruf

Zellen werden sequentiell in derselben Kernel-Instanz für diesen Werkzeugaufruf ausgeführt.

Wenn eine zwischenliegende Zelle fehlschlägt:

- Der Zustand früherer Zellen bleibt im Speicher.
- Das Werkzeug gibt einen gezielten Fehler zurück, der angibt, welche Zelle fehlgeschlagen ist.
- Spätere Zellen werden nicht ausgeführt.

`reset=true` gilt nur für die erste Zellenausführung in diesem Aufruf.

## Umgebungsfilterung und Laufzeitauflösung

Die Umgebung wird vor dem Starten der Gateway-/Kernel-Laufzeit gefiltert:

- Die Zulassungsliste enthält Kernvariablen wie `PATH`, `HOME`, Locale-Variablen, `VIRTUAL_ENV`, `PYTHONPATH` usw.
- Zulässige Präfixe: `LC_`, `XDG_`, `PI_`
- Die Sperrliste entfernt gängige API-Schlüssel (OpenAI/Anthropic/Gemini/usw.)

Reihenfolge der Laufzeitauswahl:

1. Aktive/gefundene virtuelle Umgebung (`VIRTUAL_ENV`, dann `<cwd>/.venv`, `<cwd>/venv`)
2. Verwaltete virtuelle Umgebung unter `~/.xcsh/python-env`
3. `python` oder `python3` im PATH

Wenn eine virtuelle Umgebung ausgewählt wird, wird ihr bin/Scripts-Pfad dem `PATH` vorangestellt.

Die Kernel-Umgebungsinitialisierung in Python führt zusätzlich aus:

- `os.chdir(cwd)`
- Injiziert die bereitgestellte Umgebungszuordnung in `os.environ`
- Stellt sicher, dass cwd in `sys.path` enthalten ist

## Werkzeugverfügbarkeit und Modusauswahl

`python.toolMode` (Standard `both`) + optionale `PI_PY`-Überschreibung steuert die Verfügbarkeit:

- `ipy-only`
- `bash-only`
- `both`

Akzeptierte `PI_PY`-Werte:

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

Wenn die Python-Vorabprüfung fehlschlägt, wird die Werkzeugerstellung für diese Sitzung auf bash-only zurückgestuft.

## Ausführungsfluss und Abbruch/Timeout

### Timeout auf Werkzeugebene

Das `python`-Werkzeug-Timeout ist in Sekunden angegeben, Standard 30, begrenzt auf `1..600`.

Das Werkzeug kombiniert:

- Abbruchsignal des Aufrufers
- Timeout-Abbruchsignal

mit `AbortSignal.any(...)`.

### Abbruch der Kernel-Ausführung

Bei Abbruch/Timeout:

- Die Ausführung wird als abgebrochen markiert.
- Ein Kernel-Interrupt wird über REST (`POST /interrupt`) und den Steuerkanal `interrupt_request` versucht.
- Das Ergebnis enthält `cancelled=true`.
- Der Timeout-Pfad kommentiert die Ausgabe als `Command timed out after <n> seconds` an.

### stdin-Verhalten

Interaktives stdin wird nicht unterstützt.

Wenn der Kernel `input_request` ausgibt:

- Das Werkzeug zeichnet `stdinRequested=true` auf
- Gibt erläuternden Text aus
- Sendet eine leere `input_reply`
- Die Ausführung wird auf Executor-Ebene als Fehler behandelt

## Ausgabeerfassung und -darstellung

### Erfasste Ausgabeklassen

Aus Kernel-Nachrichten:

- `stream` -> Nur-Text-Blöcke
- `display_data`/`execute_result` -> Rich-Display-Verarbeitung
- `error` -> Traceback-Text
- Benutzerdefiniertes MIME `application/x-xcsh-status` -> strukturierte Statusereignisse

MIME-Priorität für die Anzeige:

1. `text/markdown`
2. `text/plain`
3. `text/html` (in einfaches Markdown konvertiert)

Zusätzlich als strukturierte Ausgaben erfasst:

- `application/json` -> JSON-Baumdaten
- `image/png` -> Bild-Payloads
- `application/x-xcsh-status` -> Statusereignisse

### Speicherung und Kürzung

Die Ausgabe wird über `OutputSink` gestreamt und kann im Artefaktspeicher gespeichert werden.

Werkzeugergebnisse können Kürzungsmetadaten und `artifact://<id>` für die vollständige Ausgabewiederherstellung enthalten.

### Renderer-Verhalten

- Werkzeug-Renderer (`python.ts`):
  - Zeigt Code-Zellenblöcke mit zellenbezogenem Status an
  - Eingeklappte Vorschau zeigt standardmäßig 10 Zeilen
  - Unterstützt erweiterten Modus für vollständige Ausgabe und reichhaltigere Statusdetails
- Interaktiver Renderer (`python-execution.ts`):
  - Wird für benutzerausgelöste Python-Ausführung in der TUI verwendet
  - Eingeklappte Vorschau zeigt standardmäßig 20 Zeilen
  - Begrenzt sehr lange einzelne Zeilen auf 4000 Zeichen für Anzeigesicherheit
  - Zeigt Abbruch-/Fehler-/Kürzungshinweise an

## Unterstützung externer Gateways

Setzen:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# Optional:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

Verhaltensunterschiede gegenüber dem lokal gemeinsamen Gateway:

- Keine lokalen Gateway-Sperr-/Infodateien
- Kein lokales Prozesserzeugen/-beenden
- Integritätsprüfungen und Kernel-CRUD werden gegen den externen Endpunkt ausgeführt
- Authentifizierungsfehler werden mit expliziten Token-Hinweisen angezeigt

## Operative Fehlerbehebung (aktuelle Fehlermodi)

- **Python-Werkzeug nicht verfügbar**
  - `python.toolMode` / `PI_PY` prüfen.
  - Wenn die Vorabprüfung fehlschlägt, fällt die Laufzeit auf bash-only zurück.

- **Kernel-Verfügbarkeitsfehler**
  - Der lokale Modus erfordert, dass sowohl `kernel_gateway` als auch `ipykernel` in der aufgelösten Python-Laufzeit importierbar sind.
  - Installation mit:

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` verursacht Startfehler**
  - Dies ist mit der aktuellen Implementierung zu erwarten.

- **Authentifizierungs-/Erreichbarkeitsfehler des externen Gateways**
  - 401/403 -> `PI_PYTHON_GATEWAY_TOKEN` setzen.
  - Timeout/nicht erreichbar -> URL/Netzwerk und Gateway-Integrität prüfen.

- **Ausführung hängt und läuft in Timeout**
  - `timeout` des Werkzeugs erhöhen (max. 600s), wenn die Arbeitslast legitim ist.
  - Bei hängendem Code löst der Abbruch einen Kernel-Interrupt aus, aber der Benutzercode muss möglicherweise dennoch überarbeitet werden.

- **stdin/Eingabeaufforderungen in Python-Code**
  - `input()` wird in diesem Laufzeitpfad nicht interaktiv unterstützt; Daten programmatisch übergeben.

- **Ressourcenerschöpfung (`EMFILE` / zu viele offene Dateien)**
  - Der Sitzungsmanager löst die gemeinsame Gateway-Wiederherstellung aus (Sitzungsabbau + Neustart des gemeinsamen Gateways).

- **Fehler im Arbeitsverzeichnis**
  - Das Werkzeug überprüft, ob `cwd` vor der Ausführung vorhanden und ein Verzeichnis ist.

## Relevante Umgebungsvariablen

- `PI_PY` — Überschreibung der Werkzeugverfügbarkeit (`bash-only`/`ipy-only`/`both` Zuordnung oben)
- `PI_PYTHON_GATEWAY_URL` — externen Gateway verwenden
- `PI_PYTHON_GATEWAY_TOKEN` — optionales Authentifizierungstoken für externen Gateway
- `PI_PYTHON_SKIP_CHECK=1` — Python-Vorab-/Aufwärmprüfungen umgehen
- `PI_PYTHON_IPC_TRACE=1` — Kernel-IPC-Sende-/Empfangsnachrichten protokollieren
- `PI_DEBUG_STARTUP=1` — Debug-Markierungen der Startphase ausgeben
