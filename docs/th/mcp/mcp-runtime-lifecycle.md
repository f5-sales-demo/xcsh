---
title: วงจรชีวิตรันไทม์ของ MCP
description: >-
  วงจรชีวิตกระบวนการเซิร์ฟเวอร์ MCP ตั้งแต่การเริ่มต้นผ่านการลงทะเบียนเครื่องมือ
  การตรวจสอบสุขภาพ และการปิดระบบ
sidebar:
  order: 3
  label: วงจรชีวิตรันไทม์
i18n:
  sourceHash: d04cefaf38f8
  translator: machine
---

# วงจรชีวิตรันไทม์ของ MCP

เอกสารนี้อธิบายว่าเซิร์ฟเวอร์ MCP ถูกค้นพบ เชื่อมต่อ เปิดเผยเป็นเครื่องมือ รีเฟรช และถูกยุติอย่างไรในรันไทม์ของ coding-agent

## ภาพรวมของวงจรชีวิต

1. **การเริ่มต้น SDK** เรียก `discoverAndLoadMCPTools()` (เว้นแต่ MCP จะถูกปิดใช้งาน)
2. **การค้นพบ** (`loadAllMCPConfigs`) แก้ไขการกำหนดค่าเซิร์ฟเวอร์ MCP จากแหล่งความสามารถ กรองรายการที่ปิดใช้งาน/ระดับโปรเจกต์/Exa ออก และรักษาข้อมูลเมตาของแหล่งที่มาไว้
3. **เฟสเชื่อมต่อของ Manager** (`MCPManager.connectServers`) เริ่มการเชื่อมต่อ + `tools/list` ต่อเซิร์ฟเวอร์แบบขนาน
4. **เกตเริ่มต้นแบบเร็ว** รอสูงสุด 250ms จากนั้นอาจส่งกลับ:
   - `MCPTool` ที่โหลดเสร็จสมบูรณ์,
   - ข้อผิดพลาดต่อเซิร์ฟเวอร์,
   - หรือ `DeferredMCPTool` จากแคชสำหรับเซิร์ฟเวอร์ที่ยังรอดำเนินการ
5. **การเชื่อมต่อ SDK** รวมเครื่องมือ MCP เข้ากับรีจิสทรีเครื่องมือรันไทม์สำหรับเซสชัน
6. **เซสชันที่ใช้งานอยู่** สามารถรีเฟรชเครื่องมือ MCP ผ่านโฟลว์ `/mcp` (`disconnectAll` + ค้นพบใหม่ + `session.refreshMCPTools`)
7. **การยุติ** เกิดขึ้นเมื่อผู้เรียกใช้ `disconnectServer`/`disconnectAll`; manager ยังล้างการลงทะเบียนเครื่องมือ MCP สำหรับเซิร์ฟเวอร์ที่ถูกตัดการเชื่อมต่อด้วย

## เฟสการค้นพบและโหลด

### เส้นทางเข้าจาก SDK

`createAgentSession()` ใน `src/sdk.ts` ดำเนินการเริ่มต้น MCP เมื่อ `enableMCP` เป็น true (ค่าเริ่มต้น):

- เรียก `discoverAndLoadMCPTools(cwd, { ... })`,
- ส่ง `authStorage`, cache storage, และการตั้งค่า `mcp.enableProjectConfig`,
- ตั้ง `filterExa: true` เสมอ,
- บันทึกข้อผิดพลาดการโหลด/เชื่อมต่อต่อเซิร์ฟเวอร์,
- เก็บ manager ที่ส่งกลับใน `toolSession.mcpManager` และผลลัพธ์เซสชัน

หาก `enableMCP` เป็น false การค้นพบ MCP จะถูกข้ามทั้งหมด

### การค้นพบและกรองการกำหนดค่า

`loadAllMCPConfigs()` (`src/mcp/config.ts`) โหลดรายการเซิร์ฟเวอร์ MCP แบบ canonical ผ่านการค้นพบความสามารถ จากนั้นแปลงเป็น `MCPServerConfig` แบบ legacy

พฤติกรรมการกรอง:

- `enableProjectConfig: false` ลบรายการระดับโปรเจกต์ (`_source.level === "project"`) ออก
- เซิร์ฟเวอร์ที่มี `enabled: false` จะถูกข้ามก่อนความพยายามเชื่อมต่อ
- เซิร์ฟเวอร์ Exa จะถูกกรองออกโดยค่าเริ่มต้น และ API keys จะถูกแยกออกสำหรับการรวมเครื่องมือ Exa แบบ native

ผลลัพธ์รวมทั้ง `configs` และ `sources` (ข้อมูลเมตาที่ใช้ภายหลังสำหรับการติดป้ายผู้ให้บริการ)

### พฤติกรรมความล้มเหลวระดับการค้นพบ

`discoverAndLoadMCPTools()` แยกแยะความล้มเหลวสองประเภท:

- **ความล้มเหลวรุนแรงของการค้นพบ** (exception จาก `manager.discoverAndConnect` ซึ่งโดยทั่วไปมาจากการค้นพบการกำหนดค่า): ส่งกลับชุดเครื่องมือว่างและข้อผิดพลาดสังเคราะห์หนึ่งรายการ `{ path: ".mcp.json", error }`
- **ความล้มเหลวรันไทม์/เชื่อมต่อต่อเซิร์ฟเวอร์**: manager ส่งกลับความสำเร็จบางส่วนพร้อม `errors` map; เซิร์ฟเวอร์อื่นดำเนินการต่อ

ดังนั้นการเริ่มต้นจะไม่ทำให้เซสชัน agent ทั้งหมดล้มเหลวเมื่อเซิร์ฟเวอร์ MCP แต่ละตัวล้มเหลว

## โมเดลสถานะของ Manager

`MCPManager` ติดตามวงจรชีวิตรันไทม์ด้วยรีจิสทรีแยกกัน:

- `#connections: Map<string, MCPServerConnection>` — เซิร์ฟเวอร์ที่เชื่อมต่อเสร็จสมบูรณ์
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — กำลังทำ handshake
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — เชื่อมต่อแล้วแต่เครื่องมือยังโหลดอยู่
- `#tools: CustomTool[]` — มุมมองเครื่องมือ MCP ปัจจุบันที่เปิดเผยให้ผู้เรียก
- `#sources: Map<string, SourceMeta>` — ข้อมูลเมตาของผู้ให้บริการ/แหล่งที่มาแม้ก่อนเชื่อมต่อเสร็จ

`getConnectionStatus(name)` อนุมานสถานะจาก maps เหล่านี้:

- `connected` หากอยู่ใน `#connections`,
- `connecting` หากรอการเชื่อมต่อหรือรอการโหลดเครื่องมือ,
- `disconnected` ในกรณีอื่น

## การสร้างการเชื่อมต่อและจังหวะการเริ่มต้น

## ไปป์ไลน์การเชื่อมต่อต่อเซิร์ฟเวอร์

สำหรับแต่ละเซิร์ฟเวอร์ที่ค้นพบใน `connectServers()`:

1. จัดเก็บ/อัปเดตข้อมูลเมตาของแหล่งที่มา,
2. ข้ามหากเชื่อมต่อแล้ว/กำลังรอ,
3. ตรวจสอบฟิลด์ transport (`validateServerConfig`),
4. แก้ไขการแทนที่ auth/shell (`#resolveAuthConfig`),
5. เรียก `connectToServer(name, resolvedConfig)`,
6. เรียก `listTools(connection)`,
7. แคชคำจำกัดความเครื่องมือ (`MCPToolCache.set`) แบบ best-effort

พฤติกรรมของ `connectToServer()` (`src/mcp/client.ts`):

- สร้าง transport แบบ stdio หรือ HTTP/SSE,
- ดำเนินการ MCP `initialize` + `notifications/initialized`,
- ใช้ timeout (`config.timeout` หรือค่าเริ่มต้น 30 วินาที),
- ปิด transport เมื่อ init ล้มเหลว

### เกตเริ่มต้นแบบเร็ว + ทางเลือก deferred

`connectServers()` รอการแข่งขันระหว่าง:

- งานเชื่อมต่อ/โหลดเครื่องมือทั้งหมดเสร็จสิ้น, และ
- `STARTUP_TIMEOUT_MS = 250`

หลัง 250ms:

- งานที่สำเร็จจะกลายเป็น `MCPTool` แบบ live,
- งานที่ถูกปฏิเสธจะสร้างข้อผิดพลาดต่อเซิร์ฟเวอร์,
- งานที่ยังรอ:
  - ใช้คำจำกัดความเครื่องมือจากแคชหากมี (`MCPToolCache.get`) เพื่อสร้าง `DeferredMCPTool`,
  - มิฉะนั้นจะบล็อกจนกว่างานที่รอจะเสร็จสิ้น

นี่เป็นโมเดลการเริ่มต้นแบบไฮบริด: ส่งกลับเร็วเมื่อมีแคช รอเพื่อความถูกต้องเมื่อไม่มีแคช

### พฤติกรรมการเสร็จสิ้นในพื้นหลัง

แต่ละ `toolsPromise` ที่รออยู่ยังมีการดำเนินการต่อในพื้นหลังซึ่งในที่สุดจะ:

- แทนที่ส่วนเครื่องมือของเซิร์ฟเวอร์นั้นในสถานะ manager ผ่าน `#replaceServerTools`,
- เขียนแคช,
- บันทึกความล้มเหลวที่ล่าช้าหลังจากการเริ่มต้นเท่านั้น (`allowBackgroundLogging`)

## การเปิดเผยเครื่องมือและความพร้อมใช้งานในเซสชันที่ใช้งานอยู่

### การลงทะเบียนตอนเริ่มต้น

`discoverAndLoadMCPTools()` แปลงเครื่องมือ manager เป็น `LoadedCustomTool[]` และตกแต่งเส้นทาง (`mcp:<server> via <providerName>` เมื่อทราบ)

`createAgentSession()` จากนั้นเพิ่มเครื่องมือเหล่านี้ลงใน `customTools` ซึ่งถูก wrap และเพิ่มลงในรีจิสทรีเครื่องมือรันไทม์ด้วยชื่อเช่น `mcp_<server>_<tool>`

### การเรียกใช้เครื่องมือ

- `MCPTool` เรียกเครื่องมือผ่าน `MCPServerConnection` ที่เชื่อมต่อแล้ว
- `DeferredMCPTool` รอ `waitForConnection(server)` ก่อนเรียก; สิ่งนี้ช่วยให้เครื่องมือจากแคชมีอยู่ก่อนที่การเชื่อมต่อจะพร้อม

ทั้งสองส่งกลับผลลัพธ์เครื่องมือแบบมีโครงสร้างและแปลงข้อผิดพลาด transport/เครื่องมือเป็นเนื้อหาเครื่องมือ `MCP error: ...` (abort ยังคงเป็น abort)

## เส้นทางรีเฟรช/รีโหลด (เริ่มต้น vs รีโหลดขณะใช้งาน)

### เส้นทางการเริ่มต้นครั้งแรก

- การค้นพบ/โหลดครั้งเดียวใน `sdk.ts`,
- เครื่องมือถูกลงทะเบียนในรีจิสทรีเครื่องมือเซสชันเริ่มต้น

### เส้นทางรีโหลดแบบโต้ตอบ

เส้นทาง `/mcp reload` (`src/modes/controllers/mcp-command-controller.ts`) ทำ:

1. `mcpManager.disconnectAll()`,
2. `mcpManager.discoverAndConnect()`,
3. `session.refreshMCPTools(mcpManager.getTools())`

`session.refreshMCPTools()` (`src/session/agent-session.ts`) ลบเครื่องมือ `mcp_` ทั้งหมด wrap เครื่องมือ MCP ล่าสุดใหม่ และเปิดใช้งานชุดเครื่องมืออีกครั้งเพื่อให้การเปลี่ยนแปลง MCP มีผลโดยไม่ต้องรีสตาร์ทเซสชัน

ยังมีเส้นทางติดตามสำหรับการเชื่อมต่อที่ล่าช้า: หลังจากรอเซิร์ฟเวอร์เฉพาะ หากสถานะกลายเป็น `connected` จะรัน `session.refreshMCPTools(...)` อีกครั้งเพื่อให้เครื่องมือที่เพิ่งพร้อมใช้งานถูกผูกใหม่ในเซสชัน

## สุขภาพ การเชื่อมต่อใหม่ และพฤติกรรมความล้มเหลวบางส่วน

พฤติกรรมรันไทม์ปัจจุบันเป็นแบบเรียบง่ายโดยเจตนา:

- **ไม่มีตัวตรวจสอบสุขภาพอัตโนมัติ** ใน manager/client
- **ไม่มีลูปเชื่อมต่อใหม่อัตโนมัติ** เมื่อ transport หลุด
- Manager ไม่ subscribe กับ `onClose`/`onError` ของ transport; สถานะขับเคลื่อนด้วยรีจิสทรี
- การเชื่อมต่อใหม่เป็นแบบชัดเจน: โฟลว์รีโหลดหรือการเรียก `connectServers()` โดยตรง

ในทางปฏิบัติ:

- เซิร์ฟเวอร์หนึ่งล้มเหลวจะไม่ลบเครื่องมือจากเซิร์ฟเวอร์ที่ทำงานปกติ,
- ความล้มเหลวในการเชื่อมต่อ/list จะถูกแยกต่อเซิร์ฟเวอร์,
- แคชเครื่องมือและการอัปเดตในพื้นหลังเป็นแบบ best-effort (คำเตือน/ข้อผิดพลาดถูกบันทึก ไม่มีการหยุดแบบถาวร)

## ความหมายของการยุติ

### การยุติระดับเซิร์ฟเวอร์

`disconnectServer(name)`:

- ลบรายการที่รอ/ข้อมูลเมตาของแหล่งที่มา,
- ปิด transport หากเชื่อมต่ออยู่,
- ลบเครื่องมือ `mcp_` ของเซิร์ฟเวอร์นั้นจากสถานะ manager

### การยุติแบบทั่วไป

`disconnectAll()`:

- ปิด transport ที่ใช้งานอยู่ทั้งหมดด้วย `Promise.allSettled`,
- ล้าง pending maps, sources, connections, และรายการเครื่องมือ manager

ในการเชื่อมต่อปัจจุบัน การยุติแบบชัดเจนถูกใช้ในโฟลว์คำสั่ง MCP (สำหรับรีโหลด/ลบ/ปิดใช้งาน) ไม่มี hook การกำจัด manager อัตโนมัติแยกต่างหากในเส้นทางการเริ่มต้นเอง; ผู้เรียกมีหน้าที่รับผิดชอบในการเรียกเมธอดตัดการเชื่อมต่อของ manager เมื่อต้องการการปิดระบบ MCP แบบกำหนดได้

## โหมดความล้มเหลวและการรับประกัน

| สถานการณ์ | พฤติกรรม | ล้มเหลวแบบถาวร vs best-effort |
| --- | --- | --- |
| การค้นพบโยน exception (เส้นทางโหลดความสามารถ/การกำหนดค่า) | Loader ส่งกลับเครื่องมือว่าง + ข้อผิดพลาดสังเคราะห์ `.mcp.json` | การเริ่มต้นเซสชันแบบ best-effort |
| การกำหนดค่าเซิร์ฟเวอร์ไม่ถูกต้อง | เซิร์ฟเวอร์ถูกข้ามพร้อมรายการข้อผิดพลาดการตรวจสอบ | Best-effort ต่อเซิร์ฟเวอร์ |
| หมดเวลาเชื่อมต่อ/ความล้มเหลว init | ข้อผิดพลาดเซิร์ฟเวอร์ถูกบันทึก; เซิร์ฟเวอร์อื่นดำเนินการต่อ | Best-effort ต่อเซิร์ฟเวอร์ |
| `tools/list` ยังรอตอนเริ่มต้นและมีแคช | เครื่องมือ deferred ถูกส่งกลับทันที | การเริ่มต้นเร็วแบบ best-effort |
| `tools/list` ยังรอตอนเริ่มต้นและไม่มีแคช | การเริ่มต้นรอจนกว่ารายการที่รอจะเสร็จสิ้น | รอแบบถาวรเพื่อความถูกต้อง |
| ความล้มเหลวการโหลดเครื่องมือในพื้นหลังที่ล่าช้า | บันทึกหลังเกตเริ่มต้น | การบันทึกแบบ best-effort |
| Transport รันไทม์หลุด | ไม่มีการเชื่อมต่อใหม่อัตโนมัติ; การเรียกในอนาคตล้มเหลวจนกว่าจะเชื่อมต่อใหม่/รีโหลด | การกู้คืนแบบ best-effort ผ่านการดำเนินการด้วยตนเอง |

## พื้นผิว API สาธารณะ

`src/mcp/index.ts` re-export loader/manager/client APIs สำหรับผู้เรียกภายนอก `src/sdk.ts` เปิดเผย `discoverMCPServers()` เป็น convenience wrapper ที่ส่งกลับรูปแบบผลลัพธ์ loader เดียวกัน

## ไฟล์การ implement

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — loader facade, การทำให้ข้อผิดพลาดการค้นพบเป็นมาตรฐาน, การแปลง `LoadedCustomTool`
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — รีจิสทรีสถานะวงจรชีวิต, โฟลว์เชื่อมต่อ/list แบบขนาน, รีเฟรช/ตัดการเชื่อมต่อ
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — การตั้งค่า transport, initialize handshake, list/call/disconnect
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — การ export API ของโมดูล MCP
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — การเชื่อมต่อการเริ่มต้นเข้ากับเซสชัน/รีจิสทรีเครื่องมือ
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — การค้นพบ/กรอง/ตรวจสอบการกำหนดค่าที่ใช้โดย manager
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — พฤติกรรมรันไทม์ของ `MCPTool` และ `DeferredMCPTool`
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — การผูกใหม่แบบ live ของ `refreshMCPTools`
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — โฟลว์รีโหลด/เชื่อมต่อใหม่แบบโต้ตอบ
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — การ proxy MCP ของ subagent ผ่านการเชื่อมต่อ manager หลัก
