---
title: SDK
description: SDK สำหรับสร้าง agent และการผสานรวมแบบกำหนดเองบน xcsh coding agent runtime
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

SDK คือพื้นผิวการผสานรวมแบบ in-process สำหรับ `@f5xc-salesdemos/xcsh`
ใช้เมื่อคุณต้องการเข้าถึงสถานะ agent, การสตรีมอีเวนต์, การเชื่อมต่อเครื่องมือ และการควบคุมเซสชันโดยตรงจากกระบวนการ Bun/Node ของคุณเอง

หากคุณต้องการการแยกกระบวนการข้ามภาษา ให้ใช้โหมด RPC แทน

## การติดตั้ง

```bash
bun add @f5xc-salesdemos/xcsh
```

## จุดเริ่มต้น (Entry points)

`@f5xc-salesdemos/xcsh` ส่งออก SDK API จาก root ของแพ็กเกจ (และยังผ่าน `@f5xc-salesdemos/xcsh/sdk` ด้วย)

การส่งออกหลักสำหรับผู้ฝัง (embedders):

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- ตัวช่วยค้นพบ (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- พื้นผิวโรงงานเครื่องมือ (`createTools`, `BUILTIN_TOOLS`, คลาสเครื่องมือ)

## เริ่มต้นอย่างรวดเร็ว (การค้นพบอัตโนมัติแบบค่าเริ่มต้น)

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

## สิ่งที่ `createAgentSession()` ค้นพบโดยค่าเริ่มต้น

`createAgentSession()` ทำงานตามหลัก "ระบุเพื่อแทนที่ ละเว้นเพื่อค้นพบ"

หากละเว้น จะแก้ไขดังนี้:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent` (ผ่าน `getAgentDir()`)
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)` (รองรับไฟล์)
- ทักษะ/ไฟล์บริบท/เทมเพลตพรอมต์/คำสั่ง slash/ส่วนขยาย/คำสั่ง TS แบบกำหนดเอง
- เครื่องมือที่มีอยู่แล้วผ่าน `createTools(...)`
- เครื่องมือ MCP (เปิดใช้งานโดยค่าเริ่มต้น)
- การผสานรวม LSP (เปิดใช้งานโดยค่าเริ่มต้น)

### อินพุตที่จำเป็นและไม่จำเป็น

โดยทั่วไปคุณต้องระบุเฉพาะสิ่งที่ต้องการควบคุม:

- **ต้องระบุ**: ไม่มีสำหรับเซสชันขั้นต่ำสุด
- **มักระบุอย่างชัดเจน** ใน embedders:
    - `sessionManager` (หากต้องการ in-memory หรือตำแหน่งแบบกำหนดเอง)
    - `authStorage` + `modelRegistry` (หากคุณจัดการวงจรชีวิตของ credential/model เอง)
    - `model` หรือ `modelPattern` (หากการเลือก model แบบกำหนดตายตัวมีความสำคัญ)
    - `settings` (หากต้องการการกำหนดค่าแบบแยกหรือสำหรับทดสอบ)

## พฤติกรรมของตัวจัดการเซสชัน (แบบถาวรและแบบ in-memory)

`AgentSession` ใช้ `SessionManager` เสมอ พฤติกรรมขึ้นอยู่กับโรงงานที่คุณใช้

### รองรับไฟล์ (ค่าเริ่มต้น)

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absolute .jsonl path
```

- บันทึกการสนทนา/ข้อความ/เดลต้าสถานะลงในไฟล์เซสชัน
- รองรับเวิร์กโฟลว์การดำเนินการต่อ/เปิด/แสดงรายการ/แยก
- `session.sessionFile` ถูกกำหนดแล้ว

### In-memory

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- ไม่มีการบันทึกลงระบบไฟล์
- มีประโยชน์สำหรับการทดสอบ, worker ชั่วคราว, agent ที่กำหนดขอบเขตตามคำขอ
- เมธอดเซสชันยังคงทำงานได้ แต่พฤติกรรมเฉพาะการบันทึก (เส้นทางการดำเนินการต่อ/แยกไฟล์) มีข้อจำกัดตามธรรมชาติ

### ตัวช่วย Resume/open/list

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## การเชื่อมต่อ model และการยืนยันตัวตน

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

เมื่อไม่ได้ระบุ `model`/`modelPattern` อย่างชัดเจน:

1. กู้คืน model จากเซสชันที่มีอยู่ (หากกู้คืนได้ + มี key)
2. บทบาท model เริ่มต้นของการตั้งค่า (`default`)
3. model ที่พร้อมใช้งานตัวแรกที่มีการยืนยันตัวตนที่ถูกต้อง

หากการกู้คืนล้มเหลว `modelFallbackMessage` จะอธิบายการ fallback

### ลำดับความสำคัญของการยืนยันตัวตน

`AuthStorage.getApiKey(...)` แก้ไขตามลำดับนี้:

1. การแทนที่ขณะรันไทม์ (`setRuntimeApiKey`)
2. ข้อมูลประจำตัวที่จัดเก็บใน `agent.db`
3. ตัวแปรสภาพแวดล้อมของผู้ให้บริการ
4. การ fallback ของ resolver แบบกำหนดเองของผู้ให้บริการ (หากกำหนดค่าไว้)

## รูปแบบการสมัครรับอีเวนต์

สมัครรับด้วย `session.subscribe(listener)` ซึ่งจะคืนค่าฟังก์ชัน unsubscribe

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

`AgentSessionEvent` ประกอบด้วย `AgentEvent` หลักและอีเวนต์ระดับเซสชัน:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## วงจรชีวิตของพรอมต์

`session.prompt(text, options?)` คือจุดเข้าหลัก

พฤติกรรม:

1. การขยายคำสั่ง/เทมเพลตเสริม (คำสั่ง `/`, คำสั่งแบบกำหนดเอง, คำสั่ง slash ของไฟล์, เทมเพลตพรอมต์)
2. หากกำลังสตรีมอยู่:
    - ต้องการ `streamingBehavior: "steer" | "followUp"`
    - จัดคิวแทนที่จะละทิ้งงาน
3. หากอยู่ในสถานะว่าง:
    - ตรวจสอบ model + API key
    - เพิ่มข้อความผู้ใช้
    - เริ่มรอบ agent

API ที่เกี่ยวข้อง:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## เครื่องมือและการผสานรวมส่วนขยาย

### เครื่องมือที่มีอยู่แล้วและการกรอง

- เครื่องมือที่มีอยู่แล้วมาจาก `createTools(...)` และ `BUILTIN_TOOLS`
- `toolNames` ทำหน้าที่เป็น allowlist สำหรับเครื่องมือที่มีอยู่แล้ว
- `customTools` และเครื่องมือที่ลงทะเบียนผ่านส่วนขยายยังคงรวมอยู่
- เครื่องมือที่ซ่อนอยู่ (เช่น `submit_result`) ต้องเลือกใช้เว้นแต่จะต้องการตามตัวเลือก

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### ส่วนขยาย

- `extensions`: `ExtensionFactory[]` แบบ inline
- `additionalExtensionPaths`: โหลดไฟล์ส่วนขยายเพิ่มเติม
- `disableExtensionDiscovery`: ปิดใช้งานการสแกนส่วนขยายอัตโนมัติ
- `preloadedExtensions`: นำชุดส่วนขยายที่โหลดไว้แล้วมาใช้ซ้ำ

### การเปลี่ยนแปลงชุดเครื่องมือขณะรันไทม์

`AgentSession` รองรับการอัปเดตการเปิดใช้งานขณะรันไทม์:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

System prompt จะถูกสร้างใหม่เพื่อสะท้อนการเปลี่ยนแปลงเครื่องมือที่ใช้งาน

## ตัวช่วยค้นพบ

ใช้สิ่งเหล่านี้เมื่อคุณต้องการการควบคุมบางส่วนโดยไม่ต้องสร้างตรรกะการค้นพบภายในใหม่:

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## ตัวเลือกที่เน้น subagent

สำหรับผู้ใช้ SDK ที่สร้าง orchestrators (คล้ายกับโฟลว์ตัวประมวลผลงาน):

- `outputSchema`: ส่งความคาดหวังเอาต์พุตแบบมีโครงสร้างไปยังบริบทเครื่องมือ
- `requireSubmitResultTool`: บังคับให้รวมเครื่องมือ `submit_result`
- `taskDepth`: บริบทความลึกของการเรียกซ้ำสำหรับเซสชันงานซ้อนกัน
- `parentTaskPrefix`: คำนำหน้าการตั้งชื่อ artifact สำหรับเอาต์พุตงานซ้อนกัน

สิ่งเหล่านี้เป็นตัวเลือกสำหรับการฝัง agent เดี่ยวแบบปกติ

## ค่าที่คืนจาก `createAgentSession()`

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

ใช้ `setToolUIContext(...)` เฉพาะเมื่อ embedder ของคุณมีความสามารถด้าน UI ที่เครื่องมือ/ส่วนขยายควรเรียกใช้

## ตัวอย่างการฝังแบบควบคุมขั้นต่ำสุด

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
