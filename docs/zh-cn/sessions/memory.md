---
title: 自主记忆
description: 自主记忆系统，用于跨会话持久化用户偏好、项目上下文和反馈。
sidebar:
  order: 7
  label: 自主记忆
i18n:
  sourceHash: 2aa9f516aa1e
  translator: machine
---

# 自主记忆

启用后，智能体会自动从过往会话中提取持久性知识，并在每个新会话中注入简洁的摘要。随着时间推移，它会构建一个项目级别的记忆存储——包括技术决策、常见工作流、问题陷阱——无需手动操作即可持续积累。

默认关闭。可通过 `/settings` 或 `config.yml` 启用：

```yaml
memories:
  enabled: true
```

## 用法

### 注入的内容

会话开始时，如果当前项目存在记忆摘要，它会作为 **Memory Guidance** 块注入到系统提示中。智能体被指示：

- 将记忆视为启发式上下文——对流程和先前决策有参考价值，但不作为当前仓库状态的权威依据。
- 当记忆改变了计划时，引用记忆产物路径，并在执行前结合当前仓库的证据进行验证。
- 当仓库状态和用户指令与记忆冲突时，优先采用前者；将冲突的记忆视为过时信息。

### 读取记忆产物

智能体可以使用 `read` 工具通过 `memory://` URL 直接读取记忆文件：

| URL | 内容 |
|---|---|
| `memory://root` | 启动时注入的简洁摘要 |
| `memory://root/MEMORY.md` | 完整的长期记忆文档 |
| `memory://root/skills/<name>/SKILL.md` | 生成的技能手册 |

### `/memory` 斜杠命令

| 子命令 | 效果 |
|---|---|
| `view` | 显示当前记忆注入的内容 |
| `clear` / `reset` | 删除所有记忆数据和生成的产物 |
| `enqueue` / `rebuild` | 强制在下次启动时执行合并 |

## 工作原理

记忆由后台管道构建，在启动时或通过斜杠命令手动触发。

**阶段 1 — 逐会话提取：** 对于自上次处理以来发生变化的每个过往会话，模型读取会话历史并提取持久性信号：技术决策、约束条件、已解决的故障、常见工作流。过于近期、过于久远或当前活跃的会话会被跳过。每次提取会生成一个原始记忆块和该会话的简短摘要。

**阶段 2 — 合并：** 提取完成后，第二轮模型处理读取所有逐会话的提取结果，生成三个写入磁盘的输出：

- `MEMORY.md` — 经过整理的长期记忆文档
- `memory_summary.md` — 在会话开始时注入的简洁文本
- `skills/` — 可复用的流程手册，每个位于独立的子目录中

阶段 2 使用租约机制防止多个进程同时启动时重复运行。先前运行产生的过时技能目录会被自动清理。

所有输出在写入磁盘前都会进行密钥扫描。

### 提取行为

记忆提取和合并行为完全由 `src/prompts/memories/` 中的静态提示文件驱动。

| 文件 | 用途 | 变量 |
|---|---|---|
| `stage_one_system.md` | 逐会话提取的系统提示 | — |
| `stage_one_input.md` | 包装会话内容的用户轮模板 | `{{thread_id}}`、`{{response_items_json}}` |
| `consolidation.md` | 跨会话合并的提示 | `{{raw_memories}}`、`{{rollout_summaries}}` |
| `read_path.md` | 注入到实时会话中的记忆指导 | `{{memory_summary}}` |

### 模型选择

记忆功能依托于模型角色系统。

| 阶段 | 角色 | 用途 |
|---|---|---|
| 阶段 1（提取） | `default` | 逐会话知识提取 |
| 阶段 2（合并） | `smol` | 跨会话综合 |

如果未配置 `smol`，阶段 2 会回退到 `default` 角色。

## 配置

| 设置 | 默认值 | 描述 |
|---|---|---|
| `memories.enabled` | `false` | 主开关 |
| `memories.maxRolloutAgeDays` | `30` | 超过此天数的会话不会被处理 |
| `memories.minRolloutIdleHours` | `12` | 最近活跃时间在此小时数内的会话会被跳过 |
| `memories.maxRolloutsPerStartup` | `64` | 单次启动时处理的会话数上限 |
| `memories.summaryInjectionTokenLimit` | `5000` | 注入系统提示的摘要最大 token 数 |

高级用途中还可通过配置调整额外的参数（并发数、租约时长、token 预算）。

## 关键文件

- `src/memories/index.ts` — 管道编排、注入、斜杠命令处理
- `src/memories/storage.ts` — 基于 SQLite 的任务队列和线程注册
- `src/prompts/memories/` — 记忆提示模板
- `src/internal-urls/memory-protocol.ts` — `memory://` URL 处理器
