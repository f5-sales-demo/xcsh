---
title: Model and Provider Configuration
description: >-
  Model registry and provider configuration via models.yml with routing,
  fallback, and pricing.
sidebar:
  order: 1
  label: Models & providers
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# 모델 및 프로바이더 설정 (`models.yml`)

이 문서는 코딩 에이전트가 현재 모델을 로드하고, 오버라이드를 적용하며, 자격 증명을 해석하고, 런타임에 모델을 선택하는 방법을 설명합니다.

## 모델 동작을 제어하는 요소

주요 구현 파일:

- `src/config/model-registry.ts` — 내장 + 커스텀 모델 로드, 프로바이더 오버라이드, 런타임 디스커버리, 인증 통합
- `src/config/model-resolver.ts` — 모델 패턴 파싱 및 initial/smol/slow 모델 선택
- `src/config/settings-schema.ts` — 모델 관련 설정 (`modelRoles`, 프로바이더 전송 기본 설정)
- `src/session/auth-storage.ts` — API 키 + OAuth 해석 순서
- `packages/ai/src/models.ts` 및 `packages/ai/src/types.ts` — 내장 프로바이더/모델 및 `Model`/`compat` 타입

## 설정 파일 위치 및 레거시 동작

기본 설정 경로:

- `~/.xcsh/agent/models.yml`

여전히 존재하는 레거시 동작:

- `models.yml`이 없고 같은 위치에 `models.json`이 존재하면 `models.yml`로 마이그레이션됩니다.
- 명시적 `.json` / `.jsonc` 설정 경로는 `ModelRegistry`에 프로그래밍 방식으로 전달될 때 여전히 지원됩니다.

## `models.yml` 구조

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

`configVersion`은 자동 설정 시스템이 기록하는 선택적 정수입니다. 존재할 경우 xcsh는 이를 사용하여 오래된 설정을 감지하고 자동 업그레이드합니다.

`provider-id`는 선택 및 인증 조회 전반에 사용되는 정규 프로바이더 키입니다.

`equivalence`는 선택 사항이며 구체적인 프로바이더 모델 위에 정규 모델 그룹화를 설정합니다:

- `overrides`는 정확한 구체적 선택자(`provider/modelId`)를 공식 업스트림 정규 ID에 매핑합니다
- `exclude`는 구체적 선택자를 정규 그룹화에서 제외합니다

## 프로바이더 수준 필드

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

### 허용되는 프로바이더/모델 `api` 값

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### 허용되는 auth/discovery 값

- `auth`: `apiKey` (기본값) 또는 `none`
- `discovery.type`: `ollama`

## 유효성 검사 규칙 (현재)

### 전체 커스텀 프로바이더 (`models`가 비어있지 않은 경우)

필수 항목:

- `baseUrl`
- `auth: none`이 아닌 경우 `apiKey`
- 프로바이더 수준 또는 각 모델에 `api`

### 오버라이드 전용 프로바이더 (`models`가 없거나 비어있는 경우)

다음 중 최소 하나를 정의해야 합니다:

- `baseUrl`
- `modelOverrides`
- `discovery`

### 디스커버리

- `discovery`는 프로바이더 수준의 `api`를 필요로 합니다.

### 모델 값 검사

- `id` 필수
- `contextWindow` 및 `maxTokens`는 제공될 경우 양수여야 합니다

## 병합 및 오버라이드 순서

ModelRegistry 파이프라인 (새로고침 시):

1. `@f5xc-salesdemos/pi-ai`에서 내장 프로바이더/모델을 로드합니다.
2. `models.yml` 커스텀 설정을 로드합니다.
3. 내장 모델에 프로바이더 오버라이드(`baseUrl`, `headers`)를 적용합니다.
4. `modelOverrides`를 적용합니다 (프로바이더 + 모델 ID별).
5. 커스텀 `models`를 병합합니다:
   - 동일한 `provider + id`는 기존 항목을 대체합니다
   - 그렇지 않으면 추가합니다
6. 런타임 발견된 모델(현재 Ollama 및 LM Studio)을 적용한 후 모델 오버라이드를 다시 적용합니다.

## 정규 모델 동등성 및 통합

레지스트리는 모든 구체적 프로바이더 모델을 유지하고 그 위에 정규 레이어를 구축합니다.

정규 ID는 공식 업스트림 ID만 해당합니다. 예를 들어:

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### `models.yml` 동등성 설정

예시:

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

정규 그룹화 구축 순서:

1. `equivalence.overrides`의 정확한 사용자 오버라이드
2. 내장 모델 메타데이터의 번들된 공식 ID 일치
3. 게이트웨이/프로바이더 변형에 대한 보수적 휴리스틱 정규화
4. 구체적 모델 자체 ID로 폴백

현재 휴리스틱은 의도적으로 좁습니다:

- 내장된 업스트림 접두사가 존재할 경우 제거될 수 있습니다. 예를 들어 `anthropic/...` 또는 `openai/...`
- 점과 대시가 포함된 버전 변형은 기존 공식 ID에 매핑될 때만 정규화할 수 있습니다. 예를 들어 `4.6 -> 4-6`
- 모호한 패밀리나 버전은 번들된 일치 또는 명시적 오버라이드 없이 병합되지 않습니다

### 정규 해석 동작

여러 구체적 변형이 정규 ID를 공유할 때 해석은 다음을 사용합니다:

1. 가용성 및 인증
2. `config.yml`의 `modelProviderOrder`
3. `modelProviderOrder`가 설정되지 않은 경우 기존 레지스트리/프로바이더 순서

비활성화되거나 인증되지 않은 프로바이더는 건너뜁니다.

세션 상태와 트랜스크립트는 실제로 턴을 실행한 구체적 프로바이더/모델을 계속 기록합니다.

프로바이더 기본값 vs 모델별 오버라이드:

- 프로바이더 `headers`가 기본값입니다.
- 모델 `headers`는 프로바이더 헤더 키를 오버라이드합니다.
- `modelOverrides`는 모델 메타데이터(`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`)를 오버라이드할 수 있습니다.
- `compat`는 중첩된 라우팅 블록(`openRouterRouting`, `vercelGatewayRouting`, `extraBody`)에 대해 딥 머지됩니다.

## 런타임 디스커버리 통합

### 암시적 Ollama 디스커버리

`ollama`가 명시적으로 설정되지 않은 경우 레지스트리는 암시적 발견 가능 프로바이더를 추가합니다:

- 프로바이더: `ollama`
- api: `openai-completions`
- 기본 URL: `OLLAMA_BASE_URL` 또는 `http://127.0.0.1:11434`
- 인증 모드: 키리스 (`auth: none` 동작)

런타임 디스커버리는 Ollama에서 `GET /api/tags`를 호출하고 로컬 기본값으로 모델 항목을 합성합니다.

### 암시적 llama.cpp 디스커버리

`llama.cpp`가 명시적으로 설정되지 않은 경우 레지스트리는 암시적 발견 가능 프로바이더를 추가합니다:
참고: openai-completions 대신 더 새로운 anthropic messages API를 사용합니다.

- 프로바이더: `llama.cpp`
- api: `openai-responses`
- 기본 URL: `LLAMA_CPP_BASE_URL` 또는 `http://127.0.0.1:8080`
- 인증 모드: 키리스 (`auth: none` 동작)

런타임 디스커버리는 llama.cpp에서 `GET models`를 호출하고 로컬 기본값으로 모델 항목을 합성합니다.

### 암시적 LM Studio 디스커버리

`lm-studio`가 명시적으로 설정되지 않은 경우 레지스트리는 암시적 발견 가능 프로바이더를 추가합니다:

- 프로바이더: `lm-studio`
- api: `openai-completions`
- 기본 URL: `LM_STUDIO_BASE_URL` 또는 `http://127.0.0.1:1234/v1`
- 인증 모드: 키리스 (`auth: none` 동작)

런타임 디스커버리는 모델을 가져오고(`GET /models`) 로컬 기본값으로 모델 항목을 합성합니다.

### 명시적 프로바이더 디스커버리

디스커버리를 직접 설정할 수 있습니다:

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

### 확장 프로바이더 등록

확장은 런타임에 프로바이더를 등록할 수 있습니다(`pi.registerProvider(...)`), 포함 사항:

- 프로바이더에 대한 모델 교체/추가
- 새 API ID에 대한 커스텀 스트림 핸들러 등록
- 커스텀 OAuth 프로바이더 등록

## 인증 및 API 키 해석 순서

프로바이더의 키를 요청할 때 유효한 순서는 다음과 같습니다:

1. 런타임 오버라이드 (CLI `--api-key`)
2. `agent.db`에 저장된 API 키 자격 증명
3. `agent.db`에 저장된 OAuth 자격 증명 (갱신 포함)
4. 환경 변수 매핑 (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` 등)
5. ModelRegistry 폴백 리졸버 (`models.yml`의 프로바이더 `apiKey`, 환경 변수명 또는 리터럴 의미론)

`models.yml` `apiKey` 동작:

- 값은 먼저 환경 변수 이름으로 처리됩니다.
- 해당하는 환경 변수가 없으면 리터럴 문자열이 토큰으로 사용됩니다.

`authHeader: true`이고 프로바이더 `apiKey`가 설정된 경우 모델에는 다음이 주입됩니다:

- `Authorization: Bearer <resolved-key>` 헤더.

키리스 프로바이더:

- `auth: none`으로 표시된 프로바이더는 자격 증명 없이 사용 가능한 것으로 처리됩니다.
- `getApiKey*`는 이들에 대해 `kNoAuth`를 반환합니다.

## 모델 가용성 vs 전체 모델

- `getAll()`은 로드된 모델 레지스트리(내장 + 병합된 커스텀 + 발견된 모델)를 반환합니다.
- `getAvailable()`은 키리스이거나 해석 가능한 인증이 있는 모델로 필터링합니다.

따라서 모델은 레지스트리에 존재할 수 있지만 인증이 가능해질 때까지 선택할 수 없습니다.

## 런타임 모델 해석

### CLI 및 패턴 파싱

`model-resolver.ts`는 다음을 지원합니다:

- 정확한 `provider/modelId`
- 정확한 정규 모델 ID
- 정확한 모델 ID (프로바이더 추론)
- 퍼지/부분 문자열 매칭
- `--models`의 글로브 범위 패턴 (예: `openai/*`, `*sonnet*`)
- 선택적 `:thinkingLevel` 접미사 (`off|minimal|low|medium|high|xhigh`)

`--provider`는 레거시입니다; `--model`이 선호됩니다.

정확한 선택자에 대한 해석 우선순위:

1. 정확한 `provider/modelId`는 통합을 우회합니다
2. 정확한 정규 ID는 정규 인덱스를 통해 해석됩니다
3. 정확한 베어 구체적 ID도 여전히 작동합니다
4. 퍼지 및 글로브 매칭은 정확한 경로 이후에 실행됩니다

### 초기 모델 선택 우선순위

`findInitialModel(...)`는 다음 순서를 사용합니다:

1. 명시적 CLI 프로바이더+모델
2. 첫 번째 범위 지정 모델 (재개하지 않는 경우)
3. 저장된 기본 프로바이더/모델
4. 사용 가능한 모델 중 알려진 프로바이더 기본값 (예: OpenAI/Anthropic 등)
5. 첫 번째 사용 가능한 모델

### 역할 별칭 및 설정

지원되는 모델 역할:

- `default`, `smol`, `slow`, `plan`, `commit`

`pi/smol`과 같은 역할 별칭은 `settings.modelRoles`를 통해 확장됩니다. 각 역할 값은 `:minimal`, `:low`, `:medium`, `:high`와 같은 사고 선택자를 추가할 수도 있습니다.

역할이 다른 역할을 가리키는 경우 대상 모델은 여전히 정상적으로 상속되며, 참조하는 역할의 명시적 접미사가 해당 역할별 사용에서 우선합니다.

관련 설정:

- `modelRoles` (레코드)
- `enabledModels` (범위 지정 패턴 목록)
- `modelProviderOrder` (전역 정규 프로바이더 우선순위)
- `providers.kimiApiFormat` (`openai` 또는 `anthropic` 요청 형식)
- `providers.openaiWebsockets` (OpenAI Codex 전송을 위한 `auto|off|on` 웹소켓 기본 설정)

`modelRoles`는 다음 중 하나를 저장할 수 있습니다:

- `provider/modelId`로 구체적 프로바이더 변형을 고정
- `gpt-5.3-codex`와 같은 정규 ID로 프로바이더 통합 허용

`enabledModels` 및 CLI `--models`의 경우:

- 정확한 정규 ID는 해당 정규 그룹의 모든 구체적 변형으로 확장됩니다
- 명시적 `provider/modelId` 항목은 정확하게 유지됩니다
- 글로브 및 퍼지 매칭은 여전히 구체적 모델에 대해 작동합니다

## `/model` 및 `--list-models`

두 인터페이스 모두 프로바이더 접두사가 붙은 모델을 표시하고 선택할 수 있게 유지합니다.

이제 정규/통합 모델도 노출합니다:

- `/model`은 프로바이더 탭과 함께 정규 뷰를 포함합니다
- `--list-models`는 정규 섹션과 구체적 프로바이더 행을 출력합니다

정규 항목을 선택하면 정규 선택자가 저장됩니다. 프로바이더 행을 선택하면 명시적 `provider/modelId`가 저장됩니다.

## 컨텍스트 프로모션 (모델 수준 폴백 체인)

컨텍스트 프로모션은 API가 컨텍스트 길이 오류로 요청을 거부할 때 자동으로 더 큰 컨텍스트의 형제 모델로 승격시키는 소규모 컨텍스트 변형(예: `*-spark`)에 대한 오버플로 복구 메커니즘입니다.

### 트리거 및 순서

턴이 컨텍스트 오버플로 오류(예: `context_length_exceeded`)로 실패하면, `AgentSession`은 압축으로 폴백하기 **전에** 프로모션을 시도합니다:

1. `contextPromotion.enabled`가 true이면 프로모션 대상을 해석합니다 (아래 참조).
2. 대상이 발견되면 해당 모델로 전환하고 요청을 재시도합니다 — 압축이 필요하지 않습니다.
3. 사용 가능한 대상이 없으면 현재 모델에서 자동 압축으로 넘어갑니다.

### 대상 선택

선택은 역할 기반이 아닌 모델 기반입니다:

1. `currentModel.contextPromotionTarget` (설정된 경우)
2. 동일 프로바이더 + API에서 가장 작은 더 큰 컨텍스트 모델

자격 증명이 해석되지 않는 후보(`ModelRegistry.getApiKey(...)`)는 무시됩니다.

### OpenAI Codex 웹소켓 핸드오프

`openai-codex-responses`에서/으로 전환할 때, 세션 프로바이더 상태 키 `openai-codex-responses`는 모델 전환 전에 닫힙니다. 이렇게 하면 웹소켓 전송 상태가 삭제되어 다음 턴이 승격된 모델에서 깨끗하게 시작됩니다.

### 지속성 동작

프로모션은 임시 전환(`setModelTemporary`)을 사용합니다:

- 세션 히스토리에 임시 `model_change`로 기록됩니다
- 저장된 역할 매핑을 재작성하지 않습니다

### 명시적 폴백 체인 설정

`contextPromotionTarget`을 통해 모델 메타데이터에서 직접 폴백을 설정합니다.

`contextPromotionTarget`은 다음 중 하나를 받습니다:

- `provider/model-id` (명시적)
- `model-id` (현재 프로바이더 내에서 해석)

동일 프로바이더에서 Spark -> non-Spark 전환 예시 (`models.yml`):

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

내장 모델 생성기는 동일 프로바이더에 기본 모델이 존재할 때 `*-spark` 모델에 대해 이를 자동으로 할당합니다.

## 호환성 및 라우팅 필드

`models.yml`은 다음 `compat` 하위 집합을 지원합니다:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` 또는 `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

이들은 OpenAI-completions 전송 로직에서 소비되며 URL 기반 자동 감지와 결합됩니다.

## 실용적인 예시

### 로컬 OpenAI 호환 엔드포인트 (인증 없음)

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

### 환경 변수 기반 키를 사용하는 호스팅 프록시

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

### 내장 프로바이더 라우트 + 모델 메타데이터 오버라이드

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

## LiteLLM 프록시 자동 설정

`LITELLM_BASE_URL`과 `LITELLM_API_KEY` 환경 변수가 모두 설정되어 있으면, xcsh는 LiteLLM 프록시에 대한 `models.yml` 설정을 자동으로 관리합니다.

### 최초 실행 자동 생성

`models.yml`이 존재하지 않고 LiteLLM 환경 변수가 감지되면, xcsh가 자동으로 생성합니다:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

합리적인 이미지 프로바이더 설정과 함께 기본 `config.yml`도 생성됩니다.

### 시작 시 자가 복구

매 시작 시 모델 레지스트리의 `startupHealthCheck()`는 다음 검사를 실행합니다:

| 조건 | 동작 |
|-----------|--------|
| `models.yml` 누락 | 환경 변수에서 자동 생성 |
| `models.yml` 손상 또는 파싱 불가 | `.bak`으로 백업 후 재생성 |
| `baseUrl`이 `LITELLM_BASE_URL`과 일치하지 않음 | `.bak`으로 백업 후 새 URL로 재생성 |
| `configVersion` 누락 또는 오래됨 | `.bak`으로 백업 후 현재 버전으로 재생성 |
| 설정이 정상 | 동작 없음 |

모든 수리는 덮어쓰기 전에 `.bak` 백업을 생성합니다. 모든 작업은 멱등적입니다.

### CLI 명령어

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### 필수 환경 변수

| 변수 | 목적 |
|----------|---------|
| `LITELLM_BASE_URL` | LiteLLM 프록시 URL (예: `https://your-proxy.example.com`). `http://` 또는 `https://`로 시작해야 합니다. |
| `LITELLM_API_KEY` | 프록시용 API 키. 생성된 설정에서 이름으로 참조되며 런타임에 해석됩니다. |

둘 중 하나라도 설정되지 않으면 자동 설정은 자동으로 건너뜁니다.

### 설정 버전 관리

생성된 설정에는 `configVersion` 필드가 포함됩니다. 향후 릴리스에서 생성 형식이 변경되면, xcsh는 오래된 설정을 감지하고 자동으로 업그레이드합니다 (백업 포함).

## 레거시 소비자 주의사항

대부분의 모델 설정은 이제 `ModelRegistry`를 통해 `models.yml`로 흐릅니다.

주목할 만한 레거시 경로가 하나 남아 있습니다: 웹 검색 Anthropic 인증 해석은 여전히 `src/web/search/auth.ts`에서 `~/.xcsh/agent/models.json`을 직접 읽습니다.

해당 특정 경로에 의존하는 경우 해당 모듈이 마이그레이션될 때까지 JSON 호환성을 유지하십시오.

## 실패 모드

`models.yml`이 스키마 또는 유효성 검사에 실패하는 경우:

- `LITELLM_BASE_URL`과 `LITELLM_API_KEY`가 설정되어 있으면 시작 상태 검사가 자동 수리를 시도합니다 (손상된 파일을 백업하고 환경 변수에서 재생성). 수리가 성공하면 레지스트리가 수정된 설정을 다시 로드합니다.
- 자동 수리가 불가능한 경우 (환경 변수 미설정, 쓰기 실패) 레지스트리는 내장 모델로 계속 작동합니다.
- 오류는 `ModelRegistry.getError()`를 통해 노출되며 UI/알림에 표시됩니다.
