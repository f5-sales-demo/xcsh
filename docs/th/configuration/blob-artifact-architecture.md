---
title: สถาปัตยกรรมการจัดเก็บ Blob และ Artifact
description: >-
  Content-addressable blob store และ artifact registry สำหรับสื่อของเซสชัน,
  ภาพหน้าจอ, และผลลัพธ์ของเครื่องมือ
sidebar:
  order: 7
  label: การจัดเก็บ Blob และ Artifact
i18n:
  sourceHash: 70d255f48d5b
  translator: machine
---

# สถาปัตยกรรมการจัดเก็บ Blob และ Artifact

เอกสารนี้อธิบายวิธีที่ coding-agent จัดเก็บ payload ขนาดใหญ่/ไบนารีนอก session JSONL วิธีที่ผลลัพธ์ของเครื่องมือที่ถูกตัดทอนถูกบันทึก และวิธีที่ URL ภายใน (`artifact://`, `agent://`) ถูก resolve กลับไปยังข้อมูลที่จัดเก็บ

## ทำไมจึงมีระบบจัดเก็บสองระบบ

รันไทม์ใช้กลไกการคงอยู่ของข้อมูลสองแบบที่แตกต่างกันสำหรับรูปแบบข้อมูลที่แตกต่างกัน:

- **Content-addressed blobs** (`blob:sha256:<hash>`): การจัดเก็บแบบ global ที่เน้นไบนารี ใช้สำหรับ externalize payload base64 ของภาพขนาดใหญ่ออกจากรายการเซสชันที่ถูกบันทึก
- **Session-scoped artifacts** (ไฟล์ภายใต้ `<sessionFile-without-.jsonl>/`): ไฟล์ข้อความต่อเซสชันที่ใช้สำหรับผลลัพธ์เครื่องมือแบบเต็มและผลลัพธ์ของ subagent

ทั้งสองถูกแยกออกจากกันโดยเจตนา:

- การจัดเก็บ blob ปรับแต่งเพื่อการกำจัดข้อมูลซ้ำซ้อนและการอ้างอิงที่เสถียรโดย content hash
- การจัดเก็บ artifact ปรับแต่งเพื่อการทำงานของเครื่องมือเซสชันแบบ append-only และการเรียกดูโดยมนุษย์/เครื่องมือผ่าน local ID

## ขอบเขตการจัดเก็บและโครงสร้างบนดิสก์

## ขอบเขต Blob store (global)

`SessionManager` สร้าง `BlobStore(getBlobsDir())` ดังนั้นไฟล์ blob จะอยู่ในไดเรกทอรี blob ที่ใช้ร่วมกันแบบ global (ไม่ได้อยู่ในโฟลเดอร์เซสชัน)

การตั้งชื่อไฟล์ blob:

- เส้นทางไฟล์: `<blobsDir>/<sha256-hex>`
- ไม่มีนามสกุล
- สตริงอ้างอิงที่เก็บในรายการ: `blob:sha256:<sha256-hex>`

ผลที่ตามมา:

- เนื้อหาไบนารีเดียวกันข้ามเซสชันจะ resolve ไปยัง hash/เส้นทางเดียวกัน
- การเขียนเป็น idempotent ในระดับเนื้อหา
- blob สามารถอยู่ได้นานกว่าไฟล์เซสชันใดๆ

## ขอบเขต Artifact (session-local)

`ArtifactManager` สร้างไดเรกทอรี artifact จากเส้นทางไฟล์เซสชัน:

- ไฟล์เซสชัน: `.../<timestamp>_<sessionId>.jsonl`
- ไดเรกทอรี artifacts: `.../<timestamp>_<sessionId>/` (ตัด `.jsonl` ออก)

ประเภท artifact ใช้ไดเรกทอรีนี้ร่วมกัน:

- ไฟล์ผลลัพธ์เครื่องมือที่ถูกตัดทอน: `<numericId>.<toolType>.log` (สำหรับ `artifact://`)
- ไฟล์ผลลัพธ์ subagent: `<outputId>.md` (สำหรับ `agent://`)

## รูปแบบการจัดสรร ID และชื่อ

## ID ของ Blob: content hash

`BlobStore.put()` คำนวณ SHA-256 จากไบต์ไบนารีดิบและส่งคืน:

- `hash`: hex digest
- `path`: `<blobsDir>/<hash>`
- `ref`: `blob:sha256:<hash>`

ไม่มีการใช้ตัวนับระดับ session-local

## ID ของ Artifact: จำนวนเต็มแบบ monotonic ระดับเซสชัน

`ArtifactManager` สแกนไฟล์ artifact `*.log` ที่มีอยู่ในการใช้งานครั้งแรกเพื่อหา ID ตัวเลขสูงสุดที่มีอยู่และตั้ง `nextId = max + 1`

พฤติกรรมการจัดสรร:

- รูปแบบไฟล์: `{id}.{toolType}.log`
- ID เป็นสตริงต่อเนื่อง (`"0"`, `"1"`, ...)
- การดำเนินการต่อไม่เขียนทับ artifact ที่มีอยู่เพราะการสแกนเกิดขึ้นก่อนการจัดสรร

หากไดเรกทอรี artifact หายไป การสแกนจะให้รายการว่างและการจัดสรรเริ่มจาก `0`

## ID ผลลัพธ์ Agent (`agent://`)

`AgentOutputManager` จัดสรร ID สำหรับผลลัพธ์ subagent เป็น `<index>-<requestedId>` (อาจซ้อนอยู่ภายใต้ prefix ของ parent เช่น `0-Parent.1-Child`) โดยจะสแกนไฟล์ `.md` ที่มีอยู่ในการเริ่มต้นเพื่อดำเนินการต่อจาก index ถัดไปเมื่อ resume

## กระแสข้อมูลการคงอยู่

## 1) เส้นทางการเขียนใหม่สำหรับการคงอยู่ของรายการเซสชัน

ก่อนที่รายการเซสชันจะถูกเขียน (`#rewriteFile` / incremental persist) `SessionManager` จะเรียก `prepareEntryForPersistence()` (ผ่าน `truncateForPersistence`)

พฤติกรรมสำคัญ:

1. **การตัดทอนสตริงขนาดใหญ่**: สตริงขนาดใหญ่เกินจะถูกตัดและต่อท้ายด้วย `"[Session persistence truncated large content]"`
2. **การลบฟิลด์ชั่วคราว**: `partialJson` และ `jsonlEvents` จะถูกลบออกจากรายการที่ถูกบันทึก
3. **การ externalize ภาพไปยัง blob**:
   - ใช้เฉพาะกับ image block ในอาร์เรย์ `content`
   - เฉพาะเมื่อ `data` ไม่ใช่ blob ref อยู่แล้ว
   - เฉพาะเมื่อความยาว base64 อย่างน้อยเท่ากับ threshold (`BLOB_EXTERNALIZE_THRESHOLD = 1024`)
   - แทนที่ base64 แบบ inline ด้วย `blob:sha256:<hash>`

สิ่งนี้ทำให้ session JSONL กระชับในขณะที่ยังคงสามารถกู้คืนได้

## 2) เส้นทางการ rehydrate เมื่อโหลดเซสชัน

เมื่อเปิดเซสชัน (`setSessionFile`) หลังจาก migration แล้ว `SessionManager` จะรัน `resolveBlobRefsInEntries()`

สำหรับแต่ละ image block ของ message/custom-message ที่มี `blob:sha256:<hash>`:

- อ่านไบต์ blob จาก blob store
- แปลงไบต์กลับเป็น base64
- เปลี่ยนรายการในหน่วยความจำให้เป็น base64 แบบ inline สำหรับผู้ใช้รันไทม์

หาก blob หายไป:

- `resolveImageData()` บันทึก warning
- ส่งคืนสตริง ref เดิมโดยไม่เปลี่ยนแปลง
- การโหลดดำเนินต่อ (ไม่มี hard crash)

## 3) เส้นทางการ spill/ตัดทอนผลลัพธ์เครื่องมือ

`OutputSink` ขับเคลื่อนผลลัพธ์แบบ streaming ใน bash/python/ssh และ executor ที่เกี่ยวข้อง

พฤติกรรม:

1. ทุก chunk จะถูก sanitize และต่อท้ายไปยัง tail buffer ในหน่วยความจำ
2. เมื่อไบต์ในหน่วยความจำเกิน spill threshold (`DEFAULT_MAX_BYTES`, 50KB) sink จะทำเครื่องหมายว่าผลลัพธ์ถูกตัดทอน
3. หากมีเส้นทาง artifact ที่พร้อมใช้งาน sink จะเปิด file writer และเขียน:
   - เนื้อหาบัฟเฟอร์ที่มีอยู่หนึ่งครั้ง
   - chunk ที่ตามมาทั้งหมด
4. บัฟเฟอร์ในหน่วยความจำจะถูกตัดให้เหลือ tail window สำหรับการแสดงผลเสมอ
5. `dump()` ส่งคืนสรุปรวมถึง `artifactId` เฉพาะเมื่อ file sink ถูกสร้างสำเร็จ

ผลในทางปฏิบัติ:

- UI/ค่าส่งคืนเครื่องมือแสดง tail ที่ถูกตัดทอน
- ผลลัพธ์เต็มถูกเก็บรักษาในไฟล์ artifact และอ้างอิงเป็น `artifact://<id>`

หากการสร้าง file sink ล้มเหลว (ข้อผิดพลาด I/O, เส้นทางหายไป ฯลฯ) sink จะ fallback อย่างเงียบๆ ไปยังการตัดทอนในหน่วยความจำเท่านั้น; ผลลัพธ์เต็มจะไม่ถูกบันทึก

## โมเดลการเข้าถึง URL

## การอ้างอิง `blob:`

`blob:sha256:<hash>` เป็นการอ้างอิงสำหรับการคงอยู่ภายใน payload ของรายการเซสชัน ไม่ใช่ URL scheme ภายในที่จัดการโดย router การ resolve ทำโดย `SessionManager` ระหว่างการโหลดเซสชัน

## `artifact://<id>`

จัดการโดย `ArtifactProtocolHandler`:

- ต้องการไดเรกทอรี artifact ของเซสชันที่ active อยู่
- ID ต้องเป็นตัวเลข
- resolve โดยจับคู่ prefix ของชื่อไฟล์ `<id>.`
- ส่งคืนข้อความดิบ (`text/plain`) จากไฟล์ `.log` ที่ตรงกัน
- เมื่อหายไป ข้อผิดพลาดจะรวมรายการ artifact ID ที่มีอยู่

พฤติกรรมเมื่อไดเรกทอรีหายไป:

- หากไดเรกทอรี artifacts ไม่มีอยู่ จะ throw `No artifacts directory found`

## `agent://<id>`

จัดการโดย `AgentProtocolHandler` ผ่าน `<artifactsDir>/<id>.md`:

- รูปแบบธรรมดาส่งคืนข้อความ markdown
- รูปแบบ `/path` หรือ `?q=` ทำการ JSON extraction
- ไม่สามารถรวม path และ query extraction ได้
- หากมีการร้องขอ extraction เนื้อหาไฟล์ต้อง parse เป็น JSON ได้

พฤติกรรมเมื่อไดเรกทอรีหายไป:

- throw `No artifacts directory found`

พฤติกรรมเมื่อผลลัพธ์หายไป:

- throw `Not found: <id>` พร้อม ID ที่มีอยู่จากไฟล์ `.md` ที่มี

การรวมกับเครื่องมือ read:

- `read` รองรับ pagination ด้วย offset/limit สำหรับการอ่าน internal URL แบบไม่มี extraction
- ปฏิเสธ `offset/limit` เมื่อใช้ `agent://` extraction

## ความหมายของ Resume, Fork, และ Move

## Resume

- `ArtifactManager` สแกนไฟล์ `{id}.*.log` ที่มีอยู่ในการจัดสรรครั้งแรกและดำเนินการนับต่อ
- `AgentOutputManager` สแกน ID ผลลัพธ์ `.md` ที่มีอยู่และดำเนินการนับต่อ
- `SessionManager` rehydrate blob ref เป็น base64 เมื่อโหลด

## Fork

`SessionManager.fork()` สร้างไฟล์เซสชันใหม่ที่มี session ID ใหม่และลิงก์ `parentSession` จากนั้นส่งคืนเส้นทางไฟล์เก่า/ใหม่ การคัดลอก artifact จัดการโดย `AgentSession.fork()`:

- พยายามคัดลอกแบบ recursive จากไดเรกทอรี artifact เก่าไปยังไดเรกทอรี artifact ใหม่
- ยอมรับได้หากไดเรกทอรีเก่าหายไป
- ข้อผิดพลาดการคัดลอกที่ไม่ใช่ ENOENT จะถูกบันทึกเป็น warning และ fork ยังคงเสร็จสมบูรณ์

ผลกระทบต่อ ID หลัง fork:

- หากการคัดลอกสำเร็จ ตัวนับ artifact ในเซสชันใหม่จะดำเนินต่อหลังจาก max copied ID
- หากการคัดลอกล้มเหลว/ถูกข้าม ID ของ artifact ในเซสชันใหม่จะเริ่มจาก `0`

ผลกระทบต่อ Blob หลัง fork:

- blob เป็นแบบ global และ content-addressed ดังนั้นไม่จำเป็นต้องคัดลอกไดเรกทอรี blob

## ย้ายไปยัง cwd ใหม่

`SessionManager.moveTo()` เปลี่ยนชื่อทั้งไฟล์เซสชันและไดเรกทอรี artifact ไปยังไดเรกทอรีเซสชันเริ่มต้นใหม่ โดยมีตรรกะ rollback หากขั้นตอนถัดไปล้มเหลว สิ่งนี้รักษาอัตลักษณ์ของ artifact ในขณะที่ย้ายขอบเขตเซสชัน

## การจัดการความล้มเหลวและเส้นทาง fallback

| กรณี | พฤติกรรม |
| --- | --- |
| ไฟล์ blob หายไประหว่าง rehydration | แจ้ง warning และเก็บสตริง `blob:sha256:` ref ในหน่วยความจำ |
| การอ่าน blob ENOENT ผ่าน `BlobStore.get` | ส่งคืน `null` |
| ไดเรกทอรี artifact หายไป (`ArtifactManager.listFiles`) | ส่งคืนรายการว่าง (การจัดสรรสามารถเริ่มใหม่) |
| ไดเรกทอรี artifact หายไป (`artifact://` / `agent://`) | Throw ข้อความชัดเจน `No artifacts directory found` |
| ไม่พบ artifact ID | Throw พร้อมรายการ ID ที่มีอยู่ |
| การสร้าง artifact writer ของ OutputSink ล้มเหลว | ดำเนินต่อด้วยการตัดทอนแบบ tail เท่านั้น (ไม่มี artifact ผลลัพธ์เต็ม) |
| ไม่มีไฟล์เซสชัน (บางเส้นทางของ task) | เครื่องมือ task fallback ไปยังไดเรกทอรี artifacts ชั่วคราวสำหรับผลลัพธ์ subagent |

## การ externalize blob ไบนารี vs artifact ผลลัพธ์ข้อความ

- **การ externalize blob** สำหรับ payload ภาพไบนารีภายในเนื้อหารายการเซสชันที่ถูกบันทึก; มันแทนที่ base64 แบบ inline ใน JSONL ด้วย content ref ที่เสถียร
- **Artifacts** เป็นไฟล์ข้อความธรรมดาสำหรับผลลัพธ์การทำงานและผลลัพธ์ subagent; สามารถเข้าถึงได้โดย ID ระดับ session-local ผ่าน URL ภายใน

ทั้งสองระบบตัดกันทางอ้อมเท่านั้น (ทั้งคู่ลด JSONL bloat ของเซสชัน) แต่มีอัตลักษณ์ อายุการใช้งาน และเส้นทางการเรียกดูที่แตกต่างกัน

## ไฟล์การใช้งาน

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — รูปแบบ blob reference, hashing, put/get, helper สำหรับ externalize/resolve
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — โมเดลไดเรกทอรี artifact ของเซสชันและการจัดสรร artifact ID แบบตัวเลข
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — พฤติกรรมการตัดทอน/spill-to-file ของ `OutputSink` และ metadata สรุป
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — การแปลงสำหรับการคงอยู่, blob rehydration เมื่อโหลด, การโต้ตอบ fork/move ของเซสชัน
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — การคัดลอกไดเรกทอรี artifact ระหว่าง interactive fork
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — การ bootstrap ตัวจัดการ artifact ของเครื่องมือและการจัดสรรเส้นทาง artifact ต่อเครื่องมือ
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — resolver `artifact://`
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — resolver `agent://` + JSON extraction
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — การเชื่อมต่อ router URL ภายในและ resolver ไดเรกทอรี artifacts
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — การจัดสรร agent output ID ระดับเซสชันสำหรับ `agent://`
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — การเขียน artifact ผลลัพธ์ subagent (`<id>.md`) และ fallback ไดเรกทอรี artifact ชั่วคราว
