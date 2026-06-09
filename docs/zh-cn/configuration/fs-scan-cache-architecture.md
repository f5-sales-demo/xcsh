---
title: 文件系统扫描缓存架构
description: 文件系统扫描缓存契约，支持快速文件发现和 stale-while-revalidate 语义。
sidebar:
  order: 8
  label: 文件系统扫描缓存
i18n:
  sourceHash: 2a2bde1726ac
  translator: machine
---

# 文件系统扫描缓存架构契约

本文档定义了在 Rust 中实现的共享文件系统扫描缓存（`crates/pi-natives/src/fs_cache.rs`）的当前契约，该缓存被暴露给 `packages/coding-agent` 的原生发现/搜索 API 所消费。

## 该缓存是什么

该缓存存储完整的目录扫描条目列表（`GlobMatch[]`），以扫描范围和遍历策略作为键，然后让更高层的操作（glob 过滤、模糊评分、grep 文件选择）基于这些缓存条目运行。

主要目标：

- 避免对重复的发现/搜索调用执行重复的文件系统遍历
- 当 `glob`、`fuzzyFind` 和 `grep` 共享相同的扫描策略时保持一致性
- 允许对空结果进行显式过期恢复，以及在文件变更后进行显式失效处理

## 所有权和公共接口

- 缓存实现和策略：`crates/pi-natives/src/fs_cache.rs`
- 原生消费者：
  - `crates/pi-natives/src/glob.rs`
  - `crates/pi-natives/src/fd.rs`（`fuzzyFind`）
  - `crates/pi-natives/src/grep.rs`
- JS 绑定/导出：
  - `packages/natives/src/glob/index.ts`（`invalidateFsScanCache`）
  - `packages/natives/src/glob/types.ts`
  - `packages/natives/src/grep/types.ts`
- Coding-agent 变更失效辅助函数：
  - `packages/coding-agent/src/tools/fs-cache-invalidation.ts`

## 缓存键分区（硬性契约）

每个条目以以下内容为键：

- 规范化的 `root` 目录路径
- `include_hidden` 布尔值
- `use_gitignore` 布尔值

含义：

- 隐藏文件扫描和非隐藏文件扫描**不会**共享条目。
- 遵守 gitignore 的扫描和禁用 ignore 的扫描**不会**共享条目。
- 消费者必须为隐藏文件/gitignore 行为传递稳定的语义；更改任一标志将创建不同的缓存分区。

`node_modules` 包含与否**不在**缓存键中。缓存存储包含 `node_modules` 的条目；每个消费者在检索后自行应用过滤。

## 扫描收集行为

缓存填充使用由 `include_hidden` 和 `use_gitignore` 配置的确定性遍历器（`ignore::WalkBuilder`）：

- `follow_links(false)`
- 按文件路径排序
- `.git` 始终被跳过
- `node_modules` 在缓存扫描时始终被收集（之后可选择性地过滤）
- 条目的文件类型和 `mtime` 通过 `symlink_metadata` 捕获

搜索根路径通过 `resolve_search_path` 解析：

- 相对路径基于当前 cwd 解析
- 目标必须是现有目录
- 根路径在可能时进行规范化

## 新鲜度和逐出策略

全局策略（可通过环境变量覆盖）：

- `FS_SCAN_CACHE_TTL_MS`（默认 `1000`）
- `FS_SCAN_EMPTY_RECHECK_MS`（默认 `200`）
- `FS_SCAN_CACHE_MAX_ENTRIES`（默认 `16`）

行为：

- `get_or_scan(...)`
  - 如果 TTL 为 `0`：完全绕过缓存，始终执行新鲜扫描（`cache_age_ms = 0`）
  - 在 TTL 内命中缓存时：返回缓存条目 + 非零 `cache_age_ms`
  - 命中过期条目时：逐出键，重新扫描，存储新鲜条目
- 最大条目数执行基于 `created_at` 的最旧优先逐出

## 空结果快速重检（独立于正常命中）

正常缓存命中：

- 在 TTL 内的缓存命中返回缓存条目，不做其他操作。

空结果快速重检：

- 这是使用 `ScanResult.cache_age_ms` 的**调用方**策略
- 如果过滤/查询结果为空且缓存扫描年龄至少达到 `empty_recheck_ms()`，调用方执行一次 `force_rescan(...)` 并重试
- 旨在减少文件最近添加但缓存仍在 TTL 内时的过期否定结果

当前消费者：

- `glob`：当过滤匹配为空且扫描年龄超过阈值时重检
- `fuzzyFind`（`fd.rs`）：仅当查询非空且评分匹配为空时重检
- `grep`：当选定的候选文件列表为空时重检

## 消费者默认值和缓存使用

缓存在所有暴露的 API 上为可选启用（`cache?: boolean`，默认 `false`）。

原生 API 中的当前默认值：

- `glob`：`hidden=false`，`gitignore=true`，`cache=false`
- `fuzzyFind`：`hidden=false`，`gitignore=true`，`cache=false`
- `grep`：`hidden=true`，`cache=false`，且缓存扫描始终使用 `use_gitignore=true`

当前 Coding-agent 调用方：

- 高频提及候选发现启用缓存：
  - `packages/coding-agent/src/utils/file-mentions.ts`
  - 配置：`hidden=true`，`gitignore=true`，`includeNodeModules=true`，`cache=true`
- 工具级 `grep` 集成当前禁用扫描缓存（`cache: false`）：
  - `packages/coding-agent/src/tools/grep.ts`

## 失效契约

原生失效入口点：

- `invalidateFsScanCache(path?: string)`
  - 带 `path`：移除根路径是目标路径前缀的缓存条目
  - 不带 path：清除所有扫描缓存条目

路径处理细节：

- 相对失效路径基于 cwd 解析
- 失效操作尝试规范化
- 如果目标不存在（例如删除操作），回退为规范化父目录并在可能时重新附加文件名
- 这为创建/删除/重命名等一侧可能不存在的情况保留了失效行为

## Coding-agent 变更流职责

Coding-agent 代码必须在成功的文件系统变更后进行失效处理。

核心辅助函数：

- `invalidateFsScanAfterWrite(path)`
- `invalidateFsScanAfterDelete(path)`
- `invalidateFsScanAfterRename(oldPath, newPath)`（当路径不同时失效两侧）

当前变更工具调用点：

- `packages/coding-agent/src/tools/write.ts`
- `packages/coding-agent/src/patch/index.ts`（hashline/patch/replace 流程）

规则：如果某个流程变更了文件系统内容或位置并绕过了这些辅助函数，则预期会出现缓存过期问题。

## 安全地添加新的缓存消费者

在新的扫描器/搜索路径中引入缓存使用时：

1. **使用稳定的扫描策略输入**
   - 首先确定隐藏文件/gitignore 语义
   - 将它们一致地传递给 `get_or_scan`/`force_rescan`，使缓存分区是有意为之的

2. **将缓存数据视为仅按遍历策略预过滤**
   - 在检索后应用工具特定的过滤（glob 模式、类型过滤器、node_modules 规则）
   - 永远不要假设缓存条目已经反映了你的高层过滤器

3. **仅在有过期否定风险时实现空结果快速重检**
   - 使用 `scan.cache_age_ms >= empty_recheck_ms()`
   - 使用 `force_rescan(..., store=true, ...)` 重试一次
   - 将此路径与正常缓存命中逻辑分开

4. **显式遵守无缓存模式**
   - 当调用方禁用缓存时，调用 `force_rescan(..., store=false, ...)`
   - 不要在无缓存请求路径中填充共享缓存

5. **为任何新的写入路径连接变更失效**
   - 在成功的写入/编辑/删除/重命名后，调用 coding-agent 失效辅助函数
   - 对于重命名/移动，失效旧路径和新路径

6. **不要添加每次调用的 TTL 旋钮**
   - 当前契约仅支持全局策略（通过环境变量配置），不支持每请求 TTL 覆盖

## 已知边界

- 缓存范围是进程本地内存（`DashMap`），不会跨进程重启持久化。
- 缓存存储的是扫描条目，而非最终工具结果。
- `glob`/`fuzzyFind`/`grep` 仅在键维度（`root`、`hidden`、`gitignore`）匹配时共享扫描条目。
- `.git` 在扫描收集时始终被排除，无论调用方选项如何。
