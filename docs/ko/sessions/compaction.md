---
title: 압축과 브랜치 요약
description: 장기 세션을 위한 컨텍스트 윈도우 압축 및 브랜치 요약 생성
sidebar:
  order: 5
  label: 압축
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# 압축과 브랜치 요약

압축과 브랜치 요약은 이전 작업 컨텍스트를 잃지 않으면서 장기 세션을 사용 가능한 상태로 유지하는 두 가지 메커니즘입니다.

- **압축**은 현재 브랜치에서 오래된 히스토리를 요약으로 재작성합니다.
- **브랜치 요약**은 `/tree` 탐색 중 버려진 브랜치의 컨텍스트를 캡처합니다.

둘 다 세션 엔트리로 영구 저장되며, LLM 입력을 재구성할 때 사용자 컨텍스트 메시지로 다시 변환됩니다.

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

## 세션 엔트리 모델

압축과 브랜치 요약은 일반적인 어시스턴트/사용자 메시지가 아닌 1급 세션 엔트리입니다.

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

1. 활성 경로상의 최신 압축이 하나의 `compactionSummary` 메시지로 변환됩니다.
2. `firstKeptEntryId`부터 압축 지점까지의 유지된 엔트리들이 다시 포함됩니다.
3. 경로상의 이후 엔트리들이 추가됩니다.
4. `branch_summary` 엔트리들이 `branchSummary` 메시지로 변환됩니다.
5. `custom_message` 엔트리들이 `custom` 메시지로 변환됩니다.

이러한 커스텀 역할은 `convertToLlm()`에서 정적 템플릿을 사용하여 LLM 대면 사용자 메시지로 변환됩니다:

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## 압축 파이프라인

### 트리거

압축은 세 가지 방식으로 실행될 수 있습니다:

1. **수동**: `/compact [instructions]`가 `AgentSession.compact(...)`을 호출합니다.
2. **자동 오버플로우 복구**: 컨텍스트 오버플로우와 일치하는 어시스턴트 오류 발생 후.
3. **자동 임계값 압축**: 컨텍스트가 임계값을 초과한 상태에서 성공적인 턴 이후.

### 압축 형태 (시각화)

```text
압축 전:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            유지 메시지
                                   ↑
                          firstKeptEntryId (entry 4)

압축 후 (새 엔트리 추가됨):

  entry:  0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 LLM에 전송되지 않음                    LLM에 전송됨
                                                         ↑
                                              firstKeptEntryId부터 시작

LLM이 보는 내용:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   cmp에서     firstKeptEntryId부터의 메시지
```

### 오버플로우 재시도 vs 임계값 압축

두 가지 자동 경로는 의도적으로 다릅니다:

- **오버플로우 재시도 압축**
  - 트리거: 현재 모델의 어시스턴트 오류가 컨텍스트 오버플로우로 감지됨.
  - 실패한 어시스턴트 오류 메시지는 재시도 전 활성 에이전트 상태에서 제거됩니다.
  - `reason: "overflow"` 및 `willRetry: true`로 자동 압축이 실행됩니다.
  - 성공 시, 압축 후 에이전트가 자동 계속합니다(`agent.continue()`).

- **임계값 압축**
  - 트리거: `contextTokens > contextWindow - compaction.reserveTokens`.
  - `reason: "threshold"` 및 `willRetry: false`로 실행됩니다.
  - 성공 시, `compaction.autoContinue !== false`이면 합성 프롬프트를 주입합니다:
    - `"Continue if you have next steps."`

### 압축 전 프루닝

압축 검사 전에 도구 결과 프루닝이 실행될 수 있습니다(`pruneToolOutputs`).

기본 프루닝 정책:

- 최신 `40_000` 도구 출력 토큰을 보호합니다.
- 최소 `20_000` 총 예상 절약량이 필요합니다.
- `skill` 또는 `read`의 도구 결과는 절대 프루닝하지 않습니다.

프루닝된 도구 결과는 다음으로 대체됩니다:

- `[Output truncated - N tokens]`

프루닝으로 엔트리가 변경되면, 압축 결정 전에 세션 저장소가 재작성되고 에이전트 메시지 상태가 새로고침됩니다.

### 경계 및 절단점 로직

`prepareCompaction()`은 마지막 압축 엔트리(있는 경우) 이후의 엔트리만 고려합니다.

1. 이전 압축 인덱스를 찾습니다.
2. `boundaryStart = prevCompactionIndex + 1`을 계산합니다.
3. 사용 가능한 경우 측정된 사용 비율을 사용하여 `keepRecentTokens`를 조정합니다.
4. 경계 윈도우에 대해 `findCutPoint()`를 실행합니다.

유효한 절단점은 다음을 포함합니다:

- 다음 역할의 메시지 엔트리: `user`, `assistant`, `bashExecution`, `hookMessage`, `branchSummary`, `compactionSummary`
- `custom_message` 엔트리
- `branch_summary` 엔트리

엄격한 규칙: `toolResult`에서는 절대 절단하지 않습니다.

절단점 바로 앞에 비메시지 메타데이터 엔트리(`model_change`, `thinking_level_change`, 레이블 등)가 있으면, 메시지나 압축 경계에 도달할 때까지 절단 인덱스를 뒤로 이동하여 유지 영역으로 포함시킵니다.

### 분할 턴 처리

절단점이 사용자 턴 시작 지점이 아닌 경우, 압축은 이를 분할 턴으로 처리합니다.

턴 시작 감지는 다음을 사용자 턴 경계로 취급합니다:

- `message.role === "user"`
- `message.role === "bashExecution"`
- `custom_message` 엔트리
- `branch_summary` 엔트리

분할 턴 압축은 두 개의 요약을 생성합니다:

1. 히스토리 요약 (`messagesToSummarize`)
2. 턴 접두사 요약 (`turnPrefixMessages`)

최종 저장되는 요약은 다음과 같이 병합됩니다:

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### 요약 생성

`compact(...)`은 직렬화된 대화 텍스트로부터 요약을 구성합니다:

1. `convertToLlm()`을 통해 메시지를 변환합니다.
2. `serializeConversation()`으로 직렬화합니다.
3. `<conversation>...</conversation>`으로 래핑합니다.
4. 선택적으로 `<previous-summary>...</previous-summary>`를 포함합니다.
5. 선택적으로 후크 컨텍스트를 `<additional-context>` 목록으로 주입합니다.
6. `SUMMARIZATION_SYSTEM_PROMPT`로 요약 프롬프트를 실행합니다.

프롬프트 선택:

- 첫 번째 압축: `compaction-summary.md`
- 이전 요약이 있는 반복 압축: `compaction-update-summary.md`
- 분할 턴 두 번째 패스: `compaction-turn-prefix.md`
- 짧은 UI 요약: `compaction-short-summary.md`

원격 요약 모드:

- `compaction.remoteEndpoint`가 설정된 경우, 압축은 다음을 POST합니다:
  - `{ systemPrompt, prompt }`
- 최소한 `{ summary }`를 포함하는 JSON을 기대합니다.

### 요약의 파일 작업 컨텍스트

압축은 어시스턴트 도구 호출을 사용하여 누적 파일 활동을 추적합니다:

- `read(path)` → 읽기 세트
- `write(path)` → 수정 세트
- `edit(path)` → 수정 세트

누적 동작:

- 이전 압축 상세 정보는 이전 엔트리가 pi 생성(`fromExtension !== true`)인 경우에만 포함합니다.
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

### 저장 및 리로드

요약 생성(또는 후크 제공 요약) 후, 에이전트 세션은:

1. `appendCompaction(...)`으로 `CompactionEntry`를 추가합니다.
2. `buildSessionContext()`를 통해 컨텍스트를 재구성합니다.
3. 라이브 에이전트 메시지를 재구성된 컨텍스트로 교체합니다.
4. `session_compact` 후크 이벤트를 발생시킵니다.

## 브랜치 요약 파이프라인

브랜치 요약은 토큰 오버플로우가 아닌 트리 탐색과 연결되어 있습니다.

### 트리거

`navigateTree(...)` 중:

1. `collectEntriesForBranchSummary(...)`를 사용하여 이전 리프에서 공통 조상까지의 버려진 엔트리를 계산합니다.
2. 호출자가 요약을 요청한 경우(`options.summarize`), 리프를 전환하기 전에 요약을 생성합니다.
3. 요약이 존재하면 `branchWithSummary(...)`를 사용하여 탐색 대상에 첨부합니다.

운영적으로 이는 `branchSummary.enabled`가 활성화된 경우 `/tree` 흐름에 의해 주로 구동됩니다.

### 브랜치 전환 형태 (시각화)

```text
탐색 전 트리:

         ┌─ B ─ C ─ D (이전 리프, 버려지는 중)
    A ───┤
         └─ E ─ F (대상)

공통 조상: A
요약할 엔트리: B, C, D

요약과 함께 탐색 후:

         ┌─ B ─ C ─ D ─ [B,C,D의 요약]
    A ───┤
         └─ E ─ F (새 리프)
```

### 준비 및 토큰 예산

`generateBranchSummary(...)`는 예산을 다음과 같이 계산합니다:

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)`는 다음을 수행합니다:

1. 첫 번째 패스: 이전 pi 생성 `branch_summary` 상세 정보를 포함하여 모든 요약 대상 엔트리에서 누적 파일 작업을 수집합니다.
2. 두 번째 패스: 최신 → 오래된 순서로 순회하며, 토큰 예산에 도달할 때까지 메시지를 추가합니다.
3. 최근 컨텍스트 보존을 우선합니다.
4. 연속성을 위해 예산 한계 근처의 대용량 요약 엔트리도 포함할 수 있습니다.

압축 엔트리는 브랜치 요약 입력 시 메시지(`compactionSummary`)로 포함됩니다.

### 요약 생성 및 저장

브랜치 요약:

1. 선택된 메시지를 변환하고 직렬화합니다.
2. `<conversation>`으로 래핑합니다.
3. 공급된 경우 커스텀 지침을 사용하고, 그렇지 않으면 `branch-summary.md`를 사용합니다.
4. `SUMMARIZATION_SYSTEM_PROMPT`로 요약 모델을 호출합니다.
5. `branch-summary-preamble.md`를 앞에 추가합니다.
6. 파일 작업 태그를 추가합니다.

결과는 선택적 상세 정보(`readFiles`, `modifiedFiles`)와 함께 `BranchSummaryEntry`로 저장됩니다.

## 확장 및 후크 접점

### `session_before_compact`

압축 전 후크입니다.

다음이 가능합니다:

- 압축 취소 (`{ cancel: true }`)
- 완전한 커스텀 압축 페이로드 제공 (`{ compaction: CompactionResult }`)

### `session.compacting`

기본 압축의 프롬프트/컨텍스트 커스터마이징 후크입니다.

다음을 반환할 수 있습니다:

- `prompt` (기본 요약 프롬프트 재정의)
- `context` (`<additional-context>`에 주입되는 추가 컨텍스트 라인)
- `preserveData` (압축 엔트리에 저장됨)

### `session_compact`

저장된 `compactionEntry`와 `fromExtension` 플래그가 포함된 압축 후 알림입니다.

### `session_before_tree`

기본 브랜치 요약 생성 전 트리 탐색 시 실행됩니다.

다음이 가능합니다:

- 탐색 취소
- 사용자가 요약을 요청한 경우 사용되는 커스텀 `{ summary: { summary, details } }` 제공

### `session_tree`

새/이전 리프 및 선택적 요약 엔트리를 노출하는 탐색 후 이벤트입니다.

## 런타임 동작 및 실패 의미론

- 수동 압축은 먼저 현재 에이전트 작업을 중단합니다.
- `abortCompaction()`은 수동 및 자동 압축 컨트롤러를 모두 취소합니다.
- 자동 압축은 UI/상태 업데이트를 위해 시작/종료 세션 이벤트를 발생시킵니다.
- 자동 압축은 여러 모델 후보를 시도하고 일시적 실패를 재시도할 수 있습니다.
- 오버플로우 오류는 압축에 의해 처리되므로 일반 재시도 경로에서 제외됩니다.
- 자동 압축이 실패하면:
  - 오버플로우 경로는 `Context overflow recovery failed: ...`를 발생시킵니다
  - 임계값 경로는 `Auto-compaction failed: ...`를 발생시킵니다
- 브랜치 요약은 중단 신호(예: Escape)를 통해 취소될 수 있으며, 취소/중단된 탐색 결과를 반환합니다.

## 설정 및 기본값

`settings-schema.ts`에서:

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

이 값들은 런타임에 `AgentSession` 및 압축/브랜치 요약 모듈에서 사용됩니다.
