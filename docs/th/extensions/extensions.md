---
title: ส่วนขยาย
description: >-
  ภาพรวมรันไทม์ของส่วนขยาย ครอบคลุมประเภท วงจรชีวิตของ runner การลงทะเบียน
  และการค้นหา
sidebar:
  order: 1
  label: ภาพรวม
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# ส่วนขยาย

คู่มือหลักสำหรับการเขียนส่วนขยายรันไทม์ใน `packages/coding-agent`

เอกสารนี้ครอบคลุมรันไทม์ของส่วนขยายปัจจุบันใน:

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

สำหรับเส้นทางการค้นหาและกฎการโหลดจากระบบไฟล์ ดู `docs/extension-loading.md`

## ส่วนขยายคืออะไร

ส่วนขยายคือโมดูล TS/JS ที่ส่งออก factory เริ่มต้น:

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

ส่วนขยายสามารถรวมสิ่งต่อไปนี้ทั้งหมดในโมดูลเดียว:

- ตัวจัดการเหตุการณ์ (`pi.on(...)`)
- เครื่องมือที่ LLM เรียกใช้ได้ (`pi.registerTool(...)`)
- คำสั่ง slash (`pi.registerCommand(...)`)
- แป้นพิมพ์ลัดและแฟล็ก
- การเรนเดอร์ข้อความแบบกำหนดเอง
- API การฉีดเซสชัน/ข้อความ (`sendMessage`, `sendUserMessage`, `appendEntry`)

## โมเดลรันไทม์

1. ส่วนขยายถูกนำเข้าและฟังก์ชัน factory ของมันถูกเรียกใช้
2. ในระหว่างขั้นตอนการโหลด เมธอดการลงทะเบียนใช้งานได้ แต่เมธอดการกระทำรันไทม์ยังไม่ถูกเริ่มต้น
3. `ExtensionRunner.initialize(...)` เชื่อมต่อการกระทำ/บริบทแบบสดสำหรับโหมดที่ใช้งานอยู่
4. เหตุการณ์วงจรชีวิตของเซสชัน/เอเจนต์/เครื่องมือถูกส่งไปยังตัวจัดการ
5. การเรียกใช้เครื่องมือทุกครั้งถูกครอบด้วยการสกัดกั้นของส่วนขยาย (`tool_call` / `tool_result`)

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

- การเรียกเมธอดการกระทำเช่น `pi.sendMessage()` ระหว่างการโหลดส่วนขยายจะโยน `ExtensionRuntimeNotInitializedError`
- ลงทะเบียนก่อน; ดำเนินพฤติกรรมรันไทม์จากเหตุการณ์/คำสั่ง/เครื่องมือ

## เริ่มต้นอย่างรวดเร็ว

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";
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

## 1) การลงทะเบียนและการกระทำ (`ExtensionAPI`)

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

ในโหมดโต้ตอบ ตัวจัดการ `input` ทำงานก่อนการตรวจสอบการตั้งชื่ออัตโนมัติของข้อความแรกในตัว ส่วนขยายที่เรียก `await pi.setSessionName(...)` จาก `input` สามารถตั้งชื่อเซสชันที่บันทึกถาวรและป้องกันไม่ให้ชื่อที่สร้างอัตโนมัติเริ่มต้นทำงานสำหรับเซสชันนั้น

สิ่งที่เปิดเผยเพิ่มเติม:

- `pi.logger`
- `pi.typebox`
- `pi.pi` (ส่งออกของแพ็กเกจ)

### ความหมายการส่งข้อความ

`pi.sendMessage(message, options)` รองรับ:

- `deliverAs: "steer"` (ค่าเริ่มต้น) — ขัดจังหวะการทำงานปัจจุบัน
- `deliverAs: "followUp"` — จัดคิวให้ทำงานหลังจากการทำงานปัจจุบัน
- `deliverAs: "nextTurn"` — จัดเก็บและฉีดเข้าเมื่อมีพรอมต์ของผู้ใช้ครั้งถัดไป
- `triggerTurn: true` — เริ่มเทิร์นเมื่อว่าง (`nextTurn` จะไม่สนใจสิ่งนี้)

`pi.sendUserMessage(content, { deliverAs })` จะผ่านโฟลว์พรอมต์เสมอ; ขณะสตรีมมิ่งจะจัดคิวเป็น steer/follow-up

## 2) บริบทตัวจัดการ (`ExtensionContext`)

ตัวจัดการและ `execute` ของเครื่องมือจะได้รับ `ctx` ที่มี:

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

ตัวจัดการคำสั่งจะได้รับเพิ่มเติม:

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

ใช้บริบทคำสั่งสำหรับโฟลว์การควบคุมเซสชัน; เมธอดเหล่านี้ถูกแยกออกจากตัวจัดการเหตุการณ์ทั่วไปโดยตั้งใจ

## พื้นผิวเหตุการณ์ (ชื่อและพฤติกรรมปัจจุบัน)

ยูเนียนของเหตุการณ์ตามมาตรฐานและประเภทข้อมูลอยู่ใน `types.ts`

### วงจรชีวิตเซสชัน

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

เหตุการณ์ก่อนหน้าที่ยกเลิกได้:

- `session_before_switch` → `{ cancel?: boolean }`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`

### วงจรชีวิตพรอมต์และเทิร์น

- `input`
- `before_agent_start`
- `context`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`

### วงจรชีวิตเครื่องมือ

- `tool_call` (ก่อนการเรียกใช้ สามารถบล็อกได้)
- `tool_result` (หลังการเรียกใช้ สามารถแก้ไข content/details/isError ได้)
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` (การสังเกตการณ์)

`tool_result` เป็นแบบ middleware: ตัวจัดการทำงานตามลำดับส่วนขยายและแต่ละตัวเห็นการแก้ไขก่อนหน้า

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
หมายเหตุรันไทม์ปัจจุบัน: `ExtensionRunner.emitResourcesDiscover(...)` ถูกนำไปใช้แล้ว แต่ไม่มี callsite ของ `AgentSession` ที่เรียกใช้ในโค้ดเบสปัจจุบัน

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

`tool_call`/`tool_result` สกัดกั้นเครื่องมือทั้งหมดเมื่อรีจิสทรีถูกครอบใน `sdk.ts` รวมถึงเครื่องมือในตัวและเครื่องมือส่วนขยาย/กำหนดเอง

## จุดเชื่อมต่อ UI

`ctx.ui` ใช้งานอินเทอร์เฟซ `ExtensionUIContext` การรองรับแตกต่างกันตามโหมด

### โหมดโต้ตอบ (`extension-ui-controller.ts`)

รองรับ:

- ไดอะล็อก: `select`, `confirm`, `input`, `editor`
- การแจ้งเตือน/สถานะ/ข้อความตัวแก้ไข/อินพุตเทอร์มินัล/โอเวอร์เลย์กำหนดเอง
- การแสดงรายการธีม/การโหลดตามชื่อ (`setTheme` รองรับชื่อแบบสตริง)
- การสลับการขยายเครื่องมือ

เมธอดที่ไม่ทำอะไรในคอนโทรลเลอร์นี้ปัจจุบัน:

- `setFooter`
- `setHeader`
- `setEditorComponent`

หมายเหตุเพิ่มเติม: `setWidget` ปัจจุบันส่งต่อไปยังข้อความบรรทัดสถานะผ่าน `setHookWidget(...)`

### โหมด RPC (`rpc-mode.ts`)

`ctx.ui` สำรองด้วยเหตุการณ์ RPC `extension_ui_request`:

- เมธอดไดอะล็อก (`select`, `confirm`, `input`, `editor`) ส่งกลับไปมาถึงการตอบสนองของไคลเอนต์
- เมธอดแบบยิงแล้วลืมส่งคำขอ (`notify`, `setStatus`, `setWidget` สำหรับอาร์เรย์สตริง, `setTitle`, `setEditorText`)

ไม่รองรับ/ไม่ทำอะไรในการใช้งาน RPC:

- `onTerminalInput`
- `custom`
- `setFooter`, `setHeader`, `setEditorComponent`
- `setWorkingMessage`
- การสลับ/โหลดธีม (`setTheme` คืนค่าล้มเหลว)
- ตัวควบคุมการขยายเครื่องมือไม่ทำงาน

### เส้นทาง Print/headless/subagent

เมื่อไม่มีบริบท UI ถูกจัดเตรียมให้กับการเริ่มต้น runner, `ctx.hasUI` จะเป็น `false` และเมธอดจะเป็น no-op/คืนค่าเริ่มต้น

### โหมดโต้ตอบเบื้องหลัง

โหมดเบื้องหลังติดตั้งออบเจ็กต์บริบท UI แบบไม่โต้ตอบ ในการใช้งานปัจจุบัน `ctx.hasUI` อาจยังเป็น `true` ในขณะที่ไดอะล็อกโต้ตอบคืนค่าเริ่มต้น/พฤติกรรม no-op

## รูปแบบเซสชันและสถานะ

สำหรับสถานะส่วนขยายที่คงทน:

1. บันทึกถาวรด้วย `pi.appendEntry(customType, data)`
2. สร้างสถานะใหม่จาก `ctx.sessionManager.getBranch()` เมื่อ `session_start`, `session_branch`, `session_tree`
3. ให้ `details` ของผลลัพธ์เครื่องมือเป็นโครงสร้างเมื่อสถานะควรมองเห็นได้/สร้างใหม่ได้จากประวัติผลลัพธ์เครื่องมือ

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

## ตัวเรนเดอร์ข้อความกำหนดเอง

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // return pi-tui Component
});
```

ใช้โดยการเรนเดอร์โต้ตอบเมื่อข้อความกำหนดเองถูกแสดง

## ตัวเรนเดอร์การเรียกเครื่องมือ/ผลลัพธ์

จัดเตรียม `renderCall` / `renderResult` ในนิยาม `registerTool` สำหรับการแสดงผลเครื่องมือกำหนดเองใน TUI

## ข้อจำกัดและข้อผิดพลาดที่พบบ่อย

- การกระทำรันไทม์ไม่พร้อมใช้งานระหว่างการโหลดส่วนขยาย
- ข้อผิดพลาด `tool_call` บล็อกการเรียกใช้ (fail-closed)
- ความขัดแย้งของชื่อคำสั่งกับคำสั่งในตัวจะถูกข้ามพร้อมการวินิจฉัย
- แป้นพิมพ์ลัดที่สงวนไว้จะถูกเพิกเฉย (`ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`)
- ถือว่า `ctx.reload()` เป็นจุดสิ้นสุดสำหรับเฟรมตัวจัดการคำสั่งปัจจุบัน

## ส่วนขยาย vs hooks vs custom-tools

ใช้พื้นผิวที่เหมาะสม:

- **ส่วนขยาย** (`src/extensibility/extensions/*`): ระบบรวม (เหตุการณ์ + เครื่องมือ + คำสั่ง + ตัวเรนเดอร์ + การลงทะเบียนผู้ให้บริการ)
- **Hooks** (`src/extensibility/hooks/*`): API เหตุการณ์แบบเดิมที่แยกต่างหาก
- **Custom-tools** (`src/extensibility/custom-tools/*`): โมดูลที่เน้นเครื่องมือ; เมื่อโหลดควบคู่กับส่วนขยายจะถูกปรับตัวและยังคงผ่าน wrapper การสกัดกั้นของส่วนขยาย

หากคุณต้องการแพ็กเกจเดียวที่เป็นเจ้าของนโยบาย เครื่องมือ UX ของคำสั่ง และการเรนเดอร์ร่วมกัน ให้ใช้ส่วนขยาย
