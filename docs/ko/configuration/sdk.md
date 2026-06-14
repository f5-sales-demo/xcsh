---
title: SDK
description: xcsh 코딩 에이전트 런타임 위에서 사용자 정의 에이전트 및 통합을 구축하기 위한 SDK입니다.
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

SDK는 `@f5xc-salesdemos/xcsh`의 인프로세스 통합 인터페이스입니다.
자체 Bun/Node 프로세스에서 에이전트 상태, 이벤트 스트리밍, 도구 연결, 세션 제어에 직접 접근하고자 할 때 사용합니다.

언어 간/프로세스 격리가 필요한 경우에는 RPC 모드를 대신 사용하십시오.

## 설치

```bash
bun add @f5xc-salesdemos/xcsh
```

## 진입점

`@f5xc-salesdemos/xcsh`는 패키지 루트(및 `@f5xc-salesdemos/xcsh/sdk`를 통해서도)에서 SDK API를 내보냅니다.

임베더를 위한 핵심 내보내기:

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- 디스커버리 헬퍼 (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- 도구 팩토리 인터페이스 (`createTools`, `BUILTIN_TOOLS`, 도구 클래스)

## 빠른 시작 (자동 디스커버리 기본값)

```ts
import { createAgentSession } from "@f5xc-salesdemos/xcsh";

const { session, modelFallbackMessage } = await createAgentSession();

if (modelFallbackMessage) {
 process.stderr.write(`${modelFallbackMessage}\n`);
}

const unsubscribe = session.subscribe(event => {
 if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
  process.stdout.write(event.assistantMessageEvent.delta);
 }
});

await session.prompt("Summarize this repository in 3 bullets.");
unsubscribe();
await session.dispose();
```

## `createAgentSession()`이 기본적으로 디스커버하는 항목

`createAgentSession()`은 "제공하면 재정의, 생략하면 디스커버"의 원칙을 따릅니다.

생략하면 다음을 해석합니다:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent` (`getAgentDir()` 경유)
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)` (파일 기반)
- 스킬/컨텍스트 파일/프롬프트 템플릿/슬래시 커맨드/확장/사용자 정의 TS 커맨드
- `createTools(...)`를 통한 내장 도구
- MCP 도구 (기본적으로 활성화)
- LSP 통합 (기본적으로 활성화)

### 필수 vs 선택적 입력값

일반적으로 제어하고자 하는 항목만 제공하면 됩니다:

- **반드시 제공**: 최소 세션의 경우 없음
- **임베더에서 명시적으로 제공하는 경우가 많음**:
    - `sessionManager` (인메모리 또는 사용자 정의 위치가 필요한 경우)
    - `authStorage` + `modelRegistry` (크리덴셜/모델 생명주기를 직접 관리하는 경우)
    - `model` 또는 `modelPattern` (결정론적 모델 선택이 중요한 경우)
    - `settings` (격리된/테스트 구성이 필요한 경우)

## 세션 매니저 동작 (영구적 vs 인메모리)

`AgentSession`은 항상 `SessionManager`를 사용하며, 동작은 사용하는 팩토리에 따라 달라집니다.

### 파일 기반 (기본값)

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absolute .jsonl path
```

- 대화/메시지/상태 델타를 세션 파일에 영구 저장합니다.
- 재개/열기/목록/포크 워크플로우를 지원합니다.
- `session.sessionFile`이 정의되어 있습니다.

### 인메모리

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- 파일 시스템 영구 저장 없음.
- 테스트, 임시 워커, 요청 범위 에이전트에 유용합니다.
- 세션 메서드는 여전히 작동하지만, 영구 저장 관련 동작(파일 재개/포크 경로)은 자연스럽게 제한됩니다.

### 재개/열기/목록 헬퍼

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## 모델 및 인증 연결

`createAgentSession()`은 모델 선택 및 API 키 해석을 위해 `ModelRegistry` + `AuthStorage`를 사용합니다.

### 명시적 연결

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
} from "@f5xc-salesdemos/xcsh";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const available = modelRegistry.getAvailable();
if (available.length === 0) throw new Error("No authenticated models available");

const { session } = await createAgentSession({
 authStorage,
 modelRegistry,
 model: available[0],
 thinkingLevel: "medium",
 sessionManager: SessionManager.inMemory(),
});
```

### `model`을 생략했을 때의 선택 순서

명시적 `model`/`modelPattern`이 제공되지 않은 경우:

1. 기존 세션에서 모델 복원 (복원 가능 + 키 사용 가능한 경우)
2. 설정 기본 모델 역할 (`default`)
3. 유효한 인증이 있는 첫 번째 사용 가능한 모델

복원에 실패하면 `modelFallbackMessage`가 폴백을 설명합니다.

### 인증 우선순위

`AuthStorage.getApiKey(...)`는 다음 순서로 해석합니다:

1. 런타임 재정의 (`setRuntimeApiKey`)
2. `agent.db`에 저장된 크리덴셜
3. 공급자 환경 변수
4. 사용자 정의 공급자 리졸버 폴백 (구성된 경우)

## 이벤트 구독 모델

`session.subscribe(listener)`로 구독하며, 구독 해제 함수를 반환합니다.

```ts
const unsubscribe = session.subscribe(event => {
 switch (event.type) {
  case "agent_start":
  case "turn_start":
  case "tool_execution_start":
   break;
  case "message_update":
   if (event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
   }
   break;
 }
});
```

`AgentSessionEvent`에는 핵심 `AgentEvent`와 세션 수준 이벤트가 포함됩니다:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## 프롬프트 생명주기

`session.prompt(text, options?)`가 주요 진입점입니다.

동작:

1. 선택적 커맨드/템플릿 확장 (`/` 커맨드, 사용자 정의 커맨드, 파일 슬래시 커맨드, 프롬프트 템플릿)
2. 현재 스트리밍 중인 경우:
    - `streamingBehavior: "steer" | "followUp"` 필요
    - 작업을 버리는 대신 큐에 추가
3. 유휴 상태인 경우:
    - 모델 + API 키 유효성 검사
    - 사용자 메시지 추가
    - 에이전트 턴 시작

관련 API:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## 도구 및 확장 통합

### 내장 도구 및 필터링

- 내장 도구는 `createTools(...)`와 `BUILTIN_TOOLS`에서 제공됩니다.
- `toolNames`는 내장 도구의 허용 목록으로 작동합니다.
- `customTools` 및 확장에서 등록된 도구는 계속 포함됩니다.
- 숨겨진 도구(예: `submit_result`)는 옵션에서 요구하지 않는 한 선택적으로 포함됩니다.

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### 확장

- `extensions`: 인라인 `ExtensionFactory[]`
- `additionalExtensionPaths`: 추가 확장 파일 로드
- `disableExtensionDiscovery`: 자동 확장 스캔 비활성화
- `preloadedExtensions`: 이미 로드된 확장 세트 재사용

### 런타임 도구 세트 변경

`AgentSession`은 런타임 활성화 업데이트를 지원합니다:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

활성 도구 변경 사항을 반영하여 시스템 프롬프트가 재구성됩니다.

## 디스커버리 헬퍼

내부 디스커버리 로직을 재구현하지 않고 부분적으로 제어하고 싶을 때 사용합니다:

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## 서브에이전트 지향 옵션

오케스트레이터를 구축하는 SDK 소비자를 위한 옵션 (태스크 실행기 플로우와 유사):

- `outputSchema`: 도구 컨텍스트에 구조화된 출력 기대값 전달
- `requireSubmitResultTool`: `submit_result` 도구 포함 강제
- `taskDepth`: 중첩된 태스크 세션의 재귀 깊이 컨텍스트
- `parentTaskPrefix`: 중첩된 태스크 출력의 아티팩트 명명 접두사

이 옵션들은 일반적인 단일 에이전트 임베딩에서는 선택 사항입니다.

## `createAgentSession()` 반환값

```ts
type CreateAgentSessionResult = {
 session: AgentSession;
 extensionsResult: LoadExtensionsResult;
 setToolUIContext: (uiContext: ExtensionUIContext, hasUI: boolean) => void;
 mcpManager?: MCPManager;
 modelFallbackMessage?: string;
 lspServers?: Array<{ name: string; status: "ready" | "error"; fileTypes: string[]; error?: string }>;
};
```

임베더가 도구/확장이 호출해야 하는 UI 기능을 제공하는 경우에만 `setToolUIContext(...)`를 사용하십시오.

## 최소 제어 임베드 예시

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
 Settings,
} from "@f5xc-salesdemos/xcsh";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const settings = Settings.isolated({
 "compaction.enabled": true,
 "retry.enabled": true,
});

const { session } = await createAgentSession({
 authStorage,
 modelRegistry,
 settings,
 sessionManager: SessionManager.inMemory(),
 toolNames: ["read", "grep", "find", "edit", "write"],
 enableMCP: false,
 enableLsp: true,
});

session.subscribe(event => {
 if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
  process.stdout.write(event.assistantMessageEvent.delta);
 }
});

await session.prompt("Find all TODO comments in this repo and propose fixes.");
await session.dispose();
```
