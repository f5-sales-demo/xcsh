---
title: MCP-Server- und Tool-Erstellung
description: >-
  Leitfaden zum Erstellen benutzerdefinierter MCP-Server und zur Registrierung
  von Tools für den Coding-Agent.
sidebar:
  order: 4
  label: Server- & Tool-Erstellung
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# MCP-Server- und Tool-Erstellung

Dieses Dokument erläutert, wie MCP-Server-Definitionen zu aufrufbaren `mcp_*`-Tools im Coding-Agent werden, und was Operatoren erwarten sollten, wenn Konfigurationen ungültig, dupliziert, deaktiviert oder durch Authentifizierung geschützt sind.

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

`src/mcp/types.ts` definiert die Erstellungsstruktur, die von MCP-Konfigurationsautoren und zur Laufzeit verwendet wird:

- `stdio` (Standard, wenn `type` fehlt): erfordert `command`, optional `args`, `env`, `cwd`
- `http`: erfordert `url`, optional `headers`
- `sse`: erfordert `url`, optional `headers` (aus Kompatibilitätsgründen beibehalten)
- Gemeinsame Felder: `enabled`, `timeout`, `auth`

`validateServerConfig()` (`src/mcp/config.ts`) erzwingt grundlegende Transport-Regeln:

- Lehnt Konfigurationen ab, die sowohl `command` als auch `url` setzen
- Erfordert `command` für stdio
- Erfordert `url` für http/sse
- Lehnt unbekannte `type`-Werte ab

`config-writer.ts` wendet diese Validierung für Hinzufüge-/Aktualisierungsoperationen an und validiert auch Servernamen:

- Nicht leer
- Maximal 100 Zeichen
- Nur `[a-zA-Z0-9_.-]`

### Transport-Fallstricke

- Fehlendes `type` bedeutet stdio. Wenn Sie HTTP/SSE beabsichtigt, aber `type` weggelassen haben, wird `command` obligatorisch.
- `sse` wird weiterhin akzeptiert, aber intern als HTTP-Transport behandelt (`createHttpTransport`).
- Die Validierung ist strukturell, nicht erreichbarkeitsbezogen: Eine syntaktisch gültige URL kann trotzdem beim Verbindungsaufbau fehlschlagen.

## 2) Erkennung, Normalisierung und Prioritäten

### Capability-basierte Erkennung

`loadAllMCPConfigs()` (`src/mcp/config.ts`) lädt kanonische `MCPServer`-Einträge über `loadCapability(mcpCapability.id)`.

Die Capability-Schicht (`src/capability/index.ts`) führt dann folgendes aus:

1. Lädt Provider in Prioritätsreihenfolge
2. Dedupliziert nach `server.name` (erster Treffer = höchste Priorität)
3. Validiert die deduplizierten Einträge

Ergebnis: Doppelte Servernamen über verschiedene Quellen hinweg werden nicht zusammengeführt. Eine Definition gewinnt; Duplikate mit niedrigerer Priorität werden überdeckt.

### `.mcp.json` und verwandte Dateien

Der dedizierte Fallback-Provider in `src/discovery/mcp-json.ts` liest `mcp.json` und `.mcp.json` aus dem Projektstammverzeichnis (niedrige Priorität).

In der Praxis kommen MCP-Server auch von Providern mit höherer Priorität (zum Beispiel native `.xcsh/...`- und toolspezifische Konfigurationsverzeichnisse). Hinweise zur Erstellung:

- Bevorzugen Sie `.xcsh/mcp.json` (Projekt) oder `~/.xcsh/mcp.json` (Benutzer) für explizite Kontrolle.
- Verwenden Sie `mcp.json` / `.mcp.json` im Stammverzeichnis, wenn Sie Fallback-Kompatibilität benötigen.
- Die Wiederverwendung desselben Servernamens in mehreren Quellen verursacht Prioritäts-Überdeckung, keine Zusammenführung.

### Normalisierungsverhalten

`convertToLegacyConfig()` (`src/mcp/config.ts`) bildet kanonische `MCPServer` auf die Laufzeit-`MCPServerConfig` ab.

Wichtiges Verhalten:

- Transport wird abgeleitet als `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- Deaktivierte Server (`enabled === false`) werden vor dem Verbindungsaufbau entfernt
- Optionale Felder werden beibehalten, wenn vorhanden

### Umgebungsvariablen-Expansion während der Erkennung

`mcp-json.ts` expandiert Umgebungsvariablen-Platzhalter in String-Feldern mit `expandEnvVarsDeep()`:

- Unterstützt `${VAR}` und `${VAR:-default}`
- Nicht aufgelöste Werte bleiben als literale `${VAR}`-Strings erhalten

`mcp-json.ts` führt auch Laufzeit-Typprüfungen für Benutzer-JSON durch und protokolliert Warnungen für ungültige `enabled`/`timeout`-Werte, anstatt die gesamte Datei fehlschlagen zu lassen.

## 3) Authentifizierung und Laufzeitwert-Auflösung

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) ist der letzte Durchlauf vor dem Verbindungsaufbau.

### OAuth-Anmeldedaten-Injektion

Wenn die Konfiguration folgendes enthält:

```ts
auth: { type: "oauth", credentialId: "..." }
```

und die Anmeldedaten im Auth-Speicher existieren:

- `http`/`sse`: Injiziert `Authorization: Bearer <access_token>`-Header
- `stdio`: Injiziert `OAUTH_ACCESS_TOKEN`-Umgebungsvariable

Wenn die Anmeldedaten-Suche fehlschlägt, protokolliert der Manager eine Warnung und fährt mit nicht aufgelöster Authentifizierung fort.

### Header-/Umgebungsvariablen-Wertauflösung

Vor dem Verbindungsaufbau löst der Manager jeden Header-/Umgebungsvariablen-Wert über `resolveConfigValue()` (`src/config/resolve-config-value.ts`) auf:

- Wert beginnt mit `!` => Shell-Befehl ausführen, getrimmte Stdout-Ausgabe verwenden (gecacht)
- Andernfalls wird der Wert zuerst als Umgebungsvariablenname behandelt (`process.env[name]`), Fallback auf den literalen Wert
- Nicht aufgelöste Befehls-/Umgebungsvariablen-Werte werden aus der finalen Header-/Umgebungsvariablen-Map weggelassen

Betrieblicher Hinweis: Dies bedeutet, dass ein falsch geschriebener Secret-Befehl/Umgebungsvariablen-Schlüssel stillschweigend diesen Header-/Umgebungsvariablen-Eintrag entfernen kann, was nachgelagert 401/403-Fehler oder Server-Startfehler verursacht.

## 4) Tool-Bridge: MCP -> Agent-aufrufbare Tools

`src/mcp/tool-bridge.ts` konvertiert MCP-Tool-Definitionen in `CustomTool`s.

### Benennung und Kollisionsdomäne

Tool-Namen werden generiert als:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

Regeln:

- Kleinbuchstaben
- Nicht-`[a-z_]`-Zeichen werden zu `_`
- Wiederholte Unterstriche werden zusammengefasst
- Redundantes `<server>_`-Präfix im Tool-Namen wird einmal entfernt

Dies vermeidet viele Kollisionen, aber nicht alle. Verschiedene Rohnamen können dennoch zum selben Bezeichner sanitisiert werden (zum Beispiel werden `my-server` und `my.server` ähnlich sanitisiert), und die Registry-Einfügung erfolgt nach dem Last-Write-Wins-Prinzip.

### Schema-Abbildung

`convertSchema()` behält das MCP-JSON-Schema weitgehend unverändert bei, ergänzt aber Objekt-Schemas ohne `properties` mit `{}` für Provider-Kompatibilität.

### Ausführungs-Abbildung

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- Ruft MCP `tools/call` auf
- Flacht MCP-Inhalte in darstellbaren Text ab
- Gibt strukturierte Details zurück (`serverName`, `mcpToolName`, Provider-Metadaten)
- Bildet vom Server gemeldete `isError`-Werte auf `Error: ...`-Textergebnisse ab
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

### Modusunterschiede

- **Interaktiver/TUI-Modus**: `/mcp` bietet eine In-App-Benutzeroberfläche (Assistent, OAuth-Flow, Verbindungsstatus-Text, sofortige Laufzeit-Neubindung).
- **SDK/Headless-Integration**: `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) gibt geladene Tools + Fehler pro Server zurück; keine `/mcp`-Befehls-UX.

## 6) Benutzer-sichtbare Fehlermeldungen

Häufige Fehlermeldungen, die Benutzer/Operatoren sehen:

- Validierungsfehler beim Hinzufügen/Aktualisieren:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- Probleme mit Schnellhinzufügungs-Argumenten:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- Verbindungs-/Testfehler:
  - `Failed to connect to "<name>": <message>`
  - Timeout-Hilfetext schlägt vor, das Timeout zu erhöhen
  - Auth-Hilfetext für `401/403`
- Auth/OAuth-Flows:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- Verwendung deaktivierter Server:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

Fehlerhaftes Quell-JSON bei der Erkennung wird generell als Warnungen/Logs behandelt; Config-Writer-Pfade werfen explizite Fehler.

## 7) Praktische Hinweise zur Erstellung

Für robuste MCP-Erstellung in dieser Codebasis:

1. Halten Sie Servernamen global eindeutig über alle MCP-fähigen Konfigurationsquellen hinweg.
2. Bevorzugen Sie alphanumerische/Unterstrich-Namen, um Kollisionen durch sanitisierte Namen in generierten `mcp_*`-Tool-Namen zu vermeiden.
3. Verwenden Sie explizite `type`-Angaben, um versehentliche stdio-Standards zu vermeiden.
4. Behandeln Sie `enabled: false` als vollständige Deaktivierung: Der Server wird aus dem Laufzeit-Verbindungsset ausgelassen.
5. Speichern Sie für OAuth-Konfigurationen eine gültige `credentialId`; andernfalls wird die Auth-Injektion übersprungen.
6. Wenn Sie befehlsbasierte Secret-Auflösung (`!cmd`) verwenden, überprüfen Sie, dass die Befehlsausgabe stabil und nicht leer ist.

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
