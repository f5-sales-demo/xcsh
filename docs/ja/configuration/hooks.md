---
title: Hooks
description: コーディングエージェントのライフサイクルにおけるイベント前後の自動化のためのフックシステム。
sidebar:
  order: 4
  label: Hooks
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# Hooks

このドキュメントでは、`src/extensibility/hooks/*` にある**現在のフックサブシステムのコード**について説明します。

## ランタイムにおける現在の状態

フックパッケージ（`src/extensibility/hooks/`）は引き続きエクスポートされ、APIサーフェスとして使用可能ですが、デフォルトのCLIランタイムは現在 **extension runner** パスで初期化されます。現在の起動フローでは：

- `--hook` は `--extension` のエイリアスとして扱われます（CLIパスは `additionalExtensionPaths` にマージされます）
- ツールは `HookToolWrapper` ではなく `ExtensionToolWrapper` でラップされます
- コンテキスト変換とライフサイクルの発行は `ExtensionRunner` を通じて行われます

したがって、このファイルではフックサブシステムの実装そのもの（型/ローダー/ランナー/ラッパー）について、レガシーの動作と制約を含めて文書化しています。

## 主要ファイル

- `src/extensibility/hooks/types.ts` — フックコンテキスト、イベント型、結果コントラクト
- `src/extensibility/hooks/loader.ts` — モジュールローディングとフックディスカバリーブリッジ
- `src/extensibility/hooks/runner.ts` — イベントディスパッチ、コマンドルックアップ、エラーシグナリング
- `src/extensibility/hooks/tool-wrapper.ts` — ツールの前後インターセプションラッパー
- `src/extensibility/hooks/index.ts` — エクスポート/再エクスポート

## フックモジュールとは

フックモジュールはファクトリをデフォルトエクスポートする必要があります：

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function hook(pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && String(event.input.command ?? "").includes("rm -rf")) {
   return { block: true, reason: "blocked by policy" };
  }
 });
}
```

ファクトリでは以下のことが可能です：

- `pi.on(...)` でイベントハンドラを登録する
- `pi.sendMessage(...)` で永続的なカスタムメッセージを送信する
- `pi.appendEntry(...)` で非LLM状態を永続化する
- `pi.registerCommand(...)` でスラッシュコマンドを登録する
- `pi.registerMessageRenderer(...)` でカスタムメッセージレンダラーを登録する
- `pi.exec(...)` でシェルコマンドを実行する

## ディスカバリーとローディング

`discoverAndLoadHooks(configuredPaths, cwd)` は以下を行います：

1. ケイパビリティレジストリからディスカバーされたフックをロード（`loadCapability("hooks")`）
2. 明示的に設定されたパスを追加（絶対パスで重複排除）
3. `loadHooks(allPaths, cwd)` を呼び出す

`loadHooks` は各パスをインポートし、`default` 関数を期待します。

### パス解決

`loader.ts` はフックパスを以下のように解決します：

- 絶対パス：そのまま使用
- `~` パス：展開される
- 相対パス：`cwd` を基準に解決

### 重要なレガシーの不整合

`hookCapability` のディスカバリープロバイダーは、依然としてシェルスタイルのフックファイル（例：`.claude/hooks/pre/*`、`.xcsh/.../hooks/pre/*`）の前後モデルを前提としています。

ここでのフックローダーは動的モジュールインポートを使用し、デフォルトのJS/TSフックファクトリを必要とします。ディスカバーされたフックパスがモジュールとしてインポートできない場合、ロードは失敗し `LoadHooksResult.errors` で報告されます。

## イベントサーフェス

フックイベントは `types.ts` で厳密に型付けされています。

### セッションイベント

- `session_start`
- `session_before_switch` → `{ cancel?: boolean }` を返すことが可能
- `session_switch`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }` を返すことが可能
- `session_branch`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }` を返すことが可能
- `session.compacting` → `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }` を返すことが可能
- `session_compact`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }` を返すことが可能
- `session_tree`
- `session_shutdown`

### エージェント/コンテキストイベント

- `context` → `{ messages?: Message[] }` を返すことが可能
- `before_agent_start` → `{ message?: { customType; content; display; details } }` を返すことが可能
- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `auto_compaction_start`
- `auto_compaction_end`
- `auto_retry_start`
- `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### ツールイベント（前後モデル）

- `tool_call`（実行前） → `{ block?: boolean; reason?: string }` を返すことが可能
- `tool_result`（実行後） → `{ content?; details?; isError? }` を返すことが可能

これがフックサブシステムのコアとなる前後インターセプションモデルです。

```text
Hook tool interception flow

tool_call handlers
   │
   ├─ any { block: true }? ── yes ──> throw (tool blocked)
   │
   └─ no
      │
      ▼
   execute underlying tool
      │
      ├─ success ──> tool_result handlers can override { content, details }
      │
      └─ error   ──> emit tool_result(isError=true) then rethrow original error
```

## 実行モデルとミューテーションセマンティクス

### 1) 実行前：`tool_call`

`HookToolWrapper.execute()` はツール実行前に `tool_call` を発行します。

- いずれかのハンドラが `{ block: true }` を返した場合、実行は停止します
- ハンドラがスローした場合、ラッパーはフェイルクローズで実行をブロックします
- 返された `reason` がスローされるエラーテキストになります

### 2) ツール実行

ブロックされなければ、基盤となるツールは通常通り実行されます。

### 3) 実行後：`tool_result`

成功後、ラッパーは以下を含む `tool_result` を発行します：

- `toolName`、`toolCallId`、`input`
- `content`
- `details`
- `isError: false`

ハンドラがオーバーライドを返した場合：

- `content` で結果コンテンツを置換可能
- `details` で結果詳細を置換可能

ツール失敗時、ラッパーは `isError: true` とエラーテキストコンテンツを含む `tool_result` を発行し、元のエラーを再スローします。

### フックがミューテートできるもの

- `context` を通じた単一呼び出しのLLMコンテキスト（`messages` 置換チェーン）
- 成功したツール呼び出しのツール出力コンテンツ/詳細（`tool_result` パス）
- `before_agent_start` を通じたエージェント前の注入メッセージ
- `session_before_*` および `session.compacting` を通じたキャンセル/カスタムコンパクション/ツリー動作

### この実装でフックがミューテートできないもの

- `tool_call` での生のツール入力パラメータのインプレース変更（ブロック/許可のみ）
- スローされたツールエラー後の実行継続（エラーパスは再スローする）
- ラッパー動作における最終的な成功/エラーステータス（返された `isError` は型付けされていますが `HookToolWrapper` では適用されません）

## 順序付けと競合動作

### ディスカバリーレベルの順序付け

ケイパビリティプロバイダーは優先度順（高い方が先）にソートされます。重複排除はケイパビリティキーで行われ、最初のものが優先されます。

`hooks` の場合、ケイパビリティキーは `${type}:${tool}:${name}` です。低い優先度のプロバイダーからのシャドウされた重複はマークされ、有効なディスカバーリストから除外されます。

### ロード順序

`discoverAndLoadHooks` は解決された絶対パスで重複排除されたフラットな `allPaths` リストを構築し、`loadHooks` がその順序で反復処理します。
各ディスカバーされたディレクトリ内のファイル順序は `readdir` の出力に依存します。フックローダーは追加のソートを行いません。

### ランタイムハンドラ順序

`HookRunner` 内では、登録順序により決定的です：

1. hooks 配列の順序
2. フック/イベントごとのハンドラ登録順序

イベントタイプごとの競合動作：

- `tool_call`：ハンドラがブロックしない限り最後に返された結果が優先。最初のブロックでショートサーキット
- `tool_result`：最後に返されたオーバーライドが優先（ショートサーキットなし）
- `context`：チェーン方式。各ハンドラは前のハンドラのメッセージ出力を受け取る
- `before_agent_start`：最初に返されたメッセージが保持され、以降のメッセージは無視される
- `session_before_*`：最後に返された結果が追跡される。`cancel: true` は即座にショートサーキット
- `session.compacting`：最後に返された結果が優先

コマンド/レンダラーの競合：

- `getCommand(name)` はフック全体で最初のマッチを返す（最初にロードされたものが優先）
- `getMessageRenderer(customType)` は最初のマッチを返す
- `getRegisteredCommands()` はすべてのコマンドを返す（重複排除なし）

## UIインタラクション（`HookContext.ui`）

`HookUIContext` には以下が含まれます：

- `select`、`confirm`、`input`、`editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`、`getEditorText`
- `theme` ゲッター

`ctx.hasUI` はインタラクティブUIが利用可能かどうかを示します。

UIなしで実行している場合、デフォルトのno-opコンテキスト動作は以下の通りです：

- `select/input/editor` は `undefined` を返す
- `confirm` は `false` を返す
- `notify`、`setStatus`、`setEditorText` はno-op
- `getEditorText` は `""` を返す

### ステータスライン動作

`ctx.ui.setStatus(key, text)` で設定されたフックステータステキストは：

- キーごとに保存される
- キー名でソートされる
- サニタイズされる（`\r`、`\n`、`\t` → スペース。連続スペースは縮約）
- 結合され、表示用に幅が切り詰められる

## エラー伝播とフォールバック

### ロード時

- 無効なモジュールまたはデフォルトエクスポートの欠落 → `LoadHooksResult.errors` に記録される
- 他のフックのロードは継続される

### イベント時

`HookRunner.emit(...)` はほとんどのイベントでハンドラエラーをキャッチし、リスナーに `HookError`（`hookPath`、`event`、`error`）を発行してから処理を継続します。

`emitToolCall(...)` はより厳格です：ハンドラエラーはそこでは抑制されず、呼び出し元に伝播します。`HookToolWrapper` では、これによりツール呼び出しがブロックされます（フェイルセーフ）。

## 実践的なAPI例

### 危険なbashコマンドをブロックする

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "bash") return;
  const cmd = String(event.input.command ?? "");
  if (!cmd.includes("rm -rf")) return;

  if (!ctx.hasUI) return { block: true, reason: "rm -rf blocked (no UI)" };
  const ok = await ctx.ui.confirm("Dangerous command", `Allow: ${cmd}`);
  if (!ok) return { block: true, reason: "user denied command" };
 });
}
```

### 実行後にツール出力をリダクトする

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_result", async event => {
  if (event.toolName !== "read" || event.isError) return;

  const redacted = event.content.map(chunk => {
   if (chunk.type !== "text") return chunk;
   return { ...chunk, text: chunk.text.replaceAll(/API_KEY=\S+/g, "API_KEY=[REDACTED]") };
  });

  return { content: redacted };
 });
}
```

### LLM呼び出しごとにモデルコンテキストを変更する

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### コマンドセーフなコンテキストメソッドでスラッシュコマンドを登録する

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.registerCommand("handoff", {
  description: "Create a new session with setup message",
  handler: async (_args, ctx) => {
   await ctx.waitForIdle();
   await ctx.newSession({
    parentSession: ctx.sessionManager.getSessionFile(),
    setup: async sm => {
     sm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Continue from prior session summary." }],
      timestamp: Date.now(),
     });
    },
   });
  },
 });
}
```

## エクスポートサーフェス

`src/extensibility/hooks/index.ts` は以下をエクスポートします：

- ローディングAPI（`discoverAndLoadHooks`、`loadHooks`）
- ランナーとラッパー（`HookRunner`、`HookToolWrapper`）
- すべてのフック型
- `execCommand` の再エクスポート

パッケージルート（`src/index.ts`）はフックの**型**をレガシー互換サーフェスとして再エクスポートします。
