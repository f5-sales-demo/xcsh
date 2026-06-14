---
title: เครื่องมือกำหนดเอง
description: >-
  การลงทะเบียนเครื่องมือกำหนดเอง การกำหนดสคีมา
  และไปป์ไลน์การดำเนินการสำหรับการขยายความสามารถของเอเจนต์
sidebar:
  order: 4
  label: เครื่องมือกำหนดเอง
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# เครื่องมือกำหนดเอง

เครื่องมือกำหนดเองคือฟังก์ชันที่โมเดลสามารถเรียกใช้ได้ ซึ่งเชื่อมต่อเข้ากับไปป์ไลน์การดำเนินการเครื่องมือเดียวกันกับเครื่องมือที่มีอยู่ในระบบ

เครื่องมือกำหนดเองคือโมดูล TypeScript/JavaScript ที่ส่งออก factory โดย factory จะรับ host API (`CustomToolAPI`) และส่งคืนเครื่องมือหนึ่งชิ้นหรืออาร์เรย์ของเครื่องมือ

## สิ่งที่เป็น (และไม่เป็น)

- **เครื่องมือกำหนดเอง**: โมเดลสามารถเรียกใช้ได้ระหว่างเทิร์น (`execute` + TypeBox schema)
- **ส่วนขยาย**: เฟรมเวิร์กวงจรชีวิต/อีเวนต์ที่สามารถลงทะเบียนเครื่องมือและสกัดกั้น/แก้ไขอีเวนต์
- **Hook**: สคริปต์ภายนอกที่ทำงานก่อน/หลังคำสั่ง
- **Skill**: แพ็กเกจคำแนะนำ/บริบทแบบสถิต ไม่ใช่โค้ดเครื่องมือที่ดำเนินการได้

หากต้องการให้โมเดลเรียกโค้ดโดยตรง ให้ใช้เครื่องมือกำหนดเอง

## เส้นทางการผสานรวมในโค้ดปัจจุบัน

มีรูปแบบการผสานรวมที่ใช้งานอยู่สองแบบ:

1. **เครื่องมือกำหนดเองที่ SDK จัดให้** (`options.customTools`)
   - ถูกห่อหุ้มเป็นเครื่องมือของเอเจนต์ผ่าน `CustomToolAdapter` หรือตัวห่อหุ้มของส่วนขยาย
   - รวมอยู่ในชุดเครื่องมือที่ใช้งานเริ่มต้นของ SDK bootstrap เสมอ

2. **โมดูลที่ค้นหาจากระบบไฟล์ผ่าน loader API** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - เปิดเผยเป็น library API ใน `src/extensibility/custom-tools/loader.ts`
   - โค้ด host สามารถเรียกใช้สิ่งเหล่านี้เพื่อค้นหาและโหลดโมดูลเครื่องมือจากเส้นทาง config/provider/plugin

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

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` รวมข้อมูลจาก:

1. Capability providers (`toolCapability`) รวมถึง:
   - Native OMP config (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Claude config (`~/.claude/tools`, `.claude/tools`)
   - Codex config (`~/.codex/tools`, `.codex/tools`)
   - Claude marketplace plugin cache provider
2. Installed plugin manifests (`~/.xcsh/plugins/node_modules/*` ผ่าน plugin loader)
3. เส้นทางที่กำหนดค่าอย่างชัดเจนที่ส่งไปยัง loader

### พฤติกรรมที่สำคัญ

- เส้นทางที่แก้ไขแล้วซ้ำกันจะถูกตัดออก
- ความขัดแย้งของชื่อเครื่องมือจะถูกปฏิเสธเมื่อเทียบกับเครื่องมือในระบบและเครื่องมือกำหนดเองที่โหลดไปแล้ว
- ไฟล์ `.md` และ `.json` จะถูกค้นหาเป็นข้อมูลเมตาเครื่องมือโดย provider บางตัว แต่ executable module loader จะปฏิเสธไม่รับเป็นเครื่องมือที่รันได้
- เส้นทางที่กำหนดค่าแบบ relative จะถูกแก้ไขจาก `cwd`; `~` จะถูกขยาย

## สัญญาของโมดูล

โมดูลเครื่องมือกำหนดเองต้องส่งออกฟังก์ชัน (แนะนำให้ใช้ default export):

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

## พื้นผิว API ที่ส่งไปยัง factories (`CustomToolAPI`)

จาก `types.ts` และ `loader.ts`:

- `cwd`: ไดเรกทอรีทำงานของ host
- `exec(command, args, options?)`: ตัวช่วยดำเนินการกระบวนการ
- `ui`: บริบท UI (อาจเป็น no-op ในโหมด headless)
- `hasUI`: `false` ในโฟลว์ที่ไม่โต้ตอบ
- `logger`: shared file logger
- `typebox`: injected `@sinclair/typebox`
- `pi`: injected `@f5xc-salesdemos/xcsh` exports
- `pushPendingAction(action)`: ลงทะเบียน preview action สำหรับ hidden `resolve` tool (`docs/resolve-tool-runtime.md`)

Loader เริ่มต้นด้วย no-op UI context และต้องการให้โค้ด host เรียก `setUIContext(...)` เมื่อ UI จริงพร้อมใช้งาน

## สัญญาการดำเนินการและการกำหนดประเภท

ลายเซ็นของ `CustomTool.execute`:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` ถูกกำหนดประเภทแบบ static จากสคีมา TypeBox ของคุณผ่าน `Static<TParams>`
- การตรวจสอบอาร์กิวเมนต์ขณะรันไทม์เกิดขึ้นก่อนการดำเนินการในลูปของเอเจนต์
- `onUpdate` ส่งผลลัพธ์บางส่วนสำหรับการสตรีม UI
- `ctx` รวมสถานะ session/model และตัวช่วย `abort()`
- `signal` ส่งการยกเลิก

`CustomToolAdapter` เชื่อมต่อสิ่งนี้กับ interface ของเครื่องมือเอเจนต์และส่งต่อการเรียกในลำดับอาร์กิวเมนต์ที่ถูกต้อง

## วิธีที่เครื่องมือถูกเปิดเผยต่อโมเดล

- เครื่องมือถูกห่อหุ้มเป็นอินสแตนซ์ `AgentTool` (`CustomToolAdapter` หรือตัวห่อหุ้มของส่วนขยาย)
- ถูกแทรกเข้าในรีจิสทรีเครื่องมือของ session ตามชื่อ
- ใน SDK bootstrap เครื่องมือกำหนดเองและเครื่องมือที่ลงทะเบียนโดยส่วนขยายจะถูก force-include ในชุดที่ใช้งานเริ่มต้น
- CLI `--tools` ในปัจจุบันตรวจสอบเฉพาะชื่อเครื่องมือในระบบ การรวมเครื่องมือกำหนดเองจัดการผ่านเส้นทางการค้นหา/การลงทะเบียนและตัวเลือก SDK

## Rendering hooks

Rendering hooks ที่เป็นตัวเลือก:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

พฤติกรรมขณะรันไทม์ใน TUI:

- หาก hooks มีอยู่ ผลลัพธ์เครื่องมือจะถูกเรนเดอร์ภายในคอนเทนเนอร์ `Box`
- `renderResult` รับ `{ expanded, isPartial, spinnerFrame? }`
- ข้อผิดพลาดของ renderer จะถูกจับและบันทึก; UI จะย้อนกลับไปใช้การเรนเดอร์ข้อความเริ่มต้น

## การจัดการ Session/State

`onSession(event, ctx)` ที่เป็นตัวเลือกจะรับอีเวนต์วงจรชีวิตของ session รวมถึง:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

ใช้ `ctx.sessionManager` เพื่อสร้างสถานะจากประวัติขึ้นมาใหม่เมื่อบริบท branch/session เปลี่ยนแปลง

## ความล้มเหลวและความหมายของการยกเลิก

### ความล้มเหลวแบบ synchronous/async

- การ throw (หรือ promise ที่ถูกปฏิเสธ) ใน `execute` จะถูกถือว่าเป็นความล้มเหลวของเครื่องมือ
- Agent runtime แปลงความล้มเหลวเป็นข้อความผลลัพธ์เครื่องมือพร้อม `isError: true` และเนื้อหาข้อความแสดงข้อผิดพลาด
- ด้วยตัวห่อหุ้มส่วนขยาย ตัวจัดการ `tool_result` สามารถเขียนเนื้อหา/รายละเอียดใหม่และแม้แต่แทนที่สถานะข้อผิดพลาดได้

### การยกเลิก

- การยกเลิกของเอเจนต์จะแพร่กระจายผ่าน `AbortSignal` ไปยัง `execute`
- ส่ง `signal` ไปยังงานของกระบวนการย่อย (`pi.exec(..., { signal })`) สำหรับการยกเลิกแบบ cooperative
- `ctx.abort()` ให้เครื่องมือขอยกเลิกการดำเนินการของเอเจนต์ปัจจุบัน

### ข้อผิดพลาดของ onSession

- ข้อผิดพลาดของ `onSession` จะถูกจับและบันทึกเป็นคำเตือน โดยจะไม่ทำให้ session พัง

## ข้อจำกัดจริงที่ต้องออกแบบรับมือ

- ชื่อเครื่องมือต้องไม่ซ้ำกันทั่วโลกในรีจิสทรีที่ใช้งาน
- ควรใช้ผลลัพธ์ที่กำหนดรูปแบบตามสคีมาแบบ deterministic ใน `details` สำหรับการสร้างใหม่ของ renderer/state
- ป้องกันการใช้งาน UI ด้วย `pi.hasUI`
- ปฏิบัติต่อ `.md`/`.json` ในไดเรกทอรีเครื่องมือเป็นข้อมูลเมตา ไม่ใช่โมดูลที่ดำเนินการได้
