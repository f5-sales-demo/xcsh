---
title: MCP-Server- und Tool-Erstellung
description: >-
  Anleitung zum Erstellen benutzerdefinierter MCP-Server und Registrieren von
  Tools für den Coding-Agent.
sidebar:
  order: 4
  label: Server- & Tool-Erstellung
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# MCP-Server- und Tool-Erstellung

Dieses Dokument erklärt, wie MCP-Server-Definitionen zu aufrufbaren `mcp_*`-Tools im Coding-Agent werden und was Operatoren erwarten sollten, wenn Konfigurationen ungültig, dupliziert, deaktiviert oder durch Authentifizierung geschützt sind.

## Architektur im Überblick

```text
Config sources (.xcsh/.claude/.cursor/.vscode/mcp.json, mcp.json, etc.)
  -> discovery providers normalize to canonical MCPServer
  -> capability loader dedupes by server name (higher provider priority wins)
  -> loadAllMCPConfigs converts to MCPServerConfig + skips enabled:false
  -> MCPManager connects/listTools (with auth/header/env resolution)
  -> MCPTool/DeferredMCPTool bridge exposes tools as mcp_<server>_<tool>
  -> AgentSession.refreshMCPTools replaces live MCP tools immediately
```

## 1) Server-Konfigurationsmodell und Validierung

`src/mcp/types.ts` definiert die Autorenstruktur, die von MCP-Konfigurationsschreibern und der Laufzeitumgebung verwendet wird:

- `stdio` (Standard wenn `type` fehlt): erfordert `command`, optional `args`, `env`, `cwd`
- `http`: erfordert `url`, optional `headers`
- `sse`: erfordert `url`, optional `headers` (aus Kompatibilitätsgründen beibehalten)
- gemeinsame Felder: `enabled`, `timeout`, `auth`

`validateServerConfig()` (`src/mcp/config.ts`) erzwingt Transport-Grundlagen:

- lehnt Konfigurationen ab, die sowohl `command` als auch `url` setzen
- erfordert `command` für stdio
- erfordert `url` für http/sse
- lehnt unbekannte `type`-Werte ab

`config-writer.ts` wendet diese Validierung für Hinzufüge-/Aktualisierungsoperationen an und validiert auch Servernamen:

- nicht leer
- maximal 100 Zeichen
- nur `[a-zA-Z0-9_.-]`

### Transport-Fallstricke

- Wenn `type` weggelassen wird, bedeutet das stdio. Wenn Sie HTTP/SSE beabsichtigt haben, aber `type` weggelassen haben, wird `command` obligatorisch.
- `sse` wird weiterhin akzeptiert, aber intern als HTTP-Transport behandelt (`createHttpTransport`).
- Die Validierung ist strukturell, nicht auf Erreichbarkeit bezogen: Eine syntaktisch gültige URL kann beim Verbindungsaufbau dennoch fehlschlagen.

## 2) Erkennung, Normalisierung und Priorität

### Capability-basierte Erkennung

`loadAllMCPConfigs()` (`src/mcp/config.ts`) lädt kanonische `MCPServer`-Einträge über `loadCapability(mcpCapability.id)`.

Die Capability-Schicht (`src/capability/index.ts`) führt dann folgende Schritte aus:

1. Lädt Provider in Prioritätsreihenfolge
2. Dedupliziert nach `server.name` (erster Treffer = höchste Priorität)
3. Validiert deduplizierte Einträge

Ergebnis: Doppelte Servernamen über verschiedene Quellen hinweg werden nicht zusammengeführt. Eine Definition gewinnt; Duplikate mit niedrigerer Priorität werden überschattet.

### `.mcp.json` und verwandte Dateien

Der dedizierte Fallback-Provider in `src/discovery/mcp-json.ts` liest `mcp.json` und `.mcp.json` im Projektstammverzeichnis (niedrige Priorität).

In der Praxis kommen MCP-Server auch von Providern mit höherer Priorität (zum Beispiel native `.xcsh/...`- und toolspezifische Konfigurationsverzeichnisse). Empfehlungen für die Erstellung:

- Bevorzugen Sie `.xcsh/mcp.json` (Projekt) oder `~/.xcsh/mcp.json` (Benutzer) für explizite Kontrolle.
- Verwenden Sie `mcp.json` / `.mcp.json` im Stammverzeichnis, wenn Sie Fallback-Kompatibilität benötigen.
- Die Wiederverwendung desselben Servernamens in mehreren Quellen verursacht Prioritäts-Überschattung, keine Zusammenführung.

### Normalisierungsverhalten

`convertToLegacyConfig()` (`src/mcp/config.ts`) bildet kanonische `MCPServer` auf Laufzeit-`MCPServerConfig` ab.

Wichtiges Verhalten:

- Transport wird abgeleitet als `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- Deaktivierte Server (`enabled === false`) werden vor dem Verbindungsaufbau entfernt
- Optionale Felder werden beibehalten, wenn vorhanden

### Umgebungsvariablen-Expansion während der Erkennung

`mcp-json.ts` expandiert Umgebungsvariablen-Platzhalter in Zeichenkettenfeldern mit `expandEnvVarsDeep()`:

- Unterstützt `${VAR}` und `${VAR:-default}`
- Nicht aufgelöste Werte bleiben als literale `${VAR}`-Zeichenketten erhalten

`mcp-json.ts` führt außerdem Laufzeit-Typprüfungen für Benutzer-JSON durch und protokolliert Warnungen für ungültige `enabled`/`timeout`-Werte, anstatt die gesamte Datei fehlschlagen zu lassen.

## 3) Authentifizierung und Laufzeitwert-Auflösung

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) ist der letzte Durchlauf vor dem Verbindungsaufbau.

### OAuth-Anmeldedaten-Injektion

Wenn die Konfiguration folgendes enthält:

```ts
auth: { type: "oauth", credentialId: "..." }
```

und die Anmeldedaten im Authentifizierungsspeicher vorhanden sind:

- `http`/`sse`: injiziert `Authorization: Bearer <access_token>`-Header
- `stdio`: injiziert `OAUTH_ACCESS_TOKEN`-Umgebungsvariable

Wenn die Anmeldedaten-Suche fehlschlägt, protokolliert der Manager eine Warnung und fährt mit nicht aufgelöster Authentifizierung fort.

### Header-/Umgebungswert-Auflösung

Vor dem Verbindungsaufbau löst der Manager jeden Header-/Umgebungswert über `resolveConfigValue()` (`src/config/resolve-config-value.ts`) auf:

- Wert beginnt mit `!` => Shell-Befehl ausführen, getrimmte stdout verwenden (gecacht)
- Andernfalls wird der Wert zuerst als Umgebungsvariablenname behandelt (`process.env[name]`), Fallback auf literalen Wert
- Nicht aufgelöste Befehls-/Umgebungswerte werden aus der finalen Headers-/Umgebungs-Map weggelassen

Betrieblicher Hinweis: Dies bedeutet, dass ein falsch geschriebener geheimer Befehls-/Umgebungsschlüssel diesen Header-/Umgebungseintrag stillschweigend entfernen kann, was nachgelagert zu 401/403-Fehlern oder Server-Startfehlern führt.

## 4) Tool-Brücke: MCP -> vom Agent aufrufbare Tools

`src/mcp/tool-bridge.ts` konvertiert MCP-Tool-Definitionen in `CustomTool`s.

### Benennung und Kollisionsdomäne

Tool-Namen werden wie folgt generiert:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

Regeln:

- Kleinschreibung
- Nicht-`[a-z_]`-Zeichen werden zu `_`
- Aufeinanderfolgende Unterstriche werden zusammengefasst
- Redundantes `<server>_`-Präfix im Tool-Namen wird einmal entfernt

Dies vermeidet viele Kollisionen, aber nicht alle. Verschiedene Rohnamen können immer noch zum selben Bezeichner bereinigt werden (zum Beispiel bereinigen sich `my-server` und `my.server` ähnlich), und die Registry-Einfügung funktioniert nach dem Last-Write-Wins-Prinzip.

### Schema-Zuordnung

`convertSchema()` behält das MCP-JSON-Schema weitgehend bei, patcht aber Object-Schemas ohne `properties` mit `{}` für Provider-Kompatibilität.

### Ausführungszuordnung

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- Ruft MCP `tools/call` auf
- Flacht MCP-Inhalte zu anzeigbarem Text ab
- Gibt strukturierte Details zurück (`serverName`, `mcpToolName`, Provider-Metadaten)
- Bildet vom Server gemeldetes `isError` auf `Error: ...`-Textergebnis ab
- Bildet geworfene Transport-/Laufzeitfehler auf `MCP error: ...` ab
- Bewahrt Abbruch-Semantik durch Übersetzung von AbortError in `ToolAbortError`

## 5) Operator-Lebenszyklus: Hinzufügen/Bearbeiten/Entfernen und Live-Updates

Der interaktive Modus stellt `/mcp` in `src/modes/controllers/mcp-command-controller.ts` bereit.

Unterstützte Operationen:

- `add` (Assistent oder Schnellhinzufügung)
- `remove` / `rm`
- `enable` / `disable`
- `test`
- `reauth` / `unauth`
- `reload`

Konfigurationsschreibvorgänge sind atomar (`writeMCPConfigFile`: temporäre Datei + Umbenennung).

Nach Änderungen ruft der Controller `#reloadMCP()` auf:

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

`refreshMCPTools()` ersetzt alle `mcp_`-Registry-Einträge und reaktiviert sofort den neuesten MCP-Tool-Satz, sodass Änderungen ohne Neustart der Sitzung wirksam werden.

### Modus-Unterschiede

- **Interaktiver/TUI-Modus**: `/mcp` bietet eine In-App-Benutzeroberfläche (Assistent, OAuth-Flow, Verbindungsstatus-Text, sofortige Laufzeit-Neubindung).
- **SDK/Headless-Integration**: `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) gibt geladene Tools + pro-Server-Fehler zurück; keine `/mcp`-Befehlsoberfläche.

## 6) Benutzersichtbare Fehleroberflächen

Häufige Fehlermeldungen, die Benutzer/Operatoren sehen:

- Validierungsfehler beim Hinzufügen/Aktualisieren:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- Probleme mit Schnellhinzufüge-Argumenten:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- Verbindungs-/Testfehler:
  - `Failed to connect to "<name>": <message>`
  - Timeout-Hilfetext schlägt vor, den Timeout zu erhöhen
  - Authentifizierungs-Hilfetext für `401/403`
- Authentifizierungs-/OAuth-Flows:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- Verwendung deaktivierter Server:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

Fehlerhaftes Quell-JSON bei der Erkennung wird in der Regel als Warnungen/Protokolle behandelt; Config-Writer-Pfade werfen explizite Fehler.

## 7) Praktische Erstellungshinweise

Für robuste MCP-Erstellung in dieser Codebasis:

1. Halten Sie Servernamen global eindeutig über alle MCP-fähigen Konfigurationsquellen hinweg.
2. Bevorzugen Sie alphanumerische Zeichen/Unterstriche für Namen, um bereinigte Namenskollisionen in generierten `mcp_*`-Tool-Namen zu vermeiden.
3. Verwenden Sie einen expliziten `type`, um versehentliche stdio-Standards zu vermeiden.
4. Behandeln Sie `enabled: false` als harte Abschaltung: Der Server wird aus dem Laufzeit-Verbindungssatz ausgelassen.
5. Speichern Sie für OAuth-Konfigurationen eine gültige `credentialId`; andernfalls wird die Authentifizierungs-Injektion übersprungen.
6. Wenn Sie befehlsbasierte Geheimnis-Auflösung (`!cmd`) verwenden, überprüfen Sie, dass die Befehlsausgabe stabil und nicht leer ist.

## Implementierungsdateien

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts)
- [`src/mcp/config-writer.ts`](../../packages/coding-agent/src/mcp/config-writer.ts)
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts)
- [`src/discovery/mcp-json.ts`](../../packages/coding-agent/src/discovery/mcp-json.ts)
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/config/resolve-config-value.ts`](../../packages/coding-agent/src/config/resolve-config-value.ts)
- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts)
