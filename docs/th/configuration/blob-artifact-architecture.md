---
title: Blob and Artifact Storage Architecture
description: >-
  Content-addressable blob store and artifact registry for session media,
  screenshots, and tool outputs.
sidebar:
  order: 7
  label: Blob & artifact storage
i18n:
  sourceHash: 70d255f48d5b
  translator: machine
---

# สถาปัตยกรรมการจัดเก็บ Blob และ Artifact

เอกสารนี้อธิบายวิธีที่ coding-agent จัดเก็บ payload ขนาดใหญ่/ไบนารีภายนอก session JSONL วิธีที่ผลลัพธ์ของเครื่องมือที่ถูกตัดทอนถูกบันทึก และวิธีที่ URL ภายใน (`artifact://`, `agent://`) แปลงกลับไปยังข้อมูลที่จัดเก็บไว้

## ทำไมจึงมีระบบจัดเก็บสองระบบ

Runtime ใช้กลไกการบันทึกข้อมูลที่แตกต่างกันสองแบบสำหรับรูปแบบข้อมูลที่แตกต่างกัน:

- **Blob ที่อ้างอิงตามเนื้อหา** (`blob:sha256:<hash>`): การจัดเก็บระดับ global ที่เน้นไบนารี ใช้สำหรับย้าย payload base64 ของรูปภาพขนาดใหญ่ออกจากรายการ session ที่บันทึกไว้
- **Artifact ที่อยู่ในขอบเขต session** (ไฟล์ภายใต้ `<sessionFile-without-.jsonl>/`): ไฟล์ข้อความเฉพาะ session ที่ใช้สำหรับผลลัพธ์เต็มของเครื่องมือและผลลัพธ์ของ subagent

ทั้งสองระบบถูกแยกออกจากกันโดยตั้งใจ:

- การจัดเก็บ blob ช่วยเพิ่มประสิทธิภาพการกำจัดข้อมูลซ้ำซ้อนและการอ้างอิงที่เสถียรด้วย content hash
- การจัดเก็บ artifact ช่วยเพิ่มประสิทธิภาพเครื่องมือ session แบบ append-only และการดึงข้อมูลโดยมนุษย์/เครื่องมือผ่าน local ID

## ขอบเขตการจัดเก็บและโครงสร้างบนดิสก์

## ขอบเขต Blob store (global)

`SessionManager` สร้าง `BlobStore(getBlobsDir())` ดังนั้นไฟล์ blob จะอยู่ในไดเรกทอรี blob ที่ใช้ร่วมกันแบบ global (ไม่ได้อยู่ในโฟลเดอร์ session)

การตั้งชื่อไฟล์ blob:

- เส้นทางไฟล์: `<blobsDir>/<sha256-hex>`
- ไม่มีนามสกุลไฟล์
- สตริงอ้างอิงที่เก็บในรายการ: `blob:sha256:<sha256-hex>`

ผลกระทบ:

- เนื้อหาไบนารีเดียวกันข้ามหลาย session จะแปลงเป็น hash/path เดียวกัน
- การเขียนเป็น idempotent ในระดับเนื้อหา
- blob สามารถคงอยู่ได้นานกว่าไฟล์ session ใดๆ

## ขอบเขต Artifact (session-local)

`ArtifactManager` สร้างไดเรกทอรี artifact จากเส้นทางไฟล์ session:

- ไฟล์ session: `.../<timestamp>_<sessionId>.jsonl`
- ไดเรกทอรี artifact: `.../<timestamp>_<sessionId>/` (ตัด `.jsonl` ออก)

ประเภท artifact ใช้ไดเรกทอรีเดียวกัน:

- ไฟล์ผลลัพธ์เครื่องมือที่ถูกตัดทอน: `<numericId>.<toolType>.log` (สำหรับ `artifact://`)
- ไฟล์ผลลัพธ์ subagent: `<outputId>.md` (สำหรับ `agent://`)

## รูปแบบการจัดสรร ID และการตั้งชื่อ

## ID ของ Blob: content hash

`BlobStore.put()` คำนวณ SHA-256 จากไบต์ไบนารีดิบและส่งคืน:

- `hash`: hex digest
- `path`: `<blobsDir>/<hash>`
- `ref`: `blob:sha256:<hash>`

ไม่มีการใช้ตัวนับระดับ session-local

## ID ของ Artifact: จำนวนเต็มเพิ่มขึ้นแบบ monotonic ในระดับ session-local

`ArtifactManager` สแกนไฟล์ artifact `*.log` ที่มีอยู่เมื่อใช้งานครั้งแรกเพื่อหา numeric ID สูงสุดที่มีอยู่แล้วกำหนด `nextId = max + 1`

พฤติกรรมการจัดสรร:

- รูปแบบไฟล์: `{id}.{toolType}.log`
- ID เป็นสตริงลำดับ (`"0"`, `"1"`, ...)
- การดำเนินการต่อจะไม่เขียนทับ artifact ที่มีอยู่เนื่องจากการสแกนเกิดขึ้นก่อนการจัดสรร

หากไดเรกทอรี artifact หายไป การสแกนจะให้รายการว่างและการจัดสรรเริ่มจาก `0`

## ID ของ Agent output (`agent://`)

`AgentOutputManager` จัดสรร ID สำหรับผลลัพธ์ subagent เป็น `<index>-<requestedId>` (อาจซ้อนภายใต้ prefix หลัก เช่น `0-Parent.1-Child`) โดยจะสแกนไฟล์ `.md` ที่มีอยู่เมื่อเริ่มต้นเพื่อดำเนินการต่อจาก index ถัดไปเมื่อ resume

## กระแสข้อมูลการบันทึก

## 1) เส้นทางการเขียนซ้ำเมื่อบันทึกรายการ session

ก่อนที่รายการ session จะถูกเขียน (`#rewriteFile` / incremental persist) `SessionManager` จะเรียก `prepareEntryForPersistence()` (ผ่าน `truncateForPersistence`)

พฤติกรรมสำคัญ:

1. **การตัดทอนสตริงขนาดใหญ่**: สตริงที่มีขนาดเกินจะถูกตัดและต่อท้ายด้วย `"[Session persistence truncated large content]"`
2. **การลบฟิลด์ชั่วคราว**: `partialJson` และ `jsonlEvents` จะถูกลบออกจากรายการที่บันทึก
3. **การย้ายรูปภาพออกไปเป็น blob**:
   - ใช้เฉพาะกับบล็อกรูปภาพในอาร์เรย์ `content`
   - เฉพาะเมื่อ `data` ยังไม่ใช่ blob ref
   - เฉพาะเมื่อความยาว base64 อย่างน้อยถึงเกณฑ์ (`BLOB_EXTERNALIZE_THRESHOLD = 1024`)
   - แทนที่ base64 แบบ inline ด้วย `blob:sha256:<hash>`

สิ่งนี้ทำให้ session JSONL มีขนาดเล็กในขณะที่ยังคงความสามารถในการกู้คืน

## 2) เส้นทางการ rehydrate เมื่อโหลด session

เมื่อเปิด session (`setSessionFile`) หลังจากการ migration แล้ว `SessionManager` จะเรียก `resolveBlobRefsInEntries()`

สำหรับแต่ละบล็อกรูปภาพ message/custom-message ที่มี `blob:sha256:<hash>`:

- อ่านไบต์ blob จาก blob store
- แปลงไบต์กลับเป็น base64
- แก้ไขรายการ in-memory ให้เป็น base64 แบบ inline สำหรับผู้ใช้งาน runtime

หาก blob หายไป:

- `resolveImageData()` บันทึกคำเตือน
- ส่งคืนสตริง ref เดิมโดยไม่เปลี่ยนแปลง
- การโหลดดำเนินต่อไป (ไม่ crash)

## 3) เส้นทางการ spill/ตัดทอนผลลัพธ์ของเครื่องมือ

`OutputSink` ขับเคลื่อนการสตรีมผลลัพธ์ใน bash/python/ssh และ executor ที่เกี่ยวข้อง

พฤติกรรม:

1. ทุก chunk จะถูก sanitize และเพิ่มเข้าไปในบัฟเฟอร์ tail ใน memory
2. เมื่อไบต์ใน memory เกินเกณฑ์ spill (`DEFAULT_MAX_BYTES`, 50KB) sink จะทำเครื่องหมายว่าผลลัพธ์ถูกตัดทอน
3. หากมี artifact path ที่ใช้ได้ sink จะเปิด file writer และเขียน:
   - เนื้อหาที่บัฟเฟอร์อยู่ทั้งหมดหนึ่งครั้ง
   - chunk ที่ตามมาทั้งหมด
4. บัฟเฟอร์ใน memory จะถูกตัดให้เหลือเฉพาะหน้าต่าง tail เสมอสำหรับการแสดงผล
5. `dump()` ส่งคืนสรุปที่รวม `artifactId` เฉพาะเมื่อ file sink ถูกสร้างสำเร็จ

ผลในทางปฏิบัติ:

- UI/ค่าส่งคืนของเครื่องมือแสดงเฉพาะ tail ที่ถูกตัดทอน
- ผลลัพธ์เต็มถูกเก็บรักษาไว้ในไฟล์ artifact และอ้างอิงเป็น `artifact://<id>`

หากการสร้าง file sink ล้มเหลว (ข้อผิดพลาด I/O, เส้นทางหายไป ฯลฯ) sink จะ fallback อย่างเงียบๆ เป็นการตัดทอนใน memory เท่านั้น ผลลัพธ์เต็มจะไม่ถูกบันทึก

## รูปแบบการเข้าถึง URL

## การอ้างอิง `blob:`

`blob:sha256:<hash>` เป็นการอ้างอิงสำหรับการบันทึกภายใน payload ของรายการ session ไม่ใช่ scheme URL ภายในที่จัดการโดย router การแปลงจะทำโดย `SessionManager` ระหว่างการโหลด session

## `artifact://<id>`

จัดการโดย `ArtifactProtocolHandler`:

- ต้องมีไดเรกทอรี artifact ของ session ที่ใช้งานอยู่
- ID ต้องเป็นตัวเลข
- แปลงโดยจับคู่ prefix ชื่อไฟล์ `<id>.`
- ส่งคืนข้อความดิบ (`text/plain`) จากไฟล์ `.log` ที่ตรงกัน
- เมื่อไม่พบ ข้อผิดพลาดจะรวมรายการ artifact ID ที่มีอยู่

พฤติกรรมเมื่อไดเรกทอรีหายไป:

- หากไดเรกทอรี artifact ไม่มีอยู่ จะ throw `No artifacts directory found`

## `agent://<id>`

จัดการโดย `AgentProtocolHandler` ผ่าน `<artifactsDir>/<id>.md`:

- รูปแบบพื้นฐานส่งคืนข้อความ markdown
- รูปแบบ `/path` หรือ `?q=` ทำการแยกข้อมูล JSON
- ไม่สามารถรวมการแยกข้อมูลด้วย path และ query พร้อมกันได้
- หากมีการร้องขอการแยกข้อมูล เนื้อหาไฟล์ต้อง parse เป็น JSON ได้

พฤติกรรมเมื่อไดเรกทอรีหายไป:

- throw `No artifacts directory found`

พฤติกรรมเมื่อผลลัพธ์หายไป:

- throw `Not found: <id>` พร้อม ID ที่มีอยู่จากไฟล์ `.md` ที่มีอยู่

การรวมกับเครื่องมือ read:

- `read` รองรับการแบ่งหน้าด้วย offset/limit สำหรับการอ่าน URL ภายในที่ไม่ใช่การแยกข้อมูล
- ปฏิเสธ `offset/limit` เมื่อใช้การแยกข้อมูล `agent://`

## ความหมายของ Resume, Fork และ Move

## Resume

- `ArtifactManager` สแกนไฟล์ `{id}.*.log` ที่มีอยู่เมื่อจัดสรรครั้งแรกและดำเนินการนับต่อ
- `AgentOutputManager` สแกน ID ผลลัพธ์ `.md` ที่มีอยู่และดำเนินการนับต่อ
- `SessionManager` rehydrate blob ref เป็น base64 เมื่อโหลด

## Fork

`SessionManager.fork()` สร้างไฟล์ session ใหม่ที่มี session ID ใหม่และลิงก์ `parentSession` จากนั้นส่งคืนเส้นทางไฟล์เก่า/ใหม่ การคัดลอก artifact จัดการโดย `AgentSession.fork()`:

- พยายามคัดลอกแบบ recursive จากไดเรกทอรี artifact เก่าไปยังไดเรกทอรี artifact ใหม่
- ยอมรับกรณีที่ไดเรกทอรีเก่าหายไป
- ข้อผิดพลาดการคัดลอกที่ไม่ใช่ ENOENT จะถูกบันทึกเป็นคำเตือนและ fork ยังคงเสร็จสมบูรณ์

ผลกระทบต่อ ID หลัง fork:

- หากการคัดลอกสำเร็จ ตัวนับ artifact ใน session ใหม่จะดำเนินต่อหลังจาก ID สูงสุดที่คัดลอกมา
- หากการคัดลอกล้มเหลว/ถูกข้าม ID artifact ของ session ใหม่เริ่มจาก `0`

ผลกระทบต่อ blob หลัง fork:

- blob เป็น global และอ้างอิงตามเนื้อหา ดังนั้นไม่จำเป็นต้องคัดลอกไดเรกทอรี blob

## ย้ายไปยัง cwd ใหม่

`SessionManager.moveTo()` เปลี่ยนชื่อทั้งไฟล์ session และไดเรกทอรี artifact ไปยังไดเรกทอรี session เริ่มต้นใหม่ พร้อมด้วยตรรกะ rollback หากขั้นตอนถัดไปล้มเหลว สิ่งนี้รักษาอัตลักษณ์ของ artifact ในขณะที่ย้ายตำแหน่งขอบเขต session

## การจัดการความล้มเหลวและเส้นทาง fallback

| กรณี | พฤติกรรม |
| --- | --- |
| ไฟล์ blob หายไประหว่างการ rehydrate | เตือนและเก็บสตริง `blob:sha256:` ref ไว้ใน memory |
| อ่าน blob ENOENT ผ่าน `BlobStore.get` | ส่งคืน `null` |
| ไดเรกทอรี artifact หายไป (`ArtifactManager.listFiles`) | ส่งคืนรายการว่าง (การจัดสรรสามารถเริ่มใหม่ได้) |
| ไดเรกทอรี artifact หายไป (`artifact://` / `agent://`) | Throw `No artifacts directory found` อย่างชัดเจน |
| ไม่พบ Artifact ID | Throw พร้อมรายการ ID ที่มีอยู่ |
| การเริ่มต้น artifact writer ของ OutputSink ล้มเหลว | ดำเนินต่อด้วยการตัดทอนเฉพาะ tail (ไม่มี artifact ผลลัพธ์เต็ม) |
| ไม่มีไฟล์ session (บางเส้นทางของ task) | เครื่องมือ Task fallback ไปใช้ไดเรกทอรี artifact ชั่วคราวสำหรับผลลัพธ์ subagent |

## การย้ายออก blob ไบนารี vs artifact ผลลัพธ์ข้อความ

- **การย้าย blob ออก** มีไว้สำหรับ payload รูปภาพไบนารีภายในเนื้อหารายการ session ที่บันทึกไว้ โดยแทนที่ base64 แบบ inline ใน JSONL ด้วยการอ้างอิงเนื้อหาที่เสถียร
- **Artifact** เป็นไฟล์ข้อความธรรมดาสำหรับผลลัพธ์การดำเนินการและผลลัพธ์ subagent สามารถเข้าถึงได้ด้วย ID ระดับ session-local ผ่าน URL ภายใน

ระบบทั้งสองตัดกันโดยอ้อมเท่านั้น (ทั้งสองลดการบวมของ session JSONL) แต่มีอัตลักษณ์ อายุการใช้งาน และเส้นทางการดึงข้อมูลที่แตกต่างกัน

## ไฟล์ implementation

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — รูปแบบการอ้างอิง blob, การ hash, put/get, helper สำหรับการย้ายออก/แปลงกลับ
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — โมเดลไดเรกทอรี artifact ของ session และการจัดสรร artifact ID แบบตัวเลข
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — พฤติกรรมการตัดทอน/spill-to-file ของ `OutputSink` และ metadata สรุป
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — การแปลงเพื่อบันทึก, การ rehydrate blob เมื่อโหลด, การโต้ตอบ fork/move ของ session
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — การคัดลอกไดเรกทอรี artifact ระหว่างการ fork แบบ interactive
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — การเริ่มต้น artifact manager ของเครื่องมือและการจัดสรรเส้นทาง artifact เฉพาะเครื่องมือ
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — ตัวแปลง `artifact://`
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — ตัวแปลง `agent://` + การแยกข้อมูล JSON
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — การเชื่อมต่อ router URL ภายในและตัวแปลง artifacts-dir
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — การจัดสรร agent output ID ระดับ session สำหรับ `agent://`
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — การเขียน artifact ผลลัพธ์ subagent (`<id>.md`) และ fallback ไดเรกทอรี artifact ชั่วคราว
