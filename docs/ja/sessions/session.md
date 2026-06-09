---
title: セッションストレージとエントリモデル
description: エントリタイプ、永続化、フォーマット間のマイグレーションを備えた追記専用セッションストレージモデル。
sidebar:
  order: 1
  label: ストレージとエントリモデル
i18n:
  sourceHash: 42fe17549e00
  translator: machine
---

# セッションストレージとエントリモデル

このドキュメントは、コーディングエージェントセッションがどのように表現、永続化、マイグレーション、およびランタイムで再構築されるかについての信頼できる情報源です。

## スコープ

対象範囲：

- セッションJSONLフォーマットとバージョニング
- エントリ分類とツリーセマンティクス（`id`/`parentId` + リーフポインタ）
- 古いファイルや不正なファイルを読み込む際のマイグレーション/互換性動作
- コンテキスト再構築（`buildSessionContext`）
- 永続化保証、障害動作、切り詰め/blob外部化
- ストレージ抽象化（`FileSessionStorage`、`MemorySessionStorage`）および関連ユーティリティ

セッションデータに影響するセマンティクス以外の `/tree` UIレンダリング動作は対象外です。

## 実装ファイル

- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`src/session/messages.ts`](../../packages/coding-agent/src/session/messages.ts)
- [`src/session/session-storage.ts`](../../packages/coding-agent/src/session/session-storage.ts)
- [`src/session/history-storage.ts`](../../packages/coding-agent/src/session/history-storage.ts)
- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts)

## ディスク上のレイアウト

デフォルトのセッションファイルの場所：

```text
~/.xcsh/agent/sessions/--<cwd-encoded>--/<timestamp>_<sessionId>.jsonl
```

`<cwd-encoded>` は作業ディレクトリから先頭のスラッシュを除去し、`/`、`\\`、`:` を `-` に置換して導出されます。

Blobストアの場所：

```text
~/.xcsh/agent/blobs/<sha256>
```

ターミナルブレッドクラムファイルは以下に書き込まれます：

```text
~/.xcsh/agent/terminal-sessions/<terminal-id>
```

ブレッドクラムの内容は2行で構成されます：元のcwd、次にセッションファイルパス。`continueRecent()` は最新のmtimeをスキャンする前に、このターミナルスコープのポインタを優先します。

## ファイルフォーマット

セッションファイルはJSONLです：1行に1つのJSONオブジェクト。

- 1行目は常にセッションヘッダー（`type: "session"`）です。
- 残りの行は `SessionEntry` 値です。
- エントリはランタイムでは追記専用です。ブランチナビゲーションは既存のエントリを変更するのではなく、ポインタ（`leafId`）を移動します。

### ヘッダー（`SessionHeader`）

```json
{
  "type": "session",
  "version": 3,
  "id": "1f9d2a6b9c0d1234",
  "timestamp": "2026-02-16T10:20:30.000Z",
  "cwd": "/work/pi",
  "title": "optional session title",
  "parentSession": "optional lineage marker"
}
```

注意事項：

- `version` はv1ファイルではオプションです。存在しない場合はv1を意味します。
- `parentSession` は不透明な系統文字列です。現在のコードはフローに応じてセッションIDまたはセッションパスのいずれかを書き込みます（`fork`、`forkFrom`、`createBranchedSession`、または明示的な `newSession({ parentSession })`）。型付き外部キーではなくメタデータとして扱ってください。

### エントリベース（`SessionEntryBase`）

ヘッダー以外のすべてのエントリには以下が含まれます：

```json
{
  "type": "...",
  "id": "8-char-id",
  "parentId": "previous-or-branch-parent",
  "timestamp": "2026-02-16T10:20:30.000Z"
}
```

`parentId` はルートエントリ（最初の追加、または `resetLeaf()` 後）では `null` になります。

## エントリ分類

`SessionEntry` は以下のユニオン型です：

- `message`
- `thinking_level_change`
- `model_change`
- `compaction`
- `branch_summary`
- `custom`
- `custom_message`
- `label`
- `ttsr_injection`
- `session_init`
- `mode_change`

### `message`

`AgentMessage` を直接格納します。

```json
{
  "type": "message",
  "id": "a1b2c3d4",
  "parentId": null,
  "timestamp": "2026-02-16T10:21:00.000Z",
  "message": {
    "role": "assistant",
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "content": [{ "type": "text", "text": "Done." }],
    "usage": { "input": 100, "output": 20, "cacheRead": 0, "cacheWrite": 0, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } },
    "timestamp": 1760000000000
  }
}
```

### `model_change`

```json
{
  "type": "model_change",
  "id": "b1c2d3e4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:21:30.000Z",
  "model": "openai/gpt-4o",
  "role": "default"
}
```

`role` はオプションです。存在しない場合、コンテキスト再構築では `default` として扱われます。

### `thinking_level_change`

```json
{
  "type": "thinking_level_change",
  "id": "c1d2e3f4",
  "parentId": "b1c2d3e4",
  "timestamp": "2026-02-16T10:22:00.000Z",
  "thinkingLevel": "high"
}
```

### `compaction`

```json
{
  "type": "compaction",
  "id": "d1e2f3a4",
  "parentId": "c1d2e3f4",
  "timestamp": "2026-02-16T10:23:00.000Z",
  "summary": "Conversation summary",
  "shortSummary": "Short recap",
  "firstKeptEntryId": "a1b2c3d4",
  "tokensBefore": 42000,
  "details": { "readFiles": ["src/a.ts"] },
  "preserveData": { "hookState": true },
  "fromExtension": false
}
```

### `branch_summary`

```json
{
  "type": "branch_summary",
  "id": "e1f2a3b4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:24:00.000Z",
  "fromId": "a1b2c3d4",
  "summary": "Summary of abandoned path",
  "details": { "note": "optional" },
  "fromExtension": true
}
```

ルートからのブランチ（`branchFromId === null`）の場合、`fromId` はリテラル文字列 `"root"` になります。

### `custom`

拡張機能の状態永続化用。`buildSessionContext` では無視されます。

```json
{
  "type": "custom",
  "id": "f1a2b3c4",
  "parentId": "e1f2a3b4",
  "timestamp": "2026-02-16T10:25:00.000Z",
  "customType": "my-extension",
  "data": { "state": 1 }
}
```

### `custom_message`

LLMコンテキストに参加する拡張機能提供のメッセージ。

```json
{
  "type": "custom_message",
  "id": "a2b3c4d5",
  "parentId": "f1a2b3c4",
  "timestamp": "2026-02-16T10:26:00.000Z",
  "customType": "my-extension",
  "content": "Injected context",
  "display": true,
  "details": { "debug": false }
}
```

### `label`

```json
{
  "type": "label",
  "id": "b2c3d4e5",
  "parentId": "a2b3c4d5",
  "timestamp": "2026-02-16T10:27:00.000Z",
  "targetId": "a1b2c3d4",
  "label": "checkpoint"
}
```

`label: undefined` は `targetId` のラベルをクリアします。

### `ttsr_injection`

```json
{
  "type": "ttsr_injection",
  "id": "c2d3e4f5",
  "parentId": "b2c3d4e5",
  "timestamp": "2026-02-16T10:28:00.000Z",
  "injectedRules": ["ruleA", "ruleB"]
}
```

### `session_init`

```json
{
  "type": "session_init",
  "id": "d2e3f4a5",
  "parentId": "c2d3e4f5",
  "timestamp": "2026-02-16T10:29:00.000Z",
  "systemPrompt": "...",
  "task": "...",
  "tools": ["read", "edit"],
  "outputSchema": { "type": "object" }
}
```

### `mode_change`

```json
{
  "type": "mode_change",
  "id": "e2f3a4b5",
  "parentId": "d2e3f4a5",
  "timestamp": "2026-02-16T10:30:00.000Z",
  "mode": "plan",
  "data": { "planFile": "/tmp/plan.md" }
}
```

## バージョニングとマイグレーション

現在のセッションバージョン：`3`。

### v1 -> v2

ヘッダーの `version` が存在しないか `< 2` の場合に適用されます：

- ヘッダー以外の各エントリに `id` と `parentId` を追加します。
- ファイル順序を使用して線形の親チェーンを再構築します。
- compactionフィールド `firstKeptEntryIndex` -> `firstKeptEntryId` が存在する場合にマイグレーションします。
- ヘッダー `version = 2` を設定します。

### v2 -> v3

ヘッダーの `version < 3` の場合に適用されます：

- `message` エントリの場合：レガシーの `message.role === "hookMessage"` を `"custom"` に書き換えます。
- ヘッダー `version = 3` を設定します。

### マイグレーションのトリガーと永続化

- マイグレーションはセッション読み込み時（`setSessionFile`）に実行されます。
- いずれかのマイグレーションが実行された場合、ファイル全体が即座にディスクに再書き込みされます。
- マイグレーションはまずメモリ内のエントリを変更し、その後書き換えられたJSONLを永続化します。

## 読み込みと互換性の動作

`loadEntriesFromFile(path)` の動作：

- ファイルが存在しない場合（`ENOENT`）-> `[]` を返します。
- パース不可能な行は寛容なJSONLパーサー（`parseJsonlLenient`）で処理されます。
- 最初にパースされたエントリが有効なセッションヘッダーでない場合（`type !== "session"` または文字列 `id` が欠落）-> `[]` を返します。

`SessionManager.setSessionFile()` の動作：

- ローダーからの `[]` は空/存在しないセッションとして扱われ、そのパスに新しく初期化されたセッションファイルで置き換えられます。
- 有効なファイルは読み込まれ、必要に応じてマイグレーションされ、blob参照が解決されてからインデックスされます。

## ツリーとリーフのセマンティクス

基礎となるモデルは追記専用ツリー + 可変リーフポインタです：

- すべてのappendメソッドは、`parentId` が現在の `leafId` である新しいエントリを1つだけ作成します。
- 新しいエントリが新しい `leafId` になります。
- `branch(entryId)` は `leafId` のみを移動します。既存のエントリは変更されません。
- `resetLeaf()` は `leafId = null` を設定します。次のappendは新しいルートエントリ（`parentId: null`）を作成します。
- `branchWithSummary()` はリーフをブランチターゲットに設定し、`branch_summary` エントリを追加します。

`getEntries()` はヘッダー以外のすべてのエントリを挿入順で返します。通常の操作では既存のエントリは削除されません。再書き込みは表現を更新しながら論理的な履歴を保持します（マイグレーション、移動、対象を絞った再書き込みヘルパー）。

## コンテキスト再構築（`buildSessionContext`）

`buildSessionContext(entries, leafId, byId?)` はモデルに送信される内容を解決します。

アルゴリズム：

1. リーフの決定：
   - `leafId === null` -> 空のコンテキストを返します。
   - 明示的な `leafId` -> 見つかればそのエントリを使用します。
   - それ以外の場合は最後のエントリにフォールバックします。
2. リーフからルートまで `parentId` チェーンをたどり、ルート->リーフパスに反転します。
3. パス全体でランタイム状態を導出します：
   - 最新の `thinking_level_change` からの `thinkingLevel`（デフォルトは `"off"`）
   - `model_change` エントリからのモデルマップ（`role ?? "default"`）
   - 明示的なモデル変更がない場合、アシスタントメッセージのprovider/modelからのフォールバック `models.default`
   - すべての `ttsr_injection` エントリからの重複排除された `injectedTtsrRules`
   - 最新の `mode_change` からのmode/modeData（デフォルトモードは `"none"`）
4. メッセージリストの構築：
   - `message` エントリはそのまま通過します
   - `custom_message` エントリは `createCustomMessage` を介して `custom` AgentMessagesになります
   - `branch_summary` エントリは `createBranchSummaryMessage` を介して `branchSummary` AgentMessagesになります
   - パス上に `compaction` が存在する場合：
     - まずcompactionサマリーを出力します（`createCompactionSummaryMessage`）
     - `firstKeptEntryId` からcompaction境界までのパスエントリを出力します
     - compaction境界以降のエントリを出力します

`custom` と `session_init` エントリはモデルコンテキストに直接注入しません。

## 永続化保証と障害モデル

### 永続化 vs メモリ内

- `SessionManager.create/open/continueRecent/forkFrom` -> 永続化モード（`persist = true`）。
- `SessionManager.inMemory` -> 非永続化モード（`persist = false`）、`MemorySessionStorage` を使用。

### 書き込みパイプライン

書き込みは内部のプロミスチェーン（`#persistChain`）と `NdjsonFileWriter` を通じてシリアライズされます。

- `append*` はメモリ内の状態を即座に更新します。
- 永続化は少なくとも1つのアシスタントメッセージが存在するまで遅延されます。
  - 最初のアシスタント前：エントリはメモリに保持されます。ファイルへの追記は発生しません。
  - 最初のアシスタントが存在する場合：メモリ内の完全なセッションがファイルにフラッシュされます。
  - その後：新しいエントリは増分的に追記されます。

コード内の根拠：アシスタント応答を生成しなかったセッションの永続化を避けるためです。

### 耐久性操作

- `flush()` はライターをフラッシュし、`fsync()` を呼び出します。
- アトミックな全体再書き込み（`#rewriteFile`）は一時ファイルに書き込み、flush+fsyncし、クローズしてからターゲットにリネームします。
- マイグレーション、`setSessionName`、`rewriteEntries`、移動操作、およびツール呼び出し引数の書き換えに使用されます。

### エラー動作

- 永続化エラーはラッチされ（`#persistError`）、後続の操作で再スローされます。
- 最初のエラーはセッションファイルのコンテキストとともに1回だけログに記録されます。
- ライターのクローズはベストエフォートですが、最初の意味のあるエラーを伝播します。

## データサイズ制御とBlob外部化

エントリを永続化する前に：

- 大きな文字列は `MAX_PERSIST_CHARS`（500,000文字）に切り詰められ、通知が付きます：
  - `"[Session persistence truncated large content]"`
- 一時フィールド `partialJson` と `jsonlEvents` は削除されます。
- オブジェクトが `content` と `lineCount` の両方を持つ場合、切り詰め後に行数が再計算されます。
- `content` 配列内のbase64長が >= 1024 の画像ブロックはblob参照に外部化されます：
  - `blob:sha256:<hash>` として保存されます
  - 生のバイトがblobストア（`BlobStore.put`）に書き込まれます

読み込み時、blob参照はmessage/custom_messageの画像ブロック用にbase64に戻されます。

## ストレージ抽象化

`SessionStorage` インターフェースは `SessionManager` が使用するすべてのファイルシステム操作を提供します：

- 同期：`ensureDirSync`、`existsSync`、`writeTextSync`、`statSync`、`listFilesSync`
- 非同期：`exists`、`readText`、`readTextPrefix`、`writeText`、`rename`、`unlink`、`openWriter`

実装：

- `FileSessionStorage`：実ファイルシステム（Bun + node fs）
- `MemorySessionStorage`：テスト/非永続セッション用のマップベースのメモリ内実装

`SessionStorageWriter` は `writeLine`、`flush`、`fsync`、`close`、`getError` を公開します。

## セッション検出ユーティリティ

`session-manager.ts` で定義：

- `getRecentSessions(sessionDir, limit)` -> UI/セッションピッカー用の軽量メタデータ
- `findMostRecentSession(sessionDir)` -> mtimeによる最新のもの
- `list(cwd, sessionDir?)` -> 1つのプロジェクトスコープ内のセッション
- `listAll()` -> `~/.xcsh/agent/sessions` 配下のすべてのプロジェクトスコープにわたるセッション

メタデータ抽出は可能な場合はプレフィックスのみを読み取ります（`readTextPrefix(..., 4096)`）。

## 関連するが別のもの：プロンプト履歴ストレージ

`HistoryStorage`（`history-storage.ts`）はプロンプトの呼び出し/検索用の別のSQLiteサブシステムであり、セッションリプレイ用ではありません。

- DB：`~/.xcsh/agent/history.db`
- テーブル：`history(id, prompt, created_at, cwd)`
- FTS5インデックス：トリガーで維持される同期付きの `history_fts`
- メモリ内のlast-promptキャッシュを使用して連続する同一プロンプトを重複排除
- プロンプトキャプチャがターン実行をブロックしないよう非同期挿入（`setImmediate`）

会話グラフ/状態リプレイにはセッションファイルを使用し、プロンプト履歴UXには `HistoryStorage` を使用してください。
