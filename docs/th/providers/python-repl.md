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
ครอบคลุมพฤติกรรมของ tool, วงจรชีวิตของ kernel/gateway, การจัดการ environment, semantics การประมวลผล, การแสดงผลเอาต์พุต, และโหมดความล้มเหลวในการปฏิบัติงาน

## ขอบเขตและไฟล์สำคัญ

- พื้นผิว Tool: `src/tools/python.ts`
- การประสานงาน kernel ต่อ session/ต่อการเรียก: `src/ipy/executor.ts`
- โปรโตคอล Kernel + การผสานรวม gateway: `src/ipy/kernel.ts`
- ตัวประสานงาน local gateway ที่ใช้ร่วมกัน: `src/ipy/gateway-coordinator.ts`
- Renderer สำหรับโหมด interactive สำหรับการรัน Python ที่ผู้ใช้เรียกใช้: `src/modes/components/python-execution.ts`
- การกรอง Runtime/env และการค้นหา Python: `src/ipy/runtime.ts`

## Python tool คืออะไร

`python` tool ประมวลผล Python cell หนึ่งหรือหลาย cell ผ่าน kernel ที่รองรับโดย Jupyter Kernel Gateway (ไม่ใช่การสร้าง `python -c` โดยตรงต่อ cell)

พารามิเตอร์ Tool:

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // หน่วยวินาที, จำกัดระหว่าง 1..600, ค่าเริ่มต้น 30
  cwd?: string;
  reset?: boolean; // รีเซ็ต kernel ก่อน cell แรกเท่านั้น
}
```

Tool นี้มี `concurrency = "exclusive"` ต่อ session ดังนั้นการเรียกจะไม่ทับซ้อนกัน

## วงจรชีวิตของ Gateway

### โหมด

มีเส้นทาง gateway สองแบบ:

1. **External gateway** (ตั้งค่า `PI_PYTHON_GATEWAY_URL`)
   - ใช้ URL ที่กำหนดโดยตรง
   - การตรวจสอบสิทธิ์แบบไม่บังคับด้วย `PI_PYTHON_GATEWAY_TOKEN`
   - ไม่มีการสร้างหรือจัดการ local gateway process

2. **Local shared gateway** (เส้นทางเริ่มต้น)
   - ใช้ process ที่แชร์กันเพียงหนึ่งเดียว ประสานงานภายใต้ `~/.xcsh/agent/python-gateway`
   - ไฟล์ metadata: `gateway.json`
   - ไฟล์ lock: `gateway.lock`
   - คำสั่งสร้าง:
     - `python -m kernel_gateway`
     - ผูกกับ `127.0.0.1:<allocated-port>`
     - การตรวจสอบสุขภาพเมื่อเริ่มต้น: `GET /api/kernelspecs`

### การประสานงาน local shared gateway

`acquireSharedGateway()`:

- ล็อคไฟล์ (`gateway.lock`) พร้อม heartbeat
- นำ `gateway.json` กลับมาใช้หาก PID ยังทำงานอยู่และผ่านการตรวจสอบสุขภาพ
- ล้างข้อมูล/PID ที่ค้างเก่าเมื่อจำเป็น
- เริ่ม gateway ใหม่เมื่อไม่มี gateway ที่ทำงานได้ปกติ

`releaseSharedGateway()` ปัจจุบันไม่ดำเนินการใดๆ (การปิด kernel ไม่ได้ปิด shared gateway)

`shutdownSharedGateway()` สิ้นสุด shared process อย่างชัดเจนและล้าง gateway metadata

### ข้อจำกัดสำคัญ

`python.sharedGateway=false` ถูกปฏิเสธเมื่อเริ่ม kernel:

- ข้อผิดพลาด: `Shared Python gateway required; local gateways are disabled`
- ไม่มีโหมด local gateway แบบไม่แชร์ต่อ process

## วงจรชีวิตของ Kernel

การประมวลผลแต่ละครั้งใช้ kernel ที่สร้างผ่าน `POST /api/kernels` บน gateway ที่เลือก

ลำดับการเริ่มต้น Kernel:

1. การตรวจสอบความพร้อม (`checkPythonKernelAvailability`)
2. สร้าง kernel (`/api/kernels`)
3. เปิด websocket (`/api/kernels/:id/channels`)
4. เริ่มต้น kernel env (`cwd`, env vars, `sys.path`)
5. ประมวลผล `PYTHON_PRELUDE`
6. โหลด extension modules จาก:
   - ผู้ใช้: `~/.xcsh/agent/modules/*.py`
   - โปรเจกต์: `<cwd>/.xcsh/modules/*.py` (แทนที่ user module ที่ชื่อเดียวกัน)

การปิด Kernel:

- ลบ kernel ระยะไกลผ่าน `DELETE /api/kernels/:id`
- ปิด websocket
- เรียก shared gateway release hook (ไม่ดำเนินการในปัจจุบัน)

## Semantics ความต่อเนื่องของ Session

`python.kernelMode` ควบคุมการนำ kernel กลับมาใช้:

- `session` (ค่าเริ่มต้น)
  - นำ kernel sessions กลับมาใช้โดยระบุด้วย session identity + cwd
  - การประมวลผลถูกทำให้เป็นลำดับต่อ session ผ่าน queue
  - Sessions ที่ไม่ได้ใช้งานจะถูกนำออกหลังจาก 5 นาที
  - มี sessions ได้สูงสุด 4 รายการ; รายการที่เก่าที่สุดจะถูกนำออกเมื่อเกินจำนวน
  - การตรวจสอบ Heartbeat ตรวจจับ kernel ที่ตายแล้ว
  - อนุญาตให้รีสตาร์ทอัตโนมัติได้หนึ่งครั้ง; crash ซ้ำ => ความล้มเหลวถาวร

- `per-call`
  - สร้าง kernel ใหม่สำหรับแต่ละ execute request
  - ปิด kernel หลังจาก request
  - ไม่มีการคงสถานะระหว่างการเรียก

### พฤติกรรม Multi-cell ในการเรียก tool เดียว

Cell รันตามลำดับใน kernel instance เดียวกันสำหรับการเรียก tool นั้น

หาก cell กลางล้มเหลว:

- สถานะ cell ก่อนหน้ายังคงอยู่ในหน่วยความจำ
- Tool ส่งคืนข้อผิดพลาดที่ระบุว่า cell ใดล้มเหลว
- Cell ถัดไปจะไม่ถูกประมวลผล

`reset=true` ใช้กับการประมวลผล cell แรกในการเรียกนั้นเท่านั้น

## การกรอง Environment และการค้นหา Runtime

Environment ถูกกรองก่อนเปิดใช้ gateway/kernel runtime:

- Allowlist รวมตัวแปรหลักเช่น `PATH`, `HOME`, locale vars, `VIRTUAL_ENV`, `PYTHONPATH` เป็นต้น
- Allow-prefixes: `LC_`, `XDG_`, `PI_`
- Denylist ลบ API key ทั่วไป (OpenAI/Anthropic/Gemini/ฯลฯ)

ลำดับการเลือก Runtime:

1. venv ที่ใช้งานอยู่/ค้นพบ (`VIRTUAL_ENV` จากนั้น `<cwd>/.venv`, `<cwd>/venv`)
2. Managed venv ที่ `~/.xcsh/python-env`
3. `python` หรือ `python3` บน PATH

เมื่อเลือก venv แล้ว เส้นทาง bin/Scripts จะถูกนำไปใส่ไว้ต้น `PATH`

การเริ่มต้น kernel env ภายใน Python ยังดำเนินการ:

- `os.chdir(cwd)`
- ใส่ env map ที่กำหนดไว้ใน `os.environ`
- ตรวจสอบให้ cwd อยู่ใน `sys.path`

## ความพร้อมของ Tool และการเลือกโหมด

`python.toolMode` (ค่าเริ่มต้น `both`) + `PI_PY` override แบบไม่บังคับควบคุมการเปิดเผย:

- `ipy-only`
- `bash-only`
- `both`

ค่าที่รับได้ของ `PI_PY`:

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

หาก Python preflight ล้มเหลว การสร้าง tool จะลดระดับเป็น bash-only สำหรับ session นั้น

## ขั้นตอนการประมวลผลและการยกเลิก/หมดเวลา

### Timeout ระดับ Tool

Timeout ของ `python` tool เป็นหน่วยวินาที ค่าเริ่มต้น 30 จำกัดระหว่าง `1..600`

Tool รวมกัน:

- abort signal ของผู้เรียก
- abort signal ของ timeout

ด้วย `AbortSignal.any(...)`

### การยกเลิกการประมวลผล Kernel

เมื่อ abort/timeout:

- การประมวลผลถูกทำเครื่องหมายว่ายกเลิก
- พยายามขัดจังหวะ Kernel ผ่าน REST (`POST /interrupt`) และ control-channel `interrupt_request`
- ผลลัพธ์รวม `cancelled=true`
- เส้นทาง timeout ใส่หมายเหตุเอาต์พุตว่า `Command timed out after <n> seconds`

### พฤติกรรม stdin

stdin แบบ interactive ไม่รองรับ

หาก kernel ส่ง `input_request`:

- Tool บันทึก `stdinRequested=true`
- ส่งข้อความอธิบาย
- ส่ง `input_reply` ว่าง
- การประมวลผลถูกจัดการเป็นความล้มเหลวที่ executor layer

## การจับเอาต์พุตและการแสดงผล

### คลาสเอาต์พุตที่จับได้

จาก kernel messages:

- `stream` -> ข้อความ chunk ธรรมดา
- `display_data`/`execute_result` -> การจัดการ rich display
- `error` -> ข้อความ traceback
- MIME แบบกำหนดเอง `application/x-xcsh-status` -> status events แบบมีโครงสร้าง

ลำดับความสำคัญ Display MIME:

1. `text/markdown`
2. `text/plain`
3. `text/html` (แปลงเป็น markdown พื้นฐาน)

นอกจากนี้จับเป็นเอาต์พุตแบบมีโครงสร้าง:

- `application/json` -> ข้อมูล JSON tree
- `image/png` -> payloads รูปภาพ
- `application/x-xcsh-status` -> status events

### การจัดเก็บและการตัดทอน

เอาต์พุตถูก stream ผ่าน `OutputSink` และอาจถูกบันทึกไปยัง artifact storage

ผลลัพธ์ Tool สามารถรวม truncation metadata และ `artifact://<id>` สำหรับการกู้คืนเอาต์พุตทั้งหมด

### พฤติกรรมของ Renderer

- Tool renderer (`python.ts`):
  - แสดง code-cell blocks พร้อมสถานะต่อ cell
  - ค่าเริ่มต้นการแสดงตัวอย่างแบบย่อคือ 10 บรรทัด
  - รองรับโหมดขยายสำหรับเอาต์พุตเต็มและรายละเอียดสถานะที่สมบูรณ์ยิ่งขึ้น
- Interactive renderer (`python-execution.ts`):
  - ใช้สำหรับการรัน Python ที่ผู้ใช้เรียกใช้ใน TUI
  - ค่าเริ่มต้นการแสดงตัวอย่างแบบย่อคือ 20 บรรทัด
  - จำกัดบรรทัดยาวมากไว้ที่ 4000 ตัวอักษรเพื่อความปลอดภัยในการแสดงผล
  - แสดงการแจ้งเตือนการยกเลิก/ข้อผิดพลาด/การตัดทอน

## การรองรับ External Gateway

ตั้งค่า:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# แบบไม่บังคับ:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

ความแตกต่างในพฤติกรรมจาก local shared gateway:

- ไม่มีไฟล์ lock/info ของ local gateway
- ไม่มีการสร้าง/สิ้นสุด local process
- การตรวจสอบสุขภาพและ kernel CRUD ทำงานกับ external endpoint
- ความล้มเหลวในการตรวจสอบสิทธิ์จะแสดงพร้อมคำแนะนำ token ที่ชัดเจน

## การแก้ไขปัญหาการปฏิบัติงาน (โหมดความล้มเหลวปัจจุบัน)

- **Python tool ไม่พร้อมใช้งาน**
  - ตรวจสอบ `python.toolMode` / `PI_PY`
  - หาก preflight ล้มเหลว runtime จะลดระดับเป็น bash-only

- **ข้อผิดพลาดความพร้อมของ Kernel**
  - โหมด Local ต้องการให้ทั้ง `kernel_gateway` และ `ipykernel` สามารถ import ได้ใน Python runtime ที่ค้นพบ
  - ติดตั้งด้วย:

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` ทำให้เกิดความล้มเหลวในการเริ่มต้น**
  - นี่เป็นพฤติกรรมที่คาดหวังตาม implementation ปัจจุบัน

- **ความล้มเหลวในการตรวจสอบสิทธิ์/การเข้าถึง External gateway**
  - 401/403 -> ตั้งค่า `PI_PYTHON_GATEWAY_TOKEN`
  - timeout/ไม่สามารถเข้าถึงได้ -> ตรวจสอบ URL/เครือข่าย และสุขภาพของ gateway

- **การประมวลผลค้างแล้วหมดเวลา**
  - เพิ่ม `timeout` ของ tool (สูงสุด 600 วินาที) หากปริมาณงานมีความถูกต้องตามกฎหมาย
  - สำหรับโค้ดที่ค้าง การยกเลิกจะเรียก kernel interrupt แต่โค้ดผู้ใช้อาจยังต้องปรับโครงสร้างใหม่

- **stdin/input prompts ในโค้ด Python**
  - `input()` ไม่รองรับแบบ interactive ในเส้นทาง runtime นี้; ส่งข้อมูลผ่านโปรแกรม

- **การสิ้นเปลือง resource (`EMFILE` / ไฟล์ที่เปิดมากเกินไป)**
  - Session manager เรียก shared-gateway recovery (การปิด session + การรีสตาร์ท shared gateway)

- **ข้อผิดพลาด Working directory**
  - Tool ตรวจสอบว่า `cwd` มีอยู่และเป็น directory ก่อนการประมวลผล

## Environment variables ที่เกี่ยวข้อง

- `PI_PY` — การ override การเปิดเผย tool (`bash-only`/`ipy-only`/`both` ตามการแมปข้างต้น)
- `PI_PYTHON_GATEWAY_URL` — ใช้ external gateway
- `PI_PYTHON_GATEWAY_TOKEN` — auth token สำหรับ external gateway แบบไม่บังคับ
- `PI_PYTHON_SKIP_CHECK=1` — ข้ามการตรวจสอบ Python preflight/warm
- `PI_PYTHON_IPC_TRACE=1` — บันทึก log การส่ง/รับ kernel IPC traces
- `PI_DEBUG_STARTUP=1` — ส่งออก debug markers ระยะเริ่มต้น
