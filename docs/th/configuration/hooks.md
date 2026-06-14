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

แพ็กเกจ hook (`src/extensibility/hooks/`) ยังคงถูก export และใช้งานได้ในฐานะ API surface แต่ CLI runtime เริ่มต้นปัจจุบันใช้เส้นทาง **extension runner** แทน ในกระบวนการเริ่มต้นปัจจุบัน:

- `--hook` ถูกใช้เป็นนามแฝงสำหรับ `--extension` (เส้นทาง CLI ถูกรวมเข้าใน `additionalExtensionPaths`)
- เครื่องมือถูกครอบด้วย `ExtensionToolWrapper` ไม่ใช่ `HookToolWrapper`
- การแปลง context และการส่งสัญญาณวงจรชีวิตผ่าน `ExtensionRunner`

ดังนั้นไฟล์นี้จึงจัดทำเอกสารเกี่ยวกับการใช้งานระบบย่อย hook นั้นเอง (types/loader/runner/wrapper) รวมถึงพฤติกรรมเดิมและข้อจำกัดต่าง ๆ

## ไฟล์หลัก

- `src/extensibility/hooks/types.ts` — hook context, ประเภทเหตุการณ์, และสัญญาผลลัพธ์
- `src/extensibility/hooks/loader.ts` — การโหลดโมดูลและสะพานค้นพบ hook
- `src/extensibility/hooks/runner.ts` — การกระจายเหตุการณ์, การค้นหาคำสั่ง, การส่งสัญญาณข้อผิดพลาด
- `src/extensibility/hooks/tool-wrapper.ts` — wrapper ดักจับเครื่องมือก่อน/หลัง
- `src/extensibility/hooks/index.ts` — การ export/re-export

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

ฟังก์ชัน factory สามารถ:

- ลงทะเบียน event handler ด้วย `pi.on(...)`
- ส่งข้อความกำหนดเองแบบถาวรด้วย `pi.sendMessage(...)`
- คงสถานะที่ไม่ใช่ LLM ไว้ด้วย `pi.appendEntry(...)`
- ลงทะเบียนคำสั่ง slash ผ่าน `pi.registerCommand(...)`
- ลงทะเบียน renderer ข้อความกำหนดเองผ่าน `pi.registerMessageRenderer(...)`
- รันคำสั่ง shell ผ่าน `pi.exec(...)`

## การค้นพบและการโหลด

`discoverAndLoadHooks(configuredPaths, cwd)` ดำเนินการ:

1. โหลด hook ที่ค้นพบจาก capability registry (`loadCapability("hooks")`)
2. เพิ่มเส้นทางที่กำหนดค่าไว้อย่างชัดเจน (ลบรายการซ้ำตามเส้นทางสัมบูรณ์)
3. เรียก `loadHooks(allPaths, cwd)`

จากนั้น `loadHooks` จะ import แต่ละเส้นทางและคาดหวังฟังก์ชัน `default`

### การแก้ไขเส้นทาง

`loader.ts` แก้ไขเส้นทาง hook ดังนี้:

- เส้นทางสัมบูรณ์: ใช้ตามที่กำหนด
- เส้นทางที่ขึ้นต้นด้วย `~`: ขยายออก
- เส้นทางสัมพัทธ์: แก้ไขเทียบกับ `cwd`

### ความไม่สอดคล้องของระบบเดิมที่สำคัญ

ผู้ให้บริการการค้นพบสำหรับ `hookCapability` ยังคงจำลองไฟล์ hook แบบ shell ก่อน/หลัง (เช่น `.claude/hooks/pre/*`, `.xcsh/.../hooks/pre/*`)

ตัวโหลด hook ที่นี่ใช้การ import โมดูลแบบไดนามิกและต้องการ factory JS/TS แบบ default หากเส้นทาง hook ที่ค้นพบไม่สามารถ import เป็นโมดูลได้ การโหลดจะล้มเหลวและรายงานใน `LoadHooksResult.errors`

## พื้นผิวเหตุการณ์

Hook event มีการกำหนดประเภทอย่างเข้มงวดใน `types.ts`

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

### เหตุการณ์ Agent/context

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

### เหตุการณ์เครื่องมือ (รูปแบบก่อน/หลัง)

- `tool_call` (ก่อนการดำเนินการ) → สามารถส่งคืน `{ block?: boolean; reason?: string }`
- `tool_result` (หลังการดำเนินการ) → สามารถส่งคืน `{ content?; details?; isError? }`

นี่คือแบบจำลองการดักจับก่อน/หลังหลักของระบบย่อย hook

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

## แบบจำลองการดำเนินการและความหมายการเปลี่ยนแปลง

### 1) ก่อนการดำเนินการ: `tool_call`

`HookToolWrapper.execute()` ส่ง `tool_call` ก่อนการดำเนินการเครื่องมือ

- หาก handler ใด ๆ ส่งคืน `{ block: true }` การดำเนินการจะหยุด
- หาก handler ส่งข้อผิดพลาด wrapper จะล้มเหลวแบบปิดและบล็อกการดำเนินการ
- `reason` ที่ส่งคืนจะกลายเป็นข้อความข้อผิดพลาดที่ throw

### 2) การดำเนินการเครื่องมือ

เครื่องมือพื้นฐานดำเนินการตามปกติหากไม่ถูกบล็อก

### 3) หลังการดำเนินการ: `tool_result`

หลังจากสำเร็จ wrapper จะส่ง `tool_result` พร้อม:

- `toolName`, `toolCallId`, `input`
- `content`
- `details`
- `isError: false`

หาก handler ส่งคืนค่าแทนที่:

- `content` สามารถแทนที่เนื้อหาผลลัพธ์
- `details` สามารถแทนที่รายละเอียดผลลัพธ์

เมื่อเครื่องมือล้มเหลว wrapper จะส่ง `tool_result` พร้อม `isError: true` และเนื้อหาข้อความแสดงข้อผิดพลาด จากนั้น rethrow ข้อผิดพลาดเดิม

### สิ่งที่ hook สามารถเปลี่ยนแปลงได้

- LLM context สำหรับการเรียกครั้งเดียวผ่าน `context` (ลูกโซ่การแทนที่ `messages`)
- เนื้อหา/รายละเอียด output ของเครื่องมือเมื่อการเรียกเครื่องมือสำเร็จ (เส้นทาง `tool_result`)
- ข้อความที่แทรกก่อน agent ผ่าน `before_agent_start`
- พฤติกรรมการยกเลิก/compaction กำหนดเอง/tree ผ่าน `session_before_*` และ `session.compacting`

### สิ่งที่ hook ไม่สามารถเปลี่ยนแปลงได้ในการใช้งานนี้

- พารามิเตอร์ input ของเครื่องมือในตำแหน่งเดิม (เฉพาะบล็อก/อนุญาตบน `tool_call`)
- การดำเนินการต่อหลังจาก throw ข้อผิดพลาดของเครื่องมือ (เส้นทางข้อผิดพลาด rethrow)
- สถานะสำเร็จ/ข้อผิดพลาดสุดท้ายในพฤติกรรม wrapper (ค่า `isError` ที่ส่งคืนมีการกำหนดประเภทแต่ `HookToolWrapper` ไม่นำไปใช้)

## ลำดับและพฤติกรรมความขัดแย้ง

### การเรียงลำดับในระดับการค้นพบ

ผู้ให้บริการ Capability จะเรียงลำดับตามความสำคัญ (สูงก่อน) การลบรายการซ้ำใช้ capability key โดยตัวแรกชนะ

สำหรับ `hooks` capability key คือ `${type}:${tool}:${name}` รายการซ้ำที่ถูกบดบังจากผู้ให้บริการที่มีความสำคัญต่ำกว่าจะถูกทำเครื่องหมายและยกเว้นออกจากรายการที่ค้นพบที่มีผล

### ลำดับการโหลด

`discoverAndLoadHooks` สร้างรายการ `allPaths` แบบแบน ลบรายการซ้ำตามเส้นทางสัมบูรณ์ที่แก้ไขแล้ว จากนั้น `loadHooks` จะวนซ้ำตามลำดับนั้น
ลำดับไฟล์ภายในแต่ละไดเรกทอรีที่ค้นพบขึ้นอยู่กับผลลัพธ์ `readdir` โดยตัวโหลด hook ไม่ดำเนินการเรียงลำดับเพิ่มเติม

### ลำดับ handler ใน runtime

ภายใน `HookRunner` ลำดับจะกำหนดแน่นอนตามลำดับการลงทะเบียน:

1. ลำดับอาร์เรย์ hooks
2. ลำดับการลงทะเบียน handler ต่อ hook/event

พฤติกรรมความขัดแย้งตามประเภทเหตุการณ์:

- `tool_call`: ผลลัพธ์ที่ส่งคืนล่าสุดชนะ เว้นแต่ handler จะบล็อก; การบล็อกแรกจะตัดวงจรทันที
- `tool_result`: ค่าแทนที่ที่ส่งคืนล่าสุดชนะ (ไม่มีการตัดวงจร)
- `context`: เชื่อมต่อกัน; แต่ละ handler รับผลลัพธ์ข้อความของ handler ก่อนหน้า
- `before_agent_start`: ข้อความแรกที่ส่งคืนจะถูกเก็บไว้; ข้อความในภายหลังจะถูกละเว้น
- `session_before_*`: ผลลัพธ์ล่าสุดที่ส่งคืนจะถูกติดตาม; `cancel: true` จะตัดวงจรทันที
- `session.compacting`: ผลลัพธ์ล่าสุดที่ส่งคืนชนะ

ความขัดแย้งของคำสั่ง/renderer:

- `getCommand(name)` ส่งคืนการจับคู่แรกจากทุก hook (ตัวที่โหลดแรกชนะ)
- `getMessageRenderer(customType)` ส่งคืนการจับคู่แรก
- `getRegisteredCommands()` ส่งคืนคำสั่งทั้งหมด (ไม่ลบรายการซ้ำ)

## การโต้ตอบกับ UI (`HookContext.ui`)

`HookUIContext` ประกอบด้วย:

- `select`, `confirm`, `input`, `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`, `getEditorText`
- getter `theme`

`ctx.hasUI` ระบุว่า UI แบบโต้ตอบพร้อมใช้งานหรือไม่

เมื่อรันโดยไม่มี UI พฤติกรรม no-op context เริ่มต้นคือ:

- `select/input/editor` ส่งคืน `undefined`
- `confirm` ส่งคืน `false`
- `notify`, `setStatus`, `setEditorText` เป็น no-op
- `getEditorText` ส่งคืน `""`

### พฤติกรรมบรรทัดสถานะ

ข้อความสถานะ hook ที่กำหนดผ่าน `ctx.ui.setStatus(key, text)`:

- จัดเก็บตาม key
- เรียงลำดับตามชื่อ key
- ทำความสะอาด (`\r`, `\n`, `\t` → ช่องว่าง; ช่องว่างซ้ำถูกยุบ)
- เชื่อมต่อและตัดความกว้างสำหรับการแสดงผล

## การแพร่กระจายข้อผิดพลาดและการสำรอง

### ระหว่างการโหลด

- โมดูลไม่ถูกต้องหรือขาด default export → จับใน `LoadHooksResult.errors`
- การโหลดดำเนินต่อสำหรับ hook อื่น ๆ

### ระหว่างเหตุการณ์

`HookRunner.emit(...)` จับข้อผิดพลาด handler สำหรับเหตุการณ์ส่วนใหญ่และส่ง `HookError` ไปยัง listener (`hookPath`, `event`, `error`) จากนั้นดำเนินต่อ

`emitToolCall(...)` เข้มงวดกว่า: ข้อผิดพลาด handler ไม่ถูกกลืนที่นั่น; ข้อผิดพลาดจะแพร่กระจายไปยังผู้เรียก ใน `HookToolWrapper` สิ่งนี้จะบล็อกการเรียกเครื่องมือ (fail-safe)

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

### ปิดบัง output ของเครื่องมือหลังการดำเนินการ

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

## พื้นผิวการ Export

`src/extensibility/hooks/index.ts` export:

- API การโหลด (`discoverAndLoadHooks`, `loadHooks`)
- runner และ wrapper (`HookRunner`, `HookToolWrapper`)
- ประเภท hook ทั้งหมด
- re-export ของ `execCommand`

และ package root (`src/index.ts`) re-export **ประเภท** hook เป็นพื้นผิวความเข้ากันได้แบบ legacy
