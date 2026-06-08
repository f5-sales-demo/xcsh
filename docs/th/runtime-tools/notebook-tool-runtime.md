---
title: Notebook Tool Runtime Internals
description: >-
  Jupyter notebook tool runtime with cell execution, kernel lifecycle, and
  output rendering.
sidebar:
  order: 2
  label: Notebook tool
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# รายละเอียดภายในของ Notebook Tool Runtime

เอกสารนี้อธิบายการใช้งานเครื่องมือ `notebook` ในปัจจุบัน และความสัมพันธ์กับ Python runtime ที่ทำงานผ่าน kernel

ข้อแตกต่างที่สำคัญ: **`notebook` เป็นตัวแก้ไข JSON notebook ไม่ใช่ตัวประมวลผล notebook** มันแก้ไข cell sources ของไฟล์ `.ipynb` โดยตรง ไม่ได้เริ่มต้นหรือสื่อสารกับ Python kernel

## ไฟล์การใช้งาน

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) ขอบเขตของ Runtime: การแก้ไข vs การประมวลผล

## เครื่องมือ `notebook` (`src/tools/notebook.ts`)

- รองรับ `action: edit | insert | delete` บนไฟล์ `.ipynb`
- แก้ไข path ให้สัมพันธ์กับ session CWD (`resolveToCwd`)
- โหลด notebook JSON, ตรวจสอบอาร์เรย์ `cells`, ตรวจสอบขอบเขต `cell_index`
- ใช้การแก้ไข source ในหน่วยความจำและเขียน notebook JSON ทั้งหมดกลับด้วย `JSON.stringify(notebook, null, 1)`
- คืนค่าสรุปเป็นข้อความ + `details` แบบโครงสร้าง (`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`)

ไม่มี kernel lifecycle ในเครื่องมือนี้:

- ไม่มีการรับ gateway
- ไม่มี kernel session ID
- ไม่มี `execute_request`
- ไม่มี stream chunks จาก kernel channels
- ไม่มีการจับ rich display (`image/png`, JSON display, status MIME)

## เส้นทางการประมวลผลแบบ Notebook (`src/tools/python.ts` + `src/ipy/*`)

เมื่อ agent ต้องการรันโค้ด Python แบบ cell-style (cells ตามลำดับ, state ที่คงอยู่, rich displays) จะผ่านเครื่องมือ **`python`** ไม่ใช่ `notebook`

เส้นทางนี้เป็นที่ที่ kernel modes, พฤติกรรม restart/cancel, chunk streaming และการตัดทอน output artifact อยู่

## 2) ความหมายของการจัดการ Notebook Cell (เครื่องมือ `notebook`)

## การทำให้ Source เป็นมาตรฐาน

`content` จะถูกแยกเป็น `source: string[]` โดยรักษาการขึ้นบรรทัดใหม่:

- แต่ละบรรทัดที่ไม่ใช่บรรทัดสุดท้ายจะเก็บ `\n` ต่อท้าย
- บรรทัดสุดท้ายไม่มีการบังคับ newline ต่อท้าย

สิ่งนี้สะท้อนข้อกำหนดของ notebook JSON และหลีกเลี่ยงการรวมบรรทัดโดยไม่ตั้งใจในการแก้ไขครั้งถัดไป

## พฤติกรรมของ Action

- `edit`
  - แทนที่ `cells[cell_index].source`
  - รักษา `cell_type` ที่มีอยู่
- `insert`
  - แทรกที่ตำแหน่ง `[0..cellCount]`
  - `cell_type` มีค่าเริ่มต้นเป็น `code`
  - code cells เริ่มต้นด้วย `execution_count: null` และ `outputs: []`
  - markdown cells เริ่มต้นด้วยเฉพาะ `metadata` + `source`
- `delete`
  - ลบ `cells[cell_index]`
  - คืนค่า `source` ที่ถูกลบใน details สำหรับการแสดงตัวอย่างของ renderer

## พื้นผิวของข้อผิดพลาด

ความล้มเหลวร้ายแรงจะถูก throw สำหรับ:

- ไม่พบไฟล์ notebook
- JSON ไม่ถูกต้อง
- `cells` ขาดหายหรือไม่ใช่อาร์เรย์
- index อยู่นอกช่วง (insert และ non-insert มีช่วงที่ถูกต้องแตกต่างกัน)
- ไม่มี `content` สำหรับ `edit`/`insert`

สิ่งเหล่านี้กลายเป็น tool responses แบบ `Error:` ที่ upstream; renderer ใช้ notebook path + ข้อความข้อผิดพลาดที่จัดรูปแบบแล้ว

## 3) ความหมายของ Kernel Session (ที่มันมีอยู่จริง)

ความหมายของ Kernel ถูกใช้งานใน `executePython` / `PythonKernel` และใช้กับเครื่องมือ `python`

## โหมด

`PythonKernelMode`:

- `session` (ค่าเริ่มต้น)
  - kernels ถูกแคชใน `kernelSessions` map
  - สูงสุด 4 sessions; ตัวที่เก่าสุดจะถูกลบออกเมื่อล้น
  - ทำความสะอาด idle/dead ทุก 30 วินาที, timeout หลัง 5 นาที
  - คิวต่อ session จัดลำดับการประมวลผล (`session.queue`)
- `per-call`
  - สร้าง kernel สำหรับแต่ละ request
  - ประมวลผล
  - ปิด kernel เสมอใน `finally`

## พฤติกรรมการ Reset

เครื่องมือ `python` ส่ง `reset` เฉพาะ cell แรกในการเรียกแบบ multi-cell เท่านั้น; cells ที่ตามมาจะรันด้วย `reset: false` เสมอ

## Kernel Death / Restart / Retry

ในโหมด session (`withKernelSession`):

- ตรวจพบ kernel ที่ตายด้วย heartbeat (ตรวจสอบ `kernel.isAlive()` ทุก 5 วินาที) หรือความล้มเหลวในการ execute
- สถานะ dead ก่อนรันจะทริกเกอร์ `restartKernelSession`
- เส้นทางการ crash ระหว่าง execute จะลองใหม่หนึ่งครั้ง: restart kernel, รัน handler อีกครั้ง
- `restartCount > 1` ใน session เดียวกันจะ throw `Python kernel restarted too many times in this session`

พฤติกรรมการลองใหม่ตอน Startup:

- การสร้าง shared gateway kernel จะลองใหม่หนึ่งครั้งเมื่อเกิด `SharedGatewayCreateError` ที่มี HTTP 5xx

การกู้คืนจากทรัพยากรหมด:

- ตรวจจับความล้มเหลวแบบ `EMFILE`/`ENFILE`/"Too many open files"
- ล้าง tracked sessions
- เรียก `shutdownSharedGateway()`
- ลองสร้าง kernel session ใหม่หนึ่งครั้ง

## 4) การ Inject ตัวแปร Environment/Session

Kernel startup ได้รับ env map ที่เป็น optional จาก executor:

- `PI_SESSION_FILE` (เส้นทางไฟล์ session state)
- `ARTIFACTS` (ไดเรกทอรี artifact)

`PythonKernel.#initializeKernelEnvironment(...)` จากนั้นจะรัน init script ภายใน kernel เพื่อ:

- `os.chdir(cwd)`
- inject env entries เข้า `os.environ`
- เพิ่ม cwd ไว้หน้า `sys.path` ถ้ายังไม่มี

ความหมายโดยนัย:

- prelude helpers ที่อ่าน session หรือ artifact context อาศัยตัวแปร env เหล่านี้ใน state ของ Python process

## 5) การจัดการ Streaming/Chunk และ Display (เส้นทางที่ทำงานผ่าน kernel)

Kernel client ประมวลผลข้อความ Jupyter protocol ต่อการ execute แต่ละครั้ง:

- `stream` -> text chunk ไปยัง `onChunk`
- `execute_result` / `display_data` ->
  - display text เลือกตามลำดับความสำคัญของ MIME: `text/markdown` > `text/plain` > แปลง `text/html`
  - structured outputs ถูกจับแยกต่างหาก:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (ไม่ปล่อยข้อความ)
- `error` -> traceback text ถูก push ไปยัง chunk stream + structured error metadata
- `input_request` -> ปล่อยข้อความเตือน stdin, ส่ง `input_reply` ว่าง, ทำเครื่องหมายว่ามีการร้องขอ stdin
- การเสร็จสมบูรณ์รอทั้ง `execute_reply` และ kernel `status=idle`

การยกเลิก/Timeout:

- abort signal ทริกเกอร์ `interrupt()` (REST `/interrupt` + control-channel `interrupt_request`)
- ผลลัพธ์ทำเครื่องหมาย `cancelled=true`
- เส้นทาง timeout เพิ่มคำอธิบายใน output ว่า `Command timed out after <n> seconds`

## 6) พฤติกรรมการตัดทอนและ Artifact

`OutputSink` ใน `src/session/streaming-output.ts` ถูกใช้โดยเส้นทางการ execute ของ kernel (`executeWithKernel`):

- sanitize ทุก chunk (`sanitizeText`)
- ติดตามจำนวนบรรทัดและ bytes ทั้งหมด/output
- ไฟล์ artifact spill ที่เป็น optional (`artifactPath`, `artifactId`)
- เมื่อ buffer ในหน่วยความจำเกินเกณฑ์ (`DEFAULT_MAX_BYTES` เว้นแต่จะถูก override):
  - ทำเครื่องหมายว่าถูกตัดทอน
  - เก็บ tail bytes ในหน่วยความจำ (ขอบเขตที่ปลอดภัยสำหรับ UTF-8)
  - สามารถ spill stream ทั้งหมดไปยัง artifact sink

`dump()` คืนค่า:

- ข้อความ output ที่มองเห็นได้ (อาจถูกตัดทอนส่วนท้าย)
- flag การตัดทอน + จำนวนนับ
- artifact ID (สำหรับการอ้างอิง `artifact://<id>`)

เครื่องมือ `python` แปลง metadata นี้เป็นการแจ้งเตือนการตัดทอนผลลัพธ์และคำเตือน TUI

เครื่องมือ `notebook` **ไม่ได้**ใช้ `OutputSink`; มันไม่มี pipeline การตัดทอน stream/artifact เพราะไม่ได้ประมวลผลโค้ด

## 7) สมมติฐานของ Renderer และการจัดรูปแบบ

## Notebook renderer (`notebookToolRenderer`)

- มุมมองการเรียก: บรรทัดสถานะพร้อม action + notebook path + metadata ของ cell/type
- มุมมองผลลัพธ์:
  - สรุปความสำเร็จที่ได้มาจาก `details`
  - `cellSource` แสดงผลผ่าน `renderCodeCell`
  - markdown cells ตั้งค่า language hint เป็น `markdown`; cells อื่นๆ ไม่มีการ override ภาษาอย่างชัดเจน
  - ขีดจำกัดการแสดงตัวอย่างโค้ดแบบย่อคือ `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - รองรับโหมดขยายผ่าน shared render options
  - ใช้ render cache ที่ keyed ด้วย width + expanded state

สมมติฐานการแสดงผลข้อผิดพลาด:

- ถ้าเนื้อหาข้อความแรกเริ่มต้นด้วย `Error:`, renderer จะจัดรูปแบบเป็น notebook error block

## Python renderer (สำหรับ output การประมวลผลจริง)

การแสดงผลการ execute ที่ทำงานผ่าน kernel คาดหวัง:

- การเปลี่ยนสถานะต่อ cell (`pending/running/complete/error`)
- ส่วน structured status event ที่เป็น optional
- JSON output trees ที่เป็น optional
- คำเตือนการตัดทอน + ตัวชี้ `artifact://<id>` ที่เป็น optional

พฤติกรรมของ renderer นี้ไม่เกี่ยวข้องกับผลลัพธ์การแก้ไข JSON ของ `notebook` ยกเว้นว่าทั้งสองใช้ TUI primitives ร่วมกัน

## 8) ความแตกต่างจากพฤติกรรมเครื่องมือ Python แบบธรรมดา

ถ้า "เครื่องมือ Python แบบธรรมดา" หมายถึงเส้นทางการ execute ของ `python`:

- `python` ประมวลผลโค้ดใน kernel, คงอยู่ state ตามโหมด, stream chunks, จับ rich displays, จัดการ interrupts/timeouts, และรองรับการตัดทอน output/artifacts
- `notebook` ทำเฉพาะการเปลี่ยนแปลง notebook JSON แบบ deterministic เท่านั้น; ไม่มีการ execute, ไม่มี kernel state, ไม่มี chunk stream, ไม่มี display outputs, ไม่มี artifact pipeline

ถ้า workflow ต้องการทั้งสองอย่าง:

1. แก้ไข notebook source ด้วย `notebook`
2. execute code cells ผ่าน `python` (ส่งโค้ดด้วยตนเอง) ไม่ใช่ผ่าน `notebook`

การใช้งานปัจจุบันไม่มีเครื่องมือเดียวที่ทั้งเปลี่ยนแปลง `.ipynb` และ execute notebook cells ผ่าน kernel context
