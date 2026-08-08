---
title: 모델 및 제공자(Provider) 구성
description: 라우팅, 폴백(fallback), 가격 책정 기능이 포함된 models.yml을 통한 모델 레지스트리 및 제공자(provider) 구성입니다.
sidebar:
  order: 1
  label: 모델 및 제공자
i18n:
  sourceHash: "8053df967ff6"
  translator: "machine"
---

# 모델 및 제공자 구성 (`models.yml`)

이 문서는 코딩 에이전트가 현재 모델을 로드하고, 재정의(override)를 적용하며, 자격 증명(credentials)을 확인하고, 런타임에 모델을 선택하는 방법을 설명합니다.

## 모델 동작을 제어하는 요소

주요 구현 파일:

- `src/config/model-registry.ts` — 내장(built-in) + 사용자 지정(custom) 모델, 제공자 재정의, 런타임 검색, 인증 통합을 로드합니다.
- `src/config/model-resolver.ts` — 모델 패턴을 구문 분석하고 initial/smol/slow 모델을 선택합니다.
- `src/config/settings-schema.ts` — 모델 관련 설정 (`modelRoles`, 제공자 전송 환경설정)
- `src/session/auth-storage.ts` — API 키 + OAuth 확인 순서
- `packages/ai/src/models.ts` 및 `packages/ai/src/types.ts` — 내장 제공자/모델 및 `Model`/`compat` 유형

## 설정 파일 위치 및 레거시 동작

기본 설정 경로:

- `~/.xcsh/agent/models.yml`

여전히 존재하는 레거시 동작:

- `models.yml`이 누락되었고 같은 위치에 `models.json`이 있는 경우, `models.yml`로 마이그레이션됩니다.
- 프로그래밍 방식으로 `ModelRegistry`에 전달될 때 명시적인 `.json` / `.jsonc` 설정 경로는 여전히 지원됩니다.

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

`configVersion`은 자동 구성(auto-config) 시스템에서 작성하는 선택적 정수입니다. 이 값이 존재하면, xcsh는 이를 사용하여 오래된 설정을 감지하고 자동으로 업그레이드합니다.

`provider-id`는 선택 및 인증 조회 전체에서 사용되는 정식(canonical) 제공자 키입니다.

`equivalence`는 선택 사항이며 구체적인(concrete) 제공자 모델 위에 정식 모델 그룹화를 구성합니다:

- `overrides`는 정확한 구체적인 선택자(`provider/modelId`)를 공식 업스트림 정식 ID에 매핑합니다.
- `exclude`는 구체적인 선택자를 정식 그룹화에서 제외(opt out)합니다.

## 제공자 수준(Provider-level) 필드

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

### 허용되는 제공자/모델 `api` 값

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### 허용되는 인증(auth)/검색(discovery) 값

- `auth`: `apiKey` (기본값) 또는 `none`
- `discovery.type`: `ollama`

## 유효성 검사 규칙 (현재)

### 전체 사용자 지정 제공자 (`models`가 비어 있지 않음)

필수:

- `baseUrl`
- `auth: none`이 아닌 경우 `apiKey`
- 제공자 수준 또는 각 모델의 `api`

### 재정의 전용 제공자 (`models`가 누락되었거나 비어 있음)

다음 중 하나 이상을 정의해야 합니다:

- `baseUrl`
- `modelOverrides`
- `discovery`

### 검색 (Discovery)

- `discovery`는 제공자 수준의 `api`가 필요합니다.

### 모델 값 검사

- `id` 필수
- 제공된 경우 `contextWindow` 및 `maxTokens`는 양수여야 합니다.

## 병합 및 재정의 순서

ModelRegistry 파이프라인 (새로 고침 시):

1. `@f5-sales-demo/pi-ai`에서 내장 제공자/모델을 로드합니다.
2. `models.yml` 사용자 지정 구성을 로드합니다.
3. 제공자 재정의(`baseUrl`, `headers`)를 내장 모델에 적용합니다.
4. `modelOverrides` (제공자 + 모델 id별)를 적용합니다.
5. 사용자 지정 `models`를 병합합니다:
   - 동일한 `provider + id`는 기존 모델을 대체합니다.
   - 그렇지 않으면 추가(append)합니다.
6. 런타임에 검색된 모델(현재 Ollama 및 LM Studio)을 적용한 다음, 모델 재정의를 다시 적용합니다.

## 정식 모델 동등성(equivalence) 및 병합(coalescing)

레지스트리는 모든 구체적인 제공자 모델을 유지한 다음, 그 위에 정식 레이어를 구축합니다.

정식 ID는 다음과 같은 공식 업스트림 ID입니다:

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### `models.yml` 동등성 구성

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

정식 그룹화를 위한 빌드 순서:

1. `equivalence.overrides`의 정확한 사용자 재정의
2. 내장 모델 메타데이터의 번들 공식 ID 일치 항목
3. 게이트웨이/제공자 변형(variants)에 대한 보수적 휴리스틱(heuristic) 정규화
4. 구체적인 모델 자체의 ID로 폴백(fallback)

현재 휴리스틱은 의도적으로 좁게 설정되어 있습니다:

- 내장된 업스트림 접두사(예: `anthropic/...` 또는 `openai/...`)가 존재하는 경우 제거할 수 있습니다.
- 점(.)과 대시(-) 버전 변형은 기존 공식 ID에 매핑되는 경우에만 정규화할 수 있습니다(예: `4.6 -> 4-6`).
- 모호한 제품군 또는 버전은 번들 일치 항목이나 명시적 재정의 없이는 병합되지 않습니다.

### 정식 확인(resolution) 동작

여러 구체적인 변형이 동일한 정식 ID를 공유하는 경우, 확인 시 다음을 사용합니다:

1. 가용성 및 인증
2. `config.yml`의 `modelProviderOrder`
3. `modelProviderOrder`가 설정되지 않은 경우 기존 레지스트리/제공자 순서

비활성화되거나 인증되지 않은 제공자는 건너뜁니다.

세션 상태 및 트랜스크립트는 턴을 실제로 실행한 구체적인 제공자/모델을 계속 기록합니다.

제공자 기본값 vs 모델별 재정의:

- 제공자 `headers`가 기준이 됩니다.
- 모델 `headers`는 제공자 헤더 키를 재정의합니다.
- `modelOverrides`는 모델 메타데이터(`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`)를 재정의할 수 있습니다.
- 중첩된 라우팅 블록(`openRouterRouting`, `vercelGatewayRouting`, `extraBody`)에 대해 `compat`가 딥 머지(deep-merge)됩니다.

## 런타임 검색 통합

### 암시적 Ollama 검색

`ollama`가 명시적으로 구성되지 않은 경우, 레지스트리는 암시적으로 검색 가능한 제공자를 추가합니다:

- 제공자: `ollama`
- api: `openai-completions`
- 기본 URL: `OLLAMA_BASE_URL` 또는 `http://127.0.0.1:11434`
- 인증 모드: 키리스(keyless) (`auth: none` 동작)

런타임 검색은 Ollama에서 `GET /api/tags`를 호출하고 로컬 기본값을 사용하여 모델 항목을 합성합니다.

### 암시적 llama.cpp 검색

`llama.cpp`가 명시적으로 구성되지 않은 경우, 레지스트리는 암시적으로 검색 가능한 제공자를 추가합니다:
참고: openai-competions 대신 최신 antropic messages API를 사용합니다.

- 제공자: `llama.cpp`
- api: `openai-responses`
- 기본 URL: `LLAMA_CPP_BASE_URL` 또는 `http://127.0.0.1:8080`
- 인증 모드: 키리스(keyless) (`auth: none` 동작)

런타임 검색은 llama.cpp에서 `GET models`를 호출하고 로컬 기본값을 사용하여 모델 항목을 합성합니다.

### 암시적 LM Studio 검색

`lm-studio`가 명시적으로 구성되지 않은 경우, 레지스트리는 암시적으로 검색 가능한 제공자를 추가합니다:

- 제공자: `lm-studio`
- api: `openai-completions`
- 기본 URL: `LM_STUDIO_BASE_URL` 또는 `http://127.0.0.1:1234/v1`
- 인증 모드: 키리스(keyless) (`auth: none` 동작)

런타임 검색은 모델을 가져오고(`GET /models`) 로컬 기본값을 사용하여 모델 항목을 합성합니다.

### 명시적 제공자 검색

직접 검색을 구성할 수 있습니다:

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

### 확장 프로그램 제공자 등록

확장 프로그램은 런타임에 제공자를 등록(`pi.registerProvider(...)`)할 수 있으며, 여기에는 다음이 포함됩니다:

- 제공자에 대한 모델 교체/추가
- 새로운 API ID를 위한 사용자 지정 스트림 핸들러 등록
- 사용자 지정 OAuth 제공자 등록

## 인증 및 API 키 확인 순서

제공자의 키를 요청할 때, 유효한 순서는 다음과 같습니다:

1. 런타임 재정의 (CLI `--api-key`)
2. `agent.db`에 저장된 API 키 자격 증명
3. `agent.db`에 저장된 OAuth 자격 증명 (새로 고침 포함)
4. 환경 변수 매핑 (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` 등)
5. ModelRegistry 폴백 리졸버 (`models.yml`의 제공자 `apiKey`, env-name-or-literal 시맨틱)

`models.yml` `apiKey` 동작:

- 값은 먼저 환경 변수 이름으로 처리됩니다.
- 환경 변수가 존재하지 않으면, 리터럴 문자열이 토큰으로 사용됩니다.

`authHeader: true`이고 제공자 `apiKey`가 설정된 경우, 모델은 다음을 가져옵니다:

- `Authorization: Bearer <resolved-key>` 헤더가 주입됩니다.

키리스(Keyless) 제공자:

- `auth: none`으로 표시된 제공자는 자격 증명 없이 사용할 수 있는 것으로 간주됩니다.
- `getApiKey*`는 이에 대해 `kNoAuth`를 반환합니다.

## 모델 가용성 vs 전체 모델

- `getAll()`은 로드된 모델 레지스트리(내장 + 병합된 사용자 지정 + 검색됨)를 반환합니다.
- `getAvailable()`은 키리스이거나 확인 가능한 인증이 있는 모델로 필터링합니다.

따라서 모델이 레지스트리에는 존재하지만 인증이 제공될 때까지 선택할 수 없을 수 있습니다.

## 런타임 모델 확인(resolution)

### CLI 및 패턴 구문 분석

`model-resolver.ts`는 다음을 지원합니다:

- 정확한 `provider/modelId`
- 정확한 정식(canonical) 모델 id
- 정확한 모델 id (제공자 유추됨)
- 퍼지(fuzzy)/부분 문자열(substring) 일치
- `--models`의 글로브(glob) 범위 패턴 (예: `openai/*`, `*sonnet*`)
- 선택적 `:thinkingLevel` 접미사 (`off|minimal|low|medium|high|xhigh`)

`--provider`는 레거시입니다; `--model`이 선호됩니다.

정확한 선택자의 확인 우선순위:

1. 정확한 `provider/modelId`는 병합(coalescing)을 우회합니다.
2. 정확한 정식 ID는 정식 인덱스를 통해 확인됩니다.
3. 정확한 기본(bare) 구체적 ID는 여전히 작동합니다.
4. 퍼지 및 글로브 일치는 정확한 경로 이후에 실행됩니다.

### 초기 모델 선택 우선순위

`findInitialModel(...)`은 다음 순서를 사용합니다:

1. 명시적 CLI 제공자+모델
2. 첫 번째 범위가 지정된 모델 (재개되지 않는 경우)
3. 저장된 기본 제공자/모델
4. 가용한 모델 중 알려진 제공자 기본값 (예: OpenAI/Anthropic/등)
5. 첫 번째 사용 가능한 모델

### 역할 별칭(Role aliases) 및 설정

지원되는 모델 역할:

- `default`, `smol`, `slow`, `plan`, `commit`

`pi/smol`과 같은 역할 별칭은 `settings.modelRoles`를 통해 확장됩니다. 각 역할 값에는 `:minimal`, `:low`, `:medium` 또는 `:high`와 같은 사고 수준(thinking) 선택자를 추가할 수도 있습니다.

역할이 다른 역할을 가리키는 경우, 대상 모델은 여전히 정상적으로 상속되며 참조하는 역할의 명시적 접미사가 해당 역할별 사용에 적용됩니다.

관련 설정:

- `modelRoles` (record)
- `enabledModels` (범위가 지정된 패턴 목록)
- `modelProviderOrder` (글로벌 정식 제공자 우선순위)
- `providers.kimiApiFormat` (`openai` 또는 `anthropic` 요청 형식)
- `providers.openaiWebsockets` (OpenAI Codex 전송에 대한 `auto|off|on` 웹소켓 환경설정)

`modelRoles`는 다음 중 하나를 저장할 수 있습니다:

- 구체적인 제공자 변형을 고정(pin)하기 위한 `provider/modelId`
- 제공자 병합을 허용하기 위한 `gpt-5.3-codex`와 같은 정식 ID

`enabledModels` 및 CLI `--models`의 경우:

- 정확한 정식 ID는 해당 정식 그룹의 모든 구체적인 변형으로 확장됩니다.
- 명시적인 `provider/modelId` 항목은 정확하게 유지됩니다.
- 글로브 및 퍼지 일치는 여전히 구체적인 모델에서 작동합니다.

## `/model` 및 `--list-models`

두 방식 모두 제공자가 접두사로 붙은 모델을 표시하고 선택할 수 있도록 유지합니다.

이제 정식/병합된 모델도 표시합니다:

- `/model`은 제공자 탭 옆에 정식 보기를 포함합니다.
- `--list-models`는 구체적인 제공자 행과 함께 정식 섹션을 인쇄합니다.

정식 항목을 선택하면 정식 선택자가 저장됩니다. 제공자 행을 선택하면 명시적인 `provider/modelId`가 저장됩니다.

## 컨텍스트 승격 (모델 수준 폴백 체인)

컨텍스트 승격(Context promotion)은 API가 컨텍스트 길이 오류로 요청을 거부할 때 컨텍스트가 더 큰 형제(sibling) 모델로 자동 승격하는 작은 컨텍스트 변형(예: `*-spark`)을 위한 오버플로 복구 메커니즘입니다.

### 트리거 및 순서

컨텍스트 오버플로 오류(예: `context_length_exceeded`)로 인해 턴이 실패할 때, `AgentSession`은 자동 압축(auto-compaction)으로 폴백하기 **전에** 승격을 시도합니다:

1. `contextPromotion.enabled`가 true인 경우, 승격 대상을 확인합니다(아래 참조).
2. 대상을 찾으면 해당 대상으로 전환하고 요청을 재시도합니다. (압축 불필요)
3. 사용 가능한 대상이 없으면 현재 모델의 자동 압축으로 넘어갑니다.

### 대상 선택

선택은 역할(role) 기반이 아니라 모델(model) 기반입니다:

1. `currentModel.contextPromotionTarget` (구성된 경우)
2. 동일한 제공자 + API에서 컨텍스트가 더 큰 모델 중 가장 작은 모델

자격 증명이 확인될 때까지(`ModelRegistry.getApiKey(...)`) 후보는 무시됩니다.

### OpenAI Codex 웹소켓 핸드오프

`openai-codex-responses`에서/로 전환하는 경우, 모델 전환 전에 세션 제공자 상태 키 `openai-codex-responses`가 닫힙니다. 이것은 웹소켓 전송 상태를 삭제하여 다음 턴이 승격된 모델에서 깨끗하게 시작되도록 합니다.

### 지속성(Persistence) 동작

승격은 임시 전환을 사용합니다 (`setModelTemporary`):

- 세션 히스토리에 임시 `model_change`로 기록됩니다.
- 저장된 역할 매핑을 덮어쓰지 않습니다.

### 명시적 폴백 체인 구성

`contextPromotionTarget`을 통해 모델 메타데이터에서 직접 폴백을 구성하십시오.

`contextPromotionTarget`은 다음 중 하나를 허용합니다:

- `provider/model-id` (명시적)
- `model-id` (현재 제공자 내에서 확인됨)

동일한 제공자에서의 Spark -> non-Spark 예시 (`models.yml`):

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

내장 모델 생성기는 동일한 제공자 기본 모델이 존재할 때 `*-spark` 모델에 대해서도 이를 자동으로 할당합니다.

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

### 환경 기반 키를 사용하는 호스팅 프록시

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

### 내장 제공자 경로 + 모델 메타데이터 재정의

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

## LiteLLM 프록시 자동 구성

`LITELLM_BASE_URL` 및 `LITELLM_API_KEY` 환경 변수가 모두 설정된 경우, xcsh는 LiteLLM 프록시에 대한 `models.yml` 구성을 자동으로 관리합니다.

### 첫 실행 자동 생성

`models.yml`이 존재하지 않고 LiteLLM 환경 변수가 감지되면, xcsh가 이를 자동으로 생성합니다:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

합리적인 이미지 제공자 설정이 포함된 기본 `config.yml`도 생성됩니다.

### 시작 자가 복구 (Self-healing)

시작할 때마다 모델 레지스트리의 `startupHealthCheck()`는 다음 검사를 실행합니다:

| 조건 | 조치 |
|-----------|--------|
| `models.yml` 누락됨 | 환경 변수에서 자동 생성 |
| `models.yml` 손상되거나 구문 분석할 수 없음 | `.bak`로 백업, 재생성 |
| `baseUrl`이 `LITELLM_BASE_URL`과 일치하지 않음 | `.bak`로 백업, 새 URL로 재생성 |
| `configVersion` 누락되거나 구식임 | `.bak`로 백업, 현재 버전으로 재생성 |
| 구성이 정상임 | 조치 없음 |

모든 복구 작업은 덮어쓰기 전에 `.bak` 백업을 생성합니다. 모든 작업은 멱등성(idempotent)을 가집니다.

### CLI 명령

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### 필수 환경 변수

| 변수 | 목적 |
|----------|---------|
| `LITELLM_BASE_URL` | LiteLLM 프록시 URL (예: `https://your-proxy.example.com`). 반드시 `http://` 또는 `https://`로 시작해야 합니다. |
| `LITELLM_API_KEY` | 프록시용 API 키. 생성된 구성에서 이름으로 참조되며, 런타임에 확인됩니다. |

두 변수 중 하나라도 설정되지 않은 경우 자동 구성은 조용히 건너뜁니다.

### 구성 버전 관리(Versioning)

생성된 구성에는 `configVersion` 필드가 포함됩니다. 향후 릴리스에서 생성된 형식이 변경되면, xcsh는 오래된 구성을 감지하고 자동으로(백업과 함께) 업그레이드합니다.

## 레거시 소비자(consumer) 주의 사항

현재 대부분의 모델 구성은 `ModelRegistry`를 통해 `models.yml`을 거쳐 흐릅니다.

한 가지 주목할 만한 레거시 경로가 남아 있습니다: 웹 검색 Anthropic 인증 확인은 여전히 `src/web/search/auth.ts`에서 직접 `~/.xcsh/agent/models.json`을 읽습니다.

해당 특정 경로에 의존하는 경우, 해당 모듈이 마이그레이션될 때까지 JSON 호환성을 염두에 두십시오.

## 실패 모드

`models.yml`이 스키마 또는 유효성 검사에 실패하는 경우:

- `LITELLM_BASE_URL` 및 `LITELLM_API_KEY`가 설정된 경우, 시작 상태 점검은 자동 복구(손상된 파일 백업, 환경 변수에서 재생성)를 시도합니다. 복구가 성공하면 레지스트리는 수정된 구성을 다시 로드합니다.
- 자동 복구가 불가능한 경우(환경 변수 미설정, 쓰기 실패), 레지스트리는 내장 모델을 사용하여 계속 작동합니다.
- 오류는 `ModelRegistry.getError()`를 통해 노출되며 UI/알림에 나타납니다.
