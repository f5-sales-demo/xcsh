---
title: Blob およびアーティファクトストレージアーキテクチャ
description: セッションメディア、スクリーンショット、ツール出力のためのコンテンツアドレス可能なBlobストアおよびアーティファクトレジストリ。
sidebar:
  order: 7
  label: Blob & アーティファクトストレージ
i18n:
  sourceHash: 70d255f48d5b
  translator: machine
---

# Blob およびアーティファクトストレージアーキテクチャ

本ドキュメントでは、coding-agent がセッション JSONL の外部に大容量/バイナリペイロードをどのように保存するか、切り詰められたツール出力がどのように永続化されるか、そして内部 URL（`artifact://`、`agent://`）がどのように保存データに解決されるかについて説明します。

## 2つのストレージシステムが存在する理由

ランタイムは、異なるデータ形状に対して2つの異なる永続化メカニズムを使用します：

- **コンテンツアドレス Blob**（`blob:sha256:<hash>`）：永続化されたセッションエントリから大きな画像 base64 ペイロードを外部化するために使用される、グローバルなバイナリ指向ストレージ。
- **セッションスコープのアーティファクト**（`<sessionFile-without-.jsonl>/` 配下のファイル）：完全なツール出力およびサブエージェント出力に使用されるセッションごとのテキストファイル。

これらは意図的に分離されています：

- Blob ストレージはコンテンツハッシュによる重複排除と安定した参照を最適化し、
- アーティファクトストレージはアペンドオンリーのセッションツーリングとローカル ID によるヒューマン/ツール取得を最適化します。

## ストレージ境界とディスク上のレイアウト

## Blob ストア境界（グローバル）

`SessionManager` は `BlobStore(getBlobsDir())` を構築するため、Blob ファイルは共有グローバル Blob ディレクトリに配置されます（セッションフォルダ内ではありません）。

Blob ファイルの命名規則：

- ファイルパス：`<blobsDir>/<sha256-hex>`
- 拡張子なし
- エントリに保存される参照文字列：`blob:sha256:<sha256-hex>`

影響：

- セッション間で同一のバイナリコンテンツは同じハッシュ/パスに解決される、
- 書き込みはコンテンツレベルで冪等である、
- Blob は個々のセッションファイルよりも長く存続できる。

## アーティファクト境界（セッションローカル）

`ArtifactManager` はセッションファイルパスからアーティファクトディレクトリを導出します：

- セッションファイル：`.../<timestamp>_<sessionId>.jsonl`
- アーティファクトディレクトリ：`.../<timestamp>_<sessionId>/`（`.jsonl` を除去）

アーティファクトタイプはこのディレクトリを共有します：

- 切り詰められたツール出力ファイル：`<numericId>.<toolType>.log`（`artifact://` 用）
- サブエージェント出力ファイル：`<outputId>.md`（`agent://` 用）

## ID と名前の割り当てスキーム

## Blob ID：コンテンツハッシュ

`BlobStore.put()` は生のバイナリバイトに対して SHA-256 を計算し、以下を返します：

- `hash`：16進ダイジェスト、
- `path`：`<blobsDir>/<hash>`、
- `ref`：`blob:sha256:<hash>`。

セッションローカルカウンタは使用されません。

## アーティファクト ID：セッションローカルの単調増加整数

`ArtifactManager` は初回使用時に既存の `*.log` アーティファクトファイルをスキャンして最大の既存数値 ID を見つけ、`nextId = max + 1` に設定します。

割り当て動作：

- ファイル形式：`{id}.{toolType}.log`
- ID は連続した文字列（`"0"`、`"1"`、...）
- スキャンは割り当て前に行われるため、再開時に既存のアーティファクトを上書きしない。

アーティファクトディレクトリが存在しない場合、スキャンは空のリストを返し、割り当ては `0` から開始されます。

## エージェント出力 ID（`agent://`）

`AgentOutputManager` はサブエージェント出力の ID を `<index>-<requestedId>` として割り当てます（オプションで親プレフィックスの下にネスト、例：`0-Parent.1-Child`）。初期化時に既存の `.md` ファイルをスキャンし、再開時に次のインデックスから継続します。

## 永続化データフロー

## 1）セッションエントリ永続化の書き換えパス

セッションエントリが書き込まれる前（`#rewriteFile` / インクリメンタル永続化）、`SessionManager` は `prepareEntryForPersistence()`（`truncateForPersistence` 経由）を呼び出します。

主要な動作：

1. **大きな文字列の切り詰め**：サイズ超過の文字列はカットされ、`"[Session persistence truncated large content]"` がサフィックスとして付加されます。
2. **一時フィールドの除去**：`partialJson` と `jsonlEvents` は永続化エントリから削除されます。
3. **画像の Blob への外部化**：
   - `content` 配列内の画像ブロックにのみ適用、
   - `data` がすでに Blob 参照でない場合のみ、
   - base64 の長さがしきい値以上の場合のみ（`BLOB_EXTERNALIZE_THRESHOLD = 1024`）、
   - インラインの base64 を `blob:sha256:<hash>` に置き換える。

これによりセッション JSONL をコンパクトに保ちながら、回復可能性を維持します。

## 2）セッション読み込み時のリハイドレーションパス

セッションを開くとき（`setSessionFile`）、マイグレーション後に `SessionManager` は `resolveBlobRefsInEntries()` を実行します。

`blob:sha256:<hash>` を持つ各メッセージ/カスタムメッセージの画像ブロックについて：

- Blob ストアから Blob バイトを読み取り、
- バイトを base64 に変換し直し、
- ランタイム消費者向けにインメモリエントリを変更してインライン base64 にする。

Blob が存在しない場合：

- `resolveImageData()` は警告をログ出力、
- 元の参照文字列をそのまま返す、
- 読み込みは続行される（ハードクラッシュしない）。

## 3）ツール出力のスピル/切り詰めパス

`OutputSink` は bash/python/ssh および関連エグゼキュータでのストリーミング出力を駆動します。

動作：

1. すべてのチャンクはサニタイズされ、インメモリのテールバッファに追加される。
2. インメモリのバイト数がスピルしきい値（`DEFAULT_MAX_BYTES`、50KB）を超えると、シンクは出力を切り詰め済みとしてマークする。
3. アーティファクトパスが利用可能な場合、シンクはファイルライターを開き、以下を書き込む：
   - 既存のバッファ内容を一度、
   - 以降のすべてのチャンク。
4. インメモリバッファは常に表示用のテールウィンドウにトリミングされる。
5. `dump()` はファイルシンクが正常に作成された場合のみ `artifactId` を含むサマリーを返す。

実用的な効果：

- UI/ツール戻り値は切り詰められたテールを表示、
- 完全な出力はアーティファクトファイルに保存され、`artifact://<id>` として参照される。

ファイルシンクの作成に失敗した場合（I/O エラー、パス不在など）、シンクはサイレントにインメモリの切り詰めのみにフォールバックします。完全な出力は永続化されません。

## URL アクセスモデル

## `blob:` 参照

`blob:sha256:<hash>` はセッションエントリペイロード内の永続化参照であり、ルーターによって処理される内部 URL スキームではありません。解決はセッション読み込み時に `SessionManager` によって行われます。

## `artifact://<id>`

`ArtifactProtocolHandler` によって処理されます：

- アクティブなセッションアーティファクトディレクトリが必要、
- ID は数値でなければならない、
- ファイル名プレフィックス `<id>.` のマッチングにより解決、
- マッチした `.log` ファイルから生テキスト（`text/plain`）を返す、
- 存在しない場合、利用可能なアーティファクト ID のリストをエラーに含める。

ディレクトリが存在しない場合の動作：

- アーティファクトディレクトリが存在しない場合、`No artifacts directory found` をスローする。

## `agent://<id>`

`AgentProtocolHandler` が `<artifactsDir>/<id>.md` を処理します：

- プレーン形式はマークダウンテキストを返す、
- `/path` または `?q=` 形式は JSON 抽出を実行する、
- パス抽出とクエリ抽出は組み合わせることができない、
- 抽出がリクエストされた場合、ファイル内容は JSON としてパースできなければならない。

ディレクトリが存在しない場合の動作：

- `No artifacts directory found` をスローする。

出力が存在しない場合の動作：

- 既存の `.md` ファイルから利用可能な ID とともに `Not found: <id>` をスローする。

Read ツールとの統合：

- `read` は抽出なしの内部 URL 読み取りに対してオフセット/リミットのページネーションをサポートする、
- `agent://` 抽出使用時は `offset/limit` を拒否する。

## 再開、フォーク、移動のセマンティクス

## 再開

- `ArtifactManager` は最初の割り当て時に既存の `{id}.*.log` ファイルをスキャンし、番号付けを継続する。
- `AgentOutputManager` は既存の `.md` 出力 ID をスキャンし、番号付けを継続する。
- `SessionManager` は読み込み時に Blob 参照を base64 にリハイドレーションする。

## フォーク

`SessionManager.fork()` は新しいセッション ID と `parentSession` リンクを持つ新しいセッションファイルを作成し、古い/新しいファイルパスを返します。アーティファクトのコピーは `AgentSession.fork()` によって処理されます：

- 古いアーティファクトディレクトリから新しいアーティファクトディレクトリへの再帰コピーを試みる、
- 古いディレクトリが存在しない場合は許容される、
- ENOENT 以外のコピーエラーは警告としてログ出力され、フォークは完了する。

フォーク後の ID への影響：

- コピーが成功した場合、新しいセッションのアーティファクトカウンタはコピーされた最大 ID の後から継続する、
- コピーが失敗/スキップされた場合、新しいセッションのアーティファクト ID は `0` から開始する。

フォーク後の Blob への影響：

- Blob はグローバルかつコンテンツアドレスであるため、Blob ディレクトリのコピーは不要。

## 新しい cwd への移動

`SessionManager.moveTo()` はセッションファイルとアーティファクトディレクトリの両方を新しいデフォルトセッションディレクトリにリネームします。後続のステップが失敗した場合のロールバックロジックを備えています。これにより、セッションスコープを再配置しながらアーティファクトの同一性を維持します。

## 障害処理とフォールバックパス

| ケース | 動作 |
| --- | --- |
| リハイドレーション中に Blob ファイルが存在しない | 警告を出し、`blob:sha256:` 参照文字列をインメモリに保持 |
| `BlobStore.get` 経由の Blob 読み取り ENOENT | `null` を返す |
| アーティファクトディレクトリが存在しない（`ArtifactManager.listFiles`） | 空のリストを返す（割り当てはゼロから開始可能） |
| アーティファクトディレクトリが存在しない（`artifact://` / `agent://`） | 明示的に `No artifacts directory found` をスロー |
| アーティファクト ID が見つからない | 利用可能な ID のリストとともにスロー |
| OutputSink アーティファクトライターの初期化失敗 | テールのみの切り詰めを続行（完全出力アーティファクトなし） |
| セッションファイルなし（一部のタスクパス） | タスクツールはサブエージェント出力用の一時アーティファクトディレクトリにフォールバック |

## バイナリ Blob 外部化とテキスト出力アーティファクト

- **Blob 外部化**は、永続化されたセッションエントリコンテンツ内のバイナリ画像ペイロード用です。JSONL 内のインライン base64 を安定したコンテンツ参照に置き換えます。
- **アーティファクト**は、実行出力およびサブエージェント出力のためのプレーンテキストファイルです。内部 URL を通じてセッションローカル ID でアドレス可能です。

2つのシステムは間接的にのみ交差します（どちらもセッション JSONL の肥大化を軽減する）が、ID、ライフタイム、取得パスはそれぞれ異なります。

## 実装ファイル

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — Blob 参照形式、ハッシュ化、put/get、外部化/解決ヘルパー。
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — セッションアーティファクトディレクトリモデルと数値アーティファクト ID の割り当て。
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — `OutputSink` の切り詰め/ファイルへのスピル動作とサマリーメタデータ。
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — 永続化変換、読み込み時の Blob リハイドレーション、セッションフォーク/移動の連携。
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — インタラクティブフォーク時のアーティファクトディレクトリコピー。
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — ツールアーティファクトマネージャーのブートストラップとツールごとのアーティファクトパス割り当て。
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://` リゾルバ。
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — `agent://` リゾルバ + JSON 抽出。
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — 内部 URL ルーターの配線とアーティファクトディレクトリリゾルバ。
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — `agent://` 用のセッションスコープのエージェント出力 ID 割り当て。
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — サブエージェント出力アーティファクト書き込み（`<id>.md`）と一時アーティファクトディレクトリフォールバック。
