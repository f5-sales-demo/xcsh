---
title: เครื่องมือกำหนดเอง
description: >-
  การลงทะเบียนเครื่องมือกำหนดเอง การกำหนด schema และ pipeline
  การดำเนินการสำหรับการขยายความสามารถของ agent
sidebar:
  order: 4
  label: เครื่องมือกำหนดเอง
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# เครื่องมือกำหนดเอง

เครื่องมือกำหนดเองคือฟังก์ชันที่โมเดลสามารถเรียกใช้ได้ ซึ่งเชื่อมต่อเข้ากับ pipeline การดำเนินการเครื่องมือเดียวกันกับเครื่องมือในตัว

เครื่องมือกำหนดเองคือโมดูล TypeScript/JavaScript ที่ export factory ออกมา โดย factory จะรับ host API (`CustomToolAPI`) และคืนค่าเป็นเครื่องมือหนึ่งตัวหรืออาร์เรย์ของเครื่องมือ

## สิ่งที่นี่เป็น (และไม่ใช่)

- **เครื่องมือกำหนดเอง**: โมเดลสามารถเรียกใช้ได้ระหว่างเทิร์น (`execute` + TypeBox schema)
- **Extension**: เฟรมเวิร์ก lifecycle/event ที่สามารถลงทะเบียนเครื่องมือและสกัดกั้น/แก้ไข event ได้
- **Hook**: สคริปต์คำสั่งภายนอกแบบ pre/post
- **Skill**: แพ็คเกจ guidance/context แบบ static ไม่ใช่โค้ดเครื่องมือที่รันได้

หากคุณต้องการให้โมเดลเรียกใช้โค้ดโดยตรง ให้ใช้เครื่องมือกำหนดเอง

## เส้นทางการผสานรวมในโค้ดปัจจุบัน

มีรูปแบบการผสานรวมที่ใช้งานอยู่สองแบบ:

1. **เครื่องมือกำหนดเองที่จัดเตรียมโดย SDK** (`options.customTools`)
   - ถูก wrap เป็น agent tools ผ่าน `CustomToolAdapter` หรือ extension wrappers
   - รวมอยู่ในชุดเครื่องมือที่ใช้งานเริ่มต้นเสมอในขั้นตอน SDK bootstrap

2. **โมดูลที่ค้นพบจากระบบไฟล์ผ่าน loader API** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - เปิดเผยเป็น library APIs ใน `src/extensibility/custom-tools/loader.ts`
   - โค้ดฝั่ง host สามารถเรียกใช้สิ่งเหล่านี้เพื่อค้นพบและโหลดโมดูลเครื่องมือจากเส้นทาง config/provider/plugin

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

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` รวม:

1. Capability providers (`toolCapability`) ซึ่งรวมถึง:
   - การกำหนดค่า OMP แบบ native (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - การกำหนดค่า Claude (`~/.claude/tools`, `.claude/tools`)
   - การกำหนดค่า Codex (`~/.codex/tools`, `.codex/tools`)
   - Claude marketplace plugin cache provider
2. Manifest ของปลั๊กอินที่ติดตั้งแล้ว (`~/.xcsh/plugins/node_modules/*` ผ่าน plugin loader)
3. เส้นทางที่กำหนดค่าอย่างชัดเจนที่ส่งเข้า loader

### พฤติกรรมที่สำคัญ

- เส้นทางที่ resolve แล้วซ้ำกันจะถูกตัดออกให้เหลือไม่ซ้ำ
- ความขัดแย้งของชื่อเครื่องมือจะถูกปฏิเสธเมื่อขัดกับเครื่องมือในตัวและเครื่องมือกำหนดเองที่โหลดแล้ว
- ไฟล์ `.md` และ `.json` จะถูกค้นพบเป็นข้อมูลเมตาของเครื่องมือโดย provider บางตัว แต่ตัวโหลดโมดูลที่รันได้จะปฏิเสธไฟล์เหล่านี้ในฐานะเครื่องมือที่รันได้
- เส้นทางที่กำหนดค่าแบบสัมพัทธ์จะถูก resolve จาก `cwd`; `~` จะถูกขยาย

## สัญญาของโมดูล

โมดูลเครื่องมือกำหนดเองต้อง export ฟังก์ชัน (แนะนำให้ใช้ default export):

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

ประเภทที่ factory คืนค่า:

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## พื้นผิว API ที่ส่งให้ factories (`CustomToolAPI`)

จาก `types.ts` และ `loader.ts`:

- `cwd`: ไดเรกทอรีทำงานของ host
- `exec(command, args, options?)`: ตัวช่วยดำเนินการ process
- `ui`: UI context (สามารถเป็น no-op ในโหมด headless)
- `hasUI`: `false` ในโฟลว์ที่ไม่ใช่ interactive
- `logger`: file logger ที่ใช้ร่วมกัน
- `typebox`: `@sinclair/typebox` ที่ถูก inject เข้ามา
- `pi`: exports ของ `@f5xc-salesdemos/xcsh` ที่ถูก inject เข้ามา
- `pushPendingAction(action)`: ลงทะเบียน preview action สำหรับ `resolve` tool ที่ซ่อนอยู่ (`docs/resolve-tool-runtime.md`)

Loader เริ่มต้นด้วย UI context แบบ no-op และต้องการให้โค้ดฝั่ง host เรียก `setUIContext(...)` เมื่อ UI จริงพร้อมใช้งาน

## สัญญาการดำเนินการและการกำหนดประเภท

ลายเซ็นของ `CustomTool.execute`:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` มีประเภทแบบ static จาก TypeBox schema ของคุณผ่าน `Static<TParams>`
- การตรวจสอบอาร์กิวเมนต์ขณะรันเกิดขึ้นก่อนการดำเนินการใน agent loop
- `onUpdate` ส่งผลลัพธ์บางส่วนสำหรับการสตรีม UI
- `ctx` รวมถึงสถานะ session/model และตัวช่วย `abort()`
- `signal` ส่งการยกเลิก

`CustomToolAdapter` เชื่อมสิ่งนี้กับอินเทอร์เฟซ agent tool และส่งต่อการเรียกในลำดับอาร์กิวเมนต์ที่ถูกต้อง

## วิธีที่เครื่องมือถูกเปิดเผยให้โมเดล

- เครื่องมือถูก wrap เป็นอินสแตนซ์ `AgentTool` (`CustomToolAdapter` หรือ extension wrappers)
- เครื่องมือถูกแทรกเข้าใน session tool registry ตามชื่อ
- ในขั้นตอน SDK bootstrap เครื่องมือที่ลงทะเบียนโดย custom และ extension จะถูกบังคับรวมในชุดที่ใช้งานเริ่มต้น
- CLI `--tools` ในปัจจุบันตรวจสอบเฉพาะชื่อเครื่องมือในตัว; การรวมเครื่องมือกำหนดเองจะถูกจัดการผ่านเส้นทางการค้นพบ/ลงทะเบียนและตัวเลือก SDK

## Hook การแสดงผล

Hook การแสดงผลแบบเลือกได้:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

พฤติกรรมขณะรันใน TUI:

- หากมี hook อยู่ ผลลัพธ์ของเครื่องมือจะถูกแสดงผลภายในคอนเทนเนอร์ `Box`
- `renderResult` รับ `{ expanded, isPartial, spinnerFrame? }`
- ข้อผิดพลาดของ renderer จะถูกจับและบันทึก; UI จะถอยกลับไปใช้การแสดงผลข้อความเริ่มต้น

## การจัดการ session/state

`onSession(event, ctx)` แบบเลือกได้จะรับ event lifecycle ของ session ซึ่งรวมถึง:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

ใช้ `ctx.sessionManager` เพื่อสร้าง state ขึ้นใหม่จากประวัติเมื่อ branch/session context เปลี่ยนแปลง

## ความหมายของความล้มเหลวและการยกเลิก

### ความล้มเหลวแบบ synchronous/async

- การ throw (หรือ promise ที่ถูก reject) ใน `execute` จะถูกถือว่าเป็นความล้มเหลวของเครื่องมือ
- Agent runtime จะแปลงความล้มเหลวเป็นข้อความผลลัพธ์เครื่องมือที่มี `isError: true` และเนื้อหาข้อความข้อผิดพลาด
- ด้วย extension wrappers ตัวจัดการ `tool_result` สามารถเขียนเนื้อหา/รายละเอียดใหม่เพิ่มเติมและแม้แต่แทนที่สถานะข้อผิดพลาด

### การยกเลิก

- การ abort ของ agent จะแพร่กระจายผ่าน `AbortSignal` ไปยัง `execute`
- ส่งต่อ `signal` ไปยังงาน subprocess (`pi.exec(..., { signal })`) เพื่อการยกเลิกแบบร่วมมือ
- `ctx.abort()` ช่วยให้เครื่องมือร้องขอการ abort ของการดำเนินการ agent ปัจจุบัน

### ข้อผิดพลาดของ onSession

- ข้อผิดพลาดของ `onSession` จะถูกจับและบันทึกเป็นคำเตือน; ไม่ทำให้ session หยุดทำงาน

## ข้อจำกัดที่ต้องออกแบบรองรับ

- ชื่อเครื่องมือต้องไม่ซ้ำกันทั่วโลกใน registry ที่ใช้งานอยู่
- แนะนำให้ใช้ผลลัพธ์ที่กำหนดได้แน่นอนและมีรูปแบบตาม schema ใน `details` เพื่อการแสดงผล/สร้าง state ขึ้นใหม่
- ป้องกันการใช้งาน UI ด้วย `pi.hasUI`
- ถือว่า `.md`/`.json` ในไดเรกทอรีเครื่องมือเป็นข้อมูลเมตา ไม่ใช่โมดูลที่รันได้
