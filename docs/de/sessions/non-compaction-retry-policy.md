---
title: Automatische Wiederholungsrichtlinie (ohne Komprimierung)
description: >-
  Automatische Wiederholungsrichtlinie für vorübergehende API-Fehler außerhalb
  des Komprimierungspfads.
sidebar:
  order: 6
  label: Wiederholungsrichtlinie
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# Automatische Wiederholungsrichtlinie (ohne Komprimierung)

Dieses Dokument beschreibt den standardmäßigen API-Fehler-Wiederholungspfad in `AgentSession`.

Es schließt die Kontext-Überlauf-Wiederherstellung über automatische Komprimierung ausdrücklich aus. Überlauf wird durch Komprimierungslogik behandelt und ist separat in [`compaction.md`](./compaction.md) dokumentiert.

## Implementierungsdateien

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## Abgrenzung gegenüber der Komprimierung

Wiederholung und Komprimierung werden vom gleichen `agent_end`-Pfad aus geprüft, sind jedoch absichtlich getrennt:

1. `agent_end` prüft die letzte Assistentennachricht.
2. `#isRetryableError(...)` wird zuerst ausgeführt.
3. Wird eine Wiederholung eingeleitet, werden Komprimierungsprüfungen für diesen Durchlauf übersprungen.
4. Kontext-Überlauf-Fehler sind von der Wiederholungsklassifizierung hart ausgeschlossen (`isContextOverflow(...)` schließt die Wiederholung kurz).
5. Überlauf fällt daher auf `#checkCompaction(...)` durch, anstatt die Standard-Wiederholung zu verwenden.

Zusammengefasst: Überlastungs-/Rate-/Server-/netzwerkbezogene Fehler verwenden diese Wiederholungsrichtlinie; Kontext-Fenster-Überlauf verwendet die Komprimierungswiederherstellung.

## Wiederholungsklassifizierung

`#isRetryableError(...)` erfordert alle der folgenden Bedingungen:

- Assistent `stopReason === "error"`
- `errorMessage` ist vorhanden
- Nachricht ist **kein** Kontext-Überlauf
- `errorMessage` stimmt mit `#isRetryableErrorMessage(...)` überein

Aktueller Satz von wiederholbaren Mustern (regex-basiert):

- overloaded
- rate limit / usage limit / too many requests
- HTTP-ähnliche Serverklassen: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- `retry delay`-Formulierung

Dies ist eine Zeichenkettenmuster-Klassifizierung, keine typisierten Provider-Fehlercodes.

## Wiederholungslebenszyklus und Zustandsübergänge

Vom Sitzungszustand verwendete Wiederholungsvariablen:

- `#retryAttempt: number` (`0` bedeutet inaktiv)
- `#retryPromise: Promise<void> | undefined` (verfolgt den laufenden Wiederholungslebenszyklus)
- `#retryResolve: (() => void) | undefined` (löst `#retryPromise` auf)
- `#retryAbortController: AbortController | undefined` (bricht den Backoff-Schlaf ab)

Ablauf (`#handleRetryableError`):

1. Einstellungsgruppe `retry` lesen.
2. Wenn `retry.enabled === false`, sofort stoppen (`false`, keine Wiederholung gestartet).
3. `#retryAttempt` erhöhen.
4. `#retryPromise` einmalig erstellen (erster Versuch in einer Kette).
5. Wenn der Versuch `retry.maxRetries` überschreitet, endgültiges Fehlerereignis ausgeben und stoppen.
6. Verzögerung berechnen: `retry.baseDelayMs * 2^(attempt-1)`.
7. Bei Nutzungslimit-Fehlern Wiederholungshinweise parsen und den Auth-Speicher aufrufen (`markUsageLimitReached(...)`); wenn der Provider-/Modellwechsel erfolgreich ist, Verzögerung auf `0` erzwingen.
8. `auto_retry_start` ausgeben.
9. Die nachfolgende Assistenten-Fehlermeldung aus dem Laufzeit-Agentenstatus entfernen (bleibt im persistierten Sitzungsverlauf erhalten).
10. Mit Abbruchunterstützung schlafen.
11. Nach dem Aufwachen `agent.continue()` über `setTimeout(..., 0)` planen.

### Was die Wiederholungszähler zurücksetzt

`#retryAttempt` wird in folgenden Fällen auf `0` zurückgesetzt:

- erste erfolgreiche, nicht fehlerbehaftete und nicht abgebrochene Assistentennachricht nach gestarteten Wiederholungen (gibt `auto_retry_end { success: true }` aus)
- Wiederholungsabbruch während des Backoff-Schlafs
- Pfad bei Überschreitung der maximalen Wiederholungsanzahl

`#retryPromise` wird aufgelöst/geleert, wenn die Wiederholungskette endet (Erfolg, Abbruch oder Überschreitung des Maximums), über `#resolveRetry()`.

## Backoff- und Maximalversuch-Semantik

Einstellungen:

- `retry.enabled` (Standard `true`)
- `retry.maxRetries` (Standard `3`)
- `retry.baseDelayMs` (Standard `2000`)

Versuchsnummerierung:

- Der Versuchszähler wird vor der Maximalprüfung erhöht.
- Startereignisse verwenden den aktuellen Versuch (1-basiert).
- Das Enddaten-Ereignis bei Überschreitung meldet `attempt: this.#retryAttempt - 1` (letzte versuchte Wiederholungsanzahl).

Backoff-Sequenz mit Standardeinstellungen:

- Versuch 1: 2000 ms
- Versuch 2: 4000 ms
- Versuch 3: 8000 ms

Verzögerungsüberschreibungseingaben werden nur im Nutzungslimit-Behandlungspfad verwendet und nur zur Beeinflussung der Auth-Speicher-Modell-/Kontowechselentscheidung. Im Haupt-Wiederholungspfad ohne Komprimierung bleibt der Backoff eine lokale exponentielle Verzögerung, es sei denn, ein Wechsel ist erfolgreich (`delayMs = 0`).

## Abbruchmechanismen

### Expliziter Wiederholungsabbruch

`abortRetry()`:

- bricht `#retryAbortController` ab (falls vorhanden)
- löst das Wiederholungsversprechen auf (`#resolveRetry()`), sodass wartende Aufrufer entsperrt werden

Wenn der Abbruch während des Schlafs eintrifft, gibt der Catch-Pfad aus:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- setzt Versuch/Controller zurück

### Interaktion mit dem globalen Operationsabbruch

`abort()` ruft `abortRetry()` auf, bevor der aktive Agenten-Stream abgebrochen wird. Dies stellt sicher, dass der Wiederholungs-Backoff abgebrochen wird, wenn der Benutzer einen allgemeinen Abbruch auslöst.

### TUI-Interaktion

Bei `auto_retry_start` führt der EventController Folgendes aus:

- tauscht den `Esc`-Handler gegen `session.abortRetry()` aus
- rendert Ladetext: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

Bei `auto_retry_end` stellt er den vorherigen `Esc`-Handler wieder her und löscht den Ladezustand.

## Streaming- und Prompt-Abschlussverhalten

`prompt()` wartet letztendlich auf `#waitForRetry()`, nachdem `agent.prompt(...)` zurückkehrt.

Auswirkung:

- Ein Prompt-Aufruf wird nicht vollständig aufgelöst, bis eine gestartete Wiederholungskette beendet ist (Erfolg/Fehler/Abbruch).
- Der Wiederholungslebenszyklus ist Teil einer logischen Prompt-Ausführungsgrenze.

Dies verhindert, dass Aufrufer einen sich wiederholenden Durchlauf zu früh als abgeschlossen behandeln.

## Steuerung: Einstellungen und RPC

### Konfigurationsparameter

Definiert im Einstellungsschema unter der Gruppe `retry`:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

Programmatische Schalter in der Sitzung:

- `setAutoRetryEnabled(enabled)` schreibt `retry.enabled`
- `autoRetryEnabled` liest `retry.enabled`
- `isRetrying` meldet, ob das Wiederholungslebenszyklus-Versprechen aktiv ist

### RPC-Steuerung

RPC-Befehlsoberfläche:

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

Client-Hilfsfunktionen:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

Beide Befehle geben Erfolgsmeldungen zurück; Fortschritts-/Fehlerdetails der Wiederholung kommen aus gestreamten Sitzungsereignissen, nicht aus Befehlsantwort-Nutzdaten.

## Ereignisausgabe und Fehlerdarstellung

Wiederholungsereignisse auf Sitzungsebene:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

Weitergabe:

- über `AgentSession.subscribe(...)` ausgegeben
- als Erweiterungsereignisse an den Erweiterungs-Runner weitergeleitet
- im RPC-Modus direkt als JSON-Ereignisobjekte weitergeleitet (`session.subscribe(event => output(event))`)
- in der TUI vom `EventController` für die Lade-/Fehler-Benutzeroberfläche verarbeitet

Endgültige Fehlerdarstellung:

- Bei Überschreitung des Maximums oder Abbruch gilt `auto_retry_end.success === false`
- TUI zeigt: `Retry failed after N attempts: <finalError>`
- Erweiterungen/Hooks empfangen `auto_retry_end` mit denselben Feldern
- RPC-Verbraucher empfangen dasselbe Ereignisobjekt im stdout-Stream

## Permanente Stoppbedingungen

Die Wiederholung stoppt und setzt sich nicht automatisch fort, wenn eine der folgenden Bedingungen eintritt:

- `retry.enabled` ist false
- Fehler ist nicht als wiederholbar klassifiziert
- Fehler ist ein Kontext-Überlauf (an den Komprimierungspfad delegiert)
- Maximale Wiederholungsanzahl überschritten
- Benutzer bricht Wiederholung ab (`abort_retry` oder `Esc` während des Wiederholungs-Ladebildschirms)
- Globaler Abbruch (`abort`) bricht zuerst die Wiederholung ab

Eine neue Wiederholungskette kann später bei einem zukünftigen wiederholbaren Fehler beginnen, nachdem die Zähler zurückgesetzt wurden.

## Betriebliche Hinweise

- Die Klassifizierung erfolgt durch Regex-Textabgleich; anbieterspezifische strukturierte Fehler werden hier nicht verwendet.
- Die Wiederholung entfernt die fehlschlagende Assistenten-Fehlermeldung aus dem **Laufzeitkontext**, bevor sie fortfährt, aber der Sitzungsverlauf behält diesen Fehlereintrag.
- `RpcSessionState` stellt derzeit `autoCompactionEnabled`, aber kein `autoRetryEnabled`-Feld bereit; RPC-Aufrufer müssen ihren eigenen Schaltzustand verfolgen oder Einstellungen über andere APIs abfragen.
