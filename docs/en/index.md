---
title: xcsh Documentation
description: AI-powered development CLI with TypeScript coding agent and Rust native layer for long-lived sessions, MCP support, and platform packaging.
sidebar:
  order: 0
  label: Overview
---

xcsh is an AI-powered development CLI with a TypeScript coding agent and a Rust
native acceleration layer (`pi-natives`). It extends the open-source `badlogic/pi-mono`
foundation with a hardened runtime, long-lived sessions featuring interactive tree
navigation and semantic compaction, Python IPython tooling, complete Model Context
Protocol (MCP) support, an extensible skills engine, and cross-platform packaging for
Linux, macOS, and Windows.

## Languages and localization

Choose your language on the documentation portal:

- [English (en)](https://f5-sales-demo.github.io/docs/)
- [简体中文 (zh-cn)](https://f5-sales-demo.github.io/docs/zh-cn/)
- [繁體中文 (zh-tw)](https://f5-sales-demo.github.io/docs/zh-tw/)
- [Português Brasil (pt-br)](https://f5-sales-demo.github.io/docs/pt-br/)

## Documentation catalog

- **[F5 XC Contexts](runtime-tools/context-command)**: Connect to F5 Distributed Cloud tenants, configure authentication profiles, and manage namespaces.
- **[Container Deployment](container/alpine-deployment)**: Run xcsh inside security-hardened Alpine container images with Docker, Compose, and Podman.
- **[Configuration](configuration/settings)**: Discover, resolve, and layer hierarchical configuration files.
- **[Runtime and Tools](runtime-tools/custom-tools)**: Execute bash commands, Jupyter notebook cells, and custom tool extensions.
- **[Sessions](sessions/session)**: Manage append-only session entry logs, branch trees, context compaction, and long-term memory.
- **[Natives (Rust)](natives/architecture)**: High-performance N-API native bindings powering terminal PTYs, file operations, and fuzzy search.
- **[MCP](mcp/mcp-overview)**: Model Context Protocol transport configuration, server management, and tool bridging.
- **[Extensions and Skills](extensions/extensions)**: Author dynamic plugins, define custom slash commands, and bundle capability skills.
- **[Providers and Models](providers/providers)**: Configure LLM providers, manage token budgets, and inspect model streaming internals.
- **[TUI](tui/tui)**: Terminal user interface mechanics, color theming, and tree visualization.
