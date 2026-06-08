---
title: เอกสารประกอบ xcsh
description: >-
  AI-powered development CLI with TypeScript coding agent and Rust native layer
  for long-lived sessions, MCP support, and platform packaging.
sidebar:
  order: 0
  label: ภาพรวม
i18n:
  sourceHash: b9288f42bf46
  translator: machine
---

xcsh เป็น CLI สำหรับการพัฒนาที่ขับเคลื่อนด้วย AI พร้อม coding agent ที่เขียนด้วย TypeScript และ
เลเยอร์ native ที่เขียนด้วย Rust (`pi-natives`) โดยขยายต่อจากโอเพนซอร์ส
[`badlogic/pi-mono`](https://github.com/badlogic/pi-mono) ด้วย
runtime ที่แข็งแกร่ง, เซสชันแบบยาวนานพร้อมการนำทางแบบ tree และการบีบอัด,
เครื่องมือ Python IPython, รองรับ MCP เต็มรูปแบบ, ระบบ skills และการ
แพ็กเกจแพลตฟอร์มที่รองรับ Linux, macOS และ Windows

## จุดเริ่มต้น

- **[F5 XC Contexts](/runtime-tools/context-command)** — เชื่อมต่อกับ F5 Distributed Cloud
  tenants สร้าง contexts, สลับระหว่าง contexts, จัดการ namespaces และ credentials
- **การกำหนดค่า** — วิธีที่ xcsh ค้นหา, resolve และจัดเลเยอร์การกำหนดค่า
- **Runtime และเครื่องมือ** — รันไทม์ของ bash / notebook / resolve tool และ
  พื้นผิว slash-command
- **เซสชัน** — บันทึก entry แบบ append-only, การนำทางแบบ tree, การบีบอัด และ
  ระบบหน่วยความจำอัตโนมัติ
- **Natives (Rust)** — สถาปัตยกรรมของ `pi-natives` N-API addon ที่
  ขับเคลื่อน shell / PTY / media / search
- **MCP** — การกำหนดค่า, รายละเอียดภายในของโปรโตคอล, วงจรชีวิตรันไทม์ และวิธี
  สร้าง servers และ tools
- **Extensions, Skills และ Plugins** — การสร้าง, การโหลด, กฎการจับคู่,
  marketplace และตัวติดตั้ง plugin
- **Providers และ Models** — การกำหนดค่าโมเดล, รายละเอียดภายในของ streaming และ
  รันไทม์ Python / IPython
- **TUI** — การกำหนดธีม, คำสั่ง `/tree` และ integration hooks สำหรับ
  extensions และเครื่องมือแบบกำหนดเอง

## เอกสารชุดนี้จัดระเบียบอย่างไร

แต่ละกลุ่มระดับบนสุดในแถบด้านข้างจะสอดคล้องกับระบบย่อยของ agent ภายใน
แต่ละกลุ่ม หน้าต่าง ๆ จะเรียงลำดับจาก "ภาพรวม" ไปจนถึง "รายละเอียดภายใน" เพื่อให้คุณสามารถหยุดอ่าน
ได้เมื่อมีบริบทเพียงพอสำหรับงานที่ต้องทำ
