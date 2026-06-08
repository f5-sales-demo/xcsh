---
title: MCP-Laufzeitlebenszyklus
description: >-
  Lebenszyklus des MCP-Serverprozesses von der Initialisierung über
  Tool-Registrierung, Gesundheitsüberwachung bis zum Herunterfahren.
sidebar:
  order: 3
  label: Laufzeitlebenszyklus
i18n:
  sourceHash: d04cefaf38f8
  translator: machine
---

# MCP-Laufzeitlebenszyklus

Dieses Dokument beschreibt, wie MCP-Server in der Coding-Agent-Laufzeitumgebung entdeckt, verbunden, als Tools bereitgestellt, aktualisiert und beendet werden.

## Lebenszyklus im Überblick

1. **SDK-Start** ruft `discoverAndLoadMCPTools()` auf (sofern MCP nicht deaktiviert ist).
2. **Erkennung** (`loadAllMCPConfigs`) löst MCP-Serverkonfigurationen aus Capability-Quellen auf, filtert deaktivierte/Projekt-/Exa-Einträge und bewahrt Quellmetadaten.
3. **Manager-Verbindungsphase** (`MCPManager.connectServers`) startet pro Server parallel die Verbindung + `tools/list`.
4. **Schnelles Startup-Gate** wartet bis zu 250 ms und gibt dann zurück:
   - vollständig geladene `MCPTool`s,
   - Fehler pro Server,
   - oder gecachte `DeferredMCPTool`s für noch ausstehende Server.
5. **SDK-Verdrahtung** führt MCP-Tools in die Laufzeit-Tool-Registry der Sitzung zusammen.
6. **Live-Sitzung** kann MCP-Tools über `/mcp`-Abläufe aktualisieren (`disconnectAll` + Neuentdeckung + `session.refreshMCPTools`).
7. **Herunterfahren** erfolgt, wenn Aufrufer `disconnectServer`/`disconnectAll` aufrufen; der Manager löscht auch MCP-Tool-Registrierungen für getrennte Server.

## Erkennungs- und Ladephase

### Einstiegspfad vom SDK

`createAgentSession()` in `src/sdk.ts` führt den MCP-Start durch, wenn `enableMCP` wahr ist (Standard):

- ruft `discoverAndLoadMCPTools(cwd, { ... })` auf,
- übergibt `authStorage`, Cache-Speicher und die Einstellung `mcp.enableProjectConfig`,
- setzt immer `filterExa: true`,
- protokolliert Lade-/Verbindungsfehler pro Server,
- speichert den zurückgegebenen Manager in `toolSession.mcpManager` und dem Sitzungsergebnis.

Wenn `enableMCP` falsch ist, wird die MCP-Erkennung vollständig übersprungen.

### Konfigurationserkennung und Filterung

`loadAllMCPConfigs()` (`src/mcp/config.ts`) lädt kanonische MCP-Servereinträge über die Capability-Erkennung und konvertiert sie in das Legacy-Format `MCPServerConfig`.

Filterverhalten:

- `enableProjectConfig: false` entfernt Einträge auf Projektebene (`_source.level === "project"`).
- Server mit `enabled: false` werden vor Verbindungsversuchen übersprungen.
- Exa-Server werden standardmäßig herausgefiltert und API-Schlüssel werden für die native Exa-Tool-Integration extrahiert.

Das Ergebnis enthält sowohl `configs` als auch `sources` (Metadaten, die später für die Anbieter-Kennzeichnung verwendet werden).

### Fehlerverhalten auf Erkennungsebene

`discoverAndLoadMCPTools()` unterscheidet zwei Fehlerklassen:

- **Harter Erkennungsfehler** (Ausnahme von `manager.discoverAndConnect`, typischerweise aus der Konfigurationserkennung): gibt ein leeres Tool-Set und einen synthetischen Fehler `{ path: ".mcp.json", error }` zurück.
- **Laufzeit-/Verbindungsfehler pro Server**: der Manager gibt Teilerfolge mit einer `errors`-Map zurück; andere Server fahren fort.

Das Starten schlägt also nicht für die gesamte Agent-Sitzung fehl, wenn einzelne MCP-Server ausfallen.

## Manager-Zustandsmodell

`MCPManager` verfolgt den Laufzeitlebenszyklus mit separaten Registries:

- `#connections: Map<string, MCPServerConnection>` — vollständig verbundene Server.
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — Handshake in Bearbeitung.
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — verbunden, aber Tools laden noch.
- `#tools: CustomTool[]` — aktuelle MCP-Tool-Ansicht, die Aufrufern bereitgestellt wird.
- `#sources: Map<string, SourceMeta>` — Anbieter-/Quellmetadaten, auch bevor die Verbindung abgeschlossen ist.

`getConnectionStatus(name)` leitet den Status aus diesen Maps ab:

- `connected` wenn in `#connections`,
- `connecting` wenn ausstehende Verbindung oder ausstehendes Tool-Laden,
- `disconnected` andernfalls.

## Verbindungsaufbau und Startup-Timing

## Verbindungspipeline pro Server

Für jeden erkannten Server in `connectServers()`:

1. Quellmetadaten speichern/aktualisieren,
2. überspringen, falls bereits verbunden/ausstehend,
3. Transportfelder validieren (`validateServerConfig`),
4. Auth-/Shell-Substitutionen auflösen (`#resolveAuthConfig`),
5. `connectToServer(name, resolvedConfig)` aufrufen,
6. `listTools(connection)` aufrufen,
7. Tool-Definitionen bestmöglich cachen (`MCPToolCache.set`).

Verhalten von `connectToServer()` (`src/mcp/client.ts`):

- erstellt stdio- oder HTTP/SSE-Transport,
- führt MCP `initialize` + `notifications/initialized` durch,
- verwendet Timeout (`config.timeout` oder 30 s Standard),
- schließt den Transport bei Initialisierungsfehler.

### Schnelles Startup-Gate + verzögerter Fallback

`connectServers()` wartet auf ein Rennen zwischen:

- dem Abschluss aller Verbindungs-/Tool-Ladeaufgaben, und
- `STARTUP_TIMEOUT_MS = 250`.

Nach 250 ms:

- erfüllte Aufgaben werden zu Live-`MCPTool`s,
- abgelehnte Aufgaben erzeugen Fehler pro Server,
- noch ausstehende Aufgaben:
  - verwenden gecachte Tool-Definitionen, falls verfügbar (`MCPToolCache.get`), um `DeferredMCPTool`s zu erstellen,
  - warten andernfalls, bis diese ausstehenden Aufgaben abgeschlossen sind.

Dies ist ein hybrides Startup-Modell: schnelle Rückgabe, wenn Cache verfügbar ist, Korrektheitswartung, wenn nicht.

### Hintergrund-Abschlussverhalten

Jedes ausstehende `toolsPromise` hat auch eine Hintergrund-Fortsetzung, die schließlich:

- den Tool-Anteil dieses Servers im Manager-Zustand über `#replaceServerTools` ersetzt,
- den Cache schreibt,
- späte Fehler erst nach dem Startup protokolliert (`allowBackgroundLogging`).

## Tool-Bereitstellung und Verfügbarkeit in der Live-Sitzung

### Startup-Registrierung

`discoverAndLoadMCPTools()` konvertiert Manager-Tools in `LoadedCustomTool[]` und dekoriert Pfade (`mcp:<server> via <providerName>` wenn bekannt).

`createAgentSession()` fügt diese Tools dann in `customTools` ein, die gewrappt und der Laufzeit-Tool-Registry mit Namen wie `mcp_<server>_<tool>` hinzugefügt werden.

### Tool-Aufrufe

- `MCPTool` ruft Tools über eine bereits verbundene `MCPServerConnection` auf.
- `DeferredMCPTool` wartet auf `waitForConnection(server)` vor dem Aufruf; dies ermöglicht, dass gecachte Tools existieren, bevor die Verbindung bereit ist.

Beide geben strukturierte Tool-Ausgaben zurück und konvertieren Transport-/Tool-Fehler in `MCP error: ...`-Tool-Inhalt (Abbruch bleibt Abbruch).

## Aktualisierungs-/Neuladepfade (Startup vs. Live-Reload)

### Initialer Startup-Pfad

- einmalige Erkennung/Ladung in `sdk.ts`,
- Tools werden in der initialen Sitzungs-Tool-Registry registriert.

### Interaktiver Neuladepfad

Der `/mcp reload`-Pfad (`src/modes/controllers/mcp-command-controller.ts`) führt aus:

1. `mcpManager.disconnectAll()`,
2. `mcpManager.discoverAndConnect()`,
3. `session.refreshMCPTools(mcpManager.getTools())`.

`session.refreshMCPTools()` (`src/session/agent-session.ts`) entfernt alle `mcp_`-Tools, wrappt die neuesten MCP-Tools neu und reaktiviert das Tool-Set, sodass MCP-Änderungen ohne Neustart der Sitzung wirksam werden.

Es gibt auch einen Folgepfad für späte Verbindungen: Nach dem Warten auf einen bestimmten Server wird, falls der Status `connected` wird, `session.refreshMCPTools(...)` erneut ausgeführt, sodass neu verfügbare Tools in der Sitzung neu gebunden werden.

## Gesundheit, Wiederverbindung und Teilausfallverhalten

Das aktuelle Laufzeitverhalten ist absichtlich minimal:

- **Kein autonomer Gesundheitsmonitor** im Manager/Client.
- **Keine automatische Wiederverbindungsschleife**, wenn ein Transport abbricht.
- Der Manager abonniert kein `onClose`/`onError` des Transports; der Status wird Registry-gesteuert ermittelt.
- Wiederverbindung ist explizit: über den Reload-Ablauf oder direkten `connectServers()`-Aufruf.

Operativ:

- der Ausfall eines Servers entfernt keine Tools von gesunden Servern,
- Verbindungs-/Auflistungsfehler sind pro Server isoliert,
- Tool-Cache und Hintergrund-Aktualisierungen erfolgen bestmöglich (Warnungen/Fehler werden protokolliert, kein harter Stopp).

## Semantik des Herunterfahrens

### Herunterfahren auf Serverebene

`disconnectServer(name)`:

- entfernt ausstehende Einträge/Quellmetadaten,
- schließt den Transport, falls verbunden,
- entfernt die `mcp_`-Tools dieses Servers aus dem Manager-Zustand.

### Globales Herunterfahren

`disconnectAll()`:

- schließt alle aktiven Transporte mit `Promise.allSettled`,
- löscht ausstehende Maps, Quellen, Verbindungen und die Manager-Tool-Liste.

In der aktuellen Verdrahtung wird explizites Herunterfahren in MCP-Befehlsabläufen verwendet (für Neuladen/Entfernen/Deaktivieren). Es gibt keinen separaten automatischen Manager-Disposal-Hook im Startup-Pfad selbst; Aufrufer sind dafür verantwortlich, die Disconnect-Methoden des Managers aufzurufen, wenn sie ein deterministisches MCP-Herunterfahren benötigen.

## Fehlermodi und Garantien

| Szenario | Verhalten | Harter Fehler vs. Bestmöglich |
| --- | --- | --- |
| Erkennung wirft Ausnahme (Capability-/Konfigurationsladepfad) | Loader gibt leere Tools + synthetischen `.mcp.json`-Fehler zurück | Bestmöglicher Sitzungsstart |
| Ungültige Serverkonfiguration | Server wird mit Validierungsfehler-Eintrag übersprungen | Bestmöglich pro Server |
| Verbindungs-Timeout/Initialisierungsfehler | Serverfehler wird aufgezeichnet; andere fahren fort | Bestmöglich pro Server |
| `tools/list` beim Startup noch ausstehend mit Cache-Treffer | Verzögerte Tools werden sofort zurückgegeben | Bestmöglich schneller Start |
| `tools/list` beim Startup noch ausstehend ohne Cache | Startup wartet, bis Ausstehende abgeschlossen sind | Hartes Warten auf Korrektheit |
| Später Hintergrund-Tool-Ladefehler | Wird nach dem Startup-Gate protokolliert | Bestmögliche Protokollierung |
| Zur Laufzeit abgebrochener Transport | Keine automatische Wiederverbindung; zukünftige Aufrufe scheitern bis zur Wiederverbindung/Neuladung | Bestmögliche Wiederherstellung durch manuelle Aktion |

## Öffentliche API-Oberfläche

`src/mcp/index.ts` re-exportiert Loader-/Manager-/Client-APIs für externe Aufrufer. `src/sdk.ts` stellt `discoverMCPServers()` als Komfort-Wrapper bereit, der die gleiche Loader-Ergebnisstruktur zurückgibt.

## Implementierungsdateien

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — Loader-Fassade, Erkennungsfehler-Normalisierung, `LoadedCustomTool`-Konvertierung.
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — Lebenszyklus-Zustandsregistries, paralleler Verbindungs-/Auflistungsablauf, Aktualisierung/Trennung.
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — Transport-Setup, Initialize-Handshake, Auflisten/Aufrufen/Trennen.
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — MCP-Modul-API-Exporte.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — Startup-Verdrahtung in Sitzung/Tool-Registry.
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — Konfigurationserkennung/-filterung/-validierung, verwendet vom Manager.
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — Laufzeitverhalten von `MCPTool` und `DeferredMCPTool`.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `refreshMCPTools` Live-Neubindung.
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — Interaktive Neulade-/Wiederverbindungsabläufe.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — Subagent-MCP-Proxying über Parent-Manager-Verbindungen.
