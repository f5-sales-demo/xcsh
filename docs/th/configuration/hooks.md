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

เอกสารนี้อธิบาย **โค้ดระบบย่อย hook ปัจจุบัน** ใน `src/extensibility/hooks/*`

## สถานะปัจจุบันใน runtime

แพ็กเกจ hook (`src/extensibility/hooks/`) ยังคงถูก export และใช้งานได้ในฐานะพื้นผิว API แต่ CLI runtime เริ่มต้นปัจจุบันจะเริ่มต้นใช้เส้นทาง **extension runner** แทน ในขั้นตอนการเริ่มต้นปัจจุบัน:

- `--hook` ถูกใช้เป็น alias ของ `--extension` (เส้นทาง CLI จะถูกรวมเข้าใน `additionalExtensionPaths`)
- เครื่องมือถูกห่อหุ้มด้วย `ExtensionToolWrapper` ไม่ใช่ `HookToolWrapper`
- การแปลงบริบทและการส่งสัญญาณวงจรชีวิตผ่าน `ExtensionRunner`

ดังนั้นไฟล์นี้จึงจัดทำเอกสารการใช้งานระบบย่อย hook (types/loader/runner/wrapper) รวมถึงพฤติกรรมเดิมและข้อจำกัด

## ไฟล์หลัก

- `src/extensibility/hooks/types.ts` — บริบท hook, ประเภทเหตุการณ์, และสัญญาของผลลัพธ์
- `src/extensibility/hooks/loader.ts` — การโหลดโมดูลและสะพานเชื่อมการค้นพบ hook
- `src/extensibility/hooks/runner.ts` — การส่งเหตุการณ์, การค้นหาคำสั่ง, การส่งสัญญาณข้อผิดพลาด
- `src/extensibility/hooks/tool-wrapper.ts` — wrapper สกัดกั้นเครื่องมือก่อน/หลัง
- `src/extensibility/hooks/index.ts` — exports/re-exports

## Hook module คืออะไร

hook module ต้อง default-export ฟังก์ชัน factory:

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
- ส่งข้อความกำหนดเองที่ถาวรด้วย `pi.sendMessage(...)`
- จัดเก็บสถานะที่ไม่ใช่ LLM ด้วย `pi.appendEntry(...)`
- ลงทะเบียนคำสั่ง slash ผ่าน `pi.registerCommand(...)`
- ลงทะเบียน renderer ข้อความกำหนดเองผ่าน `pi.registerMessageRenderer(...)`
- รันคำสั่ง shell ผ่าน `pi.exec(...)`

## การค้นพบและการโหลด

`discoverAndLoadHooks(configuredPaths, cwd)` ทำดังนี้:

1. โหลด hook ที่ค้นพบจาก capability registry (`loadCapability("hooks")`)
2. เพิ่มเส้นทางที่กำหนดค่าไว้อย่างชัดเจน (ตัดรายการซ้ำตามเส้นทางสัมบูรณ์)
3. เรียก `loadHooks(allPaths, cwd)`

จากนั้น `loadHooks` จะ import แต่ละเส้นทางและคาดว่าจะมีฟังก์ชัน `default`

### การระบุเส้นทาง

`loader.ts` ระบุเส้นทาง hook ดังนี้:

- เส้นทางสัมบูรณ์: ใช้ตามที่เป็น
- เส้นทาง `~`: ขยายให้ครบถ้วน
- เส้นทางสัมพัทธ์: ระบุตาม `cwd`

### ความไม่ตรงกันของ legacy ที่สำคัญ

ผู้ให้บริการการค้นพบสำหรับ `hookCapability` ยังคงจำลองไฟล์ hook สไตล์ shell แบบ pre/post (เช่น `.claude/hooks/pre/*`, `.xcsh/.../hooks/pre/*`)

hook loader ที่นี่ใช้การ import โมดูลแบบ dynamic และต้องการ factory JS/TS ที่เป็น default หากเส้นทาง hook ที่ค้นพบไม่สามารถ import เป็นโมดูลได้ การโหลดจะล้มเหลวและรายงานใน `LoadHooksResult.errors`

## พื้นผิวเหตุการณ์

เหตุการณ์ hook มีการกำหนดประเภทอย่างเข้มงวดใน `types.ts`

### เหตุการณ์ Session

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

### เหตุการณ์ Agent/บริบท

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

### เหตุการณ์เครื่องมือ (โมเดล pre/post)

- `tool_call` (ก่อนการประมวลผล) → สามารถคืนค่า `{ block?: boolean; reason?: string }`
- `tool_result` (หลังการประมวลผล) → สามารถคืนค่า `{ content?; details?; isError? }`

นี่คือโมเดลสกัดกั้นก่อน/หลังหลักของระบบย่อย hook

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

## โมเดลการประมวลผลและความหมายของการ mutate

### 1) ก่อนการประมวลผล: `tool_call`

`HookToolWrapper.execute()` ส่งสัญญาณ `tool_call` ก่อนการประมวลผลเครื่องมือ

- หากตัวจัดการใดคืนค่า `{ block: true }` การประมวลผลจะหยุด
- หาก handler throw เกิดขึ้น wrapper จะล้มเหลวแบบปิดและบล็อกการประมวลผล
- `reason` ที่คืนค่ากลับมาจะกลายเป็นข้อความข้อผิดพลาดที่ throw

### 2) การประมวลผลเครื่องมือ

เครื่องมือพื้นฐานจะประมวลผลตามปกติหากไม่ถูกบล็อก

### 3) หลังการประมวลผล: `tool_result`

หลังจากสำเร็จ wrapper จะส่งสัญญาณ `tool_result` พร้อมด้วย:

- `toolName`, `toolCallId`, `input`
- `content`
- `details`
- `isError: false`

หาก handler คืนค่า overrides:

- `content` สามารถแทนที่เนื้อหาผลลัพธ์ได้
- `details` สามารถแทนที่รายละเอียดผลลัพธ์ได้

เมื่อเครื่องมือล้มเหลว wrapper จะส่งสัญญาณ `tool_result` พร้อม `isError: true` และเนื้อหาข้อความข้อผิดพลาด จากนั้น rethrow ข้อผิดพลาดดั้งเดิม

### สิ่งที่ hook สามารถ mutate ได้

- บริบท LLM สำหรับการเรียกครั้งเดียวผ่าน `context` (ห่วงโซ่การแทนที่ `messages`)
- เนื้อหา/รายละเอียดเอาต์พุตของเครื่องมือเมื่อเรียกเครื่องมือสำเร็จ (เส้นทาง `tool_result`)
- ข้อความที่แทรกก่อน agent ผ่าน `before_agent_start`
- พฤติกรรมการยกเลิก/การบีบอัดกำหนดเอง/tree ผ่าน `session_before_*` และ `session.compacting`

### สิ่งที่ hook ไม่สามารถ mutate ได้ในการใช้งานนี้

- พารามิเตอร์ input ของเครื่องมือโดยตรง (เฉพาะบล็อก/อนุญาตใน `tool_call` เท่านั้น)
- การดำเนินการต่อหลังจากเกิดข้อผิดพลาดของเครื่องมือ (เส้นทางข้อผิดพลาด rethrow)
- สถานะสำเร็จ/ข้อผิดพลาดสุดท้ายในพฤติกรรม wrapper (ค่า `isError` ที่คืนกลับมามีประเภทกำหนดไว้แต่ไม่ถูกนำไปใช้โดย `HookToolWrapper`)

## ลำดับและพฤติกรรมความขัดแย้ง

### ลำดับระดับการค้นพบ

ผู้ให้บริการ capability จะถูกเรียงลำดับตามลำดับความสำคัญ (สูงกว่าก่อน) การตัดรายการซ้ำตาม capability key โดย first wins

สำหรับ `hooks` capability key คือ `${type}:${tool}:${name}` รายการซ้ำที่ถูกแทนที่จากผู้ให้บริการที่มีลำดับความสำคัญต่ำกว่าจะถูกทำเครื่องหมายและแยกออกจากรายการที่ค้นพบที่มีผล

### ลำดับการโหลด

`discoverAndLoadHooks` สร้างรายการ `allPaths` แบบแบน ตัดรายการซ้ำตามเส้นทางสัมบูรณ์ที่ระบุ จากนั้น `loadHooks` จะวนซ้ำตามลำดับนั้น
ลำดับไฟล์ภายในแต่ละไดเรกทอรีที่ค้นพบขึ้นอยู่กับเอาต์พุตของ `readdir`; hook loader ไม่ได้ทำการเรียงลำดับเพิ่มเติม

### ลำดับ handler ขณะ runtime

ภายใน `HookRunner` ลำดับจะกำหนดชัดเจนตามลำดับการลงทะเบียน:

1. ลำดับอาร์เรย์ hooks
2. ลำดับการลงทะเบียน handler ต่อ hook/event

พฤติกรรมความขัดแย้งตามประเภทเหตุการณ์:

- `tool_call`: ผลลัพธ์ที่คืนมาล่าสุดชนะ ยกเว้น handler บล็อก; การบล็อกครั้งแรก short-circuits
- `tool_result`: override ที่คืนมาล่าสุดชนะ (ไม่มี short-circuit)
- `context`: ต่อเชื่อมกัน; handler แต่ละตัวจะได้รับเอาต์พุตข้อความของ handler ก่อนหน้า
- `before_agent_start`: ข้อความแรกที่คืนมาจะถูกเก็บไว้; ข้อความถัดไปจะถูกละเว้น
- `session_before_*`: ผลลัพธ์ล่าสุดที่คืนมาจะถูกติดตาม; `cancel: true` short-circuits ทันที
- `session.compacting`: ผลลัพธ์ล่าสุดที่คืนมาชนะ

ความขัดแย้งของคำสั่ง/renderer:

- `getCommand(name)` คืนค่าการจับคู่แรกในทุก hook (โหลดครั้งแรกชนะ)
- `getMessageRenderer(customType)` คืนค่าการจับคู่แรก
- `getRegisteredCommands()` คืนค่าคำสั่งทั้งหมด (ไม่มีการตัดรายการซ้ำ)

## การโต้ตอบกับ UI (`HookContext.ui`)

`HookUIContext` รวมถึง:

- `select`, `confirm`, `input`, `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`, `getEditorText`
- getter ของ `theme`

`ctx.hasUI` ระบุว่ามี UI แบบโต้ตอบให้ใช้งานหรือไม่

เมื่อรันโดยไม่มี UI พฤติกรรมบริบท no-op เริ่มต้นคือ:

- `select/input/editor` คืนค่า `undefined`
- `confirm` คืนค่า `false`
- `notify`, `setStatus`, `setEditorText` เป็น no-op
- `getEditorText` คืนค่า `""`

### พฤติกรรมบรรทัดสถานะ

ข้อความสถานะ hook ที่กำหนดผ่าน `ctx.ui.setStatus(key, text)` จะ:

- จัดเก็บตาม key
- เรียงลำดับตามชื่อ key
- ทำความสะอาด (`\r`, `\n`, `\t` → spaces; ช่องว่างซ้ำจะถูกรวม)
- รวมและตัดความกว้างสำหรับการแสดงผล

## การส่งต่อข้อผิดพลาดและ fallback

### ขณะโหลด

- โมดูลไม่ถูกต้องหรือไม่มี default export → ถูกบันทึกใน `LoadHooksResult.errors`
- การโหลดดำเนินต่อสำหรับ hook อื่นๆ

### ขณะเกิดเหตุการณ์

`HookRunner.emit(...)` จับข้อผิดพลาดของ handler สำหรับเหตุการณ์ส่วนใหญ่และส่ง `HookError` ไปยัง listener (`hookPath`, `event`, `error`) จากนั้นดำเนินต่อ

`emitToolCall(...)` เข้มงวดกว่า: ข้อผิดพลาดของ handler ไม่ถูกกลืนที่นั่น; มันถูกส่งต่อไปยังผู้เรียก ใน `HookToolWrapper` สิ่งนี้จะบล็อกการเรียกเครื่องมือ (fail-safe)

## ตัวอย่าง API จริง

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

### ปิดบังเอาต์พุตเครื่องมือหลังการประมวลผล

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

### แก้ไขบริบทโมเดลต่อการเรียก LLM

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### ลงทะเบียนคำสั่ง slash พร้อม context methods ที่ปลอดภัยสำหรับคำสั่ง

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

## พื้นผิวการ export

`src/extensibility/hooks/index.ts` export:

- loading APIs (`discoverAndLoadHooks`, `loadHooks`)
- runner และ wrapper (`HookRunner`, `HookToolWrapper`)
- ประเภท hook ทั้งหมด
- `execCommand` re-export

และ package root (`src/index.ts`) re-export **ประเภท** hook เป็นพื้นผิวความเข้ากันได้แบบ legacy
