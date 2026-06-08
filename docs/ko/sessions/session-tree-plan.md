---
title: Session Tree Architecture
description: >-
  Session tree architecture with branching, navigation, and parent-child
  conversation relationships.
sidebar:
  order: 2
  label: Tree architecture
i18n:
  sourceHash: bd8b78d6c33a
  translator: machine
---

# 세션 트리 아키텍처 (현재)

참조: [session.md](./session.md)

이 문서는 현재 세션 트리 내비게이션이 어떻게 동작하는지 설명합니다: 인메모리 트리 모델, 리프 이동 규칙, 브랜칭 동작, 그리고 확장/이벤트 통합.

## 이 서브시스템이란

세션은 추가 전용(append-only) 엔트리 로그로 저장되지만, 런타임 동작은 트리 기반입니다:

- 모든 비헤더 엔트리는 `id`와 `parentId`를 가집니다.
- 활성 위치는 `SessionManager`의 `leafId`입니다.
- 엔트리를 추가하면 항상 현재 리프의 자식이 생성됩니다.
- 브랜칭은 히스토리를 **다시 작성하지 않습니다**; 다음 추가 전에 리프가 가리키는 위치만 변경합니다.

주요 파일:

- `src/session/session-manager.ts` — 트리 데이터 모델, 순회, 리프 이동, 브랜치/세션 추출
- `src/session/agent-session.ts` — `/tree` 내비게이션 흐름, 요약, 훅/이벤트 발행
- `src/modes/components/tree-selector.ts` — 대화형 트리 UI 동작 및 필터링
- `src/modes/controllers/selector-controller.ts` — `/tree` 및 `/branch`를 위한 셀렉터 오케스트레이션
- `src/modes/controllers/input-controller.ts` — 명령 라우팅 (`/tree`, `/branch`, 더블 이스케이프 동작)
- `src/session/messages.ts` — `branch_summary`, `compaction`, `custom_message` 엔트리를 LLM 컨텍스트 메시지로 변환

## `SessionManager`의 트리 데이터 모델

런타임 인덱스:

- `#byId: Map<string, SessionEntry>` — 모든 엔트리에 대한 빠른 조회
- `#leafId: string | null` — 트리에서의 현재 위치
- `#labelsById: Map<string, string>` — 대상 엔트리 id별 해결된 레이블

트리 API:

- `getBranch(fromId?)`는 부모 링크를 루트까지 탐색하여 루트→노드 경로를 반환합니다
- `getTree()`는 `SessionTreeNode[]` (`entry`, `children`, `label`)을 반환합니다
  - 부모 링크가 자식 배열로 변환됩니다
  - 부모가 없는 엔트리는 루트로 처리됩니다
  - 자식은 타임스탬프 기준 오래된 것→최신 순으로 정렬됩니다
- `getChildren(parentId)`는 직접 자식을 반환합니다
- `getLabel(id)`는 `labelsById`에서 현재 레이블을 해결합니다

`getTree()`는 런타임 프로젝션이며, 영속성은 추가 전용 JSONL 엔트리로 유지됩니다.

## 리프 이동 시맨틱스

세 가지 리프 이동 프리미티브가 있습니다:

1. `branch(entryId)`
   - 엔트리 존재 여부를 검증합니다
   - `leafId = entryId`로 설정합니다
   - 새로운 엔트리는 기록되지 않습니다

2. `resetLeaf()`
   - `leafId = null`로 설정합니다
   - 다음 추가 시 새로운 루트 엔트리가 생성됩니다 (`parentId = null`)

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - `branchFromId: string | null`을 받습니다
   - `leafId = branchFromId`로 설정합니다
   - 해당 리프의 자식으로 `branch_summary` 엔트리를 추가합니다
   - `branchFromId`가 `null`인 경우, `fromId`는 `"root"`로 영속화됩니다

## `/tree` 내비게이션 동작 (동일 세션 파일)

`AgentSession.navigateTree()`는 파일 포킹이 아닌 내비게이션입니다.

흐름:

1. 대상을 검증하고 포기된 경로를 계산합니다 (`collectEntriesForBranchSummary`)
2. `TreePreparation`과 함께 `session_before_tree`를 발행합니다
3. 선택적으로 포기된 엔트리를 요약합니다 (훅 제공 요약 또는 내장 요약기)
4. 새로운 리프 대상을 계산합니다:
   - **user** 메시지 선택 시: 리프가 부모로 이동하고, 메시지 텍스트가 에디터 프리필을 위해 반환됩니다
   - **custom_message** 선택 시: user 메시지와 동일한 규칙 (리프 = 부모, 텍스트가 에디터를 프리필)
   - 다른 엔트리 선택 시: 리프 = 선택된 엔트리 id
5. 리프 이동을 적용합니다:
   - 요약 포함 시: `branchWithSummary(newLeafId, ...)`
   - 요약 없이 `newLeafId === null`인 경우: `resetLeaf()`
   - 그 외: `branch(newLeafId)`
6. 새로운 리프에서 에이전트 컨텍스트를 재구성하고 `session_tree`를 발행합니다

중요: 요약 엔트리는 포기된 브랜치 끝이 아닌 **새로운 내비게이션 위치**에 첨부됩니다.

## `/branch` 동작 (새 세션 파일)

`/branch`와 `/tree`는 의도적으로 다릅니다:

- `/tree`는 현재 세션 파일 내에서 내비게이션합니다.
- `/branch`는 새로운 세션 브랜치 파일을 생성합니다 (비영속 모드에서는 인메모리 대체).

사용자 대면 `/branch` 흐름 (`SelectorController.showUserMessageSelector` → `AgentSession.branch`):

- 브랜치 소스는 **user 메시지**여야 합니다.
- 선택된 사용자 텍스트가 에디터 프리필을 위해 추출됩니다.
- 선택된 사용자 메시지가 루트인 경우 (`parentId === null`): `newSession({ parentSession: previousSessionFile })`을 통해 새 세션을 시작합니다.
- 그 외: `createBranchedSession(selectedEntry.parentId)`를 통해 선택된 프롬프트 경계까지 히스토리를 포크합니다.

`SessionManager.createBranchedSession(leafId)` 세부사항:

- `getBranch(leafId)`를 통해 루트→리프 경로를 구성합니다; 없으면 예외를 발생시킵니다.
- 복사 경로에서 기존 `label` 엔트리를 제외합니다.
- 경로에 남아있는 엔트리에 대해 해결된 `labelsById`로부터 새로운 레이블 엔트리를 재구성합니다.
- 영속 모드: 새 JSONL 파일을 작성하고 매니저를 해당 파일로 전환합니다; 새 파일 경로를 반환합니다.
- 인메모리 모드: 인메모리 엔트리를 대체합니다; `undefined`를 반환합니다.

## 컨텍스트 재구성과 요약/커스텀 통합

`buildSessionContext()` (`session-manager.ts` 내)는 활성 루트→리프 경로를 해결하고 유효한 LLM 컨텍스트 상태를 구성합니다:

- 경로상의 최신 thinking/model/mode/ttsr 상태를 추적합니다.
- 경로상의 최신 압축(compaction)을 처리합니다:
  - 먼저 압축 요약을 발행합니다
  - `firstKeptEntryId`부터 압축 지점까지 유지된 메시지를 재생합니다
  - 그런 다음 압축 이후 메시지를 재생합니다
- `branch_summary`와 `custom_message` 엔트리를 `AgentMessage` 객체로 포함합니다.

`session/messages.ts`는 이러한 메시지 타입을 모델 입력용으로 매핑합니다:

- `branchSummary`와 `compactionSummary`는 user 역할의 템플릿 컨텍스트 메시지가 됩니다
- `custom`/`hookMessage`는 user 역할의 콘텐츠 메시지가 됩니다

따라서 트리 이동은 이전 엔트리를 변경하는 것이 아니라, 활성 리프 경로를 변경하여 컨텍스트를 바꿉니다.

## 레이블과 트리 UI 동작

레이블 영속성:

- `appendLabelChange(targetId, label?)`는 현재 리프 체인에 `label` 엔트리를 기록합니다.
- `labelsById`는 즉시 업데이트됩니다 (설정 또는 삭제).
- `getTree()`는 반환된 각 노드에 현재 레이블을 해결합니다.

트리 셀렉터 동작 (`tree-selector.ts`):

- 내비게이션을 위해 트리를 평탄화하고, 활성 경로 하이라이팅을 유지하며, 활성 브랜치를 우선 표시합니다.
- 필터 모드를 지원합니다: `default`, `no-tools`, `user-only`, `labeled-only`, `all`.
- 렌더링된 시맨틱 콘텐츠에 대한 자유 텍스트 검색을 지원합니다.
- `Shift+L`은 인라인 레이블 편집을 열고 `appendLabelChange`를 통해 기록합니다.

명령 라우팅:

- `/tree`는 항상 트리 셀렉터를 엽니다.
- `/branch`는 `doubleEscapeAction=tree`가 아닌 한 user 메시지 셀렉터를 엽니다. 해당 설정인 경우 트리 셀렉터 UX를 사용합니다.

## 트리 작업을 위한 확장 및 훅 접점

명령 시점 확장 API (`ExtensionCommandContext`):

- `branch(entryId)` — 브랜치된 세션 파일 생성
- `navigateTree(targetId, { summarize? })` — 현재 트리/파일 내에서 이동

트리 내비게이션 관련 이벤트:

- `session_before_tree`
  - `TreePreparation`을 수신합니다:
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - 내비게이션을 취소할 수 있습니다
  - 내장 요약기 대신 사용할 요약 페이로드를 제공할 수 있습니다
  - 중단 `signal`을 수신합니다 (Escape 취소 경로)
- `session_tree`
  - `newLeafId`, `oldLeafId`를 발행합니다
  - 요약이 생성된 경우 `summaryEntry`를 포함합니다
  - `fromExtension`은 요약 출처를 나타냅니다

인접하지만 관련된 라이프사이클 훅:

- `/branch` 흐름을 위한 `session_before_branch` / `session_branch`
- 이후 트리 컨텍스트 재구성에 영향을 미치는 압축 엔트리를 위한 `session_before_compact`, `session.compacting`, `session_compact`

## 실제 제약 사항과 엣지 케이스

- `branch()`는 `null`을 대상으로 할 수 없습니다; 첫 번째 엔트리 이전의 루트 상태를 위해서는 `resetLeaf()`를 사용하세요.
- `branchWithSummary()`는 `null` 대상을 지원하며 `fromId: "root"`를 기록합니다.
- 트리 셀렉터에서 현재 리프를 선택하면 아무 동작도 하지 않습니다.
- 요약에는 활성 모델이 필요합니다; 없으면 요약 내비게이션이 즉시 실패합니다.
- 요약이 중단되면 내비게이션이 취소되고 리프는 변경되지 않습니다.
- 인메모리 세션은 `createBranchedSession`에서 브랜치 파일 경로를 절대 반환하지 않습니다.

## 여전히 존재하는 레거시 호환성

세션 마이그레이션은 로드 시 계속 실행됩니다:

- v1→v2는 `id`/`parentId`를 추가하고 압축 인덱스 앵커를 id 앵커로 변환합니다
- v2→v3는 레거시 `hookMessage` 역할을 `custom`으로 마이그레이션합니다

현재 런타임 동작은 마이그레이션 이후 버전 3 트리 시맨틱스입니다.
