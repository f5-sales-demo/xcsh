---
title: MCP Runtime Lifecycle
description: >-
  วงจรชีวิตของกระบวนการ MCP server ตั้งแต่การเริ่มต้น การลงทะเบียนเครื่องมือ
  การตรวจสอบสุขภาพ และการปิดระบบ
sidebar:
  order: 3
  label: วงจรชีวิตของ Runtime
i18n:
  sourceHash: d04cefaf38f8
  translator: machine
---

# วงจรชีวิตของ MCP runtime

เอกสารนี้อธิบายวิธีการค้นพบ เชื่อมต่อ เปิดเผยเป็นเครื่องมือ รีเฟรช และปิดการทำงานของ MCP server ใน coding-agent runtime

## ภาพรวมวงจรชีวิต

1. **SDK startup** เรียก `discoverAndLoadMCPTools()` (เว้นแต่ MCP จะถูกปิดใช้งาน)
2. **Discovery** (`loadAllMCPConfigs`) แก้ไข config ของ MCP server จากแหล่งความสามารถ กรองรายการที่ถูกปิดใช้งาน/project/Exa และเก็บรักษา metadata ของแหล่งที่มา
3. **Manager connect phase** (`MCPManager.connectServers`) เริ่ม connect + `tools/list` ต่อแต่ละ server แบบขนาน
4. **Fast startup gate** รอสูงสุด 250ms จากนั้นอาจส่งคืน:
   - `MCPTool` ที่โหลดเสร็จสมบูรณ์
   - ความล้มเหลวต่อ server
   - หรือ `DeferredMCPTool` ที่ถูกแคชไว้สำหรับ server ที่ยังรอดำเนินการอยู่
5. **SDK wiring** รวม MCP tools เข้ากับ runtime tool registry สำหรับเซสชัน
6. **Live session** สามารถรีเฟรช MCP tools ผ่าน `/mcp` flows (`disconnectAll` + rediscover + `session.refreshMCPTools`)
7. **Teardown** เกิดขึ้นเมื่อผู้เรียกใช้ `disconnectServer`/`disconnectAll`; manager ยังล้างการลงทะเบียน MCP tool สำหรับ server ที่ถูกตัดการเชื่อมต่อด้วย

## เฟสการค้นพบและโหลด

### เส้นทางเข้าจาก SDK

`createAgentSession()` ใน `src/sdk.ts` ดำเนินการ MCP startup เมื่อ `enableMCP` เป็น true (ค่าเริ่มต้น):

- เรียก `discoverAndLoadMCPTools(cwd, { ... })`
- ส่ง `authStorage`, cache storage และการตั้งค่า `mcp.enableProjectConfig`
- ตั้ง `filterExa: true` เสมอ
- บันทึกข้อผิดพลาด load/connect ต่อแต่ละ server
- เก็บ manager ที่ส่งคืนไว้ใน `toolSession.mcpManager` และผลลัพธ์เซสชัน

หาก `enableMCP` เป็น false จะข้าม MCP discovery ทั้งหมด

### การค้นพบและกรอง Config

`loadAllMCPConfigs()` (`src/mcp/config.ts`) โหลดรายการ MCP server แบบ canonical ผ่าน capability discovery จากนั้นแปลงเป็น `MCPServerConfig` แบบ legacy

พฤติกรรมการกรอง:

- `enableProjectConfig: false` ลบรายการระดับ project (`_source.level === "project"`)
- server ที่มี `enabled: false` จะถูกข้ามก่อนความพยายามเชื่อมต่อ
- Exa server จะถูกกรองออกตามค่าเริ่มต้น และ API keys จะถูกดึงออกสำหรับการรวม Exa tool แบบ native

ผลลัพธ์รวมทั้ง `configs` และ `sources` (metadata ที่ใช้ภายหลังสำหรับการติดป้ายกำกับ provider)

### พฤติกรรมความล้มเหลวระดับ Discovery

`discoverAndLoadMCPTools()` แยกแยะความล้มเหลวสองประเภท:

- **Discovery hard failure** (exception จาก `manager.discoverAndConnect` โดยทั่วไปจาก config discovery): ส่งคืนชุดเครื่องมือว่างและข้อผิดพลาดสังเคราะห์หนึ่งรายการ `{ path: ".mcp.json", error }`
- **Per-server runtime/connect failure**: manager ส่งคืนความสำเร็จบางส่วนพร้อม `errors` map; server อื่น ๆ ดำเนินการต่อ

ดังนั้น startup จะไม่ทำให้เซสชัน agent ทั้งหมดล้มเหลวเมื่อ MCP server แต่ละตัวล้มเหลว

## โมเดลสถานะของ Manager

`MCPManager` ติดตามวงจรชีวิต runtime ด้วย registry ที่แยกกัน:

- `#connections: Map<string, MCPServerConnection>` — server ที่เชื่อมต่อเต็มรูปแบบ
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — handshake อยู่ระหว่างดำเนินการ
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — เชื่อมต่อแล้วแต่เครื่องมือยังโหลดอยู่
- `#tools: CustomTool[]` — มุมมอง MCP tool ปัจจุบันที่เปิดเผยให้ผู้เรียก
- `#sources: Map<string, SourceMeta>` — metadata ของ provider/source แม้ก่อนที่การเชื่อมต่อจะเสร็จสมบูรณ์

`getConnectionStatus(name)` อนุมานสถานะจาก map เหล่านี้:

- `connected` หากอยู่ใน `#connections`
- `connecting` หากอยู่ใน pending connect หรือ pending tool load
- `disconnected` ในกรณีอื่น

## การสร้างการเชื่อมต่อและจังหวะเวลา startup

## ท่อเชื่อมต่อต่อ server

สำหรับแต่ละ server ที่ค้นพบใน `connectServers()`:

1. เก็บ/อัปเดต source metadata
2. ข้ามหากเชื่อมต่อแล้ว/กำลังรอ
3. ตรวจสอบฟิลด์ transport (`validateServerConfig`)
4. แก้ไขการแทนที่ auth/shell (`#resolveAuthConfig`)
5. เรียก `connectToServer(name, resolvedConfig)`
6. เรียก `listTools(connection)`
7. แคชคำจำกัดความเครื่องมือ (`MCPToolCache.set`) แบบ best-effort

พฤติกรรมของ `connectToServer()` (`src/mcp/client.ts`):

- สร้าง transport แบบ stdio หรือ HTTP/SSE
- ดำเนินการ MCP `initialize` + `notifications/initialized`
- ใช้ timeout (`config.timeout` หรือค่าเริ่มต้น 30 วินาที)
- ปิด transport เมื่อ init ล้มเหลว

### Fast startup gate + deferred fallback

`connectServers()` รอการแข่งขันระหว่าง:

- task connect/tool-load ทั้งหมด settled, และ
- `STARTUP_TIMEOUT_MS = 250`

หลังจาก 250ms:

- task ที่สำเร็จจะกลายเป็น `MCPTool` แบบ live
- task ที่ล้มเหลวจะสร้างข้อผิดพลาดต่อ server
- task ที่ยังรอดำเนินการ:
  - ใช้คำจำกัดความเครื่องมือที่แคชไว้หากมี (`MCPToolCache.get`) เพื่อสร้าง `DeferredMCPTool`
  - มิฉะนั้นจะบล็อกจนกว่า task ที่รอดำเนินการจะ settle

นี่คือโมเดล startup แบบไฮบริด: ส่งคืนเร็วเมื่อมีแคช รอเพื่อความถูกต้องเมื่อไม่มีแคช

### พฤติกรรมการทำงานเสร็จสิ้นในพื้นหลัง

แต่ละ `toolsPromise` ที่รอดำเนินการยังมี background continuation ที่ในที่สุด:

- แทนที่ tool slice ของ server นั้นในสถานะ manager ผ่าน `#replaceServerTools`
- เขียนแคช
- บันทึกความล้มเหลวที่มาช้าเฉพาะหลัง startup (`allowBackgroundLogging`)

## การเปิดเผยเครื่องมือและความพร้อมใช้งานในเซสชัน

### การลงทะเบียน Startup

`discoverAndLoadMCPTools()` แปลง manager tools เป็น `LoadedCustomTool[]` และตกแต่ง paths (`mcp:<server> via <providerName>` เมื่อทราบ)

`createAgentSession()` จากนั้นผลักเครื่องมือเหล่านี้เข้า `customTools` ซึ่งถูกห่อหุ้มและเพิ่มเข้า runtime tool registry ด้วยชื่อเช่น `mcp_<server>_<tool>`

### การเรียกใช้เครื่องมือ

- `MCPTool` เรียกเครื่องมือผ่าน `MCPServerConnection` ที่เชื่อมต่อแล้ว
- `DeferredMCPTool` รอ `waitForConnection(server)` ก่อนเรียก; สิ่งนี้อนุญาตให้เครื่องมือที่แคชไว้มีอยู่ก่อนที่การเชื่อมต่อจะพร้อม

ทั้งสองส่งคืน tool output แบบ structured และแปลงข้อผิดพลาด transport/tool เป็นเนื้อหาเครื่องมือ `MCP error: ...` (abort ยังคงเป็น abort)

## เส้นทาง Refresh/Reload (startup เทียบกับ live reload)

### เส้นทาง startup เริ่มต้น

- discovery/load ครั้งเดียวใน `sdk.ts`
- เครื่องมือถูกลงทะเบียนใน session tool registry เริ่มต้น

### เส้นทาง interactive reload

เส้นทาง `/mcp reload` (`src/modes/controllers/mcp-command-controller.ts`) ดำเนินการ:

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

`session.refreshMCPTools()` (`src/session/agent-session.ts`) ลบเครื่องมือ `mcp_` ทั้งหมด ห่อหุ้ม MCP tools ล่าสุดใหม่ และเปิดใช้งาน tool set อีกครั้ง เพื่อให้การเปลี่ยนแปลง MCP มีผลโดยไม่ต้องรีสตาร์ทเซสชัน

ยังมีเส้นทางติดตามสำหรับการเชื่อมต่อที่มาช้า: หลังจากรอ server เฉพาะ หากสถานะกลายเป็น `connected` จะรัน `session.refreshMCPTools(...)` อีกครั้ง เพื่อให้เครื่องมือที่เพิ่งพร้อมใช้งานถูกผูกใหม่ในเซสชัน

## สุขภาพ การเชื่อมต่อใหม่ และพฤติกรรมความล้มเหลวบางส่วน

พฤติกรรม runtime ปัจจุบันเป็นแบบ minimal โดยตั้งใจ:

- **ไม่มี autonomous health monitor** ใน manager/client
- **ไม่มี automatic reconnect loop** เมื่อ transport หลุด
- Manager ไม่ subscribe กับ transport `onClose`/`onError`; สถานะขับเคลื่อนด้วย registry
- การเชื่อมต่อใหม่เป็นแบบ explicit: ผ่าน reload flow หรือการเรียก `connectServers()` โดยตรง

ในทางปฏิบัติ:

- server หนึ่งล้มเหลวจะไม่ลบเครื่องมือจาก server ที่ปกติ
- ความล้มเหลว connect/list ถูกแยกต่อ server
- tool cache และ background updates เป็นแบบ best-effort (บันทึก warnings/errors ไม่หยุดแบบ hard)

## ความหมายของ Teardown

### Teardown ระดับ server

`disconnectServer(name)`:

- ลบ pending entries/source metadata
- ปิด transport หากเชื่อมต่ออยู่
- ลบเครื่องมือ `mcp_` ของ server นั้นจากสถานะ manager

### Teardown ระดับ global

`disconnectAll()`:

- ปิด transport ที่ active ทั้งหมดด้วย `Promise.allSettled`
- ล้าง pending maps, sources, connections และรายการ tool ของ manager

ในการเชื่อมต่อปัจจุบัน explicit teardown ถูกใช้ใน MCP command flows (สำหรับ reload/remove/disable) ไม่มี automatic manager disposal hook แยกต่างหากในเส้นทาง startup เอง; ผู้เรียกมีหน้าที่รับผิดชอบในการเรียก manager disconnect methods เมื่อต้องการปิด MCP แบบ deterministic

## โหมดความล้มเหลวและการรับประกัน

| สถานการณ์ | พฤติกรรม | Hard fail เทียบกับ best-effort |
| --- | --- | --- |
| Discovery throw (เส้นทาง capability/config load) | Loader ส่งคืนเครื่องมือว่าง + ข้อผิดพลาดสังเคราะห์ `.mcp.json` | Best-effort session startup |
| Config server ไม่ถูกต้อง | Server ถูกข้ามพร้อมรายการ validation error | Best-effort ต่อ server |
| Connect timeout/init failure | บันทึกข้อผิดพลาด server; server อื่นดำเนินการต่อ | Best-effort ต่อ server |
| `tools/list` ยังรอดำเนินการตอน startup โดยมี cache hit | เครื่องมือ Deferred ถูกส่งคืนทันที | Best-effort fast startup |
| `tools/list` ยังรอดำเนินการตอน startup โดยไม่มี cache | Startup รอให้ pending settle | Hard wait เพื่อความถูกต้อง |
| ความล้มเหลว background tool-load ที่มาช้า | บันทึกหลัง startup gate | Best-effort logging |
| Runtime dropped transport | ไม่มี automatic reconnect; การเรียกในอนาคตจะล้มเหลวจนกว่าจะ reconnect/reload | Best-effort recovery ผ่านการดำเนินการแบบ manual |

## API surface สาธารณะ

`src/mcp/index.ts` re-export loader/manager/client APIs สำหรับผู้เรียกภายนอก `src/sdk.ts` เปิดเผย `discoverMCPServers()` เป็น convenience wrapper ที่ส่งคืนรูปแบบผลลัพธ์ loader เดียวกัน

## ไฟล์ implementation

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — loader facade, การ normalize ข้อผิดพลาด discovery, การแปลง `LoadedCustomTool`
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — lifecycle state registries, parallel connect/list flow, refresh/disconnect
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — การตั้งค่า transport, initialize handshake, list/call/disconnect
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — MCP module API exports
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — startup wiring เข้า session/tool registry
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — config discovery/filtering/validation ที่ใช้โดย manager
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — พฤติกรรม runtime ของ `MCPTool` และ `DeferredMCPTool`
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `refreshMCPTools` live rebinding
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — interactive reload/reconnect flows
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — subagent MCP proxying ผ่าน parent manager connections
