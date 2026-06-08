---
title: '세션 작업: 내보내기, 덤프, 공유, 포크, 재개'
description: '대화 내보내기, 공유, 포크 및 재개를 위한 세션 작업입니다.'
sidebar:
  order: 3
  label: 작업
i18n:
  sourceHash: e3c210b29c3e
  translator: machine
---

# 세션 작업: export, dump, share, fork, resume/continue

이 문서는 현재 구현된 세션 내보내기/공유/포크/재개 작업에 대한 운영자가 확인할 수 있는 동작을 설명합니다.

## 구현 파일

- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/export/html/index.ts`](../../packages/coding-agent/src/export/html/index.ts)
- [`../src/export/custom-share.ts`](../../packages/coding-agent/src/export/custom-share.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)

## 작업 매트릭스

| 작업 | 진입 경로 | 세션 변경 | 세션 파일 생성/전환 | 출력 아티팩트 |
|---|---|---|---|---|
| `/dump` | 대화형 슬래시 명령 | 아니오 | 아니오 | 클립보드 텍스트 |
| `/export [path]` | 대화형 슬래시 명령 | 아니오 | 아니오 | HTML 파일 |
| `--export <session.jsonl> [outputPath]` | CLI 시작 패스트패스 | 런타임 세션 변경 없음 | 활성 세션 없음; 대상 파일을 읽음 | HTML 파일 |
| `/share` | 대화형 슬래시 명령 | 아니오 | 아니오 | 임시 HTML + 공유 URL/gist |
| `/fork` | 대화형 슬래시 명령 | 예 (활성 세션 ID 변경) | 새 세션 파일 생성 후 현재 세션을 해당 파일로 전환 (영구 모드에서만) | 아티팩트 디렉토리가 있으면 새 세션 네임스페이스로 복사 |
| `/resume` | 대화형 슬래시 명령 | 예 (활성 인메모리 상태 교체) | 선택한 기존 세션 파일로 전환 | 없음 |
| `--resume` | CLI 시작 (선택기) | 세션 생성 후 예 | 선택한 기존 세션 파일 열기 | 없음 |
| `--resume <id\|path>` | CLI 시작 | 세션 생성 후 예 | 기존 세션 열기; 프로젝트 간 경우 현재 프로젝트로 포크 가능 | 없음 |
| `--continue` | CLI 시작 | 세션 생성 후 예 | 터미널 브레드크럼 또는 가장 최근 세션 열기; 없으면 새로 생성 | 없음 |

## 내보내기와 덤프

### `/export [outputPath]` (대화형)

흐름:

1. `InputController`가 `/export...`를 `CommandController.handleExportCommand`로 라우팅합니다.
2. 명령은 공백으로 분할하며 `/export` 이후 첫 번째 인수만 `outputPath`로 사용합니다.
3. `AgentSession.exportToHtml()`이 `exportSessionToHtml(sessionManager, state, { outputPath, themeName })`을 호출합니다.
4. 성공 시 UI에 경로가 표시되고 브라우저에서 파일이 열립니다.

동작 세부사항:

- `--copy`, `clipboard`, `copy` 인수는 `/dump`를 사용하라는 경고와 함께 명시적으로 거부됩니다.
- 내보내기에는 세션 헤더/항목/리프와 현재 `systemPrompt` 및 에이전트 상태의 도구 설명이 포함됩니다.
- 내보내기 중 세션 항목이 추가되지 않습니다.

주의사항:

- 인수 파싱이 공백 기반(`text.split(/\s+/)`)이므로 공백이 포함된 인용 경로는 이 명령 경로에서 단일 경로로 보존되지 않습니다.

### `--export <inputSessionFile> [outputPath]` (CLI)

`main.ts`에서의 흐름:

1. 초기에 처리됩니다 (대화형/세션 시작 전).
2. `exportFromFile(inputPath, outputPath?)`를 호출합니다.
3. `SessionManager.open(inputPath)`이 항목을 로드한 후 HTML이 생성되어 기록됩니다.
4. 프로세스가 `Exported to: ...`를 출력하고 종료합니다.

동작 세부사항:

- 입력 파일이 없으면 `File not found: <path>`로 표시됩니다.
- 이 경로는 `AgentSession`을 생성하지 않으며 실행 중인 세션을 변경하지 않습니다.

### `/dump` (대화형 클립보드 내보내기)

흐름:

1. `CommandController.handleDumpCommand()`가 `session.formatSessionAsText()`를 호출합니다.
2. 빈 문자열이면 `No messages to dump yet.`을 보고합니다.
3. 그렇지 않으면 네이티브 `copyToClipboard`를 통해 클립보드에 복사합니다.

덤프 내용에 포함되는 것:

- 시스템 프롬프트
- 활성 모델/사고 수준
- 도구 정의 + 매개변수
- 사용자/어시스턴트 메시지
- 사고 블록 및 도구 호출
- 도구 결과 및 실행 블록 (`excludeFromContext` bash/python 항목 제외)
- 커스텀/훅/파일 멘션/브랜치 요약/압축 요약 항목

덤프로 인한 세션 영속성 변경은 없습니다.

## 공유

`/share`는 대화형 전용이며 항상 현재 세션을 임시 HTML 파일로 내보내는 것으로 시작합니다.

### 1단계: 임시 내보내기

- 임시 파일 경로: `${os.tmpdir()}/${Snowflake.next()}.html`
- `session.exportToHtml(tmpFile)` 사용
- 내보내기가 실패하면 (특히 인메모리 세션의 경우) 공유가 오류와 함께 종료됩니다.

### 2단계: 커스텀 공유 핸들러 (있는 경우)

`loadCustomShare()`는 `~/.xcsh/agent`에서 첫 번째로 존재하는 후보를 확인합니다:

- `share.ts`
- `share.js`
- `share.mjs`

요구사항:

- 모듈은 `(htmlPath) => Promise<CustomShareResult | string | undefined>` 함수를 기본 내보내기해야 합니다.

존재하고 유효한 경우:

- UI가 `Sharing...` 로더 상태에 진입합니다.
- 핸들러 결과 해석:
  - 문자열 => URL로 처리되어 표시 및 열기
  - 객체 => `url` 및/또는 `message` 표시; `url` 열기
  - `undefined`/falsy => 일반적인 `Session shared`
- 완료 후 임시 파일이 삭제됩니다.

중요한 폴백 동작:

- 커스텀 핸들러가 존재하지만 로딩에 실패하면 명령이 오류를 반환합니다.
- 커스텀 핸들러가 실행되었지만 예외를 던지면 명령이 오류를 반환합니다.
- 두 실패 경우 모두 GitHub gist로 **폴백하지 않습니다**.
- Gist 폴백은 커스텀 공유 스크립트가 없을 때만 발생합니다.

### 3단계: 기본 gist 폴백

커스텀 공유 핸들러가 없을 때만:

1. `gh auth status`를 검증합니다.
2. `Creating gist...` 로더를 표시합니다.
3. `gh gist create --public=false <tmpFile>`을 실행합니다.
4. Gist URL을 파싱하고 gist ID를 추출하여 미리보기 URL `https://gistpreview.github.io/?<id>`를 구성합니다.
5. 미리보기와 gist URL을 모두 표시하고 미리보기를 엽니다.

공유에서의 취소/중단 시맨틱:

- 로더에는 에디터 UI를 복원하고 `Share cancelled`를 보고하는 `onAbort` 훅이 있습니다.
- 이 코드 경로에서 기본 `gh gist create` 명령에는 중단 신호가 전달되지 않습니다; 취소는 UI 수준이며 명령 반환 후 확인됩니다.

## 포크

`/fork`는 현재 세션에서 새 세션을 생성하고 활성 세션 ID를 전환합니다.

### 전제 조건 및 즉시 가드

- 에이전트가 스트리밍 중이면 `/fork`가 경고와 함께 거부됩니다.
- 작업 전에 UI 상태/로딩 표시기가 클리어됩니다.

### 세션 수준 흐름

`AgentSession.fork()`:

1. `reason: "fork"`와 함께 `session_before_switch`를 발행합니다 (취소 가능).
2. 보류 중인 쓰기를 플러시합니다.
3. `SessionManager.fork()`를 호출합니다.
4. 이전 세션 네임스페이스에서 새 네임스페이스로 아티팩트 디렉토리를 복사합니다 (베스트 에포트; ENOENT가 아닌 복사 실패는 로그만 남기고 치명적이지 않음).
5. `agent.sessionId`를 업데이트합니다.
6. `reason: "fork"`와 함께 `session_switch`를 발행합니다.

`SessionManager.fork()` 동작:

- 영구 모드와 기존 세션 파일이 필요합니다.
- 새 세션 ID와 새 JSONL 파일 경로를 생성합니다.
- 다음과 같이 헤더를 다시 작성합니다:
  - 새 `id`
  - 새 타임스탬프
  - `cwd` 변경 없음
  - `parentSession`을 이전 세션 ID로 설정
- 새 파일에서 헤더 이외의 모든 항목은 변경되지 않습니다.

### 비영구 동작

- 인메모리 세션 매니저는 `fork()`에서 `undefined`를 반환합니다.
- `AgentSession.fork()`는 `false`를 반환합니다.
- UI에 `Fork failed (session not persisted or cancelled)`가 보고됩니다.

## 재개와 계속

## 대화형 `/resume`

흐름:

1. `SessionManager.list(currentCwd, currentSessionDir)`를 통해 채워진 세션 선택기를 엽니다.
2. 선택 시 `SelectorController.handleResumeSession(sessionPath)`이 `session.switchSession(sessionPath)`을 호출합니다.
3. UI가 채팅과 할 일을 클리어/재구성한 후 `Resumed session`을 보고합니다.

참고사항:

- 이 선택기는 현재 세션 디렉토리 범위 내의 세션만 나열합니다.
- 전역 프로젝트 간 검색을 사용하지 않습니다.

## CLI `--resume`

### `--resume` (값 없음)

- `main.ts`가 현재 cwd/sessionDir에 대한 세션을 나열하고 선택기를 엽니다.
- 선택된 경로는 세션 생성 전에 `SessionManager.open(selectedPath)`로 열립니다.

### `--resume <value>`

`createSessionManager()` 해결 순서:

1. 값이 경로처럼 보이면 (`/`, `\`, 또는 `.jsonl`) 직접 열기.
2. 그렇지 않으면 ID 접두사로 처리:
   - 현재 범위 검색 (`SessionManager.list(cwd, sessionDir)`)
   - 찾지 못하고 명시적 `sessionDir`이 없으면 전역 검색 (`SessionManager.listAll()`)

프로젝트 간 ID 매치 동작:

- 매칭된 세션 cwd가 현재 cwd와 다르면 CLI가 질문합니다:
  - `Session found in different project ... Fork into current directory? [y/N]`
- 예: `SessionManager.forkFrom(match.path, cwd, sessionDir)`가 새 로컬 포크 파일을 생성합니다.
- 아니오/비TTY 기본값: 명령이 오류로 종료합니다.

## CLI `--continue`

`SessionManager.continueRecent(cwd, sessionDir)`:

1. 현재 cwd에 대한 세션 디렉토리를 해석합니다.
2. 먼저 터미널 범위의 브레드크럼을 읽습니다.
3. 가장 최근 수정된 세션 파일로 폴백합니다.
4. 찾은 세션을 열고; 없으면 새 세션을 생성합니다.

이것은 시작 시에만 동작하며; 대화형 `/continue` 슬래시 명령은 없습니다.

## 세션 전환이 실제로 런타임 상태를 변경하는 방법

`AgentSession.switchSession(sessionPath)`는 재개 류의 작업에서 사용하는 런타임 전환을 수행합니다:

1. `reason: "resume"`과 `targetSessionFile`과 함께 `session_before_switch`를 발행합니다 (취소 가능).
2. 에이전트 이벤트 구독을 해제하고 진행 중인 작업을 중단합니다.
3. 대기 중인 조향/후속/다음 턴 메시지를 클리어합니다.
4. 현재 세션 매니저 쓰기를 플러시합니다.
5. `sessionManager.setSessionFile(sessionPath)`하고 `agent.sessionId`를 업데이트합니다.
6. 로드된 항목에서 세션 컨텍스트를 구성합니다.
7. `reason: "resume"`과 함께 `session_switch`를 발행합니다.
8. 컨텍스트에서 에이전트 메시지를 교체합니다.
9. 모델을 복원합니다 (현재 레지스트리에서 사용 가능한 경우).
10. 사고 수준을 복원하거나 초기화합니다.
11. 에이전트 이벤트 구독을 다시 연결합니다.

`switchSession()` 자체는 새 세션 파일을 생성하지 않습니다.

## 이벤트 발행 및 취소 지점

### 전환/포크 라이프사이클 훅

`newSession`, `fork`, `switchSession`의 경우:

- 전 이벤트: `session_before_switch`
  - 이유: `new`, `fork`, `resume`
  - `{ cancel: true }` 반환으로 취소 가능
- 후 이벤트: `session_switch`
  - 동일한 이유 집합
  - `previousSessionFile` 포함

`ExtensionRunner.emit()`는 첫 번째 취소하는 전 이벤트 결과에서 조기 반환합니다.

### 커스텀 도구 `onSession` 동작

SDK 브릿지가 확장 세션 이벤트를 커스텀 도구 `onSession` 콜백에 전달합니다:

- `session_switch` -> `onSession({ reason: "switch", previousSessionFile })`
- `session_branch` -> `reason: "branch"`
- `session_start` -> `reason: "start"`
- `session_tree` -> `reason: "tree"`
- `session_shutdown` -> `reason: "shutdown"`

이 콜백들은 관찰 목적이며; 전환/포크를 취소하지 않습니다.

### 이 문서와 관련된 기타 취소 지점

- `/fork`는 스트리밍 중에 차단됩니다 (사용자가 현재 응답을 기다리거나 중단해야 합니다).
- `/resume` 선택기는 사용자가 선택기를 닫아 취소할 수 있습니다.
- 프로젝트 간 `--resume <id>`는 포크 프롬프트를 거부하여 취소할 수 있습니다.
- `/share`는 gist 흐름에 대한 UI 중단 경로(`Share cancelled`)가 있습니다; 이 코드 경로에서 `gh gist create`에 대한 프로세스 종료 시맨틱을 연결하지 않습니다.

## 비영구 (인메모리) 세션 동작

세션 매니저가 `SessionManager.inMemory()`(`--no-session`)로 생성된 경우:

- 세션 파일 경로가 없습니다.
- `/export`와 `/share`는 `Cannot export in-memory session to HTML`로 실패합니다 (명령 오류 UI로 전파됨).
- `/fork`는 `SessionManager.fork()`가 영속성을 필요로 하므로 실패합니다.
- `/dump`는 인메모리 에이전트 상태를 직렬화하므로 여전히 작동합니다.
- `--no-session`이 설정되면 CLI 재개/계속 시맨틱이 우회됩니다. 매니저 생성이 즉시 인메모리를 반환하기 때문입니다.

## 알려진 구현 주의사항 (현재 코드 기준)

- `SelectorController.handleResumeSession()`은 `session.switchSession(...)`의 불리언 결과를 확인하지 않습니다; 훅으로 취소된 전환이 여전히 UI "Resumed session" 다시 그리기/상태 경로를 통해 진행될 수 있습니다.
- `/share` 커스텀 공유 실패는 기본 gist 폴백으로 격하되지 않습니다; 오류와 함께 명령을 종료합니다.
- `/export` 인수 토큰화는 단순하며 공백이 포함된 인용 경로를 보존하지 않습니다.
