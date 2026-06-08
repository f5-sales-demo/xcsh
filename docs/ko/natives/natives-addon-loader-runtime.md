---
title: 네이티브 애드온 로더 런타임
description: >-
  N-API addon loader runtime with platform detection, fallback strategies, and
  module resolution.
sidebar:
  order: 3
  label: 애드온 로더
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# 네이티브 애드온 로더 런타임

이 문서는 `@f5xc-salesdemos/pi-natives`의 애드온 로딩/검증 레이어를 심층적으로 다룹니다: `native.ts`가 어떤 `.node` 파일을 로드할지 결정하는 방식, 임베디드 페이로드 추출이 실행되는 시점, 그리고 시작 실패가 보고되는 방법을 설명합니다.

## 구현 파일

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## 범위와 책임

로더/런타임의 책임은 의도적으로 좁게 한정됩니다:

- 애드온 파일명과 디렉토리에 대한 플랫폼/CPU 인식 후보 목록을 구성합니다.
- 선택적으로 임베디드 애드온을 버전별 사용자 캐시 디렉토리에 구체화합니다.
- 결정론적 순서로 후보를 시도합니다.
- 바인딩을 노출하기 전에 `validateNative`를 통해 오래되거나 호환되지 않는 애드온을 거부합니다.

여기서 다루지 않는 범위: 모듈별 grep/text/highlight 동작.

## 런타임 입력과 파생 상태

모듈 초기화 시(`export const native = loadNative();`), `native.ts`는 정적 컨텍스트를 계산합니다:

- **플랫폼 태그**: ``${process.platform}-${process.arch}`` (예: `darwin-arm64`).
- **패키지 버전**: `packages/natives/package.json`의 `version` 필드에서 가져옴.
- **핵심 디렉토리**:
  - `nativeDir`: 패키지 로컬 `packages/natives/native`.
  - `execDir`: `process.execPath`를 포함하는 디렉토리.
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`.
  - `userDataDir` 폴백:
    - Windows: `%LOCALAPPDATA%/xcsh` (또는 `%USERPROFILE%/AppData/Local/xcsh`).
    - Windows 이외: `~/.local/bin`.
- **컴파일된 바이너리 모드** (`isCompiledBinary`): 다음 중 하나라도 해당되면 true:
  - `PI_COMPILED` 환경 변수가 설정되었거나,
  - `import.meta.url`에 Bun 임베디드 마커(`$bunfs`, `~BUN`, `%7EBUN`)가 포함된 경우.
- **변형(variant) 오버라이드**: `PI_NATIVE_VARIANT` (`modern`/`baseline`만 허용; 유효하지 않은 값은 무시됨).
- **선택된 변형**: 명시적 오버라이드가 있으면 해당 값, 그렇지 않으면 x64에서 런타임 AVX2 감지 (AVX2 지원 시 `modern`, 아니면 `baseline`).

## 플랫폼 지원 및 태그 해석

`SUPPORTED_PLATFORMS`는 다음으로 고정됩니다:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

동작 세부사항:

- 지원되지 않는 플랫폼은 사전에 거부되지 않습니다.
- 로더는 여전히 모든 계산된 후보를 먼저 시도합니다.
- 아무것도 로드되지 않으면 지원되는 태그 목록과 함께 명시적인 미지원 플랫폼 오류를 발생시킵니다.

이를 통해 유사한 경우에 유용한 진단 정보를 보존하면서도 진정으로 지원되지 않는 대상에 대해서는 확실하게 실패합니다.

## 변형 선택 (`modern` / `baseline` / 기본값)

### x64 동작

1. `PI_NATIVE_VARIANT`가 `modern` 또는 `baseline`이면 해당 값이 우선합니다.
2. 그렇지 않으면 AVX2 지원을 감지합니다:
   - Linux: `/proc/cpuinfo`에서 `avx2`를 검색합니다.
   - macOS: `sysctl`을 쿼리합니다 (`machdep.cpu.leaf7_features`, 폴백 `machdep.cpu.features`).
   - Windows: PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported`를 실행합니다.
3. 결과:
   - AVX2 사용 가능 -> `modern`
   - AVX2 사용 불가/감지 불가 -> `baseline`

### x64가 아닌 경우의 동작

- 변형이 사용되지 않습니다; 로더는 기본 파일명(`pi_natives.<platform>-<arch>.node`)을 유지합니다.

### 파일명 구성

`tag = <platform>-<arch>`가 주어졌을 때:

- x64가 아니거나 변형 없음: `pi_natives.<tag>.node`
- x64 + `modern`: 다음 순서로 시도
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (의도적인 폴백)
- x64 + `baseline`: `pi_natives.<tag>-baseline.node`만

최종 오류 메시지에 사용되는 `addonLabel`은 `<tag>` 또는 `<tag> (<variant>)`입니다.

## 후보 경로 구성 및 폴백 순서

`native.ts`는 `require(...)` 호출 전에 후보 풀을 구성합니다.

### 릴리스 후보

변형이 해석된 파일명 목록에서 구성되며 다음 순서로 검색됩니다:

- **비컴파일 런타임**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **컴파일 런타임** (`PI_COMPILED` 또는 Bun 임베디드 마커):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates`는 첫 번째 출현 순서를 유지하면서 중복을 제거합니다.

### 최종 런타임 시퀀스

로드 시:

1. (생성된 경우) 선택적 임베디드 추출 후보가 맨 앞에 삽입됩니다.
2. 나머지 중복 제거된 후보가 순서대로 시도됩니다.
3. `require(...)`와 `validateNative(...)` 모두를 통과하는 첫 번째 후보가 선택됩니다.

## 임베디드 애드온 추출 생명주기

`embedded-addon.ts`는 생성된 매니페스트 형태를 정의합니다:

- `platformTag`
- `version`
- `files[]` 여기서 각 항목은 `variant`, `filename`, `filePath`를 가집니다

현재 체크인된 기본값은 `embeddedAddon: null`입니다; 컴파일된 아티팩트가 이를 실제 메타데이터로 대체할 수 있습니다.

### 추출 상태 머신

추출(`maybeExtractEmbeddedAddon`)은 모든 게이트를 통과할 때만 실행됩니다:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. 변형에 적합한 임베디드 파일이 발견됨

변형 파일 선택은 런타임 변형 의도를 반영합니다:

- x64가 아닌 경우: `default`를 선호하고, 그 다음 사용 가능한 첫 번째 파일.
- x64 + `modern`: `modern`을 선호하고, `baseline`으로 폴백.
- x64 + `baseline`: `baseline`을 요구.

구체화 동작:

1. `<versionedDir>`이 존재하는지 확인합니다 (`mkdirSync(..., { recursive: true })`).
2. `<versionedDir>/<selected filename>`이 이미 존재하면 재사용합니다 (다시 쓰지 않음).
3. 그렇지 않으면 임베디드 소스 `filePath`를 읽고 대상 파일에 씁니다.
4. 최우선 로드 시도를 위한 대상 경로를 반환합니다.

실패 시, 추출은 즉시 크래시하지 않습니다; 오류 항목(디렉토리 생성 또는 쓰기 실패)을 추가하고 로더는 정상적인 후보 탐색을 계속합니다.

## 생명주기 및 상태 전환

```text
Init
  -> Compute platform/version/variant/candidate lists
  -> (Compiled + embedded manifest matches?)
       yes -> Try extract embedded to versionedDir (record errors, continue)
       no  -> Skip extraction
  -> For each runtime candidate in order:
       require(candidate)
       -> success: validateNative
            -> pass: return bindings (READY)
            -> fail: record error, continue
       -> failure: record error, continue
  -> none loaded:
       if unsupported platform tag -> throw Unsupported platform
       else -> throw Failed to load (full tried-path diagnostics + hints)
```

## `validateNative` 계약 검사

`validateNative(bindings, source)`는 시작 시 `NativeBindings`에 대한 함수 전용 계약을 적용합니다.

동작 방식:

- 필수 내보내기 이름 각각에 대해 `typeof bindings[name] === "function"`을 검사합니다.
- 누락된 이름이 집계됩니다.
- 하나라도 누락되면 로더가 다음을 포함하여 예외를 발생시킵니다:
  - 소스 애드온 경로,
  - 누락된 내보내기 목록,
  - 재빌드 명령 힌트.

이것은 오래된 바이너리, 부분 빌드, 심볼/이름 변경에 대한 엄격한 호환성 게이트입니다.

### JS API ↔ 네이티브 내보내기 매핑 (검증 게이트)

| `validateNative`에서 검사하는 JS 바인딩 이름 | 예상되는 네이티브 내보내기 이름 |
| --- | --- |
| `grep` | `grep` |
| `glob` | `glob` |
| `highlightCode` | `highlightCode` |
| `executeShell` | `executeShell` |
| `PtySession` | `PtySession` |
| `Shell` | `Shell` |
| `visibleWidth` | `visibleWidth` |
| `getSystemInfo` | `getSystemInfo` |
| `getWorkProfile` | `getWorkProfile` |
| `invalidateFsScanCache` | `invalidateFsScanCache` |

참고: `bindings.ts`는 기본 `cancelWork(id)` 멤버만 선언합니다; 모듈 `types.ts` 파일이 `validateNative`가 적용하는 추가 심볼을 선언 병합합니다.

## 실패 동작 및 진단

## 미지원 플랫폼

모든 후보가 실패하고 `platformTag`가 `SUPPORTED_PLATFORMS`에 포함되지 않으면 로더는 다음을 포함하여 예외를 발생시킵니다:

- `Unsupported platform: <tag>`
- 전체 지원 플랫폼 목록
- 명시적인 이슈 보고 안내

## 오래된 바이너리 / 불일치 증상

일반적인 오래된 불일치 신호:

- `Native addon missing exports (<candidate>). Missing: ...`

일반적인 원인:

- 이전 패키지 버전/API 형태의 오래된 `.node` 바이너리.
- 잘못된 변형 아티팩트 선택 (x64의 경우).
- 로드된 아티팩트에 없는 새로운 Rust 내보내기.

로더 동작:

- 후보별 누락 내보내기 실패를 기록합니다.
- 나머지 후보 탐색을 계속합니다.
- 어떤 후보도 검증을 통과하지 못하면 최종 오류에 각 실패 메시지와 함께 시도된 모든 경로가 포함됩니다.

## 컴파일된 바이너리 시작 실패

컴파일 모드에서 최종 진단에는 다음이 포함됩니다:

- 예상된 버전별 캐시 대상 경로 (`<versionedDir>/<filename>`),
- 오래된 `<versionedDir>`을 삭제하고 다시 실행하는 조치 방법,
- 각 예상 파일명에 대한 직접 릴리스 다운로드 `curl` 명령.

## 비컴파일 시작 실패

일반 패키지/런타임 모드에서 최종 진단에는 다음이 포함됩니다:

- 재설치 힌트 (`bun install @f5xc-salesdemos/pi-natives`),
- 로컬 재빌드 명령 (`bun --cwd=packages/natives run build`),
- 선택적 x64 변형 빌드 힌트 (`TARGET_VARIANT=baseline|modern ...`).

## 런타임 동작

- 로더는 항상 릴리스 후보 체인을 사용합니다.
- `PI_DEV` 설정은 후보별 콘솔 진단(`Loaded native addon...` 및 로드 오류)만 활성화합니다.
