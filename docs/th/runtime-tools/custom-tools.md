---
title: เครื่องมือที่กำหนดเอง
description: >-
  การลงทะเบียนเครื่องมือที่กำหนดเอง การกำหนดสคีมา
  และกระบวนการประมวลผลสำหรับการขยายความสามารถของ agent
sidebar:
  order: 4
  label: เครื่องมือที่กำหนดเอง
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# เครื่องมือที่กำหนดเอง

เครื่องมือที่กำหนดเองคือฟังก์ชันที่โมเดลสามารถเรียกใช้ได้ ซึ่งเชื่อมต่อเข้ากับกระบวนการประมวลผลเครื่องมือเดียวกันกับเครื่องมือที่มีอยู่ในตัว

เครื่องมือที่กำหนดเองคือโมดูล TypeScript/JavaScript ที่ส่งออก factory โดย factory จะรับ host API (`CustomToolAPI`) และส่งคืนเครื่องมือหนึ่งชิ้นหรืออาร์เรย์ของเครื่องมือ

## สิ่งที่เป็น (และไม่ใช่)

- **เครื่องมือที่กำหนดเอง**: สามารถเรียกใช้โดยโมเดลระหว่างรอบการทำงาน (`execute` + TypeBox schema)
- **ส่วนขยาย**: กรอบงานวงจรชีวิต/เหตุการณ์ที่สามารถลงทะเบียนเครื่องมือและสกัดกั้น/ปรับเปลี่ยนเหตุการณ์ได้
- **Hook**: สคริปต์คำสั่งภายนอกก่อน/หลังการทำงาน
- **Skill**: แพ็กเกจแนวทาง/บริบทแบบคงที่ ไม่ใช่โค้ดเครื่องมือที่ประมวลผลได้

หากต้องการให้โมเดลเรียกใช้โค้ดโดยตรง ให้ใช้เครื่องมือที่กำหนดเอง

## รูปแบบการผสานรวมในโค้ดปัจจุบัน

มีรูปแบบการผสานรวมที่ใช้งานอยู่สองแบบ:

1. **เครื่องมือที่กำหนดเองที่ SDK จัดเตรียมให้** (`options.customTools`)
   - ถูกรวมเข้าเป็นเครื่องมือ agent ผ่าน `CustomToolAdapter` หรือ extension wrappers
   - รวมอยู่ใน active tool set เริ่มต้นเสมอใน SDK bootstrap

2. **โมดูลที่ค้นพบจากระบบไฟล์ผ่าน loader API** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - เปิดเผยเป็น library API ใน `src/extensibility/custom-tools/loader.ts`
   - โค้ดฝั่ง host สามารถเรียกใช้เพื่อค้นพบและโหลดโมดูลเครื่องมือจากพาธของ config/provider/plugin

```text
Model tool call flow

LLM tool call
   │
   ▼
Tool registry (built-ins + custom tool adapters)
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> streamed partial result
   └─ return result  -> final tool content/details
```

## ตำแหน่งการค้นพบ (loader API)

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` รวมจาก:

1. Capability providers (`toolCapability`) ได้แก่:
   - Native OMP config (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Claude config (`~/.claude/tools`, `.claude/tools`)
   - Codex config (`~/.codex/tools`, `.codex/tools`)
   - Claude marketplace plugin cache provider
2. Installed plugin manifests (`~/.xcsh/plugins/node_modules/*` ผ่าน plugin loader)
3. พาธที่กำหนดค่าไว้อย่างชัดเจนที่ส่งให้ loader

### พฤติกรรมที่สำคัญ

- พาธที่แก้ไขซ้ำกันจะถูกกำจัดออก
- ชื่อเครื่องมือที่ขัดแย้งกันจะถูกปฏิเสธเมื่อซ้ำกับ built-ins และเครื่องมือที่กำหนดเองที่โหลดไว้แล้ว
- ไฟล์ `.md` และ `.json` จะถูกค้นพบเป็น tool metadata โดย provider บางส่วน แต่ executable module loader จะปฏิเสธไม่ให้รันเป็นเครื่องมือ
- พาธที่กำหนดค่าแบบ relative จะถูกแก้ไขจาก `cwd`; `~` จะถูกขยาย

## สัญญาของโมดูล

โมดูลเครื่องมือที่กำหนดเองต้องส่งออกฟังก์ชัน (แนะนำให้ใช้ default export):

```ts
import type { CustomToolFactory } from "@f5xc-salesdemos/xcsh";

const factory: CustomToolFactory = (pi) => ({
 name: "repo_stats",
 label: "Repo Stats",
 description: "Counts tracked TypeScript files",
 parameters: pi.typebox.Type.Object({
  glob: pi.typebox.Type.Optional(pi.typebox.Type.String({ default: "**/*.ts" })),
 }),

 async execute(toolCallId, params, onUpdate, ctx, signal) {
  onUpdate?.({
   content: [{ type: "text", text: "Scanning files..." }],
   details: { phase: "scan" },
  });

  const result = await pi.exec("git", ["ls-files", params.glob ?? "**/*.ts"], { signal, cwd: pi.cwd });
  if (result.killed) {
   throw new Error("Scan was cancelled");
  }
  if (result.code !== 0) {
   throw new Error(result.stderr || "git ls-files failed");
  }

  const files = result.stdout.split("\n").filter(Boolean);
  return {
   content: [{ type: "text", text: `Found ${files.length} files` }],
   details: { count: files.length, sample: files.slice(0, 10) },
  };
 },

 onSession(event) {
  if (event.reason === "shutdown") {
   // cleanup resources if needed
  }
 },
});

export default factory;
```

ประเภทที่ส่งคืนจาก factory:

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## พื้นผิว API ที่ส่งให้ factories (`CustomToolAPI`)

จาก `types.ts` และ `loader.ts`:

- `cwd`: working directory ของ host
- `exec(command, args, options?)`: ตัวช่วยประมวลผล process
- `ui`: UI context (อาจเป็น no-op ในโหมด headless)
- `hasUI`: `false` ในกระบวนการที่ไม่โต้ตอบ
- `logger`: shared file logger
- `typebox`: `@sinclair/typebox` ที่ inject มาให้
- `pi`: exports ของ `@f5xc-salesdemos/xcsh` ที่ inject มาให้
- `pushPendingAction(action)`: ลงทะเบียน preview action สำหรับ `resolve` tool ที่ซ่อนอยู่ (`docs/resolve-tool-runtime.md`)

Loader เริ่มต้นด้วย no-op UI context และต้องการให้โค้ดฝั่ง host เรียก `setUIContext(...)` เมื่อ UI จริงพร้อมใช้งาน

## สัญญาการประมวลผลและการกำหนดประเภท

ลายเซ็นของ `CustomTool.execute`:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` มีการกำหนดประเภทแบบ static จาก TypeBox schema ผ่าน `Static<TParams>`
- การตรวจสอบความถูกต้องของอาร์กิวเมนต์ที่รันไทม์เกิดขึ้นก่อนการประมวลผลใน agent loop
- `onUpdate` ส่งผลลัพธ์บางส่วนสำหรับ UI streaming
- `ctx` รวม session/model state และตัวช่วย `abort()`
- `signal` รับการยกเลิก

`CustomToolAdapter` เชื่อมต่อสิ่งนี้กับอินเทอร์เฟซเครื่องมือ agent และส่งต่อการเรียกในลำดับอาร์กิวเมนต์ที่ถูกต้อง

## วิธีการเปิดเผยเครื่องมือให้โมเดล

- เครื่องมือถูกรวมเข้าเป็น `AgentTool` instances (`CustomToolAdapter` หรือ extension wrappers)
- ถูกแทรกเข้าใน session tool registry ตามชื่อ
- ใน SDK bootstrap เครื่องมือที่กำหนดเองและที่ลงทะเบียนผ่าน extension จะถูกบังคับรวมใน active set เริ่มต้น
- CLI `--tools` ในปัจจุบันตรวจสอบเฉพาะชื่อเครื่องมือ built-in; การรวมเครื่องมือที่กำหนดเองจัดการผ่านพาธการค้นพบ/การลงทะเบียนและ SDK options

## Rendering hooks

Rendering hooks ที่ไม่บังคับ:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

พฤติกรรมรันไทม์ใน TUI:

- หาก hook มีอยู่ output ของเครื่องมือจะถูก render ภายในคอนเทนเนอร์ `Box`
- `renderResult` รับ `{ expanded, isPartial, spinnerFrame? }`
- ข้อผิดพลาดของ renderer จะถูกจับและบันทึก; UI จะ fallback ไปยังการ render ข้อความเริ่มต้น

## การจัดการ session/state

`onSession(event, ctx)` ที่ไม่บังคับจะรับเหตุการณ์วงจรชีวิต session รวมถึง:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

ใช้ `ctx.sessionManager` เพื่อสร้าง state จาก history ใหม่เมื่อบริบท branch/session เปลี่ยนแปลง

## ความล้มเหลวและความหมายของการยกเลิก

### ความล้มเหลวแบบ synchronous/async

- การ throw (หรือ rejected promises) ใน `execute` ถือเป็นความล้มเหลวของเครื่องมือ
- Agent runtime แปลงความล้มเหลวเป็น tool result messages ที่มี `isError: true` และเนื้อหาข้อผิดพลาด
- ด้วย extension wrappers, `tool_result` handlers สามารถเขียน content/details ใหม่ และแม้แต่แทนที่สถานะข้อผิดพลาดได้

### การยกเลิก

- Agent abort จะแพร่กระจายผ่าน `AbortSignal` ไปยัง `execute`
- ส่ง `signal` ต่อไปยังการทำงานของ subprocess (`pi.exec(..., { signal })`) เพื่อการยกเลิกแบบร่วมมือ
- `ctx.abort()` ให้เครื่องมือร้องขอการ abort ของ agent operation ปัจจุบันได้

### ข้อผิดพลาดของ onSession

- ข้อผิดพลาดของ `onSession` จะถูกจับและบันทึกเป็นคำเตือน โดยจะไม่ทำให้ session หยุดทำงาน

## ข้อจำกัดจริงที่ต้องออกแบบรองรับ

- ชื่อเครื่องมือต้องไม่ซ้ำกันทั่วทั้ง active registry
- แนะนำให้ใช้ output ที่กำหนดรูปแบบตาม schema แบบ deterministic ใน `details` สำหรับการ render/สร้าง state ใหม่
- ป้องกันการใช้งาน UI ด้วย `pi.hasUI`
- ถือว่าไฟล์ `.md`/`.json` ในไดเรกทอรีเครื่องมือเป็น metadata ไม่ใช่โมดูลที่ประมวลผลได้
