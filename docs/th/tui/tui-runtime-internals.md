---
title: TUI Runtime Internals
description: >-
  รายละเอียดภายในของ Terminal UI runtime ครอบคลุม rendering pipeline,
  การจัดการอินพุต และการจัดการสถานะ
sidebar:
  order: 2
  label: รายละเอียดภายในของ Runtime
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# รายละเอียดภายในของ TUI runtime

เอกสารนี้แสดงเส้นทาง runtime ที่ไม่ใช่ธีม ตั้งแต่การรับอินพุตจากเทอร์มินัลจนถึงเอาต์พุตที่เรนเดอร์ในโหมด interactive โดยมุ่งเน้นที่พฤติกรรมใน `packages/tui` และการรวมเข้ากับคอนโทรลเลอร์ของ `packages/coding-agent`

## เลเยอร์ runtime และความเป็นเจ้าของ

- **เอนจิน `packages/tui`**: วงจรชีวิตของเทอร์มินัล, การทำให้ stdin เป็นมาตรฐาน, การกำหนดเส้นทาง focus, การจัดตารางเรนเดอร์, การวาดแบบส่วนต่าง, การรวม overlay, การวางตำแหน่งเคอร์เซอร์ฮาร์ดแวร์
- **โหมด interactive ของ `packages/coding-agent`**: สร้าง component tree, ผูก callback และ keymap ของ editor, ตอบสนองต่อเหตุการณ์ agent/session และแปลสถานะโดเมน (streaming, การทำงานของ tool, การลองใหม่, plan mode) เป็น UI component

กฎเขตแดน: เอนจิน TUI ไม่เกี่ยวข้องกับข้อความ มันรู้จักเพียง `Component.render(width)`, `handleInput(data)`, focus และ overlay เท่านั้น ความหมายของ agent อยู่ในคอนโทรลเลอร์ interactive

## ไฟล์ implementation

- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/components/custom-editor.ts`](../../packages/coding-agent/src/modes/components/custom-editor.ts)
- [`../../tui/src/tui.ts`](../../packages/tui/src/tui.ts)
- [`../../tui/src/terminal.ts`](../../packages/tui/src/terminal.ts)
- [`../../tui/src/editor-component.ts`](../../packages/tui/src/editor-component.ts)
- [`../../tui/src/stdin-buffer.ts`](../../packages/tui/src/stdin-buffer.ts)
- [`../../tui/src/components/loader.ts`](../../packages/tui/src/components/loader.ts)

## การบูตและการประกอบ component tree

`InteractiveMode` สร้าง `TUI(new ProcessTerminal(), showHardwareCursor)` และสร้างคอนเทนเนอร์ถาวร:

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (เก็บ `CustomEditor`)

`init()` เชื่อมต่อ tree ตามลำดับดังกล่าว ตั้ง focus ที่ editor ลงทะเบียน input handler ผ่าน `InputController` เริ่ม TUI และร้องขอการเรนเดอร์แบบบังคับ

การเรนเดอร์แบบบังคับ (`requestRender(true)`) จะรีเซ็ตแคชบรรทัดก่อนหน้าและการติดตามเคอร์เซอร์ก่อนวาดใหม่

## วงจรชีวิตของเทอร์มินัลและการทำให้ stdin เป็นมาตรฐาน

`ProcessTerminal.start()`:

1. เปิดใช้งาน raw mode และ bracketed paste
2. แนบ resize handler
3. สร้าง `StdinBuffer` เพื่อแยกชิ้นส่วน escape ที่ไม่สมบูรณ์ออกเป็นลำดับที่สมบูรณ์
4. สอบถามการรองรับ Kitty keyboard protocol (`CSI ? u`) จากนั้นเปิดใช้งานแฟล็กโปรโตคอลหากรองรับ
5. บน Windows พยายามเปิดใช้งาน VT input ผ่านแฟล็กโหมด `kernel32`

พฤติกรรมของ `StdinBuffer`:

- บัฟเฟอร์ลำดับ escape ที่แยกส่วน (CSI/OSC/DCS/APC/SS3)
- ส่ง `data` เฉพาะเมื่อลำดับสมบูรณ์หรือ flush ตาม timeout
- ตรวจจับ bracketed paste และส่งเหตุการณ์ `paste` พร้อมข้อความที่วางแบบ raw

สิ่งนี้ป้องกันไม่ให้ชิ้นส่วน escape ที่ไม่สมบูรณ์ถูกตีความผิดเป็นการกดคีย์ปกติ

## การกำหนดเส้นทางอินพุตและโมเดล focus

เส้นทางอินพุต:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

รายละเอียดการกำหนดเส้นทาง:

1. TUI รัน input listener ที่ลงทะเบียนไว้ก่อน (`addInputListener`) อนุญาตให้มีพฤติกรรม consume/transform
2. TUI จัดการทางลัด debug ส่วนกลาง (`shift+ctrl+d`) ก่อนการส่งไปยัง component
3. ถ้า focused component อยู่ใน overlay ที่ตอนนี้ซ่อน/มองไม่เห็น TUI จะกำหนด focus ใหม่ให้ overlay ที่มองเห็นถัดไปหรือ focus ก่อน overlay ที่บันทึกไว้
4. เหตุการณ์ key release จะถูกกรองออก เว้นแต่ focused component ตั้งค่า `wantsKeyRelease = true`
5. หลังจากส่ง TUI จัดตารางเรนเดอร์

`setFocus()` ยังสลับ `Focusable.focused` ซึ่งควบคุมว่า component จะส่ง `CURSOR_MARKER` สำหรับการวางตำแหน่งเคอร์เซอร์ฮาร์ดแวร์หรือไม่

## การแบ่งการจัดการคีย์: editor เทียบกับ controller

`CustomEditor` ดักจับคอมโบที่มีความสำคัญสูงก่อน (escape, ctrl-c/d/z, ctrl-v, ctrl-p ชนิดต่างๆ, ctrl-t, alt-up, คีย์กำหนดเองของ extension) และมอบหมายส่วนที่เหลือให้พฤติกรรม `Editor` พื้นฐาน (การแก้ไขข้อความ, ประวัติ, autocomplete, การเลื่อนเคอร์เซอร์)

`InputController.setupKeyHandlers()` จากนั้นผูก callback ของ editor กับการกระทำของโหมด:

- การยกเลิก / การออกจากโหมดเมื่อ `Escape`
- การปิดระบบเมื่อกด `Ctrl+C` สองครั้งหรือ `Ctrl+D` เมื่อ editor ว่าง
- การ suspend/resume เมื่อ `Ctrl+Z`
- ทางลัดคำสั่ง slash และตัวเลือก
- การสลับ follow-up/dequeue และการสลับขยาย

สิ่งนี้ทำให้การแยกวิเคราะห์คีย์/กลไก editor อยู่ใน `packages/tui` และความหมายของโหมดอยู่ในคอนโทรลเลอร์ coding-agent

## ลูปเรนเดอร์และกลยุทธ์ diffing

`TUI.requestRender()` ถูก debounce เป็นหนึ่งเรนเดอร์ต่อ tick โดยใช้ `process.nextTick` การเปลี่ยนแปลงสถานะหลายรายการในรอบเดียวกันจะถูกรวม

ไปป์ไลน์ `#doRender()`:

1. เรนเดอร์ root component tree เป็น `newLines`
2. รวม overlay ที่มองเห็น (ถ้ามี)
3. แยกและลบ `CURSOR_MARKER` จากบรรทัด viewport ที่มองเห็น
4. เพิ่ม segment reset suffix สำหรับบรรทัดที่ไม่ใช่รูปภาพ
5. เลือกการวาดใหม่ทั้งหมดเทียบกับการ patch แบบส่วนต่าง:
   - เฟรมแรก
   - การเปลี่ยนความกว้าง
   - การหดตัวเมื่อเปิดใช้งาน `clearOnShrink` และไม่มี overlay
   - การแก้ไขเหนือ viewport ก่อนหน้า
6. สำหรับการอัปเดตแบบส่วนต่าง จะ patch เฉพาะช่วงบรรทัดที่เปลี่ยนแปลงและล้างบรรทัดท้ายที่ล้าสมัยเมื่อจำเป็น
7. ปรับตำแหน่งเคอร์เซอร์ฮาร์ดแวร์สำหรับการรองรับ IME

การเขียนเรนเดอร์ใช้โหมด synchronized output (`CSI ? 2026 h/l`) เพื่อลดการกะพริบ/การฉีกขาด

## ข้อจำกัดด้านความปลอดภัยในการเรนเดอร์

การตรวจสอบความปลอดภัยที่สำคัญใน `TUI`:

- บรรทัดที่เรนเดอร์ที่ไม่ใช่รูปภาพต้องไม่เกินความกว้างของเทอร์มินัล การล้นจะ throw และเขียนข้อมูลวินิจฉัยการ crash
- การรวม overlay มีการตัดทอนเชิงป้องกันและการตรวจสอบความกว้างหลังการรวม
- การเปลี่ยนความกว้างจะบังคับวาดใหม่ทั้งหมดเพราะความหมายของการตัดบรรทัดเปลี่ยนไป
- ตำแหน่งเคอร์เซอร์จะถูก clamp ก่อนเคลื่อนย้าย

ข้อจำกัดเหล่านี้เป็นการบังคับใช้ใน runtime ไม่ใช่แค่ข้อตกลง

## การจัดการ resize

เหตุการณ์ resize เป็นแบบ event-driven จาก `ProcessTerminal` ไปยัง `TUI.requestRender()`

ผลกระทบ:

- การเปลี่ยนความกว้างใดๆ จะกระตุ้นการวาดใหม่ทั้งหมด
- การติดตาม viewport/top (`#previousViewportTop`, `#maxLinesRendered`) หลีกเลี่ยงการคำนวณตำแหน่งเคอร์เซอร์สัมพัทธ์ที่ไม่ถูกต้องเมื่อเนื้อหาหรือขนาดเทอร์มินัลเปลี่ยน
- การมองเห็น overlay อาจขึ้นอยู่กับขนาดเทอร์มินัล (`OverlayOptions.visible`); focus จะถูกแก้ไขเมื่อ overlay มองไม่เห็นหลังจาก resize

## การ streaming และการอัปเดต UI แบบเพิ่มขึ้น

`EventController` สมัครรับ `AgentSessionEvent` และอัปเดต UI แบบเพิ่มขึ้น:

- `agent_start`: เริ่ม loader ใน `statusContainer`
- `message_start` assistant: สร้าง `streamingComponent` และ mount มัน
- `message_update`: อัปเดตเนื้อหา assistant แบบ streaming; สร้าง/อัปเดต component การทำงานของ tool เมื่อ tool call ปรากฏ
- `tool_execution_update/end`: อัปเดต component ผลลัพธ์ tool และสถานะเสร็จสมบูรณ์
- `message_end`: สรุปสตรีม assistant, จัดการ annotation ที่ถูกยกเลิก/ข้อผิดพลาด, ทำเครื่องหมาย tool arg ที่รอดำเนินการว่าสมบูรณ์เมื่อหยุดปกติ
- `agent_end`: หยุด loader, ล้างสถานะ stream ชั่วคราว, flush การเปลี่ยนโมเดลที่รอ, ส่งการแจ้งเตือนเสร็จสมบูรณ์หากทำงานอยู่เบื้องหลัง

การจัดกลุ่ม read-tool เป็นแบบ stateful โดยตั้งใจ (`#lastReadGroup`) เพื่อรวม tool call แบบ read ที่ต่อเนื่องกันเป็นบล็อกภาพเดียวจนกว่าจะมีการหยุดที่ไม่ใช่ read

## การจัดการสถานะและ loader

ความเป็นเจ้าของช่องสถานะ:

- `statusContainer` เก็บ loader ชั่วคราว (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`)
- `statusLine` เรนเดอร์ตัวบ่งชี้สถานะ/hook/plan ที่ถาวรและขับเคลื่อนการอัปเดตขอบบนของ editor

พฤติกรรม Loader:

- `Loader` อัปเดตทุก 80ms ผ่าน interval และร้องขอเรนเดอร์ในแต่ละเฟรม
- Escape handler ถูกแทนที่ชั่วคราวระหว่าง auto-compaction และ auto-retry เพื่อยกเลิกการดำเนินการเหล่านั้น
- เมื่อจบ/ยกเลิก คอนโทรลเลอร์จะกู้คืน escape handler ก่อนหน้าและหยุด/ล้าง loader component

## การเปลี่ยนโหมดและการทำงานเบื้องหลัง

### โหมดอินพุต Bash/Python

คำนำหน้าข้อความอินพุตสลับแฟล็กโหมดขอบ editor:

- `!` -> โหมด bash
- `$` (คำนำหน้าที่ไม่ใช่ template literal) -> โหมด python

Escape ออกจากโหมดที่ไม่ทำงานโดยล้างข้อความ editor และกู้คืนสีขอบ; เมื่อการทำงานกำลังดำเนินอยู่ escape จะยกเลิกงานที่กำลังทำงานแทน

### โหมด Plan

`InteractiveMode` ติดตามแฟล็กโหมด plan, สถานะ status-line, tool ที่ทำงานอยู่ และการเปลี่ยนโมเดล การเข้า/ออกจะอัปเดตรายการโหมด session และสถานะ UI/status รวมถึงการเปลี่ยนโมเดลแบบรอหากกำลัง streaming

### Suspend/resume (`Ctrl+Z`)

`InputController.handleCtrlZ()`:

1. ลงทะเบียน `SIGCONT` handler แบบครั้งเดียวเพื่อรีสตาร์ท TUI และบังคับเรนเดอร์
2. หยุด TUI ก่อน suspend
3. ส่ง `SIGTSTP` ไปยัง process group

### โหมดเบื้องหลัง (`/background` หรือ `/bg`)

`handleBackgroundCommand()`:

- ปฏิเสธเมื่อว่าง
- สลับบริบท tool UI เป็น non-interactive (`hasUI=false`) เพื่อให้ UI tool แบบ interactive ล้มเหลวอย่างรวดเร็ว
- หยุด loader/status line และยกเลิกการสมัครรับ foreground event handler
- สมัครรับ background event handler (รอ `agent_end` เป็นหลัก)
- หยุด TUI และส่ง `SIGTSTP` (เส้นทาง POSIX job control)

เมื่อ `agent_end` ในเบื้องหลังโดยไม่มีงานในคิว คอนโทรลเลอร์จะส่งการแจ้งเตือนเสร็จสมบูรณ์และปิดระบบ

## เส้นทางการยกเลิก

อินพุตการยกเลิกหลัก:

- `Escape` ระหว่าง stream loader ที่ทำงานอยู่: กู้คืนข้อความในคิวไปยัง editor และยกเลิก agent
- `Escape` ระหว่างการทำงาน bash/python: ยกเลิกคำสั่งที่กำลังทำงาน
- `Escape` ระหว่าง auto-compaction/retry: เรียกเมธอด abort เฉพาะทางผ่าน escape handler ชั่วคราว
- `Ctrl+C` กดครั้งเดียว: ล้าง editor; กดสองครั้งภายใน 500ms: ปิดระบบ

การยกเลิกขึ้นอยู่กับสถานะ; คีย์เดียวกันอาจหมายถึง abort, การออกจากโหมด, การเรียกตัวเลือก หรือ no-op ขึ้นอยู่กับสถานะ runtime

## พฤติกรรมแบบ event-driven เทียบกับ throttled

การอัปเดตแบบ event-driven:

- เหตุการณ์ agent session (`EventController`)
- callback อินพุตคีย์ (`InputController`)
- callback การ resize เทอร์มินัล
- ตัวเฝ้าดู theme/branch ใน `InteractiveMode`

เส้นทางแบบ throttled/debounced:

- การเรนเดอร์ TUI ถูก debounce ตาม tick (การรวม `requestRender`)
- แอนิเมชัน loader เป็นแบบ fixed-interval (80ms) แต่ละเฟรมร้องขอเรนเดอร์
- การอัปเดต autocomplete ของ editor (ภายใน `Editor`) ใช้ debounce timer ลดการคำนวณซ้ำระหว่างพิมพ์

ดังนั้น runtime จึงผสมผสานการเปลี่ยนสถานะแบบ event-driven กับจังหวะเรนเดอร์ที่มีขอบเขตเพื่อให้ interactivity ตอบสนองได้ดีโดยไม่เกิดพายุการวาดใหม่
