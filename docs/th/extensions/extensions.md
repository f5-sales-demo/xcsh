---
title: ส่วนขยาย
description: >-
  ภาพรวมรันไทม์ส่วนขยาย ครอบคลุมประเภท วงจรชีวิตของ runner การลงทะเบียน
  และการค้นพบ
sidebar:
  order: 1
  label: ภาพรวม
i18n:
  sourceHash: 14cc16dbd98b
  translator: machine
---

# ส่วนขยาย

คู่มือหลักสำหรับการเขียนส่วนขยายรันไทม์ใน `packages/coding-agent`

เอกสารนี้ครอบคลุมรันไทม์ส่วนขยายในปัจจุบันใน:

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

สำหรับเส้นทางการค้นพบและกฎการโหลดจากระบบไฟล์ โปรดดูที่ `docs/extension-loading.md`

## ส่วนขยายคืออะไร

ส่วนขยายคือโมดูล TS/JS ที่ส่งออก factory เริ่มต้น:

```ts
import type { ExtensionAPI } from "@f5-sales-demo/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

ส่วนขยายสามารถรวมทุกสิ่งต่อไปนี้ไว้ในโมดูลเดียว:

- ตัวจัดการเหตุการณ์ (`pi.on(...)`)
- เครื่องมือที่ LLM เรียกใช้ได้ (`pi.registerTool(...)`)
- คำสั่ง slash (`pi.registerCommand(...)`)
- ทางลัดแป้นพิมพ์และแฟล็ก
- การเรนเดอร์ข้อความแบบกำหนดเอง
- API การฉีดเซสชัน/ข้อความ (`sendMessage`, `sendUserMessage`, `appendEntry`)

## โมเดลรันไทม์

1. ส่วนขยายถูกนำเข้าและฟังก์ชัน factory จะถูกรัน
2. ในช่วงการโหลดนั้น เมธอดการลงทะเบียนใช้งานได้ แต่เมธอดการดำเนินการรันไทม์ยังไม่ได้รับการเริ่มต้น
3. `ExtensionRunner.initialize(...)` เชื่อมต่อการดำเนินการ/บริบทสดสำหรับโหมดที่ใช้งานอยู่
4. เหตุการณ์วงจรชีวิตของเซสชัน/agent/เครื่องมือจะถูกส่งไปยังตัวจัดการ
5. การดำเนินการเครื่องมือทุกครั้งถูกห่อด้วยการสกัดกั้นส่วนขยาย (`tool_call` / `tool_result`)

```text
Extension lifecycle (simplified)

load paths
   │
   ▼
import module + run factory (registration only)
   │
   ▼
ExtensionRunner.initialize(mode/session/tool registry)
   │
   ├─ emit session/agent events to handlers
   ├─ wrap tool execution (tool_call/tool_result)
   └─ expose runtime actions (sendMessage, setActiveTools, ...)
```

ข้อจำกัดสำคัญจาก `loader.ts`:

- การเรียกเมธอดการดำเนินการเช่น `pi.sendMessage()` ระหว่างการโหลดส่วนขยายจะ throw `ExtensionRuntimeNotInitializedError`
- ลงทะเบียนก่อน แล้วจึงดำเนินการรันไทม์จากเหตุการณ์/คำสั่ง/เครื่องมือ

## เริ่มต้นอย่างรวดเร็ว

```ts
import type { ExtensionAPI } from "@f5-sales-demo/xcsh";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
 pi.setLabel("Safety + Utilities");

 pi.on("session_start", async (_event, ctx) => {
  ctx.ui.notify(`Extension loaded in ${ctx.cwd}`, "info");
 });

 pi.on("tool_call", async (event) => {
  if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
   return { block: true, reason: "Blocked by extension policy" };
  }
 });

 pi.registerTool({
  name: "hello_extension",
  label: "Hello Extension",
  description: "Return a greeting",
  parameters: Type.Object({ name: Type.String() }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
   return {
    content: [{ type: "text", text: `Hello, ${params.name}` }],
    details: { greeted: params.name },
   };
  },
 });

 pi.registerCommand("hello-ext", {
  description: "Show queue state",
  handler: async (_args, ctx) => {
   ctx.ui.notify(`pending=${ctx.hasPendingMessages()}`, "info");
  },
 });
}
```

## พื้นผิว API ของส่วนขยาย

## 1) การลงทะเบียนและการดำเนินการ (`ExtensionAPI`)

เมธอดหลัก:

- `on(event, handler)`
- `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`
- `registerMessageRenderer`
- `sendMessage`, `sendUserMessage`, `appendEntry`
- `getActiveTools`, `getAllTools`, `setActiveTools`
- `getSessionName`, `setSessionName`
- `setModel`, `getThinkingLevel`, `setThinkingLevel`
- `registerProvider`
- `events` (บัสเหตุการณ์ที่ใช้ร่วมกัน)

ในโหมดโต้ตอบ ตัวจัดการ `input` จะทำงานก่อนการตรวจสอบชื่ออัตโนมัติสำหรับข้อความแรกในตัวเอง ส่วนขยายที่เรียก `await pi.setSessionName(...)` จาก `input` สามารถตั้งชื่อเซสชันที่บันทึกไว้และป้องกันไม่ให้ชื่อที่สร้างอัตโนมัติโดยค่าเริ่มต้นทำงานสำหรับเซสชันนั้น

นอกจากนี้ยังเปิดเผย:

- `pi.logger`
- `pi.typebox`
- `pi.pi` (การส่งออกแพ็กเกจ)

### ความหมายของการส่งข้อความ

`pi.sendMessage(message, options)` รองรับ:

- `deliverAs: "steer"` (ค่าเริ่มต้น) — ขัดจังหวะการรันปัจจุบัน
- `deliverAs: "followUp"` — จัดคิวเพื่อรันหลังการรันปัจจุบัน
- `deliverAs: "nextTurn"` — จัดเก็บและฉีดในเทิร์นถัดไปที่ผู้ใช้ป้อน
- `triggerTurn: true` — เริ่มเทิร์นเมื่อไม่มีการทำงาน (`nextTurn` จะไม่สนใจสิ่งนี้)

`pi.sendUserMessage(content, { deliverAs })` จะผ่านขั้นตอนพร้อมต์เสมอ ขณะสตรีมมิ่งจะจัดคิวเป็น steer/follow-up

## 2) บริบทตัวจัดการ (`ExtensionContext`)

ตัวจัดการและ `execute` ของเครื่องมือจะได้รับ `ctx` พร้อม:

- `ui`
- `hasUI`
- `cwd`
- `sessionManager` (อ่านอย่างเดียว)
- `modelRegistry`, `model`
- `getContextUsage()`
- `compact(...)`
- `isIdle()`, `hasPendingMessages()`, `abort()`
- `shutdown()`
- `getSystemPrompt()`

## 3) บริบทคำสั่ง (`ExtensionCommandContext`)

ตัวจัดการคำสั่งได้รับเพิ่มเติม:

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

ใช้บริบทคำสั่งสำหรับการไหลควบคุมเซสชัน เมธอดเหล่านี้ถูกแยกออกจากตัวจัดการเหตุการณ์ทั่วไปโดยตั้งใจ

## พื้นผิวเหตุการณ์ (ชื่อและพฤติกรรมในปัจจุบัน)

union เหตุการณ์ canonical และประเภทเพย์โหลดอยู่ใน `types.ts`

### วงจรชีวิตเซสชัน

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

เหตุการณ์ก่อนที่ยกเลิกได้:

- `session_before_switch` → `{ cancel?: boolean }`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`

### วงจรชีวิตพร้อมต์และเทิร์น

- `input`
- `before_agent_start`
- `context`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`

### วงจรชีวิตเครื่องมือ

- `tool_call` (ก่อนดำเนินการ อาจบล็อก)
- `tool_result` (หลังดำเนินการ อาจแก้ไขเนื้อหา/รายละเอียด/isError)
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` (การสังเกตการณ์)

`tool_result` เป็นแบบ middleware: ตัวจัดการทำงานตามลำดับส่วนขยายและแต่ละตัวจะเห็นการแก้ไขก่อนหน้า

### สัญญาณความน่าเชื่อถือ/รันไทม์

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### การสกัดกั้นคำสั่งผู้ใช้

- `user_bash` (แทนที่ด้วย `{ result }`)
- `user_python` (แทนที่ด้วย `{ result }`)

### `resources_discover`

`resources_discover` มีอยู่ในประเภทส่วนขยายและ `ExtensionRunner`
หมายเหตุรันไทม์ปัจจุบัน: `ExtensionRunner.emitResourcesDiscover(...)` ได้รับการนำไปใช้งานแล้ว แต่ไม่มี callsite ของ `AgentSession` ที่เรียกใช้ในโค้ดเบสปัจจุบัน

## รายละเอียดการเขียนเครื่องมือ

`registerTool` ใช้ `ToolDefinition` จาก `types.ts`

ลายเซ็น `execute` ปัจจุบัน:

```ts
execute(
 toolCallId,
 params,
 signal,
 onUpdate,
 ctx,
): Promise<AgentToolResult>
```

เทมเพลต:

```ts
pi.registerTool({
 name: "my_tool",
 label: "My Tool",
 description: "...",
 parameters: Type.Object({}),
 async execute(_id, _params, signal, onUpdate, ctx) {
  if (signal?.aborted) {
   return { content: [{ type: "text", text: "Cancelled" }] };
  }
  onUpdate?.({ content: [{ type: "text", text: "Working..." }] });
  return { content: [{ type: "text", text: "Done" }], details: {} };
 },
 onSession(event, ctx) {
  // reason: start|switch|branch|tree|shutdown
 },
 renderCall(args, theme) {
  // optional TUI render
 },
 renderResult(result, options, theme, args) {
  // optional TUI render
 },
});
```

`tool_call`/`tool_result` สกัดกั้นเครื่องมือทั้งหมดเมื่อ registry ถูกห่อใน `sdk.ts` รวมถึงเครื่องมือในตัวและเครื่องมือส่วนขยาย/กำหนดเอง

## จุดรวมการทำงานกับ UI

`ctx.ui` ใช้งาน interface `ExtensionUIContext` การรองรับแตกต่างกันตามโหมด

### โหมดโต้ตอบ (`extension-ui-controller.ts`)

รองรับ:

- dialog: `select`, `confirm`, `input`, `editor`
- การแจ้งเตือน/สถานะ/ข้อความในตัวแก้ไข/การป้อนข้อมูลเทอร์มินัล/overlay แบบกำหนดเอง
- การแสดงรายการ/โหลดธีมตามชื่อ (`setTheme` รองรับชื่อสตริง)
- การสลับการขยายเครื่องมือ

เมธอดที่ไม่ทำงานปัจจุบันใน controller นี้:

- `setFooter`
- `setHeader`
- `setEditorComponent`

หมายเหตุเพิ่มเติม: `setWidget` ในปัจจุบันจะส่งต่อไปยังข้อความบรรทัดสถานะผ่าน `setHookWidget(...)`

### โหมด RPC (`rpc-mode.ts`)

`ctx.ui` ได้รับการสนับสนุนโดยเหตุการณ์ RPC `extension_ui_request`:

- เมธอด dialog (`select`, `confirm`, `input`, `editor`) จะรอบทริปไปยังการตอบสนองของไคลเอนต์
- เมธอดแบบ fire-and-forget จะส่งออกคำขอ (`notify`, `setStatus`, `setWidget` สำหรับอาร์เรย์สตริง, `setTitle`, `setEditorText`)

ไม่รองรับ/ไม่ทำงานใน RPC implementation:

- `onTerminalInput`
- `custom`
- `setFooter`, `setHeader`, `setEditorComponent`
- `setWorkingMessage`
- การสลับ/โหลดธีม (`setTheme` จะคืนค่าความล้มเหลว)
- การควบคุมการขยายเครื่องมือไม่มีผล

### เส้นทาง Print/headless/subagent

เมื่อไม่มีบริบท UI ที่ส่งไปยังการเริ่มต้น runner `ctx.hasUI` จะเป็น `false` และเมธอดจะไม่ทำงาน/คืนค่าเริ่มต้น

### โหมดโต้ตอบเบื้องหลัง

โหมดเบื้องหลังจะติดตั้งออบเจ็กต์บริบท UI แบบไม่โต้ตอบ ใน implementation ปัจจุบัน `ctx.hasUI` อาจยังคงเป็น `true` ในขณะที่ dialog โต้ตอบจะคืนค่าเริ่มต้น/ไม่ทำงาน

## รูปแบบเซสชันและสถานะ

สำหรับสถานะส่วนขยายที่ถาวร:

1. บันทึกด้วย `pi.appendEntry(customType, data)`
2. สร้างสถานะใหม่จาก `ctx.sessionManager.getBranch()` ใน `session_start`, `session_branch`, `session_tree`
3. รักษา `details` ของผลลัพธ์เครื่องมือให้มีโครงสร้างเมื่อสถานะควรมองเห็นได้/สร้างใหม่ได้จากประวัติผลลัพธ์เครื่องมือ

ตัวอย่างรูปแบบการสร้างใหม่:

```ts
pi.on("session_start", async (_event, ctx) => {
 let latest;
 for (const entry of ctx.sessionManager.getBranch()) {
  if (entry.type === "custom" && entry.customType === "my-state") {
   latest = entry.data;
  }
 }
 // restore from latest
});
```

## จุดขยายการเรนเดอร์

## ตัวเรนเดอร์ข้อความแบบกำหนดเอง

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // return pi-tui Component
});
```

ใช้โดยการเรนเดอร์โต้ตอบเมื่อแสดงข้อความแบบกำหนดเอง

## ตัวเรนเดอร์ tool call/result

ระบุ `renderCall` / `renderResult` ในคำจำกัดความ `registerTool` สำหรับการแสดงผลเครื่องมือแบบกำหนดเองใน TUI

## ข้อจำกัดและกับดัก

- การดำเนินการรันไทม์ไม่พร้อมใช้งานระหว่างการโหลดส่วนขยาย
- ข้อผิดพลาดของ `tool_call` จะบล็อกการดำเนินการ (fail-closed)
- ความขัดแย้งของชื่อคำสั่งกับคำสั่งในตัวจะถูกข้ามพร้อมการวินิจฉัย
- ทางลัดที่สงวนไว้จะถูกละเว้น (`ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`)
- ถือว่า `ctx.reload()` เป็นการสิ้นสุดสำหรับเฟรมตัวจัดการคำสั่งปัจจุบัน

## ส่วนขยาย vs hooks vs custom-tools

ใช้พื้นผิวที่เหมาะสม:

- **ส่วนขยาย** (`src/extensibility/extensions/*`): ระบบรวม (เหตุการณ์ + เครื่องมือ + คำสั่ง + ตัวเรนเดอร์ + การลงทะเบียน provider)
- **Hooks** (`src/extensibility/hooks/*`): API เหตุการณ์ legacy แยกต่างหาก
- **Custom-tools** (`src/extensibility/custom-tools/*`): โมดูลที่เน้นเครื่องมือ เมื่อโหลดควบคู่กับส่วนขยายจะถูกปรับและยังคงผ่าน wrapper การสกัดกั้นส่วนขยาย

หากคุณต้องการแพ็กเกจเดียวที่เป็นเจ้าของนโยบาย เครื่องมือ UX ของคำสั่ง และการเรนเดอร์ร่วมกัน ให้ใช้ส่วนขยาย
