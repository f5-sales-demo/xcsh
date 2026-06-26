---
title: 확장 기능
description: '유형, 러너 수명 주기, 등록 및 검색을 포함한 확장 기능 런타임 개요'
sidebar:
  order: 1
  label: 개요
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# 확장 기능

`packages/coding-agent`에서 런타임 확장 기능을 작성하기 위한 기본 가이드입니다.

이 문서는 다음 파일의 현재 확장 기능 런타임을 다룹니다:

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

검색 경로 및 파일시스템 로딩 규칙에 대해서는 `docs/extension-loading.md`를 참조하십시오.

## 확장 기능이란

확장 기능은 기본 팩토리를 내보내는 TS/JS 모듈입니다:

```ts
import type { ExtensionAPI } from "@f5-sales-demo/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

확장 기능은 하나의 모듈에서 다음 모든 기능을 조합할 수 있습니다:

- 이벤트 핸들러 (`pi.on(...)`)
- LLM 호출 가능 도구 (`pi.registerTool(...)`)
- 슬래시 명령어 (`pi.registerCommand(...)`)
- 키보드 단축키 및 플래그
- 커스텀 메시지 렌더링
- 세션/메시지 주입 API (`sendMessage`, `sendUserMessage`, `appendEntry`)

## 런타임 모델

1. 확장 기능이 임포트되고 팩토리 함수가 실행됩니다.
2. 로드 단계에서 등록 메서드는 유효하지만, 런타임 액션 메서드는 아직 초기화되지 않습니다.
3. `ExtensionRunner.initialize(...)`가 활성 모드에 대한 라이브 액션/컨텍스트를 연결합니다.
4. 세션/에이전트/도구 수명 주기 이벤트가 핸들러에 전달됩니다.
5. 모든 도구 실행은 확장 기능 인터셉션으로 래핑됩니다 (`tool_call` / `tool_result`).

```text
Extension lifecycle (simplified)

load paths
   │
   ▼
import module + run factory (registration only)
   │
   ▼
ExtensionRunner.initialize(mode/session/tool registry)
   │
   ├─ emit session/agent events to handlers
   ├─ wrap tool execution (tool_call/tool_result)
   └─ expose runtime actions (sendMessage, setActiveTools, ...)
```

`loader.ts`의 중요한 제약 사항:

- 확장 기능 로드 중 `pi.sendMessage()`와 같은 액션 메서드를 호출하면 `ExtensionRuntimeNotInitializedError`가 발생합니다.
- 먼저 등록한 후, 이벤트/명령어/도구에서 런타임 동작을 수행하십시오.

## 빠른 시작

```ts
import type { ExtensionAPI } from "@f5-sales-demo/xcsh";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
 pi.setLabel("Safety + Utilities");

 pi.on("session_start", async (_event, ctx) => {
  ctx.ui.notify(`Extension loaded in ${ctx.cwd}`, "info");
 });

 pi.on("tool_call", async (event) => {
  if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
   return { block: true, reason: "Blocked by extension policy" };
  }
 });

 pi.registerTool({
  name: "hello_extension",
  label: "Hello Extension",
  description: "Return a greeting",
  parameters: Type.Object({ name: Type.String() }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
   return {
    content: [{ type: "text", text: `Hello, ${params.name}` }],
    details: { greeted: params.name },
   };
  },
 });

 pi.registerCommand("hello-ext", {
  description: "Show queue state",
  handler: async (_args, ctx) => {
   ctx.ui.notify(`pending=${ctx.hasPendingMessages()}`, "info");
  },
 });
}
```

## 확장 기능 API 영역

## 1) 등록 및 액션 (`ExtensionAPI`)

핵심 메서드:

- `on(event, handler)`
- `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`
- `registerMessageRenderer`
- `sendMessage`, `sendUserMessage`, `appendEntry`
- `getActiveTools`, `getAllTools`, `setActiveTools`
- `getSessionName`, `setSessionName`
- `setModel`, `getThinkingLevel`, `setThinkingLevel`
- `registerProvider`
- `events` (공유 이벤트 버스)

인터랙티브 모드에서, `input` 핸들러는 내장된 첫 번째 메시지 자동 제목 검사 이전에 실행됩니다. `input`에서 `await pi.setSessionName(...)`을 호출하는 확장 기능은 지속되는 세션 이름을 설정할 수 있으며, 해당 세션에 대한 기본 자동 생성 제목 실행을 방지할 수 있습니다.

또한 노출되는 항목:

- `pi.logger`
- `pi.typebox`
- `pi.pi` (패키지 내보내기)

### 메시지 전달 시맨틱

`pi.sendMessage(message, options)`는 다음을 지원합니다:

- `deliverAs: "steer"` (기본값) — 현재 실행을 중단합니다.
- `deliverAs: "followUp"` — 현재 실행 이후 실행되도록 큐에 추가됩니다.
- `deliverAs: "nextTurn"` — 저장되었다가 다음 사용자 프롬프트에 주입됩니다.
- `triggerTurn: true` — 유휴 상태일 때 턴을 시작합니다 (`nextTurn`은 이를 무시합니다).

`pi.sendUserMessage(content, { deliverAs })`는 항상 프롬프트 흐름을 통해 전달되며, 스트리밍 중에는 steer/follow-up으로 큐에 추가됩니다.

## 2) 핸들러 컨텍스트 (`ExtensionContext`)

핸들러와 도구 `execute`는 다음을 포함하는 `ctx`를 수신합니다:

- `ui`
- `hasUI`
- `cwd`
- `sessionManager` (읽기 전용)
- `modelRegistry`, `model`
- `getContextUsage()`
- `compact(...)`
- `isIdle()`, `hasPendingMessages()`, `abort()`
- `shutdown()`
- `getSystemPrompt()`

## 3) 명령어 컨텍스트 (`ExtensionCommandContext`)

명령어 핸들러는 추가로 다음을 제공받습니다:

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

세션 제어 흐름에는 명령어 컨텍스트를 사용하십시오. 이러한 메서드는 의도적으로 일반 이벤트 핸들러와 분리되어 있습니다.

## 이벤트 영역 (현재 이름 및 동작)

표준 이벤트 유니온 및 페이로드 유형은 `types.ts`에 있습니다.

### 세션 수명 주기

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

취소 가능한 사전 이벤트:

- `session_before_switch` → `{ cancel?: boolean }`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`

### 프롬프트 및 턴 수명 주기

- `input`
- `before_agent_start`
- `context`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`

### 도구 수명 주기

- `tool_call` (실행 전, 차단 가능)
- `tool_result` (실행 후, 콘텐츠/세부 정보/isError 패치 가능)
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` (관측 가능성)

`tool_result`는 미들웨어 방식입니다: 핸들러는 확장 기능 순서대로 실행되며 각각 이전 수정 사항을 확인합니다.

### 신뢰성/런타임 신호

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### 사용자 명령어 인터셉션

- `user_bash` (`{ result }`로 재정의)
- `user_python` (`{ result }`로 재정의)

### `resources_discover`

`resources_discover`는 확장 기능 유형과 `ExtensionRunner`에 존재합니다.
현재 런타임 참고 사항: `ExtensionRunner.emitResourcesDiscover(...)`는 구현되어 있지만, 현재 코드베이스에서 이를 호출하는 `AgentSession` 호출 지점이 없습니다.

## 도구 작성 세부 사항

`registerTool`은 `types.ts`의 `ToolDefinition`을 사용합니다.

현재 `execute` 서명:

```ts
execute(
 toolCallId,
 params,
 signal,
 onUpdate,
 ctx,
): Promise<AgentToolResult>
```

템플릿:

```ts
pi.registerTool({
 name: "my_tool",
 label: "My Tool",
 description: "...",
 parameters: Type.Object({}),
 async execute(_id, _params, signal, onUpdate, ctx) {
  if (signal?.aborted) {
   return { content: [{ type: "text", text: "Cancelled" }] };
  }
  onUpdate?.({ content: [{ type: "text", text: "Working..." }] });
  return { content: [{ type: "text", text: "Done" }], details: {} };
 },
 onSession(event, ctx) {
  // reason: start|switch|branch|tree|shutdown
 },
 renderCall(args, theme) {
  // optional TUI render
 },
 renderResult(result, options, theme, args) {
  // optional TUI render
 },
});
```

`tool_call`/`tool_result`는 `sdk.ts`에서 레지스트리가 래핑된 후 내장 도구 및 확장 기능/커스텀 도구를 포함한 모든 도구를 인터셉트합니다.

## UI 통합 지점

`ctx.ui`는 `ExtensionUIContext` 인터페이스를 구현합니다. 모드에 따라 지원 범위가 다릅니다.

### 인터랙티브 모드 (`extension-ui-controller.ts`)

지원 항목:

- 다이얼로그: `select`, `confirm`, `input`, `editor`
- 알림/상태/에디터 텍스트/터미널 입력/커스텀 오버레이
- 이름으로 테마 목록 조회/로드 (`setTheme`은 문자열 이름을 지원합니다)
- 도구 확장 토글

이 컨트롤러의 현재 no-op 메서드:

- `setFooter`
- `setHeader`
- `setEditorComponent`

참고: `setWidget`은 현재 `setHookWidget(...)`을 통해 상태 표시줄 텍스트로 라우팅됩니다.

### RPC 모드 (`rpc-mode.ts`)

`ctx.ui`는 RPC `extension_ui_request` 이벤트로 지원됩니다:

- 다이얼로그 메서드 (`select`, `confirm`, `input`, `editor`)는 클라이언트 응답으로 왕복합니다.
- fire-and-forget 메서드는 요청을 내보냅니다 (`notify`, `setStatus`, 문자열 배열을 위한 `setWidget`, `setTitle`, `setEditorText`)

RPC 구현에서 미지원/no-op:

- `onTerminalInput`
- `custom`
- `setFooter`, `setHeader`, `setEditorComponent`
- `setWorkingMessage`
- 테마 전환/로드 (`setTheme`은 실패를 반환합니다)
- 도구 확장 컨트롤은 비활성 상태입니다.

### 프린트/헤드리스/서브에이전트 경로

러너 초기화에 UI 컨텍스트가 제공되지 않으면 `ctx.hasUI`는 `false`이며 메서드는 no-op/기본값 반환입니다.

### 백그라운드 인터랙티브 모드

백그라운드 모드는 비인터랙티브 UI 컨텍스트 객체를 설치합니다. 현재 구현에서 `ctx.hasUI`는 여전히 `true`일 수 있지만, 인터랙티브 다이얼로그는 기본값/no-op 동작을 반환합니다.

## 세션 및 상태 패턴

지속적인 확장 기능 상태를 위해:

1. `pi.appendEntry(customType, data)`로 지속합니다.
2. `session_start`, `session_branch`, `session_tree`에서 `ctx.sessionManager.getBranch()`를 통해 상태를 재구성합니다.
3. 도구 결과 히스토리에서 상태를 볼 수 있거나 재구성할 수 있어야 하는 경우, 도구 결과 `details`를 구조화된 형태로 유지합니다.

재구성 패턴 예시:

```ts
pi.on("session_start", async (_event, ctx) => {
 let latest;
 for (const entry of ctx.sessionManager.getBranch()) {
  if (entry.type === "custom" && entry.customType === "my-state") {
   latest = entry.data;
  }
 }
 // restore from latest
});
```

## 렌더링 확장 지점

## 커스텀 메시지 렌더러

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // return pi-tui Component
});
```

커스텀 메시지가 표시될 때 인터랙티브 렌더링에서 사용됩니다.

## 도구 호출/결과 렌더러

TUI에서 커스텀 도구 시각화를 위해 `registerTool` 정의에 `renderCall` / `renderResult`를 제공하십시오.

## 제약 사항 및 주의 사항

- 런타임 액션은 확장 기능 로드 중에 사용할 수 없습니다.
- `tool_call` 오류는 실행을 차단합니다 (fail-closed).
- 내장 기능과 명령어 이름이 충돌하면 진단과 함께 건너뜁니다.
- 예약된 단축키는 무시됩니다 (`ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`).
- `ctx.reload()`는 현재 명령어 핸들러 프레임에서 종료로 처리하십시오.

## 확장 기능 vs 훅 vs 커스텀 도구

적절한 영역을 사용하십시오:

- **확장 기능** (`src/extensibility/extensions/*`): 통합 시스템 (이벤트 + 도구 + 명령어 + 렌더러 + 프로바이더 등록).
- **훅** (`src/extensibility/hooks/*`): 별도의 레거시 이벤트 API.
- **커스텀 도구** (`src/extensibility/custom-tools/*`): 도구 중심 모듈. 확장 기능과 함께 로드될 때 적응되며 여전히 확장 기능 인터셉션 래퍼를 통과합니다.

정책, 도구, 명령어 UX, 렌더링을 하나의 패키지로 소유해야 한다면 확장 기능을 사용하십시오.
