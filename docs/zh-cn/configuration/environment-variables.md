---
title: 环境变量
description: xcsh 配置和行为控制的运行时环境变量参考。
sidebar:
  order: 2
  label: 环境变量
i18n:
  sourceHash: 7baa9f5226ba
  translator: machine
---

# 环境变量（当前运行时参考）

本参考文档基于以下代码路径中的当前实现：

- `packages/coding-agent/src/**`
- `packages/ai/src/**`（coding-agent 使用的提供商/认证解析）
- `packages/utils/src/**` 和 `packages/tui/src/**` 中直接影响 coding-agent 运行时的变量

本文档仅记录当前有效的行为。

## 解析模型和优先级

大多数运行时查找使用来自 `@f5xc-salesdemos/pi-utils`（`packages/utils/src/env.ts`）的 `$env`。

`$env` 加载顺序：

1. 现有进程环境（`Bun.env`）
2. 项目 `.env`（`$PWD/.env`），仅用于未设置的键
3. 用户主目录 `.env`（`~/.env`），仅用于未设置的键

`.env` 文件的附加规则：解析时 `XCSH_*` 键会被镜像到 `PI_*` 键。

---

## 1) 模型/提供商认证

除非另有说明，这些变量通过 `getEnvApiKey()`（`packages/ai/src/stream.ts`）使用。

### 核心提供商凭据

| 变量                        | 用途 | 何时需要                                                 | 备注 / 优先级                                                                                  |
|---------------------------------|---|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `ANTHROPIC_OAUTH_TOKEN`         | Anthropic API 认证 | 使用 Anthropic 的 OAuth 令牌认证时                         | 在提供商认证解析中优先于 `ANTHROPIC_API_KEY`                              |
| `ANTHROPIC_API_KEY`             | Anthropic API 认证 | 不使用 OAuth 令牌时使用 Anthropic                           | `ANTHROPIC_OAUTH_TOKEN` 之后的备选项                                                              |
| `ANTHROPIC_FOUNDRY_API_KEY`     | 通过 Azure Foundry / 企业网关使用 Anthropic | 启用 `CLAUDE_CODE_USE_FOUNDRY` 时                             | 启用 Foundry 模式时优先于 `ANTHROPIC_OAUTH_TOKEN` 和 `ANTHROPIC_API_KEY`  |
| `OPENAI_API_KEY`                | OpenAI 认证 | 使用 OpenAI 系列提供商且未显式传入 apiKey 参数时 | 用于 OpenAI Completions/Responses 提供商                                                      |
| `GEMINI_API_KEY`                | Google Gemini 认证 | 使用 `google` 提供商模型时                                | Gemini 提供商映射的主要密钥                                                             |
| `GOOGLE_API_KEY`                | Gemini 图像工具认证备选 | 使用 `gemini_image` 工具且未设置 `GEMINI_API_KEY` 时            | 用于 coding-agent 图像工具备选路径                                                       |
| `GROQ_API_KEY`                  | Groq 认证 | 使用 Groq 模型时                                             |                                                                                                     |
| `CEREBRAS_API_KEY`              | Cerebras 认证 | 使用 Cerebras 模型时                                         |                                                                                                     |
| `TOGETHER_API_KEY`              | Together 认证 | 使用 `together` 提供商时                                     |                                                                                                     |
| `HUGGINGFACE_HUB_TOKEN`         | Hugging Face 认证 | 使用 `huggingface` 提供商时                                  | 主要的 Hugging Face 令牌环境变量                                                                  |
| `HF_TOKEN`                      | Hugging Face 认证 | 使用 `huggingface` 提供商时                                  | `HUGGINGFACE_HUB_TOKEN` 未设置时的备选项                                                      |
| `SYNTHETIC_API_KEY`             | Synthetic 认证 | 使用 Synthetic 模型时                                        |                                                                                                     |
| `NVIDIA_API_KEY`                | NVIDIA 认证 | 使用 `nvidia` 提供商时                                       |                                                                                                     |
| `NANO_GPT_API_KEY`              | NanoGPT 认证 | 使用 `nanogpt` 提供商时                                      |                                                                                                     |
| `VENICE_API_KEY`                | Venice 认证 | 使用 `venice` 提供商时                                       |                                                                                                     |
| `LITELLM_API_KEY`               | LiteLLM 认证 | 使用 `litellm` 提供商时                                      | 兼容 OpenAI 的 LiteLLM 代理密钥。与 `LITELLM_BASE_URL` 一起设置时，可自动配置 `models.yml` |
| `LM_STUDIO_API_KEY`             | LM Studio 认证（可选） | 使用 `lm-studio` 提供商连接需认证的主机时           | 本地 LM Studio 通常无需认证运行；需要密钥时任何非空令牌均可         |
| `OLLAMA_API_KEY`                | Ollama 认证（可选） | 使用 `ollama` 提供商连接需认证的主机时              | 本地 Ollama 通常无需认证运行；需要密钥时任何非空令牌均可            |
| `LLAMA_CPP_API_KEY`             | Ollama 认证（可选） | 使用带 `--api-key` 参数的 `llama-server` 时              | 本地 llama.cpp 通常无需认证运行；配置密钥时任何非空令牌均可       |
| `XIAOMI_API_KEY`                | 小米 MiMo 认证 | 使用 `xiaomi` 提供商时                                       |                                                                                                     |
| `MOONSHOT_API_KEY`              | Moonshot 认证 | 使用 `moonshot` 提供商时                                     |                                                                                                     |
| `XAI_API_KEY`                   | xAI 认证 | 使用 xAI 模型时                                              |                                                                                                     |
| `OPENROUTER_API_KEY`            | OpenRouter 认证 | 使用 OpenRouter 模型时                                       | 当首选/自动提供商为 OpenRouter 时，图像工具也会使用此密钥                                  |
| `MISTRAL_API_KEY`               | Mistral 认证 | 使用 Mistral 模型时                                          |                                                                                                     |
| `ZAI_API_KEY`                   | z.ai 认证 | 使用 z.ai 模型时                                             | z.ai 网络搜索提供商也使用此密钥                                                               |
| `MINIMAX_API_KEY`               | MiniMax 认证 | 使用 `minimax` 提供商时                                      |                                                                                                     |
| `MINIMAX_CODE_API_KEY`          | MiniMax Code 认证 | 使用 `minimax-code` 提供商时                                 |                                                                                                     |
| `MINIMAX_CODE_CN_API_KEY`       | MiniMax Code CN 认证 | 使用 `minimax-code-cn` 提供商时                              |                                                                                                     |
| `OPENCODE_API_KEY`              | OpenCode 认证 | 使用 OpenCode 模型时                                         |                                                                                                     |
| `QIANFAN_API_KEY`               | 千帆认证 | 使用 `qianfan` 提供商时                                      |                                                                                                     |
| `QWEN_OAUTH_TOKEN`              | 通义千问门户认证 | 使用 `qwen-portal` 的 OAuth 令牌时                          | 优先于 `QWEN_PORTAL_API_KEY`                                                         |
| `QWEN_PORTAL_API_KEY`           | 通义千问门户认证 | 使用 `qwen-portal` 的 API 密钥时                              | `QWEN_OAUTH_TOKEN` 之后的备选项                                                                   |
| `ZENMUX_API_KEY`                | ZenMux 认证 | 使用 `zenmux` 提供商时                                       | 用于 ZenMux 兼容 OpenAI 和 Anthropic 的路由                                              |
| `VLLM_API_KEY`                  | vLLM 认证/发现选择加入 | 使用 `vllm` 提供商（本地兼容 OpenAI 的服务器）时       | 对于无认证的本地服务器，任何非空值均可                                                 |
| `CURSOR_ACCESS_TOKEN`           | Cursor 提供商认证 | 使用 Cursor 提供商时                                         |                                                                                                     |
| `AI_GATEWAY_API_KEY`            | Vercel AI Gateway 认证 | 使用 `vercel-ai-gateway` 提供商时                            |                                                                                                     |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | Cloudflare AI Gateway 认证 | 使用 `cloudflare-ai-gateway` 提供商时                        | 基础 URL 必须配置为 `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` |

### GitHub/Copilot 令牌链

| 变量 | 用途 | 链 |
|---|---|---|
| `COPILOT_GITHUB_TOKEN` | GitHub Copilot 提供商认证 | `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` |
| `GH_TOKEN` | Copilot 备选；网页抓取器中的 GitHub API 认证 | 在网页抓取器中：`GITHUB_TOKEN` → `GH_TOKEN` |
| `GITHUB_TOKEN` | Copilot 备选；网页抓取器中的 GitHub API 认证 | 在网页抓取器中：在 `GH_TOKEN` 之前检查 |

---

## 2) 提供商特定运行时配置

### Anthropic Foundry 网关（Azure / 企业代理）

当启用 `CLAUDE_CODE_USE_FOUNDRY` 时，Anthropic 请求切换到 Foundry 模式：

- 基础 URL 从 `FOUNDRY_BASE_URL` 解析（未设置时回退到模型/默认基础 URL）。
- 提供商 `anthropic` 的 API 密钥解析顺序变为：
  `ANTHROPIC_FOUNDRY_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`。
- `ANTHROPIC_CUSTOM_HEADERS` 被解析为逗号/换行符分隔的 `key: value` 对，并合并到请求头中。
- TLS 客户端/服务端材料可从环境变量值注入：
  `NODE_EXTRA_CA_CERTS`、`CLAUDE_CODE_CLIENT_CERT`、`CLAUDE_CODE_CLIENT_KEY`。
  每个变量接受以下格式之一：
  - PEM 内容的文件系统路径，或
  - 内联 PEM（包括转义的 `\n` 序列）。

| 变量 | 值类型 | 行为 |
|---|---|---|
| `CLAUDE_CODE_USE_FOUNDRY` | 布尔型字符串（`1`、`true`、`yes`、`on`） | 为 Anthropic 提供商启用 Foundry 模式 |
| `FOUNDRY_BASE_URL` | URL 字符串 | Foundry 模式下的 Anthropic 端点基础 URL |
| `ANTHROPIC_FOUNDRY_API_KEY` | 令牌字符串 | 用于 `Authorization: Bearer <token>` |
| `ANTHROPIC_CUSTOM_HEADERS` | 请求头列表字符串 | 额外请求头；格式为 `header-a: value, header-b: value` 或换行符分隔 |
| `NODE_EXTRA_CA_CERTS` | PEM 路径或内联 PEM | 用于服务器证书验证的额外 CA 链 |
| `CLAUDE_CODE_CLIENT_CERT` | PEM 路径或内联 PEM | mTLS 客户端证书 |
| `CLAUDE_CODE_CLIENT_KEY` | PEM 路径或内联 PEM | mTLS 客户端私钥（必须与证书配对） |

### Amazon Bedrock

| 变量 | 默认值 / 行为 |
|---|---|
| `AWS_REGION` | 主要区域来源 |
| `AWS_DEFAULT_REGION` | `AWS_REGION` 未设置时的备选 |
| `AWS_PROFILE` | 启用命名配置文件认证路径 |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | 启用 IAM 密钥认证路径 |
| `AWS_BEARER_TOKEN_BEDROCK` | 启用持有者令牌认证路径 |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `AWS_CONTAINER_CREDENTIALS_FULL_URI` | 启用 ECS 任务凭据路径 |
| `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` | 启用 Web 身份认证路径 |
| `AWS_BEDROCK_SKIP_AUTH` | 如果为 `1`，注入虚拟凭据（代理/无认证场景） |
| `AWS_BEDROCK_FORCE_HTTP1` | 如果为 `1`，强制使用 Node HTTP/1 请求处理器 |

提供商代码中的区域回退：`options.region` → `AWS_REGION` → `AWS_DEFAULT_REGION` → `us-east-1`。

### Azure OpenAI Responses

| 变量 | 默认值 / 行为 |
|---|---|
| `AZURE_OPENAI_API_KEY` | 除非通过选项传入 API 密钥，否则必需 |
| `AZURE_OPENAI_API_VERSION` | 默认 `v1` |
| `AZURE_OPENAI_BASE_URL` | 直接覆盖基础 URL |
| `AZURE_OPENAI_RESOURCE_NAME` | 用于构建基础 URL：`https://<resource>.openai.azure.com/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | 可选映射字符串：`modelId=deploymentName,model2=deployment2` |

基础 URL 解析：选项 `azureBaseUrl` → 环境变量 `AZURE_OPENAI_BASE_URL` → 选项/环境变量中的资源名称 → `model.baseUrl`。

### Google Vertex AI

| 变量 | 是否必需？ | 备注 |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | 是（除非通过选项传入） | 备选：`GCLOUD_PROJECT` |
| `GCLOUD_PROJECT` | 备选 | 用作替代项目 ID 来源 |
| `GOOGLE_CLOUD_LOCATION` | 是（除非通过选项传入） | 提供商中无默认值 |
| `GOOGLE_APPLICATION_CREDENTIALS` | 有条件 | 如果设置，文件必须存在；否则检查 ADC 备选路径（`~/.config/gcloud/application_default_credentials.json`） |

### Kimi

| 变量 | 默认值 / 行为 |
|---|---|
| `KIMI_CODE_OAUTH_HOST` | 主要 OAuth 主机覆盖 |
| `KIMI_OAUTH_HOST` | 备选 OAuth 主机覆盖 |
| `KIMI_CODE_BASE_URL` | 覆盖 Kimi 使用端点基础 URL（`usage/kimi.ts`） |

OAuth 主机链：`KIMI_CODE_OAUTH_HOST` → `KIMI_OAUTH_HOST` → `https://auth.kimi.com`。

### Antigravity/Gemini 图像兼容性

| 变量 | 默认值 / 行为 |
|---|---|
| `PI_AI_ANTIGRAVITY_VERSION` | 覆盖 Gemini CLI 提供商中的 Antigravity user-agent 版本标签 |

### OpenAI Codex responses（功能/调试控制）

| 变量 | 行为 |
|---|---|
| `PI_CODEX_DEBUG` | `1`/`true` 启用 Codex 提供商调试日志 |
| `PI_CODEX_WEBSOCKET` | `1`/`true` 启用 WebSocket 传输优先 |
| `PI_CODEX_WEBSOCKET_V2` | `1`/`true` 启用 WebSocket v2 路径 |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | 正整数覆盖（默认 300000） |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | 非负整数覆盖（默认 5） |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | 正整数基础退避覆盖（默认 500） |

### Cursor 提供商调试

| 变量 | 行为 |
|---|---|
| `DEBUG_CURSOR` | 启用提供商调试日志；`2`/`verbose` 可查看详细的负载片段 |
| `DEBUG_CURSOR_LOG` | 可选的 JSONL 调试日志输出文件路径 |

### 提示缓存兼容性开关

| 变量 | 行为 |
|---|---|
| `PI_CACHE_RETENTION` | 如果为 `long`，在支持的提供商中启用长期保留（`anthropic`、`openai-responses`、Bedrock 保留解析） |

---

## 3) 网络搜索子系统

### 搜索提供商凭据

| 变量 | 使用者 |
|---|---|
| `EXA_API_KEY` | Exa 搜索提供商和 Exa MCP 工具 |
| `BRAVE_API_KEY` | Brave 搜索提供商 |
| `PERPLEXITY_API_KEY` | Perplexity 搜索提供商 API 密钥模式 |
| `TAVILY_API_KEY` | Tavily 搜索提供商 |
| `ZAI_API_KEY` | z.ai 搜索提供商（也检查 `agent.db` 中存储的 OAuth） |
| `OPENAI_API_KEY` / 数据库中的 Codex OAuth | Codex 搜索提供商可用性/认证 |

### Anthropic 网络搜索认证链

`packages/coding-agent/src/web/search/auth.ts` 按以下顺序解析 Anthropic 网络搜索凭据：

1. `ANTHROPIC_SEARCH_API_KEY`（+ 可选的 `ANTHROPIC_SEARCH_BASE_URL`）
2. `models.json` 中 `api: "anthropic-messages"` 的提供商条目
3. `agent.db` 中的 Anthropic OAuth 凭据（不得在 5 分钟缓冲期内过期）
4. 通用 Anthropic 环境变量备选：提供商密钥（`ANTHROPIC_FOUNDRY_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`）+ 可选的 `ANTHROPIC_BASE_URL`（Foundry 模式启用时为 `FOUNDRY_BASE_URL`）

相关变量：

| 变量 | 默认值 / 行为 |
|---|---|
| `ANTHROPIC_SEARCH_API_KEY` | 最高优先级的显式搜索密钥 |
| `ANTHROPIC_SEARCH_BASE_URL` | 省略时默认为 `https://api.anthropic.com` |
| `ANTHROPIC_SEARCH_MODEL` | 默认为 `claude-haiku-4-5` |
| `ANTHROPIC_BASE_URL` | 第 4 层认证路径的通用备选基础 URL |

### Perplexity OAuth 流程行为标志

| 变量 | 行为 |
|---|---|
| `PI_AUTH_NO_BORROW` | 如果设置，在 Perplexity 登录流程中禁用 macOS 原生应用令牌借用路径 |

---

## 4) Python 工具和内核运行时

| 变量 | 默认值 / 行为 |
|---|---|
| `PI_PY` | Python 工具模式覆盖：`0`/`bash`=`bash-only`，`1`/`py`=`ipy-only`，`mix`/`both`=`both`；无效值将被忽略 |
| `PI_PYTHON_SKIP_CHECK` | 如果为 `1`，跳过 Python 内核可用性检查/预热检查 |
| `PI_PYTHON_GATEWAY_URL` | 如果设置，使用外部内核网关代替本地共享网关 |
| `PI_PYTHON_GATEWAY_TOKEN` | 外部网关的可选认证令牌（`Authorization: token <value>`） |
| `PI_PYTHON_IPC_TRACE` | 如果为 `1`，在内核模块中启用底层 IPC 跟踪路径 |
| `VIRTUAL_ENV` | Python 运行时解析中最高优先级的虚拟环境路径 |

额外的条件行为：

- 如果 `BUN_ENV=test` 或 `NODE_ENV=test`，Python 可用性检查将被视为正常，并跳过预热。
- Python 环境过滤会拒绝常见的 API 密钥，并允许安全的基础变量以及 `LC_`、`XDG_`、`PI_` 前缀。

---

## 5) 代理/运行时行为开关

| 变量                   | 默认值 / 行为                                                                           |
|----------------------------|----------------------------------------------------------------------------------------------|
| `PI_SMOL_MODEL`            | `smol` 的临时模型角色覆盖（CLI `--smol` 优先）                     |
| `PI_SLOW_MODEL`            | `slow` 的临时模型角色覆盖（CLI `--slow` 优先）                     |
| `PI_PLAN_MODEL`            | `plan` 的临时模型角色覆盖（CLI `--plan` 优先）                     |
| `PI_NO_TITLE`              | 如果设置（任何非空值），在第一条用户消息时禁用自动会话标题生成   |
| `NULL_PROMPT`              | 如果为 `true`，系统提示构建器返回空字符串                                        |
| `PI_BLOCKED_AGENT`         | 在任务工具中阻止特定的子代理类型                                                 |
| `PI_SUBPROCESS_CMD`        | 覆盖子代理生成命令（绕过 `xcsh` / `xcsh.cmd` 解析）                       |
| `PI_TASK_MAX_OUTPUT_BYTES` | 每个子代理的最大捕获输出字节数（默认 `500000`）                                    |
| `PI_TASK_MAX_OUTPUT_LINES` | 每个子代理的最大捕获输出行数（默认 `5000`）                                      |
| `PI_TIMING`                | 如果为 `1`，启用启动/工具计时检测日志                                     |
| `PI_DEBUG_STARTUP`         | 在多个启动路径中启用启动阶段调试输出到 stderr                       |
| `PI_PACKAGE_DIR`           | 覆盖包资源基础目录解析（文档/示例/变更日志路径查找）            |
| `PI_DISABLE_LSPMUX`        | 如果为 `1`，禁用 lspmux 检测/集成，强制直接生成 LSP 服务器          |
| `LITELLM_BASE_URL`         | LiteLLM 代理基础 URL。与 `LITELLM_API_KEY` 一起设置时，首次运行时触发自动生成 `models.yml`，并在每次启动时进行自我修复 |
| `LM_STUDIO_BASE_URL`       | 默认隐式 LM Studio 发现基础 URL 覆盖（未设置时为 `http://127.0.0.1:1234/v1`） |
| `OLLAMA_BASE_URL`          | 默认隐式 Ollama 发现基础 URL 覆盖（未设置时为 `http://127.0.0.1:11434`）      |
| `LLAMA_CPP_BASE_URL`       | 默认隐式 Llama.cpp 发现基础 URL 覆盖（未设置时为 `http://127.0.0.1:8080`）    |
| `PI_EDIT_VARIANT`          | 如果为 `hashline`，当编辑工具可用时强制使用 hashline 读取/grep 显示模式               |
| `PI_NO_PTY`                | 如果为 `1`，禁用 bash 工具的交互式 PTY 路径                                          |

`PI_NO_PTY` 在使用 CLI `--no-pty` 时也会被内部设置。

---

## 6) 存储和配置根路径

这些变量通过 `@f5xc-salesdemos/pi-utils/dirs` 使用，影响 coding-agent 存储数据的位置。

| 变量 | 默认值 / 行为 |
|---|---|
| `PI_CONFIG_DIR` | 用户主目录下的配置根目录名（默认 `.xcsh`） |
| `PI_CODING_AGENT_DIR` | 代理目录的完整覆盖路径（默认 `~/<PI_CONFIG_DIR or .xcsh>/agent`） |
| `PWD` | 在路径辅助工具中用于匹配规范化的当前工作目录 |

---

## 7) Shell/工具执行环境

（来自 `packages/utils/src/procmgr.ts` 和 coding-agent bash 工具集成。）

| 变量 | 行为 |
|---|---|
| `PI_BASH_NO_CI` | 抑制自动向生成的 shell 环境注入 `CI=true` |
| `CLAUDE_BASH_NO_CI` | `PI_BASH_NO_CI` 的旧版别名备选 |
| `PI_BASH_NO_LOGIN` | 用于禁用登录 shell 模式 |
| `CLAUDE_BASH_NO_LOGIN` | `PI_BASH_NO_LOGIN` 的旧版别名备选 |
| `PI_SHELL_PREFIX` | 可选的命令前缀包装器 |
| `CLAUDE_CODE_SHELL_PREFIX` | `PI_SHELL_PREFIX` 的旧版别名备选 |
| `VISUAL` | 首选外部编辑器命令 |
| `EDITOR` | 备选外部编辑器命令 |

当前实现说明：`PI_BASH_NO_LOGIN`/`CLAUDE_BASH_NO_LOGIN` 会被读取，但当前 `getShellArgs()` 在两个分支中都返回 `['-l','-c']`（目前实际上是无操作）。

---

## 8) UI/主题/会话检测（自动检测的环境变量）

这些变量作为运行时信号被读取；它们通常由终端/操作系统设置，而非手动配置。

| 变量 | 用途 |
|---|---|
| `COLORTERM`、`TERM`、`WT_SESSION` | 颜色能力检测（主题颜色模式） |
| `COLORFGBG` | 终端背景亮/暗自动检测 |
| `TERM_PROGRAM`、`TERM_PROGRAM_VERSION`、`TERMINAL_EMULATOR` | 系统提示/上下文中的终端标识 |
| `KDE_FULL_SESSION`、`XDG_CURRENT_DESKTOP`、`DESKTOP_SESSION`、`XDG_SESSION_DESKTOP`、`GDMSESSION`、`WINDOWMANAGER` | 系统提示/上下文中的桌面/窗口管理器检测 |
| `KITTY_WINDOW_ID`、`TMUX_PANE`、`TERM_SESSION_ID`、`WT_SESSION` | 稳定的每终端会话标识 ID |
| `SHELL`、`ComSpec`、`TERM_PROGRAM`、`TERM` | 系统信息诊断 |
| `APPDATA`、`XDG_CONFIG_HOME` | lspmux 配置路径解析 |
| `HOME` | MCP 命令 UI 中的路径缩短 |

---

## 9) 原生加载器/调试标志

| 变量 | 行为 |
|---|---|
| `PI_DEV` | 在 `packages/natives` 中启用详细的原生插件加载诊断 |

## 10) TUI 运行时标志（共享包，影响 coding-agent 用户体验）

| 变量 | 行为 |
|---|---|
| `PI_NOTIFICATIONS` | `off` / `0` / `false` 抑制桌面通知 |
| `PI_TUI_WRITE_LOG` | 如果设置，将 TUI 写入操作记录到文件 |
| `PI_HARDWARE_CURSOR` | 如果为 `1`，启用硬件光标模式 |
| `PI_CLEAR_ON_SHRINK` | 如果为 `1`，当内容收缩时清除空行 |
| `PI_DEBUG_REDRAW` | 如果为 `1`，启用重绘调试日志 |
| `PI_TUI_DEBUG` | 如果为 `1`，启用深层 TUI 调试转储路径 |

---

## 11) 提交生成控制

| 变量 | 行为 |
|---|---|
| `PI_COMMIT_TEST_FALLBACK` | 如果为 `true`（不区分大小写），强制使用提交备选生成路径 |
| `PI_COMMIT_NO_FALLBACK` | 如果为 `true`，当代理未返回提案时禁用备选 |
| `PI_COMMIT_MAP_REDUCE` | 如果为 `false`，禁用 map-reduce 提交分析路径 |
| `DEBUG` | 如果设置，打印提交代理错误堆栈跟踪 |

---

## 安全敏感变量

请将以下变量视为机密信息；不要记录或提交它们：

- 提供商/API 密钥和 OAuth/持有者凭据（所有 `*_API_KEY`、`*_TOKEN`、OAuth 访问/刷新令牌）
- 云凭据（`AWS_*`，`GOOGLE_APPLICATION_CREDENTIALS` 路径可能暴露服务账号材料）
- 搜索/提供商认证变量（`EXA_API_KEY`、`BRAVE_API_KEY`、`PERPLEXITY_API_KEY`、Anthropic 搜索密钥）
- Foundry mTLS 材料（`CLAUDE_CODE_CLIENT_CERT`、`CLAUDE_CODE_CLIENT_KEY`、`NODE_EXTRA_CA_CERTS` 当指向私有 CA 包时）

Python 运行时在生成内核子进程之前也会显式剥离许多常见的密钥变量（`packages/coding-agent/src/ipy/runtime.ts`）。
