---
title: RPCプロトコルリファレンス
description: xcshコンポーネント間のプロセス間通信のためのJSON-RPCプロトコルリファレンス。
sidebar:
  order: 5
  label: RPCプロトコル
i18n:
  sourceHash: b4a3ddaf08ab
  translator: machine
---

# RPCプロトコルリファレンス

RPCモードは、stdio上の改行区切りJSONプロトコルとしてコーディングエージェントを実行します。

- **stdin**: コマンド（`RpcCommand`）および拡張UIレスポンス
- **stdout**: コマンドレスポンス（`RpcResponse`）、セッション/エージェントイベント、拡張UIリクエスト

主要な実装:

- `src/modes/rpc/rpc-mode.ts`
- `src/modes/rpc/rpc-types.ts`
- `src/session/agent-session.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`

## 起動

```bash
xcsh --mode rpc [regular CLI options]
```

動作に関する注意事項:

- RPCモードでは`@file` CLI引数は拒否されます。
- RPCモードでは、追加のモデル呼び出しを避けるため、デフォルトで自動セッションタイトル生成が無効になっています。
- RPCモードでは、ユーザーのオーバーライドを継承する代わりに、ワークフローに影響する`todo.*`、`task.*`、`async.*`設定を組み込みのデフォルト値にリセットします。
- プロセスはstdinをJSONL（`readJsonl(Bun.stdin.stream())`）として読み取ります。
- stdinが閉じられると、プロセスはコード`0`で終了します。
- レスポンス/イベントは1行につき1つのJSONオブジェクトとして書き込まれます。

## トランスポートとフレーミング

各フレームは、`\n`が続く単一のJSONオブジェクトです。

オブジェクトの形状自体以外にエンベロープはありません。

### 送信フレームカテゴリ（stdout）

1. `RpcResponse`（`{ type: "response", ... }`）
2. `AgentSessionEvent`オブジェクト（`agent_start`、`message_update`など）
3. `RpcExtensionUIRequest`（`{ type: "extension_ui_request", ... }`）
4. 拡張エラー（`{ type: "extension_error", extensionPath, event, error }`）

### 受信フレームカテゴリ（stdin）

1. `RpcCommand`
2. `RpcExtensionUIResponse`（`{ type: "extension_ui_response", ... }`）

## リクエスト/レスポンスの相関

すべてのコマンドはオプションの`id?: string`を受け付けます。

- 指定された場合、通常のコマンドレスポンスは同じ`id`をエコーします。
- `RpcClient`はこれを保留中のリクエスト解決に利用します。

ランタイムの重要なエッジ動作:

- 不明なコマンドのレスポンスは`id: undefined`で送出されます（リクエストに`id`が含まれていた場合でも）。
- 入力ループでのパース/ハンドラの例外は`command: "parse"`、`id: undefined`で送出されます。
- `prompt`と`abort_and_prompt`は即座に成功を返しますが、非同期プロンプトのスケジューリングが失敗した場合、**同じ** idで後からエラーレスポンスを送出することがあります。

## コマンドスキーマ（正規）

`RpcCommand`は`src/modes/rpc/rpc-types.ts`で定義されています:

### プロンプト

- `{ id?, type: "prompt", message: string, images?: ImageContent[], streamingBehavior?: "steer" | "followUp" }`
- `{ id?, type: "steer", message: string, images?: ImageContent[] }`
- `{ id?, type: "follow_up", message: string, images?: ImageContent[] }`
- `{ id?, type: "abort" }`
- `{ id?, type: "abort_and_prompt", message: string, images?: ImageContent[] }`
- `{ id?, type: "new_session", parentSession?: string }`

### 状態

- `{ id?, type: "get_state" }`
- `{ id?, type: "set_todos", phases: TodoPhase[] }`
- `{ id?, type: "set_host_tools", tools: RpcHostToolDefinition[] }`

### モデル

- `{ id?, type: "set_model", provider: string, modelId: string }`
- `{ id?, type: "cycle_model" }`
- `{ id?, type: "get_available_models" }`

### 思考

- `{ id?, type: "set_thinking_level", level: ThinkingLevel }`
- `{ id?, type: "cycle_thinking_level" }`

### キューモード

- `{ id?, type: "set_steering_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_follow_up_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_interrupt_mode", mode: "immediate" | "wait" }`

### コンパクション

- `{ id?, type: "compact", customInstructions?: string }`
- `{ id?, type: "set_auto_compaction", enabled: boolean }`

### リトライ

- `{ id?, type: "set_auto_retry", enabled: boolean }`
- `{ id?, type: "abort_retry" }`

### Bash

- `{ id?, type: "bash", command: string }`
- `{ id?, type: "abort_bash" }`

### セッション

- `{ id?, type: "get_session_stats" }`
- `{ id?, type: "export_html", outputPath?: string }`
- `{ id?, type: "switch_session", sessionPath: string }`
- `{ id?, type: "branch", entryId: string }`
- `{ id?, type: "get_branch_messages" }`
- `{ id?, type: "get_last_assistant_text" }`
- `{ id?, type: "set_session_name", name: string }`

### メッセージ

- `{ id?, type: "get_messages" }`

## レスポンススキーマ

すべてのコマンド結果は`RpcResponse`を使用します:

- 成功: `{ id?, type: "response", command: <command>, success: true, data?: ... }`
- 失敗: `{ id?, type: "response", command: string, success: false, error: string }`

データペイロードはコマンド固有であり、`rpc-types.ts`で定義されています。

### `get_state` ペイロード

```json
{
  "model": { "provider": "...", "id": "..." },
  "thinkingLevel": "off|minimal|low|medium|high|xhigh",
  "isStreaming": false,
  "isCompacting": false,
  "steeringMode": "all|one-at-a-time",
  "followUpMode": "all|one-at-a-time",
  "interruptMode": "immediate|wait",
  "sessionFile": "...",
  "sessionId": "...",
  "sessionName": "...",
  "autoCompactionEnabled": true,
  "messageCount": 0,
  "queuedMessageCount": 0,
  "todoPhases": [
    {
      "id": "phase-1",
      "name": "Todos",
      "tasks": [
        {
          "id": "task-1",
          "content": "Map the tool surface",
          "status": "in_progress"
        }
      ]
    }
  ]
}
```

### `set_todos` ペイロード

現在のセッションのインメモリtodo状態を置き換え、正規化されたフェーズリストを返します:

```json
{
  "id": "req_2",
  "type": "set_todos",
  "phases": [
    {
      "id": "phase-1",
      "name": "Evaluation",
      "tasks": [
        {
          "id": "task-1",
          "content": "Map the read tool surface",
          "status": "in_progress"
        },
        {
          "id": "task-2",
          "content": "Exercise edit operations",
          "status": "pending"
        }
      ]
    }
  ]
}
```

これは、最初のプロンプトの前にプランを事前設定したいホストに便利です。

### `set_host_tools` ペイロード

RPCサーバーがstdio経由でコールバックできるホスト所有のツールの現在のセットを置き換えます:

```json
{
  "id": "req_3",
  "type": "set_host_tools",
  "tools": [
    {
      "name": "echo_host",
      "label": "Echo Host",
      "description": "Echo a value from the embedding host",
      "parameters": {
        "type": "object",
        "properties": {
          "message": { "type": "string" }
        },
        "required": ["message"],
        "additionalProperties": false
      }
    }
  ]
}
```

レスポンスペイロードは:

```json
{
  "toolNames": ["echo_host"]
}
```

これらのツールは次のモデル呼び出しの前にアクティブセッションのツールレジストリに追加されます。`set_host_tools`を再送信すると、以前のホスト所有セットが置き換えられます。

## イベントストリームスキーマ

RPCモードは`AgentSession.subscribe(...)`から`AgentSessionEvent`オブジェクトを転送します。

一般的なイベントタイプ:

- `agent_start`、`agent_end`
- `turn_start`、`turn_end`
- `message_start`、`message_update`、`message_end`
- `tool_execution_start`、`tool_execution_update`、`tool_execution_end`
- `auto_compaction_start`、`auto_compaction_end`
- `auto_retry_start`、`auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`
- `todo_auto_clear`

拡張ランナーのエラーは以下のように別途送出されます:

```json
{ "type": "extension_error", "extensionPath": "...", "event": "...", "error": "..." }
```

`message_update`には`assistantMessageEvent`（テキスト/思考/ツールコールのデルタ）にストリーミングデルタが含まれます。

## プロンプト/キューの並行性と順序

これは最も重要な運用上の動作です。

### 即時確認 vs 完了

`prompt`と`abort_and_prompt`は**即座に確認応答されます**:

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
```

これは以下を意味します:

- コマンド受理 != 実行完了
- 最終的な完了は`agent_end`を通じて確認されます

### ストリーミング中

`AgentSession.prompt()`はアクティブなストリーミング中に`streamingBehavior`を必要とします:

- `"steer"` => キューに入れられたステアリングメッセージ（割り込みパス）
- `"followUp"` => キューに入れられたフォローアップメッセージ（ターン後パス）

ストリーミング中に省略すると、プロンプトは失敗します。

### キューのデフォルト

コーディングエージェント設定スキーマ（`packages/coding-agent/src/config/settings-schema.ts`）より:

- `steeringMode`: `"one-at-a-time"`
- `followUpMode`: `"one-at-a-time"`
- `interruptMode`: `"wait"`

### モードのセマンティクス

- `set_steering_mode` / `set_follow_up_mode`
  - `"one-at-a-time"`: ターンごとにキューから1つのメッセージをデキュー
  - `"all"`: キュー全体を一度にデキュー
- `set_interrupt_mode`
  - `"immediate"`: ツール実行がツールコール間でステアリングをチェックし、保留中のステアリングがターン内の残りのツールコールを中止できる
  - `"wait"`: ステアリングをターン完了まで延期

## 拡張UIサブプロトコル

RPCモードの拡張機能はリクエスト/レスポンスUIフレームを使用します。

### 送信リクエスト

`RpcExtensionUIRequest`（`type: "extension_ui_request"`）のメソッド:

- `select`、`confirm`、`input`、`editor`
- `notify`、`setStatus`、`setWidget`、`setTitle`、`set_editor_text`

ランタイムに関する注意:

- RPCモードでは自動セッションタイトル生成が無効化されており、`setTitle` UIリクエストもデフォルトで抑制されます。これは、ほとんどのホストが意味のあるターミナルタイトルサーフェスを持たないためです。UIイベントのみを再度有効にするには`PI_RPC_EMIT_TITLE=1`を設定してください。

例:

```json
{ "type": "extension_ui_request", "id": "123", "method": "confirm", "title": "Confirm", "message": "Continue?", "timeout": 30000 }
```

### 受信レスポンス

`RpcExtensionUIResponse`（`type: "extension_ui_response"`）:

- `{ type: "extension_ui_response", id: string, value: string }`
- `{ type: "extension_ui_response", id: string, confirmed: boolean }`
- `{ type: "extension_ui_response", id: string, cancelled: true }`

ダイアログにタイムアウトがある場合、RPCモードはタイムアウト/中止が発生するとデフォルト値で解決します。

## ホストツールサブプロトコル

RPCホストは`set_host_tools`を送信し、同じトランスポート上で実行リクエストを処理することで、カスタムツールをエージェントに公開できます。

### 送信リクエスト

エージェントがホストにそれらのツールの1つを実行させたい場合、RPCモードは以下を送出します:

```json
{
  "type": "host_tool_call",
  "id": "host_1",
  "toolCallId": "toolu_123",
  "toolName": "echo_host",
  "arguments": { "message": "hello" }
}
```

ツール実行が後で中止された場合、RPCモードは以下を送出します:

```json
{
  "type": "host_tool_cancel",
  "id": "host_cancel_1",
  "targetId": "host_1"
}
```

### 受信アップデートと完了

ホストはオプションで進捗をストリーミングできます:

```json
{
  "type": "host_tool_update",
  "id": "host_1",
  "partialResult": {
    "content": [{ "type": "text", "text": "working" }]
  }
}
```

完了には以下を使用します:

```json
{
  "type": "host_tool_result",
  "id": "host_1",
  "result": {
    "content": [{ "type": "text", "text": "done" }]
  }
}
```

返されたコンテンツをツールエラーとして表面化するには、`host_tool_result`に`isError: true`を設定します。

## エラーモデルとリカバリ性

### コマンドレベルの失敗

失敗は`success: false`と文字列`error`で表されます。

```json
{ "id": "req_2", "type": "response", "command": "set_model", "success": false, "error": "Model not found: provider/model" }
```

### リカバリ性の期待

- ほとんどのコマンド失敗はリカバリ可能で、プロセスは生き続けます。
- 不正なJSONL / パースループの例外は`parse`エラーレスポンスを送出し、後続の行の読み取りを続行します。
- 空の`set_session_name`は拒否されます（`Session name cannot be empty`）。
- 不明な`id`を持つ拡張UIレスポンスは無視されます。
- プロセス終了条件はstdinのクローズまたは拡張機能によって明示的にトリガーされたシャットダウンです。

## コンパクトなコマンドフロー

### 1) プロンプトとストリーム

stdin:

```json
{ "id": "req_1", "type": "prompt", "message": "Summarize this repo" }
```

stdout シーケンス（典型的）:

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
{ "type": "agent_start" }
{ "type": "message_update", "assistantMessageEvent": { "type": "text_delta", "delta": "..." }, "message": { "role": "assistant", "content": [] } }
{ "type": "agent_end", "messages": [] }
```

### 2) 明示的なキューポリシーでのストリーミング中のプロンプト

stdin:

```json
{ "id": "req_2", "type": "prompt", "message": "Also include risks", "streamingBehavior": "followUp" }
```

### 3) キュー動作の検査とチューニング

stdin:

```json
{ "id": "q1", "type": "get_state" }
{ "id": "q2", "type": "set_steering_mode", "mode": "all" }
{ "id": "q3", "type": "set_interrupt_mode", "mode": "wait" }
```

### 4) 拡張UIラウンドトリップ

stdout:

```json
{ "type": "extension_ui_request", "id": "ui_7", "method": "input", "title": "Branch name", "placeholder": "feature/..." }
```

stdin:

```json
{ "type": "extension_ui_response", "id": "ui_7", "value": "feature/rpc-host" }
```

## `RpcClient`ヘルパーに関する注意

`src/modes/rpc/rpc-client.ts`は利便性のためのラッパーであり、プロトコル定義ではありません。

現在のヘルパーの特性:

- `bun <cliPath> --mode rpc`を生成します
- 生成された`req_<n>` idでレスポンスを相関させます
- 認識された`AgentEvent`タイプのみをリスナーにディスパッチします
- `setCustomTools()`およびホスト所有カスタムツールの`host_tool_call` / `host_tool_cancel`の自動処理をサポートします
- すべてのプロトコルコマンドに対するヘルパーメソッドを公開して**いません**（例えば、`set_interrupt_mode`と`set_session_name`はプロトコルタイプにはありますが、専用メソッドとしてラップされていません）

完全なサーフェスカバレッジが必要な場合は、生のプロトコルフレームを使用してください。
