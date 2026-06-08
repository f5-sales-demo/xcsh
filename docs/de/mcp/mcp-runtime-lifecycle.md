---
title: MCP-Laufzeit-Lebenszyklus
description: >-
  Lebenszyklus von MCP-Serverprozessen von der Initialisierung über
  Tool-Registrierung, Gesundheitsüberwachung bis zum Herunterfahren.
sidebar:
  order: 3
  label: Laufzeit-Lebenszyklus
i18n:
  sourceHash: d04cefaf38f8
  translator: machine
---

# MCP-Laufzeit-Lebenszyklus

Dieses Dokument beschreibt, wie MCP-Server in der Coding-Agent-Laufzeitumgebung entdeckt, verbunden, als Tools bereitgestellt, aktualisiert und beendet werden.

## Lebenszyklus im Überblick

1. **SDK-Start** ruft `discoverAndLoadMCPTools()` auf (sofern MCP nicht deaktiviert ist).
2. **Entdeckung** (`loadAllMCPConfigs`) löst MCP-Server-Konfigurationen aus Capability-Quellen auf, filtert deaktivierte/Projekt-/Exa-Einträge und bewahrt Quell-Metadaten.
3. **Manager-Verbindungsphase** (`MCPManager.connectServers`) startet pro Server die Verbindung + `tools/list` parallel.
4. **Schnelles Startup-Gate** wartet bis zu 250ms und kann dann zurückgeben:
   - vollständig geladene `MCPTool`s,
   - Fehler pro Server,
   - oder gecachte `DeferredMCPTool`s für noch ausstehende Server.
5. **SDK-Verdrahtung** führt MCP-Tools in die Laufzeit-Tool-Registry für die Sitzung zusammen.
6. **Live-Sitzung** kann MCP-Tools über `/mcp`-Abläufe aktualisieren (`disconnectAll` + Neuentdeckung + `session.refreshMCPTools`).
7. **Beendigung** erfolgt, wenn Aufrufer `disconnectServer`/`disconnectAll` aufrufen; der Manager löscht auch MCP-Tool-Registrierungen für getrennte Server.

## Entdeckungs- und Ladephase

### Einstiegspfad vom SDK

`createAgentSession()` in `src/sdk.ts` führt den MCP-Start durch, wenn `enableMCP` auf true gesetzt ist (Standard):

- ruft `discoverAndLoadMCPTools(cwd, { ... })` auf,
- übergibt `authStorage`, Cache-Speicher und die Einstellung `mcp.enableProjectConfig`,
- setzt immer `filterExa: true`,
- protokolliert Lade-/Verbindungsfehler pro Server,
- speichert den zurückgegebenen Manager in `toolSession.mcpManager` und im Sitzungsergebnis.

Wenn `enableMCP` auf false gesetzt ist, wird die MCP-Entdeckung vollständig übersprungen.

### Konfigurationsentdeckung und Filterung

`loadAllMCPConfigs()` (`src/mcp/config.ts`) lädt kanonische MCP-Server-Einträge über die Capability-Entdeckung und konvertiert sie in das Legacy-Format `MCPServerConfig`.

Filterverhalten:

- `enableProjectConfig: false` entfernt Einträge auf Projektebene (`_source.level === "project"`).
- Server mit `enabled: false` werden vor Verbindungsversuchen übersprungen.
- Exa-Server werden standardmäßig herausgefiltert und API-Schlüssel werden für die native Exa-Tool-Integration extrahiert.

Das Ergebnis enthält sowohl `configs` als auch `sources` (Metadaten, die später für die Provider-Kennzeichnung verwendet werden).

### Fehlerverhalten auf Entdeckungsebene

`discoverAndLoadMCPTools()` unterscheidet zwei Fehlerklassen:

- **Harter Entdeckungsfehler** (Ausnahme von `manager.discoverAndConnect`, typischerweise aus der Konfigurationsentdeckung): gibt ein leeres Tool-Set und einen synthetischen Fehler `{ path: ".mcp.json", error }` zurück.
- **Laufzeit-/Verbindungsfehler pro Server**: der Manager gibt Teilerfolge mit einer `errors`-Map zurück; andere Server fahren fort.

Der Start lässt also nicht die gesamte Agent-Sitzung fehlschlagen, wenn einzelne MCP-Server ausfallen.

## Manager-Zustandsmodell

`MCPManager` verfolgt den Laufzeit-Lebenszyklus mit separaten Registries:

- `#connections: Map<string, MCPServerConnection>` — vollständig verbundene Server.
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — Handshake in Bearbeitung.
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — verbunden, aber Tools werden noch geladen.
- `#tools: CustomTool[]` — aktuelle MCP-Tool-Ansicht, die Aufrufern bereitgestellt wird.
- `#sources: Map<string, SourceMeta>` — Provider-/Quell-Metadaten, auch bevor die Verbindung abgeschlossen ist.

`getConnectionStatus(name)` leitet den Status aus diesen Maps ab:

- `connected` wenn in `#connections`,
- `connecting` wenn ausstehende Verbindung oder ausstehender Tool-Ladevorgang,
- `disconnected` andernfalls.

## Verbindungsaufbau und Startup-Timing

## Verbindungspipeline pro Server

Für jeden entdeckten Server in `connectServers()`:

1. Quell-Metadaten speichern/aktualisieren,
2. überspringen, wenn bereits verbunden/ausstehend,
3. Transport-Felder validieren (`validateServerConfig`),
4. Auth-/Shell-Substitutionen auflösen (`#resolveAuthConfig`),
5. `connectToServer(name, resolvedConfig)` aufrufen,
6. `listTools(connection)` aufrufen,
7. Tool-Definitionen best-effort cachen (`MCPToolCache.set`).

Verhalten von `connectToServer()` (`src/mcp/client.ts`):

- erstellt stdio- oder HTTP/SSE-Transport,
- führt MCP `initialize` + `notifications/initialized` durch,
- verwendet Timeout (`config.timeout` oder 30s Standard),
- schließt den Transport bei Initialisierungsfehler.

### Schnelles Startup-Gate + Deferred-Fallback

`connectServers()` wartet auf ein Race zwischen:

- allen abgeschlossenen Verbindungs-/Tool-Lade-Aufgaben und
- `STARTUP_TIMEOUT_MS = 250`.

Nach 250ms:

- erfüllte Aufgaben werden zu aktiven `MCPTool`s,
- abgelehnte Aufgaben erzeugen Fehler pro Server,
- noch ausstehende Aufgaben:
  - verwenden gecachte Tool-Definitionen wenn verfügbar (`MCPToolCache.get`), um `DeferredMCPTool`s zu erstellen,
  - andernfalls wird gewartet, bis diese ausstehenden Aufgaben abgeschlossen sind.

Dies ist ein hybrides Startup-Modell: schnelle Rückgabe wenn Cache verfügbar ist, Korrektheitswarten wenn kein Cache vorhanden ist.

### Hintergrund-Abschlussverhalten

Jedes ausstehende `toolsPromise` hat auch eine Hintergrund-Fortsetzung, die letztendlich:

- den Tool-Anteil dieses Servers im Manager-Zustand über `#replaceServerTools` ersetzt,
- den Cache beschreibt,
- späte Fehler erst nach dem Startup protokolliert (`allowBackgroundLogging`).

## Tool-Bereitstellung und Verfügbarkeit in der Live-Sitzung

### Startup-Registrierung

`discoverAndLoadMCPTools()` konvertiert Manager-Tools in `LoadedCustomTool[]` und dekoriert Pfade (`mcp:<server> via <providerName>` wenn bekannt).

`createAgentSession()` fügt diese Tools dann in `customTools` ein, die gewrappt und mit Namen wie `mcp_<server>_<tool>` zur Laufzeit-Tool-Registry hinzugefügt werden.

### Tool-Aufrufe

- `MCPTool` ruft Tools über eine bereits bestehende `MCPServerConnection` auf.
- `DeferredMCPTool` wartet auf `waitForConnection(server)` vor dem Aufruf; dies ermöglicht es, gecachte Tools bereitzustellen, bevor die Verbindung bereit ist.

Beide geben strukturierte Tool-Ausgaben zurück und konvertieren Transport-/Tool-Fehler in `MCP error: ...`-Tool-Inhalte (Abbruch bleibt Abbruch).

## Aktualisierungs-/Neuladeungs-Pfade (Startup vs. Live-Neuladung)

### Initialer Startup-Pfad

- einmalige Entdeckung/Ladung in `sdk.ts`,
- Tools werden in der initialen Sitzungs-Tool-Registry registriert.

### Interaktiver Neuladeungs-Pfad

Der `/mcp reload`-Pfad (`src/modes/controllers/mcp-command-controller.ts`) führt aus:

1. `mcpManager.disconnectAll()`,
2. `mcpManager.discoverAndConnect()`,
3. `session.refreshMCPTools(mcpManager.getTools())`.

`session.refreshMCPTools()` (`src/session/agent-session.ts`) entfernt alle `mcp_`-Tools, wrappt die neuesten MCP-Tools erneut und reaktiviert das Tool-Set, sodass MCP-Änderungen ohne Neustart der Sitzung wirksam werden.

Es gibt auch einen Folgepfad für späte Verbindungen: Nach dem Warten auf einen bestimmten Server wird, wenn der Status `connected` wird, erneut `session.refreshMCPTools(...)` ausgeführt, sodass neu verfügbare Tools in der Sitzung neu gebunden werden.

## Gesundheit, Wiederverbindung und Verhalten bei Teilausfällen

Das aktuelle Laufzeitverhalten ist bewusst minimal gehalten:

- **Kein autonomer Gesundheitsmonitor** im Manager/Client.
- **Keine automatische Wiederverbindungsschleife** wenn ein Transport abbricht.
- Der Manager abonniert keine `onClose`/`onError`-Ereignisse des Transports; der Status wird registry-gesteuert ermittelt.
- Wiederverbindung ist explizit: über den Neuladeungs-Ablauf oder direkten `connectServers()`-Aufruf.

Im Betrieb:

- der Ausfall eines Servers entfernt keine Tools von gesunden Servern,
- Verbindungs-/Listenauflistungsfehler sind pro Server isoliert,
- Tool-Cache und Hintergrund-Aktualisierungen sind best-effort (Warnungen/Fehler werden protokolliert, kein harter Stopp).

## Beendigungssemantik

### Beendigung auf Serverebene

`disconnectServer(name)`:

- entfernt ausstehende Einträge/Quell-Metadaten,
- schließt den Transport wenn verbunden,
- entfernt die `mcp_`-Tools dieses Servers aus dem Manager-Zustand.

### Globale Beendigung

`disconnectAll()`:

- schließt alle aktiven Transporte mit `Promise.allSettled`,
- löscht ausstehende Maps, Quellen, Verbindungen und die Manager-Tool-Liste.

In der aktuellen Verdrahtung wird die explizite Beendigung in MCP-Befehlsabläufen verwendet (für Neuladung/Entfernung/Deaktivierung). Es gibt keinen separaten automatischen Manager-Disposal-Hook im Startup-Pfad selbst; Aufrufer sind dafür verantwortlich, die Disconnect-Methoden des Managers aufzurufen, wenn sie ein deterministisches MCP-Herunterfahren benötigen.

## Fehlermodi und Garantien

| Szenario | Verhalten | Harter Fehler vs. Best-Effort |
| --- | --- | --- |
| Entdeckung wirft Ausnahme (Capability-/Konfigurationsladeepfad) | Loader gibt leere Tools + synthetischen `.mcp.json`-Fehler zurück | Best-Effort-Sitzungsstart |
| Ungültige Serverkonfiguration | Server wird mit Validierungsfehlereintrag übersprungen | Best-Effort pro Server |
| Verbindungs-Timeout/Initialisierungsfehler | Serverfehler wird aufgezeichnet; andere fahren fort | Best-Effort pro Server |
| `tools/list` beim Startup noch ausstehend mit Cache-Treffer | Deferred-Tools werden sofort zurückgegeben | Best-Effort schneller Start |
| `tools/list` beim Startup noch ausstehend ohne Cache | Startup wartet auf Abschluss der ausstehenden Aufgaben | Hartes Warten auf Korrektheit |
| Später Hintergrund-Tool-Ladefehler | Wird nach dem Startup-Gate protokolliert | Best-Effort-Protokollierung |
| Laufzeit-Transportabbruch | Keine automatische Wiederverbindung; zukünftige Aufrufe schlagen fehl bis zur Wiederverbindung/Neuladung | Best-Effort-Wiederherstellung durch manuelle Aktion |

## Öffentliche API-Oberfläche

`src/mcp/index.ts` re-exportiert Loader/Manager/Client-APIs für externe Aufrufer. `src/sdk.ts` stellt `discoverMCPServers()` als Komfort-Wrapper bereit, der die gleiche Loader-Ergebnisstruktur zurückgibt.

## Implementierungsdateien

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — Loader-Fassade, Normalisierung von Entdeckungsfehlern, `LoadedCustomTool`-Konvertierung.
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — Lebenszyklus-Zustandsregistries, paralleler Verbindungs-/Listenauflistungsablauf, Aktualisierung/Trennung.
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — Transport-Setup, Initialisierungs-Handshake, Auflisten/Aufrufen/Trennen.
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — MCP-Modul-API-Exporte.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — Startup-Verdrahtung in Sitzung/Tool-Registry.
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — Konfigurationsentdeckung/-filterung/-validierung, die vom Manager verwendet wird.
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — `MCPTool`- und `DeferredMCPTool`-Laufzeitverhalten.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `refreshMCPTools` Live-Neubindung.
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — Interaktive Neuladeungs-/Wiederverbindungsabläufe.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — Subagent-MCP-Proxying über übergeordnete Manager-Verbindungen.
