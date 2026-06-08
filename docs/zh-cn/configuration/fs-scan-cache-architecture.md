---
title: 文件系统扫描缓存架构
description: 文件系统扫描缓存契约，用于快速文件发现，支持 stale-while-revalidate 语义。
sidebar:
  order: 8
  label: 文件系统扫描缓存
i18n:
  sourceHash: 2a2bde1726ac
  translator: machine
---

# 文件系统扫描缓存架构契约

本文档定义了在 Rust 中实现的共享文件系统扫描缓存（`crates/pi-natives/src/fs_cache.rs`）的当前契约，该缓存被暴露给 `packages/coding-agent` 的原生发现/搜索 API 所使用。

## 此缓存是什么

缓存存储完整的目录扫描条目列表（`GlobMatch[]`），以扫描范围和遍历策略为键，然后让更高层的操作（glob 过滤、模糊评分、grep 文件选择）基于这些缓存条目运行。

主要目标：

- 避免重复的发现/搜索调用导致重复的文件系统遍历
- 当 `glob`、`fuzzyFind` 和 `grep` 共享相同的扫描策略时，保持它们之间的一致性
- 允许对空结果进行显式的过期恢复，以及在文件变更后进行显式失效

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

每个条目的键由以下部分组成：

- 规范化的 `root` 目录路径
- `include_hidden` 布尔值
- `use_gitignore` 布尔值

含义：

- 隐藏文件扫描和非隐藏文件扫描**不**共享条目。
- 遵循 gitignore 的扫描和禁用 ignore 的扫描**不**共享条目。
- 消费者必须为 hidden/gitignore 行为传递稳定的语义；更改任一标志都会创建不同的缓存分区。

`node_modules` 的包含**不**在缓存键中。缓存存储包含 `node_modules` 的条目；按消费者的过滤在检索后应用。

## 扫描收集行为

缓存填充使用确定性遍历器（`ignore::WalkBuilder`），由 `include_hidden` 和 `use_gitignore` 配置：

- `follow_links(false)`
- 按文件路径排序
- `.git` 始终被跳过
- `node_modules` 在缓存扫描时始终被收集（后续可选过滤）
- 通过 `symlink_metadata` 捕获条目文件类型和 `mtime`

搜索根路径由 `resolve_search_path` 解析：

- 相对路径基于当前 cwd 解析
- 目标必须是已存在的目录
- 根路径在可能的情况下会被规范化

## 新鲜度和驱逐策略

全局策略（可通过环境变量覆盖）：

- `FS_SCAN_CACHE_TTL_MS`（默认 `1000`）
- `FS_SCAN_EMPTY_RECHECK_MS`（默认 `200`）
- `FS_SCAN_CACHE_MAX_ENTRIES`（默认 `16`）

行为：

- `get_or_scan(...)`
  - 如果 TTL 为 `0`：完全绕过缓存，始终进行全新扫描（`cache_age_ms = 0`）
  - 在 TTL 内命中缓存：返回缓存条目 + 非零 `cache_age_ms`
  - 过期命中时：驱逐该键，重新扫描，存储新条目
- 最大条目数强制执行时按 `created_at` 从最旧的开始驱逐

## 空结果快速重检（与正常命中分开）

正常缓存命中：

- TTL 内的缓存命中返回缓存条目，不做其他操作。

空结果快速重检：

- 这是一个**调用方侧**的策略，使用 `ScanResult.cache_age_ms`
- 如果过滤/查询结果为空且缓存扫描年龄至少达到 `empty_recheck_ms()`，调用方执行一次 `force_rescan(...)` 并重试
- 旨在减少文件最近添加但缓存仍在 TTL 内时的过期否定结果

当前消费者：

- `glob`：当过滤匹配为空且扫描年龄超过阈值时重检
- `fuzzyFind`（`fd.rs`）：仅当查询非空且评分匹配为空时重检
- `grep`：当选定的候选文件列表为空时重检

## 消费者默认值和缓存使用

缓存在所有暴露的 API 上都是可选启用的（`cache?: boolean`，默认 `false`）。

原生 API 中的当前默认值：

- `glob`：`hidden=false`、`gitignore=true`、`cache=false`
- `fuzzyFind`：`hidden=false`、`gitignore=true`、`cache=false`
- `grep`：`hidden=true`、`cache=false`，且缓存扫描始终使用 `use_gitignore=true`

当前 Coding-agent 调用方：

- 高频提及候选发现启用缓存：
  - `packages/coding-agent/src/utils/file-mentions.ts`
  - 配置：`hidden=true`、`gitignore=true`、`includeNodeModules=true`、`cache=true`
- 工具级 `grep` 集成当前禁用扫描缓存（`cache: false`）：
  - `packages/coding-agent/src/tools/grep.ts`

## 失效契约

原生失效入口：

- `invalidateFsScanCache(path?: string)`
  - 带 `path`：移除根路径是目标路径前缀的缓存条目
  - 不带路径：清除所有扫描缓存条目

路径处理细节：

- 相对失效路径基于 cwd 解析
- 失效操作会尝试规范化
- 如果目标不存在（例如删除操作），回退时会规范化父目录并在可能的情况下重新附加文件名
- 这保留了创建/删除/重命名场景下的失效行为，其中一侧可能不存在

## Coding-agent 变更流程职责

Coding-agent 代码必须在成功的文件系统变更后进行失效操作。

核心辅助函数：

- `invalidateFsScanAfterWrite(path)`
- `invalidateFsScanAfterDelete(path)`
- `invalidateFsScanAfterRename(oldPath, newPath)`（当路径不同时失效两侧）

当前变更工具调用点：

- `packages/coding-agent/src/tools/write.ts`
- `packages/coding-agent/src/patch/index.ts`（hashline/patch/replace 流程）

规则：如果某个流程变更了文件系统内容或位置但绕过了这些辅助函数，预期会出现缓存过期 bug。

## 安全添加新的缓存消费者

在新的扫描器/搜索路径中引入缓存使用时：

1. **使用稳定的扫描策略输入**
   - 先确定 hidden/gitignore 语义
   - 一致地传递给 `get_or_scan`/`force_rescan`，使缓存分区是有意为之的

2. **将缓存数据视为仅按遍历策略预过滤的**
   - 在检索后应用工具特定的过滤（glob 模式、类型过滤、node_modules 规则）
   - 不要假设缓存条目已经反映了你更高层的过滤器

3. **仅在存在过期否定风险时实现空结果快速重检**
   - 使用 `scan.cache_age_ms >= empty_recheck_ms()`
   - 通过 `force_rescan(..., store=true, ...)` 重试一次
   - 将此路径与正常缓存命中逻辑分开

4. **显式遵守无缓存模式**
   - 当调用方禁用缓存时，调用 `force_rescan(..., store=false, ...)`
   - 不要在无缓存请求路径中填充共享缓存

5. **为任何新的写入路径接入变更失效**
   - 在成功的写入/编辑/删除/重命名后，调用 coding-agent 失效辅助函数
   - 对于重命名/移动，失效旧路径和新路径

6. **不要添加按调用的 TTL 旋钮**
   - 当前契约仅支持全局策略（通过环境变量配置），不支持按请求的 TTL 覆盖

## 已知边界

- 缓存范围是进程本地内存中的（`DashMap`），不会跨进程重启持久化。
- 缓存存储扫描条目，而非最终工具结果。
- `glob`/`fuzzyFind`/`grep` 仅在键维度（`root`、`hidden`、`gitignore`）匹配时共享扫描条目。
- `.git` 在扫描收集时始终被排除，与调用方选项无关。
