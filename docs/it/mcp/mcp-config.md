---
title: Configurazione MCP
description: >-
  Configurazione, validazione e gestione dei server MCP per il runtime
  dell'agente di codifica.
sidebar:
  order: 1
  label: Configurazione
i18n:
  sourceHash: e4f56e8becc6
  translator: machine
---

# Configurazione MCP in OMP

Questa guida spiega come aggiungere, modificare e validare i server MCP per l'agente di codifica OMP.

Riferimenti nel codice sorgente:

- Tipi di configurazione runtime: `packages/coding-agent/src/mcp/types.ts`
- Writer della configurazione: `packages/coding-agent/src/mcp/config-writer.ts`
- Loader + validazione: `packages/coding-agent/src/mcp/config.ts`
- Discovery standalone di `mcp.json`: `packages/coding-agent/src/discovery/mcp-json.ts`
- Schema: `packages/coding-agent/src/config/mcp-schema.json`

## Posizioni di configurazione preferite

OMP può individuare server MCP da diversi strumenti (`.claude/`, `.cursor/`, `.vscode/`, `opencode.json` e altri), ma per la configurazione nativa di OMP è consigliabile utilizzare uno di questi file:

- Progetto: `.xcsh/mcp.json`
- Utente: `~/.xcsh/mcp.json`

OMP accetta anche file standalone di fallback nella root del progetto:

- `mcp.json`
- `.mcp.json`

Utilizzate `.xcsh/mcp.json` quando volete che OMP gestisca la configurazione. Utilizzate i file root `mcp.json` / `.mcp.json` solo quando desiderate un file di fallback portabile che anche altri client MCP possano leggere.

## Aggiungere un riferimento allo schema

Aggiungete questa riga all'inizio del file per ottenere autocompletamento e validazione nell'editor:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {}
}
```

OMP ora scrive questo automaticamente quando `/mcp add`, `/mcp enable`, `/mcp disable`, `/mcp reauth` o altri flussi di scrittura della configurazione creano o aggiornano un file MCP gestito da OMP.

## Struttura del file

OMP supporta questa struttura di primo livello:

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

Chiavi di primo livello:

- `$schema` — URL opzionale dello JSON Schema per gli strumenti
- `mcpServers` — mappa dal nome del server alla configurazione del server
- `disabledServers` — lista di esclusione a livello utente utilizzata per disattivare i server individuati in base al nome

I nomi dei server devono corrispondere a `^[a-zA-Z0-9_.-]{1,100}$`.

## Campi supportati per i server

Campi condivisi per ogni trasporto:

- `enabled?: boolean` — ignora questo server quando è `false`
- `timeout?: number` — timeout di connessione in millisecondi
- `auth?: { ... }` — metadati di autenticazione utilizzati da OMP per i flussi OAuth/API-key
- `oauth?: { ... }` — impostazioni esplicite del client OAuth utilizzate durante l'autenticazione/riautenticazione

### Trasporto `stdio`

`stdio` è il valore predefinito quando `type` viene omesso.

Obbligatorio:

- `command: string`

Opzionale:

- `type?: "stdio"`
- `args?: string[]`
- `env?: Record<string, string>`
- `cwd?: string`

Esempio:

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

Questo segue il pacchetto ufficiale del server MCP Filesystem (`@modelcontextprotocol/server-filesystem`).

### Trasporto `http`

Obbligatorio:

- `type: "http"`
- `url: string`

Opzionale:

- `headers?: Record<string, string>`

Esempio:

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

Questo corrisponde all'endpoint del server MCP GitHub ospitato da GitHub.

### Trasporto `sse`

Obbligatorio:

- `type: "sse"`
- `url: string`

Opzionale:

- `headers?: Record<string, string>`

Esempio:

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

`sse` è ancora supportato per compatibilità, ma la specifica MCP ora preferisce Streamable HTTP (`type: "http"`) per i nuovi server.

## Campi di autenticazione

OMP riconosce due oggetti relativi all'autenticazione.

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

Utilizzatelo quando OMP deve memorizzare come ripristinare le credenziali per un server.

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

Utilizzatelo quando il server MCP richiede impostazioni esplicite del client OAuth.

Slack è l'esempio più chiaro attualmente. Il server MCP di Slack è ospitato su `https://mcp.slack.com/mcp`, utilizza Streamable HTTP e richiede OAuth confidenziale con le credenziali client della vostra app Slack.

Esempio:

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

Endpoint Slack rilevanti dalla documentazione di Slack:

- Endpoint MCP: `https://mcp.slack.com/mcp`
- Endpoint di autorizzazione: `https://slack.com/oauth/v2_user/authorize`
- Endpoint token: `https://slack.com/api/oauth.v2.user.access`

## Esempi comuni da copiare e incollare

### Server Filesystem via stdio

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

### Server GitHub ospitato via HTTP

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

### Server GitHub locale via Docker

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

Questo corrisponde all'immagine Docker locale ufficiale di GitHub `ghcr.io/github/github-mcp-server`.

### Server Slack ospitato via OAuth

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

## Segreti e risoluzione delle variabili

Questa è la parte che solitamente crea più confusione.

### In `.xcsh/mcp.json` e `~/.xcsh/mcp.json`

Prima che OMP avvii un server o effettui una richiesta HTTP, risolve i valori di `env` e `headers` in questo modo:

1. Se un valore inizia con `!`, OMP lo esegue come comando shell e utilizza lo stdout ripulito.
2. Altrimenti OMP verifica prima se il valore corrisponde al nome di una variabile d'ambiente.
3. Se quella variabile d'ambiente non è impostata, OMP utilizza la stringa letteralmente.

Esempi:

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

Ciò significa che questo è valido e comodo per i segreti locali:

- `"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"` → copia dall'ambiente shell corrente
- `"Authorization": "Bearer hardcoded-token"` → utilizza il valore letterale
- `"Authorization": "!printf 'Bearer %s' \"$GITHUB_TOKEN\""` → costruisce l'header da un comando

### In `mcp.json` e `.mcp.json` nella root

Il loader standalone di fallback espande anche `${VAR}` e `${VAR:-default}` all'interno delle stringhe durante la discovery.

Esempio:

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

Se desiderate il comportamento meno sorprendente di OMP, preferite `.xcsh/mcp.json` e utilizzate valori espliciti per env/header.

## `disabledServers`

`disabledServers` è utile principalmente nel file di configurazione utente (`~/.xcsh/mcp.json`) quando un server viene individuato da un'altra fonte e volete che OMP lo ignori senza modificare la configurazione dell'altro strumento.

Esempio:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "disabledServers": ["github", "slack"]
}
```

## `/mcp add` vs modifica diretta del JSON

Utilizzate `/mcp add` quando desiderate una configurazione guidata.

Utilizzate la modifica diretta del JSON quando:

- avete bisogno di un trasporto o un'opzione di autenticazione per cui la procedura guidata non offre ancora prompt
- volete incollare una definizione di server da un altro client MCP
- volete la validazione supportata dallo schema nel vostro editor

Dopo la modifica, utilizzate:

- `/mcp reload` per rilevare e riconnettere i server nella sessione corrente
- `/mcp list` per vedere da quale file di configurazione proviene un server
- `/mcp test <name>` per testare un singolo server

## Regole di validazione applicate da OMP

Da `validateServerConfig()` in `packages/coding-agent/src/mcp/config.ts`:

- `stdio` richiede `command`
- `http` e `sse` richiedono `url`
- un server non può impostare sia `command` che `url`
- i valori di `type` sconosciuti vengono rifiutati

Implicazioni pratiche:

- Omettere `type` significa `stdio`
- Se incollate una configurazione di server remoto e dimenticate `"type": "http"`, OMP la tratterà come `stdio` e segnalerà che manca `command`
- `sse` rimane valido per compatibilità, ma i nuovi server ospitati dovrebbero generalmente essere configurati come `http`

## Discovery e precedenza

OMP non unisce definizioni di server duplicate tra file diversi. I provider di discovery hanno una priorità e la definizione con priorità più alta prevale.

In pratica:

- preferite `.xcsh/mcp.json` o `~/.xcsh/mcp.json` quando volete un override specifico per OMP
- mantenete i nomi dei server univoci tra gli strumenti quando possibile
- utilizzate `disabledServers` nella configurazione utente quando una configurazione di terze parti continua a reintrodurre un server che non desiderate

## Risoluzione dei problemi

### `Server "name": stdio server requires "command" field`

Probabilmente avete omesso `type: "http"` su un server remoto.

### `Server "name": both "command" and "url" are set`

Scegliete un solo trasporto. OMP tratta `command` come stdio e `url` come http/sse.

### `/mcp add` ha funzionato ma il server non si connette ancora

Il JSON è valido, ma il server potrebbe comunque essere irraggiungibile. Utilizzate `/mcp test <name>` e verificate se:

- il binario o l'immagine Docker esiste
- le variabili d'ambiente richieste sono impostate
- l'URL remoto è raggiungibile
- il token OAuth o API è valido

### Il server esiste nella configurazione di un altro strumento ma non in OMP

Eseguite `/mcp list`. OMP individua molti file MCP di terze parti, ma il caricamento a livello di progetto può anche essere disabilitato tramite l'impostazione `mcp.enableProjectConfig`.

## Riferimenti

- Specifica dei trasporti MCP: <https://modelcontextprotocol.io/specification/2025-03-26/basic/transports>
- Pacchetto server Filesystem: <https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem>
- Server MCP GitHub: <https://github.com/github/github-mcp-server>
- Documentazione server MCP Slack: <https://docs.slack.dev/ai/slack-mcp-server/>
