---
title: TTSR 주입 생명주기
description: '컨텍스트 관리를 위한 TTSR (tool-use, tool-result, system-reminder) 주입 생명주기.'
sidebar:
  order: 9
  label: TTSR 주입
i18n:
  sourceHash: d6179a286584
  translator: machine
---

# TTSR 주입 생명주기

이 문서는 규칙 발견부터 스트림 중단, 재시도 주입, 확장 알림, 세션 상태 처리에 이르기까지 현재의 Time Traveling Stream Rules (TTSR) 런타임 경로를 다룹니다.

## 구현 파일

- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/export/ttsr.ts`](../../packages/coding-agent/src/export/ttsr.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/prompts/system/ttsr-interrupt.md`](../../packages/coding-agent/src/prompts/system/ttsr-interrupt.md)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/types.ts`](../../packages/coding-agent/src/extensibility/extensions/types.ts)
- [`../src/extensibility/hooks/types.ts`](../../packages/coding-agent/src/extensibility/hooks/types.ts)
- [`../src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)

## 1. 발견 피드 및 규칙 등록

세션 생성 시 `createAgentSession()`은 발견된 모든 규칙을 로드하고 `TtsrManager`를 구성합니다:

```ts
const ttsrSettings = settings.getGroup("ttsr");
const ttsrManager = new TtsrManager(ttsrSettings);
const rulesResult = await loadCapability<Rule>(ruleCapability.id, { cwd });
for (const rule of rulesResult.items) {
  if (rule.ttsrTrigger) ttsrManager.addRule(rule);
}
```

### 사전 등록 중복 제거 동작

`loadCapability("rules")`는 `rule.name`을 기준으로 선착순 의미론(우선순위가 높은 프로바이더 우선)을 적용하여 중복을 제거합니다. 가려진 중복 항목은 TTSR 등록 전에 제거됩니다.

### `TtsrManager.addRule()` 동작

다음의 경우 등록이 건너뛰어집니다:

- `rule.ttsrTrigger`가 없는 경우
- 동일한 `rule.name`을 가진 규칙이 이미 이 매니저에 등록되어 있는 경우
- 정규식 컴파일이 실패하는 경우(`new RegExp(rule.ttsrTrigger)`가 throw하는 경우)

유효하지 않은 정규식 트리거는 경고로 로그에 기록되고 무시됩니다; 세션 시작은 계속됩니다.

### 설정 주의사항

`TtsrSettings.enabled`는 매니저에 로드되지만 현재 런타임 게이팅에서는 확인되지 않습니다. 규칙이 존재하면 매칭은 여전히 실행됩니다.

## 2. 스트리밍 모니터 생명주기

TTSR 감지는 `AgentSession.#handleAgentEvent` 내부에서 실행됩니다.

### 턴 시작

`turn_start` 시 스트림 버퍼가 초기화됩니다:

- `ttsrManager.resetBuffer()`

### 스트림 진행 중 (`message_update`)

어시스턴트 업데이트가 도착하고 규칙이 존재하는 경우:

- `text_delta` 및 `toolcall_delta` 모니터링
- 매니저 버퍼에 델타 추가
- `check(buffer)` 호출

`check()`는 등록된 규칙을 반복하며 반복 정책(`#canTrigger`)을 통과하는 모든 매칭 규칙을 반환합니다.

## 3. 트리거 결정 및 즉시 중단 경로

하나 이상의 규칙이 매칭되면:

1. `markInjected(matches)`가 매니저 주입 상태에 규칙 이름을 기록합니다.
2. 매칭된 규칙이 `#pendingTtsrInjections`에 대기열에 추가됩니다.
3. `#ttsrAbortPending = true`로 설정됩니다.
4. `agent.abort()`가 즉시 호출됩니다.
5. `ttsr_triggered` 이벤트가 비동기적으로 발행됩니다(fire-and-forget).
6. 재시도 작업이 `setTimeout(..., 50)`을 통해 스케줄링됩니다.

중단은 확장 콜백에 의해 차단되지 않습니다.

## 4. 재시도 스케줄링, 컨텍스트 모드, 리마인더 주입

50ms 타임아웃 이후:

1. `#ttsrAbortPending = false`
2. `ttsrManager.getSettings().contextMode` 읽기
3. `contextMode === "discard"`인 경우, `agent.popMessage()`로 부분 어시스턴트 출력을 삭제
4. `ttsr-interrupt.md` 템플릿을 사용하여 대기 중인 규칙으로부터 주입 콘텐츠 빌드
5. 규칙당 하나의 `<system-interrupt ...>` 블록을 포함하는 합성 사용자 메시지 추가
6. `agent.continue()`를 호출하여 생성 재시도

템플릿 페이로드는 다음과 같습니다:

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

대기 중인 주입은 콘텐츠 생성 후 정리됩니다.

### 부분 출력에 대한 `contextMode` 동작

- `discard`: 부분/중단된 어시스턴트 메시지가 재시도 전에 제거됩니다.
- `keep`: 부분 어시스턴트 출력이 대화 상태에 남아 있으며; 리마인더가 그 뒤에 추가됩니다.

## 5. 반복 정책 및 간격 로직

`TtsrManager`는 `#messageCount`와 규칙별 `lastInjectedAt`을 추적합니다.

### `repeatMode: "once"`

규칙은 주입 기록이 있으면 한 번만 트리거될 수 있습니다.

### `repeatMode: "after-gap"`

규칙은 다음 조건이 충족될 때만 재트리거될 수 있습니다:

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount`는 `turn_end`에서 증가하므로, 간격은 스트림 청크가 아닌 완료된 턴 단위로 측정됩니다.

## 6. 이벤트 발행 및 확장/훅 표면

### 세션 이벤트

`AgentSessionEvent`는 다음을 포함합니다:

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### 확장 러너

`#emitSessionEvent()`는 이벤트를 다음으로 라우팅합니다:

- 확장 리스너 (`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`)
- 로컬 세션 구독자

### 훅 및 커스텀 도구 타이핑

- 확장 API는 `on("ttsr_triggered", ...)`을 노출합니다
- 훅 API는 `on("ttsr_triggered", ...)`을 노출합니다
- 커스텀 도구는 `onSession({ reason: "ttsr_triggered", rules })`을 수신합니다

### 인터랙티브 모드 렌더링 차이

인터랙티브 모드는 `session.isTtsrAbortPending`을 사용하여 TTSR 중단 중에 중단된 어시스턴트 중지 사유가 가시적인 실패로 표시되는 것을 억제하며, 이벤트가 도착하면 `TtsrNotificationComponent`를 렌더링합니다.

## 7. 영속성 및 재개 상태 (현재 구현)

`SessionManager`는 주입된 규칙 영속성을 위한 전체 스키마를 지원합니다:

- 항목 유형: `ttsr_injection`
- 추가 API: `appendTtsrInjection(ruleNames)`
- 쿼리 API: `getInjectedTtsrRules()`
- 컨텍스트 재구성은 `SessionContext.injectedTtsrRules`를 포함합니다

`TtsrManager`도 `restoreInjected(ruleNames)`를 통한 복원을 지원합니다.

### 현재 연결 상태

현재 런타임 경로에서:

- `AgentSession`은 TTSR이 트리거될 때 `ttsr_injection` 항목을 추가하지 않습니다.
- `createAgentSession()`은 `existingSession.injectedTtsrRules`를 `ttsrManager`로 다시 복원하지 않습니다.

순 효과: 주입된 규칙 억제는 실행 중인 프로세스의 메모리 내에서 적용되지만, 이 경로를 통한 세션 리로드/재개 간에는 현재 영속화/복원되지 않습니다.

## 8. 경합 경계 및 순서 보장

### 중단 vs 재시도 콜백

- 중단은 TTSR 핸들러 관점에서 동기적입니다 (`agent.abort()`가 즉시 호출됨)
- 재시도는 타이머에 의해 지연됩니다 (`50ms`)
- 확장 알림은 비동기적이며 중단/재시도 스케줄링 전에 의도적으로 대기하지 않습니다

### 동일 스트림 윈도우 내 다중 매칭

`check()`는 현재 매칭되는 모든 적격 규칙을 반환합니다. 이들은 다음 재시도 메시지에서 일괄로 주입됩니다.

### 중단과 계속 사이

타이머 윈도우 동안 상태가 변경될 수 있습니다(사용자 중단, 모드 액션, 추가 이벤트). 재시도 호출은 최선의 노력으로 수행됩니다: `agent.continue().catch(() => {})`가 후속 오류를 삼킵니다.

## 9. 엣지 케이스 요약

- 유효하지 않은 `ttsr_trigger` 정규식: 경고와 함께 건너뛰어지며; 다른 규칙은 계속됩니다.
- 기능 레이어에서의 중복 규칙 이름: 낮은 우선순위의 중복은 등록 전에 가려집니다.
- 매니저 레이어에서의 중복 이름: 두 번째 등록은 무시됩니다.
- `contextMode: "keep"`: 부분적으로 위반한 출력이 리마인더 재시도 전에 컨텍스트에 남아 있을 수 있습니다.
- 간격 후 반복(repeat-after-gap)은 `turn_end`에서의 턴 카운트 증가에 의존합니다; 턴 중간 청크는 간격 카운터를 진행시키지 않습니다.
