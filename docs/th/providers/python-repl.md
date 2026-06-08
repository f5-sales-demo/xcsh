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

เอกสารนี้อธิบายสแต็กการทำงาน Python ปัจจุบันใน `packages/coding-agent`
ครอบคลุมพฤติกรรมของเครื่องมือ วงจรชีวิตของ kernel/gateway การจัดการสภาพแวดล้อม ความหมายของการทำงาน การแสดงผลลัพธ์ และโหมดความล้มเหลวในการดำเนินงาน

## ขอบเขตและไฟล์สำคัญ

- พื้นผิวเครื่องมือ: `src/tools/python.ts`
- การจัดการ kernel ต่อเซสชัน/ต่อการเรียก: `src/ipy/executor.ts`
- โปรโตคอล kernel + การรวม gateway: `src/ipy/kernel.ts`
- ตัวประสานงาน gateway ท้องถิ่นที่ใช้ร่วมกัน: `src/ipy/gateway-coordinator.ts`
- ตัวแสดงผลโหมดอินเทอร์แอคทีฟสำหรับการรัน Python ที่ผู้ใช้สั่ง: `src/modes/components/python-execution.ts`
- การกรอง runtime/env และการค้นหา Python: `src/ipy/runtime.ts`

## Python tool คืออะไร

เครื่องมือ `python` ทำการรันเซลล์ Python หนึ่งเซลล์หรือมากกว่าผ่าน kernel ที่ใช้ Jupyter Kernel Gateway เป็นแบ็คเอนด์ (ไม่ใช่การสร้างกระบวนการ `python -c` โดยตรงต่อเซลล์)

พารามิเตอร์ของเครื่องมือ:

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // seconds, clamped to 1..600, default 30
  cwd?: string;
  reset?: boolean; // reset kernel before first cell only
}
```

เครื่องมือนี้มี `concurrency = "exclusive"` สำหรับแต่ละเซสชัน ดังนั้นการเรียกจะไม่ทับซ้อนกัน

## วงจรชีวิตของ Gateway

### โหมด

มีเส้นทาง gateway สองแบบ:

1. **Gateway ภายนอก** (ตั้งค่า `PI_PYTHON_GATEWAY_URL`)
   - ใช้ URL ที่กำหนดค่าไว้โดยตรง
   - การยืนยันตัวตนเพิ่มเติมด้วย `PI_PYTHON_GATEWAY_TOKEN`
   - ไม่มีการสร้างหรือจัดการกระบวนการ gateway ท้องถิ่น

2. **Gateway ท้องถิ่นที่ใช้ร่วมกัน** (เส้นทางเริ่มต้น)
   - ใช้กระบวนการที่ใช้ร่วมกันเพียงตัวเดียว ประสานงานภายใต้ `~/.xcsh/agent/python-gateway`
   - ไฟล์ข้อมูลเมตา: `gateway.json`
   - ไฟล์ล็อก: `gateway.lock`
   - คำสั่งสร้าง:
     - `python -m kernel_gateway`
     - ผูกกับ `127.0.0.1:<allocated-port>`
     - ตรวจสอบสุขภาพตอนเริ่มต้น: `GET /api/kernelspecs`

### การประสานงาน gateway ท้องถิ่นที่ใช้ร่วมกัน

`acquireSharedGateway()`:

- ได้รับ file lock (`gateway.lock`) พร้อม heartbeat
- ใช้ `gateway.json` ซ้ำหาก PID ยังมีชีวิตอยู่และการตรวจสอบสุขภาพผ่าน
- ล้างข้อมูล/PID ที่ค้างเมื่อจำเป็น
- เริ่ม gateway ใหม่เมื่อไม่มี gateway ที่สมบูรณ์อยู่

`releaseSharedGateway()` ปัจจุบันเป็น no-op (การปิด kernel ไม่ได้ทำลาย gateway ที่ใช้ร่วมกัน)

`shutdownSharedGateway()` หยุดกระบวนการที่ใช้ร่วมกันอย่างชัดเจนและล้างข้อมูลเมตาของ gateway

### ข้อจำกัดที่สำคัญ

`python.sharedGateway=false` ถูกปฏิเสธเมื่อเริ่ม kernel:

- ข้อผิดพลาด: `Shared Python gateway required; local gateways are disabled`
- ไม่มีโหมด gateway ท้องถิ่นแบบไม่ใช้ร่วมกันต่อกระบวนการ

## วงจรชีวิตของ Kernel

แต่ละการทำงานใช้ kernel ที่สร้างผ่าน `POST /api/kernels` บน gateway ที่เลือก

ลำดับการเริ่มต้น kernel:

1. ตรวจสอบความพร้อมใช้งาน (`checkPythonKernelAvailability`)
2. สร้าง kernel (`/api/kernels`)
3. เปิด websocket (`/api/kernels/:id/channels`)
4. เริ่มต้นสภาพแวดล้อม kernel (`cwd`, env vars, `sys.path`)
5. รัน `PYTHON_PRELUDE`
6. โหลดโมดูลส่วนขยายจาก:
   - ผู้ใช้: `~/.xcsh/agent/modules/*.py`
   - โปรเจกต์: `<cwd>/.xcsh/modules/*.py` (เขียนทับโมดูลผู้ใช้ที่ชื่อเดียวกัน)

การปิด kernel:

- ลบ kernel ระยะไกลผ่าน `DELETE /api/kernels/:id`
- ปิด websocket
- เรียก hook การปล่อย gateway ที่ใช้ร่วมกัน (no-op ในปัจจุบัน)

## ความหมายของการคงอยู่ของเซสชัน

`python.kernelMode` ควบคุมการใช้ kernel ซ้ำ:

- `session` (ค่าเริ่มต้น)
  - ใช้เซสชัน kernel ซ้ำโดยคีย์ตามตัวตนเซสชัน + cwd
  - การทำงานถูกจัดลำดับต่อเซสชันผ่านคิว
  - เซสชันที่ไม่ได้ใช้งานจะถูกลบหลังจาก 5 นาที
  - มีเซสชันได้สูงสุด 4 เซสชัน; เซสชันที่เก่าที่สุดจะถูกลบเมื่อเกิน
  - การตรวจสอบ heartbeat ตรวจจับ kernel ที่ตายแล้ว
  - อนุญาตให้รีสตาร์ทอัตโนมัติได้หนึ่งครั้ง; หากขัดข้องซ้ำ => ล้มเหลวอย่างถาวร

- `per-call`
  - สร้าง kernel ใหม่สำหรับแต่ละคำขอรัน
  - ปิด kernel หลังจากคำขอ
  - ไม่มีการคงสถานะข้ามการเรียก

### พฤติกรรมหลายเซลล์ในการเรียกเครื่องมือครั้งเดียว

เซลล์ทำงานตามลำดับใน kernel instance เดียวกันสำหรับการเรียกเครื่องมือครั้งนั้น

หากเซลล์ตรงกลางล้มเหลว:

- สถานะของเซลล์ก่อนหน้ายังคงอยู่ในหน่วยความจำ
- เครื่องมือส่งคืนข้อผิดพลาดที่ระบุว่าเซลล์ใดล้มเหลว
- เซลล์ถัดไปจะไม่ถูกรัน

`reset=true` ใช้กับการรันเซลล์แรกในการเรียกครั้งนั้นเท่านั้น

## การกรองสภาพแวดล้อมและการค้นหา runtime

สภาพแวดล้อมจะถูกกรองก่อนเปิดใช้ gateway/kernel runtime:

- รายการที่อนุญาตรวมถึงตัวแปรหลักเช่น `PATH`, `HOME`, ตัวแปร locale, `VIRTUAL_ENV`, `PYTHONPATH` เป็นต้น
- คำนำหน้าที่อนุญาต: `LC_`, `XDG_`, `PI_`
- รายการปฏิเสธจะลบ API key ทั่วไป (OpenAI/Anthropic/Gemini/ฯลฯ)

ลำดับการเลือก runtime:

1. Venv ที่ใช้งาน/ค้นพบ (`VIRTUAL_ENV`, จากนั้น `<cwd>/.venv`, `<cwd>/venv`)
2. Venv ที่จัดการที่ `~/.xcsh/python-env`
3. `python` หรือ `python3` บน PATH

เมื่อเลือก venv แล้ว เส้นทาง bin/Scripts จะถูกเพิ่มไว้ข้างหน้า `PATH`

การเริ่มต้นสภาพแวดล้อม kernel ภายใน Python ยัง:

- `os.chdir(cwd)`
- แทรกแผนที่ env ที่ให้มาเข้าไปใน `os.environ`
- ทำให้ cwd อยู่ใน `sys.path`

## ความพร้อมใช้งานของเครื่องมือและการเลือกโหมด

`python.toolMode` (ค่าเริ่มต้น `both`) + `PI_PY` เสริมที่เป็นทางเลือกควบคุมการเปิดเผย:

- `ipy-only`
- `bash-only`
- `both`

ค่าที่ `PI_PY` ยอมรับ:

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

หากการตรวจสอบเบื้องต้นของ Python ล้มเหลว การสร้างเครื่องมือจะถอยกลับเป็น bash-only สำหรับเซสชันนั้น

## ขั้นตอนการทำงานและการยกเลิก/หมดเวลา

### การหมดเวลาระดับเครื่องมือ

การหมดเวลาของเครื่องมือ `python` เป็นวินาที ค่าเริ่มต้น 30 จำกัดที่ `1..600`

เครื่องมือรวม:

- สัญญาณยกเลิกจากผู้เรียก
- สัญญาณยกเลิกจากการหมดเวลา

ด้วย `AbortSignal.any(...)`

### การยกเลิกการทำงานของ kernel

เมื่อยกเลิก/หมดเวลา:

- การทำงานถูกทำเครื่องหมายว่ายกเลิก
- พยายามขัดจังหวะ kernel ผ่าน REST (`POST /interrupt`) และ control-channel `interrupt_request`
- ผลลัพธ์รวม `cancelled=true`
- เส้นทางหมดเวลาจะเพิ่มข้อความในผลลัพธ์ว่า `Command timed out after <n> seconds`

### พฤติกรรม stdin

ไม่รองรับ stdin แบบอินเทอร์แอคทีฟ

หาก kernel ส่ง `input_request`:

- เครื่องมือบันทึก `stdinRequested=true`
- แสดงข้อความอธิบาย
- ส่ง `input_reply` ว่าง
- การทำงานจะถือว่าล้มเหลวในชั้น executor

## การจับผลลัพธ์และการแสดงผล

### ประเภทผลลัพธ์ที่จับได้

จากข้อความ kernel:

- `stream` -> ชิ้นส่วนข้อความธรรมดา
- `display_data`/`execute_result` -> การจัดการแสดงผลแบบ rich
- `error` -> ข้อความ traceback
- MIME กำหนดเอง `application/x-xcsh-status` -> เหตุการณ์สถานะที่มีโครงสร้าง

ลำดับความสำคัญของ MIME ในการแสดงผล:

1. `text/markdown`
2. `text/plain`
3. `text/html` (แปลงเป็น markdown พื้นฐาน)

ยังจับเป็นผลลัพธ์ที่มีโครงสร้าง:

- `application/json` -> ข้อมูลแบบ JSON tree
- `image/png` -> ข้อมูลรูปภาพ
- `application/x-xcsh-status` -> เหตุการณ์สถานะ

### การจัดเก็บและการตัดทอน

ผลลัพธ์ถูกสตรีมผ่าน `OutputSink` และอาจถูกเก็บถาวรในที่เก็บ artifact

ผลลัพธ์ของเครื่องมือสามารถรวมข้อมูลเมตาการตัดทอนและ `artifact://<id>` สำหรับการเรียกคืนผลลัพธ์ฉบับเต็ม

### พฤติกรรมตัวแสดงผล

- ตัวแสดงผลเครื่องมือ (`python.ts`):
  - แสดงบล็อกเซลล์โค้ดพร้อมสถานะต่อเซลล์
  - ตัวอย่างแบบยุบค่าเริ่มต้น 10 บรรทัด
  - รองรับโหมดขยายสำหรับผลลัพธ์เต็มและรายละเอียดสถานะที่สมบูรณ์ขึ้น
- ตัวแสดงผลอินเทอร์แอคทีฟ (`python-execution.ts`):
  - ใช้สำหรับการรัน Python ที่ผู้ใช้สั่งใน TUI
  - ตัวอย่างแบบยุบค่าเริ่มต้น 20 บรรทัด
  - จำกัดบรรทัดที่ยาวมากเป็น 4000 ตัวอักษรเพื่อความปลอดภัยในการแสดงผล
  - แสดงการแจ้งเตือนการยกเลิก/ข้อผิดพลาด/การตัดทอน

## การรองรับ gateway ภายนอก

ตั้งค่า:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# Optional:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

ความแตกต่างของพฤติกรรมจาก gateway ท้องถิ่นที่ใช้ร่วมกัน:

- ไม่มีไฟล์ lock/info ของ gateway ท้องถิ่น
- ไม่มีการสร้าง/หยุดกระบวนการท้องถิ่น
- การตรวจสอบสุขภาพและ kernel CRUD ทำงานกับ endpoint ภายนอก
- ความล้มเหลวในการยืนยันตัวตนจะแสดงพร้อมคำแนะนำเรื่อง token อย่างชัดเจน

## การแก้ไขปัญหาการดำเนินงาน (โหมดความล้มเหลวปัจจุบัน)

- **Python tool ไม่พร้อมใช้งาน**
  - ตรวจสอบ `python.toolMode` / `PI_PY`
  - หากการตรวจสอบเบื้องต้นล้มเหลว runtime จะถอยกลับเป็น bash-only

- **ข้อผิดพลาดความพร้อมใช้งานของ kernel**
  - โหมดท้องถิ่นต้องการทั้ง `kernel_gateway` และ `ipykernel` ที่สามารถ import ได้ใน Python runtime ที่ค้นหาได้
  - ติดตั้งด้วย:

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` ทำให้เริ่มต้นล้มเหลว**
  - นี่เป็นสิ่งที่คาดหวังกับการดำเนินการปัจจุบัน

- **ความล้มเหลวในการยืนยันตัวตน/เข้าถึง gateway ภายนอก**
  - 401/403 -> ตั้งค่า `PI_PYTHON_GATEWAY_TOKEN`
  - หมดเวลา/เข้าถึงไม่ได้ -> ตรวจสอบ URL/เครือข่ายและสุขภาพ gateway

- **การทำงานค้างแล้วหมดเวลา**
  - เพิ่ม `timeout` ของเครื่องมือ (สูงสุด 600 วินาที) หากปริมาณงานถูกต้อง
  - สำหรับโค้ดที่ค้าง การยกเลิกจะสั่งขัดจังหวะ kernel แต่โค้ดผู้ใช้อาจยังต้องปรับแก้

- **stdin/input prompts ในโค้ด Python**
  - `input()` ไม่รองรับแบบอินเทอร์แอคทีฟในเส้นทาง runtime นี้; ส่งข้อมูลแบบโปรแกรมแทน

- **ทรัพยากรหมด (`EMFILE` / ไฟล์เปิดมากเกินไป)**
  - ตัวจัดการเซสชันสั่งกู้คืน gateway ที่ใช้ร่วมกัน (ทำลายเซสชัน + รีสตาร์ท gateway ที่ใช้ร่วมกัน)

- **ข้อผิดพลาดไดเรกทอรีทำงาน**
  - เครื่องมือตรวจสอบว่า `cwd` มีอยู่และเป็นไดเรกทอรีก่อนการทำงาน

## ตัวแปรสภาพแวดล้อมที่เกี่ยวข้อง

- `PI_PY` — การแทนที่การเปิดเผยเครื่องมือ (การแมป `bash-only`/`ipy-only`/`both` ด้านบน)
- `PI_PYTHON_GATEWAY_URL` — ใช้ gateway ภายนอก
- `PI_PYTHON_GATEWAY_TOKEN` — token ยืนยันตัวตน gateway ภายนอกเสริม
- `PI_PYTHON_SKIP_CHECK=1` — ข้ามการตรวจสอบเบื้องต้น/ความพร้อมของ Python
- `PI_PYTHON_IPC_TRACE=1` — บันทึกร่องรอยการส่ง/รับ IPC ของ kernel
- `PI_DEBUG_STARTUP=1` — แสดงเครื่องหมายดีบักขั้นตอนเริ่มต้น
