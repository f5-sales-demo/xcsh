---
title: Bash 도구 런타임
description: '셸 프로세스 관리, 샌드박싱, 타임아웃, 출력 스트리밍을 지원하는 Bash 도구 런타임.'
sidebar:
  order: 1
  label: Bash 도구
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# Bash 도구 런타임

이 문서는 에이전트 도구 호출에 사용되는 **`bash` 도구** 런타임 경로를 설명합니다. 명령어 정규화부터 실행, 잘라내기/아티팩트, 렌더링까지의 과정을 다룹니다.

또한 대화형 TUI, print 모드, RPC 모드, 사용자 시작 뱅(`!`) 셸 실행 간에 동작이 달라지는 부분도 안내합니다.

## 범위 및 런타임 표면

coding-agent에는 두 가지 서로 다른 bash 실행 표면이 있습니다:

1. **도구 호출 표면** (`toolName: "bash"`): 모델이 bash 도구를 호출할 때 사용됩니다.
   - 진입점: `BashTool.execute()`.
2. **사용자 뱅 명령어 표면** (대화형 입력의 `!cmd` 또는 RPC `bash` 명령): 세션 수준 도우미 경로입니다.
   - 진입점: `AgentSession.executeBash()`.

둘 다 최종적으로 비PTY 실행을 위해 `src/exec/bash-executor.ts`의 `executeBash()`를 사용하지만, 도구 호출 경로만 정규화/인터셉션 및 도구 렌더러 로직을 실행합니다.

## 엔드투엔드 도구 호출 파이프라인

## 1) 입력 정규화 및 매개변수 병합

`BashTool.execute()`는 먼저 `normalizeBashCommand()`를 통해 원시 명령어를 정규화합니다:

- 후행 `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N`을 구조화된 제한값으로 추출합니다,
- 후행/선행 공백을 제거합니다,
- 내부 공백은 유지합니다.

그런 다음 추출된 제한값을 명시적 도구 인수와 병합합니다:

- 명시적 `head`/`tail` 인수가 추출된 값을 재정의합니다,
- 추출된 값은 대체값으로만 사용됩니다.

### 주의사항

`bash-normalize.ts` 주석에는 `2>&1` 제거가 언급되어 있지만, 현재 구현은 이를 제거하지 않습니다. 런타임 동작은 여전히 올바르지만(stdout/stderr가 이미 병합됨), 정규화 동작은 주석이 제시하는 것보다 범위가 좁습니다.

## 2) 선택적 인터셉션 (차단 명령어 경로)

`bashInterceptor.enabled`가 true이면, `BashTool`은 설정에서 규칙을 로드하고 정규화된 명령어에 대해 `checkBashInterception()`을 실행합니다.

인터셉션 동작:

- 명령어가 차단되는 경우는 **다음 조건이 모두** 충족될 때입니다:
  - 정규식 규칙이 일치하고,
  - 제안된 도구가 `ctx.toolNames`에 존재하는 경우.
- 유효하지 않은 정규식 규칙은 자동으로 건너뜁니다.
- 차단 시, `BashTool`은 다음 메시지와 함께 `ToolError`를 발생시킵니다:
  - `Blocked: ...`
  - 원본 명령어가 포함됩니다.

기본 규칙 패턴(코드에 정의됨)은 일반적인 오용을 대상으로 합니다:

- 파일 읽기 도구 (`cat`, `head`, `tail`, ...)
- 검색 도구 (`grep`, `rg`, ...)
- 파일 찾기 도구 (`find`, `fd`, ...)
- 인플레이스 편집기 (`sed -i`, `perl -i`, `awk -i inplace`)
- 셸 리다이렉션 쓰기 (`echo ... > file`, heredoc 리다이렉션)

### 주의사항

`InterceptionResult`에는 `suggestedTool`이 포함되어 있지만, `BashTool`은 현재 메시지 텍스트만 표시합니다(`details`에 구조화된 제안 도구 필드 없음).

## 3) CWD 검증 및 타임아웃 클램핑

`cwd`는 세션 cwd(`resolveToCwd`)를 기준으로 해석된 다음 `stat`을 통해 검증됩니다:

- 경로 누락 -> `ToolError("Working directory does not exist: ...")`
- 디렉토리가 아닌 경우 -> `ToolError("Working directory is not a directory: ...")`

타임아웃은 `[1, 3600]`초로 클램핑된 후 밀리초로 변환됩니다.

## 4) 아티팩트 할당

실행 전에, 도구는 잘린 출력 저장을 위한 아티팩트 경로/ID를 할당합니다(최선의 노력 기반).

- 아티팩트 할당 실패는 치명적이지 않습니다(아티팩트 스필 파일 없이 실행이 계속됩니다),
- 아티팩트 ID/경로는 잘라내기 시 전체 출력 유지를 위해 실행 경로에 전달됩니다.

## 5) PTY vs 비PTY 실행 선택

`BashTool`은 다음 조건이 모두 참일 때만 PTY 실행을 선택합니다:

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- 도구 컨텍스트에 UI가 있는 경우 (`ctx.hasUI === true` 및 `ctx.ui` 설정됨)

그 외에는 비대화형 `executeBash()`를 사용합니다.

이는 print 모드와 비UI RPC/도구 컨텍스트가 항상 비PTY를 사용함을 의미합니다.

## 비대화형 실행 엔진 (`executeBash`)

## 셸 세션 재사용 모델

`executeBash()`는 다음을 키로 하는 프로세스 전역 맵에 네이티브 `Shell` 인스턴스를 캐시합니다:

- 셸 경로,
- 구성된 명령어 접두사,
- 스냅샷 경로,
- 직렬화된 셸 환경 변수,
- 선택적 에이전트 세션 키.

세션 수준 실행의 경우, `AgentSession.executeBash()`는 `sessionKey: this.sessionId`를 전달하여 세션별로 재사용을 격리합니다.

도구 호출 경로는 `sessionKey`를 전달하지 **않으므로**, 재사용 범위는 셸 설정/스냅샷/환경에 기반합니다.

## 셸 설정 및 스냅샷 동작

각 호출 시, 실행기는 설정 셸 구성(`shell`, `env`, 선택적 `prefix`)을 로드합니다.

선택된 셸이 `bash`를 포함하면, `getOrCreateSnapshot()` 시도합니다:

- 스냅샷은 사용자 rc에서 별칭/함수/옵션을 캡처합니다,
- 스냅샷 생성은 최선의 노력 기반입니다,
- 실패 시 스냅샷 없이 대체합니다.

`prefix`가 구성된 경우, 명령어는 다음과 같이 됩니다:

```text
<prefix> <command>
```

## 스트리밍 및 취소

`Shell.run()`은 콜백으로 청크를 스트리밍합니다. 실행기는 각 청크를 `OutputSink`와 선택적 `onChunk` 콜백에 전달합니다.

취소:

- 중단 신호가 트리거되면 `shellSession.abort(...)`를 호출합니다,
- 네이티브 결과의 타임아웃은 `cancelled: true` + 주석 텍스트로 매핑됩니다,
- 명시적 취소도 마찬가지로 `cancelled: true` + 주석을 반환합니다.

타임아웃/취소에 대해 실행기 내부에서 예외가 발생하지 않습니다; 구조화된 `BashResult`를 반환하고 호출자가 오류 의미를 매핑하도록 합니다.

## 대화형 PTY 경로 (`runInteractiveBashPty`)

PTY가 활성화되면, 도구는 `runInteractiveBashPty()`를 실행하여 오버레이 콘솔 컴포넌트를 열고 네이티브 `PtySession`을 구동합니다.

주요 동작:

- xterm-headless 가상 터미널이 오버레이에서 뷰포트를 렌더링합니다,
- 키보드 입력이 정규화됩니다(Kitty 시퀀스 및 애플리케이션 커서 모드 처리 포함),
- 실행 중 `esc`를 누르면 PTY 세션이 종료됩니다,
- 터미널 크기 변경이 PTY로 전파됩니다(`session.resize(cols, rows)`).

무인 실행을 위한 환경 강화 기본값이 주입됩니다:

- 페이저 비활성화 (`PAGER=cat`, `GIT_PAGER=cat` 등),
- 편집기 프롬프트 비활성화 (`GIT_EDITOR=true`, `EDITOR=true` 등),
- 터미널/인증 프롬프트 감소 (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`),
- 비대화형 동작을 위한 패키지 관리자/도구 자동화 플래그.

PTY 출력은 정규화되고(`CRLF`/`CR`을 `LF`로, `sanitizeText`) 아티팩트 스필 지원을 포함하여 `OutputSink`에 기록됩니다.

PTY 시작/런타임 오류 시, 싱크는 `PTY error: ...` 라인을 수신하고 명령어는 정의되지 않은 종료 코드로 완료됩니다.

## 출력 처리: 스트리밍, 잘라내기, 아티팩트 스필

PTY와 비PTY 경로 모두 `OutputSink`를 사용합니다.

## OutputSink 의미론

- 메모리 내 UTF-8 안전 테일 버퍼를 유지합니다(`DEFAULT_MAX_BYTES`, 현재 50KB),
- 본 총 바이트/라인 수를 추적합니다,
- 아티팩트 경로가 존재하고 출력이 오버플로되면(또는 파일이 이미 활성 상태이면), 전체 스트림을 아티팩트 파일에 기록합니다,
- 메모리 임계값이 오버플로되면, 메모리 내 버퍼를 테일로 잘라냅니다(UTF-8 경계 안전),
- 오버플로/파일 스필 발생 시 `truncated`로 표시합니다.

`dump()`는 다음을 반환합니다:

- `output` (가능한 주석 접두사 포함),
- `truncated`,
- `totalLines/totalBytes`,
- `outputLines/outputBytes`,
- 아티팩트 파일이 활성 상태였다면 `artifactId`.

### 긴 출력 주의사항

런타임 잘라내기는 `OutputSink`에서 바이트 임계값 기반입니다(기본 50KB). 이 코드 경로에서는 하드 2000라인 제한을 강제하지 않습니다.

## 실시간 도구 업데이트

비PTY 실행의 경우, `BashTool`은 부분 업데이트를 위해 별도의 `TailBuffer`를 사용하고 명령어 실행 중 `onUpdate` 스냅샷을 발행합니다.

PTY 실행의 경우, 실시간 렌더링은 `onUpdate` 텍스트 청크가 아닌 사용자 정의 UI 오버레이가 처리합니다.

## 결과 형성, 메타데이터, 오류 매핑

실행 후:

1. `cancelled` 처리:
   - 중단 신호가 중단된 경우 -> `ToolAbortError` 발생 (중단 의미론),
   - 그 외 -> `ToolError` 발생 (도구 실패로 처리).
2. PTY `timedOut` -> `ToolError` 발생.
3. 최종 출력 텍스트에 head/tail 필터 적용 (`applyHeadTail`, head 후 tail).
4. 빈 출력은 `(no output)`이 됩니다.
5. `toolResult(...).truncationFromSummary(result, { direction: "tail" })`를 통해 잘라내기 메타데이터 첨부.
6. 종료 코드 매핑:
   - 종료 코드 없음 -> `ToolError("... missing exit status")`
   - 0이 아닌 종료 -> `ToolError("... Command exited with code N")`
   - 0 종료 -> 성공 결과.

성공 페이로드 구조:

- `content`: 텍스트 출력,
- 잘림 시 `details.meta.truncation` 포함:
  - `direction`, `truncatedBy`, 총/출력 라인+바이트 수,
  - `shownRange`,
  - 가능한 경우 `artifactId`.

내장 도구는 `wrapToolWithMetaNotice()`로 래핑되므로, 잘라내기 알림 텍스트가 최종 텍스트 콘텐츠에 자동으로 추가됩니다(예: `Full: artifact://<id>`).

## 렌더링 경로

## 도구 호출 렌더러 (`bashToolRenderer`)

`bashToolRenderer`는 도구 호출 메시지(`toolCall` / `toolResult`)에 사용됩니다:

- 축소 모드는 시각적 라인 잘림 미리보기를 표시합니다,
- 확장 모드는 현재 사용 가능한 모든 출력 텍스트를 표시합니다,
- 경고 라인에는 잘라내기 이유와 잘린 경우 `artifact://<id>`가 포함됩니다,
- 타임아웃 값(인수에서)은 푸터 메타데이터 라인에 표시됩니다.

### 주의사항: 전체 아티팩트 확장

`BashRenderContext`에는 `isFullOutput`이 있지만, 현재 렌더러 컨텍스트 빌더는 bash 도구 결과에 대해 이를 설정하지 않습니다. 확장 보기는 다른 호출자가 전체 아티팩트 콘텐츠를 제공하지 않는 한 결과 콘텐츠에 이미 있는 텍스트(테일/잘린 출력)를 사용합니다.

## 사용자 뱅 명령어 컴포넌트 (`BashExecutionComponent`)

`BashExecutionComponent`는 대화형 모드의 사용자 `!` 명령어용입니다(모델 도구 호출이 아님):

- 청크를 실시간으로 스트리밍합니다,
- 축소 미리보기는 마지막 20개 논리 라인을 유지합니다,
- 라인당 4000자로 클램핑합니다,
- 메타데이터가 존재할 때 잘라내기 + 아티팩트 경고를 표시합니다,
- 취소/오류/종료 상태를 별도로 표시합니다.

이 컴포넌트는 `CommandController.handleBashCommand()`에 의해 연결되고 `AgentSession.executeBash()`에서 데이터를 받습니다.

## 모드별 동작 차이

| 표면                           | 진입 경로                                             | PTY 적격                                                             | 실시간 출력 UX                                                           | 오류 표시                                        |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| 대화형 도구 호출               | `BashTool.execute`                                    | 예, `bash.virtualTerminal=on`이고 UI가 존재하고 `PI_NO_PTY!=1`일 때  | PTY 오버레이(대화형) 또는 스트리밍 테일 업데이트                         | 도구 오류가 `toolResult.isError`로 변환됨        |
| Print 모드 도구 호출           | `BashTool.execute`                                    | 아니요 (UI 컨텍스트 없음)                                            | TUI 오버레이 없음; 출력이 이벤트 스트림/최종 어시스턴트 텍스트 흐름에 표시 | 동일한 도구 오류 매핑                            |
| RPC 도구 호출 (에이전트 도구)  | `BashTool.execute`                                    | 보통 UI 없음 -> 비PTY                                                | 구조화된 도구 이벤트/결과                                                | 동일한 도구 오류 매핑                            |
| 대화형 뱅 명령어 (`!`)         | `AgentSession.executeBash` + `BashExecutionComponent` | 아니요 (실행기를 직접 사용)                                          | 전용 bash 실행 컴포넌트                                                  | 컨트롤러가 예외를 잡아 UI 오류를 표시            |
| RPC `bash` 명령어              | `rpc-mode` -> `session.executeBash`                   | 아니요                                                               | `BashResult`를 직접 반환                                                 | 소비자가 반환된 필드를 처리                      |

## 운영 주의사항

- 인터셉터는 제안된 도구가 현재 컨텍스트에서 사용 가능할 때만 명령어를 차단합니다.
- 아티팩트 할당이 실패하면 잘라내기는 여전히 발생하지만 `artifact://` 역참조를 사용할 수 없습니다.
- 셸 세션 캐시에는 이 모듈에서 명시적 제거가 없습니다; 수명은 프로세스 범위입니다.
- PTY와 비PTY 타임아웃 표면이 다릅니다:
  - PTY는 명시적 `timedOut` 결과 필드를 노출합니다,
  - 비PTY는 타임아웃을 `cancelled + 주석` 요약으로 매핑합니다.

## 구현 파일

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — 도구 진입점, 정규화/인터셉션, PTY/비PTY 선택, 결과/오류 매핑, bash 도구 렌더러.
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — 명령어 정규화 및 실행 후 head/tail 필터링.
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — 인터셉터 규칙 매칭 및 차단 명령어 메시지.
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — 비PTY 실행기, 셸 세션 재사용, 취소 연결, 출력 싱크 통합.
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — PTY 런타임, 오버레이 UI, 입력 정규화, 비대화형 환경 기본값.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — `OutputSink` 잘라내기/아티팩트 스필 및 요약 메타데이터.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — 아티팩트 할당 도우미 및 스트리밍 테일 버퍼.
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — 잘라내기 메타데이터 형태 + 알림 주입 래퍼.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — 세션 수준 `executeBash`, 메시지 기록, 중단 수명 주기.
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — 대화형 `!` 명령어 실행 컴포넌트.
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — 대화형 `!` 명령어 UI 스트림/업데이트 완료 연결.
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — RPC `bash` 및 `abort_bash` 명령어 표면.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://<id>` 해석.
