---
title: Automatische Wiederholungsrichtlinie (ohne Komprimierung)
description: >-
  Automatische Wiederholungsrichtlinie für transiente API-Fehler außerhalb des
  Komprimierungspfads.
sidebar:
  order: 6
  label: Wiederholungsrichtlinie
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# Automatische Wiederholungsrichtlinie (ohne Komprimierung)

Dieses Dokument beschreibt den standardmäßigen API-Fehler-Wiederholungspfad in `AgentSession`.

Es schließt explizit die Kontextüberlauf-Wiederherstellung über automatische Komprimierung aus. Überläufe werden durch Komprimierungslogik behandelt und sind separat in [`compaction.md`](./compaction.md) dokumentiert.

## Implementierungsdateien

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## Abgrenzung gegenüber der Komprimierung

Wiederholung und Komprimierung werden aus demselben `agent_end`-Pfad geprüft, sind jedoch bewusst getrennt:

1. `agent_end` prüft die letzte Assistenznachricht.
2. `#isRetryableError(...)` wird zuerst ausgeführt.
3. Wenn eine Wiederholung eingeleitet wird, werden Komprimierungsprüfungen für diesen Durchlauf übersprungen.
4. Kontextüberlauf-Fehler sind hart von der Wiederholungsklassifikation ausgeschlossen (`isContextOverflow(...)` unterbricht die Wiederholung vorzeitig).
5. Überläufe fallen daher zu `#checkCompaction(...)` durch, anstatt zur Standard-Wiederholung.

Zusammenfassung: Überlastungs-, Ratenlimit-, Server- und netzwerkbedingte Fehler verwenden diese Wiederholungsrichtlinie; Kontextfenster-Überläufe verwenden die Komprimierungs-Wiederherstellung.

## Wiederholungsklassifikation

`#isRetryableError(...)` erfordert alle der folgenden Bedingungen:

- Assistent-`stopReason === "error"`
- `errorMessage` ist vorhanden
- Nachricht ist **kein** Kontextüberlauf
- `errorMessage` entspricht `#isRetryableErrorMessage(...)`

Aktueller Satz wiederholbarer Muster (regex-basiert):

- overloaded
- rate limit / usage limit / too many requests
- HTTP-ähnliche Serverklassen: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- `retry delay`-Formulierungen

Dies ist eine zeichenkettenbasierte Musterklassifikation, keine typisierte Anbieter-Fehlercodes.

## Wiederholungslebenszyklus und Zustandsübergänge

Sitzungszustand, der von der Wiederholung verwendet wird:

- `#retryAttempt: number` (`0` bedeutet inaktiv)
- `#retryPromise: Promise<void> | undefined` (verfolgt den laufenden Wiederholungslebenszyklus)
- `#retryResolve: (() => void) | undefined` (löst `#retryPromise` auf)
- `#retryAbortController: AbortController | undefined` (bricht den Backoff-Schlaf ab)

Ablauf (`#handleRetryableError`):

1. Einstellungsgruppe `retry` lesen.
2. Wenn `retry.enabled === false`, sofort stoppen (`false`, keine Wiederholung gestartet).
3. `#retryAttempt` erhöhen.
4. `#retryPromise` einmalig erstellen (erster Versuch in einer Kette).
5. Wenn der Versuch `retry.maxRetries` überschreitet, abschließendes Fehlerereignis ausgeben und stoppen.
6. Verzögerung berechnen: `retry.baseDelayMs * 2^(attempt-1)`.
7. Bei Nutzungslimit-Fehlern Wiederholungshinweise analysieren und Auth-Speicher aufrufen (`markUsageLimitReached(...)`); wenn Anbieter-/Modellwechsel erfolgreich, Verzögerung auf `0` erzwingen.
8. `auto_retry_start` ausgeben.
9. Die abschließende Assistent-Fehlermeldung aus dem Agent-Laufzeitzustand entfernen (in der persistierten Sitzungshistorie weiterhin gespeichert).
10. Mit Abbruchunterstützung schlafen.
11. Beim Aufwachen `agent.continue()` über `setTimeout(..., 0)` planen.

### Was die Wiederholungszähler zurücksetzt

`#retryAttempt` wird in diesen Fällen auf `0` zurückgesetzt:

- erste erfolgreiche, nicht fehlerhafte, nicht abgebrochene Assistenznachricht nach begonnenen Wiederholungen (gibt `auto_retry_end { success: true }` aus)
- Wiederholungsabbruch während des Backoff-Schlafs
- Pfad bei überschrittener maximaler Wiederholungsanzahl

`#retryPromise` wird aufgelöst/bereinigt, wenn die Wiederholungskette endet (Erfolg, Abbruch oder Maximum überschritten), über `#resolveRetry()`.

## Backoff und Semantik der maximalen Versuche

Einstellungen:

- `retry.enabled` (Standard: `true`)
- `retry.maxRetries` (Standard: `3`)
- `retry.baseDelayMs` (Standard: `2000`)

Versuchsnummerierung:

- Versuchszähler wird vor der Maximalprüfung erhöht
- Startereignisse verwenden den aktuellen Versuch (1-basiert)
- Das Ende-Ereignis bei überschrittenem Maximum meldet `attempt: this.#retryAttempt - 1` (letzter versuchter Wiederholungszähler)

Backoff-Sequenz mit Standardeinstellungen:

- Versuch 1: 2000 ms
- Versuch 2: 4000 ms
- Versuch 3: 8000 ms

Verzögerungsüberschreibungseingaben werden nur im Nutzungslimit-Behandlungspfad verwendet und nur zur Beeinflussung der Auth-Speicher-Modell-/Kontowechselentscheidung. Im Haupt-Nicht-Komprimierungs-Wiederholungspfad bleibt der Backoff eine lokale exponentielle Verzögerung, sofern der Wechsel nicht erfolgreich ist (`delayMs = 0`).

## Abbruchmechanismen

### Expliziter Wiederholungsabbruch

`abortRetry()`:

- bricht `#retryAbortController` ab (falls vorhanden)
- löst das Wiederholungsversprechen auf (`#resolveRetry()`), damit Wartende entsperrt werden

Wenn der Abbruch während des Schlafs eintritt, gibt der Catch-Pfad aus:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- setzt Versuch/Controller zurück

### Interaktion mit globalem Operationsabbruch

`abort()` ruft `abortRetry()` auf, bevor der aktive Agent-Stream abgebrochen wird. Dies stellt sicher, dass der Wiederholungs-Backoff abgebrochen wird, wenn der Benutzer einen allgemeinen Abbruch auslöst.

### TUI-Interaktion

Bei `auto_retry_start` führt EventController Folgendes aus:

- tauscht den `Esc`-Handler gegen `session.abortRetry()` aus
- rendert Ladetext: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

Bei `auto_retry_end` wird der vorherige `Esc`-Handler wiederhergestellt und der Ladezustand geleert.

## Streaming- und Prompt-Abschlussverhalten

`prompt()` wartet letztendlich nach der Rückgabe von `agent.prompt(...)` auf `#waitForRetry()`.

Auswirkung:

- Ein Prompt-Aufruf wird erst vollständig aufgelöst, wenn eine gestartete Wiederholungskette endet (Erfolg/Fehler/Abbruch)
- Der Wiederholungslebenszyklus ist Teil einer logischen Prompt-Ausführungsgrenze

Dies verhindert, dass Aufrufer einen sich wiederholenden Durchlauf zu früh als abgeschlossen behandeln.

## Steuerung: Einstellungen und RPC

### Konfigurationsparameter

In dem Einstellungsschema unter der Wiederholungsgruppe definiert:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

Programmatische Umschalter in der Sitzung:

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

Beide Befehle geben Erfolgsantworten zurück; Fortschritts-/Fehlerdetails der Wiederholung kommen aus gestreamten Sitzungsereignissen, nicht aus Befehlsantwort-Nutzdaten.

## Ereignisausgabe und Fehlerdarstellung

Wiederholungsereignisse auf Sitzungsebene:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

Weitergabe:

- ausgegeben über `AgentSession.subscribe(...)`
- als Erweiterungsereignisse an den Erweiterungs-Runner weitergeleitet
- im RPC-Modus direkt als JSON-Ereignisobjekte weitergeleitet (`session.subscribe(event => output(event))`)
- in der TUI von `EventController` für Lade-/Fehler-UI verarbeitet

Darstellung abschließender Fehler:

- Bei überschrittenem Maximum oder Abbruch gilt `auto_retry_end.success === false`
- TUI zeigt: `Retry failed after N attempts: <finalError>`
- Erweiterungen/Hooks empfangen `auto_retry_end` mit denselben Feldern
- RPC-Konsumenten empfangen dasselbe Ereignisobjekt im stdout-Stream

## Permanente Stoppbedingungen

Die Wiederholung stoppt und setzt nicht automatisch fort, wenn einer dieser Fälle eintritt:

- `retry.enabled` ist false
- Fehler ist nicht wiederholungsklassifiziert
- Fehler ist Kontextüberlauf (an den Komprimierungspfad delegiert)
- Maximale Wiederholungsanzahl überschritten
- Benutzer bricht Wiederholung ab (`abort_retry` oder `Esc` während des Wiederholungs-Laders)
- Globaler Abbruch (`abort`) bricht die Wiederholung zuerst ab

Eine neue Wiederholungskette kann nach dem Zurücksetzen der Zähler bei einem zukünftigen wiederholbaren Fehler erneut starten.

## Betriebliche Einschränkungen

- Die Klassifikation erfolgt durch Regex-Textabgleich; anbieterspezifische strukturierte Fehler werden hier nicht verwendet.
- Die Wiederholung entfernt den fehlgeschlagenen Assistent-Fehler aus dem **Laufzeitkontext** vor dem Fortsetzen, die Sitzungshistorie behält diesen Fehlereintrag jedoch weiterhin.
- `RpcSessionState` stellt derzeit `autoCompactionEnabled`, aber kein `autoRetryEnabled`-Feld bereit; RPC-Aufrufer müssen ihren eigenen Umschaltzustand verfolgen oder die Einstellungen über andere APIs abfragen.
