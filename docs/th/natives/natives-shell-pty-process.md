---
title: 'Natives Shell, PTY, Process, and Key Internals'
description: >-
  การจัดการ Shell execution, PTY, วงจรชีวิตของ process และการจัดการ key event
  ในเลเยอร์ native
sidebar:
  order: 4
  label: 'Shell, PTY & process'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# Natives Shell, PTY, Process และ Key Internals

เอกสารนี้ครอบคลุม **execution/process/terminal primitives** ใน `@f5xc-salesdemos/pi-natives` ได้แก่ `shell`, `pty`, `ps` และ `keys` โดยใช้คำศัพท์สถาปัตยกรรมจาก `docs/natives-architecture.md`

## ไฟล์ implementation

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

## ความรับผิดชอบของแต่ละเลเยอร์

- **เลเยอร์ TS wrapper/API** (`packages/natives/src/*`): จุดเข้าใช้งานแบบมีประเภทข้อมูล, พื้นที่สำหรับการยกเลิก (`timeoutMs`, `AbortSignal`) และความสะดวกในการใช้งาน JS
- **เลเยอร์ Rust N-API module** (`crates/pi-natives/src/*`): การ execute shell/PTY process, การสำรวจ/ยุติ process-tree และการแยกวิเคราะห์ key-sequence
- **Validation gate** (`native.ts`, ระดับสถาปัตยกรรม): ตรวจสอบว่า export ที่จำเป็น (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, key helpers) มีอยู่ก่อนที่ wrapper จะถูกใช้งาน

## ระบบย่อย Shell (`shell`)

### โมเดล API

มีสองโหมดการ execute:

1. **One-shot** ผ่าน `executeShell(options, onChunk?)`
2. **Persistent session** ผ่าน `new Shell(options?)` จากนั้น `shell.run(...)` ซ้ำหลายครั้ง

ทั้งสองโหมดส่ง output ผ่าน threadsafe callback และคืนค่า `{ exitCode?, cancelled, timedOut }`

### การสร้าง session และโมเดลสภาพแวดล้อม

Rust สร้าง `brush_core::Shell` ด้วย:

- โหมด non-interactive,
- `do_not_inherit_env: true`,
- การสร้าง environment ใหม่อย่างชัดเจนจาก host env,
- skip-list สำหรับตัวแปรที่เกี่ยวข้องกับ shell (`PS1`, `PWD`, `SHLVL`, bash function exports ฯลฯ)

พฤติกรรม environment ของ session:

- `ShellOptions.sessionEnv` ถูกนำไปใช้ครั้งเดียวเมื่อสร้าง session
- `ShellRunOptions.env` มีขอบเขตเฉพาะคำสั่ง (`EnvironmentScope::Command`) และจะถูก pop ออกหลังจากแต่ละการ run
- `PATH` ถูก merge เป็นพิเศษบน Windows ด้วยการ dedupe แบบไม่สนตัวพิมพ์เล็ก/ใหญ่

การเพิ่ม path เฉพาะ Windows (`shell/windows.rs`): path ของ Git-for-Windows ที่ค้นพบ (`cmd`, `bin`, `usr/bin`) จะถูกเพิ่มเข้าไปหากมีอยู่และยังไม่ได้รวมอยู่

### วงจรชีวิตของ runtime และการเปลี่ยนสถานะ

Persistent shell (`Shell.run`) ใช้ state machine นี้:

- **Idle/Uninitialized**: `session: None`
- **Running**: `run()` ครั้งแรกจะสร้าง session แบบ lazy, เก็บ `current_abort` token, execute คำสั่ง
- **Completed + keepalive**: หาก execution control flow เป็น `Normal`, `current_abort` จะถูกล้างและ session จะถูกนำกลับมาใช้ซ้ำ
- **Completed + teardown**: หาก control flow เกี่ยวข้องกับ loop/script/shell-exit (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), session จะถูก drop (`session: None`)
- **Cancelled/Timed out**: run task จะถูกยกเลิก, รอ grace period (2 วินาที), จากนั้น force-abort; session จะถูก drop
- **Error**: session จะถูก drop

One-shot shell (`executeShell`) จะสร้างและ drop session ใหม่ทุกครั้งที่เรียก

### พฤติกรรมการ streaming/output

- Stdout/stderr ถูก route เข้า pipe ที่ใช้ร่วมกันและอ่านพร้อมกัน
- Reader ถอดรหัส UTF-8 แบบ incremental; ลำดับ byte ที่ไม่ถูกต้องจะปล่อย chunk ทดแทน `U+FFFD`
- หลังจาก process เสร็จสิ้น, การ drain output มี idle/max guards (`250ms` idle, `2s` max) เพื่อหลีกเลี่ยงการค้างเมื่อ background jobs ยังคงเปิด descriptor อยู่

### การยกเลิก, timeout และ background jobs

- `CancelToken` ถูกสร้างจาก `timeoutMs` และ `AbortSignal` ที่เป็น optional
- เมื่อยกเลิก/timeout, shell cancellation token จะถูก trigger, จากนั้น task จะได้รับหน้าต่าง graceful 2 วินาทีก่อน forced abort
- หากมีการยกเลิก, background jobs จะถูกยุติ (`TERM`, จากนั้น `KILL` แบบหน่วงเวลา) โดยใช้ brush job metadata

พฤติกรรมของ `Shell.abort()`:

- ยกเลิกเฉพาะคำสั่งที่กำลังรันอยู่ของ `Shell` instance นั้น,
- คืนค่าสำเร็จแบบ no-op เมื่อไม่มีอะไรกำลังรัน

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

ข้อผิดพลาดทั่วไปที่แสดงออกมา ได้แก่:

- ความล้มเหลวในการ init session (`Failed to initialize shell`),
- ข้อผิดพลาด cwd (`Failed to set cwd`),
- ความล้มเหลวในการ set/pop env,
- ความล้มเหลวของ snapshot source,
- ความล้มเหลวในการสร้าง/clone pipe,
- ความล้มเหลวในการ execute (`Shell execution failed: ...`),
- ความล้มเหลวของ task wrapper (`Shell execution task failed: ...`)

Cancellation flags ในระดับผลลัพธ์:

- timeout -> `exitCode: undefined`, `timedOut: true`
- abort signal -> `exitCode: undefined`, `cancelled: true`

## ระบบย่อย PTY (`pty`)

### โมเดล API

`new PtySession()` เปิดเผย:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### วงจรชีวิตของ runtime และการเปลี่ยนสถานะ

State machine ของ `PtySession`:

- **Idle**: `core: None`
- **Reserved**: `start()` ติดตั้ง control channel แบบ synchronous (`core: Some`) ก่อนที่งาน async จะเริ่ม เพื่อให้ `write/resize/kill` ใช้งานได้ทันที
- **Running**: blocking PTY loop จัดการ child state, reader events, cancellation heartbeat และ control messages
- **Terminal closed**: child exit + reader เสร็จสิ้น
- **Finalized**: `core` จะถูก reset เป็น `None` เสมอหลังจาก start task เสร็จสิ้น (ทั้งสำเร็จและผิดพลาด)

Concurrency guard:

- การ start ขณะที่กำลังรันอยู่จะคืนค่า `PTY session already running`

### รูปแบบ Spawn/attach/write/read/terminate

- PTY ถูกเปิดผ่าน `portable_pty::native_pty_system().openpty(...)`
- คำสั่งปัจจุบันรันเป็น `sh -lc <command>` พร้อม `cwd` และ env overrides ที่เป็น optional
- `write()` ส่ง raw bytes ไปยัง PTY stdin
- `resize()` จำกัดขนาด (`cols 20..400`, `rows 5..200`) และเรียก master resize
- `kill()` ทำเครื่องหมายว่า run ถูกยกเลิกและ kill child process

เส้นทาง output:

- reader thread เฉพาะจะอ่าน master stream,
- ถอดรหัส UTF-8 แบบ incremental ด้วยการแทนที่ `U+FFFD` สำหรับ byte ที่ไม่ถูกต้อง,
- chunk ถูกส่งต่อผ่าน N-API threadsafe callback

### ความหมายของการยกเลิกและ timeout

- `timeoutMs` และ `AbortSignal` ส่งต่อไปยัง `CancelToken`
- loop เรียก `ct.heartbeat()` เป็นระยะ; การ abort จะ trigger การ kill child
- การจำแนก timeout ใช้แบบ string-based (substring `"Timeout"` ใน heartbeat error)

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

พื้นที่แสดงข้อผิดพลาด ได้แก่:

- ความล้มเหลวในการจัดสรร/เปิด PTY,
- ความล้มเหลวในการ spawn PTY,
- ความล้มเหลวในการรับ writer/reader,
- ความล้มเหลวในการรอ/ตรวจสอบสถานะ child,
- lock poisoning,
- การตัดการเชื่อมต่อ control-channel (`PTY session is no longer available`)

ความล้มเหลวของ control call เมื่อไม่ได้รัน:

- `write/resize/kill` คืนค่า `PTY session is not running`

## ระบบย่อย Process-tree (`ps`)

### โมเดล API

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

TS wrapper ยังลงทะเบียนการผสานรวม native kill-tree เข้ากับ shared utils ผ่าน `setNativeKillTree(native.killTree)`

### Implementation เฉพาะแพลตฟอร์ม

- **Linux**: อ่าน `/proc/<pid>/task/<pid>/children` แบบ recursive
- **macOS**: ใช้ `libproc` `proc_listchildpids`
- **Windows**: snapshot ตาราง process ด้วย `CreateToolhelp32Snapshot`, สร้าง parent->children map, ยุติด้วย `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`

### พฤติกรรม Kill-tree

- Descendants ถูกรวบรวมแบบ recursive
- ลำดับการ kill เป็นแบบ bottom-up (descendants ที่ลึกที่สุดก่อน) เพื่อลดการ re-parent ของ orphan
- Root pid จะถูก kill เป็นลำดับสุดท้าย
- ค่าที่คืนคือจำนวนการยุติที่สำเร็จ

พฤติกรรมของ signal:

- POSIX: `signal` ที่ระบุจะถูกส่งไปยัง `kill`
- Windows: `signal` จะถูกละเว้น; การยุติเป็นการ terminate process แบบไม่มีเงื่อนไข

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

โมดูลนี้ตั้งใจไม่ throw ที่ API surface:

- สาขา process tree ที่หายไป/เข้าถึงไม่ได้จะถูกข้ามไป,
- ความล้มเหลวในการ kill ต่อ pid จะถูกนับว่าไม่สำเร็จ (ไม่ใช่ error),
- การ lookup ที่ไม่พบมักจะคืนค่า `[]` จาก `listDescendants` และ `0` จาก `killTree`

## ระบบย่อยการแยกวิเคราะห์ Key (`keys`)

### โมเดล API

Helper ที่เปิดเผย:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### โมเดลการแยกวิเคราะห์

Parser รวม:

- direct single-byte mappings (`enter`, `tab`, `ctrl+<letter>`, printable ASCII),
- O(1) legacy escape-sequence lookup (PHF map),
- xterm `modifyOtherKeys` parsing,
- Kitty protocol parsing (`CSI u`, `CSI ~`, `CSI 1;...<letter>`),
- การ normalize เป็น key IDs (`ctrl+c`, `shift+tab`, `pageUp`, `f5` ฯลฯ)

การจัดการ modifier:

- เฉพาะ shift/alt/ctrl bits เท่านั้นที่ถูกเปรียบเทียบสำหรับ key matching,
- lock bits จะถูก mask ออกก่อนการเปรียบเทียบ

พฤติกรรมของ layout:

- base-layout fallback ถูกจำกัดอย่างตั้งใจเพื่อไม่ให้ layout ที่ถูก remap สร้าง false matches สำหรับ ASCII letters/symbols

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

- ลำดับที่ไม่รู้จักหรือไม่ถูกต้องจะคืนค่า `null` จากฟังก์ชัน parse
- ฟังก์ชัน match จะคืนค่า `false` เมื่อ parse ล้มเหลวหรือไม่ตรงกัน
- ไม่มี thrown error surface สำหรับ key input ที่มีรูปแบบผิด

## การ mapping ระหว่าง JS wrapper API ↔ Rust export

### Shell + PTY + Process

| TS wrapper API | Rust N-API export | หมายเหตุ |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | One-shot shell execution |
| `new Shell(options?)` | `Shell` class | Persistent shell session |
| `shell.run(options, onChunk?)` | `Shell::run` | นำ session กลับมาใช้ซ้ำเมื่อ control flow เป็น keepalive |
| `shell.abort()` | `Shell::abort` | ยกเลิก run ที่กำลังทำงานของ shell instance นั้น |
| `new PtySession()` | `PtySession` class | Stateful PTY session |
| `pty.start(options, onChunk?)` | `PtySession::start` | Interactive PTY run |
| `pty.write(data)` | `PtySession::write` | Raw stdin passthrough |
| `pty.resize(cols, rows)` | `PtySession::resize` | ขนาด terminal ที่ถูกจำกัด |
| `pty.kill()` | `PtySession::kill` | Force-kill PTY child ที่กำลังทำงาน |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | การยุติ process tree แบบ children-first |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | การแสดงรายการ descendants แบบ recursive |

### Keys

| TS wrapper API | Rust N-API export | หมายเหตุ |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | การจับคู่ Kitty codepoint+modifier |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Normalized key-id parser |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | การตรวจสอบ legacy sequence map แบบ exact |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | ผลลัพธ์ Kitty parse แบบมีโครงสร้าง |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | High-level key matcher |

## การทำความสะอาด session ที่ถูกยกเลิกและหมายเหตุเกี่ยวกับ finalization

- **Shell persistent session**: หาก run ถูกยกเลิก/timeout/error/control flow ที่ไม่ใช่ keepalive, Rust จะ drop internal session state อย่างชัดเจน การ run ปกติที่สำเร็จจะเก็บ session ไว้สำหรับนำกลับมาใช้ซ้ำ
- **PTY session**: `core` จะถูกล้างเสมอหลังจาก `start()` เสร็จสิ้น รวมถึงเส้นทางที่ล้มเหลว
- **ไม่มีสัญญา kill ที่ขับเคลื่อนด้วย JS finalizer อย่างชัดเจน** ที่เปิดเผยโดย wrapper; การทำความสะอาดผูกติดกับเส้นทาง run completion/cancellation เป็นหลัก ผู้เรียกควรใช้ `timeoutMs`, `AbortSignal`, `shell.abort()` หรือ `pty.kill()` เพื่อ teardown แบบกำหนดได้
