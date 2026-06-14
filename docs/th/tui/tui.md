---
title: การรวม TUI สำหรับส่วนขยายและเครื่องมือที่กำหนดเอง
description: สัญญาการรวม TUI สำหรับส่วนขยาย เครื่องมือที่กำหนดเอง และตัวแสดงผลที่กำหนดเอง
sidebar:
  order: 1
  label: การรวมส่วนขยาย
i18n:
  sourceHash: 966be66eee07
  translator: machine
---

# การรวม TUI สำหรับส่วนขยายและเครื่องมือที่กำหนดเอง

เอกสารนี้ครอบคลุม **สัญญา TUI ปัจจุบัน** ที่ใช้โดย `packages/coding-agent` และ `packages/tui` สำหรับ UI ส่วนขยาย, UI เครื่องมือที่กำหนดเอง และตัวแสดงผลที่กำหนดเอง

## ระบบย่อยนี้คืออะไร

รันไทม์มีสองชั้น:

- **เอนจินการแสดงผล (`packages/tui`)**: ตัวแสดงผลเทอร์มินัลแบบดิฟเฟอเรนเชียล, การกระจายอินพุต, โฟกัส, โอเวอร์เลย์, การวางตำแหน่งเคอร์เซอร์
- **ชั้นการรวม (`packages/coding-agent`)**: เมาท์ส่วนประกอบส่วนขยาย/เครื่องมือที่กำหนดเอง, เชื่อมต่อการผูกคีย์/ธีม และกู้คืนสถานะตัวแก้ไข

## พฤติกรรมรันไทม์ตามโหมด

| โหมด | ความพร้อมใช้งานของ `ctx.ui.custom(...)` | หมายเหตุ |
| --- | --- | --- |
| TUI แบบโต้ตอบ | รองรับ | ส่วนประกอบถูกเมาท์ในพื้นที่ตัวแก้ไข โฟกัส และต้องเรียก `done(result)` เพื่อแก้ไข |
| พื้นหลัง/Headless | ไม่โต้ตอบ | บริบท UI เป็น no-op (`hasUI === false`) |
| โหมด RPC | ไม่รองรับ | `custom()` คืนค่า `Promise<never>` และไม่เมาท์ส่วนประกอบ TUI |

หากส่วนขยาย/เครื่องมือของคุณสามารถทำงานในโหมดไม่โต้ตอบ ให้ป้องกันด้วย `ctx.hasUI` / `pi.hasUI`

## สัญญาส่วนประกอบหลัก (`@f5xc-salesdemos/pi-tui`)

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

พฤติกรรมเคอร์เซอร์ใช้ `CURSOR_MARKER` (ไม่ใช่ `getCursorPosition`) ส่วนประกอบที่โฟกัสจะส่ง marker ในข้อความที่แสดงผล; `TUI` จะดึงออกและวางตำแหน่งเคอร์เซอร์ฮาร์ดแวร์

## ข้อจำกัดการแสดงผล (ความปลอดภัยของเทอร์มินัล)

เอาต์พุต `render(width)` ของคุณต้องปลอดภัยสำหรับเทอร์มินัล:

1. **ห้ามเกิน `width` ในบรรทัดใดๆ** ตัวแสดงผลจะโยนข้อผิดพลาดหากบรรทัดที่ไม่ใช่รูปภาพล้น
2. **วัดความกว้างที่มองเห็นได้** ไม่ใช่ความยาวสตริง: ใช้ `visibleWidth()`
3. **ตัดทอน/ตัดบรรทัดข้อความที่รับรู้ ANSI** ด้วย `truncateToWidth()` / `wrapTextWithAnsi()`
4. **ทำความสะอาดแท็บ/เนื้อหา** จากแหล่งภายนอกโดยใช้ `replaceTabs()` (และตัวทำความสะอาดระดับสูงกว่าในเส้นทางแสดงผล coding-agent)

รูปแบบขั้นต่ำ:

```ts
import { replaceTabs, truncateToWidth } from "@f5xc-salesdemos/pi-tui";

render(width: number): string[] {
  return this.lines.map(line => truncateToWidth(replaceTabs(line), width));
}
```

## การจัดการอินพุตและการผูกคีย์

### การจับคู่คีย์ดิบ

ใช้ `matchesKey(data, "...")` สำหรับคีย์นำทางและคำสั่งผสม

### เคารพการผูกคีย์แอปที่ผู้ใช้กำหนดค่า

Factory ของ UI ส่วนขยายรับ `KeybindingsManager` (โหมดโต้ตอบ) เพื่อให้คุณสามารถให้เกียรติการดำเนินการที่แมปไว้แทนการฮาร์ดโค้ดคีย์:

```ts
if (keybindings.matches(data, "interrupt")) {
  done(undefined);
  return;
}
```

### เหตุการณ์การปล่อยคีย์/การทำซ้ำ

เหตุการณ์การปล่อยคีย์จะถูกกรองออก เว้นแต่ส่วนประกอบของคุณจะตั้งค่า:

```ts
wantsKeyRelease = true;
```

จากนั้นใช้ `isKeyRelease()` / `isKeyRepeat()` หากจำเป็น

## โฟกัส, โอเวอร์เลย์ และเคอร์เซอร์

- `TUI.setFocus(component)` กำหนดเส้นทางอินพุตไปยังส่วนประกอบนั้น
- API โอเวอร์เลย์มีอยู่ใน `TUI` (`showOverlay`, `OverlayHandle`) แต่การเมาท์ `ctx.ui.custom` ของส่วนขยายในโหมดโต้ตอบปัจจุบันจะแทนที่พื้นที่ส่วนประกอบตัวแก้ไขโดยตรง
- ตัวเลือก `custom(..., options?: { overlay?: boolean })` มีอยู่ในประเภทส่วนขยาย; การเมาท์ส่วนขยายแบบโต้ตอบในปัจจุบันยังละเว้นตัวเลือกนี้

## จุดเมาท์และสัญญาการคืนค่า

## 1) UI ส่วนขยาย (`ExtensionUIContext`)

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

- บันทึกข้อความตัวแก้ไข
- แทนที่ส่วนประกอบตัวแก้ไขด้วยส่วนประกอบของคุณ
- โฟกัสส่วนประกอบของคุณ
- เมื่อ `done(result)`: เรียก `component.dispose?.()`, กู้คืนตัวแก้ไข + ข้อความ, โฟกัสตัวแก้ไข, แก้ไข promise

ดังนั้น `done(...)` เป็นสิ่งจำเป็นสำหรับการเสร็จสิ้น

## 2) บริบท UI hook/เครื่องมือที่กำหนดเอง (การพิมพ์แบบเดิม)

`HookUIContext.custom` ถูกพิมพ์เป็น `(tui, theme, done)` ในประเภท hook/เครื่องมือที่กำหนดเอง
การใช้งานโต้ตอบพื้นฐานเรียก factory ด้วย `(tui, theme, keybindings, done)` ผู้บริโภค JS สามารถใช้อาร์กิวเมนต์เพิ่มเติมได้; ความเข้ากันได้ระดับประเภทยังคงสะท้อนลายเซ็นเดิม 3 อาร์กิวเมนต์

เครื่องมือที่กำหนดเองมักใช้จุดเข้า UI เดียวกันผ่านออบเจกต์ `pi.ui` ที่กำหนดขอบเขตโดย factory แล้วคืนค่าที่เลือกในเนื้อหาเครื่องมือปกติ:

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

## 3) ตัวแสดงผลการเรียก/ผลลัพธ์เครื่องมือที่กำหนดเอง

เครื่องมือที่กำหนดเองและเครื่องมือส่วนขยายสามารถคืนค่าส่วนประกอบจาก:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

`options` ปัจจุบันประกอบด้วย:

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

ตัวแสดงผลเหล่านี้ถูกเมาท์โดย `ToolExecutionComponent`

## วงจรชีวิตและการยกเลิก

- `dispose()` เป็นทางเลือกในระดับประเภท แต่ควรนำไปใช้เมื่อคุณเป็นเจ้าของตัวจับเวลา, subprocess, ตัวตรวจสอบ, ซ็อกเก็ต หรือโอเวอร์เลย์
- `done(...)` ควรถูกเรียกเพียงครั้งเดียวจากกระบวนการส่วนประกอบของคุณ
- สำหรับ UI ที่ทำงานนานซึ่งสามารถยกเลิกได้ ให้จับคู่ `CancellableLoader` กับ `AbortSignal` และเรียก `done(...)` จาก `onAbort`

ตัวอย่างรูปแบบการยกเลิก:

```ts
const loader = new CancellableLoader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
loader.onAbort = () => done(undefined);
void doWork(loader.signal).then(result => done(result));
return loader;
```

## ตัวอย่างส่วนประกอบที่กำหนดเองจริง (คำสั่งส่วนขยาย)

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

## ไฟล์การใช้งานหลัก

- `packages/tui/src/tui.ts` — `Component`, `Focusable`, cursor marker, โฟกัส, โอเวอร์เลย์, การกระจายอินพุต
- `packages/tui/src/utils.ts` — ส่วนดั้งเดิมของความกว้าง/การตัดทอน/การทำความสะอาด
- `packages/tui/src/keys.ts` / `keybindings.ts` — การแยกวิเคราะห์คีย์และการแมปการดำเนินการที่กำหนดค่าได้
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — การเมาท์/ถอดเมาท์แบบโต้ตอบสำหรับ UI ส่วนขยาย/hook/เครื่องมือที่กำหนดเอง
- `packages/coding-agent/src/extensibility/extensions/types.ts` — สัญญา UI ส่วนขยายและตัวแสดงผล
- `packages/coding-agent/src/extensibility/hooks/types.ts` — สัญญา UI hook (ลายเซ็นที่กำหนดเองแบบเดิม)
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — สัญญา execute/render เครื่องมือที่กำหนดเอง
- `packages/coding-agent/src/modes/components/tool-execution.ts` — การเมาท์ส่วนประกอบ `renderCall`/`renderResult` และตัวเลือกสถานะบางส่วน
- `packages/coding-agent/src/tools/context.ts` — การส่งต่อบริบท UI เครื่องมือ (`hasUI`, `ui`)
