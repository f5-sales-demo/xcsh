---
title: 'โครงสร้างภายในของ Shell, PTY, กระบวนการ และคีย์ในระดับ Native'
description: >-
  การรันคำสั่ง Shell, การจัดการ PTY, วงจรชีวิตของกระบวนการ
  และการจัดการเหตุการณ์คีย์ในระดับ Native
sidebar:
  order: 4
  label: 'Shell, PTY และกระบวนการ'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# โครงสร้างภายในของ Shell, PTY, กระบวนการ และคีย์ในระดับ Native

เอกสารนี้ครอบคลุม **primitives สำหรับการรัน/กระบวนการ/เทอร์มินัล** ใน `@f5-sales-demo/pi-natives` ได้แก่ `shell`, `pty`, `ps` และ `keys` โดยใช้คำศัพท์สถาปัตยกรรมจาก `docs/natives-architecture.md`

## ไฟล์ที่เกี่ยวข้องกับการ Implement

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

## การเป็นเจ้าของในแต่ละชั้น

- **ชั้น TS wrapper/API** (`packages/natives/src/*`): จุดเข้าถึงแบบ typed, พื้นผิวการยกเลิก (`timeoutMs`, `AbortSignal`) และ ergonomics ของ JS
- **ชั้น Rust N-API module** (`crates/pi-natives/src/*`): การรันกระบวนการ shell/PTY, การสำรวจ/ยุติ process-tree และการแยกวิเคราะห์ key-sequence
- **Validation gate** (`native.ts`, ระดับสถาปัตยกรรม): ตรวจสอบว่า export ที่จำเป็น (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, ตัวช่วย key) มีอยู่ก่อนที่จะใช้งาน wrapper

## ระบบย่อย Shell (`shell`)

### โมเดล API

มีสองโหมดการรัน:

1. **แบบครั้งเดียว** ผ่าน `executeShell(options, onChunk?)`
2. **เซสชันถาวร** ผ่าน `new Shell(options?)` แล้วตามด้วย `shell.run(...)` ซ้ำๆ

ทั้งสองโหมดส่งออกผลลัพธ์ผ่าน threadsafe callback และคืนค่า `{ exitCode?, cancelled, timedOut }`

### การสร้างเซสชันและโมเดลสภาพแวดล้อม

Rust สร้าง `brush_core::Shell` ด้วย:

- โหมดไม่โต้ตอบ,
- `do_not_inherit_env: true`,
- การสร้างสภาพแวดล้อมใหม่อย่างชัดเจนจาก env ของ host,
- รายการ skip สำหรับตัวแปรที่ sensitive ต่อ shell (`PS1`, `PWD`, `SHLVL`, การ export ฟังก์ชัน bash เป็นต้น)

พฤติกรรมของ env ในเซสชัน:

- `ShellOptions.sessionEnv` ถูกใช้งานเพียงครั้งเดียวเมื่อสร้างเซสชัน
- `ShellRunOptions.env` มีขอบเขตต่อคำสั่ง (`EnvironmentScope::Command`) และถูกนำออกหลังจากการรันแต่ละครั้ง
- `PATH` ถูก merge เป็นพิเศษบน Windows โดยมีการ dedupe แบบ case-insensitive

การเพิ่มประสิทธิภาพ path เฉพาะ Windows (`shell/windows.rs`): path ของ Git-for-Windows ที่ค้นพบ (`cmd`, `bin`, `usr/bin`) จะถูกต่อท้ายหากมีอยู่และยังไม่ได้รวมอยู่

### วงจรชีวิตขณะรันและการเปลี่ยนสถานะ

Shell แบบถาวร (`Shell.run`) ใช้ state machine นี้:

- **Idle/Uninitialized**: `session: None`
- **Running**: การเรียก `run()` ครั้งแรกสร้างเซสชันแบบ lazy, เก็บ token `current_abort`, และรันคำสั่ง
- **Completed + keepalive**: หากการควบคุม execution flow เป็น `Normal`, `current_abort` จะถูกล้างและเซสชันจะถูกนำกลับมาใช้
- **Completed + teardown**: หาก control flow เกี่ยวข้องกับ loop/script/shell-exit (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`) เซสชันจะถูก drop (`session: None`)
- **Cancelled/Timed out**: task การรันถูกยกเลิก, รอแบบ grace (2 วินาที), แล้วบังคับ abort; เซสชันจะถูก drop
- **Error**: เซสชันจะถูก drop

Shell แบบครั้งเดียว (`executeShell`) จะสร้างและ drop เซสชันใหม่ทุกครั้งที่เรียก

### พฤติกรรม Streaming/Output

- Stdout/stderr ถูกส่งเข้าไปยัง pipe ที่ใช้ร่วมกันและอ่านพร้อมกัน
- Reader ถอดรหัส UTF-8 แบบเพิ่มทีละน้อย; ลำดับ byte ที่ไม่ถูกต้องจะปล่อย chunk การแทนที่ `U+FFFD`
- หลังจากกระบวนการเสร็จสิ้น การระบาย output จะมีการป้องกัน idle/max (`250ms` idle, `2s` สูงสุด) เพื่อหลีกเลี่ยงการค้างกับ background jobs ที่เปิด descriptor ไว้

### การยกเลิก, timeout และ background jobs

- `CancelToken` สร้างจาก `timeoutMs` และ `AbortSignal` ที่เป็น optional
- เมื่อยกเลิก/timeout token การยกเลิก shell จะถูก trigger แล้ว task จะได้รับเวลา grace 2 วินาทีก่อนการบังคับ abort
- หากเกิดการยกเลิก background jobs จะถูกยุติ (`TERM` แล้วตามด้วย `KILL` ที่มีความล่าช้า) โดยใช้ข้อมูล job ของ brush

พฤติกรรม `Shell.abort()`:

- abort เฉพาะคำสั่งที่กำลังรันอยู่สำหรับ instance `Shell` นั้น,
- เป็น no-op success เมื่อไม่มีอะไรกำลังรันอยู่

### พฤติกรรมเมื่อเกิดความล้มเหลว

ข้อผิดพลาดที่พบบ่อย ได้แก่:

- ความล้มเหลวในการ init เซสชัน (`Failed to initialize shell`),
- ข้อผิดพลาด cwd (`Failed to set cwd`),
- ความล้มเหลวในการ set/pop env,
- ความล้มเหลวในการรับ snapshot source,
- ความล้มเหลวในการสร้าง/clone pipe,
- ความล้มเหลวในการรัน (`Shell execution failed: ...`),
- ความล้มเหลวของ task wrapper (`Shell execution task failed: ...`)

Flag การยกเลิกในระดับ Result:

- timeout -> `exitCode: undefined`, `timedOut: true`
- abort signal -> `exitCode: undefined`, `cancelled: true`

## ระบบย่อย PTY (`pty`)

### โมเดล API

`new PtySession()` เปิดเผย:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### วงจรชีวิตขณะรันและการเปลี่ยนสถานะ

State machine ของ `PtySession`:

- **Idle**: `core: None`
- **Reserved**: `start()` ติดตั้ง control channel แบบ synchronous (`core: Some`) ก่อนที่งาน async จะเริ่มต้น ดังนั้น `write/resize/kill` จึงพร้อมใช้งานทันที
- **Running**: loop การบล็อก PTY จัดการสถานะ child, เหตุการณ์ reader, heartbeat การยกเลิก และข้อความ control
- **Terminal closed**: การออกของ child + การเสร็จสิ้นของ reader
- **Finalized**: `core` จะถูก reset เป็น `None` เสมอหลังจาก task start เสร็จสิ้น (ทั้งสำเร็จและเกิดข้อผิดพลาด)

การป้องกัน Concurrency:

- การเริ่มต้นในขณะที่กำลังรันอยู่จะคืนค่า `PTY session already running`

### รูปแบบ Spawn/Attach/Write/Read/Terminate

- PTY เปิดผ่าน `portable_pty::native_pty_system().openpty(...)`
- คำสั่งปัจจุบันรันเป็น `sh -lc <command>` พร้อม `cwd` และการ override env ที่เป็น optional
- `write()` ส่ง raw bytes ไปยัง stdin ของ PTY
- `resize()` จำกัดขนาด (`cols 20..400`, `rows 5..200`) และเรียก master resize
- `kill()` ทำเครื่องหมายการรันว่าถูกยกเลิกและ kill child process

เส้นทาง Output:

- thread reader เฉพาะอ่าน master stream,
- ถอดรหัส UTF-8 แบบเพิ่มทีละน้อยพร้อมการแทนที่ `U+FFFD` สำหรับ byte ที่ไม่ถูกต้อง,
- chunk ส่งต่อผ่าน N-API threadsafe callback

### ความหมายของการยกเลิกและ timeout

- `timeoutMs` และ `AbortSignal` ป้อนเข้า `CancelToken`
- loop เรียก `ct.heartbeat()` เป็นระยะ; การ abort จะ trigger การ kill child
- การจำแนก timeout อาศัย string (`"Timeout"` substring ในข้อผิดพลาด heartbeat)

### พฤติกรรมเมื่อเกิดความล้มเหลว

พื้นผิวของ Error ได้แก่:

- ความล้มเหลวในการ allocate/open PTY,
- ความล้มเหลวในการ spawn PTY,
- ความล้มเหลวในการรับ writer/reader,
- ความล้มเหลวในสถานะ/การรอของ child,
- lock poisoning,
- การตัดการเชื่อมต่อของ control-channel (`PTY session is no longer available`)

ความล้มเหลวของการเรียก control เมื่อไม่ได้รันอยู่:

- `write/resize/kill` คืนค่า `PTY session is not running`

## ระบบย่อย Process-tree (`ps`)

### โมเดล API

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

TS wrapper ยังลงทะเบียน native kill-tree integration เข้าใน shared utils ผ่าน `setNativeKillTree(native.killTree)`

### การ Implement เฉพาะแพลตฟอร์ม

- **Linux**: อ่าน `/proc/<pid>/task/<pid>/children` แบบ recursive
- **macOS**: ใช้ `libproc` `proc_listchildpids`
- **Windows**: สร้าง snapshot ตาราง process ด้วย `CreateToolhelp32Snapshot`, สร้าง map parent->children, ยุติด้วย `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`

### พฤติกรรม Kill-tree

- Descendants ถูกเก็บรวบรวมแบบ recursive
- ลำดับการ Kill เป็นแบบ bottom-up (descendants ที่ลึกที่สุดก่อน) เพื่อลด orphan re-parenting
- Root pid ถูก kill เป็นลำดับสุดท้าย
- ค่าที่คืนมาคือจำนวนการยุติที่สำเร็จ

พฤติกรรม Signal:

- POSIX: `signal` ที่ให้มาจะถูกส่งไปยัง `kill`
- Windows: `signal` จะถูกเพิกเฉย; การยุติเป็นแบบ unconditional process terminate

### พฤติกรรมเมื่อเกิดความล้มเหลว

โมดูลนี้ออกแบบมาโดยเจตนาให้ไม่ throw ที่พื้นผิว API:

- สาขา process tree ที่หายไป/เข้าถึงไม่ได้จะถูกข้าม,
- ความล้มเหลวในการ kill ต่อ pid จะนับเป็นไม่สำเร็จ (ไม่ใช่ข้อผิดพลาด),
- การค้นหาที่พลาดมักให้ผล `[]` จาก `listDescendants` และ `0` จาก `killTree`

## ระบบย่อยการแยกวิเคราะห์คีย์ (`keys`)

### โมเดล API

ตัวช่วยที่เปิดเผย:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### โมเดลการแยกวิเคราะห์

Parser รวม:

- การ mapping แบบ single-byte โดยตรง (`enter`, `tab`, `ctrl+<letter>`, ASCII ที่พิมพ์ได้),
- การค้นหา escape-sequence แบบ legacy แบบ O(1) (PHF map),
- การแยกวิเคราะห์ `modifyOtherKeys` ของ xterm,
- การแยกวิเคราะห์ Kitty protocol (`CSI u`, `CSI ~`, `CSI 1;...<letter>`),
- การ normalize เป็น key IDs (`ctrl+c`, `shift+tab`, `pageUp`, `f5` เป็นต้น)

การจัดการ Modifier:

- เปรียบเทียบเฉพาะ bit shift/alt/ctrl สำหรับการจับคู่คีย์,
- bit lock ถูก mask ออกก่อนการเปรียบเทียบ

พฤติกรรม Layout:

- การ fallback ของ base-layout ถูกจำกัดโดยเจตนาเพื่อให้ layout ที่ถูก remap ไม่สร้าง false match สำหรับตัวอักษร/สัญลักษณ์ ASCII

### พฤติกรรมเมื่อเกิดความล้มเหลว

- ลำดับที่ไม่รู้จักหรือไม่ถูกต้องจะให้ผล `null` จากฟังก์ชัน parse
- ฟังก์ชัน match คืนค่า `false` เมื่อ parse ล้มเหลวหรือไม่ตรงกัน
- ไม่มีพื้นผิวของ error ที่ throw สำหรับ key input ที่ไม่ถูกต้อง

## การ mapping ระหว่าง JS wrapper API และ Rust export

### Shell + PTY + กระบวนการ

| TS wrapper API | Rust N-API export | หมายเหตุ |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | การรัน shell แบบครั้งเดียว |
| `new Shell(options?)` | `Shell` class | เซสชัน shell แบบถาวร |
| `shell.run(options, onChunk?)` | `Shell::run` | นำเซสชันกลับมาใช้เมื่อ keepalive control flow |
| `shell.abort()` | `Shell::abort` | Abort การรันที่ active สำหรับ shell instance นั้น |
| `new PtySession()` | `PtySession` class | เซสชัน PTY แบบ stateful |
| `pty.start(options, onChunk?)` | `PtySession::start` | การรัน PTY แบบ interactive |
| `pty.write(data)` | `PtySession::write` | Raw stdin passthrough |
| `pty.resize(cols, rows)` | `PtySession::resize` | ขนาดเทอร์มินัลแบบ clamped |
| `pty.kill()` | `PtySession::kill` | Force-kill child PTY ที่ active |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | การยุติ process tree แบบ children-first |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | รายการ descendants แบบ recursive |

### คีย์

| TS wrapper API | Rust N-API export | หมายเหตุ |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | การจับคู่ Kitty codepoint+modifier |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Parser key-id แบบ normalized |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | การตรวจสอบ legacy sequence map แบบตรงทั้งหมด |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | ผลการ parse Kitty แบบ structured |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | ตัวจับคู่คีย์ระดับสูง |

## หมายเหตุเกี่ยวกับการทำความสะอาดเซสชันที่ถูกทิ้งและการ Finalize

- **เซสชัน Shell แบบถาวร**: หากการรันถูกยกเลิก/timeout/เกิดข้อผิดพลาด/non-keepalive control flow Rust จะ drop สถานะเซสชันภายในอย่างชัดเจน การรันปกติที่สำเร็จจะเก็บเซสชันไว้เพื่อนำกลับมาใช้
- **เซสชัน PTY**: `core` จะถูกล้างเสมอหลังจาก `start()` เสร็จสิ้น รวมถึงเส้นทางความล้มเหลว
- **ไม่มี contract การ kill ที่ขับเคลื่อนด้วย JS finalizer อย่างชัดเจน** ที่เปิดเผยโดย wrapper; การทำความสะอาดเชื่อมโยงกับเส้นทางการเสร็จสิ้น/ยกเลิกการรันเป็นหลัก ผู้เรียกควรใช้ `timeoutMs`, `AbortSignal`, `shell.abort()` หรือ `pty.kill()` เพื่อการ teardown ที่กำหนดได้
