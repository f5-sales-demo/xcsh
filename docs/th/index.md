---
title: เอกสาร xcsh
description: >-
  CLI สำหรับการพัฒนาที่ขับเคลื่อนด้วย AI พร้อม TypeScript coding agent และ Rust
  native layer สำหรับเซสชันที่ยาวนาน การรองรับ MCP
  และการแพ็กเกจสำหรับแต่ละแพลตฟอร์ม
sidebar:
  order: 0
  label: ภาพรวม
i18n:
  sourceHash: b9288f42bf46
  translator: machine
---

xcsh เป็น CLI สำหรับการพัฒนาที่ขับเคลื่อนด้วย AI พร้อม TypeScript coding agent และ
Rust native layer (`pi-natives`) ซึ่งขยายต่อจากโปรเจกต์โอเพนซอร์ส
[`badlogic/pi-mono`](https://github.com/badlogic/pi-mono) ด้วย
runtime ที่แข็งแกร่ง เซสชันที่ยาวนานพร้อมการนำทางแบบ tree และการบีบอัด
เครื่องมือ Python IPython การรองรับ MCP อย่างเต็มรูปแบบ ระบบ skills และการแพ็กเกจ
สำหรับแพลตฟอร์ม Linux, macOS และ Windows

## จุดเริ่มต้น

- **[F5 XC Contexts](/runtime-tools/context-command)** — เชื่อมต่อกับ F5 Distributed Cloud
  tenants สร้าง context สลับระหว่าง context ต่างๆ จัดการ namespaces และ credentials
- **การตั้งค่า** — วิธีที่ xcsh ค้นหา แก้ไข และจัดเรียงการตั้งค่าเป็นชั้นๆ
- **Runtime และเครื่องมือ** — bash / notebook / resolve tool runtimes และ
  พื้นผิวคำสั่ง slash-command
- **เซสชัน** — บันทึกรายการแบบ append-only การนำทางแบบ tree การบีบอัด และ
  ระบบหน่วยความจำอัตโนมัติ
- **Natives (Rust)** — สถาปัตยกรรมของ `pi-natives` N-API addon ที่
  ขับเคลื่อน shell / PTY / media / search
- **MCP** — การตั้งค่า รายละเอียดโปรโตคอล วงจรชีวิตของ runtime และวิธี
  สร้าง servers และ tools
- **ส่วนขยาย Skills และปลั๊กอิน** — การสร้าง การโหลด กฎการจับคู่
  marketplace และตัวติดตั้งปลั๊กอิน
- **Providers และโมเดล** — การตั้งค่าโมเดล รายละเอียดการ streaming และ
  Python / IPython runtime
- **TUI** — ธีม คำสั่ง `/tree` และ integration hooks สำหรับ
  ส่วนขยายและเครื่องมือที่กำหนดเอง

## การจัดระเบียบของชุดเอกสารนี้

แต่ละกลุ่มระดับบนสุดในแถบด้านข้างจะสอดคล้องกับระบบย่อยของ agent ภายใน
แต่ละกลุ่ม หน้าต่างๆ จะเรียงลำดับจาก "ภาพรวม" ไปจนถึง "รายละเอียดภายใน" เพื่อให้คุณสามารถหยุดอ่าน
ได้เมื่อมีบริบทเพียงพอสำหรับงานที่ต้องการทำ
