---
title: プロバイダーストリーミングの内部構造
description: SSE解析、トークンカウント、バックプレッシャー処理を含むプロバイダーストリーミングの実装。
sidebar:
  order: 2
  label: ストリーミングの内部構造
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# プロバイダーストリーミングの内部構造

このドキュメントでは、`@f5xc-salesdemos/pi-ai` におけるトークン/ツールストリーミングの正規化と、`@f5xc-salesdemos/pi-agent-core` および `coding-agent` セッションイベントを通じた伝播方法について説明します。

## エンドツーエンドのフロー

1. `streamSimple()`（`packages/ai/src/stream.ts`）が汎用オプションをマッピングし、プロバイダーストリーム関数にディスパッチします。
2. プロバイダーストリーム関数（`anthropic.ts`、`openai-responses.ts`、`google.ts`）が、プロバイダー固有のストリームイベントを統一された `AssistantMessageEvent` シーケンスに変換します。
3. 各プロバイダーが `AssistantMessageEventStream`（`packages/ai/src/utils/event-stream.ts`）にイベントをプッシュし、デルタイベントのスロットリングを行い、以下を公開します：
   - インクリメンタル更新のための非同期イテレーション
   - 最終的な `AssistantMessage` を取得する `result()`
4. `agentLoop`（`packages/agent/src/agent-loop.ts`）がそれらのイベントを消費し、処理中のアシスタント状態を変更し、生の `assistantMessageEvent` を含む `message_update` イベントを発行します。
5. `AgentSession`（`packages/coding-agent/src/session/agent-session.ts`）がエージェントイベントをサブスクライブし、メッセージを永続化し、拡張フックを駆動し、セッションビヘイビア（リトライ、コンパクション、TTSR、ストリーミング編集の中断チェック）を適用します。

## `@f5xc-salesdemos/pi-ai` の統一ストリームコントラクト

すべてのプロバイダーが同じ形式（`packages/ai/src/types.ts` の `AssistantMessageEvent`）を発行します：

- `start`
- コンテンツブロックのライフサイクルトリプレット：
  - テキスト: `text_start` → `text_delta`* → `text_end`
  - 思考: `thinking_start` → `thinking_delta`* → `thinking_end`
  - ツール呼び出し: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- 終端イベント：
  - `done`（`reason: "stop" | "length" | "toolUse"`）
  - または `error`（`reason: "aborted" | "error"`）

`AssistantMessageEventStream` の保証事項：

- 最終結果は終端イベント（`done` または `error`）によって解決される
- デルタはバッチ/スロットリングされる（約50ms）
- バッファリングされたデルタは非デルタイベントの前および完了前にフラッシュされる

## デルタスロットリングとハーモナイゼーションの動作

`AssistantMessageEventStream` は `text_delta`、`thinking_delta`、`toolcall_delta` をマージ可能なイベントとして扱います：

- バッファリングされたデルタは **type + contentIndex** が一致する場合のみマージされる
- マージ時は最新の `partial` スナップショットが保持される
- 非デルタイベントは即時フラッシュを強制する

これにより、高頻度のプロバイダーストリームがTUI/イベントコンシューマー向けに平滑化されますが、プロバイダーへのバックプレッシャーではありません。プロバイダーは引き続きフルスピードで生成し、ローカルストリームがバッファリングします。

## プロバイダー正規化の詳細

## Anthropic（`anthropic-messages`）

ソース: `packages/ai/src/providers/anthropic.ts`

正規化ポイント：

- `message_start` が使用量（入力/出力/キャッシュトークン）を初期化
- `content_block_start` がテキスト/思考/ツール呼び出しの開始にマッピング
- `content_block_delta` のマッピング：
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` は `thinkingSignature` のみを更新（イベントなし）
- `content_block_stop` が対応する `*_end` を発行
- `message_delta.stop_reason` が `mapStopReason()` 経由でマッピング

ツール呼び出し引数のストリーミング：

- 各ツールブロックが内部の `partialJson` を保持
- 各JSONデルタが `partialJson` に追加
- `arguments` は各デルタごとに `parseStreamingJson()` で再パースされる
- `toolcall_end` でもう一度再パースし、`partialJson` を除去

## OpenAI Responses（`openai-responses`）

ソース: `packages/ai/src/providers/openai-responses.ts`

正規化ポイント：

- `response.output_item.added` が推論/テキスト/関数呼び出しブロックを開始
- 推論サマリーイベント（`response.reasoning_summary_text.delta`）が `thinking_delta` になる
- 出力/拒否デルタが `text_delta` になる
- `response.function_call_arguments.delta` が `toolcall_delta` になる
- `response.output_item.done` が `thinking_end` / `text_end` / `toolcall_end` を発行
- `response.completed` がステータスを停止理由と使用量にマッピング

ツール呼び出し引数のストリーミング：

- Anthropicと同じ `partialJson` 蓄積パターン
- `response.function_call_arguments.done` のみを送信するプロバイダーでも最終引数は設定される
- ツール呼び出しIDは `"<call_id>|<item_id>"` として正規化

## Google Generative AI（`google-generative-ai`）

ソース: `packages/ai/src/providers/google.ts`

正規化ポイント：

- `candidate.content.parts` をイテレート
- テキストパートが `isThinkingPart(part)` により思考とテキストに分類
- ブロック遷移時に新しいブロックを開始する前に前のブロックを閉じる
- `part.functionCall` は完全なツール呼び出しとして扱われる（start/delta/endが即座に発行）
- 終了理由は `google-shared.ts` の `mapStopReason()` でマッピング

ツール呼び出し引数のストリーミング：

- 関数呼び出し引数はインクリメンタルなJSONテキストではなく構造化オブジェクトとして到着
- 実装は `JSON.stringify(arguments)` を含む合成的な `toolcall_delta` を1つ発行
- このパスではGoogleに対して部分JSONパーサーは不要

## 部分的なツール呼び出しJSON蓄積とリカバリ

Anthropic/OpenAI Responsesの共通動作は `parseStreamingJson()`（`packages/ai/src/utils/json-parse.ts`）を使用します：

1. `JSON.parse` を試行
2. 不完全なフラグメントに対して `partial-json` パーサーにフォールバック
3. 両方失敗した場合は `{}` を返す

影響：

- 不正または切り捨てられた引数デルタがストリーム処理を即座にクラッシュさせることはない
- 処理中の `arguments` は一時的に `{}` になる場合がある
- 後続の有効なデルタで構造化された引数をリカバリできる（各追加時にパースが再試行されるため）
- 最終的な `toolcall_end` は発行前にもう一度パースを試行する

## 停止理由 vs トランスポート/ランタイムエラー

プロバイダーの停止理由は正規化された `stopReason` にマッピングされます：

- Anthropic: `end_turn`→`stop`、`max_tokens`→`length`、`tool_use`→`toolUse`、安全性/拒否ケース→`error`
- OpenAI Responses: `completed`→`stop`、`incomplete`→`length`、`failed/cancelled`→`error`
- Google: `STOP`→`stop`、`MAX_TOKENS`→`length`、安全性/禁止/不正な関数呼び出しクラス→`error`

エラーセマンティクスは2つのステージに分かれます：

1. **モデル完了セマンティクス**（プロバイダーが報告する終了理由/ステータス）
2. **トランスポート/ランタイム障害**（ネットワーク/クライアント/パーサー/中断例外）

プロバイダーストリームがスローまたは障害を通知した場合、各プロバイダーラッパーがキャッチし、以下の内容で終端 `error` イベントを発行します：

- 中断シグナルが設定されている場合 `stopReason = "aborted"`
- それ以外は `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## 不正なチャンク / SSEパース失敗時の動作

これらのプロバイダーパスでは、チャンク/SSEフレーミングはベンダーSDKストリーム（Anthropic SDK、OpenAI SDK、Google SDK）によって処理されます。このコードではカスタムSSEデコーダーを実装していません。

現在の実装で観察される動作：

- SDKレベルでの不正なチャンク/SSEパースは例外またはストリーム `error` イベントとして表面化
- プロバイダーラッパーがそれを統一された終端 `error` イベントに変換
- ストリーム関数内部でのプロバイダー固有の再開/リトライは行わない
- より上位レベルのリトライは `AgentSession` の自動リトライロジックで処理される（ストリームチャンクリプレイではなく、メッセージレベルのリトライ）

## キャンセル境界

キャンセルはレイヤー化されています：

- AIプロバイダーリクエスト: `options.signal` がプロバイダークライアントのストリーム呼び出しに渡される。
- プロバイダーラッパー: ストリームループ後、中断されたシグナルがエラーパスを強制する（`"Request was aborted"`）。
- エージェントループ: 各プロバイダーイベントの処理前に `signal.aborted` をチェックし、最新の部分データから中断されたアシスタントメッセージを合成できる。
- セッション/エージェント制御: `AgentSession.abort()` → `agent.abort()` → 共有アボートコントローラーのキャンセル。

ツール実行のキャンセルはモデルストリームのキャンセルとは別です：

- ツールランナーは `AbortSignal.any([agentSignal, steeringAbortSignal])` を使用
- ステアリング割り込みは、既に生成されたツール結果を保持しつつ、残りのツール実行を中断できる

## バックプレッシャー境界

プロバイダーSDKストリームとダウンストリームコンシューマー間にハードなバックプレッシャーメカニズムはありません：

- `EventStream` は最大サイズのないインメモリキューを使用
- スロットリングはUI更新レートを削減するが、プロバイダーの取り込みを遅くしない
- コンシューマーが大幅に遅延した場合、キューイングされたイベントは完了まで増加する可能性がある

現在の設計は、バウンデッドバッファのフロー制御よりも応答性とシンプルな順序保証を重視しています。

## ストリームイベントがエージェント/セッションイベントとして表面化する方法

`agentLoop.streamAssistantResponse()` が `AssistantMessageEvent` を `AgentEvent` にブリッジします：

- `start` 時: プレースホルダーのアシスタントメッセージをプッシュし、`message_start` を発行
- ブロックイベント（`text_*`、`thinking_*`、`toolcall_*`）時: 最後のアシスタントメッセージを更新し、生の `assistantMessageEvent` を含む `message_update` を発行
- 終端（`done`/`error`）時: `response.result()` から最終メッセージを解決し、`message_end` を発行

`AgentSession` はその後、セッションレベルのビヘイビアのためにそれらのイベントを消費します：

- TTSRは `message_update.assistantMessageEvent` の `text_delta` と `toolcall_delta` を監視
- ストリーミング編集ガードは `edit` 呼び出し時の `toolcall_delta`/`toolcall_end` を検査し、早期中断が可能
- 永続化は `message_end` でファイナライズされたメッセージを書き込む
- 自動リトライはアシスタントの `stopReason === "error"` と `errorMessage` のヒューリスティクスを検査

## 統一 vs プロバイダー固有の責任

統一（共通コントラクト）：

- イベント形式（`AssistantMessageEvent`）
- 最終結果の抽出（`done`/`error`）
- デルタスロットリング + マージルール
- エージェント/セッションイベントの伝播モデル

プロバイダー固有（完全には抽象化されていない）：

- 上流イベントの分類体系とマッピングロジック
- 停止理由の変換テーブル
- ツール呼び出しIDの規則
- 推論/思考ブロックのセマンティクスとシグネチャ
- 使用量トークンのセマンティクスと利用可能タイミング
- API固有のメッセージ変換制約

## 実装ファイル

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — プロバイダーディスパッチ、オプションマッピング、APIキー/セッションプラミング。
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — 汎用ストリームキュー + アシスタントデルタスロットリング。
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — ストリーミングされたツール引数の部分JSONパース。
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — Anthropicイベント変換とツールJSONデルタ蓄積。
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI Responsesイベント変換とステータスマッピング。
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Geminiストリームチャンクからブロックへの変換。
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Gemini終了理由マッピングと共有変換ルール。
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — プロバイダーストリーム消費と `message_update` ブリッジング。
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — ストリーミング更新、中断、リトライ、永続化のセッションレベル処理。
