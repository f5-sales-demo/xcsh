---
title: Handoff Generation Pipeline
description: >-
  Handoff generation pipeline for creating portable session summaries for team
  collaboration.
sidebar:
  order: 8
  label: Handoff pipeline
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# `/handoff` 생성 파이프라인

이 문서는 coding-agent가 현재 `/handoff`를 어떻게 구현하는지 설명합니다: 트리거 경로, 생성 프롬프트, 완료 캡처, 세션 전환 및 컨텍스트 재주입.

## 범위

다루는 내용:

- 대화형 `/handoff` 명령 디스패치
- `AgentSession.handoff()` 라이프사이클 및 상태 전환
- 어시스턴트 출력에서 handoff 출력이 캡처되는 방식
- 이전/새 세션이 handoff 데이터를 다르게 유지하는 방식
- 성공, 취소 및 실패에 대한 UI 동작

다루지 않는 내용:

- 일반적인 트리 탐색/브랜치 내부 구조
- handoff가 아닌 세션 명령 (`/new`, `/fork`, `/resume`)

## 구현 파일

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## 트리거 경로

1. `/handoff`는 내장 슬래시 명령 메타데이터(`slash-commands.ts`)에 선택적 인라인 힌트 `[focus instructions]`와 함께 선언됩니다.
2. 대화형 입력 처리(`InputController`)에서 `/handoff` 또는 `/handoff ...`와 일치하는 제출 텍스트는 일반 프롬프트 제출 전에 가로채집니다.
3. 에디터가 지워지고 `handleHandoffCommand(customInstructions?)`가 호출됩니다.
4. `CommandController.handleHandoffCommand`는 현재 엔트리를 사용하여 사전 검증을 수행합니다:
   - `type === "message"` 엔트리 수를 셉니다.
   - `< 2`이면 경고를 표시합니다: `Nothing to hand off (no messages yet)` 그리고 반환합니다.

동일한 최소 콘텐츠 가드가 `AgentSession.handoff()` 내부에도 존재하며, 위반 시 예외를 던집니다. 이는 UI와 세션 레이어 양쪽에서 안전성을 이중으로 보장합니다.

## 엔드투엔드 라이프사이클

### 1) Handoff 생성 시작

`AgentSession.handoff(customInstructions?)`:

- 현재 브랜치 엔트리를 읽습니다 (`sessionManager.getBranch()`)
- 최소 메시지 수를 검증합니다 (`>= 2`)
- `#handoffAbortController`를 생성합니다
- 구조화된 handoff 문서를 요청하는 고정된 인라인 프롬프트를 구성합니다 (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- 사용자 지정 지침이 제공된 경우 `Additional focus: ...`를 추가합니다

프롬프트는 다음을 통해 전송됩니다:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false`는 이 내부 지침 페이로드에 대한 슬래시/프롬프트 템플릿 확장을 방지합니다.

### 2) 완료 캡처

프롬프트를 전송하기 전에, `handoff()`는 세션 이벤트를 구독하고 `agent_end`를 기다립니다.

`agent_end` 시, 가장 최근의 `assistant` 메시지를 찾기 위해 에이전트 상태를 역방향으로 스캔하여 handoff 텍스트를 추출한 다음, `type === "text"`인 모든 `content` 블록을 `\n`으로 연결합니다.

중요한 추출 가정:

- 텍스트 블록만 사용됩니다; 비텍스트 콘텐츠는 무시됩니다.
- 최신 어시스턴트 메시지가 handoff 생성에 해당한다고 가정합니다.
- 마크다운 섹션을 파싱하거나 형식 준수를 검증하지 않습니다.
- 어시스턴트 출력에 텍스트 블록이 없는 경우, handoff는 누락된 것으로 처리됩니다.

### 3) 취소 확인

`handoff()`는 다음 조건 중 하나가 참일 때 `undefined`를 반환합니다:

- 캡처된 handoff 텍스트가 없거나,
- `#handoffAbortController.signal.aborted`가 true인 경우

`finally`에서 항상 `#handoffAbortController`를 정리합니다.

### 4) 새 세션 생성

텍스트가 캡처되고 중단되지 않은 경우:

1. 현재 세션 작성기를 플러시합니다 (`sessionManager.flush()`)
2. 새로운 세션을 시작합니다 (`sessionManager.newSession()`)
3. 인메모리 에이전트 상태를 리셋합니다 (`agent.reset()`)
4. `agent.sessionId`를 새 세션 id에 재바인딩합니다
5. 대기 중인 컨텍스트 배열을 비웁니다 (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. 할 일 리마인더 카운터를 리셋합니다

`newSession()`은 새로운 헤더와 빈 엔트리 목록(leaf가 `null`로 리셋)을 생성합니다. handoff 경로에서는 `parentSession`이 전달되지 않습니다.

### 5) Handoff 컨텍스트 주입

생성된 handoff 문서는 래핑되어 새 세션에 `custom_message` 엔트리로 추가됩니다:

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

의미:

- `customType`: `"handoff"`
- `display`: `true` (TUI 재구성 시 표시됨)
- 엔트리 타입: `custom_message` (LLM 컨텍스트에 참여)

### 6) 활성 에이전트 컨텍스트 재구성

주입 후:

1. `sessionManager.buildSessionContext()`가 현재 leaf에 대한 메시지 목록을 해석합니다
2. `agent.replaceMessages(sessionContext.messages)`가 주입된 handoff 메시지를 활성 컨텍스트로 만듭니다
3. 메서드가 `{ document: handoffText }`를 반환합니다

이 시점에서 새 세션의 활성 LLM 컨텍스트에는 이전 트랜스크립트가 아닌 주입된 handoff 메시지가 포함되어 있습니다.

## 영속성 모델: 이전 세션 vs 새 세션

### 이전 세션

생성 중에는 일반 메시지 영속성이 활성 상태로 유지됩니다. 어시스턴트의 handoff 응답은 `message_end` 시 일반 `message` 엔트리로 유지됩니다.

결과: 원래 세션에는 생성된 handoff가 과거 트랜스크립트의 일부로 표시된 상태로 포함됩니다.

### 새 세션

세션 리셋 후, handoff는 `customType: "handoff"`인 `custom_message`로 유지됩니다.

`buildSessionContext()`는 이 엔트리를 `createCustomMessage(...)`를 통해 런타임 사용자 정의/사용자 컨텍스트 메시지로 변환하므로, 새 세션의 이후 프롬프트에 포함됩니다.

## 컨트롤러/UI 동작

`CommandController.handleHandoffCommand` 동작:

- `await session.handoff(customInstructions)` 호출
- 결과가 `undefined`인 경우: `showError("Handoff cancelled")`
- 성공 시:
  - `rebuildChatFromMessages()` (주입된 handoff를 포함한 새 세션 컨텍스트를 로드)
  - 상태 줄과 에디터 상단 테두리를 무효화
  - 할 일 목록을 다시 로드
  - 성공 채팅 라인을 추가: `New session started with handoff context`
- 예외 발생 시:
  - 메시지가 `"Handoff cancelled"`이거나 에러 이름이 `AbortError`인 경우: `showError("Handoff cancelled")`
  - 그 외: `showError("Handoff failed: <message>")`
- 종료 시 렌더링을 요청

## 취소 의미론 (현재 동작)

### 세션 수준 취소 기본 요소

`AgentSession`은 다음을 노출합니다:

- `abortHandoff()` → `#handoffAbortController`를 중단
- `isGeneratingHandoff` → 컨트롤러가 존재하는 동안 true

이 중단 경로가 사용되면, handoff 구독자가 `Error("Handoff cancelled")`로 거부하고, 명령 컨트롤러가 이를 취소 UI로 매핑합니다.

### 대화형 `/handoff` 경로 제한사항

현재 대화형 컨트롤러 연결에서 `/handoff`는 `abortHandoff()`를 호출하는 전용 Escape 핸들러를 설치하지 않습니다 (임시로 `editor.onEscape`를 재정의하는 압축/브랜치 요약 경로와 달리).

실제 영향:

- 세션 수준 취소 지원은 있지만, `/handoff` 명령 경로에는 handoff 전용 키바인딩 훅이 없습니다.
- 사용자 인터럽트는 더 넓은 에이전트 중단 경로를 통해 여전히 발생할 수 있지만, 이는 `abortHandoff()`가 사용하는 것과 동일한 명시적 취소 채널이 아닙니다.

## 중단 vs 실패 handoff

현재 UI 분류:

- **중단/취소**
  - `abortHandoff()` 경로가 `"Handoff cancelled"`를 트리거하거나,
  - `AbortError`가 던져진 경우
  - UI에 `Handoff cancelled`가 표시됨

- **실패**
  - `handoff()` / 프롬프트 파이프라인에서 던져진 다른 모든 에러 (모델/API 유효성 검사 에러, 런타임 예외 등)
  - UI에 `Handoff failed: ...`가 표시됨

추가 뉘앙스: 생성은 완료되었지만 텍스트가 추출되지 않은 경우, `handoff()`는 `undefined`를 반환하고 컨트롤러는 현재 **실패**가 아닌 **취소**로 보고합니다.

## 짧은 세션 및 최소 콘텐츠 가드

두 개의 가드가 낮은 신호의 handoff를 방지합니다:

- UI 레이어 (`handleHandoffCommand`): 메시지 엔트리가 `< 2`이면 경고하고 조기 반환
- 세션 레이어 (`handoff()`): 동일한 조건을 에러로 던짐

이는 비어있거나 거의 비어있는 handoff 컨텍스트로 새 세션이 생성되는 것을 방지합니다.

## 상태 전환 요약

고수준 상태 흐름:

1. 대화형 슬래시 명령이 가로채짐
2. 사전 메시지 수 검증
3. `#handoffAbortController` 생성 (`isGeneratingHandoff = true`)
4. 내부 handoff 프롬프트 제출 (채팅에서 일반 어시스턴트 생성으로 표시)
5. `agent_end` 시, 마지막 어시스턴트 텍스트 추출
6. 누락/중단인 경우 → `undefined` 반환 또는 취소 에러 경로
7. 존재하는 경우:
   - 이전 세션 플러시
   - 새로운 빈 세션 생성
   - 런타임 큐/카운터 리셋
   - `custom_message(handoff)` 추가
   - 활성 에이전트 메시지 재구성 및 교체
8. 컨트롤러가 채팅 UI를 재구성하고 성공을 알림
9. `#handoffAbortController` 정리 (`isGeneratingHandoff = false`)

## 알려진 가정 및 제한사항

- Handoff 추출은 휴리스틱입니다: "마지막 어시스턴트 텍스트 블록"; 구조적 검증이 없습니다.
- 생성된 마크다운이 요청된 섹션 형식을 따르는지에 대한 엄격한 확인이 없습니다.
- 추출된 텍스트가 없는 경우 컨트롤러 UX에서 취소로 보고됩니다.
- `/handoff` 대화형 흐름에는 현재 전용 Escape→`abortHandoff()` 바인딩이 없습니다.
- 새 세션 계보 메타데이터(`parentSession`)는 이 경로에서 설정되지 않습니다.
