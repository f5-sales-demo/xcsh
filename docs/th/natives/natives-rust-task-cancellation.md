---
title: การทำงานของ Native Rust Task และการยกเลิก
description: >-
  โมเดลการทำงานของ Rust async task
  พร้อมการยกเลิกแบบร่วมมือและความหมายของการล้างข้อมูล
sidebar:
  order: 5
  label: การยกเลิก Task
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# การทำงานของ Native Rust task และการยกเลิก (`pi-natives`)

เอกสารนี้อธิบายวิธีที่ `crates/pi-natives` จัดกำหนดการทำงาน native work และวิธีที่การยกเลิกไหลจากตัวเลือก JS (`timeoutMs`, `AbortSignal`) ไปยังการทำงานใน Rust

## ไฟล์การ Implement

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

## Primitive หลัก (`task.rs`)

`task.rs` กำหนดส่วนประกอบหลักสามส่วน:

1. `task::blocking(tag, cancel_token, work)`
   - ห่อหุ้ม `napi::AsyncTask` / `Task`
   - `compute()` ทำงานบน libuv worker threads (สำหรับงาน CPU-bound หรือ blocking/sync system calls)
   - คืนค่า JS `Promise<T>`

2. `task::future(env, tag, work)`
   - ห่อหุ้ม `env.spawn_future(...)`
   - ทำงาน async work บน Tokio runtime
   - คืนค่า `PromiseRaw<'env, T>`

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` รวม deadline + `AbortSignal` ที่เป็นทางเลือก
   - `CancelToken::heartbeat()` คือการยกเลิกแบบร่วมมือสำหรับ blocking loops
   - `CancelToken::wait()` คือการรอการยกเลิกแบบ async (`Signal` / `Timeout` / `User` Ctrl-C)
   - `AbortToken` ให้โค้ดภายนอกร้องขอการ abort ได้ (`abort(reason)`)

## `blocking` vs `future`: โมเดลการทำงานและการเลือกใช้

### ใช้ `task::blocking`

ใช้เมื่องานเป็น CPU-heavy หรือเป็น synchronous/blocking โดยพื้นฐาน:

- การสแกน regex/ไฟล์ (`grep`, `glob`, `fuzzy_find`)
- ภายในของ synchronous PTY loop (`run_pty_sync` ผ่าน `spawn_blocking`)
- การแปลง clipboard/image/html

พฤติกรรม:

- Work closure รับ `CancelToken` ที่ถูก clone มา
- การยกเลิกจะถูกสังเกตเฉพาะที่โค้ดตรวจสอบ `ct.heartbeat()?` เท่านั้น
- Closure `Err(...)` จะ reject JS promise

### ใช้ `task::future`

ใช้เมื่องานต้อง `await` async operations:

- การจัดการ shell session (`shell.run`, `executeShell`)
- การแข่งขัน task (`tokio::select!`) ระหว่างการเสร็จสมบูรณ์และการยกเลิก

พฤติกรรม:

- Future สามารถแข่งระหว่างการเสร็จสมบูรณ์ปกติกับ `ct.wait()`
- เมื่ออยู่ในเส้นทางการยกเลิก การ implement แบบ async มักจะส่งต่อการยกเลิกไปยังระบบย่อยภายใน (เช่น `tokio_util::CancellationToken`) และอาจบังคับ abort เมื่อหมดเวลา grace timeout

## การ map JS API ↔ Rust export (ที่เกี่ยวข้องกับ task/cancel)

| JS-facing API | Rust export (`#[napi]`) | Scheduler | การเชื่อมต่อการยกเลิก |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` ใน filter loop |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` ใน scoring loop |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` แข่งกับ run task; เชื่อมไปยัง Tokio `CancellationToken` |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | เหมือนข้างบน |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + inner `spawn_blocking` | `CancelToken` ถูกตรวจสอบใน sync PTY loop ผ่าน `heartbeat()` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | ไม่มี (token `()`) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | ไม่มี (token `()`) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | ไม่มี (token `()`) |

`text.rs` และ `ps.rs` ในปัจจุบันไม่ใช้ `task::blocking`/`task::future` จึงไม่เข้าร่วมในเส้นทางการยกเลิกนี้

## วงจรชีวิตของการยกเลิกและการเปลี่ยนแปลงสถานะ

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

### การยกเลิกก่อนเริ่มต้น vs ระหว่างการทำงาน

- **ก่อนเริ่มต้น / ก่อนการตรวจสอบการยกเลิกครั้งแรก**:
  - ผู้ใช้ `task::future` ที่แข่งกับ `ct.wait()` สามารถ resolve การยกเลิกได้ทันทีเมื่อเข้าสู่ `select!`
  - ผู้ใช้ `task::blocking` จะสังเกตการยกเลิกเฉพาะเมื่อโค้ดของ closure ถึง `heartbeat()` เท่านั้น หาก closure ไม่ heartbeat เร็ว การยกเลิกจะถูกหน่วงเวลา

- **ระหว่างการทำงาน**:
  - `blocking`: `heartbeat()` ถัดไปจะคืนค่า `Err("Aborted: ...")`
  - `future`: branch `ct.wait()` ชนะ `select!` จากนั้นโค้ดจะยกเลิก async machinery ย่อย (สำหรับ shell: ยกเลิก Tokio token, รอสูงสุด 2 วินาที, จากนั้น abort task)

## ความคาดหวังของ Heartbeat สำหรับ loop ที่ทำงานนาน

`heartbeat()` ต้องทำงานด้วยจังหวะที่คาดเดาได้ใน loop ที่มีชุดงานไม่จำกัดหรือขนาดใหญ่

รูปแบบที่พบ:

- `glob::filter_entries`: ตรวจสอบแต่ละ entry ก่อนการกรอง/จับคู่
- `fd::score_entries`: ตรวจสอบแต่ละ candidate ที่ถูกสแกน
- `grep_sync`: การตรวจสอบการยกเลิกอย่างชัดเจนก่อนขั้นตอนการค้นหาที่หนัก รวมถึง fs-cache calls ที่ได้รับ token ด้วย
- `run_pty_sync`: ตรวจสอบทุก loop tick (~16ms sleep cadence) และ kill child เมื่อถูกยกเลิก

กฎในทางปฏิบัติ: ไม่มี loop ที่ทำงานกับ input ขนาดภายนอกควรเกินช่วงเวลาสั้นที่จำกัดโดยไม่มี heartbeat

## พฤติกรรมเมื่อล้มเหลวและการส่งต่อ error ไปยัง JS

### Blocking tasks

เส้นทาง error:

1. Closure คืนค่า `Err(napi::Error)` (รวมถึง `heartbeat()` abort)
2. `Task::compute()` คืนค่า `Err`
3. `AsyncTask` reject JS promise

ข้อความ error ทั่วไป:

- `Aborted: Timeout`
- `Aborted: Signal`
- domain errors (`Failed to decode image: ...`, `Conversion error: ...`, เป็นต้น)

### Future tasks

เส้นทาง error:

1. Async body คืนค่า `Err(napi::Error)` หรือ join failure ถูก map (`... task failed: {err}`)
2. Promise ที่ถูก spawn โดย `task::future` จะ reject
3. บาง API ตั้งใจคืนค่าผลลัพธ์การยกเลิกแบบมีโครงสร้างแทนที่จะ reject (`ShellRunResult`/`ShellExecuteResult` พร้อม flags `cancelled`/`timed_out` และ `exit_code: None`)

### การแบ่งการรายงานการยกเลิก

- **Abort เป็น error**: ส่วนใหญ่เป็น blocking exports ที่ใช้ `heartbeat()?`
- **Abort เป็น typed result**: API สไตล์ shell/pty command ที่จำลองการยกเลิกใน result structs

เลือกหนึ่งโมเดลต่อ API และจัดทำเอกสารอย่างชัดเจน

## ข้อผิดพลาดที่พบบ่อย

1. **ขาด heartbeat ใน blocking loops**
   - อาการ: timeout/signal ดูเหมือนถูกละเว้นจนกว่า loop จะจบ
   - แก้ไข: เพิ่ม `ct.heartbeat()?` ที่ด้านบนของ loop และก่อนขั้นตอนที่หนักต่อ item

2. **ส่วนที่ยกเลิกไม่ได้ที่ยาวนาน**
   - อาการ: ความล่าช้าในการยกเลิกพุ่งสูงระหว่าง single large call (decode, sort, compression, เป็นต้น)
   - แก้ไข: แบ่งงานออกเป็น chunks พร้อม heartbeat boundaries; หากเป็นไปไม่ได้ ให้จัดทำเอกสารความล่าช้า

3. **Blocking async executor**
   - อาการ: async API หยุดชะงักเมื่อโค้ดที่หนักด้าน sync ทำงานโดยตรงใน future
   - แก้ไข: ย้าย CPU/sync blocks ไปยัง `task::blocking` หรือ `tokio::task::spawn_blocking`

4. **ความหมายการยกเลิกที่ไม่สอดคล้องกัน**
   - อาการ: API หนึ่ง reject เมื่อยกเลิก, อีก API resolve ด้วย flags, ทำให้ผู้เรียกสับสน
   - แก้ไข: ทำให้เป็นมาตรฐานต่อ domain และรักษาเอกสาร wrapper ให้สอดคล้องกัน

5. **ลืมเชื่อมต่อการยกเลิกใน nested async tasks**
   - อาการ: token ภายนอกถูกยกเลิกแต่ inner readers/subprocess tasks ยังคงทำงานต่อ
   - แก้ไข: เชื่อมการยกเลิกไปยัง inner token/signal และบังคับใช้ grace timeout + forced abort fallback

## รายการตรวจสอบสำหรับ cancellable exports ใหม่

1. จำแนกงานอย่างถูกต้อง:
   - CPU-bound หรือ sync blocking -> `task::blocking`
   - async I/O / การจัดการ `await` -> `task::future`

2. เปิดเผย cancel inputs เมื่อจำเป็น:
   - รวม `timeoutMs` และ `signal` ใน `#[napi(object)]` options
   - สร้าง `let ct = task::CancelToken::new(timeout_ms, signal);`

3. เชื่อมต่อการยกเลิกผ่านทุกชั้น:
   - blocking loops: `ct.heartbeat()?` ที่ช่วงเวลาคงที่
   - async orchestration: แข่งกับ `ct.wait()` และยกเลิก sub-tasks/tokens

4. กำหนดสัญญาการยกเลิก:
   - reject promise ด้วย abort error, หรือ
   - resolve typed `{ cancelled, timedOut, ... }`
   - รักษาสัญญานี้ให้สอดคล้องกันสำหรับกลุ่ม API

5. ส่งต่อความล้มเหลวพร้อมบริบท:
   - map errors ผ่าน `Error::from_reason(format!("...: {err}"))`
   - รวม prefixes เฉพาะขั้นตอน (`spawn`, `decode`, `wait`, เป็นต้น)

6. จัดการการยกเลิกก่อนเริ่มต้นและระหว่างการทำงาน:
   - การตรวจสอบ/await การยกเลิกต้องเกิดขึ้นก่อน body ที่หนักและระหว่างการทำงานที่ยาวนาน

7. ตรวจสอบว่าไม่มีการใช้ executor ผิดวิธี:
   - ไม่มีงาน sync ที่ยาวนานโดยตรงภายใน async futures โดยไม่มี `spawn_blocking`/blocking task wrapper
