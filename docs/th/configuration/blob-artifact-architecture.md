---
title: สถาปัตยกรรม Blob และการจัดเก็บ Artifact
description: >-
  ที่เก็บ blob แบบ content-addressable และ registry ของ artifact
  สำหรับสื่อในเซสชัน ภาพหน้าจอ และผลลัพธ์จากเครื่องมือ
sidebar:
  order: 7
  label: การจัดเก็บ Blob และ Artifact
i18n:
  sourceHash: 70d255f48d5b
  translator: machine
---

# สถาปัตยกรรมการจัดเก็บ Blob และ Artifact

เอกสารนี้อธิบายวิธีที่ coding-agent จัดเก็บ payload ขนาดใหญ่/ไบนารีไว้ภายนอก session JSONL วิธีที่ผลลัพธ์ของเครื่องมือที่ถูกตัดทอนได้รับการบันทึก และวิธีที่ URL ภายใน (`artifact://`, `agent://`) แก้ไขกลับไปยังข้อมูลที่จัดเก็บไว้

## เหตุใดจึงมีระบบจัดเก็บสองระบบ

รันไทม์ใช้กลไกการบันทึกข้อมูลสองแบบที่แตกต่างกันสำหรับรูปแบบข้อมูลที่ต่างกัน:

- **Blob แบบ content-addressed** (`blob:sha256:<hash>`): พื้นที่จัดเก็บแบบไบนารีที่ใช้งานร่วมกันทั่วโลก ใช้เพื่อนำ payload base64 ของรูปภาพขนาดใหญ่ออกจากรายการเซสชันที่บันทึกไว้
- **Artifact แบบ session-scoped** (ไฟล์ภายใต้ `<sessionFile-without-.jsonl>/`): ไฟล์ข้อความต่อเซสชันสำหรับผลลัพธ์เครื่องมือฉบับสมบูรณ์และผลลัพธ์ของ subagent

ทั้งสองระบบถูกแยกออกจากกันโดยตั้งใจ:

- การจัดเก็บ blob เพิ่มประสิทธิภาพการลดความซ้ำซ้อนและการอ้างอิงที่เสถียรตาม content hash
- การจัดเก็บ artifact เพิ่มประสิทธิภาพการใช้เครื่องมือเซสชันแบบ append-only และการเรียกคืนโดยมนุษย์/เครื่องมือผ่าน ID ในเครื่อง

## ขอบเขตการจัดเก็บและโครงสร้างบนดิสก์

## ขอบเขต Blob Store (ทั่วโลก)

`SessionManager` สร้าง `BlobStore(getBlobsDir())` ดังนั้นไฟล์ blob จึงอยู่ในไดเรกทอรี blob ทั่วโลกที่ใช้ร่วมกัน (ไม่ใช่ในโฟลเดอร์เซสชัน)

การตั้งชื่อไฟล์ Blob:

- เส้นทางไฟล์: `<blobsDir>/<sha256-hex>`
- ไม่มีนามสกุล
- สตริงอ้างอิงที่จัดเก็บในรายการ: `blob:sha256:<sha256-hex>`

ผลที่ตามมา:

- เนื้อหาไบนารีเดียวกันข้ามเซสชันจะแก้ไขไปยัง hash/path เดียวกัน
- การเขียนเป็น idempotent ที่ระดับเนื้อหา
- blob สามารถมีอายุยืนยาวกว่าไฟล์เซสชันใด ๆ ก็ได้

## ขอบเขต Artifact (ในเครื่อง session)

`ArtifactManager` กำหนดไดเรกทอรี artifact จากเส้นทางไฟล์เซสชัน:

- ไฟล์เซสชัน: `.../<timestamp>_<sessionId>.jsonl`
- ไดเรกทอรี artifact: `.../<timestamp>_<sessionId>/` (ตัด `.jsonl` ออก)

ประเภท artifact ใช้ไดเรกทอรีนี้ร่วมกัน:

- ไฟล์ผลลัพธ์เครื่องมือที่ถูกตัดทอน: `<numericId>.<toolType>.log` (สำหรับ `artifact://`)
- ไฟล์ผลลัพธ์ subagent: `<outputId>.md` (สำหรับ `agent://`)

## รูปแบบการจัดสรร ID และชื่อ

## Blob ID: Content Hash

`BlobStore.put()` คำนวณ SHA-256 จากไบต์ไบนารีดิบและคืนค่า:

- `hash`: hex digest
- `path`: `<blobsDir>/<hash>`
- `ref`: `blob:sha256:<hash>`

ไม่มีการใช้ตัวนับในเครื่องของเซสชัน

## Artifact ID: จำนวนเต็มแบบ monotonic ในเครื่อง session

`ArtifactManager` สแกนไฟล์ artifact `*.log` ที่มีอยู่ในการใช้งานครั้งแรกเพื่อหา ID ตัวเลขสูงสุดที่มีอยู่และตั้งค่า `nextId = max + 1`

พฤติกรรมการจัดสรร:

- รูปแบบไฟล์: `{id}.{toolType}.log`
- ID เป็นสตริงที่ต่อเนื่องกัน (`"0"`, `"1"`, ...)
- การเริ่มต้นใหม่จะไม่เขียนทับ artifact ที่มีอยู่เพราะการสแกนเกิดขึ้นก่อนการจัดสรร

หากไดเรกทอรี artifact หายไป การสแกนจะได้รายการว่างและการจัดสรรเริ่มจาก `0`

## Agent Output ID (`agent://`)

`AgentOutputManager` จัดสรร ID สำหรับผลลัพธ์ subagent เป็น `<index>-<requestedId>` (อาจซ้อนภายใต้ prefix ของ parent เช่น `0-Parent.1-Child`) โดยสแกนไฟล์ `.md` ที่มีอยู่เมื่อเริ่มต้นเพื่อดำเนินต่อจาก index ถัดไปเมื่อเริ่มใหม่

## กระบวนการไหลของการบันทึกข้อมูล

## 1) เส้นทางการเขียนซ้ำการบันทึกรายการเซสชัน

ก่อนที่รายการเซสชันจะถูกเขียน (`#rewriteFile` / การบันทึกแบบ incremental) `SessionManager` จะเรียก `prepareEntryForPersistence()` (ผ่าน `truncateForPersistence`)

พฤติกรรมหลัก:

1. **การตัดทอนสตริงขนาดใหญ่**: สตริงที่มีขนาดเกินกำหนดจะถูกตัดและต่อท้ายด้วย `"[Session persistence truncated large content]"`
2. **การลบฟิลด์ชั่วคราว**: `partialJson` และ `jsonlEvents` จะถูกลบออกจากรายการที่บันทึก
3. **การนำรูปภาพออกไปจัดเก็บใน blob**:
   - ใช้กับบล็อกรูปภาพใน arrays `content` เท่านั้น
   - เฉพาะเมื่อ `data` ยังไม่เป็น blob ref
   - เฉพาะเมื่อความยาว base64 มากกว่าหรือเท่ากับเกณฑ์ (`BLOB_EXTERNALIZE_THRESHOLD = 1024`)
   - แทนที่ inline base64 ด้วย `blob:sha256:<hash>`

ซึ่งทำให้ session JSONL กะทัดรัดในขณะที่ยังคงความสามารถในการกู้คืน

## 2) เส้นทางการ rehydrate เมื่อโหลดเซสชัน

เมื่อเปิดเซสชัน (`setSessionFile`) หลังจาก migration `SessionManager` จะรัน `resolveBlobRefsInEntries()`

สำหรับแต่ละบล็อกรูปภาพ message/custom-message ที่มี `blob:sha256:<hash>`:

- อ่านไบต์ blob จาก blob store
- แปลงไบต์กลับเป็น base64
- แก้ไขรายการในหน่วยความจำเพื่อ inline base64 สำหรับผู้ใช้งานรันไทม์

หาก blob หายไป:

- `resolveImageData()` บันทึกคำเตือน
- คืนสตริง ref เดิมโดยไม่เปลี่ยนแปลง
- การโหลดดำเนินต่อไป (ไม่มีการหยุดทำงานอย่างฉับพลัน)

## 3) เส้นทางการ spill/truncation ของผลลัพธ์เครื่องมือ

`OutputSink` ขับเคลื่อนการสตรีมผลลัพธ์ใน bash/python/ssh และ executor ที่เกี่ยวข้อง

พฤติกรรม:

1. ทุก chunk จะถูกทำความสะอาดและเพิ่มต่อท้ายบัฟเฟอร์ tail ในหน่วยความจำ
2. เมื่อไบต์ในหน่วยความจำเกินเกณฑ์ spill (`DEFAULT_MAX_BYTES`, 50KB) sink จะทำเครื่องหมายว่าผลลัพธ์ถูกตัดทอน
3. หากมีเส้นทาง artifact sink จะเปิด file writer และเขียน:
   - เนื้อหาที่บัฟเฟอร์ไว้หนึ่งครั้ง
   - chunk ที่ตามมาทั้งหมด
4. บัฟเฟอร์ในหน่วยความจำจะถูกตัดให้พอดีกับ tail window เสมอเพื่อการแสดงผล
5. `dump()` คืนค่าสรุปที่รวม `artifactId` เฉพาะเมื่อ file sink ถูกสร้างสำเร็จ

ผลในทางปฏิบัติ:

- UI/tool return แสดง tail ที่ถูกตัดทอน
- ผลลัพธ์ฉบับสมบูรณ์ถูกเก็บในไฟล์ artifact และอ้างอิงเป็น `artifact://<id>`

หากการสร้าง file sink ล้มเหลว (ข้อผิดพลาด I/O, เส้นทางหายไป ฯลฯ) sink จะถอยกลับไปใช้การตัดทอนในหน่วยความจำอย่างเดียวโดยไม่แสดงข้อผิดพลาด โดยผลลัพธ์ฉบับสมบูรณ์จะไม่ถูกบันทึก

## โมเดลการเข้าถึง URL

## การอ้างอิง `blob:`

`blob:sha256:<hash>` คือการอ้างอิงการบันทึกข้อมูลภายใน payload ของรายการเซสชัน ไม่ใช่รูปแบบ URL ภายในที่จัดการโดย router การแก้ไขทำโดย `SessionManager` ระหว่างการโหลดเซสชัน

## `artifact://<id>`

จัดการโดย `ArtifactProtocolHandler`:

- ต้องมีไดเรกทอรี artifact ของเซสชันที่ทำงานอยู่
- ID ต้องเป็นตัวเลข
- แก้ไขโดยการจับคู่ prefix ชื่อไฟล์ `<id>.`
- คืนข้อความดิบ (`text/plain`) จากไฟล์ `.log` ที่ตรงกัน
- เมื่อหาไม่พบ ข้อผิดพลาดจะรวม artifact ID ที่มีอยู่

พฤติกรรมเมื่อไดเรกทอรีหายไป:

- หากไดเรกทอรี artifact ไม่มีอยู่ จะส่ง exception `No artifacts directory found`

## `agent://<id>`

จัดการโดย `AgentProtocolHandler` ผ่าน `<artifactsDir>/<id>.md`:

- รูปแบบปกติคืนข้อความ markdown
- รูปแบบ `/path` หรือ `?q=` ทำการ JSON extraction
- ไม่สามารถใช้ path และ query extraction พร้อมกันได้
- หากมีการร้องขอ extraction เนื้อหาไฟล์ต้องแปลงเป็น JSON ได้

พฤติกรรมเมื่อไดเรกทอรีหายไป:

- ส่ง exception `No artifacts directory found`

พฤติกรรมเมื่อผลลัพธ์หายไป:

- ส่ง exception `Not found: <id>` พร้อมรายการ ID ที่มีอยู่จากไฟล์ `.md` ที่มีอยู่

การผสานรวม read tool:

- `read` รองรับการแบ่งหน้าด้วย offset/limit สำหรับการอ่าน URL ภายในที่ไม่ใช่ extraction
- ปฏิเสธ `offset/limit` เมื่อใช้ `agent://` extraction

## ความหมายของ Resume, Fork และ Move

## Resume

- `ArtifactManager` สแกนไฟล์ `{id}.*.log` ที่มีอยู่เมื่อจัดสรรครั้งแรกและดำเนินการนับต่อ
- `AgentOutputManager` สแกน ID ผลลัพธ์ `.md` ที่มีอยู่และดำเนินการนับต่อ
- `SessionManager` rehydrate blob ref ไปเป็น base64 เมื่อโหลด

## Fork

`SessionManager.fork()` สร้างไฟล์เซสชันใหม่พร้อม session ID ใหม่และ link `parentSession` จากนั้นคืนเส้นทางไฟล์เก่า/ใหม่ การคัดลอก artifact จัดการโดย `AgentSession.fork()`:

- พยายามคัดลอก recursive ของไดเรกทอรี artifact เก่าไปยังไดเรกทอรี artifact ใหม่
- ยอมรับกรณีที่ไดเรกทอรีเก่าหายไป
- ข้อผิดพลาดในการคัดลอกที่ไม่ใช่ ENOENT จะถูกบันทึกเป็นคำเตือนและ fork ยังคงสำเร็จ

ผลกระทบต่อ ID หลัง fork:

- หากคัดลอกสำเร็จ ตัวนับ artifact ในเซสชันใหม่จะดำเนินต่อหลังจาก ID สูงสุดที่คัดลอกมา
- หากคัดลอกล้มเหลว/ข้าม artifact ID ของเซสชันใหม่จะเริ่มจาก `0`

ผลกระทบต่อ Blob หลัง fork:

- blob เป็น global และ content-addressed ดังนั้นจึงไม่จำเป็นต้องคัดลอกไดเรกทอรี blob

## ย้ายไปยัง cwd ใหม่

`SessionManager.moveTo()` เปลี่ยนชื่อทั้งไฟล์เซสชันและไดเรกทอรี artifact ไปยังไดเรกทอรีเซสชันเริ่มต้นใหม่ พร้อมตรรกะ rollback หากขั้นตอนถัดไปล้มเหลว ซึ่งช่วยรักษา artifact identity ขณะย้าย session scope

## การจัดการความล้มเหลวและเส้นทางสำรอง

| กรณี | พฤติกรรม |
| --- | --- |
| ไม่พบไฟล์ blob ระหว่าง rehydration | เตือนและเก็บสตริง `blob:sha256:` ref ไว้ในหน่วยความจำ |
| อ่าน Blob ENOENT ผ่าน `BlobStore.get` | คืนค่า `null` |
| ไดเรกทอรี artifact หายไป (`ArtifactManager.listFiles`) | คืนรายการว่าง (การจัดสรรสามารถเริ่มใหม่ได้) |
| ไดเรกทอรี artifact หายไป (`artifact://` / `agent://`) | ส่ง exception `No artifacts directory found` อย่างชัดเจน |
| ไม่พบ Artifact ID | ส่ง exception พร้อมรายการ ID ที่มีอยู่ |
| การเริ่มต้น artifact writer ของ OutputSink ล้มเหลว | ดำเนินต่อด้วยการตัดทอนแบบ tail เท่านั้น (ไม่มี artifact ผลลัพธ์ฉบับสมบูรณ์) |
| ไม่มีไฟล์เซสชัน (เส้นทาง task บางส่วน) | task tool ถอยกลับไปใช้ไดเรกทอรี artifact ชั่วคราวสำหรับผลลัพธ์ subagent |

## การนำ Binary Blob ออกจัดเก็บเทียบกับ Text-Output Artifact

- **Blob externalization** สำหรับ payload รูปภาพไบนารีภายในเนื้อหารายการเซสชันที่บันทึก โดยแทนที่ inline base64 ใน JSONL ด้วยการอ้างอิงเนื้อหาที่เสถียร
- **Artifact** คือไฟล์ข้อความสำหรับผลลัพธ์การประมวลผลและผลลัพธ์ subagent สามารถระบุที่อยู่ได้ด้วย ID ในเครื่องของเซสชันผ่าน URL ภายใน

ทั้งสองระบบมีจุดตัดกันโดยอ้อมเท่านั้น (ทั้งคู่ช่วยลดความเทอะทะของ session JSONL) แต่มีเส้นทาง identity, lifetime และการเรียกคืนที่แตกต่างกัน

## ไฟล์การนำไปใช้งาน

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — รูปแบบการอ้างอิง blob, การ hashing, put/get, helpers สำหรับ externalize/resolve
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — โมเดลไดเรกทอรี artifact ของเซสชันและการจัดสรร artifact ID แบบตัวเลข
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — พฤติกรรมการตัดทอน/spill-to-file ของ `OutputSink` และ metadata สรุป
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — การแปลงข้อมูลสำหรับการบันทึก, blob rehydration เมื่อโหลด, การโต้ตอบ session fork/move
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — การคัดลอกไดเรกทอรี artifact ระหว่าง interactive fork
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — การบูตสแตรป artifact manager ของเครื่องมือและการจัดสรรเส้นทาง artifact ต่อเครื่องมือ
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — resolver สำหรับ `artifact://`
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — resolver สำหรับ `agent://` + JSON extraction
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — การเดินสาย router URL ภายในและ resolver ไดเรกทอรี artifacts
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — การจัดสรร agent output ID แบบ session-scoped สำหรับ `agent://`
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — การเขียน artifact ผลลัพธ์ subagent (`<id>.md`) และ fallback ไดเรกทอรี artifact ชั่วคราว
