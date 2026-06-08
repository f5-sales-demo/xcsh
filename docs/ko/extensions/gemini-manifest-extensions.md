---
title: Gemini Manifest Extensions
description: >-
  Gemini manifest extension format for cross-platform skill and agent
  compatibility.
sidebar:
  order: 7
  label: Gemini manifest
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Gemini 매니페스트 확장 (`gemini-extension.json`)

이 문서는 코딩 에이전트가 Gemini 스타일 매니페스트 확장(`gemini-extension.json`)을 발견하고 `extensions` 기능으로 파싱하는 방법을 다룹니다.

TypeScript/JavaScript 확장 모듈 로딩(`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`)은 다루지 **않으며**, 이는 `extension-loading.md`에 문서화되어 있습니다.

## 구현 파일

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## 발견되는 항목

Gemini 프로바이더(`id: gemini`, 우선순위 `60`)는 두 개의 고정 루트를 스캔하는 `extensions` 로더를 등록합니다:

- 사용자: `~/.gemini/extensions`
- 프로젝트: `<cwd>/.gemini/extensions`

경로 해석은 `getUserPath()` / `getProjectPath()`를 통해 `ctx.home`과 `ctx.cwd`에서 직접 수행됩니다.

중요한 범위 규칙: 프로젝트 조회는 **cwd 전용**입니다. 상위 디렉토리를 탐색하지 않습니다.

---

## 디렉토리 스캔 규칙

각 루트(`~/.gemini/extensions` 및 `<cwd>/.gemini/extensions`)에 대해 발견 프로세스는 다음을 수행합니다:

1. `readDirEntries(root)`
2. 직접 하위 디렉토리만 유지 (`entry.isDirectory()`)
3. 각 하위 `<name>`에 대해 정확히 다음을 읽기 시도:
   - `<root>/<name>/gemini-extension.json`

한 디렉토리 레벨 이상의 재귀 스캔은 수행되지 않습니다.

### 숨김 디렉토리

Gemini 매니페스트 발견은 점(dot) 접두사가 붙은 디렉토리 이름을 필터링하지 **않습니다**. 숨김 하위 디렉토리가 존재하고 `gemini-extension.json`을 포함하고 있으면 해당 항목이 고려됩니다.

### 누락/읽기 불가 파일

`gemini-extension.json`이 누락되었거나 읽을 수 없는 경우, 해당 디렉토리는 조용히 건너뜁니다(경고 없음).

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

발견 시점의 동작은 의도적으로 느슨합니다:

- JSON 파싱 성공이 필수입니다.
- JSON 구문 이상의 필드 타입/내용에 대한 런타임 스키마 검증은 없습니다.
- 파싱된 객체는 기능 항목의 `manifest`로 저장됩니다.

### 이름 정규화

`Extension.name`은 다음과 같이 설정됩니다:

1. `manifest.name`이 `null`/`undefined`가 아닌 경우 해당 값
2. 그렇지 않으면 확장 디렉토리 이름

여기서 문자열 타입 강제는 적용되지 않습니다.

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
  providerName: "Gemini CLI" // capability registry에 의해 첨부됨
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

참고사항:

- `_source.path`는 `createSourceMeta()`에 의해 절대 경로로 정규화됩니다.
- `extensions`에 대한 레지스트리 수준 기능 검증은 `name`과 `path`의 존재만 확인합니다.
- 매니페스트 내부(`mcpServers`, `tools`, `context`)는 발견 과정에서 검증되지 않습니다.

---

## 오류 처리 및 경고 의미론

### 경고 발생

- 매니페스트 파일의 잘못된 JSON:
  - 경고 형식: `Invalid JSON in <manifestPath>`

### 경고 없음 (조용히 건너뜀)

- `extensions` 디렉토리 누락
- 하위 디렉토리에 `gemini-extension.json` 없음
- 읽을 수 없는 매니페스트 파일
- 매니페스트 JSON이 구문적으로 유효하지만 의미적으로 이상하거나 불완전함

이는 부분적 유효성이 허용됨을 의미합니다: 구문적 JSON 실패만 경고를 발생시킵니다.

---

## 다른 소스와의 우선순위 및 중복 제거

`extensions` 기능은 기능 레지스트리에 의해 프로바이더 간에 집계됩니다.

이 기능의 현재 프로바이더:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) 우선순위 `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) 우선순위 `60`

중복 제거 키는 `ext.name`입니다 (`extensionCapability.key = ext => ext.name`).

### 프로바이더 간 우선순위

더 높은 우선순위의 프로바이더가 중복 확장 이름에서 승리합니다.

- `native`와 `gemini` 모두 확장 이름 `foo`를 내보내는 경우, native 항목이 유지됩니다.
- 낮은 우선순위의 중복은 `_shadowed = true`로 `result.all`에만 보존됩니다.

### 프로바이더 내부 순서 효과

중복 제거가 "먼저 발견된 것이 우선"이므로, 프로바이더 로컬 항목 순서가 중요합니다.

- Gemini 로더는 **사용자를 먼저** 추가한 후 **프로젝트**를 추가합니다.
- 따라서 `~/.gemini/extensions`와 `<cwd>/.gemini/extensions` 간의 중복 이름은 사용자 항목을 유지하고 프로젝트 항목을 섀도잉합니다.

반면, native 프로바이더는 구성 디렉토리 순서를 다르게 빌드하여(`getConfigDirs()`에서 `project` 다음 `user`), native 프로바이더 내부 섀도잉은 반대 방향입니다.

---

## 사용자 vs 프로젝트 동작 요약

Gemini 매니페스트에 한정하여:

- 매 로드마다 사용자 및 프로젝트 루트 모두 스캔됩니다.
- 프로젝트 루트는 `<cwd>/.gemini/extensions`로 고정됩니다(상위 탐색 없음).
- Gemini 소스 내의 중복 이름은 사용자 우선으로 해석됩니다.
- 더 높은 우선순위의 프로바이더(특히 native)와의 중복 이름은 우선순위에 의해 패배합니다.

---

## 경계: 발견 메타데이터 vs 런타임 확장 로딩

`gemini-extension.json` 발견은 현재 기능 메타데이터(`Extension` 항목)를 제공합니다. 이는 실행 가능한 TS/JS 확장 모듈을 직접 로드하지 **않습니다**.

런타임 모듈 로딩(`discoverAndLoadExtensions()` / `loadExtensions()`)은 `extension-modules` 및 명시적 경로를 사용하며, 현재 자동 발견된 모듈을 프로바이더 `native`로만 필터링합니다.

실질적 의미:

- Gemini 매니페스트 확장은 기능 레코드로서 발견 가능합니다.
- 그 자체만으로는 확장 로더 파이프라인에 의해 런타임 확장 모듈로 실행되지 않습니다.

이 경계는 현재 구현에서 의도적이며, 매니페스트 발견과 실행 가능한 모듈 로딩이 분리될 수 있는 이유를 설명합니다.
