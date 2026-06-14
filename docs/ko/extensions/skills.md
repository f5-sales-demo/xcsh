---
title: Skills
description: '코딩 에이전트에서 전문화된 기능을 등록, 검색 및 호출하기 위한 Skills 시스템.'
sidebar:
  order: 3
  label: Skills
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# Skills

Skills는 시작 시 검색되고 모델에 다음과 같이 노출되는 파일 기반 기능 팩입니다:

- 시스템 프롬프트의 경량 메타데이터 (이름 + 설명)
- `read skill://...`를 통한 온디맨드 콘텐츠
- 선택적 대화형 `/skill:<name>` 명령

이 문서는 `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts`, `src/discovery/agents-md.ts`의 현재 런타임 동작을 다룹니다.

## 이 코드베이스에서 skill이란

검색된 skill은 다음으로 표현됩니다:

- `name`
- `description`
- `filePath` (`SKILL.md` 경로)
- `baseDir` (skill 디렉터리)
- 소스 메타데이터 (`provider`, `level`, 경로)

런타임은 유효성 확인을 위해 `name`과 `path`만 필요합니다. 실제로 매칭 품질은 `description`이 의미 있는 내용인지에 따라 달라집니다.

## 필수 레이아웃 및 SKILL.md 요구사항

### 디렉터리 레이아웃

프로바이더 기반 검색(native/Claude/Codex/Agents/plugin 프로바이더)의 경우, skill은 **`skills/` 바로 아래 한 단계**에서 검색됩니다:

- `<skills-root>/<skill-name>/SKILL.md`

`<skills-root>/group/<skill>/SKILL.md`와 같은 중첩 패턴은 프로바이더 로더에 의해 검색되지 않습니다.

`skills.customDirectories`의 경우, 스캐닝은 동일한 비재귀 레이아웃(`*/SKILL.md`)을 사용합니다.

```text
프로바이더 검색 레이아웃 (skills/ 하위 비재귀):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ 검색됨
  ├─ pdf/
  │   └─ SKILL.md      ✅ 검색됨
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ 프로바이더 로더에 의해 검색되지 않음

커스텀 디렉터리 스캐닝도 비재귀적이므로, `customDirectories`를 해당 중첩 상위 디렉터리로 지정하지 않으면 중첩 경로는 무시됩니다.
```

### `SKILL.md` 프론트매터

skill 타입에서 지원되는 프론트매터 필드:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- 추가 키는 알 수 없는 메타데이터로 보존됨

현재 런타임 동작:

- `name`은 skill 디렉터리 이름으로 기본 설정됨
- `description`은 다음의 경우 필수:
  - native `.xcsh` 프로바이더 skill 검색 (`requireDescription: true`)
  - `src/discovery/helpers.ts`의 `scanSkillsFromDir`을 통한 `skills.customDirectories` 스캔 (비재귀)
- 비 native 프로바이더는 설명 없이도 skill을 로드할 수 있음

## 검색 파이프라인

`src/extensibility/skills.ts`의 `discoverSkills()`는 두 단계로 수행됩니다:

1. **기능 프로바이더** — `loadCapability("skills")`를 통해
2. **커스텀 디렉터리** — `scanSkillsFromDir(..., { requireDescription: true })`를 통해 (1단계 디렉터리 열거)

`skills.enabled`가 `false`이면, 검색은 skill을 반환하지 않습니다.

### 내장 skill 프로바이더 및 우선순위

프로바이더 순서는 우선순위 높은 것이 먼저이며, 동점 시에는 등록 순서를 따릅니다.

현재 등록된 skill 프로바이더:

1. `native` (우선순위 100) — `src/discovery/builtin.ts`를 통한 `.xcsh` 사용자/프로젝트 skill
2. `claude` (우선순위 80)
3. 우선순위 70 그룹 (등록 순서):
   - `claude-plugins`
   - `agents`
   - `codex`

중복 제거 키는 skill 이름입니다. 주어진 이름의 첫 번째 항목이 우선합니다.

### 소스 토글 및 필터링

`discoverSkills()`는 다음 제어를 적용합니다:

- 소스 토글: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- skill 이름에 대한 글로브 필터:
  - `ignoredSkills` (제외)
  - `includeSkills` (포함 허용 목록; 비어 있으면 모두 포함)

필터 순서:

1. 소스 활성화 여부
2. 제외 목록에 없음
3. 포함 (포함 목록이 있는 경우)

codex/claude/native 이외의 프로바이더(예: `agents`, `claude-plugins`)의 경우, 활성화 여부는 현재 다음으로 폴백됩니다: **어느** 내장 소스 토글이든 활성화되어 있으면 활성화.

### 충돌 및 중복 처리

- 기능 중복 제거는 이미 이름당 첫 번째 skill을 유지함 (최고 우선순위 프로바이더)
- `extensibility/skills.ts`는 추가적으로:
  - `realpath`로 동일 파일을 중복 제거 (심볼릭 링크 안전)
  - 이후 skill 이름이 충돌할 때 충돌 경고 발생
  - `discoverSkillsFromDir({ dir, source })` 편의 API를 `scanSkillsFromDir`의 얇은 어댑터로 유지
- 커스텀 디렉터리 skill은 프로바이더 skill 이후에 병합되며 동일한 충돌 동작을 따름

## 런타임 사용 동작

### 시스템 프롬프트 노출

시스템 프롬프트 구성(`src/system-prompt.ts`)은 검색된 skill을 다음과 같이 사용합니다:

- `read` 도구를 사용할 수 있는 경우:
  - 프롬프트에 검색된 skill 목록 포함
- 그렇지 않은 경우:
  - 검색된 목록 생략

태스크 도구 서브에이전트는 일반 세션 생성을 통해 세션의 검색/제공된 skill 목록을 수신합니다; 태스크별 skill 고정 재정의는 없습니다.

### 대화형 `/skill:<name>` 명령

`skills.enableSkillCommands`가 true이면, 대화형 모드는 검색된 skill당 하나의 슬래시 명령을 등록합니다.

`/skill:<name> [args]` 동작:

- `filePath`에서 직접 skill 파일 읽기
- 프론트매터 제거
- skill 본문을 후속 커스텀 메시지로 주입
- 메타데이터 추가 (`Skill: <path>`, 선택적 `User: <args>`)

## `skill://` URL 동작

`src/internal-urls/skill-protocol.ts`는 다음을 지원합니다:

- `skill://<name>` → 해당 skill의 `SKILL.md`로 확인
- `skill://<name>/<relative-path>` → 해당 skill 디렉터리 내부로 확인

```text
skill:// URL 확인

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

보호:
- 절대 경로 거부
- `..` 트래버설 거부
- <pdf-base>를 벗어나는 확인된 경로 거부
```

확인 세부 사항:

- skill 이름은 정확히 일치해야 함
- 상대 경로는 URL 디코딩됨
- 절대 경로는 거부됨
- 경로 트래버설(`..`)은 거부됨
- 확인된 경로는 `baseDir` 내에 유지되어야 함
- 누락된 파일은 명시적인 `File not found` 오류 반환

콘텐츠 타입:

- `.md` => `text/markdown`
- 그 외 모든 것 => `text/plain`

누락된 에셋에 대한 폴백 검색은 수행되지 않습니다.

## Skills vs AGENTS.md, 명령, 도구, 훅

### Skills vs AGENTS.md

- **Skills**: 태스크 컨텍스트에 의해 선택되거나 명시적으로 요청되는 명명된 선택적 기능 팩
- **AGENTS.md/컨텍스트 파일**: 컨텍스트 파일 기능으로 로드되고 레벨/깊이 규칙에 따라 병합되는 지속적인 명령 파일

`src/discovery/agents-md.ts`는 특히 `cwd`에서 상위 디렉터리를 탐색하여 독립적인 `AGENTS.md` 파일을 검색합니다 (깊이 20까지), 숨겨진 디렉터리 세그먼트는 제외합니다.

### Skills vs 슬래시 명령

- **Skills**: 모델이 읽을 수 있는 지식/워크플로우 콘텐츠
- **슬래시 명령**: 사용자가 호출하는 명령 진입점
- `/skill:<name>`은 skill 텍스트를 주입하는 편의 래퍼입니다; skill 검색 의미론을 변경하지 않습니다

### Skills vs 커스텀 도구

- **Skills**: 프롬프트 컨텍스트와 `read`를 통해 로드되는 문서/워크플로우 콘텐츠
- **커스텀 도구**: 스키마와 런타임 부작용이 있는 모델이 호출할 수 있는 실행 가능한 도구 API

### Skills vs 훅

- **Skills**: 수동적 콘텐츠
- **훅**: 실행 중에 동작을 차단/수정할 수 있는 이벤트 기반 런타임 인터셉터

## 검색 로직에 연결된 실용적인 작성 지침

- 각 skill을 자체 디렉터리에 배치: `<skills-root>/<skill-name>/SKILL.md`
- 항상 명시적인 `name` 및 `description` 프론트매터 포함
- 참조된 에셋을 동일한 skill 디렉터리 아래에 두고 `skill://<name>/...`으로 접근
- 중첩 분류법(`team/domain/skill`)의 경우, `skills.customDirectories`를 중첩 상위 디렉터리로 지정; 스캐닝 자체는 비재귀적으로 유지
- 소스 간 중복 skill 이름 방지; 프로바이더 우선순위에 따라 첫 번째 매칭이 우선
