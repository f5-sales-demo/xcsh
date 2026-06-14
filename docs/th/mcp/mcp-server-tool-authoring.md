---
title: การสร้าง MCP Server และ Tool
description: คู่มือการสร้าง MCP server แบบกำหนดเองและการลงทะเบียน tool สำหรับ coding agent
sidebar:
  order: 4
  label: การสร้าง Server และ Tool
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# การสร้าง MCP server และ tool

เอกสารนี้อธิบายวิธีที่นิยามของ MCP server กลายเป็น `mcp_*` tool ที่เรียกใช้ได้ใน coding-agent และสิ่งที่ผู้ดูแลระบบควรคาดหวังเมื่อ config ไม่ถูกต้อง ซ้ำกัน ถูกปิดใช้งาน หรือต้องผ่านการยืนยันตัวตน

## ภาพรวมสถาปัตยกรรม

```text
Config sources (.xcsh/.claude/.cursor/.vscode/mcp.json, mcp.json, etc.)
  -> discovery providers normalize to canonical MCPServer
  -> capability loader dedupes by server name (higher provider priority wins)
  -> loadAllMCPConfigs converts to MCPServerConfig + skips enabled:false
  -> MCPManager connects/listTools (with auth/header/env resolution)
  -> MCPTool/DeferredMCPTool bridge exposes tools as mcp_<server>_<tool>
  -> AgentSession.refreshMCPTools replaces live MCP tools immediately
```

## 1) โมเดล server config และการตรวจสอบ

`src/mcp/types.ts` กำหนดรูปแบบการสร้างที่ใช้โดยผู้เขียน MCP config และ runtime:

- `stdio` (ค่าเริ่มต้นเมื่อไม่มี `type`): ต้องการ `command`, ไม่บังคับ `args`, `env`, `cwd`
- `http`: ต้องการ `url`, ไม่บังคับ `headers`
- `sse`: ต้องการ `url`, ไม่บังคับ `headers` (เก็บไว้เพื่อความเข้ากันได้)
- ฟิลด์ร่วม: `enabled`, `timeout`, `auth`

`validateServerConfig()` (`src/mcp/config.ts`) บังคับใช้พื้นฐานของ transport:

- ปฏิเสธ config ที่กำหนดทั้ง `command` และ `url`
- ต้องการ `command` สำหรับ stdio
- ต้องการ `url` สำหรับ http/sse
- ปฏิเสธ `type` ที่ไม่รู้จัก

`config-writer.ts` ใช้การตรวจสอบนี้สำหรับการดำเนินการ add/update และยังตรวจสอบชื่อ server:

- ต้องไม่ว่างเปล่า
- สูงสุด 100 ตัวอักษร
- เฉพาะ `[a-zA-Z0-9_.-]`

### ข้อควรระวังเกี่ยวกับ transport

- การละ `type` หมายถึง stdio หากคุณต้องการ HTTP/SSE แต่ละ `type` ออก `command` จะกลายเป็นสิ่งที่บังคับ
- `sse` ยังคงได้รับการยอมรับแต่ถูกจัดการเป็น HTTP transport ภายใน (`createHttpTransport`)
- การตรวจสอบเป็นโครงสร้าง ไม่ใช่การเข้าถึงได้จริง: URL ที่ถูกต้องทางไวยากรณ์ยังคงอาจล้มเหลวในขณะเชื่อมต่อ

## 2) การค้นพบ การทำให้เป็นมาตรฐาน และลำดับความสำคัญ

### การค้นพบตาม Capability

`loadAllMCPConfigs()` (`src/mcp/config.ts`) โหลดรายการ `MCPServer` แบบ canonical ผ่าน `loadCapability(mcpCapability.id)`

ชั้น capability (`src/capability/index.ts`) จากนั้น:

1. โหลด provider ตามลำดับความสำคัญ
2. ลบรายการซ้ำโดยใช้ `server.name` (ชนะก่อน = ความสำคัญสูงกว่า)
3. ตรวจสอบรายการที่ไม่ซ้ำกัน

ผลลัพธ์: ชื่อ server ที่ซ้ำกันในแหล่งต่างๆ จะไม่ถูกรวมกัน มีนิยามเดียวที่ชนะ รายการที่ซ้ำกันที่มีความสำคัญต่ำกว่าจะถูกบดบัง

### ไฟล์ `.mcp.json` และไฟล์ที่เกี่ยวข้อง

provider สำรองเฉพาะใน `src/discovery/mcp-json.ts` อ่าน `mcp.json` และ `.mcp.json` ที่ root ของโปรเจกต์ (ความสำคัญต่ำ)

ในทางปฏิบัติ MCP server ยังมาจาก provider ที่มีความสำคัญสูงกว่า (ตัวอย่างเช่น native `.xcsh/...` และไดเรกทอรี config เฉพาะของ tool) แนวทางการสร้าง:

- แนะนำ `.xcsh/mcp.json` (โปรเจกต์) หรือ `~/.xcsh/mcp.json` (ผู้ใช้) เพื่อการควบคุมที่ชัดเจน
- ใช้ root `mcp.json` / `.mcp.json` เมื่อคุณต้องการความเข้ากันได้แบบสำรอง
- การใช้ชื่อ server เดิมในหลายแหล่งทำให้เกิดการบดบังตามความสำคัญ ไม่ใช่การรวมกัน

### พฤติกรรมการทำให้เป็นมาตรฐาน

`convertToLegacyConfig()` (`src/mcp/config.ts`) แมป `MCPServer` แบบ canonical ไปยัง `MCPServerConfig` สำหรับ runtime

พฤติกรรมหลัก:

- transport อนุมานเป็น `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- server ที่ถูกปิดใช้งาน (`enabled === false`) จะถูกยกเว้นก่อนการเชื่อมต่อ
- ฟิลด์ที่ไม่บังคับจะถูกเก็บไว้เมื่อมีอยู่

### การขยาย Environment ระหว่างการค้นพบ

`mcp-json.ts` ขยาย env placeholder ในฟิลด์ string ด้วย `expandEnvVarsDeep()`:

- รองรับ `${VAR}` และ `${VAR:-default}`
- ค่าที่ไม่ได้รับการแก้ไขยังคงเป็น string literal `${VAR}`

`mcp-json.ts` ยังทำการตรวจสอบประเภท runtime สำหรับ JSON ของผู้ใช้ และบันทึกคำเตือนสำหรับค่า `enabled`/`timeout` ที่ไม่ถูกต้อง แทนที่จะทำให้ไฟล์ทั้งหมดล้มเหลว

## 3) Auth และการแก้ไขค่า runtime

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) คือการผ่านก่อนเชื่อมต่อขั้นสุดท้าย

### การฉีด OAuth credential

หาก config มี:

```ts
auth: { type: "oauth", credentialId: "..." }
```

และ credential มีอยู่ใน auth storage:

- `http`/`sse`: ฉีด header `Authorization: Bearer <access_token>`
- `stdio`: ฉีด env var `OAUTH_ACCESS_TOKEN`

หากการค้นหา credential ล้มเหลว manager จะบันทึกคำเตือนและดำเนินการต่อโดยไม่มีการแก้ไข auth

### การแก้ไขค่า Header/env

ก่อนเชื่อมต่อ manager แก้ไขค่า header/env แต่ละรายการผ่าน `resolveConfigValue()` (`src/config/resolve-config-value.ts`):

- ค่าที่ขึ้นต้นด้วย `!` => รันคำสั่ง shell และใช้ stdout ที่ trim แล้ว (cached)
- มิฉะนั้น ถือว่าค่าเป็นชื่อ environment variable ก่อน (`process.env[name]`) และ fallback เป็นค่า literal
- ค่า command/env ที่ไม่ได้รับการแก้ไขจะถูกละออกจาก headers/env map สุดท้าย

ข้อควรระวังในการดำเนินงาน: นั่นหมายความว่าคำสั่ง/คีย์ env ของ secret ที่พิมพ์ผิดสามารถลบรายการ header/env นั้นออกอย่างเงียบๆ ทำให้เกิด 401/403 downstream หรือความล้มเหลวในการเริ่มต้น server

## 4) Tool bridge: MCP -> tool ที่เรียกใช้ได้โดย agent

`src/mcp/tool-bridge.ts` แปลง MCP tool definition เป็น `CustomTool`

### โดเมนการตั้งชื่อและการชน

ชื่อ tool ถูกสร้างเป็น:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

กฎ:

- แปลงเป็นตัวพิมพ์เล็ก
- อักขระที่ไม่ใช่ `[a-z_]` กลายเป็น `_`
- underscore ที่ซ้ำกันจะถูกยุบ
- prefix `<server>_` ที่ซ้ำซ้อนในชื่อ tool จะถูกตัดออกครั้งเดียว

วิธีนี้หลีกเลี่ยงการชนได้หลายกรณี แต่ไม่ทั้งหมด ชื่อ raw ที่แตกต่างกันยังคงสามารถ sanitize ไปเป็น identifier เดียวกันได้ (ตัวอย่างเช่น `my-server` และ `my.server` ทั้งคู่ sanitize ได้คล้ายกัน) และการแทรก registry เป็นแบบ last-write-wins

### การแมป Schema

`convertSchema()` เก็บ MCP JSON Schema เป็นส่วนใหญ่ตามเดิม แต่แพตช์ object schema ที่ขาด `properties` ด้วย `{}` เพื่อความเข้ากันได้กับ provider

### การแมปการรัน

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- เรียก MCP `tools/call`
- แปลง MCP content ให้แบนเป็นข้อความที่แสดงได้
- ส่งคืนรายละเอียดที่มีโครงสร้าง (`serverName`, `mcpToolName`, metadata ของ provider)
- แมป `isError` ที่ server รายงานเป็นผลลัพธ์ข้อความ `Error: ...`
- แมปความล้มเหลวของ transport/runtime ที่ถูก throw เป็น `MCP error: ...`
- รักษาความหมายของ abort โดยแปล AbortError เป็น `ToolAbortError`

## 5) วงจรชีวิตของผู้ดูแลระบบ: add/edit/remove และการอัปเดตแบบ live

โหมด Interactive เปิดเผย `/mcp` ใน `src/modes/controllers/mcp-command-controller.ts`

การดำเนินการที่รองรับ:

- `add` (wizard หรือ quick-add)
- `remove` / `rm`
- `enable` / `disable`
- `test`
- `reauth` / `unauth`
- `reload`

การเขียน config เป็นแบบ atomic (`writeMCPConfigFile`: temp file + rename)

หลังจากเปลี่ยนแปลง controller เรียก `#reloadMCP()`:

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

`refreshMCPTools()` แทนที่รายการ registry `mcp_` ทั้งหมดและเปิดใช้งาน MCP tool ชุดล่าสุดทันที ดังนั้นการเปลี่ยนแปลงจะมีผลโดยไม่ต้องรีสตาร์ท session

### ความแตกต่างของโหมด

- **โหมด Interactive/TUI**: `/mcp` มี UX ในแอป (wizard, OAuth flow, ข้อความสถานะการเชื่อมต่อ, การ rebinding runtime ทันที)
- **การรวม SDK/headless**: `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) ส่งคืน tool ที่โหลดแล้ว + ข้อผิดพลาดต่อ server โดยไม่มี UX คำสั่ง `/mcp`

## 6) พื้นผิวข้อผิดพลาดที่มองเห็นได้โดยผู้ใช้

string ข้อผิดพลาดทั่วไปที่ผู้ใช้/ผู้ดูแลระบบเห็น:

- ความล้มเหลวในการตรวจสอบ add/update:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- ปัญหา argument ของ quick-add:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- ความล้มเหลวในการเชื่อมต่อ/ทดสอบ:
  - `Failed to connect to "<name>": <message>`
  - ข้อความช่วยเหลือ timeout แนะนำให้เพิ่ม timeout
  - ข้อความช่วยเหลือ auth สำหรับ `401/403`
- Auth/OAuth flow:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- การใช้งาน server ที่ถูกปิดใช้งาน:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

JSON ต้นทางที่ไม่ถูกต้องในการค้นพบโดยทั่วไปจะถูกจัดการเป็นคำเตือน/log; เส้นทาง config-writer จะ throw ข้อผิดพลาดที่ชัดเจน

## 7) แนวทางการสร้างในทางปฏิบัติ

สำหรับการสร้าง MCP ที่แข็งแกร่งใน codebase นี้:

1. รักษาชื่อ server ให้ไม่ซ้ำกันทั่วโลกในทุก config source ที่รองรับ MCP
2. แนะนำชื่อที่เป็น alphanumeric/underscore เพื่อหลีกเลี่ยงการชนของชื่อที่ sanitize แล้วในชื่อ tool `mcp_*` ที่สร้างขึ้น
3. ใช้ `type` ที่ชัดเจนเพื่อหลีกเลี่ยงค่าเริ่มต้น stdio โดยไม่ตั้งใจ
4. ถือว่า `enabled: false` เป็นการปิดสนิท: server จะถูกยกเว้นจากชุดการเชื่อมต่อ runtime
5. สำหรับ OAuth config ให้จัดเก็บ `credentialId` ที่ถูกต้อง มิฉะนั้นการฉีด auth จะถูกข้าม
6. หากใช้การแก้ไข secret แบบ command (`!cmd`) ให้ตรวจสอบว่า output ของคำสั่งมีความเสถียรและไม่ว่างเปล่า

## ไฟล์การ implementation

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts)
- [`src/mcp/config-writer.ts`](../../packages/coding-agent/src/mcp/config-writer.ts)
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts)
- [`src/discovery/mcp-json.ts`](../../packages/coding-agent/src/discovery/mcp-json.ts)
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/config/resolve-config-value.ts`](../../packages/coding-agent/src/config/resolve-config-value.ts)
- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts)
