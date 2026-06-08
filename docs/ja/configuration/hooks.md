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

## ランタイムでの現在のステータス

フックパッケージ（`src/extensibility/hooks/`）は依然としてAPIサーフェスとしてエクスポートおよび使用可能ですが、デフォルトのCLIランタイムは現在**エクステンションランナー**パスを初期化します。現在の起動フローでは：

- `--hook` は `--extension` のエイリアスとして扱われます（CLIパスは `additionalExtensionPaths` に統合されます）
- ツールは `HookToolWrapper` ではなく `ExtensionToolWrapper` によってラップされます
- コンテキスト変換とライフサイクルのイベント発行は `ExtensionRunner` を通じて行われます

そのため、このファイルではフックサブシステムの実装自体（型/ローダー/ランナー/ラッパー）を、レガシーの動作と制約を含めて記述しています。

## 主要ファイル

- `src/extensibility/hooks/types.ts` — フックコンテキスト、イベント型、および結果のコントラクト
- `src/extensibility/hooks/loader.ts` — モジュールのロードとフック検出ブリッジ
- `src/extensibility/hooks/runner.ts` — イベントディスパッチ、コマンド検索、エラーシグナリング
- `src/extensibility/hooks/tool-wrapper.ts` — ツール実行前後のインターセプションラッパー
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

ファクトリでは以下が可能です：

- `pi.on(...)` でイベントハンドラを登録する
- `pi.sendMessage(...)` で永続的なカスタムメッセージを送信する
- `pi.appendEntry(...)` で非LLM状態を永続化する
- `pi.registerCommand(...)` でスラッシュコマンドを登録する
- `pi.registerMessageRenderer(...)` でカスタムメッセージレンダラーを登録する
- `pi.exec(...)` でシェルコマンドを実行する

## 検出とロード

`discoverAndLoadHooks(configuredPaths, cwd)` は以下を実行します：

1. ケイパビリティレジストリから検出されたフックをロードする（`loadCapability("hooks")`）
2. 明示的に設定されたパスを追加する（絶対パスで重複排除）
3. `loadHooks(allPaths, cwd)` を呼び出す

`loadHooks` は各パスをインポートし、`default` 関数を期待します。

### パス解決

`loader.ts` はフックパスを以下のように解決します：

- 絶対パス：そのまま使用
- `~` パス：展開される
- 相対パス：`cwd` に対して解決される

### 重要なレガシーの不一致

`hookCapability` の検出プロバイダーは、依然としてシェルスタイルのフックファイルの前後モデル（例：`.claude/hooks/pre/*`、`.xcsh/.../hooks/pre/*`）に基づいています。

ここでのフックローダーは動的モジュールインポートを使用し、デフォルトのJS/TSフックファクトリを必要とします。検出されたフックパスがモジュールとしてインポートできない場合、ロードは失敗し、`LoadHooksResult.errors` で報告されます。

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

これはフックサブシステムのコアとなる前後インターセプションモデルです。

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

- いずれかのハンドラが `{ block: true }` を返すと、実行が停止されます
- ハンドラがスローすると、ラッパーはフェイルクローズドで実行をブロックします
- 返された `reason` がスローされるエラーテキストになります

### 2) ツール実行

ブロックされなかった場合、基盤となるツールは通常通り実行されます。

### 3) 実行後：`tool_result`

成功後、ラッパーは以下の内容で `tool_result` を発行します：

- `toolName`、`toolCallId`、`input`
- `content`
- `details`
- `isError: false`

ハンドラがオーバーライドを返す場合：

- `content` で結果の内容を置換できます
- `details` で結果の詳細を置換できます

ツール失敗時、ラッパーは `isError: true` とエラーテキストの内容で `tool_result` を発行し、その後元のエラーを再スローします。

### フックがミューテーションできるもの

- `context` を介した単一のLLM呼び出しのコンテキスト（`messages` の置換チェーン）
- 成功したツール呼び出しでのツール出力の内容/詳細（`tool_result` パス）
- `before_agent_start` を介したエージェント前の注入メッセージ
- `session_before_*` と `session.compacting` を介したキャンセル/カスタムコンパクション/ツリー動作

### この実装でフックがミューテーションできないもの

- `tool_call` でのツール入力パラメータのインプレース変更（ブロック/許可のみ）
- スローされたツールエラー後の実行の継続（エラーパスは再スローする）
- ラッパー動作における最終的な成功/エラーステータス（返された `isError` は型付けされていますが、`HookToolWrapper` によって適用されません）

## 順序とコンフリクト動作

### 検出レベルの順序

ケイパビリティプロバイダーは優先度順にソートされます（高い方が先）。重複排除はケイパビリティキーによって行われ、最初のものが優先されます。

`hooks` の場合、ケイパビリティキーは `${type}:${tool}:${name}` です。低優先度のプロバイダーからのシャドウされた重複は、マークされて有効な検出リストから除外されます。

### ロード順序

`discoverAndLoadHooks` は解決された絶対パスで重複排除されたフラットな `allPaths` リストを構築し、`loadHooks` がその順序で反復します。
各検出ディレクトリ内のファイル順序は `readdir` の出力に依存します。フックローダーは追加のソートを行いません。

### ランタイムハンドラの順序

`HookRunner` 内では、登録順序によって決定論的な順序になります：

1. フック配列の順序
2. フック/イベントごとのハンドラ登録順序

イベント型別のコンフリクト動作：

- `tool_call`：ハンドラがブロックしない限り、最後に返された結果が優先されます。最初のブロックでショートサーキットします
- `tool_result`：最後に返されたオーバーライドが優先されます（ショートサーキットなし）
- `context`：チェーン処理。各ハンドラは前のハンドラのメッセージ出力を受け取ります
- `before_agent_start`：最初に返されたメッセージが保持されます。以降のメッセージは無視されます
- `session_before_*`：最後に返された結果が追跡されます。`cancel: true` は即座にショートサーキットします
- `session.compacting`：最後に返された結果が優先されます

コマンド/レンダラーのコンフリクト：

- `getCommand(name)` はフック間で最初に一致したものを返します（最初にロードされたものが優先）
- `getMessageRenderer(customType)` は最初に一致したものを返します
- `getRegisteredCommands()` はすべてのコマンドを返します（重複排除なし）

## UIインタラクション（`HookContext.ui`）

`HookUIContext` には以下が含まれます：

- `select`、`confirm`、`input`、`editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`、`getEditorText`
- `theme` ゲッター

`ctx.hasUI` はインタラクティブUIが利用可能かどうかを示します。

UIなしで実行する場合、デフォルトのno-opコンテキストの動作は以下の通りです：

- `select/input/editor` は `undefined` を返します
- `confirm` は `false` を返します
- `notify`、`setStatus`、`setEditorText` はno-opです
- `getEditorText` は `""` を返します

### ステータスラインの動作

`ctx.ui.setStatus(key, text)` で設定されたフックステータステキストは：

- キーごとに保存されます
- キー名でソートされます
- サニタイズされます（`\r`、`\n`、`\t` → スペース、連続するスペースは縮小）
- 結合され、表示のために幅が切り詰められます

## エラー伝播とフォールバック

### ロード時

- 無効なモジュールまたはデフォルトエクスポートの欠如 → `LoadHooksResult.errors` にキャプチャされます
- 他のフックに対してはロードが継続されます

### イベント時

`HookRunner.emit(...)` はほとんどのイベントでハンドラエラーをキャッチし、リスナーに `HookError`（`hookPath`、`event`、`error`）を発行してから処理を続行します。

`emitToolCall(...)` はより厳格です：ハンドラエラーはそこでは抑制されず、呼び出し元に伝播されます。`HookToolWrapper` では、これがツール呼び出しをブロックします（フェイルセーフ）。

## 実践的なAPI例

### 安全でないbashコマンドをブロックする

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

### 実行後のツール出力を編集する

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

### コマンドセーフなコンテキストメソッドを使用してスラッシュコマンドを登録する

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

- ロードAPI（`discoverAndLoadHooks`、`loadHooks`）
- ランナーとラッパー（`HookRunner`、`HookToolWrapper`）
- すべてのフック型
- `execCommand` の再エクスポート

そしてパッケージルート（`src/index.ts`）はレガシー互換性サーフェスとしてフック**型**を再エクスポートします。
