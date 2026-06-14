---
title: 노트북 도구 런타임 내부 구조
description: '셀 실행, 커널 수명 주기 및 출력 렌더링을 포함한 Jupyter 노트북 도구 런타임.'
sidebar:
  order: 2
  label: 노트북 도구
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# 노트북 도구 런타임 내부 구조

이 문서는 현재 `notebook` 도구 구현과 커널 기반 Python 런타임과의 관계를 설명합니다.

핵심 구분: **`notebook`은 JSON 노트북 편집기이지, 노트북 실행기가 아닙니다**. `.ipynb` 셀 소스를 직접 편집하며, Python 커널을 시작하거나 통신하지 않습니다.

## 구현 파일

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) 런타임 경계: 편집 vs 실행

## `notebook` 도구 (`src/tools/notebook.ts`)

- `.ipynb` 파일에서 `action: edit | insert | delete`를 지원합니다.
- 세션 CWD 기준으로 경로를 해석합니다(`resolveToCwd`).
- 노트북 JSON을 로드하고, `cells` 배열을 검증하며, `cell_index` 범위를 검증합니다.
- 소스 편집을 메모리 내에서 적용하고 `JSON.stringify(notebook, null, 1)`을 사용하여 전체 노트북 JSON을 다시 씁니다.
- 텍스트 요약과 구조화된 `details`(`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`)를 반환합니다.

이 도구에는 커널 수명 주기가 존재하지 않습니다:

- 게이트웨이 획득 없음
- 커널 세션 ID 없음
- `execute_request` 없음
- 커널 채널의 스트림 청크 없음
- 리치 디스플레이 캡처 없음(`image/png`, JSON 디스플레이, 상태 MIME)

## 노트북 유사 실행 경로 (`src/tools/python.ts` + `src/ipy/*`)

에이전트가 셀 스타일 Python 코드(순차적 셀, 영구 상태, 리치 디스플레이)를 실행해야 할 때는 `notebook`이 아닌 **`python` 도구**를 통해 처리됩니다.

커널 모드, 재시작/취소 동작, 청크 스트리밍, 출력 아티팩트 잘라내기가 이 경로에 존재합니다.

## 2) 노트북 셀 처리 의미론 (`notebook` 도구)

## 소스 정규화

`content`는 개행 보존과 함께 `source: string[]`으로 분할됩니다:

- 마지막이 아닌 각 줄은 후행 `\n`을 유지합니다
- 마지막 줄에는 강제 후행 개행이 없습니다

이는 노트북 JSON 관례를 반영하며 이후 편집 시 우발적인 줄 연결을 방지합니다.

## 액션 동작

- `edit`
  - `cells[cell_index].source`를 교체합니다
  - 기존 `cell_type`을 보존합니다
- `insert`
  - `[0..cellCount]` 위치에 삽입합니다
  - `cell_type`은 기본값이 `code`입니다
  - 코드 셀은 `execution_count: null` 및 `outputs: []`로 초기화됩니다
  - 마크다운 셀은 `metadata` + `source`만 초기화됩니다
- `delete`
  - `cells[cell_index]`를 제거합니다
  - 렌더러 미리보기를 위해 제거된 `source`를 details에 반환합니다

## 오류 처리

다음 경우에 하드 실패가 발생합니다:

- 노트북 파일 없음
- 유효하지 않은 JSON
- `cells` 누락 또는 배열이 아님
- 범위를 벗어난 인덱스(삽입과 비삽입은 유효 범위가 다름)
- `edit`/`insert`에 `content` 누락

이는 상위에서 `Error:` 도구 응답이 되며, 렌더러는 노트북 경로와 형식화된 오류 텍스트를 사용합니다.

## 3) 커널 세션 의미론 (실제로 존재하는 위치)

커널 의미론은 `executePython` / `PythonKernel`에 구현되어 있으며 `python` 도구에 적용됩니다.

## 모드

`PythonKernelMode`:

- `session` (기본값)
  - `kernelSessions` 맵에서 커널 캐시
  - 최대 4개 세션; 초과 시 가장 오래된 세션 제거
  - 30초마다 유휴/비활성 정리, 5분 후 타임아웃
  - 세션별 큐가 실행을 직렬화함(`session.queue`)
- `per-call`
  - 요청에 대한 커널 생성
  - 실행
  - `finally`에서 항상 커널 종료

## 재설정 동작

`python` 도구는 다중 셀 호출에서 첫 번째 셀에만 `reset`을 전달하며, 이후 셀은 항상 `reset: false`로 실행됩니다.

## 커널 종료 / 재시작 / 재시도

세션 모드(`withKernelSession`)에서:

- 비활성 커널은 하트비트(`kernel.isAlive()` 5초마다 확인)나 실행 실패로 감지됩니다.
- 실행 전 비활성 상태는 `restartKernelSession`을 트리거합니다.
- 실행 중 충돌 경로는 한 번 재시도합니다: 커널 재시작, 핸들러 재실행.
- 동일 세션에서 `restartCount > 1`이면 `Python kernel restarted too many times in this session`을 발생시킵니다.

시작 재시도 동작:

- 공유 게이트웨이 커널 생성은 HTTP 5xx와 함께 `SharedGatewayCreateError` 발생 시 한 번 재시도합니다.

리소스 고갈 복구:

- `EMFILE`/`ENFILE`/"Too many open files" 스타일 실패를 감지합니다
- 추적된 세션을 초기화합니다
- `shutdownSharedGateway()`를 호출합니다
- 커널 세션 생성을 한 번 재시도합니다

## 4) 환경/세션 변수 주입

커널 시작 시 실행기에서 선택적 환경 맵을 수신합니다:

- `PI_SESSION_FILE` (세션 상태 파일 경로)
- `ARTIFACTS` (아티팩트 디렉터리)

`PythonKernel.#initializeKernelEnvironment(...)`는 커널 내부에서 초기화 스크립트를 실행합니다:

- `os.chdir(cwd)`
- `os.environ`에 환경 항목 주입
- 누락된 경우 `sys.path`에 cwd를 앞에 추가

시사점:

- 세션 또는 아티팩트 컨텍스트를 읽는 프리루드 헬퍼는 Python 프로세스 상태의 이러한 환경 변수에 의존합니다.

## 5) 스트리밍/청크 및 디스플레이 처리 (커널 기반 경로)

커널 클라이언트는 실행당 Jupyter 프로토콜 메시지를 처리합니다:

- `stream` -> `onChunk`에 텍스트 청크 전달
- `execute_result` / `display_data` ->
  - MIME 우선순위에 따라 디스플레이 텍스트 선택: `text/markdown` > `text/plain` > 변환된 `text/html`
  - 구조화된 출력을 별도로 캡처:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (텍스트 발행 없음)
- `error` -> 트레이스백 텍스트를 청크 스트림에 푸시 + 구조화된 오류 메타데이터
- `input_request` -> stdin 경고 텍스트 발행, 빈 `input_reply` 전송, stdin 요청됨 표시
- 완료는 `execute_reply`와 커널 `status=idle` 모두를 기다립니다

취소/타임아웃:

- 중단 신호는 `interrupt()`를 트리거합니다(REST `/interrupt` + 제어 채널 `interrupt_request`)
- 결과는 `cancelled=true`로 표시됩니다
- 타임아웃 경로는 출력에 `Command timed out after <n> seconds`를 주석으로 추가합니다

## 6) 잘라내기 및 아티팩트 동작

`src/session/streaming-output.ts`의 `OutputSink`는 커널 실행 경로(`executeWithKernel`)에서 사용됩니다:

- 모든 청크를 정제합니다(`sanitizeText`)
- 총 라인/출력 라인 및 바이트를 추적합니다
- 선택적 아티팩트 스필 파일(`artifactPath`, `artifactId`)
- 메모리 내 버퍼가 임계값(`DEFAULT_MAX_BYTES`, 재정의 가능)을 초과하면:
  - 잘라내기 표시
  - 메모리에 꼬리 바이트 유지(UTF-8 안전 경계)
  - 전체 스트림을 아티팩트 싱크로 스필 가능

`dump()`가 반환하는 값:

- 표시 가능한 출력 텍스트(꼬리 잘라내기 가능)
- 잘라내기 플래그 + 카운트
- 아티팩트 ID(`artifact://<id>` 참조용)

`python` 도구는 이 메타데이터를 결과 잘라내기 알림과 TUI 경고로 변환합니다.

`notebook` 도구는 `OutputSink`를 **사용하지 않습니다**. 코드를 실행하지 않으므로 스트림/아티팩트 잘라내기 파이프라인이 없습니다.

## 7) 렌더러 가정 및 포맷팅

## 노트북 렌더러 (`notebookToolRenderer`)

- 호출 뷰: 액션 + 노트북 경로 + 셀/타입 메타데이터가 포함된 상태 줄
- 결과 뷰:
  - `details`에서 도출된 성공 요약
  - `renderCodeCell`을 통해 렌더링된 `cellSource`
  - 마크다운 셀은 언어 힌트를 `markdown`으로 설정; 다른 셀에는 명시적 언어 재정의 없음
  - 접힌 코드 미리보기 한도는 `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - 공유 렌더 옵션을 통해 확장 모드 지원
  - 너비 + 확장 상태를 키로 하는 렌더 캐시 사용

오류 렌더링 가정:

- 첫 번째 텍스트 내용이 `Error:`로 시작하면 렌더러가 노트북 오류 블록으로 포맷합니다.

## Python 렌더러 (실제 실행 출력용)

커널 기반 실행 렌더링이 기대하는 값:

- 셀별 상태 전환(`pending/running/complete/error`)
- 선택적 구조화된 상태 이벤트 섹션
- 선택적 JSON 출력 트리
- 잘라내기 경고 + 선택적 `artifact://<id>` 포인터

이 렌더러 동작은 `notebook` JSON 편집 결과와 무관합니다. 단, 둘 다 공유 TUI 프리미티브를 재사용합니다.

## 8) 일반 Python 도구 동작과의 차이점

"일반 Python 도구"가 `python` 실행 경로를 의미하는 경우:

- `python`은 커널에서 코드를 실행하고, 모드에 따라 상태를 유지하며, 청크를 스트리밍하고, 리치 디스플레이를 캡처하며, 인터럽트/타임아웃을 처리하고, 출력 잘라내기/아티팩트를 지원합니다.
- `notebook`은 결정론적 노트북 JSON 변형만 수행합니다. 실행, 커널 상태, 청크 스트림, 디스플레이 출력, 아티팩트 파이프라인이 없습니다.

워크플로우에서 둘 다 필요한 경우:

1. `notebook`으로 노트북 소스를 편집합니다
2. `notebook`이 아닌 `python`을 통해 코드를 수동으로 전달하여 코드 셀을 실행합니다

현재 구현은 `.ipynb`를 변형하면서 커널 컨텍스트를 통해 노트북 셀을 실행하는 단일 도구를 제공하지 않습니다.
