---
title: MCP-Server und Tool-Erstellung
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

# MCP-Server und Tool-Erstellung

Dieses Dokument erklärt, wie MCP-Server-Definitionen zu aufrufbaren `mcp_*`-Tools im Coding-Agent werden, und was Operatoren erwarten sollten, wenn Konfigurationen ungültig, dupliziert, deaktiviert oder durch Authentifizierung geschützt sind.

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

`src/mcp/types.ts` definiert die Authoring-Struktur, die von MCP-Konfigurationsautoren und zur Laufzeit verwendet wird:

- `stdio` (Standard, wenn `type` fehlt): erfordert `command`, optional `args`, `env`, `cwd`
- `http`: erfordert `url`, optional `headers`
- `sse`: erfordert `url`, optional `headers` (aus Kompatibilitätsgründen beibehalten)
- gemeinsame Felder: `enabled`, `timeout`, `auth`

`validateServerConfig()` (`src/mcp/config.ts`) erzwingt Transport-Grundlagen:

- lehnt Konfigurationen ab, die sowohl `command` als auch `url` setzen
- erfordert `command` für stdio
- erfordert `url` für http/sse
- lehnt unbekannten `type` ab

`config-writer.ts` wendet diese Validierung für Hinzufüge-/Aktualisierungsoperationen an und validiert auch Servernamen:

- nicht leer
- maximal 100 Zeichen
- nur `[a-zA-Z0-9_.-]`

### Transport-Fallstricke

- Fehlendes `type` bedeutet stdio. Wenn Sie HTTP/SSE beabsichtigt, aber `type` weggelassen haben, wird `command` verpflichtend.
- `sse` wird weiterhin akzeptiert, aber intern als HTTP-Transport behandelt (`createHttpTransport`).
- Die Validierung ist strukturell, nicht auf Erreichbarkeit bezogen: Eine syntaktisch gültige URL kann trotzdem beim Verbindungsaufbau fehlschlagen.

## 2) Erkennung, Normalisierung und Prioritätsreihenfolge

### Capability-basierte Erkennung

`loadAllMCPConfigs()` (`src/mcp/config.ts`) lädt kanonische `MCPServer`-Einträge über `loadCapability(mcpCapability.id)`.

Die Capability-Schicht (`src/capability/index.ts`) führt dann folgende Schritte aus:

1. Lädt Provider in Prioritätsreihenfolge
2. Dedupliziert nach `server.name` (erster Treffer = höchste Priorität)
3. Validiert deduplizierte Einträge

Ergebnis: Doppelte Servernamen über verschiedene Quellen hinweg werden nicht zusammengeführt. Eine Definition gewinnt; Duplikate mit niedrigerer Priorität werden überdeckt.

### `.mcp.json` und verwandte Dateien

Der dedizierte Fallback-Provider in `src/discovery/mcp-json.ts` liest `mcp.json` und `.mcp.json` aus dem Projektstammverzeichnis (niedrige Priorität).

In der Praxis stammen MCP-Server auch aus Providern mit höherer Priorität (zum Beispiel native `.xcsh/...` und tool-spezifische Konfigurationsverzeichnisse). Authoring-Empfehlungen:

- Bevorzugen Sie `.xcsh/mcp.json` (Projekt) oder `~/.xcsh/mcp.json` (Benutzer) für explizite Kontrolle.
- Verwenden Sie `mcp.json` / `.mcp.json` im Stammverzeichnis, wenn Sie Fallback-Kompatibilität benötigen.
- Die Wiederverwendung desselben Servernamens in mehreren Quellen führt zu Prioritäts-Überdeckung, nicht zu Zusammenführung.

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

`mcp-json.ts` führt außerdem Laufzeit-Typprüfungen für Benutzer-JSON durch und protokolliert Warnungen für ungültige `enabled`/`timeout`-Werte, anstatt die gesamte Datei zum Scheitern zu bringen.

## 3) Authentifizierung und Laufzeitwert-Auflösung

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) ist der letzte Durchlauf vor dem Verbindungsaufbau.

### OAuth-Credential-Injektion

Wenn die Konfiguration Folgendes enthält:

```ts
auth: { type: "oauth", credentialId: "..." }
```

und das Credential im Auth-Speicher existiert:

- `http`/`sse`: Injiziert `Authorization: Bearer <access_token>` Header
- `stdio`: Injiziert `OAUTH_ACCESS_TOKEN` Umgebungsvariable

Wenn die Credential-Suche fehlschlägt, protokolliert der Manager eine Warnung und fährt mit nicht aufgelöster Authentifizierung fort.

### Header-/Umgebungsvariablen-Wertauflösung

Vor dem Verbindungsaufbau löst der Manager jeden Header-/Umgebungsvariablen-Wert über `resolveConfigValue()` (`src/config/resolve-config-value.ts`) auf:

- Wert beginnt mit `!` => Shell-Befehl ausführen, getrimmte Stdout-Ausgabe verwenden (gecacht)
- Andernfalls Wert zunächst als Umgebungsvariablenname behandeln (`process.env[name]`), Fallback auf literalen Wert
- Nicht aufgelöste Befehls-/Umgebungsvariablen-Werte werden aus der finalen Header-/Umgebungsvariablen-Map weggelassen

Betrieblicher Hinweis: Dies bedeutet, dass ein falsch geschriebener Secret-Befehl/Umgebungsvariablen-Schlüssel stillschweigend diesen Header-/Umgebungsvariablen-Eintrag entfernen kann, was nachgelagert zu 401/403-Fehlern oder Server-Startfehlern führt.

## 4) Tool-Bridge: MCP -> vom Agent aufrufbare Tools

`src/mcp/tool-bridge.ts` konvertiert MCP-Tool-Definitionen in `CustomTool`s.

### Benennung und Kollisionsbereich

Tool-Namen werden wie folgt generiert:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

Regeln:

- Kleinschreibung
- Nicht-`[a-z_]`-Zeichen werden zu `_`
- Aufeinanderfolgende Unterstriche werden zusammengefasst
- Redundantes `<server>_`-Präfix im Tool-Namen wird einmal entfernt

Dies vermeidet viele Kollisionen, aber nicht alle. Unterschiedliche Rohnamen können trotzdem zum selben Bezeichner bereinigt werden (zum Beispiel werden `my-server` und `my.server` ähnlich bereinigt), und die Registry-Einfügung funktioniert nach dem Prinzip "letzter Schreibvorgang gewinnt".

### Schema-Mapping

`convertSchema()` behält MCP JSON Schema weitgehend unverändert bei, ergänzt aber Objekt-Schemas ohne `properties` mit `{}` für Provider-Kompatibilität.

### Ausführungs-Mapping

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- Ruft MCP `tools/call` auf
- Flacht MCP-Inhalte zu darstellbarem Text ab
- Gibt strukturierte Details zurück (`serverName`, `mcpToolName`, Provider-Metadaten)
- Bildet server-gemeldetes `isError` auf `Error: ...`-Textergebnis ab
- Bildet geworfene Transport-/Laufzeitfehler auf `MCP error: ...` ab
- Erhält Abbruch-Semantik durch Übersetzung von AbortError in `ToolAbortError`

## 5) Operator-Lebenszyklus: Hinzufügen/Bearbeiten/Entfernen und Live-Updates

Der interaktive Modus stellt `/mcp` in `src/modes/controllers/mcp-command-controller.ts` bereit.

Unterstützte Operationen:

- `add` (Assistent oder Schnell-Hinzufügen)
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

`refreshMCPTools()` ersetzt alle `mcp_`-Registry-Einträge und reaktiviert sofort den aktuellsten MCP-Tool-Satz, sodass Änderungen ohne Neustart der Sitzung wirksam werden.

### Modus-Unterschiede

- **Interaktiver/TUI-Modus**: `/mcp` bietet eine In-App-Benutzeroberfläche (Assistent, OAuth-Flow, Verbindungsstatus-Text, sofortige Laufzeit-Neubindung).
- **SDK-/Headless-Integration**: `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) gibt geladene Tools + pro-Server-Fehler zurück; keine `/mcp`-Befehlsoberfläche.

## 6) Für Benutzer sichtbare Fehleroberflächen

Häufige Fehlermeldungen, die Benutzer/Operatoren sehen:

- Validierungsfehler beim Hinzufügen/Aktualisieren:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- Probleme mit Schnell-Hinzufügen-Argumenten:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- Verbindungs-/Testfehler:
  - `Failed to connect to "<name>": <message>`
  - Timeout-Hilfetext schlägt eine Erhöhung des Timeouts vor
  - Auth-Hilfetext für `401/403`
- Auth-/OAuth-Flows:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- Verwendung deaktivierter Server:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

Fehlerhaftes Quell-JSON bei der Erkennung wird generell als Warnungen/Logs behandelt; Config-Writer-Pfade werfen explizite Fehler.

## 7) Praktische Authoring-Empfehlungen

Für robustes MCP-Authoring in dieser Codebasis:

1. Halten Sie Servernamen über alle MCP-fähigen Konfigurationsquellen hinweg global eindeutig.
2. Bevorzugen Sie alphanumerische/Unterstrich-Namen, um bereinigte Namenskollisionen in generierten `mcp_*`-Tool-Namen zu vermeiden.
3. Verwenden Sie explizites `type`, um versehentliche stdio-Standardwerte zu vermeiden.
4. Behandeln Sie `enabled: false` als vollständige Deaktivierung: Der Server wird aus dem Laufzeit-Verbindungssatz ausgelassen.
5. Für OAuth-Konfigurationen speichern Sie eine gültige `credentialId`; andernfalls wird die Auth-Injektion übersprungen.
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
