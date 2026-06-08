---
title: 'Session Operations: Export, Dump, Share, Fork, Resume'
description: การดำเนินการเซสชันสำหรับการส่งออก แชร์ แยก และดำเนินต่อการสนทนา
sidebar:
  order: 3
  label: Operations
i18n:
  sourceHash: e3c210b29c3e
  translator: machine
---

# การดำเนินการเซสชัน: export, dump, share, fork, resume/continue

เอกสารนี้อธิบายพฤติกรรมที่ผู้ดำเนินการมองเห็นได้สำหรับการดำเนินการ export/share/fork/resume ของเซสชันตามที่ implement ในปัจจุบัน

## ไฟล์ implementation

- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/export/html/index.ts`](../../packages/coding-agent/src/export/html/index.ts)
- [`../src/export/custom-share.ts`](../../packages/coding-agent/src/export/custom-share.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)

## ตารางการดำเนินการ

| การดำเนินการ | เส้นทางเข้า | การเปลี่ยนแปลงเซสชัน | การสร้าง/สลับไฟล์เซสชัน | สิ่งที่ได้ออกมา |
|---|---|---|---|---|
| `/dump` | คำสั่ง slash แบบโต้ตอบ | ไม่ | ไม่ | ข้อความในคลิปบอร์ด |
| `/export [path]` | คำสั่ง slash แบบโต้ตอบ | ไม่ | ไม่ | ไฟล์ HTML |
| `--export <session.jsonl> [outputPath]` | CLI startup fast-path | ไม่มีการเปลี่ยนแปลงเซสชันขณะทำงาน | ไม่มีเซสชันที่ทำงานอยู่; อ่านไฟล์เป้าหมาย | ไฟล์ HTML |
| `/share` | คำสั่ง slash แบบโต้ตอบ | ไม่ | ไม่ | HTML ชั่วคราว + share URL/gist |
| `/fork` | คำสั่ง slash แบบโต้ตอบ | ใช่ (identity ของเซสชันที่ทำงานอยู่เปลี่ยน) | สร้างไฟล์เซสชันใหม่และสลับเซสชันปัจจุบันไปยังไฟล์นั้น (เฉพาะโหมด persistent) | คัดลอกไดเรกทอรี artifact ไปยัง namespace เซสชันใหม่เมื่อมี |
| `/resume` | คำสั่ง slash แบบโต้ตอบ | ใช่ (state ในหน่วยความจำที่ทำงานอยู่ถูกแทนที่) | สลับไปยังไฟล์เซสชันที่มีอยู่แล้ว | ไม่มี |
| `--resume` | CLI startup (ตัวเลือก) | ใช่หลังจากสร้างเซสชัน | เปิดไฟล์เซสชันที่มีอยู่แล้ว | ไม่มี |
| `--resume <id\|path>` | CLI startup | ใช่หลังจากสร้างเซสชัน | เปิดเซสชันที่มีอยู่; กรณีข้ามโปรเจกต์สามารถ fork เข้าโปรเจกต์ปัจจุบันได้ | ไม่มี |
| `--continue` | CLI startup | ใช่หลังจากสร้างเซสชัน | เปิดเซสชัน breadcrumb ของเทอร์มินัลหรือเซสชันล่าสุด; สร้างใหม่หากไม่มี | ไม่มี |

## Export และ dump

### `/export [outputPath]` (โต้ตอบ)

ขั้นตอน:

1. `InputController` ส่ง `/export...` ไปที่ `CommandController.handleExportCommand`
2. คำสั่งแยกด้วยช่องว่างและใช้เฉพาะอาร์กิวเมนต์แรกหลัง `/export` เป็น `outputPath`
3. `AgentSession.exportToHtml()` เรียก `exportSessionToHtml(sessionManager, state, { outputPath, themeName })`
4. เมื่อสำเร็จ UI จะแสดงเส้นทางและเปิดไฟล์ในเบราว์เซอร์

รายละเอียดพฤติกรรม:

- อาร์กิวเมนต์ `--copy`, `clipboard` และ `copy` จะถูกปฏิเสธอย่างชัดเจนพร้อมคำเตือนให้ใช้ `/dump`
- Export จะฝัง session header/entries/leaf รวมถึง `systemPrompt` ปัจจุบันและคำอธิบาย tool จาก agent state
- ไม่มีรายการเซสชันถูกเพิ่มระหว่างการ export

ข้อควรระวัง:

- การแยกอาร์กิวเมนต์ใช้ช่องว่าง (`text.split(/\s+/)`) ดังนั้นเส้นทางที่ใส่เครื่องหมายคำพูดซึ่งมีช่องว่างจะไม่ถูกรักษาเป็นเส้นทางเดียวในเส้นทางคำสั่งนี้

### `--export <inputSessionFile> [outputPath]` (CLI)

ขั้นตอนใน `main.ts`:

1. จัดการก่อน (ก่อน interactive/session startup)
2. เรียก `exportFromFile(inputPath, outputPath?)`
3. `SessionManager.open(inputPath)` โหลดรายการ จากนั้น HTML จะถูกสร้างและเขียน
4. โปรเซสพิมพ์ `Exported to: ...` แล้วออก

รายละเอียดพฤติกรรม:

- ไฟล์อินพุตที่หายไปจะแสดงเป็น `File not found: <path>`
- เส้นทางนี้ไม่สร้าง `AgentSession` และไม่เปลี่ยนแปลงเซสชันที่ทำงานอยู่

### `/dump` (ส่งออกไปคลิปบอร์ดแบบโต้ตอบ)

ขั้นตอน:

1. `CommandController.handleDumpCommand()` เรียก `session.formatSessionAsText()`
2. หากเป็นสตริงว่าง จะรายงาน `No messages to dump yet.`
3. มิฉะนั้นจะคัดลอกไปยังคลิปบอร์ดผ่าน native `copyToClipboard`

เนื้อหาของ dump ประกอบด้วย:

- System prompt
- โมเดล/ระดับ thinking ที่ทำงานอยู่
- คำจำกัดความ tool + พารามิเตอร์
- ข้อความ user/assistant
- Thinking blocks และ tool calls
- ผลลัพธ์ tool และ execution blocks (ยกเว้นรายการ bash/python ที่เป็น `excludeFromContext`)
- รายการ custom/hook/file mention/branch summary/compaction summary

ไม่มีการเปลี่ยนแปลงการเก็บรักษาเซสชันจากการ dump

## Share

`/share` ใช้ได้เฉพาะแบบโต้ตอบและเริ่มต้นด้วยการส่งออกเซสชันปัจจุบันเป็นไฟล์ HTML ชั่วคราวเสมอ

### ระยะที่ 1: การส่งออกชั่วคราว

- เส้นทางไฟล์ชั่วคราว: `${os.tmpdir()}/${Snowflake.next()}.html`
- ใช้ `session.exportToHtml(tmpFile)`
- หากการส่งออกล้มเหลว (โดยเฉพาะเซสชันในหน่วยความจำ) การ share จะจบลงพร้อมข้อผิดพลาด

### ระยะที่ 2: custom share handler (ถ้ามี)

`loadCustomShare()` ตรวจสอบ `~/.xcsh/agent` สำหรับไฟล์ผู้สมัครที่มีอยู่ไฟล์แรก:

- `share.ts`
- `share.js`
- `share.mjs`

ข้อกำหนด:

- โมดูลต้อง default-export ฟังก์ชัน `(htmlPath) => Promise<CustomShareResult | string | undefined>`

หากมีและถูกต้อง:

- UI จะเข้าสู่สถานะ loader `Sharing...`
- การตีความผลลัพธ์ของ handler:
  - string => ถือเป็น URL แสดงและเปิด
  - object => แสดง `url` และ/หรือ `message`; เปิด `url`
  - `undefined`/falsy => แสดง `Session shared` ทั่วไป
- ไฟล์ชั่วคราวจะถูกลบหลังเสร็จสิ้น

พฤติกรรม fallback ที่สำคัญ:

- หาก custom handler มีอยู่แต่โหลดไม่สำเร็จ คำสั่งจะแสดงข้อผิดพลาดและส่งคืน
- หาก custom handler ทำงานแล้วเกิด throw คำสั่งจะแสดงข้อผิดพลาดและส่งคืน
- ในทั้งสองกรณีที่ล้มเหลว **จะไม่** fallback ไปยัง GitHub gist
- Gist fallback เกิดขึ้นเฉพาะเมื่อไม่มีสคริปต์ custom share

### ระยะที่ 3: gist fallback เริ่มต้น

เฉพาะเมื่อไม่พบ custom share handler:

1. ตรวจสอบ `gh auth status`
2. แสดง loader `Creating gist...`
3. เรียก `gh gist create --public=false <tmpFile>`
4. แยก gist URL สร้าง gist id สร้าง preview URL `https://gistpreview.github.io/?<id>`
5. แสดงทั้ง preview และ gist URL; เปิด preview

ความหมายของ cancellation/abort ใน share:

- Loader มี hook `onAbort` ที่คืนค่า editor UI และรายงาน `Share cancelled`
- คำสั่ง `gh gist create` ที่อยู่เบื้องหลังไม่ได้รับ abort signal ในเส้นทางโค้ดนี้; cancellation เป็นระดับ UI และถูกตรวจสอบหลังจากคำสั่งส่งคืน

## Fork

`/fork` สร้างเซสชันใหม่จากเซสชันปัจจุบันและสลับ identity ของเซสชันที่ทำงานอยู่

### เงื่อนไขเบื้องต้นและ guards ทันที

- หาก agent กำลัง streaming `/fork` จะถูกปฏิเสธพร้อมคำเตือน
- ตัวบ่งชี้สถานะ/loading ของ UI จะถูกล้างก่อนการดำเนินการ

### ขั้นตอนระดับเซสชัน

`AgentSession.fork()`:

1. ส่ง `session_before_switch` พร้อม `reason: "fork"` (ยกเลิกได้)
2. Flush การเขียนที่รอดำเนินการ
3. เรียก `SessionManager.fork()`
4. คัดลอกไดเรกทอรี artifacts จาก namespace เซสชันเก่าไปยัง namespace ใหม่ (best-effort; ความล้มเหลวในการคัดลอกที่ไม่ใช่ ENOENT จะถูก log ไม่ใช่ fatal)
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
- เก็บรายการที่ไม่ใช่ header ทั้งหมดไว้ไม่เปลี่ยนแปลงในไฟล์ใหม่

### พฤติกรรมแบบ non-persistent

- Session manager ในหน่วยความจำส่งคืน `undefined` จาก `fork()`
- `AgentSession.fork()` ส่งคืน `false`
- UI รายงาน `Fork failed (session not persisted or cancelled)`

## Resume และ continue

## `/resume` แบบโต้ตอบ

ขั้นตอน:

1. เปิดตัวเลือกเซสชันที่เติมข้อมูลผ่าน `SessionManager.list(currentCwd, currentSessionDir)`
2. เมื่อเลือก `SelectorController.handleResumeSession(sessionPath)` จะเรียก `session.switchSession(sessionPath)`
3. UI ล้าง/สร้างใหม่ chat และ todos จากนั้นรายงาน `Resumed session`

หมายเหตุ:

- ตัวเลือกนี้แสดงรายการเฉพาะเซสชันในขอบเขตไดเรกทอรีเซสชันปัจจุบัน
- ไม่ใช้การค้นหาข้ามโปรเจกต์ทั่วโลก

## CLI `--resume`

### `--resume` (ไม่มีค่า)

- `main.ts` แสดงรายการเซสชันสำหรับ cwd/sessionDir ปัจจุบันและเปิดตัวเลือก
- เส้นทางที่เลือกจะถูกเปิดด้วย `SessionManager.open(selectedPath)` ก่อนการสร้างเซสชัน

### `--resume <value>`

ลำดับการแก้ไขของ `createSessionManager()`:

1. หากค่าดูเหมือนเส้นทาง (`/`, `\` หรือ `.jsonl`) เปิดโดยตรง
2. มิฉะนั้นถือเป็น id prefix:
   - ค้นหาขอบเขตปัจจุบัน (`SessionManager.list(cwd, sessionDir)`)
   - หากไม่พบและไม่มี `sessionDir` ที่ระบุชัดเจน ค้นหาทั่วโลก (`SessionManager.listAll()`)

พฤติกรรมการจับคู่ id ข้ามโปรเจกต์:

- หาก cwd ของเซสชันที่จับคู่ได้แตกต่างจาก cwd ปัจจุบัน CLI จะถาม:
  - `Session found in different project ... Fork into current directory? [y/N]`
- เมื่อตอบใช่: `SessionManager.forkFrom(match.path, cwd, sessionDir)` สร้างไฟล์ fork ใหม่ในเครื่อง
- เมื่อตอบไม่/ค่าเริ่มต้นที่ไม่ใช่ TTY: คำสั่งแสดงข้อผิดพลาด

## CLI `--continue`

`SessionManager.continueRecent(cwd, sessionDir)`:

1. แก้ไข session dir สำหรับ cwd ปัจจุบัน
2. อ่าน breadcrumb ที่กำหนดขอบเขตเทอร์มินัลก่อน
3. Fallback ไปยังไฟล์เซสชันที่แก้ไขล่าสุด
4. เปิดเซสชันที่พบ; หากไม่มีจะสร้างเซสชันใหม่

นี่เป็นพฤติกรรมเฉพาะตอน startup; ไม่มีคำสั่ง slash `/continue` แบบโต้ตอบ

## วิธีที่การสลับเซสชันเปลี่ยนแปลง runtime state จริง

`AgentSession.switchSession(sessionPath)` ทำการเปลี่ยนผ่าน runtime ที่ใช้โดยการดำเนินการแบบ resume:

1. ส่ง `session_before_switch` พร้อม `reason: "resume"` และ `targetSessionFile` (ยกเลิกได้)
2. ตัดการเชื่อมต่อ agent event subscription และยกเลิกงานที่กำลังดำเนินอยู่
3. ล้างข้อความ steering/follow-up/next-turn ที่อยู่ในคิว
4. Flush การเขียนของ session manager ปัจจุบัน
5. `sessionManager.setSessionFile(sessionPath)` และอัปเดต `agent.sessionId`
6. สร้าง session context จากรายการที่โหลด
7. ส่ง `session_switch` พร้อม `reason: "resume"`
8. แทนที่ข้อความ agent จาก context
9. คืนค่าโมเดล (หากมีใน registry ปัจจุบัน)
10. คืนค่าหรือเริ่มต้นระดับ thinking
11. เชื่อมต่อ agent event subscription ใหม่

ไม่มีไฟล์เซสชันใหม่ถูกสร้างโดย `switchSession()` เอง

## การส่ง event และจุดยกเลิก

### Switch/fork lifecycle hooks

สำหรับ `newSession`, `fork` และ `switchSession`:

- Before event: `session_before_switch`
  - reasons: `new`, `fork`, `resume`
  - ยกเลิกได้โดยส่งคืน `{ cancel: true }`
- After event: `session_switch`
  - ชุด reason เดียวกัน
  - รวมถึง `previousSessionFile`

`ExtensionRunner.emit()` ส่งคืนก่อนเมื่อพบผลลัพธ์ before-event ที่ยกเลิกเป็นรายการแรก

### พฤติกรรม `onSession` ของ custom tool

SDK bridge เชื่อม extension session events ไปยัง callback `onSession` ของ custom tool:

- `session_switch` -> `onSession({ reason: "switch", previousSessionFile })`
- `session_branch` -> `reason: "branch"`
- `session_start` -> `reason: "start"`
- `session_tree` -> `reason: "tree"`
- `session_shutdown` -> `reason: "shutdown"`

Callback เหล่านี้เป็นแบบสังเกตการณ์; ไม่สามารถยกเลิก switch/fork ได้

### พื้นผิวการยกเลิกอื่นที่เกี่ยวข้องกับเอกสารนี้

- `/fork` ถูกบล็อกขณะ streaming (ผู้ใช้ต้องรอ/ยกเลิกการตอบกลับปัจจุบันก่อน)
- ตัวเลือก `/resume` สามารถยกเลิกได้โดยผู้ใช้ปิดตัวเลือก
- `--resume <id>` ข้ามโปรเจกต์สามารถยกเลิกได้โดยปฏิเสธ fork prompt
- `/share` มีเส้นทาง UI abort (`Share cancelled`) สำหรับ gist flow; ไม่ได้ต่อสาย process-kill semantics สำหรับ `gh gist create` ในเส้นทางโค้ดนี้

## พฤติกรรมเซสชันแบบ non-persistent (ในหน่วยความจำ)

เมื่อ session manager ถูกสร้างด้วย `SessionManager.inMemory()` (`--no-session`):

- เส้นทางไฟล์เซสชันไม่มี
- `/export` และ `/share` ล้มเหลวพร้อม `Cannot export in-memory session to HTML` (ส่งต่อไปยัง command error UI)
- `/fork` ล้มเหลวเพราะ `SessionManager.fork()` ต้องการ persistence
- `/dump` ยังคงทำงานได้เพราะ serialize agent state ในหน่วยความจำ
- ความหมาย CLI resume/continue จะถูกข้ามหากตั้ง `--no-session` เพราะการสร้าง manager ส่งคืนแบบ in-memory ทันที

## ข้อจำกัดของ implementation ที่ทราบ (ณ โค้ดปัจจุบัน)

- `SelectorController.handleResumeSession()` ไม่ตรวจสอบผลลัพธ์ boolean จาก `session.switchSession(...)`; การ switch ที่ถูกยกเลิกโดย hook ยังคงสามารถดำเนินผ่านเส้นทาง UI repaint/status "Resumed session" ได้
- ความล้มเหลวของ custom-share ใน `/share` ไม่ลดระดับไปยัง gist fallback เริ่มต้น; จะหยุดคำสั่งพร้อมข้อผิดพลาด
- การแยกอาร์กิวเมนต์ของ `/export` เป็นแบบง่ายและไม่รักษาเส้นทางที่ใส่เครื่องหมายคำพูดซึ่งมีช่องว่าง
