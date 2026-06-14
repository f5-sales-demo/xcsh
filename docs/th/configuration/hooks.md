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

## สถานะปัจจุบันใน runtime

แพ็กเกจ hook (`src/extensibility/hooks/`) ยังคงถูก export และใช้งานได้ในฐานะพื้นผิว API แต่ CLI runtime เริ่มต้นค่าเริ่มต้นจะใช้เส้นทาง **extension runner** แทน ในกระบวนการเริ่มต้นปัจจุบัน:

- `--hook` ถูกใช้เป็น alias สำหรับ `--extension` (เส้นทาง CLI ถูกรวมเข้าใน `additionalExtensionPaths`)
- เครื่องมือถูกห่อด้วย `ExtensionToolWrapper` ไม่ใช่ `HookToolWrapper`
- การแปลงบริบทและการส่ง lifecycle จะผ่าน `ExtensionRunner`

ดังนั้นไฟล์นี้จึงจัดทำเอกสารการใช้งานระบบย่อย hook (types/loader/runner/wrapper) รวมถึงพฤติกรรมและข้อจำกัดแบบ legacy

## ไฟล์หลัก

- `src/extensibility/hooks/types.ts` — บริบท hook, ประเภท event และสัญญาผลลัพธ์
- `src/extensibility/hooks/loader.ts` — การโหลดโมดูลและ bridge การค้นพบ hook
- `src/extensibility/hooks/runner.ts` — การส่ง event, การค้นหาคำสั่ง และการส่งสัญญาณข้อผิดพลาด
- `src/extensibility/hooks/tool-wrapper.ts` — wrapper การดักจับเครื่องมือแบบ pre/post
- `src/extensibility/hooks/index.ts` — exports/re-exports

## Hook module คืออะไร

Hook module ต้องทำการ default-export factory:

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
- คงสถานะที่ไม่ใช่ LLM ด้วย `pi.appendEntry(...)`
- ลงทะเบียน slash command ผ่าน `pi.registerCommand(...)`
- ลงทะเบียน message renderer กำหนดเองผ่าน `pi.registerMessageRenderer(...)`
- รันคำสั่ง shell ผ่าน `pi.exec(...)`

## การค้นพบและการโหลด

`discoverAndLoadHooks(configuredPaths, cwd)` ทำสิ่งต่อไปนี้:

1. โหลด hook ที่ค้นพบจาก capability registry (`loadCapability("hooks")`)
2. เพิ่มเส้นทางที่กำหนดค่าไว้อย่างชัดเจน (ลบข้อมูลซ้ำด้วย absolute path)
3. เรียก `loadHooks(allPaths, cwd)`

จากนั้น `loadHooks` จะ import แต่ละเส้นทางและคาดหวังฟังก์ชัน `default`

### การแก้ไขเส้นทาง

`loader.ts` แก้ไขเส้นทาง hook ดังนี้:

- absolute path: ใช้ตามที่กำหนด
- เส้นทาง `~`: ขยายออก
- relative path: แก้ไขตาม `cwd`

### ความไม่ตรงกันแบบ legacy ที่สำคัญ

Discovery provider สำหรับ `hookCapability` ยังคงจำลองไฟล์ hook แบบ shell ก่อน/หลัง (เช่น `.claude/hooks/pre/*`, `.xcsh/.../hooks/pre/*`)

Hook loader ที่นี่ใช้การ import โมดูลแบบ dynamic และต้องการ default JS/TS hook factory หากเส้นทาง hook ที่ค้นพบไม่สามารถ import เป็นโมดูลได้ การโหลดจะล้มเหลวและรายงานใน `LoadHooksResult.errors`

## พื้นผิว Event

Hook event มีประเภทที่กำหนดอย่างชัดเจนใน `types.ts`

### Session events

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

### Agent/context events

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

### Tool events (โมเดล pre/post)

- `tool_call` (ก่อนการดำเนินการ) → สามารถคืนค่า `{ block?: boolean; reason?: string }`
- `tool_result` (หลังการดำเนินการ) → สามารถคืนค่า `{ content?; details?; isError? }`

นี่คือโมเดลการดักจับแบบ pre/post หลักของระบบย่อย hook

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

## โมเดลการดำเนินการและ mutation semantics

### 1) Pre-execution: `tool_call`

`HookToolWrapper.execute()` ส่ง `tool_call` ก่อนการดำเนินการเครื่องมือ

- หาก handler ใดคืนค่า `{ block: true }` การดำเนินการจะหยุด
- หาก handler โยนข้อผิดพลาด wrapper จะล้มเหลวแบบปิดและบล็อกการดำเนินการ
- `reason` ที่คืนค่ากลับมาจะกลายเป็นข้อความข้อผิดพลาดที่โยน

### 2) การดำเนินการเครื่องมือ

เครื่องมือพื้นฐานจะดำเนินการตามปกติหากไม่ถูกบล็อก

### 3) Post-execution: `tool_result`

หลังจากสำเร็จ wrapper จะส่ง `tool_result` พร้อม:

- `toolName`, `toolCallId`, `input`
- `content`
- `details`
- `isError: false`

หาก handler คืนค่า overrides:

- `content` สามารถแทนที่เนื้อหาผลลัพธ์ได้
- `details` สามารถแทนที่รายละเอียดผลลัพธ์ได้

เมื่อเครื่องมือล้มเหลว wrapper จะส่ง `tool_result` พร้อม `isError: true` และเนื้อหาข้อความข้อผิดพลาด จากนั้น rethrow ข้อผิดพลาดเดิม

### สิ่งที่ hook สามารถ mutate ได้

- บริบท LLM สำหรับการเรียกเดียวผ่าน `context` (chain การแทนที่ `messages`)
- เนื้อหา/รายละเอียดผลลัพธ์เครื่องมือในการเรียกเครื่องมือที่สำเร็จ (เส้นทาง `tool_result`)
- ข้อความที่ inject ก่อน agent ผ่าน `before_agent_start`
- การยกเลิก/การบีบอัดกำหนดเอง/พฤติกรรม tree ผ่าน `session_before_*` และ `session.compacting`

### สิ่งที่ hook ไม่สามารถ mutate ได้ในการใช้งานนี้

- พารามิเตอร์ input ของเครื่องมือดิบในที่นั้น (เฉพาะ block/allow บน `tool_call`)
- การดำเนินการต่อหลังจากข้อผิดพลาดเครื่องมือที่โยน (เส้นทาง error ทำ rethrow)
- สถานะสำเร็จ/ข้อผิดพลาดสุดท้ายในพฤติกรรม wrapper (คืนค่า `isError` มีประเภทแต่ `HookToolWrapper` ไม่นำไปใช้)

## ลำดับและพฤติกรรมความขัดแย้ง

### ลำดับระดับ Discovery

Capability provider ถูกเรียงลำดับตามลำดับความสำคัญ (สูงกว่าก่อน) การลบข้อมูลซ้ำใช้ capability key โดยตัวแรกชนะ

สำหรับ `hooks` capability key คือ `${type}:${tool}:${name}` รายการซ้ำที่ถูกบดบังจาก provider ที่มีลำดับความสำคัญต่ำกว่าจะถูกทำเครื่องหมายและแยกออกจากรายการที่ค้นพบที่มีผล

### ลำดับการโหลด

`discoverAndLoadHooks` สร้างรายการ `allPaths` แบบแบน ลบข้อมูลซ้ำด้วย resolved absolute path จากนั้น `loadHooks` จะวนซ้ำตามลำดับนั้น ลำดับไฟล์ภายในแต่ละไดเรกทอรีที่ค้นพบขึ้นอยู่กับผลลัพธ์ `readdir` โดย hook loader ไม่ทำการเรียงลำดับเพิ่มเติม

### ลำดับ handler ขณะรันไทม์

ภายใน `HookRunner` ลำดับจะกำหนดแน่นอนตามลำดับการลงทะเบียน:

1. ลำดับ array ของ hook
2. ลำดับการลงทะเบียน handler ต่อ hook/event

พฤติกรรมความขัดแย้งตามประเภท event:

- `tool_call`: ผลลัพธ์ที่คืนค่าล่าสุดชนะ เว้นแต่ handler จะบล็อก; การบล็อกครั้งแรกจะ short-circuit
- `tool_result`: override ที่คืนค่าล่าสุดชนะ (ไม่มี short-circuit)
- `context`: เชื่อมโยงกัน; แต่ละ handler รับผลลัพธ์ข้อความของ handler ก่อนหน้า
- `before_agent_start`: ข้อความแรกที่คืนค่าจะถูกเก็บไว้ ข้อความหลังจากนั้นจะถูกละเว้น
- `session_before_*`: ผลลัพธ์ล่าสุดที่คืนค่าจะถูกติดตาม; `cancel: true` จะ short-circuit ทันที
- `session.compacting`: ผลลัพธ์ล่าสุดที่คืนค่าชนะ

ความขัดแย้งของ Command/renderer:

- `getCommand(name)` คืนค่าการจับคู่แรกในทุก hook (ตัวแรกที่โหลดชนะ)
- `getMessageRenderer(customType)` คืนค่าการจับคู่แรก
- `getRegisteredCommands()` คืนค่าคำสั่งทั้งหมด (ไม่มีการลบข้อมูลซ้ำ)

## การโต้ตอบ UI (`HookContext.ui`)

`HookUIContext` ประกอบด้วย:

- `select`, `confirm`, `input`, `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`, `getEditorText`
- getter `theme`

`ctx.hasUI` ระบุว่า UI แบบ interactive พร้อมใช้งานหรือไม่

เมื่อรันโดยไม่มี UI พฤติกรรม no-op context เริ่มต้นคือ:

- `select/input/editor` คืนค่า `undefined`
- `confirm` คืนค่า `false`
- `notify`, `setStatus`, `setEditorText` เป็น no-op
- `getEditorText` คืนค่า `""`

### พฤติกรรม Status line

ข้อความ hook status ที่ตั้งค่าผ่าน `ctx.ui.setStatus(key, text)` จะ:

- เก็บไว้ต่อ key
- เรียงลำดับตามชื่อ key
- ทำความสะอาด (`\r`, `\n`, `\t` → ช่องว่าง; ช่องว่างซ้ำถูกยุบ)
- รวมและตัดตามความกว้างสำหรับการแสดงผล

## การแพร่กระจายข้อผิดพลาดและ fallback

### ระหว่างการโหลด

- โมดูลไม่ถูกต้องหรือขาด default export → ถูกบันทึกใน `LoadHooksResult.errors`
- การโหลดดำเนินต่อสำหรับ hook อื่น

### ระหว่าง event

`HookRunner.emit(...)` ดักจับข้อผิดพลาดของ handler สำหรับ event ส่วนใหญ่และส่ง `HookError` ไปยัง listener (`hookPath`, `event`, `error`) จากนั้นดำเนินต่อ

`emitToolCall(...)` มีความเข้มงวดกว่า: ข้อผิดพลาดของ handler ไม่ถูกกลืนที่นั่น; ข้อผิดพลาดจะแพร่กระจายไปยัง caller ใน `HookToolWrapper` สิ่งนี้จะบล็อกการเรียกเครื่องมือ (fail-safe)

## ตัวอย่าง API ที่ใช้งานได้จริง

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

### ปิดบังผลลัพธ์เครื่องมือหลังการดำเนินการ

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

### ลงทะเบียน slash command พร้อม context method ที่ปลอดภัยสำหรับคำสั่ง

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

และ package root (`src/index.ts`) re-export **ประเภท** hook เป็นพื้นผิว compatibility แบบ legacy
