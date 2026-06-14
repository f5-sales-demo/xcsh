---
title: 프로바이더 스트리밍 내부 구조
description: 'SSE 파싱, 토큰 카운팅, 백프레셔 처리를 포함한 프로바이더 스트리밍 구현.'
sidebar:
  order: 2
  label: 스트리밍 내부 구조
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# 프로바이더 스트리밍 내부 구조

이 문서는 `@f5xc-salesdemos/pi-ai`에서 토큰/도구 스트리밍이 정규화되는 방식과, 이후 `@f5xc-salesdemos/pi-agent-core` 및 `coding-agent` 세션 이벤트를 통해 전파되는 방식을 설명합니다.

## 엔드투엔드 흐름

1. `streamSimple()` (`packages/ai/src/stream.ts`)은 일반 옵션을 매핑하고 프로바이더 스트림 함수로 디스패치합니다.
2. 프로바이더 스트림 함수(`anthropic.ts`, `openai-responses.ts`, `google.ts`)는 프로바이더 네이티브 스트림 이벤트를 통합된 `AssistantMessageEvent` 시퀀스로 변환합니다.
3. 각 프로바이더는 이벤트를 `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`)에 푸시합니다. 이 스트림은 델타 이벤트를 스로틀하고 다음을 노출합니다:
   - 증분 업데이트를 위한 비동기 반복
   - 최종 `AssistantMessage`를 위한 `result()`
4. `agentLoop` (`packages/agent/src/agent-loop.ts`)은 해당 이벤트를 소비하고, 처리 중인 어시스턴트 상태를 변경하며, 원시 `assistantMessageEvent`를 담은 `message_update` 이벤트를 발행합니다.
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`)은 에이전트 이벤트를 구독하고, 메시지를 지속하며, 확장 훅을 구동하고, 세션 동작(재시도, 압축, TTSR, 스트리밍 편집 중단 검사)을 적용합니다.

## `@f5xc-salesdemos/pi-ai`의 통합 스트림 계약

모든 프로바이더는 동일한 형태(`packages/ai/src/types.ts`의 `AssistantMessageEvent`)를 발행합니다:

- `start`
- 콘텐츠 블록 생명주기 삼중쌍:
  - 텍스트: `text_start` → `text_delta`* → `text_end`
  - 사고: `thinking_start` → `thinking_delta`* → `thinking_end`
  - 도구 호출: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- 터미널 이벤트:
  - `done` (이유: `"stop" | "length" | "toolUse"` 포함)
  - 또는 `error` (이유: `"aborted" | "error"` 포함)

`AssistantMessageEventStream`의 보장 사항:

- 최종 결과는 터미널 이벤트(`done` 또는 `error`)에 의해 확정됩니다
- 델타는 배치 처리/스로틀링됩니다(~50ms)
- 버퍼링된 델타는 비델타 이벤트 및 완료 전에 플러시됩니다

## 델타 스로틀링 및 조화 동작

`AssistantMessageEventStream`은 `text_delta`, `thinking_delta`, `toolcall_delta`를 병합 가능한 이벤트로 처리합니다:

- 버퍼링된 델타는 **타입 + contentIndex**가 일치할 때만 병합됩니다
- 병합 시 최신 `partial` 스냅샷을 유지합니다
- 비델타 이벤트는 즉시 플러시를 강제합니다

이는 TUI/이벤트 소비자를 위해 고빈도 프로바이더 스트림을 매끄럽게 처리하지만, 프로바이더 백프레셔는 아닙니다. 프로바이더는 여전히 최대 속도로 생산하고, 로컬 스트림은 버퍼링합니다.

## 프로바이더 정규화 세부 사항

## Anthropic (`anthropic-messages`)

소스: `packages/ai/src/providers/anthropic.ts`

정규화 포인트:

- `message_start`는 사용량(입력/출력/캐시 토큰)을 초기화합니다
- `content_block_start`는 텍스트/사고/도구 호출 시작에 매핑됩니다
- `content_block_delta` 매핑:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta`는 `thinkingSignature`만 업데이트합니다(이벤트 없음)
- `content_block_stop`은 해당하는 `*_end`를 발행합니다
- `message_delta.stop_reason`은 `mapStopReason()`을 통해 매핑됩니다

도구 호출 인수 스트리밍:

- 각 도구 블록은 내부 `partialJson`을 가집니다
- 모든 JSON 델타는 `partialJson`에 추가됩니다
- `arguments`는 `parseStreamingJson()`을 통해 각 델타마다 재파싱됩니다
- `toolcall_end`는 한 번 더 재파싱한 후 `partialJson`을 제거합니다

## OpenAI Responses (`openai-responses`)

소스: `packages/ai/src/providers/openai-responses.ts`

정규화 포인트:

- `response.output_item.added`는 추론/텍스트/함수 호출 블록을 시작합니다
- 추론 요약 이벤트(`response.reasoning_summary_text.delta`)는 `thinking_delta`가 됩니다
- 출력/거부 델타는 `text_delta`가 됩니다
- `response.function_call_arguments.delta`는 `toolcall_delta`가 됩니다
- `response.output_item.done`은 `thinking_end` / `text_end` / `toolcall_end`를 발행합니다
- `response.completed`는 상태를 중단 이유 및 사용량에 매핑합니다

도구 호출 인수 스트리밍:

- Anthropic과 동일한 `partialJson` 누적 패턴 사용
- `response.function_call_arguments.done`만 전송하는 프로바이더도 최종 인수를 채웁니다
- 도구 호출 ID는 `"<call_id>|<item_id>"`로 정규화됩니다

## Google Generative AI (`google-generative-ai`)

소스: `packages/ai/src/providers/google.ts`

정규화 포인트:

- `candidate.content.parts`를 반복합니다
- 텍스트 파트는 `isThinkingPart(part)`에 의해 사고와 텍스트로 분리됩니다
- 블록 전환 시 새 블록을 시작하기 전에 이전 블록을 닫습니다
- `part.functionCall`은 완전한 도구 호출로 처리됩니다(시작/델타/종료가 즉시 발행됨)
- 완료 이유는 `google-shared.ts`의 `mapStopReason()`에 의해 매핑됩니다

도구 호출 인수 스트리밍:

- 함수 호출 인수는 증분 JSON 텍스트가 아닌 구조화된 객체로 도착합니다
- 구현은 `JSON.stringify(arguments)`를 포함하는 하나의 합성 `toolcall_delta`를 발행합니다
- 이 경로에서는 Google을 위한 부분 JSON 파서가 필요하지 않습니다

## 부분 도구 호출 JSON 누적 및 복구

Anthropic/OpenAI Responses의 공유 동작은 `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`)을 사용합니다:

1. `JSON.parse` 시도
2. 불완전한 단편에 대해 `partial-json` 파서로 폴백
3. 둘 다 실패하면 `{}`를 반환

시사점:

- 잘못된 형식이거나 잘린 인수 델타는 스트림 처리를 즉시 중단시키지 않습니다
- 진행 중인 `arguments`는 일시적으로 `{}`일 수 있습니다
- 이후 유효한 델타는 모든 추가 시마다 파싱이 재시도되므로 구조화된 인수를 복구할 수 있습니다
- 최종 `toolcall_end`는 발행 전에 한 번 더 파싱을 시도합니다

## 중단 이유 대 전송/런타임 오류

프로바이더 중단 이유는 정규화된 `stopReason`으로 매핑됩니다:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, 안전/거부 케이스→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, 안전/금지/잘못된 함수 호출 클래스→`error`

오류 의미는 두 단계로 분리됩니다:

1. **모델 완료 의미론** (프로바이더가 보고한 완료 이유/상태)
2. **전송/런타임 실패** (네트워크/클라이언트/파서/중단 예외)

프로바이더 스트림이 예외를 던지거나 실패를 신호하면, 각 프로바이더 래퍼는 이를 포착하고 다음을 포함하는 터미널 `error` 이벤트를 발행합니다:

- 중단 신호가 설정된 경우 `stopReason = "aborted"`
- 그 외의 경우 `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## 잘못된 형식의 청크 / SSE 파싱 실패 동작

이러한 프로바이더 경로에서 청크/SSE 프레이밍은 벤더 SDK 스트림(Anthropic SDK, OpenAI SDK, Google SDK)에 의해 처리됩니다. 이 코드는 커스텀 SSE 디코더를 구현하지 않습니다.

현재 구현에서 관찰된 동작:

- SDK 수준에서의 잘못된 형식의 청크/SSE 파싱은 예외 또는 스트림 `error` 이벤트로 나타납니다
- 프로바이더 래퍼는 이를 통합된 터미널 `error` 이벤트로 변환합니다
- 스트림 함수 내부에 프로바이더별 재개/재시도가 없습니다
- 상위 수준 재시도는 `AgentSession` 자동 재시도 로직에서 처리됩니다(스트림 청크 재전송이 아닌 메시지 수준 재시도)

## 취소 경계

취소는 계층화되어 있습니다:

- AI 프로바이더 요청: `options.signal`이 프로바이더 클라이언트 스트림 호출에 전달됩니다.
- 프로바이더 래퍼: 스트림 루프 후 중단된 신호는 오류 경로를 강제합니다(`"Request was aborted"`).
- 에이전트 루프: 각 프로바이더 이벤트 처리 전에 `signal.aborted`를 검사하고, 최신 부분 결과로부터 중단된 어시스턴트 메시지를 합성할 수 있습니다.
- 세션/에이전트 제어: `AgentSession.abort()` -> `agent.abort()` -> 공유 중단 컨트롤러 취소.

도구 실행 취소는 모델 스트림 취소와 별개입니다:

- 도구 러너는 `AbortSignal.any([agentSignal, steeringAbortSignal])`를 사용합니다
- 스티어링 인터럽트는 이미 생성된 도구 결과를 보존하면서 나머지 도구 실행을 중단할 수 있습니다

## 백프레셔 경계

프로바이더 SDK 스트림과 다운스트림 소비자 사이에는 하드 백프레셔 메커니즘이 없습니다:

- `EventStream`은 최대 크기 제한이 없는 인메모리 큐를 사용합니다
- 스로틀링은 UI 업데이트 속도를 줄이지만 프로바이더 수집을 늦추지 않습니다
- 소비자가 현저히 지연될 경우 완료될 때까지 큐에 쌓인 이벤트가 증가할 수 있습니다

현재 설계는 제한된 버퍼 흐름 제어보다 응답성과 단순한 순서를 우선시합니다.

## 스트림 이벤트가 에이전트/세션 이벤트로 나타나는 방식

`agentLoop.streamAssistantResponse()`는 `AssistantMessageEvent`를 `AgentEvent`로 연결합니다:

- `start` 시: 플레이스홀더 어시스턴트 메시지를 푸시하고 `message_start`를 발행합니다
- 블록 이벤트(`text_*`, `thinking_*`, `toolcall_*`) 시: 마지막 어시스턴트 메시지를 업데이트하고, 원시 `assistantMessageEvent`를 담은 `message_update`를 발행합니다
- 터미널(`done`/`error`) 시: `response.result()`에서 최종 메시지를 확정하고 `message_end`를 발행합니다

그런 다음 `AgentSession`은 세션 수준 동작을 위해 해당 이벤트를 소비합니다:

- TTSR은 `text_delta` 및 `toolcall_delta`에 대해 `message_update.assistantMessageEvent`를 감시합니다
- 스트리밍 편집 가드는 `edit` 호출에서 `toolcall_delta`/`toolcall_end`를 검사하고 조기에 중단할 수 있습니다
- 지속성은 `message_end`에서 최종 확정된 메시지를 기록합니다
- 자동 재시도는 어시스턴트 `stopReason === "error"` 및 `errorMessage` 휴리스틱을 검사합니다

## 통합 대 프로바이더별 책임

통합 (공통 계약):

- 이벤트 형태 (`AssistantMessageEvent`)
- 최종 결과 추출 (`done`/`error`)
- 델타 스로틀링 + 병합 규칙
- 에이전트/세션 이벤트 전파 모델

프로바이더별 (완전히 추상화되지 않음):

- 업스트림 이벤트 분류 체계 및 매핑 로직
- 중단 이유 변환 테이블
- 도구 호출 ID 규칙
- 추론/사고 블록 의미론 및 서명
- 사용량 토큰 의미론 및 가용성 타이밍
- API별 메시지 변환 제약

## 구현 파일

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — 프로바이더 디스패치, 옵션 매핑, API 키/세션 배관.
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — 일반 스트림 큐 + 어시스턴트 델타 스로틀링.
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — 스트리밍된 도구 인수를 위한 부분 JSON 파싱.
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — Anthropic 이벤트 변환 및 도구 JSON 델타 누적.
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI Responses 이벤트 변환 및 상태 매핑.
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Gemini 스트림 청크-블록 변환.
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Gemini 완료 이유 매핑 및 공유 변환 규칙.
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — 프로바이더 스트림 소비 및 `message_update` 연결.
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — 스트리밍 업데이트, 중단, 재시도, 지속성의 세션 수준 처리.
