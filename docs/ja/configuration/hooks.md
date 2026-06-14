---
title: フック
description: コーディングエージェントのライフサイクルにおけるイベント前後の自動化のためのフックシステム。
sidebar:
  order: 4
  label: フック
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# フック

このドキュメントでは、`src/extensibility/hooks/*` の**現在のフックサブシステムコード**について説明します。

## ランタイムにおける現在の状態

フックパッケージ（`src/extensibility/hooks/`）は引き続き API サーフェスとしてエクスポートおよび使用可能ですが、デフォルトの CLI ランタイムは現在、**エクステンションランナー**パスを初期化します。現在の起動フローでは:

- `--hook` は `--extension` のエイリアスとして扱われます（CLI パスは `additionalExtensionPaths` にマージされます）
- ツールは `HookToolWrapper` ではなく `ExtensionToolWrapper` によってラップされます
- コンテキスト変換とライフサイクルのエミッションは `ExtensionRunner` を通じて行われます

したがって、このファイルでは、レガシーな動作と制約を含む、フックサブシステムの実装（型/ローダー/ランナー/ラッパー）自体についてドキュメント化します。

## 主要ファイル

- `src/extensibility/hooks/types.ts` — フックコンテキスト、イベントタイプ、および結果のコントラクト
- `src/extensibility/hooks/loader.ts` — モジュールの読み込みとフック探索のブリッジ
- `src/extensibility/hooks/runner.ts` — イベントディスパッチ、コマンドルックアップ、エラーシグナリング
- `src/extensibility/hooks/tool-wrapper.ts` — ツールの実行前後のインターセプトラッパー
- `src/extensibility/hooks/index.ts` — エクスポート/再エクスポート

## フックモジュールとは

フックモジュールはファクトリーをデフォルトエクスポートする必要があります:

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

ファクトリーでできること:

- `pi.on(...)` でイベントハンドラーを登録する
- `pi.sendMessage(...)` で永続的なカスタムメッセージを送信する
- `pi.appendEntry(...)` で非 LLM の状態を永続化する
- `pi.registerCommand(...)` でスラッシュコマンドを登録する
- `pi.registerMessageRenderer(...)` でカスタムメッセージレンダラーを登録する
- `pi.exec(...)` でシェルコマンドを実行する

## 探索と読み込み

`discoverAndLoadHooks(configuredPaths, cwd)` の処理:

1. ケイパビリティレジストリからフックを探索して読み込む（`loadCapability("hooks")`）
2. 明示的に設定されたパスを追加する（絶対パスで重複排除）
3. `loadHooks(allPaths, cwd)` を呼び出す

`loadHooks` は各パスをインポートし、`default` 関数を期待します。

### パス解決

`loader.ts` はフックパスを以下のように解決します:

- 絶対パス: そのまま使用
- `~` パス: 展開される
- 相対パス: `cwd` を基準に解決される

### 重要なレガシーの不一致

`hookCapability` の探索プロバイダーは、依然として実行前/後のシェル形式のフックファイル（例: `.claude/hooks/pre/*`、`.xcsh/.../hooks/pre/*`）をモデル化しています。

ここのフックローダーは動的モジュールインポートを使用し、デフォルトの JS/TS フックファクトリーを必要とします。探索されたフックパスがモジュールとしてインポートできない場合、読み込みは失敗し、`LoadHooksResult.errors` に報告されます。

## イベントサーフェス

フックイベントは `types.ts` で強く型付けされています。

### セッションイベント

- `session_start`
- `session_before_switch` → `{ cancel?: boolean }` を返せる
- `session_switch`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }` を返せる
- `session_branch`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }` を返せる
- `session.compacting` → `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }` を返せる
- `session_compact`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }` を返せる
- `session_tree`
- `session_shutdown`

### エージェント/コンテキストイベント

- `context` → `{ messages?: Message[] }` を返せる
- `before_agent_start` → `{ message?: { customType; content; display; details } }` を返せる
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

### ツールイベント（実行前後モデル）

- `tool_call`（実行前）→ `{ block?: boolean; reason?: string }` を返せる
- `tool_result`（実行後）→ `{ content?; details?; isError? }` を返せる

これがフックサブシステムのコアとなる実行前後のインターセプトモデルです。

```text
フックツールインターセプトフロー

tool_call ハンドラー
   │
   ├─ { block: true } が返された？── yes ──> throw（ツールブロック）
   │
   └─ no
      │
      ▼
   基礎ツールを実行
      │
      ├─ 成功 ──> tool_result ハンドラーが { content, details } を上書きできる
      │
      └─ エラー ──> tool_result(isError=true) をエミットしてから元のエラーを再スロー
```

## 実行モデルとミューテーションのセマンティクス

### 1) 実行前: `tool_call`

`HookToolWrapper.execute()` はツール実行前に `tool_call` をエミットします。

- いずれかのハンドラーが `{ block: true }` を返すと、実行が停止します
- ハンドラーがスローした場合、ラッパーはフェイルクローズし、実行をブロックします
- 返された `reason` がスローされたエラーテキストになります

### 2) ツール実行

ブロックされていない場合、基礎ツールは通常通り実行されます。

### 3) 実行後: `tool_result`

成功後、ラッパーは以下とともに `tool_result` をエミットします:

- `toolName`、`toolCallId`、`input`
- `content`
- `details`
- `isError: false`

ハンドラーが上書きを返した場合:

- `content` で結果のコンテンツを置き換えられる
- `details` で結果の詳細を置き換えられる

ツール失敗時、ラッパーは `isError: true` とエラーテキストのコンテンツとともに `tool_result` をエミットし、その後、元のエラーを再スローします。

### フックがミューテート可能なもの

- `context` による単一呼び出しの LLM コンテキスト（`messages` 置き換えチェーン）
- 成功したツール呼び出しでのツール出力コンテンツ/詳細（`tool_result` パス）
- `before_agent_start` によるエージェント開始前の注入メッセージ
- `session_before_*` および `session.compacting` によるキャンセル/カスタムコンパクション/ツリー動作

### この実装でフックがミューテートできないもの

- インプレースでの生のツール入力パラメーター（`tool_call` ではブロック/許可のみ）
- スローされたツールエラー後の実行継続（エラーパスは再スローする）
- ラッパー動作における最終的な成功/エラーステータス（返された `isError` は型付けされているが `HookToolWrapper` によって適用されない）

## 順序と競合の動作

### 探索レベルの順序

ケイパビリティプロバイダーは優先度順にソートされます（高い方が先）。重複排除はケイパビリティキーで行われ、最初のものが優先されます。

`hooks` の場合、ケイパビリティキーは `${type}:${tool}:${name}` です。優先度の低いプロバイダーからのシャドウされた重複は、マークされ、有効な探索済みリストから除外されます。

### 読み込み順序

`discoverAndLoadHooks` は、解決された絶対パスで重複排除されたフラットな `allPaths` リストを構築し、`loadHooks` がその順序でイテレートします。
各探索済みディレクトリ内のファイル順序は `readdir` の出力によって異なります。フックローダーは追加のソートを実行しません。

### ランタイムハンドラーの順序

`HookRunner` 内では、順序は登録シーケンスによって決定的です:

1. フック配列の順序
2. フック/イベントごとのハンドラー登録順序

イベントタイプ別の競合動作:

- `tool_call`: ハンドラーがブロックしない限り最後に返された結果が優先される。最初のブロックが短絡する
- `tool_result`: 最後に返された上書きが優先される（短絡なし）
- `context`: チェーン化される。各ハンドラーは前のハンドラーのメッセージ出力を受け取る
- `before_agent_start`: 最初に返されたメッセージが保持される。後のメッセージは無視される
- `session_before_*`: 最後に返された結果が追跡される。`cancel: true` は即座に短絡する
- `session.compacting`: 最後に返された結果が優先される

コマンド/レンダラーの競合:

- `getCommand(name)` はフック全体で最初のマッチを返す（最初に読み込まれたものが優先）
- `getMessageRenderer(customType)` は最初のマッチを返す
- `getRegisteredCommands()` はすべてのコマンドを返す（重複排除なし）

## UI インタラクション（`HookContext.ui`）

`HookUIContext` には以下が含まれます:

- `select`、`confirm`、`input`、`editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`、`getEditorText`
- `theme` ゲッター

`ctx.hasUI` はインタラクティブ UI が利用可能かどうかを示します。

UI なしで実行する場合、デフォルトのノーオペレーションコンテキストの動作は:

- `select/input/editor` は `undefined` を返す
- `confirm` は `false` を返す
- `notify`、`setStatus`、`setEditorText` はノーオペレーション
- `getEditorText` は `""` を返す

### ステータスラインの動作

`ctx.ui.setStatus(key, text)` で設定されたフックのステータステキストは:

- キーごとに保存される
- キー名でソートされる
- サニタイズされる（`\r`、`\n`、`\t` → スペース。連続するスペースは折りたたまれる）
- 結合され、表示のために幅で切り詰められる

## エラーの伝播とフォールバック

### 読み込み時

- 無効なモジュールまたはデフォルトエクスポートの欠如 → `LoadHooksResult.errors` にキャプチャされる
- 他のフックの読み込みは継続する

### イベント時

`HookRunner.emit(...)` はほとんどのイベントでハンドラーエラーをキャッチし、`HookError` をリスナーにエミットして（`hookPath`、`event`、`error`）、続行します。

`emitToolCall(...)` はより厳格です。ハンドラーエラーはそこでは飲み込まれず、呼び出し元に伝播します。`HookToolWrapper` では、これがツール呼び出しをブロックします（フェイルセーフ）。

## 実際的な API の例

### 安全でない bash コマンドをブロックする

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

### 実行後にツール出力を難読化する

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

### LLM 呼び出しごとにモデルコンテキストを変更する

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

`src/extensibility/hooks/index.ts` がエクスポートするもの:

- 読み込み API（`discoverAndLoadHooks`、`loadHooks`）
- ランナーとラッパー（`HookRunner`、`HookToolWrapper`）
- すべてのフック型
- `execCommand` の再エクスポート

パッケージルート（`src/index.ts`）はフックの**型**をレガシー互換サーフェスとして再エクスポートします。
