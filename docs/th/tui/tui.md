---
title: การรวม TUI สำหรับส่วนขยายและเครื่องมือแบบกำหนดเอง
description: สัญญาการรวม TUI สำหรับส่วนขยาย เครื่องมือแบบกำหนดเอง และตัวเรนเดอร์แบบกำหนดเอง
sidebar:
  order: 1
  label: การรวมส่วนขยาย
i18n:
  sourceHash: 966be66eee07
  translator: machine
---

# การรวม TUI สำหรับส่วนขยายและเครื่องมือแบบกำหนดเอง

เอกสารนี้ครอบคลุมสัญญา TUI **ปัจจุบัน** ที่ใช้โดย `packages/coding-agent` และ `packages/tui` สำหรับ UI ของส่วนขยาย, UI ของเครื่องมือแบบกำหนดเอง และตัวเรนเดอร์แบบกำหนดเอง

## ระบบย่อยนี้คืออะไร

รันไทม์มีสองชั้น:

- **เอนจินการเรนเดอร์ (`packages/tui`)**: ตัวเรนเดอร์เทอร์มินัลแบบส่วนต่าง, การส่งอินพุต, โฟกัส, โอเวอร์เลย์, การวางตำแหน่งเคอร์เซอร์
- **ชั้นการรวม (`packages/coding-agent`)**: เมาท์คอมโพเนนต์ส่วนขยาย/เครื่องมือแบบกำหนดเอง, เชื่อมต่อคีย์ลัด/ธีม และกู้คืนสถานะเอดิเตอร์

## พฤติกรรมรันไทม์ตามโหมด

| โหมด | ความพร้อมใช้งาน `ctx.ui.custom(...)` | หมายเหตุ |
| --- | --- | --- |
| TUI แบบโต้ตอบ | รองรับ | คอมโพเนนต์ถูกเมาท์ในพื้นที่เอดิเตอร์ ได้รับโฟกัส และต้องเรียก `done(result)` เพื่อ resolve |
| พื้นหลัง/headless | ไม่โต้ตอบ | UI context เป็น no-op (`hasUI === false`) |
| โหมด RPC | ไม่รองรับ | `custom()` คืนค่า `Promise<never>` และไม่เมาท์คอมโพเนนต์ TUI |

หากส่วนขยาย/เครื่องมือของคุณสามารถทำงานในโหมดไม่โต้ตอบได้ ให้ตรวจสอบด้วย `ctx.hasUI` / `pi.hasUI`

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

พฤติกรรมเคอร์เซอร์ใช้ `CURSOR_MARKER` (ไม่ใช่ `getCursorPosition`) คอมโพเนนต์ที่ได้รับโฟกัสจะปล่อยมาร์กเกอร์ในข้อความที่เรนเดอร์; `TUI` จะแยกมาร์กเกอร์ออกมาและวางตำแหน่งเคอร์เซอร์ฮาร์ดแวร์

## ข้อจำกัดการเรนเดอร์ (ความปลอดภัยของเทอร์มินัล)

ผลลัพธ์ `render(width)` ของคุณต้องปลอดภัยสำหรับเทอร์มินัล:

1. **ห้ามเกิน `width` ในบรรทัดใดๆ** ตัวเรนเดอร์จะ throw หากบรรทัดที่ไม่ใช่รูปภาพล้น
2. **วัดความกว้างที่มองเห็น** ไม่ใช่ความยาวสตริง: ใช้ `visibleWidth()`
3. **ตัด/ห่อข้อความที่รองรับ ANSI** ด้วย `truncateToWidth()` / `wrapTextWithAnsi()`
4. **ทำความสะอาดแท็บ/เนื้อหา** จากแหล่งภายนอกโดยใช้ `replaceTabs()` (และตัวทำความสะอาดระดับสูงกว่าในเส้นทางเรนเดอร์ของ coding-agent)

รูปแบบขั้นต่ำ:

```ts
import { replaceTabs, truncateToWidth } from "@f5xc-salesdemos/pi-tui";

render(width: number): string[] {
  return this.lines.map(line => truncateToWidth(replaceTabs(line), width));
}
```

## การจัดการอินพุตและคีย์ลัด

### การจับคู่คีย์แบบดิบ

ใช้ `matchesKey(data, "...")` สำหรับคีย์นำทางและคอมโบ

### เคารพคีย์ลัดแอปที่ผู้ใช้กำหนดค่า

โรงงาน UI ของส่วนขยายจะได้รับ `KeybindingsManager` (โหมดโต้ตอบ) เพื่อให้คุณสามารถเคารพแอคชันที่แมปแทนการฮาร์ดโค้ดคีย์:

```ts
if (keybindings.matches(data, "interrupt")) {
  done(undefined);
  return;
}
```

### เหตุการณ์การปล่อยคีย์/การกดซ้ำ

เหตุการณ์การปล่อยคีย์จะถูกกรองออก เว้นแต่คอมโพเนนต์ของคุณตั้งค่า:

```ts
wantsKeyRelease = true;
```

จากนั้นใช้ `isKeyRelease()` / `isKeyRepeat()` หากจำเป็น

## โฟกัส โอเวอร์เลย์ และเคอร์เซอร์

- `TUI.setFocus(component)` ส่งอินพุตไปยังคอมโพเนนต์นั้น
- API โอเวอร์เลย์มีอยู่ใน `TUI` (`showOverlay`, `OverlayHandle`) แต่การเมาท์ `ctx.ui.custom` ของส่วนขยายในโหมดโต้ตอบปัจจุบันจะแทนที่พื้นที่คอมโพเนนต์เอดิเตอร์โดยตรง
- ตัวเลือก `custom(..., options?: { overlay?: boolean })` มีอยู่ในประเภทส่วนขยาย; การเมาท์ส่วนขยายแบบโต้ตอบปัจจุบันจะเพิกเฉยตัวเลือกนี้

## จุดเมาท์และสัญญาการคืนค่า

## 1) UI ของส่วนขยาย (`ExtensionUIContext`)

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

พฤติกรรมในโหมดโต้ตอบ (`extension-ui-controller.ts`):

- บันทึกข้อความเอดิเตอร์
- แทนที่คอมโพเนนต์เอดิเตอร์ด้วยคอมโพเนนต์ของคุณ
- โฟกัสคอมโพเนนต์ของคุณ
- เมื่อ `done(result)`: เรียก `component.dispose?.()` กู้คืนเอดิเตอร์ + ข้อความ โฟกัสเอดิเตอร์ resolve promise

ดังนั้น `done(...)` จำเป็นสำหรับการเสร็จสิ้น

## 2) บริบท UI ของ hook/เครื่องมือแบบกำหนดเอง (การกำหนดประเภทแบบเดิม)

`HookUIContext.custom` มีประเภทเป็น `(tui, theme, done)` ในประเภท hook/เครื่องมือแบบกำหนดเอง
การดำเนินการแบบโต้ตอบภายใต้เรียกโรงงานด้วย `(tui, theme, keybindings, done)` ผู้ใช้ JS สามารถใช้อาร์กิวเมนต์เพิ่มเติม; ความเข้ากันได้ระดับประเภทยังคงสะท้อนลายเซ็นแบบ 3 อาร์กิวเมนต์เดิม

เครื่องมือแบบกำหนดเองมักใช้จุดเข้า UI เดียวกันผ่านอ็อบเจกต์ `pi.ui` ที่อยู่ในขอบเขตของโรงงาน จากนั้นคืนค่าที่เลือกในเนื้อหาเครื่องมือปกติ:

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

## 3) ตัวเรนเดอร์การเรียก/ผลลัพธ์ของเครื่องมือแบบกำหนดเอง

เครื่องมือแบบกำหนดเองและเครื่องมือส่วนขยายสามารถคืนคอมโพเนนต์จาก:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

`options` ปัจจุบันประกอบด้วย:

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

ตัวเรนเดอร์เหล่านี้ถูกเมาท์โดย `ToolExecutionComponent`

## วงจรชีวิตและการยกเลิก

- `dispose()` เป็นทางเลือกในระดับประเภท แต่ควรนำไปใช้เมื่อคุณเป็นเจ้าของตัวตั้งเวลา กระบวนการย่อย ตัวเฝ้าดู ซ็อกเก็ต หรือโอเวอร์เลย์
- `done(...)` ควรถูกเรียกเพียงครั้งเดียวจากโฟลว์คอมโพเนนต์ของคุณ
- สำหรับ UI ที่ทำงานยาวนานและยกเลิกได้ ให้จับคู่ `CancellableLoader` กับ `AbortSignal` และเรียก `done(...)` จาก `onAbort`

ตัวอย่างรูปแบบการยกเลิก:

```ts
const loader = new CancellableLoader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
loader.onAbort = () => done(undefined);
void doWork(loader.signal).then(result => done(result));
return loader;
```

## ตัวอย่างคอมโพเนนต์แบบกำหนดเองที่เป็นจริง (คำสั่งส่วนขยาย)

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

## ไฟล์การดำเนินการสำคัญ

- `packages/tui/src/tui.ts` — `Component`, `Focusable`, cursor marker, โฟกัส, โอเวอร์เลย์, การส่งอินพุต
- `packages/tui/src/utils.ts` — พื้นฐานความกว้าง/การตัด/การทำความสะอาด
- `packages/tui/src/keys.ts` / `keybindings.ts` — การแยกวิเคราะห์คีย์และการแมปแอคชันที่กำหนดค่าได้
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — การเมาท์/ยกเลิกเมาท์แบบโต้ตอบสำหรับ UI ส่วนขยาย/hook/เครื่องมือแบบกำหนดเอง
- `packages/coding-agent/src/extensibility/extensions/types.ts` — สัญญา UI และตัวเรนเดอร์ของส่วนขยาย
- `packages/coding-agent/src/extensibility/hooks/types.ts` — สัญญา UI ของ hook (ลายเซ็น custom แบบเดิม)
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — สัญญา execute/render ของเครื่องมือแบบกำหนดเอง
- `packages/coding-agent/src/modes/components/tool-execution.ts` — การเมาท์คอมโพเนนต์ `renderCall`/`renderResult` และตัวเลือกสถานะบางส่วน
- `packages/coding-agent/src/tools/context.ts` — การแพร่กระจายบริบท UI ของเครื่องมือ (`hasUI`, `ui`)
