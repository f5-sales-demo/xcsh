---
title: Provider Streaming Internals
description: SSE解析、トークンカウント、バックプレッシャー処理を含むプロバイダーストリーミングの実装。
sidebar:
  order: 2
  label: ストリーミング内部構造
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# プロバイダーストリーミングの内部構造

このドキュメントでは、`@f5xc-salesdemos/pi-ai` においてトークン/ツールのストリーミングがどのように正規化され、`@f5xc-salesdemos/pi-agent-core` および `coding-agent` のセッションイベントを通じてどのように伝播されるかを説明します。

## エンドツーエンドのフロー

1. `streamSimple()` (`packages/ai/src/stream.ts`) が汎用オプションをマッピングし、プロバイダーのストリーム関数にディスパッチします。
2. プロバイダーストリーム関数（`anthropic.ts`、`openai-responses.ts`、`google.ts`）が、プロバイダー固有のストリームイベントを統一された `AssistantMessageEvent` シーケンスに変換します。
3. 各プロバイダーは `AssistantMessageEventStream`（`packages/ai/src/utils/event-stream.ts`）にイベントをプッシュし、デルタイベントをスロットリングして以下を公開します：
   - インクリメンタル更新のための非同期イテレーション
   - 最終的な `AssistantMessage` を返す `result()`
4. `agentLoop`（`packages/agent/src/agent-loop.ts`）がこれらのイベントを消費し、処理中のアシスタント状態を変更し、生の `assistantMessageEvent` を含む `message_update` イベントを発行します。
5. `AgentSession`（`packages/coding-agent/src/session/agent-session.ts`）がエージェントイベントを購読し、メッセージを永続化し、拡張フックを駆動し、セッション動作（リトライ、コンパクション、TTSR、ストリーミング編集の中断チェック）を適用します。

## `@f5xc-salesdemos/pi-ai` における統一ストリームコントラクト

すべてのプロバイダーは同じ形状（`packages/ai/src/types.ts` の `AssistantMessageEvent`）を発行します：

- `start`
- コンテンツブロックのライフサイクルトリプレット：
  - テキスト: `text_start` → `text_delta`* → `text_end`
  - 思考: `thinking_start` → `thinking_delta`* → `thinking_end`
  - ツール呼び出し: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- 終端イベント：
  - `done`（`reason: "stop" | "length" | "toolUse"`）
  - または `error`（`reason: "aborted" | "error"`）

`AssistantMessageEventStream` は以下を保証します：

- 最終結果は終端イベント（`done` または `error`）によって解決される
- デルタはバッチ処理/スロットリングされる（約50ms）
- バッファされたデルタは非デルタイベントの前および完了前にフラッシュされる

## デルタのスロットリングと調和の動作

`AssistantMessageEventStream` は `text_delta`、`thinking_delta`、`toolcall_delta` をマージ可能なイベントとして扱います：

- バッファされたデルタは **type + contentIndex** が一致する場合にのみマージされる
- マージは最新の `partial` スナップショットを保持する
- 非デルタイベントは即座にフラッシュを強制する

これにより、高頻度のプロバイダーストリームがTUI/イベントコンシューマー向けに平滑化されますが、プロバイダーのバックプレッシャーではありません：プロバイダーは引き続きフルスピードで生成し、ローカルストリームがバッファリングします。

## プロバイダー正規化の詳細

## Anthropic (`anthropic-messages`)

ソース: `packages/ai/src/providers/anthropic.ts`

正規化のポイント：

- `message_start` が使用量を初期化（入力/出力/キャッシュトークン）
- `content_block_start` がテキスト/思考/ツール呼び出しの開始にマッピング
- `content_block_delta` のマッピング：
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` は `thinkingSignature` のみ更新（イベントなし）
- `content_block_stop` が対応する `*_end` を発行
- `message_delta.stop_reason` が `mapStopReason()` を通じてマッピング

ツール呼び出し引数のストリーミング：

- 各ツールブロックが内部 `partialJson` を保持
- JSON デルタごとに `partialJson` に追加
- `arguments` は各デルタで `parseStreamingJson()` を通じて再パース
- `toolcall_end` でもう一度再パースし、`partialJson` を除去

## OpenAI Responses (`openai-responses`)

ソース: `packages/ai/src/providers/openai-responses.ts`

正規化のポイント：

- `response.output_item.added` が推論/テキスト/関数呼び出しブロックを開始
- 推論サマリーイベント（`response.reasoning_summary_text.delta`）が `thinking_delta` になる
- 出力/拒否デルタが `text_delta` になる
- `response.function_call_arguments.delta` が `toolcall_delta` になる
- `response.output_item.done` が `thinking_end` / `text_end` / `toolcall_end` を発行
- `response.completed` がステータスを停止理由と使用量にマッピング

ツール呼び出し引数のストリーミング：

- Anthropic と同じ `partialJson` 蓄積パターン
- `response.function_call_arguments.done` のみを送信するプロバイダーでも最終引数を設定
- ツール呼び出し ID は `"<call_id>|<item_id>"` として正規化

## Google Generative AI (`google-generative-ai`)

ソース: `packages/ai/src/providers/google.ts`

正規化のポイント：

- `candidate.content.parts` をイテレート
- テキストパーツは `isThinkingPart(part)` により思考 vs テキストに分離
- ブロック遷移は新しいブロックを開始する前に前のブロックを閉じる
- `part.functionCall` は完全なツール呼び出しとして扱われる（start/delta/end が即座に発行）
- 終了理由は `google-shared.ts` の `mapStopReason()` でマッピング

ツール呼び出し引数のストリーミング：

- 関数呼び出し引数はインクリメンタルな JSON テキストではなく、構造化オブジェクトとして到着
- 実装は `JSON.stringify(arguments)` を含む1つの合成 `toolcall_delta` を発行
- このパスでは Google 向けの部分 JSON パーサーは不要

## 部分的なツール呼び出し JSON の蓄積と回復

Anthropic/OpenAI Responses の共有動作は `parseStreamingJson()`（`packages/ai/src/utils/json-parse.ts`）を使用します：

1. `JSON.parse` を試行
2. 不完全なフラグメントに対して `partial-json` パーサーにフォールバック
3. 両方とも失敗した場合、`{}` を返す

影響：

- 不正な形式や切り詰められた引数デルタは、ストリーム処理を即座にクラッシュさせない
- 処理中の `arguments` は一時的に `{}` になる可能性がある
- 後続の有効なデルタは、追加ごとにパースが再試行されるため、構造化された引数を回復できる
- 最終的な `toolcall_end` は発行前にもう一度パースを試行する

## 停止理由 vs トランスポート/ランタイムエラー

プロバイダーの停止理由は正規化された `stopReason` にマッピングされます：

- Anthropic: `end_turn`→`stop`、`max_tokens`→`length`、`tool_use`→`toolUse`、安全性/拒否ケース→`error`
- OpenAI Responses: `completed`→`stop`、`incomplete`→`length`、`failed/cancelled`→`error`
- Google: `STOP`→`stop`、`MAX_TOKENS`→`length`、安全性/禁止/不正な関数呼び出しクラス→`error`

エラーセマンティクスは2つの段階に分かれています：

1. **モデル完了セマンティクス**（プロバイダーが報告する終了理由/ステータス）
2. **トランスポート/ランタイム障害**（ネットワーク/クライアント/パーサー/中断例外）

プロバイダーストリームがスローまたは障害を通知した場合、各プロバイダーラッパーはキャッチして以下の終端 `error` イベントを発行します：

- 中断シグナルが設定されている場合は `stopReason = "aborted"`
- それ以外は `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## 不正なチャンク / SSE パース失敗の動作

これらのプロバイダーパスでは、チャンク/SSE フレーミングはベンダー SDK ストリーム（Anthropic SDK、OpenAI SDK、Google SDK）によって処理されます。このコードはここでカスタム SSE デコーダーを実装していません。

現在の実装で観察される動作：

- SDK レベルでの不正なチャンク/SSE パースは例外またはストリーム `error` イベントとして表面化
- プロバイダーラッパーがそれを統一された終端 `error` イベントに変換
- ストリーム関数自体の内部でプロバイダー固有の再開/リトライは行わない
- 上位レベルのリトライは `AgentSession` の自動リトライロジックで処理（ストリームチャンクの再生ではなく、メッセージレベルのリトライ）

## キャンセル境界

キャンセルは階層化されています：

- AI プロバイダーリクエスト: `options.signal` がプロバイダークライアントのストリーム呼び出しに渡される。
- プロバイダーラッパー: ストリームループ後、中断されたシグナルがエラーパスを強制（`"Request was aborted"`）。
- エージェントループ: 各プロバイダーイベントを処理する前に `signal.aborted` をチェックし、最新の部分データから中断されたアシスタントメッセージを合成できる。
- セッション/エージェント制御: `AgentSession.abort()` → `agent.abort()` → 共有中断コントローラーのキャンセル。

ツール実行のキャンセルはモデルストリームのキャンセルとは別です：

- ツールランナーは `AbortSignal.any([agentSignal, steeringAbortSignal])` を使用
- ステアリング割り込みは、既に生成されたツール結果を保持しつつ、残りのツール実行を中断できる

## バックプレッシャー境界

プロバイダー SDK ストリームとダウンストリームコンシューマー間にハードなバックプレッシャーメカニズムはありません：

- `EventStream` はサイズ上限のないインメモリキューを使用
- スロットリングは UI 更新レートを下げるが、プロバイダーの取り込み速度は低下させない
- コンシューマーが大幅に遅延した場合、キューに入ったイベントは完了まで増加し続ける可能性がある

現在の設計は、バウンドバッファのフロー制御よりも応答性とシンプルな順序付けを重視しています。

## ストリームイベントがエージェント/セッションイベントとしてどのように表面化するか

`agentLoop.streamAssistantResponse()` が `AssistantMessageEvent` を `AgentEvent` にブリッジします：

- `start` 時: プレースホルダーのアシスタントメッセージをプッシュし、`message_start` を発行
- ブロックイベント（`text_*`、`thinking_*`、`toolcall_*`）時: 最後のアシスタントメッセージを更新し、生の `assistantMessageEvent` を含む `message_update` を発行
- 終端（`done`/`error`）時: `response.result()` から最終メッセージを解決し、`message_end` を発行

`AgentSession` はその後、セッションレベルの動作のためにこれらのイベントを消費します：

- TTSR は `message_update.assistantMessageEvent` の `text_delta` と `toolcall_delta` を監視
- ストリーミング編集ガードは `edit` 呼び出し時に `toolcall_delta`/`toolcall_end` を検査し、早期に中断できる
- 永続化は `message_end` 時に確定したメッセージを書き込む
- 自動リトライはアシスタントの `stopReason === "error"` と `errorMessage` のヒューリスティクスを検査

## 統一 vs プロバイダー固有の責務

統一（共通コントラクト）：

- イベント形状（`AssistantMessageEvent`）
- 最終結果の抽出（`done`/`error`）
- デルタのスロットリング + マージルール
- エージェント/セッションイベントの伝播モデル

プロバイダー固有（完全には抽象化されていない）：

- 上流イベントの分類体系とマッピングロジック
- 停止理由の変換テーブル
- ツール呼び出し ID の規約
- 推論/思考ブロックのセマンティクスとシグネチャ
- 使用トークンのセマンティクスと利用可能タイミング
- API ごとのメッセージ変換制約

## 実装ファイル

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — プロバイダーディスパッチ、オプションマッピング、API キー/セッションの配管。
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — 汎用ストリームキュー + アシスタントデルタのスロットリング。
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — ストリーミングされたツール引数の部分 JSON パース。
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — Anthropic イベント変換とツール JSON デルタの蓄積。
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI Responses イベント変換とステータスマッピング。
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Gemini ストリームチャンクからブロックへの変換。
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Gemini 終了理由マッピングと共有変換ルール。
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — プロバイダーストリームの消費と `message_update` ブリッジング。
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — ストリーミング更新、中断、リトライ、永続化のセッションレベル処理。
