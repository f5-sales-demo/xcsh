---
title: Python Tool and IPython Runtime
description: >-
  Python REPL tool runtime with IPython kernel management, execution, and output
  capture.
sidebar:
  order: 3
  label: Python & IPython
i18n:
  sourceHash: 70f0a034ecef
  translator: machine
---

# Python Tool และ IPython Runtime

เอกสารนี้อธิบายสแต็กการประมวลผล Python ปัจจุบันใน `packages/coding-agent`
ครอบคลุมพฤติกรรมของเครื่องมือ, วงจรชีวิต kernel/gateway, การจัดการสภาพแวดล้อม, ความหมายของการประมวลผล, การแสดงผลลัพธ์ และโหมดความล้มเหลวในการดำเนินงาน

## ขอบเขตและไฟล์สำคัญ

- Tool surface: `src/tools/python.ts`
- การจัดการ kernel ต่อ session/ต่อ call: `src/ipy/executor.ts`
- Kernel protocol + การเชื่อมต่อ gateway: `src/ipy/kernel.ts`
- ตัวประสาน local gateway ที่ใช้ร่วมกัน: `src/ipy/gateway-coordinator.ts`
- ตัวแสดงผลโหมดโต้ตอบสำหรับการรัน Python ที่ผู้ใช้เรียกใช้: `src/modes/components/python-execution.ts`
- การกรอง runtime/env และการค้นหา Python: `src/ipy/runtime.ts`

## Python tool คืออะไร

เครื่องมือ `python` ประมวลผล Python cell หนึ่งเซลล์หรือมากกว่าผ่าน kernel ที่ใช้ Jupyter Kernel Gateway เป็นแบ็คเอนด์ (ไม่ใช่การเรียก `python -c` โดยตรงทุกเซลล์)

พารามิเตอร์ของเครื่องมือ:

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // seconds, clamped to 1..600, default 30
  cwd?: string;
  reset?: boolean; // reset kernel before first cell only
}
```

เครื่องมือนี้มี `concurrency = "exclusive"` สำหรับแต่ละ session ดังนั้นการเรียกจะไม่ซ้อนทับกัน

## วงจรชีวิตของ Gateway

### โหมดต่างๆ

มีสองเส้นทาง gateway:

1. **External gateway** (ตั้งค่า `PI_PYTHON_GATEWAY_URL`)
   - ใช้ URL ที่กำหนดค่าไว้โดยตรง
   - รองรับการยืนยันตัวตนด้วย `PI_PYTHON_GATEWAY_TOKEN` (ไม่บังคับ)
   - ไม่มีการสร้างหรือจัดการ local gateway process

2. **Local shared gateway** (เส้นทางเริ่มต้น)
   - ใช้ process ที่ใช้ร่วมกันตัวเดียวซึ่งจัดการภายใต้ `~/.xcsh/agent/python-gateway`
   - ไฟล์ metadata: `gateway.json`
   - ไฟล์ lock: `gateway.lock`
   - คำสั่ง spawn:
     - `python -m kernel_gateway`
     - ผูกกับ `127.0.0.1:<allocated-port>`
     - health check เมื่อเริ่มต้น: `GET /api/kernelspecs`

### การประสานงาน local shared gateway

`acquireSharedGateway()`:

- รับ file lock (`gateway.lock`) พร้อม heartbeat
- ใช้ `gateway.json` ซ้ำถ้า PID ยังมีชีวิตอยู่และ health check ผ่าน
- ทำความสะอาด info/PID ที่ค้างอยู่เมื่อจำเป็น
- เริ่ม gateway ใหม่เมื่อไม่มี gateway ที่สุขภาพดี

`releaseSharedGateway()` ปัจจุบันเป็น no-op (การปิด kernel ไม่ได้ปิด shared gateway)

`shutdownSharedGateway()` ยุติ shared process อย่างชัดเจนและล้าง gateway metadata

### ข้อจำกัดสำคัญ

`python.sharedGateway=false` จะถูกปฏิเสธเมื่อเริ่ม kernel:

- Error: `Shared Python gateway required; local gateways are disabled`
- ไม่มีโหมด non-shared local gateway แบบ per-process

## วงจรชีวิตของ Kernel

แต่ละการประมวลผลใช้ kernel ที่สร้างผ่าน `POST /api/kernels` บน gateway ที่เลือก

ลำดับการเริ่ม kernel:

1. ตรวจสอบความพร้อมใช้งาน (`checkPythonKernelAvailability`)
2. สร้าง kernel (`/api/kernels`)
3. เปิด websocket (`/api/kernels/:id/channels`)
4. เริ่มต้นสภาพแวดล้อม kernel (`cwd`, env vars, `sys.path`)
5. ประมวลผล `PYTHON_PRELUDE`
6. โหลดโมดูล extension จาก:
   - user: `~/.xcsh/agent/modules/*.py`
   - project: `<cwd>/.xcsh/modules/*.py` (แทนที่โมดูลชื่อเดียวกันของ user)

การปิด kernel:

- ลบ remote kernel ผ่าน `DELETE /api/kernels/:id`
- ปิด websocket
- เรียก shared gateway release hook (ปัจจุบันเป็น no-op)

## ความหมายของการคงอยู่ของ Session

`python.kernelMode` ควบคุมการใช้ kernel ซ้ำ:

- `session` (ค่าเริ่มต้น)
  - ใช้ kernel session ซ้ำโดยใช้ key จาก session identity + cwd
  - การประมวลผลถูก serialize ต่อ session ผ่านคิว
  - Session ที่ไม่มีการใช้งานจะถูกเพิกถอนหลังจาก 5 นาที
  - มีได้สูงสุด 4 session; session ที่เก่าที่สุดจะถูกเพิกถอนเมื่อเต็ม
  - Heartbeat check ตรวจจับ kernel ที่ตายแล้ว
  - อนุญาตให้ auto-restart ได้หนึ่งครั้ง; crash ซ้ำ => ล้มเหลวอย่างถาวร

- `per-call`
  - สร้าง kernel ใหม่สำหรับทุก execute request
  - ปิด kernel หลัง request เสร็จ
  - ไม่มีการคง state ข้ามการเรียก

### พฤติกรรม multi-cell ในการเรียกเครื่องมือครั้งเดียว

เซลล์รันตามลำดับใน kernel instance เดียวกันสำหรับการเรียกเครื่องมือนั้น

หากเซลล์ระหว่างกลางล้มเหลว:

- state ของเซลล์ก่อนหน้ายังคงอยู่ในหน่วยความจำ
- เครื่องมือส่งคืน error ที่ระบุว่าเซลล์ใดล้มเหลว
- เซลล์ที่เหลือจะไม่ถูกประมวลผล

`reset=true` ใช้เฉพาะกับการประมวลผลเซลล์แรกในการเรียกนั้น

## การกรองสภาพแวดล้อมและการค้นหา runtime

สภาพแวดล้อมจะถูกกรองก่อนเปิดใช้ gateway/kernel runtime:

- Allowlist รวมตัวแปรหลักเช่น `PATH`, `HOME`, ตัวแปร locale, `VIRTUAL_ENV`, `PYTHONPATH` เป็นต้น
- Allow-prefix: `LC_`, `XDG_`, `PI_`
- Denylist ตัดคีย์ API ทั่วไปออก (OpenAI/Anthropic/Gemini/เป็นต้น)

ลำดับการเลือก runtime:

1. venv ที่ active/ค้นพบ (`VIRTUAL_ENV`, จากนั้น `<cwd>/.venv`, `<cwd>/venv`)
2. venv ที่จัดการแล้วที่ `~/.xcsh/python-env`
3. `python` หรือ `python3` บน PATH

เมื่อเลือก venv แล้ว path bin/Scripts ของมันจะถูกเพิ่มไว้ข้างหน้า `PATH`

การเริ่มต้นสภาพแวดล้อม kernel ภายใน Python ยังรวมถึง:

- `os.chdir(cwd)`
- ฉีด env map ที่ระบุเข้าไปใน `os.environ`
- ตรวจสอบให้แน่ใจว่า cwd อยู่ใน `sys.path`

## ความพร้อมใช้งานของเครื่องมือและการเลือกโหมด

`python.toolMode` (ค่าเริ่มต้น `both`) + `PI_PY` override ที่เป็นตัวเลือกควบคุมการเปิดเผย:

- `ipy-only`
- `bash-only`
- `both`

ค่า `PI_PY` ที่รับได้:

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

หาก Python preflight ล้มเหลว การสร้างเครื่องมือจะลดระดับเป็น bash-only สำหรับ session นั้น

## ขั้นตอนการประมวลผลและการยกเลิก/หมดเวลา

### Timeout ระดับเครื่องมือ

timeout ของเครื่องมือ `python` เป็นวินาที ค่าเริ่มต้น 30 จำกัดที่ `1..600`

เครื่องมือรวม:

- สัญญาณยกเลิกจากผู้เรียก
- สัญญาณยกเลิกจาก timeout

ด้วย `AbortSignal.any(...)`

### การยกเลิกการประมวลผลของ Kernel

เมื่อยกเลิก/หมดเวลา:

- การประมวลผลถูกทำเครื่องหมายว่ายกเลิก
- พยายาม interrupt kernel ผ่าน REST (`POST /interrupt`) และ control-channel `interrupt_request`
- ผลลัพธ์รวม `cancelled=true`
- เส้นทาง timeout จะเพิ่มหมายเหตุในผลลัพธ์ว่า `Command timed out after <n> seconds`

### พฤติกรรม stdin

ไม่รองรับ stdin แบบโต้ตอบ

หาก kernel ส่ง `input_request`:

- เครื่องมือบันทึก `stdinRequested=true`
- แสดงข้อความอธิบาย
- ส่ง `input_reply` ว่างเปล่า
- การประมวลผลถูกถือว่าล้มเหลวที่ชั้น executor

## การจับผลลัพธ์และการแสดงผล

### ประเภทผลลัพธ์ที่จับได้

จาก kernel messages:

- `stream` -> ข้อความธรรมดาเป็นชิ้นๆ
- `display_data`/`execute_result` -> การจัดการแสดงผลแบบ rich
- `error` -> ข้อความ traceback
- custom MIME `application/x-xcsh-status` -> เหตุการณ์สถานะแบบมีโครงสร้าง

ลำดับความสำคัญของ Display MIME:

1. `text/markdown`
2. `text/plain`
3. `text/html` (แปลงเป็น markdown พื้นฐาน)

จับเพิ่มเติมเป็นผลลัพธ์แบบมีโครงสร้าง:

- `application/json` -> ข้อมูลแบบ JSON tree
- `image/png` -> ข้อมูลรูปภาพ
- `application/x-xcsh-status` -> เหตุการณ์สถานะ

### การจัดเก็บและการตัดทอน

ผลลัพธ์ถูก stream ผ่าน `OutputSink` และอาจถูกบันทึกลง artifact storage

ผลลัพธ์ของเครื่องมือสามารถรวม metadata การตัดทอนและ `artifact://<id>` สำหรับการกู้คืนผลลัพธ์ทั้งหมด

### พฤติกรรมของตัวแสดงผล

- ตัวแสดงผลเครื่องมือ (`python.ts`):
  - แสดงบล็อก code-cell พร้อมสถานะของแต่ละเซลล์
  - ตัวอย่างแบบย่อเริ่มต้นที่ 10 บรรทัด
  - รองรับโหมดขยายสำหรับผลลัพธ์ทั้งหมดและรายละเอียดสถานะที่มากขึ้น
- ตัวแสดงผลแบบโต้ตอบ (`python-execution.ts`):
  - ใช้สำหรับการประมวลผล Python ที่ผู้ใช้เรียกใช้ใน TUI
  - ตัวอย่างแบบย่อเริ่มต้นที่ 20 บรรทัด
  - จำกัดบรรทัดที่ยาวมากเป็น 4000 อักขระเพื่อความปลอดภัยในการแสดงผล
  - แสดงการแจ้งเตือนการยกเลิก/ข้อผิดพลาด/การตัดทอน

## การรองรับ External gateway

ตั้งค่า:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# Optional:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

ความแตกต่างของพฤติกรรมจาก local shared gateway:

- ไม่มีไฟล์ lock/info ของ local gateway
- ไม่มีการ spawn/terminate local process
- Health check และ kernel CRUD ทำงานกับ external endpoint
- ความล้มเหลวในการยืนยันตัวตนจะแสดงพร้อมคำแนะนำเรื่อง token อย่างชัดเจน

## การแก้ไขปัญหาการดำเนินงาน (โหมดความล้มเหลวปัจจุบัน)

- **Python tool ไม่พร้อมใช้งาน**
  - ตรวจสอบ `python.toolMode` / `PI_PY`
  - หาก preflight ล้มเหลว runtime จะกลับไปใช้ bash-only

- **ข้อผิดพลาดความพร้อมใช้งานของ Kernel**
  - โหมด local ต้องการทั้ง `kernel_gateway` และ `ipykernel` ที่ import ได้ใน Python runtime ที่ค้นพบ
  - ติดตั้งด้วย:

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` ทำให้เริ่มต้นล้มเหลว**
  - นี่เป็นพฤติกรรมที่คาดไว้กับ implementation ปัจจุบัน

- **ความล้มเหลวในการยืนยันตัวตน/การเข้าถึง external gateway**
  - 401/403 -> ตั้งค่า `PI_PYTHON_GATEWAY_TOKEN`
  - timeout/เข้าไม่ถึง -> ตรวจสอบ URL/เครือข่ายและสุขภาพของ gateway

- **การประมวลผลค้างแล้วหมดเวลา**
  - เพิ่ม `timeout` ของเครื่องมือ (สูงสุด 600 วินาที) หากงานเป็นงานที่ถูกต้อง
  - สำหรับโค้ดที่ค้าง การยกเลิกจะทริกเกอร์ kernel interrupt แต่โค้ดของผู้ใช้อาจยังต้องปรับแก้

- **stdin/input prompts ในโค้ด Python**
  - `input()` ไม่รองรับแบบโต้ตอบในเส้นทาง runtime นี้; ส่งข้อมูลแบบ programmatic แทน

- **ทรัพยากรหมด (`EMFILE` / too many open files)**
  - Session manager ทริกเกอร์การกู้คืน shared-gateway (การปิด session + รีสตาร์ท shared gateway)

- **ข้อผิดพลาดเกี่ยวกับ working directory**
  - เครื่องมือตรวจสอบว่า `cwd` มีอยู่จริงและเป็นไดเรกทอรีก่อนการประมวลผล

## ตัวแปรสภาพแวดล้อมที่เกี่ยวข้อง

- `PI_PY` — override การเปิดเผยเครื่องมือ (ดูการ mapping `bash-only`/`ipy-only`/`both` ข้างต้น)
- `PI_PYTHON_GATEWAY_URL` — ใช้ external gateway
- `PI_PYTHON_GATEWAY_TOKEN` — auth token ของ external gateway (ไม่บังคับ)
- `PI_PYTHON_SKIP_CHECK=1` — ข้าม Python preflight/warm checks
- `PI_PYTHON_IPC_TRACE=1` — บันทึก kernel IPC send/receive traces
- `PI_DEBUG_STARTUP=1` — แสดง debug markers ของ startup-stage
