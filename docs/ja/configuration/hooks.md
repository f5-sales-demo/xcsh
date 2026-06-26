---
title: フック
description: コーディングエージェントライフサイクルにおけるイベント前後の自動化のためのフックシステム。
sidebar:
  order: 4
  label: フック
i18n:
  sourceHash: cdbec10bc405
  translator: machine
---

# フック

このドキュメントでは、`src/extensibility/hooks/*` にある**現在のフックサブシステムのコード**について説明します。

## ランタイムにおける現在の状態

フックパッケージ（`src/extensibility/hooks/`）はAPIサーフェスとして引き続きエクスポートされ使用可能ですが、デフォルトのCLIランタイムは現在**拡張ランナー**のパスを初期化します。現在の起動フローでは：

- `--hook` は `--extension` のエイリアスとして扱われます（CLIパスは `additionalExtensionPaths` にマージされます）
- ツールは `HookToolWrapper` ではなく `ExtensionToolWrapper` によってラップされます
- コンテキスト変換とライフサイクルのエミッションは `ExtensionRunner` を通じて処理されます

このため、このファイルは、レガシーの動作と制約を含む、フックサブシステムの実装自体（型/ローダー/ランナー/ラッパー）についてドキュメント化します。

## 主要なファイル

- `src/extensibility/hooks/types.ts` — フックコンテキスト、イベント型、および結果コントラクト
- `src/extensibility/hooks/loader.ts` — モジュールの読み込みとフック検出ブリッジ
- `src/extensibility/hooks/runner.ts` — イベントディスパッチ、コマンドルックアップ、エラーシグナリング
- `src/extensibility/hooks/tool-wrapper.ts` — ツールの前後インターセプトラッパー
- `src/extensibility/hooks/index.ts` — エクスポート/再エクスポート

## フックモジュールとは

フックモジュールはファクトリーをデフォルトエクスポートする必要があります：

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

export default function hook(pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && String(event.input.command ?? "").includes("rm -rf")) {
   return { block: true, reason: "blocked by policy" };
  }
 });
}
```

ファクトリーは以下のことが可能です：

- `pi.on(...)` でイベントハンドラーを登録する
- `pi.sendMessage(...)` で永続的なカスタムメッセージを送信する
- `pi.appendEntry(...)` で非LLM状態を永続化する
- `pi.registerCommand(...)` でスラッシュコマンドを登録する
- `pi.registerMessageRenderer(...)` でカスタムメッセージレンダラーを登録する
- `pi.exec(...)` でシェルコマンドを実行する

## 検出と読み込み

`discoverAndLoadHooks(configuredPaths, cwd)` は以下を実行します：

1. ケイパビリティレジストリからフックを検出して読み込む（`loadCapability("hooks")`）
2. 明示的に設定されたパスを追加する（絶対パスで重複排除）
3. `loadHooks(allPaths, cwd)` を呼び出す

その後、`loadHooks` は各パスをインポートし、`default` 関数を期待します。

### パス解決

`loader.ts` はフックパスを以下のように解決します：

- 絶対パス：そのまま使用
- `~` パス：展開される
- 相対パス：`cwd` に対して解決される

### 重要なレガシーの不一致

`hookCapability` の検出プロバイダーは、依然として前後のシェルスタイルのフックファイル（例：`.claude/hooks/pre/*`、`.xcsh/.../hooks/pre/*`）をモデル化しています。

ここのフックローダーは動的モジュールインポートを使用し、デフォルトのJS/TSフックファクトリーを必要とします。検出されたフックパスがモジュールとしてインポートできない場合、読み込みは失敗し `LoadHooksResult.errors` に報告されます。

## イベントサーフェス

フックイベントは `types.ts` で厳密に型付けされています。

### セッションイベント

- `session_start`
- `session_before_switch` → `{ cancel?: boolean }` を返すことができる
- `session_switch`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }` を返すことができる
- `session_branch`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }` を返すことができる
- `session.compacting` → `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }` を返すことができる
- `session_compact`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }` を返すことができる
- `session_tree`
- `session_shutdown`

### エージェント/コンテキストイベント

- `context` → `{ messages?: Message[] }` を返すことができる
- `before_agent_start` → `{ message?: { customType; content; display; details } }` を返すことができる
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

- `tool_call`（実行前）→ `{ block?: boolean; reason?: string }` を返すことができる
- `tool_result`（実行後）→ `{ content?; details?; isError? }` を返すことができる

これはフックサブシステムのコアとなる前後インターセプトモデルです。

```text
フックツールインターセプトフロー

tool_call ハンドラー
   │
   ├─ { block: true } が返された場合? ── はい ──> スロー（ツールブロック）
   │
   └─ いいえ
      │
      ▼
   基盤となるツールを実行
      │
      ├─ 成功 ──> tool_result ハンドラーが { content, details } をオーバーライド可能
      │
      └─ エラー   ──> tool_result(isError=true) をエミットし、元のエラーを再スロー
```

## 実行モデルとミューテーションのセマンティクス

### 1) 実行前：`tool_call`

`HookToolWrapper.execute()` はツール実行前に `tool_call` をエミットします。

- いずれかのハンドラーが `{ block: true }` を返すと、実行が停止する
- ハンドラーがスローした場合、ラッパーはフェイルクローズで実行をブロックする
- 返された `reason` がスローされたエラーテキストになる

### 2) ツール実行

ブロックされていない場合、基盤となるツールが通常通り実行されます。

### 3) 実行後：`tool_result`

成功後、ラッパーは以下を含む `tool_result` をエミットします：

- `toolName`、`toolCallId`、`input`
- `content`
- `details`
- `isError: false`

ハンドラーがオーバーライドを返した場合：

- `content` は結果コンテンツを置き換えることができる
- `details` は結果の詳細を置き換えることができる

ツールの失敗時、ラッパーは `isError: true` とエラーテキストコンテンツを含む `tool_result` をエミットし、元のエラーを再スローします。

### フックがミューテート可能なもの

- `context` による単一呼び出しのLLMコンテキスト（`messages` 置換チェーン）
- 成功したツール呼び出しのツール出力コンテンツ/詳細（`tool_result` パス）
- `before_agent_start` によるエージェント起動前の注入メッセージ
- `session_before_*` および `session.compacting` によるキャンセル/カスタムコンパクション/ツリー動作

### この実装においてフックがミューテート不可能なもの

- ツールの入力パラメーターをインプレースで変更（`tool_call` ではブロック/許可のみ）
- スローされたツールエラー後の実行継続（エラーパスは再スローする）
- ラッパー動作における最終的な成功/エラーステータス（返された `isError` は型付けされているが `HookToolWrapper` では適用されない）

## 順序と競合の動作

### 検出レベルの順序

ケイパビリティプロバイダーは優先度順にソートされます（高いものが優先）。重複排除はケイパビリティキーで行われ、最初のものが優先されます。

`hooks` の場合、ケイパビリティキーは `${type}:${tool}:${name}` です。低優先度のプロバイダーからの重複は、シャドーされたものとしてマークされ、有効な検出リストから除外されます。

### 読み込み順序

`discoverAndLoadHooks` は解決された絶対パスで重複排除されたフラットな `allPaths` リストを作成し、その後 `loadHooks` がその順序で繰り返し処理します。
各検出ディレクトリ内のファイル順は `readdir` の出力に依存し、フックローダーは追加のソートを実行しません。

### ランタイムハンドラーの順序

`HookRunner` 内では、順序は登録シーケンスによって決定論的に決まります：

1. フック配列の順序
2. フック/イベントごとのハンドラー登録順序

イベント型による競合の動作：

- `tool_call`：ハンドラーがブロックしない限り最後に返された結果が優先され、最初のブロックで短絡する
- `tool_result`：最後に返されたオーバーライドが優先（短絡なし）
- `context`：チェーン化され、各ハンドラーは前のハンドラーのメッセージ出力を受け取る
- `before_agent_start`：最初に返されたメッセージが保持され、以降のメッセージは無視される
- `session_before_*`：最後に返された結果が追跡され、`cancel: true` は即座に短絡する
- `session.compacting`：最後に返された結果が優先

コマンド/レンダラーの競合：

- `getCommand(name)` はフック全体で最初の一致を返す（最初に読み込まれたものが優先）
- `getMessageRenderer(customType)` は最初の一致を返す
- `getRegisteredCommands()` はすべてのコマンドを返す（重複排除なし）

## UIインタラクション（`HookContext.ui`）

`HookUIContext` には以下が含まれます：

- `select`、`confirm`、`input`、`editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`、`getEditorText`
- `theme` ゲッター

`ctx.hasUI` はインタラクティブなUIが使用可能かどうかを示します。

UIなしで実行する場合、デフォルトのno-opコンテキスト動作は以下の通りです：

- `select/input/editor` は `undefined` を返す
- `confirm` は `false` を返す
- `notify`、`setStatus`、`setEditorText` はno-opである
- `getEditorText` は `""` を返す

### ステータスラインの動作

`ctx.ui.setStatus(key, text)` で設定されたフックステータステキストは：

- キーごとに保存される
- キー名でソートされる
- サニタイズされる（`\r`、`\n`、`\t` → スペース；連続するスペースは縮小される）
- 表示のために結合され幅が切り詰められる

## エラーの伝播とフォールバック

### 読み込み時

- 無効なモジュールまたはデフォルトエクスポートの欠如 → `LoadHooksResult.errors` に記録される
- 他のフックの読み込みは継続される

### イベント時

`HookRunner.emit(...)` はほとんどのイベントのハンドラーエラーをキャッチし、`HookError` をリスナーにエミット（`hookPath`、`event`、`error`）してから継続します。

`emitToolCall(...)` はより厳格です：ハンドラーエラーはそこでは飲み込まれず、呼び出し元に伝播します。`HookToolWrapper` では、これによりツール呼び出しがブロックされます（フェイルセーフ）。

## 実際のAPIの例

### 安全でないbashコマンドをブロックする

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

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

### 実行後にツール出力を編集する

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

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
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### コマンドセーフなコンテキストメソッドでスラッシュコマンドを登録する

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

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

`src/extensibility/hooks/index.ts` がエクスポートするもの：

- 読み込みAPI（`discoverAndLoadHooks`、`loadHooks`）
- ランナーとラッパー（`HookRunner`、`HookToolWrapper`）
- すべてのフック型
- `execCommand` の再エクスポート

パッケージルート（`src/index.ts`）はレガシー互換性サーフェスとしてフック**型**を再エクスポートします。
