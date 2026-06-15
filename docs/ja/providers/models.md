---
title: モデルおよびプロバイダー設定
description: models.yml によるモデルレジストリとプロバイダー設定（ルーティング、フォールバック、料金を含む）。
sidebar:
  order: 1
  label: モデルとプロバイダー
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# モデルおよびプロバイダー設定 (`models.yml`)

このドキュメントでは、コーディングエージェントが現在モデルを読み込む方法、オーバーライドを適用する方法、認証情報を解決する方法、および実行時にモデルを選択する方法について説明します。

## モデルの動作を制御するもの

主要な実装ファイル:

- `src/config/model-registry.ts` — 組み込みモデルとカスタムモデルの読み込み、プロバイダーオーバーライド、実行時探索、認証統合
- `src/config/model-resolver.ts` — モデルパターンの解析と initial/smol/slow モデルの選択
- `src/config/settings-schema.ts` — モデル関連設定（`modelRoles`、プロバイダートランスポート設定）
- `src/session/auth-storage.ts` — API キーと OAuth の解決順序
- `packages/ai/src/models.ts` と `packages/ai/src/types.ts` — 組み込みプロバイダー/モデルと `Model`/`compat` 型

## 設定ファイルの場所とレガシー動作

デフォルトの設定パス:

- `~/.xcsh/agent/models.yml`

引き続き存在するレガシー動作:

- `models.yml` が存在せず、同じ場所に `models.json` が存在する場合、`models.yml` に移行されます。
- 明示的な `.json` / `.jsonc` 設定パスは、`ModelRegistry` にプログラム的に渡す場合も引き続きサポートされます。

## `models.yml` の構造

```yaml
configVersion: 1  # optional — written by auto-config, used for migration detection
providers:
  <provider-id>:
    # provider-level config
equivalence:
  overrides:
    <provider-id>/<model-id>: <canonical-model-id>
  exclude:
    - <provider-id>/<model-id>
```

`configVersion` は、自動設定システムによって書き込まれるオプションの整数です。存在する場合、xcsh はこれを使用して古い設定を検出し、自動的にアップグレードします。

`provider-id` は、選択と認証ルックアップ全体で使用される標準的なプロバイダーキーです。

`equivalence` はオプションであり、具体的なプロバイダーモデルの上に標準的なモデルグループを設定します:

- `overrides` は正確な具体的セレクター（`provider/modelId`）を公式のアップストリーム標準 id にマッピングします
- `exclude` は具体的なセレクターを標準グループから除外します

## プロバイダーレベルのフィールド

```yaml
providers:
  my-provider:
    baseUrl: https://api.example.com/v1
    apiKey: MY_PROVIDER_API_KEY
    api: openai-completions
    headers:
      X-Team: platform
    authHeader: true
    auth: apiKey
    discovery:
      type: ollama
    modelOverrides:
      some-model-id:
        name: Renamed model
    models:
      - id: some-model-id
        name: Some Model
        api: openai-completions
        reasoning: false
        input: [text]
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
        contextWindow: 128000
        maxTokens: 16384
        headers:
          X-Model: value
        compat:
          supportsStore: true
          supportsDeveloperRole: true
          supportsReasoningEffort: true
          maxTokensField: max_completion_tokens
          openRouterRouting:
            only: [anthropic]
          vercelGatewayRouting:
            order: [anthropic, openai]
          extraBody:
            gateway: m1-01
            controller: mlx
```

### 使用可能なプロバイダー/モデルの `api` 値

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### 使用可能な auth/discovery 値

- `auth`: `apiKey`（デフォルト）または `none`
- `discovery.type`: `ollama`

## 検証ルール（現在）

### 完全なカスタムプロバイダー（`models` が空でない場合）

必須:

- `baseUrl`
- `auth: none` でない限り `apiKey`
- プロバイダーレベルまたは各モデルに `api`

### オーバーライドのみのプロバイダー（`models` が欠落または空の場合）

以下のうち少なくとも1つを定義する必要があります:

- `baseUrl`
- `modelOverrides`
- `discovery`

### Discovery

- `discovery` にはプロバイダーレベルの `api` が必要です。

### モデル値のチェック

- `id` は必須
- `contextWindow` と `maxTokens` は、指定する場合は正の値である必要があります

## マージとオーバーライドの順序

ModelRegistry パイプライン（更新時）:

1. `@f5xc-salesdemos/pi-ai` から組み込みプロバイダー/モデルを読み込む。
2. `models.yml` カスタム設定を読み込む。
3. プロバイダーオーバーライド（`baseUrl`、`headers`）を組み込みモデルに適用する。
4. `modelOverrides`（プロバイダー + モデル id ごと）を適用する。
5. カスタム `models` をマージする:
   - 同じ `provider + id` は既存のものを置き換える
   - それ以外の場合は追加
6. 実行時に発見されたモデル（現在は Ollama と LM Studio）を適用し、モデルオーバーライドを再適用する。

## 標準モデルの等価性とまとめ

レジストリはすべての具体的なプロバイダーモデルを保持し、その上に標準レイヤーを構築します。

標準 id は公式のアップストリーム id のみです。例:

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### `models.yml` の equivalence 設定

例:

```yaml
providers:
  zenmux:
    baseUrl: https://api.zenmux.example/v1
    apiKey: ZENMUX_API_KEY
    api: openai-codex-responses
    models:
      - id: codex
        name: Zenmux Codex
        reasoning: true
        input: [text]
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
        contextWindow: 200000
        maxTokens: 32768

equivalence:
  overrides:
    zenmux/codex: gpt-5.3-codex
    p-codex/codex: gpt-5.3-codex
  exclude:
    - demo/codex-preview
```

標準グループのビルド順序:

1. `equivalence.overrides` からの正確なユーザーオーバーライド
2. 組み込みモデルメタデータからのバンドルされた公式 id との一致
3. ゲートウェイ/プロバイダーバリアントの保守的なヒューリスティック正規化
4. 具体的なモデル自身の id へのフォールバック

現在のヒューリスティックは意図的に狭い範囲に限定されています:

- 埋め込まれたアップストリームプレフィックスは、存在する場合に削除できます（例: `anthropic/...` または `openai/...`）
- ドット区切りおよびダッシュ区切りのバージョンバリアントは、既存の公式 id にマッピングされる場合にのみ正規化できます（例: `4.6 -> 4-6`）
- 曖昧なファミリーやバージョンは、バンドルされた一致または明示的なオーバーライドなしにはマージされません

### 標準解決の動作

複数の具体的なバリアントが標準 id を共有する場合、解決には以下が使用されます:

1. 可用性と認証
2. `config.yml` の `modelProviderOrder`
3. `modelProviderOrder` が設定されていない場合は既存のレジストリ/プロバイダーの順序

無効または未認証のプロバイダーはスキップされます。

セッション状態とトランスクリプトは、実際にターンを実行した具体的なプロバイダー/モデルを引き続き記録します。

プロバイダーデフォルトとモデルごとのオーバーライド:

- プロバイダーの `headers` はベースラインです。
- モデルの `headers` はプロバイダーのヘッダーキーをオーバーライドします。
- `modelOverrides` はモデルメタデータ（`name`、`reasoning`、`input`、`cost`、`contextWindow`、`maxTokens`、`headers`、`compat`、`contextPromotionTarget`）をオーバーライドできます。
- `compat` はネストされたルーティングブロック（`openRouterRouting`、`vercelGatewayRouting`、`extraBody`）に対してディープマージされます。

## 実行時探索の統合

### 暗黙的な Ollama 探索

`ollama` が明示的に設定されていない場合、レジストリは暗黙的な探索可能プロバイダーを追加します:

- プロバイダー: `ollama`
- api: `openai-completions`
- ベース URL: `OLLAMA_BASE_URL` または `http://127.0.0.1:11434`
- 認証モード: キーなし（`auth: none` の動作）

実行時探索は Ollama の `GET /api/tags` を呼び出し、ローカルのデフォルトでモデルエントリーを合成します。

### 暗黙的な llama.cpp 探索

`llama.cpp` が明示的に設定されていない場合、レジストリは暗黙的な探索可能プロバイダーを追加します:
注意: openai-completions の代わりに新しい anthropic messages api を使用しています。

- プロバイダー: `llama.cpp`
- api: `openai-responses`
- ベース URL: `LLAMA_CPP_BASE_URL` または `http://127.0.0.1:8080`
- 認証モード: キーなし（`auth: none` の動作）

実行時探索は llama.cpp の `GET models` を呼び出し、ローカルのデフォルトでモデルエントリーを合成します。

### 暗黙的な LM Studio 探索

`lm-studio` が明示的に設定されていない場合、レジストリは暗黙的な探索可能プロバイダーを追加します:

- プロバイダー: `lm-studio`
- api: `openai-completions`
- ベース URL: `LM_STUDIO_BASE_URL` または `http://127.0.0.1:1234/v1`
- 認証モード: キーなし（`auth: none` の動作）

実行時探索はモデルを取得し（`GET /models`）、ローカルのデフォルトでモデルエントリーを合成します。

### 明示的なプロバイダー探索

探索を自分で設定できます:

```yaml
providers:
  ollama:
    baseUrl: http://127.0.0.1:11434
    api: openai-completions
    auth: none
    discovery:
      type: ollama
      
  llama.cpp:
    baseUrl: http://127.0.0.1:8080
    api: openai-responses
    auth: none
    discovery:
      type: llama.cpp
```

### 拡張プロバイダーの登録

拡張機能は実行時にプロバイダーを登録できます（`pi.registerProvider(...)`）。以下を含みます:

- プロバイダーのモデル置換/追加
- 新しい API ID のカスタムストリームハンドラー登録
- カスタム OAuth プロバイダーの登録

## 認証と API キーの解決順序

プロバイダーのキーを要求する際の有効な順序:

1. 実行時オーバーライド（CLI `--api-key`）
2. `agent.db` に保存された API キー認証情報
3. `agent.db` に保存された OAuth 認証情報（更新あり）
4. 環境変数マッピング（`OPENAI_API_KEY`、`ANTHROPIC_API_KEY` など）
5. ModelRegistry フォールバックリゾルバー（`models.yml` のプロバイダー `apiKey`、環境変数名またはリテラルのセマンティクス）

`models.yml` の `apiKey` の動作:

- 値は最初に環境変数名として処理されます。
- 環境変数が存在しない場合、リテラル文字列がトークンとして使用されます。

`authHeader: true` でプロバイダーの `apiKey` が設定されている場合、モデルは以下を受け取ります:

- `Authorization: Bearer <resolved-key>` ヘッダーが注入されます。

キーなしプロバイダー:

- `auth: none` でマークされたプロバイダーは、認証情報なしで利用可能として扱われます。
- `getApiKey*` はそれらに対して `kNoAuth` を返します。

## モデルの可用性とすべてのモデル

- `getAll()` は読み込まれたモデルレジストリ（組み込み + マージされたカスタム + 探索済み）を返します。
- `getAvailable()` は、キーなしまたは解決可能な認証を持つモデルにフィルタリングします。

したがって、モデルはレジストリに存在していても、認証が利用可能になるまで選択できない場合があります。

## 実行時モデル解決

### CLI とパターン解析

`model-resolver.ts` がサポートするもの:

- 正確な `provider/modelId`
- 正確な標準モデル id
- 正確なモデル id（プロバイダーは推論される）
- ファジー/部分文字列マッチング
- `--models` のグロブスコープパターン（例: `openai/*`、`*sonnet*`）
- オプションの `:thinkingLevel` サフィックス（`off|minimal|low|medium|high|xhigh`）

`--provider` はレガシーです。`--model` が推奨されます。

正確なセレクターの解決優先度:

1. 正確な `provider/modelId` はまとめをバイパスします
2. 正確な標準 id は標準インデックスを通じて解決されます
3. 正確なベアの具体的 id も機能します
4. ファジーとグロブマッチングは正確なパスの後に実行されます

### 初期モデル選択の優先度

`findInitialModel(...)` は次の順序を使用します:

1. 明示的な CLI プロバイダー + モデル
2. 最初のスコープ付きモデル（再開しない場合）
3. 保存されたデフォルトのプロバイダー/モデル
4. 利用可能なモデルの中の既知のプロバイダーデフォルト（例: OpenAI/Anthropic など）
5. 最初の利用可能なモデル

### ロールエイリアスと設定

サポートされているモデルロール:

- `default`、`smol`、`slow`、`plan`、`commit`

`pi/smol` などのロールエイリアスは `settings.modelRoles` を通じて展開されます。各ロール値には、`:minimal`、`:low`、`:medium`、`:high` などのシンキングセレクターを追加することもできます。

ロールが別のロールを指している場合、ターゲットモデルは通常通り継承され、参照するロールの明示的なサフィックスがそのロール固有の使用に勝ちます。

関連する設定:

- `modelRoles`（レコード）
- `enabledModels`（スコープ付きパターンリスト）
- `modelProviderOrder`（グローバルな標準プロバイダー優先度）
- `providers.kimiApiFormat`（`openai` または `anthropic` リクエスト形式）
- `providers.openaiWebsockets`（OpenAI Codex トランスポートの `auto|off|on` WebSocket 設定）

`modelRoles` には以下のどちらかを格納できます:

- 具体的なプロバイダーバリアントを固定する `provider/modelId`
- プロバイダーのまとめを許可する `gpt-5.3-codex` などの標準 id

`enabledModels` と CLI の `--models` の場合:

- 正確な標準 id はその標準グループ内のすべての具体的なバリアントに展開されます
- 明示的な `provider/modelId` エントリーは正確なまま維持されます
- グロブとファジーマッチングは具体的なモデルに対して引き続き機能します

## `/model` と `--list-models`

両方のサーフェスでプロバイダープレフィックス付きモデルが表示可能で選択可能な状態を維持します。

また、標準/まとめられたモデルも公開されるようになりました:

- `/model` はプロバイダータブの横に標準ビューを含みます
- `--list-models` は標準セクションと具体的なプロバイダー行を印刷します

標準エントリーを選択すると標準セレクターが保存されます。プロバイダー行を選択すると明示的な `provider/modelId` が保存されます。

## コンテキストプロモーション（モデルレベルのフォールバックチェーン）

コンテキストプロモーションは、API がコンテキスト長エラーでリクエストを拒否した場合に、より大きなコンテキストの兄弟モデルに自動的に昇格する、小さなコンテキストバリアント（例: `*-spark`）のオーバーフロー回復メカニズムです。

### トリガーと順序

コンテキストオーバーフローエラー（例: `context_length_exceeded`）でターンが失敗した場合、`AgentSession` はコンパクションにフォールバックする**前に**プロモーションを試みます:

1. `contextPromotion.enabled` が true の場合、プロモーションターゲットを解決します（以下を参照）。
2. ターゲットが見つかった場合、それに切り替えてリクエストを再試行します — コンパクションは不要です。
3. ターゲットが利用できない場合、現在のモデルで自動コンパクションにフォールスルーします。

### ターゲット選択

選択はロール駆動ではなくモデル駆動です:

1. `currentModel.contextPromotionTarget`（設定されている場合）
2. 同じプロバイダー + API 上の最小の大きなコンテキストモデル

認証情報が解決しない場合（`ModelRegistry.getApiKey(...)`）、候補は無視されます。

### OpenAI Codex WebSocket ハンドオフ

`openai-codex-responses` との間で切り替える場合、セッションプロバイダーの状態キー `openai-codex-responses` がモデル切り替え前に閉じられます。これにより WebSocket トランスポートの状態がドロップされ、次のターンがプロモートされたモデルでクリーンな状態で開始されます。

### 永続性の動作

プロモーションは一時的な切り替えを使用します（`setModelTemporary`）:

- セッション履歴に一時的な `model_change` として記録されます
- 保存されたロールマッピングは書き換えられません

### 明示的なフォールバックチェーンの設定

`contextPromotionTarget` を通じてモデルメタデータに直接フォールバックを設定します。

`contextPromotionTarget` には以下のどちらかを指定できます:

- `provider/model-id`（明示的）
- `model-id`（現在のプロバイダー内で解決）

Spark -> 同じプロバイダーの非 Spark への例（`models.yml`）:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

組み込みモデルジェネレーターも、同じプロバイダーのベースモデルが存在する場合、`*-spark` モデルに対して自動的にこれを割り当てます。

## 互換性とルーティングフィールド

`models.yml` は以下の `compat` サブセットをサポートしています:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField`（`max_completion_tokens` または `max_tokens`）
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

これらは OpenAI 完了トランスポートロジックによって消費され、URL ベースの自動検出と組み合わされます。

## 実践的な例

### ローカルの OpenAI 互換エンドポイント（認証なし）

```yaml
providers:
  local-openai:
    baseUrl: http://127.0.0.1:8000/v1
    auth: none
    api: openai-completions
    models:
      - id: Qwen/Qwen2.5-Coder-32B-Instruct
        name: Qwen 2.5 Coder 32B (local)
```

### 環境変数ベースのキーを持つホステッドプロキシ

```yaml
providers:
  anthropic-proxy:
    baseUrl: https://proxy.example.com/anthropic
    apiKey: ANTHROPIC_PROXY_API_KEY
    api: anthropic-messages
    authHeader: true
    models:
      - id: claude-sonnet-4-20250514
        name: Claude Sonnet 4 (Proxy)
        reasoning: true
        input: [text, image]
```

### 組み込みプロバイダールート + モデルメタデータのオーバーライド

```yaml
providers:
  openrouter:
    baseUrl: https://my-proxy.example.com/v1
    headers:
      X-Team: platform
    modelOverrides:
      anthropic/claude-sonnet-4:
        name: Sonnet 4 (Corp)
        compat:
          openRouterRouting:
            only: [anthropic]
```

## LiteLLM プロキシの自動設定

`LITELLM_BASE_URL` と `LITELLM_API_KEY` の両方の環境変数が設定されている場合、xcsh は LiteLLM プロキシの `models.yml` 設定を自動的に管理します。

### 初回実行時の自動生成

`models.yml` が存在せず、LiteLLM 環境変数が検出された場合、xcsh は自動的に生成します:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

デフォルトの `config.yml` も適切なイメージプロバイダー設定で生成されます。

### 起動時の自己修復

起動ごとに、モデルレジストリの `startupHealthCheck()` が以下のチェックを実行します:

| 条件 | アクション |
|-----------|--------|
| `models.yml` が存在しない | 環境変数から自動生成 |
| `models.yml` が破損または解析不能 | `.bak` にバックアップし、再生成 |
| `baseUrl` が `LITELLM_BASE_URL` と一致しない | `.bak` にバックアップし、新しい URL で再生成 |
| `configVersion` が欠落または古い | `.bak` にバックアップし、現在のバージョンで再生成 |
| 設定が正常 | アクションなし |

すべての修復は上書き前に `.bak` バックアップを作成します。すべての操作は冪等です。

### CLI コマンド

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### 必須環境変数

| 変数 | 目的 |
|----------|---------|
| `LITELLM_BASE_URL` | LiteLLM プロキシ URL（例: `https://your-proxy.example.com`）。`http://` または `https://` で始まる必要があります。 |
| `LITELLM_API_KEY` | プロキシの API キー。生成された設定では名前で参照され、実行時に解決されます。 |

いずれかの変数が設定されていない場合、自動設定は静かにスキップされます。

### 設定バージョン管理

生成された設定には `configVersion` フィールドが含まれます。将来のリリースで生成形式が変更された場合、xcsh は古い設定を検出し、自動的にアップグレードします（バックアップあり）。

## レガシーコンシューマーの注意事項

ほとんどのモデル設定は、`ModelRegistry` を通じて `models.yml` を経由するようになりました。

注目すべきレガシーパスが1つ残っています: Web 検索の Anthropic 認証解決は、`src/web/search/auth.ts` で `~/.xcsh/agent/models.json` を直接読み取ります。

この特定のパスに依存している場合は、そのモジュールが移行されるまで JSON 互換性を念頭に置いてください。

## 失敗モード

`models.yml` がスキーマまたは検証チェックに失敗した場合:

- `LITELLM_BASE_URL` と `LITELLM_API_KEY` が設定されている場合、起動時ヘルスチェックが自動修復を試みます（破損したファイルをバックアップし、環境変数から再生成）。修復が成功した場合、レジストリは修正された設定を再読み込みします。
- 自動修復が不可能な場合（環境変数が未設定、書き込み失敗）、レジストリは組み込みモデルで動作し続けます。
- エラーは `ModelRegistry.getError()` を通じて公開され、UI/通知に表示されます。
