---
title: 스킬
description: '코딩 에이전트에서 특화된 기능을 등록, 검색, 호출하기 위한 스킬 시스템.'
sidebar:
  order: 3
  label: 스킬
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# 스킬

스킬은 시작 시 검색되고 모델에 다음과 같이 노출되는 파일 기반 기능 팩입니다:

- 시스템 프롬프트의 경량 메타데이터 (이름 + 설명)
- `read skill://...`을 통한 온디맨드 콘텐츠
- 선택적 대화형 `/skill:<name>` 명령어

이 문서는 `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts`, `src/discovery/agents-md.ts`의 현재 런타임 동작을 다룹니다.

## 이 코드베이스에서 스킬의 정의

검색된 스킬은 다음으로 표현됩니다:

- `name`
- `description`
- `filePath` (`SKILL.md` 경로)
- `baseDir` (스킬 디렉터리)
- 소스 메타데이터 (`provider`, `level`, 경로)

런타임은 유효성 검사를 위해 `name`과 `path`만 필요로 합니다. 실제로 매칭 품질은 `description`이 의미 있는 값인지에 따라 달라집니다.

## 필수 레이아웃 및 SKILL.md 요구사항

### 디렉터리 레이아웃

프로바이더 기반 검색(native/Claude/Codex/Agents/플러그인 프로바이더)의 경우, 스킬은 **`skills/` 하위 한 단계**에서 검색됩니다:

- `<skills-root>/<skill-name>/SKILL.md`

`<skills-root>/group/<skill>/SKILL.md`와 같은 중첩 패턴은 프로바이더 로더에서 검색되지 않습니다.

`skills.customDirectories`의 경우, 스캐닝은 동일한 비재귀적 레이아웃(`*/SKILL.md`)을 사용합니다.

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

스킬 타입에서 지원되는 프론트매터 필드:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- 추가 키는 알 수 없는 메타데이터로 보존됨

현재 런타임 동작:

- `name`은 기본적으로 스킬 디렉터리 이름으로 설정됨
- `description`은 다음 경우에 필수:
  - native `.xcsh` 프로바이더 스킬 검색 (`requireDescription: true`)
  - `src/discovery/helpers.ts`의 `scanSkillsFromDir`을 통한 `skills.customDirectories` 스캔 (비재귀적)
- 비native 프로바이더는 설명 없이도 스킬을 로드할 수 있음

## 검색 파이프라인

`src/extensibility/skills.ts`의 `discoverSkills()`는 두 단계로 실행됩니다:

1. `loadCapability("skills")`를 통한 **기능 프로바이더**
2. `scanSkillsFromDir(..., { requireDescription: true })`를 통한 **커스텀 디렉터리** (한 단계 디렉터리 열거)

`skills.enabled`가 `false`이면, 검색은 스킬을 반환하지 않습니다.

### 내장 스킬 프로바이더 및 우선순위

프로바이더 순서는 우선순위 기준(높을수록 우선)이며, 동점일 경우 등록 순서를 따릅니다.

현재 등록된 스킬 프로바이더:

1. `native` (우선순위 100) — `src/discovery/builtin.ts`를 통한 `.xcsh` 사용자/프로젝트 스킬
2. `claude` (우선순위 80)
3. 우선순위 70 그룹 (등록 순서):
   - `claude-plugins`
   - `agents`
   - `codex`

중복 제거 키는 스킬 이름입니다. 동일한 이름의 첫 번째 항목이 우선합니다.

### 소스 토글 및 필터링

`discoverSkills()`는 다음 제어를 적용합니다:

- 소스 토글: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- 스킬 이름에 대한 글로브 필터:
  - `ignoredSkills` (제외)
  - `includeSkills` (포함 허용 목록; 비어 있으면 모두 포함)

필터 순서:

1. 소스 활성화됨
2. 무시되지 않음
3. 포함됨 (포함 목록이 있는 경우)

codex/claude/native 이외의 프로바이더(예: `agents`, `claude-plugins`)의 경우, 활성화는 현재 **임의의** 내장 소스 토글이 활성화되어 있으면 활성화됨으로 폴백됩니다.

### 충돌 및 중복 처리

- 기능 중복 제거는 이미 이름당 첫 번째 스킬을 유지함 (가장 높은 우선순위 프로바이더)
- `extensibility/skills.ts`는 추가로:
  - `realpath`로 동일 파일을 중복 제거 (심볼릭 링크 안전)
  - 나중 스킬 이름이 충돌할 때 충돌 경고 발생
  - `discoverSkillsFromDir({ dir, source })` 편의 API를 `scanSkillsFromDir`의 씬 어댑터로 유지
- 커스텀 디렉터리 스킬은 프로바이더 스킬 이후에 병합되며 동일한 충돌 동작을 따름

## 런타임 사용 동작

### 시스템 프롬프트 노출

시스템 프롬프트 구성(`src/system-prompt.ts`)은 검색된 스킬을 다음과 같이 사용합니다:

- `read` 도구를 사용할 수 있는 경우:
  - 검색된 스킬 목록을 프롬프트에 포함
- 그렇지 않은 경우:
  - 검색된 목록 생략

태스크 도구 서브에이전트는 일반 세션 생성을 통해 세션의 검색/제공된 스킬 목록을 수신합니다; 태스크별 스킬 고정 재정의는 없습니다.

### 대화형 `/skill:<name>` 명령어

`skills.enableSkillCommands`가 true이면, 대화형 모드는 검색된 스킬당 하나의 슬래시 명령어를 등록합니다.

`/skill:<name> [args]` 동작:

- `filePath`에서 직접 스킬 파일을 읽음
- 프론트매터 제거
- 스킬 본문을 후속 커스텀 메시지로 주입
- 메타데이터 추가 (`Skill: <path>`, 선택적 `User: <args>`)

## `skill://` URL 동작

`src/internal-urls/skill-protocol.ts`는 다음을 지원합니다:

- `skill://<name>` → 해당 스킬의 `SKILL.md`로 확인
- `skill://<name>/<relative-path>` → 해당 스킬 디렉터리 내부로 확인

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

확인 세부사항:

- 스킬 이름은 정확히 일치해야 함
- 상대 경로는 URL 디코딩됨
- 절대 경로는 거부됨
- 경로 순회(`..`)는 거부됨
- 확인된 경로는 `baseDir` 내에 있어야 함
- 파일이 없으면 명시적 `File not found` 오류 반환

콘텐츠 유형:

- `.md` => `text/markdown`
- 그 외 모든 것 => `text/plain`

누락된 애셋에 대한 폴백 검색은 수행되지 않습니다.

## 스킬 vs AGENTS.md, 명령어, 도구, 훅

### 스킬 vs AGENTS.md

- **스킬**: 태스크 컨텍스트에 의해 선택되거나 명시적으로 요청되는 명명된 선택적 기능 팩
- **AGENTS.md/컨텍스트 파일**: 컨텍스트 파일 기능으로 로드되고 레벨/깊이 규칙에 따라 병합되는 영구 지시 파일

`src/discovery/agents-md.ts`는 구체적으로 `cwd`에서 조상 디렉터리를 탐색하여 독립적인 `AGENTS.md` 파일을 검색합니다 (최대 깊이 20, 숨겨진 디렉터리 세그먼트 제외).

### 스킬 vs 슬래시 명령어

- **스킬**: 모델이 읽을 수 있는 지식/워크플로우 콘텐츠
- **슬래시 명령어**: 사용자가 호출하는 명령어 진입점
- `/skill:<name>`은 스킬 텍스트를 주입하는 편의 래퍼이며, 스킬 검색 의미론을 변경하지 않음

### 스킬 vs 커스텀 도구

- **스킬**: 프롬프트 컨텍스트와 `read`를 통해 로드되는 문서/워크플로우 콘텐츠
- **커스텀 도구**: 스키마와 런타임 사이드 이펙트를 가진 모델이 호출 가능한 실행 가능 도구 API

### 스킬 vs 훅

- **스킬**: 수동적 콘텐츠
- **훅**: 실행 중에 동작을 차단/수정할 수 있는 이벤트 기반 런타임 인터셉터

## 검색 로직과 연계된 실용적인 작성 지침

- 각 스킬을 고유한 디렉터리에 배치: `<skills-root>/<skill-name>/SKILL.md`
- 항상 명시적인 `name` 및 `description` 프론트매터 포함
- 참조된 애셋은 동일한 스킬 디렉터리 아래에 두고 `skill://<name>/...`으로 접근
- 중첩 분류(`team/domain/skill`)의 경우, `skills.customDirectories`를 중첩된 상위 디렉터리로 지정; 스캐닝 자체는 비재귀적으로 유지됨
- 소스 간 중복된 스킬 이름을 피할 것; 프로바이더 우선순위에 따라 첫 번째 일치가 우선함
