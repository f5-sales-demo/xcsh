---
title: Plugin Manager and Installer Plumbing
description: >-
  Plugin manager internals covering installation, validation, dependency
  resolution, and lifecycle management.
sidebar:
  order: 5
  label: Plugin manager
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# 플러그인 관리자 및 설치 프로그램 내부 구조

이 문서는 `xcsh plugin` 작업이 디스크의 플러그인 상태를 어떻게 변경하는지, 그리고 설치된 플러그인이 런타임 기능(현재 도구, 훅/명령어 경로 해석 가능)이 되는 과정을 설명합니다.

## 범위 및 아키텍처

코드베이스에는 두 가지 플러그인 관리 구현이 있습니다:

1. **CLI 명령어가 사용하는 활성 경로**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **레거시 헬퍼 모듈**: 설치 함수들 (`src/extensibility/plugins/installer.ts`)

`xcsh plugin ...` 명령 실행은 `PluginManager`를 통해 이루어집니다.

`installer.ts`는 여전히 중요한 안전 검사와 파일시스템 동작을 문서화하고 있지만, `src/commands/plugin.ts` + `src/cli/plugin-cli.ts`가 사용하는 경로는 아닙니다.

## 생명주기: CLI 호출에서 런타임 사용 가능까지

```text
xcsh plugin <action> ...
  -> src/commands/plugin.ts
  -> runPluginCommand(...) in src/cli/plugin-cli.ts
  -> PluginManager method (install/list/uninstall/link/...) 
  -> mutate ~/.xcsh/plugins/{package.json,node_modules,xcsh-plugins.lock.json}
  -> runtime discovery: discoverAndLoadCustomTools(...)
  -> getAllPluginToolPaths(cwd)
  -> custom tool loader imports tool modules
```

### 명령어 진입점

- `src/commands/plugin.ts`는 명령어/플래그를 정의하고 `runPluginCommand`로 전달합니다.
- `src/cli/plugin-cli.ts`는 하위 명령어를 `PluginManager` 메서드에 매핑합니다:
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- 명시적인 `update` 액션은 존재하지 않습니다. 업데이트는 새로운 패키지/버전 스펙으로 `install`을 다시 실행하여 수행합니다.

## 디스크 모델

전역 플러그인 상태는 `~/.xcsh/plugins` 아래에 위치합니다:

- `package.json` — `bun install`/`bun uninstall`이 사용하는 의존성 매니페스트
- `node_modules/` — 설치된 플러그인 패키지 또는 심볼릭 링크
- `xcsh-plugins.lock.json` — 런타임 상태:
  - 플러그인별 활성화/비활성화
  - 플러그인별 선택된 기능 세트
  - 영속화된 플러그인 설정

프로젝트 로컬 오버라이드는 다음 위치에 있습니다:

- `<cwd>/.xcsh/plugin-overrides.json`

오버라이드는 관리자/로더 관점에서 읽기 전용이며(여기서 쓰기 경로 없음) 이 프로젝트에 대해 플러그인을 비활성화하거나 기능/설정을 재정의할 수 있습니다.

## 플러그인 스펙 파싱 및 메타데이터 해석

## 설치 스펙 문법

`parsePluginSpec` (`parser.ts`)는 다음을 지원합니다:

- `pkg` -> `features: null` (기본 동작)
- `pkg[*]` -> 모든 매니페스트 기능 활성화
- `pkg[]` -> 선택적 기능 활성화 없음
- `pkg[a,b]` -> 지정된 기능 활성화
- `@scope/pkg@1.2.3[feat]` -> 명시적 기능 선택이 포함된 스코프 + 버전 지정 패키지

`extractPackageName`은 설치 후 디스크 경로 조회를 위해 버전 접미사를 제거합니다.

## 매니페스트 소스 및 필수 필드

매니페스트는 다음 순서로 해석됩니다:

1. `package.json.xcsh`
2. 폴백 `package.json.pi`
3. 폴백 `{ version: package.version }`

의미:

- 관리자/로더에 엄격한 스키마 유효성 검사가 없습니다.
- `xcsh`/`pi`가 없는 패키지도 설치 가능하고 목록에 표시됩니다.
- 런타임 플러그인 로딩(`getEnabledPlugins`)은 `xcsh`/`pi` 매니페스트가 없는 패키지를 건너뜁니다.
- `manifest.version`은 항상 패키지 `version`으로 덮어쓰여집니다.

형식이 잘못된 `package.json` JSON은 읽기 시점에 치명적 실패를 발생시킵니다. 형식이 잘못된 매니페스트 구조는 특정 필드가 사용될 때에만 나중에 실패할 수 있습니다.

## 설치/업데이트 흐름 (`PluginManager.install`)

1. 설치 스펙에서 기능 괄호 구문을 파싱합니다.
2. 정규식 + 셸 메타문자 거부 목록에 대해 패키지 이름을 검증합니다.
3. 플러그인 `package.json`이 존재하는지 확인합니다(`xcsh-plugins`, private 의존성 맵).
4. `~/.xcsh/plugins`에서 `bun install <packageSpec>`을 실행합니다.
5. 설치된 패키지 `node_modules/<name>/package.json`을 읽습니다.
6. 매니페스트를 해석하고 `enabledFeatures`를 계산합니다:
   - `[*]`: 선언된 모든 기능 (기능 맵이 없으면 `null`)
   - `[a,b]`: 각 기능이 매니페스트 기능 맵에 존재하는지 검증
   - `[]`: 빈 기능 목록
   - 일반 스펙: `null` (나중에 로더에서 기본 정책 사용)
7. 잠금 파일 런타임 상태를 upsert합니다: `{ version, enabledFeatures, enabled: true }`.

### 업데이트 의미론

업데이트가 설치 기반이므로:

- `xcsh plugin install pkg@newVersion`은 의존성과 잠금 파일 버전을 업데이트합니다.
- 기존 설정은 보존됩니다. 상태 항목은 버전/기능/활성화에 대해 덮어쓰여집니다.
- 별도의 "업데이트 확인"이나 트랜잭션 마이그레이션 로직은 존재하지 않습니다.

## 제거 흐름 (`PluginManager.uninstall`)

1. 패키지 이름을 검증합니다.
2. 플러그인 디렉토리에서 `bun uninstall <name>`을 실행합니다.
3. 잠금 파일에서 플러그인 런타임 상태를 제거합니다:
   - `config.plugins[name]`
   - `config.settings[name]`

제거 명령이 실패하면 런타임 상태는 변경되지 않습니다.

## 목록 흐름 (`PluginManager.list`)

1. `~/.xcsh/plugins/package.json`에서 플러그인 의존성 맵을 읽습니다.
2. 잠금 파일 런타임 설정을 로드합니다(파일 없음 -> 빈 기본값).
3. 프로젝트 오버라이드를 로드합니다(`<cwd>/.xcsh/plugin-overrides.json`, 파싱/읽기 오류 -> 경고와 함께 빈 객체).
4. 해석 가능한 package.json이 있는 각 의존성에 대해:
   - `InstalledPlugin` 레코드를 구성합니다
   - 기능/활성화 상태를 병합합니다:
     - 잠금 파일에서 기본값(또는 기본 설정)
     - 프로젝트 오버라이드가 기능 선택을 대체할 수 있음
     - 프로젝트 `disabled` 목록이 플러그인을 비활성화로 마스킹

이것은 CLI 상태 출력과 설정/기능 작업에서 사용되는 유효 상태입니다.

## 링크 흐름 (`PluginManager.link`)

`link`는 로컬 패키지를 `~/.xcsh/plugins/node_modules/<pkg.name>`에 심볼릭 링크하여 로컬 플러그인 개발을 지원합니다.

동작:

1. 관리자 cwd에 대해 `localPath`를 해석합니다.
2. 로컬 `package.json`과 `name` 필드가 필요합니다.
3. 플러그인 디렉토리가 존재하는지 확인합니다.
4. 스코프 이름의 경우 스코프 디렉토리를 생성합니다.
5. 대상 링크 위치의 기존 경로를 제거합니다.
6. 심볼릭 링크를 생성합니다.
7. 기본 기능(`null`)으로 활성화된 런타임 잠금 파일 항목을 추가합니다.

주의사항: 현재 `PluginManager.link`는 레거시 `installer.ts`에 있는 `cwd` 경로 경계 검사(`normalizedPath.startsWith(normalizedCwd)`)를 적용하지 않으므로, 신뢰는 호출자의 책임입니다.

## 런타임 로딩: 설치된 플러그인에서 호출 가능한 기능으로

## 검색 게이트

`getEnabledPlugins(cwd)` (`plugins/loader.ts`)는 다음을 읽습니다:

- 플러그인 의존성 매니페스트 (`package.json`)
- 잠금 파일 런타임 상태
- `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`를 통한 프로젝트 오버라이드

필터링:

- 플러그인 package.json이 없으면 건너뜀
- 매니페스트(`xcsh`/`pi`)가 없으면 건너뜀
- 잠금 파일에서 전역적으로 비활성화되어 있으면 건너뜀
- 프로젝트에서 비활성화되어 있으면 건너뜀

## 기능 경로 해석

각 활성화된 플러그인에 대해:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

각 해석기는 기본 항목과 기능 항목을 포함합니다:

- 명시적 기능 목록 -> 선택된 기능만
- `enabledFeatures === null` -> `default: true`로 표시된 기능 활성화

누락된 파일은 조용히 건너뜁니다(`existsSync` 가드).

## 현재 런타임 연결 차이점

- **도구는 현재 런타임에 연결됩니다** `discoverAndLoadCustomTools` (`custom-tools/loader.ts`)를 통해, 이는 `getAllPluginToolPaths(cwd)`를 호출합니다.
- 경로는 커스텀 도구 검색에서 해석된 절대 경로에 의해 중복 제거됩니다(`seen` 세트, 첫 번째 경로가 우선).
- **훅/명령어 해석기는 존재하며** 내보내집니다. 그러나 이 코드 경로는 현재 도구가 연결되는 것과 동일한 방식으로 런타임 레지스트리에 연결되지 않습니다.

## 잠금/상태 관리 세부사항

`PluginManager`는 인스턴스별로 런타임 설정을 메모리에 캐시하며(`#runtimeConfig`), 지연 로드를 한 번 수행합니다.

로드 동작:

- 잠금 파일 없음 -> `{ plugins: {}, settings: {} }`
- 잠금 파일 읽기/파싱 실패 -> 경고 + 동일한 빈 기본값

저장 동작:

- 각 변경 시 전체 잠금 파일 JSON을 정렬된 형태로 기록

크로스 프로세스 잠금이나 병합 전략이 존재하지 않습니다. 동시 기록자가 서로를 덮어쓸 수 있습니다.

## 안전 검사 및 신뢰 경계

## 입력/패키지 검증

활성 관리자 경로는 패키지 이름 검증을 적용합니다:

- 스코프/비스코프 패키지 스펙에 대한 정규식 (선택적으로 버전 포함)
- 명시적 셸 메타문자 거부 목록 (`[;&|`$(){}[]<>\\]`)

이는 `bun install/uninstall` 호출 시 명령 주입 위험을 제한합니다.

## 파일시스템 신뢰 경계

- 플러그인 코드는 커스텀 도구 모듈이 임포트될 때 프로세스 내에서 실행됩니다. 샌드박싱은 없습니다.
- 매니페스트 상대 경로는 플러그인 패키지 디렉토리에 대해 결합되며 존재 여부만 확인됩니다.
- 플러그인 패키지 자체는 설치되면 신뢰된 코드로 간주됩니다.

## 레거시 설치 프로그램 전용 검사

`installer.ts`는 `PluginManager.link`에 미러링되지 않은 추가 링크 시점 검사를 포함합니다:

- 로컬 경로가 프로젝트 cwd 내부로 해석되어야 함
- 심볼릭 링크 대상 이름 지정을 위한 추가 패키지 이름/경로 순회 가드

CLI가 `PluginManager`를 사용하므로, 이러한 더 엄격한 링크 가드는 현재 메인 경로에 있지 않습니다.

## 실패, 부분 성공 및 롤백 동작

플러그인 관리자는 트랜잭션 방식이 아닙니다.

| 작업 단계 | 실패 동작 | 롤백 |
| --- | --- | --- |
| `bun install` 실패 | stderr와 함께 설치 중단 | 해당 없음 (아직 상태 기록 없음) |
| 설치 성공 후 매니페스트/기능 검증 실패 | 명령 실패 | 제거 롤백 없음; 의존성이 `node_modules`/`package.json`에 남아있을 수 있음 |
| 설치 성공 후 잠금 파일 기록 실패 | 명령 실패 | 설치된 패키지 롤백 없음 |
| `bun uninstall` 성공 후 잠금 파일 기록 실패 | 명령 실패 | 패키지 제거됨, 오래된 런타임 상태가 남아있을 수 있음 |
| `link`가 이전 대상을 제거한 후 심볼릭 링크 생성 실패 | 명령 실패 | 이전 링크/디렉토리 복원 없음 |

운영적으로 `doctor --fix`는 일부 드리프트를 복구할 수 있습니다(`bun install`, 고아 설정 정리, 잘못된 기능 정리). 그러나 이는 최선의 노력입니다.

## 형식 오류/누락 매니페스트 동작 요약

- `xcsh`/`pi` 필드 누락:
  - install/list: 허용됨 (최소 매니페스트)
  - 런타임 활성화 플러그인 검색: 비플러그인으로 건너뜀
- 설치 스펙이나 `features --set/--enable`에서 참조된 누락 기능: 사용 가능한 기능 목록과 함께 치명적 오류
- 잘못된 `plugin-overrides.json`: 관리자와 로더 경로 모두에서 `{}`로 폴백하여 무시됨
- 매니페스트에서 참조된 누락 도구/훅/명령어 파일 경로: 해석기 확장 중 조용히 무시됨; `doctor`에 의해서만 오류로 표시됨

## 모드 차이점 및 우선순위

- `--dry-run` (install): 합성 설치 결과를 반환하며, 파일시스템/네트워크/상태 기록 없음.
- `--json`: 출력 형식만 변경, 동작 변경 없음.
- 프로젝트 오버라이드는 기능/설정 뷰에서 항상 전역 잠금 파일보다 우선합니다.
- 유효 활성화 상태는 `runtimeEnabled && !projectDisabled`입니다.

## 구현 파일

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — CLI 명령어 선언 및 플래그 매핑
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — 액션 디스패치, 사용자 대면 명령 핸들러
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — 활성 install/remove/list/link/state/doctor 구현
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — 레거시 설치 헬퍼 및 추가 링크 안전 검사
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — 활성화된 플러그인 검색 및 도구/훅/명령어 경로 해석
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — 설치 스펙 및 패키지 이름 파싱 헬퍼
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — 매니페스트/런타임/오버라이드 타입 계약
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — 플러그인 제공 도구 모듈의 런타임 연결
