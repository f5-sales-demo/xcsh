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

カスタムツールは、組み込みツールと同じツール実行パイプラインに接続される、モデルが呼び出し可能な関数です。

カスタムツールは、ファクトリをエクスポートする TypeScript/JavaScript モジュールです。ファクトリはホスト API（`CustomToolAPI`）を受け取り、1 つのツールまたはツールの配列を返します。

## これが何であるか（そして何でないか）

- **カスタムツール**: ターン中にモデルが呼び出し可能（`execute` + TypeBox スキーマ）。
- **拡張機能**: ツールを登録し、イベントをインターセプト/変更できるライフサイクル/イベントフレームワーク。
- **フック**: 外部のコマンド前後スクリプト。
- **スキル**: 静的なガイダンス/コンテキストパッケージ。実行可能なツールコードではない。

モデルに直接コードを呼び出させる必要がある場合は、カスタムツールを使用してください。

## 現在のコードにおける統合パス

2 つのアクティブな統合スタイルがあります：

1. **SDK が提供するカスタムツール**（`options.customTools`）
   - `CustomToolAdapter` または拡張機能ラッパーを通じてエージェントツールにラップされる。
   - SDK ブートストラップ時に初期アクティブツールセットに常に含まれる。

2. **ローダー API によるファイルシステムの自動検出モジュール**（`discoverAndLoadCustomTools` / `loadCustomTools`）
   - `src/extensibility/custom-tools/loader.ts` のライブラリ API として公開。
   - ホストコードはこれらを呼び出して、設定/プロバイダー/プラグインパスからツールモジュールを検出・読み込める。

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
   ├─ onUpdate(...)  -> ストリーミング部分結果
   └─ return result  -> 最終ツールコンテンツ/詳細
```

## 検出場所（ローダー API）

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` は以下をマージします：

1. ケイパビリティプロバイダー（`toolCapability`）、以下を含む：
   - ネイティブ OMP 設定（`~/.xcsh/agent/tools`、`.xcsh/tools`）
   - Claude 設定（`~/.claude/tools`、`.claude/tools`）
   - Codex 設定（`~/.codex/tools`、`.codex/tools`）
   - Claude マーケットプレイスプラグインキャッシュプロバイダー
2. インストール済みプラグインマニフェスト（プラグインローダー経由の `~/.xcsh/plugins/node_modules/*`）
3. ローダーに渡された明示的な設定パス

### 重要な動作

- 重複する解決済みパスは重複排除される。
- ツール名の競合は、組み込みツールおよび既に読み込まれたカスタムツールに対して拒否される。
- `.md` および `.json` ファイルは一部のプロバイダーによってツールメタデータとして検出されるが、実行可能モジュールローダーはこれらを実行可能なツールとして拒否する。
- 相対設定パスは `cwd` から解決され、`~` は展開される。

## モジュールコントラクト

カスタムツールモジュールは関数をエクスポートする必要があります（デフォルトエクスポート推奨）：

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
   // 必要に応じてリソースをクリーンアップ
  }
 },
});

export default factory;
```

ファクトリの戻り値の型：

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## ファクトリに渡される API サーフェス（`CustomToolAPI`）

`types.ts` および `loader.ts` より：

- `cwd`: ホストの作業ディレクトリ
- `exec(command, args, options?)`: プロセス実行ヘルパー
- `ui`: UI コンテキスト（ヘッドレスモードではノーオペレーションになる場合あり）
- `hasUI`: 非インタラクティブフローでは `false`
- `logger`: 共有ファイルロガー
- `typebox`: 注入された `@sinclair/typebox`
- `pi`: 注入された `@f5xc-salesdemos/xcsh` エクスポート
- `pushPendingAction(action)`: 非表示の `resolve` ツール用のプレビューアクションを登録（`docs/resolve-tool-runtime.md`）

ローダーはノーオペレーション UI コンテキストで開始し、実際の UI が準備できたときにホストコードが `setUIContext(...)` を呼び出す必要があります。

## 実行コントラクトと型付け

`CustomTool.execute` シグネチャ：

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` は TypeBox スキーマから `Static<TParams>` を通じて静的に型付けされる。
- ランタイム引数バリデーションはエージェントループの実行前に行われる。
- `onUpdate` は UI ストリーミング用の部分結果を発行する。
- `ctx` はセッション/モデルの状態と `abort()` ヘルパーを含む。
- `signal` はキャンセルを伝達する。

`CustomToolAdapter` はこれをエージェントツールインターフェースにブリッジし、正しい引数順序で呼び出しを転送します。

## ツールをモデルに公開する方法

- ツールは `AgentTool` インスタンス（`CustomToolAdapter` または拡張機能ラッパー）にラップされる。
- 名前によってセッションツールレジストリに挿入される。
- SDK ブートストラップでは、カスタムおよび拡張機能登録済みツールが初期アクティブセットに強制的に含まれる。
- CLI の `--tools` は現在、組み込みツール名のみをバリデーションする。カスタムツールの組み込みは、検出/登録パスおよび SDK オプションを通じて処理される。

## レンダリングフック

オプションのレンダリングフック：

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

TUI でのランタイム動作：

- フックが存在する場合、ツール出力は `Box` コンテナ内にレンダリングされる。
- `renderResult` は `{ expanded, isPartial, spinnerFrame? }` を受け取る。
- レンダラーエラーはキャッチされてログに記録され、UI はデフォルトのテキストレンダリングにフォールバックする。

## セッション/状態の処理

オプションの `onSession(event, ctx)` はセッションライフサイクルイベントを受け取ります。以下を含む：

- `start`、`switch`、`branch`、`tree`、`shutdown`
- `auto_compaction_start`、`auto_compaction_end`
- `auto_retry_start`、`auto_retry_end`
- `ttsr_triggered`、`todo_reminder`

ブランチ/セッションコンテキストが変わったときに履歴から状態を再構築するには `ctx.sessionManager` を使用してください。

## 失敗とキャンセルのセマンティクス

### 同期/非同期の失敗

- `execute` でのスロー（または拒否された Promise）はツール失敗として扱われる。
- エージェントランタイムは失敗を `isError: true` とエラーテキストコンテンツを含むツール結果メッセージに変換する。
- 拡張機能ラッパーを使用すると、`tool_result` ハンドラーがコンテンツ/詳細をさらに書き換え、エラーステータスをオーバーライドすることもできる。

### キャンセル

- エージェントのアボートは `AbortSignal` を通じて `execute` に伝達される。
- 協調的なキャンセルのために `signal` をサブプロセス作業（`pi.exec(..., { signal })`）に転送する。
- `ctx.abort()` を使用すると、ツールが現在のエージェント操作のアボートを要求できる。

### onSession エラー

- `onSession` エラーはキャッチされて警告としてログに記録され、セッションをクラッシュさせない。

## 設計上の実際の制約

- ツール名はアクティブなレジストリ内でグローバルに一意でなければならない。
- レンダラー/状態の再構築のために、`details` には決定論的でスキーマ形状の出力を優先する。
- `pi.hasUI` で UI の使用を保護する。
- ツールディレクトリ内の `.md`/`.json` はメタデータとして扱い、実行可能モジュールとしては扱わない。
