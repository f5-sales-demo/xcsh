---
title: 模型和提供者配置
description: 通过 models.yml 进行模型注册和提供者配置，包括路由、回退和定价。
sidebar:
  order: 1
  label: 模型与提供者
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# 模型和提供者配置（`models.yml`）

本文档描述了 coding-agent 当前如何加载模型、应用覆盖配置、解析凭据以及在运行时选择模型。

## 控制模型行为的要素

主要实现文件：

- `src/config/model-registry.ts` — 加载内置 + 自定义模型、提供者覆盖、运行时发现、认证集成
- `src/config/model-resolver.ts` — 解析模型模式并选择 initial/smol/slow 模型
- `src/config/settings-schema.ts` — 模型相关设置（`modelRoles`、提供者传输偏好）
- `src/session/auth-storage.ts` — API 密钥 + OAuth 解析顺序
- `packages/ai/src/models.ts` 和 `packages/ai/src/types.ts` — 内置提供者/模型以及 `Model`/`compat` 类型

## 配置文件位置和遗留行为

默认配置路径：

- `~/.xcsh/agent/models.yml`

仍然存在的遗留行为：

- 如果 `models.yml` 不存在而同一位置存在 `models.json`，则会迁移为 `models.yml`。
- 以编程方式传递给 `ModelRegistry` 时，仍然支持显式的 `.json` / `.jsonc` 配置路径。

## `models.yml` 结构

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

`configVersion` 是一个可选的整数，由自动配置系统写入。当存在时，xcsh 使用它来检测过时的配置并自动升级。

`provider-id` 是在选择和认证查找中使用的规范提供者键。

`equivalence` 是可选的，用于在具体提供者模型之上配置规范模型分组：

- `overrides` 将精确的具体选择器（`provider/modelId`）映射到官方上游规范 ID
- `exclude` 将具体选择器排除在规范分组之外

## 提供者级别字段

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

### 允许的提供者/模型 `api` 值

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### 允许的 auth/discovery 值

- `auth`：`apiKey`（默认）或 `none`
- `discovery.type`：`ollama`

## 验证规则（当前）

### 完整自定义提供者（`models` 非空）

必需：

- `baseUrl`
- `apiKey`，除非设置了 `auth: none`
- 提供者级别或每个模型的 `api`

### 仅覆盖的提供者（`models` 缺失或为空）

必须定义以下至少一项：

- `baseUrl`
- `modelOverrides`
- `discovery`

### 发现

- `discovery` 需要提供者级别的 `api`。

### 模型值检查

- `id` 必需
- `contextWindow` 和 `maxTokens` 如果提供则必须为正数

## 合并和覆盖顺序

ModelRegistry 管道（刷新时）：

1. 从 `@f5xc-salesdemos/pi-ai` 加载内置提供者/模型。
2. 加载 `models.yml` 自定义配置。
3. 将提供者覆盖（`baseUrl`、`headers`）应用到内置模型。
4. 应用 `modelOverrides`（按提供者 + 模型 ID）。
5. 合并自定义 `models`：
   - 相同 `provider + id` 替换现有模型
   - 否则追加
6. 应用运行时发现的模型（目前为 Ollama 和 LM Studio），然后重新应用模型覆盖。

## 规范模型等价性和合并

注册表保留每个具体的提供者模型，然后在其之上构建一个规范层。

规范 ID 仅为官方上游 ID，例如：

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### `models.yml` 等价性配置

示例：

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

规范分组的构建顺序：

1. 来自 `equivalence.overrides` 的精确用户覆盖
2. 来自内置模型元数据的捆绑官方 ID 匹配
3. 针对网关/提供者变体的保守启发式规范化
4. 回退到具体模型自身的 ID

当前启发式规则有意保持窄范围：

- 当存在嵌入的上游前缀时可以被剥离，例如 `anthropic/...` 或 `openai/...`
- 点分和横线版本变体仅在映射到现有官方 ID 时才进行规范化，例如 `4.6 -> 4-6`
- 模糊的系列或版本不会在没有捆绑匹配或显式覆盖的情况下被合并

### 规范解析行为

当多个具体变体共享同一规范 ID 时，解析使用：

1. 可用性和认证
2. `config.yml` 中的 `modelProviderOrder`
3. 如果未设置 `modelProviderOrder`，则使用现有注册表/提供者顺序

已禁用或未认证的提供者将被跳过。

会话状态和记录继续记录实际执行该轮次的具体提供者/模型。

提供者默认值 vs 每模型覆盖：

- 提供者 `headers` 是基线。
- 模型 `headers` 覆盖提供者的头部键。
- `modelOverrides` 可以覆盖模型元数据（`name`、`reasoning`、`input`、`cost`、`contextWindow`、`maxTokens`、`headers`、`compat`、`contextPromotionTarget`）。
- `compat` 对嵌套路由块（`openRouterRouting`、`vercelGatewayRouting`、`extraBody`）进行深度合并。

## 运行时发现集成

### 隐式 Ollama 发现

如果 `ollama` 未被显式配置，注册表会添加一个隐式可发现提供者：

- 提供者：`ollama`
- api：`openai-completions`
- 基础 URL：`OLLAMA_BASE_URL` 或 `http://127.0.0.1:11434`
- 认证模式：无密钥（`auth: none` 行为）

运行时发现调用 Ollama 的 `GET /api/tags` 并使用本地默认值合成模型条目。

### 隐式 llama.cpp 发现

如果 `llama.cpp` 未被显式配置，注册表会添加一个隐式可发现提供者：
注意：它使用较新的 anthropic messages API 而不是 openai-completions。

- 提供者：`llama.cpp`
- api：`openai-responses`
- 基础 URL：`LLAMA_CPP_BASE_URL` 或 `http://127.0.0.1:8080`
- 认证模式：无密钥（`auth: none` 行为）

运行时发现调用 llama.cpp 的 `GET models` 并使用本地默认值合成模型条目。

### 隐式 LM Studio 发现

如果 `lm-studio` 未被显式配置，注册表会添加一个隐式可发现提供者：

- 提供者：`lm-studio`
- api：`openai-completions`
- 基础 URL：`LM_STUDIO_BASE_URL` 或 `http://127.0.0.1:1234/v1`
- 认证模式：无密钥（`auth: none` 行为）

运行时发现获取模型（`GET /models`）并使用本地默认值合成模型条目。

### 显式提供者发现

您可以自行配置发现：

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

### 扩展提供者注册

扩展可以在运行时注册提供者（`pi.registerProvider(...)`），包括：

- 提供者的模型替换/追加
- 为新 API ID 注册自定义流处理器
- 自定义 OAuth 提供者注册

## 认证和 API 密钥解析顺序

请求提供者密钥时，生效顺序为：

1. 运行时覆盖（CLI `--api-key`）
2. 存储在 `agent.db` 中的 API 密钥凭据
3. 存储在 `agent.db` 中的 OAuth 凭据（含刷新）
4. 环境变量映射（`OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 等）
5. ModelRegistry 回退解析器（来自 `models.yml` 的提供者 `apiKey`，环境变量名称或字面值语义）

`models.yml` 中 `apiKey` 的行为：

- 值首先被视为环境变量名称。
- 如果不存在对应的环境变量，则字面字符串被用作令牌。

如果 `authHeader: true` 且提供者 `apiKey` 已设置，模型将获得：

- 注入的 `Authorization: Bearer <resolved-key>` 头部。

无密钥提供者：

- 标记为 `auth: none` 的提供者被视为无需凭据即可使用。
- `getApiKey*` 为其返回 `kNoAuth`。

## 模型可用性 vs 所有模型

- `getAll()` 返回已加载的模型注册表（内置 + 合并的自定义 + 发现的）。
- `getAvailable()` 过滤为无密钥或具有可解析认证的模型。

因此，模型可以存在于注册表中，但在认证可用之前不可选择。

## 运行时模型解析

### CLI 和模式解析

`model-resolver.ts` 支持：

- 精确的 `provider/modelId`
- 精确的规范模型 ID
- 精确的模型 ID（推断提供者）
- 模糊/子字符串匹配
- `--models` 中的 glob 范围模式（例如 `openai/*`、`*sonnet*`）
- 可选的 `:thinkingLevel` 后缀（`off|minimal|low|medium|high|xhigh`）

`--provider` 是遗留用法；推荐使用 `--model`。

精确选择器的解析优先级：

1. 精确的 `provider/modelId` 绕过合并
2. 精确的规范 ID 通过规范索引解析
3. 精确的裸具体 ID 仍然有效
4. 模糊和 glob 匹配在精确路径之后运行

### 初始模型选择优先级

`findInitialModel(...)` 使用以下顺序：

1. 显式的 CLI 提供者 + 模型
2. 第一个作用域模型（如果不是恢复会话）
3. 已保存的默认提供者/模型
4. 可用模型中的已知提供者默认值（例如 OpenAI/Anthropic 等）
5. 第一个可用模型

### 角色别名和设置

支持的模型角色：

- `default`、`smol`、`slow`、`plan`、`commit`

角色别名如 `pi/smol` 通过 `settings.modelRoles` 展开。每个角色值还可以附加思维选择器，如 `:minimal`、`:low`、`:medium` 或 `:high`。

如果一个角色指向另一个角色，目标模型仍然正常继承，而引用角色上的任何显式后缀在该角色特定用途中优先。

相关设置：

- `modelRoles`（记录）
- `enabledModels`（作用域模式列表）
- `modelProviderOrder`（全局规范-提供者优先级）
- `providers.kimiApiFormat`（`openai` 或 `anthropic` 请求格式）
- `providers.openaiWebsockets`（`auto|off|on` OpenAI Codex 传输的 websocket 偏好）

`modelRoles` 可以存储：

- `provider/modelId` 以固定具体的提供者变体
- 规范 ID（如 `gpt-5.3-codex`）以允许提供者合并

对于 `enabledModels` 和 CLI `--models`：

- 精确的规范 ID 展开为该规范组中的所有具体变体
- 显式的 `provider/modelId` 条目保持精确
- glob 和模糊匹配仍然在具体模型上操作

## `/model` 和 `--list-models`

两种界面都保持提供者前缀的模型可见且可选。

它们现在还公开规范/合并的模型：

- `/model` 在提供者标签页旁包含规范视图
- `--list-models` 打印规范部分加上具体的提供者行

选择规范条目会存储规范选择器。选择提供者行会存储显式的 `provider/modelId`。

## 上下文提升（模型级回退链）

上下文提升是一种溢出恢复机制，适用于小上下文变体（例如 `*-spark`），当 API 因上下文长度错误拒绝请求时，自动提升到更大上下文的同级模型。

### 触发和顺序

当一轮对话因上下文溢出错误（例如 `context_length_exceeded`）失败时，`AgentSession` 会在回退到压缩**之前**尝试提升：

1. 如果 `contextPromotion.enabled` 为 true，解析提升目标（见下文）。
2. 如果找到目标，切换到该模型并重试请求——无需压缩。
3. 如果没有可用目标，则在当前模型上回退到自动压缩。

### 目标选择

选择是基于模型驱动的，而非基于角色驱动的：

1. `currentModel.contextPromotionTarget`（如果已配置）
2. 同一提供者 + API 上最小的较大上下文模型

除非凭据可解析（`ModelRegistry.getApiKey(...)`），否则候选模型将被忽略。

### OpenAI Codex websocket 切换

如果从/向 `openai-codex-responses` 切换，会话提供者状态键 `openai-codex-responses` 在模型切换前关闭。这会丢弃 websocket 传输状态，以便下一轮在提升后的模型上从干净状态开始。

### 持久化行为

提升使用临时切换（`setModelTemporary`）：

- 在会话历史中记录为临时的 `model_change`
- 不会重写已保存的角色映射

### 配置显式回退链

通过模型元数据中的 `contextPromotionTarget` 直接配置回退。

`contextPromotionTarget` 接受：

- `provider/model-id`（显式）
- `model-id`（在当前提供者内解析）

同一提供者上 Spark -> 非 Spark 的示例（`models.yml`）：

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

内置模型生成器也会在同一提供者上存在基础模型时，自动为 `*-spark` 模型分配此项。

## 兼容性和路由字段

`models.yml` 支持以下 `compat` 子集：

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField`（`max_completion_tokens` 或 `max_tokens`）
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

这些由 OpenAI-completions 传输逻辑使用，并与基于 URL 的自动检测结合。

## 实际示例

### 本地 OpenAI 兼容端点（无认证）

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

### 基于环境变量密钥的托管代理

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

### 覆盖内置提供者路由 + 模型元数据

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

## LiteLLM 代理自动配置

当同时设置了 `LITELLM_BASE_URL` 和 `LITELLM_API_KEY` 环境变量时，xcsh 会自动管理 LiteLLM 代理的 `models.yml` 配置。

### 首次运行自动生成

如果 `models.yml` 不存在且检测到 LiteLLM 环境变量，xcsh 会自动生成它：

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

同时还会生成一个包含合理图像提供者设置的默认 `config.yml`。

### 启动自修复

每次启动时，模型注册表中的 `startupHealthCheck()` 运行以下检查：

| 条件 | 操作 |
|------|------|
| `models.yml` 缺失 | 从环境变量自动生成 |
| `models.yml` 损坏或无法解析 | 备份为 `.bak`，重新生成 |
| `baseUrl` 与 `LITELLM_BASE_URL` 不匹配 | 备份为 `.bak`，使用新 URL 重新生成 |
| `configVersion` 缺失或过时 | 备份为 `.bak`，使用当前版本重新生成 |
| 配置健康 | 无操作 |

所有修复在覆盖前创建 `.bak` 备份。所有操作都是幂等的。

### CLI 命令

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### 必需的环境变量

| 变量 | 用途 |
|------|------|
| `LITELLM_BASE_URL` | LiteLLM 代理 URL（例如 `https://your-proxy.example.com`）。必须以 `http://` 或 `https://` 开头。 |
| `LITELLM_API_KEY` | 代理的 API 密钥。在生成的配置中按名称引用，运行时解析。 |

如果任一变量未设置，自动配置将被静默跳过。

### 配置版本控制

生成的配置包含 `configVersion` 字段。当生成的格式在未来版本中更改时，xcsh 会检测过时的配置并自动升级（附带备份）。

## 遗留消费者注意事项

大多数模型配置现在通过 `ModelRegistry` 经由 `models.yml` 流转。

一个值得注意的遗留路径仍然存在：Web 搜索 Anthropic 认证解析仍然直接在 `src/web/search/auth.ts` 中读取 `~/.xcsh/agent/models.json`。

如果您依赖该特定路径，请在该模块迁移之前注意保持 JSON 兼容性。

## 故障模式

如果 `models.yml` 未通过架构或验证检查：

- 如果设置了 `LITELLM_BASE_URL` 和 `LITELLM_API_KEY`，启动健康检查会尝试自动修复（备份损坏文件，从环境变量重新生成）。如果修复成功，注册表会重新加载修复后的配置。
- 如果无法自动修复（环境变量未设置、写入失败），注册表将继续使用内置模型运行。
- 错误通过 `ModelRegistry.getError()` 公开，并在 UI/通知中显示。
