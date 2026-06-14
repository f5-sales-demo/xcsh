---
title: Gemini 매니페스트 확장
description: 크로스 플랫폼 스킬 및 에이전트 호환성을 위한 Gemini 매니페스트 확장 형식.
sidebar:
  order: 7
  label: Gemini 매니페스트
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Gemini 매니페스트 확장 (`gemini-extension.json`)

이 문서는 코딩 에이전트가 Gemini 스타일의 매니페스트 확장(`gemini-extension.json`)을 검색하고 파싱하여 `extensions` 기능으로 변환하는 방법을 다룹니다.

TypeScript/JavaScript 확장 모듈 로딩(`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`)은 다루지 **않으며**, 이는 `extension-loading.md`에 문서화되어 있습니다.

## 구현 파일

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## 검색 대상

Gemini 프로바이더(`id: gemini`, 우선순위 `60`)는 두 개의 고정 루트를 스캔하는 `extensions` 로더를 등록합니다:

- 사용자: `~/.gemini/extensions`
- 프로젝트: `<cwd>/.gemini/extensions`

경로 해석은 `getUserPath()` / `getProjectPath()`를 통해 `ctx.home` 및 `ctx.cwd`에서 직접 이루어집니다.

중요한 범위 규칙: 프로젝트 조회는 **cwd 전용**입니다. 상위 디렉터리를 탐색하지 않습니다.

---

## 디렉터리 스캔 규칙

각 루트(`~/.gemini/extensions` 및 `<cwd>/.gemini/extensions`)에 대해 검색은 다음을 수행합니다:

1. `readDirEntries(root)`
2. 직접 하위 디렉터리만 유지(`entry.isDirectory()`)
3. 각 하위 `<name>`에 대해 다음을 정확히 읽으려 시도:
   - `<root>/<name>/gemini-extension.json`

디렉터리 한 단계를 넘어서는 재귀 스캔은 없습니다.

### 숨김 디렉터리

Gemini 매니페스트 검색은 점(`.`)으로 시작하는 디렉터리 이름을 필터링하지 **않습니다**. 숨김 하위 디렉터리가 존재하고 `gemini-extension.json`을 포함하는 경우 해당 디렉터리는 검색 대상으로 간주됩니다.

### 누락/읽기 불가 파일

`gemini-extension.json`이 누락되거나 읽을 수 없는 경우 해당 디렉터리는 경고 없이 조용히 건너뜁니다.

---

## 매니페스트 형태 (구현 기준)

기능 타입은 다음과 같은 매니페스트 형태를 정의합니다:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

검색 시점의 동작은 의도적으로 느슨합니다:

- JSON 파싱 성공이 필요합니다.
- JSON 구문 외의 필드 타입/내용에 대한 런타임 스키마 검증은 없습니다.
- 파싱된 객체는 기능 항목의 `manifest`로 저장됩니다.

### 이름 정규화

`Extension.name`은 다음으로 설정됩니다:

1. `manifest.name`이 `null`/`undefined`가 아닌 경우 해당 값
2. 그렇지 않으면 확장 디렉터리 이름

여기서는 문자열 타입 강제가 적용되지 않습니다.

---

## 기능 항목으로의 구체화

유효하게 파싱된 매니페스트는 하나의 `Extension` 기능 항목을 생성합니다:

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // attached by capability registry
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

참고 사항:

- `_source.path`는 `createSourceMeta()`에 의해 절대 경로로 정규화됩니다.
- `extensions`에 대한 레지스트리 수준 기능 검증은 `name` 및 `path`의 존재 여부만 확인합니다.
- 매니페스트 내부(`mcpServers`, `tools`, `context`)는 검색 중에 검증되지 않습니다.

---

## 오류 처리 및 경고 의미론

### 경고 발생

- 매니페스트 파일의 유효하지 않은 JSON:
  - 경고 형식: `Invalid JSON in <manifestPath>`

### 경고 없음 (조용히 건너뜀)

- `extensions` 디렉터리 누락
- 하위 디렉터리에 `gemini-extension.json` 없음
- 읽기 불가 매니페스트 파일
- 매니페스트 JSON이 구문적으로는 유효하지만 의미론적으로 이상하거나 불완전함

즉, 부분적 유효성이 허용됩니다: 구문적 JSON 실패만 경고를 발생시킵니다.

---

## 다른 소스와의 우선순위 및 중복 제거

`extensions` 기능은 기능 레지스트리에 의해 프로바이더 간에 집계됩니다.

이 기능의 현재 프로바이더:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) 우선순위 `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) 우선순위 `60`

중복 제거 키는 `ext.name`입니다(`extensionCapability.key = ext => ext.name`).

### 프로바이더 간 우선순위

우선순위가 높은 프로바이더가 중복 확장 이름에서 승리합니다.

- `native`와 `gemini` 모두 확장 이름 `foo`를 내보내는 경우 native 항목이 유지됩니다.
- 우선순위가 낮은 중복은 `_shadowed = true`와 함께 `result.all`에만 보존됩니다.

### 프로바이더 내부 순서 효과

중복 제거가 "처음 확인된 것이 우선"이므로 프로바이더 로컬 항목 순서가 중요합니다.

- Gemini 로더는 **사용자를 먼저**, 그다음 **프로젝트**를 추가합니다.
- 따라서 `~/.gemini/extensions`와 `<cwd>/.gemini/extensions` 간의 중복 이름은 사용자 항목을 유지하고 프로젝트 항목을 그림자 처리합니다.

반면, native 프로바이더는 `getConfigDirs()`에서 설정 디렉터리 순서를 다르게 구성합니다(`project` 후 `user`). 따라서 native 프로바이더 내부 그림자 처리 방향은 반대입니다.

---

## 사용자 vs 프로젝트 동작 요약

Gemini 매니페스트에 대해 구체적으로:

- 매 로드 시 사용자 및 프로젝트 루트 모두 스캔됩니다.
- 프로젝트 루트는 `<cwd>/.gemini/extensions`로 고정됩니다(상위 디렉터리 탐색 없음).
- Gemini 소스 내의 중복 이름은 사용자 우선으로 해결됩니다.
- 우선순위가 높은 프로바이더(특히 native)에 대한 중복 이름은 우선순위에 의해 집니다.

---

## 경계: 검색 메타데이터 vs 런타임 확장 로딩

`gemini-extension.json` 검색은 현재 기능 메타데이터(`Extension` 항목)를 제공합니다. 실행 가능한 TS/JS 확장 모듈을 직접 로드하지는 **않습니다**.

런타임 모듈 로딩(`discoverAndLoadExtensions()` / `loadExtensions()`)은 `extension-modules`와 명시적 경로를 사용하며, 현재 자동 검색된 모듈을 프로바이더 `native`로만 필터링합니다.

실질적 의미:

- Gemini 매니페스트 확장은 기능 레코드로 검색 가능합니다.
- 확장 로더 파이프라인에 의해 자체적으로 런타임 확장 모듈로 실행되지는 않습니다.

이 경계는 현재 구현에서 의도적인 것이며, 매니페스트 검색과 실행 가능 모듈 로딩이 왜 분리될 수 있는지를 설명합니다.
