---
title: Interna des Provider-Streamings
description: >-
  Implementierung des Provider-Streamings mit SSE-Parsing, Token-Zählung und
  Backpressure-Behandlung.
sidebar:
  order: 2
  label: Streaming-Interna
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# Interna des Provider-Streamings

Dieses Dokument erläutert, wie Token-/Werkzeug-Streaming in `@f5xc-salesdemos/pi-ai` normalisiert und anschließend über `@f5xc-salesdemos/pi-agent-core` und `coding-agent`-Sitzungsereignisse weitergeleitet wird.

## Ende-zu-Ende-Ablauf

1. `streamSimple()` (`packages/ai/src/stream.ts`) ordnet generische Optionen zu und leitet an eine Provider-Stream-Funktion weiter.
2. Provider-Stream-Funktionen (`anthropic.ts`, `openai-responses.ts`, `google.ts`) übersetzen providernative Stream-Ereignisse in die einheitliche `AssistantMessageEvent`-Sequenz.
3. Jeder Provider schiebt Ereignisse in `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`), das Delta-Ereignisse drosselt und Folgendes bereitstellt:
   - Asynchrone Iteration für inkrementelle Aktualisierungen
   - `result()` für das abschließende `AssistantMessage`
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) verarbeitet diese Ereignisse, mutiert den laufenden Assistentenzustand und gibt `message_update`-Ereignisse aus, die das rohe `assistantMessageEvent` tragen.
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) abonniert Agentenereignisse, persistiert Nachrichten, steuert Erweiterungshooks und wendet Sitzungsverhalten an (Wiederholung, Kompaktierung, TTSR, Abbruchprüfungen beim Streaming-Edit).

## Einheitlicher Stream-Vertrag in `@f5xc-salesdemos/pi-ai`

Alle Provider geben dieselbe Form aus (`AssistantMessageEvent` in `packages/ai/src/types.ts`):

- `start`
- Lebenszyklus-Triplets für Inhaltsblöcke:
  - Text: `text_start` → `text_delta`* → `text_end`
  - Denken: `thinking_start` → `thinking_delta`* → `thinking_end`
  - Werkzeugaufruf: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- Abschlussereignis:
  - `done` mit `reason: "stop" | "length" | "toolUse"`
  - oder `error` mit `reason: "aborted" | "error"`

`AssistantMessageEventStream` garantiert:

- Das Abschlussergebnis wird durch das terminale Ereignis (`done` oder `error`) aufgelöst
- Deltas werden gebündelt/gedrosselt (~50ms)
- Gepufferte Deltas werden vor Nicht-Delta-Ereignissen und vor dem Abschluss ausgeleert

## Delta-Drosselung und Harmonisierungsverhalten

`AssistantMessageEventStream` behandelt `text_delta`, `thinking_delta` und `toolcall_delta` als zusammenführbare Ereignisse:

- Gepufferte Deltas werden nur zusammengeführt, wenn **type + contentIndex** übereinstimmen
- Die Zusammenführung behält den neuesten `partial`-Schnappschuss
- Nicht-Delta-Ereignisse erzwingen sofortiges Leeren des Puffers

Dies glättet hochfrequente Provider-Streams für TUI-/Ereignis-Verbraucher, stellt jedoch keine Provider-Backpressure dar: Provider erzeugen weiterhin mit voller Geschwindigkeit, während der lokale Stream puffert.

## Normalisierungsdetails der Provider

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

Streaming von Werkzeugaufruf-Argumenten:

- Jeder Werkzeugblock trägt internes `partialJson`
- Jedes JSON-Delta wird an `partialJson` angehängt
- `arguments` werden bei jedem Delta über `parseStreamingJson()` neu geparst
- `toolcall_end` führt einmal mehr einen Parse-Versuch durch und entfernt dann `partialJson`

## OpenAI Responses (`openai-responses`)

Quelle: `packages/ai/src/providers/openai-responses.ts`

Normalisierungspunkte:

- `response.output_item.added` startet Reasoning-/Text-/Funktionsaufruf-Blöcke
- Reasoning-Summary-Ereignisse (`response.reasoning_summary_text.delta`) werden zu `thinking_delta`
- Ausgabe-/Verweigerungs-Deltas werden zu `text_delta`
- `response.function_call_arguments.delta` wird zu `toolcall_delta`
- `response.output_item.done` gibt `thinking_end` / `text_end` / `toolcall_end` aus
- `response.completed` bildet den Status auf den Stoppgrund und die Nutzung ab

Streaming von Werkzeugaufruf-Argumenten:

- Dasselbe `partialJson`-Akkumulierungsmuster wie bei Anthropic
- Provider, die nur `response.function_call_arguments.done` senden, befüllen dennoch die abschließenden Argumente
- Werkzeugaufruf-IDs werden als `"<call_id>|<item_id>"` normalisiert

## Google Generative AI (`google-generative-ai`)

Quelle: `packages/ai/src/providers/google.ts`

Normalisierungspunkte:

- Iteriert über `candidate.content.parts`
- Textteile werden durch `isThinkingPart(part)` in Denken vs. Text aufgeteilt
- Blockübergänge schließen den vorherigen Block vor dem Start eines neuen
- `part.functionCall` wird als vollständiger Werkzeugaufruf behandelt (Start/Delta/Ende werden sofort ausgegeben)
- Der Abschlussgrund wird durch `mapStopReason()` aus `google-shared.ts` abgebildet

Streaming von Werkzeugaufruf-Argumenten:

- Funktionsaufruf-Argumente kommen als strukturiertes Objekt an, nicht als inkrementeller JSON-Text
- Die Implementierung gibt ein synthetisches `toolcall_delta` aus, das `JSON.stringify(arguments)` enthält
- Kein partieller JSON-Parser für Google in diesem Pfad erforderlich

## Partielle Werkzeugaufruf-JSON-Akkumulierung und Wiederherstellung

Gemeinsames Verhalten für Anthropic/OpenAI Responses verwendet `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. Versuch mit `JSON.parse`
2. Fallback auf den `partial-json`-Parser für unvollständige Fragmente
3. Wenn beides fehlschlägt, wird `{}` zurückgegeben

Auswirkungen:

- Fehlerhafte oder abgeschnittene Argument-Deltas führen nicht sofort zum Absturz der Stream-Verarbeitung
- `arguments` im Gange können vorübergehend `{}` sein
- Spätere gültige Deltas können strukturierte Argumente wiederherstellen, da das Parsing bei jedem Anhängen erneut versucht wird
- Das abschließende `toolcall_end` führt vor der Ausgabe einen weiteren Parse-Versuch durch

## Stoppgründe vs. Transport-/Laufzeitfehler

Provider-Stoppgründe werden auf den normalisierten `stopReason` abgebildet:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, Sicherheits-/Verweigerungsfälle→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, Sicherheits-/Verbots-/fehlerhafte-Funktionsaufruf-Klassen→`error`

Fehlersemantik ist in zwei Stufen aufgeteilt:

1. **Modell-Abschlusssemantik** (vom Provider gemeldeter Abschlussgrund/Status)
2. **Transport-/Laufzeitfehler** (Netzwerk-/Client-/Parser-/Abbruchausnahmen)

Wenn der Provider-Stream auslöst oder einen Fehler signalisiert, fängt jeder Provider-Wrapper diesen ab und gibt ein terminales `error`-Ereignis aus mit:

- `stopReason = "aborted"` wenn das Abbruchsignal gesetzt ist
- andernfalls `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## Verhalten bei fehlerhaften Chunks / SSE-Parse-Fehlern

Für diese Provider-Pfade wird die Chunk-/SSE-Rahmung durch Vendor-SDK-Streams gehandhabt (Anthropic SDK, OpenAI SDK, Google SDK). Dieser Code implementiert hier keinen eigenen SSE-Decoder.

Beobachtetes Verhalten in der aktuellen Implementierung:

- Fehlerhaftes Chunk-/SSE-Parsing auf SDK-Ebene tritt als Ausnahme oder Stream-`error`-Ereignis auf
- Der Provider-Wrapper konvertiert dies in ein einheitliches terminales `error`-Ereignis
- Kein providerspezifisches Fortsetzen/Wiederholen innerhalb der Stream-Funktion selbst
- Wiederholungen auf höherer Ebene werden in der Auto-Retry-Logik von `AgentSession` gehandhabt (Wiederholung auf Nachrichtenebene, kein Stream-Chunk-Replay)

## Abbruchgrenzen

Der Abbruch ist in Schichten aufgebaut:

- KI-Provider-Anfrage: `options.signal` wird an den Provider-Client-Stream-Aufruf übergeben.
- Provider-Wrapper: Nach der Stream-Schleife erzwingt ein abgebrochenes Signal den Fehlerpfad (`"Request was aborted"`).
- Agent-Loop: Prüft `signal.aborted` vor der Verarbeitung jedes Provider-Ereignisses und kann eine abgebrochene Assistentennachricht aus dem neuesten Partial synthetisieren.
- Sitzungs-/Agenten-Steuerung: `AgentSession.abort()` -> `agent.abort()` -> Abbruch des gemeinsamen Abort-Controllers.

Der Abbruch der Werkzeugausführung ist vom Abbruch des Modell-Streams getrennt:

- Werkzeug-Runner verwenden `AbortSignal.any([agentSignal, steeringAbortSignal])`
- Steuerungsunterbrechungen können die verbleibende Werkzeugausführung abbrechen, während bereits erzeugte Werkzeugergebnisse erhalten bleiben

## Backpressure-Grenzen

Es gibt keinen harten Backpressure-Mechanismus zwischen dem Provider-SDK-Stream und nachgelagerten Verbrauchern:

- `EventStream` verwendet In-Memory-Warteschlangen ohne maximale Größe
- Drosselung reduziert die UI-Aktualisierungsrate, verlangsamt jedoch nicht die Provider-Aufnahme
- Wenn Verbraucher erheblich zurückfallen, können sich eingereihte Ereignisse bis zum Abschluss anhäufen

Das aktuelle Design bevorzugt Reaktionsfähigkeit und einfache Reihenfolge gegenüber einer Flusskontrolle mit begrenztem Puffer.

## Wie Stream-Ereignisse als Agenten-/Sitzungsereignisse erscheinen

`agentLoop.streamAssistantResponse()` überbrückt `AssistantMessageEvent` zu `AgentEvent`:

- Bei `start`: Schiebt eine Platzhalter-Assistentennachricht und gibt `message_start` aus
- Bei Block-Ereignissen (`text_*`, `thinking_*`, `toolcall_*`): Aktualisiert die letzte Assistentennachricht, gibt `message_update` mit rohem `assistantMessageEvent` aus
- Bei Terminal-Ereignis (`done`/`error`): Löst die abschließende Nachricht aus `response.result()` auf, gibt `message_end` aus

`AgentSession` verarbeitet diese Ereignisse dann für Verhaltensweisen auf Sitzungsebene:

- TTSR überwacht `message_update.assistantMessageEvent` auf `text_delta` und `toolcall_delta`
- Die Streaming-Edit-Schutzfunktion prüft `toolcall_delta`/`toolcall_end` bei `edit`-Aufrufen und kann frühzeitig abbrechen
- Persistenz schreibt abgeschlossene Nachrichten bei `message_end`
- Auto-Retry prüft `stopReason === "error"` des Assistenten zusammen mit `errorMessage`-Heuristiken

## Einheitliche vs. providerspezifische Zuständigkeiten

Einheitlich (gemeinsamer Vertrag):

- Ereignisform (`AssistantMessageEvent`)
- Extraktion des Abschlussergebnisses (`done`/`error`)
- Delta-Drosselung und Zusammenführungsregeln
- Weiterleitungsmodell für Agenten-/Sitzungsereignisse

Providerspezifisch (nicht vollständig abstrahiert):

- Taxonomien und Abbildungslogik für vorgelagerte Ereignisse
- Übersetzungstabellen für Stoppgründe
- Konventionen für Werkzeugaufruf-IDs
- Semantik und Signaturen von Reasoning-/Denk-Blöcken
- Token-Nutzungssemantik und Verfügbarkeitszeitpunkt
- Einschränkungen bei der Nachrichtenkonvertierung pro API

## Implementierungsdateien

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — Provider-Dispatch, Optionszuordnung, API-Schlüssel-/Sitzungseinrichtung.
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — Generische Stream-Warteschlange und Assistenten-Delta-Drosselung.
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — Partielles JSON-Parsing für gestreamte Werkzeugargumente.
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — Anthropic-Ereignisübersetzung und Werkzeug-JSON-Delta-Akkumulierung.
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI-Responses-Ereignisübersetzung und Statuszuordnung.
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Übersetzung von Gemini-Stream-Chunks in Blöcke.
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Gemini-Abschlussgrund-Zuordnung und gemeinsame Konvertierungsregeln.
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — Verarbeitung des Provider-Streams und Überbrückung von `message_update`.
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — Behandlung von Streaming-Aktualisierungen, Abbruch, Wiederholung und Persistenz auf Sitzungsebene.
