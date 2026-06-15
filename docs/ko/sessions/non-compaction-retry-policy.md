---
title: 비압축 자동 재시도 정책
description: 압축 경로 외부의 일시적 API 실패에 대한 자동 재시도 정책.
sidebar:
  order: 6
  label: 재시도 정책
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# 비압축 자동 재시도 정책

이 문서는 `AgentSession`의 표준 API 오류 재시도 경로를 설명합니다.

자동 압축을 통한 컨텍스트 오버플로 복구는 명시적으로 제외합니다. 오버플로는 압축 로직에 의해 처리되며, [`compaction.md`](./compaction.md)에 별도로 문서화되어 있습니다.

## 구현 파일

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## 압축과의 범위 경계

재시도와 압축은 동일한 `agent_end` 경로에서 확인되지만, 의도적으로 분리되어 있습니다:

1. `agent_end`가 마지막 어시스턴트 메시지를 검사합니다.
2. `#isRetryableError(...)`가 먼저 실행됩니다.
3. 재시도가 시작되면, 해당 턴에 대한 압축 확인은 건너뜁니다.
4. 컨텍스트 오버플로 오류는 재시도 분류에서 엄격하게 제외됩니다(`isContextOverflow(...)`가 재시도를 단락시킵니다).
5. 따라서 오버플로는 표준 재시도 대신 `#checkCompaction(...)`으로 넘어갑니다.

즉, 과부하/속도 제한/서버/네트워크 유형의 실패는 이 재시도 정책을 사용하고, 컨텍스트 윈도 오버플로는 압축 복구를 사용합니다.

## 재시도 분류

`#isRetryableError(...)`는 다음 조건을 모두 충족해야 합니다:

- 어시스턴트 `stopReason === "error"`
- `errorMessage`가 존재함
- 메시지가 **컨텍스트 오버플로가 아님**
- `errorMessage`가 `#isRetryableErrorMessage(...)`와 일치함

현재 재시도 가능 패턴 집합(정규식 기반):

- overloaded
- rate limit / usage limit / too many requests
- HTTP 유사 서버 클래스: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- `retry delay` 문구

이는 타입화된 프로바이더 오류 코드가 아닌 문자열 패턴 분류입니다.

## 재시도 생명 주기 및 상태 전환

재시도에 사용되는 세션 상태:

- `#retryAttempt: number` (`0`은 유휴 상태를 의미)
- `#retryPromise: Promise<void> | undefined` (진행 중인 재시도 생명 주기 추적)
- `#retryResolve: (() => void) | undefined` (`#retryPromise`를 해결)
- `#retryAbortController: AbortController | undefined` (백오프 슬립 취소)

흐름(`#handleRetryableError`):

1. `retry` 설정 그룹을 읽습니다.
2. `retry.enabled === false`이면 즉시 중단합니다(`false`, 재시도 미시작).
3. `#retryAttempt`를 증가시킵니다.
4. `#retryPromise`를 한 번 생성합니다(체인의 첫 번째 시도).
5. 시도 횟수가 `retry.maxRetries`를 초과하면 최종 실패 이벤트를 발생시키고 중단합니다.
6. 지연 시간을 계산합니다: `retry.baseDelayMs * 2^(attempt-1)`.
7. 사용량 제한 오류의 경우, 재시도 힌트를 파싱하고 인증 저장소를 호출합니다(`markUsageLimitReached(...)`). 프로바이더/모델 전환이 성공하면 지연 시간을 `0`으로 강제 설정합니다.
8. `auto_retry_start`를 발생시킵니다.
9. 에이전트 런타임 상태에서 후행 어시스턴트 오류 메시지를 제거합니다(영구 세션 기록에는 유지).
10. 중단 지원이 포함된 슬립을 실행합니다.
11. 깨어나면 `setTimeout(..., 0)`을 통해 `agent.continue()`를 예약합니다.

### 재시도 카운터 초기화 시점

`#retryAttempt`는 다음 경우에 `0`으로 초기화됩니다:

- 재시도 시작 후 첫 번째 성공적인 비오류, 비중단 어시스턴트 메시지 발생 시(`auto_retry_end { success: true }` 발생)
- 백오프 슬립 중 재시도 취소 시
- 최대 재시도 횟수 초과 경로

`#retryPromise`는 재시도 체인이 종료될 때(성공, 취소 또는 최대 초과 시) `#resolveRetry()`를 통해 해결/초기화됩니다.

## 백오프 및 최대 시도 횟수 의미론

설정:

- `retry.enabled` (기본값 `true`)
- `retry.maxRetries` (기본값 `3`)
- `retry.baseDelayMs` (기본값 `2000`)

시도 번호 매기기:

- 최대 횟수 확인 전에 카운터가 증가됩니다
- 시작 이벤트는 현재 시도 횟수(1-기반)를 사용합니다
- 최대 초과 종료 이벤트는 `attempt: this.#retryAttempt - 1`을 보고합니다(마지막 시도된 재시도 횟수)

기본 설정에서의 백오프 순서:

- 시도 1: 2000ms
- 시도 2: 4000ms
- 시도 3: 8000ms

지연 재정의 입력은 사용량 제한 처리 경로에서만 사용되며, 인증 저장소 모델/계정 전환 결정에 영향을 주기 위해서만 사용됩니다. 주요 비압축 재시도 경로에서는 전환이 성공하지 않는 한(`delayMs = 0`) 백오프가 로컬 지수 지연으로 유지됩니다.

## 중단 메커니즘

### 명시적 재시도 중단

`abortRetry()`:

- `#retryAbortController`를 중단합니다(존재하는 경우)
- 재시도 프로미스를 해결합니다(`#resolveRetry()`)하여 대기자가 차단 해제됩니다

슬립 중 중단이 발생하면, 캐치 경로에서 다음을 발생시킵니다:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- 시도 횟수/컨트롤러 초기화

### 전역 작업 중단 상호작용

`abort()`는 활성 에이전트 스트림을 중단하기 전에 `abortRetry()`를 호출합니다. 이는 사용자가 일반 중단을 실행할 때 재시도 백오프가 취소되도록 보장합니다.

### TUI 상호작용

`auto_retry_start` 발생 시, EventController가:

- `Esc` 핸들러를 `session.abortRetry()`로 교체합니다
- 로더 텍스트를 렌더링합니다: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

`auto_retry_end` 발생 시, 이전 `Esc` 핸들러를 복원하고 로더 상태를 초기화합니다.

## 스트리밍 및 프롬프트 완료 동작

`prompt()`는 궁극적으로 `agent.prompt(...)`가 반환된 후 `#waitForRetry()`를 기다립니다.

효과:

- 프롬프트 호출은 시작된 재시도 체인이 완료될 때까지(성공/실패/취소) 완전히 해결되지 않습니다
- 재시도 생명 주기는 하나의 논리적 프롬프트 실행 경계의 일부입니다

이는 호출자가 재시도 중인 턴을 너무 일찍 완료된 것으로 처리하는 것을 방지합니다.

## 제어: 설정 및 RPC

### 구성 옵션

재시도 그룹 아래 설정 스키마에 정의됨:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

세션의 프로그래밍 방식 토글:

- `setAutoRetryEnabled(enabled)`: `retry.enabled`를 씁니다
- `autoRetryEnabled`: `retry.enabled`를 읽습니다
- `isRetrying`: 재시도 생명 주기 프로미스가 활성 상태인지 보고합니다

### RPC 제어

RPC 명령 표면:

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

클라이언트 헬퍼:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

두 명령 모두 성공 응답을 반환하며, 재시도 진행/실패 세부 정보는 명령 응답 페이로드가 아닌 스트리밍된 세션 이벤트에서 전달됩니다.

## 이벤트 발생 및 실패 노출

세션 수준 재시도 이벤트:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

전파:

- `AgentSession.subscribe(...)`를 통해 발생됩니다
- 익스텐션 이벤트로서 익스텐션 러너에 전달됩니다
- RPC 모드에서는 JSON 이벤트 객체로 직접 전달됩니다(`session.subscribe(event => output(event))`)
- TUI에서는 로더/오류 UI를 위해 `EventController`가 소비합니다

최종 실패 노출:

- 최대 초과 또는 취소 시 `auto_retry_end.success === false`
- TUI 표시: `Retry failed after N attempts: <finalError>`
- 익스텐션/훅은 동일한 필드로 `auto_retry_end`를 수신합니다
- RPC 소비자는 stdout 스트림에서 동일한 이벤트 객체를 수신합니다

## 영구 중단 조건

다음 중 하나가 발생하면 재시도가 중단되고 자동으로 계속되지 않습니다:

- `retry.enabled`가 false인 경우
- 오류가 재시도로 분류되지 않은 경우
- 오류가 컨텍스트 오버플로인 경우(압축 경로에 위임)
- 최대 재시도 횟수 초과 시
- 사용자가 재시도를 취소한 경우(`abort_retry` 또는 재시도 로더 중 `Esc`)
- 전역 중단(`abort`)이 먼저 재시도를 취소한 경우

카운터가 초기화된 후 향후 재시도 가능한 오류에서 새로운 재시도 체인이 다시 시작될 수 있습니다.

## 운영상의 주의 사항

- 분류는 정규식 텍스트 매칭이며, 여기서는 프로바이더별 구조화된 오류가 사용되지 않습니다.
- 재시도는 재계속 전에 **런타임 컨텍스트**에서 실패한 어시스턴트 오류를 제거하지만, 세션 기록에는 해당 오류 항목이 유지됩니다.
- `RpcSessionState`는 현재 `autoCompactionEnabled`를 노출하지만 `autoRetryEnabled` 필드는 노출하지 않습니다. RPC 호출자는 자체적으로 토글 상태를 추적하거나 다른 API를 통해 설정을 조회해야 합니다.
