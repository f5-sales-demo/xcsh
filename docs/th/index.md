---
title: เอกสาร xcsh
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

xcsh เป็น CLI สำหรับการพัฒนาที่ขับเคลื่อนด้วย AI พร้อม TypeScript coding agent และ
Rust native layer (`pi-natives`) โดยขยายต่อจากโปรเจกต์โอเพนซอร์ส
[`badlogic/pi-mono`](https://github.com/badlogic/pi-mono) ด้วย runtime ที่แข็งแกร่ง,
เซสชันที่ใช้งานได้ยาวนานพร้อมการนำทางแบบ tree และการบีบอัด,
เครื่องมือ Python IPython, รองรับ MCP อย่างเต็มรูปแบบ, ระบบ skills และ
การ package สำหรับแพลตฟอร์ม Linux, macOS และ Windows

## จุดเริ่มต้น

- **[F5 XC Contexts](/runtime-tools/context-command)** — เชื่อมต่อกับ F5 Distributed Cloud
  tenants สร้าง context, สลับระหว่าง context, จัดการ namespace และ credentials
- **การกำหนดค่า** — วิธีที่ xcsh ค้นหา, แก้ไข และจัดลำดับชั้นของการกำหนดค่า
- **Runtime และเครื่องมือ** — runtime ของ bash / notebook / resolve tool และ
  พื้นผิวคำสั่ง slash-command
- **เซสชัน** — บันทึก entry แบบ append-only, การนำทางแบบ tree, การบีบอัด และ
  ระบบหน่วยความจำอัตโนมัติ
- **Natives (Rust)** — สถาปัตยกรรมของ `pi-natives` N-API addon ที่
  ขับเคลื่อน shell / PTY / media / search
- **MCP** — การกำหนดค่า, รายละเอียดภายในของโปรโตคอล, วงจรชีวิตของ runtime และวิธี
  เขียน server และเครื่องมือ
- **Extensions, Skills และ Plugins** — การเขียน, การโหลด, กฎการจับคู่,
  marketplace และตัวติดตั้ง plugin
- **Providers และ Models** — การกำหนดค่าโมเดล, รายละเอียดภายในของ streaming และ
  runtime ของ Python / IPython
- **TUI** — การตั้งค่าธีม, คำสั่ง `/tree` และ hook สำหรับการผสานรวมกับ
  extensions และเครื่องมือที่กำหนดเอง

## การจัดระเบียบชุดเอกสารนี้

แต่ละกลุ่มระดับบนสุดใน sidebar จะสอดคล้องกับระบบย่อยของ agent ภายใน
แต่ละกลุ่ม หน้าต่าง ๆ จะเรียงลำดับจาก "ภาพรวม" ไปจนถึง "รายละเอียดภายใน" เพื่อให้คุณสามารถหยุดอ่าน
ได้เมื่อมีบริบทเพียงพอสำหรับงานที่ต้องทำ
