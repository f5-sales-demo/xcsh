---
title: TUI Integration for Extensions and Custom Tools
description: 'TUI integration contract for extensions, custom tools, and custom renderers.'
sidebar:
  order: 1
  label: Extension integration
i18n:
  sourceHash: 966be66eee07
  translator: machine
---

# การรวม TUI สำหรับส่วนขยายและเครื่องมือที่กำหนดเอง

เอกสารนี้ครอบคลุม TUI contract **ปัจจุบัน** ที่ใช้โดย `packages/coding-agent` และ `packages/tui` สำหรับ UI ของส่วนขยาย, UI ของเครื่องมือที่กำหนดเอง และ renderer ที่กำหนดเอง

## ระบบย่อยนี้คืออะไร

ระบบรันไทม์มีสองชั้น:

- **เอนจินการเรนเดอร์ (`packages/tui`)**: differential terminal renderer, การส่งอินพุต, โฟกัส, overlay, การวางตำแหน่งเคอร์เซอร์
- **ชั้นการรวม (`packages/coding-agent`)**: เมาท์คอมโพเนนต์ของส่วนขยาย/เครื่องมือที่กำหนดเอง, เชื่อมต่อ keybinding/ธีม และกู้คืนสถานะของตัวแก้ไข

## พฤติกรรมรันไทม์ตามโหมด

| โหมด | ความพร้อมใช้งานของ `ctx.ui.custom(...)` | หมายเหตุ |
| --- | --- | --- |
| Interactive TUI | รองรับ | คอมโพเนนต์จะถูกเมาท์ในพื้นที่ตัวแก้ไข, ได้รับโฟกัส และต้องเรียก `done(result)` เพื่อ resolve |
| Background/headless | ไม่มีการโต้ตอบ | UI context เป็น no-op (`hasUI === false`) |
| โหมด RPC | ไม่รองรับ | `custom()` คืนค่า `Promise<never>` และไม่เมาท์คอมโพเนนต์ TUI |

หากส่วนขยาย/เครื่องมือของคุณสามารถทำงานในโหมดที่ไม่มีการโต้ตอบ ให้ตรวจสอบด้วย `ctx.hasUI` / `pi.hasUI`

## สัญญาคอมโพเนนต์หลัก (`@f5xc-salesdemos/pi-tui`)

`packages/tui/src/tui.ts` กำหนด:

```ts
export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

`Focusable` แยกต่างหาก:

```ts
export interface Focusable {
  focused: boolean;
}
```

พฤติกรรมเคอร์เซอร์ใช้ `CURSOR_MARKER` (ไม่ใช่ `getCursorPosition`) คอมโพเนนต์ที่ได้รับโฟกัสจะส่งออก marker ในข้อความที่เรนเดอร์ `TUI` จะดึง marker ออกมาและวางตำแหน่งเคอร์เซอร์ฮาร์ดแวร์

## ข้อจำกัดในการเรนเดอร์ (ความปลอดภัยของเทอร์มินัล)

ผลลัพธ์จาก `render(width)` ของคุณต้องปลอดภัยสำหรับเทอร์มินัล:

1. **อย่าเกิน `width` ในบรรทัดใดๆ** renderer จะ throw หากบรรทัดที่ไม่ใช่รูปภาพล้น
2. **วัดความกว้างที่มองเห็น** ไม่ใช่ความยาวสตริง: ใช้ `visibleWidth()`
3. **ตัดทอน/ตัดบรรทัดข้อความที่รับรู้ ANSI** ด้วย `truncateToWidth()` / `wrapTextWithAnsi()`
4. **ทำความสะอาดแท็บ/เนื้อหา** จากแหล่งภายนอกโดยใช้ `replaceTabs()` (และ sanitizer ระดับสูงกว่าใน coding-agent render paths)

รูปแบบขั้นต่ำ:

```ts
import { replaceTabs, truncateToWidth } from "@f5xc-salesdemos/pi-tui";

render(width: number): string[] {
  return this.lines.map(line => truncateToWidth(replaceTabs(line), width));
}
```

## การจัดการอินพุตและ keybinding

### การจับคู่คีย์แบบ raw

ใช้ `matchesKey(data, "...")` สำหรับคีย์นำทางและคีย์ผสม

### เคารพ keybinding ของแอปที่ผู้ใช้กำหนดค่า

UI factory ของส่วนขยายจะได้รับ `KeybindingsManager` (โหมดโต้ตอบ) เพื่อให้คุณสามารถใช้ action ที่แมปไว้แทนการ hardcode คีย์:

```ts
if (keybindings.matches(data, "interrupt")) {
  done(undefined);
  return;
}
```

### เหตุการณ์การปล่อยคีย์/การกดซ้ำ

เหตุการณ์การปล่อยคีย์จะถูกกรองออก เว้นแต่คอมโพเนนต์ของคุณจะตั้งค่า:

```ts
wantsKeyRelease = true;
```

จากนั้นใช้ `isKeyRelease()` / `isKeyRepeat()` ตามต้องการ

## โฟกัส, overlay และเคอร์เซอร์

- `TUI.setFocus(component)` ส่งอินพุตไปยังคอมโพเนนต์นั้น
- API ของ overlay มีอยู่ใน `TUI` (`showOverlay`, `OverlayHandle`) แต่การเมาท์ `ctx.ui.custom` ของส่วนขยายในโหมดโต้ตอบในปัจจุบันจะแทนที่พื้นที่คอมโพเนนต์ตัวแก้ไขโดยตรง
- ตัวเลือก `custom(..., options?: { overlay?: boolean })` มีอยู่ในประเภทของส่วนขยาย การเมาท์ส่วนขยายแบบโต้ตอบในปัจจุบันจะละเว้นตัวเลือกนี้

## จุดเมาท์และสัญญาค่าส่งคืน

## 1) UI ของส่วนขยาย (`ExtensionUIContext`)

signature ปัจจุบัน (`extensibility/extensions/types.ts`):

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

พฤติกรรมในโหมดโต้ตอบ (`extension-ui-controller.ts`):

- บันทึกข้อความของตัวแก้ไข
- แทนที่คอมโพเนนต์ตัวแก้ไขด้วยคอมโพเนนต์ของคุณ
- โฟกัสคอมโพเนนต์ของคุณ
- เมื่อ `done(result)`: เรียก `component.dispose?.()`, กู้คืนตัวแก้ไข + ข้อความ, โฟกัสตัวแก้ไข, resolve promise

ดังนั้น `done(...)` เป็นสิ่งจำเป็นสำหรับการเสร็จสิ้น

## 2) บริบท UI ของ Hook/เครื่องมือที่กำหนดเอง (การกำหนดประเภทแบบ legacy)

`HookUIContext.custom` ถูกกำหนดประเภทเป็น `(tui, theme, done)` ในประเภทของ hook/เครื่องมือที่กำหนดเอง
การใช้งานแบบโต้ตอบภายใต้จะเรียก factory ด้วย `(tui, theme, keybindings, done)` ผู้ใช้ JS สามารถใช้อาร์กิวเมนต์เพิ่มเติมได้ ความเข้ากันได้ในระดับประเภทยังคงสะท้อน signature แบบ 3 อาร์กิวเมนต์แบบ legacy

เครื่องมือที่กำหนดเองโดยทั่วไปจะใช้จุดเข้า UI เดียวกันผ่านออบเจ็กต์ `pi.ui` ที่อยู่ในขอบเขตของ factory จากนั้นส่งคืนค่าที่เลือกในเนื้อหาเครื่องมือปกติ:

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

## 3) renderer สำหรับการเรียกเครื่องมือ/ผลลัพธ์ที่กำหนดเอง

เครื่องมือที่กำหนดเองและเครื่องมือของส่วนขยายสามารถส่งคืนคอมโพเนนต์จาก:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

`options` ในปัจจุบันประกอบด้วย:

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

renderer เหล่านี้ถูกเมาท์โดย `ToolExecutionComponent`

## วงจรชีวิตและการยกเลิก

- `dispose()` เป็นตัวเลือกในระดับประเภท แต่ควรนำไปใช้เมื่อคุณเป็นเจ้าของ timer, subprocess, watcher, socket หรือ overlay
- `done(...)` ควรถูกเรียกเพียงครั้งเดียวจากขั้นตอนคอมโพเนนต์ของคุณ
- สำหรับ UI ที่ทำงานยาวนานและสามารถยกเลิกได้ ให้จับคู่ `CancellableLoader` กับ `AbortSignal` และเรียก `done(...)` จาก `onAbort`

ตัวอย่างรูปแบบการยกเลิก:

```ts
const loader = new CancellableLoader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
loader.onAbort = () => done(undefined);
void doWork(loader.signal).then(result => done(result));
return loader;
```

## ตัวอย่างคอมโพเนนต์ที่กำหนดเองที่สมจริง (คำสั่งส่วนขยาย)

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

## ไฟล์การใช้งานที่สำคัญ

- `packages/tui/src/tui.ts` — `Component`, `Focusable`, cursor marker, โฟกัส, overlay, การส่งอินพุต
- `packages/tui/src/utils.ts` — primitive สำหรับความกว้าง/การตัดทอน/การทำความสะอาด
- `packages/tui/src/keys.ts` / `keybindings.ts` — การแยกวิเคราะห์คีย์และการแมป action ที่กำหนดค่าได้
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — การเมาท์/ถอดเมาท์แบบโต้ตอบสำหรับ UI ของส่วนขยาย/hook/เครื่องมือที่กำหนดเอง
- `packages/coding-agent/src/extensibility/extensions/types.ts` — สัญญา UI และ renderer ของส่วนขยาย
- `packages/coding-agent/src/extensibility/hooks/types.ts` — สัญญา UI ของ hook (signature custom แบบ legacy)
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — สัญญา execute/render ของเครื่องมือที่กำหนดเอง
- `packages/coding-agent/src/modes/components/tool-execution.ts` — การเมาท์คอมโพเนนต์ `renderCall`/`renderResult` และตัวเลือกสถานะ partial
- `packages/coding-agent/src/tools/context.ts` — การแพร่กระจายบริบท UI ของเครื่องมือ (`hasUI`, `ui`)
