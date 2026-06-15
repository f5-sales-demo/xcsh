---
title: 핸드오프 생성 파이프라인
description: 팀 협업을 위한 이식 가능한 세션 요약 생성을 위한 핸드오프 생성 파이프라인.
sidebar:
  order: 8
  label: 핸드오프 파이프라인
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# `/handoff` 생성 파이프라인

이 문서는 코딩 에이전트가 현재 `/handoff`를 구현하는 방식, 즉 트리거 경로, 생성 프롬프트, 완료 캡처, 세션 전환, 컨텍스트 재주입에 대해 설명합니다.

## 범위

다루는 내용:

- 인터랙티브 `/handoff` 명령 디스패치
- `AgentSession.handoff()` 라이프사이클 및 상태 전환
- 어시스턴트 출력에서 핸드오프 출력이 캡처되는 방식
- 구/신 세션이 핸드오프 데이터를 다르게 유지하는 방식
- 성공, 취소, 실패 시 UI 동작

다루지 않는 내용:

- 일반적인 트리 탐색/브랜치 내부 구조
- 핸드오프가 아닌 세션 명령(`/new`, `/fork`, `/resume`)

## 구현 파일

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## 트리거 경로

1. `/handoff`는 빌트인 슬래시 명령 메타데이터(`slash-commands.ts`)에서 선택적 인라인 힌트 `[focus instructions]`와 함께 선언됩니다.
2. 인터랙티브 입력 처리(`InputController`)에서 `/handoff` 또는 `/handoff ...`와 일치하는 제출 텍스트는 일반 프롬프트 제출 전에 가로채집니다.
3. 에디터가 초기화되고 `handleHandoffCommand(customInstructions?)`가 호출됩니다.
4. `CommandController.handleHandoffCommand`는 현재 항목을 사용하여 사전 점검 가드를 수행합니다:
   - `type === "message"` 항목 수를 셉니다.
   - 개수가 `< 2`이면, `Nothing to hand off (no messages yet)` 경고를 표시하고 반환합니다.

동일한 최소 콘텐츠 가드가 `AgentSession.handoff()` 내부에도 존재하며, 위반 시 예외를 발생시킵니다. 이는 UI와 세션 레이어 양쪽에서 안전성을 중복으로 보장합니다.

## 엔드투엔드 라이프사이클

### 1) 핸드오프 생성 시작

`AgentSession.handoff(customInstructions?)`:

- 현재 브랜치 항목 읽기(`sessionManager.getBranch()`)
- 최소 메시지 수 유효성 검사(`>= 2`)
- `#handoffAbortController` 생성
- 구조화된 핸드오프 문서(`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)를 요청하는 고정된 인라인 프롬프트 작성
- 커스텀 지시가 제공된 경우 `Additional focus: ...` 추가

프롬프트는 다음을 통해 전송됩니다:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false`는 이 내부 지시 페이로드에 대한 슬래시/프롬프트 템플릿 확장을 방지합니다.

### 2) 완료 캡처

프롬프트 전송 전에 `handoff()`는 세션 이벤트를 구독하고 `agent_end`를 기다립니다.

`agent_end` 시, 가장 최근 `assistant` 메시지를 역방향으로 스캔하여 에이전트 상태에서 핸드오프 텍스트를 추출한 후, `type === "text"`인 모든 `content` 블록을 `\n`으로 연결합니다.

중요한 추출 가정:

- 텍스트 블록만 사용됩니다; 비텍스트 콘텐츠는 무시됩니다.
- 최신 어시스턴트 메시지가 핸드오프 생성에 해당한다고 가정합니다.
- 마크다운 섹션을 파싱하거나 형식 준수 여부를 검증하지 않습니다.
- 어시스턴트 출력에 텍스트 블록이 없으면 핸드오프가 누락된 것으로 처리됩니다.

### 3) 취소 확인

다음 조건 중 하나라도 충족되면 `handoff()`는 `undefined`를 반환합니다:

- 캡처된 핸드오프 텍스트가 없거나,
- `#handoffAbortController.signal.aborted`가 true인 경우

`finally`에서 항상 `#handoffAbortController`를 초기화합니다.

### 4) 새 세션 생성

텍스트가 캡처되었고 중단되지 않은 경우:

1. 현재 세션 작성자 플러시(`sessionManager.flush()`)
2. 새 세션 시작(`sessionManager.newSession()`)
3. 인메모리 에이전트 상태 초기화(`agent.reset()`)
4. `agent.sessionId`를 새 세션 id에 재바인딩
5. 큐에 쌓인 컨텍스트 배열 초기화(`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. 할 일 리마인더 카운터 초기화

`newSession()`은 새 헤더와 빈 항목 목록을 생성합니다(리프는 `null`로 초기화). 핸드오프 경로에서는 `parentSession`이 전달되지 않습니다.

### 5) 핸드오프 컨텍스트 주입

생성된 핸드오프 문서는 래핑되어 새 세션에 `custom_message` 항목으로 추가됩니다:

```text
<handoff-context>
...handoff text...
</handoff-context>

The above is a handoff document from a previous session. Use this context to continue the work seamlessly.
```

삽입 호출:

```ts
this.sessionManager.appendCustomMessageEntry("handoff", handoffContent, true);
```

의미론:

- `customType`: `"handoff"`
- `display`: `true` (TUI 재빌드 시 표시됨)
- 항목 유형: `custom_message` (LLM 컨텍스트에 참여)

### 6) 활성 에이전트 컨텍스트 재빌드

주입 후:

1. `sessionManager.buildSessionContext()`가 현재 리프에 대한 메시지 목록을 해석
2. `agent.replaceMessages(sessionContext.messages)`가 주입된 핸드오프 메시지를 활성 컨텍스트로 설정
3. 메서드가 `{ document: handoffText }` 반환

이 시점에서 새 세션의 활성 LLM 컨텍스트에는 이전 트랜스크립트가 아닌 주입된 핸드오프 메시지가 포함됩니다.

## 지속성 모델: 이전 세션 vs 새 세션

### 이전 세션

생성 중에는 일반 메시지 지속성이 활성 상태로 유지됩니다. 어시스턴트 핸드오프 응답은 `message_end` 시 일반 `message` 항목으로 유지됩니다.

결과: 원본 세션에는 생성된 핸드오프가 기록 트랜스크립트의 일부로 표시됩니다.

### 새 세션

세션 재설정 후, 핸드오프는 `customType: "handoff"`를 가진 `custom_message`로 유지됩니다.

`buildSessionContext()`는 이 항목을 `createCustomMessage(...)`를 통해 런타임 커스텀/사용자 컨텍스트 메시지로 변환하므로, 새 세션의 향후 프롬프트에 포함됩니다.

## 컨트롤러/UI 동작

`CommandController.handleHandoffCommand` 동작:

- `await session.handoff(customInstructions)` 호출
- 결과가 `undefined`인 경우: `showError("Handoff cancelled")`
- 성공 시:
  - `rebuildChatFromMessages()` (주입된 핸드오프를 포함한 새 세션 컨텍스트 로드)
  - 상태 표시줄 및 에디터 상단 테두리 무효화
  - 할 일 항목 재로드
  - 성공 채팅 라인 추가: `New session started with handoff context`
- 예외 발생 시:
  - 메시지가 `"Handoff cancelled"`이거나 오류 이름이 `AbortError`인 경우: `showError("Handoff cancelled")`
  - 그 외: `showError("Handoff failed: <message>")`
- 마지막에 렌더링 요청

## 취소 의미론 (현재 동작)

### 세션 수준 취소 기본 요소

`AgentSession`이 노출하는 것:

- `abortHandoff()` → `#handoffAbortController` 중단
- `isGeneratingHandoff` → 컨트롤러가 존재하는 동안 true

이 중단 경로가 사용되면, 핸드오프 구독자는 `Error("Handoff cancelled")`로 거부하고, 명령 컨트롤러는 이를 취소 UI에 매핑합니다.

### 인터랙티브 `/handoff` 경로 제한

현재 인터랙티브 컨트롤러 배선에서, `/handoff`는 `abortHandoff()`를 호출하는 전용 Escape 핸들러를 설치하지 않습니다(일시적으로 `editor.onEscape`를 재정의하는 압축/브랜치 요약 경로와는 달리).

실질적인 영향:

- 세션 수준 취소 지원은 있지만, `/handoff` 명령 경로에는 핸드오프 전용 키바인딩 훅이 없습니다.
- 더 광범위한 에이전트 중단 경로를 통해 사용자 중단이 발생할 수 있지만, 이는 `abortHandoff()`가 사용하는 명시적 취소 채널과 동일하지 않습니다.

## 중단됨 vs 실패한 핸드오프

현재 UI 분류:

- **중단됨/취소됨**
  - `abortHandoff()` 경로가 `"Handoff cancelled"`를 트리거하거나,
  - `AbortError` 발생
  - UI에 `Handoff cancelled` 표시

- **실패**
  - `handoff()` / 프롬프트 파이프라인에서 발생한 다른 오류 (모델/API 유효성 검사 오류, 런타임 예외 등)
  - UI에 `Handoff failed: ...` 표시

추가 세부 사항: 생성이 완료되었지만 텍스트가 추출되지 않은 경우, `handoff()`는 `undefined`를 반환하고 컨트롤러는 현재 **실패**가 아닌 **취소됨**으로 보고합니다.

## 짧은 세션 및 최소 콘텐츠 가드레일

두 가지 가드가 저신호 핸드오프를 방지합니다:

- UI 레이어(`handleHandoffCommand`): `< 2` 메시지 항목에 대해 경고하고 조기 반환
- 세션 레이어(`handoff()`): 동일한 조건을 오류로 발생

이는 빈/거의 빈 핸드오프 컨텍스트로 새 세션이 생성되는 것을 방지합니다.

## 상태 전환 요약

고수준 상태 흐름:

1. 인터랙티브 슬래시 명령 가로채기
2. 사전 점검 메시지 수 가드
3. `#handoffAbortController` 생성(`isGeneratingHandoff = true`)
4. 내부 핸드오프 프롬프트 제출(일반 어시스턴트 생성으로 채팅에 표시)
5. `agent_end` 시 마지막 어시스턴트 텍스트 추출
6. 누락/중단된 경우 → `undefined` 반환 또는 취소 오류 경로
7. 존재하는 경우:
   - 이전 세션 플러시
   - 새 빈 세션 생성
   - 런타임 큐/카운터 초기화
   - `custom_message(handoff)` 추가
   - 활성 에이전트 메시지 재빌드 및 교체
8. 컨트롤러가 채팅 UI를 재빌드하고 성공 알림
9. `#handoffAbortController` 초기화(`isGeneratingHandoff = false`)

## 알려진 가정 및 제한 사항

- 핸드오프 추출은 휴리스틱 방식입니다: "마지막 어시스턴트 텍스트 블록"; 구조적 유효성 검사 없음.
- 생성된 마크다운이 요청된 섹션 형식을 따르는지에 대한 엄격한 검사가 없습니다.
- 추출된 텍스트가 없는 경우 컨트롤러 UX에서 취소로 보고됩니다.
- `/handoff` 인터랙티브 흐름에는 현재 전용 Escape→`abortHandoff()` 바인딩이 없습니다.
- 새 세션 계보 메타데이터(`parentSession`)는 이 경로에서 설정되지 않습니다.
