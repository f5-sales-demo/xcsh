---
title: วงจรชีวิตรันไทม์ MCP
description: >-
  วงจรชีวิตกระบวนการ MCP server ตั้งแต่การเริ่มต้นจนถึงการลงทะเบียนเครื่องมือ
  การตรวจสอบสุขภาพ และการปิดระบบ
sidebar:
  order: 3
  label: วงจรชีวิตรันไทม์
i18n:
  sourceHash: d04cefaf38f8
  translator: machine
---

# วงจรชีวิตรันไทม์ MCP

เอกสารนี้อธิบายวิธีที่ MCP servers ถูกค้นหา เชื่อมต่อ เปิดเผยในฐานะเครื่องมือ รีเฟรช และปิดลงใน coding-agent runtime

## ภาพรวมวงจรชีวิต

1. **การเริ่มต้น SDK** เรียก `discoverAndLoadMCPTools()` (เว้นแต่ MCP จะถูกปิดการใช้งาน)
2. **การค้นหา** (`loadAllMCPConfigs`) แก้ไขการกำหนดค่า MCP server จากแหล่ง capability กรองรายการที่ถูกปิดใช้งาน/project/Exa และเก็บรักษาข้อมูลเมตาของแหล่ง
3. **ขั้นตอนการเชื่อมต่อ Manager** (`MCPManager.connectServers`) เริ่มการเชื่อมต่อต่อ server + `tools/list` แบบขนาน
4. **ประตู Fast startup** รอสูงสุด 250ms จากนั้นอาจคืนค่า:
   - `MCPTool` ที่โหลดเสร็จสมบูรณ์,
   - ข้อผิดพลาดต่อ server,
   - หรือ `DeferredMCPTool` ที่แคชไว้สำหรับ server ที่ยังค้างอยู่
5. **การเชื่อมต่อ SDK** รวม MCP tools เข้ากับ runtime tool registry สำหรับ session
6. **Live session** สามารถรีเฟรช MCP tools ผ่านกระบวนการ `/mcp` (`disconnectAll` + ค้นหาใหม่ + `session.refreshMCPTools`)
7. **การปิดระบบ** เกิดขึ้นเมื่อผู้เรียกใช้งานเรียก `disconnectServer`/`disconnectAll`; manager ยังล้างการลงทะเบียน MCP tool สำหรับ server ที่ถูกตัดการเชื่อมต่อด้วย

## ขั้นตอนการค้นหาและโหลด

### เส้นทางเข้าจาก SDK

`createAgentSession()` ใน `src/sdk.ts` ดำเนินการเริ่มต้น MCP เมื่อ `enableMCP` เป็น true (ค่าเริ่มต้น):

- เรียก `discoverAndLoadMCPTools(cwd, { ... })`,
- ส่ง `authStorage`, cache storage และการตั้งค่า `mcp.enableProjectConfig`,
- ตั้งค่า `filterExa: true` เสมอ,
- บันทึกข้อผิดพลาดการโหลด/เชื่อมต่อต่อ server,
- เก็บ manager ที่คืนค่ากลับมาใน `toolSession.mcpManager` และผลลัพธ์ session

หาก `enableMCP` เป็น false การค้นหา MCP จะถูกข้ามทั้งหมด

### การค้นหา Config และการกรอง

`loadAllMCPConfigs()` (`src/mcp/config.ts`) โหลดรายการ MCP server แบบ canonical ผ่านการค้นหา capability จากนั้นแปลงเป็น `MCPServerConfig` แบบ legacy

พฤติกรรมการกรอง:

- `enableProjectConfig: false` ลบรายการระดับ project (`_source.level === "project"`)
- server ที่มี `enabled: false` จะถูกข้ามก่อนการพยายามเชื่อมต่อ
- Exa servers ถูกกรองออกโดยค่าเริ่มต้น และ API keys จะถูกดึงออกมาสำหรับการรวม native Exa tool

ผลลัพธ์รวมทั้ง `configs` และ `sources` (ข้อมูลเมตาที่ใช้ภายหลังสำหรับการระบุ provider)

### พฤติกรรมความล้มเหลวระดับการค้นหา

`discoverAndLoadMCPTools()` แยกแยะความล้มเหลวสองประเภท:

- **ความล้มเหลวหนักในการค้นหา** (exception จาก `manager.discoverAndConnect` มักจากการค้นหา config): คืนค่า tool set ว่างเปล่าและข้อผิดพลาดสังเคราะห์หนึ่งรายการ `{ path: ".mcp.json", error }`
- **ความล้มเหลว runtime/connect ต่อ server**: manager คืนค่าความสำเร็จบางส่วนพร้อม map `errors`; server อื่นๆ ดำเนินการต่อไป

ดังนั้นการเริ่มต้นจะไม่ทำให้ agent session ทั้งหมดล้มเหลวเมื่อ MCP server แต่ละตัวล้มเหลว

## โมเดลสถานะ Manager

`MCPManager` ติดตามวงจรชีวิตรันไทม์ด้วย registries แยกกัน:

- `#connections: Map<string, MCPServerConnection>` — server ที่เชื่อมต่อสมบูรณ์แล้ว
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — handshake กำลังดำเนินการ
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — เชื่อมต่อแล้วแต่ tools ยังโหลด
- `#tools: CustomTool[]` — มุมมอง MCP tool ปัจจุบันที่เปิดเผยต่อผู้เรียก
- `#sources: Map<string, SourceMeta>` — ข้อมูลเมตา provider/source แม้ก่อนการเชื่อมต่อเสร็จสมบูรณ์

`getConnectionStatus(name)` ดึงสถานะจาก map เหล่านี้:

- `connected` ถ้าอยู่ใน `#connections`,
- `connecting` ถ้า pending connect หรือ pending tool load,
- `disconnected` ในกรณีอื่น

## การสร้างการเชื่อมต่อและเวลาเริ่มต้น

## Pipeline การเชื่อมต่อต่อ server

สำหรับแต่ละ server ที่ค้นพบใน `connectServers()`:

1. เก็บ/อัปเดตข้อมูลเมตา source,
2. ข้ามถ้าเชื่อมต่อ/pending อยู่แล้ว,
3. ตรวจสอบฟิลด์ transport (`validateServerConfig`),
4. แก้ไข auth/shell substitutions (`#resolveAuthConfig`),
5. เรียก `connectToServer(name, resolvedConfig)`,
6. เรียก `listTools(connection)`,
7. แคช tool definitions (`MCPToolCache.set`) แบบ best-effort

พฤติกรรม `connectToServer()` (`src/mcp/client.ts`):

- สร้าง stdio หรือ HTTP/SSE transport,
- ดำเนินการ MCP `initialize` + `notifications/initialized`,
- ใช้ timeout (`config.timeout` หรือค่าเริ่มต้น 30 วินาที),
- ปิด transport เมื่อเกิดความล้มเหลวในการเริ่มต้น

### ประตู Fast startup + Deferred fallback

`connectServers()` รอบน race ระหว่าง:

- งาน connect/tool-load ทั้งหมดเสร็จสิ้น และ
- `STARTUP_TIMEOUT_MS = 250`

หลังจาก 250ms:

- งานที่สำเร็จกลายเป็น live `MCPTool`,
- งานที่ถูกปฏิเสธสร้างข้อผิดพลาดต่อ server,
- งานที่ยังค้างอยู่:
  - ใช้ tool definitions ที่แคชไว้หากมี (`MCPToolCache.get`) เพื่อสร้าง `DeferredMCPTool`,
  - มิฉะนั้นบล็อกจนกว่างาน pending เหล่านั้นจะเสร็จสิ้น

นี่คือโมเดลการเริ่มต้นแบบ hybrid: คืนค่าเร็วเมื่อมีแคช รอเพื่อความถูกต้องเมื่อไม่มีแคช

### พฤติกรรมการทำงานให้เสร็จในเบื้องหลัง

`toolsPromise` ที่ pending แต่ละรายการยังมี background continuation ที่ท้ายที่สุดจะ:

- แทนที่ tool slice ของ server นั้นใน manager state ผ่าน `#replaceServerTools`,
- เขียน cache,
- บันทึกความล้มเหลวล่าช้าหลังจากการเริ่มต้นเท่านั้น (`allowBackgroundLogging`)

## การเปิดเผย Tool และความพร้อมใช้งานใน Live Session

### การลงทะเบียนเมื่อเริ่มต้น

`discoverAndLoadMCPTools()` แปลง manager tools เป็น `LoadedCustomTool[]` และตกแต่ง paths (`mcp:<server> via <providerName>` เมื่อทราบ)

`createAgentSession()` จากนั้นดัน tools เหล่านี้เข้าสู่ `customTools` ซึ่งถูกห่อและเพิ่มเข้า runtime tool registry ด้วยชื่อเช่น `mcp_<server>_<tool>`

### การเรียกใช้ Tool

- `MCPTool` เรียก tools ผ่าน `MCPServerConnection` ที่เชื่อมต่ออยู่แล้ว
- `DeferredMCPTool` รอ `waitForConnection(server)` ก่อนการเรียก; ซึ่งช่วยให้ cached tools มีอยู่ก่อนที่การเชื่อมต่อจะพร้อม

ทั้งคู่คืนค่า structured tool output และแปลง transport/tool errors เป็นเนื้อหา tool `MCP error: ...` (abort ยังคงเป็น abort)

## เส้นทาง Refresh/Reload (การเริ่มต้น vs Live Reload)

### เส้นทางการเริ่มต้นครั้งแรก

- การค้นหา/โหลดครั้งเดียวใน `sdk.ts`,
- tools ลงทะเบียนใน session tool registry เริ่มต้น

### เส้นทาง Interactive Reload

เส้นทาง `/mcp reload` (`src/modes/controllers/mcp-command-controller.ts`) ดำเนินการ:

1. `mcpManager.disconnectAll()`,
2. `mcpManager.discoverAndConnect()`,
3. `session.refreshMCPTools(mcpManager.getTools())`

`session.refreshMCPTools()` (`src/session/agent-session.ts`) ลบ tools `mcp_` ทั้งหมด ห่อ MCP tools ล่าสุดใหม่ และเปิดใช้งาน tool set อีกครั้งเพื่อให้การเปลี่ยนแปลง MCP มีผลโดยไม่ต้องรีสตาร์ท session

ยังมีเส้นทาง follow-up สำหรับการเชื่อมต่อล่าช้า: หลังจากรอ server เฉพาะ หากสถานะกลายเป็น `connected` จะรัน `session.refreshMCPTools(...)` อีกครั้งเพื่อให้ tools ที่มีใหม่ถูก rebind ใน session

## พฤติกรรมสุขภาพ การเชื่อมต่อใหม่ และความล้มเหลวบางส่วน

พฤติกรรม runtime ปัจจุบันมีความเรียบง่ายโดยเจตนา:

- **ไม่มี health monitor อัตโนมัติ** ใน manager/client
- **ไม่มี reconnect loop อัตโนมัติ** เมื่อ transport ขาดหาย
- Manager ไม่ subscribe กับ transport `onClose`/`onError`; สถานะขับเคลื่อนด้วย registry
- Reconnect เป็นแบบ explicit: reload flow หรือการเรียก `connectServers()` โดยตรง

ในเชิงปฏิบัติการ:

- server หนึ่งล้มเหลวไม่ลบ tools จาก server ที่ทำงานปกติ,
- ความล้มเหลว connect/list ถูก isolate ต่อ server,
- tool cache และการอัปเดตเบื้องหลังเป็นแบบ best-effort (บันทึก warnings/errors ไม่หยุดทำงาน)

## ความหมายของการปิดระบบ

### การปิดระบบระดับ Server

`disconnectServer(name)`:

- ลบ pending entries/source metadata,
- ปิด transport ถ้าเชื่อมต่ออยู่,
- ลบ tools `mcp_` ของ server นั้นจาก manager state

### การปิดระบบทั้งหมด

`disconnectAll()`:

- ปิด transport ที่ active ทั้งหมดด้วย `Promise.allSettled`,
- ล้าง pending maps, sources, connections และ manager tool list

ในการเชื่อมต่อปัจจุบัน การปิดระบบแบบ explicit ใช้ใน MCP command flows (สำหรับ reload/remove/disable) ไม่มี hook การจัดการ manager disposal อัตโนมัติแยกต่างหากในเส้นทางการเริ่มต้นเอง; ผู้เรียกรับผิดชอบในการเรียก manager disconnect methods เมื่อต้องการการปิดระบบ MCP แบบ deterministic

## โหมดความล้มเหลวและการรับประกัน

| สถานการณ์ | พฤติกรรม | ความล้มเหลวหนัก vs best-effort |
| --- | --- | --- |
| Discovery ส่ง exception (เส้นทางโหลด capability/config) | Loader คืนค่า tools ว่างเปล่า + ข้อผิดพลาด `.mcp.json` สังเคราะห์ | Best-effort session startup |
| Server config ไม่ถูกต้อง | Server ถูกข้ามพร้อมรายการข้อผิดพลาดการตรวจสอบ | Best-effort ต่อ server |
| Connect timeout/init failure | ข้อผิดพลาด server ถูกบันทึก; server อื่นๆ ดำเนินการต่อ | Best-effort ต่อ server |
| `tools/list` ยังค้างอยู่เมื่อเริ่มต้นพร้อม cache hit | Deferred tools คืนค่าทันที | Best-effort fast startup |
| `tools/list` ยังค้างอยู่เมื่อเริ่มต้นไม่มี cache | การเริ่มต้นรอ pending ให้เสร็จสิ้น | Hard wait เพื่อความถูกต้อง |
| ความล้มเหลว tool-load เบื้องหลังล่าช้า | บันทึกหลังประตูการเริ่มต้น | Best-effort logging |
| Runtime transport ขาดหาย | ไม่มี reconnect อัตโนมัติ; การเรียกในอนาคตล้มเหลวจนกว่าจะ reconnect/reload | Best-effort recovery ผ่านการดำเนินการด้วยตนเอง |

## พื้นผิว Public API

`src/mcp/index.ts` ส่งออก loader/manager/client APIs อีกครั้งสำหรับผู้เรียกภายนอก `src/sdk.ts` เปิดเผย `discoverMCPServers()` เป็น convenience wrapper ที่คืนค่า loader result shape เดียวกัน

## ไฟล์ Implementation

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — loader facade, การจัดการข้อผิดพลาดการค้นหา, การแปลง `LoadedCustomTool`
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — lifecycle state registries, กระบวนการ connect/list แบบขนาน, refresh/disconnect
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — การตั้งค่า transport, initialize handshake, list/call/disconnect
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — การส่งออก MCP module API
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — การเชื่อมต่อการเริ่มต้นเข้าสู่ session/tool registry
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — การค้นหา config/การกรอง/การตรวจสอบที่ใช้โดย manager
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — พฤติกรรมรันไทม์ `MCPTool` และ `DeferredMCPTool`
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `refreshMCPTools` live rebinding
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — กระบวนการ interactive reload/reconnect
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — subagent MCP proxying ผ่านการเชื่อมต่อ parent manager
