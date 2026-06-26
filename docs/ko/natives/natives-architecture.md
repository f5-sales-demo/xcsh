---
title: Natives 아키텍처
description: TypeScript와 플랫폼별 작업을 연결하는 Rust N-API 네이티브 애드온 아키텍처.
sidebar:
  order: 1
  label: 아키텍처
i18n:
  sourceHash: d38ed2437bb7
  translator: machine
---

# Natives 아키텍처

`@f5-sales-demo/pi-natives`는 세 계층으로 구성된 스택입니다:

1. **TypeScript 래퍼/API 계층**은 안정적인 JS/TS 진입점을 제공합니다.
2. **애드온 로딩/검증 계층**은 현재 런타임에 맞는 `.node` 바이너리를 탐색하고 검증합니다.
3. **Rust N-API 모듈 계층**은 JS로 내보내는 성능 핵심 원시 함수를 구현합니다.

이 문서는 더 깊은 모듈 수준 문서의 기초입니다.

## 구현 파일

- `packages/natives/src/index.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `crates/pi-natives/src/lib.rs`

## 계층 1: TypeScript 래퍼/API 계층

`packages/natives/src/index.ts`는 공개 배럴 파일입니다. 기능 도메인별로 내보내기를 그룹화하고, 원시 N-API 바인딩을 직접 노출하지 않고 타입이 지정된 래퍼를 재내보내기합니다.

현재 최상위 그룹:

- **검색/텍스트 원시 함수**: `grep`, `glob`, `text`, `highlight`
- **실행/프로세스/터미널 원시 함수**: `shell`, `pty`, `ps`, `keys`
- **시스템/미디어/변환 원시 함수**: `image`, `html`, `clipboard`, `system-info`, `work`

`packages/natives/src/bindings.ts`는 기본 인터페이스 계약을 정의합니다:

- `NativeBindings`는 공유 멤버(`cancelWork(id: number)`)로 시작합니다
- 모듈별 바인딩은 각 모듈의 `types.ts`에서 선언 병합을 통해 추가됩니다
- `Cancellable`은 취소 기능을 제공하는 래퍼를 위해 타임아웃 및 abort-signal 옵션을 표준화합니다

**보장된 계약 (API 측면):** 소비자는 `@f5-sales-demo/pi-natives`에서 가져오고 타입이 지정된 래퍼를 사용합니다.

**구현 세부 사항 (변경 가능):** 선언 병합 및 내부 래퍼 레이아웃 (`src/<module>/index.ts`, `src/<module>/types.ts`).

## 계층 2: 애드온 로딩 및 검증

`packages/natives/src/native.ts`는 런타임 애드온 선택, 선택적 추출, 내보내기 검증을 담당합니다.

### 후보 탐색 모델

- 플랫폼 태그는 `"${process.platform}-${process.arch}"`입니다.
- 현재 지원되는 태그:
  - `linux-x64`
  - `linux-arm64`
  - `darwin-x64`
  - `darwin-arm64`
  - `win32-x64`
- x64는 CPU 변형을 사용할 수 있습니다:
  - `modern` (AVX2 지원)
  - `baseline` (폴백)
- 비 x64는 기본 파일명을 사용합니다 (변형 접미사 없음).

파일명 전략:

- 릴리스: `pi_natives.<platform>-<arch>.node`
- x64 변형 릴리스: `pi_natives.<platform>-<arch>-modern.node` 및/또는 `...-baseline.node`
- `PI_DEV`는 로더 진단을 활성화하지만 애드온 파일명은 변경하지 않습니다

### 플랫폼별 변형 감지

x64의 경우, 변형 선택은 다음을 사용합니다:

- **Linux**: `/proc/cpuinfo`
- **macOS**: `sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows**: `System.Runtime.Intrinsics.X86.Avx2`에 대한 PowerShell 검사

`PI_NATIVE_VARIANT`로 `modern` 또는 `baseline`을 명시적으로 강제할 수 있습니다.

### 바이너리 배포 및 추출 모델

`packages/natives/package.json`은 게시된 파일에 `src`와 `native`를 모두 포함합니다. `native/` 디렉터리는 사전 빌드된 플랫폼 아티팩트를 저장합니다.

컴파일된 바이너리(`PI_COMPILED` 또는 Bun 임베디드 런타임 마커)의 경우, 로더 동작은 다음과 같습니다:

1. 버전이 지정된 사용자 캐시 경로 확인: `<getNativesDir()>/<packageVersion>/...`
2. 레거시 컴파일된 바이너리 위치 확인:
   - Windows: `%LOCALAPPDATA%/xcsh` (폴백 `%USERPROFILE%/AppData/Local/xcsh`)
   - 비 Windows: `~/.local/bin`
3. 패키지에 포함된 `native/` 및 실행 파일 디렉터리 후보로 폴백

임베디드 애드온 매니페스트가 존재하면 (`scripts/embed-native.ts`에 의해 생성된 `embedded-addon.ts`), `native.ts`는 로딩 전에 일치하는 임베디드 바이너리를 버전이 지정된 캐시 디렉터리에 구체화할 수 있습니다.

### 검증 및 실패 모드

`require(candidate)` 후, `validateNative(...)`는 필수 내보내기를 검증합니다 (예: `grep`, `glob`, `highlightCode`, `PtySession`, `Shell`, `getSystemInfo`, `getWorkProfile`, `invalidateFsScanCache`).

실패 경로는 명시적입니다:

- **지원되지 않는 플랫폼 태그**: 지원 플랫폼 목록과 함께 예외를 발생시킵니다
- **로드 가능한 후보 없음**: 시도된 모든 경로와 해결 힌트와 함께 예외를 발생시킵니다
- **누락된 내보내기**: 정확한 누락 이름과 재빌드 명령과 함께 예외를 발생시킵니다
- **임베디드 추출 오류**: 디렉터리/쓰기 실패를 기록하고 최종 로드 진단에 포함합니다

**보장된 계약 (API 측면):** 애드온 로드는 검증된 바인딩 세트로 성공하거나, 실행 가능한 오류 텍스트와 함께 즉시 실패합니다.

**구현 세부 사항 (변경 가능):** 정확한 후보 탐색 순서 및 컴파일된 바이너리 폴백 경로 순서.

## 계층 3: Rust N-API 모듈 계층

`crates/pi-natives/src/lib.rs`는 내보내는 모듈 소유권을 선언하는 Rust 진입 모듈입니다:

- `clipboard`
- `fd`
- `fs_cache`
- `glob`
- `glob_util`
- `grep`
- `highlight`
- `html`
- `image`
- `keys`
- `prof`
- `ps`
- `pty`
- `shell`
- `system_info`
- `task`
- `text`

이 모듈들은 `native.ts`에 의해 소비되고 검증되는 N-API 심볼을 구현합니다. JS 수준 이름은 `packages/natives/src`의 TS 래퍼를 통해 표면화됩니다.

**보장된 계약 (API 측면):** Rust 모듈 내보내기는 `validateNative` 및 래퍼 모듈이 기대하는 바인딩 이름과 일치해야 합니다.

**구현 세부 사항 (변경 가능):** 내부 Rust 모듈 분해 및 헬퍼 모듈 경계 (`glob_util`, `task` 등).

## 소유권 경계

아키텍처 수준에서 소유권은 다음과 같이 분할됩니다:

- **TS 래퍼/API 소유권 (`packages/natives/src`)**
  - 공개 API 그룹화, 옵션 타이핑, 안정적인 JS 사용 편의성
  - 호출자에게 노출되는 취소 표면 (`timeoutMs`, `AbortSignal`)
- **로더 소유권 (`packages/natives/src/native.ts`)**
  - 런타임 바이너리 선택
  - CPU 변형 선택 및 오버라이드 처리
  - 컴파일된 바이너리 추출 및 후보 탐색
  - 필수 네이티브 내보내기의 엄격한 검증
- **Rust 소유권 (`crates/pi-natives/src`)**
  - 알고리즘 및 시스템 수준 구현
  - 플랫폼 네이티브 동작 및 성능에 민감한 로직
  - TS 래퍼가 소비하는 N-API 심볼 구현

## 런타임 흐름 (고수준)

1. 소비자가 `@f5-sales-demo/pi-natives`에서 가져옵니다.
2. 래퍼 모듈이 싱글톤 `native` 바인딩을 호출합니다.
3. `native.ts`가 플랫폼/아키텍처/변형에 맞는 후보 바이너리를 선택합니다.
4. 컴파일된 배포판의 경우 선택적 임베디드 바이너리 추출이 발생합니다.
5. 애드온이 로드되고 내보내기 세트가 검증됩니다.
6. 래퍼가 호출자에게 타입이 지정된 결과를 반환합니다.

## 용어집

- **네이티브 애드온**: Node-API (N-API)를 통해 로드되는 `.node` 바이너리.
- **플랫폼 태그**: 런타임 튜플 `platform-arch` (예: `darwin-arm64`).
- **변형**: x64 CPU별 빌드 플레이버 (`modern` AVX2, `baseline` 폴백).
- **래퍼**: 원시 네이티브 내보내기에 대해 타입이 지정된 API를 제공하는 TS 함수/클래스.
- **선언 병합**: 모듈 `types.ts` 파일이 `NativeBindings`를 확장하기 위해 사용하는 TS 기법.
- **컴파일된 바이너리 모드**: CLI가 번들되고 네이티브 애드온이 패키지 로컬 경로만이 아닌 추출/캐시 경로에서 탐색되는 런타임 모드.
- **임베디드 애드온**: 컴파일된 바이너리가 일치하는 `.node` 페이로드를 추출할 수 있도록 `embedded-addon.ts`에 생성된 빌드 아티팩트 메타데이터 및 파일 참조.
- **검증 게이트**: 필수 내보내기가 누락된 오래된/불일치 바이너리를 거부하는 `validateNative(...)` 검사.
