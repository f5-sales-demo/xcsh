---
title: RPC 프로토콜 레퍼런스
description: xcsh 컴포넌트 간 프로세스 간 통신을 위한 JSON-RPC 프로토콜 레퍼런스.
sidebar:
  order: 5
  label: RPC 프로토콜
i18n:
  sourceHash: b4a3ddaf08ab
  translator: machine
---

# RPC 프로토콜 레퍼런스

RPC 모드는 코딩 에이전트를 stdio를 통한 개행 구분 JSON 프로토콜로 실행합니다.

- **stdin**: 명령(`RpcCommand`) 및 확장 UI 응답
- **stdout**: 명령 응답(`RpcResponse`), 세션/에이전트 이벤트, 확장 UI 요청

주요 구현:

- `src/modes/rpc/rpc-mode.ts`
- `src/modes/rpc/rpc-types.ts`
- `src/session/agent-session.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`

## 시작

```bash
xcsh --mode rpc [regular CLI options]
```

동작 참고사항:

- `@file` CLI 인수는 RPC 모드에서 거부됩니다.
- RPC 모드는 추가 모델 호출을 피하기 위해 기본적으로 자동 세션 제목 생성을 비활성화합니다.
- RPC 모드는 워크플로를 변경하는 `todo.*`, `task.*`, `async.*` 설정을 사용자 오버라이드를 상속하는 대신 내장 기본값으로 리셋합니다.
- 프로세스는 stdin을 JSONL로 읽습니다 (`readJsonl(Bun.stdin.stream())`).
- stdin이 닫히면 프로세스는 종료 코드 `0`으로 종료됩니다.
- 응답/이벤트는 한 줄에 하나의 JSON 객체로 기록됩니다.

## 전송 및 프레이밍

각 프레임은 단일 JSON 객체 뒤에 `\n`이 붙는 형태입니다.

객체 형태 자체 외에 별도의 봉투(envelope)는 없습니다.

### 아웃바운드 프레임 카테고리 (stdout)

1. `RpcResponse` (`{ type: "response", ... }`)
2. `AgentSessionEvent` 객체 (`agent_start`, `message_update` 등)
3. `RpcExtensionUIRequest` (`{ type: "extension_ui_request", ... }`)
4. 확장 오류 (`{ type: "extension_error", extensionPath, event, error }`)

### 인바운드 프레임 카테고리 (stdin)

1. `RpcCommand`
2. `RpcExtensionUIResponse` (`{ type: "extension_ui_response", ... }`)

## 요청/응답 상관관계

모든 명령은 선택적으로 `id?: string`을 받습니다.

- 제공된 경우, 정상 명령 응답은 동일한 `id`를 반환합니다.
- `RpcClient`는 이를 대기 중인 요청 해결에 활용합니다.

런타임의 중요한 엣지 동작:

- 알 수 없는 명령 응답은 `id: undefined`로 방출됩니다 (요청에 `id`가 있었더라도).
- 입력 루프에서의 파싱/핸들러 예외는 `command: "parse"`와 `id: undefined`로 방출됩니다.
- `prompt`와 `abort_and_prompt`는 즉시 성공을 반환하며, 비동기 프롬프트 스케줄링이 실패할 경우 나중에 **동일한** id로 오류 응답을 방출할 수 있습니다.

## 명령 스키마 (정규)

`RpcCommand`는 `src/modes/rpc/rpc-types.ts`에 정의되어 있습니다:

### 프롬프팅

- `{ id?, type: "prompt", message: string, images?: ImageContent[], streamingBehavior?: "steer" | "followUp" }`
- `{ id?, type: "steer", message: string, images?: ImageContent[] }`
- `{ id?, type: "follow_up", message: string, images?: ImageContent[] }`
- `{ id?, type: "abort" }`
- `{ id?, type: "abort_and_prompt", message: string, images?: ImageContent[] }`
- `{ id?, type: "new_session", parentSession?: string }`

### 상태

- `{ id?, type: "get_state" }`
- `{ id?, type: "set_todos", phases: TodoPhase[] }`
- `{ id?, type: "set_host_tools", tools: RpcHostToolDefinition[] }`

### 모델

- `{ id?, type: "set_model", provider: string, modelId: string }`
- `{ id?, type: "cycle_model" }`
- `{ id?, type: "get_available_models" }`

### 사고

- `{ id?, type: "set_thinking_level", level: ThinkingLevel }`
- `{ id?, type: "cycle_thinking_level" }`

### 큐 모드

- `{ id?, type: "set_steering_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_follow_up_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_interrupt_mode", mode: "immediate" | "wait" }`

### 압축

- `{ id?, type: "compact", customInstructions?: string }`
- `{ id?, type: "set_auto_compaction", enabled: boolean }`

### 재시도

- `{ id?, type: "set_auto_retry", enabled: boolean }`
- `{ id?, type: "abort_retry" }`

### Bash

- `{ id?, type: "bash", command: string }`
- `{ id?, type: "abort_bash" }`

### 세션

- `{ id?, type: "get_session_stats" }`
- `{ id?, type: "export_html", outputPath?: string }`
- `{ id?, type: "switch_session", sessionPath: string }`
- `{ id?, type: "branch", entryId: string }`
- `{ id?, type: "get_branch_messages" }`
- `{ id?, type: "get_last_assistant_text" }`
- `{ id?, type: "set_session_name", name: string }`

### 메시지

- `{ id?, type: "get_messages" }`

## 응답 스키마

모든 명령 결과는 `RpcResponse`를 사용합니다:

- 성공: `{ id?, type: "response", command: <command>, success: true, data?: ... }`
- 실패: `{ id?, type: "response", command: string, success: false, error: string }`

데이터 페이로드는 명령별로 다르며 `rpc-types.ts`에 정의되어 있습니다.

### `get_state` 페이로드

```json
{
  "model": { "provider": "...", "id": "..." },
  "thinkingLevel": "off|minimal|low|medium|high|xhigh",
  "isStreaming": false,
  "isCompacting": false,
  "steeringMode": "all|one-at-a-time",
  "followUpMode": "all|one-at-a-time",
  "interruptMode": "immediate|wait",
  "sessionFile": "...",
  "sessionId": "...",
  "sessionName": "...",
  "autoCompactionEnabled": true,
  "messageCount": 0,
  "queuedMessageCount": 0,
  "todoPhases": [
    {
      "id": "phase-1",
      "name": "Todos",
      "tasks": [
        {
          "id": "task-1",
          "content": "Map the tool surface",
          "status": "in_progress"
        }
      ]
    }
  ]
}
```

### `set_todos` 페이로드

현재 세션의 메모리 내 할 일 상태를 교체하고 정규화된 단계 목록을 반환합니다:

```json
{
  "id": "req_2",
  "type": "set_todos",
  "phases": [
    {
      "id": "phase-1",
      "name": "Evaluation",
      "tasks": [
        {
          "id": "task-1",
          "content": "Map the read tool surface",
          "status": "in_progress"
        },
        {
          "id": "task-2",
          "content": "Exercise edit operations",
          "status": "pending"
        }
      ]
    }
  ]
}
```

이는 첫 번째 프롬프트 전에 계획을 미리 설정하려는 호스트에 유용합니다.

### `set_host_tools` 페이로드

RPC 서버가 stdio를 통해 콜백할 수 있는 호스트 소유 도구의 현재 세트를 교체합니다:

```json
{
  "id": "req_3",
  "type": "set_host_tools",
  "tools": [
    {
      "name": "echo_host",
      "label": "Echo Host",
      "description": "Echo a value from the embedding host",
      "parameters": {
        "type": "object",
        "properties": {
          "message": { "type": "string" }
        },
        "required": ["message"],
        "additionalProperties": false
      }
    }
  ]
}
```

응답 페이로드는 다음과 같습니다:

```json
{
  "toolNames": ["echo_host"]
}
```

이 도구들은 다음 모델 호출 전에 활성 세션 도구 레지스트리에 추가됩니다. `set_host_tools`를 다시 보내면 이전 호스트 소유 세트가 교체됩니다.

## 이벤트 스트림 스키마

RPC 모드는 `AgentSession.subscribe(...)`로부터 `AgentSessionEvent` 객체를 전달합니다.

일반적인 이벤트 유형:

- `agent_start`, `agent_end`
- `turn_start`, `turn_end`
- `message_start`, `message_update`, `message_end`
- `tool_execution_start`, `tool_execution_update`, `tool_execution_end`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`
- `todo_auto_clear`

확장 러너 오류는 별도로 다음과 같이 방출됩니다:

```json
{ "type": "extension_error", "extensionPath": "...", "event": "...", "error": "..." }
```

`message_update`는 `assistantMessageEvent`에 스트리밍 델타(텍스트/사고/도구 호출 델타)를 포함합니다.

## 프롬프트/큐 동시성 및 순서

이것은 가장 중요한 운영 동작입니다.

### 즉시 확인 vs 완료

`prompt`와 `abort_and_prompt`는 **즉시 확인**됩니다:

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
```

이는 다음을 의미합니다:

- 명령 수락 != 실행 완료
- 최종 완료는 `agent_end`를 통해 관찰됩니다

### 스트리밍 중

`AgentSession.prompt()`는 활성 스트리밍 중에 `streamingBehavior`를 요구합니다:

- `"steer"` => 큐에 추가된 조향 메시지 (인터럽트 경로)
- `"followUp"` => 큐에 추가된 후속 메시지 (턴 후 경로)

스트리밍 중 생략하면 프롬프트가 실패합니다.

### 큐 기본값

코딩 에이전트 설정 스키마(`packages/coding-agent/src/config/settings-schema.ts`)에서:

- `steeringMode`: `"one-at-a-time"`
- `followUpMode`: `"one-at-a-time"`
- `interruptMode`: `"wait"`

### 모드 의미

- `set_steering_mode` / `set_follow_up_mode`
  - `"one-at-a-time"`: 턴당 큐에서 하나의 메시지를 디큐
  - `"all"`: 전체 큐를 한 번에 디큐
- `set_interrupt_mode`
  - `"immediate"`: 도구 실행이 도구 호출 사이에 조향을 확인하며, 대기 중인 조향이 턴 내 나머지 도구 호출을 중단할 수 있음
  - `"wait"`: 턴 완료까지 조향을 지연

## 확장 UI 서브 프로토콜

RPC 모드의 확장은 요청/응답 UI 프레임을 사용합니다.

### 아웃바운드 요청

`RpcExtensionUIRequest` (`type: "extension_ui_request"`) 메서드:

- `select`, `confirm`, `input`, `editor`
- `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`

런타임 참고사항:

- RPC 모드에서는 자동 세션 제목 생성이 비활성화되며, `setTitle` UI 요청도
  대부분의 호스트가 의미 있는 터미널 제목 표면을 갖고 있지 않기 때문에 기본적으로
  억제됩니다. UI 이벤트만 다시 활성화하려면 `PI_RPC_EMIT_TITLE=1`을 설정하세요.

예시:

```json
{ "type": "extension_ui_request", "id": "123", "method": "confirm", "title": "Confirm", "message": "Continue?", "timeout": 30000 }
```

### 인바운드 응답

`RpcExtensionUIResponse` (`type: "extension_ui_response"`):

- `{ type: "extension_ui_response", id: string, value: string }`
- `{ type: "extension_ui_response", id: string, confirmed: boolean }`
- `{ type: "extension_ui_response", id: string, cancelled: true }`

대화 상자에 타임아웃이 있는 경우, RPC 모드는 타임아웃/중단이 발생하면 기본값으로 해결합니다.

## 호스트 도구 서브 프로토콜

RPC 호스트는 `set_host_tools`를 전송한 후 동일한 전송 경로를 통해 실행 요청을 처리하여
에이전트에 커스텀 도구를 노출할 수 있습니다.

### 아웃바운드 요청

에이전트가 호스트에 해당 도구 중 하나를 실행하도록 요청하면, RPC 모드는 다음을 방출합니다:

```json
{
  "type": "host_tool_call",
  "id": "host_1",
  "toolCallId": "toolu_123",
  "toolName": "echo_host",
  "arguments": { "message": "hello" }
}
```

도구 실행이 나중에 중단되면, RPC 모드는 다음을 방출합니다:

```json
{
  "type": "host_tool_cancel",
  "id": "host_cancel_1",
  "targetId": "host_1"
}
```

### 인바운드 업데이트 및 완료

호스트는 선택적으로 진행 상황을 스트리밍할 수 있습니다:

```json
{
  "type": "host_tool_update",
  "id": "host_1",
  "partialResult": {
    "content": [{ "type": "text", "text": "working" }]
  }
}
```

완료는 다음을 사용합니다:

```json
{
  "type": "host_tool_result",
  "id": "host_1",
  "result": {
    "content": [{ "type": "text", "text": "done" }]
  }
}
```

반환된 콘텐츠를 도구 오류로 표시하려면 `host_tool_result`에 `isError: true`를 설정하세요.

## 오류 모델 및 복구 가능성

### 명령 수준 실패

실패는 문자열 `error`와 함께 `success: false`입니다.

```json
{ "id": "req_2", "type": "response", "command": "set_model", "success": false, "error": "Model not found: provider/model" }
```

### 복구 가능성 기대사항

- 대부분의 명령 실패는 복구 가능하며, 프로세스는 계속 실행됩니다.
- 잘못된 JSONL / 파싱 루프 예외는 `parse` 오류 응답을 방출하고 후속 라인을 계속 읽습니다.
- 빈 `set_session_name`은 거부됩니다 (`Session name cannot be empty`).
- 알 수 없는 `id`를 가진 확장 UI 응답은 무시됩니다.
- 프로세스 종료 조건은 stdin 닫힘 또는 확장에 의해 트리거된 명시적 종료입니다.

## 간결한 명령 흐름

### 1) 프롬프트 및 스트리밍

stdin:

```json
{ "id": "req_1", "type": "prompt", "message": "Summarize this repo" }
```

stdout 시퀀스 (일반적):

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
{ "type": "agent_start" }
{ "type": "message_update", "assistantMessageEvent": { "type": "text_delta", "delta": "..." }, "message": { "role": "assistant", "content": [] } }
{ "type": "agent_end", "messages": [] }
```

### 2) 명시적 큐 정책으로 스트리밍 중 프롬프트

stdin:

```json
{ "id": "req_2", "type": "prompt", "message": "Also include risks", "streamingBehavior": "followUp" }
```

### 3) 큐 동작 검사 및 조정

stdin:

```json
{ "id": "q1", "type": "get_state" }
{ "id": "q2", "type": "set_steering_mode", "mode": "all" }
{ "id": "q3", "type": "set_interrupt_mode", "mode": "wait" }
```

### 4) 확장 UI 왕복

stdout:

```json
{ "type": "extension_ui_request", "id": "ui_7", "method": "input", "title": "Branch name", "placeholder": "feature/..." }
```

stdin:

```json
{ "type": "extension_ui_response", "id": "ui_7", "value": "feature/rpc-host" }
```

## `RpcClient` 헬퍼에 대한 참고사항

`src/modes/rpc/rpc-client.ts`는 편의 래퍼이며, 프로토콜 정의가 아닙니다.

현재 헬퍼 특성:

- `bun <cliPath> --mode rpc`를 스폰합니다
- 생성된 `req_<n>` id로 응답을 상관시킵니다
- 인식된 `AgentEvent` 유형만 리스너에 디스패치합니다
- `setCustomTools()`를 통한 호스트 소유 커스텀 도구와 `host_tool_call` / `host_tool_cancel`의 자동 처리를 지원합니다
- 모든 프로토콜 명령에 대한 헬퍼 메서드를 노출하지 **않습니다** (예를 들어, `set_interrupt_mode`와 `set_session_name`은 프로토콜 타입에 있지만 전용 메서드로 래핑되어 있지 않습니다)

완전한 표면 커버리지가 필요하면 원시 프로토콜 프레임을 사용하세요.
