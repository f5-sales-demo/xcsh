---
title: SDK
description: >-
  SDK for building custom agents and integrations on top of the xcsh coding
  agent runtime.
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

SDK คือ integration surface ภายในกระบวนการ (in-process) สำหรับ `@f5xc-salesdemos/xcsh`
ใช้เมื่อคุณต้องการเข้าถึง agent state, event streaming, tool wiring และ session control โดยตรงจากกระบวนการ Bun/Node ของคุณเอง

หากคุณต้องการการแยกข้ามภาษา/กระบวนการ (cross-language/process isolation) ให้ใช้โหมด RPC แทน

## การติดตั้ง

```bash
bun add @f5xc-salesdemos/xcsh
```

## จุดเข้าใช้งาน (Entry points)

`@f5xc-salesdemos/xcsh` ส่งออก SDK APIs จาก package root (และยังส่งออกผ่าน `@f5xc-salesdemos/xcsh/sdk` ด้วย)

Core exports สำหรับผู้ฝังตัว (embedders):

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- Discovery helpers (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- Tool factory surface (`createTools`, `BUILTIN_TOOLS`, tool classes)

## เริ่มต้นอย่างรวดเร็ว (auto-discovery defaults)

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

`createAgentSession()` ใช้หลักการ "ระบุเพื่อแทนที่ ละเว้นเพื่อค้นหาอัตโนมัติ" (provide to override, omit to discover)

หากละเว้น จะ resolve ค่าต่อไปนี้:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent` (ผ่าน `getAgentDir()`)
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)` (file-backed)
- skills/context files/prompt templates/slash commands/extensions/custom TS commands
- built-in tools ผ่าน `createTools(...)`
- MCP tools (เปิดใช้งานโดยค่าเริ่มต้น)
- LSP integration (เปิดใช้งานโดยค่าเริ่มต้น)

### อินพุตที่จำเป็นและทางเลือก

โดยปกติคุณต้องระบุเฉพาะสิ่งที่ต้องการควบคุม:

- **ต้องระบุ**: ไม่มีสำหรับ session พื้นฐาน
- **มักระบุอย่างชัดเจน** ในผู้ฝังตัว (embedders):
    - `sessionManager` (หากต้องการ in-memory หรือตำแหน่งที่กำหนดเอง)
    - `authStorage` + `modelRegistry` (หากคุณจัดการ credential/model lifecycle เอง)
    - `model` หรือ `modelPattern` (หากการเลือกโมเดลแบบกำหนดได้มีความสำคัญ)
    - `settings` (หากต้องการ config แบบแยกส่วน/ทดสอบ)

## พฤติกรรมของ Session manager (persistent vs in-memory)

`AgentSession` ใช้ `SessionManager` เสมอ; พฤติกรรมขึ้นอยู่กับ factory ที่คุณใช้

### File-backed (ค่าเริ่มต้น)

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absolute .jsonl path
```

- บันทึก conversation/messages/state deltas ลงไฟล์ session
- รองรับ workflow แบบ resume/open/list/fork
- `session.sessionFile` มีค่ากำหนดไว้

### In-memory

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- ไม่มีการบันทึกลง filesystem
- เหมาะสำหรับการทดสอบ, ephemeral workers, request-scoped agents
- เมธอดของ session ยังคงทำงานได้ แต่พฤติกรรมเฉพาะสำหรับ persistence (เส้นทาง file resume/fork) จะถูกจำกัดตามธรรมชาติ

### ตัวช่วย Resume/open/list

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## การเชื่อมต่อ Model และ Auth

`createAgentSession()` ใช้ `ModelRegistry` + `AuthStorage` สำหรับการเลือกโมเดลและการ resolve API key

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

1. กู้คืนโมเดลจาก session ที่มีอยู่ (หากกู้คืนได้ + key พร้อมใช้งาน)
2. โมเดลเริ่มต้นจากการตั้งค่า role (`default`)
3. โมเดลแรกที่พร้อมใช้งานที่มี auth ที่ถูกต้อง

หากการกู้คืนล้มเหลว `modelFallbackMessage` จะอธิบาย fallback

### ลำดับความสำคัญของ Auth

`AuthStorage.getApiKey(...)` resolve ตามลำดับนี้:

1. runtime override (`setRuntimeApiKey`)
2. credentials ที่เก็บไว้ใน `agent.db`
3. ตัวแปรสภาพแวดล้อมของ provider
4. custom-provider resolver fallback (หากกำหนดค่าไว้)

## โมเดลการสมัครรับเหตุการณ์ (Event subscription model)

สมัครรับด้วย `session.subscribe(listener)`; จะคืนค่าฟังก์ชัน unsubscribe

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

`AgentSessionEvent` รวม `AgentEvent` หลักและเหตุการณ์ระดับ session:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## วงจรชีวิตของ Prompt

`session.prompt(text, options?)` เป็นจุดเข้าใช้งานหลัก

พฤติกรรม:

1. การขยายคำสั่ง/เทมเพลตที่เป็นทางเลือก (คำสั่ง `/`, custom commands, file slash commands, prompt templates)
2. หากกำลัง streaming อยู่:
    - ต้องใช้ `streamingBehavior: "steer" | "followUp"`
    - จัดคิวแทนที่จะทิ้งงาน
3. หาก idle:
    - ตรวจสอบ model + API key
    - เพิ่มข้อความผู้ใช้
    - เริ่ม agent turn

API ที่เกี่ยวข้อง:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## Tools และการผสานรวม Extension

### Built-ins และการกรอง

- Built-ins มาจาก `createTools(...)` และ `BUILTIN_TOOLS`
- `toolNames` ทำหน้าที่เป็น allowlist สำหรับ built-ins
- `customTools` และ tools ที่ลงทะเบียนผ่าน extension ยังคงถูกรวมอยู่
- Hidden tools (เช่น `submit_result`) จะเป็น opt-in เว้นแต่ตัวเลือกกำหนดให้จำเป็น

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### Extensions

- `extensions`: inline `ExtensionFactory[]`
- `additionalExtensionPaths`: โหลดไฟล์ extension เพิ่มเติม
- `disableExtensionDiscovery`: ปิดการสแกน extension อัตโนมัติ
- `preloadedExtensions`: นำชุด extension ที่โหลดแล้วกลับมาใช้ซ้ำ

### การเปลี่ยนชุดเครื่องมือขณะรันไทม์

`AgentSession` รองรับการอัปเดต activation ขณะรันไทม์:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

System prompt จะถูกสร้างขึ้นใหม่เพื่อสะท้อนการเปลี่ยนแปลง active tool

## ตัวช่วยการค้นหา (Discovery helpers)

ใช้สิ่งเหล่านี้เมื่อคุณต้องการควบคุมบางส่วนโดยไม่ต้องสร้างตรรกะการค้นหาภายในขึ้นมาใหม่:

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## ตัวเลือกเชิง Subagent

สำหรับผู้ใช้ SDK ที่สร้าง orchestrators (คล้ายกับ task executor flow):

- `outputSchema`: ส่งความคาดหวัง structured output เข้าสู่บริบทเครื่องมือ
- `requireSubmitResultTool`: บังคับให้รวม `submit_result` tool
- `taskDepth`: บริบทความลึกของ recursion สำหรับ nested task sessions
- `parentTaskPrefix`: คำนำหน้าการตั้งชื่อ artifact สำหรับ nested task outputs

สิ่งเหล่านี้เป็นทางเลือกสำหรับการฝังตัว single-agent ปกติ

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

ใช้ `setToolUIContext(...)` เฉพาะเมื่อผู้ฝังตัวของคุณมีความสามารถ UI ที่ tools/extensions ควรเรียกใช้

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
