---
title: MCP Server and Tool Authoring
description: >-
  คู่มือการสร้าง MCP server แบบกำหนดเองและการลงทะเบียนเครื่องมือสำหรับ coding
  agent
sidebar:
  order: 4
  label: การเขียน Server และ Tool
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# การเขียน MCP server และ tool

เอกสารนี้อธิบายว่า MCP server definitions กลายเป็น `mcp_*` tools ที่เรียกใช้ได้ใน coding-agent อย่างไร และสิ่งที่ผู้ดูแลระบบควรคาดหวังเมื่อ configs ไม่ถูกต้อง ซ้ำกัน ถูกปิดใช้งาน หรือมีการควบคุมด้วย auth

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

`src/mcp/types.ts` กำหนดรูปแบบการเขียนที่ใช้โดยผู้เขียน MCP config และ runtime:

- `stdio` (ค่าเริ่มต้นเมื่อไม่ระบุ `type`): ต้องมี `command`, ตัวเลือกเสริม `args`, `env`, `cwd`
- `http`: ต้องมี `url`, ตัวเลือกเสริม `headers`
- `sse`: ต้องมี `url`, ตัวเลือกเสริม `headers` (คงไว้เพื่อความเข้ากันได้)
- ฟิลด์ที่ใช้ร่วมกัน: `enabled`, `timeout`, `auth`

`validateServerConfig()` (`src/mcp/config.ts`) บังคับใช้พื้นฐานของ transport:

- ปฏิเสธ configs ที่ตั้งค่าทั้ง `command` และ `url`
- ต้องมี `command` สำหรับ stdio
- ต้องมี `url` สำหรับ http/sse
- ปฏิเสธ `type` ที่ไม่รู้จัก

`config-writer.ts` ใช้การตรวจสอบนี้สำหรับการดำเนินการ add/update และยังตรวจสอบชื่อ server ด้วย:

- ต้องไม่ว่าง
- สูงสุด 100 ตัวอักษร
- อนุญาตเฉพาะ `[a-zA-Z0-9_.-]`

### ข้อควรระวังของ Transport

- การละเว้น `type` หมายถึง stdio หากคุณตั้งใจจะใช้ HTTP/SSE แต่ละเว้น `type` จะทำให้ `command` กลายเป็นฟิลด์บังคับ
- `sse` ยังคงยอมรับได้แต่ถูกจัดการเป็น HTTP transport ภายใน (`createHttpTransport`)
- การตรวจสอบเป็นเชิงโครงสร้าง ไม่ใช่การเชื่อมต่อจริง: URL ที่ถูกต้องตามรูปแบบยังคงอาจล้มเหลวในขั้นตอนการเชื่อมต่อ

## 2) การค้นหา การทำให้เป็นมาตรฐาน และลำดับความสำคัญ

### การค้นหาแบบ Capability-based

`loadAllMCPConfigs()` (`src/mcp/config.ts`) โหลดรายการ `MCPServer` แบบ canonical ผ่าน `loadCapability(mcpCapability.id)`

ชั้น capability (`src/capability/index.ts`) จะ:

1. โหลด providers ตามลำดับความสำคัญ
2. กำจัดรายการซ้ำตาม `server.name` (รายการแรกที่พบ = ความสำคัญสูงสุด)
3. ตรวจสอบรายการที่กำจัดซ้ำแล้ว

ผลลัพธ์: ชื่อ server ที่ซ้ำกันจากแหล่งต่าง ๆ จะไม่ถูกรวมกัน definition หนึ่งจะชนะ; รายการซ้ำที่มีความสำคัญต่ำกว่าจะถูกบดบัง

### `.mcp.json` และไฟล์ที่เกี่ยวข้อง

Provider สำรองเฉพาะใน `src/discovery/mcp-json.ts` อ่าน `mcp.json` และ `.mcp.json` ที่ root ของโปรเจกต์ (ความสำคัญต่ำ)

ในทางปฏิบัติ MCP servers ยังมาจาก providers ที่มีความสำคัญสูงกว่า (เช่น native `.xcsh/...` และไดเรกทอรี config เฉพาะเครื่องมือ) แนวทางการเขียน:

- แนะนำให้ใช้ `.xcsh/mcp.json` (โปรเจกต์) หรือ `~/.xcsh/mcp.json` (ผู้ใช้) เพื่อการควบคุมที่ชัดเจน
- ใช้ `mcp.json` / `.mcp.json` ที่ root เมื่อต้องการความเข้ากันได้แบบสำรอง
- การใช้ชื่อ server เดียวกันในหลายแหล่งจะทำให้เกิดการบดบังตามลำดับความสำคัญ ไม่ใช่การรวม

### พฤติกรรมการทำให้เป็นมาตรฐาน

`convertToLegacyConfig()` (`src/mcp/config.ts`) แปลง `MCPServer` แบบ canonical ไปเป็น `MCPServerConfig` สำหรับ runtime

พฤติกรรมสำคัญ:

- transport อนุมานเป็น `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- servers ที่ปิดใช้งาน (`enabled === false`) จะถูกตัดออกก่อนการเชื่อมต่อ
- ฟิลด์ตัวเลือกเสริมจะถูกรักษาไว้เมื่อมีอยู่

### การขยายค่า Environment ระหว่างการค้นหา

`mcp-json.ts` ขยาย env placeholders ในฟิลด์ string ด้วย `expandEnvVarsDeep()`:

- รองรับ `${VAR}` และ `${VAR:-default}`
- ค่าที่ไม่สามารถแก้ไขได้จะยังคงเป็น string ตัวอักษร `${VAR}`

`mcp-json.ts` ยังทำการตรวจสอบ type ในขณะ runtime สำหรับ JSON ของผู้ใช้ และบันทึกคำเตือนสำหรับค่า `enabled`/`timeout` ที่ไม่ถูกต้อง แทนที่จะทำให้ไฟล์ทั้งหมดล้มเหลว

## 3) Auth และการแก้ไขค่าใน runtime

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) เป็นขั้นตอนสุดท้ายก่อนการเชื่อมต่อ

### การฉีด OAuth credential

หาก config มี:

```ts
auth: { type: "oauth", credentialId: "..." }
```

และ credential มีอยู่ใน auth storage:

- `http`/`sse`: ฉีด header `Authorization: Bearer <access_token>`
- `stdio`: ฉีดตัวแปร env `OAUTH_ACCESS_TOKEN`

หากการค้นหา credential ล้มเหลว manager จะบันทึกคำเตือนและดำเนินการต่อโดยไม่แก้ไข auth

### การแก้ไขค่า Header/env

ก่อนการเชื่อมต่อ manager จะแก้ไขค่า header/env แต่ละค่าผ่าน `resolveConfigValue()` (`src/config/resolve-config-value.ts`):

- ค่าที่ขึ้นต้นด้วย `!` => รันคำสั่ง shell ใช้ stdout ที่ตัดช่องว่าง (มี cache)
- มิฉะนั้น ถือว่าค่าเป็นชื่อตัวแปร environment ก่อน (`process.env[name]`) แล้วจึงใช้ค่าตัวอักษรตรงตัว
- ค่า command/env ที่ไม่สามารถแก้ไขได้จะถูกละเว้นจากแผนผัง headers/env สุดท้าย

ข้อควรระวังในการดำเนินงาน: นี่หมายความว่าคีย์ secret command/env ที่พิมพ์ผิดสามารถลบรายการ header/env นั้นอย่างเงียบ ๆ ทำให้เกิด 401/403 ที่ปลายทาง หรือความล้มเหลวในการเริ่ม server

## 4) Tool bridge: MCP -> เครื่องมือที่ agent เรียกใช้ได้

`src/mcp/tool-bridge.ts` แปลง MCP tool definitions ให้เป็น `CustomTool`s

### การตั้งชื่อและขอบเขตการชนกัน

ชื่อเครื่องมือถูกสร้างเป็น:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

กฎ:

- แปลงเป็นตัวพิมพ์เล็ก
- อักขระที่ไม่ใช่ `[a-z_]` จะกลายเป็น `_`
- ขีดล่างซ้ำจะถูกยุบรวม
- prefix `<server>_` ที่ซ้ำซ้อนในชื่อเครื่องมือจะถูกตัดออกหนึ่งครั้ง

สิ่งนี้หลีกเลี่ยงการชนกันได้หลายกรณี แต่ไม่ใช่ทั้งหมด ชื่อดิบที่ต่างกันยังคงอาจ sanitize เป็น identifier เดียวกันได้ (เช่น `my-server` และ `my.server` ต่าง sanitize ได้คล้ายกัน) และการแทรกลงใน registry เป็นแบบ last-write-wins

### การแปลง Schema

`convertSchema()` คงรักษา MCP JSON Schema ส่วนใหญ่ไว้ตามเดิม แต่จะแก้ไข object schemas ที่ขาด `properties` ด้วย `{}` เพื่อความเข้ากันได้กับ provider

### การแปลงการทำงาน

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- เรียก MCP `tools/call`
- ยุบ MCP content ให้เป็นข้อความที่แสดงผลได้
- ส่งคืนรายละเอียดที่มีโครงสร้าง (`serverName`, `mcpToolName`, provider metadata)
- แปลง `isError` ที่ server รายงานเป็นผลลัพธ์ข้อความ `Error: ...`
- แปลง transport/runtime failures ที่ throw ไปเป็น `MCP error: ...`
- รักษา abort semantics โดยแปลง AbortError เป็น `ToolAbortError`

## 5) วงจรชีวิตของผู้ดูแลระบบ: add/edit/remove และการอัปเดตแบบ live

โหมดโต้ตอบเปิดเผย `/mcp` ใน `src/modes/controllers/mcp-command-controller.ts`

การดำเนินการที่รองรับ:

- `add` (wizard หรือ quick-add)
- `remove` / `rm`
- `enable` / `disable`
- `test`
- `reauth` / `unauth`
- `reload`

การเขียน config เป็นแบบ atomic (`writeMCPConfigFile`: temp file + rename)

หลังจากเปลี่ยนแปลง controller จะเรียก `#reloadMCP()`:

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

`refreshMCPTools()` จะแทนที่รายการ `mcp_` ทั้งหมดใน registry และเปิดใช้งานชุด MCP tool ล่าสุดทันที ดังนั้นการเปลี่ยนแปลงจะมีผลโดยไม่ต้องเริ่ม session ใหม่

### ความแตกต่างของโหมด

- **โหมดโต้ตอบ/TUI**: `/mcp` ให้ UX ในแอป (wizard, OAuth flow, ข้อความสถานะการเชื่อมต่อ, การ rebind runtime ทันที)
- **การผสานรวม SDK/headless**: `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) ส่งคืนเครื่องมือที่โหลดแล้ว + ข้อผิดพลาดต่อ server; ไม่มี UX คำสั่ง `/mcp`

## 6) พื้นผิวข้อผิดพลาดที่ผู้ใช้มองเห็น

string ข้อผิดพลาดทั่วไปที่ผู้ใช้/ผู้ดูแลระบบจะเห็น:

- ความล้มเหลวในการตรวจสอบ add/update:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- ปัญหา argument ของ quick-add:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- ความล้มเหลวในการเชื่อมต่อ/ทดสอบ:
  - `Failed to connect to "<name>": <message>`
  - ข้อความช่วยเหลือเรื่อง timeout แนะนำให้เพิ่ม timeout
  - ข้อความช่วยเหลือเรื่อง auth สำหรับ `401/403`
- auth/OAuth flows:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- การใช้งาน server ที่ถูกปิดใช้งาน:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

JSON ต้นทางที่ไม่ดีในการค้นหาโดยทั่วไปจะถูกจัดการเป็นคำเตือน/logs; เส้นทาง config-writer จะ throw ข้อผิดพลาดอย่างชัดเจน

## 7) แนวทางปฏิบัติในการเขียน

สำหรับการเขียน MCP ที่แข็งแกร่งใน codebase นี้:

1. รักษาชื่อ server ให้ไม่ซ้ำกันทั่วโลกในทุกแหล่ง config ที่รองรับ MCP
2. แนะนำให้ใช้ชื่อแบบตัวอักษร-ตัวเลข/ขีดล่าง เพื่อหลีกเลี่ยงการชนกันของชื่อที่ sanitize แล้วในชื่อเครื่องมือ `mcp_*` ที่สร้างขึ้น
3. ใช้ `type` อย่างชัดเจนเพื่อหลีกเลี่ยงค่าเริ่มต้น stdio โดยไม่ตั้งใจ
4. ถือว่า `enabled: false` เป็นการปิดอย่างสมบูรณ์: server จะถูกละเว้นจากชุดการเชื่อมต่อ runtime
5. สำหรับ OAuth configs ให้จัดเก็บ `credentialId` ที่ถูกต้อง มิฉะนั้นการฉีด auth จะถูกข้าม
6. หากใช้การแก้ไข secret แบบ command-based (`!cmd`) ให้ตรวจสอบว่า output ของคำสั่งมีความเสถียรและไม่ว่างเปล่า

## ไฟล์ implementation

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
