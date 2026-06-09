---
title: TUI 런타임 내부 구조
description: '렌더링 파이프라인, 입력 처리, 상태 관리를 포함한 터미널 UI 런타임 내부 구조.'
sidebar:
  order: 2
  label: 런타임 내부 구조
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# TUI 런타임 내부 구조

이 문서는 인터랙티브 모드에서 터미널 입력부터 렌더링 출력까지의 비테마 런타임 경로를 설명합니다. `packages/tui`의 동작과 `packages/coding-agent` 컨트롤러에서의 통합에 중점을 둡니다.

## 런타임 계층 및 소유권

- **`packages/tui` 엔진**: 터미널 생명주기, stdin 정규화, 포커스 라우팅, 렌더 스케줄링, 차분 페인팅, 오버레이 합성, 하드웨어 커서 배치.
- **`packages/coding-agent` 인터랙티브 모드**: 컴포넌트 트리 구성, 에디터 콜백 및 키맵 바인딩, 에이전트/세션 이벤트에 대한 반응, 도메인 상태(스트리밍, 도구 실행, 재시도, 플랜 모드)를 UI 컴포넌트로 변환.

경계 규칙: TUI 엔진은 메시지에 무관합니다. `Component.render(width)`, `handleInput(data)`, 포커스, 오버레이만 알고 있습니다. 에이전트 의미론은 인터랙티브 컨트롤러에 남아 있습니다.

## 구현 파일

- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/components/custom-editor.ts`](../../packages/coding-agent/src/modes/components/custom-editor.ts)
- [`../../tui/src/tui.ts`](../../packages/tui/src/tui.ts)
- [`../../tui/src/terminal.ts`](../../packages/tui/src/terminal.ts)
- [`../../tui/src/editor-component.ts`](../../packages/tui/src/editor-component.ts)
- [`../../tui/src/stdin-buffer.ts`](../../packages/tui/src/stdin-buffer.ts)
- [`../../tui/src/components/loader.ts`](../../packages/tui/src/components/loader.ts)

## 부팅 및 컴포넌트 트리 조립

`InteractiveMode`는 `TUI(new ProcessTerminal(), showHardwareCursor)`를 생성하고 영속 컨테이너를 만듭니다:

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (`CustomEditor` 포함)

`init()`는 위 순서대로 트리를 연결하고, 에디터에 포커스를 설정하며, `InputController`를 통해 입력 핸들러를 등록하고, TUI를 시작하고, 강제 렌더를 요청합니다.

강제 렌더(`requestRender(true)`)는 다시 그리기 전에 이전 줄 캐시와 커서 부기를 초기화합니다.

## 터미널 생명주기 및 stdin 정규화

`ProcessTerminal.start()`:

1. raw 모드와 대괄호 붙여넣기(bracketed paste)를 활성화합니다.
2. 리사이즈 핸들러를 연결합니다.
3. 부분적인 이스케이프 청크를 완전한 시퀀스로 분리하기 위해 `StdinBuffer`를 생성합니다.
4. Kitty 키보드 프로토콜 지원 여부를 쿼리하고(`CSI ? u`), 지원되면 프로토콜 플래그를 활성화합니다.
5. Windows에서는 `kernel32` 모드 플래그를 통해 VT 입력 활성화를 시도합니다.

`StdinBuffer` 동작:

- 단편화된 이스케이프 시퀀스(CSI/OSC/DCS/APC/SS3)를 버퍼링합니다.
- 시퀀스가 완료되거나 타임아웃 플러시 시에만 `data`를 방출합니다.
- 대괄호 붙여넣기를 감지하고 원시 붙여넣기 텍스트와 함께 `paste` 이벤트를 방출합니다.

이를 통해 부분적인 이스케이프 청크가 일반 키 입력으로 잘못 해석되는 것을 방지합니다.

## 입력 라우팅 및 포커스 모델

입력 경로:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

라우팅 세부사항:

1. TUI는 등록된 입력 리스너를 먼저 실행하여(`addInputListener`), 소비/변환 동작을 허용합니다.
2. TUI는 컴포넌트 디스패치 전에 전역 디버그 단축키(`shift+ctrl+d`)를 처리합니다.
3. 포커스된 컴포넌트가 이제 숨겨진/비가시 상태인 오버레이에 속하면, TUI는 다음 가시 오버레이나 저장된 오버레이 이전 포커스로 포커스를 재할당합니다.
4. 포커스된 컴포넌트가 `wantsKeyRelease = true`를 설정하지 않는 한 키 릴리스 이벤트는 필터링됩니다.
5. 디스패치 후 TUI는 렌더를 스케줄링합니다.

`setFocus()`는 또한 `Focusable.focused`를 토글하며, 이는 컴포넌트가 하드웨어 커서 배치를 위해 `CURSOR_MARKER`를 방출할지 여부를 제어합니다.

## 키 처리 분리: 에디터 vs 컨트롤러

`CustomEditor`는 높은 우선순위의 조합키를 먼저 가로챕니다(escape, ctrl-c/d/z, ctrl-v, ctrl-p 변형, ctrl-t, alt-up, 확장 사용자 정의 키). 나머지는 기본 `Editor` 동작(텍스트 편집, 히스토리, 자동완성, 커서 이동)에 위임합니다.

`InputController.setupKeyHandlers()`는 에디터 콜백을 모드 액션에 바인딩합니다:

- `Escape`로 취소/모드 종료
- 더블 `Ctrl+C` 또는 빈 에디터에서 `Ctrl+D`로 종료
- `Ctrl+Z`로 일시정지/재개
- 슬래시 명령 및 선택기 단축키
- 후속 작업/큐 해제 토글 및 확장 토글

이를 통해 키 파싱/에디터 메커니즘은 `packages/tui`에, 모드 의미론은 coding-agent 컨트롤러에 유지됩니다.

## 렌더 루프 및 차분 전략

`TUI.requestRender()`는 `process.nextTick`을 사용하여 틱당 하나의 렌더로 디바운싱됩니다. 같은 턴에서의 여러 상태 변경이 합쳐집니다.

`#doRender()` 파이프라인:

1. 루트 컴포넌트 트리를 `newLines`로 렌더링합니다.
2. 가시 오버레이가 있으면 합성합니다.
3. 가시 뷰포트 라인에서 `CURSOR_MARKER`를 추출하고 제거합니다.
4. 비이미지 라인에 세그먼트 리셋 접미사를 추가합니다.
5. 전체 다시 그리기 vs 차분 패치를 선택합니다:
   - 첫 프레임
   - 너비 변경
   - `clearOnShrink`가 활성화되고 오버레이가 없는 상태에서 축소
   - 이전 뷰포트 위의 편집
6. 차분 업데이트의 경우, 변경된 줄 범위만 패치하고 필요 시 오래된 후행 줄을 지웁니다.
7. IME 지원을 위해 하드웨어 커서를 재배치합니다.

렌더 쓰기는 깜빡임/찢어짐을 줄이기 위해 동기화 출력 모드(`CSI ? 2026 h/l`)를 사용합니다.

## 렌더 안전 제약 조건

`TUI`의 중요한 안전 검사:

- 비이미지 렌더링 라인은 터미널 너비를 초과해서는 안 됩니다. 오버플로우 시 예외를 발생시키고 크래시 진단 정보를 기록합니다.
- 오버레이 합성에는 방어적 잘라내기와 합성 후 너비 검증이 포함됩니다.
- 너비 변경 시 줄바꿈 의미론이 변경되므로 전체 다시 그리기를 강제합니다.
- 커서 위치는 이동 전에 클램핑됩니다.

이러한 제약 조건은 단순한 관례가 아니라 런타임 강제사항입니다.

## 리사이즈 처리

리사이즈 이벤트는 `ProcessTerminal`에서 `TUI.requestRender()`로 이벤트 기반으로 전달됩니다.

효과:

- 모든 너비 변경은 전체 다시 그리기를 트리거합니다.
- 뷰포트/상단 추적(`#previousViewportTop`, `#maxLinesRendered`)은 콘텐츠나 터미널 크기가 변경될 때 잘못된 상대 커서 계산을 방지합니다.
- 오버레이 가시성은 터미널 크기에 의존할 수 있으며(`OverlayOptions.visible`), 리사이즈 후 오버레이가 비가시 상태가 되면 포커스가 수정됩니다.

## 스트리밍 및 증분 UI 업데이트

`EventController`는 `AgentSessionEvent`를 구독하고 UI를 증분적으로 업데이트합니다:

- `agent_start`: `statusContainer`에서 로더를 시작합니다.
- `message_start` 어시스턴트: `streamingComponent`를 생성하고 마운트합니다.
- `message_update`: 스트리밍 어시스턴트 콘텐츠를 업데이트합니다. 도구 호출이 나타나면 도구 실행 컴포넌트를 생성/업데이트합니다.
- `tool_execution_update/end`: 도구 결과 컴포넌트와 완료 상태를 업데이트합니다.
- `message_end`: 어시스턴트 스트림을 최종화하고, 중단/오류 주석을 처리하며, 정상 종료 시 보류 중인 도구 인수를 완료로 표시합니다.
- `agent_end`: 로더를 중지하고, 일시적 스트림 상태를 정리하며, 지연된 모델 전환을 플러시하고, 백그라운드 상태이면 완료 알림을 발행합니다.

읽기 도구 그룹화는 의도적으로 상태를 유지하며(`#lastReadGroup`), 비읽기 중단이 발생할 때까지 연속적인 읽기 도구 호출을 하나의 시각적 블록으로 합칩니다.

## 상태 및 로더 오케스트레이션

상태 레인 소유권:

- `statusContainer`는 일시적 로더(`loadingAnimation`, `autoCompactionLoader`, `retryLoader`)를 보유합니다.
- `statusLine`은 영속적 상태/훅/플랜 표시기를 렌더링하고 에디터 상단 테두리 업데이트를 구동합니다.

로더 동작:

- `Loader`는 인터벌을 통해 80ms마다 업데이트하고 각 프레임에서 렌더를 요청합니다.
- 자동 압축 및 자동 재시도 중에는 해당 작업을 취소하기 위해 이스케이프 핸들러가 일시적으로 오버라이드됩니다.
- 종료/취소 경로에서 컨트롤러는 이전 이스케이프 핸들러를 복원하고 로더 컴포넌트를 중지/제거합니다.

## 모드 전환 및 백그라운딩

### Bash/Python 입력 모드

입력 텍스트 접두사가 에디터 테두리 모드 플래그를 토글합니다:

- `!` -> bash 모드
- `$` (비템플릿 리터럴 접두사) -> python 모드

Escape는 에디터 텍스트를 지우고 테두리 색상을 복원하여 비활성 모드를 종료합니다. 실행이 활성 상태일 때는 escape가 대신 실행 중인 태스크를 중단합니다.

### 플랜 모드

`InteractiveMode`는 플랜 모드 플래그, 상태 라인 상태, 활성 도구, 모델 전환을 추적합니다. 진입/종료 시 세션 모드 항목과 상태/UI 상태를 업데이트하며, 스트리밍이 활성 상태이면 지연된 모델 전환을 포함합니다.

### 일시정지/재개 (`Ctrl+Z`)

`InputController.handleCtrlZ()`:

1. TUI를 재시작하고 강제 렌더를 수행하는 일회성 `SIGCONT` 핸들러를 등록합니다.
2. 일시정지 전에 TUI를 중지합니다.
3. 프로세스 그룹에 `SIGTSTP`를 보냅니다.

### 백그라운드 모드 (`/background` 또는 `/bg`)

`handleBackgroundCommand()`:

- 유휴 상태일 때 거부합니다.
- 도구 UI 컨텍스트를 비인터랙티브(`hasUI=false`)로 전환하여 인터랙티브 UI 도구가 빠르게 실패하도록 합니다.
- 로더/상태 라인을 중지하고 포그라운드 이벤트 핸들러 구독을 해제합니다.
- 백그라운드 이벤트 핸들러를 구독합니다(주로 `agent_end`를 대기).
- TUI를 중지하고 `SIGTSTP`를 보냅니다(POSIX 작업 제어 경로).

큐에 대기 중인 작업 없이 백그라운드에서 `agent_end`가 발생하면, 컨트롤러는 완료 알림을 보내고 종료합니다.

## 취소 경로

주요 취소 입력:

- 활성 스트림 로더 중 `Escape`: 큐에 대기 중인 메시지를 에디터로 복원하고 에이전트를 중단합니다.
- bash/python 실행 중 `Escape`: 실행 중인 명령을 중단합니다.
- 자동 압축/재시도 중 `Escape`: 임시 이스케이프 핸들러를 통해 전용 중단 메서드를 호출합니다.
- `Ctrl+C` 한 번 누름: 에디터 지우기; 500ms 내 두 번 누름: 종료.

취소는 상태 조건부입니다. 런타임 상태에 따라 같은 키가 중단, 모드 종료, 선택기 트리거 또는 무동작을 의미할 수 있습니다.

## 이벤트 기반 vs 스로틀 동작

이벤트 기반 업데이트:

- 에이전트 세션 이벤트 (`EventController`)
- 키 입력 콜백 (`InputController`)
- 터미널 리사이즈 콜백
- `InteractiveMode`의 테마/브랜치 감시자

스로틀/디바운스 경로:

- TUI 렌더링은 틱 디바운싱됩니다(`requestRender` 합치기).
- 로더 애니메이션은 고정 인터벌(80ms)이며, 각 프레임이 렌더를 요청합니다.
- 에디터 자동완성 업데이트(`Editor` 내부)는 디바운스 타이머를 사용하여 타이핑 중 재계산 부하를 줄입니다.

따라서 런타임은 이벤트 기반 상태 전환과 제한된 렌더 케이던스를 혼합하여 다시 그리기 폭주 없이 인터랙티브 반응성을 유지합니다.
