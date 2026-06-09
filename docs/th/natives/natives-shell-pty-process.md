---
title: 'ระบบภายในของ Shell, PTY, Process และ Key ในชั้น Native'
description: >-
  การรันคำสั่ง Shell, การจัดการ PTY, วงจรชีวิตของ process และการจัดการเหตุการณ์
  key ในชั้น native
sidebar:
  order: 4
  label: 'Shell, PTY และ process'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# ระบบภายในของ Shell, PTY, Process และ Key ในชั้น Native

เอกสารนี้ครอบคลุม **primitive สำหรับการรัน/process/terminal** ใน `@f5xc-salesdemos/pi-natives`: `shell`, `pty`, `ps` และ `keys` โดยใช้คำศัพท์ด้านสถาปัตยกรรมจาก `docs/natives-architecture.md`

## ไฟล์ที่เกี่ยวข้องกับการ implement

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs` (Windows เท่านั้น)
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

- **ชั้น TS wrapper/API** (`packages/natives/src/*`): จุดเข้าใช้งานแบบมี type, พื้นผิวการยกเลิก (`timeoutMs`, `AbortSignal`) และความสะดวกในการใช้งานจาก JS
- **ชั้น Rust N-API module** (`crates/pi-natives/src/*`): การรันคำสั่ง shell/PTY, การสำรวจ/ยุติ process tree และการแยกวิเคราะห์ key sequence
- **เกตการตรวจสอบ** (`native.ts`, ระดับสถาปัตยกรรม): ตรวจสอบว่า export ที่จำเป็น (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, ตัวช่วย key) มีอยู่ก่อนที่จะใช้ wrapper

## ระบบย่อย Shell (`shell`)

### โมเดล API

มีโหมดการรันสองแบบ:

1. **แบบครั้งเดียว** ผ่าน `executeShell(options, onChunk?)`
2. **แบบ session ถาวร** ผ่าน `new Shell(options?)` จากนั้น `shell.run(...)` ซ้ำหลายครั้ง

ทั้งสองแบบส่ง output ผ่าน threadsafe callback และคืนค่า `{ exitCode?, cancelled, timedOut }`

### การสร้าง session และโมเดลสิ่งแวดล้อม

Rust สร้าง `brush_core::Shell` โดย:

- โหมด non-interactive,
- `do_not_inherit_env: true`,
- สร้างสิ่งแวดล้อมใหม่จาก host env อย่างชัดเจน,
- มี skip-list สำหรับตัวแปรที่ไวต่อ shell (`PS1`, `PWD`, `SHLVL`, bash function exports เป็นต้น)

พฤติกรรมสิ่งแวดล้อมของ session:

- `ShellOptions.sessionEnv` ถูกใช้ครั้งเดียวตอนสร้าง session
- `ShellRunOptions.env` มีขอบเขตเฉพาะคำสั่ง (`EnvironmentScope::Command`) และถูก pop ออกหลังจากแต่ละครั้งที่รัน
- `PATH` ถูก merge พิเศษบน Windows ด้วยการตัดซ้ำแบบไม่คำนึงถึงตัวพิมพ์เล็กใหญ่

การเพิ่ม path เฉพาะ Windows (`shell/windows.rs`): path ของ Git-for-Windows ที่ค้นพบ (`cmd`, `bin`, `usr/bin`) จะถูกเพิ่มเข้าไปหากมีอยู่และยังไม่รวมอยู่แล้ว

### วงจรชีวิตการทำงานและการเปลี่ยนสถานะ

Shell แบบถาวร (`Shell.run`) ใช้ state machine นี้:

- **Idle/ยังไม่เริ่มต้น**: `session: None`
- **กำลังทำงาน**: `run()` ครั้งแรกสร้าง session แบบ lazy เก็บ `current_abort` token และรันคำสั่ง
- **เสร็จสิ้น + keepalive**: หาก control flow ของการรันเป็น `Normal` จะล้าง `current_abort` และนำ session กลับมาใช้ใหม่
- **เสร็จสิ้น + teardown**: หาก control flow เกี่ยวข้องกับ loop/script/shell-exit (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`) จะ drop session (`session: None`)
- **ถูกยกเลิก/หมดเวลา**: task การรันถูกยกเลิก รอแบบ grace (2s) จากนั้นบังคับยกเลิก; session ถูก drop
- **ผิดพลาด**: session ถูก drop

Shell แบบครั้งเดียว (`executeShell`) จะสร้างและ drop session ใหม่ทุกครั้งที่เรียก

### พฤติกรรมการ streaming/output

- Stdout/stderr ถูกส่งเข้า pipe ร่วมกันและอ่านแบบ concurrent
- Reader ถอดรหัส UTF-8 แบบเพิ่มทีละส่วน; ลำดับไบต์ที่ไม่ถูกต้องจะปล่อย chunk ทดแทน `U+FFFD`
- หลังจาก process เสร็จสิ้น การ drain output จะมีตัวป้องกัน idle/max (`250ms` idle, `2s` max) เพื่อหลีกเลี่ยงการค้างจาก background job ที่ยังเปิด descriptor อยู่

### การยกเลิก, timeout และ background job

- `CancelToken` ถูกสร้างจาก `timeoutMs` และ `AbortSignal` ที่เป็นทางเลือก
- เมื่อยกเลิก/หมดเวลา cancellation token ของ shell จะถูก trigger จากนั้น task จะได้ช่วงเวลา graceful 2s ก่อนถูกบังคับยกเลิก
- หากเกิดการยกเลิก background job จะถูกยุติ (`TERM` จากนั้น `KILL` แบบหน่วง) โดยใช้ metadata ของ brush job

พฤติกรรมของ `Shell.abort()`:

- ยกเลิกเฉพาะคำสั่งที่กำลังรันอยู่ของ `Shell` instance นั้น,
- คืนค่าสำเร็จแบบ no-op เมื่อไม่มีอะไรกำลังทำงาน

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

ข้อผิดพลาดที่มักปรากฏ ได้แก่:

- ล้มเลวในการเริ่มต้น session (`Failed to initialize shell`),
- ข้อผิดพลาด cwd (`Failed to set cwd`),
- ล้มเหลวในการ set/pop env,
- ล้มเหลวในการ snapshot source,
- ล้มเหลวในการสร้าง/clone pipe,
- ล้มเหลวในการรัน (`Shell execution failed: ...`),
- ล้มเหลวใน task wrapper (`Shell execution task failed: ...`)

flag การยกเลิกระดับผลลัพธ์:

- timeout -> `exitCode: undefined`, `timedOut: true`
- abort signal -> `exitCode: undefined`, `cancelled: true`

## ระบบย่อย PTY (`pty`)

### โมเดล API

`new PtySession()` เปิดเผย:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### วงจรชีวิตการทำงานและการเปลี่ยนสถานะ

State machine ของ `PtySession`:

- **Idle**: `core: None`
- **Reserved**: `start()` ติดตั้ง control channel แบบ synchronous (`core: Some`) ก่อนเริ่มงาน async เพื่อให้ `write/resize/kill` ใช้งานได้ทันที
- **กำลังทำงาน**: blocking PTY loop จัดการสถานะ child, เหตุการณ์ reader, heartbeat การยกเลิก และข้อความควบคุม
- **Terminal ปิดแล้ว**: child exit + reader เสร็จสิ้น
- **สิ้นสุด**: `core` จะถูกรีเซ็ตเป็น `None` เสมอหลังจาก start task เสร็จสิ้น (ทั้งสำเร็จหรือผิดพลาด)

ตัวป้องกัน concurrency:

- การ start ขณะกำลังทำงานอยู่แล้วจะคืนค่า `PTY session already running`

### รูปแบบการ spawn/attach/write/read/terminate

- PTY เปิดผ่าน `portable_pty::native_pty_system().openpty(...)`
- คำสั่งปัจจุบันรันเป็น `sh -lc <command>` พร้อมตัวเลือก `cwd` และ env override
- `write()` ส่ง raw bytes ไปยัง PTY stdin
- `resize()` จำกัดมิติ (`cols 20..400`, `rows 5..200`) และเรียก master resize
- `kill()` ทำเครื่องหมายว่าการรันถูกยกเลิกและ kill child process

เส้นทาง output:

- reader thread เฉพาะอ่าน master stream,
- ถอดรหัส UTF-8 แบบเพิ่มทีละส่วนพร้อมทดแทน `U+FFFD` สำหรับไบต์ที่ไม่ถูกต้อง,
- chunk ถูกส่งต่อผ่าน N-API threadsafe callback

### ความหมายของการยกเลิกและ timeout

- `timeoutMs` และ `AbortSignal` ป้อนเข้า `CancelToken`
- loop เรียก `ct.heartbeat()` เป็นระยะ; การ abort จะ trigger การ kill child
- การจำแนก timeout ใช้แบบ string-based (substring `"Timeout"` ใน heartbeat error)

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

พื้นผิวข้อผิดพลาด ได้แก่:

- ล้มเหลวในการจัดสรร/เปิด PTY,
- ล้มเหลวในการ spawn PTY,
- ล้มเหลวในการได้ writer/reader,
- ล้มเหลวในการตรวจสอบสถานะ/รอ child,
- lock poisoning,
- control-channel ขาดการเชื่อมต่อ (`PTY session is no longer available`)

ความล้มเหลวของการเรียกควบคุมเมื่อไม่ได้ทำงาน:

- `write/resize/kill` คืนค่า `PTY session is not running`

## ระบบย่อย Process-tree (`ps`)

### โมเดล API

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

TS wrapper ยังลงทะเบียนการรวม native kill-tree เข้ากับ shared utils ผ่าน `setNativeKillTree(native.killTree)`

### การ implement เฉพาะแพลตฟอร์ม

- **Linux**: อ่าน `/proc/<pid>/task/<pid>/children` แบบ recursive
- **macOS**: ใช้ `libproc` `proc_listchildpids`
- **Windows**: snapshot ตาราง process ด้วย `CreateToolhelp32Snapshot` สร้าง map parent->children และยุติด้วย `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`

### พฤติกรรม Kill-tree

- Descendant ถูกรวบรวมแบบ recursive
- ลำดับการ kill เป็นแบบล่างขึ้นบน (descendant ที่ลึกที่สุดก่อน) เพื่อลดการ re-parent ของ orphan
- Root pid ถูก kill เป็นลำดับสุดท้าย
- ค่าที่คืนคือจำนวนการยุติที่สำเร็จ

พฤติกรรม signal:

- POSIX: `signal` ที่ระบุจะถูกส่งไปยัง `kill`
- Windows: `signal` ถูกละเว้น; การยุติเป็นการ terminate process แบบไม่มีเงื่อนไข

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

โมดูลนี้ออกแบบมาให้ไม่ throw ที่พื้นผิว API อย่างตั้งใจ:

- กิ่ง process tree ที่หายไป/เข้าถึงไม่ได้จะถูกข้ามไป,
- ความล้มเหลวในการ kill แต่ละ pid จะนับเป็นไม่สำเร็จ (ไม่ใช่ error),
- การค้นหาที่ไม่พบมักจะให้ `[]` จาก `listDescendants` และ `0` จาก `killTree`

## ระบบย่อยการแยกวิเคราะห์ Key (`keys`)

### โมเดล API

ตัวช่วยที่เปิดเผย:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### โมเดลการแยกวิเคราะห์

Parser รวม:

- การ map ไบต์เดี่ยวโดยตรง (`enter`, `tab`, `ctrl+<letter>`, printable ASCII),
- การค้นหา legacy escape-sequence แบบ O(1) (PHF map),
- การแยกวิเคราะห์ xterm `modifyOtherKeys`,
- การแยกวิเคราะห์ Kitty protocol (`CSI u`, `CSI ~`, `CSI 1;...<letter>`),
- การ normalize เป็น key ID (`ctrl+c`, `shift+tab`, `pageUp`, `f5` เป็นต้น)

การจัดการ modifier:

- เฉพาะบิต shift/alt/ctrl เท่านั้นที่ถูกเปรียบเทียบสำหรับการจับคู่ key,
- บิต lock จะถูก mask ออกก่อนการเปรียบเทียบ

พฤติกรรม layout:

- base-layout fallback ถูกจำกัดอย่างตั้งใจเพื่อไม่ให้ layout ที่ถูก remap สร้างการจับคู่ที่ผิดพลาดสำหรับตัวอักษร/สัญลักษณ์ ASCII

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

- Sequence ที่ไม่รู้จักหรือไม่ถูกต้องจะให้ค่า `null` จากฟังก์ชัน parse
- ฟังก์ชัน match คืนค่า `false` เมื่อ parse ล้มเหลวหรือไม่ตรงกัน
- ไม่มีพื้นผิว thrown error สำหรับ key input ที่ผิดรูปแบบ

## การ map ระหว่าง JS wrapper API ↔ Rust export

### Shell + PTY + Process

| TS wrapper API | Rust N-API export | หมายเหตุ |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | การรัน shell แบบครั้งเดียว |
| `new Shell(options?)` | `Shell` class | Shell session แบบถาวร |
| `shell.run(options, onChunk?)` | `Shell::run` | นำ session กลับมาใช้ใหม่เมื่อ control flow เป็น keepalive |
| `shell.abort()` | `Shell::abort` | ยกเลิกการรันที่กำลังทำงานสำหรับ shell instance นั้น |
| `new PtySession()` | `PtySession` class | PTY session แบบมีสถานะ |
| `pty.start(options, onChunk?)` | `PtySession::start` | การรัน PTY แบบ interactive |
| `pty.write(data)` | `PtySession::write` | ส่ง raw stdin ตรงผ่าน |
| `pty.resize(cols, rows)` | `PtySession::resize` | มิติ terminal ที่ถูกจำกัดค่า |
| `pty.kill()` | `PtySession::kill` | บังคับ kill PTY child ที่กำลังทำงาน |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | การยุติ process tree แบบ children-first |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | การแสดงรายการ descendants แบบ recursive |

### Keys

| TS wrapper API | Rust N-API export | หมายเหตุ |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | จับคู่ Kitty codepoint+modifier |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | parser key-id แบบ normalized |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | ตรวจสอบ legacy sequence map แบบตรงทั้งหมด |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | ผลลัพธ์การ parse Kitty แบบมีโครงสร้าง |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | ตัวจับคู่ key ระดับสูง |

## หมายเหตุเกี่ยวกับการทำความสะอาด session ที่ถูกทิ้งและการ finalize

- **Shell session แบบถาวร**: หากการรันถูกยกเลิก/หมดเวลา/เกิดข้อผิดพลาด/control flow ไม่ใช่ keepalive Rust จะ drop สถานะ session ภายในอย่างชัดเจน การรันปกติที่สำเร็จจะเก็บ session ไว้เพื่อใช้ซ้ำ
- **PTY session**: `core` จะถูกล้างเสมอหลังจาก `start()` เสร็จสิ้น รวมถึงเส้นทางที่ล้มเหลว
- **ไม่มี contract การ kill ที่ขับเคลื่อนด้วย JS finalizer อย่างชัดเจน** ที่เปิดเผยโดย wrapper; การทำความสะอาดถูกผูกกับเส้นทางการรันเสร็จสิ้น/การยกเลิกเป็นหลัก ผู้เรียกควรใช้ `timeoutMs`, `AbortSignal`, `shell.abort()` หรือ `pty.kill()` สำหรับการ teardown ที่กำหนดได้แน่นอน
