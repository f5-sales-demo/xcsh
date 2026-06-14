---
title: ระบบปลั๊กอิน Marketplace
description: >-
  ระบบปลั๊กอินตลาดกลางสำหรับการค้นหา ติดตั้ง
  และจัดการคอลเลกชันปลั๊กอินที่คัดสรรแล้ว
sidebar:
  order: 4
  label: ตลาดกลาง
i18n:
  sourceHash: 8ff4a59bbcd5
  translator: machine
---

# ระบบปลั๊กอิน Marketplace

ระบบตลาดกลางช่วยให้คุณค้นหา ติดตั้ง และจัดการปลั๊กอินจากแคตตาล็อกที่โฮสต์บน Git ระบบนี้รองรับรูปแบบรีจิสทรีปลั๊กอินของ Claude Code

## เริ่มต้นอย่างรวดเร็ว

```
/marketplace add anthropics/f5xc-salesdemos-marketplace
/marketplace install wordpress.com@f5xc-salesdemos-marketplace
```

หรือเพียงพิมพ์ `/marketplace` โดยไม่มีอาร์กิวเมนต์เพื่อเปิดเบราว์เซอร์ปลั๊กอินแบบโต้ตอบ

## แนวคิด

**marketplace** คือที่เก็บ Git (หรือไดเรกทอรีในเครื่อง) ที่มีไฟล์แคตตาล็อกอยู่ที่ `.xcsh-plugin/marketplace.json` แคตตาล็อกแสดงรายการปลั๊กอินที่พร้อมใช้งานพร้อมแหล่งที่มา คำอธิบาย และข้อมูลเมตา

**plugin** คือไดเรกทอรีที่ประกอบด้วยทักษะ คำสั่ง hooks เซิร์ฟเวอร์ MCP หรือเซิร์ฟเวอร์ LSP ปลั๊กอินจะถูกระบุด้วย `name@marketplace` (เช่น `code-review@f5xc-salesdemos-marketplace`)

**ขอบเขต (Scopes)**: ปลั๊กอินสามารถติดตั้งได้สองขอบเขต:

- **user** (ค่าเริ่มต้น) -- ใช้ได้ในทุกโปรเจกต์ จัดเก็บไว้ที่ `~/.xcsh/plugins/installed_plugins.json`
- **project** -- ใช้ได้เฉพาะในโปรเจกต์ปัจจุบัน จัดเก็บไว้ที่ `.xcsh/installed_plugins.json`

การติดตั้งแบบขอบเขต project จะแทนที่การติดตั้งแบบขอบเขต user ของปลั๊กอินชื่อเดียวกัน

## คำสั่ง

### โหมดโต้ตอบ

| คำสั่ง | ผล |
|---|---|
| `/marketplace` | เปิดเบราว์เซอร์ปลั๊กอินแบบโต้ตอบ (ติดตั้ง) |

### การจัดการ Marketplace

| คำสั่ง | ผล |
|---|---|
| `/marketplace add <source>` | เพิ่มแหล่ง marketplace |
| `/marketplace remove <name>` | ลบ marketplace |
| `/marketplace update [name]` | ดึงแคตตาล็อกใหม่ ละเว้นชื่อเพื่ออัปเดตทั้งหมด |
| `/marketplace list` | แสดงรายการ marketplace ที่กำหนดค่าไว้ |

### การดำเนินการปลั๊กอิน

| คำสั่ง | ผล |
|---|---|
| `/marketplace discover [marketplace]` | เรียกดูปลั๊กอินที่พร้อมใช้งาน |
| `/marketplace install [--force] [--scope user\|project] name@marketplace` | ติดตั้งปลั๊กอิน |
| `/marketplace uninstall [--scope user\|project] name@marketplace` | ถอนการติดตั้งปลั๊กอิน |
| `/marketplace installed` | แสดงรายการปลั๊กอิน marketplace ที่ติดตั้งแล้ว |
| `/marketplace upgrade [--scope user\|project] [name@marketplace]` | อัปเกรดปลั๊กอินหนึ่งรายการหรือทั้งหมด |

### คำสั่งเทียบเท่า CLI

การดำเนินการเดียวกันสามารถใช้ได้จากบรรทัดคำสั่ง:

```
xcsh plugin marketplace add <source>
xcsh plugin marketplace remove <name>
xcsh plugin marketplace update [name]
xcsh plugin marketplace list
xcsh plugin discover [marketplace]
xcsh plugin install --scope project name@marketplace
```

## แหล่ง Marketplace

เมื่อคุณรัน `/marketplace add <source>` ระบบจะจำแนกประเภทแหล่งที่มา:

| รูปแบบแหล่งที่มา | ประเภท | ตัวอย่าง |
|---|---|---|
| `owner/repo` | GitHub shorthand | `anthropics/f5xc-salesdemos-marketplace` |
| `https://...*.json` | URL แคตตาล็อกโดยตรง | `https://example.com/marketplace.json` |
| `https://...*.git` หรือ `git@...` | ที่เก็บ Git | `https://github.com/org/repo.git` |
| `./path` หรือ `~/path` หรือ `/path` | ไดเรกทอรีในเครื่อง | `./my-marketplace` |

ระบบจะโคลนที่เก็บ (หรืออ่านไดเรกทอรีในเครื่อง) ค้นหา `.xcsh-plugin/marketplace.json` ตรวจสอบความถูกต้อง และแคชแคตตาล็อกไว้ในเครื่อง

## รูปแบบแคตตาล็อก (marketplace.json)

แคตตาล็อก marketplace อยู่ที่ `.xcsh-plugin/marketplace.json` ในรูทของที่เก็บ:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "my-marketplace",
  "owner": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "description": "A collection of plugins",
  "plugins": [
    {
      "name": "my-plugin",
      "description": "What this plugin does",
      "source": "./plugins/my-plugin",
      "category": "development",
      "homepage": "https://github.com/you/my-plugin"
    }
  ]
}
```

### ฟิลด์ที่จำเป็น

| ฟิลด์ | คำอธิบาย |
|---|---|
| `name` | ชื่อ marketplace ตัวอักษรพิมพ์เล็กและตัวเลข ยัติภังค์ และจุด ต้องเริ่มต้นและสิ้นสุดด้วยตัวอักษรหรือตัวเลข ความยาวสูงสุด 64 ตัวอักษร |
| `owner.name` | ชื่อเจ้าของ marketplace |
| `plugins` | อาร์เรย์ของรายการปลั๊กอิน |

### ฟิลด์รายการปลั๊กอิน

| ฟิลด์ | จำเป็น | คำอธิบาย |
|---|---|---|
| `name` | ใช่ | ชื่อปลั๊กอิน (กฎเดียวกับชื่อ marketplace) |
| `source` | ใช่ | ตำแหน่งที่จะค้นหาปลั๊กอิน (ดูด้านล่าง) |
| `description` | ไม่ | คำอธิบายสั้น |
| `version` | ไม่ | สตริงเวอร์ชัน |
| `author` | ไม่ | `{ name, email? }` |
| `homepage` | ไม่ | URL |
| `category` | ไม่ | สตริงหมวดหมู่ (เช่น `development`, `productivity`, `security`) |
| `tags` | ไม่ | อาร์เรย์ของแท็กสตริง |
| `strict` | ไม่ | Boolean |
| `commands` | ไม่ | คำสั่ง Slash ที่ให้ไว้ |
| `agents` | ไม่ | Agent ที่ให้ไว้ |
| `hooks` | ไม่ | นิยาม hook |
| `mcpServers` | ไม่ | นิยามเซิร์ฟเวอร์ MCP |
| `lspServers` | ไม่ | นิยามเซิร์ฟเวอร์ LSP |

### รูปแบบแหล่งที่มาของปลั๊กอิน

ฟิลด์ `source` รองรับหลายรูปแบบ:

**เส้นทางสัมพัทธ์** (ภายในที่เก็บ marketplace):

```json
"source": "./plugins/my-plugin"
```

**URL ที่เก็บ Git**:

```json
"source": {
  "source": "url",
  "url": "https://github.com/org/repo.git",
  "sha": "abc123..."
}
```

**GitHub shorthand**:

```json
"source": {
  "source": "github",
  "repo": "org/repo",
  "ref": "main",
  "sha": "abc123..."
}
```

**ไดเรกทอรีย่อย Git** (monorepo):

```json
"source": {
  "source": "git-subdir",
  "url": "https://github.com/org/monorepo.git",
  "path": "plugins/my-plugin",
  "ref": "main",
  "sha": "abc123..."
}
```

**แพ็กเกจ npm**:

```json
"source": {
  "source": "npm",
  "package": "@scope/my-plugin",
  "version": "1.0.0"
}
```

## โครงสร้างบนดิสก์

```
~/.xcsh/
  config/
    marketplaces.json          # รีจิสทรีของ marketplace ที่เพิ่มแล้ว
  plugins/
    installed_plugins.json     # ปลั๊กอินที่ติดตั้งในขอบเขต user
    cache/
      marketplaces/            # แคตตาล็อก marketplace ที่แคชไว้
      plugins/                 # ไดเรกทอรีปลั๊กอินที่แคชไว้

<project>/.xcsh/
  installed_plugins.json       # ปลั๊กอินที่ติดตั้งในขอบเขต project
```

## กฎการตั้งชื่อ

ชื่อ marketplace และปลั๊กอินต้อง:

- เริ่มต้นและสิ้นสุดด้วยตัวอักษรพิมพ์เล็กหรือตัวเลข
- ประกอบด้วยเฉพาะตัวอักษรพิมพ์เล็ก ตัวเลข ยัติภังค์ และจุด
- มีความยาวไม่เกิน 64 ตัวอักษร

ID ปลั๊กอิน (`name@marketplace`) ต้องมีความยาวรวมไม่เกิน 128 ตัวอักษร

ตัวอย่างที่ถูกต้อง: `my-plugin`, `code-review`, `wordpress.com`, `ai-firstify`
ตัวอย่างที่ไม่ถูกต้อง: `-bad`, `bad-`, `.bad`, `Bad`, `under_score`
