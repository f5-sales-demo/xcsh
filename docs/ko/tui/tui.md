---
title: 확장 기능 및 커스텀 도구를 위한 TUI 통합
description: '확장 기능, 커스텀 도구, 커스텀 렌더러를 위한 TUI 통합 계약.'
sidebar:
  order: 1
  label: 확장 기능 통합
i18n:
  sourceHash: 966be66eee07
  translator: machine
---

# 확장 기능 및 커스텀 도구를 위한 TUI 통합

이 문서는 확장 UI, 커스텀 도구 UI, 커스텀 렌더러를 위해 `packages/coding-agent`와 `packages/tui`에서 사용하는 **현재** TUI 계약을 다룹니다.

## 이 하위 시스템의 구성

런타임은 두 개의 레이어로 구성됩니다:

- **렌더링 엔진 (`packages/tui`)**: 차등 터미널 렌더러, 입력 디스패치, 포커스, 오버레이, 커서 배치.
- **통합 레이어 (`packages/coding-agent`)**: 확장 기능/커스텀 도구 컴포넌트를 마운트하고, 키바인딩/테마를 연결하며, 에디터 상태를 복원합니다.

## 모드별 런타임 동작

| 모드 | `ctx.ui.custom(...)` 사용 가능 여부 | 참고 사항 |
| --- | --- | --- |
| 대화형 TUI | 지원됨 | 컴포넌트가 에디터 영역에 마운트되고 포커스를 받으며, 해결하려면 `done(result)`를 호출해야 합니다. |
| 백그라운드/헤드리스 | 비대화형 | UI 컨텍스트가 no-op입니다 (`hasUI === false`). |
| RPC 모드 | 지원되지 않음 | `custom()`은 `Promise<never>`를 반환하며 TUI 컴포넌트를 마운트하지 않습니다. |

확장 기능/도구가 비대화형 모드에서 실행될 수 있는 경우, `ctx.hasUI` / `pi.hasUI`로 가드하세요.

## 핵심 컴포넌트 계약 (`@f5xc-salesdemos/pi-tui`)

`packages/tui/src/tui.ts`에서 정의됩니다:

```ts
export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

`Focusable`은 별도로 정의됩니다:

```ts
export interface Focusable {
  focused: boolean;
}
```

커서 동작은 `CURSOR_MARKER`를 사용합니다 (`getCursorPosition`이 아님). 포커스된 컴포넌트가 렌더링된 텍스트에 마커를 출력하면, `TUI`가 이를 추출하여 하드웨어 커서를 배치합니다.

## 렌더링 제약 조건 (터미널 안전성)

`render(width)` 출력은 터미널에 안전해야 합니다:

1. **어떤 줄에서도 `width`를 초과하지 마세요**. 이미지가 아닌 줄이 오버플로되면 렌더러가 오류를 발생시킵니다.
2. **시각적 너비를 측정하세요**, 문자열 길이가 아닙니다: `visibleWidth()`를 사용하세요.
3. **ANSI 인식 텍스트 잘라내기/줄바꿈**에는 `truncateToWidth()` / `wrapTextWithAnsi()`를 사용하세요.
4. **외부 소스의 탭/콘텐츠를 정리**하려면 `replaceTabs()`를 사용하세요 (coding-agent 렌더 경로에서는 더 높은 수준의 정리기를 사용합니다).

최소 패턴:

```ts
import { replaceTabs, truncateToWidth } from "@f5xc-salesdemos/pi-tui";

render(width: number): string[] {
  return this.lines.map(line => truncateToWidth(replaceTabs(line), width));
}
```

## 입력 처리 및 키바인딩

### 원시 키 매칭

탐색 키와 조합에는 `matchesKey(data, "...")`를 사용하세요.

### 사용자 설정 앱 키바인딩 준수

확장 UI 팩토리는 `KeybindingsManager`(대화형 모드)를 수신하므로, 키를 하드코딩하는 대신 매핑된 액션을 준수할 수 있습니다:

```ts
if (keybindings.matches(data, "interrupt")) {
  done(undefined);
  return;
}
```

### 키 릴리스/반복 이벤트

키 릴리스 이벤트는 컴포넌트에서 다음을 설정하지 않는 한 필터링됩니다:

```ts
wantsKeyRelease = true;
```

필요한 경우 `isKeyRelease()` / `isKeyRepeat()`를 사용하세요.

## 포커스, 오버레이, 커서

- `TUI.setFocus(component)`는 해당 컴포넌트로 입력을 라우팅합니다.
- 오버레이 API는 `TUI`에 존재하지만 (`showOverlay`, `OverlayHandle`), 대화형 모드에서의 확장 `ctx.ui.custom` 마운트는 현재 에디터 컴포넌트 영역을 직접 교체합니다.
- `custom(..., options?: { overlay?: boolean })` 옵션은 확장 타입에 존재하지만, 현재 대화형 확장 마운트에서는 이 옵션을 무시합니다.

## 마운트 지점 및 반환 계약

## 1) 확장 UI (`ExtensionUIContext`)

현재 시그니처 (`extensibility/extensions/types.ts`):

```ts
custom<T>(
  factory: (
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result: T) => void,
  ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
  options?: { overlay?: boolean },
): Promise<T>
```

대화형 모드에서의 동작 (`extension-ui-controller.ts`):

- 에디터 텍스트를 저장합니다.
- 에디터 컴포넌트를 사용자의 컴포넌트로 교체합니다.
- 사용자의 컴포넌트에 포커스를 설정합니다.
- `done(result)` 호출 시: `component.dispose?.()`를 호출하고, 에디터와 텍스트를 복원하고, 에디터에 포커스를 설정하고, 프로미스를 해결합니다.

따라서 `done(...)`은 완료를 위해 필수입니다.

## 2) 훅/커스텀 도구 UI 컨텍스트 (레거시 타이핑)

`HookUIContext.custom`은 훅/커스텀 도구 타입에서 `(tui, theme, done)`으로 타입이 지정됩니다.
기저의 대화형 구현은 팩토리를 `(tui, theme, keybindings, done)`으로 호출합니다. JS 소비자는 추가 인수를 사용할 수 있으며, 타입 수준의 호환성은 여전히 3인수 레거시 시그니처를 반영합니다.

커스텀 도구는 일반적으로 팩토리 범위의 `pi.ui` 객체를 통해 동일한 UI 진입점을 사용한 다음, 일반 도구 콘텐츠로 선택된 값을 반환합니다:

```ts
async execute(toolCallId, params, onUpdate, ctx, signal) {
  if (!pi.hasUI) {
    return { content: [{ type: "text", text: "UI unavailable" }] };
  }

  const picked = await pi.ui.custom<string | undefined>((tui, theme, done) => {
    const component = new MyPickerComponent(done, signal);
    return component;
  });

  return { content: [{ type: "text", text: picked ? `Picked: ${picked}` : "Cancelled" }] };
}
```

## 3) 커스텀 도구 호출/결과 렌더러

커스텀 도구와 확장 도구는 다음에서 컴포넌트를 반환할 수 있습니다:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

`options`는 현재 다음을 포함합니다:

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

이 렌더러들은 `ToolExecutionComponent`에 의해 마운트됩니다.

## 생명주기 및 취소

- `dispose()`는 타입 수준에서 선택 사항이지만, 타이머, 서브프로세스, 워처, 소켓, 또는 오버레이를 소유하는 경우 구현해야 합니다.
- `done(...)`은 컴포넌트 플로우에서 정확히 한 번 호출되어야 합니다.
- 취소 가능한 장시간 실행 UI의 경우, `CancellableLoader`를 `AbortSignal`과 결합하고 `onAbort`에서 `done(...)`을 호출하세요.

취소 패턴 예시:

```ts
const loader = new CancellableLoader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
loader.onAbort = () => done(undefined);
void doWork(loader.signal).then(result => done(result));
return loader;
```

## 실제 커스텀 컴포넌트 예시 (확장 명령)

```ts
import type { Component } from "@f5xc-salesdemos/pi-tui";
import { SelectList, matchesKey, replaceTabs, truncateToWidth } from "@f5xc-salesdemos/pi-tui";
import { getSelectListTheme, type ExtensionAPI } from "@f5xc-salesdemos/xcsh";

class Picker implements Component {
  list: SelectList;
  keybindings: any;
  done: (value: string | undefined) => void;

  constructor(
    items: Array<{ value: string; label: string }>,
    keybindings: any,
    done: (value: string | undefined) => void,
  ) {
    this.list = new SelectList(items, 8, getSelectListTheme());
    this.keybindings = keybindings;
    this.done = done;
    this.list.onSelect = item => this.done(item.value);
    this.list.onCancel = () => this.done(undefined);
  }

  handleInput(data: string): void {
    if (this.keybindings.matches(data, "interrupt")) {
      this.done(undefined);
      return;
    }
    this.list.handleInput(data);
  }

  render(width: number): string[] {
    return this.list.render(width).map(line => truncateToWidth(replaceTabs(line), width));
  }

  invalidate(): void {
    this.list.invalidate();
  }
}

export default function extension(pi: ExtensionAPI): void {
  pi.registerCommand("pick-model", {
    description: "Pick a model profile",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;

      const selected = await ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
        const items = [
          { value: "fast", label: theme.fg("accent", "Fast") },
          { value: "balanced", label: "Balanced" },
          { value: "quality", label: "Quality" },
        ];
        return new Picker(items, keybindings, done);
      });

      if (selected) ctx.ui.notify(`Selected profile: ${selected}`, "info");
    },
  });
}
```

## 주요 구현 파일

- `packages/tui/src/tui.ts` — `Component`, `Focusable`, 커서 마커, 포커스, 오버레이, 입력 디스패치.
- `packages/tui/src/utils.ts` — 너비/잘라내기/정리 프리미티브.
- `packages/tui/src/keys.ts` / `keybindings.ts` — 키 파싱 및 설정 가능한 액션 매핑.
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — 확장/훅/커스텀 도구 UI의 대화형 마운트/언마운트.
- `packages/coding-agent/src/extensibility/extensions/types.ts` — 확장 UI 및 렌더러 계약.
- `packages/coding-agent/src/extensibility/hooks/types.ts` — 훅 UI 계약 (레거시 custom 시그니처).
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — 커스텀 도구 실행/렌더 계약.
- `packages/coding-agent/src/modes/components/tool-execution.ts` — `renderCall`/`renderResult` 컴포넌트 마운트 및 부분 상태 옵션.
- `packages/coding-agent/src/tools/context.ts` — 도구 UI 컨텍스트 전파 (`hasUI`, `ui`).
