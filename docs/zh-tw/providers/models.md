---
title: 模型與供應商配置
description: 透過 models.yml 進行模型登錄與供應商配置，包含路由、回退與定價功能。
sidebar:
  order: 1
  label: 模型與供應商
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# 模型與供應商配置（`models.yml`）

本文件描述 coding-agent 目前如何載入模型、套用覆寫設定、解析憑證，以及在執行階段選擇模型。

## 控制模型行為的要素

主要實作檔案：

- `src/config/model-registry.ts` — 載入內建 + 自訂模型、供應商覆寫、執行階段發現、認證整合
- `src/config/model-resolver.ts` — 解析模型模式並選擇 initial/smol/slow 模型
- `src/config/settings-schema.ts` — 模型相關設定（`modelRoles`、供應商傳輸偏好）
- `src/session/auth-storage.ts` — API 金鑰 + OAuth 解析順序
- `packages/ai/src/models.ts` 和 `packages/ai/src/types.ts` — 內建供應商/模型及 `Model`/`compat` 類型

## 設定檔位置與舊版行為

預設設定檔路徑：

- `~/.xcsh/agent/models.yml`

仍存在的舊版行為：

- 如果 `models.yml` 不存在但同一位置有 `models.json`，則會遷移至 `models.yml`。
- 以程式方式傳遞給 `ModelRegistry` 時，仍支援明確的 `.json` / `.jsonc` 設定檔路徑。

## `models.yml` 結構

```yaml
configVersion: 1  # optional — written by auto-config, used for migration detection
providers:
  <provider-id>:
    # provider-level config
equivalence:
  overrides:
    <provider-id>/<model-id>: <canonical-model-id>
  exclude:
    - <provider-id>/<model-id>
```

`configVersion` 是由自動配置系統寫入的可選整數。存在時，xcsh 會用它來偵測過時的設定並自動升級。

`provider-id` 是跨選擇和認證查詢使用的標準供應商金鑰。

`equivalence` 為選填，用於在具體供應商模型之上配置標準模型分組：

- `overrides` 將精確的具體選擇器（`provider/modelId`）對應至官方上游標準 ID
- `exclude` 將具體選擇器排除在標準分組之外

## 供應商層級欄位

```yaml
providers:
  my-provider:
    baseUrl: https://api.example.com/v1
    apiKey: MY_PROVIDER_API_KEY
    api: openai-completions
    headers:
      X-Team: platform
    authHeader: true
    auth: apiKey
    discovery:
      type: ollama
    modelOverrides:
      some-model-id:
        name: Renamed model
    models:
      - id: some-model-id
        name: Some Model
        api: openai-completions
        reasoning: false
        input: [text]
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
        contextWindow: 128000
        maxTokens: 16384
        headers:
          X-Model: value
        compat:
          supportsStore: true
          supportsDeveloperRole: true
          supportsReasoningEffort: true
          maxTokensField: max_completion_tokens
          openRouterRouting:
            only: [anthropic]
          vercelGatewayRouting:
            order: [anthropic, openai]
          extraBody:
            gateway: m1-01
            controller: mlx
```

### 允許的供應商/模型 `api` 值

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### 允許的 auth/discovery 值

- `auth`：`apiKey`（預設）或 `none`
- `discovery.type`：`ollama`

## 驗證規則（目前）

### 完整自訂供應商（`models` 非空）

必要條件：

- `baseUrl`
- `apiKey`（除非設定 `auth: none`）
- `api` 在供應商層級或每個模型上

### 僅覆寫供應商（`models` 缺失或為空）

必須定義以下至少一項：

- `baseUrl`
- `modelOverrides`
- `discovery`

### 發現

- `discovery` 需要供應商層級的 `api`。

### 模型值檢查

- `id` 為必要
- `contextWindow` 和 `maxTokens` 如有提供必須為正數

## 合併與覆寫順序

ModelRegistry 管線（重新整理時）：

1. 從 `@f5xc-salesdemos/pi-ai` 載入內建供應商/模型。
2. 載入 `models.yml` 自訂設定。
3. 將供應商覆寫（`baseUrl`、`headers`）套用至內建模型。
4. 套用 `modelOverrides`（按供應商 + 模型 ID）。
5. 合併自訂 `models`：
   - 相同 `provider + id` 會取代現有項目
   - 否則附加
6. 套用執行階段發現的模型（目前為 Ollama 和 LM Studio），然後重新套用模型覆寫。

## 標準模型等效與合併

登錄會保留每個具體的供應商模型，然後在其上建構標準層。

標準 ID 僅為官方上游 ID，例如：

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### `models.yml` 等效設定

範例：

```yaml
providers:
  zenmux:
    baseUrl: https://api.zenmux.example/v1
    apiKey: ZENMUX_API_KEY
    api: openai-codex-responses
    models:
      - id: codex
        name: Zenmux Codex
        reasoning: true
        input: [text]
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
        contextWindow: 200000
        maxTokens: 32768

equivalence:
  overrides:
    zenmux/codex: gpt-5.3-codex
    p-codex/codex: gpt-5.3-codex
  exclude:
    - demo/codex-preview
```

標準分組的建構順序：

1. 來自 `equivalence.overrides` 的精確使用者覆寫
2. 來自內建模型中繼資料的內建官方 ID 比對
3. 針對閘道/供應商變體的保守啟發式正規化
4. 回退至具體模型本身的 ID

目前的啟發式方法刻意保持狹窄：

- 存在時可以移除嵌入的上游前綴，例如 `anthropic/...` 或 `openai/...`
- 帶點和帶破折號的版本變體僅在對應至現有官方 ID 時才會正規化，例如 `4.6 -> 4-6`
- 不明確的系列或版本不會在沒有內建比對或明確覆寫的情況下合併

### 標準解析行為

當多個具體變體共享同一標準 ID 時，解析使用：

1. 可用性與認證
2. `config.yml` 中的 `modelProviderOrder`
3. 如果未設定 `modelProviderOrder`，則使用現有的登錄/供應商順序

已停用或未認證的供應商會被跳過。

工作階段狀態和記錄會繼續記錄實際執行該回合的具體供應商/模型。

供應商預設值與每個模型的覆寫：

- 供應商 `headers` 為基準。
- 模型 `headers` 會覆寫供應商的標頭金鑰。
- `modelOverrides` 可以覆寫模型中繼資料（`name`、`reasoning`、`input`、`cost`、`contextWindow`、`maxTokens`、`headers`、`compat`、`contextPromotionTarget`）。
- `compat` 會對巢狀路由區塊（`openRouterRouting`、`vercelGatewayRouting`、`extraBody`）進行深度合併。

## 執行階段發現整合

### 隱式 Ollama 發現

如果未明確配置 `ollama`，登錄會新增一個隱式可發現供應商：

- 供應商：`ollama`
- API：`openai-completions`
- 基底 URL：`OLLAMA_BASE_URL` 或 `http://127.0.0.1:11434`
- 認證模式：免金鑰（`auth: none` 行為）

執行階段發現會對 Ollama 呼叫 `GET /api/tags` 並以本地預設值合成模型條目。

### 隱式 llama.cpp 發現

如果未明確配置 `llama.cpp`，登錄會新增一個隱式可發現供應商：
注意：它使用較新的 anthropic messages API 而非 openai-completions。

- 供應商：`llama.cpp`
- API：`openai-responses`
- 基底 URL：`LLAMA_CPP_BASE_URL` 或 `http://127.0.0.1:8080`
- 認證模式：免金鑰（`auth: none` 行為）

執行階段發現會對 llama.cpp 呼叫 `GET models` 並以本地預設值合成模型條目。

### 隱式 LM Studio 發現

如果未明確配置 `lm-studio`，登錄會新增一個隱式可發現供應商：

- 供應商：`lm-studio`
- API：`openai-completions`
- 基底 URL：`LM_STUDIO_BASE_URL` 或 `http://127.0.0.1:1234/v1`
- 認證模式：免金鑰（`auth: none` 行為）

執行階段發現會擷取模型（`GET /models`）並以本地預設值合成模型條目。

### 明確供應商發現

您可以自行配置發現：

```yaml
providers:
  ollama:
    baseUrl: http://127.0.0.1:11434
    api: openai-completions
    auth: none
    discovery:
      type: ollama
      
  llama.cpp:
    baseUrl: http://127.0.0.1:8080
    api: openai-responses
    auth: none
    discovery:
      type: llama.cpp
```

### 擴充供應商註冊

擴充可以在執行階段註冊供應商（`pi.registerProvider(...)`），包括：

- 供應商的模型取代/附加
- 為新 API ID 註冊自訂串流處理器
- 自訂 OAuth 供應商註冊

## 認證與 API 金鑰解析順序

請求供應商金鑰時，有效順序為：

1. 執行階段覆寫（CLI `--api-key`）
2. `agent.db` 中儲存的 API 金鑰憑證
3. `agent.db` 中儲存的 OAuth 憑證（含重新整理）
4. 環境變數對應（`OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 等）
5. ModelRegistry 回退解析器（來自 `models.yml` 的供應商 `apiKey`，環境變數名稱或字面值語義）

`models.yml` 的 `apiKey` 行為：

- 值首先被視為環境變數名稱。
- 如果沒有對應的環境變數，則使用字面字串作為令牌。

如果 `authHeader: true` 且供應商 `apiKey` 已設定，模型會取得：

- 注入 `Authorization: Bearer <resolved-key>` 標頭。

免金鑰供應商：

- 標記為 `auth: none` 的供應商被視為無需憑證即可使用。
- `getApiKey*` 對它們回傳 `kNoAuth`。

## 模型可用性與所有模型

- `getAll()` 回傳已載入的模型登錄（內建 + 合併的自訂 + 已發現的）。
- `getAvailable()` 篩選出免金鑰或有可解析認證的模型。

因此模型可以存在於登錄中，但在認證可用之前不可選擇。

## 執行階段模型解析

### CLI 與模式解析

`model-resolver.ts` 支援：

- 精確 `provider/modelId`
- 精確標準模型 ID
- 精確模型 ID（推斷供應商）
- 模糊/子字串比對
- `--models` 中的萬用字元範圍模式（例如 `openai/*`、`*sonnet*`）
- 可選的 `:thinkingLevel` 後綴（`off|minimal|low|medium|high|xhigh`）

`--provider` 為舊版；建議使用 `--model`。

精確選擇器的解析優先順序：

1. 精確 `provider/modelId` 繞過合併
2. 精確標準 ID 透過標準索引解析
3. 精確的裸具體 ID 仍然有效
4. 模糊和萬用字元比對在精確路徑之後執行

### 初始模型選擇優先順序

`findInitialModel(...)` 使用以下順序：

1. 明確的 CLI 供應商+模型
2. 第一個範圍模型（如果未恢復）
3. 已儲存的預設供應商/模型
4. 可用模型中的已知供應商預設值（例如 OpenAI/Anthropic 等）
5. 第一個可用模型

### 角色別名與設定

支援的模型角色：

- `default`、`smol`、`slow`、`plan`、`commit`

像 `pi/smol` 這樣的角色別名會透過 `settings.modelRoles` 展開。每個角色值也可以附加思考選擇器，如 `:minimal`、`:low`、`:medium` 或 `:high`。

如果某角色指向另一個角色，目標模型仍然正常繼承，且引用角色上的任何明確後綴會在該角色特定使用時勝出。

相關設定：

- `modelRoles`（記錄）
- `enabledModels`（範圍模式清單）
- `modelProviderOrder`（全域標準供應商優先順序）
- `providers.kimiApiFormat`（`openai` 或 `anthropic` 請求格式）
- `providers.openaiWebsockets`（OpenAI Codex 傳輸的 `auto|off|on` websocket 偏好）

`modelRoles` 可以儲存：

- `provider/modelId` 以固定具體的供應商變體
- 標準 ID 如 `gpt-5.3-codex` 以允許供應商合併

對於 `enabledModels` 和 CLI `--models`：

- 精確標準 ID 會展開為該標準群組中的所有具體變體
- 明確的 `provider/modelId` 條目保持精確
- 萬用字元和模糊比對仍在具體模型上運作

## `/model` 和 `--list-models`

兩個介面都保持供應商前綴模型的可見性和可選擇性。

它們現在也公開標準/合併的模型：

- `/model` 在供應商標籤頁旁包含標準檢視
- `--list-models` 列印標準區段加上具體供應商列

選擇標準條目會儲存標準選擇器。選擇供應商列會儲存明確的 `provider/modelId`。

## 上下文提升（模型層級回退鏈）

上下文提升是一種針對小上下文變體（例如 `*-spark`）的溢位恢復機制，當 API 因上下文長度錯誤拒絕請求時，會自動提升至較大上下文的同系模型。

### 觸發與順序

當回合因上下文溢位錯誤（例如 `context_length_exceeded`）失敗時，`AgentSession` 會在回退至壓縮**之前**嘗試提升：

1. 如果 `contextPromotion.enabled` 為 true，解析提升目標（見下方）。
2. 如果找到目標，切換至該目標並重試請求——無需壓縮。
3. 如果沒有可用目標，則在當前模型上回退至自動壓縮。

### 目標選擇

選擇是模型驅動的，而非角色驅動的：

1. `currentModel.contextPromotionTarget`（如果已配置）
2. 同一供應商 + API 上最小的較大上下文模型

除非憑證能解析（`ModelRegistry.getApiKey(...)`），否則候選項會被忽略。

### OpenAI Codex websocket 交接

如果從/切換至 `openai-codex-responses`，工作階段供應商狀態金鑰 `openai-codex-responses` 會在模型切換前關閉。這會丟棄 websocket 傳輸狀態，使下一回合在提升後的模型上乾淨啟動。

### 持久化行為

提升使用臨時切換（`setModelTemporary`）：

- 在工作階段歷史中記錄為臨時 `model_change`
- 不會改寫已儲存的角色對應

### 配置明確的回退鏈

透過模型中繼資料中的 `contextPromotionTarget` 直接配置回退。

`contextPromotionTarget` 接受：

- `provider/model-id`（明確）
- `model-id`（在當前供應商內解析）

範例（`models.yml`）Spark -> 同供應商上的非 Spark：

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

內建模型產生器也會在同供應商的基礎模型存在時，自動為 `*-spark` 模型指定此設定。

## 相容性與路由欄位

`models.yml` 支援以下 `compat` 子集：

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField`（`max_completion_tokens` 或 `max_tokens`）
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

這些由 OpenAI-completions 傳輸邏輯消費，並與基於 URL 的自動偵測結合使用。

## 實用範例

### 本地 OpenAI 相容端點（無認證）

```yaml
providers:
  local-openai:
    baseUrl: http://127.0.0.1:8000/v1
    auth: none
    api: openai-completions
    models:
      - id: Qwen/Qwen2.5-Coder-32B-Instruct
        name: Qwen 2.5 Coder 32B (local)
```

### 使用環境變數金鑰的託管代理

```yaml
providers:
  anthropic-proxy:
    baseUrl: https://proxy.example.com/anthropic
    apiKey: ANTHROPIC_PROXY_API_KEY
    api: anthropic-messages
    authHeader: true
    models:
      - id: claude-sonnet-4-20250514
        name: Claude Sonnet 4 (Proxy)
        reasoning: true
        input: [text, image]
```

### 覆寫內建供應商路由 + 模型中繼資料

```yaml
providers:
  openrouter:
    baseUrl: https://my-proxy.example.com/v1
    headers:
      X-Team: platform
    modelOverrides:
      anthropic/claude-sonnet-4:
        name: Sonnet 4 (Corp)
        compat:
          openRouterRouting:
            only: [anthropic]
```

## LiteLLM 代理自動配置

當同時設定 `LITELLM_BASE_URL` 和 `LITELLM_API_KEY` 環境變數時，xcsh 會自動管理 LiteLLM 代理的 `models.yml` 配置。

### 首次執行自動產生

如果 `models.yml` 不存在且偵測到 LiteLLM 環境變數，xcsh 會自動產生：

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

同時也會產生預設的 `config.yml`，包含合理的圖片供應商設定。

### 啟動時自我修復

每次啟動時，模型登錄中的 `startupHealthCheck()` 會執行以下檢查：

| 條件 | 動作 |
|------|------|
| `models.yml` 缺失 | 從環境變數自動產生 |
| `models.yml` 損壞或無法解析 | 備份為 `.bak`，重新產生 |
| `baseUrl` 與 `LITELLM_BASE_URL` 不符 | 備份為 `.bak`，以新 URL 重新產生 |
| `configVersion` 缺失或過時 | 備份為 `.bak`，以當前版本重新產生 |
| 設定健康 | 無動作 |

所有修復操作在覆寫前都會建立 `.bak` 備份。所有操作都是冪等的。

### CLI 命令

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### 必要環境變數

| 變數 | 用途 |
|------|------|
| `LITELLM_BASE_URL` | LiteLLM 代理 URL（例如 `https://your-proxy.example.com`）。必須以 `http://` 或 `https://` 開頭。 |
| `LITELLM_API_KEY` | 代理的 API 金鑰。在產生的設定中以名稱引用，於執行階段解析。 |

如果任一變數未設定，自動配置會靜默跳過。

### 設定版本控制

產生的設定包含 `configVersion` 欄位。當未來版本中產生的格式變更時，xcsh 會偵測過時的設定並自動升級（含備份）。

## 舊版消費者注意事項

大多數模型配置現在透過 `ModelRegistry` 經由 `models.yml` 流動。

一個值得注意的舊版路徑仍然存在：網頁搜尋的 Anthropic 認證解析仍直接在 `src/web/search/auth.ts` 中讀取 `~/.xcsh/agent/models.json`。

如果您依賴該特定路徑，請在該模組遷移之前注意 JSON 相容性。

## 失敗模式

如果 `models.yml` 未通過結構描述或驗證檢查：

- 如果 `LITELLM_BASE_URL` 和 `LITELLM_API_KEY` 已設定，啟動健康檢查會嘗試自動修復（備份損壞的檔案，從環境變數重新產生）。如果修復成功，登錄會重新載入修復後的設定。
- 如果無法自動修復（環境變數未設定、寫入失敗），登錄會繼續使用內建模型運作。
- 錯誤會透過 `ModelRegistry.getError()` 公開，並在 UI/通知中呈現。
