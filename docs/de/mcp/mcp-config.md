---
title: MCP-Konfiguration
description: >-
  MCP-Server-Konfiguration, Validierung und Verwaltung für die Laufzeitumgebung
  des Coding-Agenten.
sidebar:
  order: 1
  label: Konfiguration
i18n:
  sourceHash: e4f56e8becc6
  translator: machine
---

# MCP-Konfiguration in OMP

Diese Anleitung erklärt, wie Sie MCP-Server für den OMP-Coding-Agenten hinzufügen, bearbeiten und validieren.

Maßgebliche Quelldateien im Code:

- Laufzeit-Konfigurationstypen: `packages/coding-agent/src/mcp/types.ts`
- Config-Writer: `packages/coding-agent/src/mcp/config-writer.ts`
- Loader + Validierung: `packages/coding-agent/src/mcp/config.ts`
- Standalone `mcp.json`-Erkennung: `packages/coding-agent/src/discovery/mcp-json.ts`
- Schema: `packages/coding-agent/src/config/mcp-schema.json`

## Bevorzugte Konfigurationsorte

OMP kann MCP-Server aus mehreren Tools erkennen (`.claude/`, `.cursor/`, `.vscode/`, `opencode.json` und weitere), aber für die OMP-native Konfiguration sollten Sie in der Regel eine dieser Dateien verwenden:

- Projekt: `.xcsh/mcp.json`
- Benutzer: `~/.xcsh/mcp.json`

OMP akzeptiert auch Fallback-Standalone-Dateien im Projektstammverzeichnis:

- `mcp.json`
- `.mcp.json`

Verwenden Sie `.xcsh/mcp.json`, wenn OMP die Konfiguration verwalten soll. Verwenden Sie `mcp.json` / `.mcp.json` im Stammverzeichnis nur, wenn Sie eine portable Fallback-Datei benötigen, die auch andere MCP-Clients lesen können.

## Schema-Referenz hinzufügen

Fügen Sie diese Zeile am Anfang der Datei hinzu, um Editor-Autovervollständigung und Validierung zu erhalten:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {}
}
```

OMP schreibt dies nun automatisch, wenn `/mcp add`, `/mcp enable`, `/mcp disable`, `/mcp reauth` oder andere konfigurationsschreibende Abläufe eine OMP-verwaltete MCP-Datei erstellen oder aktualisieren.

## Dateistruktur

OMP unterstützt diese Top-Level-Struktur:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-mcp-server"]
    }
  },
  "disabledServers": ["server-name"]
}
```

Top-Level-Schlüssel:

- `$schema` — optionale JSON-Schema-URL für Tooling
- `mcpServers` — Zuordnung von Servernamen zu Serverkonfiguration
- `disabledServers` — Benutzerseitige Sperrliste, um erkannte Server anhand ihres Namens zu deaktivieren

Servernamen müssen dem Muster `^[a-zA-Z0-9_.-]{1,100}$` entsprechen.

## Unterstützte Serverfelder

Gemeinsame Felder für alle Transportarten:

- `enabled?: boolean` — überspringt diesen Server, wenn `false`
- `timeout?: number` — Verbindungs-Timeout in Millisekunden
- `auth?: { ... }` — Auth-Metadaten, die OMP für OAuth/API-Key-Flows verwendet
- `oauth?: { ... }` — explizite OAuth-Client-Einstellungen, die während der Authentifizierung/Reauthentifizierung verwendet werden

### `stdio`-Transport

`stdio` ist der Standard, wenn `type` weggelassen wird.

Erforderlich:

- `command: string`

Optional:

- `type?: "stdio"`
- `args?: string[]`
- `env?: Record<string, string>`
- `cwd?: string`

Beispiel:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/alice/projects",
        "/Users/alice/Documents"
      ]
    }
  }
}
```

Dies folgt dem offiziellen Filesystem-MCP-Server-Paket (`@modelcontextprotocol/server-filesystem`).

### `http`-Transport

Erforderlich:

- `type: "http"`
- `url: string`

Optional:

- `headers?: Record<string, string>`

Beispiel:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

Dies entspricht GitHubs gehostetem GitHub-MCP-Server-Endpunkt.

### `sse`-Transport

Erforderlich:

- `type: "sse"`
- `url: string`

Optional:

- `headers?: Record<string, string>`

Beispiel:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "legacy-remote": {
      "type": "sse",
      "url": "https://example.com/mcp/sse"
    }
  }
}
```

`sse` wird weiterhin aus Kompatibilitätsgründen unterstützt, aber die MCP-Spezifikation bevorzugt jetzt Streamable HTTP (`type: "http"`) für neue Server.

## Auth-Felder

OMP versteht zwei authentifizierungsbezogene Objekte.

### `auth`

```json
{
  "type": "oauth" | "apikey",
  "credentialId": "optional-stored-credential-id",
  "tokenUrl": "optional-token-endpoint",
  "clientId": "optional-client-id",
  "clientSecret": "optional-client-secret"
}
```

Verwenden Sie dies, wenn OMP sich merken soll, wie Anmeldedaten für einen Server wiederhergestellt werden.

### `oauth`

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "redirectUri": "...",
  "callbackPort": 3334,
  "callbackPath": "/oauth/callback"
}
```

Verwenden Sie dies, wenn der MCP-Server explizite OAuth-Client-Einstellungen erfordert.

Slack ist derzeit das deutlichste Beispiel. Slacks MCP-Server wird unter `https://mcp.slack.com/mcp` gehostet, verwendet Streamable HTTP und erfordert vertrauliches OAuth mit den Client-Anmeldedaten Ihrer Slack-App.

Beispiel:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

Relevante Slack-Endpunkte aus der Slack-Dokumentation:

- MCP-Endpunkt: `https://mcp.slack.com/mcp`
- Autorisierungsendpunkt: `https://slack.com/oauth/v2_user/authorize`
- Token-Endpunkt: `https://slack.com/api/oauth.v2.user.access`

## Gängige Copy-Paste-Beispiele

### Filesystem-Server via stdio

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/absolute/path/one",
        "/absolute/path/two"
      ]
    }
  }
}
```

### Gehosteter GitHub-Server via HTTP

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

### Lokaler GitHub-Server via Docker

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
      }
    }
  }
}
```

Dies entspricht GitHubs offiziellem lokalen Docker-Image `ghcr.io/github/github-mcp-server`.

### Gehosteter Slack-Server via OAuth

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

## Secrets und Variablenauflösung

Dies ist der Teil, der die meisten Benutzer stolpern lässt.

### In `.xcsh/mcp.json` und `~/.xcsh/mcp.json`

Bevor OMP einen Server startet oder eine HTTP-Anfrage ausführt, löst es `env`- und `headers`-Werte wie folgt auf:

1. Wenn ein Wert mit `!` beginnt, führt OMP ihn als Shell-Befehl aus und verwendet die getrimmte Standardausgabe.
2. Andernfalls prüft OMP zunächst, ob der Wert einem Umgebungsvariablennamen entspricht.
3. Wenn diese Umgebungsvariable nicht gesetzt ist, verwendet OMP den String literal.

Beispiele:

```json
{
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
  },
  "headers": {
    "X-MCP-Insiders": "true"
  }
}
```

Das bedeutet, Folgendes ist gültig und praktisch für lokale Secrets:

- `"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"` → aus der aktuellen Shell-Umgebung kopieren
- `"Authorization": "Bearer hardcoded-token"` → den literalen Wert verwenden
- `"Authorization": "!printf 'Bearer %s' \"$GITHUB_TOKEN\""` → den Header aus einem Befehl zusammenbauen

### In `mcp.json` und `.mcp.json` im Stammverzeichnis

Der Standalone-Fallback-Loader expandiert während der Erkennung auch `${VAR}` und `${VAR:-default}` innerhalb von Strings.

Beispiel:

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      }
    }
  }
}
```

Wenn Sie das am wenigsten überraschende OMP-Verhalten wünschen, bevorzugen Sie `.xcsh/mcp.json` und verwenden Sie explizite env/header-Werte.

## `disabledServers`

`disabledServers` ist hauptsächlich in der Benutzer-Konfigurationsdatei (`~/.xcsh/mcp.json`) nützlich, wenn ein Server aus einer anderen Quelle erkannt wird und Sie möchten, dass OMP ihn ignoriert, ohne die Konfiguration des anderen Tools zu bearbeiten.

Beispiel:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "disabledServers": ["github", "slack"]
}
```

## `/mcp add` vs. direkte JSON-Bearbeitung

Verwenden Sie `/mcp add`, wenn Sie eine geführte Einrichtung wünschen.

Verwenden Sie direkte JSON-Bearbeitung, wenn:

- Sie eine Transport- oder Auth-Option benötigen, nach der der Assistent noch nicht fragt
- Sie eine Serverdefinition aus einem anderen MCP-Client einfügen möchten
- Sie schema-gestützte Validierung in Ihrem Editor wünschen

Nach der Bearbeitung verwenden Sie:

- `/mcp reload`, um Server in der aktuellen Sitzung neu zu erkennen und zu verbinden
- `/mcp list`, um zu sehen, aus welcher Konfigurationsdatei ein Server stammt
- `/mcp test <name>`, um einen einzelnen Server zu testen

## Validierungsregeln, die OMP durchsetzt

Aus `validateServerConfig()` in `packages/coding-agent/src/mcp/config.ts`:

- `stdio` erfordert `command`
- `http` und `sse` erfordern `url`
- ein Server kann nicht gleichzeitig `command` und `url` setzen
- unbekannte `type`-Werte werden abgelehnt

Praktische Auswirkungen:

- Das Weglassen von `type` bedeutet `stdio`
- Wenn Sie eine Remote-Server-Konfiguration einfügen und `"type": "http"` vergessen, behandelt OMP sie als `stdio` und bemängelt, dass `command` fehlt
- `sse` bleibt aus Kompatibilitätsgründen gültig, aber neue gehostete Server sollten in der Regel als `http` konfiguriert werden

## Erkennung und Priorität

OMP führt keine doppelten Serverdefinitionen aus verschiedenen Dateien zusammen. Erkennungsanbieter werden priorisiert, und die Definition mit höherer Priorität gewinnt.

In der Praxis:

- bevorzugen Sie `.xcsh/mcp.json` oder `~/.xcsh/mcp.json`, wenn Sie eine OMP-spezifische Überschreibung wünschen
- halten Sie Servernamen nach Möglichkeit toolübergreifend eindeutig
- verwenden Sie `disabledServers` in der Benutzerkonfiguration, wenn eine Drittanbieter-Konfiguration einen Server immer wieder einführt, den Sie nicht möchten

## Fehlerbehebung

### `Server "name": stdio server requires "command" field`

Sie haben wahrscheinlich `type: "http"` bei einem Remote-Server weggelassen.

### `Server "name": both "command" and "url" are set`

Wählen Sie eine Transportart. OMP behandelt `command` als stdio und `url` als http/sse.

### `/mcp add` hat funktioniert, aber der Server verbindet sich trotzdem nicht

Das JSON ist gültig, aber der Server ist möglicherweise trotzdem nicht erreichbar. Verwenden Sie `/mcp test <name>` und prüfen Sie, ob:

- das Binary oder Docker-Image existiert
- erforderliche Umgebungsvariablen gesetzt sind
- die Remote-URL erreichbar ist
- das OAuth- oder API-Token gültig ist

### Der Server existiert in der Konfiguration eines anderen Tools, aber nicht in OMP

Führen Sie `/mcp list` aus. OMP erkennt viele Drittanbieter-MCP-Dateien, aber das projektbezogene Laden kann auch über die Einstellung `mcp.enableProjectConfig` deaktiviert werden.

## Referenzen

- MCP-Transport-Spezifikation: <https://modelcontextprotocol.io/specification/2025-03-26/basic/transports>
- Filesystem-Server-Paket: <https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem>
- GitHub MCP-Server: <https://github.com/github/github-mcp-server>
- Slack MCP-Server-Dokumentation: <https://docs.slack.dev/ai/slack-mcp-server/>
