---
title: 룰북 매칭 파이프라인
description: 에이전트 세션에 컨텍스트별 명령어 세트를 선택하고 적용하기 위한 룰북 매칭 파이프라인.
sidebar:
  order: 6
  label: 룰북 매칭
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# 룰북 매칭 파이프라인

이 문서는 coding-agent가 지원되는 설정 형식에서 규칙을 탐색하고, 이를 단일 `Rule` 형태로 정규화하며, 우선순위 충돌을 해결하고, 결과를 다음과 같이 분리하는 방법을 설명합니다:

- **룰북 규칙** (시스템 프롬프트 + `rule://` URL을 통해 모델에 제공)
- **TTSR 규칙** (시간 여행 스트림 인터럽션 규칙)

이 문서는 부분적 의미론과 파싱되지만 강제되지 않는 메타데이터를 포함한 현재 구현을 반영합니다.

## 구현 파일

- [`../src/capability/rule.ts`](../../packages/coding-agent/src/capability/rule.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/discovery/index.ts`](../../packages/coding-agent/src/discovery/index.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/cursor.ts`](../../packages/coding-agent/src/discovery/cursor.ts)
- [`../src/discovery/windsurf.ts`](../../packages/coding-agent/src/discovery/windsurf.ts)
- [`../src/discovery/cline.ts`](../../packages/coding-agent/src/discovery/cline.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/system-prompt.ts`](../../packages/coding-agent/src/system-prompt.ts)
- [`../src/internal-urls/rule-protocol.ts`](../../packages/coding-agent/src/internal-urls/rule-protocol.ts)
- [`../src/utils/frontmatter.ts`](../../packages/coding-agent/src/utils/frontmatter.ts)

## 1. 정규 규칙 형태

모든 제공자는 소스 파일을 `Rule`로 정규화합니다:

```ts
interface Rule {
  name: string;
  path: string;
  content: string;
  globs?: string[];
  alwaysApply?: boolean;
  description?: string;
  ttsrTrigger?: string;
  _source: SourceMeta;
}
```

기능 식별자는 `rule.name`입니다 (`ruleCapability.key = rule => rule.name`).

결과적으로 우선순위와 중복 제거는 **이름 기반으로만** 이루어집니다. 동일한 `name`을 가진 두 개의 다른 파일은 동일한 논리적 규칙으로 간주됩니다.

## 2. 탐색 소스 및 정규화

`src/discovery/index.ts`는 제공자를 자동 등록합니다. `rules`의 경우 현재 제공자는 다음과 같습니다:

- `native` (우선순위 `100`)
- `cursor` (우선순위 `50`)
- `windsurf` (우선순위 `50`)
- `cline` (우선순위 `40`)

### 네이티브 제공자 (`builtin.ts`)

다음 경로에서 `.xcsh` 규칙을 로드합니다:

- 프로젝트: `<cwd>/.xcsh/rules/*.{md,mdc}`
- 사용자: `~/.xcsh/agent/rules/*.{md,mdc}`

정규화:

- `name` = `.md`/`.mdc` 확장자를 제거한 파일 이름
- `parseFrontmatter`를 통해 프론트매터 파싱
- `content` = 본문 (프론트매터 제거)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` 직접 매핑

중요한 주의사항: `globs`는 이 제공자에서 요소 필터링 없이 `string[] | undefined`로 캐스트됩니다.

### Cursor 제공자 (`cursor.ts`)

다음 경로에서 로드합니다:

- 사용자: `~/.cursor/rules/*.{mdc,md}`
- 프로젝트: `<cwd>/.cursor/rules/*.{mdc,md}`

정규화 (`transformMDCRule`):

- `description`: 문자열인 경우에만 유지
- `alwaysApply`: `true`만 보존 (`false`는 `undefined`가 됨)
- `globs`: 배열(문자열 요소만) 또는 단일 문자열 허용
- `ttsr_trigger`: 문자열만
- `name`: 확장자를 제거한 파일 이름

### Windsurf 제공자 (`windsurf.ts`)

다음 경로에서 로드합니다:

- 사용자: `~/.codeium/windsurf/memories/global_rules.md` (고정 규칙 이름 `global_rules`)
- 프로젝트: `<cwd>/.windsurf/rules/*.md`

정규화:

- `globs`: 문자열 배열 또는 단일 문자열
- `alwaysApply`, `description` 프론트매터에서 캐스트
- `ttsr_trigger`: 문자열만
- `name`: 프로젝트 규칙의 경우 파일 이름에서 추출

### Cline 제공자 (`cline.ts`)

`cwd`에서 상위 방향으로 가장 가까운 `.clinerules`를 검색합니다:

- 디렉토리인 경우: 내부의 `*.md` 파일을 로드
- 파일인 경우: `clinerules`라는 이름의 단일 규칙으로 로드

정규화:

- `globs`: 문자열 배열 또는 단일 문자열
- `alwaysApply`: 불리언인 경우에만
- `description`: 문자열만
- `ttsr_trigger`: 문자열만

## 3. 프론트매터 파싱 동작 및 모호성

모든 제공자는 다음 의미론으로 `parseFrontmatter` (`utils/frontmatter.ts`)를 사용합니다:

1. 프론트매터는 콘텐츠가 `---`로 시작하고 닫는 `\n---`가 있을 때만 파싱됩니다.
2. 본문은 프론트매터 추출 후 트리밍됩니다.
3. YAML 파싱이 실패하면:
   - 경고가 로깅되고,
   - 파서는 단순 `key: value` 줄 파싱 (`^(\w+):\s*(.*)$`)으로 폴백합니다.

모호성의 결과:

- 폴백 파서는 배열, 중첩 객체, 인용 규칙 또는 하이픈이 포함된 키를 지원하지 않습니다.
- 폴백 값은 문자열이 됩니다 (예: `alwaysApply: true`는 문자열 `"true"`가 됨). 따라서 불리언/문자열 타입을 요구하는 제공자는 메타데이터를 누락시킬 수 있습니다.
- `ttsr_trigger`는 폴백에서 작동합니다 (밑줄 키). `thinking-level`과 같은 키는 작동하지 않습니다.
- 유효한 프론트매터가 없는 파일도 빈 메타데이터와 전체 콘텐츠 본문을 가진 규칙으로 로드됩니다.

## 4. 제공자 우선순위 및 중복 제거

`loadCapability("rules")` (`capability/index.ts`)는 제공자 출력을 병합한 다음 `rule.name`으로 중복을 제거합니다.

### 우선순위 모델

- 제공자는 우선순위 내림차순으로 정렬됩니다.
- 동일한 우선순위는 등록 순서를 유지합니다 (`discovery/index.ts`에서 `cursor`가 `windsurf`보다 먼저).
- 중복 제거는 선착순입니다: 처음 만난 규칙 이름이 유지되고, 이후 동일 이름 항목은 `all`에서 `_shadowed`로 표시되며 `items`에서 제외됩니다.

현재 효과적인 규칙 제공자 순서는 다음과 같습니다:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### 제공자 내부 순서 주의사항

제공자 내에서 항목 순서는 `loadFilesFromDir` glob 결과 순서와 명시적 push 순서에서 결정됩니다. 이는 일반적인 사용에서는 충분히 결정적이지만 코드에서 명시적으로 정렬되지는 않습니다.

주목할 만한 소스 순서 차이:

- `native`는 프로젝트를 먼저, 그다음 사용자 설정 디렉토리를 추가합니다.
- `cursor`는 사용자를 먼저, 그다음 프로젝트 결과를 추가합니다.
- `windsurf`는 사용자 `global_rules`를 먼저, 그다음 프로젝트 규칙을 추가합니다.
- `cline`는 가장 가까운 `.clinerules` 소스만 로드합니다.

## 5. 룰북, 항상 적용, TTSR 버킷으로 분리

`createAgentSession` (`sdk.ts`)에서 규칙 탐색 후:

1. 탐색된 모든 규칙이 스캔됩니다.
2. `condition` (프론트매터 키; `ttsr_trigger` / `ttsrTrigger`가 폴백으로 허용됨)이 있는 규칙은 `TtsrManager`에 등록됩니다.
3. 다음 조건으로 별도의 `rulebookRules` 목록이 구성됩니다:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. `alwaysApplyRules` 목록이 구성됩니다:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### 버킷 동작

- **TTSR 버킷**: `condition`이 있는 모든 규칙 (설명 불필요). 다른 버킷보다 우선합니다.
- **항상 적용 버킷**: `alwaysApply === true`, TTSR 아님. 전체 콘텐츠가 시스템 프롬프트에 주입됩니다. `rule://`을 통해 해석 가능합니다.
- **룰북 버킷**: 설명이 있어야 하며, TTSR이 아니어야 하고, `alwaysApply`가 아니어야 합니다. 시스템 프롬프트에 이름+설명으로 나열되며, 콘텐츠는 `rule://`을 통해 요청 시 읽힙니다.
- `condition`과 `alwaysApply`가 모두 있는 규칙은 TTSR로만 분류됩니다 (TTSR이 우선).
- `alwaysApply`와 `description`이 모두 있는 규칙은 항상 적용으로만 분류됩니다 (룰북 아님).

## 6. 메타데이터가 런타임 표면에 미치는 영향

### `description`

- 룰북에 포함되기 위해 필수입니다.
- 시스템 프롬프트의 `<rules>` 블록에 렌더링됩니다.
- 설명이 없으면 규칙은 `rule://`을 통해 접근할 수 없으며 시스템 프롬프트 규칙에 나열되지 않습니다.

### `globs`

- `Rule`에 전달됩니다.
- 시스템 프롬프트 규칙 블록에서 `<glob>...</glob>` 항목으로 렌더링됩니다.
- 규칙 UI 상태 (`extensions` 모드 목록)에 노출됩니다.
- **이 파이프라인에서 자동 매칭을 위해 강제되지 않습니다.** 현재 파일/도구 대상에 따라 규칙을 선택하는 런타임 glob 매처가 없습니다.

### `alwaysApply`

- 제공자에 의해 파싱되고 보존됩니다.
- UI 표시에 사용됩니다 (확장 상태 관리자에서 `"always"` 트리거 레이블).
- `rulebookRules`에서 제외 조건으로 사용됩니다.
- **전체 규칙 콘텐츠가 시스템 프롬프트에 자동 주입됩니다** (룰북 규칙 섹션 앞).
- `rule://<name>`을 통해 재읽기를 위해 접근 가능합니다.

### `ttsr_trigger`

- `rule.ttsrTrigger`로 매핑됩니다.
- 존재하면 규칙은 룰북이 아닌 TTSR 관리자로 라우팅됩니다.

## 7. 시스템 프롬프트 포함 경로

`buildSystemPromptInternal`은 `rules` (룰북)와 `alwaysApplyRules` 모두를 받습니다.

항상 적용 규칙이 먼저 렌더링되어 원시 콘텐츠를 프롬프트에 직접 주입합니다.

룰북 규칙은 `# Rules` 섹션에 다음과 함께 렌더링됩니다:

- `Read rule://<name> when working in matching domain`
- 각 규칙의 `name`, `description`, 그리고 선택적 `<glob>` 목록

이는 권고/맥락적입니다: 프롬프트 텍스트는 모델에게 적용 가능한 규칙을 읽도록 요청하지만, 코드가 glob 적용 가능성을 강제하지는 않습니다.

## 8. `rule://` 내부 URL 동작

`RuleProtocolHandler`는 다음과 같이 등록됩니다:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

함의:

- `rule://<name>`은 **rulebookRules**와 **alwaysApplyRules** 모두에 대해 해석됩니다.
- TTSR 전용 규칙과 설명이 없고 `alwaysApply`가 아닌 규칙은 `rule://`을 통해 접근할 수 없습니다.
- 해석은 정확한 이름 매칭입니다.
- 알 수 없는 이름은 사용 가능한 규칙 이름 목록과 함께 오류를 반환합니다.
- 반환되는 콘텐츠는 원시 `rule.content` (프론트매터 제거됨)이며, 콘텐츠 타입은 `text/markdown`입니다.

## 9. 알려진 부분적/비강제 의미론

1. 제공자 설명에서 레거시 파일 (`.cursorrules`, `.windsurfrules`)을 언급하지만, 현재 로더 코드 경로에서는 실제로 이러한 파일을 읽지 않습니다.
2. `globs` 메타데이터는 프롬프트/UI에 노출되지만 규칙 선택 로직에 의해 강제되지 않습니다.
3. `rule://`에 대한 규칙 선택은 룰북과 항상 적용 규칙을 포함하지만, TTSR 전용 규칙은 포함하지 않습니다.
4. 탐색 경고 (`loadCapability("rules").warnings`)가 생성되지만 `createAgentSession`은 현재 이 경로에서 이를 표시/로깅하지 않습니다.
