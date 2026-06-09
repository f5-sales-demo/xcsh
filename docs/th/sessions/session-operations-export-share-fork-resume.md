---
title: 'การดำเนินการเซสชัน: ส่งออก, ดัมพ์, แชร์, แยก, กลับมาทำงานต่อ'
description: การดำเนินการเซสชันสำหรับการส่งออก แชร์ แยก และกลับมาทำงานต่อของการสนทนา
sidebar:
  order: 3
  label: การดำเนินการ
i18n:
  sourceHash: e3c210b29c3e
  translator: machine
---

# การดำเนินการเซสชัน: export, dump, share, fork, resume/continue

เอกสารนี้อธิบายพฤติกรรมที่ผู้ดำเนินการมองเห็นได้สำหรับการดำเนินการ export/share/fork/resume ของเซสชันตามที่ถูกนำไปใช้งานในปัจจุบัน

## ไฟล์การนำไปใช้งาน

- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/export/html/index.ts`](../../packages/coding-agent/src/export/html/index.ts)
- [`../src/export/custom-share.ts`](../../packages/coding-agent/src/export/custom-share.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)

## ตารางการดำเนินการ

| การดำเนินการ | เส้นทางเข้า | การเปลี่ยนแปลงเซสชัน | การสร้าง/สลับไฟล์เซสชัน | สิ่งที่สร้างขึ้น |
|---|---|---|---|---|
| `/dump` | คำสั่ง slash แบบโต้ตอบ | ไม่ | ไม่ | ข้อความในคลิปบอร์ด |
| `/export [path]` | คำสั่ง slash แบบโต้ตอบ | ไม่ | ไม่ | ไฟล์ HTML |
| `--export <session.jsonl> [outputPath]` | เส้นทางลัด CLI ตอนเริ่มต้น | ไม่มีการเปลี่ยนแปลงเซสชันขณะทำงาน | ไม่มีเซสชันที่ใช้งานอยู่; อ่านไฟล์เป้าหมาย | ไฟล์ HTML |
| `/share` | คำสั่ง slash แบบโต้ตอบ | ไม่ | ไม่ | HTML ชั่วคราว + URL แชร์/gist |
| `/fork` | คำสั่ง slash แบบโต้ตอบ | ใช่ (ตัวตนของเซสชันที่ใช้งานอยู่เปลี่ยนแปลง) | สร้างไฟล์เซสชันใหม่และสลับเซสชันปัจจุบันไปยังไฟล์นั้น (เฉพาะโหมดถาวรเท่านั้น) | คัดลอกไดเรกทอรี artifact ไปยังเนมสเปซเซสชันใหม่เมื่อมีอยู่ |
| `/resume` | คำสั่ง slash แบบโต้ตอบ | ใช่ (สถานะในหน่วยความจำถูกแทนที่) | สลับไปยังไฟล์เซสชันที่มีอยู่ที่เลือก | ไม่มี |
| `--resume` | CLI ตอนเริ่มต้น (ตัวเลือก) | ใช่ หลังการสร้างเซสชัน | เปิดไฟล์เซสชันที่มีอยู่ที่เลือก | ไม่มี |
| `--resume <id\|path>` | CLI ตอนเริ่มต้น | ใช่ หลังการสร้างเซสชัน | เปิดเซสชันที่มีอยู่; กรณีข้ามโปรเจกต์สามารถแยกเข้าโปรเจกต์ปัจจุบันได้ | ไม่มี |
| `--continue` | CLI ตอนเริ่มต้น | ใช่ หลังการสร้างเซสชัน | เปิด breadcrumb ของเทอร์มินัลหรือเซสชันล่าสุด; สร้างใหม่หากไม่มี | ไม่มี |

## การส่งออกและดัมพ์

### `/export [outputPath]` (แบบโต้ตอบ)

ขั้นตอน:

1. `InputController` ส่ง `/export...` ไปยัง `CommandController.handleExportCommand`
2. คำสั่งแยกด้วยช่องว่างและใช้เฉพาะอาร์กิวเมนต์แรกหลัง `/export` เป็น `outputPath`
3. `AgentSession.exportToHtml()` เรียก `exportSessionToHtml(sessionManager, state, { outputPath, themeName })`
4. เมื่อสำเร็จ UI จะแสดงเส้นทางและเปิดไฟล์ในเบราว์เซอร์

รายละเอียดพฤติกรรม:

- อาร์กิวเมนต์ `--copy`, `clipboard` และ `copy` จะถูกปฏิเสธอย่างชัดเจนพร้อมคำเตือนให้ใช้ `/dump`
- การส่งออกจะฝัง header/entries/leaf ของเซสชัน รวมถึง `systemPrompt` ปัจจุบันและคำอธิบายเครื่องมือจากสถานะ agent
- ไม่มีรายการเซสชันที่ถูกเพิ่มระหว่างการส่งออก

ข้อควรระวัง:

- การแยกอาร์กิวเมนต์ใช้ช่องว่าง (`text.split(/\s+/)`) ดังนั้นเส้นทางที่มีเครื่องหมายอัญประกาศและมีช่องว่างจะไม่ถูกรักษาเป็นเส้นทางเดียวโดยเส้นทางคำสั่งนี้

### `--export <inputSessionFile> [outputPath]` (CLI)

ขั้นตอนใน `main.ts`:

1. จัดการตั้งแต่ต้น (ก่อนการเริ่มต้นแบบโต้ตอบ/เซสชัน)
2. เรียก `exportFromFile(inputPath, outputPath?)`
3. `SessionManager.open(inputPath)` โหลดรายการ จากนั้น HTML จะถูกสร้างและเขียน
4. โปรเซสแสดง `Exported to: ...` และออก

รายละเอียดพฤติกรรม:

- ไฟล์อินพุตที่หายไปจะแสดงเป็น `File not found: <path>`
- เส้นทางนี้ไม่สร้าง `AgentSession` และไม่เปลี่ยนแปลงเซสชันที่กำลังทำงานอยู่

### `/dump` (ส่งออกแบบโต้ตอบไปยังคลิปบอร์ด)

ขั้นตอน:

1. `CommandController.handleDumpCommand()` เรียก `session.formatSessionAsText()`
2. หากเป็นสตริงว่าง จะรายงาน `No messages to dump yet.`
3. มิฉะนั้นจะคัดลอกไปยังคลิปบอร์ดผ่าน `copyToClipboard` ดั้งเดิม

เนื้อหาที่ดัมพ์ประกอบด้วย:

- System prompt
- โมเดลที่ใช้งานอยู่/ระดับการคิด
- คำจำกัดความเครื่องมือ + พารามิเตอร์
- ข้อความ user/assistant
- บล็อกการคิดและ tool calls
- ผลลัพธ์เครื่องมือและบล็อกการดำเนินการ (ยกเว้นรายการ bash/python ที่ `excludeFromContext`)
- รายการ custom/hook/file mention/branch summary/compaction summary

ไม่มีการเปลี่ยนแปลงการบันทึกเซสชันใดๆ จากการดัมพ์

## การแชร์

`/share` ใช้ได้เฉพาะแบบโต้ตอบเท่านั้น และจะเริ่มต้นด้วยการส่งออกเซสชันปัจจุบันไปยังไฟล์ HTML ชั่วคราวเสมอ

### ระยะที่ 1: การส่งออกชั่วคราว

- เส้นทางไฟล์ชั่วคราว: `${os.tmpdir()}/${Snowflake.next()}.html`
- ใช้ `session.exportToHtml(tmpFile)`
- หากการส่งออกล้มเหลว (โดยเฉพาะเซสชันในหน่วยความจำ) การแชร์จะจบด้วยข้อผิดพลาด

### ระยะที่ 2: ตัวจัดการแชร์แบบกำหนดเอง (ถ้ามี)

`loadCustomShare()` ตรวจสอบ `~/.xcsh/agent` สำหรับตัวเลือกแรกที่มีอยู่:

- `share.ts`
- `share.js`
- `share.mjs`

ข้อกำหนด:

- โมดูลต้อง default-export ฟังก์ชัน `(htmlPath) => Promise<CustomShareResult | string | undefined>`

หากมีและถูกต้อง:

- UI เข้าสู่สถานะโหลด `Sharing...`
- การตีความผลลัพธ์ของตัวจัดการ:
  - string => ถือเป็น URL แสดงและเปิด
  - object => แสดง `url` และ/หรือ `message`; เปิด `url`
  - `undefined`/falsy => `Session shared` ทั่วไป
- ไฟล์ชั่วคราวจะถูกลบหลังเสร็จสิ้น

พฤติกรรมสำรองที่สำคัญ:

- หากตัวจัดการแบบกำหนดเองมีอยู่แต่การโหลดล้มเหลว คำสั่งจะแสดงข้อผิดพลาดและส่งกลับ
- หากตัวจัดการแบบกำหนดเองดำเนินการและ throw ข้อผิดพลาด คำสั่งจะแสดงข้อผิดพลาดและส่งกลับ
- ในทั้งสองกรณีที่ล้มเหลว จะ **ไม่** ย้อนกลับไปใช้ GitHub gist
- การย้อนกลับไปใช้ gist จะเกิดขึ้นเฉพาะเมื่อไม่มีสคริปต์แชร์แบบกำหนดเองเท่านั้น

### ระยะที่ 3: การย้อนกลับไปใช้ gist เริ่มต้น

เฉพาะเมื่อไม่พบตัวจัดการแชร์แบบกำหนดเอง:

1. ตรวจสอบ `gh auth status`
2. แสดงตัวโหลด `Creating gist...`
3. รัน `gh gist create --public=false <tmpFile>`
4. แยก URL ของ gist, สร้าง gist id, สร้าง URL ดูตัวอย่าง `https://gistpreview.github.io/?<id>`
5. แสดงทั้ง URL ดูตัวอย่างและ URL ของ gist; เปิดหน้าดูตัวอย่าง

การยกเลิก/ยกเลิกในการแชร์:

- ตัวโหลดมี hook `onAbort` ที่คืนค่า UI ของ editor และรายงาน `Share cancelled`
- คำสั่ง `gh gist create` ที่อยู่เบื้องหลังไม่ถูกส่งสัญญาณ abort ในเส้นทางโค้ดนี้; การยกเลิกเป็นระดับ UI และถูกตรวจสอบหลังจากคำสั่งส่งกลับ

## การแยก (Fork)

`/fork` สร้างเซสชันใหม่จากเซสชันปัจจุบันและสลับตัวตนของเซสชันที่ใช้งานอยู่

### เงื่อนไขเบื้องต้นและการป้องกันทันที

- หาก agent กำลังสตรีม `/fork` จะถูกปฏิเสธพร้อมคำเตือน
- ตัวชี้วัดสถานะ/การโหลดของ UI จะถูกล้างก่อนการดำเนินการ

### ขั้นตอนระดับเซสชัน

`AgentSession.fork()`:

1. ปล่อยเหตุการณ์ `session_before_switch` พร้อม `reason: "fork"` (สามารถยกเลิกได้)
2. เขียนข้อมูลที่รอดำเนินการออก
3. เรียก `SessionManager.fork()`
4. คัดลอกไดเรกทอรี artifacts จากเนมสเปซเซสชันเก่าไปยังเนมสเปซใหม่ (พยายามอย่างดีที่สุด; ข้อผิดพลาดการคัดลอกที่ไม่ใช่ ENOENT จะถูกบันทึกไว้ ไม่ร้ายแรง)
5. อัปเดต `agent.sessionId`
6. ปล่อยเหตุการณ์ `session_switch` พร้อม `reason: "fork"`

พฤติกรรมของ `SessionManager.fork()`:

- ต้องการโหมดถาวรและไฟล์เซสชันที่มีอยู่
- สร้าง session id ใหม่และเส้นทางไฟล์ JSONL ใหม่
- เขียน header ใหม่ด้วย:
  - `id` ใหม่
  - timestamp ใหม่
  - `cwd` ไม่เปลี่ยนแปลง
  - `parentSession` ตั้งเป็น session id ก่อนหน้า
- รายการที่ไม่ใช่ header ทั้งหมดไม่เปลี่ยนแปลงในไฟล์ใหม่

### พฤติกรรมแบบไม่ถาวร

- ตัวจัดการเซสชันในหน่วยความจำส่งกลับ `undefined` จาก `fork()`
- `AgentSession.fork()` ส่งกลับ `false`
- UI รายงาน `Fork failed (session not persisted or cancelled)`

## การกลับมาทำงานต่อ (Resume) และ Continue

## `/resume` แบบโต้ตอบ

ขั้นตอน:

1. เปิดตัวเลือกเซสชันที่ถูกเติมข้อมูลผ่าน `SessionManager.list(currentCwd, currentSessionDir)`
2. เมื่อเลือก `SelectorController.handleResumeSession(sessionPath)` จะเรียก `session.switchSession(sessionPath)`
3. UI ล้าง/สร้างแชทและ todos ใหม่ จากนั้นรายงาน `Resumed session`

หมายเหตุ:

- ตัวเลือกนี้แสดงรายการเซสชันเฉพาะในขอบเขตไดเรกทอรีเซสชันปัจจุบันเท่านั้น
- ไม่ใช้การค้นหาข้ามโปรเจกต์แบบทั่วไป

## CLI `--resume`

### `--resume` (ไม่มีค่า)

- `main.ts` แสดงรายการเซสชันสำหรับ cwd/sessionDir ปัจจุบันและเปิดตัวเลือก
- เส้นทางที่เลือกจะถูกเปิดด้วย `SessionManager.open(selectedPath)` ก่อนการสร้างเซสชัน

### `--resume <value>`

ลำดับการค้นหาของ `createSessionManager()`:

1. หากค่าดูเหมือนเส้นทาง (`/`, `\` หรือ `.jsonl`) เปิดโดยตรง
2. มิฉะนั้นถือเป็นคำนำหน้า id:
   - ค้นหาในขอบเขตปัจจุบัน (`SessionManager.list(cwd, sessionDir)`)
   - หากไม่พบและไม่มี `sessionDir` ที่ระบุชัดเจน ค้นหาแบบทั่วไป (`SessionManager.listAll()`)

พฤติกรรมการจับคู่ id ข้ามโปรเจกต์:

- หาก cwd ของเซสชันที่จับคู่ได้แตกต่างจาก cwd ปัจจุบัน CLI จะถาม:
  - `Session found in different project ... Fork into current directory? [y/N]`
- เมื่อตอบใช่: `SessionManager.forkFrom(match.path, cwd, sessionDir)` สร้างไฟล์แยกในเครื่องใหม่
- เมื่อตอบไม่/ค่าเริ่มต้น non-TTY: คำสั่งแสดงข้อผิดพลาด

## CLI `--continue`

`SessionManager.continueRecent(cwd, sessionDir)`:

1. ค้นหาไดเรกทอรีเซสชันสำหรับ cwd ปัจจุบัน
2. อ่าน breadcrumb ที่กำหนดขอบเขตเทอร์มินัลก่อน
3. ย้อนกลับไปใช้ไฟล์เซสชันที่แก้ไขล่าสุด
4. เปิดเซสชันที่พบ; หากไม่มี จะสร้างเซสชันใหม่

นี่เป็นพฤติกรรมตอนเริ่มต้นเท่านั้น; ไม่มีคำสั่ง slash แบบโต้ตอบ `/continue`

## วิธีที่การสลับเซสชันเปลี่ยนแปลงสถานะ runtime จริง

`AgentSession.switchSession(sessionPath)` ทำการเปลี่ยนผ่าน runtime ที่ใช้โดยการดำเนินการแบบ resume:

1. ปล่อยเหตุการณ์ `session_before_switch` พร้อม `reason: "resume"` และ `targetSessionFile` (สามารถยกเลิกได้)
2. ยกเลิกการเชื่อมต่อ event subscription ของ agent และยกเลิกงานที่กำลังดำเนินอยู่
3. ล้างข้อความ steering/follow-up/next-turn ที่อยู่ในคิว
4. เขียนข้อมูลที่รอดำเนินการของ session manager ปัจจุบันออก
5. `sessionManager.setSessionFile(sessionPath)` และอัปเดต `agent.sessionId`
6. สร้าง session context จากรายการที่โหลด
7. ปล่อยเหตุการณ์ `session_switch` พร้อม `reason: "resume"`
8. แทนที่ข้อความ agent จาก context
9. คืนค่าโมเดล (หากมีอยู่ใน registry ปัจจุบัน)
10. คืนค่าหรือเริ่มต้นระดับการคิด
11. เชื่อมต่อ event subscription ของ agent อีกครั้ง

`switchSession()` เองไม่สร้างไฟล์เซสชันใหม่

## การปล่อยเหตุการณ์และจุดยกเลิก

### Hook วงจรชีวิตการสลับ/แยก

สำหรับ `newSession`, `fork` และ `switchSession`:

- เหตุการณ์ก่อน: `session_before_switch`
  - เหตุผล: `new`, `fork`, `resume`
  - สามารถยกเลิกได้โดยส่งกลับ `{ cancel: true }`
- เหตุการณ์หลัง: `session_switch`
  - ชุดเหตุผลเดียวกัน
  - รวม `previousSessionFile`

`ExtensionRunner.emit()` ส่งกลับทันทีเมื่อได้ผลลัพธ์เหตุการณ์ before ที่ยกเลิกเป็นรายการแรก

### พฤติกรรม `onSession` ของเครื่องมือแบบกำหนดเอง

SDK เชื่อมต่อเหตุการณ์เซสชันของ extension ไปยัง callback `onSession` ของเครื่องมือแบบกำหนดเอง:

- `session_switch` -> `onSession({ reason: "switch", previousSessionFile })`
- `session_branch` -> `reason: "branch"`
- `session_start` -> `reason: "start"`
- `session_tree` -> `reason: "tree"`
- `session_shutdown` -> `reason: "shutdown"`

callback เหล่านี้เป็นเพียงการสังเกตการณ์; ไม่สามารถยกเลิกการสลับ/แยกได้

### พื้นผิวการยกเลิกอื่นๆ ที่เกี่ยวข้องกับเอกสารนี้

- `/fork` ถูกบล็อกขณะสตรีม (ผู้ใช้ต้องรอ/ยกเลิกการตอบกลับปัจจุบันก่อน)
- ตัวเลือก `/resume` สามารถยกเลิกได้โดยผู้ใช้ปิดตัวเลือก
- `--resume <id>` ข้ามโปรเจกต์สามารถยกเลิกได้โดยปฏิเสธ prompt การแยก
- `/share` มีเส้นทางยกเลิก UI (`Share cancelled`) สำหรับ flow ของ gist; ไม่มีการเชื่อมต่อ process-kill สำหรับ `gh gist create` ในเส้นทางโค้ดนี้

## พฤติกรรมเซสชันแบบไม่ถาวร (ในหน่วยความจำ)

เมื่อ session manager ถูกสร้างด้วย `SessionManager.inMemory()` (`--no-session`):

- เส้นทางไฟล์เซสชันไม่มี
- `/export` และ `/share` ล้มเหลวพร้อม `Cannot export in-memory session to HTML` (ส่งต่อไปยัง UI ข้อผิดพลาดของคำสั่ง)
- `/fork` ล้มเหลวเพราะ `SessionManager.fork()` ต้องการความถาวร
- `/dump` ยังทำงานได้เพราะซีเรียลไลซ์สถานะ agent ในหน่วยความจำ
- การทำงานของ resume/continue บน CLI จะถูกข้ามหากตั้ง `--no-session` เพราะการสร้าง manager จะส่งกลับแบบในหน่วยความจำทันที

## ข้อควรระวังในการนำไปใช้งานที่ทราบ (ณ โค้ดปัจจุบัน)

- `SelectorController.handleResumeSession()` ไม่ตรวจสอบผลลัพธ์ boolean จาก `session.switchSession(...)`; การสลับที่ถูกยกเลิกโดย hook ยังคงสามารถดำเนินต่อผ่านเส้นทาง UI repaint/status "Resumed session" ได้
- ความล้มเหลวของ custom-share ใน `/share` จะไม่ลดระดับไปใช้ gist เริ่มต้น; จะยุติคำสั่งพร้อมข้อผิดพลาด
- การแยกอาร์กิวเมนต์ของ `/export` เป็นแบบง่ายและไม่รักษาเส้นทางที่มีเครื่องหมายอัญประกาศและมีช่องว่าง
