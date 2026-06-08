---
title: Native Rust Task Execution and Cancellation
description: >-
  Rust async task execution model with cooperative cancellation and cleanup
  semantics.
sidebar:
  order: 5
  label: 태스크 취소
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# 네이티브 Rust 태스크 실행 및 취소 (`pi-natives`)

이 문서는 `crates/pi-natives`가 네이티브 작업을 스케줄링하는 방법과 JS 옵션(`timeoutMs`, `AbortSignal`)에서 Rust 실행으로 취소가 전파되는 흐름을 설명합니다.

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
   - `compute()`는 libuv 워커 스레드에서 실행됩니다 (CPU 바운드 또는 블로킹/동기 시스템 호출용).
   - JS `Promise<T>`를 반환합니다.

2. `task::future(env, tag, work)`
   - `env.spawn_future(...)`를 래핑합니다.
   - Tokio 런타임에서 비동기 작업을 실행합니다.
   - `PromiseRaw<'env, T>`를 반환합니다.

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)`은 데드라인 + 선택적 `AbortSignal`을 결합합니다.
   - `CancelToken::heartbeat()`는 블로킹 루프를 위한 협력적 취소입니다.
   - `CancelToken::wait()`는 비동기 취소 대기입니다 (`Signal` / `Timeout` / `User` Ctrl-C).
   - `AbortToken`은 외부 코드가 중단을 요청할 수 있게 합니다 (`abort(reason)`).

## `blocking` vs `future`: 실행 모델 및 선택 기준

### `task::blocking` 사용 시기

작업이 CPU 집약적이거나 근본적으로 동기/블로킹인 경우 사용합니다:

- 정규식/파일 스캔 (`grep`, `glob`, `fuzzy_find`)
- 동기 PTY 루프 내부 (`run_pty_sync`, `spawn_blocking` 경유)
- 클립보드/이미지/HTML 변환

동작:

- 작업 클로저가 복제된 `CancelToken`을 받습니다.
- 취소는 코드가 `ct.heartbeat()?`를 확인하는 곳에서만 관찰됩니다.
- 클로저의 `Err(...)`는 JS 프로미스를 거부합니다.

### `task::future` 사용 시기

작업이 비동기 연산을 `await`해야 하는 경우 사용합니다:

- 셸 세션 오케스트레이션 (`shell.run`, `executeShell`)
- 완료와 취소 간 태스크 레이싱 (`tokio::select!`)

동작:

- Future가 정상 완료와 `ct.wait()` 간 레이스를 할 수 있습니다.
- 취소 경로에서 비동기 구현은 일반적으로 내부 하위 시스템(예: `tokio_util::CancellationToken`)으로 취소를 전파하고, 선택적으로 유예 타임아웃 후 강제 중단합니다.

## JS API ↔ Rust export 매핑 (태스크/취소 관련)

| JS-facing API | Rust export (`#[napi]`) | 스케줄러 | 취소 연결 |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + 필터 루프에서 `ct.heartbeat()` |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + 스코어링 루프에서 `ct.heartbeat()` |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()`를 실행 태스크와 레이싱; Tokio `CancellationToken`으로 브리징 |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | 위와 동일 |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + 내부 `spawn_blocking` | 동기 PTY 루프에서 `heartbeat()`를 통해 `CancelToken` 확인 |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | 없음 (`()` 토큰) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | 없음 (`()` 토큰) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | 없음 (`()` 토큰) |

`text.rs`와 `ps.rs`는 현재 `task::blocking`/`task::future`를 사용하지 않으므로 이 취소 경로에 참여하지 않습니다.

## 취소 생명주기 및 상태 전이

### `CancelToken` 생명주기

`CancelToken`은 협력적이며 상태를 가집니다:

```text
Created
  ├─ no signal + no timeout  -> passive token (never aborts unless externally emplaced)
  ├─ signal registered        -> waits for AbortSignal callback
  └─ deadline set             -> timeout check becomes active

Running
  ├─ heartbeat()/wait() sees signal   -> AbortReason::Signal
  ├─ heartbeat()/wait() sees deadline -> AbortReason::Timeout
  ├─ wait() sees Ctrl-C               -> AbortReason::User
  └─ no abort                         -> continue

Aborted (terminal)
  └─ first abort reason wins (atomic flag + notifier)
```

### 시작 전 vs 실행 중 취소

- **시작 전 / 첫 번째 취소 확인 전**:
  - `task::future` 사용자가 `ct.wait()`에서 레이스하면 `select!`에 진입하자마자 즉시 취소를 확인할 수 있습니다.
  - `task::blocking` 사용자는 클로저 코드가 `heartbeat()`에 도달해야만 취소를 관찰합니다. 클로저가 초기에 heartbeat를 수행하지 않으면 취소가 지연됩니다.

- **실행 중**:
  - `blocking`: 다음 `heartbeat()`가 `Err("Aborted: ...")`를 반환합니다.
  - `future`: `ct.wait()` 브랜치가 `select!`에서 승리한 후, 코드가 하위 비동기 메커니즘을 취소합니다 (셸의 경우: Tokio 토큰 취소, 최대 2초 대기 후 태스크 강제 중단).

## 장시간 실행 루프에서의 heartbeat 요구사항

`heartbeat()`는 무제한 또는 대규모 작업 집합을 가진 루프에서 예측 가능한 주기로 실행되어야 합니다.

관찰된 패턴:

- `glob::filter_entries`: 필터링/매칭 전 각 항목마다 확인.
- `fd::score_entries`: 스캔된 각 후보마다 확인.
- `grep_sync`: 무거운 검색 단계 전 명시적 취소 확인, 그리고 토큰을 받는 fs-cache 호출도 포함.
- `run_pty_sync`: 매 루프 틱마다 확인 (~16ms 슬립 주기) 및 취소 시 자식 프로세스 종료.

실용적 규칙: 외부 크기 입력에 대한 루프는 heartbeat 없이 짧은 제한 간격을 초과해서는 안 됩니다.

## 실패 동작 및 JS로의 에러 전파

### 블로킹 태스크

에러 경로:

1. 클로저가 `Err(napi::Error)`를 반환합니다 (`heartbeat()` 중단 포함).
2. `Task::compute()`가 `Err`를 반환합니다.
3. `AsyncTask`가 JS 프로미스를 거부합니다.

일반적인 에러 문자열:

- `Aborted: Timeout`
- `Aborted: Signal`
- 도메인 에러 (`Failed to decode image: ...`, `Conversion error: ...` 등)

### Future 태스크

에러 경로:

1. 비동기 본문이 `Err(napi::Error)`를 반환하거나 join 실패가 매핑됩니다 (`... task failed: {err}`).
2. `task::future`로 생성된 프로미스가 거부됩니다.
3. 일부 API는 거부 대신 의도적으로 구조화된 취소 결과를 반환합니다 (`cancelled`/`timed_out` 플래그와 `exit_code: None`을 가진 `ShellRunResult`/`ShellExecuteResult`).

### 취소 보고 분리

- **에러로서의 중단**: `heartbeat()?`를 사용하는 대부분의 블로킹 export.
- **타입이 지정된 결과로서의 중단**: 취소를 결과 구조체에 모델링하는 셸/PTY 스타일 명령 API.

API별로 하나의 모델을 선택하고 명시적으로 문서화하세요.

## 일반적인 함정

1. **블로킹 루프에서 heartbeat 누락**
   - 증상: timeout/signal이 루프가 끝날 때까지 무시되는 것처럼 보임.
   - 해결: 루프 상단과 항목별 비용이 큰 단계 전에 `ct.heartbeat()?`를 추가.

2. **긴 취소 불가 구간**
   - 증상: 단일 대규모 호출(디코드, 정렬, 압축 등) 중 취소 지연 급증.
   - 해결: heartbeat 경계로 작업을 청크로 분할; 불가능한 경우 지연을 문서화.

3. **비동기 실행기 블로킹**
   - 증상: 동기 집약적 코드가 future에서 직접 실행될 때 비동기 API가 정지.
   - 해결: CPU/동기 블록을 `task::blocking` 또는 `tokio::task::spawn_blocking`으로 이동.

4. **일관성 없는 취소 의미론**
   - 증상: 한 API는 취소 시 거부하고, 다른 API는 플래그와 함께 resolve하여 호출자 혼란.
   - 해결: 도메인별로 표준화하고 래퍼 문서를 일치시키기.

5. **중첩 비동기 태스크에서 취소 브리지 누락**
   - 증상: 외부 토큰은 취소되었지만 내부 리더/서브프로세스 태스크가 계속 실행.
   - 해결: 내부 토큰/시그널로 취소를 브리징하고 유예 타임아웃 + 강제 중단 폴백을 적용.

## 새로운 취소 가능 export를 위한 체크리스트

1. 작업을 올바르게 분류합니다:
   - CPU 바운드 또는 동기 블로킹 -> `task::blocking`
   - 비동기 I/O / `await` 오케스트레이션 -> `task::future`

2. 필요한 경우 취소 입력을 노출합니다:
   - `#[napi(object)]` options에 `timeoutMs`와 `signal` 포함
   - `let ct = task::CancelToken::new(timeout_ms, signal);` 생성

3. 모든 레이어를 통해 취소를 연결합니다:
   - 블로킹 루프: 안정적인 간격으로 `ct.heartbeat()?`
   - 비동기 오케스트레이션: `ct.wait()`와 레이스하고 하위 태스크/토큰 취소

4. 취소 계약을 결정합니다:
   - 중단 에러로 프로미스 거부, 또는
   - 타입이 지정된 `{ cancelled, timedOut, ... }`로 resolve
   - API 패밀리 내에서 이 계약을 일관되게 유지

5. 컨텍스트와 함께 실패를 전파합니다:
   - `Error::from_reason(format!("...: {err}"))`를 통해 에러 매핑
   - 단계별 접두사 포함 (`spawn`, `decode`, `wait` 등)

6. 시작 전 및 실행 중 취소를 처리합니다:
   - 취소 확인/대기는 비용이 큰 본문 전과 장시간 실행 중에 발생해야 합니다

7. 실행기 오용이 없는지 검증합니다:
   - `spawn_blocking`/블로킹 태스크 래퍼 없이 비동기 future 내에서 긴 동기 작업을 직접 수행하지 않아야 합니다
