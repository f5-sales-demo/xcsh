---
title: 네이티브 Rust 태스크 실행 및 취소
description: 협력적 취소 및 정리 시맨틱을 갖춘 Rust 비동기 태스크 실행 모델.
sidebar:
  order: 5
  label: 태스크 취소
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# 네이티브 Rust 태스크 실행 및 취소 (`pi-natives`)

이 문서는 `crates/pi-natives`가 네이티브 작업을 스케줄링하는 방법과, JS 옵션(`timeoutMs`, `AbortSignal`)에서 Rust 실행까지 취소가 흐르는 방식을 설명합니다.

## 구현 파일

- `crates/pi-natives/src/task.rs`
- `crates/pi-natives/src/grep.rs`
- `crates/pi-natives/src/glob.rs`
- `crates/pi-natives/src/fd.rs`
- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/text.rs`
- `crates/pi-natives/src/ps.rs`

## 핵심 프리미티브 (`task.rs`)

`task.rs`는 세 가지 핵심 요소를 정의합니다:

1. `task::blocking(tag, cancel_token, work)`
   - `napi::AsyncTask` / `Task`를 래핑합니다.
   - `compute()`는 libuv 워커 스레드에서 실행됩니다 (CPU 집약적이거나 블로킹/동기 시스템 호출에 사용).
   - JS `Promise<T>`를 반환합니다.

2. `task::future(env, tag, work)`
   - `env.spawn_future(...)`를 래핑합니다.
   - Tokio 런타임에서 비동기 작업을 실행합니다.
   - `PromiseRaw<'env, T>`를 반환합니다.

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)`은 데드라인과 선택적 `AbortSignal`을 결합합니다.
   - `CancelToken::heartbeat()`은 블로킹 루프를 위한 협력적 취소입니다.
   - `CancelToken::wait()`은 비동기 취소 대기입니다 (`Signal` / `Timeout` / `User` Ctrl-C).
   - `AbortToken`은 외부 코드가 중단을 요청할 수 있게 합니다 (`abort(reason)`).

## `blocking` vs `future`: 실행 모델 및 선택 기준

### `task::blocking` 사용

작업이 CPU 집약적이거나 근본적으로 동기/블로킹인 경우 사용합니다:

- 정규식/파일 스캐닝 (`grep`, `glob`, `fuzzy_find`)
- 동기 PTY 루프 내부 (`spawn_blocking`을 통한 `run_pty_sync`)
- 클립보드/이미지/html 변환

동작:

- 작업 클로저는 복제된 `CancelToken`을 수신합니다.
- 취소는 코드가 `ct.heartbeat()?`를 확인하는 곳에서만 감지됩니다.
- 클로저 `Err(...)`는 JS 프로미스를 거부합니다.

### `task::future` 사용

작업이 비동기 연산을 `await`해야 하는 경우 사용합니다:

- 셸 세션 오케스트레이션 (`shell.run`, `executeShell`)
- 완료와 취소 간의 태스크 경쟁 (`tokio::select!`)

동작:

- 퓨처는 일반 완료와 `ct.wait()` 간에 경쟁할 수 있습니다.
- 취소 경로에서 비동기 구현은 일반적으로 내부 서브시스템(예: `tokio_util::CancellationToken`)에 취소를 전파하고 선택적으로 유예 타임아웃 시 강제 중단합니다.

## JS API ↔ Rust 내보내기 매핑 (태스크/취소 관련)

| JS 대면 API | Rust 내보내기 (`#[napi]`) | 스케줄러 | 취소 연결 |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + 필터 루프의 `ct.heartbeat()` |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + 점수 산정 루프의 `ct.heartbeat()` |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | 실행 태스크에 대한 `ct.wait()` 경쟁; Tokio `CancellationToken`으로 브리징 |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | 위와 동일 |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + 내부 `spawn_blocking` | 동기 PTY 루프에서 `heartbeat()`을 통해 `CancelToken` 확인 |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | 없음 (`()` 토큰) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | 없음 (`()` 토큰) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | 없음 (`()` 토큰) |

`text.rs`와 `ps.rs`는 현재 `task::blocking`/`task::future`를 사용하지 않으므로 이 취소 경로에 참여하지 않습니다.

## 취소 생명주기 및 상태 전환

### `CancelToken` 생명주기

`CancelToken`은 협력적이며 상태를 가집니다:

```text
생성됨
  ├─ 시그널 없음 + 타임아웃 없음  -> 수동 토큰 (외부에서 설정하지 않는 한 중단되지 않음)
  ├─ 시그널 등록됨               -> AbortSignal 콜백 대기
  └─ 데드라인 설정됨              -> 타임아웃 확인 활성화

실행 중
  ├─ heartbeat()/wait()이 시그널 감지   -> AbortReason::Signal
  ├─ heartbeat()/wait()이 데드라인 감지 -> AbortReason::Timeout
  ├─ wait()이 Ctrl-C 감지              -> AbortReason::User
  └─ 중단 없음                          -> 계속

중단됨 (종단)
  └─ 첫 번째 중단 이유가 우선 (원자적 플래그 + 알림자)
```

### 시작 전 vs 실행 중 취소

- **시작 전 / 첫 번째 취소 확인 전**:
  - `ct.wait()`로 경쟁하는 `task::future` 사용자는 `select!`에 진입하면 즉시 취소를 해결할 수 있습니다.
  - `task::blocking` 사용자는 클로저 코드가 `heartbeat()`에 도달할 때만 취소를 감지합니다. 클로저가 조기에 heartbeat를 호출하지 않으면 취소가 지연됩니다.

- **실행 중**:
  - `blocking`: 다음 `heartbeat()`가 `Err("Aborted: ...")`를 반환합니다.
  - `future`: `ct.wait()` 브랜치가 `select!`에서 승리하고, 코드가 하위 비동기 메커니즘을 취소합니다 (셸의 경우: Tokio 토큰 취소, 최대 2초 대기, 이후 태스크 강제 중단).

## 장시간 실행 루프에 대한 Heartbeat 기대 사항

`heartbeat()`는 범위를 알 수 없거나 큰 작업 집합을 가진 루프에서 예측 가능한 주기로 실행되어야 합니다.

관찰된 패턴:

- `glob::filter_entries`: 필터링/매칭 전 각 항목 확인.
- `fd::score_entries`: 스캔된 각 후보 확인.
- `grep_sync`: 무거운 검색 단계 전 명시적 취소 확인, 그리고 토큰도 수신하는 fs-cache 호출.
- `run_pty_sync`: 모든 루프 틱 확인 (~16ms 슬립 주기) 및 취소 시 자식 프로세스 종료.

실용적 규칙: 외부 크기 입력에 대한 루프는 heartbeat 없이 짧은 유계 간격을 초과해서는 안 됩니다.

## JS로의 실패 동작 및 오류 전파

### 블로킹 태스크

오류 경로:

1. 클로저가 `Err(napi::Error)`를 반환합니다 (`heartbeat()` 중단 포함).
2. `Task::compute()`가 `Err`를 반환합니다.
3. `AsyncTask`가 JS 프로미스를 거부합니다.

일반적인 오류 문자열:

- `Aborted: Timeout`
- `Aborted: Signal`
- 도메인 오류 (`Failed to decode image: ...`, `Conversion error: ...` 등)

### 퓨처 태스크

오류 경로:

1. 비동기 본문이 `Err(napi::Error)`를 반환하거나 조인 실패가 매핑됩니다 (`... task failed: {err}`).
2. `task::future`로 스폰된 프로미스가 거부됩니다.
3. 일부 API는 거부 대신 의도적으로 구조화된 취소 결과를 반환합니다 (`cancelled`/`timed_out` 플래그와 `exit_code: None`을 가진 `ShellRunResult`/`ShellExecuteResult`).

### 취소 보고 분리

- **오류로서의 중단**: `heartbeat()?`를 사용하는 대부분의 블로킹 내보내기.
- **타입이 지정된 결과로서의 중단**: 결과 구조체에서 취소를 모델링하는 셸/PTY 스타일 명령 API.

API별로 하나의 모델을 선택하고 명시적으로 문서화하세요.

## 일반적인 함정

1. **블로킹 루프에서 heartbeat 누락**
   - 증상: 루프가 끝날 때까지 타임아웃/시그널이 무시되는 것처럼 보임.
   - 해결: 루프 상단과 항목별 비용이 큰 단계 전에 `ct.heartbeat()?` 추가.

2. **취소할 수 없는 긴 섹션**
   - 증상: 단일 대용량 호출(디코딩, 정렬, 압축 등) 중 취소 지연 급증.
   - 해결: heartbeat 경계가 있는 청크로 작업 분할; 불가능한 경우 지연 시간 문서화.

3. **비동기 실행기 블로킹**
   - 증상: 동기 집약적 코드가 퓨처에서 직접 실행될 때 비동기 API 정체.
   - 해결: CPU/동기 블록을 `task::blocking` 또는 `tokio::task::spawn_blocking`으로 이동.

4. **일관성 없는 취소 시맨틱**
   - 증상: 한 API는 취소 시 거부하고, 다른 API는 플래그로 해결하여 호출자 혼란 유발.
   - 해결: 도메인별로 표준화하고 래퍼 문서를 일치시킴.

5. **중첩된 비동기 태스크에서 취소 브리지 누락**
   - 증상: 외부 토큰은 취소되었지만 내부 리더/서브프로세스 태스크가 계속 실행됨.
   - 해결: 내부 토큰/시그널로 취소를 브리징하고 유예 타임아웃 + 강제 중단 폴백 적용.

## 새로운 취소 가능 내보내기를 위한 체크리스트

1. 작업을 올바르게 분류:
   - CPU 집약적이거나 동기 블로킹 -> `task::blocking`
   - 비동기 I/O / `await` 오케스트레이션 -> `task::future`

2. 필요 시 취소 입력 노출:
   - `#[napi(object)]` 옵션에 `timeoutMs` 및 `signal` 포함
   - `let ct = task::CancelToken::new(timeout_ms, signal);` 생성

3. 모든 레이어에 취소 연결:
   - 블로킹 루프: 안정적인 간격으로 `ct.heartbeat()?`
   - 비동기 오케스트레이션: `ct.wait()`로 경쟁하고 서브 태스크/토큰 취소

4. 취소 계약 결정:
   - 중단 오류로 프로미스 거부, 또는
   - 타입이 지정된 `{ cancelled, timedOut, ... }` 해결
   - API 패밀리에 대해 이 계약을 일관되게 유지

5. 컨텍스트와 함께 실패 전파:
   - `Error::from_reason(format!("...: {err}"))`를 통해 오류 매핑
   - 단계별 접두사 포함 (`spawn`, `decode`, `wait` 등)

6. 시작 전 및 실행 중 취소 처리:
   - 취소 확인/대기는 비용이 큰 본문 전과 긴 실행 중에 반드시 수행

7. 실행기 오용 없음 검증:
   - `spawn_blocking`/블로킹 태스크 래퍼 없이 비동기 퓨처 내에서 직접 긴 동기 작업 금지
