---
title: Provider Streaming Internals
description: 'SSE 파싱, 토큰 카운팅, 백프레셔 처리를 포함한 프로바이더 스트리밍 구현.'
sidebar:
  order: 2
  label: 스트리밍 내부 구조
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# 프로바이더 스트리밍 내부 구조

이 문서는 `@f5xc-salesdemos/pi-ai`에서 토큰/도구 스트리밍이 어떻게 정규화되고, `@f5xc-salesdemos/pi-agent-core`와 `coding-agent` 세션 이벤트를 통해 전파되는지 설명합니다.

## 엔드투엔드 흐름

1. `streamSimple()` (`packages/ai/src/stream.ts`)이 범용 옵션을 매핑하고 프로바이더 스트림 함수로 디스패치합니다.
2. 프로바이더 스트림 함수(`anthropic.ts`, `openai-responses.ts`, `google.ts`)가 프로바이더 고유의 스트림 이벤트를 통합된 `AssistantMessageEvent` 시퀀스로 변환합니다.
3. 각 프로바이더는 이벤트를 `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`)에 푸시하며, 이는 델타 이벤트를 스로틀링하고 다음을 노출합니다:
   - 점진적 업데이트를 위한 비동기 이터레이션
   - 최종 `AssistantMessage`를 위한 `result()`
4. `agentLoop` (`packages/agent/src/agent-loop.ts`)이 해당 이벤트를 소비하고, 진행 중인 어시스턴트 상태를 변경하며, 원시 `assistantMessageEvent`를 포함하는 `message_update` 이벤트를 발행합니다.
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`)이 에이전트 이벤트를 구독하고, 메시지를 영속화하며, 확장 훅을 구동하고, 세션 동작(재시도, 압축, TTSR, 스트리밍 편집 중단 검사)을 적용합니다.

## `@f5xc-salesdemos/pi-ai`의 통합 스트림 계약

모든 프로바이더는 동일한 형태(`packages/ai/src/types.ts`의 `AssistantMessageEvent`)를 발행합니다:

- `start`
- 콘텐츠 블록 생명주기 삼중 구조:
  - 텍스트: `text_start` → `text_delta`* → `text_end`
  - 사고: `thinking_start` → `thinking_delta`* → `thinking_end`
  - 도구 호출: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- 종료 이벤트:
  - `reason: "stop" | "length" | "toolUse"`를 포함하는 `done`
  - 또는 `reason: "aborted" | "error"`를 포함하는 `error`

`AssistantMessageEventStream` 보장 사항:

- 최종 결과는 종료 이벤트(`done` 또는 `error`)에 의해 결정됨
- 델타는 일괄 처리/스로틀링됨 (~50ms)
- 버퍼링된 델타는 비-델타 이벤트 전과 완료 전에 플러시됨

## 델타 스로틀링 및 조화 동작

`AssistantMessageEventStream`은 `text_delta`, `thinking_delta`, `toolcall_delta`를 병합 가능한 이벤트로 처리합니다:

- 버퍼링된 델타는 **type + contentIndex**가 일치할 때만 병합됨
- 병합 시 최신 `partial` 스냅샷을 유지
- 비-델타 이벤트는 즉시 플러시를 강제

이는 TUI/이벤트 소비자를 위해 고빈도 프로바이더 스트림을 부드럽게 만들지만, 프로바이더 백프레셔는 아닙니다: 프로바이더는 여전히 최대 속도로 생산하며, 로컬 스트림이 버퍼링합니다.

## 프로바이더 정규화 세부 사항

## Anthropic (`anthropic-messages`)

소스: `packages/ai/src/providers/anthropic.ts`

정규화 포인트:

- `message_start`가 사용량(입력/출력/캐시 토큰)을 초기화
- `content_block_start`가 text/thinking/toolcall 시작에 매핑
- `content_block_delta` 매핑:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta`는 `thinkingSignature`만 업데이트 (이벤트 없음)
- `content_block_stop`가 해당하는 `*_end`를 발행
- `message_delta.stop_reason`이 `mapStopReason()`을 통해 매핑

도구 호출 인수 스트리밍:

- 각 도구 블록이 내부 `partialJson`을 포함
- 모든 JSON 델타가 `partialJson`에 추가됨
- `arguments`는 매 델타마다 `parseStreamingJson()`을 통해 재파싱됨
- `toolcall_end`에서 한 번 더 재파싱한 후 `partialJson`을 제거

## OpenAI Responses (`openai-responses`)

소스: `packages/ai/src/providers/openai-responses.ts`

정규화 포인트:

- `response.output_item.added`가 reasoning/text/function-call 블록을 시작
- 추론 요약 이벤트(`response.reasoning_summary_text.delta`)가 `thinking_delta`로 변환
- output/refusal 델타가 `text_delta`로 변환
- `response.function_call_arguments.delta`가 `toolcall_delta`로 변환
- `response.output_item.done`이 `thinking_end` / `text_end` / `toolcall_end`를 발행
- `response.completed`가 상태를 중지 사유 및 사용량에 매핑

도구 호출 인수 스트리밍:

- Anthropic과 동일한 `partialJson` 누적 패턴
- `response.function_call_arguments.done`만 전송하는 프로바이더도 최종 인수를 채움
- 도구 호출 ID는 `"<call_id>|<item_id>"`로 정규화됨

## Google Generative AI (`google-generative-ai`)

소스: `packages/ai/src/providers/google.ts`

정규화 포인트:

- `candidate.content.parts`를 이터레이션
- 텍스트 파트가 `isThinkingPart(part)`에 의해 thinking vs text로 분리
- 블록 전환 시 새 블록을 시작하기 전에 이전 블록을 닫음
- `part.functionCall`은 완전한 도구 호출로 처리됨 (start/delta/end가 즉시 발행)
- 종료 사유가 `google-shared.ts`의 `mapStopReason()`에 의해 매핑

도구 호출 인수 스트리밍:

- 함수 호출 인수가 점진적 JSON 텍스트가 아닌 구조화된 객체로 도착
- 구현에서 `JSON.stringify(arguments)`를 포함하는 하나의 합성 `toolcall_delta`를 발행
- 이 경로에서는 Google용 부분 JSON 파서가 필요 없음

## 부분 도구 호출 JSON 누적 및 복구

Anthropic/OpenAI Responses의 공유 동작은 `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`)을 사용합니다:

1. `JSON.parse` 시도
2. 불완전한 조각에 대해 `partial-json` 파서로 폴백
3. 둘 다 실패하면 `{}` 반환

함의:

- 잘못되거나 잘린 인수 델타가 스트림 처리를 즉시 크래시시키지 않음
- 진행 중인 `arguments`가 일시적으로 `{}`일 수 있음
- 이후 유효한 델타가 구조화된 인수를 복구할 수 있음 (매 추가마다 파싱을 재시도하므로)
- 최종 `toolcall_end`에서 발행 전 한 번 더 파싱 시도

## 중지 사유 vs 전송/런타임 오류

프로바이더 중지 사유는 정규화된 `stopReason`으로 매핑됩니다:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, 안전/거부 케이스→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, 안전/금지/잘못된 함수 호출 클래스→`error`

오류 의미론은 두 단계로 나뉩니다:

1. **모델 완료 의미론** (프로바이더가 보고한 종료 사유/상태)
2. **전송/런타임 실패** (네트워크/클라이언트/파서/중단 예외)

프로바이더 스트림이 예외를 던지거나 실패를 신호하면, 각 프로바이더 래퍼가 이를 포착하고 다음과 함께 종료 `error` 이벤트를 발행합니다:

- 중단 시그널이 설정된 경우 `stopReason = "aborted"`
- 그 외에는 `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## 잘못된 청크 / SSE 파싱 실패 동작

이러한 프로바이더 경로에서 청크/SSE 프레이밍은 벤더 SDK 스트림(Anthropic SDK, OpenAI SDK, Google SDK)이 처리합니다. 이 코드는 여기서 커스텀 SSE 디코더를 구현하지 않습니다.

현재 구현에서 관찰된 동작:

- SDK 수준의 잘못된 청크/SSE 파싱은 예외 또는 스트림 `error` 이벤트로 표면화
- 프로바이더 래퍼가 이를 통합된 종료 `error` 이벤트로 변환
- 스트림 함수 자체 내에서 프로바이더별 재개/재시도 없음
- 상위 수준 재시도는 `AgentSession` 자동 재시도 로직에서 처리 (스트림 청크 리플레이가 아닌 메시지 수준 재시도)

## 취소 경계

취소는 계층적으로 구성됩니다:

- AI 프로바이더 요청: `options.signal`이 프로바이더 클라이언트 스트림 호출에 전달됩니다.
- 프로바이더 래퍼: 스트림 루프 이후, 중단된 시그널이 오류 경로를 강제합니다 (`"Request was aborted"`).
- 에이전트 루프: 각 프로바이더 이벤트를 처리하기 전에 `signal.aborted`를 확인하고, 최신 부분 데이터에서 중단된 어시스턴트 메시지를 합성할 수 있습니다.
- 세션/에이전트 제어: `AgentSession.abort()` -> `agent.abort()` -> 공유 중단 컨트롤러 취소.

도구 실행 취소는 모델 스트림 취소와 별개입니다:

- 도구 러너는 `AbortSignal.any([agentSignal, steeringAbortSignal])`을 사용
- 스티어링 인터럽트가 이미 생성된 도구 결과를 보존하면서 나머지 도구 실행을 중단할 수 있음

## 백프레셔 경계

프로바이더 SDK 스트림과 다운스트림 소비자 사이에 하드 백프레셔 메커니즘은 없습니다:

- `EventStream`은 최대 크기 없는 인메모리 큐를 사용
- 스로틀링은 UI 업데이트 속도를 줄이지만 프로바이더 인테이크를 늦추지는 않음
- 소비자가 크게 지연되면, 큐에 쌓인 이벤트가 완료될 때까지 증가할 수 있음

현재 설계는 바운디드 버퍼 흐름 제어보다 응답성과 단순한 순서 보장을 우선합니다.

## 스트림 이벤트가 에이전트/세션 이벤트로 표면화되는 방식

`agentLoop.streamAssistantResponse()`가 `AssistantMessageEvent`를 `AgentEvent`로 브릿지합니다:

- `start` 시: 플레이스홀더 어시스턴트 메시지를 푸시하고 `message_start`를 발행
- 블록 이벤트(`text_*`, `thinking_*`, `toolcall_*`) 시: 마지막 어시스턴트 메시지를 업데이트하고, 원시 `assistantMessageEvent`와 함께 `message_update`를 발행
- 종료 시(`done`/`error`): `response.result()`에서 최종 메시지를 결정하고, `message_end`를 발행

`AgentSession`은 이후 세션 수준 동작을 위해 해당 이벤트를 소비합니다:

- TTSR이 `message_update.assistantMessageEvent`에서 `text_delta`와 `toolcall_delta`를 감시
- 스트리밍 편집 가드가 `edit` 호출 시 `toolcall_delta`/`toolcall_end`를 검사하고 조기 중단 가능
- 영속화가 `message_end`에서 최종 메시지를 기록
- 자동 재시도가 어시스턴트 `stopReason === "error"` 및 `errorMessage` 휴리스틱을 검사

## 통합 vs 프로바이더별 책임

통합 (공통 계약):

- 이벤트 형태 (`AssistantMessageEvent`)
- 최종 결과 추출 (`done`/`error`)
- 델타 스로틀링 + 병합 규칙
- 에이전트/세션 이벤트 전파 모델

프로바이더별 (완전히 추상화되지 않음):

- 업스트림 이벤트 분류 체계와 매핑 로직
- 중지 사유 변환 테이블
- 도구 호출 ID 규약
- 추론/사고 블록 의미론 및 서명
- 사용량 토큰 의미론 및 가용 시점
- API별 메시지 변환 제약 사항

## 구현 파일

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — 프로바이더 디스패치, 옵션 매핑, API 키/세션 배관.
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — 범용 스트림 큐 + 어시스턴트 델타 스로틀링.
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — 스트리밍된 도구 인수를 위한 부분 JSON 파싱.
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — Anthropic 이벤트 변환 및 도구 JSON 델타 누적.
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI Responses 이벤트 변환 및 상태 매핑.
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Gemini 스트림 청크-블록 변환.
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Gemini 종료 사유 매핑 및 공유 변환 규칙.
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — 프로바이더 스트림 소비 및 `message_update` 브릿징.
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — 스트리밍 업데이트, 중단, 재시도 및 영속화의 세션 수준 처리.
