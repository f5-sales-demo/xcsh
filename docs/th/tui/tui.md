---
title: การผสานรวม TUI สำหรับส่วนขยายและเครื่องมือกำหนดเอง
description: สัญญาการผสานรวม TUI สำหรับส่วนขยาย เครื่องมือกำหนดเอง และตัวเรนเดอร์กำหนดเอง
sidebar:
  order: 1
  label: การผสานรวมส่วนขยาย
i18n:
  sourceHash: 47f8f2b2045e
  translator: machine
---

# การผสานรวม TUI สำหรับส่วนขยายและเครื่องมือกำหนดเอง

เอกสารนี้ครอบคลุมสัญญา TUI **ปัจจุบัน** ที่ใช้โดย `packages/coding-agent` และ `packages/tui` สำหรับ UI ของส่วนขยาย UI ของเครื่องมือกำหนดเอง และตัวเรนเดอร์กำหนดเอง

## ระบบย่อยนี้คืออะไร

รันไทม์มีสองชั้น:

- **เอนจินเรนเดอร์ (`packages/tui`)**: ตัวเรนเดอร์เทอร์มินัลแบบ differential, การส่งต่อ input, การโฟกัส, overlays, การวางเคอร์เซอร์
- **ชั้นการผสานรวม (`packages/coding-agent`)**: เมานต์คอมโพเนนต์ส่วนขยาย/เครื่องมือกำหนดเอง, เชื่อมต่อ keybindings/theme และกู้คืนสถานะ editor

## พฤติกรรมรันไทม์ตามโหมด

| โหมด | ความพร้อมใช้งานของ `ctx.ui.custom(...)` | หมายเหตุ |
| --- | --- | --- |
| Interactive TUI | รองรับ | คอมโพเนนต์จะถูกเมานต์ในพื้นที่ editor, โฟกัส, และต้องเรียก `done(result)` เพื่อ resolve |
| Background/headless | ไม่ interactive | UI context เป็น no-op (`hasUI === false`) |
| RPC mode | ไม่รองรับ | `custom()` คืนค่า `Promise<never>` และไม่เมานต์คอมโพเนนต์ TUI |

หากส่วนขยาย/เครื่องมือของคุณสามารถทำงานในโหมดไม่ interactive ได้ ให้ใช้ `ctx.hasUI` / `pi.hasUI` ในการตรวจสอบ

## สัญญาคอมโพเนนต์หลัก (`@f5-sales-demo/pi-tui`)

`packages/tui/src/tui.ts` กำหนด:

```ts
export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

`Focusable` แยกออกมาต่างหาก:

```ts
export interface Focusable {
  focused: boolean;
}
```

พฤติกรรมเคอร์เซอร์ใช้ `CURSOR_MARKER` (ไม่ใช่ `getCursorPosition`) คอมโพเนนต์ที่โฟกัสจะปล่อย marker ในข้อความที่เรนเดอร์ จากนั้น `TUI` จะดึงข้อมูลและวางเคอร์เซอร์ฮาร์ดแวร์

## ข้อจำกัดการเรนเดอร์ (ความปลอดภัยของเทอร์มินัล)

output ของ `render(width)` ต้องปลอดภัยสำหรับเทอร์มินัล:

1. **ห้ามเกิน `width` ในบรรทัดใดก็ตาม** ตัวเรนเดอร์จะ throw หากบรรทัดที่ไม่ใช่รูปภาพล้น
2. **วัดความกว้างที่มองเห็นได้** ไม่ใช่ความยาว string: ใช้ `visibleWidth()`
3. **ตัดทอน/จัดการข้อความ ANSI** ด้วย `truncateToWidth()` / `wrapTextWithAnsi()`
4. **Sanitize tabs/เนื้อหา** จากแหล่งภายนอกโดยใช้ `replaceTabs()` (และ sanitizer ระดับสูงกว่าใน render paths ของ coding-agent)

รูปแบบขั้นต่ำ:

```ts
import { replaceTabs, truncateToWidth } from "@f5-sales-demo/pi-tui";

render(width: number): string[] {
  return this.lines.map(line => truncateToWidth(replaceTabs(line), width));
}
```

## การจัดการ Input และ Keybindings

### การจับคู่ key แบบ Raw

ใช้ `matchesKey(data, "...")` สำหรับคีย์นำทางและคอมโบ

### รองรับ keybindings ของแอปที่ผู้ใช้กำหนดค่า

factories ของ UI ส่วนขยายจะได้รับ `KeybindingsManager` (โหมด interactive) เพื่อให้คุณสามารถรองรับ action ที่แมปไว้แทนการ hardcode คีย์:

```ts
if (keybindings.matches(data, "interrupt")) {
  done(undefined);
  return;
}
```

### เหตุการณ์ Key release/repeat

เหตุการณ์ key release จะถูกกรองออก เว้นแต่คอมโพเนนต์ของคุณตั้งค่า:

```ts
wantsKeyRelease = true;
```

จากนั้นใช้ `isKeyRelease()` / `isKeyRepeat()` หากจำเป็น

## การโฟกัส, Overlays และเคอร์เซอร์

- `TUI.setFocus(component)` ส่งต่อ input ไปยังคอมโพเนนต์นั้น
- Overlay API มีอยู่ใน `TUI` (`showOverlay`, `OverlayHandle`) แต่การเมานต์ `ctx.ui.custom` ของส่วนขยายในโหมด interactive ปัจจุบันจะแทนที่พื้นที่คอมโพเนนต์ editor โดยตรง
- ตัวเลือก `custom(..., options?: { overlay?: boolean })` มีอยู่ใน extension types; การเมานต์ส่วนขยาย interactive ปัจจุบันไม่สนใจตัวเลือกนี้

## จุดเมานต์และสัญญาการคืนค่า

## 1) Extension UI (`ExtensionUIContext`)

ลายเซ็นปัจจุบัน (`extensibility/extensions/types.ts`):

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

พฤติกรรมในโหมด interactive (`extension-ui-controller.ts`):

- บันทึกข้อความ editor
- แทนที่คอมโพเนนต์ editor ด้วยคอมโพเนนต์ของคุณ
- โฟกัสคอมโพเนนต์ของคุณ
- เมื่อ `done(result)`: เรียก `component.dispose?.()`, กู้คืน editor + ข้อความ, โฟกัส editor, resolve promise

ดังนั้น `done(...)` เป็นสิ่งจำเป็นสำหรับการเสร็จสิ้น

## 2) Hook/custom-tool UI context (การพิมพ์แบบ legacy)

`HookUIContext.custom` ถูกพิมพ์เป็น `(tui, theme, done)` ใน hook/custom-tool types
การนำไปใช้งาน interactive พื้นฐานเรียก factories ด้วย `(tui, theme, keybindings, done)` ผู้ใช้ JS สามารถใช้ argument เพิ่มเติมได้; ความเข้ากันได้ระดับ type ยังคงสะท้อนลายเซ็น 3 argument แบบ legacy

เครื่องมือกำหนดเองโดยทั่วไปใช้จุดเข้า UI เดียวกันผ่าน object `pi.ui` ที่กำหนดขอบเขต factory จากนั้นคืนค่าที่เลือกในเนื้อหาเครื่องมือปกติ:

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

## 3) ตัวเรนเดอร์ tool call/result กำหนดเอง

เครื่องมือกำหนดเองและเครื่องมือส่วนขยายสามารถคืนค่าคอมโพเนนต์จาก:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

`options` ปัจจุบันรวมถึง:

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

ตัวเรนเดอร์เหล่านี้จะถูกเมานต์โดย `ToolExecutionComponent`

## วงจรชีวิตและการยกเลิก

- `dispose()` เป็น optional ในระดับ type แต่ควรนำไปใช้เมื่อคุณเป็นเจ้าของ timers, subprocesses, watchers, sockets หรือ overlays
- `done(...)` ควรถูกเรียกเพียงครั้งเดียวจาก flow ของคอมโพเนนต์
- สำหรับ UI ที่ทำงานนานและสามารถยกเลิกได้ ให้จับคู่ `CancellableLoader` กับ `AbortSignal` และเรียก `done(...)` จาก `onAbort`

ตัวอย่างรูปแบบการยกเลิก:

```ts
const loader = new CancellableLoader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
loader.onAbort = () => done(undefined);
void doWork(loader.signal).then(result => done(result));
return loader;
```

## ตัวอย่างคอมโพเนนต์กำหนดเองที่สมจริง (คำสั่งส่วนขยาย)

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

## ไฟล์การนำไปใช้งานหลัก

- `packages/tui/src/tui.ts` — `Component`, `Focusable`, cursor marker, การโฟกัส, overlay, การส่งต่อ input
- `packages/tui/src/utils.ts` — primitives สำหรับ width/truncation/sanitization
- `packages/tui/src/keys.ts` / `keybindings.ts` — การ parse คีย์และการแมป action ที่กำหนดค่าได้
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — การเมานต์/ถอดเมานต์ interactive สำหรับ UI ของส่วนขยาย/hook/เครื่องมือกำหนดเอง
- `packages/coding-agent/src/extensibility/extensions/types.ts` — สัญญา UI ของส่วนขยายและตัวเรนเดอร์
- `packages/coding-agent/src/extensibility/hooks/types.ts` — สัญญา UI ของ hook (ลายเซ็นกำหนดเอง legacy)
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — สัญญา execute/render ของเครื่องมือกำหนดเอง
- `packages/coding-agent/src/modes/components/tool-execution.ts` — การเมานต์คอมโพเนนต์ `renderCall`/`renderResult` และตัวเลือก partial-state
- `packages/coding-agent/src/tools/context.ts` — การ propagate UI context ของเครื่องมือ (`hasUI`, `ui`)
