---
title: 'Natives Shell, PTY, Process, and Key Internals'
description: >-
  การเรียกใช้งาน Shell, การจัดการ PTY, วงจรชีวิตของ Process และการจัดการ Key
  Event ในชั้น Native
sidebar:
  order: 4
  label: 'Shell, PTY & process'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# Natives Shell, PTY, Process และ Key Internals

เอกสารนี้ครอบคลุม **execution/process/terminal primitives** ใน `@f5xc-salesdemos/pi-natives` ได้แก่: `shell`, `pty`, `ps` และ `keys` โดยใช้คำศัพท์ทางสถาปัตยกรรมจาก `docs/natives-architecture.md`

## ไฟล์ Implementation

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs` (เฉพาะ Windows)
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/ps.rs`
- `crates/pi-natives/src/keys.rs`
- `crates/pi-natives/src/task.rs` (พฤติกรรมการยกเลิกที่ใช้ร่วมกันโดย shell/pty)
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/bindings.ts`

## ความรับผิดชอบของแต่ละชั้น

- **ชั้น TS wrapper/API** (`packages/natives/src/*`): จุดเข้าถึงที่มี type, ส่วนจัดการการยกเลิก (`timeoutMs`, `AbortSignal`) และความสะดวกในการใช้งานฝั่ง JS
- **ชั้น Rust N-API module** (`crates/pi-natives/src/*`): การเรียกใช้งาน shell/PTY process, การสำรวจ/ยุติ process-tree และการแยกวิเคราะห์ key-sequence
- **Validation gate** (`native.ts`, ระดับสถาปัตยกรรม): ตรวจสอบว่า export ที่จำเป็น (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, key helpers) มีอยู่ก่อนที่จะใช้งาน wrapper

## ระบบย่อย Shell (`shell`)

### โมเดล API

มีโหมดการเรียกใช้งานสองแบบ:

1. **One-shot** ผ่าน `executeShell(options, onChunk?)`
2. **Persistent session** ผ่าน `new Shell(options?)` จากนั้น `shell.run(...)` ซ้ำหลายครั้ง

ทั้งสองโหมดส่ง output ผ่าน threadsafe callback และคืนค่า `{ exitCode?, cancelled, timedOut }`

### การสร้าง Session และโมเดล Environment

Rust สร้าง `brush_core::Shell` ด้วย:

- โหมด non-interactive,
- `do_not_inherit_env: true`,
- การสร้าง environment ขึ้นใหม่อย่างชัดเจนจาก host env,
- skip-list สำหรับตัวแปรที่ส่งผลต่อ shell (`PS1`, `PWD`, `SHLVL`, bash function exports เป็นต้น)

พฤติกรรม environment ของ Session:

- `ShellOptions.sessionEnv` ถูกนำไปใช้ครั้งเดียวตอนสร้าง session
- `ShellRunOptions.env` มีขอบเขตระดับคำสั่ง (`EnvironmentScope::Command`) และถูก pop ออกหลังการ run แต่ละครั้ง
- `PATH` ถูก merge แบบพิเศษบน Windows ด้วยการ dedupe แบบ case-insensitive

การเพิ่มเติม path เฉพาะ Windows (`shell/windows.rs`): path ของ Git-for-Windows ที่ค้นพบ (`cmd`, `bin`, `usr/bin`) จะถูกต่อท้ายหากมีอยู่และยังไม่ได้รวมไว้

### วงจรชีวิตรันไทม์และการเปลี่ยนสถานะ

Persistent shell (`Shell.run`) ใช้ state machine นี้:

- **Idle/Uninitialized**: `session: None`
- **Running**: `run()` ครั้งแรกจะสร้าง session แบบ lazy, เก็บ `current_abort` token และเรียกใช้คำสั่ง
- **Completed + keepalive**: หาก execution control flow เป็น `Normal`, `current_abort` จะถูกล้างและ session จะถูกนำกลับมาใช้ใหม่
- **Completed + teardown**: หาก control flow เกี่ยวข้องกับ loop/script/shell-exit (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), session จะถูก drop (`session: None`)
- **Cancelled/Timed out**: run task ถูกยกเลิก, รอแบบ grace (2 วินาที) จากนั้น force-abort; session ถูก drop
- **Error**: session ถูก drop

One-shot shell (`executeShell`) จะสร้างและ drop session ใหม่ทุกครั้งที่เรียก

### พฤติกรรมการ Streaming/Output

- Stdout/stderr ถูกส่งไปยัง shared pipe และอ่านพร้อมกัน
- Reader ถอดรหัส UTF-8 แบบ incremental; ลำดับไบต์ที่ไม่ถูกต้องจะปล่อย chunk ทดแทน `U+FFFD`
- หลังจาก process เสร็จสิ้น, การ drain output มีตัวป้องกัน idle/max (`250ms` idle, `2s` max) เพื่อหลีกเลี่ยงการค้างเมื่อ background job เปิด descriptor ค้างไว้

### การยกเลิก, Timeout และ Background Jobs

- `CancelToken` ถูกสร้างจาก `timeoutMs` และ `AbortSignal` ที่เป็นตัวเลือก
- เมื่อยกเลิก/timeout, shell cancellation token จะถูก trigger จากนั้น task จะได้รับหน้าต่าง graceful 2 วินาทีก่อน forced abort
- หากเกิดการยกเลิก, background jobs จะถูกยุติ (`TERM` จากนั้นหน่วง `KILL`) โดยใช้ brush job metadata

พฤติกรรมของ `Shell.abort()`:

- ยกเลิกเฉพาะคำสั่งที่กำลังทำงานอยู่ของ `Shell` instance นั้น,
- no-op success เมื่อไม่มีอะไรกำลังทำงาน

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

ข้อผิดพลาดที่พบบ่อยได้แก่:

- ความล้มเหลวในการ init session (`Failed to initialize shell`),
- ข้อผิดพลาด cwd (`Failed to set cwd`),
- ความล้มเหลวในการ set/pop env,
- ความล้มเหลวของ snapshot source,
- ความล้มเหลวในการสร้าง/clone pipe,
- ความล้มเหลวในการ execute (`Shell execution failed: ...`),
- ความล้มเหลวของ task wrapper (`Shell execution task failed: ...`)

แฟล็กการยกเลิกในระดับผลลัพธ์:

- timeout -> `exitCode: undefined`, `timedOut: true`
- abort signal -> `exitCode: undefined`, `cancelled: true`

## ระบบย่อย PTY (`pty`)

### โมเดล API

`new PtySession()` เปิดเผย:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### วงจรชีวิตรันไทม์และการเปลี่ยนสถานะ

State machine ของ `PtySession`:

- **Idle**: `core: None`
- **Reserved**: `start()` ติดตั้ง control channel แบบ synchronous (`core: Some`) ก่อนที่งาน async จะเริ่ม ดังนั้น `write/resize/kill` จึงใช้งานได้ทันที
- **Running**: blocking PTY loop จัดการ child state, reader events, cancellation heartbeat และ control messages
- **Terminal closed**: child exit + reader completion
- **Finalized**: `core` จะถูกรีเซ็ตเป็น `None` เสมอหลังจาก start task เสร็จสิ้น (ไม่ว่าสำเร็จหรือเกิดข้อผิดพลาด)

ตัวป้องกัน Concurrency:

- การ start ขณะที่กำลังทำงานอยู่จะคืนค่า `PTY session already running`

### รูปแบบการ Spawn/Attach/Write/Read/Terminate

- PTY ถูกเปิดผ่าน `portable_pty::native_pty_system().openpty(...)`
- คำสั่งปัจจุบันทำงานเป็น `sh -lc <command>` พร้อมตัวเลือก `cwd` และ env overrides
- `write()` ส่ง raw bytes ไปยัง PTY stdin
- `resize()` จำกัดขนาด (`cols 20..400`, `rows 5..200`) และเรียก master resize
- `kill()` ทำเครื่องหมายว่า run ถูกยกเลิกและ kill child process

เส้นทาง Output:

- reader thread เฉพาะอ่าน master stream,
- ถอดรหัส UTF-8 แบบ incremental พร้อมทดแทน `U+FFFD` เมื่อพบไบต์ที่ไม่ถูกต้อง,
- chunk ถูกส่งต่อผ่าน N-API threadsafe callback

### ความหมายของการยกเลิกและ Timeout

- `timeoutMs` และ `AbortSignal` ป้อนเข้า `CancelToken`
- loop เรียก `ct.heartbeat()` เป็นระยะ; abort จะ trigger child kill
- การจำแนก timeout เป็นแบบ string-based (substring `"Timeout"` ใน heartbeat error)

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

ข้อผิดพลาดที่พบได้แก่:

- ความล้มเหลวในการจัดสรร/เปิด PTY,
- ความล้มเหลวในการ spawn PTY,
- ความล้มเหลวในการรับ writer/reader,
- ความล้มเหลวของ child status/wait,
- lock poisoning,
- การตัดการเชื่อมต่อ control-channel (`PTY session is no longer available`)

ความล้มเหลวของการเรียก control เมื่อไม่ได้ทำงาน:

- `write/resize/kill` คืนค่า `PTY session is not running`

## ระบบย่อย Process-tree (`ps`)

### โมเดล API

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

TS wrapper ยังลงทะเบียน native kill-tree integration เข้ากับ shared utils ผ่าน `setNativeKillTree(native.killTree)`

### Implementation เฉพาะแพลตฟอร์ม

- **Linux**: อ่าน `/proc/<pid>/task/<pid>/children` แบบ recursive
- **macOS**: ใช้ `libproc` `proc_listchildpids`
- **Windows**: snapshot ตาราง process ด้วย `CreateToolhelp32Snapshot`, สร้าง map parent->children, ยุติด้วย `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`

### พฤติกรรม Kill-tree

- Descendants ถูกรวบรวมแบบ recursive
- ลำดับการ kill เป็นแบบ bottom-up (descendants ที่ลึกที่สุดก่อน) เพื่อลดการ re-parent ของ orphan
- Root pid ถูก kill เป็นลำดับสุดท้าย
- ค่าที่คืนกลับคือจำนวนการยุติที่สำเร็จ

พฤติกรรมของ Signal:

- POSIX: `signal` ที่ระบุจะถูกส่งไปยัง `kill`
- Windows: `signal` ถูกละเว้น; การยุติเป็นแบบ unconditional process terminate

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

โมดูลนี้ถูกออกแบบให้ไม่ throw ที่ระดับ API surface โดยเจตนา:

- สาขา process tree ที่หายไป/เข้าถึงไม่ได้จะถูกข้าม,
- ความล้มเหลวในการ kill แต่ละ pid จะถูกนับเป็น unsuccessful (ไม่ใช่ error),
- การค้นหาที่ไม่พบโดยทั่วไปจะให้ `[]` จาก `listDescendants` และ `0` จาก `killTree`

## ระบบย่อยการแยกวิเคราะห์ Key (`keys`)

### โมเดล API

Helper ที่เปิดเผย:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### โมเดลการแยกวิเคราะห์

Parser ผสมผสาน:

- การ mapping ไบต์เดี่ยวโดยตรง (`enter`, `tab`, `ctrl+<letter>`, printable ASCII),
- การค้นหา legacy escape-sequence แบบ O(1) (PHF map),
- การแยกวิเคราะห์ xterm `modifyOtherKeys`,
- การแยกวิเคราะห์ Kitty protocol (`CSI u`, `CSI ~`, `CSI 1;...<letter>`),
- การ normalize เป็น key IDs (`ctrl+c`, `shift+tab`, `pageUp`, `f5` เป็นต้น)

การจัดการ Modifier:

- เฉพาะ shift/alt/ctrl bits เท่านั้นที่ถูกเปรียบเทียบสำหรับ key matching,
- lock bits ถูก mask ออกก่อนการเปรียบเทียบ

พฤติกรรม Layout:

- การ fallback ของ base-layout ถูกจำกัดโดยเจตนาเพื่อไม่ให้ layout ที่ถูก remap สร้าง false matches สำหรับตัวอักษร/สัญลักษณ์ ASCII

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

- ลำดับที่ไม่รู้จักหรือไม่ถูกต้องจะให้ `null` จากฟังก์ชัน parse
- ฟังก์ชัน match คืนค่า `false` เมื่อ parse ล้มเหลวหรือไม่ตรงกัน
- ไม่มีการ throw error สำหรับ key input ที่ผิดรูปแบบ

## การ mapping ระหว่าง JS wrapper API ↔ Rust export

### Shell + PTY + Process

| TS wrapper API | Rust N-API export | หมายเหตุ |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | การเรียกใช้งาน shell แบบ one-shot |
| `new Shell(options?)` | `Shell` class | Persistent shell session |
| `shell.run(options, onChunk?)` | `Shell::run` | ใช้ session ซ้ำเมื่อ keepalive control flow |
| `shell.abort()` | `Shell::abort` | ยกเลิก run ที่กำลังทำงานของ shell instance นั้น |
| `new PtySession()` | `PtySession` class | Stateful PTY session |
| `pty.start(options, onChunk?)` | `PtySession::start` | Interactive PTY run |
| `pty.write(data)` | `PtySession::write` | ส่งผ่าน raw stdin |
| `pty.resize(cols, rows)` | `PtySession::resize` | ขนาด terminal ที่ถูกจำกัด |
| `pty.kill()` | `PtySession::kill` | Force-kill PTY child ที่กำลังทำงาน |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | การยุติ process tree แบบ children-first |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | การแสดงรายการ descendants แบบ recursive |

### Keys

| TS wrapper API | Rust N-API export | หมายเหตุ |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | การจับคู่ Kitty codepoint+modifier |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Parser ที่ normalize เป็น key-id |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | การตรวจสอบ legacy sequence map แบบตรงทั้งหมด |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | ผลลัพธ์การ parse Kitty แบบมีโครงสร้าง |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | ตัวจับคู่ key ระดับสูง |

## หมายเหตุเกี่ยวกับการทำความสะอาด Session ที่ถูกทิ้งและ Finalization

- **Shell persistent session**: หาก run ถูกยกเลิก/timeout/เกิดข้อผิดพลาด/non-keepalive control flow, Rust จะ drop internal session state อย่างชัดเจน การ run แบบ normal ที่สำเร็จจะเก็บ session ไว้เพื่อใช้ซ้ำ
- **PTY session**: `core` จะถูกล้างเสมอหลังจาก `start()` เสร็จสิ้น รวมถึงเส้นทางที่เกิดข้อผิดพลาด
- **ไม่มี explicit JS finalizer-driven kill contract** ที่เปิดเผยโดย wrapper; การทำความสะอาดถูกผูกไว้กับเส้นทาง run completion/cancellation เป็นหลัก ผู้เรียกควรใช้ `timeoutMs`, `AbortSignal`, `shell.abort()` หรือ `pty.kill()` สำหรับการ teardown แบบ deterministic
