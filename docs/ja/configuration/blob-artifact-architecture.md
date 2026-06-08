---
title: Blob およびアーティファクトストレージアーキテクチャ
description: セッションメディア、スクリーンショット、ツール出力のためのコンテンツアドレス指定可能な Blob ストアおよびアーティファクトレジストリ。
sidebar:
  order: 7
  label: Blob & アーティファクトストレージ
i18n:
  sourceHash: 70d255f48d5b
  translator: machine
---

# Blob およびアーティファクトストレージアーキテクチャ

このドキュメントでは、coding-agent がセッション JSONL の外部に大きな/バイナリペイロードをどのように格納するか、切り詰められたツール出力がどのように永続化されるか、そして内部 URL（`artifact://`、`agent://`）が格納されたデータにどのように解決されるかを説明します。

## 2つのストレージシステムが存在する理由

ランタイムは異なるデータ形状に対して2つの異なる永続化メカニズムを使用します：

- **コンテンツアドレス指定 Blob**（`blob:sha256:<hash>`）：永続化されたセッションエントリから大きな画像 base64 ペイロードを外部化するために使用される、グローバルなバイナリ指向ストレージ。
- **セッションスコープのアーティファクト**（`<sessionFile-without-.jsonl>/` 配下のファイル）：完全なツール出力およびサブエージェント出力に使用される、セッションごとのテキストファイル。

これらは意図的に分離されています：

- Blob ストレージはコンテンツハッシュによる重複排除と安定した参照を最適化し、
- アーティファクトストレージはローカル ID による追記専用のセッションツーリングとヒューマン/ツールによる検索を最適化します。

## ストレージ境界とディスク上のレイアウト

## Blob ストア境界（グローバル）

`SessionManager` は `BlobStore(getBlobsDir())` を構築するため、Blob ファイルは共有グローバル Blob ディレクトリに配置されます（セッションフォルダ内ではありません）。

Blob ファイルの命名：

- ファイルパス：`<blobsDir>/<sha256-hex>`
- 拡張子なし
- エントリに格納される参照文字列：`blob:sha256:<sha256-hex>`

含意：

- 異なるセッション間で同一のバイナリコンテンツは同じハッシュ/パスに解決される、
- 書き込みはコンテンツレベルで冪等である、
- Blob は個々のセッションファイルよりも長く存続できる。

## アーティファクト境界（セッションローカル）

`ArtifactManager` はセッションファイルパスからアーティファクトディレクトリを導出します：

- セッションファイル：`.../<timestamp>_<sessionId>.jsonl`
- アーティファクトディレクトリ：`.../<timestamp>_<sessionId>/`（`.jsonl` を除去）

アーティファクトの種類はこのディレクトリを共有します：

- 切り詰められたツール出力ファイル：`<numericId>.<toolType>.log`（`artifact://` 用）
- サブエージェント出力ファイル：`<outputId>.md`（`agent://` 用）

## ID と名前の割り当てスキーム

## Blob ID：コンテンツハッシュ

`BlobStore.put()` は生のバイナリバイトに対して SHA-256 を計算し、以下を返します：

- `hash`：16進ダイジェスト、
- `path`：`<blobsDir>/<hash>`、
- `ref`：`blob:sha256:<hash>`。

セッションローカルなカウンターは使用されません。

## アーティファクト ID：セッションローカルな単調増加整数

`ArtifactManager` は初回使用時に既存の `*.log` アーティファクトファイルをスキャンして最大の既存数値 ID を見つけ、`nextId = max + 1` を設定します。

割り当て動作：

- ファイル形式：`{id}.{toolType}.log`
- ID は連番の文字列（`"0"`、`"1"`、...）
- スキャンは割り当て前に行われるため、再開時に既存のアーティファクトを上書きしない。

アーティファクトディレクトリが存在しない場合、スキャンは空のリストを返し、割り当ては `0` から開始されます。

## エージェント出力 ID（`agent://`）

`AgentOutputManager` はサブエージェント出力の ID を `<index>-<requestedId>` として割り当てます（オプションで親プレフィックスの下にネスト、例：`0-Parent.1-Child`）。初期化時に既存の `.md` ファイルをスキャンし、再開時に次のインデックスから継続します。

## 永続化データフロー

## 1) セッションエントリの永続化書き換えパス

セッションエントリが書き込まれる前（`#rewriteFile` / インクリメンタル永続化）、`SessionManager` は `prepareEntryForPersistence()`（`truncateForPersistence` 経由）を呼び出します。

主要な動作：

1. **大きな文字列の切り詰め**：過大な文字列はカットされ、`"[Session persistence truncated large content]"` がサフィックスとして追加される。
2. **一時フィールドの除去**：`partialJson` と `jsonlEvents` が永続化エントリから削除される。
3. **画像の Blob への外部化**：
   - `content` 配列内の画像ブロックにのみ適用、
   - `data` がすでに Blob 参照でない場合のみ、
   - base64 の長さが閾値以上の場合のみ（`BLOB_EXTERNALIZE_THRESHOLD = 1024`）、
   - インライン base64 を `blob:sha256:<hash>` に置換。

これによりセッション JSONL をコンパクトに保ちつつ、復元可能性を維持します。

## 2) セッションロードの再水和パス

セッションを開く際（`setSessionFile`）、マイグレーション後に `SessionManager` は `resolveBlobRefsInEntries()` を実行します。

`blob:sha256:<hash>` を持つ各メッセージ/カスタムメッセージの画像ブロックについて：

- Blob ストアから Blob バイトを読み取り、
- バイトを base64 に変換し直し、
- ランタイムコンシューマー向けにインメモリエントリを base64 インラインに変更。

Blob が存在しない場合：

- `resolveImageData()` が警告をログ出力、
- 元の参照文字列をそのまま返す、
- ロードは継続（ハードクラッシュなし）。

## 3) ツール出力のスピル/切り詰めパス

`OutputSink` は bash/python/ssh および関連エグゼキュータのストリーミング出力を駆動します。

動作：

1. すべてのチャンクはサニタイズされ、インメモリのテールバッファに追加される。
2. インメモリバイトがスピル閾値（`DEFAULT_MAX_BYTES`、50KB）を超えると、シンクは出力を切り詰め済みとしてマークする。
3. アーティファクトパスが利用可能な場合、シンクはファイルライターを開き以下を書き込む：
   - 既存のバッファ済みコンテンツを1回、
   - 以降のすべてのチャンク。
4. インメモリバッファは表示用に常にテールウィンドウにトリミングされる。
5. `dump()` はファイルシンクが正常に作成された場合のみ `artifactId` を含むサマリーを返す。

実際の効果：

- UI/ツールの戻り値は切り詰められたテールを表示、
- 完全な出力はアーティファクトファイルに保存され、`artifact://<id>` として参照される。

ファイルシンクの作成に失敗した場合（I/O エラー、パスの欠落など）、シンクはサイレントにインメモリ切り詰めのみにフォールバックし、完全な出力は永続化されません。

## URL アクセスモデル

## `blob:` 参照

`blob:sha256:<hash>` は永続化されたセッションエントリペイロード内の永続化参照であり、ルーターが処理する内部 URL スキームではありません。解決はセッションロード時に `SessionManager` によって行われます。

## `artifact://<id>`

`ArtifactProtocolHandler` によって処理されます：

- アクティブなセッションアーティファクトディレクトリが必要、
- ID は数値でなければならない、
- ファイル名プレフィックス `<id>.` のマッチングによって解決、
- マッチした `.log` ファイルから生テキスト（`text/plain`）を返す、
- 見つからない場合、利用可能なアーティファクト ID のリストを含むエラーを返す。

ディレクトリが存在しない場合の動作：

- アーティファクトディレクトリが存在しない場合、`No artifacts directory found` をスローする。

## `agent://<id>`

`AgentProtocolHandler` が `<artifactsDir>/<id>.md` を処理します：

- プレーン形式ではマークダウンテキストを返す、
- `/path` または `?q=` 形式では JSON 抽出を実行、
- パスとクエリの抽出は組み合わせて使用できない、
- 抽出が要求された場合、ファイルコンテンツは JSON としてパースできなければならない。

ディレクトリが存在しない場合の動作：

- `No artifacts directory found` をスローする。

出力が存在しない場合の動作：

- 既存の `.md` ファイルから利用可能な ID とともに `Not found: <id>` をスローする。

読み取りツール統合：

- `read` は非抽出型の内部 URL 読み取りに対して offset/limit ページネーションをサポートする、
- `agent://` 抽出が使用される場合は `offset/limit` を拒否する。

## 再開、フォーク、および移動のセマンティクス

## 再開

- `ArtifactManager` は最初の割り当て時に既存の `{id}.*.log` ファイルをスキャンし、番号付けを継続する。
- `AgentOutputManager` は既存の `.md` 出力 ID をスキャンし、番号付けを継続する。
- `SessionManager` はロード時に Blob 参照を base64 に再水和する。

## フォーク

`SessionManager.fork()` は新しいセッション ID と `parentSession` リンクを持つ新しいセッションファイルを作成し、旧/新のファイルパスを返します。アーティファクトのコピーは `AgentSession.fork()` によって処理されます：

- 旧アーティファクトディレクトリから新アーティファクトディレクトリへの再帰コピーを試行、
- 旧ディレクトリが存在しない場合は許容、
- ENOENT 以外のコピーエラーは警告としてログ出力され、フォークは完了する。

フォーク後の ID への影響：

- コピーが成功した場合、新セッションのアーティファクトカウンターはコピーされた最大 ID の次から継続、
- コピーが失敗/スキップされた場合、新セッションのアーティファクト ID は `0` から開始。

フォーク後の Blob への影響：

- Blob はグローバルでコンテンツアドレス指定されているため、Blob ディレクトリのコピーは不要。

## 新しい cwd への移動

`SessionManager.moveTo()` はセッションファイルとアーティファクトディレクトリの両方を新しいデフォルトセッションディレクトリにリネームし、後のステップが失敗した場合のロールバックロジックを備えています。これにより、セッションスコープを再配置しつつアーティファクトの同一性を保持します。

## 障害処理とフォールバックパス

| ケース | 動作 |
| --- | --- |
| 再水和時に Blob ファイルが存在しない | 警告を出し、`blob:sha256:` 参照文字列をインメモリに保持 |
| `BlobStore.get` 経由の Blob 読み取り ENOENT | `null` を返す |
| アーティファクトディレクトリが存在しない（`ArtifactManager.listFiles`） | 空のリストを返す（割り当てを最初から開始可能） |
| アーティファクトディレクトリが存在しない（`artifact://` / `agent://`） | 明示的に `No artifacts directory found` をスロー |
| アーティファクト ID が見つからない | 利用可能な ID リストとともにスロー |
| OutputSink アーティファクトライターの初期化に失敗 | テールのみの切り詰めで継続（完全出力アーティファクトなし） |
| セッションファイルなし（一部のタスクパス） | タスクツールがサブエージェント出力用に一時アーティファクトディレクトリにフォールバック |

## バイナリ Blob 外部化とテキスト出力アーティファクト

- **Blob 外部化**は、永続化されたセッションエントリコンテンツ内のバイナリ画像ペイロード用であり、JSONL 内のインライン base64 を安定したコンテンツ参照に置換します。
- **アーティファクト**は実行出力およびサブエージェント出力用のプレーンテキストファイルであり、内部 URL を通じてセッションローカルな ID でアドレス指定可能です。

2つのシステムは間接的にのみ交差し（両方ともセッション JSONL の肥大化を軽減）、ID、ライフタイム、および検索パスは異なります。

## 実装ファイル

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — Blob 参照フォーマット、ハッシュ化、put/get、外部化/解決ヘルパー。
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — セッションアーティファクトディレクトリモデルと数値アーティファクト ID 割り当て。
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — `OutputSink` の切り詰め/ファイルへのスピル動作とサマリーメタデータ。
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — 永続化変換、ロード時の Blob 再水和、セッションフォーク/移動のインタラクション。
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — インタラクティブフォーク時のアーティファクトディレクトリコピー。
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — ツールアーティファクトマネージャーのブートストラップとツールごとのアーティファクトパス割り当て。
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://` リゾルバー。
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — `agent://` リゾルバー + JSON 抽出。
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — 内部 URL ルーターのワイヤリングとアーティファクトディレクトリリゾルバー。
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — `agent://` 用のセッションスコープのエージェント出力 ID 割り当て。
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — サブエージェント出力アーティファクトの書き込み（`<id>.md`）と一時アーティファクトディレクトリのフォールバック。
