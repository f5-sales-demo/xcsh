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

เอกสารนี้อธิบายวิธีที่ coding-agent จัดเก็บ payload ขนาดใหญ่/ไบนารีนอก session JSONL วิธีที่ tool output ที่ถูกตัดทอนถูกบันทึก และวิธีที่ URL ภายใน (`artifact://`, `agent://`) แปลงกลับไปยังข้อมูลที่จัดเก็บ

## ทำไมจึงมีระบบจัดเก็บสองระบบ

runtime ใช้กลไกการบันทึกถาวรสองแบบสำหรับรูปแบบข้อมูลที่แตกต่างกัน:

- **Content-addressed blobs** (`blob:sha256:<hash>`): การจัดเก็บระดับ global แบบไบนารี ใช้เพื่อแยก payload base64 ของรูปภาพขนาดใหญ่ออกจาก session entry ที่ถูกบันทึก
- **Session-scoped artifacts** (ไฟล์ภายใต้ `<sessionFile-without-.jsonl>/`): ไฟล์ข้อความต่อ session ใช้สำหรับ tool output เต็มรูปแบบและ subagent output

ทั้งสองระบบถูกแยกออกจากกันโดยตั้งใจ:

- blob storage เพิ่มประสิทธิภาพการ deduplicate และการอ้างอิงที่เสถียรด้วย content hash
- artifact storage เพิ่มประสิทธิภาพ tooling แบบ append-only ของ session และการเรียกดูโดยมนุษย์/tool ด้วย local ID

## ขอบเขตการจัดเก็บและ layout บนดิสก์

## ขอบเขต Blob store (global)

`SessionManager` สร้าง `BlobStore(getBlobsDir())` ดังนั้นไฟล์ blob จะอยู่ในไดเรกทอรี blob ที่ใช้ร่วมกันระดับ global (ไม่ได้อยู่ในโฟลเดอร์ session)

การตั้งชื่อไฟล์ blob:

- เส้นทางไฟล์: `<blobsDir>/<sha256-hex>`
- ไม่มีนามสกุล
- สตริงอ้างอิงที่เก็บใน entry: `blob:sha256:<sha256-hex>`

นัยสำคัญ:

- เนื้อหาไบนารีเดียวกันข้าม session จะแปลงเป็น hash/path เดียวกัน
- การเขียนเป็น idempotent ในระดับเนื้อหา
- blob สามารถอยู่ได้นานกว่าไฟล์ session แต่ละไฟล์

## ขอบเขต Artifact (local ต่อ session)

`ArtifactManager` สร้างไดเรกทอรี artifact จากเส้นทางไฟล์ session:

- ไฟล์ session: `.../<timestamp>_<sessionId>.jsonl`
- ไดเรกทอรี artifacts: `.../<timestamp>_<sessionId>/` (ตัด `.jsonl` ออก)

ประเภท artifact ใช้ไดเรกทอรีร่วมกัน:

- ไฟล์ tool output ที่ถูกตัดทอน: `<numericId>.<toolType>.log` (สำหรับ `artifact://`)
- ไฟล์ subagent output: `<outputId>.md` (สำหรับ `agent://`)

## รูปแบบการจัดสรร ID และชื่อ

## Blob ID: content hash

`BlobStore.put()` คำนวณ SHA-256 จากข้อมูลไบนารีดิบและคืนค่า:

- `hash`: hex digest
- `path`: `<blobsDir>/<hash>`
- `ref`: `blob:sha256:<hash>`

ไม่ใช้ตัวนับเฉพาะ session

## Artifact ID: จำนวนเต็มเรียงลำดับเฉพาะ session

`ArtifactManager` สแกนไฟล์ artifact `*.log` ที่มีอยู่เมื่อใช้งานครั้งแรกเพื่อหา ID ตัวเลขสูงสุดที่มีอยู่ และตั้ง `nextId = max + 1`

พฤติกรรมการจัดสรร:

- รูปแบบไฟล์: `{id}.{toolType}.log`
- ID เป็นสตริงเรียงลำดับ (`"0"`, `"1"`, ...)
- การ resume ไม่เขียนทับ artifact ที่มีอยู่เพราะการสแกนเกิดขึ้นก่อนการจัดสรร

หากไดเรกทอรี artifact ไม่มีอยู่ การสแกนจะได้รายการว่างและการจัดสรรเริ่มจาก `0`

## Agent output ID (`agent://`)

`AgentOutputManager` จัดสรร ID สำหรับ subagent output เป็น `<index>-<requestedId>` (อาจซ้อนอยู่ภายใต้ prefix หลัก เช่น `0-Parent.1-Child`) ระบบจะสแกนไฟล์ `.md` ที่มีอยู่เมื่อเริ่มต้นเพื่อดำเนินการต่อจาก index ถัดไปเมื่อ resume

## กระแสข้อมูลการบันทึกถาวร

## 1) เส้นทางการเขียนซ้ำการบันทึก session entry

ก่อนที่ session entry จะถูกเขียน (`#rewriteFile` / incremental persist), `SessionManager` เรียก `prepareEntryForPersistence()` (ผ่าน `truncateForPersistence`)

พฤติกรรมหลัก:

1. **การตัดทอนสตริงขนาดใหญ่**: สตริงที่เกินขนาดจะถูกตัดและต่อท้ายด้วย `"[Session persistence truncated large content]"`
2. **การลบฟิลด์ชั่วคราว**: `partialJson` และ `jsonlEvents` จะถูกลบออกจาก entry ที่ถูกบันทึก
3. **การแยกรูปภาพไปยัง blob**:
   - ใช้เฉพาะกับ image block ในอาร์เรย์ `content`
   - เฉพาะเมื่อ `data` ยังไม่เป็น blob ref
   - เฉพาะเมื่อความยาว base64 ถึงเกณฑ์ขั้นต่ำ (`BLOB_EXTERNALIZE_THRESHOLD = 1024`)
   - แทนที่ base64 แบบ inline ด้วย `blob:sha256:<hash>`

สิ่งนี้ทำให้ session JSONL กระชับในขณะที่ยังคงสามารถกู้คืนได้

## 2) เส้นทางการ rehydrate เมื่อโหลด session

เมื่อเปิด session (`setSessionFile`) หลังจาก migration, `SessionManager` จะรัน `resolveBlobRefsInEntries()`

สำหรับแต่ละ image block ของ message/custom-message ที่มี `blob:sha256:<hash>`:

- อ่านข้อมูลไบต์ blob จาก blob store
- แปลงไบต์กลับเป็น base64
- แก้ไข entry ในหน่วยความจำเพื่อ inline base64 สำหรับ consumer ของ runtime

หาก blob หายไป:

- `resolveImageData()` บันทึกคำเตือน
- คืนค่าสตริง ref เดิมโดยไม่เปลี่ยนแปลง
- การโหลดดำเนินต่อ (ไม่ crash)

## 3) เส้นทางการ spill/ตัดทอน tool output

`OutputSink` ขับเคลื่อนการ stream output ใน bash/python/ssh และ executor ที่เกี่ยวข้อง

พฤติกรรม:

1. ทุก chunk จะถูก sanitize และเพิ่มเข้า tail buffer ในหน่วยความจำ
2. เมื่อไบต์ในหน่วยความจำเกินเกณฑ์ spill (`DEFAULT_MAX_BYTES`, 50KB) sink จะทำเครื่องหมาย output ว่าถูกตัดทอน
3. หากมี artifact path พร้อมใช้งาน sink จะเปิด file writer และเขียน:
   - เนื้อหาที่ buffer ไว้ทั้งหมดหนึ่งครั้ง
   - chunk ที่ตามมาทั้งหมด
4. buffer ในหน่วยความจำจะถูกตัดเหลือเฉพาะ tail window สำหรับการแสดงผลเสมอ
5. `dump()` คืนค่าสรุปที่รวม `artifactId` เฉพาะเมื่อ file sink ถูกสร้างสำเร็จ

ผลในทางปฏิบัติ:

- UI/tool return แสดง tail ที่ถูกตัดทอน
- output เต็มรูปแบบถูกเก็บในไฟล์ artifact และอ้างอิงเป็น `artifact://<id>`

หากการสร้าง file sink ล้มเหลว (ข้อผิดพลาด I/O, เส้นทางหายไป ฯลฯ) sink จะ fallback เป็นการตัดทอนเฉพาะ tail ในหน่วยความจำโดยไม่แจ้งเตือน; output เต็มรูปแบบจะไม่ถูกบันทึก

## โมเดลการเข้าถึง URL

## การอ้างอิง `blob:`

`blob:sha256:<hash>` เป็นการอ้างอิงสำหรับการบันทึกถาวรภายใน payload ของ session entry ไม่ใช่ URL scheme ภายในที่จัดการโดย router การแปลงกลับดำเนินการโดย `SessionManager` ระหว่างการโหลด session

## `artifact://<id>`

จัดการโดย `ArtifactProtocolHandler`:

- ต้องมีไดเรกทอรี artifact ของ session ที่ active อยู่
- ID ต้องเป็นตัวเลข
- แปลงกลับโดยจับคู่ filename prefix `<id>.`
- คืนค่าข้อความดิบ (`text/plain`) จากไฟล์ `.log` ที่ตรงกัน
- เมื่อไม่พบ ข้อผิดพลาดจะรวมรายการ artifact ID ที่มีอยู่

พฤติกรรมเมื่อไดเรกทอรีหายไป:

- หากไดเรกทอรี artifacts ไม่มีอยู่ จะ throw `No artifacts directory found`

## `agent://<id>`

จัดการโดย `AgentProtocolHandler` ผ่าน `<artifactsDir>/<id>.md`:

- รูปแบบธรรมดาคืนค่าข้อความ markdown
- รูปแบบ `/path` หรือ `?q=` ดำเนินการ JSON extraction
- path และ query extraction ไม่สามารถใช้ร่วมกันได้
- หากมีการร้องขอ extraction เนื้อหาไฟล์ต้อง parse ได้เป็น JSON

พฤติกรรมเมื่อไดเรกทอรีหายไป:

- throw `No artifacts directory found`

พฤติกรรมเมื่อ output หายไป:

- throw `Not found: <id>` พร้อม ID ที่มีอยู่จากไฟล์ `.md` ที่มี

การรวมกับ read tool:

- `read` รองรับ pagination ด้วย offset/limit สำหรับการอ่าน internal URL ที่ไม่ใช่ extraction
- ปฏิเสธ `offset/limit` เมื่อใช้ `agent://` extraction

## ความหมายของ Resume, Fork และ Move

## Resume

- `ArtifactManager` สแกนไฟล์ `{id}.*.log` ที่มีอยู่เมื่อจัดสรรครั้งแรกและดำเนินการนับต่อ
- `AgentOutputManager` สแกน output ID `.md` ที่มีอยู่และดำเนินการนับต่อ
- `SessionManager` rehydrate blob ref เป็น base64 เมื่อโหลด

## Fork

`SessionManager.fork()` สร้างไฟล์ session ใหม่พร้อม session ID ใหม่และลิงก์ `parentSession` จากนั้นคืนค่าเส้นทางไฟล์เก่า/ใหม่ การคัดลอก artifact จัดการโดย `AgentSession.fork()`:

- พยายามคัดลอกแบบ recursive ของไดเรกทอรี artifact เก่าไปยังไดเรกทอรี artifact ใหม่
- ยอมรับกรณีไดเรกทอรีเก่าหายไป
- ข้อผิดพลาดการคัดลอกที่ไม่ใช่ ENOENT จะถูกบันทึกเป็นคำเตือนและ fork ยังคงเสร็จสมบูรณ์

นัยสำคัญของ ID หลัง fork:

- หากการคัดลอกสำเร็จ ตัวนับ artifact ใน session ใหม่จะดำเนินต่อหลังจาก max ID ที่คัดลอกมา
- หากการคัดลอกล้มเหลว/ข้ามไป ID artifact ของ session ใหม่เริ่มจาก `0`

นัยสำคัญของ Blob หลัง fork:

- blob เป็น global และ content-addressed ดังนั้นไม่จำเป็นต้องคัดลอกไดเรกทอรี blob

## การย้ายไปยัง cwd ใหม่

`SessionManager.moveTo()` เปลี่ยนชื่อทั้งไฟล์ session และไดเรกทอรี artifact ไปยังไดเรกทอรี session เริ่มต้นใหม่ พร้อมตรรกะ rollback หากขั้นตอนถัดไปล้มเหลว สิ่งนี้รักษาอัตลักษณ์ของ artifact ในขณะที่ย้ายขอบเขตของ session

## การจัดการข้อผิดพลาดและเส้นทาง fallback

| กรณี | พฤติกรรม |
| --- | --- |
| ไฟล์ blob หายไประหว่าง rehydration | แจ้งเตือนและเก็บสตริง `blob:sha256:` ref ไว้ในหน่วยความจำ |
| อ่าน blob ENOENT ผ่าน `BlobStore.get` | คืนค่า `null` |
| ไดเรกทอรี artifact หายไป (`ArtifactManager.listFiles`) | คืนค่ารายการว่าง (การจัดสรรสามารถเริ่มใหม่ได้) |
| ไดเรกทอรี artifact หายไป (`artifact://` / `agent://`) | Throw `No artifacts directory found` อย่างชัดเจน |
| ไม่พบ Artifact ID | Throw พร้อมรายการ ID ที่มีอยู่ |
| การเริ่มต้น artifact writer ของ OutputSink ล้มเหลว | ดำเนินต่อด้วยการตัดทอนเฉพาะ tail (ไม่มี artifact แบบ full-output) |
| ไม่มีไฟล์ session (บาง task path) | Task tool fallback ไปยังไดเรกทอรี artifacts ชั่วคราวสำหรับ subagent output |

## Binary blob externalization เทียบกับ text-output artifact

- **Blob externalization** มีไว้สำหรับ payload รูปภาพไบนารีภายในเนื้อหา session entry ที่ถูกบันทึก; มันแทนที่ base64 แบบ inline ใน JSONL ด้วย content ref ที่เสถียร
- **Artifacts** เป็นไฟล์ข้อความธรรมดาสำหรับ execution output และ subagent output; สามารถเข้าถึงได้ด้วย ID เฉพาะ session ผ่าน URL ภายใน

ทั้งสองระบบเชื่อมโยงกันโดยอ้อมเท่านั้น (ทั้งสองลดการบวมของ session JSONL) แต่มีอัตลักษณ์ อายุการใช้งาน และเส้นทางการเรียกดูที่แตกต่างกัน

## ไฟล์ implementation

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — รูปแบบ blob reference, hashing, put/get, helper สำหรับ externalize/resolve
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — โมเดลไดเรกทอรี session artifact และการจัดสรร numeric artifact ID
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — พฤติกรรมการตัดทอน/spill-to-file ของ `OutputSink` และ metadata สรุป
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — การแปลงสำหรับการบันทึกถาวร, blob rehydration เมื่อโหลด, ปฏิสัมพันธ์ของ session fork/move
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — การคัดลอกไดเรกทอรี artifact ระหว่าง interactive fork
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — การ bootstrap tool artifact manager และการจัดสรร artifact path ต่อ tool
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://` resolver
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — `agent://` resolver + JSON extraction
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — การเชื่อมต่อ internal URL router และ artifacts-dir resolver
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — การจัดสรร agent output ID เฉพาะ session สำหรับ `agent://`
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — การเขียน subagent output artifact (`<id>.md`) และ fallback ไดเรกทอรี artifact ชั่วคราว
