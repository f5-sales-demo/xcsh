---
title: モデルとプロバイダーの設定
description: models.ymlによるモデルレジストリとプロバイダー設定（ルーティング、フォールバック、料金設定を含む）。
sidebar:
  order: 1
  label: モデルとプロバイダー
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# モデルとプロバイダーの設定 (`models.yml`)

このドキュメントでは、coding-agentがモデルを読み込み、オーバーライドを適用し、認証情報を解決し、実行時にモデルを選択する仕組みについて説明します。

## モデルの動作を制御するもの

主要な実装ファイル：

- `src/config/model-registry.ts` — 組み込み＋カスタムモデルの読み込み、プロバイダーオーバーライド、ランタイムディスカバリー、認証統合
- `src/config/model-resolver.ts` — モデルパターンの解析とinitial/smol/slowモデルの選択
- `src/config/settings-schema.ts` — モデル関連の設定（`modelRoles`、プロバイダートランスポート設定）
- `src/session/auth-storage.ts` — APIキー＋OAuth解決順序
- `packages/ai/src/models.ts` および `packages/ai/src/types.ts` — 組み込みプロバイダー/モデルと`Model`/`compat`型

## 設定ファイルの場所とレガシー動作

デフォルトの設定パス：

- `~/.xcsh/agent/models.yml`

現在も残っているレガシー動作：

- `models.yml`が存在せず、同じ場所に`models.json`が存在する場合、`models.yml`にマイグレーションされます。
- `.json` / `.jsonc`の明示的な設定パスは、プログラム的に`ModelRegistry`に渡された場合、引き続きサポートされます。

## `models.yml`の構造

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

`configVersion`は自動設定システムによって書き込まれるオプションの整数です。存在する場合、xcshはこれを使用して古い設定を検出し、自動アップグレードします。

`provider-id`は選択および認証ルックアップ全体で使用される正規のプロバイダーキーです。

`equivalence`はオプションで、具体的なプロバイダーモデルの上に正規モデルグループを設定します：

- `overrides`は正確な具体セレクター（`provider/modelId`）を公式の上流正規IDにマッピングします
- `exclude`は具体セレクターを正規グループから除外します

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

### 許可されるプロバイダー/モデルの`api`値

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### 許可されるauth/discovery値

- `auth`: `apiKey`（デフォルト）または `none`
- `discovery.type`: `ollama`

## バリデーションルール（現行）

### 完全なカスタムプロバイダー（`models`が空でない場合）

必須：

- `baseUrl`
- `auth: none`でない限り`apiKey`
- プロバイダーレベルまたは各モデルに`api`

### オーバーライドのみのプロバイダー（`models`が未定義または空の場合）

以下のうち少なくとも1つを定義する必要があります：

- `baseUrl`
- `modelOverrides`
- `discovery`

### ディスカバリー

- `discovery`にはプロバイダーレベルの`api`が必要です。

### モデル値のチェック

- `id`は必須
- `contextWindow`と`maxTokens`は指定する場合、正の数でなければなりません

## マージとオーバーライドの順序

ModelRegistryパイプライン（リフレッシュ時）：

1. `@f5xc-salesdemos/pi-ai`から組み込みプロバイダー/モデルを読み込む。
2. `models.yml`のカスタム設定を読み込む。
3. プロバイダーオーバーライド（`baseUrl`、`headers`）を組み込みモデルに適用する。
4. `modelOverrides`（プロバイダー＋モデルID単位）を適用する。
5. カスタム`models`をマージする：
   - 同じ`provider + id`は既存のものを置き換え
   - それ以外は追加
6. ランタイムで検出されたモデル（現在はOllamaとLM Studio）を適用し、モデルオーバーライドを再適用する。

## 正規モデルの等価性と統合

レジストリはすべての具体的なプロバイダーモデルを保持し、その上に正規レイヤーを構築します。

正規IDは公式の上流IDのみです。例：

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### `models.yml`のequivalence設定

例：

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

正規グループの構築順序：

1. `equivalence.overrides`からの正確なユーザーオーバーライド
2. 組み込みモデルメタデータからのバンドルされた公式IDマッチ
3. ゲートウェイ/プロバイダーバリアントに対する保守的なヒューリスティック正規化
4. 具体モデル自身のIDへのフォールバック

現在のヒューリスティックは意図的に狭く設定されています：

- 埋め込まれた上流プレフィックスは存在する場合に除去できます。例：`anthropic/...`や`openai/...`
- ドットとダッシュのバージョンバリアントは、既存の公式IDにマッピングされる場合のみ正規化できます。例：`4.6 -> 4-6`
- あいまいなファミリーやバージョンは、バンドルされたマッチまたは明示的なオーバーライドなしにはマージされません

### 正規解決の動作

複数の具体バリアントが正規IDを共有する場合、解決には以下が使用されます：

1. 可用性と認証
2. `config.yml`の`modelProviderOrder`
3. `modelProviderOrder`が未設定の場合、既存のレジストリ/プロバイダー順序

無効または未認証のプロバイダーはスキップされます。

セッション状態とトランスクリプトは、実際にターンを実行した具体的なプロバイダー/モデルを引き続き記録します。

プロバイダーのデフォルト vs モデルごとのオーバーライド：

- プロバイダーの`headers`がベースラインです。
- モデルの`headers`はプロバイダーのヘッダーキーをオーバーライドします。
- `modelOverrides`はモデルのメタデータをオーバーライドできます（`name`、`reasoning`、`input`、`cost`、`contextWindow`、`maxTokens`、`headers`、`compat`、`contextPromotionTarget`）。
- `compat`はネストされたルーティングブロック（`openRouterRouting`、`vercelGatewayRouting`、`extraBody`）についてディープマージされます。

## ランタイムディスカバリー統合

### 暗黙的なOllamaディスカバリー

`ollama`が明示的に設定されていない場合、レジストリは暗黙的な検出可能プロバイダーを追加します：

- プロバイダー: `ollama`
- API: `openai-completions`
- ベースURL: `OLLAMA_BASE_URL`または`http://127.0.0.1:11434`
- 認証モード: キーレス（`auth: none`の動作）

ランタイムディスカバリーはOllamaに対して`GET /api/tags`を呼び出し、ローカルデフォルトでモデルエントリを合成します。

### 暗黙的なllama.cppディスカバリー

`llama.cpp`が明示的に設定されていない場合、レジストリは暗黙的な検出可能プロバイダーを追加します：
注意：openai-completionsの代わりに、より新しいanthropic messages APIを使用しています。

- プロバイダー: `llama.cpp`
- API: `openai-responses`
- ベースURL: `LLAMA_CPP_BASE_URL`または`http://127.0.0.1:8080`
- 認証モード: キーレス（`auth: none`の動作）

ランタイムディスカバリーはllama.cppに対して`GET models`を呼び出し、ローカルデフォルトでモデルエントリを合成します。

### 暗黙的なLM Studioディスカバリー

`lm-studio`が明示的に設定されていない場合、レジストリは暗黙的な検出可能プロバイダーを追加します：

- プロバイダー: `lm-studio`
- API: `openai-completions`
- ベースURL: `LM_STUDIO_BASE_URL`または`http://127.0.0.1:1234/v1`
- 認証モード: キーレス（`auth: none`の動作）

ランタイムディスカバリーはモデル一覧を取得し（`GET /models`）、ローカルデフォルトでモデルエントリを合成します。

### 明示的なプロバイダーディスカバリー

ディスカバリーを自分で設定することもできます：

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

### 拡張機能によるプロバイダー登録

拡張機能はランタイムでプロバイダーを登録できます（`pi.registerProvider(...)`）：

- プロバイダーへのモデルの置換/追加
- 新しいAPI IDに対するカスタムストリームハンドラーの登録
- カスタムOAuthプロバイダーの登録

## 認証とAPIキーの解決順序

プロバイダーのキーを要求する際の有効な順序：

1. ランタイムオーバーライド（CLI `--api-key`）
2. `agent.db`に保存されたAPIキー認証情報
3. `agent.db`に保存されたOAuth認証情報（リフレッシュあり）
4. 環境変数マッピング（`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`など）
5. ModelRegistryフォールバックリゾルバー（`models.yml`のプロバイダー`apiKey`、環境変数名またはリテラルのセマンティクス）

`models.yml`の`apiKey`の動作：

- 値はまず環境変数名として扱われます。
- 環境変数が存在しない場合、リテラル文字列がトークンとして使用されます。

`authHeader: true`でプロバイダーの`apiKey`が設定されている場合、モデルには以下が適用されます：

- `Authorization: Bearer <resolved-key>`ヘッダーが注入されます。

キーレスプロバイダー：

- `auth: none`とマークされたプロバイダーは、認証情報なしで利用可能として扱われます。
- `getApiKey*`はこれらに対して`kNoAuth`を返します。

## モデルの可用性 vs 全モデル

- `getAll()`は読み込まれたモデルレジストリ（組み込み＋マージされたカスタム＋検出済み）を返します。
- `getAvailable()`はキーレスまたは解決可能な認証を持つモデルにフィルタリングします。

したがって、モデルはレジストリに存在していても、認証が利用可能になるまで選択できない場合があります。

## ランタイムモデル解決

### CLIとパターン解析

`model-resolver.ts`は以下をサポートします：

- 正確な`provider/modelId`
- 正確な正規モデルID
- 正確なモデルID（プロバイダーは推論）
- ファジー/部分文字列マッチング
- `--models`でのグロブスコープパターン（例：`openai/*`、`*sonnet*`）
- オプションの`:thinkingLevel`サフィックス（`off|minimal|low|medium|high|xhigh`）

`--provider`はレガシーです。`--model`が推奨されます。

正確なセレクターの解決優先順位：

1. 正確な`provider/modelId`は統合をバイパスします
2. 正確な正規IDは正規インデックスを通じて解決されます
3. 正確なベアの具体IDも引き続き機能します
4. ファジーおよびグロブマッチングは正確なパスの後に実行されます

### 初期モデル選択の優先順位

`findInitialModel(...)`は以下の順序を使用します：

1. 明示的なCLIプロバイダー+モデル
2. 最初のスコープモデル（再開でない場合）
3. 保存されたデフォルトプロバイダー/モデル
4. 利用可能なモデルの中からの既知のプロバイダーデフォルト（例：OpenAI/Anthropicなど）
5. 最初の利用可能なモデル

### ロールエイリアスと設定

サポートされるモデルロール：

- `default`、`smol`、`slow`、`plan`、`commit`

`pi/smol`のようなロールエイリアスは`settings.modelRoles`を通じて展開されます。各ロール値には`:minimal`、`:low`、`:medium`、`:high`などのthinkingセレクターを追加することもできます。

ロールが別のロールを指す場合、ターゲットモデルは通常通り継承され、参照ロールの明示的なサフィックスがそのロール固有の使用で優先されます。

関連する設定：

- `modelRoles`（レコード）
- `enabledModels`（スコープパターンリスト）
- `modelProviderOrder`（グローバルな正規プロバイダー優先順位）
- `providers.kimiApiFormat`（`openai`または`anthropic`リクエストフォーマット）
- `providers.openaiWebsockets`（OpenAI Codexトランスポートのwebsocket設定 `auto|off|on`）

`modelRoles`には以下のいずれかを格納できます：

- 具体的なプロバイダーバリアントを固定する`provider/modelId`
- プロバイダー統合を可能にする`gpt-5.3-codex`などの正規ID

`enabledModels`およびCLI `--models`の場合：

- 正確な正規IDは、その正規グループ内のすべての具体バリアントに展開されます
- 明示的な`provider/modelId`エントリはそのまま維持されます
- グロブとファジーマッチングは引き続き具体モデルに対して動作します

## `/model`と`--list-models`

両方のインターフェースはプロバイダープレフィックス付きモデルを表示・選択可能に保ちます。

また、正規/統合モデルも公開するようになりました：

- `/model`はプロバイダータブと並んで正規ビューを含みます
- `--list-models`は正規セクションと具体的なプロバイダー行を出力します

正規エントリを選択すると正規セレクターが保存されます。プロバイダー行を選択すると明示的な`provider/modelId`が保存されます。

## コンテキストプロモーション（モデルレベルのフォールバックチェーン）

コンテキストプロモーションは、小さなコンテキストバリアント（例：`*-spark`）のためのオーバーフローリカバリーメカニズムで、APIがコンテキスト長エラーでリクエストを拒否した場合に、自動的に大きなコンテキストの兄弟モデルにプロモートします。

### トリガーと順序

ターンがコンテキストオーバーフローエラー（例：`context_length_exceeded`）で失敗した場合、`AgentSession`はコンパクションへのフォールバック**前に**プロモーションを試みます：

1. `contextPromotion.enabled`がtrueの場合、プロモーションターゲットを解決します（以下参照）。
2. ターゲットが見つかった場合、それに切り替えてリクエストを再試行します — コンパクションは不要です。
3. ターゲットが利用できない場合、現在のモデルでの自動コンパクションにフォールスルーします。

### ターゲット選択

選択はロール駆動ではなく、モデル駆動です：

1. `currentModel.contextPromotionTarget`（設定されている場合）
2. 同じプロバイダー＋APIで最小のより大きなコンテキストモデル

認証情報が解決できない（`ModelRegistry.getApiKey(...)`）候補は無視されます。

### OpenAI Codex websocketハンドオフ

`openai-codex-responses`から/への切り替え時、セッションプロバイダーステートキー`openai-codex-responses`はモデル切り替え前にクローズされます。これにより、websocketトランスポート状態が破棄され、次のターンはプロモートされたモデルでクリーンに開始されます。

### 永続化の動作

プロモーションは一時的な切り替え（`setModelTemporary`）を使用します：

- セッション履歴に一時的な`model_change`として記録されます
- 保存されたロールマッピングは書き換えません

### 明示的なフォールバックチェーンの設定

`contextPromotionTarget`を介してモデルメタデータでフォールバックを直接設定します。

`contextPromotionTarget`は以下のいずれかを受け付けます：

- `provider/model-id`（明示的）
- `model-id`（現在のプロバイダー内で解決）

同じプロバイダーでSpark -> 非Sparkへの`models.yml`の例：

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

組み込みのモデルジェネレーターは、同じプロバイダーのベースモデルが存在する場合、`*-spark`モデルに対してこれを自動的に割り当てます。

## 互換性とルーティングフィールド

`models.yml`は以下の`compat`サブセットをサポートします：

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField`（`max_completion_tokens`または`max_tokens`）
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

これらはOpenAI-completionsトランスポートロジックによって消費され、URLベースの自動検出と組み合わされます。

## 実践的な例

### ローカルのOpenAI互換エンドポイント（認証なし）

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

### 環境変数ベースのキーを使用するホスティングプロキシ

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

### 組み込みプロバイダーのルート＋モデルメタデータのオーバーライド

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

## LiteLLMプロキシの自動設定

`LITELLM_BASE_URL`と`LITELLM_API_KEY`の両方の環境変数が設定されている場合、xcshはLiteLLMプロキシの`models.yml`設定を自動的に管理します。

### 初回実行時の自動生成

`models.yml`が存在せず、LiteLLM環境変数が検出された場合、xcshは自動的に生成します：

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

適切な画像プロバイダー設定を含むデフォルトの`config.yml`も生成されます。

### 起動時の自己修復

毎回の起動時に、モデルレジストリの`startupHealthCheck()`が以下のチェックを実行します：

| 条件 | アクション |
|------|----------|
| `models.yml`が存在しない | 環境変数から自動生成 |
| `models.yml`が破損またはパース不能 | `.bak`にバックアップし、再生成 |
| `baseUrl`が`LITELLM_BASE_URL`と一致しない | `.bak`にバックアップし、新しいURLで再生成 |
| `configVersion`が存在しないまたは古い | `.bak`にバックアップし、現在のバージョンで再生成 |
| 設定が正常 | アクションなし |

すべての修復は上書き前に`.bak`バックアップを作成します。すべての操作は冪等です。

### CLIコマンド

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### 必須の環境変数

| 変数 | 目的 |
|------|------|
| `LITELLM_BASE_URL` | LiteLLMプロキシURL（例：`https://your-proxy.example.com`）。`http://`または`https://`で始まる必要があります。 |
| `LITELLM_API_KEY` | プロキシ用APIキー。生成された設定では名前で参照され、ランタイムで解決されます。 |

いずれかの変数が未設定の場合、自動設定はサイレントにスキップされます。

### 設定のバージョニング

生成された設定には`configVersion`フィールドが含まれます。将来のリリースで生成フォーマットが変更された場合、xcshは古い設定を検出し、自動的にアップグレードします（バックアップ付き）。

## レガシーコンシューマーに関する注意

ほとんどのモデル設定は現在`ModelRegistry`経由で`models.yml`を通じて流れます。

注目すべきレガシーパスが1つ残っています：Web検索のAnthropic認証解決は、`src/web/search/auth.ts`で`~/.xcsh/agent/models.json`を直接読み取ります。

その特定のパスに依存している場合は、そのモジュールがマイグレーションされるまでJSON互換性を念頭に置いてください。

## 障害モード

`models.yml`がスキーマまたはバリデーションチェックに失敗した場合：

- `LITELLM_BASE_URL`と`LITELLM_API_KEY`が設定されている場合、起動時のヘルスチェックが自動修復を試みます（破損ファイルをバックアップし、環境変数から再生成）。修復が成功すると、レジストリは修正された設定を再読み込みします。
- 自動修復が不可能な場合（環境変数が未設定、書き込み失敗）、レジストリは組み込みモデルで動作を継続します。
- エラーは`ModelRegistry.getError()`経由で公開され、UI/通知に表示されます。
