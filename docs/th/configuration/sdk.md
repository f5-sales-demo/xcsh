---
title: SDK
description: SDK สำหรับสร้าง agent และการผสานรวมแบบกำหนดเองบนรันไทม์ของ xcsh coding agent
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

SDK เป็นพื้นผิวการผสานรวมภายในกระบวนการสำหรับ `@f5xc-salesdemos/xcsh`
ใช้เมื่อคุณต้องการเข้าถึงสถานะของ agent, การสตรีมเหตุการณ์, การเชื่อมต่อเครื่องมือ และการควบคุมเซสชันโดยตรงจากกระบวนการ Bun/Node ของคุณเอง

หากคุณต้องการการแยกข้ามภาษา/กระบวนการ ให้ใช้โหมด RPC แทน

## การติดตั้ง

```bash
bun add @f5xc-salesdemos/xcsh
```

## จุดเข้าใช้งาน

`@f5xc-salesdemos/xcsh` ส่งออก SDK API จากรากของแพ็กเกจ (และผ่าน `@f5xc-salesdemos/xcsh/sdk` ด้วยเช่นกัน)

การส่งออกหลักสำหรับผู้ฝังตัว:

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- ตัวช่วยค้นหา (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- พื้นผิวโรงงานเครื่องมือ (`createTools`, `BUILTIN_TOOLS`, คลาสเครื่องมือ)

## เริ่มต้นอย่างรวดเร็ว (ค่าเริ่มต้นการค้นหาอัตโนมัติ)

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

`createAgentSession()` ดำเนินตามหลัก "ระบุเพื่อแทนที่ ละเว้นเพื่อค้นหา"

หากละเว้น จะทำการแก้ไข:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent` (ผ่าน `getAgentDir()`)
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)` (สำรองข้อมูลด้วยไฟล์)
- skills/context files/prompt templates/slash commands/extensions/custom TS commands
- เครื่องมือในตัวผ่าน `createTools(...)`
- เครื่องมือ MCP (เปิดใช้งานโดยค่าเริ่มต้น)
- การผสานรวม LSP (เปิดใช้งานโดยค่าเริ่มต้น)

### อินพุตที่จำเป็นเทียบกับทางเลือก

โดยปกติคุณต้องระบุเฉพาะสิ่งที่ต้องการควบคุม:

- **ต้องระบุ**: ไม่มีสำหรับเซสชันขั้นต่ำ
- **มักระบุอย่างชัดเจน** ในผู้ฝังตัว:
    - `sessionManager` (หากคุณต้องการในหน่วยความจำหรือตำแหน่งที่กำหนดเอง)
    - `authStorage` + `modelRegistry` (หากคุณจัดการวงจรชีวิตข้อมูลรับรอง/โมเดลเอง)
    - `model` หรือ `modelPattern` (หากการเลือกโมเดลที่แน่นอนมีความสำคัญ)
    - `settings` (หากคุณต้องการการกำหนดค่าแบบแยกส่วน/ทดสอบ)

## พฤติกรรมตัวจัดการเซสชัน (แบบถาวรเทียบกับในหน่วยความจำ)

`AgentSession` ใช้ `SessionManager` เสมอ; พฤติกรรมขึ้นอยู่กับโรงงานที่คุณใช้

### สำรองข้อมูลด้วยไฟล์ (ค่าเริ่มต้น)

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absolute .jsonl path
```

- บันทึกการสนทนา/ข้อความ/การเปลี่ยนแปลงสถานะลงไฟล์เซสชัน
- รองรับเวิร์กโฟลว์การกลับมาทำต่อ/เปิด/รายการ/แยกสาขา
- `session.sessionFile` ถูกกำหนดค่า

### ในหน่วยความจำ

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- ไม่มีการบันทึกถาวรในระบบไฟล์
- มีประโยชน์สำหรับการทดสอบ, ผู้ปฏิบัติงานชั่วคราว, agent ที่กำหนดขอบเขตตามคำขอ
- เมธอดของเซสชันยังคงทำงานได้ แต่พฤติกรรมเฉพาะการบันทึกถาวร (เส้นทางการกลับมาทำต่อ/แยกสาขาไฟล์) จะถูกจำกัดตามธรรมชาติ

### ตัวช่วยการกลับมาทำต่อ/เปิด/รายการ

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## การเชื่อมต่อโมเดลและการยืนยันตัวตน

`createAgentSession()` ใช้ `ModelRegistry` + `AuthStorage` สำหรับการเลือกโมเดลและการแก้ไขคีย์ API

### การเชื่อมต่อแบบชัดเจน

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

เมื่อไม่ได้ระบุ `model`/`modelPattern` อย่างชัดเจน:

1. กู้คืนโมเดลจากเซสชันที่มีอยู่ (หากกู้คืนได้ + มีคีย์พร้อมใช้งาน)
2. บทบาทโมเดลเริ่มต้นของการตั้งค่า (`default`)
3. โมเดลแรกที่พร้อมใช้งานที่มีการยืนยันตัวตนที่ถูกต้อง

หากการกู้คืนล้มเหลว `modelFallbackMessage` จะอธิบายการถอยกลับ

### ลำดับความสำคัญของการยืนยันตัวตน

`AuthStorage.getApiKey(...)` แก้ไขตามลำดับนี้:

1. การแทนที่ขณะรันไทม์ (`setRuntimeApiKey`)
2. ข้อมูลรับรองที่จัดเก็บใน `agent.db`
3. ตัวแปรสภาพแวดล้อมของผู้ให้บริการ
4. ตัวแก้ไขทางเลือกสำรองของผู้ให้บริการแบบกำหนดเอง (หากกำหนดค่าไว้)

## โมเดลการสมัครรับเหตุการณ์

สมัครรับด้วย `session.subscribe(listener)`; จะส่งคืนฟังก์ชันยกเลิกการสมัคร

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

`AgentSessionEvent` ประกอบด้วย `AgentEvent` หลัก รวมถึงเหตุการณ์ระดับเซสชัน:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## วงจรชีวิตของ Prompt

`session.prompt(text, options?)` เป็นจุดเข้าใช้งานหลัก

พฤติกรรม:

1. การขยายคำสั่ง/เทมเพลตทางเลือก (คำสั่ง `/`, คำสั่งกำหนดเอง, คำสั่งสแลชไฟล์, เทมเพลต prompt)
2. หากกำลังสตรีมอยู่:
    - ต้องการ `streamingBehavior: "steer" | "followUp"`
    - จัดคิวแทนที่จะทิ้งงาน
3. หากไม่ทำงาน:
    - ตรวจสอบโมเดล + คีย์ API
    - เพิ่มข้อความของผู้ใช้
    - เริ่มรอบ agent

API ที่เกี่ยวข้อง:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## เครื่องมือและการผสานรวมส่วนขยาย

### เครื่องมือในตัวและการกรอง

- เครื่องมือในตัวมาจาก `createTools(...)` และ `BUILTIN_TOOLS`
- `toolNames` ทำหน้าที่เป็นรายการอนุญาตสำหรับเครื่องมือในตัว
- `customTools` และเครื่องมือที่ลงทะเบียนโดยส่วนขยายยังคงรวมอยู่
- เครื่องมือที่ซ่อน (เช่น `submit_result`) เป็นแบบเลือกเข้าร่วม เว้นแต่ตัวเลือกจะต้องการ

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### ส่วนขยาย

- `extensions`: `ExtensionFactory[]` แบบอินไลน์
- `additionalExtensionPaths`: โหลดไฟล์ส่วนขยายเพิ่มเติม
- `disableExtensionDiscovery`: ปิดใช้งานการสแกนส่วนขยายอัตโนมัติ
- `preloadedExtensions`: ใช้ชุดส่วนขยายที่โหลดไว้แล้วซ้ำ

### การเปลี่ยนแปลงชุดเครื่องมือขณะรันไทม์

`AgentSession` รองรับการอัปเดตการเปิดใช้งานขณะรันไทม์:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

System prompt จะถูกสร้างใหม่เพื่อสะท้อนการเปลี่ยนแปลงเครื่องมือที่เปิดใช้งาน

## ตัวช่วยค้นหา

ใช้เมื่อคุณต้องการควบคุมบางส่วนโดยไม่ต้องสร้างตรรกะการค้นหาภายในใหม่:

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## ตัวเลือกที่มุ่งเน้น Subagent

สำหรับผู้ใช้ SDK ที่สร้างตัวประสานงาน (คล้ายกับโฟลว์ตัวดำเนินการงาน):

- `outputSchema`: ส่งความคาดหวังเอาต์พุตแบบมีโครงสร้างไปยังบริบทเครื่องมือ
- `requireSubmitResultTool`: บังคับรวมเครื่องมือ `submit_result`
- `taskDepth`: บริบทความลึกของการเรียกซ้ำสำหรับเซสชันงานซ้อน
- `parentTaskPrefix`: คำนำหน้าการตั้งชื่อสิ่งประดิษฐ์สำหรับเอาต์พุตงานซ้อน

สิ่งเหล่านี้เป็นทางเลือกสำหรับการฝังตัว agent เดี่ยวปกติ

## ค่าส่งคืนของ `createAgentSession()`

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

ใช้ `setToolUIContext(...)` เฉพาะเมื่อผู้ฝังตัวของคุณมีความสามารถ UI ที่เครื่องมือ/ส่วนขยายควรเรียกใช้

## ตัวอย่างการฝังตัวแบบควบคุมขั้นต่ำ

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
