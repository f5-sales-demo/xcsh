---
title: プロバイダーストリーミング内部構造
description: SSEパース、トークンカウント、バックプレッシャー処理を含むプロバイダーストリーミングの実装。
sidebar:
  order: 2
  label: ストリーミング内部構造
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# プロバイダーストリーミング内部構造

このドキュメントでは、`@f5xc-salesdemos/pi-ai` においてトークン/ツールのストリーミングがどのように正規化され、`@f5xc-salesdemos/pi-agent-core` および `coding-agent` のセッションイベントを通じて伝播されるかを説明します。

## エンドツーエンドのフロー

1. `streamSimple()`（`packages/ai/src/stream.ts`）が汎用オプションをマッピングし、プロバイダーストリーム関数にディスパッチします。
2. プロバイダーストリーム関数（`anthropic.ts`、`openai-responses.ts`、`google.ts`）がプロバイダーネイティブのストリームイベントを統一された `AssistantMessageEvent` シーケンスに変換します。
3. 各プロバイダーはイベントを `AssistantMessageEventStream`（`packages/ai/src/utils/event-stream.ts`）にプッシュします。これはデルタイベントをスロットリングし、以下を公開します：
   - インクリメンタルな更新のための非同期イテレーション
   - 最終的な `AssistantMessage` のための `result()`
4. `agentLoop`（`packages/agent/src/agent-loop.ts`）はそれらのイベントを消費し、処理中のアシスタント状態を変更し、生の `assistantMessageEvent` を持つ `message_update` イベントを発行します。
5. `AgentSession`（`packages/coding-agent/src/session/agent-session.ts`）はエージェントイベントをサブスクライブし、メッセージを永続化し、拡張フックを駆動し、セッション動作（リトライ、コンパクション、TTSR、ストリーミング編集アボートチェック）を適用します。

## `@f5xc-salesdemos/pi-ai` における統一ストリームコントラクト

すべてのプロバイダーは同一の形式（`packages/ai/src/types.ts` の `AssistantMessageEvent`）を発行します：

- `start`
- コンテンツブロックのライフサイクルトリプレット：
  - テキスト: `text_start` → `text_delta`* → `text_end`
  - シンキング: `thinking_start` → `thinking_delta`* → `thinking_end`
  - ツール呼び出し: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- 終端イベント：
  - `done`（`reason: "stop" | "length" | "toolUse"` 付き）
  - または `error`（`reason: "aborted" | "error"` 付き）

`AssistantMessageEventStream` は以下を保証します：

- 最終結果は終端イベント（`done` または `error`）によって解決される
- デルタはバッチ処理/スロットリングされる（約50ms）
- バッファリングされたデルタは非デルタイベントの前および完了前にフラッシュされる

## デルタのスロットリングと調和動作

`AssistantMessageEventStream` は `text_delta`、`thinking_delta`、`toolcall_delta` をマージ可能なイベントとして扱います：

- バッファリングされたデルタは **type + contentIndex** が一致する場合にのみマージされる
- マージは最新の `partial` スナップショットを保持する
- 非デルタイベントは即座のフラッシュを強制する

これにより、TUI/イベントコンシューマー向けに高頻度のプロバイダーストリームが平滑化されますが、プロバイダーのバックプレッシャーではありません。プロバイダーは引き続きフルスピードで生成し、ローカルストリームがバッファリングします。

## プロバイダー正規化の詳細

## Anthropic（`anthropic-messages`）

ソース: `packages/ai/src/providers/anthropic.ts`

正規化ポイント：

- `message_start` がusage（入力/出力/キャッシュトークン）を初期化する
- `content_block_start` がテキスト/シンキング/ツール呼び出しの開始にマッピングされる
- `content_block_delta` のマッピング：
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` は `thinkingSignature` のみを更新する（イベントなし）
- `content_block_stop` が対応する `*_end` を発行する
- `message_delta.stop_reason` が `mapStopReason()` を介してマッピングされる

ツール呼び出し引数のストリーミング：

- 各ツールブロックは内部的な `partialJson` を保持する
- すべてのJSONデルタが `partialJson` に追加される
- `arguments` は各デルタで `parseStreamingJson()` を介して再パースされる
- `toolcall_end` はもう一度パースを行い、その後 `partialJson` を除去する

## OpenAI Responses（`openai-responses`）

ソース: `packages/ai/src/providers/openai-responses.ts`

正規化ポイント：

- `response.output_item.added` が推論/テキスト/関数呼び出しブロックを開始する
- 推論サマリーイベント（`response.reasoning_summary_text.delta`）が `thinking_delta` になる
- 出力/拒否デルタが `text_delta` になる
- `response.function_call_arguments.delta` が `toolcall_delta` になる
- `response.output_item.done` が `thinking_end` / `text_end` / `toolcall_end` を発行する
- `response.completed` がステータスをストップ理由とusageにマッピングする

ツール呼び出し引数のストリーミング：

- AnthropicとそのPartialjsonの蓄積パターンを同様に使用する
- `response.function_call_arguments.done` のみを送信するプロバイダーでも最終引数が設定される
- ツール呼び出しIDは `"<call_id>|<item_id>"` として正規化される

## Google Generative AI（`google-generative-ai`）

ソース: `packages/ai/src/providers/google.ts`

正規化ポイント：

- `candidate.content.parts` をイテレートする
- テキストパーツは `isThinkingPart(part)` によってシンキングとテキストに分割される
- ブロックの遷移は新しいブロックを開始する前に前のブロックを閉じる
- `part.functionCall` は完全なツール呼び出しとして扱われる（start/delta/end が即座に発行される）
- フィニッシュ理由は `google-shared.ts` の `mapStopReason()` によってマッピングされる

ツール呼び出し引数のストリーミング：

- 関数呼び出し引数はインクリメンタルなJSONテキストではなく、構造化オブジェクトとして届く
- 実装は `JSON.stringify(arguments)` を含む1つの合成 `toolcall_delta` を発行する
- このパスではGoogleに対して部分的なJSONパーサーは不要

## 部分的なツール呼び出しJSONの蓄積とリカバリー

Anthropic/OpenAI Responsesの共有動作は `parseStreamingJson()`（`packages/ai/src/utils/json-parse.ts`）を使用します：

1. `JSON.parse` を試みる
2. 不完全なフラグメントに対して `partial-json` パーサーへフォールバックする
3. 両方が失敗した場合、`{}` を返す

影響：

- 不正な形式または途中で切れた引数デルタがストリーム処理を即座にクラッシュさせることはない
- 処理中の `arguments` は一時的に `{}` になる場合がある
- パースはすべての追記で再試行されるため、後続の有効なデルタが構造化引数をリカバリーできる
- 最終的な `toolcall_end` は発行前にもう一度パースを試みる

## ストップ理由とトランスポート/ランタイムエラー

プロバイダーのストップ理由は正規化された `stopReason` にマッピングされます：

- Anthropic: `end_turn`→`stop`、`max_tokens`→`length`、`tool_use`→`toolUse`、安全/拒否ケース→`error`
- OpenAI Responses: `completed`→`stop`、`incomplete`→`length`、`failed/cancelled`→`error`
- Google: `STOP`→`stop`、`MAX_TOKENS`→`length`、安全/禁止/不正な関数呼び出しクラス→`error`

エラーセマンティクスは2つのステージに分かれます：

1. **モデル完了セマンティクス**（プロバイダーが報告したフィニッシュ理由/ステータス）
2. **トランスポート/ランタイム障害**（ネットワーク/クライアント/パーサー/アボート例外）

プロバイダーストリームがスローまたは障害を通知した場合、各プロバイダーラッパーはキャッチして以下の終端 `error` イベントを発行します：

- アボートシグナルが設定されている場合は `stopReason = "aborted"`
- それ以外の場合は `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## 不正なチャンク / SSEパース障害の動作

これらのプロバイダーパスでは、チャンク/SSEのフレーミングはベンダーSDKストリーム（Anthropic SDK、OpenAI SDK、Google SDK）によって処理されます。このコードにはカスタムSSEデコーダーは実装されていません。

現在の実装における観察された動作：

- SDKレベルでの不正なチャンク/SSEパースは例外またはストリームの `error` イベントとして表面化する
- プロバイダーラッパーはそれを統一された終端 `error` イベントに変換する
- ストリーム関数内にプロバイダー固有の再開/リトライはない
- 上位レベルのリトライは `AgentSession` の自動リトライロジックで処理される（メッセージレベルのリトライ、ストリームチャンクのリプレイではない）

## キャンセルの境界

キャンセルは階層化されています：

- AIプロバイダーリクエスト: `options.signal` がプロバイダークライアントのストリーム呼び出しに渡される。
- プロバイダーラッパー: ストリームループの後、アボートされたシグナルがエラーパス（`"Request was aborted"`）を強制する。
- エージェントループ: 各プロバイダーイベントを処理する前に `signal.aborted` をチェックし、最新の部分から中断されたアシスタントメッセージを合成できる。
- セッション/エージェントコントロール: `AgentSession.abort()` -> `agent.abort()` -> 共有アボートコントローラーのキャンセル。

ツール実行のキャンセルはモデルストリームのキャンセルとは別です：

- ツールランナーは `AbortSignal.any([agentSignal, steeringAbortSignal])` を使用する
- ステアリング割り込みはすでに生成されたツール結果を保持しながら、残りのツール実行を中断できる

## バックプレッシャーの境界

プロバイダーSDKストリームとダウンストリームコンシューマーの間にはハードなバックプレッシャーメカニズムはありません：

- `EventStream` は最大サイズなしのインメモリキューを使用する
- スロットリングはUIの更新レートを下げるが、プロバイダーの取り込みを遅くしない
- コンシューマーが著しく遅延する場合、キューに入ったイベントは完了まで増え続ける可能性がある

現在の設計は、バッファー制限付きフロー制御よりも応答性とシンプルな順序付けを優先しています。

## ストリームイベントがエージェント/セッションイベントとして表面化する方法

`agentLoop.streamAssistantResponse()` は `AssistantMessageEvent` を `AgentEvent` にブリッジします：

- `start` 時: プレースホルダーのアシスタントメッセージをプッシュし、`message_start` を発行する
- ブロックイベント（`text_*`、`thinking_*`、`toolcall_*`）時: 最後のアシスタントメッセージを更新し、生の `assistantMessageEvent` を持つ `message_update` を発行する
- 終端（`done`/`error`）時: `response.result()` から最終メッセージを解決し、`message_end` を発行する

`AgentSession` はその後、セッションレベルの動作のためにそれらのイベントを消費します：

- TTSRは `text_delta` と `toolcall_delta` のために `message_update.assistantMessageEvent` を監視する
- ストリーミング編集ガードは `edit` 呼び出しの `toolcall_delta`/`toolcall_end` を検査し、早期アボートが可能
- 永続化は `message_end` で最終確定されたメッセージを書き込む
- 自動リトライはアシスタントの `stopReason === "error"` と `errorMessage` ヒューリスティックを検査する

## 統一対プロバイダー固有の責任

統一（共通コントラクト）：

- イベント形式（`AssistantMessageEvent`）
- 最終結果の抽出（`done`/`error`）
- デルタのスロットリング＋マージルール
- エージェント/セッションイベント伝播モデル

プロバイダー固有（完全には抽象化されていない）：

- アップストリームイベントの分類とマッピングロジック
- ストップ理由の変換テーブル
- ツール呼び出しIDの規約
- 推論/シンキングブロックのセマンティクスとシグネチャ
- usageトークンのセマンティクスと可用性タイミング
- API別のメッセージ変換制約

## 実装ファイル

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — プロバイダーディスパッチ、オプションマッピング、APIキー/セッションの配管。
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — 汎用ストリームキュー＋アシスタントデルタのスロットリング。
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — ストリーミングされたツール引数の部分的なJSONパース。
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — Anthropicイベントの変換とツールJSONデルタの蓄積。
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI Responsesイベントの変換とステータスマッピング。
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Geminiストリームチャンクからブロックへの変換。
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Geminiフィニッシュ理由のマッピングと共有変換ルール。
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — プロバイダーストリームの消費と `message_update` のブリッジング。
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — ストリーミング更新、アボート、リトライ、永続化のセッションレベル処理。
