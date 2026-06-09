---
title: 環境變數
description: xcsh 設定與行為控制的執行期環境變數參考。
sidebar:
  order: 2
  label: 環境變數
i18n:
  sourceHash: 7baa9f5226ba
  translator: machine
---

# 環境變數（當前執行期參考）

本參考文件衍生自以下程式碼路徑中的當前實作：

- `packages/coding-agent/src/**`
- `packages/ai/src/**`（coding-agent 使用的提供者/驗證解析）
- `packages/utils/src/**` 和 `packages/tui/src/**`，其中這些變數直接影響 coding-agent 執行期

本文件僅記錄目前有效的行為。

## 解析模型與優先順序

大多數執行期查詢使用 `@f5xc-salesdemos/pi-utils`（`packages/utils/src/env.ts`）中的 `$env`。

`$env` 載入順序：

1. 現有的程序環境（`Bun.env`）
2. 專案 `.env`（`$PWD/.env`），僅用於尚未設定的鍵
3. 家目錄 `.env`（`~/.env`），僅用於尚未設定的鍵

`.env` 檔案中的額外規則：解析時 `XCSH_*` 鍵會映射為 `PI_*` 鍵。

---

## 1）模型/提供者驗證

除非另有說明，這些變數透過 `getEnvApiKey()`（`packages/ai/src/stream.ts`）使用。

### 核心提供者憑證

| 變數                        | 用途 | 必要條件                                                 | 備註 / 優先順序                                                                                  |
|---------------------------------|---|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `ANTHROPIC_OAUTH_TOKEN`         | Anthropic API 驗證 | 使用 Anthropic 搭配 OAuth 權杖驗證                         | 在提供者驗證解析中優先於 `ANTHROPIC_API_KEY`                              |
| `ANTHROPIC_API_KEY`             | Anthropic API 驗證 | 使用 Anthropic 且未使用 OAuth 權杖                           | `ANTHROPIC_OAUTH_TOKEN` 之後的備用方案                                                              |
| `ANTHROPIC_FOUNDRY_API_KEY`     | 透過 Azure Foundry / 企業閘道使用 Anthropic | 已啟用 `CLAUDE_CODE_USE_FOUNDRY`                             | 啟用 Foundry 模式時，優先於 `ANTHROPIC_OAUTH_TOKEN` 和 `ANTHROPIC_API_KEY`  |
| `OPENAI_API_KEY`                | OpenAI 驗證 | 使用 OpenAI 系列提供者且未明確傳入 apiKey 參數 | 由 OpenAI Completions/Responses 提供者使用                                                      |
| `GEMINI_API_KEY`                | Google Gemini 驗證 | 使用 `google` 提供者模型                                | Gemini 提供者映射的主要金鑰                                                             |
| `GOOGLE_API_KEY`                | Gemini 圖片工具驗證備用 | 使用 `gemini_image` 工具且未設定 `GEMINI_API_KEY`            | 由 coding-agent 圖片工具備用路徑使用                                                       |
| `GROQ_API_KEY`                  | Groq 驗證 | 使用 Groq 模型                                             |                                                                                                     |
| `CEREBRAS_API_KEY`              | Cerebras 驗證 | 使用 Cerebras 模型                                         |                                                                                                     |
| `TOGETHER_API_KEY`              | Together 驗證 | 使用 `together` 提供者                                     |                                                                                                     |
| `HUGGINGFACE_HUB_TOKEN`         | Hugging Face 驗證 | 使用 `huggingface` 提供者                                  | 主要 Hugging Face 權杖環境變數                                                                  |
| `HF_TOKEN`                      | Hugging Face 驗證 | 使用 `huggingface` 提供者                                  | 當 `HUGGINGFACE_HUB_TOKEN` 未設定時的備用方案                                                      |
| `SYNTHETIC_API_KEY`             | Synthetic 驗證 | 使用 Synthetic 模型                                        |                                                                                                     |
| `NVIDIA_API_KEY`                | NVIDIA 驗證 | 使用 `nvidia` 提供者                                       |                                                                                                     |
| `NANO_GPT_API_KEY`              | NanoGPT 驗證 | 使用 `nanogpt` 提供者                                      |                                                                                                     |
| `VENICE_API_KEY`                | Venice 驗證 | 使用 `venice` 提供者                                       |                                                                                                     |
| `LITELLM_API_KEY`               | LiteLLM 驗證 | 使用 `litellm` 提供者                                      | OpenAI 相容的 LiteLLM 代理金鑰。與 `LITELLM_BASE_URL` 一起設定時，會啟用 `models.yml` 的自動設定 |
| `LM_STUDIO_API_KEY`             | LM Studio 驗證（選用） | 使用 `lm-studio` 提供者搭配需要驗證的主機           | 本機 LM Studio 通常無需驗證；當需要金鑰時，任何非空權杖皆可使用         |
| `OLLAMA_API_KEY`                | Ollama 驗證（選用） | 使用 `ollama` 提供者搭配需要驗證的主機              | 本機 Ollama 通常無需驗證；當需要金鑰時，任何非空權杖皆可使用            |
| `LLAMA_CPP_API_KEY`             | Ollama 驗證（選用） | 使用 `llama-server` 搭配 `--api-key` 參數              | 本機 llama.cpp 通常無需驗證；當設定金鑰時，任何非空權杖皆可使用       |
| `XIAOMI_API_KEY`                | Xiaomi MiMo 驗證 | 使用 `xiaomi` 提供者                                       |                                                                                                     |
| `MOONSHOT_API_KEY`              | Moonshot 驗證 | 使用 `moonshot` 提供者                                     |                                                                                                     |
| `XAI_API_KEY`                   | xAI 驗證 | 使用 xAI 模型                                              |                                                                                                     |
| `OPENROUTER_API_KEY`            | OpenRouter 驗證 | 使用 OpenRouter 模型                                       | 當偏好/自動提供者為 OpenRouter 時，圖片工具也會使用                                  |
| `MISTRAL_API_KEY`               | Mistral 驗證 | 使用 Mistral 模型                                          |                                                                                                     |
| `ZAI_API_KEY`                   | z.ai 驗證 | 使用 z.ai 模型                                             | 也由 z.ai 網頁搜尋提供者使用                                                               |
| `MINIMAX_API_KEY`               | MiniMax 驗證 | 使用 `minimax` 提供者                                      |                                                                                                     |
| `MINIMAX_CODE_API_KEY`          | MiniMax Code 驗證 | 使用 `minimax-code` 提供者                                 |                                                                                                     |
| `MINIMAX_CODE_CN_API_KEY`       | MiniMax Code CN 驗證 | 使用 `minimax-code-cn` 提供者                              |                                                                                                     |
| `OPENCODE_API_KEY`              | OpenCode 驗證 | 使用 OpenCode 模型                                         |                                                                                                     |
| `QIANFAN_API_KEY`               | Qianfan 驗證 | 使用 `qianfan` 提供者                                      |                                                                                                     |
| `QWEN_OAUTH_TOKEN`              | Qwen Portal 驗證 | 使用 `qwen-portal` 搭配 OAuth 權杖                          | 優先於 `QWEN_PORTAL_API_KEY`                                                         |
| `QWEN_PORTAL_API_KEY`           | Qwen Portal 驗證 | 使用 `qwen-portal` 搭配 API 金鑰                              | `QWEN_OAUTH_TOKEN` 之後的備用方案                                                                   |
| `ZENMUX_API_KEY`                | ZenMux 驗證 | 使用 `zenmux` 提供者                                       | 用於 ZenMux OpenAI 和 Anthropic 相容路由                                              |
| `VLLM_API_KEY`                  | vLLM 驗證/探索啟用 | 使用 `vllm` 提供者（本機 OpenAI 相容伺服器）       | 對於無需驗證的本機伺服器，任何非空值皆可使用                                                 |
| `CURSOR_ACCESS_TOKEN`           | Cursor 提供者驗證 | 使用 Cursor 提供者                                         |                                                                                                     |
| `AI_GATEWAY_API_KEY`            | Vercel AI Gateway 驗證 | 使用 `vercel-ai-gateway` 提供者                            |                                                                                                     |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | Cloudflare AI Gateway 驗證 | 使用 `cloudflare-ai-gateway` 提供者                        | 基礎 URL 必須設定為 `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` |

### GitHub/Copilot 權杖鏈

| 變數 | 用途 | 鏈式順序 |
|---|---|---|
| `COPILOT_GITHUB_TOKEN` | GitHub Copilot 提供者驗證 | `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` |
| `GH_TOKEN` | Copilot 備用方案；網頁抓取器中的 GitHub API 驗證 | 在網頁抓取器中：`GITHUB_TOKEN` → `GH_TOKEN` |
| `GITHUB_TOKEN` | Copilot 備用方案；網頁抓取器中的 GitHub API 驗證 | 在網頁抓取器中：優先於 `GH_TOKEN` 檢查 |

---

## 2）提供者特定的執行期設定

### Anthropic Foundry 閘道（Azure / 企業代理）

當啟用 `CLAUDE_CODE_USE_FOUNDRY` 時，Anthropic 請求會切換至 Foundry 模式：

- 基礎 URL 從 `FOUNDRY_BASE_URL` 解析（若未設定則退回至模型/預設基礎 URL）。
- 提供者 `anthropic` 的 API 金鑰解析變為：
  `ANTHROPIC_FOUNDRY_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`。
- `ANTHROPIC_CUSTOM_HEADERS` 解析為逗號/換行分隔的 `key: value` 配對，並合併至請求標頭。
- TLS 客戶端/伺服器材料可從環境變數值注入：
  `NODE_EXTRA_CA_CERTS`、`CLAUDE_CODE_CLIENT_CERT`、`CLAUDE_CODE_CLIENT_KEY`。
  每個接受：
  - PEM 內容的檔案系統路徑，或
  - 行內 PEM（包含跳脫的 `\n` 序列）。

| 變數 | 值類型 | 行為 |
|---|---|---|
| `CLAUDE_CODE_USE_FOUNDRY` | 布林值字串（`1`、`true`、`yes`、`on`） | 為 Anthropic 提供者啟用 Foundry 模式 |
| `FOUNDRY_BASE_URL` | URL 字串 | Foundry 模式中的 Anthropic 端點基礎 URL |
| `ANTHROPIC_FOUNDRY_API_KEY` | 權杖字串 | 用於 `Authorization: Bearer <token>` |
| `ANTHROPIC_CUSTOM_HEADERS` | 標頭列表字串 | 額外標頭；格式為 `header-a: value, header-b: value` 或換行分隔 |
| `NODE_EXTRA_CA_CERTS` | PEM 路徑或行內 PEM | 用於伺服器憑證驗證的額外 CA 鏈 |
| `CLAUDE_CODE_CLIENT_CERT` | PEM 路徑或行內 PEM | mTLS 客戶端憑證 |
| `CLAUDE_CODE_CLIENT_KEY` | PEM 路徑或行內 PEM | mTLS 客戶端私鑰（必須與憑證配對） |

### Amazon Bedrock

| 變數 | 預設值 / 行為 |
|---|---|
| `AWS_REGION` | 主要區域來源 |
| `AWS_DEFAULT_REGION` | 當 `AWS_REGION` 未設定時的備用方案 |
| `AWS_PROFILE` | 啟用具名設定檔驗證路徑 |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | 啟用 IAM 金鑰驗證路徑 |
| `AWS_BEARER_TOKEN_BEDROCK` | 啟用持有者權杖驗證路徑 |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `AWS_CONTAINER_CREDENTIALS_FULL_URI` | 啟用 ECS 任務憑證路徑 |
| `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` | 啟用 Web Identity 驗證路徑 |
| `AWS_BEDROCK_SKIP_AUTH` | 若為 `1`，注入虛擬憑證（代理/無需驗證的情境） |
| `AWS_BEDROCK_FORCE_HTTP1` | 若為 `1`，強制使用 Node HTTP/1 請求處理器 |

提供者程式碼中的區域備用順序：`options.region` → `AWS_REGION` → `AWS_DEFAULT_REGION` → `us-east-1`。

### Azure OpenAI Responses

| 變數 | 預設值 / 行為 |
|---|---|
| `AZURE_OPENAI_API_KEY` | 除非透過選項傳入 API 金鑰，否則為必要 |
| `AZURE_OPENAI_API_VERSION` | 預設 `v1` |
| `AZURE_OPENAI_BASE_URL` | 直接基礎 URL 覆寫 |
| `AZURE_OPENAI_RESOURCE_NAME` | 用於建構基礎 URL：`https://<resource>.openai.azure.com/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | 選用映射字串：`modelId=deploymentName,model2=deployment2` |

基礎 URL 解析順序：選項 `azureBaseUrl` → 環境變數 `AZURE_OPENAI_BASE_URL` → 選項/環境變數的資源名稱 → `model.baseUrl`。

### Google Vertex AI

| 變數 | 是否必要？ | 備註 |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | 是（除非透過選項傳入） | 備用方案：`GCLOUD_PROJECT` |
| `GCLOUD_PROJECT` | 備用方案 | 作為替代專案 ID 來源使用 |
| `GOOGLE_CLOUD_LOCATION` | 是（除非透過選項傳入） | 提供者中無預設值 |
| `GOOGLE_APPLICATION_CREDENTIALS` | 有條件 | 若已設定，檔案必須存在；否則會檢查 ADC 備用路徑（`~/.config/gcloud/application_default_credentials.json`） |

### Kimi

| 變數 | 預設值 / 行為 |
|---|---|
| `KIMI_CODE_OAUTH_HOST` | 主要 OAuth 主機覆寫 |
| `KIMI_OAUTH_HOST` | 備用 OAuth 主機覆寫 |
| `KIMI_CODE_BASE_URL` | 覆寫 Kimi 使用端點基礎 URL（`usage/kimi.ts`） |

OAuth 主機鏈：`KIMI_CODE_OAUTH_HOST` → `KIMI_OAUTH_HOST` → `https://auth.kimi.com`。

### Antigravity/Gemini 圖片相容性

| 變數 | 預設值 / 行為 |
|---|---|
| `PI_AI_ANTIGRAVITY_VERSION` | 覆寫 Gemini CLI 提供者中 Antigravity 使用者代理版本標籤 |

### OpenAI Codex responses（功能/除錯控制）

| 變數 | 行為 |
|---|---|
| `PI_CODEX_DEBUG` | `1`/`true` 啟用 Codex 提供者除錯日誌 |
| `PI_CODEX_WEBSOCKET` | `1`/`true` 啟用 websocket 傳輸偏好 |
| `PI_CODEX_WEBSOCKET_V2` | `1`/`true` 啟用 websocket v2 路徑 |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | 正整數覆寫（預設 300000） |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | 非負整數覆寫（預設 5） |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | 正整數基礎退避覆寫（預設 500） |

### Cursor 提供者除錯

| 變數 | 行為 |
|---|---|
| `DEBUG_CURSOR` | 啟用提供者除錯日誌；`2`/`verbose` 用於詳細的酬載片段 |
| `DEBUG_CURSOR_LOG` | 選用的 JSONL 除錯日誌輸出檔案路徑 |

### 提示快取相容性切換

| 變數 | 行為 |
|---|---|
| `PI_CACHE_RETENTION` | 若為 `long`，在支援的地方啟用長期保留（`anthropic`、`openai-responses`、Bedrock 保留解析） |

---

## 3）網頁搜尋子系統

### 搜尋提供者憑證

| 變數 | 使用者 |
|---|---|
| `EXA_API_KEY` | Exa 搜尋提供者和 Exa MCP 工具 |
| `BRAVE_API_KEY` | Brave 搜尋提供者 |
| `PERPLEXITY_API_KEY` | Perplexity 搜尋提供者 API 金鑰模式 |
| `TAVILY_API_KEY` | Tavily 搜尋提供者 |
| `ZAI_API_KEY` | z.ai 搜尋提供者（也會檢查 `agent.db` 中儲存的 OAuth） |
| `OPENAI_API_KEY` / 資料庫中的 Codex OAuth | Codex 搜尋提供者可用性/驗證 |

### Anthropic 網頁搜尋驗證鏈

`packages/coding-agent/src/web/search/auth.ts` 按以下順序解析 Anthropic 網頁搜尋憑證：

1. `ANTHROPIC_SEARCH_API_KEY`（+ 選用的 `ANTHROPIC_SEARCH_BASE_URL`）
2. `models.json` 中 `api: "anthropic-messages"` 的提供者項目
3. `agent.db` 中的 Anthropic OAuth 憑證（不得在 5 分鐘緩衝期內過期）
4. 通用 Anthropic 環境變數備用方案：提供者金鑰（`ANTHROPIC_FOUNDRY_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`）+ 選用的 `ANTHROPIC_BASE_URL`（啟用 Foundry 模式時為 `FOUNDRY_BASE_URL`）

相關變數：

| 變數 | 預設值 / 行為 |
|---|---|
| `ANTHROPIC_SEARCH_API_KEY` | 最高優先順序的明確搜尋金鑰 |
| `ANTHROPIC_SEARCH_BASE_URL` | 省略時預設為 `https://api.anthropic.com` |
| `ANTHROPIC_SEARCH_MODEL` | 預設為 `claude-haiku-4-5` |
| `ANTHROPIC_BASE_URL` | 第 4 層驗證路徑的通用備用基礎 URL |

### Perplexity OAuth 流程行為旗標

| 變數 | 行為 |
|---|---|
| `PI_AUTH_NO_BORROW` | 若已設定，在 Perplexity 登入流程中停用 macOS 原生應用程式權杖借用路徑 |

---

## 4）Python 工具和核心執行期

| 變數 | 預設值 / 行為 |
|---|---|
| `PI_PY` | Python 工具模式覆寫：`0`/`bash`=`bash-only`、`1`/`py`=`ipy-only`、`mix`/`both`=`both`；無效值會被忽略 |
| `PI_PYTHON_SKIP_CHECK` | 若為 `1`，跳過 Python 核心可用性檢查/預熱檢查 |
| `PI_PYTHON_GATEWAY_URL` | 若已設定，使用外部核心閘道而非本機共享閘道 |
| `PI_PYTHON_GATEWAY_TOKEN` | 外部閘道的選用驗證權杖（`Authorization: token <value>`） |
| `PI_PYTHON_IPC_TRACE` | 若為 `1`，在核心模組中啟用低階 IPC 追蹤路徑 |
| `VIRTUAL_ENV` | Python 執行期解析中最高優先順序的虛擬環境路徑 |

額外的條件行為：

- 若 `BUN_ENV=test` 或 `NODE_ENV=test`，Python 可用性檢查會被視為通過，且跳過預熱。
- Python 環境過濾會拒絕常見的 API 金鑰，並允許安全的基礎變數加上 `LC_`、`XDG_`、`PI_` 前綴。

---

## 5）代理/執行期行為切換

| 變數                   | 預設值 / 行為                                                                           |
|----------------------------|----------------------------------------------------------------------------------------------|
| `PI_SMOL_MODEL`            | `smol` 角色的臨時模型覆寫（CLI `--smol` 優先）                     |
| `PI_SLOW_MODEL`            | `slow` 角色的臨時模型覆寫（CLI `--slow` 優先）                     |
| `PI_PLAN_MODEL`            | `plan` 角色的臨時模型覆寫（CLI `--plan` 優先）                     |
| `PI_NO_TITLE`              | 若已設定（任何非空值），在第一則使用者訊息時停用自動工作階段標題產生   |
| `NULL_PROMPT`              | 若為 `true`，系統提示詞建構器返回空字串                                        |
| `PI_BLOCKED_AGENT`         | 在任務工具中封鎖特定的子代理類型                                                 |
| `PI_SUBPROCESS_CMD`        | 覆寫子代理衍生命令（繞過 `xcsh` / `xcsh.cmd` 解析）                       |
| `PI_TASK_MAX_OUTPUT_BYTES` | 每個子代理的最大擷取輸出位元組數（預設 `500000`）                                    |
| `PI_TASK_MAX_OUTPUT_LINES` | 每個子代理的最大擷取輸出行數（預設 `5000`）                                      |
| `PI_TIMING`                | 若為 `1`，啟用啟動/工具計時檢測日誌                                     |
| `PI_DEBUG_STARTUP`         | 在多個啟動路徑中啟用啟動階段除錯輸出至 stderr                       |
| `PI_PACKAGE_DIR`           | 覆寫套件資源基礎目錄解析（文件/範例/變更日誌路徑查詢）            |
| `PI_DISABLE_LSPMUX`        | 若為 `1`，停用 lspmux 偵測/整合並強制直接衍生 LSP 伺服器          |
| `LITELLM_BASE_URL`         | LiteLLM 代理基礎 URL。與 `LITELLM_API_KEY` 一起設定時，會在首次執行時觸發 `models.yml` 的自動產生，並在每次啟動時進行自我修復 |
| `LM_STUDIO_BASE_URL`       | 預設隱含的 LM Studio 探索基礎 URL 覆寫（若未設定則為 `http://127.0.0.1:1234/v1`） |
| `OLLAMA_BASE_URL`          | 預設隱含的 Ollama 探索基礎 URL 覆寫（若未設定則為 `http://127.0.0.1:11434`）      |
| `LLAMA_CPP_BASE_URL`       | 預設隱含的 Llama.cpp 探索基礎 URL 覆寫（若未設定則為 `http://127.0.0.1:8080`）    |
| `PI_EDIT_VARIANT`          | 若為 `hashline`，在編輯工具可用時強制使用 hashline 讀取/搜尋顯示模式               |
| `PI_NO_PTY`                | 若為 `1`，停用 bash 工具的互動式 PTY 路徑                                          |

`PI_NO_PTY` 在使用 CLI `--no-pty` 時也會在內部設定。

---

## 6）儲存和設定根路徑

這些變數透過 `@f5xc-salesdemos/pi-utils/dirs` 使用，影響 coding-agent 儲存資料的位置。

| 變數 | 預設值 / 行為 |
|---|---|
| `PI_CONFIG_DIR` | 家目錄下的設定根目錄名稱（預設 `.xcsh`） |
| `PI_CODING_AGENT_DIR` | 代理目錄的完整覆寫（預設 `~/<PI_CONFIG_DIR 或 .xcsh>/agent`） |
| `PWD` | 在路徑輔助工具中用於匹配規範化的當前工作目錄 |

---

## 7）Shell/工具執行環境

（來自 `packages/utils/src/procmgr.ts` 和 coding-agent bash 工具整合。）

| 變數 | 行為 |
|---|---|
| `PI_BASH_NO_CI` | 抑制對衍生 shell 環境自動注入 `CI=true` |
| `CLAUDE_BASH_NO_CI` | `PI_BASH_NO_CI` 的舊版別名備用方案 |
| `PI_BASH_NO_LOGIN` | 用於停用登入 shell 模式 |
| `CLAUDE_BASH_NO_LOGIN` | `PI_BASH_NO_LOGIN` 的舊版別名備用方案 |
| `PI_SHELL_PREFIX` | 選用的命令前綴包裝器 |
| `CLAUDE_CODE_SHELL_PREFIX` | `PI_SHELL_PREFIX` 的舊版別名備用方案 |
| `VISUAL` | 偏好的外部編輯器命令 |
| `EDITOR` | 備用的外部編輯器命令 |

目前實作備註：`PI_BASH_NO_LOGIN`/`CLAUDE_BASH_NO_LOGIN` 會被讀取，但目前的 `getShellArgs()` 在兩個分支中都返回 `['-l','-c']`（目前實際上無作用）。

---

## 8）UI/主題/工作階段偵測（自動偵測的環境變數）

這些變數作為執行期訊號被讀取；通常由終端機/作業系統設定，而非手動配置。

| 變數 | 用途 |
|---|---|
| `COLORTERM`、`TERM`、`WT_SESSION` | 色彩能力偵測（主題色彩模式） |
| `COLORFGBG` | 終端機背景明暗自動偵測 |
| `TERM_PROGRAM`、`TERM_PROGRAM_VERSION`、`TERMINAL_EMULATOR` | 系統提示詞/上下文中的終端機識別 |
| `KDE_FULL_SESSION`、`XDG_CURRENT_DESKTOP`、`DESKTOP_SESSION`、`XDG_SESSION_DESKTOP`、`GDMSESSION`、`WINDOWMANAGER` | 系統提示詞/上下文中的桌面/視窗管理器偵測 |
| `KITTY_WINDOW_ID`、`TMUX_PANE`、`TERM_SESSION_ID`、`WT_SESSION` | 穩定的每終端機工作階段麵包屑 ID |
| `SHELL`、`ComSpec`、`TERM_PROGRAM`、`TERM` | 系統資訊診斷 |
| `APPDATA`、`XDG_CONFIG_HOME` | lspmux 設定路徑解析 |
| `HOME` | MCP 命令 UI 中的路徑縮短 |

---

## 9）原生載入器/除錯旗標

| 變數 | 行為 |
|---|---|
| `PI_DEV` | 在 `packages/natives` 中啟用詳細的原生附加元件載入診斷 |

## 10）TUI 執行期旗標（共享套件，影響 coding-agent 使用者體驗）

| 變數 | 行為 |
|---|---|
| `PI_NOTIFICATIONS` | `off` / `0` / `false` 抑制桌面通知 |
| `PI_TUI_WRITE_LOG` | 若已設定，將 TUI 寫入記錄到檔案 |
| `PI_HARDWARE_CURSOR` | 若為 `1`，啟用硬體游標模式 |
| `PI_CLEAR_ON_SHRINK` | 若為 `1`，當內容縮小時清除空行 |
| `PI_DEBUG_REDRAW` | 若為 `1`，啟用重繪除錯日誌 |
| `PI_TUI_DEBUG` | 若為 `1`，啟用深層 TUI 除錯傾印路徑 |

---

## 11）提交產生控制

| 變數 | 行為 |
|---|---|
| `PI_COMMIT_TEST_FALLBACK` | 若為 `true`（不區分大小寫），強制使用提交備用產生路徑 |
| `PI_COMMIT_NO_FALLBACK` | 若為 `true`，當代理未返回提案時停用備用方案 |
| `PI_COMMIT_MAP_REDUCE` | 若為 `false`，停用 map-reduce 提交分析路徑 |
| `DEBUG` | 若已設定，會印出提交代理錯誤堆疊追蹤 |

---

## 安全敏感變數

請將這些變數視為機密；請勿記錄或提交它們：

- 提供者/API 金鑰和 OAuth/持有者憑證（所有 `*_API_KEY`、`*_TOKEN`、OAuth 存取/重新整理權杖）
- 雲端憑證（`AWS_*`、`GOOGLE_APPLICATION_CREDENTIALS` 路徑可能暴露服務帳戶材料）
- 搜尋/提供者驗證變數（`EXA_API_KEY`、`BRAVE_API_KEY`、`PERPLEXITY_API_KEY`、Anthropic 搜尋金鑰）
- Foundry mTLS 材料（`CLAUDE_CODE_CLIENT_CERT`、`CLAUDE_CODE_CLIENT_KEY`、當 `NODE_EXTRA_CA_CERTS` 指向私有 CA 套件時）

Python 執行期在衍生核心子程序之前也會明確清除許多常見的金鑰變數（`packages/coding-agent/src/ipy/runtime.ts`）。
