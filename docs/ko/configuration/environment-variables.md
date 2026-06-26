---
title: 환경 변수
description: xcsh 구성 및 동작 제어를 위한 런타임 환경 변수 참조.
sidebar:
  order: 2
  label: 환경 변수
i18n:
  sourceHash: 7baa9f5226ba
  translator: machine
---

# 환경 변수 (현재 런타임 참조)

이 참조는 다음 경로의 현재 코드에서 도출되었습니다:

- `packages/coding-agent/src/**`
- `packages/ai/src/**` (coding-agent에서 사용하는 프로바이더/인증 해결)
- `packages/utils/src/**` 및 `packages/tui/src/**` (해당 변수가 coding-agent 런타임에 직접 영향을 미치는 경우)

활성 동작만 문서화합니다.

## 해결 모델 및 우선순위

대부분의 런타임 조회는 `@f5-sales-demo/pi-utils` (`packages/utils/src/env.ts`)의 `$env`를 사용합니다.

`$env` 로딩 순서:

1. 기존 프로세스 환경 (`Bun.env`)
2. 아직 설정되지 않은 키에 대해 프로젝트 `.env` (`$PWD/.env`)
3. 아직 설정되지 않은 키에 대해 홈 `.env` (`~/.env`)

`.env` 파일의 추가 규칙: 파싱 중 `XCSH_*` 키는 `PI_*` 키로 미러링됩니다.

---

## 1) 모델/프로바이더 인증

별도로 명시되지 않는 한 `getEnvApiKey()` (`packages/ai/src/stream.ts`)를 통해 사용됩니다.

### 핵심 프로바이더 자격 증명

| 변수                            | 사용 대상 | 필요 시점                                                     | 참고사항 / 우선순위                                                                                  |
|---------------------------------|---|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `ANTHROPIC_OAUTH_TOKEN`         | Anthropic API 인증 | OAuth 토큰 인증으로 Anthropic 사용 시                         | 프로바이더 인증 해결 시 `ANTHROPIC_API_KEY`보다 우선함                                              |
| `ANTHROPIC_API_KEY`             | Anthropic API 인증 | OAuth 토큰 없이 Anthropic 사용 시                           | `ANTHROPIC_OAUTH_TOKEN` 이후 폴백                                                              |
| `ANTHROPIC_FOUNDRY_API_KEY`     | Azure Foundry / 엔터프라이즈 게이트웨이를 통한 Anthropic | `CLAUDE_CODE_USE_FOUNDRY` 활성화 시                             | Foundry 모드 활성화 시 `ANTHROPIC_OAUTH_TOKEN` 및 `ANTHROPIC_API_KEY`보다 우선함  |
| `OPENAI_API_KEY`                | OpenAI 인증 | 명시적 apiKey 인수 없이 OpenAI 계열 프로바이더 사용 시 | OpenAI Completions/Responses 프로바이더에서 사용됨                                                      |
| `GEMINI_API_KEY`                | Google Gemini 인증 | `google` 프로바이더 모델 사용 시                                | Gemini 프로바이더 매핑을 위한 기본 키                                                             |
| `GOOGLE_API_KEY`                | Gemini 이미지 도구 인증 폴백 | `GEMINI_API_KEY` 없이 `gemini_image` 도구 사용 시            | coding-agent 이미지 도구 폴백 경로에서 사용됨                                                       |
| `GROQ_API_KEY`                  | Groq 인증 | Groq 모델 사용 시                                             |                                                                                                     |
| `CEREBRAS_API_KEY`              | Cerebras 인증 | Cerebras 모델 사용 시                                         |                                                                                                     |
| `TOGETHER_API_KEY`              | Together 인증 | `together` 프로바이더 사용 시                                     |                                                                                                     |
| `HUGGINGFACE_HUB_TOKEN`         | Hugging Face 인증 | `huggingface` 프로바이더 사용 시                                  | 기본 Hugging Face 토큰 환경 변수                                                                  |
| `HF_TOKEN`                      | Hugging Face 인증 | `huggingface` 프로바이더 사용 시                                  | `HUGGINGFACE_HUB_TOKEN`이 설정되지 않은 경우 폴백                                                      |
| `SYNTHETIC_API_KEY`             | Synthetic 인증 | Synthetic 모델 사용 시                                        |                                                                                                     |
| `NVIDIA_API_KEY`                | NVIDIA 인증 | `nvidia` 프로바이더 사용 시                                       |                                                                                                     |
| `NANO_GPT_API_KEY`              | NanoGPT 인증 | `nanogpt` 프로바이더 사용 시                                      |                                                                                                     |
| `VENICE_API_KEY`                | Venice 인증 | `venice` 프로바이더 사용 시                                       |                                                                                                     |
| `LITELLM_API_KEY`               | LiteLLM 인증 | `litellm` 프로바이더 사용 시                                      | OpenAI 호환 LiteLLM 프록시 키. `LITELLM_BASE_URL`과 함께 설정 시 `models.yml` 자동 구성 활성화 |
| `LM_STUDIO_API_KEY`             | LM Studio 인증 (선택) | 인증된 호스트에서 `lm-studio` 프로바이더 사용 시           | 로컬 LM Studio는 일반적으로 인증 없이 실행됨; 키가 필요한 경우 비어 있지 않은 토큰이면 됨         |
| `OLLAMA_API_KEY`                | Ollama 인증 (선택) | 인증된 호스트에서 `ollama` 프로바이더 사용 시              | 로컬 Ollama는 일반적으로 인증 없이 실행됨; 키가 필요한 경우 비어 있지 않은 토큰이면 됨            |
| `LLAMA_CPP_API_KEY`             | Ollama 인증 (선택) | `--api-key` 파라미터와 함께 `llama-server` 사용 시              | 로컬 llama.cpp는 일반적으로 인증 없이 실행됨; 키가 구성된 경우 비어 있지 않은 토큰이면 됨       |
| `XIAOMI_API_KEY`                | Xiaomi MiMo 인증 | `xiaomi` 프로바이더 사용 시                                       |                                                                                                     |
| `MOONSHOT_API_KEY`              | Moonshot 인증 | `moonshot` 프로바이더 사용 시                                     |                                                                                                     |
| `XAI_API_KEY`                   | xAI 인증 | xAI 모델 사용 시                                              |                                                                                                     |
| `OPENROUTER_API_KEY`            | OpenRouter 인증 | OpenRouter 모델 사용 시                                       | 선호/자동 프로바이더가 OpenRouter인 경우 이미지 도구에서도 사용됨                                  |
| `MISTRAL_API_KEY`               | Mistral 인증 | Mistral 모델 사용 시                                          |                                                                                                     |
| `ZAI_API_KEY`                   | z.ai 인증 | z.ai 모델 사용 시                                             | z.ai 웹 검색 프로바이더에서도 사용됨                                                               |
| `MINIMAX_API_KEY`               | MiniMax 인증 | `minimax` 프로바이더 사용 시                                      |                                                                                                     |
| `MINIMAX_CODE_API_KEY`          | MiniMax Code 인증 | `minimax-code` 프로바이더 사용 시                                 |                                                                                                     |
| `MINIMAX_CODE_CN_API_KEY`       | MiniMax Code CN 인증 | `minimax-code-cn` 프로바이더 사용 시                              |                                                                                                     |
| `OPENCODE_API_KEY`              | OpenCode 인증 | OpenCode 모델 사용 시                                         |                                                                                                     |
| `QIANFAN_API_KEY`               | Qianfan 인증 | `qianfan` 프로바이더 사용 시                                      |                                                                                                     |
| `QWEN_OAUTH_TOKEN`              | Qwen 포털 인증 | OAuth 토큰으로 `qwen-portal` 사용 시                          | `QWEN_PORTAL_API_KEY`보다 우선함                                                                         |
| `QWEN_PORTAL_API_KEY`           | Qwen 포털 인증 | API 키로 `qwen-portal` 사용 시                              | `QWEN_OAUTH_TOKEN` 이후 폴백                                                                   |
| `ZENMUX_API_KEY`                | ZenMux 인증 | `zenmux` 프로바이더 사용 시                                       | ZenMux OpenAI 및 Anthropic 호환 라우트에서 사용됨                                              |
| `VLLM_API_KEY`                  | vLLM 인증/검색 옵트인 | `vllm` 프로바이더 사용 시 (로컬 OpenAI 호환 서버)       | 인증 없는 로컬 서버의 경우 비어 있지 않은 값이면 됨                                                 |
| `CURSOR_ACCESS_TOKEN`           | Cursor 프로바이더 인증 | Cursor 프로바이더 사용 시                                         |                                                                                                     |
| `AI_GATEWAY_API_KEY`            | Vercel AI 게이트웨이 인증 | `vercel-ai-gateway` 프로바이더 사용 시                            |                                                                                                     |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | Cloudflare AI 게이트웨이 인증 | `cloudflare-ai-gateway` 프로바이더 사용 시                        | 베이스 URL은 `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic`으로 구성되어야 함 |

### GitHub/Copilot 토큰 체인

| 변수 | 사용 대상 | 체인 |
|---|---|---|
| `COPILOT_GITHUB_TOKEN` | GitHub Copilot 프로바이더 인증 | `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` |
| `GH_TOKEN` | Copilot 폴백; 웹 스크레이퍼에서 GitHub API 인증 | 웹 스크레이퍼: `GITHUB_TOKEN` → `GH_TOKEN` |
| `GITHUB_TOKEN` | Copilot 폴백; 웹 스크레이퍼에서 GitHub API 인증 | 웹 스크레이퍼: `GH_TOKEN`보다 먼저 확인됨 |

---

## 2) 프로바이더별 런타임 구성

### Anthropic Foundry 게이트웨이 (Azure / 엔터프라이즈 프록시)

`CLAUDE_CODE_USE_FOUNDRY`가 활성화되면 Anthropic 요청이 Foundry 모드로 전환됩니다:

- 베이스 URL은 `FOUNDRY_BASE_URL`에서 해결됩니다 (설정되지 않은 경우 모델/기본 베이스 URL이 폴백으로 유지됨).
- `anthropic` 프로바이더의 API 키 해결 순서:
  `ANTHROPIC_FOUNDRY_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`.
- `ANTHROPIC_CUSTOM_HEADERS`는 쉼표/줄바꿈으로 구분된 `key: value` 쌍으로 파싱되어 요청 헤더에 병합됩니다.
- 환경 변수 값에서 TLS 클라이언트/서버 자료를 주입할 수 있습니다:
  `NODE_EXTRA_CA_CERTS`, `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`.
  각각 다음을 허용합니다:
  - PEM 콘텐츠에 대한 파일시스템 경로, 또는
  - 인라인 PEM (이스케이프된 `\n` 시퀀스 포함).

| 변수 | 값 유형 | 동작 |
|---|---|---|
| `CLAUDE_CODE_USE_FOUNDRY` | 부울형 문자열 (`1`, `true`, `yes`, `on`) | Anthropic 프로바이더에 대해 Foundry 모드 활성화 |
| `FOUNDRY_BASE_URL` | URL 문자열 | Foundry 모드에서의 Anthropic 엔드포인트 베이스 URL |
| `ANTHROPIC_FOUNDRY_API_KEY` | 토큰 문자열 | `Authorization: Bearer <token>`에 사용됨 |
| `ANTHROPIC_CUSTOM_HEADERS` | 헤더 목록 문자열 | 추가 헤더; `header-a: value, header-b: value` 형식 또는 줄바꿈 구분 |
| `NODE_EXTRA_CA_CERTS` | PEM 경로 또는 인라인 PEM | 서버 인증서 유효성 검사를 위한 추가 CA 체인 |
| `CLAUDE_CODE_CLIENT_CERT` | PEM 경로 또는 인라인 PEM | mTLS 클라이언트 인증서 |
| `CLAUDE_CODE_CLIENT_KEY` | PEM 경로 또는 인라인 PEM | mTLS 클라이언트 개인 키 (인증서와 쌍을 이루어야 함) |

### Amazon Bedrock

| 변수 | 기본값 / 동작 |
|---|---|
| `AWS_REGION` | 기본 리전 소스 |
| `AWS_DEFAULT_REGION` | `AWS_REGION`이 설정되지 않은 경우 폴백 |
| `AWS_PROFILE` | 명명된 프로필 인증 경로 활성화 |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | IAM 키 인증 경로 활성화 |
| `AWS_BEARER_TOKEN_BEDROCK` | 베어러 토큰 인증 경로 활성화 |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `AWS_CONTAINER_CREDENTIALS_FULL_URI` | ECS 태스크 자격 증명 경로 활성화 |
| `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` | 웹 ID 인증 경로 활성화 |
| `AWS_BEDROCK_SKIP_AUTH` | `1`이면 더미 자격 증명 주입 (프록시/비인증 시나리오) |
| `AWS_BEDROCK_FORCE_HTTP1` | `1`이면 Node HTTP/1 요청 핸들러 강제 사용 |

프로바이더 코드에서의 리전 폴백: `options.region` → `AWS_REGION` → `AWS_DEFAULT_REGION` → `us-east-1`.

### Azure OpenAI Responses

| 변수 | 기본값 / 동작 |
|---|---|
| `AZURE_OPENAI_API_KEY` | 옵션으로 API 키가 전달되지 않는 한 필수 |
| `AZURE_OPENAI_API_VERSION` | 기본값 `v1` |
| `AZURE_OPENAI_BASE_URL` | 직접 베이스 URL 재정의 |
| `AZURE_OPENAI_RESOURCE_NAME` | 베이스 URL 구성에 사용됨: `https://<resource>.openai.azure.com/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | 선택적 매핑 문자열: `modelId=deploymentName,model2=deployment2` |

베이스 URL 해결: 옵션 `azureBaseUrl` → 환경 변수 `AZURE_OPENAI_BASE_URL` → 옵션/환경 변수 리소스 이름 → `model.baseUrl`.

### Google Vertex AI

| 변수 | 필수 여부 | 참고사항 |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | 예 (옵션으로 전달되지 않는 한) | 폴백: `GCLOUD_PROJECT` |
| `GCLOUD_PROJECT` | 폴백 | 대체 프로젝트 ID 소스로 사용됨 |
| `GOOGLE_CLOUD_LOCATION` | 예 (옵션으로 전달되지 않는 한) | 프로바이더에 기본값 없음 |
| `GOOGLE_APPLICATION_CREDENTIALS` | 조건부 | 설정된 경우 파일이 존재해야 함; 그렇지 않으면 ADC 폴백 경로 확인 (`~/.config/gcloud/application_default_credentials.json`) |

### Kimi

| 변수 | 기본값 / 동작 |
|---|---|
| `KIMI_CODE_OAUTH_HOST` | 기본 OAuth 호스트 재정의 |
| `KIMI_OAUTH_HOST` | 폴백 OAuth 호스트 재정의 |
| `KIMI_CODE_BASE_URL` | Kimi 사용 엔드포인트 베이스 URL 재정의 (`usage/kimi.ts`) |

OAuth 호스트 체인: `KIMI_CODE_OAUTH_HOST` → `KIMI_OAUTH_HOST` → `https://auth.kimi.com`.

### Antigravity/Gemini 이미지 호환성

| 변수 | 기본값 / 동작 |
|---|---|
| `PI_AI_ANTIGRAVITY_VERSION` | Gemini CLI 프로바이더에서 Antigravity 사용자 에이전트 버전 태그 재정의 |

### OpenAI Codex responses (기능/디버그 제어)

| 변수 | 동작 |
|---|---|
| `PI_CODEX_DEBUG` | `1`/`true`이면 Codex 프로바이더 디버그 로깅 활성화 |
| `PI_CODEX_WEBSOCKET` | `1`/`true`이면 웹소켓 전송 선호 활성화 |
| `PI_CODEX_WEBSOCKET_V2` | `1`/`true`이면 웹소켓 v2 경로 활성화 |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | 양의 정수 재정의 (기본값 300000) |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | 음이 아닌 정수 재정의 (기본값 5) |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | 양의 정수 기본 백오프 재정의 (기본값 500) |

### Cursor 프로바이더 디버그

| 변수 | 동작 |
|---|---|
| `DEBUG_CURSOR` | 프로바이더 디버그 로그 활성화; `2`/`verbose`이면 상세 페이로드 스니펫 출력 |
| `DEBUG_CURSOR_LOG` | JSONL 디버그 로그 출력을 위한 선택적 파일 경로 |

### 프롬프트 캐시 호환성 스위치

| 변수 | 동작 |
|---|---|
| `PI_CACHE_RETENTION` | `long`이면 지원되는 경우 긴 보존 활성화 (`anthropic`, `openai-responses`, Bedrock 보존 해결) |

---

## 3) 웹 검색 서브시스템

### 검색 프로바이더 자격 증명

| 변수 | 사용 주체 |
|---|---|
| `EXA_API_KEY` | Exa 검색 프로바이더 및 Exa MCP 도구 |
| `BRAVE_API_KEY` | Brave 검색 프로바이더 |
| `PERPLEXITY_API_KEY` | Perplexity 검색 프로바이더 API 키 모드 |
| `TAVILY_API_KEY` | Tavily 검색 프로바이더 |
| `ZAI_API_KEY` | z.ai 검색 프로바이더 (`agent.db`에 저장된 OAuth도 확인) |
| `OPENAI_API_KEY` / DB의 Codex OAuth | Codex 검색 프로바이더 가용성/인증 |

### Anthropic 웹 검색 인증 체인

`packages/coding-agent/src/web/search/auth.ts`는 다음 순서로 Anthropic 웹 검색 자격 증명을 해결합니다:

1. `ANTHROPIC_SEARCH_API_KEY` (+ 선택적 `ANTHROPIC_SEARCH_BASE_URL`)
2. `api: "anthropic-messages"`를 가진 `models.json` 프로바이더 항목
3. `agent.db`의 Anthropic OAuth 자격 증명 (5분 버퍼 내에 만료되지 않아야 함)
4. 일반 Anthropic 환경 변수 폴백: 프로바이더 키 (`ANTHROPIC_FOUNDRY_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`) + 선택적 `ANTHROPIC_BASE_URL` (Foundry 모드 활성화 시 `FOUNDRY_BASE_URL`)

관련 변수:

| 변수 | 기본값 / 동작 |
|---|---|
| `ANTHROPIC_SEARCH_API_KEY` | 최우선 명시적 검색 키 |
| `ANTHROPIC_SEARCH_BASE_URL` | 생략 시 `https://api.anthropic.com`으로 기본 설정 |
| `ANTHROPIC_SEARCH_MODEL` | 기본값 `claude-haiku-4-5` |
| `ANTHROPIC_BASE_URL` | 4단계 인증 경로를 위한 일반 폴백 베이스 URL |

### Perplexity OAuth 흐름 동작 플래그

| 변수 | 동작 |
|---|---|
| `PI_AUTH_NO_BORROW` | 설정된 경우 Perplexity 로그인 흐름에서 macOS 네이티브 앱 토큰 차용 경로 비활성화 |

---

## 4) Python 도구 및 커널 런타임

| 변수 | 기본값 / 동작 |
|---|---|
| `PI_PY` | Python 도구 모드 재정의: `0`/`bash`=`bash-only`, `1`/`py`=`ipy-only`, `mix`/`both`=`both`; 유효하지 않은 값은 무시됨 |
| `PI_PYTHON_SKIP_CHECK` | `1`이면 Python 커널 가용성 검사/워밍 검사 건너뜀 |
| `PI_PYTHON_GATEWAY_URL` | 설정된 경우 로컬 공유 게이트웨이 대신 외부 커널 게이트웨이 사용 |
| `PI_PYTHON_GATEWAY_TOKEN` | 외부 게이트웨이를 위한 선택적 인증 토큰 (`Authorization: token <value>`) |
| `PI_PYTHON_IPC_TRACE` | `1`이면 커널 모듈에서 저수준 IPC 추적 경로 활성화 |
| `VIRTUAL_ENV` | Python 런타임 해결을 위한 최우선 venv 경로 |

추가 조건부 동작:

- `BUN_ENV=test` 또는 `NODE_ENV=test`이면 Python 가용성 검사가 OK로 처리되고 워밍이 건너뜀.
- Python 환경 필터링은 일반적인 API 키 변수를 차단하고 안전한 기본 변수 및 `LC_`, `XDG_`, `PI_` 접두사를 허용합니다.

---

## 5) 에이전트/런타임 동작 토글

| 변수                   | 기본값 / 동작                                                                           |
|----------------------------|----------------------------------------------------------------------------------------------|
| `PI_SMOL_MODEL`            | `smol` 역할에 대한 임시 모델 역할 재정의 (CLI `--smol`이 우선함)                     |
| `PI_SLOW_MODEL`            | `slow` 역할에 대한 임시 모델 역할 재정의 (CLI `--slow`이 우선함)                     |
| `PI_PLAN_MODEL`            | `plan` 역할에 대한 임시 모델 역할 재정의 (CLI `--plan`이 우선함)                     |
| `PI_NO_TITLE`              | 설정된 경우 (비어 있지 않은 값), 첫 번째 사용자 메시지에서 자동 세션 제목 생성 비활성화   |
| `NULL_PROMPT`              | `true`이면 시스템 프롬프트 빌더가 빈 문자열 반환                                        |
| `PI_BLOCKED_AGENT`         | 태스크 도구에서 특정 서브에이전트 유형 차단                                 |
| `PI_SUBPROCESS_CMD`        | 서브에이전트 스폰 명령 재정의 (`xcsh` / `xcsh.cmd` 해결 우회)                       |
| `PI_TASK_MAX_OUTPUT_BYTES` | 서브에이전트당 최대 캡처 출력 바이트 (기본값 `500000`)                                    |
| `PI_TASK_MAX_OUTPUT_LINES` | 서브에이전트당 최대 캡처 출력 라인 (기본값 `5000`)                                      |
| `PI_TIMING`                | `1`이면 시작/도구 타이밍 계측 로그 활성화                                     |
| `PI_DEBUG_STARTUP`         | 여러 시작 경로에서 stderr로 시작 단계 디버그 출력 활성화                       |
| `PI_PACKAGE_DIR`           | 패키지 에셋 기본 디렉토리 해결 재정의 (문서/예제/변경로그 경로 조회)            |
| `PI_DISABLE_LSPMUX`        | `1`이면 lspmux 감지/통합 비활성화 및 직접 LSP 서버 스폰 강제                          |
| `LITELLM_BASE_URL`         | LiteLLM 프록시 베이스 URL. `LITELLM_API_KEY`와 함께 설정 시 최초 실행 시 `models.yml` 자동 생성 및 매 시작 시 자가 복구 트리거 |
| `LM_STUDIO_BASE_URL`       | 기본 암묵적 LM Studio 검색 베이스 URL 재정의 (설정되지 않은 경우 `http://127.0.0.1:1234/v1`) |
| `OLLAMA_BASE_URL`          | 기본 암묵적 Ollama 검색 베이스 URL 재정의 (설정되지 않은 경우 `http://127.0.0.1:11434`)      |
| `LLAMA_CPP_BASE_URL`       | 기본 암묵적 Llama.cpp 검색 베이스 URL 재정의 (설정되지 않은 경우 `http://127.0.0.1:8080`)    |
| `PI_EDIT_VARIANT`          | `hashline`이면 편집 도구 사용 가능 시 hashline 읽기/grep 표시 모드 강제               |
| `PI_NO_PTY`                | `1`이면 bash 도구의 인터랙티브 PTY 경로 비활성화                                          |

`PI_NO_PTY`는 CLI `--no-pty` 사용 시 내부적으로도 설정됩니다.

---

## 6) 스토리지 및 구성 루트 경로

이것들은 `@f5-sales-demo/pi-utils/dirs`를 통해 사용되며 coding-agent가 데이터를 저장하는 위치에 영향을 미칩니다.

| 변수 | 기본값 / 동작 |
|---|---|
| `PI_CONFIG_DIR` | 홈 디렉토리 아래 구성 루트 디렉토리명 (기본값 `.xcsh`) |
| `PI_CODING_AGENT_DIR` | 에이전트 디렉토리의 전체 재정의 (기본값 `~/<PI_CONFIG_DIR or .xcsh>/agent`) |
| `PWD` | 경로 헬퍼에서 표준 현재 작업 디렉토리 일치 시 사용됨 |

---

## 7) 셸/도구 실행 환경

(`packages/utils/src/procmgr.ts` 및 coding-agent bash 도구 통합에서.)

| 변수 | 동작 |
|---|---|
| `PI_BASH_NO_CI` | 스폰된 셸 환경에 자동 `CI=true` 주입 억제 |
| `CLAUDE_BASH_NO_CI` | `PI_BASH_NO_CI`의 레거시 별칭 폴백 |
| `PI_BASH_NO_LOGIN` | 로그인 셸 모드 비활성화 의도 |
| `CLAUDE_BASH_NO_LOGIN` | `PI_BASH_NO_LOGIN`의 레거시 별칭 폴백 |
| `PI_SHELL_PREFIX` | 선택적 명령 접두사 래퍼 |
| `CLAUDE_CODE_SHELL_PREFIX` | `PI_SHELL_PREFIX`의 레거시 별칭 폴백 |
| `VISUAL` | 선호하는 외부 편집기 명령 |
| `EDITOR` | 폴백 외부 편집기 명령 |

현재 구현 참고: `PI_BASH_NO_LOGIN`/`CLAUDE_BASH_NO_LOGIN`은 읽히지만 현재 `getShellArgs()`는 두 분기 모두에서 `['-l','-c']`를 반환합니다 (현재는 사실상 아무 동작도 하지 않음).

---

## 8) UI/테마/세션 감지 (자동 감지 환경 변수)

이것들은 런타임 신호로 읽히며, 일반적으로 수동으로 구성하는 것이 아니라 터미널/OS에 의해 설정됩니다.

| 변수 | 사용 대상 |
|---|---|
| `COLORTERM`, `TERM`, `WT_SESSION` | 색상 기능 감지 (테마 색상 모드) |
| `COLORFGBG` | 터미널 배경 밝음/어두움 자동 감지 |
| `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERMINAL_EMULATOR` | 시스템 프롬프트/컨텍스트에서 터미널 식별 |
| `KDE_FULL_SESSION`, `XDG_CURRENT_DESKTOP`, `DESKTOP_SESSION`, `XDG_SESSION_DESKTOP`, `GDMSESSION`, `WINDOWMANAGER` | 시스템 프롬프트/컨텍스트에서 데스크톱/윈도우 매니저 감지 |
| `KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION` | 안정적인 터미널별 세션 브레드크럼 ID |
| `SHELL`, `ComSpec`, `TERM_PROGRAM`, `TERM` | 시스템 정보 진단 |
| `APPDATA`, `XDG_CONFIG_HOME` | lspmux 구성 경로 해결 |
| `HOME` | MCP 명령 UI에서 경로 단축 |

---

## 9) 네이티브 로더/디버그 플래그

| 변수 | 동작 |
|---|---|
| `PI_DEV` | `packages/natives`에서 자세한 네이티브 애드온 로드 진단 활성화 |

## 10) TUI 런타임 플래그 (공유 패키지, coding-agent UX에 영향)

| 변수 | 동작 |
|---|---|
| `PI_NOTIFICATIONS` | `off` / `0` / `false`이면 데스크톱 알림 억제 |
| `PI_TUI_WRITE_LOG` | 설정된 경우 TUI 쓰기를 파일에 로깅 |
| `PI_HARDWARE_CURSOR` | `1`이면 하드웨어 커서 모드 활성화 |
| `PI_CLEAR_ON_SHRINK` | `1`이면 콘텐츠 축소 시 빈 행 지움 |
| `PI_DEBUG_REDRAW` | `1`이면 리드로우 디버그 로깅 활성화 |
| `PI_TUI_DEBUG` | `1`이면 심층 TUI 디버그 덤프 경로 활성화 |

---

## 11) 커밋 생성 제어

| 변수 | 동작 |
|---|---|
| `PI_COMMIT_TEST_FALLBACK` | `true`이면 (대소문자 구분 없음) 커밋 폴백 생성 경로 강제 |
| `PI_COMMIT_NO_FALLBACK` | `true`이면 에이전트가 제안을 반환하지 않을 때 폴백 비활성화 |
| `PI_COMMIT_MAP_REDUCE` | `false`이면 맵-리듀스 커밋 분석 경로 비활성화 |
| `DEBUG` | 설정된 경우 커밋 에이전트 오류 스택 트레이스 출력 |

---

## 보안에 민감한 변수

이것들을 시크릿으로 취급하십시오; 로깅하거나 커밋하지 마십시오:

- 프로바이더/API 키 및 OAuth/베어러 자격 증명 (모든 `*_API_KEY`, `*_TOKEN`, OAuth 액세스/갱신 토큰)
- 클라우드 자격 증명 (`AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS` 경로는 서비스 계정 자료를 노출할 수 있음)
- 검색/프로바이더 인증 변수 (`EXA_API_KEY`, `BRAVE_API_KEY`, `PERPLEXITY_API_KEY`, Anthropic 검색 키)
- Foundry mTLS 자료 (`CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`, 개인 CA 번들을 가리키는 경우 `NODE_EXTRA_CA_CERTS`)

Python 런타임은 커널 서브프로세스 스폰 전에 많은 일반적인 키 변수를 명시적으로 제거합니다 (`packages/coding-agent/src/ipy/runtime.ts`).
