---
title: MCP 런타임 생명주기
description: '초기화부터 도구 등록, 상태 모니터링, 종료까지의 MCP 서버 프로세스 생명주기.'
sidebar:
  order: 3
  label: 런타임 생명주기
i18n:
  sourceHash: d04cefaf38f8
  translator: machine
---

# MCP 런타임 생명주기

이 문서는 코딩 에이전트 런타임에서 MCP 서버가 검색, 연결, 도구로 노출, 새로고침 및 해제되는 방식을 설명합니다.

## 생명주기 개요

1. **SDK 시작** 시 `discoverAndLoadMCPTools()`를 호출합니다 (MCP가 비활성화되지 않은 경우).
2. **검색** (`loadAllMCPConfigs`)은 기능 소스에서 MCP 서버 설정을 확인하고, 비활성화/프로젝트/Exa 항목을 필터링하며, 소스 메타데이터를 보존합니다.
3. **매니저 연결 단계** (`MCPManager.connectServers`)는 서버별 연결 + `tools/list`를 병렬로 시작합니다.
4. **빠른 시작 게이트**는 최대 250ms 동안 대기한 후 다음을 반환할 수 있습니다:
   - 완전히 로드된 `MCPTool`,
   - 서버별 실패,
   - 또는 아직 대기 중인 서버를 위한 캐시된 `DeferredMCPTool`.
5. **SDK 연결**은 MCP 도구를 세션의 런타임 도구 레지스트리에 병합합니다.
6. **라이브 세션**에서는 `/mcp` 플로우(`disconnectAll` + 재검색 + `session.refreshMCPTools`)를 통해 MCP 도구를 새로고침할 수 있습니다.
7. **해제**는 호출자가 `disconnectServer`/`disconnectAll`을 실행할 때 발생하며, 매니저는 연결 해제된 서버의 MCP 도구 등록도 제거합니다.

## 검색 및 로드 단계

### SDK에서의 진입 경로

`src/sdk.ts`의 `createAgentSession()`은 `enableMCP`가 true(기본값)일 때 MCP 시작을 수행합니다:

- `discoverAndLoadMCPTools(cwd, { ... })`를 호출하고,
- `authStorage`, 캐시 스토리지, `mcp.enableProjectConfig` 설정을 전달하며,
- 항상 `filterExa: true`를 설정하고,
- 서버별 로드/연결 오류를 로깅하며,
- 반환된 매니저를 `toolSession.mcpManager`와 세션 결과에 저장합니다.

`enableMCP`가 false이면 MCP 검색이 완전히 건너뛰어집니다.

### 설정 검색 및 필터링

`loadAllMCPConfigs()` (`src/mcp/config.ts`)는 기능 검색을 통해 정규 MCP 서버 항목을 로드한 다음 레거시 `MCPServerConfig`로 변환합니다.

필터링 동작:

- `enableProjectConfig: false`는 프로젝트 수준 항목(`_source.level === "project"`)을 제거합니다.
- `enabled: false`인 서버는 연결 시도 전에 건너뛰어집니다.
- Exa 서버는 기본적으로 필터링되며 API 키는 네이티브 Exa 도구 통합을 위해 추출됩니다.

결과에는 `configs`와 `sources`(이후 제공자 레이블링에 사용되는 메타데이터) 모두 포함됩니다.

### 검색 수준 실패 동작

`discoverAndLoadMCPTools()`는 두 가지 실패 유형을 구분합니다:

- **검색 하드 실패** (`manager.discoverAndConnect`의 예외, 일반적으로 설정 검색에서 발생): 빈 도구 세트와 하나의 합성 오류 `{ path: ".mcp.json", error }`를 반환합니다.
- **서버별 런타임/연결 실패**: 매니저가 `errors` 맵과 함께 부분 성공을 반환하며, 다른 서버는 계속됩니다.

따라서 개별 MCP 서버가 실패해도 전체 에이전트 세션 시작이 실패하지 않습니다.

## 매니저 상태 모델

`MCPManager`는 별도의 레지스트리로 런타임 생명주기를 추적합니다:

- `#connections: Map<string, MCPServerConnection>` — 완전히 연결된 서버.
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — 핸드셰이크 진행 중.
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — 연결되었지만 도구 로딩 중.
- `#tools: CustomTool[]` — 호출자에게 노출되는 현재 MCP 도구 뷰.
- `#sources: Map<string, SourceMeta>` — 연결 완료 전에도 유지되는 제공자/소스 메타데이터.

`getConnectionStatus(name)`는 이러한 맵에서 상태를 도출합니다:

- `#connections`에 있으면 `connected`,
- 대기 중 연결 또는 대기 중 도구 로드에 있으면 `connecting`,
- 그 외에는 `disconnected`.

## 연결 수립 및 시작 타이밍

## 서버별 연결 파이프라인

`connectServers()`에서 검색된 각 서버에 대해:

1. 소스 메타데이터 저장/업데이트,
2. 이미 연결됨/대기 중이면 건너뛰기,
3. 전송 필드 검증 (`validateServerConfig`),
4. 인증/셸 대체 해결 (`#resolveAuthConfig`),
5. `connectToServer(name, resolvedConfig)` 호출,
6. `listTools(connection)` 호출,
7. 도구 정의를 최선 노력으로 캐시 (`MCPToolCache.set`).

`connectToServer()` 동작 (`src/mcp/client.ts`):

- stdio 또는 HTTP/SSE 전송을 생성,
- MCP `initialize` + `notifications/initialized` 수행,
- 타임아웃 사용 (`config.timeout` 또는 기본 30초),
- 초기화 실패 시 전송 종료.

### 빠른 시작 게이트 + 지연 폴백

`connectServers()`는 다음 사이의 경합을 기다립니다:

- 모든 연결/도구 로드 작업 완료, 그리고
- `STARTUP_TIMEOUT_MS = 250`.

250ms 후:

- 이행된 작업은 라이브 `MCPTool`이 됩니다,
- 거부된 작업은 서버별 오류를 생성합니다,
- 아직 대기 중인 작업:
  - 캐시된 도구 정의가 있으면 (`MCPToolCache.get`) `DeferredMCPTool`을 생성합니다,
  - 그렇지 않으면 해당 대기 작업이 완료될 때까지 대기합니다.

이것은 하이브리드 시작 모델입니다: 캐시가 있을 때는 빠른 반환, 캐시가 없을 때는 정확성을 위한 대기입니다.

### 백그라운드 완료 동작

각 대기 중인 `toolsPromise`에는 최종적으로 다음을 수행하는 백그라운드 연속 처리가 있습니다:

- `#replaceServerTools`를 통해 매니저 상태에서 해당 서버의 도구 슬라이스를 교체,
- 캐시 기록,
- 시작 후에만 지연 실패 로깅 (`allowBackgroundLogging`).

## 도구 노출 및 라이브 세션 가용성

### 시작 시 등록

`discoverAndLoadMCPTools()`는 매니저 도구를 `LoadedCustomTool[]`로 변환하고 경로를 장식합니다 (알려진 경우 `mcp:<server> via <providerName>`).

`createAgentSession()`은 이러한 도구를 `customTools`에 추가하고, 이는 래핑되어 `mcp_<server>_<tool>` 같은 이름으로 런타임 도구 레지스트리에 추가됩니다.

### 도구 호출

- `MCPTool`은 이미 연결된 `MCPServerConnection`을 통해 도구를 호출합니다.
- `DeferredMCPTool`은 호출 전에 `waitForConnection(server)`를 대기합니다; 이를 통해 연결이 준비되기 전에 캐시된 도구가 존재할 수 있습니다.

둘 다 구조화된 도구 출력을 반환하고 전송/도구 오류를 `MCP error: ...` 도구 콘텐츠로 변환합니다 (중단은 중단 그대로 유지).

## 새로고침/재로드 경로 (시작 vs 라이브 재로드)

### 초기 시작 경로

- `sdk.ts`에서 일회성 검색/로드,
- 도구는 초기 세션 도구 레지스트리에 등록됩니다.

### 인터랙티브 재로드 경로

`/mcp reload` 경로 (`src/modes/controllers/mcp-command-controller.ts`)는 다음을 수행합니다:

1. `mcpManager.disconnectAll()`,
2. `mcpManager.discoverAndConnect()`,
3. `session.refreshMCPTools(mcpManager.getTools())`.

`session.refreshMCPTools()` (`src/session/agent-session.ts`)는 모든 `mcp_` 도구를 제거하고, 최신 MCP 도구를 다시 래핑하며, 도구 세트를 다시 활성화하여 세션을 재시작하지 않고도 MCP 변경 사항이 적용되도록 합니다.

지연 연결을 위한 후속 경로도 있습니다: 특정 서버를 대기한 후 상태가 `connected`가 되면, `session.refreshMCPTools(...)`를 다시 실행하여 새로 사용 가능한 도구가 세션 내에서 다시 바인딩됩니다.

## 상태, 재연결 및 부분 실패 동작

현재 런타임 동작은 의도적으로 최소화되어 있습니다:

- 매니저/클라이언트에 **자율 상태 모니터 없음**.
- 전송이 끊어졌을 때 **자동 재연결 루프 없음**.
- 매니저는 전송의 `onClose`/`onError`를 구독하지 않으며, 상태는 레지스트리 기반입니다.
- 재연결은 명시적입니다: 재로드 플로우 또는 직접 `connectServers()` 호출.

운영적으로:

- 하나의 서버 실패가 정상 서버의 도구를 제거하지 않습니다,
- 연결/목록 실패는 서버별로 격리됩니다,
- 도구 캐시와 백그라운드 업데이트는 최선 노력입니다 (경고/오류가 로깅되며 하드 스톱 없음).

## 해제 의미론

### 서버 수준 해제

`disconnectServer(name)`:

- 대기 항목/소스 메타데이터를 제거,
- 연결된 경우 전송을 종료,
- 매니저 상태에서 해당 서버의 `mcp_` 도구를 제거.

### 전역 해제

`disconnectAll()`:

- `Promise.allSettled`로 모든 활성 전송을 종료,
- 대기 맵, 소스, 연결, 매니저 도구 목록을 지움.

현재 구조에서 명시적 해제는 MCP 명령 플로우(재로드/제거/비활성화)에서 사용됩니다. 시작 경로 자체에는 별도의 자동 매니저 처분 훅이 없으며, 호출자가 결정적 MCP 종료가 필요할 때 매니저 연결 해제 메서드를 호출해야 합니다.

## 실패 모드 및 보장

| 시나리오 | 동작 | 하드 실패 vs 최선 노력 |
| --- | --- | --- |
| 검색 예외 발생 (기능/설정 로드 경로) | 로더가 빈 도구 + 합성 `.mcp.json` 오류 반환 | 최선 노력 세션 시작 |
| 유효하지 않은 서버 설정 | 검증 오류 항목과 함께 서버 건너뛰기 | 서버별 최선 노력 |
| 연결 타임아웃/초기화 실패 | 서버 오류 기록; 다른 서버 계속 | 서버별 최선 노력 |
| 시작 시 캐시 히트와 함께 `tools/list` 아직 대기 중 | 지연 도구가 즉시 반환 | 최선 노력 빠른 시작 |
| 시작 시 캐시 없이 `tools/list` 아직 대기 중 | 시작이 대기 완료까지 기다림 | 정확성을 위한 하드 대기 |
| 지연 백그라운드 도구 로드 실패 | 시작 게이트 이후 로깅 | 최선 노력 로깅 |
| 런타임 전송 끊김 | 자동 재연결 없음; 재연결/재로드 전까지 이후 호출 실패 | 수동 조치를 통한 최선 노력 복구 |

## 공개 API 표면

`src/mcp/index.ts`는 외부 호출자를 위해 로더/매니저/클라이언트 API를 재내보냅니다. `src/sdk.ts`는 동일한 로더 결과 형태를 반환하는 편의 래퍼로 `discoverMCPServers()`를 노출합니다.

## 구현 파일

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — 로더 파사드, 검색 오류 정규화, `LoadedCustomTool` 변환.
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — 생명주기 상태 레지스트리, 병렬 연결/목록 플로우, 새로고침/연결 해제.
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — 전송 설정, 초기화 핸드셰이크, 목록/호출/연결 해제.
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — MCP 모듈 API 내보내기.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — 세션/도구 레지스트리로의 시작 연결.
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — 매니저가 사용하는 설정 검색/필터링/검증.
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — `MCPTool` 및 `DeferredMCPTool` 런타임 동작.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `refreshMCPTools` 라이브 재바인딩.
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — 인터랙티브 재로드/재연결 플로우.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — 부모 매니저 연결을 통한 하위 에이전트 MCP 프록시.
