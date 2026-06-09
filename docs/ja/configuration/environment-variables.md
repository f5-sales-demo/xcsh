---
title: 環境変数
description: xcshの設定と動作制御のためのランタイム環境変数リファレンス。
sidebar:
  order: 2
  label: 環境変数
i18n:
  sourceHash: 7baa9f5226ba
  translator: machine
---

# 環境変数（現行ランタイムリファレンス）

このリファレンスは、以下の現行コードパスから導出されています：

- `packages/coding-agent/src/**`
- `packages/ai/src/**`（coding-agentで使用されるプロバイダー/認証解決）
- `packages/utils/src/**` および `packages/tui/src/**`（これらの変数がcoding-agentランタイムに直接影響する箇所）

アクティブな動作のみを文書化しています。

## 解決モデルと優先順位

ほとんどのランタイムルックアップは、`@f5xc-salesdemos/pi-utils`（`packages/utils/src/env.ts`）の `$env` を使用します。

`$env` の読み込み順序：

1. 既存のプロセス環境（`Bun.env`）
2. プロジェクト `.env`（`$PWD/.env`）- まだ設定されていないキーのみ
3. ホーム `.env`（`~/.env`）- まだ設定されていないキーのみ

`.env` ファイルの追加ルール：パース時に `XCSH_*` キーは `PI_*` キーにミラーリングされます。

---

## 1) モデル/プロバイダー認証

特に記載がない限り、これらは `getEnvApiKey()`（`packages/ai/src/stream.ts`）経由で消費されます。

### コアプロバイダー資格情報

| 変数                        | 用途 | 必要な場合                                                 | 備考 / 優先順位                                                                                  |
|---------------------------------|---|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `ANTHROPIC_OAUTH_TOKEN`         | Anthropic API認証 | OAuthトークン認証でAnthropicを使用する場合                         | プロバイダー認証解決で `ANTHROPIC_API_KEY` より優先                              |
| `ANTHROPIC_API_KEY`             | Anthropic API認証 | OAuthトークンなしでAnthropicを使用する場合                           | `ANTHROPIC_OAUTH_TOKEN` の後のフォールバック                                                              |
| `ANTHROPIC_FOUNDRY_API_KEY`     | Azure Foundry / エンタープライズゲートウェイ経由のAnthropic | `CLAUDE_CODE_USE_FOUNDRY` が有効な場合                             | Foundryモード有効時に `ANTHROPIC_OAUTH_TOKEN` および `ANTHROPIC_API_KEY` より優先  |
| `OPENAI_API_KEY`                | OpenAI認証 | 明示的なapiKey引数なしでOpenAIファミリープロバイダーを使用する場合 | OpenAI Completions/Responsesプロバイダーで使用                                                      |
| `GEMINI_API_KEY`                | Google Gemini認証 | `google` プロバイダーモデルを使用する場合                                | Geminiプロバイダーマッピングのプライマリキー                                                             |
| `GOOGLE_API_KEY`                | Gemini画像ツール認証フォールバック | `GEMINI_API_KEY` なしで `gemini_image` ツールを使用する場合            | coding-agent画像ツールのフォールバックパスで使用                                                       |
| `GROQ_API_KEY`                  | Groq認証 | Groqモデルを使用する場合                                             |                                                                                                     |
| `CEREBRAS_API_KEY`              | Cerebras認証 | Cerebrasモデルを使用する場合                                         |                                                                                                     |
| `TOGETHER_API_KEY`              | Together認証 | `together` プロバイダーを使用する場合                                     |                                                                                                     |
| `HUGGINGFACE_HUB_TOKEN`         | Hugging Face認証 | `huggingface` プロバイダーを使用する場合                                  | プライマリHugging Faceトークン環境変数                                                                  |
| `HF_TOKEN`                      | Hugging Face認証 | `huggingface` プロバイダーを使用する場合                                  | `HUGGINGFACE_HUB_TOKEN` が未設定時のフォールバック                                                      |
| `SYNTHETIC_API_KEY`             | Synthetic認証 | Syntheticモデルを使用する場合                                        |                                                                                                     |
| `NVIDIA_API_KEY`                | NVIDIA認証 | `nvidia` プロバイダーを使用する場合                                       |                                                                                                     |
| `NANO_GPT_API_KEY`              | NanoGPT認証 | `nanogpt` プロバイダーを使用する場合                                      |                                                                                                     |
| `VENICE_API_KEY`                | Venice認証 | `venice` プロバイダーを使用する場合                                       |                                                                                                     |
| `LITELLM_API_KEY`               | LiteLLM認証 | `litellm` プロバイダーを使用する場合                                      | OpenAI互換LiteLLMプロキシキー。`LITELLM_BASE_URL` と併せて設定すると、`models.yml` の自動設定が有効化 |
| `LM_STUDIO_API_KEY`             | LM Studio認証（オプション） | 認証付きホストで `lm-studio` プロバイダーを使用する場合           | ローカルLM Studioは通常認証なしで動作。キーが必要な場合は空でないトークンで可         |
| `OLLAMA_API_KEY`                | Ollama認証（オプション） | 認証付きホストで `ollama` プロバイダーを使用する場合              | ローカルOllamaは通常認証なしで動作。キーが必要な場合は空でないトークンで可            |
| `LLAMA_CPP_API_KEY`             | Ollama認証（オプション） | `--api-key` パラメータ付きで `llama-server` を使用する場合              | ローカルllama.cppは通常認証なしで動作。キーが設定されている場合は空でないトークンで可       |
| `XIAOMI_API_KEY`                | Xiaomi MiMo認証 | `xiaomi` プロバイダーを使用する場合                                       |                                                                                                     |
| `MOONSHOT_API_KEY`              | Moonshot認証 | `moonshot` プロバイダーを使用する場合                                     |                                                                                                     |
| `XAI_API_KEY`                   | xAI認証 | xAIモデルを使用する場合                                              |                                                                                                     |
| `OPENROUTER_API_KEY`            | OpenRouter認証 | OpenRouterモデルを使用する場合                                       | 優先/自動プロバイダーがOpenRouterの場合、画像ツールでも使用                                  |
| `MISTRAL_API_KEY`               | Mistral認証 | Mistralモデルを使用する場合                                          |                                                                                                     |
| `ZAI_API_KEY`                   | z.ai認証 | z.aiモデルを使用する場合                                             | z.aiウェブ検索プロバイダーでも使用                                                               |
| `MINIMAX_API_KEY`               | MiniMax認証 | `minimax` プロバイダーを使用する場合                                      |                                                                                                     |
| `MINIMAX_CODE_API_KEY`          | MiniMax Code認証 | `minimax-code` プロバイダーを使用する場合                                 |                                                                                                     |
| `MINIMAX_CODE_CN_API_KEY`       | MiniMax Code CN認証 | `minimax-code-cn` プロバイダーを使用する場合                              |                                                                                                     |
| `OPENCODE_API_KEY`              | OpenCode認証 | OpenCodeモデルを使用する場合                                         |                                                                                                     |
| `QIANFAN_API_KEY`               | Qianfan認証 | `qianfan` プロバイダーを使用する場合                                      |                                                                                                     |
| `QWEN_OAUTH_TOKEN`              | Qwen Portal認証 | OAuthトークンで `qwen-portal` を使用する場合                          | `QWEN_PORTAL_API_KEY` より優先                                                         |
| `QWEN_PORTAL_API_KEY`           | Qwen Portal認証 | APIキーで `qwen-portal` を使用する場合                              | `QWEN_OAUTH_TOKEN` の後のフォールバック                                                                   |
| `ZENMUX_API_KEY`                | ZenMux認証 | `zenmux` プロバイダーを使用する場合                                       | ZenMux OpenAIおよびAnthropic互換ルートで使用                                              |
| `VLLM_API_KEY`                  | vLLM認証/ディスカバリーオプトイン | `vllm` プロバイダー（ローカルOpenAI互換サーバー）を使用する場合       | 認証なしのローカルサーバーには空でない任意の値で可                                                 |
| `CURSOR_ACCESS_TOKEN`           | Cursorプロバイダー認証 | Cursorプロバイダーを使用する場合                                         |                                                                                                     |
| `AI_GATEWAY_API_KEY`            | Vercel AI Gateway認証 | `vercel-ai-gateway` プロバイダーを使用する場合                            |                                                                                                     |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | Cloudflare AI Gateway認証 | `cloudflare-ai-gateway` プロバイダーを使用する場合                        | ベースURLは `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` として設定する必要あり |

### GitHub/Copilotトークンチェーン

| 変数 | 用途 | チェーン |
|---|---|---|
| `COPILOT_GITHUB_TOKEN` | GitHub Copilotプロバイダー認証 | `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` |
| `GH_TOKEN` | Copilotフォールバック; Webスクレイパーでの GitHub API認証 | Webスクレイパー内: `GITHUB_TOKEN` → `GH_TOKEN` |
| `GITHUB_TOKEN` | Copilotフォールバック; WebスクレイパーでのGitHub API認証 | Webスクレイパー内: `GH_TOKEN` より先にチェック |

---

## 2) プロバイダー固有のランタイム設定

### Anthropic Foundryゲートウェイ（Azure / エンタープライズプロキシ）

`CLAUDE_CODE_USE_FOUNDRY` が有効な場合、AnthropicリクエストはFoundryモードに切り替わります：

- ベースURLは `FOUNDRY_BASE_URL` から解決されます（未設定の場合、モデル/デフォルトのベースURLがフォールバックとなります）。
- プロバイダー `anthropic` のAPIキー解決順序：
  `ANTHROPIC_FOUNDRY_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`。
- `ANTHROPIC_CUSTOM_HEADERS` はカンマ/改行区切りの `key: value` ペアとしてパースされ、リクエストヘッダーにマージされます。
- TLSクライアント/サーバー素材は環境変数値から注入可能：
  `NODE_EXTRA_CA_CERTS`、`CLAUDE_CODE_CLIENT_CERT`、`CLAUDE_CODE_CLIENT_KEY`。
  各変数は以下のいずれかを受け付けます：
  - PEMコンテンツへのファイルシステムパス、または
  - インラインPEM（エスケープされた `\n` シーケンスを含む）。

| 変数 | 値の型 | 動作 |
|---|---|---|
| `CLAUDE_CODE_USE_FOUNDRY` | ブーリアン風文字列（`1`、`true`、`yes`、`on`） | Anthropicプロバイダーに対してFoundryモードを有効化 |
| `FOUNDRY_BASE_URL` | URL文字列 | FoundryモードでのAnthropicエンドポイントベースURL |
| `ANTHROPIC_FOUNDRY_API_KEY` | トークン文字列 | `Authorization: Bearer <token>` に使用 |
| `ANTHROPIC_CUSTOM_HEADERS` | ヘッダーリスト文字列 | 追加ヘッダー; 形式 `header-a: value, header-b: value` または改行区切り |
| `NODE_EXTRA_CA_CERTS` | PEMパスまたはインラインPEM | サーバー証明書検証用の追加CA チェーン |
| `CLAUDE_CODE_CLIENT_CERT` | PEMパスまたはインラインPEM | mTLSクライアント証明書 |
| `CLAUDE_CODE_CLIENT_KEY` | PEMパスまたはインラインPEM | mTLSクライアント秘密鍵（証明書とペアで使用する必要あり） |

### Amazon Bedrock

| 変数 | デフォルト / 動作 |
|---|---|
| `AWS_REGION` | プライマリリージョンソース |
| `AWS_DEFAULT_REGION` | `AWS_REGION` 未設定時のフォールバック |
| `AWS_PROFILE` | 名前付きプロファイル認証パスを有効化 |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | IAMキー認証パスを有効化 |
| `AWS_BEARER_TOKEN_BEDROCK` | ベアラートークン認証パスを有効化 |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `AWS_CONTAINER_CREDENTIALS_FULL_URI` | ECSタスク資格情報パスを有効化 |
| `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` | Web Identity認証パスを有効化 |
| `AWS_BEDROCK_SKIP_AUTH` | `1` の場合、ダミー資格情報を注入（プロキシ/非認証シナリオ） |
| `AWS_BEDROCK_FORCE_HTTP1` | `1` の場合、Node HTTP/1リクエストハンドラーを強制 |

プロバイダーコード内のリージョンフォールバック：`options.region` → `AWS_REGION` → `AWS_DEFAULT_REGION` → `us-east-1`。

### Azure OpenAI Responses

| 変数 | デフォルト / 動作 |
|---|---|
| `AZURE_OPENAI_API_KEY` | オプションとしてAPIキーが渡されない限り必須 |
| `AZURE_OPENAI_API_VERSION` | デフォルト `v1` |
| `AZURE_OPENAI_BASE_URL` | 直接的なベースURLオーバーライド |
| `AZURE_OPENAI_RESOURCE_NAME` | ベースURL構築に使用: `https://<resource>.openai.azure.com/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | オプションのマッピング文字列: `modelId=deploymentName,model2=deployment2` |

ベースURL解決順序: オプション `azureBaseUrl` → 環境変数 `AZURE_OPENAI_BASE_URL` → オプション/環境変数のリソース名 → `model.baseUrl`。

### Google Vertex AI

| 変数 | 必須？ | 備考 |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | はい（オプションで渡されない限り） | フォールバック: `GCLOUD_PROJECT` |
| `GCLOUD_PROJECT` | フォールバック | 代替プロジェクトIDソースとして使用 |
| `GOOGLE_CLOUD_LOCATION` | はい（オプションで渡されない限り） | プロバイダーにデフォルト値なし |
| `GOOGLE_APPLICATION_CREDENTIALS` | 条件付き | 設定されている場合、ファイルが存在する必要あり。それ以外はADCフォールバックパスがチェック（`~/.config/gcloud/application_default_credentials.json`） |

### Kimi

| 変数 | デフォルト / 動作 |
|---|---|
| `KIMI_CODE_OAUTH_HOST` | プライマリOAuthホストオーバーライド |
| `KIMI_OAUTH_HOST` | フォールバックOAuthホストオーバーライド |
| `KIMI_CODE_BASE_URL` | Kimi使用エンドポイントのベースURLをオーバーライド（`usage/kimi.ts`） |

OAuthホストチェーン: `KIMI_CODE_OAUTH_HOST` → `KIMI_OAUTH_HOST` → `https://auth.kimi.com`。

### Antigravity/Gemini画像互換性

| 変数 | デフォルト / 動作 |
|---|---|
| `PI_AI_ANTIGRAVITY_VERSION` | Gemini CLIプロバイダーでのAntigravityユーザーエージェントバージョンタグをオーバーライド |

### OpenAI Codex responses（機能/デバッグ制御）

| 変数 | 動作 |
|---|---|
| `PI_CODEX_DEBUG` | `1`/`true` でCodexプロバイダーのデバッグログを有効化 |
| `PI_CODEX_WEBSOCKET` | `1`/`true` でWebSocketトランスポート優先を有効化 |
| `PI_CODEX_WEBSOCKET_V2` | `1`/`true` でWebSocket v2パスを有効化 |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | 正の整数オーバーライド（デフォルト 300000） |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | 非負の整数オーバーライド（デフォルト 5） |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | 正の整数ベースバックオフオーバーライド（デフォルト 500） |

### Cursorプロバイダーデバッグ

| 変数 | 動作 |
|---|---|
| `DEBUG_CURSOR` | プロバイダーデバッグログを有効化。`2`/`verbose` で詳細なペイロードスニペット |
| `DEBUG_CURSOR_LOG` | JSONLデバッグログ出力用のオプションファイルパス |

### プロンプトキャッシュ互換性スイッチ

| 変数 | 動作 |
|---|---|
| `PI_CACHE_RETENTION` | `long` の場合、サポートされているプロバイダーで長期保持を有効化（`anthropic`、`openai-responses`、Bedrock保持解決） |

---

## 3) Web検索サブシステム

### 検索プロバイダー資格情報

| 変数 | 使用元 |
|---|---|
| `EXA_API_KEY` | Exa検索プロバイダーおよびExa MCPツール |
| `BRAVE_API_KEY` | Brave検索プロバイダー |
| `PERPLEXITY_API_KEY` | Perplexity検索プロバイダーAPIキーモード |
| `TAVILY_API_KEY` | Tavily検索プロバイダー |
| `ZAI_API_KEY` | z.ai検索プロバイダー（`agent.db` 内の保存済みOAuthもチェック） |
| `OPENAI_API_KEY` / DB内のCodex OAuth | Codex検索プロバイダーの利用可能性/認証 |

### Anthropic Web検索認証チェーン

`packages/coding-agent/src/web/search/auth.ts` はAnthropic Web検索の資格情報を以下の順序で解決します：

1. `ANTHROPIC_SEARCH_API_KEY`（+ オプションの `ANTHROPIC_SEARCH_BASE_URL`）
2. `models.json` 内の `api: "anthropic-messages"` を持つプロバイダーエントリ
3. `agent.db` からのAnthropic OAuth資格情報（5分間のバッファ内に期限切れにならないこと）
4. 汎用Anthropic環境変数フォールバック: プロバイダーキー（`ANTHROPIC_FOUNDRY_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`）+ オプションの `ANTHROPIC_BASE_URL`（Foundryモード有効時は `FOUNDRY_BASE_URL`）

関連変数：

| 変数 | デフォルト / 動作 |
|---|---|
| `ANTHROPIC_SEARCH_API_KEY` | 最高優先度の明示的検索キー |
| `ANTHROPIC_SEARCH_BASE_URL` | 省略時のデフォルトは `https://api.anthropic.com` |
| `ANTHROPIC_SEARCH_MODEL` | デフォルトは `claude-haiku-4-5` |
| `ANTHROPIC_BASE_URL` | ティア4認証パスの汎用フォールバックベースURL |

### Perplexity OAuthフロー動作フラグ

| 変数 | 動作 |
|---|---|
| `PI_AUTH_NO_BORROW` | 設定されている場合、Perplexityログインフローでの macOSネイティブアプリトークン借用パスを無効化 |

---

## 4) Pythonツールとカーネルランタイム

| 変数 | デフォルト / 動作 |
|---|---|
| `PI_PY` | Pythonツールモードオーバーライド: `0`/`bash`=`bash-only`、`1`/`py`=`ipy-only`、`mix`/`both`=`both`; 無効な値は無視 |
| `PI_PYTHON_SKIP_CHECK` | `1` の場合、Pythonカーネルの利用可能性チェック/ウォームチェックをスキップ |
| `PI_PYTHON_GATEWAY_URL` | 設定されている場合、ローカル共有ゲートウェイの代わりに外部カーネルゲートウェイを使用 |
| `PI_PYTHON_GATEWAY_TOKEN` | 外部ゲートウェイ用のオプション認証トークン（`Authorization: token <value>`） |
| `PI_PYTHON_IPC_TRACE` | `1` の場合、カーネルモジュールで低レベルIPCトレースパスを有効化 |
| `VIRTUAL_ENV` | Pythonランタイム解決のための最高優先度venvパス |

追加の条件付き動作：

- `BUN_ENV=test` または `NODE_ENV=test` の場合、Python利用可能性チェックはOKとして扱われ、ウォーミングはスキップされます。
- Python環境フィルタリングは一般的なAPIキーを拒否し、安全な基本変数 + `LC_`、`XDG_`、`PI_` プレフィックスを許可します。

---

## 5) エージェント/ランタイム動作トグル

| 変数                   | デフォルト / 動作                                                                           |
|----------------------------|----------------------------------------------------------------------------------------------|
| `PI_SMOL_MODEL`            | `smol` のエフェメラルモデルロールオーバーライド（CLI `--smol` が優先）                     |
| `PI_SLOW_MODEL`            | `slow` のエフェメラルモデルロールオーバーライド（CLI `--slow` が優先）                     |
| `PI_PLAN_MODEL`            | `plan` のエフェメラルモデルロールオーバーライド（CLI `--plan` が優先）                     |
| `PI_NO_TITLE`              | 設定されている場合（空でない任意の値）、最初のユーザーメッセージでの自動セッションタイトル生成を無効化   |
| `NULL_PROMPT`              | `true` の場合、システムプロンプトビルダーが空文字列を返す                                        |
| `PI_BLOCKED_AGENT`         | タスクツールで特定のサブエージェントタイプをブロック                                                 |
| `PI_SUBPROCESS_CMD`        | サブエージェントスポーンコマンドをオーバーライド（`xcsh` / `xcsh.cmd` 解決バイパス）                       |
| `PI_TASK_MAX_OUTPUT_BYTES` | サブエージェントあたりの最大キャプチャ出力バイト数（デフォルト `500000`）                                    |
| `PI_TASK_MAX_OUTPUT_LINES` | サブエージェントあたりの最大キャプチャ出力行数（デフォルト `5000`）                                      |
| `PI_TIMING`                | `1` の場合、起動/ツールタイミング計測ログを有効化                                     |
| `PI_DEBUG_STARTUP`         | 複数の起動パスでstderrへの起動ステージデバッグ出力を有効化                       |
| `PI_PACKAGE_DIR`           | パッケージアセットベースディレクトリ解決をオーバーライド（docs/examples/changelogパスルックアップ）            |
| `PI_DISABLE_LSPMUX`        | `1` の場合、lspmux検出/統合を無効化し、直接LSPサーバースポーンを強制          |
| `LITELLM_BASE_URL`         | LiteLLMプロキシベースURL。`LITELLM_API_KEY` と併せて設定すると、初回実行時に `models.yml` の自動生成をトリガーし、毎回の起動時に自己修復を実行 |
| `LM_STUDIO_BASE_URL`       | デフォルトの暗黙的LM StudioディスカバリーベースURLオーバーライド（未設定時は `http://127.0.0.1:1234/v1`） |
| `OLLAMA_BASE_URL`          | デフォルトの暗黙的OllamaディスカバリーベースURLオーバーライド（未設定時は `http://127.0.0.1:11434`）      |
| `LLAMA_CPP_BASE_URL`       | デフォルトの暗黙的Llama.cppディスカバリーベースURLオーバーライド（未設定時は `http://127.0.0.1:8080`）    |
| `PI_EDIT_VARIANT`          | `hashline` の場合、editツールが利用可能な場合にhashline read/grep表示モードを強制               |
| `PI_NO_PTY`                | `1` の場合、bashツールのインタラクティブPTYパスを無効化                                          |

`PI_NO_PTY` はCLI `--no-pty` 使用時にも内部的に設定されます。

---

## 6) ストレージと設定ルートパス

これらは `@f5xc-salesdemos/pi-utils/dirs` 経由で消費され、coding-agentがデータを保存する場所に影響します。

| 変数 | デフォルト / 動作 |
|---|---|
| `PI_CONFIG_DIR` | ホームディレクトリ配下の設定ルートディレクトリ名（デフォルト `.xcsh`） |
| `PI_CODING_AGENT_DIR` | エージェントディレクトリの完全オーバーライド（デフォルト `~/<PI_CONFIG_DIR or .xcsh>/agent`） |
| `PWD` | パスヘルパーでカノニカルな現在の作業ディレクトリをマッチングする際に使用 |

---

## 7) シェル/ツール実行環境

（`packages/utils/src/procmgr.ts` およびcoding-agent bashツール統合より。）

| 変数 | 動作 |
|---|---|
| `PI_BASH_NO_CI` | スポーンされたシェル環境への自動 `CI=true` 注入を抑制 |
| `CLAUDE_BASH_NO_CI` | `PI_BASH_NO_CI` のレガシーエイリアスフォールバック |
| `PI_BASH_NO_LOGIN` | ログインシェルモードを無効化する目的 |
| `CLAUDE_BASH_NO_LOGIN` | `PI_BASH_NO_LOGIN` のレガシーエイリアスフォールバック |
| `PI_SHELL_PREFIX` | オプションのコマンドプレフィックスラッパー |
| `CLAUDE_CODE_SHELL_PREFIX` | `PI_SHELL_PREFIX` のレガシーエイリアスフォールバック |
| `VISUAL` | 優先外部エディターコマンド |
| `EDITOR` | フォールバック外部エディターコマンド |

現行実装の注意：`PI_BASH_NO_LOGIN`/`CLAUDE_BASH_NO_LOGIN` は読み取られますが、現在の `getShellArgs()` は両方のブランチで `['-l','-c']` を返します（事実上、現時点ではノーオプ）。

---

## 8) UI/テーマ/セッション検出（自動検出される環境変数）

これらはランタイムシグナルとして読み取られます。通常は手動設定ではなく、ターミナル/OSによって設定されます。

| 変数 | 用途 |
|---|---|
| `COLORTERM`、`TERM`、`WT_SESSION` | カラー機能検出（テーマカラーモード） |
| `COLORFGBG` | ターミナル背景のライト/ダーク自動検出 |
| `TERM_PROGRAM`、`TERM_PROGRAM_VERSION`、`TERMINAL_EMULATOR` | システムプロンプト/コンテキスト内のターミナル識別 |
| `KDE_FULL_SESSION`、`XDG_CURRENT_DESKTOP`、`DESKTOP_SESSION`、`XDG_SESSION_DESKTOP`、`GDMSESSION`、`WINDOWMANAGER` | システムプロンプト/コンテキスト内のデスクトップ/ウィンドウマネージャー検出 |
| `KITTY_WINDOW_ID`、`TMUX_PANE`、`TERM_SESSION_ID`、`WT_SESSION` | ターミナルごとの安定したセッションブレッドクラムID |
| `SHELL`、`ComSpec`、`TERM_PROGRAM`、`TERM` | システム情報診断 |
| `APPDATA`、`XDG_CONFIG_HOME` | lspmux設定パス解決 |
| `HOME` | MCPコマンドUIでのパス短縮 |

---

## 9) ネイティブローダー/デバッグフラグ

| 変数 | 動作 |
|---|---|
| `PI_DEV` | `packages/natives` での詳細なネイティブアドオンロード診断を有効化 |

## 10) TUIランタイムフラグ（共有パッケージ、coding-agent UXに影響）

| 変数 | 動作 |
|---|---|
| `PI_NOTIFICATIONS` | `off` / `0` / `false` でデスクトップ通知を抑制 |
| `PI_TUI_WRITE_LOG` | 設定されている場合、TUI書き込みをファイルにログ出力 |
| `PI_HARDWARE_CURSOR` | `1` の場合、ハードウェアカーソルモードを有効化 |
| `PI_CLEAR_ON_SHRINK` | `1` の場合、コンテンツ縮小時に空行をクリア |
| `PI_DEBUG_REDRAW` | `1` の場合、再描画デバッグログを有効化 |
| `PI_TUI_DEBUG` | `1` の場合、詳細TUIデバッグダンプパスを有効化 |

---

## 11) コミット生成制御

| 変数 | 動作 |
|---|---|
| `PI_COMMIT_TEST_FALLBACK` | `true`（大文字小文字不問）の場合、コミットフォールバック生成パスを強制 |
| `PI_COMMIT_NO_FALLBACK` | `true` の場合、エージェントが提案を返さなかった際のフォールバックを無効化 |
| `PI_COMMIT_MAP_REDUCE` | `false` の場合、map-reduceコミット分析パスを無効化 |
| `DEBUG` | 設定されている場合、コミットエージェントのエラースタックトレースを出力 |

---

## セキュリティに関する重要な変数

これらはシークレットとして扱い、ログ出力やコミットに含めないでください：

- プロバイダー/APIキーおよびOAuth/ベアラー資格情報（すべての `*_API_KEY`、`*_TOKEN`、OAuthアクセス/リフレッシュトークン）
- クラウド資格情報（`AWS_*`、`GOOGLE_APPLICATION_CREDENTIALS` パスはサービスアカウント素材を公開する可能性あり）
- 検索/プロバイダー認証変数（`EXA_API_KEY`、`BRAVE_API_KEY`、`PERPLEXITY_API_KEY`、Anthropic検索キー）
- Foundry mTLS素材（`CLAUDE_CODE_CLIENT_CERT`、`CLAUDE_CODE_CLIENT_KEY`、プライベートCAバンドルを指す場合の `NODE_EXTRA_CA_CERTS`）

Pythonランタイムは、カーネルサブプロセスをスポーンする前に多くの一般的なキー変数を明示的に除去します（`packages/coding-agent/src/ipy/runtime.ts`）。
