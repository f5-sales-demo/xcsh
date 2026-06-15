---
title: TUI Runtime ภายใน
description: >-
  TUI ภายในรันไทม์ของเทอร์มินัล UI ครอบคลุมไปป์ไลน์การเรนเดอร์ การจัดการอินพุต
  และการจัดการสถานะ
sidebar:
  order: 2
  label: ภายในรันไทม์
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# TUI ภายในรันไทม์

เอกสารนี้จัดทำแผนที่เส้นทางรันไทม์ที่ไม่ใช่ธีมจากอินพุตเทอร์มินัลไปยังผลลัพธ์ที่เรนเดอร์ในโหมดอินเทอร์แอคทีฟ โดยเน้นที่พฤติกรรมใน `packages/tui` และการผสานรวมจากคอนโทรลเลอร์ใน `packages/coding-agent`

## เลเยอร์รันไทม์และความเป็นเจ้าของ

- **เอนจิน `packages/tui`**: วงจรชีวิตเทอร์มินัล, การนอร์มัลไลซ์ stdin, การกำหนดเส้นทางโฟกัส, การตั้งเวลาเรนเดอร์, การวาดแบบดิฟเฟอเรนเชียล, การประกอบโอเวอร์เลย์, การวางเคอร์เซอร์ฮาร์ดแวร์
- **โหมดอินเทอร์แอคทีฟของ `packages/coding-agent`**: สร้างต้นไม้ส่วนประกอบ, ผูก callbacks ของตัวแก้ไขและ keymaps, ตอบสนองต่อเหตุการณ์ agent/session, และแปลสถานะโดเมน (สตรีมมิง, การเรียกใช้เครื่องมือ, การลองซ้ำ, โหมดแผน) เป็นส่วนประกอบ UI

กฎขอบเขต: เอนจิน TUI ไม่รับรู้ข้อความ มันรู้จักเพียง `Component.render(width)`, `handleInput(data)`, โฟกัส, และโอเวอร์เลย์ ความหมายของ Agent อยู่ในคอนโทรลเลอร์แบบอินเทอร์แอคทีฟ

## ไฟล์การนำไปใช้งาน

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

`InteractiveMode` สร้าง `TUI(new ProcessTerminal(), showHardwareCursor)` และสร้างคอนเทนเนอร์ที่คงอยู่:

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (เก็บ `CustomEditor`)

`init()` เชื่อมต้นไม้ตามลำดับนั้น, โฟกัสที่ตัวแก้ไข, ลงทะเบียน input handlers ผ่าน `InputController`, เริ่ม TUI, และขอการเรนเดอร์แบบบังคับ

การเรนเดอร์แบบบังคับ (`requestRender(true)`) รีเซ็ตแคชบรรทัดก่อนหน้าและการบุ๊กคีปปิ้งเคอร์เซอร์ก่อนการวาดใหม่

## วงจรชีวิตเทอร์มินัลและการนอร์มัลไลซ์ stdin

`ProcessTerminal.start()`:

1. เปิดใช้งานโหมด raw และ bracketed paste
2. แนบ resize handler
3. สร้าง `StdinBuffer` เพื่อแยก escape chunks ที่ไม่สมบูรณ์ออกเป็นลำดับที่สมบูรณ์
4. สอบถามการรองรับโปรโตคอลคีย์บอร์ด Kitty (`CSI ? u`) จากนั้นเปิดใช้งาน protocol flags หากรองรับ
5. บน Windows, พยายามเปิดใช้งาน VT input ผ่าน mode flags ของ `kernel32`

พฤติกรรมของ `StdinBuffer`:

- บัฟเฟอร์ลำดับ escape ที่แยกส่วน (CSI/OSC/DCS/APC/SS3)
- ส่งออก `data` เฉพาะเมื่อลำดับสมบูรณ์หรือ flush ตามเวลาหมดอายุ
- ตรวจจับ bracketed paste และส่งออกเหตุการณ์ `paste` พร้อมข้อความที่วางดิบ

สิ่งนี้ป้องกันไม่ให้ escape chunks ที่ไม่สมบูรณ์ถูกตีความผิดว่าเป็นการกดแป้นปกติ

## การกำหนดเส้นทางอินพุตและโมเดลโฟกัส

เส้นทางอินพุต:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

รายละเอียดการกำหนดเส้นทาง:

1. TUI รัน input listeners ที่ลงทะเบียนไว้ก่อน (`addInputListener`) ซึ่งช่วยให้มีพฤติกรรมการใช้/แปลง
2. TUI จัดการ global debug shortcut (`shift+ctrl+d`) ก่อนการ dispatch ส่วนประกอบ
3. หากส่วนประกอบที่โฟกัสอยู่ในโอเวอร์เลย์ที่ซ่อนอยู่/มองไม่เห็น, TUI จะกำหนดโฟกัสใหม่ไปยังโอเวอร์เลย์ที่มองเห็นถัดไปหรือโฟกัสก่อนโอเวอร์เลย์ที่บันทึกไว้
4. เหตุการณ์ key release จะถูกกรองออกเว้นแต่ส่วนประกอบที่โฟกัสตั้งค่า `wantsKeyRelease = true`
5. หลังจาก dispatch, TUI ตั้งเวลาเรนเดอร์

`setFocus()` ยังสลับ `Focusable.focused` ซึ่งควบคุมว่าส่วนประกอบส่ง `CURSOR_MARKER` สำหรับการวางเคอร์เซอร์ฮาร์ดแวร์หรือไม่

## การแยกการจัดการคีย์: editor กับ controller

`CustomEditor` สกัดกั้น combos ที่มีความสำคัญสูงก่อน (escape, ctrl-c/d/z, ctrl-v, ctrl-p variants, ctrl-t, alt-up, คีย์กำหนดเองของส่วนขยาย) และมอบสิ่งที่เหลือให้พฤติกรรมพื้นฐานของ `Editor` (การแก้ไขข้อความ, ประวัติ, การเติมข้อความอัตโนมัติ, การเลื่อนเคอร์เซอร์)

`InputController.setupKeyHandlers()` จากนั้นผูก editor callbacks กับการดำเนินการโหมด:

- การยกเลิก / การออกจากโหมดที่ `Escape`
- การปิดระบบเมื่อกด `Ctrl+C` สองครั้งหรือ `Ctrl+D` เมื่อ editor ว่างเปล่า
- ระงับ/ดำเนินการต่อที่ `Ctrl+Z`
- slash-command และ hotkeys ของตัวเลือก
- การสลับ follow-up/dequeue และการสลับการขยาย

สิ่งนี้รักษาการแยกวิเคราะห์คีย์/กลไก editor ไว้ใน `packages/tui` และความหมายของโหมดในคอนโทรลเลอร์ coding-agent

## วงจรเรนเดอร์และกลยุทธ์การ diff

`TUI.requestRender()` ถูก debounce ให้เรนเดอร์หนึ่งครั้งต่อ tick โดยใช้ `process.nextTick` การเปลี่ยนแปลงสถานะหลายรายการในรอบเดียวกันจะรวมกัน

ไปป์ไลน์ `#doRender()`:

1. เรนเดอร์ต้นไม้ส่วนประกอบรากไปยัง `newLines`
2. ประกอบโอเวอร์เลย์ที่มองเห็น (ถ้ามี)
3. ดึงและลบ `CURSOR_MARKER` ออกจากบรรทัดที่มองเห็นใน viewport
4. ต่อท้าย suffix รีเซ็ต segment สำหรับบรรทัดที่ไม่ใช่รูปภาพ
5. เลือกการวาดใหม่ทั้งหมดกับการแพตช์แบบดิฟเฟอเรนเชียล:
   - เฟรมแรก
   - การเปลี่ยนแปลงความกว้าง
   - การย่อขนาดด้วย `clearOnShrink` เปิดใช้งานและไม่มีโอเวอร์เลย์
   - การแก้ไขเหนือ viewport ก่อนหน้า
6. สำหรับการอัปเดตแบบดิฟเฟอเรนเชียล, แพตช์เฉพาะช่วงบรรทัดที่เปลี่ยนแปลงและล้างบรรทัดท้ายที่ล้าสมัยเมื่อจำเป็น
7. วางเคอร์เซอร์ฮาร์ดแวร์ใหม่สำหรับการรองรับ IME

การเขียนเรนเดอร์ใช้โหมดผลลัพธ์แบบซิงโครไนซ์ (`CSI ? 2026 h/l`) เพื่อลดการกะพริบ/การฉีกขาด

## ข้อจำกัดความปลอดภัยในการเรนเดอร์

การตรวจสอบความปลอดภัยที่สำคัญใน `TUI`:

- บรรทัดที่เรนเดอร์แล้วที่ไม่ใช่รูปภาพต้องไม่เกินความกว้างเทอร์มินัล; การล้นจะ throw และเขียน crash diagnostics
- การประกอบโอเวอร์เลย์รวมถึงการตัดทอนเชิงป้องกันและการตรวจสอบความกว้างหลังการประกอบ
- การเปลี่ยนแปลงความกว้างบังคับให้วาดใหม่ทั้งหมดเนื่องจากความหมายของการตัดบรรทัดเปลี่ยนแปลง
- ตำแหน่งเคอร์เซอร์ถูก clamp ก่อนการเลื่อน

ข้อจำกัดเหล่านี้คือการบังคับใช้รันไทม์ ไม่ใช่แค่แนวทางปฏิบัติ

## การจัดการการปรับขนาด

เหตุการณ์การปรับขนาดถูกขับเคลื่อนโดยเหตุการณ์จาก `ProcessTerminal` ไปยัง `TUI.requestRender()`

ผลกระทบ:

- การเปลี่ยนแปลงความกว้างใด ๆ จะกระตุ้นการวาดใหม่ทั้งหมด
- การติดตาม Viewport/top (`#previousViewportTop`, `#maxLinesRendered`) หลีกเลี่ยงคณิตศาสตร์เคอร์เซอร์สัมพัทธ์ที่ไม่ถูกต้องเมื่อเนื้อหาหรือขนาดเทอร์มินัลเปลี่ยนแปลง
- การมองเห็นโอเวอร์เลย์สามารถขึ้นอยู่กับมิติเทอร์มินัล (`OverlayOptions.visible`); โฟกัสได้รับการแก้ไขเมื่อโอเวอร์เลย์กลายเป็นไม่มองเห็นหลังการปรับขนาด

## การสตรีมและการอัปเดต UI แบบส่วนเพิ่ม

`EventController` สมัครสมาชิก `AgentSessionEvent` และอัปเดต UI แบบส่วนเพิ่ม:

- `agent_start`: เริ่ม loader ใน `statusContainer`
- `message_start` assistant: สร้าง `streamingComponent` และเมาท์
- `message_update`: อัปเดตเนื้อหา assistant ที่สตรีม; สร้าง/อัปเดตส่วนประกอบการเรียกใช้เครื่องมือเมื่อ tool calls ปรากฏขึ้น
- `tool_execution_update/end`: อัปเดตส่วนประกอบผลลัพธ์เครื่องมือและสถานะการเสร็จสมบูรณ์
- `message_end`: สรุป assistant stream, จัดการ annotations ที่ถูกยกเลิก/ข้อผิดพลาด, ทำเครื่องหมาย tool args ที่รอดำเนินการว่าสมบูรณ์เมื่อหยุดตามปกติ
- `agent_end`: หยุด loaders, ล้างสถานะ stream ชั่วคราว, flush การสลับโมเดลที่เลื่อนออกไป, ออกการแจ้งเตือนการเสร็จสมบูรณ์หากอยู่เบื้องหลัง

การจัดกลุ่ม read-tool มีสถานะโดยเจตนา (`#lastReadGroup`) เพื่อรวม tool calls read ที่ต่อเนื่องกันเป็นบล็อกภาพเดียวจนกว่าจะมีการหยุดที่ไม่ใช่ read เกิดขึ้น

## การจัดการ status และ loader

ความเป็นเจ้าของช่องสถานะ:

- `statusContainer` เก็บ loaders ชั่วคราว (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`)
- `statusLine` เรนเดอร์สถานะ/hooks/plan indicators ที่คงอยู่และขับเคลื่อนการอัปเดตขอบด้านบนของ editor

พฤติกรรม Loader:

- `Loader` อัปเดตทุก 80ms ผ่าน interval และขอเรนเดอร์ในแต่ละเฟรม
- Escape handlers ถูกแทนที่ชั่วคราวระหว่าง auto-compaction และ auto-retry เพื่อยกเลิกการดำเนินการเหล่านั้น
- บนเส้นทาง end/cancel, คอนโทรลเลอร์กู้คืน escape handlers ก่อนหน้าและหยุด/ล้างส่วนประกอบ loader

## การเปลี่ยนโหมดและการทำงานเบื้องหลัง

### โหมดอินพุต Bash/Python

คำนำหน้าข้อความอินพุตสลับ mode flags ขอบ editor:

- `!` -> โหมด bash
- `$` (คำนำหน้าที่ไม่ใช่ template literal) -> โหมด python

Escape ออกจากโหมดที่ไม่ทำงานโดยล้างข้อความ editor และกู้คืนสีขอบ; เมื่อการเรียกใช้งานทำงานอยู่, escape จะยกเลิกงานที่กำลังทำงานแทน

### โหมดแผน

`InteractiveMode` ติดตาม plan mode flags, สถานะของ status-line, เครื่องมือที่ทำงานอยู่, และการสลับโมเดล Enter/exit อัปเดตรายการโหมด session และสถานะ UI รวมถึงการสลับโมเดลที่เลื่อนออกไปหากกำลังสตรีม

### ระงับ/ดำเนินการต่อ (`Ctrl+Z`)

`InputController.handleCtrlZ()`:

1. ลงทะเบียน `SIGCONT` handler แบบ one-shot เพื่อรีสตาร์ท TUI และบังคับเรนเดอร์
2. หยุด TUI ก่อนระงับ
3. ส่ง `SIGTSTP` ไปยัง process group

### โหมดเบื้องหลัง (`/background` หรือ `/bg`)

`handleBackgroundCommand()`:

- ปฏิเสธเมื่อว่างเปล่า
- สลับบริบท tool UI เป็นแบบไม่อินเทอร์แอคทีฟ (`hasUI=false`) เพื่อให้เครื่องมือ interactive UI ล้มเหลวอย่างรวดเร็ว
- หยุด loaders/status line และยกเลิกการสมัครสมาชิก foreground event handler
- สมัครสมาชิก background event handler (รอ `agent_end` เป็นหลัก)
- หยุด TUI และส่ง `SIGTSTP` (เส้นทาง POSIX job control)

เมื่อ `agent_end` ในเบื้องหลังโดยไม่มีงานในคิว, คอนโทรลเลอร์จะส่งการแจ้งเตือนการเสร็จสมบูรณ์และปิดระบบ

## เส้นทางการยกเลิก

อินพุตการยกเลิกหลัก:

- `Escape` ระหว่าง active stream loader: กู้คืนข้อความที่อยู่ในคิวไปยัง editor และยกเลิก agent
- `Escape` ระหว่างการเรียกใช้งาน bash/python: ยกเลิกคำสั่งที่กำลังทำงาน
- `Escape` ระหว่าง auto-compaction/retry: เรียก abort methods เฉพาะผ่าน escape handlers ชั่วคราว
- `Ctrl+C` กดครั้งเดียว: ล้าง editor; กดสองครั้งภายใน 500ms: ปิดระบบ

การยกเลิกมีเงื่อนไขตามสถานะ; คีย์เดียวกันสามารถหมายถึงการยกเลิก, การออกจากโหมด, การกระตุ้นตัวเลือก, หรือไม่มีการดำเนินการ ขึ้นอยู่กับสถานะรันไทม์

## พฤติกรรมขับเคลื่อนด้วยเหตุการณ์กับแบบ throttled

การอัปเดตขับเคลื่อนด้วยเหตุการณ์:

- เหตุการณ์ agent session (`EventController`)
- key input callbacks (`InputController`)
- callback การปรับขนาดเทอร์มินัล
- ตัวเฝ้าดู theme/branch ใน `InteractiveMode`

เส้นทาง throttled/debounced:

- การเรนเดอร์ TUI ถูก tick-debounce (`requestRender` coalescing)
- แอนิเมชัน loader มีช่วงเวลาคงที่ (80ms), แต่ละเฟรมขอเรนเดอร์
- การอัปเดต autocomplete ของ editor (ภายใน `Editor`) ใช้ debounce timers เพื่อลดการคำนวณซ้ำระหว่างการพิมพ์

ดังนั้นรันไทม์จึงผสมผสานการเปลี่ยนสถานะขับเคลื่อนด้วยเหตุการณ์กับจังหวะการเรนเดอร์ที่มีขอบเขตเพื่อให้การตอบสนองต่อผู้ใช้รวดเร็วโดยไม่เกิดการวาดซ้ำมากเกินไป
