---
title: モデルおよびプロバイダーの設定
description: ルーティング、フォールバック、および価格設定を備えた models.yml によるモデルレジストリおよびプロバイダーの設定。
sidebar:
  order: 1
  label: モデルとプロバイダー
i18n:
  sourceHash: "8053df967ff6"
  translator: "machine"
---

# モデルおよびプロバイダーの設定 (`models.yml`)

このドキュメントでは、コーディングエージェントが現在どのようにモデルをロードし、オーバーライドを適用し、認証情報を解決し、実行時にモデルを選択するかについて説明します。

## モデルの動作を制御するもの

主要な実装ファイル：

- `src/config/model-registry.ts` — 組み込みおよびカスタムモデル、プロバイダーのオーバーライド、実行時の検出、認証統合のロード
- `src/config/model-resolver.ts` — モデルパターンの解析と initial/smol/slow モデルの選択
- `src/config/settings-schema.ts` — モデル関連の設定 (`modelRoles`、プロバイダートランスポートの優先設定)
- `src/session/auth-storage.ts` — API キーと OAuth の解決順序
- `packages/ai/src/models.ts` および `packages/ai/src/types.ts` — 組み込みプロバイダー/モデルおよび `Model`/`compat` 型

## 設定ファイルの場所とレガシーな動作

デフォルトの設定パス：

- `~/.xcsh/agent/models.yml`

現在も存在するレガシーな動作：

- `models.yml` が見つからず、同じ場所に `models.json` が存在する場合、それは `models.yml` に移行されます。
- `ModelRegistry` にプログラムで渡される場合、明示的な `.json` / `.jsonc` 設定パスは引き続きサポートされます。

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

`provider-id` は、選択および認証の検索全体で使用される正規のプロバイダーキーです。

`equivalence` はオプションであり、具体的なプロバイダーモデルの上で正規のモデルグループ化を設定します。

- `overrides` は、正確な具体的なセレクター (`provider/modelId`) を公式のアップストリーム正規 ID にマッピングします
- `exclude` は、正規のグループ化から具体的なセレクターを除外します

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

### 許可される provider/model `api` の値

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### 許可される auth/discovery の値

- `auth`: `apiKey` (デフォルト) または `none`
- `discovery.type`: `ollama`

## バリデーションルール (現在)

### 完全なカスタムプロバイダー (`models` が空でない)

必須：

- `baseUrl`
- `auth: none` でない限り `apiKey`
- プロバイダーレベルまたは各モデルでの `api`

### オーバーライドのみのプロバイダー (`models` がないか空)

少なくとも以下のいずれかを定義する必要があります：

- `baseUrl`
- `modelOverrides`
- `discovery`

### ディスカバリー

- `discovery` はプロバイダーレベルの `api` を必要とします。

### モデル値のチェック

- `id` が必須
- `contextWindow` と `maxTokens` が提供される場合、正の数である必要があります

## マージおよびオーバーライドの順序

ModelRegistry のパイプライン (リフレッシュ時)：

1. `@f5-sales-demo/pi-ai` から組み込みのプロバイダー/モデルをロードします。
2. `models.yml` カスタム設定をロードします。
3. 組み込みモデルにプロバイダーのオーバーライド (`baseUrl`、`headers`) を適用します。
4. `modelOverrides` (プロバイダー + モデル ID ごと) を適用します。
5. カスタム `models` をマージします：
   - 同じ `provider + id` は既存のものを置き換えます
   - それ以外の場合は追加します
6. 実行時に検出されたモデル (現在は Ollama と LM Studio) を適用し、モデルのオーバーライドを再適用します。

## 正規モデルの等価性と結合

レジストリはすべての具体的なプロバイダーモデルを保持し、その上に正規のレイヤーを構築します。

正規の ID は、次のような公式のアップストリーム ID のみです：

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### `models.yml` の等価性設定

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

正規のグループ化のための構築順序：

1. `equivalence.overrides` からの正確なユーザーオーバーライド
2. 組み込みモデルメタデータからのバンドルされた公式 ID の一致
3. ゲートウェイ/プロバイダーのバリアントに対する保守的なヒューリスティックな正規化
4. 具体的なモデル自身の ID へのフォールバック

現在のヒューリスティックは意図的に狭く設定されています：

- 埋め込まれたアップストリームのプレフィックスが存在する場合は削除できます (例：`anthropic/...` や `openai/...`)
- ドットおよびダッシュのバージョンバリアントは、既存の公式 ID にマッピングされる場合にのみ正規化できます (例：`4.6 -> 4-6`)
- あいまいなファミリやバージョンは、バンドルされた一致または明示的なオーバーライドがない限りマージされません

### 正規の解決の動作

複数の具体的なバリアントが正規 ID を共有する場合、解決には以下が使用されます：

1. 可用性と認証
2. `config.yml` の `modelProviderOrder`
3. `modelProviderOrder` が設定されていない場合は、既存のレジストリ/プロバイダーの順序

無効化されている、または認証されていないプロバイダーはスキップされます。

セッションの状態とトランスクリプトには、実際にターンを実行した具体的なプロバイダー/モデルが引き続き記録されます。

プロバイダーのデフォルトとモデルごとのオーバーライド：

- プロバイダーの `headers` がベースラインです。
- モデルの `headers` はプロバイダーのヘッダーキーをオーバーライドします。
- `modelOverrides` はモデルのメタデータ (`name`、`reasoning`、`input`、`cost`、`contextWindow`、`maxTokens`、`headers`、`compat`、`contextPromotionTarget`) をオーバーライドできます。
- ネストされたルーティングブロック (`openRouterRouting`、`vercelGatewayRouting`、`extraBody`) の場合、`compat` はディープマージされます。

## 実行時の検出の統合

### 暗黙の Ollama 検出

`ollama` が明示的に設定されていない場合、レジストリは暗黙の検出可能なプロバイダーを追加します：

- プロバイダー: `ollama`
- API: `openai-completions`
- ベース URL: `OLLAMA_BASE_URL` または `http://127.0.0.1:11434`
- 認証モード: キーなし (`auth: none` の動作)

実行時の検出では、Ollama に対して `GET /api/tags` を呼び出し、ローカルのデフォルトを使用してモデルエントリを合成します。

### 暗黙の llama.cpp 検出

`llama.cpp` が明示的に設定されていない場合、レジストリは暗黙の検出可能なプロバイダーを追加します：
注：これは、openai-completions の代わりに新しい antropic messages api を使用しています。

- プロバイダー: `llama.cpp`
- API: `openai-responses`
- ベース URL: `LLAMA_CPP_BASE_URL` または `http://127.0.0.1:8080`
- 認証モード: キーなし (`auth: none` の動作)

実行時の検出では、llama.cpp に対して `GET models` を呼び出し、ローカルのデフォルトを使用してモデルエントリを合成します。

### 暗黙の LM Studio 検出

`lm-studio` が明示的に設定されていない場合、レジストリは暗黙の検出可能なプロバイダーを追加します：

- プロバイダー: `lm-studio`
- API: `openai-completions`
- ベース URL: `LM_STUDIO_BASE_URL` または `http://127.0.0.1:1234/v1`
- 認証モード: キーなし (`auth: none` の動作)

実行時の検出では、モデルを取得し (`GET /models`)、ローカルのデフォルトを使用してモデルエントリを合成します。

### 明示的なプロバイダーの検出

検出を自分で設定することができます：

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

### 拡張機能プロバイダーの登録

拡張機能は、実行時にプロバイダーを登録できます (`pi.registerProvider(...)`)。これには以下が含まれます：

- プロバイダーに対するモデルの置き換え/追加
- 新しい API ID に対するカスタムストリームハンドラの登録
- カスタム OAuth プロバイダーの登録

## 認証と API キーの解決順序

プロバイダーのキーを要求する場合、有効な順序は次のとおりです：

1. 実行時のオーバーライド (CLI `--api-key`)
2. `agent.db` に保存されている API キー認証情報
3. `agent.db` に保存されている OAuth 認証情報 (更新あり)
4. 環境変数のマッピング (`OPENAI_API_KEY`、`ANTHROPIC_API_KEY` など)
5. ModelRegistry のフォールバックリゾルバー (`models.yml` からのプロバイダー `apiKey`、環境変数名またはリテラルのセマンティクス)

`models.yml` の `apiKey` の動作：

- 値は最初に環境変数名として扱われます。
- 環境変数が存在しない場合、リテラル文字列がトークンとして使用されます。

`authHeader: true` でプロバイダーの `apiKey` が設定されている場合、モデルは以下を取得します：

- `Authorization: Bearer <resolved-key>` ヘッダーが挿入されます。

キーなしのプロバイダー：

- `auth: none` とマークされたプロバイダーは、認証情報なしで利用可能として扱われます。
- それらに対して `getApiKey*` は `kNoAuth` を返します。

## モデルの可用性とすべてのモデル

- `getAll()` は、ロードされたモデルレジストリ (組み込み + マージされたカスタム + 検出されたもの) を返します。
- `getAvailable()` は、キーなしのモデル、または解決可能な認証を持つモデルにフィルタリングします。

そのため、モデルはレジストリに存在する可能性がありますが、認証が利用可能になるまで選択できない場合があります。

## 実行時のモデル解決

### CLI とパターンの解析

`model-resolver.ts` は以下をサポートします：

- 正確な `provider/modelId`
- 正確な正規モデル ID
- 正確なモデル ID (プロバイダー推論)
- ファジー/部分文字列のマッチング
- `--models` のグロブスコープパターン (例: `openai/*`、`*sonnet*`)
- オプションの `:thinkingLevel` 接尾辞 (`off|minimal|low|medium|high|xhigh`)

`--provider` はレガシーです。`--model` が推奨されます。

正確なセレクターの解決の優先順位：

1. 正確な `provider/modelId` は結合をバイパスします
2. 正確な正規 ID は正規のインデックスを通じて解決されます
3. 正確な具体的な ID のみでも機能します
4. 正確なパスの後にファジーおよびグロブのマッチングが実行されます

### 初期モデル選択の優先順位

`findInitialModel(...)` は次の順序を使用します：

1. 明示的な CLI プロバイダー+モデル
2. 最初のスコープ付きモデル (再開していない場合)
3. 保存されたデフォルトのプロバイダー/モデル
4. 利用可能なモデルの間の既知のプロバイダーのデフォルト (例: OpenAI/Anthropic など)
5. 最初に利用可能なモデル

### ロールのエイリアスと設定

サポートされているモデルのロール：

- `default`、`smol`、`slow`、`plan`、`commit`

`pi/smol` のようなロールエイリアスは `settings.modelRoles` を通じて展開されます。各ロールの値は、`:minimal`、`:low`、`:medium`、`:high` などの思考セレクターを追加することもできます。

ロールが別のロールを指している場合、ターゲットモデルは通常どおりに継承され、そのロール固有の用途には、参照するロールの明示的な接尾辞が優先されます。

関連する設定：

- `modelRoles` (レコード)
- `enabledModels` (スコープ付きパターンリスト)
- `modelProviderOrder` (グローバルな正規プロバイダーの優先順位)
- `providers.kimiApiFormat` (`openai` または `anthropic` のリクエストフォーマット)
- `providers.openaiWebsockets` (OpenAI Codex トランスポートの `auto|off|on` websocket の優先設定)

`modelRoles` には次のいずれかを保存できます：

- 具体的なプロバイダーバリアントを固定するための `provider/modelId`
- プロバイダーの結合を許可するための `gpt-5.3-codex` のような正規 ID

`enabledModels` と CLI `--models` の場合：

- 正確な正規 ID は、その正規グループ内のすべての具体的なバリアントに展開されます
- 明示的な `provider/modelId` エントリは正確なままです
- グロブとファジーマッチは引き続き具体的なモデルで動作します

## `/model` と `--list-models`

どちらのサーフェスも、プロバイダーのプレフィックスが付いたモデルを表示し、選択可能な状態に保ちます。

これらは現在、正規/結合されたモデルも公開しています：

- `/model` には、プロバイダーのタブと並んで正規のビューが含まれます
- `--list-models` は、正規のセクションに加えて具体的なプロバイダーの行を出力します

正規のエントリを選択すると、正規のセレクターが保存されます。プロバイダーの行を選択すると、明示的な `provider/modelId` が保存されます。

## コンテキストの昇格 (モデルレベルのフォールバックチェーン)

コンテキストの昇格は、API がコンテキスト長のエラーでリクエストを拒否したときに、同じプロバイダー上のより大きなコンテキストを持つ兄弟モデルに自動的に昇格する、小さなコンテキストバリアント (たとえば `*-spark`) のためのオーバーフローリカバリメカニズムです。

### トリガーと順序

コンテキストのオーバーフローエラー (例: `context_length_exceeded`) でターンが失敗した場合、`AgentSession` はコンパクションにフォールバックする**前**に昇格を試みます：

1. `contextPromotion.enabled` が true の場合、昇格のターゲットを解決します (以下を参照)。
2. ターゲットが見つかった場合はそれに切り替えてリクエストを再試行します — コンパクションは不要です。
3. 利用可能なターゲットがない場合は、現在のモデルでの自動コンパクションにフォールスルーします。

### ターゲットの選択

選択はロール駆動ではなく、モデル駆動です：

1. `currentModel.contextPromotionTarget` (設定されている場合)
2. 同じプロバイダー + API 上でより大きなコンテキストを持つ最小のモデル

認証情報が解決しない限り、候補は無視されます (`ModelRegistry.getApiKey(...)`)。

### OpenAI Codex websocket のハンドオフ

`openai-codex-responses` から/へ切り替える場合、モデルを切り替える前にセッションプロバイダーの状態キー `openai-codex-responses` が閉じられます。これにより websocket トランスポートの状態が破棄されるため、次のターンは昇格されたモデルでクリーンに開始されます。

### 永続化の動作

昇格は一時的な切り替えを使用します (`setModelTemporary`)：

- セッション履歴に一時的な `model_change` として記録されます
- 保存されたロールのマッピングは書き換えられません

### 明示的なフォールバックチェーンの設定

`contextPromotionTarget` を介して、モデルメタデータに直接フォールバックを設定します。

`contextPromotionTarget` は次のいずれかを受け入れます：

- `provider/model-id` (明示的)
- `model-id` (現在のプロバイダー内で解決)

同じプロバイダー上の Spark から非 Spark への例 (`models.yml`)：

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

組み込みのモデルジェネレーターも、同じプロバイダーのベースモデルが存在する場合、`*-spark` モデルにこれを自動的に割り当てます。

## 互換性とルーティングのフィールド

`models.yml` は次の `compat` のサブセットをサポートします：

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` または `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

これらは OpenAI-completions トランスポートロジックによって消費され、URL ベースの自動検出と組み合わされます。

## 実用的な例

### ローカルの OpenAI 互換エンドポイント (認証なし)

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

### 環境変数ベースのキーを使用するホスト型プロキシ

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

### 組み込みプロバイダーのルートとモデルメタデータのオーバーライド

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

`models.yml` が存在せず、LiteLLM の環境変数が検出された場合、xcsh は自動的にそれを生成します：

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

適切な画像プロバイダー設定を持つデフォルトの `config.yml` も生成されます。

### 起動時の自己修復

すべての起動時に、モデルレジストリの `startupHealthCheck()` によって次のチェックが実行されます：

| 条件 | アクション |
|-----------|--------|
| `models.yml` が見つからない | 環境変数から自動生成する |
| `models.yml` が破損しているか解析できない | `.bak` にバックアップし、再生成する |
| `baseUrl` が `LITELLM_BASE_URL` と一致しない | `.bak` にバックアップし、新しい URL で再生成する |
| `configVersion` が見つからないか古い | `.bak` にバックアップし、現在のバージョンで再生成する |
| 設定は正常である | アクションなし |

すべての修復操作は、上書きする前に `.bak` バックアップを作成します。すべての操作はべき等です。

### CLI コマンド

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### 必須の環境変数

| 変数 | 目的 |
|----------|---------|
| `LITELLM_BASE_URL` | LiteLLM プロキシ URL (例: `https://your-proxy.example.com`)。`http://` または `https://` で始まる必要があります。 |
| `LITELLM_API_KEY` | プロキシ用の API キー。生成された設定で名前によって参照され、実行時に解決されます。 |

どちらかの変数が設定されていない場合、自動設定は暗黙のうちにスキップされます。

### 設定のバージョニング

生成された設定には `configVersion` フィールドが含まれます。将来のリリースで生成フォーマットが変更された場合、xcsh は古い設定を検出し、自動的にアップグレードします (バックアップあり)。

## レガシーコンシューマーの注意事項

ほとんどのモデル設定は、現在 `ModelRegistry` を介して `models.yml` を経由します。

注目すべきレガシーパスが1つ残っています：Web 検索の Anthropic 認証解決は、現在も `src/web/search/auth.ts` 内で直接 `~/.xcsh/agent/models.json` を読み取ります。

その特定のパスに依存している場合は、そのモジュールが移行されるまで JSON の互換性に留意してください。

## 障害モード

`models.yml` がスキーマまたはバリデーションチェックに失敗した場合：

- `LITELLM_BASE_URL` と `LITELLM_API_KEY` が設定されている場合、起動時のヘルスチェックは自動修復 (破損したファイルのバックアップ、環境変数からの再生成) を試みます。修復が成功した場合、レジストリは修正された設定をリロードします。
- 自動修復が不可能な場合 (環境変数が設定されていない、書き込み失敗など)、レジストリは組み込みモデルで動作を続行します。
- エラーは `ModelRegistry.getError()` 経由で公開され、UI/通知に表示されます。
