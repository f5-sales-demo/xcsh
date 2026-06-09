---
title: 네이티브 미디어 및 시스템 유틸리티
description: '스크린샷, 이미지 처리, 시스템 정보를 위한 네이티브 미디어 처리 유틸리티.'
sidebar:
  order: 7
  label: 미디어 & 시스템 유틸리티
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# 네이티브 미디어 + 시스템 유틸리티

이 문서는 [`docs/natives-architecture.md`](./natives-architecture.md)에 설명된 **system/media/conversion primitives** 계층에 대한 서브시스템 심층 분석입니다: `image`, `html`, `clipboard`, 그리고 `work` 프로파일링.

## 구현 파일

- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/prof.rs`
- `crates/pi-natives/src/task.rs`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/work/index.ts`
- `packages/natives/src/work/types.ts`

> 참고: `crates/pi-natives/src/work.rs`는 존재하지 않습니다. 작업 프로파일링은 `prof.rs`에 구현되어 있으며 `task.rs`의 계측에 의해 데이터가 공급됩니다.

## TS API ↔ Rust export/module 매핑

| TS export (packages/natives)                | Rust N-API export                                                       | Rust 모듈                           |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `PhotonImage.parse(bytes)`                  | `PhotonImage::parse`                                                     | `image.rs`                            |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize`                                                    | `image.rs`                            |
| `PhotonImage#encode(format, quality)`       | `PhotonImage::encode`                                                    | `image.rs`                            |
| `htmlToMarkdown(html, options)`             | `html_to_markdown`                                                       | `html.rs`                             |
| `copyToClipboard(text)`                     | `copy_to_clipboard` + TS 폴백 로직                                  | `clipboard.rs` + `clipboard/index.ts` |
| `readImageFromClipboard()`                  | `read_image_from_clipboard`                                              | `clipboard.rs`                        |
| `getWorkProfile(lastSeconds)`               | `get_work_profile`                                                      | `prof.rs`                             |

## 데이터 형식 경계 및 변환

### 이미지 (`image`)

- **JS 입력 경계**: `Uint8Array` 인코딩된 이미지 바이트.
- **Rust 디코드 경계**: 바이트가 `Vec<u8>`로 복사되고, `ImageReader::with_guessed_format()`으로 형식이 추측된 후 `DynamicImage`로 디코딩됩니다.
- **메모리 내 상태**: `PhotonImage`는 `Arc<DynamicImage>`를 저장합니다.
- **출력 경계**: `encode(format, quality)`는 `Promise<Uint8Array>` (Rust `Vec<u8>`)를 반환합니다.

형식 ID는 숫자입니다:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (무손실 인코더)
- `3`: GIF

제약 사항:

- `quality`는 JPEG에서만 사용됩니다.
- PNG/WebP/GIF는 `quality`를 무시합니다.
- 지원되지 않는 형식 ID는 실패합니다 (`Invalid image format: <id>`).

### HTML 변환 (`html`)

- **JS 입력 경계**: HTML `string` + 선택적 객체 `{ cleanContent?: boolean; skipImages?: boolean }`.
- **Rust 변환 경계**: `String` 입력이 `html_to_markdown_rs::convert`에 의해 변환됩니다.
- **출력 경계**: 마크다운 `string`.

변환 동작:

- `cleanContent`의 기본값은 `false`입니다.
- `cleanContent=true`일 때, `PreprocessingPreset::Aggressive`와 내비게이션/폼에 대한 강제 제거 플래그로 전처리가 활성화됩니다.
- `skipImages`의 기본값은 `false`입니다.

### 클립보드 (`clipboard`)

- **텍스트 경로**:
  - TS는 stdout이 TTY일 때 먼저 OSC 52 (`\x1b]52;c;<base64>\x07`)를 발행합니다.
  - 동일한 텍스트가 이후 최선 노력(best-effort)으로 네이티브 클립보드 API (`native.copyToClipboard`)를 통해 시도됩니다.
  - Termux에서는 TS가 먼저 `termux-clipboard-set`을 시도합니다.
- **이미지 읽기 경로**:
  - Rust가 `arboard`에서 원시 이미지를 읽습니다.
  - Rust가 이를 PNG 바이트로 재인코딩하고 (`image` 크레이트), `{ data: Uint8Array, mimeType: "image/png" }`를 반환합니다.
  - TS는 Termux 또는 디스플레이 서버가 없는 Linux 세션 (`DISPLAY`/`WAYLAND_DISPLAY` 누락)에서 조기에 `null`을 반환합니다.

### 작업 프로파일링 (`work`)

- **수집 경계**: 프로파일링 샘플은 `task::blocking`과 `task::future`의 `profile_region(tag)` 가드에 의해 생성됩니다.
- **저장 형식**: 스택 경로 + 지속 시간 (`μs`) + 타임스탬프 (`프로세스 시작 이후 μs`)를 저장하는 고정 크기 순환 버퍼 (`MAX_SAMPLES = 10,000`).
- **출력 경계**: `getWorkProfile(lastSeconds)`는 객체를 반환합니다:
  - `folded`: folded-stack 텍스트 (flamegraph 입력)
  - `summary`: 마크다운 테이블 요약
  - `svg`: 선택적 flamegraph SVG
  - `totalMs`, `sampleCount`

## 생명주기 및 상태 전환

### 이미지 생명주기

1. `PhotonImage.parse(bytes)`는 블로킹 디코드 태스크 (`image.decode`)를 스케줄링합니다.
2. 성공 시, JS에 네이티브 `PhotonImage` 핸들이 존재합니다.
3. `resize(...)`는 새로운 네이티브 핸들 (`image.resize`)을 생성하며, 이전 핸들과 새 핸들이 공존할 수 있습니다.
4. `encode(...)`는 이미지 크기를 변경하지 않고 바이트를 생성합니다 (`image.encode`).

실패 전환:

- 형식 감지/디코드 실패 시 parse 프로미스가 거부됩니다.
- 인코드 실패 시 encode 프로미스가 거부됩니다.
- 잘못된 형식 ID 시 encode 프로미스가 거부됩니다.

### HTML 생명주기

1. `htmlToMarkdown(html, options)`는 블로킹 변환 태스크를 스케줄링합니다.
2. 지정되지 않은 경우 기본 옵션 (`cleanContent=false`, `skipImages=false`)으로 변환이 실행됩니다.
3. 마크다운 문자열을 반환하거나 거부됩니다.

실패 전환:

- 변환기 실패 시 거부된 프로미스를 반환합니다 (`Conversion error: ...`).

### 클립보드 생명주기

`copyToClipboard(text)`는 의도적으로 최선 노력(best-effort)이며 다중 경로입니다:

1. TTY인 경우: OSC 52 쓰기 시도 (base64 페이로드).
2. `TERMUX_VERSION`이 설정된 경우 Termux 명령 시도.
3. 네이티브 `arboard` 텍스트 복사 시도.
4. TS 계층에서 오류를 억제합니다.

`readImageFromClipboard()`는 단계별로 엄격도가 다릅니다:

1. TS는 지원되지 않는 런타임 컨텍스트 (Termux/헤드리스 Linux)를 `null`로 강제 차단합니다.
2. Rust `arboard` 읽기는 TS가 허용할 때만 실행됩니다.
3. `ContentNotAvailable`은 `null`로 매핑됩니다.
4. 기타 Rust 오류는 거부됩니다.

### 작업 프로파일링 생명주기

1. 명시적 시작이 없습니다: 태스크 헬퍼가 실행될 때 프로파일링이 항상 켜져 있습니다.
2. 모든 계측된 태스크 스코프는 가드 드롭 시 하나의 샘플을 기록합니다.
3. 버퍼 용량에 도달하면 샘플이 가장 오래된 항목을 덮어씁니다.
4. `getWorkProfile(lastSeconds)`는 시간 창을 읽고 folded/summary/svg 아티팩트를 생성합니다.

실패 전환:

- SVG 생성 실패는 소프트 실패 (`svg: null`)이며, folded와 summary는 여전히 반환됩니다.
- 빈 샘플 창은 빈 folded 데이터와 `svg: null`을 반환하며, 오류가 아닙니다.

## 지원되지 않는 연산 및 오류 전파

### 이미지

- 지원되지 않는 디코드 입력 또는 손상된 바이트: 엄격한 실패 (프로미스 거부).
- 지원되지 않는 인코드 형식 ID: 엄격한 실패.
- TS 래퍼에 최선 노력 폴백 경로가 없습니다.

### HTML

- 변환 오류는 엄격한 실패입니다 (거부).
- 옵션 생략은 최선 노력 기본값 적용이며, 실패가 아닙니다.

### 클립보드

- 텍스트 복사는 TS 계층에서 최선 노력입니다: 운영 실패가 억제됩니다.
- 이미지 읽기는 "이미지 없음" (`null`)과 운영 실패 (거부)를 구분합니다.
- Termux/헤드리스 Linux는 이미지 읽기에 대해 지원되지 않는 컨텍스트로 처리됩니다 (`null`).

### 작업 프로파일링

- 검색은 함수 호출 자체에 대해 엄격하지만, 아티팩트 생성은 부분적으로 최선 노력입니다 (`svg` nullable).
- 버퍼 잘림은 예상된 동작(링 버퍼)이며, 데이터 손실 버그가 아닙니다.

## 플랫폼 주의사항

- **클립보드 텍스트**: OSC 52는 터미널 지원에 의존합니다; 네이티브 클립보드 접근은 데스크톱 환경/세션에 의존합니다.
- **클립보드 이미지 읽기**: Termux와 디스플레이 서버가 없는 Linux에서 TS에 의해 차단됩니다.
