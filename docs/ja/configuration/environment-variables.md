---
title: 環境変数
description: xcsh の設定と動作制御のためのランタイム環境変数リファレンス。
sidebar:
  order: 2
  label: 環境変数
i18n:
  sourceHash: e2890f963c02
  translator: machine
---

# 環境変数（現在のランタイムリファレンス）

このリファレンスは、以下の現在のコードパスから導出されています：

- `packages/coding-agent/src/**`
- `packages/ai/src/**`（coding-agent が使用するプロバイダー/認証解決）
- `packages/utils/src/**` および `packages/tui/src/**`（これらの変数が coding-agent のランタイムに直接影響する場合）

アクティブな動作のみを文書化しています。

## 解決モデルと優先順位

ほとんどのランタイムルックアップは、`@f5-sales-demo/pi-utils`（`packages/utils/src/env.ts`）の `$env` を使用します。

`$env` の読み込み順序：

1. 既存のプロセス環境（`Bun.env`）
2. プロジェクトの `.env`（`$PWD/.env`）- まだ設定されていないキーのみ
3. ホームの `.env`（`~/.env`）- まだ設定されていないキーのみ

`.env` ファイルの追加ルール：解析時に `XCSH_*` キーは `PI_*` キーにミラーリングされます。

---

## 1) モデル/プロバイダー認証

特に記載がない限り、`getEnvApiKey()`（`packages/ai/src/stream.ts`）を介して使用されます。

### コアプロバイダー資格情報

| 変数                        | 用途 | 必要な場合                                                 | 備考 / 優先順位                                                                                  |
|---------------------------------|---|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `ANTHROPIC_OAUTH_TOKEN`         | Anthropic API 認証 | OAuth トークン認証で Anthropic を使用する場合                         | プロバイダー認証解決において `ANTHROPIC_API_KEY` より優先                              |
| `ANTHROPIC_API_KEY`             | Anthropic API 認証 | OAuth トークンなしで Anthropic を使用する場合                           | `ANTHROPIC_OAUTH_TOKEN` の後のフォールバック                                                              |
| `ANTHROPIC_FOUNDRY_API_KEY`     | Azure Foundry / エンタープライズゲートウェイ経由の Anthropic | `CLAUDE_CODE_USE_FOUNDRY` が有効な場合                             | Foundry モード有効時は `ANTHROPIC_OAUTH_TOKEN` および `ANTHROPIC_API_KEY` より優先  |
| `OPENAI_API_KEY`                | OpenAI 認証 | 明示的な apiKey 引数なしで OpenAI ファミリープロバイダーを使用する場合 | OpenAI Completions/Responses プロバイダーで使用                                                      |
| `GEMINI_API_KEY`                | Google Gemini 認証 | `google` プロバイダーモデルを使用する場合                                | Gemini プロバイダーマッピングの主キー                                                             |
| `GOOGLE_API_KEY`                | Gemini 画像ツール認証フォールバック | `GEMINI_API_KEY` なしで `gemini_image` ツールを使用する場合            | coding-agent 画像ツールのフォールバックパスで使用                                                       |
| `GROQ_API_KEY`                  | Groq 認証 | Groq モデルを使用する場合                                             |                                                                                                     |
| `CEREBRAS_API_KEY`              | Cerebras 認証 | Cerebras モデルを使用する場合                                         |                                                                                                     |
| `TOGETHER_API_KEY`              | Together 認証 | `together` プロバイダーを使用する場合                                     |                                                                                                     |
| `HUGGINGFACE_HUB_TOKEN`         | Hugging Face 認証 | `huggingface` プロバイダーを使用する場合                                  | Hugging Face の主要トークン環境変数                                                                  |
| `HF_TOKEN`                      | Hugging Face 認証 | `huggingface` プロバイダーを使用する場合                                  | `HUGGINGFACE_HUB_TOKEN` が未設定の場合のフォールバック                                                      |
| `SYNTHETIC_API_KEY`             | Synthetic 認証 | Synthetic モデルを使用する場合                                        |                                                                                                     |
| `NVIDIA_API_KEY`                | NVIDIA 認証 | `nvidia` プロバイダーを使用する場合                                       |                                                                                                     |
| `NANO_GPT_API_KEY`              | NanoGPT 認証 | `nanogpt` プロバイダーを使用する場合                                      |                                                                                                     |
| `VENICE_API_KEY`                | Venice 認証 | `venice` プロバイダーを使用する場合                                       |                                                                                                     |
| `LITELLM_API_KEY`               | LiteLLM 認証 | `litellm` プロバイダーを使用する場合                                      | OpenAI 互換 LiteLLM プロキシキー。`LITELLM_BASE_URL` と併用すると `models.yml` の自動設定が有効になります |
| `LM_STUDIO_API_KEY`             | LM Studio 認証（オプション） | 認証付きホストで `lm-studio` プロバイダーを使用する場合           | ローカルの LM Studio は通常認証なしで動作します。キーが必要な場合は空でない任意のトークンが機能します         |
| `OLLAMA_API_KEY`                | Ollama 認証（オプション） | 認証付きホストで `ollama` プロバイダーを使用する場合              | ローカルの Ollama は通常認証なしで動作します。キーが必要な場合は空でない任意のトークンが機能します            |
| `LLAMA_CPP_API_KEY`             | Ollama 認証（オプション） | `--api-key` パラメータ付きで `llama-server` を使用する場合              | ローカルの llama.cpp は通常認証なしで動作します。キーが設定されている場合は空でない任意のトークンが機能します       |
| `XIAOMI_API_KEY`                | Xiaomi MiMo 認証 | `xiaomi` プロバイダーを使用する場合                                       |                                                                                                     |
| `MOONSHOT_API_KEY`              | Moonshot 認証 | `moonshot` プロバイダーを使用する場合                                     |                                                                                                     |
| `XAI_API_KEY`                   | xAI 認証 | xAI モデルを使用する場合                                              |                                                                                                     |
| `OPENROUTER_API_KEY`            | OpenRouter 認証 | OpenRouter モデルを使用する場合                                       | 優先/自動プロバイダーが OpenRouter の場合、画像ツールでも使用                                  |
| `MISTRAL_API_KEY`               | Mistral 認証 | Mistral モデルを使用する場合                                          |                                                                                                     |
| `ZAI_API_KEY`                   | z.ai 認証 | z.ai モデルを使用する場合                                             | z.ai ウェブ検索プロバイダーでも使用                                                               |
| `MINIMAX_API_KEY`               | MiniMax 認証 | `minimax` プロバイダーを使用する場合                                      |                                                                                                     |
| `MINIMAX_CODE_API_KEY`          | MiniMax Code 認証 | `minimax-code` プロバイダーを使用する場合                                 |                                                                                                     |
| `MINIMAX_CODE_CN_API_KEY`       | MiniMax Code CN 認証 | `minimax-code-cn` プロバイダーを使用する場合                              |                                                                                                     |
| `OPENCODE_API_KEY`              | OpenCode 認証 | OpenCode モデルを使用する場合                                         |                                                                                                     |
| `QIANFAN_API_KEY`               | Qianfan 認証 | `qianfan` プロバイダーを使用する場合                                      |                                                                                                     |
| `QWEN_OAUTH_TOKEN`              | Qwen Portal 認証 | OAuth トークンで `qwen-portal` を使用する場合                          | `QWEN_PORTAL_API_KEY` より優先                                                         |
| `QWEN_PORTAL_API_KEY`           | Qwen Portal 認証 | API キーで `qwen-portal` を使用する場合                              | `QWEN_OAUTH_TOKEN` の後のフォールバック                                                                   |
| `ZENMUX_API_KEY`                | ZenMux 認証 | `zenmux` プロバイダーを使用する場合                                       | ZenMux の OpenAI および Anthropic 互換ルートに使用                                              |
| `VLLM_API_KEY`                  | vLLM 認証/検出オプトイン | `vllm` プロバイダー（ローカル OpenAI 互換サーバー）を使用する場合       | 認証なしのローカルサーバーでは空でない任意の値が機能します                                                 |
| `CURSOR_ACCESS_TOKEN`           | Cursor プロバイダー認証 | Cursor プロバイダーを使用する場合                                         |                                                                                                     |
| `AI_GATEWAY_API_KEY`            | Vercel AI Gateway 認証 | `vercel-ai-gateway` プロバイダーを使用する場合                            |                                                                                                     |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | Cloudflare AI Gateway 認証 | `cloudflare-ai-gateway` プロバイダーを使用する場合                        | ベース URL は `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` として設定する必要があります |

### GitHub/Copilot トークンチェーン

| 変数 | 用途 | チェーン |
|---|---|---|
| `COPILOT_GITHUB_TOKEN` | GitHub Copilot プロバイダー認証 | `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` |
| `GH_TOKEN` | Copilot フォールバック; ウェブスクレイパーでの GitHub API 認証 | ウェブスクレイパー内: `GITHUB_TOKEN` → `GH_TOKEN` |
| `GITHUB_TOKEN` | Copilot フォールバック; ウェブスクレイパーでの GitHub API 認証 | ウェブスクレイパー内: `GH_TOKEN` より先にチェック |

---

## 2) プロバイダー固有のランタイム設定

### Anthropic Foundry Gateway（Azure / エンタープライズプロキシ）

`CLAUDE_CODE_USE_FOUNDRY` が有効な場合、Anthropic リクエストは Foundry モードに切り替わります：

- ベース URL は `FOUNDRY_BASE_URL` から解決されます（未設定の場合はモデル/デフォルトのベース URL がフォールバックとして残ります）。
- プロバイダー `anthropic` の API キー解決は以下の順になります：
  `ANTHROPIC_FOUNDRY_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`。
- `ANTHROPIC_CUSTOM_HEADERS` はカンマ/改行区切りの `key: value` ペアとして解析され、リクエストヘッダーにマージされます。
- TLS クライアント/サーバーマテリアルは環境変数値から注入できます：
  `NODE_EXTRA_CA_CERTS`、`CLAUDE_CODE_CLIENT_CERT`、`CLAUDE_CODE_CLIENT_KEY`。
  それぞれ以下のいずれかを受け入れます：
  - PEM コンテンツへのファイルシステムパス、または
  - インライン PEM（エスケープされた `\n` シーケンスを含む）。

| 変数 | 値の型 | 動作 |
|---|---|---|
| `CLAUDE_CODE_USE_FOUNDRY` | ブーリアン風の文字列（`1`、`true`、`yes`、`on`） | Anthropic プロバイダーの Foundry モードを有効にする |
| `FOUNDRY_BASE_URL` | URL 文字列 | Foundry モードでの Anthropic エンドポイントベース URL |
| `ANTHROPIC_FOUNDRY_API_KEY` | トークン文字列 | `Authorization: Bearer <token>` に使用 |
| `ANTHROPIC_CUSTOM_HEADERS` | ヘッダーリスト文字列 | 追加ヘッダー; 形式は `header-a: value, header-b: value` または改行区切り |
| `NODE_EXTRA_CA_CERTS` | PEM パスまたはインライン PEM | サーバー証明書検証用の追加 CA チェーン |
| `CLAUDE_CODE_CLIENT_CERT` | PEM パスまたはインライン PEM | mTLS クライアント証明書 |
| `CLAUDE_CODE_CLIENT_KEY` | PEM パスまたはインライン PEM | mTLS クライアント秘密鍵（証明書とペアにする必要があります） |

### Amazon Bedrock

| 変数 | デフォルト / 動作 |
|---|---|
| `AWS_REGION` | プライマリリージョンソース |
| `AWS_DEFAULT_REGION` | `AWS_REGION` が未設定の場合のフォールバック |
| `AWS_PROFILE` | 名前付きプロファイル認証パスを有効にする |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | IAM キー認証パスを有効にする |
| `AWS_BEARER_TOKEN_BEDROCK` | ベアラートークン認証パスを有効にする |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `AWS_CONTAINER_CREDENTIALS_FULL_URI` | ECS タスク資格情報パスを有効にする |
| `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` | ウェブアイデンティティ認証パスを有効にする |
| `AWS_BEDROCK_SKIP_AUTH` | `1` の場合、ダミー資格情報を注入（プロキシ/非認証シナリオ） |
| `AWS_BEDROCK_FORCE_HTTP1` | `1` の場合、Node HTTP/1 リクエストハンドラーを強制 |

プロバイダーコードでのリージョンフォールバック: `options.region` → `AWS_REGION` → `AWS_DEFAULT_REGION` → `us-east-1`。

### Azure OpenAI Responses

| 変数 | デフォルト / 動作 |
|---|---|
| `AZURE_OPENAI_API_KEY` | オプションとして API キーが渡されない限り必須 |
| `AZURE_OPENAI_API_VERSION` | デフォルト `v1` |
| `AZURE_OPENAI_BASE_URL` | 直接ベース URL オーバーライド |
| `AZURE_OPENAI_RESOURCE_NAME` | ベース URL の構築に使用: `https://<resource>.openai.azure.com/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | オプションのマッピング文字列: `modelId=deploymentName,model2=deployment2` |

ベース URL の解決: オプション `azureBaseUrl` → 環境変数 `AZURE_OPENAI_BASE_URL` → オプション/環境変数のリソース名 → `model.baseUrl`。

### Google Vertex AI

| 変数 | 必須? | 備考 |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | はい（オプションで渡されない場合） | フォールバック: `GCLOUD_PROJECT` |
| `GCLOUD_PROJECT` | フォールバック | 代替プロジェクト ID ソースとして使用 |
| `GOOGLE_CLOUD_LOCATION` | はい（オプションで渡されない場合） | プロバイダーにデフォルトなし |
| `GOOGLE_APPLICATION_CREDENTIALS` | 条件付き | 設定されている場合、ファイルが存在する必要があります。それ以外の場合は ADC フォールバックパスがチェックされます（`~/.config/gcloud/application_default_credentials.json`） |

### Kimi

| 変数 | デフォルト / 動作 |
|---|---|
| `KIMI_CODE_OAUTH_HOST` | プライマリ OAuth ホストオーバーライド |
| `KIMI_OAUTH_HOST` | フォールバック OAuth ホストオーバーライド |
| `KIMI_CODE_BASE_URL` | Kimi 使用エンドポイントベース URL をオーバーライド（`usage/kimi.ts`） |

OAuth ホストチェーン: `KIMI_CODE_OAUTH_HOST` → `KIMI_OAUTH_HOST` → `https://auth.kimi.com`。

### Antigravity/Gemini 画像互換性

| 変数 | デフォルト / 動作 |
|---|---|
| `PI_AI_ANTIGRAVITY_VERSION` | Gemini CLI プロバイダーの Antigravity ユーザーエージェントバージョンタグをオーバーライド |

### OpenAI Codex responses（機能/デバッグ制御）

| 変数 | 動作 |
|---|---|
| `PI_CODEX_DEBUG` | `1`/`true` で Codex プロバイダーのデバッグログを有効にする |
| `PI_CODEX_WEBSOCKET` | `1`/`true` で WebSocket トランスポート優先を有効にする |
| `PI_CODEX_WEBSOCKET_V2` | `1`/`true` で WebSocket v2 パスを有効にする |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | 正の整数オーバーライド（デフォルト 300000） |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | 非負の整数オーバーライド（デフォルト 5） |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | 正の整数ベースバックオフオーバーライド（デフォルト 500） |

### Cursor プロバイダーデバッグ

| 変数 | 動作 |
|---|---|
| `DEBUG_CURSOR` | プロバイダーデバッグログを有効にする; `2`/`verbose` で詳細なペイロードスニペット表示 |
| `DEBUG_CURSOR_LOG` | JSONL デバッグログ出力のオプションファイルパス |

### プロンプトキャッシュ互換性スイッチ

| 変数 | 動作 |
|---|---|
| `PI_CACHE_RETENTION` | `long` の場合、サポートされている場所で長期保持を有効にする（`anthropic`、`openai-responses`、Bedrock 保持解決） |

---

## 3) ウェブ検索サブシステム

### 検索プロバイダー資格情報

| 変数 | 使用元 |
|---|---|
| `EXA_API_KEY` | Exa 検索プロバイダーおよび Exa MCP ツール |
| `BRAVE_API_KEY` | Brave 検索プロバイダー |
| `PERPLEXITY_API_KEY` | Perplexity 検索プロバイダー API キーモード |
| `TAVILY_API_KEY` | Tavily 検索プロバイダー |
| `ZAI_API_KEY` | z.ai 検索プロバイダー（`agent.db` の保存済み OAuth もチェック） |
| `OPENAI_API_KEY` / DB 内の Codex OAuth | Codex 検索プロバイダーの利用可能性/認証 |

### Anthropic ウェブ検索認証チェーン

`packages/coding-agent/src/web/search/auth.ts` は、以下の順序で Anthropic ウェブ検索資格情報を解決します：

1. `ANTHROPIC_SEARCH_API_KEY`（+ オプションの `ANTHROPIC_SEARCH_BASE_URL`）
2. `api: "anthropic-messages"` を持つ `models.json` プロバイダーエントリ
3. `agent.db` からの Anthropic OAuth 資格情報（5 分のバッファ内に期限切れしない必要があります）
4. 汎用 Anthropic 環境変数フォールバック: プロバイダーキー（`ANTHROPIC_FOUNDRY_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`）+ オプションの `ANTHROPIC_BASE_URL`（Foundry モード有効時は `FOUNDRY_BASE_URL`）

関連変数：

| 変数 | デフォルト / 動作 |
|---|---|
| `ANTHROPIC_SEARCH_API_KEY` | 最優先の明示的検索キー |
| `ANTHROPIC_SEARCH_BASE_URL` | 省略時は `https://api.anthropic.com` がデフォルト |
| `ANTHROPIC_SEARCH_MODEL` | デフォルトは `claude-haiku-4-5` |
| `ANTHROPIC_BASE_URL` | ティア 4 認証パスの汎用フォールバックベース URL |

### Perplexity OAuth フロー動作フラグ

| 変数 | 動作 |
|---|---|
| `PI_AUTH_NO_BORROW` | 設定されている場合、Perplexity ログインフローでの macOS ネイティブアプリトークン借用パスを無効にする |

---

## 4) Python ツーリングとカーネルランタイム

| 変数 | デフォルト / 動作 |
|---|---|
| `PI_PY` | Python ツールモードオーバーライド: `0`/`bash`=`bash-only`、`1`/`py`=`ipy-only`、`mix`/`both`=`both`; 無効な値は無視 |
| `PI_PYTHON_SKIP_CHECK` | `1` の場合、Python カーネル可用性チェック/ウォームチェックをスキップ |
| `PI_PYTHON_GATEWAY_URL` | 設定されている場合、ローカル共有ゲートウェイの代わりに外部カーネルゲートウェイを使用 |
| `PI_PYTHON_GATEWAY_TOKEN` | 外部ゲートウェイ用のオプション認証トークン（`Authorization: token <value>`） |
| `PI_PYTHON_IPC_TRACE` | `1` の場合、カーネルモジュールの低レベル IPC トレースパスを有効にする |
| `VIRTUAL_ENV` | Python ランタイム解決用の最優先 venv パス |

追加の条件付き動作：

- `BUN_ENV=test` または `NODE_ENV=test` の場合、Python 可用性チェックは OK として扱われ、ウォーミングはスキップされます。
- Python 環境フィルタリングは一般的な API キーを拒否し、安全な基本変数 + `LC_`、`XDG_`、`PI_` プレフィックスを許可します。

---

## 5) エージェント/ランタイム動作トグル

| 変数                   | デフォルト / 動作                                                                           |
|----------------------------|----------------------------------------------------------------------------------------------|
| `PI_SMOL_MODEL`            | `smol` の一時的なモデルロールオーバーライド（CLI `--smol` が優先）                     |
| `PI_SLOW_MODEL`            | `slow` の一時的なモデルロールオーバーライド（CLI `--slow` が優先）                     |
| `PI_PLAN_MODEL`            | `plan` の一時的なモデルロールオーバーライド（CLI `--plan` が優先）                     |
| `PI_NO_TITLE`              | 設定されている場合（空でない任意の値）、最初のユーザーメッセージでの自動セッションタイトル生成を無効にする   |
| `NULL_PROMPT`              | `true` の場合、システムプロンプトビルダーが空文字列を返す                                        |
| `PI_BLOCKED_AGENT`         | タスクツールで特定のサブエージェントタイプをブロック                                                 |
| `PI_SUBPROCESS_CMD`        | サブエージェントスポーンコマンドをオーバーライド（`xcsh` / `xcsh.cmd` 解決バイパス）                       |
| `PI_TASK_MAX_OUTPUT_BYTES` | サブエージェントあたりの最大キャプチャ出力バイト数（デフォルト `500000`）                                    |
| `PI_TASK_MAX_OUTPUT_LINES` | サブエージェントあたりの最大キャプチャ出力行数（デフォルト `5000`）                                      |
| `PI_TIMING`                | `1` の場合、起動/ツールタイミング計測ログを有効にする                                     |
| `PI_DEBUG_STARTUP`         | 複数の起動パスで stderr への起動ステージデバッグ出力を有効にする                       |
| `PI_PACKAGE_DIR`           | パッケージアセットベースディレクトリの解決をオーバーライド（docs/examples/changelog パスルックアップ）            |
| `PI_DISABLE_LSPMUX`        | `1` の場合、lspmux 検出/統合を無効にし、直接 LSP サーバースポーンを強制          |
| `LITELLM_BASE_URL`         | LiteLLM プロキシベース URL。`LITELLM_API_KEY` と併用すると、初回実行時に `models.yml` の自動生成をトリガーし、起動ごとに自己修復を行う |
| `LM_STUDIO_BASE_URL`       | デフォルトの暗黙的 LM Studio 検出ベース URL オーバーライド（未設定の場合は `http://127.0.0.1:1234/v1`） |
| `OLLAMA_BASE_URL`          | デフォルトの暗黙的 Ollama 検出ベース URL オーバーライド（未設定の場合は `http://127.0.0.1:11434`）      |
| `LLAMA_CPP_BASE_URL`       | デフォルトの暗黙的 Llama.cpp 検出ベース URL オーバーライド（未設定の場合は `http://127.0.0.1:8080`）    |
| `PI_EDIT_VARIANT`          | `hashline` の場合、編集ツールが利用可能な場合にハッシュライン読み取り/grep 表示モードを強制               |
| `PI_NO_PTY`                | `1` の場合、bash ツールのインタラクティブ PTY パスを無効にする                                          |

`PI_NO_PTY` は CLI `--no-pty` が使用された場合にも内部的に設定されます。

---

## 6) ストレージと設定ルートパス

これらは `@f5-sales-demo/pi-utils/dirs` を介して使用され、coding-agent がデータを保存する場所に影響します。

| 変数 | デフォルト / 動作 |
|---|---|
| `PI_CONFIG_DIR` | ホームディレクトリ下の設定ルートディレクトリ名（デフォルト `.xcsh`） |
| `PI_CODING_AGENT_DIR` | エージェントディレクトリの完全オーバーライド（デフォルト `~/<PI_CONFIG_DIR or .xcsh>/agent`） |
| `PWD` | パスヘルパーでの正規カレントワーキングディレクトリのマッチングに使用 |

---

## 7) シェル/ツール実行環境

（`packages/utils/src/procmgr.ts` および coding-agent bash ツール統合より。）

| 変数 | 動作 |
|---|---|
| `PI_BASH_NO_CI` | スポーンされたシェル環境への自動 `CI=true` 注入を抑制 |
| `CLAUDE_BASH_NO_CI` | `PI_BASH_NO_CI` のレガシーエイリアスフォールバック |
| `PI_BASH_NO_LOGIN` | ログインシェルモードを無効にすることを意図 |
| `CLAUDE_BASH_NO_LOGIN` | `PI_BASH_NO_LOGIN` のレガシーエイリアスフォールバック |
| `PI_SHELL_PREFIX` | オプションのコマンドプレフィックスラッパー |
| `CLAUDE_CODE_SHELL_PREFIX` | `PI_SHELL_PREFIX` のレガシーエイリアスフォールバック |
| `VISUAL` | 優先外部エディターコマンド |
| `EDITOR` | フォールバック外部エディターコマンド |

現在の実装に関する注記: `PI_BASH_NO_LOGIN`/`CLAUDE_BASH_NO_LOGIN` は読み取られますが、現在の `getShellArgs()` は両方のブランチで `['-l','-c']` を返します（実質的に現在は no-op）。

---

## 8) UI/テーマ/セッション検出（自動検出される環境変数）

これらはランタイムシグナルとして読み取られます。通常、手動設定ではなくターミナル/OS によって設定されます。

| 変数 | 用途 |
|---|---|
| `COLORTERM`, `TERM`, `WT_SESSION` | カラー機能検出（テーマカラーモード） |
| `COLORFGBG` | ターミナル背景のライト/ダーク自動検出 |
| `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERMINAL_EMULATOR` | システムプロンプト/コンテキストでのターミナルアイデンティティ |
| `KDE_FULL_SESSION`, `XDG_CURRENT_DESKTOP`, `DESKTOP_SESSION`, `XDG_SESSION_DESKTOP`, `GDMSESSION`, `WINDOWMANAGER` | システムプロンプト/コンテキストでのデスクトップ/ウィンドウマネージャー検出 |
| `KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION` | ターミナルごとの安定したセッションブレッドクラム ID |
| `SHELL`, `ComSpec`, `TERM_PROGRAM`, `TERM` | システム情報診断 |
| `APPDATA`, `XDG_CONFIG_HOME` | lspmux 設定パス解決 |
| `HOME` | MCP コマンド UI でのパス短縮 |

---

## 9) ネイティブローダー/デバッグフラグ

| 変数 | 動作 |
|---|---|
| `PI_DEV` | `packages/natives` での詳細なネイティブアドオンロード診断を有効にする |

## 10) TUI ランタイムフラグ（共有パッケージ、coding-agent の UX に影響）

| 変数 | 動作 |
|---|---|
| `PI_NOTIFICATIONS` | `off` / `0` / `false` でデスクトップ通知を抑制 |
| `PI_TUI_WRITE_LOG` | 設定されている場合、TUI 書き込みをファイルにログ記録 |
| `PI_HARDWARE_CURSOR` | `1` の場合、ハードウェアカーソルモードを有効にする |
| `PI_CLEAR_ON_SHRINK` | `1` の場合、コンテンツが縮小した際に空の行をクリア |
| `PI_DEBUG_REDRAW` | `1` の場合、再描画デバッグログを有効にする |
| `PI_TUI_DEBUG` | `1` の場合、詳細な TUI デバッグダンプパスを有効にする |

---

## 11) コミット生成制御

| 変数 | 動作 |
|---|---|
| `PI_COMMIT_TEST_FALLBACK` | `true`（大文字小文字不問）の場合、コミットフォールバック生成パスを強制 |
| `PI_COMMIT_NO_FALLBACK` | `true` の場合、エージェントが提案を返さなかった場合のフォールバックを無効にする |
| `PI_COMMIT_MAP_REDUCE` | `false` の場合、マップリデュースコミット分析パスを無効にする |
| `DEBUG` | 設定されている場合、コミットエージェントのエラースタックトレースが出力される |

---

## セキュリティに敏感な変数

これらはシークレットとして扱ってください。ログに記録したりコミットしたりしないでください：

- プロバイダー/API キーおよび OAuth/ベアラー資格情報（すべての `*_API_KEY`、`*_TOKEN`、OAuth アクセス/リフレッシュトークン）
- クラウド資格情報（`AWS_*`、`GOOGLE_APPLICATION_CREDENTIALS` パスはサービスアカウントマテリアルを露出する可能性があります）
- 検索/プロバイダー認証変数（`EXA_API_KEY`、`BRAVE_API_KEY`、`PERPLEXITY_API_KEY`、Anthropic 検索キー）
- Foundry mTLS マテリアル（`CLAUDE_CODE_CLIENT_CERT`、`CLAUDE_CODE_CLIENT_KEY`、プライベート CA バンドルを指す場合の `NODE_EXTRA_CA_CERTS`）

Python ランタイムも、カーネルサブプロセスをスポーンする前に多くの一般的なキー変数を明示的にストリップします（`packages/coding-agent/src/ipy/runtime.ts`）。
