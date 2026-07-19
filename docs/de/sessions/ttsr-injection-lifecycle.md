---
title: TTSR-Injektionslebenszyklus
description: >-
  TTSR (tool-use, tool-result, system-reminder) Injektionslebenszyklus für
  Kontextmanagement.
sidebar:
  order: 9
  label: TTSR-Injektion
i18n:
  sourceHash: 0f7432aa3bb5
  translator: machine
---

# TTSR-Injektionslebenszyklus

Dieses Dokument behandelt den aktuellen Time Traveling Stream Rules (TTSR) Laufzeitpfad von der Regelerkennung über Stream-Unterbrechung, Retry-Injektion, Extension-Benachrichtigungen bis hin zur Sitzungszustandsverwaltung.

## Implementierungsdateien

- [`../src/sdk.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/sdk.ts)
- [`../src/export/ttsr.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/export/ttsr.ts)
- [`../src/session/agent-session.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/session/session-manager.ts)
- [`../src/prompts/system/ttsr-interrupt.md`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/prompts/system/ttsr-interrupt.md)
- [`../src/capability/index.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/types.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/extensibility/extensions/types.ts)
- [`../src/extensibility/hooks/types.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/extensibility/hooks/types.ts)
- [`../src/extensibility/custom-tools/types.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`../src/modes/controllers/event-controller.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/modes/controllers/event-controller.ts)

## 1. Discovery-Feed und Regelregistrierung

Bei der Sitzungserstellung lädt `createAgentSession()` alle erkannten Regeln und erstellt einen `TtsrManager`:

```ts
const ttsrSettings = settings.getGroup("ttsr");
const ttsrManager = new TtsrManager(ttsrSettings);
const rulesResult = await loadCapability<Rule>(ruleCapability.id, { cwd });
for (const rule of rulesResult.items) {
  if (rule.ttsrTrigger) ttsrManager.addRule(rule);
}
```

### Deduplizierungsverhalten vor der Registrierung

`loadCapability("rules")` dedupliziert nach `rule.name` mit First-Wins-Semantik (höhere Provider-Priorität zuerst). Überdeckte Duplikate werden vor der TTSR-Registrierung entfernt.

### `TtsrManager.addRule()`-Verhalten

Die Registrierung wird übersprungen, wenn:

- `rule.ttsrTrigger` nicht vorhanden ist
- eine Regel mit demselben `rule.name` bereits in diesem Manager registriert wurde
- der reguläre Ausdruck nicht kompiliert werden kann (`new RegExp(rule.ttsrTrigger)` wirft einen Fehler)

Ungültige Regex-Trigger werden als Warnungen protokolliert und ignoriert; der Sitzungsstart wird fortgesetzt.

### Einstellungshinweis

`TtsrSettings.enabled` wird in den Manager geladen, wird aber derzeit nicht bei der Laufzeitsteuerung geprüft. Wenn Regeln existieren, wird der Abgleich trotzdem durchgeführt.

## 2. Streaming-Monitor-Lebenszyklus

Die TTSR-Erkennung läuft innerhalb von `AgentSession.#handleAgentEvent`.

### Turn-Start

Bei `turn_start` wird der Stream-Buffer zurückgesetzt:

- `ttsrManager.resetBuffer()`

### Während des Streams (`message_update`)

Wenn Assistenten-Updates eintreffen und Regeln existieren:

- `text_delta` und `toolcall_delta` überwachen
- Delta in den Manager-Buffer anhängen
- `check(buffer)` aufrufen

`check()` iteriert über registrierte Regeln und gibt alle übereinstimmenden Regeln zurück, die die Wiederholungsrichtlinie (`#canTrigger`) bestehen.

## 3. Trigger-Entscheidung und sofortiger Abbruchpfad

Wenn eine oder mehrere Regeln übereinstimmen:

1. `markInjected(matches)` zeichnet Regelnamen im Injektionszustand des Managers auf.
2. Übereinstimmende Regeln werden in `#pendingTtsrInjections` eingereiht.
3. `#ttsrAbortPending = true`.
4. `agent.abort()` wird sofort aufgerufen.
5. Das `ttsr_triggered`-Event wird asynchron emittiert (fire-and-forget).
6. Die Retry-Arbeit wird über `setTimeout(..., 50)` geplant.

Der Abbruch wird nicht durch Extension-Callbacks blockiert.

## 4. Retry-Planung, Kontextmodus und Erinnerungsinjektion

Nach dem 50ms-Timeout:

1. `#ttsrAbortPending = false`
2. `ttsrManager.getSettings().contextMode` auslesen
3. Wenn `contextMode === "discard"`, partielle Assistenten-Ausgabe mit `agent.popMessage()` verwerfen
4. Injektionsinhalt aus ausstehenden Regeln mithilfe der `ttsr-interrupt.md`-Vorlage erstellen
5. Eine synthetische Benutzernachricht anhängen, die einen `<system-interrupt ...>`-Block pro Regel enthält
6. `agent.continue()` aufrufen, um die Generierung erneut zu starten

Die Vorlagen-Payload ist:

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

Ausstehende Injektionen werden nach der Inhaltsgenerierung gelöscht.

### `contextMode`-Verhalten bei partieller Ausgabe

- `discard`: Die partielle/abgebrochene Assistentennachricht wird vor dem Retry entfernt.
- `keep`: Die partielle Assistenten-Ausgabe verbleibt im Konversationszustand; die Erinnerung wird danach angehängt.

## 5. Wiederholungsrichtlinie und Lückenlogik

`TtsrManager` verfolgt `#messageCount` und pro Regel `lastInjectedAt`.

### `repeatMode: "once"`

Eine Regel kann nur einmal ausgelöst werden, nachdem sie einen Injektionseintrag hat.

### `repeatMode: "after-gap"`

Eine Regel kann erneut ausgelöst werden, nur wenn:

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount` wird bei `turn_end` inkrementiert, daher wird die Lücke in abgeschlossenen Turns gemessen, nicht in Stream-Chunks.

## 6. Event-Emission und Extension-/Hook-Oberflächen

### Sitzungs-Event

`AgentSessionEvent` enthält:

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### Extension-Runner

`#emitSessionEvent()` leitet das Event weiter an:

- Extension-Listener (`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`)
- Lokale Sitzungsabonnenten

### Hook- und Custom-Tool-Typisierung

- Die Extension-API stellt `on("ttsr_triggered", ...)` bereit
- Die Hook-API stellt `on("ttsr_triggered", ...)` bereit
- Custom Tools erhalten `onSession({ reason: "ttsr_triggered", rules })`

### Unterschied bei der Darstellung im interaktiven Modus

Der interaktive Modus verwendet `session.isTtsrAbortPending`, um die Anzeige des abgebrochenen Assistenten-Stoppgrunds als sichtbaren Fehler während der TTSR-Unterbrechung zu unterdrücken, und rendert eine `TtsrNotificationComponent`, wenn das Event eintrifft.

## 7. Persistenz und Wiederaufnahmezustand (aktuelle Implementierung)

`SessionManager` hat volle Schemaunterstützung für die Persistenz injizierter Regeln:

- Eintragstyp: `ttsr_injection`
- Anhänge-API: `appendTtsrInjection(ruleNames)`
- Abfrage-API: `getInjectedTtsrRules()`
- Die Kontextrekonstruktion enthält `SessionContext.injectedTtsrRules`

`TtsrManager` unterstützt auch die Wiederherstellung über `restoreInjected(ruleNames)`.

### Aktueller Verdrahtungsstatus

Im aktuellen Laufzeitpfad:

- `AgentSession` fügt keine `ttsr_injection`-Einträge hinzu, wenn TTSR ausgelöst wird.
- `createAgentSession()` stellt `existingSession.injectedTtsrRules` nicht in den `ttsrManager` zurück.

Nettoeffekt: Die Unterdrückung injizierter Regeln wird im Arbeitsspeicher für den laufenden Prozess durchgesetzt, wird aber derzeit über diesen Pfad nicht persistent gespeichert/wiederhergestellt bei Sitzungsneuladung/-wiederaufnahme.

## 8. Race-Condition-Grenzen und Reihenfolgegarantien

### Abbruch vs. Retry-Callback

- Der Abbruch ist aus TTSR-Handler-Perspektive synchron (`agent.abort()` wird sofort aufgerufen)
- Der Retry wird durch Timer verzögert (`50ms`)
- Die Extension-Benachrichtigung ist asynchron und wird absichtlich nicht vor der Abbruch-/Retry-Planung abgewartet

### Mehrere Übereinstimmungen im selben Stream-Fenster

`check()` gibt alle derzeit übereinstimmenden berechtigten Regeln zurück. Sie werden als Batch in der nächsten Retry-Nachricht injiziert.

### Zwischen Abbruch und Fortsetzung

Während des Timer-Fensters kann sich der Zustand ändern (Benutzerunterbrechung, Modusaktionen, zusätzliche Events). Der Retry-Aufruf erfolgt nach dem Best-Effort-Prinzip: `agent.continue().catch(() => {})` schluckt Folgefehler.

## 9. Zusammenfassung der Randfälle

- Ungültiger `ttsr_trigger`-Regex: wird mit Warnung übersprungen; andere Regeln funktionieren weiter.
- Doppelte Regelnamen auf Capability-Ebene: Duplikate mit niedrigerer Priorität werden vor der Registrierung überdeckt.
- Doppelte Namen auf Manager-Ebene: Die zweite Registrierung wird ignoriert.
- `contextMode: "keep"`: Partielle verletzende Ausgabe kann vor dem Erinnerungs-Retry im Kontext verbleiben.
- Repeat-after-gap hängt von Turn-Zähler-Inkrementen bei `turn_end` ab; Chunks innerhalb eines Turns erhöhen die Lückenzähler nicht.
