---
title: Blobおよびアーティファクトストレージアーキテクチャ
description: セッションメディア、スクリーンショット、ツール出力のためのコンテンツアドレス可能なBlobストアとアーティファクトレジストリ。
sidebar:
  order: 7
  label: Blob・アーティファクトストレージ
i18n:
  sourceHash: 70d255f48d5b
  translator: machine
---

# Blobおよびアーティファクトストレージアーキテクチャ

このドキュメントでは、coding-agentがセッションJSONLの外部に大きな/バイナリペイロードを保存する方法、切り詰められたツール出力がどのように永続化されるか、および内部URL（`artifact://`、`agent://`）が保存されたデータにどのように解決されるかを説明します。

## 2つのストレージシステムが存在する理由

ランタイムは異なるデータ形状に対して2つの異なる永続化メカニズムを使用します：

- **コンテンツアドレスBlob**（`blob:sha256:<hash>`）：永続化されたセッションエントリから大きな画像base64ペイロードを外部化するために使用される、グローバルでバイナリ指向のストレージ。
- **セッションスコープのアーティファクト**（`<sessionFile-without-.jsonl>/`配下のファイル）：完全なツール出力とサブエージェント出力に使用されるセッションごとのテキストファイル。

これらは意図的に分離されています：

- Blobストレージはコンテンツハッシュによる重複排除と安定した参照を最適化し、
- アーティファクトストレージはアペンドオンリーのセッションツーリングとヒューマン/ツールによるローカルIDでの取得を最適化します。

## ストレージの境界とディスク上のレイアウト

## Blobストアの境界（グローバル）

`SessionManager`は`BlobStore(getBlobsDir())`を構築するため、Blobファイルは共有グローバルBlobディレクトリに配置されます（セッションフォルダ内ではありません）。

Blobファイルの命名規則：

- ファイルパス：`<blobsDir>/<sha256-hex>`
- 拡張子なし
- エントリに保存される参照文字列：`blob:sha256:<sha256-hex>`

意味合い：

- セッション間で同じバイナリコンテンツは同じハッシュ/パスに解決される、
- 書き込みはコンテンツレベルで冪等である、
- Blobは個々のセッションファイルよりも長く存続できる。

## アーティファクトの境界（セッションローカル）

`ArtifactManager`はセッションファイルパスからアーティファクトディレクトリを導出します：

- セッションファイル：`.../<timestamp>_<sessionId>.jsonl`
- アーティファクトディレクトリ：`.../<timestamp>_<sessionId>/`（`.jsonl`を除去）

アーティファクトタイプはこのディレクトリを共有します：

- 切り詰められたツール出力ファイル：`<numericId>.<toolType>.log`（`artifact://`用）
- サブエージェント出力ファイル：`<outputId>.md`（`agent://`用）

## IDと名前の割り当てスキーム

## Blob ID：コンテンツハッシュ

`BlobStore.put()`は生のバイナリバイトに対してSHA-256を計算し、以下を返します：

- `hash`：16進ダイジェスト、
- `path`：`<blobsDir>/<hash>`、
- `ref`：`blob:sha256:<hash>`。

セッションローカルのカウンターは使用されません。

## アーティファクトID：セッションローカルの単調増加整数

`ArtifactManager`は初回使用時に既存の`*.log`アーティファクトファイルをスキャンして最大の既存数値IDを見つけ、`nextId = max + 1`を設定します。

割り当て動作：

- ファイル形式：`{id}.{toolType}.log`
- IDは連続した文字列（`"0"`、`"1"`、...）
- スキャンは割り当て前に行われるため、再開時に既存のアーティファクトを上書きしない。

アーティファクトディレクトリが存在しない場合、スキャンは空のリストを返し、割り当ては`0`から開始します。

## エージェント出力ID（`agent://`）

`AgentOutputManager`はサブエージェント出力のIDを`<index>-<requestedId>`として割り当てます（オプションで親プレフィックスの下にネスト、例：`0-Parent.1-Child`）。初期化時に既存の`.md`ファイルをスキャンし、再開時に次のインデックスから継続します。

## 永続化データフロー

## 1) セッションエントリの永続化書き換えパス

セッションエントリが書き込まれる前に（`#rewriteFile` / インクリメンタル永続化）、`SessionManager`は`prepareEntryForPersistence()`を呼び出します（`truncateForPersistence`経由）。

主要な動作：

1. **大きな文字列の切り詰め**：超過サイズの文字列はカットされ、`"[Session persistence truncated large content]"`のサフィックスが付与される。
2. **一時フィールドの除去**：`partialJson`と`jsonlEvents`が永続化エントリから削除される。
3. **画像のBlobへの外部化**：
   - `content`配列内の画像ブロックにのみ適用、
   - `data`がすでにBlob参照でない場合のみ、
   - base64の長さが閾値以上の場合のみ（`BLOB_EXTERNALIZE_THRESHOLD = 1024`）、
   - インラインbase64を`blob:sha256:<hash>`に置換。

これによりセッションJSONLをコンパクトに保ちながら復元可能性を維持します。

## 2) セッション読み込みのリハイドレーションパス

セッションを開くとき（`setSessionFile`）、マイグレーション後に`SessionManager`は`resolveBlobRefsInEntries()`を実行します。

`blob:sha256:<hash>`を持つ各message/custom-messageの画像ブロックに対して：

- Blobストアからblobバイトを読み込み、
- バイトをbase64に変換し戻し、
- ランタイムコンシューマー向けにインメモリエントリをインラインbase64に変更。

Blobが見つからない場合：

- `resolveImageData()`が警告をログ出力、
- 元のref文字列をそのまま返す、
- 読み込みは継続（ハードクラッシュなし）。

## 3) ツール出力のスピル/切り詰めパス

`OutputSink`はbash/python/sshおよび関連エグゼキューターでストリーミング出力を提供します。

動作：

1. すべてのチャンクがサニタイズされ、インメモリのテールバッファに追加される。
2. インメモリバイトがスピル閾値（`DEFAULT_MAX_BYTES`、50KB）を超えると、シンクは出力を切り詰め済みとしてマークする。
3. アーティファクトパスが利用可能な場合、シンクはファイルライターを開き、以下を書き込む：
   - 既存のバッファ済みコンテンツを1回、
   - 以降のすべてのチャンク。
4. インメモリバッファは表示用に常にテールウィンドウにトリミングされる。
5. `dump()`はファイルシンクが正常に作成された場合のみ`artifactId`を含むサマリーを返す。

実質的な効果：

- UI/ツールの戻り値は切り詰められたテールを表示、
- 完全な出力はアーティファクトファイルに保存され、`artifact://<id>`として参照される。

ファイルシンクの作成に失敗した場合（I/Oエラー、パスの欠落など）、シンクはサイレントにインメモリのテールオンリー切り詰めにフォールバックし、完全な出力は永続化されません。

## URLアクセスモデル

## `blob:`参照

`blob:sha256:<hash>`はセッションエントリペイロード内の永続化参照であり、ルーターが処理する内部URLスキームではありません。解決はセッション読み込み時に`SessionManager`によって行われます。

## `artifact://<id>`

`ArtifactProtocolHandler`によって処理されます：

- アクティブなセッションアーティファクトディレクトリが必要、
- IDは数値でなければならない、
- ファイル名プレフィックス`<id>.`のマッチングで解決、
- マッチした`.log`ファイルから生テキスト（`text/plain`）を返す、
- 見つからない場合、エラーに利用可能なアーティファクトIDのリストが含まれる。

ディレクトリが存在しない場合の動作：

- アーティファクトディレクトリが存在しない場合、`No artifacts directory found`をスローする。

## `agent://<id>`

`AgentProtocolHandler`が`<artifactsDir>/<id>.md`に対して処理します：

- プレーン形式はマークダウンテキストを返す、
- `/path`または`?q=`形式はJSON抽出を実行、
- パスとクエリの抽出は組み合わせられない、
- 抽出が要求された場合、ファイルの内容はJSONとして解析可能でなければならない。

ディレクトリが存在しない場合の動作：

- `No artifacts directory found`をスローする。

出力が存在しない場合の動作：

- 既存の`.md`ファイルから利用可能なIDとともに`Not found: <id>`をスローする。

Readツールとの統合：

- `read`は非抽出の内部URL読み込みに対してoffset/limitページネーションをサポート、
- `agent://`抽出使用時は`offset/limit`を拒否。

## 再開、フォーク、および移動セマンティクス

## 再開

- `ArtifactManager`は初回割り当て時に既存の`{id}.*.log`ファイルをスキャンし、番号付けを継続する。
- `AgentOutputManager`は既存の`.md`出力IDをスキャンし、番号付けを継続する。
- `SessionManager`は読み込み時にBlob参照をbase64にリハイドレーションする。

## フォーク

`SessionManager.fork()`は新しいセッションIDと`parentSession`リンクを持つ新しいセッションファイルを作成し、古い/新しいファイルパスを返します。アーティファクトのコピーは`AgentSession.fork()`によって処理されます：

- 古いアーティファクトディレクトリから新しいアーティファクトディレクトリへの再帰コピーを試行、
- 古いディレクトリの欠落は許容、
- ENOENT以外のコピーエラーは警告としてログ出力され、フォークは完了する。

フォーク後のIDへの影響：

- コピーが成功した場合、新しいセッションのアーティファクトカウンターはコピーされた最大IDの後から継続、
- コピーが失敗/スキップされた場合、新しいセッションのアーティファクトIDは`0`から開始。

フォーク後のBlobへの影響：

- Blobはグローバルでコンテンツアドレスされるため、Blobディレクトリのコピーは不要。

## 新しいcwdへの移動

`SessionManager.moveTo()`はセッションファイルとアーティファクトディレクトリの両方を新しいデフォルトセッションディレクトリにリネームし、後続のステップが失敗した場合のロールバックロジックを備えています。これにより、セッションスコープを再配置しながらアーティファクトのIDが保持されます。

## 障害処理とフォールバックパス

| ケース | 動作 |
| --- | --- |
| リハイドレーション時にBlobファイルが欠落 | 警告を出力し、`blob:sha256:`参照文字列をインメモリに保持 |
| `BlobStore.get`経由のBlob読み込みENOENT | `null`を返す |
| アーティファクトディレクトリが欠落（`ArtifactManager.listFiles`） | 空のリストを返す（割り当ては新規開始可能） |
| アーティファクトディレクトリが欠落（`artifact://` / `agent://`） | 明示的に`No artifacts directory found`をスロー |
| アーティファクトIDが見つからない | 利用可能なIDリスト付きでスロー |
| OutputSinkアーティファクトライターの初期化失敗 | テールオンリーの切り詰めで継続（完全出力アーティファクトなし） |
| セッションファイルなし（一部のタスクパス） | タスクツールはサブエージェント出力用に一時アーティファクトディレクトリにフォールバック |

## バイナリBlob外部化 vs テキスト出力アーティファクト

- **Blob外部化**は永続化されたセッションエントリコンテンツ内のバイナリ画像ペイロード用であり、JSONL内のインラインbase64を安定したコンテンツ参照に置換します。
- **アーティファクト**は実行出力とサブエージェント出力のプレーンテキストファイルであり、内部URLを通じてセッションローカルIDでアドレス指定可能です。

2つのシステムは間接的にのみ交差します（どちらもセッションJSONLの肥大化を軽減）が、異なるID体系、ライフタイム、および取得パスを持っています。

## 実装ファイル

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — Blob参照フォーマット、ハッシュ化、put/get、外部化/解決ヘルパー。
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — セッションアーティファクトディレクトリモデルと数値アーティファクトIDの割り当て。
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — `OutputSink`の切り詰め/ファイルスピル動作とサマリーメタデータ。
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — 永続化変換、読み込み時のBlobリハイドレーション、セッションフォーク/移動の相互作用。
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — インタラクティブフォーク時のアーティファクトディレクトリコピー。
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — ツールアーティファクトマネージャーのブートストラップとツールごとのアーティファクトパス割り当て。
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://`リゾルバー。
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — `agent://`リゾルバー + JSON抽出。
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — 内部URLルーターの配線とartifacts-dirリゾルバー。
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — `agent://`用のセッションスコープのエージェント出力ID割り当て。
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — サブエージェント出力アーティファクト書き込み（`<id>.md`）と一時アーティファクトディレクトリフォールバック。
