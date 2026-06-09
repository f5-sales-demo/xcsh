---
title: Interne Mechanismen des Provider-Streamings
description: >-
  Implementierung des Provider-Streamings mit SSE-Parsing, Token-Zählung und
  Backpressure-Behandlung.
sidebar:
  order: 2
  label: Interne Streaming-Mechanismen
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# Interne Mechanismen des Provider-Streamings

Dieses Dokument erläutert, wie Token-/Tool-Streaming in `@f5xc-salesdemos/pi-ai` normalisiert und anschließend über `@f5xc-salesdemos/pi-agent-core` und `coding-agent`-Session-Events propagiert wird.

## End-to-End-Ablauf

1. `streamSimple()` (`packages/ai/src/stream.ts`) bildet generische Optionen ab und delegiert an eine Provider-Stream-Funktion.
2. Provider-Stream-Funktionen (`anthropic.ts`, `openai-responses.ts`, `google.ts`) übersetzen provider-native Stream-Events in die einheitliche `AssistantMessageEvent`-Sequenz.
3. Jeder Provider sendet Events in `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`), der Delta-Events drosselt und Folgendes bereitstellt:
   - Asynchrone Iteration für inkrementelle Updates
   - `result()` für die finale `AssistantMessage`
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) konsumiert diese Events, mutiert den laufenden Assistenten-Zustand und emittiert `message_update`-Events, die das rohe `assistantMessageEvent` enthalten.
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) abonniert Agenten-Events, persistiert Nachrichten, steuert Extension-Hooks und wendet Session-Verhaltensweisen an (Wiederholung, Kompaktierung, TTSR, Streaming-Edit-Abbruchprüfungen).

## Einheitlicher Stream-Vertrag in `@f5xc-salesdemos/pi-ai`

Alle Provider emittieren die gleiche Struktur (`AssistantMessageEvent` in `packages/ai/src/types.ts`):

- `start`
- Content-Block-Lebenszyklus-Triplets:
  - Text: `text_start` → `text_delta`* → `text_end`
  - Denken: `thinking_start` → `thinking_delta`* → `thinking_end`
  - Tool-Aufruf: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- Terminales Event:
  - `done` mit `reason: "stop" | "length" | "toolUse"`
  - oder `error` mit `reason: "aborted" | "error"`

`AssistantMessageEventStream` garantiert:

- Das finale Ergebnis wird durch ein terminales Event (`done` oder `error`) aufgelöst
- Deltas werden gebündelt/gedrosselt (~50ms)
- Gepufferte Deltas werden vor Nicht-Delta-Events und vor dem Abschluss geflusht

## Delta-Drosselung und Harmonisierungsverhalten

`AssistantMessageEventStream` behandelt `text_delta`, `thinking_delta` und `toolcall_delta` als zusammenführbare Events:

- Gepufferte Deltas werden nur zusammengeführt, wenn **Typ + contentIndex** übereinstimmen
- Die Zusammenführung behält den neuesten `partial`-Snapshot bei
- Nicht-Delta-Events erzwingen sofortiges Flushen

Dies glättet hochfrequente Provider-Streams für TUI-/Event-Konsumenten, ist aber kein Provider-Backpressure: Provider produzieren weiterhin mit voller Geschwindigkeit, während der lokale Stream puffert.

## Details zur Provider-Normalisierung

## Anthropic (`anthropic-messages`)

Quelle: `packages/ai/src/providers/anthropic.ts`

Normalisierungspunkte:

- `message_start` initialisiert die Nutzung (Input-/Output-/Cache-Tokens)
- `content_block_start` wird auf Text-/Denk-/Toolcall-Starts abgebildet
- `content_block_delta` bildet ab:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` aktualisiert nur `thinkingSignature` (kein Event)
- `content_block_stop` emittiert das entsprechende `*_end`
- `message_delta.stop_reason` wird über `mapStopReason()` abgebildet

Tool-Aufruf-Argument-Streaming:

- Jeder Tool-Block führt internes `partialJson` mit
- Jedes JSON-Delta wird an `partialJson` angehängt
- `arguments` werden bei jedem Delta über `parseStreamingJson()` neu geparst
- `toolcall_end` parst ein weiteres Mal und entfernt dann `partialJson`

## OpenAI Responses (`openai-responses`)

Quelle: `packages/ai/src/providers/openai-responses.ts`

Normalisierungspunkte:

- `response.output_item.added` startet Reasoning-/Text-/Funktionsaufruf-Blöcke
- Reasoning-Summary-Events (`response.reasoning_summary_text.delta`) werden zu `thinking_delta`
- Output-/Refusal-Deltas werden zu `text_delta`
- `response.function_call_arguments.delta` wird zu `toolcall_delta`
- `response.output_item.done` emittiert `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` bildet den Status auf Stopp-Grund und Nutzung ab

Tool-Aufruf-Argument-Streaming:

- Gleiches `partialJson`-Akkumulationsmuster wie bei Anthropic
- Provider, die nur `response.function_call_arguments.done` senden, befüllen dennoch die finalen Argumente
- Tool-Aufruf-IDs werden als `"<call_id>|<item_id>"` normalisiert

## Google Generative AI (`google-generative-ai`)

Quelle: `packages/ai/src/providers/google.ts`

Normalisierungspunkte:

- Iteriert über `candidate.content.parts`
- Text-Teile werden durch `isThinkingPart(part)` in Denken vs. Text aufgeteilt
- Block-Übergänge schließen den vorherigen Block, bevor ein neuer gestartet wird
- `part.functionCall` wird als vollständiger Tool-Aufruf behandelt (Start/Delta/End werden sofort emittiert)
- Abschlussgrund wird über `mapStopReason()` aus `google-shared.ts` abgebildet

Tool-Aufruf-Argument-Streaming:

- Funktionsaufruf-Argumente kommen als strukturiertes Objekt an, nicht als inkrementeller JSON-Text
- Die Implementierung emittiert ein synthetisches `toolcall_delta` mit `JSON.stringify(arguments)`
- Kein partieller JSON-Parser für Google in diesem Pfad erforderlich

## Partielle Tool-Aufruf-JSON-Akkumulation und -Wiederherstellung

Das gemeinsame Verhalten für Anthropic/OpenAI Responses verwendet `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. Versuche `JSON.parse`
2. Fallback auf `partial-json`-Parser für unvollständige Fragmente
3. Wenn beides fehlschlägt, gib `{}` zurück

Implikationen:

- Fehlerhafte oder abgeschnittene Argument-Deltas führen nicht sofort zum Absturz der Stream-Verarbeitung
- Laufende `arguments` können vorübergehend `{}` sein
- Spätere gültige Deltas können strukturierte Argumente wiederherstellen, da das Parsing bei jedem Anhängen wiederholt wird
- Das finale `toolcall_end` führt einen weiteren Parse-Versuch vor der Emission durch

## Stopp-Gründe vs. Transport-/Laufzeitfehler

Provider-Stopp-Gründe werden auf normalisierte `stopReason` abgebildet:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, Sicherheits-/Verweigerungsfälle→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, Sicherheits-/Verbots-/Fehlerhafte-Funktionsaufruf-Klassen→`error`

Fehlersemantik ist in zwei Stufen aufgeteilt:

1. **Modell-Completion-Semantik** (vom Provider gemeldeter Abschlussgrund/-status)
2. **Transport-/Laufzeitfehler** (Netzwerk-/Client-/Parser-/Abbruch-Ausnahmen)

Wenn der Provider-Stream einen Fehler wirft oder einen Fehler signalisiert, fängt jeder Provider-Wrapper dies ab und emittiert ein terminales `error`-Event mit:

- `stopReason = "aborted"` wenn das Abbruch-Signal gesetzt ist
- andernfalls `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## Verhalten bei fehlerhaften Chunks / SSE-Parse-Fehlern

Für diese Provider-Pfade wird das Chunk-/SSE-Framing von den Vendor-SDK-Streams (Anthropic SDK, OpenAI SDK, Google SDK) gehandhabt. Dieser Code implementiert hier keinen eigenen SSE-Decoder.

Beobachtetes Verhalten in der aktuellen Implementierung:

- Fehlerhaftes Chunk-/SSE-Parsing auf SDK-Ebene manifestiert sich als Ausnahme oder Stream-`error`-Event
- Der Provider-Wrapper konvertiert dies in ein einheitliches terminales `error`-Event
- Kein provider-spezifisches Resume/Retry innerhalb der Stream-Funktion selbst
- Wiederholungen auf höherer Ebene werden in der Auto-Retry-Logik von `AgentSession` behandelt (Wiederholung auf Nachrichtenebene, kein Stream-Chunk-Replay)

## Abbruchgrenzen

Abbruch ist mehrschichtig:

- KI-Provider-Anfrage: `options.signal` wird an den Provider-Client-Stream-Aufruf übergeben.
- Provider-Wrapper: Nach der Stream-Schleife erzwingt ein abgebrochenes Signal den Fehlerpfad (`"Request was aborted"`).
- Agenten-Schleife: Prüft `signal.aborted` vor der Verarbeitung jedes Provider-Events und kann eine abgebrochene Assistenten-Nachricht aus dem neuesten Teilzustand synthetisieren.
- Session-/Agenten-Steuerung: `AgentSession.abort()` -> `agent.abort()` -> gemeinsame AbortController-Abbruchkette.

Tool-Ausführungsabbruch ist getrennt vom Modell-Stream-Abbruch:

- Tool-Runner verwenden `AbortSignal.any([agentSignal, steeringAbortSignal])`
- Steering-Unterbrechungen können die verbleibende Tool-Ausführung abbrechen, während bereits erzeugte Tool-Ergebnisse erhalten bleiben

## Backpressure-Grenzen

Es gibt keinen harten Backpressure-Mechanismus zwischen Provider-SDK-Stream und nachgelagerten Konsumenten:

- `EventStream` verwendet In-Memory-Warteschlangen ohne maximale Größe
- Drosselung reduziert die UI-Aktualisierungsrate, verlangsamt aber nicht die Provider-Aufnahme
- Wenn Konsumenten erheblich hinterherhinken, können sich wartende Events bis zum Abschluss ansammeln

Das aktuelle Design bevorzugt Reaktionsfähigkeit und einfache Reihenfolge gegenüber begrenzter Puffer-Flusskontrolle.

## Wie Stream-Events als Agenten-/Session-Events erscheinen

`agentLoop.streamAssistantResponse()` verbindet `AssistantMessageEvent` mit `AgentEvent`:

- Bei `start`: Fügt eine Platzhalter-Assistenten-Nachricht ein und emittiert `message_start`
- Bei Block-Events (`text_*`, `thinking_*`, `toolcall_*`): Aktualisiert die letzte Assistenten-Nachricht, emittiert `message_update` mit rohem `assistantMessageEvent`
- Bei Terminal-Events (`done`/`error`): Löst die finale Nachricht über `response.result()` auf, emittiert `message_end`

`AgentSession` konsumiert dann diese Events für Verhaltensweisen auf Session-Ebene:

- TTSR überwacht `message_update.assistantMessageEvent` auf `text_delta` und `toolcall_delta`
- Der Streaming-Edit-Guard prüft `toolcall_delta`/`toolcall_end` bei `edit`-Aufrufen und kann frühzeitig abbrechen
- Persistierung schreibt finalisierte Nachrichten bei `message_end`
- Auto-Retry untersucht den Assistenten-`stopReason === "error"` plus `errorMessage`-Heuristiken

## Einheitliche vs. provider-spezifische Verantwortlichkeiten

Einheitlich (gemeinsamer Vertrag):

- Event-Struktur (`AssistantMessageEvent`)
- Finale Ergebnisextraktion (`done`/`error`)
- Delta-Drosselung + Zusammenführungsregeln
- Agenten-/Session-Event-Propagationsmodell

Provider-spezifisch (nicht vollständig abstrahiert):

- Upstream-Event-Taxonomien und Abbildungslogik
- Stopp-Grund-Übersetzungstabellen
- Tool-Aufruf-ID-Konventionen
- Reasoning-/Denk-Block-Semantik und Signaturen
- Nutzungs-Token-Semantik und Verfügbarkeitszeitpunkt
- Nachrichtenkonvertierungsbeschränkungen pro API

## Implementierungsdateien

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — Provider-Dispatch, Options-Mapping, API-Key-/Session-Verdrahtung.
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — Generische Stream-Warteschlange + Assistenten-Delta-Drosselung.
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — Partielles JSON-Parsing für gestreamte Tool-Argumente.
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — Anthropic-Event-Übersetzung und Tool-JSON-Delta-Akkumulation.
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI-Responses-Event-Übersetzung und Status-Mapping.
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Gemini-Stream-Chunk-zu-Block-Übersetzung.
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Gemini-Abschlussgrund-Mapping und gemeinsame Konvertierungsregeln.
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — Provider-Stream-Konsum und `message_update`-Brücke.
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — Behandlung von Streaming-Updates, Abbruch, Wiederholung und Persistierung auf Session-Ebene.
