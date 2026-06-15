---
title: Interne Streaming-Mechanismen des Providers
description: >-
  Implementierung des Provider-Streamings mit SSE-Parsing, Token-Zählung und
  Backpressure-Handling.
sidebar:
  order: 2
  label: Interne Streaming-Mechanismen
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# Interne Streaming-Mechanismen des Providers

Dieses Dokument erläutert, wie Token-/Werkzeug-Streaming in `@f5xc-salesdemos/pi-ai` normalisiert und anschließend über `@f5xc-salesdemos/pi-agent-core` sowie `coding-agent`-Sitzungsereignisse weitergeleitet wird.

## Vollständiger Ablauf

1. `streamSimple()` (`packages/ai/src/stream.ts`) ordnet generische Optionen zu und leitet an eine Provider-Stream-Funktion weiter.
2. Provider-Stream-Funktionen (`anthropic.ts`, `openai-responses.ts`, `google.ts`) übersetzen provider-native Stream-Ereignisse in die einheitliche `AssistantMessageEvent`-Sequenz.
3. Jeder Provider überträgt Ereignisse in `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`), das Delta-Ereignisse drosselt und Folgendes bereitstellt:
   - asynchrone Iteration für inkrementelle Aktualisierungen
   - `result()` für das finale `AssistantMessage`
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) verarbeitet diese Ereignisse, ändert den laufenden Assistentenstatus und gibt `message_update`-Ereignisse mit dem rohen `assistantMessageEvent` aus.
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) abonniert Agent-Ereignisse, speichert Nachrichten, steuert Erweiterungs-Hooks und wendet Sitzungsverhalten an (Wiederholung, Komprimierung, TTSR, Streaming-Edit-Abbruchprüfungen).

## Einheitlicher Stream-Vertrag in `@f5xc-salesdemos/pi-ai`

Alle Provider geben dieselbe Struktur aus (`AssistantMessageEvent` in `packages/ai/src/types.ts`):

- `start`
- Inhaltsblock-Lebenszyklus-Triplets:
  - Text: `text_start` → `text_delta`* → `text_end`
  - Denken: `thinking_start` → `thinking_delta`* → `thinking_end`
  - Werkzeugaufruf: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- Abschlussereignis:
  - `done` mit `reason: "stop" | "length" | "toolUse"`
  - oder `error` mit `reason: "aborted" | "error"`

`AssistantMessageEventStream` gewährleistet:

- das finale Ergebnis wird durch das Abschlussereignis aufgelöst (`done` oder `error`)
- Deltas werden gebündelt/gedrosselt (~50 ms)
- gepufferte Deltas werden vor Nicht-Delta-Ereignissen und vor dem Abschluss geleert

## Delta-Drosselung und Harmonisierungsverhalten

`AssistantMessageEventStream` behandelt `text_delta`, `thinking_delta` und `toolcall_delta` als zusammenführbare Ereignisse:

- gepufferte Deltas werden nur zusammengeführt, wenn **type + contentIndex** übereinstimmen
- die Zusammenführung behält den neuesten `partial`-Snapshot
- Nicht-Delta-Ereignisse erzwingen eine sofortige Leerung

Dies glättet hochfrequente Provider-Streams für TUI-/Ereignis-Consumer, stellt jedoch keine Provider-Backpressure dar: Provider produzieren weiterhin mit voller Geschwindigkeit, während der lokale Stream puffert.

## Details zur Provider-Normalisierung

## Anthropic (`anthropic-messages`)

Quelle: `packages/ai/src/providers/anthropic.ts`

Normalisierungspunkte:

- `message_start` initialisiert die Nutzung (Eingabe-/Ausgabe-/Cache-Token)
- `content_block_start` wird auf Text-/Denk-/Werkzeugaufruf-Starts abgebildet
- `content_block_delta` wird abgebildet:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` aktualisiert nur `thinkingSignature` (kein Ereignis)
- `content_block_stop` gibt das entsprechende `*_end` aus
- `message_delta.stop_reason` wird über `mapStopReason()` abgebildet

Streaming der Werkzeugaufruf-Argumente:

- jeder Werkzeugblock enthält internen `partialJson`
- jedes JSON-Delta wird an `partialJson` angehängt
- `arguments` werden bei jedem Delta über `parseStreamingJson()` neu geparst
- `toolcall_end` parst einmal mehr, dann wird `partialJson` entfernt

## OpenAI Responses (`openai-responses`)

Quelle: `packages/ai/src/providers/openai-responses.ts`

Normalisierungspunkte:

- `response.output_item.added` startet Reasoning-/Text-/Funktionsaufruf-Blöcke
- Reasoning-Summary-Ereignisse (`response.reasoning_summary_text.delta`) werden zu `thinking_delta`
- Ausgabe-/Zurückweisungs-Deltas werden zu `text_delta`
- `response.function_call_arguments.delta` wird zu `toolcall_delta`
- `response.output_item.done` gibt `thinking_end` / `text_end` / `toolcall_end` aus
- `response.completed` bildet Status auf Stop-Grund und Nutzung ab

Streaming der Werkzeugaufruf-Argumente:

- dasselbe `partialJson`-Akkumulationsmuster wie bei Anthropic
- Provider, die nur `response.function_call_arguments.done` senden, füllen dennoch die finalen Argumente
- Werkzeugaufruf-IDs werden als `"<call_id>|<item_id>"` normalisiert

## Google Generative AI (`google-generative-ai`)

Quelle: `packages/ai/src/providers/google.ts`

Normalisierungspunkte:

- iteriert `candidate.content.parts`
- Textteile werden durch `isThinkingPart(part)` in Denken vs. Text aufgeteilt
- Blockwechsel schließen den vorherigen Block, bevor ein neuer gestartet wird
- `part.functionCall` wird als vollständiger Werkzeugaufruf behandelt (Start/Delta/Ende werden sofort ausgegeben)
- Beendigungsgrund wird durch `mapStopReason()` aus `google-shared.ts` abgebildet

Streaming der Werkzeugaufruf-Argumente:

- Funktionsaufruf-Argumente kommen als strukturiertes Objekt an, nicht als inkrementeller JSON-Text
- die Implementierung gibt ein synthetisches `toolcall_delta` mit `JSON.stringify(arguments)` aus
- für Google ist in diesem Pfad kein partieller JSON-Parser erforderlich

## Partielle Werkzeugaufruf-JSON-Akkumulation und -Wiederherstellung

Gemeinsames Verhalten für Anthropic/OpenAI Responses verwendet `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. `JSON.parse` versuchen
2. Fallback auf `partial-json`-Parser für unvollständige Fragmente
3. falls beide fehlschlagen, `{}` zurückgeben

Implikationen:

- fehlerhafte oder abgeschnittene Argument-Deltas führen nicht sofort zum Absturz der Stream-Verarbeitung
- laufende `arguments` können vorübergehend `{}` sein
- spätere gültige Deltas können strukturierte Argumente wiederherstellen, da das Parsing bei jedem Anhängen erneut versucht wird
- das finale `toolcall_end` führt vor der Ausgabe einen weiteren Parse-Versuch durch

## Stop-Gründe vs. Transport-/Laufzeitfehler

Provider-Stop-Gründe werden auf normalisierte `stopReason` abgebildet:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, Sicherheits-/Zurückweisungsfälle→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, Sicherheits-/Verbots-/fehlerhafte-Funktionsaufruf-Klassen→`error`

Fehlersemantiken sind in zwei Stufen aufgeteilt:

1. **Modellabschluss-Semantik** (vom Provider gemeldeter Beendigungsgrund/-status)
2. **Transport-/Laufzeitfehler** (Netzwerk-/Client-/Parser-/Abbruchausnahmen)

Falls der Provider-Stream einen Fehler auslöst oder einen Fehler signalisiert, fängt jeder Provider-Wrapper diesen ab und gibt ein abschließendes `error`-Ereignis aus mit:

- `stopReason = "aborted"` wenn das Abbruchsignal gesetzt ist
- andernfalls `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## Verhalten bei fehlerhaften Chunks / SSE-Parse-Fehlern

Für diese Provider-Pfade wird das Chunk-/SSE-Framing von Vendor-SDK-Streams verarbeitet (Anthropic SDK, OpenAI SDK, Google SDK). Dieser Code implementiert hier keinen eigenen SSE-Decoder.

Beobachtetes Verhalten in der aktuellen Implementierung:

- fehlerhafte Chunk-/SSE-Analyse auf SDK-Ebene führt zu einer Ausnahme oder einem Stream-`error`-Ereignis
- der Provider-Wrapper wandelt dies in ein einheitliches abschließendes `error`-Ereignis um
- kein provider-spezifisches Fortsetzen/Wiederholen innerhalb der Stream-Funktion selbst
- übergeordnete Wiederholungen werden in der `AgentSession`-Auto-Retry-Logik verarbeitet (Nachrichtenebenen-Wiederholung, keine Stream-Chunk-Wiedergabe)

## Abbruchgrenzen

Der Abbruch ist mehrschichtig:

- KI-Provider-Anfrage: `options.signal` wird in den Provider-Client-Stream-Aufruf übergeben.
- Provider-Wrapper: nach der Stream-Schleife erzwingt ein abgebrochenes Signal den Fehlerpfad (`"Request was aborted"`).
- Agent-Schleife: prüft `signal.aborted` vor der Verarbeitung jedes Provider-Ereignisses und kann eine abgebrochene Assistentennachricht aus dem aktuellen Teilstand synthetisieren.
- Sitzungs-/Agent-Steuerungen: `AgentSession.abort()` -> `agent.abort()` -> gemeinsame Abbruch-Controller-Stornierung.

Der Abbruch der Werkzeugausführung ist vom Abbruch des Modell-Streams getrennt:

- Werkzeug-Runner verwenden `AbortSignal.any([agentSignal, steeringAbortSignal])`
- Steuerungsunterbrechungen können die verbleibende Werkzeugausführung abbrechen, während bereits produzierte Werkzeugergebnisse erhalten bleiben

## Backpressure-Grenzen

Es gibt keinen harten Backpressure-Mechanismus zwischen dem Provider-SDK-Stream und nachgelagerten Consumern:

- `EventStream` verwendet In-Memory-Warteschlangen ohne maximale Größe
- Drosselung reduziert die UI-Aktualisierungsrate, verlangsamt jedoch nicht die Provider-Aufnahme
- wenn Consumer erheblich zurückliegen, können sich wartende Ereignisse bis zum Abschluss ansammeln

Das aktuelle Design bevorzugt Reaktionsfähigkeit und einfache Sortierung gegenüber einer Flusssteuerung mit begrenztem Puffer.

## Wie Stream-Ereignisse als Agent-/Sitzungsereignisse erscheinen

`agentLoop.streamAssistantResponse()` verbindet `AssistantMessageEvent` mit `AgentEvent`:

- bei `start`: schiebt Platzhalter-Assistentennachricht ein und gibt `message_start` aus
- bei Blockereignissen (`text_*`, `thinking_*`, `toolcall_*`): aktualisiert die letzte Assistentennachricht, gibt `message_update` mit rohem `assistantMessageEvent` aus
- bei Abschluss (`done`/`error`): löst die finale Nachricht aus `response.result()` auf, gibt `message_end` aus

`AgentSession` verarbeitet diese Ereignisse dann für sitzungsweite Verhaltensweisen:

- TTSR beobachtet `message_update.assistantMessageEvent` auf `text_delta` und `toolcall_delta`
- der Streaming-Edit-Schutz prüft `toolcall_delta`/`toolcall_end` bei `edit`-Aufrufen und kann frühzeitig abbrechen
- die Persistenz schreibt finalisierte Nachrichten bei `message_end`
- Auto-Retry prüft den Assistenten-`stopReason === "error"` sowie `errorMessage`-Heuristiken

## Einheitliche vs. provider-spezifische Zuständigkeiten

Einheitlich (gemeinsamer Vertrag):

- Ereignisform (`AssistantMessageEvent`)
- Extraktion des finalen Ergebnisses (`done`/`error`)
- Delta-Drosselung und Zusammenführungsregeln
- Agent-/Sitzungs-Ereignisweiterleitungsmodell

Provider-spezifisch (nicht vollständig abstrahiert):

- Upstream-Ereignistaxonomien und Abbildungslogik
- Übersetzungstabellen für Stop-Gründe
- Konventionen für Werkzeugaufruf-IDs
- Semantik und Signaturen von Reasoning-/Denk-Blöcken
- Semantik der Nutzungs-Token und Verfügbarkeitstiming
- Nachrichtenkonvertierungseinschränkungen je API

## Implementierungsdateien

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — Provider-Weiterleitung, Options-Abbildung, API-Schlüssel-/Sitzungs-Verkabelung.
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — generische Stream-Warteschlange und Assistenten-Delta-Drosselung.
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — partielles JSON-Parsing für gestreamte Werkzeugargumente.
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — Anthropic-Ereignisübersetzung und Werkzeug-JSON-Delta-Akkumulation.
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI-Responses-Ereignisübersetzung und Statusabbildung.
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Gemini-Stream-Chunk-zu-Block-Übersetzung.
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Gemini-Beendigungsgrund-Abbildung und gemeinsame Konvertierungsregeln.
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — Provider-Stream-Verarbeitung und `message_update`-Brücke.
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — sitzungsweite Verarbeitung von Streaming-Aktualisierungen, Abbruch, Wiederholung und Persistenz.
