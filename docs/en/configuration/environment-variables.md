---
title: Environment Variables
description: Runtime environment variable reference for xcsh configuration and behavior control.
sidebar:
  order: 2
  label: Environment variables
---

# Environment variables

This reference documents the runtime environment variables used by the coding agent runtime, derived from code paths across:

- `packages/coding-agent/src/**`
- `packages/ai/src/**` (provider and authentication resolution)
- `packages/utils/src/**` and `packages/tui/src/**` (runtime and user-interface controls)

## Resolution model and precedence

Runtime lookups use the `$env` helper from `@f5-sales-demo/pi-utils` (`packages/utils/src/env.ts`).

`$env` resolves variables in the following order of precedence:

1. Existing process environment (`Bun.env`)
2. Project-level `.env` file (`$PWD/.env`) for unset keys
3. User home `.env` file (`~/.env`) for unset keys

During `.env` parsing, keys with the `XCSH_*` prefix automatically mirror to corresponding `PI_*` keys.

---

## Model and provider authentication

The runtime consumes these variables via `getEnvApiKey()` (`packages/ai/src/stream.ts`) unless specified otherwise.

### Core provider credentials

| Variable | Used for | Required when | Notes and precedence |
| --- | --- | --- | --- |
| `ANTHROPIC_OAUTH_TOKEN` | Anthropic API authentication | Using Anthropic with OAuth tokens | Takes precedence over `ANTHROPIC_API_KEY` for provider authentication resolution |
| `ANTHROPIC_API_KEY` | Anthropic API authentication | Using Anthropic without an OAuth token | Fallback credential when `ANTHROPIC_OAUTH_TOKEN` is unset |
| `ANTHROPIC_FOUNDRY_API_KEY` | Anthropic via Azure Foundry or enterprise gateway | `CLAUDE_CODE_USE_FOUNDRY` is enabled | Takes precedence over `ANTHROPIC_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` when Foundry mode is active |
| `OPENAI_API_KEY` | OpenAI authentication | Using OpenAI-family providers without explicit `apiKey` parameters | Used by OpenAI Completions and Responses providers |
| `GEMINI_API_KEY` | Google Gemini authentication | Using `google` provider models | Primary key for Gemini provider mapping |
| `GOOGLE_API_KEY` | Gemini image tool authentication fallback | Using the `gemini_image` tool without `GEMINI_API_KEY` | Fallback key for image generation tools |
| `GROQ_API_KEY` | Groq authentication | Using Groq models | |
| `CEREBRAS_API_KEY` | Cerebras authentication | Using Cerebras models | |
| `TOGETHER_API_KEY` | Together authentication | Using the `together` provider | |
| `HUGGINGFACE_HUB_TOKEN` | Hugging Face authentication | Using the `huggingface` provider | Primary Hugging Face token variable |
| `HF_TOKEN` | Hugging Face authentication | Using the `huggingface` provider | Fallback token when `HUGGINGFACE_HUB_TOKEN` is unset |
| `SYNTHETIC_API_KEY` | Synthetic authentication | Using Synthetic models | |
| `NVIDIA_API_KEY` | NVIDIA authentication | Using the `nvidia` provider | |
| `NANO_GPT_API_KEY` | NanoGPT authentication | Using the `nanogpt` provider | |
| `VENICE_API_KEY` | Venice authentication | Using the `venice` provider | |
| `LITELLM_API_KEY` | LiteLLM authentication | Using the `litellm` provider | OpenAI-compatible LiteLLM proxy key; when set alongside `LITELLM_BASE_URL`, enables automatic configuration of `models.yml` |
| `LM_STUDIO_API_KEY` | LM Studio authentication (optional) | Using the `lm-studio` provider with authenticated hosts | Local LM Studio instances typically run without authentication; any non-empty string works when a key is required |
| `OLLAMA_API_KEY` | Ollama authentication (optional) | Using the `ollama` provider with authenticated hosts | Local Ollama instances typically run without authentication; any non-empty string works when a key is required |
| `LLAMA_CPP_API_KEY` | Llama.cpp authentication (optional) | Using `llama-server` configured with `--api-key` | Local llama.cpp instances typically run without authentication; any non-empty string works when a key is configured |
| `XIAOMI_API_KEY` | Xiaomi MiMo authentication | Using the `xiaomi` provider | |
| `MOONSHOT_API_KEY` | Moonshot authentication | Using the `moonshot` provider | |
| `XAI_API_KEY` | xAI authentication | Using xAI models | |
| `OPENROUTER_API_KEY` | OpenRouter authentication | Using OpenRouter models | Also used by the image tool when the preferred provider is OpenRouter |
| `MISTRAL_API_KEY` | Mistral authentication | Using Mistral models | |
| `ZAI_API_KEY` | z.ai authentication | Using z.ai models | Also used by the z.ai web search provider |
| `MINIMAX_API_KEY` | MiniMax authentication | Using the `minimax` provider | |
| `MINIMAX_CODE_API_KEY` | MiniMax Code authentication | Using the `minimax-code` provider | |
| `MINIMAX_CODE_CN_API_KEY` | MiniMax Code CN authentication | Using the `minimax-code-cn` provider | |
| `OPENCODE_API_KEY` | OpenCode authentication | Using OpenCode models | |
| `QIANFAN_API_KEY` | Qianfan authentication | Using the `qianfan` provider | |
| `QWEN_OAUTH_TOKEN` | Qwen Portal authentication | Using `qwen-portal` with OAuth token authentication | Takes precedence over `QWEN_PORTAL_API_KEY` |
| `QWEN_PORTAL_API_KEY` | Qwen Portal authentication | Using `qwen-portal` with API key authentication | Fallback key when `QWEN_OAUTH_TOKEN` is unset |
| `ZENMUX_API_KEY` | ZenMux authentication | Using the `zenmux` provider | Used for ZenMux OpenAI and Anthropic-compatible routing |
| `VLLM_API_KEY` | vLLM authentication and discovery | Using the `vllm` provider (local OpenAI-compatible endpoints) | Any non-empty string satisfies local unauthenticated servers |
| `CURSOR_ACCESS_TOKEN` | Cursor provider authentication | Using the Cursor provider | |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway authentication | Using the `vercel-ai-gateway` provider | |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | Cloudflare AI Gateway authentication | Using the `cloudflare-ai-gateway` provider | Requires base URL formatted as `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` |

### GitHub and Copilot token chains

| Variable | Used for | Resolution chain |
| --- | --- | --- |
| `COPILOT_GITHUB_TOKEN` | GitHub Copilot provider authentication | `COPILOT_GITHUB_TOKEN` —> `GH_TOKEN` —> `GITHUB_TOKEN` |
| `GH_TOKEN` | Copilot fallback; GitHub API authentication in web scraper | In web scraper: `GITHUB_TOKEN` —> `GH_TOKEN` |
| `GITHUB_TOKEN` | Copilot fallback; GitHub API authentication in web scraper | In web scraper: Checked before `GH_TOKEN` |

---

## Provider-specific runtime configuration

### Anthropic Foundry Gateway (Azure and enterprise proxy)

When `CLAUDE_CODE_USE_FOUNDRY` is active, Anthropic requests route to Foundry mode:

- Base URL resolves from `FOUNDRY_BASE_URL` (falls back to model default if unset).
- API key resolution order for the `anthropic` provider becomes:
  `ANTHROPIC_FOUNDRY_API_KEY` —> `ANTHROPIC_OAUTH_TOKEN` —> `ANTHROPIC_API_KEY`.
- `ANTHROPIC_CUSTOM_HEADERS` is parsed as comma-separated or newline-separated `key: value` pairs and merged into request headers.
- TLS client and server credentials can be injected from environment variables:
  `NODE_EXTRA_CA_CERTS`, `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`.
  Each variable accepts either a filesystem path to a PEM file or an inline PEM string (including escaped `\n` sequences).

| Variable | Value type | Behavior |
| --- | --- | --- |
| `CLAUDE_CODE_USE_FOUNDRY` | Boolean string (`1`, `true`, `yes`, `on`) | Enables Foundry mode for the Anthropic provider |
| `FOUNDRY_BASE_URL` | URL string | Anthropic endpoint base URL in Foundry mode |
| `ANTHROPIC_FOUNDRY_API_KEY` | Token string | Used for `Authorization: Bearer <token>` |
| `ANTHROPIC_CUSTOM_HEADERS` | Header list string | Additional headers; formatted as `header-a: value, header-b: value` or newline-separated |
| `NODE_EXTRA_CA_CERTS` | PEM path or inline PEM | Additional CA certificate bundle for server validation |
| `CLAUDE_CODE_CLIENT_CERT` | PEM path or inline PEM | Mutual TLS (mTLS) client certificate |
| `CLAUDE_CODE_CLIENT_KEY` | PEM path or inline PEM | Mutual TLS (mTLS) client private key (paired with client certificate) |

### Amazon Bedrock

| Variable | Default or behavior |
| --- | --- |
| `AWS_REGION` | Primary AWS region source |
| `AWS_DEFAULT_REGION` | Fallback region when `AWS_REGION` is unset |
| `AWS_PROFILE` | Named AWS profile authentication path |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | IAM access key and secret key authentication path |
| `AWS_BEARER_TOKEN_BEDROCK` | Bearer token authentication path |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `AWS_CONTAINER_CREDENTIALS_FULL_URI` | ECS task role credential path |
| `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` | Web identity token authentication path |
| `AWS_BEDROCK_SKIP_AUTH` | When set to `1`, injects dummy credentials for proxy or non-authenticated scenarios |
| `AWS_BEDROCK_FORCE_HTTP1` | When set to `1`, forces the Node.js HTTP/1 request handler |

Region fallback sequence: `options.region` —> `AWS_REGION` —> `AWS_DEFAULT_REGION` —> `us-east-1`.

### Azure OpenAI Responses

| Variable | Default or behavior |
| --- | --- |
| `AZURE_OPENAI_API_KEY` | Required unless the API key is passed via options |
| `AZURE_OPENAI_API_VERSION` | Defaults to `v1` |
| `AZURE_OPENAI_BASE_URL` | Direct base URL override |
| `AZURE_OPENAI_RESOURCE_NAME` | Constructs base URL: `https://<resource>.openai.azure.com/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | Deployment mapping string: `modelId=deploymentName,model2=deployment2` |

Base URL resolution sequence: `options.azureBaseUrl` —> `AZURE_OPENAI_BASE_URL` —> resource name derivation —> `model.baseUrl`.

### Google Vertex AI

| Variable | Required | Notes |
| --- | --- | --- |
| `GOOGLE_CLOUD_PROJECT` | Yes (unless passed via options) | Fallback: `GCLOUD_PROJECT` |
| `GCLOUD_PROJECT` | Optional fallback | Alternative project ID source |
| `GOOGLE_CLOUD_LOCATION` | Yes (unless passed via options) | No implicit default in provider |
| `GOOGLE_APPLICATION_CREDENTIALS` | Conditional | File path must exist if set; otherwise application default credentials (ADC) path is checked (`~/.config/gcloud/application_default_credentials.json`) |

### Kimi

| Variable | Default or behavior |
| --- | --- |
| `KIMI_CODE_OAUTH_HOST` | Primary OAuth host override |
| `KIMI_OAUTH_HOST` | Fallback OAuth host override |
| `KIMI_CODE_BASE_URL` | Overrides the Kimi usage endpoint base URL (`usage/kimi.ts`) |

OAuth host resolution chain: `KIMI_CODE_OAUTH_HOST` —> `KIMI_OAUTH_HOST` —> `https://auth.kimi.com`.

### Antigravity and Gemini image compatibility

| Variable | Default or behavior |
| --- | --- |
| `PI_AI_ANTIGRAVITY_VERSION` | Overrides the Antigravity user-agent version header in the Gemini CLI provider |

### OpenAI Codex responses (feature and debug controls)

| Variable | Behavior |
| --- | --- |
| `PI_CODEX_DEBUG` | Set to `1` or `true` to enable Codex provider debug logging |
| `PI_CODEX_WEBSOCKET` | Set to `1` or `true` to enable WebSocket transport preference |
| `PI_CODEX_WEBSOCKET_V2` | Set to `1` or `true` to enable the WebSocket v2 path |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | Positive integer overriding idle timeout in milliseconds (default: `300000`) |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | Non-negative integer overriding retry attempts (default: `5`) |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | Positive integer overriding base backoff delay in milliseconds (default: `500`) |

### Cursor provider debug

| Variable | Behavior |
| --- | --- |
| `DEBUG_CURSOR` | Enables provider debug logs; set to `2` or `verbose` for detailed payload snippets |
| `DEBUG_CURSOR_LOG` | Optional file path for JSONL debug log output |

### Prompt cache compatibility

| Variable | Behavior |
| --- | --- |
| `PI_CACHE_RETENTION` | When set to `long`, enables extended cache retention where supported (`anthropic`, `openai-responses`, and Bedrock) |

---

## Web search subsystem

### Search provider credentials

| Variable | Used by |
| --- | --- |
| `EXA_API_KEY` | Exa search provider and Exa MCP tools |
| `BRAVE_API_KEY` | Brave search provider |
| `PERPLEXITY_API_KEY` | Perplexity search provider in API-key mode |
| `TAVILY_API_KEY` | Tavily search provider |
| `ZAI_API_KEY` | z.ai search provider (also checks stored OAuth credentials in `agent.db`) |
| `OPENAI_API_KEY` | Codex search provider availability and authentication (or OAuth credentials in `agent.db`) |

### Anthropic web search authentication chain

`packages/coding-agent/src/web/search/auth.ts` resolves Anthropic web search credentials in this order:

1. `ANTHROPIC_SEARCH_API_KEY` (alongside optional `ANTHROPIC_SEARCH_BASE_URL`)
2. `models.json` provider entry with `api: "anthropic-messages"`
3. Anthropic OAuth credentials from `agent.db` (valid with at least a 5-minute buffer before expiry)
4. Generic Anthropic environment variables: `ANTHROPIC_FOUNDRY_API_KEY` —> `ANTHROPIC_OAUTH_TOKEN` —> `ANTHROPIC_API_KEY`, with optional `ANTHROPIC_BASE_URL` (`FOUNDRY_BASE_URL` when Foundry mode is active)

Related search variables:

| Variable | Default or behavior |
| --- | --- |
| `ANTHROPIC_SEARCH_API_KEY` | Highest-priority explicit search API key |
| `ANTHROPIC_SEARCH_BASE_URL` | Defaults to `https://api.anthropic.com` when omitted |
| `ANTHROPIC_SEARCH_MODEL` | Defaults to `claude-haiku-4-5` |
| `ANTHROPIC_BASE_URL` | Generic fallback base URL for tier-4 authentication |

### Perplexity OAuth flow behavior

| Variable | Behavior |
| --- | --- |
| `PI_AUTH_NO_BORROW` | When set, disables the macOS native application token borrowing path during Perplexity login |

---

## Python tooling and kernel runtime

| Variable | Default or behavior |
| --- | --- |
| `PI_PY` | Python tool mode override: `0` or `bash` (`bash-only`), `1` or `py` (`ipy-only`), `mix` or `both` (`both`); invalid values are ignored |
| `PI_PYTHON_SKIP_CHECK` | When set to `1`, skips Python kernel availability and warm checks |
| `PI_PYTHON_GATEWAY_URL` | When set, routes kernel execution to an external kernel gateway instead of the local shared gateway |
| `PI_PYTHON_GATEWAY_TOKEN` | Optional authentication token for the external gateway (`Authorization: token <value>`) |
| `PI_PYTHON_IPC_TRACE` | When set to `1`, enables low-level IPC trace logging in the kernel module |
| `VIRTUAL_ENV` | Highest-priority virtual environment path for Python runtime resolution |

Additional runtime rules:

- When `BUN_ENV=test` or `NODE_ENV=test`, Python availability checks pass automatically and kernel warming is skipped.
- The Python execution environment filters out common API keys while preserving safe base variables and prefixes matching `LC_*`, `XDG_*`, and `PI_*`.

---

## Agent and runtime behavior toggles

| Variable | Default or behavior |
| --- | --- |
| `PI_SMOL_MODEL` | Ephemeral model role override for `smol` (CLI `--smol` takes precedence) |
| `PI_SLOW_MODEL` | Ephemeral model role override for `slow` (CLI `--slow` takes precedence) |
| `PI_PLAN_MODEL` | Ephemeral model role override for `plan` (CLI `--plan` takes precedence) |
| `PI_NO_TITLE` | When set to any non-empty value, disables automatic session title generation on the first user message |
| `NULL_PROMPT` | When set to `true`, the system prompt builder returns an empty string |
| `PI_BLOCKED_AGENT` | Blocks a specific subagent type from being spawned by the task tool |
| `PI_SUBPROCESS_CMD` | Overrides the subagent spawn command (bypassing `xcsh` or `xcsh.cmd` resolution) |
| `PI_TASK_MAX_OUTPUT_BYTES` | Maximum captured output bytes per subagent (default: `500000`) |
| `PI_TASK_MAX_OUTPUT_LINES` | Maximum captured output lines per subagent (default: `5000`) |
| `PI_TIMING` | When set to `1`, enables startup and tool execution timing instrumentation logs |
| `PI_DEBUG_STARTUP` | Enables startup stage debug logging to standard error |
| `PI_PACKAGE_DIR` | Overrides package asset base directory resolution for documentation, examples, and changelogs |
| `PI_DISABLE_LSPMUX` | When set to `1`, disables lspmux detection and forces direct LSP server spawning |
| `LITELLM_BASE_URL` | LiteLLM proxy base URL; when set alongside `LITELLM_API_KEY`, generates `models.yml` on first run and validates configuration on startup |
| `LM_STUDIO_BASE_URL` | Base URL override for implicit LM Studio discovery (defaults to `http://127.0.0.1:1234/v1`) |
| `OLLAMA_BASE_URL` | Base URL override for implicit Ollama discovery (defaults to `http://127.0.0.1:11434`) |
| `LLAMA_CPP_BASE_URL` | Base URL override for implicit Llama.cpp discovery (defaults to `http://127.0.0.1:8080`) |
| `PI_EDIT_VARIANT` | When set to `hashline`, forces hashline read and grep display mode when the edit tool is active |
| `PI_NO_PTY` | When set to `1`, disables the interactive PTY path for the bash tool (also set internally by `--no-pty`) |

---

## Storage and configuration root paths

These variables are consumed via `@f5-sales-demo/pi-utils/dirs` and govern data storage locations:

| Variable | Default or behavior |
| --- | --- |
| `PI_CONFIG_DIR` | Configuration root directory name under the user home directory (defaults to `.xcsh`) |
| `PI_CODING_AGENT_DIR` | Full path override for the agent directory (defaults to `~/<PI_CONFIG_DIR or .xcsh>/agent`) |
| `PWD` | Used when matching canonical current working directories in path resolution helpers |

---

## Shell and tool execution environment

These variables govern subprocess management in `packages/utils/src/procmgr.ts` and the bash tool integration:

| Variable | Behavior |
| --- | --- |
| `PI_BASH_NO_CI` | Suppresses automatic `CI=true` injection into spawned shell environments |
| `CLAUDE_BASH_NO_CI` | Legacy fallback alias for `PI_BASH_NO_CI` |
| `PI_BASH_NO_LOGIN` | Disables login shell mode when spawning bash processes |
| `CLAUDE_BASH_NO_LOGIN` | Legacy fallback alias for `PI_BASH_NO_LOGIN` |
| `PI_SHELL_PREFIX` | Optional command prefix wrapper for shell executions |
| `CLAUDE_CODE_SHELL_PREFIX` | Legacy fallback alias for `PI_SHELL_PREFIX` |
| `VISUAL` | Preferred external editor command |
| `EDITOR` | Fallback external editor command |

---

## Terminal and session environment variables

The runtime detects the following environment variables automatically from the host environment:

| Variable | Used for |
| --- | --- |
| `COLORTERM`, `TERM`, `WT_SESSION` | Terminal color capability detection and theme selection |
| `COLORFGBG` | Terminal background light and dark mode auto-detection |
| `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERMINAL_EMULATOR` | Terminal identity detection for system prompt context |
| `KDE_FULL_SESSION`, `XDG_CURRENT_DESKTOP`, `DESKTOP_SESSION`, `XDG_SESSION_DESKTOP`, `GDMSESSION`, `WINDOWMANAGER` | Desktop environment and window manager detection for system prompt context |
| `KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION` | Stable per-terminal session breadcrumb identifiers |
| `SHELL`, `ComSpec`, `TERM_PROGRAM`, `TERM` | System diagnostics and shell detection |
| `APPDATA`, `XDG_CONFIG_HOME` | lspmux configuration path resolution |
| `HOME` | Path shortening in MCP command user interface |

---

## Native loader and debug flags

| Variable | Behavior |
| --- | --- |
| `PI_DEV` | Enables verbose native addon load diagnostics in `packages/natives` |

---

## Terminal user interface runtime flags

| Variable | Behavior |
| --- | --- |
| `PI_NOTIFICATIONS` | Set to `off`, `0`, or `false` to suppress desktop notifications |
| `PI_TUI_WRITE_LOG` | When set, logs TUI write operations to a specified file |
| `PI_HARDWARE_CURSOR` | When set to `1`, enables hardware cursor mode |
| `PI_CLEAR_ON_SHRINK` | When set to `1`, clears empty rows when rendered content shrinks |
| `PI_DEBUG_REDRAW` | When set to `1`, enables redraw debug logging |
| `PI_TUI_DEBUG` | When set to `1`, enables deep TUI debug dump logging |

---

## Commit generation controls

| Variable | Behavior |
| --- | --- |
| `PI_COMMIT_TEST_FALLBACK` | When set to `true` (case-insensitive), forces the commit fallback generation path |
| `PI_COMMIT_NO_FALLBACK` | When set to `true`, disables fallback when the commit agent returns no proposal |
| `PI_COMMIT_MAP_REDUCE` | When set to `false`, disables the map-reduce commit analysis path |
| `DEBUG` | When set, prints commit agent error stack traces to standard error |

---

## Security-sensitive variables

Protect the following variables as sensitive secrets; do not log or commit them:

- Provider API keys and OAuth tokens (`*_API_KEY`, `*_TOKEN`, OAuth access and refresh tokens).
- Cloud credentials (`AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS`).
- Web search authentication keys (`EXA_API_KEY`, `BRAVE_API_KEY`, `PERPLEXITY_API_KEY`, Anthropic search keys).
- Foundry mutual TLS credentials (`CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`, `NODE_EXTRA_CA_CERTS`).

The Python runtime automatically strips these sensitive keys before spawning kernel subprocesses (`packages/coding-agent/src/ipy/runtime.ts`).
