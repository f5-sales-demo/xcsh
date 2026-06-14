---
title: ส่วนภายในรันไทม์ของเครื่องมือ Resolve
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

# ส่วนภายในรันไทม์ของเครื่องมือ Resolve

เอกสารนี้อธิบายวิธีการจำลองเวิร์กโฟลว์ preview/apply ใน coding-agent และวิธีที่เครื่องมือแบบกำหนดเองสามารถเข้าร่วมได้ผ่าน `pushPendingAction`

## ขอบเขตและไฟล์สำคัญ

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## สิ่งที่ `resolve` ทำ

`resolve` คือเครื่องมือที่ซ่อนอยู่ซึ่งทำหน้าที่ทำให้ pending preview action สำเร็จสมบูรณ์

- `action: "apply"` ดำเนินการ `apply(reason)` บน pending action และบันทึกการเปลี่ยนแปลง
- `action: "discard"` เรียกใช้ `reject(reason)` หากมีการระบุไว้ มิฉะนั้นจะลบ action ทิ้งพร้อมข้อความ "Discarded" เป็นค่าเริ่มต้น

หากไม่มี pending action อยู่ `resolve` จะล้มเหลวพร้อมข้อความ:

- `No pending action to resolve. Nothing to apply or discard.`

## Pending actions คือ stack (LIFO)

Pending actions ถูกเก็บไว้ใน `PendingActionStore` ในรูปแบบ push/pop stack:

- `push(action)` เพิ่ม pending action ใหม่ไว้ที่ด้านบนสุด
- `peek()` ตรวจสอบ action ที่อยู่ด้านบนสุดในปัจจุบัน
- `pop()` ลบและคืนค่า action ที่อยู่ด้านบนสุด
- `hasPending` ระบุว่า stack มีข้อมูลอยู่หรือไม่

`resolve` จะใช้ pending action ที่อยู่ **บนสุด** เสมอก่อน (`pop()`) ดังนั้นเครื่องมือที่ผลิต preview หลายรายการจะถูก resolve ในลำดับย้อนกลับของการลงทะเบียน

## ตัวอย่าง built-in producer (`ast_edit`)

`ast_edit` แสดง preview การแทนที่โครงสร้างก่อน เมื่อ preview มีการแทนที่และยังไม่ได้รับการ apply จะมีการ push pending action ที่ประกอบด้วย:

- label (สรุปที่มนุษย์อ่านได้)
- `sourceToolName` (`ast_edit`)
- callback `apply(reason: string)` ที่รัน AST edit ใหม่อีกครั้งด้วย `dryRun: false`

`resolve(action="apply", reason="...")` ส่งผ่าน `reason` เข้าสู่ callback นี้

## เครื่องมือแบบกำหนดเอง: `pushPendingAction`

เครื่องมือแบบกำหนดเองสามารถลงทะเบียน pending actions ที่รองรับ resolve ได้ผ่าน `CustomToolAPI.pushPendingAction(...)`

`CustomToolPendingAction`:

- `label: string` (จำเป็น)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (จำเป็น) — ถูกเรียกใช้เมื่อ apply; `reason` คือ string ที่ส่งไปยัง `resolve`
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (ไม่บังคับ) — ถูกเรียกใช้เมื่อ discard; ค่าที่คืนมาจะแทนที่ข้อความ "Discarded" เริ่มต้นหากมีการระบุ
- `details?: unknown` (ไม่บังคับ)
- `sourceToolName?: string` (ไม่บังคับ ค่าเริ่มต้นคือ `"custom_tool"`)

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

## ความพร้อมใช้งานรันไทม์และความล้มเหลว

`pushPendingAction` ถูกเชื่อมต่อโดย custom tool loader โดยใช้ `PendingActionStore` ของ session ที่ใช้งานอยู่

หากรันไทม์ไม่มี pending-action store `pushPendingAction` จะโยนข้อผิดพลาด:

- `Pending action store unavailable for custom tools in this runtime.`

## พฤติกรรมการเลือกเครื่องมือ

เมื่อ `PendingActionStore.hasPending` เป็น true รันไทม์ของ agent จะให้ความสำคัญกับการเลือกเครื่องมือ `resolve` เพื่อให้ pending previews ได้รับการทำให้สมบูรณ์อย่างชัดเจนก่อนที่กระบวนการใช้งานเครื่องมือปกติจะดำเนินต่อไป

## คำแนะนำสำหรับนักพัฒนา

- ใช้ pending actions เฉพาะสำหรับการดำเนินการที่ทำลายข้อมูลหรือมีผลกระทบสูงที่ควรรองรับการ apply/discard อย่างชัดเจน
- ทำให้ `label` กระชับและเฉพาะเจาะจง เนื่องจากจะแสดงใน resolve renderer output
- ตรวจสอบให้แน่ใจว่า `apply(reason)` มีความแน่นอนและมีความเป็น idempotent เพียงพอสำหรับการดำเนินการครั้งเดียว `reason` เป็นข้อมูลเพื่อให้ข้อมูลและไม่ควรเปลี่ยนแปลงพฤติกรรม
- ใช้งาน `reject(reason)` เมื่อการ discard ต้องการการล้างข้อมูล (สถานะชั่วคราว, locks, การแจ้งเตือน) และละเว้นสำหรับ previews ที่ไม่มีสถานะซึ่งข้อความเริ่มต้นเพียงพอแล้ว
- หากเครื่องมือของคุณสามารถจัด stage previews หลายรายการได้ ให้จำไว้ว่า semantics แบบ LIFO: action ที่ push ล่าสุดจะ resolve ก่อน
