---
title: Nicht-Kompaktierungs-Auto-Wiederholungsrichtlinie
description: >-
  Auto-Wiederholungsrichtlinie für vorübergehende API-Fehler außerhalb des
  Kompaktierungspfads.
sidebar:
  order: 6
  label: Wiederholungsrichtlinie
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# Nicht-Kompaktierungs-Auto-Wiederholungsrichtlinie

Dieses Dokument beschreibt den Standard-API-Fehler-Wiederholungspfad in `AgentSession`.

Es schließt ausdrücklich die Kontextüberlauf-Wiederherstellung via Auto-Kompaktierung aus. Überlauf wird durch die Kompaktierungslogik behandelt und ist separat in [`compaction.md`](./compaction.md) dokumentiert.

## Implementierungsdateien

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## Abgrenzung zwischen Wiederholung und Kompaktierung

Wiederholung und Kompaktierung werden vom selben `agent_end`-Pfad aus geprüft, sind aber bewusst getrennt:

1. `agent_end` inspiziert die letzte Assistenten-Nachricht.
2. `#isRetryableError(...)` wird zuerst ausgeführt.
3. Wenn eine Wiederholung eingeleitet wird, werden Kompaktierungsprüfungen für diesen Durchgang übersprungen.
4. Kontextüberlauf-Fehler werden hart von der Wiederholungsklassifikation ausgeschlossen (`isContextOverflow(...)` bricht die Wiederholung vorzeitig ab).
5. Überlauf fällt daher zu `#checkCompaction(...)` durch, anstatt zur Standard-Wiederholung.

Also: Überlast-/Ratenbegrenzungs-/Server-/Netzwerk-artige Fehler verwenden diese Wiederholungsrichtlinie; Kontextfenster-Überlauf verwendet die Kompaktierungswiederherstellung.

## Wiederholungsklassifikation

`#isRetryableError(...)` erfordert alle folgenden Bedingungen:

- Assistenten-`stopReason === "error"`
- `errorMessage` existiert
- Nachricht ist **kein** Kontextüberlauf
- `errorMessage` stimmt mit `#isRetryableErrorMessage(...)` überein

Aktueller Satz wiederholbarer Muster (Regex-basiert):

- overloaded
- rate limit / usage limit / too many requests
- HTTP-ähnliche Serverklassen: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- `retry delay`-Formulierung

Dies ist eine Zeichenkettenbasierte Musterklassifikation, keine typisierten Provider-Fehlercodes.

## Wiederholungslebenszyklus und Zustandsübergänge

Sitzungszustand, der für die Wiederholung verwendet wird:

- `#retryAttempt: number` (`0` bedeutet inaktiv)
- `#retryPromise: Promise<void> | undefined` (verfolgt den laufenden Wiederholungslebenszyklus)
- `#retryResolve: (() => void) | undefined` (löst `#retryPromise` auf)
- `#retryAbortController: AbortController | undefined` (bricht den Backoff-Sleep ab)

Ablauf (`#handleRetryableError`):

1. Liest die `retry`-Einstellungsgruppe.
2. Wenn `retry.enabled === false`, sofort stoppen (`false`, keine Wiederholung gestartet).
3. `#retryAttempt` inkrementieren.
4. `#retryPromise` einmalig erstellen (erster Versuch in einer Kette).
5. Wenn der Versuch `retry.maxRetries` überschreitet, finales Fehlerereignis emittieren und stoppen.
6. Verzögerung berechnen: `retry.baseDelayMs * 2^(attempt-1)`.
7. Bei Nutzungslimit-Fehlern Wiederholungshinweise parsen und Auth-Speicher aufrufen (`markUsageLimitReached(...)`); wenn Provider-/Modellwechsel erfolgreich ist, Verzögerung auf `0` erzwingen.
8. `auto_retry_start` emittieren.
9. Die abschließende Assistenten-Fehlernachricht aus dem Agenten-Laufzeitzustand entfernen (in der persistierten Sitzungshistorie beibehalten).
10. Sleep mit Abbruchunterstützung.
11. Nach dem Aufwachen `agent.continue()` via `setTimeout(..., 0)` planen.

### Was die Wiederholungszähler zurücksetzt

`#retryAttempt` wird in diesen Fällen auf `0` zurückgesetzt:

- Erste erfolgreiche, nicht-fehlerhafte, nicht-abgebrochene Assistenten-Nachricht nach Beginn der Wiederholungen (emittiert `auto_retry_end { success: true }`)
- Wiederholungsabbruch während des Backoff-Sleeps
- Pfad bei Überschreitung der maximalen Wiederholungen

`#retryPromise` wird aufgelöst/bereinigt, wenn die Wiederholungskette endet (Erfolg, Abbruch oder Maximum überschritten), via `#resolveRetry()`.

## Backoff- und Maximalversuch-Semantik

Einstellungen:

- `retry.enabled` (Standard `true`)
- `retry.maxRetries` (Standard `3`)
- `retry.baseDelayMs` (Standard `2000`)

Versuchsnummerierung:

- Der Versuchszähler wird vor der Maximum-Prüfung inkrementiert
- Startereignisse verwenden den aktuellen Versuch (1-basiert)
- Das Maximum-überschritten-Endereignis meldet `attempt: this.#retryAttempt - 1` (letzte versuchte Wiederholungsanzahl)

Backoff-Sequenz mit Standardeinstellungen:

- Versuch 1: 2000 ms
- Versuch 2: 4000 ms
- Versuch 3: 8000 ms

Verzögerungsüberschreibungs-Eingaben werden nur im Nutzungslimit-Behandlungspfad verwendet, und nur um die Auth-Speicher-Modell-/Kontowechsel-Entscheidung zu beeinflussen. Im Haupt-Nicht-Kompaktierungs-Wiederholungspfad bleibt das Backoff eine lokale exponentielle Verzögerung, es sei denn, der Wechsel ist erfolgreich (`delayMs = 0`).

## Abbruchmechaniken

### Expliziter Wiederholungsabbruch

`abortRetry()`:

- Bricht `#retryAbortController` ab (falls vorhanden)
- Löst das Wiederholungs-Promise auf (`#resolveRetry()`), damit Wartende entsperrt werden

Wenn der Abbruch während des Sleeps erfolgt, emittiert der Catch-Pfad:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- Setzt Versuch/Controller zurück

### Interaktion mit globalem Operationsabbruch

`abort()` ruft `abortRetry()` auf, bevor der aktive Agenten-Stream abgebrochen wird. Dies garantiert, dass das Wiederholungs-Backoff abgebrochen wird, wenn der Benutzer einen allgemeinen Abbruch auslöst.

### TUI-Interaktion

Bei `auto_retry_start` führt der EventController folgendes aus:

- Wechselt den `Esc`-Handler zu `session.abortRetry()`
- Rendert Ladetext: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

Bei `auto_retry_end` wird der vorherige `Esc`-Handler wiederhergestellt und der Ladezustand bereinigt.

## Streaming- und Prompt-Abschlussverhalten

`prompt()` wartet letztendlich auf `#waitForRetry()`, nachdem `agent.prompt(...)` zurückkehrt.

Auswirkung:

- Ein Prompt-Aufruf wird erst vollständig aufgelöst, wenn eine gestartete Wiederholungskette beendet ist (Erfolg/Fehlschlag/Abbruch)
- Der Wiederholungslebenszyklus ist Teil einer logischen Prompt-Ausführungsgrenze

Dies verhindert, dass Aufrufer einen sich wiederholenden Durchgang zu früh als abgeschlossen behandeln.

## Steuerung: Einstellungen und RPC

### Konfigurationsoptionen

Definiert im Einstellungsschema unter der Retry-Gruppe:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

Programmatische Umschalter in der Sitzung:

- `setAutoRetryEnabled(enabled)` schreibt `retry.enabled`
- `autoRetryEnabled` liest `retry.enabled`
- `isRetrying` meldet, ob das Wiederholungslebenszyklus-Promise aktiv ist

### RPC-Steuerung

RPC-Befehlsoberfläche:

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

Client-Hilfsfunktionen:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

Beide Befehle geben Erfolgsantworten zurück; Wiederholungsfortschritts-/Fehlerdetails kommen von gestreamten Sitzungsereignissen, nicht von Befehlsantwort-Payloads.

## Ereignisemission und Fehlerdarstellung

Wiederholungsereignisse auf Sitzungsebene:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

Weiterleitung:

- Emittiert über `AgentSession.subscribe(...)`
- An den Extension-Runner als Extension-Ereignisse weitergeleitet
- Im RPC-Modus direkt als JSON-Ereignisobjekte weitergeleitet (`session.subscribe(event => output(event))`)
- Im TUI vom `EventController` für Lade-/Fehler-UI konsumiert

Darstellung finaler Fehler:

- Bei Überschreitung des Maximums oder Abbruch ist `auto_retry_end.success === false`
- TUI zeigt: `Retry failed after N attempts: <finalError>`
- Extensions/Hooks empfangen `auto_retry_end` mit denselben Feldern
- RPC-Konsumenten empfangen dasselbe Ereignisobjekt auf dem Stdout-Stream

## Dauerhafte Stoppbedingungen

Die Wiederholung stoppt und wird nicht automatisch fortgesetzt, wenn einer dieser Fälle eintritt:

- `retry.enabled` ist false
- Fehler ist nicht wiederholungsklassifiziert
- Fehler ist Kontextüberlauf (an den Kompaktierungspfad delegiert)
- Maximale Wiederholungen überschritten
- Benutzer bricht die Wiederholung ab (`abort_retry` oder `Esc` während des Wiederholungsladers)
- Globaler Abbruch (`abort`) bricht die Wiederholung zuerst ab

Eine neue Wiederholungskette kann später bei einem zukünftigen wiederholbaren Fehler nach Zählerrücksetzung erneut starten.

## Betriebliche Hinweise

- Die Klassifikation erfolgt über Regex-Textabgleich; providerspezifische strukturierte Fehler werden hier nicht verwendet.
- Die Wiederholung entfernt den fehlgeschlagenen Assistenten-Fehler aus dem **Laufzeitkontext** vor dem erneuten Fortfahren, aber die Sitzungshistorie behält diesen Fehlereintrag weiterhin bei.
- `RpcSessionState` stellt derzeit `autoCompactionEnabled` bereit, aber kein `autoRetryEnabled`-Feld; RPC-Aufrufer müssen ihren eigenen Umschaltzustand verfolgen oder Einstellungen über andere APIs abfragen.
