---
title: การสลับเซสชันและการแสดงรายการเซสชันล่าสุด
description: กลไกการสลับเซสชันและการแสดงรายการเซสชันล่าสุดพร้อมการค้นหาและการกรอง
sidebar:
  order: 4
  label: การสลับและเซสชันล่าสุด
i18n:
  sourceHash: aae56130b508
  translator: machine
---

# การสลับเซสชันและการแสดงรายการเซสชันล่าสุด

เอกสารนี้อธิบายวิธีที่ coding-agent ค้นพบเซสชันล่าสุด แก้ไขเป้าหมาย `--resume` แสดงตัวเลือกเซสชัน และสลับเซสชันรันไทม์ที่กำลังใช้งานอยู่

เนื้อหาเน้นไปที่พฤติกรรมการใช้งานปัจจุบัน รวมถึงเส้นทางสำรองและข้อควรระวังต่างๆ

## ไฟล์การใช้งาน

- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/cli/session-picker.ts`](../../packages/coding-agent/src/cli/session-picker.ts)
- [`../src/modes/components/session-selector.ts`](../../packages/coding-agent/src/modes/components/session-selector.ts)
- [`../src/modes/controllers/selector-controller.ts`](../../packages/coding-agent/src/modes/controllers/selector-controller.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)

## การค้นพบเซสชันล่าสุด

### ขอบเขตไดเรกทอรี

`SessionManager` จัดเก็บเซสชันภายใต้ไดเรกทอรีที่กำหนดขอบเขตตาม cwd โดยค่าเริ่มต้น:

- `~/.xcsh/agent/sessions/--<cwd-encoded>--/*.jsonl`

`SessionManager.list(cwd, sessionDir?)` อ่านเฉพาะไดเรกทอรีนั้น เว้นแต่จะมีการระบุ `sessionDir` อย่างชัดเจน

### สองเส้นทางการแสดงรายการที่มีข้อมูลต่างกัน

มีสองไปป์ไลน์การแสดงรายการที่แตกต่างกัน:

1. `getRecentSessions(sessionDir, limit)` (มุมมองต้อนรับ/สรุป)
   - อ่านเฉพาะส่วนนำขนาด 4KB (`readTextPrefix(..., 4096)`) จากแต่ละไฟล์
   - แยกวิเคราะห์ส่วนหัวและข้อความแสดงตัวอย่างของผู้ใช้ในช่วงต้น
   - คืนค่า `RecentSessionInfo` แบบเบาพร้อม getter แบบ lazy สำหรับ `name` และ `timeAgo`
   - เรียงลำดับตาม `mtime` ของไฟล์จากมากไปน้อย

2. `SessionManager.list(...)` / `SessionManager.listAll()` (ตัวเลือกสำหรับ resume และการจับคู่ ID)
   - อ่านไฟล์เซสชันทั้งหมด
   - สร้างออบเจ็กต์ `SessionInfo` (`id`, `cwd`, `title`, `messageCount`, `firstMessage`, `allMessagesText`, timestamps)
   - ตัดทิ้งเซสชันที่มีรายการ `message` เป็นศูนย์
   - เรียงลำดับตาม `modified` จากมากไปน้อย

### พฤติกรรมสำรองของข้อมูลเมตา

สำหรับสรุปล่าสุด (`RecentSessionInfo`):

- ลำดับความสำคัญของชื่อที่แสดง: `header.title` -> prompt แรกของผู้ใช้ -> `header.id` -> ชื่อไฟล์
- ชื่อถูกตัดให้เหลือ 40 ตัวอักษรสำหรับการแสดงผลแบบกระชับ
- อักขระควบคุมและการขึ้นบรรทัดใหม่จะถูกลบ/ทำความสะอาดจากชื่อที่ได้มาจากชื่อเรื่อง

สำหรับรายการ `SessionInfo`:

- `title` คือ `header.title` หรือ `shortSummary` จากการบีบอัดล่าสุด
- `firstMessage` คือข้อความของข้อความแรกจากผู้ใช้ หรือ `"(no messages)"`

## การแก้ไข `--continue` และการให้ความสำคัญกับ breadcrumb ของเทอร์มินัล

`SessionManager.continueRecent(cwd, sessionDir?)` แก้ไขเป้าหมายตามลำดับดังนี้:

1. อ่าน breadcrumb ที่กำหนดขอบเขตตามเทอร์มินัล (`~/.xcsh/agent/terminal-sessions/<terminal-id>`)
2. ตรวจสอบ breadcrumb:
   - สามารถระบุเทอร์มินัลปัจจุบันได้
   - cwd ของ breadcrumb ตรงกับ cwd ปัจจุบัน (เปรียบเทียบ resolved path)
   - ไฟล์ที่อ้างอิงยังคงมีอยู่
3. หาก breadcrumb ไม่ถูกต้อง/ขาดหายไป ให้ใช้ไฟล์ล่าสุดตาม mtime ในไดเรกทอรีเซสชันแทน (`findMostRecentSession`)
4. หาไม่พบ ให้สร้างเซสชันใหม่

การหา Terminal ID จะให้ความสำคัญกับเส้นทาง TTY และใช้ตัวระบุจากสภาพแวดล้อมเป็นทางเลือกสำรอง (`KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION`)

การเขียน breadcrumb เป็นการดำเนินการแบบ best-effort และไม่ทำให้เกิดข้อผิดพลาดร้ายแรง

## การแก้ไขเป้าหมาย resume ณ เวลาเริ่มต้น (`main.ts`)

### `--resume <value>`

`createSessionManager(...)` จัดการ `--resume` ที่มีค่าเป็น string ใน 2 โหมด:

1. ค่าที่มีลักษณะเป็น path (มี `/`, `\\`, หรือลงท้ายด้วย `.jsonl`)
   - เปิดโดยตรงด้วย `SessionManager.open(sessionArg, parsed.sessionDir)`

2. ค่าที่เป็น ID prefix
   - ค้นหาการจับคู่ใน `SessionManager.list(cwd, sessionDir)` โดยใช้ `id.startsWith(sessionArg)`
   - หาไม่พบในพื้นที่และไม่ได้บังคับ `sessionDir` ให้ลอง `SessionManager.listAll()`
   - ใช้การจับคู่แรกที่พบ (ไม่มีการถามยืนยันเมื่อพบหลายรายการ)

พฤติกรรมเมื่อพบการจับคู่ข้ามโปรเจกต์:

- หาก cwd ของเซสชันที่จับคู่ได้แตกต่างจาก cwd ปัจจุบัน CLI จะถามว่าต้องการ fork ไปยังโปรเจกต์ปัจจุบันหรือไม่
- ใช่ -> `SessionManager.forkFrom(...)`
- ไม่ -> โยน error (`Session "..." is in another project (...)`)

ไม่พบการจับคู่ -> โยน error (`Session "..." not found.`)

### `--resume` (ไม่มีค่า)

จัดการหลังจากการสร้าง session-manager เริ่มต้น:

1. แสดงรายการเซสชันในพื้นที่ด้วย `SessionManager.list(cwd, parsed.sessionDir)`
2. หากว่าง: แสดง `No sessions found` และออกจากโปรแกรมก่อน
3. เปิดตัวเลือก TUI (`selectSession`)
4. หากยกเลิก: แสดง `No session selected` และออกจากโปรแกรมก่อน
5. หากเลือก: `SessionManager.open(selectedPath)`

### `--continue`

ใช้ `SessionManager.continueRecent(...)` โดยตรง (พฤติกรรม breadcrumb-first ดังที่อธิบายข้างต้น)

## กลไกภายในของการเลือกผ่านตัวเลือก

## ตัวเลือก CLI (`src/cli/session-picker.ts`)

`selectSession(sessions)` สร้าง TUI แบบ standalone ด้วย `SessionSelectorComponent` และ resolve ครั้งเดียว:

- เลือก -> resolve path ที่เลือก
- ยกเลิก (Esc) -> resolve `null`
- ออกแบบบังคับ (เส้นทาง Ctrl+C) -> หยุด TUI และ `process.exit(0)`

## ตัวเลือกภายในเซสชันแบบ interactive (`SelectorController.showSessionSelector`)

ขั้นตอนการทำงาน:

1. ดึงเซสชันจากไดเรกทอรีเซสชันปัจจุบันผ่าน `SessionManager.list(currentCwd, currentSessionDir)`
2. ติดตั้ง `SessionSelectorComponent` ในพื้นที่ editor โดยใช้ `showSelector(...)`
3. callbacks:
   - เลือก -> ปิดตัวเลือกและเรียก `handleResumeSession(sessionPath)`
   - ยกเลิก -> คืนค่า editor และ rerender
   - ออก -> `ctx.shutdown()`

## พฤติกรรมของส่วนประกอบตัวเลือกเซสชัน

`SessionList` รองรับ:

- การนำทางด้วยลูกศร/หน้า
- Enter เพื่อเลือก
- Esc เพื่อยกเลิก
- Ctrl+C เพื่อออก
- การค้นหาแบบ fuzzy ข้ามข้อมูล id/title/cwd/first message/all messages/path ของเซสชัน

พฤติกรรมการแสดงผลเมื่อรายการว่าง:

- แสดงข้อความแทนที่จะเกิด crash
- การกด Enter บนรายการว่างไม่ทำอะไร (ไม่มี callback)
- Esc/Ctrl+C ยังคงทำงานได้

ข้อควรระวัง: ข้อความใน UI ระบุว่า `Press Tab to view all` แต่ส่วนประกอบนี้ยังไม่มี handler สำหรับ Tab ในปัจจุบัน และการเชื่อมต่อปัจจุบันแสดงรายการเฉพาะเซสชันในขอบเขตปัจจุบันเท่านั้น

## การดำเนินการสลับรันไทม์ (`AgentSession.switchSession`)

`switchSession(sessionPath)` คือเส้นทางหลักในการสลับภายในกระบวนการ

วงจรชีวิต/การเปลี่ยนสถานะ:

1. บันทึก `previousSessionFile`
2. ส่ง event hook `session_before_switch` (`reason: "resume"`, สามารถยกเลิกได้)
3. หากยกเลิก -> คืนค่า `false` โดยไม่สลับ
4. ตัดการเชื่อมต่อจาก event stream ของ agent ปัจจุบัน
5. ยกเลิกการสร้าง/กระบวนการ tool ที่กำลังทำงาน
6. ล้าง buffer ข้อความ steering/follow-up/next-turn ที่รอคิว
7. flush session writer (`sessionManager.flush()`) เพื่อบันทึกการเขียนที่รอดำเนินการ
8. `sessionManager.setSessionFile(sessionPath)`
   - อัปเดต pointer ไฟล์เซสชัน
   - เขียน terminal breadcrumb
   - โหลด entries / migrate / blob-resolve / reindex
   - หากข้อมูลไฟล์ขาดหาย/ไม่ถูกต้อง: เริ่มต้นเซสชันใหม่ที่ path นั้นและเขียนส่วนหัวใหม่
9. อัปเดต `agent.sessionId`
10. สร้าง context ใหม่ผ่าน `buildSessionContext()`
11. ส่ง event hook `session_switch` (`reason: "resume"`, `previousSessionFile`)
12. แทนที่ข้อความ agent ด้วย context ที่สร้างใหม่
13. คืนค่า model เริ่มต้นจาก `sessionContext.models.default` หากมีและอยู่ใน model registry
14. คืนค่าระดับ thinking:
    - หาก branch มี `thinking_level_change` อยู่แล้ว ให้ใช้ระดับเซสชันที่บันทึกไว้
    - มิฉะนั้น ให้หาระดับ thinking เริ่มต้นจาก settings, จำกัดให้อยู่ในความสามารถของ model, ตั้งค่า และเพิ่มรายการ `thinking_level_change` ใหม่
15. เชื่อมต่อ agent listeners อีกครั้งและคืนค่า `true`

## การสร้างสถานะ UI ใหม่หลังการสลับแบบ interactive

`SelectorController.handleResumeSession` ดำเนินการรีเซ็ต UI รอบๆ `switchSession`:

- หยุดแอนิเมชันการโหลด
- ล้าง status container
- ล้าง pending-message UI และ pending tool map
- รีเซ็ต streaming component/message references
- เรียก `session.switchSession(...)`
- ล้าง chat container และ rerender จาก session context (`renderInitialMessages`)
- โหลด todos ใหม่จาก artifacts ของเซสชันใหม่
- แสดง `Resumed session`

ดังนั้นสถานะการสนทนา/todo ที่มองเห็นได้จะถูกสร้างใหม่จากไฟล์เซสชันใหม่

## การ resume ขณะเริ่มต้น vs การสลับภายในเซสชัน

### การ resume ขณะเริ่มต้น (`--continue`, `--resume`, การเปิดโดยตรง)

- เลือกไฟล์เซสชันก่อน `createAgentSession(...)`
- `sdk.ts` สร้าง `existingSession = sessionManager.buildSessionContext()`
- ข้อความ agent ถูกคืนค่าครั้งเดียวระหว่างการสร้างเซสชัน
- Model/thinking ถูกเลือกระหว่างการสร้าง (รวมถึง logic การคืนค่า/fallback)
- โหมด interactive จากนั้นรัน `#restoreModeFromSession()` เพื่อกลับเข้าสู่สถานะโหมดที่บันทึกไว้ (ปัจจุบันคือ plan/plan_paused)

### การสลับภายในเซสชัน (เส้นทางตัวเลือกแบบ `/resume`)

- ใช้ `AgentSession.switchSession(...)` บน `AgentSession` ที่กำลังทำงานอยู่แล้ว
- ข้อความ/model/thinking ถูกสร้างใหม่ทันทีในที่เดิม
- ส่ง event hook `session_before_switch`/`session_switch`
- UI chat/todos ถูกรีเฟรช
- ไม่มีการเรียก mode restore หลังการสลับโดยเฉพาะในเส้นทาง selector; พฤติกรรมการกลับเข้าสู่โหมดไม่สมมาตรกับ `#restoreModeFromSession()` ขณะเริ่มต้น

## พฤติกรรมเมื่อเกิดความล้มเหลวและกรณีขอบ

### เส้นทางการยกเลิก

- ยกเลิกตัวเลือก CLI -> คืนค่า `null`, caller แสดง `No session selected`, กระบวนการออกก่อน
- ยกเลิกตัวเลือกแบบ interactive -> คืนค่า editor โดยไม่มีการเปลี่ยนเซสชัน
- การยกเลิกผ่าน hook (`session_before_switch`) -> `switchSession()` คืนค่า `false`

### เส้นทางรายการว่าง

- CLI `--resume` (ไม่มีค่า): รายการว่างแสดง `No sessions found` และออก
- ตัวเลือกแบบ interactive: รายการว่างแสดงข้อความและยังคงสามารถยกเลิกได้

### ไฟล์เซสชันเป้าหมายที่ขาดหาย/ไม่ถูกต้อง

เมื่อเปิด/สลับไปยัง path เฉพาะ (`setSessionFile`):

- ENOENT -> ถือว่าว่าง -> เริ่มต้นเซสชันใหม่ที่ path นั้นและบันทึก
- ส่วนหัวที่ผิดรูปแบบ/ไม่ถูกต้อง (หรือรายการที่แยกวิเคราะห์ไม่ได้) -> ถือว่าว่าง -> เริ่มต้นเซสชันใหม่และบันทึก

นี่คือพฤติกรรมการกู้คืน ไม่ใช่ความล้มเหลวแบบร้ายแรง

### ความล้มเหลวแบบร้ายแรง

การสลับ/เปิดยังคงสามารถโยน error จากความล้มเหลวของ I/O จริงๆ (ข้อผิดพลาดสิทธิ์การเข้าถึง, ความล้มเหลวในการเขียนใหม่ ฯลฯ) ซึ่งจะแพร่กระจายไปยัง caller

### ข้อควรระวังในการจับคู่ ID prefix

- การจับคู่ ID ใช้ `startsWith` และใช้การจับคู่แรกในรายการที่เรียงลำดับแล้ว
- ไม่มี UI สำหรับการยืนยันหากเซสชันหลายรายการมี prefix เดียวกัน
- `SessionManager.list(...)` ไม่รวมเซสชันที่มีข้อความเป็นศูนย์ ดังนั้นเซสชันเหล่านั้นจึงไม่สามารถ resume ได้ผ่านการจับคู่ ID/ตัวเลือกรายการ
