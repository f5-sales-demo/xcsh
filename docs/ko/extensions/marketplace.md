---
title: Marketplace 플러그인 시스템
description: '큐레이션된 플러그인 컬렉션을 검색, 설치 및 관리하기 위한 Marketplace 플러그인 시스템.'
sidebar:
  order: 4
  label: Marketplace
i18n:
  sourceHash: 8ff4a59bbcd5
  translator: machine
---

# Marketplace 플러그인 시스템

Marketplace 시스템을 사용하면 Git 호스팅 카탈로그에서 플러그인을 검색, 설치 및 관리할 수 있습니다. Claude Code 플러그인 레지스트리 형식과 호환됩니다.

## 빠른 시작

```
/marketplace add anthropics/f5xc-salesdemos-marketplace
/marketplace install wordpress.com@f5xc-salesdemos-marketplace
```

또는 인수 없이 `/marketplace`를 입력하면 대화형 플러그인 브라우저가 열립니다.

## 개념

**marketplace**는 `.xcsh-plugin/marketplace.json` 경로에 카탈로그 파일을 포함하는 Git 리포지토리(또는 로컬 디렉토리)입니다. 카탈로그는 사용 가능한 플러그인의 소스, 설명 및 메타데이터를 나열합니다.

**플러그인**은 스킬, 명령어, 훅, MCP 서버 또는 LSP 서버를 포함하는 디렉토리입니다. 플러그인은 `name@marketplace` 형식으로 식별됩니다 (예: `code-review@f5xc-salesdemos-marketplace`).

**범위**: 플러그인은 두 가지 범위에서 설치할 수 있습니다:

- **user** (기본값) -- 모든 프로젝트에서 사용 가능하며, `~/.xcsh/plugins/installed_plugins.json`에 저장됩니다
- **project** -- 현재 프로젝트에서만 사용 가능하며, `.xcsh/installed_plugins.json`에 저장됩니다

프로젝트 범위 설치는 동일한 플러그인의 사용자 범위 설치를 오버라이드합니다.

## 명령어

### 대화형 모드

| 명령어 | 효과 |
|---|---|
| `/marketplace` | 대화형 플러그인 브라우저 열기 (설치) |

### Marketplace 관리

| 명령어 | 효과 |
|---|---|
| `/marketplace add <source>` | Marketplace 소스 추가 |
| `/marketplace remove <name>` | Marketplace 제거 |
| `/marketplace update [name]` | 카탈로그 다시 가져오기; 이름을 생략하면 전체 업데이트 |
| `/marketplace list` | 구성된 marketplace 목록 표시 |

### 플러그인 작업

| 명령어 | 효과 |
|---|---|
| `/marketplace discover [marketplace]` | 사용 가능한 플러그인 탐색 |
| `/marketplace install [--force] [--scope user\|project] name@marketplace` | 플러그인 설치 |
| `/marketplace uninstall [--scope user\|project] name@marketplace` | 플러그인 제거 |
| `/marketplace installed` | 설치된 marketplace 플러그인 목록 표시 |
| `/marketplace upgrade [--scope user\|project] [name@marketplace]` | 하나 또는 모든 플러그인 업그레이드 |

### CLI 동등 명령어

동일한 작업을 명령줄에서도 수행할 수 있습니다:

```
xcsh plugin marketplace add <source>
xcsh plugin marketplace remove <name>
xcsh plugin marketplace update [name]
xcsh plugin marketplace list
xcsh plugin discover [marketplace]
xcsh plugin install --scope project name@marketplace
```

## Marketplace 소스

`/marketplace add <source>`를 실행하면 시스템이 소스를 다음과 같이 분류합니다:

| 소스 형식 | 유형 | 예시 |
|---|---|---|
| `owner/repo` | GitHub 축약 형식 | `anthropics/f5xc-salesdemos-marketplace` |
| `https://...*.json` | 직접 카탈로그 URL | `https://example.com/marketplace.json` |
| `https://...*.git` 또는 `git@...` | Git 리포지토리 | `https://github.com/org/repo.git` |
| `./path` 또는 `~/path` 또는 `/path` | 로컬 디렉토리 | `./my-marketplace` |

시스템은 리포지토리를 클론하거나 로컬 디렉토리를 읽은 후 `.xcsh-plugin/marketplace.json`을 찾아 유효성을 검사하고 카탈로그를 로컬에 캐시합니다.

## 카탈로그 형식 (marketplace.json)

Marketplace 카탈로그는 리포지토리 루트의 `.xcsh-plugin/marketplace.json`에 위치합니다:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "my-marketplace",
  "owner": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "description": "A collection of plugins",
  "plugins": [
    {
      "name": "my-plugin",
      "description": "What this plugin does",
      "source": "./plugins/my-plugin",
      "category": "development",
      "homepage": "https://github.com/you/my-plugin"
    }
  ]
}
```

### 필수 필드

| 필드 | 설명 |
|---|---|
| `name` | Marketplace 이름. 소문자 영숫자, 하이픈 및 점만 사용 가능. 영숫자로 시작하고 끝나야 합니다. 최대 64자. |
| `owner.name` | Marketplace 소유자 이름 |
| `plugins` | 플러그인 항목 배열 |

### 플러그인 항목 필드

| 필드 | 필수 | 설명 |
|---|---|---|
| `name` | 예 | 플러그인 이름 (marketplace 이름과 동일한 규칙) |
| `source` | 예 | 플러그인 위치 (아래 참조) |
| `description` | 아니오 | 짧은 설명 |
| `version` | 아니오 | 버전 문자열 |
| `author` | 아니오 | `{ name, email? }` |
| `homepage` | 아니오 | URL |
| `category` | 아니오 | 카테고리 문자열 (예: `development`, `productivity`, `security`) |
| `tags` | 아니오 | 문자열 태그 배열 |
| `strict` | 아니오 | 불리언 |
| `commands` | 아니오 | 제공되는 슬래시 명령어 |
| `agents` | 아니오 | 제공되는 에이전트 |
| `hooks` | 아니오 | 훅 정의 |
| `mcpServers` | 아니오 | MCP 서버 정의 |
| `lspServers` | 아니오 | LSP 서버 정의 |

### 플러그인 소스 형식

`source` 필드는 여러 형식을 지원합니다:

**상대 경로** (marketplace 리포지토리 내):

```json
"source": "./plugins/my-plugin"
```

**Git 리포지토리 URL**:

```json
"source": {
  "source": "url",
  "url": "https://github.com/org/repo.git",
  "sha": "abc123..."
}
```

**GitHub 축약 형식**:

```json
"source": {
  "source": "github",
  "repo": "org/repo",
  "ref": "main",
  "sha": "abc123..."
}
```

**Git 하위 디렉토리** (모노레포):

```json
"source": {
  "source": "git-subdir",
  "url": "https://github.com/org/monorepo.git",
  "path": "plugins/my-plugin",
  "ref": "main",
  "sha": "abc123..."
}
```

**npm 패키지**:

```json
"source": {
  "source": "npm",
  "package": "@scope/my-plugin",
  "version": "1.0.0"
}
```

## 디스크 레이아웃

```
~/.xcsh/
  config/
    marketplaces.json          # 추가된 marketplace 레지스트리
  plugins/
    installed_plugins.json     # 사용자 범위 설치된 플러그인
    cache/
      marketplaces/            # 캐시된 marketplace 카탈로그
      plugins/                 # 캐시된 플러그인 디렉토리

<project>/.xcsh/
  installed_plugins.json       # 프로젝트 범위 설치된 플러그인
```

## 명명 규칙

Marketplace 및 플러그인 이름은 다음 규칙을 따라야 합니다:

- 소문자 또는 숫자로 시작하고 끝나야 합니다
- 소문자, 숫자, 하이픈 및 점만 포함할 수 있습니다
- 최대 64자까지 가능합니다

플러그인 ID(`name@marketplace`)는 전체 길이가 최대 128자여야 합니다.

유효한 예시: `my-plugin`, `code-review`, `wordpress.com`, `ai-firstify`
유효하지 않은 예시: `-bad`, `bad-`, `.bad`, `Bad`, `under_score`
