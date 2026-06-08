---
title: Provider Streaming Internals
description: SSE解析、トークンカウント、バックプレッシャー処理を含むプロバイダーストリーミング実装。
sidebar:
  order: 2
  label: ストリーミング内部構造
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# プロバイダーストリーミング内部構造

このドキュメントでは、`@f5xc-salesdemos/pi-ai` でトークン/ツールストリーミングがどのように正規化され、`@f5xc-salesdemos/pi-agent-core` および `coding-agent` のセッションイベントを通じて伝播されるかを説明します。

## エンドツーエンドのフロー

1. `streamSimple()` (`packages/ai/src/stream.ts`) が汎用オプションをマッピングし、プロバイダーストリーム関数にディスパッチします。
2. プロバイダーストリーム関数（`anthropic.ts`、`openai-responses.ts`、`google.ts`）が、プロバイダー固有のストリームイベントを統一された `AssistantMessageEvent` シーケンスに変換します。
3. 各プロバイダーは `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`) にイベントをプッシュし、デルタイベントをスロットリングして以下を公開します：
   - インクリメンタル更新のための非同期イテレーション
   - 最終的な `AssistantMessage` を取得する `result()`
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) がこれらのイベントを消費し、進行中のアシスタント状態を変更し、生の `assistantMessageEvent` を含む `message_update` イベントを発行します。
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) がエージェントイベントをサブスクライブし、メッセージを永続化し、拡張フックを駆動し、セッションビヘイビア（リトライ、コンパクション、TTSR、ストリーミング編集中断チェック）を適用します。

## `@f5xc-salesdemos/pi-ai` における統一ストリームコントラクト

すべてのプロバイダーは同じ形状（`packages/ai/src/types.ts` の `AssistantMessageEvent`）を発行します：

- `start`
- コンテンツブロックのライフサイクル三つ組：
  - テキスト: `text_start` → `text_delta`* → `text_end`
  - 思考: `thinking_start` → `thinking_delta`* → `thinking_end`
  - ツールコール: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- 終端イベント：
  - `done` （`reason: "stop" | "length" | "toolUse"`）
  - または `error` （`reason: "aborted" | "error"`）

`AssistantMessageEventStream` の保証：

- 最終結果は終端イベント（`done` または `error`）によって解決されます
- デルタはバッチ処理/スロットリングされます（約50ms）
- バッファリングされたデルタは、非デルタイベントの前および完了前にフラッシュされます

## デルタスロットリングとハーモナイゼーション動作

`AssistantMessageEventStream` は `text_delta`、`thinking_delta`、`toolcall_delta` をマージ可能なイベントとして扱います：

- バッファリングされたデルタは **type + contentIndex** が一致する場合にのみマージされます
- マージは最新の `partial` スナップショットを保持します
- 非デルタイベントは即時フラッシュを強制します

これにより、高頻度のプロバイダーストリームがTUI/イベントコンシューマー向けに平滑化されますが、プロバイダーバックプレッシャーではありません：プロバイダーは依然としてフルスピードで生成し、ローカルストリームがバッファリングします。

## プロバイダー正規化の詳細

## Anthropic (`anthropic-messages`)

ソース: `packages/ai/src/providers/anthropic.ts`

正規化ポイント：

- `message_start` が使用量を初期化します（入力/出力/キャッシュトークン）
- `content_block_start` がテキスト/思考/ツールコールの開始にマッピングされます
- `content_block_delta` のマッピング：
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` は `thinkingSignature` のみを更新します（イベントなし）
- `content_block_stop` が対応する `*_end` を発行します
- `message_delta.stop_reason` が `mapStopReason()` を通じてマッピングされます

ツールコール引数ストリーミング：

- 各ツールブロックは内部的に `partialJson` を保持します
- すべてのJSONデルタが `partialJson` に追加されます
- `arguments` は各デルタで `parseStreamingJson()` を通じて再パースされます
- `toolcall_end` でもう一度再パースし、その後 `partialJson` を除去します

## OpenAI Responses (`openai-responses`)

ソース: `packages/ai/src/providers/openai-responses.ts`

正規化ポイント：

- `response.output_item.added` が推論/テキスト/関数呼び出しブロックを開始します
- 推論サマリーイベント（`response.reasoning_summary_text.delta`）が `thinking_delta` になります
- 出力/拒否デルタが `text_delta` になります
- `response.function_call_arguments.delta` が `toolcall_delta` になります
- `response.output_item.done` が `thinking_end` / `text_end` / `toolcall_end` を発行します
- `response.completed` がステータスを停止理由と使用量にマッピングします

ツールコール引数ストリーミング：

- Anthropicと同じ `partialJson` 蓄積パターンです
- `response.function_call_arguments.done` のみを送信するプロバイダーでも最終引数は設定されます
- ツールコールIDは `"<call_id>|<item_id>"` として正規化されます

## Google Generative AI (`google-generative-ai`)

ソース: `packages/ai/src/providers/google.ts`

正規化ポイント：

- `candidate.content.parts` をイテレートします
- テキストパートは `isThinkingPart(part)` によって思考とテキストに分割されます
- ブロック遷移時に、新しいブロックを開始する前に前のブロックを閉じます
- `part.functionCall` は完全なツールコールとして扱われます（start/delta/endが即時発行されます）
- 終了理由は `google-shared.ts` の `mapStopReason()` によってマッピングされます

ツールコール引数ストリーミング：

- 関数呼び出し引数は構造化オブジェクトとして到着し、インクリメンタルなJSONテキストではありません
- 実装は `JSON.stringify(arguments)` を含む1つの合成 `toolcall_delta` を発行します
- このパスではGoogle向けの部分JSONパーサーは不要です

## 部分的ツールコールJSON蓄積とリカバリ

Anthropic/OpenAI Responsesの共有動作は `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`) を使用します：

1. `JSON.parse` を試行
2. 不完全なフラグメントに対して `partial-json` パーサーにフォールバック
3. 両方とも失敗した場合、`{}` を返す

影響：

- 不正な形式や途中で切れた引数デルタは、ストリーム処理を即座にクラッシュさせません
- 進行中の `arguments` は一時的に `{}` になる場合があります
- 後続の有効なデルタは構造化された引数をリカバリできます。これはすべての追加時にパースが再試行されるためです
- 最終的な `toolcall_end` は発行前にもう一度パースを試行します

## 停止理由とトランスポート/ランタイムエラー

プロバイダーの停止理由は正規化された `stopReason` にマッピングされます：

- Anthropic: `end_turn`→`stop`、`max_tokens`→`length`、`tool_use`→`toolUse`、安全性/拒否ケース→`error`
- OpenAI Responses: `completed`→`stop`、`incomplete`→`length`、`failed/cancelled`→`error`
- Google: `STOP`→`stop`、`MAX_TOKENS`→`length`、安全性/禁止/不正な関数呼び出しクラス→`error`

エラーセマンティクスは2つのステージに分かれます：

1. **モデル完了セマンティクス**（プロバイダーが報告する終了理由/ステータス）
2. **トランスポート/ランタイム障害**（ネットワーク/クライアント/パーサー/中断例外）

プロバイダーストリームがスローまたは障害を通知した場合、各プロバイダーラッパーはキャッチして以下の内容で終端 `error` イベントを発行します：

- 中断シグナルが設定されている場合は `stopReason = "aborted"`
- それ以外の場合は `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## 不正なチャンク / SSEパース失敗の動作

これらのプロバイダーパスでは、チャンク/SSEフレーミングはベンダーSDKストリーム（Anthropic SDK、OpenAI SDK、Google SDK）によって処理されます。このコードはここでカスタムSSEデコーダーを実装していません。

現在の実装で観察される動作：

- SDKレベルでの不正なチャンク/SSEパースは、例外またはストリーム `error` イベントとして表面化します
- プロバイダーラッパーはそれを統一された終端 `error` イベントに変換します
- ストリーム関数自体の内部にはプロバイダー固有のリジューム/リトライはありません
- 上位レベルのリトライは `AgentSession` の自動リトライロジックで処理されます（メッセージレベルのリトライであり、ストリームチャンクのリプレイではありません）

## キャンセル境界

キャンセルは階層化されています：

- AIプロバイダーリクエスト: `options.signal` がプロバイダークライアントのストリームコールに渡されます。
- プロバイダーラッパー: ストリームループ後、中断されたシグナルはエラーパスを強制します（`"Request was aborted"`）。
- エージェントループ: 各プロバイダーイベントを処理する前に `signal.aborted` をチェックし、最新の部分データから中断されたアシスタントメッセージを合成できます。
- セッション/エージェント制御: `AgentSession.abort()` → `agent.abort()` → 共有中断コントローラーのキャンセル。

ツール実行のキャンセルはモデルストリームのキャンセルとは別です：

- ツールランナーは `AbortSignal.any([agentSignal, steeringAbortSignal])` を使用します
- ステアリング割り込みは、すでに生成されたツール結果を保持しながら残りのツール実行を中断できます

## バックプレッシャー境界

プロバイダーSDKストリームとダウンストリームコンシューマー間にはハードなバックプレッシャーメカニズムはありません：

- `EventStream` は最大サイズのないインメモリキューを使用します
- スロットリングはUI更新レートを低減しますが、プロバイダーの取り込みを遅くしません
- コンシューマーが大幅に遅延した場合、キューイングされたイベントは完了まで増加する可能性があります

現在の設計は、バウンデッドバッファフロー制御よりもレスポンシブネスとシンプルな順序付けを優先しています。

## ストリームイベントがエージェント/セッションイベントとして表面化する仕組み

`agentLoop.streamAssistantResponse()` は `AssistantMessageEvent` を `AgentEvent` にブリッジします：

- `start` 時: プレースホルダーアシスタントメッセージをプッシュし、`message_start` を発行します
- ブロックイベント時（`text_*`、`thinking_*`、`toolcall_*`）: 最後のアシスタントメッセージを更新し、生の `assistantMessageEvent` を含む `message_update` を発行します
- 終端時（`done`/`error`）: `response.result()` から最終メッセージを解決し、`message_end` を発行します

`AgentSession` はその後、これらのイベントをセッションレベルのビヘイビアのために消費します：

- TTSRは `message_update.assistantMessageEvent` で `text_delta` と `toolcall_delta` を監視します
- ストリーミング編集ガードは `edit` コール時に `toolcall_delta`/`toolcall_end` を検査し、早期中断が可能です
- 永続化は `message_end` 時にファイナライズされたメッセージを書き込みます
- 自動リトライはアシスタントの `stopReason === "error"` と `errorMessage` ヒューリスティクスを検査します

## 統一 vs プロバイダー固有の責務

統一（共通コントラクト）：

- イベント形状（`AssistantMessageEvent`）
- 最終結果の抽出（`done`/`error`）
- デルタスロットリング + マージルール
- エージェント/セッションイベント伝播モデル

プロバイダー固有（完全には抽象化されていない）：

- 上流のイベント分類とマッピングロジック
- 停止理由変換テーブル
- ツールコールID規約
- 推論/思考ブロックのセマンティクスとシグネチャ
- 使用量トークンのセマンティクスと利用可能タイミング
- API毎のメッセージ変換制約

## 実装ファイル

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — プロバイダーディスパッチ、オプションマッピング、APIキー/セッション配管。
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — 汎用ストリームキュー + アシスタントデルタスロットリング。
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — ストリーミングツール引数の部分JSONパース。
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — Anthropicイベント変換とツールJSONデルタ蓄積。
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI Responsesイベント変換とステータスマッピング。
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Geminiストリームチャンクからブロックへの変換。
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Gemini終了理由マッピングと共有変換ルール。
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — プロバイダーストリーム消費と `message_update` ブリッジング。
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — ストリーミング更新、中断、リトライ、永続化のセッションレベル処理。
