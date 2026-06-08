---
title: Extensions
description: >-
  Extension runtime overview covering types, runner lifecycle, registration, and
  discovery.
sidebar:
  order: 1
  label: ภาพรวม
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# Extensions

คู่มือหลักสำหรับการเขียน runtime extensions ใน `packages/coding-agent`

เอกสารนี้ครอบคลุม extension runtime ปัจจุบันใน:

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

สำหรับเส้นทางการค้นหาและกฎการโหลดจากระบบไฟล์ ดูที่ `docs/extension-loading.md`

## Extension คืออะไร

Extension คือ TS/JS module ที่ส่งออก default factory:

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

Extensions สามารถรวมสิ่งต่อไปนี้ทั้งหมดไว้ในโมดูลเดียว:

- event handlers (`pi.on(...)`)
- เครื่องมือที่ LLM เรียกใช้ได้ (`pi.registerTool(...)`)
- slash commands (`pi.registerCommand(...)`)
- แป้นพิมพ์ลัดและ flags
- การเรนเดอร์ข้อความแบบกำหนดเอง
- API สำหรับ session/message injection (`sendMessage`, `sendUserMessage`, `appendEntry`)

## โมเดล Runtime

1. Extensions ถูก import และ factory functions ของมันถูกเรียกใช้
2. ระหว่างขั้นตอนการโหลด วิธีการลงทะเบียนสามารถใช้ได้; วิธีการ runtime action ยังไม่ถูกเตรียมพร้อม
3. `ExtensionRunner.initialize(...)` เชื่อมต่อ live actions/contexts สำหรับ mode ที่ใช้งานอยู่
4. เหตุการณ์ session/agent/tool lifecycle ถูกส่งไปยัง handlers
5. การเรียกใช้เครื่องมือทุกครั้งถูกห่อหุ้มด้วย extension interception (`tool_call` / `tool_result`)

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

- การเรียก action methods เช่น `pi.sendMessage()` ระหว่างการโหลด extension จะเกิดข้อผิดพลาด `ExtensionRuntimeNotInitializedError`
- ลงทะเบียนก่อน; ดำเนินการ runtime behavior จาก events/commands/tools

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

## พื้นผิว Extension API

## 1) การลงทะเบียนและ actions (`ExtensionAPI`)

วิธีการหลัก:

- `on(event, handler)`
- `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`
- `registerMessageRenderer`
- `sendMessage`, `sendUserMessage`, `appendEntry`
- `getActiveTools`, `getAllTools`, `setActiveTools`
- `getSessionName`, `setSessionName`
- `setModel`, `getThinkingLevel`, `setThinkingLevel`
- `registerProvider`
- `events` (shared event bus)

ใน interactive mode handlers `input` จะทำงานก่อนการตรวจสอบ auto-title ของข้อความแรกที่มีอยู่ในระบบ Extensions ที่เรียก `await pi.setSessionName(...)` จาก `input` สามารถตั้งชื่อ session ที่ถูกบันทึกถาวรและป้องกันไม่ให้ชื่อที่สร้างอัตโนมัติเริ่มต้นทำงานสำหรับ session นั้น

สิ่งที่เปิดเผยเพิ่มเติม:

- `pi.logger`
- `pi.typebox`
- `pi.pi` (package exports)

### ความหมายของการส่งข้อความ

`pi.sendMessage(message, options)` รองรับ:

- `deliverAs: "steer"` (ค่าเริ่มต้น) — ขัดจังหวะการทำงานปัจจุบัน
- `deliverAs: "followUp"` — เข้าคิวเพื่อทำงานหลังจากการทำงานปัจจุบัน
- `deliverAs: "nextTurn"` — จัดเก็บและแทรกเมื่อมี user prompt ครั้งถัดไป
- `triggerTurn: true` — เริ่มต้น turn เมื่อว่างอยู่ (`nextTurn` จะไม่สนใจสิ่งนี้)

`pi.sendUserMessage(content, { deliverAs })` จะผ่าน prompt flow เสมอ; ขณะ streaming จะเข้าคิวเป็น steer/follow-up

## 2) Handler context (`ExtensionContext`)

Handlers และ tool `execute` จะได้รับ `ctx` ที่ประกอบด้วย:

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

## 3) Command context (`ExtensionCommandContext`)

Command handlers จะได้รับเพิ่มเติม:

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

ใช้ command context สำหรับ flows การควบคุม session; วิธีการเหล่านี้ถูกแยกออกจาก event handlers ทั่วไปโดยเจตนา

## พื้นผิวเหตุการณ์ (ชื่อและพฤติกรรมปัจจุบัน)

Event unions และ payload types แบบ canonical อยู่ใน `types.ts`

### วงจรชีวิตของ Session

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

Pre-events ที่สามารถยกเลิกได้:

- `session_before_switch` → `{ cancel?: boolean }`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`

### วงจรชีวิตของ Prompt และ Turn

- `input`
- `before_agent_start`
- `context`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`

### วงจรชีวิตของ Tool

- `tool_call` (ก่อนการเรียกใช้ สามารถบล็อกได้)
- `tool_result` (หลังการเรียกใช้ สามารถแก้ไข content/details/isError ได้)
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` (การสังเกตการณ์)

`tool_result` เป็นแบบ middleware-style: handlers ทำงานตามลำดับ extension และแต่ละตัวจะเห็นการแก้ไขก่อนหน้า

### สัญญาณความน่าเชื่อถือ/runtime

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### การดักจับคำสั่งผู้ใช้

- `user_bash` (แทนที่ด้วย `{ result }`)
- `user_python` (แทนที่ด้วย `{ result }`)

### `resources_discover`

`resources_discover` มีอยู่ใน extension types และ `ExtensionRunner`
หมายเหตุ runtime ปัจจุบัน: `ExtensionRunner.emitResourcesDiscover(...)` ถูก implement แล้ว แต่ไม่มี callsites ของ `AgentSession` ที่เรียกใช้ใน codebase ปัจจุบัน

## รายละเอียดการเขียน Tool

`registerTool` ใช้ `ToolDefinition` จาก `types.ts`

signature ปัจจุบันของ `execute`:

```ts
execute(
 toolCallId,
 params,
 signal,
 onUpdate,
 ctx,
): Promise<AgentToolResult>
```

แม่แบบ:

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

`tool_call`/`tool_result` ดักจับเครื่องมือทั้งหมดเมื่อ registry ถูกห่อหุ้มใน `sdk.ts` รวมถึงเครื่องมือในตัวและ extension/custom tools

## จุดเชื่อมต่อ UI

`ctx.ui` implement อินเทอร์เฟซ `ExtensionUIContext` การรองรับแตกต่างกันตาม mode

### Interactive mode (`extension-ui-controller.ts`)

รองรับ:

- dialogs: `select`, `confirm`, `input`, `editor`
- notifications/status/editor text/terminal input/custom overlays
- การแสดงรายการ/โหลดธีมตามชื่อ (`setTheme` รองรับชื่อเป็น string)
- tools expanded toggle

วิธีการที่เป็น no-op ในปัจจุบันใน controller นี้:

- `setFooter`
- `setHeader`
- `setEditorComponent`

หมายเหตุเพิ่มเติม: `setWidget` ปัจจุบันส่งต่อไปยังข้อความ status-line ผ่าน `setHookWidget(...)`

### RPC mode (`rpc-mode.ts`)

`ctx.ui` ทำงานผ่านเหตุการณ์ RPC `extension_ui_request`:

- วิธีการ dialog (`select`, `confirm`, `input`, `editor`) ส่งไป-กลับไปยัง client responses
- วิธีการ fire-and-forget ส่ง requests (`notify`, `setStatus`, `setWidget` สำหรับ string arrays, `setTitle`, `setEditorText`)

ไม่รองรับ/no-op ใน RPC implementation:

- `onTerminalInput`
- `custom`
- `setFooter`, `setHeader`, `setEditorComponent`
- `setWorkingMessage`
- การสลับ/โหลดธีม (`setTheme` คืนค่าความล้มเหลว)
- การควบคุมการขยาย tool ไม่ทำงาน

### เส้นทาง Print/headless/subagent

เมื่อไม่มีการส่ง UI context ไปยัง runner init, `ctx.hasUI` จะเป็น `false` และวิธีการต่าง ๆ จะเป็น no-op/คืนค่าเริ่มต้น

### Background interactive mode

Background mode ติดตั้งออบเจ็กต์ UI context แบบ non-interactive ใน implementation ปัจจุบัน `ctx.hasUI` อาจยังคงเป็น `true` ในขณะที่ interactive dialogs คืนค่าเริ่มต้น/พฤติกรรม no-op

## รูปแบบ Session และ State

สำหรับ extension state ที่คงทน:

1. บันทึกด้วย `pi.appendEntry(customType, data)`
2. สร้าง state ใหม่จาก `ctx.sessionManager.getBranch()` เมื่อ `session_start`, `session_branch`, `session_tree`
3. เก็บ `details` ของ tool result แบบมีโครงสร้างเมื่อ state ควรมองเห็นได้/สร้างใหม่ได้จากประวัติ tool result

รูปแบบการสร้างใหม่ตัวอย่าง:

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

## Custom message renderer

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // return pi-tui Component
});
```

ใช้โดยการเรนเดอร์แบบ interactive เมื่อแสดงข้อความแบบกำหนดเอง

## Tool call/result renderer

ระบุ `renderCall` / `renderResult` ในนิยาม `registerTool` สำหรับการแสดงผลเครื่องมือแบบกำหนดเองใน TUI

## ข้อจำกัดและข้อผิดพลาดที่พบบ่อย

- Runtime actions ไม่สามารถใช้งานได้ระหว่างการโหลด extension
- ข้อผิดพลาดของ `tool_call` จะบล็อกการเรียกใช้ (fail-closed)
- ชื่อ command ที่ซ้ำกับที่มีอยู่ในตัวจะถูกข้ามพร้อมข้อมูลวินิจฉัย
- แป้นพิมพ์ลัดที่สงวนไว้จะถูกเพิกเฉย (`ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`)
- ถือว่า `ctx.reload()` เป็นจุดสิ้นสุดสำหรับ frame ของ command handler ปัจจุบัน

## Extensions vs hooks vs custom-tools

ใช้พื้นผิวที่เหมาะสม:

- **Extensions** (`src/extensibility/extensions/*`): ระบบรวม (events + tools + commands + renderers + การลงทะเบียน provider)
- **Hooks** (`src/extensibility/hooks/*`): event API แบบ legacy แยกต่างหาก
- **Custom-tools** (`src/extensibility/custom-tools/*`): โมดูลที่เน้นเครื่องมือ; เมื่อโหลดควบคู่กับ extensions จะถูกปรับแปลงและยังคงผ่าน extension interception wrappers

หากคุณต้องการแพ็คเกจเดียวที่เป็นเจ้าของ policy, tools, command UX และ rendering ร่วมกัน ให้ใช้ extensions
