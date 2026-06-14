---
title: ทักษะ
description: ระบบทักษะสำหรับการลงทะเบียน ค้นพบ และเรียกใช้ความสามารถพิเศษในตัวแทนเขียนโค้ด
sidebar:
  order: 3
  label: ทักษะ
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# ทักษะ

ทักษะคือชุดความสามารถที่สนับสนุนด้วยไฟล์ ซึ่งถูกค้นพบเมื่อเริ่มต้นระบบและเปิดเผยต่อโมเดลในรูปแบบ:

- ข้อมูลเมตาแบบเบาในพรอมต์ระบบ (ชื่อ + คำอธิบาย)
- เนื้อหาตามต้องการผ่าน `read skill://...`
- คำสั่ง `/skill:<name>` แบบโต้ตอบที่ไม่บังคับ

เอกสารนี้ครอบคลุมพฤติกรรมรันไทม์ปัจจุบันใน `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` และ `src/discovery/agents-md.ts`

## ทักษะในโค้ดเบสนี้คืออะไร

ทักษะที่ถูกค้นพบจะแสดงด้วย:

- `name`
- `description`
- `filePath` (เส้นทาง `SKILL.md`)
- `baseDir` (ไดเรกทอรีทักษะ)
- ข้อมูลเมตาแหล่งที่มา (`provider`, `level`, path)

รันไทม์ต้องการเพียง `name` และ `path` เพื่อความถูกต้อง ในทางปฏิบัติ คุณภาพการจับคู่ขึ้นอยู่กับ `description` ที่มีความหมาย

## โครงสร้างที่จำเป็นและข้อกำหนดของ SKILL.md

### โครงสร้างไดเรกทอรี

สำหรับการค้นพบที่ใช้ผู้ให้บริการ (native/Claude/Codex/Agents/plugin providers) ทักษะจะถูกค้นพบในระดับ **หนึ่งระดับใต้ `skills/`**:

- `<skills-root>/<skill-name>/SKILL.md`

รูปแบบที่ซ้อนกัน เช่น `<skills-root>/group/<skill>/SKILL.md` จะไม่ถูกค้นพบโดยตัวโหลดผู้ให้บริการ

สำหรับ `skills.customDirectories` การสแกนใช้โครงสร้างแบบไม่เรียกซ้ำเดียวกัน (`*/SKILL.md`)

```text
Provider-discovered layout (non-recursive under skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ discovered
  ├─ pdf/
  │   └─ SKILL.md      ✅ discovered
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ not discovered by provider loaders

Custom-directory scanning is also non-recursive, so nested paths are ignored unless you point `customDirectories` at that nested parent.
```

### Frontmatter ของ `SKILL.md`

ฟิลด์ frontmatter ที่รองรับบน skill type:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- คีย์เพิ่มเติมจะถูกเก็บรักษาไว้เป็นข้อมูลเมตาที่ไม่รู้จัก

พฤติกรรมรันไทม์ปัจจุบัน:

- `name` ค่าเริ่มต้นคือชื่อไดเรกทอรีทักษะ
- `description` จำเป็นสำหรับ:
  - การค้นพบทักษะผู้ให้บริการ `.xcsh` แบบ native (`requireDescription: true`)
  - การสแกน `skills.customDirectories` ผ่าน `scanSkillsFromDir` ใน `src/discovery/helpers.ts` (แบบไม่เรียกซ้ำ)
- ผู้ให้บริการที่ไม่ใช่ native สามารถโหลดทักษะโดยไม่มีคำอธิบายได้

## ไปป์ไลน์การค้นพบ

`discoverSkills()` ใน `src/extensibility/skills.ts` ทำงานสองรอบ:

1. **Capability providers** ผ่าน `loadCapability("skills")`
2. **Custom directories** ผ่าน `scanSkillsFromDir(..., { requireDescription: true })` (การระบุไดเรกทอรีหนึ่งระดับ)

หาก `skills.enabled` เป็น `false` การค้นพบจะไม่ส่งคืนทักษะใด

### ผู้ให้บริการทักษะในตัวและลำดับความสำคัญ

การเรียงลำดับผู้ให้บริการคือลำดับความสำคัญก่อน (สูงกว่าชนะ) จากนั้นลำดับการลงทะเบียนสำหรับกรณีเสมอกัน

ผู้ให้บริการทักษะที่ลงทะเบียนปัจจุบัน:

1. `native` (ลำดับความสำคัญ 100) — ทักษะผู้ใช้/โปรเจกต์ `.xcsh` ผ่าน `src/discovery/builtin.ts`
2. `claude` (ลำดับความสำคัญ 80)
3. กลุ่มลำดับความสำคัญ 70 (ตามลำดับการลงทะเบียน):
   - `claude-plugins`
   - `agents`
   - `codex`

คีย์การขจัดซ้ำคือชื่อทักษะ รายการแรกที่มีชื่อที่กำหนดจะชนะ

### การสลับแหล่งที่มาและการกรอง

`discoverSkills()` ใช้การควบคุมเหล่านี้:

- การสลับแหล่งที่มา: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- ตัวกรอง glob บนชื่อทักษะ:
  - `ignoredSkills` (ยกเว้น)
  - `includeSkills` (รายการที่อนุญาต; ว่างหมายถึงรวมทั้งหมด)

ลำดับการกรองคือ:

1. แหล่งที่มาเปิดใช้งาน
2. ไม่ถูกละเว้น
3. รวมอยู่ (หากมีรายการที่รวม)

สำหรับผู้ให้บริการอื่นนอกจาก codex/claude/native (เช่น `agents`, `claude-plugins`) การเปิดใช้งานปัจจุบันจะ fallback ไปที่: เปิดใช้งานหาก **ใดก็ตาม** ของการสลับแหล่งที่มาในตัวถูกเปิดใช้งาน

### การจัดการการชนกันและการซ้ำซ้อน

- การขจัดซ้ำของ Capability จะเก็บทักษะแรกต่อชื่อ (ผู้ให้บริการที่มีความสำคัญสูงสุด) ไว้แล้ว
- `extensibility/skills.ts` เพิ่มเติม:
  - ขจัดซ้ำไฟล์ที่เหมือนกันโดย `realpath` (ปลอดภัยต่อ symlink)
  - ส่งคำเตือนการชนกันเมื่อชื่อทักษะที่ตามมาขัดแย้ง
  - เก็บ API `discoverSkillsFromDir({ dir, source })` ที่สะดวกสบายไว้เป็น adapter บาง ๆ บน `scanSkillsFromDir`
- ทักษะจาก custom-directory จะถูกรวมหลังจากทักษะของผู้ให้บริการและปฏิบัติตามพฤติกรรมการชนกันเดียวกัน

## พฤติกรรมการใช้งานรันไทม์

### การเปิดเผยพรอมต์ระบบ

การสร้างพรอมต์ระบบ (`src/system-prompt.ts`) ใช้ทักษะที่ค้นพบดังนี้:

- หากมี `read` tool:
  - รวมรายการทักษะที่ค้นพบไว้ในพรอมต์
- มิเช่นนั้น:
  - ละเว้นรายการที่ค้นพบ

subagents ของ Task tool ได้รับรายการทักษะที่ค้นพบ/ให้มาของเซสชันผ่านการสร้างเซสชันปกติ ไม่มีการ override การปักหมุดทักษะต่องาน

### คำสั่ง `/skill:<name>` แบบโต้ตอบ

หาก `skills.enableSkillCommands` เป็น true โหมดโต้ตอบจะลงทะเบียนหนึ่ง slash command ต่อทักษะที่ค้นพบ

พฤติกรรมของ `/skill:<name> [args]`:

- อ่านไฟล์ทักษะโดยตรงจาก `filePath`
- ลบ frontmatter ออก
- ฉีดเนื้อหาทักษะเป็นข้อความกำหนดเองติดตาม
- เพิ่มข้อมูลเมตา (`Skill: <path>`, `User: <args>` ที่ไม่บังคับ)

## พฤติกรรม URL `skill://`

`src/internal-urls/skill-protocol.ts` รองรับ:

- `skill://<name>` → ไปยัง `SKILL.md` ของทักษะนั้น
- `skill://<name>/<relative-path>` → ไปยังภายในไดเรกทอรีทักษะนั้น

```text
skill:// URL resolution

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

Guards:
- reject absolute paths
- reject `..` traversal
- reject any resolved path escaping <pdf-base>
```

รายละเอียดการแก้ไข:

- ชื่อทักษะต้องตรงกันทุกประการ
- เส้นทางสัมพัทธ์จะถูก URL-decoded
- เส้นทางแบบ absolute จะถูกปฏิเสธ
- การ traversal เส้นทาง (`..`) จะถูกปฏิเสธ
- เส้นทางที่แก้ไขแล้วต้องอยู่ภายใน `baseDir`
- ไฟล์ที่ขาดหายจะส่งคืนข้อผิดพลาด `File not found` อย่างชัดเจน

ประเภทเนื้อหา:

- `.md` => `text/markdown`
- ทุกอย่างอื่น => `text/plain`

ไม่มีการค้นหา fallback สำหรับ assets ที่ขาดหาย

## ทักษะ เทียบกับ AGENTS.md คำสั่ง เครื่องมือ hooks

### ทักษะ เทียบกับ AGENTS.md

- **ทักษะ**: ชุดความสามารถที่มีชื่อและไม่บังคับ ซึ่งเลือกตามบริบทงานหรือร้องขอโดยตรง
- **AGENTS.md/ไฟล์บริบท**: ไฟล์คำสั่งถาวรที่โหลดเป็น context-file capability และรวมกันตามกฎระดับ/ความลึก

`src/discovery/agents-md.ts` เดินไดเรกทอรีบรรพบุรุษจาก `cwd` โดยเฉพาะเพื่อค้นหาไฟล์ `AGENTS.md` แบบ standalone (ถึงความลึก 20) ยกเว้นส่วนที่เป็นไดเรกทอรีซ่อน

### ทักษะ เทียบกับ slash commands

- **ทักษะ**: เนื้อหาความรู้/เวิร์กโฟลว์ที่โมเดลอ่านได้
- **Slash commands**: จุดเข้าคำสั่งที่ผู้ใช้เรียกใช้
- `/skill:<name>` คือ wrapper ที่สะดวกสบายที่ฉีดข้อความทักษะ ไม่ได้เปลี่ยนความหมายของการค้นพบทักษะ

### ทักษะ เทียบกับ custom tools

- **ทักษะ**: เนื้อหาเอกสาร/เวิร์กโฟลว์ที่โหลดผ่านบริบทพรอมต์และ `read`
- **Custom tools**: API เครื่องมือที่ปฏิบัติการได้ซึ่งโมเดลสามารถเรียกใช้ได้พร้อม schemas และผลข้างเคียงรันไทม์

### ทักษะ เทียบกับ hooks

- **ทักษะ**: เนื้อหาแบบ passive
- **Hooks**: ตัวดักจับรันไทม์ที่ขับเคลื่อนด้วยเหตุการณ์ซึ่งสามารถบล็อก/แก้ไขพฤติกรรมระหว่างการประมวลผลได้

## คำแนะนำการเขียนที่เป็นประโยชน์ซึ่งผูกกับตรรกะการค้นพบ

- วางทักษะแต่ละอย่างในไดเรกทอรีของตัวเอง: `<skills-root>/<skill-name>/SKILL.md`
- ใส่ frontmatter `name` และ `description` อย่างชัดเจนเสมอ
- เก็บ assets ที่อ้างอิงไว้ใต้ไดเรกทอรีทักษะเดียวกันและเข้าถึงด้วย `skill://<name>/...`
- สำหรับการจัดหมวดหมู่แบบซ้อน (`team/domain/skill`) ชี้ `skills.customDirectories` ไปที่ไดเรกทอรีพาเรนต์ที่ซ้อนกัน การสแกนเองยังคงเป็นแบบไม่เรียกซ้ำ
- หลีกเลี่ยงชื่อทักษะซ้ำกันในแหล่งที่มาต่างๆ การจับคู่แรกชนะตามลำดับความสำคัญของผู้ให้บริการ
