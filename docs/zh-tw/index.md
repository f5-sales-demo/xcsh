---
title: xcsh 文件
description: 具備 AI 驅動的開發 CLI，搭配 TypeScript 編碼代理與 Rust 原生層，支援長期會話、MCP 支援及平台打包。
sidebar:
  order: 0
  label: 概覽
i18n:
  sourceHash: b9288f42bf46
  translator: machine
---

xcsh 是一個具備 AI 驅動的開發 CLI，搭配 TypeScript 編碼代理與 Rust 原生層（`pi-natives`）。它延伸了開源專案
[`badlogic/pi-mono`](https://github.com/badlogic/pi-mono)，提供強化的執行環境、具備樹狀導覽與壓縮功能的長期會話、Python IPython 工具、完整的 MCP 支援、技能系統，以及針對 Linux、macOS 和 Windows 的平台打包。

## 從何開始

- **[F5 XC 情境](/runtime-tools/context-command)** — 連線至 F5 Distributed Cloud 租戶。建立情境、切換情境、管理命名空間與憑證。
- **設定** — xcsh 如何探索、解析及分層設定。
- **執行環境與工具** — bash / notebook / resolve 工具執行環境以及斜線命令介面。
- **會話** — 僅附加的項目日誌、樹狀導覽、壓縮，以及自主記憶系統。
- **原生層 (Rust)** — `pi-natives` N-API 附加模組的架構，驅動 shell / PTY / 媒體 / 搜尋功能。
- **MCP** — 設定、協定內部機制、執行時期生命週期，以及如何撰寫伺服器與工具。
- **擴充功能、技能與外掛** — 撰寫、載入、匹配規則、市集，以及外掛安裝程式。
- **供應商與模型** — 模型設定、串流內部機制，以及 Python / IPython 執行環境。
- **TUI** — 主題設定、`/tree` 命令，以及擴充功能與自訂工具的整合掛鉤。

## 本文件集的組織方式

側邊欄中的每個頂層群組對應代理的一個子系統。在群組內，頁面從「概覽」排列至「內部機制」，讓您在取得足夠的任務相關背景後即可停止閱讀。
