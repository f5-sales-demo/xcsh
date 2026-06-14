---
title: 노트북 도구 런타임 내부 구조
description: '셀 실행, 커널 수명 주기, 출력 렌더링을 갖춘 Jupyter 노트북 도구 런타임.'
sidebar:
  order: 2
  label: 노트북 도구
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# 노트북 도구 런타임 내부 구조

이 문서는 현재 `notebook` 도구 구현과 커널 기반 Python 런타임과의 관계를 설명합니다.

핵심 구분: **`notebook`은 JSON 노트북 편집기이지, 노트북 실행기가 아닙니다**. `.ipynb` 셀 소스를 직접 편집하며, Python 커널을 시작하거나 커널과 통신하지 않습니다.

## 구현 파일

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) 런타임 경계: 편집과 실행

## `notebook` 도구 (`src/tools/notebook.ts`)

- `.ipynb` 파일에 대해 `action: edit | insert | delete`를 지원합니다.
- 세션 CWD 기준으로 경로를 확인합니다(`resolveToCwd`).
- 노트북 JSON을 로드하고, `cells` 배열과 `cell_index` 범위를 유효성 검사합니다.
- 소스 편집을 메모리 내에서 적용하고, `JSON.stringify(notebook, null, 1)`로 전체 노트북 JSON을 다시 씁니다.
- 텍스트 요약과 구조화된 `details`(`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`)를 반환합니다.

이 도구에는 커널 수명 주기가 존재하지 않습니다:

- 게이트웨이 획득 없음
- 커널 세션 ID 없음
- `execute_request` 없음
- 커널 채널에서의 스트림 청크 없음
- 리치 디스플레이 캡처 없음(`image/png`, JSON 디스플레이, 상태 MIME)

## 노트북 유사 실행 경로 (`src/tools/python.ts` + `src/ipy/*`)

에이전트가 셀 스타일의 Python 코드(순차적 셀, 영속 상태, 리치 디스플레이)를 실행해야 할 때는 `notebook`이 아닌 **`python` 도구**를 통해 처리됩니다.

커널 모드, 재시작/취소 동작, 청크 스트리밍, 출력 아티팩트 잘라내기가 존재하는 경로는 바로 이 경로입니다.

## 2) 노트북 셀 처리 시맨틱 (`notebook` 도구)

## 소스 정규화

`content`는 줄바꿈을 보존하여 `source: string[]`으로 분할됩니다:

- 마지막이 아닌 각 줄은 후행 `\n`을 유지합니다
- 마지막 줄에는 강제 후행 줄바꿈이 없습니다

이는 노트북 JSON 관례를 반영하며, 이후 편집 시 의도치 않은 줄 연결을 방지합니다.

## 액션 동작

- `edit`
  - `cells[cell_index].source`를 교체합니다
  - 기존 `cell_type`을 보존합니다
- `insert`
  - `[0..cellCount]`에 삽입합니다
  - `cell_type`은 기본적으로 `code`입니다
  - 코드 셀은 `execution_count: null`과 `outputs: []`로 초기화됩니다
  - 마크다운 셀은 `metadata` + `source`만 초기화됩니다
- `delete`
  - `cells[cell_index]`를 제거합니다
  - 렌더러 미리보기를 위해 제거된 `source`를 details에 반환합니다

## 오류 표면

다음의 경우 하드 실패가 발생합니다:

- 노트북 파일 없음
- 잘못된 JSON
- `cells`가 없거나 배열이 아님
- 범위를 벗어난 인덱스(삽입과 비삽입은 유효한 범위가 다름)
- `edit`/`insert`에 `content` 없음

이는 상위 스트림에서 `Error:` 도구 응답이 되며, 렌더러는 노트북 경로와 형식화된 오류 텍스트를 사용합니다.

## 3) 커널 세션 시맨틱 (실제로 존재하는 위치)

커널 시맨틱은 `executePython` / `PythonKernel`에 구현되어 있으며 `python` 도구에 적용됩니다.

## 모드

`PythonKernelMode`:

- `session` (기본값)
  - 커널이 `kernelSessions` 맵에 캐시됩니다
  - 최대 4개 세션; 초과 시 가장 오래된 것이 제거됩니다
  - 유휴/종료 정리는 30초마다, 5분 후 타임아웃
  - 세션별 큐가 실행을 직렬화합니다(`session.queue`)
- `per-call`
  - 요청에 대한 커널을 생성합니다
  - 실행합니다
  - `finally`에서 항상 커널을 종료합니다

## 리셋 동작

`python` 도구는 다중 셀 호출의 첫 번째 셀에만 `reset`을 전달하며, 이후 셀은 항상 `reset: false`로 실행됩니다.

## 커널 종료 / 재시작 / 재시도

세션 모드(`withKernelSession`)에서:

- 종료된 커널은 하트비트(`kernel.isAlive()` 5초마다 확인)나 실행 실패로 감지됩니다.
- 실행 전 종료 상태는 `restartKernelSession`을 트리거합니다.
- 실행 중 충돌 경로는 한 번 재시도합니다: 커널을 재시작하고 핸들러를 재실행합니다.
- 동일 세션에서 `restartCount > 1`이면 `Python kernel restarted too many times in this session`을 발생시킵니다.

시작 재시도 동작:

- 공유 게이트웨이 커널 생성은 HTTP 5xx와 함께 `SharedGatewayCreateError`가 발생하면 한 번 재시도합니다.

리소스 고갈 복구:

- `EMFILE`/`ENFILE`/"Too many open files" 스타일 실패를 감지합니다
- 추적된 세션을 지웁니다
- `shutdownSharedGateway()`를 호출합니다
- 커널 세션 생성을 한 번 재시도합니다

## 4) 환경/세션 변수 주입

커널 시작 시 실행기로부터 선택적 환경 맵을 받습니다:

- `PI_SESSION_FILE` (세션 상태 파일 경로)
- `ARTIFACTS` (아티팩트 디렉토리)

그런 다음 `PythonKernel.#initializeKernelEnvironment(...)`가 커널 내부에서 초기화 스크립트를 실행합니다:

- `os.chdir(cwd)`
- `os.environ`에 환경 항목 주입
- 누락된 경우 `sys.path`에 cwd를 앞에 추가

의미:

- 세션 또는 아티팩트 컨텍스트를 읽는 프리루드 헬퍼는 Python 프로세스 상태의 이러한 환경 변수에 의존합니다.

## 5) 스트리밍/청크 및 디스플레이 처리 (커널 기반 경로)

커널 클라이언트는 실행별로 Jupyter 프로토콜 메시지를 처리합니다:

- `stream` -> `onChunk`에 텍스트 청크
- `execute_result` / `display_data` ->
  - MIME 우선순위로 디스플레이 텍스트 선택: `text/markdown` > `text/plain` > 변환된 `text/html`
  - 구조화된 출력은 별도로 캡처됩니다:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (텍스트 방출 없음)
- `error` -> 역추적 텍스트가 청크 스트림에 푸시됨 + 구조화된 오류 메타데이터
- `input_request` -> stdin 경고 텍스트 방출, 빈 `input_reply` 전송, stdin 요청됨 표시
- 완료는 `execute_reply`와 커널 `status=idle` 모두를 기다립니다

취소/타임아웃:

- 중단 신호가 `interrupt()`를 트리거합니다 (REST `/interrupt` + 제어 채널 `interrupt_request`)
- 결과에 `cancelled=true`가 표시됩니다
- 타임아웃 경로는 출력에 `Command timed out after <n> seconds`를 주석으로 추가합니다

## 6) 잘라내기 및 아티팩트 동작

`src/session/streaming-output.ts`의 `OutputSink`는 커널 실행 경로(`executeWithKernel`)에서 사용됩니다:

- 모든 청크를 정리합니다(`sanitizeText`)
- 총 줄 수/출력 줄 수 및 바이트를 추적합니다
- 선택적 아티팩트 스필 파일(`artifactPath`, `artifactId`)
- 메모리 내 버퍼가 임계값(`DEFAULT_MAX_BYTES`, 재정의 가능)을 초과하면:
  - 잘라내기로 표시됩니다
  - 메모리에 후행 바이트를 유지합니다 (UTF-8 안전 경계)
  - 전체 스트림을 아티팩트 싱크로 스필할 수 있습니다

`dump()`는 다음을 반환합니다:

- 표시 가능한 출력 텍스트 (끝 부분이 잘릴 수 있음)
- 잘라내기 플래그 + 카운트
- 아티팩트 ID (`artifact://<id>` 참조용)

`python` 도구는 이 메타데이터를 결과 잘라내기 공지와 TUI 경고로 변환합니다.

`notebook` 도구는 `OutputSink`를 **사용하지 않습니다**; 코드를 실행하지 않으므로 스트림/아티팩트 잘라내기 파이프라인이 없습니다.

## 7) 렌더러 가정 및 형식화

## 노트북 렌더러 (`notebookToolRenderer`)

- 호출 뷰: 액션 + 노트북 경로 + 셀/유형 메타데이터가 포함된 상태 줄
- 결과 뷰:
  - `details`에서 파생된 성공 요약
  - `renderCodeCell`을 통해 렌더링된 `cellSource`
  - 마크다운 셀은 언어 힌트를 `markdown`으로 설정; 다른 셀은 명시적 언어 재정의 없음
  - 축소된 코드 미리보기 제한은 `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - 공유 렌더 옵션을 통한 확장 모드 지원
  - 너비 + 확장 상태로 키를 지정한 렌더 캐시 사용

오류 렌더링 가정:

- 첫 번째 텍스트 내용이 `Error:`로 시작하면, 렌더러가 노트북 오류 블록으로 형식화합니다.

## Python 렌더러 (실제 실행 출력용)

커널 기반 실행 렌더링은 다음을 예상합니다:

- 셀별 상태 전환 (`pending/running/complete/error`)
- 선택적 구조화된 상태 이벤트 섹션
- 선택적 JSON 출력 트리
- 잘라내기 경고 + 선택적 `artifact://<id>` 포인터

이 렌더러 동작은 두 가지 모두 공유 TUI 프리미티브를 재사용한다는 점을 제외하면 `notebook` JSON 편집 결과와 무관합니다.

## 8) 일반 Python 도구 동작과의 차이점

"일반 Python 도구"가 `python` 실행 경로를 의미하는 경우:

- `python`은 커널에서 코드를 실행하고, 모드별로 상태를 유지하며, 청크를 스트리밍하고, 리치 디스플레이를 캡처하고, 인터럽트/타임아웃을 처리하며, 출력 잘라내기/아티팩트를 지원합니다.
- `notebook`은 결정론적 노트북 JSON 변형만 수행합니다; 실행 없음, 커널 상태 없음, 청크 스트림 없음, 디스플레이 출력 없음, 아티팩트 파이프라인 없음.

워크플로우에 둘 다 필요한 경우:

1. `notebook`으로 노트북 소스를 편집합니다
2. `notebook`이 아닌 `python`을 통해 코드 셀을 실행합니다 (코드를 수동으로 전달)

현재 구현은 `.ipynb`를 변형하는 동시에 커널 컨텍스트를 통해 노트북 셀을 실행하는 단일 도구를 제공하지 않습니다.
