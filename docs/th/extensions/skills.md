---
title: Skills
description: ระบบ Skills สำหรับลงทะเบียน ค้นหา และเรียกใช้ความสามารถเฉพาะทางใน coding agent
sidebar:
  order: 3
  label: Skills
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# Skills

Skills คือแพ็คความสามารถที่สนับสนุนด้วยไฟล์ ถูกค้นพบตอนเริ่มต้นระบบและเปิดเผยให้โมเดลในรูปแบบ:

- เมตาดาต้าน้ำหนักเบาใน system prompt (ชื่อ + คำอธิบาย)
- เนื้อหาแบบเรียกใช้ตามต้องการผ่าน `read skill://...`
- คำสั่ง `/skill:<name>` แบบโต้ตอบที่เป็นทางเลือก

เอกสารนี้ครอบคลุมพฤติกรรมรันไทม์ปัจจุบันใน `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` และ `src/discovery/agents-md.ts`

## Skill คืออะไรในโค้ดเบสนี้

Skill ที่ถูกค้นพบจะแสดงเป็น:

- `name`
- `description`
- `filePath` (พาธของ `SKILL.md`)
- `baseDir` (ไดเรกทอรีของ skill)
- เมตาดาต้าของแหล่งที่มา (`provider`, `level`, path)

รันไทม์ต้องการเพียง `name` และ `path` เพื่อความถูกต้อง ในทางปฏิบัติ คุณภาพการจับคู่ขึ้นอยู่กับ `description` ที่มีความหมาย

## โครงสร้างที่จำเป็นและข้อกำหนดของ SKILL.md

### โครงสร้างไดเรกทอรี

สำหรับการค้นหาแบบ provider-based (native/Claude/Codex/Agents/plugin providers) skills จะถูกค้นพบเป็น **หนึ่งระดับภายใต้ `skills/`**:

- `<skills-root>/<skill-name>/SKILL.md`

รูปแบบซ้อนกันเช่น `<skills-root>/group/<skill>/SKILL.md` จะไม่ถูกค้นพบโดย provider loaders

สำหรับ `skills.customDirectories` การสแกนใช้โครงสร้างแบบไม่ recursive เช่นเดียวกัน (`*/SKILL.md`)

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

ฟิลด์ frontmatter ที่รองรับบนประเภท skill:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- คีย์เพิ่มเติมจะถูกเก็บรักษาไว้เป็นเมตาดาต้าที่ไม่ทราบชนิด

พฤติกรรมรันไทม์ปัจจุบัน:

- `name` จะใช้ค่าเริ่มต้นเป็นชื่อไดเรกทอรีของ skill
- `description` จำเป็นสำหรับ:
  - การค้นหา skill ของ native `.xcsh` provider (`requireDescription: true`)
  - การสแกน `skills.customDirectories` ผ่าน `scanSkillsFromDir` ใน `src/discovery/helpers.ts` (ไม่ recursive)
- provider ที่ไม่ใช่ native สามารถโหลด skills ได้โดยไม่ต้องมี description

## ไปป์ไลน์การค้นหา

`discoverSkills()` ใน `src/extensibility/skills.ts` ทำสองรอบ:

1. **Capability providers** ผ่าน `loadCapability("skills")`
2. **Custom directories** ผ่าน `scanSkillsFromDir(..., { requireDescription: true })` (การแจกแจงไดเรกทอรีหนึ่งระดับ)

หาก `skills.enabled` เป็น `false` การค้นหาจะไม่คืนค่า skills ใดๆ

### Built-in skill providers และลำดับความสำคัญ

ลำดับของ provider จะเรียงตามความสำคัญก่อน (ค่าสูงกว่าชนะ) จากนั้นเรียงตามลำดับการลงทะเบียนสำหรับกรณีที่เท่ากัน

Skill providers ที่ลงทะเบียนในปัจจุบัน:

1. `native` (priority 100) — skills ระดับ user/project ของ `.xcsh` ผ่าน `src/discovery/builtin.ts`
2. `claude` (priority 80)
3. กลุ่ม priority 70 (ตามลำดับการลงทะเบียน):
   - `claude-plugins`
   - `agents`
   - `codex`

คีย์สำหรับตัดซ้ำคือชื่อ skill รายการแรกที่มีชื่อที่กำหนดจะเป็นผู้ชนะ

### ตัวสลับแหล่งที่มาและการกรอง

`discoverSkills()` ใช้การควบคุมเหล่านี้:

- ตัวสลับแหล่งที่มา: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- ตัวกรอง glob บนชื่อ skill:
  - `ignoredSkills` (ยกเว้น)
  - `includeSkills` (รายการอนุญาตที่รวม; ว่างหมายถึงรวมทั้งหมด)

ลำดับการกรอง:

1. แหล่งที่มาเปิดใช้งาน
2. ไม่ถูกเพิกเฉย
3. ถูกรวม (หากมีรายการรวม)

สำหรับ providers อื่นนอกจาก codex/claude/native (เช่น `agents`, `claude-plugins`) การเปิดใช้งานในปัจจุบันจะ fallback เป็น: เปิดใช้งานถ้าตัวสลับแหล่งที่มา built-in **ใดก็ตาม** ถูกเปิดใช้งาน

### การจัดการการชนกันและรายการซ้ำ

- การตัดซ้ำของ Capability จะเก็บ skill แรกต่อชื่อไว้แล้ว (provider ที่มีความสำคัญสูงสุด)
- `extensibility/skills.ts` เพิ่มเติม:
  - ตัดซ้ำไฟล์ที่เหมือนกันด้วย `realpath` (ปลอดภัยกับ symlink)
  - แสดงคำเตือนการชนกันเมื่อชื่อ skill ภายหลังขัดแย้ง
  - เก็บรักษา API อำนวยความสะดวก `discoverSkillsFromDir({ dir, source })` เป็น adapter บางๆ เหนือ `scanSkillsFromDir`
- Skills จาก custom-directory จะถูกรวมหลัง provider skills และปฏิบัติตามพฤติกรรมการชนกันเดียวกัน

## พฤติกรรมการใช้งานรันไทม์

### การเปิดเผยใน System prompt

การสร้าง System prompt (`src/system-prompt.ts`) ใช้ skills ที่ค้นพบดังนี้:

- หากเครื่องมือ `read` พร้อมใช้งาน:
  - รวมรายการ skills ที่ค้นพบใน prompt
- มิฉะนั้น:
  - ละเว้นรายการที่ค้นพบ

Subagents ของเครื่องมือ Task จะได้รับรายการ skills ที่ค้นพบ/ให้มาของเซสชันผ่านการสร้างเซสชันปกติ; ไม่มีการ override การตรึง skill ต่อ task

### คำสั่ง `/skill:<name>` แบบโต้ตอบ

หาก `skills.enableSkillCommands` เป็น true โหมดโต้ตอบจะลงทะเบียนคำสั่ง slash หนึ่งคำสั่งต่อ skill ที่ค้นพบ

พฤติกรรมของ `/skill:<name> [args]`:

- อ่านไฟล์ skill โดยตรงจาก `filePath`
- ตัด frontmatter ออก
- แทรกเนื้อหา skill เป็นข้อความติดตามแบบกำหนดเอง
- เพิ่มเมตาดาต้า (`Skill: <path>`, ทางเลือก `User: <args>`)

## พฤติกรรม URL `skill://`

`src/internal-urls/skill-protocol.ts` รองรับ:

- `skill://<name>` → แก้ไขเป็น `SKILL.md` ของ skill นั้น
- `skill://<name>/<relative-path>` → แก้ไขภายในไดเรกทอรีของ skill นั้น

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

- ชื่อ skill ต้องตรงกันทุกประการ
- พาธสัมพัทธ์จะถูก URL-decoded
- พาธสัมบูรณ์จะถูกปฏิเสธ
- การข้ามผ่านพาธ (`..`) จะถูกปฏิเสธ
- พาธที่แก้ไขแล้วต้องอยู่ภายใน `baseDir`
- ไฟล์ที่หายไปจะคืนค่าข้อผิดพลาด `File not found` อย่างชัดเจน

ประเภทเนื้อหา:

- `.md` => `text/markdown`
- อื่นๆ ทั้งหมด => `text/plain`

ไม่มีการค้นหาสำรองสำหรับ assets ที่หายไป

## Skills เปรียบเทียบกับ AGENTS.md, commands, tools, hooks

### Skills เปรียบเทียบกับ AGENTS.md

- **Skills**: แพ็คความสามารถที่มีชื่อและเป็นทางเลือก ถูกเลือกตามบริบทของ task หรือถูกร้องขออย่างชัดเจน
- **AGENTS.md/context files**: ไฟล์คำสั่งถาวรที่โหลดเป็น context-file capability และถูกรวมตามกฎ level/depth

`src/discovery/agents-md.ts` เดินขึ้นไปยังไดเรกทอรีบรรพบุรุษจาก `cwd` โดยเฉพาะเพื่อค้นพบไฟล์ `AGENTS.md` แบบ standalone (สูงสุดถึง depth 20) โดยไม่รวมส่วนไดเรกทอรีที่ซ่อน

### Skills เปรียบเทียบกับ slash commands

- **Skills**: เนื้อหาความรู้/เวิร์กโฟลว์ที่โมเดลสามารถอ่านได้
- **Slash commands**: จุดเข้าคำสั่งที่ผู้ใช้เรียกใช้
- `/skill:<name>` เป็น wrapper อำนวยความสะดวกที่แทรกข้อความ skill; ไม่เปลี่ยนความหมายของการค้นหา skill

### Skills เปรียบเทียบกับ custom tools

- **Skills**: เนื้อหาเอกสาร/เวิร์กโฟลว์ที่โหลดผ่าน prompt context และ `read`
- **Custom tools**: API เครื่องมือที่สามารถเรียกใช้งานได้ซึ่งโมเดลสามารถเรียกได้พร้อม schemas และผลข้างเคียงรันไทม์

### Skills เปรียบเทียบกับ hooks

- **Skills**: เนื้อหาแบบ passive
- **Hooks**: ตัวดักจับรันไทม์ที่ขับเคลื่อนด้วยเหตุการณ์ซึ่งสามารถบล็อก/แก้ไขพฤติกรรมระหว่างการดำเนินการ

## แนวทางการเขียนเชิงปฏิบัติที่เชื่อมโยงกับตรรกะการค้นหา

- วาง skill แต่ละตัวในไดเรกทอรีของตัวเอง: `<skills-root>/<skill-name>/SKILL.md`
- รวม frontmatter `name` และ `description` อย่างชัดเจนเสมอ
- เก็บ assets ที่อ้างอิงไว้ภายใต้ไดเรกทอรี skill เดียวกันและเข้าถึงด้วย `skill://<name>/...`
- สำหรับการจัดหมวดหมู่แบบซ้อน (`team/domain/skill`) ชี้ `skills.customDirectories` ไปที่ไดเรกทอรีแม่ของส่วนที่ซ้อนกัน; การสแกนตัวมันเองยังคงเป็นแบบไม่ recursive
- หลีกเลี่ยงชื่อ skill ซ้ำกันข้ามแหล่งที่มา; การจับคู่แรกจะชนะตามลำดับความสำคัญของ provider
