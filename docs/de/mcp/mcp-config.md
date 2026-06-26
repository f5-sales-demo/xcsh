---
title: MCP-Konfiguration
description: >-
  MCP-Server-Konfiguration, Validierung und Verwaltung für die
  Coding-Agent-Laufzeitumgebung.
sidebar:
  order: 1
  label: Konfiguration
i18n:
  sourceHash: e4f56e8becc6
  translator: machine
---

# MCP-Konfiguration in OMP

Dieser Leitfaden erklärt, wie Sie MCP-Server für den OMP Coding Agent hinzufügen, bearbeiten und validieren.

Maßgebliche Quellen im Code:

- Laufzeit-Konfigurationstypen: `packages/coding-agent/src/mcp/types.ts`
- Konfigurations-Writer: `packages/coding-agent/src/mcp/config-writer.ts`
- Loader + Validierung: `packages/coding-agent/src/mcp/config.ts`
- Eigenständige `mcp.json`-Erkennung: `packages/coding-agent/src/discovery/mcp-json.ts`
- Schema: `packages/coding-agent/src/config/mcp-schema.json`

## Bevorzugte Konfigurationsorte

OMP kann MCP-Server aus mehreren Tools erkennen (`.claude/`, `.cursor/`, `.vscode/`, `opencode.json` und weiteren), aber für OMP-native Konfiguration sollten Sie in der Regel eine dieser Dateien verwenden:

- Projekt: `.xcsh/mcp.json`
- Benutzer: `~/.xcsh/mcp.json`

OMP akzeptiert auch eigenständige Fallback-Dateien im Projektstammverzeichnis:

- `mcp.json`
- `.mcp.json`

Verwenden Sie `.xcsh/mcp.json`, wenn OMP die Konfiguration verwalten soll. Verwenden Sie `mcp.json` / `.mcp.json` im Stammverzeichnis nur, wenn Sie eine portable Fallback-Datei wünschen, die auch andere MCP-Clients lesen können.

## Schema-Referenz hinzufügen

Fügen Sie diese Zeile am Anfang der Datei hinzu, um Editor-Autovervollständigung und Validierung zu aktivieren:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {}
}
```

OMP schreibt dies jetzt automatisch, wenn `/mcp add`, `/mcp enable`, `/mcp disable`, `/mcp reauth` oder andere konfigurationsschreibende Abläufe eine OMP-verwaltete MCP-Datei erstellen oder aktualisieren.

## Dateistruktur

OMP unterstützt diese Struktur auf oberster Ebene:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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

Schlüssel auf oberster Ebene:

- `$schema` — optionale JSON-Schema-URL für Tooling
- `mcpServers` — Zuordnung von Servernamen zu Serverkonfiguration
- `disabledServers` — Benutzer-Sperrliste, die zum Deaktivieren erkannter Server nach Name verwendet wird

Servernamen müssen dem Muster `^[a-zA-Z0-9_.-]{1,100}$` entsprechen.

## Unterstützte Serverfelder

Gemeinsame Felder für jeden Transport:

- `enabled?: boolean` — überspringt diesen Server wenn `false`
- `timeout?: number` — Verbindungs-Timeout in Millisekunden
- `auth?: { ... }` — Auth-Metadaten, die von OMP für OAuth/API-Key-Abläufe verwendet werden
- `oauth?: { ... }` — explizite OAuth-Client-Einstellungen, die während Auth/Reauth verwendet werden

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
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "legacy-remote": {
      "type": "sse",
      "url": "https://example.com/mcp/sse"
    }
  }
}
```

`sse` wird aus Kompatibilitätsgründen weiterhin unterstützt, aber die MCP-Spezifikation bevorzugt jetzt Streamable HTTP (`type: "http"`) für neue Server.

## Auth-Felder

OMP versteht zwei auth-bezogene Objekte.

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

Verwenden Sie dies, wenn OMP sich merken soll, wie Anmeldeinformationen für einen Server wiederhergestellt werden.

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

Slack ist das derzeit deutlichste Beispiel. Slacks MCP-Server wird unter `https://mcp.slack.com/mcp` gehostet, verwendet Streamable HTTP und erfordert vertrauliches OAuth mit den Client-Anmeldeinformationen Ihrer Slack-App.

Beispiel:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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
- Autorisierungs-Endpunkt: `https://slack.com/oauth/v2_user/authorize`
- Token-Endpunkt: `https://slack.com/api/oauth.v2.user.access`

## Gängige Kopiervorlagen

### Filesystem-Server über stdio

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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

### GitHub gehosteter Server über HTTP

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

### GitHub lokaler Server über Docker

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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

Dies entspricht GitHubs offiziellem lokalem Docker-Image `ghcr.io/github/github-mcp-server`.

### Slack gehosteter Server über OAuth

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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

## Geheimnisse und Variablenauflösung

Dies ist der Teil, der die meisten Probleme verursacht.

### In `.xcsh/mcp.json` und `~/.xcsh/mcp.json`

Bevor OMP einen Server startet oder eine HTTP-Anfrage sendet, werden `env`- und `headers`-Werte wie folgt aufgelöst:

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

Das bedeutet, Folgendes ist gültig und praktisch für lokale Geheimnisse:

- `"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"` → aus der aktuellen Shell-Umgebung kopieren
- `"Authorization": "Bearer hardcoded-token"` → den literalen Wert verwenden
- `"Authorization": "!printf 'Bearer %s' \"$GITHUB_TOKEN\""` → den Header aus einem Befehl erstellen

### In `mcp.json` und `.mcp.json` im Stammverzeichnis

Der eigenständige Fallback-Loader expandiert auch `${VAR}` und `${VAR:-default}` in Strings während der Erkennung.

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
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "disabledServers": ["github", "slack"]
}
```

## `/mcp add` vs. direktes Bearbeiten der JSON-Datei

Verwenden Sie `/mcp add`, wenn Sie eine geführte Einrichtung wünschen.

Verwenden Sie direktes JSON-Bearbeiten, wenn:

- Sie einen Transport oder eine Auth-Option benötigen, nach der der Assistent noch nicht fragt
- Sie eine Serverdefinition aus einem anderen MCP-Client einfügen möchten
- Sie schema-basierte Validierung in Ihrem Editor wünschen

Nach dem Bearbeiten verwenden Sie:

- `/mcp reload` um Server in der aktuellen Sitzung neu zu erkennen und zu verbinden
- `/mcp list` um zu sehen, aus welcher Konfigurationsdatei ein Server stammt
- `/mcp test <name>` um einen einzelnen Server zu testen

## Validierungsregeln, die OMP durchsetzt

Aus `validateServerConfig()` in `packages/coding-agent/src/mcp/config.ts`:

- `stdio` erfordert `command`
- `http` und `sse` erfordern `url`
- ein Server kann nicht sowohl `command` als auch `url` setzen
- unbekannte `type`-Werte werden abgelehnt

Praktische Auswirkungen:

- Das Weglassen von `type` bedeutet `stdio`
- Wenn Sie eine Remote-Server-Konfiguration einfügen und `"type": "http"` vergessen, behandelt OMP sie als `stdio` und beschwert sich, dass `command` fehlt
- `sse` bleibt aus Kompatibilitätsgründen gültig, aber neue gehostete Server sollten in der Regel als `http` konfiguriert werden

## Erkennung und Priorität

OMP führt keine doppelten Serverdefinitionen aus verschiedenen Dateien zusammen. Erkennungsanbieter werden priorisiert, und die höher priorisierte Definition gewinnt.

In der Praxis:

- bevorzugen Sie `.xcsh/mcp.json` oder `~/.xcsh/mcp.json`, wenn Sie eine OMP-spezifische Überschreibung wünschen
- halten Sie Servernamen nach Möglichkeit über Tools hinweg eindeutig
- verwenden Sie `disabledServers` in der Benutzerkonfiguration, wenn eine Drittanbieter-Konfiguration immer wieder einen Server einführt, den Sie nicht wünschen

## Fehlerbehebung

### `Server "name": stdio server requires "command" field`

Sie haben wahrscheinlich `type: "http"` bei einem Remote-Server weggelassen.

### `Server "name": both "command" and "url" are set`

Wählen Sie einen Transport. OMP behandelt `command` als stdio und `url` als http/sse.

### `/mcp add` hat funktioniert, aber der Server verbindet sich trotzdem nicht

Die JSON-Datei ist gültig, aber der Server ist möglicherweise trotzdem nicht erreichbar. Verwenden Sie `/mcp test <name>` und prüfen Sie, ob:

- die Binärdatei oder das Docker-Image existiert
- erforderliche Umgebungsvariablen gesetzt sind
- die Remote-URL erreichbar ist
- das OAuth- oder API-Token gültig ist

### Der Server existiert in der Konfiguration eines anderen Tools, aber nicht in OMP

Führen Sie `/mcp list` aus. OMP erkennt viele Drittanbieter-MCP-Dateien, aber das Laden auf Projektebene kann auch über die Einstellung `mcp.enableProjectConfig` deaktiviert werden.

## Referenzen

- MCP-Transport-Spezifikation: <https://modelcontextprotocol.io/specification/2025-03-26/basic/transports>
- Filesystem-Server-Paket: <https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem>
- GitHub MCP-Server: <https://github.com/github/github-mcp-server>
- Slack MCP-Server-Dokumentation: <https://docs.slack.dev/ai/slack-mcp-server/>
