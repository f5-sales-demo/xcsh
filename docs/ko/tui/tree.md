---
title: Tree 명령어 참조
description: 세션 기록 및 대화 분기를 시각화하기 위한 /tree 명령어 참조입니다.
sidebar:
  order: 4
  label: /tree 명령어
i18n:
  sourceHash: ee0e412fe993
  translator: machine
---

# `/tree` 명령어 참조

`/tree`는 대화형 **세션 트리** 탐색기를 엽니다. 현재 세션 파일의 모든 항목으로 이동하여 해당 지점부터 계속할 수 있습니다.

이것은 파일 내 리프 이동이며, 새 세션 내보내기가 아닙니다.

## `/tree`가 하는 일

- 현재 세션 항목으로부터 트리를 구성합니다 (`SessionManager.getTree()`)
- 키보드 탐색, 필터, 검색 기능이 있는 `TreeSelectorComponent`를 엽니다
- 선택 시 `AgentSession.navigateTree(targetId, { summarize, customInstructions })`를 호출합니다
- 새 리프 경로에서 표시되는 채팅을 다시 구성합니다
- 사용자/커스텀 메시지를 선택할 때 선택적으로 에디터 텍스트를 미리 채웁니다

주요 구현:

- `src/modes/controllers/input-controller.ts` (`/tree`, 키바인딩 연결, 더블 이스케이프 동작)
- `src/modes/controllers/selector-controller.ts` (트리 UI 실행 + 요약 프롬프트 흐름)
- `src/modes/components/tree-selector.ts` (탐색, 필터, 검색, 라벨, 렌더링)
- `src/session/agent-session.ts` (`navigateTree` 리프 전환 + 선택적 요약)
- `src/session/session-manager.ts` (`getTree`, `branch`, `branchWithSummary`, `resetLeaf`, 라벨 영속성)

## 여는 방법

다음 중 어느 것이든 동일한 선택기를 엽니다:

- `/tree`
- 설정된 키바인딩 액션 `tree`
- 에디터가 비어있을 때 더블 이스케이프 (`doubleEscapeAction = "tree"`인 경우 (기본값))
- `doubleEscapeAction = "tree"`일 때 `/branch` (사용자 전용 분기 선택기 대신 트리 선택기로 이동)

## 트리 UI 모델

트리는 세션 항목의 부모 포인터(`id` / `parentId`)로부터 렌더링됩니다.

- 자식 노드는 타임스탬프 오름차순으로 정렬됩니다 (오래된 것이 먼저, 최신이 아래)
- 활성 분기(루트에서 현재 리프까지의 경로)는 불릿으로 표시됩니다
- 라벨(있는 경우)은 노드 텍스트 앞에 `[label]`로 렌더링됩니다
- 여러 루트가 존재하는 경우(고아/끊어진 부모 체인), 가상 분기 루트 아래에 표시됩니다

```text
트리 뷰 예시 (활성 경로는 •로 표시):

├─ user: "Start task"
│  └─ assistant: "Plan"
│     ├─ • user: "Try approach A"
│     │  └─ • assistant: "A result"
│     │     └─ • [milestone] user: "Continue A"
│     └─ user: "Try approach B"
│        └─ assistant: "B result"
```

선택기는 현재 선택 항목을 중심으로 재배치되며 최대 다음만큼의 행을 표시합니다:

- `max(5, floor(terminalHeight / 2))` 행

## 트리 선택기 내 키바인딩

- `Up` / `Down`: 선택 이동 (순환)
- `Left` / `Right`: 페이지 위 / 페이지 아래
- `Enter`: 노드 선택
- `Esc`: 검색이 활성 상태이면 지우기; 그렇지 않으면 선택기 닫기
- `Ctrl+C`: 선택기 닫기
- `입력`: 검색 쿼리에 추가
- `Backspace`: 검색 문자 삭제
- `Shift+L`: 선택된 항목의 라벨 편집/지우기
- `Ctrl+O`: 필터 순방향 순환
- `Shift+Ctrl+O`: 필터 역방향 순환
- `Alt+D/T/U/L/A`: 특정 필터 모드로 직접 이동

## 필터 및 검색 의미론

필터 모드 (`TreeList`):

1. `default`
2. `no-tools`
3. `user-only`
4. `labeled-only`
5. `all`

### `default`

대부분의 대화 노드를 표시하지만 관리용 항목 유형은 숨깁니다:

- `label`
- `custom`
- `model_change`
- `thinking_level_change`

### `no-tools`

`default`와 동일하며, `toolResult` 메시지도 추가로 숨깁니다.

### `user-only`

역할이 `user`인 `message` 항목만 표시합니다.

### `labeled-only`

현재 라벨이 할당된 항목만 표시합니다.

### `all`

관리용/커스텀 항목을 포함하여 세션 트리의 모든 것을 표시합니다.

### 도구 전용 어시스턴트 노드 동작

**도구 호출만** 포함하는(텍스트 없는) 어시스턴트 메시지는 다음 경우를 제외하고 모든 필터 뷰에서 기본적으로 숨겨집니다:

- 메시지가 오류/중단 상태인 경우 (`stopReason`이 `stop`/`toolUse`가 아닌 경우), 또는
- 현재 리프인 경우 (항상 표시 유지)

### 검색 동작

- 쿼리는 공백으로 토큰화됩니다
- 매칭은 대소문자를 구분하지 않습니다
- 모든 토큰이 일치해야 합니다 (AND 의미론)
- 검색 가능한 텍스트에는 라벨, 역할, 유형별 콘텐츠(메시지 텍스트, 분기 요약 텍스트, 커스텀 유형, 도구 명령어 스니펫 등)가 포함됩니다

## 선택 결과 (중요)

`navigateTree`는 선택된 항목 유형으로부터 새 리프 동작을 계산합니다:

### `user` 메시지 선택

- 새 리프는 선택된 항목의 `parentId`가 됩니다
- 부모가 `null`인 경우(루트 사용자 메시지), 리프가 루트로 재설정됩니다 (`resetLeaf()`)
- 선택된 메시지 텍스트가 편집/재제출을 위해 에디터에 복사됩니다

### `custom_message` 선택

- 사용자 메시지와 동일한 리프 규칙 (`parentId`)
- 텍스트 콘텐츠가 추출되어 에디터에 복사됩니다

### 비사용자 노드 선택 (어시스턴트/도구/요약/압축/커스텀 관리용 등)

- 새 리프는 선택된 노드 id가 됩니다
- 에디터가 미리 채워지지 않습니다

### 현재 리프 선택

- 아무 동작 없음; 선택기가 "Already at this point"와 함께 닫힙니다

```text
선택 결정 (단순화):

selected node
   │
   ├─ is current leaf? ── yes ──> close selector (no-op)
   │
   ├─ is user/custom_message? ── yes ──> leaf := parentId (or resetLeaf for root)
   │                                     + prefill editor text
   │
   └─ otherwise ──> leaf := selected node id
                    + no editor prefill
```

## 전환 시 요약 흐름

요약 프롬프트는 `branchSummary.enabled`로 제어됩니다 (기본값: `false`).

활성화되면, 노드를 선택한 후 UI가 다음을 묻습니다:

- `No summary`
- `Summarize`
- `Summarize with custom prompt`

흐름 세부사항:

- 요약 프롬프트에서 Escape를 누르면 트리 선택기가 다시 열립니다
- 커스텀 프롬프트 취소 시 요약 선택 루프로 돌아갑니다
- 요약 중에 UI는 로더를 표시하고 `Esc`를 `abortBranchSummary()`에 바인딩합니다
- 요약이 중단되면 트리 선택기가 다시 열리고 이동이 적용되지 않습니다

`navigateTree` 내부 동작:

- 이전 리프에서 공통 조상까지의 폐기된 분기 항목을 수집합니다
- `session_before_tree`를 발행합니다 (확장 기능이 취소하거나 요약을 주입할 수 있음)
- 요청되었고 필요한 경우에만 기본 요약기를 사용합니다
- 다음으로 이동을 적용합니다:
  - 요약이 있을 때 `branchWithSummary(...)`
  - 요약 없는 비루트 이동 시 `branch(newLeafId)`
  - 요약 없는 루트 이동 시 `resetLeaf()`
- 에이전트 대화를 재구성된 세션 컨텍스트로 교체합니다
- `session_tree`를 발행합니다

참고: 사용자가 요약을 요청했지만 요약할 내용이 없는 경우, 요약 항목을 생성하지 않고 탐색이 진행됩니다.

## 라벨

트리 UI에서의 라벨 편집은 `appendLabelChange(targetId, label)`을 호출합니다.

- 비어있지 않은 라벨은 해석된 라벨을 설정/업데이트합니다
- 빈 라벨은 이를 지웁니다
- 라벨은 추가 전용 `label` 항목으로 저장됩니다
- 트리 노드는 원본 라벨 항목 기록이 아닌 해석된 라벨 상태를 표시합니다

## `/tree` vs 관련 작업

| 작업 | 범위 | 결과 |
|---|---|---|
| `/tree` | 현재 세션 파일 | 선택한 지점으로 리프를 이동 (동일 파일) |
| `/branch` | 보통 현재 세션 파일 -> 새 세션 파일 | 기본적으로 선택된 **사용자** 메시지에서 새 세션 파일로 분기; `doubleEscapeAction = "tree"`이면 `/branch`가 대신 트리 탐색 UI를 엽니다 |
| `/fork` | 현재 전체 세션 | 세션을 새로운 영속 세션 파일로 복제 |
| `/resume` | 세션 목록 | 다른 세션 파일로 전환 |

핵심 차이점: `/tree`는 하나의 세션 파일 내에서의 탐색/재배치 도구입니다. `/branch`, `/fork`, `/resume`는 모두 세션 파일 컨텍스트를 변경합니다.

## 운영자 워크플로우

### 현재 분기를 잃지 않고 이전 사용자 프롬프트에서 다시 실행

1. `/tree`
2. 이전 사용자 메시지를 검색/선택
3. `No summary` 선택 (또는 필요시 요약)
4. 에디터에 미리 채워진 텍스트를 편집
5. 제출

효과: 동일한 세션 파일 내에서 선택한 지점부터 새 분기가 성장합니다.

### 컨텍스트 표지와 함께 현재 분기를 떠나기

1. `branchSummary.enabled` 활성화
2. `/tree`로 대상 노드 선택
3. `Summarize` (또는 커스텀 프롬프트) 선택

효과: 계속하기 전에 대상 위치에 `branch_summary` 항목이 추가됩니다.

### 숨겨진 관리용 항목 조사

1. `/tree`
2. `Alt+A` (all) 누르기
3. `model`, `thinking`, `custom`, 또는 라벨 검색

효과: 대화 노드뿐만 아니라 전체 내부 타임라인을 검사합니다.

### 나중에 점프할 피벗 포인트 북마크

1. `/tree`
2. 항목으로 이동
3. `Shift+L`을 눌러 라벨 설정
4. 나중에 `Alt+L` (`labeled-only`)을 사용하여 빠르게 이동

효과: 지속적인 분기 랜드마크 간 빠른 탐색이 가능합니다.
