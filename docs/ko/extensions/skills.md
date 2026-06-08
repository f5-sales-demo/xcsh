---
title: Skills
description: '코딩 에이전트에서 특화된 기능을 등록, 탐색, 호출하기 위한 스킬 시스템.'
sidebar:
  order: 3
  label: Skills
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# Skills

스킬은 파일 기반의 기능 팩으로, 시작 시 탐색되어 모델에 다음과 같이 노출됩니다:

- 시스템 프롬프트의 경량 메타데이터 (이름 + 설명)
- `read skill://...`를 통한 온디맨드 콘텐츠
- 선택적 대화형 `/skill:<name>` 명령

이 문서는 `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts`, `src/discovery/agents-md.ts`의 현재 런타임 동작을 다룹니다.

## 이 코드베이스에서 스킬이란

탐색된 스킬은 다음과 같이 표현됩니다:

- `name`
- `description`
- `filePath` (`SKILL.md` 경로)
- `baseDir` (스킬 디렉토리)
- 소스 메타데이터 (`provider`, `level`, path)

런타임은 유효성을 위해 `name`과 `path`만 필요로 합니다. 실제로 매칭 품질은 `description`이 의미 있는 내용을 담고 있는지에 따라 달라집니다.

## 필수 레이아웃과 SKILL.md 기대사항

### 디렉토리 레이아웃

프로바이더 기반 탐색(native/Claude/Codex/Agents/plugin 프로바이더)의 경우, 스킬은 **`skills/` 아래 한 단계**에서 탐색됩니다:

- `<skills-root>/<skill-name>/SKILL.md`

`<skills-root>/group/<skill>/SKILL.md`와 같은 중첩 패턴은 프로바이더 로더에 의해 탐색되지 않습니다.

`skills.customDirectories`의 경우에도 동일한 비재귀적 레이아웃(`*/SKILL.md`)으로 스캔합니다.

```text
Provider-discovered layout (non-recursive under skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ discovered
  ├─ pdf/
  │   └─ SKILL.md      ✅ discovered
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ not discovered by provider loaders

Custom-directory scanning is also non-recursive, so nested paths are ignored unless you point `customDirectories` at that nested parent.
```

### `SKILL.md` 프론트매터

스킬 타입에서 지원하는 프론트매터 필드:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- 추가 키는 알 수 없는 메타데이터로 보존됨

현재 런타임 동작:

- `name`은 스킬 디렉토리 이름으로 기본 설정됨
- `description`은 다음의 경우 필수:
  - 네이티브 `.xcsh` 프로바이더 스킬 탐색 (`requireDescription: true`)
  - `src/discovery/helpers.ts`의 `scanSkillsFromDir`을 통한 `skills.customDirectories` 스캔 (비재귀적)
- 비네이티브 프로바이더는 설명 없이도 스킬을 로드할 수 있음

## 탐색 파이프라인

`src/extensibility/skills.ts`의 `discoverSkills()`는 두 번의 패스를 수행합니다:

1. **기능 프로바이더** — `loadCapability("skills")` 사용
2. **커스텀 디렉토리** — `scanSkillsFromDir(..., { requireDescription: true })` 사용 (한 단계 디렉토리 열거)

`skills.enabled`가 `false`이면 탐색은 스킬을 반환하지 않습니다.

### 내장 스킬 프로바이더와 우선순위

프로바이더 순서는 우선순위 우선(높은 값이 우선)이며, 동일 순위의 경우 등록 순서를 따릅니다.

현재 등록된 스킬 프로바이더:

1. `native` (우선순위 100) — `src/discovery/builtin.ts`를 통한 `.xcsh` 사용자/프로젝트 스킬
2. `claude` (우선순위 80)
3. 우선순위 70 그룹 (등록 순서):
   - `claude-plugins`
   - `agents`
   - `codex`

중복 제거 키는 스킬 이름입니다. 주어진 이름의 첫 번째 항목이 우선합니다.

### 소스 토글과 필터링

`discoverSkills()`는 다음 제어를 적용합니다:

- 소스 토글: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- 스킬 이름에 대한 glob 필터:
  - `ignoredSkills` (제외)
  - `includeSkills` (포함 허용 목록; 비어 있으면 모두 포함)

필터 순서:

1. 소스 활성화 여부
2. 무시 목록에 없음
3. 포함됨 (포함 목록이 있는 경우)

codex/claude/native 이외의 프로바이더(예: `agents`, `claude-plugins`)의 경우, 활성화는 현재 다음으로 폴백됩니다: **어느 하나의** 내장 소스 토글이라도 활성화되어 있으면 활성화.

### 충돌 및 중복 처리

- 기능 중복 제거는 이미 이름당 첫 번째 스킬을 유지합니다 (최고 우선순위 프로바이더)
- `extensibility/skills.ts`는 추가로:
  - `realpath`로 동일 파일을 중복 제거 (심볼릭 링크 안전)
  - 이후 스킬 이름이 충돌할 때 충돌 경고를 출력
  - `discoverSkillsFromDir({ dir, source })` API를 `scanSkillsFromDir` 위의 얇은 어댑터로 유지
- 커스텀 디렉토리 스킬은 프로바이더 스킬 이후에 병합되며 동일한 충돌 동작을 따름

## 런타임 사용 동작

### 시스템 프롬프트 노출

시스템 프롬프트 구성(`src/system-prompt.ts`)은 탐색된 스킬을 다음과 같이 사용합니다:

- `read` 도구가 사용 가능한 경우:
  - 프롬프트에 탐색된 스킬 목록을 포함
- 그렇지 않은 경우:
  - 탐색된 목록을 생략

Task 도구 하위 에이전트는 일반 세션 생성을 통해 세션의 탐색된/제공된 스킬 목록을 수신합니다; 태스크별 스킬 고정 오버라이드는 없습니다.

### 대화형 `/skill:<name>` 명령

`skills.enableSkillCommands`가 true이면, 대화형 모드는 탐색된 스킬당 하나의 슬래시 명령을 등록합니다.

`/skill:<name> [args]` 동작:

- `filePath`에서 스킬 파일을 직접 읽음
- 프론트매터를 제거
- 스킬 본문을 후속 커스텀 메시지로 주입
- 메타데이터를 추가 (`Skill: <path>`, 선택적 `User: <args>`)

## `skill://` URL 동작

`src/internal-urls/skill-protocol.ts`는 다음을 지원합니다:

- `skill://<name>` → 해당 스킬의 `SKILL.md`로 해석
- `skill://<name>/<relative-path>` → 해당 스킬 디렉토리 내부로 해석

```text
skill:// URL resolution

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

Guards:
- reject absolute paths
- reject `..` traversal
- reject any resolved path escaping <pdf-base>
```

해석 세부사항:

- 스킬 이름은 정확히 일치해야 함
- 상대 경로는 URL 디코딩됨
- 절대 경로는 거부됨
- 경로 순회(`..`)는 거부됨
- 해석된 경로는 `baseDir` 내에 있어야 함
- 누락된 파일은 명시적 `File not found` 오류를 반환

콘텐츠 타입:

- `.md` => `text/markdown`
- 그 외 모든 것 => `text/plain`

누락된 에셋에 대한 폴백 검색은 수행되지 않습니다.

## 스킬 vs AGENTS.md, 명령, 도구, 훅

### 스킬 vs AGENTS.md

- **스킬**: 태스크 컨텍스트에 의해 선택되거나 명시적으로 요청되는 이름 있는 선택적 기능 팩
- **AGENTS.md/컨텍스트 파일**: 컨텍스트 파일 기능으로 로드되고 레벨/깊이 규칙에 의해 병합되는 영구 지시 파일

`src/discovery/agents-md.ts`는 `cwd`에서 상위 디렉토리를 순회하여 독립 `AGENTS.md` 파일을 탐색하며(최대 깊이 20), 숨김 디렉토리 세그먼트는 제외합니다.

### 스킬 vs 슬래시 명령

- **스킬**: 모델이 읽을 수 있는 지식/워크플로우 콘텐츠
- **슬래시 명령**: 사용자가 호출하는 명령 진입점
- `/skill:<name>`은 스킬 텍스트를 주입하는 편의 래퍼입니다; 스킬 탐색 의미론을 변경하지 않습니다

### 스킬 vs 커스텀 도구

- **스킬**: 프롬프트 컨텍스트와 `read`를 통해 로드되는 문서/워크플로우 콘텐츠
- **커스텀 도구**: 스키마와 런타임 사이드 이펙트를 가진 모델이 호출할 수 있는 실행 가능한 도구 API

### 스킬 vs 훅

- **스킬**: 수동적 콘텐츠
- **훅**: 실행 중 동작을 차단/수정할 수 있는 이벤트 기반 런타임 인터셉터

## 탐색 로직에 연관된 실용적 작성 가이드

- 각 스킬을 자체 디렉토리에 배치하세요: `<skills-root>/<skill-name>/SKILL.md`
- 항상 명시적인 `name`과 `description` 프론트매터를 포함하세요
- 참조 에셋은 동일 스킬 디렉토리 아래에 두고 `skill://<name>/...`로 접근하세요
- 중첩 분류(`team/domain/skill`)의 경우, `skills.customDirectories`를 중첩된 부모 디렉토리로 지정하세요; 스캔 자체는 비재귀적으로 유지됩니다
- 소스 간 중복 스킬 이름을 피하세요; 프로바이더 우선순위에 의해 첫 번째 매치가 우선합니다
