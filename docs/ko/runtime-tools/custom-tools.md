---
title: 사용자 정의 도구
description: '에이전트 확장을 위한 사용자 정의 도구 등록, 스키마 정의 및 실행 파이프라인.'
sidebar:
  order: 4
  label: 사용자 정의 도구
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# 사용자 정의 도구

사용자 정의 도구는 내장 도구와 동일한 도구 실행 파이프라인에 연결되는 모델 호출 가능 함수입니다.

사용자 정의 도구는 팩토리를 내보내는 TypeScript/JavaScript 모듈입니다. 팩토리는 호스트 API(`CustomToolAPI`)를 수신하고 하나의 도구 또는 도구 배열을 반환합니다.

## 이것이 무엇인지 (그리고 아닌지)

- **사용자 정의 도구**: 턴(turn) 중 모델이 호출 가능 (`execute` + TypeBox 스키마).
- **확장(Extension)**: 도구를 등록하고 이벤트를 가로채거나 수정할 수 있는 수명 주기/이벤트 프레임워크.
- **훅(Hook)**: 외부 명령 전/후 스크립트.
- **스킬(Skill)**: 정적 지침/컨텍스트 패키지로, 실행 가능한 도구 코드가 아님.

모델이 코드를 직접 호출해야 하는 경우 사용자 정의 도구를 사용하십시오.

## 현재 코드의 통합 경로

두 가지 활성 통합 방식이 있습니다:

1. **SDK 제공 사용자 정의 도구** (`options.customTools`)
   - `CustomToolAdapter` 또는 확장 래퍼를 통해 에이전트 도구로 래핑됩니다.
   - SDK 부트스트랩에서 초기 활성 도구 세트에 항상 포함됩니다.

2. **로더 API를 통한 파일시스템 검색 모듈** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - `src/extensibility/custom-tools/loader.ts`에 라이브러리 API로 노출됩니다.
   - 호스트 코드는 이를 호출하여 설정/프로바이더/플러그인 경로에서 도구 모듈을 검색하고 로드할 수 있습니다.

```text
모델 도구 호출 흐름

LLM 도구 호출
   │
   ▼
도구 레지스트리 (내장 도구 + 사용자 정의 도구 어댑터)
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> 스트리밍 부분 결과
   └─ return result  -> 최종 도구 콘텐츠/세부 정보
```

## 검색 위치 (로더 API)

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)`는 다음을 병합합니다:

1. 기능 프로바이더(`toolCapability`), 포함:
   - 네이티브 OMP 설정 (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Claude 설정 (`~/.claude/tools`, `.claude/tools`)
   - Codex 설정 (`~/.codex/tools`, `.codex/tools`)
   - Claude 마켓플레이스 플러그인 캐시 프로바이더
2. 설치된 플러그인 매니페스트 (`~/.xcsh/plugins/node_modules/*` 플러그인 로더를 통해)
3. 로더에 전달된 명시적으로 설정된 경로

### 중요한 동작

- 중복 해석된 경로는 중복 제거됩니다.
- 도구 이름 충돌은 내장 도구 및 이미 로드된 사용자 정의 도구에 대해 거부됩니다.
- `.md` 및 `.json` 파일은 일부 프로바이더에 의해 도구 메타데이터로 검색되지만, 실행 가능 모듈 로더는 이를 실행 가능 도구로 거부합니다.
- 상대 설정 경로는 `cwd`에서 해석되며, `~`는 확장됩니다.

## 모듈 계약

사용자 정의 도구 모듈은 함수를 내보내야 합니다 (기본 내보내기 권장):

```ts
import type { CustomToolFactory } from "@f5xc-salesdemos/xcsh";

const factory: CustomToolFactory = (pi) => ({
 name: "repo_stats",
 label: "Repo Stats",
 description: "Counts tracked TypeScript files",
 parameters: pi.typebox.Type.Object({
  glob: pi.typebox.Type.Optional(pi.typebox.Type.String({ default: "**/*.ts" })),
 }),

 async execute(toolCallId, params, onUpdate, ctx, signal) {
  onUpdate?.({
   content: [{ type: "text", text: "Scanning files..." }],
   details: { phase: "scan" },
  });

  const result = await pi.exec("git", ["ls-files", params.glob ?? "**/*.ts"], { signal, cwd: pi.cwd });
  if (result.killed) {
   throw new Error("Scan was cancelled");
  }
  if (result.code !== 0) {
   throw new Error(result.stderr || "git ls-files failed");
  }

  const files = result.stdout.split("\n").filter(Boolean);
  return {
   content: [{ type: "text", text: `Found ${files.length} files` }],
   details: { count: files.length, sample: files.slice(0, 10) },
  };
 },

 onSession(event) {
  if (event.reason === "shutdown") {
   // cleanup resources if needed
  }
 },
});

export default factory;
```

팩토리 반환 타입:

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## 팩토리에 전달되는 API 표면 (`CustomToolAPI`)

`types.ts` 및 `loader.ts`에서:

- `cwd`: 호스트 작업 디렉터리
- `exec(command, args, options?)`: 프로세스 실행 헬퍼
- `ui`: UI 컨텍스트 (헤드리스 모드에서는 no-op일 수 있음)
- `hasUI`: 비대화형 흐름에서 `false`
- `logger`: 공유 파일 로거
- `typebox`: 주입된 `@sinclair/typebox`
- `pi`: 주입된 `@f5xc-salesdemos/xcsh` 내보내기
- `pushPendingAction(action)`: 숨겨진 `resolve` 도구를 위한 미리 보기 액션 등록 (`docs/resolve-tool-runtime.md`)

로더는 no-op UI 컨텍스트로 시작하며, 실제 UI가 준비되면 호스트 코드가 `setUIContext(...)`를 호출해야 합니다.

## 실행 계약 및 타이핑

`CustomTool.execute` 시그니처:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params`는 `Static<TParams>`를 통해 TypeBox 스키마에서 정적으로 타입이 지정됩니다.
- 런타임 인수 유효성 검사는 에이전트 루프에서 실행 전에 수행됩니다.
- `onUpdate`는 UI 스트리밍을 위한 부분 결과를 방출합니다.
- `ctx`는 세션/모델 상태 및 `abort()` 헬퍼를 포함합니다.
- `signal`은 취소를 전달합니다.

`CustomToolAdapter`는 이를 에이전트 도구 인터페이스에 연결하고 올바른 인수 순서로 호출을 전달합니다.

## 모델에 도구가 노출되는 방식

- 도구는 `AgentTool` 인스턴스로 래핑됩니다 (`CustomToolAdapter` 또는 확장 래퍼).
- 이름으로 세션 도구 레지스트리에 삽입됩니다.
- SDK 부트스트랩에서 사용자 정의 도구 및 확장 등록 도구는 초기 활성 세트에 강제 포함됩니다.
- CLI `--tools`는 현재 내장 도구 이름만 유효성 검사하며, 사용자 정의 도구 포함은 검색/등록 경로 및 SDK 옵션을 통해 처리됩니다.

## 렌더링 훅

선택적 렌더링 훅:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

TUI의 런타임 동작:

- 훅이 존재하면 도구 출력은 `Box` 컨테이너 내부에 렌더링됩니다.
- `renderResult`는 `{ expanded, isPartial, spinnerFrame? }`을 수신합니다.
- 렌더러 오류는 캐치되어 로깅되며, UI는 기본 텍스트 렌더링으로 폴백합니다.

## 세션/상태 처리

선택적 `onSession(event, ctx)`는 다음을 포함한 세션 수명 주기 이벤트를 수신합니다:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

브랜치/세션 컨텍스트가 변경될 때 히스토리에서 상태를 재구성하려면 `ctx.sessionManager`를 사용하십시오.

## 실패 및 취소 시맨틱

### 동기/비동기 실패

- `execute`에서 던지기(또는 거부된 프로미스)는 도구 실패로 처리됩니다.
- 에이전트 런타임은 실패를 `isError: true` 및 오류 텍스트 콘텐츠가 포함된 도구 결과 메시지로 변환합니다.
- 확장 래퍼를 사용하면 `tool_result` 핸들러가 콘텐츠/세부 정보를 추가로 재작성하고 오류 상태를 재정의할 수도 있습니다.

### 취소

- 에이전트 중단은 `AbortSignal`을 통해 `execute`로 전파됩니다.
- 협력적 취소를 위해 `signal`을 서브프로세스 작업으로 전달하십시오 (`pi.exec(..., { signal })`).
- `ctx.abort()`는 도구가 현재 에이전트 작업의 중단을 요청할 수 있게 합니다.

### onSession 오류

- `onSession` 오류는 캐치되어 경고로 로깅되며, 세션을 중단시키지 않습니다.

## 설계를 위한 실제 제약 사항

- 도구 이름은 활성 레지스트리에서 전역적으로 고유해야 합니다.
- 렌더러/상태 재구성을 위해 `details`에서 결정적이고 스키마 형태의 출력을 선호하십시오.
- `pi.hasUI`로 UI 사용을 보호하십시오.
- 도구 디렉터리의 `.md`/`.json`을 실행 가능 모듈이 아닌 메타데이터로 처리하십시오.
