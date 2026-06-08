---
title: Slash Command Internals
description: >-
  Slash command system internals with registration, argument parsing, and
  execution dispatch.
sidebar:
  order: 5
  label: Slash commands
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# 슬래시 커맨드 내부 구조

이 문서는 `coding-agent`에서 슬래시 커맨드가 어떻게 발견되고, 중복 제거되며, 인터랙티브 모드에서 표시되고, 프롬프트 시점에 확장되는지를 설명합니다.

## 구현 파일

- [`src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)
- [`src/capability/slash-command.ts`](../../packages/coding-agent/src/capability/slash-command.ts)
- [`src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`src/discovery/claude.ts`](../../packages/coding-agent/src/discovery/claude.ts)
- [`src/discovery/codex.ts`](../../packages/coding-agent/src/discovery/codex.ts)
- [`src/discovery/claude-plugins.ts`](../../packages/coding-agent/src/discovery/claude-plugins.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)

## 1) 디스커버리 모델

슬래시 커맨드는 커맨드 이름으로 키가 지정된 capability(`id: "slash-commands"`, `key: cmd => cmd.name`)입니다.

capability 레지스트리는 등록된 모든 provider를 provider 우선순위 내림차순으로 정렬하여 로드하고, 키 기준으로 **먼저 등록된 것이 우선**하는 방식으로 중복을 제거합니다.

### Provider 우선순위

현재 슬래시 커맨드 provider와 우선순위:

1. `native` (OMP) — 우선순위 `100`
2. `claude` — 우선순위 `80`
3. `claude-plugins` — 우선순위 `70`
4. `codex` — 우선순위 `70`

동일 우선순위 동작: 동일한 우선순위의 provider는 등록 순서를 유지합니다. 현재 import 순서에서는 `claude-plugins`가 `codex`보다 먼저 등록되므로, 이름 충돌 시 플러그인 커맨드가 codex 커맨드보다 우선합니다.

### 이름 충돌 동작

`slash-commands`의 경우, 충돌은 capability 중복 제거로 엄격하게 해결됩니다:

- 가장 높은 우선순위의 항목이 `result.items`에 유지됩니다
- 낮은 우선순위의 중복 항목은 `result.all`에만 남으며 `_shadowed = true`로 표시됩니다

이 규칙은 provider 간에도 적용되며, 동일 provider가 중복된 이름을 반환하는 경우에도 적용됩니다.

### 파일 스캔 동작

Provider는 주로 `loadFilesFromDir(...)`를 사용하며, 현재 다음과 같이 동작합니다:

- 기본적으로 비재귀 매칭(`*.md`)
- `gitignore: true`, `hidden: false` 옵션으로 네이티브 glob 사용
- 매칭된 각 파일을 읽어 `SlashCommand`로 변환

따라서 숨김 파일/디렉터리는 로드되지 않으며, 무시된 경로는 건너뜁니다.

## 2) Provider별 소스 경로 및 로컬 우선순위

## `native` provider (`builtin.ts`)

검색 루트는 `.xcsh` 디렉터리에서 가져옵니다:

- 프로젝트: `<cwd>/.xcsh/commands/*.md`
- 사용자: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()`는 프로젝트를 먼저, 그 다음 사용자를 반환하므로, 이름 충돌 시 **프로젝트 native 커맨드가 사용자 native 커맨드보다 우선**합니다.

## `claude` provider (`claude.ts`)

로드 대상:

- 사용자: `~/.claude/commands/*.md`
- 프로젝트: `<cwd>/.claude/commands/*.md`

provider는 사용자 항목을 프로젝트 항목보다 먼저 추가하므로, 이 provider 내에서 동일 이름 충돌 시 **사용자 Claude 커맨드가 프로젝트 Claude 커맨드보다 우선**합니다.

## `codex` provider (`codex.ts`)

로드 대상:

- 사용자: `~/.codex/commands/*.md`
- 프로젝트: `<cwd>/.codex/commands/*.md`

양쪽 모두 로드된 후 사용자 우선 순서로 평탄화되므로, 충돌 시 **사용자 Codex 커맨드가 프로젝트 Codex 커맨드보다 우선**합니다.

Codex 커맨드 콘텐츠는 frontmatter 제거(`parseFrontmatter`)로 파싱되며, 커맨드 이름은 frontmatter `name`으로 재정의할 수 있고, 그렇지 않으면 파일명이 사용됩니다.

## `claude-plugins` provider (`claude-plugins.ts`)

`~/.claude/plugins/installed_plugins.json`에서 플러그인 커맨드 루트를 로드한 다음, `<pluginRoot>/commands/*.md`를 스캔합니다.

순서는 레지스트리 반복 순서와 해당 JSON 데이터의 플러그인별 항목 순서를 따릅니다. 추가적인 정렬 단계는 없습니다.

## 3) 런타임 `FileSlashCommand`로의 구체화

`src/extensibility/slash-commands.ts`의 `loadSlashCommands()`는 capability 항목을 프롬프트 시점에 사용되는 `FileSlashCommand` 객체로 변환합니다.

각 커맨드에 대해:

1. frontmatter/본문 파싱 (`parseFrontmatter`)
2. 설명 소스:
   - `frontmatter.description`이 있으면 사용
   - 없으면 첫 번째 비어있지 않은 본문 줄 (trim 처리, 최대 60자에 `...` 추가)
3. 파싱된 본문을 실행 가능한 템플릿 콘텐츠로 유지
4. `via Claude Code Project`와 같은 표시 소스 문자열 계산

Frontmatter 파싱 심각도는 소스에 따라 다릅니다:

- `native` 레벨 -> 파싱 오류는 `fatal`
- `user`/`project` 레벨 -> 파싱 오류는 `warn`이며 대체 파싱으로 폴백

### 번들 폴백 커맨드

파일시스템/provider 커맨드 이후, 이름이 아직 존재하지 않는 경우 내장 커맨드 템플릿(`EMBEDDED_COMMAND_TEMPLATES`)이 추가됩니다.

현재 내장 세트는 `src/task/commands.ts`에서 가져오며 폴백으로 사용됩니다 (`source: "bundled"`).

## 4) 인터랙티브 모드: 커맨드 목록의 출처

인터랙티브 모드는 자동완성과 커맨드 라우팅을 위해 여러 커맨드 소스를 결합합니다.

생성 시 다음으로부터 대기 커맨드 목록을 빌드합니다:

- 내장 커맨드 (`BUILTIN_SLASH_COMMANDS`, 선택된 커맨드에 대한 인수 완성 및 인라인 힌트 포함)
- 확장 등록 슬래시 커맨드 (`extensionRunner.getRegisteredCommands(...)`)
- TypeScript 커스텀 커맨드 (`session.customCommands`), 슬래시 커맨드 레이블로 매핑
- 선택적 스킬 커맨드 (`/skill:<name>`), `skills.enableSkillCommands`가 활성화된 경우

그런 다음 `init()`이 `refreshSlashCommandState(...)`를 호출하여 파일 기반 커맨드를 로드하고, 다음을 포함하는 하나의 `CombinedAutocompleteProvider`를 설치합니다:

- 위의 대기 커맨드
- 발견된 파일 기반 커맨드

`refreshSlashCommandState(...)`는 프롬프트 확장이 동일한 발견된 파일 커맨드 세트를 사용하도록 `session.setSlashCommands(...)`도 업데이트합니다.

### 갱신 생명주기

슬래시 커맨드 상태는 다음 시점에 갱신됩니다:

- 인터랙티브 초기화 중
- `/move`로 작업 디렉터리를 변경한 후 (`handleMoveCommand`가 `resetCapabilities()`를 호출한 다음 `refreshSlashCommandState(newCwd)`를 호출)

커맨드 디렉터리에 대한 지속적인 파일 감시자는 없습니다.

### 기타 표시

Extensions 대시보드도 `slash-commands` capability를 로드하여 `_shadowed` 중복 항목을 포함한 활성/가려진 커맨드 항목을 표시합니다.

## 5) 프롬프트 파이프라인 배치

`AgentSession.prompt(...)` 슬래시 처리 순서 (`expandPromptTemplates !== false`인 경우):

1. **확장 커맨드** (`#tryExecuteExtensionCommand`)  
   `/name`이 확장 등록 커맨드와 일치하면, 핸들러가 즉시 실행되고 prompt가 반환됩니다.
2. **TypeScript 커스텀 커맨드** (`#tryExecuteCustomCommand`)  
   경계만: 일치하면 실행되며 다음을 반환할 수 있습니다:
   - `string` -> 프롬프트 텍스트를 해당 문자열로 대체
   - `void/undefined` -> 처리된 것으로 간주; LLM 프롬프트 없음
3. **파일 기반 슬래시 커맨드** (`expandSlashCommand`)  
   텍스트가 여전히 `/`로 시작하면, 마크다운 커맨드 확장을 시도합니다.
4. **프롬프트 템플릿** (`expandPromptTemplate`)  
   슬래시/커스텀 처리 후에 적용됩니다.
5. **전달**
   - 유휴: 프롬프트가 에이전트에 즉시 전송됩니다
   - 스트리밍: 프롬프트가 `streamingBehavior`에 따라 steer/follow-up으로 큐에 추가됩니다

이것이 슬래시 커맨드 확장이 프롬프트 템플릿 확장보다 먼저 위치하는 이유이며, 커스텀 커맨드가 파일 커맨드 매칭 전에 선행 슬래시를 변환하여 제거할 수 있는 이유입니다.

## 6) 파일 기반 슬래시 커맨드의 확장 의미론

`expandSlashCommand(text, fileCommands)` 동작:

- 텍스트가 `/`로 시작할 때만 실행
- `/` 뒤 첫 번째 토큰에서 커맨드 이름 파싱
- 나머지 텍스트에서 `parseCommandArgs`를 통해 인수 파싱
- 로드된 `fileCommands`에서 정확한 이름 매칭 탐색
- 매칭되면 다음을 적용:
  - 위치 치환: `$1`, `$2`, ...
  - 집계 치환: `$ARGUMENTS` 및 `$@`
  - 그런 다음 `{ args, ARGUMENTS, arguments }`와 함께 `prompt.render`를 통한 템플릿 렌더링
- 매칭되지 않으면 원본 텍스트를 변경 없이 반환

### `parseCommandArgs` 주의사항

파서는 간단한 따옴표 인식 분할입니다:

- 공백을 유지하기 위해 `'작은따옴표'`와 `"큰따옴표"` 인용 지원
- 따옴표 구분자 제거
- 백슬래시 이스케이프 규칙은 구현하지 않음
- 쌍이 맞지 않는 따옴표는 오류가 아님; 파서가 끝까지 소비

## 7) 알 수 없는 `/...` 동작

알 수 없는 슬래시 입력은 핵심 슬래시 로직에 의해 **거부되지 않습니다**.

커맨드가 확장/커스텀/파일 레이어에 의해 처리되지 않으면, `expandSlashCommand`는 원본 텍스트를 반환하고, 리터럴 `/...` 프롬프트는 일반 프롬프트 템플릿 확장과 LLM 전달을 통해 진행됩니다.

인터랙티브 모드는 `InputController`에서 많은 내장 커맨드를 별도로 직접 처리합니다 (예: `/settings`, `/model`, `/mcp`, `/move`, `/exit`). 이들은 `session.prompt(...)` 이전에 소비되므로 해당 경로에서는 파일 커맨드 확장에 도달하지 않습니다.

## 8) 스트리밍 시 차이점 vs 유휴

## 유휴 경로

- `session.prompt("/x ...")`는 커맨드 파이프라인을 실행하고 커맨드를 즉시 실행하거나 확장된 텍스트를 직접 전송합니다.

## 스트리밍 경로 (`session.isStreaming === true`)

- `prompt(...)`는 여전히 확장/커스텀/파일/템플릿 변환을 먼저 실행
- 그런 다음 `streamingBehavior`가 필요:
  - `"steer"` -> 인터럽트 메시지 큐잉 (`agent.steer`)
  - `"followUp"` -> 턴 후 메시지 큐잉 (`agent.followUp`)
- `streamingBehavior`가 생략되면, prompt가 오류를 던짐

### 중요한 커맨드별 스트리밍 동작

- 확장 커맨드는 스트리밍 중에도 즉시 실행됩니다 (텍스트로 큐잉되지 않음).
- `steer(...)`/`followUp(...)` 헬퍼 메서드는 동기적으로 실행되어야 하는 핸들러에 대해 커맨드 텍스트 큐잉을 방지하기 위해 확장 커맨드를 거부합니다 (`#throwIfExtensionCommand`).
- 압축 큐 재생은 `isKnownSlashCommand(...)`를 사용하여 큐에 추가된 항목이 `session.prompt(...)`를 통해 재생되어야 하는지 (알려진 슬래시 커맨드의 경우) 또는 원시 steer/follow-up 메서드를 통해 재생되어야 하는지를 결정합니다.

## 9) 오류 처리 및 실패 지점

- Provider 로드 실패는 격리됩니다; 레지스트리는 경고를 수집하고 다른 provider로 계속 진행합니다.
- 유효하지 않은 슬래시 커맨드 항목 (이름/경로/콘텐츠 누락 또는 유효하지 않은 레벨)은 capability 유효성 검사에 의해 삭제됩니다.
- Frontmatter 파싱 실패:
  - native 커맨드: 치명적 파싱 오류가 전파됨
  - non-native 커맨드: 경고 + 폴백 키/값 파싱
- 확장/커스텀 커맨드 핸들러 예외는 확장 오류 채널을 통해 포착 및 보고되며 (확장 러너가 없는 커스텀 커맨드의 경우 로거 폴백), 처리된 것으로 간주됩니다 (의도하지 않은 폴백 실행 없음).
