---
title: MCP Protocol and Transport Internals
description: >-
  MCP protocol implementation with stdio, SSE, and streamable HTTP transport
  layers.
sidebar:
  order: 2
  label: Protocol & transports
i18n:
  sourceHash: 48632064dd00
  translator: machine
---

# โปรโตคอล MCP และระบบภายในของ Transport

เอกสารนี้อธิบายวิธีที่ coding-agent ใช้งานระบบ MCP JSON-RPC messaging และวิธีที่แยกความรับผิดชอบด้านโปรโตคอลออกจากความรับผิดชอบด้าน transport

## ขอบเขต

ครอบคลุม:

- กระแสการทำงานของ JSON-RPC request/response และ notification
- การเชื่อมโยง request และวงจรชีวิตสำหรับ transport แบบ stdio และ HTTP/SSE
- พฤติกรรมของ timeout และ cancellation
- การส่งต่อข้อผิดพลาดและการจัดการ payload ที่ไม่ถูกรูปแบบ
- ขอบเขตการเลือก transport (`stdio` เทียบกับ `http`/`sse`)
- ความรับผิดชอบด้าน reconnect/retry ใดเป็นระดับ transport เทียบกับระดับ manager

ไม่ครอบคลุมเรื่อง UX การเขียน extension หรือ UI ของคำสั่ง

## ไฟล์ที่เกี่ยวข้อง

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/transports/stdio.ts`](../../packages/coding-agent/src/mcp/transports/stdio.ts)
- [`src/mcp/transports/http.ts`](../../packages/coding-agent/src/mcp/transports/http.ts)
- [`src/mcp/transports/index.ts`](../../packages/coding-agent/src/mcp/transports/index.ts)
- [`src/mcp/json-rpc.ts`](../../packages/coding-agent/src/mcp/json-rpc.ts)
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)

## ขอบเขตของแต่ละชั้น

### ชั้นโปรโตคอล (JSON-RPC + MCP methods)

- รูปแบบข้อความถูกกำหนดไว้ใน `types.ts` (`JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcResponse`, `JsonRpcMessage`)
- ลอจิกของ MCP client (`client.ts`) กำหนดลำดับ method และการ handshake ของ session:
  1. `initialize` request
  2. `notifications/initialized` notification
  3. การเรียก method เช่น `tools/list`, `tools/call`

### ชั้น Transport (`MCPTransport`)

`MCPTransport` เป็น abstraction สำหรับการส่งข้อมูลและวงจรชีวิต:

- `request(method, params, options?) -> Promise<T>`
- `notify(method, params?) -> Promise<void>`
- `close()`
- `connected`
- callback ที่เป็นตัวเลือก: `onClose`, `onError`, `onNotification`

การ implement transport แต่ละตัวรับผิดชอบรายละเอียดด้าน framing และ I/O:

- `StdioTransport`: JSON แบบ newline-delimited ผ่าน stdio ของ subprocess
- `HttpTransport`: JSON-RPC ผ่าน HTTP POST พร้อมตัวเลือก SSE responses/listening

### ข้อควรระวังสำคัญในปัจจุบัน

Transport callbacks (`onClose`, `onError`, `onNotification`) ถูก implement แล้ว แต่ flow ปัจจุบันของ `MCPClient`/`MCPManager` ยังไม่ได้เชื่อมต่อลอจิก reconnection เข้ากับ callbacks เหล่านี้ Notification จะถูกใช้งานก็ต่อเมื่อผู้เรียกลงทะเบียน handler ไว้เท่านั้น

## การเลือก Transport

`client.ts:createTransport()` เลือก transport จาก config:

- `type` ไม่ได้ระบุหรือ `"stdio"` -> `createStdioTransport`
- `"http"` หรือ `"sse"` -> `createHttpTransport`

`"sse"` ถูกจัดการเป็นตัวแปรของ HTTP transport (class เดียวกัน) ไม่ใช่ transport implementation ที่แยกต่างหาก

## กระแสการทำงานของ JSON-RPC message และการเชื่อมโยง

## Request ID

แต่ละ transport สร้าง ID ต่อ request (`Math.random` + timestamp string) ID เป็น correlation token เฉพาะภายใน transport

## เส้นทางการเชื่อมโยงของ Stdio

- Request ขาออกถูก serialize เป็น JSON object หนึ่งชิ้น + `\n`
- `#pendingRequests: Map<id, {resolve,reject}>` เก็บ request ที่กำลังดำเนินการ
- Read loop แยกวิเคราะห์ JSONL จาก stdout และเรียก `#handleMessage`
- หาก message ขาเข้ามี `id` ที่ตรงกัน request จะ resolve/reject
- หาก message ขาเข้ามี `method` แต่ไม่มี `id` จะถูกจัดการเป็น notification และส่งไปยัง `onNotification`

ID ที่ไม่รู้จักจะถูกละเว้น (ไม่มี rejection ไม่มี error callback)

## เส้นทางการเชื่อมโยงของ HTTP

- Request ขาออกเป็น HTTP `POST` พร้อม JSON body และ `id` ที่สร้างขึ้น
- เส้นทาง response แบบไม่ใช่ SSE: แยกวิเคราะห์ JSON-RPC response หนึ่งรายการและคืน `result`/throw เมื่อเป็น `error`
- เส้นทาง response แบบ SSE (`Content-Type: text/event-stream`): stream events คืน message แรกที่มี `id` ตรงกับ request ID ที่คาดหวังและมี `result` หรือ `error`
- SSE message ที่มี `method` แต่ไม่มี `id` จะถูกจัดการเป็น notification

หาก SSE stream จบก่อนที่จะพบ response ที่ตรงกัน request จะล้มเหลวพร้อมข้อความ `No response received for request ID ...`

## Notification

Client ส่ง JSON-RPC notification ผ่าน `transport.notify(...)`

- Stdio: เขียน notification frame ไปยัง stdin (`jsonrpc`, `method`, `params` ที่เป็นตัวเลือก) พร้อม newline
- HTTP: ส่ง POST body โดยไม่มี `id` การสำเร็จรับ `2xx` หรือ `202 Accepted`

Notification ที่เริ่มต้นจากเซิร์ฟเวอร์จะถูกส่งผ่านเฉพาะทาง `onNotification` ของ transport เท่านั้น ไม่มี global subscriber เริ่มต้นใน manager/client

## รายละเอียดภายในของ Stdio Transport

## วงจรชีวิตและการเปลี่ยนสถานะ

- สถานะเริ่มต้น: `connected=false`, `process=null`, pending map ว่างเปล่า
- `connect()`:
  - spawn subprocess ด้วย command/args/env/cwd ที่กำหนด
  - ทำเครื่องหมายว่าเชื่อมต่อแล้ว
  - เริ่ม stdout read loop (`readJsonl`)
  - เริ่ม stderr loop (อ่าน/ทิ้ง ปัจจุบันทำงานแบบเงียบ)
- `close()`:
  - ทำเครื่องหมายว่าตัดการเชื่อมต่อแล้ว
  - reject pending request ทั้งหมด (`Transport closed`)
  - kill subprocess
  - รอ read loop ปิดตัวลง
  - เรียก `onClose`

หาก read loop ออกโดยไม่คาดคิด `finally` จะเรียก `#handleClose()` ซึ่งดำเนินการ reject pending-request และเรียก close callback เช่นเดียวกัน

## Timeout และ Cancellation

ต่อแต่ละ request:

- timeout ค่าเริ่มต้นเป็น `config.timeout ?? 30000`
- `AbortSignal` ที่เป็นตัวเลือกจากผู้เรียก
- ทั้ง abort และ timeout จะ reject pending promise และล้าง map entry

Cancellation เป็นแบบ local เท่านั้น: transport ไม่ได้ส่ง cancellation notification ระดับโปรโตคอลไปยังเซิร์ฟเวอร์

## การจัดการ Payload ที่ไม่ถูกรูปแบบ

ใน read loop:

- แต่ละบรรทัด JSONL ที่แยกวิเคราะห์แล้วจะถูกส่งไปยัง `#handleMessage` ภายใน `try/catch`
- exception จากการจัดการ message ที่ไม่ถูกรูปแบบ/ไม่ถูกต้องจะถูกทิ้งไป (ความคิดเห็น `Skip malformed lines`)
- loop ดำเนินต่อไป ดังนั้น message เสียหนึ่งรายการจะไม่ทำให้การเชื่อมต่อหยุดทำงาน

หาก stream parser ที่อยู่เบื้องล่าง throw ข้อผิดพลาด `onError` จะถูกเรียก (เมื่อยังเชื่อมต่ออยู่) จากนั้นการเชื่อมต่อจะปิดลง

## พฤติกรรมเมื่อ Disconnect/ล้มเหลว

เมื่อ process ออกหรือ stream ปิด:

- request ที่กำลังดำเนินการทั้งหมดจะถูก reject ด้วย `Transport closed`
- ไม่มีการ restart หรือ reconnect อัตโนมัติ
- ชั้นที่สูงกว่าต้องเชื่อมต่อใหม่โดยสร้าง transport ใหม่

## หมายเหตุเรื่อง Backpressure/Streaming

- การเขียนขาออกใช้ `stdin.write()` + `flush()` โดยไม่รอ drain semantics
- ไม่มีการจัดการ queue หรือ high-watermark อย่างชัดเจนใน transport
- การประมวลผลขาเข้าขับเคลื่อนด้วย stream (`for await` บน `readJsonl`) ทีละ message ที่แยกวิเคราะห์แล้ว

## รายละเอียดภายในของ HTTP/SSE Transport

## วงจรชีวิตและความหมายของการเชื่อมต่อ

HTTP transport มีสถานะการเชื่อมต่อเชิงตรรกะ แต่เส้นทาง request เป็นแบบ stateless ต่อการเรียก HTTP แต่ละครั้ง:

- `connect()` ตั้งค่า `connected=true` (ไม่มี socket/session handshake)
- การติดตาม session ของเซิร์ฟเวอร์เป็นตัวเลือกผ่าน `Mcp-Session-Id` header
- `close()` ส่ง `DELETE` พร้อม `Mcp-Session-Id` เป็นตัวเลือก ยกเลิก SSE listener และเรียก `onClose`

ดังนั้น `connected` หมายความว่า "transport พร้อมใช้งาน" ไม่ใช่ "มี persistent stream ที่สร้างขึ้นแล้ว"

## พฤติกรรมของ Session Header

- เมื่อตอบกลับ POST หากมี `Mcp-Session-Id` header transport จะเก็บไว้
- request/notification ที่ตามมาจะรวม `Mcp-Session-Id`
- `close()` พยายามยุติ session ของเซิร์ฟเวอร์ด้วย HTTP DELETE ความล้มเหลวในการยุติจะถูกละเว้น

## Timeout และ Cancellation

สำหรับทั้ง `request()` และ `notify()`:

- timeout ใช้ `AbortController` (`config.timeout ?? 30000`)
- signal ภายนอก หากมี จะถูกรวมผ่าน `AbortSignal.any([...])`
- การจัดการ AbortError แยกแยะระหว่าง abort จากผู้เรียกกับ timeout

ข้อผิดพลาดที่ throw:

- timeout: `Request timeout after ...ms` (หรือ `SSE response timeout ...`, `Notify timeout ...`)
- abort จากผู้เรียก: AbortError ดั้งเดิมจะถูก rethrow เมื่อ signal ภายนอกถูก abort แล้ว

## การส่งต่อข้อผิดพลาด HTTP

เมื่อ response ไม่ใช่ OK:

- response text จะถูกรวมในข้อผิดพลาดที่ throw (`HTTP <status>: <text>`)
- หากมี auth hint จาก `WWW-Authenticate` และ `Mcp-Auth-Server` จะถูกต่อท้าย

เมื่อเป็น JSON-RPC error object:

- throw `MCP error <code>: <message>`

JSON body ที่ไม่ถูกรูปแบบ (ความล้มเหลวของ `response.json()`) จะส่งต่อเป็น parse exception

## พฤติกรรม SSE และโหมดต่างๆ

มีเส้นทาง SSE สองแบบ:

1. **SSE response ต่อ request** (`#parseSSEResponse`)
   - ใช้เมื่อ content type ของ POST response เป็น `text/event-stream`
   - อ่าน stream จนกว่าจะพบ response id ที่ตรงกัน
   - สามารถประมวลผล notification ที่แทรกเข้ามาระหว่าง stream เดียวกัน

2. **SSE listener แบบ background** (`startSSEListener()`)
   - GET listener ที่เป็นตัวเลือกสำหรับ notification ที่เริ่มต้นจากเซิร์ฟเวอร์
   - ปัจจุบันไม่ถูกเริ่มต้นอัตโนมัติโดย MCP manager/client
   - หาก GET คืน `405` listener จะปิดตัวเองอย่างเงียบ (เซิร์ฟเวอร์ไม่รองรับโหมดนี้)

## การจัดการ Payload ที่ไม่ถูกรูปแบบและ Disconnect

ข้อผิดพลาดในการแยกวิเคราะห์ JSON ของ SSE จะ bubble ออกจาก `readSseJson` และ reject request/listener

- ข้อผิดพลาดการแยกวิเคราะห์ SSE ของ request จะ reject request ที่กำลังทำงาน
- ข้อผิดพลาดของ background listener จะเรียก `onError` (ยกเว้น AbortError)
- ไม่มี auto-reconnect สำหรับ background listener

## `json-rpc.ts` utility เทียบกับ transport abstraction

`src/mcp/json-rpc.ts` ให้ helper `callMCP()` และ `parseSSE()` สำหรับการเรียก HTTP MCP โดยตรง (ใช้โดย Exa integration) ไม่ใช่ `MCPTransport` abstraction ที่ใช้โดย `MCPClient`/`MCPManager`

ความแตกต่างที่สำคัญจาก `HttpTransport`:

- แยกวิเคราะห์ response text ทั้งหมดก่อน จากนั้นดึงบรรทัด `data:` แรก (`parseSSE`) พร้อม JSON fallback
- ไม่มีการจัดการ request timeout ไม่มี abort API ไม่มี session-id handling ไม่มีวงจรชีวิต transport
- คืน JSON-RPC envelope object แบบ raw

เส้นทางนี้เป็นแบบ lightweight แต่มีความ robust น้อยกว่า transport implementation แบบเต็ม

## ความรับผิดชอบด้าน Retry/Reconnect

## ระดับ Transport

การ implement transport ในปัจจุบัน**ไม่ได้**:

- retry request ที่ล้มเหลว
- reconnect หลัง stdio process ออก
- reconnect SSE listener
- ส่ง request ที่กำลังดำเนินการใหม่หลัง disconnect

transport เหล่านี้ล้มเหลวอย่างรวดเร็วและส่งต่อข้อผิดพลาด

## ระดับ Manager/Client

`MCPManager` จัดการการค้นหา/เชื่อมต่อเริ่มต้นและสามารถ reconnect ได้เฉพาะโดยการเรียก flow การเชื่อมต่อใหม่ (เส้นทาง `connectToServer`/`discoverAndConnect`) ไม่ได้ซ่อมแซม transport ที่เชื่อมต่ออยู่แล้วโดยอัตโนมัติเมื่อเกิด runtime failure callback

`MCPManager` มีพฤติกรรม fallback เมื่อเริ่มต้นสำหรับเซิร์ฟเวอร์ที่ช้า (deferred tools จาก cache) แต่นั่นเป็น fallback ของ tool availability ไม่ใช่ transport retry

## สรุปสถานการณ์ความล้มเหลว

- **บรรทัด stdio message ที่ไม่ถูกรูปแบบ**: ถูกทิ้ง; stream ดำเนินต่อ
- **stdio stream/process จบ**: transport ปิด; pending request ถูก reject เป็น `Transport closed`
- **HTTP ไม่ใช่ 2xx**: request/notify throw HTTP error
- **JSON response ที่ไม่ถูกต้อง**: parse exception ถูกส่งต่อ
- **SSE จบโดยไม่พบ id ที่ตรงกัน**: request ล้มเหลวพร้อมข้อความ `No response received for request ID ...`
- **Timeout**: ข้อผิดพลาด timeout เฉพาะ transport
- **Abort จากผู้เรียก**: AbortError/reason ถูกส่งต่อจาก signal ของผู้เรียก

## กฎขอบเขตในทางปฏิบัติ

หากความรับผิดชอบเกี่ยวกับรูปแบบ message, การเชื่อมโยง id, หรือลำดับ MCP method สิ่งนั้นเป็นของลอจิกโปรโตคอล/client

หากความรับผิดชอบเกี่ยวกับ framing (JSONL เทียบกับ HTTP/SSE), การแยกวิเคราะห์ stream, วงจรชีวิต fetch/spawn, นาฬิกา timeout, หรือการ teardown การเชื่อมต่อ สิ่งนั้นเป็นของ transport implementation
