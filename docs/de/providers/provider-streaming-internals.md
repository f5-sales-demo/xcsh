---
title: Provider Streaming Internals
description: >-
  Provider-Streaming-Implementierung mit SSE-Parsing, Token-Zählung und
  Backpressure-Behandlung.
sidebar:
  order: 2
  label: Streaming-Interna
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# Provider-Streaming-Interna

Dieses Dokument erläutert, wie Token-/Tool-Streaming in `@f5xc-salesdemos/pi-ai` normalisiert und anschließend durch `@f5xc-salesdemos/pi-agent-core` und `coding-agent`-Session-Events propagiert wird.

## End-to-End-Ablauf

1. `streamSimple()` (`packages/ai/src/stream.ts`) bildet generische Optionen ab und leitet an eine Provider-Stream-Funktion weiter.
2. Provider-Stream-Funktionen (`anthropic.ts`, `openai-responses.ts`, `google.ts`) übersetzen provider-native Stream-Events in die einheitliche `AssistantMessageEvent`-Sequenz.
3. Jeder Provider sendet Events in `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`), der Delta-Events drosselt und bereitstellt:
   - Asynchrone Iteration für inkrementelle Updates
   - `result()` für die finale `AssistantMessage`
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) konsumiert diese Events, mutiert den laufenden Assistenten-Zustand und emittiert `message_update`-Events, die das rohe `assistantMessageEvent` enthalten.
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) abonniert Agent-Events, persistiert Nachrichten, steuert Extension-Hooks und wendet Session-Verhaltensweisen an (Retry, Kompaktierung, TTSR, Streaming-Edit-Abbruchprüfungen).

## Einheitlicher Stream-Vertrag in `@f5xc-salesdemos/pi-ai`

Alle Provider emittieren dieselbe Struktur (`AssistantMessageEvent` in `packages/ai/src/types.ts`):

- `start`
- Content-Block-Lebenszyklen als Triplets:
  - Text: `text_start` → `text_delta`* → `text_end`
  - Thinking: `thinking_start` → `thinking_delta`* → `thinking_end`
  - Tool-Aufruf: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- Terminal-Event:
  - `done` mit `reason: "stop" | "length" | "toolUse"`
  - oder `error` mit `reason: "aborted" | "error"`

`AssistantMessageEventStream` garantiert:

- Das finale Ergebnis wird durch das Terminal-Event aufgelöst (`done` oder `error`)
- Deltas werden gebündelt/gedrosselt (~50ms)
- Gepufferte Deltas werden vor Nicht-Delta-Events und vor dem Abschluss geflusht

## Delta-Drosselung und Harmonisierungsverhalten

`AssistantMessageEventStream` behandelt `text_delta`, `thinking_delta` und `toolcall_delta` als zusammenführbare Events:

- Gepufferte Deltas werden nur zusammengeführt, wenn **Typ + contentIndex** übereinstimmen
- Die Zusammenführung behält den neuesten `partial`-Snapshot
- Nicht-Delta-Events erzwingen sofortiges Flushing

Dies glättet hochfrequente Provider-Streams für TUI-/Event-Konsumenten, stellt aber keine Provider-Backpressure dar: Provider produzieren weiterhin mit voller Geschwindigkeit, während der lokale Stream puffert.

## Details der Provider-Normalisierung

## Anthropic (`anthropic-messages`)

Quelle: `packages/ai/src/providers/anthropic.ts`

Normalisierungspunkte:

- `message_start` initialisiert die Nutzung (Input-/Output-/Cache-Tokens)
- `content_block_start` wird auf Text-/Thinking-/Toolcall-Starts abgebildet
- `content_block_delta` wird abgebildet:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` aktualisiert nur `thinkingSignature` (kein Event)
- `content_block_stop` emittiert das entsprechende `*_end`
- `message_delta.stop_reason` wird über `mapStopReason()` abgebildet

Tool-Aufruf-Argument-Streaming:

- Jeder Tool-Block führt intern `partialJson`
- Jedes JSON-Delta wird an `partialJson` angehängt
- `arguments` werden bei jedem Delta über `parseStreamingJson()` neu geparst
- `toolcall_end` parst noch einmal neu und entfernt dann `partialJson`

## OpenAI Responses (`openai-responses`)

Quelle: `packages/ai/src/providers/openai-responses.ts`

Normalisierungspunkte:

- `response.output_item.added` startet Reasoning-/Text-/Function-Call-Blöcke
- Reasoning-Summary-Events (`response.reasoning_summary_text.delta`) werden zu `thinking_delta`
- Output-/Refusal-Deltas werden zu `text_delta`
- `response.function_call_arguments.delta` wird zu `toolcall_delta`
- `response.output_item.done` emittiert `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` bildet Status auf Stop-Reason und Nutzung ab

Tool-Aufruf-Argument-Streaming:

- Dasselbe `partialJson`-Akkumulationsmuster wie bei Anthropic
- Provider, die nur `response.function_call_arguments.done` senden, befüllen dennoch die finalen Argumente
- Tool-Call-IDs werden als `"<call_id>|<item_id>"` normalisiert

## Google Generative AI (`google-generative-ai`)

Quelle: `packages/ai/src/providers/google.ts`

Normalisierungspunkte:

- Iteriert über `candidate.content.parts`
- Text-Parts werden durch `isThinkingPart(part)` in Thinking vs. Text aufgeteilt
- Block-Übergänge schließen den vorherigen Block, bevor ein neuer gestartet wird
- `part.functionCall` wird als vollständiger Tool-Aufruf behandelt (Start/Delta/End werden sofort emittiert)
- Finish-Reason wird durch `mapStopReason()` aus `google-shared.ts` abgebildet

Tool-Aufruf-Argument-Streaming:

- Function-Call-Argumente kommen als strukturiertes Objekt, nicht als inkrementeller JSON-Text
- Die Implementierung emittiert ein synthetisches `toolcall_delta` mit `JSON.stringify(arguments)`
- Kein partieller JSON-Parser wird für Google in diesem Pfad benötigt

## Partielle Tool-Call-JSON-Akkumulation und -Wiederherstellung

Das gemeinsame Verhalten für Anthropic/OpenAI Responses nutzt `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. Versuch mit `JSON.parse`
2. Fallback auf `partial-json`-Parser für unvollständige Fragmente
3. Wenn beides fehlschlägt, wird `{}` zurückgegeben

Implikationen:

- Fehlerhafte oder abgeschnittene Argument-Deltas führen nicht sofort zum Absturz der Stream-Verarbeitung
- Laufende `arguments` können temporär `{}` sein
- Spätere gültige Deltas können strukturierte Argumente wiederherstellen, da das Parsing bei jedem Anhängen erneut versucht wird
- Das finale `toolcall_end` führt einen letzten Parse-Versuch vor der Emission durch

## Stop-Reasons vs. Transport-/Laufzeitfehler

Provider-Stop-Reasons werden auf normalisierte `stopReason` abgebildet:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, Sicherheits-/Ablehnungsfälle→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, Sicherheits-/Verbots-/fehlerhafte-Function-Call-Klassen→`error`

Die Fehlersemantik ist in zwei Stufen aufgeteilt:

1. **Modell-Completion-Semantik** (vom Provider gemeldeter Finish-Reason/Status)
2. **Transport-/Laufzeitfehler** (Netzwerk-/Client-/Parser-/Abort-Ausnahmen)

Wenn der Provider-Stream eine Exception wirft oder einen Fehler signalisiert, fängt jeder Provider-Wrapper dies ab und emittiert ein terminales `error`-Event mit:

- `stopReason = "aborted"` wenn das Abort-Signal gesetzt ist
- andernfalls `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## Verhalten bei fehlerhaften Chunks / SSE-Parse-Fehlern

Für diese Provider-Pfade wird das Chunk-/SSE-Framing durch Vendor-SDK-Streams behandelt (Anthropic SDK, OpenAI SDK, Google SDK). Dieser Code implementiert hier keinen eigenen SSE-Decoder.

Beobachtetes Verhalten in der aktuellen Implementierung:

- Fehlerhaftes Chunk-/SSE-Parsing auf SDK-Ebene tritt als Exception oder Stream-`error`-Event zutage
- Der Provider-Wrapper konvertiert dies in ein einheitliches terminales `error`-Event
- Kein provider-spezifisches Resume/Retry innerhalb der Stream-Funktion selbst
- Übergeordnete Retries werden in der `AgentSession`-Auto-Retry-Logik behandelt (Retry auf Nachrichtenebene, kein Stream-Chunk-Replay)

## Abbruchgrenzen

Der Abbruch ist mehrschichtig:

- AI-Provider-Request: `options.signal` wird an den Provider-Client-Stream-Aufruf übergeben.
- Provider-Wrapper: Nach der Stream-Schleife erzwingt ein abgebrochenes Signal den Fehlerpfad (`"Request was aborted"`).
- Agent-Loop: Prüft `signal.aborted` vor der Verarbeitung jedes Provider-Events und kann eine abgebrochene Assistenten-Nachricht aus dem letzten Teilstand synthetisieren.
- Session-/Agent-Steuerung: `AgentSession.abort()` -> `agent.abort()` -> gemeinsame Abort-Controller-Abbruch.

Der Abbruch von Tool-Ausführungen ist getrennt vom Modell-Stream-Abbruch:

- Tool-Runner verwenden `AbortSignal.any([agentSignal, steeringAbortSignal])`
- Steering-Unterbrechungen können die verbleibende Tool-Ausführung abbrechen, während bereits erzeugte Tool-Ergebnisse erhalten bleiben

## Backpressure-Grenzen

Es gibt keinen harten Backpressure-Mechanismus zwischen Provider-SDK-Stream und nachgelagerten Konsumenten:

- `EventStream` verwendet In-Memory-Queues ohne maximale Größe
- Drosselung reduziert die UI-Update-Rate, verlangsamt aber nicht die Provider-Aufnahme
- Wenn Konsumenten erheblich hinterherhinken, können sich Queue-Events bis zum Abschluss ansammeln

Das aktuelle Design bevorzugt Reaktionsfähigkeit und einfache Reihenfolge gegenüber begrenzter Puffer-Flusskontrolle.

## Wie Stream-Events als Agent-/Session-Events sichtbar werden

`agentLoop.streamAssistantResponse()` überbrückt `AssistantMessageEvent` zu `AgentEvent`:

- Bei `start`: Fügt eine Platzhalter-Assistenten-Nachricht ein und emittiert `message_start`
- Bei Block-Events (`text_*`, `thinking_*`, `toolcall_*`): Aktualisiert die letzte Assistenten-Nachricht, emittiert `message_update` mit dem rohen `assistantMessageEvent`
- Bei Terminal-Events (`done`/`error`): Löst die finale Nachricht über `response.result()` auf, emittiert `message_end`

`AgentSession` konsumiert diese Events dann für Verhaltensweisen auf Session-Ebene:

- TTSR überwacht `message_update.assistantMessageEvent` auf `text_delta` und `toolcall_delta`
- Die Streaming-Edit-Schutzlogik inspiziert `toolcall_delta`/`toolcall_end` bei `edit`-Aufrufen und kann frühzeitig abbrechen
- Persistierung schreibt finalisierte Nachrichten bei `message_end`
- Auto-Retry prüft `stopReason === "error"` des Assistenten plus `errorMessage`-Heuristiken

## Einheitliche vs. provider-spezifische Verantwortlichkeiten

Einheitlich (gemeinsamer Vertrag):

- Event-Struktur (`AssistantMessageEvent`)
- Finale Ergebnisextraktion (`done`/`error`)
- Delta-Drosselung + Zusammenführungsregeln
- Agent-/Session-Event-Propagationsmodell

Provider-spezifisch (nicht vollständig abstrahiert):

- Upstream-Event-Taxonomien und Abbildungslogik
- Stop-Reason-Übersetzungstabellen
- Tool-Call-ID-Konventionen
- Reasoning-/Thinking-Block-Semantik und Signaturen
- Nutzungs-Token-Semantik und Verfügbarkeitszeitpunkt
- Nachrichtenkonvertierungsbeschränkungen pro API

## Implementierungsdateien

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — Provider-Dispatch, Options-Mapping, API-Key-/Session-Verkabelung.
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — Generische Stream-Queue + Assistenten-Delta-Drosselung.
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — Partielles JSON-Parsing für gestreamte Tool-Argumente.
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — Anthropic-Event-Übersetzung und Tool-JSON-Delta-Akkumulation.
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI-Responses-Event-Übersetzung und Status-Mapping.
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Gemini-Stream-Chunk-zu-Block-Übersetzung.
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Gemini-Finish-Reason-Mapping und gemeinsame Konvertierungsregeln.
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — Provider-Stream-Konsumierung und `message_update`-Überbrückung.
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — Session-Ebene-Behandlung von Streaming-Updates, Abbruch, Retry und Persistierung.
