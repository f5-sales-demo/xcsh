---
title: ระบบภายในรันไทม์ TUI
description: >-
  ระบบภายในของรันไทม์ Terminal UI ครอบคลุม rendering pipeline, การจัดการอินพุต,
  และการจัดการสถานะ
sidebar:
  order: 2
  label: ระบบภายในรันไทม์
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# ระบบภายในรันไทม์ TUI

เอกสารนี้แสดงเส้นทางรันไทม์ที่ไม่เกี่ยวกับธีม ตั้งแต่อินพุตของเทอร์มินัลไปจนถึงเอาต์พุตที่เรนเดอร์แล้วในโหมดอินเทอร์แอคทีฟ โดยเน้นที่พฤติกรรมใน `packages/tui` และการผสานรวมจากคอนโทรลเลอร์ของ `packages/coding-agent`

## เลเยอร์รันไทม์และความเป็นเจ้าของ

- **เอนจิน `packages/tui`**: วงจรชีวิตของเทอร์มินัล, การทำให้ stdin เป็นมาตรฐาน, การกำหนดเส้นทางโฟกัส, การจัดตารางเรนเดอร์, การวาดแบบ differential, การประกอบ overlay, การวางตำแหน่ง hardware cursor
- **โหมดอินเทอร์แอคทีฟของ `packages/coding-agent`**: สร้างโครงสร้างต้นไม้คอมโพเนนต์, ผูก callback ของ editor และ keymap, ตอบสนองต่อเหตุการณ์ agent/session, และแปลสถานะโดเมน (streaming, การรัน tool, retry, plan mode) ไปเป็นคอมโพเนนต์ UI

กฎขอบเขต: เอนจิน TUI ไม่รับรู้เรื่องข้อความ มันรู้จักเพียง `Component.render(width)`, `handleInput(data)`, โฟกัส, และ overlay เท่านั้น ความหมายเชิง agent อยู่ในคอนโทรลเลอร์อินเทอร์แอคทีฟ

## ไฟล์การ implement

- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/components/custom-editor.ts`](../../packages/coding-agent/src/modes/components/custom-editor.ts)
- [`../../tui/src/tui.ts`](../../packages/tui/src/tui.ts)
- [`../../tui/src/terminal.ts`](../../packages/tui/src/terminal.ts)
- [`../../tui/src/editor-component.ts`](../../packages/tui/src/editor-component.ts)
- [`../../tui/src/stdin-buffer.ts`](../../packages/tui/src/stdin-buffer.ts)
- [`../../tui/src/components/loader.ts`](../../packages/tui/src/components/loader.ts)

## การบูตและการประกอบโครงสร้างต้นไม้คอมโพเนนต์

`InteractiveMode` สร้าง `TUI(new ProcessTerminal(), showHardwareCursor)` และสร้าง container แบบถาวร:

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (เก็บ `CustomEditor`)

`init()` เชื่อมโยงต้นไม้ตามลำดับดังกล่าว โฟกัสไปที่ editor ลงทะเบียน input handler ผ่าน `InputController` เริ่มต้น TUI และร้องขอการเรนเดอร์แบบบังคับ

การเรนเดอร์แบบบังคับ (`requestRender(true)`) จะรีเซ็ตแคชบรรทัดก่อนหน้าและข้อมูลติดตาม cursor ก่อนทาสีใหม่

## วงจรชีวิตเทอร์มินัลและการทำให้ stdin เป็นมาตรฐาน

`ProcessTerminal.start()`:

1. เปิดใช้งาน raw mode และ bracketed paste
2. แนบ handler สำหรับ resize
3. สร้าง `StdinBuffer` เพื่อแยก escape chunk ที่ไม่สมบูรณ์ออกเป็นลำดับที่สมบูรณ์
4. สอบถามการรองรับ Kitty keyboard protocol (`CSI ? u`) จากนั้นเปิดใช้งาน protocol flag หากรองรับ
5. บน Windows พยายามเปิดใช้งาน VT input ผ่าน mode flag ของ `kernel32`

พฤติกรรมของ `StdinBuffer`:

- บัฟเฟอร์ escape sequence ที่แตกออกเป็นส่วน (CSI/OSC/DCS/APC/SS3)
- ส่ง `data` เมื่อลำดับสมบูรณ์หรือ flush ตามหมดเวลาเท่านั้น
- ตรวจจับ bracketed paste และส่งเหตุการณ์ `paste` พร้อมข้อความที่วางดิบ

สิ่งนี้ป้องกันไม่ให้ escape chunk ที่ไม่สมบูรณ์ถูกตีความผิดเป็นการกดปุ่มปกติ

## การกำหนดเส้นทางอินพุตและโมเดลโฟกัส

เส้นทางอินพุต:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

รายละเอียดการกำหนดเส้นทาง:

1. TUI รัน input listener ที่ลงทะเบียนไว้ก่อน (`addInputListener`) โดยอนุญาตพฤติกรรม consume/transform
2. TUI จัดการ global debug shortcut (`shift+ctrl+d`) ก่อนส่งไปยังคอมโพเนนต์
3. หากคอมโพเนนต์ที่โฟกัสอยู่ใน overlay ที่ซ่อนอยู่/ไม่มองเห็น TUI จะกำหนดโฟกัสใหม่ไปยัง overlay ที่มองเห็นถัดไปหรือโฟกัสก่อน overlay ที่บันทึกไว้
4. เหตุการณ์ key release จะถูกกรองออก เว้นแต่คอมโพเนนต์ที่โฟกัสตั้งค่า `wantsKeyRelease = true`
5. หลังจากส่งไปแล้ว TUI จัดตารางเรนเดอร์

`setFocus()` ยังสลับ `Focusable.focused` ซึ่งควบคุมว่าคอมโพเนนต์จะส่ง `CURSOR_MARKER` สำหรับการวางตำแหน่ง hardware cursor หรือไม่

## การแบ่งการจัดการคีย์: editor กับ controller

`CustomEditor` ดักจับ combo ที่มีความสำคัญสูงก่อน (escape, ctrl-c/d/z, ctrl-v, ตัวแปร ctrl-p, ctrl-t, alt-up, คีย์กำหนดเองของ extension) และมอบส่วนที่เหลือให้พฤติกรรมพื้นฐานของ `Editor` (การแก้ไขข้อความ, ประวัติ, autocomplete, การเลื่อน cursor)

จากนั้น `InputController.setupKeyHandlers()` จะผูก callback ของ editor กับ action ของ mode:

- การยกเลิก / ออกจาก mode เมื่อกด `Escape`
- การปิดระบบเมื่อกด `Ctrl+C` สองครั้งหรือ `Ctrl+D` เมื่อ editor ว่าง
- หยุดชั่วคราว/ดำเนินต่อเมื่อกด `Ctrl+Z`
- slash-command และ selector hotkey
- สลับ follow-up/dequeue และสลับ expansion

สิ่งนี้ทำให้การแยกวิเคราะห์คีย์/กลไก editor อยู่ใน `packages/tui` และความหมายเชิง mode อยู่ในคอนโทรลเลอร์ coding-agent

## ลูปการเรนเดอร์และกลยุทธ์การ diff

`TUI.requestRender()` ถูก debounce เป็นหนึ่งครั้งต่อ tick โดยใช้ `process.nextTick` การเปลี่ยนสถานะหลายครั้งในรอบเดียวกันจะรวมกัน

ไปป์ไลน์ `#doRender()`:

1. เรนเดอร์โครงสร้างต้นไม้คอมโพเนนต์ root เป็น `newLines`
2. ประกอบ overlay ที่มองเห็น (ถ้ามี)
3. ดึงและลบ `CURSOR_MARKER` จากบรรทัด viewport ที่มองเห็น
4. เพิ่ม segment reset suffix สำหรับบรรทัดที่ไม่ใช่รูปภาพ
5. เลือกการทาสีใหม่ทั้งหมดหรือ differential patch:
   - เฟรมแรก
   - ความกว้างเปลี่ยน
   - หดตัวเมื่อเปิดใช้ `clearOnShrink` และไม่มี overlay
   - แก้ไขเหนือ viewport ก่อนหน้า
6. สำหรับการอัปเดตแบบ differential จะ patch เฉพาะช่วงบรรทัดที่เปลี่ยนและล้างบรรทัดท้ายที่ค้างอยู่เมื่อจำเป็น
7. ปรับตำแหน่ง hardware cursor สำหรับการรองรับ IME

การเขียนเรนเดอร์ใช้โหมด synchronized output (`CSI ? 2026 h/l`) เพื่อลดการกระพริบ/ฉีกขาด

## ข้อจำกัดด้านความปลอดภัยของการเรนเดอร์

การตรวจสอบความปลอดภัยที่สำคัญใน `TUI`:

- บรรทัดที่เรนเดอร์แล้วที่ไม่ใช่รูปภาพต้องไม่เกินความกว้างเทอร์มินัล การล้นจะ throw และเขียนข้อมูลวินิจฉัย crash
- การประกอบ overlay รวมการตัดทอนแบบป้องกันและการตรวจสอบความกว้างหลังประกอบ
- การเปลี่ยนความกว้างบังคับให้วาดใหม่ทั้งหมดเพราะความหมายของการตัดคำเปลี่ยน
- ตำแหน่ง cursor ถูก clamp ก่อนเลื่อน

ข้อจำกัดเหล่านี้เป็นการบังคับใช้ที่รันไทม์ ไม่ใช่แค่ข้อตกลง

## การจัดการ resize

เหตุการณ์ resize เป็นแบบ event-driven จาก `ProcessTerminal` ไปยัง `TUI.requestRender()`

ผลกระทบ:

- การเปลี่ยนความกว้างใดๆ จะเรียกการวาดใหม่ทั้งหมด
- การติดตาม viewport/top (`#previousViewportTop`, `#maxLinesRendered`) หลีกเลี่ยงการคำนวณ cursor สัมพัทธ์ที่ไม่ถูกต้องเมื่อเนื้อหาหรือขนาดเทอร์มินัลเปลี่ยน
- การมองเห็น overlay สามารถขึ้นอยู่กับขนาดเทอร์มินัล (`OverlayOptions.visible`); โฟกัสจะถูกแก้ไขเมื่อ overlay ไม่มองเห็นหลัง resize

## Streaming และการอัปเดต UI แบบ incremental

`EventController` subscribe ไปยัง `AgentSessionEvent` และอัปเดต UI แบบ incremental:

- `agent_start`: เริ่ม loader ใน `statusContainer`
- `message_start` assistant: สร้าง `streamingComponent` และ mount มัน
- `message_update`: อัปเดตเนื้อหา streaming ของ assistant; สร้าง/อัปเดตคอมโพเนนต์การรัน tool เมื่อ tool call ปรากฏ
- `tool_execution_update/end`: อัปเดตคอมโพเนนต์ผลลัพธ์ tool และสถานะการเสร็จสิ้น
- `message_end`: สิ้นสุดสตรีม assistant, จัดการ annotation ที่ถูกยกเลิก/ข้อผิดพลาด, ทำเครื่องหมาย arg ของ tool ที่ค้างอยู่ว่าสมบูรณ์เมื่อหยุดปกติ
- `agent_end`: หยุด loader, ล้างสถานะสตรีมชั่วคราว, flush การสลับโมเดลที่เลื่อนออกไป, ส่งการแจ้งเตือนเสร็จสิ้นหากอยู่ในโหมดพื้นหลัง

การจัดกลุ่ม read-tool เป็นแบบ stateful โดยเจตนา (`#lastReadGroup`) เพื่อรวม read tool call ที่ต่อเนื่องกันเป็นบล็อกภาพเดียวจนกว่าจะมีการแทรกที่ไม่ใช่ read

## การจัดการ status และ loader

ความเป็นเจ้าของช่อง status:

- `statusContainer` เก็บ loader ชั่วคราว (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`)
- `statusLine` เรนเดอร์ตัวบ่งชี้ status/hook/plan แบบถาวรและขับเคลื่อนการอัปเดตขอบบนของ editor

พฤติกรรม loader:

- `Loader` อัปเดตทุก 80ms ผ่าน interval และร้องขอเรนเดอร์ทุกเฟรม
- Escape handler จะถูกเขียนทับชั่วคราวระหว่าง auto-compaction และ auto-retry เพื่อยกเลิกการดำเนินการเหล่านั้น
- ในเส้นทาง end/cancel คอนโทรลเลอร์จะกู้คืน escape handler ก่อนหน้าและหยุด/ล้างคอมโพเนนต์ loader

## การเปลี่ยน mode และการทำงานพื้นหลัง

### โหมดอินพุต Bash/Python

คำนำหน้าข้อความอินพุตสลับ flag โหมดขอบ editor:

- `!` -> โหมด bash
- `$` (คำนำหน้าที่ไม่ใช่ template literal) -> โหมด python

Escape ออกจากโหมดที่ไม่ active โดยล้างข้อความ editor และกู้คืนสีขอบ; เมื่อมีการรันอยู่ escape จะยกเลิกงานที่กำลังรันแทน

### โหมด Plan

`InteractiveMode` ติดตาม flag ของ plan mode, สถานะ status-line, tool ที่ active, และการสลับโมเดล Enter/exit อัปเดตรายการ mode ของ session และสถานะ status/UI รวมถึงการสลับโมเดลที่เลื่อนออกไปหาก streaming อยู่

### หยุดชั่วคราว/ดำเนินต่อ (`Ctrl+Z`)

`InputController.handleCtrlZ()`:

1. ลงทะเบียน handler `SIGCONT` แบบครั้งเดียวเพื่อเริ่ม TUI ใหม่และบังคับเรนเดอร์
2. หยุด TUI ก่อนหยุดชั่วคราว
3. ส่ง `SIGTSTP` ไปยังกลุ่มโปรเซส

### โหมดพื้นหลัง (`/background` หรือ `/bg`)

`handleBackgroundCommand()`:

- ปฏิเสธเมื่อไม่มีงาน
- สลับบริบท UI ของ tool เป็นแบบไม่มีอินเทอร์แอคทีฟ (`hasUI=false`) เพื่อให้ UI tool แบบอินเทอร์แอคทีฟล้มเหลวทันที
- หยุด loader/status line และยกเลิกการ subscribe handler เหตุการณ์ foreground
- Subscribe handler เหตุการณ์ background (โดยหลักรอ `agent_end`)
- หยุด TUI และส่ง `SIGTSTP` (เส้นทาง POSIX job control)

เมื่อ `agent_end` ในโหมดพื้นหลังโดยไม่มีงานในคิว คอนโทรลเลอร์จะส่งการแจ้งเตือนเสร็จสิ้นและปิดระบบ

## เส้นทางการยกเลิก

อินพุตการยกเลิกหลัก:

- `Escape` ระหว่างสตรีม loader ที่ active: กู้คืนข้อความที่อยู่ในคิวไปยัง editor และยกเลิก agent
- `Escape` ระหว่างการรัน bash/python: ยกเลิกคำสั่งที่กำลังรัน
- `Escape` ระหว่าง auto-compaction/retry: เรียกใช้วิธียกเลิกเฉพาะผ่าน escape handler ชั่วคราว
- `Ctrl+C` กดครั้งเดียว: ล้าง editor; กดสองครั้งภายใน 500ms: ปิดระบบ

การยกเลิกเป็นแบบขึ้นอยู่กับสถานะ; คีย์เดียวกันอาจหมายถึง abort, ออกจาก mode, เรียก selector, หรือไม่ทำอะไร ขึ้นอยู่กับสถานะรันไทม์

## พฤติกรรมแบบ event-driven กับ throttled

การอัปเดตแบบ event-driven:

- เหตุการณ์ agent session (`EventController`)
- callback อินพุตคีย์ (`InputController`)
- callback resize ของเทอร์มินัล
- watcher ธีม/branch ใน `InteractiveMode`

เส้นทาง throttled/debounced:

- การเรนเดอร์ TUI ถูก debounce ตาม tick (การรวม `requestRender`)
- แอนิเมชัน loader เป็น fixed-interval (80ms) โดยแต่ละเฟรมร้องขอเรนเดอร์
- การอัปเดต autocomplete ของ editor (ภายใน `Editor`) ใช้ debounce timer เพื่อลดการคำนวณซ้ำระหว่างพิมพ์

ดังนั้นรันไทม์จึงผสมผสานการเปลี่ยนสถานะแบบ event-driven กับจังหวะการเรนเดอร์ที่มีขอบเขต เพื่อให้การโต้ตอบตอบสนองได้ดีโดยไม่เกิดการทาสีซ้ำจำนวนมาก
