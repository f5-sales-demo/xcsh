---
title: xcsh 文档
description: 基于 AI 的开发 CLI，集成 TypeScript 编码代理和 Rust 原生层，支持长期会话、MCP 支持及平台打包。
sidebar:
  order: 0
  label: 概述
i18n:
  sourceHash: b9288f42bf46
  translator: machine
---

xcsh 是一个基于 AI 的开发 CLI，集成了 TypeScript 编码代理和 Rust 原生层（`pi-natives`）。它扩展了开源项目
[`badlogic/pi-mono`](https://github.com/badlogic/pi-mono)，提供了强化运行时、支持树导航和压缩的长期会话、Python IPython 工具、完整的 MCP 支持、技能系统，以及面向 Linux、macOS 和 Windows 的平台打包能力。

## 从何开始

- **[F5 XC 上下文](/runtime-tools/context-command)** — 连接到 F5 分布式云租户。创建上下文、在上下文之间切换、管理命名空间和凭证。
- **配置** — xcsh 如何发现、解析和分层配置。
- **运行时与工具** — bash / notebook / resolve 工具运行时以及斜杠命令接口。
- **会话** — 仅追加的条目日志、树导航、压缩以及自主记忆系统。
- **原生层（Rust）** — `pi-natives` N-API 插件的架构，为 shell / PTY / 媒体 / 搜索提供支持。
- **MCP** — 配置、协议内部机制、运行时生命周期，以及如何编写服务器和工具。
- **扩展、技能与插件** — 编写、加载、匹配规则、市场以及插件安装器。
- **提供商与模型** — 模型配置、流式处理内部机制以及 Python / IPython 运行时。
- **TUI** — 主题设置、`/tree` 命令，以及扩展和自定义工具的集成钩子。

## 本文档集的组织方式

侧边栏中的每个顶级分组对应代理的一个子系统。在每个分组内，页面按照从"概述"到"内部机制"的顺序排列，因此您可以在获取到足够的上下文后随时停止阅读。
