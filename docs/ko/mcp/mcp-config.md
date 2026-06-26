---
title: MCP 설정
description: '코딩 에이전트 런타임을 위한 MCP 서버 설정, 유효성 검사 및 관리.'
sidebar:
  order: 1
  label: 설정
i18n:
  sourceHash: ef8b49458ce9
  translator: machine
---

# OMP의 MCP 설정

이 가이드에서는 OMP 코딩 에이전트를 위한 MCP 서버를 추가, 편집 및 유효성 검사하는 방법을 설명합니다.

코드 내 참조 소스:

- 런타임 설정 타입: `packages/coding-agent/src/mcp/types.ts`
- 설정 작성기: `packages/coding-agent/src/mcp/config-writer.ts`
- 로더 + 유효성 검사: `packages/coding-agent/src/mcp/config.ts`
- 독립형 `mcp.json` 탐색: `packages/coding-agent/src/discovery/mcp-json.ts`
- 스키마: `packages/coding-agent/src/config/mcp-schema.json`

## 권장 설정 파일 위치

OMP는 여러 도구(`.claude/`, `.cursor/`, `.vscode/`, `opencode.json` 등)에서 MCP 서버를 탐색할 수 있지만, OMP 네이티브 설정에는 일반적으로 다음 파일 중 하나를 사용해야 합니다:

- 프로젝트: `.xcsh/mcp.json`
- 사용자: `~/.xcsh/mcp.json`

OMP는 프로젝트 루트의 대체 독립형 파일도 허용합니다:

- `mcp.json`
- `.mcp.json`

OMP가 설정을 소유하도록 하려면 `.xcsh/mcp.json`을 사용하세요. 다른 MCP 클라이언트도 읽을 수 있는 이식 가능한 대체 파일을 원하는 경우에만 루트 `mcp.json` / `.mcp.json`을 사용하세요.

## 스키마 참조 추가

에디터 자동완성 및 유효성 검사를 위해 파일 상단에 다음 줄을 추가하세요:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {}
}
```

OMP는 이제 `/mcp add`, `/mcp enable`, `/mcp disable`, `/mcp reauth` 또는 기타 설정 작성 흐름이 OMP 관리 MCP 파일을 생성하거나 업데이트할 때 이를 자동으로 작성합니다.

## 파일 구조

OMP는 다음과 같은 최상위 구조를 지원합니다:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-mcp-server"]
    }
  },
  "disabledServers": ["server-name"]
}
```

최상위 키:

- `$schema` — 도구 지원을 위한 선택적 JSON Schema URL
- `mcpServers` — 서버 이름에서 서버 설정으로의 맵
- `disabledServers` — 탐색된 서버를 이름으로 비활성화하는 데 사용되는 사용자 수준 거부 목록

서버 이름은 `^[a-zA-Z0-9_.-]{1,100}$` 패턴과 일치해야 합니다.

## 지원되는 서버 필드

모든 트랜스포트에 공통인 필드:

- `enabled?: boolean` — `false`일 때 이 서버를 건너뜁니다
- `timeout?: number` — 밀리초 단위의 연결 타임아웃
- `auth?: { ... }` — OAuth/API-key 흐름을 위해 OMP에서 사용하는 인증 메타데이터
- `oauth?: { ... }` — 인증/재인증 중에 사용되는 명시적 OAuth 클라이언트 설정

### `stdio` 트랜스포트

`type`이 생략되면 `stdio`가 기본값입니다.

필수:

- `command: string`

선택:

- `type?: "stdio"`
- `args?: string[]`
- `env?: Record<string, string>`
- `cwd?: string`

예시:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/alice/projects",
        "/Users/alice/Documents"
      ]
    }
  }
}
```

이는 공식 Filesystem MCP 서버 패키지(`@modelcontextprotocol/server-filesystem`)를 따릅니다.

### `http` 트랜스포트

필수:

- `type: "http"`
- `url: string`

선택:

- `headers?: Record<string, string>`

예시:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

이는 GitHub의 호스팅된 GitHub MCP 서버 엔드포인트와 일치합니다.

### `sse` 트랜스포트

필수:

- `type: "sse"`
- `url: string`

선택:

- `headers?: Record<string, string>`

예시:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "legacy-remote": {
      "type": "sse",
      "url": "https://example.com/mcp/sse"
    }
  }
}
```

`sse`는 호환성을 위해 여전히 지원되지만, MCP 사양에서는 이제 새로운 서버에 대해 Streamable HTTP(`type: "http"`)를 권장합니다.

## 인증 필드

OMP는 두 가지 인증 관련 객체를 인식합니다.

### `auth`

```json
{
  "type": "oauth" | "apikey",
  "credentialId": "optional-stored-credential-id",
  "tokenUrl": "optional-token-endpoint",
  "clientId": "optional-client-id",
  "clientSecret": "optional-client-secret"
}
```

OMP가 서버의 자격 증명을 복원하는 방법을 기억해야 할 때 사용하세요.

### `oauth`

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "redirectUri": "...",
  "callbackPort": 3334,
  "callbackPath": "/oauth/callback"
}
```

MCP 서버가 명시적 OAuth 클라이언트 설정을 요구할 때 사용하세요.

Slack이 현재 가장 명확한 예시입니다. Slack의 MCP 서버는 `https://mcp.slack.com/mcp`에서 호스팅되며, Streamable HTTP를 사용하고, Slack 앱의 클라이언트 자격 증명을 사용한 기밀 OAuth를 요구합니다.

예시:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

Slack 문서에서 제공하는 관련 Slack 엔드포인트:

- MCP 엔드포인트: `https://mcp.slack.com/mcp`
- 인가 엔드포인트: `https://slack.com/oauth/v2_user/authorize`
- 토큰 엔드포인트: `https://slack.com/api/oauth.v2.user.access`

## 일반적인 복사-붙여넣기 예시

### stdio를 통한 파일시스템 서버

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/absolute/path/one",
        "/absolute/path/two"
      ]
    }
  }
}
```

### HTTP를 통한 GitHub 호스팅 서버

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

### Docker를 통한 GitHub 로컬 서버

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
      }
    }
  }
}
```

이는 GitHub의 공식 로컬 Docker 이미지 `ghcr.io/github/github-mcp-server`와 일치합니다.

### OAuth를 통한 Slack 호스팅 서버

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

## 시크릿 및 변수 해석

이 부분이 사람들이 가장 혼란스러워하는 부분입니다.

### `.xcsh/mcp.json` 및 `~/.xcsh/mcp.json`에서

OMP는 서버를 실행하거나 HTTP 요청을 보내기 전에 `env` 및 `headers` 값을 다음과 같이 해석합니다:

1. 값이 `!`로 시작하면, OMP는 이를 쉘 명령으로 실행하고 트리밍된 stdout을 사용합니다.
2. 그렇지 않으면 OMP는 먼저 값이 환경 변수 이름과 일치하는지 확인합니다.
3. 해당 환경 변수가 설정되어 있지 않으면, OMP는 문자열을 그대로 사용합니다.

예시:

```json
{
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
  },
  "headers": {
    "X-MCP-Insiders": "true"
  }
}
```

이는 로컬 시크릿에 대해 다음과 같이 유효하고 편리하다는 것을 의미합니다:

- `"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"` → 현재 쉘 환경에서 복사
- `"Authorization": "Bearer hardcoded-token"` → 리터럴 값 사용
- `"Authorization": "!printf 'Bearer %s' \"$GITHUB_TOKEN\""` → 명령으로부터 헤더 생성

### 루트 `mcp.json` 및 `.mcp.json`에서

독립형 대체 로더는 탐색 중에 문자열 내의 `${VAR}` 및 `${VAR:-default}`도 확장합니다.

예시:

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      }
    }
  }
}
```

가장 예측 가능한 OMP 동작을 원한다면 `.xcsh/mcp.json`을 사용하고 명시적 env/header 값을 사용하세요.

## `disabledServers`

`disabledServers`는 주로 다른 소스에서 서버가 탐색되었고 해당 도구의 설정을 편집하지 않고 OMP가 이를 무시하도록 하고 싶을 때 사용자 설정 파일(`~/.xcsh/mcp.json`)에서 유용합니다.

예시:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "disabledServers": ["github", "slack"]
}
```

## `/mcp add` vs JSON 직접 편집

가이드 설정을 원할 때는 `/mcp add`를 사용하세요.

다음과 같은 경우 직접 JSON 편집을 사용하세요:

- 마법사가 아직 프롬프트하지 않는 트랜스포트 또는 인증 옵션이 필요한 경우
- 다른 MCP 클라이언트의 서버 정의를 붙여넣고 싶은 경우
- 에디터에서 스키마 기반 유효성 검사를 원하는 경우

편집 후 다음을 사용하세요:

- `/mcp reload` — 현재 세션에서 서버를 재탐색하고 재연결
- `/mcp list` — 서버가 어떤 설정 파일에서 왔는지 확인
- `/mcp test <name>` — 단일 서버 테스트

## OMP가 적용하는 유효성 검사 규칙

`packages/coding-agent/src/mcp/config.ts`의 `validateServerConfig()`에서:

- `stdio`는 `command`를 필요로 합니다
- `http` 및 `sse`는 `url`을 필요로 합니다
- 서버는 `command`와 `url`을 동시에 설정할 수 없습니다
- 알 수 없는 `type` 값은 거부됩니다

실용적 의미:

- `type`을 생략하면 `stdio`를 의미합니다
- 원격 서버 설정을 붙여넣고 `"type": "http"`를 잊으면, OMP는 이를 `stdio`로 처리하고 `command`가 누락되었다고 경고합니다
- `sse`는 호환성을 위해 여전히 유효하지만, 새로운 호스팅 서버는 일반적으로 `http`로 설정해야 합니다

## 탐색 및 우선순위

OMP는 파일 간에 중복된 서버 정의를 병합하지 않습니다. 탐색 프로바이더에 우선순위가 지정되며, 더 높은 우선순위의 정의가 우선합니다.

실제로:

- OMP 전용 오버라이드를 원할 때는 `.xcsh/mcp.json` 또는 `~/.xcsh/mcp.json`을 사용하세요
- 가능하면 도구 간에 서버 이름을 고유하게 유지하세요
- 서드파티 설정이 원하지 않는 서버를 계속 다시 도입하는 경우 사용자 설정에서 `disabledServers`를 사용하세요

## 문제 해결

### `Server "name": stdio server requires "command" field`

원격 서버에 `type: "http"`를 생략했을 가능성이 높습니다.

### `Server "name": both "command" and "url" are set`

하나의 트랜스포트를 선택하세요. OMP는 `command`를 stdio로, `url`을 http/sse로 처리합니다.

### `/mcp add`는 작동했지만 서버가 여전히 연결되지 않음

JSON은 유효하지만 서버에 여전히 접근할 수 없을 수 있습니다. `/mcp test <name>`을 사용하고 다음을 확인하세요:

- 바이너리 또는 Docker 이미지가 존재하는지
- 필수 환경 변수가 설정되어 있는지
- 원격 URL에 접근 가능한지
- OAuth 또는 API 토큰이 유효한지

### 서버가 다른 도구의 설정에는 있지만 OMP에는 없음

`/mcp list`를 실행하세요. OMP는 많은 서드파티 MCP 파일을 탐색하지만, `mcp.enableProjectConfig` 설정을 통해 프로젝트 수준 로딩을 비활성화할 수도 있습니다.

## 참고 자료

- MCP 트랜스포트 사양: <https://modelcontextprotocol.io/specification/2025-03-26/basic/transports>
- 파일시스템 서버 패키지: <https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem>
- GitHub MCP 서버: <https://github.com/github/github-mcp-server>
- Slack MCP 서버 문서: <https://docs.slack.dev/ai/slack-mcp-server/>
