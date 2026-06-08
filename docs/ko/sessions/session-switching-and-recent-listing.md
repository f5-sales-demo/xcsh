---
title: 세션 전환 및 최근 세션 목록
description: 세션 전환 메커니즘과 검색 및 필터링을 포함한 최근 세션 목록 기능.
sidebar:
  order: 4
  label: 전환 및 최근 세션
i18n:
  sourceHash: aae56130b508
  translator: machine
---

# 세션 전환 및 최근 세션 목록

이 문서는 coding-agent가 최근 세션을 검색하고, `--resume` 대상을 해석하며, 세션 선택기를 표시하고, 활성 런타임 세션을 전환하는 방법을 설명합니다.

폴백 경로와 주의사항을 포함한 현재 구현 동작에 초점을 맞추고 있습니다.

## 구현 파일

- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/cli/session-picker.ts`](../../packages/coding-agent/src/cli/session-picker.ts)
- [`../src/modes/components/session-selector.ts`](../../packages/coding-agent/src/modes/components/session-selector.ts)
- [`../src/modes/controllers/selector-controller.ts`](../../packages/coding-agent/src/modes/controllers/selector-controller.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)

## 최근 세션 검색

### 디렉터리 범위

`SessionManager`는 기본적으로 cwd 범위 디렉터리에 세션을 저장합니다:

- `~/.xcsh/agent/sessions/--<cwd-encoded>--/*.jsonl`

`SessionManager.list(cwd, sessionDir?)`는 명시적인 `sessionDir`이 제공되지 않는 한 해당 디렉터리만 읽습니다.

### 서로 다른 페이로드를 가진 두 가지 목록 파이프라인

두 가지 서로 다른 목록 파이프라인이 있습니다:

1. `getRecentSessions(sessionDir, limit)` (환영/요약 뷰)
   - 각 파일에서 4KB 접두사(`readTextPrefix(..., 4096)`)만 읽습니다.
   - 헤더 + 가장 이른 사용자 텍스트 미리보기를 파싱합니다.
   - 지연 `name` 및 `timeAgo` getter가 포함된 경량 `RecentSessionInfo`를 반환합니다.
   - 파일 `mtime` 내림차순으로 정렬합니다.

2. `SessionManager.list(...)` / `SessionManager.listAll()` (재개 선택기 및 ID 매칭)
   - 전체 세션 파일을 읽습니다.
   - `SessionInfo` 객체(`id`, `cwd`, `title`, `messageCount`, `firstMessage`, `allMessagesText`, 타임스탬프)를 구성합니다.
   - `message` 항목이 0개인 세션은 제외합니다.
   - `modified` 내림차순으로 정렬합니다.

### 메타데이터 폴백 동작

최근 요약(`RecentSessionInfo`)의 경우:

- 표시 이름 우선순위: `header.title` -> 첫 번째 사용자 프롬프트 -> `header.id` -> 파일명
- 이름은 컴팩트 표시를 위해 40자로 잘립니다
- 제어 문자/줄바꿈은 제목 파생 이름에서 제거/정제됩니다

`SessionInfo` 목록 항목의 경우:

- `title`은 `header.title` 또는 최신 압축의 `shortSummary`입니다
- `firstMessage`는 첫 번째 사용자 메시지 텍스트 또는 `"(no messages)"`입니다

## `--continue` 해석 및 터미널 브레드크럼 우선순위

`SessionManager.continueRecent(cwd, sessionDir?)`는 다음 순서로 대상을 해석합니다:

1. 터미널 범위 브레드크럼 읽기 (`~/.xcsh/agent/terminal-sessions/<terminal-id>`)
2. 브레드크럼 유효성 검사:
   - 현재 터미널을 식별할 수 있음
   - 브레드크럼 cwd가 현재 cwd와 일치함 (해석된 경로 비교)
   - 참조된 파일이 여전히 존재함
3. 브레드크럼이 유효하지 않거나 없는 경우, 세션 디렉터리에서 mtime 기준 최신 파일로 폴백 (`findMostRecentSession`)
4. 찾지 못한 경우, 새 세션 생성

터미널 ID 도출은 TTY 경로를 우선하며 환경 기반 식별자(`KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION`)로 폴백합니다.

브레드크럼 기록은 최선 노력(best-effort) 방식이며 실패해도 치명적이지 않습니다.

## 시작 시 재개 대상 해석 (`main.ts`)

### `--resume <value>`

`createSessionManager(...)`는 문자열 값의 `--resume`을 두 가지 모드로 처리합니다:

1. 경로 형태의 값 (`/`, `\\`을 포함하거나 `.jsonl`로 끝나는 경우)
   - 직접 `SessionManager.open(sessionArg, parsed.sessionDir)`

2. ID 접두사 값
   - `SessionManager.list(cwd, sessionDir)`에서 `id.startsWith(sessionArg)`로 일치 항목 찾기
   - 로컬에서 일치하지 않고 `sessionDir`이 강제되지 않은 경우, `SessionManager.listAll()` 시도
   - 첫 번째 일치 항목 사용 (모호성 프롬프트 없음)

프로젝트 간 일치 동작:

- 일치된 세션의 cwd가 현재 cwd와 다른 경우, CLI가 현재 프로젝트로 포크할지 프롬프트 표시
- 예 -> `SessionManager.forkFrom(...)`
- 아니오 -> 오류 발생 (`Session "..." is in another project (...)`)

일치 없음 -> 오류 발생 (`Session "..." not found.`).

### `--resume` (값 없음)

초기 세션 매니저 구성 후 처리됩니다:

1. `SessionManager.list(cwd, parsed.sessionDir)`로 로컬 세션 목록 조회
2. 비어 있는 경우: `No sessions found` 출력 후 조기 종료
3. TUI 선택기 열기 (`selectSession`)
4. 취소된 경우: `No session selected` 출력 후 조기 종료
5. 선택된 경우: `SessionManager.open(selectedPath)`

### `--continue`

`SessionManager.continueRecent(...)`를 직접 사용합니다 (위의 브레드크럼 우선 동작).

## 선택기 기반 선택 내부 구조

## CLI 선택기 (`src/cli/session-picker.ts`)

`selectSession(sessions)`은 `SessionSelectorComponent`로 독립형 TUI를 생성하고 정확히 한 번 해석됩니다:

- 선택 -> 선택된 경로로 해석
- 취소 (Esc) -> `null`로 해석
- 강제 종료 (Ctrl+C 경로) -> TUI 중지 및 `process.exit(0)`

## 대화형 세션 내 선택기 (`SelectorController.showSessionSelector`)

흐름:

1. `SessionManager.list(currentCwd, currentSessionDir)`를 통해 현재 세션 디렉터리에서 세션 가져오기
2. 편집기 영역에 `SessionSelectorComponent`를 `showSelector(...)`를 사용하여 마운트
3. 콜백:
   - 선택 -> 선택기 닫기 및 `handleResumeSession(sessionPath)` 호출
   - 취소 -> 편집기 복원 및 리렌더링
   - 종료 -> `ctx.shutdown()`

## 세션 선택기 컴포넌트 동작

`SessionList`는 다음을 지원합니다:

- 화살표/페이지 탐색
- Enter로 선택
- Esc로 취소
- Ctrl+C로 종료
- 세션 id/title/cwd/첫 번째 메시지/전체 메시지/경로에 대한 퍼지 검색

빈 목록 렌더링 동작:

- 충돌 대신 메시지를 렌더링합니다
- 빈 상태에서 Enter는 아무 작업도 하지 않습니다 (콜백 없음)
- Esc/Ctrl+C는 여전히 작동합니다

주의사항: UI 텍스트에는 `Press Tab to view all`이라고 표시되지만, 이 컴포넌트에는 현재 Tab 핸들러가 없으며 현재 연결은 현재 범위의 세션만 나열합니다.

## 런타임 전환 실행 (`AgentSession.switchSession`)

`switchSession(sessionPath)`는 프로세스 내 핵심 전환 경로입니다.

라이프사이클/상태 전이:

1. `previousSessionFile` 캡처
2. `session_before_switch` 훅 이벤트 발행 (`reason: "resume"`, 취소 가능)
3. 취소된 경우 -> 전환 없이 `false` 반환
4. 현재 에이전트 이벤트 스트림에서 연결 해제
5. 활성 생성/도구 흐름 중단
6. 큐에 대기 중인 조향/후속/다음 턴 메시지 버퍼 정리
7. 세션 작성기 플러시 (`sessionManager.flush()`)하여 보류 중인 쓰기 지속
8. `sessionManager.setSessionFile(sessionPath)`
   - 세션 파일 포인터 업데이트
   - 터미널 브레드크럼 기록
   - 항목 로드 / 마이그레이션 / blob 해석 / 재인덱싱
   - 파일 데이터가 없거나 유효하지 않은 경우: 해당 경로에 새 세션 초기화 및 헤더 재작성
9. `agent.sessionId` 업데이트
10. `buildSessionContext()`를 통한 컨텍스트 재구성
11. `session_switch` 훅 이벤트 발행 (`reason: "resume"`, `previousSessionFile`)
12. 재구성된 컨텍스트로 에이전트 메시지 교체
13. `sessionContext.models.default`가 사용 가능하고 모델 레지스트리에 존재하는 경우 기본 모델 복원
14. 사고 수준 복원:
    - 브랜치에 이미 `thinking_level_change`가 있는 경우, 저장된 세션 수준 적용
    - 그렇지 않으면 설정에서 기본 사고 수준을 도출하고, 모델 능력에 맞게 제한하여 설정한 후 새 `thinking_level_change` 항목 추가
15. 에이전트 리스너 재연결 및 `true` 반환

## 대화형 전환 후 UI 상태 재구성

`SelectorController.handleResumeSession`은 `switchSession` 전후로 UI 초기화를 수행합니다:

- 로딩 애니메이션 중지
- 상태 컨테이너 정리
- 보류 중인 메시지 UI 및 보류 중인 도구 맵 정리
- 스트리밍 컴포넌트/메시지 참조 초기화
- `session.switchSession(...)` 호출
- 채팅 컨테이너 정리 및 세션 컨텍스트에서 리렌더링 (`renderInitialMessages`)
- 새 세션 아티팩트에서 할 일 목록 다시 로드
- `Resumed session` 표시

따라서 표시되는 대화/할 일 상태는 새 세션 파일에서 재구성됩니다.

## 시작 시 재개 vs 세션 내 전환

### 시작 시 재개 (`--continue`, `--resume`, 직접 열기)

- 세션 파일은 `createAgentSession(...)` 이전에 선택됩니다.
- `sdk.ts`가 `existingSession = sessionManager.buildSessionContext()`를 구성합니다.
- 에이전트 메시지는 세션 생성 중 한 번 복원됩니다.
- 모델/사고 수준은 생성 중에 선택됩니다 (복원/폴백 로직 포함).
- 이후 대화형 모드에서 `#restoreModeFromSession()`을 실행하여 지속된 모드 상태를 다시 진입합니다 (현재 plan/plan_paused).

### 세션 내 전환 (`/resume` 스타일 선택기 경로)

- 이미 실행 중인 `AgentSession`에서 `AgentSession.switchSession(...)`을 사용합니다.
- 메시지/모델/사고 수준이 즉시 제자리에서 재구성됩니다.
- 훅 `session_before_switch`/`session_switch` 이벤트가 발행됩니다.
- UI 채팅/할 일이 새로고침됩니다.
- 선택기 흐름에서는 전용 전환 후 모드 복원 호출이 이루어지지 않습니다; 모드 재진입 동작은 시작 시 `#restoreModeFromSession()`과 대칭적이지 않습니다.

## 실패 및 엣지 케이스 동작

### 취소 경로

- CLI 선택기 취소 -> `null` 반환, 호출자가 `No session selected` 출력, 프로세스 조기 종료.
- 대화형 선택기 취소 -> 편집기 복원, 세션 변경 없음.
- 훅 취소 (`session_before_switch`) -> `switchSession()`이 `false` 반환.

### 빈 목록 경로

- CLI `--resume` (값 없음): 빈 목록은 `No sessions found`를 출력하고 종료합니다.
- 대화형 선택기: 빈 목록은 메시지를 렌더링하며 취소 가능한 상태를 유지합니다.

### 대상 세션 파일 누락/유효하지 않음

특정 경로로 열기/전환 시 (`setSessionFile`):

- ENOENT -> 비어 있는 것으로 처리 -> 해당 정확한 경로에 새 세션이 초기화되고 지속됩니다.
- 형식이 잘못되었거나 유효하지 않은 헤더 (또는 실질적으로 읽을 수 없는 파싱된 항목) -> 비어 있는 것으로 처리 -> 새 세션이 초기화되고 지속됩니다.

이는 복구 동작이며, 하드 실패가 아닙니다.

### 하드 실패

전환/열기는 진정한 I/O 실패(권한 오류, 재작성 실패 등)에서 여전히 throw할 수 있으며, 이는 호출자에게 전파됩니다.

### ID 접두사 매칭 주의사항

- ID 매칭은 `startsWith`를 사용하며 정렬된 목록에서 첫 번째 일치 항목을 가져옵니다.
- 여러 세션이 접두사를 공유해도 모호성 UI가 없습니다.
- `SessionManager.list(...)`는 메시지가 0개인 세션을 제외하므로, 해당 세션은 ID 매칭/목록 선택기를 통해 재개할 수 없습니다.
