---
title: การปิดบังข้อมูลลับ
description: >-
  ไปป์ไลน์การปิดบังข้อมูลลับที่ทำการตัดค่าข้อมูลที่ละเอียดอ่อนออกจากบันทึกเซสชันและเอาต์พุต
sidebar:
  order: 3
  label: ข้อมูลลับ
i18n:
  sourceHash: 1d9dc101c614
  translator: machine
---

# การปิดบังข้อมูลลับ

ป้องกันค่าที่ละเอียดอ่อน (API key, โทเค็น, รหัสผ่าน) จากการถูกส่งไปยังผู้ให้บริการ LLM เมื่อเปิดใช้งาน ข้อมูลลับจะถูกแทนที่ด้วยตัวแทนที่กำหนดได้ (deterministic placeholder) ก่อนออกจากโปรเซส และจะถูกกู้คืนใน tool call arguments ที่โมเดลส่งกลับมา

## การเปิดใช้งาน

เปิดใช้งานโดยค่าเริ่มต้น สลับเปิด/ปิดผ่าน UI `/settings` หรือตั้งค่าโดยตรงใน `config.yml`:

```yaml
secrets:
  enabled: false
```

## วิธีการทำงาน

1. เมื่อเริ่มเซสชัน ข้อมูลลับจะถูกรวบรวมจากสองแหล่ง:
   - **ตัวแปรสภาพแวดล้อม** ที่ตรงกับรูปแบบข้อมูลลับทั่วไป (`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD` ฯลฯ) โดยมีค่าความยาว >= 8 ตัวอักษร
   - **ไฟล์ `secrets.yml`** (ดูด้านล่าง)

2. ข้อความขาออกไปยัง LLM จะมีค่าข้อมูลลับทั้งหมดถูกแทนที่ด้วยตัวแทน เช่น `<<$env:S0>>`, `<<$env:S1>>` ฯลฯ

3. Tool call arguments ที่โมเดลส่งกลับมาจะถูกสำรวจแบบลึก (deep-walk) และตัวแทนจะถูกกู้คืนเป็นค่าเดิมก่อนการดำเนินการ

โหมดสองแบบควบคุมว่าจะเกิดอะไรขึ้นกับข้อมูลลับแต่ละรายการ:

| โหมด | พฤติกรรม | ย้อนกลับได้ |
|---|---|---|
| `obfuscate` (ค่าเริ่มต้น) | แทนที่ด้วยตัวแทนที่มีดัชนี `<<$env:SN>>` | ใช่ (จะถูกถอดการปิดบังใน tool args) |
| `replace` | แทนที่ด้วยสตริงความยาวเท่ากันแบบกำหนดได้ | ไม่ (ทางเดียว) |

## secrets.yml

กำหนดรายการข้อมูลลับแบบกำหนดเองใน YAML ระบบจะตรวจสอบสองตำแหน่ง:

| ระดับ | เส้นทาง | วัตถุประสงค์ |
|---|---|---|
| ส่วนกลาง | `~/.xcsh/agent/secrets.yml` | ข้อมูลลับที่ใช้ข้ามทุกโปรเจกต์ |
| โปรเจกต์ | `<cwd>/.xcsh/secrets.yml` | ข้อมูลลับเฉพาะโปรเจกต์ |

รายการระดับโปรเจกต์จะแทนที่รายการระดับส่วนกลางที่มี `content` ตรงกัน

### โครงสร้าง

แต่ละรายการในอาร์เรย์มีฟิลด์ดังนี้:

| ฟิลด์ | ประเภท | จำเป็น | คำอธิบาย |
|---|---|---|---|
| `type` | `"plain"` หรือ `"regex"` | ใช่ | กลยุทธ์การจับคู่ |
| `content` | string | ใช่ | ค่าข้อมูลลับ (plain) หรือรูปแบบ regex (regex) |
| `mode` | `"obfuscate"` หรือ `"replace"` | ไม่ | ค่าเริ่มต้น: `"obfuscate"` |
| `replacement` | string | ไม่ | ข้อความแทนที่แบบกำหนดเอง (เฉพาะโหมด replace) |
| `flags` | string | ไม่ | แฟล็ก regex (เฉพาะประเภท regex) |

### ตัวอย่าง

#### ข้อมูลลับแบบ Plain

```yaml
# Obfuscate a specific API key (default mode)
- type: plain
  content: sk-proj-abc123def456

# Replace a database password with a fixed string
- type: plain
  content: hunter2
  mode: replace
  replacement: "********"
```

#### ข้อมูลลับแบบ Regex

```yaml
# Obfuscate any AWS-style key
- type: regex
  content: "AKIA[0-9A-Z]{16}"

# Case-insensitive match with explicit flags
- type: regex
  content: "api[_-]?key\\s*=\\s*\\w+"
  flags: "i"

# Regex literal syntax (pattern and flags in one string)
- type: regex
  content: "/bearer\\s+[a-zA-Z0-9._~+\\/=-]+/i"
```

รายการ regex จะสแกนแบบ global เสมอ (แฟล็ก `g` ถูกบังคับใช้โดยอัตโนมัติ) ไวยากรณ์ regex literal `/pattern/flags` รองรับเป็นทางเลือกแทนการใช้ฟิลด์ `content` + `flags` แยกกัน เครื่องหมายสแลชที่ถูก escape ภายในรูปแบบ (`\\/`) จะถูกจัดการอย่างถูกต้อง

#### โหมด Replace กับ regex

```yaml
# One-way replace connection strings (not reversible)
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## การทำงานร่วมกับการตรวจจับตัวแปรสภาพแวดล้อม

ตัวแปรสภาพแวดล้อมจะถูกรวบรวมก่อนเสมอ รายการที่กำหนดจากไฟล์จะถูกเพิ่มต่อท้าย ดังนั้นรายการจากไฟล์สามารถครอบคลุมข้อมูลลับที่ไม่ได้อยู่ในตัวแปรสภาพแวดล้อม (ไฟล์คอนฟิก, ค่าที่ฝังในโค้ด ฯลฯ) หากค่าเดียวกันปรากฏในทั้งสองแหล่ง โหมดของรายการจากไฟล์จะมีความสำคัญเหนือกว่า

## ไฟล์สำคัญ

- `src/secrets/index.ts` -- การโหลด, การรวม, การรวบรวมตัวแปรสภาพแวดล้อม
- `src/secrets/obfuscator.ts` -- คลาส `SecretObfuscator`, การสร้างตัวแทน, การปิดบังข้อความ
- `src/secrets/regex.ts` -- การแยกวิเคราะห์และคอมไพล์ regex literal
- `src/config/settings-schema.ts` -- การกำหนดค่า `secrets.enabled`
