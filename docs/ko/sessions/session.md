---
title: 세션 저장소 및 항목 모델
description: '항목 유형, 영속성, 포맷 간 마이그레이션을 포함한 추가 전용 세션 저장소 모델.'
sidebar:
  order: 1
  label: 저장소 및 항목 모델
i18n:
  sourceHash: 42fe17549e00
  translator: machine
---

# 세션 저장소 및 항목 모델

이 문서는 코딩 에이전트 세션이 어떻게 표현되고, 영속화되며, 마이그레이션되고, 런타임에 재구성되는지에 대한 단일 진실 공급원(source of truth)입니다.

## 범위

다루는 내용:

- 세션 JSONL 포맷 및 버전 관리
- 항목 분류 체계 및 트리 의미론 (`id`/`parentId` + 리프 포인터)
- 오래되거나 잘못된 형식의 파일을 로드할 때의 마이그레이션/호환성 동작
- 컨텍스트 재구성 (`buildSessionContext`)
- 영속성 보장, 실패 동작, 잘라내기/블롭 외부화
- 저장소 추상화 (`FileSessionStorage`, `MemorySessionStorage`) 및 관련 유틸리티

세션 데이터에 영향을 미치는 의미론을 넘어서는 `/tree` UI 렌더링 동작은 다루지 않습니다.

## 구현 파일

- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`src/session/messages.ts`](../../packages/coding-agent/src/session/messages.ts)
- [`src/session/session-storage.ts`](../../packages/coding-agent/src/session/session-storage.ts)
- [`src/session/history-storage.ts`](../../packages/coding-agent/src/session/history-storage.ts)
- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts)

## 디스크 상의 레이아웃

기본 세션 파일 위치:

```text
~/.xcsh/agent/sessions/--<cwd-encoded>--/<timestamp>_<sessionId>.jsonl
```

`<cwd-encoded>`는 작업 디렉터리에서 선행 슬래시를 제거하고 `/`, `\\`, `:`를 `-`로 대체하여 파생됩니다.

블롭 저장소 위치:

```text
~/.xcsh/agent/blobs/<sha256>
```

터미널 브레드크럼 파일은 다음 경로에 작성됩니다:

```text
~/.xcsh/agent/terminal-sessions/<terminal-id>
```

브레드크럼 내용은 두 줄로 구성됩니다: 원본 cwd, 그 다음 세션 파일 경로. `continueRecent()`는 가장 최근 mtime을 스캔하기 전에 이 터미널 범위 포인터를 우선적으로 사용합니다.

## 파일 포맷

세션 파일은 JSONL입니다: 한 줄에 하나의 JSON 객체.

- 1번째 줄은 항상 세션 헤더입니다 (`type: "session"`).
- 나머지 줄은 `SessionEntry` 값입니다.
- 항목은 런타임에 추가 전용입니다; 브랜치 탐색은 기존 항목을 변경하지 않고 포인터(`leafId`)를 이동합니다.

### 헤더 (`SessionHeader`)

```json
{
  "type": "session",
  "version": 3,
  "id": "1f9d2a6b9c0d1234",
  "timestamp": "2026-02-16T10:20:30.000Z",
  "cwd": "/work/pi",
  "title": "optional session title",
  "parentSession": "optional lineage marker"
}
```

참고 사항:

- v1 파일에서 `version`은 선택 사항이며, 없으면 v1을 의미합니다.
- `parentSession`은 불투명한 계보 문자열입니다. 현재 코드는 흐름에 따라 세션 id 또는 세션 경로를 작성합니다 (`fork`, `forkFrom`, `createBranchedSession`, 또는 명시적 `newSession({ parentSession })`). 타입이 지정된 외래 키가 아닌 메타데이터로 취급하십시오.

### 항목 기본 (`SessionEntryBase`)

헤더가 아닌 모든 항목은 다음을 포함합니다:

```json
{
  "type": "...",
  "id": "8-char-id",
  "parentId": "previous-or-branch-parent",
  "timestamp": "2026-02-16T10:20:30.000Z"
}
```

`parentId`는 루트 항목(첫 번째 추가, 또는 `resetLeaf()` 이후)에 대해 `null`일 수 있습니다.

## 항목 분류 체계

`SessionEntry`는 다음의 합집합입니다:

- `message`
- `thinking_level_change`
- `model_change`
- `compaction`
- `branch_summary`
- `custom`
- `custom_message`
- `label`
- `ttsr_injection`
- `session_init`
- `mode_change`

### `message`

`AgentMessage`를 직접 저장합니다.

```json
{
  "type": "message",
  "id": "a1b2c3d4",
  "parentId": null,
  "timestamp": "2026-02-16T10:21:00.000Z",
  "message": {
    "role": "assistant",
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "content": [{ "type": "text", "text": "Done." }],
    "usage": { "input": 100, "output": 20, "cacheRead": 0, "cacheWrite": 0, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } },
    "timestamp": 1760000000000
  }
}
```

### `model_change`

```json
{
  "type": "model_change",
  "id": "b1c2d3e4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:21:30.000Z",
  "model": "openai/gpt-4o",
  "role": "default"
}
```

`role`은 선택 사항이며, 없으면 컨텍스트 재구성 시 `default`로 처리됩니다.

### `thinking_level_change`

```json
{
  "type": "thinking_level_change",
  "id": "c1d2e3f4",
  "parentId": "b1c2d3e4",
  "timestamp": "2026-02-16T10:22:00.000Z",
  "thinkingLevel": "high"
}
```

### `compaction`

```json
{
  "type": "compaction",
  "id": "d1e2f3a4",
  "parentId": "c1d2e3f4",
  "timestamp": "2026-02-16T10:23:00.000Z",
  "summary": "Conversation summary",
  "shortSummary": "Short recap",
  "firstKeptEntryId": "a1b2c3d4",
  "tokensBefore": 42000,
  "details": { "readFiles": ["src/a.ts"] },
  "preserveData": { "hookState": true },
  "fromExtension": false
}
```

### `branch_summary`

```json
{
  "type": "branch_summary",
  "id": "e1f2a3b4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:24:00.000Z",
  "fromId": "a1b2c3d4",
  "summary": "Summary of abandoned path",
  "details": { "note": "optional" },
  "fromExtension": true
}
```

루트에서 분기하는 경우 (`branchFromId === null`), `fromId`는 리터럴 문자열 `"root"`입니다.

### `custom`

확장 상태 영속화; `buildSessionContext`에서 무시됩니다.

```json
{
  "type": "custom",
  "id": "f1a2b3c4",
  "parentId": "e1f2a3b4",
  "timestamp": "2026-02-16T10:25:00.000Z",
  "customType": "my-extension",
  "data": { "state": 1 }
}
```

### `custom_message`

LLM 컨텍스트에 참여하는 확장 제공 메시지입니다.

```json
{
  "type": "custom_message",
  "id": "a2b3c4d5",
  "parentId": "f1a2b3c4",
  "timestamp": "2026-02-16T10:26:00.000Z",
  "customType": "my-extension",
  "content": "Injected context",
  "display": true,
  "details": { "debug": false }
}
```

### `label`

```json
{
  "type": "label",
  "id": "b2c3d4e5",
  "parentId": "a2b3c4d5",
  "timestamp": "2026-02-16T10:27:00.000Z",
  "targetId": "a1b2c3d4",
  "label": "checkpoint"
}
```

`label: undefined`는 `targetId`에 대한 레이블을 지웁니다.

### `ttsr_injection`

```json
{
  "type": "ttsr_injection",
  "id": "c2d3e4f5",
  "parentId": "b2c3d4e5",
  "timestamp": "2026-02-16T10:28:00.000Z",
  "injectedRules": ["ruleA", "ruleB"]
}
```

### `session_init`

```json
{
  "type": "session_init",
  "id": "d2e3f4a5",
  "parentId": "c2d3e4f5",
  "timestamp": "2026-02-16T10:29:00.000Z",
  "systemPrompt": "...",
  "task": "...",
  "tools": ["read", "edit"],
  "outputSchema": { "type": "object" }
}
```

### `mode_change`

```json
{
  "type": "mode_change",
  "id": "e2f3a4b5",
  "parentId": "d2e3f4a5",
  "timestamp": "2026-02-16T10:30:00.000Z",
  "mode": "plan",
  "data": { "planFile": "/tmp/plan.md" }
}
```

## 버전 관리 및 마이그레이션

현재 세션 버전: `3`.

### v1 -> v2

헤더 `version`이 없거나 `< 2`일 때 적용됩니다:

- 각 비헤더 항목에 `id`와 `parentId`를 추가합니다.
- 파일 순서를 사용하여 선형 부모 체인을 재구성합니다.
- 존재하는 경우 컴팩션 필드 `firstKeptEntryIndex` -> `firstKeptEntryId`를 마이그레이션합니다.
- 헤더 `version = 2`로 설정합니다.

### v2 -> v3

헤더 `version < 3`일 때 적용됩니다:

- `message` 항목: 레거시 `message.role === "hookMessage"`를 `"custom"`으로 다시 작성합니다.
- 헤더 `version = 3`으로 설정합니다.

### 마이그레이션 트리거 및 영속화

- 마이그레이션은 세션 로드 시 실행됩니다 (`setSessionFile`).
- 마이그레이션이 실행되면 전체 파일이 즉시 디스크에 다시 작성됩니다.
- 마이그레이션은 먼저 메모리 내 항목을 변경한 다음 재작성된 JSONL을 영속화합니다.

## 로드 및 호환성 동작

`loadEntriesFromFile(path)` 동작:

- 파일 없음 (`ENOENT`) -> `[]`을 반환합니다.
- 파싱할 수 없는 줄은 관대한 JSONL 파서(`parseJsonlLenient`)로 처리됩니다.
- 첫 번째로 파싱된 항목이 유효한 세션 헤더가 아닌 경우 (`type !== "session"` 또는 문자열 `id` 누락) -> `[]`을 반환합니다.

`SessionManager.setSessionFile()` 동작:

- 로더에서 `[]`이 반환되면 빈/존재하지 않는 세션으로 처리되며 해당 경로에 새로 초기화된 세션 파일로 대체됩니다.
- 유효한 파일은 로드되고, 필요시 마이그레이션되며, 블롭 참조가 해결된 후 인덱싱됩니다.

## 트리 및 리프 의미론

기본 모델은 추가 전용 트리 + 가변 리프 포인터입니다:

- 모든 추가 메서드는 `parentId`가 현재 `leafId`인 새 항목을 정확히 하나 생성합니다.
- 새 항목이 새로운 `leafId`가 됩니다.
- `branch(entryId)`는 `leafId`만 이동합니다; 기존 항목은 변경되지 않습니다.
- `resetLeaf()`는 `leafId = null`로 설정합니다; 다음 추가는 새 루트 항목을 생성합니다 (`parentId: null`).
- `branchWithSummary()`는 리프를 브랜치 대상으로 설정하고 `branch_summary` 항목을 추가합니다.

`getEntries()`는 모든 비헤더 항목을 삽입 순서로 반환합니다. 기존 항목은 정상 작업에서 삭제되지 않습니다; 재작성은 표현을 업데이트하면서 논리적 히스토리를 보존합니다 (마이그레이션, 이동, 대상 지정 재작성 헬퍼).

## 컨텍스트 재구성 (`buildSessionContext`)

`buildSessionContext(entries, leafId, byId?)`는 모델에 전송될 내용을 결정합니다.

알고리즘:

1. 리프 결정:
   - `leafId === null` -> 빈 컨텍스트를 반환합니다.
   - 명시적 `leafId` -> 해당 항목이 있으면 사용합니다.
   - 그 외에는 마지막 항목으로 폴백합니다.
2. 리프에서 루트까지 `parentId` 체인을 순회하고 루트->리프 경로로 역순 정렬합니다.
3. 경로를 따라 런타임 상태를 도출합니다:
   - 최신 `thinking_level_change`에서 `thinkingLevel` (기본값 `"off"`)
   - `model_change` 항목에서 모델 맵 (`role ?? "default"`)
   - 명시적 모델 변경이 없는 경우 어시스턴트 메시지 provider/model에서 폴백 `models.default`
   - 모든 `ttsr_injection` 항목에서 중복 제거된 `injectedTtsrRules`
   - 최신 `mode_change`에서 mode/modeData (기본 모드 `"none"`)
4. 메시지 목록 구축:
   - `message` 항목은 그대로 통과합니다
   - `custom_message` 항목은 `createCustomMessage`를 통해 `custom` AgentMessages가 됩니다
   - `branch_summary` 항목은 `createBranchSummaryMessage`를 통해 `branchSummary` AgentMessages가 됩니다
   - 경로에 `compaction`이 존재하는 경우:
     - 먼저 컴팩션 요약을 출력합니다 (`createCompactionSummaryMessage`)
     - `firstKeptEntryId`부터 컴팩션 경계까지의 경로 항목을 출력합니다
     - 컴팩션 경계 이후의 항목을 출력합니다

`custom` 및 `session_init` 항목은 모델 컨텍스트를 직접 주입하지 않습니다.

## 영속성 보장 및 실패 모델

### 영속 vs 인메모리

- `SessionManager.create/open/continueRecent/forkFrom` -> 영속 모드 (`persist = true`).
- `SessionManager.inMemory` -> 비영속 모드 (`persist = false`), `MemorySessionStorage` 사용.

### 쓰기 파이프라인

쓰기는 내부 프로미스 체인 (`#persistChain`)과 `NdjsonFileWriter`를 통해 직렬화됩니다.

- `append*`는 인메모리 상태를 즉시 업데이트합니다.
- 영속화는 최소 하나의 어시스턴트 메시지가 존재할 때까지 지연됩니다.
  - 첫 번째 어시스턴트 이전: 항목은 메모리에 유지되며; 파일 추가가 발생하지 않습니다.
  - 첫 번째 어시스턴트가 존재할 때: 전체 인메모리 세션이 파일로 플러시됩니다.
  - 이후: 새 항목이 증분적으로 추가됩니다.

코드에서의 근거: 어시스턴트 응답을 생성하지 않은 세션의 영속화를 방지합니다.

### 내구성 작업

- `flush()`는 라이터를 플러시하고 `fsync()`를 호출합니다.
- 원자적 전체 재작성 (`#rewriteFile`)은 임시 파일에 쓰고, flush+fsync, 닫기, 그런 다음 대상 위로 rename합니다.
- 마이그레이션, `setSessionName`, `rewriteEntries`, 이동 작업, 및 도구 호출 인수 재작성에 사용됩니다.

### 오류 동작

- 영속화 오류는 래치됩니다 (`#persistError`) 그리고 후속 작업에서 다시 던져집니다.
- 첫 번째 오류는 세션 파일 컨텍스트와 함께 한 번만 로깅됩니다.
- 라이터 닫기는 최선의 노력(best-effort)이지만 첫 번째 의미 있는 오류를 전파합니다.

## 데이터 크기 제어 및 블롭 외부화

항목 영속화 전:

- 큰 문자열은 `MAX_PERSIST_CHARS` (500,000자)로 잘리며 다음 알림이 포함됩니다:
  - `"[Session persistence truncated large content]"`
- 임시 필드 `partialJson`과 `jsonlEvents`가 제거됩니다.
- 객체에 `content`와 `lineCount`가 모두 있는 경우, 잘라내기 후 줄 수가 다시 계산됩니다.
- `content` 배열의 이미지 블록 중 base64 길이가 >= 1024인 것은 블롭 참조로 외부화됩니다:
  - `blob:sha256:<hash>`로 저장됩니다
  - 원시 바이트가 블롭 저장소에 기록됩니다 (`BlobStore.put`)

로드 시 블롭 참조는 message/custom_message 이미지 블록에 대해 다시 base64로 해결됩니다.

## 저장소 추상화

`SessionStorage` 인터페이스는 `SessionManager`가 사용하는 모든 파일시스템 작업을 제공합니다:

- 동기: `ensureDirSync`, `existsSync`, `writeTextSync`, `statSync`, `listFilesSync`
- 비동기: `exists`, `readText`, `readTextPrefix`, `writeText`, `rename`, `unlink`, `openWriter`

구현:

- `FileSessionStorage`: 실제 파일시스템 (Bun + node fs)
- `MemorySessionStorage`: 테스트/비영속 세션을 위한 맵 기반 인메모리 구현

`SessionStorageWriter`는 `writeLine`, `flush`, `fsync`, `close`, `getError`를 노출합니다.

## 세션 탐색 유틸리티

`session-manager.ts`에 정의되어 있습니다:

- `getRecentSessions(sessionDir, limit)` -> UI/세션 선택기를 위한 경량 메타데이터
- `findMostRecentSession(sessionDir)` -> mtime 기준 최신
- `list(cwd, sessionDir?)` -> 하나의 프로젝트 범위 내 세션
- `listAll()` -> `~/.xcsh/agent/sessions` 아래의 모든 프로젝트 범위에 걸친 세션

메타데이터 추출은 가능한 경우 접두사만 읽습니다 (`readTextPrefix(..., 4096)`).

## 관련하지만 별개: 프롬프트 히스토리 저장소

`HistoryStorage` (`history-storage.ts`)는 세션 재생이 아닌 프롬프트 호출/검색을 위한 별도의 SQLite 하위 시스템입니다.

- DB: `~/.xcsh/agent/history.db`
- 테이블: `history(id, prompt, created_at, cwd)`
- FTS5 인덱스: 트리거로 유지 관리되는 동기화가 있는 `history_fts`
- 인메모리 마지막 프롬프트 캐시를 사용하여 연속된 동일 프롬프트를 중복 제거합니다
- 비동기 삽입 (`setImmediate`)으로 프롬프트 캡처가 턴 실행을 차단하지 않습니다

대화 그래프/상태 재생에는 세션 파일을 사용하고; 프롬프트 히스토리 UX에는 `HistoryStorage`를 사용하십시오.
