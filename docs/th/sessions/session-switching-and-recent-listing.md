---
title: การสลับเซสชันและรายการเซสชันล่าสุด
description: กลไกการสลับเซสชันและรายการเซสชันล่าสุดพร้อมการค้นหาและการกรอง
sidebar:
  order: 4
  label: การสลับและเซสชันล่าสุด
i18n:
  sourceHash: aae56130b508
  translator: machine
---

# การสลับเซสชันและรายการเซสชันล่าสุด

เอกสารนี้อธิบายวิธีที่ coding-agent ค้นพบเซสชันล่าสุด แก้ไขเป้าหมาย `--resume` แสดงตัวเลือกเซสชัน และสลับเซสชันรันไทม์ที่กำลังใช้งาน

เอกสารนี้เน้นพฤติกรรมการใช้งานปัจจุบัน รวมถึงเส้นทางสำรองและข้อควรระวัง

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

### สองเส้นทางการแสดงรายการที่มี payload แตกต่างกัน

มีสองไพพ์ไลน์การแสดงรายการที่แตกต่างกัน:

1. `getRecentSessions(sessionDir, limit)` (มุมมองหน้าต้อนรับ/สรุป)
   - อ่านเฉพาะส่วนนำ 4KB (`readTextPrefix(..., 4096)`) จากแต่ละไฟล์
   - แยกวิเคราะห์ header + ตัวอย่างข้อความผู้ใช้แรกสุด
   - คืนค่า `RecentSessionInfo` แบบน้ำหนักเบาพร้อม getter แบบ lazy สำหรับ `name` และ `timeAgo`
   - เรียงตาม `mtime` ของไฟล์จากมากไปน้อย

2. `SessionManager.list(...)` / `SessionManager.listAll()` (ตัวเลือกสำหรับ resume และการจับคู่ ID)
   - อ่านไฟล์เซสชันทั้งหมด
   - สร้างออบเจกต์ `SessionInfo` (`id`, `cwd`, `title`, `messageCount`, `firstMessage`, `allMessagesText`, timestamps)
   - ตัดเซสชันที่มีรายการ `message` เป็นศูนย์ออก
   - เรียงตาม `modified` จากมากไปน้อย

### พฤติกรรมสำรองของเมตาดาต้า

สำหรับสรุปล่าสุด (`RecentSessionInfo`):

- ลำดับความสำคัญของชื่อแสดงผล: `header.title` -> prompt แรกของผู้ใช้ -> `header.id` -> ชื่อไฟล์
- ชื่อถูกตัดให้เหลือ 40 ตัวอักษรสำหรับการแสดงผลแบบกระชับ
- อักขระควบคุม/บรรทัดใหม่ถูกลบ/ทำความสะอาดจากชื่อที่ได้มาจาก title

สำหรับรายการ `SessionInfo`:

- `title` คือ `header.title` หรือ `shortSummary` ของการบีบอัดล่าสุด
- `firstMessage` คือข้อความผู้ใช้แรกหรือ `"(no messages)"`

## การแก้ไข `--continue` และความสำคัญของ breadcrumb เทอร์มินัล

`SessionManager.continueRecent(cwd, sessionDir?)` แก้ไขเป้าหมายตามลำดับนี้:

1. อ่าน breadcrumb ที่กำหนดขอบเขตตามเทอร์มินัล (`~/.xcsh/agent/terminal-sessions/<terminal-id>`)
2. ตรวจสอบความถูกต้องของ breadcrumb:
   - สามารถระบุเทอร์มินัลปัจจุบันได้
   - cwd ของ breadcrumb ตรงกับ cwd ปัจจุบัน (เปรียบเทียบ resolved path)
   - ไฟล์ที่อ้างอิงยังคงมีอยู่
3. หาก breadcrumb ไม่ถูกต้อง/ไม่พบ จะ fallback ไปยังไฟล์ใหม่สุดตาม mtime ในไดเรกทอรีเซสชัน (`findMostRecentSession`)
4. หากไม่พบเลย จะสร้างเซสชันใหม่

การหา Terminal ID จะให้ความสำคัญกับ TTY path ก่อนและ fallback ไปยังตัวระบุจากตัวแปรสภาพแวดล้อม (`KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION`)

การเขียน breadcrumb เป็นแบบ best-effort และไม่ทำให้เกิดข้อผิดพลาดร้ายแรง

## การแก้ไขเป้าหมาย resume ตอนเริ่มต้น (`main.ts`)

### `--resume <value>`

`createSessionManager(...)` จัดการ `--resume` ที่มีค่าเป็น string ในสองโหมด:

1. ค่าที่เป็นลักษณะ path (มี `/`, `\\` หรือลงท้ายด้วย `.jsonl`)
   - เรียก `SessionManager.open(sessionArg, parsed.sessionDir)` โดยตรง

2. ค่าเป็น ID prefix
   - ค้นหาที่ตรงกันใน `SessionManager.list(cwd, sessionDir)` โดย `id.startsWith(sessionArg)`
   - หากไม่พบในเครื่องและไม่ได้บังคับ `sessionDir` จะลอง `SessionManager.listAll()`
   - ใช้รายการแรกที่ตรงกัน (ไม่มี prompt สำหรับกรณีกำกวม)

พฤติกรรมการจับคู่ข้ามโปรเจกต์:

- หาก cwd ของเซสชันที่ตรงกันแตกต่างจาก cwd ปัจจุบัน CLI จะถามว่าต้องการ fork เข้าสู่โปรเจกต์ปัจจุบันหรือไม่
- ใช่ -> `SessionManager.forkFrom(...)`
- ไม่ -> โยนข้อผิดพลาด (`Session "..." is in another project (...)`)

ไม่ตรงกัน -> โยนข้อผิดพลาด (`Session "..." not found.`)

### `--resume` (ไม่มีค่า)

จัดการหลังจากสร้าง session-manager เริ่มต้น:

1. แสดงรายการเซสชันในเครื่องด้วย `SessionManager.list(cwd, parsed.sessionDir)`
2. หากว่างเปล่า: พิมพ์ `No sessions found` และออกก่อน
3. เปิด TUI picker (`selectSession`)
4. หากยกเลิก: พิมพ์ `No session selected` และออกก่อน
5. หากเลือก: `SessionManager.open(selectedPath)`

### `--continue`

ใช้ `SessionManager.continueRecent(...)` โดยตรง (พฤติกรรม breadcrumb-first ที่อธิบายข้างต้น)

## รายละเอียดภายในของการเลือกแบบ picker

## CLI picker (`src/cli/session-picker.ts`)

`selectSession(sessions)` สร้าง TUI แบบ standalone ด้วย `SessionSelectorComponent` และ resolve เพียงครั้งเดียว:

- เลือก -> resolve เป็น path ที่เลือก
- ยกเลิก (Esc) -> resolve เป็น `null`
- ออกแบบบังคับ (เส้นทาง Ctrl+C) -> หยุด TUI และ `process.exit(0)`

## Picker แบบ interactive ในเซสชัน (`SelectorController.showSessionSelector`)

ขั้นตอน:

1. ดึงเซสชันจากไดเรกทอรีเซสชันปัจจุบันผ่าน `SessionManager.list(currentCwd, currentSessionDir)`
2. ติดตั้ง `SessionSelectorComponent` ในพื้นที่ editor โดยใช้ `showSelector(...)`
3. callback:
   - เลือก -> ปิด selector และเรียก `handleResumeSession(sessionPath)`
   - ยกเลิก -> คืนค่า editor และ rerender
   - ออก -> `ctx.shutdown()`

## พฤติกรรมของ session selector component

`SessionList` รองรับ:

- การนำทางด้วยลูกศร/หน้า
- Enter เพื่อเลือก
- Esc เพื่อยกเลิก
- Ctrl+C เพื่อออก
- การค้นหาแบบ fuzzy ข้าม session id/title/cwd/first message/all messages/path

พฤติกรรมการแสดงผลเมื่อรายการว่าง:

- แสดงข้อความแทนที่จะ crash
- Enter เมื่อว่างเปล่าจะไม่ทำอะไร (ไม่มี callback)
- Esc/Ctrl+C ยังคงทำงานได้

ข้อควรระวัง: ข้อความ UI ระบุว่า `Press Tab to view all` แต่ component นี้ปัจจุบันไม่มี Tab handler และการเชื่อมต่อปัจจุบันแสดงรายการเฉพาะเซสชันในขอบเขตปัจจุบันเท่านั้น

## การดำเนินการสลับรันไทม์ (`AgentSession.switchSession`)

`switchSession(sessionPath)` เป็นเส้นทางการสลับหลักภายในกระบวนการ

วงจรชีวิต/การเปลี่ยนสถานะ:

1. จับ `previousSessionFile`
2. ส่ง hook event `session_before_switch` (`reason: "resume"`, สามารถยกเลิกได้)
3. หากยกเลิก -> คืนค่า `false` โดยไม่สลับ
4. ตัดการเชื่อมต่อจาก event stream ของ agent ปัจจุบัน
5. ยกเลิกการสร้าง/เครื่องมือที่กำลังทำงานอยู่
6. ล้างบัฟเฟอร์ข้อความ steering/follow-up/next-turn ที่อยู่ในคิว
7. flush session writer (`sessionManager.flush()`) เพื่อบันทึกการเขียนที่ค้างอยู่
8. `sessionManager.setSessionFile(sessionPath)`
   - อัปเดตตัวชี้ไฟล์เซสชัน
   - เขียน terminal breadcrumb
   - โหลดรายการ / ย้ายข้อมูล / แก้ไข blob / สร้างดัชนีใหม่
   - หากข้อมูลไฟล์ไม่พบ/ไม่ถูกต้อง: เริ่มต้นเซสชันใหม่ที่ path นั้นและเขียน header ใหม่
9. อัปเดต `agent.sessionId`
10. สร้างบริบทใหม่ผ่าน `buildSessionContext()`
11. ส่ง hook event `session_switch` (`reason: "resume"`, `previousSessionFile`)
12. แทนที่ข้อความ agent ด้วยบริบทที่สร้างใหม่
13. คืนค่าโมเดลเริ่มต้นจาก `sessionContext.models.default` หากมีและปรากฏใน model registry
14. คืนค่าระดับ thinking:
    - หาก branch มี `thinking_level_change` อยู่แล้ว ให้ใช้ระดับเซสชันที่บันทึกไว้
    - มิฉะนั้น หาระดับ thinking เริ่มต้นจากการตั้งค่า จำกัดให้อยู่ในความสามารถของโมเดล ตั้งค่า และเพิ่มรายการ `thinking_level_change` ใหม่
15. เชื่อมต่อ agent listeners อีกครั้งและคืนค่า `true`

## การสร้างสถานะ UI ใหม่หลังการสลับแบบ interactive

`SelectorController.handleResumeSession` ดำเนินการรีเซ็ต UI รอบ `switchSession`:

- หยุดแอนิเมชันการโหลด
- ล้างคอนเทนเนอร์สถานะ
- ล้าง UI ข้อความที่ค้างอยู่และ pending tool map
- รีเซ็ต streaming component/การอ้างอิงข้อความ
- เรียก `session.switchSession(...)`
- ล้างคอนเทนเนอร์แชทและ rerender จากบริบทเซสชัน (`renderInitialMessages`)
- โหลด todos ใหม่จาก artifacts ของเซสชันใหม่
- แสดง `Resumed session`

ดังนั้นสถานะการสนทนา/todo ที่มองเห็นจะถูกสร้างใหม่จากไฟล์เซสชันใหม่

## การ resume ตอนเริ่มต้น vs การสลับในเซสชัน

### การ resume ตอนเริ่มต้น (`--continue`, `--resume`, เปิดโดยตรง)

- ไฟล์เซสชันถูกเลือกก่อน `createAgentSession(...)`
- `sdk.ts` สร้าง `existingSession = sessionManager.buildSessionContext()`
- ข้อความ agent ถูกคืนค่าครั้งเดียวระหว่างการสร้างเซสชัน
- โมเดล/thinking ถูกเลือกระหว่างการสร้าง (รวมถึงตรรกะการคืนค่า/สำรอง)
- จากนั้น interactive mode จะรัน `#restoreModeFromSession()` เพื่อกลับเข้าสู่สถานะโหมดที่บันทึกไว้ (ปัจจุบันคือ plan/plan_paused)

### การสลับในเซสชัน (เส้นทาง selector แบบ `/resume`)

- ใช้ `AgentSession.switchSession(...)` บน `AgentSession` ที่กำลังทำงานอยู่
- ข้อความ/โมเดล/thinking ถูกสร้างใหม่ทันที
- ส่ง hook event `session_before_switch`/`session_switch`
- รีเฟรช UI แชท/todos
- ไม่มีการเรียกคืนค่าโหมดหลังการสลับโดยเฉพาะใน selector flow; พฤติกรรมการกลับเข้าโหมดไม่สมมาตรกับ `#restoreModeFromSession()` ตอนเริ่มต้น

## พฤติกรรมกรณีล้มเหลวและกรณีขอบ

### เส้นทางการยกเลิก

- ยกเลิก CLI picker -> คืนค่า `null`, ผู้เรียกพิมพ์ `No session selected`, กระบวนการออกก่อน
- ยกเลิก interactive picker -> คืนค่า editor, ไม่มีการเปลี่ยนเซสชัน
- ยกเลิกผ่าน hook (`session_before_switch`) -> `switchSession()` คืนค่า `false`

### เส้นทางรายการว่าง

- CLI `--resume` (ไม่มีค่า): รายการว่างพิมพ์ `No sessions found` และออก
- Interactive selector: รายการว่างแสดงข้อความและยังสามารถยกเลิกได้

### ไฟล์เซสชันเป้าหมายที่ไม่พบ/ไม่ถูกต้อง

เมื่อเปิด/สลับไปยัง path เฉพาะ (`setSessionFile`):

- ENOENT -> ถือว่าว่างเปล่า -> เริ่มต้นเซสชันใหม่ที่ path นั้นและบันทึก
- header ผิดรูปแบบ/ไม่ถูกต้อง (หรือรายการที่แยกวิเคราะห์ไม่สามารถอ่านได้อย่างมีประสิทธิภาพ) -> ถือว่าว่างเปล่า -> เริ่มต้นเซสชันใหม่และบันทึก

นี่คือพฤติกรรมการกู้คืน ไม่ใช่ความล้มเหลวแบบร้ายแรง

### ความล้มเหลวแบบร้ายแรง

การสลับ/เปิดยังสามารถโยนข้อผิดพลาดจากความล้มเหลว I/O จริง (ข้อผิดพลาดสิทธิ์, ความล้มเหลวในการเขียนใหม่ ฯลฯ) ซึ่งจะส่งต่อไปยังผู้เรียก

### ข้อควรระวังการจับคู่ ID prefix

- การจับคู่ ID ใช้ `startsWith` และเลือกรายการแรกที่ตรงกันในรายการที่เรียงแล้ว
- ไม่มี UI สำหรับกรณีกำกวมเมื่อหลายเซสชันมี prefix เหมือนกัน
- `SessionManager.list(...)` ตัดเซสชันที่มีข้อความเป็นศูนย์ออก ดังนั้นเซสชันเหล่านั้นไม่สามารถ resume ผ่านการจับคู่ ID/list picker ได้
