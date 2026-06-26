---
title: Umgebungsvariablen
description: >-
  Referenz für Laufzeit-Umgebungsvariablen zur Konfiguration und
  Verhaltenssteuerung von xcsh.
sidebar:
  order: 2
  label: Umgebungsvariablen
i18n:
  sourceHash: 7baa9f5226ba
  translator: machine
---

# Umgebungsvariablen (Aktuelle Laufzeit-Referenz)

Diese Referenz wurde aus aktuellen Codepfaden abgeleitet in:

- `packages/coding-agent/src/**`
- `packages/ai/src/**` (Provider-/Auth-Auflösung, die vom coding-agent verwendet wird)
- `packages/utils/src/**` und `packages/tui/src/**`, wo diese Variablen die Laufzeit des coding-agent direkt beeinflussen

Es wird ausschließlich aktives Verhalten dokumentiert.

## Auflösungsmodell und Priorität

Die meisten Laufzeit-Lookups verwenden `$env` aus `@f5-sales-demo/pi-utils` (`packages/utils/src/env.ts`).

`$env` Ladereihenfolge:

1. Vorhandene Prozessumgebung (`Bun.env`)
2. Projekt `.env` (`$PWD/.env`) für noch nicht gesetzte Schlüssel
3. Home `.env` (`~/.env`) für noch nicht gesetzte Schlüssel

Zusätzliche Regel in `.env`-Dateien: `XCSH_*`-Schlüssel werden während des Parsens auf `PI_*`-Schlüssel gespiegelt.

---

## 1) Modell-/Provider-Authentifizierung

Diese werden über `getEnvApiKey()` (`packages/ai/src/stream.ts`) konsumiert, sofern nicht anders angegeben.

### Kern-Provider-Anmeldeinformationen

| Variable                        | Verwendet für | Erforderlich wenn                                             | Hinweise / Priorität                                                                                |
|---------------------------------|---|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `ANTHROPIC_OAUTH_TOKEN`         | Anthropic API-Auth | Verwendung von Anthropic mit OAuth-Token-Authentifizierung    | Hat Vorrang vor `ANTHROPIC_API_KEY` bei der Provider-Auth-Auflösung                                 |
| `ANTHROPIC_API_KEY`             | Anthropic API-Auth | Verwendung von Anthropic ohne OAuth-Token                     | Fallback nach `ANTHROPIC_OAUTH_TOKEN`                                                               |
| `ANTHROPIC_FOUNDRY_API_KEY`     | Anthropic über Azure Foundry / Enterprise-Gateway | `CLAUDE_CODE_USE_FOUNDRY` aktiviert                           | Hat Vorrang vor `ANTHROPIC_OAUTH_TOKEN` und `ANTHROPIC_API_KEY` wenn Foundry-Modus aktiviert ist    |
| `OPENAI_API_KEY`                | OpenAI-Auth | Verwendung von OpenAI-Familie-Providern ohne explizites apiKey-Argument | Wird von OpenAI Completions/Responses-Providern verwendet                                           |
| `GEMINI_API_KEY`                | Google Gemini-Auth | Verwendung von `google`-Provider-Modellen                     | Primärer Schlüssel für Gemini-Provider-Zuordnung                                                    |
| `GOOGLE_API_KEY`               | Gemini Image-Tool Auth-Fallback | Verwendung des `gemini_image`-Tools ohne `GEMINI_API_KEY`     | Wird vom Image-Tool-Fallback-Pfad des coding-agent verwendet                                       |
| `GROQ_API_KEY`                  | Groq-Auth | Verwendung von Groq-Modellen                                  |                                                                                                     |
| `CEREBRAS_API_KEY`              | Cerebras-Auth | Verwendung von Cerebras-Modellen                              |                                                                                                     |
| `TOGETHER_API_KEY`              | Together-Auth | Verwendung des `together`-Providers                           |                                                                                                     |
| `HUGGINGFACE_HUB_TOKEN`         | Hugging Face-Auth | Verwendung des `huggingface`-Providers                        | Primäre Hugging Face Token-Umgebungsvariable                                                        |
| `HF_TOKEN`                      | Hugging Face-Auth | Verwendung des `huggingface`-Providers                        | Fallback wenn `HUGGINGFACE_HUB_TOKEN` nicht gesetzt ist                                             |
| `SYNTHETIC_API_KEY`             | Synthetic-Auth | Verwendung von Synthetic-Modellen                             |                                                                                                     |
| `NVIDIA_API_KEY`                | NVIDIA-Auth | Verwendung des `nvidia`-Providers                             |                                                                                                     |
| `NANO_GPT_API_KEY`              | NanoGPT-Auth | Verwendung des `nanogpt`-Providers                            |                                                                                                     |
| `VENICE_API_KEY`                | Venice-Auth | Verwendung des `venice`-Providers                             |                                                                                                     |
| `LITELLM_API_KEY`               | LiteLLM-Auth | Verwendung des `litellm`-Providers                            | OpenAI-kompatibler LiteLLM-Proxy-Schlüssel. Wenn zusammen mit `LITELLM_BASE_URL` gesetzt, wird die Auto-Konfiguration von `models.yml` aktiviert |
| `LM_STUDIO_API_KEY`             | LM Studio-Auth (optional) | Verwendung des `lm-studio`-Providers mit authentifizierten Hosts | Lokales LM Studio läuft normalerweise ohne Auth; jeder nicht-leere Token funktioniert wenn ein Schlüssel erforderlich ist |
| `OLLAMA_API_KEY`                | Ollama-Auth (optional) | Verwendung des `ollama`-Providers mit authentifizierten Hosts | Lokales Ollama läuft normalerweise ohne Auth; jeder nicht-leere Token funktioniert wenn ein Schlüssel erforderlich ist |
| `LLAMA_CPP_API_KEY`             | Ollama-Auth (optional) | Verwendung von `llama-server` mit `--api-key`-Parameter      | Lokales llama.cpp läuft normalerweise ohne Auth; jeder nicht-leere Token funktioniert wenn ein Schlüssel konfiguriert ist |
| `XIAOMI_API_KEY`                | Xiaomi MiMo-Auth | Verwendung des `xiaomi`-Providers                             |                                                                                                     |
| `MOONSHOT_API_KEY`              | Moonshot-Auth | Verwendung des `moonshot`-Providers                           |                                                                                                     |
| `XAI_API_KEY`                   | xAI-Auth | Verwendung von xAI-Modellen                                   |                                                                                                     |
| `OPENROUTER_API_KEY`            | OpenRouter-Auth | Verwendung von OpenRouter-Modellen                            | Wird auch vom Image-Tool verwendet wenn bevorzugter/automatischer Provider OpenRouter ist           |
| `MISTRAL_API_KEY`               | Mistral-Auth | Verwendung von Mistral-Modellen                               |                                                                                                     |
| `ZAI_API_KEY`                   | z.ai-Auth | Verwendung von z.ai-Modellen                                  | Wird auch vom z.ai-Websuch-Provider verwendet                                                      |
| `MINIMAX_API_KEY`               | MiniMax-Auth | Verwendung des `minimax`-Providers                            |                                                                                                     |
| `MINIMAX_CODE_API_KEY`          | MiniMax Code-Auth | Verwendung des `minimax-code`-Providers                       |                                                                                                     |
| `MINIMAX_CODE_CN_API_KEY`       | MiniMax Code CN-Auth | Verwendung des `minimax-code-cn`-Providers                    |                                                                                                     |
| `OPENCODE_API_KEY`              | OpenCode-Auth | Verwendung von OpenCode-Modellen                              |                                                                                                     |
| `QIANFAN_API_KEY`               | Qianfan-Auth | Verwendung des `qianfan`-Providers                            |                                                                                                     |
| `QWEN_OAUTH_TOKEN`              | Qwen Portal-Auth | Verwendung von `qwen-portal` mit OAuth-Token                  | Hat Vorrang vor `QWEN_PORTAL_API_KEY`                                                               |
| `QWEN_PORTAL_API_KEY`           | Qwen Portal-Auth | Verwendung von `qwen-portal` mit API-Schlüssel               | Fallback nach `QWEN_OAUTH_TOKEN`                                                                    |
| `ZENMUX_API_KEY`                | ZenMux-Auth | Verwendung des `zenmux`-Providers                             | Wird für ZenMux OpenAI- und Anthropic-kompatible Routen verwendet                                  |
| `VLLM_API_KEY`                  | vLLM Auth/Discovery-Opt-in | Verwendung des `vllm`-Providers (lokale OpenAI-kompatible Server) | Jeder nicht-leere Wert funktioniert für lokale Server ohne Auth                                    |
| `CURSOR_ACCESS_TOKEN`           | Cursor-Provider-Auth | Verwendung des Cursor-Providers                               |                                                                                                     |
| `AI_GATEWAY_API_KEY`            | Vercel AI Gateway-Auth | Verwendung des `vercel-ai-gateway`-Providers                  |                                                                                                     |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | Cloudflare AI Gateway-Auth | Verwendung des `cloudflare-ai-gateway`-Providers              | Basis-URL muss als `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` konfiguriert werden |

### GitHub/Copilot-Token-Ketten

| Variable | Verwendet für | Kette |
|---|---|---|
| `COPILOT_GITHUB_TOKEN` | GitHub Copilot-Provider-Auth | `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` |
| `GH_TOKEN` | Copilot-Fallback; GitHub API-Auth im Web-Scraper | Im Web-Scraper: `GITHUB_TOKEN` → `GH_TOKEN` |
| `GITHUB_TOKEN` | Copilot-Fallback; GitHub API-Auth im Web-Scraper | Im Web-Scraper: wird vor `GH_TOKEN` geprüft |

---

## 2) Provider-spezifische Laufzeitkonfiguration

### Anthropic Foundry Gateway (Azure / Enterprise-Proxy)

Wenn `CLAUDE_CODE_USE_FOUNDRY` aktiviert ist, wechseln Anthropic-Anfragen in den Foundry-Modus:

- Die Basis-URL wird aus `FOUNDRY_BASE_URL` aufgelöst (Fallback bleibt die Modell-/Standard-Basis-URL wenn nicht gesetzt).
- Die API-Schlüssel-Auflösung für den Provider `anthropic` wird:
  `ANTHROPIC_FOUNDRY_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`.
- `ANTHROPIC_CUSTOM_HEADERS` wird als komma-/zeilengetrennte `key: value`-Paare geparst und in die Request-Header zusammengeführt.
- TLS-Client-/Server-Material kann aus Umgebungswerten injiziert werden:
  `NODE_EXTRA_CA_CERTS`, `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`.
  Jeder akzeptiert entweder:
  - einen Dateisystempfad zu PEM-Inhalt, oder
  - Inline-PEM (einschließlich escaped `\n`-Sequenzen).

| Variable | Werttyp | Verhalten |
|---|---|---|
| `CLAUDE_CODE_USE_FOUNDRY` | Boolean-ähnlicher String (`1`, `true`, `yes`, `on`) | Aktiviert den Foundry-Modus für den Anthropic-Provider |
| `FOUNDRY_BASE_URL` | URL-String | Anthropic-Endpunkt-Basis-URL im Foundry-Modus |
| `ANTHROPIC_FOUNDRY_API_KEY` | Token-String | Wird für `Authorization: Bearer <token>` verwendet |
| `ANTHROPIC_CUSTOM_HEADERS` | Header-Listen-String | Zusätzliche Header; Format `header-a: value, header-b: value` oder zeilengetrennt |
| `NODE_EXTRA_CA_CERTS` | PEM-Pfad oder Inline-PEM | Zusätzliche CA-Kette für Server-Zertifikatsvalidierung |
| `CLAUDE_CODE_CLIENT_CERT` | PEM-Pfad oder Inline-PEM | mTLS-Client-Zertifikat |
| `CLAUDE_CODE_CLIENT_KEY` | PEM-Pfad oder Inline-PEM | mTLS-Client-Privatschlüssel (muss mit Zertifikat gepaart sein) |

### Amazon Bedrock

| Variable | Standard / Verhalten |
|---|---|
| `AWS_REGION` | Primäre Regionsquelle |
| `AWS_DEFAULT_REGION` | Fallback wenn `AWS_REGION` nicht gesetzt |
| `AWS_PROFILE` | Aktiviert den Auth-Pfad mit benanntem Profil |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | Aktiviert den IAM-Schlüssel-Auth-Pfad |
| `AWS_BEARER_TOKEN_BEDROCK` | Aktiviert den Bearer-Token-Auth-Pfad |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `AWS_CONTAINER_CREDENTIALS_FULL_URI` | Aktiviert den ECS-Task-Anmeldeinformationspfad |
| `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` | Aktiviert den Web-Identity-Auth-Pfad |
| `AWS_BEDROCK_SKIP_AUTH` | Wenn `1`, werden Dummy-Anmeldeinformationen injiziert (Proxy-/Nicht-Auth-Szenarien) |
| `AWS_BEDROCK_FORCE_HTTP1` | Wenn `1`, wird der Node HTTP/1 Request-Handler erzwungen |

Regions-Fallback im Provider-Code: `options.region` → `AWS_REGION` → `AWS_DEFAULT_REGION` → `us-east-1`.

### Azure OpenAI Responses

| Variable | Standard / Verhalten |
|---|---|
| `AZURE_OPENAI_API_KEY` | Erforderlich, sofern kein API-Schlüssel als Option übergeben wird |
| `AZURE_OPENAI_API_VERSION` | Standard `v1` |
| `AZURE_OPENAI_BASE_URL` | Direkte Basis-URL-Überschreibung |
| `AZURE_OPENAI_RESOURCE_NAME` | Wird zur Konstruktion der Basis-URL verwendet: `https://<resource>.openai.azure.com/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | Optionaler Zuordnungs-String: `modelId=deploymentName,model2=deployment2` |

Basis-URL-Auflösung: Option `azureBaseUrl` → Umgebungsvariable `AZURE_OPENAI_BASE_URL` → Option/Umgebungsvariable Ressourcenname → `model.baseUrl`.

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
| `KIMI_OAUTH_HOST` | Fallback OAuth-Host-Überschreibung |
| `KIMI_CODE_BASE_URL` | Überschreibt die Kimi-Nutzungsendpunkt-Basis-URL (`usage/kimi.ts`) |

OAuth-Host-Kette: `KIMI_CODE_OAUTH_HOST` → `KIMI_OAUTH_HOST` → `https://auth.kimi.com`.

### Antigravity/Gemini Image-Kompatibilität

| Variable | Standard / Verhalten |
|---|---|
| `PI_AI_ANTIGRAVITY_VERSION` | Überschreibt das Antigravity User-Agent Versions-Tag im Gemini CLI-Provider |

### OpenAI Codex Responses (Feature-/Debug-Steuerungen)

| Variable | Verhalten |
|---|---|
| `PI_CODEX_DEBUG` | `1`/`true` aktiviert Codex-Provider-Debug-Protokollierung |
| `PI_CODEX_WEBSOCKET` | `1`/`true` aktiviert WebSocket-Transport-Präferenz |
| `PI_CODEX_WEBSOCKET_V2` | `1`/`true` aktiviert WebSocket v2-Pfad |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | Positive Ganzzahl-Überschreibung (Standard 300000) |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | Nicht-negative Ganzzahl-Überschreibung (Standard 5) |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | Positive Ganzzahl-Basis-Backoff-Überschreibung (Standard 500) |

### Cursor-Provider-Debug

| Variable | Verhalten |
|---|---|
| `DEBUG_CURSOR` | Aktiviert Provider-Debug-Protokolle; `2`/`verbose` für detaillierte Payload-Auszüge |
| `DEBUG_CURSOR_LOG` | Optionaler Dateipfad für JSONL-Debug-Protokollausgabe |

### Prompt-Cache-Kompatibilitätsschalter

| Variable | Verhalten |
|---|---|
| `PI_CACHE_RETENTION` | Wenn `long`, wird lange Aufbewahrung aktiviert wo unterstützt (`anthropic`, `openai-responses`, Bedrock-Aufbewahrungsauflösung) |

---

## 3) Websuche-Subsystem

### Suchprovider-Anmeldeinformationen

| Variable | Verwendet von |
|---|---|
| `EXA_API_KEY` | Exa-Suchprovider und Exa MCP-Tools |
| `BRAVE_API_KEY` | Brave-Suchprovider |
| `PERPLEXITY_API_KEY` | Perplexity-Suchprovider API-Schlüssel-Modus |
| `TAVILY_API_KEY` | Tavily-Suchprovider |
| `ZAI_API_KEY` | z.ai-Suchprovider (prüft auch gespeichertes OAuth in `agent.db`) |
| `OPENAI_API_KEY` / Codex OAuth in DB | Codex-Suchprovider Verfügbarkeit/Auth |

### Anthropic-Websuche Auth-Kette

`packages/coding-agent/src/web/search/auth.ts` löst Anthropic-Websuche-Anmeldeinformationen in dieser Reihenfolge auf:

1. `ANTHROPIC_SEARCH_API_KEY` (+ optionales `ANTHROPIC_SEARCH_BASE_URL`)
2. `models.json`-Provider-Eintrag mit `api: "anthropic-messages"`
3. Anthropic OAuth-Anmeldeinformationen aus `agent.db` (darf nicht innerhalb eines 5-Minuten-Puffers ablaufen)
4. Generischer Anthropic-Umgebungsvariablen-Fallback: Provider-Schlüssel (`ANTHROPIC_FOUNDRY_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`) + optionales `ANTHROPIC_BASE_URL` (`FOUNDRY_BASE_URL` wenn Foundry-Modus aktiviert ist)

Zugehörige Variablen:

| Variable | Standard / Verhalten |
|---|---|
| `ANTHROPIC_SEARCH_API_KEY` | Expliziter Suchschlüssel mit höchster Priorität |
| `ANTHROPIC_SEARCH_BASE_URL` | Standard ist `https://api.anthropic.com` wenn nicht angegeben |
| `ANTHROPIC_SEARCH_MODEL` | Standard ist `claude-haiku-4-5` |
| `ANTHROPIC_BASE_URL` | Generische Fallback-Basis-URL für Stufe-4-Auth-Pfad |

### Perplexity OAuth-Flow Verhaltensflag

| Variable | Verhalten |
|---|---|
| `PI_AUTH_NO_BORROW` | Wenn gesetzt, wird der macOS Native-App-Token-Borrowing-Pfad im Perplexity-Login-Flow deaktiviert |

---

## 4) Python-Tooling und Kernel-Laufzeit

| Variable | Standard / Verhalten |
|---|---|
| `PI_PY` | Python-Tool-Modus-Überschreibung: `0`/`bash`=`bash-only`, `1`/`py`=`ipy-only`, `mix`/`both`=`both`; ungültige Werte werden ignoriert |
| `PI_PYTHON_SKIP_CHECK` | Wenn `1`, werden Python-Kernel-Verfügbarkeitsprüfungen/Warmup-Prüfungen übersprungen |
| `PI_PYTHON_GATEWAY_URL` | Wenn gesetzt, wird ein externer Kernel-Gateway anstelle des lokalen Shared-Gateway verwendet |
| `PI_PYTHON_GATEWAY_TOKEN` | Optionales Auth-Token für externen Gateway (`Authorization: token <value>`) |
| `PI_PYTHON_IPC_TRACE` | Wenn `1`, aktiviert den Low-Level-IPC-Trace-Pfad im Kernel-Modul |
| `VIRTUAL_ENV` | Venv-Pfad mit höchster Priorität für die Python-Laufzeitauflösung |

Zusätzliches bedingtes Verhalten:

- Wenn `BUN_ENV=test` oder `NODE_ENV=test`, werden Python-Verfügbarkeitsprüfungen als OK behandelt und das Warming wird übersprungen.
- Die Python-Umgebungsfilterung blockiert gängige API-Schlüssel und erlaubt sichere Basisvariablen + `LC_`-, `XDG_`-, `PI_`-Präfixe.

---

## 5) Agent-/Laufzeit-Verhaltensschalter

| Variable                   | Standard / Verhalten                                                                         |
|----------------------------|----------------------------------------------------------------------------------------------|
| `PI_SMOL_MODEL`            | Ephemere Modellrollen-Überschreibung für `smol` (CLI `--smol` hat Vorrang)                   |
| `PI_SLOW_MODEL`            | Ephemere Modellrollen-Überschreibung für `slow` (CLI `--slow` hat Vorrang)                   |
| `PI_PLAN_MODEL`            | Ephemere Modellrollen-Überschreibung für `plan` (CLI `--plan` hat Vorrang)                   |
| `PI_NO_TITLE`              | Wenn gesetzt (jeder nicht-leere Wert), wird die automatische Sitzungstitelgenerierung bei der ersten Benutzernachricht deaktiviert |
| `NULL_PROMPT`              | Wenn `true`, gibt der System-Prompt-Builder einen leeren String zurück                       |
| `PI_BLOCKED_AGENT`         | Blockiert einen bestimmten Subagent-Typ im Task-Tool                                        |
| `PI_SUBPROCESS_CMD`        | Überschreibt den Subagent-Spawn-Befehl (`xcsh` / `xcsh.cmd`-Auflösungsumgehung)              |
| `PI_TASK_MAX_OUTPUT_BYTES` | Maximale erfasste Ausgabe-Bytes pro Subagent (Standard `500000`)                             |
| `PI_TASK_MAX_OUTPUT_LINES` | Maximale erfasste Ausgabezeilen pro Subagent (Standard `5000`)                               |
| `PI_TIMING`                | Wenn `1`, aktiviert Startup-/Tool-Timing-Instrumentierungsprotokolle                         |
| `PI_DEBUG_STARTUP`         | Aktiviert Startup-Stufen-Debug-Ausgaben auf stderr in mehreren Startup-Pfaden                |
| `PI_PACKAGE_DIR`           | Überschreibt die Auflösung des Paket-Asset-Basisverzeichnisses (Docs/Beispiele/Changelog-Pfadsuche) |
| `PI_DISABLE_LSPMUX`        | Wenn `1`, deaktiviert lspmux-Erkennung/-Integration und erzwingt direktes LSP-Server-Spawning |
| `LITELLM_BASE_URL`         | LiteLLM-Proxy-Basis-URL. Wenn zusammen mit `LITELLM_API_KEY` gesetzt, wird die Auto-Generierung von `models.yml` beim ersten Start und Selbstheilung bei jedem Start ausgelöst |
| `LM_STUDIO_BASE_URL`       | Standard-Überschreibung der impliziten LM Studio-Discovery-Basis-URL (`http://127.0.0.1:1234/v1` wenn nicht gesetzt) |
| `OLLAMA_BASE_URL`          | Standard-Überschreibung der impliziten Ollama-Discovery-Basis-URL (`http://127.0.0.1:11434` wenn nicht gesetzt) |
| `LLAMA_CPP_BASE_URL`       | Standard-Überschreibung der impliziten Llama.cpp-Discovery-Basis-URL (`http://127.0.0.1:8080` wenn nicht gesetzt) |
| `PI_EDIT_VARIANT`          | Wenn `hashline`, wird der Hashline-Lese-/Grep-Anzeigemodus erzwungen wenn das Edit-Tool verfügbar ist |
| `PI_NO_PTY`                | Wenn `1`, wird der interaktive PTY-Pfad für das Bash-Tool deaktiviert                        |

`PI_NO_PTY` wird auch intern gesetzt wenn CLI `--no-pty` verwendet wird.

---

## 6) Speicher- und Konfigurationswurzelpfade

Diese werden über `@f5-sales-demo/pi-utils/dirs` konsumiert und beeinflussen, wo der coding-agent Daten speichert.

| Variable | Standard / Verhalten |
|---|---|
| `PI_CONFIG_DIR` | Konfigurationswurzel-Verzeichnisname unter Home (Standard `.xcsh`) |
| `PI_CODING_AGENT_DIR` | Vollständige Überschreibung für das Agent-Verzeichnis (Standard `~/<PI_CONFIG_DIR oder .xcsh>/agent`) |
| `PWD` | Wird beim Abgleich des kanonischen aktuellen Arbeitsverzeichnisses in Pfad-Helfern verwendet |

---

## 7) Shell-/Tool-Ausführungsumgebung

(Aus `packages/utils/src/procmgr.ts` und der Bash-Tool-Integration des coding-agent.)

| Variable | Verhalten |
|---|---|
| `PI_BASH_NO_CI` | Unterdrückt die automatische `CI=true`-Injektion in die Umgebung gestarteter Shells |
| `CLAUDE_BASH_NO_CI` | Legacy-Alias-Fallback für `PI_BASH_NO_CI` |
| `PI_BASH_NO_LOGIN` | Vorgesehen zur Deaktivierung des Login-Shell-Modus |
| `CLAUDE_BASH_NO_LOGIN` | Legacy-Alias-Fallback für `PI_BASH_NO_LOGIN` |
| `PI_SHELL_PREFIX` | Optionaler Befehls-Präfix-Wrapper |
| `CLAUDE_CODE_SHELL_PREFIX` | Legacy-Alias-Fallback für `PI_SHELL_PREFIX` |
| `VISUAL` | Bevorzugter externer Editor-Befehl |
| `EDITOR` | Fallback externer Editor-Befehl |

Hinweis zur aktuellen Implementierung: `PI_BASH_NO_LOGIN`/`CLAUDE_BASH_NO_LOGIN` werden gelesen, aber die aktuelle `getShellArgs()`-Implementierung gibt in beiden Zweigen `['-l','-c']` zurück (effektiv heute ein No-Op).

---

## 8) UI/Theme/Sitzungserkennung (automatisch erkannte Umgebung)

Diese werden als Laufzeitsignale gelesen; sie werden normalerweise vom Terminal/Betriebssystem gesetzt und nicht manuell konfiguriert.

| Variable | Verwendet für |
|---|---|
| `COLORTERM`, `TERM`, `WT_SESSION` | Farbfähigkeitserkennung (Theme-Farbmodus) |
| `COLORFGBG` | Automatische Hell-/Dunkelerkennung des Terminal-Hintergrunds |
| `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERMINAL_EMULATOR` | Terminal-Identität im System-Prompt/Kontext |
| `KDE_FULL_SESSION`, `XDG_CURRENT_DESKTOP`, `DESKTOP_SESSION`, `XDG_SESSION_DESKTOP`, `GDMSESSION`, `WINDOWMANAGER` | Desktop-/Fenstermanager-Erkennung im System-Prompt/Kontext |
| `KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION` | Stabile Sitzungs-Breadcrumb-IDs pro Terminal |
| `SHELL`, `ComSpec`, `TERM_PROGRAM`, `TERM` | Systeminfo-Diagnose |
| `APPDATA`, `XDG_CONFIG_HOME` | lspmux-Konfigurationspfad-Auflösung |
| `HOME` | Pfadverkürzung in der MCP-Befehlsoberfläche |

---

## 9) Native Loader-/Debug-Flags

| Variable | Verhalten |
|---|---|
| `PI_DEV` | Aktiviert ausführliche Diagnosemeldungen beim Laden nativer Addons in `packages/natives` |

## 10) TUI-Laufzeit-Flags (gemeinsames Paket, beeinflusst die coding-agent UX)

| Variable | Verhalten |
|---|---|
| `PI_NOTIFICATIONS` | `off` / `0` / `false` unterdrückt Desktop-Benachrichtigungen |
| `PI_TUI_WRITE_LOG` | Wenn gesetzt, werden TUI-Schreibvorgänge in eine Datei protokolliert |
| `PI_HARDWARE_CURSOR` | Wenn `1`, wird der Hardware-Cursor-Modus aktiviert |
| `PI_CLEAR_ON_SHRINK` | Wenn `1`, werden leere Zeilen gelöscht wenn der Inhalt schrumpft |
| `PI_DEBUG_REDRAW` | Wenn `1`, wird die Redraw-Debug-Protokollierung aktiviert |
| `PI_TUI_DEBUG` | Wenn `1`, wird der tiefe TUI-Debug-Dump-Pfad aktiviert |

---

## 11) Commit-Generierungssteuerungen

| Variable | Verhalten |
|---|---|
| `PI_COMMIT_TEST_FALLBACK` | Wenn `true` (Groß-/Kleinschreibung egal), wird der Commit-Fallback-Generierungspfad erzwungen |
| `PI_COMMIT_NO_FALLBACK` | Wenn `true`, wird der Fallback deaktiviert wenn der Agent keinen Vorschlag zurückgibt |
| `PI_COMMIT_MAP_REDUCE` | Wenn `false`, wird der Map-Reduce-Commit-Analysepfad deaktiviert |
| `DEBUG` | Wenn gesetzt, werden Commit-Agent-Fehler-Stack-Traces ausgegeben |

---

## Sicherheitsrelevante Variablen

Behandeln Sie diese als Geheimnisse; protokollieren oder committen Sie sie nicht:

- Provider-/API-Schlüssel und OAuth-/Bearer-Anmeldeinformationen (alle `*_API_KEY`, `*_TOKEN`, OAuth Access-/Refresh-Tokens)
- Cloud-Anmeldeinformationen (`AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS`-Pfad kann Service-Account-Material offenlegen)
- Such-/Provider-Auth-Variablen (`EXA_API_KEY`, `BRAVE_API_KEY`, `PERPLEXITY_API_KEY`, Anthropic-Suchschlüssel)
- Foundry mTLS-Material (`CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`, `NODE_EXTRA_CA_CERTS` wenn es auf private CA-Bundles verweist)

Die Python-Laufzeit entfernt auch explizit viele gängige Schlüsselvariablen vor dem Starten von Kernel-Unterprozessen (`packages/coding-agent/src/ipy/runtime.ts`).
