---
title: MCP-Laufzeit-Lebenszyklus
description: >-
  Lebenszyklus des MCP-Serverprozesses von der Initialisierung über die
  Tool-Registrierung, Zustandsüberwachung bis zum Herunterfahren.
sidebar:
  order: 3
  label: Laufzeit-Lebenszyklus
i18n:
  sourceHash: d04cefaf38f8
  translator: machine
---

# MCP-Laufzeit-Lebenszyklus

Dieses Dokument beschreibt, wie MCP-Server in der Coding-Agent-Laufzeit erkannt, verbunden, als Tools bereitgestellt, aktualisiert und beendet werden.

## Lebenszyklus im Überblick

1. **SDK-Start** ruft `discoverAndLoadMCPTools()` auf (sofern MCP nicht deaktiviert ist).
2. **Erkennung** (`loadAllMCPConfigs`) löst MCP-Serverkonfigurationen aus Capability-Quellen auf, filtert deaktivierte/Projekt-/Exa-Einträge und bewahrt Quellmetadaten.
3. **Manager-Verbindungsphase** (`MCPManager.connectServers`) startet Verbindungsaufbau + `tools/list` pro Server parallel.
4. **Schnelle Startsperre** wartet bis zu 250 ms und gibt dann möglicherweise zurück:
   - vollständig geladene `MCPTool`s,
   - Fehler pro Server,
   - oder gecachte `DeferredMCPTool`s für noch ausstehende Server.
5. **SDK-Verdrahtung** fügt MCP-Tools in die Laufzeit-Tool-Registry für die Sitzung ein.
6. **Aktive Sitzung** kann MCP-Tools über `/mcp`-Abläufe aktualisieren (`disconnectAll` + Neuerkennung + `session.refreshMCPTools`).
7. **Beendigung** erfolgt, wenn Aufrufer `disconnectServer`/`disconnectAll` aufrufen; der Manager löscht auch MCP-Tool-Registrierungen für getrennte Server.

## Erkennungs- und Ladephase

### Einstiegspfad vom SDK

`createAgentSession()` in `src/sdk.ts` führt den MCP-Start durch, wenn `enableMCP` wahr ist (Standard):

- ruft `discoverAndLoadMCPTools(cwd, { ... })` auf,
- übergibt `authStorage`, Cache-Speicher und die Einstellung `mcp.enableProjectConfig`,
- setzt immer `filterExa: true`,
- protokolliert Lade-/Verbindungsfehler pro Server,
- speichert den zurückgegebenen Manager in `toolSession.mcpManager` und im Sitzungsergebnis.

Wenn `enableMCP` falsch ist, wird die MCP-Erkennung vollständig übersprungen.

### Konfigurationserkennung und Filterung

`loadAllMCPConfigs()` (`src/mcp/config.ts`) lädt kanonische MCP-Servereinträge über die Capability-Erkennung und konvertiert sie in die Legacy-`MCPServerConfig`.

Filterverhalten:

- `enableProjectConfig: false` entfernt Einträge auf Projektebene (`_source.level === "project"`).
- Server mit `enabled: false` werden vor Verbindungsversuchen übersprungen.
- Exa-Server werden standardmäßig herausgefiltert und API-Schlüssel werden für die native Exa-Tool-Integration extrahiert.

Das Ergebnis enthält sowohl `configs` als auch `sources` (Metadaten, die später für die Anbieterkennzeichnung verwendet werden).

### Fehlerverhalten auf Erkennungsebene

`discoverAndLoadMCPTools()` unterscheidet zwei Fehlerklassen:

- **Harter Erkennungsfehler** (Ausnahme von `manager.discoverAndConnect`, typischerweise aus der Konfigurationserkennung): gibt ein leeres Tool-Set und einen synthetischen Fehler `{ path: ".mcp.json", error }` zurück.
- **Laufzeit-/Verbindungsfehler pro Server**: Der Manager gibt einen Teilerfolg mit `errors`-Map zurück; andere Server arbeiten weiter.

Der Start lässt also nicht die gesamte Agent-Sitzung fehlschlagen, wenn einzelne MCP-Server ausfallen.

## Manager-Zustandsmodell

`MCPManager` verfolgt den Laufzeit-Lebenszyklus mit separaten Registries:

- `#connections: Map<string, MCPServerConnection>` — vollständig verbundene Server.
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — Handshake in Bearbeitung.
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — verbunden, aber Tools werden noch geladen.
- `#tools: CustomTool[]` — aktuelle MCP-Tool-Ansicht, die Aufrufern bereitgestellt wird.
- `#sources: Map<string, SourceMeta>` — Anbieter-/Quellmetadaten auch vor Abschluss der Verbindung.

`getConnectionStatus(name)` leitet den Status aus diesen Maps ab:

- `connected`, wenn in `#connections`,
- `connecting`, wenn ausstehende Verbindung oder ausstehendes Tool-Laden,
- `disconnected` andernfalls.

## Verbindungsaufbau und Start-Timing

## Verbindungspipeline pro Server

Für jeden erkannten Server in `connectServers()`:

1. Quellmetadaten speichern/aktualisieren,
2. überspringen, wenn bereits verbunden/ausstehend,
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

### Schnelle Startsperre + Deferred-Fallback

`connectServers()` wartet auf ein Rennen zwischen:

- Abschluss aller Verbindungs-/Tool-Lade-Aufgaben und
- `STARTUP_TIMEOUT_MS = 250`.

Nach 250 ms:

- erfüllte Aufgaben werden zu aktiven `MCPTool`s,
- fehlgeschlagene Aufgaben erzeugen Fehler pro Server,
- noch ausstehende Aufgaben:
  - verwenden gecachte Tool-Definitionen falls verfügbar (`MCPToolCache.get`), um `DeferredMCPTool`s zu erstellen,
  - andernfalls wird gewartet, bis diese ausstehenden Aufgaben abgeschlossen sind.

Dies ist ein hybrides Startmodell: schnelle Rückgabe bei verfügbarem Cache, Korrektheitswarten bei fehlendem Cache.

### Hintergrund-Abschlussverhalten

Jedes ausstehende `toolsPromise` hat auch eine Hintergrund-Fortsetzung, die schließlich:

- den Tool-Anteil dieses Servers im Manager-Zustand über `#replaceServerTools` ersetzt,
- den Cache schreibt,
- späte Fehler erst nach dem Start protokolliert (`allowBackgroundLogging`).

## Tool-Bereitstellung und Verfügbarkeit in der aktiven Sitzung

### Registrierung beim Start

`discoverAndLoadMCPTools()` konvertiert Manager-Tools in `LoadedCustomTool[]` und dekoriert Pfade (`mcp:<server> via <providerName>` wenn bekannt).

`createAgentSession()` fügt diese Tools dann in `customTools` ein, die gewrappt und der Laufzeit-Tool-Registry mit Namen wie `mcp_<server>_<tool>` hinzugefügt werden.

### Tool-Aufrufe

- `MCPTool` ruft Tools über eine bereits bestehende `MCPServerConnection` auf.
- `DeferredMCPTool` wartet auf `waitForConnection(server)` vor dem Aufruf; dies ermöglicht es, dass gecachte Tools existieren, bevor die Verbindung bereit ist.

Beide geben strukturierte Tool-Ausgaben zurück und konvertieren Transport-/Tool-Fehler in `MCP error: ...`-Tool-Inhalt (Abbruch bleibt Abbruch).

## Aktualisierungs-/Neulade-Pfade (Start vs. Live-Neuladen)

### Initialer Startpfad

- einmalige Erkennung/Laden in `sdk.ts`,
- Tools werden in der initialen Sitzungs-Tool-Registry registriert.

### Interaktiver Neulade-Pfad

Der `/mcp reload`-Pfad (`src/modes/controllers/mcp-command-controller.ts`) führt aus:

1. `mcpManager.disconnectAll()`,
2. `mcpManager.discoverAndConnect()`,
3. `session.refreshMCPTools(mcpManager.getTools())`.

`session.refreshMCPTools()` (`src/session/agent-session.ts`) entfernt alle `mcp_`-Tools, wrappt die neuesten MCP-Tools erneut und reaktiviert das Tool-Set, sodass MCP-Änderungen ohne Neustart der Sitzung wirksam werden.

Es gibt auch einen Folgepfad für späte Verbindungen: Wenn nach dem Warten auf einen bestimmten Server der Status `connected` wird, wird `session.refreshMCPTools(...)` erneut ausgeführt, sodass neu verfügbare Tools in der Sitzung erneut gebunden werden.

## Zustandsüberwachung, Wiederverbindung und Teilfehlerverhalten

Das aktuelle Laufzeitverhalten ist bewusst minimal gehalten:

- **Keine autonome Zustandsüberwachung** im Manager/Client.
- **Keine automatische Wiederverbindungsschleife** wenn ein Transport ausfällt.
- Der Manager abonniert keine `onClose`/`onError`-Ereignisse des Transports; der Status wird registry-gesteuert.
- Wiederverbindung ist explizit: Neulade-Ablauf oder direkter `connectServers()`-Aufruf.

Im Betrieb:

- der Ausfall eines Servers entfernt keine Tools von gesunden Servern,
- Verbindungs-/List-Fehler sind pro Server isoliert,
- Tool-Cache und Hintergrund-Aktualisierungen erfolgen bestmöglich (Warnungen/Fehler werden protokolliert, kein harter Stopp).

## Beendigungssemantik

### Beendigung auf Serverebene

`disconnectServer(name)`:

- entfernt ausstehende Einträge/Quellmetadaten,
- schließt den Transport falls verbunden,
- entfernt die `mcp_`-Tools dieses Servers aus dem Manager-Zustand.

### Globale Beendigung

`disconnectAll()`:

- schließt alle aktiven Transports mit `Promise.allSettled`,
- leert ausstehende Maps, Quellen, Verbindungen und die Manager-Tool-Liste.

In der aktuellen Verdrahtung wird die explizite Beendigung in MCP-Befehlsabläufen verwendet (für Neuladen/Entfernen/Deaktivieren). Es gibt keinen separaten automatischen Manager-Dispositions-Hook im Startpfad selbst; Aufrufer sind dafür verantwortlich, die Disconnect-Methoden des Managers aufzurufen, wenn sie ein deterministisches MCP-Herunterfahren benötigen.

## Fehlermodi und Garantien

| Szenario | Verhalten | Harter Fehler vs. Bestmöglich |
| --- | --- | --- |
| Erkennung wirft Fehler (Capability-/Konfigurationsladepfad) | Loader gibt leere Tools + synthetischen `.mcp.json`-Fehler zurück | Bestmöglicher Sitzungsstart |
| Ungültige Serverkonfiguration | Server wird mit Validierungsfehler-Eintrag übersprungen | Bestmöglich pro Server |
| Verbindungs-Timeout/Initialisierungsfehler | Serverfehler wird aufgezeichnet; andere fahren fort | Bestmöglich pro Server |
| `tools/list` beim Start noch ausstehend mit Cache-Treffer | Deferred-Tools werden sofort zurückgegeben | Bestmöglich schneller Start |
| `tools/list` beim Start noch ausstehend ohne Cache | Start wartet auf Abschluss der ausstehenden Aufgaben | Hartes Warten auf Korrektheit |
| Später Hintergrund-Tool-Ladefehler | Nach Startsperre protokolliert | Bestmögliche Protokollierung |
| Laufzeit-Transportausfall | Keine automatische Wiederverbindung; zukünftige Aufrufe schlagen bis zur Wiederverbindung/Neuladung fehl | Bestmögliche Wiederherstellung durch manuelle Aktion |

## Öffentliche API-Oberfläche

`src/mcp/index.ts` re-exportiert Loader-/Manager-/Client-APIs für externe Aufrufer. `src/sdk.ts` stellt `discoverMCPServers()` als praktischen Wrapper bereit, der die gleiche Loader-Ergebnisstruktur zurückgibt.

## Implementierungsdateien

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — Loader-Fassade, Normalisierung von Erkennungsfehlern, `LoadedCustomTool`-Konvertierung.
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — Lebenszyklus-Zustandsregistries, paralleler Verbindungs-/List-Ablauf, Aktualisierung/Trennung.
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — Transport-Setup, Initialize-Handshake, List/Call/Disconnect.
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — MCP-Modul-API-Exporte.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — Startverdrahtung in Sitzungs-/Tool-Registry.
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — Konfigurationserkennung/-filterung/-validierung, verwendet vom Manager.
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — Laufzeitverhalten von `MCPTool` und `DeferredMCPTool`.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `refreshMCPTools` Live-Neubindung.
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — Interaktive Neulade-/Wiederverbindungsabläufe.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — Subagent-MCP-Proxying über übergeordnete Manager-Verbindungen.
