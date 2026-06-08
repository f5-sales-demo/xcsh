---
title: 模型與提供者配置
description: 透過 models.yml 進行模型註冊表與提供者配置，包含路由、備援及定價功能。
sidebar:
  order: 1
  label: 模型與提供者
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# 模型與提供者配置（`models.yml`）

本文件描述 coding-agent 目前如何載入模型、套用覆寫設定、解析憑證，以及在執行階段選擇模型。

## 控制模型行為的要素

主要實作檔案：

- `src/config/model-registry.ts` — 載入內建 + 自訂模型、提供者覆寫、執行階段探索、認證整合
- `src/config/model-resolver.ts` — 解析模型模式並選擇 initial/smol/slow 模型
- `src/config/settings-schema.ts` — 模型相關設定（`modelRoles`、提供者傳輸偏好）
- `src/session/auth-storage.ts` — API 金鑰 + OAuth 解析順序
- `packages/ai/src/models.ts` 和 `packages/ai/src/types.ts` — 內建提供者/模型及 `Model`/`compat` 類型

## 配置檔位置與舊版行為

預設配置路徑：

- `~/.xcsh/agent/models.yml`

仍保留的舊版行為：

- 若 `models.yml` 不存在但同一位置有 `models.json`，會自動遷移至 `models.yml`。
- 當以程式方式傳遞給 `ModelRegistry` 時，仍支援明確的 `.json` / `.jsonc` 配置路徑。

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

`configVersion` 是由自動配置系統寫入的選填整數。當存在時，xcsh 會用它來偵測過時的配置並自動升級。

`provider-id` 是在選擇和認證查詢中使用的標準提供者金鑰。

`equivalence` 為選填，用於在具體提供者模型之上配置標準模型分組：

- `overrides` 將精確的具體選擇器（`provider/modelId`）對應到官方上游標準 ID
- `exclude` 將具體選擇器從標準分組中排除

## 提供者層級欄位

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

### 允許的提供者/模型 `api` 值

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

### 完整自訂提供者（`models` 非空）

必要欄位：

- `baseUrl`
- `apiKey`（除非設定 `auth: none`）
- `api` 於提供者層級或每個模型

### 僅覆寫提供者（`models` 缺失或為空）

必須定義以下至少一項：

- `baseUrl`
- `modelOverrides`
- `discovery`

### 探索

- `discovery` 需要提供者層級的 `api`。

### 模型值檢查

- `id` 為必填
- `contextWindow` 和 `maxTokens` 若提供則必須為正數

## 合併與覆寫順序

ModelRegistry 處理流程（重新整理時）：

1. 從 `@f5xc-salesdemos/pi-ai` 載入內建提供者/模型。
2. 載入 `models.yml` 自訂配置。
3. 將提供者覆寫（`baseUrl`、`headers`）套用至內建模型。
4. 套用 `modelOverrides`（依提供者 + 模型 ID）。
5. 合併自訂 `models`：
   - 相同的 `provider + id` 會取代現有項目
   - 否則附加
6. 套用執行階段探索到的模型（目前為 Ollama 和 LM Studio），然後重新套用模型覆寫。

## 標準模型等價與合併

註冊表保留每個具體的提供者模型，然後在其上建立標準層。

標準 ID 僅使用官方上游 ID，例如：

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### `models.yml` 等價配置

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

標準分組的建立順序：

1. 來自 `equivalence.overrides` 的精確使用者覆寫
2. 來自內建模型中繼資料的官方 ID 匹配
3. 針對閘道/提供者變體的保守式啟發式正規化
4. 回退至具體模型本身的 ID

目前的啟發式規則刻意設計為窄範圍：

- 當存在時可移除嵌入的上游前綴，例如 `anthropic/...` 或 `openai/...`
- 點分和橫線版本變體僅在對應到現有官方 ID 時才會正規化，例如 `4.6 -> 4-6`
- 模糊的系列或版本不會在沒有內建匹配或明確覆寫的情況下合併

### 標準解析行為

當多個具體變體共享一個標準 ID 時，解析使用：

1. 可用性和認證
2. `config.yml` 中的 `modelProviderOrder`
3. 若 `modelProviderOrder` 未設定，則使用現有的註冊表/提供者順序

已停用或未認證的提供者會被跳過。

會話狀態和記錄會繼續記錄實際執行該回合的具體提供者/模型。

提供者預設值 vs 個別模型覆寫：

- 提供者 `headers` 為基準。
- 模型 `headers` 會覆寫提供者的標頭金鑰。
- `modelOverrides` 可以覆寫模型中繼資料（`name`、`reasoning`、`input`、`cost`、`contextWindow`、`maxTokens`、`headers`、`compat`、`contextPromotionTarget`）。
- `compat` 會對巢狀路由區塊進行深度合併（`openRouterRouting`、`vercelGatewayRouting`、`extraBody`）。

## 執行階段探索整合

### 隱式 Ollama 探索

若未明確配置 `ollama`，註冊表會新增一個隱式可探索提供者：

- 提供者：`ollama`
- API：`openai-completions`
- 基礎 URL：`OLLAMA_BASE_URL` 或 `http://127.0.0.1:11434`
- 認證模式：免金鑰（`auth: none` 行為）

執行階段探索會對 Ollama 呼叫 `GET /api/tags`，並以本地預設值合成模型項目。

### 隱式 llama.cpp 探索

若未明確配置 `llama.cpp`，註冊表會新增一個隱式可探索提供者：
注意：它使用的是較新的 anthropic messages API，而非 openai-completions。

- 提供者：`llama.cpp`
- API：`openai-responses`
- 基礎 URL：`LLAMA_CPP_BASE_URL` 或 `http://127.0.0.1:8080`
- 認證模式：免金鑰（`auth: none` 行為）

執行階段探索會對 llama.cpp 呼叫 `GET models`，並以本地預設值合成模型項目。

### 隱式 LM Studio 探索

若未明確配置 `lm-studio`，註冊表會新增一個隱式可探索提供者：

- 提供者：`lm-studio`
- API：`openai-completions`
- 基礎 URL：`LM_STUDIO_BASE_URL` 或 `http://127.0.0.1:1234/v1`
- 認證模式：免金鑰（`auth: none` 行為）

執行階段探索會擷取模型（`GET /models`），並以本地預設值合成模型項目。

### 明確提供者探索

您可以自行配置探索：

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

### 擴充提供者註冊

擴充功能可以在執行階段註冊提供者（`pi.registerProvider(...)`），包括：

- 替換/附加提供者的模型
- 為新的 API ID 註冊自訂串流處理器
- 註冊自訂 OAuth 提供者

## 認證與 API 金鑰解析順序

請求提供者金鑰時，生效順序為：

1. 執行階段覆寫（CLI `--api-key`）
2. 儲存在 `agent.db` 中的 API 金鑰憑證
3. 儲存在 `agent.db` 中的 OAuth 憑證（含重新整理）
4. 環境變數對應（`OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 等）
5. ModelRegistry 備援解析器（來自 `models.yml` 的提供者 `apiKey`，環境變數名稱或字面值語意）

`models.yml` 中 `apiKey` 的行為：

- 該值首先被當作環境變數名稱處理。
- 若無對應的環境變數存在，則使用字面字串作為令牌。

若 `authHeader: true` 且提供者 `apiKey` 已設定，模型會取得：

- 注入 `Authorization: Bearer <resolved-key>` 標頭。

免金鑰提供者：

- 標記為 `auth: none` 的提供者視為無需憑證即可用。
- `getApiKey*` 會為它們回傳 `kNoAuth`。

## 模型可用性 vs 所有模型

- `getAll()` 回傳已載入的模型註冊表（內建 + 合併的自訂 + 探索到的）。
- `getAvailable()` 篩選出免金鑰或有可解析認證的模型。

因此模型可以存在於註冊表中，但在認證可用之前無法被選擇。

## 執行階段模型解析

### CLI 與模式解析

`model-resolver.ts` 支援：

- 精確的 `provider/modelId`
- 精確的標準模型 ID
- 精確的模型 ID（推斷提供者）
- 模糊/子字串匹配
- `--models` 中的 glob 範圍模式（例如 `openai/*`、`*sonnet*`）
- 選填的 `:thinkingLevel` 後綴（`off|minimal|low|medium|high|xhigh`）

`--provider` 為舊版參數；建議使用 `--model`。

精確選擇器的解析優先順序：

1. 精確的 `provider/modelId` 繞過合併
2. 精確的標準 ID 透過標準索引解析
3. 精確的裸具體 ID 仍然有效
4. 模糊和 glob 匹配在精確路徑之後執行

### 初始模型選擇優先順序

`findInitialModel(...)` 使用此順序：

1. 明確的 CLI 提供者+模型
2. 第一個範圍內模型（若非恢復會話）
3. 已儲存的預設提供者/模型
4. 可用模型中的已知提供者預設值（例如 OpenAI/Anthropic 等）
5. 第一個可用模型

### 角色別名與設定

支援的模型角色：

- `default`、`smol`、`slow`、`plan`、`commit`

角色別名如 `pi/smol` 會透過 `settings.modelRoles` 展開。每個角色值也可以附加思考選擇器，例如 `:minimal`、`:low`、`:medium` 或 `:high`。

若某個角色指向另一個角色，目標模型仍正常繼承，而引用角色上的任何明確後綴會在該角色特定用途中優先使用。

相關設定：

- `modelRoles`（記錄）
- `enabledModels`（範圍模式列表）
- `modelProviderOrder`（全域標準提供者優先順序）
- `providers.kimiApiFormat`（`openai` 或 `anthropic` 請求格式）
- `providers.openaiWebsockets`（`auto|off|on` OpenAI Codex 傳輸的 WebSocket 偏好）

`modelRoles` 可以儲存以下任一種：

- `provider/modelId` 以固定具體的提供者變體
- 標準 ID 如 `gpt-5.3-codex` 以允許提供者合併

對於 `enabledModels` 和 CLI `--models`：

- 精確的標準 ID 會展開為該標準群組中的所有具體變體
- 明確的 `provider/modelId` 項目保持精確
- glob 和模糊匹配仍然作用於具體模型

## `/model` 和 `--list-models`

兩個介面都保持提供者前綴模型的可見性和可選擇性。

它們現在也暴露標準/合併的模型：

- `/model` 在提供者標籤旁包含標準檢視
- `--list-models` 印出標準區段加上具體提供者列

選擇標準項目會儲存標準選擇器。選擇提供者列會儲存明確的 `provider/modelId`。

## 上下文提升（模型層級備援鏈）

上下文提升是針對小上下文變體（例如 `*-spark`）的溢位恢復機制，當 API 因上下文長度錯誤拒絕請求時，會自動提升至較大上下文的同級模型。

### 觸發與順序

當某回合因上下文溢位錯誤（例如 `context_length_exceeded`）失敗時，`AgentSession` 會在回退至壓縮**之前**嘗試提升：

1. 若 `contextPromotion.enabled` 為 true，解析提升目標（見下文）。
2. 若找到目標，切換至該模型並重試請求——無需壓縮。
3. 若無可用目標，則在當前模型上回退至自動壓縮。

### 目標選擇

選擇是模型驅動的，而非角色驅動的：

1. `currentModel.contextPromotionTarget`（若已配置）
2. 同一提供者 + API 上最小的較大上下文模型

除非憑證可解析（`ModelRegistry.getApiKey(...)`），否則候選項會被忽略。

### OpenAI Codex WebSocket 交接

若從/切換至 `openai-codex-responses`，會話提供者狀態金鑰 `openai-codex-responses` 會在模型切換前關閉。這會丟棄 WebSocket 傳輸狀態，使下一回合在提升的模型上全新啟動。

### 持久化行為

提升使用臨時切換（`setModelTemporary`）：

- 在會話歷史中記錄為臨時的 `model_change`
- 不會重寫已儲存的角色對應

### 配置明確的備援鏈

透過模型中繼資料中的 `contextPromotionTarget` 直接配置備援。

`contextPromotionTarget` 接受以下任一種：

- `provider/model-id`（明確指定）
- `model-id`（在當前提供者內解析）

範例（`models.yml`）用於同一提供者上的 Spark -> 非 Spark：

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

內建模型產生器也會在同一提供者存在基礎模型時，自動為 `*-spark` 模型指定此項。

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

### 覆寫內建提供者路由 + 模型中繼資料

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

當 `LITELLM_BASE_URL` 和 `LITELLM_API_KEY` 環境變數皆已設定時，xcsh 會自動管理 LiteLLM 代理的 `models.yml` 配置。

### 首次執行自動產生

若 `models.yml` 不存在且偵測到 LiteLLM 環境變數，xcsh 會自動產生：

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

同時也會產生一個具有合理圖片提供者設定的預設 `config.yml`。

### 啟動時自我修復

每次啟動時，模型註冊表中的 `startupHealthCheck()` 會執行以下檢查：

| 條件 | 動作 |
|-----------|--------|
| `models.yml` 缺失 | 從環境變數自動產生 |
| `models.yml` 損壞或無法解析 | 備份為 `.bak`，重新產生 |
| `baseUrl` 與 `LITELLM_BASE_URL` 不符 | 備份為 `.bak`，以新 URL 重新產生 |
| `configVersion` 缺失或過時 | 備份為 `.bak`，以目前版本重新產生 |
| 配置正常 | 不執行任何動作 |

所有修復在覆寫前都會建立 `.bak` 備份。所有操作都是冪等的。

### CLI 命令

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### 必要環境變數

| 變數 | 用途 |
|----------|---------|
| `LITELLM_BASE_URL` | LiteLLM 代理 URL（例如 `https://your-proxy.example.com`）。必須以 `http://` 或 `https://` 開頭。 |
| `LITELLM_API_KEY` | 代理的 API 金鑰。在產生的配置中以名稱引用，於執行階段解析。 |

若任一變數未設定，自動配置會靜默跳過。

### 配置版本控制

產生的配置包含 `configVersion` 欄位。當產生的格式在未來版本中變更時，xcsh 會偵測過時的配置並自動升級（含備份）。

## 舊版消費者注意事項

大多數模型配置現在透過 `ModelRegistry` 經由 `models.yml` 流轉。

仍存在一個值得注意的舊版路徑：網頁搜尋的 Anthropic 認證解析仍直接在 `src/web/search/auth.ts` 中讀取 `~/.xcsh/agent/models.json`。

若您依賴該特定路徑，在該模組遷移之前，請注意保持 JSON 的相容性。

## 故障模式

若 `models.yml` 未通過結構描述或驗證檢查：

- 若 `LITELLM_BASE_URL` 和 `LITELLM_API_KEY` 已設定，啟動健康檢查會嘗試自動修復（備份損壞的檔案，從環境變數重新產生）。若修復成功，註冊表會重新載入修復後的配置。
- 若無法自動修復（環境變數未設定、寫入失敗），註冊表會繼續使用內建模型運作。
- 錯誤會透過 `ModelRegistry.getError()` 暴露，並顯示在 UI/通知中。
