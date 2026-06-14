---
title: SDK
description: SDK สำหรับสร้าง agent และการผสานรวมแบบกำหนดเองบนรันไทม์ coding agent ของ xcsh
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

SDK คือพื้นผิวการผสานรวมแบบ in-process สำหรับ `@f5xc-salesdemos/xcsh`
ใช้งานเมื่อคุณต้องการเข้าถึงสถานะ agent, การสตรีมเหตุการณ์, การเชื่อมต่อเครื่องมือ และการควบคุม session โดยตรงจากกระบวนการ Bun/Node ของคุณเอง

หากคุณต้องการการแยกข้ามภาษา/กระบวนการ ให้ใช้โหมด RPC แทน

## การติดตั้ง

```bash
bun add @f5xc-salesdemos/xcsh
```

## จุดเข้าถึง

`@f5xc-salesdemos/xcsh` ส่งออก SDK APIs จาก root ของแพ็กเกจ (และยังส่งออกผ่าน `@f5xc-salesdemos/xcsh/sdk` ด้วย)

การส่งออกหลักสำหรับผู้ฝัง:

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- ตัวช่วยค้นหา (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- พื้นผิว tool factory (`createTools`, `BUILTIN_TOOLS`, คลาส tool)

## เริ่มต้นอย่างรวดเร็ว (ค่าเริ่มต้นแบบค้นหาอัตโนมัติ)

```ts
import { createAgentSession } from "@f5xc-salesdemos/xcsh";

const { session, modelFallbackMessage } = await createAgentSession();

if (modelFallbackMessage) {
 process.stderr.write(`${modelFallbackMessage}\n`);
}

const unsubscribe = session.subscribe(event => {
 if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
  process.stdout.write(event.assistantMessageEvent.delta);
 }
});

await session.prompt("Summarize this repository in 3 bullets.");
unsubscribe();
await session.dispose();
```

## สิ่งที่ `createAgentSession()` ค้นหาโดยค่าเริ่มต้น

`createAgentSession()` ทำตามหลักการ "ให้ค่าเพื่อแทนที่ ละเว้นเพื่อค้นหา"

หากละเว้น จะแก้ไขค่าดังนี้:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent` (ผ่าน `getAgentDir()`)
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)` (รองรับไฟล์)
- skills/context files/prompt templates/slash commands/extensions/custom TS commands
- เครื่องมือในตัวผ่าน `createTools(...)`
- เครื่องมือ MCP (เปิดใช้งานโดยค่าเริ่มต้น)
- การผสานรวม LSP (เปิดใช้งานโดยค่าเริ่มต้น)

### ข้อมูลนำเข้าที่จำเป็นและเป็นทางเลือก

โดยทั่วไปคุณต้องระบุเฉพาะสิ่งที่คุณต้องการควบคุม:

- **ต้องระบุ**: ไม่มีสำหรับ session ขั้นต่ำ
- **มักระบุอย่างชัดเจน** ในผู้ฝัง:
    - `sessionManager` (หากคุณต้องการ in-memory หรือตำแหน่งที่กำหนดเอง)
    - `authStorage` + `modelRegistry` (หากคุณเป็นเจ้าของวงจรชีวิตของ credential/model)
    - `model` หรือ `modelPattern` (หากการเลือก model แบบกำหนดตายตัวมีความสำคัญ)
    - `settings` (หากคุณต้องการการกำหนดค่าแบบแยกหรือสำหรับทดสอบ)

## พฤติกรรมของ session manager (แบบถาวร vs in-memory)

`AgentSession` ใช้ `SessionManager` เสมอ; พฤติกรรมขึ้นอยู่กับ factory ที่คุณใช้

### รองรับไฟล์ (ค่าเริ่มต้น)

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absolute .jsonl path
```

- บันทึกการสนทนา/ข้อความ/เดลต้าสถานะไปยังไฟล์ session
- รองรับเวิร์กโฟลว์การกลับมาใช้ต่อ/เปิด/แสดงรายการ/fork
- `session.sessionFile` มีการกำหนดค่าไว้

### In-memory

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- ไม่มีการบันทึกลงระบบไฟล์
- เหมาะสำหรับการทดสอบ, งานชั่วคราว, agent ที่กำหนดขอบเขตตาม request
- เมธอด session ยังคงทำงานได้ แต่พฤติกรรมเฉพาะการบันทึก (เส้นทางการกลับมาใช้ต่อ/fork จากไฟล์) มีข้อจำกัดตามธรรมชาติ

### ตัวช่วย Resume/open/list

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## การเชื่อมต่อ model และ auth

`createAgentSession()` ใช้ `ModelRegistry` + `AuthStorage` สำหรับการเลือก model และการแก้ไข API key

### การเชื่อมต่ออย่างชัดเจน

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
} from "@f5xc-salesdemos/xcsh";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const available = modelRegistry.getAvailable();
if (available.length === 0) throw new Error("No authenticated models available");

const { session } = await createAgentSession({
 authStorage,
 modelRegistry,
 model: available[0],
 thinkingLevel: "medium",
 sessionManager: SessionManager.inMemory(),
});
```

### ลำดับการเลือกเมื่อละเว้น `model`

เมื่อไม่มีการระบุ `model`/`modelPattern` อย่างชัดเจน:

1. กู้คืน model จาก session ที่มีอยู่ (หากสามารถกู้คืนได้ + key พร้อมใช้งาน)
2. บทบาท model เริ่มต้นจากการตั้งค่า (`default`)
3. model แรกที่พร้อมใช้งานซึ่งมี auth ที่ถูกต้อง

หากการกู้คืนล้มเหลว `modelFallbackMessage` จะอธิบายการ fallback

### ลำดับความสำคัญของ Auth

`AuthStorage.getApiKey(...)` แก้ไขในลำดับนี้:

1. การแทนที่รันไทม์ (`setRuntimeApiKey`)
2. ข้อมูลประจำตัวที่จัดเก็บใน `agent.db`
3. ตัวแปรสภาพแวดล้อมของผู้ให้บริการ
4. การ fallback ตัวแก้ไข custom-provider (หากกำหนดค่าไว้)

## โมเดลการสมัครรับเหตุการณ์

สมัครรับด้วย `session.subscribe(listener)`; จะคืนฟังก์ชัน unsubscribe

```ts
const unsubscribe = session.subscribe(event => {
 switch (event.type) {
  case "agent_start":
  case "turn_start":
  case "tool_execution_start":
   break;
  case "message_update":
   if (event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
   }
   break;
 }
});
```

`AgentSessionEvent` ประกอบด้วย `AgentEvent` หลักบวกกับเหตุการณ์ระดับ session:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## วงจรชีวิตของ Prompt

`session.prompt(text, options?)` คือจุดเข้าถึงหลัก

พฤติกรรม:

1. การขยายคำสั่ง/template ที่เป็นทางเลือก (คำสั่ง `/`, คำสั่งกำหนดเอง, คำสั่ง slash จากไฟล์, prompt templates)
2. หากกำลังสตรีมอยู่:
    - ต้องการ `streamingBehavior: "steer" | "followUp"`
    - จัดคิวแทนที่จะทิ้งงาน
3. หากไม่ได้ใช้งาน:
    - ตรวจสอบ model + API key
    - เพิ่มข้อความผู้ใช้
    - เริ่ม agent turn

API ที่เกี่ยวข้อง:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## การผสานรวมเครื่องมือและส่วนขยาย

### เครื่องมือในตัวและการกรอง

- เครื่องมือในตัวมาจาก `createTools(...)` และ `BUILTIN_TOOLS`
- `toolNames` ทำหน้าที่เป็น allowlist สำหรับเครื่องมือในตัว
- `customTools` และเครื่องมือที่ลงทะเบียนผ่านส่วนขยายยังคงรวมอยู่
- เครื่องมือที่ซ่อนอยู่ (เช่น `submit_result`) ต้องเปิดใช้งานอย่างชัดเจน เว้นแต่จะถูกกำหนดโดย options

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### ส่วนขยาย

- `extensions`: `ExtensionFactory[]` แบบ inline
- `additionalExtensionPaths`: โหลดไฟล์ส่วนขยายเพิ่มเติม
- `disableExtensionDiscovery`: ปิดการสแกนส่วนขยายอัตโนมัติ
- `preloadedExtensions`: ใช้ชุดส่วนขยายที่โหลดไว้แล้วซ้ำ

### การเปลี่ยนแปลงชุดเครื่องมือรันไทม์

`AgentSession` รองรับการอัปเดตการเปิดใช้งานรันไทม์:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

System prompt จะถูกสร้างใหม่เพื่อสะท้อนการเปลี่ยนแปลงเครื่องมือที่ใช้งานอยู่

## ตัวช่วยค้นหา

ใช้สิ่งเหล่านี้เมื่อคุณต้องการการควบคุมบางส่วนโดยไม่ต้องสร้างตรรกะการค้นหาภายในใหม่:

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## ตัวเลือกสำหรับ Subagent

สำหรับผู้บริโภค SDK ที่สร้าง orchestrator (คล้ายกับโฟลว์ตัวดำเนินการงาน):

- `outputSchema`: ส่งความคาดหวังผลลัพธ์แบบมีโครงสร้างเข้าไปใน tool context
- `requireSubmitResultTool`: บังคับให้รวมเครื่องมือ `submit_result`
- `taskDepth`: บริบทความลึกของการเรียกซ้ำสำหรับ session งานที่ซ้อนกัน
- `parentTaskPrefix`: คำนำหน้าการตั้งชื่อ artifact สำหรับผลลัพธ์งานที่ซ้อนกัน

สิ่งเหล่านี้เป็นทางเลือกสำหรับการฝัง single-agent ปกติ

## ค่าที่ส่งคืนของ `createAgentSession()`

```ts
type CreateAgentSessionResult = {
 session: AgentSession;
 extensionsResult: LoadExtensionsResult;
 setToolUIContext: (uiContext: ExtensionUIContext, hasUI: boolean) => void;
 mcpManager?: MCPManager;
 modelFallbackMessage?: string;
 lspServers?: Array<{ name: string; status: "ready" | "error"; fileTypes: string[]; error?: string }>;
};
```

ใช้ `setToolUIContext(...)` เฉพาะเมื่อผู้ฝังของคุณมีความสามารถด้าน UI ที่เครื่องมือ/ส่วนขยายควรเรียกใช้

## ตัวอย่างการฝังแบบควบคุมขั้นต่ำ

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
 Settings,
} from "@f5xc-salesdemos/xcsh";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const settings = Settings.isolated({
 "compaction.enabled": true,
 "retry.enabled": true,
});

const { session } = await createAgentSession({
 authStorage,
 modelRegistry,
 settings,
 sessionManager: SessionManager.inMemory(),
 toolNames: ["read", "grep", "find", "edit", "write"],
 enableMCP: false,
 enableLsp: true,
});

session.subscribe(event => {
 if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
  process.stdout.write(event.assistantMessageEvent.delta);
 }
});

await session.prompt("Find all TODO comments in this repo and propose fixes.");
await session.dispose();
```
