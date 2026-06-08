---
title: Native Rust Task Execution and Cancellation
description: >-
  Rust async task execution model with cooperative cancellation and cleanup
  semantics.
sidebar:
  order: 5
  label: Task cancellation
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# การดำเนินงาน Native Rust task และการยกเลิก (`pi-natives`)

เอกสารนี้อธิบายว่า `crates/pi-natives` จัดตารางงาน native อย่างไร และการยกเลิกไหลจาก JS options (`timeoutMs`, `AbortSignal`) ไปยังการดำเนินงานใน Rust อย่างไร

## ไฟล์ที่เกี่ยวข้องกับการ implementation

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

## ส่วนพื้นฐานหลัก (`task.rs`)

`task.rs` กำหนดส่วนหลักสามส่วน:

1. `task::blocking(tag, cancel_token, work)`
   - ครอบ `napi::AsyncTask` / `Task`
   - `compute()` ทำงานบน libuv worker threads (สำหรับงานที่ใช้ CPU เป็นหลักหรือ blocking/sync system calls)
   - คืนค่าเป็น JS `Promise<T>`

2. `task::future(env, tag, work)`
   - ครอบ `env.spawn_future(...)`
   - ทำงาน async บน Tokio runtime
   - คืนค่าเป็น `PromiseRaw<'env, T>`

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` รวม deadline + `AbortSignal` ที่เป็น optional
   - `CancelToken::heartbeat()` คือการยกเลิกแบบ cooperative สำหรับ blocking loops
   - `CancelToken::wait()` คือการรอการยกเลิกแบบ async (`Signal` / `Timeout` / `User` Ctrl-C)
   - `AbortToken` ให้โค้ดภายนอกร้องขอการยกเลิก (`abort(reason)`)

## `blocking` vs `future`: โมเดลการดำเนินงานและการเลือกใช้

### ใช้ `task::blocking`

ใช้เมื่องานใช้ CPU หนักหรือเป็น synchronous/blocking โดยธรรมชาติ:

- regex/file scanning (`grep`, `glob`, `fuzzy_find`)
- ส่วนภายในของ synchronous PTY loop (`run_pty_sync` ผ่าน `spawn_blocking`)
- clipboard/image/html conversions

พฤติกรรม:

- Work closure ได้รับ `CancelToken` ที่ถูก clone
- การยกเลิกจะถูกตรวจสอบเฉพาะจุดที่โค้ดเรียก `ct.heartbeat()?` เท่านั้น
- Closure `Err(...)` จะ reject JS promise

### ใช้ `task::future`

ใช้เมื่องานต้อง `await` async operations:

- shell session orchestration (`shell.run`, `executeShell`)
- task racing (`tokio::select!`) ระหว่างการทำงานสำเร็จและการยกเลิก

พฤติกรรม:

- Future สามารถ race ระหว่างการทำงานสำเร็จปกติกับ `ct.wait()`
- ในเส้นทางการยกเลิก async implementations จะแพร่การยกเลิกไปยังระบบย่อยภายใน (เช่น `tokio_util::CancellationToken`) และอาจบังคับ abort เมื่อหมด grace timeout

## การแมป JS API ↔ Rust export (ที่เกี่ยวข้องกับ task/cancel)

| JS-facing API | Rust export (`#[napi]`) | Scheduler | การเชื่อมต่อการยกเลิก |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` ใน filter loop |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` ใน scoring loop |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` ถูก race กับ run task; เชื่อมไปยัง Tokio `CancellationToken` |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | เหมือนข้างบน |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + `spawn_blocking` ภายใน | `CancelToken` ถูกตรวจสอบใน sync PTY loop ผ่าน `heartbeat()` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | ไม่มี (token เป็น `()`) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | ไม่มี (token เป็น `()`) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | ไม่มี (token เป็น `()`) |

`text.rs` และ `ps.rs` ในปัจจุบันไม่ใช้ `task::blocking`/`task::future` จึงไม่เข้าร่วมในเส้นทางการยกเลิกนี้

## วงจรชีวิตการยกเลิกและการเปลี่ยนสถานะ

### วงจรชีวิต `CancelToken`

`CancelToken` เป็นแบบ cooperative และมีสถานะ:

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

### การยกเลิกก่อนเริ่มทำงาน vs ระหว่างการดำเนินงาน

- **ก่อนเริ่ม / ก่อนการตรวจสอบการยกเลิกครั้งแรก**:
  - ผู้ใช้ `task::future` ที่ race กับ `ct.wait()` สามารถ resolve การยกเลิกได้ทันทีเมื่อเข้าสู่ `select!`
  - ผู้ใช้ `task::blocking` จะตรวจพบการยกเลิกเฉพาะเมื่อโค้ดใน closure ถึง `heartbeat()` หากไม่มี heartbeat ตั้งแต่ต้น การยกเลิกจะถูกหน่วง

- **ระหว่างการดำเนินงาน**:
  - `blocking`: `heartbeat()` ครั้งถัดไปจะคืนค่า `Err("Aborted: ...")`
  - `future`: branch ของ `ct.wait()` ชนะ `select!` จากนั้นโค้ดจะยกเลิก async machinery ย่อย (สำหรับ shell: ยกเลิก Tokio token, รอไม่เกิน 2 วินาที, แล้ว abort task)

## ความคาดหวังของ Heartbeat สำหรับ loop ที่ทำงานนาน

`heartbeat()` ต้องทำงานด้วยจังหวะที่คาดการณ์ได้ใน loop ที่มีชุดงานไม่จำกัดหรือขนาดใหญ่

รูปแบบที่พบ:

- `glob::filter_entries`: ตรวจสอบแต่ละ entry ก่อน filtering/matching
- `fd::score_entries`: ตรวจสอบแต่ละ candidate ที่ถูกสแกน
- `grep_sync`: ตรวจสอบการยกเลิกอย่างชัดเจนก่อนขั้นตอนค้นหาที่หนัก รวมถึงการเรียก fs-cache ที่ได้รับ token ด้วย
- `run_pty_sync`: ตรวจสอบทุก loop tick (~16ms sleep cadence) และ kill child process เมื่อถูกยกเลิก

กฎในทางปฏิบัติ: ไม่ควรมี loop ที่วนซ้ำบน input ขนาดไม่จำกัดที่ใช้เวลานานเกินช่วงเวลาสั้น ๆ ที่กำหนดโดยไม่มี heartbeat

## พฤติกรรมเมื่อเกิดข้อผิดพลาดและการแพร่ error ไปยัง JS

### Blocking tasks

เส้นทางข้อผิดพลาด:

1. Closure คืนค่า `Err(napi::Error)` (รวมถึง abort จาก `heartbeat()`)
2. `Task::compute()` คืนค่า `Err`
3. `AsyncTask` reject JS promise

ข้อความ error ทั่วไป:

- `Aborted: Timeout`
- `Aborted: Signal`
- domain errors (`Failed to decode image: ...`, `Conversion error: ...` ฯลฯ)

### Future tasks

เส้นทางข้อผิดพลาด:

1. Async body คืนค่า `Err(napi::Error)` หรือ join failure ถูกแมป (`... task failed: {err}`)
2. Promise ที่ spawn จาก `task::future` ถูก reject
3. บาง API ตั้งใจคืนผลลัพธ์การยกเลิกแบบมีโครงสร้างแทนการ reject (`ShellRunResult`/`ShellExecuteResult` ที่มี flag `cancelled`/`timed_out` และ `exit_code: None`)

### การแบ่งรูปแบบการรายงานการยกเลิก

- **Abort เป็น error**: blocking exports ส่วนใหญ่ที่ใช้ `heartbeat()?`
- **Abort เป็น typed result**: API สไตล์ shell/pty command ที่จำลองการยกเลิกใน result structs

เลือกโมเดลเดียวต่อ API และระบุไว้อย่างชัดเจน

## ข้อผิดพลาดที่พบบ่อย

1. **ขาด heartbeat ใน blocking loops**
   - อาการ: timeout/signal ดูเหมือนถูกเพิกเฉยจนกว่า loop จะจบ
   - แก้ไข: เพิ่ม `ct.heartbeat()?` ที่ด้านบนของ loop และก่อนขั้นตอนที่หนักต่อแต่ละ item

2. **ส่วนที่ไม่สามารถยกเลิกได้ที่ยาวนาน**
   - อาการ: เวลาแฝงของการยกเลิกพุ่งสูงระหว่างการเรียกขนาดใหญ่ครั้งเดียว (decode, sort, compression ฯลฯ)
   - แก้ไข: แบ่งงานเป็นส่วนย่อยที่มี heartbeat boundaries; หากทำไม่ได้ ให้ระบุเวลาแฝงไว้

3. **Blocking async executor**
   - อาการ: async API หยุดทำงานเมื่อโค้ดที่ใช้ sync หนักทำงานโดยตรงใน future
   - แก้ไข: ย้ายบล็อก CPU/sync ไปที่ `task::blocking` หรือ `tokio::task::spawn_blocking`

4. **ความหมายการยกเลิกไม่สอดคล้องกัน**
   - อาการ: API หนึ่ง reject เมื่อถูกยกเลิก อีก API resolve ด้วย flags ทำให้ผู้เรียกสับสน
   - แก้ไข: กำหนดมาตรฐานต่อ domain และให้เอกสาร wrapper สอดคล้องกัน

5. **ลืมเชื่อมการยกเลิกใน nested async tasks**
   - อาการ: token ภายนอกถูกยกเลิกแต่ reader/subprocess tasks ภายในยังทำงานต่อ
   - แก้ไข: เชื่อมการยกเลิกไปยัง inner token/signal และบังคับ grace timeout + forced abort fallback

## รายการตรวจสอบสำหรับ cancellable exports ใหม่

1. จำแนกประเภทงานให้ถูกต้อง:
   - CPU-bound หรือ sync blocking -> `task::blocking`
   - async I/O / `await` orchestration -> `task::future`

2. เปิดเผย cancel inputs เมื่อจำเป็น:
   - รวม `timeoutMs` และ `signal` ใน `#[napi(object)]` options
   - สร้าง `let ct = task::CancelToken::new(timeout_ms, signal);`

3. เชื่อมการยกเลิกผ่านทุกเลเยอร์:
   - blocking loops: `ct.heartbeat()?` ในช่วงเวลาที่สม่ำเสมอ
   - async orchestration: race กับ `ct.wait()` และยกเลิก sub-tasks/tokens

4. ตัดสินใจสัญญาการยกเลิก:
   - reject promise ด้วย abort error, หรือ
   - resolve typed `{ cancelled, timedOut, ... }`
   - รักษาสัญญานี้ให้สอดคล้องกันสำหรับกลุ่ม API

5. แพร่ failures พร้อมบริบท:
   - แมป errors ผ่าน `Error::from_reason(format!("...: {err}"))`
   - ใส่ prefix เฉพาะขั้นตอน (`spawn`, `decode`, `wait` ฯลฯ)

6. จัดการการยกเลิกก่อนเริ่มและระหว่างทำงาน:
   - การตรวจสอบ/await การยกเลิกต้องเกิดขึ้นก่อนส่วนงานหนักและระหว่างการดำเนินงานที่ยาวนาน

7. ตรวจสอบว่าไม่มีการใช้ executor ผิดวิธี:
   - ไม่ควรมีงาน sync ที่ยาวนานทำงานโดยตรงภายใน async futures โดยไม่มี `spawn_blocking`/blocking task wrapper
