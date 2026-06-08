---
title: Session Switching and Recent Session Listing
description: >-
  Session switching mechanics and recent session listing with search and
  filtering.
sidebar:
  order: 4
  label: Switching & recent
i18n:
  sourceHash: aae56130b508
  translator: machine
---

# การสลับเซสชันและรายการเซสชันล่าสุด

เอกสารนี้อธิบายวิธีที่ coding-agent ค้นพบเซสชันล่าสุด, แก้ไขเป้าหมาย `--resume`, นำเสนอตัวเลือกเซสชัน, และสลับเซสชันรันไทม์ที่ใช้งานอยู่

เอกสารนี้มุ่งเน้นไปที่พฤติกรรมการทำงานจริงในปัจจุบัน รวมถึงเส้นทางสำรองและข้อควรระวัง

## ไฟล์การทำงาน

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

`SessionManager.list(cwd, sessionDir?)` อ่านเฉพาะไดเรกทอรีนั้นเท่านั้น เว้นแต่จะมีการระบุ `sessionDir` อย่างชัดเจน

### สองเส้นทางการแสดงรายการพร้อม payload ที่แตกต่างกัน

มีสองไปป์ไลน์การแสดงรายการที่แตกต่างกัน:

1. `getRecentSessions(sessionDir, limit)` (มุมมองต้อนรับ/สรุป)
   - อ่านเฉพาะส่วนนำหน้า 4KB (`readTextPrefix(..., 4096)`) จากแต่ละไฟล์
   - แยกวิเคราะห์ header + ข้อความตัวอย่างจากผู้ใช้แรกสุด
   - คืนค่า `RecentSessionInfo` แบบเบาพร้อม getter แบบ lazy สำหรับ `name` และ `timeAgo`
   - เรียงลำดับตาม `mtime` ของไฟล์จากใหม่ไปเก่า

2. `SessionManager.list(...)` / `SessionManager.listAll()` (ตัวเลือก resume และการจับคู่ ID)
   - อ่านไฟล์เซสชันทั้งหมด
   - สร้างอ็อบเจกต์ `SessionInfo` (`id`, `cwd`, `title`, `messageCount`, `firstMessage`, `allMessagesText`, timestamps)
   - ละทิ้งเซสชันที่มีรายการ `message` เป็นศูนย์
   - เรียงลำดับตาม `modified` จากใหม่ไปเก่า

### พฤติกรรมการใช้ metadata สำรอง

สำหรับสรุปเซสชันล่าสุด (`RecentSessionInfo`):

- ลำดับความสำคัญของชื่อแสดงผล: `header.title` -> prompt แรกของผู้ใช้ -> `header.id` -> ชื่อไฟล์
- ชื่อถูกตัดให้เหลือ 40 อักขระสำหรับการแสดงผลแบบกระชับ
- อักขระควบคุม/บรรทัดใหม่ถูกลบ/ทำความสะอาดจากชื่อที่ได้มาจาก title

สำหรับรายการ `SessionInfo`:

- `title` คือ `header.title` หรือ `shortSummary` จากการบีบอัดล่าสุด
- `firstMessage` คือข้อความผู้ใช้แรกหรือ `"(no messages)"`

## การแก้ไข `--continue` และความสำคัญของ breadcrumb เทอร์มินัล

`SessionManager.continueRecent(cwd, sessionDir?)` แก้ไขเป้าหมายตามลำดับนี้:

1. อ่าน breadcrumb ที่กำหนดขอบเขตตามเทอร์มินัล (`~/.xcsh/agent/terminal-sessions/<terminal-id>`)
2. ตรวจสอบ breadcrumb:
   - สามารถระบุเทอร์มินัลปัจจุบันได้
   - cwd ของ breadcrumb ตรงกับ cwd ปัจจุบัน (เปรียบเทียบ resolved path)
   - ไฟล์ที่อ้างอิงยังคงมีอยู่
3. หาก breadcrumb ไม่ถูกต้อง/หายไป ให้ใช้ไฟล์ใหม่สุดตาม mtime ในไดเรกทอรีเซสชัน (`findMostRecentSession`) เป็นทางสำรอง
4. หากไม่พบเลย ให้สร้างเซสชันใหม่

การหา Terminal ID ให้ความสำคัญกับ TTY path และใช้ตัวระบุจาก environment เป็นทางสำรอง (`KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION`)

การเขียน breadcrumb เป็นแบบ best-effort และไม่ทำให้เกิดข้อผิดพลาดร้ายแรง

## การแก้ไขเป้าหมาย resume ขณะเริ่มต้น (`main.ts`)

### `--resume <value>`

`createSessionManager(...)` จัดการ `--resume` ที่มีค่าเป็นสตริงในสองโหมด:

1. ค่าที่เป็นลักษณะ path (มี `/`, `\\`, หรือลงท้ายด้วย `.jsonl`)
   - ใช้ `SessionManager.open(sessionArg, parsed.sessionDir)` โดยตรง

2. ค่าที่เป็น ID prefix
   - ค้นหาการจับคู่ใน `SessionManager.list(cwd, sessionDir)` โดย `id.startsWith(sessionArg)`
   - หากไม่พบการจับคู่ในเครื่องและ `sessionDir` ไม่ได้ถูกบังคับ ให้ลอง `SessionManager.listAll()`
   - ใช้การจับคู่แรก (ไม่มี prompt สำหรับกรณีที่คลุมเครือ)

พฤติกรรมการจับคู่ข้ามโปรเจกต์:

- หาก cwd ของเซสชันที่จับคู่ได้แตกต่างจาก cwd ปัจจุบัน CLI จะถามว่าต้องการ fork เข้าสู่โปรเจกต์ปัจจุบันหรือไม่
- ใช่ -> `SessionManager.forkFrom(...)`
- ไม่ -> โยนข้อผิดพลาด (`Session "..." is in another project (...)`)

ไม่พบการจับคู่ -> โยนข้อผิดพลาด (`Session "..." not found.`)

### `--resume` (ไม่มีค่า)

จัดการหลังจากการสร้าง session-manager เริ่มต้น:

1. แสดงรายการเซสชันในเครื่องด้วย `SessionManager.list(cwd, parsed.sessionDir)`
2. หากว่างเปล่า: พิมพ์ `No sessions found` และออกก่อนกำหนด
3. เปิดตัวเลือก TUI (`selectSession`)
4. หากยกเลิก: พิมพ์ `No session selected` และออกก่อนกำหนด
5. หากเลือก: `SessionManager.open(selectedPath)`

### `--continue`

ใช้ `SessionManager.continueRecent(...)` โดยตรง (พฤติกรรม breadcrumb-first ตามที่อธิบายด้านบน)

## รายละเอียดภายในของการเลือกผ่านตัวเลือก

## ตัวเลือก CLI (`src/cli/session-picker.ts`)

`selectSession(sessions)` สร้าง TUI แบบ standalone พร้อม `SessionSelectorComponent` และแก้ไขค่าได้ครั้งเดียวเท่านั้น:

- เลือก -> แก้ไขเป็น path ที่เลือก
- ยกเลิก (Esc) -> แก้ไขเป็น `null`
- ออกแบบบังคับ (เส้นทาง Ctrl+C) -> หยุด TUI และ `process.exit(0)`

## ตัวเลือกภายในเซสชันแบบ interactive (`SelectorController.showSessionSelector`)

ขั้นตอน:

1. ดึงเซสชันจากไดเรกทอรีเซสชันปัจจุบันผ่าน `SessionManager.list(currentCwd, currentSessionDir)`
2. เมาท์ `SessionSelectorComponent` ในพื้นที่ editor โดยใช้ `showSelector(...)`
3. callback:
   - เลือก -> ปิดตัวเลือกและเรียก `handleResumeSession(sessionPath)`
   - ยกเลิก -> คืนค่า editor และ rerender
   - ออก -> `ctx.shutdown()`

## พฤติกรรมของคอมโพเนนต์ตัวเลือกเซสชัน

`SessionList` รองรับ:

- การนำทางด้วยลูกศร/page
- Enter เพื่อเลือก
- Esc เพื่อยกเลิก
- Ctrl+C เพื่อออก
- การค้นหาแบบ fuzzy ข้าม session id/title/cwd/first message/all messages/path

พฤติกรรมการแสดงผลเมื่อรายการว่างเปล่า:

- แสดงข้อความแทนที่จะเกิดข้อผิดพลาด
- Enter เมื่อว่างเปล่าจะไม่ทำอะไร (ไม่มี callback)
- Esc/Ctrl+C ยังคงทำงาน

ข้อควรระวัง: ข้อความ UI แจ้งว่า `Press Tab to view all` แต่คอมโพเนนต์นี้ปัจจุบันไม่มีตัวจัดการ Tab และการเชื่อมต่อปัจจุบันแสดงรายการเฉพาะเซสชันในขอบเขตปัจจุบันเท่านั้น

## การดำเนินการสลับขณะรันไทม์ (`AgentSession.switchSession`)

`switchSession(sessionPath)` เป็นเส้นทางการสลับภายในกระบวนการหลัก

วงจรชีวิต/การเปลี่ยนสถานะ:

1. บันทึก `previousSessionFile`
2. ส่งเหตุการณ์ hook `session_before_switch` (`reason: "resume"`, ยกเลิกได้)
3. หากยกเลิก -> คืนค่า `false` โดยไม่สลับ
4. ตัดการเชื่อมต่อจาก agent event stream ปัจจุบัน
5. ยกเลิกการสร้าง/เครื่องมือที่กำลังทำงานอยู่
6. ล้างบัฟเฟอร์ข้อความ steering/follow-up/next-turn ที่อยู่ในคิว
7. flush session writer (`sessionManager.flush()`) เพื่อบันทึกการเขียนที่ค้างอยู่
8. `sessionManager.setSessionFile(sessionPath)`
   - อัพเดตตัวชี้ไฟล์เซสชัน
   - เขียน terminal breadcrumb
   - โหลดรายการ / migrate / blob-resolve / reindex
   - หากข้อมูลไฟล์หายไป/ไม่ถูกต้อง: เริ่มต้นเซสชันใหม่ที่ path นั้นและเขียน header ใหม่
9. อัพเดต `agent.sessionId`
10. สร้าง context ใหม่ผ่าน `buildSessionContext()`
11. ส่งเหตุการณ์ hook `session_switch` (`reason: "resume"`, `previousSessionFile`)
12. แทนที่ข้อความ agent ด้วย context ที่สร้างใหม่
13. คืนค่าโมเดลเริ่มต้นจาก `sessionContext.models.default` หากมีและมีอยู่ในรีจิสตรีโมเดล
14. คืนค่าระดับ thinking:
    - หาก branch มี `thinking_level_change` อยู่แล้ว ให้ใช้ระดับเซสชันที่บันทึกไว้
    - มิเช่นนั้น คำนวณระดับ thinking เริ่มต้นจากการตั้งค่า จำกัดตามความสามารถของโมเดล ตั้งค่า และเพิ่มรายการ `thinking_level_change` ใหม่
15. เชื่อมต่อ agent listener ใหม่และคืนค่า `true`

## การสร้าง UI state ใหม่หลังการสลับแบบ interactive

`SelectorController.handleResumeSession` ดำเนินการรีเซ็ต UI รอบ `switchSession`:

- หยุดแอนิเมชันโหลด
- ล้างคอนเทนเนอร์สถานะ
- ล้าง UI ข้อความที่ค้างอยู่และ pending tool map
- รีเซ็ตการอ้างอิงคอมโพเนนต์ streaming/ข้อความ
- เรียก `session.switchSession(...)`
- ล้างคอนเทนเนอร์แชทและ rerender จาก session context (`renderInitialMessages`)
- โหลด todos ใหม่จาก artifacts ของเซสชันใหม่
- แสดง `Resumed session`

ดังนั้น conversation/todo state ที่มองเห็นจะถูกสร้างใหม่จากไฟล์เซสชันใหม่

## การ resume ขณะเริ่มต้น vs การสลับภายในเซสชัน

### การ resume ขณะเริ่มต้น (`--continue`, `--resume`, เปิดโดยตรง)

- ไฟล์เซสชันถูกเลือกก่อน `createAgentSession(...)`
- `sdk.ts` สร้าง `existingSession = sessionManager.buildSessionContext()`
- ข้อความ agent ถูกคืนค่าครั้งเดียวระหว่างการสร้างเซสชัน
- Model/thinking ถูกเลือกระหว่างการสร้าง (รวมถึงตรรกะ restore/fallback)
- โหมด interactive จากนั้นรัน `#restoreModeFromSession()` เพื่อเข้าสู่สถานะโหมดที่บันทึกไว้อีกครั้ง (ปัจจุบันคือ plan/plan_paused)

### การสลับภายในเซสชัน (เส้นทางตัวเลือกแบบ `/resume`)

- ใช้ `AgentSession.switchSession(...)` บน `AgentSession` ที่กำลังทำงานอยู่
- Messages/model/thinking ถูกสร้างใหม่ทันที
- เหตุการณ์ hook `session_before_switch`/`session_switch` ถูกส่ง
- UI chat/todos ถูกรีเฟรช
- ไม่มีการเรียก mode restore เฉพาะหลังการสลับในขั้นตอนตัวเลือก; พฤติกรรมการกลับเข้าโหมดไม่สมมาตรกับ `#restoreModeFromSession()` ขณะเริ่มต้น

## พฤติกรรมเมื่อเกิดข้อผิดพลาดและกรณีขอบ

### เส้นทางการยกเลิก

- ยกเลิกตัวเลือก CLI -> คืนค่า `null`, ผู้เรียกพิมพ์ `No session selected`, กระบวนการออกก่อนกำหนด
- ยกเลิกตัวเลือก interactive -> คืนค่า editor, ไม่มีการเปลี่ยนเซสชัน
- การยกเลิกจาก hook (`session_before_switch`) -> `switchSession()` คืนค่า `false`

### เส้นทางเมื่อรายการว่างเปล่า

- CLI `--resume` (ไม่มีค่า): รายการว่างเปล่าพิมพ์ `No sessions found` และออก
- ตัวเลือก interactive: รายการว่างเปล่าแสดงข้อความและยังคงยกเลิกได้

### ไฟล์เซสชันเป้าหมายที่หายไป/ไม่ถูกต้อง

เมื่อเปิด/สลับไปยัง path เฉพาะ (`setSessionFile`):

- ENOENT -> ถือว่าว่างเปล่า -> เริ่มต้นเซสชันใหม่ที่ path นั้นพอดีและบันทึก
- header ที่ผิดรูปแบบ/ไม่ถูกต้อง (หรือรายการที่แยกวิเคราะห์แล้วอ่านไม่ได้จริงๆ) -> ถือว่าว่างเปล่า -> เริ่มต้นเซสชันใหม่และบันทึก

นี่คือพฤติกรรมการกู้คืน ไม่ใช่ข้อผิดพลาดร้ายแรง

### ข้อผิดพลาดร้ายแรง

การสลับ/เปิดยังคงสามารถโยนข้อผิดพลาดได้เมื่อเกิดความล้มเหลว I/O ที่แท้จริง (ข้อผิดพลาดสิทธิ์, ความล้มเหลวในการเขียนใหม่ ฯลฯ) ซึ่งจะถูกส่งต่อไปยังผู้เรียก

### ข้อควรระวังเกี่ยวกับการจับคู่ ID prefix

- การจับคู่ ID ใช้ `startsWith` และใช้การจับคู่แรกในรายการที่เรียงลำดับแล้ว
- ไม่มี UI สำหรับกรณีที่คลุมเครือหากหลายเซสชันมี prefix เดียวกัน
- `SessionManager.list(...)` ไม่รวมเซสชันที่มีข้อความเป็นศูนย์ ดังนั้นเซสชันเหล่านั้นไม่สามารถ resume ผ่านการจับคู่ ID/ตัวเลือกรายการได้
