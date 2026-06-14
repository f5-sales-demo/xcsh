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

เอกสารนี้อธิบายวิธีที่ coding-agent ค้นพบเซสชันล่าสุด แก้ไขเป้าหมาย `--resume` นำเสนอตัวเลือกเซสชัน และสลับเซสชันรันไทม์ที่ใช้งานอยู่

โดยเน้นที่พฤติกรรมการใช้งานปัจจุบัน รวมถึงเส้นทางสำรองและข้อควรระวัง

## ไฟล์ที่ใช้ในการพัฒนา

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

`SessionManager.list(cwd, sessionDir?)` อ่านเฉพาะไดเรกทอรีนั้น เว้นแต่จะระบุ `sessionDir` อย่างชัดเจน

### สองเส้นทางการแสดงรายการที่มีข้อมูลต่างกัน

มีไปป์ไลน์การแสดงรายการสองแบบที่แตกต่างกัน:

1. `getRecentSessions(sessionDir, limit)` (มุมมองต้อนรับ/สรุป)
   - อ่านเฉพาะส่วนนำ 4KB (`readTextPrefix(..., 4096)`) จากแต่ละไฟล์
   - แยกวิเคราะห์ส่วนหัวและข้อความแสดงตัวอย่างของผู้ใช้แรกสุด
   - ส่งคืน `RecentSessionInfo` แบบเบาพร้อม getter แบบ lazy สำหรับ `name` และ `timeAgo`
   - เรียงลำดับตาม `mtime` ของไฟล์จากมากไปน้อย

2. `SessionManager.list(...)` / `SessionManager.listAll()` (ตัวเลือกการเริ่มต้นใหม่และการจับคู่ ID)
   - อ่านไฟล์เซสชันทั้งหมด
   - สร้างออบเจ็กต์ `SessionInfo` (`id`, `cwd`, `title`, `messageCount`, `firstMessage`, `allMessagesText`, timestamps)
   - ละเว้นเซสชันที่มีรายการ `message` เป็นศูนย์
   - เรียงลำดับตาม `modified` จากมากไปน้อย

### พฤติกรรมสำรองของเมตาดาตา

สำหรับสรุปล่าสุด (`RecentSessionInfo`):

- ลำดับความสำคัญของชื่อที่แสดง: `header.title` -> พรอมต์ผู้ใช้แรก -> `header.id` -> ชื่อไฟล์
- ชื่อถูกตัดให้เหลือ 40 ตัวอักษรสำหรับการแสดงผลแบบกระชับ
- อักขระควบคุม/ขึ้นบรรทัดใหม่ถูกลบ/ทำความสะอาดออกจากชื่อที่ได้มาจากหัวเรื่อง

สำหรับรายการ `SessionInfo`:

- `title` คือ `header.title` หรือ `shortSummary` ของการบีบอัดล่าสุด
- `firstMessage` คือข้อความข้อความแรกของผู้ใช้ หรือ `"(no messages)"`

## การแก้ไข `--continue` และลำดับความสำคัญของ breadcrumb ใน terminal

`SessionManager.continueRecent(cwd, sessionDir?)` แก้ไขเป้าหมายตามลำดับนี้:

1. อ่าน breadcrumb ที่กำหนดขอบเขตตาม terminal (`~/.xcsh/agent/terminal-sessions/<terminal-id>`)
2. ตรวจสอบความถูกต้องของ breadcrumb:
   - สามารถระบุ terminal ปัจจุบันได้
   - cwd ของ breadcrumb ตรงกับ cwd ปัจจุบัน (เปรียบเทียบเส้นทางที่แก้ไขแล้ว)
   - ไฟล์ที่อ้างอิงยังคงมีอยู่
3. หาก breadcrumb ไม่ถูกต้อง/ขาดหายไป ให้ใช้ไฟล์ที่ใหม่ที่สุดตาม mtime ในไดเรกทอรีเซสชันแทน (`findMostRecentSession`)
4. หากไม่พบ ให้สร้างเซสชันใหม่

การระบุ Terminal ID ให้ความสำคัญกับเส้นทาง TTY และใช้ตัวระบุที่อิงจาก env แทน (`KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION`)

การเขียน breadcrumb เป็นแบบ best-effort และไม่ทำให้เกิดข้อผิดพลาดร้ายแรง

## การแก้ไขเป้าหมายการเริ่มต้นใหม่ขณะเริ่มต้น (`main.ts`)

### `--resume <value>`

`createSessionManager(...)` จัดการ `--resume` ที่มีค่าเป็น string ในสองโหมด:

1. ค่าที่เหมือนเส้นทาง (มี `/`, `\\`, หรือลงท้ายด้วย `.jsonl`)
   - เปิดโดยตรงด้วย `SessionManager.open(sessionArg, parsed.sessionDir)`

2. ค่าคำนำหน้า ID
   - ค้นหาการจับคู่ใน `SessionManager.list(cwd, sessionDir)` โดย `id.startsWith(sessionArg)`
   - หากไม่พบการจับคู่ในเครื่องและไม่ได้บังคับใช้ `sessionDir` ให้ลองใช้ `SessionManager.listAll()`
   - ใช้การจับคู่แรกที่พบ (ไม่มีพรอมต์ให้แก้ความกำกวม)

พฤติกรรมการจับคู่ข้ามโปรเจกต์:

- หาก cwd ของเซสชันที่จับคู่แตกต่างจาก cwd ปัจจุบัน CLI จะพรอมต์ให้ถามว่าต้องการ fork ไปยังโปรเจกต์ปัจจุบันหรือไม่
- ใช่ -> `SessionManager.forkFrom(...)`
- ไม่ -> ส่งข้อผิดพลาด (`Session "..." is in another project (...)`)

ไม่พบการจับคู่ -> ส่งข้อผิดพลาด (`Session "..." not found.`)

### `--resume` (ไม่มีค่า)

จัดการหลังจากการสร้าง session-manager เริ่มต้น:

1. แสดงรายการเซสชันในเครื่องด้วย `SessionManager.list(cwd, parsed.sessionDir)`
2. หากว่างเปล่า: พิมพ์ `No sessions found` และออกก่อนกำหนด
3. เปิด TUI picker (`selectSession`)
4. หากยกเลิก: พิมพ์ `No session selected` และออกก่อนกำหนด
5. หากเลือก: `SessionManager.open(selectedPath)`

### `--continue`

ใช้ `SessionManager.continueRecent(...)` โดยตรง (พฤติกรรม breadcrumb-first ข้างต้น)

## การทำงานภายในของการเลือกผ่าน picker

## CLI picker (`src/cli/session-picker.ts`)

`selectSession(sessions)` สร้าง TUI แบบอิสระด้วย `SessionSelectorComponent` และแก้ไขหนึ่งครั้ง:

- การเลือก -> แก้ไขเส้นทางที่เลือก
- ยกเลิก (Esc) -> แก้ไขเป็น `null`
- ออกแบบ hard (เส้นทาง Ctrl+C) -> หยุด TUI และ `process.exit(0)`

## Interactive in-session picker (`SelectorController.showSessionSelector`)

ขั้นตอน:

1. ดึงเซสชันจากไดเรกทอรีเซสชันปัจจุบันผ่าน `SessionManager.list(currentCwd, currentSessionDir)`
2. ติดตั้ง `SessionSelectorComponent` ในพื้นที่แก้ไขโดยใช้ `showSelector(...)`
3. callbacks:
   - เลือก -> ปิด selector และเรียก `handleResumeSession(sessionPath)`
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

- แสดงข้อความแทนที่จะล้มเหลว
- Enter บนรายการว่างไม่ทำอะไร (ไม่มี callback)
- Esc/Ctrl+C ยังคงทำงานได้

ข้อควรระวัง: ข้อความ UI บอกว่า `Press Tab to view all` แต่ component นี้ในปัจจุบันไม่มี Tab handler และการเชื่อมต่อปัจจุบันแสดงรายการเฉพาะเซสชันในขอบเขตปัจจุบันเท่านั้น

## การดำเนินการสลับรันไทม์ (`AgentSession.switchSession`)

`switchSession(sessionPath)` คือเส้นทางการสลับในกระบวนการหลัก

วงจรชีวิต/การเปลี่ยนสถานะ:

1. บันทึก `previousSessionFile`
2. ส่ง hook event `session_before_switch` (`reason: "resume"`, สามารถยกเลิกได้)
3. หากยกเลิก -> คืนค่า `false` โดยไม่มีการสลับ
4. ตัดการเชื่อมต่อจาก agent event stream ปัจจุบัน
5. ยกเลิก generation/tool flow ที่ใช้งานอยู่
6. ล้าง buffer ข้อความ steering/follow-up/next-turn ที่อยู่ในคิว
7. flush session writer (`sessionManager.flush()`) เพื่อบันทึกการเขียนที่ค้างอยู่
8. `sessionManager.setSessionFile(sessionPath)`
   - อัปเดตตัวชี้ไฟล์เซสชัน
   - เขียน terminal breadcrumb
   - โหลดรายการ / migrate / blob-resolve / reindex
   - หากข้อมูลไฟล์ขาดหาย/ไม่ถูกต้อง: เริ่มต้นเซสชันใหม่ที่เส้นทางนั้นและเขียนส่วนหัวใหม่
9. อัปเดต `agent.sessionId`
10. สร้างบริบทใหม่ผ่าน `buildSessionContext()`
11. ส่ง hook event `session_switch` (`reason: "resume"`, `previousSessionFile`)
12. แทนที่ข้อความ agent ด้วยบริบทที่สร้างใหม่
13. กู้คืนโมเดลเริ่มต้นจาก `sessionContext.models.default` หากมีและอยู่ใน model registry
14. กู้คืนระดับการคิด:
    - หาก branch มี `thinking_level_change` อยู่แล้ว ให้ใช้ระดับเซสชันที่บันทึกไว้
    - มิฉะนั้น ให้ระบุระดับการคิดเริ่มต้นจากการตั้งค่า จำกัดให้เหมาะกับความสามารถของโมเดล ตั้งค่า และเพิ่มรายการ `thinking_level_change` ใหม่
15. เชื่อมต่อ agent listeners ใหม่และคืนค่า `true`

## การสร้างสถานะ UI ใหม่หลังการสลับแบบ interactive

`SelectorController.handleResumeSession` ดำเนินการรีเซ็ต UI รอบ `switchSession`:

- หยุด animation การโหลด
- ล้าง status container
- ล้าง UI ข้อความที่รอดำเนินการและ pending tool map
- รีเซ็ต streaming component/message references
- เรียก `session.switchSession(...)`
- ล้าง chat container และ rerender จาก session context (`renderInitialMessages`)
- โหลด todos ใหม่จาก artifacts ของเซสชันใหม่
- แสดง `Resumed session`

ดังนั้นสถานะการสนทนา/todo ที่มองเห็นได้จะถูกสร้างใหม่จากไฟล์เซสชันใหม่

## การเริ่มต้นใหม่ขณะเริ่มต้น vs การสลับในเซสชัน

### การเริ่มต้นใหม่ขณะเริ่มต้น (`--continue`, `--resume`, การเปิดโดยตรง)

- ไฟล์เซสชันถูกเลือกก่อน `createAgentSession(...)`
- `sdk.ts` สร้าง `existingSession = sessionManager.buildSessionContext()`
- ข้อความ agent ถูกกู้คืนครั้งเดียวระหว่างการสร้างเซสชัน
- โมเดล/การคิดถูกเลือกระหว่างการสร้าง (รวมถึงตรรกะการกู้คืน/สำรอง)
- โหมด interactive จากนั้นรัน `#restoreModeFromSession()` เพื่อกลับเข้าสู่สถานะโหมดที่บันทึกไว้ (ปัจจุบันคือ plan/plan_paused)

### การสลับในเซสชัน (เส้นทาง selector แบบ `/resume`)

- ใช้ `AgentSession.switchSession(...)` บน `AgentSession` ที่รันอยู่แล้ว
- ข้อความ/โมเดล/การคิดถูกสร้างใหม่ทันทีในที่นั้น
- Hook event `session_before_switch`/`session_switch` ถูกส่ง
- UI chat/todos ถูกรีเฟรช
- ไม่มีการเรียก mode restore หลังการสลับโดยเฉพาะใน selector flow; พฤติกรรมการกลับเข้าสู่โหมดไม่สมมาตรกับ `#restoreModeFromSession()` ขณะเริ่มต้น

## พฤติกรรมเมื่อเกิดความล้มเหลวและกรณีขอบ

### เส้นทางการยกเลิก

- ยกเลิก CLI picker -> คืนค่า `null`, ผู้เรียกพิมพ์ `No session selected`, กระบวนการออกก่อนกำหนด
- ยกเลิก interactive picker -> กู้คืน editor, ไม่มีการเปลี่ยนแปลงเซสชัน
- ยกเลิก hook (`session_before_switch`) -> `switchSession()` คืนค่า `false`

### เส้นทางรายการว่าง

- CLI `--resume` (ไม่มีค่า): รายการว่างพิมพ์ `No sessions found` และออก
- Interactive selector: รายการว่างแสดงข้อความและยังคงยกเลิกได้

### ไฟล์เซสชันเป้าหมายที่ขาดหาย/ไม่ถูกต้อง

เมื่อเปิด/สลับไปยังเส้นทางเฉพาะ (`setSessionFile`):

- ENOENT -> ถือว่าว่างเปล่า -> เริ่มต้นเซสชันใหม่ที่เส้นทางนั้นและบันทึก
- ส่วนหัวที่มีรูปแบบไม่ถูกต้อง/ไม่ถูกต้อง (หรือรายการที่แยกวิเคราะห์แล้วอ่านไม่ได้จริง) -> ถือว่าว่างเปล่า -> เริ่มต้นเซสชันใหม่และบันทึก

นี่คือพฤติกรรมการกู้คืน ไม่ใช่ความล้มเหลวร้ายแรง

### ความล้มเหลวร้ายแรง

การสลับ/เปิดยังคงสามารถส่งข้อผิดพลาดได้เมื่อเกิดความล้มเหลว I/O จริง (ข้อผิดพลาดสิทธิ์ ความล้มเหลวในการเขียนใหม่ ฯลฯ) ซึ่งจะส่งต่อไปยังผู้เรียก

### ข้อควรระวังเกี่ยวกับการจับคู่คำนำหน้า ID

- การจับคู่ ID ใช้ `startsWith` และใช้การจับคู่แรกในรายการที่เรียงลำดับ
- ไม่มี UI สำหรับแก้ความกำกวมหากหลายเซสชันมีคำนำหน้าเดียวกัน
- `SessionManager.list(...)` ยกเว้นเซสชันที่มีข้อความเป็นศูนย์ ดังนั้นเซสชันเหล่านั้นไม่สามารถเริ่มต้นใหม่ผ่านการจับคู่ ID/list picker ได้
