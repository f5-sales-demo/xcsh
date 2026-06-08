---
title: Secret Obfuscation
description: ไปป์ไลน์การปกปิดข้อมูลลับที่ปิดบังค่าที่เป็นความลับจากบันทึกเซสชันและผลลัพธ์
sidebar:
  order: 3
  label: Secrets
i18n:
  sourceHash: 1d9dc101c614
  translator: machine
---

# Secret Obfuscation

ป้องกันค่าที่เป็นความลับ (API keys, tokens, passwords) จากการถูกส่งไปยังผู้ให้บริการ LLM เมื่อเปิดใช้งาน ข้อมูลลับจะถูกแทนที่ด้วยตัวแทนแบบกำหนดได้ก่อนออกจากโปรเซส และถูกกู้คืนในอาร์กิวเมนต์ของ tool call ที่ส่งกลับมาจากโมเดล

## การเปิดใช้งาน

เปิดใช้งานโดยค่าเริ่มต้น สลับผ่าน UI ของ `/settings` หรือตั้งค่าโดยตรงใน `config.yml`:

```yaml
secrets:
  enabled: false
```

## วิธีการทำงาน

1. เมื่อเริ่มต้นเซสชัน ข้อมูลลับจะถูกรวบรวมจากสองแหล่ง:
   - **ตัวแปรสภาพแวดล้อม** ที่ตรงกับรูปแบบข้อมูลลับทั่วไป (`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD` ฯลฯ) ที่มีค่ายาว >= 8 ตัวอักษร
   - **ไฟล์ `secrets.yml`** (ดูรายละเอียดด้านล่าง)

2. ข้อความขาออกไปยัง LLM จะมีค่าข้อมูลลับทั้งหมดถูกแทนที่ด้วยตัวแทน เช่น `<<$env:S0>>`, `<<$env:S1>>` เป็นต้น

3. อาร์กิวเมนต์ของ tool call ที่ส่งกลับมาจากโมเดลจะถูกสำรวจแบบเชิงลึกและตัวแทนจะถูกกู้คืนเป็นค่าเดิมก่อนการดำเนินการ

มีสองโหมดที่ควบคุมว่าจะเกิดอะไรขึ้นกับข้อมูลลับแต่ละรายการ:

| โหมด | พฤติกรรม | ย้อนกลับได้ |
|---|---|---|
| `obfuscate` (ค่าเริ่มต้น) | แทนที่ด้วยตัวแทนแบบมีดัชนี `<<$env:SN>>` | ใช่ (ถอดรหัสกลับใน tool args) |
| `replace` | แทนที่ด้วยสตริงความยาวเท่ากันแบบกำหนดได้ | ไม่ (ทางเดียว) |

## secrets.yml

กำหนดรายการข้อมูลลับแบบกำหนดเองใน YAML มีการตรวจสอบสองตำแหน่ง:

| ระดับ | เส้นทาง | วัตถุประสงค์ |
|---|---|---|
| ทั่วไป | `~/.xcsh/agent/secrets.yml` | ข้อมูลลับสำหรับทุกโปรเจกต์ |
| โปรเจกต์ | `<cwd>/.xcsh/secrets.yml` | ข้อมูลลับเฉพาะโปรเจกต์ |

รายการระดับโปรเจกต์จะแทนที่รายการระดับทั่วไปที่มี `content` ตรงกัน

### สคีมา

แต่ละรายการในอาร์เรย์มีฟิลด์เหล่านี้:

| ฟิลด์ | ชนิด | จำเป็น | คำอธิบาย |
|---|---|---|---|
| `type` | `"plain"` หรือ `"regex"` | ใช่ | กลยุทธ์การจับคู่ |
| `content` | string | ใช่ | ค่าข้อมูลลับ (plain) หรือรูปแบบ regex (regex) |
| `mode` | `"obfuscate"` หรือ `"replace"` | ไม่ | ค่าเริ่มต้น: `"obfuscate"` |
| `replacement` | string | ไม่ | ข้อความแทนที่แบบกำหนดเอง (เฉพาะโหมด replace) |
| `flags` | string | ไม่ | แฟล็ก regex (เฉพาะชนิด regex) |

### ตัวอย่าง

#### ข้อมูลลับแบบ plain

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

#### ข้อมูลลับแบบ regex

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

รายการ regex จะสแกนแบบทั่วไปเสมอ (แฟล็ก `g` ถูกบังคับใช้โดยอัตโนมัติ) รองรับไวยากรณ์ regex literal `/pattern/flags` เป็นทางเลือกแทนฟิลด์ `content` + `flags` แยกกัน เครื่องหมายสแลชที่ถูก escape ภายในรูปแบบ (`\\/`) จะได้รับการจัดการอย่างถูกต้อง

#### โหมด replace กับ regex

```yaml
# One-way replace connection strings (not reversible)
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## การทำงานร่วมกับการตรวจจับตัวแปรสภาพแวดล้อม

ตัวแปรสภาพแวดล้อมจะถูกรวบรวมก่อนเสมอ รายการที่กำหนดในไฟล์จะถูกเพิ่มต่อท้าย ดังนั้นรายการในไฟล์สามารถครอบคลุมข้อมูลลับที่ไม่ได้อยู่ในตัวแปรสภาพแวดล้อม (ไฟล์คอนฟิก, ค่าที่ฝังในโค้ด ฯลฯ) หากค่าเดียวกันปรากฏในทั้งสองแหล่ง โหมดของรายการในไฟล์จะมีความสำคัญเหนือกว่า

## ไฟล์สำคัญ

- `src/secrets/index.ts` -- การโหลด, การรวม, การรวบรวมตัวแปรสภาพแวดล้อม
- `src/secrets/obfuscator.ts` -- คลาส `SecretObfuscator`, การสร้างตัวแทน, การปกปิดข้อความ
- `src/secrets/regex.ts` -- การแยกวิเคราะห์และคอมไพล์ regex literal
- `src/config/settings-schema.ts` -- การกำหนดการตั้งค่า `secrets.enabled`
