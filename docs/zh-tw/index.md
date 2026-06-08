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

xcsh 是一個 AI 驅動的開發 CLI，搭配 TypeScript 編碼代理與 Rust 原生層（`pi-natives`）。它擴展了開源的
[`badlogic/pi-mono`](https://github.com/badlogic/pi-mono) 系列，提供
強化的執行環境、具備樹狀導覽與壓縮功能的長期會話、Python IPython 工具、完整的 MCP 支援、技能系統，以及針對 Linux、macOS 和 Windows 的平台打包。

## 從哪裡開始

- **[F5 XC 情境](/runtime-tools/context-command)** — 連接至 F5 Distributed Cloud
  租戶。建立情境、在情境間切換、管理命名空間與憑證。
- **組態設定** — xcsh 如何探索、解析及分層組態設定。
- **執行環境與工具** — bash / notebook / resolve 工具執行環境以及
  斜線命令介面。
- **會話** — 僅附加的條目日誌、樹狀導覽、壓縮，以及
  自主記憶系統。
- **原生層 (Rust)** — 驅動 shell / PTY / 媒體 / 搜尋功能的 `pi-natives` N-API 附加模組架構。
- **MCP** — 組態設定、協定內部機制、執行環境生命週期，以及如何
  撰寫伺服器與工具。
- **擴充功能、技能與外掛** — 撰寫、載入、匹配規則、
  市集，以及外掛安裝程式。
- **供應商與模型** — 模型組態設定、串流內部機制，以及
  Python / IPython 執行環境。
- **TUI** — 主題設定、`/tree` 命令，以及擴充功能
  與自訂工具的整合掛鉤。

## 本文件集的組織方式

側邊欄中的每個頂層群組對應代理的一個子系統。在每個群組內，頁面從「概覽」排列到「內部機制」，因此您可以在獲得足夠的背景資訊後隨時停止閱讀。
