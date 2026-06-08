---
title: MCP 서버 및 도구 작성
description: 코딩 에이전트를 위한 커스텀 MCP 서버 구축 및 도구 등록 가이드.
sidebar:
  order: 4
  label: 서버 및 도구 작성
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# MCP 서버 및 도구 작성

이 문서는 MCP 서버 정의가 코딩 에이전트에서 호출 가능한 `mcp_*` 도구로 변환되는 방식과, 설정이 유효하지 않거나, 중복되거나, 비활성화되거나, 인증이 필요한 경우 운영자가 예상해야 할 사항을 설명합니다.

## 아키텍처 개요

```text
Config sources (.xcsh/.claude/.cursor/.vscode/mcp.json, mcp.json, etc.)
  -> discovery providers normalize to canonical MCPServer
  -> capability loader dedupes by server name (higher provider priority wins)
  -> loadAllMCPConfigs converts to MCPServerConfig + skips enabled:false
  -> MCPManager connects/listTools (with auth/header/env resolution)
  -> MCPTool/DeferredMCPTool bridge exposes tools as mcp_<server>_<tool>
  -> AgentSession.refreshMCPTools replaces live MCP tools immediately
```

## 1) 서버 설정 모델 및 유효성 검사

`src/mcp/types.ts`는 MCP 설정 작성자와 런타임이 사용하는 작성 형태를 정의합니다:

- `stdio` (`type`이 누락된 경우 기본값): `command` 필수, `args`, `env`, `cwd` 선택
- `http`: `url` 필수, `headers` 선택
- `sse`: `url` 필수, `headers` 선택 (호환성을 위해 유지)
- 공유 필드: `enabled`, `timeout`, `auth`

`validateServerConfig()` (`src/mcp/config.ts`)는 전송 계층 기본 사항을 검증합니다:

- `command`와 `url`을 모두 설정한 설정을 거부합니다
- stdio의 경우 `command`가 필요합니다
- http/sse의 경우 `url`이 필요합니다
- 알 수 없는 `type`을 거부합니다

`config-writer.ts`는 추가/업데이트 작업에 이 유효성 검사를 적용하며, 서버 이름도 검증합니다:

- 비어 있지 않아야 함
- 최대 100자
- `[a-zA-Z0-9_.-]`만 허용

### 전송 계층 주의사항

- `type`이 생략되면 stdio를 의미합니다. HTTP/SSE를 의도했지만 `type`을 생략한 경우, `command`가 필수가 됩니다.
- `sse`는 여전히 허용되지만 내부적으로 HTTP 전송(`createHttpTransport`)으로 처리됩니다.
- 유효성 검사는 구조적이며, 연결 가능성을 검증하지 않습니다: 구문적으로 유효한 URL도 연결 시점에 실패할 수 있습니다.

## 2) 검색, 정규화 및 우선순위

### 역량 기반 검색

`loadAllMCPConfigs()` (`src/mcp/config.ts`)는 `loadCapability(mcpCapability.id)`를 통해 정규화된 `MCPServer` 항목을 로드합니다.

역량 계층 (`src/capability/index.ts`)은 다음을 수행합니다:

1. 우선순위 순서로 프로바이더를 로드
2. `server.name`으로 중복 제거 (첫 번째 승리 = 가장 높은 우선순위)
3. 중복 제거된 항목을 검증

결과: 여러 소스에 걸친 중복 서버 이름은 병합되지 않습니다. 하나의 정의가 승리하고, 낮은 우선순위의 중복은 가려집니다.

### `.mcp.json` 및 관련 파일

`src/discovery/mcp-json.ts`의 전용 폴백 프로바이더는 프로젝트 루트의 `mcp.json`과 `.mcp.json`을 읽습니다 (낮은 우선순위).

실제로 MCP 서버는 더 높은 우선순위의 프로바이더에서도 제공됩니다 (예: 네이티브 `.xcsh/...` 및 도구별 설정 디렉토리). 작성 지침:

- 명시적 제어를 위해 `.xcsh/mcp.json` (프로젝트) 또는 `~/.xcsh/mcp.json` (사용자)을 선호하세요.
- 폴백 호환성이 필요한 경우 루트 `mcp.json` / `.mcp.json`을 사용하세요.
- 여러 소스에서 동일한 서버 이름을 재사용하면 병합이 아닌 우선순위 가림이 발생합니다.

### 정규화 동작

`convertToLegacyConfig()` (`src/mcp/config.ts`)는 정규화된 `MCPServer`를 런타임 `MCPServerConfig`로 매핑합니다.

주요 동작:

- 전송 계층은 `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`로 추론
- 비활성화된 서버 (`enabled === false`)는 연결 전에 제거됨
- 선택적 필드는 존재할 때 보존됨

### 검색 시 환경 변수 확장

`mcp-json.ts`는 `expandEnvVarsDeep()`를 사용하여 문자열 필드의 환경 변수 플레이스홀더를 확장합니다:

- `${VAR}` 및 `${VAR:-default}` 지원
- 해결되지 않은 값은 리터럴 `${VAR}` 문자열로 유지됨

`mcp-json.ts`는 또한 사용자 JSON에 대해 런타임 타입 검사를 수행하고, 전체 파일을 실패시키는 대신 유효하지 않은 `enabled`/`timeout` 값에 대해 경고를 로깅합니다.

## 3) 인증 및 런타임 값 해석

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`)는 연결 전 최종 처리 단계입니다.

### OAuth 자격 증명 주입

설정에 다음이 있는 경우:

```ts
auth: { type: "oauth", credentialId: "..." }
```

그리고 인증 저장소에 자격 증명이 존재하는 경우:

- `http`/`sse`: `Authorization: Bearer <access_token>` 헤더를 주입
- `stdio`: `OAUTH_ACCESS_TOKEN` 환경 변수를 주입

자격 증명 조회가 실패하면, 매니저는 경고를 로깅하고 미해결 인증으로 계속 진행합니다.

### 헤더/환경 변수 값 해석

연결 전에 매니저는 `resolveConfigValue()` (`src/config/resolve-config-value.ts`)를 통해 각 헤더/환경 변수 값을 해석합니다:

- `!`로 시작하는 값 => 쉘 명령을 실행하고, 트리밍된 stdout을 사용 (캐시됨)
- 그 외에는 먼저 환경 변수 이름으로 처리 (`process.env[name]`), 리터럴 값으로 폴백
- 해결되지 않은 명령/환경 변수 값은 최종 헤더/환경 변수 맵에서 제외됨

운영상 주의사항: 이는 잘못 입력된 시크릿 명령/환경 변수 키가 해당 헤더/환경 변수 항목을 조용히 제거하여 다운스트림 401/403 또는 서버 시작 실패를 유발할 수 있음을 의미합니다.

## 4) 도구 브릿지: MCP -> 에이전트 호출 가능 도구

`src/mcp/tool-bridge.ts`는 MCP 도구 정의를 `CustomTool`로 변환합니다.

### 이름 지정 및 충돌 도메인

도구 이름은 다음과 같이 생성됩니다:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

규칙:

- 소문자로 변환
- `[a-z_]`가 아닌 문자는 `_`로 변환
- 반복되는 밑줄은 축소
- 도구 이름에서 중복된 `<server>_` 접두사는 한 번 제거

이 방식은 많은 충돌을 방지하지만, 모든 충돌을 방지하지는 않습니다. 서로 다른 원본 이름이 동일한 식별자로 정제될 수 있으며 (예: `my-server`와 `my.server`는 유사하게 정제됨), 레지스트리 삽입은 마지막 쓰기 우선입니다.

### 스키마 매핑

`convertSchema()`는 MCP JSON Schema를 대부분 그대로 유지하지만, 프로바이더 호환성을 위해 `properties`가 누락된 객체 스키마에 `{}`를 패치합니다.

### 실행 매핑

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- MCP `tools/call`을 호출
- MCP 콘텐츠를 표시 가능한 텍스트로 평탄화
- 구조화된 세부 정보 반환 (`serverName`, `mcpToolName`, 프로바이더 메타데이터)
- 서버에서 보고한 `isError`를 `Error: ...` 텍스트 결과로 매핑
- 발생한 전송/런타임 실패를 `MCP error: ...`로 매핑
- AbortError를 `ToolAbortError`로 변환하여 중단 의미 체계를 보존

## 5) 운영자 생명주기: 추가/편집/제거 및 실시간 업데이트

인터랙티브 모드는 `src/modes/controllers/mcp-command-controller.ts`에서 `/mcp`를 노출합니다.

지원되는 작업:

- `add` (마법사 또는 빠른 추가)
- `remove` / `rm`
- `enable` / `disable`
- `test`
- `reauth` / `unauth`
- `reload`

설정 쓰기는 원자적입니다 (`writeMCPConfigFile`: 임시 파일 + 이름 변경).

변경 후 컨트롤러는 `#reloadMCP()`를 호출합니다:

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

`refreshMCPTools()`는 모든 `mcp_` 레지스트리 항목을 교체하고 최신 MCP 도구 세트를 즉시 재활성화하므로, 세션을 재시작하지 않고도 변경 사항이 적용됩니다.

### 모드 차이

- **인터랙티브/TUI 모드**: `/mcp`가 인앱 UX를 제공합니다 (마법사, OAuth 플로우, 연결 상태 텍스트, 즉시 런타임 리바인딩).
- **SDK/헤드리스 통합**: `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`)가 로드된 도구 + 서버별 오류를 반환합니다; `/mcp` 명령 UX는 없습니다.

## 6) 사용자에게 표시되는 오류 표면

사용자/운영자가 보게 되는 일반적인 오류 문자열:

- 추가/업데이트 유효성 검사 실패:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- 빠른 추가 인수 문제:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- 연결/테스트 실패:
  - `Failed to connect to "<name>": <message>`
  - 타임아웃 시 타임아웃 증가를 제안하는 도움말 텍스트
  - `401/403`에 대한 인증 도움말 텍스트
- 인증/OAuth 플로우:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- 비활성화된 서버 사용:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

검색 시 잘못된 소스 JSON은 일반적으로 경고/로그로 처리됩니다; config-writer 경로는 명시적 오류를 발생시킵니다.

## 7) 실용적 작성 지침

이 코드베이스에서 견고한 MCP 작성을 위해:

1. 모든 MCP 지원 설정 소스에서 서버 이름을 전역적으로 고유하게 유지하세요.
2. 생성된 `mcp_*` 도구 이름에서 정제된 이름 충돌을 방지하기 위해 영숫자/밑줄 이름을 선호하세요.
3. 우발적인 stdio 기본값을 방지하기 위해 명시적으로 `type`을 사용하세요.
4. `enabled: false`를 하드 오프로 취급하세요: 서버가 런타임 연결 세트에서 제외됩니다.
5. OAuth 설정의 경우 유효한 `credentialId`를 저장하세요; 그렇지 않으면 인증 주입이 건너뛰어집니다.
6. 명령 기반 시크릿 해석 (`!cmd`)을 사용하는 경우, 명령 출력이 안정적이고 비어 있지 않은지 확인하세요.

## 구현 파일

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts)
- [`src/mcp/config-writer.ts`](../../packages/coding-agent/src/mcp/config-writer.ts)
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts)
- [`src/discovery/mcp-json.ts`](../../packages/coding-agent/src/discovery/mcp-json.ts)
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/config/resolve-config-value.ts`](../../packages/coding-agent/src/config/resolve-config-value.ts)
- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts)
