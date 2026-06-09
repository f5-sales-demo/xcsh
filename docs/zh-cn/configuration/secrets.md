---
title: 敏感信息混淆
description: 敏感信息混淆管道，用于从会话日志和输出中编辑敏感值。
sidebar:
  order: 3
  label: 敏感信息
i18n:
  sourceHash: 1d9dc101c614
  translator: machine
---

# 敏感信息混淆

防止敏感值（API 密钥、令牌、密码）被发送到 LLM 提供商。启用后，敏感信息在离开进程前会被替换为确定性占位符，并在模型返回的工具调用参数中恢复原始值。

## 启用

默认启用。可通过 `/settings` 界面或直接在 `config.yml` 中切换：

```yaml
secrets:
  enabled: false
```

## 工作原理

1. 在会话启动时，从两个来源收集敏感信息：
   - **环境变量**：匹配常见敏感信息模式（`*_KEY`、`*_SECRET`、`*_TOKEN`、`*_PASSWORD` 等），且值长度 >= 8 个字符
   - **`secrets.yml` 文件**（见下文）

2. 发送给 LLM 的出站消息中，所有敏感值会被替换为占位符，如 `<<$env:S0>>`、`<<$env:S1>>` 等。

3. 模型返回的工具调用参数会被深度遍历，占位符在执行前恢复为原始值。

两种模式控制每个敏感信息的处理方式：

| 模式 | 行为 | 可逆 |
|---|---|---|
| `obfuscate`（默认） | 替换为索引占位符 `<<$env:SN>>` | 是（在工具参数中反混淆） |
| `replace` | 替换为确定性的等长字符串 | 否（单向） |

## secrets.yml

在 YAML 中定义自定义敏感信息条目。检查两个位置：

| 级别 | 路径 | 用途 |
|---|---|---|
| 全局 | `~/.xcsh/agent/secrets.yml` | 跨所有项目的敏感信息 |
| 项目 | `<cwd>/.xcsh/secrets.yml` | 项目特定的敏感信息 |

项目级条目会覆盖具有匹配 `content` 的全局条目。

### 模式定义

数组中每个条目包含以下字段：

| 字段 | 类型 | 必填 | 描述 |
|---|---|---|---|
| `type` | `"plain"` 或 `"regex"` | 是 | 匹配策略 |
| `content` | string | 是 | 敏感值（plain 类型）或正则表达式模式（regex 类型） |
| `mode` | `"obfuscate"` 或 `"replace"` | 否 | 默认：`"obfuscate"` |
| `replacement` | string | 否 | 自定义替换值（仅 replace 模式） |
| `flags` | string | 否 | 正则表达式标志（仅 regex 类型） |

### 示例

#### 纯文本敏感信息

```yaml
# Obfuscate a specific API key (default mode)
- type: plain
  content: sk-proj-abc123def456

# Replace a database password with a fixed string
- type: plain
  content: hunter2
  mode: replace
  replacement: "********"
```

#### 正则表达式敏感信息

```yaml
# Obfuscate any AWS-style key
- type: regex
  content: "AKIA[0-9A-Z]{16}"

# Case-insensitive match with explicit flags
- type: regex
  content: "api[_-]?key\\s*=\\s*\\w+"
  flags: "i"

# Regex literal syntax (pattern and flags in one string)
- type: regex
  content: "/bearer\\s+[a-zA-Z0-9._~+\\/=-]+/i"
```

正则表达式条目始终进行全局扫描（`g` 标志会自动强制启用）。支持正则字面量语法 `/pattern/flags` 作为分别使用 `content` + `flags` 字段的替代方式。模式中的转义斜杠（`\\/`）会被正确处理。

#### 使用正则表达式的 replace 模式

```yaml
# One-way replace connection strings (not reversible)
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## 与环境变量检测的交互

环境变量始终最先被收集。文件定义的条目在之后追加，因此文件条目可以覆盖不存在于环境变量中的敏感信息（配置文件、硬编码值等）。如果相同的值同时出现在两者中，文件条目的模式优先。

## 关键文件

- `src/secrets/index.ts` -- 加载、合并、环境变量收集
- `src/secrets/obfuscator.ts` -- `SecretObfuscator` 类、占位符生成、消息混淆
- `src/secrets/regex.ts` -- 正则字面量解析和编译
- `src/config/settings-schema.ts` -- `secrets.enabled` 设置定义
