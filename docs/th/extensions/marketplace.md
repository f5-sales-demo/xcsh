---
title: ระบบ Marketplace Plugin
description: >-
  ระบบ Marketplace Plugin สำหรับค้นหา ติดตั้ง
  และจัดการคอลเลกชันปลั๊กอินที่คัดสรรมาแล้ว
sidebar:
  order: 4
  label: ตลาดกลาง
i18n:
  sourceHash: 8ff4a59bbcd5
  translator: machine
---

# ระบบ Marketplace Plugin

ระบบตลาดกลางช่วยให้คุณค้นหา ติดตั้ง และจัดการปลั๊กอินจากแคตตาล็อกที่โฮสต์บน Git ระบบนี้รองรับรูปแบบรีจิสทรีปลั๊กอินของ Claude Code

## เริ่มต้นอย่างรวดเร็ว

```
/marketplace add anthropics/f5xc-salesdemos-marketplace
/marketplace install wordpress.com@f5xc-salesdemos-marketplace
```

หรือพิมพ์เพียง `/marketplace` โดยไม่มีอาร์กิวเมนต์เพื่อเปิดเบราว์เซอร์ปลั๊กอินแบบโต้ตอบ

## แนวคิดพื้นฐาน

**ตลาดกลาง** คือ Git repository (หรือไดเรกทอรีในเครื่อง) ที่มีไฟล์แคตตาล็อกอยู่ที่ `.xcsh-plugin/marketplace.json` แคตตาล็อกจะแสดงรายการปลั๊กอินที่มีอยู่พร้อมแหล่งที่มา คำอธิบาย และข้อมูลเมตาดาตา

**ปลั๊กอิน** คือไดเรกทอรีที่บรรจุ skills, commands, hooks, MCP servers หรือ LSP servers ปลั๊กอินถูกระบุด้วย `name@marketplace` (เช่น `code-review@f5xc-salesdemos-marketplace`)

**ขอบเขต**: ปลั๊กอินสามารถติดตั้งได้สองขอบเขต:

- **user** (ค่าเริ่มต้น) — ใช้งานได้ในทุกโปรเจกต์ เก็บไว้ที่ `~/.xcsh/plugins/installed_plugins.json`
- **project** — ใช้งานได้เฉพาะในโปรเจกต์ปัจจุบัน เก็บไว้ที่ `.xcsh/installed_plugins.json`

การติดตั้งในขอบเขต project จะบดบังการติดตั้งในขอบเขต user สำหรับปลั๊กอินชื่อเดียวกัน

## คำสั่ง

### โหมดโต้ตอบ

| คำสั่ง | ผลลัพธ์ |
|---|---|
| `/marketplace` | เปิดเบราว์เซอร์ปลั๊กอินแบบโต้ตอบ (ติดตั้ง) |

### การจัดการตลาดกลาง

| คำสั่ง | ผลลัพธ์ |
|---|---|
| `/marketplace add <source>` | เพิ่มแหล่งตลาดกลาง |
| `/marketplace remove <name>` | ลบตลาดกลาง |
| `/marketplace update [name]` | ดึงแคตตาล็อกใหม่ ละเว้นชื่อเพื่ออัปเดตทั้งหมด |
| `/marketplace list` | แสดงรายการตลาดกลางที่กำหนดค่าไว้ |

### การดำเนินการกับปลั๊กอิน

| คำสั่ง | ผลลัพธ์ |
|---|---|
| `/marketplace discover [marketplace]` | เรียกดูปลั๊กอินที่มีอยู่ |
| `/marketplace install [--force] [--scope user\|project] name@marketplace` | ติดตั้งปลั๊กอิน |
| `/marketplace uninstall [--scope user\|project] name@marketplace` | ถอนการติดตั้งปลั๊กอิน |
| `/marketplace installed` | แสดงรายการปลั๊กอินตลาดกลางที่ติดตั้งแล้ว |
| `/marketplace upgrade [--scope user\|project] [name@marketplace]` | อัปเกรดปลั๊กอินหนึ่งหรือทั้งหมด |

### คำสั่งเทียบเท่าใน CLI

การดำเนินการเดียวกันนี้สามารถใช้ได้จาก command line:

```
xcsh plugin marketplace add <source>
xcsh plugin marketplace remove <name>
xcsh plugin marketplace update [name]
xcsh plugin marketplace list
xcsh plugin discover [marketplace]
xcsh plugin install --scope project name@marketplace
```

## แหล่งตลาดกลาง

เมื่อคุณรัน `/marketplace add <source>` ระบบจะจำแนกประเภทของแหล่งที่มา:

| รูปแบบแหล่งที่มา | ประเภท | ตัวอย่าง |
|---|---|---|
| `owner/repo` | GitHub shorthand | `anthropics/f5xc-salesdemos-marketplace` |
| `https://...*.json` | URL แคตตาล็อกโดยตรง | `https://example.com/marketplace.json` |
| `https://...*.git` หรือ `git@...` | Git repository | `https://github.com/org/repo.git` |
| `./path` หรือ `~/path` หรือ `/path` | ไดเรกทอรีในเครื่อง | `./my-marketplace` |

ระบบจะโคลน repository (หรืออ่านไดเรกทอรีในเครื่อง) ระบุตำแหน่ง `.xcsh-plugin/marketplace.json` ตรวจสอบความถูกต้อง และแคชแคตตาล็อกไว้ในเครื่อง

## รูปแบบแคตตาล็อก (marketplace.json)

แคตตาล็อกของตลาดกลางอยู่ที่ `.xcsh-plugin/marketplace.json` ในโฟลเดอร์ root ของ repository:

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
| `name` | ชื่อตลาดกลาง ตัวอักษรพิมพ์เล็กและตัวเลข เครื่องหมายขีดกลาง และจุด ต้องเริ่มและจบด้วยตัวอักษรพิมพ์เล็กหรือตัวเลข ความยาวสูงสุด 64 ตัวอักษร |
| `owner.name` | ชื่อเจ้าของตลาดกลาง |
| `plugins` | อาร์เรย์ของรายการปลั๊กอิน |

### ฟิลด์รายการปลั๊กอิน

| ฟิลด์ | จำเป็น | คำอธิบาย |
|---|---|---|
| `name` | ใช่ | ชื่อปลั๊กอิน (กฎเดียวกับชื่อตลาดกลาง) |
| `source` | ใช่ | แหล่งที่มาของปลั๊กอิน (ดูด้านล่าง) |
| `description` | ไม่ | คำอธิบายสั้น ๆ |
| `version` | ไม่ | สตริงเวอร์ชัน |
| `author` | ไม่ | `{ name, email? }` |
| `homepage` | ไม่ | URL |
| `category` | ไม่ | สตริงหมวดหมู่ (เช่น `development`, `productivity`, `security`) |
| `tags` | ไม่ | อาร์เรย์ของแท็กสตริง |
| `strict` | ไม่ | Boolean |
| `commands` | ไม่ | คำสั่ง slash ที่ให้บริการ |
| `agents` | ไม่ | Agents ที่ให้บริการ |
| `hooks` | ไม่ | นิยาม hook |
| `mcpServers` | ไม่ | นิยาม MCP server |
| `lspServers` | ไม่ | นิยาม LSP server |

### รูปแบบแหล่งที่มาของปลั๊กอิน

ฟิลด์ `source` รองรับหลายรูปแบบ:

**Relative path** (ภายใน marketplace repo):

```json
"source": "./plugins/my-plugin"
```

**Git repository URL**:

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

**Git subdirectory** (monorepo):

```json
"source": {
  "source": "git-subdir",
  "url": "https://github.com/org/monorepo.git",
  "path": "plugins/my-plugin",
  "ref": "main",
  "sha": "abc123..."
}
```

**npm package**:

```json
"source": {
  "source": "npm",
  "package": "@scope/my-plugin",
  "version": "1.0.0"
}
```

## โครงสร้างไฟล์บนดิสก์

```
~/.xcsh/
  config/
    marketplaces.json          # Registry ของตลาดกลางที่เพิ่มไว้
  plugins/
    installed_plugins.json     # ปลั๊กอินที่ติดตั้งในขอบเขต user
    cache/
      marketplaces/            # แคชแคตตาล็อกตลาดกลาง
      plugins/                 # แคชไดเรกทอรีปลั๊กอิน

<project>/.xcsh/
  installed_plugins.json       # ปลั๊กอินที่ติดตั้งในขอบเขต project
```

## กฎการตั้งชื่อ

ชื่อตลาดกลางและปลั๊กอินต้อง:

- เริ่มและจบด้วยตัวอักษรพิมพ์เล็กหรือตัวเลข
- ประกอบด้วยตัวอักษรพิมพ์เล็ก ตัวเลข เครื่องหมายขีดกลาง และจุดเท่านั้น
- มีความยาวไม่เกิน 64 ตัวอักษร

Plugin ID (`name@marketplace`) ต้องมีความยาวรวมไม่เกิน 128 ตัวอักษร

ตัวอย่างที่ถูกต้อง: `my-plugin`, `code-review`, `wordpress.com`, `ai-firstify`
ตัวอย่างที่ไม่ถูกต้อง: `-bad`, `bad-`, `.bad`, `Bad`, `under_score`
