---
title: Hooks
description: ระบบ Hook สำหรับการทำงานอัตโนมัติก่อน/หลังเหตุการณ์ในวงจรชีวิตของ coding agent
sidebar:
  order: 4
  label: Hooks
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# Hooks

เอกสารนี้อธิบาย **โค้ดระบบย่อย hook ในปัจจุบัน** ใน `src/extensibility/hooks/*`

## สถานะปัจจุบันในรันไทม์

แพ็คเกจ hook (`src/extensibility/hooks/`) ยังคงถูก export และสามารถใช้งานได้ในฐานะ API surface แต่รันไทม์ CLI เริ่มต้นจะเริ่มต้นเส้นทาง **extension runner** แทน ในขั้นตอนการเริ่มต้นปัจจุบัน:

- `--hook` ถูกถือว่าเป็น alias ของ `--extension` (เส้นทาง CLI ถูกรวมเข้าใน `additionalExtensionPaths`)
- เครื่องมือถูกห่อหุ้มด้วย `ExtensionToolWrapper` ไม่ใช่ `HookToolWrapper`
- การแปลง context และการปล่อยเหตุการณ์วงจรชีวิตผ่าน `ExtensionRunner`

ดังนั้นไฟล์นี้จึงเป็นเอกสารของการใช้งานระบบย่อย hook เอง (types/loader/runner/wrapper) รวมถึงพฤติกรรมเดิมและข้อจำกัด

## ไฟล์สำคัญ

- `src/extensibility/hooks/types.ts` — hook context, ประเภทเหตุการณ์ และสัญญาผลลัพธ์
- `src/extensibility/hooks/loader.ts` — การโหลดโมดูลและสะพานค้นหา hook
- `src/extensibility/hooks/runner.ts` — การส่งเหตุการณ์, การค้นหาคำสั่ง, การส่งสัญญาณข้อผิดพลาด
- `src/extensibility/hooks/tool-wrapper.ts` — wrapper สกัดกั้นเครื่องมือก่อน/หลัง
- `src/extensibility/hooks/index.ts` — exports/re-exports

## Hook module คืออะไร

Hook module ต้อง default-export factory:

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

- ลงทะเบียน event handler ด้วย `pi.on(...)`
- ส่งข้อความกำหนดเองแบบถาวรด้วย `pi.sendMessage(...)`
- เก็บสถานะที่ไม่ใช่ LLM แบบถาวรด้วย `pi.appendEntry(...)`
- ลงทะเบียนคำสั่ง slash ผ่าน `pi.registerCommand(...)`
- ลงทะเบียน custom message renderer ผ่าน `pi.registerMessageRenderer(...)`
- รันคำสั่ง shell ผ่าน `pi.exec(...)`

## การค้นหาและการโหลด

`discoverAndLoadHooks(configuredPaths, cwd)` ทำสิ่งต่อไปนี้:

1. โหลด hook ที่ค้นพบจาก capability registry (`loadCapability("hooks")`)
2. เพิ่มเส้นทางที่กำหนดค่าไว้อย่างชัดเจน (ตัดรายการซ้ำด้วย absolute path)
3. เรียก `loadHooks(allPaths, cwd)`

`loadHooks` จากนั้น import แต่ละเส้นทางและคาดหวังฟังก์ชัน `default`

### การแก้ไขเส้นทาง

`loader.ts` แก้ไขเส้นทาง hook ดังนี้:

- absolute path: ใช้ตามที่เป็น
- เส้นทาง `~`: ขยายออก
- relative path: แก้ไขเทียบกับ `cwd`

### ความไม่ตรงกันเดิมที่สำคัญ

ผู้ให้บริการค้นหาสำหรับ `hookCapability` ยังคงจำลองไฟล์ hook แบบ shell ก่อน/หลัง (ตัวอย่างเช่น `.claude/hooks/pre/*`, `.xcsh/.../hooks/pre/*`)

ตัวโหลด hook ที่นี่ใช้ dynamic module import และต้องการ default JS/TS hook factory หากเส้นทาง hook ที่ค้นพบไม่สามารถ import เป็นโมดูลได้ การโหลดจะล้มเหลวและถูกรายงานใน `LoadHooksResult.errors`

## พื้นผิวเหตุการณ์

เหตุการณ์ Hook มีการกำหนดประเภทอย่างเข้มงวดใน `types.ts`

### เหตุการณ์เซสชัน

- `session_start`
- `session_before_switch` → สามารถคืนค่า `{ cancel?: boolean }`
- `session_switch`
- `session_before_branch` → สามารถคืนค่า `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_branch`
- `session_before_compact` → สามารถคืนค่า `{ cancel?: boolean; compaction?: CompactionResult }`
- `session.compacting` → สามารถคืนค่า `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }`
- `session_compact`
- `session_before_tree` → สามารถคืนค่า `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`
- `session_tree`
- `session_shutdown`

### เหตุการณ์ Agent/Context

- `context` → สามารถคืนค่า `{ messages?: Message[] }`
- `before_agent_start` → สามารถคืนค่า `{ message?: { customType; content; display; details } }`
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

### เหตุการณ์เครื่องมือ (โมเดลก่อน/หลัง)

- `tool_call` (ก่อนดำเนินการ) → สามารถคืนค่า `{ block?: boolean; reason?: string }`
- `tool_result` (หลังดำเนินการ) → สามารถคืนค่า `{ content?; details?; isError? }`

นี่คือโมเดลหลักการสกัดกั้นก่อน/หลังของระบบย่อย hook

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

## โมเดลการดำเนินการและความหมายของการเปลี่ยนแปลง

### 1) ก่อนดำเนินการ: `tool_call`

`HookToolWrapper.execute()` ปล่อย `tool_call` ก่อนดำเนินการเครื่องมือ

- หาก handler ใดคืนค่า `{ block: true }` การดำเนินการจะหยุด
- หาก handler โยนข้อผิดพลาด wrapper จะล้มเหลวอย่างปลอดภัยและบล็อกการดำเนินการ
- `reason` ที่คืนค่าจะกลายเป็นข้อความข้อผิดพลาดที่ถูกโยน

### 2) การดำเนินการเครื่องมือ

เครื่องมือพื้นฐานดำเนินการตามปกติหากไม่ถูกบล็อก

### 3) หลังดำเนินการ: `tool_result`

หลังจากสำเร็จ wrapper จะปล่อย `tool_result` พร้อมกับ:

- `toolName`, `toolCallId`, `input`
- `content`
- `details`
- `isError: false`

หาก handler คืนค่าการแทนที่:

- `content` สามารถแทนที่เนื้อหาผลลัพธ์
- `details` สามารถแทนที่รายละเอียดผลลัพธ์

เมื่อเครื่องมือล้มเหลว wrapper จะปล่อย `tool_result` พร้อม `isError: true` และเนื้อหาข้อความข้อผิดพลาด จากนั้นโยนข้อผิดพลาดเดิมอีกครั้ง

### สิ่งที่ hook สามารถเปลี่ยนแปลงได้

- LLM context สำหรับการเรียกครั้งเดียวผ่าน `context` (การเชื่อมต่อการแทนที่ `messages`)
- เนื้อหา/รายละเอียดผลลัพธ์เครื่องมือเมื่อเรียกเครื่องมือสำเร็จ (เส้นทาง `tool_result`)
- ข้อความที่ฉีดก่อน agent ผ่าน `before_agent_start`
- การยกเลิก/การบีบอัดแบบกำหนดเอง/พฤติกรรม tree ผ่าน `session_before_*` และ `session.compacting`

### สิ่งที่ hook ไม่สามารถเปลี่ยนแปลงได้ในการใช้งานนี้

- พารามิเตอร์อินพุตเครื่องมือแบบ in-place (บล็อก/อนุญาตบน `tool_call` เท่านั้น)
- การดำเนินการต่อหลังจากข้อผิดพลาดเครื่องมือที่ถูกโยน (เส้นทางข้อผิดพลาดจะโยนอีกครั้ง)
- สถานะสำเร็จ/ข้อผิดพลาดสุดท้ายในพฤติกรรม wrapper (`isError` ที่คืนค่ามีการกำหนดประเภทแต่ไม่ถูกนำไปใช้โดย `HookToolWrapper`)

## ลำดับและพฤติกรรมเมื่อขัดแย้ง

### ลำดับระดับการค้นหา

ผู้ให้บริการ capability ถูกเรียงลำดับตามลำดับความสำคัญ (สูงก่อน) การตัดรายการซ้ำใช้ capability key รายการแรกชนะ

สำหรับ `hooks` capability key คือ `${type}:${tool}:${name}` รายการซ้ำที่ถูกบดบังจากผู้ให้บริการที่มีลำดับความสำคัญต่ำกว่าจะถูกทำเครื่องหมายและถูกแยกออกจากรายการที่ค้นพบที่มีผล

### ลำดับการโหลด

`discoverAndLoadHooks` สร้างรายการ `allPaths` แบบแบน ตัดรายการซ้ำด้วย resolved absolute path จากนั้น `loadHooks` วนซ้ำตามลำดับนั้น
ลำดับไฟล์ภายในแต่ละไดเรกทอรีที่ค้นพบขึ้นอยู่กับผลลัพธ์ของ `readdir`; ตัวโหลด hook ไม่ทำการเรียงลำดับเพิ่มเติม

### ลำดับ handler ในรันไทม์

ภายใน `HookRunner` ลำดับเป็นแบบกำหนดแน่นอนตามลำดับการลงทะเบียน:

1. ลำดับอาร์เรย์ hooks
2. ลำดับการลงทะเบียน handler ต่อ hook/เหตุการณ์

พฤติกรรมเมื่อขัดแย้งตามประเภทเหตุการณ์:

- `tool_call`: ผลลัพธ์ที่คืนค่าล่าสุดชนะ เว้นแต่ handler จะบล็อก; การบล็อกแรกจะ short-circuit
- `tool_result`: การแทนที่ที่คืนค่าล่าสุดชนะ (ไม่มี short-circuit)
- `context`: เชื่อมต่อกัน; แต่ละ handler ได้รับผลลัพธ์ข้อความจาก handler ก่อนหน้า
- `before_agent_start`: ข้อความแรกที่คืนค่าจะถูกเก็บไว้; ข้อความหลังจากนั้นถูกละเว้น
- `session_before_*`: ผลลัพธ์ที่คืนค่าล่าสุดจะถูกติดตาม; `cancel: true` จะ short-circuit ทันที
- `session.compacting`: ผลลัพธ์ที่คืนค่าล่าสุดชนะ

ความขัดแย้งของคำสั่ง/renderer:

- `getCommand(name)` คืนค่ารายการที่ตรงกันแรกข้าม hooks (โหลดก่อนชนะ)
- `getMessageRenderer(customType)` คืนค่ารายการที่ตรงกันแรก
- `getRegisteredCommands()` คืนค่าคำสั่งทั้งหมด (ไม่ตัดรายการซ้ำ)

## การโต้ตอบ UI (`HookContext.ui`)

`HookUIContext` ประกอบด้วย:

- `select`, `confirm`, `input`, `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`, `getEditorText`
- getter `theme`

`ctx.hasUI` ระบุว่า UI แบบโต้ตอบพร้อมใช้งานหรือไม่

เมื่อทำงานโดยไม่มี UI พฤติกรรม context เริ่มต้นแบบ no-op คือ:

- `select/input/editor` คืนค่า `undefined`
- `confirm` คืนค่า `false`
- `notify`, `setStatus`, `setEditorText` เป็น no-ops
- `getEditorText` คืนค่า `""`

### พฤติกรรมบรรทัดสถานะ

ข้อความสถานะ hook ที่ตั้งค่าผ่าน `ctx.ui.setStatus(key, text)` จะ:

- เก็บตาม key
- เรียงลำดับตามชื่อ key
- ทำความสะอาด (`\r`, `\n`, `\t` → ช่องว่าง; ช่องว่างซ้ำถูกยุบ)
- รวมและตัดความกว้างสำหรับการแสดงผล

## การแพร่กระจายข้อผิดพลาดและ fallback

### เวลาโหลด

- โมดูลไม่ถูกต้องหรือไม่มี default export → จับไว้ใน `LoadHooksResult.errors`
- การโหลดดำเนินต่อสำหรับ hooks อื่น

### เวลาเหตุการณ์

`HookRunner.emit(...)` จับข้อผิดพลาดของ handler สำหรับเหตุการณ์ส่วนใหญ่และปล่อย `HookError` ไปยัง listener (`hookPath`, `event`, `error`) จากนั้นดำเนินต่อ

`emitToolCall(...)` เข้มงวดกว่า: ข้อผิดพลาดของ handler ไม่ถูกกลืนที่นั่น; มันแพร่กระจายไปยังผู้เรียก ใน `HookToolWrapper` สิ่งนี้จะบล็อกการเรียกเครื่องมือ (fail-safe)

## ตัวอย่าง API ที่เป็นจริง

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

### ปกปิดผลลัพธ์เครื่องมือหลังดำเนินการ

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

### แก้ไข model context ต่อการเรียก LLM

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### ลงทะเบียนคำสั่ง slash พร้อมเมธอด context ที่ปลอดภัยสำหรับคำสั่ง

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

## พื้นผิว Export

`src/extensibility/hooks/index.ts` export:

- API การโหลด (`discoverAndLoadHooks`, `loadHooks`)
- runner และ wrapper (`HookRunner`, `HookToolWrapper`)
- ประเภท hook ทั้งหมด
- re-export `execCommand`

และ package root (`src/index.ts`) re-export **ประเภท** hook เป็นพื้นผิวความเข้ากันได้แบบเดิม
