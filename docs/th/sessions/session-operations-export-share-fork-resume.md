---
title: 'การดำเนินการเซสชัน: Export, Dump, Share, Fork, Resume'
description: การดำเนินการเซสชันสำหรับการส่งออก แชร์ แยก และกลับมาใช้งานการสนทนา
sidebar:
  order: 3
  label: การดำเนินการ
i18n:
  sourceHash: e3c210b29c3e
  translator: machine
---

# การดำเนินการเซสชัน: export, dump, share, fork, resume/continue

เอกสารนี้อธิบายพฤติกรรมที่มองเห็นได้จากผู้ดำเนินการสำหรับการดำเนินการ export/share/fork/resume ของเซสชันตามที่ปัจจุบันได้ใช้งาน

## ไฟล์การใช้งาน

- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/export/html/index.ts`](../../packages/coding-agent/src/export/html/index.ts)
- [`../src/export/custom-share.ts`](../../packages/coding-agent/src/export/custom-share.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)

## เมทริกซ์การดำเนินการ

| การดำเนินการ | เส้นทางเข้า | การเปลี่ยนแปลงเซสชัน | การสร้าง/สลับไฟล์เซสชัน | อาร์ติแฟกต์เอาต์พุต |
|---|---|---|---|---|
| `/dump` | คำสั่ง slash แบบโต้ตอบ | ไม่ | ไม่ | ข้อความคลิปบอร์ด |
| `/export [path]` | คำสั่ง slash แบบโต้ตอบ | ไม่ | ไม่ | ไฟล์ HTML |
| `--export <session.jsonl> [outputPath]` | เส้นทางเร็วเมื่อเริ่มต้น CLI | ไม่มีการเปลี่ยนแปลงเซสชัน runtime | ไม่มีเซสชันที่ใช้งาน; อ่านไฟล์เป้าหมาย | ไฟล์ HTML |
| `/share` | คำสั่ง slash แบบโต้ตอบ | ไม่ | ไม่ | HTML ชั่วคราว + URL แชร์/gist |
| `/fork` | คำสั่ง slash แบบโต้ตอบ | ใช่ (เอกลักษณ์เซสชันที่ใช้งานเปลี่ยนแปลง) | สร้างไฟล์เซสชันใหม่และสลับเซสชันปัจจุบันไปยังไฟล์นั้น (เฉพาะโหมดถาวรเท่านั้น) | คัดลอกไดเรกทอรีอาร์ติแฟกต์ไปยัง namespace เซสชันใหม่เมื่อมีอยู่ |
| `/resume` | คำสั่ง slash แบบโต้ตอบ | ใช่ (สถานะในหน่วยความจำที่ใช้งานถูกแทนที่) | สลับไปยังไฟล์เซสชันที่มีอยู่ที่เลือก | ไม่มี |
| `--resume` | การเริ่มต้น CLI (ตัวเลือก) | ใช่ หลังจากสร้างเซสชัน | เปิดไฟล์เซสชันที่มีอยู่ที่เลือก | ไม่มี |
| `--resume <id\|path>` | การเริ่มต้น CLI | ใช่ หลังจากสร้างเซสชัน | เปิดเซสชันที่มีอยู่; กรณีข้ามโปรเจกต์สามารถ fork ไปยังโปรเจกต์ปัจจุบันได้ | ไม่มี |
| `--continue` | การเริ่มต้น CLI | ใช่ หลังจากสร้างเซสชัน | เปิด breadcrumb เทอร์มินัลหรือเซสชันล่าสุด; สร้างใหม่หากไม่มี | ไม่มี |

## Export และ dump

### `/export [outputPath]` (แบบโต้ตอบ)

ขั้นตอน:

1. `InputController` กำหนดเส้นทาง `/export...` ไปยัง `CommandController.handleExportCommand`
2. คำสั่งแบ่งตามช่องว่างและใช้เฉพาะอาร์กิวเมนต์แรกหลัง `/export` เป็น `outputPath`
3. `AgentSession.exportToHtml()` เรียก `exportSessionToHtml(sessionManager, state, { outputPath, themeName })`
4. เมื่อสำเร็จ UI แสดงเส้นทางและเปิดไฟล์ในเบราว์เซอร์

รายละเอียดพฤติกรรม:

- อาร์กิวเมนต์ `--copy`, `clipboard` และ `copy` จะถูกปฏิเสธอย่างชัดเจนพร้อมคำเตือนให้ใช้ `/dump`
- Export ฝัง header/รายการ/leaf ของเซสชัน รวมถึง `systemPrompt` ปัจจุบันและคำอธิบายเครื่องมือจากสถานะ agent
- ไม่มีรายการเซสชันถูกเพิ่มในระหว่าง export

ข้อควรระวัง:

- การแยกวิเคราะห์อาร์กิวเมนต์ใช้ช่องว่างเป็นฐาน (`text.split(/\s+/)`) ดังนั้นเส้นทางที่มีอ้างอิงที่มีช่องว่างจะไม่ถูกรักษาเป็นเส้นทางเดียวโดยเส้นทางคำสั่งนี้

### `--export <inputSessionFile> [outputPath]` (CLI)

ขั้นตอนใน `main.ts`:

1. จัดการตั้งแต่ต้น (ก่อนการเริ่มต้นแบบโต้ตอบ/เซสชัน)
2. เรียก `exportFromFile(inputPath, outputPath?)`
3. `SessionManager.open(inputPath)` โหลดรายการ จากนั้น HTML ถูกสร้างและเขียน
4. กระบวนการพิมพ์ `Exported to: ...` และออก

รายละเอียดพฤติกรรม:

- ไฟล์อินพุตที่หายไปจะแสดงเป็น `File not found: <path>`
- เส้นทางนี้ไม่สร้าง `AgentSession` และไม่เปลี่ยนแปลงเซสชันที่กำลังทำงานอยู่

### `/dump` (export คลิปบอร์ดแบบโต้ตอบ)

ขั้นตอน:

1. `CommandController.handleDumpCommand()` เรียก `session.formatSessionAsText()`
2. หากเป็นสตริงว่าง รายงาน `No messages to dump yet.`
3. มิฉะนั้นคัดลอกไปยังคลิปบอร์ดผ่าน `copyToClipboard` ของระบบปฏิบัติการ

เนื้อหา dump รวมถึง:

- System prompt
- โมเดลที่ใช้งาน/ระดับการคิด
- คำนิยามเครื่องมือ + พารามิเตอร์
- ข้อความผู้ใช้/ผู้ช่วย
- บล็อกการคิดและการเรียกเครื่องมือ
- ผลลัพธ์เครื่องมือและบล็อกการประมวลผล (ยกเว้นรายการ bash/python ที่มี `excludeFromContext`)
- รายการ custom/hook/file mention/branch summary/compaction summary

การ dump ไม่ทำให้เกิดการเปลี่ยนแปลงการบันทึกเซสชัน

## Share

`/share` ใช้งานได้เฉพาะแบบโต้ตอบและเริ่มต้นด้วยการ export เซสชันปัจจุบันไปยังไฟล์ HTML ชั่วคราวเสมอ

### ระยะที่ 1: export ชั่วคราว

- เส้นทางไฟล์ชั่วคราว: `${os.tmpdir()}/${Snowflake.next()}.html`
- ใช้ `session.exportToHtml(tmpFile)`
- หาก export ล้มเหลว (โดยเฉพาะเซสชันในหน่วยความจำ) การแชร์จะสิ้นสุดพร้อมข้อผิดพลาด

### ระยะที่ 2: ตัวจัดการแชร์แบบกำหนดเอง (หากมี)

`loadCustomShare()` ตรวจสอบ `~/.xcsh/agent` สำหรับผู้สมัครที่มีอยู่เป็นอันดับแรก:

- `share.ts`
- `share.js`
- `share.mjs`

ข้อกำหนด:

- โมดูลต้องส่งออกค่าเริ่มต้นเป็นฟังก์ชัน `(htmlPath) => Promise<CustomShareResult | string | undefined>`

หากมีและถูกต้อง:

- UI เข้าสู่สถานะโหลด `Sharing...`
- การตีความผลลัพธ์ตัวจัดการ:
  - string => ถือว่าเป็น URL แสดงและเปิด
  - object => แสดง `url` และ/หรือ `message`; เปิด `url`
  - `undefined`/falsy => แสดง `Session shared` ทั่วไป
- ไฟล์ชั่วคราวจะถูกลบหลังจากเสร็จสิ้น

พฤติกรรม fallback ที่สำคัญ:

- หากตัวจัดการแบบกำหนดเองมีอยู่แต่การโหลดล้มเหลว คำสั่งจะเกิดข้อผิดพลาดและส่งคืน
- หากตัวจัดการแบบกำหนดเองดำเนินการและโยนข้อยกเว้น คำสั่งจะเกิดข้อผิดพลาดและส่งคืน
- ในทั้งสองกรณีที่ล้มเหลว จะ**ไม่** fallback ไปยัง GitHub gist
- Gist fallback เกิดขึ้นเฉพาะเมื่อไม่มีสคริปต์แชร์แบบกำหนดเองเท่านั้น

### ระยะที่ 3: gist fallback เริ่มต้น

เฉพาะเมื่อไม่พบตัวจัดการแชร์แบบกำหนดเอง:

1. ตรวจสอบ `gh auth status`
2. แสดงโหลด `Creating gist...`
3. รัน `gh gist create --public=false <tmpFile>`
4. แยกวิเคราะห์ URL gist ดึง gist id สร้าง URL ตัวอย่าง `https://gistpreview.github.io/?<id>`
5. แสดงทั้ง URL ตัวอย่างและ URL gist; เปิดตัวอย่าง

ความหมายของการยกเลิก/ยุติในการแชร์:

- โหลดมี hook `onAbort` ที่คืนค่า UI ของตัวแก้ไขและรายงาน `Share cancelled`
- คำสั่ง `gh gist create` ที่กำลังทำงานอยู่จะไม่ถูกส่งสัญญาณยุติในเส้นทางโค้ดนี้ การยกเลิกเป็นระดับ UI และตรวจสอบหลังจากคำสั่งส่งคืน

## Fork

`/fork` สร้างเซสชันใหม่จากเซสชันปัจจุบันและสลับเอกลักษณ์เซสชันที่ใช้งาน

### เงื่อนไขเบื้องต้นและการป้องกันทันที

- หาก agent กำลัง streaming `/fork` จะถูกปฏิเสธพร้อมคำเตือน
- ตัวบ่งชี้สถานะ/การโหลด UI จะถูกล้างก่อนการดำเนินการ

### ขั้นตอนระดับเซสชัน

`AgentSession.fork()`:

1. ส่ง `session_before_switch` พร้อม `reason: "fork"` (สามารถยกเลิกได้)
2. flush การเขียนที่รอดำเนินการ
3. เรียก `SessionManager.fork()`
4. คัดลอกไดเรกทอรีอาร์ติแฟกต์จาก namespace เซสชันเก่าไปยัง namespace ใหม่ (ความพยายามที่ดีที่สุด; ความล้มเหลวในการคัดลอกที่ไม่ใช่ ENOENT จะถูกบันทึก ไม่ร้ายแรง)
5. อัปเดต `agent.sessionId`
6. ส่ง `session_switch` พร้อม `reason: "fork"`

พฤติกรรมของ `SessionManager.fork()`:

- ต้องการโหมดถาวรและไฟล์เซสชันที่มีอยู่
- สร้าง session id ใหม่และเส้นทางไฟล์ JSONL ใหม่
- เขียน header ใหม่ด้วย:
  - `id` ใหม่
  - timestamp ใหม่
  - `cwd` ไม่เปลี่ยนแปลง
  - `parentSession` ตั้งค่าเป็น session id ก่อนหน้า
- เก็บรายการที่ไม่ใช่ header ทั้งหมดไว้ไม่เปลี่ยนแปลงในไฟล์ใหม่

### พฤติกรรมที่ไม่ถาวร

- session manager ในหน่วยความจำส่งคืน `undefined` จาก `fork()`
- `AgentSession.fork()` ส่งคืน `false`
- UI รายงาน `Fork failed (session not persisted or cancelled)`

## Resume และ continue

## `/resume` แบบโต้ตอบ

ขั้นตอน:

1. เปิดตัวเลือกเซสชันที่ป้อนข้อมูลผ่าน `SessionManager.list(currentCwd, currentSessionDir)`
2. เมื่อเลือก `SelectorController.handleResumeSession(sessionPath)` เรียก `session.switchSession(sessionPath)`
3. UI ล้าง/สร้างใหม่ chat และ todos จากนั้นรายงาน `Resumed session`

หมายเหตุ:

- ตัวเลือกนี้แสดงเฉพาะเซสชันในขอบเขตไดเรกทอรีเซสชันปัจจุบัน
- ไม่ใช้การค้นหาข้ามโปรเจกต์แบบทั่วโลก

## CLI `--resume`

### `--resume` (ไม่มีค่า)

- `main.ts` แสดงรายการเซสชันสำหรับ cwd/sessionDir ปัจจุบันและเปิดตัวเลือก
- เส้นทางที่เลือกจะถูกเปิดด้วย `SessionManager.open(selectedPath)` ก่อนสร้างเซสชัน

### `--resume <value>`

ลำดับการแก้ไขของ `createSessionManager()`:

1. หากค่าดูเหมือนเส้นทาง (`/`, `\` หรือ `.jsonl`) เปิดโดยตรง
2. มิฉะนั้น ถือว่าเป็นคำนำหน้า id:
   - ค้นหาขอบเขตปัจจุบัน (`SessionManager.list(cwd, sessionDir)`)
   - หากไม่พบและไม่มี `sessionDir` ที่ชัดเจน ค้นหาแบบทั่วโลก (`SessionManager.listAll()`)

พฤติกรรมการจับคู่ id ข้ามโปรเจกต์:

- หาก cwd ของเซสชันที่จับคู่แตกต่างจาก cwd ปัจจุบัน CLI จะถาม:
  - `Session found in different project ... Fork into current directory? [y/N]`
- เมื่อตอบใช่: `SessionManager.forkFrom(match.path, cwd, sessionDir)` สร้างไฟล์ fork ในเครื่องใหม่
- เมื่อปฏิเสธ/ค่าเริ่มต้นที่ไม่ใช่ TTY: คำสั่งเกิดข้อผิดพลาด

## CLI `--continue`

`SessionManager.continueRecent(cwd, sessionDir)`:

1. แก้ไขไดเรกทอรีเซสชันสำหรับ cwd ปัจจุบัน
2. อ่าน breadcrumb ที่กำหนดขอบเขตเทอร์มินัลก่อน
3. fallback ไปยังไฟล์เซสชันที่แก้ไขล่าสุด
4. เปิดเซสชันที่พบ; หากไม่มีอยู่ สร้างเซสชันใหม่

นี่เป็นพฤติกรรมเฉพาะการเริ่มต้นเท่านั้น ไม่มีคำสั่ง slash `/continue` แบบโต้ตอบ

## วิธีที่การสลับเซสชันเปลี่ยนแปลงสถานะ runtime จริงๆ

`AgentSession.switchSession(sessionPath)` ทำการเปลี่ยนแปลง runtime ที่ใช้โดยการดำเนินการคล้าย resume:

1. ส่ง `session_before_switch` พร้อม `reason: "resume"` และ `targetSessionFile` (สามารถยกเลิกได้)
2. ยกเลิกการสมัครสมาชิก event ของ agent และยุติงานที่กำลังดำเนินการ
3. ล้างข้อความ steering/follow-up/next-turn ที่อยู่ในคิว
4. flush การเขียน session manager ปัจจุบัน
5. `sessionManager.setSessionFile(sessionPath)` และอัปเดต `agent.sessionId`
6. สร้างบริบทเซสชันจากรายการที่โหลด
7. ส่ง `session_switch` พร้อม `reason: "resume"`
8. แทนที่ข้อความ agent จากบริบท
9. คืนค่าโมเดล (หากมีอยู่ใน registry ปัจจุบัน)
10. คืนค่าหรือเริ่มต้นระดับการคิด
11. เชื่อมต่อการสมัครสมาชิก event ของ agent ใหม่

`switchSession()` เองไม่สร้างไฟล์เซสชันใหม่

## การส่ง event และจุดยกเลิก

### hooks วงจรชีวิตการสลับ/fork

สำหรับ `newSession`, `fork` และ `switchSession`:

- event ก่อน: `session_before_switch`
  - เหตุผล: `new`, `fork`, `resume`
  - สามารถยกเลิกได้โดยส่งคืน `{ cancel: true }`
- event หลัง: `session_switch`
  - ชุดเหตุผลเดียวกัน
  - รวมถึง `previousSessionFile`

`ExtensionRunner.emit()` ส่งคืนก่อนจากผลลัพธ์ event ก่อนที่ยกเลิกเป็นอันดับแรก

### พฤติกรรม `onSession` ของเครื่องมือแบบกำหนดเอง

SDK เชื่อม event เซสชัน extension ไปยัง callback `onSession` ของเครื่องมือแบบกำหนดเอง:

- `session_switch` -> `onSession({ reason: "switch", previousSessionFile })`
- `session_branch` -> `reason: "branch"`
- `session_start` -> `reason: "start"`
- `session_tree` -> `reason: "tree"`
- `session_shutdown` -> `reason: "shutdown"`

callback เหล่านี้เป็นการสังเกตการณ์เท่านั้น ไม่ยกเลิกการสลับ/fork

### พื้นผิวการยกเลิกอื่นๆ ที่เกี่ยวข้องกับเอกสารนี้

- `/fork` ถูกบล็อกขณะ streaming (ผู้ใช้ต้องรอ/ยุติการตอบสนองปัจจุบันก่อน)
- ตัวเลือก `/resume` สามารถยกเลิกได้โดยผู้ใช้ปิดตัวเลือก
- `--resume <id>` ข้ามโปรเจกต์สามารถยกเลิกได้โดยปฏิเสธ prompt fork
- `/share` มีเส้นทางยุติ UI (`Share cancelled`) สำหรับ gist flow ไม่เชื่อมต่อ semantics การ kill กระบวนการสำหรับ `gh gist create` ในเส้นทางโค้ดนี้

## พฤติกรรมเซสชันที่ไม่ถาวร (ในหน่วยความจำ)

เมื่อ session manager ถูกสร้างด้วย `SessionManager.inMemory()` (`--no-session`):

- เส้นทางไฟล์เซสชันไม่มี
- `/export` และ `/share` ล้มเหลวด้วย `Cannot export in-memory session to HTML` (ส่งต่อไปยัง UI ข้อผิดพลาดคำสั่ง)
- `/fork` ล้มเหลวเพราะ `SessionManager.fork()` ต้องการความถาวร
- `/dump` ยังคงทำงานได้เพราะ serialize สถานะ agent ในหน่วยความจำ
- Semantics resume/continue ของ CLI จะถูกข้ามหาก `--no-session` ถูกตั้งค่า เพราะการสร้าง manager ส่งคืนในหน่วยความจำทันที

## ข้อควรระวังการใช้งานที่ทราบ (ณ โค้ดปัจจุบัน)

- `SelectorController.handleResumeSession()` ไม่ตรวจสอบผลลัพธ์บูลีนจาก `session.switchSession(...)` การสลับที่ถูกยกเลิกด้วย hook ยังคงดำเนินต่อผ่านเส้นทาง repaint/status "Resumed session" ของ UI ได้
- ความล้มเหลวของ custom-share ใน `/share` ไม่ลดระดับไปยัง gist fallback เริ่มต้น แต่จะยุติคำสั่งพร้อมข้อผิดพลาด
- การ tokenize อาร์กิวเมนต์ของ `/export` เป็นแบบง่ายและไม่รักษาเส้นทางที่อ้างอิงซึ่งมีช่องว่าง
