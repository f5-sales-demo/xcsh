---
title: Hooks
description: >-
  ระบบ Hook สำหรับการทำงานอัตโนมัติแบบ pre/post event ในวงจรชีวิตของ coding
  agent
sidebar:
  order: 4
  label: Hooks
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# Hooks

เอกสารนี้อธิบาย **โค้ดระบบย่อย hook ปัจจุบัน** ใน `src/extensibility/hooks/*`

## สถานะปัจจุบันในรันไทม์

แพ็กเกจ hook (`src/extensibility/hooks/`) ยังคงถูก export และสามารถใช้งานเป็น API surface ได้ แต่รันไทม์ CLI เริ่มต้นในปัจจุบันจะเริ่มต้นผ่านเส้นทาง **extension runner** แทน ในขั้นตอนการเริ่มต้นปัจจุบัน:

- `--hook` ถูกจัดการเป็น alias ของ `--extension` (เส้นทาง CLI ถูกรวมเข้าใน `additionalExtensionPaths`)
- tools ถูกห่อหุ้มด้วย `ExtensionToolWrapper` ไม่ใช่ `HookToolWrapper`
- context transforms และ lifecycle emissions ผ่าน `ExtensionRunner`

ดังนั้นไฟล์นี้จึงเป็นเอกสารของการ implement ระบบย่อย hook เอง (types/loader/runner/wrapper) รวมถึงพฤติกรรมและข้อจำกัดแบบ legacy

## ไฟล์สำคัญ

- `src/extensibility/hooks/types.ts` — hook context, event types และ result contracts
- `src/extensibility/hooks/loader.ts` — module loading และ hook discovery bridge
- `src/extensibility/hooks/runner.ts` — event dispatch, command lookup, error signaling
- `src/extensibility/hooks/tool-wrapper.ts` — pre/post tool interception wrapper
- `src/extensibility/hooks/index.ts` — exports/re-exports

## Hook module คืออะไร

Hook module ต้อง default-export เป็น factory:

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function hook(pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && String(event.input.command ?? "").includes("rm -rf")) {
   return { block: true, reason: "blocked by policy" };
  }
 });
}
```

Factory สามารถ:

- ลงทะเบียน event handlers ด้วย `pi.on(...)`
- ส่ง custom messages แบบถาวรด้วย `pi.sendMessage(...)`
- บันทึก state ที่ไม่ใช่ LLM ด้วย `pi.appendEntry(...)`
- ลงทะเบียน slash commands ผ่าน `pi.registerCommand(...)`
- ลงทะเบียน custom message renderers ผ่าน `pi.registerMessageRenderer(...)`
- รัน shell commands ผ่าน `pi.exec(...)`

## การค้นหาและโหลด

`discoverAndLoadHooks(configuredPaths, cwd)` ทำงานดังนี้:

1. โหลด hooks ที่ค้นพบจาก capability registry (`loadCapability("hooks")`)
2. เพิ่มเส้นทางที่กำหนดค่าไว้อย่างชัดเจน (dedupe ด้วย absolute path)
3. เรียก `loadHooks(allPaths, cwd)`

`loadHooks` จากนั้น import แต่ละเส้นทางและคาดหวังฟังก์ชัน `default`

### การ resolve เส้นทาง

`loader.ts` resolve เส้นทาง hook ดังนี้:

- absolute path: ใช้ตามเดิม
- เส้นทาง `~`: ขยายออก
- relative path: resolve เทียบกับ `cwd`

### ข้อไม่สอดคล้องสำคัญแบบ legacy

Discovery providers สำหรับ `hookCapability` ยังคงจำลองไฟล์ hook แบบ pre/post shell-style (เช่น `.claude/hooks/pre/*`, `.xcsh/.../hooks/pre/*`)

Hook loader ที่นี่ใช้ dynamic module import และต้องการ default JS/TS hook factory ถ้าเส้นทาง hook ที่ค้นพบไม่สามารถ import เป็น module ได้ การโหลดจะล้มเหลวและรายงานใน `LoadHooksResult.errors`

## Event surfaces

Hook events มี strong typing ใน `types.ts`

### Session events

- `session_start`
- `session_before_switch` → สามารถส่งคืน `{ cancel?: boolean }`
- `session_switch`
- `session_before_branch` → สามารถส่งคืน `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_branch`
- `session_before_compact` → สามารถส่งคืน `{ cancel?: boolean; compaction?: CompactionResult }`
- `session.compacting` → สามารถส่งคืน `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }`
- `session_compact`
- `session_before_tree` → สามารถส่งคืน `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`
- `session_tree`
- `session_shutdown`

### Agent/context events

- `context` → สามารถส่งคืน `{ messages?: Message[] }`
- `before_agent_start` → สามารถส่งคืน `{ message?: { customType; content; display; details } }`
- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `auto_compaction_start`
- `auto_compaction_end`
- `auto_retry_start`
- `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### Tool events (โมเดล pre/post)

- `tool_call` (ก่อนการ execute) → สามารถส่งคืน `{ block?: boolean; reason?: string }`
- `tool_result` (หลังการ execute) → สามารถส่งคืน `{ content?; details?; isError? }`

นี่คือโมเดลหลัก pre/post interception ของระบบย่อย hook

```text
Hook tool interception flow

tool_call handlers
   │
   ├─ any { block: true }? ── yes ──> throw (tool blocked)
   │
   └─ no
      │
      ▼
   execute underlying tool
      │
      ├─ success ──> tool_result handlers can override { content, details }
      │
      └─ error   ──> emit tool_result(isError=true) then rethrow original error
```

## โมเดลการ execute และ mutation semantics

### 1) Pre-execution: `tool_call`

`HookToolWrapper.execute()` ปล่อย `tool_call` ก่อนการ execute tool

- ถ้า handler ใดส่งคืน `{ block: true }` การ execute จะหยุด
- ถ้า handler throw ข้อผิดพลาด wrapper จะ fail closed และบล็อกการ execute
- `reason` ที่ส่งคืนจะกลายเป็นข้อความ error ที่ throw ออกมา

### 2) Tool execution

Tool ที่อยู่ภายใต้จะ execute ตามปกติถ้าไม่ถูกบล็อก

### 3) Post-execution: `tool_result`

หลังจากสำเร็จ wrapper จะปล่อย `tool_result` พร้อมด้วย:

- `toolName`, `toolCallId`, `input`
- `content`
- `details`
- `isError: false`

ถ้า handler ส่งคืนค่า override:

- `content` สามารถแทนที่ result content
- `details` สามารถแทนที่ result details

เมื่อ tool ล้มเหลว wrapper จะปล่อย `tool_result` ด้วย `isError: true` และข้อความ error เป็น content จากนั้น rethrow error ต้นฉบับ

### สิ่งที่ hooks สามารถ mutate ได้

- LLM context สำหรับการเรียกครั้งเดียวผ่าน `context` (ห่วงโซ่การแทนที่ `messages`)
- tool output content/details เมื่อ tool calls สำเร็จ (เส้นทาง `tool_result`)
- ข้อความที่ inject ก่อน agent ผ่าน `before_agent_start`
- การยกเลิก/custom compaction/พฤติกรรม tree ผ่าน `session_before_*` และ `session.compacting`

### สิ่งที่ hooks ไม่สามารถ mutate ได้ในการ implement นี้

- พารามิเตอร์ input ของ tool แบบ in-place (ทำได้เพียง block/allow บน `tool_call`)
- การดำเนินการต่อหลังจาก tool errors ที่ throw ออกมา (เส้นทาง error จะ rethrow)
- สถานะ success/error สุดท้ายในพฤติกรรมของ wrapper (`isError` ที่ส่งคืนมี type แต่ไม่ถูกนำไปใช้โดย `HookToolWrapper`)

## ลำดับการทำงานและพฤติกรรมเมื่อเกิดความขัดแย้ง

### ลำดับระดับ Discovery

Capability providers ถูกจัดเรียงตามลำดับความสำคัญ (สูงสุดก่อน) Dedupe ทำโดยใช้ capability key โดยตัวแรกจะชนะ

สำหรับ `hooks` capability key คือ `${type}:${tool}:${name}` รายการที่ซ้ำซ้อนที่ถูกบดบังจาก providers ที่มีลำดับความสำคัญต่ำกว่าจะถูกทำเครื่องหมายและไม่รวมอยู่ในรายการที่ค้นพบที่มีผลบังคับใช้

### ลำดับการโหลด

`discoverAndLoadHooks` สร้างรายการ `allPaths` แบบ flat ที่ dedupe ด้วย resolved absolute path จากนั้น `loadHooks` จะวนซ้ำตามลำดับนั้น
ลำดับไฟล์ภายในแต่ละ directory ที่ค้นพบขึ้นอยู่กับผลลัพธ์ของ `readdir`; hook loader ไม่ทำการจัดเรียงเพิ่มเติม

### ลำดับ handler ในรันไทม์

ภายใน `HookRunner` ลำดับเป็นแบบ deterministic ตามลำดับการลงทะเบียน:

1. ลำดับของ hooks array
2. ลำดับการลงทะเบียน handler ต่อ hook/event

พฤติกรรมเมื่อเกิดความขัดแย้งตามประเภท event:

- `tool_call`: ผลลัพธ์ที่ส่งคืนล่าสุดชนะ ยกเว้น handler บล็อก; การบล็อกแรก short-circuit ทันที
- `tool_result`: override ที่ส่งคืนล่าสุดชนะ (ไม่มี short-circuit)
- `context`: ต่อเป็นห่วงโซ่; แต่ละ handler ได้รับผลลัพธ์ message ของ handler ก่อนหน้า
- `before_agent_start`: ข้อความแรกที่ส่งคืนจะถูกเก็บ; ข้อความหลังจากนั้นถูกละเว้น
- `session_before_*`: ผลลัพธ์ที่ส่งคืนล่าสุดถูกติดตาม; `cancel: true` จะ short-circuit ทันที
- `session.compacting`: ผลลัพธ์ที่ส่งคืนล่าสุดชนะ

ความขัดแย้งของ Command/renderer:

- `getCommand(name)` ส่งคืนผลลัพธ์แรกที่ตรงกันจากทุก hooks (ตัวที่โหลดก่อนชนะ)
- `getMessageRenderer(customType)` ส่งคืนผลลัพธ์แรกที่ตรงกัน
- `getRegisteredCommands()` ส่งคืน commands ทั้งหมด (ไม่มี dedupe)

## การโต้ตอบกับ UI (`HookContext.ui`)

`HookUIContext` ประกอบด้วย:

- `select`, `confirm`, `input`, `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`, `getEditorText`
- getter `theme`

`ctx.hasUI` ระบุว่า UI แบบ interactive พร้อมใช้งานหรือไม่

เมื่อรันโดยไม่มี UI พฤติกรรม context เริ่มต้นแบบ no-op คือ:

- `select/input/editor` ส่งคืน `undefined`
- `confirm` ส่งคืน `false`
- `notify`, `setStatus`, `setEditorText` เป็น no-ops
- `getEditorText` ส่งคืน `""`

### พฤติกรรม status line

ข้อความ status ของ hook ที่ตั้งค่าผ่าน `ctx.ui.setStatus(key, text)` จะถูก:

- จัดเก็บตาม key
- จัดเรียงตามชื่อ key
- sanitize (`\r`, `\n`, `\t` → spaces; spaces ที่ซ้ำกันถูกรวม)
- รวมกันและตัดความกว้างสำหรับการแสดงผล

## การแพร่กระจายข้อผิดพลาดและ fallback

### เวลาโหลด

- module ไม่ถูกต้องหรือไม่มี default export → จับไว้ใน `LoadHooksResult.errors`
- การโหลดดำเนินต่อสำหรับ hooks อื่นๆ

### เวลา event

`HookRunner.emit(...)` จับข้อผิดพลาดของ handler สำหรับ events ส่วนใหญ่และปล่อย `HookError` ไปยัง listeners (`hookPath`, `event`, `error`) จากนั้นดำเนินต่อ

`emitToolCall(...)` เข้มงวดกว่า: ข้อผิดพลาดของ handler จะไม่ถูกกลืน; จะแพร่กระจายไปยัง caller ใน `HookToolWrapper` สิ่งนี้จะบล็อก tool call (fail-safe)

## ตัวอย่าง API ที่ใช้งานจริง

### บล็อกคำสั่ง bash ที่ไม่ปลอดภัย

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "bash") return;
  const cmd = String(event.input.command ?? "");
  if (!cmd.includes("rm -rf")) return;

  if (!ctx.hasUI) return { block: true, reason: "rm -rf blocked (no UI)" };
  const ok = await ctx.ui.confirm("Dangerous command", `Allow: ${cmd}`);
  if (!ok) return { block: true, reason: "user denied command" };
 });
}
```

### Redact tool output หลังการ execute

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_result", async event => {
  if (event.toolName !== "read" || event.isError) return;

  const redacted = event.content.map(chunk => {
   if (chunk.type !== "text") return chunk;
   return { ...chunk, text: chunk.text.replaceAll(/API_KEY=\S+/g, "API_KEY=[REDACTED]") };
  });

  return { content: redacted };
 });
}
```

### ปรับเปลี่ยน model context ต่อการเรียก LLM

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### ลงทะเบียน slash command ด้วย command-safe context methods

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.registerCommand("handoff", {
  description: "Create a new session with setup message",
  handler: async (_args, ctx) => {
   await ctx.waitForIdle();
   await ctx.newSession({
    parentSession: ctx.sessionManager.getSessionFile(),
    setup: async sm => {
     sm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Continue from prior session summary." }],
      timestamp: Date.now(),
     });
    },
   });
  },
 });
}
```

## Export surface

`src/extensibility/hooks/index.ts` export:

- loading APIs (`discoverAndLoadHooks`, `loadHooks`)
- runner และ wrapper (`HookRunner`, `HookToolWrapper`)
- hook types ทั้งหมด
- re-export `execCommand`

และ package root (`src/index.ts`) re-export hook **types** เป็น legacy compatibility surface
