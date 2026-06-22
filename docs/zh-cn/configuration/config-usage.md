---
title: 配置发现与解析
description: xcsh 如何从项目、用户和企业根目录发现、解析和分层配置。
sidebar:
  order: 1
  label: 配置
i18n:
  sourceHash: e38bd9792499
  translator: machine
---

# 配置发现与解析

本文档描述了 coding-agent 当前如何解析配置：扫描哪些根目录、优先级如何运作，以及已解析的配置如何被设置、技能、钩子、工具和扩展所使用。

## 范围

主要实现：

- `src/config.ts`
- `src/config/settings.ts`
- `src/config/settings-schema.ts`
- `src/discovery/builtin.ts`
- `src/discovery/helpers.ts`

关键集成点：

- `src/capability/index.ts`
- `src/discovery/index.ts`
- `src/extensibility/skills.ts`
- `src/extensibility/hooks/loader.ts`
- `src/extensibility/custom-tools/loader.ts`
- `src/extensibility/extensions/loader.ts`

---

## 解析流程（可视化）

```text
         Config roots (ordered)
┌───────────────────────────────────────┐
│ 1) ~/.xcsh/agent + <cwd>/.xcsh          │
│ 2) ~/.claude   + <cwd>/.claude        │
│ 3) ~/.codex    + <cwd>/.codex         │
│ 4) ~/.gemini   + <cwd>/.gemini        │
└───────────────────────────────────────┘
                    │
                    ▼
        config.ts helper resolution
  (getConfigDirs/findConfigFile/findNearest...)
                    │
                    ▼
       capability providers enumerate items
 (native, claude, codex, gemini, agents, etc.)
                    │
                    ▼
      priority sort + per-capability dedup
                    │
                    ▼
          subsystem-specific consumption
   (settings, skills, hooks, tools, extensions)
```

## 1) 配置根目录与来源顺序

## 规范根目录

`src/config.ts` 定义了一个固定的来源优先级列表：

1. `.xcsh`（原生）
2. `.claude`
3. `.codex`
4. `.gemini`

用户级基础目录：

- `~/.xcsh/agent`
- `~/.claude`
- `~/.codex`
- `~/.gemini`

项目级基础目录：

- `<cwd>/.xcsh`
- `<cwd>/.claude`
- `<cwd>/.codex`
- `<cwd>/.gemini`

`CONFIG_DIR_NAME` 为 `.xcsh`（`packages/utils/src/dirs.ts`）。

## 重要约束

`src/config.ts` 中的通用辅助函数在来源发现顺序中**不**包含 `.pi`。

---

## 2) 核心发现辅助函数（`src/config.ts`）

## `getConfigDirs(subpath, options)`

返回有序条目：

- 用户级条目优先（按来源优先级排序）
- 然后是项目级条目（按相同来源优先级排序）

选项：

- `user`（默认 `true`）
- `project`（默认 `true`）
- `cwd`（默认 `getProjectDir()`）
- `existingOnly`（默认 `false`）

此 API 用于基于目录的配置查找（命令、钩子、工具、代理等）。

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

在有序的基础目录中搜索第一个存在的文件，返回第一个匹配项（仅路径或路径+元数据）。

## `findAllNearestProjectConfigDirs(subpath, cwd)`

向上遍历父目录，返回**每个来源基础目录最近的现有目录**（`.xcsh`、`.claude`、`.codex`、`.gemini`），然后按来源优先级排序结果。

当项目配置需要从祖先目录继承时使用此函数（monorepo/嵌套工作区行为）。

---

## 3) 文件配置包装器（`src/config.ts` 中的 `ConfigFile<T>`）

`ConfigFile<T>` 是用于单个配置文件的带模式验证的加载器。

支持的格式：

- `.yml` / `.yaml`
- `.json` / `.jsonc`

行为：

- 使用 AJV 根据提供的 TypeBox 模式验证解析后的数据。
- 缓存加载结果直到调用 `invalidate()`。
- 通过 `tryLoad()` 返回三态结果：
  - `ok`
  - `not-found`
  - `error`（包含模式/解析上下文的 `ConfigError`）

仍支持遗留迁移：

- 如果目标路径是 `.yml`/`.yaml`，同级 `.json` 文件会被自动迁移一次（`migrateJsonToYml`）。

---

## 4) 设置解析模型（`src/config/settings.ts`）

运行时设置模型是分层的：

1. 全局设置：`~/.xcsh/agent/config.yml`
2. 项目设置：通过设置能力发现（来自提供者的 `settings.json`）
3. 运行时覆盖：内存中，非持久化
4. 模式默认值：来自 `SETTINGS_SCHEMA`

有效读取路径：

`defaults <- global <- project <- overrides`

写入行为：

- `settings.set(...)` 写入**全局**层（`config.yml`）并排队后台保存。
- 项目设置从能力发现中只读获取。

## 迁移行为仍然活跃

启动时，如果 `config.yml` 不存在：

1. 从 `~/.xcsh/agent/settings.json` 迁移（成功后重命名为 `.bak`）
2. 与 `agent.db` 中的遗留数据库设置合并
3. 将合并结果写入 `config.yml`

`#migrateRawSettings` 中的字段级迁移：

- `queueMode` -> `steeringMode`
- `ask.timeout` 毫秒 -> 秒（当旧值看起来像毫秒时，即 `> 1000`）
- 遗留的扁平 `theme: "..."` -> `theme.dark/theme.light` 结构

---

## 5) 能力/发现集成

大多数非核心配置加载通过能力注册表（`src/capability/index.ts` + `src/discovery/index.ts`）进行。

## 提供者排序

提供者按数值优先级排序（越高越优先）。示例优先级：

- 原生 OMP（`builtin.ts`）：`100`
- Claude：`80`
- Codex / agents / Claude marketplace：`70`
- Gemini：`60`

```text
Provider precedence (higher wins)

native (.xcsh)          priority 100
claude                 priority  80
codex / agents / ...   priority  70
gemini                 priority  60
```

## 去重语义

能力定义了一个 `key(item)`：

- 相同 key => 第一个项目胜出（更高优先级/更早加载的项目）
- 无 key（`undefined`）=> 不去重，保留所有项目

相关键：

- 技能：`name`
- 工具：`name`
- 钩子：`${type}:${tool}:${name}`
- 扩展模块：`name`
- 扩展：`name`
- 设置：不去重（保留所有项目）

---

## 6) 原生 `.xcsh` 提供者行为（`src/discovery/builtin.ts`）

原生提供者（`id: native`）从以下位置读取：

- 项目：`<cwd>/.xcsh/...`
- 用户：`~/.xcsh/agent/...`

### 目录准入规则

`builtin.ts` 仅在目录存在**且非空**（`ifNonEmptyDir`）时才包含配置根目录。

### 按作用域加载

- 技能：`skills/*/SKILL.md`
- 斜杠命令：`commands/*.md`
- 规则：`rules/*.{md,mdc}`
- 提示词：`prompts/*.md`
- 指令：`instructions/*.md`
- 钩子：`hooks/pre/*`、`hooks/post/*`
- 工具：`tools/*.json|*.md` 和 `tools/<name>/index.ts`
- 扩展模块：在 `extensions/` 下发现（+ 遗留的 `settings.json.extensions` 字符串数组）
- 扩展：`extensions/<name>/gemini-extension.json`
- 设置能力：`settings.json`

### 最近项目查找的细微差别

对于 `SYSTEM.md` 和 `XCSH.md`，原生提供者使用最近祖先项目 `.xcsh` 目录搜索（向上遍历），但仍然要求 `.xcsh` 目录非空。

---

## 7) 主要子系统如何消费配置

## 设置子系统

- `Settings.init()` 加载全局 `config.yml` + 已发现的项目 `settings.json` 能力项。
- 仅 `level === "project"` 的能力项会被合并到项目层。

## 技能子系统

- `extensibility/skills.ts` 通过 `loadCapability(skillCapability.id, { cwd })` 加载。
- 应用来源开关和过滤器（`ignoredSkills`、`includeSkills`、自定义目录）。
- 遗留命名的开关仍然存在（`skills.enablePiUser`、`skills.enablePiProject`），但它们控制原生提供者（`provider === "native"`）。

## 钩子子系统

- `discoverAndLoadHooks()` 从钩子能力 + 显式配置路径解析钩子路径。
- 然后通过 Bun import 加载模块。

## 工具子系统

- `discoverAndLoadCustomTools()` 从工具能力 + 插件工具路径 + 显式配置路径解析工具路径。
- 声明式 `.md/.json` 工具文件仅为元数据；可执行加载需要代码模块。

## 扩展子系统

- `discoverAndLoadExtensions()` 从扩展模块能力加上显式路径解析扩展模块。
- 当前实现在加载前有意只保留 `_source.provider === "native"` 的能力项。

---

## 8) 可依赖的优先级规则

使用以下心智模型：

1. `config.ts` 中的来源目录排序决定候选路径顺序。
2. 能力提供者优先级决定跨提供者的优先顺序。
3. 能力键去重决定冲突行为（对于有键的能力，第一个胜出）。
4. 子系统特定的合并逻辑可以进一步改变有效优先级（特别是设置）。

### 设置相关的注意事项

设置能力项不会被去重；`Settings.#loadProjectSettings()` 按返回顺序对项目项进行深度合并。因为合并会将后面项的值覆盖前面项的值，有效的覆盖行为取决于提供者的发出顺序，而不仅仅是能力键语义。

---

## 9) 仍然存在的遗留/兼容性行为

- `ConfigFile` 对以 YAML 为目标的文件进行 JSON -> YAML 迁移。
- 设置从 `settings.json` 和 `agent.db` 迁移到 `config.yml`。
- 设置键迁移（`queueMode`、`ask.timeout`、扁平 `theme`）。
- 扩展清单兼容性：加载器同时接受 `package.json.xcsh` 和 `package.json.pi` 清单部分。
- 遗留设置名称 `skills.enablePiUser` / `skills.enablePiProject` 仍然是原生技能来源的活跃控制开关。

如果这些兼容性路径在代码中被移除，请立即更新本文档；目前有多个运行时行为仍然依赖于它们。
