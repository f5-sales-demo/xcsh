---
title: MCP Runtime Lifecycle
description: >-
  วงจรชีวิตของกระบวนการ MCP server ตั้งแต่การเริ่มต้นจนถึงการลงทะเบียนเครื่องมือ
  การตรวจสอบสถานะ และการปิดระบบ
sidebar:
  order: 3
  label: วงจรชีวิตรันไทม์
i18n:
  sourceHash: d04cefaf38f8
  translator: machine
---

# วงจรชีวิตรันไทม์ MCP

เอกสารนี้อธิบายวิธีการค้นพบ เชื่อมต่อ เปิดเผยเป็นเครื่องมือ รีเฟรช และยุติ MCP server ในรันไทม์ของ coding-agent

## ภาพรวมวงจรชีวิต

1. **SDK เริ่มต้น** เรียก `discoverAndLoadMCPTools()` (ยกเว้น MCP ถูกปิดใช้งาน)
2. **การค้นพบ** (`loadAllMCPConfigs`) แก้ไขค่า config ของ MCP server จากแหล่งความสามารถ กรองรายการที่ถูกปิดใช้งาน/project/Exa และเก็บรักษา metadata ของแหล่งที่มา
3. **ขั้นตอนการเชื่อมต่อของ Manager** (`MCPManager.connectServers`) เริ่มการเชื่อมต่อต่อเซิร์ฟเวอร์ + `tools/list` แบบขนาน
4. **เกตเริ่มต้นแบบเร็ว** รอสูงสุด 250ms จากนั้นอาจส่งคืน:
   - `MCPTool` ที่โหลดเสร็จสมบูรณ์,
   - ข้อผิดพลาดต่อเซิร์ฟเวอร์,
   - หรือ `DeferredMCPTool` ที่แคชไว้สำหรับเซิร์ฟเวอร์ที่ยังรอดำเนินการ
5. **การเชื่อมต่อ SDK** รวมเครื่องมือ MCP เข้ากับ registry เครื่องมือรันไทม์สำหรับเซสชัน
6. **เซสชันที่ใช้งานอยู่** สามารถรีเฟรชเครื่องมือ MCP ผ่านโฟลว์ `/mcp` (`disconnectAll` + ค้นพบใหม่ + `session.refreshMCPTools`)
7. **การยุติ** เกิดขึ้นเมื่อผู้เรียกใช้ `disconnectServer`/`disconnectAll`; manager ยังล้างการลงทะเบียนเครื่องมือ MCP สำหรับเซิร์ฟเวอร์ที่ถูกตัดการเชื่อมต่อด้วย

## ขั้นตอนการค้นพบและโหลด

### เส้นทางเข้าจาก SDK

`createAgentSession()` ใน `src/sdk.ts` ดำเนินการเริ่มต้น MCP เมื่อ `enableMCP` เป็น true (ค่าเริ่มต้น):

- เรียก `discoverAndLoadMCPTools(cwd, { ... })`,
- ส่ง `authStorage`, cache storage และการตั้งค่า `mcp.enableProjectConfig`,
- ตั้ง `filterExa: true` เสมอ,
- บันทึกข้อผิดพลาดการโหลด/เชื่อมต่อต่อเซิร์ฟเวอร์,
- เก็บ manager ที่ส่งคืนไว้ใน `toolSession.mcpManager` และผลลัพธ์ของเซสชัน

หาก `enableMCP` เป็น false การค้นพบ MCP จะถูกข้ามทั้งหมด

### การค้นพบและกรอง Config

`loadAllMCPConfigs()` (`src/mcp/config.ts`) โหลดรายการ MCP server ตามมาตรฐานผ่านการค้นพบความสามารถ จากนั้นแปลงเป็น `MCPServerConfig` แบบ legacy

พฤติกรรมการกรอง:

- `enableProjectConfig: false` ลบรายการระดับ project (`_source.level === "project"`)
- เซิร์ฟเวอร์ที่มี `enabled: false` จะถูกข้ามก่อนการพยายามเชื่อมต่อ
- เซิร์ฟเวอร์ Exa จะถูกกรองออกโดยค่าเริ่มต้น และ API key จะถูกแยกออกสำหรับการรวมเครื่องมือ Exa แบบ native

ผลลัพธ์รวมทั้ง `configs` และ `sources` (metadata ที่ใช้ในภายหลังสำหรับการติดป้ายชื่อ provider)

### พฤติกรรมความล้มเหลวระดับการค้นพบ

`discoverAndLoadMCPTools()` แยกแยะความล้มเหลวสองประเภท:

- **ความล้มเหลวร้ายแรงของการค้นพบ** (exception จาก `manager.discoverAndConnect` โดยทั่วไปจากการค้นพบ config): ส่งคืนชุดเครื่องมือว่างและข้อผิดพลาดสังเคราะห์หนึ่งรายการ `{ path: ".mcp.json", error }`
- **ความล้มเหลวรันไทม์/การเชื่อมต่อต่อเซิร์ฟเวอร์**: manager ส่งคืนผลสำเร็จบางส่วนพร้อม map `errors`; เซิร์ฟเวอร์อื่นดำเนินการต่อ

ดังนั้นการเริ่มต้นจะไม่ทำให้เซสชัน agent ทั้งหมดล้มเหลวเมื่อ MCP server แต่ละตัวล้มเหลว

## โมเดลสถานะของ Manager

`MCPManager` ติดตามวงจรชีวิตรันไทม์ด้วย registry แยกกัน:

- `#connections: Map<string, MCPServerConnection>` — เซิร์ฟเวอร์ที่เชื่อมต่อเสร็จสมบูรณ์
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — กำลังดำเนินการ handshake
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — เชื่อมต่อแล้วแต่เครื่องมือยังโหลดอยู่
- `#tools: CustomTool[]` — มุมมองเครื่องมือ MCP ปัจจุบันที่เปิดเผยให้ผู้เรียกใช้
- `#sources: Map<string, SourceMeta>` — metadata ของ provider/แหล่งที่มาแม้ก่อนการเชื่อมต่อเสร็จสมบูรณ์

`getConnectionStatus(name)` ดึงสถานะจาก map เหล่านี้:

- `connected` ถ้าอยู่ใน `#connections`,
- `connecting` ถ้ากำลังรอการเชื่อมต่อหรือรอการโหลดเครื่องมือ,
- `disconnected` ในกรณีอื่น

## การสร้างการเชื่อมต่อและเวลาเริ่มต้น

## ไปป์ไลน์การเชื่อมต่อต่อเซิร์ฟเวอร์

สำหรับแต่ละเซิร์ฟเวอร์ที่ค้นพบใน `connectServers()`:

1. จัดเก็บ/อัปเดต metadata ของแหล่งที่มา,
2. ข้ามหากเชื่อมต่อแล้ว/กำลังรอดำเนินการ,
3. ตรวจสอบฟิลด์ transport (`validateServerConfig`),
4. แก้ไขการแทนที่ auth/shell (`#resolveAuthConfig`),
5. เรียก `connectToServer(name, resolvedConfig)`,
6. เรียก `listTools(connection)`,
7. แคชคำจำกัดความเครื่องมือ (`MCPToolCache.set`) แบบ best-effort

พฤติกรรมของ `connectToServer()` (`src/mcp/client.ts`):

- สร้าง transport แบบ stdio หรือ HTTP/SSE,
- ดำเนินการ `initialize` + `notifications/initialized` ของ MCP,
- ใช้ timeout (`config.timeout` หรือค่าเริ่มต้น 30 วินาที),
- ปิด transport เมื่อการเริ่มต้นล้มเหลว

### เกตเริ่มต้นแบบเร็ว + fallback แบบรอ

`connectServers()` รอการแข่งขันระหว่าง:

- งานเชื่อมต่อ/โหลดเครื่องมือทั้งหมดเสร็จสิ้น, และ
- `STARTUP_TIMEOUT_MS = 250`

หลังจาก 250ms:

- งานที่สำเร็จกลายเป็น `MCPTool` ที่ใช้งานได้,
- งานที่ถูกปฏิเสธสร้างข้อผิดพลาดต่อเซิร์ฟเวอร์,
- งานที่ยังรอดำเนินการ:
  - ใช้คำจำกัดความเครื่องมือที่แคชไว้หากมี (`MCPToolCache.get`) เพื่อสร้าง `DeferredMCPTool`,
  - มิฉะนั้นจะบล็อกจนกว่างานที่รอดำเนินการเหล่านั้นจะเสร็จสิ้น

นี่คือโมเดลเริ่มต้นแบบผสม: ส่งคืนเร็วเมื่อมีแคช รอเพื่อความถูกต้องเมื่อไม่มีแคช

### พฤติกรรมการทำงานเบื้องหลังที่เสร็จสมบูรณ์

แต่ละ `toolsPromise` ที่รอดำเนินการยังมีการทำงานต่อเนื่องเบื้องหลังที่ในที่สุดจะ:

- แทนที่ส่วนเครื่องมือของเซิร์ฟเวอร์นั้นในสถานะ manager ผ่าน `#replaceServerTools`,
- เขียนแคช,
- บันทึกความล้มเหลวที่ล่าช้าเฉพาะหลังจากเริ่มต้น (`allowBackgroundLogging`)

## การเปิดเผยเครื่องมือและความพร้อมใช้งานในเซสชัน

### การลงทะเบียนเมื่อเริ่มต้น

`discoverAndLoadMCPTools()` แปลงเครื่องมือ manager เป็น `LoadedCustomTool[]` และตกแต่งเส้นทาง (`mcp:<server> via <providerName>` เมื่อทราบ)

`createAgentSession()` จากนั้นเพิ่มเครื่องมือเหล่านี้ลงใน `customTools` ซึ่งถูกห่อหุ้มและเพิ่มลงใน registry เครื่องมือรันไทม์ด้วยชื่อเช่น `mcp_<server>_<tool>`

### การเรียกใช้เครื่องมือ

- `MCPTool` เรียกเครื่องมือผ่าน `MCPServerConnection` ที่เชื่อมต่อแล้ว
- `DeferredMCPTool` รอ `waitForConnection(server)` ก่อนเรียก; สิ่งนี้อนุญาตให้เครื่องมือที่แคชไว้มีอยู่ก่อนที่การเชื่อมต่อจะพร้อม

ทั้งสองส่งคืนผลลัพธ์เครื่องมือแบบมีโครงสร้างและแปลงข้อผิดพลาด transport/เครื่องมือเป็นเนื้อหาเครื่องมือ `MCP error: ...` (abort ยังคงเป็น abort)

## เส้นทางรีเฟรช/โหลดใหม่ (เริ่มต้น vs โหลดใหม่แบบสด)

### เส้นทางเริ่มต้นครั้งแรก

- การค้นพบ/โหลดครั้งเดียวใน `sdk.ts`,
- เครื่องมือถูกลงทะเบียนใน registry เครื่องมือเซสชันเริ่มต้น

### เส้นทางโหลดใหม่แบบโต้ตอบ

เส้นทาง `/mcp reload` (`src/modes/controllers/mcp-command-controller.ts`) ดำเนินการ:

1. `mcpManager.disconnectAll()`,
2. `mcpManager.discoverAndConnect()`,
3. `session.refreshMCPTools(mcpManager.getTools())`

`session.refreshMCPTools()` (`src/session/agent-session.ts`) ลบเครื่องมือ `mcp_` ทั้งหมด ห่อหุ้มเครื่องมือ MCP ล่าสุดใหม่ และเปิดใช้งานชุดเครื่องมืออีกครั้ง เพื่อให้การเปลี่ยนแปลง MCP มีผลโดยไม่ต้องเริ่มเซสชันใหม่

นอกจากนี้ยังมีเส้นทางติดตามสำหรับการเชื่อมต่อที่ล่าช้า: หลังจากรอเซิร์ฟเวอร์เฉพาะ หากสถานะกลายเป็น `connected` จะเรียก `session.refreshMCPTools(...)` อีกครั้งเพื่อให้เครื่องมือที่เพิ่งพร้อมใช้งานถูกผูกใหม่ในเซสชัน

## สุขภาพ การเชื่อมต่อใหม่ และพฤติกรรมความล้มเหลวบางส่วน

พฤติกรรมรันไทม์ปัจจุบันเป็นแบบเรียบง่ายโดยตั้งใจ:

- **ไม่มีการตรวจสอบสุขภาพอัตโนมัติ** ใน manager/client
- **ไม่มีลูปเชื่อมต่อใหม่อัตโนมัติ** เมื่อ transport หลุด
- Manager ไม่ได้ subscribe กับ `onClose`/`onError` ของ transport; สถานะถูกขับเคลื่อนด้วย registry
- การเชื่อมต่อใหม่เป็นแบบชัดเจน: โฟลว์โหลดใหม่หรือการเรียก `connectServers()` โดยตรง

ในทางปฏิบัติ:

- เซิร์ฟเวอร์หนึ่งล้มเหลวจะไม่ลบเครื่องมือจากเซิร์ฟเวอร์ที่สมบูรณ์,
- ความล้มเหลวของการเชื่อมต่อ/รายการถูกแยกต่อเซิร์ฟเวอร์,
- แคชเครื่องมือและการอัปเดตเบื้องหลังเป็นแบบ best-effort (บันทึก warning/error ไม่มีการหยุดแบบ hard)

## ความหมายของการยุติ

### การยุติระดับเซิร์ฟเวอร์

`disconnectServer(name)`:

- ลบรายการที่รอดำเนินการ/metadata ของแหล่งที่มา,
- ปิด transport หากเชื่อมต่ออยู่,
- ลบเครื่องมือ `mcp_` ของเซิร์ฟเวอร์นั้นจากสถานะ manager

### การยุติทั่วไป

`disconnectAll()`:

- ปิด transport ที่ใช้งานอยู่ทั้งหมดด้วย `Promise.allSettled`,
- ล้าง map ที่รอดำเนินการ แหล่งที่มา การเชื่อมต่อ และรายการเครื่องมือ manager

ในการเชื่อมต่อปัจจุบัน การยุติแบบชัดเจนถูกใช้ในโฟลว์คำสั่ง MCP (สำหรับโหลดใหม่/ลบ/ปิดใช้งาน) ไม่มี hook การกำจัด manager แบบอัตโนมัติแยกต่างหากในเส้นทางเริ่มต้น; ผู้เรียกมีหน้าที่รับผิดชอบในการเรียกเมธอด disconnect ของ manager เมื่อต้องการการปิดระบบ MCP แบบกำหนดได้

## โหมดความล้มเหลวและการรับประกัน

| สถานการณ์ | พฤติกรรม | ล้มเหลวแบบ Hard vs best-effort |
| --- | --- | --- |
| การค้นพบโยน exception (เส้นทางโหลด capability/config) | Loader ส่งคืนเครื่องมือว่าง + ข้อผิดพลาดสังเคราะห์ `.mcp.json` | Best-effort เริ่มต้นเซสชัน |
| Config เซิร์ฟเวอร์ไม่ถูกต้อง | เซิร์ฟเวอร์ถูกข้ามพร้อมรายการข้อผิดพลาดการตรวจสอบ | Best-effort ต่อเซิร์ฟเวอร์ |
| Timeout การเชื่อมต่อ/ความล้มเหลวการเริ่มต้น | บันทึกข้อผิดพลาดเซิร์ฟเวอร์; เซิร์ฟเวอร์อื่นดำเนินการต่อ | Best-effort ต่อเซิร์ฟเวอร์ |
| `tools/list` ยังรอดำเนินการเมื่อเริ่มต้นพร้อมแคช hit | ส่งคืนเครื่องมือ deferred ทันที | Best-effort เริ่มต้นเร็ว |
| `tools/list` ยังรอดำเนินการเมื่อเริ่มต้นโดยไม่มีแคช | เริ่มต้นรอจนกว่างานที่รอดำเนินการจะเสร็จ | Hard wait เพื่อความถูกต้อง |
| ความล้มเหลวการโหลดเครื่องมือเบื้องหลังที่ล่าช้า | บันทึกหลังเกตเริ่มต้น | Best-effort logging |
| Transport รันไทม์หลุด | ไม่มีการเชื่อมต่อใหม่อัตโนมัติ; การเรียกในอนาคตล้มเหลวจนกว่าจะเชื่อมต่อใหม่/โหลดใหม่ | Best-effort กู้คืนผ่านการดำเนินการด้วยตนเอง |

## พื้นผิว API สาธารณะ

`src/mcp/index.ts` re-export API ของ loader/manager/client สำหรับผู้เรียกภายนอก `src/sdk.ts` เปิดเผย `discoverMCPServers()` เป็น wrapper ที่สะดวกที่ส่งคืนรูปแบบผลลัพธ์ loader เดียวกัน

## ไฟล์การนำไปใช้งาน

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — facade ของ loader, การทำให้ข้อผิดพลาดการค้นพบเป็นมาตรฐาน, การแปลง `LoadedCustomTool`
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — registry สถานะวงจรชีวิต, โฟลว์เชื่อมต่อ/รายการแบบขนาน, รีเฟรช/ตัดการเชื่อมต่อ
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — การตั้งค่า transport, handshake เริ่มต้น, list/call/disconnect
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — API exports ของโมดูล MCP
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — การเชื่อมต่อเริ่มต้นกับ registry เซสชัน/เครื่องมือ
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — การค้นพบ/กรอง/ตรวจสอบ config ที่ใช้โดย manager
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — พฤติกรรมรันไทม์ของ `MCPTool` และ `DeferredMCPTool`
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — การผูกใหม่แบบสด `refreshMCPTools`
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — โฟลว์โหลดใหม่/เชื่อมต่อใหม่แบบโต้ตอบ
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — การ proxy MCP ของ subagent ผ่านการเชื่อมต่อ manager หลัก
