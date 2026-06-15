---
title: 모델 및 프로바이더 구성
description: '라우팅, 폴백 및 가격 책정을 포함한 models.yml을 통한 모델 레지스트리 및 프로바이더 구성.'
sidebar:
  order: 1
  label: 모델 및 프로바이더
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# 모델 및 프로바이더 구성 (`models.yml`)

이 문서는 코딩 에이전트가 현재 모델을 로드하고, 재정의를 적용하며, 자격 증명을 확인하고, 런타임에 모델을 선택하는 방법을 설명합니다.

## 모델 동작을 제어하는 요소

주요 구현 파일:

- `src/config/model-registry.ts` — 내장 + 커스텀 모델, 프로바이더 재정의, 런타임 검색, 인증 통합 로드
- `src/config/model-resolver.ts` — 모델 패턴 파싱 및 초기/smol/slow 모델 선택
- `src/config/settings-schema.ts` — 모델 관련 설정 (`modelRoles`, 프로바이더 전송 기본값)
- `src/session/auth-storage.ts` — API 키 + OAuth 확인 순서
- `packages/ai/src/models.ts` 및 `packages/ai/src/types.ts` — 내장 프로바이더/모델 및 `Model`/`compat` 타입

## 구성 파일 위치 및 레거시 동작

기본 구성 경로:

- `~/.xcsh/agent/models.yml`

여전히 존재하는 레거시 동작:

- `models.yml`이 없고 동일한 위치에 `models.json`이 존재하는 경우, `models.yml`로 마이그레이션됩니다.
- 명시적인 `.json` / `.jsonc` 구성 경로는 `ModelRegistry`에 프로그래밍 방식으로 전달될 때 여전히 지원됩니다.

## `models.yml` 구조

```yaml
configVersion: 1  # 선택 사항 — 자동 구성에 의해 작성되며 마이그레이션 감지에 사용됨
providers:
  <provider-id>:
    # 프로바이더 수준 구성
equivalence:
  overrides:
    <provider-id>/<model-id>: <canonical-model-id>
  exclude:
    - <provider-id>/<model-id>
```

`configVersion`은 자동 구성 시스템에 의해 작성되는 선택적 정수입니다. 존재하는 경우 xcsh는 이를 사용하여 오래된 구성을 감지하고 자동으로 업그레이드합니다.

`provider-id`는 선택 및 인증 조회 전반에 걸쳐 사용되는 정규 프로바이더 키입니다.

`equivalence`는 선택 사항이며 구체적인 프로바이더 모델 위에 정규 모델 그룹화를 구성합니다:

- `overrides`는 정확한 구체적 선택자(`provider/modelId`)를 공식 업스트림 정규 ID에 매핑합니다.
- `exclude`는 구체적 선택자를 정규 그룹화에서 제외합니다.

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

### 완전한 커스텀 프로바이더 (`models`가 비어 있지 않은 경우)

필수 항목:

- `baseUrl`
- `auth: none`이 아닌 경우 `apiKey`
- 프로바이더 수준 또는 각 모델의 `api`

### 재정의 전용 프로바이더 (`models`가 없거나 비어 있는 경우)

다음 중 하나 이상을 정의해야 합니다:

- `baseUrl`
- `modelOverrides`
- `discovery`

### 검색

- `discovery`는 프로바이더 수준 `api`를 필요로 합니다.

### 모델 값 검사

- `id` 필수
- 제공된 경우 `contextWindow` 및 `maxTokens`는 양수여야 합니다.

## 병합 및 재정의 순서

ModelRegistry 파이프라인 (새로 고침 시):

1. `@f5xc-salesdemos/pi-ai`에서 내장 프로바이더/모델 로드.
2. `models.yml` 커스텀 구성 로드.
3. 내장 모델에 프로바이더 재정의 적용 (`baseUrl`, `headers`).
4. `modelOverrides` 적용 (프로바이더 + 모델 ID 기준).
5. 커스텀 `models` 병합:
   - 동일한 `provider + id`는 기존 항목을 대체
   - 그렇지 않으면 추가
6. 런타임 검색된 모델 적용 (현재 Ollama 및 LM Studio), 이후 모델 재정의 재적용.

## 정규 모델 동등성 및 통합

레지스트리는 모든 구체적인 프로바이더 모델을 유지하고 그 위에 정규 계층을 구성합니다.

정규 ID는 공식 업스트림 ID만 사용합니다. 예를 들어:

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

정규 그룹화를 위한 빌드 순서:

1. `equivalence.overrides`의 정확한 사용자 재정의
2. 내장 모델 메타데이터의 번들된 공식 ID 일치
3. 게이트웨이/프로바이더 변형에 대한 보수적인 휴리스틱 정규화
4. 구체적인 모델 자체 ID로 폴백

현재 휴리스틱은 의도적으로 좁게 설정되어 있습니다:

- 내장된 업스트림 접두사는 존재하는 경우 제거될 수 있습니다. 예: `anthropic/...` 또는 `openai/...`
- 점 및 대시로 구분된 버전 변형은 기존 공식 ID에 매핑되는 경우에만 정규화될 수 있습니다. 예: `4.6 -> 4-6`
- 번들된 일치 또는 명시적 재정의 없이는 모호한 계열 또는 버전이 병합되지 않습니다.

### 정규 확인 동작

여러 구체적인 변형이 정규 ID를 공유하는 경우, 확인은 다음을 사용합니다:

1. 가용성 및 인증
2. `config.yml` `modelProviderOrder`
3. `modelProviderOrder`가 설정되지 않은 경우 기존 레지스트리/프로바이더 순서

비활성화되거나 인증되지 않은 프로바이더는 건너뜁니다.

세션 상태 및 트랜스크립트는 실제로 해당 턴을 실행한 구체적인 프로바이더/모델을 계속 기록합니다.

프로바이더 기본값 대 모델별 재정의:

- 프로바이더 `headers`는 기준값입니다.
- 모델 `headers`는 프로바이더 헤더 키를 재정의합니다.
- `modelOverrides`는 모델 메타데이터 (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`)를 재정의할 수 있습니다.
- `compat`은 중첩된 라우팅 블록 (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`)에 대해 깊은 병합됩니다.

## 런타임 검색 통합

### 암시적 Ollama 검색

`ollama`가 명시적으로 구성되지 않은 경우, 레지스트리는 암시적으로 검색 가능한 프로바이더를 추가합니다:

- 프로바이더: `ollama`
- api: `openai-completions`
- 기본 URL: `OLLAMA_BASE_URL` 또는 `http://127.0.0.1:11434`
- 인증 모드: 키 없음 (`auth: none` 동작)

런타임 검색은 Ollama에서 `GET /api/tags`를 호출하고 로컬 기본값으로 모델 항목을 합성합니다.

### 암시적 llama.cpp 검색

`llama.cpp`가 명시적으로 구성되지 않은 경우, 레지스트리는 암시적으로 검색 가능한 프로바이더를 추가합니다:
참고: openai-completions 대신 최신 anthropic messages API를 사용합니다.

- 프로바이더: `llama.cpp`
- api: `openai-responses`
- 기본 URL: `LLAMA_CPP_BASE_URL` 또는 `http://127.0.0.1:8080`
- 인증 모드: 키 없음 (`auth: none` 동작)

런타임 검색은 llama.cpp에서 `GET models`를 호출하고 로컬 기본값으로 모델 항목을 합성합니다.

### 암시적 LM Studio 검색

`lm-studio`가 명시적으로 구성되지 않은 경우, 레지스트리는 암시적으로 검색 가능한 프로바이더를 추가합니다:

- 프로바이더: `lm-studio`
- api: `openai-completions`
- 기본 URL: `LM_STUDIO_BASE_URL` 또는 `http://127.0.0.1:1234/v1`
- 인증 모드: 키 없음 (`auth: none` 동작)

런타임 검색은 모델을 가져오고 (`GET /models`) 로컬 기본값으로 모델 항목을 합성합니다.

### 명시적 프로바이더 검색

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

### 확장 프로바이더 등록

확장 기능은 런타임에 프로바이더를 등록할 수 있습니다 (`pi.registerProvider(...)`). 다음을 포함합니다:

- 프로바이더에 대한 모델 교체/추가
- 새로운 API ID에 대한 커스텀 스트림 핸들러 등록
- 커스텀 OAuth 프로바이더 등록

## 인증 및 API 키 확인 순서

프로바이더에 대한 키를 요청할 때의 유효 순서:

1. 런타임 재정의 (CLI `--api-key`)
2. `agent.db`에 저장된 API 키 자격 증명
3. `agent.db`에 저장된 OAuth 자격 증명 (새로 고침 포함)
4. 환경 변수 매핑 (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` 등)
5. ModelRegistry 폴백 확인자 (`models.yml`의 프로바이더 `apiKey`, env-name-or-literal 의미론)

`models.yml` `apiKey` 동작:

- 값은 먼저 환경 변수 이름으로 처리됩니다.
- 환경 변수가 없으면 리터럴 문자열이 토큰으로 사용됩니다.

`authHeader: true`이고 프로바이더 `apiKey`가 설정된 경우, 모델은 다음을 받습니다:

- `Authorization: Bearer <resolved-key>` 헤더 주입.

키 없는 프로바이더:

- `auth: none`으로 표시된 프로바이더는 자격 증명 없이 사용 가능한 것으로 처리됩니다.
- `getApiKey*`는 해당 프로바이더에 대해 `kNoAuth`를 반환합니다.

## 모델 가용성 대 전체 모델

- `getAll()`은 로드된 모델 레지스트리(내장 + 병합된 커스텀 + 검색된 모델)를 반환합니다.
- `getAvailable()`은 키 없는 모델이나 확인 가능한 인증이 있는 모델로 필터링합니다.

따라서 모델은 레지스트리에 존재하더라도 인증이 가능해질 때까지 선택할 수 없습니다.

## 런타임 모델 확인

### CLI 및 패턴 파싱

`model-resolver.ts`는 다음을 지원합니다:

- 정확한 `provider/modelId`
- 정확한 정규 모델 ID
- 정확한 모델 ID (프로바이더 추론)
- 퍼지/부분 문자열 매칭
- `--models`의 glob 범위 패턴 (예: `openai/*`, `*sonnet*`)
- 선택적 `:thinkingLevel` 접미사 (`off|minimal|low|medium|high|xhigh`)

`--provider`는 레거시입니다; `--model`이 권장됩니다.

정확한 선택자에 대한 확인 우선순위:

1. 정확한 `provider/modelId`는 통합을 건너뜁니다.
2. 정확한 정규 ID는 정규 인덱스를 통해 확인됩니다.
3. 정확한 bare 구체적 ID도 동작합니다.
4. 퍼지 및 glob 매칭은 정확한 경로 이후에 실행됩니다.

### 초기 모델 선택 우선순위

`findInitialModel(...)`은 다음 순서를 사용합니다:

1. 명시적인 CLI 프로바이더+모델
2. 첫 번째 범위 모델 (재개하지 않는 경우)
3. 저장된 기본 프로바이더/모델
4. 사용 가능한 모델 중 알려진 프로바이더 기본값 (예: OpenAI/Anthropic 등)
5. 첫 번째 사용 가능한 모델

### 역할 별칭 및 설정

지원되는 모델 역할:

- `default`, `smol`, `slow`, `plan`, `commit`

`pi/smol`과 같은 역할 별칭은 `settings.modelRoles`를 통해 확장됩니다. 각 역할 값은 `:minimal`, `:low`, `:medium`, `:high`와 같은 thinking 선택자를 추가할 수 있습니다.

역할이 다른 역할을 가리키는 경우, 대상 모델은 여전히 정상적으로 상속되며 참조 역할의 명시적 접미사는 해당 역할별 사용에 우선합니다.

관련 설정:

- `modelRoles` (레코드)
- `enabledModels` (범위 패턴 목록)
- `modelProviderOrder` (전역 정규-프로바이더 우선순위)
- `providers.kimiApiFormat` (`openai` 또는 `anthropic` 요청 형식)
- `providers.openaiWebsockets` (OpenAI Codex 전송을 위한 `auto|off|on` 웹소켓 기본값)

`modelRoles`는 다음 중 하나를 저장할 수 있습니다:

- 구체적인 프로바이더 변형을 고정하기 위한 `provider/modelId`
- 프로바이더 통합을 허용하는 `gpt-5.3-codex`와 같은 정규 ID

`enabledModels` 및 CLI `--models`의 경우:

- 정확한 정규 ID는 해당 정규 그룹의 모든 구체적인 변형으로 확장됩니다.
- 명시적인 `provider/modelId` 항목은 정확하게 유지됩니다.
- glob 및 퍼지 매칭은 여전히 구체적인 모델에서 동작합니다.

## `/model` 및 `--list-models`

두 인터페이스 모두 프로바이더 접두사가 붙은 모델을 표시하고 선택할 수 있도록 유지합니다.

이제 정규/통합된 모델도 노출합니다:

- `/model`은 프로바이더 탭과 함께 정규 뷰를 포함합니다.
- `--list-models`는 정규 섹션과 구체적인 프로바이더 행을 출력합니다.

정규 항목을 선택하면 정규 선택자가 저장됩니다. 프로바이더 행을 선택하면 명시적인 `provider/modelId`가 저장됩니다.

## 컨텍스트 승격 (모델 수준 폴백 체인)

컨텍스트 승격은 소규모 컨텍스트 변형 (예: `*-spark`)에 대한 오버플로 복구 메커니즘으로, API가 컨텍스트 길이 오류로 요청을 거부할 때 자동으로 더 큰 컨텍스트의 형제 모델로 승격합니다.

### 트리거 및 순서

컨텍스트 오버플로 오류 (예: `context_length_exceeded`)로 턴이 실패하면, `AgentSession`은 압축으로 폴백하기 **전에** 승격을 시도합니다:

1. `contextPromotion.enabled`가 true인 경우 승격 대상을 확인합니다 (아래 참조).
2. 대상이 발견되면 해당 모델로 전환하고 요청을 재시도합니다 — 압축이 필요하지 않습니다.
3. 대상을 사용할 수 없는 경우 현재 모델에서 자동 압축으로 넘어갑니다.

### 대상 선택

선택은 역할 기반이 아닌 모델 기반입니다:

1. `currentModel.contextPromotionTarget` (구성된 경우)
2. 동일한 프로바이더 + API에서 가장 작은 더 큰 컨텍스트 모델

자격 증명이 확인되지 않는 경우 후보는 무시됩니다 (`ModelRegistry.getApiKey(...)`).

### OpenAI Codex 웹소켓 핸드오프

`openai-codex-responses`로/에서 전환하는 경우, 모델 전환 전에 세션 프로바이더 상태 키 `openai-codex-responses`가 닫힙니다. 이는 웹소켓 전송 상태를 제거하여 다음 턴이 승격된 모델에서 깨끗하게 시작되도록 합니다.

### 지속성 동작

승격은 임시 전환을 사용합니다 (`setModelTemporary`):

- 세션 기록에 임시 `model_change`로 기록됩니다.
- 저장된 역할 매핑을 다시 쓰지 않습니다.

### 명시적 폴백 체인 구성

`contextPromotionTarget`을 통해 모델 메타데이터에서 직접 폴백을 구성합니다.

`contextPromotionTarget`은 다음 중 하나를 허용합니다:

- `provider/model-id` (명시적)
- `model-id` (현재 프로바이더 내에서 확인)

Spark -> 동일 프로바이더의 non-Spark에 대한 예시 (`models.yml`):

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

내장 모델 생성기는 동일한 프로바이더의 기본 모델이 존재하는 경우 `*-spark` 모델에 대해 이를 자동으로 할당합니다.

## 호환성 및 라우팅 필드

`models.yml`은 다음 `compat` 서브셋을 지원합니다:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` 또는 `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

이는 OpenAI-completions 전송 로직에 의해 소비되며 URL 기반 자동 감지와 결합됩니다.

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

### 내장 프로바이더 경로 + 모델 메타데이터 재정의

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

### 최초 실행 자동 생성

`models.yml`이 없고 LiteLLM 환경 변수가 감지된 경우, xcsh는 자동으로 생성합니다:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

기본 `config.yml`도 합리적인 이미지 프로바이더 설정으로 생성됩니다.

### 시작 시 자가 복구

시작할 때마다 모델 레지스트리의 `startupHealthCheck()`는 다음 검사를 실행합니다:

| 조건 | 작업 |
|-----------|--------|
| `models.yml` 없음 | 환경 변수에서 자동 생성 |
| `models.yml` 손상 또는 파싱 불가 | `.bak`으로 백업, 재생성 |
| `baseUrl`이 `LITELLM_BASE_URL`과 일치하지 않음 | `.bak`으로 백업, 새 URL로 재생성 |
| `configVersion` 없음 또는 오래됨 | `.bak`으로 백업, 현재 버전으로 재생성 |
| 구성이 정상 | 조치 없음 |

모든 수리 작업은 덮어쓰기 전에 `.bak` 백업을 생성합니다. 모든 작업은 멱등적입니다.

### CLI 명령

```bash
xcsh setup litellm              # LiteLLM 구성 생성 또는 수정
xcsh setup litellm --check      # 쓰기 없이 유효성 검사
xcsh setup litellm --check --json  # 기계 판독 가능한 유효성 검사 출력
```

### 필수 환경 변수

| 변수 | 목적 |
|----------|---------|
| `LITELLM_BASE_URL` | LiteLLM 프록시 URL (예: `https://your-proxy.example.com`). `http://` 또는 `https://`로 시작해야 합니다. |
| `LITELLM_API_KEY` | 프록시의 API 키. 생성된 구성에서 이름으로 참조되며 런타임에 확인됩니다. |

두 변수 중 하나라도 설정되지 않으면 자동 구성은 자동으로 건너뜁니다.

### 구성 버전 관리

생성된 구성에는 `configVersion` 필드가 포함됩니다. 향후 릴리스에서 생성된 형식이 변경되면 xcsh는 오래된 구성을 감지하고 자동으로 업그레이드합니다 (백업 포함).

## 레거시 소비자 주의 사항

이제 대부분의 모델 구성은 `ModelRegistry`를 통해 `models.yml`로 흐릅니다.

주목할 만한 레거시 경로가 하나 남아 있습니다: 웹 검색 Anthropic 인증 확인은 `src/web/search/auth.ts`에서 `~/.xcsh/agent/models.json`을 직접 읽습니다.

해당 특정 경로에 의존하는 경우 해당 모듈이 마이그레이션될 때까지 JSON 호환성을 염두에 두십시오.

## 실패 모드

`models.yml`이 스키마 또는 유효성 검사 검사에 실패하는 경우:

- `LITELLM_BASE_URL` 및 `LITELLM_API_KEY`가 설정된 경우, 시작 상태 검사는 자동 복구를 시도합니다 (손상된 파일 백업, 환경 변수에서 재생성). 복구가 성공하면 레지스트리는 수정된 구성을 다시 로드합니다.
- 자동 복구가 불가능한 경우 (환경 변수 미설정, 쓰기 실패), 레지스트리는 내장 모델로 계속 작동합니다.
- 오류는 `ModelRegistry.getError()`를 통해 노출되고 UI/알림에 표시됩니다.
