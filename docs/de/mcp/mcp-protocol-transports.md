---
title: MCP-Protokoll und Transport-Interna
description: >-
  MCP-Protokollimplementierung mit stdio-, SSE- und
  Streamable-HTTP-Transportschichten.
sidebar:
  order: 2
  label: Protokoll & Transporte
i18n:
  sourceHash: 48632064dd00
  translator: machine
---

# MCP-Protokoll und Transport-Interna

Dieses Dokument beschreibt, wie coding-agent MCP-JSON-RPC-Messaging implementiert und wie Protokollbelange von Transportbelangen getrennt werden.

## Geltungsbereich

Behandelt:

- JSON-RPC-Request/Response- und Notification-Ablauf
- Request-Korrelation und Lebenszyklus für stdio- und HTTP/SSE-Transporte
- Timeout- und Abbruchverhalten
- Fehlerweitergabe und Behandlung fehlerhafter Payloads
- Transportauswahl-Grenzen (`stdio` vs `http`/`sse`)
- Welche Reconnect-/Retry-Verantwortlichkeiten auf Transport-Ebene vs. Manager-Ebene liegen

Behandelt nicht die Extension-Authoring-UX oder die Befehlsoberfläche.

## Implementierungsdateien

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/transports/stdio.ts`](../../packages/coding-agent/src/mcp/transports/stdio.ts)
- [`src/mcp/transports/http.ts`](../../packages/coding-agent/src/mcp/transports/http.ts)
- [`src/mcp/transports/index.ts`](../../packages/coding-agent/src/mcp/transports/index.ts)
- [`src/mcp/json-rpc.ts`](../../packages/coding-agent/src/mcp/json-rpc.ts)
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)

## Schichtgrenzen

### Protokollschicht (JSON-RPC + MCP-Methoden)

- Nachrichtenstrukturen sind in `types.ts` definiert (`JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcResponse`, `JsonRpcMessage`).
- Die MCP-Client-Logik (`client.ts`) bestimmt die Methodenreihenfolge und den Session-Handshake:
  1. `initialize`-Request
  2. `notifications/initialized`-Notification
  3. Methodenaufrufe wie `tools/list`, `tools/call`

### Transportschicht (`MCPTransport`)

`MCPTransport` abstrahiert Zustellung und Lebenszyklus:

- `request(method, params, options?) -> Promise<T>`
- `notify(method, params?) -> Promise<void>`
- `close()`
- `connected`
- Optionale Callbacks: `onClose`, `onError`, `onNotification`

Transport-Implementierungen verwalten Framing- und I/O-Details:

- `StdioTransport`: Newline-delimitiertes JSON über Subprocess-stdio
- `HttpTransport`: JSON-RPC über HTTP POST, mit optionalen SSE-Responses/Listening

### Wichtiger aktueller Vorbehalt

Transport-Callbacks (`onClose`, `onError`, `onNotification`) sind implementiert, aber die aktuellen `MCPClient`/`MCPManager`-Abläufe verdrahten keine Reconnection-Logik mit diesen Callbacks. Notifications werden nur konsumiert, wenn der Aufrufer Handler registriert.

## Transportauswahl

`client.ts:createTransport()` wählt den Transport basierend auf der Konfiguration:

- `type` weggelassen oder `"stdio"` -> `createStdioTransport`
- `"http"` oder `"sse"` -> `createHttpTransport`

`"sse"` wird als HTTP-Transport-Variante behandelt (gleiche Klasse), nicht als separate Transport-Implementierung.

## JSON-RPC-Nachrichtenfluss und Korrelation

## Request-IDs

Jeder Transport generiert pro Request IDs (`Math.random` + Timestamp-String). IDs sind transport-lokale Korrelations-Token.

## Stdio-Korrelationspfad

- Ausgehende Requests werden als ein JSON-Objekt + `\n` serialisiert.
- `#pendingRequests: Map<id, {resolve,reject}>` speichert laufende Requests.
- Die Lese-Schleife parst JSONL von stdout und ruft `#handleMessage` auf.
- Wenn eine eingehende Nachricht eine passende `id` hat, wird der Request aufgelöst/abgelehnt.
- Wenn eine eingehende Nachricht `method` hat und keine `id`, wird sie als Notification behandelt und an `onNotification` gesendet.

Unbekannte IDs werden ignoriert (keine Ablehnung, kein Error-Callback).

## HTTP-Korrelationspfad

- Ausgehender Request ist ein HTTP `POST` mit JSON-Body und generierter `id`.
- Nicht-SSE-Response-Pfad: Eine JSON-RPC-Response parsen und `result` zurückgeben / bei `error` werfen.
- SSE-Response-Pfad (`Content-Type: text/event-stream`): Events streamen, erste Nachricht zurückgeben, deren `id` der erwarteten Request-ID entspricht und `result` oder `error` enthält.
- SSE-Nachrichten mit `method` und ohne `id` werden als Notifications behandelt.

Wenn der SSE-Stream vor einer passenden Response endet, schlägt der Request fehl mit `No response received for request ID ...`.

## Notifications

Der Client sendet JSON-RPC-Notifications über `transport.notify(...)`.

- Stdio: Schreibt den Notification-Frame auf stdin (`jsonrpc`, `method`, optionale `params`) plus Newline.
- HTTP: Sendet POST-Body ohne `id`; Erfolg akzeptiert `2xx` oder `202 Accepted`.

Server-initiierte Notifications werden nur über den Transport-`onNotification`-Callback verfügbar gemacht; es gibt keinen globalen Standard-Subscriber im Manager/Client.

## Stdio-Transport-Interna

## Lebenszyklus und Zustandsübergänge

- Initial: `connected=false`, `process=null`, Pending-Map leer
- `connect()`:
  - Subprocess mit konfiguriertem Command/Args/Env/Cwd starten
  - Als verbunden markieren
  - Stdout-Lese-Schleife starten (`readJsonl`)
  - Stderr-Schleife starten (lesen/verwerfen; derzeit lautlos)
- `close()`:
  - Als getrennt markieren
  - Alle ausstehenden Requests ablehnen (`Transport closed`)
  - Subprocess beenden
  - Auf Shutdown der Lese-Schleife warten
  - `onClose` auslösen

Wenn die Lese-Schleife unerwartet endet, löst `finally` `#handleClose()` aus, das die gleiche Ablehnung ausstehender Requests und den Close-Callback durchführt.

## Timeout und Abbruch

Pro Request:

- Timeout standardmäßig `config.timeout ?? 30000`
- Optionales `AbortSignal` vom Aufrufer
- Abbruch und Timeout lehnen beide das ausstehende Promise ab und bereinigen den Map-Eintrag

Der Abbruch ist nur lokal: Der Transport sendet keine Abbruch-Notification auf Protokollebene an den Server.

## Behandlung fehlerhafter Payloads

In der Lese-Schleife:

- Jede geparste JSONL-Zeile wird im `try/catch` an `#handleMessage` übergeben
- Ausnahmen bei der Behandlung fehlerhafter/ungültiger Nachrichten werden verworfen (Kommentar `Skip malformed lines`)
- Die Schleife fährt fort, sodass eine fehlerhafte Nachricht die Verbindung nicht beendet

Wenn der zugrundeliegende Stream-Parser wirft, wird `onError` aufgerufen (wenn noch verbunden), dann wird die Verbindung geschlossen.

## Disconnect-/Fehlerverhalten

Wenn der Prozess endet oder der Stream geschlossen wird:

- Alle laufenden Requests werden mit `Transport closed` abgelehnt
- Kein automatischer Neustart oder Reconnect
- Höhere Schichten müssen durch Erstellen eines neuen Transports reconnecten

## Backpressure-/Streaming-Hinweise

- Ausgehende Schreibvorgänge verwenden `stdin.write()` + `flush()` ohne Warten auf Drain-Semantik.
- Es gibt kein explizites Queue- oder High-Watermark-Management im Transport.
- Die eingehende Verarbeitung ist stream-gesteuert (`for await` über `readJsonl`), jeweils eine geparste Nachricht.

## HTTP/SSE-Transport-Interna

## Lebenszyklus und Verbindungssemantik

Der HTTP-Transport hat einen logischen Verbindungszustand, aber der Request-Pfad ist zustandslos pro HTTP-Aufruf:

- `connect()` setzt `connected=true` (kein Socket-/Session-Handshake)
- Optionales Server-Session-Tracking über den `Mcp-Session-Id`-Header
- `close()` sendet optional `DELETE` mit `Mcp-Session-Id`, bricht den SSE-Listener ab, löst `onClose` aus

`connected` bedeutet also "Transport nutzbar", nicht "persistenter Stream aufgebaut".

## Session-Header-Verhalten

- Bei der POST-Response wird, wenn der `Mcp-Session-Id`-Header vorhanden ist, dieser vom Transport gespeichert.
- Nachfolgende Requests/Notifications enthalten `Mcp-Session-Id`.
- `close()` versucht, die Server-Session mit HTTP DELETE zu beenden; Beendigungsfehler werden ignoriert.

## Timeout und Abbruch

Für sowohl `request()` als auch `notify()`:

- Timeout verwendet `AbortController` (`config.timeout ?? 30000`)
- Externes Signal wird, falls vorhanden, über `AbortSignal.any([...])` zusammengeführt
- AbortError-Behandlung unterscheidet zwischen Aufrufer-Abbruch und Timeout

Geworfene Fehler:

- Timeout: `Request timeout after ...ms` (oder `SSE response timeout ...`, `Notify timeout ...`)
- Aufrufer-Abbruch: Ursprünglicher AbortError wird erneut geworfen, wenn das externe Signal bereits abgebrochen ist

## HTTP-Fehlerweitergabe

Bei nicht-OK-Response:

- Response-Text wird in den geworfenen Fehler aufgenommen (`HTTP <status>: <text>`)
- Falls vorhanden, werden Auth-Hinweise aus `WWW-Authenticate` und `Mcp-Auth-Server` angehängt

Bei JSON-RPC-Fehlerobjekt:

- Wirft `MCP error <code>: <message>`

Fehlerhafter JSON-Body (Fehler bei `response.json()`) wird als Parse-Exception weitergegeben.

## SSE-Verhalten und Modi

Es existieren zwei SSE-Pfade:

1. **Per-Request-SSE-Response** (`#parseSSEResponse`)
   - Wird verwendet, wenn der POST-Response-Content-Type `text/event-stream` ist
   - Konsumiert den Stream, bis eine passende Response-ID gefunden wird
   - Kann verschachtelte Notifications während desselben Streams verarbeiten

2. **Hintergrund-SSE-Listener** (`startSSEListener()`)
   - Optionaler GET-Listener für server-initiierte Notifications
   - Wird derzeit nicht automatisch vom MCP-Manager/Client gestartet
   - Wenn GET `405` zurückgibt, deaktiviert sich der Listener stillschweigend (Server unterstützt diesen Modus nicht)

## Behandlung fehlerhafter Payloads und Disconnect

SSE-JSON-Parsing-Fehler propagieren aus `readSseJson` und lehnen Request/Listener ab.

- Request-SSE-Parse-Fehler lehnen den aktiven Request ab.
- Hintergrund-Listener-Fehler lösen `onError` aus (außer AbortError).
- Kein Auto-Reconnect für den Hintergrund-Listener.

## `json-rpc.ts`-Utility vs. Transport-Abstraktion

`src/mcp/json-rpc.ts` stellt `callMCP()` und `parseSSE()`-Hilfsfunktionen für direkte HTTP-MCP-Aufrufe bereit (verwendet von der Exa-Integration), nicht die `MCPTransport`-Abstraktion, die von `MCPClient`/`MCPManager` verwendet wird.

Bemerkenswerte Unterschiede zu `HttpTransport`:

- Parst zuerst den gesamten Response-Text, extrahiert dann die erste `data:`-Zeile (`parseSSE`), mit JSON-Fallback
- Kein Request-Timeout-Management, keine Abort-API, kein Session-ID-Handling, kein Transport-Lebenszyklus
- Gibt das rohe JSON-RPC-Envelope-Objekt zurück

Dieser Pfad ist leichtgewichtig, aber weniger robust als die vollständige Transport-Implementierung.

## Retry-/Reconnect-Verantwortlichkeiten

## Transport-Ebene

Aktuelle Transport-Implementierungen führen **nicht** durch:

- Retry fehlgeschlagener Requests
- Reconnect nach stdio-Prozess-Ende
- Reconnect von SSE-Listenern
- Erneutes Senden laufender Requests nach Disconnect

Sie schlagen schnell fehl und propagieren Fehler.

## Manager-/Client-Ebene

`MCPManager` übernimmt die Discovery-/Initial-Connection-Orchestrierung und kann nur durch erneutes Ausführen der Connect-Abläufe reconnecten (`connectToServer`/`discoverAndConnect`-Pfade). Es heilt einen bereits verbundenen Transport bei Laufzeit-Fehler-Callbacks nicht automatisch.

`MCPManager` verfügt über Startup-Fallback-Verhalten für langsame Server (verzögerte Tools aus dem Cache), aber das ist Tool-Verfügbarkeits-Fallback, kein Transport-Retry.

## Zusammenfassung der Fehlerszenarien

- **Fehlerhafte stdio-Nachrichtenzeile**: Wird verworfen; Stream fährt fort.
- **Stdio-Stream/Prozess endet**: Transport schließt; ausstehende Requests werden als `Transport closed` abgelehnt.
- **HTTP non-2xx**: Request/Notify wirft HTTP-Fehler.
- **Ungültige JSON-Response**: Parse-Exception wird weitergegeben.
- **SSE endet ohne passende ID**: Request schlägt fehl mit `No response received for request ID ...`.
- **Timeout**: Transport-spezifischer Timeout-Fehler.
- **Aufrufer-Abbruch**: AbortError/Reason wird vom Aufrufer-Signal weitergegeben.

## Praktische Grenzregel

Wenn es um Nachrichtenstruktur, ID-Korrelation oder MCP-Methodenreihenfolge geht, gehört es zur Protokoll-/Client-Logik.

Wenn es um Framing (JSONL vs HTTP/SSE), Stream-Parsing, Fetch-/Spawn-Lebenszyklus, Timeout-Timer oder Verbindungsabbau geht, gehört es zur Transport-Implementierung.
