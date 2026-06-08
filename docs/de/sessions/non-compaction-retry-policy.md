---
title: Non-Compaction Auto-Retry Policy
description: >-
  Auto-Retry-Richtlinie für transiente API-Fehler außerhalb des
  Compaction-Pfads.
sidebar:
  order: 6
  label: Retry-Richtlinie
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# Non-Compaction Auto-Retry-Richtlinie

Dieses Dokument beschreibt den standardmäßigen API-Fehler-Retry-Pfad in `AgentSession`.

Es schließt ausdrücklich die Kontext-Überlauf-Wiederherstellung durch Auto-Compaction aus. Überlauf wird durch die Compaction-Logik behandelt und ist separat in [`compaction.md`](./compaction.md) dokumentiert.

## Implementierungsdateien

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## Abgrenzung zwischen Retry und Compaction

Retry und Compaction werden vom selben `agent_end`-Pfad aus geprüft, sind aber bewusst getrennt:

1. `agent_end` untersucht die letzte Assistenten-Nachricht.
2. `#isRetryableError(...)` wird zuerst ausgeführt.
3. Wenn ein Retry eingeleitet wird, werden Compaction-Prüfungen für diesen Durchlauf übersprungen.
4. Kontext-Überlauf-Fehler werden explizit von der Retry-Klassifizierung ausgeschlossen (`isContextOverflow(...)` bricht den Retry-Pfad frühzeitig ab).
5. Überlauf fällt daher zu `#checkCompaction(...)` durch, anstatt den Standard-Retry-Pfad zu durchlaufen.

Zusammengefasst: Überlastungs-/Rate-Limit-/Server-/Netzwerk-Fehler verwenden diese Retry-Richtlinie; Kontext-Fenster-Überlauf nutzt die Compaction-Wiederherstellung.

## Retry-Klassifizierung

`#isRetryableError(...)` erfordert alle folgenden Bedingungen:

- Assistenten-`stopReason === "error"`
- `errorMessage` ist vorhanden
- Die Nachricht ist **kein** Kontext-Überlauf
- `errorMessage` passt auf `#isRetryableErrorMessage(...)`

Aktuell als wiederholbar klassifizierte Muster (regex-basiert):

- overloaded
- rate limit / usage limit / too many requests
- HTTP-ähnliche Server-Klassen: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- `retry delay`-Formulierungen

Dies ist eine auf Zeichenkettenmustern basierende Klassifizierung, keine typisierten Provider-Fehlercodes.

## Retry-Lebenszyklus und Zustandsübergänge

Von Retry verwendeter Session-Zustand:

- `#retryAttempt: number` (`0` bedeutet inaktiv)
- `#retryPromise: Promise<void> | undefined` (verfolgt den laufenden Retry-Lebenszyklus)
- `#retryResolve: (() => void) | undefined` (löst `#retryPromise` auf)
- `#retryAbortController: AbortController | undefined` (bricht den Backoff-Sleep ab)

Ablauf (`#handleRetryableError`):

1. `retry`-Einstellungsgruppe lesen.
2. Wenn `retry.enabled === false`, sofort stoppen (`false`, kein Retry gestartet).
3. `#retryAttempt` inkrementieren.
4. `#retryPromise` einmalig erstellen (erster Versuch in einer Kette).
5. Wenn der Versuch `retry.maxRetries` überschritten hat, finales Fehler-Event aussenden und stoppen.
6. Verzögerung berechnen: `retry.baseDelayMs * 2^(attempt-1)`.
7. Bei Usage-Limit-Fehlern Retry-Hinweise parsen und Auth-Storage aufrufen (`markUsageLimitReached(...)`); wenn Provider-/Modell-Wechsel erfolgreich ist, Verzögerung auf `0` setzen.
8. `auto_retry_start` aussenden.
9. Die letzte fehlerhafte Assistenten-Nachricht aus dem Laufzeit-Zustand des Agenten entfernen (bleibt in der persistierten Session-Historie erhalten).
10. Sleep mit Abbruch-Unterstützung.
11. Nach dem Aufwachen `agent.continue()` via `setTimeout(..., 0)` planen.

### Was die Retry-Zähler zurücksetzt

`#retryAttempt` wird in folgenden Fällen auf `0` zurückgesetzt:

- Erste erfolgreiche, nicht-fehlerhafte, nicht-abgebrochene Assistenten-Nachricht nachdem Retries gestartet wurden (sendet `auto_retry_end { success: true }`)
- Retry-Abbruch während des Backoff-Sleeps
- Pfad bei Überschreitung der maximalen Versuche

`#retryPromise` wird aufgelöst/bereinigt wenn die Retry-Kette endet (Erfolg, Abbruch oder Maximum überschritten), via `#resolveRetry()`.

## Backoff- und Maximalversuch-Semantik

Einstellungen:

- `retry.enabled` (Standard `true`)
- `retry.maxRetries` (Standard `3`)
- `retry.baseDelayMs` (Standard `2000`)

Versuchsnummerierung:

- Der Versuchszähler wird vor der Maximum-Prüfung inkrementiert
- Start-Events verwenden den aktuellen Versuch (1-basiert)
- Das Maximum-überschritten-End-Event meldet `attempt: this.#retryAttempt - 1` (Anzahl der zuletzt durchgeführten Retries)

Backoff-Sequenz mit Standardeinstellungen:

- Versuch 1: 2000 ms
- Versuch 2: 4000 ms
- Versuch 3: 8000 ms

Verzögerungs-Override-Eingaben werden nur im Usage-Limit-Behandlungspfad verwendet und nur um die Entscheidung zum Modell-/Konto-Wechsel im Auth-Storage zu beeinflussen. Im normalen Non-Compaction-Retry-Pfad bleibt der Backoff eine lokale exponentielle Verzögerung, es sei denn, der Wechsel ist erfolgreich (`delayMs = 0`).

## Abbruch-Mechanik

### Expliziter Retry-Abbruch

`abortRetry()`:

- Bricht `#retryAbortController` ab (falls vorhanden)
- Löst das Retry-Promise auf (`#resolveRetry()`), damit wartende Aufrufer freigegeben werden

Wenn der Abbruch während des Sleeps erfolgt, sendet der Catch-Pfad:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- Setzt Versuch/Controller zurück

### Interaktion mit globalem Operationsabbruch

`abort()` ruft `abortRetry()` auf, bevor der aktive Agenten-Stream abgebrochen wird. Dies stellt sicher, dass der Retry-Backoff abgebrochen wird, wenn der Benutzer einen allgemeinen Abbruch auslöst.

### TUI-Interaktion

Bei `auto_retry_start` führt der EventController Folgendes aus:

- Wechselt den `Esc`-Handler zu `session.abortRetry()`
- Rendert Ladetext: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

Bei `auto_retry_end` wird der vorherige `Esc`-Handler wiederhergestellt und der Ladezustand bereinigt.

## Streaming- und Prompt-Abschlussverhalten

`prompt()` wartet letztlich auf `#waitForRetry()` nachdem `agent.prompt(...)` zurückkehrt.

Auswirkung:

- Ein Prompt-Aufruf wird nicht vollständig aufgelöst, bis eine gestartete Retry-Kette abgeschlossen ist (Erfolg/Fehler/Abbruch)
- Der Retry-Lebenszyklus ist Teil einer logischen Prompt-Ausführungsgrenze

Dies verhindert, dass Aufrufer einen sich im Retry befindlichen Durchlauf vorzeitig als abgeschlossen behandeln.

## Steuerung: Einstellungen und RPC

### Konfigurationsoptionen

Definiert im Einstellungsschema unter der Retry-Gruppe:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

Programmatische Schalter in der Session:

- `setAutoRetryEnabled(enabled)` schreibt `retry.enabled`
- `autoRetryEnabled` liest `retry.enabled`
- `isRetrying` meldet, ob das Retry-Lebenszyklus-Promise aktiv ist

### RPC-Steuerung

RPC-Befehlsoberfläche:

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

Client-Hilfsfunktionen:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

Beide Befehle geben Erfolgsantworten zurück; Retry-Fortschritt/-Fehlerdetails kommen über gestreamte Session-Events, nicht über Befehlsantwort-Payloads.

## Event-Emission und Fehlersichtbarkeit

Retry-Events auf Session-Ebene:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

Weitergabe:

- Ausgesendet über `AgentSession.subscribe(...)`
- An den Extension-Runner als Extension-Events weitergeleitet
- Im RPC-Modus direkt als JSON-Event-Objekte weitergeleitet (`session.subscribe(event => output(event))`)
- In der TUI vom `EventController` für Lade-/Fehler-UI verarbeitet

Anzeige finaler Fehler:

- Bei Maximal-Überschreitung oder Abbruch ist `auto_retry_end.success === false`
- TUI zeigt: `Retry failed after N attempts: <finalError>`
- Extensions/Hooks empfangen `auto_retry_end` mit denselben Feldern
- RPC-Konsumenten empfangen dasselbe Event-Objekt auf dem stdout-Stream

## Permanente Stopp-Bedingungen

Retry stoppt und wird in folgenden Fällen nicht automatisch fortgesetzt:

- `retry.enabled` ist false
- Der Fehler ist nicht retry-klassifiziert
- Der Fehler ist ein Kontext-Überlauf (wird an den Compaction-Pfad delegiert)
- Maximale Retries überschritten
- Benutzer bricht Retry ab (`abort_retry` oder `Esc` während des Retry-Laders)
- Globaler Abbruch (`abort`) bricht zuerst den Retry ab

Eine neue Retry-Kette kann bei einem zukünftigen wiederholbaren Fehler nach dem Zurücksetzen der Zähler erneut gestartet werden.

## Operative Hinweise

- Die Klassifizierung basiert auf Regex-Textabgleich; provider-spezifische strukturierte Fehler werden hier nicht verwendet.
- Retry entfernt den fehlerhaften Assistenten-Fehler aus dem **Laufzeit-Kontext** vor dem erneuten Fortfahren, aber die Session-Historie behält diesen Fehlereintrag weiterhin bei.
- `RpcSessionState` stellt derzeit `autoCompactionEnabled` bereit, aber kein `autoRetryEnabled`-Feld; RPC-Aufrufer müssen ihren eigenen Toggle-Zustand verfolgen oder die Einstellungen über andere APIs abfragen.
