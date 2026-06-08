---
title: Natives 텍스트 및 검색 파이프라인
description: >-
  Native text search pipeline with grep, glob, and ripgrep-based file content
  indexing.
sidebar:
  order: 6
  label: 텍스트 & 검색 파이프라인
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# Natives 텍스트/검색 파이프라인

이 문서는 `@f5xc-salesdemos/pi-natives` 텍스트/검색 표면(`grep`, `glob`, `text`, `highlight`)을 TypeScript 래퍼에서 Rust N-API 내보내기로, 그리고 다시 JS 결과 객체로 매핑합니다.

용어는 `docs/natives-architecture.md`를 따릅니다:

- **래퍼(Wrapper)**: `packages/natives/src/*`의 TS API
- **Rust 모듈 레이어**: `crates/pi-natives/src/*`의 N-API 내보내기
- **공유 스캔 캐시**: 디스커버리/검색 흐름에서 사용하는 `fs_cache` 기반 디렉터리 항목 캐시

## 구현 파일

- `packages/natives/src/grep/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/highlight/types.ts`
- `crates/pi-natives/src/grep.rs`
- `crates/pi-natives/src/glob.rs`
- `crates/pi-natives/src/glob_util.rs`
- `crates/pi-natives/src/fs_cache.rs`
- `crates/pi-natives/src/text.rs`
- `crates/pi-natives/src/highlight.rs`
- `crates/pi-natives/src/fd.rs`

## JS API ↔ Rust 내보내기 매핑

| JS 래퍼 API | Rust 내보내기 (`#[napi]`, snake_case -> camelCase) | Rust 모듈 |
| --- | --- | --- |
| `grep(options, onMatch?)` | `grep` | `grep.rs` |
| `searchContent(content, options)` | `search` | `grep.rs` |
| `hasMatch(content, pattern, options?)` | `hasMatch` | `grep.rs` |
| `fuzzyFind(options)` | `fuzzyFind` | `fd.rs` |
| `glob(options, onMatch?)` | `glob` | `glob.rs` |
| `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `fs_cache.rs` |
| `wrapTextWithAnsi(text, width)` | `wrapTextWithAnsi` | `text.rs` |
| `truncateToWidth(text, maxWidth, ellipsis, pad)` | `truncateToWidth` | `text.rs` |
| `sliceWithWidth(line, startCol, length, strict?)` | `sliceWithWidth` | `text.rs` |
| `extractSegments(line, beforeEnd, afterStart, afterLen, strictAfter)` | `extractSegments` | `text.rs` |
| `sanitizeText(text)` | `sanitizeText` | `text.rs` |
| `visibleWidth(text)` | `visibleWidth` | `text.rs` |
| `highlightCode(code, lang, colors)` | `highlightCode` | `highlight.rs` |
| `supportsLanguage(lang)` | `supportsLanguage` | `highlight.rs` |
| `getSupportedLanguages()` | `getSupportedLanguages` | `highlight.rs` |

## 하위 시스템별 파이프라인 개요

## 1) 정규식 검색 (`grep`, `searchContent`, `hasMatch`)

### 입력/옵션 흐름

1. TS 래퍼가 옵션을 네이티브로 전달합니다:
   - `grep/index.ts`는 `options`를 대부분 그대로 전달하고 콜백을 `(match) => void`에서 napi threadsafe 콜백 형태 `(err, match)`로 래핑합니다.
   - `searchContent`와 `hasMatch`는 문자열/`Uint8Array`를 직접 전달합니다.
2. `grep.rs`의 Rust 옵션 구조체는 camelCase 필드(`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`)를 역직렬화합니다.
3. `grep`은 `timeoutMs` + `AbortSignal`로부터 `CancelToken`을 생성하고 `task::blocking("grep", ...)` 내부에서 실행합니다.

### 실행 분기

- **인메모리 분기 (순수 유틸리티)**
  - `search` → `search_sync` → 제공된 콘텐츠 바이트에 대해 `run_search` 실행.
  - 파일시스템 스캔 없음, `fs_cache` 없음.
- **단일 파일 분기 (파일시스템 의존)**
  - `grep_sync`가 경로를 해석하고, 메타데이터가 파일인지 확인한 후, ripgrep 매처를 통해 파일당 최대 `MAX_FILE_BYTES`(`4 MiB`)까지 스트리밍합니다.
- **디렉터리 분기 (파일시스템 의존)**
  - `cache: true`일 때 `fs_cache::get_or_scan`을 통한 선택적 캐시 조회.
  - `cache: false`일 때 `fs_cache::force_rescan`을 통한 새로운 스캔.
  - 캐시 수명이 `empty_recheck_ms()`를 초과할 때 빈 결과에 대한 선택적 재검사.
  - 항목 필터링: 파일만 + 선택적 glob 필터(`glob_util`) + 선택적 타입 필터 매핑(`js`, `ts`, `rust` 등).

### 검색/수집 의미론

- 정규식 엔진: `ignoreCase`와 `multiline`을 사용하는 `grep_regex::RegexMatcherBuilder`.
- 컨텍스트 해석:
  - `contextBefore/contextAfter`가 레거시 `context`를 오버라이드합니다.
  - 비콘텐츠 모드에서는 컨텍스트 수집을 0으로 설정합니다.
- 출력 모드:
  - `content` => 히트당 하나의 `GrepMatch`.
  - `count`와 `filesWithMatches` 모두 카운트 스타일 항목으로 매핑(`lineNumber=0`, `line=""`, `matchCount` 설정).
- 제한:
  - 전역 `offset`과 `maxCount`가 파일 전체에 적용됩니다.
  - 병렬 경로는 `maxCount`가 설정되지 않고 `offset == 0`일 때만 사용됩니다; 그렇지 않으면 순차 경로가 결정론적인 전역 오프셋/제한 의미론을 유지합니다.

### JS로의 결과 변환

- Rust `SearchResult`/`GrepResult` 필드는 N-API 객체 필드 변환을 통해 TS 타입으로 매핑됩니다.
- 카운터는 N-API 경계를 넘기 전에 `u32`로 클램핑됩니다.
- 선택적 불리언은 일부 경로에서 true가 아닌 한 생략됩니다(`limitReached`).
- 스트리밍 콜백은 각각 변환된 `GrepMatch`(콘텐츠 또는 카운트 항목)를 수신합니다.

### 실패 동작

- `searchContent`는 정규식/검색 실패 시 예외를 던지는 대신 `SearchResult.error`를 반환합니다.
- `grep`은 하드 에러(유효하지 않은 경로, 유효하지 않은 glob/정규식, 취소 타임아웃/중단) 시 거부합니다.
- `hasMatch`는 `Result<bool>`을 반환하며 유효하지 않은 패턴/UTF-8 디코딩 오류 시 예외를 던집니다.
- 다중 파일 스캔에서의 파일 열기/검색 오류는 파일별로 건너뛰며; 스캔은 계속됩니다.

### 잘못된 정규식 처리

`grep.rs`는 정규식 컴파일 전에 중괄호를 정제합니다:

- 유효하지 않은 반복 형태의 중괄호는 `{N}`, `{N,}`, `{N,M}`을 형성할 수 없을 때 이스케이프됩니다(`{`/`}` -> `\{`/`\}`).
- 이는 일반적인 리터럴 템플릿 조각(예: `${platform}`)이 잘못된 반복으로 실패하는 것을 방지합니다.
- 나머지 유효하지 않은 정규식 구문은 여전히 정규식 오류를 반환합니다.

## 2) 파일 디스커버리 (`glob`) 및 퍼지 경로 검색 (`fuzzyFind`)

`glob`과 `fuzzyFind`는 `fs_cache` 스캔을 공유하며; 매칭 로직이 다릅니다.

### `glob` 흐름

1. TS 래퍼 (`glob/index.ts`):
   - `path.resolve(options.path)`.
   - 기본값: `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`.
2. Rust `glob`이 `GlobConfig`를 구성하고 `glob_util::compile_glob`을 통해 패턴을 컴파일합니다.
3. 항목 소스:
   - `cache=true` => `get_or_scan` + 선택적 오래된 빈 결과 `force_rescan`.
   - `cache=false` => `force_rescan(..., store=false)` (새로운 스캔만).
4. 필터링:
   - `.git`은 항상 건너뜁니다.
   - `node_modules`는 요청하지 않는 한 건너뜁니다(`includeNodeModules` 또는 node_modules를 언급하는 패턴).
   - glob 매칭 적용.
   - 파일 타입 필터 적용; 심링크 `file/dir` 필터는 대상 메타데이터를 해석합니다.
5. `maxResults`로 잘라내기 전에 선택적으로 mtime 내림차순 정렬(`sortByMtime`).

### `fuzzyFind` 흐름 (`fd.rs`에 구현)

1. TS 래퍼는 `grep` 모듈에서 내보내지지만, Rust 구현은 `fd.rs`에 있습니다.
2. 동일한 캐시/비캐시 분할 및 오래된 빈 결과 재검사 정책을 가진 `fs_cache`의 공유 스캔 소스.
3. 스코어링:
   - 정확 일치 / 시작 일치 / 포함 / 부분 시퀀스 기반 퍼지 점수
   - 구분자/구두점 정규화된 스코어링 경로
   - 디렉터리 보너스 및 결정론적 동점 처리(`score desc`, 그 다음 `path asc`)
4. 심링크 항목은 퍼지 결과에서 제외됩니다.

### 실패 동작

- 유효하지 않은 glob 패턴 => `glob_util::compile_glob`에서 오류.
- 검색 루트는 기존 디렉터리여야 합니다(`resolve_search_path`), 그렇지 않으면 오류.
- 취소/타임아웃은 루프 내 `CancelToken::heartbeat()` 검사를 통해 중단 오류로 전파됩니다.

### 잘못된 glob 처리

`glob_util::build_glob_pattern`은 관대합니다:

- `\`를 `/`로 정규화합니다.
- `recursive=true`일 때 단순 재귀 패턴에 `**/`를 자동 접두사로 추가합니다.
- 컴파일 전에 불균형한 `{...` 교대 그룹을 자동으로 닫습니다.

## 3) 공유 스캔/캐시 수명주기 (`fs_cache`)

`fs_cache`는 스캔 결과를 정규화된 상대 항목(`path`, `fileType`, 선택적 `mtime`)으로 저장하며 다음을 키로 사용합니다:

- 정규화된 검색 루트
- `include_hidden`
- `use_gitignore`

### 캐시 상태 전이

1. **미스 / 비활성화**
   - TTL이 `0`이거나 키가 없거나/만료됨 -> 새로운 `collect_entries`.
2. **히트**
   - 항목 수명 `< cache_ttl_ms()` -> 캐시된 항목 + `cache_age_ms` 반환.
3. **오래된 빈 결과 재검사** (`glob`/`grep`/`fd`의 호출자 정책)
   - 쿼리가 0개의 매치를 반환하고 `cache_age_ms >= empty_recheck_ms()`이면, 한 번의 재스캔을 강제합니다.
4. **무효화**
   - `invalidateFsScanCache(path?)`:
     - 인수 없음: 모든 키 삭제
     - path 인수: 해당 대상 경로를 접두사로 하는 루트의 키 제거

### 오래된 결과 트레이드오프

- 캐시는 즉각적인 일관성보다 반복 스캔의 낮은 지연 시간을 우선합니다.
- TTL 윈도우는 오래된 긍정/부정 결과를 반환할 수 있습니다.
- 빈 결과 재검사는 한 번의 추가 스캔 비용으로 오래된 캐시 스캔의 오래된 부정 결과를 줄입니다.
- 명시적 무효화는 파일 변경 후 의도된 정확성 후크입니다.

## 4) ANSI 텍스트 유틸리티 (`text`)

이들은 순수 인메모리 유틸리티입니다(파일시스템 스캔 없음).

### 경계와 책임

- **`text.rs`는 터미널 셀 의미론을 담당합니다**:
  - ANSI 시퀀스 파싱
  - 자소(grapheme) 인식 너비 및 슬라이싱
  - 줄바꿈/잘라내기/정제 동작
- **`grep.rs`의 라인 잘라내기(`maxColumns`)는 별개입니다**:
  - `...`을 사용한 매칭된 라인의 단순 문자 경계 잘라내기
  - ANSI 상태를 보존하지 않으며 터미널 셀 너비를 인식하지 않음

### 주요 동작

- `wrapTextWithAnsi`: 보이는 너비로 줄바꿈하며, 활성 SGR 코드를 줄바꿈된 라인에 걸쳐 전달합니다.
- `truncateToWidth`: 줄임표 정책(`Unicode`, `Ascii`, `Omit`)에 따른 보이는 셀 잘라내기, 선택적 오른쪽 패딩, 그리고 변경되지 않을 때 원본 JS 문자열을 반환하는 빠른 경로.
- `sliceWithWidth`: 선택적 엄격 너비 적용을 사용한 열 슬라이싱.
- `extractSegments`: 오버레이 주변의 전/후 세그먼트를 추출하며 `after` 세그먼트에 대한 ANSI 상태를 복원합니다.
- `sanitizeText`: ANSI 이스케이프 + 제어 문자를 제거하고, 고립된 서로게이트를 삭제하며, `\r`을 제거하여 CR/LF를 정규화합니다.
- `visibleWidth`: 보이는 터미널 셀을 셉니다(탭은 Rust 구현의 고정 `TAB_WIDTH`를 사용합니다).

### 실패 동작

텍스트 함수는 일반적으로 결정론적으로 변환된 출력을 반환합니다; 오류는 JS 문자열 변환 경계(N-API 인수 변환 실패)에 한정됩니다.

## 5) 구문 강조 (`highlight`)

`highlight.rs`는 순수 변환입니다(FS 없음, 캐시 없음).

### 흐름

1. 래퍼가 `code`, 선택적 `lang`, 그리고 ANSI 색상 팔레트를 전달합니다.
2. Rust가 다음을 통해 구문을 해석합니다:
   - 토큰/이름 조회
   - 확장자 조회
   - 별칭 테이블 폴백(`ts/tsx/js -> JavaScript` 등)
   - 해석되지 않을 때 일반 텍스트 구문으로 폴백
3. syntect `ParseState`와 스코프 스택으로 각 라인을 파싱합니다.
4. 스코프를 11개의 의미적 색상 카테고리에 매핑하고 ANSI 색상 코드를 삽입/재설정합니다.

### 실패 동작

- 라인별 파싱 실패는 호출을 실패시키지 않습니다: 해당 라인은 강조 없이 추가되며 처리가 계속됩니다.
- 알 수 없는/지원되지 않는 언어는 일반 텍스트 구문으로 폴백합니다.

## 순수 유틸리티 vs 파일시스템 의존 흐름

| 흐름 | 파일시스템 접근 | 공유 캐시 | 비고 |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | 아니오 | 아니오 | 제공된 바이트/문자열에 대한 정규식만 |
| `text` 모듈 함수 | 아니오 | 아니오 | ANSI/너비/정제만 |
| `highlight` 모듈 함수 | 아니오 | 아니오 | 구문 + ANSI 색상 처리만 |
| `glob` | 예 | 선택적 | 디렉터리 스캔 + glob 필터링 |
| `fuzzyFind` | 예 | 선택적 | 디렉터리 스캔 + 퍼지 스코어링 |
| `grep` (파일/디렉터리 경로) | 예 | 선택적 (디렉터리 모드) | 파일에 대한 ripgrep, 선택적 필터/콜백 |

## 전체 수명주기 요약

1. 호출자가 타입이 지정된 옵션으로 TS 래퍼를 호출합니다.
2. 래퍼가 기본값을 정규화하고(특히 `glob`) `native.*` 내보내기로 전달합니다.
3. Rust가 옵션을 검증/정규화하고 매처/검색 설정을 구성합니다.
4. 파일시스템 흐름의 경우, 항목이 스캔(캐시 히트/미스/재스캔)된 후 필터링/스코어링됩니다.
5. 워커 루프가 주기적으로 취소 하트비트를 호출합니다; 타임아웃/중단이 실행을 종료할 수 있습니다.
6. Rust가 출력을 N-API 객체(`lineNumber`, `matchCount`, `limitReached` 등)로 변환합니다.
7. TS 래퍼가 타입이 지정된 JS 객체를 반환합니다(그리고 `grep`/`glob`에 대한 선택적 매치별 콜백).
