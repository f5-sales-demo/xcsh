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

เอกสารนี้อธิบาย**โค้ดระบบย่อย hook ในปัจจุบัน**ใน `src/extensibility/hooks/*`

## สถานะปัจจุบันในระบบรันไทม์

แพ็กเกจ hook (`src/extensibility/hooks/`) ยังคงถูก export และใช้งานได้ในฐานะ API surface แต่รันไทม์ CLI เริ่มต้นในปัจจุบันจะเริ่มต้นผ่านเส้นทาง **extension runner** ในขั้นตอนการเริ่มต้นปัจจุบัน:

- `--hook` ถูกถือเป็น alias ของ `--extension` (เส้นทาง CLI ถูกรวมเข้ากับ `additionalExtensionPaths`)
- tools ถูกครอบด้วย `ExtensionToolWrapper` ไม่ใช่ `HookToolWrapper`
- การแปลง context และการส่ง lifecycle เป็นไปผ่าน `ExtensionRunner`

ดังนั้นเอกสารนี้จึงอธิบายการ implement ระบบย่อย hook เอง (types/loader/runner/wrapper) รวมถึงพฤติกรรมเดิมและข้อจำกัด

## ไฟล์สำคัญ

- `src/extensibility/hooks/types.ts` — hook context, ประเภทเหตุการณ์ และสัญญาผลลัพธ์
- `src/extensibility/hooks/loader.ts` — การโหลดโมดูลและสะพานเชื่อมการค้นพบ hook
- `src/extensibility/hooks/runner.ts` — การส่งเหตุการณ์, การค้นหาคำสั่ง, การส่งสัญญาณข้อผิดพลาด
- `src/extensibility/hooks/tool-wrapper.ts` — wrapper สำหรับการดักจับ tool ก่อน/หลัง
- `src/extensibility/hooks/index.ts` — exports/re-exports

## Hook module คืออะไร

Hook module ต้อง default-export ฟังก์ชัน factory:

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

factory สามารถ:

- ลงทะเบียน event handler ด้วย `pi.on(...)`
- ส่งข้อความ custom แบบถาวรด้วย `pi.sendMessage(...)`
- บันทึกสถานะที่ไม่ใช่ LLM แบบถาวรด้วย `pi.appendEntry(...)`
- ลงทะเบียน slash command ผ่าน `pi.registerCommand(...)`
- ลงทะเบียน custom message renderer ผ่าน `pi.registerMessageRenderer(...)`
- รันคำสั่ง shell ผ่าน `pi.exec(...)`

## การค้นพบและการโหลด

`discoverAndLoadHooks(configuredPaths, cwd)` ทำงานดังนี้:

1. โหลด hook ที่ค้นพบจาก capability registry (`loadCapability("hooks")`)
2. เพิ่มเส้นทางที่กำหนดค่าไว้อย่างชัดเจน (ตัดซ้ำด้วย absolute path)
3. เรียก `loadHooks(allPaths, cwd)`

`loadHooks` จากนั้น import แต่ละเส้นทางและคาดหวังฟังก์ชัน `default`

### การ resolve เส้นทาง

`loader.ts` resolve เส้นทาง hook ดังนี้:

- absolute path: ใช้ตามที่เป็น
- เส้นทาง `~`: ขยายออก
- relative path: resolve เทียบกับ `cwd`

### ความไม่ตรงกันที่สำคัญจากระบบเดิม

ผู้ให้บริการการค้นพบสำหรับ `hookCapability` ยังคงใช้โมเดลไฟล์ hook แบบ shell ก่อน/หลัง (ตัวอย่างเช่น `.claude/hooks/pre/*`, `.xcsh/.../hooks/pre/*`)

ตัวโหลด hook ที่นี่ใช้การ import โมดูลแบบ dynamic และต้องการ hook factory เป็น JS/TS แบบ default ถ้าเส้นทาง hook ที่ค้นพบไม่สามารถ import เป็นโมดูลได้ การโหลดจะล้มเหลวและรายงานใน `LoadHooksResult.errors`

## Event surfaces

เหตุการณ์ของ hook มี strong type ใน `types.ts`

### เหตุการณ์ session

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

### เหตุการณ์ agent/context

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

### เหตุการณ์ tool (โมเดลก่อน/หลัง)

- `tool_call` (ก่อนการทำงาน) → สามารถส่งคืน `{ block?: boolean; reason?: string }`
- `tool_result` (หลังการทำงาน) → สามารถส่งคืน `{ content?; details?; isError? }`

นี่คือโมเดลหลักการดักจับก่อน/หลังของระบบย่อย hook

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

## โมเดลการทำงานและ semantics ของการเปลี่ยนแปลงข้อมูล

### 1) ก่อนการทำงาน: `tool_call`

`HookToolWrapper.execute()` ส่ง `tool_call` ก่อนการทำงานของ tool

- ถ้า handler ใดส่งคืน `{ block: true }` การทำงานจะหยุด
- ถ้า handler throw ข้อผิดพลาด wrapper จะ fail closed และบล็อกการทำงาน
- `reason` ที่ส่งคืนจะกลายเป็นข้อความ error ที่ throw

### 2) การทำงานของ tool

Tool พื้นฐานทำงานตามปกติหากไม่ถูกบล็อก

### 3) หลังการทำงาน: `tool_result`

หลังจากสำเร็จ wrapper จะส่ง `tool_result` พร้อมกับ:

- `toolName`, `toolCallId`, `input`
- `content`
- `details`
- `isError: false`

ถ้า handler ส่งคืนค่าที่แทนที่:

- `content` สามารถแทนที่เนื้อหาผลลัพธ์ได้
- `details` สามารถแทนที่รายละเอียดผลลัพธ์ได้

เมื่อ tool ล้มเหลว wrapper จะส่ง `tool_result` พร้อม `isError: true` และเนื้อหาข้อความ error จากนั้น rethrow error เดิม

### สิ่งที่ hook สามารถเปลี่ยนแปลงได้

- LLM context สำหรับการเรียกครั้งเดียวผ่าน `context` (การเปลี่ยนแทนที่ `messages` แบบเชน)
- เนื้อหา/รายละเอียดผลลัพธ์ของ tool เมื่อ tool call สำเร็จ (เส้นทาง `tool_result`)
- ข้อความที่ inject ก่อน agent ผ่าน `before_agent_start`
- การยกเลิก/compaction แบบกำหนดเอง/พฤติกรรม tree ผ่าน `session_before_*` และ `session.compacting`

### สิ่งที่ hook ไม่สามารถเปลี่ยนแปลงได้ในการ implement นี้

- พารามิเตอร์ input ของ tool แบบ in-place (ทำได้แค่บล็อก/อนุญาตบน `tool_call`)
- การดำเนินการต่อหลังจาก tool errors ที่ throw (เส้นทาง error จะ rethrow)
- สถานะสำเร็จ/ล้มเหลวสุดท้ายในพฤติกรรมของ wrapper (`isError` ที่ส่งคืนมี type แต่ไม่ถูก apply โดย `HookToolWrapper`)

## ลำดับและพฤติกรรมเมื่อขัดแย้ง

### ลำดับระดับการค้นพบ

ผู้ให้บริการ capability ถูกเรียงตามลำดับความสำคัญ (สูงก่อน) การตัดซ้ำใช้ capability key โดยตัวแรกชนะ

สำหรับ `hooks` capability key คือ `${type}:${tool}:${name}` ตัวที่ซ้ำที่ถูกบดบังจากผู้ให้บริการที่มีลำดับความสำคัญต่ำกว่าจะถูกทำเครื่องหมายและไม่รวมในรายการที่ค้นพบที่มีผล

### ลำดับการโหลด

`discoverAndLoadHooks` สร้างรายการ `allPaths` แบบแบน ตัดซ้ำด้วย resolved absolute path จากนั้น `loadHooks` วนซ้ำตามลำดับนั้น
ลำดับไฟล์ภายในแต่ละไดเรกทอรีที่ค้นพบขึ้นอยู่กับผลลัพธ์ของ `readdir`; ตัวโหลด hook ไม่ทำการเรียงลำดับเพิ่มเติม

### ลำดับ handler ในรันไทม์

ภายใน `HookRunner` ลำดับเป็น deterministic ตามลำดับการลงทะเบียน:

1. ลำดับ hooks array
2. ลำดับการลงทะเบียน handler ต่อ hook/event

พฤติกรรมเมื่อขัดแย้งตามประเภทเหตุการณ์:

- `tool_call`: ผลลัพธ์ที่ส่งคืนล่าสุดชนะ เว้นแต่ handler จะบล็อก; การบล็อกแรก short-circuit ทันที
- `tool_result`: ค่าแทนที่ที่ส่งคืนล่าสุดชนะ (ไม่มี short-circuit)
- `context`: แบบเชน; handler แต่ละตัวรับผลลัพธ์ message จาก handler ก่อนหน้า
- `before_agent_start`: ข้อความแรกที่ส่งคืนจะถูกเก็บไว้; ข้อความหลังจากนั้นถูกละเว้น
- `session_before_*`: ผลลัพธ์ที่ส่งคืนล่าสุดถูกติดตาม; `cancel: true` short-circuit ทันที
- `session.compacting`: ผลลัพธ์ที่ส่งคืนล่าสุดชนะ

การขัดแย้งของ command/renderer:

- `getCommand(name)` ส่งคืนตัวที่ตรงกันแรกจากทุก hook (ตัวที่โหลดก่อนชนะ)
- `getMessageRenderer(customType)` ส่งคืนตัวที่ตรงกันแรก
- `getRegisteredCommands()` ส่งคืนคำสั่งทั้งหมด (ไม่ตัดซ้ำ)

## การโต้ตอบกับ UI (`HookContext.ui`)

`HookUIContext` รวมถึง:

- `select`, `confirm`, `input`, `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`, `getEditorText`
- getter `theme`

`ctx.hasUI` ระบุว่า UI แบบโต้ตอบพร้อมใช้งานหรือไม่

เมื่อรันโดยไม่มี UI พฤติกรรม context แบบ no-op เริ่มต้นคือ:

- `select/input/editor` ส่งคืน `undefined`
- `confirm` ส่งคืน `false`
- `notify`, `setStatus`, `setEditorText` เป็น no-op
- `getEditorText` ส่งคืน `""`

### พฤติกรรมบรรทัดสถานะ

ข้อความสถานะของ hook ที่ตั้งค่าผ่าน `ctx.ui.setStatus(key, text)`:

- ถูกเก็บต่อ key
- เรียงตามชื่อ key
- ถูกทำความสะอาด (`\r`, `\n`, `\t` → spaces; spaces ซ้ำถูกรวม)
- รวมและตัดความกว้างสำหรับการแสดงผล

## การแพร่กระจาย error และ fallback

### ตอนโหลด

- โมดูลไม่ถูกต้องหรือไม่มี default export → จับไว้ใน `LoadHooksResult.errors`
- การโหลดดำเนินต่อสำหรับ hook อื่น

### ตอนเหตุการณ์

`HookRunner.emit(...)` จับ error ของ handler สำหรับเหตุการณ์ส่วนใหญ่และส่ง `HookError` ไปยัง listener (`hookPath`, `event`, `error`) จากนั้นดำเนินต่อ

`emitToolCall(...)` เข้มงวดกว่า: error ของ handler จะไม่ถูกกลืนที่นั่น; มันจะแพร่กระจายไปยัง caller ใน `HookToolWrapper` สิ่งนี้จะบล็อกการเรียก tool (fail-safe)

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

### ปกปิดผลลัพธ์ของ tool หลังการทำงาน

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

### ลงทะเบียน slash command พร้อมเมธอด context ที่ปลอดภัยสำหรับคำสั่ง

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

- API การโหลด (`discoverAndLoadHooks`, `loadHooks`)
- runner และ wrapper (`HookRunner`, `HookToolWrapper`)
- hook types ทั้งหมด
- re-export `execCommand`

และ package root (`src/index.ts`) re-export hook **types** เป็น legacy compatibility surface
