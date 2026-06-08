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

# ระบบภายในของ MCP Protocol และ Transport

เอกสารนี้อธิบายวิธีที่ coding-agent implement การส่งข้อความ MCP JSON-RPC และวิธีที่ความรับผิดชอบของ protocol ถูกแยกออกจากความรับผิดชอบของ transport

## ขอบเขต

ครอบคลุม:

- การไหลของ JSON-RPC request/response และ notification
- การจับคู่ request และวงจรชีวิตสำหรับ stdio และ HTTP/SSE transports
- พฤติกรรม timeout และ cancellation
- การส่งต่อ error และการจัดการ payload ที่ผิดรูปแบบ
- ขอบเขตการเลือก transport (`stdio` vs `http`/`sse`)
- ความรับผิดชอบใดเป็นระดับ transport vs ระดับ manager สำหรับ reconnect/retry

ไม่ครอบคลุม UX ของการเขียน extension หรือ command UI

## ไฟล์ implementation

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/transports/stdio.ts`](../../packages/coding-agent/src/mcp/transports/stdio.ts)
- [`src/mcp/transports/http.ts`](../../packages/coding-agent/src/mcp/transports/http.ts)
- [`src/mcp/transports/index.ts`](../../packages/coding-agent/src/mcp/transports/index.ts)
- [`src/mcp/json-rpc.ts`](../../packages/coding-agent/src/mcp/json-rpc.ts)
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)

## ขอบเขตของแต่ละ layer

### Protocol layer (JSON-RPC + MCP methods)

- รูปแบบข้อความถูกกำหนดใน `types.ts` (`JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcResponse`, `JsonRpcMessage`)
- MCP client logic (`client.ts`) กำหนดลำดับ method และ session handshake:
  1. `initialize` request
  2. `notifications/initialized` notification
  3. การเรียก method เช่น `tools/list`, `tools/call`

### Transport layer (`MCPTransport`)

`MCPTransport` ทำหน้าที่ abstract การส่งข้อมูลและวงจรชีวิต:

- `request(method, params, options?) -> Promise<T>`
- `notify(method, params?) -> Promise<void>`
- `close()`
- `connected`
- callback ที่เป็นตัวเลือก: `onClose`, `onError`, `onNotification`

Transport implementation แต่ละตัวเป็นเจ้าของรายละเอียดการ framing และ I/O:

- `StdioTransport`: JSON ที่คั่นด้วย newline ผ่าน subprocess stdio
- `HttpTransport`: JSON-RPC ผ่าน HTTP POST พร้อม SSE responses/listening ที่เป็นตัวเลือก

### ข้อควรระวังที่สำคัญในปัจจุบัน

Transport callbacks (`onClose`, `onError`, `onNotification`) ถูก implement แล้ว แต่ flow ปัจจุบันของ `MCPClient`/`MCPManager` ไม่ได้เชื่อมต่อ logic การ reconnect เข้ากับ callbacks เหล่านี้ Notifications จะถูกใช้ก็ต่อเมื่อ caller ลงทะเบียน handlers เท่านั้น

## การเลือก transport

`client.ts:createTransport()` เลือก transport จาก config:

- `type` ไม่ระบุหรือ `"stdio"` -> `createStdioTransport`
- `"http"` หรือ `"sse"` -> `createHttpTransport`

`"sse"` ถูกถือว่าเป็น variant ของ HTTP transport (class เดียวกัน) ไม่ใช่ transport implementation ที่แยกต่างหาก

## การไหลของ JSON-RPC message และการจับคู่

## Request IDs

แต่ละ transport สร้าง ID ต่อ request (`Math.random` + timestamp string) IDs เป็น correlation token ที่อยู่เฉพาะในระดับ transport

## เส้นทางการจับคู่ของ Stdio

- Request ขาออกถูก serialize เป็น JSON object หนึ่งตัว + `\n`
- `#pendingRequests: Map<id, {resolve,reject}>` เก็บ requests ที่อยู่ระหว่างดำเนินการ
- Read loop แยกวิเคราะห์ JSONL จาก stdout และเรียก `#handleMessage`
- ถ้า message ขาเข้ามี `id` ที่ตรงกัน request จะ resolve/reject
- ถ้า message ขาเข้ามี `method` และไม่มี `id` จะถูกถือว่าเป็น notification และส่งไปยัง `onNotification`

ID ที่ไม่รู้จักจะถูกข้ามไป (ไม่มี rejection, ไม่มี error callback)

## เส้นทางการจับคู่ของ HTTP

- Request ขาออกเป็น HTTP `POST` พร้อม JSON body และ `id` ที่สร้างขึ้น
- เส้นทาง response ที่ไม่ใช่ SSE: แยกวิเคราะห์ JSON-RPC response หนึ่งตัวแล้วคืน `result`/throw เมื่อมี `error`
- เส้นทาง SSE response (`Content-Type: text/event-stream`): stream events, คืนข้อความแรกที่ `id` ตรงกับ request ID ที่คาดหวังและมี `result` หรือ `error`
- SSE messages ที่มี `method` และไม่มี `id` จะถูกถือว่าเป็น notifications

ถ้า SSE stream สิ้นสุดก่อนที่จะพบ response ที่ตรงกัน request จะล้มเหลวด้วย `No response received for request ID ...`

## Notifications

Client ส่ง JSON-RPC notifications ผ่าน `transport.notify(...)`

- Stdio: เขียน notification frame ไปยัง stdin (`jsonrpc`, `method`, `params` ที่เป็นตัวเลือก) บวก newline
- HTTP: ส่ง POST body โดยไม่มี `id`; ความสำเร็จยอมรับ `2xx` หรือ `202 Accepted`

Notifications ที่เริ่มต้นจาก server จะถูกเปิดเผยผ่าน transport `onNotification` เท่านั้น; ไม่มี global subscriber เริ่มต้นใน manager/client

## รายละเอียดภายในของ Stdio transport

## วงจรชีวิตและการเปลี่ยนสถานะ

- เริ่มต้น: `connected=false`, `process=null`, pending map ว่าง
- `connect()`:
  - spawn subprocess ด้วย command/args/env/cwd ที่กำหนดค่าไว้
  - ทำเครื่องหมายว่า connected
  - เริ่ม stdout read loop (`readJsonl`)
  - เริ่ม stderr loop (อ่าน/ทิ้ง; ปัจจุบันเงียบ)
- `close()`:
  - ทำเครื่องหมายว่า disconnected
  - reject pending requests ทั้งหมด (`Transport closed`)
  - kill subprocess
  - รอ read loop shutdown
  - ส่ง `onClose`

ถ้า read loop หยุดอย่างไม่คาดคิด `finally` จะ trigger `#handleClose()` ซึ่งดำเนินการ reject pending-request และ close callback เดียวกัน

## Timeout และ cancellation

ต่อ request:

- timeout ค่าเริ่มต้นเป็น `config.timeout ?? 30000`
- `AbortSignal` ที่เป็นตัวเลือกจาก caller
- ทั้ง abort และ timeout จะ reject pending promise และลบ map entry ออก

Cancellation เป็นแบบ local เท่านั้น: transport ไม่ส่ง cancellation notification ระดับ protocol ไปยัง server

## การจัดการ payload ที่ผิดรูปแบบ

ใน read loop:

- แต่ละบรรทัด JSONL ที่แยกวิเคราะห์จะถูกส่งไปยัง `#handleMessage` ใน `try/catch`
- exception จากการจัดการ message ที่ผิดรูปแบบ/ไม่ถูกต้องจะถูกทิ้ง (comment `Skip malformed lines`)
- loop ดำเนินต่อ ดังนั้น message ที่เสียหายหนึ่งตัวจะไม่ทำให้การเชื่อมต่อตาย

ถ้า stream parser ที่อยู่เบื้องล่าง throw จะเรียก `onError` (เมื่อยังเชื่อมต่ออยู่) จากนั้นการเชื่อมต่อจะปิด

## พฤติกรรมเมื่อ disconnect/ล้มเหลว

เมื่อ process หยุดหรือ stream ปิด:

- requests ที่อยู่ระหว่างดำเนินการทั้งหมดจะถูก reject ด้วย `Transport closed`
- ไม่มีการ restart หรือ reconnect อัตโนมัติ
- layer ที่สูงกว่าต้อง reconnect โดยสร้าง transport ใหม่

## หมายเหตุเกี่ยวกับ backpressure/streaming

- การเขียนขาออกใช้ `stdin.write()` + `flush()` โดยไม่รอ drain semantics
- ไม่มีการจัดการ queue หรือ high-watermark อย่างชัดเจนใน transport
- การประมวลผลขาเข้าขับเคลื่อนด้วย stream (`for await` ผ่าน `readJsonl`) ทีละ parsed message หนึ่งตัว

## รายละเอียดภายในของ HTTP/SSE transport

## วงจรชีวิตและ connection semantics

HTTP transport มีสถานะ connection เชิงตรรกะ แต่เส้นทาง request เป็น stateless ต่อ HTTP call:

- `connect()` ตั้ง `connected=true` (ไม่มี socket/session handshake)
- การติดตาม server session ที่เป็นตัวเลือกผ่าน `Mcp-Session-Id` header
- `close()` ส่ง `DELETE` พร้อม `Mcp-Session-Id` ที่เป็นตัวเลือก, abort SSE listener, ส่ง `onClose`

ดังนั้น `connected` หมายถึง "transport ใช้งานได้" ไม่ใช่ "มี persistent stream ที่ถูกสร้างขึ้น"

## พฤติกรรมของ session header

- เมื่อ POST response มี `Mcp-Session-Id` header, transport จะเก็บไว้
- requests/notifications ต่อไปจะรวม `Mcp-Session-Id`
- `close()` พยายามยุติ server session ด้วย HTTP DELETE; ความล้มเหลวในการยุติจะถูกข้ามไป

## Timeout และ cancellation

สำหรับทั้ง `request()` และ `notify()`:

- timeout ใช้ `AbortController` (`config.timeout ?? 30000`)
- external signal ถ้ามี จะถูกรวมผ่าน `AbortSignal.any([...])`
- การจัดการ AbortError แยกแยะระหว่าง caller abort กับ timeout

Error ที่ throw:

- timeout: `Request timeout after ...ms` (หรือ `SSE response timeout ...`, `Notify timeout ...`)
- caller abort: AbortError ดั้งเดิมจะถูก rethrow เมื่อ external signal ถูก abort ไปแล้ว

## การส่งต่อ HTTP error

เมื่อ response ไม่ใช่ OK:

- response text จะรวมอยู่ใน error ที่ throw (`HTTP <status>: <text>`)
- ถ้ามี auth hints จาก `WWW-Authenticate` และ `Mcp-Auth-Server` จะถูกเพิ่มต่อท้าย

เมื่อเป็น JSON-RPC error object:

- throw `MCP error <code>: <message>`

JSON body ที่ผิดรูปแบบ (ความล้มเหลวของ `response.json()`) จะ propagate เป็น parse exception

## พฤติกรรม SSE และโหมดต่างๆ

มี SSE path สองเส้นทาง:

1. **SSE response ต่อ request** (`#parseSSEResponse`)
   - ใช้เมื่อ content type ของ POST response เป็น `text/event-stream`
   - ใช้ stream จนกว่าจะพบ response id ที่ตรงกัน
   - สามารถประมวลผล notifications ที่แทรกอยู่ระหว่าง stream เดียวกัน

2. **Background SSE listener** (`startSSEListener()`)
   - GET listener ที่เป็นตัวเลือกสำหรับ notifications ที่เริ่มต้นจาก server
   - ปัจจุบันไม่ถูกเริ่มอัตโนมัติโดย MCP manager/client
   - ถ้า GET คืน `405` listener จะปิดการทำงานอย่างเงียบๆ (server ไม่รองรับโหมดนี้)

## การจัดการ payload ที่ผิดรูปแบบและ disconnect

SSE JSON parsing errors จะ bubble ออกจาก `readSseJson` และ reject request/listener

- SSE parse errors ของ request จะ reject request ที่กำลังทำงานอยู่
- Error ของ background listener จะ trigger `onError` (ยกเว้น AbortError)
- ไม่มี auto-reconnect สำหรับ background listener

## `json-rpc.ts` utility vs transport abstraction

`src/mcp/json-rpc.ts` ให้ helpers `callMCP()` และ `parseSSE()` สำหรับการเรียก HTTP MCP โดยตรง (ใช้โดย Exa integration) ไม่ใช่ `MCPTransport` abstraction ที่ใช้โดย `MCPClient`/`MCPManager`

ความแตกต่างที่สำคัญจาก `HttpTransport`:

- แยกวิเคราะห์ response text ทั้งหมดก่อน จากนั้นดึงบรรทัด `data:` แรก (`parseSSE`) พร้อม JSON fallback
- ไม่มีการจัดการ request timeout, ไม่มี abort API, ไม่มีการจัดการ session-id, ไม่มีวงจรชีวิต transport
- คืน raw JSON-RPC envelope object

เส้นทางนี้ lightweight แต่มีความ robust น้อยกว่า transport implementation แบบเต็ม

## ความรับผิดชอบในการ retry/reconnect

## ระดับ transport

Transport implementation ปัจจุบัน**ไม่ได้**:

- retry requests ที่ล้มเหลว
- reconnect หลัง stdio process หยุดทำงาน
- reconnect SSE listeners
- ส่ง requests ที่อยู่ระหว่างดำเนินการอีกครั้งหลัง disconnect

พวกมัน fail fast และ propagate errors

## ระดับ manager/client

`MCPManager` จัดการการ discovery/การเชื่อมต่อเริ่มต้นและสามารถ reconnect ได้โดยการรัน connect flows อีกครั้ง (เส้นทาง `connectToServer`/`discoverAndConnect`) ไม่ได้ auto-heal transport ที่เชื่อมต่อแล้วเมื่อเกิดความล้มเหลวระหว่างทำงานจาก callback

`MCPManager` มี fallback behavior สำหรับ startup กรณี server ช้า (deferred tools จาก cache) แต่นั่นเป็น tool availability fallback ไม่ใช่ transport retry

## สรุปสถานการณ์ความล้มเหลว

- **Stdio message line ที่ผิดรูปแบบ**: ถูกทิ้ง; stream ดำเนินต่อ
- **Stdio stream/process สิ้นสุด**: transport ปิด; pending requests ถูก reject เป็น `Transport closed`
- **HTTP ที่ไม่ใช่ 2xx**: request/notify throw HTTP error
- **JSON response ที่ไม่ถูกต้อง**: parse exception ถูก propagate
- **SSE สิ้นสุดโดยไม่มี id ที่ตรงกัน**: request ล้มเหลวด้วย `No response received for request ID ...`
- **Timeout**: transport-specific timeout error
- **Caller abort**: AbortError/reason ถูก propagate จาก caller signal

## กฎขอบเขตในทางปฏิบัติ

ถ้าความกังวลเป็นเรื่องรูปแบบ message, การจับคู่ id, หรือลำดับ MCP method จะอยู่ใน protocol/client logic

ถ้าความกังวลเป็นเรื่อง framing (JSONL vs HTTP/SSE), การแยกวิเคราะห์ stream, วงจรชีวิต fetch/spawn, timeout clocks, หรือการ teardown connection จะอยู่ใน transport implementation
