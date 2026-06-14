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

SDK คือพื้นผิวการผสานรวมในกระบวนการสำหรับ `@f5xc-salesdemos/xcsh`
ใช้เมื่อต้องการเข้าถึงสถานะ agent, การสตรีมเหตุการณ์, การเชื่อมต่อเครื่องมือ และการควบคุมเซสชันโดยตรงจากกระบวนการ Bun/Node ของคุณเอง

หากต้องการการแยกข้ามภาษา/กระบวนการ ให้ใช้โหมด RPC แทน

## การติดตั้ง

```bash
bun add @f5xc-salesdemos/xcsh
```

## จุดเข้าใช้งาน

`@f5xc-salesdemos/xcsh` ส่งออก SDK API จาก root ของแพ็กเกจ (และยังผ่าน `@f5xc-salesdemos/xcsh/sdk`)

การส่งออกหลักสำหรับผู้ฝัง:

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- ตัวช่วยการค้นหา (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
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

## สิ่งที่ `createAgentSession()` ค้นหาตามค่าเริ่มต้น

`createAgentSession()` ปฏิบัติตามหลักการ "ระบุเพื่อแทนที่ ละเว้นเพื่อค้นหา"

หากละเว้น จะดำเนินการแก้ไข:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent` (ผ่าน `getAgentDir()`)
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)` (สำรองข้อมูลด้วยไฟล์)
- ทักษะ/ไฟล์บริบท/เทมเพลต prompt/คำสั่ง slash/ส่วนขยาย/คำสั่ง TS แบบกำหนดเอง
- เครื่องมือในตัวผ่าน `createTools(...)`
- เครื่องมือ MCP (เปิดใช้งานตามค่าเริ่มต้น)
- การผสานรวม LSP (เปิดใช้งานตามค่าเริ่มต้น)

### อินพุตที่จำเป็นเทียบกับอินพุตที่ไม่บังคับ

โดยทั่วไปคุณต้องระบุเฉพาะสิ่งที่ต้องการควบคุม:

- **ต้องระบุ**: ไม่มีสิ่งใดสำหรับเซสชันขั้นต่ำ
- **มักระบุอย่างชัดเจน** ในผู้ฝัง:
    - `sessionManager` (หากต้องการในหน่วยความจำหรือตำแหน่งที่กำหนดเอง)
    - `authStorage` + `modelRegistry` (หากคุณเป็นเจ้าของวงจรชีวิตข้อมูลรับรอง/โมเดล)
    - `model` หรือ `modelPattern` (หากการเลือกโมเดลแบบกำหนดตายตัวมีความสำคัญ)
    - `settings` (หากต้องการการกำหนดค่าแบบแยกหรือทดสอบ)

## พฤติกรรมของตัวจัดการเซสชัน (ถาวรเทียบกับในหน่วยความจำ)

`AgentSession` ใช้ `SessionManager` เสมอ; พฤติกรรมขึ้นอยู่กับโรงงานที่คุณใช้

### สำรองข้อมูลด้วยไฟล์ (ค่าเริ่มต้น)

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absolute .jsonl path
```

- บันทึกการสนทนา/ข้อความ/เดลตาสถานะไปยังไฟล์เซสชัน
- รองรับเวิร์กโฟลว์การกลับมาใช้ต่อ/เปิด/แสดงรายการ/แยก
- `session.sessionFile` ถูกกำหนดแล้ว

### ในหน่วยความจำ

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- ไม่มีการบันทึกถาวรบนระบบไฟล์
- มีประโยชน์สำหรับการทดสอบ, worker ชั่วคราว, agent ที่กำหนดขอบเขตตามคำขอ
- เมธอดของเซสชันยังคงทำงาน แต่พฤติกรรมที่เกี่ยวข้องกับการบันทึกถาวร (เส้นทางกลับมาใช้ต่อ/แยกไฟล์) มีข้อจำกัดตามธรรมชาติ

### ตัวช่วยกลับมาใช้ต่อ/เปิด/แสดงรายการ

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## การเชื่อมต่อโมเดลและการยืนยันตัวตน

`createAgentSession()` ใช้ `ModelRegistry` + `AuthStorage` สำหรับการเลือกโมเดลและการแก้ไข API key

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

1. กู้คืนโมเดลจากเซสชันที่มีอยู่ (หากกู้คืนได้ + มี key พร้อมใช้)
2. บทบาทโมเดลค่าเริ่มต้นในการตั้งค่า (`default`)
3. โมเดลแรกที่พร้อมใช้งานซึ่งมีการยืนยันตัวตนที่ถูกต้อง

หากการกู้คืนล้มเหลว `modelFallbackMessage` จะอธิบายการ fallback

### ลำดับความสำคัญของการยืนยันตัวตน

`AuthStorage.getApiKey(...)` ดำเนินการแก้ไขตามลำดับนี้:

1. การแทนที่ runtime (`setRuntimeApiKey`)
2. ข้อมูลรับรองที่เก็บไว้ใน `agent.db`
3. ตัวแปรสภาพแวดล้อมของผู้ให้บริการ
4. การ fallback ตัวแก้ไข provider แบบกำหนดเอง (หากกำหนดค่าไว้)

## โมเดลการสมัครรับเหตุการณ์

สมัครรับด้วย `session.subscribe(listener)`; จะคืนค่าฟังก์ชันยกเลิกการสมัครรับ

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

`AgentSessionEvent` รวม `AgentEvent` หลักและเหตุการณ์ระดับเซสชัน:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## วงจรชีวิต Prompt

`session.prompt(text, options?)` คือจุดเข้าใช้งานหลัก

พฤติกรรม:

1. การขยายคำสั่ง/เทมเพลตที่ไม่บังคับ (คำสั่ง `/`, คำสั่งแบบกำหนดเอง, คำสั่ง slash ไฟล์, เทมเพลต prompt)
2. หากกำลังสตรีมอยู่:
    - ต้องใช้ `streamingBehavior: "steer" | "followUp"`
    - เพิ่มคิวแทนการละทิ้งงาน
3. หากไม่ได้ใช้งาน:
    - ตรวจสอบโมเดล + API key
    - เพิ่มข้อความผู้ใช้
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
- `toolNames` ทำหน้าที่เป็น allowlist สำหรับเครื่องมือในตัว
- เครื่องมือ `customTools` และที่ลงทะเบียนโดยส่วนขยายยังคงรวมอยู่
- เครื่องมือที่ซ่อนอยู่ (เช่น `submit_result`) เป็นแบบเลือกเข้าร่วม เว้นแต่ตัวเลือกจะกำหนดให้จำเป็น

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
- `preloadedExtensions`: นำชุดส่วนขยายที่โหลดแล้วกลับมาใช้ใหม่

### การเปลี่ยนแปลงชุดเครื่องมือ runtime

`AgentSession` รองรับการอัปเดตการเปิดใช้งาน runtime:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

System prompt จะถูกสร้างใหม่เพื่อสะท้อนการเปลี่ยนแปลงเครื่องมือที่ใช้งานอยู่

## ตัวช่วยการค้นหา

ใช้เมื่อต้องการการควบคุมบางส่วนโดยไม่ต้องสร้างตรรกะการค้นหาภายในใหม่:

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## ตัวเลือกที่มุ่งเน้น subagent

สำหรับผู้ใช้ SDK ที่กำลังสร้าง orchestrator (คล้ายกับโฟลว์ตัวดำเนินการงาน):

- `outputSchema`: ส่งความคาดหวังเอาต์พุตที่มีโครงสร้างไปยังบริบทเครื่องมือ
- `requireSubmitResultTool`: บังคับให้รวมเครื่องมือ `submit_result`
- `taskDepth`: บริบทความลึกการเรียกซ้ำสำหรับเซสชันงานที่ซ้อนกัน
- `parentTaskPrefix`: คำนำหน้าการตั้งชื่อ artifact สำหรับเอาต์พุตงานที่ซ้อนกัน

สิ่งเหล่านี้เป็นตัวเลือกสำหรับการฝัง agent เดี่ยวปกติ

## ค่าที่คืนของ `createAgentSession()`

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
