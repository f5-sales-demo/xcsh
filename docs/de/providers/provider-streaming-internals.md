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

Dieses Dokument erklärt, wie Token-/Tool-Streaming in `@f5xc-salesdemos/pi-ai` normalisiert und anschließend durch `@f5xc-salesdemos/pi-agent-core` und `coding-agent`-Session-Events propagiert wird.

## End-to-End-Ablauf

1. `streamSimple()` (`packages/ai/src/stream.ts`) mappt generische Optionen und leitet an eine Provider-Stream-Funktion weiter.
2. Provider-Stream-Funktionen (`anthropic.ts`, `openai-responses.ts`, `google.ts`) übersetzen provider-native Stream-Events in die einheitliche `AssistantMessageEvent`-Sequenz.
3. Jeder Provider sendet Events in `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`), der Delta-Events drosselt und Folgendes bereitstellt:
   - Asynchrone Iteration für inkrementelle Updates
   - `result()` für die finale `AssistantMessage`
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) konsumiert diese Events, mutiert den laufenden Assistenten-Zustand und emittiert `message_update`-Events, die das rohe `assistantMessageEvent` enthalten.
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) abonniert Agenten-Events, persistiert Nachrichten, steuert Extension-Hooks und wendet Session-Verhaltensweisen an (Retry, Kompaktierung, TTSR, Streaming-Edit-Abbruchprüfungen).

## Einheitlicher Stream-Vertrag in `@f5xc-salesdemos/pi-ai`

Alle Provider emittieren die gleiche Form (`AssistantMessageEvent` in `packages/ai/src/types.ts`):

- `start`
- Content-Block-Lebenszyklus-Triplets:
  - Text: `text_start` → `text_delta`* → `text_end`
  - Denken: `thinking_start` → `thinking_delta`* → `thinking_end`
  - Tool-Aufruf: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- Terminal-Event:
  - `done` mit `reason: "stop" | "length" | "toolUse"`
  - oder `error` mit `reason: "aborted" | "error"`

`AssistantMessageEventStream` garantiert:

- Das finale Ergebnis wird durch das Terminal-Event aufgelöst (`done` oder `error`)
- Deltas werden gebündelt/gedrosselt (~50ms)
- Gepufferte Deltas werden vor Nicht-Delta-Events und vor der Fertigstellung geflusht

## Delta-Drosselung und Harmonisierungsverhalten

`AssistantMessageEventStream` behandelt `text_delta`, `thinking_delta` und `toolcall_delta` als zusammenführbare Events:

- Gepufferte Deltas werden nur zusammengeführt, wenn **Typ + contentIndex** übereinstimmen
- Die Zusammenführung behält den neuesten `partial`-Snapshot
- Nicht-Delta-Events erzwingen sofortiges Flushen

Dies glättet hochfrequente Provider-Streams für TUI/Event-Konsumenten, ist aber kein Provider-Backpressure: Provider produzieren weiterhin mit voller Geschwindigkeit, während der lokale Stream puffert.

## Provider-Normalisierungsdetails

## Anthropic (`anthropic-messages`)

Quelle: `packages/ai/src/providers/anthropic.ts`

Normalisierungspunkte:

- `message_start` initialisiert Usage (Eingabe-/Ausgabe-/Cache-Token)
- `content_block_start` mappt auf Text-/Thinking-/Toolcall-Starts
- `content_block_delta` mappt:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` aktualisiert nur `thinkingSignature` (kein Event)
- `content_block_stop` emittiert das entsprechende `*_end`
- `message_delta.stop_reason` wird über `mapStopReason()` gemappt

Tool-Call-Argument-Streaming:

- Jeder Tool-Block führt intern `partialJson` mit
- Jedes JSON-Delta wird an `partialJson` angehängt
- `arguments` werden bei jedem Delta über `parseStreamingJson()` neu geparst
- `toolcall_end` parst ein weiteres Mal und entfernt dann `partialJson`

## OpenAI Responses (`openai-responses`)

Quelle: `packages/ai/src/providers/openai-responses.ts`

Normalisierungspunkte:

- `response.output_item.added` startet Reasoning-/Text-/Function-Call-Blöcke
- Reasoning-Summary-Events (`response.reasoning_summary_text.delta`) werden zu `thinking_delta`
- Output-/Refusal-Deltas werden zu `text_delta`
- `response.function_call_arguments.delta` wird zu `toolcall_delta`
- `response.output_item.done` emittiert `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` mappt Status auf Stop-Reason und Usage

Tool-Call-Argument-Streaming:

- Gleiches `partialJson`-Akkumulationsmuster wie bei Anthropic
- Provider, die nur `response.function_call_arguments.done` senden, befüllen trotzdem die finalen Args
- Tool-Call-IDs werden als `"<call_id>|<item_id>"` normalisiert

## Google Generative AI (`google-generative-ai`)

Quelle: `packages/ai/src/providers/google.ts`

Normalisierungspunkte:

- Iteriert über `candidate.content.parts`
- Text-Parts werden durch `isThinkingPart(part)` in Thinking vs. Text aufgeteilt
- Block-Übergänge schließen den vorherigen Block, bevor ein neuer gestartet wird
- `part.functionCall` wird als vollständiger Tool-Call behandelt (Start/Delta/End werden sofort emittiert)
- Finish-Reason wird über `mapStopReason()` aus `google-shared.ts` gemappt

Tool-Call-Argument-Streaming:

- Function-Call-Args kommen als strukturiertes Objekt, nicht als inkrementeller JSON-Text
- Die Implementierung emittiert ein synthetisches `toolcall_delta` mit `JSON.stringify(arguments)`
- Kein partieller JSON-Parser für Google in diesem Pfad erforderlich

## Partielle Tool-Call-JSON-Akkumulation und Wiederherstellung

Das gemeinsame Verhalten für Anthropic/OpenAI Responses nutzt `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. Versuch mit `JSON.parse`
2. Fallback auf `partial-json`-Parser für unvollständige Fragmente
3. Falls beides fehlschlägt, Rückgabe von `{}`

Implikationen:

- Fehlerhafte oder abgeschnittene Argument-Deltas lassen die Stream-Verarbeitung nicht sofort abstürzen
- Laufende `arguments` können vorübergehend `{}` sein
- Spätere gültige Deltas können strukturierte Argumente wiederherstellen, da das Parsing bei jedem Anhängen erneut versucht wird
- Das finale `toolcall_end` führt einen weiteren Parse-Versuch vor der Emission durch

## Stop-Reasons vs. Transport-/Laufzeitfehler

Provider-Stop-Reasons werden auf normalisierte `stopReason` gemappt:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, Safety-/Refusal-Fälle→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, Safety-/Prohibited-/Malformed-Function-Call-Klassen→`error`

Die Fehler-Semantik ist in zwei Stufen aufgeteilt:

1. **Modell-Completion-Semantik** (vom Provider gemeldeter Finish-Reason/Status)
2. **Transport-/Laufzeitfehler** (Netzwerk-/Client-/Parser-/Abort-Exceptions)

Wenn der Provider-Stream einen Fehler wirft oder signalisiert, fängt jeder Provider-Wrapper dies ab und emittiert ein terminales `error`-Event mit:

- `stopReason = "aborted"` wenn das Abort-Signal gesetzt ist
- andernfalls `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## Verhalten bei fehlerhaften Chunks / SSE-Parse-Fehlern

Für diese Provider-Pfade wird das Chunk-/SSE-Framing von den Vendor-SDK-Streams (Anthropic SDK, OpenAI SDK, Google SDK) behandelt. Dieser Code implementiert hier keinen eigenen SSE-Decoder.

Beobachtetes Verhalten in der aktuellen Implementierung:

- Fehlerhaftes Chunk-/SSE-Parsing auf SDK-Ebene tritt als Exception oder Stream-`error`-Event auf
- Der Provider-Wrapper konvertiert dies in ein einheitliches terminales `error`-Event
- Kein provider-spezifisches Resume/Retry innerhalb der Stream-Funktion selbst
- Höherstufige Retries werden in der `AgentSession`-Auto-Retry-Logik behandelt (Retry auf Nachrichtenebene, kein Stream-Chunk-Replay)

## Abbruchgrenzen

Abbruch ist geschichtet:

- AI-Provider-Request: `options.signal` wird an den Provider-Client-Stream-Aufruf übergeben.
- Provider-Wrapper: Nach der Stream-Schleife erzwingt ein abgebrochenes Signal den Fehlerpfad (`"Request was aborted"`).
- Agent-Loop: Prüft `signal.aborted` vor der Verarbeitung jedes Provider-Events und kann eine abgebrochene Assistenten-Nachricht aus dem letzten Partial synthetisieren.
- Session-/Agenten-Steuerung: `AgentSession.abort()` -> `agent.abort()` -> gemeinsame Abort-Controller-Abbruch.

Tool-Ausführungsabbruch ist separat vom Modell-Stream-Abbruch:

- Tool-Runner verwenden `AbortSignal.any([agentSignal, steeringAbortSignal])`
- Steering-Interrupts können die verbleibende Tool-Ausführung abbrechen und dabei bereits produzierte Tool-Ergebnisse beibehalten

## Backpressure-Grenzen

Es gibt keinen harten Backpressure-Mechanismus zwischen Provider-SDK-Stream und nachgelagerten Konsumenten:

- `EventStream` verwendet In-Memory-Queues ohne Maximalgröße
- Drosselung reduziert die UI-Update-Rate, verlangsamt aber nicht die Provider-Aufnahme
- Wenn Konsumenten erheblich hinterherhinken, können sich die Events in der Queue bis zur Fertigstellung ansammeln

Das aktuelle Design bevorzugt Reaktionsfähigkeit und einfache Reihenfolge gegenüber begrenzter Pufferflusssteuerung.

## Wie Stream-Events als Agenten-/Session-Events erscheinen

`agentLoop.streamAssistantResponse()` verbindet `AssistantMessageEvent` mit `AgentEvent`:

- Bei `start`: Fügt eine Platzhalter-Assistenten-Nachricht ein und emittiert `message_start`
- Bei Block-Events (`text_*`, `thinking_*`, `toolcall_*`): Aktualisiert die letzte Assistenten-Nachricht, emittiert `message_update` mit rohem `assistantMessageEvent`
- Bei Terminal (`done`/`error`): Löst die finale Nachricht aus `response.result()` auf, emittiert `message_end`

`AgentSession` konsumiert dann diese Events für Session-Level-Verhaltensweisen:

- TTSR überwacht `message_update.assistantMessageEvent` auf `text_delta` und `toolcall_delta`
- Der Streaming-Edit-Guard inspiziert `toolcall_delta`/`toolcall_end` bei `edit`-Aufrufen und kann frühzeitig abbrechen
- Persistierung schreibt finalisierte Nachrichten bei `message_end`
- Auto-Retry prüft Assistenten-`stopReason === "error"` plus `errorMessage`-Heuristiken

## Einheitliche vs. provider-spezifische Verantwortlichkeiten

Einheitlich (gemeinsamer Vertrag):

- Event-Form (`AssistantMessageEvent`)
- Finale Ergebnis-Extraktion (`done`/`error`)
- Delta-Drosselung + Zusammenführungsregeln
- Agenten-/Session-Event-Propagationsmodell

Provider-spezifisch (nicht vollständig abstrahiert):

- Upstream-Event-Taxonomien und Mapping-Logik
- Stop-Reason-Übersetzungstabellen
- Tool-Call-ID-Konventionen
- Reasoning-/Thinking-Block-Semantik und Signaturen
- Usage-Token-Semantik und Verfügbarkeitszeitpunkt
- Nachrichtenkonvertierungsbeschränkungen pro API

## Implementierungsdateien

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — Provider-Dispatch, Options-Mapping, API-Key-/Session-Plumbing.
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — Generische Stream-Queue + Assistenten-Delta-Drosselung.
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — Partielles JSON-Parsing für gestreamte Tool-Argumente.
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — Anthropic-Event-Übersetzung und Tool-JSON-Delta-Akkumulation.
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI-Responses-Event-Übersetzung und Status-Mapping.
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Gemini-Stream-Chunk-zu-Block-Übersetzung.
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Gemini-Finish-Reason-Mapping und gemeinsame Konvertierungsregeln.
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — Provider-Stream-Konsumierung und `message_update`-Bridging.
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — Session-Level-Behandlung von Streaming-Updates, Abbruch, Retry und Persistierung.
