---
title: 模型與提供者設定
description: 透過 models.yml 進行模型註冊與提供者設定，包含路由、備援與定價功能。
sidebar:
  order: 1
  label: 模型與提供者
i18n:
  sourceHash: "8053df967ff6"
  translator: "machine"
---

# 模型與提供者設定 (`models.yml`)

本文件說明 coding-agent 目前如何載入模型、套用覆寫、解析憑證，以及在執行階段選擇模型。

## 決定模型行為的因素

主要實作檔案：

- `src/config/model-registry.ts` — 載入內建與自訂模型、提供者覆寫、執行階段探索與身分驗證整合
- `src/config/model-resolver.ts` — 解析模型模式並選擇初始 / smol / slow 模型
- `src/config/settings-schema.ts` — 模型相關設定 (`modelRoles`、提供者傳輸偏好)
- `src/session/auth-storage.ts` — API 金鑰與 OAuth 解析順序
- `packages/ai/src/models.ts` 及 `packages/ai/src/types.ts` — 內建提供者/模型與 `Model`/`compat` 類型

## 設定檔位置與傳統行為

預設設定檔路徑：

- `~/.xcsh/agent/models.yml`

目前仍保留的傳統行為：

- 如果缺少 `models.yml` 但同一位置存在 `models.json`，則會將其移轉至 `models.yml`。
- 透過程式傳遞給 `ModelRegistry` 時，仍然支援明確的 `.json` / `.jsonc` 設定檔路徑。

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

`configVersion` 為選填整數，由自動設定系統寫入。當存在此欄位時，xcsh 會使用它來偵測過時的設定檔並自動升級。

`provider-id` 是標準的提供者金鑰，用於跨選擇和身分驗證查詢。

`equivalence` 為選填項目，可在具體的提供者模型之上設定標準模型群組：

- `overrides` 將確切的具體選擇器 (`provider/modelId`) 對應到官方上游的標準 ID
- `exclude` 將具體選擇器排除在標準群組之外

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

- `auth`: `apiKey` (預設) 或 `none`
- `discovery.type`: `ollama`

## 驗證規則 (現行)

### 完整自訂提供者 (`models` 不為空)

必要欄位：

- `baseUrl`
- `apiKey` 除非 `auth: none`
- `api` 位於提供者層級或每個模型中

### 僅覆寫的提供者 (`models` 遺失或為空)

必須至少定義以下其中之一：

- `baseUrl`
- `modelOverrides`
- `discovery`

### 探索 (Discovery)

- `discovery` 需要提供者層級的 `api`。

### 模型值檢查

- `id` 為必填
- 如果提供，`contextWindow` 和 `maxTokens` 必須為正數

## 合併與覆寫順序

ModelRegistry 流程 (在重新整理時)：

1. 從 `@f5-sales-demo/pi-ai` 載入內建提供者/模型。
2. 載入 `models.yml` 自訂設定。
3. 將提供者覆寫 (`baseUrl`, `headers`) 套用到內建模型。
4. 套用 `modelOverrides` (針對每個提供者 + 模型 ID)。
5. 合併自訂的 `models`：
   - 相同的 `provider + id` 會取代現有設定
   - 否則進行附加 (append)
6. 套用在執行階段探索到的模型 (目前為 Ollama 及 LM Studio)，接著重新套用模型覆寫。

## 標準模型等效性與合併

註冊表保留每一個具體的提供者模型，並在它們之上建立標準層。

標準 ID 僅限於官方上游 ID，例如：

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### `models.yml` 等效性設定

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

建立標準群組的順序：

1. 來自 `equivalence.overrides` 的確切使用者覆寫
2. 從內建模型中繼資料中綑綁的官方 ID 匹配
3. 針對閘道器/提供者變體的保守啟發式標準化
4. 備援至具體模型本身的 ID

目前的啟發式規則刻意設定得較窄：

- 存在時可剝除嵌入的上游前綴，例如 `anthropic/...` 或 `openai/...`
- 使用小數點和破折號的版本變體僅在它們對應到現有的官方 ID 時才進行標準化，例如 `4.6 -> 4-6`
- 模糊的家族或版本在沒有綑綁匹配或明確覆寫的情況下不會合併

### 標準解析行為

當多個具體變體共用一個標準 ID 時，解析會使用：

1. 可用性與身分驗證
2. `config.yml` `modelProviderOrder`
3. 如果未設定 `modelProviderOrder`，則使用現有的註冊表/提供者順序

會跳過已停用或未驗證的提供者。

工作階段狀態和逐字稿會繼續記錄實際執行回合的具體提供者/模型。

提供者預設值 vs 個別模型覆寫：

- 提供者的 `headers` 為基準。
- 模型 `headers` 覆寫提供者的標頭金鑰。
- `modelOverrides` 可覆寫模型中繼資料 (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`)。
- `compat` 會對巢狀路由區塊進行深層合併 (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`)。

## 執行階段探索整合

### 隱含的 Ollama 探索

如果沒有明確設定 `ollama`，註冊表會加入一個隱含的可探索提供者：

- provider: `ollama`
- api: `openai-completions`
- base URL: `OLLAMA_BASE_URL` 或 `http://127.0.0.1:11434`
- auth mode: 無金鑰 (`auth: none` 行為)

執行階段探索在 Ollama 呼叫 `GET /api/tags`，並與本機預設值合成模型項目。

### 隱含的 llama.cpp 探索

如果沒有明確設定 `llama.cpp`，註冊表會加入一個隱含的可探索提供者：
備註：這使用了較新的 antropic messages API，而非 openai-competions。

- provider: `llama.cpp`
- api: `openai-responses`
- base URL: `LLAMA_CPP_BASE_URL` 或 `http://127.0.0.1:8080`
- auth mode: 無金鑰 (`auth: none` 行為)

執行階段探索在 llama.cpp 呼叫 `GET models`，並與本機預設值合成模型項目。

### 隱含的 LM Studio 探索

如果沒有明確設定 `lm-studio`，註冊表會加入一個隱含的可探索提供者：

- provider: `lm-studio`
- api: `openai-completions`
- base URL: `LM_STUDIO_BASE_URL` 或 `http://127.0.0.1:1234/v1`
- auth mode: 無金鑰 (`auth: none` 行為)

執行階段探索取得模型 (`GET /models`)，並與本機預設值合成模型項目。

### 明確的提供者探索

你可以自行設定探索：

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

### 擴充套件提供者註冊

擴充套件可以在執行階段註冊提供者 (`pi.registerProvider(...)`)，包括：

- 提供者的模型取代/附加
- 針對新 API ID 的自訂串流處理常式註冊
- 自訂 OAuth 提供者註冊

## 身分驗證與 API 金鑰解析順序

在請求提供者的金鑰時，實際的順序為：

1. 執行階段覆寫 (CLI `--api-key`)
2. `agent.db` 中儲存的 API 金鑰憑證
3. `agent.db` 中儲存的 OAuth 憑證 (包含重新整理)
4. 環境變數對應 (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` 等)
5. ModelRegistry 備援解析器 (來自 `models.yml` 的提供者 `apiKey`，使用環境變數名稱或常值語意)

`models.yml` `apiKey` 行為：

- 該值首先被視為環境變數名稱。
- 如果不存在該環境變數，則常值字串會作為權杖使用。

如果 `authHeader: true` 且提供者的 `apiKey` 已設定，模型會取得：

- 注入 `Authorization: Bearer <resolved-key>` 標頭。

無金鑰提供者：

- 標記為 `auth: none` 的提供者將被視為無需憑證即可使用。
- `getApiKey*` 會對其傳回 `kNoAuth`。

## 模型可用性與所有模型

- `getAll()` 傳回已載入的模型註冊表 (內建 + 合併自訂 + 探索到的)。
- `getAvailable()` 過濾出無金鑰或具有可解析身分驗證的模型。

因此模型可以存在於註冊表中，但在取得驗證之前是不可選擇的。

## 執行階段模型解析

### CLI 與模式解析

`model-resolver.ts` 支援：

- 確切的 `provider/modelId`
- 確切的標準模型 ID
- 確切的模型 ID (推斷出提供者)
- 模糊/子字串匹配
- `--models` 中的 glob 範圍模式 (例如 `openai/*`, `*sonnet*`)
- 選擇性的 `:thinkingLevel` 後綴 (`off|minimal|low|medium|high|xhigh`)

`--provider` 是舊用法；建議使用 `--model`。

確切選擇器的解析優先順序：

1. 確切的 `provider/modelId` 繞過合併
2. 確切的標準 ID 透過標準索引解析
3. 確切的純具體 ID 仍然有效
4. 在確切路徑之後執行模糊與 glob 匹配

### 初始模型選擇優先順序

`findInitialModel(...)` 使用以下順序：

1. 明確的 CLI 提供者+模型
2. 第一個範圍內模型 (如果不處於還原狀態)
3. 儲存的預設提供者/模型
4. 已知提供者預設值 (例如可用模型中的 OpenAI/Anthropic 等)
5. 第一個可用的模型

### 角色別名與設定

支援的模型角色：

- `default`, `smol`, `slow`, `plan`, `commit`

類似 `pi/smol` 的角色別名可透過 `settings.modelRoles` 展開。每個角色值也可以附加一個思考選擇器，例如 `:minimal`、`:low`、`:medium` 或 `:high`。

如果一個角色指向另一個角色，目標模型仍然會正常繼承，並且參考角色上的任何明確後綴會勝出，套用於該特定角色的使用情境。

相關設定：

- `modelRoles` (record)
- `enabledModels` (scoped pattern list)
- `modelProviderOrder` (global canonical-provider precedence)
- `providers.kimiApiFormat` (`openai` 或 `anthropic` 請求格式)
- `providers.openaiWebsockets` (OpenAI Codex 傳輸的 `auto|off|on` websocket 偏好)

`modelRoles` 可儲存為：

- `provider/modelId` 來固定具體提供者變體
- 一個標準 ID (例如 `gpt-5.3-codex`) 以允許提供者合併

對於 `enabledModels` 與 CLI `--models`：

- 確切的標準 ID 會展開為該標準群組內所有的具體變體
- 明確的 `provider/modelId` 項目保持不變
- globs 和模糊匹配仍然在具體模型上運作

## `/model` 與 `--list-models`

這兩個介面都讓帶有提供者前綴的模型保持可見且可選。

它們現在還會公開標準/合併模型：

- `/model` 在提供者索引標籤旁包含了一個標準檢視
- `--list-models` 列印了一個標準區塊以及具體的提供者列

選擇一個標準項目會儲存標準選擇器。選擇一個提供者列會儲存明確的 `provider/modelId`。

## 內容升級 (Context promotion) (模型級別備援鏈)

內容升級是一種針對小情境變體 (例如 `*-spark`) 的溢位復原機制，當 API 拒絕因情境長度錯誤而發出的請求時，會自動升級到同系列中情境更大的模型。

### 觸發條件與順序

當某個回合因情境溢位錯誤失敗時 (例如 `context_length_exceeded`)，`AgentSession` 會在退回使用資料壓縮**之前**嘗試升級：

1. 如果 `contextPromotion.enabled` 為真，則解析一個升級目標 (詳見下方)。
2. 如果找到目標，切換到該目標並重新嘗試請求 — 不需要壓縮。
3. 如果沒有可用目標，則落入當前模型的自動壓縮處理。

### 目標選擇

選擇是由模型驅動，而不是角色驅動：

1. `currentModel.contextPromotionTarget` (如果有設定)
2. 同一個提供者 + API 上情境較大但最小的模型

除非憑證解析成功 (`ModelRegistry.getApiKey(...)`)，否則會忽略候選項目。

### OpenAI Codex websocket 切換

如果從/切換到 `openai-codex-responses`，在模型切換前會關閉工作階段提供者狀態金鑰 `openai-codex-responses`。這會捨棄 websocket 傳輸狀態，讓升級後模型的下一回合能重新開始。

### 儲存行為

升級使用臨時切換 (`setModelTemporary`)：

- 在工作階段歷史記錄中記為臨時的 `model_change`
- 不會覆寫儲存的角色對應

### 設定明確的備援鏈

透過模型中繼資料中的 `contextPromotionTarget` 直接設定備援。

`contextPromotionTarget` 接受以下兩者之一：

- `provider/model-id` (明確的)
- `model-id` (在目前提供者內解析)

相同提供者上 Spark -> 非 Spark 的範例 (`models.yml`)：

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

當同提供者基礎模型存在時，內建模型產生器也會自動為 `*-spark` 模型分配此設定。

## 相容性與路由欄位

`models.yml` 支援以下 `compat` 子集：

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` 或 `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

這些會由 OpenAI-completions 傳輸邏輯消耗，並與基於 URL 的自動偵測相結合。

## 實用範例

### 本機相容 OpenAI 的端點 (無驗證)

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

### 具有環境變數金鑰的代管代理

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

### 覆寫內建提供者路由與模型中繼資料

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

## LiteLLM 代理自動設定

當設定了 `LITELLM_BASE_URL` 和 `LITELLM_API_KEY` 環境變數時，xcsh 會自動管理 LiteLLM 代理的 `models.yml` 設定。

### 首次執行自動產生

如果 `models.yml` 不存在且偵測到 LiteLLM 環境變數，xcsh 會自動產生它：

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

也會使用合理的影像提供者設定來產生預設的 `config.yml`。

### 啟動自我修復

每次啟動時，模型註冊表中的 `startupHealthCheck()` 會執行以下檢查：

| 條件 | 動作 |
|-----------|--------|
| `models.yml` 遺失 | 從環境變數自動產生 |
| `models.yml` 損毀或無法解析 | 備份到 `.bak` 並重新產生 |
| `baseUrl` 與 `LITELLM_BASE_URL` 不匹配 | 備份到 `.bak`，並使用新 URL 重新產生 |
| `configVersion` 遺失或過時 | 備份到 `.bak`，並使用目前版本重新產生 |
| 設定檔狀態健康 | 不執行動作 |

所有修復作業會在覆寫前建立 `.bak` 備份。所有操作都是冪等的。

### CLI 指令

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### 必要的環境變數

| 變數 | 目的 |
|----------|---------|
| `LITELLM_BASE_URL` | LiteLLM 代理 URL (例如 `https://your-proxy.example.com`)。必須以 `http://` 或 `https://` 開頭。 |
| `LITELLM_API_KEY` | 代理的 API 金鑰。在產生的設定檔中透過名稱參考，於執行階段解析。 |

如果上述任一變數未設定，自動設定會靜默跳過。

### 設定檔版本控制

產生的設定檔包含一個 `configVersion` 欄位。當未來版本中產生格式有變更時，xcsh 會偵測過時的設定檔並自動將其升級 (附帶備份)。

## 傳統使用者注意事項

大部分模型設定現在透過 `ModelRegistry` 進入 `models.yml`。

還有一個顯著的傳統路徑仍然保留：網路搜尋的 Anthropic 身分驗證解析仍會在 `src/web/search/auth.ts` 中直接讀取 `~/.xcsh/agent/models.json`。

如果你依賴那個特定的路徑，請記住 JSON 相容性，直到該模組被移轉為止。

## 失敗模式

如果 `models.yml` 未通過結構或驗證檢查：

- 如果設定了 `LITELLM_BASE_URL` 和 `LITELLM_API_KEY`，啟動健康檢查會嘗試自動修復 (備份損毀檔案，並從環境變數重新產生)。如果修復成功，註冊表會重新載入修復後的設定。
- 如果無法自動修復 (環境變數未設定、寫入失敗)，註冊表會繼續使用內建模型運作。
- 錯誤可透過 `ModelRegistry.getError()` 取得，並顯示在 UI/通知中。
