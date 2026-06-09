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
- Transportauswahl-Grenzen (`stdio` vs. `http`/`sse`)
- Welche Reconnect-/Retry-Verantwortlichkeiten auf Transportebene vs. Manager-Ebene liegen

Behandelt nicht: Extension-Authoring-UX oder Befehls-UI.

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

- Nachrichtenformen sind in `types.ts` definiert (`JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcResponse`, `JsonRpcMessage`).
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

Transportimplementierungen verwalten Framing und I/O-Details:

- `StdioTransport`: Zeilengetrennte JSON-Nachrichten über Subprozess-stdio
- `HttpTransport`: JSON-RPC über HTTP POST, mit optionalen SSE-Responses/Listening

### Wichtiger aktueller Vorbehalt

Transport-Callbacks (`onClose`, `onError`, `onNotification`) sind implementiert, aber die aktuellen `MCPClient`/`MCPManager`-Abläufe verdrahten keine Reconnect-Logik mit diesen Callbacks. Notifications werden nur konsumiert, wenn der Aufrufer Handler registriert.

## Transportauswahl

`client.ts:createTransport()` wählt den Transport anhand der Konfiguration:

- `type` weggelassen oder `"stdio"` -> `createStdioTransport`
- `"http"` oder `"sse"` -> `createHttpTransport`

`"sse"` wird als HTTP-Transport-Variante behandelt (gleiche Klasse), nicht als separate Transportimplementierung.

## JSON-RPC-Nachrichtenfluss und Korrelation

## Request-IDs

Jeder Transport generiert pro Request eine ID (`Math.random` + Timestamp-String). IDs sind transport-lokale Korrelations-Token.

## Stdio-Korrelationspfad

- Ausgehender Request wird als ein JSON-Objekt + `\n` serialisiert.
- `#pendingRequests: Map<id, {resolve,reject}>` speichert laufende Requests.
- Die Leseschleife parst JSONL von stdout und ruft `#handleMessage` auf.
- Wenn eine eingehende Nachricht eine passende `id` hat, wird der Request aufgelöst/abgelehnt.
- Wenn eine eingehende Nachricht `method` hat und keine `id`, wird sie als Notification behandelt und an `onNotification` weitergeleitet.

Unbekannte IDs werden ignoriert (keine Ablehnung, kein Error-Callback).

## HTTP-Korrelationspfad

- Ausgehender Request ist ein HTTP-`POST` mit JSON-Body und generierter `id`.
- Nicht-SSE-Response-Pfad: Eine JSON-RPC-Response wird geparst und `result` zurückgegeben / bei `error` wird eine Exception geworfen.
- SSE-Response-Pfad (`Content-Type: text/event-stream`): Events werden gestreamt, die erste Nachricht mit passender `id` und `result` oder `error` wird zurückgegeben.
- SSE-Nachrichten mit `method` und ohne `id` werden als Notifications behandelt.

Wenn der SSE-Stream endet, bevor eine passende Response gefunden wird, schlägt der Request mit `No response received for request ID ...` fehl.

## Notifications

Der Client sendet JSON-RPC-Notifications über `transport.notify(...)`.

- Stdio: schreibt den Notification-Frame an stdin (`jsonrpc`, `method`, optionales `params`) plus Zeilenumbruch.
- HTTP: sendet POST-Body ohne `id`; Erfolg akzeptiert `2xx` oder `202 Accepted`.

Vom Server initiierte Notifications werden nur über den Transport-Callback `onNotification` weitergeleitet; es gibt keinen standardmäßigen globalen Subscriber im Manager/Client.

## Stdio-Transport-Interna

## Lebenszyklus und Zustandsübergänge

- Initial: `connected=false`, `process=null`, Pending-Map leer
- `connect()`:
  - Subprozess mit konfiguriertem Befehl/Argumenten/Umgebungsvariablen/Arbeitsverzeichnis starten
  - Als verbunden markieren
  - stdout-Leseschleife starten (`readJsonl`)
  - stderr-Schleife starten (lesen/verwerfen; derzeit ohne Ausgabe)
- `close()`:
  - Als getrennt markieren
  - Alle ausstehenden Requests ablehnen (`Transport closed`)
  - Subprozess beenden
  - Auf Beendigung der Leseschleife warten
  - `onClose` auslösen

Wenn die Leseschleife unerwartet endet, löst `finally` `#handleClose()` aus, das dieselbe Ablehnung ausstehender Requests und den Close-Callback durchführt.

## Timeout und Abbruch

Pro Request:

- Timeout-Standard ist `config.timeout ?? 30000`
- Optionales `AbortSignal` vom Aufrufer
- Sowohl Abbruch als auch Timeout lehnen das ausstehende Promise ab und bereinigen den Map-Eintrag

Der Abbruch ist nur lokal: Der Transport sendet keine Abbruch-Notification auf Protokollebene an den Server.

## Behandlung fehlerhafter Payloads

In der Leseschleife:

- Jede geparste JSONL-Zeile wird in einem `try/catch` an `#handleMessage` übergeben
- Exceptions bei der Behandlung fehlerhafter/ungültiger Nachrichten werden verworfen (Kommentar `Skip malformed lines`)
- Die Schleife wird fortgesetzt, sodass eine fehlerhafte Nachricht die Verbindung nicht beendet

Wenn der zugrunde liegende Stream-Parser eine Exception wirft, wird `onError` aufgerufen (wenn noch verbunden), dann wird die Verbindung geschlossen.

## Trennungs-/Fehlerverhalten

Wenn der Prozess endet oder der Stream geschlossen wird:

- Alle laufenden Requests werden mit `Transport closed` abgelehnt
- Kein automatischer Neustart oder Reconnect
- Höhere Schichten müssen durch Erstellen eines neuen Transports erneut verbinden

## Hinweise zu Backpressure/Streaming

- Ausgehende Schreibvorgänge verwenden `stdin.write()` + `flush()` ohne Await auf Drain-Semantik.
- Es gibt kein explizites Queue- oder High-Watermark-Management im Transport.
- Eingehende Verarbeitung ist stream-gesteuert (`for await` über `readJsonl`), eine geparste Nachricht nach der anderen.

## HTTP/SSE-Transport-Interna

## Lebenszyklus und Verbindungssemantik

Der HTTP-Transport hat einen logischen Verbindungszustand, aber der Request-Pfad ist zustandslos pro HTTP-Aufruf:

- `connect()` setzt `connected=true` (kein Socket-/Session-Handshake)
- Optionale Server-Session-Verfolgung über den `Mcp-Session-Id`-Header
- `close()` sendet optional `DELETE` mit `Mcp-Session-Id`, bricht den SSE-Listener ab, löst `onClose` aus

`connected` bedeutet also "Transport nutzbar", nicht "persistenter Stream aufgebaut".

## Session-Header-Verhalten

- Bei der POST-Response wird, falls der `Mcp-Session-Id`-Header vorhanden ist, dieser vom Transport gespeichert.
- Nachfolgende Requests/Notifications enthalten `Mcp-Session-Id`.
- `close()` versucht, die Server-Session mit HTTP DELETE zu beenden; Terminierungsfehler werden ignoriert.

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

- Response-Text wird in den geworfenen Fehler eingeschlossen (`HTTP <status>: <text>`)
- Falls vorhanden, werden Auth-Hinweise aus `WWW-Authenticate` und `Mcp-Auth-Server` angehängt

Bei JSON-RPC-Fehlerobjekt:

- Wirft `MCP error <code>: <message>`

Fehlerhafter JSON-Body (Fehler bei `response.json()`) wird als Parse-Exception weitergegeben.

## SSE-Verhalten und Modi

Es existieren zwei SSE-Pfade:

1. **Per-Request-SSE-Response** (`#parseSSEResponse`)
   - Wird verwendet, wenn der POST-Response-Content-Type `text/event-stream` ist
   - Konsumiert den Stream, bis eine passende Response-ID gefunden wird
   - Kann während desselben Streams verschachtelte Notifications verarbeiten

2. **Hintergrund-SSE-Listener** (`startSSEListener()`)
   - Optionaler GET-Listener für vom Server initiierte Notifications
   - Wird derzeit nicht automatisch vom MCP-Manager/Client gestartet
   - Wenn GET `405` zurückgibt, deaktiviert sich der Listener stillschweigend (Server unterstützt diesen Modus nicht)

## Behandlung fehlerhafter Payloads und Verbindungsabbrüche

SSE-JSON-Parsing-Fehler werden aus `readSseJson` weitergeleitet und lehnen den Request/Listener ab.

- Request-SSE-Parse-Fehler lehnen den aktiven Request ab.
- Hintergrund-Listener-Fehler lösen `onError` aus (außer AbortError).
- Kein automatischer Reconnect für den Hintergrund-Listener.

## `json-rpc.ts`-Utility vs. Transport-Abstraktion

`src/mcp/json-rpc.ts` stellt `callMCP()`- und `parseSSE()`-Hilfsfunktionen für direkte HTTP-MCP-Aufrufe bereit (verwendet von der Exa-Integration), nicht die `MCPTransport`-Abstraktion, die von `MCPClient`/`MCPManager` verwendet wird.

Bemerkenswerte Unterschiede zu `HttpTransport`:

- Parst zuerst den gesamten Response-Text, extrahiert dann die erste `data:`-Zeile (`parseSSE`), mit JSON-Fallback
- Kein Request-Timeout-Management, keine Abort-API, keine Session-ID-Behandlung, kein Transport-Lebenszyklus
- Gibt das rohe JSON-RPC-Envelope-Objekt zurück

Dieser Pfad ist leichtgewichtig, aber weniger robust als die vollständige Transport-Implementierung.

## Retry-/Reconnect-Verantwortlichkeiten

## Transportebene

Aktuelle Transportimplementierungen führen **nicht** durch:

- Wiederholung fehlgeschlagener Requests
- Reconnect nach stdio-Prozessende
- Reconnect von SSE-Listenern
- Erneutes Senden laufender Requests nach Verbindungsabbruch

Sie schlagen schnell fehl und propagieren Fehler.

## Manager-/Client-Ebene

`MCPManager` behandelt Discovery-/initiale Verbindungsorchestrierung und kann nur durch erneutes Ausführen von Verbindungsabläufen reconnecten (`connectToServer`/`discoverAndConnect`-Pfade). Er repariert nicht automatisch einen bereits verbundenen Transport bei Laufzeitfehler-Callbacks.

`MCPManager` verfügt über ein Startup-Fallback-Verhalten für langsame Server (verzögerte Tools aus dem Cache), aber das ist ein Tool-Verfügbarkeits-Fallback, kein Transport-Retry.

## Zusammenfassung der Fehlerszenarien

- **Fehlerhafte stdio-Nachrichtenzeile**: Wird verworfen; Stream läuft weiter.
- **Stdio-Stream/Prozess endet**: Transport schließt sich; ausstehende Requests werden als `Transport closed` abgelehnt.
- **HTTP nicht-2xx**: Request/Notify wirft HTTP-Fehler.
- **Ungültige JSON-Response**: Parse-Exception wird weitergegeben.
- **SSE endet ohne passende ID**: Request schlägt fehl mit `No response received for request ID ...`.
- **Timeout**: Transport-spezifischer Timeout-Fehler.
- **Aufrufer-Abbruch**: AbortError/Reason wird vom Aufrufer-Signal weitergegeben.

## Praktische Grenzregel

Wenn es um Nachrichtenform, ID-Korrelation oder MCP-Methodenreihenfolge geht, gehört es zur Protokoll-/Client-Logik.

Wenn es um Framing (JSONL vs. HTTP/SSE), Stream-Parsing, Fetch-/Spawn-Lebenszyklus, Timeout-Timer oder Verbindungsabbau geht, gehört es zur Transportimplementierung.
