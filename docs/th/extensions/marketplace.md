---
title: Marketplace Plugin System
description: >-
  Marketplace plugin system for discovering, installing, and managing curated
  plugin collections.
sidebar:
  order: 4
  label: Marketplace
i18n:
  sourceHash: 8ff4a59bbcd5
  translator: machine
---

# ระบบปลั๊กอิน Marketplace

ระบบ marketplace ช่วยให้คุณค้นหา ติดตั้ง และจัดการปลั๊กอินจากแค็ตตาล็อกที่โฮสต์บน Git ระบบนี้เข้ากันได้กับรูปแบบ plugin registry ของ Claude Code

## เริ่มต้นอย่างรวดเร็ว

```
/marketplace add anthropics/f5xc-salesdemos-marketplace
/marketplace install wordpress.com@f5xc-salesdemos-marketplace
```

หรือเพียงพิมพ์ `/marketplace` โดยไม่ใส่อาร์กิวเมนต์เพื่อเปิดตัวเรียกดูปลั๊กอินแบบโต้ตอบ

## แนวคิด

**marketplace** คือ Git repository (หรือไดเรกทอรีในเครื่อง) ที่มีไฟล์แค็ตตาล็อกอยู่ที่ `.xcsh-plugin/marketplace.json` แค็ตตาล็อกจะแสดงรายการปลั๊กอินที่พร้อมใช้งานพร้อมแหล่งที่มา คำอธิบาย และข้อมูลเมตา

**plugin** คือไดเรกทอรีที่ประกอบด้วย skills, commands, hooks, MCP servers หรือ LSP servers ปลั๊กอินถูกระบุด้วย `name@marketplace` (เช่น `code-review@f5xc-salesdemos-marketplace`)

**ขอบเขต (Scopes)**: ปลั๊กอินสามารถติดตั้งได้ในสองขอบเขต:

- **user** (ค่าเริ่มต้น) -- ใช้งานได้ในทุกโปรเจกต์ จัดเก็บใน `~/.xcsh/plugins/installed_plugins.json`
- **project** -- ใช้งานได้เฉพาะในโปรเจกต์ปัจจุบัน จัดเก็บใน `.xcsh/installed_plugins.json`

การติดตั้งแบบขอบเขตโปรเจกต์จะบดบัง (shadow) การติดตั้งแบบขอบเขตผู้ใช้ของปลั๊กอินเดียวกัน

## คำสั่ง

### โหมดโต้ตอบ

| คำสั่ง | ผลลัพธ์ |
|---|---|
| `/marketplace` | เปิดตัวเรียกดูปลั๊กอินแบบโต้ตอบ (ติดตั้ง) |

### การจัดการ marketplace

| คำสั่ง | ผลลัพธ์ |
|---|---|
| `/marketplace add <source>` | เพิ่มแหล่ง marketplace |
| `/marketplace remove <name>` | ลบ marketplace |
| `/marketplace update [name]` | ดึงแค็ตตาล็อกใหม่; ละเว้นชื่อเพื่ออัปเดตทั้งหมด |
| `/marketplace list` | แสดงรายการ marketplace ที่กำหนดค่าไว้ |

### การดำเนินการกับปลั๊กอิน

| คำสั่ง | ผลลัพธ์ |
|---|---|
| `/marketplace discover [marketplace]` | เรียกดูปลั๊กอินที่พร้อมใช้งาน |
| `/marketplace install [--force] [--scope user\|project] name@marketplace` | ติดตั้งปลั๊กอิน |
| `/marketplace uninstall [--scope user\|project] name@marketplace` | ถอนการติดตั้งปลั๊กอิน |
| `/marketplace installed` | แสดงรายการปลั๊กอิน marketplace ที่ติดตั้งแล้ว |
| `/marketplace upgrade [--scope user\|project] [name@marketplace]` | อัปเกรดปลั๊กอินหนึ่งตัวหรือทั้งหมด |

### คำสั่ง CLI ที่เทียบเท่า

การดำเนินการเดียวกันสามารถใช้งานได้จากบรรทัดคำสั่ง:

```
xcsh plugin marketplace add <source>
xcsh plugin marketplace remove <name>
xcsh plugin marketplace update [name]
xcsh plugin marketplace list
xcsh plugin discover [marketplace]
xcsh plugin install --scope project name@marketplace
```

## แหล่ง marketplace

เมื่อคุณรัน `/marketplace add <source>` ระบบจะจำแนกประเภทแหล่งที่มา:

| รูปแบบแหล่งที่มา | ประเภท | ตัวอย่าง |
|---|---|---|
| `owner/repo` | GitHub แบบย่อ | `anthropics/f5xc-salesdemos-marketplace` |
| `https://...*.json` | URL แค็ตตาล็อกโดยตรง | `https://example.com/marketplace.json` |
| `https://...*.git` หรือ `git@...` | Git repository | `https://github.com/org/repo.git` |
| `./path` หรือ `~/path` หรือ `/path` | ไดเรกทอรีในเครื่อง | `./my-marketplace` |

ระบบจะโคลน repository (หรืออ่านไดเรกทอรีในเครื่อง) ค้นหา `.xcsh-plugin/marketplace.json` ตรวจสอบความถูกต้อง และแคชแค็ตตาล็อกไว้ในเครื่อง

## รูปแบบแค็ตตาล็อก (marketplace.json)

แค็ตตาล็อก marketplace อยู่ที่ `.xcsh-plugin/marketplace.json` ในรากของ repository:

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
| `name` | ชื่อ marketplace ตัวอักษรพิมพ์เล็ก ตัวเลข ขีดกลาง และจุด ต้องเริ่มต้นและลงท้ายด้วยตัวอักษรหรือตัวเลข สูงสุด 64 ตัวอักษร |
| `owner.name` | ชื่อเจ้าของ marketplace |
| `plugins` | อาร์เรย์ของรายการปลั๊กอิน |

### ฟิลด์รายการปลั๊กอิน

| ฟิลด์ | จำเป็น | คำอธิบาย |
|---|---|---|
| `name` | ใช่ | ชื่อปลั๊กอิน (กฎเดียวกับชื่อ marketplace) |
| `source` | ใช่ | ที่อยู่ของปลั๊กอิน (ดูด้านล่าง) |
| `description` | ไม่ | คำอธิบายสั้น |
| `version` | ไม่ | สตริงเวอร์ชัน |
| `author` | ไม่ | `{ name, email? }` |
| `homepage` | ไม่ | URL |
| `category` | ไม่ | สตริงหมวดหมู่ (เช่น `development`, `productivity`, `security`) |
| `tags` | ไม่ | อาร์เรย์ของแท็กสตริง |
| `strict` | ไม่ | บูลีน |
| `commands` | ไม่ | คำสั่ง slash ที่ให้บริการ |
| `agents` | ไม่ | เอเจนต์ที่ให้บริการ |
| `hooks` | ไม่ | คำจำกัดความของ hook |
| `mcpServers` | ไม่ | คำจำกัดความของ MCP server |
| `lspServers` | ไม่ | คำจำกัดความของ LSP server |

### รูปแบบแหล่งที่มาของปลั๊กอิน

ฟิลด์ `source` รองรับหลายรูปแบบ:

**เส้นทางสัมพัทธ์** (ภายใน marketplace repo):

```json
"source": "./plugins/my-plugin"
```

**URL ของ Git repository**:

```json
"source": {
  "source": "url",
  "url": "https://github.com/org/repo.git",
  "sha": "abc123..."
}
```

**GitHub แบบย่อ**:

```json
"source": {
  "source": "github",
  "repo": "org/repo",
  "ref": "main",
  "sha": "abc123..."
}
```

**ไดเรกทอรีย่อยของ Git** (monorepo):

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
    marketplaces.json          # รายการ marketplace ที่เพิ่มไว้
  plugins/
    installed_plugins.json     # ปลั๊กอินที่ติดตั้งในขอบเขตผู้ใช้
    cache/
      marketplaces/            # แค็ตตาล็อก marketplace ที่แคชไว้
      plugins/                 # ไดเรกทอรีปลั๊กอินที่แคชไว้

<project>/.xcsh/
  installed_plugins.json       # ปลั๊กอินที่ติดตั้งในขอบเขตโปรเจกต์
```

## กฎการตั้งชื่อ

ชื่อ marketplace และปลั๊กอินต้อง:

- เริ่มต้นและลงท้ายด้วยตัวอักษรพิมพ์เล็กหรือตัวเลข
- ประกอบด้วยตัวอักษรพิมพ์เล็ก ตัวเลข ขีดกลาง และจุดเท่านั้น
- มีความยาวไม่เกิน 64 ตัวอักษร

รหัสปลั๊กอิน (`name@marketplace`) ต้องมีความยาวรวมไม่เกิน 128 ตัวอักษร

ตัวอย่างที่ถูกต้อง: `my-plugin`, `code-review`, `wordpress.com`, `ai-firstify`
ตัวอย่างที่ไม่ถูกต้อง: `-bad`, `bad-`, `.bad`, `Bad`, `under_score`
