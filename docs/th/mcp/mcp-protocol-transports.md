---
title: ภายในโปรโตคอล MCP และการขนส่ง
description: 'การติดตั้งใช้งานโปรโตคอล MCP พร้อมชั้นการขนส่ง stdio, SSE และ streamable HTTP'
sidebar:
  order: 2
  label: โปรโตคอลและการขนส่ง
i18n:
  sourceHash: 48632064dd00
  translator: machine
---

# ภายในโปรโตคอล MCP และการขนส่ง

เอกสารนี้อธิบายวิธีที่ coding-agent ติดตั้งใช้งานการส่งข้อความ MCP JSON-RPC และวิธีแยกข้อกังวลด้านโปรโตคอลออกจากข้อกังวลด้านการขนส่ง

## ขอบเขต

ครอบคลุม:

- การไหลของคำขอ/การตอบสนอง JSON-RPC และการแจ้งเตือน
- การเชื่อมโยงคำขอและวงจรชีวิตสำหรับการขนส่ง stdio และ HTTP/SSE
- พฤติกรรมการหมดเวลาและการยกเลิก
- การแพร่กระจายข้อผิดพลาดและการจัดการ payload ที่มีรูปแบบผิดพลาด
- ขอบเขตการเลือกการขนส่ง (`stdio` เทียบกับ `http`/`sse`)
- ความรับผิดชอบด้านการเชื่อมต่อใหม่/ลองใหม่ที่เป็นระดับการขนส่ง เทียบกับระดับ manager

ไม่ครอบคลุม UX การสร้างส่วนขยายหรือ UI คำสั่ง

## ไฟล์การติดตั้งใช้งาน

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/transports/stdio.ts`](../../packages/coding-agent/src/mcp/transports/stdio.ts)
- [`src/mcp/transports/http.ts`](../../packages/coding-agent/src/mcp/transports/http.ts)
- [`src/mcp/transports/index.ts`](../../packages/coding-agent/src/mcp/transports/index.ts)
- [`src/mcp/json-rpc.ts`](../../packages/coding-agent/src/mcp/json-rpc.ts)
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)

## ขอบเขตชั้น

### ชั้นโปรโตคอล (JSON-RPC + เมธอด MCP)

- รูปร่างข้อความถูกกำหนดไว้ใน `types.ts` (`JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcResponse`, `JsonRpcMessage`)
- ลอจิก MCP client (`client.ts`) กำหนดลำดับเมธอดและการจับมือ session:
  1. คำขอ `initialize`
  2. การแจ้งเตือน `notifications/initialized`
  3. การเรียกเมธอดเช่น `tools/list`, `tools/call`

### ชั้นการขนส่ง (`MCPTransport`)

`MCPTransport` ทำหน้าที่เป็นนามธรรมสำหรับการส่งมอบและวงจรชีวิต:

- `request(method, params, options?) -> Promise<T>`
- `notify(method, params?) -> Promise<void>`
- `close()`
- `connected`
- callbacks ที่เป็นตัวเลือก: `onClose`, `onError`, `onNotification`

การติดตั้งใช้งานการขนส่งเป็นเจ้าของรายละเอียดการจัดเฟรมและ I/O:

- `StdioTransport`: JSON คั่นด้วยขึ้นบรรทัดใหม่ผ่าน subprocess stdio
- `HttpTransport`: JSON-RPC ผ่าน HTTP POST พร้อมการตอบสนอง/การฟัง SSE ที่เป็นตัวเลือก

### ข้อควรระวังสำคัญในปัจจุบัน

Transport callbacks (`onClose`, `onError`, `onNotification`) ถูกติดตั้งใช้งานแล้ว แต่กระแสงาน `MCPClient`/`MCPManager` ในปัจจุบันไม่ได้เชื่อมต่อลอจิกการเชื่อมต่อใหม่กับ callbacks เหล่านี้ การแจ้งเตือนจะถูกใช้งานก็ต่อเมื่อผู้เรียกลงทะเบียน handlers เท่านั้น

## การเลือกการขนส่ง

`client.ts:createTransport()` เลือกการขนส่งจาก config:

- `type` ถูกละไว้หรือ `"stdio"` -> `createStdioTransport`
- `"http"` หรือ `"sse"` -> `createHttpTransport`

`"sse"` ถูกปฏิบัติเป็นตัวแปรการขนส่ง HTTP (คลาสเดียวกัน) ไม่ใช่การติดตั้งใช้งานการขนส่งแยกต่างหาก

## การไหลของข้อความ JSON-RPC และการเชื่อมโยง

## Request IDs

การขนส่งแต่ละอันสร้าง ID ต่อคำขอ (สตริง `Math.random` + timestamp) ID เป็น token การเชื่อมโยงในระดับ transport-local

## เส้นทางการเชื่อมโยง Stdio

- คำขอขาออกถูกทำให้เป็น serialize เป็นออบเจกต์ JSON หนึ่งรายการ + `\n`
- `#pendingRequests: Map<id, {resolve,reject}>` เก็บคำขอที่กำลังดำเนินการ
- ลูปการอ่านวิเคราะห์ JSONL จาก stdout และเรียก `#handleMessage`
- หากข้อความขาเข้ามี `id` ที่ตรงกัน คำขอจะ resolve/reject
- หากข้อความขาเข้ามี `method` และไม่มี `id` จะถูกปฏิบัติเป็นการแจ้งเตือนและส่งไปยัง `onNotification`

ID ที่ไม่รู้จักจะถูกละเว้น (ไม่มีการปฏิเสธ ไม่มี error callback)

## เส้นทางการเชื่อมโยง HTTP

- คำขอขาออกคือ HTTP `POST` พร้อม JSON body และ `id` ที่สร้างขึ้น
- เส้นทางการตอบสนองแบบไม่ใช่ SSE: วิเคราะห์การตอบสนอง JSON-RPC หนึ่งรายการและส่งคืน `result`/โยนข้อผิดพลาดใน `error`
- เส้นทางการตอบสนอง SSE (`Content-Type: text/event-stream`): สตรีม events ส่งคืนข้อความแรกที่มี `id` ตรงกับ request ID ที่คาดหวังและมี `result` หรือ `error`
- ข้อความ SSE ที่มี `method` และไม่มี `id` จะถูกปฏิบัติเป็นการแจ้งเตือน

หาก SSE stream สิ้นสุดก่อนได้รับการตอบสนองที่ตรงกัน คำขอจะล้มเหลวด้วย `No response received for request ID ...`

## การแจ้งเตือน

Client ส่งการแจ้งเตือน JSON-RPC ผ่าน `transport.notify(...)`

- Stdio: เขียน notification frame ไปยัง stdin (`jsonrpc`, `method`, `params` ที่เป็นตัวเลือก) บวกขึ้นบรรทัดใหม่
- HTTP: ส่ง POST body โดยไม่มี `id`; ความสำเร็จยอมรับ `2xx` หรือ `202 Accepted`

การแจ้งเตือนที่เริ่มต้นโดยเซิร์ฟเวอร์จะแสดงผ่าน transport `onNotification` เท่านั้น ไม่มี subscriber ส่วนกลางเริ่มต้นใน manager/client

## ภายใน Stdio transport

## วงจรชีวิตและการเปลี่ยนสถานะ

- สถานะเริ่มต้น: `connected=false`, `process=null`, pending map ว่าง
- `connect()`:
  - spawn subprocess ด้วย command/args/env/cwd ที่กำหนดค่า
  - ทำเครื่องหมายว่าเชื่อมต่อแล้ว
  - เริ่มลูปการอ่าน stdout (`readJsonl`)
  - เริ่มลูป stderr (อ่าน/ทิ้ง; ปิดเสียงในปัจจุบัน)
- `close()`:
  - ทำเครื่องหมายว่าตัดการเชื่อมต่อ
  - ปฏิเสธคำขอที่รอดำเนินการทั้งหมด (`Transport closed`)
  - ปิด subprocess
  - รอการปิด read loop
  - ส่ง `onClose`

หาก read loop ออกโดยไม่คาดคิด `finally` จะเรียก `#handleClose()` ซึ่งทำการปฏิเสธคำขอที่รอดำเนินการและ close callback เหมือนกัน

## การหมดเวลาและการยกเลิก

ต่อคำขอ:

- การหมดเวลาเริ่มต้นเป็น `config.timeout ?? 30000`
- `AbortSignal` ที่เป็นตัวเลือกจากผู้เรียก
- การยกเลิกและการหมดเวลาทั้งสองจะปฏิเสธ promise ที่รอดำเนินการและล้าง map entry

การยกเลิกเป็นแบบ local เท่านั้น: การขนส่งไม่ส่งการแจ้งเตือนการยกเลิกระดับโปรโตคอลไปยังเซิร์ฟเวอร์

## การจัดการ payload ที่มีรูปแบบผิดพลาด

ใน read loop:

- แต่ละบรรทัด JSONL ที่วิเคราะห์แล้วจะถูกส่งไปยัง `#handleMessage` ใน `try/catch`
- ข้อยกเว้นการจัดการข้อความที่ผิดรูปแบบ/ไม่ถูกต้องจะถูกทิ้ง (comment `Skip malformed lines`)
- loop ดำเนินต่อไป ดังนั้นข้อความที่ไม่ดีหนึ่งรายการจะไม่ทำลายการเชื่อมต่อ

หาก stream parser ที่อยู่เบื้องล่างโยนข้อผิดพลาด `onError` จะถูกเรียก (เมื่อยังเชื่อมต่ออยู่) จากนั้นการเชื่อมต่อจะปิด

## พฤติกรรมการตัดการเชื่อมต่อ/ความล้มเหลว

เมื่อกระบวนการออกหรือ stream ปิด:

- คำขอที่กำลังดำเนินการทั้งหมดจะถูกปฏิเสธด้วย `Transport closed`
- ไม่มีการรีสตาร์ทหรือเชื่อมต่อใหม่อัตโนมัติ
- ชั้นที่สูงกว่าต้องเชื่อมต่อใหม่โดยสร้างการขนส่งใหม่

## หมายเหตุ Backpressure/streaming

- การเขียนขาออกใช้ `stdin.write()` + `flush()` โดยไม่รอ drain semantics
- ไม่มีคิวหรือการจัดการ high-watermark อย่างชัดเจนใน transport
- การประมวลผลขาเข้าขับเคลื่อนด้วย stream (`for await` เหนือ `readJsonl`) ทีละข้อความที่วิเคราะห์แล้ว

## ภายใน HTTP/SSE transport

## วงจรชีวิตและ semantics การเชื่อมต่อ

HTTP transport มีสถานะการเชื่อมต่อเชิงตรรกะ แต่เส้นทางคำขอเป็น stateless ต่อการเรียก HTTP:

- `connect()` ตั้งค่า `connected=true` (ไม่มีการจับมือ socket/session)
- การติดตาม server session ที่เป็นตัวเลือกผ่าน header `Mcp-Session-Id`
- `close()` ส่ง `DELETE` พร้อม `Mcp-Session-Id` ที่เป็นตัวเลือก ยกเลิก SSE listener ส่ง `onClose`

ดังนั้น `connected` หมายถึง "การขนส่งใช้งานได้" ไม่ใช่ "สตรีมถาวรถูกสร้างขึ้น"

## พฤติกรรม Session header

- เมื่อได้รับการตอบสนอง POST หาก header `Mcp-Session-Id` มีอยู่ การขนส่งจะเก็บไว้
- คำขอ/การแจ้งเตือนถัดไปจะรวม `Mcp-Session-Id`
- `close()` พยายามยุติ server session ด้วย HTTP DELETE; ความล้มเหลวในการยุติจะถูกละเว้น

## การหมดเวลาและการยกเลิก

สำหรับทั้ง `request()` และ `notify()`:

- การหมดเวลาใช้ `AbortController` (`config.timeout ?? 30000`)
- สัญญาณภายนอก หากมี จะถูกรวมผ่าน `AbortSignal.any([...])`
- การจัดการ AbortError แยกแยะการยกเลิกจากผู้เรียกกับการหมดเวลา

ข้อผิดพลาดที่โยน:

- การหมดเวลา: `Request timeout after ...ms` (หรือ `SSE response timeout ...`, `Notify timeout ...`)
- การยกเลิกจากผู้เรียก: AbortError ต้นฉบับจะถูกโยนซ้ำเมื่อสัญญาณภายนอกยกเลิกแล้ว

## การแพร่กระจายข้อผิดพลาด HTTP

เมื่อได้รับการตอบสนองที่ไม่ OK:

- ข้อความการตอบสนองจะรวมอยู่ในข้อผิดพลาดที่โยน (`HTTP <status>: <text>`)
- หากมี คำใบ้การยืนยันตัวตนจาก `WWW-Authenticate` และ `Mcp-Auth-Server` จะถูกต่อท้าย

เมื่อได้รับออบเจกต์ข้อผิดพลาด JSON-RPC:

- โยน `MCP error <code>: <message>`

ความล้มเหลวของ JSON body ที่มีรูปแบบผิดพลาด (ความล้มเหลวของ `response.json()`) จะแพร่กระจายเป็น parse exception

## พฤติกรรม SSE และโหมด

มีเส้นทาง SSE สองเส้นทาง:

1. **การตอบสนอง SSE ต่อคำขอ** (`#parseSSEResponse`)
   - ใช้เมื่อ content type ของการตอบสนอง POST เป็น `text/event-stream`
   - ใช้งาน stream จนกว่าจะพบ response id ที่ตรงกัน
   - สามารถประมวลผลการแจ้งเตือนที่สลับกันในระหว่าง stream เดียวกัน

2. **SSE listener พื้นหลัง** (`startSSEListener()`)
   - GET listener ที่เป็นตัวเลือกสำหรับการแจ้งเตือนที่เริ่มต้นโดยเซิร์ฟเวอร์
   - ปัจจุบันไม่ถูกเริ่มต้นอัตโนมัติโดย MCP manager/client
   - หาก GET ส่งคืน `405` listener จะปิดเสียงตัวเอง (เซิร์ฟเวอร์ไม่รองรับโหมดนี้)

## การจัดการ payload ที่มีรูปแบบผิดพลาดและการตัดการเชื่อมต่อ

ข้อผิดพลาดการวิเคราะห์ JSON ของ SSE จะแพร่กระจายออกจาก `readSseJson` และปฏิเสธคำขอ/listener

- ข้อผิดพลาดการวิเคราะห์ SSE ของคำขอจะปฏิเสธคำขอที่ active
- ข้อผิดพลาด background listener จะเรียก `onError` (ยกเว้น AbortError)
- ไม่มีการเชื่อมต่อใหม่อัตโนมัติสำหรับ background listener

## ยูทิลิตี้ `json-rpc.ts` เทียบกับการสรุป transport

`src/mcp/json-rpc.ts` ให้ helpers `callMCP()` และ `parseSSE()` สำหรับการเรียก HTTP MCP โดยตรง (ใช้โดย Exa integration) ไม่ใช่การสรุป `MCPTransport` ที่ใช้โดย `MCPClient`/`MCPManager`

ความแตกต่างที่สำคัญจาก `HttpTransport`:

- วิเคราะห์ข้อความการตอบสนองทั้งหมดก่อน จากนั้นแยกบรรทัด `data:` แรก (`parseSSE`) พร้อม JSON fallback
- ไม่มีการจัดการ request timeout ไม่มี abort API ไม่มีการจัดการ session-id ไม่มีวงจรชีวิต transport
- ส่งคืนออบเจกต์ JSON-RPC envelope แบบดิบ

เส้นทางนี้เบาแต่มีความทนทานน้อยกว่าการติดตั้งใช้งาน transport แบบเต็ม

## ความรับผิดชอบด้านการลองใหม่/การเชื่อมต่อใหม่

## ระดับ Transport

การติดตั้งใช้งาน transport ปัจจุบัน **ไม่**:

- ลองคำขอที่ล้มเหลวใหม่
- เชื่อมต่อใหม่หลังจาก stdio process ออก
- เชื่อมต่อ SSE listeners ใหม่
- ส่งคำขอที่กำลังดำเนินการใหม่หลังการตัดการเชื่อมต่อ

พวกมันล้มเหลวอย่างรวดเร็วและแพร่กระจายข้อผิดพลาด

## ระดับ Manager/client

`MCPManager` จัดการการค้นพบ/การประสานงานการเชื่อมต่อเริ่มต้นและสามารถเชื่อมต่อใหม่ได้โดยการรันกระแสงานการเชื่อมต่ออีกครั้ง (เส้นทาง `connectToServer`/`discoverAndConnect`) มันไม่ auto-heal transport ที่เชื่อมต่อแล้วเมื่อ runtime failure callbacks

`MCPManager` มีพฤติกรรม startup fallback สำหรับเซิร์ฟเวอร์ที่ช้า (deferred tools จาก cache) แต่นั่นคือ tool availability fallback ไม่ใช่การลองใหม่ transport

## สรุปสถานการณ์ความล้มเหลว

- **บรรทัดข้อความ stdio ที่มีรูปแบบผิดพลาด**: ถูกทิ้ง; stream ดำเนินต่อไป
- **stdio stream/process สิ้นสุด**: transport ปิด; คำขอที่รอดำเนินการถูกปฏิเสธเป็น `Transport closed`
- **HTTP ที่ไม่ใช่ 2xx**: คำขอ/การแจ้งเตือนโยน HTTP error
- **การตอบสนอง JSON ที่ไม่ถูกต้อง**: parse exception ถูกแพร่กระจาย
- **SSE สิ้นสุดโดยไม่มี id ที่ตรงกัน**: คำขอล้มเหลวด้วย `No response received for request ID ...`
- **การหมดเวลา**: ข้อผิดพลาดการหมดเวลาเฉพาะ transport
- **การยกเลิกจากผู้เรียก**: AbortError/เหตุผลถูกแพร่กระจายจากสัญญาณผู้เรียก

## กฎขอบเขตเชิงปฏิบัติ

หากข้อกังวลเป็นเรื่องรูปร่างข้อความ การเชื่อมโยง id หรือลำดับเมธอด MCP จะอยู่ในลอจิก protocol/client

หากข้อกังวลเป็นเรื่องการจัดเฟรม (JSONL เทียบกับ HTTP/SSE) การวิเคราะห์ stream วงจรชีวิต fetch/spawn นาฬิกา timeout หรือการปิดการเชื่อมต่อ จะอยู่ในการติดตั้งใช้งาน transport
