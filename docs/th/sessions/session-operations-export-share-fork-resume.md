---
title: 'Session Operations: Export, Dump, Share, Fork, Resume'
description: >-
  Session operations for exporting, sharing, forking, and resuming
  conversations.
sidebar:
  order: 3
  label: Operations
i18n:
  sourceHash: e3c210b29c3e
  translator: machine
---

# การดำเนินการเซสชัน: export, dump, share, fork, resume/continue

เอกสารนี้อธิบายพฤติกรรมที่ผู้ดำเนินการสามารถสังเกตได้สำหรับการดำเนินการ export/share/fork/resume ของเซสชันตามที่มีการ implement ในปัจจุบัน

## ไฟล์ implementation

- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/export/html/index.ts`](../../packages/coding-agent/src/export/html/index.ts)
- [`../src/export/custom-share.ts`](../../packages/coding-agent/src/export/custom-share.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)

## ตารางการดำเนินการ

| การดำเนินการ | เส้นทางเข้า | การเปลี่ยนแปลงเซสชัน | การสร้าง/สลับไฟล์เซสชัน | สิ่งที่สร้างออกมา |
|---|---|---|---|---|
| `/dump` | คำสั่ง slash แบบ interactive | ไม่ | ไม่ | ข้อความใน clipboard |
| `/export [path]` | คำสั่ง slash แบบ interactive | ไม่ | ไม่ | ไฟล์ HTML |
| `--export <session.jsonl> [outputPath]` | เส้นทางเร็ว CLI เมื่อเริ่มต้น | ไม่มีการเปลี่ยนแปลงเซสชันขณะรันไทม์ | ไม่มีเซสชันที่ใช้งานอยู่; อ่านไฟล์เป้าหมาย | ไฟล์ HTML |
| `/share` | คำสั่ง slash แบบ interactive | ไม่ | ไม่ | HTML ชั่วคราว + share URL/gist |
| `/fork` | คำสั่ง slash แบบ interactive | ใช่ (ตัวตนเซสชันที่ใช้งานอยู่เปลี่ยนแปลง) | สร้างไฟล์เซสชันใหม่และสลับเซสชันปัจจุบันไปที่ไฟล์นั้น (โหมด persistent เท่านั้น) | คัดลอกไดเรกทอรี artifact ไปยัง namespace เซสชันใหม่เมื่อมีอยู่ |
| `/resume` | คำสั่ง slash แบบ interactive | ใช่ (สถานะ in-memory ที่ใช้งานอยู่ถูกแทนที่) | สลับไปยังไฟล์เซสชันที่มีอยู่แล้วที่เลือก | ไม่มี |
| `--resume` | CLI เมื่อเริ่มต้น (ตัวเลือก) | ใช่ หลังจากสร้างเซสชัน | เปิดไฟล์เซสชันที่มีอยู่แล้วที่เลือก | ไม่มี |
| `--resume <id\|path>` | CLI เมื่อเริ่มต้น | ใช่ หลังจากสร้างเซสชัน | เปิดเซสชันที่มีอยู่; กรณีข้ามโปรเจกต์สามารถ fork เข้าสู่โปรเจกต์ปัจจุบัน | ไม่มี |
| `--continue` | CLI เมื่อเริ่มต้น | ใช่ หลังจากสร้างเซสชัน | เปิด breadcrumb ของ terminal หรือเซสชันล่าสุด; สร้างใหม่ถ้าไม่มี | ไม่มี |

## Export และ dump

### `/export [outputPath]` (interactive)

ขั้นตอน:

1. `InputController` ส่ง `/export...` ไปยัง `CommandController.handleExportCommand`
2. คำสั่งแยกด้วย whitespace และใช้เฉพาะอาร์กิวเมนต์แรกหลัง `/export` เป็น `outputPath`
3. `AgentSession.exportToHtml()` เรียก `exportSessionToHtml(sessionManager, state, { outputPath, themeName })`
4. เมื่อสำเร็จ UI จะแสดงเส้นทางและเปิดไฟล์ในเบราว์เซอร์

รายละเอียดพฤติกรรม:

- อาร์กิวเมนต์ `--copy`, `clipboard` และ `copy` จะถูกปฏิเสธอย่างชัดเจนพร้อมคำเตือนให้ใช้ `/dump`
- Export จะฝัง header/entries/leaf ของเซสชันรวมถึง `systemPrompt` ปัจจุบันและคำอธิบายเครื่องมือจากสถานะ agent
- ไม่มีการเพิ่มรายการเซสชันระหว่าง export

ข้อควรระวัง:

- การแยกอาร์กิวเมนต์ใช้ whitespace (`text.split(/\s+/)`) ดังนั้นเส้นทางที่มีช่องว่างแม้ใส่เครื่องหมายคำพูดก็จะไม่ถูกเก็บรักษาเป็นเส้นทางเดียวโดยเส้นทางคำสั่งนี้

### `--export <inputSessionFile> [outputPath]` (CLI)

ขั้นตอนใน `main.ts`:

1. ถูกจัดการตั้งแต่เนิ่นๆ (ก่อน interactive/session startup)
2. เรียก `exportFromFile(inputPath, outputPath?)`
3. `SessionManager.open(inputPath)` โหลดรายการ จากนั้นสร้าง HTML และเขียนออกมา
4. กระบวนการแสดง `Exported to: ...` และออก

รายละเอียดพฤติกรรม:

- ไฟล์ input ที่หายไปจะแสดงเป็น `File not found: <path>`
- เส้นทางนี้ไม่สร้าง `AgentSession` และไม่เปลี่ยนแปลงเซสชันที่กำลังรันอยู่

### `/dump` (export ไปยัง clipboard แบบ interactive)

ขั้นตอน:

1. `CommandController.handleDumpCommand()` เรียก `session.formatSessionAsText()`
2. ถ้าเป็นสตริงว่าง จะรายงาน `No messages to dump yet.`
3. ไม่เช่นนั้นจะคัดลอกไปยัง clipboard ผ่าน `copyToClipboard` แบบ native

เนื้อหา dump ประกอบด้วย:

- System prompt
- โมเดล/ระดับการคิดที่ใช้งานอยู่
- คำจำกัดความเครื่องมือ + พารามิเตอร์
- ข้อความ user/assistant
- บล็อก thinking และ tool calls
- ผลลัพธ์เครื่องมือและบล็อกการดำเนินการ (ยกเว้นรายการ bash/python ที่มี `excludeFromContext`)
- รายการ custom/hook/file mention/branch summary/compaction summary

ไม่มีการเปลี่ยนแปลงการเก็บเซสชันถาวรจากการ dump

## Share

`/share` เป็นแบบ interactive เท่านั้นและเริ่มต้นด้วยการ export เซสชันปัจจุบันไปยังไฟล์ HTML ชั่วคราวเสมอ

### ขั้นตอนที่ 1: export ชั่วคราว

- เส้นทางไฟล์ชั่วคราว: `${os.tmpdir()}/${Snowflake.next()}.html`
- ใช้ `session.exportToHtml(tmpFile)`
- ถ้า export ล้มเหลว (โดยเฉพาะเซสชัน in-memory) share จะจบด้วยข้อผิดพลาด

### ขั้นตอนที่ 2: custom share handler (ถ้ามี)

`loadCustomShare()` ตรวจสอบ `~/.xcsh/agent` สำหรับไฟล์ที่มีอยู่ตัวแรก:

- `share.ts`
- `share.js`
- `share.mjs`

ข้อกำหนด:

- โมดูลต้อง default-export ฟังก์ชัน `(htmlPath) => Promise<CustomShareResult | string | undefined>`

ถ้ามีอยู่และถูกต้อง:

- UI เข้าสู่สถานะ loader `Sharing...`
- การตีความผลลัพธ์ของ handler:
  - string => ถือเป็น URL แสดงและเปิด
  - object => แสดง `url` และ/หรือ `message`; เปิด `url`
  - `undefined`/falsy => แสดง `Session shared` ทั่วไป
- ไฟล์ชั่วคราวจะถูกลบหลังจากเสร็จสิ้น

พฤติกรรม fallback ที่สำคัญ:

- ถ้า custom handler มีอยู่แต่การโหลดล้มเหลว คำสั่งจะแสดงข้อผิดพลาดและ return
- ถ้า custom handler ดำเนินการแล้ว throw คำสั่งจะแสดงข้อผิดพลาดและ return
- ในทั้งสองกรณีที่ล้มเหลว จะ **ไม่** fallback ไปยัง GitHub gist
- Gist fallback เกิดขึ้นเฉพาะเมื่อไม่มี custom share script

### ขั้นตอนที่ 3: gist fallback เริ่มต้น

เฉพาะเมื่อไม่พบ custom share handler:

1. ตรวจสอบ `gh auth status`
2. แสดง loader `Creating gist...`
3. รัน `gh gist create --public=false <tmpFile>`
4. แยก gist URL สร้าง gist id สร้าง preview URL `https://gistpreview.github.io/?<id>`
5. แสดงทั้ง preview และ gist URLs; เปิด preview

ความหมายของการยกเลิก/abort ใน share:

- Loader มี hook `onAbort` ที่คืนค่า UI ของ editor และรายงาน `Share cancelled`
- คำสั่ง `gh gist create` ที่อยู่เบื้องหลังไม่ได้รับ abort signal ในเส้นทางโค้ดนี้; การยกเลิกอยู่ระดับ UI และถูกตรวจสอบหลังจากคำสั่ง return

## Fork

`/fork` สร้างเซสชันใหม่จากเซสชันปัจจุบันและสลับตัวตนเซสชันที่ใช้งานอยู่

### เงื่อนไขเบื้องต้นและการตรวจสอบทันที

- ถ้า agent กำลัง streaming `/fork` จะถูกปฏิเสธพร้อมคำเตือน
- ตัวบ่งชี้สถานะ/loading ของ UI จะถูกล้างก่อนการดำเนินการ

### ขั้นตอนระดับเซสชัน

`AgentSession.fork()`:

1. ส่ง `session_before_switch` พร้อม `reason: "fork"` (ยกเลิกได้)
2. ล้างการเขียนที่รอดำเนินการ
3. เรียก `SessionManager.fork()`
4. คัดลอกไดเรกทอรี artifacts จาก namespace เซสชันเก่าไปยัง namespace ใหม่ (แบบ best-effort; ความล้มเหลวในการคัดลอกที่ไม่ใช่ ENOENT จะถูกบันทึก log ไม่ถือเป็น fatal)
5. อัปเดต `agent.sessionId`
6. ส่ง `session_switch` พร้อม `reason: "fork"`

พฤติกรรมของ `SessionManager.fork()`:

- ต้องการโหมด persistent และไฟล์เซสชันที่มีอยู่
- สร้าง session id ใหม่และเส้นทางไฟล์ JSONL ใหม่
- เขียน header ใหม่ด้วย:
  - `id` ใหม่
  - timestamp ใหม่
  - `cwd` ไม่เปลี่ยน
  - `parentSession` ตั้งเป็น session id ก่อนหน้า
- เก็บรายการที่ไม่ใช่ header ทั้งหมดไว้โดยไม่เปลี่ยนแปลงในไฟล์ใหม่

### พฤติกรรมแบบ non-persistent

- Session manager แบบ in-memory return `undefined` จาก `fork()`
- `AgentSession.fork()` return `false`
- UI รายงาน `Fork failed (session not persisted or cancelled)`

## Resume และ continue

## Interactive `/resume`

ขั้นตอน:

1. เปิดตัวเลือกเซสชันที่ถูกเติมผ่าน `SessionManager.list(currentCwd, currentSessionDir)`
2. เมื่อเลือก `SelectorController.handleResumeSession(sessionPath)` เรียก `session.switchSession(sessionPath)`
3. UI ล้าง/สร้างใหม่ chat และ todos จากนั้นรายงาน `Resumed session`

หมายเหตุ:

- ตัวเลือกนี้แสดงเฉพาะเซสชันในขอบเขตไดเรกทอรีเซสชันปัจจุบัน
- ไม่ใช้การค้นหาข้ามโปรเจกต์แบบ global

## CLI `--resume`

### `--resume` (ไม่มีค่า)

- `main.ts` แสดงรายการเซสชันสำหรับ cwd/sessionDir ปัจจุบันและเปิดตัวเลือก
- เส้นทางที่เลือกจะถูกเปิดด้วย `SessionManager.open(selectedPath)` ก่อนสร้างเซสชัน

### `--resume <value>`

ลำดับการ resolve ของ `createSessionManager()`:

1. ถ้า value ดูเหมือนเส้นทาง (`/`, `\` หรือ `.jsonl`) เปิดโดยตรง
2. ไม่เช่นนั้นถือเป็น id prefix:
   - ค้นหาในขอบเขตปัจจุบัน (`SessionManager.list(cwd, sessionDir)`)
   - ถ้าไม่พบและไม่มี `sessionDir` ที่ระบุชัดเจน ค้นหาแบบ global (`SessionManager.listAll()`)

พฤติกรรมการจับคู่ id ข้ามโปรเจกต์:

- ถ้า cwd ของเซสชันที่จับคู่แตกต่างจาก cwd ปัจจุบัน CLI จะถาม:
  - `Session found in different project ... Fork into current directory? [y/N]`
- ถ้าตอบ yes: `SessionManager.forkFrom(match.path, cwd, sessionDir)` สร้างไฟล์ fork ในเครื่องใหม่
- ถ้าตอบ no/ค่าเริ่มต้นที่ไม่ใช่ TTY: คำสั่งแสดงข้อผิดพลาด

## CLI `--continue`

`SessionManager.continueRecent(cwd, sessionDir)`:

1. Resolve ไดเรกทอรีเซสชันสำหรับ cwd ปัจจุบัน
2. อ่าน breadcrumb ที่กำหนดขอบเขตตาม terminal ก่อน
3. Fallback ไปยังไฟล์เซสชันที่แก้ไขล่าสุด
4. เปิดเซสชันที่พบ; ถ้าไม่มี จะสร้างเซสชันใหม่

นี่คือพฤติกรรมเมื่อเริ่มต้นเท่านั้น; ไม่มีคำสั่ง slash `/continue` แบบ interactive

## วิธีที่การสลับเซสชันเปลี่ยนแปลงสถานะรันไทม์จริงๆ

`AgentSession.switchSession(sessionPath)` ทำการเปลี่ยนผ่านรันไทม์ที่ใช้โดยการดำเนินการแบบ resume:

1. ส่ง `session_before_switch` พร้อม `reason: "resume"` และ `targetSessionFile` (ยกเลิกได้)
2. ยกเลิกการสมัครรับ event ของ agent และ abort งานที่กำลังดำเนินการ
3. ล้างข้อความ steering/follow-up/next-turn ที่อยู่ในคิว
4. ล้างการเขียนที่รอดำเนินการของ session manager ปัจจุบัน
5. `sessionManager.setSessionFile(sessionPath)` และอัปเดต `agent.sessionId`
6. สร้าง session context จากรายการที่โหลด
7. ส่ง `session_switch` พร้อม `reason: "resume"`
8. แทนที่ข้อความ agent จาก context
9. คืนค่าโมเดล (ถ้ามีใน registry ปัจจุบัน)
10. คืนค่าหรือเริ่มต้นระดับการคิด
11. เชื่อมต่อการสมัครรับ event ของ agent อีกครั้ง

`switchSession()` เองไม่สร้างไฟล์เซสชันใหม่

## การส่ง event และจุดยกเลิก

### Hook ของวงจร switch/fork

สำหรับ `newSession`, `fork` และ `switchSession`:

- Event ก่อน: `session_before_switch`
  - reasons: `new`, `fork`, `resume`
  - ยกเลิกได้โดย return `{ cancel: true }`
- Event หลัง: `session_switch`
  - ชุด reason เดียวกัน
  - รวม `previousSessionFile`

`ExtensionRunner.emit()` return เร็วเมื่อพบผลลัพธ์ before-event ที่ยกเลิกเป็นตัวแรก

### พฤติกรรม `onSession` ของ custom tool

SDK bridge เชื่อม session events ของ extension กับ callback `onSession` ของ custom tool:

- `session_switch` -> `onSession({ reason: "switch", previousSessionFile })`
- `session_branch` -> `reason: "branch"`
- `session_start` -> `reason: "start"`
- `session_tree` -> `reason: "tree"`
- `session_shutdown` -> `reason: "shutdown"`

callback เหล่านี้เป็นแบบสังเกตการณ์; ไม่สามารถยกเลิก switch/fork ได้

### พื้นผิวการยกเลิกอื่นๆ ที่เกี่ยวข้องกับเอกสารนี้

- `/fork` ถูกบล็อกขณะ streaming (ผู้ใช้ต้องรอ/abort การตอบสนองปัจจุบันก่อน)
- ตัวเลือก `/resume` สามารถถูกยกเลิกได้โดยผู้ใช้ปิดตัวเลือก
- `--resume <id>` ข้ามโปรเจกต์สามารถถูกยกเลิกได้โดยปฏิเสธ fork prompt
- `/share` มีเส้นทาง UI abort (`Share cancelled`) สำหรับ gist flow; ไม่ได้เชื่อมต่อ process-kill semantics สำหรับ `gh gist create` ในเส้นทางโค้ดนี้

## พฤติกรรมเซสชัน non-persistent (in-memory)

เมื่อ session manager ถูกสร้างด้วย `SessionManager.inMemory()` (`--no-session`):

- ไม่มีเส้นทางไฟล์เซสชัน
- `/export` และ `/share` ล้มเหลวด้วย `Cannot export in-memory session to HTML` (ส่งต่อไปยัง UI ข้อผิดพลาดของคำสั่ง)
- `/fork` ล้มเหลวเพราะ `SessionManager.fork()` ต้องการ persistence
- `/dump` ยังคงทำงานได้เพราะมันทำ serialize สถานะ agent ใน in-memory
- ความหมายของ resume/continue ใน CLI จะถูกข้ามถ้ามีการตั้ง `--no-session` เพราะการสร้าง manager จะ return in-memory ทันที

## ข้อควรระวังของ implementation ที่ทราบ (ณ โค้ดปัจจุบัน)

- `SelectorController.handleResumeSession()` ไม่ได้ตรวจสอบผลลัพธ์ boolean จาก `session.switchSession(...)`; การ switch ที่ถูกยกเลิกโดย hook ยังคงสามารถดำเนินการผ่านเส้นทาง UI repaint/status "Resumed session" ได้
- ความล้มเหลวของ custom-share ใน `/share` ไม่ลดระดับลงไปยัง gist fallback เริ่มต้น; จะยุติคำสั่งด้วยข้อผิดพลาด
- การแยกอาร์กิวเมนต์ของ `/export` เป็นแบบเรียบง่ายและไม่รักษาเส้นทางที่มีช่องว่างแม้ใส่เครื่องหมายคำพูด
