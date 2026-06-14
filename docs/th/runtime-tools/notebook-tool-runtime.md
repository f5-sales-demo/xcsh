---
title: ส่วนภายในของรันไทม์เครื่องมือ Notebook
description: >-
  รันไทม์เครื่องมือ Jupyter notebook พร้อมการรันเซลล์ วงจรชีวิตของเคอร์เนล
  และการแสดงผลลัพธ์
sidebar:
  order: 2
  label: เครื่องมือ Notebook
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# ส่วนภายในของรันไทม์เครื่องมือ Notebook

เอกสารนี้อธิบายการใช้งานเครื่องมือ `notebook` ในปัจจุบัน และความสัมพันธ์กับรันไทม์ Python ที่รองรับด้วยเคอร์เนล

ความแตกต่างที่สำคัญ: **`notebook` คือเครื่องมือแก้ไข JSON notebook ไม่ใช่ตัวรัน notebook** โดยจะแก้ไขซอร์สเซลล์ `.ipynb` โดยตรง ไม่ได้เริ่มต้นหรือสื่อสารกับ Python เคอร์เนล

## ไฟล์การใช้งาน

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) ขอบเขตรันไทม์: การแก้ไขเทียบกับการรัน

## เครื่องมือ `notebook` (`src/tools/notebook.ts`)

- รองรับ `action: edit | insert | delete` บนไฟล์ `.ipynb`
- แก้ไขพาธสัมพันธ์กับ session CWD (`resolveToCwd`)
- โหลด JSON ของ notebook ตรวจสอบความถูกต้องของอาร์เรย์ `cells` และตรวจสอบขอบเขตของ `cell_index`
- ใช้การแก้ไขซอร์สในหน่วยความจำและเขียน JSON ของ notebook ทั้งหมดกลับด้วย `JSON.stringify(notebook, null, 1)`
- คืนค่าสรุปเป็นข้อความ + `details` แบบโครงสร้าง (`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`)

ไม่มีวงจรชีวิตของเคอร์เนลในเครื่องมือนี้:

- ไม่มีการรับ gateway
- ไม่มี kernel session ID
- ไม่มี `execute_request`
- ไม่มี stream chunks จากช่องทางของเคอร์เนล
- ไม่มีการจับภาพ rich display (`image/png`, JSON display, status MIME)

## เส้นทางการรันแบบ Notebook (`src/tools/python.ts` + `src/ipy/*`)

เมื่อ agent ต้องการรันโค้ด Python แบบเซลล์ (เซลล์ตามลำดับ, สถานะที่คงอยู่, rich displays) จะดำเนินการผ่าน **เครื่องมือ `python`** ไม่ใช่ `notebook`

เส้นทางนี้คือที่ที่โหมดเคอร์เนล, พฤติกรรม restart/cancel, chunk streaming และการตัดทอนเอาต์พุตอาร์ติแฟกต์อยู่

## 2) ความหมายของการจัดการเซลล์ Notebook (เครื่องมือ `notebook`)

## การทำให้ซอร์สเป็นมาตรฐาน

`content` จะถูกแบ่งเป็น `source: string[]` โดยรักษาบรรทัดใหม่:

- แต่ละบรรทัดที่ไม่ใช่บรรทัดสุดท้ายจะคงท้าย `\n` ไว้
- บรรทัดสุดท้ายไม่มีการบังคับใส่บรรทัดใหม่ท้าย

สิ่งนี้สะท้อนถึงข้อกำหนด JSON ของ notebook และหลีกเลี่ยงการต่อบรรทัดโดยไม่ตั้งใจในการแก้ไขครั้งต่อไป

## พฤติกรรมของแต่ละ Action

- `edit`
  - แทนที่ `cells[cell_index].source`
  - รักษา `cell_type` เดิมไว้
- `insert`
  - แทรกที่ตำแหน่ง `[0..cellCount]`
  - `cell_type` ค่าเริ่มต้นคือ `code`
  - เซลล์โค้ดเริ่มต้นด้วย `execution_count: null` และ `outputs: []`
  - เซลล์ markdown เริ่มต้นด้วยเพียง `metadata` + `source`
- `delete`
  - ลบ `cells[cell_index]`
  - คืนค่า `source` ที่ถูกลบใน details สำหรับการแสดงตัวอย่างของ renderer

## พื้นผิวของข้อผิดพลาด

ความล้มเหลวแบบ Hard จะถูก throw สำหรับ:

- ไม่พบไฟล์ notebook
- JSON ไม่ถูกต้อง
- `cells` ขาดหายหรือไม่ใช่อาร์เรย์
- index อยู่นอกช่วง (insert และ non-insert มีช่วงที่ถูกต้องต่างกัน)
- `content` ขาดหายสำหรับ `edit`/`insert`

สิ่งเหล่านี้จะกลายเป็นการตอบสนองเครื่องมือ `Error:` ที่ต้นน้ำ โดย renderer ใช้พาธของ notebook + ข้อความข้อผิดพลาดที่จัดรูปแบบแล้ว

## 3) ความหมายของ Kernel Session (ที่มีอยู่จริง)

ความหมายของเคอร์เนลถูกใช้งานใน `executePython` / `PythonKernel` และใช้กับเครื่องมือ `python`

## โหมด

`PythonKernelMode`:

- `session` (ค่าเริ่มต้น)
  - เคอร์เนลถูก cache ในแมป `kernelSessions`
  - สูงสุด 4 sessions โดยตัวเก่าสุดจะถูกขับออกเมื่อเกิน
  - ทำความสะอาด idle/dead ทุก 30 วินาที, หมดเวลาหลังจาก 5 นาที
  - คิวต่อ session จัดลำดับการรัน (`session.queue`)
- `per-call`
  - สร้างเคอร์เนลสำหรับ request
  - รัน
  - ปิดเคอร์เนลเสมอใน `finally`

## พฤติกรรม Reset

เครื่องมือ `python` ส่ง `reset` เฉพาะสำหรับเซลล์แรกในการเรียกแบบหลายเซลล์เท่านั้น เซลล์ถัดไปจะรันด้วย `reset: false` เสมอ

## การตายของเคอร์เนล / Restart / Retry

ในโหมด session (`withKernelSession`):

- ตรวจพบเคอร์เนลที่ตายแล้วด้วย heartbeat (ตรวจสอบ `kernel.isAlive()` ทุก 5 วินาที) หรือความล้มเหลวในการรัน
- สถานะตายก่อนรันทริกเกอร์ `restartKernelSession`
- เส้นทาง crash ในขณะรัน retry หนึ่งครั้ง: restart เคอร์เนล, รัน handler ใหม่
- `restartCount > 1` ใน session เดียวกันจะ throw `Python kernel restarted too many times in this session`

พฤติกรรม Startup retry:

- การสร้างเคอร์เนล shared gateway retry หนึ่งครั้งเมื่อเกิด `SharedGatewayCreateError` ที่มี HTTP 5xx

การกู้คืนจากทรัพยากรหมด:

- ตรวจพบความล้มเหลวแบบ `EMFILE`/`ENFILE`/"Too many open files"
- ล้าง sessions ที่ถูกติดตาม
- เรียก `shutdownSharedGateway()`
- retry การสร้าง kernel session หนึ่งครั้ง

## 4) การฉีด Environment/Session Variable

การเริ่มต้นเคอร์เนลรับ env map ที่ไม่บังคับจาก executor:

- `PI_SESSION_FILE` (พาธไฟล์สถานะ session)
- `ARTIFACTS` (ไดเรกทอรีอาร์ติแฟกต์)

จากนั้น `PythonKernel.#initializeKernelEnvironment(...)` จะรันสคริปต์เริ่มต้นภายในเคอร์เนลเพื่อ:

- `os.chdir(cwd)`
- ฉีด env entries เข้าสู่ `os.environ`
- เพิ่ม cwd ไว้ที่ต้นของ `sys.path` หากยังไม่มี

ผลกระทบ:

- prelude helpers ที่อ่าน session หรือ artifact context อาศัย env vars เหล่านี้ในสถานะ Python process

## 5) การจัดการ Streaming/Chunk และ Display (เส้นทางที่รองรับด้วยเคอร์เนล)

kernel client ประมวลผลข้อความโปรโตคอล Jupyter ต่อการรัน:

- `stream` -> text chunk ไปยัง `onChunk`
- `execute_result` / `display_data` ->
  - ข้อความ display ถูกเลือกตามลำดับ MIME: `text/markdown` > `text/plain` > แปลงจาก `text/html`
  - เอาต์พุตแบบโครงสร้างถูกจับแยกต่างหาก:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (ไม่ปล่อยข้อความ)
- `error` -> ข้อความ traceback ถูก push ไปยัง chunk stream + metadata ข้อผิดพลาดแบบโครงสร้าง
- `input_request` -> ปล่อยข้อความเตือน stdin, ส่ง `input_reply` ว่าง, ทำเครื่องหมายว่ามีการร้องขอ stdin
- การสิ้นสุดรอทั้ง `execute_reply` และ kernel `status=idle`

Cancellation/timeout:

- abort signal ทริกเกอร์ `interrupt()` (REST `/interrupt` + control-channel `interrupt_request`)
- ผลลัพธ์ทำเครื่องหมาย `cancelled=true`
- เส้นทาง timeout เพิ่มข้อความใน output ว่า `Command timed out after <n> seconds`

## 6) พฤติกรรมการตัดทอนและอาร์ติแฟกต์

`OutputSink` ใน `src/session/streaming-output.ts` ถูกใช้โดยเส้นทางการรันเคอร์เนล (`executeWithKernel`):

- ทำความสะอาดทุก chunk (`sanitizeText`)
- ติดตามจำนวนบรรทัดและไบต์รวม/ที่ส่งออก
- ไฟล์ spill อาร์ติแฟกต์ที่ไม่บังคับ (`artifactPath`, `artifactId`)
- เมื่อบัฟเฟอร์ในหน่วยความจำเกินเกณฑ์ (`DEFAULT_MAX_BYTES` หากไม่มีการ override):
  - ทำเครื่องหมาย truncated
  - เก็บ tail bytes ไว้ในหน่วยความจำ (ขอบเขตที่ปลอดภัยสำหรับ UTF-8)
  - สามารถ spill stream ทั้งหมดไปยัง artifact sink

`dump()` คืนค่า:

- ข้อความเอาต์พุตที่มองเห็นได้ (อาจถูกตัดทอนจาก tail)
- flag การตัดทอน + จำนวน
- artifact ID (สำหรับการอ้างอิง `artifact://<id>`)

เครื่องมือ `python` แปลง metadata นี้เป็นการแจ้งเตือนการตัดทอนผลลัพธ์และคำเตือน TUI

เครื่องมือ `notebook` **ไม่ได้** ใช้ `OutputSink` เพราะไม่มี pipeline สำหรับ stream/artifact truncation เนื่องจากไม่ได้รันโค้ด

## 7) สมมติฐานของ Renderer และการจัดรูปแบบ

## Notebook Renderer (`notebookToolRenderer`)

- call view: บรรทัดสถานะพร้อม action + พาธ notebook + metadata ของเซลล์/ประเภท
- result view:
  - สรุปความสำเร็จที่ได้จาก `details`
  - `cellSource` แสดงผ่าน `renderCodeCell`
  - เซลล์ markdown ตั้ง language hint เป็น `markdown` เซลล์อื่นไม่มีการ override ภาษาอย่างชัดเจน
  - ขีดจำกัดตัวอย่างโค้ดแบบย่อคือ `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - รองรับโหมดขยายผ่าน shared render options
  - ใช้ render cache ที่กำหนดคีย์ตามความกว้าง + สถานะการขยาย

สมมติฐานการแสดงข้อผิดพลาด:

- หากเนื้อหาข้อความแรกขึ้นต้นด้วย `Error:` renderer จะจัดรูปแบบเป็นบล็อกข้อผิดพลาดของ notebook

## Python Renderer (สำหรับเอาต์พุตการรันจริง)

การแสดงผลการรันที่รองรับด้วยเคอร์เนลคาดหวัง:

- การเปลี่ยนสถานะต่อเซลล์ (`pending/running/complete/error`)
- ส่วน status event แบบโครงสร้างที่ไม่บังคับ
- โครงสร้างต้นไม้ JSON output ที่ไม่บังคับ
- คำเตือนการตัดทอน + ตัวชี้ `artifact://<id>` ที่ไม่บังคับ

พฤติกรรมของ renderer นี้ไม่เกี่ยวข้องกับผลลัพธ์การแก้ไข `notebook` JSON ยกเว้นที่ทั้งสองใช้ TUI primitives ที่ใช้ร่วมกัน

## 8) ความแตกต่างจากพฤติกรรมเครื่องมือ Python แบบเรียบง่าย

หาก "เครื่องมือ Python แบบเรียบง่าย" หมายถึงเส้นทางการรัน `python`:

- `python` รันโค้ดในเคอร์เนล, คงสถานะตามโหมด, streaming chunks, จับภาพ rich displays, จัดการ interrupts/timeouts และรองรับการตัดทอน output/อาร์ติแฟกต์
- `notebook` ดำเนินการ mutation JSON ของ notebook อย่างแน่นอนเท่านั้น ไม่มีการรัน ไม่มีสถานะเคอร์เนล ไม่มี chunk stream ไม่มี display outputs ไม่มี artifact pipeline

หาก workflow ต้องการทั้งสองอย่าง:

1. แก้ไขซอร์สของ notebook ด้วย `notebook`
2. รันเซลล์โค้ดผ่าน `python` (ส่งโค้ดด้วยตนเอง) ไม่ใช่ผ่าน `notebook`

การใช้งานในปัจจุบันไม่มีเครื่องมือเดียวที่สามารถทั้ง mutate `.ipynb` และรันเซลล์ notebook ผ่าน kernel context ได้
