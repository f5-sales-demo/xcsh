---
title: ส่วนภายในของรันไทม์เครื่องมือ Notebook
description: >-
  รันไทม์เครื่องมือ Jupyter notebook พร้อมการรันเซลล์ วงจรชีวิตเคอร์เนล
  และการแสดงผลลัพธ์
sidebar:
  order: 2
  label: เครื่องมือ Notebook
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# ส่วนภายในของรันไทม์เครื่องมือ Notebook

เอกสารนี้อธิบายการใช้งานเครื่องมือ `notebook` ในปัจจุบัน และความสัมพันธ์กับรันไทม์ Python ที่ขับเคลื่อนด้วยเคอร์เนล

ความแตกต่างที่สำคัญ: **`notebook` คือโปรแกรมแก้ไข JSON notebook ไม่ใช่ตัวรัน notebook** มันแก้ไขซอร์สเซลล์ `.ipynb` โดยตรง และไม่ได้เริ่มหรือสื่อสารกับเคอร์เนล Python

## ไฟล์การใช้งาน

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) ขอบเขตรันไทม์: การแก้ไขเทียบกับการรัน

## เครื่องมือ `notebook` (`src/tools/notebook.ts`)

- รองรับ `action: edit | insert | delete` บนไฟล์ `.ipynb`
- แก้ไขพาธสัมพัทธ์กับ CWD ของเซสชัน (`resolveToCwd`)
- โหลด JSON ของ notebook ตรวจสอบอาร์เรย์ `cells` และตรวจสอบขอบเขต `cell_index`
- ใช้การแก้ไขซอร์สในหน่วยความจำและเขียน JSON ของ notebook ทั้งหมดกลับด้วย `JSON.stringify(notebook, null, 1)`
- คืนค่าสรุปแบบข้อความ + `details` แบบมีโครงสร้าง (`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`)

ไม่มีวงจรชีวิตเคอร์เนลในเครื่องมือนี้:

- ไม่มีการรับ gateway
- ไม่มี session ID ของเคอร์เนล
- ไม่มี `execute_request`
- ไม่มีชุก stream จากช่องทางเคอร์เนล
- ไม่มีการจับ rich display (`image/png`, JSON display, status MIME)

## เส้นทางการรันแบบ Notebook (`src/tools/python.ts` + `src/ipy/*`)

เมื่อ agent ต้องการรันโค้ด Python แบบเซลล์ (เซลล์ต่อเนื่อง สถานะคงอยู่ rich display) จะผ่าน**เครื่องมือ `python`** ไม่ใช่ `notebook`

เส้นทางนี้คือที่ซึ่งโหมดเคอร์เนล พฤติกรรมการรีสตาร์ท/ยกเลิก การสตรีมชุก และการตัดทอนผลลัพธ์ artifact อาศัยอยู่

## 2) ความหมายของการจัดการเซลล์ใน Notebook (เครื่องมือ `notebook`)

## การนอร์มัลไลซ์ซอร์ส

`content` ถูกแบ่งเป็น `source: string[]` โดยคงการขึ้นบรรทัดใหม่ไว้:

- แต่ละบรรทัดที่ไม่ใช่บรรทัดสุดท้ายจะคงเครื่องหมาย `\n` ต่อท้าย
- บรรทัดสุดท้ายไม่มีการบังคับเครื่องหมายขึ้นบรรทัดใหม่ต่อท้าย

สิ่งนี้สะท้อนรูปแบบ JSON ของ notebook และหลีกเลี่ยงการต่อบรรทัดโดยไม่ตั้งใจในการแก้ไขครั้งต่อไป

## พฤติกรรมของ action

- `edit`
  - แทนที่ `cells[cell_index].source`
  - คงชนิด `cell_type` เดิมไว้
- `insert`
  - แทรกที่ตำแหน่ง `[0..cellCount]`
  - `cell_type` มีค่าเริ่มต้นเป็น `code`
  - เซลล์โค้ดเริ่มต้น `execution_count: null` และ `outputs: []`
  - เซลล์ markdown เริ่มต้นเฉพาะ `metadata` + `source`
- `delete`
  - ลบ `cells[cell_index]`
  - คืน `source` ที่ถูกลบใน details สำหรับการแสดงตัวอย่างของ renderer

## พื้นผิวข้อผิดพลาด

ความล้มเหลวร้ายแรงจะถูก throw สำหรับ:

- ไฟล์ notebook ที่หายไป
- JSON ที่ไม่ถูกต้อง
- `cells` ที่หายไปหรือไม่ใช่อาร์เรย์
- ดัชนีอยู่นอกช่วง (insert และ non-insert มีช่วงที่ถูกต้องต่างกัน)
- `content` ที่หายไปสำหรับ `edit`/`insert`

สิ่งเหล่านี้กลายเป็นการตอบสนองเครื่องมือ `Error:` ต้นน้ำ; renderer ใช้พาธ notebook + ข้อความข้อผิดพลาดที่จัดรูปแบบแล้ว

## 3) ความหมายของ Kernel Session (ที่มีอยู่จริง)

ความหมายของเคอร์เนลถูกใช้งานใน `executePython` / `PythonKernel` และใช้กับเครื่องมือ `python`

## โหมด

`PythonKernelMode`:

- `session` (ค่าเริ่มต้น)
  - เคอร์เนลถูกแคชในแมป `kernelSessions`
  - สูงสุด 4 เซสชัน; เซสชันเก่าที่สุดถูกนำออกเมื่อเกินจำนวน
  - ทำความสะอาด idle/dead ทุก 30 วินาที timeout หลังจาก 5 นาที
  - คิวต่อเซสชันทำให้การรันเป็นแบบ sequential (`session.queue`)
- `per-call`
  - สร้างเคอร์เนลสำหรับคำขอ
  - รัน
  - ปิดเคอร์เนลเสมอใน `finally`

## พฤติกรรม Reset

เครื่องมือ `python` ส่ง `reset` เฉพาะสำหรับเซลล์แรกในการเรียกแบบหลายเซลล์เท่านั้น; เซลล์ถัดมาจะรันด้วย `reset: false` เสมอ

## การตายของเคอร์เนล / การรีสตาร์ท / การลองใหม่

ในโหมด session (`withKernelSession`):

- เคอร์เนลที่ตายถูกตรวจพบโดย heartbeat (การตรวจสอบ `kernel.isAlive()` ทุก 5 วินาที) หรือความล้มเหลวในการรัน
- สถานะตายก่อนรันจะเรียก `restartKernelSession`
- เส้นทางล้มเหลวขณะรันจะลองใหม่ครั้งหนึ่ง: รีสตาร์ทเคอร์เนล รัน handler ใหม่
- `restartCount > 1` ในเซสชันเดียวกันจะ throw `Python kernel restarted too many times in this session`

พฤติกรรมการลองใหม่ขณะเริ่มต้น:

- การสร้างเคอร์เนล shared gateway จะลองใหม่ครั้งหนึ่งสำหรับ `SharedGatewayCreateError` กับ HTTP 5xx

การกู้คืนจากทรัพยากรหมด:

- ตรวจจับความล้มเหลวแบบ `EMFILE`/`ENFILE`/"Too many open files"
- ล้างเซสชันที่ถูกติดตาม
- เรียก `shutdownSharedGateway()`
- ลองสร้าง kernel session ใหม่ครั้งหนึ่ง

## 4) การฉีดตัวแปร Environment/Session

การเริ่มต้นเคอร์เนลรับแมป env ทางเลือกจาก executor:

- `PI_SESSION_FILE` (พาธไฟล์สถานะเซสชัน)
- `ARTIFACTS` (ไดเรกทอรี artifact)

`PythonKernel.#initializeKernelEnvironment(...)` จะรันสคริปต์เริ่มต้นภายในเคอร์เนลเพื่อ:

- `os.chdir(cwd)`
- ฉีดรายการ env เข้าสู่ `os.environ`
- เพิ่ม cwd ต่อหน้า `sys.path` หากยังไม่มี

ผลที่ตามมา:

- ตัวช่วย prelude ที่อ่านบริบทเซสชันหรือ artifact จะพึ่งพาตัวแปร env เหล่านี้ในสถานะโปรเซส Python

## 5) การจัดการ Streaming/Chunk และ Display (เส้นทางที่ขับเคลื่อนด้วยเคอร์เนล)

ไคลเอนต์เคอร์เนลประมวลผลข้อความโปรโตคอล Jupyter ต่อการรัน:

- `stream` -> ชุกข้อความไปยัง `onChunk`
- `execute_result` / `display_data` ->
  - ข้อความ display ถูกเลือกตามลำดับความสำคัญ MIME: `text/markdown` > `text/plain` > แปลง `text/html`
  - ผลลัพธ์แบบมีโครงสร้างถูกจับแยกต่างหาก:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (ไม่มีการส่งออกข้อความ)
- `error` -> ข้อความ traceback ถูกส่งไปยัง chunk stream + metadata ข้อผิดพลาดแบบมีโครงสร้าง
- `input_request` -> ส่งออกข้อความเตือน stdin ส่ง `input_reply` ว่าง ทำเครื่องหมายว่ามีการขอ stdin
- การรอให้เสร็จสิ้นรอทั้ง `execute_reply` และเคอร์เนล `status=idle`

การยกเลิก/timeout:

- สัญญาณ abort เรียก `interrupt()` (REST `/interrupt` + control-channel `interrupt_request`)
- ผลลัพธ์ทำเครื่องหมาย `cancelled=true`
- เส้นทาง timeout จะใส่คำอธิบายผลลัพธ์ด้วย `Command timed out after <n> seconds`

## 6) พฤติกรรมการตัดทอนและ Artifact

`OutputSink` ใน `src/session/streaming-output.ts` ถูกใช้โดยเส้นทางการรันเคอร์เนล (`executeWithKernel`):

- ทำความสะอาดทุกชุก (`sanitizeText`)
- ติดตามจำนวนบรรทัดและไบต์รวม/ผลลัพธ์
- ไฟล์ artifact spill ทางเลือก (`artifactPath`, `artifactId`)
- เมื่อบัฟเฟอร์ในหน่วยความจำเกินเกณฑ์ (`DEFAULT_MAX_BYTES` เว้นแต่จะถูกแทนที่):
  - ทำเครื่องหมายว่าถูกตัดทอน
  - คงส่วนท้ายไบต์ไว้ในหน่วยความจำ (ขอบเขตที่ปลอดภัยสำหรับ UTF-8)
  - สามารถ spill stream ทั้งหมดไปยัง artifact sink

`dump()` คืนค่า:

- ข้อความผลลัพธ์ที่มองเห็นได้ (อาจถูกตัดทอนจากส่วนท้าย)
- แฟล็กการตัดทอน + จำนวน
- artifact ID (สำหรับการอ้างอิง `artifact://<id>`)

เครื่องมือ `python` แปลง metadata นี้เป็นการแจ้งเตือนการตัดทอนผลลัพธ์และคำเตือน TUI

เครื่องมือ `notebook` **ไม่ได้** ใช้ `OutputSink`; ไม่มี pipeline การตัดทอน stream/artifact เพราะไม่ได้รันโค้ด

## 7) สมมติฐานของ Renderer และการจัดรูปแบบ

## Notebook renderer (`notebookToolRenderer`)

- มุมมองการเรียก: บรรทัดสถานะพร้อม action + พาธ notebook + metadata เซลล์/ชนิด
- มุมมองผลลัพธ์:
  - สรุปความสำเร็จที่ได้จาก `details`
  - `cellSource` แสดงผลผ่าน `renderCodeCell`
  - เซลล์ markdown ตั้งค่า language hint เป็น `markdown`; เซลล์อื่นไม่มีการกำหนด language override โดยตรง
  - ขีดจำกัดการแสดงตัวอย่างโค้ดที่ยุบแล้วคือ `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - รองรับโหมดขยายผ่าน render options ที่ใช้ร่วมกัน
  - ใช้แคช render ที่มีกุญแจตามความกว้าง + สถานะการขยาย

สมมติฐานการแสดงข้อผิดพลาด:

- หากเนื้อหาข้อความแรกเริ่มต้นด้วย `Error:` renderer จะจัดรูปแบบเป็นบล็อกข้อผิดพลาด notebook

## Python renderer (สำหรับผลลัพธ์การรันจริง)

การแสดงผลการรันที่ขับเคลื่อนด้วยเคอร์เนลคาดหวัง:

- การเปลี่ยนสถานะต่อเซลล์ (`pending/running/complete/error`)
- ส่วนเหตุการณ์สถานะแบบมีโครงสร้างทางเลือก
- ต้นไม้ผลลัพธ์ JSON ทางเลือก
- คำเตือนการตัดทอน + ตัวชี้ `artifact://<id>` ทางเลือก

พฤติกรรม renderer นี้ไม่เกี่ยวข้องกับผลลัพธ์การแก้ไข JSON ของ `notebook` ยกเว้นว่าทั้งคู่ใช้ TUI primitives ที่ใช้ร่วมกันซ้ำ

## 8) ความแตกต่างจากพฤติกรรมเครื่องมือ Python ธรรมดา

หาก "เครื่องมือ Python ธรรมดา" หมายถึงเส้นทางการรัน `python`:

- `python` รันโค้ดในเคอร์เนล คงสถานะตามโหมด สตรีมชุก จับ rich display จัดการการขัดจังหวะ/timeout และรองรับการตัดทอนผลลัพธ์/artifact
- `notebook` ดำเนินการแก้ไข JSON ของ notebook แบบกำหนดได้เท่านั้น; ไม่มีการรัน ไม่มีสถานะเคอร์เนล ไม่มี chunk stream ไม่มีผลลัพธ์ display ไม่มี artifact pipeline

หากเวิร์กโฟลว์ต้องการทั้งสองอย่าง:

1. แก้ไขซอร์ส notebook ด้วย `notebook`
2. รันเซลล์โค้ดผ่าน `python` (ส่งโค้ดด้วยตนเอง) ไม่ใช่ผ่าน `notebook`

การใช้งานปัจจุบันไม่มีเครื่องมือเดียวที่ทั้งแก้ไข `.ipynb` และรันเซลล์ notebook ผ่านบริบทเคอร์เนล
