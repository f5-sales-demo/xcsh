---
title: Custom Tools
description: >-
  การลงทะเบียนเครื่องมือแบบกำหนดเอง การกำหนด schema
  และไปป์ไลน์การดำเนินงานสำหรับการขยายความสามารถของ agent
sidebar:
  order: 4
  label: Custom tools
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# เครื่องมือแบบกำหนดเอง (Custom Tools)

เครื่องมือแบบกำหนดเองคือฟังก์ชันที่โมเดลสามารถเรียกใช้ได้ ซึ่งเชื่อมต่อเข้ากับไปป์ไลน์การดำเนินงานเครื่องมือเดียวกันกับเครื่องมือที่มีอยู่ในระบบ

เครื่องมือแบบกำหนดเองคือโมดูล TypeScript/JavaScript ที่ export factory ฟังก์ชัน โดย factory จะรับ host API (`CustomToolAPI`) และส่งคืนเครื่องมือหนึ่งตัวหรืออาร์เรย์ของเครื่องมือ

## สิ่งนี้คืออะไร (และไม่ใช่อะไร)

- **Custom tool**: เรียกใช้โดยโมเดลระหว่างรอบการทำงาน (`execute` + TypeBox schema)
- **Extension**: เฟรมเวิร์ก lifecycle/event ที่สามารถลงทะเบียนเครื่องมือและดักจับ/แก้ไข event ได้
- **Hook**: สคริปต์คำสั่งภายนอกที่ทำงานก่อน/หลัง
- **Skill**: แพ็คเกจ guidance/context แบบสถิต ไม่ใช่โค้ดเครื่องมือที่สามารถดำเนินงานได้

หากคุณต้องการให้โมเดลเรียกใช้โค้ดโดยตรง ให้ใช้เครื่องมือแบบกำหนดเอง

## เส้นทางการรวมระบบในโค้ดปัจจุบัน

มีรูปแบบการรวมระบบที่ใช้งานอยู่สองแบบ:

1. **เครื่องมือแบบกำหนดเองที่ SDK จัดเตรียมให้** (`options.customTools`)
   - ถูกห่อหุ้มเข้าเป็นเครื่องมือ agent ผ่าน `CustomToolAdapter` หรือ extension wrappers
   - ถูกรวมอยู่ในชุดเครื่องมือที่ใช้งานเริ่มต้นเสมอใน SDK bootstrap

2. **โมดูลที่ค้นพบจากระบบไฟล์ผ่าน loader API** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - เปิดเผยเป็น library API ใน `src/extensibility/custom-tools/loader.ts`
   - โค้ดโฮสต์สามารถเรียกใช้เพื่อค้นหาและโหลดโมดูลเครื่องมือจากเส้นทาง config/provider/plugin

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

## ตำแหน่งการค้นหา (loader API)

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` รวมจาก:

1. Capability providers (`toolCapability`) รวมถึง:
   - Native OMP config (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Claude config (`~/.claude/tools`, `.claude/tools`)
   - Codex config (`~/.codex/tools`, `.codex/tools`)
   - Claude marketplace plugin cache provider
2. ไฟล์ manifest ของปลั๊กอินที่ติดตั้งแล้ว (`~/.xcsh/plugins/node_modules/*` ผ่าน plugin loader)
3. เส้นทางที่กำหนดค่าอย่างชัดเจนที่ส่งไปยัง loader

### พฤติกรรมสำคัญ

- เส้นทางที่ resolve แล้วซ้ำกันจะถูกตัดออก
- ชื่อเครื่องมือที่ขัดแย้งจะถูกปฏิเสธเมื่อเทียบกับเครื่องมือในระบบและเครื่องมือแบบกำหนดเองที่โหลดไปแล้ว
- ไฟล์ `.md` และ `.json` จะถูกค้นพบเป็น metadata ของเครื่องมือโดย provider บางตัว แต่ตัวโหลดโมดูลที่ดำเนินงานได้จะปฏิเสธไฟล์เหล่านี้ในฐานะเครื่องมือที่สามารถรันได้
- เส้นทางที่กำหนดค่าแบบ relative จะถูก resolve จาก `cwd`; `~` จะถูกขยาย

## สัญญาของโมดูล

โมดูลเครื่องมือแบบกำหนดเองต้อง export ฟังก์ชัน (แนะนำให้ใช้ default export):

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

ประเภทที่ส่งคืนจาก Factory:

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## พื้นผิว API ที่ส่งไปยัง factories (`CustomToolAPI`)

จาก `types.ts` และ `loader.ts`:

- `cwd`: ไดเรกทอรีการทำงานของโฮสต์
- `exec(command, args, options?)`: ตัวช่วยในการดำเนินงานกระบวนการ
- `ui`: UI context (อาจเป็น no-op ในโหมด headless)
- `hasUI`: `false` ในขั้นตอนที่ไม่มีการโต้ตอบ
- `logger`: file logger ที่ใช้ร่วมกัน
- `typebox`: `@sinclair/typebox` ที่ถูก inject เข้ามา
- `pi`: export ของ `@f5xc-salesdemos/xcsh` ที่ถูก inject เข้ามา
- `pushPendingAction(action)`: ลงทะเบียน preview action สำหรับเครื่องมือ `resolve` ที่ซ่อนอยู่ (`docs/resolve-tool-runtime.md`)

Loader เริ่มต้นด้วย no-op UI context และต้องการให้โค้ดโฮสต์เรียก `setUIContext(...)` เมื่อ UI จริงพร้อมใช้งาน

## สัญญาการดำเนินงานและ typing

ลายเซ็นของ `CustomTool.execute`:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` มี static type จาก TypeBox schema ของคุณผ่าน `Static<TParams>`
- การตรวจสอบอาร์กิวเมนต์ที่ runtime เกิดขึ้นก่อนการดำเนินงานในลูปของ agent
- `onUpdate` ปล่อยผลลัพธ์บางส่วนสำหรับการสตรีม UI
- `ctx` รวมถึงสถานะ session/model และตัวช่วย `abort()`
- `signal` ส่งต่อการยกเลิก

`CustomToolAdapter` เชื่อมต่อสิ่งนี้ไปยังอินเทอร์เฟซเครื่องมือของ agent และส่งต่อการเรียกในลำดับอาร์กิวเมนต์ที่ถูกต้อง

## วิธีที่เครื่องมือถูกเปิดเผยให้โมเดล

- เครื่องมือถูกห่อหุ้มเป็นอินสแตนซ์ `AgentTool` (`CustomToolAdapter` หรือ extension wrappers)
- เครื่องมือถูกแทรกเข้าไปใน registry เครื่องมือของ session ตามชื่อ
- ใน SDK bootstrap เครื่องมือที่ลงทะเบียนผ่าน custom และ extension จะถูกบังคับรวมไว้ในชุดที่ใช้งานเริ่มต้น
- CLI `--tools` ในปัจจุบันตรวจสอบเฉพาะชื่อเครื่องมือในระบบ; การรวมเครื่องมือแบบกำหนดเองจะถูกจัดการผ่านเส้นทางการค้นหา/ลงทะเบียนและตัวเลือก SDK

## Rendering hooks

Rendering hooks ที่เป็นทางเลือก:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

พฤติกรรมที่ runtime ใน TUI:

- หาก hooks มีอยู่ ผลลัพธ์ของเครื่องมือจะถูกแสดงผลภายใน `Box` container
- `renderResult` ได้รับ `{ expanded, isPartial, spinnerFrame? }`
- ข้อผิดพลาดของ renderer จะถูกจับและบันทึก; UI จะกลับไปใช้การแสดงผลข้อความเริ่มต้น

## การจัดการ session/state

`onSession(event, ctx)` ที่เป็นทางเลือกจะได้รับ event lifecycle ของ session รวมถึง:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

ใช้ `ctx.sessionManager` เพื่อสร้างสถานะขึ้นใหม่จากประวัติเมื่อบริบท branch/session เปลี่ยนแปลง

## ความหมายของความล้มเหลวและการยกเลิก

### ความล้มเหลวแบบ synchronous/async

- การ throw (หรือ rejected promises) ใน `execute` จะถูกถือว่าเป็นความล้มเหลวของเครื่องมือ
- Agent runtime จะแปลงความล้มเหลวเป็นข้อความผลลัพธ์ของเครื่องมือที่มี `isError: true` และเนื้อหาข้อความข้อผิดพลาด
- ด้วย extension wrappers ตัวจัดการ `tool_result` สามารถเขียนทับเนื้อหา/รายละเอียดเพิ่มเติม และแม้แต่แทนที่สถานะข้อผิดพลาดได้

### การยกเลิก

- การ abort ของ agent จะแพร่กระจายผ่าน `AbortSignal` ไปยัง `execute`
- ส่งต่อ `signal` ไปยังงาน subprocess (`pi.exec(..., { signal })`) สำหรับการยกเลิกแบบร่วมมือ
- `ctx.abort()` ให้เครื่องมือร้องขอการ abort ของการดำเนินงาน agent ปัจจุบัน

### ข้อผิดพลาดของ onSession

- ข้อผิดพลาดของ `onSession` จะถูกจับและบันทึกเป็นคำเตือน; จะไม่ทำให้ session หยุดทำงาน

## ข้อจำกัดจริงที่ควรออกแบบรองรับ

- ชื่อเครื่องมือต้องไม่ซ้ำกันทั่วทั้ง registry ที่ใช้งานอยู่
- ควรใช้ผลลัพธ์ที่มีรูปร่างตาม schema แบบ deterministic ใน `details` สำหรับการสร้าง renderer/state ขึ้นใหม่
- ปกป้องการใช้งาน UI ด้วย `pi.hasUI`
- ถือว่าไฟล์ `.md`/`.json` ในไดเรกทอรีเครื่องมือเป็น metadata ไม่ใช่โมดูลที่ดำเนินงานได้
