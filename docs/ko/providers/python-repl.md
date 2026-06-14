---
title: Python 도구 및 IPython 런타임
description: 'IPython 커널 관리, 실행, 출력 캡처를 포함한 Python REPL 도구 런타임.'
sidebar:
  order: 3
  label: Python 및 IPython
i18n:
  sourceHash: 70f0a034ecef
  translator: machine
---

# Python 도구 및 IPython 런타임

이 문서는 `packages/coding-agent`의 현재 Python 실행 스택을 설명합니다.
도구 동작, 커널/게이트웨이 수명 주기, 환경 처리, 실행 의미론, 출력 렌더링, 그리고 운영상의 오류 모드를 다룹니다.

## 범위 및 주요 파일

- 도구 인터페이스: `src/tools/python.ts`
- 세션/호출별 커널 오케스트레이션: `src/ipy/executor.ts`
- 커널 프로토콜 + 게이트웨이 통합: `src/ipy/kernel.ts`
- 공유 로컬 게이트웨이 코디네이터: `src/ipy/gateway-coordinator.ts`
- 사용자 트리거 Python 실행을 위한 인터랙티브 모드 렌더러: `src/modes/components/python-execution.ts`
- 런타임/환경 필터링 및 Python 해석: `src/ipy/runtime.ts`

## Python 도구란

`python` 도구는 하나 이상의 Python 셀을 Jupyter Kernel Gateway 기반 커널을 통해 실행합니다 (셀마다 `python -c`를 직접 생성하는 방식이 아닙니다).

도구 파라미터:

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // 초 단위, 1..600 범위로 제한, 기본값 30
  cwd?: string;
  reset?: boolean; // 첫 번째 셀에만 실행 전 커널 초기화
}
```

도구는 세션에 대해 `concurrency = "exclusive"`이므로 호출이 중복되지 않습니다.

## 게이트웨이 수명 주기

### 모드

두 가지 게이트웨이 경로가 있습니다:

1. **외부 게이트웨이** (`PI_PYTHON_GATEWAY_URL` 설정 시)
   - 구성된 URL을 직접 사용합니다.
   - `PI_PYTHON_GATEWAY_TOKEN`으로 선택적 인증.
   - 로컬 게이트웨이 프로세스가 생성되거나 관리되지 않습니다.

2. **로컬 공유 게이트웨이** (기본 경로)
   - `~/.xcsh/agent/python-gateway` 하위에서 조율되는 단일 공유 프로세스를 사용합니다.
   - 메타데이터 파일: `gateway.json`
   - 잠금 파일: `gateway.lock`
   - 실행 명령:
     - `python -m kernel_gateway`
     - `127.0.0.1:<할당된-포트>`에 바인딩
     - 시작 상태 확인: `GET /api/kernelspecs`

### 로컬 공유 게이트웨이 조율

`acquireSharedGateway()`:

- 하트비트와 함께 파일 잠금(`gateway.lock`)을 획득합니다.
- PID가 살아 있고 상태 확인이 통과되면 `gateway.json`을 재사용합니다.
- 필요 시 오래된 정보/PID를 정리합니다.
- 정상적인 게이트웨이가 없으면 새 게이트웨이를 시작합니다.

`releaseSharedGateway()`는 현재 no-op입니다 (커널 종료 시 공유 게이트웨이를 해제하지 않음).

`shutdownSharedGateway()`는 공유 프로세스를 명시적으로 종료하고 게이트웨이 메타데이터를 삭제합니다.

### 중요한 제약사항

`python.sharedGateway=false`는 커널 시작 시 거부됩니다:

- 오류: `Shared Python gateway required; local gateways are disabled`
- 프로세스별 비공유 로컬 게이트웨이 모드는 없습니다.

## 커널 수명 주기

각 실행은 선택된 게이트웨이의 `POST /api/kernels`를 통해 생성된 커널을 사용합니다.

커널 시작 순서:

1. 가용성 확인 (`checkPythonKernelAvailability`)
2. 커널 생성 (`/api/kernels`)
3. 웹소켓 열기 (`/api/kernels/:id/channels`)
4. 커널 환경 초기화 (`cwd`, 환경 변수, `sys.path`)
5. `PYTHON_PRELUDE` 실행
6. 다음 경로에서 확장 모듈 로드:
   - 사용자: `~/.xcsh/agent/modules/*.py`
   - 프로젝트: `<cwd>/.xcsh/modules/*.py` (동일 이름의 사용자 모듈을 덮어씀)

커널 종료:

- `DELETE /api/kernels/:id`로 원격 커널 삭제
- 웹소켓 종료
- 공유 게이트웨이 해제 훅 호출 (현재 no-op)

## 세션 지속성 의미론

`python.kernelMode`는 커널 재사용을 제어합니다:

- `session` (기본값)
  - 세션 ID + cwd 조합으로 키된 커널 세션을 재사용합니다.
  - 실행은 큐를 통해 세션 단위로 직렬화됩니다.
  - 유휴 세션은 5분 후 제거됩니다.
  - 최대 4개 세션; 초과 시 가장 오래된 세션이 제거됩니다.
  - 하트비트 확인으로 죽은 커널을 감지합니다.
  - 자동 재시작이 한 번 허용되며; 반복 충돌 시 하드 실패로 처리됩니다.

- `per-call`
  - 각 실행 요청마다 새 커널을 생성합니다.
  - 요청 완료 후 커널을 종료합니다.
  - 호출 간 상태가 유지되지 않습니다.

### 단일 도구 호출에서의 다중 셀 동작

셀은 해당 도구 호출에서 동일한 커널 인스턴스 안에서 순차적으로 실행됩니다.

중간 셀이 실패하는 경우:

- 이전 셀 상태는 메모리에 유지됩니다.
- 도구는 어느 셀이 실패했는지를 나타내는 오류를 반환합니다.
- 이후 셀은 실행되지 않습니다.

`reset=true`는 해당 호출의 첫 번째 셀 실행에만 적용됩니다.

## 환경 필터링 및 런타임 해석

게이트웨이/커널 런타임을 시작하기 전에 환경이 필터링됩니다:

- 허용 목록에는 `PATH`, `HOME`, 로케일 변수, `VIRTUAL_ENV`, `PYTHONPATH` 등 핵심 변수가 포함됩니다.
- 허용 접두사: `LC_`, `XDG_`, `PI_`
- 거부 목록은 일반적인 API 키(OpenAI/Anthropic/Gemini 등)를 제거합니다.

런타임 선택 순서:

1. 활성/위치된 venv (`VIRTUAL_ENV`, 이후 `<cwd>/.venv`, `<cwd>/venv`)
2. `~/.xcsh/python-env`의 관리형 venv
3. PATH 상의 `python` 또는 `python3`

venv가 선택되면 해당 bin/Scripts 경로가 `PATH` 앞에 추가됩니다.

Python 내부 커널 환경 초기화 시:

- `os.chdir(cwd)`
- 제공된 환경 맵을 `os.environ`에 주입
- cwd가 `sys.path`에 포함되도록 보장

## 도구 가용성 및 모드 선택

`python.toolMode` (기본값 `both`) + 선택적 `PI_PY` 오버라이드가 노출을 제어합니다:

- `ipy-only`
- `bash-only`
- `both`

`PI_PY` 허용 값:

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

Python 사전 점검이 실패하면, 도구 생성이 해당 세션에 대해 bash-only로 축소됩니다.

## 실행 흐름 및 취소/타임아웃

### 도구 수준 타임아웃

`python` 도구 타임아웃은 초 단위이며, 기본값은 30이고 `1..600` 범위로 제한됩니다.

도구는 다음을 결합합니다:

- 호출자 중단 신호
- 타임아웃 중단 신호

`AbortSignal.any(...)`를 사용합니다.

### 커널 실행 취소

중단/타임아웃 시:

- 실행이 취소됨으로 표시됩니다.
- REST(`POST /interrupt`)와 제어 채널 `interrupt_request`를 통해 커널 인터럽트가 시도됩니다.
- 결과에 `cancelled=true`가 포함됩니다.
- 타임아웃 경로는 출력에 `Command timed out after <n> seconds`를 주석으로 추가합니다.

### stdin 동작

인터랙티브 stdin은 지원되지 않습니다.

커널이 `input_request`를 발생시키면:

- 도구가 `stdinRequested=true`를 기록합니다
- 설명 텍스트를 출력합니다
- 빈 `input_reply`를 전송합니다
- 실행이 executor 레이어에서 실패로 처리됩니다

## 출력 캡처 및 렌더링

### 캡처된 출력 클래스

커널 메시지로부터:

- `stream` -> 일반 텍스트 청크
- `display_data`/`execute_result` -> 리치 디스플레이 처리
- `error` -> 트레이스백 텍스트
- 커스텀 MIME `application/x-xcsh-status` -> 구조화된 상태 이벤트

디스플레이 MIME 우선순위:

1. `text/markdown`
2. `text/plain`
3. `text/html` (기본 마크다운으로 변환)

추가로 구조화된 출력으로 캡처되는 항목:

- `application/json` -> JSON 트리 데이터
- `image/png` -> 이미지 페이로드
- `application/x-xcsh-status` -> 상태 이벤트

### 저장 및 잘라내기

출력은 `OutputSink`를 통해 스트리밍되며 아티팩트 저장소에 저장될 수 있습니다.

도구 결과에는 잘라내기 메타데이터와 전체 출력 복구를 위한 `artifact://<id>`가 포함될 수 있습니다.

### 렌더러 동작

- 도구 렌더러 (`python.ts`):
  - 셀별 상태와 함께 코드 셀 블록을 표시합니다
  - 축소된 미리보기 기본값은 10줄
  - 전체 출력 및 더 풍부한 상태 세부 정보를 위한 확장 모드 지원
- 인터랙티브 렌더러 (`python-execution.ts`):
  - TUI에서 사용자 트리거 Python 실행에 사용됩니다
  - 축소된 미리보기 기본값은 20줄
  - 표시 안전을 위해 매우 긴 개별 라인을 4000자로 제한합니다
  - 취소/오류/잘라내기 알림을 표시합니다

## 외부 게이트웨이 지원

설정:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# 선택 사항:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

로컬 공유 게이트웨이와의 동작 차이:

- 로컬 게이트웨이 잠금/정보 파일 없음
- 로컬 프로세스 생성/종료 없음
- 상태 확인 및 커널 CRUD가 외부 엔드포인트에 대해 실행됨
- 인증 실패 시 토큰 안내와 함께 명시적으로 표시됨

## 운영 문제 해결 (현재 오류 모드)

- **Python 도구를 사용할 수 없음**
  - `python.toolMode` / `PI_PY`를 확인하세요.
  - 사전 점검이 실패하면 런타임이 bash-only로 폴백됩니다.

- **커널 가용성 오류**
  - 로컬 모드에서는 해석된 Python 런타임에서 `kernel_gateway`와 `ipykernel`을 모두 임포트할 수 있어야 합니다.
  - 다음 명령으로 설치:

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false`로 인한 시작 실패**
  - 현재 구현에서 예상되는 동작입니다.

- **외부 게이트웨이 인증/연결 실패**
  - 401/403 -> `PI_PYTHON_GATEWAY_TOKEN`을 설정하세요.
  - 타임아웃/연결 불가 -> URL/네트워크 및 게이트웨이 상태를 확인하세요.

- **실행이 중단된 후 타임아웃**
  - 작업이 정상적인 경우 도구 `timeout`을 늘리세요 (최대 600초).
  - 중단된 코드의 경우, 취소 시 커널 인터럽트가 트리거되지만 사용자 코드를 리팩터링해야 할 수 있습니다.

- **Python 코드에서 stdin/input 프롬프트**
  - `input()`은 이 런타임 경로에서 인터랙티브하게 지원되지 않습니다; 데이터를 프로그래밍 방식으로 전달하세요.

- **리소스 소진 (`EMFILE` / 열린 파일이 너무 많음)**
  - 세션 관리자가 공유 게이트웨이 복구를 트리거합니다 (세션 해제 + 공유 게이트웨이 재시작).

- **작업 디렉터리 오류**
  - 도구는 실행 전에 `cwd`가 존재하고 디렉터리인지 검증합니다.

## 관련 환경 변수

- `PI_PY` — 도구 노출 오버라이드 (위의 `bash-only`/`ipy-only`/`both` 매핑)
- `PI_PYTHON_GATEWAY_URL` — 외부 게이트웨이 사용
- `PI_PYTHON_GATEWAY_TOKEN` — 선택적 외부 게이트웨이 인증 토큰
- `PI_PYTHON_SKIP_CHECK=1` — Python 사전 점검/워밍 확인 우회
- `PI_PYTHON_IPC_TRACE=1` — 커널 IPC 송수신 추적 로그
- `PI_DEBUG_STARTUP=1` — 시작 단계 디버그 마커 출력
