---
title: การเขียน MCP Server และ Tool
description: คู่มือการสร้าง MCP server แบบกำหนดเองและการลงทะเบียน tool สำหรับ coding agent
sidebar:
  order: 4
  label: การเขียน Server และ Tool
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# การเขียน MCP server และ tool

เอกสารนี้อธิบายว่านิยาม MCP server กลายเป็น `mcp_*` tools ที่เรียกใช้ได้ใน coding-agent อย่างไร และสิ่งที่ผู้ดำเนินการควรคาดหวังเมื่อ config ไม่ถูกต้อง ซ้ำกัน ถูกปิดใช้งาน หรือต้องการการตรวจสอบสิทธิ์

## สถาปัตยกรรมโดยสรุป

```text
Config sources (.xcsh/.claude/.cursor/.vscode/mcp.json, mcp.json, etc.)
  -> discovery providers normalize to canonical MCPServer
  -> capability loader dedupes by server name (higher provider priority wins)
  -> loadAllMCPConfigs converts to MCPServerConfig + skips enabled:false
  -> MCPManager connects/listTools (with auth/header/env resolution)
  -> MCPTool/DeferredMCPTool bridge exposes tools as mcp_<server>_<tool>
  -> AgentSession.refreshMCPTools replaces live MCP tools immediately
```

## 1) โมเดล server config และการตรวจสอบความถูกต้อง

`src/mcp/types.ts` กำหนดรูปแบบการเขียนที่ใช้โดยผู้เขียน MCP config และ runtime:

- `stdio` (ค่าเริ่มต้นเมื่อไม่มี `type`): ต้องการ `command`, ไม่บังคับ `args`, `env`, `cwd`
- `http`: ต้องการ `url`, ไม่บังคับ `headers`
- `sse`: ต้องการ `url`, ไม่บังคับ `headers` (คงไว้เพื่อความเข้ากันได้)
- ฟิลด์ร่วม: `enabled`, `timeout`, `auth`

`validateServerConfig()` (`src/mcp/config.ts`) บังคับใช้พื้นฐานของ transport:

- ปฏิเสธ config ที่ตั้งค่าทั้ง `command` และ `url` พร้อมกัน
- ต้องการ `command` สำหรับ stdio
- ต้องการ `url` สำหรับ http/sse
- ปฏิเสธ `type` ที่ไม่รู้จัก

`config-writer.ts` ใช้การตรวจสอบความถูกต้องนี้สำหรับการดำเนินการเพิ่ม/อัปเดต และยังตรวจสอบชื่อ server ด้วย:

- ต้องไม่ว่างเปล่า
- ความยาวสูงสุด 100 ตัวอักษร
- เฉพาะ `[a-zA-Z0-9_.-]` เท่านั้น

### ข้อผิดพลาดที่พบบ่อยของ transport

- การละเว้น `type` หมายถึง stdio หากต้องการ HTTP/SSE แต่ละเว้น `type` ไว้ `command` จะกลายเป็นสิ่งที่บังคับต้องมี
- `sse` ยังคงได้รับการยอมรับแต่ถูกจัดการเป็น HTTP transport ภายใน (`createHttpTransport`)
- การตรวจสอบความถูกต้องเป็นเชิงโครงสร้าง ไม่ใช่การเข้าถึงได้จริง: URL ที่ถูกต้องตามไวยากรณ์ยังสามารถล้มเหลวในขณะเชื่อมต่อได้

## 2) การค้นพบ การทำให้เป็นรูปแบบมาตรฐาน และลำดับความสำคัญ

### การค้นพบตาม Capability

`loadAllMCPConfigs()` (`src/mcp/config.ts`) โหลดรายการ `MCPServer` มาตรฐานผ่าน `loadCapability(mcpCapability.id)`

เลเยอร์ capability (`src/capability/index.ts`) จะ:

1. โหลด provider ตามลำดับความสำคัญ
2. กำจัดรายการซ้ำตาม `server.name` (ได้รับก่อน = ความสำคัญสูงสุด)
3. ตรวจสอบความถูกต้องของรายการที่กำจัดซ้ำแล้ว

ผลลัพธ์: ชื่อ server ที่ซ้ำกันในแหล่งต่าง ๆ จะไม่ถูกรวมกัน นิยามหนึ่งจะชนะ; รายการซ้ำที่มีความสำคัญต่ำกว่าจะถูกซ่อนไว้

### ไฟล์ `.mcp.json` และไฟล์ที่เกี่ยวข้อง

provider สำรองโดยเฉพาะใน `src/discovery/mcp-json.ts` อ่าน `mcp.json` และ `.mcp.json` ที่ root ของโปรเจกต์ (ความสำคัญต่ำ)

ในทางปฏิบัติ MCP server ยังมาจาก provider ที่มีความสำคัญสูงกว่า (เช่น `.xcsh/...` แบบ native และ config dir เฉพาะของ tool) คำแนะนำในการเขียน:

- แนะนำให้ใช้ `.xcsh/mcp.json` (โปรเจกต์) หรือ `~/.xcsh/mcp.json` (ผู้ใช้) เพื่อการควบคุมที่ชัดเจน
- ใช้ root `mcp.json` / `.mcp.json` เมื่อต้องการความเข้ากันได้แบบสำรอง
- การใช้ชื่อ server เดียวกันในหลายแหล่งทำให้เกิดการซ่อนตามลำดับความสำคัญ ไม่ใช่การรวมกัน

### พฤติกรรมการทำให้เป็นรูปแบบมาตรฐาน

`convertToLegacyConfig()` (`src/mcp/config.ts`) แมป `MCPServer` มาตรฐานไปยัง `MCPServerConfig` สำหรับ runtime

พฤติกรรมสำคัญ:

- transport อนุมานเป็น `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- server ที่ถูกปิดใช้งาน (`enabled === false`) จะถูกตัดออกก่อนการเชื่อมต่อ
- ฟิลด์ที่ไม่บังคับจะถูกเก็บรักษาไว้เมื่อมีอยู่

### การขยาย environment ระหว่างการค้นพบ

`mcp-json.ts` ขยาย placeholder ของ env ในฟิลด์ string ด้วย `expandEnvVarsDeep()`:

- รองรับ `${VAR}` และ `${VAR:-default}`
- ค่าที่ไม่สามารถแก้ไขได้จะคงเป็น string ตัวอักษร `${VAR}`

`mcp-json.ts` ยังทำการตรวจสอบประเภท runtime สำหรับ JSON ของผู้ใช้ และบันทึกคำเตือนสำหรับค่า `enabled`/`timeout` ที่ไม่ถูกต้องแทนที่จะทำให้ไฟล์ทั้งหมดล้มเหลว

## 3) Auth และการแก้ไขค่า runtime

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) คือการประมวลผลก่อนเชื่อมต่อขั้นสุดท้าย

### การฉีด OAuth credential

หาก config มี:

```ts
auth: { type: "oauth", credentialId: "..." }
```

และ credential มีอยู่ใน auth storage:

- `http`/`sse`: ฉีด header `Authorization: Bearer <access_token>`
- `stdio`: ฉีด env var `OAUTH_ACCESS_TOKEN`

หากการค้นหา credential ล้มเหลว manager จะบันทึกคำเตือนและดำเนินการต่อโดยมี auth ที่ไม่ได้รับการแก้ไข

### การแก้ไขค่า header/env

ก่อนการเชื่อมต่อ manager จะแก้ไขค่า header/env แต่ละค่าผ่าน `resolveConfigValue()` (`src/config/resolve-config-value.ts`):

- ค่าที่เริ่มต้นด้วย `!` => รันคำสั่ง shell ใช้ stdout ที่ตัดช่องว่างแล้ว (cached)
- มิฉะนั้น ให้ถือว่าค่าเป็นชื่อตัวแปร environment ก่อน (`process.env[name]`) แล้วจึง fallback เป็นค่าตัวอักษร
- ค่าคำสั่ง/env ที่ไม่ได้รับการแก้ไขจะถูกละเว้นจาก headers/env map ขั้นสุดท้าย

ข้อควรระวังในการดำเนินงาน: หมายความว่าคำสั่ง secret หรือ env key ที่พิมพ์ผิดสามารถลบรายการ header/env นั้นออกอย่างเงียบ ๆ ส่งผลให้เกิด 401/403 หรือการเริ่มต้น server ล้มเหลว

## 4) Tool bridge: MCP -> tools ที่ agent เรียกใช้ได้

`src/mcp/tool-bridge.ts` แปลงนิยาม MCP tool เป็น `CustomTool`

### การตั้งชื่อและโดเมนการชนกัน

ชื่อ tool สร้างขึ้นเป็น:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

กฎ:

- เปลี่ยนเป็นตัวพิมพ์เล็ก
- อักขระที่ไม่ใช่ `[a-z_]` จะกลายเป็น `_`
- เครื่องหมายขีดล่างที่ซ้ำกันจะถูกรวบ
- คำนำหน้า `<server>_` ที่ซ้ำซ้อนในชื่อ tool จะถูกตัดออกหนึ่งครั้ง

วิธีนี้หลีกเลี่ยงการชนกันส่วนใหญ่ แต่ไม่ทั้งหมด ชื่อ raw ที่แตกต่างกันยังสามารถ sanitize เป็น identifier เดียวกันได้ (เช่น `my-server` และ `my.server` ต่างก็ sanitize ในลักษณะเดียวกัน) และการแทรก registry เป็นแบบ last-write-wins

### การแมป Schema

`convertSchema()` คง MCP JSON Schema ไว้เป็นส่วนใหญ่แต่ patch object schema ที่ขาด `properties` ด้วย `{}` เพื่อความเข้ากันได้กับ provider

### การแมปการรันคำสั่ง

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- เรียก MCP `tools/call`
- แปลง MCP content เป็นข้อความที่แสดงได้
- คืนค่า details ที่มีโครงสร้าง (`serverName`, `mcpToolName`, metadata ของ provider)
- แมป `isError` ที่รายงานโดย server เป็นผลลัพธ์ข้อความ `Error: ...`
- แมปความล้มเหลวของ transport/runtime ที่เกิดขึ้นเป็น `MCP error: ...`
- รักษาความหมายของการยกเลิกโดยแปล AbortError เป็น `ToolAbortError`

## 5) วงจรชีวิตของผู้ดำเนินการ: เพิ่ม/แก้ไข/ลบ และการอัปเดตแบบ live

โหมด Interactive เปิดเผย `/mcp` ใน `src/modes/controllers/mcp-command-controller.ts`

การดำเนินการที่รองรับ:

- `add` (wizard หรือ quick-add)
- `remove` / `rm`
- `enable` / `disable`
- `test`
- `reauth` / `unauth`
- `reload`

การเขียน config เป็นแบบ atomic (`writeMCPConfigFile`: ไฟล์ชั่วคราว + เปลี่ยนชื่อ)

หลังจากเปลี่ยนแปลง controller จะเรียก `#reloadMCP()`:

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

`refreshMCPTools()` แทนที่รายการ registry `mcp_` ทั้งหมดและเปิดใช้งาน MCP tool ล่าสุดทันที ดังนั้นการเปลี่ยนแปลงจึงมีผลโดยไม่ต้องรีสตาร์ท session

### ความแตกต่างของโหมด

- **โหมด Interactive/TUI**: `/mcp` ให้ UX ในแอป (wizard, OAuth flow, ข้อความสถานะการเชื่อมต่อ, การ rebinding runtime ทันที)
- **การผสานรวม SDK/headless**: `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) คืน tool ที่โหลดแล้ว + ข้อผิดพลาดต่อ server; ไม่มี UX คำสั่ง `/mcp`

## 6) พื้นผิวข้อผิดพลาดที่ผู้ใช้มองเห็น

string ข้อผิดพลาดทั่วไปที่ผู้ใช้/ผู้ดำเนินการเห็น:

- ความล้มเหลวในการตรวจสอบความถูกต้องของการเพิ่ม/อัปเดต:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- ปัญหา argument ของ quick-add:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- ความล้มเหลวในการเชื่อมต่อ/ทดสอบ:
  - `Failed to connect to "<name>": <message>`
  - ข้อความช่วยเหลือ timeout แนะนำให้เพิ่มค่า timeout
  - ข้อความช่วยเหลือ auth สำหรับ `401/403`
- OAuth flow ของ auth:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- การใช้งาน server ที่ถูกปิดใช้งาน:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

JSON ต้นทางที่ไม่ถูกต้องในการค้นพบจะถูกจัดการเป็นคำเตือน/log โดยทั่วไป; เส้นทาง config-writer จะ throw ข้อผิดพลาดอย่างชัดเจน

## 7) คำแนะนำการเขียนเชิงปฏิบัติ

สำหรับการเขียน MCP ที่แข็งแกร่งใน codebase นี้:

1. รักษาชื่อ server ให้ไม่ซ้ำกันทั่วโลกในแหล่ง config ที่รองรับ MCP ทั้งหมด
2. แนะนำให้ใช้ชื่อที่เป็นตัวอักษรและตัวเลข/เครื่องหมายขีดล่าง เพื่อหลีกเลี่ยงการชนกันของชื่อที่ sanitize แล้วในชื่อ tool `mcp_*` ที่สร้างขึ้น
3. ใช้ `type` อย่างชัดเจนเพื่อหลีกเลี่ยงค่าเริ่มต้น stdio โดยไม่ตั้งใจ
4. ถือว่า `enabled: false` เป็นการปิดสนิท: server จะถูกละเว้นจากชุดการเชื่อมต่อ runtime
5. สำหรับ OAuth config ให้เก็บ `credentialId` ที่ถูกต้อง; มิฉะนั้นการฉีด auth จะถูกข้ามไป
6. หากใช้การแก้ไข secret ตามคำสั่ง (`!cmd`) ให้ตรวจสอบว่า output ของคำสั่งมีความเสถียรและไม่ว่างเปล่า

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
