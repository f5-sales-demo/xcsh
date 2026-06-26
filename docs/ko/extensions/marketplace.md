---
title: 마켓플레이스 플러그인 시스템
description: '엄선된 플러그인 컬렉션을 검색, 설치 및 관리하기 위한 마켓플레이스 플러그인 시스템입니다.'
sidebar:
  order: 4
  label: 마켓플레이스
i18n:
  sourceHash: 71d9f8f93a81
  translator: machine
---

# 마켓플레이스 플러그인 시스템

마켓플레이스 시스템을 사용하면 Git 호스팅 카탈로그에서 플러그인을 검색, 설치 및 관리할 수 있습니다. Claude Code 플러그인 레지스트리 형식과 호환됩니다.

## 빠른 시작

```
/marketplace add anthropics/f5-sales-demo-marketplace
/marketplace install wordpress.com@f5-sales-demo-marketplace
```

또는 인수 없이 `/marketplace`를 입력하면 대화형 플러그인 브라우저가 열립니다.

## 개념

**마켓플레이스**는 `.xcsh-plugin/marketplace.json` 위치에 카탈로그 파일이 포함된 Git 저장소(또는 로컬 디렉터리)입니다. 카탈로그는 소스, 설명 및 메타데이터와 함께 사용 가능한 플러그인을 나열합니다.

**플러그인**은 스킬, 명령, 훅, MCP 서버 또는 LSP 서버가 포함된 디렉터리입니다. 플러그인은 `name@marketplace` 형식으로 식별됩니다(예: `code-review@f5-sales-demo-marketplace`).

**범위**: 플러그인은 두 가지 범위에서 설치할 수 있습니다:

- **user** (기본값) -- 모든 프로젝트에서 사용 가능하며, `~/.xcsh/plugins/installed_plugins.json`에 저장됩니다.
- **project** -- 현재 프로젝트에서만 사용 가능하며, `.xcsh/installed_plugins.json`에 저장됩니다.

프로젝트 범위 설치는 동일한 플러그인의 사용자 범위 설치를 덮어씁니다.

## 명령어

### 대화형 모드

| 명령어 | 효과 |
|---|---|
| `/marketplace` | 대화형 플러그인 브라우저 열기 (설치) |

### 마켓플레이스 관리

| 명령어 | 효과 |
|---|---|
| `/marketplace add <source>` | 마켓플레이스 소스 추가 |
| `/marketplace remove <name>` | 마켓플레이스 제거 |
| `/marketplace update [name]` | 카탈로그 재가져오기; name을 생략하면 모두 업데이트 |
| `/marketplace list` | 구성된 마켓플레이스 목록 표시 |

### 플러그인 작업

| 명령어 | 효과 |
|---|---|
| `/marketplace discover [marketplace]` | 사용 가능한 플러그인 탐색 |
| `/marketplace install [--force] [--scope user\|project] name@marketplace` | 플러그인 설치 |
| `/marketplace uninstall [--scope user\|project] name@marketplace` | 플러그인 제거 |
| `/marketplace installed` | 설치된 마켓플레이스 플러그인 목록 표시 |
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

## 마켓플레이스 소스

`/marketplace add <source>`를 실행하면 시스템이 소스를 다음과 같이 분류합니다:

| 소스 형식 | 유형 | 예시 |
|---|---|---|
| `owner/repo` | GitHub 단축 표기 | `anthropics/f5-sales-demo-marketplace` |
| `https://...*.json` | 직접 카탈로그 URL | `https://example.com/marketplace.json` |
| `https://...*.git` 또는 `git@...` | Git 저장소 | `https://github.com/org/repo.git` |
| `./path` 또는 `~/path` 또는 `/path` | 로컬 디렉터리 | `./my-marketplace` |

시스템은 저장소를 복제하거나(또는 로컬 디렉터리를 읽어) `.xcsh-plugin/marketplace.json`을 찾아 유효성을 검사한 후 카탈로그를 로컬에 캐시합니다.

## 카탈로그 형식 (marketplace.json)

마켓플레이스 카탈로그는 저장소 루트의 `.xcsh-plugin/marketplace.json`에 위치합니다:

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
| `name` | 마켓플레이스 이름. 소문자 영숫자, 하이픈 및 점으로 구성. 영숫자로 시작하고 끝나야 함. 최대 64자. |
| `owner.name` | 마켓플레이스 소유자 이름 |
| `plugins` | 플러그인 항목 배열 |

### 플러그인 항목 필드

| 필드 | 필수 여부 | 설명 |
|---|---|---|
| `name` | 예 | 플러그인 이름 (마켓플레이스 이름과 동일한 규칙 적용) |
| `source` | 예 | 플러그인을 찾을 위치 (아래 참조) |
| `description` | 아니요 | 간단한 설명 |
| `version` | 아니요 | 버전 문자열 |
| `author` | 아니요 | `{ name, email? }` |
| `homepage` | 아니요 | URL |
| `category` | 아니요 | 카테고리 문자열 (예: `development`, `productivity`, `security`) |
| `tags` | 아니요 | 문자열 태그 배열 |
| `strict` | 아니요 | 불리언 |
| `commands` | 아니요 | 제공되는 슬래시 명령어 |
| `agents` | 아니요 | 제공되는 에이전트 |
| `hooks` | 아니요 | 훅 정의 |
| `mcpServers` | 아니요 | MCP 서버 정의 |
| `lspServers` | 아니요 | LSP 서버 정의 |

### 플러그인 소스 형식

`source` 필드는 여러 형식을 지원합니다:

**상대 경로** (마켓플레이스 저장소 내):

```json
"source": "./plugins/my-plugin"
```

**Git 저장소 URL**:

```json
"source": {
  "source": "url",
  "url": "https://github.com/org/repo.git",
  "sha": "abc123..."
}
```

**GitHub 단축 표기**:

```json
"source": {
  "source": "github",
  "repo": "org/repo",
  "ref": "main",
  "sha": "abc123..."
}
```

**Git 하위 디렉터리** (모노레포):

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
    marketplaces.json          # 추가된 마켓플레이스 레지스트리
  plugins/
    installed_plugins.json     # 사용자 범위 설치된 플러그인
    cache/
      marketplaces/            # 캐시된 마켓플레이스 카탈로그
      plugins/                 # 캐시된 플러그인 디렉터리

<project>/.xcsh/
  installed_plugins.json       # 프로젝트 범위 설치된 플러그인
```

## 명명 규칙

마켓플레이스 및 플러그인 이름은 다음 조건을 충족해야 합니다:

- 소문자 알파벳 또는 숫자로 시작하고 끝나야 합니다.
- 소문자 알파벳, 숫자, 하이픈, 점만 포함해야 합니다.
- 최대 64자를 초과하지 않아야 합니다.

플러그인 ID(`name@marketplace`)는 총 최대 128자를 초과하지 않아야 합니다.

유효한 예: `my-plugin`, `code-review`, `wordpress.com`, `ai-firstify`
유효하지 않은 예: `-bad`, `bad-`, `.bad`, `Bad`, `under_score`
