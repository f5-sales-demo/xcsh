---
title: Native Rust Task Execution and Cancellation
description: >-
  โมเดลการรัน async task ของ Rust
  พร้อมการยกเลิกแบบร่วมมือและซีแมนทิกส์การทำความสะอาด
sidebar:
  order: 5
  label: การยกเลิก Task
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# การรัน task และการยกเลิกแบบ Native Rust (`pi-natives`)

เอกสารนี้อธิบายวิธีที่ `crates/pi-natives` จัดตารางงาน native และวิธีที่การยกเลิกไหลจากตัวเลือก JS (`timeoutMs`, `AbortSignal`) ไปยังการรันใน Rust

## ไฟล์การ implement

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

## พื้นฐานหลัก (`task.rs`)

`task.rs` กำหนดส่วนประกอบหลักสามส่วน:

1. `task::blocking(tag, cancel_token, work)`
   - ครอบ `napi::AsyncTask` / `Task`
   - `compute()` ทำงานบน libuv worker threads (สำหรับการเรียกระบบที่ใช้ CPU มากหรือ blocking/sync)
   - คืนค่า JS `Promise<T>`

2. `task::future(env, tag, work)`
   - ครอบ `env.spawn_future(...)`
   - รันงาน async บน Tokio runtime
   - คืนค่า `PromiseRaw<'env, T>`

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` รวม deadline + `AbortSignal` ที่เป็นตัวเลือก
   - `CancelToken::heartbeat()` เป็นการยกเลิกแบบร่วมมือสำหรับลูปที่ blocking
   - `CancelToken::wait()` เป็นการรอการยกเลิกแบบ async (`Signal` / `Timeout` / `User` Ctrl-C)
   - `AbortToken` ให้โค้ดภายนอกร้องขอการยกเลิก (`abort(reason)`)

## `blocking` vs `future`: โมเดลการรันและการเลือกใช้

### ใช้ `task::blocking`

ใช้เมื่องานใช้ CPU มากหรือเป็น synchronous/blocking โดยพื้นฐาน:

- การสแกน regex/ไฟล์ (`grep`, `glob`, `fuzzy_find`)
- ภายในลูป PTY แบบ synchronous (`run_pty_sync` ผ่าน `spawn_blocking`)
- การแปลง clipboard/image/html

พฤติกรรม:

- work closure ได้รับ `CancelToken` ที่ถูก clone
- การยกเลิกจะถูกสังเกตเฉพาะเมื่อโค้ดตรวจสอบ `ct.heartbeat()?`
- closure `Err(...)` จะ reject JS promise

### ใช้ `task::future`

ใช้เมื่องานต้อง `await` การดำเนินการแบบ async:

- การจัดการ shell session (`shell.run`, `executeShell`)
- การแข่ง task (`tokio::select!`) ระหว่างการเสร็จสมบูรณ์และการยกเลิก

พฤติกรรม:

- Future สามารถแข่งระหว่างการเสร็จสมบูรณ์ปกติกับ `ct.wait()`
- ในเส้นทางการยกเลิก การ implement แบบ async โดยทั่วไปจะส่งต่อการยกเลิกไปยังระบบย่อยภายใน (เช่น `tokio_util::CancellationToken`) และอาจบังคับ abort เมื่อหมดเวลา grace timeout

## การแมป JS API ↔ Rust export (ที่เกี่ยวข้องกับ task/cancel)

| JS-facing API | Rust export (`#[napi]`) | Scheduler | การเชื่อมต่อการยกเลิก |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` ในลูป filter |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` ในลูป scoring |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` แข่งกับ run task; เชื่อมต่อกับ Tokio `CancellationToken` |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | เหมือนข้างบน |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + inner `spawn_blocking` | `CancelToken` ถูกตรวจสอบในลูป PTY แบบ sync ผ่าน `heartbeat()` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | ไม่มี (token `()`) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | ไม่มี (token `()`) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | ไม่มี (token `()`) |

`text.rs` และ `ps.rs` ปัจจุบันไม่ใช้ `task::blocking`/`task::future` จึงไม่เข้าร่วมในเส้นทางการยกเลิกนี้

## วงจรชีวิตการยกเลิกและการเปลี่ยนสถานะ

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

### การยกเลิกก่อนเริ่ม vs ระหว่างการรัน

- **ก่อนเริ่ม / ก่อนการตรวจสอบการยกเลิกครั้งแรก**:
  - ผู้ใช้ `task::future` ที่แข่งกับ `ct.wait()` สามารถ resolve การยกเลิกได้ทันทีเมื่อเข้าสู่ `select!`
  - ผู้ใช้ `task::blocking` จะสังเกตการยกเลิกเมื่อโค้ด closure ถึง `heartbeat()` เท่านั้น หาก closure ไม่ heartbeat เร็ว การยกเลิกจะล่าช้า

- **ระหว่างการรัน**:
  - `blocking`: `heartbeat()` ถัดไปคืนค่า `Err("Aborted: ...")`
  - `future`: สาขา `ct.wait()` ชนะ `select!` จากนั้นโค้ดจะยกเลิกกลไก async ย่อย (สำหรับ shell: ยกเลิก Tokio token, รอสูงสุด 2 วินาที, จากนั้น abort task)

## ความคาดหวังของ heartbeat สำหรับลูปที่ทำงานนาน

`heartbeat()` ต้องทำงานในจังหวะที่คาดการณ์ได้ในลูปที่มีชุดงานไม่จำกัดหรือขนาดใหญ่

รูปแบบที่สังเกตได้:

- `glob::filter_entries`: ตรวจสอบแต่ละรายการก่อนการ filter/matching
- `fd::score_entries`: ตรวจสอบแต่ละ candidate ที่สแกน
- `grep_sync`: ตรวจสอบการยกเลิกอย่างชัดเจนก่อนขั้นตอนการค้นหาที่หนัก รวมถึงการเรียก fs-cache ที่ได้รับ token ด้วย
- `run_pty_sync`: ตรวจสอบทุกรอบลูป (จังหวะ sleep ~16ms) และ kill child เมื่อมีการยกเลิก

กฎในทางปฏิบัติ: ไม่ควรมีลูปที่วนซ้ำบน input ขนาดจากภายนอกเกินช่วงเวลาสั้นๆ ที่กำหนดโดยไม่มี heartbeat

## พฤติกรรมเมื่อล้มเหลวและการส่งต่อ error ไปยัง JS

### Blocking tasks

เส้นทาง error:

1. Closure คืนค่า `Err(napi::Error)` (รวมถึง abort จาก `heartbeat()`)
2. `Task::compute()` คืนค่า `Err`
3. `AsyncTask` reject JS promise

ข้อความ error ทั่วไป:

- `Aborted: Timeout`
- `Aborted: Signal`
- domain errors (`Failed to decode image: ...`, `Conversion error: ...`, เป็นต้น)

### Future tasks

เส้นทาง error:

1. async body คืนค่า `Err(napi::Error)` หรือ join failure ถูกแมป (`... task failed: {err}`)
2. promise ที่ spawn โดย `task::future` ถูก reject
3. บาง API ตั้งใจคืนค่าผลลัพธ์การยกเลิกแบบมีโครงสร้างแทนการ rejection (`ShellRunResult`/`ShellExecuteResult` พร้อม flag `cancelled`/`timed_out` และ `exit_code: None`)

### การแยกการรายงานการยกเลิก

- **Abort เป็น error**: export แบบ blocking ส่วนใหญ่ที่ใช้ `heartbeat()?`
- **Abort เป็น typed result**: API สไตล์ shell/pty ที่โมเดลการยกเลิกใน result structs

เลือกโมเดลเดียวต่อ API และบันทึกไว้อย่างชัดเจน

## ข้อผิดพลาดที่พบบ่อย

1. **ขาด heartbeat ในลูปแบบ blocking**
   - อาการ: timeout/signal ดูเหมือนถูกเพิกเฉยจนกว่าลูปจะจบ
   - แก้ไข: เพิ่ม `ct.heartbeat()?` ที่ด้านบนของลูปและก่อนขั้นตอนที่แพงต่อรายการ

2. **ส่วนที่ยาวไม่สามารถยกเลิกได้**
   - อาการ: ความหน่วงของการยกเลิกพุ่งสูงระหว่างการเรียกครั้งเดียวที่ใหญ่ (decode, sort, compression, เป็นต้น)
   - แก้ไข: แบ่งงานเป็นชิ้นพร้อมขอบเขต heartbeat; หากไม่สามารถทำได้ ให้บันทึกความหน่วง

3. **Blocking async executor**
   - อาการ: async API หยุดนิ่งเมื่อโค้ดที่ใช้ sync มากทำงานโดยตรงใน future
   - แก้ไข: ย้ายบล็อก CPU/sync ไปที่ `task::blocking` หรือ `tokio::task::spawn_blocking`

4. **ซีแมนทิกส์การยกเลิกไม่สอดคล้องกัน**
   - อาการ: API หนึ่ง reject เมื่อยกเลิก อีก API resolve พร้อม flags ทำให้ผู้เรียกสับสน
   - แก้ไข: ทำให้เป็นมาตรฐานต่อโดเมนและรักษาเอกสาร wrapper ให้สอดคล้อง

5. **ลืมเชื่อมต่อการยกเลิกใน async tasks ที่ซ้อนกัน**
   - อาการ: token ภายนอกถูกยกเลิกแต่ reader/subprocess tasks ภายในยังทำงานต่อ
   - แก้ไข: เชื่อมต่อการยกเลิกไปยัง token/signal ภายในและบังคับ grace timeout + forced abort fallback

## รายการตรวจสอบสำหรับ export ที่ยกเลิกได้ใหม่

1. จำแนกงานให้ถูกต้อง:
   - CPU-bound หรือ sync blocking -> `task::blocking`
   - async I/O / การจัดการ `await` -> `task::future`

2. เปิดเผย cancel inputs เมื่อจำเป็น:
   - รวม `timeoutMs` และ `signal` ใน `#[napi(object)]` options
   - สร้าง `let ct = task::CancelToken::new(timeout_ms, signal);`

3. เชื่อมต่อการยกเลิกผ่านทุกชั้น:
   - blocking loops: `ct.heartbeat()?` ในช่วงเวลาที่สม่ำเสมอ
   - async orchestration: แข่งกับ `ct.wait()` และยกเลิก sub-tasks/tokens

4. ตัดสินใจสัญญาการยกเลิก:
   - reject promise ด้วย abort error, หรือ
   - resolve typed `{ cancelled, timedOut, ... }`
   - รักษาสัญญานี้ให้สอดคล้องกันสำหรับกลุ่ม API

5. ส่งต่อ failure พร้อมบริบท:
   - แมป errors ผ่าน `Error::from_reason(format!("...: {err}"))`
   - รวม prefix เฉพาะขั้นตอน (`spawn`, `decode`, `wait`, เป็นต้น)

6. จัดการการยกเลิกก่อนเริ่มและระหว่างทาง:
   - การตรวจสอบ/await การยกเลิกต้องเกิดขึ้นก่อน body ที่แพงและระหว่างการรันที่นาน

7. ตรวจสอบว่าไม่มีการใช้ executor ผิดวิธี:
   - ไม่มีงาน sync ที่นานโดยตรงใน async futures โดยไม่มี `spawn_blocking`/blocking task wrapper
