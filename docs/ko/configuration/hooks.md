---
title: Hooks
description: 코딩 에이전트 라이프사이클에서 사전/사후 이벤트 자동화를 위한 Hook 시스템.
sidebar:
  order: 4
  label: Hooks
i18n:
  sourceHash: cdbec10bc405
  translator: machine
---

# Hooks

이 문서는 `src/extensibility/hooks/*`의 **현재 hook 서브시스템 코드**를 설명합니다.

## 런타임 현재 상태

hook 패키지(`src/extensibility/hooks/`)는 여전히 내보내지고 API 표면으로 사용 가능하지만, 기본 CLI 런타임은 이제 **확장 실행기** 경로를 초기화합니다. 현재 시작 흐름에서:

- `--hook`은 `--extension`의 별칭으로 처리됩니다 (CLI 경로는 `additionalExtensionPaths`로 병합됨)
- 도구는 `HookToolWrapper`가 아닌 `ExtensionToolWrapper`로 래핑됩니다
- 컨텍스트 변환 및 라이프사이클 이벤트 발생은 `ExtensionRunner`를 통해 처리됩니다

따라서 이 파일은 레거시 동작 및 제약 사항을 포함하여 hook 서브시스템 구현 자체(타입/로더/실행기/래퍼)를 문서화합니다.

## 주요 파일

- `src/extensibility/hooks/types.ts` — hook 컨텍스트, 이벤트 타입, 결과 계약
- `src/extensibility/hooks/loader.ts` — 모듈 로딩 및 hook 탐색 브릿지
- `src/extensibility/hooks/runner.ts` — 이벤트 디스패치, 명령 조회, 오류 신호
- `src/extensibility/hooks/tool-wrapper.ts` — 사전/사후 도구 인터셉션 래퍼
- `src/extensibility/hooks/index.ts` — 내보내기/재내보내기

## Hook 모듈이란

hook 모듈은 팩토리를 기본 내보내기해야 합니다:

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

export default function hook(pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && String(event.input.command ?? "").includes("rm -rf")) {
   return { block: true, reason: "blocked by policy" };
  }
 });
}
```

팩토리는 다음을 수행할 수 있습니다:

- `pi.on(...)`으로 이벤트 핸들러 등록
- `pi.sendMessage(...)`로 영구적인 커스텀 메시지 전송
- `pi.appendEntry(...)`로 비-LLM 상태 유지
- `pi.registerCommand(...)`로 슬래시 명령 등록
- `pi.registerMessageRenderer(...)`로 커스텀 메시지 렌더러 등록
- `pi.exec(...)`로 셸 명령 실행

## 탐색 및 로딩

`discoverAndLoadHooks(configuredPaths, cwd)`는 다음을 수행합니다:

1. 기능 레지스트리에서 탐색된 hook 로드 (`loadCapability("hooks")`)
2. 명시적으로 구성된 경로 추가 (절대 경로로 중복 제거)
3. `loadHooks(allPaths, cwd)` 호출

`loadHooks`는 각 경로를 가져와 `default` 함수를 기대합니다.

### 경로 해석

`loader.ts`는 hook 경로를 다음과 같이 해석합니다:

- 절대 경로: 그대로 사용
- `~` 경로: 확장됨
- 상대 경로: `cwd` 기준으로 해석

### 중요한 레거시 불일치

`hookCapability`의 탐색 프로바이더는 여전히 사전/사후 셸 스타일 hook 파일(예: `.claude/hooks/pre/*`, `.xcsh/.../hooks/pre/*`)을 모델링합니다.

여기서 hook 로더는 동적 모듈 임포트를 사용하며 기본 JS/TS hook 팩토리를 요구합니다. 탐색된 hook 경로가 모듈로 임포트할 수 없는 경우, 로드가 실패하고 `LoadHooksResult.errors`에 보고됩니다.

## 이벤트 표면

Hook 이벤트는 `types.ts`에서 강타입으로 정의됩니다.

### 세션 이벤트

- `session_start`
- `session_before_switch` → `{ cancel?: boolean }` 반환 가능
- `session_switch`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }` 반환 가능
- `session_branch`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }` 반환 가능
- `session.compacting` → `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }` 반환 가능
- `session_compact`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }` 반환 가능
- `session_tree`
- `session_shutdown`

### 에이전트/컨텍스트 이벤트

- `context` → `{ messages?: Message[] }` 반환 가능
- `before_agent_start` → `{ message?: { customType; content; display; details } }` 반환 가능
- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `auto_compaction_start`
- `auto_compaction_end`
- `auto_retry_start`
- `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### 도구 이벤트 (사전/사후 모델)

- `tool_call` (실행 전) → `{ block?: boolean; reason?: string }` 반환 가능
- `tool_result` (실행 후) → `{ content?; details?; isError? }` 반환 가능

이것이 hook 서브시스템의 핵심 사전/사후 인터셉션 모델입니다.

```text
Hook 도구 인터셉션 흐름

tool_call 핸들러
   │
   ├─ { block: true } 반환 있음? ── 예 ──> throw (도구 차단됨)
   │
   └─ 아니오
      │
      ▼
   하위 도구 실행
      │
      ├─ 성공 ──> tool_result 핸들러가 { content, details } 재정의 가능
      │
      └─ 오류   ──> tool_result(isError=true) 발생 후 원래 오류 재throw
```

## 실행 모델 및 변경 의미론

### 1) 사전 실행: `tool_call`

`HookToolWrapper.execute()`는 도구 실행 전에 `tool_call`을 발생시킵니다.

- 어떤 핸들러가 `{ block: true }`를 반환하면 실행이 중단됩니다
- 핸들러가 throw하면 래퍼는 실패 안전 방식으로 실행을 차단합니다
- 반환된 `reason`은 throw된 오류 텍스트가 됩니다

### 2) 도구 실행

차단되지 않은 경우 하위 도구가 정상적으로 실행됩니다.

### 3) 사후 실행: `tool_result`

성공 후 래퍼는 다음과 함께 `tool_result`를 발생시킵니다:

- `toolName`, `toolCallId`, `input`
- `content`
- `details`
- `isError: false`

핸들러가 재정의를 반환하면:

- `content`가 결과 내용을 교체할 수 있습니다
- `details`가 결과 상세 정보를 교체할 수 있습니다

도구 실패 시 래퍼는 `isError: true`와 오류 텍스트 내용으로 `tool_result`를 발생시킨 후 원래 오류를 재throw합니다.

### Hook이 변경할 수 있는 것

- `context`를 통한 단일 호출에 대한 LLM 컨텍스트 (`messages` 교체 체인)
- 성공한 도구 호출의 도구 출력 내용/상세 정보 (`tool_result` 경로)
- `before_agent_start`를 통한 사전 에이전트 주입 메시지
- `session_before_*` 및 `session.compacting`을 통한 취소/커스텀 압축/트리 동작

### 이 구현에서 Hook이 변경할 수 없는 것

- 인플레이스 원시 도구 입력 매개변수 (`tool_call`에서는 차단/허용만 가능)
- throw된 도구 오류 후 실행 계속 (오류 경로는 재throw)
- 래퍼 동작에서 최종 성공/오류 상태 (반환된 `isError`는 타입이 지정되어 있으나 `HookToolWrapper`에 의해 적용되지 않음)

## 순서 및 충돌 동작

### 탐색 수준 순서

기능 프로바이더는 우선순위로 정렬됩니다 (높은 것 먼저). 중복 제거는 기능 키 기준으로, 첫 번째가 우선합니다.

`hooks`의 경우 기능 키는 `${type}:${tool}:${name}`입니다. 낮은 우선순위 프로바이더의 중복된 항목은 표시되고 유효한 탐색 목록에서 제외됩니다.

### 로드 순서

`discoverAndLoadHooks`는 해석된 절대 경로로 중복 제거된 평면 `allPaths` 목록을 구성한 다음 `loadHooks`가 해당 순서로 반복합니다.
각 탐색 디렉토리 내의 파일 순서는 `readdir` 출력에 따라 달라지며, hook 로더는 추가 정렬을 수행하지 않습니다.

### 런타임 핸들러 순서

`HookRunner` 내에서 순서는 등록 순서에 따라 결정적입니다:

1. hook 배열 순서
2. hook/이벤트별 핸들러 등록 순서

이벤트 타입별 충돌 동작:

- `tool_call`: 핸들러가 차단하지 않는 한 마지막으로 반환된 결과가 우선; 첫 번째 차단이 단락
- `tool_result`: 마지막으로 반환된 재정의가 우선 (단락 없음)
- `context`: 체이닝됨; 각 핸들러는 이전 핸들러의 메시지 출력을 받음
- `before_agent_start`: 첫 번째로 반환된 메시지가 유지됨; 이후 메시지는 무시됨
- `session_before_*`: 마지막으로 반환된 결과가 추적됨; `cancel: true`가 즉시 단락
- `session.compacting`: 마지막으로 반환된 결과가 우선

명령/렌더러 충돌:

- `getCommand(name)`은 hook 전체에서 첫 번째 일치를 반환 (먼저 로드된 것이 우선)
- `getMessageRenderer(customType)`은 첫 번째 일치를 반환
- `getRegisteredCommands()`는 모든 명령을 반환 (중복 제거 없음)

## UI 상호작용 (`HookContext.ui`)

`HookUIContext`에는 다음이 포함됩니다:

- `select`, `confirm`, `input`, `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`, `getEditorText`
- `theme` getter

`ctx.hasUI`는 대화형 UI를 사용할 수 있는지 여부를 나타냅니다.

UI 없이 실행할 때 기본 no-op 컨텍스트 동작은 다음과 같습니다:

- `select/input/editor`는 `undefined`를 반환
- `confirm`은 `false`를 반환
- `notify`, `setStatus`, `setEditorText`는 no-op
- `getEditorText`는 `""`를 반환

### 상태 표시줄 동작

`ctx.ui.setStatus(key, text)`를 통해 설정된 hook 상태 텍스트는:

- 키별로 저장됨
- 키 이름으로 정렬됨
- 정제됨 (`\r`, `\n`, `\t` → 공백; 반복되는 공백 축소)
- 표시를 위해 결합되고 너비 잘림

## 오류 전파 및 폴백

### 로드 시

- 잘못된 모듈 또는 누락된 기본 내보내기 → `LoadHooksResult.errors`에 캡처됨
- 다른 hook에 대한 로딩은 계속됨

### 이벤트 시

`HookRunner.emit(...)`은 대부분의 이벤트에 대한 핸들러 오류를 포착하고 `HookError`를 수신자(`hookPath`, `event`, `error`)에게 발생시킨 후 계속합니다.

`emitToolCall(...)`은 더 엄격합니다: 핸들러 오류가 삼켜지지 않으며 호출자에게 전파됩니다. `HookToolWrapper`에서 이는 도구 호출을 차단합니다 (실패 안전).

## 현실적인 API 예제

### 안전하지 않은 bash 명령 차단

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "bash") return;
  const cmd = String(event.input.command ?? "");
  if (!cmd.includes("rm -rf")) return;

  if (!ctx.hasUI) return { block: true, reason: "rm -rf blocked (no UI)" };
  const ok = await ctx.ui.confirm("Dangerous command", `Allow: ${cmd}`);
  if (!ok) return { block: true, reason: "user denied command" };
 });
}
```

### 실행 후 도구 출력 편집

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_result", async event => {
  if (event.toolName !== "read" || event.isError) return;

  const redacted = event.content.map(chunk => {
   if (chunk.type !== "text") return chunk;
   return { ...chunk, text: chunk.text.replaceAll(/API_KEY=\S+/g, "API_KEY=[REDACTED]") };
  });

  return { content: redacted };
 });
}
```

### LLM 호출당 모델 컨텍스트 수정

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### 명령 안전 컨텍스트 메서드로 슬래시 명령 등록

```ts
import type { HookAPI } from "@f5-sales-demo/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.registerCommand("handoff", {
  description: "Create a new session with setup message",
  handler: async (_args, ctx) => {
   await ctx.waitForIdle();
   await ctx.newSession({
    parentSession: ctx.sessionManager.getSessionFile(),
    setup: async sm => {
     sm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Continue from prior session summary." }],
      timestamp: Date.now(),
     });
    },
   });
  },
 });
}
```

## 내보내기 표면

`src/extensibility/hooks/index.ts`에서 내보냅니다:

- 로딩 API (`discoverAndLoadHooks`, `loadHooks`)
- 실행기 및 래퍼 (`HookRunner`, `HookToolWrapper`)
- 모든 hook 타입
- `execCommand` 재내보내기

패키지 루트(`src/index.ts`)는 레거시 호환성 표면으로 hook **타입**을 재내보냅니다.
