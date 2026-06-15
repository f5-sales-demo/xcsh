---
title: โปรโตคอล MCP และกลไกการขนส่งภายใน
description: 'การใช้งานโปรโตคอล MCP พร้อมเลเยอร์การขนส่ง stdio, SSE และ streamable HTTP'
sidebar:
  order: 2
  label: โปรโตคอลและการขนส่ง
i18n:
  sourceHash: 48632064dd00
  translator: machine
---

# โปรโตคอล MCP และกลไกการขนส่งภายใน

เอกสารนี้อธิบายวิธีที่ coding-agent ใช้งานการส่งข้อความ MCP JSON-RPC และวิธีแยกความรับผิดชอบของโปรโตคอลออกจากการขนส่ง

## ขอบเขต

ครอบคลุม:

- การไหลของคำขอ/การตอบสนองและการแจ้งเตือนแบบ JSON-RPC
- การเชื่อมโยงคำขอและวงจรชีวิตสำหรับการขนส่ง stdio และ HTTP/SSE
- พฤติกรรมหมดเวลาและการยกเลิก
- การแพร่กระจายข้อผิดพลาดและการจัดการ payload ที่ผิดรูปแบบ
- ขอบเขตการเลือกการขนส่ง (`stdio` เทียบกับ `http`/`sse`)
- ความรับผิดชอบด้านการเชื่อมต่อใหม่/ลองใหม่ที่เป็นระดับการขนส่งเทียบกับระดับ manager

ไม่ครอบคลุม UX การเขียนส่วนขยายหรือ UI คำสั่ง

## ไฟล์การใช้งาน

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/transports/stdio.ts`](../../packages/coding-agent/src/mcp/transports/stdio.ts)
- [`src/mcp/transports/http.ts`](../../packages/coding-agent/src/mcp/transports/http.ts)
- [`src/mcp/transports/index.ts`](../../packages/coding-agent/src/mcp/transports/index.ts)
- [`src/mcp/json-rpc.ts`](../../packages/coding-agent/src/mcp/json-rpc.ts)
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)

## ขอบเขตเลเยอร์

### เลเยอร์โปรโตคอล (JSON-RPC + เมธอด MCP)

- รูปแบบข้อความถูกกำหนดไว้ใน `types.ts` (`JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcResponse`, `JsonRpcMessage`)
- ลอจิก MCP client (`client.ts`) กำหนดลำดับเมธอดและ session handshake:
  1. คำขอ `initialize`
  2. การแจ้งเตือน `notifications/initialized`
  3. การเรียกเมธอดเช่น `tools/list`, `tools/call`

### เลเยอร์การขนส่ง (`MCPTransport`)

`MCPTransport` สร้างนามธรรมสำหรับการส่งมอบและวงจรชีวิต:

- `request(method, params, options?) -> Promise<T>`
- `notify(method, params?) -> Promise<void>`
- `close()`
- `connected`
- callbacks ที่เป็นทางเลือก: `onClose`, `onError`, `onNotification`

การใช้งานการขนส่งเป็นเจ้าของรายละเอียด framing และ I/O:

- `StdioTransport`: JSON ที่คั่นด้วยขึ้นบรรทัดใหม่ผ่าน stdio ของ subprocess
- `HttpTransport`: JSON-RPC ผ่าน HTTP POST พร้อมการตอบสนอง/การรับฟัง SSE ที่เป็นทางเลือก

### ข้อสังเกตสำคัญในปัจจุบัน

Transport callbacks (`onClose`, `onError`, `onNotification`) ถูกใช้งานแล้ว แต่กระบวนการ `MCPClient`/`MCPManager` ในปัจจุบันไม่ได้เชื่อมต่อลอจิกการเชื่อมต่อใหม่กับ callbacks เหล่านี้ การแจ้งเตือนจะถูกใช้งานก็ต่อเมื่อผู้เรียกลงทะเบียน handlers เท่านั้น

## การเลือกการขนส่ง

`client.ts:createTransport()` เลือกการขนส่งจากการกำหนดค่า:

- ละเว้น `type` หรือ `"stdio"` -> `createStdioTransport`
- `"http"` หรือ `"sse"` -> `createHttpTransport`

`"sse"` ถูกมองว่าเป็นตัวแปรของการขนส่ง HTTP (class เดียวกัน) ไม่ใช่การใช้งานการขนส่งแยกต่างหาก

## การไหลของข้อความ JSON-RPC และการเชื่อมโยง

## Request IDs

การขนส่งแต่ละอย่างสร้าง ID ต่อคำขอ (สตริง `Math.random` + timestamp) ID เป็น correlation token ในระดับการขนส่ง

## เส้นทางการเชื่อมโยง Stdio

- คำขอขาออกถูก serialize เป็น JSON object หนึ่งชิ้น + `\n`
- `#pendingRequests: Map<id, {resolve,reject}>` เก็บคำขอที่อยู่ระหว่างดำเนินการ
- read loop แยกวิเคราะห์ JSONL จาก stdout และเรียก `#handleMessage`
- หากข้อความขาเข้ามี `id` ที่ตรงกัน คำขอจะ resolve/reject
- หากข้อความขาเข้ามี `method` และไม่มี `id` จะถูกมองว่าเป็นการแจ้งเตือนและส่งไปยัง `onNotification`

ID ที่ไม่รู้จักจะถูกละเว้น (ไม่มีการ rejection ไม่มี error callback)

## เส้นทางการเชื่อมโยง HTTP

- คำขอขาออกเป็น HTTP `POST` พร้อม JSON body และ `id` ที่สร้างขึ้น
- เส้นทางการตอบสนองแบบไม่ใช่ SSE: แยกวิเคราะห์การตอบสนอง JSON-RPC หนึ่งรายการและคืนค่า `result`/throw เมื่อเกิด `error`
- เส้นทางการตอบสนอง SSE (`Content-Type: text/event-stream`): stream events คืนค่าข้อความแรกที่มี `id` ตรงกับ request ID ที่คาดหวังและมี `result` หรือ `error`
- ข้อความ SSE ที่มี `method` และไม่มี `id` ถูกมองว่าเป็นการแจ้งเตือน

หาก SSE stream สิ้นสุดก่อนที่จะได้รับการตอบสนองที่ตรงกัน คำขอจะล้มเหลวด้วย `No response received for request ID ...`

## การแจ้งเตือน

Client ส่งการแจ้งเตือน JSON-RPC ผ่าน `transport.notify(...)`

- Stdio: เขียน notification frame ไปยัง stdin (`jsonrpc`, `method`, `params` ที่เป็นทางเลือก) บวกขึ้นบรรทัดใหม่
- HTTP: ส่ง POST body โดยไม่มี `id`; ความสำเร็จยอมรับ `2xx` หรือ `202 Accepted`

การแจ้งเตือนที่เริ่มต้นโดยเซิร์ฟเวอร์จะแสดงผลเฉพาะผ่าน `onNotification` ของการขนส่งเท่านั้น ไม่มี global subscriber เริ่มต้นใน manager/client

## กลไกภายในของ Stdio Transport

## วงจรชีวิตและการเปลี่ยนสถานะ

- เริ่มต้น: `connected=false`, `process=null`, pending map ว่างเปล่า
- `connect()`:
  - spawn subprocess ด้วย command/args/env/cwd ที่กำหนดค่าไว้
  - ทำเครื่องหมายว่าเชื่อมต่อแล้ว
  - เริ่ม stdout read loop (`readJsonl`)
  - เริ่ม stderr loop (อ่าน/ทิ้ง; ปัจจุบันเงียบ)
- `close()`:
  - ทำเครื่องหมายว่าตัดการเชื่อมต่อ
  - reject คำขอที่รอดำเนินการทั้งหมด (`Transport closed`)
  - kill subprocess
  - รอการปิด read loop
  - emit `onClose`

หาก read loop ออกโดยไม่คาดคิด `finally` จะทริกเกอร์ `#handleClose()` ซึ่งทำการ rejection ของคำขอที่รอดำเนินการและ close callback เหมือนกัน

## การหมดเวลาและการยกเลิก

ต่อคำขอ:

- timeout ค่าเริ่มต้นคือ `config.timeout ?? 30000`
- `AbortSignal` ที่เป็นทางเลือกจากผู้เรียก
- การยกเลิกและ timeout ทั้งคู่จะ reject promise ที่รอดำเนินการและล้าง map entry

การยกเลิกเป็นแบบ local เท่านั้น: การขนส่งไม่ส่งการแจ้งเตือนการยกเลิกระดับโปรโตคอลไปยังเซิร์ฟเวอร์

## การจัดการ Payload ที่ผิดรูปแบบ

ใน read loop:

- แต่ละบรรทัด JSONL ที่แยกวิเคราะห์แล้วถูกส่งไปยัง `#handleMessage` ใน `try/catch`
- ข้อยกเว้นการจัดการข้อความที่ผิดรูปแบบ/ไม่ถูกต้องจะถูกทิ้ง (comment `Skip malformed lines`)
- loop ดำเนินต่อ ดังนั้นข้อความเสียหายหนึ่งรายการจะไม่ทำให้การเชื่อมต่อล้มเหลว

หาก stream parser พื้นฐาน throw `onError` จะถูกเรียก (เมื่อยังเชื่อมต่ออยู่) จากนั้นการเชื่อมต่อจะปิด

## พฤติกรรมการตัดการเชื่อมต่อ/ความล้มเหลว

เมื่อ process ออกหรือ stream ปิด:

- คำขอที่อยู่ระหว่างดำเนินการทั้งหมดจะถูก reject ด้วย `Transport closed`
- ไม่มีการรีสตาร์ทหรือเชื่อมต่อใหม่อัตโนมัติ
- เลเยอร์ที่สูงกว่าต้องเชื่อมต่อใหม่โดยสร้างการขนส่งใหม่

## หมายเหตุเกี่ยวกับ Backpressure/Streaming

- การเขียนขาออกใช้ `stdin.write()` + `flush()` โดยไม่รอ drain semantics
- ไม่มีการจัดการ queue หรือ high-watermark อย่างชัดเจนในการขนส่ง
- การประมวลผลขาเข้าขับเคลื่อนด้วย stream (`for await` ผ่าน `readJsonl`) ทีละข้อความที่แยกวิเคราะห์แล้ว

## กลไกภายในของ HTTP/SSE Transport

## วงจรชีวิตและ Connection Semantics

HTTP transport มีสถานะการเชื่อมต่อเชิงตรรกะ แต่เส้นทางคำขอเป็น stateless ต่อการเรียก HTTP:

- `connect()` ตั้งค่า `connected=true` (ไม่มี socket/session handshake)
- การติดตาม session ของเซิร์ฟเวอร์ที่เป็นทางเลือกผ่าน header `Mcp-Session-Id`
- `close()` ส่ง `DELETE` พร้อม `Mcp-Session-Id` ที่เป็นทางเลือก, ยกเลิก SSE listener, emit `onClose`

ดังนั้น `connected` หมายความว่า "การขนส่งใช้งานได้" ไม่ใช่ "สร้าง persistent stream แล้ว"

## พฤติกรรม Session Header

- เมื่อตอบสนอง POST หากมี header `Mcp-Session-Id` การขนส่งจะเก็บไว้
- คำขอ/การแจ้งเตือนต่อๆ ไปจะรวม `Mcp-Session-Id`
- `close()` พยายามยุติ session ของเซิร์ฟเวอร์ด้วย HTTP DELETE; ความล้มเหลวในการยุติจะถูกละเว้น

## การหมดเวลาและการยกเลิก

สำหรับทั้ง `request()` และ `notify()`:

- timeout ใช้ `AbortController` (`config.timeout ?? 30000`)
- signal ภายนอก หากมีให้ จะถูกรวมผ่าน `AbortSignal.any([...])`
- การจัดการ AbortError แยกแยะการยกเลิกของผู้เรียกเทียบกับ timeout

ข้อผิดพลาดที่ throw:

- timeout: `Request timeout after ...ms` (หรือ `SSE response timeout ...`, `Notify timeout ...`)
- การยกเลิกของผู้เรียก: AbortError/reason ดั้งเดิมถูก rethrow เมื่อ signal ภายนอกถูกยกเลิกแล้ว

## การแพร่กระจายข้อผิดพลาด HTTP

เมื่อการตอบสนองไม่ OK:

- ข้อความการตอบสนองถูกรวมในข้อผิดพลาดที่ throw (`HTTP <status>: <text>`)
- หากมี hints การยืนยันตัวตนจาก `WWW-Authenticate` และ `Mcp-Auth-Server` จะถูกเพิ่มต่อท้าย

เมื่อเกิด JSON-RPC error object:

- throw `MCP error <code>: <message>`

ความล้มเหลวของ JSON body ที่ผิดรูปแบบ (ความล้มเหลวของ `response.json()`) จะแพร่กระจายเป็น parse exception

## พฤติกรรม SSE และโหมด

มีเส้นทาง SSE สองเส้นทาง:

1. **การตอบสนอง SSE ต่อคำขอ** (`#parseSSEResponse`)
   - ใช้เมื่อประเภทเนื้อหาการตอบสนอง POST คือ `text/event-stream`
   - ใช้ stream จนกว่าจะพบ response id ที่ตรงกัน
   - สามารถประมวลผลการแจ้งเตือนที่คั่นระหว่างกันในระหว่าง stream เดียวกัน

2. **Background SSE listener** (`startSSEListener()`)
   - GET listener ที่เป็นทางเลือกสำหรับการแจ้งเตือนที่เริ่มต้นโดยเซิร์ฟเวอร์
   - ปัจจุบันไม่ได้เริ่มต้นโดยอัตโนมัติโดย MCP manager/client
   - หาก GET คืนค่า `405` listener จะปิดการใช้งานตัวเองโดยไม่แจ้ง (เซิร์ฟเวอร์ไม่รองรับโหมดนี้)

## การจัดการ Payload ที่ผิดรูปแบบและการตัดการเชื่อมต่อ

ข้อผิดพลาดการแยกวิเคราะห์ JSON ของ SSE จะผุดขึ้นจาก `readSseJson` และ reject คำขอ/listener

- ข้อผิดพลาด SSE parse ของคำขอ reject คำขอที่ใช้งานอยู่
- ข้อผิดพลาด background listener ทริกเกอร์ `onError` (ยกเว้น AbortError)
- ไม่มีการเชื่อมต่อใหม่อัตโนมัติสำหรับ background listener

## ยูทิลิตี้ `json-rpc.ts` เทียบกับนามธรรมการขนส่ง

`src/mcp/json-rpc.ts` จัดเตรียม helpers `callMCP()` และ `parseSSE()` สำหรับการเรียก HTTP MCP โดยตรง (ใช้โดยการผสาน Exa) ไม่ใช่นามธรรม `MCPTransport` ที่ใช้โดย `MCPClient`/`MCPManager`

ความแตกต่างที่น่าสังเกตจาก `HttpTransport`:

- แยกวิเคราะห์ข้อความการตอบสนองทั้งหมดก่อน จากนั้นดึงบรรทัด `data:` แรก (`parseSSE`) พร้อม JSON fallback
- ไม่มีการจัดการ request timeout ไม่มี abort API ไม่มีการจัดการ session-id ไม่มีวงจรชีวิตการขนส่ง
- คืนค่า JSON-RPC envelope object ดิบ

เส้นทางนี้มีน้ำหนักเบาแต่มีความแข็งแกร่งน้อยกว่าการใช้งานการขนส่งแบบเต็มรูปแบบ

## ความรับผิดชอบในการลองใหม่/เชื่อมต่อใหม่

## ระดับการขนส่ง

การใช้งานการขนส่งในปัจจุบัน **ไม่**:

- ลองคำขอที่ล้มเหลวใหม่
- เชื่อมต่อใหม่หลังจาก stdio process ออก
- เชื่อมต่อ SSE listeners ใหม่
- ส่งคำขอที่อยู่ระหว่างดำเนินการใหม่หลังการตัดการเชื่อมต่อ

พวกมันล้มเหลวอย่างรวดเร็วและแพร่กระจายข้อผิดพลาด

## ระดับ Manager/Client

`MCPManager` จัดการการค้นพบ/การประสานการเชื่อมต่อเริ่มต้นและสามารถเชื่อมต่อใหม่ได้โดยการเรียกใช้กระบวนการเชื่อมต่ออีกครั้ง (เส้นทาง `connectToServer`/`discoverAndConnect`) ไม่มีการ auto-heal การขนส่งที่เชื่อมต่ออยู่แล้วเมื่อเกิดความล้มเหลวของ runtime callbacks

`MCPManager` มีพฤติกรรม startup fallback สำหรับเซิร์ฟเวอร์ที่ช้า (deferred tools จาก cache) แต่นั่นเป็น tool availability fallback ไม่ใช่การลองใหม่ของการขนส่ง

## สรุปสถานการณ์ความล้มเหลว

- **บรรทัดข้อความ stdio ที่ผิดรูปแบบ**: ถูกทิ้ง; stream ดำเนินต่อ
- **Stdio stream/process สิ้นสุด**: การขนส่งปิด; คำขอที่รอดำเนินการถูก reject เป็น `Transport closed`
- **HTTP non-2xx**: คำขอ/การแจ้งเตือน throw HTTP error
- **การตอบสนอง JSON ที่ไม่ถูกต้อง**: parse exception แพร่กระจาย
- **SSE สิ้นสุดโดยไม่มี id ที่ตรงกัน**: คำขอล้มเหลวด้วย `No response received for request ID ...`
- **Timeout**: ข้อผิดพลาด timeout เฉพาะการขนส่ง
- **การยกเลิกของผู้เรียก**: AbortError/reason แพร่กระจายจาก signal ของผู้เรียก

## กฎขอบเขตเชิงปฏิบัติ

หากความกังวลคือรูปแบบข้อความ การเชื่อมโยง id หรือลำดับเมธอด MCP ก็เป็นของลอจิก protocol/client

หากความกังวลคือ framing (JSONL เทียบกับ HTTP/SSE) การแยกวิเคราะห์ stream วงจรชีวิต fetch/spawn นาฬิกา timeout หรือการยุติการเชื่อมต่อ ก็เป็นของการใช้งานการขนส่ง
