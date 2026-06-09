---
title: MCP Protocol และ Transport ภายใน
description: 'การใช้งาน MCP protocol พร้อม stdio, SSE และ streamable HTTP transport layers'
sidebar:
  order: 2
  label: Protocol และ transports
i18n:
  sourceHash: 48632064dd00
  translator: machine
---

# MCP Protocol และ Transport ภายใน

เอกสารนี้อธิบายวิธีที่ coding-agent ใช้งาน MCP JSON-RPC messaging และวิธีแยกข้อกังวลด้าน protocol ออกจากข้อกังวลด้าน transport

## ขอบเขต

ครอบคลุม:

- ขั้นตอนของ JSON-RPC request/response และ notification
- การเชื่อมโยง request และวงจรชีวิตสำหรับ stdio และ HTTP/SSE transports
- พฤติกรรม timeout และ cancellation
- การส่งต่อข้อผิดพลาดและการจัดการ payload ที่ผิดรูปแบบ
- ขอบเขตการเลือก transport (`stdio` vs `http`/`sse`)
- ความรับผิดชอบด้าน reconnect/retry ที่อยู่ในระดับ transport เทียบกับระดับ manager

ไม่ครอบคลุม UX การเขียน extension หรือ command UI

## ไฟล์การใช้งาน

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/transports/stdio.ts`](../../packages/coding-agent/src/mcp/transports/stdio.ts)
- [`src/mcp/transports/http.ts`](../../packages/coding-agent/src/mcp/transports/http.ts)
- [`src/mcp/transports/index.ts`](../../packages/coding-agent/src/mcp/transports/index.ts)
- [`src/mcp/json-rpc.ts`](../../packages/coding-agent/src/mcp/json-rpc.ts)
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)

## ขอบเขตของเลเยอร์

### เลเยอร์ Protocol (JSON-RPC + MCP methods)

- รูปแบบข้อความถูกกำหนดใน `types.ts` (`JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcResponse`, `JsonRpcMessage`)
- ลอจิกของ MCP client (`client.ts`) กำหนดลำดับ method และ session handshake:
  1. `initialize` request
  2. `notifications/initialized` notification
  3. การเรียก method เช่น `tools/list`, `tools/call`

### เลเยอร์ Transport (`MCPTransport`)

`MCPTransport` ทำหน้าที่แยกส่วนการส่งข้อมูลและวงจรชีวิต:

- `request(method, params, options?) -> Promise<T>`
- `notify(method, params?) -> Promise<void>`
- `close()`
- `connected`
- callbacks ที่เป็นทางเลือก: `onClose`, `onError`, `onNotification`

การใช้งาน transport เป็นเจ้าของรายละเอียดด้าน framing และ I/O:

- `StdioTransport`: JSON แบบคั่นด้วยบรรทัดใหม่ผ่าน subprocess stdio
- `HttpTransport`: JSON-RPC ผ่าน HTTP POST พร้อม SSE responses/listening ที่เป็นทางเลือก

### ข้อควรระวังสำคัญในปัจจุบัน

Transport callbacks (`onClose`, `onError`, `onNotification`) ถูกใช้งานแล้ว แต่ขั้นตอนปัจจุบันของ `MCPClient`/`MCPManager` ไม่ได้เชื่อมต่อลอจิกการ reconnect กับ callbacks เหล่านี้ Notifications จะถูกใช้งานก็ต่อเมื่อผู้เรียกลงทะเบียน handlers

## การเลือก Transport

`client.ts:createTransport()` เลือก transport จาก config:

- `type` ไม่ระบุหรือ `"stdio"` -> `createStdioTransport`
- `"http"` หรือ `"sse"` -> `createHttpTransport`

`"sse"` ถูกถือว่าเป็น HTTP transport แบบย่อย (class เดียวกัน) ไม่ใช่การใช้งาน transport แยกต่างหาก

## ขั้นตอนข้อความ JSON-RPC และการเชื่อมโยง

## Request IDs

แต่ละ transport สร้าง ID ต่อ request (`Math.random` + timestamp string) IDs เป็น correlation tokens เฉพาะ transport

## เส้นทางการเชื่อมโยงของ Stdio

- Request ขาออกถูก serialize เป็น JSON object หนึ่งตัว + `\n`
- `#pendingRequests: Map<id, {resolve,reject}>` เก็บ requests ที่อยู่ระหว่างดำเนินการ
- Read loop แปลง JSONL จาก stdout และเรียก `#handleMessage`
- ถ้าข้อความขาเข้ามี `id` ที่ตรงกัน request จะ resolve/reject
- ถ้าข้อความขาเข้ามี `method` และไม่มี `id` จะถูกถือว่าเป็น notification และส่งไปที่ `onNotification`

IDs ที่ไม่รู้จักจะถูกละเว้น (ไม่มี rejection, ไม่มี error callback)

## เส้นทางการเชื่อมโยงของ HTTP

- Request ขาออกคือ HTTP `POST` พร้อม JSON body และ `id` ที่สร้างขึ้น
- เส้นทาง response แบบไม่ใช่ SSE: แปลง JSON-RPC response หนึ่งตัวและส่งคืน `result`/throw เมื่อเป็น `error`
- เส้นทาง response แบบ SSE (`Content-Type: text/event-stream`): stream events, ส่งคืนข้อความแรกที่มี `id` ตรงกับ request ID ที่คาดหวังและมี `result` หรือ `error`
- ข้อความ SSE ที่มี `method` และไม่มี `id` จะถูกถือว่าเป็น notifications

ถ้า SSE stream จบลงก่อนที่จะได้ response ที่ตรงกัน request จะล้มเหลวด้วย `No response received for request ID ...`

## Notifications

Client ส่ง JSON-RPC notifications ผ่าน `transport.notify(...)`

- Stdio: เขียน notification frame ไปที่ stdin (`jsonrpc`, `method`, `params` ที่เป็นทางเลือก) พร้อมบรรทัดใหม่
- HTTP: ส่ง POST body โดยไม่มี `id`; สำเร็จเมื่อยอมรับ `2xx` หรือ `202 Accepted`

Notifications ที่เริ่มต้นจาก server จะแสดงผลผ่าน transport `onNotification` เท่านั้น; ไม่มี global subscriber เริ่มต้นใน manager/client

## รายละเอียดภายในของ Stdio transport

## วงจรชีวิตและการเปลี่ยนสถานะ

- สถานะเริ่มต้น: `connected=false`, `process=null`, pending map ว่างเปล่า
- `connect()`:
  - spawn subprocess ด้วย command/args/env/cwd ที่กำหนดค่าไว้
  - ทำเครื่องหมายว่าเชื่อมต่อแล้ว
  - เริ่ม stdout read loop (`readJsonl`)
  - เริ่ม stderr loop (อ่าน/ทิ้ง; ปัจจุบันเงียบ)
- `close()`:
  - ทำเครื่องหมายว่าตัดการเชื่อมต่อแล้ว
  - reject pending requests ทั้งหมด (`Transport closed`)
  - kill subprocess
  - รอ read loop shutdown
  - เรียก `onClose`

ถ้า read loop ออกโดยไม่คาดคิด `finally` จะทริกเกอร์ `#handleClose()` ซึ่งทำการ reject pending-request และ close callback เช่นเดียวกัน

## Timeout และ cancellation

ต่อ request:

- timeout เริ่มต้นที่ `config.timeout ?? 30000`
- `AbortSignal` ที่เป็นทางเลือกจากผู้เรียก
- ทั้ง abort และ timeout จะ reject pending promise และล้าง map entry

Cancellation เป็นแบบ local เท่านั้น: transport ไม่ส่ง cancellation notification ระดับ protocol ไปยัง server

## การจัดการ payload ที่ผิดรูปแบบ

ใน read loop:

- แต่ละบรรทัด JSONL ที่แปลงแล้วถูกส่งไปยัง `#handleMessage` ใน `try/catch`
- exceptions จากการจัดการข้อความที่ผิดรูปแบบ/ไม่ถูกต้องจะถูกทิ้ง (comment `Skip malformed lines`)
- loop ทำงานต่อ ดังนั้นข้อความที่ผิดพลาดหนึ่งข้อความไม่ทำให้การเชื่อมต่อตาย

ถ้า stream parser ที่อยู่เบื้องล่าง throw ข้อผิดพลาด `onError` จะถูกเรียก (เมื่อยังเชื่อมต่ออยู่) จากนั้นการเชื่อมต่อจะปิด

## พฤติกรรมเมื่อตัดการเชื่อมต่อ/ล้มเหลว

เมื่อ process ออกหรือ stream ปิด:

- requests ที่อยู่ระหว่างดำเนินการทั้งหมดจะถูก reject ด้วย `Transport closed`
- ไม่มีการ restart หรือ reconnect อัตโนมัติ
- เลเยอร์ที่สูงกว่าต้อง reconnect โดยสร้าง transport ใหม่

## หมายเหตุเรื่อง backpressure/streaming

- การเขียนขาออกใช้ `stdin.write()` + `flush()` โดยไม่รอ drain semantics
- ไม่มีการจัดการ queue หรือ high-watermark อย่างชัดเจนใน transport
- การประมวลผลขาเข้าเป็นแบบ stream-driven (`for await` ผ่าน `readJsonl`) ประมวลผลข้อความที่แปลงแล้วทีละหนึ่ง

## รายละเอียดภายในของ HTTP/SSE transport

## วงจรชีวิตและความหมายของการเชื่อมต่อ

HTTP transport มีสถานะการเชื่อมต่อเชิงตรรกะ แต่เส้นทาง request เป็น stateless ต่อ HTTP call:

- `connect()` ตั้ง `connected=true` (ไม่มี socket/session handshake)
- การติดตาม server session ที่เป็นทางเลือกผ่าน `Mcp-Session-Id` header
- `close()` ส่ง `DELETE` พร้อม `Mcp-Session-Id` ที่เป็นทางเลือก, ยกเลิก SSE listener, เรียก `onClose`

ดังนั้น `connected` หมายถึง "transport พร้อมใช้งาน" ไม่ใช่ "สร้าง persistent stream แล้ว"

## พฤติกรรมของ session header

- เมื่อได้รับ POST response ถ้ามี `Mcp-Session-Id` header transport จะเก็บค่าไว้
- requests/notifications ที่ตามมาจะรวม `Mcp-Session-Id`
- `close()` พยายามยุติ server session ด้วย HTTP DELETE; ความล้มเหลวในการยุติจะถูกละเว้น

## Timeout และ cancellation

สำหรับทั้ง `request()` และ `notify()`:

- timeout ใช้ `AbortController` (`config.timeout ?? 30000`)
- signal ภายนอก หากมี จะถูกรวมผ่าน `AbortSignal.any([...])`
- การจัดการ AbortError แยกแยะระหว่าง caller abort กับ timeout

ข้อผิดพลาดที่ throw:

- timeout: `Request timeout after ...ms` (หรือ `SSE response timeout ...`, `Notify timeout ...`)
- caller abort: AbortError ดั้งเดิมจะถูก rethrow เมื่อ external signal ถูก abort อยู่แล้ว

## การส่งต่อข้อผิดพลาด HTTP

เมื่อ response ไม่ใช่ OK:

- response text จะถูกรวมในข้อผิดพลาดที่ throw (`HTTP <status>: <text>`)
- ถ้ามี auth hints จาก `WWW-Authenticate` และ `Mcp-Auth-Server` จะถูกต่อท้าย

เมื่อเป็น JSON-RPC error object:

- throw `MCP error <code>: <message>`

JSON body ที่ผิดรูปแบบ (ความล้มเหลวของ `response.json()`) จะถูกส่งต่อเป็น parse exception

## พฤติกรรมและโหมดของ SSE

มีสองเส้นทาง SSE:

1. **SSE response ต่อ request** (`#parseSSEResponse`)
   - ใช้เมื่อ content type ของ POST response เป็น `text/event-stream`
   - ใช้ stream จนกว่าจะพบ response id ที่ตรงกัน
   - สามารถประมวลผล notifications ที่แทรกระหว่างกันใน stream เดียวกัน

2. **Background SSE listener** (`startSSEListener()`)
   - GET listener ที่เป็นทางเลือกสำหรับ notifications ที่เริ่มต้นจาก server
   - ปัจจุบันไม่ได้ถูกเริ่มต้นอัตโนมัติโดย MCP manager/client
   - ถ้า GET ส่งคืน `405` listener จะปิดตัวเองอย่างเงียบ ๆ (server ไม่รองรับโหมดนี้)

## การจัดการ payload ที่ผิดรูปแบบและการตัดการเชื่อมต่อ

ข้อผิดพลาดการแปลง JSON ของ SSE จะ bubble ออกจาก `readSseJson` และ reject request/listener

- ข้อผิดพลาดการแปลง SSE ของ request จะ reject request ที่ active อยู่
- ข้อผิดพลาดของ background listener จะทริกเกอร์ `onError` (ยกเว้น AbortError)
- ไม่มี auto-reconnect สำหรับ background listener

## `json-rpc.ts` utility เทียบกับ transport abstraction

`src/mcp/json-rpc.ts` มี `callMCP()` และ `parseSSE()` helpers สำหรับการเรียก HTTP MCP โดยตรง (ใช้โดย Exa integration) ไม่ใช่ `MCPTransport` abstraction ที่ใช้โดย `MCPClient`/`MCPManager`

ความแตกต่างที่สำคัญจาก `HttpTransport`:

- แปลง response text ทั้งหมดก่อน จากนั้นดึงบรรทัด `data:` แรก (`parseSSE`) พร้อม JSON fallback
- ไม่มีการจัดการ request timeout ไม่มี abort API ไม่มีการจัดการ session-id ไม่มีวงจรชีวิต transport
- ส่งคืน JSON-RPC envelope object ดิบ

เส้นทางนี้เบาแต่มีความแข็งแกร่งน้อยกว่าการใช้งาน transport แบบเต็ม

## ความรับผิดชอบด้าน Retry/reconnect

## ระดับ Transport

การใช้งาน transport ปัจจุบัน **ไม่ได้**:

- retry requests ที่ล้มเหลว
- reconnect หลังจาก stdio process ออก
- reconnect SSE listeners
- ส่ง requests ที่อยู่ระหว่างดำเนินการซ้ำหลังจากตัดการเชื่อมต่อ

พวกมันล้มเหลวอย่างรวดเร็วและส่งต่อข้อผิดพลาด

## ระดับ Manager/client

`MCPManager` จัดการการค้นหา/การเชื่อมต่อเริ่มต้นและสามารถ reconnect ได้เฉพาะโดยรันขั้นตอนการเชื่อมต่อใหม่ (เส้นทาง `connectToServer`/`discoverAndConnect`) ไม่ได้ซ่อมแซม transport ที่เชื่อมต่ออยู่แล้วอัตโนมัติเมื่อเกิดความล้มเหลวขณะทำงานผ่าน callbacks

`MCPManager` มีพฤติกรรม fallback ตอนเริ่มต้นสำหรับ servers ที่ช้า (deferred tools จาก cache) แต่นั่นเป็น tool availability fallback ไม่ใช่ transport retry

## สรุปสถานการณ์ความล้มเหลว

- **บรรทัดข้อความ stdio ที่ผิดรูปแบบ**: ถูกทิ้ง; stream ทำงานต่อ
- **Stdio stream/process จบ**: transport ปิด; pending requests ถูก reject เป็น `Transport closed`
- **HTTP ที่ไม่ใช่ 2xx**: request/notify throw ข้อผิดพลาด HTTP
- **JSON response ที่ไม่ถูกต้อง**: parse exception ถูกส่งต่อ
- **SSE จบโดยไม่มี id ที่ตรงกัน**: request ล้มเหลวด้วย `No response received for request ID ...`
- **Timeout**: ข้อผิดพลาด timeout เฉพาะ transport
- **Caller abort**: AbortError/reason ถูกส่งต่อจาก caller signal

## กฎขอบเขตในทางปฏิบัติ

ถ้าข้อกังวลเกี่ยวกับรูปแบบข้อความ การเชื่อมโยง id หรือลำดับ MCP method จะอยู่ในลอจิกของ protocol/client

ถ้าข้อกังวลเกี่ยวกับ framing (JSONL vs HTTP/SSE) การแปลง stream วงจรชีวิตของ fetch/spawn นาฬิกา timeout หรือการปิดการเชื่อมต่อ จะอยู่ในการใช้งาน transport
