---
title: カスタムツール
description: エージェントを拡張するためのカスタムツール登録、スキーマ定義、および実行パイプライン。
sidebar:
  order: 4
  label: カスタムツール
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# カスタムツール

カスタムツールは、ビルトインツールと同じツール実行パイプラインに接続される、モデルから呼び出し可能な関数です。

カスタムツールは、ファクトリをエクスポートする TypeScript/JavaScript モジュールです。ファクトリはホスト API（`CustomToolAPI`）を受け取り、1つのツールまたはツールの配列を返します。

## これが何であるか（そして何でないか）

- **カスタムツール**: ターン中にモデルから呼び出し可能（`execute` + TypeBox スキーマ）。
- **エクステンション**: ツールの登録やイベントのインターセプト/変更が可能なライフサイクル/イベントフレームワーク。
- **フック**: 外部のコマンド実行前/後スクリプト。
- **スキル**: 静的なガイダンス/コンテキストパッケージであり、実行可能なツールコードではない。

モデルから直接コードを呼び出す必要がある場合は、カスタムツールを使用してください。

## 現在のコードにおける統合パス

2つのアクティブな統合スタイルがあります:

1. **SDK 提供のカスタムツール** (`options.customTools`)
   - `CustomToolAdapter` またはエクステンションラッパーを通じてエージェントツールにラップされます。
   - SDK ブートストラップで常に初期アクティブツールセットに含まれます。

2. **ローダー API によるファイルシステム検出モジュール** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - `src/extensibility/custom-tools/loader.ts` でライブラリ API として公開されています。
   - ホストコードはこれらを呼び出して、config/provider/plugin パスからツールモジュールを検出およびロードできます。

```text
Model tool call flow

LLM tool call
   │
   ▼
Tool registry (built-ins + custom tool adapters)
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> streamed partial result
   └─ return result  -> final tool content/details
```

## 検出場所（ローダー API）

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` は以下をマージします:

1. ケイパビリティプロバイダー（`toolCapability`）、以下を含む:
   - ネイティブ OMP 設定（`~/.xcsh/agent/tools`、`.xcsh/tools`）
   - Claude 設定（`~/.claude/tools`、`.claude/tools`）
   - Codex 設定（`~/.codex/tools`、`.codex/tools`）
   - Claude マーケットプレイスプラグインキャッシュプロバイダー
2. インストール済みプラグインマニフェスト（プラグインローダー経由の `~/.xcsh/plugins/node_modules/*`）
3. ローダーに渡された明示的な設定パス

### 重要な動作

- 重複する解決済みパスは重複排除されます。
- ツール名の競合は、ビルトインおよびすでにロードされたカスタムツールに対して拒否されます。
- `.md` および `.json` ファイルは一部のプロバイダーによってツールメタデータとして検出されますが、実行可能モジュールローダーは実行可能なツールとしてこれらを拒否します。
- 相対設定パスは `cwd` から解決されます。`~` は展開されます。

## モジュール規約

カスタムツールモジュールは関数をエクスポートする必要があります（デフォルトエクスポート推奨）:

```ts
import type { CustomToolFactory } from "@f5xc-salesdemos/xcsh";

const factory: CustomToolFactory = (pi) => ({
 name: "repo_stats",
 label: "Repo Stats",
 description: "Counts tracked TypeScript files",
 parameters: pi.typebox.Type.Object({
  glob: pi.typebox.Type.Optional(pi.typebox.Type.String({ default: "**/*.ts" })),
 }),

 async execute(toolCallId, params, onUpdate, ctx, signal) {
  onUpdate?.({
   content: [{ type: "text", text: "Scanning files..." }],
   details: { phase: "scan" },
  });

  const result = await pi.exec("git", ["ls-files", params.glob ?? "**/*.ts"], { signal, cwd: pi.cwd });
  if (result.killed) {
   throw new Error("Scan was cancelled");
  }
  if (result.code !== 0) {
   throw new Error(result.stderr || "git ls-files failed");
  }

  const files = result.stdout.split("\n").filter(Boolean);
  return {
   content: [{ type: "text", text: `Found ${files.length} files` }],
   details: { count: files.length, sample: files.slice(0, 10) },
  };
 },

 onSession(event) {
  if (event.reason === "shutdown") {
   // cleanup resources if needed
  }
 },
});

export default factory;
```

ファクトリの返り値の型:

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## ファクトリに渡される API サーフェス (`CustomToolAPI`)

`types.ts` および `loader.ts` より:

- `cwd`: ホストの作業ディレクトリ
- `exec(command, args, options?)`: プロセス実行ヘルパー
- `ui`: UI コンテキスト（ヘッドレスモードでは no-op になる場合がある）
- `hasUI`: 非インタラクティブフローでは `false`
- `logger`: 共有ファイルロガー
- `typebox`: 注入された `@sinclair/typebox`
- `pi`: 注入された `@f5xc-salesdemos/xcsh` エクスポート
- `pushPendingAction(action)`: 隠し `resolve` ツール用のプレビューアクションを登録（`docs/resolve-tool-runtime.md`）

ローダーは no-op UI コンテキストで開始し、実際の UI が準備できた時点でホストコードが `setUIContext(...)` を呼び出す必要があります。

## 実行規約と型定義

`CustomTool.execute` のシグネチャ:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` は TypeBox スキーマから `Static<TParams>` を通じて静的に型付けされます。
- ランタイム引数のバリデーションはエージェントループ内で実行前に行われます。
- `onUpdate` は UI ストリーミング用の部分的な結果を出力します。
- `ctx` にはセッション/モデルの状態と `abort()` ヘルパーが含まれます。
- `signal` はキャンセルを伝達します。

`CustomToolAdapter` はこれをエージェントツールインターフェースにブリッジし、正しい引数順序で呼び出しを転送します。

## ツールがモデルに公開される仕組み

- ツールは `AgentTool` インスタンス（`CustomToolAdapter` またはエクステンションラッパー）にラップされます。
- セッションのツールレジストリに名前で挿入されます。
- SDK ブートストラップでは、カスタムおよびエクステンション登録ツールは初期アクティブセットに強制的に含まれます。
- CLI の `--tools` は現在ビルトインツール名のみを検証します。カスタムツールの組み込みは、検出/登録パスおよび SDK オプションを通じて処理されます。

## レンダリングフック

オプションのレンダリングフック:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

TUI でのランタイム動作:

- フックが存在する場合、ツール出力は `Box` コンテナ内にレンダリングされます。
- `renderResult` は `{ expanded, isPartial, spinnerFrame? }` を受け取ります。
- レンダラーエラーはキャッチされてログに記録されます。UI はデフォルトのテキストレンダリングにフォールバックします。

## セッション/状態の処理

オプションの `onSession(event, ctx)` は、以下を含むセッションライフサイクルイベントを受け取ります:

- `start`、`switch`、`branch`、`tree`、`shutdown`
- `auto_compaction_start`、`auto_compaction_end`
- `auto_retry_start`、`auto_retry_end`
- `ttsr_triggered`、`todo_reminder`

ブランチ/セッションコンテキストが変更された場合、`ctx.sessionManager` を使用して履歴から状態を再構築してください。

## 失敗とキャンセルのセマンティクス

### 同期/非同期の失敗

- `execute` での throw（またはリジェクトされた Promise）はツール失敗として扱われます。
- エージェントランタイムは失敗を `isError: true` とエラーテキストコンテンツを持つツール結果メッセージに変換します。
- エクステンションラッパーでは、`tool_result` ハンドラーがさらにコンテンツ/詳細を書き換え、エラーステータスをオーバーライドすることもできます。

### キャンセル

- エージェントのアボートは `AbortSignal` を通じて `execute` に伝播します。
- 協調的なキャンセルのために、サブプロセスの処理に `signal` を転送してください（`pi.exec(..., { signal })`）。
- `ctx.abort()` を使用すると、ツールから現在のエージェント操作のアボートをリクエストできます。

### onSession のエラー

- `onSession` のエラーはキャッチされ、警告としてログに記録されます。セッションはクラッシュしません。

## 設計上の実際の制約

- ツール名はアクティブなレジストリ内でグローバルに一意でなければなりません。
- レンダラー/状態再構築のために、`details` には決定論的でスキーマに沿った出力を推奨します。
- `pi.hasUI` で UI の使用を保護してください。
- ツールディレクトリ内の `.md`/`.json` は実行可能モジュールではなく、メタデータとして扱ってください。
