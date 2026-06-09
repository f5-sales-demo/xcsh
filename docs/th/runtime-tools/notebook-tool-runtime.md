---
title: โครงสร้างภายในของ Notebook Tool Runtime
description: >-
  Jupyter notebook tool runtime พร้อมการดำเนินการเซลล์ วงจรชีวิตเคอร์เนล
  และการเรนเดอร์ผลลัพธ์
sidebar:
  order: 2
  label: Notebook tool
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# โครงสร้างภายในของ Notebook tool runtime

เอกสารนี้อธิบายการทำงานของ `notebook` tool ในปัจจุบันและความสัมพันธ์กับ Python runtime ที่ใช้เคอร์เนลเป็นฐาน

ข้อแตกต่างที่สำคัญ: **`notebook` เป็นตัวแก้ไข JSON notebook ไม่ใช่ตัวประมวลผล notebook** มันแก้ไขซอร์สของเซลล์ `.ipynb` โดยตรง ไม่ได้เริ่มต้นหรือสื่อสารกับ Python kernel

## ไฟล์ที่เกี่ยวข้องกับการทำงาน

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) ขอบเขต Runtime: การแก้ไข vs การประมวลผล

## `notebook` tool (`src/tools/notebook.ts`)

- รองรับ `action: edit | insert | delete` บนไฟล์ `.ipynb`
- แก้ไขพาธให้สัมพันธ์กับ CWD ของเซสชัน (`resolveToCwd`)
- โหลด JSON ของ notebook ตรวจสอบอาร์เรย์ `cells` ตรวจสอบขอบเขตของ `cell_index`
- ใช้การแก้ไขซอร์สในหน่วยความจำและเขียน JSON ของ notebook ทั้งหมดกลับด้วย `JSON.stringify(notebook, null, 1)`
- คืนค่าสรุปเป็นข้อความ + `details` แบบมีโครงสร้าง (`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`)

ไม่มีวงจรชีวิตเคอร์เนลใน tool นี้:

- ไม่มีการขอ gateway
- ไม่มี kernel session ID
- ไม่มี `execute_request`
- ไม่มี stream chunks จาก kernel channels
- ไม่มีการจับภาพ rich display (`image/png`, JSON display, status MIME)

## เส้นทางการประมวลผลแบบ Notebook (`src/tools/python.ts` + `src/ipy/*`)

เมื่อ agent ต้องการรันโค้ด Python แบบเซลล์ (เซลล์ต่อเนื่อง, สถานะคงอยู่, rich displays) จะดำเนินการผ่าน **`python` tool** ไม่ใช่ `notebook`

เส้นทางนี้คือที่ที่โหมดเคอร์เนล, พฤติกรรมการรีสตาร์ท/ยกเลิก, chunk streaming และการตัดทอนผลลัพธ์อยู่

## 2) ความหมายของการจัดการเซลล์ Notebook (`notebook` tool)

## การทำให้ซอร์สเป็นมาตรฐาน

`content` ถูกแบ่งเป็น `source: string[]` โดยรักษาการขึ้นบรรทัดใหม่:

- แต่ละบรรทัดที่ไม่ใช่บรรทัดสุดท้ายจะรักษา `\n` ต่อท้ายไว้
- บรรทัดสุดท้ายไม่มีการบังคับขึ้นบรรทัดใหม่ต่อท้าย

สิ่งนี้สอดคล้องกับรูปแบบ JSON ของ notebook และหลีกเลี่ยงการต่อบรรทัดโดยไม่ตั้งใจในการแก้ไขครั้งถัดไป

## พฤติกรรมของ Action

- `edit`
  - แทนที่ `cells[cell_index].source`
  - รักษา `cell_type` ที่มีอยู่
- `insert`
  - แทรกที่ `[0..cellCount]`
  - `cell_type` ค่าเริ่มต้นเป็น `code`
  - เซลล์โค้ดเริ่มต้น `execution_count: null` และ `outputs: []`
  - เซลล์ markdown เริ่มต้นเฉพาะ `metadata` + `source`
- `delete`
  - ลบ `cells[cell_index]`
  - คืนค่า `source` ที่ถูกลบใน details สำหรับตัวอย่างของ renderer

## พื้นผิวข้อผิดพลาด

ข้อผิดพลาดร้ายแรงจะถูก throw สำหรับ:

- ไม่พบไฟล์ notebook
- JSON ไม่ถูกต้อง
- `cells` หายไป/ไม่ใช่อาร์เรย์
- ดัชนีนอกช่วง (insert และ non-insert มีช่วงที่ถูกต้องต่างกัน)
- `content` หายไปสำหรับ `edit`/`insert`

สิ่งเหล่านี้จะกลายเป็น `Error:` tool responses ในระดับบน; renderer ใช้พาธของ notebook + ข้อความข้อผิดพลาดที่จัดรูปแบบแล้ว

## 3) ความหมายของเซสชันเคอร์เนล (ส่วนที่มีอยู่จริง)

ความหมายของเคอร์เนลถูกนำไปใช้ใน `executePython` / `PythonKernel` และใช้กับ `python` tool

## โหมด

`PythonKernelMode`:

- `session` (ค่าเริ่มต้น)
  - เคอร์เนลถูกแคชในแมป `kernelSessions`
  - สูงสุด 4 เซสชัน; เก่าสุดถูกลบเมื่อล้น
  - ล้าง idle/dead ทุก 30 วินาที, หมดเวลาหลัง 5 นาที
  - คิวต่อเซสชันจัดลำดับการประมวลผล (`session.queue`)
- `per-call`
  - สร้างเคอร์เนลสำหรับแต่ละคำขอ
  - ประมวลผล
  - ปิดเคอร์เนลเสมอใน `finally`

## พฤติกรรมการรีเซ็ต

`python` tool ส่ง `reset` เฉพาะเซลล์แรกในการเรียกแบบหลายเซลล์; เซลล์ถัดไปจะรันด้วย `reset: false` เสมอ

## การตายของเคอร์เนล / รีสตาร์ท / ลองใหม่

ในโหมด session (`withKernelSession`):

- เคอร์เนลที่ตายถูกตรวจจับโดย heartbeat (ตรวจสอบ `kernel.isAlive()` ทุก 5 วินาที) หรือความล้มเหลวในการประมวลผล
- สถานะตายก่อนรันจะทริกเกอร์ `restartKernelSession`
- เส้นทางขัดข้องขณะประมวลผลจะลองใหม่หนึ่งครั้ง: รีสตาร์ทเคอร์เนล, รัน handler ซ้ำ
- `restartCount > 1` ในเซสชันเดียวกันจะ throw `Python kernel restarted too many times in this session`

พฤติกรรมการลองเริ่มต้นใหม่:

- การสร้างเคอร์เนล shared gateway จะลองใหม่หนึ่งครั้งเมื่อเกิด `SharedGatewayCreateError` ที่มี HTTP 5xx

การกู้คืนจากทรัพยากรหมด:

- ตรวจจับความล้มเหลวแบบ `EMFILE`/`ENFILE`/"Too many open files"
- ล้างเซสชันที่ติดตามอยู่
- เรียก `shutdownSharedGateway()`
- ลองสร้างเซสชันเคอร์เนลใหม่หนึ่งครั้ง

## 4) การฉีดตัวแปรสภาพแวดล้อม/เซสชัน

การเริ่มต้นเคอร์เนลรับแมป env ที่เป็นทางเลือกจาก executor:

- `PI_SESSION_FILE` (พาธไฟล์สถานะเซสชัน)
- `ARTIFACTS` (ไดเรกทอรี artifact)

`PythonKernel.#initializeKernelEnvironment(...)` จากนั้นจะรันสคริปต์เริ่มต้นภายในเคอร์เนลเพื่อ:

- `os.chdir(cwd)`
- ฉีดรายการ env เข้า `os.environ`
- เพิ่ม cwd ไว้หน้า `sys.path` หากยังไม่มี

ผลกระทบ:

- prelude helpers ที่อ่านบริบทเซสชันหรือ artifact อาศัยตัวแปรสภาพแวดล้อมเหล่านี้ในสถานะของ Python process

## 5) การจัดการ Streaming/chunk และ display (เส้นทางที่ใช้เคอร์เนล)

kernel client ประมวลผลข้อความโปรโตคอล Jupyter ต่อการประมวลผลแต่ละครั้ง:

- `stream` -> text chunk ไปยัง `onChunk`
- `execute_result` / `display_data` ->
  - ข้อความ display ถูกเลือกตามลำดับความสำคัญ MIME: `text/markdown` > `text/plain` > แปลง `text/html`
  - ผลลัพธ์แบบมีโครงสร้างถูกจับแยกต่างหาก:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (ไม่มีการส่งข้อความ)
- `error` -> ข้อความ traceback ถูกส่งไปยัง chunk stream + metadata ข้อผิดพลาดแบบมีโครงสร้าง
- `input_request` -> ส่งข้อความเตือน stdin, ส่ง `input_reply` ว่าง, ทำเครื่องหมาย stdin requested
- การรอเสร็จจะรอทั้ง `execute_reply` และเคอร์เนล `status=idle`

การยกเลิก/หมดเวลา:

- สัญญาณ abort จะทริกเกอร์ `interrupt()` (REST `/interrupt` + control-channel `interrupt_request`)
- ผลลัพธ์จะทำเครื่องหมาย `cancelled=true`
- เส้นทางหมดเวลาจะเพิ่มหมายเหตุในผลลัพธ์ `Command timed out after <n> seconds`

## 6) พฤติกรรมการตัดทอนและ artifact

`OutputSink` ใน `src/session/streaming-output.ts` ถูกใช้โดยเส้นทางการประมวลผลเคอร์เนล (`executeWithKernel`):

- ทำความสะอาดทุก chunk (`sanitizeText`)
- ติดตามจำนวนบรรทัดและไบต์ทั้งหมด/ผลลัพธ์
- ไฟล์ artifact spill ที่เป็นทางเลือก (`artifactPath`, `artifactId`)
- เมื่อบัฟเฟอร์ในหน่วยความจำเกินเกณฑ์ (`DEFAULT_MAX_BYTES` เว้นแต่จะถูกแทนที่):
  - ทำเครื่องหมายว่าตัดทอนแล้ว
  - เก็บไบต์ส่วนท้ายในหน่วยความจำ (ขอบเขตที่ปลอดภัยสำหรับ UTF-8)
  - สามารถส่งสตรีมทั้งหมดไปยัง artifact sink

`dump()` คืนค่า:

- ข้อความผลลัพธ์ที่มองเห็นได้ (อาจถูกตัดทอนส่วนท้าย)
- แฟล็กการตัดทอน + จำนวน
- artifact ID (สำหรับการอ้างอิง `artifact://<id>`)

`python` tool แปลง metadata นี้เป็นการแจ้งเตือนการตัดทอนผลลัพธ์และคำเตือน TUI

`notebook` tool **ไม่ได้**ใช้ `OutputSink`; ไม่มี pipeline การตัดทอน stream/artifact เพราะมันไม่ได้ประมวลผลโค้ด

## 7) สมมติฐานและการจัดรูปแบบของ Renderer

## Notebook renderer (`notebookToolRenderer`)

- มุมมองการเรียก: บรรทัดสถานะพร้อม action + พาธ notebook + metadata ของเซลล์/ชนิด
- มุมมองผลลัพธ์:
  - สรุปความสำเร็จที่ได้จาก `details`
  - `cellSource` ถูกเรนเดอร์ผ่าน `renderCodeCell`
  - เซลล์ markdown ตั้ง language hint เป็น `markdown`; เซลล์อื่นไม่มีการแทนที่ภาษาอย่างชัดเจน
  - ขีดจำกัดตัวอย่างโค้ดแบบย่อคือ `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - รองรับโหมดขยายผ่านตัวเลือกเรนเดอร์ที่ใช้ร่วมกัน
  - ใช้แคชเรนเดอร์ที่คีย์ด้วยความกว้าง + สถานะขยาย

สมมติฐานการเรนเดอร์ข้อผิดพลาด:

- หากเนื้อหาข้อความแรกเริ่มต้นด้วย `Error:` renderer จะจัดรูปแบบเป็นบล็อกข้อผิดพลาด notebook

## Python renderer (สำหรับผลลัพธ์การประมวลผลจริง)

การเรนเดอร์การประมวลผลที่ใช้เคอร์เนลคาดหวัง:

- การเปลี่ยนสถานะต่อเซลล์ (`pending/running/complete/error`)
- ส่วนเหตุการณ์สถานะแบบมีโครงสร้างที่เป็นทางเลือก
- ต้นไม้ผลลัพธ์ JSON ที่เป็นทางเลือก
- คำเตือนการตัดทอน + ตัวชี้ `artifact://<id>` ที่เป็นทางเลือก

พฤติกรรม renderer นี้ไม่เกี่ยวข้องกับผลลัพธ์การแก้ไข JSON ของ `notebook` ยกเว้นว่าทั้งสองใช้ TUI primitives ที่ใช้ร่วมกัน

## 8) ความแตกต่างจากพฤติกรรมของ Python tool ธรรมดา

หาก "Python tool ธรรมดา" หมายถึงเส้นทางการประมวลผล `python`:

- `python` ประมวลผลโค้ดในเคอร์เนล, รักษาสถานะตามโหมด, สตรีม chunks, จับ rich displays, จัดการ interrupts/timeouts และรองรับการตัดทอนผลลัพธ์/artifacts
- `notebook` ทำการเปลี่ยนแปลง JSON ของ notebook แบบกำหนดได้เท่านั้น; ไม่มีการประมวลผล, ไม่มีสถานะเคอร์เนล, ไม่มี chunk stream, ไม่มี display outputs, ไม่มี artifact pipeline

หากเวิร์กโฟลว์ต้องการทั้งสองอย่าง:

1. แก้ไขซอร์ส notebook ด้วย `notebook`
2. ประมวลผลเซลล์โค้ดผ่าน `python` (ส่งโค้ดด้วยตนเอง) ไม่ใช่ผ่าน `notebook`

การทำงานปัจจุบันไม่มี tool เดียวที่ทั้งเปลี่ยนแปลง `.ipynb` และประมวลผลเซลล์ notebook ผ่านบริบทเคอร์เนล
