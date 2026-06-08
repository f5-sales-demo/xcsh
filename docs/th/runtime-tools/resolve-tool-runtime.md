---
title: Resolve Tool Runtime Internals
description: >-
  Resolve tool runtime for file path resolution, content fetching, and URL-based
  resource access.
sidebar:
  order: 3
  label: Resolve tool
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# ภายในของ Resolve tool runtime

เอกสารนี้อธิบายวิธีการจำลองเวิร์กโฟลว์ preview/apply ใน coding-agent และวิธีที่เครื่องมือแบบกำหนดเองสามารถเข้าร่วมผ่าน `pushPendingAction`

## ขอบเขตและไฟล์สำคัญ

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## สิ่งที่ `resolve` ทำ

`resolve` เป็นเครื่องมือที่ซ่อนอยู่ซึ่งดำเนินการ pending preview action ให้เสร็จสิ้น

- `action: "apply"` เรียกใช้ `apply(reason)` บน pending action และบันทึกการเปลี่ยนแปลง
- `action: "discard"` เรียกใช้ `reject(reason)` หากมีให้; มิฉะนั้นจะยกเลิก action พร้อมข้อความเริ่มต้น "Discarded"

หากไม่มี pending action อยู่ `resolve` จะล้มเหลวพร้อมข้อความ:

- `No pending action to resolve. Nothing to apply or discard.`

## Pending actions เป็นสแต็ก (LIFO)

Pending actions ถูกจัดเก็บใน `PendingActionStore` ในรูปแบบสแต็กแบบ push/pop:

- `push(action)` เพิ่ม pending action ใหม่ไว้ด้านบน
- `peek()` ตรวจสอบ action ที่อยู่บนสุดปัจจุบัน
- `pop()` ลบและส่งคืน action ที่อยู่บนสุด
- `hasPending` ระบุว่าสแต็กไม่ว่างเปล่าหรือไม่

`resolve` จะใช้ pending action **บนสุด**เสมอเป็นอันดับแรก (`pop()`) ดังนั้นเครื่องมือที่สร้าง preview หลายตัวจะถูก resolve ในลำดับย้อนกลับของการลงทะเบียน

## ตัวอย่าง producer ในตัว (`ast_edit`)

`ast_edit` แสดงตัวอย่างการแทนที่โครงสร้างก่อน เมื่อ preview มีการแทนที่และยังไม่ได้ apply จะ push pending action ที่ประกอบด้วย:

- label (สรุปที่มนุษย์อ่านได้)
- `sourceToolName` (`ast_edit`)
- `apply(reason: string)` callback ที่รัน AST edit อีกครั้งด้วย `dryRun: false`

`resolve(action="apply", reason="...")` ส่ง `reason` เข้าไปใน callback นี้

## เครื่องมือแบบกำหนดเอง: `pushPendingAction`

เครื่องมือแบบกำหนดเองสามารถลงทะเบียน pending actions ที่เข้ากันได้กับ resolve ผ่าน `CustomToolAPI.pushPendingAction(...)`

`CustomToolPendingAction`:

- `label: string` (จำเป็น)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (จำเป็น) — ถูกเรียกใช้เมื่อ apply; `reason` คือสตริงที่ส่งไปยัง `resolve`
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (ไม่บังคับ) — ถูกเรียกใช้เมื่อ discard; ค่าที่ส่งคืนจะแทนที่ข้อความเริ่มต้น "Discarded" หากมีให้
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

## ความพร้อมใช้งานของ Runtime และข้อผิดพลาด

`pushPendingAction` ถูกเชื่อมต่อโดย custom tool loader โดยใช้ `PendingActionStore` ของเซสชันที่ใช้งานอยู่

หาก runtime ไม่มี pending-action store `pushPendingAction` จะ throw ข้อผิดพลาด:

- `Pending action store unavailable for custom tools in this runtime.`

## พฤติกรรมการเลือกเครื่องมือ

เมื่อ `PendingActionStore.hasPending` เป็น true agent runtime จะเอนเอียงการเลือกเครื่องมือไปที่ `resolve` เพื่อให้ pending preview ถูกดำเนินการให้เสร็จสิ้นอย่างชัดเจนก่อนที่โฟลว์เครื่องมือปกติจะดำเนินต่อ

## แนวทางสำหรับนักพัฒนา

- ใช้ pending actions เฉพาะสำหรับการดำเนินการที่ทำลายข้อมูลหรือมีผลกระทบสูงที่ควรรองรับการ apply/discard อย่างชัดเจน
- ทำให้ `label` กระชับและเฉพาะเจาะจง; จะแสดงในผลลัพธ์ของ resolve renderer
- ตรวจสอบให้แน่ใจว่า `apply(reason)` เป็น deterministic และ idempotent เพียงพอสำหรับการดำเนินการครั้งเดียว; `reason` เป็นข้อมูลเพื่อการแจ้งและไม่ควรเปลี่ยนพฤติกรรม
- ใช้งาน `reject(reason)` เมื่อการ discard ต้องการทำความสะอาด (สถานะชั่วคราว, locks, การแจ้งเตือน); ละเว้นสำหรับ stateless preview ที่ข้อความเริ่มต้นเพียงพอ
- หากเครื่องมือของคุณสามารถจัดเตรียม preview หลายรายการ โปรดจำ semantics แบบ LIFO: action ที่ถูก push ล่าสุดจะถูก resolve ก่อน
