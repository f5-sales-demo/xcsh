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

# รายละเอียดภายในของ Notebook tool runtime

เอกสารนี้อธิบายการ implement `notebook` tool ในปัจจุบันและความสัมพันธ์กับ Python runtime ที่มี kernel เป็นแกนหลัก

ความแตกต่างที่สำคัญ: **`notebook` คือตัวแก้ไข JSON notebook ไม่ใช่ตัวรัน notebook** มันแก้ไข cell sources ของ `.ipynb` โดยตรง ไม่ได้เริ่มหรือสื่อสารกับ Python kernel

## ไฟล์ที่เกี่ยวข้องกับการ implement

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) ขอบเขต runtime: การแก้ไข vs การรัน

## `notebook` tool (`src/tools/notebook.ts`)

- รองรับ `action: edit | insert | delete` บนไฟล์ `.ipynb`
- แปลง path ให้สัมพันธ์กับ session CWD (`resolveToCwd`)
- โหลด notebook JSON, ตรวจสอบ `cells` array, ตรวจสอบขอบเขตของ `cell_index`
- ปรับแก้ source ใน memory และเขียน notebook JSON ทั้งหมดกลับด้วย `JSON.stringify(notebook, null, 1)`
- คืนค่าสรุปเป็นข้อความ + `details` แบบโครงสร้าง (`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`)

ไม่มี kernel lifecycle ใน tool นี้:

- ไม่มีการขอใช้ gateway
- ไม่มี kernel session ID
- ไม่มี `execute_request`
- ไม่มี stream chunks จาก kernel channels
- ไม่มีการจับ rich display (`image/png`, JSON display, status MIME)

## เส้นทางการรันแบบ Notebook (`src/tools/python.ts` + `src/ipy/*`)

เมื่อ agent ต้องการรันโค้ด Python แบบ cell-style (cells ตามลำดับ, state ที่คงอยู่, rich displays) จะผ่านทาง **`python` tool** ไม่ใช่ `notebook`

เส้นทางนี้เป็นที่ที่ kernel modes, พฤติกรรม restart/cancel, chunk streaming และ output artifact truncation อยู่

## 2) ความหมายของการจัดการ notebook cell (`notebook` tool)

## การทำให้ source เป็นมาตรฐาน

`content` จะถูกแยกเป็น `source: string[]` โดยรักษา newline:

- แต่ละบรรทัดที่ไม่ใช่บรรทัดสุดท้ายจะรักษา `\n` ท้ายบรรทัดไว้
- บรรทัดสุดท้ายไม่มีการบังคับ newline ท้ายบรรทัด

สิ่งนี้สอดคล้องกับข้อตกลงของ notebook JSON และหลีกเลี่ยงการต่อบรรทัดโดยไม่ตั้งใจในการแก้ไขครั้งถัดไป

## พฤติกรรมของ action

- `edit`
  - แทนที่ `cells[cell_index].source`
  - รักษา `cell_type` ที่มีอยู่
- `insert`
  - แทรกที่ตำแหน่ง `[0..cellCount]`
  - `cell_type` มีค่าเริ่มต้นเป็น `code`
  - code cells กำหนดค่าเริ่มต้น `execution_count: null` และ `outputs: []`
  - markdown cells กำหนดค่าเริ่มต้นเฉพาะ `metadata` + `source`
- `delete`
  - ลบ `cells[cell_index]`
  - คืนค่า `source` ที่ถูกลบใน details สำหรับการแสดงตัวอย่างใน renderer

## พื้นผิวข้อผิดพลาด

ข้อผิดพลาดร้ายแรงจะถูก throw สำหรับ:

- ไม่พบไฟล์ notebook
- JSON ไม่ถูกต้อง
- ไม่มีหรือ `cells` ไม่เป็น array
- index อยู่นอกช่วง (insert และ non-insert มีช่วงที่ถูกต้องต่างกัน)
- ไม่มี `content` สำหรับ `edit`/`insert`

สิ่งเหล่านี้จะกลายเป็น tool responses แบบ `Error:` ที่ upstream; renderer ใช้ notebook path + ข้อความ error ที่จัดรูปแบบแล้ว

## 3) ความหมายของ kernel session (ที่มีอยู่จริง)

ความหมายของ kernel ถูก implement ใน `executePython` / `PythonKernel` และนำไปใช้กับ `python` tool

## โหมด

`PythonKernelMode`:

- `session` (ค่าเริ่มต้น)
  - kernels ถูกแคชใน `kernelSessions` map
  - สูงสุด 4 sessions; ตัวที่เก่าที่สุดจะถูกลบออกเมื่อเกิน overflow
  - ทำความสะอาด idle/dead ทุก 30 วินาที, timeout หลัง 5 นาที
  - queue ต่อ session จัดลำดับการรัน (`session.queue`)
- `per-call`
  - สร้าง kernel สำหรับแต่ละ request
  - รัน
  - ปิด kernel เสมอใน `finally`

## พฤติกรรมการรีเซ็ต

`python` tool ส่ง `reset` เฉพาะ cell แรกในการเรียกแบบ multi-cell; cells ที่ตามมาจะรันด้วย `reset: false` เสมอ

## Kernel ตาย / restart / retry

ในโหมด session (`withKernelSession`):

- ตรวจพบ kernel ที่ตายโดย heartbeat (ตรวจสอบ `kernel.isAlive()` ทุก 5 วินาที) หรือจากการรันล้มเหลว
- สถานะตายก่อนรันจะกระตุ้น `restartKernelSession`
- เส้นทาง crash ขณะรันจะ retry หนึ่งครั้ง: restart kernel, รัน handler อีกครั้ง
- `restartCount > 1` ใน session เดียวกันจะ throw `Python kernel restarted too many times in this session`

พฤติกรรม retry เมื่อเริ่มต้น:

- การสร้าง kernel ของ shared gateway จะ retry หนึ่งครั้งเมื่อเกิด `SharedGatewayCreateError` ที่มี HTTP 5xx

การกู้คืนจากทรัพยากรหมด:

- ตรวจจับ `EMFILE`/`ENFILE`/"Too many open files" แบบ failures
- ล้าง sessions ที่ติดตามอยู่
- เรียก `shutdownSharedGateway()`
- retry การสร้าง kernel session หนึ่งครั้ง

## 4) การ inject ตัวแปร environment/session

Kernel startup ได้รับ env map ที่เป็น optional จาก executor:

- `PI_SESSION_FILE` (เส้นทางไฟล์ session state)
- `ARTIFACTS` (ไดเรกทอรี artifact)

`PythonKernel.#initializeKernelEnvironment(...)` จากนั้นรัน init script ภายใน kernel เพื่อ:

- `os.chdir(cwd)`
- inject env entries เข้าไปใน `os.environ`
- เพิ่ม cwd ไว้ต้น `sys.path` หากยังไม่มี

ผลที่ตามมา:

- prelude helpers ที่อ่าน session หรือ artifact context พึ่งพาตัวแปร env เหล่านี้ใน Python process state

## 5) การจัดการ streaming/chunk และ display (เส้นทางที่มี kernel เป็นแกนหลัก)

Kernel client ประมวลผล Jupyter protocol messages ต่อการรัน:

- `stream` -> text chunk ไปยัง `onChunk`
- `execute_result` / `display_data` ->
  - display text ถูกเลือกตามลำดับ MIME: `text/markdown` > `text/plain` > แปลงจาก `text/html`
  - structured outputs ถูกจับแยกต่างหาก:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (ไม่มีการส่งออกข้อความ)
- `error` -> traceback text ถูก push ไปยัง chunk stream + structured error metadata
- `input_request` -> ส่งออกข้อความแจ้งเตือน stdin, ส่ง `input_reply` ว่าง, ทำเครื่องหมาย stdin requested
- completion รอทั้ง `execute_reply` และ kernel `status=idle`

การยกเลิก/timeout:

- abort signal กระตุ้น `interrupt()` (REST `/interrupt` + control-channel `interrupt_request`)
- ผลลัพธ์ทำเครื่องหมาย `cancelled=true`
- เส้นทาง timeout เพิ่มหมายเหตุใน output ว่า `Command timed out after <n> seconds`

## 6) พฤติกรรมการตัดทอนและ artifact

`OutputSink` ใน `src/session/streaming-output.ts` ถูกใช้โดยเส้นทางการรัน kernel (`executeWithKernel`):

- sanitize ทุก chunk (`sanitizeText`)
- ติดตามจำนวนบรรทัดและไบต์ทั้งหมด/output
- ไฟล์ artifact spill ที่เป็น optional (`artifactPath`, `artifactId`)
- เมื่อ buffer ใน memory เกินขีดจำกัด (`DEFAULT_MAX_BYTES` เว้นแต่จะถูก override):
  - ทำเครื่องหมายว่าถูกตัดทอน
  - เก็บ tail bytes ใน memory (ขอบเขตที่ปลอดภัยสำหรับ UTF-8)
  - สามารถ spill stream ทั้งหมดไปยัง artifact sink

`dump()` คืนค่า:

- ข้อความ output ที่มองเห็นได้ (อาจถูกตัดทอนส่วนท้าย)
- flag การตัดทอน + จำนวน
- artifact ID (สำหรับการอ้างอิง `artifact://<id>`)

`python` tool แปลง metadata นี้เป็นการแจ้งเตือนการตัดทอนผลลัพธ์และคำเตือน TUI

`notebook` tool **ไม่ได้** ใช้ `OutputSink`; ไม่มี pipeline สำหรับการตัดทอน stream/artifact เพราะไม่ได้รันโค้ด

## 7) สมมติฐานของ renderer และการจัดรูปแบบ

## Notebook renderer (`notebookToolRenderer`)

- มุมมอง call: บรรทัดสถานะพร้อม action + notebook path + metadata ของ cell/type
- มุมมอง result:
  - สรุปความสำเร็จที่ได้จาก `details`
  - `cellSource` แสดงผลผ่าน `renderCodeCell`
  - markdown cells ตั้ง language hint เป็น `markdown`; cells อื่นไม่มีการ override ภาษาอย่างชัดเจน
  - ขีดจำกัดการแสดงตัวอย่างโค้ดแบบย่อคือ `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - รองรับโหมดขยายผ่าน shared render options
  - ใช้ render cache ที่คีย์ด้วย width + expanded state

สมมติฐานการแสดงผลข้อผิดพลาด:

- หากเนื้อหาข้อความแรกเริ่มต้นด้วย `Error:`, renderer จัดรูปแบบเป็น notebook error block

## Python renderer (สำหรับ output จากการรันจริง)

การแสดงผลจากการรันที่มี kernel เป็นแกนหลักคาดหวัง:

- การเปลี่ยนสถานะต่อ cell (`pending/running/complete/error`)
- ส่วนเหตุการณ์สถานะแบบโครงสร้างที่เป็น optional
- JSON output trees ที่เป็น optional
- คำเตือนการตัดทอน + ตัวชี้ `artifact://<id>` ที่เป็น optional

พฤติกรรมของ renderer นี้ไม่เกี่ยวข้องกับผลลัพธ์การแก้ไข JSON ของ `notebook` ยกเว้นว่าทั้งสองใช้ shared TUI primitives ร่วมกัน

## 8) ความแตกต่างจากพฤติกรรมของ plain Python tool

ถ้า "plain Python tool" หมายถึงเส้นทางการรันของ `python`:

- `python` รันโค้ดใน kernel, คงสถานะตามโหมด, stream chunks, จับ rich displays, จัดการ interrupts/timeouts และรองรับการตัดทอน output/artifacts
- `notebook` ทำเฉพาะ mutations ที่กำหนดได้แน่นอนบน notebook JSON เท่านั้น; ไม่มีการรัน, ไม่มี kernel state, ไม่มี chunk stream, ไม่มี display outputs, ไม่มี artifact pipeline

หาก workflow ต้องการทั้งสอง:

1. แก้ไข notebook source ด้วย `notebook`
2. รัน code cells ผ่าน `python` (ส่งโค้ดด้วยตนเอง) ไม่ใช่ผ่าน `notebook`

การ implement ปัจจุบันไม่มี tool เดียวที่ทั้งแก้ไข `.ipynb` และรัน notebook cells ผ่าน kernel context
