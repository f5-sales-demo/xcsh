---
title: 'Natives Shell, PTY, Process, and Key Internals'
description: '네이티브 레이어에서의 Shell 실행, PTY 관리, 프로세스 라이프사이클, 키 이벤트 처리.'
sidebar:
  order: 4
  label: 'Shell, PTY & process'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# 네이티브 Shell, PTY, 프로세스, 키 내부 구조

이 문서는 `@f5xc-salesdemos/pi-natives`의 **실행/프로세스/터미널 프리미티브**인 `shell`, `pty`, `ps`, `keys`를 `docs/natives-architecture.md`의 아키텍처 용어를 사용하여 설명합니다.

## 구현 파일

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs` (Windows 전용)
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/ps.rs`
- `crates/pi-natives/src/keys.rs`
- `crates/pi-natives/src/task.rs` (shell/pty에서 사용하는 공유 취소 동작)
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/bindings.ts`

## 레이어 소유권

- **TS 래퍼/API 레이어** (`packages/natives/src/*`): 타입이 지정된 진입점, 취소 인터페이스 (`timeoutMs`, `AbortSignal`), JS 편의 기능.
- **Rust N-API 모듈 레이어** (`crates/pi-natives/src/*`): shell/PTY 프로세스 실행, 프로세스 트리 탐색/종료, 키 시퀀스 파싱.
- **검증 게이트** (`native.ts`, 아키텍처 수준): 래퍼가 사용되기 전에 필수 내보내기 (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, 키 헬퍼)가 존재하는지 확인합니다.

## Shell 서브시스템 (`shell`)

### API 모델

두 가지 실행 모드가 제공됩니다:

1. **일회성** 실행: `executeShell(options, onChunk?)`.
2. **영구 세션**: `new Shell(options?)`으로 생성 후 `shell.run(...)`을 반복 호출.

둘 다 스레드 안전 콜백을 통해 출력을 스트리밍하고 `{ exitCode?, cancelled, timedOut }`를 반환합니다.

### 세션 생성 및 환경 모델

Rust는 다음 설정으로 `brush_core::Shell`을 생성합니다:

- 비대화형 모드,
- `do_not_inherit_env: true`,
- 호스트 환경으로부터의 명시적 환경 재구성,
- 셸 민감 변수(`PS1`, `PWD`, `SHLVL`, bash 함수 내보내기 등)에 대한 스킵 리스트.

세션 환경 동작:

- `ShellOptions.sessionEnv`는 세션 생성 시 한 번 적용됩니다.
- `ShellRunOptions.env`는 명령 범위(`EnvironmentScope::Command`)이며 각 실행 후 팝됩니다.
- `PATH`는 Windows에서 대소문자 구분 없는 중복 제거와 함께 특별히 병합됩니다.

Windows 전용 경로 보강 (`shell/windows.rs`): 발견된 Git-for-Windows 경로(`cmd`, `bin`, `usr/bin`)가 존재하고 아직 포함되지 않은 경우 추가됩니다.

### 런타임 라이프사이클 및 상태 전이

영구 셸 (`Shell.run`)은 다음 상태 머신을 사용합니다:

- **유휴/미초기화**: `session: None`.
- **실행 중**: 첫 번째 `run()`이 지연 생성으로 세션을 만들고, `current_abort` 토큰을 저장하고, 명령을 실행합니다.
- **완료 + 유지**: 실행 제어 흐름이 `Normal`이면 `current_abort`가 해제되고 세션이 재사용됩니다.
- **완료 + 해체**: 제어 흐름이 루프/스크립트/셸 종료 관련(`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`)인 경우 세션이 삭제됩니다(`session: None`).
- **취소됨/시간 초과**: 실행 태스크가 취소되고, 유예 대기(2초) 후 강제 중단; 세션이 삭제됩니다.
- **오류**: 세션이 삭제됩니다.

일회성 셸 (`executeShell`)은 호출마다 항상 새 세션을 생성하고 삭제합니다.

### 스트리밍/출력 동작

- 표준 출력/표준 오류는 공유 파이프로 라우팅되어 동시에 읽힙니다.
- 리더는 UTF-8을 점진적으로 디코딩합니다; 유효하지 않은 바이트 시퀀스는 `U+FFFD` 대체 청크를 생성합니다.
- 프로세스 완료 후, 출력 드레인에는 백그라운드 작업이 디스크립터를 열어 두는 경우 행이 발생하지 않도록 유휴/최대 가드(`250ms` 유휴, `2s` 최대)가 있습니다.

### 취소, 시간 초과, 백그라운드 작업

- `CancelToken`은 `timeoutMs`와 선택적 `AbortSignal`로 구성됩니다.
- 취소/시간 초과 시, 셸 취소 토큰이 트리거된 후 태스크에 강제 중단 전 2초의 유예 시간이 주어집니다.
- 취소가 발생하면, 백그라운드 작업은 brush 작업 메타데이터를 사용하여 종료됩니다(`TERM` 후 지연된 `KILL`).

`Shell.abort()` 동작:

- 해당 `Shell` 인스턴스의 현재 실행 중인 명령만 중단합니다.
- 실행 중인 것이 없으면 no-op 성공입니다.

### 실패 동작

일반적으로 표면화되는 오류는 다음과 같습니다:

- 세션 초기화 실패 (`Failed to initialize shell`),
- cwd 오류 (`Failed to set cwd`),
- 환경 설정/팝 실패,
- 스냅샷 소스 실패,
- 파이프 생성/복제 실패,
- 실행 실패 (`Shell execution failed: ...`),
- 태스크 래퍼 실패 (`Shell execution task failed: ...`).

결과 수준의 취소 플래그:

- 시간 초과 -> `exitCode: undefined`, `timedOut: true`.
- 중단 시그널 -> `exitCode: undefined`, `cancelled: true`.

## PTY 서브시스템 (`pty`)

### API 모델

`new PtySession()`은 다음을 제공합니다:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### 런타임 라이프사이클 및 상태 전이

`PtySession` 상태 머신:

- **유휴**: `core: None`.
- **예약됨**: `start()`가 비동기 작업 시작 전에 동기적으로 제어 채널을 설치(`core: Some`)하므로, `write/resize/kill`이 즉시 유효해집니다.
- **실행 중**: 블로킹 PTY 루프가 자식 상태, 리더 이벤트, 취소 하트비트, 제어 메시지를 처리합니다.
- **터미널 종료**: 자식 종료 + 리더 완료.
- **최종화**: `start()` 태스크 완료 후(성공 또는 오류) `core`는 항상 `None`으로 리셋됩니다.

동시성 가드:

- 이미 실행 중일 때 시작하면 `PTY session already running`을 반환합니다.

### 생성/연결/쓰기/읽기/종료 패턴

- PTY는 `portable_pty::native_pty_system().openpty(...)`를 통해 열립니다.
- 명령은 현재 선택적 `cwd` 및 환경 오버라이드와 함께 `sh -lc <command>`로 실행됩니다.
- `write()`는 원시 바이트를 PTY stdin으로 전송합니다.
- `resize()`는 치수를 클램프(`cols 20..400`, `rows 5..200`)하고 마스터 리사이즈를 호출합니다.
- `kill()`은 실행을 취소됨으로 표시하고 자식 프로세스를 종료합니다.

출력 경로:

- 전용 리더 스레드가 마스터 스트림을 읽습니다,
- 유효하지 않은 바이트에 대해 `U+FFFD` 대체를 사용한 점진적 UTF-8 디코딩,
- 청크는 N-API 스레드 안전 콜백을 통해 전달됩니다.

### 취소 및 시간 초과 의미론

- `timeoutMs`와 `AbortSignal`이 `CancelToken`에 공급됩니다.
- 루프가 주기적으로 `ct.heartbeat()`를 호출합니다; 중단이 자식 킬을 트리거합니다.
- 시간 초과 분류는 문자열 기반입니다(하트비트 오류의 `"Timeout"` 부분 문자열).

### 실패 동작

오류 표면은 다음을 포함합니다:

- PTY 할당/열기 실패,
- PTY 스폰 실패,
- 라이터/리더 획득 실패,
- 자식 상태/대기 실패,
- 락 포이즈닝,
- 제어 채널 연결 해제 (`PTY session is no longer available`).

실행 중이 아닐 때의 제어 호출 실패:

- `write/resize/kill`은 `PTY session is not running`을 반환합니다.

## 프로세스 트리 서브시스템 (`ps`)

### API 모델

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

TS 래퍼는 또한 `setNativeKillTree(native.killTree)`를 통해 네이티브 킬 트리 통합을 공유 유틸리티에 등록합니다.

### 플랫폼별 구현

- **Linux**: `/proc/<pid>/task/<pid>/children`을 재귀적으로 읽습니다.
- **macOS**: `libproc` `proc_listchildpids`를 사용합니다.
- **Windows**: `CreateToolhelp32Snapshot`으로 프로세스 테이블을 스냅샷하고, 부모->자식 맵을 빌드하고, `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`로 종료합니다.

### 킬 트리 동작

- 하위 프로세스는 재귀적으로 수집됩니다.
- 킬 순서는 상향식(가장 깊은 하위 프로세스 먼저)으로 고아 프로세스 재부모화를 줄입니다.
- 루트 pid가 마지막에 종료됩니다.
- 반환 값은 성공한 종료 횟수입니다.

시그널 동작:

- POSIX: 제공된 `signal`이 `kill`에 전달됩니다.
- Windows: `signal`은 무시됩니다; 종료는 무조건 프로세스 종료입니다.

### 실패 동작

이 모듈은 API 표면에서 의도적으로 예외를 발생시키지 않습니다:

- 누락되었거나 접근 불가능한 프로세스 트리 분기는 건너뜁니다,
- pid별 킬 실패는 실패로 카운트됩니다(오류가 아님),
- 조회 미스는 일반적으로 `listDescendants`에서 `[]`를, `killTree`에서 `0`을 반환합니다.

## 키 파싱 서브시스템 (`keys`)

### API 모델

제공되는 헬퍼:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### 파싱 모델

파서는 다음을 결합합니다:

- 직접 단일 바이트 매핑 (`enter`, `tab`, `ctrl+<문자>`, 인쇄 가능 ASCII),
- O(1) 레거시 이스케이프 시퀀스 조회 (PHF 맵),
- xterm `modifyOtherKeys` 파싱,
- Kitty 프로토콜 파싱 (`CSI u`, `CSI ~`, `CSI 1;...<문자>`),
- 키 ID로의 정규화 (`ctrl+c`, `shift+tab`, `pageUp`, `f5` 등).

수정자 처리:

- 키 매칭에서 shift/alt/ctrl 비트만 비교됩니다,
- 비교 전에 잠금 비트가 마스킹됩니다.

레이아웃 동작:

- 기본 레이아웃 폴백은 의도적으로 제한되어 리매핑된 레이아웃이 ASCII 문자/기호에 대해 잘못된 매칭을 생성하지 않습니다.

### 실패 동작

- 인식되지 않거나 유효하지 않은 시퀀스는 파싱 함수에서 `null`을 생성합니다.
- 매칭 함수는 파싱 실패 또는 불일치 시 `false`를 반환합니다.
- 잘못된 형식의 키 입력에 대해 예외가 발생하지 않습니다.

## JS 래퍼 API ↔ Rust 내보내기 매핑

### Shell + PTY + Process

| TS 래퍼 API | Rust N-API 내보내기 | 비고 |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | 일회성 셸 실행 |
| `new Shell(options?)` | `Shell` class | 영구 셸 세션 |
| `shell.run(options, onChunk?)` | `Shell::run` | 유지 제어 흐름에서 세션 재사용 |
| `shell.abort()` | `Shell::abort` | 해당 셸 인스턴스의 활성 실행 중단 |
| `new PtySession()` | `PtySession` class | 상태 유지 PTY 세션 |
| `pty.start(options, onChunk?)` | `PtySession::start` | 대화형 PTY 실행 |
| `pty.write(data)` | `PtySession::write` | 원시 stdin 패스스루 |
| `pty.resize(cols, rows)` | `PtySession::resize` | 클램프된 터미널 치수 |
| `pty.kill()` | `PtySession::kill` | 활성 PTY 자식을 강제 종료 |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | 자식 우선 프로세스 트리 종료 |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | 재귀적 하위 프로세스 목록 |

### Keys

| TS 래퍼 API | Rust N-API 내보내기 | 비고 |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Kitty 코드포인트+수정자 매칭 |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | 정규화된 키 ID 파서 |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | 정확한 레거시 시퀀스 맵 검사 |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | 구조화된 Kitty 파싱 결과 |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | 고수준 키 매처 |

## 버려진 세션 정리 및 최종화 참고 사항

- **Shell 영구 세션**: 실행이 취소/시간 초과/오류/비유지 제어 흐름인 경우, Rust는 내부 세션 상태를 명시적으로 삭제합니다. 성공적인 정상 실행은 재사용을 위해 세션을 유지합니다.
- **PTY 세션**: `core`는 실패 경로를 포함하여 `start()` 완료 후 항상 클리어됩니다.
- **명시적 JS 파이널라이저 기반 킬 계약**은 래퍼에 의해 노출되지 않습니다; 정리는 주로 실행 완료/취소 경로에 연결됩니다. 호출자는 결정적 해체를 위해 `timeoutMs`, `AbortSignal`, `shell.abort()`, 또는 `pty.kill()`을 사용해야 합니다.
