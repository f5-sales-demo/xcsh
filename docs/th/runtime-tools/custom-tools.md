---
title: Custom Tools
description: >-
  การลงทะเบียน custom tool, การกำหนด schema และ execution pipeline
  สำหรับขยายความสามารถของ agent
sidebar:
  order: 4
  label: Custom tools
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# Custom Tools

Custom tools คือฟังก์ชันที่โมเดลสามารถเรียกใช้ได้ ซึ่งเชื่อมต่อเข้ากับ tool execution pipeline เดียวกันกับ built-in tools

Custom tool คือโมดูล TypeScript/JavaScript ที่ export factory ออกมา โดย factory จะรับ host API (`CustomToolAPI`) และคืนค่าเป็น tool หนึ่งตัวหรือ array ของ tools

## สิ่งที่มันเป็น (และไม่เป็น)

- **Custom tool**: โมเดลสามารถเรียกใช้ได้ระหว่าง turn (`execute` + TypeBox schema)
- **Extension**: framework สำหรับ lifecycle/event ที่สามารถลงทะเบียน tools และดักจับ/แก้ไข events ได้
- **Hook**: สคริปต์คำสั่งภายนอกแบบ pre/post command
- **Skill**: แพ็กเกจ guidance/context แบบ static ไม่ใช่โค้ด tool ที่สามารถรันได้

หากคุณต้องการให้โมเดลเรียกโค้ดโดยตรง ให้ใช้ custom tool

## เส้นทางการผสานรวมในโค้ดปัจจุบัน

มีรูปแบบการผสานรวมที่ใช้งานอยู่สองแบบ:

1. **SDK-provided custom tools** (`options.customTools`)
   - ถูกห่อเป็น agent tools ผ่าน `CustomToolAdapter` หรือ extension wrappers
   - ถูกรวมอยู่ใน initial active tool set เสมอใน SDK bootstrap

2. **Filesystem-discovered modules ผ่าน loader API** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - เปิดใช้งานเป็น library APIs ใน `src/extensibility/custom-tools/loader.ts`
   - โค้ดฝั่ง host สามารถเรียกใช้เพื่อค้นหาและโหลด tool modules จากเส้นทาง config/provider/plugin

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

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` รวม:

1. Capability providers (`toolCapability`) รวมถึง:
   - Native OMP config (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Claude config (`~/.claude/tools`, `.claude/tools`)
   - Codex config (`~/.codex/tools`, `.codex/tools`)
   - Claude marketplace plugin cache provider
2. Installed plugin manifests (`~/.xcsh/plugins/node_modules/*` ผ่าน plugin loader)
3. เส้นทางที่กำหนดค่าไว้อย่างชัดเจนที่ส่งไปยัง loader

### พฤติกรรมที่สำคัญ

- เส้นทางที่ resolve แล้วซ้ำกันจะถูกตัดออก
- ชื่อ tool ที่ขัดแย้งกันจะถูกปฏิเสธเมื่อเทียบกับ built-ins และ custom tools ที่โหลดแล้ว
- ไฟล์ `.md` และ `.json` จะถูกค้นพบเป็น tool metadata โดย providers บางตัว แต่ executable module loader จะปฏิเสธไฟล์เหล่านี้ในฐานะ runnable tools
- เส้นทางที่กำหนดค่าแบบ relative จะถูก resolve จาก `cwd`; `~` จะถูกขยาย

## สัญญาของโมดูล

โมดูล custom tool ต้อง export ฟังก์ชัน (แนะนำให้ใช้ default export):

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

## API surface ที่ส่งไปยัง factories (`CustomToolAPI`)

จาก `types.ts` และ `loader.ts`:

- `cwd`: ไดเรกทอรีทำงานของ host
- `exec(command, args, options?)`: ตัวช่วยสำหรับรันโปรเซส
- `ui`: UI context (สามารถเป็น no-op ในโหมด headless)
- `hasUI`: `false` ใน non-interactive flows
- `logger`: file logger ที่ใช้ร่วมกัน
- `typebox`: `@sinclair/typebox` ที่ถูก inject เข้ามา
- `pi`: exports ของ `@f5xc-salesdemos/xcsh` ที่ถูก inject เข้ามา
- `pushPendingAction(action)`: ลงทะเบียน preview action สำหรับ hidden `resolve` tool (`docs/resolve-tool-runtime.md`)

Loader เริ่มต้นด้วย no-op UI context และต้องการให้โค้ดฝั่ง host เรียก `setUIContext(...)` เมื่อ UI จริงพร้อมใช้งาน

## สัญญาการทำงานและ typing

signature ของ `CustomTool.execute`:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` ถูกกำหนด type แบบ static จาก TypeBox schema ของคุณผ่าน `Static<TParams>`
- การตรวจสอบ argument ที่ runtime จะเกิดขึ้นก่อนการทำงานใน agent loop
- `onUpdate` ส่งผลลัพธ์บางส่วนออกมาสำหรับ UI streaming
- `ctx` รวมถึง session/model state และตัวช่วย `abort()`
- `signal` นำพาการยกเลิก

`CustomToolAdapter` เชื่อมสิ่งนี้กับ agent tool interface และส่งต่อการเรียกในลำดับ argument ที่ถูกต้อง

## วิธีที่ tools ถูกเปิดเผยให้กับโมเดล

- Tools ถูกห่อเป็น `AgentTool` instances (`CustomToolAdapter` หรือ extension wrappers)
- พวกมันถูกแทรกเข้าใน session tool registry ตามชื่อ
- ใน SDK bootstrap, custom และ extension-registered tools จะถูกบังคับรวมอยู่ใน initial active set
- CLI `--tools` ในปัจจุบันตรวจสอบเฉพาะชื่อ built-in tool เท่านั้น; การรวม custom tool จะถูกจัดการผ่านเส้นทาง discovery/registration และตัวเลือก SDK

## Rendering hooks

Rendering hooks แบบ optional:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

พฤติกรรมที่ runtime ใน TUI:

- หาก hooks มีอยู่ ผลลัพธ์ของ tool จะถูกแสดงภายใน `Box` container
- `renderResult` จะรับ `{ expanded, isPartial, spinnerFrame? }`
- ข้อผิดพลาดของ renderer จะถูกจับและบันทึก log; UI จะ fallback ไปใช้การแสดงผลแบบข้อความเริ่มต้น

## การจัดการ Session/state

`onSession(event, ctx)` แบบ optional จะรับ session lifecycle events รวมถึง:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

ใช้ `ctx.sessionManager` เพื่อสร้าง state ขึ้นใหม่จาก history เมื่อ branch/session context เปลี่ยนแปลง

## ความหมายของความล้มเหลวและการยกเลิก

### ความล้มเหลวแบบ synchronous/async

- การ throw (หรือ rejected promises) ใน `execute` จะถูกถือว่าเป็นความล้มเหลวของ tool
- Agent runtime จะแปลงความล้มเหลวเป็น tool result messages ที่มี `isError: true` และเนื้อหาข้อผิดพลาด
- ด้วย extension wrappers, `tool_result` handlers สามารถเขียนทับ content/details เพิ่มเติมและแม้กระทั่ง override สถานะข้อผิดพลาดได้

### การยกเลิก

- การ abort ของ agent จะแพร่กระจายผ่าน `AbortSignal` ไปยัง `execute`
- ส่งต่อ `signal` ไปยังงาน subprocess (`pi.exec(..., { signal })`) สำหรับการยกเลิกแบบ cooperative
- `ctx.abort()` ช่วยให้ tool ร้องขอการ abort ของ agent operation ปัจจุบัน

### ข้อผิดพลาดของ onSession

- ข้อผิดพลาดของ `onSession` จะถูกจับและบันทึกเป็นคำเตือน; จะไม่ทำให้ session ล่ม

## ข้อจำกัดจริงที่ต้องออกแบบรองรับ

- ชื่อ tool ต้องไม่ซ้ำกันทั่วโลกใน active registry
- แนะนำให้ใช้ผลลัพธ์แบบ deterministic ที่มีรูปร่างตาม schema ใน `details` สำหรับการสร้าง renderer/state ขึ้นใหม่
- ป้องกันการใช้งาน UI ด้วย `pi.hasUI`
- ปฏิบัติต่อ `.md`/`.json` ในไดเรกทอรี tool เป็น metadata ไม่ใช่ executable modules
