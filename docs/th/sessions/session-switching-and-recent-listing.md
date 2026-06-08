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

เอกสารนี้อธิบายวิธีที่ coding-agent ค้นหาเซสชันล่าสุด, แก้ไขเป้าหมาย `--resume`, แสดงตัวเลือกเซสชัน และสลับเซสชันรันไทม์ที่ใช้งานอยู่

เน้นที่พฤติกรรมการทำงานปัจจุบัน รวมถึงเส้นทางสำรองและข้อควรระวัง

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

## การค้นหาเซสชันล่าสุด

### ขอบเขตไดเรกทอรี

`SessionManager` จัดเก็บเซสชันภายใต้ไดเรกทอรีที่กำหนดขอบเขตตาม cwd โดยค่าเริ่มต้น:

- `~/.xcsh/agent/sessions/--<cwd-encoded>--/*.jsonl`

`SessionManager.list(cwd, sessionDir?)` อ่านเฉพาะไดเรกทอรีนั้น เว้นแต่จะมีการระบุ `sessionDir` อย่างชัดเจน

### สองเส้นทางการแสดงรายการที่มีข้อมูลต่างกัน

มีสองไปป์ไลน์การแสดงรายการที่แตกต่างกัน:

1. `getRecentSessions(sessionDir, limit)` (มุมมองต้อนรับ/สรุป)
   - อ่านเฉพาะส่วนหัว 4KB (`readTextPrefix(..., 4096)`) จากแต่ละไฟล์
   - แยกวิเคราะห์ header + ตัวอย่างข้อความผู้ใช้แรกสุด
   - คืนค่า `RecentSessionInfo` แบบน้ำหนักเบาพร้อม getter แบบ lazy สำหรับ `name` และ `timeAgo`
   - เรียงลำดับตาม `mtime` ของไฟล์จากมากไปน้อย

2. `SessionManager.list(...)` / `SessionManager.listAll()` (ตัวเลือกการกลับมาทำต่อและการจับคู่ ID)
   - อ่านไฟล์เซสชันทั้งหมด
   - สร้างอ็อบเจกต์ `SessionInfo` (`id`, `cwd`, `title`, `messageCount`, `firstMessage`, `allMessagesText`, timestamps)
   - ลบเซสชันที่มีรายการ `message` เป็นศูนย์
   - เรียงลำดับตาม `modified` จากมากไปน้อย

### พฤติกรรมสำรองของ metadata

สำหรับสรุปล่าสุด (`RecentSessionInfo`):

- ลำดับความสำคัญของชื่อที่แสดง: `header.title` -> ข้อความแจ้งผู้ใช้แรก -> `header.id` -> ชื่อไฟล์
- ชื่อถูกตัดเหลือ 40 ตัวอักษรสำหรับการแสดงผลแบบกระชับ
- อักขระควบคุม/ขึ้นบรรทัดใหม่ถูกลบ/ทำความสะอาดจากชื่อที่ได้จากหัวข้อ

สำหรับรายการ `SessionInfo`:

- `title` คือ `header.title` หรือ `shortSummary` จากการบีบอัดล่าสุด
- `firstMessage` คือข้อความผู้ใช้แรกหรือ `"(no messages)"`

## การแก้ไข `--continue` และความสำคัญของ breadcrumb ของเทอร์มินัล

`SessionManager.continueRecent(cwd, sessionDir?)` แก้ไขเป้าหมายตามลำดับนี้:

1. อ่าน breadcrumb ที่กำหนดขอบเขตตามเทอร์มินัล (`~/.xcsh/agent/terminal-sessions/<terminal-id>`)
2. ตรวจสอบ breadcrumb:
   - สามารถระบุเทอร์มินัลปัจจุบันได้
   - cwd ของ breadcrumb ตรงกับ cwd ปัจจุบัน (เปรียบเทียบ resolved path)
   - ไฟล์ที่อ้างอิงยังคงมีอยู่
3. ถ้า breadcrumb ไม่ถูกต้อง/ไม่มี ให้ใช้ไฟล์ใหม่สุดตาม mtime ในไดเรกทอรีเซสชัน (`findMostRecentSession`) แทน
4. ถ้าไม่พบ ให้สร้างเซสชันใหม่

การหา Terminal ID ให้ความสำคัญกับ TTY path และใช้ตัวระบุตามสภาพแวดล้อมเป็นตัวสำรอง (`KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION`)

การเขียน breadcrumb เป็นแบบ best-effort และไม่ทำให้เกิดข้อผิดพลาดร้ายแรง

## การแก้ไขเป้าหมายการกลับมาทำต่อตอนเริ่มต้น (`main.ts`)

### `--resume <value>`

`createSessionManager(...)` จัดการค่า `--resume` ที่เป็นสตริงในสองโหมด:

1. ค่าที่เป็นลักษณะ path (มี `/`, `\\` หรือลงท้ายด้วย `.jsonl`)
   - `SessionManager.open(sessionArg, parsed.sessionDir)` โดยตรง

2. ค่า ID prefix
   - ค้นหาที่ตรงกันใน `SessionManager.list(cwd, sessionDir)` โดยใช้ `id.startsWith(sessionArg)`
   - ถ้าไม่พบในเครื่องและไม่ได้บังคับ `sessionDir` ให้ลอง `SessionManager.listAll()`
   - ใช้รายการที่ตรงกันแรก (ไม่มีการแจ้งเตือนความกำกวม)

พฤติกรรมการจับคู่ข้ามโปรเจกต์:

- ถ้า cwd ของเซสชันที่จับคู่ได้แตกต่างจาก cwd ปัจจุบัน CLI จะถามว่าต้องการ fork เข้าสู่โปรเจกต์ปัจจุบันหรือไม่
- ใช่ -> `SessionManager.forkFrom(...)`
- ไม่ -> โยนข้อผิดพลาด (`Session "..." is in another project (...)`)

ไม่พบ -> โยนข้อผิดพลาด (`Session "..." not found.`)

### `--resume` (ไม่มีค่า)

จัดการหลังจากสร้าง session-manager เริ่มต้น:

1. แสดงรายการเซสชันในเครื่องด้วย `SessionManager.list(cwd, parsed.sessionDir)`
2. ถ้าว่าง: แสดง `No sessions found` และออกก่อน
3. เปิดตัวเลือก TUI (`selectSession`)
4. ถ้ายกเลิก: แสดง `No session selected` และออกก่อน
5. ถ้าเลือก: `SessionManager.open(selectedPath)`

### `--continue`

ใช้ `SessionManager.continueRecent(...)` โดยตรง (พฤติกรรม breadcrumb-first ข้างต้น)

## รายละเอียดภายในของการเลือกด้วยตัวเลือก

## ตัวเลือก CLI (`src/cli/session-picker.ts`)

`selectSession(sessions)` สร้าง TUI แบบ standalone ด้วย `SessionSelectorComponent` และ resolve เพียงครั้งเดียว:

- เลือก -> resolve path ที่เลือก
- ยกเลิก (Esc) -> resolve `null`
- ออกแบบบังคับ (เส้นทาง Ctrl+C) -> หยุด TUI และ `process.exit(0)`

## ตัวเลือกในเซสชันแบบ interactive (`SelectorController.showSessionSelector`)

ขั้นตอน:

1. ดึงเซสชันจากไดเรกทอรีเซสชันปัจจุบันผ่าน `SessionManager.list(currentCwd, currentSessionDir)`
2. แสดง `SessionSelectorComponent` ในพื้นที่ editor โดยใช้ `showSelector(...)`
3. callbacks:
   - เลือก -> ปิดตัวเลือกและเรียก `handleResumeSession(sessionPath)`
   - ยกเลิก -> กู้คืน editor และ rerender
   - ออก -> `ctx.shutdown()`

## พฤติกรรมของ session selector component

`SessionList` รองรับ:

- การนำทางด้วยลูกศร/หน้า
- Enter เพื่อเลือก
- Esc เพื่อยกเลิก
- Ctrl+C เพื่อออก
- การค้นหาแบบ fuzzy ข้าม session id/title/cwd/first message/all messages/path

พฤติกรรมการแสดงผลรายการว่าง:

- แสดงข้อความแทนที่จะ crash
- Enter บนรายการว่างไม่ทำอะไร (ไม่มี callback)
- Esc/Ctrl+C ยังคงใช้งานได้

ข้อควรระวัง: ข้อความ UI แสดงว่า `Press Tab to view all` แต่ component นี้ยังไม่มีตัวจัดการ Tab และการเชื่อมต่อปัจจุบันแสดงรายการเฉพาะเซสชันในขอบเขตปัจจุบันเท่านั้น

## การดำเนินการสลับรันไทม์ (`AgentSession.switchSession`)

`switchSession(sessionPath)` เป็นเส้นทางการสลับภายในกระบวนการหลัก

วงจรชีวิต/การเปลี่ยนสถานะ:

1. บันทึก `previousSessionFile`
2. ส่ง hook event `session_before_switch` (`reason: "resume"`, ยกเลิกได้)
3. ถ้ายกเลิก -> คืนค่า `false` โดยไม่สลับ
4. ตัดการเชื่อมต่อจาก agent event stream ปัจจุบัน
5. ยกเลิกการสร้าง/กระแสเครื่องมือที่กำลังทำงาน
6. ล้างบัฟเฟอร์ข้อความ steering/follow-up/next-turn ที่อยู่ในคิว
7. flush session writer (`sessionManager.flush()`) เพื่อบันทึกการเขียนที่รอดำเนินการ
8. `sessionManager.setSessionFile(sessionPath)`
   - อัปเดตตัวชี้ไฟล์เซสชัน
   - เขียน terminal breadcrumb
   - โหลดรายการ / ย้ายข้อมูล / แก้ไข blob / สร้างดัชนีใหม่
   - ถ้าข้อมูลไฟล์ขาดหายหรือไม่ถูกต้อง: สร้างเซสชันใหม่ที่ path นั้นและเขียน header ใหม่
9. อัปเดต `agent.sessionId`
10. สร้างบริบทใหม่ผ่าน `buildSessionContext()`
11. ส่ง hook event `session_switch` (`reason: "resume"`, `previousSessionFile`)
12. แทนที่ข้อความ agent ด้วยบริบทที่สร้างใหม่
13. กู้คืนโมเดลเริ่มต้นจาก `sessionContext.models.default` ถ้ามีและอยู่ใน model registry
14. กู้คืนระดับ thinking:
    - ถ้า branch มี `thinking_level_change` อยู่แล้ว ให้ใช้ระดับเซสชันที่บันทึกไว้
    - มิฉะนั้นให้หาระดับ thinking เริ่มต้นจากการตั้งค่า จำกัดตามความสามารถของโมเดล ตั้งค่า และเพิ่มรายการ `thinking_level_change` ใหม่
15. เชื่อมต่อ agent listeners ใหม่และคืนค่า `true`

## การสร้างสถานะ UI ใหม่หลังสลับแบบ interactive

`SelectorController.handleResumeSession` ทำการรีเซ็ต UI รอบๆ `switchSession`:

- หยุดแอนิเมชันการโหลด
- ล้าง status container
- ล้าง pending-message UI และ pending tool map
- รีเซ็ต streaming component/message references
- เรียก `session.switchSession(...)`
- ล้าง chat container และ rerender จาก session context (`renderInitialMessages`)
- โหลด todos ใหม่จาก artifacts ของเซสชันใหม่
- แสดง `Resumed session`

ดังนั้นสถานะการสนทนา/todo ที่มองเห็นได้จะถูกสร้างใหม่จากไฟล์เซสชันใหม่

## การกลับมาทำต่อตอนเริ่มต้น vs การสลับในเซสชัน

### การกลับมาทำต่อตอนเริ่มต้น (`--continue`, `--resume`, เปิดโดยตรง)

- ไฟล์เซสชันถูกเลือกก่อน `createAgentSession(...)`
- `sdk.ts` สร้าง `existingSession = sessionManager.buildSessionContext()`
- ข้อความ Agent ถูกกู้คืนครั้งเดียวระหว่างการสร้างเซสชัน
- โมเดล/thinking ถูกเลือกระหว่างการสร้าง (รวมถึงตรรกะกู้คืน/สำรอง)
- โหมด interactive จากนั้นเรียก `#restoreModeFromSession()` เพื่อกลับเข้าสู่สถานะโหมดที่บันทึกไว้ (ปัจจุบันคือ plan/plan_paused)

### การสลับในเซสชัน (เส้นทางตัวเลือกแบบ `/resume`)

- ใช้ `AgentSession.switchSession(...)` บน `AgentSession` ที่กำลังทำงานอยู่
- ข้อความ/โมเดล/thinking ถูกสร้างใหม่ทันทีในตำแหน่ง
- ส่ง hook event `session_before_switch`/`session_switch`
- รีเฟรช UI chat/todos
- ไม่มีการเรียกกู้คืนโหมดหลังสลับโดยเฉพาะในขั้นตอนตัวเลือก; พฤติกรรมการกลับเข้าสู่โหมดไม่สมมาตรกับ `#restoreModeFromSession()` ตอนเริ่มต้น

## พฤติกรรมเมื่อล้มเหลวและกรณีขอบ

### เส้นทางการยกเลิก

- ยกเลิกตัวเลือก CLI -> คืนค่า `null`, ผู้เรียกแสดง `No session selected`, กระบวนการออกก่อน
- ยกเลิกตัวเลือก interactive -> กู้คืน editor, ไม่มีการเปลี่ยนเซสชัน
- การยกเลิกผ่าน hook (`session_before_switch`) -> `switchSession()` คืนค่า `false`

### เส้นทางรายการว่าง

- CLI `--resume` (ไม่มีค่า): รายการว่างแสดง `No sessions found` และออก
- ตัวเลือก interactive: รายการว่างแสดงข้อความและยังคงยกเลิกได้

### ไฟล์เซสชันเป้าหมายที่ขาดหายหรือไม่ถูกต้อง

เมื่อเปิด/สลับไปยัง path เฉพาะ (`setSessionFile`):

- ENOENT -> ถือว่าว่าง -> สร้างเซสชันใหม่ที่ path นั้นและบันทึก
- header ผิดรูปแบบ/ไม่ถูกต้อง (หรือรายการที่แยกวิเคราะห์ไม่สามารถอ่านได้) -> ถือว่าว่าง -> สร้างเซสชันใหม่และบันทึก

นี่คือพฤติกรรมการกู้คืน ไม่ใช่ความล้มเหลวร้ายแรง

### ความล้มเหลวร้ายแรง

การสลับ/เปิดยังคงสามารถโยนข้อผิดพลาดจากความล้มเหลว I/O จริง (ข้อผิดพลาดสิทธิ์, ความล้มเหลวในการเขียนใหม่ ฯลฯ) ซึ่งจะส่งต่อไปยังผู้เรียก

### ข้อควรระวังการจับคู่ ID prefix

- การจับคู่ ID ใช้ `startsWith` และเลือกรายการที่ตรงกันแรกในรายการที่เรียงลำดับ
- ไม่มี UI แจ้งความกำกวมถ้าหลายเซสชันมี prefix เดียวกัน
- `SessionManager.list(...)` ไม่รวมเซสชันที่มีข้อความเป็นศูนย์ ดังนั้นเซสชันเหล่านั้นจึงไม่สามารถกลับมาทำต่อได้ผ่านการจับคู่ ID/ตัวเลือกรายการ
