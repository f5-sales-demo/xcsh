---
title: 模型与提供商配置
description: 通过 models.yml 进行模型注册表和提供商配置，包含路由、回退和定价。
sidebar:
  order: 1
  label: 模型与提供商
i18n:
  sourceHash: "8053df967ff6"
  translator: "machine"
---

# 模型与提供商配置 (`models.yml`)

本文档描述了代码代理当前如何加载模型、应用覆盖、解析凭证以及在运行时选择模型。

## 什么控制模型行为

主要实现文件：

- `src/config/model-registry.ts` — 加载内置 + 自定义模型、提供商覆盖、运行时发现、身份验证集成
- `src/config/model-resolver.ts` — 解析模型模式并选择初始/小型/慢速模型
- `src/config/settings-schema.ts` — 模型相关设置 (`modelRoles`，提供商传输首选项)
- `src/session/auth-storage.ts` — API 密钥 + OAuth 解析顺序
- `packages/ai/src/models.ts` 和 `packages/ai/src/types.ts` — 内置提供商/模型和 `Model`/`compat` 类型

## 配置文件位置和旧版行为

默认配置路径：

- `~/.xcsh/agent/models.yml`

仍然存在的旧版行为：

- 如果 `models.yml` 缺失但在相同位置存在 `models.json`，它将被迁移到 `models.yml`。
- 以编程方式传递给 `ModelRegistry` 时，仍然支持明确的 `.json` / `.jsonc` 配置路径。

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

`configVersion` 是自动配置系统写入的可选整数。如果存在，xcsh 使用它来检测过时的配置并自动升级它们。

`provider-id` 是在选择和身份验证查找中使用的规范提供商键。

`equivalence` 是可选的，用于在具体提供商模型之上配置规范模型分组：

- `overrides` 将精确的具体选择器 (`provider/modelId`) 映射到官方的上游规范 ID
- `exclude` 将具体的选择器退出规范分组

## 提供商级别字段

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

### 允许的提供商/模型 `api` 值

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### 允许的身份验证/发现值

- `auth`: `apiKey`（默认）或 `none`
- `discovery.type`: `ollama`

## 验证规则（当前）

### 完整的自定义提供商（`models` 非空）

必需：

- `baseUrl`
- `apiKey` 除非设置了 `auth: none`
- `api` 在提供商级别或每个模型中

### 仅覆盖的提供商（`models` 缺失或为空）

必须至少定义以下之一：

- `baseUrl`
- `modelOverrides`
- `discovery`

### 发现

- `discovery` 需要提供商级别的 `api`。

### 模型值检查

- 需要 `id`
- 如果提供，`contextWindow` 和 `maxTokens` 必须为正数

## 合并和覆盖顺序

ModelRegistry 管道（在刷新时）：

1. 从 `@f5-sales-demo/pi-ai` 加载内置提供商/模型。
2. 加载 `models.yml` 自定义配置。
3. 将提供商覆盖 (`baseUrl`, `headers`) 应用于内置模型。
4. 应用 `modelOverrides` (每个提供商 + 模型 ID)。
5. 合并自定义 `models`：
   - 相同的 `provider + id` 替换现有的
   - 否则追加
6. 应用运行时发现的模型（目前是 Ollama 和 LM Studio），然后重新应用模型覆盖。

## 规范模型等效性和合并

注册表保留每一个具体的提供商模型，然后在它们之上构建规范层。

规范 ID 仅为官方的上游 ID，例如：

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### `models.yml` 等效性配置

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

1. 来自 `equivalence.overrides` 的确切用户覆盖
2. 捆绑的内置模型元数据中的官方 ID 匹配
3. 对网关/提供商变体进行保守的启发式规范化
4. 回退到具体模型自己的 ID

当前的启发式方法故意设计得很狭窄：

- 当存在时，可以剥离嵌入的上游前缀，例如 `anthropic/...` 或 `openai/...`
- 只有当带点和带连字符的版本变体映射到现有的官方 ID 时，才能对其进行规范化，例如 `4.6 -> 4-6`
- 在没有捆绑匹配或明确覆盖的情况下，不会合并模棱两可的家族或版本

### 规范解析行为

当多个具体变体共享一个规范 ID 时，解析使用：

1. 可用性和身份验证
2. `config.yml` `modelProviderOrder`
3. 现有的注册表/提供商顺序，如果未设置 `modelProviderOrder`

禁用或未经验证的提供商将被跳过。

会话状态和记录继续记录实际执行该轮次的具体提供商/模型。

提供商默认值 vs 每个模型的覆盖：

- 提供商 `headers` 是基线。
- 模型 `headers` 覆盖提供商的标头键。
- `modelOverrides` 可以覆盖模型元数据 (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`)。
- `compat` 对嵌套路由块深度合并 (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`)。

## 运行时发现集成

### 隐式 Ollama 发现

如果没有明确配置 `ollama`，注册表会添加一个隐式的可发现提供商：

- provider: `ollama`
- api: `openai-completions`
- base URL: `OLLAMA_BASE_URL` 或 `http://127.0.0.1:11434`
- auth mode: 无密钥（`auth: none` 行为）

运行时发现对 Ollama 调用 `GET /api/tags`，并使用本地默认值合成模型条目。

### 隐式 llama.cpp 发现

如果没有明确配置 `llama.cpp`，注册表会添加一个隐式的可发现提供商：
注意：它使用了较新的 anthropic messages API 而不是 openai-completions。

- provider: `llama.cpp`
- api: `openai-responses`
- base URL: `LLAMA_CPP_BASE_URL` 或 `http://127.0.0.1:8080`
- auth mode: 无密钥（`auth: none` 行为）

运行时发现对 llama.cpp 调用 `GET models`，并使用本地默认值合成模型条目。

### 隐式 LM Studio 发现

如果没有明确配置 `lm-studio`，注册表会添加一个隐式的可发现提供商：

- provider: `lm-studio`
- api: `openai-completions`
- base URL: `LM_STUDIO_BASE_URL` 或 `http://127.0.0.1:1234/v1`
- auth mode: 无密钥（`auth: none` 行为）

运行时发现获取模型 (`GET /models`) 并使用本地默认值合成模型条目。

### 显式提供商发现

你可以自己配置发现：

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

### 扩展提供商注册

扩展可以在运行时注册提供商 (`pi.registerProvider(...)`)，包括：

- 提供商的模型替换/追加
- 为新的 API ID 注册自定义流处理程序
- 注册自定义 OAuth 提供商

## 身份验证和 API 密钥解析顺序

当为一个提供商请求密钥时，有效的顺序是：

1. 运行时覆盖 (CLI `--api-key`)
2. 存储在 `agent.db` 中的 API 密钥凭证
3. 存储在 `agent.db` 中的 OAuth 凭证（具有刷新功能）
4. 环境变量映射 (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` 等)
5. ModelRegistry 回退解析器（来自 `models.yml` 的提供商 `apiKey`，使用环境变量名或字面量语义）

`models.yml` `apiKey` 行为：

- 值首先被视为环境变量名。
- 如果不存在环境变量，则使用该字面量字符串作为令牌。

如果 `authHeader: true` 并且提供了提供商的 `apiKey`，模型将获得：

- 注入的 `Authorization: Bearer <resolved-key>` 标头。

无密钥提供商：

- 标记为 `auth: none` 的提供商被视为无需凭证即可使用。
- `getApiKey*` 对它们返回 `kNoAuth`。

## 模型可用性 vs 所有模型

- `getAll()` 返回加载的模型注册表（内置 + 合并的自定义 + 发现的）。
- `getAvailable()` 过滤到无密钥或具有可解析身份验证的模型。

因此，一个模型可以存在于注册表中，但在身份验证可用之前不可选择。

## 运行时模型解析

### CLI 和模式解析

`model-resolver.ts` 支持：

- 确切的 `provider/modelId`
- 确切的规范模型 ID
- 确切的模型 ID (推断出提供商)
- 模糊/子字符串匹配
- 在 `--models` 中的 glob 作用域模式（例如 `openai/*`, `*sonnet*`）
- 可选的 `:thinkingLevel` 后缀（`off|minimal|low|medium|high|xhigh`）

`--provider` 是旧版；首选 `--model`。

确切选择器的解析优先级：

1. 确切的 `provider/modelId` 绕过合并
2. 确切的规范 ID 通过规范索引解析
3. 确切的裸具体 ID 仍然有效
4. 模糊和 glob 匹配在确切路径之后运行

### 初始模型选择优先级

`findInitialModel(...)` 使用此顺序：

1. 明确的 CLI 提供商+模型
2. 第一个作用域内的模型（如果未恢复）
3. 保存的默认提供商/模型
4. 在可用模型中已知的提供商默认值（例如 OpenAI/Anthropic/等）
5. 第一个可用模型

### 角色别名和设置

支持的模型角色：

- `default`, `smol`, `slow`, `plan`, `commit`

像 `pi/smol` 这样的角色别名通过 `settings.modelRoles` 扩展。每个角色值还可以附加一个思考选择器，例如 `:minimal`, `:low`, `:medium`, 或 `:high`。

如果一个角色指向另一个角色，目标模型仍会正常继承，并且任何在该特定角色使用中明确指示该角色的后缀优先。

相关设置：

- `modelRoles` (记录)
- `enabledModels` (作用域模式列表)
- `modelProviderOrder` (全局规范-提供商优先级)
- `providers.kimiApiFormat` (`openai` 或 `anthropic` 请求格式)
- `providers.openaiWebsockets` (`auto|off|on` 用于 OpenAI Codex 传输的 websocket 首选项)

`modelRoles` 可以存储以下任一项：

- `provider/modelId` 以固定一个具体的提供商变体
- 一个规范 ID，如 `gpt-5.3-codex`，以允许提供商合并

对于 `enabledModels` 和 CLI `--models`：

- 确切的规范 ID 扩展为该规范组中的所有具体变体
- 明确的 `provider/modelId` 条目保持确切
- globs 和模糊匹配仍然在具体模型上操作

## `/model` 和 `--list-models`

这两个界面都保持带提供商前缀的模型可见和可选。

它们现在还暴露了规范/合并的模型：

- `/model` 包含一个规范视图以及提供商选项卡
- `--list-models` 打印一个规范部分以及具体的提供商行

选择一个规范条目将存储规范选择器。选择提供商行将存储明确的 `provider/modelId`。

## 上下文提升（模型级回退链）

上下文提升是针对小上下文变体（例如 `*-spark`）的溢出恢复机制，当 API 拒绝带有上下文长度错误的请求时，它会自动提升到更大上下文的同级模型。

### 触发和顺序

当由于上下文溢出错误（例如 `context_length_exceeded`）导致一轮失败时，`AgentSession` 会尝试**在**回退到压缩之前进行提升：

1. 如果 `contextPromotion.enabled` 为真，解析一个提升目标（见下文）。
2. 如果找到目标，切换到它并重试请求 — 不需要压缩。
3. 如果没有目标可用，转到在当前模型上进行自动压缩。

### 目标选择

选择是由模型驱动的，而不是角色驱动的：

1. `currentModel.contextPromotionTarget` (如果已配置)
2. 同一提供商 + API 上最小的具有更大上下文的模型

除非凭证可解析 (`ModelRegistry.getApiKey(...)`)，否则候选者将被忽略。

### OpenAI Codex websocket 切换

如果在进出 `openai-codex-responses` 时进行切换，会话提供商状态键 `openai-codex-responses` 会在模型切换前关闭。这会丢弃 websocket 传输状态，以便下一轮可以在提升后的模型上干净地开始。

### 持久化行为

提升使用临时切换 (`setModelTemporary`)：

- 在会话历史记录中记录为临时的 `model_change`
- 不会重写保存的角色映射

### 配置明确的回退链

通过 `contextPromotionTarget` 直接在模型元数据中配置回退。

`contextPromotionTarget` 接受以下任一项：

- `provider/model-id` (明确)
- `model-id` (在当前提供商内解析)

示例 (`models.yml`) 将 Spark 转换为同一提供商上的非 Spark：

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

当存在同一提供商基础模型时，内置模型生成器也会自动为 `*-spark` 模型分配此项。

## 兼容性和路由字段

`models.yml` 支持此 `compat` 子集：

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` 或 `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

这些由 OpenAI-completions 传输逻辑消耗，并与基于 URL 的自动检测相结合。

## 实际例子

### 本地兼容 OpenAI 的端点（无身份验证）

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

### 具有基于环境密钥的托管代理

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

### 覆盖内置提供商路由 + 模型元数据

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

当同时设置了 `LITELLM_BASE_URL` 和 `LITELLM_API_KEY` 环境变量时，xcsh 自动管理 LiteLLM 代理的 `models.yml` 配置。

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

还会生成一个包含合理图像提供商设置的默认 `config.yml`。

### 启动自愈

在每次启动时，模型注册表中的 `startupHealthCheck()` 会运行以下检查：

| 条件 | 动作 |
|-----------|--------|
| `models.yml` 缺失 | 从环境变量自动生成 |
| `models.yml` 损坏或无法解析 | 备份为 `.bak`，重新生成 |
| `baseUrl` 不匹配 `LITELLM_BASE_URL` | 备份为 `.bak`，用新 URL 重新生成 |
| `configVersion` 缺失或过时 | 备份为 `.bak`，用当前版本重新生成 |
| 配置健康 | 无动作 |

所有修复都会在覆盖之前创建 `.bak` 备份。所有操作都是幂等的。

### CLI 命令

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### 所需的环境变量

| 变量 | 用途 |
|----------|---------|
| `LITELLM_BASE_URL` | LiteLLM 代理 URL (例如 `https://your-proxy.example.com`)。必须以 `http://` 或 `https://` 开头。 |
| `LITELLM_API_KEY` | 代理的 API 密钥。在生成的配置中通过名称引用，在运行时解析。 |

如果未设置任何一个变量，自动配置将被静默跳过。

### 配置版本控制

生成的配置包括一个 `configVersion` 字段。当生成的格式在未来版本中发生变化时，xcsh 会检测过时的配置并自动升级它们（带有备份）。

## 旧版使用者注意事项

目前，大多数模型配置通过 `ModelRegistry` 经由 `models.yml` 流转。

仍保留一个显着的旧版路径：Web 搜索 Anthropic 身份验证解析仍然直接在 `src/web/search/auth.ts` 中读取 `~/.xcsh/agent/models.json`。

如果你依赖于该特定路径，请牢记 JSON 兼容性，直到该模块迁移完毕。

## 故障模式

如果 `models.yml` 未通过模式或验证检查：

- 如果设置了 `LITELLM_BASE_URL` 和 `LITELLM_API_KEY`，启动健康检查尝试自动修复（备份损坏文件，从环境变量重新生成）。如果修复成功，注册表会重新加载已修复的配置。
- 如果无法自动修复（未设置环境变量、写入失败），注册表将使用内置模型继续运行。
- 错误通过 `ModelRegistry.getError()` 暴露并显示在 UI/通知中。
