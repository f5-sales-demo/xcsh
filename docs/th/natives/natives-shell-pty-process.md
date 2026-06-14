---
title: 'Natives Shell, PTY, กระบวนการ, และ Key ภายใน'
description: >-
  การรันเชลล์, การจัดการ PTY, วงจรชีวิตกระบวนการ,
  และการจัดการเหตุการณ์คีย์ในเลเยอร์ native
sidebar:
  order: 4
  label: 'Shell, PTY & กระบวนการ'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# Natives Shell, PTY, กระบวนการ, และ Key ภายใน

เอกสารนี้ครอบคลุม **primitives สำหรับการรัน/กระบวนการ/เทอร์มินัล** ใน `@f5xc-salesdemos/pi-natives`: `shell`, `pty`, `ps`, และ `keys` โดยใช้คำศัพท์ทางสถาปัตยกรรมจาก `docs/natives-architecture.md`

## ไฟล์การดำเนินงาน

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

## ความเป็นเจ้าของเลเยอร์

- **เลเยอร์ wrapper/API ของ TS** (`packages/natives/src/*`): entrypoints ที่มีการกำหนดชนิด, พื้นผิวการยกเลิก (`timeoutMs`, `AbortSignal`), และความสะดวกของ JS
- **เลเยอร์โมดูล Rust N-API** (`crates/pi-natives/src/*`): การรันกระบวนการ shell/PTY, การข้ามผ่าน/ยุติ process-tree, และการแยกวิเคราะห์ key-sequence
- **ประตูการตรวจสอบ** (`native.ts`, ระดับสถาปัตยกรรม): ตรวจสอบว่า exports ที่จำเป็น (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, ตัวช่วย key) มีอยู่ก่อนที่จะใช้ wrappers

## ระบบย่อย Shell (`shell`)

### รูปแบบ API

มีการเปิดเผยโหมดการรัน 2 แบบ:

1. **แบบครั้งเดียว** ผ่าน `executeShell(options, onChunk?)`
2. **เซสชันถาวร** ผ่าน `new Shell(options?)` จากนั้น `shell.run(...)` ซ้ำๆ

ทั้งสองแบบสตรีมผลลัพธ์ผ่าน threadsafe callback และคืนค่า `{ exitCode?, cancelled, timedOut }`

### การสร้างเซสชันและรูปแบบสภาพแวดล้อม

Rust สร้าง `brush_core::Shell` ด้วย:

- โหมดไม่ใช้งานแบบโต้ตอบ,
- `do_not_inherit_env: true`,
- การสร้างสภาพแวดล้อมใหม่อย่างชัดเจนจาก env ของโฮสต์,
- รายการข้ามสำหรับตัวแปรที่ sensitive ต่อ shell (`PS1`, `PWD`, `SHLVL`, การ export ฟังก์ชัน bash, ฯลฯ)

พฤติกรรม env ของเซสชัน:

- `ShellOptions.sessionEnv` ถูกใช้งานครั้งเดียวในการสร้างเซสชัน
- `ShellRunOptions.env` มีขอบเขตในระดับคำสั่ง (`EnvironmentScope::Command`) และถูก pop ออกหลังการรันแต่ละครั้ง
- `PATH` ถูก merge เป็นพิเศษบน Windows โดยมีการ dedupe แบบไม่สนใจตัวพิมพ์ใหญ่-เล็ก

การเพิ่มเส้นทางเฉพาะ Windows (`shell/windows.rs`): เส้นทาง Git-for-Windows ที่ค้นพบ (`cmd`, `bin`, `usr/bin`) จะถูกผนวกเพิ่มหากมีอยู่และยังไม่ได้รวมอยู่

### วงจรชีวิตรันไทม์และการเปลี่ยนสถานะ

Shell ถาวร (`Shell.run`) ใช้ state machine ดังนี้:

- **Idle/ยังไม่ถูกเริ่มต้น**: `session: None`
- **กำลังรัน**: `run()` ครั้งแรกสร้างเซสชันแบบ lazy, จัดเก็บ token `current_abort`, รันคำสั่ง
- **เสร็จสิ้น + keepalive**: หากโฟลว์การควบคุมการรันเป็น `Normal`, `current_abort` จะถูกล้างและเซสชันจะถูกนำมาใช้ซ้ำ
- **เสร็จสิ้น + teardown**: หากโฟลว์การควบคุมเกี่ยวข้องกับ loop/script/shell-exit (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), เซสชันจะถูก drop (`session: None`)
- **ถูกยกเลิก/หมดเวลา**: task การรันถูกยกเลิก, รอแบบ grace (2 วินาที), จากนั้นบังคับ abort; เซสชันถูก drop
- **ข้อผิดพลาด**: เซสชันถูก drop

Shell แบบครั้งเดียว (`executeShell`) สร้างและ drop เซสชันใหม่ทุกครั้งที่เรียกใช้

### พฤติกรรมการสตรีม/ผลลัพธ์

- Stdout/stderr ถูกนำเข้าสู่ pipe ที่ใช้ร่วมกันและอ่านแบบ concurrent
- Reader ถอดรหัส UTF-8 แบบ incremental; ลำดับ byte ที่ไม่ถูกต้องจะส่งออก chunk ที่แทนด้วย `U+FFFD`
- หลังจากกระบวนการเสร็จสิ้น, การระบาย output มีตัวป้องกัน idle/max (`250ms` idle, `2s` สูงสุด) เพื่อหลีกเลี่ยงการค้างเนื่องจาก background jobs ที่ยังเปิด descriptor อยู่

### การยกเลิก, การหมดเวลา, และ background jobs

- `CancelToken` ถูกสร้างจาก `timeoutMs` และ `AbortSignal` ที่เป็นทางเลือก
- เมื่อถูกยกเลิก/หมดเวลา, token การยกเลิก shell จะถูกทริกเกอร์, จากนั้น task จะได้รับเวลา 2 วินาทีแบบ graceful ก่อนการบังคับ abort
- หากเกิดการยกเลิก, background jobs จะถูกยุติ (`TERM`, จากนั้น `KILL` หลังจากล่าช้า) โดยใช้ข้อมูล job ของ brush

พฤติกรรมของ `Shell.abort()`:

- ยกเลิกเฉพาะคำสั่งที่กำลังรันอยู่สำหรับ instance `Shell` นั้น,
- ไม่ทำอะไรและสำเร็จเมื่อไม่มีอะไรกำลังรัน

### พฤติกรรมเมื่อเกิดความล้มเหลว

ข้อผิดพลาดที่พบบ่อยที่ถูกแสดงออกมา ได้แก่:

- ความล้มเหลวในการเริ่มต้นเซสชัน (`Failed to initialize shell`),
- ข้อผิดพลาด cwd (`Failed to set cwd`),
- ความล้มเหลวในการตั้งค่า/pop env,
- ความล้มเหลวของ snapshot source,
- ความล้มเหลวในการสร้าง/clone pipe,
- ความล้มเหลวในการรัน (`Shell execution failed: ...`),
- ความล้มเหลวของ task wrapper (`Shell execution task failed: ...`)

แฟล็กการยกเลิกระดับผลลัพธ์:

- หมดเวลา -> `exitCode: undefined`, `timedOut: true`
- abort signal -> `exitCode: undefined`, `cancelled: true`

## ระบบย่อย PTY (`pty`)

### รูปแบบ API

`new PtySession()` เปิดเผย:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### วงจรชีวิตรันไทม์และการเปลี่ยนสถานะ

State machine ของ `PtySession`:

- **Idle**: `core: None`
- **Reserved**: `start()` ติดตั้ง control channel แบบ synchronous (`core: Some`) ก่อนที่งาน async จะเริ่มต้น, ดังนั้น `write/resize/kill` จึงใช้งานได้ทันที
- **กำลังรัน**: PTY loop แบบ blocking จัดการสถานะของ child, เหตุการณ์ reader, heartbeat การยกเลิก, และ control messages
- **Terminal ปิด**: child exit + reader เสร็จสมบูรณ์
- **Finalized**: `core` จะถูกรีเซ็ตเป็น `None` เสมอหลังจาก task start เสร็จสิ้น (สำเร็จหรือข้อผิดพลาด)

ตัวป้องกัน Concurrency:

- การเริ่มต้นในขณะที่กำลังรันอยู่แล้วจะคืนค่า `PTY session already running`

### รูปแบบ Spawn/attach/write/read/terminate

- PTY เปิดผ่าน `portable_pty::native_pty_system().openpty(...)`
- คำสั่งรันในปัจจุบันเป็น `sh -lc <command>` พร้อม `cwd` และการแทนที่ env ที่เป็นทางเลือก
- `write()` ส่ง byte ดิบไปยัง stdin ของ PTY
- `resize()` จำกัดขนาด (`cols 20..400`, `rows 5..200`) และเรียก master resize
- `kill()` ทำเครื่องหมายการรันเป็นถูกยกเลิกและ kill กระบวนการ child

เส้นทาง output:

- thread reader เฉพาะอ่าน master stream,
- ถอดรหัส UTF-8 แบบ incremental พร้อมการแทนที่ `U+FFFD` สำหรับ byte ที่ไม่ถูกต้อง,
- chunk ถูกส่งต่อผ่าน N-API threadsafe callback

### ความหมายของการยกเลิกและการหมดเวลา

- `timeoutMs` และ `AbortSignal` ป้อนให้กับ `CancelToken`
- loop เรียก `ct.heartbeat()` เป็นระยะ; การ abort ทริกเกอร์การ kill child
- การจำแนกประเภทการหมดเวลาอ้างอิงสตริง (substring `"Timeout"` ใน heartbeat error)

### พฤติกรรมเมื่อเกิดความล้มเหลว

พื้นผิวข้อผิดพลาดรวมถึง:

- ความล้มเหลวในการจัดสรร/เปิด PTY,
- ความล้มเหลวใน PTY spawn,
- ความล้มเหลวในการได้มาซึ่ง writer/reader,
- ความล้มเหลวใน child status/wait,
- การเป็นพิษของ lock,
- การตัดการเชื่อมต่อ control-channel (`PTY session is no longer available`)

ความล้มเหลวของการเรียก control เมื่อไม่ได้รัน:

- `write/resize/kill` คืนค่า `PTY session is not running`

## ระบบย่อย Process-tree (`ps`)

### รูปแบบ API

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

TS wrapper ยังลงทะเบียน native kill-tree integration เข้าสู่ shared utils ผ่าน `setNativeKillTree(native.killTree)`

### การดำเนินงานเฉพาะแพลตฟอร์ม

- **Linux**: อ่าน `/proc/<pid>/task/<pid>/children` แบบ recursive
- **macOS**: ใช้ `libproc` `proc_listchildpids`
- **Windows**: สร้าง snapshot ของตาราง process ด้วย `CreateToolhelp32Snapshot`, สร้าง map ของ parent->children, ยุติด้วย `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`

### พฤติกรรม Kill-tree

- ลูกหลานถูกรวบรวมแบบ recursive
- ลำดับการ kill เป็นแบบ bottom-up (ลูกหลานที่ลึกที่สุดก่อน) เพื่อลดการ re-parenting ของ orphan
- Root pid ถูก kill เป็นลำดับสุดท้าย
- ค่าที่คืนคือจำนวนการยุติที่สำเร็จ

พฤติกรรม signal:

- POSIX: `signal` ที่ระบุจะถูกส่งไปยัง `kill`
- Windows: `signal` ถูกละเว้น; การยุติเป็นแบบบังคับ terminate กระบวนการโดยไม่มีเงื่อนไข

### พฤติกรรมเมื่อเกิดความล้มเหลว

โมดูลนี้ออกแบบมาให้ไม่โยน exception ที่พื้นผิว API โดยเจตนา:

- สาขา process tree ที่ไม่มีอยู่/เข้าถึงไม่ได้จะถูกข้าม,
- ความล้มเหลวในการ kill ต่อ pid จะถูกนับเป็นไม่สำเร็จ (ไม่ใช่ error),
- การ lookup ที่ไม่พบมักให้ `[]` จาก `listDescendants` และ `0` จาก `killTree`

## ระบบย่อยการแยกวิเคราะห์ Key (`keys`)

### รูปแบบ API

ตัวช่วยที่เปิดเผย:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### รูปแบบการแยกวิเคราะห์

Parser รวมกัน:

- การ map byte เดี่ยวโดยตรง (`enter`, `tab`, `ctrl+<letter>`, ASCII ที่พิมพ์ได้),
- การค้นหา escape-sequence แบบ legacy O(1) (PHF map),
- การแยกวิเคราะห์ `modifyOtherKeys` ของ xterm,
- การแยกวิเคราะห์ Kitty protocol (`CSI u`, `CSI ~`, `CSI 1;...<letter>`),
- การ normalize ไปยัง key IDs (`ctrl+c`, `shift+tab`, `pageUp`, `f5`, ฯลฯ)

การจัดการ Modifier:

- เปรียบเทียบเฉพาะ shift/alt/ctrl bits สำหรับการจับคู่ key,
- lock bits ถูก mask ออกก่อนการเปรียบเทียบ

พฤติกรรม Layout:

- การ fallback แบบ base-layout ถูกจำกัดโดยเจตนา เพื่อให้ layout ที่ถูก remap ไม่สร้างการจับคู่ผิดพลาดสำหรับตัวอักษร ASCII/สัญลักษณ์

### พฤติกรรมเมื่อเกิดความล้มเหลว

- ลำดับที่ไม่รู้จักหรือไม่ถูกต้องจะให้ผล `null` จากฟังก์ชัน parse
- ฟังก์ชัน match คืนค่า `false` เมื่อ parse ล้มเหลวหรือไม่ตรงกัน
- ไม่มีพื้นผิวข้อผิดพลาดที่โยน exception สำหรับ key input ที่มีรูปแบบไม่ถูกต้อง

## การ mapping API ของ JS wrapper ↔ Rust export

### Shell + PTY + กระบวนการ

| TS wrapper API | Rust N-API export | หมายเหตุ |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | การรัน shell แบบครั้งเดียว |
| `new Shell(options?)` | `Shell` class | เซสชัน shell ถาวร |
| `shell.run(options, onChunk?)` | `Shell::run` | นำเซสชันกลับมาใช้บน keepalive control flow |
| `shell.abort()` | `Shell::abort` | ยกเลิกการรันที่ active สำหรับ shell instance นั้น |
| `new PtySession()` | `PtySession` class | เซสชัน PTY แบบมีสถานะ |
| `pty.start(options, onChunk?)` | `PtySession::start` | การรัน PTY แบบโต้ตอบ |
| `pty.write(data)` | `PtySession::write` | การส่งผ่าน stdin แบบ raw |
| `pty.resize(cols, rows)` | `PtySession::resize` | ขนาดเทอร์มินัลที่มีการจำกัด |
| `pty.kill()` | `PtySession::kill` | บังคับ kill child ของ PTY ที่ active |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | การยุติ process tree แบบ children-first |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | รายการลูกหลานแบบ recursive |

### Keys

| TS wrapper API | Rust N-API export | หมายเหตุ |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | การจับคู่ Kitty codepoint+modifier |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Parser key-id แบบ normalized |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | การตรวจสอบ legacy sequence map แบบตรงตัว |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | ผลลัพธ์การแยกวิเคราะห์ Kitty แบบมีโครงสร้าง |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | ตัวจับคู่ key ระดับสูง |

## หมายเหตุการทำความสะอาดและ finalization เซสชันที่ถูกละทิ้ง

- **เซสชัน shell ถาวร**: หากการรันถูกยกเลิก/หมดเวลา/เกิดข้อผิดพลาด/โฟลว์การควบคุมแบบไม่ keepalive, Rust จะ drop สถานะเซสชันภายในโดยชัดเจน การรันปกติที่สำเร็จจะเก็บเซสชันไว้เพื่อนำมาใช้ซ้ำ
- **เซสชัน PTY**: `core` จะถูกล้างเสมอหลังจาก `start()` เสร็จสิ้น รวมถึงเส้นทางที่เกิดความล้มเหลว
- **ไม่มี contract การ kill ที่ขับเคลื่อนด้วย JS finalizer อย่างชัดเจน** ที่เปิดเผยโดย wrappers; การทำความสะอาดเชื่อมโยงกับเส้นทางการเสร็จสิ้น/การยกเลิกการรันเป็นหลัก ผู้เรียกควรใช้ `timeoutMs`, `AbortSignal`, `shell.abort()`, หรือ `pty.kill()` สำหรับการ teardown แบบ deterministic
