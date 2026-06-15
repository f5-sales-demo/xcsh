---
title: การดำเนินงานและการยกเลิกงาน Native Rust
description: >-
  โมเดลการดำเนินงานแบบ async ของ Rust
  พร้อมความหมายของการยกเลิกแบบร่วมมือและการทำความสะอาด
sidebar:
  order: 5
  label: การยกเลิกงาน
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# การดำเนินงานและการยกเลิกงาน Native Rust (`pi-natives`)

เอกสารนี้อธิบายวิธีที่ `crates/pi-natives` จัดตารางงาน native และวิธีที่การยกเลิกไหลจากตัวเลือก JS (`timeoutMs`, `AbortSignal`) ไปยังการดำเนินงาน Rust

## ไฟล์ที่ใช้งาน

- `crates/pi-natives/src/task.rs`
- `crates/pi-natives/src/grep.rs`
- `crates/pi-natives/src/glob.rs`
- `crates/pi-natives/src/fd.rs`
- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/text.rs`
- `crates/pi-natives/src/ps.rs`

## ส่วนประกอบหลัก (`task.rs`)

`task.rs` กำหนดส่วนประกอบหลักสามส่วน:

1. `task::blocking(tag, cancel_token, work)`
   - ครอบ `napi::AsyncTask` / `Task`
   - `compute()` ทำงานบน libuv worker threads (สำหรับงานที่ใช้ CPU หนักหรือ system calls แบบ blocking/sync)
   - คืนค่า JS `Promise<T>`

2. `task::future(env, tag, work)`
   - ครอบ `env.spawn_future(...)`
   - ทำงาน async บน Tokio runtime
   - คืนค่า `PromiseRaw<'env, T>`

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` รวม deadline + `AbortSignal` ที่เป็นตัวเลือก
   - `CancelToken::heartbeat()` คือการยกเลิกแบบร่วมมือสำหรับ blocking loops
   - `CancelToken::wait()` คือการรอการยกเลิกแบบ async (`Signal` / `Timeout` / `User` Ctrl-C)
   - `AbortToken` ให้โค้ดภายนอกร้องขอการยกเลิก (`abort(reason)`)

## `blocking` เทียบกับ `future`: โมเดลการดำเนินงานและการเลือกใช้

### ใช้ `task::blocking`

ใช้เมื่องานใช้ CPU หนักหรือมีลักษณะซิงโครนัส/blocking โดยพื้นฐาน:

- การสแกน regex/ไฟล์ (`grep`, `glob`, `fuzzy_find`)
- ภายใน PTY loop แบบซิงโครนัส (`run_pty_sync` ผ่าน `spawn_blocking`)
- การแปลง clipboard/image/html

พฤติกรรม:

- Work closure รับ `CancelToken` ที่ถูก clone มา
- การยกเลิกจะถูกสังเกตเฉพาะที่โค้ดตรวจสอบ `ct.heartbeat()?` เท่านั้น
- Closure `Err(...)` ปฏิเสธ JS promise

### ใช้ `task::future`

ใช้เมื่องานต้องรอการทำงาน async ด้วย `await`:

- การประสานงาน shell session (`shell.run`, `executeShell`)
- การแข่งขันของงาน (`tokio::select!`) ระหว่างการเสร็จสิ้นและการยกเลิก

พฤติกรรม:

- Future สามารถแข่งระหว่างการเสร็จสิ้นปกติกับ `ct.wait()`
- เมื่อยกเลิก การดำเนินงาน async มักจะส่งต่อการยกเลิกไปยังระบบย่อยภายใน (เช่น `tokio_util::CancellationToken`) และอาจบังคับยกเลิกเมื่อ grace timeout หมด

## การแมป JS API ↔ Rust export (ที่เกี่ยวกับงาน/การยกเลิก)

| JS API | Rust export (`#[napi]`) | Scheduler | การเชื่อมการยกเลิก |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` ใน filter loop |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` ใน scoring loop |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` แข่งกับ run task; เชื่อมต่อไปยัง Tokio `CancellationToken` |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | เหมือนกับข้างบน |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + `spawn_blocking` ภายใน | `CancelToken` ตรวจสอบใน sync PTY loop ผ่าน `heartbeat()` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | ไม่มี (token `()`) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | ไม่มี (token `()`) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | ไม่มี (token `()`) |

`text.rs` และ `ps.rs` ในปัจจุบันไม่ใช้ `task::blocking`/`task::future` ดังนั้นจึงไม่เข้าร่วมในเส้นทางการยกเลิกนี้

## วงจรชีวิตการยกเลิกและการเปลี่ยนแปลงสถานะ

### วงจรชีวิตของ `CancelToken`

`CancelToken` เป็นแบบร่วมมือและมีสถานะ:

```text
Created
  ├─ no signal + no timeout  -> passive token (never aborts unless externally emplaced)
  ├─ signal registered        -> waits for AbortSignal callback
  └─ deadline set             -> timeout check becomes active

Running
  ├─ heartbeat()/wait() sees signal   -> AbortReason::Signal
  ├─ heartbeat()/wait() sees deadline -> AbortReason::Timeout
  ├─ wait() sees Ctrl-C               -> AbortReason::User
  └─ no abort                         -> continue

Aborted (terminal)
  └─ first abort reason wins (atomic flag + notifier)
```

### การยกเลิกก่อนเริ่มต้นเทียบกับระหว่างการดำเนินงาน

- **ก่อนเริ่มต้น / ก่อนการตรวจสอบการยกเลิกครั้งแรก**:
  - ผู้ใช้ `task::future` ที่แข่งกันด้วย `ct.wait()` สามารถแก้ไขการยกเลิกได้ทันทีเมื่อเข้าสู่ `select!`
  - ผู้ใช้ `task::blocking` จะสังเกตการยกเลิกเฉพาะเมื่อโค้ด closure ถึง `heartbeat()` ถ้า closure ไม่ทำ heartbeat ก่อน การยกเลิกจะล่าช้า

- **ระหว่างการดำเนินงาน**:
  - `blocking`: `heartbeat()` ครั้งถัดไปคืนค่า `Err("Aborted: ...")`
  - `future`: branch ของ `ct.wait()` ชนะ `select!` แล้วโค้ดยกเลิกเครื่องจักร async รอง (สำหรับ shell: ยกเลิก Tokio token, รอสูงสุด 2 วินาที, จากนั้นยกเลิกงาน)

## ความคาดหวัง Heartbeat สำหรับ loops ที่ทำงานนาน

`heartbeat()` ต้องทำงานในจังหวะที่คาดเดาได้ใน loops ที่มีชุดงานขนาดใหญ่หรือไม่จำกัด

รูปแบบที่พบ:

- `glob::filter_entries`: ตรวจสอบแต่ละรายการก่อน filtering/matching
- `fd::score_entries`: ตรวจสอบแต่ละตัวเลือกที่สแกน
- `grep_sync`: ตรวจสอบการยกเลิกอย่างชัดเจนก่อนขั้นตอนการค้นหาที่หนัก บวกกับการเรียก fs-cache ที่รับ token ด้วย
- `run_pty_sync`: ตรวจสอบทุก loop tick (~16ms sleep cadence) และ kill child เมื่อยกเลิก

กฎปฏิบัติ: ไม่มี loop ที่ประมวลผลข้อมูลที่มีขนาดจากภายนอกควรเกินช่วงเวลาสั้นๆ ที่กำหนดโดยไม่มี heartbeat

## พฤติกรรมความล้มเหลวและการส่งต่อข้อผิดพลาดไปยัง JS

### Blocking tasks

เส้นทางข้อผิดพลาด:

1. Closure คืนค่า `Err(napi::Error)` (รวมถึงการยกเลิกของ `heartbeat()`)
2. `Task::compute()` คืนค่า `Err`
3. `AsyncTask` ปฏิเสธ JS promise

สตริงข้อผิดพลาดทั่วไป:

- `Aborted: Timeout`
- `Aborted: Signal`
- ข้อผิดพลาดเฉพาะโดเมน (`Failed to decode image: ...`, `Conversion error: ...`, ฯลฯ)

### Future tasks

เส้นทางข้อผิดพลาด:

1. Async body คืนค่า `Err(napi::Error)` หรือ join failure ถูกแมป (`... task failed: {err}`)
2. Promise ที่สร้างโดย `task::future` ถูกปฏิเสธ
3. API บางรายการจงใจคืนค่าผลลัพธ์การยกเลิกแบบมีโครงสร้างแทนการปฏิเสธ (`ShellRunResult`/`ShellExecuteResult` พร้อม flags `cancelled`/`timed_out` และ `exit_code: None`)

### การแบ่งการรายงานการยกเลิก

- **ยกเลิกเป็น error**: export ที่ blocking ส่วนใหญ่ใช้ `heartbeat()?`
- **ยกเลิกเป็น typed result**: API คำสั่งแบบ shell/pty ที่จำลองการยกเลิกใน result structs

เลือกโมเดลเดียวต่อ API และจัดทำเอกสารอย่างชัดเจน

## ข้อผิดพลาดที่พบบ่อย

1. **ขาด heartbeat ใน blocking loops**
   - อาการ: timeout/signal ดูเหมือนถูกละเลยจนกว่า loop จะสิ้นสุด
   - การแก้ไข: เพิ่ม `ct.heartbeat()?` ที่ด้านบนของ loop และก่อนขั้นตอนที่มีราคาแพงต่อรายการ

2. **ส่วนที่ยกเลิกไม่ได้ยาวนาน**
   - อาการ: latency การยกเลิกพุ่งสูงระหว่างการเรียกครั้งเดียวที่ใหญ่ (decode, sort, compression ฯลฯ)
   - การแก้ไข: แบ่งงานเป็น chunks พร้อม heartbeat boundaries; ถ้าเป็นไปไม่ได้ ให้จัดทำเอกสาร latency

3. **การบล็อก async executor**
   - อาการ: API แบบ async หยุดทำงานเมื่อโค้ดที่ใช้ CPU/sync ทำงานโดยตรงใน future
   - การแก้ไข: ย้าย CPU/sync blocks ไปยัง `task::blocking` หรือ `tokio::task::spawn_blocking`

4. **ความหมายการยกเลิกที่ไม่สอดคล้องกัน**
   - อาการ: API หนึ่งปฏิเสธเมื่อยกเลิก อีก API แก้ไขด้วย flags ทำให้ผู้เรียกสับสน
   - การแก้ไข: กำหนดมาตรฐานต่อโดเมนและให้ wrapper docs สอดคล้องกัน

5. **ลืมการเชื่อม cancellation ใน nested async tasks**
   - อาการ: outer token ถูกยกเลิก แต่ inner readers/subprocess tasks ยังคงทำงาน
   - การแก้ไข: เชื่อมการยกเลิกไปยัง inner token/signal และบังคับ grace timeout + fallback การยกเลิกบังคับ

## Checklist สำหรับ exports ที่ยกเลิกได้ใหม่

1. จำแนกงานอย่างถูกต้อง:
   - CPU-bound หรือ sync blocking -> `task::blocking`
   - async I/O / การประสาน `await` -> `task::future`

2. เปิดเผยข้อมูล cancel เมื่อจำเป็น:
   - รวม `timeoutMs` และ `signal` ใน options ของ `#[napi(object)]`
   - สร้าง `let ct = task::CancelToken::new(timeout_ms, signal);`

3. เชื่อมการยกเลิกผ่านทุก layer:
   - blocking loops: `ct.heartbeat()?` ที่ช่วงเวลาที่สม่ำเสมอ
   - async orchestration: แข่งกับ `ct.wait()` และยกเลิก sub-tasks/tokens

4. กำหนดสัญญาการยกเลิก:
   - ปฏิเสธ promise ด้วย abort error หรือ
   - แก้ไข typed `{ cancelled, timedOut, ... }`
   - รักษาสัญญานี้ให้สอดคล้องกันสำหรับ API family

5. ส่งต่อความล้มเหลวพร้อมบริบท:
   - แมป errors ผ่าน `Error::from_reason(format!("...: {err}"))`
   - รวม prefixes เฉพาะขั้นตอน (`spawn`, `decode`, `wait`, ฯลฯ)

6. จัดการการยกเลิกก่อนเริ่มต้นและระหว่างการดำเนินงาน:
   - การตรวจสอบ/รอการยกเลิกต้องเกิดขึ้นก่อน body ที่มีราคาแพงและระหว่างการดำเนินงานที่ยาวนาน

7. ตรวจสอบว่าไม่มีการใช้ executor ผิดวิธี:
   - ไม่มีงาน sync ที่ยาวนานโดยตรงภายใน async futures โดยไม่มี `spawn_blocking`/blocking task wrapper
