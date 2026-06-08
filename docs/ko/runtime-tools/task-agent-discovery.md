---
title: Task Agent Discovery and Selection
description: >-
  Task agent discovery and selection logic for routing work to specialized
  subagent types.
sidebar:
  order: 6
  label: Task agent 탐색
i18n:
  sourceHash: 8cf42457c672
  translator: machine
---

# 태스크 에이전트 탐색 및 선택

이 문서는 태스크 하위 시스템이 에이전트 정의를 탐색하고, 여러 소스를 병합하며, 실행 시점에 요청된 에이전트를 해석하는 방법을 설명합니다.

우선순위, 잘못된 정의 처리, 에이전트를 사실상 사용 불가능하게 만들 수 있는 스폰/깊이 제약 조건을 포함하여 현재 구현된 런타임 동작을 다룹니다.

## 구현 파일

- [`src/task/discovery.ts`](../../packages/coding-agent/src/task/discovery.ts)
- [`src/task/agents.ts`](../../packages/coding-agent/src/task/agents.ts)
- [`src/task/types.ts`](../../packages/coding-agent/src/task/types.ts)
- [`src/task/index.ts`](../../packages/coding-agent/src/task/index.ts)
- [`src/task/commands.ts`](../../packages/coding-agent/src/task/commands.ts)
- [`src/prompts/agents/task.md`](../../packages/coding-agent/src/prompts/agents/task.md)
- [`src/prompts/tools/task.md`](../../packages/coding-agent/src/prompts/tools/task.md)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/config.ts`](../../packages/coding-agent/src/config.ts)
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts)

---

## 에이전트 정의 형태

태스크 에이전트는 `AgentDefinition` (`src/task/types.ts`)으로 정규화됩니다:

- `name`, `description`, `systemPrompt` (유효한 로드된 에이전트에 필수)
- 선택적 `tools`, `spawns`, `model`, `thinkingLevel`, `output`
- `source`: `"bundled" | "user" | "project"`
- 선택적 `filePath`

파싱은 `parseAgentFields()` (`src/discovery/helpers.ts`)를 통해 프론트매터에서 수행됩니다:

- `name` 또는 `description` 누락 => 유효하지 않음 (`null`), 호출자가 파싱 실패로 처리
- `tools`는 CSV 또는 배열을 허용; 제공된 경우 `submit_result`가 자동 추가됨
- `spawns`는 `*`, CSV 또는 배열을 허용
- 하위 호환 동작: `spawns`가 없지만 `tools`에 `task`가 포함된 경우, `spawns`는 `*`가 됨
- `output`은 불투명 스키마 데이터로 그대로 전달됨

## 번들 에이전트

번들 에이전트는 빌드 시점에 텍스트 임포트를 사용하여 (`src/task/agents.ts`) 내장됩니다.

`EMBEDDED_AGENT_DEFS`는 다음을 정의합니다:

- 프롬프트 파일에서 가져온 `explore`, `plan`, `designer`, `reviewer`
- 공유된 `task.md` 본문과 주입된 프론트매터에서 가져온 `task` 및 `quick_task`

로딩 경로:

1. `loadBundledAgents()`가 `parseAgent(..., "bundled", "fatal")`로 내장된 마크다운을 파싱
2. 결과가 메모리 내 캐시에 저장됨 (`bundledAgentsCache`)
3. `clearBundledAgentsCache()`는 테스트 전용 캐시 초기화

번들 파싱은 `level: "fatal"`을 사용하므로, 잘못된 번들 프론트매터는 예외를 발생시키며 탐색 전체를 실패시킬 수 있습니다.

## 파일시스템 및 플러그인 탐색

`discoverAgents(cwd, home)` (`src/task/discovery.ts`)는 번들 정의를 추가하기 전에 여러 소스의 에이전트를 병합합니다.

### 탐색 입력

1. `getConfigDirs("agents", { project: false })`에서 가져온 사용자 설정 에이전트 디렉토리
2. `findAllNearestProjectConfigDirs("agents", cwd)`에서 가져온 가장 가까운 프로젝트 에이전트 디렉토리
3. `agents/` 하위 디렉토리를 포함한 Claude 플러그인 루트 (`listClaudePluginRoots(home)`)
4. 번들 에이전트 (`loadBundledAgents()`)

### 실제 소스 순서

소스 패밀리 순서는 `src/config.ts`의 `priorityList`에서 파생된 `getConfigDirs("", { project: false })`에서 결정됩니다:

1. `.xcsh`
2. `.claude`
3. `.codex`
4. `.gemini`

각 소스 패밀리에 대해 탐색 순서는 다음과 같습니다:

1. 해당 소스의 가장 가까운 프로젝트 디렉토리 (발견된 경우)
2. 해당 소스의 사용자 디렉토리

모든 소스 패밀리 디렉토리 이후에 플러그인 `agents/` 디렉토리가 추가됩니다 (프로젝트 범위 플러그인 먼저, 그 다음 사용자 범위).

번들 에이전트는 마지막에 추가됩니다.

### 중요한 주의 사항: 오래된 주석 vs 현재 코드

`discovery.ts` 헤더 주석은 여전히 `.pi`를 언급하고 있으며 `.codex`/`.gemini`를 언급하지 않습니다. 실제 런타임 순서는 `src/config.ts`에 의해 결정되며 현재 `.xcsh`, `.claude`, `.codex`, `.gemini`를 사용합니다.

## 병합 및 충돌 규칙

탐색은 정확한 `agent.name` 기준으로 선착순 중복 제거를 사용합니다:

- `Set<string>`이 이미 확인된 이름을 추적합니다.
- 로드된 에이전트는 디렉토리 순서로 평탄화되며 이름이 미확인인 경우에만 유지됩니다.
- 번들 에이전트는 동일한 세트에 대해 필터링되며 아직 미확인인 경우에만 추가됩니다.

의미:

- 동일한 소스 패밀리에서 프로젝트가 사용자를 재정의합니다.
- 우선순위가 높은 소스 패밀리가 낮은 것을 재정의합니다 (`.xcsh`가 `.claude`보다 먼저 등).
- 비번들 에이전트가 동일한 이름의 번들 에이전트를 재정의합니다.
- 이름 매칭은 대소문자를 구분합니다 (`Task`와 `task`는 별개).
- 하나의 디렉토리 내에서 마크다운 파일은 중복 제거 전에 사전순 파일명 순서로 읽힙니다.

## 유효하지 않은/누락된 에이전트 파일 동작

디렉토리별 (`loadAgentsFromDir`):

- 읽을 수 없는/누락된 디렉토리: 비어 있는 것으로 처리 (`readdir(...).catch(() => [])`)
- 파일 읽기 또는 파싱 실패: 경고 로그 기록, 파일 건너뜀
- 파싱 경로는 `parseAgent(..., level: "warn")`을 사용

프론트매터 실패 동작은 `parseFrontmatter`에서 결정됩니다:

- `warn` 레벨에서의 파싱 오류는 경고를 로그에 기록
- 파서가 단순한 `key: value` 라인 파서로 폴백
- 필수 필드가 여전히 누락된 경우, `parseAgentFields`가 실패하고 `AgentParsingError`가 발생하여 호출자에 의해 포착됨 (파일 건너뜀)

결과적 효과: 하나의 잘못된 커스텀 에이전트 파일이 다른 파일의 탐색을 중단시키지 않습니다.

## 에이전트 조회 및 선택

조회는 정확한 이름의 선형 검색입니다:

- `getAgent(agents, name)` => `agents.find(a => a.name === name)`

태스크 실행 시 (`TaskTool.execute`):

1. 호출 시점에 에이전트가 재탐색됨 (`discoverAgents(this.session.cwd)`)
2. 요청된 `params.agent`가 `getAgent`를 통해 해석됨
3. 누락된 에이전트는 즉시 도구 응답을 반환:
   - `Unknown agent "...". Available: ...`
   - 서브프로세스가 실행되지 않음

### 설명 vs 실행 시점 탐색

`TaskTool.create()`는 초기화 시점에 탐색 결과로부터 도구 설명을 빌드합니다 (`buildDescription`).

`execute()`는 에이전트를 다시 탐색합니다. 따라서 세션 중에 에이전트 파일이 변경된 경우 런타임 세트가 이전 도구 설명에 나열된 것과 다를 수 있습니다.

## 구조화된 출력 가드레일 및 스키마 우선순위

`TaskTool.execute`에서의 런타임 출력 스키마 우선순위:

1. 에이전트 프론트매터 `output`
2. 태스크 호출 `params.schema`
3. 부모 세션 `outputSchema`

(`effectiveOutputSchema = effectiveAgent.output ?? outputSchema ?? this.session.outputSchema`)

`src/prompts/tools/task.md`의 프롬프트 시점 가드레일 텍스트는 구조화된 출력 에이전트 (`explore`, `reviewer`)의 불일치 동작에 대해 경고합니다: 산문의 출력 형식 지시가 내장 스키마와 충돌하여 `null` 출력을 생성할 수 있습니다.

이것은 안내 사항이며, `discoverAgents`의 하드 런타임 검증 로직이 아닙니다.

## 명령 탐색 상호작용

`src/task/commands.ts`는 워크플로우 명령(에이전트 정의가 아님)을 위한 병렬 인프라이지만, 전체적으로 동일한 패턴을 따릅니다:

- 먼저 기능 제공자로부터 탐색
- 이름 기준 선착순으로 중복 제거
- 아직 미확인인 경우 번들 명령 추가
- `getCommand`를 통한 정확한 이름 조회

`src/task/index.ts`에서 명령 헬퍼는 에이전트 탐색 헬퍼와 함께 재내보내기됩니다. 에이전트 탐색 자체는 런타임에서 명령 탐색에 의존하지 않습니다.

## 탐색 이후의 가용성 제약

에이전트가 탐색 가능하더라도 실행 가드레일로 인해 여전히 실행 불가능할 수 있습니다.

### 부모 스폰 정책

`TaskTool.execute`는 `session.getSessionSpawns()`를 확인합니다:

- `"*"` => 모두 허용
- `""` => 모두 거부
- CSV 목록 => 나열된 이름만 허용

거부된 경우: 즉시 `Cannot spawn '...'. Allowed: ...` 응답.

### 차단된 자기 재귀 환경 변수 가드

`PI_BLOCKED_AGENT`는 도구 생성 시 읽힙니다. 요청이 일치하면 재귀 방지 메시지와 함께 실행이 거부됩니다.

### 재귀 깊이 게이팅 (자식 세션 내 태스크 도구 가용성)

`runSubprocess` (`src/task/executor.ts`)에서:

- 깊이는 `taskDepth`에서 계산됨
- `task.maxRecursionDepth`가 차단 기준을 제어
- 최대 깊이에 도달한 경우:
  - `task` 도구가 자식 도구 목록에서 제거됨
  - 자식 `spawns` 환경 변수가 빈 값으로 설정됨

따라서 에이전트 정의에 `spawns`가 포함되어 있더라도 더 깊은 레벨에서는 추가 태스크를 스폰할 수 없습니다.

## Plan 모드 주의 사항 (현재 구현)

`TaskTool.execute`는 plan 모드를 위한 `effectiveAgent`를 계산합니다 (plan 모드 프롬프트를 앞에 추가, 읽기 전용 도구 하위 집합으로 강제, spawns 제거). 그러나 `runSubprocess`는 `effectiveAgent`가 아닌 `agent`로 호출됩니다.

현재 효과:

- 모델 재정의 / 사고 레벨 / 출력 스키마는 `effectiveAgent`에서 파생됨
- `effectiveAgent`의 시스템 프롬프트 및 도구/스폰 제한은 이 호출 경로에서 전달되지 않음

이것은 plan 모드 동작 기대치를 읽을 때 알아야 할 구현상의 주의 사항입니다.
