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

# ระบบภายในของ Resolve tool runtime

เอกสารนี้อธิบายวิธีการจำลอง workflow ของ preview/apply ใน coding-agent และวิธีที่ custom tool สามารถเข้าร่วมได้ผ่าน `pushPendingAction`

## ขอบเขตและไฟล์สำคัญ

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## สิ่งที่ `resolve` ทำ

`resolve` เป็น hidden tool ที่ทำการ finalize pending preview action

- `action: "apply"` เรียกใช้งาน `apply(reason)` บน pending action และบันทึกการเปลี่ยนแปลง
- `action: "discard"` เรียกใช้ `reject(reason)` หากมีการกำหนดไว้ มิฉะนั้นจะยกเลิก action พร้อมข้อความเริ่มต้น "Discarded"

หากไม่มี pending action อยู่ `resolve` จะล้มเหลวพร้อมข้อความ:

- `No pending action to resolve. Nothing to apply or discard.`

## Pending action เป็น stack (LIFO)

Pending action ถูกจัดเก็บใน `PendingActionStore` ในรูปแบบ push/pop stack:

- `push(action)` เพิ่ม pending action ใหม่ไว้ด้านบน
- `peek()` ตรวจสอบ action ที่อยู่บนสุดปัจจุบัน
- `pop()` ลบและส่งคืน action ที่อยู่บนสุด
- `hasPending` ระบุว่า stack ไม่ว่างเปล่าหรือไม่

`resolve` จะใช้ pending action ที่อยู่ **บนสุด** เสมอก่อน (`pop()`) ดังนั้น tool ที่สร้าง preview หลายตัวจะถูก resolve ในลำดับย้อนกลับจากการลงทะเบียน

## ตัวอย่าง built-in producer (`ast_edit`)

`ast_edit` จะแสดง preview ของ structural replacement ก่อน เมื่อ preview มี replacement และยังไม่ได้ apply จะ push pending action ที่ประกอบด้วย:

- label (สรุปที่มนุษย์อ่านได้)
- `sourceToolName` (`ast_edit`)
- callback `apply(reason: string)` ที่รัน AST edit อีกครั้งด้วย `dryRun: false`

`resolve(action="apply", reason="...")` ส่ง `reason` เข้าไปใน callback นี้

## Custom tool: `pushPendingAction`

Custom tool สามารถลงทะเบียน pending action ที่เข้ากันได้กับ resolve ผ่าน `CustomToolAPI.pushPendingAction(...)`

`CustomToolPendingAction`:

- `label: string` (จำเป็น)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (จำเป็น) — ถูกเรียกใช้เมื่อ apply; `reason` คือ string ที่ส่งไปยัง `resolve`
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (ไม่บังคับ) — ถูกเรียกใช้เมื่อ discard; ค่าที่ส่งคืนจะแทนที่ข้อความเริ่มต้น "Discarded" หากมีการกำหนดไว้
- `details?: unknown` (ไม่บังคับ)
- `sourceToolName?: string` (ไม่บังคับ ค่าเริ่มต้นคือ `"custom_tool"`)

### ตัวอย่างการใช้งานเบื้องต้น

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

## ความพร้อมใช้งานของ runtime และความล้มเหลว

`pushPendingAction` ถูกเชื่อมต่อโดย custom tool loader โดยใช้ `PendingActionStore` ของ session ที่ active อยู่

หาก runtime ไม่มี pending-action store `pushPendingAction` จะ throw:

- `Pending action store unavailable for custom tools in this runtime.`

## พฤติกรรมของ tool-choice

เมื่อ `PendingActionStore.hasPending` เป็น true agent runtime จะโน้มเอียง tool choice ไปที่ `resolve` เพื่อให้ pending preview ถูก finalize อย่างชัดเจนก่อนที่ tool flow ปกติจะดำเนินต่อ

## คำแนะนำสำหรับนักพัฒนา

- ใช้ pending action เฉพาะสำหรับการดำเนินการที่เป็นอันตรายหรือมีผลกระทบสูงที่ควรรองรับการ apply/discard อย่างชัดเจน
- ทำให้ `label` กระชับและเฉพาะเจาะจง เนื่องจากจะแสดงใน output ของ resolve renderer
- ตรวจสอบให้แน่ใจว่า `apply(reason)` เป็น deterministic และ idempotent เพียงพอสำหรับการเรียกใช้งานครั้งเดียว `reason` เป็นข้อมูลเชิงอธิบายและไม่ควรเปลี่ยนพฤติกรรม
- ใช้ `reject(reason)` เมื่อการ discard ต้องมีการ cleanup (สถานะชั่วคราว, lock, การแจ้งเตือน) ละเว้นได้สำหรับ preview แบบ stateless ที่ข้อความเริ่มต้นเพียงพอ
- หาก tool ของคุณสามารถจัดเตรียม preview หลายรายการ โปรดจำไว้ว่า LIFO semantics: action ที่ถูก push ล่าสุดจะถูก resolve ก่อน
