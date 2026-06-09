---
title: セッションツリーアーキテクチャ
description: ブランチ、ナビゲーション、および親子会話関係を持つセッションツリーアーキテクチャ。
sidebar:
  order: 2
  label: ツリーアーキテクチャ
i18n:
  sourceHash: bd8b78d6c33a
  translator: machine
---

# セッションツリーアーキテクチャ（現行）

リファレンス: [session.md](./session.md)

このドキュメントでは、セッションツリーナビゲーションの現在の動作について説明します：インメモリツリーモデル、リーフ移動ルール、ブランチ動作、およびエクステンション/イベント統合。

## このサブシステムの概要

セッションは追記専用のエントリログとして保存されますが、ランタイムの動作はツリーベースです：

- ヘッダー以外のすべてのエントリは `id` と `parentId` を持ちます。
- アクティブな位置は `SessionManager` 内の `leafId` です。
- エントリの追加は、常に現在のリーフの子として作成されます。
- ブランチは履歴を**書き換えません**。次の追加の前にリーフのポイント先を変更するだけです。

主要なファイル：

- `src/session/session-manager.ts` — ツリーデータモデル、走査、リーフ移動、ブランチ/セッション抽出
- `src/session/agent-session.ts` — `/tree` ナビゲーションフロー、要約、フック/イベント発行
- `src/modes/components/tree-selector.ts` — インタラクティブなツリーUIの動作とフィルタリング
- `src/modes/controllers/selector-controller.ts` — `/tree` と `/branch` のセレクターオーケストレーション
- `src/modes/controllers/input-controller.ts` — コマンドルーティング（`/tree`、`/branch`、ダブルエスケープ動作）
- `src/session/messages.ts` — `branch_summary`、`compaction`、`custom_message` エントリからLLMコンテキストメッセージへの変換

## `SessionManager` 内のツリーデータモデル

ランタイムインデックス：

- `#byId: Map<string, SessionEntry>` — 任意のエントリの高速ルックアップ
- `#leafId: string | null` — ツリー内の現在位置
- `#labelsById: Map<string, string>` — ターゲットエントリIDによる解決済みラベル

ツリーAPI：

- `getBranch(fromId?)` は親リンクをルートまで辿り、ルート→ノードのパスを返します
- `getTree()` は `SessionTreeNode[]`（`entry`、`children`、`label`）を返します
  - 親リンクが子配列に変換されます
  - 親が見つからないエントリはルートとして扱われます
  - 子はタイムスタンプの古い順→新しい順にソートされます
- `getChildren(parentId)` は直接の子を返します
- `getLabel(id)` は `labelsById` から現在のラベルを解決します

`getTree()` はランタイムの射影です。永続化は追記専用のJSONLエントリのままです。

## リーフ移動のセマンティクス

3つのリーフ移動プリミティブがあります：

1. `branch(entryId)`
   - エントリの存在を検証します
   - `leafId = entryId` を設定します
   - 新しいエントリは書き込まれません

2. `resetLeaf()`
   - `leafId = null` を設定します
   - 次の追加で新しいルートエントリ（`parentId = null`）が作成されます

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - `branchFromId: string | null` を受け取ります
   - `leafId = branchFromId` を設定します
   - `branch_summary` エントリをそのリーフの子として追加します
   - `branchFromId` が `null` の場合、`fromId` は `"root"` として永続化されます

## `/tree` ナビゲーション動作（同一セッションファイル内）

`AgentSession.navigateTree()` はナビゲーションであり、ファイルのフォークではありません。

フロー：

1. ターゲットを検証し、放棄されるパスを計算します（`collectEntriesForBranchSummary`）
2. `TreePreparation` とともに `session_before_tree` を発行します
3. オプションで放棄されるエントリを要約します（フック提供の要約またはビルトイン要約器）
4. 新しいリーフターゲットを計算します：
   - **user** メッセージを選択した場合：リーフはその親に移動し、メッセージテキストがエディタのプリフィルとして返されます
   - **custom_message** を選択した場合：userメッセージと同じルール（リーフ = 親、テキストがエディタにプリフィル）
   - その他のエントリを選択した場合：リーフ = 選択されたエントリID
5. リーフ移動を適用します：
   - 要約あり：`branchWithSummary(newLeafId, ...)`
   - 要約なしで `newLeafId === null`：`resetLeaf()`
   - それ以外：`branch(newLeafId)`
6. 新しいリーフからエージェントコンテキストを再構築し、`session_tree` を発行します

重要：要約エントリは放棄されたブランチの末尾ではなく、**新しいナビゲーション位置**に添付されます。

## `/branch` の動作（新規セッションファイル）

`/branch` と `/tree` は意図的に異なります：

- `/tree` は現在のセッションファイル内でナビゲーションします。
- `/branch` は新しいセッションブランチファイルを作成します（非永続モードの場合はインメモリの置換）。

ユーザー向け `/branch` フロー（`SelectorController.showUserMessageSelector` → `AgentSession.branch`）：

- ブランチソースは **user メッセージ** である必要があります。
- 選択されたユーザーテキストがエディタのプリフィル用に抽出されます。
- 選択されたユーザーメッセージがルート（`parentId === null`）の場合：`newSession({ parentSession: previousSessionFile })` で新しいセッションを開始します。
- それ以外の場合：`createBranchedSession(selectedEntry.parentId)` で選択されたプロンプト境界までの履歴をフォークします。

`SessionManager.createBranchedSession(leafId)` の詳細：

- `getBranch(leafId)` でルート→リーフのパスを構築します。見つからない場合はスローします。
- コピーされるパスから既存の `label` エントリを除外します。
- パスに残るエントリに対して、解決済みの `labelsById` から新しいラベルエントリを再構築します。
- 永続モード：新しいJSONLファイルを書き込み、マネージャーをそれに切り替えます。新しいファイルパスを返します。
- インメモリモード：インメモリのエントリを置換します。`undefined` を返します。

## コンテキスト再構築と要約/カスタム統合

`buildSessionContext()`（`session-manager.ts` 内）はアクティブなルート→リーフのパスを解決し、有効なLLMコンテキスト状態を構築します：

- パス上の最新のthinking/model/mode/ttsr状態を追跡します。
- パス上の最新のcompactionを処理します：
  - 最初にcompaction要約を発行します
  - `firstKeptEntryId` からcompactionポイントまでの保持されたメッセージをリプレイします
  - その後、compaction後のメッセージをリプレイします
- `branch_summary` と `custom_message` エントリを `AgentMessage` オブジェクトとして含めます。

`session/messages.ts` はこれらのメッセージタイプをモデル入力用にマッピングします：

- `branchSummary` と `compactionSummary` はuserロールのテンプレート化されたコンテキストメッセージになります
- `custom`/`hookMessage` はuserロールのコンテンツメッセージになります

そのため、ツリーの移動は古いエントリを変更するのではなく、アクティブなリーフパスを変更することでコンテキストを変更します。

## ラベルとツリーUIの動作

ラベルの永続化：

- `appendLabelChange(targetId, label?)` は現在のリーフチェーン上に `label` エントリを書き込みます。
- `labelsById` は即座に更新されます（設定または削除）。
- `getTree()` は返される各ノードに現在のラベルを解決します。

ツリーセレクターの動作（`tree-selector.ts`）：

- ツリーをフラット化してナビゲーション用にし、アクティブパスのハイライトを保持し、アクティブブランチを優先的に表示します。
- フィルターモードをサポートします：`default`、`no-tools`、`user-only`、`labeled-only`、`all`。
- レンダリングされたセマンティックコンテンツに対するフリーテキスト検索をサポートします。
- `Shift+L` でインラインラベル編集を開き、`appendLabelChange` で書き込みます。

コマンドルーティング：

- `/tree` は常にツリーセレクターを開きます。
- `/branch` は `doubleEscapeAction=tree` でない限りユーザーメッセージセレクターを開きます。その場合はツリーセレクターのUXも使用します。

## ツリー操作に関するエクステンションとフックのタッチポイント

コマンド時のエクステンションAPI（`ExtensionCommandContext`）：

- `branch(entryId)` — ブランチセッションファイルを作成
- `navigateTree(targetId, { summarize? })` — 現在のツリー/ファイル内を移動

ツリーナビゲーション周辺のイベント：

- `session_before_tree`
  - `TreePreparation` を受信します：
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - ナビゲーションをキャンセルできます
  - ビルトイン要約器の代わりに使用される要約ペイロードを提供できます
  - abort `signal` を受信します（エスケープキャンセルパス）
- `session_tree`
  - `newLeafId`、`oldLeafId` を発行します
  - 要約が作成された場合は `summaryEntry` を含みます
  - `fromExtension` は要約の出所を示します

関連するが隣接するライフサイクルフック：

- `session_before_branch` / `session_branch` — `/branch` フロー用
- `session_before_compact`、`session.compacting`、`session_compact` — 後でツリーコンテキスト再構築に影響するcompactionエントリ用

## 実際の制約とエッジケース

- `branch()` は `null` をターゲットにできません。最初のエントリ前のルート状態には `resetLeaf()` を使用してください。
- `branchWithSummary()` は `null` ターゲットをサポートし、`fromId: "root"` を記録します。
- ツリーセレクターで現在のリーフを選択するとノーオペレーションになります。
- 要約にはアクティブなモデルが必要です。モデルがない場合、要約ナビゲーションはすぐに失敗します。
- 要約が中止された場合、ナビゲーションはキャンセルされ、リーフは変更されません。
- インメモリセッションは `createBranchedSession` からブランチファイルパスを返しません。

## 現在も残るレガシー互換性

セッションマイグレーションはロード時に実行されます：

- v1→v2 は `id`/`parentId` を追加し、compactionインデックスアンカーをIDアンカーに変換します
- v2→v3 はレガシーの `hookMessage` ロールを `custom` に移行します

現在のランタイム動作はマイグレーション後のバージョン3ツリーセマンティクスです。
