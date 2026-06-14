---
title: การรันและการยกเลิกงานแบบ Native Rust
description: >-
  โมเดลการรันงานแบบ async ของ Rust พร้อมความหมายของการยกเลิกและการล้างข้อมูลแบบ
  cooperative
sidebar:
  order: 5
  label: การยกเลิกงาน
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# การรันและการยกเลิกงานแบบ Native Rust (`pi-natives`)

เอกสารนี้อธิบายวิธีที่ `crates/pi-natives` จัดกำหนดการทำงาน native และวิธีที่การยกเลิกส่งต่อจาก JS options (`timeoutMs`, `AbortSignal`) ไปยังการรันของ Rust

## ไฟล์การนำไปใช้งาน

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

## primitives หลัก (`task.rs`)

`task.rs` กำหนดส่วนหลักสามส่วน:

1. `task::blocking(tag, cancel_token, work)`
   - ครอบ `napi::AsyncTask` / `Task`
   - `compute()` รันบน libuv worker threads (สำหรับ CPU-bound หรือ system calls แบบ blocking/sync)
   - คืนค่า JS `Promise<T>`

2. `task::future(env, tag, work)`
   - ครอบ `env.spawn_future(...)`
   - รันงานแบบ async บน Tokio runtime
   - คืนค่า `PromiseRaw<'env, T>`

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` รวม deadline + `AbortSignal` แบบเลือกได้
   - `CancelToken::heartbeat()` คือการยกเลิกแบบ cooperative สำหรับ blocking loops
   - `CancelToken::wait()` คือการรอการยกเลิกแบบ async (`Signal` / `Timeout` / `User` Ctrl-C)
   - `AbortToken` ให้โค้ดภายนอกร้องขอการยกเลิกได้ (`abort(reason)`)

## `blocking` กับ `future`: โมเดลการรันและการเลือกใช้

### ใช้ `task::blocking`

ใช้เมื่องานใช้ CPU สูงหรือมีลักษณะเป็น synchronous/blocking โดยพื้นฐาน:

- การสแกน regex/ไฟล์ (`grep`, `glob`, `fuzzy_find`)
- การทำงานภายใน PTY loop แบบ synchronous (`run_pty_sync` ผ่าน `spawn_blocking`)
- การแปลง clipboard/image/html

พฤติกรรม:

- closure ของงานรับ `CancelToken` ที่ clone มา
- การยกเลิกจะถูกสังเกตเห็นเฉพาะเมื่อโค้ดตรวจสอบ `ct.heartbeat()?`
- closure ที่คืนค่า `Err(...)` จะ reject JS promise

### ใช้ `task::future`

ใช้เมื่องานต้อง `await` การทำงานแบบ async:

- การจัดการ shell session (`shell.run`, `executeShell`)
- การแข่งงาน (`tokio::select!`) ระหว่างการเสร็จสิ้นและการยกเลิก

พฤติกรรม:

- Future สามารถแข่งระหว่างการเสร็จสิ้นปกติกับ `ct.wait()`
- เมื่อถูกยกเลิก การนำไปใช้งานแบบ async มักจะส่งต่อการยกเลิกไปยัง subsystems ภายใน (เช่น `tokio_util::CancellationToken`) และอาจบังคับ abort หากเกิน grace timeout

## การแมป JS API ↔ Rust export (เกี่ยวกับ task/cancel)

| JS-facing API | Rust export (`#[napi]`) | Scheduler | การเชื่อมต่อการยกเลิก |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` ใน filter loop |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` ใน scoring loop |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` แข่งกับ run task; เชื่อมต่อกับ Tokio `CancellationToken` |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | เหมือนด้านบน |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + inner `spawn_blocking` | `CancelToken` ตรวจสอบใน sync PTY loop ผ่าน `heartbeat()` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | ไม่มี (token `()`) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | ไม่มี (token `()`) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | ไม่มี (token `()`) |

`text.rs` และ `ps.rs` ในปัจจุบันไม่ใช้ `task::blocking`/`task::future` จึงไม่เข้าร่วมในเส้นทางการยกเลิกนี้

## วงจรชีวิตการยกเลิกและการเปลี่ยนสถานะ

### วงจรชีวิตของ `CancelToken`

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

### การยกเลิกก่อนเริ่มงาน vs ระหว่างการรัน

- **ก่อนเริ่ม / ก่อนการตรวจสอบการยกเลิกครั้งแรก**:
  - ผู้ใช้ `task::future` ที่แข่งกับ `ct.wait()` สามารถ resolve การยกเลิกได้ทันทีเมื่อเข้าสู่ `select!`
  - ผู้ใช้ `task::blocking` จะสังเกตเห็นการยกเลิกได้ก็ต่อเมื่อโค้ดใน closure ถึง `heartbeat()` หากไม่มีการ heartbeat ในช่วงต้น การยกเลิกจะล่าช้า

- **ระหว่างการรัน**:
  - `blocking`: `heartbeat()` ครั้งถัดไปคืนค่า `Err("Aborted: ...")`
  - `future`: branch `ct.wait()` ชนะ `select!` จากนั้นโค้ดยกเลิก async machinery ที่อยู่ภายใน (สำหรับ shell: ยกเลิก Tokio token รอสูงสุด 2 วินาที จากนั้น abort งาน)

## ความคาดหวังของ Heartbeat สำหรับ loops ที่รันนาน

`heartbeat()` ต้องรันในจังหวะที่คาดเดาได้ใน loops ที่มีชุดงานขนาดใหญ่หรือไม่มีขอบเขต

รูปแบบที่พบ:

- `glob::filter_entries`: ตรวจสอบแต่ละรายการก่อนการกรอง/จับคู่
- `fd::score_entries`: ตรวจสอบแต่ละ candidate ที่สแกน
- `grep_sync`: ตรวจสอบการยกเลิกอย่างชัดเจนก่อนช่วงค้นหาหนัก บวกกับการเรียก fs-cache ที่รับ token ด้วย
- `run_pty_sync`: ตรวจสอบทุก loop tick (cadence sleep ~16ms) และ kill child เมื่อถูกยกเลิก

กฎปฏิบัติ: ไม่มี loop ที่ใช้ input จากภายนอกควรเกินช่วงเวลาที่จำกัดสั้นๆ โดยไม่มี heartbeat

## พฤติกรรมเมื่อเกิดความผิดพลาดและการส่งต่อ error ไปยัง JS

### Blocking tasks

เส้นทาง error:

1. closure คืนค่า `Err(napi::Error)` (รวมถึงการ abort จาก `heartbeat()`)
2. `Task::compute()` คืนค่า `Err`
3. `AsyncTask` reject JS promise

string ของ error ทั่วไป:

- `Aborted: Timeout`
- `Aborted: Signal`
- domain errors (`Failed to decode image: ...`, `Conversion error: ...`, เป็นต้น)

### Future tasks

เส้นทาง error:

1. async body คืนค่า `Err(napi::Error)` หรือ join failure ถูก map (`... task failed: {err}`)
2. promise ที่ spawn ด้วย `task::future` จะ reject
3. บาง API จงใจคืนค่าผลลัพธ์การยกเลิกแบบมีโครงสร้างแทนการ rejection (`ShellRunResult`/`ShellExecuteResult` พร้อม flags `cancelled`/`timed_out` และ `exit_code: None`)

### การแบ่งการรายงานการยกเลิก

- **Abort เป็น error**: export แบบ blocking ส่วนใหญ่ที่ใช้ `heartbeat()?`
- **Abort เป็น typed result**: API คำสั่งแบบ shell/pty ที่สร้างโมเดลการยกเลิกใน result structs

เลือกโมเดลเดียวต่อ API และระบุไว้ในเอกสารอย่างชัดเจน

## ข้อผิดพลาดที่พบบ่อย

1. **ขาด heartbeat ใน blocking loops**
   - อาการ: timeout/signal ดูเหมือนถูกละเว้นจนกว่า loop จะสิ้นสุด
   - วิธีแก้: เพิ่ม `ct.heartbeat()?` ที่ต้น loop และก่อนขั้นตอนที่ใช้ทรัพยากรสูงต่อ item

2. **ส่วนที่ยกเลิกไม่ได้เป็นเวลานาน**
   - อาการ: ความหน่วงแฝงของการยกเลิกพุ่งสูงระหว่างการเรียกขนาดใหญ่เพียงครั้งเดียว (decode, sort, compression เป็นต้น)
   - วิธีแก้: แบ่งงานออกเป็นส่วนๆ พร้อม heartbeat boundaries หากทำไม่ได้ให้ระบุความหน่วงแฝงในเอกสาร

3. **การ block async executor**
   - อาการ: async API หยุดชะงักเมื่อโค้ดที่ใช้ CPU สูงรันโดยตรงใน future
   - วิธีแก้: ย้าย CPU/sync blocks ไปที่ `task::blocking` หรือ `tokio::task::spawn_blocking`

4. **ความหมายของการยกเลิกที่ไม่สอดคล้องกัน**
   - อาการ: API หนึ่ง reject เมื่อถูกยกเลิก อีก API หนึ่ง resolve พร้อม flags ทำให้ผู้เรียกสับสน
   - วิธีแก้: กำหนดมาตรฐานต่อ domain และให้เอกสาร wrapper สอดคล้องกัน

5. **ลืมเชื่อมต่อการยกเลิกใน nested async tasks**
   - อาการ: outer token ถูกยกเลิกแต่ readers/subprocess tasks ภายในยังทำงานต่อ
   - วิธีแก้: เชื่อมต่อการยกเลิกกับ inner token/signal และบังคับ grace timeout + forced abort fallback

## Checklist สำหรับ exports ที่ยกเลิกได้ใหม่

1. จำแนกงานให้ถูกต้อง:
   - CPU-bound หรือ sync blocking -> `task::blocking`
   - async I/O / การจัดการ `await` -> `task::future`

2. เปิดเผย cancel inputs เมื่อจำเป็น:
   - ใส่ `timeoutMs` และ `signal` ใน `#[napi(object)]` options
   - สร้าง `let ct = task::CancelToken::new(timeout_ms, signal);`

3. เชื่อมต่อการยกเลิกผ่านทุก layer:
   - blocking loops: `ct.heartbeat()?` ที่ช่วงเวลาสม่ำเสมอ
   - async orchestration: แข่งกับ `ct.wait()` และยกเลิก sub-tasks/tokens

4. กำหนด contract ของการยกเลิก:
   - reject promise ด้วย abort error หรือ
   - resolve typed `{ cancelled, timedOut, ... }`
   - รักษา contract นี้ให้สอดคล้องกันสำหรับกลุ่ม API

5. ส่งต่อความผิดพลาดพร้อม context:
   - map errors ผ่าน `Error::from_reason(format!("...: {err}"))`
   - ใส่ prefixes ที่เฉพาะกับ stage (`spawn`, `decode`, `wait`, เป็นต้น)

6. จัดการการยกเลิกก่อนเริ่มและระหว่างการรัน:
   - การตรวจสอบ/รอการยกเลิกต้องเกิดขึ้นก่อน body ที่ใช้ทรัพยากรสูงและระหว่างการรันที่นาน

7. ตรวจสอบไม่มีการใช้ executor ผิดวิธี:
   - ไม่มีงาน sync ที่รันนานโดยตรงภายใน async futures โดยไม่มี `spawn_blocking`/blocking task wrapper
