---
title: Python Tool และ IPython Runtime
description: >-
  Python REPL tool runtime พร้อมการจัดการ IPython kernel, การประมวลผล,
  และการจับเอาต์พุต
sidebar:
  order: 3
  label: Python & IPython
i18n:
  sourceHash: 70f0a034ecef
  translator: machine
---

# Python Tool และ IPython Runtime

เอกสารนี้อธิบาย Python execution stack ปัจจุบันใน `packages/coding-agent`
ครอบคลุมพฤติกรรมของ tool, วงจรชีวิต kernel/gateway, การจัดการ environment, ความหมายของการประมวลผล, การแสดงผล output, และโหมดความล้มเหลวในการดำเนินงาน

## ขอบเขตและไฟล์หลัก

- พื้นผิว Tool: `src/tools/python.ts`
- การจัดการ kernel ต่อ session/ต่อการเรียก: `src/ipy/executor.ts`
- โปรโตคอล Kernel + การผสานรวม gateway: `src/ipy/kernel.ts`
- ตัวประสานงาน local gateway ที่ใช้ร่วมกัน: `src/ipy/gateway-coordinator.ts`
- Renderer สำหรับโหมดโต้ตอบสำหรับการรัน Python ที่ผู้ใช้เรียกใช้: `src/modes/components/python-execution.ts`
- การกรอง Runtime/env และการระบุ Python: `src/ipy/runtime.ts`

## Python tool คืออะไร

`python` tool ประมวลผล Python cell หนึ่งเซลล์หรือมากกว่าผ่าน kernel ที่ได้รับการสนับสนุนจาก Jupyter Kernel Gateway (ไม่ใช่การ spawn `python -c` โดยตรงต่อ cell)

พารามิเตอร์ของ tool:

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // วินาที, จำกัดที่ 1..600, ค่าเริ่มต้น 30
  cwd?: string;
  reset?: boolean; // รีเซ็ต kernel ก่อน cell แรกเท่านั้น
}
```

Tool นี้มี `concurrency = "exclusive"` สำหรับ session จึงไม่มีการเรียกซ้อนกัน

## วงจรชีวิต Gateway

### โหมด

มีเส้นทาง gateway สองแบบ:

1. **External gateway** (ตั้งค่า `PI_PYTHON_GATEWAY_URL`)
   - ใช้ URL ที่กำหนดค่าโดยตรง
   - รองรับการยืนยันตัวตนด้วย `PI_PYTHON_GATEWAY_TOKEN` (ไม่บังคับ)
   - ไม่มีการ spawn หรือจัดการกระบวนการ local gateway

2. **Local shared gateway** (เส้นทางเริ่มต้น)
   - ใช้กระบวนการที่ใช้ร่วมกันเดียวที่ประสานงานภายใต้ `~/.xcsh/agent/python-gateway`
   - ไฟล์ metadata: `gateway.json`
   - ไฟล์ lock: `gateway.lock`
   - คำสั่ง Spawn:
     - `python -m kernel_gateway`
     - ผูกกับ `127.0.0.1:<allocated-port>`
     - การตรวจสอบสุขภาพเมื่อเริ่มต้น: `GET /api/kernelspecs`

### การประสานงาน local shared gateway

`acquireSharedGateway()`:

- รับ file lock (`gateway.lock`) พร้อม heartbeat
- นำ `gateway.json` กลับมาใช้หาก PID ยังทำงานอยู่และผ่านการตรวจสอบสุขภาพ
- ล้างข้อมูล/PID ที่ล้าสมัยเมื่อจำเป็น
- เริ่ม gateway ใหม่เมื่อไม่มี gateway ที่ดีอยู่

`releaseSharedGateway()` ปัจจุบันเป็น no-op (การปิด kernel ไม่ทำลาย shared gateway)

`shutdownSharedGateway()` สิ้นสุดกระบวนการที่ใช้ร่วมกันอย่างชัดเจนและล้าง gateway metadata

### ข้อจำกัดสำคัญ

`python.sharedGateway=false` จะถูกปฏิเสธเมื่อเริ่มต้น kernel:

- ข้อผิดพลาด: `Shared Python gateway required; local gateways are disabled`
- ไม่มีโหมด local gateway ที่ไม่ใช้ร่วมกันต่อกระบวนการ

## วงจรชีวิต Kernel

การประมวลผลแต่ละครั้งใช้ kernel ที่สร้างผ่าน `POST /api/kernels` บน gateway ที่เลือก

ลำดับการเริ่มต้น Kernel:

1. การตรวจสอบความพร้อมใช้งาน (`checkPythonKernelAvailability`)
2. สร้าง kernel (`/api/kernels`)
3. เปิด websocket (`/api/kernels/:id/channels`)
4. เริ่มต้น kernel env (`cwd`, env vars, `sys.path`)
5. ประมวลผล `PYTHON_PRELUDE`
6. โหลด extension modules จาก:
   - ผู้ใช้: `~/.xcsh/agent/modules/*.py`
   - โปรเจกต์: `<cwd>/.xcsh/modules/*.py` (แทนที่ user module ที่มีชื่อเดียวกัน)

การปิด Kernel:

- ลบ remote kernel ผ่าน `DELETE /api/kernels/:id`
- ปิด websocket
- เรียก shared gateway release hook (เป็น no-op ในปัจจุบัน)

## ความหมายของการคงอยู่ของ Session

`python.kernelMode` ควบคุมการนำ kernel กลับมาใช้:

- `session` (ค่าเริ่มต้น)
  - นำ kernel sessions กลับมาใช้โดยกำหนดด้วย session identity + cwd
  - การประมวลผลถูก serialize ต่อ session ผ่าน queue
  - Sessions ที่ไม่ได้ใช้งานจะถูกลบออกหลัง 5 นาที
  - มีได้ไม่เกิน 4 sessions; session เก่าที่สุดจะถูกลบเมื่อเกินกำหนด
  - การตรวจสอบ Heartbeat ตรวจจับ kernel ที่ตายแล้ว
  - อนุญาตให้รีสตาร์ทอัตโนมัติได้หนึ่งครั้ง; crash ซ้ำ => ความล้มเหลวถาวร

- `per-call`
  - สร้าง kernel ใหม่สำหรับแต่ละคำขอประมวลผล
  - ปิด kernel หลังจากคำขอ
  - ไม่มีการคงอยู่ของสถานะข้ามการเรียก

### พฤติกรรม multi-cell ในการเรียก tool ครั้งเดียว

Cells ทำงานตามลำดับใน kernel instance เดียวกันสำหรับการเรียก tool นั้น

หาก cell กลางล้มเหลว:

- สถานะของ cell ก่อนหน้ายังคงอยู่ในหน่วยความจำ
- Tool คืนค่าข้อผิดพลาดเฉพาะเจาะจงที่ระบุว่า cell ใดล้มเหลว
- Cells ถัดไปจะไม่ถูกประมวลผล

`reset=true` ใช้ได้เฉพาะกับการประมวลผล cell แรกในการเรียกนั้นเท่านั้น

## การกรอง Environment และการระบุ Runtime

Environment ถูกกรองก่อนการเรียกใช้ gateway/kernel runtime:

- Allowlist รวมถึง core vars เช่น `PATH`, `HOME`, locale vars, `VIRTUAL_ENV`, `PYTHONPATH`, เป็นต้น
- Allow-prefixes: `LC_`, `XDG_`, `PI_`
- Denylist ลบ API keys ทั่วไป (OpenAI/Anthropic/Gemini/ฯลฯ)

ลำดับการเลือก Runtime:

1. Active/located venv (`VIRTUAL_ENV`, จากนั้น `<cwd>/.venv`, `<cwd>/venv`)
2. Managed venv ที่ `~/.xcsh/python-env`
3. `python` หรือ `python3` บน PATH

เมื่อเลือก venv แล้ว เส้นทาง bin/Scripts ของมันจะถูกนำหน้า `PATH`

การเริ่มต้น kernel env ภายใน Python ยังรวมถึง:

- `os.chdir(cwd)`
- inject env map ที่ให้มาเข้าไปใน `os.environ`
- ตรวจสอบให้แน่ใจว่า cwd อยู่ใน `sys.path`

## ความพร้อมใช้งานของ Tool และการเลือกโหมด

`python.toolMode` (ค่าเริ่มต้น `both`) + การแทนที่ `PI_PY` ที่ไม่บังคับควบคุมการเปิดเผย:

- `ipy-only`
- `bash-only`
- `both`

ค่าที่ยอมรับของ `PI_PY`:

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

หาก Python preflight ล้มเหลว การสร้าง tool จะลดระดับเป็น bash-only สำหรับ session นั้น

##흐름 การประมวลผลและการยกเลิก/หมดเวลา

### หมดเวลาระดับ Tool

หมดเวลาของ `python` tool เป็นวินาที, ค่าเริ่มต้น 30, จำกัดที่ `1..600`

Tool รวมกัน:

- สัญญาณยกเลิกของผู้เรียก
- สัญญาณยกเลิกเมื่อหมดเวลา

ด้วย `AbortSignal.any(...)`

### การยกเลิกการประมวลผล Kernel

เมื่อยกเลิก/หมดเวลา:

- การประมวลผลถูกทำเครื่องหมายว่ายกเลิกแล้ว
- พยายามขัดจังหวะ Kernel ผ่าน REST (`POST /interrupt`) และ control-channel `interrupt_request`
- ผลลัพธ์รวมถึง `cancelled=true`
- เส้นทางหมดเวลาจะใส่คำอธิบายประกอบ output ว่า `Command timed out after <n> seconds`

### พฤติกรรม stdin

ไม่รองรับ stdin แบบโต้ตอบ

หาก kernel ส่ง `input_request`:

- Tool บันทึก `stdinRequested=true`
- ส่งออกข้อความอธิบาย
- ส่ง `input_reply` ว่างเปล่า
- การประมวลผลถือว่าล้มเหลวที่ชั้น executor

## การจับ Output และการแสดงผล

### ประเภท output ที่จับได้

จาก kernel messages:

- `stream` -> ข้อความธรรมดาเป็นชิ้นๆ
- `display_data`/`execute_result` -> การจัดการแสดงผลแบบ rich
- `error` -> ข้อความ traceback
- MIME แบบกำหนดเอง `application/x-xcsh-status` -> events สถานะที่มีโครงสร้าง

ลำดับความสำคัญของ MIME ในการแสดงผล:

1. `text/markdown`
2. `text/plain`
3. `text/html` (แปลงเป็น markdown พื้นฐาน)

จับเพิ่มเติมเป็น structured outputs:

- `application/json` -> ข้อมูล JSON tree
- `image/png` -> ข้อมูล image
- `application/x-xcsh-status` -> status events

### การจัดเก็บและการตัดทอน

Output ถูก stream ผ่าน `OutputSink` และอาจถูกบันทึกไปยัง artifact storage

ผลลัพธ์ Tool สามารถรวม truncation metadata และ `artifact://<id>` สำหรับการกู้คืน output เต็มรูปแบบ

### พฤติกรรม Renderer

- Tool renderer (`python.ts`):
  - แสดง code-cell blocks พร้อมสถานะต่อ cell
  - การแสดงตัวอย่างแบบ collapsed ค่าเริ่มต้น 10 บรรทัด
  - รองรับโหมดขยายสำหรับ output เต็มรูปแบบและรายละเอียดสถานะที่ละเอียดขึ้น
- Interactive renderer (`python-execution.ts`):
  - ใช้สำหรับการประมวลผล Python ที่ผู้ใช้เรียกใช้ใน TUI
  - การแสดงตัวอย่างแบบ collapsed ค่าเริ่มต้น 20 บรรทัด
  - จำกัดบรรทัดยาวมากที่ 4000 ตัวอักษรเพื่อความปลอดภัยในการแสดงผล
  - แสดงการแจ้งเตือนการยกเลิก/ข้อผิดพลาด/การตัดทอน

## การรองรับ External Gateway

ตั้งค่า:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# ไม่บังคับ:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

ความแตกต่างของพฤติกรรมจาก local shared gateway:

- ไม่มี lock/info files ของ local gateway
- ไม่มีการ spawn/สิ้นสุดกระบวนการ local
- การตรวจสอบสุขภาพและ kernel CRUD ทำงานกับ external endpoint
- ความล้มเหลวในการยืนยันตัวตนจะแสดงพร้อมคำแนะนำเกี่ยวกับ token อย่างชัดเจน

## การแก้ไขปัญหาในการดำเนินงาน (โหมดความล้มเหลวปัจจุบัน)

- **Python tool ไม่พร้อมใช้งาน**
  - ตรวจสอบ `python.toolMode` / `PI_PY`
  - หาก preflight ล้มเหลว runtime จะ fallback เป็น bash-only

- **ข้อผิดพลาดความพร้อมใช้งานของ Kernel**
  - โหมด Local ต้องการทั้ง `kernel_gateway` และ `ipykernel` ที่ import ได้ใน Python runtime ที่ระบุ
  - ติดตั้งด้วย:

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` ทำให้เกิดความล้มเหลวในการเริ่มต้น**
  - นี่เป็นสิ่งที่คาดหวังกับการใช้งานปัจจุบัน

- **ความล้มเหลวในการยืนยันตัวตน/การเข้าถึง External gateway**
  - 401/403 -> ตั้งค่า `PI_PYTHON_GATEWAY_TOKEN`
  - หมดเวลา/เข้าถึงไม่ได้ -> ตรวจสอบ URL/เครือข่ายและสุขภาพ gateway

- **การประมวลผลค้างแล้วหมดเวลา**
  - เพิ่ม `timeout` ของ tool (สูงสุด 600s) หากปริมาณงานถูกต้องตามกฎหมาย
  - สำหรับโค้ดที่ค้าง การยกเลิกจะเรียกให้ kernel ขัดจังหวะแต่โค้ดของผู้ใช้อาจยังต้องปรับปรุง

- **stdin/input prompts ใน Python code**
  - ไม่รองรับ `input()` แบบโต้ตอบใน runtime path นี้; ส่งข้อมูลแบบ programmatic

- **การใช้ทรัพยากรเกินขีดจำกัด (`EMFILE` / ไฟล์เปิดมากเกินไป)**
  - Session manager เรียกใช้การกู้คืน shared-gateway (การทำลาย session + การรีสตาร์ท shared gateway)

- **ข้อผิดพลาดของไดเรกทอรีทำงาน**
  - Tool ตรวจสอบว่า `cwd` มีอยู่และเป็นไดเรกทอรีก่อนการประมวลผล

## Environment Variables ที่เกี่ยวข้อง

- `PI_PY` — การแทนที่การเปิดเผย tool (`bash-only`/`ipy-only`/`both` ตามการ mapping ข้างต้น)
- `PI_PYTHON_GATEWAY_URL` — ใช้ external gateway
- `PI_PYTHON_GATEWAY_TOKEN` — token ยืนยันตัวตน external gateway (ไม่บังคับ)
- `PI_PYTHON_SKIP_CHECK=1` — ข้าม Python preflight/warm checks
- `PI_PYTHON_IPC_TRACE=1` — บันทึก kernel IPC send/receive traces
- `PI_DEBUG_STARTUP=1` — ส่ง debug markers ของ startup-stage
