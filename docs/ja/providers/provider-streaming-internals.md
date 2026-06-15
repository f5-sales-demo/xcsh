---
title: プロバイダーストリーミング内部実装
description: SSEパース、トークンカウント、バックプレッシャー処理を含むプロバイダーストリーミング実装。
sidebar:
  order: 2
  label: ストリーミング内部実装
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# プロバイダーストリーミング内部実装

このドキュメントでは、`@f5xc-salesdemos/pi-ai` においてトークン/ツールストリーミングがどのように正規化され、`@f5xc-salesdemos/pi-agent-core` および `coding-agent` セッションイベントを通じて伝播されるかを説明します。

## エンドツーエンドのフロー

1. `streamSimple()`（`packages/ai/src/stream.ts`）は汎用オプションをマップし、プロバイダーストリーム関数にディスパッチします。
2. プロバイダーストリーム関数（`anthropic.ts`、`openai-responses.ts`、`google.ts`）は、プロバイダーネイティブのストリームイベントを統一された `AssistantMessageEvent` シーケンスに変換します。
3. 各プロバイダーはイベントを `AssistantMessageEventStream`（`packages/ai/src/utils/event-stream.ts`）にプッシュします。これはデルタイベントをスロットリングし、以下を公開します：
   - インクリメンタル更新のための非同期イテレーション
   - 最終的な `AssistantMessage` のための `result()`
4. `agentLoop`（`packages/agent/src/agent-loop.ts`）はこれらのイベントを消費し、処理中のアシスタント状態を変更して、生の `assistantMessageEvent` を含む `message_update` イベントを発行します。
5. `AgentSession`（`packages/coding-agent/src/session/agent-session.ts`）はエージェントイベントをサブスクライブし、メッセージを永続化し、拡張フックを駆動し、セッション動作（リトライ、コンパクション、TTSR、ストリーミング編集中断チェック）を適用します。

## `@f5xc-salesdemos/pi-ai` における統一ストリームコントラクト

すべてのプロバイダーは同一の形状（`packages/ai/src/types.ts` の `AssistantMessageEvent`）を出力します：

- `start`
- コンテンツブロックのライフサイクルトリプレット：
  - テキスト：`text_start` → `text_delta`* → `text_end`
  - シンキング：`thinking_start` → `thinking_delta`* → `thinking_end`
  - ツールコール：`toolcall_start` → `toolcall_delta`* → `toolcall_end`
- ターミナルイベント：
  - `done`（`reason: "stop" | "length" | "toolUse"` を含む）
  - または `error`（`reason: "aborted" | "error"` を含む）

`AssistantMessageEventStream` が保証する内容：

- 最終結果はターミナルイベント（`done` または `error`）によって解決される
- デルタはバッチ処理/スロットリングされる（約50ms）
- バッファリングされたデルタは非デルタイベントの前および完了前にフラッシュされる

## デルタスロットリングと調和動作

`AssistantMessageEventStream` は `text_delta`、`thinking_delta`、`toolcall_delta` をマージ可能なイベントとして扱います：

- バッファリングされたデルタは **type + contentIndex** が一致する場合のみマージされる
- マージでは最新の `partial` スナップショットが保持される
- 非デルタイベントは即時フラッシュを強制する

これにより、TUI/イベントコンシューマーに対して高頻度のプロバイダーストリームが平滑化されますが、プロバイダーのバックプレッシャーではありません：プロバイダーは依然としてフルスピードで生産しており、ローカルストリームがバッファリングします。

## プロバイダー正規化の詳細

## Anthropic (`anthropic-messages`)

ソース：`packages/ai/src/providers/anthropic.ts`

正規化ポイント：

- `message_start` は使用量（入力/出力/キャッシュトークン）を初期化する
- `content_block_start` はテキスト/シンキング/ツールコール開始にマップされる
- `content_block_delta` のマッピング：
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` は `thinkingSignature` のみを更新する（イベントなし）
- `content_block_stop` は対応する `*_end` を発行する
- `message_delta.stop_reason` は `mapStopReason()` を介してマップされる

ツールコール引数ストリーミング：

- 各ツールブロックは内部 `partialJson` を保持する
- 各JSONデルタは `partialJson` に追記される
- `arguments` はデルタごとに `parseStreamingJson()` を介して再パースされる
- `toolcall_end` はもう一度パースしてから `partialJson` を除去する

## OpenAI Responses (`openai-responses`)

ソース：`packages/ai/src/providers/openai-responses.ts`

正規化ポイント：

- `response.output_item.added` はリーズニング/テキスト/ファンクションコールブロックを開始する
- リーズニングサマリーイベント（`response.reasoning_summary_text.delta`）は `thinking_delta` になる
- 出力/拒否デルタは `text_delta` になる
- `response.function_call_arguments.delta` は `toolcall_delta` になる
- `response.output_item.done` は `thinking_end` / `text_end` / `toolcall_end` を発行する
- `response.completed` はステータスをストップ理由と使用量にマップする

ツールコール引数ストリーミング：

- Anthropic と同じ `partialJson` 蓄積パターン
- `response.function_call_arguments.done` のみを送信するプロバイダーでも最終引数を設定できる
- ツールコールIDは `"<call_id>|<item_id>"` として正規化される

## Google Generative AI (`google-generative-ai`)

ソース：`packages/ai/src/providers/google.ts`

正規化ポイント：

- `candidate.content.parts` をイテレートする
- テキストパーツは `isThinkingPart(part)` によってシンキングとテキストに分割される
- ブロック遷移は新しいブロックを開始する前に前のブロックを閉じる
- `part.functionCall` は完全なツールコールとして扱われる（start/delta/end が即座に発行される）
- フィニッシュ理由は `google-shared.ts` の `mapStopReason()` によってマップされる

ツールコール引数ストリーミング：

- ファンクションコール引数はインクリメンタルなJSONテキストではなく、構造化オブジェクトとして届く
- 実装は `JSON.stringify(arguments)` を含む1つの合成 `toolcall_delta` を発行する
- このパスではGoogleに対して部分的なJSONパーサーは不要

## ツールコール部分JSONの蓄積とリカバリー

Anthropic/OpenAI Responses の共通動作では `parseStreamingJson()`（`packages/ai/src/utils/json-parse.ts`）を使用します：

1. `JSON.parse` を試みる
2. 不完全なフラグメントに対して `partial-json` パーサーにフォールバックする
3. 両方が失敗した場合、`{}` を返す

影響：

- 不正または切り捨てられた引数デルタは即座にストリーム処理をクラッシュさせない
- 処理中の `arguments` は一時的に `{}` になる可能性がある
- 後続の有効なデルタは、すべての追記でパースが再試行されるため、構造化された引数をリカバリーできる
- 最終的な `toolcall_end` は発行前にもう一度パースを試みる

## ストップ理由とトランスポート/ランタイムエラー

プロバイダーのストップ理由は正規化された `stopReason` にマップされます：

- Anthropic：`end_turn`→`stop`、`max_tokens`→`length`、`tool_use`→`toolUse`、安全性/拒否ケース→`error`
- OpenAI Responses：`completed`→`stop`、`incomplete`→`length`、`failed/cancelled`→`error`
- Google：`STOP`→`stop`、`MAX_TOKENS`→`length`、安全性/禁止/不正なファンクションコールクラス→`error`

エラーセマンティクスは2段階に分かれています：

1. **モデル完了セマンティクス**（プロバイダーが報告したフィニッシュ理由/ステータス）
2. **トランスポート/ランタイム障害**（ネットワーク/クライアント/パーサー/中断例外）

プロバイダーストリームがスローまたは障害を通知した場合、各プロバイダーラッパーはこれをキャッチし、以下を含むターミナル `error` イベントを発行します：

- 中断シグナルが設定されている場合：`stopReason = "aborted"`
- それ以外の場合：`stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## 不正なチャンク / SSEパース失敗の動作

これらのプロバイダーパスでは、チャンク/SSEフレーミングはベンダーSDKストリーム（Anthropic SDK、OpenAI SDK、Google SDK）によって処理されます。このコードではカスタムSSEデコーダーは実装していません。

現在の実装における観察された動作：

- SDKレベルでの不正なチャンク/SSEパースは、例外またはストリームの `error` イベントとして表面化する
- プロバイダーラッパーはそれを統一されたターミナル `error` イベントに変換する
- ストリーム関数自体にはプロバイダー固有の再開/リトライは存在しない
- より高いレベルのリトライは `AgentSession` の自動リトライロジックで処理される（メッセージレベルのリトライであり、ストリームチャンクの再生ではない）

## キャンセルの境界

キャンセルは階層化されています：

- AIプロバイダーリクエスト：`options.signal` はプロバイダークライアントのストリームコールに渡される。
- プロバイダーラッパー：ストリームループの後、中断されたシグナルはエラーパス（`"Request was aborted"`）を強制する。
- エージェントループ：各プロバイダーイベントを処理する前に `signal.aborted` を確認し、最新のパーシャルから中断されたアシスタントメッセージを合成できる。
- セッション/エージェントコントロール：`AgentSession.abort()` → `agent.abort()` → 共有中断コントローラーのキャンセル。

ツール実行のキャンセルはモデルストリームのキャンセルとは別です：

- ツールランナーは `AbortSignal.any([agentSignal, steeringAbortSignal])` を使用する
- ステアリング割り込みは、既に生成されたツール結果を保持しながら残りのツール実行を中断できる

## バックプレッシャーの境界

プロバイダーSDKストリームとダウンストリームコンシューマーの間にはハードなバックプレッシャーメカニズムはありません：

- `EventStream` は最大サイズのないインメモリキューを使用する
- スロットリングはUIの更新レートを低下させるが、プロバイダーの取り込みを遅くしない
- コンシューマーが大幅に遅延した場合、キューに入れられたイベントは完了まで増加し続ける可能性がある

現在の設計は、バウンデッドバッファのフロー制御よりも応答性とシンプルな順序付けを優先しています。

## ストリームイベントがエージェント/セッションイベントとして表面化する方法

`agentLoop.streamAssistantResponse()` は `AssistantMessageEvent` を `AgentEvent` にブリッジします：

- `start` 時：プレースホルダーのアシスタントメッセージをプッシュし、`message_start` を発行する
- ブロックイベント（`text_*`、`thinking_*`、`toolcall_*`）時：最後のアシスタントメッセージを更新し、生の `assistantMessageEvent` を含む `message_update` を発行する
- ターミナル（`done`/`error`）時：`response.result()` から最終メッセージを解決し、`message_end` を発行する

`AgentSession` はこれらのイベントをセッションレベルの動作のために消費します：

- TTSRは `text_delta` と `toolcall_delta` のために `message_update.assistantMessageEvent` を監視する
- ストリーミング編集ガードは `edit` コールでの `toolcall_delta`/`toolcall_end` を検査し、早期に中断できる
- 永続化は `message_end` で完成したメッセージを書き込む
- 自動リトライはアシスタントの `stopReason === "error"` と `errorMessage` ヒューリスティックを検査する

## 統一とプロバイダー固有の責務

統一（共通コントラクト）：

- イベント形状（`AssistantMessageEvent`）
- 最終結果の抽出（`done`/`error`）
- デルタスロットリング + マージルール
- エージェント/セッションイベント伝播モデル

プロバイダー固有（完全には抽象化されていない）：

- アップストリームのイベント分類とマッピングロジック
- ストップ理由の変換テーブル
- ツールコールIDの規約
- リーズニング/シンキングブロックのセマンティクスとシグネチャ
- 使用量トークンのセマンティクスと利用可能タイミング
- APIごとのメッセージ変換制約

## 実装ファイル

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — プロバイダーディスパッチ、オプションマッピング、APIキー/セッションの配管。
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — 汎用ストリームキューとアシスタントデルタスロットリング。
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — ストリーミングされたツール引数の部分的なJSONパース。
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — AnthropicイベントのTranslationとツールJSONデルタの蓄積。
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI Responsesイベントの変換とステータスマッピング。
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Geminiストリームチャンクからブロックへの変換。
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Geminiフィニッシュ理由マッピングと共有変換ルール。
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — プロバイダーストリームの消費と `message_update` のブリッジ。
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — ストリーミング更新、中断、リトライ、永続化のセッションレベルの処理。
