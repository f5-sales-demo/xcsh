---
title: วงจรชีวิต MCP Runtime
description: >-
  วงจรชีวิตของกระบวนการ MCP server ตั้งแต่การเริ่มต้น การลงทะเบียนเครื่องมือ
  การตรวจสอบสุขภาพ และการปิดระบบ
sidebar:
  order: 3
  label: วงจรชีวิต Runtime
i18n:
  sourceHash: d04cefaf38f8
  translator: machine
---

# วงจรชีวิต MCP runtime

เอกสารนี้อธิบายวิธีที่ MCP servers ถูกค้นพบ เชื่อมต่อ เปิดเผยเป็นเครื่องมือ รีเฟรช และปิดระบบใน coding-agent runtime

## ภาพรวมของวงจรชีวิต

1. **การเริ่มต้น SDK** เรียก `discoverAndLoadMCPTools()` (เว้นแต่ MCP จะถูกปิดใช้งาน)
2. **การค้นพบ** (`loadAllMCPConfigs`) แก้ไข MCP server configs จากแหล่ง capability กรองรายการที่ปิดใช้งาน/project/Exa และเก็บรักษา source metadata
3. **ขั้นตอนการเชื่อมต่อของ Manager** (`MCPManager.connectServers`) เริ่มการเชื่อมต่อและ `tools/list` ต่อ server แบบขนาน
4. **Fast startup gate** รอสูงสุด 250ms จากนั้นอาจคืนค่า:
   - `MCPTool`s ที่โหลดสมบูรณ์,
   - ความล้มเหลวต่อ server,
   - หรือ `DeferredMCPTool`s ที่แคชไว้สำหรับ server ที่ยังค้างอยู่
5. **การเชื่อมต่อ SDK** รวม MCP tools เข้าใน runtime tool registry สำหรับ session
6. **Live session** สามารถรีเฟรช MCP tools ผ่านขั้นตอน `/mcp` (`disconnectAll` + ค้นพบใหม่ + `session.refreshMCPTools`)
7. **Teardown** เกิดขึ้นเมื่อ callers เรียก `disconnectServer`/`disconnectAll`; manager ยังล้างการลงทะเบียน MCP tool สำหรับ server ที่ยกเลิกการเชื่อมต่อด้วย

## ขั้นตอนการค้นพบและโหลด

### เส้นทางเข้าจาก SDK

`createAgentSession()` ใน `src/sdk.ts` ดำเนินการเริ่มต้น MCP เมื่อ `enableMCP` เป็น true (ค่าเริ่มต้น):

- เรียก `discoverAndLoadMCPTools(cwd, { ... })`,
- ส่งผ่าน `authStorage`, cache storage, และการตั้งค่า `mcp.enableProjectConfig`,
- ตั้งค่า `filterExa: true` เสมอ,
- บันทึกข้อผิดพลาดการโหลด/เชื่อมต่อต่อ server,
- เก็บ manager ที่คืนค่าใน `toolSession.mcpManager` และผลลัพธ์ session

หาก `enableMCP` เป็น false การค้นพบ MCP จะถูกข้ามทั้งหมด

### การค้นพบและกรอง Config

`loadAllMCPConfigs()` (`src/mcp/config.ts`) โหลด MCP server items แบบ canonical ผ่านการค้นพบ capability จากนั้นแปลงเป็น `MCPServerConfig` แบบ legacy

พฤติกรรมการกรอง:

- `enableProjectConfig: false` ลบรายการระดับ project ออก (`_source.level === "project"`)
- server ที่มี `enabled: false` จะถูกข้ามก่อนพยายามเชื่อมต่อ
- Exa servers จะถูกกรองออกโดยค่าเริ่มต้น และ API keys จะถูกดึงออกสำหรับการรวม Exa tool แบบ native

ผลลัพธ์ประกอบด้วยทั้ง `configs` และ `sources` (metadata ที่ใช้ในภายหลังสำหรับการกำหนดป้ายชื่อ provider)

### พฤติกรรมความล้มเหลวในระดับการค้นพบ

`discoverAndLoadMCPTools()` แยกแยะความล้มเหลวสองประเภท:

- **ความล้มเหลวร้ายแรงในการค้นพบ** (exception จาก `manager.discoverAndConnect` โดยทั่วไปมาจากการค้นพบ config): คืนค่าชุดเครื่องมือว่างและข้อผิดพลาด synthetic หนึ่งรายการ `{ path: ".mcp.json", error }`
- **ความล้มเหลว runtime/เชื่อมต่อต่อ server**: manager คืนค่าความสำเร็จบางส่วนพร้อม `errors` map; server อื่นๆ ยังคงทำงานต่อไป

ดังนั้น การเริ่มต้นจะไม่ทำให้ agent session ทั้งหมดล้มเหลวเมื่อ MCP servers รายบุคคลล้มเหลว

## โมเดลสถานะของ Manager

`MCPManager` ติดตามวงจรชีวิต runtime ด้วย registries แยกกัน:

- `#connections: Map<string, MCPServerConnection>` — server ที่เชื่อมต่อสมบูรณ์แล้ว
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — handshake ที่กำลังดำเนินการ
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — เชื่อมต่อแล้วแต่ tools ยังโหลดอยู่
- `#tools: CustomTool[]` — มุมมอง MCP tool ปัจจุบันที่เปิดเผยต่อ callers
- `#sources: Map<string, SourceMeta>` — metadata ของ provider/source แม้กระทั่งก่อนการเชื่อมต่อจะเสร็จสมบูรณ์

`getConnectionStatus(name)` ได้รับสถานะจาก maps เหล่านี้:

- `connected` หากอยู่ใน `#connections`,
- `connecting` หากรอการเชื่อมต่อหรือรอการโหลด tool,
- `disconnected` หากไม่ใช่กรณีข้างต้น

## การสร้างการเชื่อมต่อและเวลาในการเริ่มต้น

## Pipeline การเชื่อมต่อต่อ server

สำหรับแต่ละ server ที่ค้นพบใน `connectServers()`:

1. เก็บ/อัปเดต source metadata,
2. ข้ามหากเชื่อมต่อแล้วหรืออยู่ในสถานะรอ,
3. ตรวจสอบฟิลด์ transport (`validateServerConfig`),
4. แก้ไข auth/shell substitutions (`#resolveAuthConfig`),
5. เรียก `connectToServer(name, resolvedConfig)`,
6. เรียก `listTools(connection)`,
7. แคช tool definitions (`MCPToolCache.set`) แบบ best-effort

พฤติกรรมของ `connectToServer()` (`src/mcp/client.ts`):

- สร้าง stdio หรือ HTTP/SSE transport,
- ดำเนินการ MCP `initialize` + `notifications/initialized`,
- ใช้ timeout (`config.timeout` หรือค่าเริ่มต้น 30s),
- ปิด transport เมื่อ init ล้มเหลว

### Fast startup gate + Deferred fallback

`connectServers()` รอผลจากการแข่งขันระหว่าง:

- งาน connect/tool-load ทั้งหมดสิ้นสุด และ
- `STARTUP_TIMEOUT_MS = 250`

หลังจาก 250ms:

- งานที่สำเร็จกลายเป็น `MCPTool`s แบบ live,
- งานที่ถูกปฏิเสธสร้างข้อผิดพลาดต่อ server,
- งานที่ยังค้างอยู่:
  - ใช้ tool definitions ที่แคชไว้หากมี (`MCPToolCache.get`) เพื่อสร้าง `DeferredMCPTool`s,
  - มิฉะนั้นจะรอจนกว่างานที่ค้างอยู่จะสิ้นสุด

นี่คือโมเดลการเริ่มต้นแบบ hybrid: คืนค่าเร็วเมื่อมี cache พร้อม รอความถูกต้องเมื่อไม่มี cache

### พฤติกรรมการทำงานเสร็จสิ้นในพื้นหลัง

แต่ละ `toolsPromise` ที่ค้างอยู่ยังมี background continuation ที่ในที่สุดจะ:

- แทนที่ส่วน tool ของ server นั้นใน manager state ผ่าน `#replaceServerTools`,
- เขียน cache,
- บันทึกความล้มเหลวที่เกิดขึ้นช้าหลังจากการเริ่มต้น (`allowBackgroundLogging`) เท่านั้น

## การเปิดเผย Tool และความพร้อมใช้งานใน Live Session

### การลงทะเบียนในการเริ่มต้น

`discoverAndLoadMCPTools()` แปลง manager tools เป็น `LoadedCustomTool[]` และตกแต่ง paths (`mcp:<server> via <providerName>` เมื่อทราบ)

`createAgentSession()` จากนั้นส่ง tools เหล่านี้เข้าใน `customTools` ซึ่งถูกห่อและเพิ่มใน runtime tool registry พร้อมชื่อเช่น `mcp_<server>_<tool>`

### การเรียก Tool

- `MCPTool` เรียก tools ผ่าน `MCPServerConnection` ที่เชื่อมต่อแล้ว
- `DeferredMCPTool` รอ `waitForConnection(server)` ก่อนเรียก; ซึ่งอนุญาตให้ tools ที่แคชไว้มีอยู่ก่อนที่การเชื่อมต่อจะพร้อม

ทั้งคู่คืนค่า output ของ tool แบบมีโครงสร้าง และแปลงข้อผิดพลาด transport/tool เป็นเนื้อหา tool `MCP error: ...` (abort ยังคงเป็น abort)

## เส้นทาง Refresh/Reload (การเริ่มต้น vs Live Reload)

### เส้นทางการเริ่มต้นครั้งแรก

- การค้นพบ/โหลดครั้งเดียวใน `sdk.ts`,
- tools ถูกลงทะเบียนใน initial session tool registry

### เส้นทาง Interactive Reload

เส้นทาง `/mcp reload` (`src/modes/controllers/mcp-command-controller.ts`) ทำ:

1. `mcpManager.disconnectAll()`,
2. `mcpManager.discoverAndConnect()`,
3. `session.refreshMCPTools(mcpManager.getTools())`

`session.refreshMCPTools()` (`src/session/agent-session.ts`) ลบ tools `mcp_` ทั้งหมด ห่อ MCP tools ล่าสุดใหม่ และเปิดใช้งาน tool set ใหม่เพื่อให้การเปลี่ยนแปลง MCP ใช้งานได้โดยไม่ต้องรีสตาร์ท session

นอกจากนี้ยังมีเส้นทาง follow-up สำหรับการเชื่อมต่อที่ล่าช้า: หลังจากรอ server เฉพาะ หากสถานะกลายเป็น `connected` จะเรียก `session.refreshMCPTools(...)` อีกครั้ง เพื่อให้ tools ที่พร้อมใช้งานใหม่ถูกผูกใหม่ใน session

## พฤติกรรมด้านสุขภาพ การเชื่อมต่อใหม่ และความล้มเหลวบางส่วน

พฤติกรรม runtime ปัจจุบันมีความเรียบง่ายโดยตั้งใจ:

- **ไม่มีตัวตรวจสอบสุขภาพอัตโนมัติ** ใน manager/client
- **ไม่มีวงรอบเชื่อมต่อใหม่อัตโนมัติ** เมื่อ transport หลุด
- Manager ไม่สมัครรับ `onClose`/`onError` ของ transport; สถานะขับเคลื่อนด้วย registry
- การเชื่อมต่อใหม่เป็นแบบ explicit: ผ่านขั้นตอน reload หรือการเรียก `connectServers()` โดยตรง

ในทางปฏิบัติ:

- server หนึ่งที่ล้มเหลวไม่ลบ tools จาก server ที่ทำงานปกติ,
- ความล้มเหลวในการเชื่อมต่อ/list ถูกแยกต่อ server,
- tool cache และการอัปเดตพื้นหลังเป็นแบบ best-effort (บันทึกคำเตือน/ข้อผิดพลาด ไม่หยุดอย่างเด็ดขาด)

## Teardown semantics

### Teardown ระดับ Server

`disconnectServer(name)`:

- ลบรายการที่รอและ source metadata,
- ปิด transport หากเชื่อมต่ออยู่,
- ลบ tools `mcp_` ของ server นั้นจาก manager state

### Teardown ทั่วโลก

`disconnectAll()`:

- ปิด transport ที่ใช้งานอยู่ทั้งหมดด้วย `Promise.allSettled`,
- ล้าง pending maps, sources, connections, และรายการ tool ของ manager

ในการเชื่อมต่อปัจจุบัน teardown แบบ explicit ถูกใช้ในขั้นตอน MCP command (สำหรับ reload/remove/disable) ไม่มี hook การกำจัด manager อัตโนมัติแยกต่างหากในเส้นทางการเริ่มต้นเอง; callers มีหน้าที่รับผิดชอบในการเรียก manager disconnect methods เมื่อต้องการปิด MCP อย่างแน่นอน

## โหมดความล้มเหลวและการรับประกัน

| สถานการณ์ | พฤติกรรม | Hard fail vs Best-effort |
| --- | --- | --- |
| การค้นพบส่งข้อยกเว้น (เส้นทางโหลด capability/config) | Loader คืนค่า tools ว่าง + ข้อผิดพลาด `.mcp.json` synthetic | Best-effort session startup |
| Server config ไม่ถูกต้อง | Server ถูกข้ามพร้อมรายการข้อผิดพลาดการตรวจสอบ | Best-effort ต่อ server |
| Connect timeout/init ล้มเหลว | บันทึกข้อผิดพลาด server; อื่นๆ ดำเนินต่อ | Best-effort ต่อ server |
| `tools/list` ยังค้างอยู่ในการเริ่มต้นพร้อม cache hit | คืนค่า Deferred tools ทันที | Best-effort fast startup |
| `tools/list` ยังค้างอยู่ในการเริ่มต้นโดยไม่มี cache | การเริ่มต้นรอให้งานที่ค้างอยู่สิ้นสุด | Hard wait เพื่อความถูกต้อง |
| ความล้มเหลวการโหลด tool พื้นหลังที่ล่าช้า | บันทึกหลัง startup gate | Best-effort logging |
| Transport ที่หลุดใน runtime | ไม่มีการเชื่อมต่อใหม่อัตโนมัติ; การเรียกในอนาคตล้มเหลวจนกว่าจะเชื่อมต่อใหม่/reload | Best-effort recovery ผ่านการดำเนินการด้วยตนเอง |

## พื้นผิว Public API

`src/mcp/index.ts` re-exports loader/manager/client APIs สำหรับ external callers `src/sdk.ts` เปิดเผย `discoverMCPServers()` เป็น convenience wrapper ที่คืนค่า loader result shape เดียวกัน

## ไฟล์ Implementation

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — loader facade, การทำให้ discovery error เป็นมาตรฐาน, การแปลง `LoadedCustomTool`
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — lifecycle state registries, ขั้นตอน connect/list แบบขนาน, refresh/disconnect
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — การตั้งค่า transport, initialize handshake, list/call/disconnect
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — การ export MCP module API
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — การเชื่อมต่อในการเริ่มต้นเข้าสู่ session/tool registry
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — การค้นพบ/กรอง/ตรวจสอบ config ที่ใช้โดย manager
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — พฤติกรรม runtime ของ `MCPTool` และ `DeferredMCPTool`
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `refreshMCPTools` live rebinding
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — ขั้นตอน interactive reload/reconnect
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — subagent MCP proxying ผ่าน parent manager connections
