---
title: 구성 검색 및 해석
description: 'xcsh가 프로젝트, 사용자, 기업 루트에서 구성을 검색하고, 해석하며, 계층화하는 방법.'
sidebar:
  order: 1
  label: 구성
i18n:
  sourceHash: a8d23493ed0d
  translator: machine
---

# 구성 검색 및 해석

이 문서는 coding-agent가 현재 구성을 해석하는 방법을 설명합니다: 어떤 루트가 스캔되는지, 우선순위가 어떻게 작동하는지, 해석된 구성이 설정, 스킬, 훅, 도구, 확장에 의해 어떻게 소비되는지를 다룹니다.

## 범위

주요 구현:

- `src/config.ts`
- `src/config/settings.ts`
- `src/config/settings-schema.ts`
- `src/discovery/builtin.ts`
- `src/discovery/helpers.ts`

주요 통합 지점:

- `src/capability/index.ts`
- `src/discovery/index.ts`
- `src/extensibility/skills.ts`
- `src/extensibility/hooks/loader.ts`
- `src/extensibility/custom-tools/loader.ts`
- `src/extensibility/extensions/loader.ts`

---

## 해석 흐름 (시각화)

```text
         Config roots (ordered)
┌───────────────────────────────────────┐
│ 1) ~/.xcsh/agent + <cwd>/.xcsh          │
│ 2) ~/.claude   + <cwd>/.claude        │
│ 3) ~/.codex    + <cwd>/.codex         │
│ 4) ~/.gemini   + <cwd>/.gemini        │
└───────────────────────────────────────┘
                    │
                    ▼
        config.ts helper resolution
  (getConfigDirs/findConfigFile/findNearest...)
                    │
                    ▼
       capability providers enumerate items
 (native, claude, codex, gemini, agents, etc.)
                    │
                    ▼
      priority sort + per-capability dedup
                    │
                    ▼
          subsystem-specific consumption
   (settings, skills, hooks, tools, extensions)
```

## 1) 구성 루트 및 소스 순서

## 표준 루트

`src/config.ts`는 고정된 소스 우선순위 목록을 정의합니다:

1. `.xcsh` (네이티브)
2. `.claude`
3. `.codex`
4. `.gemini`

사용자 수준 기본 경로:

- `~/.xcsh/agent`
- `~/.claude`
- `~/.codex`
- `~/.gemini`

프로젝트 수준 기본 경로:

- `<cwd>/.xcsh`
- `<cwd>/.claude`
- `<cwd>/.codex`
- `<cwd>/.gemini`

`CONFIG_DIR_NAME`은 `.xcsh`입니다 (`packages/utils/src/dirs.ts`).

## 중요한 제약 사항

`src/config.ts`의 범용 헬퍼는 소스 검색 순서에 `.pi`를 포함하지 **않습니다**.

---

## 2) 핵심 검색 헬퍼 (`src/config.ts`)

## `getConfigDirs(subpath, options)`

정렬된 항목을 반환합니다:

- 사용자 수준 항목이 먼저 (소스 우선순위에 따라)
- 그 다음 프로젝트 수준 항목 (동일한 소스 우선순위에 따라)

옵션:

- `user` (기본값 `true`)
- `project` (기본값 `true`)
- `cwd` (기본값 `getProjectDir()`)
- `existingOnly` (기본값 `false`)

이 API는 디렉터리 기반 구성 조회(커맨드, 훅, 도구, 에이전트 등)에 사용됩니다.

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

정렬된 기본 경로에서 첫 번째로 존재하는 파일을 검색하고, 첫 번째 일치 항목을 반환합니다 (경로만 또는 경로+메타데이터).

## `findAllNearestProjectConfigDirs(subpath, cwd)`

상위 디렉터리를 위쪽으로 순회하며 **소스 기본 경로별로 가장 가까운 기존 디렉터리**를 반환합니다 (`.xcsh`, `.claude`, `.codex`, `.gemini`), 그런 다음 결과를 소스 우선순위에 따라 정렬합니다.

프로젝트 구성이 상위 디렉터리에서 상속되어야 하는 경우(모노레포/중첩 워크스페이스 동작)에 이것을 사용하세요.

---

## 3) 파일 구성 래퍼 (`src/config.ts`의 `ConfigFile<T>`)

`ConfigFile<T>`는 단일 구성 파일용 스키마 검증 로더입니다.

지원 형식:

- `.yml` / `.yaml`
- `.json` / `.jsonc`

동작:

- 파싱된 데이터를 제공된 TypeBox 스키마에 대해 AJV로 검증합니다.
- `invalidate()`가 호출될 때까지 로드 결과를 캐시합니다.
- `tryLoad()`를 통해 3가지 상태 결과를 반환합니다:
  - `ok`
  - `not-found`
  - `error` (스키마/파싱 컨텍스트를 포함한 `ConfigError`)

레거시 마이그레이션이 여전히 지원됩니다:

- 대상 경로가 `.yml`/`.yaml`인 경우, 형제 `.json` 파일이 한 번 자동 마이그레이션됩니다 (`migrateJsonToYml`).

---

## 4) 설정 해석 모델 (`src/config/settings.ts`)

런타임 설정 모델은 계층화되어 있습니다:

1. 전역 설정: `~/.xcsh/agent/config.yml`
2. 프로젝트 설정: 설정 기능을 통해 검색됨 (제공자의 `settings.json`)
3. 런타임 오버라이드: 메모리 내, 비영구적
4. 스키마 기본값: `SETTINGS_SCHEMA`에서 제공

유효 읽기 경로:

`defaults <- global <- project <- overrides`

쓰기 동작:

- `settings.set(...)`은 **전역** 레이어 (`config.yml`)에 쓰고 백그라운드 저장을 큐에 넣습니다.
- 프로젝트 설정은 기능 검색에서 읽기 전용입니다.

## 마이그레이션 동작이 여전히 활성화됨

시작 시 `config.yml`이 없는 경우:

1. `~/.xcsh/agent/settings.json`에서 마이그레이션 (성공 시 `.bak`으로 이름 변경)
2. `agent.db`의 레거시 DB 설정과 병합
3. 병합된 결과를 `config.yml`에 기록

`#migrateRawSettings`의 필드 수준 마이그레이션:

- `queueMode` -> `steeringMode`
- `ask.timeout` 밀리초 -> 이전 값이 ms처럼 보일 때(`> 1000`) 초로 변환
- 레거시 플랫 `theme: "..."` -> `theme.dark/theme.light` 구조

---

## 5) 기능/검색 통합

대부분의 비핵심 구성 로딩은 기능 레지스트리를 통해 이루어집니다 (`src/capability/index.ts` + `src/discovery/index.ts`).

## 제공자 순서

제공자는 숫자 우선순위에 따라 정렬됩니다 (높을수록 우선). 예시 우선순위:

- 네이티브 OMP (`builtin.ts`): `100`
- Claude: `80`
- Codex / agents / Claude 마켓플레이스: `70`
- Gemini: `60`

```text
Provider precedence (higher wins)

native (.xcsh)          priority 100
claude                 priority  80
codex / agents / ...   priority  70
gemini                 priority  60
```

## 중복 제거 의미

기능은 `key(item)`을 정의합니다:

- 동일한 키 => 첫 번째 항목이 우선 (더 높은 우선순위/먼저 로드된 항목)
- 키 없음 (`undefined`) => 중복 제거 없음, 모든 항목 유지

관련 키:

- 스킬: `name`
- 도구: `name`
- 훅: `${type}:${tool}:${name}`
- 확장 모듈: `name`
- 확장: `name`
- 설정: 중복 제거 없음 (모든 항목 보존)

---

## 6) 네이티브 `.xcsh` 제공자 동작 (`src/discovery/builtin.ts`)

네이티브 제공자 (`id: native`)는 다음에서 읽습니다:

- 프로젝트: `<cwd>/.xcsh/...`
- 사용자: `~/.xcsh/agent/...`

### 디렉터리 허용 규칙

`builtin.ts`는 디렉터리가 존재**하고 비어 있지 않은** 경우에만 구성 루트를 포함합니다 (`ifNonEmptyDir`).

### 범위별 로딩

- 스킬: `skills/*/SKILL.md`
- 슬래시 커맨드: `commands/*.md`
- 규칙: `rules/*.{md,mdc}`
- 프롬프트: `prompts/*.md`
- 지시사항: `instructions/*.md`
- 훅: `hooks/pre/*`, `hooks/post/*`
- 도구: `tools/*.json|*.md` 및 `tools/<name>/index.ts`
- 확장 모듈: `extensions/` 하위에서 검색됨 (+ 레거시 `settings.json.extensions` 문자열 배열)
- 확장: `extensions/<name>/gemini-extension.json`
- 설정 기능: `settings.json`

### 가장 가까운 프로젝트 조회 세부 사항

`SYSTEM.md`와 `AGENTS.md`의 경우, 네이티브 제공자는 가장 가까운 상위 프로젝트 `.xcsh` 디렉터리 검색(상위 순회)을 사용하지만 여전히 `.xcsh` 디렉터리가 비어 있지 않아야 합니다.

---

## 7) 주요 서브시스템의 구성 소비 방식

## 설정 서브시스템

- `Settings.init()`은 전역 `config.yml` + 검색된 프로젝트 `settings.json` 기능 항목을 로드합니다.
- `level === "project"`인 기능 항목만 프로젝트 레이어에 병합됩니다.

## 스킬 서브시스템

- `extensibility/skills.ts`는 `loadCapability(skillCapability.id, { cwd })`를 통해 로드합니다.
- 소스 토글 및 필터를 적용합니다 (`ignoredSkills`, `includeSkills`, 사용자 지정 디렉터리).
- 레거시 명명된 토글이 여전히 존재합니다 (`skills.enablePiUser`, `skills.enablePiProject`) 하지만 이들은 네이티브 제공자를 제어합니다 (`provider === "native"`).

## 훅 서브시스템

- `discoverAndLoadHooks()`는 훅 기능 + 명시적으로 구성된 경로에서 훅 경로를 해석합니다.
- 그런 다음 Bun import를 통해 모듈을 로드합니다.

## 도구 서브시스템

- `discoverAndLoadCustomTools()`는 도구 기능 + 플러그인 도구 경로 + 명시적으로 구성된 경로에서 도구 경로를 해석합니다.
- 선언적 `.md/.json` 도구 파일은 메타데이터 전용입니다; 실행 가능한 로딩은 코드 모듈을 기대합니다.

## 확장 서브시스템

- `discoverAndLoadExtensions()`는 확장 모듈 기능 + 명시적 경로에서 확장 모듈을 해석합니다.
- 현재 구현은 의도적으로 로딩 전에 `_source.provider === "native"`인 기능 항목만 유지합니다.

---

## 8) 의존할 수 있는 우선순위 규칙

다음 멘탈 모델을 사용하세요:

1. `config.ts`의 소스 디렉터리 순서가 후보 경로 순서를 결정합니다.
2. 기능 제공자 우선순위가 제공자 간 우선순위를 결정합니다.
3. 기능 키 중복 제거가 충돌 동작을 결정합니다 (키가 있는 기능의 경우 첫 번째가 우선).
4. 서브시스템별 병합 로직이 유효 우선순위를 추가로 변경할 수 있습니다 (특히 설정).

### 설정 관련 주의 사항

설정 기능 항목은 중복 제거되지 않습니다; `Settings.#loadProjectSettings()`는 반환된 순서대로 프로젝트 항목을 깊은 병합합니다. 병합은 이전 값 위에 나중 항목 값을 적용하므로, 유효 오버라이드 동작은 기능 키 의미만이 아닌 제공자 발행 순서에 따라 달라집니다.

---

## 9) 여전히 존재하는 레거시/호환성 동작

- YAML 대상 파일에 대한 `ConfigFile` JSON -> YAML 마이그레이션.
- `settings.json` 및 `agent.db`에서 `config.yml`로의 설정 마이그레이션.
- 설정 키 마이그레이션 (`queueMode`, `ask.timeout`, 플랫 `theme`).
- 확장 매니페스트 호환성: 로더가 `package.json.xcsh`와 `package.json.pi` 매니페스트 섹션 모두를 수용합니다.
- 레거시 설정 이름 `skills.enablePiUser` / `skills.enablePiProject`는 네이티브 스킬 소스에 대해 여전히 활성 게이트입니다.

이러한 호환성 경로가 코드에서 제거되면 이 문서를 즉시 업데이트하세요; 현재 여러 런타임 동작이 여전히 이들에 의존하고 있습니다.
