---
title: ภายในรันไทม์ TUI
description: >-
  ภายในรันไทม์ของ Terminal UI ครอบคลุมไปป์ไลน์การเรนเดอร์ การจัดการอินพุต
  และการจัดการสถานะ
sidebar:
  order: 2
  label: ภายในรันไทม์
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# ภายในรันไทม์ TUI

เอกสารนี้แมปเส้นทางรันไทม์ที่ไม่ใช่ธีมจากอินพุตของเทอร์มินัลไปยังเอาต์พุตที่เรนเดอร์แล้วในโหมดอินเทอร์แอกทีฟ โดยเน้นไปที่พฤติกรรมใน `packages/tui` และการผสานรวมจากคอนโทรลเลอร์ใน `packages/coding-agent`

## เลเยอร์รันไทม์และความเป็นเจ้าของ

- **เอนจิน `packages/tui`**: วงจรชีวิตของเทอร์มินัล, การทำให้ stdin เป็นมาตรฐาน, การกำหนดเส้นทางโฟกัส, การจัดตารางการเรนเดอร์, การวาดภาพแบบดิฟเฟอเรนเชียล, การประกอบโอเวอร์เลย์, การวางเคอร์เซอร์ฮาร์ดแวร์
- **โหมดอินเทอร์แอกทีฟ `packages/coding-agent`**: สร้างต้นไม้ส่วนประกอบ, ผูก callbacks ของ editor และ keymaps, ตอบสนองต่อเหตุการณ์ agent/session, และแปลงสถานะโดเมน (สตรีมมิง, การรันเครื่องมือ, การลองใหม่, โหมดแผน) เป็นส่วนประกอบ UI

กฎขอบเขต: เอนจิน TUI ไม่รู้จักข้อความ โดยรู้จักเพียง `Component.render(width)`, `handleInput(data)`, โฟกัส และโอเวอร์เลย์เท่านั้น ความหมายของ Agent อยู่ในคอนโทรลเลอร์อินเทอร์แอกทีฟ

## ไฟล์การ implementation

- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/components/custom-editor.ts`](../../packages/coding-agent/src/modes/components/custom-editor.ts)
- [`../../tui/src/tui.ts`](../../packages/tui/src/tui.ts)
- [`../../tui/src/terminal.ts`](../../packages/tui/src/terminal.ts)
- [`../../tui/src/editor-component.ts`](../../packages/tui/src/editor-component.ts)
- [`../../tui/src/stdin-buffer.ts`](../../packages/tui/src/stdin-buffer.ts)
- [`../../tui/src/components/loader.ts`](../../packages/tui/src/components/loader.ts)

## การบูตและการประกอบต้นไม้ส่วนประกอบ

`InteractiveMode` สร้าง `TUI(new ProcessTerminal(), showHardwareCursor)` และสร้างคอนเทนเนอร์แบบถาวร:

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (เก็บ `CustomEditor`)

`init()` เชื่อมโยงต้นไม้ตามลำดับดังกล่าว, โฟกัส editor, ลงทะเบียน input handlers ผ่าน `InputController`, เริ่ม TUI และขอการเรนเดอร์แบบบังคับ

การเรนเดอร์แบบบังคับ (`requestRender(true)`) รีเซ็ตแคชบรรทัดก่อนหน้าและการจัดการเคอร์เซอร์ก่อนทำการวาดใหม่

## วงจรชีวิตของเทอร์มินัลและการทำให้ stdin เป็นมาตรฐาน

`ProcessTerminal.start()`:

1. เปิดใช้งาน raw mode และ bracketed paste
2. แนบ resize handler
3. สร้าง `StdinBuffer` เพื่อแยก escape chunks บางส่วนออกเป็น sequences ที่สมบูรณ์
4. สอบถามการรองรับ Kitty keyboard protocol (`CSI ? u`) จากนั้นเปิดใช้งาน protocol flags หากรองรับ
5. บน Windows ลองเปิดใช้งาน VT input ผ่าน `kernel32` mode flags

พฤติกรรมของ `StdinBuffer`:

- บัฟเฟอร์ escape sequences ที่แตกเป็นส่วนๆ (CSI/OSC/DCS/APC/SS3)
- ส่ง `data` เฉพาะเมื่อ sequence สมบูรณ์หรือหมดเวลาและ flush
- ตรวจจับ bracketed paste และส่งเหตุการณ์ `paste` พร้อมข้อความที่วางดิบ

สิ่งนี้ป้องกันไม่ให้ escape chunks บางส่วนถูกตีความผิดว่าเป็น keypresses ปกติ

## การกำหนดเส้นทางอินพุตและโมเดลโฟกัส

เส้นทางอินพุต:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

รายละเอียดการกำหนดเส้นทาง:

1. TUI รัน input listeners ที่ลงทะเบียนไว้ก่อน (`addInputListener`) ซึ่งอนุญาตให้มีพฤติกรรม consume/transform
2. TUI จัดการ global debug shortcut (`shift+ctrl+d`) ก่อนการส่งต่อไปยังส่วนประกอบ
3. หากส่วนประกอบที่โฟกัสอยู่เป็นของโอเวอร์เลย์ที่ถูกซ่อน/มองไม่เห็นในตอนนี้ TUI จะกำหนดโฟกัสใหม่ไปยังโอเวอร์เลย์ที่มองเห็นได้ถัดไปหรือโฟกัสก่อนโอเวอร์เลย์ที่บันทึกไว้
4. เหตุการณ์การปล่อยปุ่มจะถูกกรองออกเว้นแต่ส่วนประกอบที่โฟกัสจะตั้งค่า `wantsKeyRelease = true`
5. หลังการส่งต่อ TUI จะจัดตารางการเรนเดอร์

`setFocus()` ยังสลับ `Focusable.focused` ซึ่งควบคุมว่าส่วนประกอบจะส่ง `CURSOR_MARKER` เพื่อวางเคอร์เซอร์ฮาร์ดแวร์หรือไม่

## การแยกการจัดการปุ่ม: editor กับ controller

`CustomEditor` สกัดกั้น combos ที่มีลำดับความสำคัญสูงก่อน (escape, ctrl-c/d/z, ctrl-v, ctrl-p variants, ctrl-t, alt-up, extension custom keys) และมอบหมายส่วนที่เหลือให้กับพฤติกรรม `Editor` พื้นฐาน (การแก้ไขข้อความ, ประวัติ, การเติมข้อความอัตโนมัติ, การเลื่อนเคอร์เซอร์)

`InputController.setupKeyHandlers()` จากนั้นผูก editor callbacks กับ mode actions:

- การยกเลิก / การออกจากโหมดด้วย `Escape`
- การปิดระบบด้วย `Ctrl+C` สองครั้งหรือ `Ctrl+D` ที่ editor ว่างเปล่า
- การระงับ/การเล่นต่อด้วย `Ctrl+Z`
- slash-command และ selector hotkeys
- การสลับ follow-up/dequeue และการสลับการขยาย

สิ่งนี้เก็บการแยกวิเคราะห์ปุ่ม/กลไก editor ไว้ใน `packages/tui` และความหมายของโหมดไว้ในคอนโทรลเลอร์ coding-agent

## ลูปการเรนเดอร์และกลยุทธ์การ diff

`TUI.requestRender()` ถูก debounce ให้เป็นหนึ่งการเรนเดอร์ต่อ tick โดยใช้ `process.nextTick` การเปลี่ยนแปลงสถานะหลายอย่างใน turn เดียวกันจะรวมกัน

ไปป์ไลน์ `#doRender()`:

1. เรนเดอร์ต้นไม้ส่วนประกอบ root ไปยัง `newLines`
2. ประกอบโอเวอร์เลย์ที่มองเห็นได้ (หากมี)
3. ดึงและลบ `CURSOR_MARKER` ออกจากบรรทัด viewport ที่มองเห็นได้
4. เพิ่ม segment reset suffixes สำหรับบรรทัดที่ไม่ใช่รูปภาพ
5. เลือกการวาดใหม่แบบเต็มรูปแบบเทียบกับการแก้ไขแบบดิฟเฟอเรนเชียล:
   - เฟรมแรก
   - การเปลี่ยนแปลงความกว้าง
   - การลดขนาดโดยมี `clearOnShrink` เปิดใช้งานและไม่มีโอเวอร์เลย์
   - การแก้ไขเหนือ viewport ก่อนหน้า
6. สำหรับการอัปเดตแบบดิฟเฟอเรนเชียล ให้แก้ไขเฉพาะช่วงบรรทัดที่เปลี่ยนแปลงและล้างบรรทัดส่วนท้ายที่เก่าเมื่อจำเป็น
7. กำหนดตำแหน่งเคอร์เซอร์ฮาร์ดแวร์ใหม่สำหรับการรองรับ IME

การเขียนการเรนเดอร์ใช้โหมด synchronized output (`CSI ? 2026 h/l`) เพื่อลดการกะพริบ/การฉีกขาด

## ข้อจำกัดด้านความปลอดภัยในการเรนเดอร์

การตรวจสอบความปลอดภัยที่สำคัญใน `TUI`:

- บรรทัดที่เรนเดอร์แล้วที่ไม่ใช่รูปภาพต้องไม่เกินความกว้างของเทอร์มินัล การล้นจะ throw และเขียน crash diagnostics
- การประกอบโอเวอร์เลย์รวมถึงการตัดทอนแบบป้องกันและการตรวจสอบความกว้างหลังการประกอบ
- การเปลี่ยนแปลงความกว้างบังคับให้วาดใหม่แบบเต็มรูปแบบเนื่องจากความหมายของการตัดบรรทัดเปลี่ยนแปลง
- ตำแหน่งเคอร์เซอร์ถูก clamp ก่อนการเลื่อน

ข้อจำกัดเหล่านี้เป็นการบังคับใช้รันไทม์ ไม่ใช่แค่ข้อตกลง

## การจัดการการปรับขนาด

เหตุการณ์การปรับขนาดเป็น event-driven จาก `ProcessTerminal` ไปยัง `TUI.requestRender()`

ผลกระทบ:

- การเปลี่ยนแปลงความกว้างใดๆ จะทริกเกอร์การวาดใหม่แบบเต็มรูปแบบ
- การติดตาม Viewport/top (`#previousViewportTop`, `#maxLinesRendered`) หลีกเลี่ยงการคำนวณเคอร์เซอร์สัมพัทธ์ที่ไม่ถูกต้องเมื่อเนื้อหาหรือขนาดเทอร์มินัลเปลี่ยนแปลง
- การมองเห็นโอเวอร์เลย์อาจขึ้นอยู่กับขนาดของเทอร์มินัล (`OverlayOptions.visible`); โฟกัสจะถูกแก้ไขเมื่อโอเวอร์เลย์ไม่สามารถมองเห็นได้หลังการปรับขนาด

## การสตรีมและการอัปเดต UI แบบเพิ่มทีละน้อย

`EventController` สมัครรับ `AgentSessionEvent` และอัปเดต UI แบบเพิ่มทีละน้อย:

- `agent_start`: เริ่ม loader ใน `statusContainer`
- `message_start` assistant: สร้าง `streamingComponent` และ mount
- `message_update`: อัปเดตเนื้อหา assistant ที่กำลังสตรีม; สร้าง/อัปเดตส่วนประกอบการรัน tool เมื่อ tool calls ปรากฏขึ้น
- `tool_execution_update/end`: อัปเดตส่วนประกอบผลลัพธ์ tool และสถานะความสมบูรณ์
- `message_end`: สรุป assistant stream, จัดการ annotations ที่ถูกยกเลิก/เกิดข้อผิดพลาด, ทำเครื่องหมาย tool args ที่รอดำเนินการให้สมบูรณ์เมื่อหยุดปกติ
- `agent_end`: หยุด loaders, ล้างสถานะ stream ชั่วคราว, flush model switch ที่เลื่อนไว้, ส่งการแจ้งเตือนความสมบูรณ์หากอยู่เบื้องหลัง

การจัดกลุ่ม read-tool เป็นแบบ stateful โดยตั้งใจ (`#lastReadGroup`) เพื่อรวม read tool calls ที่ต่อเนื่องกันเป็นหนึ่งบล็อกภาพจนกว่าจะเกิด non-read break

## การจัดการสถานะและ loader

ความเป็นเจ้าของเลน status:

- `statusContainer` เก็บ loaders ชั่วคราว (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`)
- `statusLine` เรนเดอร์ตัวบ่งชี้ status/hooks/plan แบบถาวรและขับเคลื่อนการอัปเดต top border ของ editor

พฤติกรรม Loader:

- `Loader` อัปเดตทุก 80ms ผ่าน interval และขอการเรนเดอร์ทุกเฟรม
- Escape handlers ถูกแทนที่ชั่วคราวระหว่าง auto-compaction และ auto-retry เพื่อยกเลิกการทำงานเหล่านั้น
- บนเส้นทาง end/cancel คอนโทรลเลอร์จะคืนค่า escape handlers ก่อนหน้าและหยุด/ล้างส่วนประกอบ loader

## การเปลี่ยนโหมดและการทำงานเบื้องหลัง

### โหมดอินพุต Bash/Python

คำนำหน้าข้อความอินพุตสลับ editor border mode flags:

- `!` -> โหมด bash
- `$` (คำนำหน้าที่ไม่ใช่ template literal) -> โหมด python

Escape ออกจากโหมดที่ไม่ทำงานโดยล้างข้อความ editor และคืนค่าสีขอบ; เมื่อการรันทำงานอยู่ escape จะยกเลิก task ที่กำลังรันแทน

### โหมดแผน

`InteractiveMode` ติดตาม plan mode flags, สถานะ status-line, active tools และการสลับโมเดล การเข้า/ออกจะอัปเดต session mode entries และสถานะ status/UI รวมถึง deferred model switch หากการสตรีมทำงานอยู่

### การระงับ/การเล่นต่อ (`Ctrl+Z`)

`InputController.handleCtrlZ()`:

1. ลงทะเบียน one-shot `SIGCONT` handler เพื่อรีสตาร์ท TUI และบังคับการเรนเดอร์
2. หยุด TUI ก่อนการระงับ
3. ส่ง `SIGTSTP` ไปยัง process group

### โหมดเบื้องหลัง (`/background` หรือ `/bg`)

`handleBackgroundCommand()`:

- ปฏิเสธเมื่อไม่ทำงาน
- สลับบริบท tool UI ไปยัง non-interactive (`hasUI=false`) เพื่อให้ interactive UI tools ล้มเหลวเร็ว
- หยุด loaders/status line และยกเลิกการสมัครรับ foreground event handler
- สมัครรับ background event handler (รอ `agent_end` เป็นหลัก)
- หยุด TUI และส่ง `SIGTSTP` (เส้นทาง POSIX job control)

เมื่อ `agent_end` ในเบื้องหลังโดยไม่มีงานในคิว คอนโทรลเลอร์จะส่งการแจ้งเตือนความสมบูรณ์และปิดระบบ

## เส้นทางการยกเลิก

อินพุตการยกเลิกหลัก:

- `Escape` ระหว่าง active stream loader: คืนค่าข้อความที่อยู่ในคิวไปยัง editor และยกเลิก agent
- `Escape` ระหว่างการรัน bash/python: ยกเลิกคำสั่งที่กำลังรัน
- `Escape` ระหว่าง auto-compaction/retry: เรียก dedicated abort methods ผ่าน temporary escape handlers
- `Ctrl+C` กดครั้งเดียว: ล้าง editor; กดสองครั้งภายใน 500ms: ปิดระบบ

การยกเลิกขึ้นอยู่กับเงื่อนไขสถานะ; ปุ่มเดียวกันอาจหมายถึงการยกเลิก, การออกจากโหมด, การทริกเกอร์ selector หรือ no-op ขึ้นอยู่กับสถานะรันไทม์

## พฤติกรรม event-driven กับ throttled

การอัปเดตแบบ event-driven:

- เหตุการณ์ Agent session (`EventController`)
- Key input callbacks (`InputController`)
- terminal resize callback
- theme/branch watchers ใน `InteractiveMode`

เส้นทาง throttled/debounced:

- การเรนเดอร์ TUI ถูก tick-debounced (การรวม `requestRender`)
- แอนิเมชัน Loader เป็น fixed-interval (80ms) โดยแต่ละเฟรมขอการเรนเดอร์
- การอัปเดต autocomplete ของ editor (ภายใน `Editor`) ใช้ debounce timers เพื่อลดการคำนวณซ้ำระหว่างการพิมพ์

รันไทม์จึงผสมผสานการเปลี่ยนสถานะแบบ event-driven กับความถี่การเรนเดอร์ที่มีขอบเขตเพื่อให้การโต้ตอบตอบสนองได้โดยไม่เกิด repaint storms
