---
title: ภายในรันไทม์ของเครื่องมือ Resolve
description: >-
  รันไทม์ของเครื่องมือ Resolve สำหรับการระบุเส้นทางไฟล์ การดึงเนื้อหา
  และการเข้าถึงทรัพยากรผ่าน URL
sidebar:
  order: 3
  label: เครื่องมือ Resolve
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# ภายในรันไทม์ของเครื่องมือ Resolve

เอกสารนี้อธิบายวิธีการสร้างแบบจำลองขั้นตอนการทำงาน preview/apply ใน coding-agent และวิธีที่เครื่องมือแบบกำหนดเองสามารถเข้าร่วมได้ผ่าน `pushPendingAction`

## ขอบเขตและไฟล์หลัก

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## สิ่งที่ `resolve` ทำ

`resolve` คือเครื่องมือที่ซ่อนอยู่ซึ่งทำให้การดำเนินการ preview ที่รอดำเนินการเสร็จสมบูรณ์

- `action: "apply"` จะเรียกใช้ `apply(reason)` บนการดำเนินการที่รอดำเนินการและบันทึกการเปลี่ยนแปลง
- `action: "discard"` จะเรียกใช้ `reject(reason)` หากมีการกำหนดไว้ มิฉะนั้นจะยกเลิกการดำเนินการด้วยข้อความเริ่มต้น "Discarded"

หากไม่มีการดำเนินการที่รอดำเนินการ `resolve` จะล้มเหลวพร้อมข้อความ:

- `No pending action to resolve. Nothing to apply or discard.`

## การดำเนินการที่รอดำเนินการเป็นสแตก (LIFO)

การดำเนินการที่รอดำเนินการจะถูกจัดเก็บใน `PendingActionStore` ในรูปแบบสแตก push/pop:

- `push(action)` เพิ่มการดำเนินการที่รอดำเนินการใหม่ขึ้นไปที่ด้านบน
- `peek()` ตรวจสอบการดำเนินการที่อยู่ด้านบนในปัจจุบัน
- `pop()` นำการดำเนินการที่อยู่ด้านบนออกและส่งคืน
- `hasPending` ระบุว่าสแตกไม่ว่างเปล่าหรือไม่

`resolve` จะใช้งานการดำเนินการที่รอดำเนินการที่ **อยู่บนสุด** เสมอก่อน (`pop()`) ดังนั้นเครื่องมือที่สร้าง preview หลายตัวจะถูก resolve ตามลำดับย้อนกลับของการลงทะเบียน

## ตัวอย่าง producer ในตัว (`ast_edit`)

`ast_edit` จะแสดง preview การแทนที่โครงสร้างก่อน เมื่อ preview มีการแทนที่และยังไม่ได้ถูก apply จะมีการ push การดำเนินการที่รอดำเนินการซึ่งประกอบด้วย:

- label (สรุปที่มนุษย์อ่านได้)
- `sourceToolName` (`ast_edit`)
- callback `apply(reason: string)` ที่รันการแก้ไข AST อีกครั้งด้วย `dryRun: false`

`resolve(action="apply", reason="...")` จะส่ง `reason` เข้าไปยัง callback นี้

## เครื่องมือแบบกำหนดเอง: `pushPendingAction`

เครื่องมือแบบกำหนดเองสามารถลงทะเบียนการดำเนินการที่รอดำเนินการที่เข้ากันได้กับ resolve ผ่าน `CustomToolAPI.pushPendingAction(...)`

`CustomToolPendingAction`:

- `label: string` (จำเป็น)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (จำเป็น) — ถูกเรียกใช้เมื่อ apply; `reason` คือสตริงที่ส่งไปยัง `resolve`
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (ไม่บังคับ) — ถูกเรียกใช้เมื่อ discard; ค่าที่ส่งคืนจะแทนที่ข้อความ "Discarded" เริ่มต้นหากมีการกำหนดไว้
- `details?: unknown` (ไม่บังคับ)
- `sourceToolName?: string` (ไม่บังคับ ค่าเริ่มต้นคือ `"custom_tool"`)

### ตัวอย่างการใช้งานขั้นต่ำ

```ts
import type { CustomToolFactory } from "@f5-sales-demo/xcsh";

const factory: CustomToolFactory = pi => ({
 name: "batch_rename_preview",
 label: "Batch Rename Preview",
 description: "Previews renames and defers commit to resolve",
 parameters: pi.typebox.Type.Object({
  files: pi.typebox.Type.Array(pi.typebox.Type.String()),
 }),

 async execute(_toolCallId, params) {
  const previewSummary = `Prepared rename plan for ${params.files.length} files`;

  pi.pushPendingAction({
   label: `Batch rename: ${params.files.length} files`,
   sourceToolName: "batch_rename_preview",
   apply: async (reason) => {
    // apply writes here
    return {
     content: [{ type: "text", text: `Applied batch rename. Reason: ${reason}` }],
    };
   },
   reject: async (reason) => {
    // optional: cleanup or notify on discard
    return {
     content: [{ type: "text", text: `Discarded batch rename. Reason: ${reason}` }],
    };
   },
  });

  return {
   content: [{ type: "text", text: `${previewSummary}. Call resolve to apply or discard.` }],
  };
 },
});

export default factory;
```

## ความพร้อมใช้งานของรันไทม์และความล้มเหลว

`pushPendingAction` ถูกเชื่อมต่อโดย custom tool loader โดยใช้ `PendingActionStore` ของเซสชันที่ใช้งานอยู่

หากรันไทม์ไม่มี pending-action store `pushPendingAction` จะ throw ข้อผิดพลาด:

- `Pending action store unavailable for custom tools in this runtime.`

## พฤติกรรมการเลือกเครื่องมือ

เมื่อ `PendingActionStore.hasPending` เป็น true รันไทม์ของ agent จะเน้นการเลือกเครื่องมือไปที่ `resolve` เพื่อให้ preview ที่รอดำเนินการถูก finalize อย่างชัดเจนก่อนที่การทำงานของเครื่องมือปกติจะดำเนินต่อไป

## คำแนะนำสำหรับนักพัฒนา

- ใช้ pending actions เฉพาะสำหรับการดำเนินการที่ทำลายข้อมูลหรือมีผลกระทบสูงที่ควรรองรับการ apply/discard อย่างชัดเจน
- รักษา `label` ให้กระชับและเฉพาะเจาะจง เนื่องจากจะแสดงในผลลัพธ์ของ resolve renderer
- ตรวจสอบให้แน่ใจว่า `apply(reason)` ทำงานแบบ deterministic และ idempotent เพียงพอสำหรับการ execute ครั้งเดียว; `reason` เป็นข้อมูลเสริมและไม่ควรเปลี่ยนแปลงพฤติกรรม
- ใช้งาน `reject(reason)` เมื่อการ discard ต้องการการล้างข้อมูล (สถานะชั่วคราว, locks, การแจ้งเตือน); ละเว้นสำหรับ preview ที่ไม่มีสถานะซึ่งข้อความเริ่มต้นเพียงพอแล้ว
- หากเครื่องมือของคุณสามารถเตรียม preview หลายรายการได้ ให้จำไว้ว่ามีความหมายแบบ LIFO: การดำเนินการที่ push ล่าสุดจะถูก resolve ก่อน
