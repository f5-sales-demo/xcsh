---
title: Resolve Tool Runtime Internals
description: >-
  รันไทม์ของเครื่องมือ Resolve สำหรับการแก้ไขเส้นทางไฟล์ การดึงเนื้อหา
  และการเข้าถึงทรัพยากรผ่าน URL
sidebar:
  order: 3
  label: เครื่องมือ Resolve
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# Resolve tool runtime internals

เอกสารนี้อธิบายวิธีการจำลองเวิร์กโฟลว์ preview/apply ใน coding-agent และวิธีที่เครื่องมือแบบกำหนดเองสามารถมีส่วนร่วมผ่าน `pushPendingAction`

## ขอบเขตและไฟล์สำคัญ

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## `resolve` ทำอะไร

`resolve` เป็นเครื่องมือที่ซ่อนอยู่ซึ่งทำการสรุปผลการดำเนินการ pending preview

- `action: "apply"` จะเรียกใช้ `apply(reason)` บน pending action และบันทึกการเปลี่ยนแปลง
- `action: "discard"` จะเรียกใช้ `reject(reason)` หากมีการระบุ มิฉะนั้นจะยกเลิก action พร้อมข้อความเริ่มต้น "Discarded"

หากไม่มี pending action อยู่ `resolve` จะล้มเหลวพร้อมข้อความ:

- `No pending action to resolve. Nothing to apply or discard.`

## Pending actions เป็นสแต็ก (LIFO)

Pending actions ถูกเก็บไว้ใน `PendingActionStore` ในรูปแบบสแต็ก push/pop:

- `push(action)` เพิ่ม pending action ใหม่ไว้ด้านบนสุด
- `peek()` ตรวจดู action ที่อยู่บนสุดในปัจจุบัน
- `pop()` ลบและส่งคืน action ที่อยู่บนสุด
- `hasPending` ระบุว่าสแต็กไม่ว่างหรือไม่

`resolve` จะประมวลผล pending action **บนสุด**เสมอก่อน (`pop()`) ดังนั้นเครื่องมือที่สร้าง preview หลายรายการจะถูก resolve ในลำดับย้อนกลับจากการลงทะเบียน

## ตัวอย่าง producer ในตัว (`ast_edit`)

`ast_edit` จะแสดงตัวอย่างการแทนที่โครงสร้างก่อน เมื่อตัวอย่างมีการแทนที่และยังไม่ได้ apply จะ push pending action ที่ประกอบด้วย:

- label (สรุปที่อ่านเข้าใจง่าย)
- `sourceToolName` (`ast_edit`)
- `apply(reason: string)` callback ที่รัน AST edit อีกครั้งด้วย `dryRun: false`

`resolve(action="apply", reason="...")` จะส่ง `reason` เข้าไปใน callback นี้

## เครื่องมือแบบกำหนดเอง: `pushPendingAction`

เครื่องมือแบบกำหนดเองสามารถลงทะเบียน pending actions ที่เข้ากันได้กับ resolve ผ่าน `CustomToolAPI.pushPendingAction(...)`

`CustomToolPendingAction`:

- `label: string` (จำเป็น)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (จำเป็น) — ถูกเรียกเมื่อ apply; `reason` คือสตริงที่ส่งไปยัง `resolve`
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (ไม่บังคับ) — ถูกเรียกเมื่อ discard; ค่าที่ส่งคืนจะแทนที่ข้อความเริ่มต้น "Discarded" หากมีการระบุ
- `details?: unknown` (ไม่บังคับ)
- `sourceToolName?: string` (ไม่บังคับ, ค่าเริ่มต้นคือ `"custom_tool"`)

### ตัวอย่างการใช้งานขั้นต่ำ

```ts
import type { CustomToolFactory } from "@f5xc-salesdemos/xcsh";

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

## ความพร้อมใช้งานของรันไทม์และข้อผิดพลาด

`pushPendingAction` ถูกเชื่อมต่อโดย custom tool loader โดยใช้ `PendingActionStore` ของเซสชันที่กำลังทำงานอยู่

หากรันไทม์ไม่มี pending-action store `pushPendingAction` จะ throw ข้อผิดพลาด:

- `Pending action store unavailable for custom tools in this runtime.`

## พฤติกรรม tool-choice

เมื่อ `PendingActionStore.hasPending` เป็น true รันไทม์ของ agent จะให้น้ำหนักการเลือกเครื่องมือไปที่ `resolve` เพื่อให้ pending previews ถูกสรุปผลอย่างชัดเจนก่อนที่จะดำเนินการ tool flow ตามปกติต่อไป

## แนวทางสำหรับนักพัฒนา

- ใช้ pending actions เฉพาะสำหรับการดำเนินการที่เป็นการทำลายข้อมูลหรือมีผลกระทบสูงที่ควรรองรับการ apply/discard อย่างชัดเจน
- ทำให้ `label` กระชับและเฉพาะเจาะจง เนื่องจากจะแสดงในผลลัพธ์ของ resolve renderer
- ตรวจสอบให้แน่ใจว่า `apply(reason)` เป็น deterministic และ idempotent เพียงพอสำหรับการเรียกใช้ครั้งเดียว; `reason` เป็นข้อมูลเพื่อแจ้งเท่านั้นและไม่ควรเปลี่ยนแปลงพฤติกรรม
- ใช้งาน `reject(reason)` เมื่อการ discard ต้องการการล้างข้อมูล (สถานะชั่วคราว, ล็อก, การแจ้งเตือน); ข้ามได้สำหรับ previews ที่ไม่มีสถานะซึ่งข้อความเริ่มต้นเพียงพอ
- หากเครื่องมือของคุณสามารถจัดเตรียม previews หลายรายการ โปรดจำหลักการ LIFO: action ที่ push ล่าสุดจะถูก resolve ก่อน
