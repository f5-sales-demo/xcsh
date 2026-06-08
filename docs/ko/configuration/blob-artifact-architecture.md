---
title: Blob 및 아티팩트 저장소 아키텍처
description: '세션 미디어, 스크린샷 및 도구 출력을 위한 콘텐츠 주소 기반 blob 저장소와 아티팩트 레지스트리.'
sidebar:
  order: 7
  label: Blob 및 아티팩트 저장소
i18n:
  sourceHash: 70d255f48d5b
  translator: machine
---

# Blob 및 아티팩트 저장소 아키텍처

이 문서는 coding-agent가 세션 JSONL 외부에 대용량/바이너리 페이로드를 저장하는 방법, 잘린 도구 출력이 어떻게 지속되는지, 그리고 내부 URL(`artifact://`, `agent://`)이 저장된 데이터로 어떻게 해석되는지를 설명합니다.

## 두 가지 저장 시스템이 존재하는 이유

런타임은 서로 다른 데이터 형태에 대해 두 가지 다른 영속성 메커니즘을 사용합니다:

- **콘텐츠 주소 기반 blob** (`blob:sha256:<hash>`): 지속된 세션 항목에서 대용량 이미지 base64 페이로드를 외부화하는 데 사용되는 전역 바이너리 지향 저장소.
- **세션 범위 아티팩트** (`<sessionFile-without-.jsonl>/` 하위 파일들): 전체 도구 출력 및 하위 에이전트 출력에 사용되는 세션별 텍스트 파일.

이들은 의도적으로 분리되어 있습니다:

- blob 저장소는 콘텐츠 해시를 통한 중복 제거와 안정적인 참조를 최적화하고,
- 아티팩트 저장소는 추가 전용 세션 도구 사용과 로컬 ID를 통한 사람/도구의 검색을 최적화합니다.

## 저장소 경계 및 디스크 레이아웃

## Blob 저장소 경계 (전역)

`SessionManager`는 `BlobStore(getBlobsDir())`를 생성하므로, blob 파일은 공유 전역 blob 디렉토리에 저장됩니다(세션 폴더가 아님).

Blob 파일 명명 규칙:

- 파일 경로: `<blobsDir>/<sha256-hex>`
- 확장자 없음
- 항목에 저장되는 참조 문자열: `blob:sha256:<sha256-hex>`

시사점:

- 세션 간 동일한 바이너리 콘텐츠는 동일한 해시/경로로 해석됩니다,
- 쓰기는 콘텐츠 수준에서 멱등적입니다,
- blob은 개별 세션 파일보다 오래 존속할 수 있습니다.

## 아티팩트 경계 (세션 로컬)

`ArtifactManager`는 세션 파일 경로에서 아티팩트 디렉토리를 유도합니다:

- 세션 파일: `.../<timestamp>_<sessionId>.jsonl`
- 아티팩트 디렉토리: `.../<timestamp>_<sessionId>/` (`.jsonl` 제거)

아티팩트 유형은 이 디렉토리를 공유합니다:

- 잘린 도구 출력 파일: `<numericId>.<toolType>.log` (`artifact://`용)
- 하위 에이전트 출력 파일: `<outputId>.md` (`agent://`용)

## ID 및 이름 할당 체계

## Blob ID: 콘텐츠 해시

`BlobStore.put()`은 원시 바이너리 바이트에 대해 SHA-256을 계산하고 다음을 반환합니다:

- `hash`: 16진수 다이제스트,
- `path`: `<blobsDir>/<hash>`,
- `ref`: `blob:sha256:<hash>`.

세션 로컬 카운터는 사용되지 않습니다.

## 아티팩트 ID: 세션 로컬 단조 증가 정수

`ArtifactManager`는 최초 사용 시 기존 `*.log` 아티팩트 파일을 스캔하여 최대 기존 숫자 ID를 찾고 `nextId = max + 1`을 설정합니다.

할당 동작:

- 파일 형식: `{id}.{toolType}.log`
- ID는 순차적 문자열입니다 (`"0"`, `"1"`, ...)
- 재개 시 스캔이 할당 전에 수행되므로 기존 아티팩트를 덮어쓰지 않습니다.

아티팩트 디렉토리가 없는 경우, 스캔은 빈 목록을 반환하고 할당은 `0`부터 시작합니다.

## 에이전트 출력 ID (`agent://`)

`AgentOutputManager`는 하위 에이전트 출력의 ID를 `<index>-<requestedId>`로 할당합니다(선택적으로 상위 접두사 아래에 중첩, 예: `0-Parent.1-Child`). 초기화 시 기존 `.md` 파일을 스캔하여 재개 시 다음 인덱스부터 계속합니다.

## 영속성 데이터 흐름

## 1) 세션 항목 영속성 재작성 경로

세션 항목이 작성되기 전(`#rewriteFile` / 증분 영속화), `SessionManager`는 (`truncateForPersistence`를 통해) `prepareEntryForPersistence()`를 호출합니다.

주요 동작:

1. **대용량 문자열 잘림**: 초과 크기 문자열이 잘리고 `"[Session persistence truncated large content]"` 접미사가 붙습니다.
2. **임시 필드 제거**: `partialJson`과 `jsonlEvents`가 영속화된 항목에서 제거됩니다.
3. **이미지의 blob 외부화**:
   - `content` 배열의 이미지 블록에만 적용됩니다,
   - `data`가 이미 blob 참조가 아닌 경우에만 적용됩니다,
   - base64 길이가 최소 임계값 이상인 경우에만 적용됩니다 (`BLOB_EXTERNALIZE_THRESHOLD = 1024`),
   - 인라인 base64를 `blob:sha256:<hash>`로 대체합니다.

이를 통해 세션 JSONL을 컴팩트하게 유지하면서 복구 가능성을 보존합니다.

## 2) 세션 로드 재수화 경로

세션을 열 때(`setSessionFile`), 마이그레이션 후 `SessionManager`는 `resolveBlobRefsInEntries()`를 실행합니다.

`blob:sha256:<hash>`를 가진 각 메시지/커스텀 메시지 이미지 블록에 대해:

- blob 저장소에서 blob 바이트를 읽고,
- 바이트를 다시 base64로 변환하고,
- 런타임 소비자를 위해 인메모리 항목을 인라인 base64로 변경합니다.

blob이 없는 경우:

- `resolveImageData()`가 경고를 기록하고,
- 원본 참조 문자열을 변경 없이 반환하고,
- 로드가 계속됩니다(하드 크래시 없음).

## 3) 도구 출력 스필/잘림 경로

`OutputSink`는 bash/python/ssh 및 관련 실행기에서 스트리밍 출력을 구동합니다.

동작:

1. 모든 청크는 정제되어 인메모리 테일 버퍼에 추가됩니다.
2. 인메모리 바이트가 스필 임계값(`DEFAULT_MAX_BYTES`, 50KB)을 초과하면, sink는 출력을 잘림으로 표시합니다.
3. 아티팩트 경로가 사용 가능한 경우, sink는 파일 라이터를 열고 다음을 기록합니다:
   - 기존 버퍼된 콘텐츠를 한 번,
   - 이후 모든 청크.
4. 인메모리 버퍼는 표시를 위해 항상 테일 윈도우로 잘립니다.
5. `dump()`는 파일 sink가 성공적으로 생성된 경우에만 `artifactId`를 포함한 요약을 반환합니다.

실질적 효과:

- UI/도구 반환은 잘린 테일을 표시하고,
- 전체 출력은 아티팩트 파일에 보존되며 `artifact://<id>`로 참조됩니다.

파일 sink 생성이 실패하면(I/O 오류, 경로 누락 등), sink는 인메모리 잘림만으로 조용히 폴백합니다; 전체 출력은 영속화되지 않습니다.

## URL 접근 모델

## `blob:` 참조

`blob:sha256:<hash>`는 세션 항목 페이로드 내부의 영속성 참조이며, 라우터가 처리하는 내부 URL 스킴이 아닙니다. 해석은 세션 로드 중 `SessionManager`에 의해 수행됩니다.

## `artifact://<id>`

`ArtifactProtocolHandler`에 의해 처리됩니다:

- 활성 세션 아티팩트 디렉토리가 필요합니다,
- ID는 숫자여야 합니다,
- 파일명 접두사 `<id>.`를 매칭하여 해석합니다,
- 매칭된 `.log` 파일에서 원시 텍스트(`text/plain`)를 반환합니다,
- 없는 경우, 오류에 사용 가능한 아티팩트 ID 목록이 포함됩니다.

디렉토리 누락 동작:

- 아티팩트 디렉토리가 존재하지 않으면, `No artifacts directory found`를 발생시킵니다.

## `agent://<id>`

`AgentProtocolHandler`에 의해 `<artifactsDir>/<id>.md`를 통해 처리됩니다:

- 기본 형태는 마크다운 텍스트를 반환합니다,
- `/path` 또는 `?q=` 형태는 JSON 추출을 수행합니다,
- 경로와 쿼리 추출은 결합할 수 없습니다,
- 추출이 요청된 경우, 파일 콘텐츠는 JSON으로 파싱되어야 합니다.

디렉토리 누락 동작:

- `No artifacts directory found`를 발생시킵니다.

출력 누락 동작:

- 기존 `.md` 파일에서 사용 가능한 ID와 함께 `Not found: <id>`를 발생시킵니다.

읽기 도구 통합:

- `read`는 비추출 내부 URL 읽기에 대해 offset/limit 페이지네이션을 지원합니다,
- `agent://` 추출이 사용될 때 `offset/limit`을 거부합니다.

## 재개, 포크 및 이동 의미론

## 재개

- `ArtifactManager`는 최초 할당 시 기존 `{id}.*.log` 파일을 스캔하고 번호 매기기를 계속합니다.
- `AgentOutputManager`는 기존 `.md` 출력 ID를 스캔하고 번호 매기기를 계속합니다.
- `SessionManager`는 로드 시 blob 참조를 base64로 재수화합니다.

## 포크

`SessionManager.fork()`는 새 세션 ID와 `parentSession` 링크를 가진 새 세션 파일을 생성한 후, 이전/새 파일 경로를 반환합니다. 아티팩트 복사는 `AgentSession.fork()`에 의해 처리됩니다:

- 이전 아티팩트 디렉토리를 새 아티팩트 디렉토리로 재귀 복사를 시도합니다,
- 이전 디렉토리 누락은 허용됩니다,
- ENOENT가 아닌 복사 오류는 경고로 기록되며 포크는 여전히 완료됩니다.

포크 후 ID 시사점:

- 복사가 성공하면, 새 세션의 아티팩트 카운터는 복사된 최대 ID 이후부터 계속됩니다,
- 복사가 실패/건너뛰어진 경우, 새 세션 아티팩트 ID는 `0`부터 시작합니다.

포크 후 Blob 시사점:

- blob은 전역적이고 콘텐츠 주소 기반이므로, blob 디렉토리 복사가 필요하지 않습니다.

## 새 cwd로 이동

`SessionManager.moveTo()`는 세션 파일과 아티팩트 디렉토리를 모두 새 기본 세션 디렉토리로 이름을 변경하며, 이후 단계가 실패할 경우 롤백 로직을 포함합니다. 이는 세션 범위를 재배치하면서 아티팩트 식별성을 보존합니다.

## 실패 처리 및 폴백 경로

| 경우 | 동작 |
| --- | --- |
| 재수화 중 blob 파일 누락 | 경고하고 인메모리에 `blob:sha256:` 참조 문자열 유지 |
| `BlobStore.get`을 통한 blob 읽기 ENOENT | `null` 반환 |
| 아티팩트 디렉토리 누락 (`ArtifactManager.listFiles`) | 빈 목록 반환 (할당은 새로 시작 가능) |
| 아티팩트 디렉토리 누락 (`artifact://` / `agent://`) | 명시적으로 `No artifacts directory found` 발생 |
| 아티팩트 ID 미발견 | 사용 가능한 ID 목록과 함께 오류 발생 |
| OutputSink 아티팩트 라이터 초기화 실패 | 테일 전용 잘림으로 계속 (전체 출력 아티팩트 없음) |
| 세션 파일 없음 (일부 작업 경로) | 작업 도구가 하위 에이전트 출력을 위해 임시 아티팩트 디렉토리로 폴백 |

## 바이너리 blob 외부화 vs 텍스트 출력 아티팩트

- **Blob 외부화**는 영속화된 세션 항목 콘텐츠 내의 바이너리 이미지 페이로드를 위한 것입니다; JSONL의 인라인 base64를 안정적인 콘텐츠 참조로 대체합니다.
- **아티팩트**는 실행 출력 및 하위 에이전트 출력을 위한 일반 텍스트 파일입니다; 내부 URL을 통해 세션 로컬 ID로 주소 지정할 수 있습니다.

두 시스템은 간접적으로만 교차합니다(둘 다 세션 JSONL 비대화를 줄임). 그러나 식별, 수명 및 검색 경로가 다릅니다.

## 구현 파일

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — blob 참조 형식, 해싱, put/get, 외부화/해석 헬퍼.
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — 세션 아티팩트 디렉토리 모델 및 숫자 아티팩트 ID 할당.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — `OutputSink` 잘림/파일 스필 동작 및 요약 메타데이터.
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — 영속성 변환, 로드 시 blob 재수화, 세션 포크/이동 상호작용.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — 대화형 포크 중 아티팩트 디렉토리 복사.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — 도구 아티팩트 매니저 부트스트랩 및 도구별 아티팩트 경로 할당.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://` 리졸버.
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — `agent://` 리졸버 + JSON 추출.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — 내부 URL 라우터 연결 및 아티팩트 디렉토리 리졸버.
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — `agent://`를 위한 세션 범위 에이전트 출력 ID 할당.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — 하위 에이전트 출력 아티팩트 쓰기 (`<id>.md`) 및 임시 아티팩트 디렉토리 폴백.
