---
title: MCP 프로토콜 및 전송 내부 구조
description: 'stdio, SSE, 스트리밍 가능한 HTTP 전송 계층을 포함한 MCP 프로토콜 구현.'
sidebar:
  order: 2
  label: 프로토콜 및 전송
i18n:
  sourceHash: 48632064dd00
  translator: machine
---

# MCP 프로토콜 및 전송 내부 구조

이 문서는 coding-agent가 MCP JSON-RPC 메시징을 구현하는 방식과 프로토콜 관심사가 전송 관심사로부터 어떻게 분리되는지를 설명합니다.

## 범위

다루는 내용:

- JSON-RPC 요청/응답 및 알림 흐름
- stdio 및 HTTP/SSE 전송에 대한 요청 상관관계 및 수명 주기
- 타임아웃 및 취소 동작
- 오류 전파 및 잘못된 페이로드 처리
- 전송 선택 경계 (`stdio` vs `http`/`sse`)
- 재연결/재시도 책임이 전송 수준인지 매니저 수준인지

확장 기능 작성 UX나 명령어 UI는 다루지 않습니다.

## 구현 파일

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/transports/stdio.ts`](../../packages/coding-agent/src/mcp/transports/stdio.ts)
- [`src/mcp/transports/http.ts`](../../packages/coding-agent/src/mcp/transports/http.ts)
- [`src/mcp/transports/index.ts`](../../packages/coding-agent/src/mcp/transports/index.ts)
- [`src/mcp/json-rpc.ts`](../../packages/coding-agent/src/mcp/json-rpc.ts)
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)

## 계층 경계

### 프로토콜 계층 (JSON-RPC + MCP 메서드)

- 메시지 형태는 `types.ts`에 정의되어 있습니다 (`JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcResponse`, `JsonRpcMessage`).
- MCP 클라이언트 로직(`client.ts`)은 메서드 순서와 세션 핸드셰이크를 결정합니다:
  1. `initialize` 요청
  2. `notifications/initialized` 알림
  3. `tools/list`, `tools/call` 등의 메서드 호출

### 전송 계층 (`MCPTransport`)

`MCPTransport`는 전달 및 수명 주기를 추상화합니다:

- `request(method, params, options?) -> Promise<T>`
- `notify(method, params?) -> Promise<void>`
- `close()`
- `connected`
- 선택적 콜백: `onClose`, `onError`, `onNotification`

전송 구현은 프레이밍과 I/O 세부 사항을 담당합니다:

- `StdioTransport`: 하위 프로세스 stdio를 통한 개행 구분 JSON
- `HttpTransport`: HTTP POST를 통한 JSON-RPC, 선택적 SSE 응답/수신 포함

### 현재 중요한 주의 사항

전송 콜백(`onClose`, `onError`, `onNotification`)은 구현되어 있지만, 현재 `MCPClient`/`MCPManager` 흐름에서는 이러한 콜백에 재연결 로직을 연결하지 않습니다. 알림은 호출자가 핸들러를 등록한 경우에만 소비됩니다.

## 전송 선택

`client.ts:createTransport()`는 설정에서 전송을 선택합니다:

- `type` 생략 또는 `"stdio"` -> `createStdioTransport`
- `"http"` 또는 `"sse"` -> `createHttpTransport`

`"sse"`는 HTTP 전송 변형(동일한 클래스)으로 처리되며, 별도의 전송 구현이 아닙니다.

## JSON-RPC 메시지 흐름 및 상관관계

## 요청 ID

각 전송은 요청별 ID를 생성합니다 (`Math.random` + 타임스탬프 문자열). ID는 전송 로컬 상관관계 토큰입니다.

## Stdio 상관관계 경로

- 아웃바운드 요청은 하나의 JSON 객체 + `\n`으로 직렬화됩니다.
- `#pendingRequests: Map<id, {resolve,reject}>`가 진행 중인 요청을 저장합니다.
- 읽기 루프가 stdout에서 JSONL을 파싱하고 `#handleMessage`를 호출합니다.
- 인바운드 메시지에 일치하는 `id`가 있으면 요청이 resolve/reject됩니다.
- 인바운드 메시지에 `method`가 있고 `id`가 없으면 알림으로 처리되어 `onNotification`으로 전송됩니다.

알 수 없는 ID는 무시됩니다 (reject 없음, 오류 콜백 없음).

## HTTP 상관관계 경로

- 아웃바운드 요청은 JSON 본문과 생성된 `id`를 포함한 HTTP `POST`입니다.
- 비 SSE 응답 경로: 하나의 JSON-RPC 응답을 파싱하고 `result`를 반환/`error` 시 throw합니다.
- SSE 응답 경로 (`Content-Type: text/event-stream`): 이벤트를 스트리밍하고, 예상 요청 ID와 일치하며 `result` 또는 `error`가 있는 첫 번째 메시지를 반환합니다.
- `method`가 있고 `id`가 없는 SSE 메시지는 알림으로 처리됩니다.

일치하는 응답 전에 SSE 스트림이 종료되면 요청은 `No response received for request ID ...`로 실패합니다.

## 알림

클라이언트는 `transport.notify(...)`를 통해 JSON-RPC 알림을 발행합니다.

- Stdio: 알림 프레임을 stdin에 기록합니다 (`jsonrpc`, `method`, 선택적 `params`) + 개행.
- HTTP: `id` 없이 POST 본문을 전송합니다; 성공 시 `2xx` 또는 `202 Accepted`를 수용합니다.

서버 발행 알림은 전송 `onNotification`을 통해서만 노출됩니다; 매니저/클라이언트에는 기본 글로벌 구독자가 없습니다.

## Stdio 전송 내부 구조

## 수명 주기 및 상태 전환

- 초기 상태: `connected=false`, `process=null`, pending 맵 비어 있음
- `connect()`:
  - 설정된 명령어/인자/환경변수/cwd로 하위 프로세스 생성
  - connected로 표시
  - stdout 읽기 루프 시작 (`readJsonl`)
  - stderr 루프 시작 (읽기/버림; 현재 무음)
- `close()`:
  - disconnected로 표시
  - 모든 대기 중인 요청을 reject (`Transport closed`)
  - 하위 프로세스 종료
  - 읽기 루프 종료 대기
  - `onClose` 발행

읽기 루프가 예기치 않게 종료되면, `finally`가 `#handleClose()`를 트리거하여 동일한 대기 요청 reject 및 close 콜백을 수행합니다.

## 타임아웃 및 취소

요청별:

- 타임아웃 기본값은 `config.timeout ?? 30000`
- 호출자의 선택적 `AbortSignal`
- abort와 timeout 모두 대기 중인 promise를 reject하고 맵 항목을 정리합니다

취소는 로컬 전용입니다: 전송은 서버에 프로토콜 수준의 취소 알림을 보내지 않습니다.

## 잘못된 페이로드 처리

읽기 루프에서:

- 파싱된 각 JSONL 행은 `try/catch` 내의 `#handleMessage`에 전달됩니다
- 잘못된/유효하지 않은 메시지 처리 예외는 삭제됩니다 (`Skip malformed lines` 주석)
- 루프가 계속되므로, 하나의 잘못된 메시지가 연결을 종료하지 않습니다

기본 스트림 파서가 throw하면, `onError`가 호출되고 (아직 연결된 경우), 그 후 연결이 닫힙니다.

## 연결 해제/실패 동작

프로세스가 종료되거나 스트림이 닫힐 때:

- 모든 진행 중인 요청이 `Transport closed`로 reject됩니다
- 자동 재시작 또는 재연결 없음
- 상위 계층에서 새 전송을 생성하여 재연결해야 합니다

## 백프레셔/스트리밍 참고 사항

- 아웃바운드 쓰기는 drain 의미론을 기다리지 않고 `stdin.write()` + `flush()`를 사용합니다.
- 전송에 명시적인 큐나 high-watermark 관리가 없습니다.
- 인바운드 처리는 스트림 기반(`readJsonl`에 대한 `for await`)으로, 한 번에 하나의 파싱된 메시지를 처리합니다.

## HTTP/SSE 전송 내부 구조

## 수명 주기 및 연결 의미론

HTTP 전송은 논리적 연결 상태를 가지지만, 요청 경로는 HTTP 호출별로 무상태입니다:

- `connect()`는 `connected=true`를 설정합니다 (소켓/세션 핸드셰이크 없음)
- `Mcp-Session-Id` 헤더를 통한 선택적 서버 세션 추적
- `close()`는 선택적으로 `Mcp-Session-Id`와 함께 `DELETE`를 전송하고, SSE 리스너를 중단하며, `onClose`를 발행합니다

따라서 `connected`는 "영구 스트림이 설정됨"이 아니라 "전송 사용 가능"을 의미합니다.

## 세션 헤더 동작

- POST 응답에서 `Mcp-Session-Id` 헤더가 있으면 전송이 이를 저장합니다.
- 이후 요청/알림에 `Mcp-Session-Id`를 포함합니다.
- `close()`는 HTTP DELETE로 서버 세션 종료를 시도합니다; 종료 실패는 무시됩니다.

## 타임아웃 및 취소

`request()`와 `notify()` 모두:

- 타임아웃은 `AbortController`를 사용합니다 (`config.timeout ?? 30000`)
- 외부 시그널이 제공되면 `AbortSignal.any([...])`로 병합됩니다
- AbortError 처리는 호출자 abort와 타임아웃을 구분합니다

발생하는 오류:

- 타임아웃: `Request timeout after ...ms` (또는 `SSE response timeout ...`, `Notify timeout ...`)
- 호출자 abort: 외부 시그널이 이미 중단된 경우 원본 AbortError가 다시 throw됩니다

## HTTP 오류 전파

비 OK 응답 시:

- 응답 텍스트가 throw된 오류에 포함됩니다 (`HTTP <status>: <text>`)
- 존재하는 경우, `WWW-Authenticate` 및 `Mcp-Auth-Server`의 인증 힌트가 추가됩니다

JSON-RPC 오류 객체 시:

- `MCP error <code>: <message>`를 throw합니다

잘못된 JSON 본문 (`response.json()` 실패)은 파싱 예외로 전파됩니다.

## SSE 동작 및 모드

두 가지 SSE 경로가 존재합니다:

1. **요청별 SSE 응답** (`#parseSSEResponse`)
   - POST 응답 content type이 `text/event-stream`일 때 사용
   - 일치하는 응답 id를 찾을 때까지 스트림을 소비
   - 동일한 스트림에서 인터리브된 알림을 처리할 수 있음

2. **백그라운드 SSE 리스너** (`startSSEListener()`)
   - 서버 발행 알림을 위한 선택적 GET 리스너
   - 현재 MCP 매니저/클라이언트에 의해 자동으로 시작되지 않음
   - GET이 `405`를 반환하면 리스너가 자동으로 비활성화됨 (서버가 이 모드를 지원하지 않음)

## 잘못된 페이로드 및 연결 해제 처리

SSE JSON 파싱 오류는 `readSseJson`에서 발생하여 요청/리스너를 reject합니다.

- 요청 SSE 파싱 오류는 활성 요청을 reject합니다.
- 백그라운드 리스너 오류는 `onError`를 트리거합니다 (AbortError 제외).
- 백그라운드 리스너의 자동 재연결은 없습니다.

## `json-rpc.ts` 유틸리티 vs 전송 추상화

`src/mcp/json-rpc.ts`는 `MCPClient`/`MCPManager`에서 사용하는 `MCPTransport` 추상화가 아닌, 직접 HTTP MCP 호출(Exa 통합에서 사용)을 위한 `callMCP()` 및 `parseSSE()` 헬퍼를 제공합니다.

`HttpTransport`와의 주요 차이점:

- 먼저 전체 응답 텍스트를 파싱한 다음 첫 번째 `data:` 행을 추출합니다 (`parseSSE`), JSON 폴백 포함
- 요청 타임아웃 관리, abort API, 세션 ID 처리, 전송 수명 주기 없음
- 원시 JSON-RPC 엔벨로프 객체를 반환합니다

이 경로는 경량이지만 전체 전송 구현보다 덜 견고합니다.

## 재시도/재연결 책임

## 전송 수준

현재 전송 구현은 다음을 수행하지 **않습니다**:

- 실패한 요청 재시도
- stdio 프로세스 종료 후 재연결
- SSE 리스너 재연결
- 연결 해제 후 진행 중인 요청 재전송

빠르게 실패하고 오류를 전파합니다.

## 매니저/클라이언트 수준

`MCPManager`는 검색/초기 연결 오케스트레이션을 처리하며 연결 흐름을 다시 실행하여 재연결할 수 있습니다 (`connectToServer`/`discoverAndConnect` 경로). 런타임 실패 콜백에서 이미 연결된 전송을 자동 복구하지는 않습니다.

`MCPManager`는 느린 서버에 대한 시작 폴백 동작(캐시에서 지연된 도구)을 가지고 있지만, 이는 도구 가용성 폴백이지 전송 재시도가 아닙니다.

## 실패 시나리오 요약

- **잘못된 stdio 메시지 행**: 삭제됨; 스트림은 계속됩니다.
- **Stdio 스트림/프로세스 종료**: 전송이 닫힘; 대기 중인 요청이 `Transport closed`로 reject됩니다.
- **HTTP 비 2xx**: 요청/알림이 HTTP 오류를 throw합니다.
- **유효하지 않은 JSON 응답**: 파싱 예외가 전파됩니다.
- **일치하는 id 없이 SSE 종료**: 요청이 `No response received for request ID ...`로 실패합니다.
- **타임아웃**: 전송별 타임아웃 오류.
- **호출자 abort**: 호출자 시그널에서 AbortError/이유가 전파됩니다.

## 실용적 경계 규칙

관심사가 메시지 형태, id 상관관계, 또는 MCP 메서드 순서인 경우 프로토콜/클라이언트 로직에 속합니다.

관심사가 프레이밍(JSONL vs HTTP/SSE), 스트림 파싱, fetch/spawn 수명 주기, 타임아웃 클록, 또는 연결 해제인 경우 전송 구현에 속합니다.
