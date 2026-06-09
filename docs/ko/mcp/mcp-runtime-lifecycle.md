---
title: MCP 런타임 라이프사이클
description: '초기화부터 도구 등록, 상태 모니터링, 종료까지의 MCP 서버 프로세스 라이프사이클.'
sidebar:
  order: 3
  label: 런타임 라이프사이클
i18n:
  sourceHash: d04cefaf38f8
  translator: machine
---

# MCP 런타임 라이프사이클

이 문서는 코딩 에이전트 런타임에서 MCP 서버가 발견, 연결, 도구로 노출, 갱신, 해제되는 과정을 설명합니다.

## 라이프사이클 개요

1. **SDK 시작** 시 `discoverAndLoadMCPTools()`를 호출합니다(MCP가 비활성화되지 않은 경우).
2. **디스커버리** (`loadAllMCPConfigs`)는 기능 소스에서 MCP 서버 설정을 확인하고, 비활성화된/프로젝트/Exa 항목을 필터링하며, 소스 메타데이터를 보존합니다.
3. **매니저 연결 단계** (`MCPManager.connectServers`)는 서버별 연결 + `tools/list`를 병렬로 시작합니다.
4. **빠른 시작 게이트**는 최대 250ms를 기다린 후 다음을 반환할 수 있습니다:
   - 완전히 로드된 `MCPTool`,
   - 서버별 실패 정보,
   - 또는 아직 대기 중인 서버에 대한 캐시된 `DeferredMCPTool`.
5. **SDK 연결**은 MCP 도구를 세션의 런타임 도구 레지스트리에 병합합니다.
6. **라이브 세션**에서는 `/mcp` 흐름(`disconnectAll` + 재발견 + `session.refreshMCPTools`)을 통해 MCP 도구를 갱신할 수 있습니다.
7. **해제**는 호출자가 `disconnectServer`/`disconnectAll`을 호출할 때 발생하며, 매니저는 연결 해제된 서버의 MCP 도구 등록도 제거합니다.

## 디스커버리 및 로드 단계

### SDK에서의 진입 경로

`src/sdk.ts`의 `createAgentSession()`은 `enableMCP`가 true(기본값)일 때 MCP 시작을 수행합니다:

- `discoverAndLoadMCPTools(cwd, { ... })`를 호출하고,
- `authStorage`, 캐시 스토리지, `mcp.enableProjectConfig` 설정을 전달하며,
- 항상 `filterExa: true`를 설정하고,
- 서버별 로드/연결 오류를 로깅하며,
- 반환된 매니저를 `toolSession.mcpManager`와 세션 결과에 저장합니다.

`enableMCP`가 false이면 MCP 디스커버리는 완전히 건너뜁니다.

### 설정 디스커버리 및 필터링

`loadAllMCPConfigs()` (`src/mcp/config.ts`)는 기능 디스커버리를 통해 정규 MCP 서버 항목을 로드한 후 레거시 `MCPServerConfig`로 변환합니다.

필터링 동작:

- `enableProjectConfig: false`는 프로젝트 수준 항목(`_source.level === "project"`)을 제거합니다.
- `enabled: false`인 서버는 연결 시도 전에 건너뜁니다.
- Exa 서버는 기본적으로 필터링되며, API 키는 네이티브 Exa 도구 통합을 위해 추출됩니다.

결과에는 `configs`와 `sources`(이후 프로바이더 레이블링에 사용되는 메타데이터)가 모두 포함됩니다.

### 디스커버리 수준 실패 동작

`discoverAndLoadMCPTools()`는 두 가지 실패 유형을 구분합니다:

- **디스커버리 하드 실패** (`manager.discoverAndConnect`의 예외, 일반적으로 설정 디스커버리에서 발생): 빈 도구 세트와 하나의 합성 오류 `{ path: ".mcp.json", error }`를 반환합니다.
- **서버별 런타임/연결 실패**: 매니저가 `errors` 맵과 함께 부분 성공을 반환하며, 다른 서버는 계속 진행됩니다.

따라서 개별 MCP 서버가 실패해도 전체 에이전트 세션 시작이 실패하지 않습니다.

## 매니저 상태 모델

`MCPManager`는 별도의 레지스트리로 런타임 라이프사이클을 추적합니다:

- `#connections: Map<string, MCPServerConnection>` — 완전히 연결된 서버.
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — 핸드셰이크 진행 중.
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — 연결되었으나 도구가 아직 로딩 중.
- `#tools: CustomTool[]` — 호출자에게 노출되는 현재 MCP 도구 뷰.
- `#sources: Map<string, SourceMeta>` — 연결 완료 전에도 유지되는 프로바이더/소스 메타데이터.

`getConnectionStatus(name)`는 이러한 맵에서 상태를 도출합니다:

- `#connections`에 있으면 `connected`,
- 대기 중인 연결 또는 대기 중인 도구 로드가 있으면 `connecting`,
- 그 외에는 `disconnected`.

## 연결 수립 및 시작 타이밍

## 서버별 연결 파이프라인

`connectServers()`에서 발견된 각 서버에 대해:

1. 소스 메타데이터 저장/업데이트,
2. 이미 연결되었거나 대기 중이면 건너뜀,
3. 전송 필드 검증 (`validateServerConfig`),
4. 인증/셸 치환 해석 (`#resolveAuthConfig`),
5. `connectToServer(name, resolvedConfig)` 호출,
6. `listTools(connection)` 호출,
7. 도구 정의 캐시 (`MCPToolCache.set`) 최선 노력 방식으로 수행.

`connectToServer()` 동작 (`src/mcp/client.ts`):

- stdio 또는 HTTP/SSE 전송을 생성하고,
- MCP `initialize` + `notifications/initialized`를 수행하며,
- 타임아웃 사용 (`config.timeout` 또는 기본 30초),
- 초기화 실패 시 전송을 종료합니다.

### 빠른 시작 게이트 + 지연 폴백

`connectServers()`는 다음 간의 경쟁을 기다립니다:

- 모든 연결/도구 로드 작업이 완료됨, 그리고
- `STARTUP_TIMEOUT_MS = 250`.

250ms 후:

- 완료된 작업은 라이브 `MCPTool`이 되고,
- 거부된 작업은 서버별 오류를 생성하며,
- 아직 대기 중인 작업은:
  - 캐시된 도구 정의가 있으면 (`MCPToolCache.get`) `DeferredMCPTool`을 생성하고,
  - 그렇지 않으면 해당 대기 작업이 완료될 때까지 차단합니다.

이는 하이브리드 시작 모델입니다: 캐시가 있으면 빠른 반환, 캐시가 없으면 정확성을 위한 대기.

### 백그라운드 완료 동작

각 대기 중인 `toolsPromise`에는 최종적으로 다음을 수행하는 백그라운드 연속 처리가 있습니다:

- `#replaceServerTools`를 통해 매니저 상태에서 해당 서버의 도구 슬라이스를 교체하고,
- 캐시를 기록하며,
- 시작 후에만 지연된 실패를 로깅합니다 (`allowBackgroundLogging`).

## 도구 노출 및 라이브 세션 가용성

### 시작 시 등록

`discoverAndLoadMCPTools()`는 매니저 도구를 `LoadedCustomTool[]`로 변환하고 경로를 꾸밉니다(알려진 경우 `mcp:<server> via <providerName>`).

그런 다음 `createAgentSession()`은 이러한 도구를 `customTools`에 추가하며, 이는 래핑되어 `mcp_<server>_<tool>`과 같은 이름으로 런타임 도구 레지스트리에 추가됩니다.

### 도구 호출

- `MCPTool`은 이미 연결된 `MCPServerConnection`을 통해 도구를 호출합니다.
- `DeferredMCPTool`은 호출 전에 `waitForConnection(server)`를 기다립니다. 이를 통해 연결이 준비되기 전에 캐시된 도구가 존재할 수 있습니다.

둘 다 구조화된 도구 출력을 반환하고 전송/도구 오류를 `MCP error: ...` 도구 콘텐츠로 변환합니다(중단은 중단으로 유지됩니다).

## 갱신/리로드 경로 (시작 vs 라이브 리로드)

### 초기 시작 경로

- `sdk.ts`에서 일회성 디스커버리/로드,
- 도구는 초기 세션 도구 레지스트리에 등록됩니다.

### 인터랙티브 리로드 경로

`/mcp reload` 경로 (`src/modes/controllers/mcp-command-controller.ts`)는 다음을 수행합니다:

1. `mcpManager.disconnectAll()`,
2. `mcpManager.discoverAndConnect()`,
3. `session.refreshMCPTools(mcpManager.getTools())`.

`session.refreshMCPTools()` (`src/session/agent-session.ts`)는 모든 `mcp_` 도구를 제거하고, 최신 MCP 도구를 다시 래핑하며, 도구 세트를 다시 활성화하여 세션을 재시작하지 않고도 MCP 변경 사항이 적용되도록 합니다.

지연된 연결에 대한 후속 경로도 있습니다: 특정 서버를 기다린 후 상태가 `connected`가 되면 `session.refreshMCPTools(...)`를 다시 실행하여 새로 사용 가능한 도구가 세션 내에서 다시 바인딩됩니다.

## 상태 모니터링, 재연결 및 부분 실패 동작

현재 런타임 동작은 의도적으로 최소화되어 있습니다:

- 매니저/클라이언트에 **자율적 상태 모니터가 없습니다**.
- 전송이 끊어졌을 때 **자동 재연결 루프가 없습니다**.
- 매니저는 전송의 `onClose`/`onError`를 구독하지 않으며, 상태는 레지스트리 기반입니다.
- 재연결은 명시적입니다: 리로드 흐름 또는 직접적인 `connectServers()` 호출.

운영 관점에서:

- 하나의 서버 실패가 정상 서버의 도구를 제거하지 않으며,
- 연결/목록 실패는 서버별로 격리되고,
- 도구 캐시와 백그라운드 업데이트는 최선 노력 방식입니다(경고/오류가 로깅되지만 하드 중지는 없음).

## 해제 의미론

### 서버 수준 해제

`disconnectServer(name)`:

- 대기 중인 항목/소스 메타데이터를 제거하고,
- 연결된 경우 전송을 종료하며,
- 매니저 상태에서 해당 서버의 `mcp_` 도구를 제거합니다.

### 전역 해제

`disconnectAll()`:

- `Promise.allSettled`로 모든 활성 전송을 종료하고,
- 대기 맵, 소스, 연결, 매니저 도구 목록을 모두 지웁니다.

현재 연결에서 명시적 해제는 MCP 명령 흐름(리로드/제거/비활성화)에서 사용됩니다. 시작 경로 자체에는 별도의 자동 매니저 폐기 훅이 없으며, 결정적인 MCP 종료가 필요할 때 호출자가 매니저 연결 해제 메서드를 호출할 책임이 있습니다.

## 실패 모드 및 보장

| 시나리오 | 동작 | 하드 실패 vs 최선 노력 |
| --- | --- | --- |
| 디스커버리 예외 발생 (기능/설정 로드 경로) | 로더가 빈 도구 + 합성 `.mcp.json` 오류를 반환 | 최선 노력 세션 시작 |
| 잘못된 서버 설정 | 유효성 검사 오류 항목과 함께 서버 건너뜀 | 서버별 최선 노력 |
| 연결 타임아웃/초기화 실패 | 서버 오류 기록; 다른 서버는 계속 진행 | 서버별 최선 노력 |
| 시작 시 `tools/list`가 아직 대기 중이며 캐시 히트 | 지연된 도구가 즉시 반환됨 | 최선 노력 빠른 시작 |
| 시작 시 `tools/list`가 아직 대기 중이며 캐시 없음 | 시작이 대기 완료까지 기다림 | 정확성을 위한 하드 대기 |
| 지연된 백그라운드 도구 로드 실패 | 시작 게이트 이후 로깅 | 최선 노력 로깅 |
| 런타임 전송 끊김 | 자동 재연결 없음; 재연결/리로드 전까지 이후 호출 실패 | 수동 조치를 통한 최선 노력 복구 |

## 공개 API 표면

`src/mcp/index.ts`는 외부 호출자를 위해 로더/매니저/클라이언트 API를 재내보냅니다. `src/sdk.ts`는 동일한 로더 결과 형태를 반환하는 편의 래퍼로 `discoverMCPServers()`를 노출합니다.

## 구현 파일

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — 로더 파사드, 디스커버리 오류 정규화, `LoadedCustomTool` 변환.
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — 라이프사이클 상태 레지스트리, 병렬 연결/목록 흐름, 갱신/연결 해제.
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — 전송 설정, 초기화 핸드셰이크, 목록/호출/연결 해제.
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — MCP 모듈 API 내보내기.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — 세션/도구 레지스트리로의 시작 연결.
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — 매니저가 사용하는 설정 디스커버리/필터링/검증.
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — `MCPTool` 및 `DeferredMCPTool` 런타임 동작.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `refreshMCPTools` 라이브 리바인딩.
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — 인터랙티브 리로드/재연결 흐름.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — 부모 매니저 연결을 통한 서브에이전트 MCP 프록시.
