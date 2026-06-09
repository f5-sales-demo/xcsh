---
title: การสร้าง MCP Server และ Tool
description: >-
  คู่มือสำหรับการสร้าง MCP server แบบกำหนดเองและการลงทะเบียน tool สำหรับ coding
  agent
sidebar:
  order: 4
  label: การสร้าง Server และ Tool
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# การสร้าง MCP server และ tool

เอกสารนี้อธิบายว่า MCP server definition กลายเป็น `mcp_*` tool ที่เรียกใช้ได้ใน coding-agent ได้อย่างไร และสิ่งที่ผู้ดำเนินการควรคาดหวังเมื่อ config ไม่ถูกต้อง ซ้ำกัน ถูกปิดใช้งาน หรือถูกจำกัดด้วย auth

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

- `stdio` (ค่าเริ่มต้นเมื่อไม่ระบุ `type`): ต้องการ `command`, ตัวเลือก `args`, `env`, `cwd`
- `http`: ต้องการ `url`, ตัวเลือก `headers`
- `sse`: ต้องการ `url`, ตัวเลือก `headers` (คงไว้เพื่อความเข้ากันได้)
- ฟิลด์ร่วม: `enabled`, `timeout`, `auth`

`validateServerConfig()` (`src/mcp/config.ts`) บังคับใช้พื้นฐาน transport:

- ปฏิเสธ config ที่กำหนดทั้ง `command` และ `url`
- ต้องการ `command` สำหรับ stdio
- ต้องการ `url` สำหรับ http/sse
- ปฏิเสธ `type` ที่ไม่รู้จัก

`config-writer.ts` ใช้การตรวจสอบนี้สำหรับการดำเนินการเพิ่ม/อัปเดต และยังตรวจสอบชื่อ server ด้วย:

- ต้องไม่เป็นค่าว่าง
- สูงสุด 100 ตัวอักษร
- เฉพาะ `[a-zA-Z0-9_.-]`

### ข้อผิดพลาดที่พบบ่อยเกี่ยวกับ Transport

- การละเว้น `type` หมายถึง stdio หากคุณตั้งใจจะใช้ HTTP/SSE แต่ไม่ระบุ `type` จะทำให้ `command` กลายเป็นฟิลด์บังคับ
- `sse` ยังคงได้รับการยอมรับแต่ถูกจัดการเป็น HTTP transport ภายใน (`createHttpTransport`)
- การตรวจสอบเป็นเชิงโครงสร้าง ไม่ใช่ความสามารถในการเข้าถึง: URL ที่ถูกต้องตาม syntax ยังคงอาจล้มเหลวในขั้นตอนการเชื่อมต่อ

## 2) การค้นพบ การทำให้เป็นมาตรฐาน และลำดับความสำคัญ

### การค้นพบตาม Capability

`loadAllMCPConfigs()` (`src/mcp/config.ts`) โหลดรายการ `MCPServer` แบบ canonical ผ่าน `loadCapability(mcpCapability.id)`

ชั้น capability (`src/capability/index.ts`) จากนั้น:

1. โหลด provider ตามลำดับความสำคัญ
2. กำจัดรายการซ้ำตาม `server.name` (รายการแรกชนะ = ความสำคัญสูงสุด)
3. ตรวจสอบรายการที่กำจัดซ้ำแล้ว

ผลลัพธ์: ชื่อ server ซ้ำกันข้ามแหล่งข้อมูลจะไม่ถูกรวม คำจำกัดความหนึ่งชนะ; รายการซ้ำที่มีความสำคัญต่ำกว่าจะถูกบดบัง

### `.mcp.json` และไฟล์ที่เกี่ยวข้อง

Provider สำรองเฉพาะใน `src/discovery/mcp-json.ts` อ่าน `mcp.json` และ `.mcp.json` ที่ root ของโปรเจกต์ (ความสำคัญต่ำ)

ในทางปฏิบัติ MCP server ยังมาจาก provider ที่มีความสำคัญสูงกว่า (เช่น `.xcsh/...` แบบ native และไดเรกทอรี config เฉพาะเครื่องมือ) คำแนะนำในการเขียน:

- ใช้ `.xcsh/mcp.json` (โปรเจกต์) หรือ `~/.xcsh/mcp.json` (ผู้ใช้) เพื่อการควบคุมที่ชัดเจน
- ใช้ `mcp.json` / `.mcp.json` ที่ root เมื่อคุณต้องการความเข้ากันได้แบบสำรอง
- การใช้ชื่อ server ซ้ำในหลายแหล่งจะทำให้เกิดการบดบังตามลำดับความสำคัญ ไม่ใช่การรวม

### พฤติกรรมการทำให้เป็นมาตรฐาน

`convertToLegacyConfig()` (`src/mcp/config.ts`) แมป `MCPServer` แบบ canonical ไปยัง `MCPServerConfig` ของ runtime

พฤติกรรมสำคัญ:

- transport อนุมานจาก `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- server ที่ถูกปิดใช้งาน (`enabled === false`) จะถูกตัดออกก่อนการเชื่อมต่อ
- ฟิลด์ที่เป็นตัวเลือกจะถูกเก็บรักษาไว้เมื่อมีอยู่

### การขยายตัวแปรสภาพแวดล้อมระหว่างการค้นพบ

`mcp-json.ts` ขยาย placeholder ของ env ในฟิลด์ string ด้วย `expandEnvVarsDeep()`:

- รองรับ `${VAR}` และ `${VAR:-default}`
- ค่าที่ไม่ได้รับการแก้ไขจะยังคงเป็นสตริง `${VAR}` ตามตัวอักษร

`mcp-json.ts` ยังทำการตรวจสอบชนิดข้อมูลขณะรันไทม์สำหรับ JSON ของผู้ใช้ และบันทึกคำเตือนสำหรับค่า `enabled`/`timeout` ที่ไม่ถูกต้องแทนที่จะทำให้ไฟล์ทั้งหมดล้มเหลว

## 3) Auth และการแก้ไขค่าขณะรันไทม์

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) เป็นขั้นตอนสุดท้ายก่อนการเชื่อมต่อ

### การแทรก OAuth credential

หาก config มี:

```ts
auth: { type: "oauth", credentialId: "..." }
```

และ credential มีอยู่ใน auth storage:

- `http`/`sse`: แทรก header `Authorization: Bearer <access_token>`
- `stdio`: แทรกตัวแปรสภาพแวดล้อม `OAUTH_ACCESS_TOKEN`

หากการค้นหา credential ล้มเหลว manager จะบันทึกคำเตือนและดำเนินการต่อด้วย auth ที่ยังไม่ได้แก้ไข

### การแก้ไขค่า Header/env

ก่อนเชื่อมต่อ manager จะแก้ไขค่า header/env แต่ละค่าผ่าน `resolveConfigValue()` (`src/config/resolve-config-value.ts`):

- ค่าที่ขึ้นต้นด้วย `!` => รันคำสั่ง shell ใช้ stdout ที่ตัดช่องว่าง (มีการ cache)
- มิฉะนั้น ถือว่าค่าเป็นชื่อตัวแปรสภาพแวดล้อมก่อน (`process.env[name]`) สำรองเป็นค่าตามตัวอักษร
- ค่าคำสั่ง/env ที่ไม่ได้รับการแก้ไขจะถูกตัดออกจาก map ของ headers/env สุดท้าย

ข้อควรระวังในการดำเนินการ: หมายความว่าคำสั่ง secret หรือ key ของ env ที่พิมพ์ผิดสามารถลบ header/env entry นั้นออกอย่างเงียบๆ ทำให้เกิดข้อผิดพลาด 401/403 ที่ปลายทางหรือการเริ่มต้น server ล้มเหลว

## 4) Tool bridge: MCP -> tool ที่ agent เรียกใช้ได้

`src/mcp/tool-bridge.ts` แปลงคำจำกัดความ MCP tool เป็น `CustomTool`

### การตั้งชื่อและขอบเขตการชนกัน

ชื่อ tool ถูกสร้างเป็น:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

กฎ:

- ตัวพิมพ์เล็ก
- ตัวอักษรที่ไม่ใช่ `[a-z_]` จะกลายเป็น `_`
- ขีดล่างที่ซ้ำกันจะถูกยุบ
- prefix `<server>_` ที่ซ้ำซ้อนในชื่อ tool จะถูกตัดออกหนึ่งครั้ง

สิ่งนี้หลีกเลี่ยงการชนกันได้มาก แต่ไม่ทั้งหมด ชื่อดิบที่แตกต่างกันยังคงสามารถ sanitize เป็นตัวระบุเดียวกันได้ (เช่น `my-server` และ `my.server` ทั้งคู่ sanitize ได้คล้ายกัน) และการแทรกใน registry เป็นแบบเขียนครั้งสุดท้ายชนะ

### การแมป Schema

`convertSchema()` คง MCP JSON Schema ไว้ส่วนใหญ่ตามเดิม แต่แก้ไข object schema ที่ขาด `properties` ด้วย `{}` เพื่อความเข้ากันได้ของ provider

### การแมปการทำงาน

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- เรียก MCP `tools/call`
- ทำให้ MCP content เป็นข้อความที่แสดงผลได้
- คืนรายละเอียดแบบมีโครงสร้าง (`serverName`, `mcpToolName`, metadata ของ provider)
- แมป `isError` ที่ server รายงานเป็นผลลัพธ์ข้อความ `Error: ...`
- แมปข้อผิดพลาด transport/runtime ที่ถูก throw เป็น `MCP error: ...`
- รักษา abort semantics โดยแปลง AbortError เป็น `ToolAbortError`

## 5) วงจรชีวิตผู้ดำเนินการ: เพิ่ม/แก้ไข/ลบ และอัปเดตแบบสด

โหมด Interactive เปิดเผย `/mcp` ใน `src/modes/controllers/mcp-command-controller.ts`

การดำเนินการที่รองรับ:

- `add` (wizard หรือ quick-add)
- `remove` / `rm`
- `enable` / `disable`
- `test`
- `reauth` / `unauth`
- `reload`

การเขียน config เป็นแบบ atomic (`writeMCPConfigFile`: ไฟล์ชั่วคราว + rename)

หลังจากการเปลี่ยนแปลง controller จะเรียก `#reloadMCP()`:

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

`refreshMCPTools()` แทนที่รายการ `mcp_` ทั้งหมดใน registry และเปิดใช้งานชุด MCP tool ล่าสุดทันที ดังนั้นการเปลี่ยนแปลงจะมีผลโดยไม่ต้องรีสตาร์ท session

### ความแตกต่างของโหมด

- **โหมด Interactive/TUI**: `/mcp` ให้ UX ในแอป (wizard, OAuth flow, ข้อความสถานะการเชื่อมต่อ, การผูก runtime ใหม่ทันที)
- **การรวม SDK/headless**: `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) คืน tool ที่โหลดแล้ว + ข้อผิดพลาดต่อ server; ไม่มี UX คำสั่ง `/mcp`

## 6) พื้นผิวข้อผิดพลาดที่ผู้ใช้มองเห็นได้

สตริงข้อผิดพลาดทั่วไปที่ผู้ใช้/ผู้ดำเนินการจะเห็น:

- ข้อผิดพลาดการตรวจสอบการเพิ่ม/อัปเดต:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- ปัญหาอาร์กิวเมนต์ quick-add:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- ข้อผิดพลาดการเชื่อมต่อ/ทดสอบ:
  - `Failed to connect to "<name>": <message>`
  - ข้อความช่วยเหลือ timeout แนะนำให้เพิ่ม timeout
  - ข้อความช่วยเหลือ auth สำหรับ `401/403`
- auth/OAuth flow:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- การใช้ server ที่ถูกปิดใช้งาน:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

JSON แหล่งข้อมูลที่ไม่ถูกต้องในการค้นพบโดยทั่วไปจะถูกจัดการเป็นคำเตือน/log; เส้นทาง config-writer จะ throw ข้อผิดพลาดอย่างชัดเจน

## 7) คำแนะนำเชิงปฏิบัติสำหรับการเขียน

สำหรับการเขียน MCP ที่แข็งแกร่งใน codebase นี้:

1. รักษาชื่อ server ให้ไม่ซ้ำกันทั่วโลกข้ามแหล่ง config ที่รองรับ MCP ทั้งหมด
2. ใช้ชื่อที่เป็นตัวอักษร ตัวเลข/ขีดล่างเพื่อหลีกเลี่ยงการชนกันของชื่อที่ถูก sanitize ในชื่อ `mcp_*` tool ที่สร้างขึ้น
3. ใช้ `type` อย่างชัดเจนเพื่อหลีกเลี่ยงค่าเริ่มต้น stdio โดยไม่ตั้งใจ
4. ถือว่า `enabled: false` เป็นการปิดอย่างสมบูรณ์: server จะถูกตัดออกจากชุดการเชื่อมต่อขณะรันไทม์
5. สำหรับ config OAuth ให้เก็บ `credentialId` ที่ถูกต้อง มิฉะนั้นการแทรก auth จะถูกข้าม
6. หากใช้การแก้ไข secret ด้วยคำสั่ง (`!cmd`) ให้ตรวจสอบว่าผลลัพธ์ของคำสั่งมีเสถียรภาพและไม่เป็นค่าว่าง

## ไฟล์การ implement

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
