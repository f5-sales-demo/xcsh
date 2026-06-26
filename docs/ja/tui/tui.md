---
title: 拡張機能とカスタムツールのTUI統合
description: 拡張機能、カスタムツール、カスタムレンダラーのためのTUI統合コントラクト。
sidebar:
  order: 1
  label: 拡張機能統合
i18n:
  sourceHash: 966be66eee07
  translator: machine
---

# 拡張機能とカスタムツールのTUI統合

このドキュメントでは、`packages/coding-agent` と `packages/tui` が拡張機能UI、カスタムツールUI、およびカスタムレンダラーに使用する**現在の** TUIコントラクトについて説明します。

## このサブシステムとは

ランタイムには2つのレイヤーがあります：

- **レンダリングエンジン (`packages/tui`)**: 差分ターミナルレンダラー、入力ディスパッチ、フォーカス、オーバーレイ、カーソル配置。
- **統合レイヤー (`packages/coding-agent`)**: 拡張機能/カスタムツールコンポーネントのマウント、キーバインディング/テーマの接続、エディタ状態の復元。

## モード別のランタイム動作

| モード | `ctx.ui.custom(...)` の利用可否 | 備考 |
| --- | --- | --- |
| インタラクティブTUI | サポート | コンポーネントはエディタ領域にマウントされ、フォーカスされ、解決するために `done(result)` を呼び出す必要があります。 |
| バックグラウンド/ヘッドレス | 非インタラクティブ | UIコンテキストはno-op（`hasUI === false`）。 |
| RPCモード | 非サポート | `custom()` は `Promise<never>` を返し、TUIコンポーネントをマウントしません。 |

拡張機能/ツールが非インタラクティブモードで動作可能な場合は、`ctx.hasUI` / `pi.hasUI` でガードしてください。

## コアコンポーネントコントラクト (`@f5-sales-demo/pi-tui`)

`packages/tui/src/tui.ts` で定義されています：

```ts
export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

`Focusable` は別インターフェースです：

```ts
export interface Focusable {
  focused: boolean;
}
```

カーソルの動作は `CURSOR_MARKER`（`getCursorPosition` ではなく）を使用します。フォーカスされたコンポーネントはレンダリングされたテキストにマーカーを出力し、`TUI` がそれを抽出してハードウェアカーソルを配置します。

## レンダリング制約（ターミナルの安全性）

`render(width)` の出力はターミナルセーフでなければなりません：

1. **どの行でも `width` を超えないこと**。レンダラーは画像以外の行がオーバーフローした場合にスローします。
2. **文字列長ではなく、視覚的な幅を測定すること**: `visibleWidth()` を使用してください。
3. **ANSIを考慮したテキストの切り詰め/折り返し**には `truncateToWidth()` / `wrapTextWithAnsi()` を使用してください。
4. **外部ソースからのタブ/コンテンツのサニタイズ**には `replaceTabs()`（およびcoding-agentレンダーパスの上位レベルのサニタイザー）を使用してください。

最小パターン：

```ts
import { replaceTabs, truncateToWidth } from "@f5-sales-demo/pi-tui";

render(width: number): string[] {
  return this.lines.map(line => truncateToWidth(replaceTabs(line), width));
}
```

## 入力処理とキーバインディング

### 生のキーマッチング

ナビゲーションキーとコンビネーションには `matchesKey(data, "...")` を使用してください。

### ユーザー設定のアプリキーバインディングの尊重

拡張機能UIファクトリーは `KeybindingsManager`（インタラクティブモード）を受け取るため、キーをハードコーディングする代わりにマップされたアクションを尊重できます：

```ts
if (keybindings.matches(data, "interrupt")) {
  done(undefined);
  return;
}
```

### キーリリース/リピートイベント

キーリリースイベントは、コンポーネントが以下を設定しない限りフィルタリングされます：

```ts
wantsKeyRelease = true;
```

必要に応じて `isKeyRelease()` / `isKeyRepeat()` を使用してください。

## フォーカス、オーバーレイ、カーソル

- `TUI.setFocus(component)` は入力をそのコンポーネントにルーティングします。
- オーバーレイAPIは `TUI`（`showOverlay`、`OverlayHandle`）に存在しますが、インタラクティブモードでの拡張機能 `ctx.ui.custom` マウントは現在、エディタコンポーネント領域を直接置き換えます。
- `custom(..., options?: { overlay?: boolean })` オプションは拡張機能の型に存在しますが、インタラクティブな拡張機能マウントは現在このオプションを無視します。

## マウントポイントと戻り値のコントラクト

## 1) 拡張機能UI (`ExtensionUIContext`)

現在のシグネチャ（`extensibility/extensions/types.ts`）：

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

インタラクティブモードでの動作（`extension-ui-controller.ts`）：

- エディタテキストを保存します。
- エディタコンポーネントをあなたのコンポーネントに置き換えます。
- あなたのコンポーネントにフォーカスします。
- `done(result)` 時：`component.dispose?.()` を呼び出し、エディタ＋テキストを復元し、エディタにフォーカスし、Promiseを解決します。

したがって、`done(...)` は完了のために必須です。

## 2) フック/カスタムツールUIコンテキスト（レガシー型定義）

`HookUIContext.custom` はフック/カスタムツールの型で `(tui, theme, done)` として型定義されています。
基盤となるインタラクティブ実装はファクトリーを `(tui, theme, keybindings, done)` で呼び出します。JSコンシューマーは追加の引数を使用できますが、型レベルの互換性は3引数のレガシーシグネチャを反映しています。

カスタムツールは通常、ファクトリースコープの `pi.ui` オブジェクトを介して同じUIエントリーポイントを使用し、選択された値を通常のツールコンテンツで返します：

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

## 3) カスタムツールコール/結果レンダラー

カスタムツールと拡張機能ツールは以下からコンポーネントを返すことができます：

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

`options` には現在以下が含まれます：

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

これらのレンダラーは `ToolExecutionComponent` によってマウントされます。

## ライフサイクルとキャンセル

- `dispose()` は型レベルではオプションですが、タイマー、サブプロセス、ウォッチャー、ソケット、またはオーバーレイを所有している場合は実装すべきです。
- `done(...)` はコンポーネントのフローから正確に1回呼び出されるべきです。
- キャンセル可能な長時間実行UIの場合、`CancellableLoader` を `AbortSignal` とペアにし、`onAbort` から `done(...)` を呼び出してください。

キャンセルパターンの例：

```ts
const loader = new CancellableLoader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
loader.onAbort = () => done(undefined);
void doWork(loader.signal).then(result => done(result));
return loader;
```

## 実用的なカスタムコンポーネントの例（拡張機能コマンド）

```ts
import type { Component } from "@f5-sales-demo/pi-tui";
import { SelectList, matchesKey, replaceTabs, truncateToWidth } from "@f5-sales-demo/pi-tui";
import { getSelectListTheme, type ExtensionAPI } from "@f5-sales-demo/xcsh";

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

## 主要な実装ファイル

- `packages/tui/src/tui.ts` — `Component`、`Focusable`、カーソルマーカー、フォーカス、オーバーレイ、入力ディスパッチ。
- `packages/tui/src/utils.ts` — 幅/切り詰め/サニタイズのプリミティブ。
- `packages/tui/src/keys.ts` / `keybindings.ts` — キーパースおよび設定可能なアクションマッピング。
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — 拡張機能/フック/カスタムツールUIのインタラクティブなマウント/アンマウント。
- `packages/coding-agent/src/extensibility/extensions/types.ts` — 拡張機能UIおよびレンダラーのコントラクト。
- `packages/coding-agent/src/extensibility/hooks/types.ts` — フックUIコントラクト（レガシーカスタムシグネチャ）。
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — カスタムツールのexecute/renderコントラクト。
- `packages/coding-agent/src/modes/components/tool-execution.ts` — `renderCall`/`renderResult` コンポーネントのマウントおよび部分状態オプション。
- `packages/coding-agent/src/tools/context.ts` — ツールUIコンテキストの伝播（`hasUI`、`ui`）。
