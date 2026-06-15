---
title: เครื่องมือ Python และ IPython Runtime
description: >-
  Python REPL tool runtime พร้อมการจัดการ IPython kernel, การประมวลผล
  และการจับภาพผลลัพธ์
sidebar:
  order: 3
  label: Python และ IPython
i18n:
  sourceHash: 70f0a034ecef
  translator: machine
---

# เครื่องมือ Python และ IPython Runtime

เอกสารนี้อธิบาย Python execution stack ปัจจุบันใน `packages/coding-agent`
ครอบคลุมพฤติกรรมของ tool, วงจรชีวิต kernel/gateway, การจัดการ environment, ความหมายของการประมวลผล, การแสดงผลลัพธ์ และรูปแบบความล้มเหลวในการปฏิบัติงาน

## ขอบเขตและไฟล์สำคัญ

- พื้นผิวของ tool: `src/tools/python.ts`
- การจัดการ kernel ต่อ session/การเรียก: `src/ipy/executor.ts`
- โปรโตคอล kernel + การรวม gateway: `src/ipy/kernel.ts`
- ตัวประสานงาน local gateway ที่ใช้ร่วมกัน: `src/ipy/gateway-coordinator.ts`
- Renderer สำหรับโหมดโต้ตอบเมื่อผู้ใช้เรียกใช้ Python: `src/modes/components/python-execution.ts`
- การกรอง runtime/env และการระบุตำแหน่ง Python: `src/ipy/runtime.ts`

## เครื่องมือ Python คืออะไร

เครื่องมือ `python` ประมวลผล Python cell หนึ่งหรือหลาย cell ผ่าน kernel ที่รองรับโดย Jupyter Kernel Gateway (ไม่ใช่การ spawn `python -c` โดยตรงต่อ cell)

พารามิเตอร์ของ tool:

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // วินาที, จำกัดในช่วง 1..600, ค่าเริ่มต้น 30
  cwd?: string;
  reset?: boolean; // รีเซ็ต kernel ก่อน cell แรกเท่านั้น
}
```

tool มีค่า `concurrency = "exclusive"` ต่อ session ดังนั้นการเรียกจึงไม่ทับซ้อนกัน

## วงจรชีวิตของ Gateway

### โหมด

มี gateway path สองแบบ:

1. **External gateway** (ตั้งค่า `PI_PYTHON_GATEWAY_URL`)
   - ใช้ URL ที่กำหนดโดยตรง
   - การยืนยันตัวตนเพิ่มเติมด้วย `PI_PYTHON_GATEWAY_TOKEN`
   - ไม่มีการ spawn หรือจัดการ local gateway process

2. **Local shared gateway** (เส้นทางเริ่มต้น)
   - ใช้ process ที่ใช้ร่วมกันหนึ่งตัวซึ่งประสานงานภายใต้ `~/.xcsh/agent/python-gateway`
   - ไฟล์ metadata: `gateway.json`
   - ไฟล์ lock: `gateway.lock`
   - คำสั่ง spawn:
     - `python -m kernel_gateway`
     - ผูกกับ `127.0.0.1:<allocated-port>`
     - การตรวจสอบสุขภาพเมื่อเริ่มต้น: `GET /api/kernelspecs`

### การประสานงาน local shared gateway

`acquireSharedGateway()`:

- ใช้ file lock (`gateway.lock`) พร้อม heartbeat
- นำ `gateway.json` กลับมาใช้ใหม่หาก PID ยังทำงานอยู่และผ่านการตรวจสอบสุขภาพ
- ล้างข้อมูล/PID ที่หมดอายุเมื่อจำเป็น
- เริ่มต้น gateway ใหม่เมื่อไม่มี gateway ที่ใช้งานได้

`releaseSharedGateway()` ปัจจุบันเป็น no-op (การปิด kernel ไม่ได้ปิด shared gateway)

`shutdownSharedGateway()` ยุติ shared process โดยชัดเจนและล้าง gateway metadata

### ข้อจำกัดสำคัญ

`python.sharedGateway=false` จะถูกปฏิเสธเมื่อเริ่มต้น kernel:

- ข้อผิดพลาด: `Shared Python gateway required; local gateways are disabled`
- ไม่มีโหมด local gateway แบบไม่ใช้ร่วมกันต่อ process

## วงจรชีวิตของ Kernel

การประมวลผลแต่ละครั้งใช้ kernel ที่สร้างผ่าน `POST /api/kernels` บน gateway ที่เลือก

ลำดับการเริ่มต้น kernel:

1. การตรวจสอบความพร้อม (`checkPythonKernelAvailability`)
2. สร้าง kernel (`/api/kernels`)
3. เปิด websocket (`/api/kernels/:id/channels`)
4. เริ่มต้น kernel env (`cwd`, env vars, `sys.path`)
5. ประมวลผล `PYTHON_PRELUDE`
6. โหลด extension module จาก:
   - ผู้ใช้: `~/.xcsh/agent/modules/*.py`
   - โปรเจกต์: `<cwd>/.xcsh/modules/*.py` (แทนที่ module ของผู้ใช้ที่มีชื่อเดียวกัน)

การปิด kernel:

- ลบ remote kernel ผ่าน `DELETE /api/kernels/:id`
- ปิด websocket
- เรียก shared gateway release hook (ปัจจุบันเป็น no-op)

## ความหมายของการคงสถานะ Session

`python.kernelMode` ควบคุมการนำ kernel กลับมาใช้ใหม่:

- `session` (ค่าเริ่มต้น)
  - นำ kernel session กลับมาใช้ใหม่โดยใช้ session identity + cwd เป็นคีย์
  - การประมวลผลถูก serialize ต่อ session ผ่าน queue
  - Session ที่ไม่ได้ใช้งานจะถูกลบออกหลังจาก 5 นาที
  - จำกัดไว้ที่ 4 session; session เก่าที่สุดจะถูกลบออกเมื่อเกิน
  - การตรวจสอบ heartbeat ตรวจจับ kernel ที่ตาย
  - อนุญาตให้รีสตาร์ทอัตโนมัติได้หนึ่งครั้ง; การ crash ซ้ำ => ความล้มเหลวถาวร

- `per-call`
  - สร้าง kernel ใหม่สำหรับแต่ละคำขอประมวลผล
  - ปิด kernel หลังจากคำขอ
  - ไม่มีการคงสถานะข้ามการเรียก

### พฤติกรรมหลาย cell ในการเรียก tool ครั้งเดียว

Cell ทำงานตามลำดับในอินสแตนซ์ kernel เดียวกันสำหรับการเรียก tool ครั้งนั้น

หาก cell กลางล้มเหลว:

- สถานะของ cell ก่อนหน้ายังคงอยู่ในหน่วยความจำ
- tool ส่งคืนข้อผิดพลาดที่ระบุว่า cell ใดล้มเหลว
- Cell ถัดไปจะไม่ถูกประมวลผล

`reset=true` ใช้ได้กับการประมวลผล cell แรกในการเรียกครั้งนั้นเท่านั้น

## การกรอง Environment และการระบุ Runtime

Environment จะถูกกรองก่อนเปิดใช้งาน gateway/kernel runtime:

- Allowlist รวมถึง var หลัก เช่น `PATH`, `HOME`, locale vars, `VIRTUAL_ENV`, `PYTHONPATH` เป็นต้น
- Allow-prefix: `LC_`, `XDG_`, `PI_`
- Denylist ลบ API key ทั่วไป (OpenAI/Anthropic/Gemini/ฯลฯ)

ลำดับการเลือก runtime:

1. venv ที่ใช้งานอยู่/ค้นพบ (`VIRTUAL_ENV`, จากนั้น `<cwd>/.venv`, `<cwd>/venv`)
2. Managed venv ที่ `~/.xcsh/python-env`
3. `python` หรือ `python3` บน PATH

เมื่อเลือก venv แล้ว path ของ bin/Scripts จะถูกนำหน้าไปยัง `PATH`

การเริ่มต้น kernel env ภายใน Python ยังรวมถึง:

- `os.chdir(cwd)`
- ใส่ env map ที่ให้มาลงใน `os.environ`
- ตรวจสอบให้แน่ใจว่า cwd อยู่ใน `sys.path`

## ความพร้อมใช้งานของ Tool และการเลือกโหมด

`python.toolMode` (ค่าเริ่มต้น `both`) + การแทนที่ `PI_PY` เพิ่มเติม ควบคุมการเปิดเผย:

- `ipy-only`
- `bash-only`
- `both`

ค่าที่ยอมรับสำหรับ `PI_PY`:

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

หาก Python preflight ล้มเหลว การสร้าง tool จะลดระดับลงเป็น bash-only สำหรับ session นั้น

## ขั้นตอนการประมวลผลและการยกเลิก/หมดเวลา

### หมดเวลาระดับ Tool

timeout ของ tool `python` เป็นวินาที ค่าเริ่มต้น 30 จำกัดในช่วง `1..600`

tool รวม:

- abort signal ของผู้เรียก
- abort signal ของ timeout

ด้วย `AbortSignal.any(...)`

### การยกเลิกการประมวลผล Kernel

เมื่อยกเลิก/หมดเวลา:

- การประมวลผลถูกทำเครื่องหมายว่ายกเลิก
- ความพยายาม interrupt kernel ผ่าน REST (`POST /interrupt`) และ control-channel `interrupt_request`
- ผลลัพธ์รวมถึง `cancelled=true`
- เส้นทาง timeout ระบุผลลัพธ์ว่า `Command timed out after <n> seconds`

### พฤติกรรม stdin

stdin แบบโต้ตอบไม่ได้รับการสนับสนุน

หาก kernel ส่ง `input_request`:

- tool บันทึก `stdinRequested=true`
- ส่งข้อความอธิบาย
- ส่ง `input_reply` ว่างเปล่า
- การประมวลผลถือว่าเป็นความล้มเหลวที่ชั้น executor

## การจับภาพและการแสดงผลลัพธ์

### คลาสผลลัพธ์ที่จับภาพ

จาก kernel message:

- `stream` -> ส่วนของข้อความธรรมดา
- `display_data`/`execute_result` -> การจัดการการแสดงผลแบบ rich
- `error` -> ข้อความ traceback
- MIME แบบกำหนดเอง `application/x-xcsh-status` -> เหตุการณ์สถานะแบบมีโครงสร้าง

ลำดับความสำคัญของ display MIME:

1. `text/markdown`
2. `text/plain`
3. `text/html` (แปลงเป็น markdown พื้นฐาน)

นอกจากนี้ยังจับภาพเป็นผลลัพธ์แบบมีโครงสร้าง:

- `application/json` -> ข้อมูล JSON tree
- `image/png` -> payload รูปภาพ
- `application/x-xcsh-status` -> เหตุการณ์สถานะ

### การจัดเก็บและการตัดทอน

ผลลัพธ์จะถูก stream ผ่าน `OutputSink` และอาจถูกบันทึกลงใน artifact storage

ผลลัพธ์ของ tool อาจรวมถึง metadata การตัดทอนและ `artifact://<id>` สำหรับการกู้คืนผลลัพธ์เต็ม

### พฤติกรรมของ Renderer

- Tool renderer (`python.ts`):
  - แสดงบล็อก code cell พร้อมสถานะต่อ cell
  - ตัวอย่างแบบยุบค่าเริ่มต้น 10 บรรทัด
  - รองรับโหมดขยายสำหรับผลลัพธ์เต็มและรายละเอียดสถานะที่สมบูรณ์ยิ่งขึ้น
- Interactive renderer (`python-execution.ts`):
  - ใช้สำหรับการประมวลผล Python ที่ผู้ใช้เรียกใช้ใน TUI
  - ตัวอย่างแบบยุบค่าเริ่มต้น 20 บรรทัด
  - จำกัดบรรทัดยาวมากไว้ที่ 4000 ตัวอักษรเพื่อความปลอดภัยในการแสดงผล
  - แสดงการแจ้งเตือนการยกเลิก/ข้อผิดพลาด/การตัดทอน

## การสนับสนุน External Gateway

ตั้งค่า:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# เพิ่มเติม:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

ความแตกต่างของพฤติกรรมจาก local shared gateway:

- ไม่มีไฟล์ lock/info ของ local gateway
- ไม่มีการ spawn/ยุติ local process
- การตรวจสอบสุขภาพและ kernel CRUD ทำงานกับ external endpoint
- ความล้มเหลวในการยืนยันตัวตนจะแสดงพร้อมคำแนะนำ token ที่ชัดเจน

## การแก้ไขปัญหาเชิงปฏิบัติ (รูปแบบความล้มเหลวปัจจุบัน)

- **Python tool ไม่พร้อมใช้งาน**
  - ตรวจสอบ `python.toolMode` / `PI_PY`
  - หาก preflight ล้มเหลว runtime จะ fallback เป็น bash-only

- **ข้อผิดพลาดความพร้อมใช้งานของ Kernel**
  - โหมด local ต้องการทั้ง `kernel_gateway` และ `ipykernel` ที่ import ได้ใน Python runtime ที่ระบุ
  - ติดตั้งด้วย:

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` ทำให้เกิดความล้มเหลวในการเริ่มต้น**
  - นี่เป็นพฤติกรรมที่คาดหวังกับการใช้งานปัจจุบัน

- **ความล้มเหลวในการยืนยันตัวตน/การเข้าถึง External gateway**
  - 401/403 -> ตั้งค่า `PI_PYTHON_GATEWAY_TOKEN`
  - timeout/ไม่สามารถเข้าถึงได้ -> ตรวจสอบ URL/เครือข่ายและสุขภาพของ gateway

- **การประมวลผลค้างแล้วหมดเวลา**
  - เพิ่ม `timeout` ของ tool (สูงสุด 600s) หากปริมาณงานเป็นงานที่ถูกต้อง
  - สำหรับโค้ดที่ค้าง การยกเลิกจะ trigger การ interrupt kernel แต่โค้ดของผู้ใช้อาจยังต้องการการปรับปรุง

- **stdin/input prompt ใน Python code**
  - `input()` ไม่รองรับการโต้ตอบในเส้นทาง runtime นี้; ส่งข้อมูลผ่านโปรแกรม

- **การหมดทรัพยากร (`EMFILE` / ไฟล์เปิดมากเกินไป)**
  - Session manager trigger การกู้คืน shared gateway (การปิด session + รีสตาร์ท shared gateway)

- **ข้อผิดพลาด working directory**
  - Tool ตรวจสอบว่า `cwd` มีอยู่และเป็น directory ก่อนการประมวลผล

## Environment Variable ที่เกี่ยวข้อง

- `PI_PY` — การแทนที่การเปิดเผย tool (`bash-only`/`ipy-only`/`both` ตามการแมปข้างต้น)
- `PI_PYTHON_GATEWAY_URL` — ใช้ external gateway
- `PI_PYTHON_GATEWAY_TOKEN` — token ยืนยันตัวตน external gateway เพิ่มเติม
- `PI_PYTHON_SKIP_CHECK=1` — ข้ามการตรวจสอบ Python preflight/warm
- `PI_PYTHON_IPC_TRACE=1` — บันทึก kernel IPC send/receive trace
- `PI_DEBUG_STARTUP=1` — ส่ง debug marker ระยะเริ่มต้น
