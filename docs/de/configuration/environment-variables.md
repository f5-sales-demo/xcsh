---
title: Umgebungsvariablen
description: >-
  Laufzeit-Umgebungsvariablen-Referenz für die xcsh-Konfiguration und
  Verhaltenssteuerung.
sidebar:
  order: 2
  label: Umgebungsvariablen
i18n:
  sourceHash: 7baa9f5226ba
  translator: machine
---

# Umgebungsvariablen (Aktuelle Laufzeit-Referenz)

Diese Referenz ist aus aktuellen Code-Pfaden abgeleitet in:

- `packages/coding-agent/src/**`
- `packages/ai/src/**` (Provider-/Auth-Auflösung, verwendet vom coding-agent)
- `packages/utils/src/**` und `packages/tui/src/**` wo diese Variablen direkt die coding-agent-Laufzeit beeinflussen

Es dokumentiert nur aktives Verhalten.

## Auflösungsmodell und Priorität

Die meisten Laufzeit-Abfragen verwenden `$env` aus `@f5xc-salesdemos/pi-utils` (`packages/utils/src/env.ts`).

`$env` Ladereihenfolge:

1. Bestehende Prozessumgebung (`Bun.env`)
2. Projekt `.env` (`$PWD/.env`) für noch nicht gesetzte Schlüssel
3. Home `.env` (`~/.env`) für noch nicht gesetzte Schlüssel

Zusätzliche Regel in `.env`-Dateien: `XCSH_*`-Schlüssel werden während des Parsens auf `PI_*`-Schlüssel gespiegelt.

---

## 1) Modell-/Provider-Authentifizierung

Diese werden über `getEnvApiKey()` (`packages/ai/src/stream.ts`) konsumiert, sofern nicht anders angegeben.

### Zentrale Provider-Anmeldedaten

| Variable                        | Verwendet für | Erforderlich wenn                                                 | Hinweise / Priorität                                                                                  |
|---------------------------------|---|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `ANTHROPIC_OAUTH_TOKEN`         | Anthropic API-Auth | Nutzung von Anthropic mit OAuth-Token-Auth                         | Hat Vorrang vor `ANTHROPIC_API_KEY` bei der Provider-Auth-Auflösung                              |
| `ANTHROPIC_API_KEY`             | Anthropic API-Auth | Nutzung von Anthropic ohne OAuth-Token                           | Fallback nach `ANTHROPIC_OAUTH_TOKEN`                                                              |
| `ANTHROPIC_FOUNDRY_API_KEY`     | Anthropic über Azure Foundry / Enterprise-Gateway | `CLAUDE_CODE_USE_FOUNDRY` aktiviert                             | Hat Vorrang vor `ANTHROPIC_OAUTH_TOKEN` und `ANTHROPIC_API_KEY` wenn Foundry-Modus aktiviert ist  |
| `OPENAI_API_KEY`                | OpenAI-Auth | Nutzung von OpenAI-Familie-Providern ohne explizites apiKey-Argument | Verwendet von OpenAI Completions/Responses-Providern                                                      |
| `GEMINI_API_KEY`                | Google Gemini-Auth | Nutzung von `google`-Provider-Modellen                                | Primärschlüssel für Gemini-Provider-Zuordnung                                                             |
| `GOOGLE_API_KEY`                | Gemini-Image-Tool-Auth-Fallback | Nutzung des `gemini_image`-Tools ohne `GEMINI_API_KEY`            | Verwendet vom coding-agent Image-Tool-Fallback-Pfad                                                       |
| `GROQ_API_KEY`                  | Groq-Auth | Nutzung von Groq-Modellen                                             |                                                                                                     |
| `CEREBRAS_API_KEY`              | Cerebras-Auth | Nutzung von Cerebras-Modellen                                         |                                                                                                     |
| `TOGETHER_API_KEY`              | Together-Auth | Nutzung des `together`-Providers                                     |                                                                                                     |
| `HUGGINGFACE_HUB_TOKEN`         | Hugging Face-Auth | Nutzung des `huggingface`-Providers                                  | Primäre Hugging Face-Token-Umgebungsvariable                                                                  |
| `HF_TOKEN`                      | Hugging Face-Auth | Nutzung des `huggingface`-Providers                                  | Fallback wenn `HUGGINGFACE_HUB_TOKEN` nicht gesetzt ist                                                      |
| `SYNTHETIC_API_KEY`             | Synthetic-Auth | Nutzung von Synthetic-Modellen                                        |                                                                                                     |
| `NVIDIA_API_KEY`                | NVIDIA-Auth | Nutzung des `nvidia`-Providers                                       |                                                                                                     |
| `NANO_GPT_API_KEY`              | NanoGPT-Auth | Nutzung des `nanogpt`-Providers                                      |                                                                                                     |
| `VENICE_API_KEY`                | Venice-Auth | Nutzung des `venice`-Providers                                       |                                                                                                     |
| `LITELLM_API_KEY`               | LiteLLM-Auth | Nutzung des `litellm`-Providers                                      | OpenAI-kompatibler LiteLLM-Proxy-Schlüssel. Wenn zusammen mit `LITELLM_BASE_URL` gesetzt, wird die Auto-Konfiguration von `models.yml` aktiviert |
| `LM_STUDIO_API_KEY`             | LM Studio-Auth (optional) | Nutzung des `lm-studio`-Providers mit authentifizierten Hosts           | Lokales LM Studio läuft normalerweise ohne Auth; jeder nicht-leere Token funktioniert wenn ein Schlüssel erforderlich ist         |
| `OLLAMA_API_KEY`                | Ollama-Auth (optional) | Nutzung des `ollama`-Providers mit authentifizierten Hosts              | Lokales Ollama läuft normalerweise ohne Auth; jeder nicht-leere Token funktioniert wenn ein Schlüssel erforderlich ist            |
| `LLAMA_CPP_API_KEY`             | Ollama-Auth (optional) | Nutzung von `llama-server` mit `--api-key`-Parameter              | Lokales llama.cpp läuft normalerweise ohne Auth; jeder nicht-leere Token funktioniert wenn ein Schlüssel konfiguriert ist       |
| `XIAOMI_API_KEY`                | Xiaomi MiMo-Auth | Nutzung des `xiaomi`-Providers                                       |                                                                                                     |
| `MOONSHOT_API_KEY`              | Moonshot-Auth | Nutzung des `moonshot`-Providers                                     |                                                                                                     |
| `XAI_API_KEY`                   | xAI-Auth | Nutzung von xAI-Modellen                                              |                                                                                                     |
| `OPENROUTER_API_KEY`            | OpenRouter-Auth | Nutzung von OpenRouter-Modellen                                       | Wird auch vom Image-Tool verwendet wenn bevorzugter/automatischer Provider OpenRouter ist                                  |
| `MISTRAL_API_KEY`               | Mistral-Auth | Nutzung von Mistral-Modellen                                          |                                                                                                     |
| `ZAI_API_KEY`                   | z.ai-Auth | Nutzung von z.ai-Modellen                                             | Wird auch vom z.ai-Websuch-Provider verwendet                                                               |
| `MINIMAX_API_KEY`               | MiniMax-Auth | Nutzung des `minimax`-Providers                                      |                                                                                                     |
| `MINIMAX_CODE_API_KEY`          | MiniMax Code-Auth | Nutzung des `minimax-code`-Providers                                 |                                                                                                     |
| `MINIMAX_CODE_CN_API_KEY`       | MiniMax Code CN-Auth | Nutzung des `minimax-code-cn`-Providers                              |                                                                                                     |
| `OPENCODE_API_KEY`              | OpenCode-Auth | Nutzung von OpenCode-Modellen                                         |                                                                                                     |
| `QIANFAN_API_KEY`               | Qianfan-Auth | Nutzung des `qianfan`-Providers                                      |                                                                                                     |
| `QWEN_OAUTH_TOKEN`              | Qwen Portal-Auth | Nutzung von `qwen-portal` mit OAuth-Token                          | Hat Vorrang vor `QWEN_PORTAL_API_KEY`                                                         |
| `QWEN_PORTAL_API_KEY`           | Qwen Portal-Auth | Nutzung von `qwen-portal` mit API-Schlüssel                              | Fallback nach `QWEN_OAUTH_TOKEN`                                                                   |
| `ZENMUX_API_KEY`                | ZenMux-Auth | Nutzung des `zenmux`-Providers                                       | Verwendet für ZenMux OpenAI- und Anthropic-kompatible Routen                                              |
| `VLLM_API_KEY`                  | vLLM-Auth/Discovery-Opt-in | Nutzung des `vllm`-Providers (lokale OpenAI-kompatible Server)       | Jeder nicht-leere Wert funktioniert für lokale Server ohne Auth                                                 |
| `CURSOR_ACCESS_TOKEN`           | Cursor-Provider-Auth | Nutzung des Cursor-Providers                                         |                                                                                                     |
| `AI_GATEWAY_API_KEY`            | Vercel AI Gateway-Auth | Nutzung des `vercel-ai-gateway`-Providers                            |                                                                                                     |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | Cloudflare AI Gateway-Auth | Nutzung des `cloudflare-ai-gateway`-Providers                        | Basis-URL muss konfiguriert werden als `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` |

### GitHub/Copilot-Token-Ketten

| Variable | Verwendet für | Kette |
|---|---|---|
| `COPILOT_GITHUB_TOKEN` | GitHub Copilot-Provider-Auth | `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` |
| `GH_TOKEN` | Copilot-Fallback; GitHub-API-Auth im Web-Scraper | Im Web-Scraper: `GITHUB_TOKEN` → `GH_TOKEN` |
| `GITHUB_TOKEN` | Copilot-Fallback; GitHub-API-Auth im Web-Scraper | Im Web-Scraper: wird vor `GH_TOKEN` geprüft |

---

## 2) Provider-spezifische Laufzeitkonfiguration

### Anthropic Foundry Gateway (Azure / Enterprise-Proxy)

Wenn `CLAUDE_CODE_USE_FOUNDRY` aktiviert ist, wechseln Anthropic-Anfragen in den Foundry-Modus:

- Die Basis-URL wird aus `FOUNDRY_BASE_URL` aufgelöst (Fallback bleibt die Modell-/Standard-Basis-URL wenn nicht gesetzt).
- Die API-Schlüssel-Auflösung für den Provider `anthropic` wird:
  `ANTHROPIC_FOUNDRY_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`.
- `ANTHROPIC_CUSTOM_HEADERS` wird als komma-/zeilenumbruchgetrennte `key: value`-Paare geparst und in die Request-Header zusammengeführt.
- TLS-Client-/Server-Material kann aus Umgebungswerten injiziert werden:
  `NODE_EXTRA_CA_CERTS`, `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`.
  Jede akzeptiert entweder:
  - einen Dateisystempfad zu PEM-Inhalt, oder
  - Inline-PEM (einschließlich escapeter `\n`-Sequenzen).

| Variable | Werttyp | Verhalten |
|---|---|---|
| `CLAUDE_CODE_USE_FOUNDRY` | Boolean-ähnlicher String (`1`, `true`, `yes`, `on`) | Aktiviert den Foundry-Modus für den Anthropic-Provider |
| `FOUNDRY_BASE_URL` | URL-String | Anthropic-Endpunkt-Basis-URL im Foundry-Modus |
| `ANTHROPIC_FOUNDRY_API_KEY` | Token-String | Verwendet für `Authorization: Bearer <token>` |
| `ANTHROPIC_CUSTOM_HEADERS` | Header-Listen-String | Zusätzliche Header; Format `header-a: value, header-b: value` oder zeilenumbruchgetrennt |
| `NODE_EXTRA_CA_CERTS` | PEM-Pfad oder Inline-PEM | Zusätzliche CA-Kette für Server-Zertifikatsvalidierung |
| `CLAUDE_CODE_CLIENT_CERT` | PEM-Pfad oder Inline-PEM | mTLS-Client-Zertifikat |
| `CLAUDE_CODE_CLIENT_KEY` | PEM-Pfad oder Inline-PEM | mTLS-Client-Privatschlüssel (muss mit Zertifikat gepaart sein) |

### Amazon Bedrock

| Variable | Standard / Verhalten |
|---|---|
| `AWS_REGION` | Primäre Regionsquelle |
| `AWS_DEFAULT_REGION` | Fallback wenn `AWS_REGION` nicht gesetzt |
| `AWS_PROFILE` | Aktiviert den benannten Profil-Auth-Pfad |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | Aktiviert den IAM-Schlüssel-Auth-Pfad |
| `AWS_BEARER_TOKEN_BEDROCK` | Aktiviert den Bearer-Token-Auth-Pfad |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `AWS_CONTAINER_CREDENTIALS_FULL_URI` | Aktiviert den ECS-Task-Credential-Pfad |
| `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` | Aktiviert den Web-Identity-Auth-Pfad |
| `AWS_BEDROCK_SKIP_AUTH` | Wenn `1`, werden Dummy-Anmeldedaten injiziert (Proxy-/Nicht-Auth-Szenarien) |
| `AWS_BEDROCK_FORCE_HTTP1` | Wenn `1`, erzwingt Node HTTP/1-Request-Handler |

Regions-Fallback im Provider-Code: `options.region` → `AWS_REGION` → `AWS_DEFAULT_REGION` → `us-east-1`.

### Azure OpenAI Responses

| Variable | Standard / Verhalten |
|---|---|
| `AZURE_OPENAI_API_KEY` | Erforderlich, sofern kein API-Schlüssel als Option übergeben wird |
| `AZURE_OPENAI_API_VERSION` | Standard `v1` |
| `AZURE_OPENAI_BASE_URL` | Direkte Basis-URL-Überschreibung |
| `AZURE_OPENAI_RESOURCE_NAME` | Wird zur Konstruktion der Basis-URL verwendet: `https://<resource>.openai.azure.com/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | Optionaler Zuordnungs-String: `modelId=deploymentName,model2=deployment2` |

Basis-URL-Auflösung: Option `azureBaseUrl` → Env `AZURE_OPENAI_BASE_URL` → Option/Env-Ressourcenname → `model.baseUrl`.

### Google Vertex AI

| Variable | Erforderlich? | Hinweise |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | Ja (sofern nicht in Optionen übergeben) | Fallback: `GCLOUD_PROJECT` |
| `GCLOUD_PROJECT` | Fallback | Wird als alternative Projekt-ID-Quelle verwendet |
| `GOOGLE_CLOUD_LOCATION` | Ja (sofern nicht in Optionen übergeben) | Kein Standard im Provider |
| `GOOGLE_APPLICATION_CREDENTIALS` | Bedingt | Wenn gesetzt, muss die Datei existieren; andernfalls wird der ADC-Fallback-Pfad geprüft (`~/.config/gcloud/application_default_credentials.json`) |

### Kimi

| Variable | Standard / Verhalten |
|---|---|
| `KIMI_CODE_OAUTH_HOST` | Primäre OAuth-Host-Überschreibung |
| `KIMI_OAUTH_HOST` | Fallback-OAuth-Host-Überschreibung |
| `KIMI_CODE_BASE_URL` | Überschreibt die Kimi-Nutzungsendpunkt-Basis-URL (`usage/kimi.ts`) |

OAuth-Host-Kette: `KIMI_CODE_OAUTH_HOST` → `KIMI_OAUTH_HOST` → `https://auth.kimi.com`.

### Antigravity/Gemini-Image-Kompatibilität

| Variable | Standard / Verhalten |
|---|---|
| `PI_AI_ANTIGRAVITY_VERSION` | Überschreibt den Antigravity-User-Agent-Versions-Tag im Gemini-CLI-Provider |

### OpenAI Codex Responses (Feature-/Debug-Steuerungen)

| Variable | Verhalten |
|---|---|
| `PI_CODEX_DEBUG` | `1`/`true` aktiviert Codex-Provider-Debug-Logging |
| `PI_CODEX_WEBSOCKET` | `1`/`true` aktiviert WebSocket-Transport-Präferenz |
| `PI_CODEX_WEBSOCKET_V2` | `1`/`true` aktiviert WebSocket-v2-Pfad |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | Positive Ganzzahl-Überschreibung (Standard 300000) |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | Nicht-negative Ganzzahl-Überschreibung (Standard 5) |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | Positive Ganzzahl-Basis-Backoff-Überschreibung (Standard 500) |

### Cursor-Provider-Debug

| Variable | Verhalten |
|---|---|
| `DEBUG_CURSOR` | Aktiviert Provider-Debug-Logs; `2`/`verbose` für detaillierte Payload-Ausschnitte |
| `DEBUG_CURSOR_LOG` | Optionaler Dateipfad für JSONL-Debug-Log-Ausgabe |

### Prompt-Cache-Kompatibilitätsschalter

| Variable | Verhalten |
|---|---|
| `PI_CACHE_RETENTION` | Wenn `long`, wird lange Aufbewahrung aktiviert wo unterstützt (`anthropic`, `openai-responses`, Bedrock-Aufbewahrungsauflösung) |

---

## 3) Websuch-Subsystem

### Such-Provider-Anmeldedaten

| Variable | Verwendet von |
|---|---|
| `EXA_API_KEY` | Exa-Such-Provider und Exa-MCP-Tools |
| `BRAVE_API_KEY` | Brave-Such-Provider |
| `PERPLEXITY_API_KEY` | Perplexity-Such-Provider API-Schlüssel-Modus |
| `TAVILY_API_KEY` | Tavily-Such-Provider |
| `ZAI_API_KEY` | z.ai-Such-Provider (prüft auch gespeicherte OAuth in `agent.db`) |
| `OPENAI_API_KEY` / Codex OAuth in DB | Codex-Such-Provider Verfügbarkeit/Auth |

### Anthropic-Websuche-Auth-Kette

`packages/coding-agent/src/web/search/auth.ts` löst Anthropic-Websuche-Anmeldedaten in dieser Reihenfolge auf:

1. `ANTHROPIC_SEARCH_API_KEY` (+ optionale `ANTHROPIC_SEARCH_BASE_URL`)
2. `models.json`-Provider-Eintrag mit `api: "anthropic-messages"`
3. Anthropic OAuth-Anmeldedaten aus `agent.db` (darf nicht innerhalb eines 5-Minuten-Puffers ablaufen)
4. Generischer Anthropic-Env-Fallback: Provider-Schlüssel (`ANTHROPIC_FOUNDRY_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`) + optionale `ANTHROPIC_BASE_URL` (`FOUNDRY_BASE_URL` wenn Foundry-Modus aktiviert ist)

Zugehörige Variablen:

| Variable | Standard / Verhalten |
|---|---|
| `ANTHROPIC_SEARCH_API_KEY` | Höchstprioritärer expliziter Such-Schlüssel |
| `ANTHROPIC_SEARCH_BASE_URL` | Standardmäßig `https://api.anthropic.com` wenn weggelassen |
| `ANTHROPIC_SEARCH_MODEL` | Standardmäßig `claude-haiku-4-5` |
| `ANTHROPIC_BASE_URL` | Generische Fallback-Basis-URL für Stufe-4-Auth-Pfad |

### Perplexity OAuth-Flow-Verhaltens-Flag

| Variable | Verhalten |
|---|---|
| `PI_AUTH_NO_BORROW` | Wenn gesetzt, deaktiviert den macOS-Native-App-Token-Borrowing-Pfad im Perplexity-Login-Flow |

---

## 4) Python-Tooling und Kernel-Laufzeit

| Variable | Standard / Verhalten |
|---|---|
| `PI_PY` | Python-Tool-Modus-Überschreibung: `0`/`bash`=`bash-only`, `1`/`py`=`ipy-only`, `mix`/`both`=`both`; ungültige Werte werden ignoriert |
| `PI_PYTHON_SKIP_CHECK` | Wenn `1`, werden Python-Kernel-Verfügbarkeitsprüfungen/Warm-Checks übersprungen |
| `PI_PYTHON_GATEWAY_URL` | Wenn gesetzt, wird ein externer Kernel-Gateway anstelle des lokalen Shared-Gateways verwendet |
| `PI_PYTHON_GATEWAY_TOKEN` | Optionaler Auth-Token für externes Gateway (`Authorization: token <value>`) |
| `PI_PYTHON_IPC_TRACE` | Wenn `1`, aktiviert den Low-Level-IPC-Trace-Pfad im Kernel-Modul |
| `VIRTUAL_ENV` | Höchstprioritärer venv-Pfad für Python-Laufzeitauflösung |

Zusätzliches bedingtes Verhalten:

- Wenn `BUN_ENV=test` oder `NODE_ENV=test`, werden Python-Verfügbarkeitsprüfungen als OK behandelt und das Aufwärmen wird übersprungen.
- Python-Env-Filterung verweigert gängige API-Schlüssel und erlaubt sichere Basisvariablen + `LC_`-, `XDG_`-, `PI_`-Präfixe.

---

## 5) Agent-/Laufzeit-Verhaltensschalter

| Variable                   | Standard / Verhalten                                                                           |
|----------------------------|----------------------------------------------------------------------------------------------|
| `PI_SMOL_MODEL`            | Ephemere Modell-Rollen-Überschreibung für `smol` (CLI `--smol` hat Vorrang)                     |
| `PI_SLOW_MODEL`            | Ephemere Modell-Rollen-Überschreibung für `slow` (CLI `--slow` hat Vorrang)                     |
| `PI_PLAN_MODEL`            | Ephemere Modell-Rollen-Überschreibung für `plan` (CLI `--plan` hat Vorrang)                     |
| `PI_NO_TITLE`              | Wenn gesetzt (jeder nicht-leere Wert), deaktiviert die automatische Sitzungstitelgenerierung bei der ersten Benutzernachricht   |
| `NULL_PROMPT`              | Wenn `true`, gibt der System-Prompt-Builder einen leeren String zurück                                        |
| `PI_BLOCKED_AGENT`         | Blockiert einen bestimmten Subagent-Typ im Task-Tool                                                 |
| `PI_SUBPROCESS_CMD`        | Überschreibt den Subagent-Spawn-Befehl (`xcsh` / `xcsh.cmd`-Auflösungs-Bypass)                       |
| `PI_TASK_MAX_OUTPUT_BYTES` | Maximale erfasste Ausgabe-Bytes pro Subagent (Standard `500000`)                                    |
| `PI_TASK_MAX_OUTPUT_LINES` | Maximale erfasste Ausgabezeilen pro Subagent (Standard `5000`)                                      |
| `PI_TIMING`                | Wenn `1`, aktiviert Startup-/Tool-Timing-Instrumentierungs-Logs                                     |
| `PI_DEBUG_STARTUP`         | Aktiviert Startup-Stufen-Debug-Ausgaben auf stderr in mehreren Startup-Pfaden                       |
| `PI_PACKAGE_DIR`           | Überschreibt die Paket-Asset-Basisverzeichnis-Auflösung (Docs/Beispiele/Changelog-Pfad-Suche)            |
| `PI_DISABLE_LSPMUX`        | Wenn `1`, deaktiviert lspmux-Erkennung/-Integration und erzwingt direktes LSP-Server-Spawning          |
| `LITELLM_BASE_URL`         | LiteLLM-Proxy-Basis-URL. Wenn zusammen mit `LITELLM_API_KEY` gesetzt, löst Auto-Generierung von `models.yml` beim ersten Start und Selbstheilung bei jedem Start aus |
| `LM_STUDIO_BASE_URL`       | Standard-implizite LM Studio-Discovery-Basis-URL-Überschreibung (`http://127.0.0.1:1234/v1` wenn nicht gesetzt) |
| `OLLAMA_BASE_URL`          | Standard-implizite Ollama-Discovery-Basis-URL-Überschreibung (`http://127.0.0.1:11434` wenn nicht gesetzt)      |
| `LLAMA_CPP_BASE_URL`       | Standard-implizite Llama.cpp-Discovery-Basis-URL-Überschreibung (`http://127.0.0.1:8080` wenn nicht gesetzt)    |
| `PI_EDIT_VARIANT`          | Wenn `hashline`, erzwingt den Hashline-Lese-/Grep-Anzeigemodus wenn das Edit-Tool verfügbar ist               |
| `PI_NO_PTY`                | Wenn `1`, deaktiviert den interaktiven PTY-Pfad für das Bash-Tool                                          |

`PI_NO_PTY` wird auch intern gesetzt wenn CLI `--no-pty` verwendet wird.

---

## 6) Speicher- und Konfigurations-Wurzelpfade

Diese werden über `@f5xc-salesdemos/pi-utils/dirs` konsumiert und beeinflussen, wo der coding-agent Daten speichert.

| Variable | Standard / Verhalten |
|---|---|
| `PI_CONFIG_DIR` | Konfigurations-Wurzelverzeichnisname unter Home (Standard `.xcsh`) |
| `PI_CODING_AGENT_DIR` | Vollständige Überschreibung für das Agent-Verzeichnis (Standard `~/<PI_CONFIG_DIR oder .xcsh>/agent`) |
| `PWD` | Wird beim Abgleich des kanonischen aktuellen Arbeitsverzeichnisses in Pfad-Hilfsfunktionen verwendet |

---

## 7) Shell-/Tool-Ausführungsumgebung

(Aus `packages/utils/src/procmgr.ts` und coding-agent Bash-Tool-Integration.)

| Variable | Verhalten |
|---|---|
| `PI_BASH_NO_CI` | Unterdrückt die automatische `CI=true`-Injektion in die gespawnte Shell-Umgebung |
| `CLAUDE_BASH_NO_CI` | Legacy-Alias-Fallback für `PI_BASH_NO_CI` |
| `PI_BASH_NO_LOGIN` | Vorgesehen zur Deaktivierung des Login-Shell-Modus |
| `CLAUDE_BASH_NO_LOGIN` | Legacy-Alias-Fallback für `PI_BASH_NO_LOGIN` |
| `PI_SHELL_PREFIX` | Optionaler Befehlspräfix-Wrapper |
| `CLAUDE_CODE_SHELL_PREFIX` | Legacy-Alias-Fallback für `PI_SHELL_PREFIX` |
| `VISUAL` | Bevorzugter externer Editor-Befehl |
| `EDITOR` | Fallback-externer Editor-Befehl |

Aktuelle Implementierungshinweis: `PI_BASH_NO_LOGIN`/`CLAUDE_BASH_NO_LOGIN` werden gelesen, aber das aktuelle `getShellArgs()` gibt in beiden Zweigen `['-l','-c']` zurück (effektiv heute ein No-Op).

---

## 8) UI/Theme/Sitzungserkennung (automatisch erkannte Umgebung)

Diese werden als Laufzeitsignale gelesen; sie werden normalerweise vom Terminal/OS gesetzt und nicht manuell konfiguriert.

| Variable | Verwendet für |
|---|---|
| `COLORTERM`, `TERM`, `WT_SESSION` | Farbfähigkeitserkennung (Theme-Farbmodus) |
| `COLORFGBG` | Terminal-Hintergrund Hell-/Dunkel-Auto-Erkennung |
| `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERMINAL_EMULATOR` | Terminal-Identität im System-Prompt/Kontext |
| `KDE_FULL_SESSION`, `XDG_CURRENT_DESKTOP`, `DESKTOP_SESSION`, `XDG_SESSION_DESKTOP`, `GDMSESSION`, `WINDOWMANAGER` | Desktop-/Fenstermanager-Erkennung im System-Prompt/Kontext |
| `KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION` | Stabile Pro-Terminal-Sitzungs-Breadcrumb-IDs |
| `SHELL`, `ComSpec`, `TERM_PROGRAM`, `TERM` | Systeminfo-Diagnose |
| `APPDATA`, `XDG_CONFIG_HOME` | lspmux-Konfigurationspfad-Auflösung |
| `HOME` | Pfadverkürzung in der MCP-Befehls-UI |

---

## 9) Native Loader-/Debug-Flags

| Variable | Verhalten |
|---|---|
| `PI_DEV` | Aktiviert ausführliche native Addon-Lade-Diagnose in `packages/natives` |

## 10) TUI-Laufzeit-Flags (gemeinsames Paket, beeinflusst die coding-agent-UX)

| Variable | Verhalten |
|---|---|
| `PI_NOTIFICATIONS` | `off` / `0` / `false` unterdrückt Desktop-Benachrichtigungen |
| `PI_TUI_WRITE_LOG` | Wenn gesetzt, protokolliert TUI-Schreibvorgänge in eine Datei |
| `PI_HARDWARE_CURSOR` | Wenn `1`, aktiviert den Hardware-Cursor-Modus |
| `PI_CLEAR_ON_SHRINK` | Wenn `1`, leert leere Zeilen wenn Inhalt schrumpft |
| `PI_DEBUG_REDRAW` | Wenn `1`, aktiviert Redraw-Debug-Logging |
| `PI_TUI_DEBUG` | Wenn `1`, aktiviert den tiefen TUI-Debug-Dump-Pfad |

---

## 11) Commit-Generierungssteuerungen

| Variable | Verhalten |
|---|---|
| `PI_COMMIT_TEST_FALLBACK` | Wenn `true` (Groß-/Kleinschreibung egal), erzwingt den Commit-Fallback-Generierungspfad |
| `PI_COMMIT_NO_FALLBACK` | Wenn `true`, deaktiviert den Fallback wenn der Agent keinen Vorschlag zurückgibt |
| `PI_COMMIT_MAP_REDUCE` | Wenn `false`, deaktiviert den Map-Reduce-Commit-Analysepfad |
| `DEBUG` | Wenn gesetzt, werden Commit-Agent-Fehler-Stack-Traces ausgegeben |

---

## Sicherheitsrelevante Variablen

Behandeln Sie diese als Geheimnisse; loggen oder committen Sie sie nicht:

- Provider-/API-Schlüssel und OAuth-/Bearer-Anmeldedaten (alle `*_API_KEY`, `*_TOKEN`, OAuth Access-/Refresh-Tokens)
- Cloud-Anmeldedaten (`AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS`-Pfad kann Service-Account-Material offenlegen)
- Such-/Provider-Auth-Variablen (`EXA_API_KEY`, `BRAVE_API_KEY`, `PERPLEXITY_API_KEY`, Anthropic-Such-Schlüssel)
- Foundry-mTLS-Material (`CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`, `NODE_EXTRA_CA_CERTS` wenn es auf private CA-Bundles zeigt)

Die Python-Laufzeit entfernt außerdem explizit viele gängige Schlüsselvariablen bevor Kernel-Subprozesse gestartet werden (`packages/coding-agent/src/ipy/runtime.ts`).
