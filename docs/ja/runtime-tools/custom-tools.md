---
title: Custom Tools
description: エージェントを拡張するためのカスタムツール登録、スキーマ定義、実行パイプライン。
sidebar:
  order: 4
  label: カスタムツール
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# カスタムツール

カスタムツールは、ビルトインツールと同じツール実行パイプラインにプラグインされる、モデルから呼び出し可能な関数です。

カスタムツールは、ファクトリをエクスポートするTypeScript/JavaScriptモジュールです。ファクトリはホストAPI（`CustomToolAPI`）を受け取り、1つのツールまたはツールの配列を返します。

## これが何であるか（何でないか）

- **カスタムツール**: ターン中にモデルから呼び出し可能（`execute` + TypeBoxスキーマ）。
- **エクステンション**: ツールの登録やイベントのインターセプト/変更が可能なライフサイクル/イベントフレームワーク。
- **フック**: 外部のpre/postコマンドスクリプト。
- **スキル**: 静的なガイダンス/コンテキストパッケージであり、実行可能なツールコードではない。

モデルにコードを直接呼び出させる必要がある場合は、カスタムツールを使用してください。

## 現在のコードにおける統合パス

2つのアクティブな統合スタイルがあります：

1. **SDK提供のカスタムツール**（`options.customTools`）
   - `CustomToolAdapter`またはエクステンションラッパーを介してエージェントツールにラップされます。
   - SDKブートストラップ時に、常に初期アクティブツールセットに含まれます。

2. **ローダーAPIによるファイルシステム検出モジュール**（`discoverAndLoadCustomTools` / `loadCustomTools`）
   - `src/extensibility/custom-tools/loader.ts`でライブラリAPIとして公開されます。
   - ホストコードはこれらを呼び出して、config/provider/pluginパスからツールモジュールを検出・ロードできます。

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

## 検出場所（ローダーAPI）

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` は以下をマージします：

1. ケイパビリティプロバイダー（`toolCapability`）、以下を含む：
   - ネイティブOMP設定（`~/.xcsh/agent/tools`、`.xcsh/tools`）
   - Claude設定（`~/.claude/tools`、`.claude/tools`）
   - Codex設定（`~/.codex/tools`、`.codex/tools`）
   - Claudeマーケットプレイスプラグインキャッシュプロバイダー
2. インストール済みプラグインマニフェスト（プラグインローダー経由の`~/.xcsh/plugins/node_modules/*`）
3. ローダーに渡された明示的な設定パス

### 重要な動作

- 重複する解決済みパスは重複排除されます。
- ツール名の競合は、ビルトインおよび既にロード済みのカスタムツールに対して拒否されます。
- `.md`および`.json`ファイルは一部のプロバイダーによってツールメタデータとして検出されますが、実行可能モジュールローダーはそれらを実行可能なツールとして拒否します。
- 相対的な設定パスは`cwd`から解決されます。`~`は展開されます。

## モジュール契約

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
   // cleanup resources if needed
  }
 },
});

export default factory;
```

ファクトリの戻り値の型：

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## ファクトリに渡されるAPIサーフェス（`CustomToolAPI`）

`types.ts`および`loader.ts`より：

- `cwd`: ホストの作業ディレクトリ
- `exec(command, args, options?)`: プロセス実行ヘルパー
- `ui`: UIコンテキスト（ヘッドレスモードではno-opの場合あり）
- `hasUI`: 非インタラクティブフローでは`false`
- `logger`: 共有ファイルロガー
- `typebox`: 注入された`@sinclair/typebox`
- `pi`: 注入された`@f5xc-salesdemos/xcsh`エクスポート
- `pushPendingAction(action)`: 非表示の`resolve`ツール用にプレビューアクションを登録（`docs/resolve-tool-runtime.md`）

ローダーはno-op UIコンテキストで開始し、実際のUIの準備ができたときにホストコードが`setUIContext(...)`を呼び出す必要があります。

## 実行契約と型付け

`CustomTool.execute`のシグネチャ：

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params`はTypeBoxスキーマから`Static<TParams>`を介して静的に型付けされます。
- ランタイム引数の検証はエージェントループ内の実行前に行われます。
- `onUpdate`はUIストリーミング用の部分的な結果を発行します。
- `ctx`にはセッション/モデルの状態と`abort()`ヘルパーが含まれます。
- `signal`はキャンセルを伝搬します。

`CustomToolAdapter`はこれをエージェントツールインターフェースにブリッジし、正しい引数順序で呼び出しを転送します。

## ツールがモデルに公開される方法

- ツールは`AgentTool`インスタンス（`CustomToolAdapter`またはエクステンションラッパー）にラップされます。
- 名前によってセッションツールレジストリに挿入されます。
- SDKブートストラップでは、カスタムおよびエクステンション登録されたツールは初期アクティブセットに強制的に含まれます。
- CLI `--tools`は現在ビルトインツール名のみを検証します。カスタムツールの包含は検出/登録パスおよびSDKオプションを通じて処理されます。

## レンダリングフック

オプションのレンダリングフック：

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

TUIでのランタイム動作：

- フックが存在する場合、ツール出力は`Box`コンテナ内でレンダリングされます。
- `renderResult`は`{ expanded, isPartial, spinnerFrame? }`を受け取ります。
- レンダラーエラーはキャッチされログに記録されます。UIはデフォルトのテキストレンダリングにフォールバックします。

## セッション/状態の処理

オプションの`onSession(event, ctx)`はセッションライフサイクルイベントを受け取ります。以下を含みます：

- `start`、`switch`、`branch`、`tree`、`shutdown`
- `auto_compaction_start`、`auto_compaction_end`
- `auto_retry_start`、`auto_retry_end`
- `ttsr_triggered`、`todo_reminder`

ブランチ/セッションコンテキストが変更された場合は、`ctx.sessionManager`を使用して履歴から状態を再構築してください。

## 失敗とキャンセルのセマンティクス

### 同期/非同期の失敗

- `execute`でのスロー（またはリジェクトされたPromise）はツールの失敗として扱われます。
- エージェントランタイムは失敗を`isError: true`とエラーテキストコンテンツを持つツール結果メッセージに変換します。
- エクステンションラッパーでは、`tool_result`ハンドラーがさらにコンテンツ/詳細を書き換え、エラーステータスをオーバーライドすることもできます。

### キャンセル

- エージェントのアボートは`AbortSignal`を通じて`execute`に伝搬されます。
- 協調的なキャンセルのために、サブプロセスの作業に`signal`を転送してください（`pi.exec(..., { signal })`）。
- `ctx.abort()`により、ツールは現在のエージェント操作のアボートを要求できます。

### onSessionのエラー

- `onSession`のエラーはキャッチされ警告としてログに記録されます。セッションがクラッシュすることはありません。

## 設計上の実際の制約

- ツール名はアクティブレジストリ内でグローバルに一意でなければなりません。
- レンダラー/状態再構築のために、`details`では決定論的でスキーマ形状の出力を優先してください。
- UI使用は`pi.hasUI`でガードしてください。
- ツールディレクトリ内の`.md`/`.json`はメタデータとして扱い、実行可能モジュールとしては扱わないでください。
