---
title: เครื่องมือ Python และ IPython Runtime
description: >-
  Python REPL tool runtime พร้อมการจัดการ IPython kernel, การเรียกใช้งาน
  และการจับผลลัพธ์
sidebar:
  order: 3
  label: Python และ IPython
i18n:
  sourceHash: 70f0a034ecef
  translator: machine
---

# เครื่องมือ Python และ IPython Runtime

เอกสารนี้อธิบายชุดเครื่องมือสำหรับการเรียกใช้งาน Python ในปัจจุบันใน `packages/coding-agent`
ครอบคลุมพฤติกรรมของเครื่องมือ, วงจรชีวิตของ kernel/gateway, การจัดการ environment, ความหมายของการเรียกใช้งาน, การแสดงผลลัพธ์ และโหมดความล้มเหลวในการดำเนินงาน

## ขอบเขตและไฟล์สำคัญ

- พื้นผิวของเครื่องมือ: `src/tools/python.ts`
- การจัดการ kernel แบบ session/ต่อการเรียก: `src/ipy/executor.ts`
- โปรโตคอล kernel + การเชื่อมต่อ gateway: `src/ipy/kernel.ts`
- ตัวประสานงาน gateway ร่วมแบบ local: `src/ipy/gateway-coordinator.ts`
- ตัวแสดงผลโหมด interactive สำหรับการเรียกใช้ Python โดยผู้ใช้: `src/modes/components/python-execution.ts`
- การกรอง runtime/env และการค้นหา Python: `src/ipy/runtime.ts`

## เครื่องมือ Python คืออะไร

เครื่องมือ `python` เรียกใช้งาน Python cell หนึ่งหรือหลาย cell ผ่าน kernel ที่สนับสนุนโดย Jupyter Kernel Gateway (ไม่ใช่การเรียก `python -c` โดยตรงต่อ cell)

พารามิเตอร์ของเครื่องมือ:

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // วินาที, จำกัดที่ 1..600, ค่าเริ่มต้น 30
  cwd?: string;
  reset?: boolean; // รีเซ็ต kernel ก่อน cell แรกเท่านั้น
}
```

เครื่องมือนี้เป็น `concurrency = "exclusive"` สำหรับแต่ละ session ดังนั้นการเรียกจะไม่ทำงานทับซ้อนกัน

## วงจรชีวิตของ Gateway

### โหมดต่าง ๆ

มีสองเส้นทางสำหรับ gateway:

1. **Gateway ภายนอก** (ตั้งค่า `PI_PYTHON_GATEWAY_URL`)
   - ใช้ URL ที่กำหนดค่าไว้โดยตรง
   - รองรับการยืนยันตัวตนด้วย `PI_PYTHON_GATEWAY_TOKEN` (ไม่บังคับ)
   - ไม่มีการสร้างหรือจัดการ gateway process แบบ local

2. **Gateway ร่วมแบบ local** (เส้นทางเริ่มต้น)
   - ใช้ process ร่วมตัวเดียวที่ประสานงานภายใต้ `~/.xcsh/agent/python-gateway`
   - ไฟล์ข้อมูล: `gateway.json`
   - ไฟล์ล็อก: `gateway.lock`
   - คำสั่งสร้าง:
     - `python -m kernel_gateway`
     - ผูกกับ `127.0.0.1:<allocated-port>`
     - ตรวจสอบสุขภาพตอนเริ่มต้น: `GET /api/kernelspecs`

### การประสานงาน gateway ร่วมแบบ local

`acquireSharedGateway()`:

- ยึดไฟล์ล็อก (`gateway.lock`) พร้อม heartbeat
- ใช้ `gateway.json` ซ้ำหาก PID ยังมีชีวิตและการตรวจสอบสุขภาพผ่าน
- ล้างข้อมูล/PID ที่ค้างเมื่อจำเป็น
- เริ่ม gateway ใหม่เมื่อไม่มี gateway ที่สมบูรณ์อยู่

`releaseSharedGateway()` ปัจจุบันเป็น no-op (การปิด kernel ไม่ได้ทำลาย gateway ร่วม)

`shutdownSharedGateway()` ยุติ process ร่วมอย่างชัดเจนและล้างข้อมูล gateway

### ข้อจำกัดสำคัญ

`python.sharedGateway=false` จะถูกปฏิเสธเมื่อเริ่ม kernel:

- ข้อผิดพลาด: `Shared Python gateway required; local gateways are disabled`
- ไม่มีโหมด gateway แบบ local ที่ไม่ร่วมต่อ process

## วงจรชีวิตของ Kernel

แต่ละการเรียกใช้งานจะใช้ kernel ที่สร้างผ่าน `POST /api/kernels` บน gateway ที่เลือก

ลำดับการเริ่มต้น kernel:

1. ตรวจสอบความพร้อม (`checkPythonKernelAvailability`)
2. สร้าง kernel (`/api/kernels`)
3. เปิด websocket (`/api/kernels/:id/channels`)
4. เตรียม kernel env (`cwd`, ตัวแปร env, `sys.path`)
5. เรียกใช้ `PYTHON_PRELUDE`
6. โหลดโมดูลส่วนขยายจาก:
   - ผู้ใช้: `~/.xcsh/agent/modules/*.py`
   - โปรเจกต์: `<cwd>/.xcsh/modules/*.py` (แทนที่โมดูลชื่อเดียวกันของผู้ใช้)

การปิด kernel:

- ลบ kernel ระยะไกลผ่าน `DELETE /api/kernels/:id`
- ปิด websocket
- เรียก hook การปล่อย gateway ร่วม (เป็น no-op ในปัจจุบัน)

## ความหมายของการคงอยู่ของ session

`python.kernelMode` ควบคุมการใช้ kernel ซ้ำ:

- `session` (ค่าเริ่มต้น)
  - ใช้ kernel session ซ้ำโดยระบุด้วยตัวตนของ session + cwd
  - การเรียกใช้งานถูกจัดลำดับต่อ session ผ่านคิว
  - session ที่ไม่มีการใช้งานจะถูกขับออกหลัง 5 นาที
  - สูงสุด 4 session; session เก่าที่สุดจะถูกขับออกเมื่อล้น
  - การตรวจ heartbeat จะตรวจจับ kernel ที่ตายแล้ว
  - อนุญาตให้รีสตาร์ทอัตโนมัติได้หนึ่งครั้ง; การ crash ซ้ำ => ล้มเหลวอย่างรุนแรง

- `per-call`
  - สร้าง kernel ใหม่สำหรับแต่ละคำขอเรียกใช้งาน
  - ปิด kernel หลังจากคำขอเสร็จ
  - ไม่มีการคงสถานะข้ามการเรียก

### พฤติกรรมหลาย cell ในการเรียกเครื่องมือครั้งเดียว

Cell ทำงานตามลำดับใน kernel instance เดียวกันสำหรับการเรียกเครื่องมือนั้น

หาก cell ระหว่างกลางล้มเหลว:

- สถานะของ cell ก่อนหน้ายังคงอยู่ในหน่วยความจำ
- เครื่องมือคืนข้อผิดพลาดเฉพาะเจาะจงที่ระบุว่า cell ใดล้มเหลว
- Cell ที่ตามหลังจะไม่ถูกเรียกใช้งาน

`reset=true` มีผลเฉพาะกับการเรียกใช้ cell แรกในการเรียกนั้นเท่านั้น

## การกรอง environment และการค้นหา runtime

Environment จะถูกกรองก่อนเปิดใช้งาน gateway/kernel runtime:

- รายการอนุญาตรวมตัวแปรหลักเช่น `PATH`, `HOME`, ตัวแปร locale, `VIRTUAL_ENV`, `PYTHONPATH` เป็นต้น
- คำนำหน้าที่อนุญาต: `LC_`, `XDG_`, `PI_`
- รายการปฏิเสธจะตัด API key ทั่วไป (OpenAI/Anthropic/Gemini/ฯลฯ)

ลำดับการเลือก runtime:

1. venv ที่ใช้งาน/พบ (`VIRTUAL_ENV`, จากนั้น `<cwd>/.venv`, `<cwd>/venv`)
2. venv ที่จัดการที่ `~/.xcsh/python-env`
3. `python` หรือ `python3` บน PATH

เมื่อเลือก venv แล้ว เส้นทาง bin/Scripts จะถูกเพิ่มไว้ข้างหน้า `PATH`

การเตรียม kernel env ภายใน Python ยัง:

- `os.chdir(cwd)`
- แทรก env map ที่ให้มาเข้าใน `os.environ`
- ตรวจสอบว่า cwd อยู่ใน `sys.path`

## ความพร้อมของเครื่องมือและการเลือกโหมด

`python.toolMode` (ค่าเริ่มต้น `both`) + `PI_PY` override (ไม่บังคับ) ควบคุมการเปิดเผย:

- `ipy-only`
- `bash-only`
- `both`

ค่าที่ `PI_PY` รับ:

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

หาก Python preflight ล้มเหลว การสร้างเครื่องมือจะลดระดับเป็น bash-only สำหรับ session นั้น

## ขั้นตอนการเรียกใช้งานและการยกเลิก/หมดเวลา

### การหมดเวลาระดับเครื่องมือ

การหมดเวลาของเครื่องมือ `python` เป็นวินาที ค่าเริ่มต้น 30 จำกัดที่ `1..600`

เครื่องมือรวม:

- สัญญาณยกเลิกจากผู้เรียก
- สัญญาณยกเลิกเมื่อหมดเวลา

ด้วย `AbortSignal.any(...)`

### การยกเลิกการเรียกใช้งาน kernel

เมื่อยกเลิก/หมดเวลา:

- การเรียกใช้งานถูกทำเครื่องหมายว่ายกเลิก
- พยายามขัดจังหวะ kernel ผ่าน REST (`POST /interrupt`) และ control-channel `interrupt_request`
- ผลลัพธ์รวม `cancelled=true`
- เส้นทางหมดเวลาจะเพิ่มข้อความว่า `Command timed out after <n> seconds` ในผลลัพธ์

### พฤติกรรม stdin

stdin แบบ interactive ไม่ได้รับการสนับสนุน

หาก kernel ส่ง `input_request`:

- เครื่องมือบันทึก `stdinRequested=true`
- แสดงข้อความอธิบาย
- ส่ง `input_reply` ว่าง
- การเรียกใช้งานถูกถือว่าล้มเหลวที่ชั้น executor

## การจับผลลัพธ์และการแสดงผล

### ประเภทผลลัพธ์ที่จับได้

จากข้อความ kernel:

- `stream` -> ชิ้นส่วนข้อความธรรมดา
- `display_data`/`execute_result` -> การจัดการแสดงผลแบบ rich
- `error` -> ข้อความ traceback
- MIME แบบกำหนดเอง `application/x-xcsh-status` -> เหตุการณ์สถานะแบบมีโครงสร้าง

ลำดับความสำคัญของ MIME สำหรับการแสดงผล:

1. `text/markdown`
2. `text/plain`
3. `text/html` (แปลงเป็น markdown พื้นฐาน)

จับเพิ่มเติมเป็นผลลัพธ์แบบมีโครงสร้าง:

- `application/json` -> ข้อมูลแบบ JSON tree
- `image/png` -> ข้อมูลรูปภาพ
- `application/x-xcsh-status` -> เหตุการณ์สถานะ

### การจัดเก็บและการตัดทอน

ผลลัพธ์ถูกส่งผ่าน `OutputSink` แบบ stream และอาจถูกบันทึกลงที่เก็บ artifact

ผลลัพธ์ของเครื่องมืออาจรวมข้อมูลเมตาการตัดทอนและ `artifact://<id>` สำหรับการกู้คืนผลลัพธ์เต็ม

### พฤติกรรมตัวแสดงผล

- ตัวแสดงผลของเครื่องมือ (`python.ts`):
  - แสดงบล็อก code-cell พร้อมสถานะต่อ cell
  - ตัวอย่างแบบยุบเริ่มต้นที่ 10 บรรทัด
  - รองรับโหมดขยายสำหรับผลลัพธ์เต็มและรายละเอียดสถานะที่มากขึ้น
- ตัวแสดงผลแบบ interactive (`python-execution.ts`):
  - ใช้สำหรับการเรียกใช้ Python ที่ผู้ใช้เรียกใน TUI
  - ตัวอย่างแบบยุบเริ่มต้นที่ 20 บรรทัด
  - จำกัดบรรทัดยาวมากที่ 4000 อักขระเพื่อความปลอดภัยในการแสดงผล
  - แสดงการแจ้งเตือนการยกเลิก/ข้อผิดพลาด/การตัดทอน

## การสนับสนุน gateway ภายนอก

ตั้งค่า:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# ไม่บังคับ:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

ความแตกต่างของพฤติกรรมจาก gateway ร่วมแบบ local:

- ไม่มีไฟล์ล็อก/ข้อมูล gateway แบบ local
- ไม่มีการสร้าง/ยุติ process แบบ local
- การตรวจสอบสุขภาพและ CRUD ของ kernel ทำงานกับ endpoint ภายนอก
- ความล้มเหลวในการยืนยันตัวตนจะแสดงพร้อมคำแนะนำเกี่ยวกับ token อย่างชัดเจน

## การแก้ไขปัญหาในการดำเนินงาน (โหมดความล้มเหลวปัจจุบัน)

- **เครื่องมือ Python ไม่พร้อมใช้งาน**
  - ตรวจสอบ `python.toolMode` / `PI_PY`
  - หาก preflight ล้มเหลว runtime จะถอยกลับเป็น bash-only

- **ข้อผิดพลาดความพร้อมของ kernel**
  - โหมด local ต้องการทั้ง `kernel_gateway` และ `ipykernel` ที่สามารถ import ได้ใน Python runtime ที่ค้นพบ
  - ติดตั้งด้วย:

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` ทำให้เริ่มต้นล้มเหลว**
  - นี่เป็นพฤติกรรมที่คาดหวังตามการ implement ปัจจุบัน

- **ความล้มเหลวในการยืนยันตัวตน/เข้าถึง gateway ภายนอก**
  - 401/403 -> ตั้งค่า `PI_PYTHON_GATEWAY_TOKEN`
  - หมดเวลา/เข้าถึงไม่ได้ -> ตรวจสอบ URL/เครือข่ายและสุขภาพของ gateway

- **การเรียกใช้งานค้างแล้วหมดเวลา**
  - เพิ่ม `timeout` ของเครื่องมือ (สูงสุด 600 วินาที) หากงานเป็นงานที่ถูกต้อง
  - สำหรับโค้ดที่ค้าง การยกเลิกจะทริกเกอร์การขัดจังหวะ kernel แต่โค้ดของผู้ใช้อาจยังต้องปรับปรุง

- **prompt stdin/input ในโค้ด Python**
  - `input()` ไม่ได้รับการสนับสนุนแบบ interactive ในเส้นทาง runtime นี้; ส่งข้อมูลแบบ programmatic แทน

- **ทรัพยากรหมด (`EMFILE` / ไฟล์เปิดมากเกินไป)**
  - ตัวจัดการ session จะทริกเกอร์การกู้คืน gateway ร่วม (การทำลาย session + การรีสตาร์ท gateway ร่วม)

- **ข้อผิดพลาดไดเรกทอรีทำงาน**
  - เครื่องมือตรวจสอบว่า `cwd` มีอยู่และเป็นไดเรกทอรีก่อนเรียกใช้งาน

## ตัวแปร environment ที่เกี่ยวข้อง

- `PI_PY` — override การเปิดเผยเครื่องมือ (การแมป `bash-only`/`ipy-only`/`both` ด้านบน)
- `PI_PYTHON_GATEWAY_URL` — ใช้ gateway ภายนอก
- `PI_PYTHON_GATEWAY_TOKEN` — token ยืนยันตัวตน gateway ภายนอก (ไม่บังคับ)
- `PI_PYTHON_SKIP_CHECK=1` — ข้าม Python preflight/warm checks
- `PI_PYTHON_IPC_TRACE=1` — บันทึก trace การส่ง/รับ IPC ของ kernel
- `PI_DEBUG_STARTUP=1` — แสดงเครื่องหมาย debug ของขั้นตอนเริ่มต้น
