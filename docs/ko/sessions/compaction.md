---
title: 압축 및 브랜치 요약
description: 장기 세션을 위한 컨텍스트 윈도우 압축 및 브랜치 요약 생성.
sidebar:
  order: 5
  label: 압축
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# 압축 및 브랜치 요약

압축과 브랜치 요약은 이전 작업 컨텍스트를 잃지 않고 장기 세션을 사용 가능하게 유지하는 두 가지 메커니즘입니다.

- **압축(Compaction)**은 현재 브랜치에서 이전 기록을 요약으로 재작성합니다.
- **브랜치 요약(Branch summary)**은 `/tree` 탐색 중 포기된 브랜치 컨텍스트를 캡처합니다.

두 메커니즘 모두 세션 항목으로 저장되며, LLM 입력을 재구성할 때 사용자 컨텍스트 메시지로 변환됩니다.

## 주요 구현 파일

- `src/session/compaction/compaction.ts`
- `src/session/compaction/branch-summarization.ts`
- `src/session/compaction/pruning.ts`
- `src/session/compaction/utils.ts`
- `src/session/session-manager.ts`
- `src/session/agent-session.ts`
- `src/session/messages.ts`
- `src/extensibility/hooks/types.ts`
- `src/config/settings-schema.ts`

## 세션 항목 모델

압축과 브랜치 요약은 일반 어시스턴트/사용자 메시지가 아닌 일급 세션 항목입니다.

- `CompactionEntry`
  - `type: "compaction"`
  - `summary`, 선택적 `shortSummary`
  - `firstKeptEntryId` (압축 경계)
  - `tokensBefore`
  - 선택적 `details`, `preserveData`, `fromExtension`
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`, `summary`
  - 선택적 `details`, `fromExtension`

컨텍스트가 재구성될 때(`buildSessionContext`):

1. 활성 경로의 최신 압축이 하나의 `compactionSummary` 메시지로 변환됩니다.
2. `firstKeptEntryId`부터 압축 지점까지의 유지된 항목이 다시 포함됩니다.
3. 이후 경로의 항목이 추가됩니다.
4. `branch_summary` 항목은 `branchSummary` 메시지로 변환됩니다.
5. `custom_message` 항목은 `custom` 메시지로 변환됩니다.

해당 커스텀 역할은 이후 `convertToLlm()`에서 정적 템플릿을 사용하여 LLM 대면 사용자 메시지로 변환됩니다:

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## 압축 파이프라인

### 트리거

압축은 세 가지 방식으로 실행될 수 있습니다:

1. **수동**: `/compact [instructions]`가 `AgentSession.compact(...)`를 호출합니다.
2. **자동 오버플로우 복구**: 컨텍스트 오버플로우와 일치하는 어시스턴트 오류 이후.
3. **자동 임계값 압축**: 컨텍스트가 임계값을 초과하는 성공적인 턴 이후.

### 압축 형태 (시각적 표현)

```text
압축 전:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

압축 후 (새 항목 추가됨):

  entry:  0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 not sent to LLM                    sent to LLM
                                                         ↑
                                              starts from firstKeptEntryId

LLM이 보는 내용:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   from cmp          messages from firstKeptEntryId
```

### 오버플로우 재시도 vs 임계값 압축

두 가지 자동 경로는 의도적으로 다르게 설계되었습니다:

- **오버플로우 재시도 압축**
  - 트리거: 현재 모델 어시스턴트 오류가 컨텍스트 오버플로우로 감지될 때.
  - 실패한 어시스턴트 오류 메시지는 재시도 전에 활성 에이전트 상태에서 제거됩니다.
  - 자동 압축은 `reason: "overflow"` 및 `willRetry: true`로 실행됩니다.
  - 성공 시, 에이전트는 압축 후 자동으로 계속됩니다(`agent.continue()`).

- **임계값 압축**
  - 트리거: `contextTokens > contextWindow - compaction.reserveTokens`.
  - `reason: "threshold"` 및 `willRetry: false`로 실행됩니다.
  - 성공 시, `compaction.autoContinue !== false`이면 합성 프롬프트를 주입합니다:
    - `"Continue if you have next steps."`

### 압축 전 가지치기

압축 검사 전에 도구 결과 가지치기가 실행될 수 있습니다(`pruneToolOutputs`).

기본 가지치기 정책:

- 최신 `40_000` 도구 출력 토큰을 보호합니다.
- 최소 `20_000` 총 예상 절감량이 필요합니다.
- `skill` 또는 `read`에서 도구 결과를 절대 가지치기하지 않습니다.

가지치기된 도구 결과는 다음으로 대체됩니다:

- `[Output truncated - N tokens]`

가지치기로 항목이 변경되면, 압축 결정 전에 세션 스토리지가 재작성되고 에이전트 메시지 상태가 새로고침됩니다.

### 경계 및 절단점 로직

`prepareCompaction()`은 마지막 압축 항목(있는 경우) 이후의 항목만 고려합니다.

1. 이전 압축 인덱스를 찾습니다.
2. `boundaryStart = prevCompactionIndex + 1`을 계산합니다.
3. 사용 가능한 경우 측정된 사용 비율을 사용하여 `keepRecentTokens`를 조정합니다.
4. 경계 윈도우에서 `findCutPoint()`를 실행합니다.

유효한 절단점에는 다음이 포함됩니다:

- `user`, `assistant`, `bashExecution`, `hookMessage`, `branchSummary`, `compactionSummary` 역할을 가진 메시지 항목
- `custom_message` 항목
- `branch_summary` 항목

하드 규칙: `toolResult`에서 절대 절단하지 않습니다.

절단점 바로 앞에 비메시지 메타데이터 항목(`model_change`, `thinking_level_change`, 레이블 등)이 있는 경우, 메시지 또는 압축 경계에 도달할 때까지 절단 인덱스를 뒤로 이동하여 유지 영역으로 포함시킵니다.

### 분할 턴 처리

절단점이 사용자 턴 시작 지점이 아닌 경우, 압축은 이를 분할 턴으로 처리합니다.

다음을 사용자 턴 경계로 처리합니다:

- `message.role === "user"`
- `message.role === "bashExecution"`
- `custom_message` 항목
- `branch_summary` 항목

분할 턴 압축은 두 개의 요약을 생성합니다:

1. 기록 요약 (`messagesToSummarize`)
2. 턴 접두사 요약 (`turnPrefixMessages`)

최종 저장 요약은 다음과 같이 병합됩니다:

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### 요약 생성

`compact(...)`는 직렬화된 대화 텍스트에서 요약을 빌드합니다:

1. `convertToLlm()`을 통해 메시지를 변환합니다.
2. `serializeConversation()`으로 직렬화합니다.
3. `<conversation>...</conversation>`으로 감쌉니다.
4. 선택적으로 `<previous-summary>...</previous-summary>`를 포함합니다.
5. 선택적으로 훅 컨텍스트를 `<additional-context>` 목록으로 주입합니다.
6. `SUMMARIZATION_SYSTEM_PROMPT`로 요약 프롬프트를 실행합니다.

프롬프트 선택:

- 첫 번째 압축: `compaction-summary.md`
- 이전 요약이 있는 반복 압축: `compaction-update-summary.md`
- 분할 턴 두 번째 패스: `compaction-turn-prefix.md`
- 짧은 UI 요약: `compaction-short-summary.md`

원격 요약 모드:

- `compaction.remoteEndpoint`가 설정된 경우, 압축은 다음을 POST합니다:
  - `{ systemPrompt, prompt }`
- 최소 `{ summary }`를 포함하는 JSON을 기대합니다.

### 요약의 파일 작업 컨텍스트

압축은 어시스턴트 도구 호출을 사용하여 누적 파일 활동을 추적합니다:

- `read(path)` → 읽기 세트
- `write(path)` → 수정 세트
- `edit(path)` → 수정 세트

누적 동작:

- 이전 항목이 pi 생성(`fromExtension !== true`)인 경우에만 이전 압축 세부 정보를 포함합니다.
- 분할 턴에서는 턴 접두사 파일 작업도 포함합니다.
- `readFiles`는 수정된 파일도 제외합니다.

요약 텍스트에는 프롬프트 템플릿을 통해 파일 태그가 추가됩니다:

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### 저장 및 재로드

요약 생성(또는 훅 제공 요약) 후, 에이전트 세션은:

1. `appendCompaction(...)`으로 `CompactionEntry`를 추가합니다.
2. `buildSessionContext()`를 통해 컨텍스트를 재구성합니다.
3. 라이브 에이전트 메시지를 재구성된 컨텍스트로 교체합니다.
4. `session_compact` 훅 이벤트를 발생시킵니다.

## 브랜치 요약 파이프라인

브랜치 요약은 토큰 오버플로우가 아닌 트리 탐색과 연결됩니다.

### 트리거

`navigateTree(...)` 중에:

1. `collectEntriesForBranchSummary(...)`를 사용하여 이전 리프에서 공통 조상까지의 포기된 항목을 계산합니다.
2. 호출자가 요약을 요청한 경우(`options.summarize`), 리프를 전환하기 전에 요약을 생성합니다.
3. 요약이 존재하면, `branchWithSummary(...)`를 사용하여 탐색 대상에 첨부합니다.

운영적으로 이는 `branchSummary.enabled`가 활성화된 경우 `/tree` 흐름에 의해 주로 구동됩니다.

### 브랜치 전환 형태 (시각적 표현)

```text
탐색 전 트리:

         ┌─ B ─ C ─ D (이전 리프, 포기됨)
    A ───┤
         └─ E ─ F (대상)

공통 조상: A
요약할 항목: B, C, D

요약과 함께 탐색 후:

         ┌─ B ─ C ─ D ─ [summary of B,C,D]
    A ───┤
         └─ E ─ F (새 리프)
```

### 준비 및 토큰 예산

`generateBranchSummary(...)`는 예산을 다음과 같이 계산합니다:

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)`는 이후:

1. 첫 번째 패스: 이전 pi 생성 `branch_summary` 세부 정보를 포함한 모든 요약된 항목의 누적 파일 작업을 수집합니다.
2. 두 번째 패스: 최신 → 최고, 토큰 예산에 도달할 때까지 메시지를 추가합니다.
3. 최근 컨텍스트 보존을 선호합니다.
4. 연속성을 위해 예산 경계 근처의 큰 요약 항목을 여전히 포함할 수 있습니다.

압축 항목은 브랜치 요약 입력 중에 메시지(`compactionSummary`)로 포함됩니다.

### 요약 생성 및 저장

브랜치 요약:

1. 선택된 메시지를 변환하고 직렬화합니다.
2. `<conversation>`으로 감쌉니다.
3. 커스텀 지침이 제공된 경우 사용하고, 그렇지 않으면 `branch-summary.md`를 사용합니다.
4. `SUMMARIZATION_SYSTEM_PROMPT`로 요약 모델을 호출합니다.
5. `branch-summary-preamble.md`를 앞에 추가합니다.
6. 파일 작업 태그를 추가합니다.

결과는 선택적 세부 정보(`readFiles`, `modifiedFiles`)와 함께 `BranchSummaryEntry`로 저장됩니다.

## 확장 및 훅 접점

### `session_before_compact`

압축 전 훅.

다음을 수행할 수 있습니다:

- 압축 취소 (`{ cancel: true }`)
- 전체 커스텀 압축 페이로드 제공 (`{ compaction: CompactionResult }`)

### `session.compacting`

기본 압축을 위한 프롬프트/컨텍스트 커스터마이제이션 훅.

반환 가능:

- `prompt` (기본 요약 프롬프트 재정의)
- `context` (`<additional-context>`에 주입되는 추가 컨텍스트 라인)
- `preserveData` (압축 항목에 저장됨)

### `session_compact`

저장된 `compactionEntry` 및 `fromExtension` 플래그와 함께하는 압축 후 알림.

### `session_before_tree`

기본 브랜치 요약 생성 전에 트리 탐색 시 실행됩니다.

다음을 수행할 수 있습니다:

- 탐색 취소
- 사용자가 요약을 요청한 경우 사용되는 커스텀 `{ summary: { summary, details } }` 제공

### `session_tree`

새/이전 리프 및 선택적 요약 항목을 노출하는 탐색 후 이벤트.

## 런타임 동작 및 실패 시맨틱

- 수동 압축은 현재 에이전트 작업을 먼저 중단합니다.
- `abortCompaction()`은 수동 및 자동 압축 컨트롤러 모두를 취소합니다.
- 자동 압축은 UI/상태 업데이트를 위한 시작/종료 세션 이벤트를 발생시킵니다.
- 자동 압축은 여러 모델 후보를 시도하고 일시적 실패를 재시도할 수 있습니다.
- 오버플로우 오류는 압축에 의해 처리되므로 일반 재시도 경로에서 제외됩니다.
- 자동 압축이 실패하는 경우:
  - 오버플로우 경로는 `Context overflow recovery failed: ...`를 발생시킵니다.
  - 임계값 경로는 `Auto-compaction failed: ...`를 발생시킵니다.
- 브랜치 요약은 중단 신호(예: Escape)를 통해 취소될 수 있으며, 취소됨/중단됨 탐색 결과를 반환합니다.

## 설정 및 기본값

`settings-schema.ts`에서:

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

이 값들은 런타임에 `AgentSession` 및 압축/브랜치 요약 모듈에 의해 사용됩니다.
