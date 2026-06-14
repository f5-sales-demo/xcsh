---
title: Python-Werkzeug und IPython-Laufzeitumgebung
description: >-
  Python REPL-Werkzeug-Laufzeitumgebung mit IPython-Kernel-Verwaltung,
  Ausführung und Ausgabeerfassung.
sidebar:
  order: 3
  label: Python & IPython
i18n:
  sourceHash: 70f0a034ecef
  translator: machine
---

# Python-Werkzeug und IPython-Laufzeitumgebung

Dieses Dokument beschreibt den aktuellen Python-Ausführungsstapel in `packages/coding-agent`.
Es behandelt das Werkzeugverhalten, den Kernel-/Gateway-Lebenszyklus, die Umgebungsverarbeitung, die Ausführungssemantik, die Ausgabedarstellung und betriebliche Fehlermodi.

## Umfang und wichtige Dateien

- Werkzeugoberfläche: `src/tools/python.ts`
- Sitzungs-/aufrufbezogene Kernel-Orchestrierung: `src/ipy/executor.ts`
- Kernel-Protokoll und Gateway-Integration: `src/ipy/kernel.ts`
- Gemeinsamer lokaler Gateway-Koordinator: `src/ipy/gateway-coordinator.ts`
- Interaktiver Renderer für benutzerseitig ausgelöste Python-Ausführungen: `src/modes/components/python-execution.ts`
- Laufzeit-/Umgebungsfilterung und Python-Auflösung: `src/ipy/runtime.ts`

## Was das Python-Werkzeug ist

Das `python`-Werkzeug führt eine oder mehrere Python-Zellen über einen durch ein Jupyter-Kernel-Gateway gestützten Kernel aus (nicht durch direktes Erzeugen von `python -c` pro Zelle).

Werkzeugparameter:

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // Sekunden, begrenzt auf 1..600, Standard 30
  cwd?: string;
  reset?: boolean; // Kernel nur vor der ersten Zelle zurücksetzen
}
```

Das Werkzeug hat `concurrency = "exclusive"` für eine Sitzung, sodass sich Aufrufe nicht überschneiden.

## Gateway-Lebenszyklus

### Modi

Es gibt zwei Gateway-Pfade:

1. **Externer Gateway** (`PI_PYTHON_GATEWAY_URL` gesetzt)
   - Verwendet die konfigurierte URL direkt.
   - Optionale Authentifizierung mit `PI_PYTHON_GATEWAY_TOKEN`.
   - Es wird kein lokaler Gateway-Prozess erzeugt oder verwaltet.

2. **Lokaler gemeinsamer Gateway** (Standardpfad)
   - Verwendet einen einzelnen gemeinsamen Prozess, der unter `~/.xcsh/agent/python-gateway` koordiniert wird.
   - Metadatendatei: `gateway.json`
   - Sperrdatei: `gateway.lock`
   - Startbefehl:
     - `python -m kernel_gateway`
     - gebunden an `127.0.0.1:<allocated-port>`
     - Startintegritätsprüfung: `GET /api/kernelspecs`

### Koordination des lokalen gemeinsamen Gateways

`acquireSharedGateway()`:

- Setzt eine Dateisperre (`gateway.lock`) mit Heartbeat.
- Verwendet `gateway.json` wieder, wenn die PID aktiv ist und die Integritätsprüfung besteht.
- Bereinigt veraltete Informationen/PIDs bei Bedarf.
- Startet einen neuen Gateway, wenn kein fehlerfreier vorhanden ist.

`releaseSharedGateway()` ist derzeit ein No-op (das Herunterfahren des Kernels trennt den gemeinsamen Gateway nicht).

`shutdownSharedGateway()` beendet den gemeinsamen Prozess explizit und löscht die Gateway-Metadaten.

### Wichtige Einschränkung

`python.sharedGateway=false` wird beim Kernel-Start abgelehnt:

- Fehler: `Shared Python gateway required; local gateways are disabled`
- Es gibt keinen prozessspezifischen, nicht gemeinsam genutzten lokalen Gateway-Modus.

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
  - Verwendet Kernel-Sitzungen wieder, die nach Sitzungsidentität und cwd unterschieden werden.
  - Die Ausführung wird pro Sitzung über eine Warteschlange serialisiert.
  - Inaktive Sitzungen werden nach 5 Minuten entfernt.
  - Maximal 4 Sitzungen; die älteste wird bei Überschreitung entfernt.
  - Heartbeat-Prüfungen erkennen tote Kernel.
  - Automatischer Neustart einmalig erlaubt; wiederholter Absturz => harter Fehler.

- `per-call`
  - Erstellt für jede Ausführungsanforderung einen neuen Kernel.
  - Fährt den Kernel nach der Anforderung herunter.
  - Keine aufrufübergreifende Zustandspersistenz.

### Mehrzelliges Verhalten in einem einzelnen Werkzeugaufruf

Zellen werden sequenziell in derselben Kernel-Instanz für diesen Werkzeugaufruf ausgeführt.

Wenn eine Zwischenzelle fehlschlägt:

- Der Zustand früherer Zellen verbleibt im Arbeitsspeicher.
- Das Werkzeug gibt einen gezielten Fehler zurück, der angibt, welche Zelle fehlgeschlagen ist.
- Spätere Zellen werden nicht ausgeführt.

`reset=true` gilt nur für die erste Zellenausführung in diesem Aufruf.

## Umgebungsfilterung und Laufzeitauflösung

Die Umgebung wird vor dem Start des Gateway-/Kernel-Laufzeit gefiltert:

- Die Erlaubnisliste enthält Kernvariablen wie `PATH`, `HOME`, Locale-Variablen, `VIRTUAL_ENV`, `PYTHONPATH` usw.
- Erlaubte Präfixe: `LC_`, `XDG_`, `PI_`
- Die Sperrliste entfernt gängige API-Schlüssel (OpenAI/Anthropic/Gemini/etc.)

Reihenfolge der Laufzeitauswahl:

1. Aktive/gefundene venv (`VIRTUAL_ENV`, dann `<cwd>/.venv`, `<cwd>/venv`)
2. Verwaltete venv unter `~/.xcsh/python-env`
3. `python` oder `python3` im PATH

Wenn eine venv ausgewählt wird, wird ihr bin/Scripts-Pfad dem `PATH` vorangestellt.

Die Kernel-Umgebungsinitialisierung in Python führt zusätzlich aus:

- `os.chdir(cwd)`
- Injiziert die bereitgestellte Umgebungszuweisung in `os.environ`
- Stellt sicher, dass cwd in `sys.path` enthalten ist

## Werkzeugverfügbarkeit und Modusauswahl

`python.toolMode` (Standard `both`) + optionale `PI_PY`-Überschreibung steuert die Sichtbarkeit:

- `ipy-only`
- `bash-only`
- `both`

Akzeptierte Werte für `PI_PY`:

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

Wenn die Python-Vorprüfung fehlschlägt, wird die Werkzeugerstellung für diese Sitzung auf bash-only zurückgesetzt.

## Ausführungsablauf und Abbruch/Zeitüberschreitung

### Zeitüberschreitung auf Werkzeugebene

Die Zeitüberschreitung des `python`-Werkzeugs ist in Sekunden angegeben, Standard 30, begrenzt auf `1..600`.

Das Werkzeug kombiniert:

- das Abbruchsignal des Aufrufers
- das Abbruchsignal bei Zeitüberschreitung

mit `AbortSignal.any(...)`.

### Abbruch der Kernel-Ausführung

Bei Abbruch/Zeitüberschreitung:

- Die Ausführung wird als abgebrochen markiert.
- Ein Kernel-Interrupt wird über REST (`POST /interrupt`) und den Steuerkanal `interrupt_request` versucht.
- Das Ergebnis enthält `cancelled=true`.
- Der Zeitüberschreitungspfad versieht die Ausgabe mit `Command timed out after <n> seconds`.

### stdin-Verhalten

Interaktives stdin wird nicht unterstützt.

Wenn der Kernel `input_request` ausgibt:

- Das Werkzeug zeichnet `stdinRequested=true` auf
- Gibt einen erklärenden Text aus
- Sendet eine leere `input_reply`
- Die Ausführung wird auf Executor-Ebene als Fehler behandelt

## Ausgabeerfassung und -darstellung

### Erfasste Ausgabeklassen

Aus Kernel-Nachrichten:

- `stream` -> Nur-Text-Blöcke
- `display_data`/`execute_result` -> Behandlung von Rich-Display
- `error` -> Traceback-Text
- benutzerdefiniertes MIME `application/x-xcsh-status` -> strukturierte Statusereignisse

Rangfolge der Display-MIME-Typen:

1. `text/markdown`
2. `text/plain`
3. `text/html` (wird in einfaches Markdown konvertiert)

Zusätzlich als strukturierte Ausgaben erfasst:

- `application/json` -> JSON-Baumdaten
- `image/png` -> Bild-Nutzdaten
- `application/x-xcsh-status` -> Statusereignisse

### Speicherung und Kürzung

Die Ausgabe wird über `OutputSink` gestreamt und kann im Artefaktspeicher persistiert werden.

Werkzeugergebnisse können Kürzungsmetadaten und `artifact://<id>` zur vollständigen Ausgabewiederherstellung enthalten.

### Renderer-Verhalten

- Werkzeug-Renderer (`python.ts`):
  - Zeigt Code-Zellblöcke mit zellenspezifischem Status
  - Zusammengeklappte Vorschau zeigt standardmäßig 10 Zeilen
  - Unterstützt erweiterter Modus für vollständige Ausgabe und reichhaltigere Statusdetails
- Interaktiver Renderer (`python-execution.ts`):
  - Wird für benutzerseitig ausgelöste Python-Ausführung in der TUI verwendet
  - Zusammengeklappte Vorschau zeigt standardmäßig 20 Zeilen
  - Begrenzt sehr lange Einzelzeilen auf 4000 Zeichen zur sicheren Darstellung
  - Zeigt Hinweise zu Abbruch/Fehler/Kürzung

## Unterstützung für externen Gateway

Setzen:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# Optional:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

Verhaltensunterschiede gegenüber dem lokalen gemeinsamen Gateway:

- Keine lokalen Gateway-Sperr-/Infodateien
- Kein lokales Prozesserzeugen/-beenden
- Integritätsprüfungen und Kernel-CRUD werden gegen den externen Endpunkt ausgeführt
- Authentifizierungsfehler werden mit expliziten Token-Hinweisen angezeigt

## Betriebliche Fehlerbehebung (aktuelle Fehlermodi)

- **Python-Werkzeug nicht verfügbar**
  - `python.toolMode` / `PI_PY` prüfen.
  - Wenn die Vorprüfung fehlschlägt, fällt die Laufzeit auf bash-only zurück.

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
  - Zeitüberschreitung/nicht erreichbar -> URL/Netzwerk und Gateway-Zustand prüfen.

- **Ausführung hängt und läuft dann in Zeitüberschreitung**
  - `timeout` des Werkzeugs erhöhen (max. 600 s), wenn die Arbeitslast berechtigt ist.
  - Bei hängendem Code löst der Abbruch einen Kernel-Interrupt aus, aber der Benutzercode muss möglicherweise dennoch überarbeitet werden.

- **stdin/Eingabeaufforderungen in Python-Code**
  - `input()` wird in diesem Laufzeitpfad nicht interaktiv unterstützt; Daten programmatisch übergeben.

- **Ressourcenerschöpfung (`EMFILE` / zu viele offene Dateien)**
  - Der Sitzungs-Manager löst eine Wiederherstellung des gemeinsamen Gateways aus (Sitzungsabbau + Neustart des gemeinsamen Gateways).

- **Fehler im Arbeitsverzeichnis**
  - Das Werkzeug prüft vor der Ausführung, ob `cwd` vorhanden und ein Verzeichnis ist.

## Relevante Umgebungsvariablen

- `PI_PY` — Überschreibung der Werkzeugsichtbarkeit (Zuordnung `bash-only`/`ipy-only`/`both` wie oben)
- `PI_PYTHON_GATEWAY_URL` — externen Gateway verwenden
- `PI_PYTHON_GATEWAY_TOKEN` — optionales Authentifizierungstoken für externen Gateway
- `PI_PYTHON_SKIP_CHECK=1` — Python-Vorprüfung/Vorabprüfungen umgehen
- `PI_PYTHON_IPC_TRACE=1` — Kernel-IPC-Sende-/Empfangsspuren protokollieren
- `PI_DEBUG_STARTUP=1` — Debug-Markierungen für Startphasen ausgeben
