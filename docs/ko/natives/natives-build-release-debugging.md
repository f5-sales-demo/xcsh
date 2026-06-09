---
title: '네이티브 빌드, 릴리스 및 디버깅 런북'
description: '플랫폼 전반에 걸친 Rust 네이티브 애드온의 빌드, 릴리스 및 디버깅 런북.'
sidebar:
  order: 8
  label: '빌드, 릴리스 및 디버깅'
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# 네이티브 빌드, 릴리스 및 디버깅 런북

이 런북은 `@f5xc-salesdemos/pi-natives` 빌드 파이프라인이 `.node` 애드온을 생성하는 방법, 컴파일된 배포판이 이를 로드하는 방법, 그리고 로더/빌드 실패를 디버깅하는 방법을 설명합니다.

`docs/natives-architecture.md`의 아키텍처 용어를 따릅니다:

- **빌드 시점 아티팩트 생성** (`scripts/build-native.ts`)
- **임베디드 애드온 매니페스트 생성** (`scripts/embed-native.ts`)
- **런타임 애드온 로딩 + 유효성 검증 게이트** (`src/native.ts`)

## 구현 파일

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## 빌드 파이프라인 개요

### 1) 빌드 진입점

`packages/natives/package.json` 스크립트:

- `bun scripts/build-native.ts` (`build`) → 릴리스 빌드
- `bun scripts/build-native.ts --dev` (`dev:native`) → 디버그/개발 프로파일 빌드 (동일한 출력 네이밍)
- `bun scripts/embed-native.ts` (`embed:native`) → 빌드된 파일로부터 `src/embedded-addon.ts` 생성

### 2) Rust 아티팩트 빌드

`build-native.ts`는 `crates/pi-natives`에서 Cargo를 실행합니다:

- 기본 명령: `cargo build`
- `--dev`가 전달되지 않으면 릴리스 모드에서 `--release` 추가
- 크로스 타겟의 경우 `--target <CROSS_TARGET>` 추가

`crates/pi-natives/Cargo.toml`은 `crate-type = ["cdylib"]`를 선언하므로, Cargo는 공유 라이브러리(`.so`/`.dylib`/`.dll`)를 생성하고, 이는 복사/이름 변경되어 `.node` 애드온 파일명이 됩니다.

### 3) 아티팩트 탐색 및 설치

Cargo가 완료된 후, `build-native.ts`는 후보 출력 디렉토리를 순서대로 스캔합니다:

1. `${CARGO_TARGET_DIR}` (설정된 경우)
2. `<repo>/target`
3. `crates/pi-natives/target`

각 루트에 대해 프로파일 디렉토리를 확인합니다:

- 크로스 빌드: `<root>/<crossTarget>/<profile>` 이후 `<root>/<profile>`
- 네이티브 빌드: `<root>/<profile>`

그런 다음 다음 중 하나를 찾습니다:

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

발견되면, 임시 파일 + 이름 변경 시맨틱스를 사용하여 `packages/natives/native/`에 원자적으로 설치합니다 (Windows 폴백은 잠긴 DLL 교체 실패를 명시적으로 처리합니다).

## 타겟/변형 모델 및 네이밍 규칙

## 플랫폼 태그

빌드와 런타임 모두 플랫폼 태그를 사용합니다:

`<platform>-<arch>` (예: `darwin-arm64`, `linux-x64`)

## 변형 모델 (x64 전용)

x64는 CPU 변형을 지원합니다:

- `modern` (AVX2 지원 경로)
- `baseline` (폴백)

비-x64는 단일 기본 아티팩트를 사용합니다 (변형 접미사 없음).

### 출력 파일명

릴리스 빌드:

- x64: `pi_natives.<platform>-<arch>-modern.node` 또는 `...-baseline.node`
- 비-x64: `pi_natives.<platform>-<arch>.node`

개발 빌드 (`--dev`):

- 디버그 프로파일 플래그를 사용하지만 표준 플랫폼 태그 출력 네이밍을 유지

`native.ts`의 런타임 로더 후보 순서:

- 릴리스 후보
- 컴파일 모드에서는 패키지 로컬 파일 앞에 추출/캐시 후보를 추가

## 환경 플래그 및 빌드 옵션

## 런타임 플래그

- `PI_DEV` (로더 동작): 로더 진단 활성화
- `PI_NATIVE_VARIANT` (로더 동작, x64 전용): 런타임에서 `modern` 또는 `baseline` 선택 강제
- `PI_COMPILED` (로더 동작): 컴파일된 바이너리 후보/추출 동작 활성화

## 빌드 시점 플래그/옵션

- `--dev` (스크립트 인수): 디버그 프로파일 빌드
- `CROSS_TARGET`: Cargo `--target`에 전달
- `TARGET_PLATFORM`: 출력 플랫폼 태그 네이밍 오버라이드
- `TARGET_ARCH`: 출력 아키텍처 네이밍 오버라이드
- `TARGET_VARIANT` (x64 전용): 출력 파일명 및 RUSTFLAGS 정책에 대해 `modern` 또는 `baseline` 강제
- `CARGO_TARGET_DIR`: Cargo 출력 검색 시 추가 루트
- `RUSTFLAGS`:
  - 미설정이고 크로스 컴파일이 아닌 경우, 스크립트가 설정:
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - 비-x64 / 변형 없음: `-C target-cpu=native`
  - 이미 설정된 경우, 스크립트가 오버라이드하지 않음

## 빌드 상태/라이프사이클 전환

### 빌드 라이프사이클 (`build-native.ts`)

1. **초기화**: 인수/환경 파싱 (`--dev`, 타겟 오버라이드, 크로스 플래그)
2. **변형 해결**:
   - 비-x64 → 변형 없음
   - x64 + `TARGET_VARIANT` → 명시적 변형
   - `TARGET_VARIANT` 없는 x64 크로스 빌드 → 하드 에러
   - 오버라이드 없는 x64 로컬 빌드 → 호스트 AVX2 감지
3. **컴파일**: 해결된 프로파일/타겟으로 Cargo 실행
4. **아티팩트 위치 확인**: 타겟 루트/프로파일 디렉토리/라이브러리 이름 스캔
5. **설치**: `packages/natives/native`에 복사 + 원자적 이름 변경
6. **완료**: 로더 후보를 위한 애드온 준비 완료

실패 시 명시적 에러 텍스트와 함께 즉시 종료됩니다 (잘못된 변형, cargo 빌드 실패, 출력 라이브러리 누락, 설치/이름 변경 실패).

### 임베드 라이프사이클 (`embed-native.ts`)

1. **초기화**: `TARGET_PLATFORM`/`TARGET_ARCH` 또는 호스트 값으로부터 플랫폼 태그 계산
2. **후보 세트**:
   - x64는 `modern`과 `baseline` 모두 기대
   - 비-x64는 하나의 기본 파일 기대
3. `packages/natives/native`에서 **가용성 검증**
4. Bun `file` 임포트 및 패키지 버전을 포함한 **매니페스트 생성** (`src/embedded-addon.ts`)
5. 컴파일 모드를 위한 **런타임 추출 준비**

`--reset`은 검증을 우회하고 null 매니페스트 스텁(`embeddedAddon = null`)을 작성합니다.

## 개발 워크플로우 vs 배포/컴파일 동작

## 로컬 개발 워크플로우

일반적인 로컬 루프:

1. 애드온 빌드:
   - 릴리스: `bun --cwd=packages/natives run build`
   - 디버그 프로파일: `bun --cwd=packages/natives run dev:native`
2. 로더 진단 테스트 시 `PI_DEV=1` 설정
3. `native.ts`의 로더가 패키지 로컬 `native/` (및 실행 파일 디렉토리 폴백) 후보를 해결
4. `validateNative`가 래퍼가 바인딩을 사용하기 전에 내보내기 호환성을 강제

## 배포/컴파일된 바이너리 워크플로우

컴파일 모드에서 (`PI_COMPILED` 또는 Bun 임베디드 마커):

1. 로더가 버전화된 캐시 디렉토리를 계산: `<getNativesDir()>/<packageVersion>` (운영상 `~/.xcsh/natives/<version>`)
2. 임베디드 매니페스트가 현재 플랫폼+버전과 일치하면, 로더가 선택된 임베디드 파일을 해당 버전화된 디렉토리에 추출할 수 있음
3. 런타임 후보 순서:
   - 버전화된 캐시 디렉토리
   - 레거시 컴파일된 바이너리 디렉토리 (Windows에서 `%LOCALAPPDATA%/xcsh`, 그 외에서 `~/.local/bin`)
   - 패키지/실행 파일 디렉토리
4. 성공적으로 로드된 첫 번째 애드온도 여전히 `validateNative`를 통과해야 함

이것이 패키징과 런타임 로더 기대치가 일치해야 하는 이유입니다: 파일명, 플랫폼 태그, 내보낸 심볼이 `native.ts`가 탐색하고 검증하는 것과 일치해야 합니다.

## JS API ↔ Rust 내보내기 매핑 (유효성 검증 게이트 하위 집합)

`native.ts`는 로드된 애드온에 다음 JS에서 보이는 내보내기가 존재하도록 요구합니다. 이들은 `crates/pi-natives/src`의 Rust N-API 내보내기에 매핑됩니다:

| `validateNative`에서 요구하는 JS 이름 | Rust 내보내기 선언 | Rust 소스 파일 |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (카멜케이스 내보내기) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

필수 심볼이 누락되면, 로더는 리빌드 힌트와 함께 즉시 실패합니다.

## 실패 동작 및 진단

## 빌드 시점 실패

- 잘못된 변형 구성:
  - 비-x64에서 `TARGET_VARIANT` 설정 → 즉시 에러
  - 명시적 `TARGET_VARIANT` 없는 x64 크로스 빌드 → 즉시 에러
- Cargo 빌드 실패:
  - 스크립트가 비정상 종료 코드와 stderr를 표시
- 아티팩트를 찾을 수 없음:
  - 스크립트가 확인한 모든 프로파일 디렉토리를 출력
- 설치 실패:
  - 명시적 메시지; Windows는 잠긴 파일 힌트 포함

## 런타임 로더 실패 (`native.ts`)

- 지원되지 않는 플랫폼 태그:
  - 지원되는 플랫폼 목록과 함께 throw
- 로드 가능한 후보 없음:
  - 전체 후보 에러 목록 및 모드별 해결 힌트와 함께 throw
- 누락된 내보내기:
  - 정확한 누락 심볼 이름과 리빌드 명령과 함께 throw
- 임베디드 추출 문제:
  - 추출 mkdir/write 에러가 기록되어 최종 진단에 포함

## 문제 해결 매트릭스

| 증상 | 가능한 원인 | 확인 방법 | 해결 방법 |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | 오래된 `.node` 바이너리, Rust 내보내기 이름 불일치, 또는 잘못된 바이너리 로드 | `PI_DEV=1`로 실행하여 로드된 경로 확인; 해당 파일의 내보내기 목록 검사 | `build` 리빌드; Rust `#[napi]` 내보내기 이름(또는 필요 시 명시적 별칭)이 JS 키와 일치하는지 확인; 오래된 캐시/버전화된 파일 제거 |
| x64 머신에서 modern이 기대되지만 baseline 로드 | `PI_NATIVE_VARIANT=baseline`, AVX2 미감지, 또는 baseline 파일만 존재 | `PI_NATIVE_VARIANT` 확인; `native/`에서 `-modern` 파일 검사 | modern 변형 빌드 (`TARGET_VARIANT=modern ... build`) 후 파일이 배포되었는지 확인 |
| 크로스 빌드가 사용 불가/잘못 레이블된 바이너리 생성 | `CROSS_TARGET`과 `TARGET_PLATFORM`/`TARGET_ARCH` 불일치, 또는 x64용 `TARGET_VARIANT` 누락 | 환경 변수 튜플과 출력 파일명 확인 | 일관된 환경 변수 값과 명시적 x64 `TARGET_VARIANT`로 재실행 |
| 업그레이드 후 컴파일된 바이너리 실패 | 오래된 추출 캐시 (`~/.xcsh/natives/<old-or-mismatched-version>`) 또는 임베디드 매니페스트 불일치 | 버전화된 natives 디렉토리 및 로더 에러 목록 검사 | 해당 패키지 버전의 버전화된 natives 캐시를 삭제하고 재실행; 패키징 중 임베디드 매니페스트 재생성 |
| 로더가 많은 경로를 탐색하지만 아무것도 작동하지 않음 | 플랫폼 불일치 또는 패키지 `native/`에 릴리스 아티팩트 누락 | `platformTag`와 실제 파일명 비교 확인 | 빌드된 파일명이 `pi_natives.<platform>-<arch>(-variant).node` 규칙과 정확히 일치하는지 확인하고 패키지에 `native/`가 포함되어 있는지 확인 |
| `embed:native`가 "Incomplete native addons"로 실패 | 임베딩 전에 필수 변형 파일이 빌드되지 않음 | 에러 텍스트에서 기대 vs 발견 목록 확인 | 필수 파일을 먼저 빌드 (x64: modern+baseline 모두; 비-x64: 기본값), 그 후 `embed:native` 재실행 |

## 운영 명령

```bash
# 현재 호스트용 릴리스 아티팩트
bun --cwd=packages/natives run build

# 디버그 프로파일 아티팩트 빌드
bun --cwd=packages/natives run dev:native

# 명시적 x64 변형 빌드
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# 빌드된 네이티브 파일로부터 임베디드 애드온 매니페스트 생성
bun --cwd=packages/natives run embed:native

# 임베디드 매니페스트를 null 스텁으로 초기화
bun --cwd=packages/natives run embed:native -- --reset
```
