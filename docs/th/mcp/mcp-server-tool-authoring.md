---
title: MCP Server and Tool Authoring
description: คู่มือการสร้าง MCP server แบบกำหนดเองและการลงทะเบียน tool สำหรับ coding agent
sidebar:
  order: 4
  label: การเขียน Server และ tool
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# การเขียน MCP server และ tool

เอกสารนี้อธิบายว่าคำจำกัดความของ MCP server กลายเป็น `mcp_*` tool ที่เรียกใช้ได้ใน coding-agent ได้อย่างไร และสิ่งที่ผู้ดูแลระบบควรคาดหวังเมื่อ config ไม่ถูกต้อง ซ้ำกัน ถูกปิดใช้งาน หรือถูกจำกัดด้วยการพิสูจน์ตัวตน

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

## 1) โมเดล config ของ server และการตรวจสอบ

`src/mcp/types.ts` กำหนดรูปแบบการเขียนที่ใช้โดยผู้เขียน MCP config และ runtime:

- `stdio` (ค่าเริ่มต้นเมื่อไม่มี `type`): ต้องการ `command`, ไม่บังคับ `args`, `env`, `cwd`
- `http`: ต้องการ `url`, ไม่บังคับ `headers`
- `sse`: ต้องการ `url`, ไม่บังคับ `headers` (คงไว้เพื่อความเข้ากันได้)
- ฟิลด์ที่ใช้ร่วมกัน: `enabled`, `timeout`, `auth`

`validateServerConfig()` (`src/mcp/config.ts`) บังคับใช้พื้นฐานของ transport:

- ปฏิเสธ config ที่ตั้งค่าทั้ง `command` และ `url`
- ต้องการ `command` สำหรับ stdio
- ต้องการ `url` สำหรับ http/sse
- ปฏิเสธ `type` ที่ไม่รู้จัก

`config-writer.ts` ใช้การตรวจสอบนี้สำหรับการดำเนินการเพิ่ม/อัปเดต และยังตรวจสอบชื่อ server ด้วย:

- ต้องไม่ว่างเปล่า
- สูงสุด 100 ตัวอักษร
- เฉพาะ `[a-zA-Z0-9_.-]` เท่านั้น

### ข้อควรระวังเกี่ยวกับ transport

- การละเว้น `type` หมายถึง stdio หากคุณตั้งใจจะใช้ HTTP/SSE แต่ละเว้น `type` ไป `command` จะกลายเป็นฟิลด์บังคับ
- `sse` ยังคงยอมรับได้แต่ถูกปฏิบัติเป็น HTTP transport ภายใน (`createHttpTransport`)
- การตรวจสอบเป็นเชิงโครงสร้าง ไม่ใช่เชิงการเข้าถึง: URL ที่ถูกต้องทาง syntax ยังสามารถล้มเหลวได้ตอนเชื่อมต่อ

## 2) การค้นพบ การทำให้เป็นมาตรฐาน และลำดับความสำคัญ

### การค้นพบแบบ capability-based

`loadAllMCPConfigs()` (`src/mcp/config.ts`) โหลดรายการ `MCPServer` แบบ canonical ผ่าน `loadCapability(mcpCapability.id)`

ชั้น capability (`src/capability/index.ts`) จากนั้น:

1. โหลด provider ตามลำดับความสำคัญ
2. กำจัดรายการซ้ำตาม `server.name` (ตัวแรกชนะ = ลำดับความสำคัญสูงสุด)
3. ตรวจสอบรายการที่กำจัดรายการซ้ำแล้ว

ผลลัพธ์: ชื่อ server ที่ซ้ำกันจากแหล่งต่างๆ ไม่ถูกรวมเข้าด้วยกัน คำจำกัดความหนึ่งจะชนะ; รายการซ้ำที่มีลำดับความสำคัญต่ำกว่าจะถูกบดบัง

### `.mcp.json` และไฟล์ที่เกี่ยวข้อง

provider สำรองเฉพาะใน `src/discovery/mcp-json.ts` อ่าน `mcp.json` และ `.mcp.json` ที่ root ของโปรเจกต์ (ลำดับความสำคัญต่ำ)

ในทางปฏิบัติ MCP server ยังมาจาก provider ที่มีลำดับความสำคัญสูงกว่าด้วย (เช่น native `.xcsh/...` และไดเรกทอรี config เฉพาะ tool) คำแนะนำในการเขียน:

- ควรใช้ `.xcsh/mcp.json` (โปรเจกต์) หรือ `~/.xcsh/mcp.json` (ผู้ใช้) เพื่อการควบคุมที่ชัดเจน
- ใช้ `mcp.json` / `.mcp.json` ที่ root เมื่อคุณต้องการความเข้ากันได้แบบ fallback
- การใช้ชื่อ server เดียวกันในหลายแหล่งจะทำให้เกิดการบดบังตามลำดับความสำคัญ ไม่ใช่การรวม

### พฤติกรรมการทำให้เป็นมาตรฐาน

`convertToLegacyConfig()` (`src/mcp/config.ts`) แปลง `MCPServer` แบบ canonical เป็น `MCPServerConfig` สำหรับ runtime

พฤติกรรมสำคัญ:

- transport ถูกอนุมานเป็น `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- server ที่ถูกปิดใช้งาน (`enabled === false`) จะถูกตัดออกก่อนการเชื่อมต่อ
- ฟิลด์ที่ไม่บังคับจะถูกรักษาไว้เมื่อมีอยู่

### การขยายตัวแปรสภาพแวดล้อมระหว่างการค้นพบ

`mcp-json.ts` ขยาย placeholder ของ env ในฟิลด์สตริงด้วย `expandEnvVarsDeep()`:

- รองรับ `${VAR}` และ `${VAR:-default}`
- ค่าที่ไม่สามารถแก้ไขได้จะคงเป็นสตริง `${VAR}` ตามตัวอักษร

`mcp-json.ts` ยังดำเนินการตรวจสอบประเภทที่ runtime สำหรับ JSON ของผู้ใช้ และบันทึกคำเตือนสำหรับค่า `enabled`/`timeout` ที่ไม่ถูกต้อง แทนที่จะทำให้ไฟล์ทั้งหมดล้มเหลว

## 3) การพิสูจน์ตัวตนและการแก้ไขค่าที่ runtime

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) เป็นขั้นตอนก่อนการเชื่อมต่อขั้นสุดท้าย

### การฉีด OAuth credential

หาก config มี:

```ts
auth: { type: "oauth", credentialId: "..." }
```

และ credential มีอยู่ใน auth storage:

- `http`/`sse`: ฉีด header `Authorization: Bearer <access_token>`
- `stdio`: ฉีดตัวแปรสภาพแวดล้อม `OAUTH_ACCESS_TOKEN`

หากการค้นหา credential ล้มเหลว manager จะบันทึกคำเตือนและดำเนินการต่อโดยไม่มีการแก้ไข auth

### การแก้ไขค่า header/env

ก่อนการเชื่อมต่อ manager จะแก้ไขค่า header/env แต่ละตัวผ่าน `resolveConfigValue()` (`src/config/resolve-config-value.ts`):

- ค่าที่เริ่มต้นด้วย `!` => รันคำสั่ง shell, ใช้ stdout ที่ตัด whitespace แล้ว (มีการ cache)
- มิฉะนั้น ปฏิบัติกับค่าเป็นชื่อตัวแปรสภาพแวดล้อมก่อน (`process.env[name]`) แล้ว fallback เป็นค่าตัวอักษร
- ค่า command/env ที่แก้ไขไม่ได้จะถูกละเว้นจาก map สุดท้ายของ headers/env

ข้อควรระวังในการดำเนินงาน: นี่หมายความว่าคำสั่ง secret หรือคีย์ env ที่พิมพ์ผิดสามารถลบรายการ header/env นั้นออกอย่างเงียบๆ ทำให้เกิดข้อผิดพลาด 401/403 หรือ server startup ล้มเหลวในขั้นถัดไป

## 4) Tool bridge: MCP -> agent-callable tools

`src/mcp/tool-bridge.ts` แปลงคำจำกัดความ MCP tool เป็น `CustomTool`

### ขอบเขตการตั้งชื่อและการชนกัน

ชื่อ tool ถูกสร้างเป็น:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

กฎ:

- แปลงเป็นตัวพิมพ์เล็ก
- ตัวอักษรที่ไม่ใช่ `[a-z_]` จะกลายเป็น `_`
- เครื่องหมายขีดล่างซ้ำจะถูกรวมเข้าด้วยกัน
- prefix `<server>_` ที่ซ้ำซ้อนในชื่อ tool จะถูกตัดออกหนึ่งครั้ง

วิธีนี้หลีกเลี่ยงการชนกันได้หลายกรณี แต่ไม่ทั้งหมด ชื่อดิบที่แตกต่างกันยังสามารถถูก sanitize เป็นตัวระบุเดียวกันได้ (เช่น `my-server` และ `my.server` ทั้งคู่ถูก sanitize ในลักษณะคล้ายกัน) และการแทรกเข้า registry จะเป็นแบบ last-write-wins

### การแปลง schema

`convertSchema()` คง MCP JSON Schema ไว้ส่วนใหญ่ตามเดิมแต่แก้ไข object schema ที่ขาด `properties` ด้วย `{}` เพื่อความเข้ากันได้ของ provider

### การแปลงการทำงาน

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- เรียก MCP `tools/call`
- แปลง MCP content ให้เป็นข้อความที่แสดงผลได้
- ส่งคืนรายละเอียดแบบมีโครงสร้าง (`serverName`, `mcpToolName`, metadata ของ provider)
- แปลง `isError` ที่ server รายงานเป็นผลลัพธ์ข้อความ `Error: ...`
- แปลงข้อผิดพลาด transport/runtime ที่ throw ออกมาเป็น `MCP error: ...`
- รักษา semantics ของการยกเลิกโดยแปลง AbortError เป็น `ToolAbortError`

## 5) วงจรชีวิตของผู้ดูแลระบบ: เพิ่ม/แก้ไข/ลบ และการอัปเดตแบบ live

โหมด interactive เปิดเผย `/mcp` ใน `src/modes/controllers/mcp-command-controller.ts`

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

`refreshMCPTools()` แทนที่รายการ `mcp_` ทั้งหมดใน registry และเปิดใช้งานชุด MCP tool ล่าสุดทันที ดังนั้นการเปลี่ยนแปลงจะมีผลโดยไม่ต้องรีสตาร์ทเซสชัน

### ความแตกต่างของโหมด

- **โหมด Interactive/TUI**: `/mcp` ให้ UX ภายในแอป (wizard, OAuth flow, ข้อความสถานะการเชื่อมต่อ, การ rebinding ที่ runtime ทันที)
- **การรวม SDK/headless**: `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) ส่งคืน tool ที่โหลดแล้ว + ข้อผิดพลาดต่อ server; ไม่มี UX ของคำสั่ง `/mcp`

## 6) พื้นผิวข้อผิดพลาดที่ผู้ใช้เห็น

สตริงข้อผิดพลาดทั่วไปที่ผู้ใช้/ผู้ดูแลระบบเห็น:

- ข้อผิดพลาดการตรวจสอบเมื่อเพิ่ม/อัปเดต:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- ปัญหาอาร์กิวเมนต์ของ quick-add:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- ข้อผิดพลาดการเชื่อมต่อ/ทดสอบ:
  - `Failed to connect to "<name>": <message>`
  - ข้อความช่วยเหลือเกี่ยวกับ timeout แนะนำให้เพิ่มค่า timeout
  - ข้อความช่วยเหลือเกี่ยวกับ auth สำหรับ `401/403`
- กระบวนการ auth/OAuth:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- การใช้ server ที่ถูกปิดใช้งาน:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

JSON ต้นทางที่ไม่ถูกต้องในการค้นพบจะถูกจัดการเป็นคำเตือน/log โดยทั่วไป; เส้นทาง config-writer จะ throw ข้อผิดพลาดอย่างชัดเจน

## 7) คำแนะนำเชิงปฏิบัติในการเขียน

สำหรับการเขียน MCP ที่แข็งแกร่งใน codebase นี้:

1. รักษาชื่อ server ให้ไม่ซ้ำกันทั่วโลกในทุกแหล่ง config ที่รองรับ MCP
2. ควรใช้ชื่อที่เป็นตัวอักษรและตัวเลข/ขีดล่างเพื่อหลีกเลี่ยงการชนกันของชื่อที่ถูก sanitize ในชื่อ `mcp_*` tool ที่สร้างขึ้น
3. ใช้ `type` อย่างชัดเจนเพื่อหลีกเลี่ยงค่าเริ่มต้น stdio โดยไม่ตั้งใจ
4. ปฏิบัติกับ `enabled: false` เป็นการปิดอย่างสมบูรณ์: server จะถูกละเว้นจากชุดการเชื่อมต่อที่ runtime
5. สำหรับ config ที่ใช้ OAuth ให้เก็บ `credentialId` ที่ถูกต้อง มิฉะนั้นการฉีด auth จะถูกข้าม
6. หากใช้การแก้ไข secret แบบ command-based (`!cmd`) ให้ตรวจสอบว่าผลลัพธ์ของคำสั่งมีเสถียรภาพและไม่ว่างเปล่า

## ไฟล์ที่ใช้ในการ implement

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
