---
title: TUI Runtime Internals
description: >-
  Terminal UI runtime internals covering rendering pipeline, input handling, and
  state management.
sidebar:
  order: 2
  label: Runtime internals
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# รายละเอียดภายในของ TUI Runtime

เอกสารนี้แสดงเส้นทาง runtime ที่ไม่เกี่ยวกับธีม ตั้งแต่การรับ input จาก terminal ไปจนถึงการแสดงผลในโหมด interactive โดยเน้นที่พฤติกรรมใน `packages/tui` และการเชื่อมต่อจาก controllers ของ `packages/coding-agent`

## ชั้นของ Runtime และความเป็นเจ้าของ

- **เอนจิน `packages/tui`**: วงจรชีวิตของ terminal, การทำให้ stdin เป็นมาตรฐาน, การกำหนดเส้นทาง focus, การจัดตาราง render, การวาดแบบ differential, การประกอบ overlay, การวางตำแหน่ง hardware cursor
- **โหมด interactive ของ `packages/coding-agent`**: สร้าง component tree, ผูก editor callbacks และ keymaps, ตอบสนองต่อ events ของ agent/session, และแปลงสถานะของ domain (streaming, การรัน tool, การ retry, plan mode) ให้เป็น UI components

กฎเรื่องขอบเขต: เอนจิน TUI ไม่รู้จักข้อความ (message-agnostic) มันรู้เพียง `Component.render(width)`, `handleInput(data)`, focus และ overlays เท่านั้น ความหมายเชิง Agent ยังคงอยู่ใน interactive controllers

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

## การ boot และการประกอบ component tree

`InteractiveMode` สร้าง `TUI(new ProcessTerminal(), showHardwareCursor)` และสร้าง container ถาวร:

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (เก็บ `CustomEditor`)

`init()` เชื่อมต่อ tree ตามลำดับนั้น, focus ที่ editor, ลงทะเบียน input handlers ผ่าน `InputController`, เริ่ม TUI และร้องขอการ render แบบบังคับ

การ render แบบบังคับ (`requestRender(true)`) จะรีเซ็ต cache ของบรรทัดก่อนหน้าและการติดตาม cursor ก่อนทำการวาดใหม่

## วงจรชีวิตของ Terminal และการทำให้ stdin เป็นมาตรฐาน

`ProcessTerminal.start()`:

1. เปิดใช้งาน raw mode และ bracketed paste
2. แนบ resize handler
3. สร้าง `StdinBuffer` เพื่อแยกชิ้นส่วน escape ที่ไม่สมบูรณ์ให้เป็น sequence ที่สมบูรณ์
4. ตรวจสอบการรองรับ Kitty keyboard protocol (`CSI ? u`) จากนั้นเปิดใช้ protocol flags ถ้ารองรับ
5. บน Windows พยายามเปิดใช้ VT input ผ่าน mode flags ของ `kernel32`

พฤติกรรมของ `StdinBuffer`:

- บัฟเฟอร์ escape sequence ที่แตกเป็นชิ้นส่วน (CSI/OSC/DCS/APC/SS3)
- ปล่อย `data` เฉพาะเมื่อ sequence สมบูรณ์หรือถูก flush เมื่อ timeout
- ตรวจจับ bracketed paste และปล่อย `paste` event พร้อมข้อความ raw ที่ถูกวาง

สิ่งนี้ป้องกันไม่ให้ชิ้นส่วน escape ที่ไม่สมบูรณ์ถูกตีความผิดเป็นการกดปุ่มปกติ

## การกำหนดเส้นทาง input และโมเดล focus

เส้นทาง input:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

รายละเอียดการกำหนดเส้นทาง:

1. TUI รัน input listeners ที่ลงทะเบียนไว้ก่อน (`addInputListener`) เพื่ออนุญาตพฤติกรรม consume/transform
2. TUI จัดการ global debug shortcut (`shift+ctrl+d`) ก่อนส่งต่อไปยัง component
3. ถ้า focused component อยู่ใน overlay ที่ถูกซ่อน/มองไม่เห็นแล้ว TUI จะกำหนด focus ใหม่ไปยัง overlay ที่มองเห็นได้ถัดไปหรือ focus ที่บันทึกไว้ก่อนมี overlay
4. Key release events จะถูกกรองออกเว้นแต่ focused component ตั้งค่า `wantsKeyRelease = true`
5. หลังจากส่งต่อแล้ว TUI จะจัดตาราง render

`setFocus()` ยังสลับ `Focusable.focused` ซึ่งควบคุมว่า components จะปล่อย `CURSOR_MARKER` สำหรับการวางตำแหน่ง hardware cursor หรือไม่

## การแบ่งการจัดการปุ่ม: editor กับ controller

`CustomEditor` ดักจับ combo ที่มีลำดับความสำคัญสูงก่อน (escape, ctrl-c/d/z, ctrl-v, ctrl-p variants, ctrl-t, alt-up, extension custom keys) และส่งต่อส่วนที่เหลือไปยังพฤติกรรม `Editor` พื้นฐาน (การแก้ไขข้อความ, ประวัติ, autocomplete, การเคลื่อนที่ cursor)

จากนั้น `InputController.setupKeyHandlers()` จะผูก editor callbacks กับ mode actions:

- การยกเลิก / ออกจากโหมดด้วย `Escape`
- การปิดระบบด้วยการกด `Ctrl+C` สองครั้ง หรือ `Ctrl+D` เมื่อ editor ว่าง
- การหยุดชั่วคราว/กลับมาทำงานด้วย `Ctrl+Z`
- slash-command และ selector hotkeys
- การสลับ follow-up/dequeue และการสลับ expansion

สิ่งนี้ทำให้การ parse ปุ่ม/กลไก editor อยู่ใน `packages/tui` และความหมายเชิงโหมดอยู่ใน coding-agent controllers

## ลูป render และกลยุทธ์การ diff

`TUI.requestRender()` ถูก debounce เหลือหนึ่งรอบ render ต่อ tick โดยใช้ `process.nextTick` การเปลี่ยนแปลงสถานะหลายครั้งในรอบเดียวกันจะถูกรวมเข้าด้วยกัน

ขั้นตอนของ `#doRender()`:

1. Render root component tree เป็น `newLines`
2. ประกอบ overlay ที่มองเห็นได้ (ถ้ามี)
3. ดึงและลบ `CURSOR_MARKER` จากบรรทัด viewport ที่มองเห็นได้
4. ต่อ segment reset suffixes สำหรับบรรทัดที่ไม่ใช่รูปภาพ
5. เลือกระหว่างการวาดใหม่ทั้งหมดกับ differential patch:
   - เฟรมแรก
   - ความกว้างเปลี่ยน
   - ขนาดย่อลงโดยเปิดใช้ `clearOnShrink` และไม่มี overlay
   - การแก้ไขเหนือ viewport ก่อนหน้า
6. สำหรับการอัปเดตแบบ differential จะ patch เฉพาะช่วงบรรทัดที่เปลี่ยนและล้างบรรทัดท้ายที่ค้างอยู่เมื่อจำเป็น
7. จัดตำแหน่ง hardware cursor ใหม่สำหรับการรองรับ IME

การเขียน render ใช้โหมด synchronized output (`CSI ? 2026 h/l`) เพื่อลดการกระพริบ/ฉีกขาด

## ข้อจำกัดด้านความปลอดภัยของการ render

การตรวจสอบความปลอดภัยที่สำคัญใน `TUI`:

- บรรทัดที่ render แล้วซึ่งไม่ใช่รูปภาพต้องไม่เกินความกว้างของ terminal; การล้นจะ throw error และเขียนข้อมูลวินิจฉัย crash
- การประกอบ overlay รวมถึงการตัดทอนแบบป้องกันและการตรวจสอบความกว้างหลังการประกอบ
- การเปลี่ยนความกว้างจะบังคับให้วาดใหม่ทั้งหมดเพราะความหมายของการตัดบรรทัดเปลี่ยนไป
- ตำแหน่ง cursor จะถูก clamp ก่อนการเคลื่อนที่

ข้อจำกัดเหล่านี้เป็นการบังคับใช้ขณะ runtime ไม่ใช่เพียงแค่ข้อตกลง

## การจัดการ resize

Resize events ถูกขับเคลื่อนด้วย event จาก `ProcessTerminal` ไปยัง `TUI.requestRender()`

ผลกระทบ:

- การเปลี่ยนความกว้างใดๆ จะทริกเกอร์การวาดใหม่ทั้งหมด
- การติดตาม viewport/top (`#previousViewportTop`, `#maxLinesRendered`) ป้องกันการคำนวณ relative cursor ที่ไม่ถูกต้องเมื่อเนื้อหาหรือขนาด terminal เปลี่ยน
- การมองเห็น overlay สามารถขึ้นอยู่กับขนาด terminal (`OverlayOptions.visible`); focus จะถูกแก้ไขเมื่อ overlay ไม่สามารถมองเห็นได้หลัง resize

## การ streaming และการอัปเดต UI แบบ incremental

`EventController` สมัครรับ `AgentSessionEvent` และอัปเดต UI แบบ incremental:

- `agent_start`: เริ่ม loader ใน `statusContainer`
- `message_start` assistant: สร้าง `streamingComponent` และ mount มัน
- `message_update`: อัปเดตเนื้อหา streaming ของ assistant; สร้าง/อัปเดต tool execution components เมื่อ tool calls ปรากฏ
- `tool_execution_update/end`: อัปเดต tool result components และสถานะความสมบูรณ์
- `message_end`: จบ assistant stream, จัดการ annotations ที่ถูกยกเลิก/ผิดพลาด, ทำเครื่องหมาย pending tool args ว่าสมบูรณ์เมื่อหยุดปกติ
- `agent_end`: หยุด loaders, ล้างสถานะ stream ชั่วคราว, flush deferred model switch, ออกการแจ้งเตือนเมื่อสำเร็จถ้าอยู่ในโหมด background

การจัดกลุ่ม read-tool เป็นแบบ stateful โดยตั้งใจ (`#lastReadGroup`) เพื่อรวม read tool calls ที่ต่อเนื่องกันเป็นบล็อกภาพเดียวจนกว่าจะมี break ที่ไม่ใช่ read

## การจัดการ status และ loader

ความเป็นเจ้าของช่อง status:

- `statusContainer` เก็บ loader ชั่วคราว (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`)
- `statusLine` แสดง status/hooks/plan indicators ถาวรและขับเคลื่อนการอัปเดตขอบบนของ editor

พฤติกรรมของ Loader:

- `Loader` อัปเดตทุก 80ms ผ่าน interval และร้องขอ render ทุกเฟรม
- Escape handlers จะถูกแทนที่ชั่วคราวระหว่าง auto-compaction และ auto-retry เพื่อยกเลิกการดำเนินการเหล่านั้น
- บนเส้นทาง end/cancel controllers จะคืนค่า escape handlers ก่อนหน้าและหยุด/ล้าง loader components

## การเปลี่ยนโหมดและการทำงานในพื้นหลัง

### โหมด input ของ Bash/Python

คำนำหน้าข้อความ input สลับ mode flags ของ editor border:

- `!` -> โหมด bash
- `$` (คำนำหน้าที่ไม่ใช่ template literal) -> โหมด python

Escape จะออกจากโหมดที่ไม่ได้ active โดยล้างข้อความ editor และคืนสีขอบ; เมื่อการรันกำลังทำงานอยู่ escape จะยกเลิก task ที่กำลังทำงานแทน

### Plan mode

`InteractiveMode` ติดตาม plan mode flags, สถานะ status-line, active tools, และการสลับ model การเข้า/ออกจะอัปเดตรายการโหมดของ session และสถานะ status/UI รวมถึงการสลับ model แบบ deferred ถ้า streaming กำลังทำงานอยู่

### หยุดชั่วคราว/กลับมาทำงาน (`Ctrl+Z`)

`InputController.handleCtrlZ()`:

1. ลงทะเบียน `SIGCONT` handler แบบ one-shot เพื่อเริ่ม TUI ใหม่และบังคับ render
2. หยุด TUI ก่อนหยุดชั่วคราว
3. ส่ง `SIGTSTP` ไปยัง process group

### โหมดพื้นหลัง (`/background` หรือ `/bg`)

`handleBackgroundCommand()`:

- ปฏิเสธเมื่อ idle
- สลับ tool UI context เป็น non-interactive (`hasUI=false`) เพื่อให้ interactive UI tools ล้มเหลวเร็ว
- หยุด loaders/status line และยกเลิกการสมัครรับ foreground event handler
- สมัครรับ background event handler (รอ `agent_end` เป็นหลัก)
- หยุด TUI และส่ง `SIGTSTP` (เส้นทาง POSIX job control)

เมื่อ `agent_end` ในโหมดพื้นหลังโดยไม่มีงานในคิว controller จะส่งการแจ้งเตือนเมื่อสำเร็จและปิดระบบ

## เส้นทางการยกเลิก

Input หลักสำหรับการยกเลิก:

- `Escape` ระหว่าง active stream loader: คืนข้อความในคิวไปที่ editor และยกเลิก agent
- `Escape` ระหว่างการรัน bash/python: ยกเลิกคำสั่งที่กำลังทำงาน
- `Escape` ระหว่าง auto-compaction/retry: เรียกใช้วิธีการยกเลิกเฉพาะผ่าน escape handlers ชั่วคราว
- `Ctrl+C` กดครั้งเดียว: ล้าง editor; กดสองครั้งภายใน 500ms: ปิดระบบ

การยกเลิกเป็นแบบขึ้นอยู่กับสถานะ; ปุ่มเดียวกันสามารถหมายถึงการยกเลิก, การออกจากโหมด, การทริกเกอร์ selector, หรือไม่ทำอะไรเลย ขึ้นอยู่กับสถานะ runtime

## พฤติกรรมแบบ event-driven กับแบบ throttled

การอัปเดตแบบ event-driven:

- Agent session events (`EventController`)
- Key input callbacks (`InputController`)
- Terminal resize callback
- Theme/branch watchers ใน `InteractiveMode`

เส้นทางแบบ throttled/debounced:

- การ render ของ TUI ถูก debounce แบบ tick (`requestRender` coalescing)
- Loader animation เป็นแบบ fixed-interval (80ms) แต่ละเฟรมร้องขอ render
- การอัปเดต autocomplete ของ editor (ภายใน `Editor`) ใช้ debounce timers เพื่อลดการคำนวณซ้ำระหว่างการพิมพ์

ดังนั้น runtime จึงผสมผสานการเปลี่ยนสถานะแบบ event-driven กับจังหวะ render ที่มีขอบเขตเพื่อรักษาความตอบสนองของการโต้ตอบโดยไม่เกิดพายุการวาดใหม่
