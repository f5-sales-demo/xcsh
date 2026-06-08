---
title: Resolve 도구 런타임 내부 구조
description: >-
  Resolve tool runtime for file path resolution, content fetching, and URL-based
  resource access.
sidebar:
  order: 3
  label: Resolve 도구
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# Resolve 도구 런타임 내부 구조

이 문서는 coding-agent에서 미리보기/적용 워크플로우가 어떻게 모델링되는지, 그리고 커스텀 도구가 `pushPendingAction`을 통해 어떻게 참여할 수 있는지 설명합니다.

## 범위 및 주요 파일

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## `resolve`가 하는 일

`resolve`는 대기 중인 미리보기 액션을 확정하는 숨겨진 도구입니다.

- `action: "apply"`는 대기 중인 액션에 대해 `apply(reason)`를 실행하고 변경 사항을 저장합니다.
- `action: "discard"`는 제공된 경우 `reject(reason)`를 호출하고, 그렇지 않으면 기본 "Discarded" 메시지와 함께 액션을 삭제합니다.

대기 중인 액션이 없으면 `resolve`는 다음과 같은 오류로 실패합니다:

- `No pending action to resolve. Nothing to apply or discard.`

## 대기 액션은 스택(LIFO)입니다

대기 액션은 `PendingActionStore`에 push/pop 스택으로 저장됩니다:

- `push(action)`은 새로운 대기 액션을 맨 위에 추가합니다.
- `peek()`는 현재 맨 위의 액션을 확인합니다.
- `pop()`은 맨 위의 액션을 제거하고 반환합니다.
- `hasPending`은 스택이 비어 있지 않은지를 나타냅니다.

`resolve`는 항상 **최상위** 대기 액션을 먼저 소비(`pop()`)하므로, 여러 미리보기 생성 도구는 등록된 역순으로 해결됩니다.

## 내장 생산자 예제 (`ast_edit`)

`ast_edit`는 먼저 구조적 교체를 미리보기합니다. 미리보기에 교체 항목이 있고 아직 적용되지 않은 경우, 다음을 포함하는 대기 액션을 푸시합니다:

- label (사람이 읽을 수 있는 요약)
- `sourceToolName` (`ast_edit`)
- `apply(reason: string)` 콜백 — `dryRun: false`로 AST 편집을 다시 실행합니다

`resolve(action="apply", reason="...")`는 이 콜백에 `reason`을 전달합니다.

## 커스텀 도구: `pushPendingAction`

커스텀 도구는 `CustomToolAPI.pushPendingAction(...)`을 통해 resolve 호환 대기 액션을 등록할 수 있습니다.

`CustomToolPendingAction`:

- `label: string` (필수)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (필수) — 적용 시 호출됩니다; `reason`은 `resolve`에 전달된 문자열입니다
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (선택) — 폐기 시 호출됩니다; 반환 값이 제공되면 기본 "Discarded" 메시지를 대체합니다
- `details?: unknown` (선택)
- `sourceToolName?: string` (선택, 기본값은 `"custom_tool"`)

### 최소 사용 예제

```ts
import type { CustomToolFactory } from "@f5xc-salesdemos/xcsh";

const factory: CustomToolFactory = pi => ({
 name: "batch_rename_preview",
 label: "Batch Rename Preview",
 description: "Previews renames and defers commit to resolve",
 parameters: pi.typebox.Type.Object({
  files: pi.typebox.Type.Array(pi.typebox.Type.String()),
 }),

 async execute(_toolCallId, params) {
  const previewSummary = `Prepared rename plan for ${params.files.length} files`;

  pi.pushPendingAction({
   label: `Batch rename: ${params.files.length} files`,
   sourceToolName: "batch_rename_preview",
   apply: async (reason) => {
    // apply writes here
    return {
     content: [{ type: "text", text: `Applied batch rename. Reason: ${reason}` }],
    };
   },
   reject: async (reason) => {
    // optional: cleanup or notify on discard
    return {
     content: [{ type: "text", text: `Discarded batch rename. Reason: ${reason}` }],
    };
   },
  });

  return {
   content: [{ type: "text", text: `${previewSummary}. Call resolve to apply or discard.` }],
  };
 },
});

export default factory;
```

## 런타임 가용성 및 실패

`pushPendingAction`은 활성 세션의 `PendingActionStore`를 사용하여 커스텀 도구 로더에 의해 연결됩니다.

런타임에 pending-action 스토어가 없으면 `pushPendingAction`은 다음 오류를 던집니다:

- `Pending action store unavailable for custom tools in this runtime.`

## 도구 선택 동작

`PendingActionStore.hasPending`이 true이면, 에이전트 런타임은 도구 선택을 `resolve`로 편향시켜 일반적인 도구 흐름이 계속되기 전에 대기 중인 미리보기가 명시적으로 확정되도록 합니다.

## 개발자 가이드

- 대기 액션은 명시적인 적용/폐기를 지원해야 하는 파괴적이거나 영향이 큰 작업에만 사용하세요.
- `label`은 간결하고 구체적으로 유지하세요; resolve 렌더러 출력에 표시됩니다.
- `apply(reason)`가 일회성 실행에 충분히 결정적이고 멱등성을 갖도록 하세요; `reason`은 정보 제공 목적이며 동작을 변경해서는 안 됩니다.
- 폐기 시 정리가 필요한 경우(임시 상태, 잠금, 알림) `reject(reason)`를 구현하세요; 기본 메시지로 충분한 무상태 미리보기의 경우 생략하세요.
- 도구가 여러 미리보기를 스테이징할 수 있는 경우, LIFO 의미론을 기억하세요: 가장 최근에 푸시된 액션이 먼저 해결됩니다.
