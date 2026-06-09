---
title: TTSR-Injektionslebenszyklus
description: >-
  TTSR (tool-use, tool-result, system-reminder) Injektionslebenszyklus für
  Kontextverwaltung.
sidebar:
  order: 9
  label: TTSR-Injektion
i18n:
  sourceHash: d6179a286584
  translator: machine
---

# TTSR-Injektionslebenszyklus

Dieses Dokument behandelt den aktuellen Time Traveling Stream Rules (TTSR) Laufzeitpfad von der Regelerkennung über Stream-Unterbrechung, Retry-Injektion, Erweiterungsbenachrichtigungen bis hin zur Sitzungszustandsverwaltung.

## Implementierungsdateien

- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/export/ttsr.ts`](../../packages/coding-agent/src/export/ttsr.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/prompts/system/ttsr-interrupt.md`](../../packages/coding-agent/src/prompts/system/ttsr-interrupt.md)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/types.ts`](../../packages/coding-agent/src/extensibility/extensions/types.ts)
- [`../src/extensibility/hooks/types.ts`](../../packages/coding-agent/src/extensibility/hooks/types.ts)
- [`../src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)

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

`loadCapability("rules")` dedupliziert nach `rule.name` mit First-Wins-Semantik (höhere Provider-Priorität zuerst). Verdeckte Duplikate werden vor der TTSR-Registrierung entfernt.

### Verhalten von `TtsrManager.addRule()`

Die Registrierung wird übersprungen, wenn:

- `rule.ttsrTrigger` nicht vorhanden ist
- eine Regel mit demselben `rule.name` bereits in diesem Manager registriert wurde
- der reguläre Ausdruck nicht kompiliert werden kann (`new RegExp(rule.ttsrTrigger)` wirft einen Fehler)

Ungültige Regex-Trigger werden als Warnungen protokolliert und ignoriert; der Sitzungsstart wird fortgesetzt.

### Einstellungshinweis

`TtsrSettings.enabled` wird in den Manager geladen, wird aber derzeit nicht bei der Laufzeitsteuerung überprüft. Wenn Regeln existieren, wird der Abgleich trotzdem ausgeführt.

## 2. Streaming-Monitor-Lebenszyklus

Die TTSR-Erkennung läuft innerhalb von `AgentSession.#handleAgentEvent`.

### Rundenstart

Bei `turn_start` wird der Stream-Puffer zurückgesetzt:

- `ttsrManager.resetBuffer()`

### Während des Streams (`message_update`)

Wenn Assistenten-Updates eintreffen und Regeln existieren:

- `text_delta` und `toolcall_delta` überwachen
- Delta in den Manager-Puffer anfügen
- `check(buffer)` aufrufen

`check()` iteriert über registrierte Regeln und gibt alle übereinstimmenden Regeln zurück, die die Wiederholungsrichtlinie (`#canTrigger`) bestehen.

## 3. Trigger-Entscheidung und sofortiger Abbruchpfad

Wenn eine oder mehrere Regeln übereinstimmen:

1. `markInjected(matches)` zeichnet Regelnamen im Injektionszustand des Managers auf.
2. Übereinstimmende Regeln werden in `#pendingTtsrInjections` eingereiht.
3. `#ttsrAbortPending = true`.
4. `agent.abort()` wird sofort aufgerufen.
5. Das Ereignis `ttsr_triggered` wird asynchron ausgelöst (Fire-and-Forget).
6. Die Retry-Arbeit wird über `setTimeout(..., 50)` geplant.

Der Abbruch wird nicht durch Erweiterungs-Callbacks blockiert.

## 4. Retry-Planung, Kontextmodus und Erinnerungsinjektion

Nach dem 50ms-Timeout:

1. `#ttsrAbortPending = false`
2. `ttsrManager.getSettings().contextMode` auslesen
3. Wenn `contextMode === "discard"`, wird die teilweise Assistenten-Ausgabe mit `agent.popMessage()` verworfen
4. Injektionsinhalt aus ausstehenden Regeln mittels `ttsr-interrupt.md`-Vorlage erstellen
5. Eine synthetische Benutzernachricht mit einem `<system-interrupt ...>`-Block pro Regel anfügen
6. `agent.continue()` aufrufen, um die Generierung erneut zu versuchen

Vorlagen-Payload ist:

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

Ausstehende Injektionen werden nach der Inhaltsgenerierung gelöscht.

### `contextMode`-Verhalten bei teilweiser Ausgabe

- `discard`: Die teilweise/abgebrochene Assistentennachricht wird vor dem Retry entfernt.
- `keep`: Die teilweise Assistenten-Ausgabe bleibt im Gesprächszustand erhalten; die Erinnerung wird danach angefügt.

## 5. Wiederholungsrichtlinie und Lückenlogik

`TtsrManager` verfolgt `#messageCount` und pro Regel `lastInjectedAt`.

### `repeatMode: "once"`

Eine Regel kann nur einmal auslösen, nachdem ein Injektionseintrag vorhanden ist.

### `repeatMode: "after-gap"`

Eine Regel kann erneut auslösen, nur wenn:

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount` wird bei `turn_end` inkrementiert, daher wird die Lücke in abgeschlossenen Runden gemessen, nicht in Stream-Chunks.

## 6. Ereignisauslösung und Erweiterungs-/Hook-Oberflächen

### Sitzungsereignis

`AgentSessionEvent` enthält:

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### Erweiterungs-Runner

`#emitSessionEvent()` leitet das Ereignis weiter an:

- Erweiterungs-Listener (`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`)
- Lokale Sitzungsabonnenten

### Hook- und Custom-Tool-Typisierung

- Die Erweiterungs-API stellt `on("ttsr_triggered", ...)` bereit
- Die Hook-API stellt `on("ttsr_triggered", ...)` bereit
- Custom Tools empfangen `onSession({ reason: "ttsr_triggered", rules })`

### Unterschied bei der Darstellung im interaktiven Modus

Der interaktive Modus verwendet `session.isTtsrAbortPending`, um die Anzeige des abgebrochenen Assistenten-Stoppgrunds als sichtbaren Fehler während der TTSR-Unterbrechung zu unterdrücken, und rendert eine `TtsrNotificationComponent`, wenn das Ereignis eintrifft.

## 7. Persistenz und Wiederherstellungszustand (aktuelle Implementierung)

`SessionManager` verfügt über vollständige Schema-Unterstützung für die Persistenz injizierter Regeln:

- Eintragstyp: `ttsr_injection`
- Anfüge-API: `appendTtsrInjection(ruleNames)`
- Abfrage-API: `getInjectedTtsrRules()`
- Die Kontextrekonstruktion enthält `SessionContext.injectedTtsrRules`

`TtsrManager` unterstützt auch die Wiederherstellung über `restoreInjected(ruleNames)`.

### Aktueller Verdrahtungsstatus

Im aktuellen Laufzeitpfad:

- `AgentSession` fügt keine `ttsr_injection`-Einträge hinzu, wenn TTSR auslöst.
- `createAgentSession()` stellt `existingSession.injectedTtsrRules` nicht zurück in den `ttsrManager` wieder her.

Nettoeffekt: Die Unterdrückung injizierter Regeln wird im Arbeitsspeicher für den laufenden Prozess durchgesetzt, wird aber derzeit über diesen Pfad nicht über Sitzungsneuladungen/-wiederaufnahmen hinweg persistiert/wiederhergestellt.

## 8. Race-Grenzen und Reihenfolgegarantien

### Abbruch vs. Retry-Callback

- Der Abbruch ist aus Sicht des TTSR-Handlers synchron (`agent.abort()` wird sofort aufgerufen)
- Der Retry wird per Timer verzögert (`50ms`)
- Die Erweiterungsbenachrichtigung ist asynchron und wird absichtlich nicht vor der Abbruch-/Retry-Planung abgewartet

### Mehrere Übereinstimmungen im selben Stream-Fenster

`check()` gibt alle derzeit übereinstimmenden berechtigten Regeln zurück. Sie werden als Batch in der nächsten Retry-Nachricht injiziert.

### Zwischen Abbruch und Fortsetzung

Während des Timer-Fensters kann sich der Zustand ändern (Benutzerunterbrechung, Modusaktionen, zusätzliche Ereignisse). Der Retry-Aufruf erfolgt nach dem Best-Effort-Prinzip: `agent.continue().catch(() => {})` unterdrückt Folgefehler.

## 9. Zusammenfassung der Grenzfälle

- Ungültiger `ttsr_trigger`-Regex: wird mit Warnung übersprungen; andere Regeln werden fortgesetzt.
- Doppelte Regelnamen auf Capability-Ebene: Duplikate mit niedrigerer Priorität werden vor der Registrierung verdeckt.
- Doppelte Namen auf Manager-Ebene: Die zweite Registrierung wird ignoriert.
- `contextMode: "keep"`: Teilweise verletzende Ausgabe kann vor dem Erinnerungs-Retry im Kontext verbleiben.
- Repeat-after-gap hängt von Rundenzähler-Inkrementen bei `turn_end` ab; Chunks innerhalb einer Runde erhöhen die Lückenzähler nicht.
