---
title: 확장 기능 로딩 (TypeScript/JavaScript 모듈)
description: '해석, 유효성 검증, 캐싱을 포함한 확장 기능용 TypeScript 및 JavaScript 모듈 로딩 파이프라인.'
sidebar:
  order: 2
  label: 확장 기능 로딩
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# 확장 기능 로딩 (TypeScript/JavaScript 모듈)

이 문서는 코딩 에이전트가 시작 시 **확장 모듈**(`.ts`/`.js`)을 검색하고 로드하는 방법을 다룹니다.

`gemini-extension.json` 매니페스트 확장은 다루지 **않으며**, 별도로 문서화되어 있습니다.

## 이 하위 시스템의 역할

확장 기능 로딩은 모듈 진입 파일 목록을 구성하고, Bun을 사용하여 각 모듈을 가져오고, 팩토리를 실행한 후 다음을 반환합니다:

- 로드된 확장 기능 정의
- 경로별 로드 오류 (전체 로드를 중단하지 않음)
- 이후 `ExtensionRunner`에서 사용하는 공유 확장 런타임 객체

## 주요 구현 파일

- `src/extensibility/extensions/loader.ts` — 경로 검색 + 가져오기/실행
- `src/extensibility/extensions/index.ts` — 공개 내보내기
- `src/extensibility/extensions/runner.ts` — 로드 후 런타임/이벤트 실행
- `src/discovery/builtin.ts` — 확장 모듈용 네이티브 자동 검색 프로바이더
- `src/config/settings.ts` — 병합된 `extensions` / `disabledExtensions` 설정 로드

---

## 확장 기능 로딩 입력

### 1) 자동 검색된 네이티브 확장 모듈

`discoverAndLoadExtensions()`는 먼저 검색 프로바이더에 `extension-module` 기능 항목을 요청한 다음, 프로바이더 `native` 항목만 유지합니다.

유효 네이티브 위치:

- 프로젝트: `<cwd>/.xcsh/extensions`
- 사용자: `~/.xcsh/agent/extensions`

경로 루트는 네이티브 프로바이더(`SOURCE_PATHS.native`)에서 가져옵니다.

참고:

- 네이티브 자동 검색은 현재 `.xcsh` 기반입니다.
- 레거시 `.pi`는 `package.json` 매니페스트 키(`pi.extensions`)에서 여전히 허용되지만, 여기서 네이티브 루트로는 사용되지 않습니다.

### 2) 명시적으로 구성된 경로

자동 검색 후, 구성된 경로가 추가되고 해석됩니다.

주요 세션 시작 경로(`sdk.ts`)에서의 구성된 경로 소스:

1. CLI 제공 경로 (`--extension/-e`, `--hook`도 확장 경로로 처리됨)
2. 설정의 `extensions` 배열 (전역 + 프로젝트 설정 병합)

전역 설정 파일:

- `~/.xcsh/agent/config.yml` (또는 `PI_CODING_AGENT_DIR`을 통한 사용자 정의 에이전트 디렉터리)

프로젝트 설정 파일:

- `<cwd>/.xcsh/settings.json`

예시:

```yaml
# ~/.xcsh/agent/config.yml
extensions:
  - ~/my-exts/safety.ts
  - ./local/ext-pack
```

```json
{
  "extensions": ["./.xcsh/extensions/my-extra"]
}
```

---

## 활성화/비활성화 제어

### 검색 비활성화

- CLI: `--no-extensions`
- SDK 옵션: `disableExtensionDiscovery`

동작 분기:

- SDK: `disableExtensionDiscovery=true`일 때에도 `loadExtensions()`를 통해 `additionalExtensionPaths`는 여전히 로드합니다.
- CLI 경로 구성(`main.ts`)은 현재 `--no-extensions`가 설정되면 CLI 확장 경로를 초기화하므로, 해당 모드에서는 명시적 `-e/--hook`이 전달되지 않습니다.

### 특정 확장 모듈 비활성화

`disabledExtensions` 설정은 확장 ID 형식으로 필터링합니다:

- `extension-module:<derivedName>`

`derivedName`은 진입 경로를 기반으로 합니다(`getExtensionNameFromPath`). 예시:

- `/x/foo.ts` -> `foo`
- `/x/bar/index.ts` -> `bar`

예시:

```yaml
disabledExtensions:
  - extension-module:foo
```

---

## 경로 및 진입점 해석

### 경로 정규화

구성된 경로의 경우:

1. 유니코드 공백 정규화
2. `~` 확장
3. 상대 경로인 경우, 현재 `cwd` 기준으로 해석

### 구성된 경로가 파일인 경우

모듈 진입 후보로 직접 사용됩니다.

### 구성된 경로가 디렉터리인 경우

해석 순서:

1. 해당 디렉터리의 `package.json`에 `xcsh.extensions` (또는 레거시 `pi.extensions`)가 있는 경우 -> 선언된 진입점 사용
2. `index.ts`
3. `index.js`
4. 그 외에는 한 단계 레벨에서 확장 진입점을 스캔:
   - 직접 `*.ts` / `*.js`
   - 하위 디렉터리 `index.ts` / `index.js`
   - 하위 디렉터리 `package.json`에 `xcsh.extensions` / `pi.extensions`

규칙 및 제약:

- 하위 디렉터리 한 단계를 넘어서는 재귀적 검색 없음
- 선언된 `extensions` 매니페스트 진입점은 해당 패키지 디렉터리 기준으로 해석됨
- 선언된 진입점은 파일이 존재하고 접근이 허용된 경우에만 포함됨
- `*/index.{ts,js}` 쌍에서는 TypeScript가 JavaScript보다 우선됨
- 심볼릭 링크는 적격 파일/디렉터리로 처리됨

### 무시 동작은 소스에 따라 다름

- 네이티브 자동 검색(검색 헬퍼의 `discoverExtensionModulePaths`)은 `gitignore: true` 및 `hidden: false`로 네이티브 glob를 사용합니다.
- `loader.ts`의 명시적 구성 디렉터리 스캔은 `readdir` 규칙을 사용하며, gitignore 필터링을 적용하지 **않습니다**.

---

## 로드 순서 및 우선순위

`discoverAndLoadExtensions()`는 하나의 정렬된 목록을 구성한 후 `loadExtensions()`를 호출합니다.

순서:

1. 네이티브 자동 검색된 모듈
2. 명시적으로 구성된 경로 (제공된 순서대로)

`sdk.ts`에서 구성 순서는:

1. CLI 추가 경로
2. 설정의 `extensions`

중복 제거:

- 절대 경로 기반
- 먼저 발견된 경로가 우선
- 이후 중복은 무시됨

의미: 동일한 모듈 경로가 자동 검색과 명시적 구성 모두에 존재하는 경우, 첫 번째 위치(자동 검색 단계)에서 한 번만 로드됩니다.

---

## 모듈 가져오기 및 팩토리 계약

각 후보 경로는 동적 가져오기로 로드됩니다:

- `await import(resolvedPath)`
- 팩토리는 `module.default ?? module`
- 팩토리는 함수여야 합니다 (`ExtensionFactory`)

내보내기가 함수가 아닌 경우, 해당 경로는 구조화된 오류와 함께 실패하며 로딩은 계속됩니다.

---

## 실패 처리 및 격리

### 로딩 중

확장 경로별로 실패는 `{ path, error }`로 캡처되며, 다른 경로의 로딩을 중단하지 않습니다.

일반적인 경우:

- 가져오기 실패 / 파일 누락
- 잘못된 팩토리 내보내기 (함수가 아닌 경우)
- 팩토리 실행 중 예외 발생

### 런타임 격리 모델

- 확장 기능은 **샌드박스가 아닙니다** (동일한 프로세스/런타임).
- 하나의 `EventBus`와 하나의 `ExtensionRuntime` 인스턴스를 공유합니다.
- 로드 중에는 런타임 액션 메서드가 의도적으로 `ExtensionRuntimeNotInitializedError`를 발생시키며, 액션 연결은 이후 `ExtensionRunner.initialize()`에서 수행됩니다.

### 로딩 후

`ExtensionRunner`를 통해 이벤트가 실행될 때, 핸들러 예외는 포착되어 러너 루프를 중단시키는 대신 확장 오류로 발행됩니다.

---

## 최소 사용자/프로젝트 레이아웃 예시

### 사용자 수준

```text
~/.xcsh/agent/
  config.yml
  extensions/
    guardrails.ts
    audit/
      index.ts
```

### 프로젝트 수준

```text
<repo>/
  .xcsh/
    settings.json
    extensions/
      checks/
        package.json
      lint-gates.ts
```

`checks/package.json`:

```json
{
  "xcsh": {
    "extensions": ["./src/check-a.ts", "./src/check-b.js"]
  }
}
```

여전히 허용되는 레거시 매니페스트 키:

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
