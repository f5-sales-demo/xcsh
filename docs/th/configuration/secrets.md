---
title: Secret Obfuscation
description: ไปป์ไลน์การปกปิดข้อมูลลับที่ลบค่าข้อมูลสำคัญออกจากบันทึกเซสชันและเอาต์พุต
sidebar:
  order: 3
  label: Secrets
i18n:
  sourceHash: 1d9dc101c614
  translator: machine
---

# Secret Obfuscation

ป้องกันไม่ให้ค่าข้อมูลสำคัญ (API keys, tokens, passwords) ถูกส่งไปยังผู้ให้บริการ LLM เมื่อเปิดใช้งาน ข้อมูลลับจะถูกแทนที่ด้วย placeholder แบบ deterministic ก่อนออกจากโปรเซส และจะถูกคืนค่ากลับในอาร์กิวเมนต์ของ tool call ที่โมเดลส่งกลับมา

## การเปิดใช้งาน

เปิดใช้งานเป็นค่าเริ่มต้น สามารถสลับผ่าน UI `/settings` หรือตั้งค่าโดยตรงใน `config.yml`:

```yaml
secrets:
  enabled: false
```

## วิธีการทำงาน

1. เมื่อเริ่มต้นเซสชัน ข้อมูลลับจะถูกรวบรวมจากสองแหล่ง:
   - **ตัวแปรสภาพแวดล้อม** ที่ตรงกับรูปแบบข้อมูลลับทั่วไป (`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD` เป็นต้น) ที่มีค่ายาว >= 8 ตัวอักษร
   - **ไฟล์ `secrets.yml`** (ดูด้านล่าง)

2. ข้อความขาออกไปยัง LLM จะมีค่าข้อมูลลับทั้งหมดถูกแทนที่ด้วย placeholder เช่น `<<$env:S0>>`, `<<$env:S1>>` เป็นต้น

3. อาร์กิวเมนต์ของ tool call ที่โมเดลส่งกลับมาจะถูกสำรวจอย่างลึก (deep-walk) และ placeholder จะถูกคืนค่ากลับเป็นค่าเดิมก่อนการดำเนินการ

สองโหมดควบคุมสิ่งที่เกิดขึ้นกับข้อมูลลับแต่ละรายการ:

| โหมด | พฤติกรรม | กลับคืนได้ |
|---|---|---|
| `obfuscate` (ค่าเริ่มต้น) | แทนที่ด้วย placeholder แบบมีดัชนี `<<$env:SN>>` | ใช่ (ถอดรหัสกลับใน tool args) |
| `replace` | แทนที่ด้วยสตริงแบบ deterministic ที่มีความยาวเท่ากัน | ไม่ (ทางเดียว) |

## secrets.yml

กำหนดรายการข้อมูลลับแบบกำหนดเองใน YAML โดยตรวจสอบสองตำแหน่ง:

| ระดับ | เส้นทาง | วัตถุประสงค์ |
|---|---|---|
| Global | `~/.xcsh/agent/secrets.yml` | ข้อมูลลับสำหรับทุกโปรเจกต์ |
| Project | `<cwd>/.xcsh/secrets.yml` | ข้อมูลลับเฉพาะโปรเจกต์ |

รายการระดับโปรเจกต์จะแทนที่รายการระดับ global ที่มี `content` ตรงกัน

### Schema

แต่ละรายการในอาร์เรย์มีฟิลด์ดังนี้:

| ฟิลด์ | ชนิด | จำเป็น | คำอธิบาย |
|---|---|---|---|
| `type` | `"plain"` หรือ `"regex"` | ใช่ | กลยุทธ์การจับคู่ |
| `content` | string | ใช่ | ค่าข้อมูลลับ (plain) หรือรูปแบบ regex (regex) |
| `mode` | `"obfuscate"` หรือ `"replace"` | ไม่ | ค่าเริ่มต้น: `"obfuscate"` |
| `replacement` | string | ไม่ | ข้อความแทนที่แบบกำหนดเอง (เฉพาะโหมด replace) |
| `flags` | string | ไม่ | แฟล็ก regex (เฉพาะชนิด regex) |

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

รายการ regex จะสแกนแบบ global เสมอ (แฟล็ก `g` ถูกบังคับใช้โดยอัตโนมัติ) รูปแบบ regex literal `/pattern/flags` รองรับเป็นทางเลือกแทนการใช้ฟิลด์ `content` + `flags` แยกกัน เครื่องหมายทับที่ถูก escape ภายในรูปแบบ (`\\/`) จะถูกจัดการอย่างถูกต้อง

#### โหมด Replace กับ regex

```yaml
# One-way replace connection strings (not reversible)
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## การทำงานร่วมกับการตรวจจับตัวแปรสภาพแวดล้อม

ตัวแปรสภาพแวดล้อมจะถูกรวบรวมก่อนเสมอ รายการที่กำหนดในไฟล์จะถูกเพิ่มต่อท้าย ดังนั้นรายการในไฟล์สามารถครอบคลุมข้อมูลลับที่ไม่ได้อยู่ในตัวแปรสภาพแวดล้อม (ไฟล์ config, ค่าที่ฝังในโค้ด เป็นต้น) หากค่าเดียวกันปรากฏในทั้งสองแหล่ง โหมดของรายการในไฟล์จะมีลำดับความสำคัญสูงกว่า

## ไฟล์สำคัญ

- `src/secrets/index.ts` -- การโหลด, การรวม, การรวบรวมตัวแปรสภาพแวดล้อม
- `src/secrets/obfuscator.ts` -- คลาส `SecretObfuscator`, การสร้าง placeholder, การปกปิดข้อความ
- `src/secrets/regex.ts` -- การแยกวิเคราะห์และคอมไพล์ regex literal
- `src/config/settings-schema.ts` -- คำจำกัดความการตั้งค่า `secrets.enabled`
