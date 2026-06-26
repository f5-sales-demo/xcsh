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

カスタムツールは、組み込みツールと同じツール実行パイプラインに組み込まれる、モデルから呼び出し可能な関数です。

カスタムツールは、ファクトリーをエクスポートする TypeScript/JavaScript モジュールです。ファクトリーはホスト API（`CustomToolAPI`）を受け取り、1 つのツールまたはツールの配列を返します。

## これが何であるか（そして何でないか）

- **カスタムツール**: ターン中にモデルから呼び出し可能（`execute` + TypeBox スキーマ）。
- **Extension（拡張機能）**: ツールの登録やイベントのインターセプト/変更が可能なライフサイクル/イベントフレームワーク。
- **Hook（フック）**: 外部のコマンド前後スクリプト。
- **Skill（スキル）**: 静的なガイダンス/コンテキストパッケージ。実行可能なツールコードではない。

モデルからコードを直接呼び出す必要がある場合は、カスタムツールを使用してください。

## 現在のコードにおける統合パス

2 つのアクティブな統合スタイルがあります：

1. **SDK 提供のカスタムツール** (`options.customTools`)
   - `CustomToolAdapter` または拡張ラッパーを介してエージェントツールにラップされます。
   - SDK ブートストラップ時に常に初期アクティブツールセットに含まれます。

2. **ローダー API 経由でファイルシステムから検出されるモジュール** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - `src/extensibility/custom-tools/loader.ts` のライブラリ API として公開されています。
   - ホストコードはこれらを呼び出して、config/provider/plugin パスからツールモジュールを検出・読み込みできます。

```text
モデルツール呼び出しフロー

LLM ツール呼び出し
   │
   ▼
ツールレジストリ（組み込み + カスタムツールアダプター）
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> ストリーミングされた部分的結果
   └─ return result  -> 最終ツールコンテンツ/詳細
```

## 検出場所（ローダー API）

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` は以下をマージします：

1. ケーパビリティプロバイダー（`toolCapability`）、以下を含む：
   - ネイティブ OMP 設定（`~/.xcsh/agent/tools`、`.xcsh/tools`）
   - Claude 設定（`~/.claude/tools`、`.claude/tools`）
   - Codex 設定（`~/.codex/tools`、`.codex/tools`）
   - Claude マーケットプレイスプラグインキャッシュプロバイダー
2. インストール済みプラグインマニフェスト（プラグインローダー経由の `~/.xcsh/plugins/node_modules/*`）
3. ローダーに渡された明示的に設定されたパス

### 重要な動作

- 解決されたパスの重複は除去されます。
- ツール名の競合は、組み込みツールおよびすでに読み込まれたカスタムツールに対して拒否されます。
- `.md` および `.json` ファイルは一部のプロバイダーによってツールメタデータとして検出されますが、実行可能モジュールローダーはこれらを実行可能ツールとして拒否します。
- 相対設定パスは `cwd` から解決され、`~` は展開されます。

## モジュールコントラクト

カスタムツールモジュールは関数をエクスポートする必要があります（デフォルトエクスポートを推奨）：

```ts
import type { CustomToolFactory } from "@f5-sales-demo/xcsh";

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
   // 必要に応じてリソースをクリーンアップ
  }
 },
});

export default factory;
```

ファクトリーの戻り値の型：

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## ファクトリーに渡される API サーフェス（`CustomToolAPI`）

`types.ts` および `loader.ts` より：

- `cwd`: ホストのワーキングディレクトリ
- `exec(command, args, options?)`: プロセス実行ヘルパー
- `ui`: UI コンテキスト（ヘッドレスモードでは no-op になる場合あり）
- `hasUI`: 非インタラクティブフローでは `false`
- `logger`: 共有ファイルロガー
- `typebox`: 注入された `@sinclair/typebox`
- `pi`: 注入された `@f5-sales-demo/xcsh` エクスポート
- `pushPendingAction(action)`: 隠し `resolve` ツール用のプレビューアクションを登録する（`docs/resolve-tool-runtime.md`）

ローダーは no-op UI コンテキストで開始し、実際の UI が準備できた際にホストコードが `setUIContext(...)` を呼び出す必要があります。

## 実行コントラクトと型付け

`CustomTool.execute` のシグネチャ：

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` は、`Static<TParams>` を介して TypeBox スキーマから静的に型付けされます。
- ランタイム引数の検証は、エージェントループでの実行前に行われます。
- `onUpdate` は UI ストリーミング用の部分的な結果を送出します。
- `ctx` にはセッション/モデルの状態と `abort()` ヘルパーが含まれます。
- `signal` はキャンセルを伝達します。

`CustomToolAdapter` はこれをエージェントツールインターフェースにブリッジし、正しい引数順序で呼び出しを転送します。

## モデルへのツールの公開方法

- ツールは `AgentTool` インスタンス（`CustomToolAdapter` または拡張ラッパー）にラップされます。
- 名前によってセッションツールレジストリに挿入されます。
- SDK ブートストラップでは、カスタムおよび拡張機能で登録されたツールは初期アクティブセットに強制的に含まれます。
- CLI の `--tools` は現在、組み込みツール名のみを検証します。カスタムツールの組み込みは、検出/登録パスおよび SDK オプションを通じて処理されます。

## レンダリングフック

オプションのレンダリングフック：

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

TUI でのランタイム動作：

- フックが存在する場合、ツール出力は `Box` コンテナ内にレンダリングされます。
- `renderResult` は `{ expanded, isPartial, spinnerFrame? }` を受け取ります。
- レンダラーエラーはキャッチされてログに記録され、UI はデフォルトのテキストレンダリングにフォールバックします。

## セッション/状態処理

オプションの `onSession(event, ctx)` はセッションライフサイクルイベントを受け取ります。以下を含みます：

- `start`、`switch`、`branch`、`tree`、`shutdown`
- `auto_compaction_start`、`auto_compaction_end`
- `auto_retry_start`、`auto_retry_end`
- `ttsr_triggered`、`todo_reminder`

ブランチ/セッションコンテキストが変更された際に履歴から状態を再構築するには、`ctx.sessionManager` を使用してください。

## 失敗とキャンセルのセマンティクス

### 同期/非同期の失敗

- `execute` でのスロー（または拒否された Promise）はツール失敗として扱われます。
- エージェントランタイムは失敗を `isError: true` とエラーテキストコンテンツを含むツール結果メッセージに変換します。
- 拡張ラッパーを使用する場合、`tool_result` ハンドラーはコンテンツ/詳細をさらに書き換え、エラーステータスを上書きすることもできます。

### キャンセル

- エージェントのアボートは `AbortSignal` を通じて `execute` に伝播されます。
- 協調的なキャンセルのために、`signal` をサブプロセス処理（`pi.exec(..., { signal })`）に転送してください。
- `ctx.abort()` により、ツールは現在のエージェント操作のアボートを要求できます。

### onSession エラー

- `onSession` エラーはキャッチされて警告としてログに記録されます。セッションはクラッシュしません。

## 設計上の実際の制約

- ツール名はアクティブなレジストリ内でグローバルに一意である必要があります。
- レンダラー/状態の再構築のために、`details` には決定論的でスキーマ形式の出力を優先してください。
- UI の使用は `pi.hasUI` でガードしてください。
- ツールディレクトリ内の `.md`/`.json` はメタデータとして扱い、実行可能モジュールとして扱わないでください。
