---
title: Non-Compaction Auto-Retry Policy
description: >-
  Auto-Retry-Richtlinie für transiente API-Fehler außerhalb des
  Kompaktierungspfads.
sidebar:
  order: 6
  label: Retry-Richtlinie
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# Non-Compaction Auto-Retry-Richtlinie

Dieses Dokument beschreibt den standardmäßigen API-Fehler-Retry-Pfad in `AgentSession`.

Es schließt ausdrücklich die Kontextüberlauf-Wiederherstellung über Auto-Kompaktierung aus. Überlauf wird durch die Kompaktierungslogik behandelt und ist separat in [`compaction.md`](./compaction.md) dokumentiert.

## Implementierungsdateien

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## Abgrenzung zwischen Retry und Kompaktierung

Retry und Kompaktierung werden vom selben `agent_end`-Pfad aus geprüft, sind aber bewusst getrennt:

1. `agent_end` untersucht die letzte Assistenten-Nachricht.
2. `#isRetryableError(...)` wird zuerst ausgeführt.
3. Wenn ein Retry eingeleitet wird, werden Kompaktierungsprüfungen für diesen Durchgang übersprungen.
4. Kontextüberlauf-Fehler werden explizit von der Retry-Klassifizierung ausgeschlossen (`isContextOverflow(...)` bricht den Retry-Pfad frühzeitig ab).
5. Überlauf fällt daher zu `#checkCompaction(...)` durch, anstatt den Standard-Retry zu durchlaufen.

Zusammengefasst: Überlastungs-/Rate-Limit-/Server-/Netzwerk-artige Fehler verwenden diese Retry-Richtlinie; Kontextfenster-Überlauf verwendet die Kompaktierungs-Wiederherstellung.

## Retry-Klassifizierung

`#isRetryableError(...)` erfordert alle folgenden Bedingungen:

- Assistenten-`stopReason === "error"`
- `errorMessage` existiert
- Nachricht ist **kein** Kontextüberlauf
- `errorMessage` entspricht `#isRetryableErrorMessage(...)`

Aktuelles Set der retry-fähigen Muster (Regex-basiert):

- overloaded
- rate limit / usage limit / too many requests
- HTTP-ähnliche Serverklassen: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- `retry delay`-Formulierungen

Dies ist eine String-Muster-Klassifizierung, keine typisierten Provider-Fehlercodes.

## Retry-Lebenszyklus und Zustandsübergänge

Von Retry verwendeter Session-Zustand:

- `#retryAttempt: number` (`0` bedeutet inaktiv)
- `#retryPromise: Promise<void> | undefined` (verfolgt den laufenden Retry-Lebenszyklus)
- `#retryResolve: (() => void) | undefined` (löst `#retryPromise` auf)
- `#retryAbortController: AbortController | undefined` (bricht den Backoff-Sleep ab)

Ablauf (`#handleRetryableError`):

1. Liest die `retry`-Einstellungsgruppe.
2. Wenn `retry.enabled === false`, wird sofort gestoppt (`false`, kein Retry gestartet).
3. Inkrementiert `#retryAttempt`.
4. Erstellt `#retryPromise` einmalig (erster Versuch in einer Kette).
5. Wenn der Versuch `retry.maxRetries` überschritten hat, wird ein finales Fehlerereignis emittiert und gestoppt.
6. Berechnet Verzögerung: `retry.baseDelayMs * 2^(attempt-1)`.
7. Bei Usage-Limit-Fehlern werden Retry-Hinweise geparst und Auth-Storage aufgerufen (`markUsageLimitReached(...)`); wenn der Provider-/Modellwechsel erfolgreich ist, wird die Verzögerung auf `0` gesetzt.
8. Emittiert `auto_retry_start`.
9. Entfernt die abschließende Assistenten-Fehlernachricht aus dem Agent-Laufzeitzustand (bleibt in der persistierten Session-Historie erhalten).
10. Schläft mit Abbruch-Unterstützung.
11. Beim Aufwachen wird `agent.continue()` über `setTimeout(..., 0)` geplant.

### Was die Retry-Zähler zurücksetzt

`#retryAttempt` wird in diesen Fällen auf `0` zurückgesetzt:

- erste erfolgreiche, nicht-fehlerhafte, nicht-abgebrochene Assistenten-Nachricht, nachdem Retries gestartet wurden (emittiert `auto_retry_end { success: true }`)
- Retry-Abbruch während des Backoff-Sleep
- Pfad bei Überschreitung der maximalen Versuche

`#retryPromise` wird aufgelöst/bereinigt, wenn die Retry-Kette endet (Erfolg, Abbruch oder max-exceeded), über `#resolveRetry()`.

## Backoff- und Maximalversuch-Semantik

Einstellungen:

- `retry.enabled` (Standard `true`)
- `retry.maxRetries` (Standard `3`)
- `retry.baseDelayMs` (Standard `2000`)

Versuchszählung:

- Der Versuchszähler wird vor der Max-Prüfung inkrementiert
- Start-Ereignisse verwenden den aktuellen Versuch (1-basiert)
- Das max-exceeded End-Ereignis meldet `attempt: this.#retryAttempt - 1` (Anzahl der zuletzt versuchten Retries)

Backoff-Sequenz mit Standardeinstellungen:

- Versuch 1: 2000 ms
- Versuch 2: 4000 ms
- Versuch 3: 8000 ms

Verzögerungsüberschreibungs-Eingaben werden nur im Usage-Limit-Behandlungspfad verwendet und nur um die Auth-Storage-Modell-/Kontowechsel-Entscheidung zu beeinflussen. Im Haupt-Non-Compaction-Retry-Pfad bleibt das Backoff eine lokale exponentielle Verzögerung, es sei denn, der Wechsel ist erfolgreich (`delayMs = 0`).

## Abbruch-Mechanismen

### Expliziter Retry-Abbruch

`abortRetry()`:

- Bricht `#retryAbortController` ab (falls vorhanden)
- Löst das Retry-Promise auf (`#resolveRetry()`), sodass Wartende entsperrt werden

Wenn der Abbruch während des Schlafens eintritt, emittiert der Catch-Pfad:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- Setzt Versuch/Controller zurück

### Interaktion mit globalem Abbruch

`abort()` ruft `abortRetry()` auf, bevor der aktive Agent-Stream abgebrochen wird. Dies garantiert, dass das Retry-Backoff abgebrochen wird, wenn der Benutzer einen allgemeinen Abbruch auslöst.

### TUI-Interaktion

Bei `auto_retry_start` macht der EventController Folgendes:

- Wechselt den `Esc`-Handler zu `session.abortRetry()`
- Rendert Ladetext: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

Bei `auto_retry_end` wird der vorherige `Esc`-Handler wiederhergestellt und der Ladezustand bereinigt.

## Streaming- und Prompt-Abschlussverhalten

`prompt()` wartet letztendlich auf `#waitForRetry()`, nachdem `agent.prompt(...)` zurückkehrt.

Auswirkung:

- Ein Prompt-Aufruf wird nicht vollständig aufgelöst, bis eine gestartete Retry-Kette abgeschlossen ist (Erfolg/Fehler/Abbruch)
- Der Retry-Lebenszyklus ist Teil einer logischen Prompt-Ausführungsgrenze

Dies verhindert, dass Aufrufer einen sich im Retry befindlichen Durchgang vorzeitig als abgeschlossen betrachten.

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

Client-Hilfsmethoden:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

Beide Befehle geben Erfolgsantworten zurück; Retry-Fortschritts-/Fehlerdetails kommen über gestreamte Session-Ereignisse, nicht über Befehlsantwort-Payloads.

## Ereignisemission und Fehleranzeige

Session-Level Retry-Ereignisse:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

Weiterleitung:

- Emittiert über `AgentSession.subscribe(...)`
- Weitergeleitet an den Extension-Runner als Extension-Ereignisse
- Im RPC-Modus direkt als JSON-Ereignisobjekte weitergeleitet (`session.subscribe(event => output(event))`)
- Im TUI vom `EventController` für Lade-/Fehler-UI konsumiert

Anzeige von finalen Fehlern:

- Bei max-exceeded oder Abbruch ist `auto_retry_end.success === false`
- TUI zeigt: `Retry failed after N attempts: <finalError>`
- Extensions/Hooks empfangen `auto_retry_end` mit denselben Feldern
- RPC-Konsumenten empfangen dasselbe Ereignisobjekt auf dem stdout-Stream

## Permanente Stoppbedingungen

Retry stoppt und wird nicht automatisch fortgesetzt, wenn eine der folgenden Bedingungen eintritt:

- `retry.enabled` ist false
- Der Fehler ist nicht retry-klassifiziert
- Der Fehler ist ein Kontextüberlauf (an den Kompaktierungspfad delegiert)
- Maximale Retries überschritten
- Benutzer bricht Retry ab (`abort_retry` oder `Esc` während des Retry-Laders)
- Globaler Abbruch (`abort`) bricht zuerst den Retry ab

Eine neue Retry-Kette kann später bei einem zukünftigen retry-fähigen Fehler nach dem Zurücksetzen der Zähler erneut gestartet werden.

## Betriebliche Hinweise

- Die Klassifizierung basiert auf Regex-Textabgleich; provider-spezifische strukturierte Fehler werden hier nicht verwendet.
- Retry entfernt den fehlgeschlagenen Assistenten-Fehler aus dem **Laufzeitkontext** vor dem erneuten Fortfahren, aber die Session-Historie behält diesen Fehlereintrag weiterhin bei.
- `RpcSessionState` stellt derzeit `autoCompactionEnabled` bereit, aber kein `autoRetryEnabled`-Feld; RPC-Aufrufer müssen ihren eigenen Toggle-Zustand verfolgen oder Einstellungen über andere APIs abfragen.
