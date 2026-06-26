---
title: Natives 바인딩 계약 (TypeScript 측)
description: N-API를 통해 Rust 네이티브 함수를 호출하기 위한 TypeScript 측 바인딩 계약.
sidebar:
  order: 2
  label: 바인딩 계약
i18n:
  sourceHash: 36dc5fed1f0a
  translator: machine
---

# Natives 바인딩 계약 (TypeScript 측)

이 문서는 `@f5-sales-demo/pi-natives` 호출자와 로드된 N-API 애드온 사이에 위치하는 TypeScript 측 계약을 정의합니다.

세 가지 부분에 초점을 맞춥니다:

1. 계약 형태 (`NativeBindings` + 모듈 보강),
2. 래퍼 동작 (`src/<module>/index.ts`),
3. 공개 내보내기 표면 (`src/index.ts`).

## 구현 파일

- `packages/natives/src/bindings.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/grep/index.ts`
- `packages/natives/src/highlight/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/system-info/types.ts`
- `packages/natives/src/system-info/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/work/types.ts`
- `packages/natives/src/work/index.ts`

## 계약 모델

`packages/natives/src/bindings.ts`는 기본 계약을 정의합니다:

- `NativeBindings` (기본 인터페이스, 현재 `cancelWork(id: number): void` 포함)
- `Cancellable` (`timeoutMs?: number`, `signal?: AbortSignal`)
- `TsFunc<T>` N-API 스레드 안전 콜백에서 사용되는 콜백 형태

각 모듈은 선언 병합을 통해 자체 필드를 추가합니다:

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

이를 통해 단일 중앙 집중식 타입 파일 없이 하나의 통합 바인딩 인터페이스를 유지합니다.

## 선언 병합 생명주기 및 상태 전환

### 1) 컴파일 타임 타입 조립

- `bindings.ts`는 기본 `NativeBindings` 심볼을 제공합니다.
- 모든 `src/<module>/types.ts`가 `NativeBindings`를 보강합니다.
- `src/native.ts`는 모든 `./<module>/types` 파일을 부수 효과를 위해 임포트하여 `NativeBindings`가 사용되는 곳에서 병합된 계약이 스코프 내에 있도록 합니다.

상태 전환: **기본 계약** → **병합된 계약**.

### 2) 런타임 애드온 로드 및 검증 게이트

- `src/native.ts`는 후보 `.node` 바이너리를 로드합니다.
- 로드된 객체는 `NativeBindings`로 취급되며 즉시 `validateNative(...)`를 통과합니다.
- `validateNative`는 `typeof bindings[name] === "function"`으로 필수 내보내기 키를 확인합니다.

상태 전환: **신뢰할 수 없는 애드온 객체** → **검증된 네이티브 바인딩 객체** (또는 하드 실패).

### 3) 래퍼 호출

- `src/<module>/index.ts`의 모듈 래퍼가 `native.<export>`를 호출합니다.
- 래퍼는 기본값과 콜백 형태를 적응시킵니다 (`(err, value)`에서 JS API의 값 전용 콜백 패턴으로).
- `src/index.ts`는 모듈 래퍼/타입을 공개 패키지 API로 다시 내보냅니다.

상태 전환: **검증된 원시 바인딩** → **인체공학적 공개 API**.

## 래퍼 책임

래퍼는 의도적으로 얇습니다; 네이티브 로직을 다시 구현하지 않습니다.

주요 책임:

- **인수 정규화/기본값 설정**
  - `glob()`은 `options.path`를 절대 경로로 해석하고 `hidden`, `gitignore`, `recursive`의 기본값을 설정합니다.
  - `hasMatch()`는 네이티브 호출 전에 기본 플래그(`ignoreCase`, `multiline`)를 채웁니다.
- **콜백 적응**
  - `grep()`, `glob()`, `executeShell()`은 `TsFunc<T>` (`error, value`)를 성공적인 값만 수신하는 사용자 콜백으로 변환합니다.
- **네이티브 호출 주변의 환경 또는 정책 동작**
  - 클립보드 래퍼는 OSC52/Termux/헤드리스 처리를 추가하고 복사를 최선의 노력으로 취급합니다.
- **공개 명명 및 재내보내기 큐레이션**
  - `searchContent()`는 네이티브 내보내기 `search`에 매핑됩니다.

## 공개 내보내기 표면 구성

`packages/natives/src/index.ts`는 정식 공개 배럴 파일입니다. 기능 도메인별로 내보내기를 그룹화합니다:

- 검색/텍스트: `grep`, `glob`, `text`, `highlight`
- 실행/프로세스/터미널: `shell`, `pty`, `ps`, `keys`
- 시스템/미디어/변환: `image`, `html`, `clipboard`, `system-info`, `work`

유지관리자 규칙: 래퍼가 `src/index.ts`에서 다시 내보내지 않으면, 의도된 공개 패키지 표면의 일부가 아닙니다.

## JS API ↔ 네이티브 내보내기 매핑 (대표적)

Rust 측은 N-API 내보내기 이름(일반적으로 `#[napi]` snake_case -> camelCase 변환, 때때로 명시적 별칭 사용)을 사용하며, 이는 이러한 바인딩 키와 일치해야 합니다.

| 카테고리 | 공개 JS API (래퍼) | 네이티브 바인딩 키 | 반환 타입 | 비동기? |
|---|---|---|---|---|
| Grep | `grep(options, onMatch?)` | `grep` | `Promise<GrepResult>` | 예 |
| Grep | `searchContent(content, options)` | `search` | `SearchResult` | 아니오 |
| Grep | `hasMatch(content, pattern, opts?)` | `hasMatch` | `boolean` | 아니오 |
| Grep | `fuzzyFind(options)` | `fuzzyFind` | `Promise<FuzzyFindResult>` | 예 |
| Glob | `glob(options, onMatch?)` | `glob` | `Promise<GlobResult>` | 예 |
| Glob | `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `void` | 아니오 |
| Shell | `executeShell(options, onChunk?)` | `executeShell` | `Promise<ShellExecuteResult>` | 예 |
| Shell | `Shell` | `Shell` | 클래스 생성자 | N/A |
| PTY | `PtySession` | `PtySession` | 클래스 생성자 | N/A |
| Text | `truncateToWidth(...)` | `truncateToWidth` | `string` | 아니오 |
| Text | `sliceWithWidth(...)` | `sliceWithWidth` | `SliceWithWidthResult` | 아니오 |
| Text | `visibleWidth(text)` | `visibleWidth` | `number` | 아니오 |
| Highlight | `highlightCode(code, lang, colors)` | `highlightCode` | `string` | 아니오 |
| HTML | `htmlToMarkdown(html, options?)` | `htmlToMarkdown` | `Promise<string>` | 예 |
| System | `getSystemInfo()` | `getSystemInfo` | `SystemInfo` | 아니오 |
| Work | `getWorkProfile(lastSeconds)` | `getWorkProfile` | `WorkProfile` | 아니오 |
| Process | `killTree(pid, signal)` | `killTree` | `number` | 아니오 |
| Process | `listDescendants(pid)` | `listDescendants` | `number[]` | 아니오 |
| Clipboard | `copyToClipboard(text)` | `copyToClipboard` | `Promise<void>` (최선의 노력 래퍼 동작) | 예 |
| Clipboard | `readImageFromClipboard()` | `readImageFromClipboard` | `Promise<ClipboardImage \| null>` | 예 |
| Keys | `parseKey(data, kittyProtocolActive)` | `parseKey` | `string \| null` | 아니오 |

## 동기 vs 비동기 계약 차이

계약은 동기 및 비동기 API를 혼합합니다; 래퍼는 하나의 모델을 강제하기보다 네이티브 호출 스타일을 유지합니다:

- **Promise 기반 비동기 내보내기**: I/O 또는 장시간 실행 작업용 (`grep`, `glob`, `htmlToMarkdown`, `executeShell`, 클립보드, 이미지 작업).
- **동기 내보내기**: 결정론적 인메모리 변환/파서용 (`search`, `hasMatch`, 하이라이팅, 텍스트 너비/슬라이싱, 키 파싱, 프로세스 쿼리).
- **생성자 내보내기**: 상태를 가진 런타임 객체용 (`Shell`, `PtySession`, `PhotonImage`).

유지관리자를 위한 시사점: 기존 내보내기의 동기 ↔ 비동기를 변경하는 것은 래퍼와 호출자 전반에 걸친 파괴적 API 및 계약 변경입니다.

## 객체 및 열거형 타이핑 패턴

### 객체 패턴 (`#[napi(object)]` 스타일 JS 객체)

TS는 객체 형태의 네이티브 값을 인터페이스로 모델링합니다. 예시:

- `GrepResult`, `SearchResult`, `GlobResult`
- `SystemInfo`, `WorkProfile`
- `ClipboardImage`, `ParsedKittyResult`

이들은 컴파일 타임의 구조적 계약이며, 런타임 형태 정확성은 네이티브 구현이 담당합니다.

### 열거형 패턴

숫자 네이티브 열거형은 TS에서 `const enum` 값으로 표현됩니다:

- `FileType` (`1=file`, `2=dir`, `3=symlink`)
- `ImageFormat` (`0=PNG`, `1=JPEG`, `2=WEBP`, `3=GIF`)
- `SamplingFilter`, `Ellipsis`, `KeyEventType`

호출자는 이름이 있는 열거형 멤버를 보며, 바인딩 경계에서는 숫자가 전달됩니다.

## 불일치 감지 방법

불일치 감지는 두 계층에서 이루어집니다:

1. **컴파일 타임 TypeScript 계약 검사**
   - 래퍼는 병합된 `NativeBindings`에 대해 `native.<name>`을 호출합니다.
   - 누락되거나 이름이 변경된 바인딩 키는 래퍼에서 TS 타입 검사를 중단시킵니다.

2. **`validateNative`에서의 런타임 검증**
   - 로드 후 `native.ts`는 필수 내보내기를 확인하고 누락된 것이 있으면 예외를 던집니다.
   - 오류 메시지에는 누락된 키와 재빌드 지침이 포함됩니다.

이는 일반적인 오래된 바이너리 드리프트를 포착합니다: 래퍼/타입은 존재하지만 로드된 `.node`에 해당 내보내기가 없는 경우.

## 실패 동작 및 주의사항

### 로드/검증 실패 (하드 실패)

- 애드온 로드 실패 또는 지원되지 않는 플랫폼은 `native.ts`에서 모듈 초기화 중에 예외를 던집니다.
- 필수 내보내기 누락은 래퍼가 사용 가능해지기 전에 예외를 던집니다.

효과: 패키지는 첫 번째 호출까지 실패를 미루지 않고 빠르게 실패합니다.

### 래퍼 수준 동작 차이

- 일부 래퍼는 의도적으로 실패를 완화합니다 (`copyToClipboard`는 최선의 노력이며 네이티브 실패를 무시합니다).
- 스트리밍 콜백은 콜백 오류 페이로드를 무시하고 성공적인 값 이벤트만 전달합니다.

### 타입 수준 주의사항 (런타임이 TS보다 엄격함)

- TS 선택적 필드는 의미적 유효성을 보장하지 않습니다; 네이티브 계층은 여전히 잘못된 형태의 값을 거부할 수 있습니다.
- `const enum` 타이핑은 런타임에서 타입이 지정되지 않은 호출자의 범위 밖 숫자 값을 방지하지 않습니다.
- `validateNative`는 필수 내보내기의 존재/함수 여부만 확인하며, 깊은 인수/반환 형태 호환성은 확인하지 않습니다.
- `bindings.ts`는 기본 인터페이스에 `cancelWork(id)`를 포함하지만, 현재 런타임 검증 목록은 해당 키를 강제하지 않습니다.

## 바인딩 변경을 위한 유지관리자 체크리스트

내보내기를 추가/변경할 때, 다음 모든 항목을 업데이트하세요:

1. `src/<module>/types.ts` (보강 + 계약 타입)
2. `src/<module>/index.ts` (래퍼 동작)
3. `src/native.ts` 모듈 타입 임포트 (새 모듈인 경우)
4. `validateNative` 필수 내보내기 검사
5. `src/index.ts` 공개 재내보내기

어떤 단계라도 건너뛰면 컴파일 타임 드리프트 또는 런타임 로드 타임 실패가 발생합니다.
