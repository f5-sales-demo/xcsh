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

이 문서는 `@f5xc-salesdemos/pi-natives`의 애드온 로딩/유효성 검증 레이어를 심층적으로 다룹니다: `native.ts`가 어떤 `.node` 파일을 로드할지 결정하는 방법, 임베디드 페이로드 추출이 실행되는 시점, 그리고 시작 실패가 보고되는 방식을 설명합니다.

## 구현 파일

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## 범위 및 책임

로더/런타임의 책임은 의도적으로 좁게 설정되어 있습니다:

- 플랫폼/CPU 인식 기반의 애드온 파일명 및 디렉터리 후보 목록 구성.
- 선택적으로 임베디드 애드온을 버전별 사용자 캐시 디렉터리에 구체화.
- 결정론적 순서로 후보를 시도.
- 바인딩을 노출하기 전에 `validateNative`를 통해 오래된 또는 호환되지 않는 애드온 거부.

이 문서의 범위 밖: 모듈별 grep/text/highlight 동작.

## 런타임 입력 및 파생 상태

모듈 초기화 시(`export const native = loadNative();`), `native.ts`는 정적 컨텍스트를 계산합니다:

- **플랫폼 태그**: ``${process.platform}-${process.arch}`` (예: `darwin-arm64`).
- **패키지 버전**: `packages/natives/package.json`의 `version` 필드에서 가져옴.
- **핵심 디렉터리**:
  - `nativeDir`: 패키지 로컬 `packages/natives/native`.
  - `execDir`: `process.execPath`를 포함하는 디렉터리.
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`.
  - `userDataDir` 폴백:
    - Windows: `%LOCALAPPDATA%/xcsh` (또는 `%USERPROFILE%/AppData/Local/xcsh`).
    - Windows 이외: `~/.local/bin`.
- **컴파일된 바이너리 모드** (`isCompiledBinary`): 다음 중 하나라도 해당하면 true:
  - `PI_COMPILED` 환경 변수가 설정되었거나,
  - `import.meta.url`에 Bun 임베디드 마커(`$bunfs`, `~BUN`, `%7EBUN`)가 포함된 경우.
- **변형 오버라이드**: `PI_NATIVE_VARIANT` (`modern`/`baseline`만 허용; 유효하지 않은 값은 무시).
- **선택된 변형**: 명시적 오버라이드가 있으면 해당 값, 그렇지 않으면 x64에서 런타임 AVX2 감지 (AVX2 지원 시 `modern`, 아니면 `baseline`).

## 플랫폼 지원 및 태그 해석

`SUPPORTED_PLATFORMS`는 다음으로 고정되어 있습니다:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

동작 상세:

- 지원되지 않는 플랫폼은 사전에 거부되지 않습니다.
- 로더는 여전히 모든 계산된 후보를 먼저 시도합니다.
- 아무것도 로드되지 않으면, 지원되는 태그 목록과 함께 명시적 미지원 플랫폼 오류를 발생시킵니다.

이는 근접 실패 사례에 대한 유용한 진단을 보존하면서 진정으로 지원되지 않는 대상에 대해서는 확실히 실패합니다.

## 변형 선택 (`modern` / `baseline` / 기본값)

### x64 동작

1. `PI_NATIVE_VARIANT`가 `modern` 또는 `baseline`이면 해당 값이 우선합니다.
2. 그렇지 않으면 AVX2 지원을 감지합니다:
   - Linux: `/proc/cpuinfo`에서 `avx2`를 검색.
   - macOS: `sysctl` 쿼리 (`machdep.cpu.leaf7_features`, 폴백 `machdep.cpu.features`).
   - Windows: PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported` 실행.
3. 결과:
   - AVX2 사용 가능 -> `modern`
   - AVX2 사용 불가/감지 불가 -> `baseline`

### x64 이외 동작

- 변형이 사용되지 않으며, 로더는 기본 파일명(`pi_natives.<platform>-<arch>.node`)을 유지합니다.

### 파일명 구성

`tag = <platform>-<arch>`가 주어진 경우:

- x64 이외 또는 변형 없음: `pi_natives.<tag>.node`
- x64 + `modern`: 다음 순서로 시도
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (의도적 폴백)
- x64 + `baseline`: `pi_natives.<tag>-baseline.node`만 시도

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

1. 선택적 임베디드 추출 후보(생성된 경우)가 맨 앞에 삽입됩니다.
2. 나머지 중복 제거된 후보가 순서대로 시도됩니다.
3. `require(...)`와 `validateNative(...)`를 모두 통과하는 첫 번째 후보가 선택됩니다.

## 임베디드 애드온 추출 생명주기

`embedded-addon.ts`는 생성된 매니페스트 형태를 정의합니다:

- `platformTag`
- `version`
- `files[]` - 각 항목에 `variant`, `filename`, `filePath` 포함

현재 체크인된 기본값은 `embeddedAddon: null`이며, 컴파일된 아티팩트가 이를 실제 메타데이터로 대체할 수 있습니다.

### 추출 상태 머신

추출(`maybeExtractEmbeddedAddon`)은 모든 게이트가 통과할 때만 실행됩니다:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. 변형에 적합한 임베디드 파일이 발견됨

변형 파일 선택은 런타임 변형 의도를 미러링합니다:

- x64 이외: `default`를 선호, 그 다음 첫 번째 사용 가능한 파일.
- x64 + `modern`: `modern`을 선호, `baseline`으로 폴백.
- x64 + `baseline`: `baseline`을 요구.

구체화 동작:

1. `<versionedDir>`가 존재하는지 확인 (`mkdirSync(..., { recursive: true })`).
2. `<versionedDir>/<선택된 파일명>`이 이미 존재하면 재사용 (재작성 없음).
3. 그렇지 않으면 임베디드 소스 `filePath`를 읽고 대상 파일을 작성.
4. 최우선 로드 시도를 위한 대상 경로를 반환.

실패 시 추출은 즉시 충돌하지 않습니다. 오류 항목(디렉터리 생성 또는 쓰기 실패)을 추가하고 로더는 정상 후보 탐색을 계속합니다.

## 생명주기 및 상태 전이

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

`validateNative(bindings, source)`는 시작 시 `NativeBindings`에 대해 함수 전용 계약을 적용합니다.

메커니즘:

- 각 필수 내보내기 이름에 대해 `typeof bindings[name] === "function"`을 확인합니다.
- 누락된 이름이 집계됩니다.
- 누락된 항목이 있으면 로더가 다음을 포함하여 오류를 발생시킵니다:
  - 소스 애드온 경로,
  - 누락된 내보내기 목록,
  - 재빌드 명령 힌트.

이는 오래된 바이너리, 부분 빌드 및 심볼/이름 드리프트에 대한 강력한 호환성 게이트입니다.

### JS API ↔ 네이티브 내보내기 매핑 (유효성 검증 게이트)

| `validateNative`에서 확인되는 JS 바인딩 이름 | 예상 네이티브 내보내기 이름 |
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

참고: `bindings.ts`는 기본 `cancelWork(id)` 멤버만 선언합니다. 모듈 `types.ts` 파일이 `validateNative`가 적용하는 추가 심볼을 선언 병합합니다.

## 실패 동작 및 진단

## 지원되지 않는 플랫폼

모든 후보가 실패하고 `platformTag`가 `SUPPORTED_PLATFORMS`에 없으면, 로더는 다음을 포함하여 오류를 발생시킵니다:

- `Unsupported platform: <tag>`
- 전체 지원 플랫폼 목록
- 명시적 이슈 보고 안내

## 오래된 바이너리 / 불일치 증상

일반적인 오래된 불일치 신호:

- `Native addon missing exports (<candidate>). Missing: ...`

일반적인 원인:

- 이전 패키지 버전/API 형태의 오래된 `.node` 바이너리.
- 잘못된 변형 아티팩트 선택 (x64의 경우).
- 로드된 아티팩트에 새로운 Rust 내보내기가 없음.

로더 동작:

- 후보별 누락 내보내기 실패를 기록합니다.
- 나머지 후보 탐색을 계속합니다.
- 유효성 검증을 통과하는 후보가 없으면, 최종 오류에 각 실패 메시지와 함께 시도된 모든 경로가 포함됩니다.

## 컴파일된 바이너리 시작 실패

컴파일 모드에서 최종 진단에는 다음이 포함됩니다:

- 예상 버전별 캐시 대상 경로 (`<versionedDir>/<filename>`),
- 오래된 `<versionedDir>`를 삭제하고 다시 실행하는 해결 방법,
- 각 예상 파일명에 대한 직접 릴리스 다운로드 `curl` 명령.

## 비컴파일 시작 실패

일반 패키지/런타임 모드에서 최종 진단에는 다음이 포함됩니다:

- 재설치 힌트 (`bun install @f5xc-salesdemos/pi-natives`),
- 로컬 재빌드 명령 (`bun --cwd=packages/natives run build`),
- 선택적 x64 변형 빌드 힌트 (`TARGET_VARIANT=baseline|modern ...`).

## 런타임 동작

- 로더는 항상 릴리스 후보 체인을 사용합니다.
- `PI_DEV` 설정은 후보별 콘솔 진단(`Loaded native addon...` 및 로드 오류)만 활성화합니다.
