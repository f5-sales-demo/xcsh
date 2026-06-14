---
title: สถาปัตยกรรม Blob และการจัดเก็บ Artifact
description: >-
  ที่เก็บ blob แบบ content-addressable และ artifact registry สำหรับสื่อในเซสชัน
  ภาพหน้าจอ และผลลัพธ์จากเครื่องมือ
sidebar:
  order: 7
  label: การจัดเก็บ Blob และ Artifact
i18n:
  sourceHash: 70d255f48d5b
  translator: machine
---

# สถาปัตยกรรมการจัดเก็บ Blob และ Artifact

เอกสารนี้อธิบายวิธีที่ coding-agent จัดเก็บ payload ขนาดใหญ่/ไบนารีนอกเซสชัน JSONL วิธีที่ผลลัพธ์ของเครื่องมือที่ถูกตัดทอนได้รับการบันทึก และวิธีที่ URL ภายใน (`artifact://`, `agent://`) แปลงกลับไปยังข้อมูลที่จัดเก็บไว้

## เหตุผลที่มีระบบจัดเก็บข้อมูลสองระบบ

รันไทม์ใช้กลไกการจัดเก็บข้อมูลสองแบบที่แตกต่างกันสำหรับรูปแบบข้อมูลที่ต่างกัน:

- **Content-addressed blobs** (`blob:sha256:<hash>`): ที่เก็บข้อมูลทั่วไปแบบเน้นไบนารี ใช้สำหรับแยก payload base64 ของภาพขนาดใหญ่ออกจาก session entry ที่บันทึกไว้
- **Session-scoped artifacts** (ไฟล์ภายใต้ `<sessionFile-without-.jsonl>/`): ไฟล์ข้อความแบบ per-session ที่ใช้สำหรับผลลัพธ์ของเครื่องมือแบบเต็มและผลลัพธ์ของ subagent

ทั้งสองระบบถูกแยกออกจากกันอย่างตั้งใจ:

- blob storage ปรับปรุงการ deduplication และการอ้างอิงที่เสถียรตาม content hash
- artifact storage ปรับปรุงเครื่องมือในเซสชันแบบ append-only และการดึงข้อมูลโดยมนุษย์/เครื่องมือผ่าน local ID

## ขอบเขตการจัดเก็บและโครงสร้างบนดิสก์

## ขอบเขต Blob Store (ทั่วไป)

`SessionManager` สร้าง `BlobStore(getBlobsDir())` ดังนั้นไฟล์ blob จึงอยู่ในไดเรกทอรี blob ทั่วไปที่ใช้ร่วมกัน (ไม่ใช่ในโฟลเดอร์ session)

การตั้งชื่อไฟล์ Blob:

- เส้นทางไฟล์: `<blobsDir>/<sha256-hex>`
- ไม่มีนามสกุล
- สตริงอ้างอิงที่จัดเก็บใน entry: `blob:sha256:<sha256-hex>`

ผลที่ตามมา:

- เนื้อหาไบนารีเดียวกันในหลายเซสชันจะแปลงเป็น hash/path เดียวกัน
- การเขียนเป็น idempotent ในระดับเนื้อหา
- blobs สามารถมีอายุยืนนานกว่าไฟล์ session แต่ละไฟล์

## ขอบเขต Artifact (เฉพาะ session)

`ArtifactManager` ดึงไดเรกทอรี artifact จากเส้นทางไฟล์ session:

- ไฟล์ session: `.../<timestamp>_<sessionId>.jsonl`
- ไดเรกทอรี artifacts: `.../<timestamp>_<sessionId>/` (ตัด `.jsonl` ออก)

ประเภท artifact ใช้ไดเรกทอรีนี้ร่วมกัน:

- ไฟล์ผลลัพธ์เครื่องมือที่ถูกตัดทอน: `<numericId>.<toolType>.log` (สำหรับ `artifact://`)
- ไฟล์ผลลัพธ์ subagent: `<outputId>.md` (สำหรับ `agent://`)

## รูปแบบการจัดสรร ID และชื่อ

## Blob ID: content hash

`BlobStore.put()` คำนวณ SHA-256 เหนือ raw binary bytes และส่งคืน:

- `hash`: hex digest
- `path`: `<blobsDir>/<hash>`
- `ref`: `blob:sha256:<hash>`

ไม่มีการใช้ตัวนับแบบ session-local

## Artifact ID: จำนวนเต็มเชิงเดียวแบบ session-local

`ArtifactManager` สแกนไฟล์ artifact `*.log` ที่มีอยู่เมื่อใช้งานครั้งแรก เพื่อหา numeric ID สูงสุดที่มีอยู่ และตั้ง `nextId = max + 1`

พฤติกรรมการจัดสรร:

- รูปแบบไฟล์: `{id}.{toolType}.log`
- ID เป็นสตริงแบบลำดับ (`"0"`, `"1"`, ...)
- การ resume ไม่เขียนทับ artifact ที่มีอยู่เพราะการสแกนเกิดขึ้นก่อนการจัดสรร

หากไดเรกทอรี artifact หายไป การสแกนจะได้รายการว่างและการจัดสรรจะเริ่มจาก `0`

## Agent output ID (`agent://`)

`AgentOutputManager` จัดสรร ID สำหรับผลลัพธ์ subagent เป็น `<index>-<requestedId>` (อาจซ้อนภายใต้ parent prefix เช่น `0-Parent.1-Child`) โดยสแกนไฟล์ `.md` ที่มีอยู่เมื่อเริ่มต้นเพื่อต่อจาก index ถัดไปเมื่อ resume

## กระบวนการส่งต่อข้อมูลสำหรับการบันทึก

## 1) เส้นทางการเขียนซ้ำการบันทึก Session entry

ก่อนที่ session entry จะถูกเขียน (`#rewriteFile` / incremental persist) `SessionManager` จะเรียก `prepareEntryForPersistence()` (ผ่าน `truncateForPersistence`)

พฤติกรรมสำคัญ:

1. **การตัดทอนสตริงขนาดใหญ่**: สตริงที่มีขนาดเกินจะถูกตัดและเพิ่มต่อท้ายด้วย `"[Session persistence truncated large content]"`
2. **การลบฟิลด์ชั่วคราว**: `partialJson` และ `jsonlEvents` จะถูกลบออกจาก entry ที่บันทึก
3. **การแยก image ออกสู่ blobs**:
   - ใช้กับ image block ใน `content` array เท่านั้น
   - เฉพาะเมื่อ `data` ไม่ใช่ blob ref อยู่แล้ว
   - เฉพาะเมื่อความยาว base64 มากกว่าหรือเท่ากับ threshold (`BLOB_EXTERNALIZE_THRESHOLD = 1024`)
   - แทนที่ inline base64 ด้วย `blob:sha256:<hash>`

สิ่งนี้ช่วยให้ session JSONL กระชับในขณะที่รักษาความสามารถในการกู้คืน

## 2) เส้นทางการ rehydration เมื่อโหลด session

เมื่อเปิดเซสชัน (`setSessionFile`) หลังจาก migration แล้ว `SessionManager` จะรัน `resolveBlobRefsInEntries()`

สำหรับแต่ละ image block ใน message/custom-message ที่มี `blob:sha256:<hash>`:

- อ่าน blob bytes จาก blob store
- แปลง bytes กลับเป็น base64
- แก้ไข in-memory entry เพื่อ inline base64 สำหรับผู้ใช้งานรันไทม์

หาก blob หายไป:

- `resolveImageData()` บันทึก warning
- ส่งคืนสตริง ref เดิมโดยไม่เปลี่ยนแปลง
- การโหลดดำเนินต่อไป (ไม่ crash แบบ hard)

## 3) เส้นทางการ spill/ตัดทอนผลลัพธ์เครื่องมือ

`OutputSink` ขับเคลื่อน streaming output ใน bash/python/ssh และ executor ที่เกี่ยวข้อง

พฤติกรรม:

1. ทุก chunk ได้รับการทำความสะอาดและต่อท้ายใน in-memory tail buffer
2. เมื่อ in-memory bytes เกิน spill threshold (`DEFAULT_MAX_BYTES`, 50KB) sink จะทำเครื่องหมายว่าผลลัพธ์ถูกตัดทอน
3. หากมี artifact path ที่ใช้งานได้ sink จะเปิด file writer และเขียน:
   - เนื้อหาที่บัฟเฟอร์ไว้อยู่แล้วครั้งเดียว
   - ทุก chunk ที่ตามมา
4. In-memory buffer จะถูกตัดให้เหลือเฉพาะ tail window สำหรับการแสดงผลเสมอ
5. `dump()` ส่งคืนสรุปรวมถึง `artifactId` เฉพาะเมื่อสร้าง file sink สำเร็จ

ผลกระทบในทางปฏิบัติ:

- UI/tool return แสดง truncated tail
- ผลลัพธ์แบบเต็มถูกบันทึกใน artifact file และอ้างอิงเป็น `artifact://<id>`

หากการสร้าง file sink ล้มเหลว (I/O error, missing path, ฯลฯ) sink จะ fallback ไปยังการตัดทอน in-memory เท่านั้น โดยไม่มีการแจ้งเตือน; ผลลัพธ์แบบเต็มจะไม่ถูกบันทึก

## รูปแบบการเข้าถึง URL

## การอ้างอิง `blob:`

`blob:sha256:<hash>` เป็น persistence reference ภายใน session entry payload ไม่ใช่ URL scheme ภายในที่ router จัดการ การแปลงทำโดย `SessionManager` ระหว่างการโหลด session

## `artifact://<id>`

จัดการโดย `ArtifactProtocolHandler`:

- ต้องการ active session artifact directory
- ID ต้องเป็นตัวเลข
- แปลงโดยการจับคู่ prefix ชื่อไฟล์ `<id>.`
- ส่งคืนข้อความดิบ (`text/plain`) จากไฟล์ `.log` ที่จับคู่ได้
- เมื่อไม่พบ error จะรวมรายการ artifact ID ที่มีอยู่

พฤติกรรมเมื่อไดเรกทอรีหายไป:

- หากไดเรกทอรี artifacts ไม่มีอยู่ จะ throw `No artifacts directory found`

## `agent://<id>`

จัดการโดย `AgentProtocolHandler` ผ่าน `<artifactsDir>/<id>.md`:

- รูปแบบ plain ส่งคืนข้อความ markdown
- รูปแบบ `/path` หรือ `?q=` ดำเนินการ JSON extraction
- ไม่สามารถใช้ path และ query extraction ร่วมกันได้
- หาก extraction ถูกร้องขอ เนื้อหาไฟล์ต้อง parse เป็น JSON ได้

พฤติกรรมเมื่อไดเรกทอรีหายไป:

- throw `No artifacts directory found`

พฤติกรรมเมื่อผลลัพธ์หายไป:

- throw `Not found: <id>` พร้อม ID ที่มีอยู่จากไฟล์ `.md` ที่มีอยู่

การผสานรวมกับเครื่องมือ read:

- `read` รองรับ offset/limit pagination สำหรับการอ่าน internal URL แบบ non-extraction
- ปฏิเสธ `offset/limit` เมื่อใช้ `agent://` extraction

## Semantics การ Resume, Fork และ Move

## Resume

- `ArtifactManager` สแกนไฟล์ `{id}.*.log` ที่มีอยู่เมื่อจัดสรรครั้งแรกและดำเนินการนับต่อ
- `AgentOutputManager` สแกน output ID จากไฟล์ `.md` ที่มีอยู่และดำเนินการนับต่อ
- `SessionManager` rehydrate blob refs เป็น base64 เมื่อโหลด

## Fork

`SessionManager.fork()` สร้างไฟล์ session ใหม่พร้อม session ID ใหม่และลิงก์ `parentSession` จากนั้นส่งคืนเส้นทางไฟล์เก่า/ใหม่ การคัดลอก artifact จัดการโดย `AgentSession.fork()`:

- พยายามคัดลอกแบบ recursive จากไดเรกทอรี artifact เก่าไปยังใหม่
- ไดเรกทอรีเก่าที่หายไปจะถูกยอมรับ
- copy error ที่ไม่ใช่ ENOENT จะถูกบันทึกเป็น warning และ fork ยังคงเสร็จสมบูรณ์

ผลกระทบต่อ ID หลัง fork:

- หากคัดลอกสำเร็จ ตัวนับ artifact ใน session ใหม่จะดำเนินต่อหลังจาก ID สูงสุดที่คัดลอกมา
- หากคัดลอกล้มเหลว/ข้าม artifact ID ของ session ใหม่จะเริ่มจาก `0`

ผลกระทบต่อ Blob หลัง fork:

- blobs เป็นแบบ global และ content-addressed ดังนั้นไม่จำเป็นต้องคัดลอกไดเรกทอรี blob

## ย้ายไปยัง cwd ใหม่

`SessionManager.moveTo()` เปลี่ยนชื่อทั้งไฟล์ session และไดเรกทอรี artifact ไปยังไดเรกทอรี session เริ่มต้นใหม่ พร้อม rollback logic หากขั้นตอนต่อมาล้มเหลว วิธีนี้รักษา artifact identity ไว้ในขณะที่ย้าย session scope

## การจัดการความล้มเหลวและเส้นทาง fallback

| กรณี | พฤติกรรม |
| --- | --- |
| ไฟล์ Blob หายไประหว่าง rehydration | แจ้ง warning และเก็บสตริง `blob:sha256:` ref ไว้ใน memory |
| Blob อ่านด้วย ENOENT ผ่าน `BlobStore.get` | ส่งคืน `null` |
| ไดเรกทอรี Artifact หายไป (`ArtifactManager.listFiles`) | ส่งคืนรายการว่าง (การจัดสรรสามารถเริ่มใหม่ได้) |
| ไดเรกทอรี Artifact หายไป (`artifact://` / `agent://`) | Throw `No artifacts directory found` อย่างชัดเจน |
| ไม่พบ Artifact ID | Throw พร้อมรายการ ID ที่มีอยู่ |
| การเริ่มต้น artifact writer ของ OutputSink ล้มเหลว | ดำเนินต่อด้วยการตัดทอน tail เท่านั้น (ไม่มี full-output artifact) |
| ไม่มีไฟล์ session (เส้นทาง task บางส่วน) | Task tool ใช้ temp artifacts directory สำรองสำหรับผลลัพธ์ subagent |

## การแยก binary blob เทียบกับ text-output artifacts

- **Blob externalization** ใช้สำหรับ binary image payload ภายใน session entry content ที่บันทึกไว้ โดยแทนที่ inline base64 ใน JSONL ด้วย stable content ref
- **Artifacts** เป็นไฟล์ข้อความ plain สำหรับ execution output และ subagent output โดยสามารถระบุตำแหน่งได้ด้วย session-local ID ผ่าน internal URL

ทั้งสองระบบมีจุดเชื่อมต่อกันทางอ้อมเท่านั้น (ทั้งคู่ช่วยลด session JSONL bloat) แต่มี identity อายุการใช้งาน และเส้นทางการดึงข้อมูลที่แตกต่างกัน

## ไฟล์การดำเนินการ

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — รูปแบบ blob reference, hashing, put/get, externalize/resolve helpers
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — โมเดลไดเรกทอรี session artifact และการจัดสรร numeric artifact ID
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — พฤติกรรม `OutputSink` truncation/spill-to-file และ summary metadata
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — persistence transforms, blob rehydration เมื่อโหลด, การโต้ตอบ session fork/move
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — การคัดลอกไดเรกทอรี artifact ระหว่าง interactive fork
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — การ bootstrap artifact manager ของเครื่องมือและการจัดสรร artifact path แบบ per-tool
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — resolver ของ `artifact://`
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — resolver ของ `agent://` + JSON extraction
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — การเชื่อมต่อ internal URL router และ artifacts-dir resolver
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — การจัดสรร agent output ID แบบ session-scoped สำหรับ `agent://`
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — การเขียน subagent output artifact (`<id>.md`) และ temp artifact directory fallback
